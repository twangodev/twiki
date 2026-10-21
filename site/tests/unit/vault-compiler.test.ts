import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compileContent } from '../../tooling/compiler';

test('plain Obsidian vault compiles private/public editions with links and attachments without Git or source writes', async () => {
	const root = mkdtempSync(path.join(tmpdir(), 'twiki-vault-compiler-'));
	const vault = path.join(root, 'vault');
	const site = path.join(root, '.twiki/site');
	try {
		mkdirSync(path.join(vault, 'nested'), { recursive: true });
		mkdirSync(site, { recursive: true });
		writeFileSync(
			path.join(vault, 'index.md'),
			'# My Vault\n\n[[nested/note|Second note]]\n\n![[picture.png]]\n\n![[nested/note]]\n'
		);
		writeFileSync(
			path.join(vault, 'nested/note.md'),
			'# Second Note\n\nplainvaultcanarybody\n\n[[index|Home]]\n'
		);
		writeFileSync(path.join(vault, 'picture.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
		const sourceFiles = ['index.md', 'nested/note.md', 'picture.png'];
		const sourceHashes = () =>
			sourceFiles.map((file) =>
				createHash('sha256')
					.update(readFileSync(path.join(vault, file)))
					.digest('hex')
			);
		const original = sourceHashes();
		const configure = (publication: 'private' | 'public') =>
			writeFileSync(
				path.join(root, 'twiki.config.json'),
				JSON.stringify({
					version: 1,
					contentDir: 'vault',
					discovery: 'filesystem',
					publication,
					site: { title: 'My Vault', url: 'https://vault.example' }
				})
			);
		configure('private');
		const compiledFull = await compileContent({
			siteDir: site,
			repoRoot: root,
			publicEdition: false
		});
		const full = JSON.parse(
			readFileSync(path.join(site, 'build/generated/content-manifest.json'), 'utf8')
		);
		expect(JSON.parse(JSON.stringify(compiledFull))).toEqual(full);
		expect(Object.keys(full.pages).sort()).toEqual(['index', 'nested/note']);
		expect(full.pages['nested/note'].publication.public).toBe(false);
		expect(readFileSync(path.join(site, 'build/generated/pages/index.json'), 'utf8')).toContain(
			'/nested/note'
		);
		expect(readFileSync(path.join(site, 'build/generated/pages/index.json'), 'utf8')).toContain(
			'plainvaultcanarybody'
		);
		const compiledHidden = await compileContent({
			siteDir: site,
			repoRoot: root,
			publicEdition: true
		});
		const hidden = JSON.parse(
			readFileSync(path.join(site, 'build/generated/content-manifest.json'), 'utf8')
		);
		expect(JSON.parse(JSON.stringify(compiledHidden))).toEqual(hidden);
		expect(hidden.pages['nested/note'].locked).toBe(true);
		const hiddenDoc = path.join(site, 'build/generated/pages/nested/note.json');
		expect(
			!existsSync(hiddenDoc) || !readFileSync(hiddenDoc, 'utf8').includes('plainvaultcanarybody')
		).toBe(true);
		configure('public');
		const compiledPublished = await compileContent({
			siteDir: site,
			repoRoot: root,
			publicEdition: true
		});
		const published = JSON.parse(
			readFileSync(path.join(site, 'build/generated/content-manifest.json'), 'utf8')
		);
		expect(JSON.parse(JSON.stringify(compiledPublished))).toEqual(published);
		expect(published.pages['nested/note'].publication.public).toBe(true);
		expect(published.pages['nested/note'].locked).not.toBe(true);
		expect(readFileSync(hiddenDoc, 'utf8')).toContain('plainvaultcanarybody');
		expect(existsSync(path.join(site, 'build/generated/public-assets/picture.png'))).toBe(true);
		expect(sourceHashes()).toEqual(original);
		expect(existsSync(path.join(vault, '.git'))).toBe(false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}, 30_000);
