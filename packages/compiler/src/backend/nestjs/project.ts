import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { nestJSArtifact, nestJSJSONArtifact } from './artifact'
import { emitNestJSLocalRun, NESTJS_LOCAL_SCRIPTS } from './local-run'
import { LOCAL_RUN_GUIDE } from './local-run/guide'
import { NESTJS_PRESET_LOCK_SOURCE } from './preset-lock'

export const NESTJS_PROJECT_PACKAGE = {
  name: 'openpencil-nestjs-backend',
  version: '0.0.0',
  private: true,
  type: 'module',
  engines: { node: '>=22.12.0' },
  scripts: { build: 'tsc -p tsconfig.json', start: 'node dist/main.js', ...NESTJS_LOCAL_SCRIPTS },
  dependencies: {
    '@nestjs/common': '11.1.19',
    '@nestjs/core': '11.1.19',
    '@nestjs/platform-express': '11.1.19',
    'class-transformer': '0.5.1',
    'class-validator': '0.15.1',
    jose: '6.2.8',
    pg: '8.20.0',
    'reflect-metadata': '0.2.2',
    rxjs: '7.8.2'
  },
  devDependencies: {
    '@nestjs/testing': '11.1.19',
    '@types/express': '5.0.6',
    '@types/pg': '8.20.0',
    '@types/node': '24.12.2',
    typescript: '5.8.3'
  }
} as const

export function emitNestJSProject(application: BackendApplicationSpecV1) {
  const environment = application.secrets.map((entry) => entry.name + '=').join('\n') + '\n'
  return [
    nestJSJSONArtifact('package.json', NESTJS_PROJECT_PACKAGE, 'server-runtime'),
    nestJSArtifact(
      'package-lock.json',
      NESTJS_PRESET_LOCK_SOURCE,
      'server-runtime',
      'application/json'
    ),
    nestJSJSONArtifact(
      'tsconfig.json',
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          types: ['node'],
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          strict: true,
          esModuleInterop: true,
          forceConsistentCasingInFileNames: true,
          skipLibCheck: false,
          outDir: 'dist',
          rootDir: 'src',
          sourceMap: true
        },
        include: ['src/**/*.ts']
      },
      'server-runtime'
    ),
    nestJSArtifact('.env.example', environment),
    nestJSArtifact('.gitignore', 'node_modules/\ndist/\n.env\n.local/\n'),
    ...emitNestJSLocalRun(application),
    nestJSArtifact('LOCAL-RUN.md', LOCAL_RUN_GUIDE),
    nestJSArtifact(
      'README.md',
      `# Generated NestJS backend

This is an editable NestJS 11 / node-postgres service generated from an explicit HTTP API.
It is a separate Node application; exporting the frontend does not start or deploy this server.

For a local PostgreSQL database, API and same-origin frontend with one startup command,
follow [LOCAL-RUN.md](./LOCAL-RUN.md). Setup requires explicit initial-SQL approval;
normal startup never installs packages, downloads images or reapplies migrations.

## Run

1. Use Node 22.12 or newer. Run \`npm ci --ignore-scripts\`, then \`npm run build\`.
2. Review \`migrations/001-initial.sql\` and apply it manually to fresh tables in an isolated
   PostgreSQL 16+ database. It is transactional and intentionally fails if the tables already exist.
   The application never runs migrations. Use a dedicated database role with only the required table access.
3. Set the four server environment variables listed in \`.env.example\` in the launching shell
   or your process manager. The service does not automatically load .env files.
   DATABASE_URL must contain an explicit username, nonempty password, hostname, and database.
   Only an optional single \`sslmode=require\` or \`sslmode=verify-full\` parameter is accepted;
   local loopback may use plaintext. Remote connections always verify TLS certificates.
4. JWT issuer and audience must match your identity provider. JWKS must be HTTPS without
   credentials, fragment, or redirects. A verified, unexpired JWT must have a UUID \`sub\`.
5. Run \`npm start\`. HOST defaults to 127.0.0.1 and PORT to 3000.
   Configure your authenticated HTTPS ingress and same-origin API forwarding before exposing it.

## HTTP behavior

\`openapi.json\` describes the emitted resource paths. Protected resource routes require a Bearer JWT; explicit anonymous select policies allow tokenless reads.
List returns \`{ data, nextCursor }\` and accepts \`limit\` and \`after\`. Without an explicit sort,
it uses UUID keyset pagination in ascending key order. The default limit is the resource's declared maximum.
Read/create/update return only the declared read fields; delete returns \`{ deleted: true }\`.
Field IDs are JSON property names; model field names are SQL column names.
Unknown fields, invalid types, null on non-null fields, empty mutation bodies, invalid UUIDs and
unsupported query parameters are rejected. Numbers are not coerced from strings.

The server injects the verified subject on create. Owner policies add a subject predicate; role policies
use only the verified JWT top-level \`openpencil_roles\` array, matched against declared role IDs.
Public read policies expose all rows and declared read fields; client filters never grant or restrict authority.
Invalid supplied tokens never fall back to anonymous access.
When access is owner-scoped, another user's record has the same 404 result as an absent record. DTOs cannot write the owner or
generated ID, and PATCH cannot change the primary key. Policies are enforced by these service queries;
this preset does not install PostgreSQL RLS and direct database access is outside its HTTP boundary.
Connection and statement limits bound server work; database internals are not returned to clients.

Use \`client.ts\` from React, Vue or other TypeScript clients with your own token resolver and same-origin
API base URL. It does not implement login or automatically convert Supabase widgets.
Enums, dates/datetimes, indexes, unique constraints and constrained foreign keys are supported.
Dates retain their YYYY-MM-DD calendar day. Datetime writes accept Z or offsets up to ±14:00
with up to six fractional digits; responses use UTC and preserve microseconds. Authored defaults
and HTTP DTOs require both the written and normalized UTC years to remain within 0001–9999.
These date checks do not install database CHECK constraints for direct database writes.
Private foreign keys must include equal source/target owners; public-target references use declared readable keys.
Foreign-key deletes allow restrict/no-action only; relations do not generate joins.
Optional resource query declarations add equality filters, literal substring search and non-null scalar sorting.
Sorted cursors include the sort value and UUID tie-breaker and must be reused with the same query.
Datetime filters and cursors use UTC Z values; offset representations are accepted only for writes.
Managed preview can initialize models with enums, authored indexes, unique constraints and
foreign-key relations, and rebuild their backend when the data model is unchanged. Subsequent
data-model changes require a separately managed migration or a new isolated database.
Tenants, deny policies, broad authenticated policies, workflows, storage, composite primary keys and
unsupported incremental schema changes are rejected instead of being omitted. Generated source is not a production release receipt.

## Atomic commands

When declared, commands execute bounded primary-key reads, checked integer arithmetic, assertions
and single-row mutations in one database transaction. Their explicit server steps are separate
from resource CRUD permissions. Owner-scoped reads bind the verified caller; command-scoped reads
grant only the authored operation. Responses include only the declared return fields.

Send one \`Idempotency-Key\` header with 16–128 ASCII letters, digits, dots, underscores, colons or
hyphens. Both first commits and replays return 200. Reuse the same key and parameters after a
timeout or lost response; never infer rollback from a network error. Different parameters or a
different command definition conflict with an already committed key (409).
The SDK exposes \`client.commands[commandId](parameters, { idempotencyKey, signal? })\`, has a
30-second deadline, and does not retry mutations automatically. Timeout/cancellation cannot prove
rollback. Replay returns the original response snapshot, not current row state.

The internal \`public.openpencil_command_requests\` ledger commits with business changes and is
included in managed schema checks, without an HTTP endpoint. There is no automatic ledger expiry;
deleting its rows removes replay protection. Adding/removing ledger support on an existing managed
database requires a separately reviewed migration. Command-only runtime changes preserve its rows.
The generated frontend retains attempt keys across route changes within the current app session,
but does not yet provide a durable browser recovery journal across reloads.
The checkout example supports one SKU per order, integer minor currency units, and pending-order
cancellation; it does not collect payment or implement carts, delivery or refunds.

## Desktop live preview

The desktop editor can connect its frontend preview to this already-running service.
\`local:up\` enables a loopback-only compatibility endpoint at
\`/_openpencil/preview-contract\`. For a manually started local service, set
\`OPENPENCIL_LOCAL_PREVIEW=1\` and \`HOST=127.0.0.1\` explicitly before \`npm start\`.
The endpoint returns only the application ID and contract digest; it is not a release receipt
or a database schema inspection. Resource routes retain their declared JWT, owner, role and public-read policy checks.

Register the editor's exact preview origin and OIDC callback (default
\`http://127.0.0.1:5181/_openpencil/auth/callback\`) with your public identity client.
Open the live preview in the system browser to sign in. Visual edits update the frontend;
model/auth changes require an explicitly synchronized backend and a new connection.
Use a separate preview database: preview CRUD writes real data.
`
    )
  ]
}
