# OpenPencil JSX Reference

## Elements

| Tag        | Description                              |
| ---------- | ---------------------------------------- |
| Frame      | Container / auto-layout frame            |
| Rectangle  | Rectangle shape                          |
| Ellipse    | Circle / ellipse shape                   |
| Text       | Text node (children = text content)      |
| Line       | Line shape                               |
| Star       | Star shape                               |
| Polygon    | Polygon shape (default 3 sides)          |
| Vector     | Vector path                              |
| Group      | Group container                          |
| Section    | Section (like Frame, for organization)   |
| Component  | Component definition                     |
| Icon       | Iconify icon (requires name prop)        |
| Button     | Lowcode button (`BUTTON`)                |
| Input      | Lowcode single-line input (`INPUT`)      |
| Select     | Lowcode select (`SELECT`)                |
| Checkbox   | Lowcode checkbox/group (`CHECKBOX`)      |
| Form       | Lowcode form container (`FORM`)          |
| List       | Lowcode repeated-list container (`LIST`) |
| Radio      | Lowcode radio group (`RADIO`)            |
| Textarea   | Lowcode multiline input (`TEXTAREA`)     |
| DatePicker | Lowcode date input (`DATEPICKER`)        |
| Switch     | Lowcode switch (`SWITCH`)                |

Aliases: View = Frame, Rect = Rectangle

## Lowcode Control Props

Lowcode tags create the corresponding SceneGraph `NodeType`; they are not visual Frames with inferred roles. Use the real tag whenever the design must remain interactive or compile as lowcode.

| Element          | Convenience props                                              |
| ---------------- | -------------------------------------------------------------- |
| Button           | `text`; string children also set the label and take precedence |
| Input, Textarea  | `placeholder`, `value`                                         |
| Select           | `options: string[]`, `value`                                   |
| Checkbox, Switch | `checked: boolean`                                             |
| Checkbox         | `options: string[]` for group mode                             |
| Radio            | `options: string[]`, `value`, `groupName`                      |
| DatePicker       | `value`, `min`, `max` as ISO `YYYY-MM-DD`                      |
| Form, List       | Container children; use normal layout props                    |

All ten tags accept `interactiveProps={{...}}` for JSON-safe advanced properties. Direct convenience props override duplicate keys in the object, and Button child text overrides both. The renderer validates field-validation schemas and DATEPICKER dates before creating any node. Exported JSX and `get_jsx` are structural projections: they retain visible structure and `interactiveProps`, but not `bindings`, `events`, `stateOverrides`, or `renderCondition`. Use `read_lowcode_node` to inspect those fields and `update_lowcode_node` after rendering to write them.

```jsx
<Form name="Signup" w={320} flex="col" gap={12} p={16}>
  <Input name="Email" placeholder="Email address" />
  <Select name="Plan" options={['Free', 'Pro']} value="Free" />
  <Button name="Submit">Create account</Button>
</Form>
```

## Layout Props

| Prop           | Type                                      | Description                    |
| -------------- | ----------------------------------------- | ------------------------------ |
| flex           | "row" \| "col"                            | Enable auto-layout direction   |
| gap            | number                                    | Spacing between children       |
| wrap           | boolean                                   | Enable flex wrap               |
| rowGap         | number                                    | Cross-axis gap when wrap is on |
| justify        | "start" \| "end" \| "center" \| "between" | Main axis alignment            |
| items          | "start" \| "end" \| "center" \| "stretch" | Cross axis alignment           |
| p              | number                                    | Padding (all sides)            |
| px             | number                                    | Horizontal padding             |
| py             | number                                    | Vertical padding               |
| pt, pr, pb, pl | number                                    | Individual side padding        |
| grow           | number                                    | Flex grow factor               |

## Sizing Props

| Prop     | Type                      | Description                             |
| -------- | ------------------------- | --------------------------------------- |
| w        | number \| "fill" \| "hug" | Width                                   |
| h        | number \| "fill" \| "hug" | Height                                  |
| x        | number                    | X position                              |
| y        | number                    | Y position                              |
| position | "absolute"                | Absolute positioning inside auto-layout |
| top      | number                    | Top offset (sets absolute positioning)  |
| left     | number                    | Left offset (sets absolute positioning) |
| minW     | number                    | Minimum width                           |
| maxW     | number                    | Maximum width                           |

## Appearance Props

| Prop            | Type     | Description                            |
| --------------- | -------- | -------------------------------------- |
| bg              | string   | Background color (hex, e.g. "#FF0000") |
| stroke          | string   | Stroke color                           |
| strokeWidth     | number   | Stroke weight (default 1)              |
| rounded         | number   | Corner radius (all corners)            |
| roundedTL       | number   | Top-left corner radius                 |
| roundedTR       | number   | Top-right corner radius                |
| roundedBL       | number   | Bottom-left corner radius              |
| roundedBR       | number   | Bottom-right corner radius             |
| cornerSmoothing | number   | iOS-style corner smoothing             |
| opacity         | number   | 0–1 opacity                            |
| rotate          | number   | Rotation in degrees                    |
| blendMode       | string   | Blend mode (e.g. "multiply")           |
| overflow        | "hidden" | Clip content                           |

## Text Props

| Prop           | Type                                         | Description                            |
| -------------- | -------------------------------------------- | -------------------------------------- |
| size           | number                                       | Font size (default 14)                 |
| font           | string                                       | Font family                            |
| weight         | number \| "bold" \| "medium"                 | Font weight                            |
| color          | string                                       | Text color (hex)                       |
| textAlign      | "left" \| "center" \| "right" \| "justified" | Text alignment                         |
| lineHeight     | number                                       | Line height in px                      |
| letterSpacing  | number                                       | Letter spacing in px                   |
| textDecoration | "underline" \| "strikethrough"               | Text decoration                        |
| textCase       | "upper" \| "lower" \| "title"                | Text transform                         |
| maxLines       | number                                       | Max visible lines (enables truncation) |
| truncate       | boolean                                      | Enable text truncation                 |

## Shape Props

| Prop        | Type   | Description                                     |
| ----------- | ------ | ----------------------------------------------- |
| points      | number | Point count (Star default 5, Polygon default 3) |
| innerRadius | number | Star inner radius ratio                         |

## Effect Props

| Prop   | Type   | Description                               |
| ------ | ------ | ----------------------------------------- |
| shadow | string | Drop shadow: "offsetX offsetY blur color" |
| blur   | number | Layer blur radius                         |

## Grid Layout

| Prop      | Type             | Description                                     |
| --------- | ---------------- | ----------------------------------------------- |
| grid      | boolean          | Enable CSS Grid layout                          |
| columns   | string \| number | Grid template columns (e.g. "1fr 1fr 1fr" or 3) |
| rows      | string \| number | Grid template rows                              |
| columnGap | number           | Column gap                                      |
| rowGap    | number           | Row gap                                         |
| colStart  | number           | Grid column start (child)                       |
| rowStart  | number           | Grid row start (child)                          |
| colSpan   | number           | Grid column span (child)                        |
| rowSpan   | number           | Grid row span (child)                           |

## Icon Props

| Prop  | Type   | Description                             |
| ----- | ------ | --------------------------------------- |
| name  | string | Iconify icon name (e.g. "lucide:heart") |
| size  | number | Icon size (default 24)                  |
| color | string | Icon color (hex)                        |
| label | string | Display name for the icon node          |

## Examples

```jsx
{
  /* Card with title and description */
}
;<Frame name="Card" w={320} flex="col" gap={16} p={24} bg="#FFFFFF" rounded={16}>
  <Text size={18} weight="bold" color="#111">
    Card Title
  </Text>
  <Text size={14} color="#6B7280">
    Description text here
  </Text>
</Frame>

{
  /* Badge in corner of a card */
}
;<Frame name="Card" w={320} h={200} flex="col" p={24} bg="#FFFFFF" rounded={16}>
  <Frame position="absolute" top={8} left={280} w={24} h={24} bg="#EF4444" rounded={12}>
    <Text size={10} weight="bold" color="#FFF">
      3
    </Text>
  </Frame>
  <Text size={18} weight="bold" color="#111">
    Card Title
  </Text>
</Frame>

{
  /* Horizontal button row */
}
;<Frame flex="row" gap={8} items="center">
  <Rectangle w={40} h={40} bg="#3B82F6" rounded={8} />
  <Text size={14} weight="medium" color="#000">
    Click me
  </Text>
</Frame>

{
  /* Grid layout */
}
;<Frame grid columns="1fr 1fr 1fr" gap={16} p={16} w={400}>
  <Rectangle w={100} h={100} bg="#EF4444" rounded={8} />
  <Rectangle w={100} h={100} bg="#22C55E" rounded={8} />
  <Rectangle w={100} h={100} bg="#3B82F6" rounded={8} />
</Frame>

{
  /* Star shape */
}
;<Star w={48} h={48} points={5} innerRadius={0.38} bg="#EAB308" />
```
