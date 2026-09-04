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
 * - The depth-limited neighbourhood BFS uses an adjacency map instead of
 *   Quartz's repeated O(links) scans, and links resolve node objects through
 *   a Map instead of Array.find — identical result sets, just not quadratic.
 * - Quartz re-renders on its custom `themechange` event; here GraphView
 *   re-runs renderGraph when `:root`'s class list changes (MutationObserver).
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
import { zoom, zoomIdentity } from 'd3-zoom';
import { Application, Circle, Container, Graphics, Text } from 'pixi.js';
import { getVisited, type GraphConfig, type GraphData } from './graph-data';

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

type SimpleLinkData = {
	source: string;
	target: string;
};

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
		enableRadial
	} = cfg;
	const depth = cfg.depth;

	const data = new Map(fullData.nodes.map((n) => [n.id, n]));
	const links: SimpleLinkData[] = [];
	const tags: string[] = [];
	const validLinks = new Set(data.keys());

	const tweens = new Map<string, TweenNode>();
	for (const l of fullData.links) {
		if (validLinks.has(l.source) && validLinks.has(l.target)) {
			links.push({ source: l.source, target: l.target });
		}
	}
	if (showTags) {
		for (const [source, details] of data.entries()) {
			const localTags = details.tags
				.filter((tag) => !removeTags.includes(tag))
				.map((tag) => 'tags/' + tag);

			tags.push(...localTags.filter((tag) => !tags.includes(tag)));

			for (const tag of localTags) {
				links.push({ source, target: tag });
			}
		}
	}

	const neighbourhood = new Set<string>();
	if (depth >= 0 && slug !== undefined) {
		// level-by-level BFS to `depth` hops, undirected — same node set as
		// Quartz's sentinel worklist, built off an adjacency map instead of
		// re-filtering the link array per node
		const adjacent = new Map<string, string[]>();
		const addAdj = (a: string, b: string) => {
			const arr = adjacent.get(a);
			if (arr) arr.push(b);
			else adjacent.set(a, [b]);
		};
		for (const l of links) {
			addAdj(l.source, l.target);
			addAdj(l.target, l.source);
		}
		neighbourhood.add(slug);
		let frontier: string[] = [slug];
		for (let level = 0; level < depth && frontier.length > 0; level++) {
			const next: string[] = [];
			for (const id of frontier) {
				for (const neighbour of adjacent.get(id) ?? []) {
					if (!neighbourhood.has(neighbour)) {
						neighbourhood.add(neighbour);
						next.push(neighbour);
					}
				}
			}
			frontier = next;
		}
	} else {
		validLinks.forEach((id) => neighbourhood.add(id));
		if (showTags) tags.forEach((tag) => neighbourhood.add(tag));
	}

	const nodes: NodeData[] = [...neighbourhood].map((url) => {
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
		links: links
			.filter((l) => neighbourhood.has(l.source) && neighbourhood.has(l.target))
			.map((l) => ({
				source: nodeById.get(l.source)!,
				target: nodeById.get(l.target)!
			}))
	};
	const initiallyCenteredNode =
		!isGlobalGraph && slug !== undefined ? nodeById.get(slug) : undefined;
	if (initiallyCenteredNode) {
		initiallyCenteredNode.fx = 0;
		initiallyCenteredNode.fy = 0;
	}

	const width = graph.offsetWidth;
	const height = Math.max(graph.offsetHeight, 250);

	// we virtualize the simulation and use pixi to actually render it
	const simulation: Simulation<NodeData, LinkData> = forceSimulation<NodeData>(graphData.nodes)
		.force('charge', forceManyBody().strength(-100 * repelForce))
		.force('center', forceCenter().strength(centerForce))
		.force('link', forceLink(graphData.links).distance(linkDistance))
		.force('collide', forceCollide<NodeData>((n) => nodeRadius(n)).iterations(3));
	if (initiallyCenteredNode) {
		simulation.on('end.initial-center', () => {
			// Leave the settled layout centered, then release the node so normal
			// drag/reheat behavior remains identical to Quartz.
			initiallyCenteredNode.fx = null;
			initiallyCenteredNode.fy = null;
		});
	}

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
		const numLinks = graphData.links.filter(
			(l) => l.source.id === d.id || l.target.id === d.id
		).length;
		return 2 + Math.sqrt(numLinks);
	}

	let hoveredNodeId: string | null = null;
	let hoveredNeighbours: Set<string> = new Set();
	const linkRenderData: LinkRenderData[] = [];
	const nodeRenderData: NodeRenderData[] = [];
	function updateHoverInfo(newHoveredId: string | null) {
		hoveredNodeId = newHoveredId;

		if (newHoveredId === null) {
			hoveredNeighbours = new Set();
			for (const n of nodeRenderData) {
				n.active = false;
			}

			for (const l of linkRenderData) {
				l.active = false;
			}
		} else {
			hoveredNeighbours = new Set();
			for (const l of linkRenderData) {
				const linkData = l.simulationData;
				if (linkData.source.id === newHoveredId || linkData.target.id === newHoveredId) {
					hoveredNeighbours.add(linkData.source.id);
					hoveredNeighbours.add(linkData.target.id);
				}

				l.active = linkData.source.id === newHoveredId || linkData.target.id === newHoveredId;
			}

			for (const n of nodeRenderData) {
				n.active = hoveredNeighbours.has(n.simulationData.id);
			}
		}
	}

	let dragStartTime = 0;
	let dragging = false;

	function renderLinks() {
		tweens.get('link')?.stop();
		const tweenGroup = new TweenGroup();

		for (const l of linkRenderData) {
			let alpha = 1;

			// if we are hovering over a node, we want to highlight the immediate neighbours
			// with full alpha and the rest with default alpha
			if (hoveredNodeId) {
				alpha = l.active ? 1 : 0.2;
			}

			l.color = l.active ? computedStyleMap['--gray'] : computedStyleMap['--lightgray'];
			tweenGroup.add(new Tweened<LinkRenderData>(l).to({ alpha }, 200));
		}

		tweenGroup.getAll().forEach((tw) => tw.start());
		tweens.set('link', {
			update: tweenGroup.update.bind(tweenGroup),
			stop() {
				tweenGroup.getAll().forEach((tw) => tw.stop());
			}
		});
	}

	function renderLabels() {
		tweens.get('label')?.stop();
		const tweenGroup = new TweenGroup();

		const defaultScale = 1 / scale;
		const activeScale = defaultScale * 1.1;
		for (const n of nodeRenderData) {
			const nodeId = n.simulationData.id;

			if (hoveredNodeId === nodeId) {
				tweenGroup.add(
					new Tweened<Text>(n.label).to(
						{
							alpha: 1,
							scale: { x: activeScale, y: activeScale }
						},
						100
					)
				);
			} else {
				tweenGroup.add(
					new Tweened<Text>(n.label).to(
						{
							alpha: n.label.alpha,
							scale: { x: defaultScale, y: defaultScale }
						},
						100
					)
				);
			}
		}

		tweenGroup.getAll().forEach((tw) => tw.start());
		tweens.set('label', {
			update: tweenGroup.update.bind(tweenGroup),
			stop() {
				tweenGroup.getAll().forEach((tw) => tw.stop());
			}
		});
	}

	function renderNodes() {
		tweens.get('hover')?.stop();

		const tweenGroup = new TweenGroup();
		for (const n of nodeRenderData) {
			let alpha = 1;

			// if we are hovering over a node, we want to highlight the immediate neighbours
			if (hoveredNodeId !== null && focusOnHover) {
				alpha = n.active ? 1 : 0.2;
			}

			tweenGroup.add(new Tweened<Graphics>(n.gfx, tweenGroup).to({ alpha }, 200));
		}

		tweenGroup.getAll().forEach((tw) => tw.start());
		tweens.set('hover', {
			update: tweenGroup.update.bind(tweenGroup),
			stop() {
				tweenGroup.getAll().forEach((tw) => tw.stop());
			}
		});
	}

	function renderPixiFromD3() {
		renderNodes();
		renderLinks();
		renderLabels();
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
		preference: 'webgpu',
		resolution: window.devicePixelRatio,
		eventMode: 'static'
	});
	graph.appendChild(app.canvas);

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
	}

	for (const l of graphData.links) {
		const gfx = new Graphics({ interactive: false, eventMode: 'none' });
		linkContainer.addChild(gfx);

		const linkRenderDatum: LinkRenderData = {
			simulationData: l,
			gfx,
			color: computedStyleMap['--lightgray'],
			alpha: 1,
			active: false
		};

		linkRenderData.push(linkRenderDatum);
	}

	let currentTransform = zoomIdentity;
	if (enableDrag) {
		select<HTMLCanvasElement, NodeData | undefined>(app.canvas).call(
			drag<HTMLCanvasElement, NodeData | undefined>()
				.container(() => app.canvas)
				.subject(() => graphData.nodes.find((n) => n.id === hoveredNodeId))
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
					event.subject.fx = null;
					event.subject.fy = null;
					dragging = false;

					// if the time between mousedown and mouseup is short, we consider it a click
					if (Date.now() - dragStartTime < 500) {
						const node = graphData.nodes.find((n) => n.id === event.subject.id) as NodeData;
						navigate(node.id);
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

	if (enableZoom) {
		select<HTMLCanvasElement, NodeData>(app.canvas).call(
			zoom<HTMLCanvasElement, NodeData>()
				.filter((event: Event) => {
					// local graph only wheel-zooms with ctrl/meta held (Quartz checks
					// for the .global-graph-container class; here it's a parameter)
					if (event.type === 'wheel') {
						if (isGlobalGraph) return true;
						const we = event as WheelEvent;
						return we.ctrlKey || we.metaKey;
					}
					return !(event as MouseEvent).button;
				})
				.extent([
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
					const activeNodes = nodeRenderData.filter((n) => n.active).flatMap((n) => n.label);

					for (const label of labelsContainer.children) {
						if (!activeNodes.includes(label)) {
							label.alpha = scaleOpacity;
						}
					}
				})
		);
	}

	let stopAnimation = false;
	let animationFrame = 0;
	function animate(time: number) {
		if (stopAnimation) return;
		for (const n of nodeRenderData) {
			const { x, y } = n.simulationData;
			if (!x || !y) continue;
			n.gfx.position.set(x + width / 2, y + height / 2);
			if (n.label) {
				n.label.position.set(x + width / 2, y + height / 2);
			}
		}

		for (const l of linkRenderData) {
			const linkData = l.simulationData;
			l.gfx.clear();
			l.gfx.moveTo(linkData.source.x! + width / 2, linkData.source.y! + height / 2);
			l.gfx
				.lineTo(linkData.target.x! + width / 2, linkData.target.y! + height / 2)
				.stroke({ alpha: l.alpha, width: 1, color: l.color });
		}

		tweens.forEach((t) => t.update(time));
		app.renderer.render(stage);
		animationFrame = requestAnimationFrame(animate);
	}

	animationFrame = requestAnimationFrame(animate);
	let destroyed = false;
	return () => {
		if (destroyed) return;
		destroyed = true;
		stopAnimation = true;
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
	};
}
