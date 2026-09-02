import {
  BACKEND_COMPILATION_MODES,
  createBuiltinBackendProviderRegistry,
  SUPABASE_BACKEND_PROVIDER_ADAPTER_ID
} from '../dist/backend/index.mjs'
import { BackendProviderCompilationError } from '../dist/index.mjs'

if (!Object.isFrozen(BACKEND_COMPILATION_MODES)) {
  throw new Error('Compiler Backend modes must be frozen in the built public subpath')
}
if (BACKEND_COMPILATION_MODES.join(',') !== 'preview,source-only-prototype,production') {
  throw new Error('Compiler Backend modes are incomplete in the built public subpath')
}

const descriptors = createBuiltinBackendProviderRegistry().list()
if (
  descriptors.length !== 1 ||
  descriptors[0]?.adapterId !== SUPABASE_BACKEND_PROVIDER_ADAPTER_ID
) {
  throw new Error('Built Compiler Backend registry does not expose the reviewed Supabase adapter')
}
if (new BackendProviderCompilationError([]).name !== 'BackendProviderCompilationError') {
  throw new Error('Built Compiler root does not expose the fail-closed Backend compile error')
}

process.stdout.write('@open-pencil/compiler Backend dist smoke passed\n')
