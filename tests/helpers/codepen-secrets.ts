import { Buffer } from 'node:buffer'

export interface CodePenSecretFixture {
  label: string
  source: string
  /** A unique fragment that must never be copied into a diagnostic or risk. */
  secretMarker: string
}

function assigned(value: string): string {
  return `const candidate = ${JSON.stringify(value)}`
}

/** Shared contract corpus for compiler export and static AI evidence scanners. */
export function codePenSecretFixtures(): readonly CodePenSecretFixture[] {
  const serviceRolePayload = Buffer.from(JSON.stringify({ role: 'service_role' })).toString(
    'base64url'
  )
  const privateMaterial = 'unit-test-private-material'
  const sensitiveValue = 'unit-test-database-password'
  const objectSecretValue = 'unit-test-object-client-secret'
  const awsSecretValue = 'H'.repeat(40)
  const fixtures = [
    {
      label: 'OpenAI legacy API key',
      value: ['sk', 'A'.repeat(32)].join('-')
    },
    {
      label: 'OpenAI project API key',
      value: ['sk', 'proj', 'B'.repeat(32)].join('-')
    },
    {
      label: 'Stripe secret key',
      value: ['sk', 'live', 'C'.repeat(24)].join('_')
    },
    {
      label: 'GitHub fine-grained token',
      value: ['github', 'pat', 'D'.repeat(32)].join('_')
    },
    {
      label: 'Slack bot token',
      value: ['xoxb', '123456789012', 'E'.repeat(24)].join('-')
    },
    {
      label: 'AWS access key id',
      value: `AKIA${'F'.repeat(16)}`
    },
    {
      label: 'Supabase opaque secret',
      value: ['sb', 'secret', 'G'.repeat(24)].join('_')
    },
    {
      label: 'Supabase service-role JWT',
      value: `e30.${serviceRolePayload}.signature`
    }
  ]

  return [
    ...fixtures.map(({ label, value }) => ({
      label,
      source: assigned(value),
      secretMarker: value
    })),
    {
      label: 'private key',
      source: assigned(
        `-----BEGIN PRIVATE KEY-----\n${privateMaterial}\n-----END PRIVATE KEY-----`
      ),
      secretMarker: privateMaterial
    },
    {
      label: 'sensitive literal assignment',
      source: `const databasePassword = ${JSON.stringify(sensitiveValue)}`,
      secretMarker: sensitiveValue
    },
    {
      label: 'quoted sensitive property assignment',
      source: JSON.stringify({ clientSecret: objectSecretValue }),
      secretMarker: objectSecretValue
    },
    {
      label: 'AWS secret access key assignment',
      source: `process.env.AWS_SECRET_ACCESS_KEY = ${JSON.stringify(awsSecretValue)}`,
      secretMarker: awsSecretValue
    },
    {
      label: 'URL credentials',
      source: assigned('https://publisher:unit-test-password@example.invalid/showcase'),
      secretMarker: 'unit-test-password'
    }
  ]
}
