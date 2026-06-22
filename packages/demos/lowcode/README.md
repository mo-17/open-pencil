# Lowcode Demo Fixtures

Generated `.fig` examples for manual lowcode and layout round-trip verification.

| File                               | Purpose                                                                                     | Generator                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `lowcode-v5-test.fig`              | Switch, radio, and checkbox-group interaction smoke doc.                                    | `tools/lowcode/src/make-v5-testdoc.ts`               |
| `lowcode-v6-test.fig`              | Empty interactive nodes for property-panel authoring checks.                                | `tools/lowcode/src/make-v6-testdoc.ts`               |
| `lowcode-v7-test.fig`              | Figma-compatible child FILL layout verification.                                            | `tools/lowcode/src/make-v7-testdoc.ts`               |
| `lowcode-realmachine-test.fig`     | Combined real-machine lowcode verification for responsive, components, i18n, and workflows. | `tools/lowcode/src/make-realmachine-testdoc.ts`      |
| `layout-roundtrip-test.fig`        | Manual layout round-trip verification for known `.fig` layout fields.                       | `tools/lowcode/src/make-layout-roundtrip-testdoc.ts` |
| `fig-layout-roundtrip-findings.md` | Historical investigation notes for layout round-trip bugs.                                  | n/a                                                  |

Regenerate a fixture from the repo root with:

```sh
bun tools/lowcode/src/make-v7-testdoc.ts
```
