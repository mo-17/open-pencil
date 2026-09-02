import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readStaticDist } from '#cli/commands/deploy'
import {
  createBuildServerDeploymentNotice,
  createDeployServerDeploymentNotice
} from '#cli/server-deployment'

describe('server artifact CLI delivery', () => {
  test('build notice points at the durable server bundle only when one exists', () => {
    expect(
      createBuildServerDeploymentNotice({ outDir: '/workspace/dist', serverFiles: [] })
    ).toBeUndefined()

    expect(
      createBuildServerDeploymentNotice({
        outDir: '/workspace/dist',
        serverFiles: ['openpencil-server/SERVER_DEPLOYMENT.md']
      })
    ).toEqual({
      required: true,
      warning:
        'Server workflows were generated but were not deployed. OpenPencil does not upload server code or configure server secrets automatically.',
      artifactDirectory: '/workspace/dist/openpencil-server',
      commands: [
        "supabase functions deploy openpencil-runtime --workdir '/workspace/dist/openpencil-server'"
      ],
      backendReviewRequired: false,
      serverRuntimeDeploymentRequired: true
    })
  })

  test('never recommends a function deploy for data-only Backend review artifacts', () => {
    expect(
      createBuildServerDeploymentNotice({
        outDir: '/workspace/dist',
        serverFiles: ['openpencil-server/backend/supabase/rls-policy.json'],
        backendReviewFiles: ['openpencil-server/backend/supabase/rls-policy.json'],
        executableServerWorkflowFiles: []
      })
    ).toEqual({
      required: true,
      warning:
        'Backend Provider review artifacts were generated but were not applied. Static hosting does not modify remote schema, RLS, storage policy, or Backend runtime.',
      artifactDirectory: '/workspace/dist/openpencil-server',
      commands: [],
      backendReviewRequired: true,
      serverRuntimeDeploymentRequired: false
    })
  })

  test('deploy notice rebuilds into a durable directory before the manual function deploy', () => {
    const notice = createDeployServerDeploymentNotice(
      '/workspace/designs/惊悚.fig',
      '/workspace/openpencil-build'
    )

    expect(notice.commands).toEqual([
      "bun open-pencil build '/workspace/designs/惊悚.fig' -o '/workspace/openpencil-build'",
      "supabase functions deploy openpencil-runtime --workdir '/workspace/openpencil-build/openpencil-server'"
    ])
    expect(notice.warning).toContain('does not upload server code')
    expect(notice.warning).toContain('configure server secrets')
    expect(notice.backendReviewRequired).toBe(false)
    expect(notice.serverRuntimeDeploymentRequired).toBe(true)
  })

  test('static upload payload cannot include the server directory or its env example', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'op-cli-server-deploy-'))
    try {
      mkdirSync(join(outDir, 'openpencil-server'), { recursive: true })
      writeFileSync(join(outDir, 'index.html'), '<h1>static</h1>')
      writeFileSync(
        join(outDir, 'openpencil-server/.env.server.example'),
        'PAYMENTS_API_KEY=do-not-upload\n'
      )

      const payload = readStaticDist({ outDir, staticFiles: ['index.html'] })
      expect([...payload.keys()]).toEqual(['index.html'])
      expect(Buffer.from(payload.get('index.html') ?? []).toString('utf8')).toBe('<h1>static</h1>')
      expect(payload.has('openpencil-server/.env.server.example')).toBe(false)
      expect(
        [...payload.values()].some((bytes) =>
          Buffer.from(bytes).toString('utf8').includes('do-not-upload')
        )
      ).toBe(false)
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  })
})
