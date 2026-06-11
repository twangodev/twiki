// Knowledge-graph viewer (Quartz Graph View parity — pixi.js + d3-force port
// of quartz/components/scripts/graph.inline.ts).
// Always load this via dynamic `import()` so the graph stack stays out of
// the initial bundle — see the wiring in doc/DocShell.svelte.
export { default as GraphPanel } from './GraphPanel.svelte';
export * from './graph-data';
