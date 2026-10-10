---
title: Static hosting
---

# Static hosting

Set `publication` to `public`, then run:

```sh
bunx twiki build --target static
```

Publish the contents of `.twiki/output` to your static host. The host must support extensionless HTML URLs or equivalent clean-URL rewrites. Test your host's handling of nested routes and 404 pages.

Static export contains public content and has no authentication service. Twiki refuses static export for private or policy-based publication. Use [[guides/cloudflare|Cloudflare]] when you need authenticated private content.

Do not run `twiki deploy` for a static export; that command uploads an existing Cloudflare Worker build. See [[reference/cli|CLI reference]].
