---
title: CLI Reference
description: Complete reference for all openpencil commands, options, and flags.
---

# CLI Reference

All commands accept a `.fig` file as a positional argument. When omitted, the CLI connects to the running desktop app via RPC.

## info

Show document info — pages, node counts, fonts, file size.

```sh
openpencil info [file] [--json]
```

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |

## tree

Print the node hierarchy.

```sh
openpencil tree [file] [options]
```

| Option | Description |
|--------|-------------|
| `--page` | Page name (default: first page) |
| `--depth` | Max depth (default: unlimited) |
| `--json` | Output as JSON |

## find

Search nodes by name or type.

```sh
openpencil find [file] [options]
```

| Option | Description |
|--------|-------------|
| `--name` | Node name (partial match, case-insensitive) |
| `--type` | Node type: `FRAME`, `TEXT`, `RECTANGLE`, `INSTANCE`, etc. |
| `--page` | Page name (default: all pages) |
| `--limit` | Max results (default: 100) |
| `--json` | Output as JSON |

## node

Show detailed properties of a node.

```sh
openpencil node [file] --id <id> [--json]
```

| Option | Description |
|--------|-------------|
| `--id` | **Required.** Node ID (e.g. `1:23`) |
| `--json` | Output as JSON |

## pages

List all pages in the document.

```sh
openpencil pages [file] [--json]
```

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |

## variables

List design variables and collections.

```sh
openpencil variables [file] [options]
```

| Option | Description |
|--------|-------------|
| `--collection` | Filter by collection name |
| `--type` | Filter by type: `COLOR`, `FLOAT`, `STRING`, `BOOLEAN` |
| `--json` | Output as JSON |

## export

Export to PNG, JPG, WEBP, SVG, or JSX.

```sh
openpencil export [file] [options]
```

| Option | Alias | Description |
|--------|-------|-------------|
| `--format` | `-f` | `png` (default), `jpg`, `webp`, `svg`, `jsx` |
| `--output` | `-o` | Output file path (default: `<name>.<format>`) |
| `--scale` | `-s` | Export scale (default: 1) |
| `--quality` | `-q` | Quality 0–100, JPG/WEBP only (default: 90) |
| `--page` | | Page name (default: first page) |
| `--node` | | Node ID to export (default: all top-level nodes) |
| `--style` | | JSX style: `openpencil` (default), `tailwind` |
| `--thumbnail` | | Export page thumbnail instead of full render |
| `--width` | | Thumbnail width (default: 1920) |
| `--height` | | Thumbnail height (default: 1080) |

## eval

Execute JavaScript with the Figma Plugin API.

```sh
openpencil eval [file] [options]
```

| Option | Alias | Description |
|--------|-------|-------------|
| `--code` | `-c` | JavaScript code to execute |
| `--stdin` | | Read code from stdin |
| `--write` | `-w` | Write changes back to the input file |
| `--output` | `-o` | Write to a different file |
| `--json` | | Output as JSON |
| `--quiet` | `-q` | Suppress output |

## compile

Compile a `.fig` or `.pen` document into a runnable Vite + React + TypeScript project.

```sh
openpencil compile <file> -o <dir>
```

| Option | Alias | Description |
|--------|-------|-------------|
| `--out` | `-o` | Output directory (default: `.`) |
| `--package-name` | | `package.json` name (default: sanitized from input filename) |
| `--page` | | Restrict output to a single page by name |
| `--i18n` | | Enable the react-intl runtime and locale catalogs |
| `--locale` | | Target locale; repeatable, implies `--i18n` |
| `--source-locale` | | Source locale for authored canvas strings; implies `--i18n` |
| `--ui-kit` | | Emit supported controls with a code UI kit (`shadcn`) |
| `--json` | | Output a JSON summary |

## build

Build a `.fig` or `.pen` document into a deployable static SPA bundle.

```sh
openpencil build <file> -o dist
```

| Option | Alias | Description |
|--------|-------|-------------|
| `--out` | `-o` | Output directory for the static bundle (default: `dist`) |
| `--package-name` | | `package.json` name (default: sanitized from input filename) |
| `--page` | | Restrict output to a single page by name |
| `--base` | | Public base path for assets (default: `/`) |
| `--supabase-url` | | Override the Supabase URL for this build |
| `--supabase-anon-key` | | Override the Supabase anon key for this build |
| `--i18n` | | Enable the react-intl runtime and locale catalogs |
| `--locale` | | Target locale; repeatable, implies `--i18n` |
| `--source-locale` | | Source locale for authored canvas strings; implies `--i18n` |
| `--ui-kit` | | Emit supported controls with a code UI kit (`shadcn`) |
| `--json` | | Output a JSON summary |

## deploy

Build and deploy a document to a static host.

```sh
openpencil deploy <file> --provider netlify --site my-site
openpencil deploy <file> --provider vercel --site my-project
openpencil deploy <file> --provider cloudflare --account-id <account-id> --site my-pages-project
```

| Option | Description |
|--------|-------------|
| `--provider` | `netlify` (default), `vercel`, or `cloudflare` |
| `--token` | Provider access token; falls back to provider-specific env vars |
| `--site` | Netlify site id/subdomain, Vercel project name, or Cloudflare project name |
| `--account-id` | Cloudflare account id; also supported through `CLOUDFLARE_ACCOUNT_ID` |
| `--page` | Restrict output to a single page by name |
| `--base` | Public base path for assets |
| `--supabase-url` | Override the Supabase URL for this deploy |
| `--supabase-anon-key` | Override the Supabase anon key for this deploy |
| `--ui-kit` | Emit supported controls with a code UI kit (`shadcn`) |
| `--i18n` | Enable the react-intl runtime and locale catalogs |
| `--locale` | Target locale; repeatable, implies `--i18n` |
| `--source-locale` | Source locale for authored canvas strings; implies `--i18n` |
| `--json` | Output the deploy result as JSON |

Token env vars:

| Provider | Env var |
|----------|---------|
| Netlify | `NETLIFY_AUTH_TOKEN` |
| Vercel | `VERCEL_TOKEN` |
| Cloudflare | `CLOUDFLARE_API_TOKEN` |

## analyze colors

Analyze color palette usage across the document.

```sh
openpencil analyze colors [file] [options]
```

| Option | Description |
|--------|-------------|
| `--limit` | Max colors to show (default: 30) |
| `--threshold` | Distance threshold for clustering similar colors, 0–50 (default: 15) |
| `--similar` | Show similar color clusters |
| `--json` | Output as JSON |

## analyze typography

Analyze font family, size, and weight distribution.

```sh
openpencil analyze typography [file] [options]
```

| Option | Description |
|--------|-------------|
| `--group-by` | Group by: `family`, `size`, `weight` (default: show all styles) |
| `--limit` | Max styles to show (default: 30) |
| `--json` | Output as JSON |

## analyze spacing

Analyze gap and padding values across auto-layout frames.

```sh
openpencil analyze spacing [file] [options]
```

| Option | Description |
|--------|-------------|
| `--grid` | Base grid size to check against (default: 8) |
| `--json` | Output as JSON |

## analyze clusters

Find repeated node patterns — potential components.

```sh
openpencil analyze clusters [file] [options]
```

| Option | Description |
|--------|-------------|
| `--limit` | Max clusters to show (default: 20) |
| `--min-size` | Min node size in px (default: 30) |
| `--min-count` | Min instances to form a cluster (default: 2) |
| `--json` | Output as JSON |
