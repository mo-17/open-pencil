import type {
  BindingExpr,
  SceneGraph,
  SceneNode,
  StateDef,
  StateValueType
} from '@open-pencil/scene-graph'

const FORM_CONTROL_TYPES = new Set<SceneNode['type']>([
  'INPUT',
  'TEXTAREA',
  'SELECT',
  'RADIO',
  'DATEPICKER',
  'CHECKBOX',
  'SWITCH'
])

export const FORM_CONTROLS_AUDIT_DEFAULT_LIMIT = 50
export const FORM_CONTROLS_AUDIT_MAX_LIMIT = 200
export const FORM_VALUE_BINDING_MAX_REPAIRS = 199

const CONTROL_SUFFIX_RE = /(datepicker|textarea|checkbox|select|radio|switch|input|field|control)$/i

// Page state names are emitted directly as React locals. Keep generated names
// out of the ECMAScript keyword set and the fixed identifiers emitted by the
// compiler's page/runtime scaffolding. Dynamic state/doc-state locals and
// their setters are reserved separately for each audited page below.
const COMPILER_RESERVED_STATE_IDENTIFIERS = new Set([
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
  'yield',
  'undefined',
  'NaN',
  'Infinity',
  'useState',
  'useMemo',
  'useEffect',
  'useRef',
  'useNavigate',
  'generatePath',
  'useParams',
  'useSearchParams',
  'navigate',
  'useDocState',
  'setDocState',
  'getDocStateSnapshot',
  'getSupabaseClient',
  'validateValue',
  'validateRemote',
  'useIntl',
  'intl'
])

export type FormControlBindingStatus = 'missing' | 'valid' | 'invalid'
export type FormControlStateType = Extract<StateValueType, 'string' | 'boolean' | 'array'>
export type FormControlBindingTargetType = Extract<
  StateValueType,
  'string' | 'number' | 'boolean' | 'array'
>

export interface FormControlAuditEntry {
  id: string
  name: string
  type: SceneNode['type']
  pageId: string
  stateType: FormControlStateType
  allowedBindingTypes: FormControlBindingTargetType[]
  bindingStatus: FormControlBindingStatus
  binding?: BindingExpr
  stateId?: string
  stateName?: string
  reason?: string
  suggestedState: StateDef
}

export interface FormControlsAudit {
  scopeId: string
  pageId: string
  total: number
  returned: number
  truncated: boolean
  controls: FormControlAuditEntry[]
  summary: {
    validated: number
    valid: number
    missing: number
    invalid: number
    repairable: number
  }
}

export interface FormControlsAuditOptions {
  limit?: number
}

export interface FormValueBindingPlan {
  audit: FormControlsAudit
  pageId: string
  nextState: StateDef[]
  bindings: Array<{
    nodeId: string
    bindings: Record<string, BindingExpr>
    state: StateDef
  }>
}

export type FormControlsResult<T> = { ok: true; data: T } | { ok: false; error: string }

interface PreparedFormControlRepair {
  nodeId: string
  bindings: Record<string, BindingExpr>
  state: StateDef
}

interface FormControlsAnalysis {
  audit: FormControlsAudit
  page: SceneNode
  repairs: PreparedFormControlRepair[]
}

interface FormControlsAnalysisState {
  collectRepairs: boolean
  controls: FormControlAuditEntry[]
  docStates: readonly StateDef[]
  invalid: number
  limit: number
  missing: number
  page: SceneNode
  pageStates: readonly StateDef[]
  repairs: PreparedFormControlRepair[]
  total: number
  usedIdentifiers: Set<string>
  usedIds: Set<string>
  valid: number
}

/** Audit validated form controls in a CANVAS, FORM subtree, or one control. */
export function auditValidatedFormControls(
  graph: SceneGraph,
  scopeId: string,
  options: FormControlsAuditOptions = {}
): FormControlsResult<FormControlsAudit> {
  const analyzed = analyzeValidatedFormControls(graph, scopeId, {
    collectRepairs: false,
    limit: options.limit
  })
  return analyzed.ok ? { ok: true, data: analyzed.data.audit } : analyzed
}

/** Build a non-mutating plan that appends page state and preserves every existing binding channel. */
export function planValidatedFormValueBindings(
  graph: SceneGraph,
  scopeId: string
): FormControlsResult<FormValueBindingPlan> {
  const analyzed = analyzeValidatedFormControls(graph, scopeId, {
    collectRepairs: true,
    limit: FORM_CONTROLS_AUDIT_DEFAULT_LIMIT
  })
  if (!analyzed.ok) return analyzed
  const { audit, page, repairs } = analyzed.data
  return {
    ok: true,
    data: {
      audit,
      pageId: page.id,
      nextState: [...(page.state ?? []), ...repairs.map((repair) => repair.state)],
      bindings: repairs
    }
  }
}

function analyzeValidatedFormControls(
  graph: SceneGraph,
  scopeId: string,
  options: { collectRepairs: boolean; limit?: number }
): FormControlsResult<FormControlsAnalysis> {
  const resolvedScope = resolveFormControlScope(graph, scopeId)
  if (!resolvedScope.ok) return resolvedScope
  const { page, scope } = resolvedScope.data
  const state = createAnalysisState(graph, page, options)

  for (const node of scopedNodes(graph, scope)) {
    if (!isValidatedFormControl(node)) continue
    const error = analyzeFormControl(node, state)
    if (error) return { ok: false, error }
  }

  return {
    ok: true,
    data: {
      page,
      repairs: state.repairs,
      audit: {
        scopeId,
        pageId: page.id,
        total: state.total,
        returned: state.controls.length,
        truncated: state.controls.length < state.total,
        controls: state.controls,
        summary: {
          validated: state.total,
          valid: state.valid,
          missing: state.missing,
          invalid: state.invalid,
          repairable: state.missing
        }
      }
    }
  }
}

function resolveFormControlScope(
  graph: SceneGraph,
  scopeId: string
): FormControlsResult<{ page: SceneNode; scope: SceneNode }> {
  const scope = graph.getNode(scopeId)
  if (!scope) return { ok: false, error: `Scope node "${scopeId}" not found` }
  const page = pageForNode(graph, scope)
  if (!page) return { ok: false, error: `Scope node "${scopeId}" is not inside a page` }
  if (scope.type !== 'CANVAS' && scope.type !== 'FORM' && !FORM_CONTROL_TYPES.has(scope.type)) {
    return {
      ok: false,
      error: `scope_id must reference a CANVAS, FORM, or supported form control; got ${scope.type}`
    }
  }

  const componentMaster = findComponentMasterAncestor(graph, scope)
  if (componentMaster) {
    return {
      ok: false,
      error: `Scope node "${scopeId}" is inside reusable component master "${componentMaster.name}" (${componentMaster.id}); page-state value bindings are unsupported there. Bind to document state instead.`
    }
  }
  return { ok: true, data: { page, scope } }
}

function createAnalysisState(
  graph: SceneGraph,
  page: SceneNode,
  options: { collectRepairs: boolean; limit?: number }
): FormControlsAnalysisState {
  const pageStates = page.state ?? []
  const docStates = graph.getNode(graph.rootId)?.lowcodeDocumentState ?? []
  const usedIdentifiers = new Set(COMPILER_RESERVED_STATE_IDENTIFIERS)
  for (const state of [...pageStates, ...docStates]) {
    reserveStateIdentifiers(usedIdentifiers, state.name)
  }
  reserveListQueryIdentifiers(graph, page, usedIdentifiers)
  return {
    collectRepairs: options.collectRepairs,
    controls: [],
    docStates,
    invalid: 0,
    limit: normalizeAuditLimit(options.limit),
    missing: 0,
    page,
    pageStates,
    repairs: [],
    total: 0,
    usedIdentifiers,
    usedIds: new Set(pageStates.map((state) => state.id)),
    valid: 0
  }
}

function isValidatedFormControl(node: SceneNode): boolean {
  return FORM_CONTROL_TYPES.has(node.type) && hasValidation(node)
}

function analyzeFormControl(node: SceneNode, state: FormControlsAnalysisState): string | undefined {
  state.total++
  const stateType = controlStateType(node)
  const allowedBindingTypes = controlBindingTypes(node)
  const binding = node.bindings?.value
  const resolved = resolveBinding(binding, state.pageStates, state.docStates, allowedBindingTypes)
  incrementBindingCount(state, resolved.status)

  if (
    state.collectRepairs &&
    resolved.status === 'missing' &&
    state.repairs.length === FORM_VALUE_BINDING_MAX_REPAIRS
  ) {
    return `Scope has more than ${FORM_VALUE_BINDING_MAX_REPAIRS} missing form value bindings; narrow scope and retry`
  }

  const shouldPrepareRepair = state.collectRepairs && resolved.status === 'missing'
  const shouldReturn = state.controls.length < state.limit
  if (!shouldPrepareRepair && !shouldReturn) return undefined

  const identifierPool =
    resolved.status === 'missing' ? state.usedIdentifiers : new Set(state.usedIdentifiers)
  const idPool = resolved.status === 'missing' ? state.usedIds : new Set(state.usedIds)
  const suggestedState = createSuggestedState(node, stateType, identifierPool, idPool)

  if (shouldPrepareRepair) {
    state.repairs.push({
      nodeId: node.id,
      bindings: {
        ...node.bindings,
        value: { kind: 'ref', stateId: suggestedState.id }
      },
      state: suggestedState
    })
  }
  if (shouldReturn) {
    state.controls.push({
      id: node.id,
      name: node.name,
      type: node.type,
      pageId: state.page.id,
      stateType,
      allowedBindingTypes,
      bindingStatus: resolved.status,
      ...(binding ? { binding } : {}),
      ...(resolved.state ? { stateId: resolved.state.id, stateName: resolved.state.name } : {}),
      ...(resolved.reason ? { reason: resolved.reason } : {}),
      suggestedState
    })
  }
  return undefined
}

function incrementBindingCount(
  state: FormControlsAnalysisState,
  status: FormControlBindingStatus
): void {
  if (status === 'valid') state.valid++
  else if (status === 'missing') state.missing++
  else state.invalid++
}

function createSuggestedState(
  node: SceneNode,
  stateType: FormControlStateType,
  usedIdentifiers: Set<string>,
  usedIds: Set<string>
): StateDef {
  return {
    id: allocateId(`form-state-${node.id.replace(/[^A-Za-z0-9_-]/g, '-')}`, usedIds),
    name: allocateStateName(controlBaseName(node.name), usedIdentifiers),
    type: stateType,
    defaultValue: controlDefaultValue(node, stateType)
  }
}

function* scopedNodes(graph: SceneGraph, scope: SceneNode): Iterable<SceneNode> {
  if (FORM_CONTROL_TYPES.has(scope.type)) {
    yield scope
    return
  }
  const stack = [...scope.childIds].toReversed()
  while (stack.length > 0) {
    const id = stack.pop()
    if (id === undefined) return
    const node = graph.getNode(id)
    if (!node) continue
    if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') continue
    yield node
    stack.push(...node.childIds.toReversed())
  }
}

/** Find the reusable component master that owns a node, if any. */
export function findComponentMasterAncestor(
  graph: SceneGraph,
  node: SceneNode
): SceneNode | undefined {
  let current = node.parentId ? graph.getNode(node.parentId) : undefined
  while (current) {
    if (current.type === 'COMPONENT' || current.type === 'COMPONENT_SET') return current
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return undefined
}

function normalizeAuditLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return FORM_CONTROLS_AUDIT_DEFAULT_LIMIT
  return Math.max(1, Math.min(FORM_CONTROLS_AUDIT_MAX_LIMIT, Math.floor(limit)))
}

function reserveListQueryIdentifiers(
  graph: SceneGraph,
  page: SceneNode,
  usedIdentifiers: Set<string>
): void {
  const rowsNames = new Set<string>()
  for (const node of scopedNodes(graph, page)) {
    if (node.type !== 'LIST') continue
    const dataSource = node.interactiveProps?.dataSourceRef
    if (
      dataSource === null ||
      typeof dataSource !== 'object' ||
      Array.isArray(dataSource) ||
      !('kind' in dataSource) ||
      dataSource.kind !== 'supabaseQuery'
    )
      continue
    const rowsName = uniqueListRowsName(node.name, rowsNames)
    rowsNames.add(rowsName)
    reserveStateIdentifiers(usedIdentifiers, rowsName)
  }
}

// Keep this normalization byte-for-byte equivalent to compiler tree.ts:
// Products -> productsRows, duplicate Products -> productsRows2.
function uniqueListRowsName(name: string, used: ReadonlySet<string>): string {
  const words = (name || 'list')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  const camel = words
    .map((word, index) =>
      index === 0 ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1).toLowerCase()
    )
    .join('')
  const ident = /^[a-zA-Z]/.test(camel) ? camel : `list${camel}`
  const base = `${ident || 'list'}Rows`
  if (!used.has(base)) return base
  let suffix = 2
  while (used.has(`${base}${suffix}`)) suffix++
  return `${base}${suffix}`
}

function pageForNode(graph: SceneGraph, node: SceneNode): SceneNode | undefined {
  let current: SceneNode | undefined = node
  while (current) {
    if (current.type === 'CANVAS') return current
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return undefined
}

function hasValidation(node: SceneNode): boolean {
  const validation = node.interactiveProps?.validation
  return validation !== null && typeof validation === 'object' && !Array.isArray(validation)
}

export function isCheckboxGroupControl(node: SceneNode): boolean {
  if (node.type !== 'CHECKBOX') return false
  const options = node.interactiveProps?.options
  return (
    (Array.isArray(options) && options.length > 0) ||
    (node.interactiveProps?.optionsSource !== null &&
      typeof node.interactiveProps?.optionsSource === 'object')
  )
}

function controlStateType(node: SceneNode): FormControlStateType {
  if (node.type === 'CHECKBOX') return isCheckboxGroupControl(node) ? 'array' : 'boolean'
  if (node.type === 'SWITCH') return 'boolean'
  return 'string'
}

function controlBindingTypes(node: SceneNode): FormControlBindingTargetType[] {
  if (node.type === 'INPUT') return ['string', 'number']
  return [controlStateType(node)]
}

function controlDefaultValue(node: SceneNode, type: FormControlStateType): unknown {
  if (type === 'boolean') return node.interactiveProps?.checked === true
  if (type === 'array') return []
  return typeof node.interactiveProps?.value === 'string' ? node.interactiveProps.value : ''
}

function controlBaseName(name: string): string {
  const withoutSuffix = name.trim().replace(CONTROL_SUFFIX_RE, '') || name.trim()
  const words = withoutSuffix
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
  if (words.length === 0) return 'field'
  const [first, ...rest] = words
  const base =
    first.toLowerCase() +
    rest.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join('')
  if (/^[A-Za-z_]/.test(base)) return base
  return `field${base.charAt(0).toUpperCase()}${base.slice(1)}`
}

function allocateStateName(base: string, usedIdentifiers: Set<string>): string {
  let candidate = base
  let suffix = 2
  while (usedIdentifiers.has(candidate) || usedIdentifiers.has(stateSetterName(candidate))) {
    candidate = `${base}${suffix++}`
  }
  reserveStateIdentifiers(usedIdentifiers, candidate)
  return candidate
}

function reserveStateIdentifiers(usedIdentifiers: Set<string>, name: string): void {
  usedIdentifiers.add(name)
  usedIdentifiers.add(stateSetterName(name))
}

function stateSetterName(name: string): string {
  return `set${name.charAt(0).toUpperCase()}${name.slice(1)}`
}

function allocateId(base: string, used: Set<string>): string {
  let candidate = base
  let suffix = 2
  while (used.has(candidate)) candidate = `${base}-${suffix++}`
  used.add(candidate)
  return candidate
}

function resolveBinding(
  binding: BindingExpr | undefined,
  pageStates: readonly StateDef[],
  docStates: readonly StateDef[],
  allowedTypes: readonly FormControlBindingTargetType[]
): { status: FormControlBindingStatus; state?: StateDef; reason?: string } {
  if (!binding) return { status: 'missing' }
  let state: StateDef | undefined
  if (binding.kind === 'ref') {
    state = pageStates.find((candidate) => candidate.id === binding.stateId)
  } else if (binding.kind === 'docState') {
    state = docStates.find((candidate) => candidate.name === binding.docStateName)
  }
  if (!state) return { status: 'invalid', reason: 'binding target does not exist' }
  if (binding.kind === 'ref' && state.computedExpr !== undefined) {
    return { status: 'invalid', state, reason: 'binding target is computed and read-only' }
  }
  if (!allowedTypes.includes(state.type as FormControlBindingTargetType)) {
    return {
      status: 'invalid',
      state,
      reason: `binding target type is ${state.type}; expected ${allowedTypes.join(' or ')}`
    }
  }
  return { status: 'valid', state }
}
