---
title: Lowcode Apps
description: Turn OpenPencil pages into React apps with preview, Supabase, workflows, i18n, shadcn/ui, build, and deploy.
---

# Lowcode Apps

OpenPencil can turn design pages into runnable React + TypeScript + Tailwind apps. Use it when a design needs to become a working static SPA with state, forms, API calls, Supabase data, i18n, and deployable output.

Lowcode apps build on normal OpenPencil documents. You still draw frames, text, buttons, inputs, images, components, and auto-layout as usual; the lowcode panels add behavior on top of those nodes.

## What You Can Build

- Marketing pages, product pages, dashboards, forms, and data views.
- Multi-page SPAs with `react-router-dom` routes.
- Controlled forms with validation, remote validators, and submission workflows.
- Supabase-backed apps with auth, table queries, mutations, and storage uploads.
- Local document state and page state for filters, toggles, counters, and UI state.
- i18n-ready apps with locale catalogs, RTL direction handling, and a locale switcher.
- shadcn/ui-based output for supported interactive controls.
- Static bundles deployable to Netlify, Vercel, Cloudflare Pages, or any SPA host.

## Desktop vs Browser

| Capability | Desktop app | Browser app |
|------------|-------------|-------------|
| Edit design and lowcode properties | Yes | Yes |
| Live lowcode preview pane | Yes | No, preview sidecar is desktop-only |
| Deploy controls in the preview pane | Yes | No |
| CLI compile/build/deploy | Yes, from your terminal | Yes, from your terminal |
| MCP/agent control of a running document | Yes | Limited by the connected tool |

For browser-only use, keep editing in the web app and run `openpencil compile`, `openpencil build`, or `openpencil deploy` against the saved `.fig` / `.pen` file from your terminal.

## Authoring Flow

1. Design the page with regular OpenPencil nodes.
2. Use the Design panel to add lowcode behavior:
   - **State** for document or node-local values.
   - **Bindings** for text, form values, visibility, list data, and render conditions.
   - **Events** for clicks, form submit, navigation, API calls, Supabase actions, and workflows.
   - **Validation** for required fields, numeric/text rules, and remote validators.
   - **Responsive** overrides for breakpoint-specific layout and visibility.
3. Open the lowcode preview pane in the desktop app.
4. Choose preview options such as UI kit or i18n target locales.
5. Build or deploy when the preview behaves correctly.

## First Successful Path

For a first test, keep the app tiny:

1. Create one page with a frame, a text node, one input, and one button.
2. Bind the input to document state, for example `email`.
3. Add a required validation rule to the input.
4. Add a button click event that shows a toast or updates another state value.
5. Open the desktop preview pane and confirm the form state changes.
6. Run `openpencil build app.fig -o dist`.
7. Deploy the `dist` folder or run `openpencil deploy` with a provider token.

This path proves the core loop before you add Supabase, workflows, multiple pages, or i18n.

## Preview

The desktop preview pane compiles the current page into a local React app and reloads when the design changes. It also includes a canvas-to-preview bridge, so selecting compatible nodes can keep the design and preview surfaces aligned.

Preview options:

- **UI kit** — choose plain Tailwind output or shadcn/ui output for supported controls.
- **i18n** — enable the i18n runtime and enter target locales such as `fr,ar`.
- **Deploy** — use the deploy controls when you are ready to publish.

The preview pane is Tauri-only because it starts a local compiler dev server sidecar.

## Compile Source

Use `compile` when you want a full editable project:

```sh
openpencil compile app.fig -o generated-app
cd generated-app
npm install
npm run dev
```

Useful flags:

```sh
openpencil compile app.fig -o generated-app --page "Landing"
openpencil compile app.fig -o generated-app --ui-kit shadcn
openpencil compile app.fig -o generated-app --i18n --locale fr --locale ar
openpencil compile app.fig -o generated-app --source-locale ar
```

`--page` restricts output to one page. Without it, OpenPencil emits a multi-page app using `react-router-dom`.

## Build a Static Bundle

Use `build` when you want production-ready static files:

```sh
openpencil build app.fig -o dist
```

For sub-path hosting:

```sh
openpencil build app.fig -o dist --base /my-app/
```

For Supabase-backed apps, production credentials should come from the environment or command flags:

```sh
VITE_SUPABASE_URL=https://example.supabase.co \
VITE_SUPABASE_ANON_KEY=... \
openpencil build app.fig -o dist
```

or:

```sh
openpencil build app.fig -o dist \
  --supabase-url https://example.supabase.co \
  --supabase-anon-key ...
```

The emitted app uses design-time Supabase values only as a fallback. Prefer environment-specific values for staging and production.

## Deploy

Use `deploy` to build and upload in one command.

Netlify:

```sh
NETLIFY_AUTH_TOKEN=... \
openpencil deploy app.fig --provider netlify --site my-site
```

Vercel:

```sh
VERCEL_TOKEN=... \
openpencil deploy app.fig --provider vercel --site my-project
```

Cloudflare Pages:

```sh
CLOUDFLARE_API_TOKEN=... \
openpencil deploy app.fig \
  --provider cloudflare \
  --account-id <account-id> \
  --site my-pages-project
```

Cloudflare can also read the account id from `CLOUDFLARE_ACCOUNT_ID`, or from `--site <account>/<project>`.

Add `--json` in automation to receive the provider, deployment id, URL, and file count.

## Demo Checklist

Use this checklist when validating a lowcode document before sharing it:

- A preview opens in the desktop app and renders the selected page.
- A button click updates document state or triggers a workflow.
- A form shows validation errors and clears them after valid input.
- A Supabase list or query renders data with loading and error states.
- A Supabase mutation writes data and reports errors to a visible state target.
- A workflow with optional parameters runs from at least one event.
- i18n mode emits the expected locale catalog and switches direction for RTL locales.
- shadcn/ui mode renders supported controls without losing design classes.
- `openpencil build app.fig -o dist` completes.
- A provider deploy returns a live URL, or the static `dist` folder works on your host with an SPA fallback to `index.html`.

## Current Boundaries

- Lowcode app output is a static React SPA, not SSR or SSG.
- Secrets must not be embedded in designs. Use Supabase anon keys and provider tokens through CLI flags or environment variables.
- Browser editing works, but the live preview sidecar and deploy controls are desktop-only.
- Cloudflare deploys require an existing account id and Pages project name.
- For multi-page apps, your host must route unknown paths back to `index.html`.

## Common Fixes

- Preview says it is unavailable: use the desktop app; the sidecar is not available in the browser app.
- Supabase works in preview but not production: pass `--supabase-url` and `--supabase-anon-key`, or set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` before `build` / `deploy`.
- A deployed route returns 404 after refresh: configure the host as an SPA and route unknown paths to `index.html`.
- Cloudflare deploy fails before upload: pass `--account-id`, set `CLOUDFLARE_ACCOUNT_ID`, or use `--site <account>/<project>`.
- i18n output has missing translations: inspect the emitted `src/locales/_coverage.json` and fill the target locale catalog.
