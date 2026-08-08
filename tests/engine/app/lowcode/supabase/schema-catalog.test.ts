import { describe, expect, test } from 'bun:test'

import {
  parseSupabaseSchemaCatalog,
  SUPABASE_SCHEMA_CATALOG_LIMITS,
  validateSupabaseSchemaCatalog
} from '@/app/lowcode/supabase/schema-catalog'

const identity = { projectRef: 'project-ref', schema: 'public' }

describe('Supabase schema catalog parser', () => {
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
})
