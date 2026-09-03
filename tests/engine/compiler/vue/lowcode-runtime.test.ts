import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { vueAdapter } from '#compiler/adapters/vue'
import type { IRElement, IRTree } from '#compiler/ir/types'
import { compileTemplate, parse as parseVueSfc } from 'vue/compiler-sfc'

import { compile, withDefaults } from '@open-pencil/compiler'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

function vueOptions() {
  return withDefaults({
    packageName: 'vue-lowcode-runtime',
    target: 'vue',
    router: 'none',
    devMode: false
  })
}

function textFile(files: ReadonlyMap<string, string | Uint8Array>, path: string): string {
  const value = files.get(path)
  if (typeof value !== 'string') throw new Error(`Missing text file: ${path}`)
  return value
}

function element(overrides: Partial<IRElement> = {}): IRElement {
  return {
    kind: 'element',
    sourceId: 'element',
    tag: 'div',
    className: '',
    attrs: {},
    children: [],
    ...overrides
  }
}

function expectValidVueFiles(files: ReadonlyMap<string, string | Uint8Array>): void {
  for (const [path, source] of files) {
    if (!path.endsWith('.vue') || typeof source !== 'string') continue
    const parsed = parseVueSfc(source, { filename: path })
    expect(parsed.errors).toEqual([])
    const template = parsed.descriptor.template
    if (!template) throw new Error(`${path} is missing a template`)
    const compiled = compileTemplate({ source: template.content, filename: path, id: path })
    expect(compiled.errors).toEqual([])
  }
}

function maybeWriteVerificationProject(files: ReadonlyMap<string, string | Uint8Array>): void {
  const directory = process.env.OPENPENCIL_VUE_LOWCODE_VERIFY_DIR
  if (!directory) return
  for (const [path, value] of files) {
    const destination = join(directory, path)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, value)
  }
}

describe('Vue local low-code runtimes', () => {
  test('emits production Supabase Auth, CRUD, list, Storage, and authenticated workflow parity', () => {
    const docStates: IRTree['docStates'] = [
      {
        id: 'current-user',
        name: '$currentUser',
        type: 'object',
        defaultValue: { id: null, email: null, signedIn: false }
      },
      { id: 'email', name: 'email', type: 'string', defaultValue: '' },
      { id: 'password', name: 'password', type: 'string', defaultValue: '' },
      { id: 'result', name: 'result', type: 'object', defaultValue: {} },
      { id: 'error', name: 'error', type: 'object', defaultValue: {} },
      { id: 'asset-url', name: 'assetUrl', type: 'string', defaultValue: '' }
    ]
    const supabaseConfig = {
      url: 'https://example.supabase.co',
      anonKey: 'sb_publishable_example',
      schema: 'public'
    }
    const serverWorkflows: NonNullable<IRTree['serverWorkflows']> = [
      {
        id: 'complete-task',
        name: 'Complete task',
        params: ['taskId'],
        actions: [{ kind: 'return', status: 200, valueAst: { kind: 'string', value: 'ok' } }]
      }
    ]
    const currentUserId = {
      kind: 'member' as const,
      object: { kind: 'ident' as const, name: '$currentUser' },
      property: 'id'
    }
    const query = {
      kind: 'supabaseQuery' as const,
      table: 'tasks',
      columns: 'id,title,owner_id',
      filters: [
        { column: 'owner_id', op: 'eq' as const, ast: currentUserId, references: ['$currentUser'] }
      ],
      single: false,
      resultTarget: 'result',
      errorTarget: 'error'
    }
    const protectedPage: IRTree = {
      pageId: 'tasks-page',
      pageName: 'Tasks',
      usesRouteParams: false,
      requiresAuth: true,
      authRedirect: '/login',
      children: [
        {
          kind: 'list',
          arrayName: 'tasksRows',
          itemName: 'task',
          indexName: 'index',
          template: element({ sourceId: 'task-row', tag: 'article' })
        },
        element({
          sourceId: 'search',
          tag: 'input',
          events: { onChange: [query] }
        }),
        element({
          sourceId: 'create-task',
          tag: 'button',
          events: {
            onClick: [
              {
                kind: 'supabaseMutation',
                operation: 'insert',
                table: 'tasks',
                payloadEntries: [
                  {
                    key: 'owner_id',
                    ast: currentUserId,
                    references: ['$currentUser']
                  }
                ],
                filters: [],
                resultTarget: 'result',
                errorTarget: 'error'
              }
            ]
          }
        }),
        element({
          sourceId: 'sign-in',
          tag: 'button',
          events: {
            onClick: [
              {
                kind: 'supabaseAuth',
                operation: 'signIn',
                emailAst: { kind: 'ident', name: 'email' },
                passwordAst: { kind: 'ident', name: 'password' },
                references: ['email', 'password'],
                errorTarget: 'error'
              }
            ]
          }
        }),
        element({
          sourceId: 'asset-upload',
          tag: 'input',
          upload: {
            bucket: 'task-assets',
            resultTarget: 'assetUrl',
            resultAccess: 'private',
            pathAst: currentUserId,
            accept: 'image/png,image/jpeg'
          }
        }),
        element({
          sourceId: 'complete-task',
          tag: 'button',
          events: {
            onClick: [
              {
                kind: 'invokeServerWorkflow',
                workflowId: 'complete-task',
                args: [{ key: 'taskId', ast: { kind: 'string', value: 'task-1' }, references: [] }]
              }
            ]
          }
        })
      ],
      states: [],
      docStates,
      docStateReads: ['$currentUser', 'email', 'password'],
      docStateWrites: ['result', 'error', 'assetUrl'],
      serverWorkflows,
      listQueries: [
        {
          rowsName: 'tasksRows',
          setterName: 'setTasksRows',
          table: 'tasks',
          columns: 'id,title,owner_id',
          filters: [
            {
              column: 'owner_id',
              op: 'eq',
              ast: currentUserId,
              references: ['$currentUser']
            }
          ],
          orderBy: [{ column: 'created_at', ascending: false }],
          limit: 20,
          deps: ['JSON.stringify($currentUser)']
        }
      ],
      supabaseConfig,
      warnings: []
    }
    const loginPage: IRTree = {
      ...protectedPage,
      pageId: 'login-page',
      pageName: 'Login',
      requiresAuth: undefined,
      authRedirect: undefined,
      children: []
    }

    const output = vueAdapter.emit([protectedPage, loginPage], vueOptions())
    maybeWriteVerificationProject(output.files)
    const page = textFile(output.files, 'src/pages/index.vue')
    const runtime = textFile(output.files, 'src/lowcode-supabase.ts')
    const serverClient = textFile(output.files, 'src/lowcode-server.ts')
    const packageJSON = JSON.parse(textFile(output.files, 'package.json')) as {
      dependencies: Record<string, string>
    }

    expect(packageJSON.dependencies['@supabase/supabase-js']).toBe('^2.100.0')
    expect(runtime).toContain("from './lowcode-state'")
    expect(runtime).not.toContain("from './_lowcode_state'")
    expect(runtime).toContain('supabase.auth.onAuthStateChange')
    expect(output.files.has('.env.example')).toBe(true)
    expect(page).toContain("from '../lowcode-supabase'")
    expect(page).toContain("from '../lowcode-server'")
    expect(page).toContain('__vueWatch(')
    expect(page).toMatch(/if \(!__opDoc_\$currentUser_[a-z0-9]+\.value\?\.signedIn\)/)
    expect(page).toContain('.from("tasks").select("id,title,owner_id")')
    expect(page).toContain('.from("tasks").insert({ "owner_id":')
    expect(page).toContain('.auth.signInWithPassword({ email:')
    expect(page).toContain('.storage.from("task-assets")')
    expect(page).toContain('__setDocState("assetUrl", __opPath)')
    expect(page).not.toContain('getPublicUrl(__opPath)')
    expect(page).toContain('__opInvokeServerWorkflow("complete-task"')
    expect(page).toContain('data-openpencil-auth-guard')
    expect(page).toContain('__opRouter.replace("/login")')
    expect(page).toContain('const __opRequestsInFlight = new Set<string>()')
    expect(page).toContain('__opRequestThrottleUntil.set(key, now + 300)')
    expect(page).toContain('__opDebounceChange(')
    expect(page).toContain('}, 250)')
    expect(page).toContain(':data-op-request-pending=')
    expect(page).toContain(':disabled=')
    expect(serverClient).toContain('Server workflow requires an authenticated user.')
    expect(serverClient).toContain('Authorization: `Bearer ${token}`')
    expect(output.files.has('supabase/functions/openpencil-runtime/index.ts')).toBe(true)
    expect(output.executableServerWorkflowFiles).toEqual([
      'supabase/functions/openpencil-runtime/index.ts',
      '.env.server.example',
      'openpencil-server.manifest.json',
      'SERVER_DEPLOYMENT.md'
    ])
    expect(output.warnings.map((warning) => warning.code)).not.toEqual(
      expect.arrayContaining([
        'vue-supabase-unsupported',
        'vue-auth-guard-unsupported',
        'vue-server-workflow-unsupported'
      ])
    )
    expectValidVueFiles(output.files)
  })

  test('injects the auth binding and keeps malformed authenticated output fail-closed', () => {
    const protectedPage: IRTree = {
      pageId: 'protected-page',
      pageName: 'Protected',
      usesRouteParams: false,
      requiresAuth: true,
      authRedirect: '/login',
      children: [element({ sourceId: 'protected-content', tag: 'button' })],
      states: [],
      docStates: [],
      docStateReads: [],
      docStateWrites: [],
      serverWorkflows: [],
      listQueries: [],
      supabaseConfig: {
        url: 'https://example.supabase.co',
        anonKey: 'sb_publishable_example',
        schema: 'public'
      },
      warnings: []
    }
    const protectedOutput = vueAdapter.emit([protectedPage], vueOptions())
    const protectedSource = textFile(protectedOutput.files, 'src/pages/index.vue')
    expect(protectedSource).toMatch(/__useDocState<unknown>\("\$currentUser"\)/)
    expect(protectedSource).toContain('data-openpencil-auth-guard')
    expect(protectedSource).toContain('<button>')

    const malformedPage: IRTree = {
      ...protectedPage,
      pageId: 'malformed-page',
      pageName: 'Malformed',
      supabaseConfig: undefined,
      serverWorkflows: [
        {
          id: 'server-action',
          name: 'Server action',
          params: [],
          actions: [{ kind: 'return', status: 200 }]
        }
      ],
      children: [
        element({
          sourceId: 'server-action',
          tag: 'button',
          events: {
            onClick: [{ kind: 'invokeServerWorkflow', workflowId: 'server-action', args: [] }]
          }
        })
      ]
    }
    const malformedOutput = vueAdapter.emit([malformedPage], vueOptions())
    const malformedSource = textFile(malformedOutput.files, 'src/pages/index.vue')
    expect(malformedSource).toContain('data-openpencil-unsupported="auth-guard"')
    expect(malformedSource).not.toContain('<button')
    expect(malformedSource).not.toContain("from '../lowcode-server'")
    expect(malformedOutput.files.has('src/lowcode-server.ts')).toBe(false)
    expect(malformedOutput.files.has('supabase/functions/openpencil-runtime/index.ts')).toBe(false)
    expect(malformedOutput.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        'vue-supabase-config-required',
        'vue-server-workflow-definition-required'
      ])
    )
    expectValidVueFiles(malformedOutput.files)
  })

  test('collector-to-Vue emits accessible bounded toast/confirm and local validation', () => {
    const graph = makeSceneGraph('Local interactions')
    const pageId = firstPageId(graph)
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [
        { id: 'email-state', name: 'email', type: 'string', defaultValue: '' },
        { id: 'status-state', name: 'status', type: 'string', defaultValue: 'idle' }
      ]
    })

    const actionButton = graph.createNode('BUTTON', pageId, {
      name: 'Run actions',
      interactiveProps: { text: 'Run actions' }
    })
    actionButton.events = {
      onClick: [
        {
          id: 'started-toast',
          kind: 'toast',
          messageExpr: '"Started"',
          variant: 'success',
          position: 'top-center',
          durationMs: 1500
        },
        {
          id: 'confirm-save',
          kind: 'confirm',
          messageExpr: '"Save changes?"',
          confirmLabel: 'Save',
          cancelLabel: 'Keep editing',
          consequent: [
            {
              id: 'confirmed-status',
              kind: 'setVariable',
              targetName: 'status',
              valueExpr: '"confirmed"'
            }
          ],
          alternate: [
            {
              id: 'cancelled-status',
              kind: 'setVariable',
              targetName: 'status',
              valueExpr: '"cancelled"'
            }
          ]
        }
      ]
    }

    const form = graph.createNode('FORM', pageId, {
      name: 'Email form',
      width: 320,
      height: 180,
      interactiveProps: {
        validationSummary: { enabled: true, title: 'Fix the highlighted fields' }
      },
      events: {
        onSubmit: [
          {
            id: 'submitted-toast',
            kind: 'toast',
            messageExpr: '"Submitted"',
            variant: 'info'
          }
        ]
      }
    })
    const email = graph.createNode('INPUT', form.id, {
      name: 'Email',
      width: 240,
      height: 40,
      bindings: { value: { kind: 'docState', docStateName: 'email' } },
      interactiveProps: {
        validation: {
          required: true,
          pattern: '^[^@]+@[^@]+$',
          customExpr: 'email !== "blocked@example.com"',
          messages: {
            required: 'Email is required',
            pattern: 'Enter a valid email',
            custom: 'That email is blocked'
          }
        }
      }
    })

    const output = compile({ graph, pageIds: [pageId], options: vueOptions() })
    maybeWriteVerificationProject(output.files)
    const page = textFile(output.files, 'src/pages/index.vue')
    const app = textFile(output.files, 'src/App.vue')
    const toastRuntime = textFile(output.files, 'src/lowcode-toast.ts')
    const toastHost = textFile(output.files, 'src/LowcodeToastHost.vue')
    const confirmHost = textFile(output.files, 'src/LowcodeConfirmHost.vue')

    expect(output.warnings.map((warning) => warning.code)).not.toEqual(
      expect.arrayContaining([
        'vue-event-toast-unsupported',
        'vue-event-confirm-unsupported',
        'vue-validation-unsupported'
      ])
    )
    expect(page).toContain("import { __opToast } from '../lowcode-toast'")
    expect(page).toContain("import { __opConfirm } from '../lowcode-confirm'")
    expect(page).toContain("import { __opValidateValue } from '../lowcode-validation'")
    expect(page).toContain(
      '__opToast("Started", "success", { position: "top-center", durationMs: 1500 })'
    )
    expect(page).toContain(
      'if (await __opConfirm("Save changes?", { confirmLabel: "Save", cancelLabel: "Keep editing" }))'
    )
    expect(page).toContain('__setDocState("status", "confirmed")')
    expect(page).toContain('else { __setDocState("status", "cancelled") }')
    expect(page).toContain(`if (!__validateFields([${JSON.stringify(email.id)}])) return`)
    expect(page).toContain('data-openpencil-validation-field')
    expect(page).toContain(':aria-invalid="__fieldErrors[')
    expect(page).toContain(':aria-describedby="__fieldErrors[')
    expect(page).toContain('class="openpencil-validation-error" role="alert"')
    expect(page).toContain('Fix the highlighted fields')
    expect(page).toContain('if (error === null && !(')
    expect(page).toContain('That email is blocked')

    expect(app).toContain("import LowcodeToastHost from './LowcodeToastHost.vue'")
    expect(app).toContain("import LowcodeConfirmHost from './LowcodeConfirmHost.vue'")
    expect(app).toContain('<LowcodeToastHost />')
    expect(app).toContain('<LowcodeConfirmHost />')
    expect(toastRuntime).toContain('const MAX_TOASTS = 5')
    expect(toastRuntime).toContain('const timers = new Map')
    expect(toastRuntime).toContain('for (const toast of dropped) clearTimer(toast.id)')
    expect(toastRuntime).toContain('export function __opClearToasts(): void')
    expect(toastHost).toContain('onBeforeUnmount(__opClearToasts)')
    expect(toastHost).toContain('aria-live="polite"')
    expect(toastHost).toContain(":role=\"toast.variant === 'error' ? 'alert' : 'status'\"")
    expect(confirmHost).toContain('role="dialog"')
    expect(confirmHost).toContain('aria-modal="true"')
    expect(confirmHost).toContain('aria-label="Confirmation"')
    expect(confirmHost).toContain("event.key === 'Escape'")
    expect(confirmHost).toContain('cancelButton.value?.focus()')
    expect(confirmHost).not.toContain('v-html')
    expect(toastHost).not.toContain('v-html')
    expectValidVueFiles(output.files)
  })

  test('remote validation stays fail-closed without emitting a network validator', () => {
    const graph = makeSceneGraph('Remote validation boundary')
    const pageId = firstPageId(graph)
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'email-state', name: 'email', type: 'string', defaultValue: '' }]
    })
    const form = graph.createNode('FORM', pageId, {
      name: 'Remote form',
      width: 320,
      height: 180
    })
    const email = graph.createNode('INPUT', form.id, {
      name: 'Email',
      width: 240,
      height: 40,
      bindings: { value: { kind: 'docState', docStateName: 'email' } },
      interactiveProps: {
        validation: {
          required: true,
          async: {
            url: '/api/check-email',
            method: 'POST',
            message: 'Email is already taken'
          }
        }
      }
    })

    const output = compile({ graph, pageIds: [pageId], options: vueOptions() })
    const page = textFile(output.files, 'src/pages/index.vue')
    const runtime = textFile(output.files, 'src/lowcode-validation.ts')

    expect(output.warnings.map((warning) => warning.code)).toContain(
      'vue-validation-async-unsupported'
    )
    expect(page).toContain(
      'if (error === null) error = "Remote validation is unavailable in this Vue export."'
    )
    expect(page).toContain(`if (!__validateFields([${JSON.stringify(email.id)}])) return`)
    expect(page).not.toContain('/api/check-email')
    expect(runtime).not.toContain('fetch(')
    expectValidVueFiles(output.files)
  })

  test('projects without local low-code interactions emit no dormant hosts or runtimes', () => {
    const graph = makeSceneGraph('Static')
    const pageId = firstPageId(graph)
    graph.createNode('TEXT', pageId, { text: 'Static page' })

    const output = compile({ graph, pageIds: [pageId], options: vueOptions() })
    const paths = [...output.files.keys()]

    expect(paths).not.toContain('src/lowcode-toast.ts')
    expect(paths).not.toContain('src/LowcodeToastHost.vue')
    expect(paths).not.toContain('src/lowcode-confirm.ts')
    expect(paths).not.toContain('src/LowcodeConfirmHost.vue')
    expect(paths).not.toContain('src/lowcode-validation.ts')
    expect(paths).not.toContain('src/lowcode-validation.css')
  })
})
