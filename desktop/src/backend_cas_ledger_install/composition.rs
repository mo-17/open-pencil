//! Testing-only fixed CAS-ledger installation followed by an independent catalog readback.
//!
//! This module deliberately has no production constructor, credential resolver, HTTP/Postgres
//! adapter, Tauri command, Receipt issuer, retry path, or release authority. Its sealed connector
//! exists only to prove the ordering and cancellation contract before any live adapter is reviewed.

mod parser;

use super::{
    fixed_verification_query_digest, fixed_verification_sql, rendered_install_sql,
    BackendCasLedgerInstallErrorV1, DurableCasLedgerInstallClaimHandleV1,
    DurableCasLedgerInstalledProofV1, CAS_LEDGER_VERIFICATION_QUERY_DIGEST,
    CAS_LEDGER_VERIFICATION_QUERY_ID, CAS_LEDGER_VERIFICATION_QUERY_VERSION,
};
use crate::backend_operation_journal::CAS_LEDGER_INSTALL_SETTLEMENT_CAPABILITY_TTL;
use parser::{parse_fixed_verification_response, RawQueryResponseV1};
use std::{
    future::{poll_fn, Future},
    pin::pin,
    task::{Poll, Waker},
    time::Duration,
};

const OVERALL_TIMEOUT: Duration = Duration::from_secs(25);
const STATEMENT_TIMEOUT_MS: u32 = 15_000;
const MAXIMUM_INSTALL_SQL_BYTES: usize = 1024 * 1024;
const MAXIMUM_INSTALL_RESPONSE_BYTES: usize = 64 * 1024;
const MAXIMUM_VERIFICATION_RESPONSE_BYTES: usize = 512 * 1024;

const _: () =
    assert!(OVERALL_TIMEOUT.as_secs() < CAS_LEDGER_INSTALL_SETTLEMENT_CAPABILITY_TTL.as_secs());

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DatabaseFailureV1 {
    Unavailable,
    Rejected,
    Cancelled,
    TimedOut,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CompositionStageV1 {
    WriteConnect,
    WriteProjectAuthority,
    ApplyMigration,
    ReadConnect,
    ReadProjectAuthority,
    BeginReadOnly,
    SearchPath,
    RowSecurity,
    StatementTimeout,
    PrepareVerification,
    ExecuteVerification,
    FinishVerification,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CompositionErrorV1 {
    FixedArtifactRejected,
    DeadlineUnavailable,
    Journal(BackendCasLedgerInstallErrorV1),
    Database {
        stage: CompositionStageV1,
        failure: DatabaseFailureV1,
    },
    AuthorityMismatch,
    MigrationResponseInvalid,
    VerificationResponseInvalid,
}

#[derive(Clone, Copy)]
struct StageControlV1<'a> {
    deadline: Duration,
    interrupts: &'a dyn InterruptSourceV1,
}

impl StageControlV1<'_> {
    fn current_interruption(&self) -> Option<DatabaseFailureV1> {
        if self.interrupts.is_cancelled() {
            Some(DatabaseFailureV1::Cancelled)
        } else if self.interrupts.now() >= self.deadline {
            Some(DatabaseFailureV1::TimedOut)
        } else {
            None
        }
    }
}

trait InterruptSourceV1: Sync {
    fn now(&self) -> Duration;
    fn is_cancelled(&self) -> bool;
    fn register_waker(&self, deadline: Duration, waker: &Waker);
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct DatabaseAuthorityBindingV1 {
    project_ref: String,
    account_id: String,
    grant_generation: String,
    read_only: bool,
}

#[derive(Debug, PartialEq, Eq)]
struct ObservedProjectAuthorityV1 {
    project_ref: String,
    account_id: String,
    grant_generation: String,
    read_only: bool,
}

#[derive(Debug, PartialEq, Eq)]
struct FixedInstallArtifactV1 {
    sql: String,
    sql_digest: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct InstallLimitsV1 {
    overall_timeout: Duration,
    maximum_sql_bytes: usize,
    maximum_response_bytes: usize,
    self_transactional_batch: bool,
    prepare_forbidden: bool,
}

const INSTALL_LIMITS: InstallLimitsV1 = InstallLimitsV1 {
    overall_timeout: OVERALL_TIMEOUT,
    maximum_sql_bytes: MAXIMUM_INSTALL_SQL_BYTES,
    maximum_response_bytes: MAXIMUM_INSTALL_RESPONSE_BYTES,
    self_transactional_batch: true,
    prepare_forbidden: true,
};

#[derive(Debug, PartialEq, Eq)]
struct RawMigrationResponseV1 {
    body: Vec<u8>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct VerificationLimitsV1 {
    overall_timeout: Duration,
    statement_timeout_ms: u32,
    maximum_rows: u8,
    maximum_columns: u8,
    maximum_response_bytes: usize,
    access_mode: &'static str,
    search_path: &'static str,
}

const VERIFICATION_LIMITS: VerificationLimitsV1 = VerificationLimitsV1 {
    overall_timeout: OVERALL_TIMEOUT,
    statement_timeout_ms: STATEMENT_TIMEOUT_MS,
    maximum_rows: 1,
    maximum_columns: 18,
    maximum_response_bytes: MAXIMUM_VERIFICATION_RESPONSE_BYTES,
    access_mode: "read-only",
    search_path: "pg_catalog, public",
};

#[derive(Debug, PartialEq, Eq)]
struct FixedVerificationArtifactV1 {
    query_id: &'static str,
    query_version: &'static str,
    query_digest: String,
    sql: &'static str,
}

#[derive(Debug, PartialEq, Eq)]
struct VerificationParametersV1 {
    values: [String; 9],
}

mod sealed {
    pub(super) trait ConnectorV1 {}
}

trait DatabaseConnectorV1: sealed::ConnectorV1 + Send {
    type WriteSession: WriteSessionV1;
    type ReadSession: ReadSessionV1;

    fn connect_write<'a>(
        &'a mut self,
        binding: &'a DatabaseAuthorityBindingV1,
        control: StageControlV1<'a>,
    ) -> impl Future<Output = Result<Self::WriteSession, DatabaseFailureV1>> + Send + 'a;

    fn connect_read<'a>(
        &'a mut self,
        binding: &'a DatabaseAuthorityBindingV1,
        control: StageControlV1<'a>,
    ) -> impl Future<Output = Result<Self::ReadSession, DatabaseFailureV1>> + Send + 'a;

    /// Local, idempotent, and nonblocking. A production implementation would still require a
    /// separately reviewed server-cancellation guarantee.
    fn cancel_connection_request(&mut self);
}

trait WriteSessionV1: Send {
    fn verify_project_authority<'a>(
        &'a mut self,
        expected: &'a DatabaseAuthorityBindingV1,
        control: StageControlV1<'a>,
    ) -> impl Future<Output = Result<ObservedProjectAuthorityV1, DatabaseFailureV1>> + Send + 'a;

    fn execute_fixed_install_batch<'a>(
        &'a mut self,
        artifact: &'a FixedInstallArtifactV1,
        limits: InstallLimitsV1,
        control: StageControlV1<'a>,
    ) -> impl Future<Output = Result<RawMigrationResponseV1, DatabaseFailureV1>> + Send + 'a;

    fn cancel_database_request(&mut self);
    fn discard_session(&mut self);
}

trait ReadSessionV1: Send {
    type PreparedStatement: Send;

    fn verify_project_authority<'a>(
        &'a mut self,
        expected: &'a DatabaseAuthorityBindingV1,
        control: StageControlV1<'a>,
    ) -> impl Future<Output = Result<ObservedProjectAuthorityV1, DatabaseFailureV1>> + Send + 'a;
    fn begin_read_only<'a>(
        &'a mut self,
        control: StageControlV1<'a>,
    ) -> impl Future<Output = Result<(), DatabaseFailureV1>> + Send + 'a;
    fn set_local_search_path_pg_catalog_public<'a>(
        &'a mut self,
        control: StageControlV1<'a>,
    ) -> impl Future<Output = Result<(), DatabaseFailureV1>> + Send + 'a;
    fn set_local_row_security_off<'a>(
        &'a mut self,
        control: StageControlV1<'a>,
    ) -> impl Future<Output = Result<(), DatabaseFailureV1>> + Send + 'a;
    fn set_local_statement_timeout_ms<'a>(
        &'a mut self,
        milliseconds: u32,
        control: StageControlV1<'a>,
    ) -> impl Future<Output = Result<(), DatabaseFailureV1>> + Send + 'a;
    fn prepare_fixed_verification<'a>(
        &'a mut self,
        artifact: &'a FixedVerificationArtifactV1,
        control: StageControlV1<'a>,
    ) -> impl Future<Output = Result<Self::PreparedStatement, DatabaseFailureV1>> + Send + 'a;
    fn execute_prepared_verification<'a>(
        &'a mut self,
        statement: Self::PreparedStatement,
        parameters: &'a VerificationParametersV1,
        limits: VerificationLimitsV1,
        control: StageControlV1<'a>,
    ) -> impl Future<Output = Result<RawQueryResponseV1, DatabaseFailureV1>> + Send + 'a;
    fn finish_read_only<'a>(
        &'a mut self,
        control: StageControlV1<'a>,
    ) -> impl Future<Output = Result<(), DatabaseFailureV1>> + Send + 'a;

    fn cancel_database_request(&mut self);
    fn abort_transaction(&mut self);
    fn discard_session(&mut self);
}

async fn race_stage<T>(
    future: impl Future<Output = T>,
    control: StageControlV1<'_>,
) -> Result<T, DatabaseFailureV1> {
    let mut future = pin!(future);
    poll_fn(|context| {
        if let Some(interruption) = control.current_interruption() {
            return Poll::Ready(Err(interruption));
        }
        control
            .interrupts
            .register_waker(control.deadline, context.waker());
        if let Some(interruption) = control.current_interruption() {
            return Poll::Ready(Err(interruption));
        }
        match future.as_mut().poll(context) {
            Poll::Ready(value) => Poll::Ready(Ok(value)),
            Poll::Pending => control
                .current_interruption()
                .map_or(Poll::Pending, |failure| Poll::Ready(Err(failure))),
        }
    })
    .await
}

fn stage_error(stage: CompositionStageV1, failure: DatabaseFailureV1) -> CompositionErrorV1 {
    CompositionErrorV1::Database { stage, failure }
}

fn completed_stage<T>(
    result: Result<Result<T, DatabaseFailureV1>, DatabaseFailureV1>,
    stage: CompositionStageV1,
) -> Result<T, CompositionErrorV1> {
    result
        .map_err(|failure| stage_error(stage, failure))?
        .map_err(|failure| stage_error(stage, failure))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ConnectorCleanupV1 {
    Disarmed,
    CancelPending,
}

struct ConnectorGuardV1<C: DatabaseConnectorV1> {
    connector: C,
    cleanup: ConnectorCleanupV1,
}

impl<C: DatabaseConnectorV1> ConnectorGuardV1<C> {
    fn new(connector: C) -> Self {
        Self {
            connector,
            cleanup: ConnectorCleanupV1::Disarmed,
        }
    }

    fn connector_mut(&mut self) -> &mut C {
        &mut self.connector
    }

    fn arm(&mut self) {
        self.cleanup = ConnectorCleanupV1::CancelPending;
    }

    fn completed(&mut self) {
        self.cleanup = ConnectorCleanupV1::Disarmed;
    }
}

impl<C: DatabaseConnectorV1> Drop for ConnectorGuardV1<C> {
    fn drop(&mut self) {
        if self.cleanup == ConnectorCleanupV1::CancelPending {
            self.connector.cancel_connection_request();
        }
        self.cleanup = ConnectorCleanupV1::Disarmed;
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SessionCleanupV1 {
    Disarmed,
    CancelThenDiscard,
    DiscardOnly,
    CancelThenAbort,
    AbortOnly,
}

struct WriteGuardV1<D: WriteSessionV1> {
    database: D,
    cleanup: SessionCleanupV1,
}

impl<D: WriteSessionV1> WriteGuardV1<D> {
    fn new(database: D) -> Self {
        Self {
            database,
            cleanup: SessionCleanupV1::DiscardOnly,
        }
    }

    fn database_mut(&mut self) -> &mut D {
        &mut self.database
    }

    fn arm(&mut self) {
        self.cleanup = SessionCleanupV1::CancelThenDiscard;
    }

    fn completed(&mut self) {
        self.cleanup = SessionCleanupV1::DiscardOnly;
    }
}

impl<D: WriteSessionV1> Drop for WriteGuardV1<D> {
    fn drop(&mut self) {
        if self.cleanup == SessionCleanupV1::CancelThenDiscard {
            self.database.cancel_database_request();
        }
        if self.cleanup != SessionCleanupV1::Disarmed {
            self.database.discard_session();
        }
        self.cleanup = SessionCleanupV1::Disarmed;
    }
}

struct ReadGuardV1<D: ReadSessionV1> {
    database: D,
    cleanup: SessionCleanupV1,
}

impl<D: ReadSessionV1> ReadGuardV1<D> {
    fn new(database: D) -> Self {
        Self {
            database,
            cleanup: SessionCleanupV1::DiscardOnly,
        }
    }

    fn database_mut(&mut self) -> &mut D {
        &mut self.database
    }

    fn arm_pre_transaction(&mut self) {
        self.cleanup = SessionCleanupV1::CancelThenDiscard;
    }

    fn pre_transaction_completed(&mut self) {
        self.cleanup = SessionCleanupV1::DiscardOnly;
    }

    fn arm_transaction_request(&mut self) {
        self.cleanup = SessionCleanupV1::CancelThenAbort;
    }

    fn transaction_request_completed(&mut self) {
        self.cleanup = SessionCleanupV1::AbortOnly;
    }

    fn disarm_after_finish(&mut self) {
        self.cleanup = SessionCleanupV1::Disarmed;
    }
}

impl<D: ReadSessionV1> Drop for ReadGuardV1<D> {
    fn drop(&mut self) {
        match self.cleanup {
            SessionCleanupV1::CancelThenDiscard => {
                self.database.cancel_database_request();
                self.database.discard_session();
            }
            SessionCleanupV1::DiscardOnly => self.database.discard_session(),
            SessionCleanupV1::CancelThenAbort => {
                self.database.cancel_database_request();
                self.database.abort_transaction();
            }
            SessionCleanupV1::AbortOnly => self.database.abort_transaction(),
            SessionCleanupV1::Disarmed => {}
        }
        self.cleanup = SessionCleanupV1::Disarmed;
    }
}

fn authority_matches(
    observed: &ObservedProjectAuthorityV1,
    expected: &DatabaseAuthorityBindingV1,
) -> bool {
    observed.project_ref == expected.project_ref
        && observed.account_id == expected.account_id
        && observed.grant_generation == expected.grant_generation
        && observed.read_only == expected.read_only
}

fn migration_response_is_exact_empty_object(response: &RawMigrationResponseV1) -> bool {
    if response.body.is_empty() || response.body.len() > MAXIMUM_INSTALL_RESPONSE_BYTES {
        return false;
    }
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&response.body) else {
        return false;
    };
    value.as_object().is_some_and(serde_json::Map::is_empty)
}

macro_rules! guarded_stage {
    ($guard:ident, $arm:ident, $completed:ident, $stage:expr, $future:expr, $control:expr) => {{
        $guard.$arm();
        let result = race_stage($future, $control).await;
        // Only readiness of the adapter future proves that there is no longer a pending request
        // to cancel. An outer cancellation/deadline error from `race_stage` drops a still-pending
        // adapter future, so the guard must remain armed until its own Drop runs the local cancel
        // hook. A ready adapter error is still a completed request and may safely disarm cancel.
        if result.is_ok() {
            $guard.$completed();
        }
        completed_stage(result, $stage)?
    }};
}

async fn run_fixed_install_and_verification_for_test<C: DatabaseConnectorV1>(
    claim: DurableCasLedgerInstallClaimHandleV1,
    connector: C,
    interrupts: &dyn InterruptSourceV1,
) -> Result<DurableCasLedgerInstalledProofV1, CompositionErrorV1> {
    // Everything through the durable precommit is synchronous. Constructing and dropping this
    // future without polling it therefore leaves the journal at Claimed and touches no connector.
    let material = claim.material.clone();
    let install_sql = rendered_install_sql(&material)
        .filter(|sql| sql.len() <= MAXIMUM_INSTALL_SQL_BYTES)
        .ok_or(CompositionErrorV1::FixedArtifactRejected)?;
    let query_digest = fixed_verification_query_digest()
        .filter(|digest| digest == CAS_LEDGER_VERIFICATION_QUERY_DIGEST)
        .ok_or(CompositionErrorV1::FixedArtifactRejected)?;
    let verification_sql =
        fixed_verification_sql().ok_or(CompositionErrorV1::FixedArtifactRejected)?;
    let install_artifact = FixedInstallArtifactV1 {
        sql: install_sql,
        sql_digest: material.install_sql_digest.clone(),
    };
    let verification_artifact = FixedVerificationArtifactV1 {
        query_id: CAS_LEDGER_VERIFICATION_QUERY_ID,
        query_version: CAS_LEDGER_VERIFICATION_QUERY_VERSION,
        query_digest: query_digest.clone(),
        sql: verification_sql,
    };
    let write_binding = DatabaseAuthorityBindingV1 {
        project_ref: material.project_ref.clone(),
        account_id: material.account_id.clone(),
        grant_generation: material.write_grant_generation.clone(),
        read_only: false,
    };
    let read_binding = DatabaseAuthorityBindingV1 {
        project_ref: material.project_ref.clone(),
        account_id: material.account_id.clone(),
        grant_generation: material.read_grant_generation.clone(),
        read_only: true,
    };
    let verification_parameters = VerificationParametersV1 {
        values: [
            "openpencil_release".to_owned(),
            material.source_review_digest.clone(),
            material.ledger_shape_digest.clone(),
            material.base_sql_digest.clone(),
            material.project_ref.clone(),
            material.account_id.clone(),
            material.read_grant_generation.clone(),
            CAS_LEDGER_VERIFICATION_QUERY_VERSION.to_owned(),
            query_digest,
        ],
    };

    let mut outcome = claim
        .begin_outcome_unknown_for_test()
        .map_err(CompositionErrorV1::Journal)?;
    let deadline = interrupts
        .now()
        .checked_add(OVERALL_TIMEOUT)
        .ok_or(CompositionErrorV1::DeadlineUnavailable)?;
    let control = StageControlV1 {
        deadline,
        interrupts,
    };
    let mut connector = ConnectorGuardV1::new(connector);

    let write = guarded_stage!(
        connector,
        arm,
        completed,
        CompositionStageV1::WriteConnect,
        connector
            .connector_mut()
            .connect_write(&write_binding, control),
        control
    );
    let mut write = WriteGuardV1::new(write);
    let observed = guarded_stage!(
        write,
        arm,
        completed,
        CompositionStageV1::WriteProjectAuthority,
        write
            .database_mut()
            .verify_project_authority(&write_binding, control),
        control
    );
    if !authority_matches(&observed, &write_binding) {
        return Err(CompositionErrorV1::AuthorityMismatch);
    }
    let response = guarded_stage!(
        write,
        arm,
        completed,
        CompositionStageV1::ApplyMigration,
        write.database_mut().execute_fixed_install_batch(
            &install_artifact,
            INSTALL_LIMITS,
            control,
        ),
        control
    );
    if !migration_response_is_exact_empty_object(&response) {
        return Err(CompositionErrorV1::MigrationResponseInvalid);
    }
    drop(write);

    let read = guarded_stage!(
        connector,
        arm,
        completed,
        CompositionStageV1::ReadConnect,
        connector
            .connector_mut()
            .connect_read(&read_binding, control),
        control
    );
    let mut read = ReadGuardV1::new(read);
    let observed = guarded_stage!(
        read,
        arm_pre_transaction,
        pre_transaction_completed,
        CompositionStageV1::ReadProjectAuthority,
        read.database_mut()
            .verify_project_authority(&read_binding, control),
        control
    );
    if !authority_matches(&observed, &read_binding) {
        return Err(CompositionErrorV1::AuthorityMismatch);
    }

    guarded_stage!(
        read,
        arm_transaction_request,
        transaction_request_completed,
        CompositionStageV1::BeginReadOnly,
        read.database_mut().begin_read_only(control),
        control
    );
    guarded_stage!(
        read,
        arm_transaction_request,
        transaction_request_completed,
        CompositionStageV1::SearchPath,
        read.database_mut()
            .set_local_search_path_pg_catalog_public(control),
        control
    );
    guarded_stage!(
        read,
        arm_transaction_request,
        transaction_request_completed,
        CompositionStageV1::RowSecurity,
        read.database_mut().set_local_row_security_off(control),
        control
    );
    guarded_stage!(
        read,
        arm_transaction_request,
        transaction_request_completed,
        CompositionStageV1::StatementTimeout,
        read.database_mut()
            .set_local_statement_timeout_ms(STATEMENT_TIMEOUT_MS, control),
        control
    );
    let prepared = guarded_stage!(
        read,
        arm_transaction_request,
        transaction_request_completed,
        CompositionStageV1::PrepareVerification,
        read.database_mut()
            .prepare_fixed_verification(&verification_artifact, control),
        control
    );
    let raw = guarded_stage!(
        read,
        arm_transaction_request,
        transaction_request_completed,
        CompositionStageV1::ExecuteVerification,
        read.database_mut().execute_prepared_verification(
            prepared,
            &verification_parameters,
            VERIFICATION_LIMITS,
            control,
        ),
        control
    );
    let observation = parse_fixed_verification_response(
        raw,
        &verification_parameters.values,
        &material.marker,
        MAXIMUM_VERIFICATION_RESPONSE_BYTES,
    )
    .map_err(|_| CompositionErrorV1::VerificationResponseInvalid)?;
    guarded_stage!(
        read,
        arm_transaction_request,
        transaction_request_completed,
        CompositionStageV1::FinishVerification,
        read.database_mut().finish_read_only(control),
        control
    );
    read.disarm_after_finish();

    let proof = outcome
        .issue_installed_observation_for_test(observation)
        .map_err(CompositionErrorV1::Journal)?;
    outcome
        .settle_installed_for_test(proof)
        .map_err(CompositionErrorV1::Journal)
}

#[cfg(test)]
mod tests;
