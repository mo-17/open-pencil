//! Fixed-stage, one-shot runner for the private Receipt-zero CAS contract.

use super::{
    validate_parameters, BoundParameterV1, FixedStatementArtifactV1, PrecommitContractErrorV1,
    LOCK_TIMEOUT_MS, MAXIMUM_RESPONSE_BYTES, MAXIMUM_RESPONSE_COLUMNS, MAXIMUM_RESPONSE_ROWS,
    OVERALL_TIMEOUT, REMAINING_PRODUCTION_BLOCKERS, STATEMENT_TIMEOUT_MS,
};
#[cfg(test)]
use crate::backend_operation_journal::{
    JournalError, ReceiptZeroInitializerActiveLiveExecutionCeilingV1,
    ReceiptZeroInitializerLiveExecutionCeilingV1,
};
use std::{
    future::{poll_fn, Future},
    pin::pin,
    sync::atomic::{AtomicU8, Ordering},
    task::{Poll, Waker},
    time::Duration,
};

const READY: u8 = 0;
const RUNNING: u8 = 1;
const BURNED: u8 = 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct TransactionLimitsV1 {
    pub(super) isolation: &'static str,
    pub(super) access_mode: &'static str,
    pub(super) statement_timeout_ms: u32,
    pub(super) lock_timeout_ms: u32,
    pub(super) overall_timeout: Duration,
    pub(super) maximum_response_rows: u8,
    pub(super) maximum_response_columns: u8,
    pub(super) maximum_response_bytes: usize,
}

pub(super) const TRANSACTION_LIMITS: TransactionLimitsV1 = TransactionLimitsV1 {
    isolation: "serializable",
    access_mode: "read-write",
    statement_timeout_ms: STATEMENT_TIMEOUT_MS,
    lock_timeout_ms: LOCK_TIMEOUT_MS,
    overall_timeout: OVERALL_TIMEOUT,
    maximum_response_rows: MAXIMUM_RESPONSE_ROWS,
    maximum_response_columns: MAXIMUM_RESPONSE_COLUMNS,
    maximum_response_bytes: MAXIMUM_RESPONSE_BYTES,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum DatabaseFailureV1 {
    /// Connection absence, transport loss, or any I/O result that lacks a definitive server reply.
    Unavailable,
    /// A definitive server reply that proves the requested stage was rejected. An adapter must map
    /// any missing, truncated, unauthenticated, or otherwise ambiguous reply to `Unavailable`.
    Rejected,
    Cancelled,
    TimedOut,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum TransactionStageV1 {
    Connect,
    BeginSerializableReadWrite,
    SearchPath,
    RowSecurity,
    SynchronousCommit,
    StatementTimeout,
    LockTimeout,
    Prepare,
    Execute,
    Commit,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum DatabaseColumnTypeV1 {
    Text,
    Other,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct QueryColumnV1 {
    pub(super) name: String,
    pub(super) column_type: DatabaseColumnTypeV1,
    pub(super) value: Option<Vec<u8>>,
}

/// An adapter response is rows -> typed columns. No implicit JSON object, name/type coercion,
/// text decoding, or NULL coercion is permitted at this boundary.
pub(super) type QueryResponseV1 = Vec<Vec<QueryColumnV1>>;

pub(super) trait DatabaseSessionV1: Send {
    type PreparedStatement: Send;

    fn begin_serializable_read_write<'a>(
        &'a mut self,
        control: StageControlV1<'a>,
    ) -> impl Future<Output = Result<(), DatabaseFailureV1>> + Send + 'a;
    fn set_local_search_path_pg_catalog<'a>(
        &'a mut self,
        control: StageControlV1<'a>,
    ) -> impl Future<Output = Result<(), DatabaseFailureV1>> + Send + 'a;
    fn set_local_row_security_off<'a>(
        &'a mut self,
        control: StageControlV1<'a>,
    ) -> impl Future<Output = Result<(), DatabaseFailureV1>> + Send + 'a;
    fn set_local_synchronous_commit_on<'a>(
        &'a mut self,
        control: StageControlV1<'a>,
    ) -> impl Future<Output = Result<(), DatabaseFailureV1>> + Send + 'a;
    fn set_local_statement_timeout_ms<'a>(
        &'a mut self,
        milliseconds: u32,
        control: StageControlV1<'a>,
    ) -> impl Future<Output = Result<(), DatabaseFailureV1>> + Send + 'a;
    fn set_local_lock_timeout_ms<'a>(
        &'a mut self,
        milliseconds: u32,
        control: StageControlV1<'a>,
    ) -> impl Future<Output = Result<(), DatabaseFailureV1>> + Send + 'a;
    fn prepare_fixed_statement<'a>(
        &'a mut self,
        statement: &'a FixedStatementArtifactV1,
        control: StageControlV1<'a>,
    ) -> impl Future<Output = Result<Self::PreparedStatement, DatabaseFailureV1>> + Send + 'a;
    fn execute_prepared<'a>(
        &'a mut self,
        statement: Self::PreparedStatement,
        parameters: &'a [BoundParameterV1],
        limits: TransactionLimitsV1,
        control: StageControlV1<'a>,
    ) -> impl Future<Output = Result<QueryResponseV1, DatabaseFailureV1>> + Send + 'a;
    /// Construction must be local and lazy: the first future poll is the COMMIT dispatch boundary.
    /// After that poll, every ambiguous outcome is read-only-reconciliation-only.
    fn commit<'a>(
        &'a mut self,
        control: StageControlV1<'a>,
    ) -> impl Future<Output = Result<(), DatabaseFailureV1>> + Send + 'a;

    /// Local, idempotent, and nonblocking. A future adapter must retain a cancellation-safe
    /// transaction handle; this hook may not perform synchronous network I/O.
    fn abort_transaction(&mut self);
    /// Local, idempotent, and nonblocking. Server cancellation remains a future adapter gate.
    fn cancel_database_request(&mut self);
}

/// Private lazy connector boundary for the fused test-only initializer. `connect` must only build
/// a future: it may not open a socket, spawn work, or otherwise start I/O until that future's first
/// poll. No endpoint, TLS mode, credential, SQL, parameter, or timeout is supplied by the caller.
#[cfg(test)]
pub(super) mod connector_sealed {
    pub(in crate::backend_receipt_zero_initializer) trait Sealed {}
}

#[cfg(test)]
pub(super) trait DatabaseConnectorV1: connector_sealed::Sealed + Send {
    type Session: DatabaseSessionV1;

    fn connect<'a>(
        &'a mut self,
        control: StageControlV1<'a>,
    ) -> impl Future<Output = Result<Self::Session, DatabaseFailureV1>> + Send + 'a;

    /// Local, idempotent, and nonblocking. Dropping a pending connect must leave no detached task.
    fn cancel_connect_request(&mut self);
}

pub(super) trait InterruptSourceV1: Sync {
    fn now(&self) -> Duration;
    fn is_cancelled(&self) -> bool;
    fn register_waker(&self, deadline: Duration, waker: &Waker);
}

#[derive(Clone, Copy)]
pub(super) struct StageControlV1<'a> {
    deadline: Duration,
    interrupts: &'a dyn InterruptSourceV1,
    last_interrupt_sample: &'a std::sync::Mutex<Duration>,
    #[cfg(test)]
    journal_ceiling: Option<&'a ReceiptZeroInitializerActiveLiveExecutionCeilingV1>,
}

impl StageControlV1<'_> {
    #[cfg(test)]
    pub(super) const fn deadline_for_test(&self) -> Duration {
        self.deadline
    }

    fn current_interruption(&self) -> Option<DatabaseFailureV1> {
        if self.interrupts.is_cancelled() {
            return Some(DatabaseFailureV1::Cancelled);
        }
        let now = self.interrupts.now();
        let Ok(mut last) = self.last_interrupt_sample.lock() else {
            return Some(DatabaseFailureV1::Unavailable);
        };
        if now < *last {
            return Some(DatabaseFailureV1::Unavailable);
        }
        *last = now;
        drop(last);
        if let Some(failure) = self.journal_ceiling_failure_for_test() {
            Some(failure)
        } else if now >= self.deadline {
            Some(DatabaseFailureV1::TimedOut)
        } else {
            None
        }
    }

    #[cfg(test)]
    fn journal_ceiling_failure_for_test(&self) -> Option<DatabaseFailureV1> {
        self.journal_ceiling.and_then(|ceiling| {
            ceiling
                .require_fresh_for_runner_for_test()
                .err()
                .map(|error| match error {
                    JournalError::CapabilityExpired => DatabaseFailureV1::TimedOut,
                    _ => DatabaseFailureV1::Unavailable,
                })
        })
    }

    #[cfg(not(test))]
    const fn journal_ceiling_failure_for_test(&self) -> Option<DatabaseFailureV1> {
        None
    }
}

pub(super) struct ExecutionControlV1<'a> {
    deadline: Duration,
    interrupts: &'a dyn InterruptSourceV1,
    last_interrupt_sample: std::sync::Mutex<Duration>,
    #[cfg(test)]
    journal_ceiling: Option<ReceiptZeroInitializerActiveLiveExecutionCeilingV1>,
}

/// Non-interchangeable control for the journal-fused connector path. The raw session runner cannot
/// accept this wrapper and no accessor exposes its inner control.
#[cfg(test)]
#[must_use]
pub(super) struct JournalBoundExecutionControlV1<'a> {
    control: ExecutionControlV1<'a>,
}

/// Opaque connector-clock origin sampled by the future's first-poll prefix. It prevents a caller
/// from supplying a Duration and lets journal work consume, rather than extend, the fixed runway.
#[cfg(test)]
#[must_use]
pub(super) struct ConnectorClockAnchorV1<'a> {
    interrupts: &'a dyn InterruptSourceV1,
    sampled_at: Duration,
}

#[cfg(test)]
impl JournalBoundExecutionControlV1<'_> {
    pub(super) const fn deadline_for_test(&self) -> Duration {
        self.control.deadline
    }
}

impl<'a> ExecutionControlV1<'a> {
    fn stage(&self) -> StageControlV1<'_> {
        StageControlV1 {
            deadline: self.deadline,
            interrupts: self.interrupts,
            last_interrupt_sample: &self.last_interrupt_sample,
            #[cfg(test)]
            journal_ceiling: self.journal_ceiling.as_ref(),
        }
    }

    #[cfg(test)]
    pub(super) fn capture_connector_clock_for_test(
        interrupts: &'a dyn InterruptSourceV1,
    ) -> ConnectorClockAnchorV1<'a> {
        ConnectorClockAnchorV1 {
            interrupts,
            sampled_at: interrupts.now(),
        }
    }

    #[cfg(test)]
    pub(super) fn start_for_test(
        interrupts: &'a dyn InterruptSourceV1,
    ) -> Result<Self, PrecommitContractErrorV1> {
        let deadline = interrupts
            .now()
            .checked_add(OVERALL_TIMEOUT)
            .ok_or(PrecommitContractErrorV1::InvalidParameterContract)?;
        Ok(Self {
            deadline,
            interrupts,
            last_interrupt_sample: std::sync::Mutex::new(interrupts.now()),
            journal_ceiling: None,
        })
    }

    #[cfg(test)]
    pub(super) fn start_with_journal_ceiling_for_test(
        anchor: ConnectorClockAnchorV1<'a>,
        ceiling: ReceiptZeroInitializerLiveExecutionCeilingV1,
    ) -> Result<JournalBoundExecutionControlV1<'a>, PrecommitContractErrorV1> {
        let (journal_ceiling, remaining) =
            ceiling
                .activate_for_runner_for_test()
                .map_err(|error| match error {
                    JournalError::CapabilityExpired => PrecommitContractErrorV1::Database {
                        stage: TransactionStageV1::Connect,
                        failure: DatabaseFailureV1::TimedOut,
                    },
                    _ => PrecommitContractErrorV1::InvalidParameterContract,
                })?;
        let current = anchor.interrupts.now();
        if current < anchor.sampled_at {
            return Err(PrecommitContractErrorV1::InvalidParameterContract);
        }
        let parent_deadline = anchor
            .sampled_at
            .checked_add(OVERALL_TIMEOUT)
            .ok_or(PrecommitContractErrorV1::InvalidParameterContract)?;
        let journal_deadline = current
            .checked_add(remaining)
            .ok_or(PrecommitContractErrorV1::InvalidParameterContract)?;
        let deadline = parent_deadline.min(journal_deadline);
        if current >= deadline {
            return Err(PrecommitContractErrorV1::Database {
                stage: TransactionStageV1::Connect,
                failure: DatabaseFailureV1::TimedOut,
            });
        }
        Ok(JournalBoundExecutionControlV1 {
            control: Self {
                deadline,
                interrupts: anchor.interrupts,
                last_interrupt_sample: std::sync::Mutex::new(current),
                journal_ceiling: Some(journal_ceiling),
            },
        })
    }
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

#[cfg(test)]
async fn connect_database_for_test<C: DatabaseConnectorV1>(
    connector: C,
    control: StageControlV1<'_>,
) -> Result<C::Session, PrecommitContractErrorV1> {
    let mut guard = DatabaseConnectorGuardV1::new(connector);
    guard.arm_pending_request();
    let outcome = race_stage(guard.connector_mut().connect(control), control).await;
    match outcome {
        Ok(result) => {
            // A completed connect future has no pending request to cancel, including when it
            // returned an authenticated rejection or an ambiguous transport error.
            guard.disarm();
            result.map_err(|failure| PrecommitContractErrorV1::Database {
                stage: TransactionStageV1::Connect,
                failure,
            })
        }
        Err(failure) => Err(PrecommitContractErrorV1::Database {
            stage: TransactionStageV1::Connect,
            failure,
        }),
    }
}

fn finish_precommit_stage<D: DatabaseSessionV1, T>(
    guard: &mut DatabaseExecutionGuardV1<D>,
    outcome: Result<Result<T, DatabaseFailureV1>, DatabaseFailureV1>,
    stage: TransactionStageV1,
) -> Result<T, PrecommitContractErrorV1> {
    match outcome {
        Ok(database_result) => {
            // A completed adapter future, including a definitive rejection, has no outstanding
            // request left to cancel. Keep only the local transaction abort armed before the
            // result is interpreted so a late CancelRequest cannot hit a reused connection.
            guard.abort_only();
            database_result.map_err(|failure| PrecommitContractErrorV1::Database { stage, failure })
        }
        Err(failure) => Err(PrecommitContractErrorV1::Database { stage, failure }),
    }
}

/// Poll COMMIT before observing a newly-arrived interruption. The caller checks the deadline and
/// cancellation bit immediately before entering this function. After the first poll, an interrupt
/// cannot prove whether the server committed, so a pending interruption is outcome-unknown.
async fn race_commit_stage(
    future: impl Future<Output = Result<(), DatabaseFailureV1>>,
    control: StageControlV1<'_>,
) -> Result<Result<(), DatabaseFailureV1>, DatabaseFailureV1> {
    let mut future = pin!(future);
    let mut first_poll = true;
    poll_fn(|context| {
        if !first_poll {
            if let Some(interruption) = control.current_interruption() {
                return Poll::Ready(Err(interruption));
            }
        }
        control
            .interrupts
            .register_waker(control.deadline, context.waker());
        if !first_poll {
            if let Some(interruption) = control.current_interruption() {
                return Poll::Ready(Err(interruption));
            }
        }
        let outcome = future.as_mut().poll(context);
        first_poll = false;
        match outcome {
            Poll::Ready(value) => Poll::Ready(Ok(value)),
            Poll::Pending => control
                .current_interruption()
                .map_or(Poll::Pending, |failure| Poll::Ready(Err(failure))),
        }
    })
    .await
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ReceiptZeroStatusV1 {
    Inserted,
    ExactReplay,
    AdvancedHead,
    Corruption,
    PreconditionFailed,
}

fn parse_status(row: &[u8]) -> Result<ReceiptZeroStatusV1, PrecommitContractErrorV1> {
    match row {
        b"inserted" => Ok(ReceiptZeroStatusV1::Inserted),
        b"exact-replay" => Ok(ReceiptZeroStatusV1::ExactReplay),
        b"advanced-head" => Ok(ReceiptZeroStatusV1::AdvancedHead),
        b"corruption" => Ok(ReceiptZeroStatusV1::Corruption),
        b"precondition-failed" => Ok(ReceiptZeroStatusV1::PreconditionFailed),
        _ => Err(PrecommitContractErrorV1::InvalidResponse),
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(super) struct RunnerResultV1 {
    pub(super) status: ReceiptZeroStatusV1,
    pub(super) response_byte_length: usize,
    pub(super) request_dispatch_authenticated: bool,
    pub(super) database_authority_created: bool,
    pub(super) mutation_authorized: bool,
    pub(super) execution_authorized: bool,
    pub(super) requires_independent_readback: bool,
    pub(super) database_cas_readback_verified: bool,
    pub(super) settlement_authorized: bool,
    pub(super) receipt_v2_issued: bool,
    pub(super) automatic_retry_allowed: bool,
    pub(super) release_authorized: bool,
    pub(super) remaining_production_blockers: &'static [&'static str],
}

pub(super) struct ReceiptZeroPrecommitContractV1 {
    statement: FixedStatementArtifactV1,
    parameters: Vec<BoundParameterV1>,
    state: AtomicU8,
}

impl ReceiptZeroPrecommitContractV1 {
    #[cfg(test)]
    pub(super) fn issue_for_test(
        parameters: Vec<BoundParameterV1>,
    ) -> Result<Self, PrecommitContractErrorV1> {
        let statement = FixedStatementArtifactV1;
        statement.validate()?;
        validate_parameters(&parameters)?;
        Ok(Self {
            statement,
            parameters,
            state: AtomicU8::new(READY),
        })
    }

    #[cfg(test)]
    pub(super) fn is_burned_for_test(&self) -> bool {
        self.state.load(Ordering::Acquire) == BURNED
    }

    #[cfg(test)]
    pub(super) fn parameters_for_test(&self) -> &[BoundParameterV1] {
        &self.parameters
    }

    pub(super) async fn run<D: DatabaseSessionV1>(
        &self,
        database: D,
        execution: &ExecutionControlV1<'_>,
    ) -> Result<RunnerResultV1, PrecommitContractErrorV1> {
        let _burn = self.begin_run()?;
        self.run_claimed(database, execution).await
    }

    /// Test-only fused connector path. The contract is burned before connect, connection creation
    /// is raced under the same parent control as every transaction stage, and no prebuilt session
    /// can enter this boundary.
    #[cfg(test)]
    pub(super) async fn run_connected_for_test<C: DatabaseConnectorV1>(
        &self,
        connector: C,
        execution: &JournalBoundExecutionControlV1<'_>,
    ) -> Result<RunnerResultV1, PrecommitContractErrorV1> {
        let execution = &execution.control;
        let _burn = self.begin_run()?;
        self.statement.validate()?;
        validate_parameters(&self.parameters)?;
        if let Some(failure) = execution.stage().current_interruption() {
            return if failure == DatabaseFailureV1::Cancelled {
                Err(PrecommitContractErrorV1::Cancelled)
            } else {
                Err(PrecommitContractErrorV1::Database {
                    stage: TransactionStageV1::Connect,
                    failure,
                })
            };
        }
        let database = connect_database_for_test(connector, execution.stage()).await?;
        self.run_claimed(database, execution).await
    }

    fn begin_run(&self) -> Result<BurnAfterRun<'_>, PrecommitContractErrorV1> {
        self.state
            .compare_exchange(READY, RUNNING, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| PrecommitContractErrorV1::AlreadyConsumed)?;
        Ok(BurnAfterRun { state: &self.state })
    }

    async fn run_claimed<D: DatabaseSessionV1>(
        &self,
        database: D,
        execution: &ExecutionControlV1<'_>,
    ) -> Result<RunnerResultV1, PrecommitContractErrorV1> {
        self.statement.validate()?;
        validate_parameters(&self.parameters)?;
        if let Some(failure) = execution.stage().current_interruption() {
            return if failure == DatabaseFailureV1::Cancelled {
                Err(PrecommitContractErrorV1::Cancelled)
            } else {
                Err(PrecommitContractErrorV1::Database {
                    stage: TransactionStageV1::BeginSerializableReadWrite,
                    failure,
                })
            };
        }

        let mut guard = DatabaseExecutionGuardV1::new(database);
        guard.arm_pending_request();
        let begin = race_stage(
            guard
                .database_mut()
                .begin_serializable_read_write(execution.stage()),
            execution.stage(),
        )
        .await;
        finish_precommit_stage(
            &mut guard,
            begin,
            TransactionStageV1::BeginSerializableReadWrite,
        )?;
        guard.arm_pending_request();
        let search_path = race_stage(
            guard
                .database_mut()
                .set_local_search_path_pg_catalog(execution.stage()),
            execution.stage(),
        )
        .await;
        finish_precommit_stage(&mut guard, search_path, TransactionStageV1::SearchPath)?;
        guard.arm_pending_request();
        let row_security = race_stage(
            guard
                .database_mut()
                .set_local_row_security_off(execution.stage()),
            execution.stage(),
        )
        .await;
        finish_precommit_stage(&mut guard, row_security, TransactionStageV1::RowSecurity)?;
        guard.arm_pending_request();
        let synchronous_commit = race_stage(
            guard
                .database_mut()
                .set_local_synchronous_commit_on(execution.stage()),
            execution.stage(),
        )
        .await;
        finish_precommit_stage(
            &mut guard,
            synchronous_commit,
            TransactionStageV1::SynchronousCommit,
        )?;
        guard.arm_pending_request();
        let statement_timeout = race_stage(
            guard
                .database_mut()
                .set_local_statement_timeout_ms(STATEMENT_TIMEOUT_MS, execution.stage()),
            execution.stage(),
        )
        .await;
        finish_precommit_stage(
            &mut guard,
            statement_timeout,
            TransactionStageV1::StatementTimeout,
        )?;
        guard.arm_pending_request();
        let lock_timeout = race_stage(
            guard
                .database_mut()
                .set_local_lock_timeout_ms(LOCK_TIMEOUT_MS, execution.stage()),
            execution.stage(),
        )
        .await;
        finish_precommit_stage(&mut guard, lock_timeout, TransactionStageV1::LockTimeout)?;
        guard.arm_pending_request();
        let prepare = race_stage(
            guard
                .database_mut()
                .prepare_fixed_statement(&self.statement, execution.stage()),
            execution.stage(),
        )
        .await;
        let prepared = finish_precommit_stage(&mut guard, prepare, TransactionStageV1::Prepare)?;
        guard.arm_pending_request();
        let execute = race_stage(
            guard.database_mut().execute_prepared(
                prepared,
                &self.parameters,
                TRANSACTION_LIMITS,
                execution.stage(),
            ),
            execution.stage(),
        )
        .await;
        let rows = finish_precommit_stage(&mut guard, execute, TransactionStageV1::Execute)?;
        if rows.len() != usize::from(MAXIMUM_RESPONSE_ROWS) {
            return Err(PrecommitContractErrorV1::InvalidRowCount);
        }
        let columns = rows
            .into_iter()
            .next()
            .expect("one response row was required");
        if columns.len() != usize::from(MAXIMUM_RESPONSE_COLUMNS) {
            return Err(PrecommitContractErrorV1::InvalidColumnCount);
        }
        let column = columns
            .into_iter()
            .next()
            .expect("one response column was required");
        if column.name != "status" || column.column_type != DatabaseColumnTypeV1::Text {
            return Err(PrecommitContractErrorV1::InvalidColumnMetadata);
        }
        let row = column.value.ok_or(PrecommitContractErrorV1::NullResponse)?;
        if row.is_empty() {
            return Err(PrecommitContractErrorV1::EmptyResponse);
        }
        if row.len() > MAXIMUM_RESPONSE_BYTES {
            return Err(PrecommitContractErrorV1::ResponseTooLarge);
        }
        let status = parse_status(&row)?;
        if !matches!(
            status,
            ReceiptZeroStatusV1::Inserted | ReceiptZeroStatusV1::ExactReplay
        ) {
            return Err(PrecommitContractErrorV1::RefusedStatus(status));
        }

        // Once COMMIT is dispatched, cancellation, timeout, and I/O loss cannot distinguish a
        // committed database from an uncommitted one. Drop therefore performs no cancel/abort and
        // the caller receives an outcome-unknown terminal error requiring read-only reconciliation.
        if let Some(failure) = execution.stage().current_interruption() {
            return Err(PrecommitContractErrorV1::Database {
                stage: TransactionStageV1::Commit,
                failure,
            });
        }
        guard.commit_outcome_unknown_on_drop();
        let commit = race_commit_stage(
            guard.database_mut().commit(execution.stage()),
            execution.stage(),
        )
        .await;
        match commit {
            Ok(Ok(())) => guard.disarm_after_commit(),
            Ok(Err(DatabaseFailureV1::Rejected)) => {
                guard.abort_after_definitive_commit_rejection();
                return Err(PrecommitContractErrorV1::Database {
                    stage: TransactionStageV1::Commit,
                    failure: DatabaseFailureV1::Rejected,
                });
            }
            Ok(Err(failure)) | Err(failure) => {
                guard.retain_commit_outcome_unknown();
                return Err(PrecommitContractErrorV1::CommitOutcomeUnknown { failure });
            }
        }
        Ok(RunnerResultV1 {
            status,
            response_byte_length: row.len(),
            request_dispatch_authenticated: false,
            database_authority_created: false,
            mutation_authorized: false,
            execution_authorized: false,
            requires_independent_readback: true,
            database_cas_readback_verified: false,
            settlement_authorized: false,
            receipt_v2_issued: false,
            automatic_retry_allowed: false,
            release_authorized: false,
            remaining_production_blockers: REMAINING_PRODUCTION_BLOCKERS,
        })
    }
}

#[cfg(test)]
struct DatabaseConnectorGuardV1<C: DatabaseConnectorV1> {
    connector: C,
    pending: bool,
}

#[cfg(test)]
impl<C: DatabaseConnectorV1> DatabaseConnectorGuardV1<C> {
    fn new(connector: C) -> Self {
        Self {
            connector,
            pending: false,
        }
    }

    fn connector_mut(&mut self) -> &mut C {
        &mut self.connector
    }

    fn arm_pending_request(&mut self) {
        self.pending = true;
    }

    fn disarm(&mut self) {
        self.pending = false;
    }
}

#[cfg(test)]
impl<C: DatabaseConnectorV1> Drop for DatabaseConnectorGuardV1<C> {
    fn drop(&mut self) {
        if self.pending {
            self.connector.cancel_connect_request();
        }
        self.pending = false;
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CleanupDispositionV1 {
    Disarmed,
    AbortOnly,
    CancelThenAbort,
    CommitOutcomeUnknown,
}

struct DatabaseExecutionGuardV1<D: DatabaseSessionV1> {
    database: D,
    disposition: CleanupDispositionV1,
}

impl<D: DatabaseSessionV1> DatabaseExecutionGuardV1<D> {
    fn new(database: D) -> Self {
        Self {
            database,
            disposition: CleanupDispositionV1::Disarmed,
        }
    }

    fn database_mut(&mut self) -> &mut D {
        &mut self.database
    }

    fn arm_pending_request(&mut self) {
        self.disposition = CleanupDispositionV1::CancelThenAbort;
    }

    fn abort_only(&mut self) {
        self.disposition = CleanupDispositionV1::AbortOnly;
    }

    fn commit_outcome_unknown_on_drop(&mut self) {
        self.disposition = CleanupDispositionV1::CommitOutcomeUnknown;
    }

    fn retain_commit_outcome_unknown(&mut self) {
        self.disposition = CleanupDispositionV1::CommitOutcomeUnknown;
    }

    fn abort_after_definitive_commit_rejection(&mut self) {
        self.database.abort_transaction();
        self.disposition = CleanupDispositionV1::Disarmed;
    }

    fn disarm_after_commit(&mut self) {
        self.disposition = CleanupDispositionV1::Disarmed;
    }
}

impl<D: DatabaseSessionV1> Drop for DatabaseExecutionGuardV1<D> {
    fn drop(&mut self) {
        if self.disposition == CleanupDispositionV1::CancelThenAbort {
            self.database.cancel_database_request();
        }
        if matches!(
            self.disposition,
            CleanupDispositionV1::AbortOnly | CleanupDispositionV1::CancelThenAbort
        ) {
            self.database.abort_transaction();
        }
        self.disposition = CleanupDispositionV1::Disarmed;
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
