---
title: Cloudflare configuration
---

# Cloudflare configuration

A public Worker with a pre-provisioned custom domain:

```json twiki-config
{
  "version": 1,
  "contentDir": "notes",
  "publication": "public",
  "site": {"name":"My notes","url":"https://notes.example.com"},
  "cloudflare": {
    "name": "my-notes",
    "workers_dev": false,
    "preview_urls": false,
    "routes": [{"pattern":"notes.example.com","custom_domain":true}]
  }
}
```

This is configuration, not a provisioning command. Supply the real account ID and API token through environment variables, provision the Worker and domain, then follow [[guides/cloudflare|Cloudflare deployment]]. See [[guides/authentication|Authentication]] before adding private content.
