import { styleToWeight } from '@open-pencil/core/text'

type ItalicStyleMatcher = (style: string) => boolean

function isItalicOrObliqueStyle(style: string): boolean {
  return /(?:italic|oblique)/iu.test(style)
}

export function preferredFontStyle(
  styles: readonly string[],
  isItalicStyle: ItalicStyleMatcher = isItalicOrObliqueStyle
): string {
  return (
    [...styles].sort((first, second) => {
      const firstItalic = isItalicStyle(first) ? 1 : 0
      const secondItalic = isItalicStyle(second) ? 1 : 0
      return (
        firstItalic - secondItalic ||
        Math.abs(styleToWeight(first) - 400) - Math.abs(styleToWeight(second) - 400) ||
        first.localeCompare(second)
      )
    })[0] ?? 'Regular'
  )
}
