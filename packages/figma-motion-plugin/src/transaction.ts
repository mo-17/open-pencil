// Keep the development plugin on the exact same applicator used by generated scripts and
// package callers. This file is intentionally a thin identity-preserving re-export.
export {
  applyFigmaNativeMotionTransaction,
  createFigmaNativeMotionApplyRequest
} from '@open-pencil/fig'
export type {
  FigmaNativeMotionApplyRequest,
  FigmaNativeMotionTransactionHost,
  FigmaNativeMotionTransactionResult,
  FigmaNativeMotionTransactionTarget
} from '@open-pencil/fig'
