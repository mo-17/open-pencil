---
title: Receipt-zero PostgreSQL Driver Admission Draft
description: Concrete admission requirements for a future native Receipt-zero reconciliation driver; no driver or production authority is approved.
---

# Receipt-zero PostgreSQL Driver Admission Draft

This proposal defines what a native PostgreSQL driver must demonstrate before it can implement the
private Receipt-zero reconciliation connector. It proposes an unapproved pinned candidate below; it does not admit a driver, authorize dependency
installation or database access, or enable a production constructor. The current
**PostgreSQL text-protocol response contract remains required**.

The inspected stock `tokio-postgres` APIs are not a direct fit: prepared queries request binary
results, preparation may issue additional type-discovery queries, and the application scalar sink
does not bound the driver's earlier message allocation. Resolving these differences is an explicit
driver admission decision, not an adapter implementation detail.

## LocalCompleted and Remaining

| Status | Evidence or requirement | Authority boundary |
| --- | --- | --- |
| LocalCompleted | Fixed SQL and exact journal-derived parameters; one-row scalar validation and independent classification | Local validation only; the scalar transcript does not authenticate a database |
| LocalCompleted | Test-only recovery composition, same-journal capability checks, durable lease consumption, original execution ceilings, and exact historical installation join | Preserves `OutcomeUnknown`; historical `Applied` evidence does not authenticate the current endpoint |
| LocalCompleted | Fake-connector coverage of fixed stages, expiry, cancellation hooks, and drop ordering | Does not demonstrate socket cleanup, server cancellation, or remote transaction completion |
| LocalCompleted | Owned real-Tokio timer with active deadline/cancellation wakeups and synchronous timer cleanup | Local executor behavior only; does not certify a PostgreSQL driver's server cancellation |
| LocalCompleted | Test-only atomic five-record current-vault snapshot and observer registration, borrowed connection inputs, and final disk revalidation | Local credential consistency; current database grants are independent of historical Management grants |
| LocalCompleted | Active revocation on matching write/remove/CAS attempts through the same vault instance or its clones, with pending-stage cleanup fixtures | No cross-instance/process notification or guarantee against complete value restoration outside this instance; final disk checks remain required |
| Remaining | Approved, pinned driver and TLS dependency graph with the admission evidence below | No dependency or driver version is approved by this draft |
| Remaining | Trusted Host action and production issuer binding current account, project, grant, credential incarnation, and profile digest to this recovered operation | A parsed profile or current vault snapshot alone is not execution authority |
| Remaining | Authenticated association between the remote database, expected installation, and operation scope; credential replacement/revocation behavior throughout execution | Historical Management read grants must not be equated with current database credential grants |
| Remaining | Production caller and authenticated settlement consumer | Raw observations cannot settle the journal, retry a mutation, issue Receipt V2, or authorize release |

These labels describe the established local boundary, not a production completion claim. Local
timers, current-vault checks, and shared-instance revocation do not satisfy the remote driver and
authentication requirements. Test counts and the current whole-repository check status belong in the
[Backend Provider Architecture](./backend-providers.md#manual-and-live-gates) verification record.

## Proposed next dependency decision

The next bounded implementation should evaluate **`tokio-postgres = 0.7.17` as an unapproved
candidate**, with its exact required dependencies. This is a reproducible source-review target,
not a claim that this version is current or has passed admission. Prefer the native lockfile's
existing `tokio = 1.53.1`, `rustls = 0.23.43`, and `tokio-rustls = 0.26.4`; do not silently upgrade
existing packages to resolve an incompatibility.

The requested authorization is limited to obtaining and pinning the candidate source and necessary
new dependencies, implementing the private connector and reviewed driver changes, and running
local protocol/TLS fixtures. Work should remain under `desktop/Cargo.toml`, `desktop/Cargo.lock`,
the existing reconciliation runner, an explicitly documented vendored driver patch if required,
and their tests and development documentation. Preserve source provenance and upstream licenses.

Inspect the pinned source first. Expected driver changes concern parameterized text result format,
rejection of unknown metadata before type discovery, and numeric message/queue budgets before
allocation. Record the actual patch and its maintenance cost; mutable upstream links are not proof
that any specific patch is required or sufficient. Do not replace the driver with a Host-written
PostgreSQL protocol or weaken the existing text-only result contract.

The reviewable deliverable is the exact dependency/feature and lockfile diff, a small documented
patch set, the owned connection/cancellation lifecycle, bounded secret-copy handling, and passing
local fake-peer tests for the admission requirements in this document. The implementation must
supply the finite numeric budgets and source locations where they are enforced. Existing vault,
Receipt-zero, native library, documentation, and secret-scan gates must remain valid; existing
repository-wide lint failures must still be reported separately.

This decision does **not** authorize real database access, a production capability issuer,
authenticated settlement, mutation retry, deployment, or pushing commits. Those remain separate
from driver admission. Until dependency authorization is provided, continue to preserve the
current locked dependency graph and the `OutcomeUnknown` fence.

## Fixed request and result contract

The adapter must consume the private journal-derived contract. It must not accept caller-provided
SQL, parameters, endpoints, credentials, deadlines, prepared statements, or existing sessions.

- The reconciliation statement is exactly 115,192 bytes with SHA-256
  `214b3b55199323c492c81d0af808cff33ffce8c066c1c480e16e1ba9c0d33f5a`.
- Bind exactly 28 positional parameters. Positions 14–17 are `pg_catalog.int8`, positions 18–19
  are `pg_catalog.int4`, and the remaining positions are `pg_catalog.text`. Preserve the owning
  contract's exact values, NULL policy, and input limits. Never interpolate them into SQL.
- Preserve the eight stages: Connect, BeginReadOnly, SearchPath (`pg_catalog`), RowSecurity (`off`),
  StatementTimeout (15,000 ms), Prepare, Execute, and FinishReadOnly (`ROLLBACK`). The original
  30-second execution ceiling includes connection and prefix work; stages do not receive fresh
  budgets.
- Request text result format. Accept exactly one row with the existing 29 ordered column names,
  exact built-in OIDs, and NULL policy. Keep the 256-byte cell and 4,096-byte aggregate scalar limits,
  canonical text integers and booleans, permanent sink poisoning, and final freshness check.
- Keep scalar validation separate from authentication. In particular, `absent` does not prove that
  the earlier mutation stopped; `advanced-head` does not supply portable Receipt V2 verification.

## Required driver evidence

### Bound parameters and text results

The inspected `tokio-postgres` query implementation supplies binary result format to Bind. Its
simple-query API returns text but does not supply this prepared parameter binding. Neither API is
an acceptable substitute without resolving that mismatch.
[Inspected query source](https://docs.rs/tokio-postgres/latest/src/tokio_postgres/query.rs.html).

Admission requires a driver API or reviewed driver change that preserves parameter binding while
requesting text results. A local protocol peer must verify the emitted Parse/Bind/Execute sequence,
all 28 parameter types and values, NULL encodings, and text result format. Wrong counts, reordered
metadata, unexpected OIDs, duplicate/extra rows, binary responses, and callback errors must fail
without returning an observation. There must be no retry through simple query or an alternative
statement after failure.

An independent binary scalar adapter is a possible **separate design decision**, not an accepted
change. That decision would need its own contract revision, exact raw-value validation, transcript
semantics, and equivalence tests. This proposal does not relax the existing text-only contract to
make a candidate driver appear compatible.

### Builtins-only metadata policy before type discovery

The inspected preparation path calls `get_type` for parameter and result metadata. Unknown OIDs can
trigger catalog queries, including recursive domain, enum, and composite discovery, before the Host
receives a `Statement`. Checking `Statement` afterward cannot prevent those earlier queries.
[Inspected preparation source](https://docs.rs/tokio-postgres/latest/src/tokio_postgres/prepare.rs.html).

Admission requires a policy that rejects unexpected metadata **before any discovery query or
derived request is sent**. Parameter OIDs must match the complete fixed positional schema; result
OIDs must match the fixed Text/Boolean/Int4 schema. Reject domain, enum, array, composite, and unknown
OIDs even when coercion could produce similar values. A fixture that sends each disallowed type
must show zero type-discovery requests. Bound metadata counts and names before allocating or
retaining them. The accepted driver trace must contain only the approved setup, fixed statement,
and cleanup operations.

This needs an exposed policy or a reviewed change to a mature driver. A new Host-written PostgreSQL
protocol implementation is not the proposed solution.

### Allocation and receive budgets before the scalar sink

The inspected codec waits for complete backend messages using the declared message length. The
row constructor already owns a complete data message and allocates column ranges before the Host
checks the row. A streaming query API avoids collecting every row, but does not by itself establish
the required earlier bounds.
[Inspected codec](https://docs.rs/tokio-postgres/latest/src/tokio_postgres/codec.rs.html),
[inspected row source](https://docs.rs/tokio-postgres/latest/src/tokio_postgres/row.rs.html).

Admission must record finite numeric limits for handshake input, backend message length, metadata,
cumulative plaintext bytes, notices/errors/status messages, retained rows, and queued requests.
These are separate limits from the 4 KiB scalar payload. The implementation must identify where
each limit is enforced before the corresponding allocation or buffer growth. Exact numeric driver
limits remain a decision to be supplied with the dependency proposal; they are not certified here.

Test peers must send a huge declared length with little payload, fragmented oversized input, excess
metadata, repeated asynchronous messages, extra rows, and an unfinished stream. Evidence must show
bounded allocation and termination under the original ceiling. A generic bounded `AsyncRead`
wrapper may help cap cumulative input without parsing PostgreSQL, but is not proof of a per-message
or TLS-handshake allocation bound. Include driver/TLS internal buffers and connection queues in the
measurement. Reject rather than truncate.

### TLS identity on both connections

`SslMode::Require` prevents plaintext fallback; full certificate and hostname verification is the
TLS connector's responsibility. The inspected rustls adapter supplies the hostname as a rustls
`ServerName`.
[Inspected TLS negotiation](https://docs.rs/tokio-postgres/latest/src/tokio_postgres/connect_tls.rs.html),
[inspected rustls adapter](https://docs.rs/tokio-postgres-rustls/latest/src/tokio_postgres_rustls/lib.rs.html).

Admission must bind the validated profile hostname, port 5432, database `postgres`, and allowed
Direct or Supavisor session mode. Use a reviewed trusted-root policy and normal hostname/chain
verification for both the query connection and any independent cancellation connection. No DSN
override, alternate endpoint, plaintext fallback, or permissive certificate verifier is allowed.
Local fixtures must reject wrong-host, untrusted, expired, and missing certificates and a server
that declines TLS. Successful TLS proves the verified endpoint identity, not the user's project
authorization or the installation association.

### Owned session, cancellation, and rollback

The inspected driver continues consuming responses when a query receiver is dropped. Transaction
Drop queues a rollback request; it does not await remote completion. `CancelToken` uses an independent
connection, and its successful return does not confirm that the server cancelled the query.
[Inspected connection source](https://docs.rs/tokio-postgres/latest/src/tokio_postgres/connection.rs.html),
[versioned transaction source](https://docs.rs/tokio-postgres/0.7.17/src/tokio_postgres/transaction.rs.html),
[inspected cancellation source](https://docs.rs/tokio-postgres/latest/src/tokio_postgres/cancel_token.rs.html).

Admission requires an explicit owner for the connection-driving future, transaction state, and
cancellation work. Creating or dropping an unpolled recovery future must start no socket or task.
Cleanup hooks remain local, nonblocking, idempotent signals; every signalled task must have an owner
and bounded termination. Never detach an untracked connection task or return this connection to a
pool. Pending Connect cleanup must not issue transaction commands. Pending session cleanup must
request cancellation before aborting the transaction, and completed failures must not receive a
late cancel.

Normal completion must await explicit `ROLLBACK` and the final freshness check before returning.
Failure cleanup must distinguish cancellation attempted, rollback confirmed, and connection closed;
none implies a successful observation. A cleanup-only termination allowance, if required, needs a
separate bounded policy that cannot extend read execution, return a late result, or alter
`OutcomeUnknown`. Fixtures must cover every pending stage, connection-task failure, cancellation
connection failure, an unresponsive server, repeated drop signals, and shutdown during cleanup.

### Credential handling and authentication

The production connector must consume a Host-issued operation capability, not construct one from
matching strings. The capability must bind the recovered journal operation to current authorized
account/project/grant and credential incarnation/profile digest, define replacement and revocation
behavior, and remain subject to the original execution ceiling. Historical installation checks and
current-vault consistency checks remain necessary local checks, without becoming remote authority.

The dependency review must also enumerate secret copies and their lifetimes. For example, the
inspected `tokio-postgres::Config` stores its password in a cloneable byte vector, so a zeroizing
vault snapshot does not establish zeroization throughout the driver. Driver query diagnostics may
format parameters. Require bounded secret lifetime and redacted diagnostics, including on errors;
do not claim driver-wide zeroization without evidence.
[Inspected configuration source](https://docs.rs/tokio-postgres/latest/src/tokio_postgres/config.rs.html).

## Admission deliverable and remaining live checks

A concrete dependency proposal must supply the exact versions and features, lockfile changes,
source provenance, required upstream changes, the selected numeric receive/allocation limits, the
owned-session cleanup design, and local evidence for each requirement above. The current native
lockfile has no PostgreSQL driver; existing HTTP/TLS dependencies do not implement this connector.
Installing a candidate is separate from approving its runtime behavior.

Local fake peers can establish emitted bytes, rejection behavior, allocation bounds, TLS negative
cases, timer wakeups, and task ownership. Explicitly authorized staging checks must then establish
the real fixed SQL result schema and classification, database role/RLS behavior, Direct and
Supavisor session semantics, endpoint/install association, and server-side cancellation/rollback
outcomes. If only one connection mode is exercised, the other remains unverified. These checks must
not mutate the earlier operation, clear its fence, or enable retry merely to obtain a passing read.

This draft's upstream links identify compatibility questions; they do not establish candidate admission.
Except for the explicitly versioned transaction reference, the inspected documentation/source URLs
are mutable `latest` views; their cached pages did not establish one consistent version. Re-check
the actual pinned source and applicable changes before approving any dependency. No crate was
installed or downloaded, and no database was accessed to prepare this proposal.
