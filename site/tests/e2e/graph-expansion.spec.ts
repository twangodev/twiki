import { expect, test } from '@playwright/test';

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
	test(`graph expands its existing canvas and preserves zoom (${reducedMotion})`, async ({
		page
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.emulateMedia({ reducedMotion });
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await page.goto('/sp26-cs544/README');
		const graph = page.getByRole('img', { name: 'Knowledge graph' });
		await expect(graph).toHaveAttribute('data-graph-ready', 'true');
		const canvas = graph.locator('canvas');
		const original = await canvas.elementHandle();
		await canvas.dispatchEvent('wheel', { deltaY: -150, ctrlKey: true });
		const zoom = await canvas.evaluate(
			(el) => (el as HTMLCanvasElement & { __zoom: { k: number } }).__zoom.k
		);
		expect(zoom).toBeGreaterThan(1);
		const nodeCount = await graph.getAttribute('data-graph-nodes');
		await page.getByRole('button', { name: 'Expand graph' }).click();
		const fullscreen = page.getByRole('dialog', { name: 'Graph canvas' });
		await expect(fullscreen).toBeVisible();
		await expect.poll(async () => Math.round((await canvas.boundingBox())!.width)).toBe(1440);
		expect(await canvas.evaluate((el, original) => el === original, original)).toBe(true);
		expect(
			await canvas.evaluate((el) => (el as HTMLCanvasElement & { __zoom: { k: number } }).__zoom.k)
		).toBeCloseTo(zoom);
		await expect(graph).toHaveAttribute('data-graph-nodes', nodeCount!);
		await expect(fullscreen.getByRole('button', { name: 'Local', exact: true })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		await page.keyboard.press('Escape');
		await expect(fullscreen).toHaveCount(0);
		expect(await canvas.evaluate((el, original) => el === original, original)).toBe(true);
		await expect.poll(async () => Math.round((await canvas.boundingBox())!.height)).toBe(250);
		await expect(page.getByRole('button', { name: 'Expand graph' })).toBeFocused();
		expect(errors).toEqual([]);
	});
}

test('fullscreen graph switches scope and resizes without losing its canvas', async ({
	page,
	request
}) => {
	// Animation/zoom continuity is covered above in both motion modes. Keep this
	// test focused on the asynchronous global render and responsive resize.
	test.setTimeout(60_000);
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.setViewportSize({ width: 1440, height: 900 });
	const data: { nodes: { id: string; tags: string[] }[] } = await (
		await request.get('/graph.json')
	).json();
	const globalNodes = new Set(
		data.nodes.flatMap((node) => [node.id, ...node.tags.map((tag) => `tags/${tag}`)])
	);
	await page.goto('/sp26-cs544/README');
	const graph = page.getByRole('img', { name: 'Knowledge graph' });
	await expect(graph).toHaveAttribute('data-graph-ready', 'true', { timeout: 20_000 });
	await page.getByRole('button', { name: 'Expand graph' }).click();
	const fullscreen = page.getByRole('dialog', { name: 'Graph canvas' });
	await expect(fullscreen).toBeVisible();
	await fullscreen.getByRole('button', { name: 'Global', exact: true }).click();
	await expect(fullscreen.getByRole('button', { name: 'Global', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	// The count changes only once the new renderer has drawn its first frame.
	await expect(graph).toHaveAttribute('data-graph-nodes', String(globalNodes.size), {
		timeout: 20_000
	});
	await expect(graph).toHaveAttribute('data-graph-ready', 'true');
	const canvas = graph.locator('canvas');
	await expect(canvas).toHaveCount(1);
	const original = await canvas.elementHandle();
	await page.setViewportSize({ width: 1000, height: 700 });
	await expect
		.poll(async () => Math.round((await canvas.boundingBox())!.width), { timeout: 10_000 })
		.toBe(1000);
	expect(await canvas.evaluate((el, original) => el === original, original)).toBe(true);
	await fullscreen.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(fullscreen).toHaveCount(0);
	await expect(page.locator('html')).not.toHaveCSS('overflow', 'hidden');
});
test('graph and outline share the preview height token', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto('/sp26-cs544/README');
	await expect(page.getByRole('img', { name: 'Knowledge graph' })).toHaveAttribute(
		'data-graph-ready',
		'true'
	);
	await page.evaluate(() => {
		document.documentElement.style.setProperty('--graph-preview-height', '280px');
	});
	await expect(page.locator('[data-graph-outer]')).toHaveCSS('height', '280px');
	await expect(page.locator('[data-graph-outer] dialog')).toHaveCSS('height', '280px');
	await expect(page.locator('.doc-toc')).toHaveCSS('max-height', '620px');
	await expect(page.locator('[data-graph-outer] canvas')).toHaveCSS('height', '280px');
});

test('settled global graph wakes for zoom, hover, and resize', async ({ page }) => {
	test.setTimeout(30_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.route('**/graph.json', (route) =>
		route.fulfill({
			json: {
				nodes: [
					{ id: 'sp26-cs544/README', title: 'Current', tags: [] },
					{ id: 'neighbor', title: 'Neighbor', tags: [] },
					{ id: 'other', title: 'Other', tags: [] }
				],
				links: [
					{ source: 'sp26-cs544/README', target: 'neighbor' },
					{ source: 'other', target: 'other' }
				]
			}
		})
	);
	await page.addInitScript(() => {
		const state = { apps: [] as { app: import('pixi.js').Application; renders: number }[] };
		(window as unknown as { graphRenderTest: typeof state }).graphRenderTest = state;
		globalThis.__PIXI_APP_INIT__ = (app) => {
			if (!('stage' in app)) return;
			const entry = { app, renders: 0 };
			state.apps.push(entry);
			const original = app.renderer.render;
			app.renderer.render = new Proxy(original, {
				apply(target, receiver, args) {
					entry.renders++;
					return Reflect.apply(target, receiver, args);
				}
			});
		};
	});
	await page.goto('/sp26-cs544/README');
	const graph = page.getByRole('img', { name: 'Knowledge graph' });
	await expect(graph).toHaveAttribute('data-graph-ready', 'true');
	await page.getByRole('button', { name: 'Expand graph' }).click();
	const fullscreen = page.getByRole('dialog', { name: 'Graph canvas' });
	await fullscreen.getByRole('button', { name: 'Global', exact: true }).click();
	await expect(graph).toHaveAttribute('data-graph-nodes', '3');

	const renderCount = () =>
		page.evaluate(() => {
			const state = (window as unknown as { graphRenderTest: { apps: { renders: number }[] } })
				.graphRenderTest;
			return state.apps.at(-1)!.renders;
		});
	const expectIdle = async () => {
		await expect
			.poll(
				async () => {
					const before = await renderCount();
					await page.waitForTimeout(400);
					return (await renderCount()) - before;
				},
				{ timeout: 12_000 }
			)
			.toBe(0);
	};
	await expectIdle();
	expect(
		await page.evaluate(() => {
			const state = (
				window as unknown as {
					graphRenderTest: { apps: { app: import('pixi.js').Application }[] };
				}
			).graphRenderTest;
			const line = state.apps.at(-1)!.app.stage.children.find((child) => child.zIndex === 1)!
				.children[1];
			return {
				hidden: !line.renderable,
				finite: [line.x, line.y, line.rotation, line.scale.x, line.scale.y].every(Number.isFinite)
			};
		})
	).toEqual({ hidden: true, finite: true });
	const canvas = graph.locator('canvas');
	let before = await renderCount();
	await canvas.dispatchEvent('wheel', { deltaY: -150, clientX: 720, clientY: 450 });
	await expect.poll(renderCount).toBeGreaterThan(before);
	await expectIdle();

	const node = await page.evaluate(() => {
		const state = (
			window as unknown as {
				graphRenderTest: { apps: { app: import('pixi.js').Application }[] };
			}
		).graphRenderTest;
		const app = state.apps.at(-1)!.app;
		const graphics = app.stage.children.find((child) => child.zIndex === 2)!.children;
		const bounds = app.canvas.getBoundingClientRect();
		const visible = graphics
			.map((child) => {
				const point = child.getGlobalPosition();
				return { x: bounds.left + point.x, y: bounds.top + point.y, id: child.label };
			})
			.find(
				({ x, y }) =>
					x > 20 &&
					x < window.innerWidth - 20 &&
					y > 20 &&
					y < window.innerHeight - 20 &&
					document.elementFromPoint(x, y) === app.canvas
			);
		if (!visible) throw new Error('No graph node is visible for the hover test');
		return { ...visible, dimTarget: visible.id === 'other' ? 'neighbor' : 'other' };
	});
	before = await renderCount();
	await page.mouse.move(node.x, node.y);
	await expect.poll(renderCount).toBeGreaterThan(before);
	await page.mouse.move(0, 0);
	await page.mouse.move(node.x, node.y);
	await expect
		.poll(() =>
			page.evaluate((dimTarget) => {
				const state = (
					window as unknown as {
						graphRenderTest: { apps: { app: import('pixi.js').Application }[] };
					}
				).graphRenderTest;
				const graphics = state.apps
					.at(-1)!
					.app.stage.children.find((child) => child.zIndex === 2)!.children;
				return graphics.find((child) => child.label === dimTarget)!.alpha;
			}, node.dimTarget)
		)
		.toBeCloseTo(0.2, 1);
	const title = node.id === 'other' ? 'Other' : node.id === 'neighbor' ? 'Neighbor' : 'Current';
	await expect
		.poll(() =>
			page.evaluate((text) => {
				const state = (
					window as unknown as {
						graphRenderTest: { apps: { app: import('pixi.js').Application }[] };
					}
				).graphRenderTest;
				const labels = state.apps.at(-1)!.app.stage.children.find((child) => child.zIndex === 3)!
					.children as import('pixi.js').Text[];
				const label = labels.find((child) => child.text === text)!;
				return [label.alpha, label.scale.x];
			}, title)
		)
		.toEqual([1, 1.1 / 0.9]);
	await expectIdle();

	const dragNode = await page.evaluate(() => {
		const state = (
			window as unknown as {
				graphRenderTest: { apps: { app: import('pixi.js').Application }[] };
			}
		).graphRenderTest;
		const app = state.apps.at(-1)!.app;
		const bounds = app.canvas.getBoundingClientRect();
		const nodes = app.stage.children.find((child) => child.zIndex === 2)!.children;
		const visible = nodes
			.filter((child) => child.label !== 'other')
			.map((child) => {
				const point = child.getGlobalPosition();
				return { x: bounds.left + point.x, y: bounds.top + point.y, id: child.label };
			})
			.find(
				({ x, y }) =>
					x > 100 &&
					x < window.innerWidth - 100 &&
					y > 100 &&
					y < window.innerHeight - 100 &&
					document.elementFromPoint(x, y) === app.canvas
			);
		if (!visible) throw new Error('No linked graph node is visible for the drag test');
		return visible;
	});
	await page.mouse.move(dragNode.x, dragNode.y);
	await page.mouse.down();
	await page.waitForTimeout(550);
	await page.mouse.move(dragNode.x + 60, dragNode.y + 30, { steps: 3 });
	await expect
		.poll(() =>
			page
				.evaluate((id) => {
					const state = (
						window as unknown as {
							graphRenderTest: { apps: { app: import('pixi.js').Application }[] };
						}
					).graphRenderTest;
					const app = state.apps.at(-1)!.app;
					const nodes = app.stage.children.find((child) => child.zIndex === 2)!.children;
					const line = app.stage.children.find((child) => child.zIndex === 1)!.children[0];
					const source = nodes
						.find((child) => child.label === 'sp26-cs544/README')!
						.getGlobalPosition();
					const target = nodes.find((child) => child.label === 'neighbor')!.getGlobalPosition();
					const start = line.toGlobal({ x: 0, y: 0 });
					const end = line.toGlobal({ x: 1, y: 0 });
					const moved = nodes.find((child) => child.label === id)!.getGlobalPosition();
					const bounds = app.canvas.getBoundingClientRect();
					return {
						error: Math.max(
							Math.hypot(start.x - source.x, start.y - source.y),
							Math.hypot(end.x - target.x, end.y - target.y)
						),
						x: moved.x + bounds.left,
						y: moved.y + bounds.top
					};
				}, dragNode.id)
				.then(({ error, x, y }) => error < 0.01 && Math.hypot(x - dragNode.x, y - dragNode.y) > 10)
		)
		.toBe(true);
	await page.mouse.up();

	before = await renderCount();
	await page.setViewportSize({ width: 1000, height: 700 });
	await expect.poll(renderCount).toBeGreaterThan(before);
	await expectIdle();
});
