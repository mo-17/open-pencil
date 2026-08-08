export const CLIPBOARD_TOOLKIT_PLUGIN_ID = 'open-pencil.clipboard-toolkit'
export const TAURI_REACT_EXPORTER_PLUGIN_ID = 'open-pencil.tauri-react-exporter'
export const EXPO_REACT_NATIVE_EXPORTER_PLUGIN_ID = 'open-pencil.expo-react-native-exporter'
export const FLUTTER_EXPORTER_PLUGIN_ID = 'open-pencil.flutter-exporter'

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
