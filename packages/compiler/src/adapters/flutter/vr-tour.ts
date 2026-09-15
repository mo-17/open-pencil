import type { IRElement, IRNode } from '#compiler/ir/types'

import { walkNativeNodes } from '../native-shared'
import { vrTourHybridKey } from '../vr-tour/hybrid'
import { dartString } from './names'
import type { FlutterWarningSink } from './types'

export const FLUTTER_VR_WEBVIEW_VERSION = '4.14.1'

export function isFlutterVRTour(node: IRElement): boolean {
  return node.module?.pluginId === 'open-pencil.vr-tour' && node.module.moduleType === 'vr-tour'
}

export function flutterVRTourImport(
  nodes: readonly IRNode[],
  tourIds: ReadonlySet<string>
): string {
  const needed = new Set<string>()
  walkNativeNodes(nodes, (node) => {
    if (node.kind === 'element' && tourIds.has(node.sourceId)) needed.add(node.sourceId)
  })
  return needed.size > 0 ? "import '../openpencil_vr_tour.dart';" : ''
}

export function emitFlutterVRTour(
  node: IRElement,
  tourIds: ReadonlySet<string>,
  warn: FlutterWarningSink
): string | undefined {
  if (!isFlutterVRTour(node)) return undefined
  const locale = node.module?.payload.locale === 'zh-CN' ? 'zh-CN' : 'en'
  const bound = Object.hasOwn(node.module ?? {}, 'panoramaUrlExpr')
  if (bound || !tourIds.has(node.sourceId)) {
    warn({
      code: bound ? 'flutter-vr-tour-binding-unsupported' : 'flutter-vr-tour-config-unavailable',
      message: bound
        ? 'Flutter VR export cannot evaluate panoramaUrl bindings; the viewer is blocked and never loads static fallback scenes'
        : 'Flutter VR export could not prepare this reviewed tour; the viewer remains blocked',
      nodeId: node.sourceId
    })
    const message =
      locale === 'zh-CN'
        ? '此 VR 看房尚无法导出：请使用有效的静态场景；动态全景绑定不会回退加载示例。'
        : 'This VR tour is unavailable. Use valid static scenes; dynamic panorama bindings never load fallback samples.'
    return `Center(child: Text(${dartString(message)}, textAlign: TextAlign.center))`
  }
  warn({
    code: 'flutter-vr-tour-webview',
    message:
      'Flutter VR uses a bundled PSV WebView. Build vr-tour-web before running; Android/iOS/macOS platform validation remains required',
    nodeId: node.sourceId
  })
  return `OpenPencilVRTourWebView(assetPath: ${dartString(`assets/vr-tour/${vrTourHybridKey(node.sourceId)}.html`)}, locale: ${dartString(locale)})`
}

export function buildFlutterVRTourReadme(): string {
  return `
## VR panorama WebView preparation

VR modules use a **local WebView running Photo Sphere Viewer**, while the surrounding application uses Flutter Widgets. This is not a native Flutter panorama renderer. Only validated static scenes are included; dynamic panoramaUrl bindings show a blocked message and never silently load an authored fallback.

Use Flutter >=3.38.0 with Dart >=3.10.0 and Node.js >=22. From this export directory:

\`\`\`sh
npm install --prefix vr-tour-web
node vr-tour-web/build.mjs
\`\`\`

This builds the bundled PSV JavaScript/CSS and referenced panorama bytes into the declared \`assets/vr-tour/*.html\` files. Until this step succeeds, those files display a preparation message. The npm step downloads build dependencies; the application does not download remote executable scripts. Keep the entire \`vr-tour-web/\` directory for rebuilding after edits. Then create platform shells using the commands above, resolve Flutter packages, and run on a device.

The exact dependency is \`webview_flutter: ${FLUTTER_VR_WEBVIEW_VERSION}\`. Set Android \`minSdk\` to at least 24; set the iOS deployment target to at least 13.0 (Podfile and Runner). macOS requires 10.15 or newer; generate a macOS shell separately if needed. Flutter Web, Windows and Linux show an unsupported-platform message for this module.

For external HTTPS panoramas, add \`<uses-permission android:name="android.permission.INTERNET" />\` to \`android/app/src/main/AndroidManifest.xml\`, immediately inside \`<manifest>\`. Keep iOS HTTPS transport restrictions; do not enable arbitrary insecure loads. macOS network access requires the client-network entitlement. Remote images still require compatible CORS responses from the WebView origin; included sample images are embedded for offline use.

Top-level navigation is restricted to the current generated local HTML file. Pausing removes the WebView and asks its PSV document to clean up; resuming creates a fresh viewer and requires the normal image-load consent again. Validate 8K memory usage, gestures, pause/resume, scene switching and disposal on actual Android/iOS devices before release. The generated mount test uses an unsupported desktop platform to avoid invoking platform views; it is not a WebView rendering test. No CocoaPods, Gradle, signing or device validation was performed by source export.
`
}
