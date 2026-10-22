# OpenPencil Shell patch

Source: `tauri-plugin-shell` 2.3.5 from the locked crates.io package (SHA-256
`8457dbf9e2bab1edd8df22bb2c20857a59a9868e79cb3eac5ed639eec4d0c73b`; the source
and permissions retain their original notices and Apache-2.0 OR MIT licenses).
The vendored files are its Rust build/runtime, global API script, permissions and mobile bindings;
JavaScript packaging and development assets are not used by Cargo.

OpenPencil's existing bounded Unicode JSON argument validators need more than
the regex crate's default 10 MiB compiled NFA budget. This patch uses a bounded
32 MiB budget and propagates regex compilation errors instead of panicking in
`ScopeAllowedCommand::deserialize`. Patterns, anchors, accepted argument
lengths, command names, fixed arguments and permissions are unchanged.

Local modifications are limited to `src/argument_validator.rs`, its registration
in `src/lib.rs`, error propagation in `src/scope.rs`, and the regex error variant
in `src/error.rs`. `desktop/tests/shell_scope.rs` exercises the same compiler
against the real capability file, including Unicode and boundary cases.

When updating the dependency, review whether the upstream API supports this
bounded compiler configuration and safe error propagation before removing the
patch. Do not replace the validators with unbounded or ASCII-only patterns.
