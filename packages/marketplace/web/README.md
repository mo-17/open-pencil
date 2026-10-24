# OpenPencil Market website

The standalone, Chinese-language marketplace at `https://kushui.shop/marketplace/`
uses the live signed marketplace snapshot. It offers search, category filters,
plugin details, and instructions for reviewing and installing a plugin in the
editor. Browsing the website does not install or enable plugins.

From the workspace root:

```sh
bun run marketplace:build:web
bun --filter @open-pencil/marketplace check:web
bun run marketplace:test:web
```

The static output is `packages/marketplace/web/dist`. Serve it under
`/marketplace/` on the same origin as `/v1/snapshot`; the marketplace API remains
the source of catalog metadata. The browser verifies snapshots with the pinned
public root key and rejects expired or invalid snapshots. A root-key rotation
requires an explicitly reviewed website rebuild.

Deploy static releases into `/var/www/openpencil-marketplace/releases/` and
switch its `current` symlink atomically. Keep the API service and its signing
keys, publisher data, and renewal process separate from these public files.

The [curated tools](./curated-plugins.md) reuse built-in audits and exporters as
independent marketplace packages. Their editor host adapters ship with the app;
older editor builds report incompatible adapters until updated.
