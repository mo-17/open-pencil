import type { ComponentDef, IRAsset, IRTree } from '#compiler/ir/types'

import { portableMiniProgramPathKey, safeMiniProgramName } from './names'
import { MINIPROGRAM_PROJECT_LIMITS } from './project'
import type {
  MiniProgramAssetFile,
  MiniProgramAssetPlan,
  MiniProgramProjectLimits,
  MiniProgramWarningSink
} from './types'

const RASTER_ASSET_EXTENSION = /\.(?:gif|jpe?g|png|webp)$/i
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const

export function collectMiniProgramAssets(
  irs: readonly IRTree[],
  components: readonly ComponentDef[],
  warn: MiniProgramWarningSink,
  warningPrefix: string,
  limits: Readonly<MiniProgramProjectLimits> = MINIPROGRAM_PROJECT_LIMITS
): MiniProgramAssetPlan {
  const candidates = [
    ...irs.flatMap((ir) => ir.assets ?? []),
    ...components.flatMap((component) => component.assets ?? [])
  ].sort((left, right) => left.path.localeCompare(right.path))
  if (candidates.length > limits.maxAssets) {
    throw new RangeError(`Mini-program input exceeds the asset limit of ${limits.maxAssets}`)
  }
  const files = new Map<string, MiniProgramAssetFile>()
  const sourcePaths = new Map<string, string>()
  const basenames = new Map<string, string | null>()
  for (const asset of candidates) {
    const basename = asset.path.replaceAll('\\', '/').split('/').at(-1) ?? ''
    if (!RASTER_ASSET_EXTENSION.test(basename)) {
      warn({
        code: `${warningPrefix}-image-asset-format-unsupported`,
        message: `Mini-program export omitted non-raster image asset ${JSON.stringify(asset.path)}; PNG, JPEG, GIF, and WebP are supported`
      })
      continue
    }
    if (asset.bytes.byteLength > limits.maxBinaryFileBytes) {
      throw new RangeError(
        `Mini-program image asset ${JSON.stringify(asset.path)} exceeds ${limits.maxBinaryFileBytes} bytes`
      )
    }
    const extension = basename.slice(basename.lastIndexOf('.')).toLowerCase()
    if (!isReviewedMiniProgramRasterAsset(basename, asset.bytes)) {
      warn({
        code: `${warningPrefix}-image-asset-signature-invalid`,
        message: `Mini-program export omitted image asset ${JSON.stringify(asset.path)} because its bytes do not match the ${extension} extension`
      })
      continue
    }
    const stem = basename.slice(0, -extension.length)
    const outputPath = `assets/images/${safeMiniProgramName(stem, 'image')}${extension}`
    const key = portableMiniProgramPathKey(outputPath)
    const existing = files.get(key)
    if (existing && !bytesEqual(existing.bytes, asset.bytes)) {
      warn({
        code: `${warningPrefix}-image-asset-path-collision`,
        message: `Mini-program export omitted conflicting image asset ${JSON.stringify(asset.path)} at ${JSON.stringify(outputPath)}`
      })
      continue
    }
    if (!existing) files.set(key, { sourcePath: asset.path, outputPath, bytes: asset.bytes })
    sourcePaths.set(portableMiniProgramPathKey(asset.path), outputPath)
    const basenameKey = portableMiniProgramPathKey(basename)
    const previousBasename = basenames.get(basenameKey)
    basenames.set(
      basenameKey,
      previousBasename === undefined || previousBasename === outputPath ? outputPath : null
    )
  }
  const assets = [...files.values()]
  return {
    assets,
    resolve(sourcePath: string): string | undefined {
      const normalized = sourcePath.replaceAll('\\', '/')
      const exact = sourcePaths.get(portableMiniProgramPathKey(normalized))
      if (exact) return exact
      const basename = normalized.split('/').at(-1)
      if (!basename) return undefined
      return basenames.get(portableMiniProgramPathKey(basename)) ?? undefined
    }
  }
}

export function isReviewedMiniProgramRasterAsset(path: string, bytes: Uint8Array): boolean {
  if (!RASTER_ASSET_EXTENSION.test(path)) return false
  const extension = path.slice(path.lastIndexOf('.')).toLowerCase()
  if (extension === '.png') return hasBytes(bytes, 0, PNG_SIGNATURE)
  if (extension === '.jpg' || extension === '.jpeg') {
    return hasBytes(bytes, 0, [0xff, 0xd8, 0xff])
  }
  if (extension === '.gif') {
    return hasAscii(bytes, 0, 'GIF87a') || hasAscii(bytes, 0, 'GIF89a')
  }
  if (extension === '.webp') {
    return hasAscii(bytes, 0, 'RIFF') && hasAscii(bytes, 8, 'WEBP')
  }
  return false
}

function hasBytes(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((byte, index) => bytes[offset + index] === byte)
}

function hasAscii(bytes: Uint8Array, offset: number, expected: string): boolean {
  for (let index = 0; index < expected.length; index++) {
    if (bytes[offset + index] !== expected.charCodeAt(index)) return false
  }
  return true
}

export function emitMiniProgramAssets(
  plan: MiniProgramAssetPlan,
  setFile: (path: string, content: string | Uint8Array) => void
): void {
  for (const asset of plan.assets) setFile(asset.outputPath, asset.bytes)
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  return left.every((byte, index) => byte === right[index])
}

export function miniProgramAssetBasename(asset: IRAsset): string | undefined {
  return asset.path.replaceAll('\\', '/').split('/').at(-1)
}
