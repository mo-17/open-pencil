import { sampleMotionSpec } from '../dist/index.js'

const sample = sampleMotionSpec(
  {
    version: 1,
    tracks: [
      {
        id: 'move',
        trigger: 'mount',
        keyframes: [
          { offset: 0, x: 0 },
          { offset: 1, x: 100 }
        ],
        timing: { durationMs: 100, easing: 'linear' }
      }
    ]
  },
  50
)

if (sample.visual.x !== 50) throw new Error('Motion sampler dist smoke failed')

process.stdout.write('@open-pencil/motion dist smoke passed\n')
