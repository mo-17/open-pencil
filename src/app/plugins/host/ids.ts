export const CLIPBOARD_TOOLKIT_PLUGIN_ID = 'open-pencil.clipboard-toolkit'
export const TAURI_REACT_EXPORTER_PLUGIN_ID = 'open-pencil.tauri-react-exporter'
export const EXPO_REACT_NATIVE_EXPORTER_PLUGIN_ID = 'open-pencil.expo-react-native-exporter'
export const FLUTTER_EXPORTER_PLUGIN_ID = 'open-pencil.flutter-exporter'
export const ACCESSIBILITY_AUDIT_PLUGIN_ID = 'open-pencil.accessibility-audit'
export const DESIGN_TOKENS_EXPORTER_PLUGIN_ID = 'open-pencil.design-tokens-exporter'
export const FIGMA_PROJECTION_EXPORTER_PLUGIN_ID = 'open-pencil.figma-projection-exporter'

export const CLIPBOARD_COMMANDS = Object.freeze({
  text: {
    commandId: 'copy-as-text',
    adapterId: 'open-pencil.clipboard.copy-as-text'
  },
  svg: {
    commandId: 'copy-as-svg',
    adapterId: 'open-pencil.clipboard.copy-as-svg'
  },
  jsx: {
    commandId: 'copy-as-jsx',
    adapterId: 'open-pencil.clipboard.copy-as-jsx'
  },
  png: {
    commandId: 'copy-as-png',
    adapterId: 'open-pencil.clipboard.copy-as-png'
  }
})

export const TAURI_REACT_EXPORTER = Object.freeze({
  exporterId: 'tauri-react-source',
  adapterId: 'open-pencil.export.tauri-react-source',
  fileExtension: '.zip'
})

export const EXPO_REACT_NATIVE_EXPORTER = Object.freeze({
  exporterId: 'expo-react-native-source',
  adapterId: 'open-pencil.export.expo-react-native-source',
  fileExtension: '.zip'
})

export const FLUTTER_EXPORTER = Object.freeze({
  exporterId: 'flutter-source',
  adapterId: 'open-pencil.export.flutter-source',
  fileExtension: '.zip'
})

export const ACCESSIBILITY_AUDIT_COMMAND = Object.freeze({
  commandId: 'run-static-accessibility-audit',
  adapterId: 'open-pencil.audit.static-accessibility',
  permissions: Object.freeze(['document.read'] as const)
})

export const DESIGN_TOKENS_EXPORTER = Object.freeze({
  exporterId: 'design-tokens-json',
  adapterId: 'open-pencil.export.design-tokens-json',
  permissions: Object.freeze(['document.variables.read', 'file.save'] as const),
  outputs: Object.freeze([Object.freeze({ extension: '.json', mimeType: 'application/json' })])
})

export const FIGMA_PROJECTION_EXPORTER = Object.freeze({
  exporterId: 'figma-editable-projection',
  adapterId: 'open-pencil.export.figma-editable-projection',
  permissions: Object.freeze(['document.read', 'file.save'] as const),
  outputs: Object.freeze([
    Object.freeze({ extension: '.fig', mimeType: 'application/octet-stream' })
  ])
})
