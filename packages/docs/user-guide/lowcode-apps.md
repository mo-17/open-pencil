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
- Analytics-ready apps with GA4, Plausible, or PostHog runtime setup and event tracking actions.
- Controlled custom head/CSS output for static meta/link/style tags and final CSS overrides.
- shadcn/ui-based output for supported interactive controls.
- Static bundles deployable to Netlify, Vercel, Cloudflare Pages, or any SPA host.

## Desktop vs Browser

| Capability                              | Desktop app             | Browser app                         |
| --------------------------------------- | ----------------------- | ----------------------------------- |
| Edit design and lowcode properties      | Yes                     | Yes                                 |
| Live lowcode preview pane               | Yes                     | No, preview sidecar is desktop-only |
| Deploy controls in the preview pane     | Yes                     | No                                  |
| CLI compile/build/deploy                | Yes, from your terminal | Yes, from your terminal             |
| MCP/agent control of a running document | Yes                     | Limited by the connected tool       |

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

## Motion and Workflow Actions

Apply a Motion preset to a node from the Design inspector. For a single selection, the Motion
section also exposes a visual timeline where you can:

- Add, rename, duplicate, reorder, or remove tracks within the bounded `MotionSpec` limits. A track
  rename updates matching Play, Stop, Toggle, and Await references in events and workflows in the
  same undo step.
- Add, duplicate, remove, or pointer-drag keyframes. One drag is coalesced into one undo step, and a
  newly inserted keyframe preserves every enabled channel by sampling the surrounding segment.
- Drag the playhead to preview an exact time on the Canvas without changing document geometry.
- Edit each track's trigger, duration, delay, easing, iterations, direction, fill, and exit behavior,
  plus a per-keyframe segment easing. Easing supports named curves, a graphical/numeric cubic
  bezier editor, and MotionSpec v2 hold, steps, spring, and inertia controls.
- Enable and edit opacity, X/Y translation, X/Y scale, and rotation on each keyframe.
- Explicitly upgrade a v1 spec before authoring v2 transform origin, width/height, corner radius,
  fill/stroke, blur/shadow, bounded paths with progress and auto-rotate, vector trim, gap, row/column
  gap, and four-side padding channels. Paint controls require an existing visible paint or stroke,
  corner radius requires box geometry, and gap/padding require auto layout. VECTOR stroke width and
  trim additionally require an editable centerline; imported stroke-outline geometry can animate
  its stroke color, while width and trim remain static. Vector color channels also require drawable
  geometry for the corresponding fill or stroke role, so empty and role-mismatched imported paths
  fail closed. Unavailable controls explain that requirement, and an unsupported channel already
  present in imported data remains removable. BOOLEAN_OPERATION layers require resolved final
  `fillGeometry` before presets, preview, or timeline authoring are enabled; an existing unsupported
  MotionSpec can still be cleared. v1 data stays v1 until that explicit upgrade.

### Motion P2 authoring

MotionSpec v3 is an explicit upgrade. Existing v1/v2 tracks keep their original serialization and
playback until you choose a v3-only control. In v3, each track can use `replace`, `add`, or
`accumulate` composition, a bounded weight, and a stable priority. The Canvas, generated React
runtime, fixed-time export, and public Motion Runtime SDK resolve the same ordering rules.

Use the P2 panels according to the level of behavior you are authoring:

- **Scene timeline** — Select a page or frame, then add descendant tracks as cues. Sequences can run
  on page/frame enter, page/frame exit, or through the manual runtime API. Zoom and snap the ruler,
  add markers, select several cues, translate or scale their timing, and use Auto Keyframe without
  splitting one gesture into multiple undo entries.
- **Motion recipes** — Select the participating layers, define stable role assignments and bounded
  numeric parameters, and save the complete multi-node snapshot. Compatibility is checked before
  apply, and applying every role is one undoable transaction. Personal recipes can be imported or
  exported as JSON; CLI and MCP/AI use the same strict recipe format.
- **Continuous drivers** — Select a page or frame that owns direct-progress-safe tracks. Add a
  scroll, pointer, drag, visibility, page-state, document-state, or variable input; choose its target
  track; then set input min/max, dead zone, clamp, and reverse. The preview slider samples the same
  result without changing authored geometry. Generated apps scope listeners to that owner, suppress
  the driven track's automatic trigger, coalesce updates into one frame, and clean up listeners and
  observers on unmount.
- **Prototype transitions** — Add navigate, back, open-overlay, or close-overlay connections with
  click or bounded after-delay triggers. Configure interruption and forward/reverse playback.
  Smart Match uses an explicit stable key on corresponding layers, interpolates matched geometry,
  dissolves unmatched layers, and applies the authored deterministic fallback when matching is
  ambiguous or reduced motion is active.
- **Motion paths** — Upgrade a polyline path to the v3 cubic representation, add or remove cubic
  segments, and turn on canvas editing. The overlay exposes focusable endpoints and control handles;
  drag them or use Arrow keys (Shift for a larger step). One drag is one undo step, Escape restores
  the starting path, and nested transforms, rotation, flips, pan, and zoom are accounted for. Path
  traversal uses a bounded arc-length table for constant-speed progress and optional direction
  following.
- **Advanced channels** — v3 can animate multiple indexed paints and effects, gradient stops,
  independent corner radii, text reveal, supported variable-font axes, mask-safe properties, and
  topology-compatible vector morphs. Controls remain disabled with a concrete capability reason
  when the selected layer cannot reproduce a channel; imported unsupported values remain removable.
- **Generated effects** — Add one bounded noise, shimmer, scanline, or particle layer. Only preset,
  time, seed, color, density, and resource-budget data is stored—never shader source, arbitrary code,
  or a URL. Canvas, generated apps, and fixed-time export use the same deterministic seed and an
  explicit static/disabled reduced-motion fallback.

Use **Animation export** for a selected node or scene owner. PNG sequence and the deterministic
GIF89a encoder are available without an external binary. Browser builds expose VP8 WebM only when
WebCodecs reports the required capability and use an explicit opaque-only contract. Desktop CLI and
MCP can additionally discover FFmpeg for WebM or optional MP4 output. Choose the frame rate, loop
count, and reduced-motion policy before export; progress and cancellation apply to rendering and
encoding. Tauri and encoded CLI/MCP files use strict atomic no-clobber publication. A CLI/MCP PNG
sequence exclusively claims its directory and no-replace hard-links each frame; successful command
completion plus `manifest.json` marks the complete sequence. Browser animation exports hand a fully
encoded payload to the browser download manager, whose own collision policy controls renaming or
overwrite confirmation. Failed or cancelled work cleans only output owned by that export.

The same `export_motion_animation` operation is available to built-in AI and MCP. Built-in AI opens
the app save surface for PNG-sequence ZIP or GIF output and honors request cancellation, but its chat
transcript does not yet show per-phase progress. MCP reports progress when the client supplies a
progress token and restricts every output path to `OPENPENCIL_MCP_ROOT`.

MotionSpec v3 collaboration uses stable track/keyframe identities and nested CRDT fields, so edits to
different channels or timings merge without replacing the whole timeline. The collaboration panel
shows bounded conflict notices plus remote playheads and selections; deleted identities remain
tombstoned until an explicit compaction boundary. v1/v2 continue using their legacy opaque snapshot
and are never migrated merely by opening a collaborative document.

The preset library groups the built-in entrance, interaction, emphasis, and loop recipes. Search by
name or behavior, keep personal favorites, and point at or keyboard-focus a card to preview it on the
current selection without changing the document or adding an undo entry. A multi-selection can add
a spatially ordered delay with forward or reverse direction and linear or eased rhythm.

Use **Save current** to capture the selected node's complete MotionSpec as a personal preset. Personal
presets and favorites are user settings rather than document data. The local settings envelope stores
both, while portable export contains the versioned library metadata and preset definitions but
deliberately omits favorites: those remain personal and are not shared. Copy/paste the JSON or use
the file import/export buttons;
browser sessions use the browser picker/download flow and Tauri uses native file dialogs. Import
validates the complete payload before merging it. Applying a personal preset always writes a complete
MotionSpec snapshot to each node, so the animation continues to work after `.fig` save/reopen,
copy/paste, collaboration, component instance sync, and compilation even on a machine that does not
have the original personal library. Renaming, updating, or deleting the library entry never silently
rewrites nodes that already used it.

Readonly shared libraries retain publisher, source, accepted version, and newest observed version
metadata. Accept a bounded manifest explicitly, run **Check for update** against its declared file or
HTTP(S) source, and use **Accept update** only after reviewing the new version; checking never
silently replaces the accepted snapshot. The CLI exposes the same publish/import/check/accept flow.

Signed **Team animation libraries** extend that flow with Ed25519 publisher verification, engine
version ranges, bounded numeric tokens, parameterized recipes, deterministic update diffs, explicit
accept/reject review, verified history, and rollback. Import requires both the signed manifest and
the trusted publisher public key. Applying an entry expands it into a complete document snapshot, so
the design and generated app do not depend on the registry remaining online. A signature, digest,
range, token, or role mismatch fails before the document is edited.

Lowcode Events and Workflows include **Play motion**, **Stop motion**, **Toggle motion**, and
**Await motion** actions. Choose a target node with valid Motion data, then run all of its tracks or
one track by id. Await supports a bounded timeout and optional stop-on-timeout behavior. Generated React apps
resolve every rendered instance with the target `data-node-id`; manual playback uses the same
bounded WAAPI runtime as interactive triggers and temporarily suppresses that instance's CSS
mount/loop animation to avoid competing transforms. Stopping cancels both manual and matching
automatic playback and restores the node's authored static state.

When a generated multi-page React app runs a lowcode **Navigate** action, it first starts every
mounted `pageExit` track on the current page and waits for their WAAPI playback before changing the
route. Navigation still proceeds when the Motion runtime or matching tracks are absent. The wait has
a four-second hard ceiling; an infinite or stalled exit animation is canceled at that boundary so it
cannot trap the user on the old route. Explicit Play, Stop, Toggle, and Await motion workflow actions
keep their existing independent semantics.

Canvas preview uses a prepared reference sampler so channel discovery, timing defaults, and the
reduced-motion decision are resolved once per preview target. The sampler can select one trigger,
explicit track ids, or every track in source order; when tracks write the same channel, the later
contributing track wins. Its diagnostic form reports each track's trigger, exit behavior, progress,
contribution, completion, and isolated visual value. Browser parity tests compare this reference
against generated CSS and controlled WAAPI checkpoints for every visual channel.

While a development preview is running, enable **Motion** in the preview toolbar to open **Motion
Debug**. It reports structured runtime entries such as the node and track, trigger and playback
source, play state, progress, current time, reduced-motion policy, exit behavior, timing, and compile
warnings, plus the number of active runtime-managed animations. The generated runtime responds to
live `prefers-reduced-motion` changes while preserving unaffected, controlled, stopped, and active
hover/focus/press/click/in-view state. Performance and cleanup coverage includes repeatable
100/500-target sampling and browser checks that removed Motion containers release their animations
and inspection entries. A real Tauri automation ACK also covers the initially empty Debug state and
adding the first mount track: the preview performs one automatic full reload, requires no manual
refresh, and exposes the completed track. Interactive triggers and live reduced-motion switching are
covered in browser/runtime tests rather than claimed as manually verified Tauri behaviors.

### Figma native Motion adapter (Beta)

OpenPencil keeps `MotionSpec` as the canonical editable source and writes a strict shared-plugin-data
mirror that the bundled development Figma plugin can inspect. That mirror is metadata, not a native
Figma timeline. Native Motion is created only when the
[official Motion Plugin API](https://developers.figma.com/docs/plugins/api/Motion/) applies a
generated, validated plan inside Figma. Figma introduced these read/write methods in
[Plugin API Update 130](https://developers.figma.com/docs/plugins/updates/).

The currently verified native subset is deliberately narrow: exactly one `mount` track, zero delay,
one normal iteration, `both` fill, no exit animation, and keyframes using opacity, X/Y translation,
rotation, or X/Y scale with standard or cubic-bezier easing. Unsupported triggers, loops, direction,
exit behavior, properties, duplicate lowered offsets, malformed metadata, and unapproved
shared-timeline growth fail closed. With the default `replace-owned` policy, foreign/native-edited
tracks also fail closed. The explicit destructive `replace-all` opt-in may remove foreign animation
styles and supported manual property tracks; indexed paint/stroke/effect tracks and unknown future
property fields still fail closed.

Use the inspector's **Figma native Motion** card for a compatibility diagnosis and copyable script,
the extended MCP tool `get_figma_motion_adapter` for automation, or the CLI. The CLI defaults to a
plan and can compare a detached official-API readback before generating anything:

```sh
openpencil motion inspect figma-motion-snapshot.json --json
openpencil motion apply app.fig --node 1:23 --current figma-motion-snapshot.json --json
openpencil motion apply app.fig --node 1:23 --emit script -o apply-motion.js
openpencil motion clear figma-motion-snapshot.json --emit snapshot -o clear-motion.json
```

`motion inspect`, `apply`, and `clear` operate on files, plans, and generated artifacts only; they do
not connect to Figma Desktop. An explicitly emitted apply script requires exactly one selected Figma
node by default and replaces only tracks carrying a verified OpenPencil ownership marker.
`--target-node`, `--conflict-policy replace-all`, and `--allow-timeline-growth` are explicit opt-ins.
The safe apply/clear snapshots contain no undocumented raw timeline payloads. Every supported apply
script performs capability checks, readback verification, and rollback on failure. Unit,
mock-plugin, CLI, and OpenPencil UI tests cover this contract; final acceptance in a live Figma
Desktop document remains a manual ACK boundary while Figma's Motion Plugin API is Beta. The older
`motion figma-adapter` command remains available as a compatibility shortcut for script generation.

Motion remains declarative JSON: these controls do not accept arbitrary JavaScript or CSS. The
OpenPencil `MotionSpec` is preserved in `.fig` plugin data, but it is not the same as Figma's native
prototype or Motion timeline. The personal preset library itself does not travel inside `.fig`; use
its explicit JSON export when another author should receive the reusable entry. Imported `.pen`
documents can round-trip MotionSpec through the versioned `metadata.openPencil` extension using the
Pen package, Core IO registry, or CLI. That writer is intentionally Motion-only and rejects other
edits rather than producing a lossy `.pen`. Component refs and nested descendant overrides preserve
inheritance, while explicit clears use a tombstone so Motion does not return after reopen. Unknown
future metadata is preserved when untouched and rejected on conflicting Motion edits. The desktop
editor still imports `.pen` into a `.fig` save flow for general editing.

Four final checks intentionally remain manual: native operating-system JSON open/save dialogs,
persistence across an actual desktop application-process restart, desktop `.fig` save/reopen, and a
live Figma Desktop apply/readback/rollback run through the official Motion Plugin API Beta. Unit,
browser, mock-plugin, and Tauri automation results are not presented as substitutes for those four
checks.

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

## Analytics

Lowcode analytics is document-level configuration plus event/workflow actions. Configure the root document with a provider and public tracking id, then add `trackEvent` actions to click, submit, or workflow chains.

Supported providers:

- **GA4** — use your measurement id, for example `G-...`.
- **Plausible** — use the tracked domain as the id; optionally set a self-hosted script endpoint.
- **PostHog** — use the project API key; optionally set a self-hosted API host.

When analytics is enabled, generated apps emit `src/_lowcode_analytics.ts`, load the provider script, and send an initial `page_view`. Multi-page apps can also send `page_view` on route changes. Turn off **Track page views** when you only want explicit `trackEvent` actions.

Privacy gates are available on the document Analytics panel:

- **Respect Do Not Track** keeps provider scripts unloaded and events no-op when the browser reports DNT.
- **Require consent before tracking** keeps analytics no-op until consent is granted. Generated apps include a small preference center for this mode: **Necessary** is always active, while **Analytics** controls page views and explicit `trackEvent` calls. **Accept all** calls `__opGrantAnalyticsConsent()` and persists a provider-scoped grant in `localStorage`; **Decline all** calls `__opRevokeAnalyticsConsent()` and persists a denial; **Save preferences** stores the current Analytics category choice. The banner leaves an **Analytics preferences** button so users can reopen and change the choice later. The Analytics panel can also override the banner body copy, Analytics category description, privacy-policy link, whether the Analytics category starts checked before the user saves a preference, and an EEA-style opt-in starter preset. The preset only changes generated default behavior; confirm final compliance requirements with your own legal/product review. You can call those helpers from your own generated app flow if you replace the default banner with a custom preference experience.

Analytics ids are public client-side identifiers, not secrets. Do not put server-side API keys, write keys, or provider admin tokens in the document.

## Paid Actions

Use a **Stripe checkout** action when a button should start a paid checkout flow. The generated
app does not talk to Stripe directly. It sends a `POST` request to your own server endpoint,
passes any authored payload fields as JSON, and redirects to the returned `url` or `checkoutUrl`.

Use a **Stripe customer portal** action when a signed-in customer should manage billing. It uses
the same author-owned endpoint pattern, but redirects to the returned `url` or `portalUrl`.

Author the action with:

- **Endpoint** — a root-relative or `http(s)` endpoint, with optional lowcode template values such
  as `/api/${priceId}/checkout`.
- **Payload entries** — JSON fields such as `priceId` or `quantity`; each value is a lowcode
  expression.
- **Send Supabase bearer token** — optional. When enabled and the document has a valid Supabase
  config, the generated app reads the current Supabase session and adds `Authorization: Bearer ...`
  if the user is signed in. Leave it off for public or anonymous endpoints.
- **Error target** — optional document state that receives request/response failures.

Keep all Stripe secret keys, webhook signing secrets, idempotency, subscription lifecycle, portal
session creation, and customer lookup on your backend, such as a Supabase Edge Function or your
own API route. The document and generated SPA should contain only public business parameters like
price ids, quantities, plan names, or the current user's public/customer mapping token.

The onboarding demo includes a server-side template at
`packages/demos/lowcode/supabase/functions/demo-checkout/index.ts`. It expects these environment
variables on the Edge Function, not in the lowcode document:

- `STRIPE_SECRET_KEY`
- `PUBLIC_SITE_URL`
- `STRIPE_PRICE_STARTER`
- `STRIPE_PRICE_PRO`
- `STRIPE_PRICE_ENTERPRISE`
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` when you want authenticated checkout to create or
  reuse a server-side `billing_customers` mapping.
- `STRIPE_CHECKOUT_MODE`, optional; defaults to `subscription`, set it to `payment` for one-time
  Checkout prices.

The template posts to Stripe's Checkout Sessions API and returns `{ url }`, which is the response
shape the lowcode `stripeCheckout` action redirects to. Enable **Send Supabase bearer token** on
the checkout action to exercise the logged-in path: if the request includes a Supabase bearer
token, the template verifies the user, creates or reuses a Stripe Customer, upserts
`billing_customers`, and passes `customer` to Stripe Checkout. Anonymous demo calls still use
`customer_email` only.

For customer billing management, the demo folder includes a server-side portal template at
`packages/demos/lowcode/supabase/functions/demo-customer-portal/index.ts`. A generated
`stripeCustomerPortal` action can call that endpoint and redirect to the returned `{ url }` or
`{ portalUrl }`. Enable **Send Supabase bearer token** for this action. The template verifies the
caller through Supabase Auth and reads
`billing_customers.stripe_customer_id` with `SUPABASE_SERVICE_ROLE_KEY`; production endpoints must
keep that service role key server-side and must not trust a browser-sent customer id.

For durable billing state, start from
`packages/demos/lowcode/supabase/schema/billing.sql`. It defines `billing_customers`,
`billing_subscriptions`, `billing_entitlements`, `billing_invoices`, `billing_payments`,
`billing_refunds`, `billing_disputes`, `billing_tax_summaries`, `billing_usage_summaries`,
`billing_orders`, and `billing_events`; the `billing_events.stripe_event_id` primary key is the
webhook template's durable idempotency guard. The schema also includes service-role RPC helpers for
subscription, entitlement, invoice, tax summary, usage summary, payment, refund, dispute, and order
read-model updates. Stripe can deliver related webhooks out of order, so cross-event read-model ids
are stored as text instead of requiring foreign keys to subscription or payment rows that may not
exist yet. Adapt the schema to your product's order/subscription model before live use.

The demo folder also includes a server-side webhook template at
`packages/demos/lowcode/supabase/functions/demo-stripe-webhook/index.ts`. Register that endpoint in
the Stripe dashboard for `checkout.session.completed`, `customer.subscription.*`, `invoice.paid`,
`invoice.payment_failed`, `payment_intent.succeeded`, `payment_intent.payment_failed`, and
`charge.refunded`, `charge.dispute.created`, `charge.dispute.updated`, and `charge.dispute.closed`
events. The template verifies `Stripe-Signature` with `STRIPE_WEBHOOK_SECRET`, routes checkout,
subscription, invoice, payment, refund, and dispute lifecycle events, writes the event into
`billing_events` with `SUPABASE_SERVICE_ROLE_KEY`, and treats duplicate event primary-key conflicts
as Stripe retry duplicates. Subscription lifecycle events call `record_stripe_subscription_event`,
so the event insert, subscription upsert, and `billing_entitlements` refresh share one database
transaction. Invoice, payment, refund, and dispute events call matching RPCs so users can query
their own billing history, invoice tax summaries from `automatic_tax` / `total_taxes`, dispute
status, invoice line usage snapshots from `lines.data`, and a minimal `billing_orders` read model.
Production apps with invoices that can contain more line items than the webhook payload includes
should fetch the remaining invoice lines server-side before treating usage rows as complete.
Production apps with a richer order, tax, usage, or risk workflow should extend the same RPC-style
transaction boundary.

## Custom Head and CSS

Generated apps can carry document-level custom head metadata for static tags and CSS-only overrides:

- `<meta>` entries with `name`, `property`, or `http-equiv`.
- `<link>` entries such as `preconnect`, `preload`, `stylesheet`, or icon links.
- Inline `<style>` CSS snippets in `index.html`.
- Custom CSS appended at the end of `src/index.css`, after generated theme and Tailwind source rules.

This is a controlled escape hatch. Do not use it for JavaScript: raw `<script>` tags, inline event handlers, and external JS modules are intentionally not emitted. The editor shows pre-deploy CSP hints for inline head styles, external stylesheet/preload links, and external resources referenced from custom CSS. For production, still confirm your host's CSP allows any custom stylesheet or inline style you add.

For a live deploy check, inspect the HTML response headers and browser console on the deployed
URL. Confirm custom `<link>` resources load, inline head styles are not blocked by CSP, and custom
app CSS appears after generated Tailwind/theme rules. If you use Netlify, Vercel, or Cloudflare
Pages header configuration, keep that configuration with the deployment so later CSP changes are
auditable.

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

The repository includes a user-facing onboarding fixture at
`packages/demos/lowcode/lowcode-onboarding-demo.fig`. Rebuild it from the repo root with:

```sh
bun tools/lowcode/src/make/onboarding-demo.ts
```

The fixture is intentionally safe to share: it uses an example Supabase URL/anon key, a Plausible
example domain, and a demo `/api/demo-checkout` endpoint so the compiler can verify Supabase
queries/mutations, validation, workflows, Stripe checkout and customer portal redirects, analytics
hooks, i18n, shadcn/ui output, and custom head/CSS without embedding real external credentials.
Replace those values before any live provider test.

Use this checklist when validating a lowcode document before sharing it:

- A preview opens in the desktop app and renders the selected page.
- A button click updates document state or triggers a workflow.
- A form shows validation errors and clears them after valid input.
- A Supabase list or query renders data with loading and error states.
- A Supabase mutation writes data and reports errors to a visible state target.
- A Stripe checkout action calls a mock or real server endpoint and redirects only when the
  response includes `url` or `checkoutUrl`.
- A Stripe customer portal action calls a mock or real authenticated server endpoint and redirects
  only when the response includes `url` or `portalUrl`.
- A workflow with optional parameters runs from at least one event.
- An analytics `trackEvent` action fires in preview/build output when a test provider id is configured.
- i18n mode emits the expected locale catalog and switches direction for RTL locales.
- shadcn/ui mode renders supported controls without losing design classes.
- `openpencil build app.fig -o dist` completes.
- A provider deploy returns a live URL, or the static `dist` folder works on your host with an SPA fallback to `index.html`.

## Current Boundaries

- Lowcode app output is a static React SPA, not SSR or SSG.
- Secrets must not be embedded in designs. Use Supabase anon keys and provider tokens through CLI flags or environment variables.
- Stripe checkout and customer portal actions are frontend triggers only. Put Stripe secret keys,
  webhooks, subscriptions, portal sessions, and customer lookup on your server endpoint.
- Analytics config is client-side only. Use public GA4 / Plausible / PostHog project ids, enable consent/DNT gates when required, and verify CSP requirements for your deployment.
- Custom head/CSS is static and CSS-only. JavaScript snippets are not emitted; review CSP for custom stylesheet or inline style usage.
- Browser editing works, but the live preview sidecar and deploy controls are desktop-only.
- Cloudflare deploys require an existing account id and Pages project name.
- For multi-page apps, your host must route unknown paths back to `index.html`.

## Common Fixes

- Preview says it is unavailable: use the desktop app; the sidecar is not available in the browser app.
- Supabase works in preview but not production: pass `--supabase-url` and `--supabase-anon-key`, or set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` before `build` / `deploy`.
- Analytics events do not appear: confirm the provider id, check that the host allows the provider script in CSP, and wait for the provider dashboard's normal ingestion delay.
- A deployed route returns 404 after refresh: configure the host as an SPA and route unknown paths to `index.html`.
- Cloudflare deploy fails before upload: pass `--account-id`, set `CLOUDFLARE_ACCOUNT_ID`, or use `--site <account>/<project>`.
- i18n output has missing translations: inspect the emitted `src/locales/_coverage.json` and fill the target locale catalog.
