# @open-pencil/plugin-contracts

Portable, framework-neutral contracts for OpenPencil's declarative plugin ecosystem.

The root export owns bounded manifest and parameter schemas, connector contracts, publisher
keyrings, signed packages and catalogs, marketplace snapshots, and isolated runtime package/index
verification. It intentionally does not expose executable host adapters, Canvas or Compiler
implementations, application state, credential handling, or network transports.

```ts
import {
  parseVersionedPluginManifest,
  verifyVersionedPluginPackage,
  type PluginManifest
} from '@open-pencil/plugin-contracts'
```

Reviewed host adapters can reuse the bounded configuration primitives from the focused helper
subpath:

```ts
import { parseBoundedPluginText } from '@open-pencil/plugin-contracts/adapter-helpers'
```

Signing proves provenance, not executable authority. A declarative contribution becomes usable
only when the host has registered the exact reviewed adapter and revalidated the accepted package.
