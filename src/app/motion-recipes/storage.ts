import { readLocalStorageText, removeLocalStorageText, writeLocalStorageText } from '@/app/cache'

export const MOTION_RECIPE_LIBRARY_STORAGE_KEY = 'open-pencil:motion-recipe-library:v1'

export interface MotionRecipeKeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

export function browserMotionRecipeStorage(): MotionRecipeKeyValueStorage | null {
  return {
    getItem: readLocalStorageText,
    setItem: writeLocalStorageText,
    removeItem: removeLocalStorageText
  }
}
