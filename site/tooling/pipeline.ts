import { compileContent } from './compiler';
import { prepareAssets } from './assets';

export async function prepareContent() {
	const start = performance.now();
	await compileContent();
	await prepareAssets();
	console.log(`content pipeline: ${((performance.now() - start) / 1000).toFixed(2)}s`);
}
