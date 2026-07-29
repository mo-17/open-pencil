import { USER_MOTION_PRESET_LIMITS } from '@open-pencil/scene-graph'

import {
  chooseTauriMotionLibraryFile,
  readBrowserMotionLibraryFile,
  saveMotionLibraryFile
} from '@/app/motion-library-file'

export const MOTION_PRESET_LIBRARY_FILE_NAME = 'openpencil-motion-presets.json'

export async function readBrowserMotionPresetLibraryFile(file: File): Promise<string> {
  return readBrowserMotionLibraryFile(file, 'preset', USER_MOTION_PRESET_LIMITS.maxJsonBytes)
}

export async function chooseTauriMotionPresetLibraryFile(): Promise<string | null> {
  return chooseTauriMotionLibraryFile('preset', USER_MOTION_PRESET_LIMITS.maxJsonBytes)
}

export async function saveMotionPresetLibraryFile(json: string): Promise<void> {
  await saveMotionLibraryFile(json, MOTION_PRESET_LIBRARY_FILE_NAME, 'preset')
}
