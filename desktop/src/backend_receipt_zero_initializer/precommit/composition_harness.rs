//! Opaque, test-only connector used to prove the initializer composition boundary.
//!
//! The proof layer can select a bounded outcome and inspect stage names/deadlines, but it never
//! receives a database-session trait, SQL artifact, bound parameters, endpoint, TLS option,
//! credential, timeout, or cancellation handle.

use super::{
    runner::{
        connector_sealed, DatabaseColumnTypeV1, DatabaseConnectorV1, DatabaseFailureV1,
        DatabaseSessionV1, InterruptSourceV1, QueryColumnV1, QueryResponseV1, StageControlV1,
        TransactionLimitsV1, TransactionStageV1,
    },
    validate_parameters, BoundParameterV1, FixedStatementArtifactV1, PARAMETER_COUNT,
    PARAMETER_SCHEMA,
};
use std::{
    future::Future,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    task::Waker,
    time::Duration,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ReceiptZeroPrecommitTestScenarioV1 {
    AckInserted,
    ConnectRejected,
    BeginRejected,
    CommitRejected,
    CommitUnavailable,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum ReceiptZeroPrecommitTestEventV1 {
    Stage {
        name: &'static str,
        deadline: Duration,
    },
    CancelDatabaseRequest,
    AbortTransaction,
    CancelConnectRequest,
}

#[derive(Clone)]
pub(super) struct ReceiptZeroPrecommitTestProbeV1 {
    events: Arc<Mutex<Vec<ReceiptZeroPrecommitTestEventV1>>>,
}

impl ReceiptZeroPrecommitTestProbeV1 {
    pub(super) fn events_for_test(&self) -> Vec<ReceiptZeroPrecommitTestEventV1> {
        self.events.lock().expect("event probe lock").clone()
    }
}

#[derive(Default)]
pub(super) struct ReceiptZeroPrecommitTestInterruptsV1 {
    cancelled: AtomicBool,
    now_milliseconds: AtomicU64,
    waiters: Mutex<Vec<Waker>>,
}

impl ReceiptZeroPrecommitTestInterruptsV1 {
    pub(super) fn advance_for_test(&self, duration: Duration) {
        self.now_milliseconds.fetch_add(
            u64::try_from(duration.as_millis()).expect("test duration fits u64 milliseconds"),
            Ordering::AcqRel,
        );
        self.wake_for_test();
    }

    pub(super) fn cancel_for_test(&self) {
        self.cancelled.store(true, Ordering::Release);
        self.wake_for_test();
    }

    fn wake_for_test(&self) {
        for waiter in std::mem::take(&mut *self.waiters.lock().expect("waiter lock")) {
            waiter.wake();
        }
    }
}

impl InterruptSourceV1 for ReceiptZeroPrecommitTestInterruptsV1 {
    fn now(&self) -> Duration {
        Duration::from_millis(self.now_milliseconds.load(Ordering::Acquire))
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    fn register_waker(&self, _deadline: Duration, waker: &Waker) {
        let mut waiters = self.waiters.lock().expect("waiter lock");
        if !waiters.iter().any(|current| current.will_wake(waker)) {
            waiters.push(waker.clone());
        }
    }
}

pub(super) struct ReceiptZeroPrecommitTestConnectorV1 {
    scenario: ReceiptZeroPrecommitTestScenarioV1,
    events: Arc<Mutex<Vec<ReceiptZeroPrecommitTestEventV1>>>,
    session_available: bool,
}

pub(super) fn receipt_zero_precommit_test_connector_for_scenario(
    scenario: ReceiptZeroPrecommitTestScenarioV1,
) -> (
    ReceiptZeroPrecommitTestConnectorV1,
    ReceiptZeroPrecommitTestProbeV1,
) {
    let events = Arc::new(Mutex::new(Vec::new()));
    (
        ReceiptZeroPrecommitTestConnectorV1 {
            scenario,
            events: Arc::clone(&events),
            session_available: true,
        },
        ReceiptZeroPrecommitTestProbeV1 { events },
    )
}

impl connector_sealed::Sealed for ReceiptZeroPrecommitTestConnectorV1 {}

impl DatabaseConnectorV1 for ReceiptZeroPrecommitTestConnectorV1 {
    type Session = ReceiptZeroPrecommitTestSessionV1;

    fn connect<'a>(
        &'a mut self,
        control: StageControlV1<'a>,
    ) -> impl Future<Output = Result<Self::Session, DatabaseFailureV1>> + Send + 'a {
        async move {
            record_stage(&self.events, TransactionStageV1::Connect, control);
            if self.scenario == ReceiptZeroPrecommitTestScenarioV1::ConnectRejected {
                return Err(DatabaseFailureV1::Rejected);
            }
            if !std::mem::take(&mut self.session_available) {
                return Err(DatabaseFailureV1::Unavailable);
            }
            Ok(ReceiptZeroPrecommitTestSessionV1 {
                scenario: self.scenario,
                events: Arc::clone(&self.events),
            })
        }
    }

    fn cancel_connect_request(&mut self) {
        self.events
            .lock()
            .expect("event probe lock")
            .push(ReceiptZeroPrecommitTestEventV1::CancelConnectRequest);
    }
}

pub(super) struct ReceiptZeroPrecommitTestSessionV1 {
    scenario: ReceiptZeroPrecommitTestScenarioV1,
    events: Arc<Mutex<Vec<ReceiptZeroPrecommitTestEventV1>>>,
}

pub(super) struct ReceiptZeroPrecommitTestPreparedV1;

impl ReceiptZeroPrecommitTestSessionV1 {
    fn record(&self, stage: TransactionStageV1, control: StageControlV1<'_>) {
        record_stage(&self.events, stage, control);
    }
}

impl DatabaseSessionV1 for ReceiptZeroPrecommitTestSessionV1 {
    type PreparedStatement = ReceiptZeroPrecommitTestPreparedV1;

    async fn begin_serializable_read_write(
        &mut self,
        control: StageControlV1<'_>,
    ) -> Result<(), DatabaseFailureV1> {
        self.record(TransactionStageV1::BeginSerializableReadWrite, control);
        if self.scenario == ReceiptZeroPrecommitTestScenarioV1::BeginRejected {
            Err(DatabaseFailureV1::Rejected)
        } else {
            Ok(())
        }
    }

    async fn set_local_search_path_pg_catalog(
        &mut self,
        control: StageControlV1<'_>,
    ) -> Result<(), DatabaseFailureV1> {
        self.record(TransactionStageV1::SearchPath, control);
        Ok(())
    }

    async fn set_local_row_security_off(
        &mut self,
        control: StageControlV1<'_>,
    ) -> Result<(), DatabaseFailureV1> {
        self.record(TransactionStageV1::RowSecurity, control);
        Ok(())
    }

    async fn set_local_synchronous_commit_on(
        &mut self,
        control: StageControlV1<'_>,
    ) -> Result<(), DatabaseFailureV1> {
        self.record(TransactionStageV1::SynchronousCommit, control);
        Ok(())
    }

    async fn set_local_statement_timeout_ms(
        &mut self,
        _milliseconds: u32,
        control: StageControlV1<'_>,
    ) -> Result<(), DatabaseFailureV1> {
        self.record(TransactionStageV1::StatementTimeout, control);
        Ok(())
    }

    async fn set_local_lock_timeout_ms(
        &mut self,
        _milliseconds: u32,
        control: StageControlV1<'_>,
    ) -> Result<(), DatabaseFailureV1> {
        self.record(TransactionStageV1::LockTimeout, control);
        Ok(())
    }

    async fn prepare_fixed_statement(
        &mut self,
        statement: &FixedStatementArtifactV1,
        control: StageControlV1<'_>,
    ) -> Result<Self::PreparedStatement, DatabaseFailureV1> {
        self.record(TransactionStageV1::Prepare, control);
        statement
            .validate()
            .map_err(|_| DatabaseFailureV1::Unavailable)?;
        Ok(ReceiptZeroPrecommitTestPreparedV1)
    }

    async fn execute_prepared(
        &mut self,
        _statement: Self::PreparedStatement,
        parameters: &[BoundParameterV1],
        _limits: TransactionLimitsV1,
        control: StageControlV1<'_>,
    ) -> Result<QueryResponseV1, DatabaseFailureV1> {
        self.record(TransactionStageV1::Execute, control);
        let exact_schema = parameters.len() == PARAMETER_COUNT
            && parameters
                .iter()
                .zip(PARAMETER_SCHEMA)
                .all(|(value, spec)| value.position == spec.position && value.name == spec.name);
        if !exact_schema || validate_parameters(parameters).is_err() {
            return Err(DatabaseFailureV1::Unavailable);
        }
        Ok(vec![vec![QueryColumnV1 {
            name: "status".to_owned(),
            column_type: DatabaseColumnTypeV1::Text,
            value: Some(b"inserted".to_vec()),
        }]])
    }

    async fn commit(&mut self, control: StageControlV1<'_>) -> Result<(), DatabaseFailureV1> {
        self.record(TransactionStageV1::Commit, control);
        match self.scenario {
            ReceiptZeroPrecommitTestScenarioV1::CommitRejected => Err(DatabaseFailureV1::Rejected),
            ReceiptZeroPrecommitTestScenarioV1::CommitUnavailable => {
                Err(DatabaseFailureV1::Unavailable)
            }
            _ => Ok(()),
        }
    }

    fn abort_transaction(&mut self) {
        self.events
            .lock()
            .expect("event probe lock")
            .push(ReceiptZeroPrecommitTestEventV1::AbortTransaction);
    }

    fn cancel_database_request(&mut self) {
        self.events
            .lock()
            .expect("event probe lock")
            .push(ReceiptZeroPrecommitTestEventV1::CancelDatabaseRequest);
    }
}

fn record_stage(
    events: &Mutex<Vec<ReceiptZeroPrecommitTestEventV1>>,
    stage: TransactionStageV1,
    control: StageControlV1<'_>,
) {
    events
        .lock()
        .expect("event probe lock")
        .push(ReceiptZeroPrecommitTestEventV1::Stage {
            name: stage_name(stage),
            deadline: control.deadline_for_test(),
        });
}

const fn stage_name(stage: TransactionStageV1) -> &'static str {
    match stage {
        TransactionStageV1::Connect => "connect",
        TransactionStageV1::BeginSerializableReadWrite => "begin",
        TransactionStageV1::SearchPath => "search-path",
        TransactionStageV1::RowSecurity => "row-security",
        TransactionStageV1::SynchronousCommit => "synchronous-commit",
        TransactionStageV1::StatementTimeout => "statement-timeout",
        TransactionStageV1::LockTimeout => "lock-timeout",
        TransactionStageV1::Prepare => "prepare",
        TransactionStageV1::Execute => "execute",
        TransactionStageV1::Commit => "commit",
    }
}
