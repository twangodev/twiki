# Documentation deployment

The `ci.yml` workflow tests the CLI and engine and builds both targets. On a push
to `main` (or a manual run on `main`), a separate `deploy` job publishes the
validated Cloudflare build to https://twiki.twango.dev. Pull requests never deploy.

The Cloudflare build is archived before static export, transferred as a verified
Actions artifact, and deployed without rebuilding. Production deployments run
one at a time. The deployment job finishes after uploading the validated build.

Configure these GitHub Actions values:

- Secret `CLOUDFLARE_API_TOKEN`: deployment access for the Twiki Worker.
- Variable `CLOUDFLARE_ACCOUNT_ID`: the account containing that Worker.

The `production` environment allows only `main`. Cloudflare credentials are
available only to the upload step, not to tests, builds or pull requests. The
custom domain must already be provisioned; `twiki deploy` checks routing and
refuses to silently change it. No database or OAuth application is required for
this public documentation. Its source vault and configuration are in `documentation`.
