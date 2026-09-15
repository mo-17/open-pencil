import type {
  BackendApplicationSpecV1,
  BackendCommandDefinitionIR
} from '@open-pencil/lowcode/backend'

/** Inputs come from normalized, bounded Backend IR; keep authored text inside Markdown code. */
function code(value: string): string {
  const text = value.replace(/[\r\n\t]/g, ' ').replaceAll('|', '\\|')
  const runs = text.match(/`+/g) ?? []
  const fence = '`'.repeat(Math.max(0, ...runs.map((run) => run.length)) + 1)
  return runs.length ? `${fence} ${text} ${fence}` : `${fence}${text}${fence}`
}

function rolesForCommand(
  application: BackendApplicationSpecV1,
  command: BackendCommandDefinitionIR
): Set<string> {
  const access = command.access
  const roles = new Set<string>('roleId' in access && access.roleId ? [access.roleId] : [])
  if (access.kind === 'row-policy')
    for (const policy of application.auth.rowAccess)
      if (
        access.policyIds.includes(policy.id) &&
        'roleId' in policy.principal &&
        policy.principal.roleId
      )
        roles.add(policy.principal.roleId)
  return roles
}

function roleUsage(application: BackendApplicationSpecV1): string {
  const roles = application.auth.roles.map((role) => role.id).sort()
  if (!roles.length)
    return 'This application declares no business role IDs. Its authenticated, owner and other declared row conditions still apply.\n'
  const rows = roles.map((id) => {
    const commands =
      application.commands?.commands
        .filter((command) => rolesForCommand(application, command).has(id))
        .map((command) => code(command.id))
        .sort() ?? []
    const resources =
      application.httpApi?.resources
        .filter((resource) =>
          application.auth.rowAccess.some(
            (policy) =>
              policy.entityId === resource.entityId &&
              policy.effect === 'allow' &&
              policy.operations.includes('select') &&
              (resource.readPolicyIds === undefined ||
                resource.readPolicyIds.includes(policy.id)) &&
              'roleId' in policy.principal &&
              policy.principal.roleId === id
          )
        )
        .map((resource) => code(resource.id))
        .sort() ?? []
    return `| ${code(id)} | ${commands.join(', ') || 'None'} | ${resources.join(', ') || 'None'} |`
  })
  return `The exact role IDs below are derived from this exported application. Assign only the roles approved for each account at the identity provider. Exporting, signing in and registering an application record do not grant a role.

| Role ID | Commands with role conditions | Resources with role-based read policies |
| --- | --- | --- |
${rows.join('\n')}

This table describes where roles are referenced, not permission to bypass ownership, membership, status or record-binding checks. A combined application shares one identity configuration; adding a module does not automatically grant its roles.
`
}

function accountRecords(application: BackendApplicationSpecV1): string {
  const commands = application.commands?.commands ?? []
  const records = application.auth.ownership.flatMap((ownership) => {
    const entity = application.dataModel.entities.find((entry) => entry.id === ownership.entityId)
    if (
      !entity?.uniques?.some(
        (unique) => unique.fields.length === 1 && unique.fields[0] === ownership.identityFieldId
      )
    )
      return []
    return commands.flatMap((command) => {
      const step = command.steps[0]
      if (
        command.access.kind !== 'authenticated' ||
        command.steps.length !== 1 ||
        step.kind !== 'data.mutate' ||
        step.operation !== 'insert' ||
        step.entityId !== entity.id ||
        command.return.resultName !== step.resultName ||
        !step.values.some(
          (value) => value.field === ownership.identityFieldId && value.value.kind === 'caller-sub'
        )
      )
        return []
      const consumers = commands
        .filter((candidate) =>
          candidate.steps.some(
            (read) =>
              read.kind === 'data.read' &&
              read.scope === 'owner' &&
              read.entityId === entity.id &&
              read.key.kind === 'parameter'
          )
        )
        .map((candidate) => code(candidate.id))
        .sort()
      return [
        `- ${code(command.id)}: POST ${code(command.path)} with parameters ${command.parameters.map((parameter) => code(parameter.name)).join(', ') || '(none)'}. It creates a caller-owned ${code(entity.name)} record, limited by the model to one record per account. ${consumers.length ? 'Commands that first select this owned record: ' + consumers.join(', ') + '.' : 'No command in this export requires selecting this record as an owner-scoped input.'}`
      ]
    })
  })
  return `Signing in creates a verified session, not application database records. If the generated interface provides Account setup, use that form to register your own profile before a business form asks you to select it. Profile registration never creates an identity-provider account or assigns business roles.

${records.length ? 'The following initialization operations are derived from authenticated single-insert commands and an ownership-field unique constraint; they are not run automatically:\n\n' + records.join('\n') : 'No one-record-per-account initialization command was identified in this model. Follow the generated forms and declared command inputs; do not invent or automatically call a registration endpoint.'}

Every command request requires an ${code('Idempotency-Key')} header: 16–128 ASCII letters, digits, dots, underscores, colons or hyphens. Reuse the same key and parameters after a timeout or lost response. Read the existing record after an already-registered conflict; do not repeatedly create it with new keys. Different people must use different verified accounts to exercise owner isolation. Role removal takes effect when the API receives a token without that role; a previously issued valid JWT can retain its claims until expiry. Sign out and obtain a fresh token after changing role assignments.
`
}

export function nestJSUsageGuide(application: BackendApplicationSpecV1): string {
  const api = application.httpApi
  if (!api) throw new Error('NestJS usage documentation requires an HTTP API.')
  const authentication = api.authentication
  const browser = api.browserClient?.authentication
  const roles = [...application.auth.roles].map((role) => role.id).sort()
  return `## Identity and application setup

### Server environment and browser identity

For manual API startup, work in the exported ${code('backend/nestjs')} directory, where its ${code('package.json')} lives. Set these variables in the shell or process manager that starts NestJS. Copying ${code('.env.example')} to ${code('.env')} alone does not load it. The local runner instead supplies server values from its explicit local configuration and generated private database credentials.

| Environment variable | Required value |
| --- | --- |
| ${code('DATABASE_URL')} | PostgreSQL runtime connection; use a separate restricted role, not the migration owner. |
| ${code(authentication.issuerEnvironment)} | Exact issuer of the API access token; must match its ${code('iss')}. |
| ${code(authentication.audienceEnvironment)} | API audience accepted in the access token ${code('aud')}; the public browser client ID is not automatically this audience. |
| ${code(authentication.jwksUrlEnvironment)} | Trusted HTTPS public signing-key endpoint, without credentials, query, fragment or redirects. |

After installing/building this backend and applying the reviewed initial SQL to a fresh database, manual startup uses ${code('npm start')}. It defaults to ${code('HOST=127.0.0.1')} and ${code('PORT=3000')}; configure frontend same-origin API forwarding separately, or use the local runner below.

${browser ? `The exported browser identity is fixed in the generated client: issuer ${code(browser.issuer)}, public client ID ${code(browser.clientId)}, callback path ${code(browser.callbackPath)}. Register that exact callback path under the chosen frontend origin, and allow Authorization Code with S256 PKCE. Configuring the local runner does not rewrite this browser identity. ${browser.resource ? `Its resource indicator is ${code(browser.resource)}; arrange the corresponding access-token audience at the issuer.` : 'Arrange the API audience at the issuer; this client does not declare an OAuth resource indicator.'} See the export root's [BACKEND-CLIENT.md](../../BACKEND-CLIENT.md) for the frontend route and API base path. The API receives the access token, not the ID token.` : 'This export has no generated browser identity client. Start and configure the API separately and supply a verified Bearer access token from your own client; no login screen is generated by this backend.'}

### Role claim mapping

The API reads only the signed access-token top-level ${code('openpencil_roles')} array. A missing claim means no roles; it must otherwise be an array of unique role-ID strings (at most 64). A string claim or malformed array fails authentication. Keycloak ${code('realm_access.roles')} / ${code('resource_access')} and other providers' nested role claims are not automatically read: configure a trusted issuer-side claim mapper to emit ${code('openpencil_roles')} in the access token. Never accept a browser form field as role authority.

${roles.length ? `For an account authorized for ${code(roles[0])}, the claim shape is ${code(JSON.stringify({ openpencil_roles: [roles[0]] }))}. This is an illustrative claim fragment, not a token or a grant to assign every listed role.` : 'Owner-only operations can work with an omitted or empty role claim.'}

${roleUsage(application)}
### First account records

${accountRecords(application)}
### Export layout and startup order

For a full React/Vue source export, keep the frontend at the export root and the backend under ${code('backend/nestjs')}. Follow ${code('LOCAL-RUN.md')} from the export root in this order: configure the existing identity provider values, review and explicitly initialize the fresh schema with ${code('local:setup -- --accept-initial-schema')}, then run ${code('local:up')}. Setup builds the frontend and backend; startup serves the frontend and API together. Do not run a second API on the same port.

${application.modules ? `This export contains ${application.modules.modules.length} declared modules in one application. Start one NestJS process and apply its shared migration once. Do not install, migrate or start each ${code('src/modules/*')} directory as a separate service.` : 'This is one backend application; its resource and command folders are not separately runnable services.'}

With only the backend directory, run ${code('npm run local:configure')}, ${code('npm run local:setup -- --accept-initial-schema')} and ${code('npm run local:up')} there, using the same configuration flags. ${browser ? 'Because this application declares a browser client, the local runner also expects its matching frontend export two directories above. Keep the full export layout, or use the manual API-only Run steps instead.' : 'Without a declared browser client, the runner starts only the database and API.'}

HTTP 401 indicates a missing/invalid token, issuer, audience, expiry, UUID subject or malformed role claim. A missing required role normally gives 403; 404 can also mean the current account cannot read that record. A successful login or ${code('local:doctor')} check alone does not prove business permissions. Check the intended role and account using a fresh login and the actual generated forms.

`
}
