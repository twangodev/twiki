import { expect, test } from '@playwright/test';

// Scrolling and branch tests need a long article with multiple nested sections.
const outlineArticle = '/sp26-cs544/debugging-autobadger';

test('responsive outlines share one heading measurement pass', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 600 });
	await page.goto('/');
	await expect(page.locator('.doc-toc a[aria-current="location"]')).toHaveCount(1);
	const reads = await page.evaluate(async () => {
		await new Promise(requestAnimationFrame);
		const counts: number[] = [];
		const headings = document.querySelectorAll<HTMLElement>('article :is(h1,h2,h3,h4,h5,h6)[id]');
		for (const [index, heading] of [...headings].entries()) {
			counts[index] = 0;
			const measure = heading.getBoundingClientRect.bind(heading);
			heading.getBoundingClientRect = () => {
				counts[index]++;
				return measure();
			};
		}
		window.dispatchEvent(new Event('scroll'));
		await new Promise(requestAnimationFrame);
		return counts;
	});
	expect(Math.max(...reads)).toBe(1);
});

test('outline follows with one smooth scroll and reaches its target', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 500 });
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await page.goto(outlineArticle);
	await page.locator('.doc-toc').getByRole('button', { name: 'Expand all', exact: true }).click();
	const toc = page.locator('.doc-toc');
	await expect
		.poll(() =>
			toc.evaluate(
				(el) =>
					el
						.getAnimations({ subtree: true })
						.filter((animation) => animation.playState === 'running').length
			)
		)
		.toBe(0);
	await expect.poll(() => toc.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
	await toc.evaluate((element) => {
		const viewport = element as HTMLElement;
		const calls: ScrollToOptions[] = [];
		const scrollTo = viewport.scrollTo.bind(viewport);
		Object.defineProperty(viewport, 'scrollTo', {
			value: (options: ScrollToOptions) => {
				if (viewport.querySelector('a[href="#using-s-step-into"][aria-current="location"]')) {
					calls.push(options);
					viewport.dataset.scrollCalls = JSON.stringify(calls);
				}
				scrollTo(options);
			}
		});
	});
	await page.evaluate(() => {
		const heading = document.getElementById('using-s-step-into')!;
		window.scrollTo({
			top: window.scrollY + heading.getBoundingClientRect().top - 100,
			behavior: 'instant'
		});
	});
	await expect(toc.locator('a[href="#using-s-step-into"]')).toHaveAttribute(
		'aria-current',
		'location'
	);
	await expect(toc).toHaveAttribute('data-scroll-calls', /smooth/);
	await expect
		.poll(() =>
			toc.evaluate((element) => {
				const viewport = element as HTMLElement;
				const [call] = JSON.parse(viewport.dataset.scrollCalls!) as ScrollToOptions[];
				const target = Math.min(call.top!, viewport.scrollHeight - viewport.clientHeight);
				return Math.abs(viewport.scrollTop - target);
			})
		)
		.toBeLessThan(1);
	const calls = await toc.evaluate((el) => JSON.parse((el as HTMLElement).dataset.scrollCalls!));
	expect(calls).toEqual([{ behavior: 'smooth', top: expect.any(Number) }]);
	expect(calls[0].top).toBeGreaterThan(0);
	const viewport = (await toc.boundingBox())!;
	const active = (await toc.locator('a[href="#using-s-step-into"]').boundingBox())!;
	expect(active.y).toBeGreaterThanOrEqual(viewport.y);
	expect(active.y + active.height).toBeLessThanOrEqual(viewport.y + viewport.height);
});

test('active outline row follows reading within its own scroll viewport', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 500 });
	await page.goto(outlineArticle);
	const toc = page.locator('.doc-toc');
	await toc.getByRole('button', { name: 'Expand all', exact: true }).click();
	await expect.poll(() => toc.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
	for (const id of ['using-s-step-into', 'using-pip']) {
		const articleScroll = await page.evaluate((id) => {
			window.scrollTo({
				top: window.scrollY + document.getElementById(id)!.getBoundingClientRect().top - 100,
				behavior: 'instant'
			});
			return window.scrollY;
		}, id);
		const active = toc.locator(`a[href="#${id}"]`);
		await expect(active).toHaveAttribute('aria-current', 'location');
		await expect
			.poll(async () => {
				const bounds = (await toc.boundingBox())!;
				const row = (await active.boundingBox())!;
				return row.y >= bounds.y && row.y + row.height <= bounds.y + bounds.height;
			})
			.toBe(true);
		expect(await page.evaluate(() => window.scrollY)).toBe(articleScroll);
		await expect
			.poll(async () => {
				const bounds = (await toc.boundingBox())!;
				const marker = (await toc.locator('.position-marker').boundingBox())!;
				return marker.y >= bounds.y && marker.y + marker.height <= bounds.y + bounds.height;
			})
			.toBe(true);
	}
	await expect(page.locator('[data-graph-outer]')).toBeInViewport();
});

test('deep headings remain reachable without an ever-widening indent', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto('/sp26-cs544/debugging-autobadger');
	const toc = page.locator('.doc-toc nav');
	await toc.getByRole('button', { name: 'Expand all', exact: true }).click();
	const heading = page.locator('article h6').first();
	const id = await heading.getAttribute('id');
	expect(id).toBeTruthy();
	const link = toc.locator(`a[href="#${id}"]`);
	await expect(link).toBeVisible();
	const nestedGuides = await link.evaluate((element) => {
		let count = 0;
		for (let parent = element.parentElement; parent; parent = parent.parentElement) {
			if (parent.matches('ul.nested')) count++;
		}
		return count;
	});
	expect(nestedGuides).toBeLessThanOrEqual(2);
	await link.click();
	await expect(page).toHaveURL(new RegExp(`#${id}$`));

	await page.goto('/fa25-anthro105/lectures/lecture-6');
	await toc.getByRole('button', { name: 'Expand all', exact: true }).click();
	const deepest = toc.getByRole('link', { name: 'Genetic Structure', exact: true });
	await expect(deepest).toBeVisible();
	await expect(toc.locator('.parent-context').first()).toContainText('Key Terminology');
	expect(
		await deepest.evaluate((element) => {
			let count = 0;
			for (let parent = element.parentElement; parent; parent = parent.parentElement) {
				if (parent.matches('ul.nested')) count++;
			}
			return count;
		})
	).toBe(2);
});

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
	test(`focus outline follows reading and preserves manual branches (${reducedMotion})`, async ({
		page
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.emulateMedia({ reducedMotion });
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await page.goto(outlineArticle);
		const toc = page.locator('.doc-toc nav');
		const changes = toc.getByRole('button', {
			name: 'Toggle Making Changes sections',
			exact: true
		});
		const breakpoints = toc.getByRole('button', {
			name: 'Toggle Breakpoints sections',
			exact: true
		});
		await expect(changes).toHaveAttribute('aria-expanded', 'false');
		await expect(toc.getByRole('link', { name: 'Using pip', exact: true })).toHaveCount(0);

		async function readSection(id: string) {
			await page.evaluate((id) => {
				const heading = document.getElementById(id)!;
				window.scrollTo({
					top: window.scrollY + heading.getBoundingClientRect().top - 100,
					behavior: 'instant'
				});
			}, id);
			await expect
				.poll(() =>
					toc
						.locator('a[aria-current="location"]')
						.evaluateAll((links) => links.map((link) => link.getAttribute('href')))
				)
				.toEqual([`#${id}`]);
		}
		await readSection('using-pip');
		await expect(changes).toHaveAttribute('aria-expanded', 'true');
		await readSection('what-is-a-breakpoint');
		await expect(changes).toHaveAttribute('aria-expanded', 'false');
		await expect(breakpoints).toHaveAttribute('aria-expanded', 'true');
		await toc.getByRole('link', { name: 'What is a breakpoint?', exact: true }).focus();
		await readSection('using-breakpoints');
		await expect(breakpoints).toHaveAttribute('aria-expanded', 'true');
		await expect(
			toc.getByRole('link', { name: 'What is a breakpoint?', exact: true })
		).toBeFocused();
		await changes.click();
		await readSection('using-breakpoints');
		await expect(changes).toHaveAttribute('aria-expanded', 'true');
		await expect(breakpoints).toHaveAttribute('aria-expanded', 'false');

		await toc.getByRole('button', { name: 'Expand all', exact: true }).click();
		await expect(
			toc.getByRole('link', { name: 'What is a breakpoint?', exact: true })
		).toBeVisible();
		await toc.getByRole('link', { name: 'Using pip', exact: true }).focus();
		await readSection('what-is-a-breakpoint');
		await expect(toc.getByRole('link', { name: 'Using pip', exact: true })).toBeFocused();
		await toc.getByRole('button', { name: 'Focus', exact: true }).click();
		await expect(changes).toHaveAttribute('aria-expanded', 'false');
		await expect(breakpoints).toHaveAttribute('aria-expanded', 'true');
		await expect(toc.locator('.position-marker')).toHaveCSS('opacity', '1');
		expect(errors).toEqual([]);
	});
}
