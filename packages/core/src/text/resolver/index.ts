import { parseFontStyle } from '#core/text/face'
import type { FontFallbackScript } from '#core/text/fallbacks'
import { fontManager } from '#core/text/fonts'
import { FontResolver } from '#core/text/resolver/resolver'
import type {
  FontResolutionCandidate,
  FontResolutionDemand,
  FontResolutionLoader
} from '#core/text/resolver/types'

export * from './coverage'
export * from './resolver'
export * from './types'

function faceCandidate(
  family: string,
  style: string,
  source: FontResolutionCandidate['source']
): FontResolutionCandidate {
  return { id: `${source}:${family}:${style}`, family, style, source }
}

function syntheticFaceStyles(style: string): string[] {
  const parsed = parseFontStyle(style)
  const sameSlantRegular = parsed.italic ? 'Regular Italic' : 'Regular'
  const styles =
    style.trim().toLocaleLowerCase() === sameSlantRegular.toLocaleLowerCase()
      ? []
      : [sameSlantRegular]
  if (parsed.italic) styles.push('Regular')
  return styles
}

export function fontFaceDemand(
  family: string,
  style: string,
  characters = ''
): FontResolutionDemand {
  const syntheticStyles = syntheticFaceStyles(style)
  const fallbackSources: FontResolutionCandidate['source'][] = [
    'registered',
    'imported',
    'local',
    'cache',
    'remote'
  ]
  const remainingExactSources = fallbackSources.slice(1)
  return {
    key: `face:${family.trim().toLocaleLowerCase()}:${style.toLocaleLowerCase()}`,
    characters,
    candidates: [
      faceCandidate(family, style, 'registered'),
      ...remainingExactSources.map((source) => faceCandidate(family, style, source)),
      ...syntheticStyles.flatMap((fallbackStyle) =>
        fallbackSources.map((source) => faceCandidate(family, fallbackStyle, source))
      )
    ]
  }
}

export function fontCandidateCoverageText(
  demand: FontResolutionDemand,
  candidate: FontResolutionCandidate
): string {
  const requestedFace = demand.candidates[0]
  if (candidate.family !== requestedFace.family || candidate.style !== requestedFace.style) {
    return ''
  }
  return demand.characters ?? ''
}

export function fontRemoteCoverageDemand(
  family: string,
  style: string,
  characters: readonly string[]
): FontResolutionDemand {
  const coverageKey = [...new Set(characters)].sort((a, b) => a.localeCompare(b)).join('')
  return {
    key: `remote-coverage:${family.trim().toLocaleLowerCase()}:${style.toLocaleLowerCase()}:${coverageKey}`,
    characters: coverageKey,
    candidates: [faceCandidate(family, style, 'remote')]
  }
}

export function fontCoverageDemand(
  script: FontFallbackScript,
  characters: readonly string[] = []
): FontResolutionDemand {
  const codePoints = characters.flatMap((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint === undefined ? [] : [codePoint.toString(16)]
  })
  const coverageKey = [...new Set(codePoints)].sort((a, b) => a.localeCompare(b)).join(',')
  return {
    key: `coverage:${script}:${coverageKey}`,
    characters: characters.join(''),
    candidates: [{ id: `fallback:${script}`, family: script, style: 'Regular', source: 'fallback' }]
  }
}

const productionFontLoader: FontResolutionLoader = async (candidate, demand) => {
  const characters = fontCandidateCoverageText(demand, candidate)
  switch (candidate.source) {
    case 'registered':
      return fontManager.isStyleLoaded(candidate.family, candidate.style)
    case 'imported':
      return (await fontManager.loadImportedFont(candidate.family, candidate.style)) !== null
    case 'local':
      return (await fontManager.loadLocalFont(candidate.family, candidate.style)) !== null
    case 'cache':
      return (
        (await fontManager.loadCachedFont(candidate.family, candidate.style, characters)) !== null
      )
    case 'remote':
      return (
        (await fontManager.loadRemoteFont(candidate.family, candidate.style, characters)) !== null
      )
    case 'fallback': {
      const script = candidate.family as FontFallbackScript
      const families = await fontManager.ensureFallbackPack([script], demand.characters)
      return (families[script]?.length ?? 0) > 0
    }
  }
  return false
}

export const fontResolver = new FontResolver(productionFontLoader)

export function resetFontFamilyDemands(family: string): void {
  const normalizedFamily = family.trim().toLocaleLowerCase()
  fontResolver.resetMatching((demand) =>
    demand.candidates.some(
      (candidate) => candidate.family.trim().toLocaleLowerCase() === normalizedFamily
    )
  )
}
