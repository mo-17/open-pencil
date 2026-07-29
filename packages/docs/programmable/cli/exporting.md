---
title: Exporting
description: Export document content to PNG, JPG, WEBP, SVG, `.fig`, JSX, or HTML, and convert between document formats.
---

# Exporting

Export designs from the terminal — raster images, vectors, `.fig` subsets, JSX code, or HTML.

## Image Export

```sh
openpencil export design.fig                           # PNG (default)
openpencil export design.fig -f jpg -s 2 -q 90        # JPG at 2×, quality 90
openpencil export design.fig -f webp -s 3             # WEBP at 3×
openpencil export design.fig -f svg                   # SVG vector
openpencil export design.fig -f fig --page "Page 1"   # export one page as .fig
openpencil export design.fig -f fig --node 1:23        # export one node as .fig
openpencil export design.fig -f html --css tailwind    # export an HTML fragment with Tailwind classes
```

Options:

- `-f` — format: `png`, `jpg`, `webp`, `svg`, `jsx`, `html`, `fig`
- `-s` — scale: `1`–`4`
- `-q` — quality: `0`–`100` (JPG/WEBP only)
- `-o` — output path
- `--page` — page name
- `--node` — specific node ID

## JSX Export

Export as JSX with Tailwind utility classes:

```sh
openpencil export design.fig -f jsx --style tailwind
```

Output:

```html
<div className="flex flex-col gap-4 p-6 bg-white rounded-xl">
  <p className="text-2xl font-bold text-[#1D1B20]">Card Title</p>
  <p className="text-sm text-[#49454F]">Description text</p>
</div>
```

Also supports `--style openpencil` for the native JSX format (see [JSX Renderer](../jsx-renderer)).

## HTML Export

Export as an HTML fragment with inline styles by default, or Tailwind utility classes:

```sh
openpencil export design.fig -f html
openpencil export design.fig -f html --css tailwind
```

Use `--html standalone` for a browser-openable HTML document with reset styles and a page wrapper. Standalone HTML is intended as a useful visual/code handoff, not a pixel-perfect renderer replacement:

```sh
openpencil export design.fig -f html --html standalone --css inline
openpencil export design.fig -f html --html standalone --css tailwind
openpencil export design.fig -f html --html standalone --css tailwind --assets external
```

Standalone Tailwind output is compiled during export; it does not depend on the Tailwind browser runtime. Use `--assets external` to write CSS and extracted image assets next to the HTML file. Use `--fonts assets` with external assets to resolve detected SceneGraph text fonts through OpenPencil's configured web-font providers and emit local `@font-face` files.

HTML export is available in file mode.

## Document Conversion

Convert supported input documents through the shared IO registry:

```sh
openpencil convert design.pen -f fig -o design.fig
openpencil convert animated.pen -f pen -o animated-updated.pen
```

The `.pen` output path is intentionally source-preserving and Motion-only. It accepts a document
originally read from `.pen`, updates the versioned `metadata.openPencil` MotionSpec envelope, and
keeps unrelated foreign metadata and unmodified future payloads intact. Ref and nested descendant
clears use an explicit tombstone so component Motion does not reappear after reopen. Conflicting
unknown-schema Motion edits and structural, visual, variable, or document-metadata edits are
rejected; save those edits as `.fig` instead.

## Thumbnails

```sh
openpencil export design.fig --thumbnail --width 1920 --height 1080
```

## Motion animation export

Export node-local Motion tracks or a page/frame Motion scene as a deterministic PNG sequence or
encoded animation:

```sh
openpencil motion export design.fig --node 1:23 --fps 30 -o card-frames
openpencil motion export design.fig --scene-owner 1:4 --sequence intro --fps 60 --loops 2 -o intro-frames
openpencil motion export design.fig --node 1:23 --format gif -o card.gif
openpencil motion export design.fig --node 1:23 --format webm -o card.webm
openpencil motion export design.fig --node 1:23 --reduced-motion reduce --json -o reduced-frames
```

The output directory must not already exist. OpenPencil renders into a sibling temporary directory,
writes numbered `frame-0000.png` files plus `manifest.json`, then renames the completed directory
into place. Cancellation or failure removes the temporary output. The manifest records integer
microsecond timestamps, frame durations, loop-local times, fixed canvas dimensions, and the `1/fps`
timebase used by the reference sampler.

PNG sequences and deterministic GIF89a are built in. WebM and MP4 require a real FFmpeg executable
discovered from `--ffmpeg`, `OPENPENCIL_FFMPEG_PATH`, or `PATH`; only codecs reported by that binary
are offered. Unsupported codecs fail closed, WebM is opaque-only, and OpenPencil never writes PNG
bytes under a video extension.

An interactive non-JSON terminal receives throttled phase progress on stderr. <kbd>Ctrl</kbd> +
<kbd>C</kbd> aborts planning, rendering, encoding, or the atomic write and removes temporary output.
JSON mode and piped stdout remain machine-readable and do not include progress lines.

Frame planning bounds FPS, source/total duration, loops, frame count, dimensions, scale, padding,
per-frame area, and aggregate pixel work. `--reduced-motion allow|reduce|disable` is explicit and
deterministic; the headless exporter never infers an ambient OS preference.

## Live App Mode

Omit the file to export from the running app:

```sh
openpencil export -f png    # screenshot the current canvas
```
