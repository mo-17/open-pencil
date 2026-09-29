---
title: Variables
description: Design variables, collections, modes, and fill bindings in OpenPencil.
---

# Variables

Variables store reusable design tokens — colors, spacing values, and other properties — that can be bound to nodes. Change a variable's value and every node using it updates.
## Opening the Variables Dialog

With no nodes selected, the Design tab shows page-level properties including a Variables section with collection and variable counts. Click the settings icon to open the variables dialog.

## Optional Design Presets

Choose **Design system presets** from the variables dialog, including its empty state. Preview **Business**, **Soft** or **Bold contrast**, then explicitly import the selected preset. Each provides six color variables and six numeric variables with Light and Dark modes.

Importing creates a separate collection and selects it in the dialog. Existing canvas nodes, variables and bindings keep their current values. Repeated imports receive numbered collection names and namespaced variable names, so they remain distinguishable in binding pickers. Closing the preset preview without importing makes no document change.

After import, select a node and use the existing variable picker beside a supported property, such as fill or corner radius. Choose the imported variable to apply it to that property. Edit its values in the variables dialog or detach the binding to keep the resolved value as an ordinary property. Use Undo to reverse a binding or, immediately after import, remove the whole imported collection in one step. Collections and bindings are saved with the design's `.fig` file.

These are editable starting points. Choosing a preset does not switch the editor theme, restyle the document or require a particular component framework.

## Collections

Variables are organized into collections. Each collection appears as a tab in the dialog.

- **Switch collection** — click a tab
- **Rename collection** — double-click the tab name

## Modes

Each collection can have multiple modes (e.g., Light and Dark). Modes appear as columns in the variables table. A variable has a value for each mode.

### Adding Collections and Modes

Create a new collection from the dialog toolbar. Add modes to an existing collection to support theme variants or responsive breakpoints.

## Managing Variables

The variables table uses resizable columns: Name, plus one column per mode.

- **Create variable** — click the "+ Create variable" button
- **Edit name** — click the variable name cell to edit inline
- **Edit value** — click any value cell to change it for that mode
- **Search** — type in the search bar to filter variables by name

### Color Variables

Color variables display an inline color input with a picker. Click the swatch to open the color picker and select a new color.

## Binding Variables to Fills

In the Fill section of the properties panel, use the variable picker to bind a color variable to a node's fill.

- **Bind** — select a color variable from the picker. The fill shows a purple badge with the variable name.
- **Detach** — click the detach button on the badge to remove the binding. The fill reverts to the resolved color value.

When the variable's value changes (or when switching modes), all bound fills update automatically.

## Tips

- Use collections to group related tokens (e.g., "Primitives" for raw colors, "Semantic" for role-based aliases, "Spacing" for layout values).
- Modes are useful for theme switching — define Light and Dark mode values in the same collection.
- Variables support aliases — a "Semantic" collection can reference values from a "Primitives" collection.
- See [Drawing Shapes](./drawing-shapes) for how fills and the color picker work.
