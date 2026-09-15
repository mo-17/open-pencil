import { JSX_REFERENCE } from '#core/design-jsx/reference'

import codegen from './codegen.md?raw'

/** Keep frontend-code generation instructions distinct from scene-authoring syntax. */
export const CODEGEN_PROMPT = [codegen.trim(), JSX_REFERENCE].join('\n\n')
