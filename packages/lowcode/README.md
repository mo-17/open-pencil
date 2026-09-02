# `@open-pencil/lowcode`

Framework-agnostic low-code contracts and deterministic validation for OpenPencil.

## Ownership

This package owns:

- the bounded expression and template language;
- low-code identifiers, routes, navigation, forms, and interactive-property validation;
- Supabase configuration, payload, RLS, and server-workflow validation;
- application runtime readiness audits and controlled metadata validation.
- provider-neutral Backend/DataModel/Auth/Workflow/Migration contracts and deterministic digests.

It depends only on public `@open-pencil/scene-graph` types. It does not own editor state, Vue UI,
preview orchestration, deployment adapters, credentials, networking, or Tauri/browser lifecycle.

## Public API

Use the package root for validators and shared contracts:

```ts
import { parseExpression, validateServerWorkflows } from '@open-pencil/lowcode'
```

The application readiness audit is also available through a focused subpath:

```ts
import { auditApplicationRuntime } from '@open-pencil/lowcode/application-runtime'
```

Provider adapters consume the strict, secret-free Backend Core through its focused subpath:

```ts
import {
  parseBackendApplicationSpecV1,
  planBackendMigration
} from '@open-pencil/lowcode/backend'
```

The Backend Core carries semantic model, authorization intent, capability requirements, and only
credential/environment references. It does not contain provider SDK types, SQL, executors, network
access, or credential values. Existing Supabase documents remain on their compatibility runtime path
and can be inspected through `lowerLegacySupabaseApplication()` without inferring production schema
or permissive access policy.

The legacy `@open-pencil/core/lowcode-validation` entry points remain as compatibility exports.
New code should import this package directly.
