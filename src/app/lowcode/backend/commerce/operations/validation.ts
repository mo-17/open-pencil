import { validateBackendTemplatePages } from '@/app/lowcode/backend/template-validation'

import type { OperationsContext } from './context'

export function validateOperationsPages(ctx: OperationsContext): void {
  validateBackendTemplatePages({ ...ctx, pageIds: ctx.layout.pageIds })
}
