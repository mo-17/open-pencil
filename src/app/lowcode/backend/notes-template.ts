import type { Editor } from '@open-pencil/core/editor'
import {
  validateBackendClientAction,
  validateBackendResourceDataSource
} from '@open-pencil/lowcode/backend'
import type {
  BackendApplicationSpecV1,
  BackendHttpAPIResourceIRV1,
  DataFieldIR
} from '@open-pencil/lowcode/backend'
import type { ActionDef, DocumentStateDef, SceneNode, StateDef } from '@open-pencil/scene-graph'

import type { AppBackendProviderDescriptor } from '@/app/plugins/host/backend-provider'

import {
  commitBackendProviderDocumentRequest,
  createBackendProviderDocumentRequest
} from './document'
import { BackendDraftOperationError } from './draft'
import { backendTemplateListProps } from './notes-template-style'
import { createNotesFeedback } from './notes-template/feedback'
import {
  createNotesPresentation,
  notesSecondaryButton,
  notesSurface,
  NOTES_PALETTE
} from './notes-template/presentation'
import { adaptNotesPagesToMobile } from './notes-template/responsive'

export type NotesTemplateEditor = Pick<
  Editor,
  'graph' | 'createShape' | 'updateNodeWithUndo' | 'undo'
>
export interface NotesTemplateResult {
  readonly notesPageId: string
  readonly loginPageId: string
  readonly notesPath: string
  readonly loginPath: string
}

function routePath(editor: NotesTemplateEditor, base: string): string {
  const pages = editor.graph.getPages()
  for (let count = 1; count < 100; count++) {
    const path = count === 1 ? base : `${base}-${count}`
    if (
      !pages.some(
        (page) =>
          page.lowcodeRoutePattern === path ||
          `/${page.name.toLowerCase().replace(/\s+/gu, '-')}` === path
      )
    )
      return path
  }
  throw new BackendDraftOperationError('No available page route remains.')
}

function stateName(base: string, states: readonly DocumentStateDef[]): string {
  let name = base
  for (let index = 2; states.some((entry) => entry.name === name); index++) name = `${base}${index}`
  return name
}

function initialValue(field: DataFieldIR): string | number | boolean {
  if (field.default?.kind === 'literal' && field.default.value !== null) return field.default.value
  if (field.type === 'boolean') return false
  if (field.type === 'integer' || field.type === 'number') return 0
  return ''
}

function primitiveExpression(value: unknown): string {
  if (typeof value === 'boolean') return value ? '!0' : '!1'
  return JSON.stringify(value)
}
function fieldDisplayExpression(field: DataFieldIR): string {
  const value =
    field.type === 'boolean' ? `(item.${field.id} ? "true" : "false")` : `item.${field.id}`
  return field.nullable ? `item.${field.id} === noteNullValue.value ? "(empty)" : ${value}` : value
}

function fieldStateType(field: DataFieldIR): StateDef['type'] {
  if (field.type === 'boolean') return 'boolean'
  if (field.type === 'integer' || field.type === 'number') return 'number'
  return 'string'
}
function fieldControlType(field: DataFieldIR): SceneNode['type'] {
  if (field.type === 'boolean') return 'CHECKBOX'
  if (field.id === 'content' && field.type === 'string') return 'TEXTAREA'
  return 'INPUT'
}

function resourceFields(
  application: BackendApplicationSpecV1,
  resource: BackendHttpAPIResourceIRV1
): DataFieldIR[] {
  const entity = application.dataModel.entities.find((entry) => entry.id === resource.entityId)
  if (!entity) throw new BackendDraftOperationError('The resource entity is unavailable.')
  const selected = new Set([...(resource.createFields ?? []), ...(resource.updateFields ?? [])])
  return entity.fields.filter((field) => selected.has(field.id))
}

export function createPersonalNotesPages(
  editor: NotesTemplateEditor,
  descriptor: AppBackendProviderDescriptor,
  application: BackendApplicationSpecV1
): NotesTemplateResult {
  createBackendProviderDocumentRequest(descriptor, application)
  const resource = application.httpApi?.resources.find((entry) =>
    ['list', 'create', 'update', 'delete'].every((operation) =>
      entry.operations.includes(operation as 'list')
    )
  )
  if (!application.httpApi?.browserClient || !resource)
    throw new BackendDraftOperationError(
      'Configure login and a resource with list, create, update, and delete first.'
    )
  const root = editor.graph.getNode(editor.graph.rootId)
  if (
    !root ||
    root.lowcodeSupabaseConfig ||
    root.lowcodeAuthRedirect ||
    editor.graph.getPages().some((page) => page.lowcodeRequiresAuth)
  ) {
    throw new BackendDraftOperationError(
      'This starter needs a document without an existing authentication flow. Existing pages and authentication are preserved.'
    )
  }
  const fields = resourceFields(application, resource)
  const entity = application.dataModel.entities.find((entry) => entry.id === resource.entityId)
  const primaryField = entity?.primaryKey?.fields[0]
  if (!primaryField || !resource.readFields.includes(primaryField))
    throw new BackendDraftOperationError(
      'The read projection must include the primary key for editing.'
    )
  if (fields.some((field) => !resource.readFields.includes(field.id)))
    throw new BackendDraftOperationError(
      'Include editable fields in the read projection before creating pages.'
    )
  const notesPath = routePath(editor, '/notes')
  const loginPath = routePath(editor, '/login')
  const docStates = structuredClone(root.lowcodeDocumentState ?? [])
  const addDoc = (base: string): string => {
    const name = stateName(base, docStates)
    docStates.push({ id: crypto.randomUUID(), name, type: 'string', defaultValue: '' })
    return name
  }
  const errorName = addDoc('notesError')
  const feedback = createNotesFeedback(errorName)
  const cursorName = addDoc('notesCursor')
  const afterState: StateDef = {
    id: crypto.randomUUID(),
    name: 'notesAfter',
    type: 'string',
    defaultValue: ''
  }
  const afterName = afterState.name
  const editState: StateDef = {
    id: crypto.randomUUID(),
    name: 'noteId',
    type: 'string',
    defaultValue: ''
  }
  const fieldStates = fields.map((field): StateDef => ({
    id: crypto.randomUUID(),
    name: `note_${field.id}`,
    type: fieldStateType(field),
    defaultValue: initialValue(field)
  }))
  const nullValueState: StateDef = {
    id: crypto.randomUUID(),
    name: 'noteNullValue',
    type: 'object',
    defaultValue: { value: null }
  }
  const nullableStates = fields
    .filter((field) => field.nullable)
    .map((field): StateDef => ({
      id: crypto.randomUUID(),
      name: `nullable_${field.id}`,
      type: 'boolean',
      defaultValue: field.default?.kind === 'literal' && field.default.value === null
    }))
  const fieldExpression = (key: string): string =>
    fields.find((field) => field.id === key)?.nullable
      ? `nullable_${key} ? noteNullValue.value : note_${key}`
      : `note_${key}`
  const clear: ActionDef[] = [editState, ...fieldStates, ...nullableStates].map((state) => ({
    id: crypto.randomUUID(),
    kind: 'setState',
    targetStateId: state.id,
    valueExpr: primitiveExpression(state.defaultValue)
  }))
  const request = (operation: 'create' | 'update'): ActionDef => ({
    id: crypto.randomUUID(),
    kind: 'backendRequest',
    resourceId: resource.id,
    operation,
    ...(operation === 'update' ? { idExpr: editState.name } : {}),
    payloadEntries: (operation === 'create'
      ? (resource.createFields ?? [])
      : (resource.updateFields ?? [])
    ).map((key) => ({ key, valueExpr: fieldExpression(key) })),
    errorTarget: errorName,
    onSuccess: [
      ...structuredClone(clear),
      ...feedback.success(operation === 'create' ? 'Note created.' : 'Note updated.')
    ],
    onError: [feedback.unlock()]
  })
  const prototypeActions: ActionDef[] = [
    request('create'),
    request('update'),
    {
      id: crypto.randomUUID(),
      kind: 'backendAuth',
      operation: 'signIn',
      returnPath: notesPath,
      errorTarget: errorName
    },
    { id: crypto.randomUUID(), kind: 'backendAuth', operation: 'signOut', errorTarget: errorName },
    {
      id: crypto.randomUUID(),
      kind: 'backendRequest',
      resourceId: resource.id,
      operation: 'delete',
      idExpr: `item.${primaryField}`,
      errorTarget: errorName
    }
  ]
  const diagnostics = prototypeActions.flatMap((action) =>
    action.kind === 'backendRequest' || action.kind === 'backendAuth'
      ? validateBackendClientAction(application, action, docStates)
      : []
  )
  diagnostics.push(
    ...validateBackendResourceDataSource(
      application,
      {
        kind: 'backendResource',
        resourceId: resource.id,
        limit: Math.min(20, resource.maxPageSize ?? 20),
        afterExpr: afterName,
        nextCursorTarget: cursorName,
        errorTarget: errorName
      },
      docStates
    )
  )
  if (diagnostics.length)
    throw new BackendDraftOperationError(diagnostics.map((entry) => entry.message).join(' '))
  let notesPageId = ''
  let loginPageId = ''
  editor.undo.runBatch('Create personal notes application', () => {
    commitBackendProviderDocumentRequest(editor, descriptor, application)
    editor.updateNodeWithUndo(
      root.id,
      { lowcodeDocumentState: docStates, lowcodeAuthRedirect: loginPath },
      'Configure notes state'
    )
    const shape = createNotesPresentation(editor)
    const text = (
      parent: string,
      name: string,
      x: number,
      y: number,
      width: number,
      props: Partial<SceneNode> = {}
    ) => shape('TEXT', name, parent, x, y, width, 32, { text: name, fontSize: 18, ...props })
    const button = (
      parent: string,
      label: string,
      x: number,
      y: number,
      actions: ActionDef[],
      secondary = false,
      props: Partial<SceneNode> = {}
    ) =>
      shape('BUTTON', label, parent, x, y, 150, 44, {
        ...(secondary ? notesSecondaryButton() : {}),
        ...props,
        interactiveProps: {
          ...(secondary ? notesSecondaryButton().interactiveProps : {}),
          text: label
        },
        events: { onClick: actions }
      })
    loginPageId = shape('CANVAS', 'Notes login', root.id, 0, 0, 1200, 760, {
      lowcodeRoutePattern: loginPath
    })
    const loginFrame = shape('FRAME', 'Sign in', loginPageId, 0, 0, 1200, 760, {
      ...notesSurface(NOTES_PALETTE.background),
      cornerRadius: 0
    })
    shape('FRAME', 'A place for your thoughts', loginFrame, 64, 80, 1072, 580, notesSurface())
    shape(
      'FRAME',
      'Notebook illustration',
      loginFrame,
      64,
      80,
      490,
      580,
      notesSurface(NOTES_PALETTE.tint)
    )
    text(loginFrame, 'MAKE ROOM FOR IDEAS', 104, 122, 390, { fontSize: 12, fontWeight: 600 })
    text(loginFrame, 'Small thoughts.\nA little more space.', 104, 176, 380, {
      fontSize: 38,
      fontWeight: 600,
      height: 112
    })
    shape(
      'FRAME',
      'Notebook sheet',
      loginFrame,
      154,
      342,
      288,
      242,
      notesSurface(NOTES_PALETTE.paper, true)
    )
    for (let index = 0; index < 5; index++)
      shape(
        'RECTANGLE',
        'Notebook line',
        loginFrame,
        184,
        386 + index * 30,
        index === 4 ? 142 : 216,
        2,
        notesSurface(NOTES_PALETTE.line)
      )
    text(loginFrame, 'Personal notes', 620, 198, 440, { fontSize: 34, fontWeight: 600, height: 52 })
    text(loginFrame, 'Sign in to view your private notes.', 620, 282, 438, {
      fontSize: 16,
      height: 56
    })
    button(loginFrame, 'Sign in', 620, 382, [
      {
        id: crypto.randomUUID(),
        kind: 'backendAuth',
        operation: 'signIn',
        returnPath: notesPath,
        errorTarget: errorName
      }
    ])
    text(loginFrame, 'Your words, together in one quiet place.', 620, 458, 438, {
      fontSize: 14,
      height: 54
    })
    text(loginFrame, '', 620, 534, 438, {
      bindings: { text: { kind: 'docState', docStateName: errorName } },
      height: 72,
      interactiveProps: { layout: { overflowY: 'auto', whiteSpace: 'pre-wrap' } }
    })
    notesPageId = shape('CANVAS', 'Personal notes', root.id, 0, 0, 1200, 1000, {
      lowcodeRoutePattern: notesPath,
      lowcodeRequiresAuth: true,
      state: [
        editState,
        afterState,
        ...fieldStates,
        ...nullableStates,
        ...feedback.states,
        ...(nullableStates.length ? [nullValueState] : [])
      ]
    })
    const frame = shape('FRAME', 'Personal notes', notesPageId, 0, 0, 1200, 1000, {
      ...notesSurface(NOTES_PALETTE.background),
      cornerRadius: 0
    })
    text(frame, 'YOUR PRIVATE SPACE', 48, 28, 650, { fontSize: 12, fontWeight: 600 })
    text(frame, 'Personal notes', 48, 68, 650, { fontSize: 34, fontWeight: 600, height: 46 })
    text(frame, 'Capture an idea. Come back to it whenever you need.', 48, 120, 900, {
      fontSize: 15
    })
    button(
      frame,
      'Sign out',
      1000,
      60,
      [
        {
          id: crypto.randomUUID(),
          kind: 'backendAuth',
          operation: 'signOut',
          errorTarget: errorName
        }
      ],
      true
    )
    const fieldOffsets: number[] = []
    let controlsHeight = 0
    for (const field of fields) {
      fieldOffsets.push(controlsHeight)
      controlsHeight += fieldControlType(field) === 'TEXTAREA' ? 168 : 84
    }
    const formHeight = controlsHeight + 64
    shape(
      'FRAME',
      'Writing desk',
      frame,
      48,
      184,
      528,
      formHeight + 148,
      notesSurface(NOTES_PALETTE.paper, true)
    )
    text(frame, 'Write a note', 72, 208, 440, { fontSize: 22, fontWeight: 600 })
    const form = shape('FORM', 'Edit note', frame, 72, 260, 480, formHeight, {
      // The template places labels, controls and its button row with explicit coordinates.
      // Keep those coordinates instead of allowing FORM's default flex column to shrink them.
      layoutMode: 'NONE',
      renderCondition: `!${feedback.pending}`,
      events: {
        onSubmit: [
          feedback.guard([
            ...feedback.start('Saving note…'),
            {
              id: crypto.randomUUID(),
              kind: 'condition',
              condExpr: `${editState.name} === ""`,
              consequent: [request('create')],
              alternate: [request('update')]
            }
          ])
        ]
      }
    })
    text(frame, 'Saving note…', 72, 260, 480, {
      bindings: { text: { kind: 'ref', stateId: feedback.activity.id } },
      renderCondition: feedback.pending
    })
    fields.forEach((field, index) => {
      text(form, field.name, 0, fieldOffsets[index], 300, { fontSize: 14, fontWeight: 600 })
      const type = fieldControlType(field)
      const nullState = nullableStates.find((state) => state.name === `nullable_${field.id}`)
      if (nullState)
        shape('BUTTON', `${field.name}: Empty value`, form, 310, fieldOffsets[index], 170, 28, {
          bindings: {
            text: { kind: 'expr', expr: `${nullState.name} ? "Use value" : "Set empty"` }
          },
          interactiveProps: { text: 'Set empty' },
          events: {
            onClick: [
              {
                id: crypto.randomUUID(),
                kind: 'setState',
                targetStateId: nullState.id,
                valueExpr: `!${nullState.name}`
              }
            ]
          }
        })
      shape(
        type,
        field.name,
        form,
        0,
        fieldOffsets[index] + 30,
        480,
        type === 'TEXTAREA' ? 126 : 42,
        {
          bindings: { value: { kind: 'ref', stateId: fieldStates[index].id } },
          ...(nullState ? { renderCondition: `!${nullState.name}` } : {}),
          interactiveProps: { placeholder: field.name }
        }
      )
    })
    shape('BUTTON', 'Save note', form, 0, controlsHeight, 150, 44, {
      interactiveProps: { text: 'Save note' }
    })
    button(form, 'Clear form', 168, controlsHeight, clear, true)
    text(frame, '', 72, 272 + formHeight, 480, {
      bindings: { text: { kind: 'docState', docStateName: errorName } },
      height: 52,
      interactiveProps: { layout: { overflowY: 'auto', whiteSpace: 'pre-wrap' } }
    })
    const cardOffsets: number[] = []
    let cardContentHeight = 0
    for (const field of fields) {
      cardOffsets.push(cardContentHeight)
      cardContentHeight += fieldControlType(field) === 'TEXTAREA' ? 132 : 40
    }
    const cardHeight = Math.max(180, cardContentHeight + 80)
    shape(
      'FRAME',
      'Notes collection',
      frame,
      608,
      184,
      544,
      730,
      notesSurface(NOTES_PALETTE.paper, true)
    )
    text(frame, 'Your notes', 632, 208, 496, { fontSize: 22, fontWeight: 600 })
    const list = shape('LIST', 'Notes', frame, 632, 260, 496, 556, {
      ...backendTemplateListProps(
        {
          kind: 'backendResource',
          resourceId: resource.id,
          limit: Math.min(20, resource.maxPageSize ?? 20),
          afterExpr: afterName,
          nextCursorTarget: cursorName,
          errorTarget: errorName
        },
        cardHeight
      ),
      fills: []
    })
    const card = shape('FRAME', 'Note', list, 0, 0, 472, cardHeight)
    fields.forEach((field, index) =>
      text(card, field.name, 16, cardOffsets[index] + 16, 440, {
        bindings: { text: { kind: 'expr', expr: fieldDisplayExpression(field) } },
        fontSize: index === 0 ? 20 : 15,
        fontWeight: index === 0 ? 600 : 400,
        height: fieldControlType(field) === 'TEXTAREA' ? 116 : 32,
        interactiveProps: { layout: { overflowY: 'auto', whiteSpace: 'pre-wrap' } }
      })
    )
    const editActions: ActionDef[] = [
      {
        id: crypto.randomUUID(),
        kind: 'setState',
        targetStateId: editState.id,
        valueExpr: `item.${primaryField}`
      },
      ...fields.map((field, index): ActionDef => ({
        id: crypto.randomUUID(),
        kind: 'setState',
        targetStateId: fieldStates[index].id,
        valueExpr: field.nullable
          ? `item.${field.id} === noteNullValue.value ? ${primitiveExpression(initialValue(field))} : item.${field.id}`
          : `item.${field.id}`
      }))
    ]
    for (const field of fields.filter((entry) => entry.nullable)) {
      const target = nullableStates.find((state) => state.name === `nullable_${field.id}`)
      if (target)
        editActions.push({
          id: crypto.randomUUID(),
          kind: 'setState',
          targetStateId: target.id,
          valueExpr: `item.${field.id} === noteNullValue.value`
        })
    }
    button(card, 'Edit', 16, cardContentHeight + 24, [feedback.guard(editActions)], true, {
      renderCondition: `!${feedback.pending}`
    })
    button(
      card,
      'Delete',
      184,
      cardContentHeight + 24,
      [
        feedback.remove(resource.id, `item.${primaryField}`, [
          {
            id: crypto.randomUUID(),
            kind: 'condition',
            condExpr: `${editState.name} === item.${primaryField}`,
            consequent: structuredClone(clear)
          }
        ])
      ],
      true,
      { renderCondition: `!${feedback.pending}` }
    )
    button(
      frame,
      'First page',
      632,
      842,
      [
        { id: crypto.randomUUID(), kind: 'setState', targetStateId: afterState.id, valueExpr: '""' }
      ],
      true
    )
    button(
      frame,
      'Next page',
      800,
      842,
      [
        {
          id: crypto.randomUUID(),
          kind: 'setState',
          targetStateId: afterState.id,
          valueExpr: cursorName
        }
      ],
      true
    )
    const height = Math.max(1000, formHeight + 380)
    editor.updateNodeWithUndo(frame, { height }, 'Size notes workspace')
    editor.updateNodeWithUndo(notesPageId, { height }, 'Size notes page')
    adaptNotesPagesToMobile(editor, [loginFrame, frame])
  })
  return { notesPageId, loginPageId, notesPath, loginPath }
}
