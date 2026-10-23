---
title: Local editing and delivery workflows
description: Use export preflight, runtime traces, document checkpoints, template setup and personal content filters.
---

# Local editing and delivery workflows

These workflows are available in the current development version. They build on the existing document, Lowcode, Motion and export paths. Availability in the editor does not establish that a generated application, external service or native distribution has passed runtime acceptance.

## Export preflight

Open **Export preflight** in the properties panel's Export section. **Check current target** checks the selected export roots and format. The report identifies missing image resources, missing or pending Shader frames, saved-frame fallbacks and unsupported own-content filters. **Locate layer** selects an issue's layer, including on another page.

The document export and source-project export actions also populate the report. Source-project reports include the compiler's diagnostics from that export. The report names its format and warns when it belongs to another target; run **Check current target** to replace it with the current resource check. Document edits invalidate the report.

For static visual and source targets, inspection follows the same content projection as export. A usable saved content-filter frame can represent its whole decorative subtree. A filter that becomes unsupported preserves its authored controls and reports a warning. Editable `.fig` and `.pen` reports treat missing resources as warnings; the actual export still follows its serializer and Shader-frame requirements.

Preflight checks resource presence and reports compiler diagnostics. It does not run generated projects, validate every image's pixels, contact providers, test credentials, or prove that database and login settings work. Rendering and writing can still fail. Each scan bounds work to 10,000 visited references and displays at most 100 issues; a truncated report does not establish readiness for the unchecked content.

See [Exporting](../user-guide/exporting.md) and the [Shader host contract](./shaders.md) for static-frame behavior.

## Lowcode runtime debug

In the embedded React or Vue compiler preview, open **Runtime debug**, then interact with the preview. The panel groups event, action, expression, request and state steps by trace. It shows identifiers, completion or failure, request method/status and elapsed time. Use **Pause**, **Clear**, or **Select layer** to inspect a short interaction.

Recording is opt-in and retains the latest 200 entries in the preview session. Entries omit field values, expression contents, request URLs, headers and bodies. They are diagnostic metadata rather than a replayable state snapshot. Preview reloads and document changes reset the trace; closing the panel stops recording. Other compiler targets and external backend runtimes do not acquire this instrumentation.

The browser Worker preview keeps its existing Content Security Policy, including `connect-src 'none'`. Recording does not grant network access: a network request may be recorded as failed because the preview blocks it. Use the existing backend preview or the exported application's runtime to verify a real service connection, authentication and authorization.

## Named local checkpoints

Click **Local checkpoints**, the history button beside the document title. Enter a name and choose **Create checkpoint** to save a manual FIG snapshot on this device. These versions are separate from automatic crash recovery and from exported files.

Choose **Compare with current document** to inspect added, removed and changed layers, changed field names, and variable, image-resource or document-metadata changes. This is a structural comparison, not a pixel diff. The list shows at most 200 changed layers. An edit while comparison is decoding rejects the obsolete result; an edit after comparison clears that result.

**Open checkpoint as new document** first saves a safety checkpoint of the current document. It then opens the selected version in a new, unsaved tab, with no writable file or remote storage binding. The original tab keeps its edits, source binding and undo history. If the safety snapshot cannot be stored, restore stops before opening the copy.

Storage limits are 20 checkpoints per document, 100 in total, 32 MiB per snapshot and 128 MiB in total. Safety copies count toward these limits. Nothing is evicted automatically; delete an unwanted version explicitly when storage is full. A storage failure is reported rather than presented as a durable save.

Paths and storage-document identities group versions across reopening. Browser documents without a source path, including handle-only files, use a session key; **Show checkpoints from all documents** makes their retained versions available after reopening. Checkpoints live in this application's local IndexedDB storage. Clearing application or browser data removes them, so retain ordinary saved/exported files as well. There is no cloud history or cross-device synchronization for checkpoints.

## Business-template setup

Open **Template setup** under **Services & Workflows → Backend model**. The wizard uses the existing application templates and their enabled NestJS provider:

1. Choose a template.
2. Select the verified provider and configure public sign-in settings.
3. Review the configuration and create editable pages plus the backend declaration in one undoable operation.

The readiness view links to the existing plugin manager, Backend editor, sign-in settings, application pages and compiler preview. It distinguishes saved configuration from unsaved drafts. Existing documents retain their pages and authentication; a document using another provider continues through its existing Backend editor.

“Configured locally” means that the required document metadata is present. Creation does not start NestJS, apply SQL, discover an OIDC issuer, grant roles or deploy an application. Prepare the PostgreSQL database, public client callback, issuer/JWT configuration and role assignments through the existing runtime workflow. Server secrets and database credentials belong in runtime settings, not in the wizard's public login fields.

Desktop backend preview and an exported React/Vue application's startup remain separate steps. See [NestJS backend](./backend-nestjs.md) for their setup and verification boundaries.

## Personal Shader filters and batch edits

In an own-content filter's inspector, **Personal filter presets** saves up to 24 named Pixelate, Twirl or Saturation parameter presets in local browser/application storage. Names contain 1–48 characters; saving an existing name updates that entry. Presets contain filter parameters only, without source images, document content or GPU handles. Storage failures remain visible.

To apply a saved preset or edit parameters across a selection, every selected layer must already have an own-content filter and satisfy the static sampling contract. Overlapping parent/child selections and unsupported runtime subtrees are rejected. The panel explicitly shows the first selected filter's parameters and status; applying or editing updates all compatible selected layers through the existing undoable command.

The supported source scope remains static images, text and decorative containers. Controls keep their real DOM interactions, and Motion and `generatedEffect` retain their existing contracts. Failed rendering keeps an available saved frame; ordinary own-content HTML, React/Vue and Lowcode exports keep their static fallback without adding a Shader runtime. Custom stacks remain custom, and background sampling and Shader video export are outside this feature. See [Shader host contract](./shaders.md) for the full support limits.
