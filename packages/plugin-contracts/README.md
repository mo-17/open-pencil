# @open-pencil/plugin-contracts

Portable, framework-neutral contracts for OpenPencil's declarative plugin ecosystem.

The root export owns bounded manifest and parameter schemas, connector contracts, publisher
keyrings, signed packages and catalogs, marketplace snapshots, and isolated runtime package/index
verification. It intentionally does not expose executable host adapters, Canvas or Compiler
implementations, application state, credential handling, or network transports.

Manifest V2 can also declare bounded `backendProviders`. These declarations contain only provider,
adapter, model-version, capability, configuration-schema, and output-kind metadata. Contract V1
grants no host permissions: reviewed Compiler bundles remain static host code, while credentials,
network introspection, confirmation, deployment, and verification remain host-owned.

```ts
import {
  parsePluginBackendProviderContribution,
  parseVersionedPluginManifest,
  verifyVersionedPluginPackage,
  type PluginManifest
} from '@open-pencil/plugin-contracts'
```

Backend Provider configuration schemas are closed (`additionalProperties: false`), bounded, and
may describe non-secret identifiers such as project references and regions. They cannot contain
endpoint, credential, SQL, script, executor, or deployment-command authority. Actual Secret values
must never enter the Manifest or configuration value; the host resolves CredentialRefs only after
review and confirmation.

Reviewed host adapters can reuse the bounded configuration primitives from the focused helper
subpath:

```ts
import { parsePluginBackendProviderConfiguration } from '@open-pencil/plugin-contracts/adapter-helpers'
```

Signing proves provenance, not executable authority. A declarative contribution becomes usable
only when the host has registered the exact reviewed adapter and revalidated the accepted package.
