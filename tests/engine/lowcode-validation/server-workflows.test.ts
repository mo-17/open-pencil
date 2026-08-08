import { describe, expect, test } from 'bun:test'

import { validateServerWorkflows } from '@open-pencil/core/lowcode-validation'

const TRIGGER = { kind: 'http', method: 'POST', auth: 'supabase-user' } as const

function workflowWithExpression(expression: string): unknown[] {
  return [
    {
      id: 'secret-check',
      name: 'Secret check',
      trigger: TRIGGER,
      actions: [{ id: 'respond', kind: 'return', valueExpr: expression }]
    }
  ]
}

describe('validateServerWorkflows', () => {
  test('normalizes a valid env-referenced workflow', () => {
    const input = [
      {
        id: 'send-hook',
        name: 'Send hook',
        trigger: TRIGGER,
        actions: [
          {
            id: 'request',
            kind: 'httpRequest',
            method: 'POST',
            url: { kind: 'expr', expr: '"https://example.com/hook"' },
            body: { kind: 'expr', expr: '$currentUser.id' },
            headers: [
              { name: 'Authorization', value: { kind: 'env', name: 'SB_SECRET_KEY' } },
              { name: 'Content-Type', value: { kind: 'expr', expr: '"application/json"' } }
            ]
          }
        ]
      }
    ]

    expect(validateServerWorkflows(input)).toEqual({ ok: true, workflows: input })
  })

  test('rejects high-confidence secret formats without echoing the value', () => {
    const secrets = [
      ['sb_', 'secret_example123'].join(''),
      ['sk_', 'live_example123'].join(''),
      ['rk_', 'test_example123'].join(''),
      ['Bearer ', 'top.secret-token_123'].join(''),
      ['-----BEGIN ', 'PRIVATE KEY-----'].join(''),
      ['eyJhbGciOiJub25lIn0.', 'eyJyb2xlIjoic2VydmljZV9yb2xlIn0.', 'signature'].join('')
    ]

    for (const secret of secrets) {
      const result = validateServerWorkflows(workflowWithExpression(JSON.stringify(secret)))
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('server_workflows_json[0].actions[0].valueExpr')
        expect(result.error).toContain('secret literal')
        expect(result.error).not.toContain(secret)
      }
    }
  })

  test('requires env references for sensitive headers while allowing ordinary expressions', () => {
    for (const name of [
      'Authorization',
      'Proxy-Authorization',
      'Cookie',
      'Set-Cookie',
      'X-API-Key',
      'APIKey'
    ]) {
      const result = validateServerWorkflows([
        {
          id: 'header-check',
          name: 'Header check',
          trigger: TRIGGER,
          actions: [
            {
              id: 'request',
              kind: 'httpRequest',
              method: 'POST',
              url: { kind: 'expr', expr: '"https://example.com"' },
              headers: [{ name, value: { kind: 'expr', expr: 'token' } }]
            }
          ]
        }
      ])
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('headers[0].value')
        expect(result.error).toContain('environment-variable reference')
        expect(result.error).not.toContain('token')
      }
    }
  })

  test('prevents authenticated callers from steering outbound URLs that carry env headers', () => {
    const result = validateServerWorkflows([
      {
        id: 'proxy',
        name: 'Unsafe proxy',
        trigger: TRIGGER,
        params: ['destination'],
        actions: [
          {
            id: 'request',
            kind: 'httpRequest',
            method: 'GET',
            url: { kind: 'expr', expr: 'destination' },
            headers: [{ name: 'Authorization', value: { kind: 'env', name: 'UPSTREAM_TOKEN' } }]
          }
        ]
      }
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('actions[0].url')
      expect(result.error).toContain('static expression')
    }
  })

  test('rejects unknown references and recursive call cycles before persistence', () => {
    const unknown = validateServerWorkflows([
      {
        id: 'caller',
        name: 'Caller',
        trigger: TRIGGER,
        actions: [{ id: 'call', kind: 'callServerWorkflow', workflowId: 'missing' }]
      }
    ])
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.error).toContain('references an unknown workflow')

    const cyclic = validateServerWorkflows([
      {
        id: 'a',
        name: 'A',
        trigger: TRIGGER,
        actions: [{ id: 'a-call', kind: 'callServerWorkflow', workflowId: 'b' }]
      },
      {
        id: 'b',
        name: 'B',
        trigger: TRIGGER,
        actions: [{ id: 'b-call', kind: 'callServerWorkflow', workflowId: 'a' }]
      }
    ])
    expect(cyclic.ok).toBe(false)
    if (!cyclic.ok) expect(cyclic.error).toContain('a -> b -> a')
  })

  test('rejects unknown, forward, and branch-local expression references', () => {
    const unknown = validateServerWorkflows([
      {
        id: 'unknown-ref',
        name: 'Unknown ref',
        trigger: TRIGGER,
        actions: [{ id: 'respond', kind: 'return', valueExpr: 'missingValue' }]
      }
    ])
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) {
      expect(unknown.error).toContain('actions[0].valueExpr')
      expect(unknown.error).toContain('outside the workflow scope')
    }

    const forward = validateServerWorkflows([
      {
        id: 'forward-ref',
        name: 'Forward ref',
        trigger: TRIGGER,
        actions: [
          { id: 'respond', kind: 'return', valueExpr: 'laterResult' },
          {
            id: 'later',
            kind: 'httpRequest',
            method: 'POST',
            url: { kind: 'expr', expr: '"https://example.com"' },
            resultName: 'laterResult'
          }
        ]
      }
    ])
    expect(forward.ok).toBe(false)
    if (!forward.ok) expect(forward.error).toContain('actions[0].valueExpr')

    const branchLeak = validateServerWorkflows([
      {
        id: 'branch-ref',
        name: 'Branch ref',
        trigger: TRIGGER,
        actions: [
          {
            id: 'branch',
            kind: 'condition',
            condExpr: 'true',
            consequent: [
              {
                id: 'query',
                kind: 'supabaseQuery',
                table: 'items',
                resultName: 'branchResult'
              }
            ]
          },
          { id: 'respond', kind: 'return', valueExpr: 'branchResult' }
        ]
      }
    ])
    expect(branchLeak.ok).toBe(false)
    if (!branchLeak.ok) expect(branchLeak.error).toContain('actions[1].valueExpr')
  })
})
