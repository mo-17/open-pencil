# Changelog

## Unreleased

### Breaking changes

- Grid child Fill sizing uses independent axes: `layoutGrow > 0` fills width and `layoutAlignSelf: STRETCH` fills height; both flags fill both axes. Legacy fork documents that used only STRETCH for both axes keep their stored geometry, but need width Fill selected explicitly because their files contain no layout-semantics version marker.
- `@open-pencil/fig/instance-overrides` replaces `populateAndApplyOverrides` with the occurrence-scoped `interpretInstance` and `materializeInstance` APIs. Consumers must interpret source records, resolve component IDs, and materialize the resulting occurrence tree; Core's document reader handles this lifecycle for ordinary imports.
- The editor state's `remoteCursors` is now `presenceCursors`, typed `PresenceCursor[]` from `@open-pencil/core/canvas`, and each cursor has a `kind` of `'person'` or `'agent'`.
- `encodeNodeChangeWithVariables`, `encodePaintWithVariableBinding`, and `encodeVarint` are removed from `@open-pencil/core` and `@open-pencil/core/kiwi`. They spliced a colour-variable binding into encoded bytes because the field had no schema entry; exports now write `colorVar`, which `fig.kiwi` defines, so nothing needs them. `parseVariableId` is unchanged.
- The desktop app now requires macOS 13 or later; the web app supports Chrome 111, Edge 111, Firefox 128, and Safari 16.4 or later.
- Design JSX ownership moves from `@open-pencil/core` to `@open-pencil/design-jsx`, which depends on the format-neutral scene graph and emit packages. New consumers should import elements, paint/effect helpers, variables, `JSX_REFERENCE`, `buildComponent`, `sceneNodeToJSX`, and `selectionToJSX` from that package. This lowcode fork retains Core helper exports and the `renderTreeNode` alias for compatibility; Core owns icon/layout rendering and its Tailwind adapter. The old public `@open-pencil/core/io/formats/jsx` subpath is removed; Compiler uses the helpers exported by `@open-pencil/core/io`.
- `diff_create` and `diff_show` patches list changed JSX attributes per node, such as `-rounded={8}` and `+rounded={12}`, instead of `key: value` property lines, so they cover every property the JSX export writes and report reordered children as moves. `diff_show` takes JSX attributes in `attributes`, such as `w={200} bg="#FF0000"`, instead of a JSON `props` object, and patches in the old format no longer apply.

### Added

- Apply pixelation, twirl and saturation filters to the own content of static images, text and decorative containers, with parameter controls, reset, frame status and explicit retry. Preview own-content Shader animations on WebGPU hosts while retaining editable sources and saved-frame fallbacks in HTML, React/Vue components and Lowcode exports.

- Protect shared-room invitations with a random key in the URL fragment, retained when copying, reloading, or handing the room to the desktop app. Links without the key cannot join; ask the sharer for a new invitation.

- Add thirty-two curated local EffectPick CSS and SVG assets across buttons, backgrounds, text, cards and loaders with validated configuration, unpainted outer frames that remain selectable and draggable for embedding in designs, a browsable effect library, effect switching in the inspector, an isolated effect playground that preserves node dimensions and React/Vue source exports. The canvas shows static illustrations with current text and colors, and source redistribution permissions remain unreviewed.

- Import `flattenNodesToVectorProps`, `outlineStrokeNodesToVectorProps`, and the `VectorFlattenProps` type from `@open-pencil/core/canvas` to compute Flatten and Outline stroke geometry in an embedding app without going through the editor's own write path.
- Check designs from the new Lint tab in the right panel: issues on the page, in the selection, or across the document are grouped by rule, hovering one highlights its layer on the canvas, clicking selects it and brings it into view, and one-click fixes bind colors to the variable they match and round subpixel geometry for a row or a whole group, and snap radius, spacing, and small text to the scale, convert groups to frames, and delete hidden layers one row at a time. Rules can be turned off individually or switched between the Recommended, Strict, and Accessibility presets.
- See which layer the code is about in the Code tab's Design JSX and Tailwind JSX: the element around the cursor marks its opening and closing tag and shows its layer on the canvas as a tinted box, apart from canvas hover, and design issues are underlined on the property that causes them, including while you edit Design JSX live.
- Fix lint issues outside the app: `openpencil lint --fix -o fixed.fig` binds colors to the variable they match and rounds subpixel geometry, and the `lint` and `lint_fix` tools let MCP clients and AI chat check a page and apply those fixes, plus radius, spacing, text size, group-to-frame, and hidden-layer suggestions on request. Lint messages carry each fix as data in `fix` and `suggestions`.
- Mark layers with errors and warnings on the canvas while you work, and pin those outside the view to the canvas edge in their direction, with matching marks in the Layers panel and error and warning counts in the page list; hover a marker or pin for its issues or click it to open them in Lint, and turn markers on or off with View → Design issues.
- Follow collaborators and their AI agents from the avatars in the toolbar: an avatar counts that person's agents, hovering lists what each is doing and on which page, and clicking follows. A frame in their color and a “Following …” bar show whom you follow; Escape, clicking, scrolling, zooming, or switching pages stops it. Your own avatar renames your agents and leaves the room.
- See where the built-in AI chat is working: while it replies, a cursor whose outlined label shows a sparkle and a callsign such as _Fern_ marks the layers it edits. In a shared room, collaborators see each other's agents in the color of the person running them.
- See which pages people and AI agents are working on: the Pages panel marks those pages in their colors, the command palette names who is there, and the chat offers **Go to page** while its reply works on a page you're not viewing.
- Hide, lock, and constrain layers in design JSX with `visible={false}`, `locked`, and `constraints={{ horizontal, vertical }}`, set italic text with `italic`, and describe solid, gradient, and image strokes fully with `strokes`, `strokeWeights`, `strokeCap`, `strokeJoin`, and the node-level `dashPattern`. JSX export now writes these together with stacked, gradient, and image fills, every effect, absolutely positioned children, size limits, vertical text alignment, masks, and variable bindings, so rendering exported JSX reproduces them and `diff_jsx` reports changes to them. Code edits retain metadata that JSX does not express, including matched children when a parent is replaced.
- Jump between pages from the command palette: it lists the pages you visited recently in the tab, **Go to page…** lists every page, and typing a page name finds it.
- Choose how much an AI model thinks for each message from the chat composer, from Off to Extra high or the provider default. Anthropic, Google, DeepSeek, OpenAI, OpenRouter, and compatible models apply it, where reasoning effort previously reached only OpenAI and OpenRouter models. A model profile's thinking level, which replaces its free-text reasoning effort, sets the starting choice, and finished reasoning shows how long the model thought.
- Read AI tool calls at a glance: each call shows a one-line summary and buttons that bring the layers it touched into view, even on another page. Expanded, it shows highlighted JSX, scripts, and JSON input and output, and exported images inline. A render call's JSX streams in as the model writes it, and a long run folds its earlier steps into one row.
- Review what each AI edit changed from its tool call in the chat: a before and after image with a comparison slider or highlighted changed pixels, and a diff of the layers' JSX. Both are saved with the conversation. Settings → Chat → Change previews sets the image size (240, 480, or 960 px) or turns images off to keep only the JSX diff. The chat AI can check its own work the same way with `diff_changes`, which compares the page or a layer with its state before the run edited it as a patch that `diff_apply` can replay.
- Preview designs progressively on the canvas as direct AI providers stream JSX, without saving partial designs or adding intermediate undo steps. A preview stays with its page: it hides while you view another page and returns when you come back.
- Write design trees as TSX with `@open-pencil/design-jsx` as the JSX import source, and render them with `renderTree`.
- Swap the component behind an instance with `instance.swapComponent(component)` in the plugin API, as in Figma.
- Detach an instance from its component with `detachInstance()` in the plugin API, as in Figma, from scripts run through `eval`.
- Run scripts written for Figma's dynamic-page mode that call `figma.getNodeByIdAsync()` or `getMainComponentAsync()`; both resolve to the same nodes as their synchronous forms.
- Export components to Storybook with `openpencil export -f storybook`: one CSF3 story file per component set or component for React, Vue, or HTML, with a story and `select` controls per variant, a design image per variant, and an `openpencil://` link that opens the variant in OpenPencil. `--watch` re-exports on every save and removes stories of deleted components, and `--beside` writes each document's stories next to it, for many documents at once (#727).
- Export HTML and Tailwind JSX from the app's export options and through the IO registry, and export Tailwind JSX from the CLI with `-f tailwind-jsx` (`-f jsx --style tailwind` still works). HTML export of a single layer now includes the layer itself, as other formats do.
- Choose PPTX in the Export panel's format list, alongside PNG, JPG, WEBP, SVG, and PDF.
- Let AI and MCP agents verify and replay their edits with diff tools: `diff_visual` returns a pixel diff of two rendered nodes with the changed region, and `diff_apply` applies a `diff_create` or `diff_show` patch, including moved, added, and removed children, only when every node still matches it. The built-in AI chat enables `diff_create`, `diff_jsx`, and `diff_visual` by default.
- Compare designs from the terminal with `openpencil diff`: `create`, `jsx`, `show`, `apply`, and `visual` work on a file or the running app, and `diff files` compares two documents page by page and exits with status 1 when they differ.
- Add optional application-page entry conditions and unsaved-change confirmation for React/Vue. Apply paired expression/fallback or expression/message drafts atomically with undo and `.fig` persistence. Reject unsafe destinations and fallback cycles, block denied pages before mounting, and route confirmation through framework navigation guards. Keep saving in authored business workflows, retain default design/export behavior, and report unsupported native guard targets explicitly.
- Add opt-in React/Vue application page sessions for declared writable page state and window scroll, isolated by concrete route and query. Restore these sessions across same-document automatic preview recompilation without changing design defaults. Bound portable snapshots, retire old-frame writes when declarations change, and preserve legacy behavior when no policy is authored. Explicit policies support undo and `.fig` persistence. Add authored push/replace navigation and safe Back with an internal fallback; Flutter supports native navigation while page-session recovery remains explicitly unsupported there.
- Add an optional shared application shell with an editable Frame and empty flow content region. Project each business entry into the shared layout for React, Vue and Flutter source generation without changing authored nodes. Save both references atomically with undo, retain invalid references for repair, isolate shell bindings from page-local state, and preserve closed `.fig` and copy reference remapping. Include editable desktop sidebar/header and phone navigation examples.
- Add optional document Application mode with application/reference/component page roles, an entry Frame per business page, route authoring and an initial page. Scope generated applications to these entries while preserving shared component dependencies, original canvas geometry, undo and `.fig` metadata. Absent or disabled mode retains the existing design and code-export behavior; invalid application configuration reports diagnostics rather than exporting unrelated design content.
- Preserve concrete application preview URLs through selection and automatic recompilation, including route parameters, query and hash. Keep editor restoration out of browser Back/Forward history and synchronize replacement navigation. Reject unsupported starting routes in the page picker with a repair hint; dynamic application pages remain available for parameterized navigation. Correct React parameter interpolation with URL suffixes and Vue route bindings when reusing a detail page.
- Preserve Auto and Space between run-group distribution in Flutter responsive Wrap layouts through shared layout IR. Keep minimum run gaps, content-sized and single-run behavior, and existing fixed page output.
- Preserve authored main-axis and within-run cross-axis alignment in Flutter responsive Wrap layouts. Report unsupported wrap stretch, baseline and per-child alignment, and normalize projected size limits before native widget construction without changing scene data.
- Add focused responsive branch editing with inherited-value sources, explicit override/reset actions, nullable size and line-height resets, undo and `.fig` persistence. Preview a branch's width without replacing a mounted Web frame. Resolve overlapping compact/min-width layouts consistently and restore larger-screen values at 1280px.
- Add custom preview dimensions, continuous width adjustment, larger-text and keyboard-obstruction simulations while retaining the iframe and unsaved form values. Add opt-in, bounded Web adaptation diagnostics for horizontal overflow, clipped text and fixed-height text risks, with canvas node navigation and stale-result guards. These session-only tools leave authored geometry and production exports unchanged; native accessibility and keyboard behavior require device testing.
- Add per-page Device adaptation with Fixed size, Scale to width and Responsive layout for React/Vue and Flutter. Preserve legacy output by default, normalize negative design origins for proportional scaling, and follow effective breakpoint layouts for responsive frame height. Persist the setting in `.fig` with undo/redo; unsupported native layout features retain explicit compiler warnings.
- Add a `(0, 0)` button beside the zoom control to move the active canvas origin to its top-left without changing zoom or selection.
- Add selectable Auto (default), On save, Manual and Real-time preview synchronization. Successful current-document saves can trigger synchronization; cancelled saves, failed saves and recovery snapshots do not. Add an opt-in Flutter simulator session to checkout-based Tauri development, with device selection, bounded offline preparation, serialized hot reload and owned-session cleanup. Fix absolute Flutter controls with accessibility labels so `Positioned` receives valid Stack parent data. Preserve launcher PATH directories when resolving desktop CLIs.
- Complete all 42 bundled Vue module adapters with RichText, Audio Player, Lottie, Map, PDF Viewer, QR/Barcode and isolated HTML. Add caller-controlled Vue RichText AST updates and preserve explicit loading, cancellation and iframe security boundaries; ordinary raw HTML remains unsupported.
- Add read-only DataGrid row and single-series Chart data bindings for React/Vue, with reactive runtime validation, explicit empty/unavailable states, matching Canvas defaults and inspector choices. Keep bound CSV imports disabled. Add caller-controlled local File selection APIs and a controlled React RichText AST without document persistence or raw HTML.
- Add four editable compositions: step-by-step form, tree categories with details, drawer editing and an admin page shell. Each uses independent local state and ordinary editable nodes; stage forms own validation and preserve drafts on return.
- Allow Slide Menu v2 to map an optional uniquely named direct child as editable drawer content, with isolated Canvas editing and React/Vue form rendering. Existing configurations without the field retain authored trigger children. Invalid mappings fail closed; native source targets keep an explicit unsupported warning and static trigger.
- Add typed page/document state bindings, independent FORM validation and reset for Slider/Range, Rating and Date Range. Add opt-in Cascader with visual hierarchy editing, canvas path previews, accessible React/Vue selection and a bound basic template; invalid bindings never silently use example values.
- Bind Tree and TreeSelect selections to typed page or document state, with FORM validation and reset, configurable field names, and matching canvas defaults. Keep invalid values visible without rewriting business state, and give the two existing templates independent state.
- Bind Stepper to writable numeric page or document state, emit step-change events, and provide previous, next and reset controls in its editable template. Show invalid steps without changing state; step changes do not validate or submit forms.
- Add opt-in Walktour with editable steps and named child-layer targets, shared canvas trigger styling, and manually started React/Vue guidance with target highlights, previous/next navigation and clear unavailable-target feedback. Include a reusable local guide template without automatic business actions. Keep authored fields in their surrounding native FORM validation and reset scope, with nested forms and portaled module content owned separately.
- Add opt-in Org Chart with bounded editable hierarchies, visual parent and card editing, horizontal/vertical layouts and branch folding. Share offline canvas geometry with React/Vue output and include a reusable local organization template; no directory service or business-state authority is added.
- Add opt-in Pagination with responsive canvas and React/Vue navigation, bounded page buttons and numeric page/document state bindings. Include editable pagination and paginated-list templates; empty data, disabled controls and projected out-of-range pages never silently write state or fetch data.
- Add a Color picker INPUT variant with hexadecimal string bindings, native selection, form validation and read-only handling. Add opt-in Descriptions with editable label/value rows, responsive columns, layout and density settings, matching canvas and React/Vue presentation, and two reusable templates.
- Add Date-time picker, Number input and Password input templates, alongside the existing component library. Extend existing INPUT nodes with strict local date/time bounds and step validation, configurable native/custom/hidden number controls, and opt-in instance-local password reveal. Keep native form semantics, React/Vue bindings, canvas previews and explicit warnings for unsupported source-only targets.
- Add Autocomplete and Time picker input variants with visual properties, string value bindings and React/Vue form behavior. Include editable templates, local keyboard-searchable suggestions, time bounds and second-based steps, and readable canvas previews. Show array state choices for multiple Select bindings.
- Add array-valued multi-select with search, virtualized options, clear actions and React/Vue form binding; preserve authored empty values and multiple defaults. Add opt-in Date Range, Tree/TreeSelect and Popover/Popconfirm modules with visual properties, canvas renderers, keyboard interactions and six editable templates. Unbound date-range/tree values remain instance-local; popover confirmation provides local feedback, without executing a business action.
- Complete Markdown and Code Block Vue runtimes, multilingual canvas text and three editable content recipes. Align wrapped code line numbers, expose localized copy outcomes, and invalidate stale clipboard results. Keep Markdown HTML inert and images unloaded, isolate footnote return links per instance, and preserve authored runtime language. Cancel multiline inspector drafts before late events can target another node.
- Extend Chart with line, area, pie and donut views, shared canvas/React/Vue geometry, multilingual canvas labels, proportion-preserving SVG and an accessible data table. Add paired data editing with atomic undo and five templates; preserve v1 bar documents and reject negative circular data.
- Add opt-in Tooltip, Skeleton and Empty State modules with bilingual visual properties, offline canvas rendering and React/Vue runtimes, plus four templates. Tooltips support hover/focus/touch and Escape dismissal; skeleton animation respects reduced motion. Keep loading and empty presentation separate from automatic business-state detection.
- Add opt-in Avatar, count/dot Badge and Timeline modules with visual properties, matching canvas and React/Vue presentation, local-image avatar fallbacks, editable event lists and four reusable templates.
- Add opt-in Alert, linear/circular Progress and interactive Chip modules with bilingual visual properties, shared canvas/React/Vue appearance and four editable templates. Keep dismiss/select state instance-local, distinguish indeterminate progress from percentages, and support keyboard focus and reduced-motion preferences.
- Add opt-in Slider/Range, Rating, Stepper and Breadcrumb modules with visual configuration, offline canvas previews and React/Vue output. Support bounded local value selection, keyboard controls, editable step lists and safe breadcrumb links; retain explicit limits for form binding and business workflows.
- Expand Assets to 44 component templates: 37 basic components and seven compositions, including single-value and range sliders, star ratings, progress steps and breadcrumbs.
- Show checkbox and checkbox-group initial values on the canvas, with multilingual labels and disabled states. Resolve bound Input/Textarea initial text, mask password content, and clip single-line inputs correctly.
- Focus the first editable invalid form field without requiring an error summary, expose required/error associations, and ignore stale field identities. Fix Vue group blur validation, reject non-numeric values for numeric bounds, and keep empty React array state usable by controlled checkbox groups.
- Configure Accordion initial expansion, section order and single/multiple behavior visually with undo and stale-draft protection. Preserve multiline content and align canvas indicators with React/Vue output; add Vue playback and an editable FAQ composition.
- Localize the remaining DataGrid inspector labels and selection/density choices without changing version-1 configuration values.
- Use paragraph font fallback for Table cells and Slide Menu, Dropdown Menu and Upload Button canvas labels, retaining clipping and existing trigger geometry. Keep repeated form error descriptions unique across nested lists and component instances in React/Vue exports.
- Refresh tiled canvas images when a font finishes loading, even when the document has not changed, so newly inserted controls do not retain blank text tiles.
- Complete the opt-in Carousel plugin with visual slide editing, atomic initial-slide ordering, offline multilingual canvas previews, and React/Vue playback controls that remain within the authored bounds. Add configurable split/overlay layouts, image fit, caption placement/alignment, overlay opacity, and dots/numbers/fraction pagination. Position or hide navigation arrows and enable mouse dragging/touch swiping alongside autoplay and loop controls. Preserve explicit remote-image loading in previews and version-1/2 playback behavior; save edited settings with version 3.
- Align Tabs canvas headers with the compact rounded React/Vue controls, including CJK font loading. Distinguish inline text from mapped child content in the inspector; preview each tab without changing its initial selection and edit the corresponding original child layers with undo.
- Create custom Modal content and edit its original layers in a focused canvas with undo and a return-to-trigger action. Keep mapped content off the canvas trigger and display its configured icon and multilingual label. Resolve the body's fill layout within its own bounds so inputs and buttons remain visible in new templates and existing `.fig` files, without changing the trigger size or authored sizing modes.
- Make DataGrid CSV tools opt-in through the inspector in React/Vue previews and exports; hide empty selection/filter reset actions while preserving accessible status and local data. Resolve missing Chinese grid labels through canvas font fallback, including existing `.fig` documents.
- Keep short DataGrid viewports usable by scrolling oversized headers with their rows and restoring configured sticky headers when space is available.
- Add opt-in Select search and virtual scrolling to React/Vue previews and exports, with inspector switches, label filtering, keyboard navigation and bounded option DOM for large local lists. Preserve selected values while searching.
- Show Select labels, placeholders and bound initial options on the canvas. Add primary inspector option ordering, atomic default edits, duplicate-value guidance, localized clearing controls and text colors; fix Vue literal selection and guard dynamic empty values through native shadcn fallbacks. Inset plain native selector arrows with space for the label. Preserve settings through `.fig` readback.
- Paint radio-group options and initial selection on the canvas, including CJK fallback, disabled appearance and bound-state cache refresh. Expose Radio settings in Classic and Focused inspectors with undoable option edits and explicit binding precedence; prevent blank draft options from becoming selected defaults.
- Match switch canvas geometry and blue/gray colors with React, Vue and shadcn output using full authored bounds, scaled thumbs, padding and disabled opacity. Remove conflicting corner classes, undefined theme-color dependencies and duplicate shadcn thumbs; retain keyboard focus and reduced-motion behavior.
- Paint date-picker values on the canvas, respecting bound initial state, disabled/read-only appearance, padding and clipping. Show a date-format placeholder for empty or invalid dates without changing existing node sizes or requiring `.fig` regeneration.
- Browse basic component templates and common compositions in Assets, with bilingual search, local favorites, plugin availability, independent editable state and one-step insertion undo.
- Connect the reviewed Upload module's disabled state to bounded page/document expressions in React and Vue, keeping invalid or non-boolean results disabled.
- Configure native lowcode input types, bounded constraints, accessible names, disabled/read-only states and Select labels/values; edit independent field change/focus/blur actions with undo and stale-target protection.
- Place editable child frames inside Modal bodies and individual Tabs panels, preserving legacy text configurations and diagnosing invalid content mappings.
- Generate Vue Table, DataGrid and Tabs runtimes with bounded local operations and interactive content, alongside their React counterparts; show cross-page selection counts and provide explicit selection and column-filter reset actions.
- Preserve local Upload Button selections after cancellation or rejected files, deduplicate matching file metadata, and keep clear, removal focus, and disabled behavior consistent in React and Vue.
- Preserve native field event semantics in shadcn exports through diagnosed native-control fallbacks, and retain disabled options and accessible control names.
- Review field bindings, validation, submission and failure handling together in the form inspector, with direct navigation to the existing controls.
- Show Backend list loading, refresh, empty and failure states in React/Vue apps, retain same-query results during refresh, and retry reads without repeating writes.
- Show separate file-save and recovery-snapshot status with success times, persistent failure feedback and retry actions; keep cloud synchronization status separate.
- Check the managed preview's local dependencies, certificate, ports, database and identity metadata from the editor, with actionable diagnostics and a redacted copyable report.
- Show session-scoped ACP context capacity and latest token reports in chat, with explicit unavailable, invalid and expired states.
- Explain preview sign-in cancellation, timeouts and session expiry, and return to the previous business page after explicit sign-in without repeating failed writes.
- Run connected NestJS previews inside the editor, with system-browser sign-in authorization and authenticated data operations back in the embedded page.
- Remember trusted CA file paths on the current computer for each preview identity service, with separate configuration when a design is opened on another computer.
- Confirm template saves, deletes and business commands with editable React/Vue Toast actions; retain inline errors, drafts and saved-request recovery. Add note-deletion confirmation and keep command buttons visible while processing. Reject HTTP 202 as an unconfirmed command result instead of showing success.
- Adapt all 25 Backend starters to compact React/Vue web layouts with mobile page navigation, single-column records, grouped fields and preserved confirmation/recovery actions. Keep the desktop canvas editable and expose compact overrides in Responsive settings.
- Add phone, landscape, tablet and desktop sizes to embedded compiler preview without reloading the iframe or clearing unsaved inputs.
- Discover components and enabled plugin modules in the Assets workbench with source/category filters, description search, persistent favorites and direct access to insertion and configuration.
- Review a design brief from Assets or Code, preserve author notes while regenerating it, download or copy Markdown, and place it in AI input for review before sending.
- Import optional Business, Soft or Contrast variable presets with light/dark modes into independent collections, then bind selected properties and undo the import in one step.
- Guide business-template setup from the Backend panel with saved sign-in settings, required roles, first-record steps and current page links; include model-specific identity and startup instructions in NestJS exports.
- Add asset management, private quotation/contract fulfillment and recruitment with onboarding/offboarding checklists to the Backend library and AI, with editable React/Vue pages and NestJS exports.
- Add procurement/inventory, fixed two-stage enterprise approvals, versioned surveys, text courses with instructor grading and moderated community templates to the Backend library and AI, with editable React/Vue pages and NestJS exports.
- Add personal blog and automotive news templates with categories, draft editing, publication, public reading and private bookmarks. Automotive news also includes brand/model catalogs and separate editor/publisher roles; both export React/Vue pages and NestJS backends.
- Add a single-hospital registration template with departments, doctors, schedule capacity, private patient profiles, appointment cancellation/restoration and staff check-in/completion. Export React/Vue pages and transactional NestJS commands; real payment, identity verification and hospital-system integrations remain post-export work.
- Add a single-restaurant food-ordering starter with a persistent cart, dine-in/pickup checkout, server price checks, idempotent orders and kitchen transitions. Generate editable React/Vue pages with manual list refresh and a transactional NestJS backend; payments, printers and delivery remain post-export integrations.
- Add a video and live-channel template with public playback, private favorites, creator publishing and channel management, plus React/Vue video and HLS playback bindings.
- Add a rental and property-viewing starter with landlord-owned listings, publication, capacity-checked appointments, cancellation and audit history. Link the selected property's panorama to an opt-in VR Tour module with editable rooms and hotspots, interactive desktop previews and React/Vue exports.
- Export configured VR tours as Expo and Flutter WebView components or a separate Taro HTTPS viewing page, with bundled sample images, local player preparation and explicit setup guidance.
- Offer an opt-in experimental Prisma 8 CRM Backend Provider for React/Vue source exports, with Prisma customer queries, retained PostgreSQL business transactions and explicit model compatibility checks.
- Compose the five business starters into an existing NestJS application through reviewed library or AI module installation, with shared sign-in, separate account-directory permissions, preserved pages and atomic undo. Export real NestJS business modules in one application with validated ownership and dependencies; keep database changes separately reviewed.
- Add CRM, service desk, content/knowledge-base, booking/registration and project/task starters to the Backend library and Direct AI. Generate editable React/Vue workspaces with relation pickers, full article text, command recovery, role-aware server workflows and append-only business history.
- Enforce conditional publication reads, active related membership and current-record command authority in generated NestJS applications. Add bounded date/time parameters, server time checks and transactional booking capacity; preserve compound authorization in the visual Backend editor.
- Add separate commerce operations templates with a persistent multi-product cart, atomic store-split checkout, explicitly gated payment simulation, shipment and receipt actions, whole-order refund decisions, and commission/settlement records. Live payment channels, carrier integrations and actual payouts remain separate integrations.
- Create single-merchant and multi-merchant commerce applications from the Backend library or Direct AI chat, including catalog management, buyer orders, merchant fulfillment and store pages. Multi-merchant templates use one store per account with verified merchant roles and store membership; payment, carts and settlement remain outside these templates.
- Generate NestJS resources with selected read policies and tenant membership combined with verified roles, and recheck command membership inside the transaction before replaying a saved result. Unsupported tenant semantics are rejected by the Supabase provider.
- Browse Backend providers and built-in Personal notes or Single-item checkout templates in a searchable library, choose local Keycloak or custom public OIDC settings, and create each application in one undo step while protecting existing backends, login flows and unsaved drafts. Provider selection remains a draft change requiring an explicit save; plugin management uses the existing settings.
- Recover explicitly opted-in Backend command attempts after reload using an account-bound browser journal, saved-parameter retries, cross-tab exclusion, and visual inspect/acknowledge actions in React/Vue exports and the single-SKU shop example.
- Add bounded atomic NestJS commands with verified caller access, row locking, checked integer arithmetic and persistent idempotency; include a single-SKU checkout/cancellation example, visual command review, and React/Vue command actions with retained attempt keys and a request deadline.
- Extend NestJS generation with explicit public reads, verified JWT roles, enum and date types, constrained relations and indexes, and bounded filtering, search and sorted pagination exposed through the visual Backend editor.
- Add validated HTTP API contracts for explicit resource exposure, field projections, and server-side JWT configuration, with unsupported provider generation blocked.
- Add a NestJS Backend Provider that exports PostgreSQL owner-protected CRUD services, validated DTOs, JWT authentication, OpenAPI, a typed client and pinned dependencies alongside React/Vue source projects.
- Connect the NestJS visual workflow with public OIDC + PKCE configuration, undoable login/notes pages, authenticated LIST and form actions, and React/Vue browser clients that clear account data on logout and ignore stale requests.
- Connect desktop React and Vue live previews to an existing local NestJS service, with browser login, frontend hot updates, and automatic disconnection when the backend contract changes.
- Manage an isolated local NestJS preview on macOS/Linux desktop, with explicit dependency/database setup, automatic runtime rebuilds, reviewed SQL for supported model changes, and database preservation on stop. Keep bounded Unicode command arguments usable without crashing the desktop editor during permission initialization.
- Simplify NestJS preview setup with a status-led side panel, separate SQL review, and reusable Keycloak and OIDC configuration presets.
- Choose React or Vue for Desktop Backend review, staging Apply, capability verification, and migration export, with a fresh review required after switching frameworks.
- Edit nested Backend Workflow branches and declare server environment reference names, with reference-preserving renames and deletion guards.
- Add provider-neutral Backend/DataModel/Auth/Workflow/Migration contracts, data-only Backend
  Provider plugin declarations, a trusted deterministic Compiler Registry and artifact manifest,
  the first bundled Supabase provider, and a host-owned fail-closed release state machine with
  stale-plan checks, destructive confirmations, strict production gates, and secret-free receipts.
- Add opt-in source exporters for native WeChat Mini Program, Taro React, uni-app, and Mpx. Each
  target compiles the shared SceneGraph IR in a bounded Worker, archives through the path-safe ZIP
  boundary, preserves reviewed local raster assets and native pages, and emits explicit warnings
  instead of carrying AppID, credentials, remote code, custom font bytes, or unsupported web/runtime
  behavior into generated projects.
- Add the public `@open-pencil/motion` package for framework-agnostic deterministic Motion planning,
  sampling, projection, paths, generated effects, scene choreography, and continuous-input
  controllers. Existing `@open-pencil/core/motion` and core-root exports remain compatible while
  new consumers import the owning package directly; `@open-pencil/motion-runtime` now reuses it
  without depending on core.
- Add the public `@open-pencil/lowcode` package for framework-agnostic expressions, validation,
  routing, forms, server workflows, and runtime audits. Existing
  `@open-pencil/core/lowcode-validation` entry points remain as compatibility exports while new
  consumers import the owning package directly.
- Add the public `@open-pencil/plugin-contracts` package for portable declarative manifests,
  parameter and connector schemas, signed catalogs/packages, publisher trust, runtime indexes, and
  marketplace snapshots. Core keeps its host registries and built-in modules while its existing
  root and `plugins` exports remain compatible.
- Add tested pane-registry and recursive split-tree models for independently viewed same-document canvases, capped at four visible panes.
- Add explicit shared/view editor-state ownership and canvas render-state hooks as a foundation for independent same-document canvas panes.
- Run React lowcode previews in ordinary browsers through a bounded SceneGraph Worker, a
  browser-safe bundler, and a script-only sandbox while preserving the desktop sidecar path. Reusable
  components retain nested component dependencies in React previews and source exports, including
  references inside variants.

### Changed

- Save or cancel S3 connection settings explicitly, validate required fields inline, and test replacement credentials without saving them. Retain replacement drafts after partial saves and prevent late results from changing another profile.
- Translate Motion and Backend panel workflows, property section headings and filtering into German, Spanish, French, Italian, Japanese, Polish, Russian and Simplified Chinese, preserving technical identifiers and code examples. Clarify migration review identity and authorization bindings, custom-code draft validation and HTML head controls, and localize Stripe error-target controls and server-secret guidance.
- Recommend the latest models in the AI model picker: Claude Sonnet 5.5 (the new Anthropic and OpenRouter default), Claude Opus 5.5, GPT-6.1 Sol (the new OpenAI default), GPT-6 Astra, and GPT-6 Luna, and replace the free OpenRouter models OpenRouter retired with Qwen3.8 27B and Gemma 4 31B. Saved profiles keep the model they chose.
- The Linux AppImage no longer bundles `xdg-open`; opening links relies on the system's `xdg-utils`, as most desktop distributions provide.
- With nothing selected, the Code tab explains that it shows the selection's code and offers Write JSX for new layers, instead of showing a template frame that looked like a real layer.
- Design lint reports far fewer false positives in `openpencil lint` and the app: `no-hardcoded-colors` flags only colors that match a color variable and names it, `no-deeply-nested` flags only the layer that crosses the depth limit, `touch-target-size` checks the WCAG 2.2 AA minimum of 24 × 24 in the Recommended preset (Strict and Accessibility keep 44 × 44), matches control names as whole words (a layer named "Rectangle" is no longer a call to action) and ignores icons and controls inside other controls, `consistent-spacing` accepts multiples of 4, `color-contrast` checks text bound to color variables, and layers inside instances are checked once through their main component. The Recommended preset reports unbound colors, deep nesting, mixed text styles, and off-scale spacing as suggestions instead of warnings. Lint messages carry the measured values in `data`.
- Keep the Share button labeled Share while you are in a room, instead of turning it into a Connected status; a green dot on your avatar shows the room is live.
- Show Flatten, Outline text, and Outline stroke in the canvas context menu without icons, like every other item there.
- Keep an AI chat working on the page where it started when you switch to another page, instead of sending its next edits to whichever page is on screen. When the AI switches pages itself, your view follows.
- `openpencil://` and web `?node=` links select the layer on another page when the current page has none, switching to that page.
- Generate Tailwind JSX with the same class mapping as Tailwind HTML export, so both describe a design the same way, and write opaque colors as hex in HTML, CSS, and Tailwind output. Preserve native button tags, authored labels, and disabled state in both outputs; keep static CodePen button artwork inert while retaining labels, authored styles, and image fills. `openpencil export -f jsx --style tailwind` now exports a whole page when no `--node` is given.
- Show download progress with a percentage and transferred size while installing a desktop update, instead of an indeterminate message that lasted until the restart.
- **Fork npm namespace:** Starting with 0.15.0, release tooling maps this fork's workspace
  `@open-pencil/*` package names to `@open-pencil-lowcode/*` npm artifacts. Workspace manifests
  and source imports retain the upstream scope; fork consumers use the mapped scope for package
  installation, imports, peer dependencies, and compatibility subpaths. The external Yoga fork
  remains `npm:@open-pencil/yoga-layout` and is not remapped.
- Make container auto-layout controls explicit with an on/off switch and labeled flow choices, show parent-layout guidance for leaf controls, and keep width/height sizing modes visible. Sizing-menu undo restores layout geometry together with the mode.
- Refresh all built-in Backend application starters with editable, domain-specific navigation, sign-in pages, record cards and compact forms; preserve existing document designs and business actions.
- Give newly created restaurant templates a warm visual style, grouped customer and staff navigation, dish photos, readable CNY prices and compact forms while preserving the ordering workflow in React and Vue exports.
- Improve the single-SKU shop template with title search, ascending prices, sold-out indicators, stock-aware quantity checks, price estimates, checkout and cancellation confirmations, and recent orders showing saved product titles, creation times and localized status. Existing documents require a new template or an explicit migration; the server still confirms stock and final prices.
- Extend the shop's manager page with searchable, paginated products, validated creation, title and price editing, availability controls, and a separate stock-addition command with saved-request recovery. Product edits preserve inventory; deletion and absolute stock replacement remain unavailable, and existing templates require explicit migration.
- `Stroke` supports fill paint fields, including gradients and images, and `copyStroke` deep-copies them. Copies retain stroke image bytes and point pattern paints at copied layers, including after save and reopen. Cross-document paste rejects paint references whose source layers were not copied, instead of binding to unrelated destination layers; same-document copies can retain their original external targets. Legacy strokes that omit `type` continue to use solid paint.
- `.fig` paint bindings use native `colorVar`; legacy `colorVariableBinding` archives remain readable and retain bindings when edited copies use their embedded schema. Explicit unbinding removes both native and legacy aliases. Paint source references follow the embedded schema through backgrounds and nested overrides without rewriting unrelated metadata. Explicit instance PATTERN fills and strokes retain external sources through reopened edits and component synchronization. Embedded-schema extension fields on documents, pages and authored layers survive edited saves.
- One `.fig` document reader serves archive import, page population, worker recovery, clipboard and export. Core compatibility facades delegate to it, while low-level component interpretation lives in `@open-pencil/fig`.
- Design JSX rendering and native source emission move to `@open-pencil/design-jsx`, with Core binding editor services and retaining its legacy JSX/Tailwind export contracts. DOM and HTML export use `@open-pencil/dom-css`.
- Scene Graph owns color conversion and text/layout direction. Core retains compatibility subpaths, and `@open-pencil/dom-css` receives font resolution through injected services instead of depending on Core.

### Fixed

- Keep saved Shader frames when WebGPU initialization or playback fails, and wait for updated static frames before saving or exporting.
- Keep Safari tabs on their own documents after repeated canvas switches by replacing a lost parking context ([#1300](https://github.com/open-pencil/open-pencil/pull/1300)).
- Draw rotated faded and blended layers without clipping while preserving Motion previews ([#1356](https://github.com/open-pencil/open-pencil/pull/1356)).

- Keep reply Revert and Restore disabled while a submission is still saving.

- Save a `.fig` file that was opened and not edited yet. In the app the save never finished, and MCP `save_file` timed out without writing the file.
- Show `.fig` thumbnails in the desktop app's recent files, which the app was not permitted to read.
- Give paints set through the plugin API, `eval`, and AI and MCP scripts an opacity of 1 and make them visible when the script leaves those out, as Figma does. Such paints were stored without them, which the Design panel could not show.
- Show variable-bound colours and numbers correctly when a `.fig` exported from OpenPencil opens in Figma. Figma draws the value a bound field stores until something makes it resolve the variable again, and exports stored the colour from before the binding, so a bound fill appeared in its old colour. Each bound field is now written as it resolves in its layer's mode, or in the collection's default mode when the layer sets none.
- Give strokes the same paints fills have. A `.fig` file's gradient or image stroke imported as opaque black, because a stroke could hold only one color; it now keeps its stops, transform, and image, and renders and saves the way the same paint does as a fill. The stroke panel opens the fill picker, so you can give a stroke a gradient or an image and its weight, align, cap, join, and dashes stay as they were ([#797](https://github.com/open-pencil/open-pencil/issues/797)).
- Open Figma files that use slots with each instance's own slot content instead of its component's default, keep slot properties, their settings, and instance content when saving back to `.fig`, and keep an instance's slot content when you switch its variant.
- Stop showing a “signal is aborted without reason” error when you switch pages again before the previous page has finished loading.
- Export layers with two shadows as one `effects` prop instead of repeating the `shadow` attribute, background blurs as `backgroundBlur` instead of a layer blur, hidden children with `visible={false}` instead of leaving them out, and per-corner radii even when the uniform radius is 0.
- Apply `strokeAlign`, `strokeDash`, `minH`, and `maxH` in design JSX, which were accepted but ignored, and make `minW` and `maxW` set the layer's minimum and maximum width rather than only clamping its initial width.
- Keep the text, visibility, or swapped component an instance sets through a component property when a page it appears on loads on its own, instead of resetting it to the component's default.
- Render the canvas with the Vue SDK's `CanvasRoot` and `CanvasSurface`; CanvasKit never started there and the canvas stayed blank.
- Keep the view centered on what you were looking at when zooming to 100% or another fixed level, instead of jumping elsewhere whenever the zoom changes.
- Draw collaborators' names on their cursors with proper letter spacing and fallback fonts, and end long names with an ellipsis.
- Keep line breaks in multi-line text when exporting OpenPencil JSX, so `get_jsx` output and `openpencil export -f jsx` render back to the same text instead of joining the lines with spaces.
- Announce unavailable commands in the command palette as disabled to screen readers.
- Show an imported Figma page's background, and keep a background you change when you switch pages or save the document.
- Keep fixed-size text from collapsing and clipping beside smaller siblings in a Hug auto-layout container.
- Keep the text and icon an instance was given when a page loads on its own, instead of resynchronising it back to the component's defaults.
- Keep the ordering keys a `.fig` gave its layers when saving one again, instead of renumbering every sibling, and give every layer on a canvas its own key. Shared styles, variables and the canvas's own layers were numbered in separate passes that each restarted, so Figma saw siblings claiming the same position and ordered them arbitrarily.
- Keep a `.fig` variable's description, scopes, code syntax, publishing visibility, and plugin data when saving the file, and a collection's plugin data and default mode. Saving previously wrote every variable as published to all scopes with no description or code names, and made the first mode the default.
- Clear a `.fig` fill or stroke's colour-variable binding when you unbind it, instead of exporting the variable the layer was imported with and rebinding it on reopen. An emptied binding record is no longer written into the file either.
- Keep an AI reply running in the chat panel, with its Stop button, when you switch pages, instead of detaching the panel from the reply in progress.
- Undo an AI edit while another page is on screen; undo previously did nothing until you returned to the page the AI changed.
- Type `parameterConsumptionMap`, `propRefValue`, and `expressionValue` in the Kiwi `NodeChange` codec, which `fig.kiwi` declares but the TypeScript definitions omitted, so reading them no longer needs a cast.
- Read `.fig` text bound to a string variable, in a component and through an instance override, and keep the bound value where Figma does instead of applying a literal override the layer's binding retires. Text bindings also survive export.
- Draw a `.fig` fill or stroke bound to a colour variable at the variable's own transparency, which was previously ignored in favour of the paint's own opacity — so a translucent token drew opaque, and an opacity left over from an override the binding supersedes drew in its place.
- Export the instance overrides you make in OpenPencil to `.fig` beyond text and fill colour — strokes, size, padding and spacing, sizing modes, text styles, visibility, name, opacity, and variable bindings, including the variable bound to an overridden fill — addressed through nested instances so Figma applies each one to the right layer.
- Reject malformed effects assigned to `node.effects` in the plugin API with an error naming the invalid field, as Figma does, instead of storing them. `node.effects` now reads back in Figma's shape: layer blurs are `LAYER_BLUR` with `blurType`, and blurs no longer carry shadow fields (#786).
- Render fragments (`<>…</>`) nested inside other elements in JSX from the AI and MCP `render` tool, which previously failed with `Unknown element: <>`.
- Judge text contrast in the AI and MCP `describe` tool by its WCAG 2 ratio (4.5:1, or 3:1 for large text), the same ratio the `color-contrast` lint rule computes. It no longer reports passing dark text on mid-tone backgrounds as "dark on dark", now reports low-contrast light text, measures translucent and faded text as it is drawn, skips text whose color is bound to a variable, and says the ratio and the threshold it missed (#735).
- Keep the Code tab and the canvas in sync while you edit Design JSX. Canvas edits patch only the values, text, layers, and layer order that changed, under the property names you wrote (such as `width` for `w`), keeping your comments, formatting, and expressions; an expression or loop the canvas has changed is marked instead of overwritten. Code edits update the existing layers instead of recreating them, and each edit is one undo step. Before, canvas changes did not reach edited code until the tab was reopened.
- Warn about options the paint and effect helpers ignore when rendering JSX instead of dropping them silently, and point `blur` in effect helpers at `radius`, the name Figma uses (#736).
- Size groups and boolean operations made through the AI and MCP `group_nodes` and `boolean_*` tools to what they contain, as the editor's commands already do, instead of a default 100 × 100 box or the first operand's box (#738).
- Keep a layer where it is drawn when it moves into or out of a rotated or flipped parent, instead of shifting it and leaving it at its old angle (#737).
- Size auto-width text from `.pen` files to its content in CLI exports, instead of a 10000px placeholder that stretched hugging frames in HTML and Storybook output, and keep narrow widths a `.pen` file sets explicitly instead of widening multi-character text.
- Keep grid layouts, rotation, inner shadows, every shadow of a layer, layer and background blur, flex grow, right-to-left direction, and sections in HTML export, which previously turned grids into columns and dropped the rest.
- Show what to update instead of a blank window when the browser or system WebView is too old, naming the detected macOS, Safari, Chrome, Edge, Firefox, WebKitGTK, or WebView2 version and linking a prefilled bug report, and explain a failed start the same way (#744).
- Start on macOS 13 with WebKit older than Safari 17.4, which previously failed with `Promise.withResolvers is not a function` (#744).
- Evaluate the `**` operator in the AI and MCP `calc` tool, which its own description advertised but which the tool rejected. `calc` now accepts exactly the arithmetic it documents — `+ - * / % **`, parentheses and `min max floor ceil round abs sqrt pow` — and no longer evaluates undocumented expressions such as `random()`, factorials, trigonometry, strings, arrays, or property access.
- Show Chinese, Japanese, Korean, and Arabic characters in a fallback font when the text's own font is unavailable and another font substitutes for it, instead of drawing missing-glyph boxes (#746).
- Explain in the font issues banner when an installed font, such as PingFang on macOS 15 and later, stores outlines in a format OpenPencil cannot draw yet, instead of spending over a second trying to load each of its styles (#746).
- Render the Medium, Semibold, Bold, and other styles of variable fonts at their named weights instead of drawing Regular or a synthetic bold.
- Load the Bold, Medium, and other styles of macOS system fonts packaged as font collections, such as Menlo, Helvetica Neue, and Avenir Next, instead of reporting them as substituted or drawing a different style (#746).
- Load the Medium, Semibold, Bold, and other styles of installed variable fonts such as SF Pro on macOS instead of reporting them as substituted (#752).
- Ship the MIT license text in every published npm package, and add READMEs for `@open-pencil/core`, `@open-pencil/cli`, and `@open-pencil/mcp` on npm.
- Work with pages other than the one on screen through MCP, `eval`, and the CLI against the running app without switching to them: `openpencil export --page` and `--page-id` export that page instead of the selection, `export_image` and `openpencil export --node` export layers from any page instead of failing with "Raster export selection must stay on a single page", and a `.fig` page that has not been shown yet gets its layers, fonts, and layout before a command reads or changes it.
- Fill the open subpaths of filled, unstroked SVG paths as if they were closed, as SVG does, in icons from `insert_icon` and Design JSX `<Icon>`, inline Design JSX `<svg>`, SVG from `import_svg` or dropped and pasted files, and SVG clip paths. Icons that cut holes with open subpaths, such as some Font Awesome icons, no longer render with those holes filled in, and filled `<polyline>` elements render filled instead of not at all.
- Keep round and other stroke caps and joins after saving and reopening the file on icons from `insert_icon` and Design JSX `<Icon>`, and on vectors from inline Design JSX `<svg>`, `import_svg`, and dropped or pasted SVG files. They were set only on the stroke paint, which `.fig` does not store, so outline icons such as Lucide's reopened with butt caps and miter joins and showed gaps where their strokes meet.
- Align authored disabled and read-only control states across Canvas and React/Vue. Prevent disabled Tree branches and TreeSelect panels from remaining interactive, expose reviewed read-only module controls in the inspector, and respect RichText canvas font size and fallback.
- Give each compiler preview its own virtual source root and dependency cache so simultaneous previews cannot reload one another or replace files still used by another instance. Clean up its directory after the server finishes closing; retain it when closing fails.
- Keep incomplete number-state input as an editing draft instead of writing zero or NaN; preserve valid zero, and restore declared state defaults after an accepted compiled FORM reset. Coordinate mixed native inputs and module fields so state, displayed values, FormData and validation errors recover together without changing independently controlled component reset behavior.
- Preserve Vite URL-module handling for imported local images in compiler previews so image-backed components do not prevent the page from loading.
- Exclude root-level generated output from development watching so exported project configurations do not reload the editor; retain normal source and worktree invalidation.
- Discard stale module property drafts after selection or configuration changes, and synchronously release numeric editing focus when a field is replaced so editor shortcuts remain available.
- Show lowcode control and plugin-module icons in the layer tree, matching the toolbar; update module icons on replacement, removal and undo while preserving ordinary container layout icons and the existing `.fig` format.
- Keep Tabs, Accordion, and Table configuration text readable in dark and light themes, including focused table cells.
- Align mapped Tabs content with its canvas panel, exclude inactive layers from painting and pointer selection, preserve editable document data, and shape Chinese tab labels through the existing font fallback.
- Retain lowcode control typography and edited padding, including zero values, through `.fig` save and reopen; verify template field styles against the actual exported archives before publishing the local gallery.
- Preserve existing spacing, padding, alignment and sizing when switching through Freeform and back to auto layout, including settings saved while Freeform is active. Initialize only missing Grid tracks without resetting authored tracks or enlarging the frame, recalculate imported geometry when explicitly changing flow, and restore all affected layer geometry in one undo step, including saved `.fig` results.
- Keep mouse-resize previews and released geometry consistent across parent layouts, convert only the resized Hug/Fill axis to Fixed, and show child sizing modes against the parent's direction. Preserve min/max limits and Shift aspect ratios when jointly feasible; releasing Grid's shared stretch keeps the other axis at its current pixel size rather than future Fill.
- Cancel resize previews on Escape, pointer cancellation, blur, canvas deactivation, or selection/page/document changes, and ignore trailing drag events. Keep affected parent/sibling geometry, imported sizing, and text-on-path metadata consistent through one-step undo/redo and `.fig` export.
- Preserve authored input, textarea, select and date-picker padding in generated web projects, including responsive and logical spacing.
- Keep the bundled plugin catalog loadable when Modal exposes its optional content-layer field, while retaining older saved Modal configurations without that field.
- Include used shadcn component utilities in generated styles so preview icons keep their intended size and do not block neighboring controls.
- Keep conditional list templates valid in generated React expressions, including nested Backend lists.
- Connect embedded ACP agents to the current editor even when a global `open-pencil` MCP server is configured, and retain the correct connection when resuming sessions.
- Keep local ACP editor connections working behind system HTTP proxies while preserving existing proxy exceptions and external proxy settings.
- Allow managed NestJS preview to prepare and connect applications created from the Backend library while preserving their original application IDs and saved preview sessions.
- Keep generated React theme previews usable when sandbox or privacy settings deny browser storage, and retain theme changes for the current session.
- Preserve the displayed numeric value when detaching a variable in the editor, with one-step undo and redo; unresolved bindings keep the original property value.
- Match asset handover actions to the selected request's kind and status while retaining unsent form input and saved-request review after refresh or navigation.
- Stop generated backend lists from reusing account-specific filters when the signed-in account changes.
- Keep CRM Vue exports type-safe when selected records populate forms, and reject invalid Backend filter values before sending requests.
- Mount the editor before awaiting cloud-document presentation, and preserve the previous tab when opening is cancelled or fails without interrupting later tab selections.
- Protect cloud documents from deletion while their editor tabs are still downloading, including after navigation back to the file list.
- Preserve instance override maps across binary Yjs synchronization, including descendant and explicitly cleared overrides.
- Update MapLibre GL JS to 6.4.1 in the editor, CLI, and generated projects to address its attribution sanitizer vulnerability.
- Carry the Desktop-reviewed Backend Provider request into CLI compilation and recheck it before static upload; reject unresolved document declarations instead of silently compiling legacy Supabase configuration.
- Remove temporary CLI deploy files after controlled compilation, public runtime override validation, or provider upload failures.
- Block CLI static deployment when the effective runtime configuration fails preflight, while honoring valid public build overrides.
- Cancel unread Supabase backfill responses with malformed headers, unexpected HTTP status, or rejected redirects while preserving prompt error reporting.
- Enforce generated Supabase Edge workflow HTTP deadlines while reading response bodies, and release oversized streams without delaying the sanitized failure response.
- Keep Supabase database Apply response cancellation and size failures responsive, redact stream diagnostics, and preserve unknown outcomes after dispatch without retrying.
- Cancel Supabase catalog response reads promptly, clean up oversized responses without waiting indefinitely, and keep response-stream errors free of private diagnostics.
- Preserve unknown Supabase staging outcomes across review changes, document switches, and property-panel remounts, keeping Apply blocked for unresolved outcomes.
- Return Supabase locked backfill capture failures promptly when stream cleanup stalls, while keeping each dispatched capture single-use.
- Return Supabase backfill read timeouts, cancellation, and response-size failures promptly even when response-stream cleanup does not finish.
- Reject unsupported enum renames and migration plans that exceed the Backend contract's aggregate limits before returning a plan.
- Preserve document Backend Provider declarations across preview Host and Browser Worker compilation, and invalidate stale previews when the provider or declaration changes.
- Report unsupported Supabase browser networking without mistaking generated client key-validation code for embedded secrets.
- Preserve sub-millisecond evidence ordering when validating Backend production gates and release receipts.
- Load reviewed, version-pinned Fontsource faces in the browser editor and preview, with bounded
  caching, retry, fallback, and diagnostics.
- Let image-heavy browser previews use their separately reviewed asset budget without weakening the
  ordinary document-content limit or the 32 MiB sandbox hard limit.

### Performance

- Build cached canvas images in bounded steps while keeping newly drawn and moved shapes visible.
- Open multi-page `.fig` documents faster: the archive is indexed once rather than once for every page, each page resolves only the layers it adds instead of rescanning the whole document, placing an instance no longer re-synchronises every other instance of its component, and archive records are copied directly rather than through `structuredClone`. A 33-page file loads about a fifth quicker, and a page of repeated components opens three to four times faster once a document is already open.

### Security

- Update Storybook and its official Vue integration and addons to 10.6.2 to reject untrusted development-preview origins (GHSA-f2ph-cmg5-wxc8).
- Update the desktop app to Tauri 2.12, which binds large IPC channel responses to the webview that requested them instead of letting another webview fetch them (GHSA-w28w-mhc8-qvjv).
- Install a desktop update only when its signature names the version the update server announces, so a tampered update manifest cannot pair a newer version number with an older signed build.
- Update `@xmldom/xmldom` to 0.9.12, which fixes quadratic-time and quadratic-memory parsing of crafted SVG and XML and reports malformed end tags instead of accepting them.
- Validate cursors, selections, and names that collaborators send before drawing them, and cap their size, so a broken or hostile peer cannot crash or flood the canvas.
- Evaluate `calc` expressions through `jsep` and an arithmetic allowlist that never compiles input into JavaScript, replacing the `expr-eval` dependency and its unpatched critical code-execution advisory (GHSA-q9v2-7m5w-4693).
- Escape layer names and other text properties in JSX and Tailwind JSX export, so text from a document can no longer add attributes or JavaScript expressions that the AI and MCP `render` and `replace` tools would execute, and names containing `&` no longer change when the JSX is rendered back.

## 0.16.0 — 2026-10-14

OpenPencil 0.16 adds comments, shared rooms with voice calls and agents you can follow, slots, component properties, and components that behave like real controls in Preview, plus shader fills, a Lint tab, variable modes on layers, a pencil tool, and Vue and React code in the Code tab. `.fig` files open and save much closer to Figma, saving only what an edit changed, and selection, pasting, auto layout, text, and trackpad navigation follow Figma. The desktop app needs macOS 13 or later, and `openpencil-mcp` must be updated together with the app.

### Breaking changes

- The desktop app requires macOS 13 or later; the web app supports Chrome 111, Edge 111, Firefox 128, and Safari 16.4 or later.
- Shared rooms record the layer tree in a new format, so people on this version and on earlier versions can no longer join each other's rooms. A room this browser saved with an earlier version converts when you open it again.
- Update `openpencil-mcp` together with the app: the app renders `render` JSX itself and no longer accepts the pre-rendered tree earlier versions send. AI and MCP tools reject arguments they do not declare: `defineTool` from `@open-pencil/core/tools` takes a `v.strictObject` input. `close_file` fails on unsaved changes unless `unsaved` is `"save"` or `"discard"`, and `diff_create` and `diff_show` patches list JSX attributes such as `-rounded={8}`, with `diff_show` taking `attributes` instead of a JSON `props` object, so patches in the old format no longer apply. `openpencil documents` is now a command group: list open documents with `openpencil documents list`.
- `design_to_tokens` writes CSS custom properties named from each variable's code syntax or Tailwind namespace: its `tailwind` format is a Tailwind v4 `@theme`, the `json` format is removed, aliases stay `var()` references, and non-default modes go under their condition (`[data-theme="dark"]` by default).
- A paint's `gradientTransform` follows Figma's convention everywhere, so gradients made in OpenPencil before this release draw differently. Build gradients with `linearGradientTransform` and `ellipticalGradientTransform` from the new `@open-pencil/scene-graph/gradient`, where `isGradientFill` and `GradientFillType` moved from `@open-pencil/core/geometry`; `linearGradientEndpoints` is removed.
- `.fig` files store colour-variable bindings in Figma's `colorVar`. A paint bound through the old `colorVariableBinding` field, which only OpenPencil wrote, reopens unbound. `VariableBinding`, `colorVariableBinding`, `encodeNodeChangeWithVariables`, `encodePaintWithVariableBinding`, and `encodeVarint` are removed from `@open-pencil/core` and `@open-pencil/core/kiwi`.
- `computeImageHash` from `@open-pencil/core` and `@open-pencil/scene-graph` returns the hex SHA-1 of the bytes, the name Figma gives an image, instead of an OpenPencil-only hash of the same length. New images are stored under that name, so `.fig` files and the Figma clipboard carry it as it is; images in documents saved before keep their names.
- In scripts, a text node's `fontSize`, `fontName`, `fontWeight`, `fills`, `letterSpacing`, `lineHeight`, `textDecoration`, `textCase`, `textStyleId`, and `fillStyleId` read `figma.mixed` while its characters differ, as in Figma, and setting one restyles every character. `fills` is typed `readonly Fill[] | symbol`, so scripts that index it narrow it first.
- Design JSX moved from `@open-pencil/core` to the new `@open-pencil/design-jsx` package. Import elements, helpers, variables, `JSX_REFERENCE`, `buildComponent`, `sceneNodeToJSX`, and `selectionToJSX` from there; `@open-pencil/core` and `@open-pencil/core/design-jsx` keep only `renderJSX` and `renderTree`, `renderTreeNode` is removed in favor of `renderTree`, and the `@open-pencil/core/io/formats/jsx` subpath is gone.
- JSX export writes only OpenPencil JSX: `JSXFormat` and `JSXExportOptions` are removed, and Tailwind JSX comes from `sceneNodesToTailwindJSX(graph, nodeIds)` in `@open-pencil/dom-css` or `@open-pencil/dom-css/export`. `@open-pencil/dom-css` no longer requires `@open-pencil/core`, and `exportHTMLBundle` takes a font resolver in `fonts` instead of `'assets'`; build one on `exportWebFontFaceAssets` from `@open-pencil/core/text/web-font/assets` to keep font files in standalone exports.
- Shared primitives moved to `@open-pencil/scene-graph`: color conversion and management to `/color`, text and layout direction to `/text-direction`, `randomHex`, `randomInt`, and `randomIndex` to `/random`, `fractionalPosition` to `/order-keys`, and `@open-pencil/scene-graph/layout-guides` is now `/layout`. `@open-pencil/core/bytes` is removed in favor of `js-base64`; the `@open-pencil/core` root exports are unchanged.
- `SceneNode` has new required keys `textParagraphs`, `listSpacing`, `paragraphSpacing`, `paragraphIndent`, `hangingList`, `targetAspectRatio`, `isExposedInstance`, `strokeWeight`, `strokeAlign`, and `booleanOperation` (which may be `undefined`), so code that builds `SceneNode` objects itself must include them. `Stroke` extends `Fill`, so every stroke states a paint `type`, usually `'SOLID'`.
- `SceneNode.primaryAxisSizing` and `counterAxisSizing` are `AxisSizingMode` (`'FIXED' | 'HUG'`): fill is stored on the child, as `layoutGrow` and `layoutAlignSelf: 'STRETCH'`, as Figma stores it. Read and change per-axis sizing with `layoutSizing`, `layoutSizingOptions`, and `layoutSizingUpdates` from `@open-pencil/scene-graph`.
- `.fig` reading moved to one reader. `importNodeChanges` and `importClipboardNodes` are replaced by `parseFigFile` and `parseFigmaClipboard`, `populateLazyFigImportRoots` and `populateAllLazyFigImportRoots` by `populateFigPage` and `populateAllFigPages` from `@open-pencil/core/io/formats/fig`, and `populateAndApplyOverrides` by `interpretInstance` with `materializeInstance`; `assertFigPackageReady()` is gone and `FIG_PACKAGE_STATUS` reads `document-reader`. `.fig` export takes text shaping from a runtime: `buildDerivedTextDataV4` is removed, `sceneNodeToKiwi` needs the `runtime` that `withFigExportRuntime(graph, canvasKit, write)` passes to its callback, and `FigNodeChangeExportRuntime` takes `shapeText(node)` instead of `getGlyphOutlineMetrics`.
- OpenPencil's plugin-data keys are defined once in `OPEN_PENCIL_PLUGIN_DATA` from `@open-pencil/scene-graph` and read or replaced with `readPluginData` and `withPluginData`. `@open-pencil/fig/node-change` drops `OPEN_PENCIL_PLUGIN_ID` (now in `@open-pencil/scene-graph`), the `*_PLUGIN_KEY` constants, `upsertPluginData`, `removePluginData`, and `getOpenPencilPluginValue` in favor of `readNodeChangePluginData`; `SourceLibraryPublication` moved to `@open-pencil/scene-graph` and `SOURCE_LIBRARY_PUBLICATION_PLUGIN_KEY` is gone.
- Every process mints layer, variable, and collection IDs in a random session, so `generateId()` no longer starts at `0:1` in the CLI, MCP, or scripts. Code that needs fixed IDs calls `setIdSession`, which now returns the previous session, or passes the `SceneGraph` its own generator (#770).
- Editor state gains required `canvasVersion`, which the canvas redraws on (call `requestRender()` instead of bumping `sceneVersion`), `shapeHandleHover`, and `selectionTheme`, which replaces `RulerTheme.label`. `remoteCursors` is now `presenceCursors` (`PresenceCursor[]`, each with a `kind` of `'person'` or `'agent'`), and the `Tool` type, `EDITOR_TOOLS`, and `TOOL_SHORTCUTS` include `'COMMENT'` on <kbd>C</kbd>.
- Canvas and constants APIs changed: `SceneGraph.hitTestFrame` is now `hitTestDropTarget`, `adoptNodesIntoSection` is now `adoptCoveredLayers`, and `SkiaRenderer.hitTestFrameTitle` no longer takes selected IDs. `SkiaRenderer.buildParagraph` returns a `TextLayout` that draws with `draw(canvas, x, y)`. `AUTO_LAYOUT_BREAK_THRESHOLD`, `CORNER_ROTATE_ZONE`, `getDefaultCanvasBgColor`, and `CANVAS_BG_COLOR_DARK` are removed: the selection's resize and rotation zones are `TRANSFORM_ZONE` and `transformZoneAt` in `@open-pencil/core/geometry`, which also owns the `HandlePosition` and `CornerPosition` types, `SECTION_DEFAULT_FILL` is replaced by `SECTION_DEFAULT_FILLS`, and new pages use `PAGE_DEFAULT_BACKGROUNDS`, both keyed by interface theme. Icons come from an `IconProvider`: `fetchIcon`, `fetchIcons`, `searchIcons`, `searchIconsBatch`, and `clearIconCache` are replaced by the default `iconify` provider, `createIconifyProvider()`, and `placeIcon`, and `VectorizedPath` from `@open-pencil/core/vector` replaces `clipNetworks` with `clips`.
- `@open-pencil/vue` composables act on the whole selection: `useStrokeControls` and `useEffectsControls` no longer take a node, `useTypography` edits every selected text layer and its `weights` (also the `TypographyControlsRoot` slot prop) is a computed list of the families' weights, read with `.value`, and `usePosition` reports `x`, `y`, and `rotation` as Figma's panel does. `useCanvasInput` returns `autoLayoutValueEdit` with `updateAutoLayoutValueEdit`, `commitAutoLayoutValueEdit`, and `cancelAutoLayoutValueEdit` in place of the padding-only `autoLayoutPaddingEdit` and its functions; the edit names its `field` (a padding or `itemSpacing`), and `autoLayoutValueAnchor` places its editor. `useVariables().collections` returns copies and `addVariable` returns the new ID; `useVariablesEditor`, `useVariablesTable`, `useVariablesDialogState`, and the `@tanstack/vue-table` dependency are removed. `useFlatReorderDrag` takes `operations` and `onCombine`, and the `updates` messages replace the system update dialog strings with the Software Update window's.

### Added

- Comment on designs, as in Figma: the **Comment** tool (<kbd>C</kbd>) pins threads to layers, with replies, resolving, rich text, and a searchable, filterable list in the sidebar. Comments are saved in the `.fig` file, so they travel through storage and shared rooms, and scripts, the AI chat, and MCP clients read, add, reply to, and resolve them.
- Be in several shared rooms at once, each in its own tab and syncing in the background, and talk with the people in a room in a peer-to-peer voice call from the headphones beside the avatars. Join from Home with **Join room…** or a pasted link, open a browser room in the desktop app with **Open in desktop app**, and join right away under a generated name such as *Teal Fox*. Everyone in a room sees and edits the document's variables and the overrides of its instances.
- Follow collaborators and AI agents: avatars count each person's agents and show what they are doing, clicking follows them, and your own agents are followed while they work. Agents from the AI chat, ACP and Pi harness chats, and MCP clients show labeled cursors at the layers they touch and leave the canvas when their reply ends, and the Pages panel and command palette show who is on each page. The command palette also lists recent pages and **Go to page…**.
- Create and fill slots, as in Figma, from the canvas, the properties panel, scripts, and AI and MCP tools: slots have names, limits, and preferred components, instances show each slot as Default or Modified, and **Reset slot** brings back the component's content.
- Create and edit component properties and variants from the properties panel, as in Figma (#847): link text, visibility, and swapped components to text, boolean, and instance swap properties, expose nested instances, reorder properties, and turn a component into a set with **Add variant**.
- Make components behave like real controls: the Behaviour section turns a component or set into a Button, Switch, Checkbox, Slider, Tabs, Text field, or another of 15 Reka UI-style controls, and **View → Preview** (<kbd>⌥</kbd><kbd>⌘</kbd><kbd>↩</kbd>) lets you use them live without changing the document, drawn as the canvas draws them, in its variable modes. Scripts, AI and MCP tools, and design JSX build them too.
- Fill layers with shaders from the open-source [`shaders`](https://shaders.com) library: the fill picker's Shader tab stacks effects with generated controls and takes presets copied from shaders.com. The canvas shows the first frame and preview plays it where WebGPU is available; `.fig` files and the Figma clipboard keep the frame as an image and the shader's preset, so Figma still opens them.
- Apply a variable mode to layers and pages from Appearance, or the Page section with nothing selected, as in Figma: choose Auto or a mode for each collection the layers use. Layers set to a mode show it after their name in Layers.
- Draw freehand with the pencil tool (<kbd>⇧</kbd><kbd>P</kbd>): strokes become smoothed, editable vector paths, with <kbd>Shift</kbd> for straight lines, as Figma's pencil does.
- Bulleted and numbered lists in text, as in Figma, with nesting, list and paragraph spacing, indents, and hanging markers, set from the Typography section or with <kbd>⇧</kbd><kbd>⌘</kbd><kbd>8</kbd> and <kbd>⇧</kbd><kbd>⌘</kbd><kbd>7</kbd>. Lists round-trip through `.fig` files, the Figma clipboard, HTML, design JSX, and scripts.
- Style selected characters while editing text, as in Figma: the Fill and Typography fields show and change the selection, and any range of characters keeps its own case, link, text and fill styles, and variable bindings. The canvas draws each range in its own case, `.fig` files and the Figma clipboard keep them, apart from font weight bindings, and HTML, Tailwind, Vue, and React exports keep character styles, links as `<a href>`, cases as `text-transform`, and lists; HTML import reads them back. Scripts style ranges with `getStyledTextSegments` and the `getRange`/`setRange` methods, including `getRangeTextCase`, `getRangeHyperlink`, `getRangeTextStyleId`, `getRangeFillStyleId`, and `getRangeBoundVariable` with their setters, and the text's `hyperlink`. Design JSX writes `<Span>` and `<Paragraph>` with decoration style, colour, thickness, offset, skip ink, `textCase`, and `href`.
- Edit shapes on the canvas, as in Figma: gradient end points and stops while a gradient's picker is open, corner radius handles on rectangles, polygons, and stars, a polygon's or star's point count and inner ratio, also in the properties panel, and auto layout padding and gaps, which open for editing on a double-click.
- Switch a frame, group, or section to another of them from the layer type menu in the properties panel header, as in Figma. A frame becomes a group that keeps its layers, effects, and opacity and fits them; a group becomes a frame of its bounds that clips. A frame or group on the page or in a section becomes a section that keeps its fill, strokes, corners, and layers where they are, and a section becomes a frame.
- Lock a layer's aspect ratio beside its width and height, as in Figma; the lock survives `.fig` files and the clipboard and is available in the plugin API.
- Show the pixel grid when zoomed in, toggled with **View → Pixel Grid** or <kbd>⇧</kbd><kbd>'</kbd>, and snap moves, resizes, and drawing to whole pixels with **Snap to Pixel Grid** (<kbd>⇧</kbd><kbd>⌘</kbd><kbd>'</kbd>).
- Figma's navigation keys move through layers and the document: Enter selects children, or opens a selected vector's path for editing, Shift+Enter or \ selects the parent, Tab and Shift+Tab select siblings, N and Shift+N zoom to the next or previous frame, Page Down and Page Up switch pages, and Shift+0 zooms to 100%.
- Rearrange auto layout as in Figma: drag several layers along a row or column as one block, move a layer one slot with the arrow keys, take it out with **Ignore auto layout**, and see the layout's children outlined on hover.
- Edit several layers at once: a multi-selection gets Layout, Typography, corner radius, and stroke sections, plus **Selection colors**, which recolours a colour everywhere it is used. The layout guides of several frames list and edit together while they match, and Add gives each frame one new guide.
- Check designs in the new Lint tab: issues are grouped by rule, marked on the canvas and in the Layers panel, and many have one-click fixes such as binding colours to matching variables. `openpencil lint --fix` and the `lint` and `lint_fix` tools apply the same fixes outside the app.
- Edit variables in a redesigned variables dialog: collections and groups in a sidebar, search across names and values, inline editing, drag to reorder, multi-select, CSS names and expressions, per-mode conditions written in plain words, and a live stylesheet preview. Collections copied from a library are marked, with a warning on variables Figma won't show.
- Import and export variables, text styles, and effect styles as W3C design tokens, in the shape Figma imports, from the variables dialog, by dropping `.tokens`, `.tokens.json`, or `.resolver.json` files on the editor, with `openpencil tokens --format dtcg`, and with the `import_design_tokens` tool. Copy variables as CSS or a Tailwind v4 theme, or print them with `openpencil tokens`.
- Insert icons from Iconify's open-source sets with an icon picker in the toolbar, Object menu, and command palette. Placed icons keep their name, so the Icon section can swap or recolour them, and exports write them as icons.
- See the selection as a Vue or React component in the Code tab, styled with CSS or Tailwind, and see which layer the cursor's element draws, with design issues underlined in the code.
- Export components to Storybook with `openpencil export -f storybook`: one story file per component for React, Vue, or HTML, with variant controls, and with `--framework vue` or `--framework react`, working Reka UI or Radix UI components (#727). Export HTML and Tailwind JSX from the app and the CLI (`-f tailwind-jsx`), with vector shapes as inline SVG, and choose PPTX in the Export panel.
- Open a `.fig`, `.pen`, or other supported document by dragging it onto the window, paste SVG markup copied as text, such as Figma's Copy as SVG, and open HTML files in CLI commands such as `openpencil tree` and `openpencil convert`.
- Save the open document to cloud storage with **File → Save to storage…**; the tab stays bound to the stored copy, so Save and auto-save write to the bucket. A new Cloud Storage guide covers setup, and Settings → Cloud storage offers the OpenPencil Cloud waitlist.
- Set up AI in a few steps with guided setup: on first launch, pick a coding agent on this computer, an API account, or a local server. The desktop app installs or updates agents, adapters, the MCP server, and the Harness companion with one click, through Bun when Bun installed them, tests each connection, and proposes models; where npm's global folder needs administrator rights, setup says so and offers the `sudo` command, Bun, or a prompt for your agent. The MCP server and Harness companion print their version with `--version`; sign in to OpenRouter instead of pasting a key.
- Choose how much an AI model thinks for each message, from Off to Extra high, attach images by dropping them on the chat, and watch designs appear on the canvas while direct providers stream JSX.
- Review and undo AI edits from the chat: each tool call shows a summary, its input and output, and a before-and-after image with a JSX diff. Revert a reply's edits, restore them, regenerate the last reply, retry a failed message, or edit and resend it; undoing an edit tells the AI on the next message. The conversation menu saves a chat's trace as a JSON file, with every message, reasoning step, tool call, and request.
- Control the running app from the CLI and MCP: `openpencil documents`, `undo`, `redo`, and `settings`, the matching MCP tools, `openpencil tool list`, `describe`, and `call` to run any MCP tool from the shell, and `openpencil diff` with the `diff_visual` and `diff_apply` tools to compare and replay changes. Share only the selected layers with MCP clients from **Settings → MCP → Local server** or `OPENPENCIL_MCP_SCOPE=selection`.
- Diagnose failures from **Settings → Diagnostics**: errors, failed AI chats, and broken tool calls are recorded with scrubbed messages and stacks, filterable, copyable with the app version, and saved as a JSON file.
- Choose an accent color in **Settings → General → Appearance**, and customize the toolbar in **Settings → Toolbar** or from its right-click menu: hide, reorder, and regroup tools on desktop and mobile.
- Official builds send one anonymous ping a day, with the app version, operating system, architecture, desktop or web, and whether usage stats are shared, and no ID; turn it off in Settings → Privacy or with `OPENPENCIL_TELEMETRY=0` or `DO_NOT_TRACK=1` in the desktop app's environment. Usage stats (launches, file formats opened and exported, and which AI provider answered) are sent only after you agree in a one-time prompt after the welcome screen. The [privacy page](https://openpencil.dev/overview/privacy) lists every field.
- Use more of the Figma plugin API: `instance.swapComponent()`, `detachInstance()`, `figma.getNodeByIdAsync()`, `getMainComponentAsync()`, and an instance's `overrides` with `resetOverrides()`. OpenPencil's own `openpencil` script global adds comments and controls.
- Write design JSX with more of the document: `visible`, `locked`, `constraints`, `italic`, full stroke props, and component properties set by name on `<Instance>` (#750). JSX export writes them back with every fill, effect, mask, and variable binding, and TSX can use `@open-pencil/design-jsx` as its JSX import source.
- New SDK entry points: pass an ID generator to `new SceneGraph()`, place pasted content with `resolvePasteTarget` from `@open-pencil/core/editor`, compute Flatten and Outline stroke with `flattenNodesToVectorProps` and `outlineStrokeNodesToVectorProps` from `@open-pencil/core/canvas`, import `designDocumentToSceneGraph` from `@open-pencil/dom-css/scene-graph` in browser builds, and tell `FontManager.setBundledFontLocator()` where a bundler put the fonts from the new `@open-pencil/core/assets` export.
- New npm packages: `@open-pencil/design-jsx` for writing and exporting design JSX, and `@open-pencil/emit`, which it and the exporters use to print source code.
- openpencil.dev opens on live editor demos of design, AI, code export, the CLI, the SDK, and collaboration, in every docs language, with a short roadmap, and a download page offers the installer for the visitor's system and lists every installer with Homebrew and the web app.

### Changed

- Selecting, dragging, drawing, duplicating, and pasting follow Figma: clicks select a top-level frame's direct children and double-clicks go deeper, a click up to 3.5 screen pixels outside a shape selects it, a click on a section's empty area selects the section, dragged layers land in the frame under the cursor, groups and locked frames never take a drop, and Space, Shift, and Control change how a drag reparents. A layer leaves auto layout once its edge is about 5 px past the frame instead of after the cursor travels 96 px, and a duplicate is stacked directly above its original.
- A selected layer resizes and rotates where Figma's does: every edge resizes along its whole length within 7.5 px outside it and up to a tenth of the side inside it, corners within 7.5 px, and the area outside a corner within 16 px rotates; a frame's name takes a press before rotation but not before resizing. A selection draws Figma's four corner handles, without the edge midpoints, and layers under 10 px on both sides show no handles or size label.
- Pasted layers keep how they were turned and flipped on the canvas, as in Figma, and land where Figma puts them: layers copied out of a frame or section keep their offset from its box, move into the frame only when they start past its far edge or miss it, and paste back where they were when nothing is selected, or in the middle of the view when that place is out of view.
- Trackpads and mouse wheels pan and zoom the canvas as in Figma: a two-finger pan moves the canvas twice as far, up to 120 px per scroll event, a pinch zooms as far in the desktop app and Safari as in other browsers, also over Preview's controls and comment pins, and on Windows each mouse wheel notch pans 16 px, speeding up to 120 px when notches come less than 50 ms apart.
- Layers move and turn as in Figma, on the canvas and in scripts: the properties panel shows X and Y of a turned layer's box and a counterclockwise rotation, children of groups report positions in their container, and groups and booleans refit to their contents.
- New layers, pages, and sections look as in Figma: white frames that clip, #D9D9D9 shapes, black 1 px lines, theme-aware page backgrounds and sections, numbered names such as "Rectangle 2", and Figma's results for Group, Frame selection, Create component, booleans, and Combine as variants.
- Tool shortcuts and cursors follow Figma: Section moves to Shift+S and Frame also answers to A, and the pen, comment, and hand tools show their own cursors, with the hand closing while panning.
- The font weight list offers only the weights the text's family has, as in Figma. Switching family keeps the weight and italic where the new family has them, otherwise the nearest weight with the same slant.
- The Layout guide section follows Figma: each guide is a row with a summary such as "5 columns" or "Grid 10px" that switches between grid, columns, and rows, and its settings open from the row's icon with Count, Type, Width or Height, Margin or Offset, Gutter, and Color fields. The section now sits after Selection colors.
- A layer keeps its stroke weight and alignment without strokes, as in Figma, and strokes take the same paints fills have, including gradients and images (#797).
- Layers inside components and instances are outlined in purple, and bound variables show as a neutral chip instead of purple text.
- Import SVG as editable layers, as pasting into Figma does: groups, one vector per shape, text layers, and clip path groups instead of one merged vector (#734).
- The plugin API follows Figma inside instances: it refuses to move, rotate, constrain, or mask a layer an instance takes from its component, or to change a vector's path there, with Figma's errors, while slot content stays editable, and setting a layer to the value it already has makes no override. `setProperties` switches an instance's variant, alongside its other properties, and fails without changing anything when no variant has the values; `resize` places a frame's layers by their constraints while `resizeWithoutConstraints` leaves them; a new frame or component hugs along its main axis once auto layout is on, and `resize` fixes a hugging auto layout frame's size.
- Popovers, menus, selects, and pickers share one look and motion, selects open over their field, every section adds and removes items with + and −, and variables, styles, and swap components come from one searchable list. Menus taller than the window scroll.
- **Settings…** (<kbd>⌘</kbd><kbd>,</kbd>) is in the **OpenPencil** menu on macOS and at the end of the **File** menu elsewhere, instead of under **View → Preferences**.
- The demo at `/demo` is a tour of one player card in eight chapters stacked on one canvas, each showing one thing with a numbered card that says what to try and draws the piece of the app to click: preview, the artwork slot, the controls' behaviours, the theme's modes, shader fills, the Code tab, Lint on a card with planted issues, and sharing and opening your own files. It opens instantly, built ahead of time, on the first chapter, and follows the app's light or dark theme. The welcome dialog on first launch offers it next to AI setup, and **File → Open the Tour** opens it any time.
- The desktop app shows updates in a Software Update window with formatted release notes and cancellable download progress (#743). On macOS and Linux you choose when to restart, and restarting asks about unsaved documents first.
- Design lint reports far fewer false positives, checks touch targets against WCAG 2.2 AA in the Recommended preset, asks 3:1 contrast of large text as WCAG AA does, and reports unbound colours and off-scale spacing as suggestions.
- HTML and Tailwind export write variable-bound values as their tokens, such as `var(--color-primary)` or `bg-primary`, and Tailwind JSX uses the same class mapping as Tailwind HTML.
- The AI chat starts with comment, variable, lint, page, and image export tools on, keeps working on the page where it started, and recommends the latest models, with Claude Sonnet 5.5 and GPT-6.1 Sol as the new defaults. Saved profiles keep their model.
- Settings → MCP shows the local server in the desktop app and WebMCP in the browser, where each works, and Tool access lists the local server's tools while it is stopped.
- Invalid tool arguments from the AI chat, CLI, or WebMCP name the tool and list every problem with its location.
- Run Pi with the providers and default model you signed in to in the Pi CLI, and see what to fix when its Harness companion or MCP server is missing or out of date. Codex install instructions point at `@agentclientprotocol/codex-acp`, which replaces `@zed-industries/codex-acp`.
- `get_selection` returns the selected layers with their direct children by default and takes a `depth`, and `openpencil eval` prints the value of a script's last expression.
- Opening a share link opens the room in its own tab, so an open document is never changed, and leaving a room keeps its file as a local copy.
- Text in both themes meets the WCAG AA contrast ratio of 4.5:1.
- The Linux AppImage no longer bundles `xdg-open` and relies on the system's `xdg-utils`.

### Fixed

- Instances follow their component as in Figma: style overrides from `.fig` files survive component edits, every field an instance does not override follows the component, restructured component layers move their instance copies with overrides, and properties set on nested instances show and stay set when pages load on their own (#849). Resizing an instance no longer turns its layers' sizes into overrides, copies that size themselves to their content keep their size through component edits and reopen at their saved size, and a path edited in a component reaches its instances, scaled with each copy.
- Save `.fig` files that open correctly in Figma: overrides beyond text and fill colour, exposed nested instances, slot content, blend modes, bound variable values, variable metadata, fill-sizing, ordering keys, and stable layer IDs (#890). An opened `.fig` stays unchanged until edited, saves before its first edit, and saves variable-only edits.
- Saving an opened `.fig` file writes only what an edit changed in a layer or variable and keeps the rest as Figma saved it, including data OpenPencil does not model, an instance's library link and saved overrides, and text's letter spacing in percent and font names. A variable's new value reaches every layer that uses it, through an alias too, variables that alias library variables still point at the library, and a collection's modes keep their order in Figma.
- Shared and library styles survive `.fig` files: the properties panel shows the styles layers use in opened files, styles made in OpenPencil save as styles and reopen, layers that use a library style keep it in Figma, and a style an instance has cleared stays cleared.
- Figma shows images in `.fig` files OpenPencil writes, stored under the SHA-1 of their bytes, the only name Figma reads. Instances pasted into Figma keep their names and no longer carry their component's library identity, and fill and stroke bindings to variables made in OpenPencil survive the paste as remote variables.
- Importing design tokens adds them to the file's own collections, never to a collection copied from a library, where Figma did not show them.
- `.fig` files whose text content is bound to a number or boolean variable open instead of failing with "Unsupported variable expression STRINGIFY", and saving keeps the binding (#1110). Rounded points in imported vectors keep their own corner radius and join, layout guides save, show as columns or rows, and draw an Auto count as Figma does, and a file's thumbnail shows its page's own background.
- Showing or hiding a layer of an instance that a boolean component property drives sets the property, as in Figma, so every layer it drives follows.
- Text saved to `.fig` or copied to Figma keeps its wrapping, alignment, line height, ligatures, and decorations there (#914), and shows there when drawn in a fallback, missing, or variable font, truncated, or with an empty line. Auto line height stays auto when `.fig` files are opened and saved, and a pixel line height shorter than the font opens as set.
- Lines of text that mix font sizes or line heights are spaced as in Figma: each line is as tall as the tallest line height on it, with its largest font centred in it, instead of stacking the tallest parts of every style on it.
- Auto layout behaves as in Figma: Fill children in Hug frames keep their size, frames from `.fig` files reflow when edited, absolute children follow constraints, Hug frames grow while typing, a row that hugs its height around a stretched layer keeps it in Figma, and undo puts back everything an auto layout change moved.
- Draw like Figma: gradients from Figma files and pastes no longer run backwards, blurs and shadows use Figma's falloff, masks apply their opacity and blur, layers masked by a group show, polygons and stars keep their rounded corners, point count, and inner ratio, also when copied to Figma, and the corners of a stroked path take its join, with caps only at its ends.
- Underlines and strikethroughs follow the font's metrics and Figma's styles, outlined or flattened text keeps its glyph positions, text on a path turns each character along the stretch it covers, and fonts load reliably: styles of variable fonts and macOS font collections, CJK and Arabic fallbacks, and a clear notice for unsupported outlines such as PingFang (#746, #752).
- Undo covers more: hiding, locking, renaming, and moving layers to another page, and layers MCP clients, the CLI, and AI chat create, delete, or move, including on other pages and in variables. Hiding or locking several layers is one step, undo and redo work while a colour picker is open, and undoing back to the last save shows the document as saved.
- The pen tool redoes a path with its points, fill, and stroke, Escape keeps the path drawn so far, and the distance for closing a path no longer changes with zoom. Path editing closes when its vector is deleted or another document opens, and editing a vector's points no longer leaks memory.
- Dragging a layer down the layers panel drops it where the line shows, and moving a layer into a frame or group from the panel keeps it where it's drawn on the canvas.
- Opening a page also loads the pages holding the component sets its instances use, so the variant picker can switch to any variant of a set kept on a page not opened yet.
- Import HTML and CSS laid out as a browser lays it out, with correct shadows, borders, and `box-sizing`, in `openpencil import`, the app, and the Code tab's preview (#788).
- Import SVG files with an XML declaration or a byte-order mark, `fill-opacity`, `stroke-opacity`, open filled subpaths, and stroke caps and joins that survive saving. SVG export, and the drawings built on it, draw a vector's open strokes beside its filled regions.
- Design JSX lays out `justifyContent`, `alignItems`, grid `repeat()` tracks, fill sizes in grids, and `box-shadow` lists as written, applies props it used to ignore, reports bad gradient arguments, warns about ignored paint and effect options (#736), and keeps line breaks when exporting multi-line text.
- HTML export keeps grid layouts, rotation, every shadow and blur, flex grow, right-to-left direction, sections, and the positions of layers outside auto layout, declares `box-sizing: border-box`, and names a JPEG, GIF, or WebP image fill by its own type.
- The plugin API reads and writes `lineHeight`, `letterSpacing`, effects, paints, page backgrounds, `layoutGrids`, and `componentPropertyReferences` in Figma's shapes, updates geometry and text size immediately, and refuses invalid sizing and component cycles as Figma does (#786). `openpencil eval -o` saves a script's edits laid out, and CLI `eval` and tools measure text in the document they edit; `@open-pencil/core/figma-api` exports `flushPendingLayout` for hosts that save scripts' results.
- AI, MCP, and CLI tools reject arguments they do not take (#977), keep variable bindings through stdio `render` (#830), size groups and booleans to their contents (#738), work on pages other than the one on screen, run XPath queries under Node (#787), judge text contrast by its WCAG ratio (#735), and report failed saves as errors.
- AI chat replies stop cleanly, survive switching pages, accept `eval` results of any shape, use a newly saved API key right away, and keep your message when the chat cannot start. In the desktop app, replies stream and keep going past 30 seconds, a request that cannot reach the provider is retried, and scrolling back to the bottom resumes following. Pi chats start with OpenPencil's MCP tools on Node 22.15 or later, resume cleanly, and stop a reply without losing the session.
- In the desktop app, Select All, Undo, and Redo typed in a text field such as the chat input act on the field instead of the canvas, and other canvas shortcuts no longer reach the canvas from a text field.
- Shared rooms keep one consistent layer tree when people move, reorder, or add layers at the same time (#888, #889).
- Storage keeps working: browser storage saves after Safari suspends a tab, in Private Browsing, and for documents over 127 MiB; crash recovery and autosave run after edits instead of on redraws, which froze Safari; S3 storage works with servers that answer range reads with `200`, such as `rclone serve s3`; and when saved credentials are paused, the home screen offers **Retry access**.
- Memory stays flat during long AI and MCP sessions (#587), image-heavy `.fig` files open without running out of memory (#924), and closing a tab releases its document.
- Show a clear message instead of a blank window when the browser or WebView is too old, and start on macOS 13 with older WebKit (#744).
- Picking an OkHCL colour no longer overwrites a layer's other plugin data, including other plugins' data and its export settings.
- Warnings and errors show in the theme's colors: library update and diagnostics warnings, errors on the home screen and when renaming layers, publishing a library or authoring variants, and chat errors, copy confirmations, and error toasts in the light theme.
- Smaller fixes: layers keep their place when moved into or out of a rotated or flipped parent (#737), the Vue SDK's `CanvasSurface` starts, `.pen` text sizes from its font, whole-step number field drags, ⌘Z after nudges, ⇧-resizing, Paste here in transformed frames, zooming to a fixed level, the font picker's starting position and search order, section and frame titles, tab and menubar overflow, the mobile file menu's labels, tooltips, full hex and opacity values, component set borders at every zoom, the caret in empty text, imported page backgrounds, `.fig` thumbnails in recent files, the canvas context menu closing on a quick second right-click, model pickers in Settings → Models closing while the editor slides in, and screen reader labels.
- Ship the MIT license text in every npm package, with READMEs for `@open-pencil/core`, `@open-pencil/cli`, and `@open-pencil/mcp`.

### Performance

- Open large `.fig` files with a fraction of the memory: the Nuxt UI design kit takes 0.7 GB instead of 2.2 GB, and pages share unchanged component data and JavaScriptCore object layouts.
- Save an edited `.fig` by rewriting only what changed, off the main thread in the browser: the 109 MB Preline UI kit saves in about 3 seconds instead of over two minutes, with about 1.5 GB less memory on large kits.
- Open multi-page `.fig` documents, lay out pages with many text layers and instances, and edit text selections and variables without long freezes or full redraws.
- Joining a shared room is faster: the document a person receives on joining is compressed, about a twelfth of its size before (480 KB instead of 5.7 MB for the demo tour), and edits travel in Yjs's more compact encoding.

### Security

- Limit what the desktop app may write and run: no writes to startup locations, shell profiles, global package folders, or MCP discovery files, and only the exact command lines of supported agents, the MCP server, and the Harness companion.
- Update to Tauri 2.12, which binds large IPC responses to the requesting webview (GHSA-w28w-mhc8-qvjv), and install desktop updates only when the signature names the announced version.
- Evaluate `calc` through `jsep` and an arithmetic allowlist instead of `expr-eval`, which had an unpatched code-execution advisory (GHSA-q9v2-7m5w-4693); `calc` now supports `**` and nothing it does not document.
- Escape layer names and text in JSX and Tailwind JSX export, so document text cannot inject attributes or expressions into `render` and `replace`.
- Validate collaborator cursors and names, clipboard data, component library revisions, and MCP and automation messages before using them, and update `@xmldom/xmldom` to 0.9.12, which fixes quadratic parsing of crafted SVG and XML.

## 0.15.1 — 2026-09-18

### Added

- Configure built-in AI and local MCP tool access independently on a Tool access page, including optional extended AI tools, searchable read-only and side-effect groups, and per-target defaults (#584).
- Set the built-in AI's maximum steps per message in Chat settings, including a custom number, with consistent stopping and remaining-step warnings (#573).
- Open documents and jump to a named layer from `openpencil://open?file=&node=` links, resolving the file against open tabs or a one-time file picker. Path segments match the way the filesystem does: case-insensitively on macOS and Windows, exactly on Linux.
- Open documents and jump to a named layer in the web app from `?file=&node=` links, fetching the file from an `https:` URL without credentials, ignoring the URL fragment, and refusing a document larger than 64 MiB — a ceiling the automation bridge's `openFile` now shares.

### Changed

- Create new documents with the sRGB colour profile, so Display P3 is reserved for documents that declare it.
- Export diagnostics from Settings only, with a retention count you choose. AI requests and tool activity now carry conversation and request identifiers, while chat no longer offers a separate diagnostic log or includes transcript content.
- Replace the demo's legacy reference page with a component library on the first page, including component sets, linked instances, component properties, and the variable collections, and show the standard canvas loading overlay and tab indicator while it is generated instead of an empty canvas.

### Fixed

- Store colours edited in the colour picker in the document's colour profile, and convert them on the way to the display, so a Display-P3 document no longer looks different on an sRGB display than on a wide-gamut one.
- Keep Display-P3 documents rendering correctly in wide gamut where the browser supports it and in sRGB elsewhere, fixing the black rectangles and incorrect blend colours, with a dismissible notice when wide gamut is unavailable.
- Classify MCP `open_file` and `close_file` operations as read-only hints, and close opened document tabs through the new `close_file` tool with the usual unsaved-change prompt.
- Let the desktop app use an MCP server you started yourself by allowing the app's own origin by default, instead of requiring `OPENPENCIL_MCP_CORS_ORIGIN`.
- Explain why the local MCP server did not start — a missing `@open-pencil/mcp` install, a denied command, an early exit, or an unreachable address — with translated guidance, and find a globally installed server when the desktop app is launched from the system shell.
- Animate the AI chat tool-call disclosure, which expanded and collapsed without motion because its animation classes were misspelled.
- Mark unsaved documents and ask whether to save before closing a tab, the desktop window, or the application, rather than relying on recovery alone.
- Defer AI provider connections and system credential reads until you send a message or use a connected feature, so opening documents and browsing chat history no longer trigger unexpected credential prompts.
- Save and recover documents whose text uses disabled numeric, fraction, or small-caps OpenType features, which previously failed to write a `.fig` file.
- Update instance text properties on the canvas while typing, with grouped undo for rapid edits.
- Point Homebrew installation instructions to the official `openpencil` cask and document separate CLI installation.
- Reach the custom model option in the model picker for providers with large model catalogs instead of requiring a search for it.

### Performance

- Reduce editor pauses while generating recovery snapshots and exporting text-heavy `.fig` documents.
- Recompute layout only for the pages an edit affects, instead of every page, when editing a component or its instances.

## 0.15.0 — 2026-09-16

### Breaking changes

- Use MCP SDK v2 server/client types for programmatic MCP integrations. Define custom tools with native Valibot `input` schemas and execution metadata instead of `params`, `ParamDef`, or `paramToZod()`.
- Replace Scene Graph `overrides` records with `instanceOverrides`, using separate `self` and `descendants` maps. Rename `figmaDerivedLayout`, `figmaDerivedTextGlyphs`, and `FigmaDerivedTextGlyph` to `derivedLayout`, `derivedTextGlyphs`, and `DerivedTextGlyph`.
- Update custom Vue SDK binding providers to implement `getBindingId()` and handle `unresolved`. Replace `setValue()` with `prepareEdit()`, returning a stable edit key, captured value, setter, and restoration callback.
- Replace Vue SDK `useDialogMessages()`, `dialogMessages`, and their catalog keys with the corresponding product-domain message composables and catalogs.
- Use Vue 3.5.41 or newer within Vue 3 for the Vue SDK, and CanvasKit 0.41.1 or newer when supplying its optional CanvasKit peer. Update custom CanvasKit integrations to use `PathBuilder` and immutable `Path` operations.

### Added

- Expose design inspection and undoable layer-property and variable edits to browser agents through experimental WebMCP in supporting browsers, with explicit Off, Inspect, and Edit access controls in Settings.
- Control custom tool exposure independently through `mcp`, `ai`, and `webmcp` exclusions. Tools are included by default, subject to execution support and user permissions.
- Bind Design JSX spacing, sizing, corners, and typography directly to numeric document variables.
- Define component properties and assign instance values in Design JSX using stable property IDs.
- Save AI conversations and attachment previews locally, switch between chats, rename or delete them, and browse saved transcripts across documents. Choose whether reasoning stays collapsed, expands while thinking, or stays expanded, with animated disclosure controls that respect reduced motion.
- Add a searchable command palette for editor and application actions.
- Search current AI provider catalogs from model pickers, with curated recommendations, recent compatible models, and offline fallbacks.
- Render triangle and line arrow stroke caps on lines and open vector paths, and choose them from the stroke cap picker.
- Expose component properties and instance-swap targets through the Figma API and automation.
- Create, select, move, duplicate, transfer, and delete canvas and frame guides directly from rulers, with undoable edits, measurements, context-menu actions, and `.fig` round-trip fidelity.
- Open to a unified home with recent and configured storage documents in grid or list layouts, and open multiple selected design files in separate tabs.
- Snap vector points, moved layers, and resized edges to nearby geometry, guides, frame and canvas bounds, and whole-pixel coordinates, with visible alignment guides and persistent snapping preferences.
- Run Pi through AI SDK HarnessAgent as a configurable desktop provider with saved model profiles, secure credentials, existing MCP design tools, and per-profile thinking and permission settings.
- Combine components into variant sets through Figma API scripts and automation.
- Add local AI usage and technical diagnostics, including token telemetry, provider/model summaries, recent failures, configurable retention, export, and clear controls (#588).
- Import, render, edit, resize, select, and export Figma text-on-path layers while preserving their curved glyph layout.
- Show temporary Figma-style distance measurements between selected and Option/Alt-hovered layers (#491).
- Edit Design JSX and HTML/CSS previews in CodeMirror, with theme-aware highlighting, Tailwind viewing, completion, diagnostics, bounded execution, and session-level undo (#130).
- Set provider-specific reasoning effort on supported AI model profiles (#454).
- Show unavailable or substituted document fonts with affected-layer selection and retry actions, and expose font fidelity through the Figma API, MCP, and `openpencil fonts [file] --json`. Choose `warn`, `strict`, or `allow` font-substitution policies for file-backed CLI raster and PDF exports with `--font-policy` (#503, #625).
- Add reusable remote MCP connections for ACP agents, with Streamable HTTP endpoints and credential-backed bearer tokens.
- Author and manage multidimensional component variants and published component libraries, including revision previews, linked-instance updates, stable library identities, offline catalogs, storage-backed catalogs, and read-only library definitions (#239).
- Recover unsaved and pathless documents locally, including after closing their tabs, with options to disable recovery and restore or discard retained snapshots (#487, #505, #574).
- Inspect selected designs with a configured Vision model and attach images to AI chat with bounded analysis and previews (#232, #471).
- Pin selected layers as explicit AI chat context, show collapsible reasoning, copy individual responses, and grow the composer with multiline prompts (#13).

### Changed

- Refresh the OpenPencil mark across the editor, documentation, browser tabs, installed web apps, and desktop icons, with small-size and dark-background adaptations.
- Explore editable component, typography, and paint comparisons in the demo, with the original examples preserved on a reference page.
- Use compact desktop Home search actions with consistent responsive layout and control sizing.
- Keep pixel-grid rounding invisible while showing alignment guides only for real geometry, objects, and canvas/layout guides.
- Embed images when copying selections into Figma, and preserve geometry, text sizing, component links, variables, modes, and shared styles when pasting within OpenPencil.
- Choose the app theme and whether animations follow the system or stay off under Appearance in General Settings, with live updates and persistent preferences.
- Simplify property panels with fill and stroke style pickers in section headers, concise effect style rows, and collapsed equal corner fields when all four share a variable. Preserve applied and missing styles and remove the redundant Dimensions heading for text layers.
- Open variable pickers below their trigger when space permits, flipping above near the viewport edge.
- Keep AI chat preferences with the model overview and edit models in a fixed-size Settings pane with explicit Save and Cancel actions.
- Match page-list density to the layer tree and add subtle, reduced-motion-aware dialog transitions.
- Fade in streaming Markdown list items and code lines without animating completed responses.
- Vertically center shaped section titles and allow renaming a section by double-clicking its canvas label.
- Load supported online fonts before revealing imported pages, preserve substituted text during editing, and shape canvas labels with Inter typography and shared Arabic/CJK font fallback.
- Complete translated app, accessibility, font, color, file, clipboard, collaboration, chat, vectorization, storage, recovery, component-library, and connection feedback across supported locales, and synchronize document language with the selected locale.
- Separate local MCP server controls, browser WebMCP access, and remote connections in Settings, with inline searchable tool permissions.
- Show translated field errors, hints, and consistent contextual alerts in Settings forms, focus the first invalid field on submission, and explain missing requirements instead of silently disabling Save or Test.
- Pan horizontally with Shift+wheel while preserving native horizontal trackpad movement.

### Fixed

- Render four-point diamond gradients, preserve text layout across fill types, and keep image colors accurate on sRGB displays.
- Keep newly created and edited objects visible during zoom instead of replaying outdated scene content.
- Keep property fields and paint previews live during editing, rotated selection labels readable and aligned, and object edges stable when previews settle.
- Show compact bordered section labels with inset nested titles and clearer hover feedback.
- Keep Undo and Redo commands available as edit history changes, without requiring another scene edit.
- Avoid recursive desktop HTTP proxy requests when font downloads intercept Tauri IPC traffic.
- Keep FIT image fills proportional, centered, and fully visible without stretching or cropped edges.
- Preserve edited instance text, including cleared labels, when saving and reopening `.fig` files.
- Honor `.pen` frame layout defaults and sizing and padding shorthands so imported auto-layout frames keep their computed dimensions and child positions (#564).
- Avoid macOS Keychain prompts during credential status checks and pause repeated credential access after failures until explicitly retried from Settings.
- Honor explicit Design JSX instance dimensions and preserve authored overrides through component synchronization.
- Route browser Command/Ctrl plus and minus shortcuts to canvas zoom instead of page zoom.
- Resolve `$name` references in imported `.pen` fills, stroke fills, font families, dimensions, and spacing without requiring a `--` prefix (#563).
- Resolve bound fields in each layer’s mode, keep variable edits scoped and undoable, and make broken bindings visible and recoverable.
- Display letter spacing in pixels and support explicit automatic line height.
- Prevent the stock photo tool from replacing text, lines, structural layers, or containers with content while supporting closed shape geometry.
- Preserve imported Figma text alignment metadata, explicit normal blend modes on text and vectors, and implicit fixed text sizing in auto-layout frames across save and reload.
- Render imported Figma strokes with odd-length dash patterns correctly.
- Stop showing a misleading desktop-only warning when web font loading or catalog lookup fails.
- Resolve fallback fonts reliably for cached characters, mixed-language text, and text-case transformations.
- Preserve imported Figma divider-line geometry during auto-layout recomputation, preventing half-pixel shifts on save and reload.
- Resolve package imports under Node and Bun from ordinary tarballs while preserving Bun source-first workspace execution (#663).
- Use the user's home directory as the default MCP file root on Windows, avoiding the caller's unreliable working directory.
- Open legacy raw `.fig` files that store the Kiwi document and thumbnail without a ZIP wrapper (#582).
- Preserve a frame's auto-layout HUG sizing, variable bindings, and variable modes when converting it into a component through the Figma API or automation (#595).
- Run `openpencil import` on Node so npm-installed CLI users no longer encounter `Bun is not defined` (#575).
- Generate recent-file previews from the conventional `Cover` page without modifying the source file.
- Resolve Vue SDK semantic test selectors correctly in non-browser runtimes (#397).
- Commit vector vertex and Bézier-handle edits when the pointer is released and keep transformed vector-edit overlays aligned (#586).
- Preserve app-created component properties and instance-swap targets across `.fig` save and reload cycles (#548).
- Reconnect desktop automation to an already-running MCP server through its discovery file (#546).
- Keep text-editing carets, hit testing, and selection highlights aligned with vertically centered or bottom-aligned text (#539).
- Match AI chat code-block colors and backgrounds to the active theme, and let desktop users select and copy chat text without replacing it with canvas layers (#537, #538).
- Restore visible above, below, and child drop feedback while dragging layers in the Layers panel.
- Place editor-created instances beside nested source components in world space, including transformed parents.
- Prevent malformed collaboration updates from corrupting synchronized nodes or derived text rendering.
- Transfer native `.fig` exports over binary Tauri IPC, preventing large desktop saves from being truncated or exhausting WebView memory (#484).
- Decode zstd-compressed FIG containers and reject invalid compressed payloads (#397).
- Compose caller CSS with Tailwind defaults when importing DOM/CSS documents (#397).
- Preserve desktop HTTP timeout, abort, and empty-response semantics (#397).
- Report whether missing Figma clipboard images were actually fetched (#397).
- Report exhausted provider credit, request failures, and output-token limits through localized chat toasts and copied diagnostics (#451, #454).
- Prevent Windows desktop crashes when loading large system fonts for non-Latin text.
- Preserve open vector segments when the same vector network also contains filled regions (#450).
- Match Figma Plugin API behavior for `rescale()`, page `backgrounds`, and nullable visual `absoluteRenderBounds` (#442).
- Keep imported and pasted Figma instances linked to their remapped source components so later component edits update existing instances (#385).
- Restore native copy, cut, and paste shortcuts in desktop text inputs while preserving design clipboard handling on the canvas.
- Preserve committed desktop text input when the WebView supplies text through the input event before updating the hidden text field (#607).
- Preserve selected layers when browser clipboard serialization fails during cut operations, and fall back to the session clipboard when system clipboard access is unavailable (#568).
- Treat MCP tool results with an omitted `isError` field as successful while preserving explicit MCP errors (#583).
- Preserve effective nested instance text overrides when importing complex Figma component hierarchies (#102).
- Preserve SVG clip paths, including clip shapes referenced through `<use>`, when importing editable vectors.
- Preserve circles, ellipses, rectangles, lines, polylines, and polygons supplied as JSX children of inline SVG elements (#452).
- Stop local MCP servers after the app disconnects instead of leaving orphaned background processes (#494).
- Prevent unbounded instance duplication when editing Figma-imported or pasted components with serialized or renamed children, keep extra instance children in their intended order, and avoid pasted instances re-linking pre-existing instances during clipboard import.

### Performance

- Reduce pauses after repeated frame creation without leaving hidden property edits or popups active.
- Reduce repeated text shaping and scene invalidation while moving and resizing objects, and reuse fitting canvas labels during zoom.
- Reduce unnecessary layout work after automation and Figma API edits by updating only affected layers and containers.
- Keep rapid trackpad zoom reversals and effect-heavy document navigation responsive by cancelling obsolete reconstruction and reusing safe raster snapshots.
- Show the FIG page list from a lightweight Kiwi scan before materializing the full document.
- Avoid redundant collaboration writes when synchronized node fields have not changed.
- Release completed streaming-response state to reduce retained chat memory (#544).
- Open large documents faster by reducing repeated position calculations when finding layers under the pointer (#527).
- Avoid redundant autosaves while a `.fig` export is in progress, while ensuring newer edits are saved afterward (#528).
- Defer JSX generation and syntax highlighting until the Code panel is active, keeping large canvas selections responsive (#500).
- Paste large, flat Figma selections faster by avoiding repeated scans of clipboard layers (#500).
- Reduce peak memory during `.fig` export by sharing immutable binary resources with the isolated export graph.

### Security

- Protect new real-time collaboration sessions with stronger invitation credentials.

## 0.14.0 — 2026-08-10

### Breaking changes

- **Core SDK:** Import scene graph types, geometry, coordinate, matrix, snapping, undo, and path helpers from `@open-pencil/scene-graph`; import `.pen` parsing from `@open-pencil/pen`; import synchronous Kiwi decompression from `@open-pencil/kiwi` instead of the `@open-pencil/core` compatibility barrel; use uppercase acronym casing in exported identifiers, including `JSONObject`, `JSONArray`, `JSONValue`, `RPCCommand`, and `executeRPCCommand`; and use the renamed tool exports `importSVG`, `exportSVG`, `exportPDF`, `getJSX`, `diffJSX`, and `setPexelsAPIKey`.
- **Vue SDK:** Replace the removed color-picker model helpers with `useColorModel()`; replace the deprecated `FillPickerRoot` and `useFillPicker()` APIs with `FillRoot`, `FillSwatch`, `useFill()`, and a consumer-owned popover; rename `FontPickerUi` to `FontPickerUI`; and remove the exported `testId` prop helper types in favor of semantic component anatomy.
- Keep core and Automation-tree JSX rendering on the same deterministic placement path, so
  `replace_id` and `insert_index` preserve the intended parent/order, report the applied placement,
  and roll back the correct page when post-render font or layout work fails.
- Surface core tool-domain failures as MCP errors instead of successful nested `{ error }` payloads,
  and warn during compilation when emitted pages contain missing, ambiguous, cyclic, or otherwise
  invalid navigation targets.
- Measure describe-time text contrast from composited alpha, node opacity, and ancestor fills using
  the WCAG AA ratio instead of RGB distance or a dark-on-dark heuristic.
- Keep image-heavy `.fig` saves responsive in Tauri by replacing JSON byte-array IPC with a raw
  binary request/response, building the native archive on a blocking worker thread, and serializing
  versioned saves against the file target captured when each save was requested.
- Keep `navigate` actions inside reusable Compiler components wired to React Router, including
  dynamic route params and component-root events, while stripping them safely from routerless
  single-page output.
- Reduce large `.fig` open and page-switch pressure by transferring source bytes without routine
  full-file copies, skipping unsafe OOM fallbacks, releasing completed lazy-import metadata and old
  page CanvasKit resources, bounding decoded-image caching, culling retained backing work to the
  visible region, using cooperative layout, and suspending idle canvas frames while loading. (#255)
- Keep image- and font-heavy `.fig` documents interactive during first open: present their imported
  geometry and derived text without waiting for online providers or redundantly re-running Yoga,
  batch exact-font activation after background resolution, prefer the bundled Simplified Chinese
  fallback over copying a large system TTC through desktop IPC, and build the first retained
  CanvasKit frame in flushed spatial tiles instead of one synchronous whole-page task.
- Preserve generated and imported image-fill assets in compiler static builds instead of leaving
  broken background URLs after Vite moves the stylesheet into the output asset directory.
- Keep long built-in AI drawing sessions responsive by streaming raw system-font bytes with bounded
  script-specific caching, propagating cancellation through tools, layout, fonts, icons, and ACP,
  serializing mutations into transactional undo snapshots, bounding retained CanvasKit backing
  memory, and recovering the last good scene after transient renderer failures.
- Preserve exact non-frame-aligned WebM durations through FFmpeg IVF remuxing, reject unsupported
  partial-frame MP4 plans before encoding, propagate generated-effect time and reduced-motion mode
  through AI/MCP raster rendering, prevent early FFmpeg exit from hanging stdin backpressure, and
  prevent a racing empty destination directory from being replaced during PNG-sequence publication.
- Lower prototype hotspots, after-delay connections, overlays, and Smart Match keys from component
  master bodies into instance-scoped generated React nodes, so repeated component instances no
  longer share target identity or silently drop interactive behavior.
- Reverify signed Team Motion registry metadata at every app, CLI, AI, and MCP trust boundary;
  expose pure accept/reject/rollback operations and accepted-snapshot application without allowing
  pending or tampered history to mutate a document.
- Keep a cleared idle public Motion Runtime binding cleared when the operating-system reduced-motion
  preference changes, while still resampling fixed-time bindings that remain visibly applied.
- Play all mounted `pageExit` tracks before generated React lowcode navigation, while keeping the
  route transition non-blocking when the Motion runtime is absent and enforcing a four-second safety
  cap for stalled or infinite exit animations.
- Preserve `.pen` Motion inheritance across component refs and nested descendant overrides, retain
  explicit clear tombstones, reject edits that conflict with unknown metadata schemas, and keep
  derived auto-layout updates from being mistaken for unsupported source edits.
- Write `eval` output with the document format selected by its destination extension, so `.pen`
  output remains Pencil JSON instead of receiving a mislabeled `.fig` ZIP archive.
- Match regional browser languages to supported locales without selecting a secondary language. (#417)
- Save auto-layout frames that stretch their children to `.fig` without failing. (#427)
- Preserve multiple colors in imported vector artwork such as multi-color logos. (#386)
- Edit vectors in opened documents at the correct position, with live fills and undo/redo. (#390)
- Reduce large `.fig` page-switch work to the active page, reuse fixed-point propagation indexes, and coalesce Layers tree rebuilds. (#420)
- Center text glyphs within explicit line-height leading in CanvasKit paragraph rendering.
- Fully reload generated previews when the virtual file topology changes, so adding a document's
  first Motion runtime or CSS module is evaluated immediately without a manual preview refresh.
- Remove cleared optional node fields from both Yjs peers instead of leaving stale Motion data in
  the remote graph.
- Avoid transient Missing font warnings while a local, cached, or online font is still resolving;
  only report a family after its available sources fail or are exhausted, and let the warning
  retry every required face after clearing matching online-font failure caches. When a family does
  not publish the requested weight or slant, load its regular face for CanvasKit synthesis instead
  of repeatedly retrying an unavailable exact face, and only report retained/downloaded bytes as
  loaded after every active CanvasKit provider accepts them.
- Keep generated React previews and static compiler output on the same resolved font faces as the
  canvas: emit portable font assets and `@font-face` rules, preserve synthetic weight/slant
  fallback, add the Inter and script fallback stack, carry binary files through the preview
  sidecar with acknowledged reusable references, and preserve text/button typography, including
  non-token font sizes, weight, italic, line-height, and letter-spacing. Canvas
  and compiler font-provider requests use language subset labels rather than sending document text
  or glyphs. Generated assets retain provider policy provenance and warn when an exact
  redistribution license still requires review. Fonts whose OpenType `OS/2 fsType` explicitly
  restricts embedding are marked as requiring a license and omitted from generated assets with a
  `font-license-embedding-restricted` warning.
- Treat bound radio and checkbox groups as controlled validation fields, validate their complete
  state instead of a wrapper event target, and make `required` reject unchecked booleans and empty
  option arrays.
- **CLI and MCP SDKs:** Use uppercase acronym casing in exported identifiers, including `AppTargetCLIArgs`, `appTargetRPCArgs`, `loadRPCData`, `prepareDocumentForRPC`, `RPCSender`, `createBrowserRPCBridge`, `createMCPSessionManager`, and `createStdioRPCBridge`.

### Added

- Add an opt-in Vue source exporter backed by the Compiler's Vue adapter. Installed and enabled
  users can export a source-only Vite + Vue 3 + TypeScript + Tailwind ZIP with editable SFCs,
  multi-page Vue Router v4 routes, live route/query bindings and safe parameterized navigation,
  reactive state/bindings/events, accessible bounded Toast feedback, focus-managed two-branch
  Confirm, local required/pattern/length/range/custom-expression form validation, components, and
  byte-exact image assets. Invalid forms prevent authored submit handlers from running; remote
  asynchronous validation performs no request, blocks submission, and emits
  `vue-validation-async-unsupported`. Authored raw HTML now becomes an empty static shell with
  `vue-raw-html-unsupported` instead of entering an injectable `v-html` binding.
  Modal, Dropdown Menu, Slide Menu, and local-only Upload Button now emit real accessible Vue
  runtimes; other modules, Motion, prototypes, Supabase/auth/server workflows, Stripe, i18n,
  analytics, React UI kits, and persistent document state remain explicit in `EXPORT_WARNINGS.md`.
  UI and MCP compile and compress in disposable module Workers that terminate on cancellation without
  detaching live graph buffers, fail closed above a 25,000-node/4,096-image/32-MiB snapshot, and bound
  output before the independent 64-MiB archive check. The plugin UI reports every export stage,
  provides cancellation, permits one active export, and blocks disable/update/rollback/uninstall of
  the exporting plugin until completion. Its no-network font pass reuses retained, cached, or bundled
  bytes only after exact digest, embedding, and redistribution-license review, adds
  `FONT-LICENSES.txt` for included faces, and warns while preserving family CSS for omissions. Its
  cancellable exporter MCP tool exists only while the plugin is installed and enabled and is revoked
  immediately when disabled or removed. The CLI `compile`, `build`, and `deploy` commands accept
  `--target vue`, and Compiler Preview can switch its isolated sidecar between React and Vue 3.
  Both Preview targets now share selection/Alt-click round trips, echo-suppressed two-way page
  navigation, collaborative document-state mirroring, and Light/Dark DOM theme synchronization. The
  bridge remains `devMode`-only and absent from static output; Vue Motion Debug reports unavailable
  immediately while its Motion runtime remains unsupported.
  Static builds now write only to nonexistent/empty output directories or replace directories whose
  valid regular-file `.openpencil-build-output.json` marker and complete file set still match the
  preceding OpenPencil build; unmarked/untrusted, missing, or extra files fail closed instead of being
  deleted.

- Show delayed, non-blocking canvas progress while page font faces and script fallbacks are prepared.
  Fast operations never flash a status; visible operations report accessible progress, briefly
  confirm completion, disappear immediately when cancelled, and ignore stale events from superseded
  page switches. Existing Missing font diagnostics remain responsible for individual failures.
- Add Automatic canvas performance alongside resource saving, balanced, and smoothness-first
  profiles. Automatic mode evaluates active scene-frame cost with downgrade/recovery hysteresis;
  manual and automatic level changes apply live without reducing ordinary pointer, drag, pan, or
  zoom input cadence. Profiles bound generated-effect and collaboration-cursor cadence, retained
  scene work, renderer-owned decoded-image wrappers, font loading, memory-gated FIG worker starts,
  and cooperative background-layout slices. The decoded-image setting is a wrapper budget, not a
  hard native/GPU-memory ceiling.
- Route selection chrome, passive hover, and remote collaboration cursors through the overlay-only
  repaint path so they no longer invalidate or rebuild the scene backing. Passive hover is coalesced
  to animation frames and collaboration cursors use profile-specific 15/30/60 Hz caps with exact
  trailing flushes at interaction and lifecycle boundaries.
- Add Real-time, Auto, and Manual Compiler Preview refresh policies. Preview compilation is
  single-flight and latest-change-wins, Auto adapts its trailing delay to recent compile plus ACK
  time, and Manual still generates the initial preview while deferring later changes until reload.

- Expose installed and enabled declarative plugin modules, commands, cancellable exporters, and
  explicitly authorized read-only connector queries whose contract uses fixed `GET` or an
  explicitly reviewed fixed `POST` as
  dynamically registered MCP tools. Plugin store changes update connected clients with
  `notifications/tools/list_changed`; disconnects remove the dynamic catalog, and execution rechecks
  current installation, enablement, contribution identity, and reviewed host-adapter compatibility
  so cached tool names cannot bypass disablement or removal. Stable tool names include the canonical
  contribution's SHA-256 identity, and exporter cancellation is checked through the final atomic
  write boundary so an RPC timeout cannot silently complete a reported-failed export. Module,
  command, exporter, and connector-query contributions map to add, run, export, and query tools;
  connector mutations remain UI-only and require a fresh human confirmation for each invocation;
  uninstalled, disabled,
  host-incompatible contributions and host-declared non-cancellable exporters are omitted. Vue source
  export is dynamically available after opt-in installation and enablement. Tauri, Expo,
  Next.js, Capacitor, Electron, Flutter, and Figma source/projection exporters remain available from
  plugin UI and menus but stay out of MCP until their synchronous Compiler/encoder stages support
  cooperative cancellation.

- Expand the bundled catalog to 58 reviewed plugins with 61 contributions: 20 modules, nine commands,
  nine exporters, 22 connectors, and one storage provider. Add opt-in Tabs,
  Accordion, QR/Code 128, Markdown, Code Block, PDF Viewer, and Audio Player modules with strict
  bounded configuration, deterministic offline Canvas previews, reviewed Web/React adapters, and
  explicit Expo/Flutter static fallbacks. Advanced Data Grid gains bounded RFC 4180 CSV import/export
  in the editor and generated runtime. Add a cooperatively cancellable Static Design System Audit for
  token, component-variant, spacing, and typography consistency, plus source-only Next.js,
  Capacitor, and Electron exporters that never install dependencies or execute generated projects.
  Plugin cards, Canvas module headings, and contribution search now include reviewed Simplified
  Chinese names and descriptions without changing signed manifest bytes. Slide Menu triggers now
  render as a centered vector hamburger plus label across Canvas, React/Vue previews, and Expo/Flutter
  static fallbacks, with independent visibility controls for the icon and trigger text. Its nested
  item fields now keep readable foreground/background contrast in both editor themes, while generated
  panels place an accessible vector close control in the top-right corner with a 44-pixel target.
  React and Vue keep an accessible name even when both trigger parts are hidden and use a semantic button
  with a 44-pixel minimum target and visible keyboard focus; native static fallbacks remain explicitly
  non-interactive. Add an opt-in Modal module with independently visible trigger icon/text, bounded
  plain-text title and body, configurable close/Escape/backdrop/footer behavior, responsive colors
  and sizing, a deterministic offline Canvas trigger, accessible portalled React and Vue dialogs, and
  explicit non-interactive Expo/Flutter fallbacks. Add an opt-in Dropdown Menu module with a
  flat-only v1 item/divider contract, safe optional links, explicit disabled/danger/shortcut states,
  12 reviewed placements, separate trigger label/chevron controls, a compact accessible property
  editor, accessible React/Vue runtimes, and install-and-enable-gated MCP exposure with immediate revocation. Add an opt-in Upload
  Button module with bounded local file selection, per-type token editing, count/size/type validation,
  accessible React/Vue drag-and-drop and keyboard behavior, and explicit not-uploaded messaging. It never
  transfers or persists selected files; its MCP surface adds only declarative module configuration
  while installed and enabled and never carries file names or bytes. The executable
  connector set retains Supabase Schema Inspector, Airtable Records, Supabase Tables, Stripe Checkout & Billing,
  and Resend Email and adds 17 opt-in, read-only external-service integrations: Neon,
  Sentry, HubSpot, Apollo, PostHog, Asana, Zotero, HeyGen, Linear, OpenAI, Box, Slack, Google
  Calendar, SharePoint, Outlook Email, Outlook Calendar, and Microsoft Teams.

- Add opt-in **Application Security Readiness**, a local, read-only, cancellable, resource-bounded
  production-readiness command with fixed issue codes, counts, and remediation. It does not return
  document content or secrets and is explicitly not a complete security assessment, penetration
  test, certification, or guarantee.

- Add opt-in Vercel and Cloudflare Pages deployment plugins. Their MCP-safe commands only review a
  bounded deployment plan and cannot read credentials, build, perform network requests, or change
  state. Real deployment remains available only from the installed-plugin UI after a fresh human
  confirmation for every invocation; MCP cannot invoke it, and interruption after dispatch can leave
  an unknown remote outcome. Bind confirmation and history to the reviewed document, preserve
  in-flight status across Settings lifecycles, and block plugin lifecycle changes until deployment
  settles.

- Add the default-installed, default-enabled, host-owned **Google Drive Storage** plugin declaration
  through Manifest v2 `storageProviders`. Its exact provider, adapter, configuration version, and
  bounded read/write/delete/change/resumable capabilities must match the application registry; a
  publisher manifest cannot supply OAuth, network configuration, native code, or an adapter.
  The Tauri-first provider uses the system browser, a loopback callback, Authorization Code + PKCE,
  the narrow `drive.file` scope, OIDC account binding, and encrypted app-local credential storage.
  The public installed-app client needs only a publisher-supplied Google Desktop OAuth Client ID
  bundled at build time; no client secret is bundled. It writes
  ordinary user-visible `.fig` files, saves locally before a durable outbox upload, recovers pending
  saves and tombstones, uses resumable transfers and incremental Drive changes, and applies ETag
  conditions when Drive supplies them. Upload-session URLs remain process-local; an ambiguous remote
  success followed by a crash recovers through a timestamped conflict copy instead of risking a
  silent overwrite. Named profiles isolate accounts, credentials, provider preferences, cursors,
  caches, and durable jobs; fresh installs start on the recommended Google Drive provider. Every
  cloud open, create, refresh, save, delete, disconnect, profile removal, and configuration rotation
  requires the local document index and Outbox to pass live durable IndexedDB probes. Production
  memory fallback blocks these operations and points users to local `.fig` export instead of claiming
  offline/restart safety.
  Reauthorization inspects unfinished work before launching OAuth, requires explicit confirmation
  when necessary, adopts same-account cached documents and queued jobs into the new random grant,
  and exposes a repair action if the app stops between authorization and adoption. Disconnect and
  profile removal fail closed while unfinished work remains. S3-compatible profiles now bind every
  cache row and durable job to a stable profile incarnation plus a random configuration generation;
  endpoint, bucket, region, or credential changes rotate that generation and are blocked while
  pending, conflicting, or deletion work exists, so old jobs cannot execute against a new bucket.
  Legacy authority-less profiles show their endpoint, bucket, and affected workload and require
  confirmation before a restartable migration atomically rekeys metadata, `.fig` bytes, and
  thumbnails and atomically replaces matching Outbox jobs in the first exact generation. Collisions
  or cross-generation targets fail closed, and configuration or credential changes stay blocked
  until migration completes.
  The Storage workspace records deletes locally before moving Drive files to trash, blocks deletion
  while a document is open, and resumes interrupted ranged downloads against one strong ETag.
  S3-compatible storage remains the advanced self-managed alternative.
  Google Drive synchronization is whole-document and eventually reconciled, not a strongly
  consistent collaboration backend. Automated contracts are covered; a real Google OAuth client,
  account consent, restart, upload, changes, and conflict E2E remains a manual release check.

- Add the Phase 2 connector Broker for 22 bounded data-source and action integrations. **Settings →
  Plugins** now owns connector credential status, central credential replacement/clearing,
  session-scoped exact-digest authorization and revocation, and the operation launch surface. The
  Broker resolves credentials only at execution time, keeps raw values outside manifests, documents,
  logs, MCP results, and plugin data, and enforces the reviewed exact HTTPS origin or origin template, method, path template,
  `credentials: 'omit'`, redirect rejection, timeout, and request/response limits. Tauri uses a
  bounded native request proxy; results pass closed normalized schemas; audit entries retain only
  redacted metadata. Disable, uninstall, package-digest change, and authorization revocation stop
  local in-flight work. Queries retain cancellation semantics; a dispatched mutation whose result
  is interrupted or cannot be validated is explicitly reported as an unknown remote outcome so the
  user can verify the service before retrying. Supabase update/delete requests use strict
  `max-affected=100`; Stripe Checkout and Resend Send bind a reviewed UUID `mutationAttemptId` to the
  provider `Idempotency-Key` and reuse it for the same unknown-outcome retry. Dynamic MCP exposes only
  explicitly authorized read-only queries using fixed `GET` or an explicitly host-reviewed fixed
  `POST`; arbitrary `POST` and mutations remain unavailable to MCP. Grants and outcome notices are session-only, so a hard crash still
  requires manual provider verification. These are local design-time operator integrations: the
  reviewed renderer request path resolves credentials into memory at dispatch time and does not claim
  server-side secret isolation. A connector MCP tool appears only after install, enablement, a saved
  credential, and exact-digest session authorization; disable, uninstall, revoke, or credential
  clearing removes it immediately. Provider strings remain untrusted data after normalization and
  must never be interpreted as instructions or authority to open URLs. Supabase Auth/Storage,
  provider-managed OAuth consent/refresh, connector binary streaming, and generated-app server
  connectors remain future work, and arbitrary publisher code or network access remains unavailable.

- Document the manual least-privilege credential gates for the 17 new connectors: scoped Neon API
  key; Sentry `event:read`; HubSpot `crm.objects.contacts.read`; Apollo `tags_list`; PostHog
  `insight:read` on US Cloud; Asana `workspaces:read`; Zotero `library:read` plus numeric user ID;
  HeyGen list-only API key; Linear OAuth `read`; OpenAI `models.read`; Box root-read-only access;
  Slack `channels:read`; Google Calendar `calendar.events.readonly`; SharePoint `Sites.Read.All`;
  Outlook Email `Mail.ReadBasic`; Outlook Calendar `Calendars.ReadBasic`; and Teams
  `Team.ReadBasic.All`. OAuth consent, tenant approval, sensitive-scope verification, and production
  token issuance remain manual release gates where the provider requires them. Gmail is deferred for
  restricted-scope and AI data-transfer review, Monday.com for its non-Bearer authorization scheme,
  Semrush for a stable production API and dedicated `ApiKey` injection scheme, and Replit until a
  documented stable public management API is selected.
- Add manifest API v2 validation for bounded parameter/result JSON schemas, the fixed
  `document.read`, `document.selection.read`, `document.variables.read`, and `file.save` permission
  vocabulary, and explicit exporter extension/MIME contracts. API v2 establishes a fail-closed host
  contract; it does not enable arbitrary JavaScript, generic network access, unrestricted document
  writes, or custom plugin UI, and every contribution still requires an exact reviewed host adapter.

- Add a trusted Expo React Native source exporter backed by a dedicated Compiler target instead of a
  WebView or React Native Web wrapper. The installed plugin exports an Expo Router + TypeScript
  project ZIP from File → Export, maps the supported design subset to native React Native controls,
  packages static images, omits font bytes until complete copyright/license/NOTICE evidence can
  accompany them, and
  records stable warnings for web-only or not-yet-native features in `EXPORT_WARNINGS.md`. Exporter
  execution now resolves the exact reviewed `adapterId` from a fail-closed host
  registry; OpenPencil never runs Expo, npm, Gradle, Xcode, or generated project code during export.
- Add a trusted Flutter source exporter backed by a dedicated Compiler target. After installing and
  enabling the bundled plugin, File → Export → Flutter Project emits a source-only Dart/Flutter project ZIP
  with native widgets, router source, portable image assets, fail-closed font-license warnings, and a
  fail-closed `EXPORT_WARNINGS.md`; OpenPencil never runs Flutter, Dart, Gradle, Xcode, CocoaPods, or
  generated project code during export.
- Add a real Simplified Chinese documentation locale at `/zh-cn/`, with translated entry,
  getting-started, feature, lowcode, plugin, Application Runtime, AI, and MCP guides; untranslated
  navigation continues to the canonical English pages instead of creating English placeholders.
  Documentation builds now package only English and Simplified Chinese by default; archived locale
  sources remain available through an explicit `DOCS_LOCALES` override.
- Add a detailed Application Runtime operations guide covering Supabase setup, authenticated CRUD,
  RLS review, readiness audits, environment isolation, static hosting, server-workflow deployment,
  troubleshooting, and a production checklist. The new Help menu opens a bundled application
  reader from both the web editor and the Tauri system menu, including fully offline installations
  with no dependency on the official documentation website. The reader bundles English and
  Simplified Chinese, follows the application language by default, and remembers an explicit
  per-guide language override.
- Add an Application Runtime readiness path for lowcode apps: inspect a Supabase project's
  normalized schema catalog through a credential-store-backed management token, derive combined
  client/server RLS requirements, audit deployment readiness from built-in AI/MCP, and keep
  per-document preview/staging/production targets isolated. Authenticated server workflows now
  compile into a separately delivered Supabase Edge Function bundle; static deploys exclude server
  code and print an explicit manual deployment recipe instead of uploading functions or secrets.
- Add a controlled local plugin store with strict declarative manifests, SHA-256/Ed25519 publisher
  package verification, engine compatibility checks, IndexedDB-backed install/enable state, exact
  digest pinning, and explicit app-bundle versus publisher-signature trust labels. Map and the new
  Chart and Rich Text plugins share generic Canvas, Compiler, property-panel, and AI/MCP dispatch.
  Clipboard Toolkit adds host-owned copy-as-text/SVG/JSX commands plus browser PNG copy that require
  an active selection; unsupported native PNG writes fail visibly. Tauri React Exporter packages
  generated React source and a Tauri scaffold into a
  ZIP without running `npm`, `bun`, `cargo`, generated code, or exposing filesystem/process access.
  Enabled modules are available from the canvas toolbar, Clipboard Toolkit actions live in the Edit
  menu, and Tauri source export lives in File → Export. Rich Text now has a structured visual block
  and inline-format editor instead of requiring raw JSON edits. Its Compiler runtime is now a real
  accessible editor with a bounded v1 toolbar, plain-text-only paste/drop, safe links, hidden form
  value/change-event output, and React-reconciliation isolation across parent re-renders.
  The opt-in `</> HTML` module adds a bounded source editor with synchronous non-interactive preview
  and emits the same content through a strict-CSP iframe without script or same-origin privileges.
  New opt-in Video and Table modules add reviewed public-HTTPS media configuration and bounded
  plain-text tabular data editing. Editor Compiler Preview requires explicit activation before a
  Video source or poster can make a remote request; native Expo/Flutter exports keep all three
  modules fail-closed without adding WebViews.
  The new opt-in Slide Menu module opens an accessible edge drawer or directional modal from a
  canvas-authored trigger, with bounded plain-text links, backdrop behavior, Escape dismissal,
  focus trapping and focus restoration. React/Vue/Tauri output uses a local portal runtime while
  Expo/Flutter output remains an explicit static fallback without a WebView.
  Schema v1 manifests can describe modules, commands, and exporters, but every contribution must
  match an exact reviewed host adapter. Plugin disablement blocks discovery and new actions without
  deleting or breaking existing module frames. Declarative manifests cannot inject JavaScript,
  HTML, CSS, WASM, native code, or permissions; the separately signed WASM compute channel below
  does not weaken this adapter boundary.
- Extend the controlled plugin store with an optional separately signed remote catalog, bounded
  reverified offline cache, publisher ownership plus key rotation/revocation, explicit update review
  and verified rollback, versioned local state migration, and portable `.fig` document dependency
  locks. Add publisher CLI commands for local manifest/catalog validation, Ed25519 signing, and
  verification while keeping private keys out of artifacts and executable packages outside the
  declarative catalog contract.
- Add a self-hostable plugin marketplace control plane with publisher/key/ownership records, signed
  submissions, explicit moderation and withdrawal/yank states, SQLite persistence, immutable
  content-addressed artifacts, deterministic stable/beta catalogs, a dynamic root-signed discovery
  snapshot, rollback protection, publisher-signed HTTP mutations, an admin CLI, and hash-chained
  audit checkpoints. The app exposes signed marketplace search, publisher trust, channel, cache,
  audit-head, and runtime-index status without depending on the official OpenPencil website.
- Add an opt-in executable plugin channel with separately publisher-signed runtime packages, a
  root-signed runtime index, exact declarative/runtime/capability grants, revocation, and bounded local
  audit. Production execution is limited to import-free WASM compute in a disposable Worker with
  signed time/memory/input/output quotas and read-only node/selection snapshots; JavaScript provenance
  can be verified but JavaScript/native/DOM/network/filesystem/shell/document-write execution remains
  unavailable. Add CLI validation/signing/verification for runtime packages and indexes.
- Add native text color for Button, Input, and Textarea nodes plus placeholder color for Input and
  Textarea, with canonical colors shared consistently by the property panel, canvas, Compiler,
  Figma-compatible projection, and AI/MCP tools.
- Add local desktop ACP coding-agent continuity for source-backed documents. A new or replacement
  session/thread ID is committed only after its first successful prompt. The local store also
  contains non-secret routing metadata (the local path or storage IDs, isolated scope, a SHA-256
  identity of the effective model and selected Remote MCP configuration, and timestamps), but never
  prompts, attachments, visible transcripts, agent history, credential secrets, or data inside the
  `.fig` document. Bindings are isolated by document, Design role, provider/agent, connection,
  effective runtime model configuration, credential profile, selected Remote MCP server configuration, and
  prompt-context version. An unsaved document remains process-local, its first save preserves the
  binding, and Save As starts a new document identity.
  Resume is gated by the agent's `session/resume` capability; an activated fallback is reported in
  chat together with the resumed, new, fallback, or failed status and session ID. Agents that
  advertise the unstable `session/list` capability also expose a bounded history picker. It
  cross-checks transient Agent results against local document/configuration bindings and labels
  them as exact, same-document with different settings, or source-unverified instead of trusting
  repeated Agent titles or a shared working directory. Non-exact candidates require confirmation.
  Manual resume uses a strict candidate connection and swaps the active chat only
  after success, so failure never silently creates a thread or discards the current binding. Failed
  durable ID writes leave the live session usable but show that restart continuity is not guaranteed. The
  agent-owned catalog is not persisted locally, and resume restores agent context rather than the
  visible transcript. Clear waits for local persistent deletion and reports failures without
  deleting agent-owned history, while Force stop preserves an existing resumable binding. Sessions
  expire after 90 days and are capped at 8 per document and 200 globally; unreferenced routing
  aliases are pruned after 90 days. Direct API providers do not read ACP records, and the visible
  transcript is not restored across application restarts.
- Import validated TTF, OTF, and WOFF files from Font settings in the desktop app, retain their
  internal family/style identity and license evidence in a checksummed local cache, prefer them over
  same-named system or downloaded faces after restart, and recompile previews from the same bytes
  used by CanvasKit.
- Audit and repair validated form controls with `audit_form_controls` and
  `ensure_form_value_bindings`, including page-scoped state creation, stable names, type-safe
  defaults, dry runs, optimistic concurrency, and one undo transaction. The Bindings inspector also
  offers a one-click page-state repair for a selected validated control.
- Add bounded MCP audits for compiler-effective page routes (`read_page_route`,
  `update_page_route`, and `audit_navigation`), live CanvasKit font effectiveness
  (`audit_font_rendering`), and stored/referenced image integrity (`audit_image_assets`).
- Add native object/array MCP arguments, machine-readable structured results and request diagnostics,
  plus bounded multi-node reads and atomic writes with `read_lowcode_nodes`, `read_motions`,
  `update_lowcode_nodes`, and `reparent_nodes`; component instances can also be created directly at
  an exact parent/index.
- Add an Interaction states inspector for buttons and form controls to author
  hover, focus, active, and disabled fill, stroke, opacity, and corner-radius
  overrides. Compiler export also accepts legacy solid state paints with string
  colors without turning them transparent.
- Audit font-license evidence from the built-in MCP with `audit_font_licenses`, including current
  page, subtree, or all-page scans; base and style-run usage locations; exact bundled-font SHA-256
  verification; self-reported OpenType license and embedding metadata; intended-use permissions;
  and conservative `pass`, `review`, or `block` decisions. The Typography font picker now exposes
  matching Free, Open license declared, License required, and License unknown badges plus a license
  filter. Official Google Fonts, Fontsource, Bunny Fonts, and Fontshare catalog policies establish
  free-use status without claiming an exact artifact license, while visible local fonts are lazily
  inspected for embedded open-license declarations or explicit restrictions.
- Verify live text-node font assignment and CanvasKit effectiveness from the built-in MCP with
  `check_font`, including style-run overrides, exact face loading, resolver source, synthesized
  weight/slant degradation, pending resolution, exhausted glyph coverage, and explicit
  renderer-unavailable results.
- Add opt-in AI capability controls: OpenRouter's provider-hosted web search with source cards,
  OpenAI Responses Code Interpreter with generated-file references, and trusted Remote Streamable
  HTTP MCP servers with credential-store-backed Bearer tokens, per-model selection, namespaced tools,
  bounded Direct transport/discovery/results, per-call Direct approval, explicit ACP policy
  delegation, and deterministic cleanup. Existing model settings migrate with every optional
  capability disabled.
- Attach bounded, metadata-scrubbed PNG, JPEG, or WebP references—or an explicitly selected canvas
  region—to built-in AI chat. Vision-capable Design models receive the image directly; otherwise a
  configured Vision role produces a grounded brief for the Design agent. ACP agents negotiate image
  support before prompting, reference thumbnails remain visible in chat, and generated output stays
  editable without automatically replacing the source image.
- Compose MotionSpec v3 tracks with deterministic `replace`, `add`, or `accumulate` semantics,
  bounded weights, and stable priorities shared by Canvas preview, fixed-time export, generated React
  projects, and the public runtime SDK, while leaving v1/v2 serialization and playback unchanged
  until an explicit upgrade.
- Choreograph page- or frame-owned scene timelines from descendant tracks with enter, exit, and
  manual sequences; markers, zoom and snapping; multi-cue translate/scale editing; Auto Keyframe;
  owner-scoped runtime cleanup; and one undo entry per authoring gesture.
- Capture parameterized multi-node Motion recipes with stable role assignments, compatibility
  previews, atomic application, personal JSON exchange, and shared UI, CLI, MCP, and AI validation.
  Applying a recipe expands every role into complete document Motion snapshots.
- Drive direct-progress-safe tracks from bounded scroll, pointer, drag, visibility, page/document
  state, or variable inputs. Drivers support ranges, dead zones, clamping, reversal, accessible
  reduced-motion behavior, owner-scoped listeners, frame-coalesced updates, and deterministic cleanup.
- Upgrade v2 polyline Motion paths to bounded MotionSpec v3 cubic Bézier segments and edit their
  endpoints and control points directly on the Canvas. The overlay accounts for nested transforms,
  pan, and zoom; supports pointer drag, keyboard nudge, Escape rollback, segment add/remove, and
  direction following; and records one undo entry per gesture without mutating static geometry.
- Author MotionSpec v3 structured channels for indexed paints and effects, gradient stops,
  independent corners, text reveal, variable-font axes, and topology-compatible vector morphs.
  Canvas, masks, generated React output, tools, and persisted snapshots share node-aware capability
  checks and deterministic fallback warnings; unsupported imported values remain removable.
- Author prototype navigate, back, open-overlay, and close-overlay connections with click or bounded
  after-delay triggers, interruption policy, forward/reverse playback, and generated route behavior.
  OpenPencil Smart Match pairs layers through explicit stable keys, interpolates matched geometry,
  dissolves unmatched layers, and uses deterministic ambiguity and reduced-motion fallbacks.
- Import signed Ed25519 Team animation libraries with engine-version constraints, bounded tokens,
  parameterized entries, deterministic update diffs, explicit accept/reject review, verified history,
  rollback, and reproducible application snapshots through the app, CLI, MCP, and built-in AI tools.
- Publish `@open-pencil/motion-runtime`, an SSR-safe, tree-shakeable scheduler with framework-neutral
  prepared plans, DOM/Vanilla adapters, Vue bindings, continuous drivers, structured inspection, and
  lifecycle cleanup. Generated React projects embed its public sampling and frame-loop kernel at
  compile time, preserving portable zero-dependency output instead of maintaining a second animation
  engine. Its DOM adapter reveals Unicode text by code point and fails closed for undeclared indexed
  paint, gradient-stop, structured-effect, text, or vector-morph capabilities.
- Author bounded generated-effect layers with deterministic noise, shimmer, scanline, and particle
  presets. Effects accept only strict time, seed, color, density, and budget data—never shader source,
  arbitrary code, or URLs—and render through CanvasKit, fixed-time animation export, and an isolated
  generated React Canvas2D runtime with reduced-motion static/disabled fallbacks. The complete
  effect snapshot round-trips through `.fig`, `.pen`, clipboard, components, AI, and MCP.
- Collaboratively edit MotionSpec v3 timelines with stable keyframe identity and fine-grained Yjs
  track/keyframe maps instead of whole-motion last-write-wins updates. Concurrent field edits merge,
  delete tombstones survive stale reconnects, local timeline undo/redo is origin-scoped, bounded
  deterministic conflict notices are visible in the collaboration panel, and node/scene timelines
  show sanitized remote playheads and selections while v1/v2 retain their legacy wire shape.
- Export node-local or scene Motion through a deterministic integer-microsecond frame planner and
  the reference sampler to fixed-canvas PNG sequences or a built-in byte-stable GIF89a encoder.
  Browser exports add capability-gated WebCodecs VP8 WebM, while CLI and MCP discover real FFmpeg
  WebM/MP4 encoders. The app panel and interactive CLI report progress; MCP reports progress when a
  client supplies a token. UI, CLI, MCP, and built-in AI propagate cancellation through their active
  rendering/encoding paths. All paths bound duration, loops, frames, dimensions, and pixel work;
  expose explicit reduced-motion policy; and verify output signatures. Tauri and encoded Node files
  use atomic no-clobber publication; Node PNG sequences exclusively claim a destination and publish
  each frame without replacement; browser exports delegate filename collisions to the download
  manager after encoding succeeds. Failed or cancelled work cleans only artifacts owned by the
  export.
- Inspect detached Figma Motion readback snapshots, import the verified native numeric intersection,
  compare add/update/remove, timeline growth, and ownership changes, and generate plan-only, official
  Plugin API script, or guarded apply/clear snapshot artifacts from the CLI without claiming direct
  Figma Desktop control or writing undocumented raw timeline bytes.
- Inspect whether a node's canonical `MotionSpec` fits the verified Figma Motion Plugin API Beta
  subset, preserve a strict shared-plugin-data mirror for the development plugin, and generate or
  apply a fail-closed native adapter through the inspector, CLI, MCP, or Figma plugin. The adapter
  defaults to owned-track replacement, shared-timeline growth protection, readback verification,
  and rollback instead of writing undocumented native timeline bytes into `.fig` archives.
- Round-trip bounded MotionSpec metadata through imported `.pen` sources with a source-preserving,
  fail-closed Pen package/Core IO writer and CLI conversion path; foreign or future metadata stays
  inert and intact, while unsupported non-Motion edits must be saved as `.fig`.
- Browse categorized Motion presets with search and favorites, preview a preset from pointer or
  keyboard focus without editing the document, save and manage personal presets, edit their
  description/category or update them from the current selection, and import/export strictly
  validated portable JSON while keeping favorites local. Publish, import, check, explicitly accept,
  and remove readonly shared preset libraries from file or URL sources in the app and CLI; accepted
  presets remain complete snapshots, and update checks never replace them implicitly.
- Apply a complete validated MotionSpec to one or many nodes through AI/MCP, including atomic
  instance-safe undo and optional stagger direction and rhythm.
- Author bounded, code-based node motion with reusable presets, multi-selection inspector controls,
  non-destructive CanvasKit preview, reduced-motion policies, and AI/MCP read-write tools.
- Edit single-node motion on a visual multi-track timeline, including keyframes, channel values,
  track rename/reorder/duplicate, keyframe duplicate/pointer drag, per-segment easing, iterations,
  direction, fill, exit behavior, and a scrubbable canvas playhead. Track renames update matching
  lowcode Motion references atomically.
- Explicitly upgrade MotionSpec v1 to v2 and author bounded transform-origin, geometry, paint,
  stroke, blur/shadow, path/progress/auto-rotate, vector-trim, auto-layout, physical easing, and
  per-keyframe easing channels while preserving v1 compatibility and cross-format snapshots.
  Advanced controls now disable paint, corner-radius, stroke-width, trim, and layout channels that
  cannot affect the selected node, explain the required capability, and still allow imported
  unsupported channels to be removed. Imported outline-only VECTOR geometry keeps stroke-color
  animation, while width and trim stay static unless an editable centerline is available.
  BOOLEAN_OPERATION layers without resolved final `fillGeometry` now disable preset, preview, and
  timeline authoring, emit a Motion lint diagnostic, and still allow an existing MotionSpec to be
  cleared.
- Compile node motion into generated React projects with CSS keyframes for mount/loop tracks and a
  small WAAPI runtime for hover, press, focus, click, and in-view triggers.
- Play, stop, toggle, or await all motion tracks or one named track from lowcode events and
  workflows; generated React apps route those actions through the bounded WAAPI motion runtime.
- Sample Motion through a prepared framework-neutral reference plan with trigger, explicit track-id,
  or all-track selection, plus per-track progress, contribution, completion, exit, and visual
  diagnostics for editors and runtime inspection.
- Inspect generated development previews with Motion Debug, including structured track state,
  source, trigger, progress, current time, reduced-motion policy, exit behavior, and compile warnings.
- Export selections, pages and documents as editable PowerPoint (`.pptx`) files from the File menu, CLI and SDK: text, rectangles, ellipses and lines stay native editable elements, while gradients, masks, blends, vectors and icons fall back to embedded images.
- Figma-style Assets panel browsing with component thumbnails, grid/list views, page grouping, context actions, and drag-to-canvas insertion.
- Import HTML, CSS, Tailwind, and JSX as editable documents from the app, CLI, and SDK, and export standalone browser-ready HTML with compiled CSS and optional external assets.
- Drag image files into the desktop app and paste Figma layers with their remote image fills.
- Import dropped SVG files as editable vector layers, preserving compatible multi-color fills and transparent paints. (#386, #392, #394, #446).
- Convert image layers into editable vectors with Recraft or fal.ai from the canvas context menu. (#322).
- Browse document components as thumbnails or a list in the Assets panel, group them by page, and drag instances directly onto the canvas. (#424).
- Create centered frames from Figma-style device and asset presets, or resize selected frames to a preset while preserving their names. (#418).
- Manage pages by renaming, deleting, and dragging to reorder them in the Pages panel.
- Create text by dragging a fixed-size text box or clicking for auto-width text.
- Create and edit layout grids for frames and components, including columns, rows, counts, gutters, margins, visibility, and grid size.
- Inspect and edit constraints, stroke caps and joins, corner smoothing, shared styles, component properties, blend modes, masks, advanced typography, text resizing, and per-node export settings from the Design panel.
- Edit solid fill colors by entering hex values directly in the Design panel.
- Use Figma-style number-key opacity shortcuts: `1`–`9` set 10%–90%, `0` sets 100%, and two-digit sequences set exact values.
- Access more common design actions from the browser and desktop menus, including visibility, locking, masks, flipping, components, z-order, distribution, selection, rulers, multiplayer cursors, and Settings.
- Find overlapping layers and overflowing children from the CLI, AI tools, and MCP.
- Target a specific open document and page from live CLI and MCP automation, including sessions with multiple documents.
- Save lowcode buttons, inputs, forms, lists, and the other interactive controls as editable Figma-native visual layers while retaining their OpenPencil semantics for round-trip import.
- Let built-in AI and Design JSX create all ten real lowcode control node types with validated interactive properties instead of visual Frame substitutes.
- Connect local MCP clients through automatically discovered private Unix sockets on macOS and Linux, with localhost TCP fallback. (#338).
- Test OpenAI-compatible provider connections from AI settings with clearer setup errors.
- Configure separate Design, Review, Fast, and Vision models, providers, endpoints, and credentials from AI settings.
- Manage AI, agent, media, and storage credentials from unified Settings. Remembered credentials use
  app-local IndexedDB records encrypted with AES-GCM and a non-extractable WebCrypto key; browsers
  can still choose session-only memory. Tauri development and release builds select encrypted app
  storage directly rather than falling back after a native-store failure, and do not read macOS
  Keychain by default. Existing Keychain items are neither migrated nor deleted, so users must
  reconnect integrations or enter their credentials once after upgrading.
- Connect an S3-compatible storage workspace with local-first saves, background synchronization, embedded `.fig` previews loaded without downloading full documents, and automatic refresh while the workspace is active.
- Add Japanese localization and improve menu translations across the existing supported languages. (#367).
- Author richer Design JSX with components, instances, variables, gradients, structured fills, shadows, blur effects, masks, and inline SVG vectors.
- Build custom property panels and document workspaces with new Vue SDK number fields, bindable values, property sections, responsive grids, segmented controls, property lists, color models, fill controls, gradient primitives, and the headless `useDocumentWorkspace()` composable.
- Use `useColorModel()` in the Vue SDK for extensible color formats and shared RGB, HSL, HSB, and OkHCL channel behavior.
- Add dedicated SceneGraph, Pen, Kiwi, Fig, and DOM/CSS packages with documented public entry points for building on OpenPencil.

### Changed

- Bound VitePress production-build memory by building language partitions in separate processes,
  streaming LLM-friendly output, and sharing one refresh-aware `vue-component-meta` checker across
  independently bundled SDK data loaders instead of retaining fourteen full TypeScript programs.
- Keep generated Motion runtimes in sync with live `prefers-reduced-motion` changes without
  restarting unaffected animations or losing controlled, stopped, or active transient-trigger
  state.
- Keep the public Motion Runtime SDK synchronized with live reduced-motion changes for SDK-owned
  Vanilla and Vue runtimes, preserving logical progress, playback state, and playback rate while
  restoring authored DOM state for disabled plans. Injected runtimes remain host-owned.
- Exercise Canvas reference sampling against generated CSS and WAAPI output in browser parity tests,
  with repeatable 100/500-target prepared-sampling baselines and structured runtime cleanup tests for
  completed animations, token changes, and removed subtrees.
- Verify Motion Debug in the real Tauri preview: an initially empty runtime reports ready state, and
  adding the first mount track automatically reloads once and exposes its completed runtime entry.
- Preserve imported Figma interaction, media, animation, and timeline payloads byte-for-byte across
  `.fig` saves, including nested opaque fields and schema-aware node reference remapping. A
  fail-closed adapter can generate Figma Motion Plugin API operations for the supported single-track
  mount subset; OpenPencil does not synthesize undocumented native timeline payloads.
- Render lowcode Button labels on the canvas, preserve static List children in generated previews, and keep Line SVGs at their authored geometry.
- Embed and align real offline CJK glyph outlines for Figma-compatible lowcode labels, and avoid incomplete glyph caches in `.fig` and Figma clipboard exports so translated controls remain visible and correctly positioned without selection.
- Match Figma-compatible Button labels to OpenPencil's dark control foreground instead of forcing white text.
- Connect ACP agents to OpenPencil through the stdio MCP bridge, expose dynamic session model and
  reasoning controls, surface terminal startup failures, and report ACP model, token, and context
  diagnostics without mixing them with local tool execution counts.
- Preserve ACP commentary, tool, and final-answer ordering, hide internal Guardian reviews, retain
  concrete tool errors, display successful MCP result envelopes accurately, and give long-running
  MCP tools enough time to finish without false failures.
- Add Figma-style page management, including rename/delete actions and drag-and-drop page reordering.
- Add DOM/CSS import and authoring across the app, CLI, and SDK, plus Tailwind and standalone HTML export.
- Add richer Design JSX authoring for components, variables, structured fills, gradients, shadows, and blur effects.
- Add overlap analysis for layout collisions and overflowing children through CLI, AI tools, and MCP.
- Add saved per-node export settings, desktop image drag-and-drop, and document/page targeting for live automation.
- Publish SceneGraph, Pen, Kiwi, Fig, and DOM/CSS through dedicated workspace package boundaries.
- Add compiler support for persisted static lowcode SEO metadata in generated `index.html`, including title, description, Open Graph image, canonical URL fields, `.fig` / `.pen` import coverage, and AI ToolDef read/write support.
- Drop unsafe generated lowcode canonical URLs when compiling imported or stale metadata.
- Skip invalid imported lowcode Supabase configs at compiler collect time instead of emitting a broken Supabase runtime.
- Add lowcode deploy lifecycle labels for preview, staging, and production, plus local deploy history and provider dashboard rollback links.
- Let lowcode deploy history restore provider, environment, site, UI kit, and i18n fields for a guarded redeploy/rollback draft.
- Store lowcode deploy artifact labels and structured build option snapshots in local deploy history.
- Add local lowcode deploy target presets so preview, staging, and production can remember provider/site/build options without storing tokens.
- Add a local lowcode rollback contract for provider API readiness without invoking provider rollback APIs.
- Add a Netlify deploy restore action backed by the site-scoped Netlify restore API.
- Add Netlify deploy restore live ACK steps with token-safety checks for manual provider verification.
- Tighten Cloudflare Pages rollback readiness around explicit account/project target metadata.
- Describe Vercel rollback readiness through project, production alias, and owner-scope metadata gaps.
- Show missing rollback contract fields in lowcode deploy history rows without invoking provider APIs.
- Emit lowcode design-token CSS variables from SceneGraph variable modes into generated `src/index.css`, including `.dark` mode blocks.
- Resolve lowcode design-token aliases across variable collections by matching mode names when mode ids differ.
- Skip hidden lowcode design-token variables in generated CSS while still resolving public aliases to them.
- Fall back to static styles and warn when generated lowcode nodes bind directly to hidden
  design-token variables.
- Add an emitted lowcode theme runtime with `LowcodeThemeProvider` / `useTheme`, and a Preview pane light/dark theme switch.
- Let the desktop compiler preview collapse to a persistent restore rail, preserve nested free-positioned scene coordinates in generated code, and keep HUG icon rows at their designed size.
- Localize the Analytics, Custom head/CSS, Workflows, Translations, and Libraries document controls, including validation, graph diagnostics, statuses, accessibility labels, and CSP feedback, for Simplified Chinese.
- Add a generated-app light/dark theme switch when lowcode theme CSS is emitted.
- Let generated lowcode theme switches be hidden or positioned at publish time.
- Let generated lowcode runtime UI surfaces consume theme/design tokens, including the
  theme switch aliases and semantic token classes for toast and confirm runtimes.
- Use semantic destructive token classes for generated lowcode validation error text.
- Use semantic token classes for generated validated-field invalid states and overlay
  backdrops.
- Inject generated runtime Tailwind theme tokens whenever compiled runtime or IR classes use
  semantic color utilities, and migrate generated switch controls to semantic colors.
- Use semantic `accent-primary` styling for generated radio and checkbox option inputs.
- Add browser preview smoke coverage for generated lowcode runtime UI token surfaces, and
  pre-optimize zustand in the lowcode preview dev server.
- Verify generated lowcode runtime UI changes through the full check gate and the existing
  Tauri preview pane mock.
- Clarify that preview bridge selection overlay colors are editor-only chrome, independent
  from generated app theme tokens.
- Verify generated lowcode runtime UI changes through the full Playwright app/browser suite.
- Verify the real Tauri automation bridge can connect to the debug app and inspect the
  lowcode preview pane.
- Document the real Tauri lowcode preview automation ACK flow and verify automation
  spawn/file helper contracts.
- Add a repo-local Tauri MCP lowcode preview ACK helper for repeatable real-webview
  automation checks.
- Add engine-level contract coverage for the repo-local Tauri MCP lowcode preview ACK helper.
- Report invalid `callWorkflow` argument contracts in the lowcode workflow graph diagnostics.
- Focus the source workflow action when jumping from actionable workflow graph issues.
- Reject unsafe URL protocols in lowcode Custom CSS before editor/tool persistence and
  generated CSS emission.
- Reject unsafe URL protocols in lowcode Custom Head style snippets before editor/tool
  persistence and generated HTML emission.
- Reject unsafe URL protocols in lowcode Custom Head meta refresh URLs before editor/tool
  persistence and generated HTML emission.
- Skip invalid imported lowcode analytics configs at compiler collect time instead of emitting
  a broken analytics runtime.
- Add a Figma Web CDP debug script and update Figma reference tests to work with the current
  browser canvas structure.
- Fix package tarball smoke coverage for the private compiler dependency, isolated npm
  cache use, compiler ESM output, and runtime package dependencies.
- Map simple bound lowcode fill color variables to generated `var(--op-...)` inline styles.
- Map more bound lowcode theme variables to generated inline styles, including stroke colors,
  scalar opacity, translucent solid fills, multi-layer solid backgrounds, and component usage
  roots, with warnings for missing design-token bindings.
- Map bound multi-stroke token colors to generated layered CSS shadows, including composition
  with existing drop and inner shadow effects.
- Make lowcode multi-stroke token fallback geometry explicit by documenting/testing
  inside/center/outside shadow placement and warning when independent side weights or dash
  patterns require a safer `borderColor` fallback.
- Map component child token overrides and gradient stop color bindings to generated inline
  styles while keeping the existing className component override channel intact.
- Preserve gradient stop color token bindings through `.fig` export and re-import using Figma
  `stopsVar` data plus the OpenPencil bound-variable fallback.
- Read gradient stop color token bindings from raw `.fig` `variableConsumptionMap` entries while
  keeping export on the schema-safe `stopsVar` path.
- Add an explicit opt-in Kiwi dynamic field mapper for gradient stop variable bindings while
  keeping `.fig` export schema-safe by default.
- Document and test `bind_variable` / `unbind_variable` support for gradient stop color token
  paths such as `fills/0/gradientStops/0/color`.
- Add editor gradient-stop variable binding controls so fill stops can bind, create, display,
  and detach color variables from the gradient editor.
- Add browser E2E coverage for gradient-stop variable binding controls, including existing
  variable binding, variable creation, detaching, and manual color edits.
- Split lowcode Inspector controls into Bindings, Events, Validation, and Advanced groups, with highlighted filter matches and an empty filter result state.
- Add collapsible, remembered Inspector sections to the Design panel so dense property groups can be folded without changing document data.
- Add an Inspector property filter to narrow dense Design panel groups by section name or common control keywords.
- Add user-facing lowcode app onboarding docs covering preview, compile, build, Supabase overrides, i18n, shadcn/ui, and deploy.
- Add lowcode analytics support for GA4, Plausible, and PostHog, including persisted document config, `trackEvent` actions, generated runtime helpers, and onboarding docs.
- Add lowcode analytics authoring controls for document-level provider config and `trackEvent` property expressions.
- Add lowcode analytics authoring guards for provider-specific ids, endpoints, missing provider hints, and duplicate event property names.
- Add optional lowcode analytics page-view tracking for initial loads and multi-page route changes.
- Add lowcode analytics provider help links and GUI ACK steps for GA4, Plausible, and PostHog authoring.
- Add lowcode analytics privacy gates for browser Do Not Track and generated-app consent flows.
- Add a lowcode workflow graph diagnostic summary that counts workflow calls, surfaces missing
  workflow references and cycles, and keeps the existing inline workflow runtime semantics.
- Let the lowcode workflow graph summary jump from issues or per-workflow call counts to the
  corresponding workflow editor row.
- Add a local-only expand/collapse control for lowcode workflow graph details.
- Cover lowcode workflow graph expand/collapse and issue jump behavior with a targeted Playwright
  regression.
- Show lowcode workflow graph event entrypoints from node events, including workflows with no
  event entry.
- Let workflow graph entrypoint diagnostics jump to the source node's event editor.
- Focus the specific source action row after jumping from a workflow graph entrypoint.
- Group lowcode workflow graph details into readonly Entries, Calls out, and Called by sections.
- Flash a temporary highlight on workflow and action rows reached from workflow graph navigation.
- Add a compact readonly HTML map for lowcode workflow graph nodes and call edges.
- Show entry, incoming, outgoing, action, and issue badges directly on lowcode workflow graph map nodes.
- Add local All, Issues, and Entries filters to the lowcode workflow graph map.
- Show workflow entrypoint source labels and Source jumps directly on lowcode workflow graph map nodes.
- Show overflow counts when a lowcode workflow graph map node has multiple entrypoint sources.
- Let lowcode workflow graph map nodes expand overflow entrypoint sources with per-source jumps.
- Add ARIA state and Escape collapse support to lowcode workflow graph map source lists.
- Return focus to the workflow graph map source toggle after Escape collapses its source list.
- Polish workflow graph map source lists with clearer row grouping and source-specific jump labels.
- Show workflow graph map node/edge counts and separate node-empty from edge-empty states.
- Add source-specific workflow graph map node/edge jump labels and explicit keyboard activation.
- Add a source jump for missing workflow graph map edges so authors can quickly fix bad calls.
- Show compact workflow graph issue groups inside the graph map with keyboard-accessible jumps.
- Show a clean workflow graph map issue state when no graph issues are present.
- Show filter-aware workflow graph map issue summaries and clean-state copy.
- Show missing/cycle issue type counts and pluralized node issue badges in the workflow graph map.
- Group workflow graph map nodes into readonly Issues, Entries, and Called columns.
- Group workflow graph map edges into readonly Calls and Missing sections.
- Show structured From / To labels for workflow graph map edge rows.
- Show workflow graph map edge action ids as readonly edge metadata.
- Let workflow graph map edge action badges jump back to the source workflow row.
- Focus the exact source workflow action row from workflow graph map edge action badges.
- Show source action kind and branch context badges on workflow graph map edges.
- Let workflow graph map node and edge groups collapse to keep dense maps scannable.
- Add local workflow graph map search across workflow names, ids, edge targets, and action metadata.
- Add keyboard focus and Escape clearing behavior for workflow graph map search.
- Add local Enter navigation and active-match highlighting for workflow graph map search results.
- Let workflow graph map search jump from the active result with Ctrl/Cmd+Enter.
- Show the active workflow graph map search result position in the search summary.
- Keep active workflow graph map search results in view while cycling matches.
- Add a generated lowcode analytics consent banner when tracking requires consent.
- Persist generated lowcode analytics consent choices locally and expose a preferences reopen control.
- Add a generated lowcode analytics preference center with Necessary and Analytics categories.
- Add configurable lowcode analytics consent banner copy and privacy-policy links.
- Add explicit noopener protection to generated lowcode analytics privacy-policy links.
- Drop unsafe generated lowcode analytics privacy-policy links when compiling imported or stale documents.
- Add a configurable default checked state for the generated lowcode Analytics consent category.
- Add an EEA-style lowcode analytics consent preset that starts generated apps in opt-in mode.
- Add controlled lowcode custom head and CSS output for generated apps without enabling arbitrary JavaScript.
- Add root-level lowcode Custom Head/CSS authoring controls for structured meta/link/style tags and app CSS.
- Add Custom Head/CSS CSP and deploy-provider ACK guidance for Netlify, Vercel, and Cloudflare Pages.
- Add Custom Head/CSS pre-deploy CSP risk hints for inline styles, external stylesheet/preload links, and external CSS resources.
- Guard Custom Head/CSS link `href` protocols in the editor, AI ToolDef, and generated
  `index.html` output.
- Add a generated lowcode onboarding demo fixture covering Supabase, validation, workflows, Stripe checkout, analytics hooks, i18n, shadcn/ui, and custom head/CSS without real external credentials.
- Add Stripe checkout lowcode actions that POST JSON to an author-owned endpoint and redirect to a returned checkout URL without storing Stripe secrets in documents or generated apps.
- Add a Supabase Edge Function checkout template for the lowcode onboarding demo that reads Stripe keys from server-side environment variables only.
- Extend the Supabase checkout template to verify authenticated users, create or reuse Stripe Customers, and upsert `billing_customers` before redirecting to Checkout.
- Add Stripe customer portal lowcode actions that POST JSON to an author-owned endpoint and redirect to a returned billing portal URL.
- Add a Supabase Edge Function customer portal template and onboarding demo button for server-created Stripe billing portal sessions.
- Wire the customer portal template to Supabase Auth and server-side `billing_customers` lookup instead of trusting browser-provided customer ids.
- Let Stripe checkout and customer portal actions optionally attach the current Supabase bearer
  token so generated apps can call authenticated billing endpoints.
- Require generated Stripe checkout and customer portal redirects to resolve to http(s) URLs.
- Require demo Stripe Edge Function `PUBLIC_SITE_URL` values to resolve to http(s) origins before building Checkout and Customer Portal return URLs.
- Require demo Stripe Edge Function `SUPABASE_URL` values to resolve to http(s) origins before calling Supabase Auth, REST, or RPC endpoints.
- Normalize demo Stripe checkout plan metadata from the same allowlist used for price lookup and require configured Stripe price ids.
- Reject protocol-relative Customer Portal `returnPath` values in the demo Stripe Edge Function template.
- Require demo Stripe Edge Function secret/config environment variables to match Stripe id
  prefixes before calling Checkout or Customer Portal APIs.
- Add a Supabase Edge Function Stripe webhook template for checkout and subscription lifecycle events with signature verification and durable `billing_events` idempotency.
- Require the demo Stripe webhook signing secret environment variable to match Stripe's
  webhook secret prefix without embedding example secrets.
- Add a Supabase billing schema template for Stripe customer mappings, subscriptions, and durable webhook event idempotency.
- Add regression coverage that reads the checked-in lowcode onboarding `.fig` fixture and compiles it with the current generator contract.
- Cover every demo Stripe service-role RPC with regression checks for fixed `search_path` and revoked public/authenticated access.
- Add a Supabase service-role RPC template for Stripe subscription webhook events that records the event and upserts subscription state in one transaction.
- Add a Supabase billing entitlement read-model template that refreshes app-readable subscription access in the same webhook transaction.
- Add a Supabase billing invoice read-model template and Stripe invoice webhook RPC for paid/failed invoice history.
- Add Supabase billing payment and refund read-model templates with Stripe payment/refund webhook RPCs.
- Add a Supabase billing orders read-model template that summarizes invoice, payment, and refund webhook updates.
- Harden the Supabase Stripe billing read-model schema for out-of-order webhook delivery by avoiding cross-event foreign keys on invoice subscription and refund payment intent ids.
- Add a Supabase billing dispute read-model template and Stripe dispute webhook RPC for charge dispute status tracking.
- Add a Supabase billing tax summary read-model template that records Stripe invoice automatic tax and total tax amounts.
- Add a Supabase billing usage summary read-model template that records Stripe invoice line quantity and subscription item snapshots.
- Add a Phase 5 lowcode operator ACK checklist covering analytics, custom head/CSS, onboarding, Stripe paid actions, and billing webhook read models.
- Add JSX authoring support for components, component sets, and instances.
- Add type-validated `bindVariable`/`unbindVariable` with event emission and indexed binding format (`fills/N/color` instead of `fills[N]`).
- Add `unbind_variable` MCP tool for removing variable bindings.
- Add optional `loading="lazy"` / `loading="eager"` emission for lowcode image nodes.
- Add `<picture>` / `srcSet` emission for responsive lowcode image nodes.
- Add conic-gradient emission for imported Figma angular gradient fills.
- Approximate imported Figma diamond gradient fills in compiled CSS.
- Emit node-level Figma blend modes as Tailwind `mix-blend-*` utilities.
- Warn when lowcode compile skips unsupported visual fills, masks, or blend semantics.
- Add browser pixel smoke coverage for lowcode preview image, background, and blend rendering.
- Preserve axis-aligned crop transforms for imported Figma image fills in compiled background CSS.
- Stack multiple imported visual fills as one compiled CSS multi-background.
- Serve compiled image-fill assets from the lowcode preview dev server.
- Scope lowcode workflows to an optional page so the workflow editor validates page-local state against the intended page instead of the currently selected page.
- Validate lowcode controlled form fields on change with the next input value while preserving writer-first user `onChange` composition.
- Add opt-in lowcode FORM validation summaries for aggregated field errors.
- Add runtime coverage and workspace dependencies for lowcode shadcn Tabs/Accordion state bindings.
- Add async remote custom validators for lowcode form fields.
- Add a lowcode validation authoring panel and support validated fields inside components.
- Debounce lowcode remote field validation on blur and cancel stale remote requests before applying field errors.
- Validate lowcode form validation configs at the AI tool boundary before persisting interactive props.
- Avoid emitting localStorage persistence helpers when no document state is marked persistent.
- Choose Freeform, vertical, horizontal, or grid flow directly from the contextual Layout section, with sizing grouped alongside it and current Layout guide terminology.
- Redesign the editor chrome and Design panel with denser aligned controls, clearer selection and section states, improved menus and overlays, consistent light/dark theming, and better keyboard and screen-reader behavior.
- Simplify AI model setup with clearly separated model, connection, and advanced settings, automatic compatibility and output-limit defaults for recognized models, and an explicit custom-model option.
- Choose Auto width, Auto height, or Fixed size directly from the Layout section for text layers.
- Scale the Layers panel to documents with thousands of nodes through virtualized rows, faster incremental updates, stable expansion, range selection, and scroll-to-selection.
- Open and save large `.fig` documents substantially faster while preserving original metadata and user edits, and switch between large pages with fewer Layers panel stalls. (#420).
- Resolve fonts before text appears, with language-aware CJK and Arabic fallbacks, character-specific remote subsets, and more reliable rendering as fonts load.
- Use MiniMax M3 as the default model for MiniMax AI connections. (#431).
- Center empty and setup states consistently across panels, dialogs, and workspaces.

### Fixed

- Keep desktop startup clean when optional MCP automation is unavailable, retain startup diagnostics for MCP-dependent features, and load JSX syntax highlighting without browser globals.

- Preserve Figma’s imported glyph outlines through layout and appearance updates so text keeps its intended weight and shape.
- Keep swapped image avatars and thin stepper dividers at their effective imported size and position.
- Scale proportion-constrained `.fig` instance geometry through fixed wrapper layers so imported logos and icons retain their intended size.
- Match Figma auto-layout spacing, padding, min/max constraints, scalar variable bindings, CanvasKit-shaped generated text, imported text bounds, and nested instance geometry more closely.
- Match Figma Plugin API vector path and network editing, including bounds, transforms, winding rules, region fills, validation, and handle mirroring. (#444).
- Let AI and MCP tools create arbitrary vectors from SVG path data, validating input without leaving blank layers behind. (#440).
- Improve AI design accuracy by exposing every supported shape, including visible stroke colors and weights in visual descriptions, and accepting supported inline SVG attributes without false warnings. (#445, #447, #448).
- Restore Anthropic AI connections in the web app instead of failing with a browser endpoint error. (#438).
- Reconnect live CLI and automation sessions automatically after an unexpected bridge disconnection.
- Keep MCP file access inside its configured root when paths contain symlinks, and strengthen local authentication token checks. (#338).
- Start globally installed ACP agents correctly on Windows instead of reporting them as unavailable. (#361).
- Resume pending cloud saves after restarting the app or temporarily losing credentials, without reviving deleted documents or overwriting newer local changes.
- Handle S3 object listings, pagination, and escaped names more reliably, and explain required CORS setup without modifying bucket rules.
- Show HTML, CSS, Tailwind, and JSX import errors instead of failing silently.
- Preserve inline SVG attributes, nested transforms, and explicit icon dimensions when rendering Design JSX artwork.
- Save auto-layout frames that stretch their children to `.fig` without failing. (#427).
- Preserve nested instance text, visibility, paint, geometry, clipping, variable modes, and component swaps in `.fig` files.
- Preserve compiled 20px corner radii and stroke widths by emitting valid Tailwind arbitrary
  utilities instead of spacing-scale `rounded-5` / `border-5` classes.
- Clip compiled lowcode card children to the parent rounded corners by emitting overflow clipping on card-like containers, with Tauri preview coverage for the rounded-parent path.
- Show JSX in the Code panel when selecting lowcode Button, Input, and Select nodes, including their interactive text, placeholder, value, and options in OpenPencil and Tailwind formats.
- Allow the CLI deploy command to accept the documented `--provider cloudflare` option.
- Treat unexpected Tauri system-font IPC responses as an empty local font list instead of crashing during desktop preview startup.
- Fix accepting local lowcode library updates from the Libraries panel when the editor graph contains Vue reactive nodes.
- Fix clone operations (duplicate, instance creation, clipboard copy) sharing mutable references with the original — editing fills, strokes, variable bindings, overrides, or vector networks on one no longer corrupts the other.
- Fix instance overrides shallow-copied on clone — override values containing objects are now deep-copied.
- Fix stale variable bindings not cleaned up when fills/strokes arrays shrink — any indexed sub-path is now handled, not just `/color`.
- Fix tooltips around inspector dropdowns/popovers without breaking floating menu anchoring.
- Fix nested variable picker popovers inside the gradient editor so they remain clickable above
  the fill picker, and refresh stop-level binding controls after bind/detach actions.
- Harden MCP calls with bounded page-tree responses, oversized-result errors, JSON HTTP responses, and stale WebSocket cleanup.
- Clear lowcode validation numeric rules from the inspector instead of leaving empty validation entries.
- Improve Figma boolean imports by preserving XOR operations as editable exclude nodes and falling back to imported fill geometry when boolean path reconstruction cannot produce a path.
- Preserve rotated Figma transform origins for imported vector nodes.
- Render complex text fills through vector glyph outlines so imported Figma text can use the normal fill pipeline for gradients, images, patterns, and other non-solid paints.
- Honor node-scoped variable modes in `.fig` files so light and dark component examples keep their intended colors.
- Improve `.fig` import and rendering fidelity for groups, booleans, instances, rotated vectors, complex text fills, auto-sized text, layout grids, page guides, patterns, noise effects, masks, and canvas backgrounds.
- Preserve pages, components, prototype and library metadata, export settings, unsupported effects, and other unrelated Figma data when editing and resaving `.fig` files.
- Prevent duplicate generated IDs from corrupting `.fig` round trips.
- Preserve the whole document when exporting FIG unless a page is explicitly requested, populate unopened pages for file-mode CLI inspection, and expose vector paths and variable modes to Plugin API scripts.
- Report corrupted compressed `.fig` data as an error instead of opening it as valid content.
- Match Figma auto-layout reflow after deleting children, hiding optional instance slots, or syncing component changes.
- Make group and boolean-operation children scale with their parent during resize.
- Edit vectors in opened documents at the correct position, with live fill updates and working undo and redo. (#390).
- Keep duplicated layers independent instead of sharing mutable fills, strokes, bindings, overrides, or vector data, and remove stale bindings when paints are deleted.
- Keep desktop text visible across scene and overlay canvases, refresh it after local fonts load, and preserve rendering when an italic face is unavailable. (#395).
- Vertically center text correctly when an explicit line height adds space above and below its glyphs. (#422).
- Preserve Hangul IME composition while editing text.
- Restore desktop copy, cut, and paste when browser clipboard events are unavailable.
- Finish pasting Figma layers promptly even when remote images are slow or unavailable, and hydrate their image fills when downloads complete.
- Reuse the existing tab when reopening a file through its desktop path or browser file handle, avoiding duplicate watchers and conflicting saves. (#297).
- Share public app links from the desktop collaboration panel and send the current document to newly joined collaborators.
- Show only the most specific tooltip when property controls contain nested actions.
- Match regional browser languages to supported locales without selecting a lower-priority language. (#417).
- Improve Simplified Chinese translations and correct localized menu terminology.
- Resolve published package types correctly for TypeScript consumers and keep file-backed CLI commands working under Node.

### Security

- Update the collaboration WebSocket dependency to address a protocol-length advisory.

## 0.13.2 — 2026-05-30

### Changed

- Update the Homebrew install command to use the published `openpencil` cask.

### Fixed

- Fix the published MCP package so global installs include the `openpencil-mcp` and `openpencil-mcp-http` launchers required by desktop app integrations.

## 0.13.1 — 2026-05-29

### Fixed

- Fix the npm package contents for the CLI so Bun installs include the built `openpencil` binary and runtime bundle.

## 0.13.0 — 2026-05-29

### Fixed

- Fix the published CLI package so Bun global installs run the built `openpencil` binary instead of raw TypeScript sources.

- Greatly improve importing Figma `.fig` files with complex component systems: badges, avatars, icons, links, input fields, lists, date pickers, nested instances, component swaps, and variant properties now open much closer to their original Figma appearance.
- Fix missing or white content in imported `.fig` files caused by unresolved Figma variable bindings, including image/avatar badges, icon colors, text colors, and variable-backed component overrides.
- Preserve more Figma document details when opening and saving `.fig` files, including internal component pages, component ordering, page metadata, canvas backgrounds, text layout, glyph rendering, vector geometry, effects, shadows, and instance overrides.
- Keep user edits after opening an imported `.fig` file: changing size, position, fills, text, or layout now wins over preserved Figma round-trip data when the document is saved again.
- Fix `.fig` exports so files reopened in Figma or OpenPencil keep their pages, components, instances, text wrapping, icons, avatars, and preview thumbnail intact.
- Fix live canvas updates during move/resize/edit previews so visible scene changes repaint immediately.
- Fix accidental duplicate creation when Alt-clicking without dragging.
- Fix MCP startup in the browser.
- Fix CanvasKit loading outside the browser when project paths contain spaces.
- Render imported Figma layer and fill blend modes such as multiply, screen, overlay, difference, hue, saturation, color, and luminosity.
- Render common imported Figma mask stacks so visible layers above alpha, vector, or luminance masks are clipped by the mask shape, including consecutive mask layers.
- Render Figma-style smoothed rectangle corners, including independent corner radii, and effect blend modes from imported Figma files.
- Improve imported tiled image fills by applying Figma image transforms when repeating image patterns.
- Keep imported Figma boolean operations editable as boolean-operation nodes instead of flattening them to vectors.
- Apply imported variable font axes from Figma `fontVariations` when rendering text.
- Render more imported Figma visual metadata, including text decoration styles, leading trim, pattern fills, layout grids, page guides, and deterministic fallbacks for raw noise effects.

### Performance

- Open large `.fig` files faster by deferring work for pages you have not viewed yet while still preparing all needed content before export.
- Improve canvas responsiveness during zooming, panning, dragging, and editing by reusing cached scene backing where safe.
- Speed up `.fig` export for documents with many preserved Figma paint and variable payloads.

## 0.12.2 — 2026-05-19

### Added

- Allow OpenRouter users to enter any model ID from provider settings with cached autocomplete suggestions for tool-capable models, while keeping the curated dropdown as the default when no custom model is set.

### Changed

- Use localized app tooltips instead of native browser titles across editor controls, panels, and menus.
- Update Claude Code MCP setup documentation and the docs landing screenshot.
- Ignore non-source Markdown files in the app dev watcher so documentation edits do not reload the running editor.

### Fixed

- Route Claude Code stdio MCP requests through the live OpenPencil app connection, including immediate disconnected errors when no document is connected.
- Keep MCP disconnected guidance focused on starting OpenPencil and opening a document.
- Improve agent-rendered JSX compatibility with Figma-style text, alignment, and rotation aliases; strip HTML comments; and report unsupported props from render tools.
- Load exact text font styles after MCP and AI tool mutations so newly created bold/weighted text renders immediately.
- Include text style fields in MCP `get_node` output so agents can verify generated text accurately.
- Keep provider settings tooltip/popover composition working in WebKit.

## 0.12.1 — 2026-05-19

### Fixed

- Fix `.fig` round-trips for OpenPencil component sets and variable bindings, and recompute imported layouts after opening documents.
- Report desktop/MCP package version mismatches explicitly and include package-manager-aware install guidance from the MCP server.
- Support scoped MCP `save_file({ path })` workflows while keeping file saving in the desktop app.
- Use native Tauri path handling for save parent directories so Unicode and Windows paths are handled correctly.
- Fix the web font picker so Google Fonts remain available in Safari, local font access is requested on first open when supported, font sources are labeled, and Google font previews load lazily for visible rows.
- Fix background blur rendering so it blurs the backdrop behind a layer instead of applying a no-op content filter, and keep effect parameter controls visible in the properties panel.

## 0.12.0 — 2026-05-18

### Added

- CLI `build` command — compile a document and produce a deployable static SPA bundle (Vite build over an in-memory VFS, zero `npm install`); supports `--base` for sub-path hosting and `--json`.
- One-click deployment — `open-pencil deploy <file>` builds and pushes the static bundle to Netlify or Vercel (`--provider netlify|vercel`, direct-upload APIs, SPA fallback config injected automatically), and a Deploy control with a provider picker in the desktop preview pane; token via `--token` or `NETLIFY_AUTH_TOKEN` / `VERCEL_TOKEN`.
- Per-environment Supabase config — emitted apps read `import.meta.env.VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` (design-time values as fallback), so one design deploys to preview/staging/prod. Override via a `.env` file (standalone export) or `build`/`deploy` `--supabase-url`/`--supabase-anon-key` flags.
- Self-hostable collaboration signaling — point editor collaboration at your own MQTT broker(s) and TURN server via `VITE_COLLAB_RELAY_URLS` / `VITE_COLLAB_TURN_URL` (+ `_USERNAME`/`_CREDENTIAL`) / `VITE_COLLAB_APP_ID`; or route signaling through Supabase Realtime (no public broker) with `VITE_COLLAB_STRATEGY=supabase` + `VITE_COLLAB_SUPABASE_URL`/`_KEY`. Unset falls back to the public broker + STUN/TURN defaults.
- Assets panel — browse, search, and insert document components directly from the left sidebar.
- Component variants — switch instance variants from the right inspector; default variant respects property definitions.
- Figma library metadata — component keys, source libraries, version IDs, descriptions, and docs links are preserved on import/export.
- Desktop file associations — double-click `.fig` or `.pen` files in Finder/Explorer to open them in OpenPencil.
- Auto-update — startup update checks and a Check for Updates menu item on desktop.
- Light theme with theme-aware canvas rulers.
- PDF export — available in the export panel, CLI (`--format pdf`), and MCP.
- SVG import tool for automation workflows.
- DeepSeek AI provider.
- Variable modes — create, rename, duplicate, delete, and set defaults per collection.
- Variable binding controls for fills, strokes, sizing, min/max, and typography fields.
- Auto-layout inspector controls for min/max dimensions, auto gap, wrap gap, and two-axis padding.
- Stroke dash/gap controls.
- Font settings — local font access, fallback predownloads, and downloaded font cache management.
- Editor commands for frame selection, paste to replace, Boolean operations, flatten, outline text, and outline stroke.
- Boolean operations panel control and canvas context-menu entries for flattening and outlining supported selections.

### Changed

- Smaller domain modules across core, app, Vue SDK, CLI, MCP, docs, and desktop with enforced package boundaries.
- Separate scene and overlay canvas layers — rulers, labels, and selections no longer cause scene redraws.
- Shared menu schema between browser and native Tauri menus.
- Editor command metadata now drives shortcut display across browser menus, native menus, tooltips, and context menus.
- Text-to-vector conversion now uses shared loaded-font outline geometry across Boolean, flatten, and outline commands.

### Fixed

- Fix `.fig` export of component variant properties and text stretch alignment so designs round-trip correctly through Figma.
- Fix CJK and Arabic text rendering — fallback fonts now load before the first paint instead of showing blank text.
- Fix large `.fig` files freezing on open — parsing runs in a worker, and the viewport fits to content after loading.
- Improve Figma import fidelity — variable aliases, nested instances, avatar swaps, badge internals, and input text alignment are preserved.
- Improve Figma export fidelity — flipped vectors, stroke geometry, visual overflow, and stroked-shape drop shadows are preserved.
- Fix variant switching so instances update their contents, not just the component reference.
- Fix text editing inside components and instances on double-click.
- Fix paste into selected containers and entered frames.
- Fix clipboard parsing to safely ignore invalid data.
- Fix undo/redo for duplicate, state restore, and modifier-key release.
- Prevent browser from intercepting app-level undo/redo shortcuts.
- Fix font loading and bundled font resolution.
- Show the startup loader until fonts load and the first render completes.
- Improve light theme polish and canvas ruler colors.
- Normalize browser zoom speed.
- Fix variable picker popovers and color binding swatches.
- Fix dashed strokes on vector nodes and gradient fills on text.
- Fix inner shadow rendering on text nodes.
- Fix imported Figma-derived underlined text rendering.
- Fix exponential `.fig` file growth on repeated save/load cycles.
- Fix opening large `.fig` files so every page populates component instances, preventing missing nested content when switching pages.
- Fix canvas size badges scaling with zoom.
- Fix layout inspector dropdown anchoring and spacing/padding icon clarity.
- Fix section drawing and color input forwarding in the property panel.
- Fix asset insertion coordinates inside entered containers.
- Fix MCP stdio handshake and eval return values.
- Fix `@open-pencil/vue` npm imports referencing an unexported core subpath.
- Fix Figma clipboard text compatibility — pasted OpenPencil text keeps editable fixed bounds, line wrapping, baselines, glyph offsets, and Figma edit-mode layout.
- Fix local font matching so requested upright and weighted faces do not fall back to italic or regular faces.
- Fix CanvasKit paragraph rendering to preserve requested text weights and slants.
- Fix nested text editing interactions — drill double-click enters nested text edit mode, and clicking another text node switches edit targets while editing.
- Fix auto-height text edit commits so text bounds and undo state stay in sync.
- Fix Boolean, flatten, and outline operations to reject unsupported image/complex-script sources safely instead of silently dropping geometry.
- Fix outline stroke enablement for stroked descendants inside groups and containers.

### Performance

- Event-driven canvas rendering — scene and overlay layers only repaint when their inputs change, replacing continuous polling.
- Shared RAF scheduler coalesces scene and overlay frames into a single animation frame per editor.
- Font-family fallback arrays and downloaded remote fonts are cached to avoid repeated work.
- WebGL draw-call instrumentation only runs while the profiler is active.
- Instance override resolution is cached and `.fig` pages load lazily for large files.
- Live drag/resize uses repaint-only previews to skip layout during interaction.

## 0.11.8 — 2026-04-23

### Fixed

- Fix MCP server not spawning on Windows — use `cmd /c` to resolve `.cmd` wrappers from npm global installs.
- Fix MCP server and automation WebSocket not connecting on Windows/Linux — inline `__TAURI_INTERNALS__` check at call time instead of using stale module-level `IS_TAURI` constant.
- Fix shell PATH not inherited by GUI app on macOS/Linux — add `fix-path-env-rs` to read shell config.

## 0.11.7 — 2026-04-22

### Added

- Add stdio transport for MCP server — `openpencil-mcp` now works as a proper stdio MCP server for Claude Code, Cursor, etc. HTTP server available as `openpencil-mcp-http`.
- Default canvas background to dark when system prefers dark color scheme.
- Add `list_available_fonts` MCP tool for font discovery.
- Copy node ID / XPath from context menu; CLI selection command.
- Arrow key nudge for selected nodes (1px, Shift+arrow for 10px).
- JSX renderer: `position="absolute"`, `top`, `left` props for absolute children inside auto-layout containers.
- MCP server sends `notifications/tools/list_changed` when the desktop app connects or disconnects.
- Headless text measurement via opentype.js per-glyph advance widths — no CanvasKit needed.
- Add `open_file` and `new_document` MCP tools with `OPENPENCIL_MCP_ROOT` path scoping.
- Optional `path` param on `export_image`, `export_svg`, `get_jsx` — write output to disk instead of returning base64/string.
- Multi-root JSX support — multiple top-level elements auto-wrapped in a fragment.
- `Component` and `Instance` tag aliases in JSX renderer.
- JSX prop reference doc — copy to clipboard via book icon in Code panel.
- Prompts (`CODEGEN_PROMPT`, `JSX_REFERENCE`) moved from embedded strings to markdown files.

### Fixed

- Fix Backspace not deleting selected nodes after clicking on canvas — canvas now receives focus on click so keyboard shortcuts aren't blocked by stale input focus.
- Support Cmd/Ctrl+click for additive multi-select in layers panel (previously only Shift+click worked).
- Fix macOS Tauri build — move `NSAllowsLocalNetworking` ATS config from invalid `tauri.conf.json` property to a proper `Info.plist` file.
- Fix tab order and keyboard handling in inspector panel.
- Fix design token variables not resolved before passing to yoga-layout.
- Suppress keyboard shortcuts while editing property panel inputs.
- Fix tooltip competing with popover trigger on Windows.
- Fix hit area for nodes with rotated parents.
- Error toasts auto-dismiss, deduplicate, and cap stack at 5.
- Bump yoga-layout to 3.3.0-grid.3 with `Node.free()` support.
- Bump PWA precache limit for canvaskit-webgpu.
- Fix color picker dragging flooding the undo stack — fill/stroke/effect color and opacity drags now collapse into a single undo entry per interaction via debounced batching in `PropertyListRoot`.
- Fix .fig import crash on alias variables without a GUID.
- Fix `save_file` crash on vectors with missing tangent control points — default to straight segments.
- Validate `create_vector` path JSON upfront with clear error messages for malformed input.
- Fix MCP/AI tools rejecting string-encoded numeric arguments from MCP clients (`"42"` → `42`).
- Fix "Create Instance" context menu item always grayed out — inverted disabled flag.
- Show "Create Instance" instead of "Create Component" in context menu when a component is selected.
- Fix headless layout: use stored .fig dimensions instead of rough text size estimates (26K → 11K mismatches on material3.fig).
- Fix `--help` output with huge vertical gaps between commands — remove inline examples from query description.
- Fix `openpencil-mcp` npm package missing `dist/stdio.js` — explicitly list entry points in tsconfig.
- Show toast when MCP server fails to start instead of silently swallowing the error.
- Fix provider settings popover not appearing — tooltip wrapper broke floating-ui positioning.
- Fix `set_font_range` producing invalid style runs that crash `.fig` export — use `applyStyleToRange`, apply color and fontWeight from style name.
- Fix MCP "app not connected" error — message now instructs the agent to stop and inform the user.
- Fix external links in AI panel blocked by Tauri ACL — use opener plugin instead of shell.

## 0.11.6 — 2026-04-08

### Fixed

- Switch `@open-pencil/core` build from `tsgo` + `fix-esm-import-path` to `tsdown` — fixes bare directory imports that broke Node.js and Bun consumers.

## 0.11.5 — 2026-04-08

### Fixed

- Fix published npm packages resolving to TypeScript source instead of compiled JavaScript — `publishConfig.exports` overrides are now applied during CI publish.
- Fix Windows CI build failures caused by backslash file paths in custom lint rules.

## 0.11.4 — 2026-04-08

### Fixed

- Fix `@open-pencil/core` published package containing stale import paths from before the domain module restructuring — CLI and MCP installs from npm now resolve correctly.
- Add `save_file` MCP tool for saving the current document to disk.
- Clipboard text export now writes richer v4 `derivedTextData` payloads with glyph outlines for better paste fidelity.

## 0.11.3 — 2026-04-08

### Fixed

- Show actionable install errors in the chat panel when a required local AI CLI is missing.
- Fix inline layer rename so clearing the name restores the default name, and Backspace/Delete inside rename inputs no longer delete the layer.
- Fix rotated frame hit testing, hover highlights, and selection overlays so interactive areas and overlay labels stay aligned during rotation.
- Fix text edit undo so it restores both the original text and `styleRuns`.
- Pressing Enter with a selected text node now starts text editing and selects all text.
- Fix `ScrubInput` Enter handling so committing a value no longer triggers a second blur-based commit that overwrites it.
- Show the auto-layout panel for `COMPONENT`, `COMPONENT_SET`, and `INSTANCE` nodes.
- Fix missing layout direction icons in the auto-layout controls.
- Fix nested text selection inside gradient cards.
- Unify the size control into a single inline sizing input/dropdown with shorter localized labels to prevent overflow.

## 0.11.2 — 2026-03-30

### Fixed

- Stabilize npm publishing with isolated temp publish directories instead of mutating tracked package manifests in CI.
- Strip build-time scripts and dev dependencies from generated publish manifests so tarballs pack from verified artifacts only.
- Fix `@open-pencil/mcp` release packaging so the published npm tarball includes its built `dist/` CLI and server entrypoints deterministically.
- Fix `@open-pencil/core` release build configuration so CI publish jobs include Node and Bun ambient types when compiling package artifacts.

## 0.11.1 — 2026-03-30

### Fixed

- Fix npm publishing pipeline to publish packed tarballs instead of raw package folders.
- Attempt to fix `@open-pencil/mcp` npm package contents so the published CLI includes its built `dist/` entrypoints.
- Fix `@open-pencil/vue` npm package metadata and build output so the published package resolves from `dist/` while local workspace development keeps using source aliases.

## 0.11.0 — 2026-03-30

### Added

- Lock and visibility toggle buttons in layers panel (hover to reveal, always shown when active).
- Figma-style selection scope — double-click to enter groups/frames/components, Escape to exit.
- Nested container navigation — each double-click goes one level deeper.
- Dashed border around entered container for visual feedback.
- Layer panel click syncs canvas scope automatically.
- Vue SDK internationalization primitives — `useI18n()`, locale detection, persisted locale selection, lazy-loaded locale JSON files, and exported locale metadata for custom editor shells.
- Vue SDK docs and public API audit — documented advanced exports (`useOkHCL()`, variables helpers, viewport and locale APIs), aligned docs with the actual `provideEditor()` injection model, and expanded release-ready SDK guidance.
- npm release pipeline now publishes `@open-pencil/core`, `@open-pencil/cli`, `@open-pencil/mcp`, and `@open-pencil/vue` together on version tags.
- App language picker in the menu bar — switch UI locale without reloading.
- Added a vector curve editor and improved drawing experience with the pen tool.
- Resume pen drawing from existing open path endpoints — click an endpoint to continue the curve.
- Close open paths by dragging one endpoint to the other.
- Align selected anchor points relative to each other in vector edit mode — the standard alignment buttons in the position panel now operate on selected vertices when 2 or more are selected.
- Unified core IO format registry — `.fig` is now modeled as the native document format alongside shared export adapters for PNG, JPG, WEBP, SVG, and JSX.
- Export selection or current page as `.fig` from the app export UI and app menu.
- New CLI commands: `open-pencil convert` for document conversion, `open-pencil formats` to inspect readable/writable/exportable formats, and `open-pencil lint` for design consistency, structure, and accessibility checks.
- CLI export now supports `.fig` output and routes PNG/JPG/WEBP/SVG/JSX/`.fig` through the shared IO layer.
- `Open…` now supports `.pen` Pencil documents through the shared document reader pipeline while keeping `.fig` as the native save format.
- Display‑P3 document color space pipeline — documents now default to Display‑P3, `.fig` import/export preserves document color profiles, the live canvas requests P3 surfaces with sRGB fallback, and raster/SVG export paths accept explicit color-space targets.
- Color picker overhaul — unified `RGB` / `HSL` / `HSB` / `OkHCL` field formats, slider-space-aware track/thumb previews, and better neutral-color editing behavior for fills, strokes, gradient stops, and component fills.
- OkHCL metadata now round-trips through `.fig` plugin data and integrates directly into the main fill/stroke color workflow with preview gamut diagnostics.
- Vue SDK now exposes reusable color-picker model helpers and solid fill/stroke commit helpers for custom editor shells.
- Update built-in Z.ai and MiniMax model lists — Z.ai now uses the Anthropic-compatible endpoint for GLM coding models, adds GLM-5.1, and MiniMax adds M2.7 / M2.7-highspeed.
- Arabic and RTL support across text rendering, editing, layout, export, and AI tooling — text nodes support `Auto`/`LTR`/`RTL`, auto-layout frames support `Auto`/`LTR`/`RTL` flow, and JSX/AI prompts/tools can now generate and edit both explicitly.

### Fixed

- Fix shortcuts, now work on non-English keyboard layouts.
- Fix imported `.fig` file open and page-switch regressions — loaded documents now keep graph/store state in sync, remap imported canvas/page children correctly, and recompute imported auto-layout descendants when switching pages.
- Fix first canvas render happening before fonts load — wait for fonts before the initial draw to avoid Safari and text measurement glitches.
- Preserve `fig-kiwi` version on `.fig` roundtrip — imports keep the original header version instead of rewriting everything to a hardcoded value; new files default to version 101.
- Normalize auto-layout text export for Figma — text children inside auto-layout frames now serialize with `NONE` auto-resize to match Figma behavior and avoid overflow on reimport.
- Fix keyboard editing regressions after the refactor — canvas shortcuts no longer fire while editing text, and Delete/Backspace no longer delete nodes during text entry.
- Fix MCP page switching persistence — `switch_page` now survives across tool calls in the same session.
- Improve CJK font fallback coverage — load multiple Google Fonts for broader Han/Japanese/Korean text support.
- Normalize more visible UI strings for localized app chrome — menus, panels, variables dialog, code panel, chat setup, and editor controls now respect the selected locale instead of falling back to English in common flows.
- Fix imported text rendering in browser and headless export — preserve stored bounds until fonts are ready, restore missing font-loaded guards, use natural width for `WIDTH_AND_HEIGHT` text, and clip text to node bounds.
- Fix browser/headless rendering mismatch for imported toolbar/instance content by correcting runtime imported layout recomputation instead of diverging browser rendering behavior.
- Fix `set_layout` tool not defaulting to HUG sizing when enabling auto-layout — frames now shrink/grow to fit children instead of keeping fixed dimensions.
- Normalize font family names on `.fig` export — strip optical size suffixes (e.g. "DM Sans 9pt" → "DM Sans") so Figma recognizes the font.
- TEXT nodes now default to a solid black fill — previously exported with no fill, making text invisible when opened in Figma.
- Fix save crash when COLOR variable is missing alpha channel.
- Fix console error spam on deployed web app from automation WebSocket reconnect loop.
- Fix headless CLI font fallback — bundled Inter font now ships with `@open-pencil/core` and loads without a web server.
- Locked nodes now block move, resize, rotate, and delete on canvas.
- Locked containers block double-click enter.
- Marquee selection skips locked and hidden nodes.
- COMPONENT/INSTANCE containers are now enterable via double-click.
- Replaced the alignment and reflection icons with the correct ones.

## 0.10.0 — 2026-03-15

### Added

- ACP agent support — use Claude Code, Codex, or Gemini CLI as AI assistants in the desktop chat panel.
- Permission confirmation dialog — ACP agents request user approval for file/shell operations, MCP design tools auto-approved.
- Unified MCP server — single HTTP + WebSocket proxy replaces Vite SSR bridge.
- Stock photo integration — `stock_photo` tool fetches images from Pexels or Unsplash and applies to design nodes. Provider adapter supports custom providers.
- Skeleton-first AI workflow — 4-phase design process (plan → skeleton → content fill via `replace_id` → polish) for more reliable AI-generated layouts.
- Batched AI tools — `calc` accepts arrays of expressions, `stock_photo` fetches all images in parallel, `batch_update` applies multiple property changes in one call, `describe` accepts `ids` array for multi-node inspection.
- AI visual feedback — blue pulsing border on nodes being modified, green flash on completion.
- Auto-depth `describe` — adapts inspection depth to subtree size (small block → deeper, large page → shallower).
- `set_fill` gradient support — linear gradients with `color_end` and `gradient` direction params.
- `render` tool `replace_id` — atomically swap skeleton placeholders with real content.
- MCP `export_image_file` tool for headless PNG rendering.
- Grid layout in AI chat — JSX renderer supports `grid`, `columns`, `rows`, `gap` props.
- Configurable max output tokens in AI provider settings (default 16384).
- Z.ai AI provider with GLM-5, GLM-4.7, GLM-4.6, GLM-4.5 model families.
- MiniMax AI provider with M2.5, M2.1, M2 models.

### Fixed

- Resolve variable-bound fill colors through alias chains.
- Fix SCALE constraint resizing for auto-layout instances.
- Propagate SCALE constraints through instance clone chains.
- Skip self-referencing symbolOverrides on nodes with explicit kiwi properties.
- Fix DSD resolution for swapped instance children.
- Fix instance swap override propagation through clone chains.
- Fix component property override resolution through clone chains.
- Fix text/property overrides clobbered by second transitive sync.

- Fix text rendering with wrong fonts on file open — all font weights (including default family) are now loaded before the first render.
- Fix `weightToStyle` mapping: weight 400 now correctly maps to "Regular" instead of "Medium".
- Fix detached ArrayBuffer crash when switching pages after saving — export worker now copies image buffers before transferring.
- Show warning toast when fonts fail to load, error toast when file open fails.
- Fix FillPicker crash when selecting image fills (missing `ref` import from #92).
- Fix Google Fonts TLS/network errors not cached — failed families no longer retry on every render.
- Fix CJK text garbled when font is unavailable — fallback now renders through paragraph shaper instead of raw `drawText`, preserving CJK characters via the fallback font chain.
- Fix auto-layout overflow in AI-generated designs — text wrapping, min/max constraints, absolute positioning, and FILL sizing now work correctly.
- Fix `layoutAlignSelf` limited to STRETCH — full range supported (CENTER, MAX, MIN, BASELINE).
- Fix hidden auto-layout children losing their dimensions on layout recompute.
- Fix ProviderSettings popover not visible in AI chat.
- Fix paste/copy/cut intercepted by canvas in AI chat input.
- Strip TypeScript casts from AI-generated JSX (`as any`, `as const`).
- Fix parsing complex .fig files crashing on missing GUIDs in component overrides.
- Fix headless text layout using 100×100 default size instead of estimated dimensions — multi-line wrapping now estimated correctly.
- Fix clipboard roundtrip losing properties — clipsContent, constraints, arcData, strokeCap/Join, layoutAlignSelf, textAutoResize, autoRename now preserved in Figma Kiwi serialization.
- Fix MCP headless export crashing on `window.queryLocalFonts` in non-browser runtimes (Bun/Node).
- Fix MCP `export_image` rendering blank text — fonts now loaded before rasterization.
- Fix text always using paragraph rendering with Inter fallback chain (no more missing-font garbling).
- Clip children to rounded corners when `clipsContent` is true.
- Use child shape for drop shadows on transparent containers.
- Treat `FOREGROUND_BLUR` as layer blur wrapping children.
- Fix radial, angular, and diamond gradient rendering.
- Fix .fig export roundtrip: variable GUIDs colliding with document.
- Fix file open dialog not working on first click in Safari.
- Skip variable fonts from local font access, use Google Fonts instead.
- Disable autosave by default.

### Performance

- Offload .fig parsing (unzip + Kiwi decode) to a Web Worker — main thread stays responsive during file open.
- Offload .fig compression to a Web Worker during save (was blocking 450ms+).
- Add instance index (`componentId → Set<nodeId>`) — `getInstances()` is O(1) instead of scanning all nodes.
- Defer graph event subscription until after layout computation during file open — eliminates redundant `syncInstances` calls.
- Cache label collection (sections/components) per scene mutation instead of walking the full tree every frame.
- Blocking font loading — fonts load before first render to ensure correct glyphs.

## 0.9.0 — 2026-03-09

### Added

- XPath query command — `open-pencil query design.fig "//FRAME[@width < 300]"` to find nodes by type, attributes, and tree structure using XPath selectors.
- CSS Grid layout mode — select a frame, click the grid icon in the auto layout toolbar to switch from flex to grid. Configure column/row tracks (fr, fixed px, auto), column and row gaps, and per-side padding. Powered by a [Yoga fork](https://github.com/open-pencil/yoga/tree/grid) with cherry-picked CSS Grid PRs from upstream.
- JSX and Tailwind CSS export for grid layouts — `grid grid-cols-N`, `gap-x-*`/`gap-y-*`, child `col-start-*`/`row-start-*`/`col-span-*`/`row-span-*`.
- Multi-provider AI support — connect to Anthropic, OpenAI, Google AI, or any OpenAI-compatible endpoint directly, in addition to OpenRouter. Per-provider API key storage, provider settings popover, automatic migration from single OpenRouter key.
- Anthropic-compatible provider for custom API endpoints.
- New AI tools: `get_jsx` (JSX roundtrip view), `diff_jsx` (structural diff), `describe` (semantic role, visual style, layout, design issues).
- AI visual verification — `export_image` returns image content to the model for vision-based review.
- API type toggle (Completions/Responses) for OpenAI-compatible providers.
- Figma zoom shortcuts — ⌘0 (100%), ⌘1 (zoom to fit), ⌘2 (zoom to selection), ⇧1/⇧2 alternatives.
- XPath query tool — `query_nodes` for AI/MCP with attribute selectors, tree traversal, and type filtering.

### Changed

- Padding on a frame auto-enables vertical auto-layout.
- AI tools run `computeAllLayouts` after execution — layout updates immediately.
- Enhanced AI system prompt with full JSX prop reference and verification workflow.
- Chat panel preserves messages when toggling UI visibility.
- SceneGraph event bus (nanoevents) — `node:created`, `node:updated`, `node:deleted`, `node:reparented`, `node:reordered` events replace monkey-patching in collab sync and manual render invalidation.
- Replace esbuild-wasm (14 MB) with sucrase (201 KB) for JSX transform — `buildComponent()` and `renderJSX()` now synchronous and browser-compatible.
- `useMagicKeys` keyboard shortcut system — replaces tinykeys with VueUse built-in, cross-platform Meta/Control handling, modifier exclusion for combo conflicts.
- Dev-only debug toolbar for copying chat logs.
- Auto-layout icons in layer tree — vertical (rows), horizontal (columns), and grid icons for auto-layout frames; components keep their purple diamond.
- Frame titles on canvas are now draggable — clicking a selected top-level frame's name label starts a drag.
- Compact layout controls — icon-based gap (↔/↕) and padding (T/R/B/L) inputs instead of text labels.
- Auto-detect horizontal vs vertical direction when wrapping in auto layout (Shift+A).
- Fix alignment grid for vertical layouts — visual positions now match spatial axes.
- Fix grid switch from HUG-sized frames — frame expands to fit children.
- Remove unwanted white fill when wrapping in auto layout.

### Fixed

- Serialize variables, collections, and bindings to `.fig` files — previously lost on save (#65).
- Text nodes created via MCP now render in Figma — emit `derivedTextData` with font metadata and layout size (#64).
- Double-click on layer tree no longer toggles expand/collapse — use the chevron instead.
- Page rename input matches layer rename styling.
- Fix `w="fill"`/`h="fill"` in JSX renderer — now direction-aware based on parent flex axis.
- Fix text auto-resize defaulting to fixed 100×100 — text without explicit width uses `WIDTH_AND_HEIGHT`.
- Fix `clipsContent` not propagated to Yoga — frames with clip enabled now set `Overflow.Hidden`.
- Fix `COUNTER_ALIGN_MAP` mapping stretch to `MIN` instead of `STRETCH`.
- Fix JSX export omitting x/y for absolute-positioned children.
- Fix JSX export ignoring `textAutoResize` for text sizing.
- Fix drag terminating on mouseleave — drags now continue outside the canvas.
- Fix `export_image` stack overflow on large nodes — chunked base64 encoding.
- Undo support for auto-layout reorder, layer tree reorder, and drag reparent.
- Page snapshot undo for AI tool mutations.
- Fix collab sync for same-parent reorder — `node:reordered` events now propagated to Yjs peers.
- Fix orphaned instances on clipboard paste — detach to FRAME when component is missing.
- Fix text typography lost on Figma clipboard import — preserve fontFamily, fontWeight, fontSize, lineHeight.
- Fix `copyFill` missing `gradientTransform` and `imageTransform` — gradient fills now round-trip correctly.

### Performance

- Event-driven rendering and component sync — `SceneGraph` emits typed events on mutations; `requestRender()` calls reduced from 94 to 22, component instance sync uses microtask batching with deduplication.
- Replace `structuredClone` with typed copy helpers for fills, strokes, effects, and style runs (~24× faster in hot paths).
- Filter .fig unzip to only decompress canvas and image entries, skipping metadata cruft.

## 0.8.0 — 2026-03-07

### Added

- Mobile layout & PWA — responsive editor with touch-optimized toolbar, swipeable bottom drawer (layers/properties/design/code), HUD overlay, and installable PWA with icons and service worker.
- Tailwind CSS v4 JSX export — export selections as HTML with Tailwind utility classes (`<div className="flex gap-4 p-3">`) from the Code panel, CLI (`bun open-pencil export --format jsx --style tailwind`), or programmatically via `sceneNodeToJSX(id, graph, 'tailwind')`. Supports layout, sizing, colors, border radius, opacity, rotation, overflow, shadows, blur, and typography. Uses v4 spacing semantics (px/4 multiplier) with automatic fallback to arbitrary values.
- Code panel format toggle — switch between OpenPencil (custom components) and Tailwind (HTML + utility classes) output.
- Homebrew tap — `brew install open-pencil/tap/open-pencil` for macOS (arm64 + x64), auto-updated on each release.
- Double-click to rename layers — inline rename in layer panel, shared `useInlineRename` composable.
- New AI/MCP tools: `analyze_colors`, `analyze_typography`, `analyze_spacing`, `analyze_clusters`, `diff_create`, `diff_show`, `get_components`, `get_current_page`, `arrange`, `node_to_component`.
- CLI-to-app RPC bridge — all CLI commands work against the running app when no file is specified. Start the app, then run `bun open-pencil tree` to inspect the live document.
- VitePress docs site — user guide, reference, architecture, and development docs at openpencil.dev with 6 locales (en, de, fr, es, it, pl), SEO (OG tags, hreflang, JSON-LD, sitemap), and dark theme.

### Changed

- Refactor mobile drawer tabs, layout sizing dropdowns, and inline rename to use Reka UI primitives.
- Add shared UI style helpers with tailwind-variants for menus, selects, buttons, and surfaces.
- Unified tool definitions — define once in `packages/core/src/tools/`, automatically available in AI chat, CLI, and MCP.
- Harden FigmaAPI — hide internals via Symbols, freeze arrays, fix `layoutSizing`, 30+ new properties and methods.
- Split tools into domain files (read, create, modify, structure, variables, vector, analyze) — easier to navigate and extend.
- Replace inline type definitions with named types (`Color`, `Vector`, `SceneNode`) across the codebase.
- Split 3200-line `renderer.ts` into `packages/core/src/renderer/` with 10 focused files (scene, overlays, fills, strokes, shapes, effects, rulers, labels).
- Centralize all color utilities in `packages/core/src/color.ts` — `colorToHex8`, `colorToCSSCompact`, `normalizeColor`, `colorDistance`; remove 5 duplicate implementations across the codebase.
- Add `geometry.ts` with shared rotation math (`degToRad`, `radToDeg`, `rotatePoint`, `rotatedCorners`, `rotatedBBox`).
- Extract `isArrayMixed()` helper for multi-selection property panels.

- Add `motion-v` for declarative animations — used in mobile drawer (spring-animated height with pan gestures) and toolbar (layout-animated category switching with directional slide transitions).
- Mobile drawer: replace `useSwipe` + manual rAF animation with `motion.div` `:animate` + `@pan`/`@panEnd`; always-on tab state (no more null `activeRibbonTab`); content stays rendered when closed.
- Mobile toolbar: replace manual `scrollWidth` measuring + inline CSS transitions with `motion.div layout` + `AnimatePresence` directional slide variants.
- Mobile UI cleanup: extract shared `colorToCSS` util to core, `initials` to `src/utils/text`, `toolIcons` to `src/utils/tools`; replace hand-rolled dropdowns with reka-ui Popover/DropdownMenu; narrow `mobileDrawerSnap` type to string union; move magic numbers to constants; disable PWA service worker in dev mode.
- 83 new E2E tests (57 → 140): design panel, code panel, components, copy/paste, multi-page, text editing, keyboard shortcuts, context menu.
- 150 new unit tests (588 → 738): color, undo, snap, vector, style-runs, text-editor.
- 48 new E2E tests (9 spec files) + 26 mutation unit tests + store/canvas test helpers.
- Add `data-test-id` attributes to AppearanceSection, LayoutSection, TypographySection, VariablesDialog, EditorView.

### Fixed

- Fix drawer animation jump on close — single spring transition instead of two-phase.
- Fix `ALL_TOOLS` registry missing newer tools (`analyzeColors`, `diffCreate`, `exportImage`, `arrangeNodes`).
- Fix `renderJSX` typo in tool definitions (`renderJsx` → `renderJSX`).
- Fix all oxlint warnings and tsgo errors — replace `!` non-null assertions in `use-collab.ts` with local const captures.
- Fix broken test imports — stale `../../src/engine/` paths updated to `@open-pencil/core`.
- Fix flaky E2E tests: layers panel navigates to `/demo`, zoom-to-fit test zooms in first, snapshot rendering stabilized with `workers: 1` and `colorScheme: dark`.
- Fix bogus .fig import mappings for `expanded` and `strokeMiterLimit` fields.
- Fix PWA manifest error in dev mode, handle invalid font data gracefully.
- Fix eval response unwrapping and `export_jsx` page selection in RPC bridge.
- Fix automation commands not recomputing layouts after mutations.
- Fix workspace dependency not resolved when installing from npm (switch CI to pnpm publish).

## 0.7.0 — 2026-03-05

### Added

- SVG export — export selections as SVG from the export panel, context menu, CLI (`bun open-pencil export --format svg`), or MCP/AI tools (`export_svg`). Supports rectangles, ellipses, lines, stars, polygons, vectors, text with style runs, gradients, image fills, effects, blend modes, clip paths, and nested groups (#46).
- Copy/Paste as submenu in context menu — Copy as text, Copy as SVG, Copy as PNG (⇧⌘C), Copy as JSX.
- Stroke align (Inside/Center/Outside) with clip-based rendering matching Figma behavior.
- Individual stroke weights per side (Top/Right/Bottom/Left) with side selector dropdown.
- Google Fonts fallback — automatically loads fonts from Google Fonts API when not available locally.
- Auto-save toggle in File menu — disable to prevent automatic writes to the opened .fig file.
- Renderer profiler with in-canvas HUD overlay, GPU timing, and phase instrumentation.

### Changed

- Replace custom color picker with Reka UI Color components (ColorArea, ColorSlider, ColorField) — adds keyboard navigation and accessibility to the color area, hue, and alpha controls.

### Fixed

- CJK text rendering — load a system CJK font (PingFang SC, Microsoft YaHei, Noto Sans CJK) as fallback; falls back to Noto Sans SC from Google Fonts when no system font is available (#48).
- Font registration errors no longer cache invalid font data — `loadFont` only caches after successful CanvasKit registration.
- Fix `render` tool failing on Windows + Bun with "Cannot find module" error (#43).
- Fix hover highlighting nodes from internal component pages — scope hit-test to current page.
- Fix hit-testing on transparent frames and groups — empty containers without fills or strokes are now click-through, clipping parents reject hits outside their bounds, matching Figma behavior.
- Fix instance overrides on .fig import and clipboard paste — resolve guidPaths by overrideKey, handle component swaps (`overriddenSymbolID`), propagate through nested clone chains. Import and paste now share a single override engine.
- Apply Figma component property assignments on import — boolean visibility toggles and instance swaps via `componentPropRefs`/`componentPropAssignments`.
- Apply `derivedSymbolData` sizes on import — containers now shrink correctly when component properties hide children.
- Fix override resolution for nested instance targets — check the current node before searching descendants.
- Fix component property assignments for nested instances — resolve scoped `componentPropAssignments` inside `symbolOverrides` via guidPath, handle `guidValue` for instance swaps, reorder phases so transitive sync doesn't clobber visibility.
- Pixel-perfect vector rendering using pre-computed `fillGeometry`/`strokeGeometry` blobs from .fig files — eliminates white gaps between adjacent stroked shapes.
- Stroke outlines on clipboard paste — convert vectorNetwork paths to filled outlines via CanvasKit when geometry blobs are unavailable.
- Apply `derivedSymbolData` transforms and geometry during import — instance children render at correct scale and position.
- Fix internal pages becoming visible after .fig round-trip — preserve `internalOnly` flag on export.
- Scope layout recomputation to current page for paste/undo/font-load (major speedup on large multi-page files).
- Show loading overlay until all document fonts are loaded (no more partially rendered text).
- Load fonts when switching pages (previously only loaded for the first page).
- Always show visibility toggle on fill, stroke, and effect rows (matches Figma).
- Fix renderer crash on double destroy when closing files quickly.
- Fix .fig page ordering — use deterministic byte comparison for fractional index positions.
- Fix text truncation using `textTruncation` field instead of `textAutoResize`.
- Fix horizontal scrollbar on design and pages panels.
- Style scrollbars for Tauri (thin dark overlay instead of default OS chrome).
- Enable file watcher in Tauri — `watch` feature was missing from `tauri-plugin-fs`.

## 0.6.0 — 2026-03-04

### Added

- Multi-selection properties panel — edit position, size, appearance, fill, stroke, and effects across multiple selected nodes.
- Shared values display normally, differing values show "Mixed".
- W/H inputs in multi-selection mode.
- Flip horizontal/vertical using scale transform instead of rotation.
- Single-node alignment aligns to parent frame bounds.
- ACP agent package — Agent Communication Protocol server for AI coding tools, reusing core ToolDefs.

### Changed

- Apple code signing and notarization for macOS builds.
- Git LFS storage moved from GitHub to Cloudflare R2.

### Fixed

- Fix Figma clipboard paste: extract shared kiwi→SceneNode conversion, fixing broken auto-layout, missing gradient/image fills, effects, style runs, and text properties.
- Fix vector rendering on paste — scale path coordinates from Figma's normalizedSize to actual node bounds.
- Fix pasted instances having no children — populate from component via symbolData when both are in clipboard.
- Detect component sets on import — promote FRAME nodes with VARIANT componentPropDefs to COMPONENT_SET.
- Skip internal canvas on paste — components on Figma's hidden internal page populate instances but are not pasted as visible nodes.
- Apply instance overrides on paste — text content, fills, visibility, layoutGrow, and textAutoResize from symbolOverrides.
- Fix auto-layout child ordering — sort by geometric position instead of z-order position strings.
- Load fonts on paste and .fig import — collect font families from text nodes and load into CanvasKit.
- Text measurement in auto-layout — use CanvasKit paragraph metrics for WIDTH_AND_HEIGHT text nodes.
- Recompute layouts after font loading completes.
- Fix PERCENT line height conversion — was stored as raw value instead of pixels.
- Fix InvalidCharacterError when copying nodes with non-ASCII text.
- Load all font weight/style variants needed by pasted text nodes.
- Fix font loading not registering in core cache.
- Fix halfLeading applied to text measurement — enable only for rendering.
- Clear hover on zoom/pinch to keep scene picture cache valid.
- Fix flip buttons using rotation math instead of actual mirroring.
- Fix flip transform encoding — scale first matrix column only (was incorrectly producing 180° rotation).
- Decode flip state from .fig transform matrix on import.

## 0.5.1 — 2026-03-03

### Fixed

- Fix File → Save crash when document has layer blur effects.

## 0.5.0 — 2026-03-03

### Added

- Effects rendering: drop shadow, inner shadow, shadow spread, layer blur, background blur, foreground blur.
- Text shadows render on glyphs instead of bounding box.
- Multi-file tabs — open multiple documents in tabs within a single window.
- Tab bar with close buttons, middle-click to close, and new tab (+) button.
- Keyboard shortcuts: ⌘N/⌘T new tab, ⌘W close tab, ⌘O opens in new tab.
- Native Tauri menu: File → New and File → Close Tab wired to tab actions.
- Render text from SkPicture cache when fonts are missing — pixel-perfect display without the font installed.
- Missing font indicator (⚠) next to font picker in the sidebar.
- Right-click context menu on layers panel — same actions as the canvas context menu.
- 40+ new AI/MCP tools ported from figma-use:
  - Granular set tools: `set_rotation`, `set_opacity`, `set_radius`, `set_minmax`, `set_text`, `set_font`, `set_font_range`, `set_text_resize`, `set_visible`, `set_blend`, `set_locked`, `set_stroke_align`
  - Node operations: `node_bounds`, `node_move`, `node_resize`, `node_ancestors`, `node_children`, `node_tree`, `node_bindings`, `node_replace_with`
  - Variable CRUD: `get_variable`, `find_variables`, `create_variable`, `set_variable`, `delete_variable`, `bind_variable`
  - Collection CRUD: `get_collection`, `create_collection`, `delete_collection`
  - Boolean operations: `boolean_union`, `boolean_subtract`, `boolean_intersect`, `boolean_exclude`
  - Vector path tools: `path_get`, `path_set`, `path_scale`, `path_flip`, `path_move`
  - Create tools: `create_page`, `create_vector`, `create_slice`
  - Viewport: `viewport_get`, `viewport_set`, `viewport_zoom_to_fit`, `page_bounds`
  - Misc: `flatten_nodes`, `list_fonts`
- `set_text_properties` tool: alignment, auto-resize, decoration.
- `set_layout_child` tool: sizing, grow, align_self, positioning.
- 13 MCP server integration tests via `InMemoryTransport`.

### Changed

- Resizable pages/layers split in left panel with reka-ui Splitter.
- Layers tree auto-expands and scrolls to reveal selected node.
- Loading overlay on canvas while opening .fig files.
- Hide internal-only pages (e.g. "Internal Only Canvas" in design systems).
- Render page dividers — pages named with only dashes/asterisks/spaces show as horizontal lines.
- Only show component labels for COMPONENT and COMPONENT_SET, not instances.
- Replace all native `<select>` dropdowns with reka-ui `AppSelect` component.
- Smoother trackpad pinch-to-zoom with `Math.exp` curve and deltaMode normalization.
- Fix font picker dropdown truncating long font names.
- Show explanation in font picker when Local Font Access API unavailable (Safari/Firefox).

- Auto-populate GitHub Release notes from CHANGELOG.md via `ffurrer2/extract-release-notes@v2`.
- Skip already-published npm versions on CI re-runs instead of failing.
- Exclude non-app directories from Vite file watcher.

- Extract shared color constants (`BLACK`, `TRANSPARENT`, `DEFAULT_SHADOW_COLOR`) — replaces 8 inline literals across core.
- Extract shared `NodeContextMenuContent` component to avoid menu duplication.
- Fix `@open-pencil/core` dep in MCP package: `workspace:*` for local dev (pnpm resolves at publish time).
- Replace store thunks with a late-binding proxy.

- Clipboard roundtrip tests: encode to Figma Kiwi binary → decode → verify.
- 9 visual regression snapshot tests for effects rendering.
- Zoom/pan E2E tests and pipeline benchmark.
- MCP server edge-case tests for `find_nodes` and Zod validation.
- 6 unit tests for absolute position cache.

### Fixed

- Fix drop shadow rendering on top of fills — shadow now draws behind opaque content.
- Fix effect property changes not recorded in undo/redo history.
- Fix active tab text invisible against same-color background.
- Fix clipboard "Outside int range" error — `pasteID` used unsigned int exceeding Kiwi's signed 32-bit field.
- Error toasts are now sticky (don't auto-dismiss), with selectable text, copy button, and close button.
- Truncate long node names in export button.

### Performance

- Per-node SkPicture cache for effect rendering — unchanged shadow/blur nodes replay from cache on scene redraws.
- Drop shadows use `MaskFilter` direct draw instead of `saveLayer` offscreen buffers.
- Cached `ImageFilter`, `MaskFilter`, reusable effect paint — zero per-frame WASM allocations for effects.
- Reuse GL context on panel resize — swap surface without recreating renderer, preserving all caches.
- Per-frame absolute position cache — avoids repeated parent-chain walks during rendering.
- Optimize zoom/pan smoothness with `shallowReactive`, `useRafFn`, and input coalescing.

## 0.4.2 — 2026-03-02

### Changed

- Import additional properties from Figma clipboard: `layoutAlignSelf`, `clipsContent`, `fontWeight`, `italic`, `letterSpacing`, `lineHeight`.
- Convert `letterSpacing` PERCENT units to pixels based on font size.

- 7 new clipboard import unit tests (14 total).

### Fixed

- Fix Figma clipboard paste: skip non-visual node types (variables, widgets, stickies, connectors).
- Fix text not rendering after paste — `letterSpacing` from Figma is a `{value, units}` object, was passed as-is → `NaN` broke CanvasKit paragraph layout.
- Fix undo/redo for Figma paste — no undo entry was recorded; redo duplicated `childIds`.
- Center pasted Figma content in viewport instead of using original coordinates.
- Compute auto-layouts after clipboard paste (same as .fig import and demo creation).

## 0.4.1 — 2026-03-02

### Changed

- Highlight copy & paste with Figma in README and feature docs.
- Replace "fig-kiwi" format name with "Kiwi binary" — the format is shared between .fig files and clipboard.

### Fixed

- Fix text disappearing after hover when SkPicture cache was recorded before fonts loaded.
- Invalidate scene picture cache on font load to prevent stale fallback text.

## 0.4.0 — 2026-03-02

### Added

- MCP server (`@open-pencil/mcp`) — 29 tools for headless .fig editing via stdio (Claude Code, Cursor, Windsurf) or HTTP (Hono + Streamable HTTP with sessions).
- `openpencil-mcp` and `openpencil-mcp-http` binaries — install globally via `bun add -g @open-pencil/mcp`.

### Changed

- All packages emit JS via tsgo + fix-esm-import-path — `@open-pencil/core` and `@open-pencil/mcp` work on Node.js without Bun.
- Core package exports: `bun` condition → src (dev), `import` condition → dist (npm consumers).
- `@open-pencil/mcp` added to CI publish workflow.

## 0.3.2 — 2026-03-02

### Changed

- Visual regression tests for SkPicture cache: hover on/off cycle, multiple cycles, mouse hover, scene change + hover.
- Type `window.__OPEN_PENCIL_STORE__` globally, remove ad-hoc casts from tests.

### Performance

- Re-apply SkPicture scene caching for ~7x faster pan/zoom (0.98ms vs 6.8ms per frame at 500 nodes).

## 0.3.1 — 2026-03-02

### Fixed

- Fix text disappearing after hovering a frame (revert SkPicture scene caching).
- Fix macOS startup hang: async font loading, show window on reopen.

## 0.3.0 — 2026-03-01

### Fixed

- Fix npm publish: use pnpm for workspace dependency resolution with provenance.
- CLI version now reads from package.json instead of hardcoded value.
- Update README: accurate app size (~7 MB), streamlined feature list, current project structure.

### Performance

- SkPicture scene caching — pan/zoom replays cached display list instead of re-rendering all nodes.
- Cache vector network paths — avoid rebuilding WASM paths every frame.
- Cache ruler and pen overlay paints — eliminate 10 WASM Paint allocations per frame.
- Only enable `preserveDrawingBuffer` in test mode.
- Hoist URL param parsing out of render loop.

## 0.2.1 — 2026-03-01

### Changed

- Panel header with app logo, editable document name, and sidebar toggle.
- ⌘\\ to toggle side panels for distraction-free canvas.
- Panels hidden by default on mobile (< 768px).
- Floating bar with logo, filename, and restore button when panels hidden.
- Always show local user avatar in collab header.
- Touch support for pan and pinch-zoom on iOS.

### Performance

- Stubbed shiki to remove 9MB of unused language grammars (20MB → 11MB bundle).

## 0.2.0 — 2026-03-01

### Added

- Real-time P2P collaboration via Trystero (WebRTC) + Yjs CRDT.
- Peer-to-peer sync — no server relay, zero hosting cost.
- WebRTC signaling via MQTT public brokers.
- STUN (Google, Cloudflare) + TURN (Open Relay) for NAT traversal.
- Awareness protocol: live cursors, selections, presence.
- Figma-style colored cursor arrows with name pills.
- Click peer avatar to follow their viewport, click again to stop.
- Stale cursor cleanup on peer disconnect.
- Local persistence via y-indexeddb — room survives page refresh.
- Share link at `/share/<room-id>` with vue-router.
- Secure room IDs via `crypto.getRandomValues()`.
- Removed Cloudflare Durable Object relay server (`packages/collab/`).

### Changed

- Toast notifications via Reka UI Toast — top-center blue pill for info, red for errors.
- Global error handler (window.error + unhandledrejection) shows errors as toasts.
- Link copied toast on share and copy link actions.
- HsvColorArea extracted as shared component (ColorPicker + FillPicker).
- Scrollable app menu without visible scrollbar.
- Selection broadcasting to remote peers.

## 0.1.0-alpha — 2026-03-01

First public alpha. The editor is functional but not production-ready.

### Added

- Canvas rendering via CanvasKit (Skia WASM) on WebGL surface.
- Rectangle, Ellipse, Line, Polygon, Star drawing tools.
- Pen tool with vector network model (bezier curves, open/closed paths).
- Inline text editing on canvas with phantom textarea for input/IME.
- Rich text formatting: bold, italic, underline per-character via style runs.
- Font picker with system font enumeration (font-kit on desktop, Local Font Access API in browser).
- Auto-layout via Yoga WASM (direction, gap, padding, justify, align, child sizing).
- Components, instances, component sets with live sync and override preservation.
- Variables with collections, modes, color bindings, alias chains.
- Undo/redo for all operations (inverse-command pattern).
- Snap guides with rotation-aware edge/center snapping.
- Canvas rulers with selection range badges.
- Marquee selection, multi-select, resize handles, rotation.
- Group/ungroup, z-order, visibility, lock.
- Sections with title pills and auto-adoption of overlapping nodes.
- Multi-page documents with independent viewport state.
- Hover highlight following node geometry (ellipses, rounded rects, vectors).
- Context menu with clipboard, z-order, grouping, component, and visibility actions.
- Color picker with HSV, gradients (linear, radial, angular, diamond), image fills.
- Properties panel: position, appearance, fill, stroke, effects, typography, layout, export.
- ScrubInput drag-to-change number controls.
- Resizable side panels via reka-ui Splitter.

- .fig file import via Kiwi binary codec (194 definitions, ~390 fields).
- .fig file export with Kiwi encoding, Zstd compression, thumbnail generation.
- Figma clipboard: copy/paste between OpenPencil and Figma.
- Round-trip fidelity for supported node types.

- Built-in AI chat in properties panel (⌘J).
- Direct browser → OpenRouter communication, no backend.
- Model selector: Claude, Gemini, GPT, DeepSeek, Qwen, Kimi, Llama.
- 10 AI tools: create_shape, set_fill, set_stroke, update_node, set_layout, delete_node, select_nodes, get_page_tree, get_selection, rename_node.
- Streaming markdown responses (vue-stream-markdown).
- Tool call timeline with collapsible details.

- JSX export of selected nodes with Tailwind-like shorthand props.
- Syntax highlighting via Prism.js.
- Copy to clipboard.

- `info` — document stats, node types, fonts.
- `tree` — visual node tree.
- `find` — search by name/type.
- `export` — render to PNG/JPG/WEBP at any scale.
- `node` — detailed properties by ID.
- `pages` — list pages with node counts.
- `variables` — list design variables and collections.
- `eval` — run scripts with Figma-compatible plugin API.
- `analyze colors` — color palette usage.
- `analyze typography` — font/size/weight distribution.
- `analyze spacing` — gap/padding values.
- `analyze clusters` — repeated patterns.
- All commands support `--json`.

- Scene graph with flat Map storage and parentIndex tree.
- FigmaAPI with ~65% Figma plugin API compatibility.
- JSX renderer (TreeNode builder functions with shorthand props).
- Kiwi binary codec (encode/decode).
- Vector network blob encoder/decoder.

- Tauri v2 (~5 MB).
- Native menu bar, save/open dialogs.
- System font enumeration via font-kit.
- Zstd compression in Rust.
- macOS and Windows builds via GitHub Actions.

- Runs at [app.openpencil.dev](https://app.openpencil.dev).
- No installation required.
- File System Access API for save/open (Chrome/Edge), download fallback elsewhere.

- [openpencil.dev](https://openpencil.dev) — VitePress site with user guide, reference, and development docs.
- Deployed via Cloudflare Pages.
