import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';

// Rebuild the multi-resolution ICO from the editable vector: bun tooling/favicon.ts
const source = readFileSync(new URL('../site/assets/favicon.svg', import.meta.url));
const sizes = [16, 32, 48, 64, 128, 256];
const images = sizes.map((size) =>
  new Resvg(source, { fitTo: { mode: 'width', value: size } }).render().asPng(),
);
const directory = Buffer.alloc(6 + sizes.length * 16);
directory.writeUInt16LE(1, 2); // ICO image type.
directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
for (const [index, size] of sizes.entries()) {
  const entry = 6 + index * 16;
  directory[entry] = directory[entry + 1] = size === 256 ? 0 : size;
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(images[index].length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += images[index].length;
}
writeFileSync(new URL('../site/static/favicon.ico', import.meta.url), Buffer.concat([directory, ...images]));
