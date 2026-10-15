import { compact } from 'es-toolkit/array'

import { FlutterPreviewError } from './errors'
import type { GeneratedFiles } from './owned-project'

/** Native plugin activation needs a separate reviewed offline CocoaPods/Gradle contract. */
export function validateOfflineDependencies(files: GeneratedFiles): void {
  const pubspec = files.get('pubspec.yaml')
  if (typeof pubspec !== 'string')
    throw new FlutterPreviewError(
      'flutter-preview-dependencies-invalid',
      'Generated pubspec must be text.'
    )
  const block = /^dependencies:\s*\n((?:[ \t].*\n|\s*\n)*)/m.exec(pubspec)?.[1]
  const entries = block ? compact(block.split('\n').map((line) => line.trim())) : undefined
  if (entries?.join('\n') !== 'flutter:\nsdk: flutter' || /^dependency_overrides:/m.test(pubspec)) {
    throw new FlutterPreviewError(
      'flutter-preview-native-plugin-unsupported',
      'This offline native preview supports Flutter SDK runtime dependencies only. Native WebView/plugins require a separately reviewed platform cache and build contract; source export remains available.'
    )
  }
}
