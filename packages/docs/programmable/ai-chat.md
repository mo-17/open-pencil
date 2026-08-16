---
title: AI Chat
description: Built-in AI assistant with a curated 50+ tools for creating and modifying designs.
---

# AI Chat

Press <kbd>⌘</kbd><kbd>J</kbd> (<kbd>Ctrl</kbd> + <kbd>J</kbd>) to open the AI assistant. Describe what you want — it creates shapes, sets styles, manages layout, works with components, and analyzes your design.

## Setup

1. Open the AI chat panel (<kbd>⌘</kbd><kbd>J</kbd>)
2. Click the settings icon
3. Add a model and configure its provider, model ID, credentials, and capabilities
4. Save the model and assign it to **Design agent**

You can configure multiple reusable models and separately assign models for design work, reviews, fast tasks, and image input. Models using the same provider connection reuse its stored credential.

### Supported Providers

| Provider                 | Models                                          | Setup                                                                                                       |
| ------------------------ | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **OpenRouter**           | Claude, GPT, Gemini, DeepSeek, Qwen, and others | API key from [openrouter.ai](https://openrouter.ai)                                                         |
| **Anthropic**            | Claude Sonnet 4.6, Claude Opus 4.6              | API key from [console.anthropic.com](https://console.anthropic.com)                                         |
| **OpenAI**               | GPT-5.3 Codex, GPT-4.1, o3, o4-mini             | API key from [platform.openai.com](https://platform.openai.com)                                             |
| **Google AI**            | Gemini 3.1 Pro, Gemini 3 Flash                  | API key from [aistudio.google.dev](https://aistudio.google.dev)                                             |
| **Z.ai**                 | GLM-5.1, GLM-5, GLM-4.7, GLM-4.5 family         | API key from [docs.z.ai](https://docs.z.ai/devpack/quick-start)                                             |
| **MiniMax**              | MiniMax M3, M2.7, M2.7-highspeed, M2.5, M2.1    | API key from [platform.minimax.io](https://platform.minimax.io/user-center/basic-information/interface-key) |
| **OpenAI-compatible**    | Any endpoint with OpenAI API format             | Custom base URL + key. Supports Completions and Responses API toggle.                                       |
| **Anthropic-compatible** | Any endpoint with Anthropic API format          | Custom base URL + key                                                                                       |

No backend, no subscription — your key talks directly to the provider. Browser requests are subject to each provider's CORS policy, and model deployments vary in how reliably they stream tool calls. See [BYOK provider and model compatibility](./byok-provider-compatibility) for measured results and reproduction steps.

### External MCP connections

Desktop ACP agents can also use trusted remote
[Model Context Protocol](https://modelcontextprotocol.io/) servers. In
**Settings → MCP connections**, add a named Streamable HTTP endpoint, optionally save a bearer
token, and enable the connection. OpenPencil stores the token in the configured credential backend
rather than ordinary settings and resolves it only when starting the ACP session.

Remote servers must use HTTPS. Loopback HTTP endpoints are accepted for local development. Review
and trust a server before enabling it: its tools may read external data or perform actions with the
credentials you provide. OpenPencil's built-in design MCP server remains attached automatically and
does not need to be added here. These ACP-wide connections are separate from the per-model Remote
MCP servers described below for Direct chat.

### Desktop coding-agent session continuity

Claude Code, Codex, and Gemini CLI use ACP in the desktop app. For a source-backed document,
OpenPencil's local session store contains the ACP session/thread ID and the non-secret metadata
needed to route it safely: the local path or storage provider/document IDs, the isolated scope, a
SHA-256 identity of the effective model and selected Remote MCP configuration, and timestamps. The
store never contains prompts, attachments, the visible OpenPencil transcript, agent history, or
credential secrets, and none of this session metadata is written into the `.fig` document.

Each binding is isolated by document, requested role, provider and agent, connection, complete
OpenPencil model configuration, credential profile, selected Remote MCP server configuration, and
OpenPencil prompt-context version. An unsaved document keeps its session only in process memory. Its
first save preserves that document scope and attaches the new path or storage identity; **Save As**
creates a new document scope and leaves the source document's binding separate. A new or replacement
session ID is committed to the local persistent store only after its first prompt completes
successfully. If the durable write fails, the active agent session remains usable, but the session
control and a warning toast report that its ID was not saved and therefore may not restore after a
restart.

When a chat starts or you switch back to it, OpenPencil offers the matching ID to the agent only if
the agent explicitly advertises the ACP `session/resume` capability. If resume is unavailable or
fails, OpenPencil starts a replacement session. The old binding is not silently replaced during
setup: after the fallback completes its first prompt and becomes active, the chat shows a notice and
stores the replacement ID. Automatic context compaction, if supported, remains the coding agent's
responsibility; OpenPencil only reconnects the isolated thread. Actual restoration also depends on
the installed agent retaining that thread and implementing ACP resume.

The session control reports the setup result as connecting, resumed, new, fallback, or failed and
shows the active session ID. If the installed agent advertises the unstable ACP `session/list`
capability, opening the control explicitly requests a bounded list for the displayed ACP working
directory. This is an agent-owned history, not a list scoped to the open design: it can include
threads created by another client using the same agent connection and working directory.
OpenPencil therefore treats Agent titles, timestamps, and the working directory as display hints,
not identity. It cross-checks returned IDs against the existing local document/configuration
bindings and groups candidates as **Exact match**, **Same document** with different AI settings, or
**Source unverified**. Existing sessions that were never bound locally remain unverified, even when
their title or directory looks familiar. Non-exact candidates require confirmation. The Agent's
discovered title catalog is not copied into local storage or the design document.

Choosing **Resume** opens the selected ID in a candidate transport with fallback disabled. The
current chat and binding remain active until the candidate succeeds; a failed manual resume is
reported as **Resume failed; current session unchanged** without silently creating a new thread.
After a successful switch, the selected ID follows
the same durability rule as every replacement and is stored for the current document scope only
after its first successful prompt. `session/resume` restores the coding agent's internal context but
does not replay the visible OpenPencil transcript. Agents without `session/list` keep automatic
document-scoped continuity but do not show the history picker.

To verify continuity across a real desktop restart:

1. Open a saved design with a configured ACP agent, send one successful prompt, then open the
   session control and copy its session ID.
2. Quit OpenPencil normally, relaunch it, and reopen the same design without changing the Design
   model, connection, credentials, Remote MCP selection, or agent.
3. Open AI chat and confirm that the control reports **Session restored** with the same ID. The
   visible transcript will be empty by design; send a follow-up that depends on the earlier context
   to verify the agent retained the thread.
4. A **New session after restore failed** or **Session unavailable** result is a real failed restore,
   not a restored conversation. Record the requested and active IDs; development builds can also
   copy the ACP log before retrying.

Manager, storage, and mocked transport tests exercise the same binding rules but are not substitutes
for this installed-agent, quit-and-relaunch check.

**Force stop** terminates a stuck transport without deleting an existing resumable binding. **Clear
chat** waits for deletion of the current document-and-configuration session binding from local
persistent storage before opening its replacement; if deletion fails, the chat shows an error rather
than silently reporting success. ACP does not provide a stable cross-agent delete API, so Clear does
not delete history retained by the coding agent. It also does not immediately remove the document
alias used for local routing: an alias with no retained session is pruned after 90 days during
cleanup.

Session records expire after 90 days of inactivity. Cleanup retains at most 8 bindings per document
and 200 globally. Direct API providers do not read ACP records and continue to use only bounded
in-memory message history. In both paths, the visible OpenPencil transcript itself is not currently
persisted across an application restart, even when an ACP agent restores its internal context.

## Visual references

Use the paperclip to attach a PNG, JPEG, or WebP, or select visible canvas layers and choose
**Attach current selection**. The composer shows the provider and model that will receive the image;
nothing is sent until you submit the message.

OpenPencil re-encodes every reference to remove embedded metadata and bounds it to a 2048 px edge,
four attachments, and 6 MB combined. A canvas selection is rendered from its visible appearance, so
cropped-away source pixels are not uploaded. Full payloads are retained only for the active request;
the chat history keeps bounded thumbnails. Pixels, OCR text, and Vision briefs are treated as
untrusted reference data: instructions embedded inside an image do not grant tool authority or
override the user's normal message.

If the Design model supports both tools and image input, it receives the reference directly. If it
supports tools but not images, assign a separate **Vision** model to create a grounded visual brief
for the Design agent. If those roles use different providers, the original pixels go only to the
Vision provider; the Design provider receives the bounded text brief plus non-image source
provenance. For a canvas selection, that provenance can include up to 64 captured node IDs so the
Design agent can verify and locate the source; each provenance record is bound to its image by a
zero-based attachment index, and paperclip attachments are marked as chat-only. The composer shows
the pixel route before submission. Desktop coding agents receive images only when their ACP
handshake advertises image prompt support. Unsupported configurations fail before prompting and keep
the draft available.

Ask the assistant to recreate or adapt the reference as editable frames, text, shapes, and
components. **Attach current selection** keeps the source nodes on the canvas so the assistant can
build beside them or inside a named target. A paperclip attachment is chat-only and is not inserted
onto the canvas; its result is created on the current page or inside a named target. To keep an
uploaded screenshot visible beside the result, place it on the canvas first and attach its current
selection.

## Optional model capabilities

Optional network and execution capabilities are configured per model and are **off by default**.
Settings migrated from an earlier version keep all of them disabled until you explicitly opt in.

### Web search and hosted code execution

- **Web search** is available for direct OpenRouter models. It installs OpenRouter's
  `openrouter:web_search` server tool only for models where you enable it. Search queries and the
  relevant chat context go to OpenRouter, provider search charges may apply, and returned URL or
  document citations appear as source cards. See the
  [OpenRouter server-tool documentation](https://openrouter.ai/docs/guides/features/server-tools/web-search).
- **Code execution** is available for direct OpenAI models through the Responses API Code
  Interpreter tool. Python runs in an OpenAI-hosted auto container, not in OpenPencil, your shell,
  or your local filesystem. Generated-file citations appear as document source cards; file parts
  that include a safe HTTP(S) URL appear as explicit assistant-file links. See the
  [OpenAI Code Interpreter guide](https://developers.openai.com/api/docs/guides/tools-code-interpreter).

OpenAI-compatible endpoints do not inherit Code Interpreter support merely because they implement
the Responses wire format. Unsupported provider/capability combinations fail before a prompt is
sent. Provider-controlled remote image files are shown as explicit links instead of being fetched
automatically by the renderer; bounded inline raster outputs can be previewed in chat.

### Remote MCP servers

In **Settings → AI & agents → Remote MCP servers**, add a trusted
[Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
endpoint, choose no authentication or a Bearer token, then edit a model and select the servers it
may use. Up to eight servers can be enabled for one model. Tokens are resolved from the unified
credential store when a session starts and are never written into model or MCP settings.

OpenPencil applies the following boundary:

- Only HTTPS endpoints are accepted, except loopback HTTP for local development. Embedded URL
  credentials and fragments are rejected. The app-owned Direct transport also rejects redirects.
- The Direct runtime namespaces tools as `mcp__<server-id>__<tool>`. Its discovery pages, transport
  bytes, schema bytes, tool counts, call duration, and result size are bounded; partial startup
  failures close every opened client.
- Tool names, descriptions, schemas, and results are treated as untrusted third-party data. Direct
  chat requires an explicit approval for every call and shows the locally configured server name,
  origin, and exact tool input. Approval applies to that call only.
- Desktop ACP agents receive the selected servers when OpenPencil creates a session or resumes one
  through an advertised `session/resume` capability. The selected agent—not OpenPencil—controls
  redirect handling and whether it requests permission for each MCP call, so enable Remote MCP for
  ACP only with an agent whose policy you trust. The selected server IDs, URLs, authentication types,
  and credential-profile IDs participate in the non-secret configuration SHA-256 identity. Changing
  one of those fields, the Design assignment, or the provider invalidates the active transport and
  selects a separate persisted binding.
- Direct chat connects from the app WebView, so a remote endpoint must allow that origin through
  CORS. ACP agents connect from their own process and do not share this WebView limitation.

The first release intentionally excludes remote stdio, legacy HTTP+SSE, OAuth, arbitrary secret
headers, persistent approvals, MCP resources/prompts, and a native streaming proxy. Use the
connection test beside a configured server to verify the endpoint and credential without invoking
one of its tools.

Web search grounds a model response; it does not import an arbitrary website's HTML/CSS or promise
a pixel-identical editable reconstruction. Website URL import remains a separate workflow.

## What It Can Do

The assistant has a curated 50+ tools across these categories:

- **Create** — frames, shapes, text, components, pages, and real lowcode controls. Renders JSX for complex layouts without substituting visual Frames for functional controls.
- **Style** — fills, strokes, effects, opacity, corner radius, blend modes.
- **Layout** — auto-layout, grid, alignment, spacing, sizing.
- **Components** — create components, instances, component sets. Manage overrides.
- **Variables** — create/edit variables, collections, modes. Bind to fills.
- **Query** — find nodes, XPath selectors, read properties, list pages, fonts, selection.
- **Inspect** — `get_jsx` for JSX roundtrip view, `diff_jsx` for structural diffs, `describe` for semantic role and design issue detection.
- **Analyze** — color palette, typography audit, spacing consistency, cluster detection.
- **Export** — PNG, SVG, JSX with Tailwind classes.
- **Vector** — boolean operations, path manipulation.
- **Motion** — inspect and author node timelines, scenes, continuous drivers, prototypes, Smart
  Match keys, bounded generated effects, and multi-node recipes; browse and apply presets; verify
  signed Team libraries and atomically apply an entry; or export deterministic animation artifacts.
  Built-in AI can save a PNG-sequence ZIP or GIF through the app save surface without returning the
  binary payload to the model. Stopping the AI request cancels the export; the chat transcript does
  not currently display per-phase export progress. WebM/MP4 remain capability-gated and fail closed
  when the app host has no matching encoder.

## Verification

After creating or modifying designs, the assistant uses `describe` to inspect the generated
structure and correct concrete layout warnings. When you attach a visual reference, a
vision-capable model also grounds the initial plan in its visible pixels. OpenPencil does not
automatically upload the canvas or promise pixel-perfect recovery of exact fonts, hidden
interactions, or responsive behavior that cannot be observed.

## Example Prompts

- "Create a card with a title, description, and a blue button"
- "Make all buttons on this page use the same border radius"
- "What fonts are used in this file?"
- "Change the background of the selected frame to a gradient from blue to purple"
- "Export the selected frame as SVG"
- "Find all text nodes with font size less than 12"
- "Describe the selected component — what role does it look like?"
- "Show me the JSX for this frame"

## Tips

- Select nodes before asking — the assistant knows what's selected.
- Be specific about colors, sizes, and positions for precise results.
- The assistant can modify multiple nodes in one message.
- Use "undo" in the editor if you don't like the result — AI mutations support full undo.
- All layout is recomputed automatically after each tool execution.
