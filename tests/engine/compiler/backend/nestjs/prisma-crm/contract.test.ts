import { expect, test } from 'bun:test'

import { emitPrismaCRMContract } from '#compiler/backend/nestjs/prisma-crm/contract'
import { emitNestJSSchema } from '#compiler/backend/nestjs/schema'
import { nestJSConstraintName } from '#compiler/backend/nestjs/schema-names'

import { prismaCRMApplication } from './helpers'

test('maps the current SQL-owned CRM fields, native enum, relations and command ledger', () => {
  const application = prismaCRMApplication()
  const artifact = emitPrismaCRMContract(application)
  expect(artifact.path).toBe('backend/nestjs/src/prisma/contract.prisma')
  expect(artifact.content).toContain('// use prisma-8')
  expect(artifact.content).toContain('native_enum customer_stage')
  expect(artifact.content).toContain('created_at TimestamptzString @default(now())')
  expect(artifact.content).toContain(
    'id Uuid @id @default(dbgenerated("pg_catalog.gen_random_uuid()"))'
  )
  expect(artifact.content).toContain('stage pg.enum(customer_stage) @default("new")')
  expect(artifact.content).toContain('history CustomerHistory[]')
  expect(artifact.content).toContain(
    'customer Customer @relation(fields: [customer_id, owner_id], references: [id, owner_id], onDelete: Restrict'
  )
  expect(artifact.content).toContain('response_json String?')
  expect(artifact.content).toContain('@@id([application_id, command_id, subject, request_key])')
  expect(artifact.content).toContain('@@map("openpencil_command_requests")')
  expect(artifact.content).not.toContain('@@index(')
  expect(artifact.content).toContain('Do not apply Prisma DDL')
  for (const entity of application.dataModel.entities) {
    expect(artifact.content).toContain('@@map(' + JSON.stringify(entity.name) + ')')
    for (const unique of entity.uniques ?? [])
      expect(artifact.content).toContain(nestJSConstraintName(entity, 'uq', unique.id))
    for (const foreignKey of entity.foreignKeys ?? [])
      expect(artifact.content).toContain(nestJSConstraintName(entity, 'fk', foreignKey.id))
  }
})

test('constraint mappings follow the IR and SQL emitter instead of hardcoded prototype hashes', () => {
  const application = prismaCRMApplication()
  for (const entity of application.dataModel.entities) {
    for (const unique of entity.uniques ?? []) unique.id = 'custom-' + unique.id
    for (const foreignKey of entity.foreignKeys ?? []) foreignKey.id = 'custom-' + foreignKey.id
  }
  const psl = emitPrismaCRMContract(application).content
  const sql = emitNestJSSchema(application)[0].content
  for (const entity of application.dataModel.entities) {
    for (const unique of entity.uniques ?? []) {
      const name = nestJSConstraintName(entity, 'uq', unique.id)
      expect(psl).toContain(name)
      expect(sql).toContain(name)
    }
    for (const foreignKey of entity.foreignKeys ?? []) {
      const name = nestJSConstraintName(entity, 'fk', foreignKey.id)
      expect(psl).toContain(name)
      expect(sql).toContain(name)
    }
  }
})

test('preserves deterministic output across entity/field order and leaves indexes with SQL', () => {
  const application = prismaCRMApplication()
  const initial = emitPrismaCRMContract(application)
  application.dataModel.entities.reverse()
  for (const entity of application.dataModel.entities) {
    entity.fields.reverse()
    entity.uniques?.reverse()
    entity.indexes?.push({ id: 'additional-title-index', fields: ['id'], order: 'asc' })
  }
  expect(emitPrismaCRMContract(application)).toEqual(initial)
  expect(emitNestJSSchema(application)[0].content).toContain('CREATE INDEX')
})

test('omits the command ledger when SQL emits none and refuses incompatible contracts', () => {
  const application = prismaCRMApplication()
  delete application.commands
  expect(emitPrismaCRMContract(application).content).not.toContain('model CommandRequest')
  expect(emitNestJSSchema(application)[0].content).not.toContain('openpencil_command_requests')
  application.dataModel.entities[0].name = 'incompatible'
  expect(() => emitPrismaCRMContract(application)).toThrow('unsupported Prisma CRM query contract')
})
