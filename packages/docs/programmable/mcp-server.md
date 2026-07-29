---
title: MCP Server
description: Connect Claude Code, Cursor, Windsurf, and other MCP clients to OpenPencil for AI-assisted design inspection and editing.
---

# MCP Server

OpenPencil includes an MCP (Model Context Protocol) server that lets AI coding tools — Claude Code, Cursor, Windsurf, etc. — read and modify designs through the running app.

Two transports: **stdio** for MCP clients, and **Streamable HTTP** for browser extensions and scripts. On macOS and Linux, local clients prefer a private Unix domain socket; Windows and unavailable sockets fall back to localhost TCP.

## Install

```sh
npm install -g @open-pencil/mcp
```

## Stdio (Claude Code, Cursor, etc.)

The stdio server discovers the running OpenPencil app automatically. It prefers the app's Unix domain socket on macOS and Linux and falls back to localhost TCP when needed. Make sure the desktop app is open with a document loaded.

### Claude Code

Install the MCP package and register it with Claude Code:

```sh
npm install -g @open-pencil/mcp
claude mcp add --scope user open-pencil -- openpencil-mcp
```

Check the connection:

```sh
claude mcp list
```

Claude Code asks before using each MCP tool unless you allow the server's tools. To auto-approve OpenPencil tools only, add this to `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": ["mcp__open-pencil__*"]
  }
}
```

This is narrower than `--permission-mode bypassPermissions`, which skips prompts for every tool. You can also approve tools interactively from Claude's prompt by choosing “Yes, and don't ask again”.

Example prompt:

```text
Use the open-pencil MCP server to inspect the current page and create a small hero section on the canvas.
```

### Other MCP clients

Add to your MCP config (for example `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "open-pencil": {
      "command": "openpencil-mcp"
    }
  }
}
```

Or run from source without installing:

::: code-group

```json [Bun]
{
  "mcpServers": {
    "open-pencil": {
      "command": "bun",
      "args": ["/path/to/open-pencil/packages/mcp/src/stdio.ts"]
    }
  }
}
```

```json [Node.js]
{
  "mcpServers": {
    "open-pencil": {
      "command": "npx",
      "args": ["tsx", "/path/to/open-pencil/packages/mcp/src/stdio.ts"]
    }
  }
}
```

:::

## HTTP

For browser extensions, scripts, CI, or any HTTP client:

```sh
openpencil-mcp-http
```

Or from source: `bun packages/mcp/src/index.ts` / `npx tsx packages/mcp/src/index.ts`

Security defaults:

- Unix socket and discovery files are created with owner-only permissions on macOS and Linux.
- TCP binds to `127.0.0.1` and uses port 7600 by default.
- Authentication is enabled by default with a generated token stored in the private discovery file.
- `eval` is disabled.
- File operations are limited to `OPENPENCIL_MCP_ROOT` (defaults to the current working directory) and reject symlink escapes.
- CORS is disabled by default; set `OPENPENCIL_MCP_CORS_ORIGIN` to allow one origin.

Set `PORT=0` to disable TCP on macOS and Linux. Windows requires TCP. Set `OPENPENCIL_MCP_SOCKET` to override the Unix socket path, or `OPENPENCIL_MCP_DISCOVERY_PATH` to override the discovery file location. To provide a stable token, set `OPENPENCIL_MCP_AUTH_TOKEN`; an explicitly empty value disables authentication and should only be used with a trusted local socket.

Endpoints are available over both active transports:

- `GET /health` — server and app connection status; never returns the auth token.
- `POST /rpc` — authenticated live-app automation.
- `POST /mcp` — MCP Streamable HTTP. Sessions use the `mcp-session-id` header.

## Workflow

1. **Discover targets** — call `list_documents` first when more than one document or page may be open. It returns stable `document_id` and page IDs.
2. **Open** — `open_file` to load an existing `.fig`, or `new_document` for a blank canvas. These return target metadata for the opened or created document.
3. **Read** — `get_page_tree`, `find_nodes`, `get_node`, `list_pages`
4. **Create** — `create_shape`, `render` (JSX)
5. **Modify** — `set_fill`, `set_stroke`, `set_layout`, `update_node`, `set_effects`, or the bounded
   Motion tools
6. **Structure** — `reparent_node`, `group_nodes`, `clone_node`, `delete_node`
7. **Save** — `save_file` to write back to `.fig`

Most tools accept optional `document_id` and `page_id` fields. Pass them explicitly for agent workflows instead of relying on the visible active tab/page. `create_page` only creates a page; call `switch_page` separately when the workflow should change the active page.

## AI Agent Skill

Teach your AI coding agent to use OpenPencil tools:

```sh
npx skills add open-pencil/skills@open-pencil
```

Works with Claude Code, Cursor, Windsurf, Codex, and any agent that supports [skills](https://skills.sh). The skill covers the CLI, MCP tools, JSX rendering, eval, and the running app's automation bridge.

## Tools

### Document

| Tool             | Description                                  |
| ---------------- | -------------------------------------------- |
| `open_file`      | Open a `.fig` file for editing               |
| `save_file`      | Save the current document to a `.fig` file   |
| `new_document`   | Create a new empty document                  |
| `list_documents` | List open app documents/tabs and their pages |

### Read

| Tool               | Description                                         |
| ------------------ | --------------------------------------------------- |
| `get_selection`    | Get currently selected nodes                        |
| `get_page_tree`    | Get the full node tree of the current page          |
| `get_current_page` | Get the current page name and ID                    |
| `get_node`         | Get detailed properties of a node by ID             |
| `find_nodes`       | Find nodes by name pattern and/or type              |
| `get_components`   | List all components in the document                 |
| `list_pages`       | List all pages                                      |
| `list_variables`   | List design variables                               |
| `list_collections` | List variable collections                           |
| `list_fonts`       | List fonts used in the current page                 |
| `page_bounds`      | Get bounding box of all objects on the current page |
| `node_bounds`      | Get bounding box of a node                          |
| `node_ancestors`   | Get ancestor chain of a node                        |
| `node_children`    | Get direct children of a node                       |
| `node_tree`        | Get the subtree rooted at a node                    |
| `node_bindings`    | Get variable bindings on a node                     |

### Create

| Tool                | Description                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `create_shape`      | Create a shape (`FRAME`, `RECTANGLE`, `ELLIPSE`, `TEXT`, `LINE`, `STAR`, `POLYGON`, `SECTION`) |
| `create_vector`     | Create a vector node from a path string                                                        |
| `create_slice`      | Create an export slice                                                                         |
| `create_page`       | Create a new page                                                                              |
| `render`            | Render JSX to design nodes — create entire component trees in one call                         |
| `create_component`  | Convert a frame/group into a component                                                         |
| `create_instance`   | Create an instance of a component                                                              |
| `node_to_component` | Convert an existing node into a component in-place                                             |

### Modify

| Tool                  | Description                                                                |
| --------------------- | -------------------------------------------------------------------------- |
| `set_fill`            | Set fill color (hex)                                                       |
| `set_stroke`          | Set stroke color, weight, alignment                                        |
| `set_effects`         | Add shadow or blur effects                                                 |
| `update_node`         | Update position, size, opacity, corner radius, text, font                  |
| `set_layout`          | Set auto-layout (flexbox) — direction, spacing, padding, alignment         |
| `set_constraints`     | Set resize constraints                                                     |
| `set_rotation`        | Set rotation angle in degrees                                              |
| `set_opacity`         | Set opacity (0–1)                                                          |
| `set_radius`          | Set corner radius (uniform or per-corner)                                  |
| `set_minmax`          | Set min/max width and height constraints                                   |
| `set_text`            | Set text content of a `TEXT` node                                          |
| `set_font`            | Set font family and weight                                                 |
| `set_font_range`      | Set font properties on a character range                                   |
| `set_text_resize`     | Set text auto-resize mode (fixed/auto-width/auto-height)                   |
| `set_visible`         | Show or hide a node                                                        |
| `set_blend`           | Set blend mode                                                             |
| `set_locked`          | Lock or unlock a node                                                      |
| `set_stroke_align`    | Set stroke alignment (inside/center/outside)                               |
| `set_text_properties` | Set text layout: alignment, auto-resize, text case, decoration, truncation |
| `set_layout_child`    | Configure auto-layout child: sizing, grow, alignment, absolute positioning |
| `node_move`           | Move a node to a new position                                              |
| `node_resize`         | Resize a node                                                              |
| `node_replace_with`   | Replace a node with another node                                           |
| `arrange`             | Align or distribute selected nodes                                         |

### Motion

| Tool                       | Description                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `read_motion`              | Read a node's complete bounded MotionSpec and summary                                       |
| `list_motion_presets`      | List categorized built-in presets, keywords, parameters, and bounds                         |
| `apply_motion_preset`      | Apply a built-in preset atomically to one or many nodes, with optional spatial stagger      |
| `apply_motion_spec`        | Apply strict MotionSpec JSON atomically to one or many nodes, with optional spatial stagger |
| `update_motion`            | Replace one node's MotionSpec with strictly validated JSON                                  |
| `clear_motion`             | Remove MotionSpec from one or many nodes                                                    |
| `apply_motion_recipe`      | Validate roles and parameters, then apply a multi-node Motion Recipe atomically             |
| `verify_team_motion_library` | Verify a signed Team library against a trusted Ed25519 key and engine version              |
| `review_team_motion_library_update` | Verify accepted/candidate manifests and return a deterministic review diff          |
| `manage_team_motion_library_registry` | Reverify and purely accept, reject, or roll back a registry review                |
| `apply_team_motion_library_entry` | Reverify a manifest or registry accepted snapshot, then atomically apply one entry     |
| `read_motion_scene`        | Read one page/frame scene timeline and cue summary                                           |
| `update_motion_scene`      | Replace one page/frame scene timeline after validating descendant track references          |
| `clear_motion_scene`       | Remove one page/frame scene timeline                                                        |
| `read_motion_drivers`      | Read one page/frame continuous-driver snapshot                                               |
| `update_motion_drivers`    | Replace bounded scroll/pointer/drag/visibility/state/variable drivers                       |
| `clear_motion_drivers`     | Remove one page/frame continuous-driver snapshot                                             |
| `read_prototype`           | Read one node's bounded Prototype connections                                                |
| `update_prototype`         | Replace navigation/overlay Prototype connections after validating targets                   |
| `clear_prototype`          | Remove Prototype connections from one node                                                   |
| `read_motion_transition_key` | Read one node's explicit Smart Match identity                                              |
| `set_motion_transition_key`  | Set one bounded explicit Smart Match identity                                              |
| `clear_motion_transition_key` | Remove one node's Smart Match identity                                                    |
| `read_generated_effect`    | Read one bounded generated-effect layer                                                      |
| `update_generated_effect`  | Set a safe built-in generated-effect preset and bounded uniforms                            |
| `clear_generated_effect`   | Remove one generated-effect layer                                                            |
| `get_figma_motion_adapter` | Diagnose the official Figma Motion Beta subset and return a safe plugin plan/script         |

The app's personal preset library is intentionally user-local and is not exposed as hidden MCP
state. An agent can read an applied personal preset from a node and use `apply_motion_spec` to copy
that complete snapshot elsewhere. This keeps live MCP behavior deterministic even when client and
desktop processes do not share browser storage.

Team library tools do not read hidden app storage or trust a manifest merely because it was supplied
by an agent. Callers provide the signed manifest, trusted SPKI public key, and current engine version.
An optional trusted key id asserts the initial publisher identity; registry operations anchor an
omitted key id to the accepted snapshot's publisher, preventing identity substitution with reused
key material. Verification/review are read-only extended tools; applying an entry is available to
built-in AI and expands the verified preset/recipe into complete node snapshots in one undoable
transaction.

### Structure

| Tool                | Description                         |
| ------------------- | ----------------------------------- |
| `delete_node`       | Delete a node                       |
| `clone_node`        | Duplicate a node                    |
| `rename_node`       | Rename a node                       |
| `reparent_node`     | Move a node into a different parent |
| `select_nodes`      | Select nodes by ID                  |
| `group_nodes`       | Group nodes                         |
| `ungroup_node`      | Ungroup a group                     |
| `flatten_nodes`     | Flatten nodes into a single vector  |
| `boolean_union`     | Boolean union of two or more nodes  |
| `boolean_subtract`  | Boolean subtraction                 |
| `boolean_intersect` | Boolean intersection                |
| `boolean_exclude`   | Boolean exclusion                   |

### Vector Path

| Tool         | Description                                   |
| ------------ | --------------------------------------------- |
| `path_get`   | Get the path data of a vector node            |
| `path_set`   | Set the path data of a vector node            |
| `path_scale` | Scale a vector path                           |
| `path_flip`  | Flip a vector path horizontally or vertically |
| `path_move`  | Translate a vector path                       |

### Export

| Tool                      | Description                                                                  |
| ------------------------- | ---------------------------------------------------------------------------- |
| `export_image`            | Export nodes as PNG, JPG, or WEBP. Returns base64-encoded image data         |
| `export_svg`              | Export nodes as SVG markup                                                   |
| `export_motion_animation` | Export bounded node/scene Motion as PNG sequence, GIF, WebM, or MP4           |

`export_motion_animation` requires a `path` and an `OPENPENCIL_MCP_ROOT`. The server validates the
path and output signatures and writes through a temporary sibling. Encoded files are atomically
published with a no-replace hard link. PNG sequences exclusively claim a new destination directory,
then no-replace hard-link every frame and `manifest.json`; successful completion plus the manifest
is the directory completion boundary. Existing destinations are preserved, while cancellation or
failure removes only entries created by that request. PNG sequences and deterministic GIF89a are
built in. WebM/MP4 are exposed only after the Node host discovers a real compatible FFmpeg encoder;
WebM is opaque-only and no placeholder media is written. Client cancellation propagates through
live-app frame rendering, Node encoding, and output publication. When the request includes an MCP
progress token, the server emits bounded
`notifications/progress` updates for those phases.

### Viewport

| Tool                   | Description                                  |
| ---------------------- | -------------------------------------------- |
| `viewport_get`         | Get current viewport position and zoom level |
| `viewport_set`         | Set viewport position and zoom               |
| `viewport_zoom_to_fit` | Zoom viewport to fit specified nodes         |

### Variables

| Tool                | Description                             |
| ------------------- | --------------------------------------- |
| `get_variable`      | Get a variable by ID or name            |
| `find_variables`    | Find variables by name pattern or type  |
| `create_variable`   | Create a new variable in a collection   |
| `set_variable`      | Set a variable value in a mode          |
| `delete_variable`   | Delete a variable                       |
| `bind_variable`     | Bind a variable to a node property      |
| `get_collection`    | Get a variable collection by ID or name |
| `create_collection` | Create a new variable collection        |
| `delete_collection` | Delete a variable collection            |

### Analyze

| Tool                 | Description                                     |
| -------------------- | ----------------------------------------------- |
| `analyze_colors`     | Analyze color palette usage across the document |
| `analyze_typography` | Analyze font/size/weight distribution           |
| `analyze_spacing`    | Analyze gap and padding values                  |
| `analyze_clusters`   | Detect repeated patterns (potential components) |

### Diff

| Tool          | Description                                               |
| ------------- | --------------------------------------------------------- |
| `diff_create` | Create a snapshot of the current document state           |
| `diff_show`   | Show differences between the current state and a snapshot |

### Navigation

| Tool          | Description                    |
| ------------- | ------------------------------ |
| `switch_page` | Switch to a page by name or ID |

### Escape Hatch

| Tool   | Description                                                              |
| ------ | ------------------------------------------------------------------------ |
| `eval` | Execute JavaScript with OpenPencil's Figma-compatible Plugin API surface |

Note: `eval` is available over stdio, but disabled in HTTP mode for security.
