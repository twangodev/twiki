import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { createHash } from 'node:crypto';
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import path from 'node:path';
import type { ContentManifest, ManifestPage } from '../../src/lib/types';
import { site } from '../../src/lib/config';
import { socialImagePath, socialImageSize } from '../../src/lib/social-image';

const fontPath = path.resolve(
	import.meta.dirname,
	'../../assets/fonts/OverusedGrotesk-SemiBold.ttf'
);
const font = readFileSync(fontPath);
const background = readFileSync(
	path.resolve(import.meta.dirname, '../../assets/social-background.svg')
);
const backgroundImage = `data:image/svg+xml;base64,${background.toString('base64')}`;
const rendererKey = createHash('sha256')
	.update(readFileSync(import.meta.filename))
	.update(readFileSync(path.resolve(import.meta.dirname, '../../bun.lock')))
	.update(JSON.stringify({ site, socialImageSize }))
	.update(font)
	.update(background)
	.digest('hex');

interface SocialCard {
	title: string;
	subtitle?: string;
	label: string;
}

function shorten(text: string, length: number) {
	const normalized = text.replace(/\s+/g, ' ').trim();
	return normalized.length <= length ? normalized : normalized.slice(0, length - 1).trimEnd() + '…';
}

export async function renderSocialImage(card: SocialCard) {
	const title = shorten(card.title, 200);
	const svg = await satori(
		{
			type: 'div',
			props: {
				style: {
					position: 'relative',
					overflow: 'hidden',
					display: 'flex',
					flexDirection: 'column',
					width: '100%',
					height: '100%',
					background: '#1a1916',
					color: '#e8e5df',
					padding: '64px 72px',
					fontFamily: 'Overused Grotesk',
					fontWeight: 600
				},
				children: [
					{
						type: 'img',
						props: {
							src: backgroundImage,
							width: socialImageSize.width,
							height: socialImageSize.height,
							style: { position: 'absolute', top: 0, left: 0 }
						}
					},
					{
						type: 'div',
						props: {
							style: { color: '#e68578', fontSize: 24 },
							children: shorten(card.label, 70)
						}
					},
					{
						type: 'div',
						props: {
							style: {
								display: 'flex',
								flex: 1,
								flexDirection: 'column',
								justifyContent: 'center'
							},
							children: [
								{
									type: 'div',
									props: {
										style: {
											fontSize: title.length > 130 ? 48 : title.length > 80 ? 60 : 80,
											lineHeight: 1.08,
											letterSpacing: '-1.5px',
											overflowWrap: 'anywhere'
										},
										children: title
									}
								},
								{
									type: 'div',
									props: {
										style: { marginTop: 24, fontSize: 26, color: '#7a7568' },
										children: shorten(card.subtitle ?? '', 90)
									}
								}
							]
						}
					},
					{
						type: 'div',
						props: {
							style: {
								display: 'flex',
								justifyContent: 'space-between',
								fontSize: 20,
								color: '#7a7568'
							},
							children: [
								{ type: 'span', props: { children: site.name } },
								{ type: 'span', props: { children: new URL(site.url).host } }
							]
						}
					}
				]
			}
		},
		{
			...socialImageSize,
			fonts: [{ name: 'Overused Grotesk', data: font, weight: 600, style: 'normal' }]
		}
	);
	return new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng();
}

function courseLabel(slug: string) {
	const course = slug.split('/')[0];
	const match = /^(sp|su|fa|wi)(\d{2})-(.+)$/.exec(course);
	if (!match) return course === 'des-inv' ? 'Design Innovation Lab' : 'Course notes';
	const term = { sp: 'Spring', su: 'Summer', fa: 'Fall', wi: 'Winter' }[match[1]];
	const code = match[3].replace(/([a-z])(\d)/, '$1 $2').toUpperCase();
	return `${code} · ${term} 20${match[2]}`;
}

export function socialCard(
	page: Pick<ManifestPage, 'slug' | 'title' | 'heading' | 'relativePath'>
) {
	return {
		slug: page.slug,
		title: page.heading?.trim() || page.title,
		subtitle: path.posix.basename(page.relativePath),
		label: courseLabel(page.slug)
	};
}

export async function buildSocialImages(siteDir: string, manifest: Pick<ContentManifest, 'pages'>) {
	const output = path.join(siteDir, 'static/_og');
	const cache = path.join(siteDir, '.generated/cache/social-titles');
	mkdirSync(output, { recursive: true });
	mkdirSync(cache, { recursive: true });
	const wanted = new Set<string>();
	let rendered = 0;
	const cards = [
		{ slug: undefined, title: 'Notes from UW–Madison.', label: 'Course notes' },
		...Object.values(manifest.pages).map(socialCard)
	];
	for (const card of cards) {
		const key = createHash('sha256').update(rendererKey).update(JSON.stringify(card)).digest('hex');
		const cached = path.join(cache, key + '.png');
		if (!existsSync(cached)) {
			writeFileSync(cached, await renderSocialImage(card));
			rendered++;
		}
		const destination = path.join(
			siteDir,
			'static',
			decodeURIComponent(socialImagePath(card.slug))
		);
		mkdirSync(path.dirname(destination), { recursive: true });
		wanted.add(destination);
		if (!existsSync(destination) || !readFileSync(destination).equals(readFileSync(cached)))
			copyFileSync(cached, destination);
	}
	for (const file of readdirSync(output, { recursive: true, withFileTypes: true })) {
		const filename = path.join(file.parentPath, file.name);
		if (file.isFile() && !wanted.has(filename)) rmSync(filename);
	}
	console.log(
		`social images: ${cards.length} title-only cards (${rendered} rendered, ${cards.length - rendered} cached)`
	);
}
