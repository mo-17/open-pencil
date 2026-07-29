---
title: Motion Runtime SDK
description: Play OpenPencil MotionSpec snapshots in framework-neutral, DOM, Vanilla, and Vue applications.
---

# Motion Runtime SDK

`@open-pencil/motion-runtime` plays bounded OpenPencil `MotionSpec` snapshots outside the editor. It
shares the editor's prepared-plan sampler, keeps one scheduler for all active bindings, and exposes
explicit lifecycle methods instead of starting work during module import.

## Install

```sh
bun add @open-pencil/motion-runtime @open-pencil/core @open-pencil/scene-graph
```

Add `vue` only when using the optional Vue entrypoint. The core, DOM, and Vanilla entrypoints do not
load Vue.

## Framework-neutral playback

```ts
import { createMotionRuntime } from '@open-pencil/motion-runtime'

const runtime = createMotionRuntime({ prefersReducedMotion: false })
const hero = runtime.register({
  id: 'hero',
  motion,
  selection: { mode: 'trigger', trigger: 'mount' },
  apply: ({ sample }) => renderVisualState(sample.visual)
})

hero.play()
hero.pause()
hero.seek(240)
hero.reverse()
hero.resume()

// Rebuilds every binding in place, preserving status, rate, and logical progress.
runtime.setPrefersReducedMotion(true)

// Releases scheduled frames and the registration.
hero.dispose()
runtime.dispose()
```

Registrations are prepared once and sampled in stable registration order. One runtime coalesces all
active registrations into one frame request. Registration count, identifiers, playback rate, and
other inputs are bounded; malformed or future Motion values fail closed.

Use `createManualMotionClock()` when a host needs exact fixed-time control for tests, server work, or
deterministic frame generation.

## DOM projection

The DOM adapter maps common transform, opacity, geometry, paint, effect, layout, text-reveal, and
variable-font channels to inline styles. It snapshots every property it owns and restores the
original values on cleanup.

Unicode text reveal is opt-in because a generic style target cannot safely replace unknown child
markup. Supply a `textContent` adapter with `read()` and `write()` methods; the runtime snapshots the
authored value, reveals `Array.from()` Unicode code points with the same rounding as the reference
renderer, and restores the snapshot on cleanup.

Renderer-specific channels are never silently approximated. Indexed paints, gradient stops,
structured effects, and vector morphs require an `applyAdvanced` callback plus their names in
`advancedCapabilities`. Missing capability declarations raise `DOMMotionCapabilityError` before any
style mutation. A host can route that error through `MotionRuntimeOptions.onError`; without an error
handler it is thrown to the caller.

## Vanilla adapter

```ts
import { createVanillaMotion } from '@open-pencil/motion-runtime/vanilla'

const controller = createVanillaMotion({
  element: document.querySelector('.hero')!,
  motion,
  trigger: 'hover'
})

// Removes listeners, cancels playback, and restores owned inline styles.
controller.dispose()
```

The Vanilla adapter owns only the listeners it installs. Replacing the Motion snapshot prepares a
new plan without leaving an old animation or listener active. When it owns the runtime and
`runtimeOptions.prefersReducedMotion` is omitted, it reads the system preference once and follows
later media-query changes. Supplying `runtime` transfers both preference updates and runtime
disposal to the host.

## Continuous input drivers

Use the driver entrypoint when scroll, pointer, drag, visibility, application state, or a document
variable should control track progress directly:

```ts
import { createDOMMotionDrivers } from '@open-pencil/motion-runtime/drivers'

const drivers = createDOMMotionDrivers({
  id: 'checkout-page',
  owner: document.querySelector('[data-op-motion-scope]')!,
  spec: motionDrivers,
  resolveElement: (nodeId, owner) =>
    owner.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(nodeId)}"]`) ?? undefined,
  resolveMotion: (nodeId) => motionByNodeId.get(nodeId)
})

drivers.setPageState('checkout-progress', 0.5)
drivers.setDocumentState('onboarding-progress', 0.75)
drivers.setVariable('motion.intensity', 0.8)
drivers.dispose()
```

Each controller is owner-scoped: it never resolves a same-id element in another page or component
instance. Scroll and pointer listeners are passive where possible, drag captures only its active
pointer, visibility uses an injected or native observer, and state/variable sources are explicit
host writes rather than global-store inspection. Inputs are coalesced into one frame, mapped through
the authored min/max, clamp, reverse, and dead-zone settings, and sampled by the same reference
sampler as ordinary playback. Directly driven tracks suppress their automatic trigger without
mutating the document. `dispose()` removes listeners and observers, cancels scheduled work, restores
owned styles and attributes, and makes later host writes fail closed.

## Vue adapter

```vue
<script setup lang="ts">
import { useTemplateRef } from 'vue'
import { useMotion } from '@open-pencil/motion-runtime/vue'

const element = useTemplateRef<HTMLElement>('hero')
const animation = useMotion(element, () => props.motion, { trigger: 'mount' })
</script>

<template>
  <div ref="hero">Animated content</div>
</template>
```

`useMotion()` follows Vue effect-scope disposal and reacts to element or Motion replacement. The
adapter is safe to import during SSR because it reads no browser globals at module evaluation time.
Its scope-owned runtime follows live reduced-motion changes when `matchMedia` exists; SSR defaults
to the explicit runtime option or `false`. An injected runtime is neither observed nor disposed.

## Reduced motion and cleanup

The runtime uses the same `reduce`, `disable`, and `allow` policy as the editor sampler.
`setPrefersReducedMotion()` rebuilds all prepared plans from their canonical Motion snapshots,
preserves running, paused, idle, and finished state plus playback rate, and maps finite timelines by
normalized progress. Infinite timelines retain elapsed time, and a temporarily disabled zero-track
plan keeps a logical position anchor for restoration. DOM bindings restore authored styles whenever
the selected plan has no tracks instead of projecting identity transforms, opacity, or custom
properties.

Vanilla and Vue adapters automatically observe the system query only for runtimes they create and
only when `runtimeOptions.prefersReducedMotion` is omitted. If a host supplies `runtime`, the host
must call `runtime.setPrefersReducedMotion(query.matches)` and own query-listener cleanup.

Always dispose a binding when its owning view unmounts. Disposal attempts every owned cleanup step—
cancelling scheduled work, preventing stale callbacks, releasing listeners, restoring DOM
properties, and disposing an owned runtime—even when a host restoration callback throws. The
adapter surfaces the cleanup error only after the remaining resources have been released.

## Generated React applications

The private OpenPencil compiler lowers the same `MotionSpec` and imports the public
`@open-pencil/motion-runtime/kernel` entrypoint at compile time. That entrypoint owns easing,
sampled-channel interpolation, iteration/fill timing, and the cancellation-safe frame loop. The
compiler embeds the exact package-owned kernel source into its bounded browser adapter, so generated
projects remain portable and add no OpenPencil runtime dependency to `package.json`.

This is a delivery boundary rather than two animation models: the public SDK and generated React
adapter execute the same kernel, while browser event ownership and reversible DOM projection stay
adapter-specific. Strict generated-project builds, package smoke tests, and real Chromium parity
tests cover this boundary at fixed times, including completed-animation scrubbing of sampled cubic
paths.
