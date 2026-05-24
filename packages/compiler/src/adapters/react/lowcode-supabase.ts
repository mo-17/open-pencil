/**
 * Phase 3 §2: scaffold for `src/_lowcode_supabase.ts`, the lowcode runtime
 * that wraps `@supabase/supabase-js`. Step 2 reserves the module + pins the
 * supabase-js version so the preview-resolvable test can prove the dev-server
 * can resolve the bare `@supabase/supabase-js` import from the monorepo's
 * hoisted `node_modules`. Step 3 fills in `buildLowcodeSupabaseRuntime`.
 */

/** supabase-js pin for emitted projects. Same `^2.x` shape the package.json
 *  devDependency uses so the preview-resolvable copy and the exported-project
 *  copy never diverge. */
export const SUPABASE_JS_VERSION = '^2.100.0'
