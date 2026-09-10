//! Private fixed-read runner with no production constructor, adapter, or journal settlement.
//!
//! An independently owned, sealed connector supplies a fresh read session. Every callback shares
//! one first-poll deadline. The testing-only recovery composition also consumes an exact durable
//! read window and enforces the original journal's two clocks throughout the fixed read.

use super::{
    BoundParameterV1, FixedReadStatementV1, ReadErrorV1, ReadObservationV1,
    ReceiptZeroReadContractV1, ResponseSinkV1, MAXIMUM_RESPONSE_BYTES, RESPONSE_SCHEMA,
    STATEMENT_TIMEOUT_MS,
};

#[cfg(test)]
use super::OVERALL_TIMEOUT;
use std::{
    future::{poll_fn, Future},
    pin::pin,
    sync::Mutex,
    task::{Poll, Waker},
    time::Duration,
};

#[cfg(test)]
use crate::backend_operation_journal::{
    JournalError, ReceiptZeroInitializerActiveReadExecutionCeilingV1,
    ReceiptZeroInitializerReadExecutionCeilingV1,
};

#[cfg(test)]
mod credential_composition;
mod interrupt;
#[cfg(test)]
mod recovery_composition;

mod sealed {
    pub(super) trait Connector {}
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ReadStageV1 {
    Connect,
    BeginReadOnly,
    SearchPath,
    RowSecurity,
    StatementTimeout,
    Prepare,
    Execute,
    FinishReadOnly,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DatabaseFailureV1 {
    Unavailable,
    Rejected,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RunnerErrorV1 {
    Cancelled,
    TimedOut,
    ClockInvalid,
    InterruptUnavailable,
    Database {
        stage: ReadStageV1,
        failure: DatabaseFailureV1,
    },
    Contract(ReadErrorV1),
    #[cfg(test)]
    Journal(JournalError),
    #[cfg(test)]
    Credential(crate::supabase_backfill_fixed_read::DatabaseReadCredentialAdmissionErrorV1),
    #[cfg(test)]
    CredentialTaskUnavailable,
}

impl From<ReadErrorV1> for RunnerErrorV1 {
    fn from(error: ReadErrorV1) -> Self {
        Self::Contract(error)
    }
}

#[cfg(test)]
impl From<JournalError> for RunnerErrorV1 {
    fn from(error: JournalError) -> Self {
        match error {
            JournalError::CapabilityExpired => Self::TimedOut,
            _ => Self::Journal(error),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ReadLimitsV1 {
    statement_timeout_ms: u32,
    maximum_response_rows: usize,
    maximum_response_columns: usize,
    maximum_response_bytes: usize,
}

const READ_LIMITS: ReadLimitsV1 = ReadLimitsV1 {
    statement_timeout_ms: STATEMENT_TIMEOUT_MS,
    maximum_response_rows: 1,
    maximum_response_columns: RESPONSE_SCHEMA.len(),
    maximum_response_bytes: MAXIMUM_RESPONSE_BYTES,
};

/// A future production implementation must schedule a wakeup on cancellation and at the fixed
/// deadline. Merely sampling a clock on database callbacks is not an active timer implementation.
trait InterruptSourceV1: Send + Sync {
    fn monotonic(&self) -> Duration;
    fn cancelled(&self) -> bool;
    fn register_waker(&self, waker: &Waker, deadline: Duration) -> Result<(), RunnerErrorV1>;
}

struct ExecutionControlV1<'a> {
    source: &'a dyn InterruptSourceV1,
    deadline: Duration,
    last_sample: Mutex<Duration>,
    #[cfg(test)]
    journal_ceiling: Option<ReceiptZeroInitializerActiveReadExecutionCeilingV1>,
    #[cfg(test)]
    credential_observer: Option<crate::credentials::CredentialVaultSnapshotObserverV1>,
}

impl<'a> ExecutionControlV1<'a> {
    #[cfg(test)]
    fn start_for_test(source: &'a dyn InterruptSourceV1) -> Result<Self, RunnerErrorV1> {
        let now = source.monotonic();
        let result = Self {
            source,
            deadline: now
                .checked_add(OVERALL_TIMEOUT)
                .ok_or(RunnerErrorV1::ClockInvalid)?,
            last_sample: Mutex::new(now),
            journal_ceiling: None,
            credential_observer: None,
        };
        result.require_ready()?;
        Ok(result)
    }

    /// The first-poll deadline is already fixed before journal I/O. Project the remaining
    /// journal budget once, then retain the active ceiling for every poll and the final result.
    #[cfg(test)]
    fn bind_read_ceiling_for_test(
        mut self,
        ceiling: ReceiptZeroInitializerReadExecutionCeilingV1,
    ) -> Result<Self, RunnerErrorV1> {
        self.require_ready()?;
        let (active, remaining) = ceiling.activate_for_runner_for_test()?;
        let current = self.sample_monotonic()?;
        let projected_deadline = current
            .checked_add(remaining)
            .ok_or(RunnerErrorV1::ClockInvalid)?;
        self.deadline = self.deadline.min(projected_deadline);
        self.journal_ceiling = Some(active);
        self.require_ready()?;
        Ok(self)
    }

    #[cfg(test)]
    fn bind_credential_observer_for_test(
        mut self,
        observer: crate::credentials::CredentialVaultSnapshotObserverV1,
    ) -> Result<Self, RunnerErrorV1> {
        self.require_ready()?;
        self.credential_observer = Some(observer);
        self.require_ready()?;
        Ok(self)
    }

    fn register_waker(&self, waker: &Waker) -> Result<(), RunnerErrorV1> {
        self.source.register_waker(waker, self.deadline)?;
        #[cfg(test)]
        if let Some(observer) = &self.credential_observer {
            observer.register_waker(waker).map_err(|_| {
                RunnerErrorV1::Credential(
                    crate::supabase_backfill_fixed_read::DatabaseReadCredentialAdmissionErrorV1::Changed,
                )
            })?;
        }
        Ok(())
    }

    fn require_ready(&self) -> Result<(), RunnerErrorV1> {
        if self.source.cancelled() {
            return Err(RunnerErrorV1::Cancelled);
        }
        #[cfg(test)]
        if self.credential_observer.as_ref().is_some_and(|observer| observer.is_revoked()) {
            return Err(RunnerErrorV1::Credential(
                crate::supabase_backfill_fixed_read::DatabaseReadCredentialAdmissionErrorV1::Changed,
            ));
        }
        #[cfg(test)]
        if let Some(ceiling) = &self.journal_ceiling {
            ceiling.require_fresh_for_runner_for_test()?;
        }
        let now = self.sample_monotonic()?;
        if now >= self.deadline {
            return Err(RunnerErrorV1::TimedOut);
        }
        Ok(())
    }

    fn sample_monotonic(&self) -> Result<Duration, RunnerErrorV1> {
        let now = self.source.monotonic();
        let mut last = self
            .last_sample
            .lock()
            .map_err(|_| RunnerErrorV1::ClockInvalid)?;
        if now < *last {
            return Err(RunnerErrorV1::ClockInvalid);
        }
        *last = now;
        Ok(now)
    }

    fn stage(&'a self) -> StageControlV1<'a> {
        StageControlV1 { execution: self }
    }

    async fn wait<T, F>(
        &self,
        stage: ReadStageV1,
        pending: &mut bool,
        future: F,
    ) -> Result<T, RunnerErrorV1>
    where
        F: Future<Output = Result<T, DatabaseFailureV1>>,
    {
        let mut future = pin!(future);
        poll_fn(|context| {
            if let Err(error) = self.require_ready() {
                return Poll::Ready(Err(error));
            }
            if let Err(error) = self.register_waker(context.waker()) {
                return Poll::Ready(Err(error));
            }
            // Registration must not introduce a cancellation/timeout race before the first I/O
            // poll. A pending adapter future is polled only while this exact control stays fresh.
            if let Err(error) = self.require_ready() {
                return Poll::Ready(Err(error));
            }
            *pending = true;
            match future.as_mut().poll(context) {
                Poll::Pending => Poll::Pending,
                Poll::Ready(result) => {
                    *pending = false;
                    Poll::Ready(
                        result.map_err(|failure| RunnerErrorV1::Database { stage, failure }),
                    )
                }
            }
        })
        .await
    }
}

#[derive(Clone, Copy)]
struct StageControlV1<'a> {
    execution: &'a ExecutionControlV1<'a>,
}

impl StageControlV1<'_> {
    fn deadline(&self) -> Duration {
        self.execution.deadline
    }
}

/// `connect` and all session methods may only construct lazy futures. No socket, spawned task,
/// request, or transaction is allowed before the returned future's first poll. The trait accepts
/// no caller endpoint, credential, SQL, query parameters, or time limit.
trait DatabaseConnectorV1: sealed::Connector + Send {
    type Session: DatabaseSessionV1;

    fn connect<'a>(
        &'a mut self,
        control: StageControlV1<'a>,
    ) -> impl Future<Output = Result<Self::Session, DatabaseFailureV1>> + Send + 'a;

    /// Local, nonblocking, idempotent cancellation; no synchronous network work is allowed.
    fn cancel_connect(&mut self);
}

trait DatabaseSessionV1: Send {
    type PreparedStatement: Send;

    fn begin_read_only<'a>(
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
    fn set_local_statement_timeout<'a>(
        &'a mut self,
        milliseconds: u32,
        control: StageControlV1<'a>,
    ) -> impl Future<Output = Result<(), DatabaseFailureV1>> + Send + 'a;
    fn prepare_fixed_statement<'a>(
        &'a mut self,
        statement: &'a FixedReadStatementV1,
        control: StageControlV1<'a>,
    ) -> impl Future<Output = Result<Self::PreparedStatement, DatabaseFailureV1>> + Send + 'a;
    fn execute_prepared<'a>(
        &'a mut self,
        statement: Self::PreparedStatement,
        parameters: &'a [BoundParameterV1],
        response: &'a mut ResponseSinkV1,
        limits: ReadLimitsV1,
        control: StageControlV1<'a>,
    ) -> impl Future<Output = Result<(), DatabaseFailureV1>> + Send + 'a;
    /// Ends the read transaction using ROLLBACK, not a write-side COMMIT or settlement callback.
    fn finish_read_only<'a>(
        &'a mut self,
        control: StageControlV1<'a>,
    ) -> impl Future<Output = Result<(), DatabaseFailureV1>> + Send + 'a;

    /// Both hooks are local, nonblocking and idempotent. A future adapter must retain its own
    /// cancellation-safe transaction handle and separately certify actual server cancellation.
    fn cancel_database_request(&mut self);
    fn abort_transaction(&mut self);
}

struct ConnectingV1<C: DatabaseConnectorV1> {
    connector: C,
    pending: bool,
}

impl<C: DatabaseConnectorV1> Drop for ConnectingV1<C> {
    fn drop(&mut self) {
        if self.pending {
            self.connector.cancel_connect();
        }
    }
}

struct ReadingV1<S: DatabaseSessionV1> {
    session: S,
    pending: bool,
    transaction_may_be_open: bool,
}

impl<S: DatabaseSessionV1> Drop for ReadingV1<S> {
    fn drop(&mut self) {
        if self.pending {
            self.session.cancel_database_request();
        }
        if self.transaction_may_be_open {
            self.session.abort_transaction();
        }
    }
}

impl ReceiptZeroReadContractV1 {
    /// Testing-only structural execution, not the journal-bound B3c composition. Both `self` and
    /// the distinct read connector are consumed; constructing and dropping an unpolled future is
    /// inert. No reusable prepared statement, session, observation authority, or journal handle
    /// escapes this function.
    #[cfg(test)]
    async fn run_for_test<C: DatabaseConnectorV1>(
        self,
        connector: C,
        interrupts: &dyn InterruptSourceV1,
    ) -> Result<ReadObservationV1, RunnerErrorV1> {
        let execution = ExecutionControlV1::start_for_test(interrupts)?;
        self.run(connector, &execution).await
    }

    async fn run<C: DatabaseConnectorV1>(
        self,
        connector: C,
        execution: &ExecutionControlV1<'_>,
    ) -> Result<ReadObservationV1, RunnerErrorV1> {
        super::super::validate_parameters(&self.parameters).map_err(|_| ReadErrorV1::Parameters)?;
        let statement = FixedReadStatementV1;
        statement.source()?;
        execution.require_ready()?;
        let control = execution.stage();
        let mut connecting = ConnectingV1 {
            connector,
            pending: false,
        };
        let session = execution
            .wait(
                ReadStageV1::Connect,
                &mut connecting.pending,
                connecting.connector.connect(control),
            )
            .await?;
        drop(connecting);
        execution.require_ready()?;
        let mut reading = ReadingV1 {
            session,
            pending: false,
            transaction_may_be_open: true,
        };
        execution
            .wait(
                ReadStageV1::BeginReadOnly,
                &mut reading.pending,
                reading.session.begin_read_only(control),
            )
            .await?;
        execution
            .wait(
                ReadStageV1::SearchPath,
                &mut reading.pending,
                reading.session.set_local_search_path_pg_catalog(control),
            )
            .await?;
        execution
            .wait(
                ReadStageV1::RowSecurity,
                &mut reading.pending,
                reading.session.set_local_row_security_off(control),
            )
            .await?;
        execution
            .wait(
                ReadStageV1::StatementTimeout,
                &mut reading.pending,
                reading
                    .session
                    .set_local_statement_timeout(STATEMENT_TIMEOUT_MS, control),
            )
            .await?;
        let prepared = execution
            .wait(
                ReadStageV1::Prepare,
                &mut reading.pending,
                reading.session.prepare_fixed_statement(&statement, control),
            )
            .await?;
        let mut response = ResponseSinkV1::new();
        execution
            .wait(
                ReadStageV1::Execute,
                &mut reading.pending,
                reading.session.execute_prepared(
                    prepared,
                    &self.parameters,
                    &mut response,
                    READ_LIMITS,
                    control,
                ),
            )
            .await?;
        execution.require_ready()?;
        let observation = self.decode(response)?;
        execution
            .wait(
                ReadStageV1::FinishReadOnly,
                &mut reading.pending,
                reading.session.finish_read_only(control),
            )
            .await?;
        reading.transaction_may_be_open = false;
        execution.require_ready()?;
        Ok(observation)
    }
}

#[cfg(test)]
mod tests;
