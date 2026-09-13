export const COMMAND_TYPES_SOURCE = String.raw`export type Scalar = string | number | boolean | null
export type CommandRow = Record<string, Scalar>
export type CommandParameter =
  | { readonly name: string; readonly type: 'uuid' | 'boolean'; readonly required: true }
  | { readonly name: string; readonly type: 'integer'; readonly required: true; readonly min: number; readonly max: number }
  | { readonly name: string; readonly type: 'string'; readonly required: true; readonly maxLength: number }
export type CommandLeaf =
  | { readonly kind: 'parameter'; readonly name: string }
  | { readonly kind: 'result'; readonly name: string; readonly field: string }
  | { readonly kind: 'literal'; readonly value: Scalar }
  | { readonly kind: 'caller-sub' }
export type CommandValue = CommandLeaf | {
  readonly kind: 'integer-arithmetic'
  readonly operator: 'add' | 'subtract' | 'multiply'
  readonly left: CommandLeaf
  readonly right: CommandLeaf
}
export interface CommandAssignment { readonly column: string; readonly source: CommandValue }
export type CommandStep =
  | { readonly kind: 'read'; readonly resultName: string; readonly table: string;
      readonly keyColumn: string; readonly ownerColumn: string; readonly key: CommandLeaf;
      readonly scope: 'owner' | 'command'; readonly projection: string }
  | { readonly kind: 'insert'; readonly resultName: string; readonly table: string;
      readonly values: readonly CommandAssignment[]; readonly projection: string }
  | { readonly kind: 'update'; readonly resultName: string; readonly table: string;
      readonly record: string; readonly keyColumn: string; readonly keyField: string;
      readonly values: readonly CommandAssignment[]; readonly projection: string }
  | { readonly kind: 'assert'; readonly left: CommandValue; readonly right: CommandValue;
      readonly operator: 'eq' | 'gte' | 'lte'; readonly error: 'not-found' | 'conflict' }
export interface CommandPlan {
  readonly applicationId: string
  readonly id: string
  readonly digest: string
  readonly access: { readonly kind: 'authenticated' } | { readonly kind: 'role'; readonly roleId: string }
  readonly parameters: readonly CommandParameter[]
  readonly steps: readonly CommandStep[]
  readonly return: { readonly resultName: string; readonly fields: readonly string[] }
}
`
