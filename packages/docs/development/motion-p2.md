---
title: Motion P2 implementation plan
description: OpenPencil Motion P2-A and P2-B scope, architecture, sequencing, and acceptance gates.
---

# Motion P2 implementation plan

Status: implementation and P2 feature-level automated verification completed on 2026-07-29. The
four manual P0/P1 ACKs and P2-C external Figma API work remain separate.

Motion P2 builds on the bounded `MotionSpec` v1/v2 editor, Canvas sampler, React runtime, preset
library, lowcode actions, and safe Figma Motion Beta adapter. P2-A covers composition and interactive
authoring. P2-B covers advanced rendering, delivery, collaboration, distribution, and SDK reuse.

The four manual P0/P1 ACKs remain separate acceptance work. Figma API-dependent multi-track native
Motion and Smart Animate compatibility are P2-C external dependencies and are not part of this
implementation plan.

## Architecture rules

- Keep every persisted format bounded, versioned, and free of arbitrary JavaScript or CSS.
- Preserve MotionSpec v1/v2 behavior byte-for-byte unless an author explicitly upgrades to v3.
- Keep node-local animation, scene choreography, continuous interaction drivers, and reusable
  recipes as separate schemas so no field becomes a second source of truth.
- Expand presets and recipes into complete document snapshots at apply time. Runtime output must not
  depend on the source library remaining available.
- Use the same reference sampler for Canvas and frame export, and the public Motion runtime kernel
  for SDK and self-contained compiled-runtime scheduling, timing, easing, and channel sampling.
- Fail closed when a renderer, node type, or target adapter cannot reproduce an authored channel.
- Treat multi-node edits as one undoable transaction and remap every node/track reference through
  clone, clipboard, component, collaboration, `.fig`, and `.pen` boundaries.

## P2-A milestones

| Milestone | Scope                 | Acceptance summary                                                                                                                                         | Status      |
| --------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| A1        | Track composition     | Versioned `replace`, `add`, and `accumulate` composition with weight and stable priority ordering across reference sampling, Canvas, and compiled runtimes | Implemented |
| A2        | Scene timeline        | Page/frame descendant tracks, zoom, snap, markers, multi-select editing, time translation/scaling, and Auto Keyframe with atomic undo                      | Implemented |
| A3        | Motion recipes        | Parameterized multi-node role mapping, compatibility preview, personal/shared libraries, and one-click atomic application through UI, CLI, MCP, and AI     | Implemented |
| A4        | Continuous drivers    | Bounded scroll, pointer, drag, visibility, state, and variable inputs with clamp, reverse mapping, dead zones, accessibility, and runtime cleanup          | Implemented |
| A5        | Prototype transitions | Frame connections, navigate/back, overlays, after-delay, interruption, reverse playback, and compiled route transitions                                    | Implemented |
| A6        | Smart Match           | Stable transition keys, matched-layer interpolation, unmatched-layer dissolve, reduced-motion behavior, and deterministic fallback                         | Implemented |

## P2-B milestones

| Milestone | Scope                  | Acceptance summary                                                                                                                                                                                           | Status      |
| --------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| B1        | Advanced channels      | Multiple paints/effects, gradient stops, masks, independent corners, text reveal, variable-font axes, and topology-gated vector morph                                                                        | Implemented |
| B2        | Motion paths           | Cubic Bezier paths, on-canvas handles, constant-speed traversal, direction following, and path/runtime parity                                                                                                | Implemented |
| B3        | Animation export       | Deterministic frame rendering, PNG sequence, GIF and WebM, with optional desktop MP4, bounded loops, progress, and cancellation                                                                              | Implemented |
| B4        | Collaborative timeline | Stable track/keyframe identity, fine-grained CRDT updates, conflict visibility, and remote playhead/presence                                                                                                 | Implemented |
| B5        | Team libraries         | Parameter schemas, token bindings, version ranges, signed manifests, registry updates, review, rollback, and reproducible snapshots                                                                          | Implemented |
| B6        | Generated effects      | Bounded shader presets with explicit time/seed uniforms, Canvas runtime, deterministic frame export, and static fallbacks                                                                                    | Implemented |
| B7        | Runtime SDK            | Framework-neutral prepared plans and fail-closed DOM projection, Unicode text reveal, Vanilla and Vue adapters, package-owned kernel embedded by React compiler, SSR safety, tree shaking, and cleanup tests | Implemented |

## Verification status

Automated acceptance covers the versioned schemas and migrations, reference sampler and Canvas
projection, compiled browser runtime, authoring UI, CLI, MCP/AI tools, `.fig` and `.pen` persistence,
clipboard and component remapping, collaboration checkpoints, deterministic export, package builds,
and the public Runtime SDK. The CI manifest assigns every root engine and Motion Runtime unit test to
exactly one shard, runs compiler and Motion/SDK shards explicitly, rejects heavy suites that are not
enrolled in the scheduled heavy gate, and provides dedicated Chromium P2 Motion and desktop Rust
test jobs.

The four pre-existing manual P0/P1 ACKs remain native JSON open/save dialogs, persistence across a
real desktop process restart, desktop `.fig` save/close/reopen, and live Figma Desktop plugin readback
and rollback. Operational checks that require infrastructure outside one automated runner also remain
explicit verification boundaries: two-machine WebRTC presence, a production HTTPS Team library
registry, and native browser transition pixel quality. These do not expand the persisted/runtime
contracts, and none are represented as automated passes. Figma-native multi-track Motion and Figma
Smart Animate remain P2-C rather than OpenPencil Smart Match.

## Shared release gates

### B3 delivery boundary

The public `@open-pencil/core/io` exporter plans frames at an exact integer microsecond timebase,
samples node-local or scene plans through the reference sampler, and renders every PNG against one
fixed canvas. It exposes progress and `AbortSignal`, explicit reduced-motion behavior, hard resource
limits, file-signature verification, and pluggable encoders. PNG sequences and a deterministic
GIF89a encoder are built in. GIF uses a fixed 3-3-2 palette, a one-bit alpha threshold, and the GIF
10 ms timebase, so identical inputs produce identical bytes.

The browser/app export panel adds WebCodecs VP8 WebM with integer-microsecond timestamps and an
explicit `opaque-only` alpha contract; codec output is a valid WebM stream but is not claimed to be
bit-identical across browser engines. CLI and MCP discover a real FFmpeg executable from the
explicit option, `OPENPENCIL_FFMPEG_PATH`, or `PATH`, then expose only codecs actually reported by
that binary. WebM is opaque-only and MP4 remains an optional desktop/Node capability.

CLI and MCP stage output beside the destination and preserve every pre-existing path. Encoded files
are atomically published through a same-filesystem no-replace hard link. PNG sequences first claim a
new destination directory exclusively, then publish every staged frame and `manifest.json` through
no-replace hard links. The directory can become visible while those links are added, so a successful
command plus its manifest is the completion boundary; cancellation or failure removes only entries
created by that export. A filesystem without the required hard-link guarantee fails closed.

Tauri uses a scoped native `persist_noclobber` command. Browser animation exports finish encoding
before handing the payload to the browser download manager, whose user-agent collision policy owns
renaming or overwrite confirmation; OpenPencil does not claim programmatic browser no-clobber. MCP
file writes remain restricted to `OPENPENCIL_MCP_ROOT`, and the Core ToolDef does not acquire direct
filesystem authority. Capability absence always fails closed instead of emitting renamed PNG or
partial media.

FFmpeg WebM output is first encoded as bounded VP8/VP9 IVF and then placed in OpenPencil's
integer-microsecond WebM container. This preserves the authored duration when the final frame is
shorter than `1 / fps`. Optional MP4 remains constant-frame-rate and therefore accepts only plans
whose total duration ends on a complete frame; other plans fail before FFmpeg starts and direct the
caller to WebM or an aligned duration/fps pair. Process startup failure, cancellation, and
SIGTERM-to-SIGKILL escalation all release stream listeners and temporary output.

The app panel reports each phase and exposes an explicit Cancel action. Interactive non-JSON CLI
runs report throttled progress on stderr and propagate <kbd>Ctrl</kbd> + <kbd>C</kbd> through frame
sampling, encoding, and atomic output. MCP forwards request cancellation to the live app renderer
and Node encoder/writer, and emits `notifications/progress` when the client supplies a progress
token. Built-in AI exposes `export_motion_animation` from its curated registry, propagates the AI
request `AbortSignal`, and commits PNG-sequence ZIP or GIF output through the app save surface
without returning binary payloads to the model. The chat transcript does not currently render
per-phase export progress, and built-in AI has no MP4 encoder; unsupported requested formats fail
closed.

### B4 collaboration contract

MotionSpec v3 tracks use their authored track ids, while keyframes may carry an optional stable id.
Legacy v3 keyframes are deterministically assigned ids only when they first enter a collaborative
timeline; opening a document alone does not migrate it, and v1/v2 never gain v3 identity fields.
Clone and ordinary edits preserve ids, while duplicating a keyframe leaves its identity empty so the
collaboration migration allocates a distinct id.

Collaborative v3 timelines live in a dedicated `motionTimelines` Yjs map instead of the node map's
opaque `motion` field. Tracks and keyframes are nested maps keyed by stable identity; unchanged
fields are not rewritten, so concurrent edits to different timing, channel, order, or offset fields
merge independently. Deletes create tombstones, which win over a concurrent move. A client that has
already observed a tombstone can intentionally restore it through undo/redo; an offline stale edit
does not clear a tombstone during reconnect. v1/v2 continue through the legacy opaque field.

Decoding sorts equal positions by stable id, bounds track/keyframe counts, normalizes concurrently
invalid endpoints, removes partial channels that would violate MotionSpec's all-keyframe rule, and
drops invalid tracks deterministically. It fails closed before materializing a track map above the
stored cap. Every local sync, remote observer update, and pre-existing-state hydrate runs the same
re-entry-safe checkpoint: live records are retained first by authored order then stable id, remaining
capacity retains deterministic tombstones, and both live records and tombstones are physically bound
to 64 tracks per node and 128 keyframes per track.

The top-level timeline map is physically capped at 256 node owners before any per-node decode.
Checkpoint retention prefers owners already present in the SceneGraph, then uses ASCII-stable node
ids. A timeline whose node record is present in Yjs but has not reached the graph yet may occupy
bounded pending capacity, but is not decoded until the node arrives; entries with neither a graph nor
Yjs node are orphaned and removed. Invalid top-level values, over-cap owners, and legacy timelines for
instances that inherit Motion from their component are removed in the untracked checkpoint transaction
and reported through one bounded document conflict notice.

Instances without an explicit override never publish inherited `motion`, `motionScene`,
`motionDrivers`, `prototype`, `transitionKey`, or `generatedEffect` fields into their own Yjs node.
Remote instance updates likewise ignore legacy inherited snapshots and their deletion events, leaving
the component as the single collaborative source of truth. Explicit overrides, including null clears,
remain instance-owned; v3 Motion overrides continue through the dedicated timeline map.

The checkpoint accepts only the v3 CRDT field whitelist and traverses nested values with fixed
depth, collection-entry, string, aggregate-entry, and two-megabyte per-node budgets. Unknown or
over-budget fields are quarantined before canonical MotionSpec parsing; resource, schema, merge, and
tombstone resolutions remain visible as bounded collaboration notices. Tombstones remain causal until
an explicit checkpoint needs their capacity. Awareness carries only sanitized ephemeral node/scene
owner ids, selected track/keyframe/cue ids, playhead time, and playing state; it is never persisted
into `.fig` or `.pen`.

Every completed milestone must provide the following evidence for each applicable persisted,
author-facing, runtime, or delivery surface:

- strict parse, clone, migration, malformed/future-version, and resource-limit tests;
- explicit `.fig`, `.pen`, clipboard, component instance, and collaboration behavior;
- UI, CLI, MCP/AI, and public SDK coverage where the feature is author-facing;
- fixed-time numerical and pixel parity across the reference sampler, Canvas, and generated runtime;
- reduced-motion, keyboard, flashing-risk, undo/redo, cleanup, and large-scene performance coverage;
- documentation and changelog updates that distinguish shipped behavior from external/manual bounds.
