---
title: JSX Renderer
description: Create designs with JSX — the syntax LLMs already know from millions of React components.
---

# JSX Renderer

OpenPencil uses JSX as its design creation language. LLMs have seen millions of React components — describing a layout as `<Frame><Text>` is natural, no special training needed. Every token matters when an AI agent performs dozens of operations, and JSX is the most compact declarative representation.

JSX is also diffable. When an AI modifies a design, the change is a JSX diff — readable, reviewable, version-controllable.

## Creating Designs

The `render` tool (available in AI chat, MCP, and CLI eval) accepts JSX:

```jsx
<Frame name="Card" w={320} h="hug" flex="col" gap={16} p={24} bg="#FFF" rounded={16}>
  <Text size={18} weight="bold">
    Card Title
  </Text>
  <Text size={14} color="#666">
    Description text
  </Text>
</Frame>
```

In the MCP server and AI chat, the `render` tool accepts JSX strings directly. In the CLI, use the `export` command to go the other direction — [exporting designs as JSX](./cli/exporting).

## Elements

All node types are available as JSX elements:

| Element        | Creates                                  | Aliases  |
| -------------- | ---------------------------------------- | -------- |
| `<Frame>`      | Frame (container, supports auto-layout)  | `<View>` |
| `<Rectangle>`  | Rectangle                                | `<Rect>` |
| `<Ellipse>`    | Ellipse / circle                         |          |
| `<Text>`       | Text node (children become text content) |          |
| `<Line>`       | Line                                     |          |
| `<Star>`       | Star                                     |          |
| `<Polygon>`    | Polygon                                  |          |
| `<Vector>`     | Vector path                              |          |
| `<Group>`      | Group                                    |          |
| `<Section>`    | Section                                  |          |
| `<Button>`     | Lowcode button                           |          |
| `<Input>`      | Lowcode text input                       |          |
| `<Select>`     | Lowcode select                           |          |
| `<Checkbox>`   | Lowcode checkbox or checkbox group       |          |
| `<Form>`       | Lowcode form container                   |          |
| `<List>`       | Lowcode repeated-list container          |          |
| `<Radio>`      | Lowcode radio group                      |          |
| `<Textarea>`   | Lowcode multiline input                  |          |
| `<DatePicker>` | Lowcode date input                       |          |
| `<Switch>`     | Lowcode switch                           |          |

### Lowcode controls

The lowcode elements above create real lowcode node types, so the built-in AI, compiler, and Figma-compatible export path can preserve their behavior. Use them instead of styling a `<Frame>` to look like a control.

```jsx
<Form name="Signup" w={320} flex="col" gap={12} p={16}>
  <Input name="Email" placeholder="Email address" textColor="#111827" placeholderColor="#6B7280" />
  <Select name="Plan" options={['Free', 'Pro']} value="Free" />
  <Button name="Submit" textColor="#F9FAFB">
    Create account
  </Button>
</Form>
```

Convenience props include `text`, `placeholder`, `value`, `textColor`, `placeholderColor`, `options`, `checked`, `groupName`, `min`, and `max`. Button, Input, and Textarea text colors accept canonical `#RRGGBB` values and apply only to that control; Input and Textarea also accept `placeholderColor`. For advanced JSON-safe configuration, pass an `interactiveProps` object; invalid validation schemas, text colors, and malformed date values are rejected before creation. Add bindings, events, state overrides, and render conditions with `update_lowcode_node` after rendering.

## Style Props

Compact shorthand props inspired by Tailwind's naming.

### Layout

| Prop                                    | Description                                 |
| --------------------------------------- | ------------------------------------------- |
| `flex`                                  | `"row"` or `"col"` — enables auto-layout    |
| `gap`                                   | Space between children                      |
| `wrap`                                  | Wrap children to next line                  |
| `rowGap`                                | Counter-axis spacing when wrapping          |
| `justify`                               | `"start"`, `"end"`, `"center"`, `"between"` |
| `items`                                 | `"start"`, `"end"`, `"center"`, `"stretch"` |
| `p`, `px`, `py`, `pt`, `pr`, `pb`, `pl` | Padding                                     |

### Size & Position

| Prop                           | Description                                 |
| ------------------------------ | ------------------------------------------- |
| `w`, `h`                       | Width/height — number, `"fill"`, or `"hug"` |
| `minW`, `maxW`, `minH`, `maxH` | Size constraints                            |
| `x`, `y`                       | Position                                    |

### Appearance

| Prop              | Description                                                           |
| ----------------- | --------------------------------------------------------------------- |
| `bg`              | Background fill (hex color)                                           |
| `fill`            | Alias for `bg`                                                        |
| `stroke`          | Stroke color                                                          |
| `strokeWidth`     | Stroke width (default: 1)                                             |
| `rounded`         | Corner radius (or `roundedTL`, `roundedTR`, `roundedBL`, `roundedBR`) |
| `cornerSmoothing` | iOS-style smooth corners (0–1)                                        |
| `opacity`         | 0–1                                                                   |
| `shadow`          | Drop shadow (e.g. `"0 4 8 #00000040"`)                                |
| `blur`            | Layer blur radius                                                     |
| `rotate`          | Rotation in degrees                                                   |
| `blendMode`       | Blend mode                                                            |
| `overflow`        | `"hidden"` or `"visible"`                                             |

### Typography

| Prop                    | Description                                    |
| ----------------------- | ---------------------------------------------- |
| `size` / `fontSize`     | Font size                                      |
| `font` / `fontFamily`   | Font family                                    |
| `weight` / `fontWeight` | `"bold"`, `"medium"`, `"normal"`, or number    |
| `color`                 | Text color                                     |
| `textAlign`             | `"left"`, `"center"`, `"right"`, `"justified"` |

## Exporting to JSX

Convert existing designs back to JSX:

```sh
openpencil export design.fig -f jsx                   # OpenPencil format
openpencil export design.fig -f jsx --style tailwind  # Tailwind classes
```

OpenPencil JSX export is a **structural projection**, not a full document-persistence format. It preserves visible hierarchy, layout and appearance, real lowcode control types, and `interactiveProps`, so those parts can be modified and rendered back. It intentionally omits lowcode behavior fields such as `bindings`, `events`, `stateOverrides`, and `renderCondition`. Use `read_lowcode_node` to inspect those fields and `update_lowcode_node` to write them after rendering. Use `.fig` when the complete lowcode semantics must persist.

## Visual Diffing

Because designs are representable as JSX, changes become code diffs:

```diff
 <Frame name="Card" w={320} flex="col" gap={16} p={24} bg="#FFF">
-  <Text size={18} weight="bold">Old Title</Text>
+  <Text size={24} weight="bold" color="#1D1B20">New Title</Text>
   <Text size={14} color="#666">Description</Text>
 </Frame>
```

This makes design changes reviewable in pull requests, trackable in version control, and auditable in CI.
