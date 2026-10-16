// Reviewed loanwords/cognates with the same spelling and meaning in these locales.
// Full messages match exactly, including case/placeholders; this never licenses prose
// composed from these words, another locale, or an arbitrary message identity.
const HOMOGRAPHS: Readonly<Partial<Record<string, ReadonlySet<string>>>> = {
  de: new Set([
    'Video',
    'Zoom',
    'Text',
    'Link',
    'Linear',
    'Name',
    'Variable',
    'Normal',
    'Amplitude',
    'Layout',
    'Segment {segment}',
    'Option',
    'Schema',
    'optional',
    'Operation',
    'Domain',
    'Meta',
    'Links',
    'Manifest',
    'Manifest: {name}'
  ]),
  es: new Set([
    'Modal',
    'Zoom',
    'Color',
    'Variable',
    'Local',
    'Manual',
    'Normal',
    'Circular',
    'Literal',
    'Visible'
  ]),
  fr: new Set([
    'Module',
    'Style',
    'Longitude',
    'Latitude',
    'Zoom',
    'Document',
    'Direction',
    'Description',
    'Placement',
    'Destination',
    '{count} / {max} types',
    'Interaction',
    'Source',
    'Action',
    'Transition',
    'Interruption',
    'Variable',
    'Local',
    'Distance',
    'Page',
    'Composition',
    'Normal',
    'Amplitude',
    'Point X',
    'Point Y',
    'Segment {segment}',
    'Type',
    'Expression',
    'Visible',
    'Options',
    'Option',
    'tables',
    'relation',
    'Table',
    'actions',
    '{count} action',
    '{count} actions',
    'Cycle',
    '{count} cycle',
    '{count} cycles',
    'Action {actionId}'
  ]),
  it: new Set(['Video', 'Zoom', 'Layout', 'Schema']),
  pl: new Set(['Segment {segment}', 'Manifest', 'Manifest: {name}'])
}

export function isLocaleHomograph(
  locale: string | undefined,
  source: string,
  localized: string
): boolean {
  return Boolean(locale && source === localized && HOMOGRAPHS[locale]?.has(source))
}
