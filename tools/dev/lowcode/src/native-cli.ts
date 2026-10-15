import { runNativeLowcodeCLI } from './native-command'

try {
  await runNativeLowcodeCLI(process.argv.slice(2), {
    env: process.env,
    async run({ action, args }) {
      const [{ COMMANDS }, { runMain }] = await Promise.all([
        import('@open-pencil/cli/commands'),
        import('citty')
      ])
      if (action === 'build') await runMain(await COMMANDS.build(), { rawArgs: args })
      else await runMain(await COMMANDS.deploy(), { rawArgs: args })
    }
  })
} catch {
  // Validation failures never echo paths, argument payloads or inherited credentials.
  console.error('Native lowcode command failed. Check the reviewed build or deployment options.')
  process.exitCode = 1
}
