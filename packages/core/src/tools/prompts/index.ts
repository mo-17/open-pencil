import { JSX_REFERENCE } from '@open-pencil/design-jsx'

import codegen from './codegen.md?raw'

/** Keep frontend-code generation instructions distinct from scene-authoring syntax. */
export const CODEGEN_PROMPT = [codegen.trim(), JSX_REFERENCE].join('\n\n')
