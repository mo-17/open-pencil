export const LOWCODE_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

export const ECMASCRIPT_RESERVED_IDENTIFIERS = [
  'arguments',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'eval',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield'
] as const

/** Fixed identifiers emitted by the React and Expo low-code runtimes.
 *
 * State names become function-scoped bindings, so allowing one of these names
 * can shadow an imported component/hook or collide with generated glue. Keep
 * this list target-neutral: a document that validates in the editor must stay
 * safe when it is compiled by either built-in adapter. */
export const LOWCODE_GENERATED_RUNTIME_IDENTIFIERS = [
  'Infinity',
  'Image',
  'ImageBackground',
  'KeyboardAvoidingView',
  'Linking',
  'NaN',
  'Navigate',
  'Platform',
  'Pressable',
  'SafeAreaView',
  'ScrollView',
  'StyleSheet',
  'Switch',
  'Text',
  'TextInput',
  'View',
  'generatePath',
  'getDocStateSnapshot',
  'getSupabaseClient',
  'intl',
  'invokeServerWorkflow',
  'navigate',
  'router',
  'setDocState',
  'styles',
  'supabase',
  'undefined',
  'useDocState',
  'useEffect',
  'useIntl',
  'useLocalSearchParams',
  'useMemo',
  'useNavigate',
  'useParams',
  'useRef',
  'useRouter',
  'useSearchParams',
  'useState',
  'validateRemote',
  'validateValue'
] as const

const ECMASCRIPT_RESERVED_IDENTIFIER_SET = new Set<string>(ECMASCRIPT_RESERVED_IDENTIFIERS)
const LOWCODE_GENERATED_RUNTIME_IDENTIFIER_SET = new Set<string>(
  LOWCODE_GENERATED_RUNTIME_IDENTIFIERS
)

export function isSafeLowcodeIdentifier(value: string): boolean {
  return LOWCODE_IDENTIFIER_RE.test(value) && !UNSAFE_OBJECT_KEYS.has(value)
}

export function isReservedLowcodeStateIdentifier(value: string): boolean {
  return (
    value.startsWith('__') ||
    UNSAFE_OBJECT_KEYS.has(value) ||
    ECMASCRIPT_RESERVED_IDENTIFIER_SET.has(value) ||
    LOWCODE_GENERATED_RUNTIME_IDENTIFIER_SET.has(value)
  )
}

export function lowcodeStateSetterName(name: string): string {
  return `set${name.charAt(0).toUpperCase()}${name.slice(1)}`
}
