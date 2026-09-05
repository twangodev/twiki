import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { publicAssetManifest } from './public-assets';
import { publicResponse, publicTarget } from '../../worker/publication';

const directory = mkdtempSync(path.join(tmpdir(), 'wisconsin-public-assets-'));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

test('only exact generated public URLs are eligible for anonymous serving', () => {
	mkdirSync(path.join(directory, '_app'), { recursive: true });
	for (const file of [
		'index.html',
		'note.html',
		'404.html',
		'_headers',
		'_redirects',
		'_app/public.js',
		'graph.json'
	])
		writeFileSync(path.join(directory, file), 'fixture');
	const assets = publicAssetManifest(directory, {
		'/': 'index.html',
		'/note': 'note.html',
		'/files/Résumé Test.java': 'files/Résumé Test.java.html',
		'/404': '404.html'
	});
	const request = (url: string, method = 'GET') =>
		new Request(`https://example.com${url}`, { method });
	expect(publicTarget(request('/note'), assets)).toBe('/_published/note');
	expect(publicTarget(request('/'), assets)).toBe('/_published');
	expect(publicTarget(request('/files/R%C3%A9sum%C3%A9%20Test.java'), assets)).toBe(
		'/_published/files/R%C3%A9sum%C3%A9%20Test.java'
	);
	expect(publicTarget(request('/graph.json?x=1', 'HEAD'), assets)).toBe('/_published/graph.json');
	for (const url of [
		'/note.html',
		'/note/',
		'/%6eote',
		'/_published/note',
		'/_app/private.js',
		'/_headers',
		'/404',
		'/toString'
	])
		expect(publicTarget(request(url), assets)).toBeUndefined();
	expect(publicTarget(request('/note', 'POST'), assets)).toBeUndefined();
	expect(publicTarget(request('/note'), {})).toBeUndefined();
});

test('public responses remain indexable without caching cookies or personalized variants', async () => {
	const response = publicResponse(
		new Response('published', {
			headers: { 'Set-Cookie': 'session=private', 'X-Robots-Tag': 'noindex' }
		}),
		new Request('https://example.com/note')
	);
	expect(response.headers.get('set-cookie')).toBeNull();
	expect(response.headers.get('x-robots-tag')).toBeNull();
	expect(response.headers.get('cache-control')).toBe('no-store');
	expect(response.headers.get('vary')).toBe('Cookie');
	expect(await response.text()).toBe('published');
	const head = publicResponse(
		new Response('published'),
		new Request('https://example.com/note', { method: 'HEAD' })
	);
	expect(await head.text()).toBe('');
});
