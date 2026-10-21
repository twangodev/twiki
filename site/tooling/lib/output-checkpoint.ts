import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readlinkSync, type BigIntStats } from 'node:fs';
import path from 'node:path';

type Identity = readonly [bigint, bigint, bigint, bigint, bigint, bigint];
const identity = (info: Readonly<BigIntStats>): Identity => [
	info.dev,
	info.ino,
	info.mode,
	info.size,
	info.mtimeNs,
	info.ctimeNs
];
const sameIdentity = (left: Identity, right: Readonly<BigIntStats>) =>
	left[0] === right.dev &&
	left[1] === right.ino &&
	left[2] === right.mode &&
	left[3] === right.size &&
	left[4] === right.mtimeNs &&
	left[5] === right.ctimeNs;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
interface Leaf {
	hash: string;
	identity?: Identity;
	inode?: string;
	unidentifiedLinks?: boolean;
}
class Branch {
	readonly children = new Map<string, Branch | Leaf>();
	hash?: string;
	anchor = false;
	fingerprint(): string {
		return (this.hash ??= digest([
			'directory',
			[...this.children.keys()].sort().map((name) => {
				const child = this.children.get(name)!;
				return [name, child instanceof Branch ? child.fingerprint() : child.hash];
			})
		]));
	}
}
interface InodeGroup {
	leaf: Leaf;
	paths: Set<string>;
}

/** Expected output identities. Only owned writes or independently validated observations may update it. */
export class OutputCheckpoint {
	readonly site: string;
	readonly roots: readonly string[];
	private readonly tree = new Branch();
	private readonly leaves = new Map<string, Leaf>();
	private readonly inodes = new Map<string, InodeGroup>();
	private readonly unsettled = new Set<string>();
	private unidentifiedLinks = false;

	constructor(site: string, roots: readonly string[]) {
		this.site = path.resolve(site);
		for (const root of roots)
			if (
				path.isAbsolute(root) ||
				root.includes('\\') ||
				root.split('/').some((part) => !part || part === '.' || part === '..')
			)
				throw new Error(`Invalid output checkpoint root: ${root}`);
		this.roots = Object.freeze([...new Set(roots)]);
		if (
			this.roots.some((root) =>
				this.roots.some((other) => other !== root && root.startsWith(other + '/'))
			)
		)
			throw new Error('Output checkpoint roots must not overlap');
	}

	/** Unobserved effects on surviving hardlinks require a full capture before saving. */
	get complete() {
		return !this.unidentifiedLinks && this.unsettled.size === 0;
	}

	private relative(file: string) {
		return path.relative(this.site, path.resolve(file)).split(path.sep).join('/');
	}

	handles(file: string) {
		const relative = this.relative(file);
		return this.roots.some((root) => relative === root || relative.startsWith(root + '/'));
	}

	private branch(relative: string, anchor = false) {
		let current = this.tree;
		const prefix: string[] = [];
		for (const name of relative.split('/')) {
			prefix.push(name);
			let child = current.children.get(name);
			if (!(child instanceof Branch)) {
				this.detach(path.join(this.site, ...prefix));
				child = new Branch();
				current.children.set(name, child);
			}
			current.hash = undefined;
			current = child;
		}
		current.anchor ||= anchor;
		current.hash = undefined;
		return current;
	}

	private place(relative: string, leaf?: Leaf) {
		const parts = relative.split('/');
		const chain = [this.tree];
		let current = this.tree;
		for (const [index, name] of parts.slice(0, -1).entries()) {
			let child = current.children.get(name);
			if (!(child instanceof Branch)) {
				if (!leaf) return;
				this.detach(path.join(this.site, ...parts.slice(0, index + 1)));
				child = new Branch();
				current.children.set(name, child);
			}
			current = child;
			chain.push(current);
		}
		const name = parts.at(-1)!;
		if (leaf) current.children.set(name, leaf);
		else current.children.delete(name);
		for (let i = chain.length - 1; i >= 0; i--) {
			chain[i].hash = undefined;
			if (i && !chain[i].anchor && chain[i].children.size === 0)
				chain[i - 1].children.delete(parts[i - 1]);
		}
	}

	private node(relative: string): Branch | Leaf | undefined {
		let node: Branch | Leaf = this.tree;
		for (const name of relative.split('/')) {
			if (!(node instanceof Branch)) return;
			const next = node.children.get(name);
			if (!next) return;
			node = next;
		}
		return node;
	}

	private detach(file: string) {
		const previous = this.leaves.get(file);
		this.leaves.delete(file);
		if (previous?.unidentifiedLinks) this.unidentifiedLinks = true;
		if (!previous?.inode) return;
		const group = this.inodes.get(previous.inode)!;
		group.paths.delete(file);
		if (group.paths.size) this.unsettled.add(previous.inode);
		else {
			this.inodes.delete(previous.inode);
			this.unsettled.delete(previous.inode);
		}
	}

	/** Preserve exact observations; this method never restats a newer file on the caller's behalf. */
	record(file: string, info: Readonly<BigIntStats>) {
		file = path.resolve(file);
		const previous = this.leaves.get(file);
		if (
			previous?.identity &&
			sameIdentity(previous.identity, info) &&
			(!previous.inode || !this.unsettled.has(previous.inode))
		)
			return;
		const relative = this.relative(file);
		const root = this.roots.find((root) => relative === root || relative.startsWith(root + '/'));
		if (!root) return;
		if (info.isDirectory()) {
			if (relative === root) {
				this.detach(file);
				this.branch(root, true);
			} else if (previous) {
				this.detach(file);
				this.place(relative);
			}
			return;
		}
		if (this.node(relative) instanceof Branch) {
			const prefix = file + path.sep;
			for (const known of [...this.leaves.keys()]) if (known.startsWith(prefix)) this.detach(known);
		}
		if (relative !== root) this.branch(root, true);
		const observed = identity(info);
		const hash = digest([
			'leaf',
			observed.map(String),
			info.isSymbolicLink() ? readlinkSync(file) : ''
		]);
		if (info.isFile() && info.dev !== 0n && info.ino > 0n) {
			const inode = `${info.dev}:${info.ino}`;
			if (previous?.inode !== inode) this.detach(file);
			let group = this.inodes.get(inode);
			if (!group) {
				group = { leaf: { hash, identity: observed, inode }, paths: new Set() };
				this.inodes.set(inode, group);
			}
			group.leaf.hash = hash;
			group.leaf.identity = observed;
			group.paths.add(file);
			this.leaves.set(file, group.leaf);
			this.unsettled.delete(inode);
			for (const alias of group.paths) this.place(this.relative(alias), group.leaf);
		} else {
			this.detach(file);
			const unidentifiedLinks = info.isFile() && info.nlink > 1n;
			if (unidentifiedLinks) this.unidentifiedLinks = true;
			const leaf = { hash, identity: observed, unidentifiedLinks };
			this.leaves.set(file, leaf);
			this.place(relative, leaf);
		}
	}

	remove(file: string) {
		file = path.resolve(file);
		if (!this.handles(file)) return;
		const relative = this.relative(file);
		if (this.leaves.has(file)) this.detach(file);
		else if (this.node(relative) instanceof Branch) {
			const prefix = file + path.sep;
			for (const known of [...this.leaves.keys()]) if (known.startsWith(prefix)) this.detach(known);
		}
		this.place(relative, this.roots.includes(relative) ? { hash: digest(['missing']) } : undefined);
	}

	fingerprint() {
		if (!this.complete) throw new Error('Output checkpoint has unobserved hardlink changes');
		return digest(['output-checkpoint-v1', this.roots, this.tree.fingerprint()]);
	}

	/** A fresh scan never follows symlink directories or trusts the expected tree. */
	static capture(site: string, roots: readonly string[]) {
		const checkpoint = new OutputCheckpoint(site, roots);
		const files = new Map<string, Readonly<BigIntStats>>();
		function walk(file: string, root = false): Branch | Leaf | undefined {
			const info = lstatSync(file, { bigint: true, throwIfNoEntry: false });
			if (!info) {
				if (!root) throw new Error(`Output changed during checkpoint capture: ${file}`);
				return;
			}
			if (info.isDirectory()) {
				const branch = new Branch();
				for (const name of readdirSync(file)) {
					const child = walk(path.join(file, name));
					if (child) branch.children.set(name, child);
				}
				return root || branch.children.size ? branch : undefined;
			}
			const observed = identity(info);
			const hash = digest([
				'leaf',
				observed.map(String),
				info.isSymbolicLink() ? readlinkSync(file) : ''
			]);
			let leaf: Leaf;
			if (info.isFile() && info.dev !== 0n && info.ino > 0n) {
				const inode = `${info.dev}:${info.ino}`;
				let group = checkpoint.inodes.get(inode);
				if (!group) {
					group = { leaf: { hash, identity: observed, inode }, paths: new Set() };
					checkpoint.inodes.set(inode, group);
				}
				// All aliases share one leaf before any directory hashes are computed.
				leaf = group.leaf;
				leaf.hash = hash;
				leaf.identity = observed;
				group.paths.add(file);
			} else
				leaf = { hash, identity: observed, unidentifiedLinks: info.isFile() && info.nlink > 1n };
			checkpoint.leaves.set(file, leaf);
			if (info.isFile()) files.set(file, info);
			return leaf;
		}
		for (const root of roots) {
			const file = path.join(checkpoint.site, root);
			const node = walk(file, true);
			if (node instanceof Branch) {
				const anchor = checkpoint.branch(root, true);
				for (const [name, child] of node.children) anchor.children.set(name, child);
			} else if (node) checkpoint.place(root, node);
			else checkpoint.remove(file);
		}
		// A full scan observes each path independently, including aliases whose
		// filesystem identifiers are unsuitable for incremental grouping.
		checkpoint.unidentifiedLinks = false;
		return { checkpoint, files };
	}
}
