---
title: Stability acceptance
description: Repeatable checks for document protection, local preview setup, sign-in, AI context and display consistency.
---

# Stability acceptance

Use a disposable browser profile and copies of design files. Record the commit, uncommitted patch, OS, browser version, viewport, device scale, renderer and installed fonts alongside results. A passing simulated identity or native bridge test does not establish real desktop sign-in or account isolation.

## Automated checks

Run `bun run check` for the repository gate. Run focused Bun tests with explicit `./` paths or absolute paths. In a large macOS checkout with Bun 1.3.10, a bare `tests/...` filter reproduced unusually high file-descriptor allocation and lost subprocess output even when the child exited successfully. Exact paths avoided this local runtime issue; its underlying Bun mechanism remains unconfirmed. The unit shard runner already supplies absolute paths.

```sh
bun test ./tests/engine/app/document ./tests/engine/app/tabs/open-file-dedup.test.ts
bun test ./tests/engine/app/lowcode/preview/managed ./tests/engine/app/lowcode/preview/tauri
bun test ./tests/engine/compiler/managed-preview ./tests/engine/compiler/backend/nestjs/browser-auth
bun test ./tests/engine/acp
```

Keep output collection, process ownership and product lifecycle failures separate. Never accept an empty child output as proof of success. When the platform limits file watchers, retry the architecture check with `CHOKIDAR_USEPOLLING=1 bun run check:arch`; this changes watcher transport, not lint policy.

Browser tests use the canonical Playwright configuration. Choose unused app/MCP ports and a distinct artifact directory for parallel runs. Do not reuse an unrelated development server or stop it to free a port.

```sh
OPENPENCIL_TEST_SERVER=app OPENPENCIL_TEST_PORT=1437 OPENPENCIL_TEST_MCP_PORT=7637 \
  bunx playwright test --project=openpencil \
  tests/e2e/code/nestjs-preview-ca.spec.ts \
  tests/e2e/code/nestjs-preview.spec.ts \
  tests/e2e/canvas/stability-roundtrip.spec.ts \
  --output=output/stability-browser

OPENPENCIL_TEST_SERVER=storybook bunx playwright test \
  tests/e2e/storybook/context-usage.spec.ts --project=storybook-chromium \
  --output=output/stability-context
```

## Document protection

1. Edit an unsaved document. Wait for the debounced recovery write and verify **Recovery snapshot available** with a time. It must not say the original file was saved.
2. Deny a test storage write. Confirm that failure remains visible, preserves the last successful time and offers **Retry**. Restore write access and retry; do not create repeated dialogs.
3. Switch or close the document while a write is pending. Its late completion must not update the new document. Reopen a recoverable snapshot and retain its original timestamp.
4. Save a copy through a real desktop file dialog, edit again and overwrite it. Reopen that file to verify its contents. Browser **Download requested** is not confirmation of a disk write.
5. For connected storage, check the independent remote-sync view. A local cache write must not imply a completed upload. Cloud-account acceptance belongs to the provider's separate checklist.

## Real desktop and identity service

Use an operator-owned Keycloak realm, a registered public client and two dedicated test accounts, plus an already prepared disposable database. The diagnostics do not install services, change trust settings or run migrations. Configure the existing external backend when database setup must remain outside this test.

1. On Tauri, select the local CA and run **Check environment**. Check missing files, an occupied unused preview port, unreachable database/identity service and missing dependencies one at a time on the disposable environment. Each result must identify its check and a usable next step. Copy details and verify they contain no credential, certificate path or endpoint.
2. Launch the connected preview. Sign in through the system browser, then return to the embedded business page. Confirm that the editor holds no access token and that preview identity/data are not mirrored into the design.
3. Cancel sign-in, let a separate attempt time out, and test browser-open failure in a disposable desktop profile. Each case must offer a clear new attempt.
4. Let a short-lived access token expire. Confirm the expiry notice and cleared protected state. Sign in explicitly and return to the previous business page. A failed write must require a new user submission.
5. Log out, log in again, switch accounts and restart the preview. Create test records only in the dedicated test database. Each account must see only records allowed by the server policy, including after back navigation and restart. Logout must clear the remembered return route.

Successful discovery, JWKS, certificate or health checks establish only those checks. They do not prove login, owner policies, production deployment or production migration readiness.

## Another computer and fonts

Open the same copied `.fig` in a separate installation or clean profile. Its CA path must initially be empty; selecting a certificate on that computer must not modify the design. Move that test certificate, recheck, select its replacement and recheck successfully. Switch authentication configuration during a pending file chooser; the old selection must not update the new configuration.

Repeat the ordinary, large-node, image-heavy, complex-text and Chinese/mixed-font scenarios. Use the existing navigation recorder and renderer profiler, and retain load, recovery-write, export, frame-duration and long-task measurements. Report unsupported memory measurement as unavailable. Compare repeated runs on the same machine before drawing performance conclusions.

Import, edit, export and reopen each `.fig`; compare both document structure and rendered pixels. First compare with identical local fonts and rendering settings. Then intentionally remove a test font from the disposable profile: verify the missing/substituted-font notice, inspect text wrapping and clipping after editing, and reopen the export. Classify font substitution separately from antialiasing noise and structural errors. Do not download or redistribute an unlicensed font to make a comparison pass.

## AI context

Use an ACP agent that actually reports context usage. Verify used/capacity/percentage and timestamp, then switch session, agent and model. No old report may appear for the new owner. Check missing, invalid and expired reports; none may appear as zero. Expand details and distinguish context occupancy, latest input/output tokens, Skill description shortening and history compression. No Skill percentage or compression event should be inferred when the protocol does not supply it.
