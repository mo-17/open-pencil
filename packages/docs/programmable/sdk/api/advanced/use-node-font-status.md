---
title: useNodeFontStatus
description: Pending and missing-font status helper for text nodes.
---

# useNodeFontStatus

`useNodeFontStatus(node)` returns pending and confirmed-missing font information for a text-node
getter.

The returned `pendingFonts` and `hasPendingFonts` values cover faces whose resolver state is `idle`
or `loading`. `missingFonts` and `hasMissingFonts` only include families after every required face
has failed or exhausted its available registered, local, cached, and remote sources. A family that
has loaded data is never reported as missing, even if an older resolver result was terminal.
Idle faces are sent through the shared font resolver, and callers may pass `onResolutionSettled` to
request host-specific repaint work after loading finishes.
Call `retryMissingFonts()` to reset terminal face demands, clear matching online-font failure
caches, and reload every required base or style-run face for the current text node.
If an exact weight or slant is unavailable, resolution also tries the family's regular face so
CanvasKit can synthesize the requested style; `check_font` continues to report that result as
degraded rather than claiming the exact face loaded.

Use it in typography panels and warnings that must distinguish a font that is still loading from a
font that is unavailable.

## Related APIs

- [useTypography](../composables/use-typography)
- [TypographyControlsRoot](../components/typography-controls-root)
