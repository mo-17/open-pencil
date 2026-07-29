import type { ToolCtx } from '@open-pencil/core/tools'

export type AutomationRequestContext = Pick<ToolCtx, 'signal' | 'onProgress'>
