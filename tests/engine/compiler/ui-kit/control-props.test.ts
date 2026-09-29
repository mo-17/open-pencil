import { expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'

import { controlFoundationGraph } from '#tests/helpers/compiler/components/controls'
import { shadcnControlsFixture } from '#tests/helpers/compiler/components/shadcn-controls'

test('shadcn controls retain disabled boundaries, option labels and field focus actions', () => {
  const output = shadcnControlsFixture()
  expect(output.warnings.map((warning) => warning.code)).toEqual(
    Array.from({ length: 6 }, () => 'ui-kit-native-control-fallback')
  )
  const app = output.files.get('src/App.tsx') as string
  expect(app).toMatch(/<SelectItem value="unavailable" disabled>/)
  expect(app).toMatch(/<SelectTrigger[^>]*aria-label="Delivery"/)
  expect(app).toMatch(/<Checkbox[^>]*disabled[^>]*aria-label="Disabled checkbox"/)
  expect(app).toMatch(/<Switch[^>]*disabled[^>]*aria-label="Disabled switch"/)
  expect(app).toMatch(/<RadioGroup[^>]*aria-label="Disabled delivery group"/)
  expect(app).toMatch(/<RadioGroupItem value="First"[^>]*disabled/)
  expect(app).toContain('setSignal("select-focus")')
  expect(app).toContain('setSignal("select-blur")')
  expect(app).toMatch(
    /<input[^>]*aria-label="Click checkbox"[^>]*onClick=\{\(\) => setSignal\("clicked"\)\}/
  )
})

test('shadcn accessible field names remain localized without changing native Input mapping', () => {
  const { graph, pageId } = controlFoundationGraph()
  const output = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ uiKit: 'shadcn', i18n: true })
  })
  const app = output.files.get('src/App.tsx') as string
  expect(app).toMatch(/<SelectTrigger[^>]*aria-label=\{intl.formatMessage\(/)
  expect(app).toMatch(/<Checkbox[^>]*aria-label=\{intl.formatMessage\(/)
  expect(app).toContain('<Input ')
  expect(app).toContain('<Textarea ')
  expect(output.warnings).toEqual([])
})

test('VFS Tailwind safelist includes classes owned by the rendered kit templates', () => {
  const css = shadcnControlsFixture().files.get('src/index.css') as string
  const candidates = css.match(/@source inline\("([^\n]*)"\)/)?.[1].split(' ') ?? []
  expect(candidates).toContain('h-4')
  expect(candidates).toContain('w-4')
  expect(candidates).toContain('opacity-50')
  expect(candidates).toContain('[&>span]:line-clamp-1')
  expect(candidates).toContain('data-[disabled]:pointer-events-none')
})
