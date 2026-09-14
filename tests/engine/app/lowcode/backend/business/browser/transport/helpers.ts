import { expect } from 'bun:test'

import type { Page } from '@playwright/test'

import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

export type BusinessTestRow = Record<string, string | number | boolean | null>

export interface BusinessBrowserCommand {
  commandId: string
  payload: object
  result: BusinessTestRow
  resources?: Record<string, BusinessTestRow[]>
  status?: number
}

interface BusinessCommandCall {
  commandId: string
  payload: unknown
  key: string | undefined
}

/** Scripted HTTP responses exercise UI payloads and invalidation; PostgreSQL verifies authority. */
export async function installBusinessTransport(page: Page, application: BackendApplicationSpecV1) {
  const base = application.httpApi?.browserClient?.apiBasePath
  if (!base) throw new Error('Missing test API mount')
  const steps: BusinessBrowserCommand[] = []
  const calls: BusinessCommandCall[] = []
  const failures: string[] = []
  const reads: string[] = []
  const resources: Record<string, BusinessTestRow[]> = {}
  const commands = new Map(application.commands?.commands.map((command) => [command.path, command]))
  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (!url.pathname.startsWith(base + '/')) return route.continue()
    const path = url.pathname.slice(base.length)
    try {
      if (request.method() === 'POST') {
        const command = commands.get(path)
        const step = steps.shift()
        if (!command || !step) throw new Error('Unexpected command: ' + path)
        const payload: unknown = request.postDataJSON()
        const key = request.headers()['idempotency-key']
        expect(command.id).toBe(step.commandId)
        expect(payload).toEqual(step.payload)
        expect(key).toMatch(/^[A-Za-z0-9._:-]{16,128}$/u)
        expect(request.headers().authorization).toBe('Bearer business-test-session')
        calls.push({ commandId: command.id, payload, key })
        if (!step.status || step.status < 400) Object.assign(resources, step.resources)
        return route.fulfill({ status: step.status ?? 200, json: step.result })
      }
      if (request.method() !== 'GET') throw new Error('Unexpected HTTP method')
      const resource = application.httpApi?.resources.find(
        (entry) => entry.path === path || path.startsWith(entry.path + '/')
      )
      if (!resource) throw new Error('Unexpected read resource: ' + path)
      reads.push(resource.id)
      const rows = resources[resource.id] ?? []
      if (path !== resource.path) {
        const recordId = decodeURIComponent(path.slice(resource.path.length + 1))
        const record = rows.find((row) => row.id === recordId)
        return record
          ? route.fulfill({ json: record })
          : route.fulfill({ status: 404, json: { message: 'Resource not found.' } })
      }
      const filters: unknown = JSON.parse(url.searchParams.get('filter') ?? '{}')
      if (!filters || typeof filters !== 'object' || Array.isArray(filters))
        throw new Error('Invalid test filter')
      const search = url.searchParams.get('search')?.toLowerCase()
      const data = rows.filter(
        (row) =>
          Object.entries(filters).every(([field, value]) => row[field] === value) &&
          (!search ||
            resource.query?.searchFields.some((field) =>
              String(row[field] ?? '')
                .toLowerCase()
                .includes(search)
            ))
      )
      return route.fulfill({ json: { data, nextCursor: null } })
    } catch (cause) {
      failures.push(String(cause))
      return route.fulfill({ status: 500, json: { message: 'Business browser fixture mismatch' } })
    }
  })
  return { steps, calls, failures, resources, reads }
}
