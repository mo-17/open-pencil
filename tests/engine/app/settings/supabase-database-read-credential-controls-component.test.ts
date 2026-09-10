import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { compileScript, compileTemplate, parse as parseVueSfc } from 'vue/compiler-sfc'

const componentPath = resolve(
  import.meta.dir,
  '../../../../src/components/settings/plugins/SupabaseDatabaseReadCredentialControls.vue'
)
const parentPath = resolve(
  import.meta.dir,
  '../../../../src/components/settings/plugins/PluginDeploymentControls.vue'
)
const source = readFileSync(componentPath, 'utf8')
const parent = readFileSync(parentPath, 'utf8')

describe('Supabase database-read credential Settings controls', () => {
  test('is a compilable injected-controller component mounted only for the Tauri Supabase plugin', () => {
    const parsed = parseVueSfc(source, { filename: componentPath })
    expect(parsed.errors).toEqual([])
    compileScript(parsed.descriptor, { id: componentPath })
    const template = parsed.descriptor.template
    if (!template)
      throw new Error('SupabaseDatabaseReadCredentialControls.vue is missing a template')
    expect(
      compileTemplate({ source: template.content, filename: componentPath, id: componentPath })
        .errors
    ).toEqual([])

    expect(source).toContain('controller: SupabaseDatabaseReadCredentialSettingsControllerV1')
    expect(parent).toContain('SUPABASE_BACKEND_PROVIDER_PLUGIN_ID')
    expect(parent).toContain('desktopAvailable && plugin.package.manifest.plugin.id')
    expect(parent).toContain('<SupabaseDatabaseReadCredentialControls')
  })

  test('does not bind the password to Vue state and clears the native input after reading it', () => {
    expect(source).toContain('const input = form.elements.namedItem')
    expect(source).toContain("'supabase-database-read-password'")
    expect(source).toContain('let password = input.value')
    expect(source).toContain("input.value = ''")
    expect(source).toContain("password = ''")
    expect(source).not.toMatch(/v-model="(?:password|.*password.*)"/iu)
  })

  test('shows unconfirmed durability as a reconciliation warning rather than a confirmation', () => {
    expect(source).toContain("state.value.status === 'reconciliation-required'")
    expect(source).toContain('state.reconciliation')
    expect(source).toContain("state.receipt?.commitDurability === 'confirmed'")
    expect(source).toContain('mutationBlocked')
  })
})
