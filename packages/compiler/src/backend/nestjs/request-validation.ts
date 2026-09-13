import { nestJSArtifact } from './artifact'

export function emitNestJSRequestValidation() {
  return nestJSArtifact(
    'src/request-validation.ts',
    `import { BadRequestException } from '@nestjs/common'

export function bodyFields(value: unknown, allowed: readonly string[]): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new BadRequestException('Expected a JSON object')
  }
  const keys = Object.keys(value)
  if (keys.length === 0 || keys.some((key) => !allowed.includes(key))) {
    throw new BadRequestException('Body fields do not match the operation')
  }
}

export function noBody(value: unknown): void {
  if (value !== undefined) throw new BadRequestException('This operation does not accept a body')
}

export function noQuery(value: object): void {
  if (Object.keys(value).length > 0) throw new BadRequestException('Unexpected query parameters')
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

export function itemId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new BadRequestException('Expected a UUID')
  return value.toLowerCase()
}

export { listQuery, type ListQuery } from './list-query.js'

`
  )
}
