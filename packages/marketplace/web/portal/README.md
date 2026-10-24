# Kushui product portal

The static homepage for `https://kushui.shop/` links to the OpenPencil plugin
marketplace at `/marketplace/` and the existing ChatDeep product website at
`/chat-deep/`. The existing ChatDeep login, downloads, and API routes keep their
addresses.

Build from the workspace root:

```sh
bun run portal:build
```

Publish `dist/index.html` and `dist/portal-assets/main.css` to an independent
`/var/www/kushui-portal/releases/<release>/` directory and atomically switch
`/var/www/kushui-portal/current`. The homepage uses no JavaScript or external
assets. Keep the ChatDeep product files and the marketplace service separate
from this public entry page.
