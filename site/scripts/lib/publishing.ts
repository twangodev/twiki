import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { parseGitmodules } from './lastmod';
import type { ContentLicense } from '../../src/lib/content-license';

export interface PublishPolicy {
	include: string[];
	exclude: string[];
	license?: ContentLicense;
}

function parseLicense(value: unknown): ContentLicense {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new Error('license must be a mapping');
	const fields = value as Record<string, unknown>;
	if (
		Object.keys(fields).some(
			(key) => !['name', 'url', 'attribution', 'source', 'changes'].includes(key)
		)
	)
		throw new Error('Unknown license field');
	for (const key of [
		'name',
		'url',
		'attribution',
		'source',
		...(Object.hasOwn(fields, 'changes') ? ['changes'] : [])
	]) {
		if (typeof fields[key] !== 'string' || !(fields[key] as string).trim())
			throw new Error(`license.${key} must be nonempty text`);
	}
	for (const key of ['url', 'source']) {
		const url = new URL(fields[key] as string);
		if (url.protocol !== 'https:' || url.username || url.password)
			throw new Error(`license.${key} must be an HTTPS URL without credentials`);
	}
	return fields as unknown as ContentLicense;
}

export function parsePublishPolicy(source: string): PublishPolicy {
	const document = parseDocument(source, { uniqueKeys: true, merge: false });
	if (document.errors.length || document.warnings.length)
		throw new Error(
			[...document.errors, ...document.warnings].map((error) => error.message).join('\n')
		);
	const value = document.toJS({ maxAliasCount: 0 });
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new Error('Expected a mapping with include and optional exclude lists');
	if (Object.keys(value).some((key) => !['include', 'exclude', 'license'].includes(key)))
		throw new Error('Only include, exclude, and license are supported');
	for (const key of ['include', 'exclude']) {
		const patterns = Object.hasOwn(value, key) ? value[key] : key === 'exclude' ? [] : undefined;
		if (!Array.isArray(patterns)) throw new Error(`${key} must be a list of paths`);
		for (const pattern of patterns) {
			if (
				typeof pattern !== 'string' ||
				!pattern ||
				/[\\\x00-\x1f\x7f{}\[\]()!:#]/.test(pattern) ||
				pattern
					.split('/')
					.some(
						(part: string) =>
							!part || part.startsWith('.') || (part.includes('**') && part !== '**')
					)
			)
				throw new Error(
					`Invalid ${key} pattern: ${JSON.stringify(pattern)}; use relative paths with *, **, or ?`
				);
		}
	}
	return {
		include: value.include,
		exclude: value.exclude ?? [],
		...(Object.hasOwn(value, 'license') ? { license: parseLicense(value.license) } : {})
	};
}

export function publicationDecision(file: string, policy?: PublishPolicy) {
	if (
		file
			.split('/')
			.some((segment) => !segment || segment.startsWith('.') || segment === 'publish.yaml') ||
		file.includes('\\')
	)
		return { public: false, reason: 'Reserved path' };
	if (!policy) return { public: false, reason: 'No publish.yaml' };
	const excluded = policy.exclude.find((pattern) => new Bun.Glob(pattern).match(file));
	if (excluded) return { public: false, reason: `Excluded by ${excluded}` };
	const included = policy.include.find((pattern) => new Bun.Glob(pattern).match(file));
	return included
		? { public: true, reason: `Included by ${included}` }
		: { public: false, reason: 'Not included' };
}

export function coursePolicies(repo: string) {
	const policies = new Map<string, PublishPolicy>();
	for (const course of parseGitmodules(path.join(repo, '.gitmodules'))) {
		if (!course.path.startsWith('content/')) continue;
		const file = path.join(course.fullPath, 'publish.yaml');
		if (!existsSync(file)) continue;
		try {
			if (!lstatSync(file).isFile() || realpathSync(file) !== file)
				throw new Error('Policy must be a regular file');
			execFileSync(
				'git',
				['-C', course.fullPath, 'ls-files', '--error-unmatch', '--', 'publish.yaml'],
				{ stdio: 'pipe' }
			);
			policies.set(course.path.slice(8), parsePublishPolicy(readFileSync(file, 'utf8')));
		} catch (error) {
			throw new Error(`${file}: invalid or untracked publication policy`, { cause: error });
		}
	}
	return policies;
}

export function publicationResolver(repo: string) {
	const policies = coursePolicies(repo);
	return (relative: string) => {
		const [course, ...segments] = relative.split('/');
		if (!segments.length)
			return {
				public: false,
				reason: 'Root notes are private; publish.yaml applies to course content.'
			};
		const decision = publicationDecision(segments.join('/'), policies.get(course));
		return { ...decision, reason: `${course}/publish.yaml: ${decision.reason}` };
	};
}

export function publicationFilter(repo: string) {
	const resolve = publicationResolver(repo);
	return (relative: string) => resolve(relative).public;
}

export function courseLicenseResolver(repo: string) {
	const policies = coursePolicies(repo);
	return (relative: string) => policies.get(relative.split('/')[0])?.license;
}
