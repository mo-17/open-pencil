# Lowcode GUI ACK Test Steps

> 2026-06-24 handoff for manual browser/Tauri verification after the §14 local Libraries panel, #10 preview i18n/uiKit toggle, and #11 lowcode authorization GUI work.

## 0. Scope

This checklist is for real app verification only. Unit, architecture, duplicate, Vue typecheck, and full `bun run check` already passed for the latest §14 commit.

Primary ACK target:

- §14 Libraries panel: local manifest + library file flow, outdated status, accept update, undo/redo.

Secondary ACK targets:

- #10 Preview i18n/uiKit toolbar controls.
- #11 Lowcode GUI authorization panels for responsive overrides, component props, and optional params.

## 1. Baseline

From repo root:

```sh
git status --short
git log -1 --oneline
git ls-remote upstream refs/heads/lowcode-rebaseline
```

Expected:

- Tracked working tree is clean, except local ignored `prompt.md` may differ.
- Local head is at least `829eb4e0 feat(app): add lowcode libraries panel`.
- Remote `upstream/lowcode-rebaseline` points at `829eb4e0270a2de3b7e92ae1b80e1fbe6d7d0903` or a later intended commit.

## 2. Prepare §14 Fixture Files

Create a repeatable local fixture directory:

```sh
mkdir -p /tmp/open-pencil-library-ack
bun run build:packages
```

Create `library.fig` and `consumer.fig`:

```sh
bun --eval '
import { BUILTIN_IO_FORMATS, IORegistry } from "@open-pencil/core/io";
import { SceneGraph } from "@open-pencil/core/scene-graph";

const io = new IORegistry(BUILTIN_IO_FORMATS);

async function writeGraph(path, graph) {
  const result = await io.writeDocument("fig", graph);
  await Bun.write(path, result.data);
}

const library = new SceneGraph();
const page = library.getPages()[0];
const card = library.createNode("COMPONENT", page.id, {
  name: "Card",
  width: 240,
  height: 80
});
library.createNode("TEXT", card.id, {
  name: "Title",
  text: "Hello",
  width: 120,
  height: 24
});

await writeGraph("/tmp/open-pencil-library-ack/library.fig", library);
await writeGraph("/tmp/open-pencil-library-ack/consumer.fig", new SceneGraph());
'
```

Publish v1 and import it into the consumer:

```sh
bun packages/cli/src/index.ts library publish \
  /tmp/open-pencil-library-ack/library.fig \
  --component Card \
  --library-id design-system \
  --library-name "Design System" \
  --component-key component-card \
  --source-ref /tmp/open-pencil-library-ack/library-published-v1.fig \
  --document-output /tmp/open-pencil-library-ack/library-published-v1.fig \
  --json \
  -o /tmp/open-pencil-library-ack/manifest-v1.json

bun packages/cli/src/index.ts library import \
  /tmp/open-pencil-library-ack/consumer.fig \
  /tmp/open-pencil-library-ack/library-published-v1.fig \
  --manifest /tmp/open-pencil-library-ack/manifest-v1.json \
  --component component-card \
  --json \
  -o /tmp/open-pencil-library-ack/consumer-imported.fig
```

Modify the library to v2 and publish a newer manifest:

```sh
bun --eval '
import { BUILTIN_IO_FORMATS, IORegistry } from "@open-pencil/core/io";

const io = new IORegistry(BUILTIN_IO_FORMATS);

async function readGraph(path) {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  const { graph } = await io.readDocument({ name: path, data: bytes });
  return graph;
}

async function writeGraph(path, graph) {
  const result = await io.writeDocument("fig", graph);
  await Bun.write(path, result.data);
}

const graph = await readGraph("/tmp/open-pencil-library-ack/library-published-v1.fig");
const card = [...graph.getAllNodes()].find((node) => node.type === "COMPONENT" && node.name === "Card");
if (!card) throw new Error("Card component not found");
const title = card.childIds.map((id) => graph.getNode(id)).find((node) => node?.type === "TEXT");
if (!title) throw new Error("Card title not found");
graph.updateNode(title.id, { text: "Updated" });
await writeGraph("/tmp/open-pencil-library-ack/library.fig", graph);
'

bun packages/cli/src/index.ts library publish \
  /tmp/open-pencil-library-ack/library.fig \
  --component Card \
  --library-id design-system \
  --library-name "Design System" \
  --component-key component-card \
  --source-ref /tmp/open-pencil-library-ack/library-published-v2.fig \
  --document-output /tmp/open-pencil-library-ack/library-published-v2.fig \
  --json \
  -o /tmp/open-pencil-library-ack/manifest-v2.json

bun packages/cli/src/index.ts library check \
  /tmp/open-pencil-library-ack/consumer-imported.fig \
  --manifest /tmp/open-pencil-library-ack/manifest-v2.json \
  --json
```

Expected CLI check:

- `component-card` reports `outdated`.

## 3. §14 Browser/Tauri ACK

Start one runtime:

```sh
bun run dev
```

or, for desktop:

```sh
bun run tauri dev
```

Manual steps:

1. Open `/tmp/open-pencil-library-ack/consumer-imported.fig`.
2. Make sure no node is selected, so the right Design panel root sections are visible.
3. Find the `Libraries` section.
4. Confirm it shows one import:
   - library: `Design System`
   - component key: `component-card`
   - status before manifest load: `unknown`
5. Click `Manifest`, choose `/tmp/open-pencil-library-ack/manifest-v2.json`.
6. Confirm row status changes to `outdated`, with current version different from latest version.
7. Click `Library file`, choose `/tmp/open-pencil-library-ack/library-published-v2.fig`.
8. Confirm `Accept update` is enabled for the outdated row.
9. Click `Accept update`.
10. Confirm success text appears and the row changes to `up-to-date`.
11. Confirm the imported/cached component text changes from `Hello` to `Updated`.
12. Run undo and redo from the app UI or keyboard shortcuts.

Pass criteria:

- No console/runtime error during file load, status calculation, accept, undo, or redo.
- Accept update visibly applies the newer cached library component.
- Undo restores the pre-accept document; redo reapplies the update.
- Saving and reopening the document keeps the updated library metadata.

## 4. #10 Preview i18n/uiKit ACK

Use any lowcode document with at least one visible page. Start in Tauri if possible because preview sidecar is desktop-only.

Steps:

1. Open the lowcode preview pane.
2. Confirm toolbar controls are visible:
   - `data-test-id="lowcode-preview-uikit"`
   - `data-test-id="lowcode-preview-i18n"`
   - `data-test-id="lowcode-preview-locales"`
3. Set UI kit to `shadcn`.
4. Enable i18n.
5. Enter locales such as `en,zh-CN`.
6. Trigger preview reload/recompile.

Pass criteria:

- Preview recompiles without runtime error.
- The toolbar state remains stable across reloads.
- Generated preview still renders the selected page.
- Invalid locale text should not crash the app; it may show compile feedback if validation rejects it.

## 5. #11 Authorization GUI ACK

Use a document with lowcode nodes that can exercise the already implemented panels:

- Responsive overrides.
- Component props.
- Optional params.

Steps:

1. Select a lowcode node with responsive override fields.
2. Change a responsive override value through the GUI.
3. Select a component/instance with component props.
4. Add or update a component prop through the GUI.
5. Select a workflow/action surface that exposes optional params.
6. Add and remove one optional param.
7. Save, reopen, and verify values persist.

Pass criteria:

- Each GUI operation writes the expected lowcode field without direct JSON editing.
- Invalid input is blocked or surfaced as validation feedback.
- Save/reopen round-trip preserves valid values.
- Undo/redo works for the edited GUI values.

## 6. Closeout

If all ACKs pass:

1. Update `docs/lowcode-phase-4.md`:
   - Mark #8 §14 from `已完成(待真机 ACK)` to `已完成`.
   - Mark #10 and #11 ACK text as true-machine verified.
2. Update local `prompt.md` with the ACK results and next recommendation.
3. Run at least:

```sh
git diff --check
bun run check:vue
bun run check:arch
```

If any ACK fails:

1. Capture exact runtime, command, document path, and reproduction step.
2. Fix the smallest affected surface.
3. Re-run the failed ACK plus the relevant targeted tests.
