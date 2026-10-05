# Flutter preview companion

Development/self-hosted entry: `bun tools/dev/flutter-preview/src/index.ts` from the fixed checkout root. It is not a bundled release sidecar.

The stdin/stdout contract is the public `@open-pencil/compiler/flutter-preview` JSONL protocol. It emits `ready` immediately. `start`/`update` accept bounded portable SceneGraph snapshots and revisions; the host compiler chooses the Flutter target and fixed package name. Arbitrary Dart files, project directories, options, SDK commands and device boot operations are not accepted. Only already-running iOS/Android emulators freshly listed by the local SDK are eligible.

Each session is generated into a private UUID directory beneath the OS temporary directory, with a session ownership marker, bounded generated paths and symlink rejection. Stop/close/EOF/signals stop only children and private process groups spawned by this companion. Close retains its generated project and bounded logs for diagnosis.

The existing SDK must come from PATH or the user's fixed `fvm/default/bin/flutter`. Commands suppress analytics/version checks, create a fixed platform project without pub resolution, and run `pub get --offline`. SDK engine cache misses fail closed; the child environment disallows remote engine mirror fallback. Runtime dependencies are limited to the Flutter SDK. Native plugins, including WebView/VR Tour, need a separate offline platform dependency contract; compiler source export remains available.

Android additionally requires the exact Gradle wrapper distribution to be cached. Its SDK-generated wrapper is changed only inside the owned project to use `--offline --no-daemon`, disable JDK auto-download, and disable Android SDK auto-download. This does not install/upgrade SDKs or change global Gradle configuration. Android lifecycle and cache boundaries have injected tests; this batch's real device acceptance is iOS only.

Updates preserve state through `app.restart` with `fullRestart:false` and `pause:false`. The revision advances only after a successful machine response (`code:0`) and a still-running owned app. Dependency, asset or generated-file-set changes require an explicit stop/start. Failed reload restores the prior source and keeps the prior acknowledged revision. Stop/close preempt preparing or reloading instead of waiting behind them.

Machine framing and operations were checked against the installed Flutter 3.41.6 official `packages/flutter_tools/doc/daemon.md`, especially the `flutter run --machine` subset. See [Flutter's daemon protocol](https://github.com/flutter/flutter/blob/main/packages/flutter_tools/doc/daemon.md), [Gradle offline mode](https://docs.gradle.org/current/userguide/gradle_command_line.html), and [JDK download control](https://docs.gradle.org/current/userguide/toolchains.html). Unit/process tests do not establish native page rendering, real IME, installed app packaging or Android device operation.

Focused checks: `bun test ./tools/dev/flutter-preview/tests`, `bunx oxlint -c oxlint.json tools/dev/flutter-preview`, `bunx tsgo --noEmit -p tools/dev/flutter-preview/tsconfig.json`. Use the explicit `./` file path: this batch observed different child-process output behavior with Bun's unprefixed test-filter form; its failed logs are retained separately.
