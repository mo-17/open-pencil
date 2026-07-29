# @open-pencil/pen

Pencil.dev `.pen` document parser, SceneGraph adapter, and source-preserving MotionSpec writer.

This package owns the `.pen` document model and import policy. It depends on `@open-pencil/scene-graph` for the shared editable design model and does not depend on `@open-pencil/core`.

`parsePenFile()` reads OpenPencil MotionSpec data from the official Pencil entity `metadata`
extension slot. `serializePenFile()` writes Motion-only edits back into that same source document while
preserving unrelated foreign metadata and unmodified future or malformed OpenPencil payloads. A
current-schema `motion: null` tombstone keeps refs and nested descendant overrides explicitly cleared
after save/reopen. The writer rejects Motion edits that conflict with an unknown metadata schema, as
well as new documents and structural, visual, variable, or document-metadata edits; save those as
`.fig` until full SceneGraph-to-Pencil serialization is available.
