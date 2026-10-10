---
title: Publication and authentication
---

# Publication and authentication

An explicit CLI project defaults to private publication. Choose a mode deliberately:

| Mode | Behavior |
| --- | --- |
| `private` | Notes are private by default. |
| `public` | Publish the vault publicly; required for static export. |
| `policies` | Resolve publication from policy files. |

For policy-based publication, review your `publish.yaml` rules and test the resulting public edition before deployment. Publication is separate from authentication: private notes do not become publicly accessible merely because a Worker is deployed.

A `DB` D1 binding enables GitHub authentication. Supply the owner GitHub ID and client ID through Worker variables, configure the GitHub application's callback for your site origin, and provide `GITHUB_CLIENT_SECRET` and a `BETTER_AUTH_SECRET` of at least 32 characters through Cloudflare. The GitHub callback URL is `https://your-domain/api/auth/callback/github`. Apply the shipped database migrations before serving authentication traffic.

Without a `DB` binding, Twiki disables authentication and private assets remain unavailable. Public documentation, including this site, does not need a database or account controls.

Static hosts cannot enforce private access. See [[guides/static-hosting|Static hosting]] and [[reference/configuration|Configuration reference]].
