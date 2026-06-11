// Knowledge-graph viewer (Quartz Graph View parity).
// Always load this via dynamic `import()` so layerchart/d3-force stay out of
// the initial bundle — see the wiring in doc/DocShell.svelte.
export { default as GraphPanel } from './GraphPanel.svelte';
export * from './graph-data';
