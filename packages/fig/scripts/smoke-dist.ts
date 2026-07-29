export {}

const mod = await import('../dist/index.js')
const instanceOverrides = await import('../dist/instance-overrides.js')
const nodeChange = await import('../dist/node-change.js')

if (
  mod.FIG_PACKAGE_STATUS !== 'archive-api' ||
  typeof mod.diffFigmaNativeMotion !== 'function' ||
  typeof mod.effectiveFigmaRawNodeFields !== 'function' ||
  typeof mod.getFigmaNativeMotionTransactionSource !== 'function' ||
  typeof mod.importFigmaNativeMotion !== 'function' ||
  typeof mod.inspectFigmaNativeMotion !== 'function' ||
  typeof mod.parseFigBuffer !== 'function' ||
  typeof mod.writeFigArchive !== 'function' ||
  typeof instanceOverrides.populateAndApplyOverrides !== 'function' ||
  typeof nodeChange.convertLineHeight !== 'function' ||
  typeof nodeChange.sceneNodeToKiwi !== 'function'
) {
  throw new Error('Expected @open-pencil/fig archive API exports')
}

const bytes = mod.writeFigContainer({
  schemaDeflated: new Uint8Array([1]),
  dataRaw: new Uint8Array([2])
})
const document = mod.readFigContainer(bytes)

if (document.dataRaw[0] !== 2) {
  throw new Error('Expected @open-pencil/fig container round-trip')
}

const transactionSource = mod.getFigmaNativeMotionTransactionSource()
const applyMotion = new Function(
  `return ${transactionSource}`
)() as typeof mod.applyFigmaNativeMotionTransaction
const motionPlan = mod.createFigmaNativeMotionPlan({
  version: 1,
  tracks: [
    {
      id: 'dist-smoke',
      trigger: 'mount',
      keyframes: [
        { offset: 0, opacity: 0 },
        { offset: 1, opacity: 1 }
      ],
      timing: { durationMs: 200, fill: 'both' },
      exit: 'none'
    }
  ]
})
const motionRequest = mod.createFigmaNativeMotionApplyRequest(motionPlan)
const shared = new Map<string, string>()
interface DistMotionBinding {
  keyframes: Array<{ timelinePosition: number }>
}
type DistMotionTracks = { [name: string]: DistMotionBinding | undefined }
const motionNode = {
  id: 'dist:motion',
  animationStyles: [] as Array<{ id: string }>,
  manualKeyframeTracks: {} as DistMotionTracks,
  timelines: [] as Array<{ id: string; duration: number }>,
  getSharedPluginData(namespace: string, key: string) {
    return shared.get(`${namespace}:${key}`) ?? ''
  },
  setSharedPluginData(namespace: string, key: string, value: string) {
    shared.set(`${namespace}:${key}`, value)
  },
  applyManualKeyframeTrack(
    field: { type: 'PROPERTY'; name: string },
    track: { keyframes: Array<{ timelinePosition: number }> }
  ) {
    this.manualKeyframeTracks[field.name] = structuredClone(track)
    if (this.timelines.length === 0) {
      this.timelines.push({
        id: 'timeline:dist',
        duration: track.keyframes.at(-1)?.timelinePosition ?? 0
      })
    }
  },
  removeManualKeyframeTrack(field: { type: 'PROPERTY'; name: string }) {
    Reflect.deleteProperty(this.manualKeyframeTracks, field.name)
  },
  removeAnimationStyle(id: string) {
    this.animationStyles = this.animationStyles.filter((style) => style.id !== id)
  },
  setTimelineDuration(id: string, duration: number) {
    const timeline = this.timelines.find((candidate) => candidate.id === id)
    if (!timeline) throw new Error(`Missing timeline ${id}`)
    timeline.duration = duration
  }
}
let motionCommitCount = 0
const motionHost = {
  commitUndo() {
    motionCommitCount++
  },
  triggerUndo() {
    throw new Error('Dist smoke unexpectedly rolled back')
  }
}
const motionResult = applyMotion(motionHost, motionNode, motionRequest)
if (motionResult.status !== 'applied' || motionCommitCount !== 2) {
  throw new Error(
    `Expected serialized dist Motion applicator to apply: ${JSON.stringify(motionResult)}`
  )
}
const unchangedResult = applyMotion(motionHost, motionNode, motionRequest)
if (unchangedResult.status !== 'unchanged') {
  throw new Error(
    `Expected serialized dist Motion applicator to be idempotent: ${JSON.stringify(unchangedResult)}`
  )
}
