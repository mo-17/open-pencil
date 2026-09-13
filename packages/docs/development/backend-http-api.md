---
title: Backend HTTP API Contract
description: Explicit resource exposure, field projections, and identity configuration in provider-neutral Backend application documents.
---

# Backend HTTP API contract

Backend application V1 and V2 documents accept an optional, versioned `httpApi` section.
It declares which model operations may become HTTP endpoints and which fields cross that boundary.
An entity does not become an API merely because it exists in the data model.

The shared parser validates this declaration together with the application's model, identities,
and environment references. The [NestJS provider](./backend-nestjs.md) implements a bounded CRUD
subset with explicit owner, JWT role and public-read policies. Other providers and the V2 compilation path reject the declaration with
`backend-http-api-provider-unimplemented` rather than omit it. The declaration itself is not a
running HTTP server or evidence that authentication, database access, migration or deployment
has occurred.

## Declaration

The following fragment belongs in an application with a `notes` entity, a single non-null `id`
primary key, a `title` field, a `user` identity of kind `user`, and explicit row-access policies.
Its three environment names must also appear in `secrets` as required `environment` references
with `exposure: 'server'`. The document contains their names, never their runtime values.

```json
{
  "version": 1,
  "authentication": {
    "kind": "jwt",
    "identityId": "user",
    "issuerEnvironment": "BACKEND_JWT_ISSUER",
    "audienceEnvironment": "BACKEND_JWT_AUDIENCE",
    "jwksUrlEnvironment": "BACKEND_JWKS_URL",
    "algorithms": ["RS256"]
  },
  "resources": [
    {
      "id": "notes-api",
      "path": "/api/notes",
      "entityId": "notes",
      "operations": ["list", "read", "create", "update", "delete"],
      "readFields": ["id", "title"],
      "createFields": ["title"],
      "updateFields": ["title"],
      "maxPageSize": 25
    }
  ]
}
```

The authentication declaration supports only the closed `RS256` and `ES256` algorithm set.
It refers to a declared user identity and required server environment references; it cannot contain
a token, private key, arbitrary verification callback, or inline provider-specific executable code.
These parser checks validate configuration intent. The generated NestJS runtime verifies tokens
and enforces its supported owner and role policies; explicit anonymous `select` policies allow
tokenless reads. Supplied invalid tokens never fall back to anonymous access. Tenant policies
remain outside this provider's supported subset.

## Resource semantics

### Optional browser client

An explicit `browserClient` can accompany server authentication without containing its environment
values. The NestJS React/Vue preset consumes it for browser login and same-origin API requests:

```json
{
  "version": 1,
  "apiBasePath": "/api",
  "authentication": {
    "kind": "oidc-pkce",
    "issuer": "https://identity.example.test/tenant",
    "clientId": "public-browser-client",
    "scopes": ["openid", "profile"],
    "callbackPath": "/_openpencil/auth/callback"
  }
}
```

Issuer identifiers retain exact trailing-slash semantics. They must be canonical HTTPS URLs,
except explicit numeric-loopback HTTP for local development, and cannot carry userinfo, query
parameters or fragments. Scopes are unique and bounded, require `openid`, and exclude
`offline_access`. An optional `resource` is a public HTTPS authorization resource URI.
The fixed callback and a static, same-origin API mount cannot overlap; the mount cannot be `/`.
Endpoint overrides, headers, tokens and client secrets are not declaration fields.

The browser request concatenates the mount and resource path. With mount `/api`, declare the
resource at `/notes` when the desired browser URL is `/api/notes`; the generated Vite proxy removes
the mount before forwarding to NestJS. The earlier server-only example at `/api/notes` remains
valid, but adding mount `/api` to that example intentionally produces `/api/api/notes`.

`backendAuth` actions initiate sign-in or local sign-out. `backendRequest` actions select a declared
resource/operation and bounded ID or payload expressions, while `backendResource` binds a LIST to
the resource's list operation. Neither can supply arbitrary URLs, SQL, headers or credentials.
The Compiler resolves expression scope and checks projections and target-state types before
emitting code. See the [NestJS workflow](./backend-nestjs.md#author-a-personal-notes-application).

### Operations

| Operation | HTTP method and route | Model access                |
| --------- | --------------------- | --------------------------- |
| `list`    | `GET <path>`          | Select a bounded collection |
| `read`    | `GET <path>/:id`      | Select one record           |
| `create`  | `POST <path>`         | Insert a record             |
| `update`  | `PATCH <path>/:id`    | Update a record             |
| `delete`  | `DELETE <path>/:id`   | Delete a record             |

Resource IDs must be unique across the declaration, and operations must be unique within each
resource. Every resource references an existing entity and declares at least one operation.
Paths are bounded absolute paths with static ASCII segments;
query strings, fragments, escapes, wildcard syntax, and caller-defined parameters are rejected.
Validation checks the resulting method/path patterns, including `:id` collisions with another
resource's literal path and case-insensitive collisions.

`readFields` explicitly selects response fields. `createFields` and `updateFields` are required
only when their respective operation is declared and are otherwise forbidden. Field lists must
be nonempty, unique, and reference the selected entity. Client mutation projections cannot write
generated fields or fields controlled by ownership and tenant identity. Updates cannot change the
primary key. Record-addressed operations require a single non-null primary key of type `string`,
`uuid`, or `integer`; the contract does not guess a URL representation for composite or other keys.

`maxPageSize` is required exactly when `list` is enabled and must be an integer from 1 through 100.

The optional `query` object is list-only and contains three field-ID arrays: `filterFields`,
`searchFields`, and `sortFields`. Each is bounded to 16 distinct readable fields; at least one
must be nonempty. Filters accept scalar equality, search fields must be strings, and sort fields
must be non-null scalar fields other than strings. Query declarations never grant row access.
The NestJS provider implements these through parameterized queries and stable UUID tie-breakers.
No resource, operation, writable field, or page size is implicitly added. A declaration is bounded
to 64 resources and paths to 128 characters, in addition to the shared Backend input limits.

## Normalization and capabilities

The parser sorts resources, algorithms, operations, field projections and browser scopes canonically. HTTP API
content participates in the application digest and survives V1-to-V2 conversion and V2 common
projection. Documents that omit `httpApi` retain their existing normalized bytes and digests.
Documents that omit `browserClient` also retain their previous bytes; authored public client
configuration participates in the digest. Unknown versions and fields, invalid references, and
secret-like data fail validation.

An HTTP API uses `server.http` and `auth.identity`; its declared operations also derive `data.read`
and/or `data.write`. Used capabilities must be declared with `required: true`. Existing model and
policy capabilities remain necessary, and API exposure does not replace row-access authorization.

Compiler planning and emission require an exact reviewed provider implementation before adapter
callbacks can consume the declaration. Unsupported providers, replayed plans and the V2 compilation
path remain blocked, including Supabase V2-to-V1 common lowering. Existing applications without
the declaration keep their established provider behavior.

See [Backend Provider architecture](./backend-providers.md) for the compiler and release boundary,
and the [roadmap](./roadmap.md#generated-application-backends) for NestJS implementation status.
