<script lang="ts">
	/**
	 * Shared force-directed graph renderer (used by the sidebar local graph and
	 * the global graph dialog).
	 *
	 * Layout: LayerChart's `ForceSimulation` (layerchart@2.0.0-next.65, the
	 * Svelte 5 release line) in `static` mode — the d3-force simulation is run
	 * to completion synchronously and the settled positions are rendered once.
	 * No per-frame ticking, no animation loop; hover/zoom are pure CSS/transform
	 * updates on the settled SVG.
	 *
	 * Rendering: SVG. At the full corpus size (~660 nodes / ~2,400 links) a
	 * settled SVG with transform-based pan/zoom stays smooth because nothing
	 * re-layouts — the browser only composites. ESCAPE HATCH: if a future,
	 * much larger corpus makes hover/zoom janky, swap the `<svg>` body for a
	 * `<canvas>` draw loop fed by the same settled `nodes`/`links` arrays
	 * (LayerChart exposes a Canvas layer, or draw directly); hit-testing via
	 * d3-quadtree. The data layer (graph-data.ts) and props stay identical.
	 *
	 * Labels are capped (`labelLimit` highest-degree nodes) so the global view
	 * isn't a hairball of text; hovered node + its neighbors + the current page
	 * always get labels.
	 */
	import type { ClassValue } from 'svelte/elements';
	import {
		forceCollide,
		forceLink,
		forceManyBody,
		forceX,
		forceY,
		type SimulationNodeDatum
	} from 'd3-force';
	import { ForceSimulation } from 'layerchart/force';
	import { cn } from '$lib/utils';
	import { courseOf, hrefForId, type GraphLink, type GraphNode } from './graph-data';

	interface SimNode extends SimulationNodeDatum {
		id: string;
		title: string;
		r: number;
		color: string;
	}

	interface Props {
		nodes: GraphNode[];
		links: GraphLink[];
		/** Full-graph degree map (sizing stays consistent between modes). */
		degree: Map<string, number>;
		/** Course → color map (see graph-data.ts `courseColors`). */
		colors: Map<string, string>;
		/** Node id of the page being viewed (accent red + always labeled). */
		currentId?: string;
		/** Enable wheel zoom + drag pan (global view). */
		zoomable?: boolean;
		/** Always label the N highest-degree nodes (0 = hover/current only). */
		labelLimit?: number;
		linkDistance?: number;
		charge?: number;
		class?: ClassValue;
		/** Called after a node link is activated (lets the dialog close). */
		onnavigate?: () => void;
	}

	const {
		nodes,
		links,
		degree,
		colors,
		currentId,
		zoomable = false,
		labelLimit = 0,
		linkDistance = 32,
		charge = -90,
		class: className,
		onnavigate
	}: Props = $props();

	const deg = (id: string) => degree.get(id) ?? 0;
	const radius = (id: string) => Math.min(3 + Math.sqrt(deg(id)) * 1.1, 13);

	// Fresh clones per data change: d3-force mutates node objects (x/y/vx/vy)
	// and forceLink rewrites link source/target to node references. The string
	// `links` prop is kept pristine for rendering + adjacency.
	const sim = $derived.by(() => {
		const simNodes: SimNode[] = nodes.map((n) => ({
			id: n.id,
			title: n.title,
			r: radius(n.id),
			color: n.id === currentId ? 'var(--color-accent, #d35545)' : (colors.get(courseOf(n.id)) ?? 'var(--color-muted, #9ca3af)')
		}));
		const simLinks = links.map((l) => ({ source: l.source, target: l.target }));
		return {
			data: { nodes: simNodes, links: simLinks },
			forces: {
				link: forceLink<SimNode, (typeof simLinks)[number]>(simLinks)
					.id((d) => d.id)
					.distance(linkDistance),
				charge: forceManyBody().strength(charge),
				collide: forceCollide<SimNode>().radius((d) => d.r + 3),
				// Gentle pull toward the origin keeps disconnected components and
				// orphan nodes from drifting out of frame (no forceCenter needed).
				x: forceX(0).strength(0.06),
				y: forceY(0).strength(0.08)
			}
		};
	});

	// Adjacency over the *displayed* subgraph, for hover highlighting.
	const adjacency = $derived.by(() => {
		const adj = new Map<string, Set<string>>();
		const add = (a: string, b: string) => {
			let set = adj.get(a);
			if (!set) adj.set(a, (set = new Set()));
			set.add(b);
		};
		for (const l of links) {
			add(l.source, l.target);
			add(l.target, l.source);
		}
		return adj;
	});

	const alwaysLabeled = $derived.by(() => {
		const ids = new Set<string>();
		if (currentId) ids.add(currentId);
		if (labelLimit > 0) {
			[...nodes]
				.sort((a, b) => deg(b.id) - deg(a.id))
				.slice(0, labelLimit)
				.forEach((n) => ids.add(n.id));
		}
		return ids;
	});

	let hovered = $state<string | null>(null);

	function isRelated(id: string): boolean {
		if (!hovered) return true;
		return id === hovered || (adjacency.get(hovered)?.has(id) ?? false);
	}
	function isActiveLink(l: GraphLink): boolean {
		return hovered !== null && (l.source === hovered || l.target === hovered);
	}
	function showLabel(id: string): boolean {
		if (hovered) return isRelated(id);
		return alwaysLabeled.has(id);
	}

	// Fitted viewBox, computed once per settle (onEnd) from the final layout.
	let vb = $state({ x: -150, y: -150, w: 300, h: 300 });
	function fitViewBox(settled: SimNode[]) {
		if (settled.length === 0) return;
		let minX = Infinity,
			minY = Infinity,
			maxX = -Infinity,
			maxY = -Infinity;
		for (const n of settled) {
			minX = Math.min(minX, n.x ?? 0);
			minY = Math.min(minY, n.y ?? 0);
			maxX = Math.max(maxX, n.x ?? 0);
			maxY = Math.max(maxY, n.y ?? 0);
		}
		const pad = 28;
		const w = Math.max(maxX - minX, 80) + pad * 2;
		const h = Math.max(maxY - minY, 80) + pad * 2;
		vb = { x: minX - pad, y: minY - pad, w, h };
		// Reset any pan/zoom from a previous layout.
		k = 1;
		tx = 0;
		ty = 0;
	}

	const labelSize = $derived(Math.max(8, Math.min(vb.w, vb.h) / 50));

	// --- pan / zoom (global view) -------------------------------------------
	// Implemented directly (≈40 lines) instead of LayerChart's TransformContext:
	// that context is coupled to its Chart wrapper and still moving in the
	// 2.0.0-next line, while this needs nothing but a transform on one <g>.
	let k = $state(1);
	let tx = $state(0);
	let ty = $state(0);
	let dragging = $state(false);
	let suppressClick = false;

	function panZoom(svg: SVGSVGElement) {
		if (!zoomable) return;
		const toLocal = (e: { clientX: number; clientY: number }) => {
			const ctm = svg.getScreenCTM();
			if (!ctm) return { x: 0, y: 0 };
			return new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
		};
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			const p = toLocal(e);
			const next = Math.min(Math.max(k * Math.exp(-e.deltaY * 0.0015), 0.25), 8);
			tx = p.x - ((p.x - tx) * next) / k;
			ty = p.y - ((p.y - ty) * next) / k;
			k = next;
		};
		let last: { x: number; y: number } | null = null;
		let travel = 0;
		const onPointerDown = (e: PointerEvent) => {
			if (e.button !== 0) return;
			svg.setPointerCapture(e.pointerId);
			last = toLocal(e);
			travel = 0;
		};
		const onPointerMove = (e: PointerEvent) => {
			if (!last) return;
			const p = toLocal(e);
			travel += Math.hypot(p.x - last.x, p.y - last.y);
			if (travel > 3) dragging = true;
			tx += p.x - last.x;
			ty += p.y - last.y;
			last = p;
		};
		const onPointerUp = () => {
			suppressClick = dragging;
			last = null;
			dragging = false;
		};
		// Svelte 5 declares wheel handlers passive; preventDefault needs this.
		svg.addEventListener('wheel', onWheel, { passive: false });
		svg.addEventListener('pointerdown', onPointerDown);
		svg.addEventListener('pointermove', onPointerMove);
		svg.addEventListener('pointerup', onPointerUp);
		svg.addEventListener('pointercancel', onPointerUp);
		return () => {
			svg.removeEventListener('wheel', onWheel);
			svg.removeEventListener('pointerdown', onPointerDown);
			svg.removeEventListener('pointermove', onPointerMove);
			svg.removeEventListener('pointerup', onPointerUp);
			svg.removeEventListener('pointercancel', onPointerUp);
		};
	}

	function onNodeClick(e: MouseEvent) {
		// A drag that ends on a node must not navigate.
		if (suppressClick) {
			e.preventDefault();
			e.stopPropagation();
			suppressClick = false;
			return;
		}
		onnavigate?.();
	}
</script>

<svg
	{@attach panZoom}
	class={cn(
		'block h-full w-full select-none',
		zoomable && (dragging ? 'cursor-grabbing' : 'cursor-grab'),
		className
	)}
	viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
	role="img"
	aria-label="Knowledge graph"
	onpointerleave={() => (hovered = null)}
>
	<g transform={`translate(${tx} ${ty}) scale(${k})`}>
		<ForceSimulation
			data={sim.data}
			forces={sim.forces}
			static
			onEnd={({ simulation }) => fitViewBox(simulation.nodes() as SimNode[])}
		>
			{#snippet children({ nodes: rawNodes })}
				<!-- ForceSimulation's generic isn't inferred through the forces
				     Record, so the snippet param needs one cast back to SimNode. -->
				{@const settled = rawNodes as SimNode[]}
				{@const pos = new Map(settled.map((n) => [n.id, n]))}
				<!-- links (settled positions; `static` mode never populates
				     linkPositions, so lines are derived from the node map) -->
				<g stroke="var(--color-border, #e5e7eb)" stroke-width="1">
					{#each links as l (`${l.source} ${l.target}`)}
						{@const s = pos.get(l.source)}
						{@const t = pos.get(l.target)}
						{#if s && t}
							<line
								class="transition-opacity duration-150"
								x1={s.x}
								y1={s.y}
								x2={t.x}
								y2={t.y}
								stroke={isActiveLink(l) ? 'var(--color-accent, #d35545)' : undefined}
								opacity={hovered ? (isActiveLink(l) ? 0.9 : 0.08) : 0.55}
							/>
						{/if}
					{/each}
				</g>
				<!-- nodes: SVG <a> anchors → native links, SvelteKit client router -->
				{#each settled as n (n.id)}
					<a
						href={hrefForId(n.id)}
						aria-label={n.title}
						onclick={onNodeClick}
						onpointerenter={() => (hovered = n.id)}
						onpointerleave={() => (hovered = null)}
					>
						<g
							class="cursor-pointer transition-opacity duration-150"
							opacity={isRelated(n.id) ? 1 : 0.15}
						>
							<circle
								cx={n.x}
								cy={n.y}
								r={hovered === n.id ? n.r + 1.5 : n.r}
								fill={n.color}
							/>
							{#if showLabel(n.id)}
								<text
									class="pointer-events-none"
									x={n.x}
									y={(n.y ?? 0) + n.r + labelSize}
									text-anchor="middle"
									font-size={labelSize}
									fill="var(--color-text, currentColor)"
									stroke="var(--color-bg, #fff)"
									stroke-width={labelSize / 4}
									paint-order="stroke"
									opacity={hovered && hovered !== n.id ? 0.75 : 0.9}>{n.title}</text
								>
							{/if}
							<title>{n.title}</title>
						</g>
					</a>
				{/each}
			{/snippet}
		</ForceSimulation>
	</g>
</svg>
