import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { MOTION_RECIPE_FORMAT, SceneGraph, type MotionRecipe } from '@open-pencil/scene-graph'

import { runOpenPencilCLI } from '#tests/helpers/cli'

const temporaryDirectories: string[] = []
const io = new IORegistry(BUILTIN_IO_FORMATS)

function recipe(): MotionRecipe {
  return {
    format: MOTION_RECIPE_FORMAT,
    version: 1,
    id: 'twoCards',
    name: 'Two cards',
    parameters: [{ id: 'duration', defaultValue: 300, min: 100, max: 1_000 }],
    roles: [
      {
        id: 'hero',
        motion: {
          version: 1,
          tracks: [
            {
              id: 'fade',
              trigger: 'mount',
              keyframes: [
                { offset: 0, opacity: 0 },
                { offset: 1, opacity: 1 }
              ],
              timing: { durationMs: 300 }
            }
          ]
        },
        bindings: [
          {
            parameterId: 'duration',
            target: { kind: 'timing', trackId: 'fade', field: 'durationMs' }
          }
        ]
      },
      {
        id: 'support',
        motion: {
          version: 3,
          tracks: [
            {
              id: 'move',
              trigger: 'mount',
              keyframes: [
                { offset: 0, x: -20 },
                { offset: 1, x: 0 }
              ],
              timing: { durationMs: 400 },
              composition: { mode: 'add', weight: 0.5, priority: 2 }
            }
          ]
        }
      }
    ]
  }
}

async function createFixture(directory: string): Promise<{
  input: string
  heroId: string
  supportId: string
}> {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  graph.createNode('RECTANGLE', page.id, { name: 'Hero recipe target', width: 100, height: 40 })
  graph.createNode('RECTANGLE', page.id, { name: 'Support recipe target', width: 80, height: 30 })
  const input = join(directory, 'input.fig')
  const encoded = await io.writeDocument('fig', graph)
  await Bun.write(input, encoded.data)
  const findId = async (name: string) => {
    const result = await runOpenPencilCLI(['find', input, '--name', name, '--json'])
    expect(result).toMatchObject({ exitCode: 0, stderr: '' })
    const match = (JSON.parse(result.stdout) as Array<{ id: string }>)[0]
    if (!match) throw new Error(`Expected CLI find result for ${name}`)
    return match.id
  }
  return {
    input,
    heroId: await findId('Hero recipe target'),
    supportId: await findId('Support recipe target')
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  )
})

describe('motion recipe CLI', () => {
  test('validates, instantiates, and atomically applies complete role snapshots', async () => {
    const directory = join(tmpdir(), `openpencil-motion-recipe-${randomUUID()}`)
    temporaryDirectories.push(directory)
    await mkdir(directory, { recursive: true })
    const fixture = await createFixture(directory)
    const recipePath = join(directory, 'recipe.json')
    const instancePath = join(directory, 'instance.json')
    const output = join(directory, 'output.fig')
    await Bun.write(recipePath, JSON.stringify(recipe()))
    const roles = JSON.stringify({ hero: [fixture.heroId], support: [fixture.supportId] })

    const validated = await runOpenPencilCLI(['motion', 'recipe', 'validate', recipePath, '--json'])
    expect(validated).toMatchObject({ exitCode: 0, stderr: '' })
    expect(JSON.parse(validated.stdout)).toMatchObject({ valid: true, recipe: { id: 'twoCards' } })

    const instantiated = await runOpenPencilCLI([
      'motion',
      'recipe',
      'instantiate',
      recipePath,
      '--roles',
      roles,
      '--parameters',
      '{"duration":640}',
      '-o',
      instancePath,
      '--json'
    ])
    expect(instantiated).toMatchObject({ exitCode: 0, stderr: '' })
    expect(JSON.parse(await Bun.file(instancePath).text())).toMatchObject({
      assignments: [
        { roleId: 'hero', motion: { tracks: [{ timing: { durationMs: 640 } }] } },
        { roleId: 'support', motion: { version: 3 } }
      ]
    })

    const applied = await runOpenPencilCLI([
      'motion',
      'recipe',
      'apply',
      fixture.input,
      '--recipe',
      recipePath,
      '--roles',
      roles,
      '--parameters',
      '{"duration":640}',
      '-o',
      output,
      '--json'
    ])
    expect(applied).toMatchObject({ exitCode: 0, stderr: '' })
    expect(JSON.parse(applied.stdout)).toMatchObject({
      recipeId: 'twoCards',
      assignmentCount: 2,
      output
    })
    const decoded = await io.readDocument({
      name: output,
      data: new Uint8Array(await Bun.file(output).arrayBuffer())
    })
    const hero = [...decoded.graph.getAllNodes()].find(({ name }) => name === 'Hero recipe target')
    const support = [...decoded.graph.getAllNodes()].find(
      ({ name }) => name === 'Support recipe target'
    )
    expect(hero?.motion?.tracks[0]?.timing.durationMs).toBe(640)
    expect(support?.motion).toMatchObject({ version: 3, tracks: [{ id: 'move' }] })
    expect((await readdir(directory)).some((name) => name.endsWith('.openpencil-tmp'))).toBe(false)
  }, 30_000)

  test('does not create an output document when any mapped node is missing', async () => {
    const directory = join(tmpdir(), `openpencil-motion-recipe-missing-${randomUUID()}`)
    temporaryDirectories.push(directory)
    await mkdir(directory, { recursive: true })
    const fixture = await createFixture(directory)
    const recipePath = join(directory, 'recipe.json')
    const output = join(directory, 'must-not-exist.fig')
    await Bun.write(recipePath, JSON.stringify(recipe()))

    const result = await runOpenPencilCLI([
      'motion',
      'recipe',
      'apply',
      fixture.input,
      '--recipe',
      recipePath,
      '--roles',
      JSON.stringify({ hero: [fixture.heroId], support: ['missing:999'] }),
      '-o',
      output
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('not found')
    expect(await Bun.file(output).exists()).toBe(false)
  }, 30_000)

  test('does not create output when an advanced recipe channel is incompatible', async () => {
    const directory = join(tmpdir(), `openpencil-motion-recipe-capability-${randomUUID()}`)
    temporaryDirectories.push(directory)
    await mkdir(directory, { recursive: true })
    const fixture = await createFixture(directory)
    const recipePath = join(directory, 'recipe.json')
    const output = join(directory, 'must-not-exist.fig')
    const incompatible = recipe()
    incompatible.roles[0].bindings[0].target = {
      kind: 'timing',
      trackId: 'reveal',
      field: 'durationMs'
    }
    incompatible.roles[0].motion = {
      version: 3,
      tracks: [
        {
          id: 'reveal',
          trigger: 'mount',
          keyframes: [
            { offset: 0, textReveal: 0 },
            { offset: 1, textReveal: 1 }
          ],
          timing: { durationMs: 300 }
        }
      ]
    }
    await Bun.write(recipePath, JSON.stringify(incompatible))

    const result = await runOpenPencilCLI([
      'motion',
      'recipe',
      'apply',
      fixture.input,
      '--recipe',
      recipePath,
      '--roles',
      JSON.stringify({ hero: [fixture.heroId], support: [fixture.supportId] }),
      '-o',
      output
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Text reveal requires a TEXT node')
    expect(await Bun.file(output).exists()).toBe(false)
  }, 30_000)
})
