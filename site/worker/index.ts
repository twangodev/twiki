// @ts-expect-error The adapter generates this untyped module during build.
import app from '../build/.svelte-kit/svelte-worker.js';
import { createContentWorker } from './runtime';
import type { HtmlCache } from './content-runtime';

// Cache lookups are inside the gate; full-edition HTML never bypasses authorization.
const edgeCache = (globalThis as typeof globalThis & { caches?: { default?: HtmlCache } }).caches
	?.default;
export default createContentWorker(app, edgeCache);
