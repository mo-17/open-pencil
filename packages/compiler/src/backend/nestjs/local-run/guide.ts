export const LOCAL_RUN_GUIDE = `# Run your exported application locally

Use Node 22.12+ (with npm) and a running Docker engine. The commands below run from the
export root. No global Node packages are installed. These scripts are for one local operator;
they do not configure production ingress, backups, identity accounts or application hosting.

## Configure once

Read the generated backend [identity and application setup](./README.md#identity-and-application-setup)
first. It lists this export's exact environment names, browser identity, business roles and
account initialization commands. Configure your existing identity provider before starting the app;
these scripts do not create users, assign roles or provision an identity server.

Use the issuer and browser client already authored in the export, and the API audience plus HTTPS
JWKS endpoint configured at that issuer. Replace the example values below with those actual values:

\x60\x60\x60sh
npm --prefix backend/nestjs run local:configure -- --issuer 'https://identity.example.com' --audience 'YOUR_API_AUDIENCE' --jwks-url 'https://identity.example.com/keys'
\x60\x60\x60

All commands in this guide run from the full frontend export root. If your current directory is
already \x60backend/nestjs\x60, omit \x60--prefix backend/nestjs\x60. A declared browser client requires
its matching frontend at the export root; for API-only startup without that frontend, follow
the manual Run steps in \x60README.md\x60. A modular monolith starts once, with one shared database
and migration history; do not run each business module independently.

### Optional personal-notes Keycloak shortcut

Only for an explicitly selected matching local Keycloak instance:

\x60\x60\x60sh
npm --prefix backend/nestjs run local:configure -- --local-keycloak --ca /absolute/path/to/trusted-ca.pem
\x60\x60\x60

The shortcut selects issuer \x60http://127.0.0.1:18080/realms/openpencil\x60, audience
\x60openpencil-notes-api\x60 and HTTPS JWKS
\x60https://127.0.0.1:18443/realms/openpencil/protocol/openid-connect/certs\x60.
The exported browser client must already use that issuer and the public client registered at
Keycloak (for the personal-notes example: \x60notes-public-client\x60). This command does not
reconfigure Keycloak or rewrite the exported browser identity. A different identity provider
can use \x60--issuer <url> --audience <value> --jwks-url <https-url>\x60 instead.

Supply your trusted PEM CA file explicitly with \x60--ca\x60 for a local/private certificate.
Publicly trusted HTTPS endpoints do not require that option. TLS verification is always enabled;
HTTP is allowed only for a loopback issuer, never for the backend JWKS connection.

Ports default to frontend \x605173\x60, API \x603000\x60 and PostgreSQL \x6055432\x60, all bound to
\x60127.0.0.1\x60. Optional \x60--web-port\x60, \x60--api-port\x60 and \x60--db-port\x60 override them.
Register the exact \x60http://127.0.0.1:5173\x60 origin plus the callback path from
\x60BACKEND-CLIENT.md\x60 in your public OIDC client. Hostnames and ports are significant:
\x60localhost\x60 and \x60127.0.0.1\x60 are different callback origins.

## Review and initialize once

Read \x60backend/nestjs/migrations/001-initial.sql\x60 first. Then explicitly authorize setup:

\x60\x60\x60sh
npm --prefix backend/nestjs run local:setup -- --accept-initial-schema
\x60\x60\x60

This command installs the backend from its reviewed npm lock and the frontend from its lock
when present (otherwise creates an initial lock), with dependency lifecycle scripts disabled.
It builds both applications and downloads \x60postgres:16-alpine\x60 only if the image is missing.
It creates a uniquely named container and persistent Docker volume for this export.

Random database passwords are generated only now, stored in \x60backend/nestjs/.local\x60
(directory mode 0700, new private files mode 0600), and never embedded in the exported source.
The API uses a separate non-superuser runtime role with table CRUD permission; the migration
account owns DDL. Initial schema, runtime grants and a schema SHA-256 receipt commit in one
transaction. Existing tables without a matching receipt are rejected. Repeating setup with
the same SQL keeps the data; changed initial SQL is rejected and needs a reviewed incremental
migration. Startup never automatically repairs, resets, adopts or destroys a database.

Keep this export directory and its private \x60.local\x60 folder for daily use. Re-export into a
new directory for review rather than overwriting a running application's configuration.
Never commit or share \x60.local\x60, and back up the database before changing its schema.

## Start and use

\x60\x60\x60sh
npm --prefix backend/nestjs run local:up
\x60\x60\x60

Open the printed login URL (the authored login route is listed in \x60BACKEND-CLIENT.md\x60).
After login, follow the generated README's account and role instructions. Login does not register
an application profile or grant business roles. If the export has no browser client, only the API
and database start and there is no generated login URL.
The command starts the existing database, validates its schema receipt and identity endpoints,
starts NestJS, and serves the built frontend with a same-origin API proxy. API routes take
priority over the SPA fallback, including login and callback deep links. No dependencies or
images are downloaded by startup. Occupied frontend/API ports fail without killing another process.
Only this local runner uses Vite preview as a local static server; it is not a production host.

Press Ctrl+C or use a second terminal:

\x60\x60\x60sh
npm --prefix backend/nestjs run local:down
\x60\x60\x60

The runner stops only its child processes and verified database container. It preserves the
volume and application records. It never removes volumes, runs Docker system prune, or kills a
PID taken from a stale file. If a machine crash leaves a stale startup lock, first verify the
old runner has exited, then remove only \x60.local/up.lock\x60 and \x60.local/running.json\x60.

## Diagnose configuration

\x60\x60\x60sh
npm --prefix backend/nestjs run local:doctor
\x60\x60\x60

The read-only probes check the restricted database role, recorded schema, exact OIDC discovery
issuer/S256 PKCE and bounded HTTPS public JWKS. Fix the reported endpoint, port or CA setting
in \x60.local/config.json\x60. Do not change database passwords or container/volume identifiers
to try to repair a connection; those fields bind this directory to its persistent database.

HTTP 401 after successful browser login usually means the access-token issuer/audience or
UUID subject does not match the API. Discovery and JWKS success do not prove token audience
or authorization: complete a real login and verify account isolation. Never paste tokens
or credentials into logs. Configure the API audience at your issuer; an OIDC client ID is
not automatically an API audience. HTTPS failures require the correct certificate chain
and host name, never \x60NODE_TLS_REJECT_UNAUTHORIZED=0\x60.
`
