---
title: Lowcode Apps
description: Turn OpenPencil pages into React apps with preview, Supabase, workflows, i18n, shadcn/ui, build, and deploy.
---

# Lowcode Apps

OpenPencil can turn design pages into runnable React + TypeScript + Tailwind apps. Use it when a design needs to become a working static SPA with state, forms, API calls, Supabase data, i18n, and deployable output.

Lowcode apps build on normal OpenPencil documents. You still draw frames, text, buttons, inputs, images, components, and auto-layout as usual; the lowcode panels add behavior on top of those nodes.

The Layers panel uses the same control icons as the toolbar for inputs, buttons and other lowcode
nodes. Plugin modules such as Tabs have their own icons; ordinary wrapping frames retain their
layout icons. These editor indicators do not change the node type or `.fig` export format, and do
not make OpenPencil lowcode behavior executable in Figma.

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

Select a `FRAME`, `FORM`, or `LIST` container to configure **Auto layout** in the Layout section.
The switch turns automatic child arrangement on or off; the flow choices have text labels:
**Freeform**, **Vertical**, **Horizontal**, and **Grid**. Select the container whose children you
want to arrange.

Switching to **Freeform** and back to the same flow keeps the existing spacing, padding, alignment,
and sizing settings. With no intervening edits, the same configuration restores the arrangement.
Enabling auto layout on an existing fixed-size frame keeps its dimensions; choose **Hug** explicitly
to fit its contents. **Grid** keeps existing tracks and gaps, initializes only missing row or column
tracks, and does not enlarge the frame. Shift+A keeps its existing wrap-in-auto-layout behavior.

If you move children in **Freeform**, enabling auto layout arranges them again using their layer
order and the container's settings; it does not preserve those manual positions. Undo restores the
freeform positions. Each flow change is one undo step, restoring the container, children, and any
affected enclosing or neighboring layers together. Saving and reopening a `.fig` retains the
resulting layout and geometry, including a result restored with Undo.
The retained settings also survive saving in Freeform and reopening before enabling auto layout
again. Explicitly changing an imported frame's flow recalculates its layout instead of reusing
geometry cached for the old flow.

An input or another leaf control does not arrange child nodes. When its parent uses auto layout,
the inspector identifies that parent and offers **Select parent** to reach the container's layout
controls. Width and height keep their current **Fixed**, **Hug**, or **Fill** mode visible next to
the value. Open each mode menu to change it; available modes still depend on the selected node and
its parent layout. For child layers, the displayed modes follow the parent container's flow
direction. Sizing-menu changes are undoable: Undo restores the mode together with the layout
geometry, including dimensions.

When resizing with the mouse, the canvas preview and released result use the same layout for the
selected layer, enclosing containers, and neighboring layers. Resizing only width or height changes
that axis from **Hug** or **Fill** to **Fixed**, preserving the other axis's existing flex sizing.
Minimum and maximum dimensions remain active. Hold Shift to preserve the aspect ratio when a size
satisfying both the ratio and those limits exists.

Grid children share one stretch setting across both axes. If resizing releases that setting, the
other axis keeps its current pixel size; it does not continue to **Fill** as the grid changes.

Press Escape to cancel a resize. A cancelled pointer gesture, window losing focus, canvas becoming
inactive, or changing the selection, page, or document also restores the preview. Subsequent mouse
movement or release from that cancelled drag does not apply changes. A completed resize is one
undo step: Undo and Redo restore sizing modes and all affected layer sizes and positions together.

For imported `.fig` layers, resizing updates the adjusted axis while retaining the imported layout
on the other axis. Saving includes the updated sizes and positions of affected enclosing containers
and neighboring layers, and retains text-on-path data. Undo also restores the previous sizes and
positions for later saves.

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

## Remote Component Libraries

OpenPencil can load a data-only component library from a public HTTPS manifest. Remote libraries do
not execute JavaScript and are separate from runtime plugins or micro-frontends. The manifest pins
one same-origin `.fig` or `.pen` artifact by exact byte length and SHA-256 digest, and the editor
validates every declared component before showing it for import.

Publish and host a library as follows:

1. Use `open-pencil library publish` to write publish metadata into the library document and create
   the local component manifest.
2. Use `open-pencil library remote prepare <published.fig> --manifest <manifest.json>
--artifact-url https://libraries.example.com/design-system.fig -o remote-library.json`.
3. Serve the remote manifest and artifact from the same public HTTPS origin. Browser deployments
   need CORS headers that allow the OpenPencil app origin. Do not put credentials or access tokens in
   either URL; query strings, fragments, redirects, custom ports, IP literals, and private hostnames
   are rejected.

To consume it, open **Design → Assets & Variables → Libraries**, paste the remote manifest URL, and
choose **Load**. Loading only stages and verifies the candidate; it does not change the document.
Choose **Import** for each component you want. The accepted master is retained on an internal cache
page inside the document, so existing imported components remain available offline.

Use **Check** on an imported library to fetch and verify its persisted manifest URL. A newer version
is shown as pending and does not change the document until you choose **Accept update**. Import and
accept are undoable. OpenPencil never checks remote libraries automatically when a document opens.

The direct-URL flow currently supports public, unauthenticated libraries only. `.fig` artifacts are
limited to 64 MiB and `.pen` artifacts to 16 MiB before their format-specific decode quotas run.
Referenced images must be complete PNG, JPEG, or WebP files, with at most 32,768 pixels per side and
50 million total pixels. Component and version validation also has aggregate node, binary, string,
depth, and value-work limits.
Component subtrees with external component/prototype/Motion references, bound variables, missing
image assets, event actions, workflows, API/Supabase/Stripe/analytics behavior, or custom CSS are
rejected instead of being imported partially. A signed marketplace/catalog, trusted lowcode
capability packages, and styles or token libraries are separate future distribution layers.

## Map Module

Choose **Map** from the Interactive tool group, then click or drag on the canvas. OpenPencil stores
the result as a normal frame with a versioned module configuration, so it remains visible and its
data survives when the document is opened without the map runtime or round-tripped through `.fig`.

The canvas draws a deterministic offline preview. Use the Module inspector to choose the fixed map
style, longitude, latitude, zoom, interactivity, and markers. Attribution is not editable: the
desktop preview and generated React app always show a visible link to the OpenStreetMap copyright
page. Generated source uses the locally installed MapLibre GL package and does not inject a CDN
script or accept arbitrary provider code. Children authored inside the map frame remain editable and
compile as overlays above the interactive map layer.

The built-in OpenStreetMap raster source supports zoom levels 0–19. Its community tile service is
best-effort and intended for normal interactive viewing, not bulk download, offline packs, or
high-volume commercial traffic. Use a future provider adapter or self-hosted tiles for workloads
that cannot follow the [OpenStreetMap tile usage policy](https://operations.osmfoundation.org/policies/tiles/).

Built-in AI and MCP expose the same registry through `list_modules`, `create_module`, `read_module`,
and `update_module`. Installed marketplace modules can use only reviewed Canvas and Compiler
adapters already shipped by the host. An optional, separately signed runtime channel is limited to
bounded import-free WASM compute; arbitrary third-party JavaScript, native code, network,
filesystem, credential, and document-write access remain unavailable.

### Repair uncontrolled validation fields

Validation only runs on a controlled value. If a validated input, textarea, select, radio,
datepicker, checkbox, or switch has no `bindings.value`, the Bindings inspector shows **Create page
state and bind**. It creates a matching page state and the reference binding in one undo step.

For a whole page, form subtree, or one control, MCP/built-in AI can first call
`audit_form_controls`, then preview the exact repair with
`ensure_form_value_bindings({ dry_run: true })`, and finally run the same tool without `dry_run`.
Existing valid or invalid authored bindings are never overwritten; invalid targets are reported for
manual review. Audits return at most 50 controls by default (configurable up to 200) and report
`total`, `returned`, and `truncated`; repair calls fail before mutation when more than 199 bindings
are missing, so narrow the scope and retry. Page/form sweeps skip reusable `COMPONENT` and
`COMPONENT_SET` master subtrees. A field authored inside a component master cannot bind to page
state; use document state instead. Put navigation or submission actions on the FORM `onSubmit`
event when validation must run before those actions.

### Configure field behavior

The Interactive properties section exposes input type, keyboard input mode, autofill, an accessible
name, disabled/read-only state, and applicable text-length or numeric constraints. Inputs accept
text, email, password, number, telephone, URL, and search types. Choosing the numeric input type does
not change the existing bound state type; string bindings preserve an empty string instead of zero.

Input and Textarea canvas text reads supported page/document initial-value bindings. Password inputs
show a mask, single-line inputs stay on one line, and text remains clipped to the authored bounds.
Checkboxes display their initial check mark; checkbox groups also show option labels and selected
array values, including supported initial-state option sources. This is a design-time projection,
not a running form: computed expressions, remote requests and business events still require preview.

Table cells and menu/upload trigger labels use the same font fallback path as other canvas text.
When a required font finishes loading, tiled canvas previews refresh without requiring another edit.
The appearance still depends on fonts available on that computer; no additional fonts are bundled by
these lowcode modules.

On an invalid form submission, React/Vue focus the first editable invalid field in that form, even
without an error summary. Disabled, read-only, hidden or removed fields are skipped. A late validation
response cannot focus a replacement field after its original panel is unmounted. Required semantics
and associated error text remain accessible; no failed business submission is replayed automatically.
Radio/checkbox groups validate when a child loses focus, and numeric bounds reject non-numeric values.
Group changes also update validation immediately. Repeated list fields and reusable component
instances keep separate error-description IDs even when they share the same bound value.

Static Select options can have separate labels and values and can be individually disabled. Existing
string options still use the same string for both; a configured dynamic options source takes precedence.
Give controls an accessible name in addition to any visual placeholder.

Select settings now appear near the top of the inspector. Edit labels and submitted values separately,
reorder or disable individual options, and choose the default from the list. Renaming a selected value
or removing its option updates its literal default in the same undo step; bound business state is never
rewritten. Duplicate values, empty labels and missing defaults produce inline guidance. A value binding
disables the literal-default editor, and a dynamic options source takes precedence over preserved static options.

Set a **Placeholder** and enable **Allow clearing from the menu** to let users return to an empty string
by selecting the placeholder option. Without clearing enabled, the generated placeholder option is disabled.
An explicitly authored empty-value option keeps its own label and disabled state. With neither setting,
existing native first-option behavior remains. Text and placeholder colors are configurable. React and Vue
preserve native selection, keyboard, focus/change/blur and form behavior; shadcn uses a diagnosed native
fallback for dynamic options or generated empty-value choices. Vue also applies literal defaults correctly.

Plain solid native selectors inset the preview arrow by at least 12px and reserve label space,
preserving larger authored right padding. Image, gradient, layered or bound backgrounds, responsive
right padding, right-to-left layouts, and system forced-color mode retain the system arrow to preserve authored styling.
With both enhancement switches off, the browser still owns the open menu.

The canvas shows a closed selector with its initial selected label, placeholder, arrow, padding, clipping
and disabled content. Static page/document state defaults can provide values and simple dynamic option
paths; computed expressions, remote data and live preview selection are not evaluated on the canvas.
Reopening an existing template `.fig` uses the new drawing without regenerating it. Local `.fig` readback
preserves the options and new settings; Figma-compatible export includes the static label/placeholder,
while actual Figma application acceptance remains a separate check.

Enable **Search when expanded** to filter the open menu by displayed label (case-insensitive, including
Chinese text); typing a search never changes the submitted value. Enable **Virtual scrolling** for large
local option lists: the React/Vue preview and export mount only visible, fixed-height rows plus a small
buffer. Both switches are independent and off by default. They also work with dynamic options sources
and React shadcn output. Search runs on options already supplied to the control; it does not request remote
pages. Filtering still scans that data, and virtualization does not reduce the data stored in the document.

Use arrow keys and Page Up/Down to move through enabled options, Enter to select, and Escape to cancel.
Closing the menu clears its search. The current selection is brought into view when reopened. Clearing,
explicit empty values, disabled items, value bindings and field validation keep their existing meaning.
The canvas remains a closed design representation; test the open menu in the compiled preview. The
fixed-height virtual rows truncate long labels with their full text available as a tooltip. These web
features do not add native/mobile target support. Multiple/tags modes, option groups and remote loading
are not provided.

Selecting a radio group exposes **Radio** near the top of both Classic and Focused inspectors.
Add, remove or rename options, choose a default, and configure the group name, accessible name,
disabled state and value binding there. Option text is also its value. Renaming the selected option
updates its static default in the same undo step; removing or clearing it clears the default.
A value binding takes precedence and disables the static default selector. Change the bound initial
value in page or document state; option edits do not rewrite shared state.

The canvas paints authored options, circles, the initial selection and disabled appearance, using
font fallback and clipping to the control bounds. Initial selection reads the static default or a
valid page/document string-state default. Test actual selection changes in the React/Vue preview;
the design canvas does not execute business events, dynamic option sources or runtime expressions.
Existing RADIO nodes benefit from this display fix without reinsertion or changes to the `.fig`
node type or persistence format.

SWITCH and DATEPICKER also show their static initial appearance on the canvas. Valid page/document
state defaults take precedence over the authored `checked` or `value`; disabled content is dimmed.
A switch uses its entire authored width and height as a capsule track; the thumb scales with the
available space and stays inside padding and the border. Canvas, React, Vue and React's shadcn path
share blue-on, gray-off and white-thumb defaults. The switch owns its base track colors and rounded
shape instead of using generic fills or corner radii; those authored values remain stored. Generated
controls keep keyboard focus rings, respect reduced-motion preferences and render only one thumb.
The canvas shows the initial state, not live hover/focus, responsive or custom web-theme styling.
Dates retain the exact valid ISO `YYYY-MM-DD` value without timezone conversion. Empty or invalid
values show the format placeholder `YYYY-MM-DD`, and read-only dates hide the calendar button.
Text and symbols respect padding and clipping.

These display changes do not resize nodes or modify templates, and existing `.fig` files need no
regeneration. The canvas does not toggle values, open calendars or run business events; verify
interactions in React/Vue preview. Native date-control styling and localized date formatting may
differ between browsers and operating systems.

The Events section lets fields select **On change**, **On focus**, or **On blur**. Buttons offer click,
focus, and blur; forms keep **On submit**. Each event has its own action list, supports undo, and keeps
the other events intact. Expressions in field events may read the native value through `$value` and
the event through `$event`. For checkboxes and switches, the boolean state is available through the
binding or `$event.target.checked`; `$value` retains the native value semantics.

In shadcn mode, composite fields with authored click/change/focus/blur actions use native controls to
retain the real DOM event, controlled writes, and validation. Selects with static empty-value
options also use native controls. The compiler reports `ui-kit-native-control-fallback`; these
fields may look different from Radix controls. Other supported fields retain shadcn styling,
accessible names, disabled state, and disabled options.
Generated styles include the utilities used by emitted kit components, including icon sizes
and popup states; preview does not depend on scanning files outside the generated project.

### Insert a basic component or common composition

Open **Assets**, choose **Component templates** as the source, then filter by **Basic components**
or **Common compositions**. Search accepts English names, Chinese names and stable template IDs.
Favorites are stored on this computer. Insert creates editable layers with applicable bindings,
events and validation; one Undo removes the whole insertion, including any added state.
Copies have independent example state; module-only examples keep their state inside each running component.

Saving and reopening a `.fig` preserves control font family, size, weight, line height, letter
spacing, alignment and padding. Earlier template exports may already have lost those values;
upgrading cannot infer the original styling. Use the regenerated template file or adjust existing
copies manually. Before reopening an updated `all-templates.fig` from disk, save any other edits
and close its old tab.

Input and textarea recipes share readable text insets, closely grouped labels and visible focus
feedback. Their layers and appearance remain editable. Recipe updates apply to new insertions;
they do not automatically restyle copies already placed in a document.

| Basic components (54)               | Common compositions (8)                             |
| ----------------------------------- | --------------------------------------------------- |
| Button, Input, Textarea, Select     | Exact-name search with results and reset            |
| Checkbox, Switch, Radio, Date field | Validated name/email form                           |
| Content card, Section divider       | Preferences card                                    |
| Local file picker, Local data grid  | Editable dialog form, Details tabs, Table workbench |
| Slider, Range slider, Rating        | Frequently asked questions with expandable answers |
| Stepper, Breadcrumb                 |                                                     |
| Alert, linear/circular Progress, Chip | |
| Avatar, count/dot Badge, Timeline | |
| Tooltip, Skeleton, Empty content/search | |
| Bar, Line, Area, Pie and Donut charts | |
| Markdown note/checklist, Code example | |
| Multiple select, Date range, Tree, Tree select | |
| Popover, Local confirmation | |
| Autocomplete, Time picker | |
| Date-time picker, Number input, Password input | |
| Color picker, Descriptions | |
| Pagination | Paginated list |
| Org Chart | |
| Walktour | |

**Org Chart** is available as an opt-in plugin and the `org-chart` template. The visual editor accepts 1–64 plain-text cards across at most eight levels, with editable labels, descriptions and parent relationships. Choose vertical/horizontal layout, initial folded branches and card/connector colors. Narrow containers automatically use an indented vertical layout to keep cards readable; widen the container to display the full horizontal or vertical tree. Changes apply atomically with undo. The canvas shows the authored state; React/Vue supports local branch folding and keyboard navigation. Runtime folding resets when the component configuration changes or it is recreated. It does not connect to a directory, persist runtime folds, submit forms or grant workflow authority. The normal FRAME and module metadata survive `.fig` readback; Figma does not execute the Org Chart runtime.

**Walktour** is an opt-in module available through the `walktour` template. Add, remove or reorder 1–12 steps in the design panel, edit titles and descriptions, and choose placement and a uniquely named direct child layer as the target. A blank target means a centered overview. Target layers remain editable with ordinary canvas tools, and all child content remains rendered. Apply the step list atomically with undo.

Click the start button to show highlights and instructions in React/Vue. Previous, next, finish, skip and Escape are available; a missing or hidden target shows a clear notice and centers that step without automatically skipping it or clicking anything. Closing restores appropriate focus; config changes or remounting end the old tour. Walktour never submits forms, searches outside its own children, navigates routes, stores completion history or starts automatically. Browsers unable to open the guide show a local message and leave the page usable; microfrontend packaging rejects this overlay capability.

The library contains **62 recipes: 54 basic components and 8 common compositions**. The six input and popup recipes are `multi-select`, `date-range`, `tree`, `tree-select`, `popover` and `popconfirm`. Multiple select binds a `string[]` to independent page state; review that reference before moving the template to another page. Date range now supports state/FORM bindings; tree selection remains instance-local. Tree supports at most 128 authored items and 6 levels, with independent selection rather than cascading parent/child checks. Popover and confirmation share one plugin; confirmation only shows local feedback and never saves, deletes or submits a business operation. Native date appearance follows the browser and operating system.

Autocomplete and Time picker are native **INPUT variants**, available directly from Assets without enabling a plugin. Their `value` binds to string page or document state and participates in the existing FORM validation/submission flow. The canvas shows the closed field and its initial bound value; use the React/Vue preview to interact.

- **Autocomplete:** select an Input (Text or Search), then edit **Suggestions** in the design panel. Apply up to 100 unique single-line values, at most 200 characters each. Suggestions filter locally; Arrow Up/Down and Enter select, Escape dismisses, and Tab leaves the field without selecting. Users may keep their own text, including unmatched values. Clearing uses the same field binding. These suggestions are separate from browser autofill and do not query a server.
- **Time picker:** choose Input type **time**. Configure `HH:mm` or `HH:mm:ss` values and bounds, and a step in seconds. A minimum later than the maximum defines a range across midnight. Values contain no date or timezone. Browser/OS controls determine the runtime picker and localized display; the canvas shows a neutral clock and the authored precision. Invalid drafts stay editable in the panel; out-of-range values remain visible so native form validation can reject them.
- Multiple Select lists **array** state variables in the binding panel; autocomplete and time inputs list **string** variables. Changing modes keeps the existing binding visible for manual repair instead of converting application data.

React/Vue export these input variants. Saving/reopening `.fig` preserves their ordinary INPUT metadata; Figma does not run their low-code behavior.

The `date-time-picker`, `number-input` and `password-input` recipes add three more editable INPUT examples. They reuse existing value bindings and FORM validation/events without installing a plugin. Their canvas previews show authored values and control affordances; interaction belongs to the React/Vue runtime.

- **Date-time picker:** choose `datetime-local` and bind a string. Use `YYYY-MM-DDTHH:mm` or `YYYY-MM-DDTHH:mm:ss` for a real Gregorian date and time, `min`/`max` in the same format, and a positive whole-number step in seconds or `any`. Values have no timezone or UTC conversion. Unlike a time-only range, `min` cannot be after `max`. Native browser/OS formatting can differ from the neutral canvas preview; invalid drafts remain editable, while out-of-range values remain visible for native validity to reject.
- **Number input:** leaving the step-control setting at its native default preserves the existing browser control. Choose custom controls for buttons at the end or on both sides; choose hidden to suppress spinner buttons. Custom buttons call native `stepUp`/`stepDown`, respecting fractional steps, bounds, disabled and readonly state. Empty string drafts stay empty until the user types or deliberately steps; the template uses string state for this reason. With `step=any`, custom stepping is disabled because no step increment is defined; free numeric input remains available. The existing number-binding rules are unchanged.
- **Password input:** enable the reveal control explicitly. It starts masked, changes visibility only for that instance, and restores masking on reset, relevant type/config changes or remount. Readonly passwords may be revealed; disabled controls cannot toggle. Reveal does not dispatch value edits or submit the form. The template starts empty, has no plaintext value feedback, and does not save credentials. Avoid putting real passwords into authored defaults, example state or design files.

Expo, Flutter, native WeChat Mini Program, Taro, uni-app and Mpx source exports omit unsupported `time`/`datetime-local` INPUT variants and enhanced input controls with node-specific warnings. Unconfigured native number/password inputs keep their existing target behavior. Browser/OS picker UI, actual assistive technology and other devices require their own acceptance; a generated control does not establish backend validation or credential storage.

**Pagination** is opt-in. Enable it in plugin settings, then insert Pagination or Paginated list from Assets. Configure total items, page size, initial page, first/last controls, density, typography and colors. Narrow containers reduce visible page buttons or show a current/total summary with first/last controls hidden. Button count stays bounded independently of total.

Under Pagination bindings, connect current page to numeric page or document state; total and page size can read numeric state or expressions. User navigation updates that same state. Configure list visibility or a business query to consume it. The module does not fetch data, submit a FORM or retry requests. Unbound page state is instance-local. Empty data shows `0 / 0` and disables navigation. Shrinking totals clamp the displayed page without rewriting business state: use the same effective page in the list or explicitly reset it on filter changes. Invalid bindings do not silently fall back to authored values.

The Paginated list composition demonstrates real list navigation with editable local records and independent page state, not remote pagination or large-data virtualization. Canvas shows static authored configuration; React/Vue preview exercises live state linkage. The `.fig` metadata preserves configuration and bindings; Figma does not execute these interactions.

The **Color picker** recipe uses `INPUT` with type `color`, a string binding and the existing FORM flow. In the design panel, set the initial value with the swatch or an exact `#RRGGBB` value; empty means no selection. In React/Vue, the hex field accepts direct typing and an adjacent swatch opens the native browser/OS chooser. Choosing a color updates the same binding. Readonly prevents choosing while preserving the value in form submission; disabled fields are omitted. Required fields reject empty values, and invalid hex values remain visible for correction instead of silently becoming black. Alpha, named CSS colors and wide-gamut formats are not supported. The canvas shows the authored swatch and hex value; it does not open the system chooser.

**Descriptions** is an opt-in built-in plugin for read-only label/value content. Install and enable it in plugin settings, then insert its template or module. Edit 1–24 pairs together in the design panel and Apply once; Cancel discards the draft. Configure 1–3 columns, labels beside or above values, density, borders, colors and typography. Narrow frames automatically use fewer columns; long runtime content scrolls inside the frame. Text is literal, without HTML execution, FORM bindings or remote data. Canvas and React/Vue share layout rules; React/Vue output semantic description lists. Other source targets report unsupported behavior and omit the module. Both new templates preserve ordinary node metadata through `.fig`; this does not make their runtime behavior available in Figma.

Five Chart recipes provide paired editable data and shared Canvas/React/Vue rendering. They use one static series with at most 64 points, not a live data source. Circular charts require nonnegative values. Install and enable Chart before insertion.

Tooltip, Skeleton, Empty content and No search results are configurable templates. Placeholders do not automatically detect business state; connect visibility expressions to your data. Tooltip paints its trigger on the canvas and opens its hint on hover or focus in the runtime preview.

These are local examples for React and Vue. Search matches complete sample names (`Alpha`, `Beta`,
`Gamma`) and is case-sensitive. Form and preferences feedback concerns the current running app;
it does not mean data reached a server or survived a reload. The file picker never uploads files.
Templates do not configure authentication, a database, backend APIs or global design tokens.

Alert, linear Progress, circular Progress and Chip add four basic templates. Dismissal and label selection/removal only affect the running instance. Progress is an authored example; use indeterminate mode when no percentage is known. It never fabricates live task completion. Configuration changes/remounting reset local interactions.

Slider/Range and Rating support optional writable page/document state and FORM bindings; unbound instances retain local state. Binding does not configure persistence or backend submission.
Stepper optionally changes its current step without running a workflow. Breadcrumb validates safe
links and leaves its final item non-clickable. Canvas shows authored initial settings; generated
React/Vue pages supply interaction. These modules retain ordinary `.fig` FRAME metadata, which does
not make the runtime interactive in Figma.

Upload, DataGrid, Modal, Tabs, FAQ, Slider/Range, Rating, Stepper, Breadcrumb, Alert, Progress, Chip, Avatar, Badge, Timeline, Tooltip, Skeleton, Empty State, Chart, Markdown, Code Block, Date Range, Tree/TreeSelect, Popover/Confirmation and Descriptions entries require the corresponding installed and enabled built-in
plugin. An unavailable card links to plugin settings; inserting or favoriting it never installs or
enables a plugin. Existing documents are unchanged until you insert. Template text uses the language
selected at insertion time and remains ordinary editable content afterward. Search drafts and
preference choices use page state; review those references before converting a block to a reusable
component master or moving it to another page.
Insert into an ordinary page or editable frame, outside component masters and instances. Templates
containing a form also reject an existing form ancestor, preserving valid submission behavior.

### Place editable content inside dialogs and tabs

Create a named direct child frame inside a Modal or Tabs module and place ordinary fields, forms,
buttons, or lists inside it. In Module properties, select that frame as **Content child layer** for
the modal body or the corresponding tab. Each selected direct child must have a unique layer name;
renaming or removing it requires updating the selection. Copying or `.fig` round-tripping keeps the
name-based mapping. The mapping resolves the name when compiling: replacing a child with another
direct child of the same name also replaces the mapped content.

Mapped content replaces the configured text. Once content mapping is enabled, unmapped children are
not rendered as a trigger or shared tab content. Missing, ambiguous, or duplicate mappings produce
diagnostics rather than placing content in a different slot. Documents without mappings retain their
previous behavior. Tabs mount only the active panel; bind drafts to page/document state when values
must survive switching panels. Modal's built-in footer buttons still close the dialog: use an authored
FORM and BUTTON inside the content for business submission and its feedback.

On the design canvas, mapped Tabs show only the **Initial tab** configured in Module properties.
Change that setting to inspect or edit another panel; interactive tab switching belongs to the web
preview. The active child starts below a horizontal header (or beside a vertical header), with 16 px
body padding. Fill-sized content follows the available panel size. Inactive and unassigned children
remain in the layer tree and saved document, but are excluded from canvas painting and pointer hits.
Existing `.fig` files receive the same layout when reopened in the updated editor; turning the
outer frame's auto layout off and on is not needed to repair overlapping panels.

When a form contains mapped module content, submission and its error summary consider only mounted
fields belonging to that actual form. Inactive tabs, closed dialogs, omitted children, and a nested
form's fields do not block the outer form. The active panel's required fields still block submission.
If the active field set changes while asynchronous validation is pending, submit again after the
new panel is ready; the old result cannot submit it.

React and Vue exports both support these content mappings and the Table, local DataGrid, and Tabs
runtimes. DataGrid keeps its bounded local data, sorting, filtering, selection, pagination, and CSV
operations; it is separate from Backend LIST and does not fetch server pages or save edited records.
Selected rows stay selected across pages and temporary column filters. The status shows the total
selected and how many are outside the current page; **Clear selection** clears both. **Clear column
filters** removes only user-entered queries and returns to page one, preserving authored data
filters, sorting, selection, and locally imported rows. Empty pages disable select-all. Feedback
uses English or Chinese according to the grid or document language.
Vue remote asynchronous validation remains explicitly unsupported.

For acceptance, insert two independent controls/modules, edit each event, undo once, and switch
selection or documents while a draft is open. In both generated targets, check field changes and
validation, a form inside a modal, keyboard tab switching, retained bound drafts, and an invalidated
content mapping. Browser coverage does not establish native WebView, physical keyboard/IME, or
screen-reader coverage.

### Review a form before previewing

Select a form or one of its fields to review the form configuration overview in the inspector.
It connects four checks: field value bindings, validation rules, the form's submit event, and
failure handling. Use a row's navigation action to select the relevant field or form and open its
existing Bindings, Validation, or Events section. Reviewing or navigating does not change the
document.

An optional field does not need a validation rule. A configured failure branch or error-state
destination also does not prove that a draft will survive: custom actions can clear values or
navigate away. Keep resets in the successful submission branch and test a failed request before
shipping. Actions on a button's click event can bypass form submission validation; place validated
submission actions on the form's `onSubmit`. Vue exports continue to reject remote asynchronous
validation rather than silently submitting an unvalidated form.

### Backend list feedback

Lists bound to a Backend resource display their request state in generated React and Vue apps:

| State      | Behavior                                                                           |
| ---------- | ---------------------------------------------------------------------------------- |
| Loading    | The first request is pending; this is not an empty result.                         |
| Refreshing | A successful result remains visible while the same query and session refresh.      |
| Empty      | A successful request returned no records.                                          |
| Failed     | A local message offers **Retry**. A failed refresh may retain the previous result. |

Changing the query, page subscription, or account invalidates the old result. Authentication and
permission failures clear retained records. Retry repeats only the list read; it does not repeat a
previous create, update, delete, or business command. Existing cursor and error document-state
bindings continue to work. These states describe the generated app's request, not a database
migration, remote synchronization, or production-readiness check.

For a repeatable check, preview a search list with an add/edit form. Test a delayed first request,
refresh with existing records, an empty response, a failed read followed by Retry, a failed form
submission with retained input, and a quick query/page change while an older request is pending.
Run the same sequence in both React and Vue; verify real identity and database integration
separately from mocked browser tests.

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
  bezier editor, and MotionSpec v2 power, sine, exponential, circular, back, bounce, elastic, hold,
  steps, spring, and inertia controls. Rich curve families expose bounded direction and family
  parameters while remaining deterministic data rather than executable animation code.
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

To combine independently released React and Vue exports, use the explicit microfrontend packaging
flags and the route-and-slot Shell described in [Microfrontend Composition](./microfrontends).
Without those flags this standalone build path is unchanged.

For Supabase-backed apps, production public runtime values should come from the environment or command flags:

```sh
VITE_SUPABASE_URL=https://example.supabase.co \
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
VITE_SUPABASE_SCHEMA=app \
openpencil build app.fig -o dist
```

or:

```sh
openpencil build app.fig -o dist \
  --supabase-url https://example.supabase.co \
  --supabase-publishable-key sb_publishable_... \
  --supabase-schema app
```

The emitted app uses design-time Supabase values only as a fallback. Prefer environment-specific
values for staging and production. Legacy `--supabase-anon-key` and
`VITE_SUPABASE_ANON_KEY` inputs remain compatible, but new output uses the publishable-key name. Do
not set the new and legacy aliases to different values in one CLI/environment source; ambiguous
overrides fail closed.

## Application Runtime Readiness

For the production path from Supabase configuration through RLS verification, environment
isolation, static hosting, and manual server deployment, follow the dedicated
[Application Runtime Guide](./application-runtime).

The root **Supabase** panel separates public app configuration from management access:

- The project URL, publishable/legacy anon key, and optional schema are the browser runtime values.
  Known `sb_secret_*`, `sbp_*` Management PATs, and legacy `service_role` keys are rejected before
  they can enter a design or generated client bundle.
- **Schema Inspector** uses a Supabase personal access token from OpenPencil's unified credential
  store. The PAT is not written to the `.fig` document or reactive editor state. The local cache
  contains only a bounded normalized table/column/relation catalog, never the PAT or raw OpenAPI
  response.
- In Desktop **Backend Provider review**, choose **React** or **Vue** under **App framework** before
  generating a review. Staging Apply, capability verification, and source migration export use the
  reviewed framework. Switching frameworks clears the review and confirmation; generate a new
  review to continue. An unknown database operation still blocks that project across both frameworks.
- The RLS advisor combines event actions, named client workflows, LIST queries, Storage uploads,
  and server workflow queries/mutations. Its SQL is a reviewable starting point, not proof that the
  target database has the policy. In particular, UPDATE and DELETE also need matching SELECT
  visibility for the affected user rows.

Before deployment, the desktop Deploy panel runs the same read-only readiness audit and displays
errors and warnings. Preview, staging, and production target presets are isolated by document; Save
As and remote document bindings get distinct histories. Supabase overrides are passed to the child
build through a private environment channel so unrelated `VITE_SUPABASE_*` values inherited from
the process cannot silently replace the chosen target.

Built-in AI and MCP can call `audit_application_runtime`. It reports effective configuration
readiness, required table commands, schema mismatches, server environment variable **names**, and
whether generated server workflows still need deployment. It never returns secret values and does
not claim to inspect live RLS or deployment state. Supply `known_tables`, `rls_verified`, or
`server_workflows_deployed` only from checks you actually performed.

## Authenticated Server Workflows

Document-level server workflows are separate from client `lowcodeWorkflows`. The initial runtime is
deliberately narrow:

- Every endpoint is an authenticated Supabase-user `POST` request.
- Actions support bounded expressions, user-scoped Supabase queries/mutations, conditions, returns,
  calls to other validated server workflows, and outbound HTTPS requests.
- Secret values are never authored in the document. Sensitive outbound headers and other private
  values reference server environment variable names.
- The generated handler rejects oversized or malformed bodies, unsafe workflow/argument shapes,
  unauthenticated callers, credential-bearing or local/private outbound URLs, long requests, and
  oversized responses. It does not create a service-role client.

Use `read_server_workflows` and `set_server_workflows` from built-in AI/MCP to inspect or atomically
replace definitions. Add **Invoke server workflow** to a node event to call one definition and route
its result through success/error action branches.

`compile` emits these server-only files alongside the React project:

- `supabase/functions/openpencil-runtime/index.ts`
- `.env.server.example` containing required names only
- `openpencil-server.manifest.json`
- `SERVER_DEPLOYMENT.md`

`build` preserves them under `<outDir>/openpencil-server/`. Static `deploy` uploads only browser
files and prints a manual recipe for rebuilding a durable server bundle and running
`supabase functions deploy openpencil-runtime`. OpenPencil does not link a Supabase project, upload
the function, or configure its secrets automatically.

Hosted Edge Functions expose the new `SUPABASE_PUBLISHABLE_KEYS` JSON dictionary. The generated
handler selects its `default` key and falls back to the legacy `SUPABASE_ANON_KEY` only when the new
variable is completely absent. Empty or malformed new-key JSON fails closed. The `apikey` remains
separate from the caller's Bearer user JWT, which the handler verifies with `auth.getUser`.

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
- Secrets must not be embedded in designs. Use Supabase publishable keys (or legacy anon JWTs) and provider tokens through CLI flags or environment variables.
- Stripe checkout and customer portal actions are frontend triggers only. Put Stripe secret keys,
  webhooks, subscriptions, portal sessions, and customer lookup on your server endpoint.
- Analytics config is client-side only. Use public GA4 / Plausible / PostHog project ids, enable consent/DNT gates when required, and verify CSP requirements for your deployment.
- Custom head/CSS is static and CSS-only. JavaScript snippets are not emitted; review CSP for custom stylesheet or inline style usage.
- Browser editing works, but the live preview sidecar and deploy controls are desktop-only.
- Cloudflare deploys require an existing account id and Pages project name.
- For multi-page apps, your host must route unknown paths back to `index.html`.

## Common Fixes

- Preview says it is unavailable: use the desktop app; the sidecar is not available in the browser app.
- Supabase works in preview but not production: pass `--supabase-url` and `--supabase-publishable-key`, or set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` before `build` / `deploy`. The old anon-key names are compatibility fallbacks only.
- Analytics events do not appear: confirm the provider id, check that the host allows the provider script in CSP, and wait for the provider dashboard's normal ingestion delay.
- A deployed route returns 404 after refresh: configure the host as an SPA and route unknown paths to `index.html`.
- Cloudflare deploy fails before upload: pass `--account-id`, set `CLOUDFLARE_ACCOUNT_ID`, or use `--site <account>/<project>`.
- i18n output has missing translations: inspect the emitted `src/locales/_coverage.json` and fill the target locale catalog.


### Multi-select and local selection modules

Select's visual inspector now has **Allow multiple selections** and per-option defaults. Multiple mode binds `value` to an array of strings; single mode keeps its string contract. Unbind the existing value before changing modes, then bind a state of the matching type. Search and virtual scrolling work with either mode. Selecting a result keeps a multiple menu open; Clear removes every selection and Backspace on the closed trigger removes the last enabled choice. An authored empty-string option is a real value, distinct from an empty selection. Existing `$value` event shorthand remains the first native selected value; use the bound array state for all selected values.

Enable **Date Range**, **Tree / TreeSelect**, or **Popover** in Plugins, then insert them from the module tool or Assets templates. Date Range uses native date inputs, ISO initial values and min/max bounds; an inverted or incomplete runtime range shows an error without silently rearranging dates. Tree supports editable hierarchy, search, single/multiple independent selection, disabled branches, initial expansion and keyboard navigation. TreeSelect expands within its authored container; leave enough height for the list. Date Range supports optional page/document state bindings and independent FORM endpoints. Tree selection remains instance-local. Neither configures backend data access.

Popover has content and confirmation modes, trigger/panel styling and preferred placement. Its content layer is an ordinary editable direct child selected by a unique name. The plain-text body is used only when no content mapping is configured. A missing, ambiguous or unrenderable mapped child produces `module-content-child-invalid` and leaves the content empty. Escape, outside click and focus leaving dismiss it. Confirmation/cancellation only show local status. Add explicit business actions to ordinary content buttons when needed. Modern browsers use the Popover top layer; the local fallback may be clipped by an overflow ancestor. Canvas shows the trigger; use Edit content for child layers and compiled preview for the open floating panel.

React and Vue are the verified web targets. Native/mobile targets report unsupported behavior. Expo, Flutter, WeChat Mini Program, Taro, uni-app and Mpx omit multiple SELECT controls with the stable `{target}-select-multiple-unsupported` diagnostic; other nodes continue to export. `.fig` preserves the configuration in ordinary OpenPencil module metadata; Figma does not gain these runtime interactions.

### Form module bindings and Cascader

Slider/Range, Rating, Date Range and Cascader expose Value bindings and Validation rules in the design panel. Create writable page/document state first: number for sliders/ratings, separate ISO date strings for start/end dates, and a string[] root-to-leaf path for Cascader. Computed states cannot be write targets. Range endpoints bind and validate independently; clearing a binding restores instance-local initial values.

Bound fields participate in FORM validation and reset. Required Rating treats zero as unselected; zero can be valid for Slider. Missing, mistyped or invalid bound values remain visibly unavailable instead of falling back to examples. Reset restores declared state defaults and invalidates late validation; cancelled reset and unmounted fields preserve the actual form boundary. Canvas displays authored state defaults, not live preview state.

Enable **Cascader** in Settings → Plugins, then insert its module or `cascader` template. Edit hierarchical items, parents, disabled entries and the initial leaf, plus colors, radius, row height, search and clearing. React/Vue supports progressive columns, full-path search, keyboard navigation, disabled branches and clearing; only a leaf selection commits a path. Limits are 128 local items and six levels. Remote loading, multi-select and cascading checkboxes are outside this version. Unbound values stay instance-local. Binding does not configure network requests, database access or persistence.

Ordinary FRAME geometry and versioned metadata remain portable in `.fig`; this does not make the interactions executable in Figma. Real Tauri, another computer's fonts and screen-reader behavior require separate acceptance.

Readonly controls retain their values for serialization but do not block constraint validation. Module fields belong to their surrounding FORM; explicit `interactiveProps.form` reassignment is unsupported and disables the control with a compiler warning.
