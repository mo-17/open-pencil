import { describe, expect, test } from 'bun:test'

import { parsePluginConnectorContract } from '@open-pencil/plugin-contracts'
import type { PluginConnectorOperationV1 } from '@open-pencil/plugin-contracts'

import {
  DEFERRED_REVIEWED_SERVICES,
  OPENAI_MODELS_SERVICE,
  REVIEWED_EXTERNAL_SERVICE_CATALOG,
  REVIEWED_EXTERNAL_SERVICE_CONNECTORS,
  type ReviewedServiceDescriptor
} from '@/app/plugins/connectors/services'

const SIGNAL = new AbortController().signal

function descriptor(pluginId: string): ReviewedServiceDescriptor {
  const value = REVIEWED_EXTERNAL_SERVICE_CATALOG.find(
    (candidate) => candidate.connector.contract.pluginId === pluginId
  )
  if (!value) throw new Error(`Missing reviewed service fixture: ${pluginId}`)
  return value
}

function onlyOperation(service: ReviewedServiceDescriptor): PluginConnectorOperationV1 {
  const operation = service.connector.contract.operations[0]
  if (!operation) throw new Error(`Missing reviewed operation: ${service.key}`)
  return operation
}

function operationExample(service: ReviewedServiceDescriptor) {
  const metadata = service.connector.metadata.operations[0]
  if (!metadata?.example) throw new Error(`Missing reviewed operation example: ${service.key}`)
  return metadata.example
}

function onlyOrigin(service: ReviewedServiceDescriptor): string {
  const origin = service.connector.contract.network.origins[0]
  if (!origin) throw new Error(`Missing reviewed origin: ${service.key}`)
  return origin
}

interface ServiceFixture {
  readonly pluginId: string
  readonly expectedUrl: string
  readonly upstream: unknown
  readonly first: Readonly<{ id: string; name: string }>
  readonly cursor?: string
  readonly truncated?: boolean
}

const FIXTURES: readonly ServiceFixture[] = [
  {
    pluginId: 'open-pencil.neon-postgres',
    expectedUrl: 'https://console.neon.tech/api/v2/projects?limit=20',
    upstream: {
      projects: [
        {
          id: 'neon-project-1',
          name: 'Design data',
          region_id: 'aws-us-east-2',
          pg_version: 17,
          created_at: '2026-08-10T00:00:00Z'
        }
      ],
      pagination: { cursor: 'neon-next' }
    },
    first: { id: 'neon-project-1', name: 'Design data' },
    cursor: 'neon-next',
    truncated: true
  },
  {
    pluginId: 'open-pencil.sentry',
    expectedUrl: 'https://sentry.io/api/0/organizations/acme/issues/?limit=25',
    upstream: [
      {
        id: 'sentry-project-1',
        shortId: 'OPEN-PENCIL-1',
        title: 'Canvas render failed',
        culprit: 'renderCanvas',
        level: 'error',
        status: 'unresolved',
        lastSeen: '2026-08-10T00:00:00Z',
        permalink: 'https://sentry.io/organizations/acme/issues/sentry-project-1/'
      }
    ],
    first: { id: 'sentry-project-1', name: 'Canvas render failed' },
    truncated: false
  },
  {
    pluginId: 'open-pencil.hubspot',
    expectedUrl:
      'https://api.hubapi.com/crm/objects/2026-03/contacts?properties=firstname%2Clastname%2Clastmodifieddate&archived=false&limit=25',
    upstream: {
      results: [
        {
          id: 'contact-1',
          properties: {
            firstname: 'Ada',
            lastname: 'Lovelace',
            lastmodifieddate: '2026-08-10T00:00:00Z'
          },
          updatedAt: '2026-08-10T00:00:00Z'
        }
      ],
      paging: { next: { after: 'contact-next' } }
    },
    first: { id: 'contact-1', name: 'Ada Lovelace' },
    cursor: 'contact-next',
    truncated: true
  },
  {
    pluginId: 'open-pencil.apollo',
    expectedUrl: 'https://api.apollo.io/api/v1/labels',
    upstream: [
      {
        id: 'apollo-list-1',
        name: 'Design leads',
        modality: 'contacts',
        cached_count: 12
      }
    ],
    first: { id: 'apollo-list-1', name: 'Design leads' },
    truncated: false
  },
  {
    pluginId: 'open-pencil.posthog',
    expectedUrl:
      'https://us.posthog.com/api/projects/12345/insights/?basic=true&format=json&refresh=force_cache&limit=25&offset=0',
    upstream: {
      results: [{ id: 'posthog-insight-1', name: 'Activation', updated_at: '2026-08-10' }],
      next: null
    },
    first: { id: 'posthog-insight-1', name: 'Activation' },
    truncated: false
  },
  {
    pluginId: 'open-pencil.asana',
    expectedUrl:
      'https://app.asana.com/api/1.0/workspaces?opt_fields=name%2Cis_organization&limit=25',
    upstream: {
      data: [
        {
          gid: 'asana-workspace-1',
          name: 'Design',
          resource_type: 'workspace',
          is_organization: true
        }
      ],
      next_page: { offset: 'asana-next' }
    },
    first: { id: 'asana-workspace-1', name: 'Design' },
    cursor: 'asana-next',
    truncated: true
  },
  {
    pluginId: 'open-pencil.zotero',
    expectedUrl:
      'https://api.zotero.org/users/123456/items/top?limit=25&start=0&sort=dateModified&direction=desc',
    upstream: [
      {
        key: 'ZOTERO1',
        data: {
          itemType: 'journalArticle',
          title: 'Design systems',
          date: '2026',
          dateModified: '2026-08-10T00:00:00Z'
        },
        links: { alternate: { href: 'https://www.zotero.org/users/123456/collections/ZOTERO1' } }
      }
    ],
    first: { id: 'ZOTERO1', name: 'Design systems' },
    truncated: false
  },
  {
    pluginId: 'open-pencil.heygen',
    expectedUrl: 'https://api.heygen.com/v3/avatars/looks?limit=50',
    upstream: {
      data: [
        {
          id: 'avatar-1',
          name: 'Taylor',
          gender: 'female',
          preview_image_url: 'https://resource.heygen.com/avatar-1.png'
        }
      ],
      has_more: false
    },
    first: { id: 'avatar-1', name: 'Taylor' },
    truncated: false
  },
  {
    pluginId: 'open-pencil.linear',
    expectedUrl: 'https://api.linear.app/graphql',
    upstream: {
      data: {
        issues: {
          nodes: [
            {
              id: 'linear-issue-1',
              identifier: 'PROD-1',
              title: 'Polish plugin UX',
              url: 'https://linear.app/acme/issue/PROD-1',
              updatedAt: '2026-08-10T00:00:00Z',
              state: { name: 'In Progress', type: 'started' }
            }
          ],
          pageInfo: { hasNextPage: true, endCursor: 'linear-next' }
        }
      }
    },
    first: { id: 'linear-issue-1', name: 'Polish plugin UX' },
    cursor: 'linear-next',
    truncated: true
  },
  {
    pluginId: 'open-pencil.openai-developers',
    expectedUrl: 'https://api.openai.com/v1/models',
    upstream: {
      object: 'list',
      data: [{ id: 'gpt-test', object: 'model', created: 1_786_320_000, owned_by: 'openai' }]
    },
    first: { id: 'gpt-test', name: 'gpt-test' },
    truncated: false
  },
  {
    pluginId: 'open-pencil.box',
    expectedUrl:
      'https://api.box.com/2.0/folders/0/items?usemarker=true&fields=id%2Ctype%2Cname%2Csize%2Cmodified_at%2Citem_status&limit=50',
    upstream: {
      entries: [{ id: 'box-file-1', type: 'file', name: 'Design.fig' }],
      next_marker: 'box-next'
    },
    first: { id: 'box-file-1', name: 'Design.fig' },
    cursor: 'box-next',
    truncated: true
  },
  {
    pluginId: 'open-pencil.slack',
    expectedUrl:
      'https://slack.com/api/conversations.list?types=public_channel&exclude_archived=true&limit=50',
    upstream: {
      ok: true,
      channels: [{ id: 'C123', name: 'design', topic: { value: 'Design discussion' } }],
      response_metadata: { next_cursor: 'slack-next' }
    },
    first: { id: 'C123', name: 'design' },
    cursor: 'slack-next',
    truncated: true
  },
  {
    pluginId: 'open-pencil.google-calendar',
    expectedUrl:
      'https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=25&timeMin=2026-08-10T00%3A00%3A00Z&timeMax=2026-08-17T00%3A00%3A00Z&singleEvents=true&orderBy=startTime&showDeleted=false',
    upstream: {
      items: [
        {
          id: 'google-event-1',
          summary: 'Design review',
          status: 'confirmed',
          htmlLink: 'https://calendar.google.com/event?eid=test',
          start: { dateTime: '2026-08-10T10:00:00Z' }
        }
      ],
      nextPageToken: 'google-next'
    },
    first: { id: 'google-event-1', name: 'Design review' },
    cursor: 'google-next',
    truncated: true
  },
  {
    pluginId: 'open-pencil.sharepoint',
    expectedUrl: 'https://graph.microsoft.com/v1.0/sites/root',
    upstream: {
      id: 'sharepoint-site-1',
      displayName: 'Contoso',
      name: 'contoso',
      webUrl: 'https://contoso.sharepoint.com',
      lastModifiedDateTime: '2026-08-10T00:00:00Z'
    },
    first: { id: 'sharepoint-site-1', name: 'Contoso' },
    truncated: false
  },
  {
    pluginId: 'open-pencil.outlook-email',
    expectedUrl: 'https://graph.microsoft.com/v1.0/me/mailFolders',
    upstream: {
      value: [{ id: 'mail-folder-1', displayName: 'Inbox', unreadItemCount: 2, totalItemCount: 10 }]
    },
    first: { id: 'mail-folder-1', name: 'Inbox' },
    truncated: false
  },
  {
    pluginId: 'open-pencil.outlook-calendar',
    expectedUrl:
      'https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=2026-08-10T00%3A00%3A00Z&endDateTime=2026-08-17T00%3A00%3A00Z&%24select=id%2Csubject%2Cstart%2Cend%2Clocation%2Corganizer%2CisCancelled%2CwebLink%2Ctype&%24top=25',
    upstream: {
      value: [
        {
          id: 'outlook-event-1',
          subject: 'Design review',
          type: 'singleInstance',
          start: { dateTime: '2026-08-10T10:00:00Z' }
        }
      ]
    },
    first: { id: 'outlook-event-1', name: 'Design review' },
    truncated: false
  },
  {
    pluginId: 'open-pencil.teams',
    expectedUrl: 'https://graph.microsoft.com/v1.0/me/joinedTeams',
    upstream: {
      value: [{ id: 'team-1', displayName: 'Product', description: 'Product team' }]
    },
    first: { id: 'team-1', name: 'Product' },
    truncated: false
  }
]

describe('reviewed external service connector catalog', () => {
  test('keeps one opt-in, host-reviewed, MCP-read-only connector per plugin', () => {
    expect(REVIEWED_EXTERNAL_SERVICE_CATALOG).toHaveLength(17)
    expect(REVIEWED_EXTERNAL_SERVICE_CONNECTORS).toHaveLength(17)
    const identities = new Set<string>()

    for (const service of REVIEWED_EXTERNAL_SERVICE_CATALOG) {
      const { connector } = service
      const { contract } = connector
      expect(service.defaultInstalled).toBe(false)
      expect(parsePluginConnectorContract(contract)).toEqual(contract)
      expect(contract.operations).toHaveLength(1)
      expect(contract.operations[0]?.kind).toBe('query')
      expect(contract.network).toMatchObject({
        origins: [expect.stringMatching(/^https:\/\/[^/]+$/)],
        credentials: 'omit',
        redirects: 'error'
      })
      expect(connector.metadata.operations[0]?.example).not.toBeNull()
      expect(connector.metadata.mcpReadOnlyOperationIds).toEqual([
        contract.operations[0]?.operationId
      ])
      expect(connector.adapter.mcpReadOnlyOperationIds).toEqual(
        contract.operations[0]?.request?.method === 'POST'
          ? connector.metadata.mcpReadOnlyOperationIds
          : []
      )
      expect(contract.credentialSlots).toHaveLength(1)
      const credentialSlot = contract.credentialSlots[0]
      if (!credentialSlot) throw new Error(`Missing reviewed credential slot: ${service.key}`)
      expect(credentialSlot.label).toBe(service.manualSetup.credentialLabel)
      expect(credentialSlot.label).toContain('(manual)')
      expect(connector.credentialRefs('team-a')).toEqual({
        [credentialSlot.slotId]: {
          integrationId: contract.pluginId,
          profileId: 'team-a',
          field: credentialSlot.slotId
        }
      })
      identities.add(`${contract.pluginId}:${contract.connectorId}:${contract.adapterId}`)
    }

    expect(identities.size).toBe(REVIEWED_EXTERNAL_SERVICE_CATALOG.length)
  })

  test('prepares only the reviewed origins, paths, parameters, and fixed Linear GraphQL query', async () => {
    for (const fixture of FIXTURES) {
      const service = descriptor(fixture.pluginId)
      const operation = onlyOperation(service)
      const prepared = await service.connector.adapter.prepare({
        contract: service.connector.contract,
        operation,
        parameters: operationExample(service),
        signal: SIGNAL
      })
      expect(prepared.url).toBe(fixture.expectedUrl)
      expect(prepared.url).toStartWith(onlyOrigin(service))
      expect(prepared.url).not.toContain('runtime-secret')
      if (fixture.pluginId === 'open-pencil.linear') {
        const body = JSON.parse(String(prepared.body))
        expect(body.variables).toEqual({ first: 25 })
        expect(body.query).toContain('query OpenPencilIssues')
        expect(body.query).toContain('issues(first: $first, after: $after)')
      } else {
        expect(prepared.body).toBeUndefined()
      }
    }
  })

  test('projects every upstream shape into the same bounded result schema', async () => {
    for (const fixture of FIXTURES) {
      const service = descriptor(fixture.pluginId)
      const operation = onlyOperation(service)
      const transformResponse = service.connector.adapter.transformResponse
      if (!transformResponse) throw new Error(`Missing reviewed response transform: ${service.key}`)
      const transformed = (await transformResponse(fixture.upstream, {
        contract: service.connector.contract,
        operation,
        parameters: operationExample(service),
        signal: SIGNAL
      })) as Readonly<{
        items: readonly Readonly<{ id: string; name: string }>[]
        truncated: boolean
        nextCursor?: string
      }>
      expect(transformed.items[0]).toMatchObject(fixture.first)
      expect(transformed.items.length).toBeLessThanOrEqual(50)
      expect(transformed.truncated).toBe(fixture.truncated ?? false)
      expect(transformed.nextCursor).toBe(fixture.cursor)
    }
  })

  test('caps normalized lists and records deferred integrations without guessing authority', async () => {
    const service = OPENAI_MODELS_SERVICE.connector
    const operation = service.contract.operations[0]
    const transformResponse = service.adapter.transformResponse
    if (!operation || !transformResponse) throw new Error('OpenAI reviewed connector is incomplete')
    const transformed = (await transformResponse(
      {
        data: Array.from({ length: 130 }, (_, index) => ({
          id: `model-${index}`,
          object: 'model',
          owned_by: 'test'
        }))
      },
      {
        contract: service.contract,
        operation,
        parameters: {},
        signal: SIGNAL
      }
    )) as Readonly<{ items: readonly unknown[]; truncated: boolean }>
    expect(transformed.items).toHaveLength(50)
    expect(transformed.truncated).toBe(true)

    const linear = descriptor('open-pencil.linear')
    const linearTransform = linear.connector.adapter.transformResponse
    if (!linearTransform) throw new Error('Linear reviewed connector is incomplete')
    await expect(
      linearTransform(
        {
          errors: [{ message: 'Not authorized' }],
          data: { issues: { nodes: [], pageInfo: { hasNextPage: false } } }
        },
        {
          contract: linear.connector.contract,
          operation: onlyOperation(linear),
          parameters: operationExample(linear),
          signal: SIGNAL
        }
      )
    ).rejects.toMatchObject({ code: 'adapter-failed' })

    expect(DEFERRED_REVIEWED_SERVICES.map((entry) => entry.plugin)).toEqual([
      'Gmail',
      'Monday.com',
      'Semrush',
      'Replit'
    ])
    for (const entry of DEFERRED_REVIEWED_SERVICES) {
      expect(entry.reason.length).toBeGreaterThan(20)
      expect(entry.nextManualGate.length).toBeGreaterThan(20)
    }
  })

  test('rejects unsafe calendar windows and Slack HTTP-200 API errors', async () => {
    const google = descriptor('open-pencil.google-calendar')
    await expect(
      google.connector.adapter.prepare({
        contract: google.connector.contract,
        operation: onlyOperation(google),
        parameters: {
          ...operationExample(google),
          timeMin: '2026-08-10T00:00:00Z',
          timeMax: '2026-08-09T00:00:00Z'
        },
        signal: SIGNAL
      })
    ).rejects.toMatchObject({ code: 'invalid-parameters' })

    const outlook = descriptor('open-pencil.outlook-calendar')
    await expect(
      outlook.connector.adapter.prepare({
        contract: outlook.connector.contract,
        operation: onlyOperation(outlook),
        parameters: {
          ...operationExample(outlook),
          startDateTime: '2026-01-01T00:00:00Z',
          endDateTime: '2026-05-01T00:00:00Z'
        },
        signal: SIGNAL
      })
    ).rejects.toMatchObject({ code: 'invalid-parameters' })

    const slack = descriptor('open-pencil.slack')
    await expect(
      slack.connector.adapter.transformResponse?.(
        { ok: false, error: 'invalid_auth' },
        {
          contract: slack.connector.contract,
          operation: onlyOperation(slack),
          parameters: operationExample(slack),
          signal: SIGNAL
        }
      )
    ).rejects.toMatchObject({ code: 'adapter-failed' })
  })
})
