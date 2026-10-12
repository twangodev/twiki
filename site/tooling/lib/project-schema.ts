import { z } from 'zod';

const courseGroupSchema = z
	.strictObject({
		label: z.string().trim().min(1).describe('Heading shown above matching courses.'),
		courses: z.array(z.string().min(1)).optional().describe('Exact top-level course folder names.'),
		match: z
			.string()
			.min(1)
			.refine((pattern) => {
				try {
					new RegExp(pattern);
					return true;
				} catch {
					return false;
				}
			}, 'Must be a valid regular expression')
			.optional()
			.describe('Regular expression matched against course folder names.')
	})
	.refine(
		(group) => !!group.courses?.length || !!group.match,
		'A group needs courses or a match pattern'
	);

const groupingSchema = z.strictObject({
	mode: z
		.enum(['semester', 'patterns', 'none'])
		.default('semester')
		.describe('Semester grouping, ordered custom groups, or a flat course list.'),
	groups: z
		.array(courseGroupSchema)
		.default([])
		.describe('Custom groups in display order. The first matching group wins.'),
	fallback: z
		.string()
		.trim()
		.min(1)
		.default('Other')
		.describe('Heading for courses that do not match a group.')
});

export const navigationSchema = z.strictObject({
	mode: z
		.enum(['courses', 'sections'])
		.default('courses')
		.describe('Course navigation or general documentation sections.'),
	grouping: groupingSchema
		.default(groupingSchema.parse({}))
		.describe('Course grouping independent of folder organization.'),
	workspace: z.string().default('Workspace').describe('Navigation switcher caption.'),
	browse: z.string().default('Browse courses').describe('Navigation switcher label.'),
	find: z.string().default('Find a course').describe('Section search label.'),
	home: z.string().default('Workspace home').describe('Link to the vault home.'),
	all: z.string().default('All courses').describe('Unfiltered search label.')
});
const authorSchema = z.strictObject({
	name: z.string().default(''),
	url: z.string().default(''),
	github: z.string().default(''),
	email: z.string().default('')
});
export const siteSchema = z.strictObject({
	name: z.string().default('twiki').describe('Site name shown in navigation.'),
	title: z.string().default('twiki').describe('Default page title.'),
	url: z
		.url({ protocol: /^https?$/ })
		.default('http://localhost:5173')
		.describe('Canonical HTTP or HTTPS origin.'),
	description: z
		.string()
		.default('Notes, ideas, and reference material.')
		.describe('Default site description.'),
	author: authorSchema.default(authorSchema.parse({})).describe('Author attribution and links.'),
	locale: z.string().default('en_US').describe('Open Graph locale.'),
	language: z.string().default('en').describe('HTML language.'),
	navigation: navigationSchema
		.default(navigationSchema.parse({}))
		.describe('Navigation terminology and grouping.')
});
export const siteDefaults = siteSchema.parse({});
export const projectSchema = z
	.object({
		$schema: z
			.string()
			.optional()
			.describe('Optional JSON Schema URL or local path for editor completion.'),
		version: z.literal(1).describe('Configuration format version.'),
		contentDir: z
			.string()
			.min(1)
			.optional()
			.describe(
				'Content directory relative to the vault root. Explicit CLI projects default to the current directory.'
			),
		discovery: z
			.enum(['filesystem', 'git'])
			.optional()
			.describe(
				'File discovery. Explicit CLI projects default to filesystem; legacy workspaces default to git.'
			),
		publication: z
			.enum(['private', 'public', 'policies'])
			.optional()
			.describe(
				'Publication mode. Explicit CLI projects default to private. Static export requires public.'
			),
		site: siteSchema
			.partial()
			.extend({
				author: authorSchema.partial().optional(),
				navigation: navigationSchema.partial().optional()
			})
			.optional()
			.describe('Branding, canonical URL, author and navigation settings.'),
		cloudflare: z
			.record(z.string(), z.unknown())
			.optional()
			.describe(
				'Wrangler resource settings. Twiki supplies generated main and assets paths. Never put credentials here.'
			),
		analytics: z
			.strictObject({
				siteId: z.string(),
				scriptUrl: z.string().optional(),
				endpoint: z.string().optional()
			})
			.optional()
			.describe('Optional analytics site and endpoint. Disabled when omitted.')
	})
	.passthrough();
export type ProjectConfig = z.infer<typeof projectSchema>;
export type SiteMetadata = z.infer<typeof siteSchema>;
export type NavigationSettings = z.infer<typeof navigationSchema>;
export const projectJSONSchema = () =>
	z.toJSONSchema(projectSchema, { io: 'input', target: 'draft-07' });
