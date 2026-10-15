import { loadHeadlessCSSOM } from '../runtime/cssom'
import { createTokenValidator } from './validate'

export async function loadHeadlessTokenValidator() {
  const cssom = await loadHeadlessCSSOM()
  return createTokenValidator((cssText) => cssom.parse(cssText))
}
