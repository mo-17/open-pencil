# `@open-pencil/motion`

Framework-agnostic deterministic Motion planning and sampling for OpenPencil.

## Ownership

This package owns:

- easing, timing, path, track, and scene-plan sampling;
- advanced paint, effect, font-axis, and vector projection planning;
- continuous-driver mapping, source inspection, target preparation, and input batching;
- deterministic generated-effect sampling and authored node changes.

Authored `MotionSpec` schemas, validation, presets, recipes, and libraries remain in
`@open-pencil/scene-graph`. Clocks, scheduling, playback handles, DOM projection, and Vanilla/Vue
lifecycle adapters remain in `@open-pencil/motion-runtime`. Editor state, Canvas rendering, export,
and authoring tools remain in `@open-pencil/core` and the app.

## Usage

```ts
import { prepareMotionSamplingPlan, samplePreparedMotionPlan } from '@open-pencil/motion'

const plan = prepareMotionSamplingPlan(motion, {
  selection: { mode: 'trigger', trigger: 'mount' }
})
const frame = samplePreparedMotionPlan(plan, 250)
```

The established `@open-pencil/core/motion` entrypoint remains a compatibility export. New code
should import this package directly.
