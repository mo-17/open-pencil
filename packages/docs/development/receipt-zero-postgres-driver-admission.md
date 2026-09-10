---
title: Receipt-zero PostgreSQL Driver Boundary
description: The implemented native reconciliation contract and the remaining evidence required for production database reads.
---

# Receipt-zero PostgreSQL Driver Boundary

The native Receipt-zero reconciliation code defines a fixed, private database-read boundary.
It has local contract validation, a sealed runner, active timers, and test-only recovery and
credential composition. There is currently no admitted PostgreSQL driver, production capability
issuer, or authenticated settlement consumer. A passing local observation does not make the
backend ready for production.

## Implemented request and response contract

The runner consumes an opaque journal-derived contract. Caller-provided SQL, parameters,
endpoints, credentials, deadlines, prepared statements, and existing sessions cannot enter that
contract.

- The fixed reconciliation SQL is exactly 115,192 bytes with SHA-256
  `214b3b55199323c492c81d0af808cff33ffce8c066c1c480e16e1ba9c0d33f5a`.
- It binds exactly 28 positional parameters. Positions 14–17 are `pg_catalog.int8`, positions
  18–19 are `pg_catalog.int4`, and the remaining positions are `pg_catalog.text`. Only positions
  14 and 17 are nullable.
- The eight stages are Connect, BeginReadOnly, SearchPath (`pg_catalog`), RowSecurity (`off`),
  StatementTimeout (15,000 ms), Prepare, Execute, and FinishReadOnly (`ROLLBACK`).
- The sink accepts one row with 29 ordered columns and exact built-in Text/Boolean/Int4 types,
  using PostgreSQL text-format values. It enforces canonical scalars, the fixed NULL policy,
  a 256-byte cell limit, and a 4,096-byte aggregate scalar limit. Any callback error permanently
  poisons it.
- Native validation independently classifies absent, exact replay, advanced head, corruption,
  and failed preconditions. The scalar transcript records local validation; it does not
  authenticate the remote database or its installation.

These application-level scalar bounds do not prove that a future driver bounds its earlier
protocol buffers, metadata, TLS input, or queued requests.

## Recovery, credentials, and execution lifetime

The test-only recovery composition consumes the same journal's opaque recovery handle, durable
lease, and single-use read window. It rejoins exact historical `Applied` installation evidence
or a validated full tombstone before connection. The historical Management read grant remains
separate from the current database credential generation.

The first poll starts the 30-second overall execution ceiling before journal work. A real Tokio
timer actively wakes pending work on expiry or local cancellation. Journal wall and monotonic
clocks remain authoritative, and no stage or credential read restarts the budget. Pending Connect
cleanup cancels the connection attempt; pending session cleanup requests cancellation before
aborting the transaction. Normal completion awaits `ROLLBACK` and final freshness checks.

The current-vault composition atomically reads five credential records and registers a secret-free
observer. Connection inputs borrow the admitted snapshot. Matching write/remove/CAS attempts
through that `CredentialVault` instance or its clones revoke the observer, including same-value
writes, failed attempts, and unconfirmed persistence. Unrelated account writes do not revoke it.
The weak registry bounds active observations to 128 and accounts per observation to eight.

Vault reads run on the blocking executor, outside future polling. Late worker output is discarded;
it cannot reach a connector or escape as an observation. Final disk revalidation also detects
changes visible through independent vault instances. Cross-instance/process notifications and
complete restoration of all original values outside the shared instance remain unverified.

## Production release gates

| Required evidence | Current boundary |
| --- | --- |
| Pinned and reviewed PostgreSQL/TLS dependency graph, source provenance, and secret-copy lifetime | No PostgreSQL driver is admitted in the native dependency graph |
| Actual parameterized text-format request and exact fixed result metadata | Contract and fake-connector validation exist; driver wire behavior is unverified |
| Rejection of unexpected metadata before any derived type-discovery request | A completed application-level row check cannot establish this earlier boundary |
| Finite numeric bounds before protocol, metadata, TLS, queue, and row allocation | Scalar-sink limits alone do not establish driver allocation bounds |
| Certificate, hostname, and trusted-root verification for both query and cancellation connections | Parsed profile consistency is local evidence, not remote authentication |
| Explicit ownership and bounded termination of connection-driving, cancellation, and rollback work | Local cleanup hooks do not certify server cancellation or remote rollback |
| Host-issued operation authority binding the current account, project, grant, credential incarnation, profile, and remote installation | Historical journal evidence and a current vault snapshot cannot issue this authority |
| Authorized staging evidence for fixed SQL schema, role/RLS behavior, connection mode, endpoint/install association, and server cleanup | No real database access is established by the local fixtures |
| Authenticated settlement and portable Receipt V2 chain validation | Raw observations carry no settlement, retry, receipt, or release authority |

The original `OutcomeUnknown` fence remains intact after success, failure, expiry, revocation,
or drop. In particular, `absent` does not prove that the earlier mutation stopped, and
`advanced-head` does not supply portable Receipt V2 verification.

Current test counts and repository-wide verification limits are recorded in the
[Backend Provider Architecture](./backend-providers.md#manual-and-live-gates). Builds, local
protocol fixtures, and mocked cleanup are separate from the production release gates above.
