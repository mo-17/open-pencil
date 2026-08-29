---
title: Third-party plugin tutorial
description: Build, validate, sign, submit, publish, and install a safe OpenPencil Manifest v2 plugin.
aside: false
---

# Third-party plugin tutorial

OpenPencil third-party plugins are declarative contracts, not browser extensions. A manifest cannot
ship arbitrary JavaScript or grant itself DOM, network, filesystem, Tauri, or document-write access.
Every new `plugin.id` or capability needs an exact, reviewed host adapter shipped in OpenPencil;
publisher signing cannot bypass that boundary.

The repository includes four complete, signable examples under `examples/third-party-plugin/`:

- **Document Summary** — an empty input contract with aggregate document and selection counts;
- **Node Type Counter** — a closed enum input and bounded result;
- **Style Usage** — privacy-safe traversal of public document nodes;
- **Variable Overview** — a dedicated variable-read permission with aggregate-only output.

The interactive, step-by-step tutorial is currently available in
[Simplified Chinese](/zh-cn/development/plugin-tutorial). It covers exact Manifest v2 contracts,
reviewed host adapters, Ed25519 key handling, separate validation and creation envelopes, Portal
review, Marketplace publication, installation, and MCP revocation checks. The complete architecture
and trust model remain in [Plugin Architecture](/development/plugins).

## Minimal local verification

From the repository root:

```sh
bun open-pencil plugin manifest validate \
  examples/third-party-plugin/node-type-counter/manifest.payload.json

bun test tests/engine/app/plugins/third-party-example.test.ts
```

Keep publisher private keys outside the entire repository. Register only the public key with the
Marketplace, and never place credentials, request URLs, or executable code in a manifest.
