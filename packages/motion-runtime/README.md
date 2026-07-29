# @open-pencil/motion-runtime

Framework-neutral playback and DOM adapters for OpenPencil `MotionSpec` documents. The package
uses the same prepared-plan sampler as the editor and compiler, does not evaluate arbitrary CSS or
JavaScript, and reads no browser globals at module evaluation time.

## Installation

```sh
bun add @open-pencil/motion-runtime @open-pencil/core @open-pencil/scene-graph
```

Install `vue` only when using the optional `@open-pencil/motion-runtime/vue` entrypoint.

## Framework-neutral runtime

```ts
import { createMotionRuntime } from '@open-pencil/motion-runtime'

const runtime = createMotionRuntime({ prefersReducedMotion: false })
const animation = runtime.register({
  id: 'hero',
  motion,
  selection: { mode: 'trigger', trigger: 'mount' },
  apply: ({ sample }) => renderVisualState(sample.visual)
})

animation.play()
// Later: animation.pause(), animation.seek(250), animation.reverse(), animation.dispose()
runtime.setPrefersReducedMotion(true)
```

One runtime coalesces every active binding into one frame request. Prepared plans are reused across
frames, registrations are bounded, equal-time application order is stable, and every adapter has an
explicit cleanup path. `createManualMotionClock()` provides exact fixed-time playback for tests,
server-side work, and deterministic exports. `setPrefersReducedMotion()` rebuilds canonical prepared
plans in place while preserving logical progress, playback state, and playback rate, including
finite, infinite, and temporarily disabled plans.

The public `@open-pencil/motion-runtime/kernel` entrypoint owns the easing, sampled-channel,
iteration/fill, and cancellation-safe frame-loop implementation. OpenPencil's React compiler uses
that entrypoint at compile time and embeds the exact package-owned kernel into generated projects.
The generated application therefore keeps no OpenPencil runtime dependency while still sharing the
SDK's scheduler and sampling behavior. The embedded kernel is pure and reads no DOM or browser
globals; browser event ownership and reversible style projection remain in the generated adapter.

## DOM and Vanilla adapters

```ts
import { createVanillaMotion } from '@open-pencil/motion-runtime/vanilla'

const controller = createVanillaMotion({
  element: document.querySelector('.hero')!,
  motion,
  trigger: 'hover'
})

// Removes listeners, cancels playback, and restores the original inline styles.
controller.dispose()
```

The DOM adapter projects common transform, opacity, geometry, simple paint/effect, layout, and
variable-font channels. Unicode text reveal requires an explicit `textContent` reader/writer; it
uses the same `Array.from` code-point split and rounding as the reference renderer and restores the
authored snapshot on cleanup. Indexed paints, gradient stops, structured effects, and vector morphs
require both `applyAdvanced` and the matching `advancedCapabilities` declaration. Otherwise
`DOMMotionCapabilityError` is raised before any style is changed, rather than silently approximating
or dropping the channel. A reduced-motion policy that selects no tracks restores authored DOM state
instead of writing identity transforms, opacity, or custom properties.

## Continuous drivers

```ts
import { createDOMMotionDrivers } from '@open-pencil/motion-runtime/drivers'

const drivers = createDOMMotionDrivers({
  id: 'page-home',
  owner: document.querySelector('[data-op-motion-scope]')!,
  spec: motionDrivers,
  resolveElement: (id, owner) =>
    owner.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`) ?? undefined,
  resolveMotion: (id) => motionByNodeId.get(id)
})

drivers.setPageState('progress', 0.5)
drivers.setDocumentState('onboarding', 1)
drivers.setVariable('motion.intensity', 0.8)
drivers.dispose()
```

Scroll, pointer, drag, and visibility sources install bounded owner-scoped browser listeners; page
state, document state, and variables are explicit host bridges. Input updates are coalesced into one
frame and use the same direct-progress reference sampler. Disposal removes all listeners and
observers, cancels scheduled work, restores owned styles/attributes, and prevents stale writes.

## Vue adapter

```ts
import { useMotion } from '@open-pencil/motion-runtime/vue'

const element = useTemplateRef<HTMLElement>('hero')
const animation = useMotion(element, () => props.motion, { trigger: 'mount' })
```

`useMotion()` reacts to element/spec replacement and disposes listeners, styles, and owned runtime
state with its Vue effect scope. Importing the core or DOM entrypoint never loads Vue, which keeps
SSR and non-Vue bundles tree-shakeable. Vanilla and Vue-owned runtimes follow live
`prefers-reduced-motion` changes when no explicit preference is supplied. Injected runtimes are
never observed or disposed; their host owns `setPrefersReducedMotion()` and lifecycle cleanup.
