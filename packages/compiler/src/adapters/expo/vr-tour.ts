import type { IRElement, IRNode } from '#compiler/ir/types'

import { VR_TOUR_MODULE_TYPE, VR_TOUR_PLUGIN_ID } from '@open-pencil/core/plugins'

import { walkNativeNodes } from '../native-shared'
import type { ExpoStyleValue, ExpoWarningSink } from './types'

export function isExpoVRTour(node: IRElement, tourIds?: ReadonlySet<string>): boolean {
  const module = node.module
  return (
    module?.pluginId === VR_TOUR_PLUGIN_ID &&
    module.moduleType === VR_TOUR_MODULE_TYPE &&
    module.configVersion === 1 &&
    (module.panoramaUrlExpr !== undefined || tourIds?.has(node.sourceId) === true)
  )
}

export function expoVRTourSymbol(used: ReadonlySet<string>): string {
  let symbol = 'OpenPencilVRTour'
  let suffix = 2
  while (used.has(symbol)) symbol = `OpenPencilVRTour${suffix++}`
  return symbol
}

export function expoVRTourImport(
  nodes: readonly IRNode[],
  tourIds: ReadonlySet<string> | undefined,
  symbol: string
): string {
  const found = new Set<string>()
  walkNativeNodes(nodes, (node) => {
    if (node.kind === 'element' && tourIds?.has(node.sourceId)) found.add(node.sourceId)
  })
  return found.size > 0 ? `import ${symbol} from '../vr-tour'` : ''
}

export function emitExpoVRTour(
  node: IRElement,
  style: Record<string, ExpoStyleValue>,
  indent: number,
  warn: ExpoWarningSink,
  devMode: boolean,
  symbol: string
): string {
  const pad = '  '.repeat(indent)
  const locale = node.module?.payload.locale === 'zh-CN' ? 'zh-CN' : 'en'
  const attrs = `style={${JSON.stringify(style)}}${devMode ? ` testID=${JSON.stringify(`openpencil-node-${node.sourceId}`)}` : ''}`
  if (node.module?.panoramaUrlExpr !== undefined) {
    warn({
      code: 'expo-vr-tour-binding-unsupported',
      message:
        'Expo VR export does not support dynamic panorama bindings; the viewer stays unavailable instead of loading a static fallback',
      nodeId: node.sourceId
    })
    const message =
      locale === 'zh-CN'
        ? '此 Expo 导出暂不支持动态全景绑定。'
        : 'Dynamic panorama bindings are not supported in this Expo export.'
    return `${pad}<View ${attrs} accessibilityRole="alert"><Text>{${JSON.stringify(message)}}</Text></View>`
  }
  return `${pad}<${symbol} tourId=${JSON.stringify(node.sourceId)} locale=${JSON.stringify(locale)} ${attrs} />`
}

export function buildExpoVRTourRuntime(router: boolean): string {
  return `import { ${router ? 'useCallback, ' : ''}useEffect, useMemo, useState } from 'react'
import { AppState, Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import WebView from 'react-native-webview'
${router ? "import { useFocusEffect } from 'expo-router'\n" : ''}
import { vrTourHtmlById } from './vr-tour-html'

interface Props {
  tourId: string
  locale: 'en' | 'zh-CN'
  style?: StyleProp<ViewStyle>
  testID?: string
}

/** Only the generated, bundled HTML is loaded. Authored URLs are never navigation targets. */
export default function OpenPencilVRTour({ tourId, locale, style, testID }: Props) {
  const html = Object.hasOwn(vrTourHtmlById, tourId) ? vrTourHtmlById[tourId] : undefined
  const source = useMemo(() => ({ html: html ?? '' }), [html])
  const [active, setActive] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive')
  const [failed, setFailed] = useState(false)
  const [revision, setRevision] = useState(0)
  ${
    router
      ? `const [focused, setFocused] = useState(false)
  useFocusEffect(useCallback(() => {
    setFocused(true)
    return () => setFocused(false)
  }, []))`
      : 'const focused = true'
  }
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setActive(state === 'active'))
    return () => subscription.remove()
  }, [])
  useEffect(() => setFailed(false), [tourId, html])
  const chinese = locale === 'zh-CN'
  const message = !html
    ? (chinese ? '全景资源尚未准备好，请运行 npm run prepare:vr-tour。' : 'Tour assets are not prepared. Run npm run prepare:vr-tour.')
    : (chinese ? '全景视图加载失败，请重试。' : 'The panorama view failed to load. Please retry.')
  return <View testID={testID} style={[{ minHeight: 240, overflow: 'hidden' }, style]}>
    {!html || failed ? <View accessibilityRole="alert" style={{ padding: 16 }}>
      <Text>{message}</Text>
      {html ? <Pressable accessibilityRole="button" onPress={() => { setFailed(false); setRevision((value) => value + 1) }}>
        <Text>{chinese ? '重试' : 'Retry'}</Text>
      </Pressable> : null}
    </View> : !active || !focused ? <Text>{chinese ? '全景已暂停' : 'Panorama paused'}</Text> : <WebView
      key={tourId + ':' + revision}
      source={source}
      style={{ flex: 1, backgroundColor: 'transparent' }}
      originWhitelist={['*']}
      onShouldStartLoadWithRequest={(request) => request.url === 'about:blank'}
      onOpenWindow={() => undefined}
      setSupportMultipleWindows={false}
      javaScriptCanOpenWindowsAutomatically={false}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      mixedContentMode="never"
      sharedCookiesEnabled={false}
      thirdPartyCookiesEnabled={false}
      domStorageEnabled={false}
      incognito
      scrollEnabled={false}
      onError={() => setFailed(true)}
      onContentProcessDidTerminate={() => setFailed(true)}
      onRenderProcessGone={() => setFailed(true)}
    />}
  </View>
}
`
}
