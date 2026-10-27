# Changelog

## [0.7.1](https://github.com/twangodev/twiki/compare/v0.7.0...v0.7.1) (2026-10-27)


### Bug Fixes

* update vulnerable dependencies ([104ec56](https://github.com/twangodev/twiki/commit/104ec5648eda0645d4432d25eaafc8e58c561fcc))

## [0.7.0](https://github.com/twangodev/twiki/compare/v0.6.0...v0.7.0) (2026-10-27)


### Features

* publish builder image with releases ([494480a](https://github.com/twangodev/twiki/commit/494480afaa14272350600e00e0d6f4c933d948ba))

## [0.6.0](https://github.com/twangodev/twiki/compare/v0.5.3...v0.6.0) (2026-10-21)


### Features

* refresh default linked-note favicon ([0023a7e](https://github.com/twangodev/twiki/commit/0023a7ec5944ae429b7028850ba9088efa5d1418))
* support consumer-provided favicons ([a1b0ee6](https://github.com/twangodev/twiki/commit/a1b0ee6235f98a82b7840c0eef42bc8c53604336))

## [0.5.3](https://github.com/twangodev/twiki/compare/v0.5.2...v0.5.3) (2026-10-21)


### Bug Fixes

* **cache:** validate parsed content before reuse ([7e18a91](https://github.com/twangodev/twiki/commit/7e18a912d905cff01e148934d0ee9c5a0029bc80))
* **dev:** honor asset change hints when identities collide ([e32f586](https://github.com/twangodev/twiki/commit/e32f586096f26058aea88c34c384d9a50e8fec77))
* **dev:** honor source change hints when identities collide ([8332dd9](https://github.com/twangodev/twiki/commit/8332dd98528d46593a654e730e43acb13ab8b19f))
* **dev:** reload published assets in the public edition ([cec4cd5](https://github.com/twangodev/twiki/commit/cec4cd5c3bb7eddf454d51b17872156a975f8283))
* **dev:** stop abandoned worksheet preview jobs ([44a9aeb](https://github.com/twangodev/twiki/commit/44a9aeba297183f022c692d1c908ba49fe13e9f9))
* **dev:** validate public edition output trees on restart ([0719118](https://github.com/twangodev/twiki/commit/0719118745935563cddad702507403019249fc9e))
* **dev:** verify retained outputs after full rebuilds ([c2a2fdd](https://github.com/twangodev/twiki/commit/c2a2fdd028c7b756d166399d7c8139586f4cd7d3))
* **files:** repair corrupted raw blobs during reconciliation ([3055c6c](https://github.com/twangodev/twiki/commit/3055c6c6dd28cf8f39ed9e3b92ec5e7c08298f0c))
* **graph:** refresh cached data across content updates ([810d5ea](https://github.com/twangodev/twiki/commit/810d5ea855e2412b428f3a836cc321b64428c5cf))


### Performance Improvements

* **assets:** pass course catalogs directly to navigation ([33474d1](https://github.com/twangodev/twiki/commit/33474d11b0515cb14f5d839c4d375c4d03fcf2e0))
* **assets:** reuse unchanged text exports and consolidate pruning ([c316a40](https://github.com/twangodev/twiki/commit/c316a409e6896e16672abe2e794c1bf8b7065d24))
* **assets:** sync emitted files without rescanning outputs ([b843f5d](https://github.com/twangodev/twiki/commit/b843f5db53640979233d3bd467b9c91a6eff55c1))
* **compiler:** load syntax grammars on demand ([93456bb](https://github.com/twangodev/twiki/commit/93456bb8290c2c7c3edf3274bdc4b33c9080bc7c))
* **compiler:** reuse path classification with fresh identities ([1e1f670](https://github.com/twangodev/twiki/commit/1e1f6708aa3fff3e22b83a029300c1005288dcea))
* **content:** defer reads of validated cached bodies ([f67e27f](https://github.com/twangodev/twiki/commit/f67e27fbb8bd922348688526fc905476a8dae8eb))
* **content:** pass compiled manifests directly to asset preparation ([92cd4b8](https://github.com/twangodev/twiki/commit/92cd4b81c15c08a365745e794b995947ba64f5ad))
* **content:** remove redundant output filesystem calls ([f1f7c5e](https://github.com/twangodev/twiki/commit/f1f7c5e10cd700d442de77592814a0ea14bad032))
* **content:** reuse serialized index bytes for checksums ([95db383](https://github.com/twangodev/twiki/commit/95db38390948de845d92ca110c6e792bf30dc218))
* **content:** reuse unchanged emitted page documents ([f2d13b3](https://github.com/twangodev/twiki/commit/f2d13b361243d092ff3187001f2e06ea75620d6e))
* **content:** reuse validated emitted sizes for limits ([e1cd9e9](https://github.com/twangodev/twiki/commit/e1cd9e95ed3e720e7b082bf835c0e3a1821833b1))
* **content:** share checked publication policies per build ([6822377](https://github.com/twangodev/twiki/commit/682237754cab99362b6d209de1a4907a1b082748))
* **content:** share source discovery within each build ([9c24ea2](https://github.com/twangodev/twiki/commit/9c24ea2361ae8addadb8f0b56827df3795154791))
* **content:** share transformations across export formats ([e2eb970](https://github.com/twangodev/twiki/commit/e2eb97062a347c4f98256d1ad70f389130755e06))
* **content:** size cached reads from original JSON text ([cc8636f](https://github.com/twangodev/twiki/commit/cc8636f0b48eb98f23b9d331bf0658c0d00b80b1))
* **content:** use the validated source discovery boundary ([46e8264](https://github.com/twangodev/twiki/commit/46e82643fb4b21f6f5ef7736532fdb198ce06720))
* **dev:** assemble full output checkpoints directly ([5e43d41](https://github.com/twangodev/twiki/commit/5e43d4174fbaec08cc2d9e6942737d831c5f6b16))
* **dev:** checkpoint owned output mutations incrementally ([0c6846c](https://github.com/twangodev/twiki/commit/0c6846c4ad8276edead5db4caa95a33dc943e214))
* **dev:** defer link audits to production prerendering ([f368284](https://github.com/twangodev/twiki/commit/f368284ecc691b99d20c0055565852ae6ee6b125))
* **dev:** defer redundant course output checks ([056ea41](https://github.com/twangodev/twiki/commit/056ea41ffb43830c50d6c11d778ca236fdc3100e))
* **dev:** defer unchanged document copy checks ([1894d5a](https://github.com/twangodev/twiki/commit/1894d5a610be1567720d67c7189cc65d5135463f))
* **dev:** defer unchanged emission for raw source edits ([2091572](https://github.com/twangodev/twiki/commit/20915729e6385e4f93c085046e245abe107f5051))
* **dev:** defer unchanged namespace passes ([bb7a86c](https://github.com/twangodev/twiki/commit/bb7a86cb12a047fda764a1ed19dd6d76bed9ed16))
* **dev:** discover Git watchers outside the Vite process ([70c8af4](https://github.com/twangodev/twiki/commit/70c8af4021cb48be1c4b405dd7d4693d27064895))
* **dev:** dispatch source validation before scanning outputs ([6b0b43c](https://github.com/twangodev/twiki/commit/6b0b43c513a93aef5699f62488d5f2a7d6e48a10))
* **dev:** invalidate page data without unchanged layout data ([ba4380d](https://github.com/twangodev/twiki/commit/ba4380d31d5f601d5645f9bdb261d8a2552baedd))
* **dev:** keep content compilation outside the Vite process ([d76074f](https://github.com/twangodev/twiki/commit/d76074f1fe302be7854341aefc50730e113a7305))
* **dev:** load only the GitHub brand icon ([ab2115d](https://github.com/twangodev/twiki/commit/ab2115ded0a0c5e2e870cefa8cf9abaeb87edb7c))
* **dev:** narrow asset emission for note edits ([214877d](https://github.com/twangodev/twiki/commit/214877d78e8f249228f44e828d866dfa509c0476))
* **dev:** overlap bounded Git snapshot reads ([182f608](https://github.com/twangodev/twiki/commit/182f6083ae92e9f0d3b746f0cebf7bef92bfddc1))
* **dev:** overlap disposable validator startup with compilation ([77a3202](https://github.com/twangodev/twiki/commit/77a32021939496a51bb8d3fd4d2d8e1858ed4c71))
* **dev:** overlap independent content validation ([5aa798a](https://github.com/twangodev/twiki/commit/5aa798a578a748d2ee66d84e668de6002d8b6e18))
* **dev:** preserve graphs across body-only reloads ([0bca7d0](https://github.com/twangodev/twiki/commit/0bca7d0f3a2d8872533c8c6226d3fabaeb6dd6a8))
* **dev:** reduce redundant Git discovery queries ([a35471b](https://github.com/twangodev/twiki/commit/a35471bba54fa5cdb2d1897e9109f8fdb2f12aa2))
* **dev:** release unused validated page bodies ([888e29b](https://github.com/twangodev/twiki/commit/888e29bf5720ede7bdd3833bdaa393d62fe30ac0))
* **dev:** render requested R Markdown previews on demand ([54496b4](https://github.com/twangodev/twiki/commit/54496b44e452281fc1b3b80459b890602fad984b))
* **dev:** restore validated asset copies on restart ([9400f52](https://github.com/twangodev/twiki/commit/9400f52e1a454d696b45d87e5f53de36fe7164a0))
* **dev:** restore validated content bodies on restart ([d80d08a](https://github.com/twangodev/twiki/commit/d80d08a1cbfee891cd9f597c3116e8be2cad3825))
* **dev:** restore validated course state on restart ([dd4365e](https://github.com/twangodev/twiki/commit/dd4365e6bc2be1beaba54b61c8cfd8b1ba02c7cd))
* **dev:** restore validated document copies on restart ([0ac3010](https://github.com/twangodev/twiki/commit/0ac3010d68ca16752f57c11ebed8218066d8c822))
* **dev:** restore validated text export copies on restart ([75190d6](https://github.com/twangodev/twiki/commit/75190d6897e8339b28342ec92ba058ebdf1cc8fb))
* **dev:** retain validated compiler metadata between reloads ([31ea4df](https://github.com/twangodev/twiki/commit/31ea4dfc00708b0567eaf1f30f4cb42729d0fc83))
* **dev:** reuse shared layout data between page clicks ([e36cf6a](https://github.com/twangodev/twiki/commit/e36cf6a9cc7e888af70f73741059df6554d38925))
* **dev:** reuse validated source parse keys ([2f27490](https://github.com/twangodev/twiki/commit/2f27490ae4c212e8534923e64d316a17553476f7))
* **dev:** scope public output validation to its edition ([9fd1894](https://github.com/twangodev/twiki/commit/9fd1894df29b2f01c15a1376f640a6845decab0a))
* **dev:** serialize input observations once ([227b836](https://github.com/twangodev/twiki/commit/227b8362a7cf0a6e16e4486e61aa243871e664b3))
* **dev:** share captured repository state across content stages ([b77ba55](https://github.com/twangodev/twiki/commit/b77ba557ba7d030c0c3f4deb912cf12830851466))
* **dev:** share discovery across content preparation ([afaae2b](https://github.com/twangodev/twiki/commit/afaae2be40dde21d09748b6502d15abc47ef90ae))
* **dev:** share file identities within source snapshots ([2fe602e](https://github.com/twangodev/twiki/commit/2fe602e3de93edecfa822a42f8dfd352a86619f7))
* **dev:** shorten watcher settling without losing recovery ([58b4464](https://github.com/twangodev/twiki/commit/58b4464db059472bd428a89a5c3197d2a93b8c18))
* **dev:** start content rebuilds without watcher delay ([364db4b](https://github.com/twangodev/twiki/commit/364db4b45c4f5bcf0a5b048e9041f139d758600b))
* **dev:** update validated input snapshots for known edits ([6e97ee6](https://github.com/twangodev/twiki/commit/6e97ee62b6e84ccdace6ee1d46e85c67d7e19064))
* **discovery:** prepare project visibility policy once ([46b9f73](https://github.com/twangodev/twiki/commit/46b9f7396617e9440791f97078fc8e482ba9f1f3))
* **files:** prune prior outputs only for changed courses ([90ac932](https://github.com/twangodev/twiki/commit/90ac932942964353bffb465067e3fcb645c5d1a8))
* **graph:** collect unique tags without repeated array scans ([ff9231e](https://github.com/twangodev/twiki/commit/ff9231ed17978063c79d45a77dd3dd57b46f7bed))
* **markdown:** initialize highlighting lazily and reuse it in dev ([6224eb2](https://github.com/twangodev/twiki/commit/6224eb267bfbe481506350d039b4a5b2c1c89b33))
* **navigation:** remove blocking full-page view transitions ([86c1f1d](https://github.com/twangodev/twiki/commit/86c1f1d5982cb0384c776c54bc868b5e62baf86d))
* **paths:** simplify slug conversion and preserve extensionless names ([e6dd6c7](https://github.com/twangodev/twiki/commit/e6dd6c7f2894ec098ecd17de7e90a11d20b74c99))
* **rmd:** bound and overlap fresh font probes ([7aa423f](https://github.com/twangodev/twiki/commit/7aa423f07444a8023b3ca2adee804ebc12dff4ec))
* **rmd:** limit package startup during runtime inspection ([6998065](https://github.com/twangodev/twiki/commit/69980659017961c39cedcc039ae35b5e917fc904))
* **rmd:** load markdown renderer only on preview cache misses ([73009c8](https://github.com/twangodev/twiki/commit/73009c867bfee12ff0d22f12e508c074745004a6))
* **rmd:** overlap fresh runtime and font validation ([108f4ee](https://github.com/twangodev/twiki/commit/108f4eefccc5304ea8d92abc18cdbaef49c8bb73))
* **styles:** limit Tailwind scanning to engine source ([ba2802a](https://github.com/twangodev/twiki/commit/ba2802ad545967f95ef4d9b2f0f4018849364c09))


### Reverts

* restore GitHub icon import ([82f2f4d](https://github.com/twangodev/twiki/commit/82f2f4d5cfe3740ae69a2bd65122d34e2777dc36))

## [0.5.2](https://github.com/twangodev/twiki/compare/v0.5.1...v0.5.2) (2026-10-20)


### Bug Fixes

* **deps:** patch Vite advisory blocking package releases ([1be4d47](https://github.com/twangodev/twiki/commit/1be4d4758aff02612d9d19969cacbf3ccf9324b4))

## [0.5.1](https://github.com/twangodev/twiki/compare/v0.5.0...v0.5.1) (2026-10-20)


### Performance Improvements

* **dev:** reuse unchanged asset copies during content reloads ([02a8f45](https://github.com/twangodev/twiki/commit/02a8f455e7110cba1ac388952445214d445f1e13))

## [0.5.0](https://github.com/twangodev/twiki/compare/v0.4.1...v0.5.0) (2026-10-20)


### Features

* transfer encrypted releases with native Bun archives ([4c5655c](https://github.com/twangodev/twiki/commit/4c5655c8d771903210f67c6ae8a83cb047f60678))

## [0.4.1](https://github.com/twangodev/twiki/compare/v0.4.0...v0.4.1) (2026-10-20)


### Bug Fixes

* **files:** generate catalogs for ordinary vault folders ([2e0fb8d](https://github.com/twangodev/twiki/commit/2e0fb8d5dde61b759de10c649164c6e1771ae1a7))

## [0.4.0](https://github.com/twangodev/twiki/compare/v0.3.0...v0.4.0) (2026-10-19)


### ⚠ BREAKING CHANGES

* **cache:** remove custom remote product integration
* **cache:** standardize bundled production product transport
* **build:** compile static exports as one public edition

### Features

* **branding:** use a knowledge graph favicon ([7d34839](https://github.com/twangodev/twiki/commit/7d348396b89ea3bdbbe46570479689eea30caec5))


### Bug Fixes

* **branding:** serve a multi-resolution ICO favicon ([635d8fe](https://github.com/twangodev/twiki/commit/635d8fe25d46dc2ae5c3135554cb9a89eb24a1ba))
* **publication:** report configured vault discovery and policies ([93e41c3](https://github.com/twangodev/twiki/commit/93e41c3b75b46c068e17a6ae123666530ca92c76))


### Code Refactoring

* **build:** compile static exports as one public edition ([e472190](https://github.com/twangodev/twiki/commit/e4721906552c28d43f1a19b9e7c272b4402a50b8))
* **cache:** remove custom remote product integration ([89ff99a](https://github.com/twangodev/twiki/commit/89ff99a680bdaa83628ff4e249e067cf9f88d4a2))
* **cache:** standardize bundled production product transport ([b02e110](https://github.com/twangodev/twiki/commit/b02e110dbb946388a505ca3fff6b277002b56f92))

## [0.3.0](https://github.com/twangodev/twiki/compare/v0.2.0...v0.3.0) (2026-10-18)


### ⚠ BREAKING CHANGES

* standardize environment variable names

### Features

* **navigation:** support configurable course groups ([9a0e342](https://github.com/twangodev/twiki/commit/9a0e342a496aa9d934ad55f4f3dea51de060da7a))


### Bug Fixes

* **rendering:** keep article content within narrow viewports ([56c9ec1](https://github.com/twangodev/twiki/commit/56c9ec101a57cda89244de759d936eade11b0a9f))


### Code Refactoring

* standardize environment variable names ([5f2f094](https://github.com/twangodev/twiki/commit/5f2f0945d78fce4d36837ffe5a61d7902a17584d))

## [0.2.0](https://github.com/twangodev/twiki/compare/v0.1.1...v0.2.0) (2026-10-12)


### Features

* **demo:** configure twiki.twango.dev deployment ([f84f79a](https://github.com/twangodev/twiki/commit/f84f79a338382f73b6b98f7de010dce6333b418f))
* **docs:** generate documentation from Commander and shared config schema ([4eb7028](https://github.com/twangodev/twiki/commit/4eb7028902cace1fabcf31e5ed795a9e058ea6af))


### Bug Fixes

* recover diagram validation from broken font settings ([c19450c](https://github.com/twangodev/twiki/commit/c19450c037faa46334156638698d4af3cdd7a0f9))
* standardize browser tooling and test suites ([c20bcae](https://github.com/twangodev/twiki/commit/c20bcae2fca2c45dd7fa13d20a1589153b346007))
