import { shallowRef, type ShallowRef } from 'vue'

import type { SceneGraph } from '@open-pencil/scene-graph'

import type { ExportPreflightReport } from './inspect'

// Graph identity isolates reports across tabs and allows closed documents to be collected.
const reports = new WeakMap<SceneGraph, ShallowRef<ExportPreflightReport | null>>()

export function exportPreflightReport(graph: SceneGraph): ShallowRef<ExportPreflightReport | null> {
  let report = reports.get(graph)
  if (!report) {
    report = shallowRef<ExportPreflightReport | null>(null)
    reports.set(graph, report)
  }
  return report
}
