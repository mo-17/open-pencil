import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { emitNestJSListQuery } from '#compiler/backend/nestjs/query'
import { emitNestJSRequestValidation } from '#compiler/backend/nestjs/request-validation'

export const QUERY_SPEC = {
  filterFields: [
    { id: 'price', column: '"price_cents"', type: 'integer', nullable: false },
    { id: 'title', column: '"title"', type: 'string', nullable: true }
  ],
  searchFields: [{ id: 'title', column: '"title"', type: 'string', nullable: true }],
  sortFields: [
    { id: 'price', column: '"price_cents"', type: 'integer', nullable: false },
    { id: 'created', column: '"created_at"', type: 'datetime', nullable: false }
  ]
}
export async function queryRuntime() {
  const directory = await mkdtemp(join(tmpdir(), 'openpencil-list-query-'))
  const artifacts = [emitNestJSListQuery(), emitNestJSRequestValidation()]
  for (const artifact of artifacts) {
    // The exception class is the only dependency replaced; generated parsers/SQL remain unchanged.
    const source = String(artifact.content)
      .replace(
        "import { BadRequestException } from '@nestjs/common'",
        'class BadRequestException extends Error {}'
      )
      .replaceAll('./request-validation.js', './request-validation.ts')
      .replaceAll('./list-query.js', './list-query.ts')
    const filename = artifact.path.split('/').at(-1)
    if (!filename) throw new Error('Generated artifact requires a filename')
    await writeFile(join(directory, filename), source)
  }
  const runtime = await import(pathToFileURL(join(directory, 'list-query.ts')).href)
  return {
    runtime: runtime as {
      listQuery(query: object, maximum: number, spec?: typeof QUERY_SPEC): object
      listStatement(
        statement: { projection: string; table: string; key: string; where: string },
        query: object,
        values: unknown[]
      ): string
      listPage(
        rows: Record<string, unknown>[],
        query: object
      ): { data: Record<string, unknown>[]; nextCursor: string | null }
    },
    dispose: () => rm(directory, { recursive: true, force: true })
  }
}
