import { VIDEO_DEPENDENCIES, VIDEO_RUNTIME_SOURCE } from '#compiler/adapters/video/source'

import { VIDEO_MODULE_TYPE, VIDEO_PLUGIN_ID } from '@open-pencil/core/plugins'

import { REACT_MODULE_POSITIONED_HOST_SOURCE } from './runtime-source'
import type { ReactModuleAdapter, ReactModuleRuntimeOptions } from './types'

export function buildOpenPencilVideoComponent(options: ReactModuleRuntimeOptions): string {
  return `${VIDEO_RUNTIME_SOURCE}
import { useLayoutEffect, useRef, type HTMLAttributes } from 'react'
export interface OpenPencilVideoProps extends HTMLAttributes<HTMLDivElement> {
  config: OpenPencilVideoConfig
  videoSrc?: unknown
  videoPoster?: unknown
  srcBound?: boolean
  posterBound?: boolean
}
export default function OpenPencilVideo({ config, videoSrc, videoPoster, srcBound = false, posterBound = false, className, children, style, lang, ...hostProps }: OpenPencilVideoProps) {
  const host = useRef<HTMLDivElement>(null)
  const snapshot = JSON.stringify(config)
${REACT_MODULE_POSITIONED_HOST_SOURCE}
  useLayoutEffect(() => {
    if (!host.current) return
    return mountOpenPencilVideo(host.current, JSON.parse(snapshot) as OpenPencilVideoConfig, { src: videoSrc, poster: videoPoster, srcBound, posterBound, preview: ${options.devMode}, lang })
  }, [snapshot, videoSrc, videoPoster, srcBound, posterBound, lang])
  return <div {...hostProps} lang={lang} className={className} data-openpencil-video="" style={hostStyle}><div ref={host} style={{ position: 'absolute', inset: 0 }} />{children}</div>
}
`
}

export const VIDEO_REACT_MODULE_ADAPTER: ReactModuleAdapter = Object.freeze({
  pluginId: VIDEO_PLUGIN_ID,
  moduleType: VIDEO_MODULE_TYPE,
  componentName: 'OpenPencilVideo',
  runtimePath: 'src/__openpencil_video.tsx',
  rootImportPath: './__openpencil_video',
  nestedImportPath: '../__openpencil_video',
  dependencies: VIDEO_DEPENDENCIES,
  optimizeDeps: Object.freeze(Object.keys(VIDEO_DEPENDENCIES)),
  buildRuntime: buildOpenPencilVideoComponent
})
