/**
 * Directory-derived AutoTag, ported verbatim from the wisconsin Quartz fork's
 * `quartz/plugins/transformers/autotag.ts`, minus the Quartz plugin wrapper.
 *
 * Config matches quartz.config.ts: enabled, excludePaths ["assets", "des-inv"],
 * customMapping {}.
 */
import { slugTag } from './slug';

export interface AutoTagOptions {
	excludePaths?: string[];
	customMapping?: Record<string, string>;
}

export const QUARTZ_AUTOTAG_OPTIONS: AutoTagOptions = {
	excludePaths: ['assets', 'des-inv'],
	customMapping: {}
};

interface TagStrategy {
	tag: string;
	scope: 'global' | 'immediate'; // global applies to all descendants, immediate only to direct children
}

function extractCourseCode(directory: string): string {
	return directory.includes('-') ? directory.substring(directory.lastIndexOf('-') + 1) : directory;
}

function extractTerm(directory: string): string | null {
	return directory.includes('-') ? directory.substring(0, directory.indexOf('-')) : null;
}

function extractSubject(courseCode: string): string | null {
	const match = courseCode.match(/^[a-z]+/i);
	return match ? match[0] : null;
}

function generateTagStrategies(
	directory: string,
	customMapping?: Record<string, string>
): TagStrategy[] {
	const strategies: TagStrategy[] = [];
	const courseCode = customMapping?.[directory] || extractCourseCode(directory);

	// Course code tag is global - applies to all nested content
	strategies.push({ tag: slugTag(courseCode), scope: 'global' });

	// Term tag only applies to immediate children
	const term = extractTerm(directory);
	if (term) {
		strategies.push({ tag: slugTag(term), scope: 'immediate' });
	}

	// Subject tag only applies to immediate children
	const subject = extractSubject(courseCode);
	if (subject && subject !== courseCode) {
		strategies.push({ tag: slugTag(subject), scope: 'immediate' });
	}

	return strategies;
}

/**
 * Returns the auto tags for a page given its path relative to content/
 * (e.g. "sp26-cs537/p1/README.md"). The caller appends them to the page's
 * existing tags, deduped, in order — same as the fork.
 */
export function autoTagsFor(
	relativePath: string,
	opts: AutoTagOptions = QUARTZ_AUTOTAG_OPTIONS
): string[] {
	const pathSegments = relativePath.split('/');
	if (pathSegments.length < 2) return [];

	const firstDir = pathSegments[0];
	if (opts.excludePaths?.includes(firstDir)) return [];

	// Check if this is an immediate child (only 2 segments) or nested deeper
	const isImmediateChild = pathSegments.length === 2;

	// Generate tag strategies for this directory
	const strategies = generateTagStrategies(firstDir, opts.customMapping);

	// Filter strategies based on scope
	return strategies
		.filter((s) => s.scope === 'global' || (s.scope === 'immediate' && isImmediateChild))
		.map((s) => s.tag);
}

/** fork behavior: append new tags after existing ones, skipping duplicates */
export function applyAutoTags(
	existingTags: string[],
	relativePath: string,
	opts?: AutoTagOptions
): string[] {
	const applicableTags = autoTagsFor(relativePath, opts);
	const newTags = applicableTags.filter((tag) => !existingTags.includes(tag));
	return [...existingTags, ...newTags];
}
