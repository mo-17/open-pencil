import { JSX_REFERENCE } from '@open-pencil/core/design-jsx'

import behavior from './system-prompt.md?raw'

/** Chat and ACP share scene-authoring knowledge without copying the renderer reference. */
const SYSTEM_PROMPT = [behavior.trim(), JSX_REFERENCE].join('\n\n')

export default SYSTEM_PROMPT
