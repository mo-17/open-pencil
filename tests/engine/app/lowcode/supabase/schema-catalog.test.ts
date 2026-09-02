import { describe, expect, test } from 'bun:test'

import {
  parseSupabaseSchemaCatalog,
  SUPABASE_SCHEMA_CATALOG_LIMITS,
  validateSupabaseSchemaCatalog
} from '@/app/lowcode/supabase/schema-catalog'

const identity = { projectRef: 'project-ref', schema: 'public' }

describe('Supabase schema catalog parser', () => {
  test('normalizes empty schema maps and schema-free OpenAPI documents', () => {
    const emptyDocuments = [
      { swagger: '2.0', definitions: {} },
      { openapi: '3.0.0', components: { schemas: {} } },
      { swagger: '2.0', paths: {} },
      {
        swagger: '2.0',
        info: { title: 'PostgREST API', version: '14.12' },
        paths: { '/': { get: { produces: ['application/openapi+json'] } } }
      },
      {
        openapi: '3.1.0',
        info: { title: 'PostgREST API', version: '14.12' },
        paths: { '/': {}, '/rpc/search': { post: {} } }
      }
    ]

    for (const document of emptyDocuments) {
      expect(parseSupabaseSchemaCatalog(document, identity)).toEqual({
        version: 1,
        ...identity,
        tables: []
      })
    }
  })

  test('normalizes PostgREST definitions, required columns, and FK markup', () => {
    const catalog = parseSupabaseSchemaCatalog(
      {
        swagger: '2.0',
        definitions: {
          users: {
            properties: { id: { type: 'string', format: 'uuid' } },
            required: ['id']
          },
          posts: {
            description: 'Published posts',
            required: ['id', 'author_id'],
            properties: {
              title: { type: ['string', 'null'] },
              id: { type: 'integer', format: 'int8' },
              author_id: {
                type: 'string',
                format: 'uuid',
                description: "Author link\n<fk table='users' column='id'/>"
              }
            }
          }
        }
      },
      identity
    )

    expect(catalog).toMatchObject({ version: 1, ...identity })
    expect(catalog.tables.map((table) => table.name)).toEqual(['posts', 'users'])
    expect(catalog.tables[0]).toEqual({
      name: 'posts',
      description: 'Published posts',
      required: ['author_id', 'id'],
      columns: [
        {
          name: 'author_id',
          type: 'string',
          required: true,
          nullable: false,
          format: 'uuid',
          description: 'Author link'
        },
        { name: 'id', type: 'integer', required: true, nullable: false, format: 'int8' },
        { name: 'title', type: 'string', required: false, nullable: true }
      ],
      relations: [{ sourceColumn: 'author_id', targetTable: 'users', targetColumn: 'id' }]
    })
  })

  test('accepts OpenAPI 3 components and defensive relationship extensions', () => {
    const catalog = parseSupabaseSchemaCatalog(
      {
        openapi: '3.0.0',
        components: {
          schemas: {
            comments: {
              type: 'object',
              properties: {
                id: { type: 'integer' },
                post_id: { type: 'integer' },
                author: { $ref: '#/components/schemas/users' }
              },
              'x-relationships': [
                {
                  columns: ['post_id'],
                  referencedRelation: 'posts',
                  referencedColumns: ['id']
                }
              ]
            }
          }
        }
      },
      identity
    )

    expect(catalog.tables[0]?.relations).toEqual([
      { sourceColumn: 'author', targetTable: 'users' },
      { sourceColumn: 'post_id', targetTable: 'posts', targetColumn: 'id' }
    ])
  })

  test('rejects unbounded tables and invalid cached identities', () => {
    const definitions = Object.fromEntries(
      Array.from({ length: SUPABASE_SCHEMA_CATALOG_LIMITS.maxTables + 1 }, (_, index) => [
        `table_${index}`,
        { properties: {} }
      ])
    )
    expect(() => parseSupabaseSchemaCatalog({ definitions }, identity)).toThrow('table limit')

    const catalog = parseSupabaseSchemaCatalog(
      { definitions: { todos: { properties: { id: { type: 'integer' } } } } },
      identity
    )
    expect(validateSupabaseSchemaCatalog(catalog, identity)).toEqual(catalog)
    expect(
      validateSupabaseSchemaCatalog(catalog, { projectRef: 'another-project', schema: 'public' })
    ).toBeNull()
  })

  test('rejects malformed documents instead of treating them as an empty schema', () => {
    expect(() => parseSupabaseSchemaCatalog({}, identity)).toThrow('does not contain definitions')
    expect(() => parseSupabaseSchemaCatalog({ message: 'ok' }, identity)).toThrow(
      'does not contain definitions'
    )
    expect(() =>
      parseSupabaseSchemaCatalog(
        {
          swagger: '2.0',
          info: { title: 'PostgREST API', version: '14.12' },
          paths: { '/todos': { get: {} } }
        },
        identity
      )
    ).toThrow('does not contain definitions')
    expect(() =>
      parseSupabaseSchemaCatalog(
        {
          swagger: '2.0',
          info: { title: 'PostgREST API', version: '14.12' },
          paths: { '/': {} },
          definitions: null
        },
        identity
      )
    ).toThrow('invalid definitions')
    expect(() =>
      parseSupabaseSchemaCatalog(
        {
          swagger: '2.0',
          definitions: {},
          paths: { '/todos': { get: {} } }
        },
        identity
      )
    ).toThrow('table paths without definitions')
    expect(() =>
      parseSupabaseSchemaCatalog(
        { openapi: '3.0.0', paths: {}, components: { schemas: null } },
        identity
      )
    ).toThrow('invalid components.schemas')
    expect(() =>
      parseSupabaseSchemaCatalog(
        {
          openapi: '3.0.0',
          components: { schemas: {} },
          paths: { '/todos': { get: {} } }
        },
        identity
      )
    ).toThrow('table paths without components.schemas')
  })
})
