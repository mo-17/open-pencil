/** Internal runtime state is never a DataModel entity or an HTTP resource. */
export const NESTJS_COMMAND_LEDGER_TABLE = 'openpencil_command_requests'

const LEDGER_KEY = ['application_id', 'command_id', 'subject', 'request_key']
const LEDGER_COLUMNS = [
  { name: 'application_id', type: 'text', nullable: false },
  { name: 'command_id', type: 'text', nullable: false },
  { name: 'subject', type: 'uuid', nullable: false },
  { name: 'request_key', type: 'text', nullable: false },
  { name: 'command_digest', type: 'text', nullable: false },
  { name: 'request_digest', type: 'text', nullable: false },
  { name: 'response_json', type: 'text', nullable: true }
]

export function nestJSCommandLedgerSQL(): string {
  return (
    'CREATE TABLE public.' +
    NESTJS_COMMAND_LEDGER_TABLE +
    ' (\n' +
    LEDGER_COLUMNS.map(
      (column) => '  ' + column.name + ' ' + column.type + (column.nullable ? '' : ' NOT NULL')
    ).join(',\n') +
    ',\n  PRIMARY KEY (' +
    LEDGER_KEY.join(', ') +
    ')\n);'
  )
}

/** Included in the same exact live-catalog verification as authored tables. */
export function managedCommandLedgerSchema() {
  const primary = NESTJS_COMMAND_LEDGER_TABLE + '_pkey'
  return {
    name: NESTJS_COMMAND_LEDGER_TABLE,
    columns: LEDGER_COLUMNS,
    indexes: [primary],
    constraints: [primary],
    catalog: {
      enums: [],
      constraints: [{ name: primary, kind: 'p', columns: LEDGER_KEY }],
      indexes: [
        {
          name: primary,
          columns: LEDGER_KEY,
          options: LEDGER_KEY.map(() => 0),
          unique: true,
          primary: true
        }
      ]
    }
  }
}
