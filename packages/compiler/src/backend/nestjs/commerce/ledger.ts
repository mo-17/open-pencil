const LEDGERS = [
  {
    name: 'openpencil_commerce_events',
    key: ['application_id', 'event_key'],
    columns: [
      ['application_id', 'text'],
      ['event_key', 'text'],
      ['group_id', 'uuid'],
      ['kind', 'text']
    ]
  },
  {
    name: 'openpencil_commerce_entries',
    key: ['application_id', 'entry_key'],
    columns: [
      ['application_id', 'text'],
      ['entry_key', 'text'],
      ['order_id', 'uuid'],
      ['kind', 'text'],
      ['amount', 'int4'],
      ['currency', 'text'],
      ['reference', 'text'],
      ['merchant_id', 'uuid']
    ]
  }
] as const

export const NESTJS_COMMERCE_RESERVED_NAMES = LEDGERS.flatMap((ledger) => [
  ledger.name,
  ledger.name + '_pkey'
])

export function nestJSCommerceLedgerSQL(): string[] {
  return LEDGERS.map(
    (ledger) =>
      'CREATE TABLE public.' +
      ledger.name +
      ' (\n' +
      [
        ...ledger.columns.map(([name, type]) => '  ' + name + ' ' + type + ' NOT NULL'),
        '  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP',
        '  PRIMARY KEY (' + ledger.key.join(', ') + ')'
      ].join(',\n') +
      '\n);'
  )
}

/** Exact managed catalog includes private financial state; it is never an HTTP resource. */
export function managedCommerceLedgerSchemas() {
  return LEDGERS.map((ledger) => {
    const primary = ledger.name + '_pkey'
    const key = [...ledger.key]
    return {
      name: ledger.name,
      columns: [
        ...ledger.columns.map(([name, type]) => ({ name, type, nullable: false })),
        { name: 'created_at', type: 'timestamptz', nullable: false }
      ],
      indexes: [primary],
      constraints: [primary],
      catalog: {
        enums: [],
        constraints: [{ name: primary, kind: 'p', columns: key }],
        indexes: [
          { name: primary, columns: key, options: key.map(() => 0), unique: true, primary: true }
        ]
      }
    }
  })
}
