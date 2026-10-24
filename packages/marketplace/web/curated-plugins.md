# Curated marketplace tools

The marketplace offers independent editions of eight reviewed OpenPencil tools:
accessibility and design-system audits, application security readiness, and
Design Tokens, Vue, Next.js, Flutter, and Figma projection exporters. The bundled
editions remain available. Each marketplace edition has its own plugin identity,
installation state, and exact host adapter contract; both editions reuse the same
implementation.

These declarative packages require an editor build with the matching marketplace
host adapters. An older editor rejects an unknown adapter instead of executing
unreviewed code. Audits stay local and read-only. Exporters keep the existing save
confirmation, cancellation behavior, platform requirements, and format limits.

Generate unsigned payloads and Chinese listing metadata from the workspace root:

```sh
mkdir -p scratch/marketplace-curated
bun run marketplace:build:curated
```

The builder requires a fresh output directory. Publisher identity can be selected
with `--publisher-id`, `--publisher-name`, and `--publisher-key-id`; signing keys
are never part of the generated output. Sign each payload through the existing
`open-pencil plugin manifest sign` command, validate the exact package through the
marketplace submission workflow, and include approved releases in a separately
reviewed Root-signed publication. Publishing does not replace the database or
change the marketplace URL, Root key, or automatic renewal policy.

After approval, `openpencil-marketplace submission publish <submission-id>`
re-verifies publisher authority and package artifacts before creating the release.
It accepts the existing storage and actor options. This operation does not sign or
publish a Root snapshot; the separate publication review and signing remain required.
