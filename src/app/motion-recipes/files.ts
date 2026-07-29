import { MOTION_RECIPE_LIBRARY_LIMITS } from '@open-pencil/scene-graph'

import {
  chooseTauriMotionLibraryFile,
  readBrowserMotionLibraryFile,
  saveMotionLibraryFile
} from '@/app/motion-library-file'

export const MOTION_RECIPE_LIBRARY_FILE_NAME = 'openpencil-motion-recipes.json'

export async function readBrowserMotionRecipeLibraryFile(file: File): Promise<string> {
  return readBrowserMotionLibraryFile(file, 'recipe', MOTION_RECIPE_LIBRARY_LIMITS.maxJsonBytes)
}

export async function chooseTauriMotionRecipeLibraryFile(): Promise<string | null> {
  return chooseTauriMotionLibraryFile('recipe', MOTION_RECIPE_LIBRARY_LIMITS.maxJsonBytes)
}

export async function saveMotionRecipeLibraryFile(json: string): Promise<void> {
  await saveMotionLibraryFile(json, MOTION_RECIPE_LIBRARY_FILE_NAME, 'recipe')
}
