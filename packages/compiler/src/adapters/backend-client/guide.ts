import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

/** Configuration and startup instructions travel with the actual standalone source export. */
export function buildBackendClientGuide(
  application: BackendApplicationSpecV1,
  loginPath: string
): string {
  const browser = application.httpApi?.browserClient
  if (!browser) throw new Error('Browser authentication is required.')
  const authentication = browser.authentication
  return `# Run the authenticated application

The frontend and NestJS backend are separate applications. Open the login route below after starting both;
the original design document's existing home page is preserved.

## Start the complete application locally

The exported [local runner](./backend/nestjs/LOCAL-RUN.md) provides one-time configuration and
database initialization, followed by one command to start the frontend and authenticated API.
It requires Node 22.12+ and a running Docker engine. Keep your OIDC service running separately.

For an application authored with the local Keycloak preset, run from this export's root:

\`\`\`sh
npm --prefix backend/nestjs run local:configure -- --local-keycloak --ca /path/to/local.crt
# Review backend/nestjs/migrations/001-initial.sql before accepting the initial schema.
npm --prefix backend/nestjs run local:setup -- --accept-initial-schema
npm --prefix backend/nestjs run local:up
\`\`\`

Use the actual certificate path for your local issuer. Configuration contains no copied passwords
or tokens from OpenPencil. For another issuer, use the explicit options in LOCAL-RUN.md instead.
Setup installs this export's dependencies and initializes its isolated database. Later starts retain
the data. Open \`http://127.0.0.1:5173${loginPath}\` with the default web port.
Run \`npm --prefix backend/nestjs run local:doctor\` for connection diagnostics, or
\`npm --prefix backend/nestjs run local:down\` to stop the local services while retaining data.

The individual-service instructions below are for custom deployment or frontend development.

## Register the browser client

Use a public OIDC client with Authorization Code + S256 PKCE; never add a client secret to this project.
The exported public settings are:

\`\`\`json
${JSON.stringify({ issuer: authentication.issuer, clientId: authentication.clientId, scopes: authentication.scopes, callbackPath: authentication.callbackPath, loginPath, apiBasePath: browser.apiBasePath }, null, 2)}
\`\`\`

Register the exact frontend origin plus \`${authentication.callbackPath}\` as the callback URI.
For example, with Vite at http://localhost:5173, register
http://localhost:5173${authentication.callbackPath}; a different host or port is a different callback.
The issuer must support browser CORS for discovery, token exchange and JWKS reads. Issue signed JWT
access tokens whose issuer, audience and UUID subject match the backend settings. The API receives the
access token, never the ID token. Configure an API audience/resource at the issuer if required;
the optional browser resource setting does not replace backend audience verification.

## Start PostgreSQL and NestJS

Use Node 22.12+ and PostgreSQL 16+. From \`backend/nestjs\`, run \`npm ci --ignore-scripts\` and
\`npm run build\`. Review \`migrations/001-initial.sql\` and apply it to a fresh, isolated database with
a migration account. The application never applies migrations automatically. Use a separate runtime
database role with the required table access. See \`backend/nestjs/README.md\` for database TLS rules.

Provide \`DATABASE_URL\`, \`JWT_ISSUER\`, \`JWT_AUDIENCE\` and \`JWT_JWKS_URL\` in the launching shell
or process manager, then run \`npm start\` in \`backend/nestjs\`. These are server settings;
never place them in frontend Vite variables. The service does not automatically load \`.env\` files.
The JWT issuer/audience must match the access token, and JWKS requires direct HTTPS.
The server defaults to 127.0.0.1:3000. Its owner checks use the verified UUID \`sub\`.

## Start the frontend

At the project root, run \`npm install\`, then \`npm run build\` to check the production output.
Run \`npm run dev\` and visit the login path shown above on the printed Vite origin. After login,
the generated button returns to the authored notes route. Create, edit, delete and next-page actions
use the declared resource; every mutation refreshes its lists. Empty lists before login are expected.

The Vite development proxy forwards the exact \`${browser.apiBasePath}\` path prefix to
http://127.0.0.1:3000 and strips that prefix. Keep this backend port or explicitly update the proxy.
\`vite preview\` is not the configured development proxy and does not start the backend.
For production, serve frontend \`dist\` and route this same prefix to the backend before the SPA
fallback. All frontend routes, including the callback, need index.html fallback; API routes must
never fall back to HTML. Serve the frontend with HTTPS except explicit local loopback development.

## Session behavior

Tokens stay in browser memory. Reloading the page requires login again. Logout clears this application's
local session, Backend results, cursors and errors and stops old-session requests from updating the UI;
it does not revoke the identity provider's session. Another sign-in may reuse the provider's existing
session. No refresh token or offline access is requested. Expiry returns the application to login.
Exporting source does not configure an issuer, create a production database, or deploy either app.

## Recover command attempts

Actions explicitly configured with \`recovery: 'browser'\` save their request key and parameters in
IndexedDB before sending. The single-SKU shop example enables this for checkout and cancellation.
Tokens and server results are not stored. Records belong to the verified account and this app/API/OIDC
configuration. Other scripts on the same origin can access them, so opt in only for parameters that
may be retained on the device. Reloading still requires login; sign back in to the same account.

Choose View saved attempt to inspect without sending a command, then explicitly retry the saved
parameters if the result remains uncertain. Check the order list before acknowledging the record
and starting a new order. A changed command definition blocks retry; inspect the order before clearing
that record. Login, reload and inspection never automatically retry a mutation. Logout retains the
journal while clearing visible account state. The example keeps recovered parameters separate from
the currently edited form.

IndexedDB and Web Locks are required for opted-in actions. Storage failures stop the POST; a busy tab
fails immediately instead of queueing a later request. The journal holds at most 256 records per origin,
with no automatic eviction. Browser storage can be cleared or evicted and is not a permanent backup.
If the record is lost, inspect existing orders before purchasing again. Commands without the opt-in
remain in memory only; callers using the standalone SDK must retain their own attempt keys.
`
}
