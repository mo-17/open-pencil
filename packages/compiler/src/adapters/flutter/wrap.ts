import type { FlutterStyle, FlutterWarningSink } from './types'

/** Native Wrap aligns children within runs and distributes runs without stretching or baselines. */
export function emitFlutterWrap(
  children: readonly string[],
  style: FlutterStyle,
  warn: FlutterWarningSink,
  sourceId: string
): string {
  const unsupported = ['STRETCH', 'BASELINE'].includes(style.layout?.counterAxisAlign ?? '')
  if (unsupported)
    warn({
      code: 'flutter-wrap-cross-axis-unsupported',
      message:
        'Flutter Wrap preserves natural child sizes; stretch and baseline cross-axis alignment remain unsupported.',
      nodeId: sourceId
    })
  const alignment = style.mainAxisAlignment ?? 'start'
  const cross = unsupported ? 'start' : (style.crossAxisAlignment ?? 'start')
  const runs = style.layout?.counterAxisAlignContent === 'SPACE_BETWEEN' ? 'spaceBetween' : 'start'
  return (
    'Wrap(direction: Axis.' +
    (style.flexDirection === 'row' ? 'horizontal' : 'vertical') +
    ', spacing: ' +
    (style.gap ?? 0) +
    ', runSpacing: ' +
    Math.max(0, style.layout?.counterAxisSpacing ?? 0) +
    ', alignment: WrapAlignment.' +
    alignment +
    ', crossAxisAlignment: WrapCrossAlignment.' +
    cross +
    ', runAlignment: WrapAlignment.' +
    runs +
    ', children: [' +
    children.join(', ') +
    '])'
  )
}
