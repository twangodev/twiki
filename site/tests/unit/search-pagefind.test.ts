import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { noteSearchInput } from '../../tooling/lib/search-inputs.js';
import { fileSearchRecord } from '../../tooling/lib/file-search.js';
import type { PageDoc } from '../../src/lib/types';

test('real Pagefind preserves note ranking, filters, snippets and heading links without shell text', () => {
	const doc = {
		slug: 'course/note',
		title: 'Exact title',
		tags: ['topic', 'CaseSensitive'],
		html: '<h1 id="heading">Heading needle</h1><p>Search body needle</p><h2 id="subheading">Subheading target</h2>'
	} as PageDoc;
	const generated = noteSearchInput(doc)!;
	const original = {
		url: generated.url,
		content: `<html lang="en"><head><title>Exact title | wisconsin</title></head><body><nav>ShellOnlyWord</nav><article data-pagefind-body><div class="hidden" data-pagefind-ignore><span data-pagefind-filter="course">course</span><span data-pagefind-filter="tag">topic</span><span data-pagefind-filter="tag">CaseSensitive</span></div><span class="sr-only" data-pagefind-meta="title">Exact title</span>${doc.html}<div data-pagefind-ignore>CopyMarkdownWord ModifiedDateWord</div></article><aside>BacklinksWord</aside></body></html>`
	};
	const records = [fileSearchRecord({ course: 'course', file: 'data/FileNeedle.csv' })];
	// A separate Node process uses the installed native indexer and browser WASM
	// engine. Its fetch shim reads only generated index bytes; no server/network or
	// test-process browser globals are involved.
	const script = `
import * as pagefind from 'pagefind';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {original,generated,records}=JSON.parse(process.argv[1]);
const root=mkdtempSync(path.join(tmpdir(),'wisconsin-search-engine-'));
const snapshots=[];
try {
 for (const [i,html] of [original,generated].entries()) {
  const {index,errors}=await pagefind.createIndex();
  if(errors.length)throw new Error(errors.join('\\n'));
  const added=await index.addHTMLFile(html);
  if(added.errors.length)throw new Error(added.errors.join('\\n'));
  for(const record of records) {
   const added=await index.addCustomRecord(record);
   if(added.errors.length)throw new Error(added.errors.join('\\n'));
  }
  const output=await index.getFiles();
  if(output.errors.length)throw new Error(output.errors.join('\\n'));
  const files=new Map(output.files.map(f=>[f.path,f.content]));
  const modulePath=path.join(root,'pagefind-'+i+'.mjs');
  writeFileSync(modulePath,files.get('pagefind.js'));
  globalThis.fetch=async(input)=>{
   const url=new URL(typeof input==='string'?input:input.url??input.toString());
   if(url.origin!=='https://pagefind.test')throw new Error('Unexpected network request');
   const file=decodeURIComponent(url.pathname).slice(1);
   const bytes=files.get(file);
   if(!bytes)throw new Error('Unknown generated index file');
   return new Response(bytes,{headers:{'Content-Type':file.startsWith('wasm.')?'application/wasm':'application/octet-stream'}});
  };
  const browser=await import(pathToFileURL(modulePath).href);
  await browser.options({basePath:'https://pagefind.test/',baseUrl:'/'});
  const queries=[];
  for(const query of ['needle','target','FileNeedle','ShellOnlyWord','CopyMarkdownWord','BacklinksWord','PrivateSecretWord']) {
   const result=await browser.search(query);
   queries.push(await Promise.all(result.results.map(r=>r.data())));
  }
  const filtered=await browser.search('needle',{filters:{course:'course',tag:'CaseSensitive'}});
  snapshots.push({queries,filters:await browser.filters(),filtered:await Promise.all(filtered.results.map(r=>r.data()))});
  await browser.destroy();
 }
 console.log(JSON.stringify(snapshots));
} finally { await pagefind.close();rmSync(root,{recursive:true,force:true}); }
`;
	const child = spawnSync(
		'node',
		['--input-type=module', '-e', script, JSON.stringify({ original, generated, records })],
		{
			cwd: fileURLToPath(new URL('../..', import.meta.url)),
			timeout: 15000,
			encoding: 'utf8'
		}
	);
	if (child.error || child.status !== 0 || !child.stdout?.trim()) {
		throw new Error(
			`Native Pagefind fixture failed (status=${child.status}, signal=${child.signal}). ${child.error?.message || child.stderr || 'No result was returned; the sandbox may block native child-process IPC. Run this fixture with native subprocess permissions.'}`
		);
	}
	const snapshots = JSON.parse(child.stdout);
	expect(snapshots[1]).toEqual(snapshots[0]);
	const note = snapshots[1].queries[0].find(
		(result: { url: string }) => result.url === '/course/note'
	);
	expect(note.meta.title).toBe('Exact title');
	expect(note.excerpt).toContain('<mark>needle');
	expect(
		snapshots[1].queries[1][0].anchors.some((anchor: { id: string }) => anchor.id === 'subheading')
	).toBe(true);
	expect(snapshots[1].queries[1][0].sub_results[0].url).toBe('/course/note#heading');
	expect(snapshots[1].queries[2][0].url).toBe('/course/files/data/FileNeedle.csv');
	for (const query of snapshots[1].queries.slice(3)) expect(query).toEqual([]);
	expect(snapshots[1].filters).toEqual({
		course: { course: 2 },
		tag: { topic: 1, CaseSensitive: 1 }
	});
	expect(snapshots[1].filtered).toHaveLength(1);
}, 20000);
