# Native Gold metadata regression fixture

`gold-figma-baseline.fig` is a native Figma export supplied by the repository owner on
2026-10-05, after importing `gold-preview.fig` into an independent personal draft.
The unedited export contains 3,519 records and 945 authored instances with 2,783
token plugin entries. Partial instance claims exercise preservation of unclaimed
`tokens-borderRadius`, `tokens-hash`, and `tokens-version` entries.

- Size: 558,553 bytes
- SHA-256: `388c4dee2bd010d2775ea36409ca370d73b6400a308c3b4e723514a55edbfd4c`
- Native export timestamp: `2026-10-05T06:38:34.218Z`
- Stored with the existing `tests/fixtures/*.fig` Git LFS rule.

Package FIG tests cover full reading and lazy session recovery. Core heavy tests
force an edit and check both export profiles, rather than accepting original-byte
passthrough. This archive does not contain `colorVariableBinding` and is not a live
Figma Plugin API oracle for geometry, component identity, or override semantics.
