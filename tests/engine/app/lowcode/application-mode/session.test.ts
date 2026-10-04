import { describe, expect, test } from 'bun:test'

import { effectScope, ref, shallowRef } from 'vue'

import { createEditor } from '@open-pencil/core/editor'
import { SceneGraph } from '@open-pencil/scene-graph'

import {
  useApplicationRouteDraft,
  type ApplicationRouteSource
} from '@/app/lowcode/application-mode/route'
import { useApplicationModeModel } from '@/app/lowcode/application-mode/use'

describe('application panel captured write authority', () => {
  test('page switch, graph replacement, tab replacement and retained cancellation retire old callbacks', () => {
    const first = createEditor()
    const page = first.graph.getPages()[0]
    const secondPage = first.graph.createNode('CANVAS', first.graph.rootId)
    const selected = shallowRef(first)
    const active = ref(true)
    const scope = effectScope()
    const workflow = scope.run(() => useApplicationModeModel(() => selected.value, active))
    if (!workflow) throw new Error('Missing application workflow')
    try {
      const beforeMode = workflow.panel.value
      expect(beforeMode.setEnabled(true)).toBe(true)
      expect(beforeMode.setRole('application')).toBe(false)
      const beforePage = workflow.panel.value
      first.switchPage(secondPage.id)
      expect(beforePage.setRole('application')).toBe(false)
      expect(secondPage.lowcodeApplicationPage).toBeUndefined()
      first.switchPage(page.id)
      expect(beforePage.setRole('application')).toBe(false)
      expect(workflow.panel.value.setRole('application')).toBe(true)

      const beforeActive = workflow.panel.value
      active.value = false
      active.value = true
      expect(beforeActive.setRole('reference')).toBe(false)
      const beforeGraph = workflow.panel.value
      first.replaceGraph(new SceneGraph())
      expect(beforeGraph.setEnabled(false)).toBe(false)
      const beforeTab = workflow.panel.value
      selected.value = createEditor()
      expect(beforeTab.setEnabled(true)).toBe(false)
      expect(
        selected.value.graph.getNode(selected.value.graph.rootId)?.lowcodeApplication
      ).toBeUndefined()
      expect(workflow.panel.value.setEnabled(true)).toBe(true)
      const beforeDispose = workflow.panel.value
      scope.stop()
      expect(beforeDispose.setEnabled(false)).toBe(false)
    } finally {
      scope.stop()
    }
  })

  test('external metadata and target eligibility changes invalidate late select/route commits', () => {
    const editor = createEditor()
    const page = editor.graph.getPages()[0]
    const frame = editor.graph.createNode('FRAME', page.id)
    const scope = effectScope()
    const workflow = scope.run(() => useApplicationModeModel(() => editor))
    if (!workflow) throw new Error('Missing application workflow')
    try {
      workflow.panel.value.setEnabled(true)
      workflow.panel.value.setRole('application')
      const beforeEntry = workflow.panel.value
      editor.graph.updateNode(frame.id, { locked: true })
      expect(beforeEntry.setEntry(frame.id)).toBe(false)
      expect(workflow.panel.value.entries).toEqual([])
      const beforeRoute = workflow.panel.value
      editor.graph.updateNode(page.id, { lowcodeRoutePattern: '/external-change' })
      expect(beforeRoute.setRoute('/late-blur')).toBe(false)
      expect(workflow.panel.value.route).toBe('/external-change')
      const beforeRole = workflow.panel.value
      editor.graph.updateNode(page.id, {
        lowcodeApplicationPage: { version: 1, role: 'reference' }
      })
      editor.graph.updateNode(page.id, {
        lowcodeApplicationPage: { version: 1, role: 'application' }
      })
      expect(beforeRole.setRole('components')).toBe(false)
      expect(page.lowcodeApplicationPage?.role).toBe('application')
    } finally {
      scope.stop()
    }
  })
})

describe('application route input drafts', () => {
  test('invalid/unchanged input does not commit; enter/change/blur commit one captured edit', () => {
    const commits: string[] = []
    const source = shallowRef<ApplicationRouteSource>({
      value: '/products',
      version: 1,
      disabled: false,
      commit: (value) => commits.push(value)
    })
    const scope = effectScope()
    const field = scope.run(() => useApplicationRouteDraft(() => source.value))
    if (!field) throw new Error('Missing route draft')
    try {
      field.edit('https://example.test')
      field.commit()
      expect(commits).toEqual([])
      field.edit('/products')
      field.commit()
      expect(commits).toEqual([])
      field.edit('/products/:id')
      field.commit()
      field.commit()
      expect(commits).toEqual(['/products/:id'])
    } finally {
      scope.stop()
    }
  })

  test('external replacements, deactivation, disable and disposal permanently cancel late blur', () => {
    const commits: string[] = []
    const source = shallowRef<ApplicationRouteSource>({
      value: '/products',
      version: 1,
      disabled: false,
      commit: (value) => commits.push(value)
    })
    const active = ref(true)
    const scope = effectScope()
    const field = scope.run(() => useApplicationRouteDraft(() => source.value, active))
    if (!field) throw new Error('Missing route draft')
    try {
      field.edit('/late')
      source.value = { ...source.value, value: '/external', version: 2 }
      source.value = { ...source.value, value: '/products', version: 3 }
      field.commit()
      expect(field.draft.value).toBe('/products')
      field.edit('/late')
      active.value = false
      active.value = true
      field.commit()
      field.edit('/late')
      source.value = { ...source.value, disabled: true }
      source.value = { ...source.value, disabled: false }
      field.commit()
      field.edit('/late')
      scope.stop()
      field.commit()
      expect(commits).toEqual([])
    } finally {
      scope.stop()
    }
  })
})
