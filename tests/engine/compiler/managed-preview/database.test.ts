import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MANAGED_DATABASE_SOURCE } from '#compiler/backend/nestjs/local-run/managed/database'

const HARNESS = String.raw`
import { initializeManagedReceipt, applyManagedMigration, inspectManagedDatabase } from './managed/database.mjs'
import { createHash } from 'node:crypto'
const hash = (sql) => createHash('sha256').update(sql).digest('base64url')
const schema = [{name:'notes',columns:[{name:'id',type:'uuid',nullable:false}],indexes:['notes_pkey','notes_owner_page_idx'],constraints:['notes_pkey']}]
const from=hash('from'),to=hash('to'),planId=hash('plan'),sql='SET LOCAL standard_conforming_strings=on;'
let receipt, stray=false, superuser=false, extraGrant=false, publicCreate=false, authorityChanged=false, executions=0
const statements=[]
const client = {
 async connect(){}, async end(){},
 async query(query,params){
  statements.push(query)
  if(query.startsWith('SELECT to_regclass')) return {rows:[{name:null}]}
  if(query.startsWith('INSERT INTO openpencil_local.managed_state')) {receipt={application_digest:params[0],schema_digest:params[1],plan_digest:params[2]};return {rows:[]}}
  if(query.startsWith('SELECT application_digest')) return {rows:[receipt]}
  if(query.startsWith('SELECT c.relname AS name')) return {rows:[...schema.flatMap(t=>[{name:t.name,kind:'r',rls:false,force_rls:false,owner:'openpencil_admin',acl:null},...t.indexes.map(name=>({name,kind:'i',rls:false,force_rls:false,owner:'openpencil_admin',acl:null}))]),...(stray?[{name:'stray',kind:'r',rls:false,force_rls:false,owner:'openpencil_admin',acl:null}]:[])]}
  if(query.startsWith('SELECT table_name,column_name')) return {rows:[{table_name:'notes',column_name:'id',udt_name:'uuid',is_nullable:'NO'}]}
  if(query.startsWith('SELECT c.relname AS table_name,k.conname')) return {rows:[{table_name:'notes',conname:'notes_pkey',contype:'p'}]}
  if(query.startsWith('SELECT tablename,indexname')) return {rows:schema[0].indexes.map(indexname=>({tablename:'notes',indexname}))}
  if(query.startsWith('SELECT rolsuper')) return {rows:[{rolsuper:superuser,rolinherit:false,rolcreaterole:false,rolcreatedb:false,rolcanlogin:true,rolreplication:false,rolbypassrls:false}]}
  if(query.startsWith('SELECT has_database_privilege')) return {rows:[{connect:true,database_create:false,public_usage:true,public_create:publicCreate,receipt_usage:false,receipt_create:false}]}
  if(query.startsWith('SELECT nspname'))return{rows:[{acl:authorityChanged?'changed':'initial'}]}
  if(query.startsWith('SELECT table_name,grantee')) return {rows:[...['DELETE','INSERT','SELECT','UPDATE',...(extraGrant?['TRUNCATE']:[])].map(privilege_type=>({table_name:'notes',grantee:'openpencil_runtime',privilege_type,is_grantable:'NO'}))]}
  if(query===sql) {executions++;if(process.argv[2]==='concurrent')stray=true;if(process.argv[2]==='schema-grant')publicCreate=true;if(process.argv[2]==='authority')authorityChanged=true}
  if(query.startsWith('UPDATE openpencil_local.managed_state')) receipt={application_digest:params[0],schema_digest:params[1],plan_digest:params[2]}
  return {rows:[]}
 }
}
globalThis.testClient=client
await initializeManagedReceipt(client,from,true,hash('initial'),schema)
statements.length=0
if(process.argv[2]==='superuser')superuser=true
if(process.argv[2]==='grant')extraGrant=true
const plan={planId,fromApplicationDigest:from,toApplicationDigest:to,sql,sqlDigest:hash(sql),initialDigest:'initial',fromSchema:schema,toSchema:schema}
let error=''
try{
 await applyManagedMigration({}, {}, plan)
 if(process.argv[2]==='recovery')await applyManagedMigration({}, {}, plan)
 if(process.argv[2]==='normal')await inspectManagedDatabase({}, {}, schema)
}catch(e){error=e.message}
process.stdout.write(JSON.stringify({error,statements,executions,receipt}))
`

function run(scenario: string) {
  const root = mkdtempSync(join(tmpdir(), 'managed-catalog-'))
  try {
    mkdirSync(join(root, 'managed'))
    writeFileSync(join(root, 'managed/database.mjs'), MANAGED_DATABASE_SOURCE)
    writeFileSync(
      join(root, 'local-config.mjs'),
      'export const fail=(message)=>{throw new Error(message)}'
    )
    writeFileSync(
      join(root, 'local-database.mjs'),
      "export const databaseClient=async()=>globalThis.testClient; export const migration=()=>({digest:'initial'})"
    )
    writeFileSync(join(root, 'harness.mjs'), HARNESS)
    const result = spawnSync('node', ['harness.mjs', scenario], { cwd: root, encoding: 'utf8' })
    expect(result.status).toBe(0)
    return JSON.parse(result.stdout) as {
      error: string
      statements: string[]
      executions: number
      receipt: { application_digest: string }
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('generated managed database transaction', () => {
  test('grants only declared tables and verifies the committed receipt', () => {
    const result = run('normal')
    expect(result.error).toBe('')
    expect(result.statements).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."notes" TO openpencil_runtime'
    )
    expect(result.statements.some((sql) => sql.includes('ALL TABLES'))).toBe(false)
    expect(result.executions).toBe(1)
  })
  test('does not adopt concurrent extra tables into a new receipt', () => {
    const result = run('concurrent')
    expect(result.error).toContain('exact generated model')
    expect(result.statements.at(-1)).toBe('ROLLBACK')
    expect(
      result.statements.some((sql) => sql.startsWith('UPDATE openpencil_local.managed_state'))
    ).toBe(false)
    expect(result.statements.some((sql) => sql.startsWith('GRANT') && sql.includes('stray'))).toBe(
      false
    )
  })
  for (const scenario of ['superuser', 'grant'])
    test('blocks runtime privilege drift: ' + scenario, () => {
      const result = run(scenario)
      expect(result.error).not.toBe('')
      expect(result.executions).toBe(0)
      expect(result.statements.at(-1)).toBe('ROLLBACK')
    })
  for (const scenario of ['schema-grant', 'authority'])
    test('rejects concurrent database authority changes: ' + scenario, () => {
      const result = run(scenario)
      expect(result.error).not.toBe('')
      expect(result.statements.at(-1)).toBe('ROLLBACK')
      expect(
        result.statements.some((sql) => sql.startsWith('UPDATE openpencil_local.managed_state'))
      ).toBe(false)
    })
  test('recovers a committed matching plan without replaying SQL', () => {
    const result = run('recovery')
    expect(result.error).toBe('')
    expect(result.executions).toBe(1)
  })
})
