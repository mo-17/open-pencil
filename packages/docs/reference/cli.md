---
title: CLI Reference
description: Complete reference for all openpencil commands, options, and flags.
---

# CLI Reference

Document commands accept a `.fig` file as a positional argument. When omitted, those commands connect
to the running desktop app via RPC. Artifact commands such as `plugin` operate only on explicit local
JSON and key references.

## info

Show document info — pages, node counts, fonts, file size.

```sh
openpencil info [file] [--json]
```

| Option   | Description    |
| -------- | -------------- |
| `--json` | Output as JSON |

## tree

Print the node hierarchy.

```sh
openpencil tree [file] [options]
```

| Option    | Description                     |
| --------- | ------------------------------- |
| `--page`  | Page name (default: first page) |
| `--depth` | Max depth (default: unlimited)  |
| `--json`  | Output as JSON                  |

## find

Search nodes by name or type.

```sh
openpencil find [file] [options]
```

| Option    | Description                                               |
| --------- | --------------------------------------------------------- |
| `--name`  | Node name (partial match, case-insensitive)               |
| `--type`  | Node type: `FRAME`, `TEXT`, `RECTANGLE`, `INSTANCE`, etc. |
| `--page`  | Page name (default: all pages)                            |
| `--limit` | Max results (default: 100)                                |
| `--json`  | Output as JSON                                            |

## node

Show detailed properties of a node.

```sh
openpencil node [file] --id <id> [--json]
```

| Option   | Description                         |
| -------- | ----------------------------------- |
| `--id`   | **Required.** Node ID (e.g. `1:23`) |
| `--json` | Output as JSON                      |

## pages

List all pages in the document.

```sh
openpencil pages [file] [--json]
```

| Option   | Description    |
| -------- | -------------- |
| `--json` | Output as JSON |

## variables

List design variables and collections.

```sh
openpencil variables [file] [options]
```

| Option         | Description                                           |
| -------------- | ----------------------------------------------------- |
| `--collection` | Filter by collection name                             |
| `--type`       | Filter by type: `COLOR`, `FLOAT`, `STRING`, `BOOLEAN` |
| `--json`       | Output as JSON                                        |

## export

Export to PNG, JPG, WEBP, SVG, JSX, HTML, or `.fig`.

```sh
openpencil export [file] [options]
```

| Option        | Alias | Description                                                 |
| ------------- | ----- | ----------------------------------------------------------- |
| `--format`    | `-f`  | `png` (default), `jpg`, `webp`, `svg`, `jsx`, `html`, `fig` |
| `--output`    | `-o`  | Output file path (default: `<name>.<format>`)               |
| `--scale`     | `-s`  | Export scale (default: 1)                                   |
| `--quality`   | `-q`  | Quality 0–100, JPG/WEBP only (default: 90)                  |
| `--page`      |       | Page name (default: first page)                             |
| `--node`      |       | Node ID to export (default: all top-level nodes)            |
| `--style`     |       | JSX style: `openpencil` (default), `tailwind`               |
| `--html`      |       | HTML mode: `fragment` (default), `standalone`               |
| `--css`       |       | HTML CSS output: `inline` (default), `tailwind`             |
| `--assets`    |       | Standalone HTML assets: `inline` (default), `external`      |
| `--fonts`     |       | Standalone HTML font output: `assets`, `none` (default)     |
| `--thumbnail` |       | Export page thumbnail instead of full render                |
| `--width`     |       | Thumbnail width (default: 1920)                             |
| `--height`    |       | Thumbnail height (default: 1080)                            |

## import

Import HTML/CSS/Tailwind into an editable OpenPencil document.

```sh
openpencil import page.html [options]
```

| Option            | Alias | Description                                      |
| ----------------- | ----- | ------------------------------------------------ |
| `--format`        | `-f`  | Output format: `fig` (default), `json`           |
| `--output`        | `-o`  | Output file path (default: `<name>.<format>`)    |
| `--css`           |       | CSS file to apply before conversion              |
| `--css-text`      |       | Inline CSS text to apply before conversion       |
| `--tailwind`      |       | Tailwind utility candidates to compile and apply |
| `--tailwind-file` |       | File containing Tailwind utility candidates      |
| `--page-name`     |       | Scene graph page name (default: `DOM/CSS`)       |
| `--json`          |       | Print a machine-readable summary                 |

Examples:

```sh
openpencil import card.html --css card.css -o card.fig
openpencil import card.html --tailwind "flex flex-col gap-3 w-80 p-6 rounded-xl bg-white" -o card.fig
```

## eval

Execute JavaScript with OpenPencil's Figma-compatible Plugin API surface.

```sh
openpencil eval [file] [options]
```

| Option     | Alias | Description                          |
| ---------- | ----- | ------------------------------------ |
| `--code`   | `-c`  | JavaScript code to execute           |
| `--stdin`  |       | Read code from stdin                 |
| `--write`  | `-w`  | Write changes back to the input file |
| `--output` | `-o`  | Write to a different file            |
| `--json`   |       | Output as JSON                       |
| `--quiet`  | `-q`  | Suppress output                      |

## plugin

Validate, sign, and verify bounded declarative and compute-runtime plugin artifacts. These commands
never download a catalog/runtime URL or execute plugin code.

```sh
# Validate either an unsigned payload or a signed manifest.
openpencil plugin manifest validate plugin-payload.json --json

# Read the private key only for this invocation and write a signed manifest.
openpencil plugin manifest sign plugin-payload.json \
  --private-key publisher-private.pem -o plugin.json

# CI can reference a named environment variable containing PKCS8 PEM instead.
openpencil plugin manifest sign plugin-payload.json \
  --private-key-env OPENPENCIL_PLUGIN_SIGNING_KEY -o plugin.json

# Verify the publisher signature, key identity, digest, and engine compatibility.
openpencil plugin manifest verify plugin.json \
  --public-key publisher-public.pem --key-id publisher-key-1

# Build and verify a separately signed catalog index.
openpencil plugin catalog build catalog-payload.json \
  --private-key catalog-private.pem -o catalog.json
openpencil plugin catalog verify catalog.json \
  --public-key catalog-public.pem --catalog-id official

# Validate, sign, and verify a publisher runtime package.
openpencil plugin runtime validate runtime-payload.json --json
openpencil plugin runtime sign runtime-payload.json \
  --private-key publisher-private.pem -o runtime.json
openpencil plugin runtime verify runtime.json \
  --public-key publisher-public.pem \
  --plugin-id example-plugin --plugin-version 1.0.0 \
  --publisher-id example-publisher --key-id publisher-key-1 \
  --manifest-digest <manifest-sha256-base64url> \
  --digest <runtime-sha256-base64url> --byte-length <canonical-byte-length>

# Build and verify the root-signed executable runtime index.
openpencil plugin runtime-index build runtime-index-payload.json \
  --private-key marketplace-root-private.pem --key-id marketplace-root-2026 \
  -o runtime-index.json
openpencil plugin runtime-index verify runtime-index.json \
  --public-key marketplace-root-public.pem \
  --index-id openpencil.marketplace.runtime --key-id marketplace-root-2026 \
  --digest <runtime-index-sha256-base64url>
```

`manifest sign`, `catalog build`, `runtime sign`, and `runtime-index build` require exactly one
private-key source: `--private-key <file>` or `--private-key-env <variable-name>`. The environment
option is a reference to a variable containing the PEM value, not the PEM value itself. Keys are read
at invocation time and are never copied into the signed JSON or command output. Verification accepts
the equivalent `--public-key` and `--public-key-env` forms. `--engine-version` overrides manifest
compatibility verification when testing a future engine release; otherwise the installed CLI version
is used. Runtime-package and runtime-index verification are trust-mode commands: every expected
identity, digest, and canonical runtime byte length is required and should come from the already
accepted root-signed marketplace snapshot/index rather than the artifact under test.

Catalog payloads contain metadata and manifest URLs only. Building or verifying a catalog does not
fetch those URLs, verify the referenced plugin packages, or install anything. Runtime ingestion must
still verify each downloaded manifest against the trusted publisher keyring and exact catalog digest.
Runtime-package validation performs WASM static checks but does not instantiate or execute the asset.
When the input already contains an `integrity` field, `runtime validate` still does not verify its
signature; use the fully pinned `runtime verify` command for trust decisions.
Runtime-index build/verify does not fetch its package URLs; app ingestion still requires the current
root-signed marketplace snapshot, exact accepted declarative package, and current publisher keyring.

## motion inspect

Inspect a detached, plain-JSON readback of Figma's official Motion Plugin API fields. The CLI reads
the file only; it does not connect to or control Figma Desktop.

```sh
openpencil motion inspect <snapshot.json> [--json]
```

The bounded snapshot shape is:

```json
{
  "animationStyles": [],
  "manualKeyframeTracks": {},
  "timelines": [],
  "ownershipRaw": "",
  "sharedMotionRaw": ""
}
```

A valid `openpencil/motion-v1` shared mirror is restored losslessly. Without it, import is limited to
the verified `FLOAT` intersection: opacity, X/Y translation, rotation, and X/Y scale. Unknown,
indexed, styled, malformed, or multi-timeline native state fails closed. JSON output includes the
inspection, diagnostics, and imported canonical `MotionSpec`, if one can be recovered.

## motion apply

Build a native apply plan from one OpenPencil node. Supplying `--current` compares that plan with a
detached Figma readback snapshot. The default is plan-only and writes nothing.

```sh
openpencil motion apply <file> --node <source-id> [options]
```

| Option                    | Alias | Description                                                     |
| ------------------------- | ----- | --------------------------------------------------------------- |
| `--node`                  |       | Required source OpenPencil node ID                              |
| `--current`               |       | Detached native snapshot JSON for a compare-only diff           |
| `--emit`                  |       | `plan` (default), `script`, or `snapshot`                       |
| `--target-node`           |       | Target Figma node ID; otherwise a script requires one selection |
| `--conflict-policy`       |       | `replace-owned` (default) or destructive `replace-all`          |
| `--allow-timeline-growth` |       | Permit the generated runtime to extend an existing timeline     |
| `--output`                | `-o`  | Write the explicit script or safe apply snapshot                |
| `--json`                  |       | Emit the complete plan/comparison/artifact report as JSON       |

`--emit script` generates a self-contained script that uses Figma's official Motion Plugin API.
`--emit snapshot` generates a versioned apply request containing the shared `MotionSpec` mirror and
validated operations, not raw `.fig` timeline bytes. Neither mode executes Figma or claims that an
apply succeeded. When a supplied current snapshot is unsafe, no artifact is produced and an
existing output file is left untouched.

## motion clear

Plan a canonical Motion clear from an optional detached current snapshot:

```sh
openpencil motion clear [current-snapshot.json] [--emit plan|snapshot] [-o clear.json] [--json]
```

The default is compare-only. `--emit snapshot` writes a clear tombstone plus the exact ownership
precondition and verified owned fields. It always preserves timelines and animation styles, and it
preserves all native fields when ownership is absent or unverified. This is a reviewable artifact
for a Figma plugin or automation host; the CLI itself does not execute the clear or edit Figma
Desktop.

## motion export

Render node-local Motion tracks or one Motion scene sequence to a deterministic PNG frame directory,
GIF, WebM, or MP4 file.

```sh
openpencil motion export <file> --node <id[,id...]> -o <new-directory> [options]
openpencil motion export <file> --scene-owner <id> --sequence <id> -o <new-directory> [options]
```

| Option             | Alias | Description                                                       |
| ------------------ | ----- | ----------------------------------------------------------------- |
| `--node`           |       | Comma-separated animated node IDs                                 |
| `--scene-owner`    |       | Motion scene owner page/frame ID; requires `--sequence`           |
| `--sequence`       |       | Motion scene sequence ID; requires `--scene-owner`                |
| `--trigger`        |       | Node-local trigger or `all` (default)                             |
| `--track`          |       | Optional single node-local track ID                               |
| `--format`         |       | `png-sequence` (built in), `gif`, `webm`, or `mp4` (capabilities) |
| `--ffmpeg`         |       | Optional FFmpeg executable for WebM/MP4                           |
| `--fps`            |       | Integer FPS, 1–120 (default: 30)                                  |
| `--loops`          |       | Finite loop count, 1–100 (default: 1)                             |
| `--scale`          |       | Raster scale, 0.1–4 (default: 1)                                  |
| `--padding`        |       | Fixed document-space padding (default: 0)                         |
| `--duration`       |       | Optional bounded duration override in milliseconds                |
| `--reduced-motion` |       | `allow`, `reduce`, or `disable` (default: `allow`)                |
| `--output`         | `-o`  | New directory for PNG frames or new encoded output file           |
| `--json`           |       | Emit a machine-readable manifest/report                           |

PNG output exclusively creates the destination directory, then publishes every staged frame and
`manifest.json` through no-replace hard links. The directory may be visible while files are linked,
so successful command completion and the manifest are the completion boundary. Encoded output is
staged beside the destination and atomically published by hard link. Filesystems without the
required no-clobber hard-link guarantee fail closed. Existing destinations, including a directory
created by a racing process, are preserved; failed or cancelled work removes only entries created by
that export. GIF89a is built in and deterministic, with a fixed palette and one-bit alpha threshold.
WebM/MP4 require a real FFmpeg binary discovered from `--ffmpeg`,
`OPENPENCIL_FFMPEG_PATH`, or `PATH`; unsupported codecs fail closed. FFmpeg WebM preserves an exact
partial final frame through the OpenPencil microsecond WebM muxer. Optional constant-frame-rate MP4
requires the total duration to end on a whole frame and otherwise fails before encoding. WebM is
explicitly opaque-only, and no format is implemented by renaming PNG data. Interactive non-JSON
terminals receive throttled phase progress on stderr; <kbd>Ctrl</kbd> + <kbd>C</kbd> cancels the
active export without polluting JSON or piped stdout.

## motion figma-adapter

Diagnose one node's `MotionSpec` and generate a self-contained script that applies the verified
subset through Figma's official Motion Plugin API Beta. This compatibility command remains
available; new automation should prefer `motion apply --emit script`.

```sh
openpencil motion figma-adapter <file> --node <source-id> [options]
```

| Option                    | Alias | Description                                                       |
| ------------------------- | ----- | ----------------------------------------------------------------- |
| `--node`                  |       | Required source OpenPencil node ID                                |
| `--target-node`           |       | Target Figma node ID; otherwise require exactly one selected node |
| `--conflict-policy`       |       | `replace-owned` (default) or destructive `replace-all`            |
| `--allow-timeline-growth` |       | Permit extending an existing shared Figma timeline                |
| `--output`                | `-o`  | Write the generated plugin script to a file                       |
| `--json`                  |       | Emit the stable adapter report as JSON                            |

With no `--output` or `--json`, a supported result writes only executable JavaScript to stdout.
Unsupported Motion exits with status 1 and never overwrites the requested output. The adapter fails
closed for unrepresentable semantics or unsafe native state and does not edit raw `.fig` timeline
payloads.

## motion presets

Publish, import, check, and explicitly accept readonly shared Motion preset libraries.

```sh
openpencil motion presets publish personal.json \
  --publisher-id design-team --publisher-name "Design Team" \
  --library-id product-motion --library-name "Product Motion" \
  --source-version v1 -o product-motion.json
openpencil motion presets import product-motion.json -o accepted.json
openpencil motion presets check accepted.json -o checked.json
openpencil motion presets accept checked.json -o accepted-v2.json
```

`publish` converts a portable personal preset library into a versioned manifest with publisher,
library, source, and readonly provenance. Its source may be a local file or an HTTP(S) URL using
`--source-kind` and `--source-ref`. `check` validates the latest source and records its version but
keeps the accepted manifest untouched. `accept` is the only update operation that replaces the
accepted snapshot. All four subcommands support `--json`; writes require an explicit `--output`.

## motion recipe

Validate, instantiate, or atomically apply a bounded multi-node Motion Recipe:

```sh
openpencil motion recipe validate hero-recipe.json --json
openpencil motion recipe instantiate hero-recipe.json \
  --roles '{"hero":["1:20"],"copy":["1:21"]}' \
  --parameters '{"duration":420}' -o instantiated.json
openpencil motion recipe apply app.fig --recipe hero-recipe.json \
  --roles '{"hero":["1:20"],"copy":["1:21"]}' \
  --parameters '{"duration":420}' -o app-with-recipe.fig
```

`--roles` maps every recipe role to an explicit node-id array. `--parameters` is an optional JSON
object of bounded overrides. `instantiate` emits the complete deterministic assignment snapshot;
`apply` validates every role and parameter before writing, applies all assignments as one operation,
and uses a temporary sibling plus rename so a failed `.fig`/`.pen` write cannot replace the output.
`.pen` output retains the Pen writer's source-preserving Motion-only boundary.

## motion team

Sign, verify, review, and instantiate versioned team animation libraries:

```sh
openpencil motion team sign payload.json --private-key team-private.pem -o manifest.json
openpencil motion team verify manifest.json --public-key team-public.pem --json
openpencil motion team import manifest.json --public-key team-public.pem -o registry.json
openpencil motion team review registry.json manifest-v2.json \
  --public-key team-public.pem -o pending.json
openpencil motion team accept pending.json --public-key team-public.pem -o accepted.json
openpencil motion team reject pending.json --public-key team-public.pem -o rejected.json
openpencil motion team rollback accepted.json --public-key team-public.pem \
  --digest <verified-history-digest> -o rolled-back.json
openpencil motion team instantiate accepted.json --entry pairedEnter \
  --public-key team-public.pem --tokens '{"motion.duration.medium":640}' \
  --roles '{"hero":["1:20"]}' -o assignment.json
openpencil motion team apply app.fig accepted.json --entry pairedEnter \
  --public-key team-public.pem --roles '{"hero":["1:20"]}' \
  --tokens '{"motion.duration.medium":640}' -o app-with-team-motion.fig
```

Manifests use Ed25519 signatures over a canonical bounded payload and SHA-256 integrity digests.
Every command re-verifies the supplied public key, engine version range, and all accepted/history/
pending snapshots before it writes. An explicit `--key-id` asserts the expected publisher identity;
after import, registry operations also anchor an omitted `--key-id` to the accepted manifest's
publisher key id, so a different identity cannot be substituted even with the same key material.
`review` records a deterministic added/updated/removed diff but never changes the accepted version;
only `accept`, `reject`, or digest-addressed `rollback` resolves that review. `instantiate` expands
one preset or recipe with optional `--tokens`,
`--parameters`, and `--roles` into a reproducible snapshot. `apply` uses only the registry's
cryptographically reverified accepted snapshot, preflights every target, and writes a new
same-format `.fig` or `.pen` without replacing the input or an existing output. All commands support
`--json`.

## compile

Compile a `.fig` or `.pen` document into a runnable Vite + React + TypeScript project.

```sh
openpencil compile <file> -o <dir>
```

| Option            | Alias | Description                                                  |
| ----------------- | ----- | ------------------------------------------------------------ |
| `--out`           | `-o`  | Output directory (default: `.`)                              |
| `--package-name`  |       | `package.json` name (default: sanitized from input filename) |
| `--page`          |       | Restrict output to a single page by name                     |
| `--i18n`          |       | Enable the react-intl runtime and locale catalogs            |
| `--locale`        |       | Target locale; repeatable, implies `--i18n`                  |
| `--source-locale` |       | Source locale for authored canvas strings; implies `--i18n`  |
| `--ui-kit`        |       | Emit supported controls with a code UI kit (`shadcn`)        |
| `--json`          |       | Output a JSON summary                                        |

## build

Build a `.fig` or `.pen` document into a deployable static SPA bundle.

```sh
openpencil build <file> -o dist
```

| Option                | Alias | Description                                                  |
| --------------------- | ----- | ------------------------------------------------------------ |
| `--out`               | `-o`  | Output directory for the static bundle (default: `dist`)     |
| `--package-name`      |       | `package.json` name (default: sanitized from input filename) |
| `--page`              |       | Restrict output to a single page by name                     |
| `--base`              |       | Public base path for assets (default: `/`)                   |
| `--supabase-url`      |       | Override the Supabase URL for this build                     |
| `--supabase-anon-key` |       | Override the Supabase anon key for this build                |
| `--supabase-schema`   |       | Override the Supabase database schema for this build         |
| `--i18n`              |       | Enable the react-intl runtime and locale catalogs            |
| `--locale`            |       | Target locale; repeatable, implies `--i18n`                  |
| `--source-locale`     |       | Source locale for authored canvas strings; implies `--i18n`  |
| `--ui-kit`            |       | Emit supported controls with a code UI kit (`shadcn`)        |
| `--json`              |       | Output a JSON summary                                        |

When the document contains server workflows, `build` keeps their generated Supabase Edge Function
bundle under `<out>/openpencil-server/`. The JSON result separates `staticFiles` from `serverFiles`;
do not upload the server directory to a static host.

## deploy

Build and deploy a document to a static host.

```sh
openpencil deploy <file> --provider netlify --site my-site
openpencil deploy <file> --provider vercel --site my-project
openpencil deploy <file> --provider cloudflare --account-id <account-id> --site my-pages-project
```

| Option                | Description                                                                |
| --------------------- | -------------------------------------------------------------------------- |
| `--provider`          | `netlify` (default), `vercel`, or `cloudflare`                             |
| `--token`             | Provider access token; falls back to provider-specific env vars            |
| `--site`              | Netlify site id/subdomain, Vercel project name, or Cloudflare project name |
| `--account-id`        | Cloudflare account id; also supported through `CLOUDFLARE_ACCOUNT_ID`      |
| `--page`              | Restrict output to a single page by name                                   |
| `--base`              | Public base path for assets                                                |
| `--supabase-url`      | Override the Supabase URL for this deploy                                  |
| `--supabase-anon-key` | Override the Supabase anon key for this deploy                             |
| `--supabase-schema`   | Override the Supabase database schema for this deploy                      |
| `--ui-kit`            | Emit supported controls with a code UI kit (`shadcn`)                      |
| `--i18n`              | Enable the react-intl runtime and locale catalogs                          |
| `--locale`            | Target locale; repeatable, implies `--i18n`                                |
| `--source-locale`     | Source locale for authored canvas strings; implies `--i18n`                |
| `--json`              | Output the deploy result as JSON                                           |

Static deploy uploads browser files only. If server workflows are present, human and JSON output
include a non-secret manual deployment recipe; the command does not deploy functions, link a
Supabase project, or configure server environment values.

Token env vars:

| Provider   | Env var                |
| ---------- | ---------------------- |
| Netlify    | `NETLIFY_AUTH_TOKEN`   |
| Vercel     | `VERCEL_TOKEN`         |
| Cloudflare | `CLOUDFLARE_API_TOKEN` |

## analyze colors

Analyze color palette usage across the document.

```sh
openpencil analyze colors [file] [options]
```

| Option        | Description                                                          |
| ------------- | -------------------------------------------------------------------- |
| `--limit`     | Max colors to show (default: 30)                                     |
| `--threshold` | Distance threshold for clustering similar colors, 0–50 (default: 15) |
| `--similar`   | Show similar color clusters                                          |
| `--json`      | Output as JSON                                                       |

## analyze typography

Analyze font family, size, and weight distribution.

```sh
openpencil analyze typography [file] [options]
```

| Option       | Description                                                     |
| ------------ | --------------------------------------------------------------- |
| `--group-by` | Group by: `family`, `size`, `weight` (default: show all styles) |
| `--limit`    | Max styles to show (default: 30)                                |
| `--json`     | Output as JSON                                                  |

## analyze spacing

Analyze gap and padding values across auto-layout frames.

```sh
openpencil analyze spacing [file] [options]
```

| Option   | Description                                  |
| -------- | -------------------------------------------- |
| `--grid` | Base grid size to check against (default: 8) |
| `--json` | Output as JSON                               |

## analyze clusters

Find repeated node patterns — potential components.

```sh
openpencil analyze clusters [file] [options]
```

| Option        | Description                                  |
| ------------- | -------------------------------------------- |
| `--limit`     | Max clusters to show (default: 20)           |
| `--min-size`  | Min node size in px (default: 30)            |
| `--min-count` | Min instances to form a cluster (default: 2) |
| `--json`      | Output as JSON                               |
