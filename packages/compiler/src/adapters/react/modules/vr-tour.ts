import { VR_TOUR_DEPENDENCIES, VR_TOUR_RUNTIME_SOURCE } from '#compiler/adapters/vr-tour/source'

import { VR_TOUR_MODULE_TYPE, VR_TOUR_PLUGIN_ID } from '@open-pencil/core/plugins'

import type { ReactModuleAdapter } from './types'

export const VR_TOUR_REACT_MODULE_ADAPTER: ReactModuleAdapter = Object.freeze({
  pluginId: VR_TOUR_PLUGIN_ID,
  moduleType: VR_TOUR_MODULE_TYPE,
  componentName: 'OpenPencilVRTour',
  runtimePath: 'src/__openpencil_vr_tour.tsx',
  rootImportPath: './__openpencil_vr_tour',
  nestedImportPath: '../__openpencil_vr_tour',
  dependencies: VR_TOUR_DEPENDENCIES,
  optimizeDeps: Object.freeze(Object.keys(VR_TOUR_DEPENDENCIES)),
  buildRuntime: () => `${VR_TOUR_RUNTIME_SOURCE}
import { useEffect, useRef, type HTMLAttributes } from 'react'
type Props = HTMLAttributes<HTMLDivElement> & { config: TourConfig; panoramaUrl?: unknown; panoramaBound?: boolean }
export default function OpenPencilVRTour({ config, panoramaUrl, panoramaBound = false, children: _children, ...attrs }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const snapshot = JSON.stringify(config)
  useEffect(() => {
    if (!host.current) return
    return mountVRTour(host.current, JSON.parse(snapshot) as TourConfig, panoramaUrl, panoramaBound)
  }, [snapshot, panoramaUrl, panoramaBound])
  return <div {...attrs} ref={host} />
}
`
})
