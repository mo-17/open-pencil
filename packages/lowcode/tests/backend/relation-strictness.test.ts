import { describe, expect, test } from 'bun:test'

import { validateDataModelIR, type DataModelIR } from '@open-pencil/lowcode/backend'

function relationModel(): DataModelIR {
  return {
    version: 1,
    entities: [
      {
        id: 'authors',
        name: 'authors',
        management: 'managed',
        fields: [{ id: 'id', name: 'id', type: 'uuid', nullable: false }],
        primaryKey: { fields: ['id'] }
      },
      {
        id: 'books',
        name: 'books',
        management: 'managed',
        fields: [
          { id: 'id', name: 'id', type: 'uuid', nullable: false },
          { id: 'author_id', name: 'author_id', type: 'uuid', nullable: false }
        ],
        primaryKey: { fields: ['id'] },
        foreignKeys: [
          {
            id: 'books_author_fk',
            fields: ['author_id'],
            targetEntityId: 'authors',
            targetFields: ['id'],
            onDelete: 'restrict'
          }
        ]
      }
    ],
    enums: [],
    relations: [
      {
        id: 'authors_books',
        kind: 'one-to-many',
        sourceEntityId: 'authors',
        targetEntityId: 'books',
        targetForeignKeyId: 'books_author_fk'
      }
    ]
  }
}

function diagnosticCodes(model: DataModelIR): string[] {
  const result = validateDataModelIR(model)
  expect(result.ok).toBe(false)
  return result.ok ? [] : result.diagnostics.map((entry) => entry.code)
}

function entityAt(model: DataModelIR, index: number): DataModelIR['entities'][number] {
  const entity = model.entities[index]
  if (!entity) {
    throw new Error(`Expected entity at index ${index}`)
  }
  return entity
}

function foreignKeyAt(
  model: DataModelIR,
  entityIndex: number,
  foreignKeyIndex = 0
): NonNullable<DataModelIR['entities'][number]['foreignKeys']>[number] {
  const foreignKey = entityAt(model, entityIndex).foreignKeys?.[foreignKeyIndex]
  if (!foreignKey) {
    throw new Error(
      `Expected foreign key at entity index ${entityIndex}, foreign-key index ${foreignKeyIndex}`
    )
  }
  return foreignKey
}

describe('Backend Core relation invariants', () => {
  test('requires a direct relation foreign key that targets the opposite endpoint', () => {
    expect(validateDataModelIR(relationModel()).ok).toBe(true)

    const missing = relationModel()
    delete missing.relations[0].targetForeignKeyId
    expect(diagnosticCodes(missing)).toContain('backend-relation-foreign-key-required')

    const wrongTarget = relationModel()
    wrongTarget.entities.push({
      id: 'publishers',
      name: 'publishers',
      management: 'managed',
      fields: [{ id: 'id', name: 'id', type: 'uuid', nullable: false }],
      primaryKey: { fields: ['id'] }
    })
    foreignKeyAt(wrongTarget, 1).targetEntityId = 'publishers'
    expect(diagnosticCodes(wrongTarget)).toContain('backend-relation-foreign-key-target-mismatch')
  })

  test('requires foreign-key targets to match an exact primary or unique field set', () => {
    const nonUnique = relationModel()
    nonUnique.entities[0].fields.push({
      id: 'code',
      name: 'code',
      type: 'string',
      nullable: false
    })
    nonUnique.entities[1].fields.push({
      id: 'author_code',
      name: 'author_code',
      type: 'string',
      nullable: false
    })
    const nonUniqueForeignKey = foreignKeyAt(nonUnique, 1)
    nonUniqueForeignKey.fields = ['author_code']
    nonUniqueForeignKey.targetFields = ['code']
    expect(diagnosticCodes(nonUnique)).toContain('backend-foreign-target-not-unique')

    nonUnique.entities[0].uniques = [{ id: 'authors_code_unique', fields: ['code'] }]
    expect(validateDataModelIR(nonUnique).ok).toBe(true)

    const composite = structuredClone(nonUnique)
    composite.entities[0].fields.push({
      id: 'region',
      name: 'region',
      type: 'string',
      nullable: false
    })
    composite.entities[1].fields.push({
      id: 'author_region',
      name: 'author_region',
      type: 'string',
      nullable: false
    })
    composite.entities[0].uniques = [
      { id: 'authors_code_region_unique', fields: ['code', 'region'] }
    ]
    const compositeForeignKey = foreignKeyAt(composite, 1)
    compositeForeignKey.fields = ['author_region', 'author_code']
    compositeForeignKey.targetFields = ['region', 'code']
    expect(validateDataModelIR(composite).ok).toBe(true)

    compositeForeignKey.fields = ['author_code']
    compositeForeignKey.targetFields = ['code']
    expect(diagnosticCodes(composite)).toContain('backend-foreign-target-not-unique')
  })

  test('requires unique foreign-key fields for a one-to-one relation', () => {
    const model = relationModel()
    model.relations[0].kind = 'one-to-one'
    expect(diagnosticCodes(model)).toContain('backend-relation-one-to-one-not-unique')

    model.entities[1].uniques = [{ id: 'books_author_unique', fields: ['author_id'] }]
    expect(validateDataModelIR(model).ok).toBe(true)
  })

  test('requires one unambiguous junction foreign key to each many-to-many endpoint', () => {
    const model = relationModel()
    model.entities.push({
      id: 'author_books',
      name: 'author_books',
      management: 'managed',
      fields: [
        { id: 'author_id', name: 'author_id', type: 'uuid', nullable: false },
        { id: 'book_id', name: 'book_id', type: 'uuid', nullable: false }
      ],
      foreignKeys: [
        {
          id: 'junction_author_fk',
          fields: ['author_id'],
          targetEntityId: 'authors',
          targetFields: ['id'],
          onDelete: 'cascade'
        },
        {
          id: 'junction_book_fk',
          fields: ['book_id'],
          targetEntityId: 'books',
          targetFields: ['id'],
          onDelete: 'cascade'
        }
      ]
    })
    model.relations = [
      {
        id: 'authors_books_many',
        kind: 'many-to-many',
        sourceEntityId: 'authors',
        targetEntityId: 'books',
        junctionEntityId: 'author_books'
      }
    ]
    expect(validateDataModelIR(model).ok).toBe(true)

    const junctionForeignKeys = entityAt(model, 2).foreignKeys
    if (!junctionForeignKeys) {
      throw new Error('Expected junction entity foreign keys')
    }
    junctionForeignKeys.push({
      id: 'junction_author_duplicate_fk',
      fields: ['author_id'],
      targetEntityId: 'authors',
      targetFields: ['id'],
      onDelete: 'restrict'
    })
    expect(diagnosticCodes(model)).toContain('backend-relation-junction-foreign-key-cardinality')

    const absent = relationModel()
    absent.relations = [
      {
        id: 'authors_books_many',
        kind: 'many-to-many',
        sourceEntityId: 'authors',
        targetEntityId: 'books',
        junctionEntityId: 'authors'
      }
    ]
    expect(diagnosticCodes(absent)).toContain('backend-relation-junction-ambiguous')
  })
})
