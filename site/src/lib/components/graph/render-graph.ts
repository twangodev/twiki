/**
 * Faithful port of Quartz's graph renderer
 * (quartz/components/scripts/graph.inline.ts @ repo root) to the SvelteKit
 * site: pixi.js draws, d3-force simulates (and keeps simulating — drag
 * reheats it via the alphaTarget pattern), d3-zoom/d3-drag handle
 * interaction, @tweenjs/tween.js animates the hover highlights. Same stack,
 * same parameters, same behavior.
 *
 * This module is only ever loaded via dynamic `import()` from
 * GraphView.svelte, so pixi + d3 + tween stay out of the initial bundle.
 *
 * Intentional deviations from the original (all mechanical, not behavioral):
 * - Data comes from /graph.json (display-form ids) instead of Quartz's
 *   contentIndex, and navigation goes through a callback (SvelteKit `goto`)
 *   instead of window.spaNavigate.
 * - Link construction and neighbourhood traversal retain Quartz's observable
 *   ordering (d3-force seeds nodes by index); only final node lookup uses a Map
 *   instead of repeated Array.find calls.
 * - Quartz re-renders on its custom `themechange` event; here GraphView
 *   re-runs renderGraph when `:root`'s class list changes (MutationObserver).
 * - Pixi uses its stable WebGL backend instead of preferring experimental
 *   WebGPU; the rendered scene is otherwise the same and works on browsers
 *   without a usable WebGPU adapter.
 * - The local graph anchors the page being read at the simulation origin so
 *   dense two-hop neighborhoods cannot push it outside the preview.
 * - Cleanup also stops the d3 simulation timer (Quartz leaves it to decay).
 */
import { Group as TweenGroup, Tween as Tweened } from '@tweenjs/tween.js';
import { drag } from 'd3-drag';
import {
	forceCenter,
	forceCollide,
	forceLink,
	forceManyBody,
	forceRadial,
	forceSimulation,
	type Simulation,
	type SimulationLinkDatum,
	type SimulationNodeDatum
} from 'd3-force';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom';
import { Application, Circle, Container, Graphics, GraphicsContext, Text } from 'pixi.js';
import { getVisited, type GraphConfig, type GraphData } from './graph-data';
import { canvasPosition, orderedGraphElements } from './graph-model';

type GraphicsInfo = {
	color: string;
	gfx: Graphics;
	alpha: number;
	active: boolean;
};

type NodeData = {
	id: string;
	text: string;
	tags: string[];
} & SimulationNodeDatum;

type LinkData = {
	source: NodeData;
	target: NodeData;
} & SimulationLinkDatum<NodeData>;

type LinkRenderData = GraphicsInfo & {
	simulationData: LinkData;
};

type NodeRenderData = GraphicsInfo & {
	simulationData: NodeData;
	label: Text;
};

type TweenNode = {
	update: (time: number) => void;
	stop: () => void;
};

/**
 * Quartz reads its theme palette straight off :root (--secondary, --tertiary,
 * --gray, --light, --lightgray, --dark, --bodyFont). This site's tokens
 * (site/src/routes/layout.css) play the equivalent roles:
 *
 *   --secondary (current node)           → --color-accent
 *   --tertiary  (visited node, tag ring) → accent softened toward muted
 *   --gray      (unvisited node fill)    → --color-muted
 *   --light     (tag node fill)          → --color-bg
 *   --lightgray (link lines)             → --color-subtle
 *   --dark      (label text)             → --color-text
 *   --bodyFont                           → body font-family
 *
 * Colors are resolved through a probe element so any CSS color syntax the
 * tokens use ends up as an rgb() string pixi can parse.
 */
function resolveThemeColors() {
	const probe = document.createElement('span');
	probe.style.position = 'absolute';
	probe.style.visibility = 'hidden';
	document.body.appendChild(probe);
	const resolve = (expr: string): string => {
		probe.style.color = '';
		probe.style.color = expr;
		return getComputedStyle(probe).color;
	};
	// channel-wise mix of two resolved rgb()/rgba() strings
	const mix = (a: string, b: string, t: number): string => {
		const pa = a.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
		const pb = b.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
		const c = [0, 1, 2].map((i) => Math.round((pa[i] ?? 0) * (1 - t) + (pb[i] ?? 0) * t));
		return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
	};
	const accent = resolve('var(--color-accent)');
	const muted = resolve('var(--color-muted)');
	const map = {
		'--secondary': accent,
		'--tertiary': mix(accent, muted, 0.4),
		'--gray': muted,
		'--light': resolve('var(--color-bg)'),
		'--lightgray': resolve('var(--color-subtle)'),
		'--dark': resolve('var(--color-text)'),
		'--bodyFont': getComputedStyle(document.body).fontFamily
	};
	probe.remove();
	return map;
}

export async function renderGraph(
	graph: HTMLElement,
	fullData: GraphData,
	slug: string | undefined,
	cfg: GraphConfig,
	isGlobalGraph: boolean,
	navigate: (id: string) => void
): Promise<() => void> {
	const visited = getVisited();
	graph.replaceChildren();
	graph.dataset.graphReady = 'false';

	const {
		drag: enableDrag,
		zoom: enableZoom,
		scale,
		repelForce,
		centerForce,
		linkDistance,
		fontSize,
		opacityScale,
		removeTags,
		showTags,
		focusOnHover,
		enableRadial,
		centerCurrentNode
	} = cfg;
	const data = new Map(fullData.nodes.map((n) => [n.id, n]));
	const tweens = new Map<string, TweenNode>();
	const selected = orderedGraphElements(fullData, slug, {
		depth: cfg.depth,
		showTags,
		removeTags
	});
	const nodes: NodeData[] = selected.nodeIds.map((url) => {
		const text = url.startsWith('tags/') ? '#' + url.substring(5) : (data.get(url)?.title ?? url);
		return {
			id: url,
			text,
			tags: data.get(url)?.tags ?? []
		};
	});
	const nodeById = new Map(nodes.map((n) => [n.id, n]));
	const graphData: { nodes: NodeData[]; links: LinkData[] } = {
		nodes,
		links: selected.links.map((l) => ({
			source: nodeById.get(l.source)!,
			target: nodeById.get(l.target)!
		}))
	};
	const degrees = new Map<string, number>();
	for (const { source, target } of graphData.links) {
		degrees.set(source.id, (degrees.get(source.id) ?? 0) + 1);
		if (source.id !== target.id) degrees.set(target.id, (degrees.get(target.id) ?? 0) + 1);
	}
	const centeredNode = centerCurrentNode && slug !== undefined ? nodeById.get(slug) : undefined;
	if (centeredNode) {
		centeredNode.fx = 0;
		centeredNode.fy = 0;
	}

	let width = graph.offsetWidth;
	const previewHeight = Number.parseFloat(
		getComputedStyle(graph).getPropertyValue('--graph-preview-height')
	);
	let height = Math.max(graph.offsetHeight, previewHeight || 1);

	// we virtualize the simulation and use pixi to actually render it
	const simulation: Simulation<NodeData, LinkData> = forceSimulation<NodeData>(graphData.nodes)
		.force('charge', forceManyBody().strength(-100 * repelForce))
		.force('center', forceCenter().strength(centerForce))
		.force('link', forceLink(graphData.links).distance(linkDistance))
		.force('collide', forceCollide<NodeData>((n) => nodeRadius(n)).iterations(3));
	const radius = (Math.min(width, height) / 2) * 0.8;
	if (enableRadial) simulation.force('radial', forceRadial(radius).strength(0.2));

	// precompute style prop strings as pixi doesn't support css variables
	const computedStyleMap = resolveThemeColors();

	// calculate color
	const color = (d: NodeData) => {
		const isCurrent = d.id === slug;
		if (isCurrent) {
			return computedStyleMap['--secondary'];
		} else if (visited.has(d.id) || d.id.startsWith('tags/')) {
			return computedStyleMap['--tertiary'];
		} else {
			return computedStyleMap['--gray'];
		}
	};

	function nodeRadius(d: NodeData) {
		return 2 + Math.sqrt(degrees.get(d.id) ?? 0);
	}

	let hoveredNodeId: string | null = null;
	const linkRenderData: LinkRenderData[] = [];
	const nodeRenderData: NodeRenderData[] = [];
	const nodeRenderById = new Map<string, NodeRenderData>();
	const incidentLinks = new Map<string, LinkRenderData[]>();
	let activeLinks: LinkRenderData[] = [];
	let activeNodes: NodeRenderData[] = [];
	function updateHoverInfo(newHoveredId: string | null) {
		hoveredNodeId = newHoveredId;
		for (const link of activeLinks) link.active = false;
		for (const node of activeNodes) node.active = false;
		activeLinks = newHoveredId === null ? [] : (incidentLinks.get(newHoveredId) ?? []);
		activeNodes = [];
		for (const link of activeLinks) {
			link.active = true;
			for (const endpoint of [link.simulationData.source, link.simulationData.target]) {
				const node = nodeRenderById.get(endpoint.id)!;
				if (!node.active) {
					node.active = true;
					activeNodes.push(node);
				}
			}
		}
	}

	let dragStartTime = 0;
	let dragging = false;

	function animateChanges(key: string, duration: number, update: (progress: number) => void) {
		tweens.get(key)?.stop();
		const group = new TweenGroup();
		const progress = { value: 0 };
		group.add(
			new Tweened(progress).to({ value: 1 }, duration).onUpdate(() => update(progress.value))
		);
		group.getAll().forEach((tween) => tween.start());
		tweens.set(key, {
			update: group.update.bind(group),
			stop() {
				group.getAll().forEach((tween) => tween.stop());
			}
		});
	}

	function renderLinks() {
		const changes: { link: LinkRenderData; start: number; end: number }[] = [];
		for (const link of linkRenderData) {
			const end = hoveredNodeId ? (link.active ? 1 : 0.2) : 1;
			const color = link.active ? computedStyleMap['--gray'] : computedStyleMap['--lightgray'];
			if (link.color !== color) {
				link.color = color;
				link.gfx.tint = color;
			}
			if (link.alpha !== end) changes.push({ link, start: link.alpha, end });
		}
		animateChanges('link', 200, (progress) => {
			for (const { link, start, end } of changes) {
				link.alpha = start + (end - start) * progress;
				link.gfx.alpha = link.alpha;
			}
		});
	}

	const scaledLabels = new Set<NodeRenderData>();
	function renderLabels() {
		const defaultScale = 1 / scale;
		const hovered = hoveredNodeId === null ? undefined : nodeRenderById.get(hoveredNodeId);
		const candidates = new Set(scaledLabels);
		if (hovered) candidates.add(hovered);
		scaledLabels.clear();
		if (hovered) scaledLabels.add(hovered);
		const changes = [...candidates].map((node) => {
			const label = node.label;
			const targetScale = node === hovered ? defaultScale * 1.1 : defaultScale;
			if (label.scale.x !== targetScale || label.scale.y !== targetScale) scaledLabels.add(node);
			return {
				label,
				startAlpha: label.alpha,
				endAlpha: node === hovered ? 1 : label.alpha,
				startX: label.scale.x,
				startY: label.scale.y,
				targetScale,
				animateAlpha: node === hovered
			};
		});
		animateChanges('label', 100, (progress) => {
			for (const change of changes) {
				if (change.animateAlpha) {
					change.label.alpha = change.startAlpha + (change.endAlpha - change.startAlpha) * progress;
				}
				change.label.scale.set(
					change.startX + (change.targetScale - change.startX) * progress,
					change.startY + (change.targetScale - change.startY) * progress
				);
			}
		});
	}

	function renderNodes() {
		const changes: { node: NodeRenderData; start: number; end: number }[] = [];
		for (const node of nodeRenderData) {
			const end = hoveredNodeId !== null && focusOnHover && !node.active ? 0.2 : 1;
			if (node.gfx.alpha !== end) changes.push({ node, start: node.gfx.alpha, end });
		}
		animateChanges('hover', 200, (progress) => {
			for (const { node, start, end } of changes) {
				node.gfx.alpha = start + (end - start) * progress;
			}
		});
	}

	function renderPixiFromD3() {
		renderNodes();
		renderLinks();
		renderLabels();
		tweenUntil = performance.now() + 220;
		requestFrame();
	}

	tweens.forEach((tween) => tween.stop());
	tweens.clear();

	const app = new Application();
	await app.init({
		width,
		height,
		antialias: true,
		autoStart: false,
		autoDensity: true,
		backgroundAlpha: 0,
		preference: 'webgl',
		resolution: window.devicePixelRatio,
		eventMode: 'static'
	});
	graph.appendChild(app.canvas);

	let destroyed = false;
	let animationFrame = 0;
	let geometryDirty = true;
	let tweenUntil = 0;
	function requestFrame() {
		if (!destroyed && !animationFrame) animationFrame = requestAnimationFrame(animate);
	}

	const stage = app.stage;
	stage.interactive = false;

	const labelsContainer = new Container<Text>({ zIndex: 3, isRenderGroup: true });
	const nodesContainer = new Container<Graphics>({ zIndex: 2, isRenderGroup: true });
	const linkContainer = new Container<Graphics>({ zIndex: 1, isRenderGroup: true });
	stage.addChild(nodesContainer, labelsContainer, linkContainer);

	for (const n of graphData.nodes) {
		const nodeId = n.id;

		const label = new Text({
			interactive: false,
			eventMode: 'none',
			text: n.text,
			alpha: 0,
			anchor: { x: 0.5, y: 1.2 },
			style: {
				fontSize: fontSize * 15,
				fill: computedStyleMap['--dark'],
				fontFamily: computedStyleMap['--bodyFont']
			},
			resolution: window.devicePixelRatio * 4
		});
		label.scale.set(1 / scale);

		let oldLabelOpacity = 0;
		const isTagNode = nodeId.startsWith('tags/');
		const gfx = new Graphics({
			interactive: true,
			label: nodeId,
			eventMode: 'static',
			hitArea: new Circle(0, 0, nodeRadius(n)),
			cursor: 'pointer'
		})
			.circle(0, 0, nodeRadius(n))
			.fill({ color: isTagNode ? computedStyleMap['--light'] : color(n) })
			.on('pointerover', (e) => {
				updateHoverInfo(e.target.label);
				oldLabelOpacity = label.alpha;
				if (!dragging) {
					renderPixiFromD3();
				}
			})
			.on('pointerleave', () => {
				updateHoverInfo(null);
				label.alpha = oldLabelOpacity;
				requestFrame();
				if (!dragging) {
					renderPixiFromD3();
				}
			});

		if (isTagNode) {
			gfx.stroke({ width: 2, color: computedStyleMap['--tertiary'] });
		}

		nodesContainer.addChild(gfx);
		labelsContainer.addChild(label);

		const nodeRenderDatum: NodeRenderData = {
			simulationData: n,
			gfx,
			label,
			color: color(n),
			alpha: 1,
			active: false
		};

		nodeRenderData.push(nodeRenderDatum);
		nodeRenderById.set(nodeId, nodeRenderDatum);
	}

	const linkContext = new GraphicsContext()
		.moveTo(0, 0)
		.lineTo(1, 0)
		.stroke({ width: 1, color: 'white' });
	for (const l of graphData.links) {
		const gfx = new Graphics({
			context: linkContext,
			interactive: false,
			eventMode: 'none',
			tint: computedStyleMap['--lightgray']
		});
		linkContainer.addChild(gfx);

		const linkRenderDatum: LinkRenderData = {
			simulationData: l,
			gfx,
			color: computedStyleMap['--lightgray'],
			alpha: 1,
			active: false
		};

		linkRenderData.push(linkRenderDatum);
		for (const id of new Set([l.source.id, l.target.id])) {
			const links = incidentLinks.get(id);
			if (links) links.push(linkRenderDatum);
			else incidentLinks.set(id, [linkRenderDatum]);
		}
	}

	let currentTransform = zoomIdentity;
	if (enableDrag) {
		select<HTMLCanvasElement, NodeData | undefined>(app.canvas).call(
			drag<HTMLCanvasElement, NodeData | undefined>()
				.container(() => app.canvas)
				.subject(() => (hoveredNodeId === null ? undefined : nodeById.get(hoveredNodeId)))
				.on('start', function dragstarted(event) {
					if (!event.active) simulation.alphaTarget(1).restart();
					event.subject.fx = event.subject.x;
					event.subject.fy = event.subject.y;
					event.subject.__initialDragPos = {
						x: event.subject.x,
						y: event.subject.y,
						fx: event.subject.fx,
						fy: event.subject.fy
					};
					dragStartTime = Date.now();
					dragging = true;
				})
				.on('drag', function dragged(event) {
					const initPos = event.subject.__initialDragPos;
					event.subject.fx = initPos.x + (event.x - initPos.x) / currentTransform.k;
					event.subject.fy = initPos.y + (event.y - initPos.y) / currentTransform.k;
				})
				.on('end', function dragended(event) {
					if (!event.active) simulation.alphaTarget(0);
					if (event.subject === centeredNode) {
						event.subject.fx = 0;
						event.subject.fy = 0;
					} else {
						event.subject.fx = null;
						event.subject.fy = null;
					}
					dragging = false;

					// if the time between mousedown and mouseup is short, we consider it a click
					if (Date.now() - dragStartTime < 500) {
						navigate(event.subject.id);
					}
				})
		);
	} else {
		for (const node of nodeRenderData) {
			node.gfx.on('click', () => {
				navigate(node.simulationData.id);
			});
		}
	}

	let zoomController: ZoomBehavior<HTMLCanvasElement, NodeData> | undefined;
	if (enableZoom) {
		zoomController = zoom<HTMLCanvasElement, NodeData>()
			.filter((event: Event) => {
				// local graph only wheel-zooms with ctrl/meta held (Quartz checks
				// for the .global-graph-container class; here it's a parameter)
				if (event.type === 'wheel') {
					if (isGlobalGraph || graph.dataset.expanded === 'true') return true;
					const we = event as WheelEvent;
					return we.ctrlKey || we.metaKey;
				}
				return !(event as MouseEvent).button;
			})
			.extent((): [[number, number], [number, number]] => [
				[0, 0],
				[width, height]
			])
			.scaleExtent([0.25, 4])
			.on('zoom', ({ transform }) => {
				currentTransform = transform;
				stage.scale.set(transform.k, transform.k);
				stage.position.set(transform.x, transform.y);

				// zoom adjusts opacity of labels too
				const scale = transform.k * opacityScale;
				const scaleOpacity = Math.max((scale - 1) / 3.75, 0);
				for (const node of nodeRenderData) {
					if (!node.active) node.label.alpha = scaleOpacity;
				}
				requestFrame();
			});
		select<HTMLCanvasElement, NodeData>(app.canvas).call(zoomController);
	}

	// Resize the existing Pixi canvas, keeping the simulation and zoom alive.
	const resizeObserver = new ResizeObserver(() => {
		const nextWidth = graph.clientWidth;
		const nextHeight = graph.clientHeight;
		if (!nextWidth || !nextHeight || (nextWidth === width && nextHeight === height)) return;
		const { x, y, k } = currentTransform;
		const nextTransform = zoomIdentity
			.translate(x + ((nextWidth - width) * (1 - k)) / 2, y + ((nextHeight - height) * (1 - k)) / 2)
			.scale(k);
		width = nextWidth;
		height = nextHeight;
		app.renderer.resize(width, height);
		geometryDirty = true;
		requestFrame();
		if (enableRadial) {
			simulation.force('radial', forceRadial((Math.min(width, height) / 2) * 0.8).strength(0.2));
			simulation.alpha(Math.max(simulation.alpha(), 0.15)).restart();
		}
		if (zoomController)
			select<HTMLCanvasElement, NodeData>(app.canvas).call(zoomController.transform, nextTransform);
	});
	resizeObserver.observe(graph);

	function drawFrame(time: number) {
		tweens.forEach((t) => t.update(time));
		if (geometryDirty) {
			for (const n of nodeRenderData) {
				const { x, y } = n.simulationData;
				const position = canvasPosition(x, y, width, height);
				if (!position) continue;
				n.gfx.position.set(position.x, position.y);
				if (n.simulationData === centeredNode) {
					graph.dataset.graphCurrentX = String(position.x);
					graph.dataset.graphCurrentY = String(position.y);
				}
				n.label.position.set(position.x, position.y);
			}

			for (const l of linkRenderData) {
				const { source, target } = l.simulationData;
				const dx = target.x! - source.x!;
				const dy = target.y! - source.y!;
				const length = Math.hypot(dx, dy);
				l.gfx.renderable = length > 0;
				l.gfx.position.set(source.x! + width / 2, source.y! + height / 2);
				l.gfx.rotation = Math.atan2(dy, dx);
				l.gfx.scale.set(length, 1);
			}
			geometryDirty = false;
		}
		app.renderer.render(stage);
	}

	function animate(time: number) {
		animationFrame = 0;
		if (destroyed) return;
		drawFrame(time);
		if (time < tweenUntil) requestFrame();
	}

	simulation.on('tick.render', () => {
		geometryDirty = true;
		requestFrame();
	});
	// Draw immediately even if animation frames are throttled in a background tab.
	drawFrame(performance.now());
	graph.dataset.graphReady = 'true';
	graph.dataset.graphNodes = String(nodeRenderData.length);
	graph.dataset.graphLinks = String(linkRenderData.length);

	return () => {
		if (destroyed) return;
		destroyed = true;
		resizeObserver.disconnect();
		cancelAnimationFrame(animationFrame);
		tweens.forEach((t) => t.stop());
		tweens.clear();
		simulation.stop();
		// Pixi treats a boolean `true` renderer option as "remove the canvas AND
		// release global resources". Local and global graphs are separate Pixi
		// applications, so releasing the process-wide text texture pool while
		// the other graph is alive corrupts its atlas. Remove this app's canvas,
		// children and renderer without releasing resources shared by its peer.
		app.destroy({ removeView: true, releaseGlobalResources: false }, { children: true });
		linkContext.destroy();
	};
}
