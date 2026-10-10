---
title: Troubleshooting
---

# Troubleshooting

## Static export refuses to build

Set `publication` to `public` only when you intend to publish the vault. Static hosts cannot authenticate private readers. Otherwise use [[guides/cloudflare|Cloudflare]].

## Deployment requires explicit Cloudflare configuration

Add a `cloudflare` object and build with `--target cloudflare`. `deploy` uploads an existing build; it does not build or provision resources. Check the account ID and token environment variables.

## Custom domains differ

The incremental deployer refuses to change routing implicitly. Provision the expected domain and disable development/preview endpoints before retrying. See [[guides/cloudflare|Cloudflare deployment]].

## A note is missing

Check `contentDir`, publication rules and discovery mode. Git mode includes tracked files. Hidden folders and unsafe paths are excluded. Link the note from a home or folder index.

## A worksheet cannot render

Install R and its declared packages in the build environment. Confirm the font and renderer environment matches any cached worksheet products. Rendering never installs missing packages automatically.

## Extra flags are rejected

Use [[reference/cli|CLI reference]] to check which command owns an option. Pass Vite or Wrangler arguments after `--`, for example `bunx twiki dev -- --port 5174`.
