//! Offline contract kernel for the Supabase receipt-zero reconciliation read.
//!
//! This module deliberately does not define or register a Tauri command. It owns only the
//! one-shot lifecycle and the ordering/bounds that a future native PostgreSQL transport must
//! satisfy. Only the compiled-in fixed statement crosses the database-adapter seam; caller-supplied
//! query text, connection strings, credentials, endpoints, and session settings do not.
//!
//! Every potentially blocking adapter future is raced against a sealed Host interruption source and
//! receives the same immutable overall deadline (or the shorter fixed connect deadline). No
//! production timer or database adapter is registered in this dormant slice; a future PostgreSQL
//! adapter must bind the supplied control to its own cancellation token and server-side timeouts.

#![allow(dead_code)] // Dormant until a separately reviewed PostgreSQL adapter is wired.

mod credential;
mod credential_lifecycle;
mod profile;
mod wire;

#[cfg(test)]
pub(crate) use credential::{
    DatabaseReadCredentialAdmissionErrorV1, DatabaseReadCredentialAdmissionV1,
    DatabaseReadCredentialConnectionInputsV1,
};

pub(crate) use credential::{
    read_database_read_credential_snapshot, DatabaseReadCredentialSnapshotError,
    MAXIMUM_DATABASE_READ_PASSWORD_BYTES,
};
pub(crate) use credential_lifecycle::{
    clear_database_read_credential_v1, replace_database_read_credential_v1,
    DatabaseReadCredentialMutationError, DatabaseReadCredentialMutationReceiptV1,
};
pub(crate) use profile::DATABASE_READ_CONNECTION_PROFILE_MAX_BYTES;
pub(crate) use wire::contains_secret_like_material;

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    future::{poll_fn, Future},
    pin::pin,
    sync::atomic::{AtomicU8, Ordering},
    task::{Poll, Waker},
    time::Duration,
};

const RECEIPT_ZERO_QUERY_ID: &str = "backfill-receipt-zero-reconciliation";
const RECEIPT_ZERO_QUERY_VERSION: &str =
    "openpencil-supabase-backfill-receipt-zero-reconciliation-v1";
const RECEIPT_ZERO_SQL_DIGEST: &str = "IUs7VRmTI8SSyB0K-AjP8z_86MBmwcSA4W4bqcDTP1o";
const RECEIPT_ZERO_QUERY_DIGEST: &str = "4Ut9gb_dOvGNffTumgrqM5AL6gF2ejhe0SaNyltdpyU";
const RECEIPT_ZERO_QUERY_CONTRACT_DIGEST: &str = "fhz-SI32anCJ8t_vAXVIXKA3KJRB638dpdEzncH_F9I";
const RECEIPT_ZERO_PARAMETER_ORDER_DIGEST: &str = "AlALe35W3Rzj9DD2CwHeTz9geSumjoRBaER2qZBcslk";
const RECEIPT_ZERO_RESPONSE_FIELDS_DIGEST: &str = "UmqkaYgcqtW0tx19l8dlCsIIJ0Db3NvIXdR7-HWxM6k";
const RECEIPT_ZERO_QUERY_SOURCE: &str = include_str!(
    "../../src/app/plugins/host/deployment/supabase/backfill/receipt/zero/reconciliation/v1.sql"
);
const RECEIPT_ZERO_QUERY_BYTE_LENGTH: usize = 115_192;
const RECEIPT_ZERO_QUERY_SHA256: [u8; 32] = [
    0x21, 0x4b, 0x3b, 0x55, 0x19, 0x93, 0x23, 0xc4, 0x92, 0xc8, 0x1d, 0x0a, 0xf8, 0x08, 0xcf, 0xf3,
    0x3f, 0xfc, 0xe8, 0xc0, 0x66, 0xc1, 0xc4, 0x80, 0xe1, 0x6e, 0x1b, 0xa9, 0xc0, 0xd3, 0x3f, 0x5a,
];
const RECEIPT_ZERO_PARAMETER_COUNT: usize = 28;
const RECEIPT_ZERO_PARAMETER_ENVELOPE_FORMAT: &str =
    "openpencil.supabase-backfill-receipt-zero-cas-parameters.v1";
const RECEIPT_ZERO_STATEMENT_COUNT: u8 = 1;
const FIXED_STATEMENT_TIMEOUT_MS: u32 = 15_000;
const FIXED_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const FIXED_OVERALL_TIMEOUT: Duration = Duration::from_secs(30);
const MAXIMUM_PARAMETER_STRING_BYTES: usize = 87_384;
// Defense-in-depth for decoded values only. A future IPC decoder must independently enforce the
// stricter full serialized-request byte limit before deserialization.
const MAXIMUM_AGGREGATE_PARAMETER_VALUE_BYTES: usize = 256 * 1_024;
const MAXIMUM_RESPONSE_BYTES: usize = 128 * 1_024;
const READY: u8 = 0;
const RUNNING: u8 = 1;
const BURNED: u8 = 2;

const RECEIPT_ZERO_PARAMETER_ORDER: [&str; RECEIPT_ZERO_PARAMETER_COUNT] = [
    "executionId",
    "applicationId",
    "applicationDigest",
    "migrationId",
    "migrationDigest",
    "migrationPlanDigest",
    "providerAuthorityDigest",
    "sourceLedgerDigest",
    "scopeDigest",
    "resourceIdentityDigest",
    "catalogPreconditionDigest",
    "canonicalScopeBase64",
    "captureDigest",
    "capturedHighWater",
    "initialRemainingEligibleRowCount",
    "initialRemainingTargetRowCount",
    "requiredMatchedRowCount",
    "requiredBatchCount",
    "batchSize",
    "initialExecutionStatus",
    "candidateCommittedAt",
    "eventId",
    "receiptId",
    "idempotencyKey",
    "requestDigest",
    "receiptDigest",
    "canonicalReceiptBase64",
    "unauthenticatedOperationEvidenceDigest",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct FixedDigest([u8; 32]);

impl FixedDigest {
    pub(crate) fn checked(bytes: [u8; 32]) -> Result<Self, FixedReadError> {
        if bytes == [0; 32] {
            return Err(FixedReadError::InvalidContract);
        }
        Ok(Self(bytes))
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub(crate) enum FixedReadParameterValue {
    Text(String),
    Null,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct FixedReadBoundParameter {
    position: u8,
    name: &'static str,
    value: FixedReadParameterValue,
}

impl FixedReadBoundParameter {
    pub(crate) fn position(&self) -> u8 {
        self.position
    }

    pub(crate) fn name(&self) -> &'static str {
        self.name
    }

    pub(crate) fn value(&self) -> &FixedReadParameterValue {
        &self.value
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct FixedQueryIdentityV1 {
    query_id: &'static str,
    query_version: &'static str,
    sql_digest: &'static str,
    query_digest: &'static str,
    query_contract_digest: &'static str,
    parameter_order_digest: &'static str,
    response_fields_digest: &'static str,
    statement_count: u8,
}

impl FixedQueryIdentityV1 {
    pub(crate) fn query_id(&self) -> &'static str {
        self.query_id
    }

    pub(crate) fn query_version(&self) -> &'static str {
        self.query_version
    }

    pub(crate) fn sql_digest(&self) -> &'static str {
        self.sql_digest
    }

    pub(crate) fn query_digest(&self) -> &'static str {
        self.query_digest
    }

    pub(crate) fn query_contract_digest(&self) -> &'static str {
        self.query_contract_digest
    }

    pub(crate) fn parameter_order_digest(&self) -> &'static str {
        self.parameter_order_digest
    }

    pub(crate) fn response_fields_digest(&self) -> &'static str {
        self.response_fields_digest
    }

    pub(crate) fn statement_count(&self) -> u8 {
        self.statement_count
    }
}

/// Exact immutable statement artifact accepted by the dormant database adapter seam.
///
/// Its fields are private so callers cannot substitute SQL or metadata. This value carries no
/// connection, credential, dispatch, or execution authority.
#[derive(Clone, Copy)]
pub(crate) struct FixedReadStatementArtifactV1 {
    query: FixedQueryIdentityV1,
    source: &'static str,
    byte_length: usize,
    sha256: [u8; 32],
}

impl FixedReadStatementArtifactV1 {
    pub(crate) fn query(&self) -> &FixedQueryIdentityV1 {
        &self.query
    }

    pub(crate) fn source(&self) -> &'static str {
        self.source
    }

    pub(crate) fn byte_length(&self) -> usize {
        self.byte_length
    }

    pub(crate) fn sha256(&self) -> [u8; 32] {
        self.sha256
    }

    fn validate(&self) -> Result<(), FixedReadError> {
        if self.query != RECEIPT_ZERO_QUERY_IDENTITY_V1
            || self.source.len() != self.byte_length
            || self.byte_length != RECEIPT_ZERO_QUERY_BYTE_LENGTH
            || <[u8; 32]>::from(Sha256::digest(self.source.as_bytes())) != self.sha256
            || self.sha256 != RECEIPT_ZERO_QUERY_SHA256
        {
            return Err(FixedReadError::InvalidContract);
        }
        Ok(())
    }
}

const RECEIPT_ZERO_QUERY_IDENTITY_V1: FixedQueryIdentityV1 = FixedQueryIdentityV1 {
    query_id: RECEIPT_ZERO_QUERY_ID,
    query_version: RECEIPT_ZERO_QUERY_VERSION,
    sql_digest: RECEIPT_ZERO_SQL_DIGEST,
    query_digest: RECEIPT_ZERO_QUERY_DIGEST,
    query_contract_digest: RECEIPT_ZERO_QUERY_CONTRACT_DIGEST,
    parameter_order_digest: RECEIPT_ZERO_PARAMETER_ORDER_DIGEST,
    response_fields_digest: RECEIPT_ZERO_RESPONSE_FIELDS_DIGEST,
    statement_count: RECEIPT_ZERO_STATEMENT_COUNT,
};

const RECEIPT_ZERO_STATEMENT_ARTIFACT_V1: FixedReadStatementArtifactV1 =
    FixedReadStatementArtifactV1 {
        query: RECEIPT_ZERO_QUERY_IDENTITY_V1,
        source: RECEIPT_ZERO_QUERY_SOURCE,
        byte_length: RECEIPT_ZERO_QUERY_BYTE_LENGTH,
        sha256: RECEIPT_ZERO_QUERY_SHA256,
    };

/// Host-selected database connection identity. The incarnation is an opaque identifier for a
/// separately stored read credential, never the credential itself. Checking this structure does
/// not authenticate a connection or create any database authority.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct FixedReadConnectionIdentityV1 {
    project_ref: String,
    account_id: String,
    grant_generation: String,
    read_credential_incarnation: FixedDigest,
    connection_profile_digest: FixedDigest,
}

impl std::fmt::Debug for FixedReadConnectionIdentityV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("FixedReadConnectionIdentityV1")
            .field("project_ref", &"<redacted>")
            .field("account_id", &"<redacted>")
            .field("grant_generation", &"<redacted>")
            .field("read_credential_incarnation", &"<redacted>")
            .field("connection_profile_digest", &"<redacted>")
            .finish()
    }
}

impl FixedReadConnectionIdentityV1 {
    pub(crate) fn checked(
        project_ref: String,
        account_id: String,
        grant_generation: String,
        read_credential_incarnation: [u8; 32],
        connection_profile_digest: [u8; 32],
    ) -> Result<Self, FixedReadError> {
        let mut account_bytes = account_id.bytes();
        let valid_account = account_bytes
            .next()
            .is_some_and(|byte| byte.is_ascii_alphanumeric())
            && account_bytes
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'));
        if project_ref.len() != 20
            || !project_ref.bytes().all(|byte| byte.is_ascii_lowercase())
            || account_id.is_empty()
            || account_id.len() > 128
            || !valid_account
            || !valid_uuid_v4(&grant_generation)
        {
            return Err(FixedReadError::InvalidContract);
        }
        Ok(Self {
            project_ref,
            account_id,
            grant_generation,
            read_credential_incarnation: FixedDigest::checked(read_credential_incarnation)?,
            connection_profile_digest: FixedDigest::checked(connection_profile_digest)?,
        })
    }

    pub(crate) fn project_ref(&self) -> &str {
        &self.project_ref
    }

    pub(crate) fn account_id(&self) -> &str {
        &self.account_id
    }

    pub(crate) fn grant_generation(&self) -> &str {
        &self.grant_generation
    }

    pub(crate) fn read_credential_incarnation(&self) -> [u8; 32] {
        self.read_credential_incarnation.0
    }

    pub(crate) fn connection_profile_digest(&self) -> [u8; 32] {
        self.connection_profile_digest.0
    }
}

pub(crate) fn valid_uuid_v4(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => *byte == b'-',
            14 => *byte == b'4',
            19 => matches!(*byte, b'8' | b'9' | b'a' | b'b'),
            _ => byte.is_ascii_digit() || matches!(*byte, b'a'..=b'f'),
        })
}

#[derive(Debug)]
pub(crate) struct ReceiptZeroFixedReadContractV1 {
    query: FixedQueryIdentityV1,
    parameter_values_digest: FixedDigest,
    parameters: Vec<FixedReadBoundParameter>,
}

#[derive(Serialize)]
struct CanonicalParameterEnvelopeV1<'a> {
    format: &'static str,
    order: &'static [&'static str; RECEIPT_ZERO_PARAMETER_COUNT],
    values: &'a [FixedReadParameterValue],
    version: u8,
}

fn canonical_parameter_values_bytes(
    values: &[FixedReadParameterValue],
) -> Result<Vec<u8>, FixedReadError> {
    serde_json::to_vec(&CanonicalParameterEnvelopeV1 {
        format: RECEIPT_ZERO_PARAMETER_ENVELOPE_FORMAT,
        order: &RECEIPT_ZERO_PARAMETER_ORDER,
        values,
        version: 1,
    })
    .map_err(|_| FixedReadError::InvalidContract)
}

impl ReceiptZeroFixedReadContractV1 {
    pub(crate) fn checked(
        sql_digest: &str,
        query_digest: &str,
        query_contract_digest: &str,
        parameter_order_digest: &str,
        response_fields_digest: &str,
        parameter_values_digest: [u8; 32],
        values: Vec<FixedReadParameterValue>,
    ) -> Result<Self, FixedReadError> {
        if sql_digest != RECEIPT_ZERO_SQL_DIGEST
            || query_digest != RECEIPT_ZERO_QUERY_DIGEST
            || query_contract_digest != RECEIPT_ZERO_QUERY_CONTRACT_DIGEST
            || parameter_order_digest != RECEIPT_ZERO_PARAMETER_ORDER_DIGEST
            || response_fields_digest != RECEIPT_ZERO_RESPONSE_FIELDS_DIGEST
            || values.len() != RECEIPT_ZERO_PARAMETER_COUNT
        {
            return Err(FixedReadError::InvalidContract);
        }
        let parameter_value_bytes = values.iter().try_fold(0_usize, |total, value| {
            let value_bytes = match value {
                FixedReadParameterValue::Text(value) => {
                    if value.chars().any(char::is_control) {
                        return None;
                    }
                    value.len()
                }
                FixedReadParameterValue::Null => 0,
            };
            if value_bytes > MAXIMUM_PARAMETER_STRING_BYTES {
                return None;
            }
            total.checked_add(value_bytes)
        });
        if parameter_value_bytes.is_none_or(|bytes| bytes > MAXIMUM_AGGREGATE_PARAMETER_VALUE_BYTES)
        {
            return Err(FixedReadError::InvalidContract);
        }
        let supplied_parameter_values_digest = FixedDigest::checked(parameter_values_digest)?;
        let canonical_parameter_values = canonical_parameter_values_bytes(&values)?;
        let recomputed_parameter_values_digest = FixedDigest(<[u8; 32]>::from(Sha256::digest(
            &canonical_parameter_values,
        )));
        if supplied_parameter_values_digest != recomputed_parameter_values_digest {
            return Err(FixedReadError::InvalidContract);
        }
        let parameters = values
            .into_iter()
            .enumerate()
            .map(|(index, value)| FixedReadBoundParameter {
                position: u8::try_from(index + 1).expect("receipt-zero positions fit in u8"),
                name: RECEIPT_ZERO_PARAMETER_ORDER[index],
                value,
            })
            .collect();
        Ok(Self {
            query: RECEIPT_ZERO_QUERY_IDENTITY_V1,
            parameter_values_digest: supplied_parameter_values_digest,
            parameters,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum FixedReadDatabaseFailure {
    Unavailable,
    Rejected,
    Cancelled,
    TimedOut,
}

pub(crate) trait FixedReadDatabaseSession: Send {
    /// Adapter-owned handle returned only after preparing the exact fixed artifact.
    type PreparedStatement: Send;

    fn begin_read_only<'a>(
        &'a mut self,
        connection_identity: &'a FixedReadConnectionIdentityV1,
        control: FixedReadStageControlV1<'a>,
    ) -> impl Future<Output = Result<(), FixedReadDatabaseFailure>> + Send + 'a;
    fn set_local_search_path_pg_catalog<'a>(
        &'a mut self,
        control: FixedReadStageControlV1<'a>,
    ) -> impl Future<Output = Result<(), FixedReadDatabaseFailure>> + Send + 'a;
    fn set_local_statement_timeout_ms<'a>(
        &'a mut self,
        milliseconds: u32,
        control: FixedReadStageControlV1<'a>,
    ) -> impl Future<Output = Result<(), FixedReadDatabaseFailure>> + Send + 'a;
    fn prepare_fixed_statement<'a>(
        &'a mut self,
        statement: &'a FixedReadStatementArtifactV1,
        control: FixedReadStageControlV1<'a>,
    ) -> impl Future<Output = Result<Self::PreparedStatement, FixedReadDatabaseFailure>> + Send + 'a;
    fn execute_prepared<'a>(
        &'a mut self,
        statement: Self::PreparedStatement,
        parameters: &'a [FixedReadBoundParameter],
        response_limits: FixedReadResponseLimitsV1,
        control: FixedReadStageControlV1<'a>,
    ) -> impl Future<Output = Result<Vec<Vec<u8>>, FixedReadDatabaseFailure>> + Send + 'a;
    fn finish_read_only<'a>(
        &'a mut self,
        control: FixedReadStageControlV1<'a>,
    ) -> impl Future<Output = Result<(), FixedReadDatabaseFailure>> + Send + 'a;
    /// Local, idempotent, nonblocking cleanup trigger. A future adapter must retain a cancellation-
    /// safe transaction handle after any stage future is dropped; this hook must not perform sync
    /// network I/O.
    fn abort_read_only(&mut self);
    /// Local, idempotent, nonblocking request-cancellation trigger. Server-side cancellation remains
    /// an adapter integration claim and is deliberately unauthenticated in this dormant kernel.
    fn cancel_database_request(&mut self);
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct FixedReadResponseLimitsV1 {
    maximum_rows: u8,
    maximum_bytes: usize,
}

impl FixedReadResponseLimitsV1 {
    pub(crate) fn maximum_rows(&self) -> u8 {
        self.maximum_rows
    }

    pub(crate) fn maximum_bytes(&self) -> usize {
        self.maximum_bytes
    }
}

const FIXED_RESPONSE_LIMITS: FixedReadResponseLimitsV1 = FixedReadResponseLimitsV1 {
    maximum_rows: 1,
    maximum_bytes: MAXIMUM_RESPONSE_BYTES,
};

mod fixed_read_interrupt_source {
    /// Prevents renderer/plugin crates from manufacturing clocks or cancellation sources. The
    /// dormant Host connector and this module's deterministic tests are the only intended users.
    pub(super) trait Sealed {}
}

/// A monotonic Host signal used by the kernel's own race. Implementations must wake every waker
/// registered for a deadline once cancellation is requested or that deadline is reached.
pub(in crate::supabase_backfill_fixed_read) trait FixedReadInterruptSourceV1:
    fixed_read_interrupt_source::Sealed + Sync
{
    fn now(&self) -> Duration;
    fn is_cancelled(&self) -> bool;
    fn register_interrupt_waker(&self, deadline: FixedReadDeadlineV1, waker: &Waker);
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct FixedReadDeadlineV1(Duration);

impl FixedReadDeadlineV1 {
    pub(crate) fn monotonic_offset(&self) -> Duration {
        self.0
    }
}

#[derive(Clone, Copy)]
pub(crate) struct FixedReadStageControlV1<'a> {
    deadline: FixedReadDeadlineV1,
    interrupts: &'a dyn FixedReadInterruptSourceV1,
}

impl FixedReadStageControlV1<'_> {
    pub(crate) fn deadline(&self) -> FixedReadDeadlineV1 {
        self.deadline
    }

    pub(crate) fn remaining(&self) -> Duration {
        self.deadline.0.saturating_sub(self.interrupts.now())
    }

    pub(crate) fn is_cancelled(&self) -> bool {
        self.interrupts.is_cancelled()
    }

    pub(crate) async fn interrupted(self) -> FixedReadInterruptionV1 {
        poll_fn(|context| {
            if let Some(interruption) = self.current_interruption() {
                return Poll::Ready(interruption);
            }
            self.interrupts
                .register_interrupt_waker(self.deadline, context.waker());
            self.current_interruption()
                .map_or(Poll::Pending, Poll::Ready)
        })
        .await
    }

    fn current_interruption(&self) -> Option<FixedReadInterruptionV1> {
        if self.interrupts.is_cancelled() {
            Some(FixedReadInterruptionV1::Cancelled)
        } else if self.interrupts.now() >= self.deadline.0 {
            Some(FixedReadInterruptionV1::TimedOut)
        } else {
            None
        }
    }
}

pub(crate) struct FixedReadExecutionControlV1<'a> {
    interrupts: &'a dyn FixedReadInterruptSourceV1,
    connect_deadline: FixedReadDeadlineV1,
    overall_deadline: FixedReadDeadlineV1,
}

impl<'a> FixedReadExecutionControlV1<'a> {
    pub(in crate::supabase_backfill_fixed_read) fn start(
        interrupts: &'a dyn FixedReadInterruptSourceV1,
    ) -> Result<Self, FixedReadError> {
        let started_at = interrupts.now();
        let connect_deadline = started_at
            .checked_add(FIXED_CONNECT_TIMEOUT)
            .ok_or(FixedReadError::InvalidContract)?;
        let overall_deadline = started_at
            .checked_add(FIXED_OVERALL_TIMEOUT)
            .ok_or(FixedReadError::InvalidContract)?;
        Ok(Self {
            interrupts,
            connect_deadline: FixedReadDeadlineV1(connect_deadline.min(overall_deadline)),
            overall_deadline: FixedReadDeadlineV1(overall_deadline),
        })
    }

    pub(crate) fn connect(&self) -> FixedReadStageControlV1<'a> {
        FixedReadStageControlV1 {
            deadline: self.connect_deadline,
            interrupts: self.interrupts,
        }
    }

    pub(crate) fn overall(&self) -> FixedReadStageControlV1<'a> {
        FixedReadStageControlV1 {
            deadline: self.overall_deadline,
            interrupts: self.interrupts,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum FixedReadInterruptionV1 {
    Cancelled,
    TimedOut,
}

pub(crate) async fn race_fixed_read_future<T>(
    future: impl Future<Output = T>,
    control: FixedReadStageControlV1<'_>,
) -> Result<T, FixedReadInterruptionV1> {
    let mut future = pin!(future);
    poll_fn(|context| {
        if let Some(interruption) = control.current_interruption() {
            return Poll::Ready(Err(interruption));
        }
        control
            .interrupts
            .register_interrupt_waker(control.deadline, context.waker());
        if let Some(interruption) = control.current_interruption() {
            return Poll::Ready(Err(interruption));
        }
        match future.as_mut().poll(context) {
            Poll::Ready(value) => match control.current_interruption() {
                Some(interruption) => Poll::Ready(Err(interruption)),
                None => Poll::Ready(Ok(value)),
            },
            Poll::Pending => Poll::Pending,
        }
    })
    .await
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum FixedReadStage {
    Connect,
    BeginReadOnly,
    SearchPath,
    StatementTimeout,
    Prepare,
    Execute,
    Finish,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum FixedReadError {
    InvalidContract,
    AlreadyConsumed,
    Cancelled,
    Database {
        stage: FixedReadStage,
        failure: FixedReadDatabaseFailure,
    },
    InvalidRowCount,
    EmptyResponse,
    ResponseTooLarge,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct FixedReadAuthorityClaimsV1 {
    adapter_side_effects_authenticated: bool,
    production_request_dispatch_authenticated: bool,
    production_transport_created: bool,
    production_transport_authenticated: bool,
    dynamic_bindings_authenticated: bool,
    read_only_boundary_authenticated: bool,
    configured_search_path_authenticated: bool,
    server_statement_timeout_authenticated: bool,
    server_cancellation_authenticated: bool,
    live_catalog_semantics_authenticated: bool,
    single_statement_snapshot_authenticated: bool,
    credential_authority_created: bool,
    transport_authority_created: bool,
    database_authority_created: bool,
    mutation_authority_created: bool,
    execution_authority_created: bool,
    receipt_authority_created: bool,
    release_authority_created: bool,
    reconciliation_result_authenticated: bool,
    response_snapshot_authenticated: bool,
    release_ready: bool,
}

impl FixedReadAuthorityClaimsV1 {
    const NONE: Self = Self {
        adapter_side_effects_authenticated: false,
        production_request_dispatch_authenticated: false,
        production_transport_created: false,
        production_transport_authenticated: false,
        dynamic_bindings_authenticated: false,
        read_only_boundary_authenticated: false,
        configured_search_path_authenticated: false,
        server_statement_timeout_authenticated: false,
        server_cancellation_authenticated: false,
        live_catalog_semantics_authenticated: false,
        single_statement_snapshot_authenticated: false,
        credential_authority_created: false,
        transport_authority_created: false,
        database_authority_created: false,
        mutation_authority_created: false,
        execution_authority_created: false,
        receipt_authority_created: false,
        release_authority_created: false,
        reconciliation_result_authenticated: false,
        response_snapshot_authenticated: false,
        release_ready: false,
    };
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct FixedReadResultV1 {
    query: FixedQueryIdentityV1,
    parameter_values_digest: FixedDigest,
    response_row: Vec<u8>,
    response_byte_length: usize,
    authority: FixedReadAuthorityClaimsV1,
}

struct ReceiptZeroFixedReadSessionV1 {
    contract: ReceiptZeroFixedReadContractV1,
    state: AtomicU8,
}

impl ReceiptZeroFixedReadSessionV1 {
    fn new(contract: ReceiptZeroFixedReadContractV1) -> Self {
        Self {
            contract,
            state: AtomicU8::new(READY),
        }
    }

    async fn run<D: FixedReadDatabaseSession>(
        &self,
        database: D,
        connection_identity: &FixedReadConnectionIdentityV1,
        execution: &FixedReadExecutionControlV1<'_>,
    ) -> Result<FixedReadResultV1, FixedReadError> {
        self.state
            .compare_exchange(READY, RUNNING, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| FixedReadError::AlreadyConsumed)?;
        let _burn = BurnAfterRun { state: &self.state };
        let mut execution_guard = FixedReadDatabaseExecutionGuardV1::new(database);

        if let Some(interruption) = execution.overall().current_interruption() {
            execution_guard.database_mut().cancel_database_request();
            return Err(interruption_error(
                FixedReadStage::BeginReadOnly,
                interruption,
            ));
        }

        let outcome = async {
            RECEIPT_ZERO_STATEMENT_ARTIFACT_V1.validate()?;
            if self.contract.query != *RECEIPT_ZERO_STATEMENT_ARTIFACT_V1.query() {
                return Err(FixedReadError::InvalidContract);
            }
            // Once BEGIN is polled its server-side outcome is unknown until proved otherwise. A
            // timeout, cancellation, or adapter failure must therefore conservatively abort after
            // the raced future has been dropped.
            execution_guard.arm_before_begin();
            run_database_stage(
                execution_guard
                    .database_mut()
                    .begin_read_only(connection_identity, execution.overall()),
                FixedReadStage::BeginReadOnly,
                execution.overall(),
            )
            .await?;

            run_database_stage(
                execution_guard
                    .database_mut()
                    .set_local_search_path_pg_catalog(execution.overall()),
                FixedReadStage::SearchPath,
                execution.overall(),
            )
            .await?;

            run_database_stage(
                execution_guard
                    .database_mut()
                    .set_local_statement_timeout_ms(
                        FIXED_STATEMENT_TIMEOUT_MS,
                        execution.overall(),
                    ),
                FixedReadStage::StatementTimeout,
                execution.overall(),
            )
            .await?;

            let prepared_statement = run_database_stage(
                execution_guard.database_mut().prepare_fixed_statement(
                    &RECEIPT_ZERO_STATEMENT_ARTIFACT_V1,
                    execution.overall(),
                ),
                FixedReadStage::Prepare,
                execution.overall(),
            )
            .await?;

            let rows = run_database_stage(
                execution_guard.database_mut().execute_prepared(
                    prepared_statement,
                    &self.contract.parameters,
                    FIXED_RESPONSE_LIMITS,
                    execution.overall(),
                ),
                FixedReadStage::Execute,
                execution.overall(),
            )
            .await?;
            if rows.len() != 1 {
                return Err(FixedReadError::InvalidRowCount);
            }
            let response_row = rows
                .into_iter()
                .next()
                .expect("one response row was required");
            if response_row.is_empty() {
                return Err(FixedReadError::EmptyResponse);
            }
            if response_row.len() > MAXIMUM_RESPONSE_BYTES {
                return Err(FixedReadError::ResponseTooLarge);
            }

            run_database_stage(
                execution_guard
                    .database_mut()
                    .finish_read_only(execution.overall()),
                FixedReadStage::Finish,
                execution.overall(),
            )
            .await?;
            execution_guard.disarm_after_finish();
            Ok(FixedReadResultV1 {
                query: self.contract.query,
                parameter_values_digest: self.contract.parameter_values_digest,
                response_byte_length: response_row.len(),
                response_row,
                authority: FixedReadAuthorityClaimsV1::NONE,
            })
        }
        .await;

        let database_cancelled = matches!(
            outcome,
            Err(FixedReadError::Database {
                failure: FixedReadDatabaseFailure::Cancelled,
                ..
            })
        );
        let host_interrupted = matches!(
            outcome,
            Err(FixedReadError::Cancelled)
                | Err(FixedReadError::Database {
                    failure: FixedReadDatabaseFailure::TimedOut,
                    ..
                })
        );
        if !database_cancelled && !host_interrupted && outcome.is_err() {
            execution_guard.abort_only();
        }
        // Drop performs the single cleanup action after every raced stage future has left scope.
        drop(execution_guard);
        if database_cancelled {
            return Err(FixedReadError::Cancelled);
        }
        outcome
    }

    #[cfg(test)]
    fn has_been_consumed(&self) -> bool {
        self.state.load(Ordering::Acquire) != READY
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FixedReadCleanupDispositionV1 {
    Disarmed,
    AbortOnly,
    CancelThenAbort,
}

/// Owns the database session so dropping the outer `run` future can still perform local cleanup.
/// The in-flight stage future borrows `database` from this guard and is therefore dropped before the
/// guard itself, releasing the borrow before `Drop` invokes the nonblocking hooks.
struct FixedReadDatabaseExecutionGuardV1<D: FixedReadDatabaseSession> {
    database: D,
    disposition: FixedReadCleanupDispositionV1,
}

impl<D: FixedReadDatabaseSession> FixedReadDatabaseExecutionGuardV1<D> {
    fn new(database: D) -> Self {
        Self {
            database,
            disposition: FixedReadCleanupDispositionV1::Disarmed,
        }
    }

    fn database_mut(&mut self) -> &mut D {
        &mut self.database
    }

    fn arm_before_begin(&mut self) {
        debug_assert_eq!(self.disposition, FixedReadCleanupDispositionV1::Disarmed);
        self.disposition = FixedReadCleanupDispositionV1::CancelThenAbort;
    }

    fn abort_only(&mut self) {
        if self.disposition == FixedReadCleanupDispositionV1::CancelThenAbort {
            self.disposition = FixedReadCleanupDispositionV1::AbortOnly;
        }
    }

    fn disarm_after_finish(&mut self) {
        self.disposition = FixedReadCleanupDispositionV1::Disarmed;
    }
}

impl<D: FixedReadDatabaseSession> Drop for FixedReadDatabaseExecutionGuardV1<D> {
    fn drop(&mut self) {
        if self.disposition == FixedReadCleanupDispositionV1::CancelThenAbort {
            self.database.cancel_database_request();
        }
        if self.disposition != FixedReadCleanupDispositionV1::Disarmed {
            self.database.abort_read_only();
        }
        self.disposition = FixedReadCleanupDispositionV1::Disarmed;
    }
}

struct BurnAfterRun<'a> {
    state: &'a AtomicU8,
}

impl Drop for BurnAfterRun<'_> {
    fn drop(&mut self) {
        self.state.store(BURNED, Ordering::Release);
    }
}

async fn run_database_stage<T>(
    future: impl Future<Output = Result<T, FixedReadDatabaseFailure>>,
    stage: FixedReadStage,
    control: FixedReadStageControlV1<'_>,
) -> Result<T, FixedReadError> {
    match race_fixed_read_future(future, control).await {
        Ok(result) => result.map_err(|failure| FixedReadError::Database { stage, failure }),
        Err(interruption) => Err(interruption_error(stage, interruption)),
    }
}

pub(crate) fn interruption_error(
    stage: FixedReadStage,
    interruption: FixedReadInterruptionV1,
) -> FixedReadError {
    match interruption {
        FixedReadInterruptionV1::Cancelled => FixedReadError::Cancelled,
        FixedReadInterruptionV1::TimedOut => FixedReadError::Database {
            stage,
            failure: FixedReadDatabaseFailure::TimedOut,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicBool, AtomicU64, Ordering as AtomicOrdering},
        Arc, Barrier, Mutex,
    };
    use std::task::{Context, Wake};
    use std::thread;

    const CROSS_LANGUAGE_PARAMETER_VALUES_DIGEST: [u8; 32] = [
        0x15, 0x9f, 0x68, 0x7d, 0x38, 0xfa, 0x5c, 0x78, 0xed, 0xcd, 0x3a, 0xe0, 0x7f, 0x44, 0xbc,
        0xe4, 0x28, 0x91, 0x84, 0x6f, 0x90, 0xe5, 0x12, 0x95, 0x5b, 0x1c, 0x92, 0xb3, 0xa2, 0xc3,
        0xd0, 0x6b,
    ];

    #[derive(Clone, Debug, PartialEq, Eq)]
    enum Event {
        BeginReadOnly(FixedReadConnectionIdentityV1),
        SearchPathPgCatalog,
        StatementTimeout(u32),
        Prepare {
            query: FixedQueryIdentityV1,
            byte_length: usize,
            sha256: [u8; 32],
        },
        Execute(usize),
        ExecuteFutureDropped,
        Finish,
        Abort,
        Cancel,
    }

    #[derive(Debug, PartialEq, Eq)]
    struct FakePreparedStatement {
        query: FixedQueryIdentityV1,
        byte_length: usize,
        sha256: [u8; 32],
    }

    #[derive(Default)]
    struct Cancellation {
        cancelled: AtomicBool,
        now_milliseconds: AtomicU64,
        waiters: Mutex<Vec<Waker>>,
    }

    impl Cancellation {
        fn cancel(&self) {
            self.cancelled.store(true, AtomicOrdering::Release);
            self.wake_waiters();
        }

        fn advance(&self, duration: Duration) {
            self.now_milliseconds.fetch_add(
                u64::try_from(duration.as_millis()).expect("test duration fits in u64"),
                AtomicOrdering::AcqRel,
            );
            self.wake_waiters();
        }

        fn wake_waiters(&self) {
            let waiters = std::mem::take(&mut *self.waiters.lock().expect("waiter lock"));
            for waiter in waiters {
                waiter.wake();
            }
        }
    }

    impl fixed_read_interrupt_source::Sealed for Cancellation {}

    impl FixedReadInterruptSourceV1 for Cancellation {
        fn now(&self) -> Duration {
            Duration::from_millis(self.now_milliseconds.load(AtomicOrdering::Acquire))
        }

        fn is_cancelled(&self) -> bool {
            self.cancelled.load(AtomicOrdering::Acquire)
        }

        fn register_interrupt_waker(&self, deadline: FixedReadDeadlineV1, waker: &Waker) {
            if self.is_cancelled() || self.now() >= deadline.monotonic_offset() {
                waker.wake_by_ref();
                return;
            }
            let mut waiters = self.waiters.lock().expect("waiter lock");
            if self.is_cancelled() || self.now() >= deadline.monotonic_offset() {
                drop(waiters);
                waker.wake_by_ref();
                return;
            }
            if !waiters.iter().any(|waiter| waiter.will_wake(waker)) {
                waiters.push(waker.clone());
            }
        }
    }

    struct ThreadWake(thread::Thread);

    impl Wake for ThreadWake {
        fn wake(self: Arc<Self>) {
            self.0.unpark();
        }

        fn wake_by_ref(self: &Arc<Self>) {
            self.0.unpark();
        }
    }

    fn block_on<F: Future>(future: F) -> F::Output {
        let waker = Waker::from(Arc::new(ThreadWake(thread::current())));
        let mut context = Context::from_waker(&waker);
        let mut future = pin!(future);
        loop {
            match future.as_mut().poll(&mut context) {
                Poll::Ready(value) => return value,
                Poll::Pending => thread::park(),
            }
        }
    }

    fn assert_send<T: Send>(_: &T) {}

    fn run_session<D: FixedReadDatabaseSession>(
        session: &ReceiptZeroFixedReadSessionV1,
        database: D,
        interrupts: &Cancellation,
    ) -> Result<FixedReadResultV1, FixedReadError> {
        let execution =
            FixedReadExecutionControlV1::start(interrupts).expect("test execution control");
        block_on(session.run(database, &connection_identity(), &execution))
    }

    struct FakeDatabase {
        events: Arc<Mutex<Vec<Event>>>,
        fail_at: Option<FixedReadStage>,
        rows: Vec<Vec<u8>>,
        cancel_during_execute: Option<Arc<Cancellation>>,
        pending_execute: Option<Arc<Barrier>>,
    }

    impl FakeDatabase {
        fn successful(response: &[u8]) -> Self {
            Self {
                events: Arc::new(Mutex::new(Vec::new())),
                fail_at: None,
                rows: vec![response.to_vec()],
                cancel_during_execute: None,
                pending_execute: None,
            }
        }

        fn record(&self, event: Event) {
            self.events.lock().expect("event lock").push(event);
        }

        fn stage(&self, stage: FixedReadStage) -> Result<(), FixedReadDatabaseFailure> {
            if self.fail_at == Some(stage) {
                Err(FixedReadDatabaseFailure::Rejected)
            } else {
                Ok(())
            }
        }
    }

    struct PendingExecuteDropEvent {
        events: Arc<Mutex<Vec<Event>>>,
    }

    impl Drop for PendingExecuteDropEvent {
        fn drop(&mut self) {
            self.events
                .lock()
                .expect("event lock")
                .push(Event::ExecuteFutureDropped);
        }
    }

    impl FixedReadDatabaseSession for FakeDatabase {
        type PreparedStatement = FakePreparedStatement;

        async fn begin_read_only(
            &mut self,
            connection_identity: &FixedReadConnectionIdentityV1,
            _control: FixedReadStageControlV1<'_>,
        ) -> Result<(), FixedReadDatabaseFailure> {
            self.record(Event::BeginReadOnly(connection_identity.clone()));
            self.stage(FixedReadStage::BeginReadOnly)
        }

        async fn set_local_search_path_pg_catalog(
            &mut self,
            _control: FixedReadStageControlV1<'_>,
        ) -> Result<(), FixedReadDatabaseFailure> {
            self.record(Event::SearchPathPgCatalog);
            self.stage(FixedReadStage::SearchPath)
        }

        async fn set_local_statement_timeout_ms(
            &mut self,
            milliseconds: u32,
            _control: FixedReadStageControlV1<'_>,
        ) -> Result<(), FixedReadDatabaseFailure> {
            self.record(Event::StatementTimeout(milliseconds));
            self.stage(FixedReadStage::StatementTimeout)
        }

        async fn prepare_fixed_statement(
            &mut self,
            statement: &FixedReadStatementArtifactV1,
            _control: FixedReadStageControlV1<'_>,
        ) -> Result<Self::PreparedStatement, FixedReadDatabaseFailure> {
            assert_eq!(statement.source(), RECEIPT_ZERO_QUERY_SOURCE);
            assert_eq!(
                statement.source().as_bytes(),
                RECEIPT_ZERO_QUERY_SOURCE.as_bytes()
            );
            self.record(Event::Prepare {
                query: *statement.query(),
                byte_length: statement.byte_length(),
                sha256: statement.sha256(),
            });
            self.stage(FixedReadStage::Prepare)?;
            Ok(FakePreparedStatement {
                query: *statement.query(),
                byte_length: statement.byte_length(),
                sha256: statement.sha256(),
            })
        }

        async fn execute_prepared(
            &mut self,
            statement: Self::PreparedStatement,
            parameters: &[FixedReadBoundParameter],
            response_limits: FixedReadResponseLimitsV1,
            _control: FixedReadStageControlV1<'_>,
        ) -> Result<Vec<Vec<u8>>, FixedReadDatabaseFailure> {
            assert_eq!(statement.query, RECEIPT_ZERO_QUERY_IDENTITY_V1);
            assert_eq!(statement.byte_length, RECEIPT_ZERO_QUERY_BYTE_LENGTH);
            assert_eq!(statement.sha256, RECEIPT_ZERO_QUERY_SHA256);
            assert_eq!(response_limits, FIXED_RESPONSE_LIMITS);
            assert_eq!(response_limits.maximum_rows(), 1);
            assert_eq!(response_limits.maximum_bytes(), MAXIMUM_RESPONSE_BYTES);
            self.record(Event::Execute(parameters.len()));
            if let Some(entered) = &self.pending_execute {
                let _drop_event = PendingExecuteDropEvent {
                    events: Arc::clone(&self.events),
                };
                entered.wait();
                std::future::pending::<()>().await;
                unreachable!("pending execute future resumed without outer drop");
            }
            if let Some(cancellation) = &self.cancel_during_execute {
                cancellation.cancel();
            }
            self.stage(FixedReadStage::Execute)?;
            Ok(self.rows.clone())
        }

        async fn finish_read_only(
            &mut self,
            _control: FixedReadStageControlV1<'_>,
        ) -> Result<(), FixedReadDatabaseFailure> {
            self.record(Event::Finish);
            self.stage(FixedReadStage::Finish)
        }

        fn abort_read_only(&mut self) {
            self.record(Event::Abort);
        }

        fn cancel_database_request(&mut self) {
            self.record(Event::Cancel);
        }
    }

    fn parameters() -> Vec<FixedReadParameterValue> {
        (0..RECEIPT_ZERO_PARAMETER_COUNT)
            .map(|index| match index {
                13 => FixedReadParameterValue::Null,
                _ => FixedReadParameterValue::Text(format!("value-{index}")),
            })
            .collect()
    }

    fn cross_language_parameters() -> Vec<FixedReadParameterValue> {
        let mut values = parameters();
        values[0] = FixedReadParameterValue::Text("quote\" slash\\ newline\n雪\u{2028}".to_owned());
        values
    }

    fn parameter_values_digest(values: &[FixedReadParameterValue]) -> [u8; 32] {
        <[u8; 32]>::from(Sha256::digest(
            canonical_parameter_values_bytes(values).expect("canonical parameter values"),
        ))
    }

    fn contract() -> ReceiptZeroFixedReadContractV1 {
        let values = parameters();
        ReceiptZeroFixedReadContractV1::checked(
            RECEIPT_ZERO_SQL_DIGEST,
            RECEIPT_ZERO_QUERY_DIGEST,
            RECEIPT_ZERO_QUERY_CONTRACT_DIGEST,
            RECEIPT_ZERO_PARAMETER_ORDER_DIGEST,
            RECEIPT_ZERO_RESPONSE_FIELDS_DIGEST,
            parameter_values_digest(&values),
            values,
        )
        .expect("valid fixed contract")
    }

    fn connection_identity() -> FixedReadConnectionIdentityV1 {
        FixedReadConnectionIdentityV1::checked(
            "abcdefghijklmnopqrst".to_owned(),
            "host-account-a".to_owned(),
            "12345678-1234-4abc-8abc-1234567890ab".to_owned(),
            [9; 32],
            [10; 32],
        )
        .expect("valid fixed-read connection identity")
    }

    #[test]
    fn connection_identity_is_bounded_dormant_metadata_not_credential_authority() {
        let identity = connection_identity();
        assert_eq!(identity.project_ref(), "abcdefghijklmnopqrst");
        assert_eq!(identity.account_id(), "host-account-a");
        assert_eq!(
            identity.grant_generation(),
            "12345678-1234-4abc-8abc-1234567890ab"
        );
        assert_eq!(identity.read_credential_incarnation(), [9; 32]);
        assert_eq!(identity.connection_profile_digest(), [10; 32]);
        let debug = format!("{identity:?}");
        assert!(debug.contains("<redacted>"));
        assert!(!debug.contains("abcdefghijklmnopqrst"));
        assert!(!debug.contains("host-account-a"));
        assert!(!debug.contains("12345678-1234-4abc-8abc-1234567890ab"));

        for (project_ref, account_id, grant_generation, incarnation, profile_digest) in [
            (
                "short".to_owned(),
                "host-account-a".to_owned(),
                "12345678-1234-4abc-8abc-1234567890ab".to_owned(),
                [9; 32],
                [10; 32],
            ),
            (
                "abcdefghijklmnopqrst".to_owned(),
                "-invalid-account".to_owned(),
                "12345678-1234-4abc-8abc-1234567890ab".to_owned(),
                [9; 32],
                [10; 32],
            ),
            (
                "abcdefghijklmnopqrst".to_owned(),
                "host-account-a".to_owned(),
                "grant-7".to_owned(),
                [9; 32],
                [10; 32],
            ),
            (
                "abcdefghijklmnopqrst".to_owned(),
                "host-account-a".to_owned(),
                "12345678-1234-4abc-8abc-1234567890ab".to_owned(),
                [0; 32],
                [10; 32],
            ),
            (
                "abcdefghijklmnopqrst".to_owned(),
                "host-account-a".to_owned(),
                "12345678-1234-4abc-8abc-1234567890ab".to_owned(),
                [9; 32],
                [0; 32],
            ),
        ] {
            assert_eq!(
                FixedReadConnectionIdentityV1::checked(
                    project_ref,
                    account_id,
                    grant_generation,
                    incarnation,
                    profile_digest,
                ),
                Err(FixedReadError::InvalidContract)
            );
        }
    }

    #[test]
    fn unicode_and_escape_parameter_vector_matches_the_typescript_canonical_digest() {
        let values = cross_language_parameters();
        let canonical = canonical_parameter_values_bytes(&values).expect("canonical envelope");
        assert_eq!(canonical.len(), 1_010);
        assert_eq!(
            <[u8; 32]>::from(Sha256::digest(&canonical)),
            CROSS_LANGUAGE_PARAMETER_VALUES_DIGEST
        );
        let canonical = String::from_utf8(canonical).expect("canonical UTF-8 JSON");
        assert!(canonical.starts_with(
            "{\"format\":\"openpencil.supabase-backfill-receipt-zero-cas-parameters.v1\",\"order\":"
        ));
        assert!(canonical.contains(r#"quote\" slash\\ newline\n雪"#));
        assert!(canonical.contains('\u{2028}'));
        assert!(canonical.ends_with("],\"version\":1}"));
        assert_eq!(
            ReceiptZeroFixedReadContractV1::checked(
                RECEIPT_ZERO_SQL_DIGEST,
                RECEIPT_ZERO_QUERY_DIGEST,
                RECEIPT_ZERO_QUERY_CONTRACT_DIGEST,
                RECEIPT_ZERO_PARAMETER_ORDER_DIGEST,
                RECEIPT_ZERO_RESPONSE_FIELDS_DIGEST,
                CROSS_LANGUAGE_PARAMETER_VALUES_DIGEST,
                values,
            )
            .expect_err("control character must fail before execution"),
            FixedReadError::InvalidContract
        );
    }

    #[test]
    fn rejects_any_parameter_tamper_against_the_original_values_digest() {
        let mut tampered = parameters();
        let original_digest = parameter_values_digest(&tampered);
        tampered[7] = FixedReadParameterValue::Text("tampered-source-ledger".to_owned());
        assert_eq!(
            ReceiptZeroFixedReadContractV1::checked(
                RECEIPT_ZERO_SQL_DIGEST,
                RECEIPT_ZERO_QUERY_DIGEST,
                RECEIPT_ZERO_QUERY_CONTRACT_DIGEST,
                RECEIPT_ZERO_PARAMETER_ORDER_DIGEST,
                RECEIPT_ZERO_RESPONSE_FIELDS_DIGEST,
                original_digest,
                tampered,
            )
            .expect_err("tampered parameter value"),
            FixedReadError::InvalidContract
        );
        assert_eq!(
            ReceiptZeroFixedReadContractV1::checked(
                RECEIPT_ZERO_SQL_DIGEST,
                RECEIPT_ZERO_QUERY_DIGEST,
                RECEIPT_ZERO_QUERY_CONTRACT_DIGEST,
                RECEIPT_ZERO_PARAMETER_ORDER_DIGEST,
                RECEIPT_ZERO_RESPONSE_FIELDS_DIGEST,
                [0; 32],
                parameters(),
            )
            .expect_err("unset parameter values digest"),
            FixedReadError::InvalidContract
        );
    }

    #[test]
    fn rejects_unset_digests_and_every_non_exact_parameter_count() {
        assert_eq!(
            ReceiptZeroFixedReadContractV1::checked(
                "wrong",
                RECEIPT_ZERO_QUERY_DIGEST,
                RECEIPT_ZERO_QUERY_CONTRACT_DIGEST,
                RECEIPT_ZERO_PARAMETER_ORDER_DIGEST,
                RECEIPT_ZERO_RESPONSE_FIELDS_DIGEST,
                CROSS_LANGUAGE_PARAMETER_VALUES_DIGEST,
                parameters(),
            )
            .expect_err("wrong SQL digest"),
            FixedReadError::InvalidContract
        );
        assert_eq!(
            ReceiptZeroFixedReadContractV1::checked(
                RECEIPT_ZERO_SQL_DIGEST,
                "wrong",
                RECEIPT_ZERO_QUERY_CONTRACT_DIGEST,
                RECEIPT_ZERO_PARAMETER_ORDER_DIGEST,
                RECEIPT_ZERO_RESPONSE_FIELDS_DIGEST,
                CROSS_LANGUAGE_PARAMETER_VALUES_DIGEST,
                parameters(),
            )
            .expect_err("wrong query digest"),
            FixedReadError::InvalidContract
        );
        for count in [0, 27, 29, 256] {
            assert_eq!(
                ReceiptZeroFixedReadContractV1::checked(
                    RECEIPT_ZERO_SQL_DIGEST,
                    RECEIPT_ZERO_QUERY_DIGEST,
                    RECEIPT_ZERO_QUERY_CONTRACT_DIGEST,
                    RECEIPT_ZERO_PARAMETER_ORDER_DIGEST,
                    RECEIPT_ZERO_RESPONSE_FIELDS_DIGEST,
                    CROSS_LANGUAGE_PARAMETER_VALUES_DIGEST,
                    vec![FixedReadParameterValue::Null; count],
                )
                .expect_err("invalid parameter count"),
                FixedReadError::InvalidContract
            );
        }

        let mut exact_string_boundary = vec![FixedReadParameterValue::Null; 28];
        exact_string_boundary[0] =
            FixedReadParameterValue::Text("x".repeat(MAXIMUM_PARAMETER_STRING_BYTES));
        assert!(ReceiptZeroFixedReadContractV1::checked(
            RECEIPT_ZERO_SQL_DIGEST,
            RECEIPT_ZERO_QUERY_DIGEST,
            RECEIPT_ZERO_QUERY_CONTRACT_DIGEST,
            RECEIPT_ZERO_PARAMETER_ORDER_DIGEST,
            RECEIPT_ZERO_RESPONSE_FIELDS_DIGEST,
            parameter_values_digest(&exact_string_boundary),
            exact_string_boundary,
        )
        .is_ok());
        let mut oversized_string = vec![FixedReadParameterValue::Null; 28];
        oversized_string[0] =
            FixedReadParameterValue::Text("x".repeat(MAXIMUM_PARAMETER_STRING_BYTES + 1));
        assert_eq!(
            ReceiptZeroFixedReadContractV1::checked(
                RECEIPT_ZERO_SQL_DIGEST,
                RECEIPT_ZERO_QUERY_DIGEST,
                RECEIPT_ZERO_QUERY_CONTRACT_DIGEST,
                RECEIPT_ZERO_PARAMETER_ORDER_DIGEST,
                RECEIPT_ZERO_RESPONSE_FIELDS_DIGEST,
                CROSS_LANGUAGE_PARAMETER_VALUES_DIGEST,
                oversized_string,
            )
            .expect_err("oversized individual parameter"),
            FixedReadError::InvalidContract
        );

        let mut exact_total_boundary = vec![FixedReadParameterValue::Null; 28];
        exact_total_boundary[0] =
            FixedReadParameterValue::Text("x".repeat(MAXIMUM_PARAMETER_STRING_BYTES));
        exact_total_boundary[1] =
            FixedReadParameterValue::Text("y".repeat(MAXIMUM_PARAMETER_STRING_BYTES));
        exact_total_boundary[2] =
            FixedReadParameterValue::Text("z".repeat(
                MAXIMUM_AGGREGATE_PARAMETER_VALUE_BYTES - 2 * MAXIMUM_PARAMETER_STRING_BYTES,
            ));
        assert!(ReceiptZeroFixedReadContractV1::checked(
            RECEIPT_ZERO_SQL_DIGEST,
            RECEIPT_ZERO_QUERY_DIGEST,
            RECEIPT_ZERO_QUERY_CONTRACT_DIGEST,
            RECEIPT_ZERO_PARAMETER_ORDER_DIGEST,
            RECEIPT_ZERO_RESPONSE_FIELDS_DIGEST,
            parameter_values_digest(&exact_total_boundary),
            exact_total_boundary,
        )
        .is_ok());

        let mut oversized_total = vec![FixedReadParameterValue::Null; 28];
        oversized_total[0] =
            FixedReadParameterValue::Text("x".repeat(MAXIMUM_PARAMETER_STRING_BYTES));
        oversized_total[1] =
            FixedReadParameterValue::Text("y".repeat(MAXIMUM_PARAMETER_STRING_BYTES));
        oversized_total[2] = FixedReadParameterValue::Text("z".repeat(
            MAXIMUM_AGGREGATE_PARAMETER_VALUE_BYTES - 2 * MAXIMUM_PARAMETER_STRING_BYTES + 1,
        ));
        assert_eq!(
            ReceiptZeroFixedReadContractV1::checked(
                RECEIPT_ZERO_SQL_DIGEST,
                RECEIPT_ZERO_QUERY_DIGEST,
                RECEIPT_ZERO_QUERY_CONTRACT_DIGEST,
                RECEIPT_ZERO_PARAMETER_ORDER_DIGEST,
                RECEIPT_ZERO_RESPONSE_FIELDS_DIGEST,
                CROSS_LANGUAGE_PARAMETER_VALUES_DIGEST,
                oversized_total,
            )
            .expect_err("oversized aggregate parameter values"),
            FixedReadError::InvalidContract
        );
    }

    #[test]
    fn executes_the_fixed_contract_after_all_session_guards() {
        let session = ReceiptZeroFixedReadSessionV1::new(contract());
        let database = FakeDatabase::successful(br#"{"state":"absent"}"#);
        let events = Arc::clone(&database.events);
        let result =
            run_session(&session, database, &Cancellation::default()).expect("fixed read result");

        assert_eq!(result.query.query_id(), RECEIPT_ZERO_QUERY_ID);
        assert_eq!(result.query.query_version(), RECEIPT_ZERO_QUERY_VERSION);
        assert_eq!(result.query.sql_digest(), RECEIPT_ZERO_SQL_DIGEST);
        assert_eq!(result.query.query_digest(), RECEIPT_ZERO_QUERY_DIGEST);
        assert_eq!(
            result.query.query_contract_digest(),
            RECEIPT_ZERO_QUERY_CONTRACT_DIGEST
        );
        assert_eq!(
            result.query.parameter_order_digest(),
            RECEIPT_ZERO_PARAMETER_ORDER_DIGEST
        );
        assert_eq!(
            result.query.response_fields_digest(),
            RECEIPT_ZERO_RESPONSE_FIELDS_DIGEST
        );
        assert_eq!(result.query.statement_count(), 1);
        assert_eq!(result.response_byte_length, result.response_row.len());
        assert_eq!(
            result.parameter_values_digest,
            FixedDigest(parameter_values_digest(&parameters()))
        );
        assert_eq!(result.authority, FixedReadAuthorityClaimsV1::NONE);
        assert!(session.has_been_consumed());
        assert_eq!(
            *events.lock().expect("event lock"),
            vec![
                Event::BeginReadOnly(connection_identity()),
                Event::SearchPathPgCatalog,
                Event::StatementTimeout(FIXED_STATEMENT_TIMEOUT_MS),
                Event::Prepare {
                    query: RECEIPT_ZERO_QUERY_IDENTITY_V1,
                    byte_length: RECEIPT_ZERO_QUERY_BYTE_LENGTH,
                    sha256: RECEIPT_ZERO_QUERY_SHA256,
                },
                Event::Execute(RECEIPT_ZERO_PARAMETER_COUNT),
                Event::Finish,
            ]
        );
        assert!(RECEIPT_ZERO_PARAMETER_ORDER
            .iter()
            .enumerate()
            .all(
                |(index, name)| session.contract.parameters[index].position() as usize == index + 1
                    && session.contract.parameters[index].name() == *name
                    && session.contract.parameters[index].value() == &parameters()[index]
            ));
    }

    #[test]
    fn all_result_authority_and_authentication_claims_are_false() {
        let session = ReceiptZeroFixedReadSessionV1::new(contract());
        let database = FakeDatabase::successful(b"{}");
        let result =
            run_session(&session, database, &Cancellation::default()).expect("fixed read result");
        let authority = result.authority;
        assert!(!authority.adapter_side_effects_authenticated);
        assert!(!authority.production_request_dispatch_authenticated);
        assert!(!authority.production_transport_created);
        assert!(!authority.production_transport_authenticated);
        assert!(!authority.dynamic_bindings_authenticated);
        assert!(!authority.read_only_boundary_authenticated);
        assert!(!authority.configured_search_path_authenticated);
        assert!(!authority.server_statement_timeout_authenticated);
        assert!(!authority.server_cancellation_authenticated);
        assert!(!authority.live_catalog_semantics_authenticated);
        assert!(!authority.single_statement_snapshot_authenticated);
        assert!(!authority.credential_authority_created);
        assert!(!authority.transport_authority_created);
        assert!(!authority.database_authority_created);
        assert!(!authority.mutation_authority_created);
        assert!(!authority.execution_authority_created);
        assert!(!authority.receipt_authority_created);
        assert!(!authority.release_authority_created);
        assert!(!authority.reconciliation_result_authenticated);
        assert!(!authority.response_snapshot_authenticated);
        assert!(!authority.release_ready);
    }

    #[test]
    fn consumes_before_executor_and_reentrant_runs_are_rejected() {
        struct ReentrantDatabase {
            session: Arc<ReceiptZeroFixedReadSessionV1>,
            nested: Arc<Mutex<Option<FixedReadError>>>,
            delegate: FakeDatabase,
        }

        impl FixedReadDatabaseSession for ReentrantDatabase {
            type PreparedStatement = FakePreparedStatement;

            async fn begin_read_only(
                &mut self,
                connection_identity: &FixedReadConnectionIdentityV1,
                control: FixedReadStageControlV1<'_>,
            ) -> Result<(), FixedReadDatabaseFailure> {
                assert!(self.session.has_been_consumed());
                let nested_database = FakeDatabase::successful(b"{}");
                let nested_interrupts = Cancellation::default();
                let nested_execution = FixedReadExecutionControlV1::start(&nested_interrupts)
                    .expect("nested execution control");
                let error = Box::pin(self.session.run(
                    nested_database,
                    connection_identity,
                    &nested_execution,
                ))
                .await
                .expect_err("reentrant run must fail");
                *self.nested.lock().expect("nested lock") = Some(error);
                self.delegate
                    .begin_read_only(connection_identity, control)
                    .await
            }

            async fn set_local_search_path_pg_catalog(
                &mut self,
                control: FixedReadStageControlV1<'_>,
            ) -> Result<(), FixedReadDatabaseFailure> {
                self.delegate
                    .set_local_search_path_pg_catalog(control)
                    .await
            }

            async fn set_local_statement_timeout_ms(
                &mut self,
                milliseconds: u32,
                control: FixedReadStageControlV1<'_>,
            ) -> Result<(), FixedReadDatabaseFailure> {
                self.delegate
                    .set_local_statement_timeout_ms(milliseconds, control)
                    .await
            }

            async fn prepare_fixed_statement(
                &mut self,
                statement: &FixedReadStatementArtifactV1,
                control: FixedReadStageControlV1<'_>,
            ) -> Result<Self::PreparedStatement, FixedReadDatabaseFailure> {
                self.delegate
                    .prepare_fixed_statement(statement, control)
                    .await
            }

            async fn execute_prepared(
                &mut self,
                statement: Self::PreparedStatement,
                parameters: &[FixedReadBoundParameter],
                response_limits: FixedReadResponseLimitsV1,
                control: FixedReadStageControlV1<'_>,
            ) -> Result<Vec<Vec<u8>>, FixedReadDatabaseFailure> {
                self.delegate
                    .execute_prepared(statement, parameters, response_limits, control)
                    .await
            }

            async fn finish_read_only(
                &mut self,
                control: FixedReadStageControlV1<'_>,
            ) -> Result<(), FixedReadDatabaseFailure> {
                self.delegate.finish_read_only(control).await
            }

            fn abort_read_only(&mut self) {
                self.delegate.abort_read_only();
            }

            fn cancel_database_request(&mut self) {
                self.delegate.cancel_database_request();
            }
        }

        let session = Arc::new(ReceiptZeroFixedReadSessionV1::new(contract()));
        let nested = Arc::new(Mutex::new(None));
        let database = ReentrantDatabase {
            session: Arc::clone(&session),
            nested: Arc::clone(&nested),
            delegate: FakeDatabase::successful(b"{}"),
        };
        run_session(&session, database, &Cancellation::default()).expect("outer run");
        assert_eq!(
            *nested.lock().expect("nested lock"),
            Some(FixedReadError::AlreadyConsumed)
        );
    }

    #[test]
    fn concurrent_second_run_is_rejected_while_the_first_is_in_executor() {
        struct BlockingDatabase {
            entered: Arc<Barrier>,
            release: Arc<Barrier>,
            delegate: FakeDatabase,
        }

        impl FixedReadDatabaseSession for BlockingDatabase {
            type PreparedStatement = FakePreparedStatement;

            async fn begin_read_only(
                &mut self,
                connection_identity: &FixedReadConnectionIdentityV1,
                control: FixedReadStageControlV1<'_>,
            ) -> Result<(), FixedReadDatabaseFailure> {
                self.entered.wait();
                self.release.wait();
                self.delegate
                    .begin_read_only(connection_identity, control)
                    .await
            }
            async fn set_local_search_path_pg_catalog(
                &mut self,
                control: FixedReadStageControlV1<'_>,
            ) -> Result<(), FixedReadDatabaseFailure> {
                self.delegate
                    .set_local_search_path_pg_catalog(control)
                    .await
            }
            async fn set_local_statement_timeout_ms(
                &mut self,
                milliseconds: u32,
                control: FixedReadStageControlV1<'_>,
            ) -> Result<(), FixedReadDatabaseFailure> {
                self.delegate
                    .set_local_statement_timeout_ms(milliseconds, control)
                    .await
            }
            async fn prepare_fixed_statement(
                &mut self,
                statement: &FixedReadStatementArtifactV1,
                control: FixedReadStageControlV1<'_>,
            ) -> Result<Self::PreparedStatement, FixedReadDatabaseFailure> {
                self.delegate
                    .prepare_fixed_statement(statement, control)
                    .await
            }
            async fn execute_prepared(
                &mut self,
                statement: Self::PreparedStatement,
                parameters: &[FixedReadBoundParameter],
                response_limits: FixedReadResponseLimitsV1,
                control: FixedReadStageControlV1<'_>,
            ) -> Result<Vec<Vec<u8>>, FixedReadDatabaseFailure> {
                self.delegate
                    .execute_prepared(statement, parameters, response_limits, control)
                    .await
            }
            async fn finish_read_only(
                &mut self,
                control: FixedReadStageControlV1<'_>,
            ) -> Result<(), FixedReadDatabaseFailure> {
                self.delegate.finish_read_only(control).await
            }
            fn abort_read_only(&mut self) {
                self.delegate.abort_read_only();
            }
            fn cancel_database_request(&mut self) {
                self.delegate.cancel_database_request();
            }
        }

        let session = Arc::new(ReceiptZeroFixedReadSessionV1::new(contract()));
        let entered = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));
        let worker_session = Arc::clone(&session);
        let worker_entered = Arc::clone(&entered);
        let worker_release = Arc::clone(&release);
        let worker = thread::spawn(move || {
            let database = BlockingDatabase {
                entered: worker_entered,
                release: worker_release,
                delegate: FakeDatabase::successful(b"{}"),
            };
            run_session(worker_session.as_ref(), database, &Cancellation::default())
        });

        entered.wait();
        let second_database = FakeDatabase::successful(b"{}");
        let second_events = Arc::clone(&second_database.events);
        assert_eq!(
            run_session(&session, second_database, &Cancellation::default())
                .expect_err("second run"),
            FixedReadError::AlreadyConsumed
        );
        assert!(second_events.lock().expect("event lock").is_empty());
        release.wait();
        worker.join().expect("worker join").expect("first run");
    }

    #[test]
    fn every_database_failure_burns_and_conservatively_aborts_once_begin_is_polled() {
        for stage in [
            FixedReadStage::BeginReadOnly,
            FixedReadStage::SearchPath,
            FixedReadStage::StatementTimeout,
            FixedReadStage::Prepare,
            FixedReadStage::Execute,
            FixedReadStage::Finish,
        ] {
            let session = ReceiptZeroFixedReadSessionV1::new(contract());
            let mut database = FakeDatabase::successful(b"{}");
            database.fail_at = Some(stage);
            let events = Arc::clone(&database.events);
            assert_eq!(
                run_session(&session, database, &Cancellation::default()),
                Err(FixedReadError::Database {
                    stage,
                    failure: FixedReadDatabaseFailure::Rejected,
                })
            );
            assert!(session.has_been_consumed());
            let retry_database = FakeDatabase::successful(b"{}");
            assert_eq!(
                run_session(&session, retry_database, &Cancellation::default()),
                Err(FixedReadError::AlreadyConsumed)
            );
            assert_eq!(
                events.lock().expect("event lock").last(),
                Some(&Event::Abort)
            );
        }
    }

    #[test]
    fn cancellation_burns_cancels_aborts_and_never_returns_a_result() {
        let session = ReceiptZeroFixedReadSessionV1::new(contract());
        let cancellation = Arc::new(Cancellation::default());
        let mut database = FakeDatabase::successful(b"{}");
        database.cancel_during_execute = Some(Arc::clone(&cancellation));
        let events = Arc::clone(&database.events);
        assert_eq!(
            run_session(&session, database, cancellation.as_ref()),
            Err(FixedReadError::Cancelled)
        );
        assert!(session.has_been_consumed());
        assert_eq!(
            events.lock().expect("event lock").as_slice(),
            [
                Event::BeginReadOnly(connection_identity()),
                Event::SearchPathPgCatalog,
                Event::StatementTimeout(FIXED_STATEMENT_TIMEOUT_MS),
                Event::Prepare {
                    query: session.contract.query,
                    byte_length: RECEIPT_ZERO_QUERY_BYTE_LENGTH,
                    sha256: RECEIPT_ZERO_QUERY_SHA256,
                },
                Event::Execute(RECEIPT_ZERO_PARAMETER_COUNT),
                Event::Cancel,
                Event::Abort,
            ]
        );
    }

    #[test]
    fn dropping_pending_outer_run_drops_stage_then_cancels_aborts_and_burns() {
        let session = ReceiptZeroFixedReadSessionV1::new(contract());
        let interrupts = Cancellation::default();
        let execution = FixedReadExecutionControlV1::start(&interrupts).expect("execution control");
        let entered = Arc::new(Barrier::new(2));
        let mut database = FakeDatabase::successful(b"{}");
        database.pending_execute = Some(Arc::clone(&entered));
        let events = Arc::clone(&database.events);
        let identity = connection_identity();
        let poll_entered = Arc::clone(&entered);
        let waiter = thread::spawn(move || poll_entered.wait());
        let mut future = Box::pin(session.run(database, &identity, &execution));
        assert_send(&future);
        let waker = Waker::from(Arc::new(ThreadWake(thread::current())));
        let mut context = Context::from_waker(&waker);

        assert!(matches!(future.as_mut().poll(&mut context), Poll::Pending));
        waiter.join().expect("pending-stage waiter");
        drop(future);

        assert!(session.has_been_consumed());
        assert_eq!(
            events.lock().expect("event lock").as_slice(),
            [
                Event::BeginReadOnly(connection_identity()),
                Event::SearchPathPgCatalog,
                Event::StatementTimeout(FIXED_STATEMENT_TIMEOUT_MS),
                Event::Prepare {
                    query: RECEIPT_ZERO_QUERY_IDENTITY_V1,
                    byte_length: RECEIPT_ZERO_QUERY_BYTE_LENGTH,
                    sha256: RECEIPT_ZERO_QUERY_SHA256,
                },
                Event::Execute(RECEIPT_ZERO_PARAMETER_COUNT),
                Event::ExecuteFutureDropped,
                Event::Cancel,
                Event::Abort,
            ]
        );
    }

    #[test]
    fn row_count_and_response_byte_limits_fail_closed_and_burn() {
        for rows in [Vec::new(), vec![b"{}".to_vec(), b"{}".to_vec()]] {
            let session = ReceiptZeroFixedReadSessionV1::new(contract());
            let mut database = FakeDatabase::successful(b"{}");
            database.rows = rows;
            assert_eq!(
                run_session(&session, database, &Cancellation::default()),
                Err(FixedReadError::InvalidRowCount)
            );
            assert!(session.has_been_consumed());
        }

        let session = ReceiptZeroFixedReadSessionV1::new(contract());
        let database = FakeDatabase::successful(b"");
        assert_eq!(
            run_session(&session, database, &Cancellation::default()),
            Err(FixedReadError::EmptyResponse)
        );
        assert!(session.has_been_consumed());

        let session = ReceiptZeroFixedReadSessionV1::new(contract());
        let database = FakeDatabase::successful(&vec![0; MAXIMUM_RESPONSE_BYTES + 1]);
        assert_eq!(
            run_session(&session, database, &Cancellation::default()),
            Err(FixedReadError::ResponseTooLarge)
        );
        assert!(session.has_been_consumed());
    }

    #[test]
    fn database_reported_cancellation_invokes_cancel_and_returns_no_result() {
        let session = ReceiptZeroFixedReadSessionV1::new(contract());
        let mut database = FakeDatabase::successful(b"{}");
        database.fail_at = Some(FixedReadStage::Execute);

        struct CancelledDatabase(FakeDatabase);
        impl FixedReadDatabaseSession for CancelledDatabase {
            type PreparedStatement = FakePreparedStatement;

            async fn begin_read_only(
                &mut self,
                connection_identity: &FixedReadConnectionIdentityV1,
                control: FixedReadStageControlV1<'_>,
            ) -> Result<(), FixedReadDatabaseFailure> {
                self.0.begin_read_only(connection_identity, control).await
            }
            async fn set_local_search_path_pg_catalog(
                &mut self,
                control: FixedReadStageControlV1<'_>,
            ) -> Result<(), FixedReadDatabaseFailure> {
                self.0.set_local_search_path_pg_catalog(control).await
            }
            async fn set_local_statement_timeout_ms(
                &mut self,
                milliseconds: u32,
                control: FixedReadStageControlV1<'_>,
            ) -> Result<(), FixedReadDatabaseFailure> {
                self.0
                    .set_local_statement_timeout_ms(milliseconds, control)
                    .await
            }
            async fn prepare_fixed_statement(
                &mut self,
                statement: &FixedReadStatementArtifactV1,
                control: FixedReadStageControlV1<'_>,
            ) -> Result<Self::PreparedStatement, FixedReadDatabaseFailure> {
                self.0.prepare_fixed_statement(statement, control).await
            }
            async fn execute_prepared(
                &mut self,
                statement: Self::PreparedStatement,
                parameters: &[FixedReadBoundParameter],
                response_limits: FixedReadResponseLimitsV1,
                _control: FixedReadStageControlV1<'_>,
            ) -> Result<Vec<Vec<u8>>, FixedReadDatabaseFailure> {
                assert_eq!(statement.query, RECEIPT_ZERO_QUERY_IDENTITY_V1);
                assert_eq!(response_limits, FIXED_RESPONSE_LIMITS);
                self.0.record(Event::Execute(parameters.len()));
                Err(FixedReadDatabaseFailure::Cancelled)
            }
            async fn finish_read_only(
                &mut self,
                control: FixedReadStageControlV1<'_>,
            ) -> Result<(), FixedReadDatabaseFailure> {
                self.0.finish_read_only(control).await
            }
            fn abort_read_only(&mut self) {
                self.0.abort_read_only();
            }
            fn cancel_database_request(&mut self) {
                self.0.cancel_database_request();
            }
        }

        let events = Arc::clone(&database.events);
        let database = CancelledDatabase(database);
        assert_eq!(
            run_session(&session, database, &Cancellation::default()),
            Err(FixedReadError::Cancelled)
        );
        let events = events.lock().expect("event lock");
        assert!(events.contains(&Event::Cancel));
        assert!(events.contains(&Event::Abort));
    }

    #[test]
    fn source_contract_contains_no_network_or_secret_authority_fields() {
        let source = include_str!("supabase_backfill_fixed_read.rs");
        let production_source = source
            .split_once("#[cfg(test)]\nmod tests")
            .expect("test module boundary")
            .0;
        let forbidden = [
            ["raw", "sql"].join("_"),
            ['d', 's', 'n'].into_iter().collect(),
            ["connection", "string"].join("_"),
            ["personal", "access", "token"].join("_"),
            ["service", "role"].join("_"),
            ["endpoint", "override"].join("_"),
            ["credential", "override"].join("_"),
        ];
        for forbidden in forbidden {
            assert!(!source.contains(&forbidden), "forbidden field: {forbidden}");
        }
        let database_trait = production_source
            .split_once("trait FixedReadDatabaseSession: Send")
            .expect("send database trait")
            .1
            .split_once("pub(crate) struct FixedReadResponseLimitsV1")
            .expect("response limits boundary")
            .0;
        assert!(database_trait.contains("type PreparedStatement: Send;"));
        assert_eq!(database_trait.matches("-> impl Future").count(), 6);
        assert_eq!(database_trait.matches("+ Send + 'a").count(), 6);
        assert!(!database_trait.contains("async fn"));
    }

    #[test]
    fn shared_query_artifact_has_the_pinned_bytes_digest_and_one_statement() {
        assert_eq!(
            RECEIPT_ZERO_QUERY_SOURCE.len(),
            RECEIPT_ZERO_QUERY_BYTE_LENGTH
        );
        assert_eq!(
            <[u8; 32]>::from(Sha256::digest(RECEIPT_ZERO_QUERY_SOURCE.as_bytes())),
            RECEIPT_ZERO_QUERY_SHA256
        );
        assert_eq!(RECEIPT_ZERO_QUERY_SOURCE.matches(';').count(), 1);
        assert!(RECEIPT_ZERO_QUERY_SOURCE.ends_with(";\n"));
    }
}
