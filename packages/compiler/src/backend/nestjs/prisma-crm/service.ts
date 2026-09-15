import { nestJSArtifact } from '../artifact'
import { PRISMA_CRM_CUSTOMER_FIELDS } from './profile'

/** Emitted only after the exact CRM read policy and model profile are accepted. */
export function emitPrismaCRMService(index: number) {
  return nestJSArtifact(
    'src/resources/customers.service.ts',
    String.raw`import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { or } from '@prisma/orm-postgres/orm-client'
import { DatabaseService } from '../database.service.js'
import type { VerifiedPrincipal } from '../identity.js'
import { listPage } from '../list-query.js'
import type { ListQuery } from '../request-validation.js'
import { crmTimestamp } from '../prisma/timestamp.js'

// Exact existing public projection: owner_id and internal ledger fields stay private.
const FIELDS = ${JSON.stringify(PRISMA_CRM_CUSTOMER_FIELDS)} as const
const STAGES = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'] as const

function authenticated(principal: VerifiedPrincipal | null): VerifiedPrincipal {
  if (!principal) throw new UnauthorizedException('Authentication required.')
  return principal
}
function stage(value: unknown) {
  const result = STAGES.find((item) => item === value)
  if (!result) throw new BadRequestException('Invalid list query')
  return result
}

@Injectable()
export class Resource${index}Service {
  constructor(private readonly database: DatabaseService) {}

  async list(principal: VerifiedPrincipal | null, query: ListQuery) {
    const actor = authenticated(principal)
    return this.database.prismaQuery(async (db) => {
      let selection = db.orm.public.Customer.select(...FIELDS)
      if (!actor.roles.includes('crm-manager')) {
        selection = selection.where({ assignee_subject: actor.subject })
      }
      for (const { field, value } of query.filter) {
        if (field.id === 'stage') selection = selection.where({ stage: stage(value) })
        else if (field.id === 'closed' && typeof value === 'boolean') selection = selection.where({ closed: value })
        else if (field.id === 'assignee_id' && typeof value === 'string') selection = selection.where({ assignee_id: value })
        else throw new BadRequestException('Invalid list query')
      }
      if (query.search) {
        // Keep literal-substring search, including %, _ and backslash escaping.
        const pattern = '%' + query.search.value.replace(/[\\%_]/gu, (character) => '\\' + character) + '%'
        selection = selection.where((customer) => or(customer.title.ilike(pattern), customer.company.ilike(pattern)))
      }
      const after = query.after
      if (after) selection = selection.where((customer) => customer.id.gt(after))
      if (query.sort && query.sort.id !== 'created_at') throw new BadRequestException('Invalid list query')
      const ordered = query.sort
        ? selection.orderBy([
            (customer) => query.direction === 'desc' ? customer.created_at.desc() : customer.created_at.asc(),
            (customer) => query.direction === 'desc' ? customer.id.desc() : customer.id.asc()
          ])
        : selection.orderBy((customer) => customer.id.asc())
      const cursor = query.cursor
      if (cursor && typeof cursor.value !== 'string') throw new BadRequestException('Invalid list query')
      const rows = await (cursor && typeof cursor.value === 'string'
        ? ordered.cursor({ created_at: cursor.value, id: cursor.id })
        : ordered).limit(query.limit + 1).all()
      return listPage(rows.map((row) => ({ ...row, created_at: crmTimestamp(row.created_at),
        __openpencil_cursor: row.id, __openpencil_sort: crmTimestamp(row.created_at) })), query)
    })
  }

  async read(principal: VerifiedPrincipal | null, id: string) {
    const actor = authenticated(principal)
    const result = await this.database.prismaQuery(async (db) => {
      let selection = db.orm.public.Customer.select(...FIELDS).where({ id })
      if (!actor.roles.includes('crm-manager')) selection = selection.where({ assignee_subject: actor.subject })
      return selection.first()
    })
    if (!result) throw new NotFoundException('Record not found')
    return { ...result, created_at: crmTimestamp(result.created_at) }
  }
}
`
  )
}
