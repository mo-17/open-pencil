# Lowcode GUI ACK Test Steps

> 2026-06-24 handoff for manual browser/Tauri verification after the §14 local Libraries panel, #10 preview i18n/uiKit toggle, and #11 lowcode authorization GUI work.
> 2026-06-25 update: add the Phase 5 Netlify deploy restore live ACK checklist.
> 2026-06-30 update: add the Phase 5 §10 Analytics and §11 Custom Head/CSS GUI ACK checklists.
> 2026-07-01 update: add the Phase 5 §12 Stripe checkout/customer portal GUI/runtime ACK checklist.
> 2026-07-01 update: add the Phase 5 operator ACK checklist for Analytics, Custom Head/CSS,
> onboarding, and Stripe billing webhooks.
> 2026-07-14 update: refresh package-split imports and record the automated local Libraries ACK.

## 0. Scope

This checklist is for real app verification only. Unit, architecture, duplicate, Vue typecheck, and full `bun run check` already passed for the latest §14 commit.

For the current Phase 5 lowcode productization batch, the local branch may intentionally contain
uncommitted implementation and documentation changes before final operator ACK. Treat a non-empty
`git status --short` as acceptable only when every entry belongs to the reviewed Phase 5 batch and
local handoff/index files such as `prompt.md` and `.codegraph/` are not staged.

Primary ACK target:

- §14 Libraries panel: local manifest + library file flow, outdated status, accept update, undo/redo.

Secondary ACK targets:

- #10 Preview i18n/uiKit toolbar controls.
- #11 Lowcode GUI authorization panels for responsive overrides, component props, and optional params.
- Phase 5 §2 Netlify deploy restore live ACK.
- Phase 5 §10 Analytics GUI provider help, Track event hints, and real-provider handoff.
- Phase 5 §11 Custom Head/CSS GUI structured metadata and deploy/CSP handoff.
- Phase 5 §12 Stripe checkout/customer portal GUI authoring and generated redirect handoff.
- Phase 5 operator ACK before shipping the current lowcode productization batch.

## 1. Baseline

From repo root:

```sh
git status --short
git log -1 --oneline
git ls-remote upstream refs/heads/lowcode-rebaseline
```

Expected:

- For already committed ACK passes, the tracked working tree is clean, except local ignored
  `prompt.md` may differ.
- For the current uncommitted Phase 5 batch, any dirty entries are intentional Phase 5 files and
  have been reviewed against the pre-stage checklist in `prompt.md`; `.codegraph/` and `prompt.md`
  are never staged.
- Local head is at least `2c64609b feat(app): restore netlify deploys` for the Netlify restore ACK, or a later intended commit.
- Remote `upstream/lowcode-rebaseline` points at the same commit if the branch has already been pushed.

### 2026-07-14 automated compatibility ACK

After merging `official/master` at `1750199b`, SceneGraph imports moved from the removed legacy core
subpath to `@open-pencil/scene-graph`. The executable fixture, lowcode implementation notes, and
public documentation now use the current package/source paths, guarded by
`tests/engine/docs/lowcode-public-imports.test.ts`.

Verified locally:

- `bun run build:packages` completed successfully.
- The section 2 fixture commands created the library and consumer documents, published v1 and v2,
  imported `component-card`, and reported `outdated` from `library check`.
- `bunx playwright test tests/e2e/properties/libraries-panel.spec.ts --project=openpencil` passed,
  including manifest load, library file load, accept update, `Hello` -> `Updated`, undo, and redo.
- A browser smoke pass confirmed the root Analytics and Custom Head/CSS authoring controls render,
  provider-specific Analytics fields react to the selected configuration, and the EEA consent
  preset exposes its consent copy fields.

This is an automated local ACK only. Save/reopen checks, Tauri preview, real Analytics ingestion,
live deploy CSP headers, Stripe/Supabase backends, and provider credentials remain in the manual
handoff sections below and are not marked complete here.

## 2. Prepare §14 Fixture Files

Create a repeatable local fixture directory:

```sh
mkdir -p /tmp/open-pencil-library-ack
bun run build:packages
```

Create `library.fig` and `consumer.fig`:

```sh
bun --eval '
import { BUILTIN_IO_FORMATS, IORegistry } from "@open-pencil/core/io";
import { SceneGraph } from "@open-pencil/scene-graph";

const io = new IORegistry(BUILTIN_IO_FORMATS);

async function writeGraph(path, graph) {
  const result = await io.writeDocument("fig", graph);
  await Bun.write(path, result.data);
}

const library = new SceneGraph();
const page = library.getPages()[0];
const card = library.createNode("COMPONENT", page.id, {
  name: "Card",
  width: 240,
  height: 80
});
library.createNode("TEXT", card.id, {
  name: "Title",
  text: "Hello",
  width: 120,
  height: 24
});

await writeGraph("/tmp/open-pencil-library-ack/library.fig", library);
await writeGraph("/tmp/open-pencil-library-ack/consumer.fig", new SceneGraph());
'
```

Publish v1 and import it into the consumer:

```sh
bun packages/cli/src/index.ts library publish \
  /tmp/open-pencil-library-ack/library.fig \
  --component Card \
  --library-id design-system \
  --library-name "Design System" \
  --component-key component-card \
  --source-ref /tmp/open-pencil-library-ack/library-published-v1.fig \
  --document-output /tmp/open-pencil-library-ack/library-published-v1.fig \
  --json \
  -o /tmp/open-pencil-library-ack/manifest-v1.json

bun packages/cli/src/index.ts library import \
  /tmp/open-pencil-library-ack/consumer.fig \
  /tmp/open-pencil-library-ack/library-published-v1.fig \
  --manifest /tmp/open-pencil-library-ack/manifest-v1.json \
  --component component-card \
  --json \
  -o /tmp/open-pencil-library-ack/consumer-imported.fig
```

Modify the library to v2 and publish a newer manifest:

```sh
bun --eval '
import { BUILTIN_IO_FORMATS, IORegistry } from "@open-pencil/core/io";

const io = new IORegistry(BUILTIN_IO_FORMATS);

async function readGraph(path) {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  const { graph } = await io.readDocument({ name: path, data: bytes });
  return graph;
}

async function writeGraph(path, graph) {
  const result = await io.writeDocument("fig", graph);
  await Bun.write(path, result.data);
}

const graph = await readGraph("/tmp/open-pencil-library-ack/library-published-v1.fig");
const card = [...graph.getAllNodes()].find((node) => node.type === "COMPONENT" && node.name === "Card");
if (!card) throw new Error("Card component not found");
const title = card.childIds.map((id) => graph.getNode(id)).find((node) => node?.type === "TEXT");
if (!title) throw new Error("Card title not found");
graph.updateNode(title.id, { text: "Updated" });
await writeGraph("/tmp/open-pencil-library-ack/library.fig", graph);
'

bun packages/cli/src/index.ts library publish \
  /tmp/open-pencil-library-ack/library.fig \
  --component Card \
  --library-id design-system \
  --library-name "Design System" \
  --component-key component-card \
  --source-ref /tmp/open-pencil-library-ack/library-published-v2.fig \
  --document-output /tmp/open-pencil-library-ack/library-published-v2.fig \
  --json \
  -o /tmp/open-pencil-library-ack/manifest-v2.json

bun packages/cli/src/index.ts library check \
  /tmp/open-pencil-library-ack/consumer-imported.fig \
  --manifest /tmp/open-pencil-library-ack/manifest-v2.json \
  --json
```

Expected CLI check:

- `component-card` reports `outdated`.

## 3. §14 Browser/Tauri ACK

Start one runtime:

```sh
bun run dev
```

or, for desktop:

```sh
bun run tauri dev
```

Manual steps:

1. Open `/tmp/open-pencil-library-ack/consumer-imported.fig`.
2. Make sure no node is selected, so the right Design panel root sections are visible.
3. Find the `Libraries` section.
4. Confirm it shows one import:
   - library: `Design System`
   - component key: `component-card`
   - status before manifest load: `unknown`
5. Click `Manifest`, choose `/tmp/open-pencil-library-ack/manifest-v2.json`.
6. Confirm row status changes to `outdated`, with current version different from latest version.
7. Click `Library file`, choose `/tmp/open-pencil-library-ack/library-published-v2.fig`.
8. Confirm `Accept update` is enabled for the outdated row.
9. Click `Accept update`.
10. Confirm success text appears and the row changes to `up-to-date`.
11. Confirm the imported/cached component text changes from `Hello` to `Updated`.
12. Run undo and redo from the app UI or keyboard shortcuts.

Pass criteria:

- No console/runtime error during file load, status calculation, accept, undo, or redo.
- Accept update visibly applies the newer cached library component.
- Undo restores the pre-accept document; redo reapplies the update.
- Saving and reopening the document keeps the updated library metadata.

## 4. #10 Preview i18n/uiKit ACK

Use any lowcode document with at least one visible page. Start in Tauri if possible because preview sidecar is desktop-only.

Steps:

1. Open the lowcode preview pane.
2. Confirm toolbar controls are visible:
   - `data-test-id="lowcode-preview-uikit"`
   - `data-test-id="lowcode-preview-i18n"`
   - `data-test-id="lowcode-preview-locales"`
3. Set UI kit to `shadcn`.
4. Enable i18n.
5. Enter locales such as `en,zh-CN`.
6. Trigger preview reload/recompile.

Pass criteria:

- Preview recompiles without runtime error.
- The toolbar state remains stable across reloads.
- Generated preview still renders the selected page.
- Invalid locale text should not crash the app; it may show compile feedback if validation rejects it.

## 5. #11 Authorization GUI ACK

Use a document with lowcode nodes that can exercise the already implemented panels:

- Responsive overrides.
- Component props.
- Optional params.

Steps:

1. Select a lowcode node with responsive override fields.
2. Change a responsive override value through the GUI.
3. Select a component/instance with component props.
4. Add or update a component prop through the GUI.
5. Select a workflow/action surface that exposes optional params.
6. Add and remove one optional param.
7. Save, reopen, and verify values persist.

Pass criteria:

- Each GUI operation writes the expected lowcode field without direct JSON editing.
- Invalid input is blocked or surfaced as validation feedback.
- Save/reopen round-trip preserves valid values.
- Undo/redo works for the edited GUI values.

## 6. Phase 5 Netlify Deploy Restore Live ACK

Use this only with a real Netlify site and a deploy history entry that is safe to restore. This
checklist verifies the live provider path that unit tests cannot exercise.

Prerequisites:

- A lowcode document has at least two successful Netlify deploy history entries for the same site.
- The target history row has provider `netlify`, a non-empty site value, and a deploy id.
- The target row shows rollback support as `API candidate` and displays `restore deploy`.
- You have a current Netlify Personal Access Token with permission to restore deploys for that site.

Safety rules:

- Do not paste the token into issue text, chat, screenshots, shell history, or committed files.
- Do not save the token in a deploy target preset; it must only live in the current Deploy panel input.
- Confirm the site value points at the intended Netlify site before clicking `restore deploy`.
- Prefer a preview/staging site for the first ACK. Production restore should only be run when the target deploy is intentionally chosen.

Steps:

1. Open the lowcode preview pane and the Deploy controls.
2. Select the same provider/environment that created the Netlify history entry.
3. Find the Netlify history row that should become active again.
4. Confirm the row shows:
   - provider `netlify`
   - the expected environment
   - the intended site id or site slug
   - the expected deploy id
   - `restore deploy`
5. Enter a valid Netlify token in the token input.
6. Open browser devtools or the Tauri automation network/console inspector if available.
7. Click `restore deploy`.
8. Confirm the outgoing request is:
   - `POST`
   - `https://api.netlify.com/api/v1/sites/{site}/deploys/{deployId}/restore`
   - `Authorization: Bearer <current token>`
   - no request body is required
9. Confirm the UI reports a restore success message with the restored deploy id and URL when Netlify returns success.
10. Open the returned URL or the Netlify dashboard link and confirm the active deploy matches the intended target.
11. Reload the app and reopen Deploy controls.
12. Confirm the token input is empty or not automatically restored from local history/presets.

Pass criteria:

- The restore request uses the history row site/deploy id and the current token input.
- The token is not written into localStorage, deploy history, target presets, or `prompt.md`.
- Success feedback includes the restored deploy id, and the active Netlify deploy matches the selected target.
- A failed 401/403/404 shows an error message and does not claim success.
- Rows without a site stay dashboard-only and do not show the Netlify restore API button.

If the ACK fails:

1. Record the environment, site value, deploy id, HTTP status, and visible error text.
2. Do not record the token value.
3. Re-run `bun test tests/engine/app/deploy-history.test.ts`.
4. Fix the smallest affected DeployControls or deploy-history helper surface.

## 7. Phase 5 Analytics GUI ACK

Use a lowcode document with at least one BUTTON. This checklist verifies the local GUI path;
real GA4 / Plausible / PostHog dashboard ingestion remains a separate live-provider check.

Steps:

1. Clear selection so the root `Services & Workflows` sections are visible.
2. Find `Analytics`.
3. Switch provider between `ga4`, `plausible`, and `posthog`.
4. Confirm the provider help row changes:
   - GA4 shows `Measurement ID` and a GA4 docs link.
   - Plausible shows `Domain` and a Plausible script docs link.
   - PostHog shows `Project API key` and a PostHog JS docs link.
5. Confirm endpoint help changes by provider:
   - GA4 endpoint input is disabled.
   - Plausible explains the default script URL / self-hosted script override.
   - PostHog explains the default host / regional or self-hosted host override.
6. Leave the analytics id blank, select the BUTTON, add a `Track event` action.
7. Confirm the row shows the amber config hint and still allows editing the event name.
8. Return to the root Analytics panel, enter a valid provider id, and go back to the BUTTON.
9. Confirm the config hint disappears.
10. Add two event properties, edit their keys/values, and confirm duplicate keys are auto-renamed.
11. Save, reopen, and confirm Analytics config plus `Track event` properties persist.
12. Toggle `Track page views`, compile/preview, and confirm generated code keeps or omits automatic page-view tracking according to the toggle.
13. Toggle `Respect Do Not Track` and `Require consent before tracking`, save/reopen, and confirm both privacy gates persist.
14. Set `Consent preset` to `EEA-style opt-in starter`, save/reopen, and confirm the preset persists and pre-fills consent required with Analytics unchecked by default.
15. With consent required, edit `Consent copy`: toggle `Analytics checked by default`, banner text, Analytics category description, privacy policy URL, and policy label.
16. Confirm a `javascript:` policy URL shows inline validation and does not persist.
17. Save/reopen and confirm valid consent copy persists.
18. Compile/preview and confirm the generated analytics runtime includes `__opGrantAnalyticsConsent()` and `__opRevokeAnalyticsConsent()`, and the generated consent banner uses the authored copy/link.

Pass criteria:

- Provider help and docs links are visible and provider-specific.
- The `Track event` missing-provider hint is non-blocking; it does not prevent editing or saving.
- A configured provider removes the warning without changing authored `Track event` actions.
- Invalid provider ids/endpoints show inline validation and do not persist bad config.
- Save/reopen round-trip preserves valid provider id, endpoint, page-view toggle, privacy gates, consent preset, Analytics default state, consent copy, event name, and properties.
- Consent-required runtime does not load provider scripts or send events until the generated app calls `__opGrantAnalyticsConsent()`.
- `EEA-style opt-in starter` emits a consent banner without manually setting `Require consent before tracking`, unless the document explicitly overrides the consent gate.
- When `Analytics checked by default` is off, the generated preference center starts with the Analytics category unchecked until the user grants or saves a different preference.
- Consent copy is rendered as plain text and a normal policy link; raw HTML/script is not accepted.

Live provider handoff:

1. GA4: use a real measurement id and confirm DebugView receives `page_view` and a custom event.
2. Plausible: use a real domain or self-hosted endpoint and confirm dashboard ingestion.
3. PostHog: use a real project API key / host and confirm capture ingestion.
4. At least one real deploy target should confirm provider scripts are not blocked by CSP or hosting headers.
5. If consent is required for the deployment jurisdiction, wire a real app button/banner to call `__opGrantAnalyticsConsent()` and confirm events begin only after that action.

If the ACK fails:

1. Record provider, id shape, endpoint shape, browser/Tauri runtime, and visible error text.
2. Do not record private provider admin tokens.
3. Re-run `bun test tests/engine/app/lowcode/action-errors.test.ts`.
4. Re-run `bun test tests/engine/compiler/analytics.test.ts tests/engine/kiwi/lowcode/roundtrip.test.ts`.
5. Fix the smallest affected Analytics GUI or compiler surface.

## 8. Phase 5 Custom Head/CSS GUI ACK

Use any lowcode document. This verifies the local GUI authoring path; real deploy CSP/header
behavior remains a separate host-provider check.

Steps:

1. Clear selection so the root `Services & Workflows` sections are visible.
2. Find `Custom head & CSS`.
3. Add a meta row:
   - kind: `name`
   - key: `viewport`
   - content: `width=device-width, initial-scale=1`
4. Add a link row:
   - rel: `preload`
   - href: `/font.woff2`
   - as: `font`
   - type: `font/woff2`
   - crossorigin: `anonymous`
5. Add a head style snippet, for example `:root { color-scheme: light; }`.
6. Add app CSS, for example `.app-shell { scroll-behavior: smooth; }`.
7. Save, reopen, and confirm all four authored surfaces persist.
8. Compile or preview the lowcode app and confirm:
   - `index.html` includes the authored `<meta>`, `<link>`, and `<style>`.
   - `src/index.css` ends with the custom app CSS.
9. Clear the panel and confirm save/reopen does not restore stale head/CSS values.
10. Use the Inspector filter with `head`, `meta`, and `css`; confirm `Services & Workflows`
    remains visible.
11. Try a half-filled meta/link row and confirm it stays editable locally but does not persist
    until required fields are complete.

Pass criteria:

- The panel writes only root-level `lowcodeHeadMetadata` / `lowcodeCustomCss`.
- Empty rows and empty textareas do not persist as empty containers.
- No raw HTML or script input is available in the GUI.
- Undo/redo restores and reapplies the custom code edits without runtime errors.

Live deploy CSP/header handoff:

Run this only with a real static host account. The local GUI/compiler path above is enough for
code review; this section proves the host does not block the emitted static head/CSS surfaces.

1. Build or deploy the same document to at least one provider:
   - Netlify: `openpencil deploy app.fig --provider netlify --site <site>`.
   - Vercel: `openpencil deploy app.fig --provider vercel --site <project>`.
   - Cloudflare Pages: `openpencil deploy app.fig --provider cloudflare --account-id <id> --site <project>`.
2. Open the live URL in a normal browser profile and DevTools.
3. In the Network panel, reload and inspect the HTML document response:
   - Record `content-security-policy` or confirm it is absent.
   - Record `content-security-policy-report-only` or confirm it is absent.
   - Record any provider-specific header file/config used by the deploy, such as Netlify
     `_headers`, Vercel `headers`, or Cloudflare Pages `_headers`.
4. In Elements or View Source, confirm:
   - Authored `<meta>` rows appear in `<head>`.
   - Authored `<link rel="preload">`, `<link rel="preconnect">`, or `<link rel="stylesheet">`
     rows appear in `<head>`.
   - Authored inline `<style>` snippets appear in `<head>`.
5. In the Network panel, confirm each authored external stylesheet/preload URL is reachable:
   - HTTP status is 2xx/3xx, or expected local-demo 404 is documented as a missing demo asset.
   - No request is blocked by CSP.
6. In the Console panel, confirm there is no CSP violation for:
   - inline `<style>` from custom head snippets;
   - external custom stylesheet links;
   - app CSS appended to `src/index.css`.
7. Confirm the custom app CSS visibly applies, or inspect the built `src/index.css` asset and
   verify the custom CSS appears after generated Tailwind/theme rules.

Provider matrix to fill in during manual ACK:

| Provider | Live URL | CSP header | Report-only header | External link/preload | Inline head style | App CSS | Result |
| -------- | -------- | ---------- | ------------------ | --------------------- | ----------------- | ------- | ------ |
| Netlify  |          |            |                    |                       |                   |         |        |
| Vercel   |          |            |                    |                       |                   |         |        |
| Cloudflare Pages |  |            |                    |                       |                   |         |        |

Pass criteria:

- At least one real provider row is fully filled and passes.
- If a provider blocks inline style or stylesheet/preload links, the row records provider,
  live URL, response headers, exact console error, and whether the block came from default
  hosting behavior or user-authored headers.
- No real provider token, private deploy token, or account secret is recorded in this file.

If the ACK fails:

1. Record browser/Tauri runtime, document path, exact field values, and visible error text.
2. Record provider, live URL, CSP/report-only headers, affected tag, and exact console error.
3. Re-run `bun test tests/engine/app/lowcode/custom-code-panel.test.ts`.
4. Re-run `bun test tests/engine/compiler/seo-metadata.test.ts tests/engine/kiwi/lowcode/roundtrip.test.ts`.
5. Fix the smallest affected CustomCodePanel, compiler, or persistence surface.

## 9. Phase 5 Stripe Paid Actions GUI ACK

Use a lowcode document with at least one BUTTON and one document state target for errors, for
example `checkoutError` or `portalError`.

Local GUI steps:

1. Select the BUTTON.
2. Add an action and switch its kind to `Stripe checkout`.
3. Confirm the row shows:
   - endpoint input;
   - payload entries editor;
   - error target selector;
   - the warning that Stripe secret keys must live only on the server endpoint.
4. Set endpoint to `/api/checkout`.
5. Add payload entries:
   - `priceId` = `"price_basic"`
   - `quantity` = `1`
6. Set error target to `checkoutError`.
7. Save/reopen and confirm endpoint, payload entries, and error target persist.
8. Try an invalid endpoint/template and confirm inline validation appears.
9. Try a bad payload key like `bad-key` and an empty value expression; confirm inline validation appears.
10. Add a second action or repeat the flow with kind `Stripe customer portal`.
11. Set endpoint to `/api/customer-portal`, payload entry `customerId` = `customerId`, and error
    target to `portalError`; confirm the same endpoint, payload, warning, and error-target controls
    persist after save/reopen.

Generated app runtime handoff:

Run this only with a local mock endpoint or a real server endpoint you control. Do not put any
Stripe secret, restricted key, webhook secret, or provider admin token in the document.

1. Configure the checkout endpoint to return either:
   - `{ "url": "https://checkout.stripe.com/..." }`, or
   - `{ "checkoutUrl": "https://checkout.stripe.com/..." }`.
2. Compile/preview the generated app.
3. Click the checkout BUTTON.
4. Confirm the generated app sends a `POST` request with `Content-Type: application/json`.
5. Confirm the JSON body contains only authored payload fields such as `priceId` and `quantity`.
6. Confirm the browser navigates to the returned checkout URL.
7. Change the endpoint to return 4xx/5xx, invalid JSON, or a JSON object without `url` /
   `checkoutUrl`.
8. Confirm the page does not navigate and `checkoutError` receives the failure value.
9. Configure the customer portal endpoint to return either:
   - `{ "url": "https://billing.stripe.com/..." }`, or
   - `{ "portalUrl": "https://billing.stripe.com/..." }`.
10. Click the portal BUTTON/action and confirm it POSTs JSON, redirects to the returned portal URL,
    and writes `portalError` on 4xx/5xx or missing-URL responses.

Pass criteria:

- GUI authoring persists only `endpoint`, `payloadEntries`, and optional `errorTarget`.
- Invalid endpoint / payload fields show inline validation before compile.
- Generated code calls the author-owned endpoint with POST JSON and redirects only to a returned
  checkout or customer portal URL.
- No Stripe secret appears in `.fig`, ActionDef JSON, generated source, screenshots, logs, or this
  document.

If the ACK fails:

1. Record runtime target, endpoint shape, response status, response body shape, and visible error
   text.
2. Do not record real Stripe secrets, provider dashboard tokens, webhook secrets, or customer data.
3. Re-run:
   - `bun test tests/engine/compiler/stripe-checkout.test.ts tests/engine/compiler/stripe-customer-portal.test.ts`
   - `bun test tests/engine/tools/lowcode/modify.test.ts`
   - `bun test tests/engine/app/lowcode/action-errors.test.ts`
   - `bun test tests/engine/kiwi/lowcode/roundtrip.test.ts`
4. Fix the smallest affected ActionRow, ToolDef, compiler collect, or React emit surface.

## 10. Phase 5 Operator ACK

Use this as the final manual pass after the local tests are green and before staging or pushing the
current Phase 5 lowcode batch. It intentionally references real accounts and deployed endpoints, so
run it only in a preview/staging project unless the production rollout is intentional.

Keep-out rules:

- Do not paste Stripe secret keys, restricted keys, webhook signing secrets, Supabase service-role
  keys, provider dashboard tokens, or private customer data into this document, issues, screenshots,
  shell history, generated SPA source, or `.fig` files.
- Use environment variables for Edge Functions and deploy providers.
- Prefer synthetic test users, test Stripe mode, and staging Supabase projects.
- Record identifiers only when they are safe to share, such as provider name, public URL, HTTP
  status, event type, event id suffix, table name, and visible error text.

Preflight:

1. Confirm `git status --short` and note that `prompt.md` and `.codegraph/` are local keep-outs.
2. Apply or adapt `packages/demos/lowcode/supabase/schema/billing.sql` in the target Supabase
   project.
3. Deploy or copy these Edge Function templates into a staging backend:
   - `packages/demos/lowcode/supabase/functions/demo-checkout/index.ts`
   - `packages/demos/lowcode/supabase/functions/demo-customer-portal/index.ts`
   - `packages/demos/lowcode/supabase/functions/demo-stripe-webhook/index.ts`
4. Set server-side environment variables only in the backend host:
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `PUBLIC_SITE_URL`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_ENTERPRISE`
   - optional `STRIPE_CHECKOUT_MODE` and `STRIPE_PORTAL_CONFIGURATION`
5. Build or preview `packages/demos/lowcode/lowcode-onboarding-demo.fig`, replacing example
   Supabase/analytics endpoint values only in a local/staging copy.

Analytics ACK:

1. Run section 7 for GA4, Plausible, or PostHog authoring.
2. Deploy one generated app to a staging static host.
3. Confirm provider script loading is not blocked by CSP.
4. Trigger one page view and one explicit `trackEvent`.
5. If consent is required, confirm no event is sent before consent, then grant consent and confirm
   events begin.
6. If Do Not Track is enabled in the browser, confirm analytics stays no-op.
7. Record provider, staging URL, consent mode, DNT state, and dashboard ingestion result.

Custom Head/CSS ACK:

1. Run section 8 against the same staging host or one dedicated host.
2. Confirm custom `<meta>`, `<link>`, inline head style, and final CSS are present in the deployed
   HTML/CSS.
3. Confirm CSP/report-only headers allow the intended stylesheet/font/image resources.
4. Record provider, staging URL, relevant CSP headers, affected tag if any, and console result.

Onboarding Demo ACK:

1. Open `packages/demos/lowcode/lowcode-onboarding-demo.fig` in the desktop app.
2. Confirm the lead form validates, shows the validation summary, and runs the success workflow.
3. Confirm the product list uses the Supabase query filter.
4. Confirm i18n and shadcn/ui output compile.
5. Confirm analytics consent copy, privacy link, preference reopen, and EEA-style unchecked default
   are visible in generated output.
6. Confirm the demo does not contain real provider tokens or Stripe secrets.

Stripe Paid Actions ACK:

1. Run section 9 for checkout and customer portal action authoring.
2. With an anonymous checkout request, confirm `customer_email` fallback works.
3. With a Supabase bearer token, confirm checkout creates or reuses `billing_customers` and passes
   server-side `customer` to Stripe Checkout.
4. Confirm the customer portal endpoint rejects unauthenticated calls and uses the server-side
   `billing_customers` mapping for authenticated calls.
5. Confirm 4xx/5xx/missing-URL responses write `checkoutError` or `portalError` and do not redirect.

Stripe Webhook ACK:

1. Register the staging webhook endpoint for:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `charge.refunded`
   - `charge.dispute.created`
   - `charge.dispute.updated`
   - `charge.dispute.closed`
2. Send a valid `checkout.session.completed` event and confirm one `billing_events` row.
3. Re-send the same event id and confirm the response reports `duplicate`.
4. Send `customer.subscription.*` after `billing_customers` mapping exists and confirm
   `billing_subscriptions` and `billing_entitlements` update in the same RPC transaction.
5. Send `invoice.paid` or `invoice.payment_failed` and confirm:
   - `billing_invoices` is upserted.
   - `billing_tax_summaries` captures `automatic_tax`, `tax_amount`, and `total_taxes`.
   - `billing_usage_summaries` captures invoice line id, subscription item, price/product,
     quantity decimal, period, amount, metadata, and raw line.
   - If the invoice has more line items than the webhook payload includes, the production endpoint
     fetches the remaining invoice lines server-side before treating usage rows as complete.
   - `billing_orders` has the matching `invoice:<id>` row.
   - Authenticated users can select only their own invoice/tax/usage/order rows.
6. Send `payment_intent.succeeded` or `payment_intent.payment_failed` and confirm
   `billing_payments` and `billing_orders` update.
7. Send `charge.refunded` and confirm `billing_refunds` updates and the matching order amount
   refunded changes.
8. Send `charge.dispute.*` and confirm `billing_disputes` updates. If a local charge/payment/order
   mapping exists, confirm the row is visible only to the owning authenticated user.
9. Run an out-of-order check: send an invoice before subscription, or a refund before payment
   intent, and confirm read-model writes are not rejected by cross-event foreign keys.
10. Send an invalid signature or expired timestamp and confirm the response is 400 and no business
    table is updated.

Operator pass criteria:

- Every real-account item above is either passed or explicitly marked as deferred with the reason
  and missing credential/account.
- No secret values are recorded in repository files or generated frontend output.
- `billing_events` idempotency prevents duplicate business writes for repeated Stripe event ids.
- RLS allows authenticated users to select only rows tied to their own `user_id`.
- `docs/lowcode-phase-5.md`, `CHANGELOG.md`, and `prompt.md` are updated with the ACK result.

If the operator ACK fails:

1. Stop the rollout for the affected provider/path.
2. Record only safe facts: provider, event type, HTTP status, table name, row id suffix, and visible
   error text.
3. Re-run the targeted local test:
   - `bun test tests/engine/app/lowcode/onboarding-demo.test.ts`
   - plus the specific compiler/tool/app test for the failed surface.
4. Fix the smallest affected template, schema, compiler, or GUI surface.
5. Re-run the failed operator step and the local gate list in `prompt.md`.

## 11. Closeout

If all ACKs pass:

1. Update `docs/lowcode-phase-4.md`:
   - Mark #8 §14 from `已完成(待真机 ACK)` to `已完成`.
   - Mark #10 and #11 ACK text as true-machine verified.
2. For the Phase 5 Netlify restore, Analytics, Custom Head/CSS, Stripe, or operator ACK, update
   `docs/lowcode-phase-5.md` with the live ACK result.
3. Update local `prompt.md` with the ACK results and next recommendation.
4. Run at least:

```sh
git diff --check
bun test tests/engine/app/deploy-history.test.ts
bun run check:vue
bun run check:arch
```

If any ACK fails:

1. Capture exact runtime, command, document path, and reproduction step.
2. Fix the smallest affected surface.
3. Re-run the failed ACK plus the relevant targeted tests.
