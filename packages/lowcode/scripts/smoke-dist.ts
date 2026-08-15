import { auditApplicationRuntime as auditFromSubpath } from '../dist/application-runtime.js'
import { auditApplicationRuntime, parseExpression } from '../dist/index.js'

if (auditApplicationRuntime !== auditFromSubpath) {
  throw new Error('Application runtime subpath does not match the package root export')
}

const parsed = parseExpression('count + 1')
if (!parsed.ok || !parsed.references.has('count')) {
  throw new Error('Lowcode expression parser smoke failed')
}

process.stdout.write('@open-pencil/lowcode dist smoke passed\n')
