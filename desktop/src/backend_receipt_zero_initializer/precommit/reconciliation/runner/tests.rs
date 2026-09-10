use super::super::{ColumnTypeV1, ReadStateV1, QUERY_VERSION};
use super::*;
use crate::backend_operation_journal::ReceiptZeroInitializerClaimMaterialV1;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use sha2::{Digest, Sha256};
use std::{
    pin::Pin,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    task::{Context, Wake},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Event {
    Stage(ReadStageV1),
    CancelConnect,
    Cancel,
    Abort,
}

struct Clock {
    millis: AtomicU64,
    cancelled: AtomicBool,
    waiter: Mutex<Option<Waker>>,
}

impl Clock {
    fn new() -> Self {
        Self {
            millis: AtomicU64::new(10_000),
            cancelled: AtomicBool::new(false),
            waiter: Mutex::new(None),
        }
    }

    fn wake(&self) {
        if let Some(waker) = self.waiter.lock().unwrap().as_ref() {
            waker.wake_by_ref();
        }
    }

    fn set(&self, milliseconds: u64) {
        self.millis.store(milliseconds, Ordering::SeqCst);
        self.wake();
    }

    fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        self.wake();
    }
}

impl InterruptSourceV1 for Clock {
    fn monotonic(&self) -> Duration {
        Duration::from_millis(self.millis.load(Ordering::SeqCst))
    }
    fn cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
    fn register_waker(&self, waker: &Waker, _deadline: Duration) {
        *self.waiter.lock().unwrap() = Some(waker.clone());
    }
}

struct Shared {
    events: Mutex<Vec<Event>>,
    deadlines: Mutex<Vec<Duration>>,
    stage_hook: Option<Arc<dyn Fn(ReadStageV1) + Send + Sync>>,
    expected_parameters: Vec<BoundParameterV1>,
    pending_at: Option<ReadStageV1>,
    fail_at: Option<ReadStageV1>,
    advance_at: Option<ReadStageV1>,
    poison_sink: bool,
    clock: Arc<Clock>,
    row: Vec<Option<String>>,
}

impl Shared {
    async fn stage(
        &self,
        stage: ReadStageV1,
        control: StageControlV1<'_>,
    ) -> Result<(), DatabaseFailureV1> {
        self.events.lock().unwrap().push(Event::Stage(stage));
        self.deadlines.lock().unwrap().push(control.deadline());
        if let Some(hook) = &self.stage_hook {
            hook(stage);
        }
        if self.advance_at == Some(stage) {
            self.clock.set(40_000);
        }
        if self.fail_at == Some(stage) {
            return Err(DatabaseFailureV1::Rejected);
        }
        if self.pending_at == Some(stage) {
            std::future::pending::<()>().await;
        }
        Ok(())
    }
}

struct Connector(Arc<Shared>);
struct Session(Arc<Shared>);
impl sealed::Connector for Connector {}

impl DatabaseConnectorV1 for Connector {
    type Session = Session;
    async fn connect(&mut self, control: StageControlV1<'_>) -> Result<Session, DatabaseFailureV1> {
        self.0.stage(ReadStageV1::Connect, control).await?;
        Ok(Session(self.0.clone()))
    }
    fn cancel_connect(&mut self) {
        self.0.events.lock().unwrap().push(Event::CancelConnect);
    }
}

impl DatabaseSessionV1 for Session {
    type PreparedStatement = ();
    async fn begin_read_only(
        &mut self,
        control: StageControlV1<'_>,
    ) -> Result<(), DatabaseFailureV1> {
        self.0.stage(ReadStageV1::BeginReadOnly, control).await
    }
    async fn set_local_search_path_pg_catalog(
        &mut self,
        control: StageControlV1<'_>,
    ) -> Result<(), DatabaseFailureV1> {
        self.0.stage(ReadStageV1::SearchPath, control).await
    }
    async fn set_local_row_security_off(
        &mut self,
        control: StageControlV1<'_>,
    ) -> Result<(), DatabaseFailureV1> {
        self.0.stage(ReadStageV1::RowSecurity, control).await
    }
    async fn set_local_statement_timeout(
        &mut self,
        milliseconds: u32,
        control: StageControlV1<'_>,
    ) -> Result<(), DatabaseFailureV1> {
        assert_eq!(milliseconds, 15_000);
        self.0.stage(ReadStageV1::StatementTimeout, control).await
    }
    async fn prepare_fixed_statement(
        &mut self,
        statement: &FixedReadStatementV1,
        control: StageControlV1<'_>,
    ) -> Result<(), DatabaseFailureV1> {
        assert_eq!(statement.source().unwrap().len(), 115_192);
        self.0.stage(ReadStageV1::Prepare, control).await
    }
    async fn execute_prepared(
        &mut self,
        _statement: (),
        parameters: &[BoundParameterV1],
        response: &mut ResponseSinkV1,
        limits: ReadLimitsV1,
        control: StageControlV1<'_>,
    ) -> Result<(), DatabaseFailureV1> {
        assert_eq!(parameters.len(), 28);
        assert_eq!(parameters, self.0.expected_parameters);
        assert_eq!(limits, READ_LIMITS);
        self.0.stage(ReadStageV1::Execute, control).await?;
        response.begin_row(RESPONSE_SCHEMA.len()).unwrap();
        if self.0.poison_sink {
            let _ = response.push_column("wrong-name", ColumnTypeV1::Text, Some(b"wrong"));
        }
        for ((name, kind, _), value) in RESPONSE_SCHEMA.iter().zip(&self.0.row) {
            // Deliberately suppress adapter callback errors to prove the sink stays poisoned.
            let result = response.push_column(name, *kind, value.as_deref().map(str::as_bytes));
            if !self.0.poison_sink {
                result.unwrap();
            }
        }
        Ok(())
    }
    async fn finish_read_only(
        &mut self,
        control: StageControlV1<'_>,
    ) -> Result<(), DatabaseFailureV1> {
        self.0.stage(ReadStageV1::FinishReadOnly, control).await
    }
    fn cancel_database_request(&mut self) {
        self.0.events.lock().unwrap().push(Event::Cancel);
    }
    fn abort_transaction(&mut self) {
        self.0.events.lock().unwrap().push(Event::Abort);
    }
}

fn contract() -> ReceiptZeroReadContractV1 {
    let mut fixture: serde_json::Value = serde_json::from_slice(include_bytes!(
        "../../../../../../tests/fixtures/backend/supabase/receipt-zero-initializer-canonical-v1.json"
    )).unwrap();
    let material: ReceiptZeroInitializerClaimMaterialV1 =
        serde_json::from_value(fixture["material"].take()).unwrap();
    ReceiptZeroReadContractV1::from_material_for_test(&material).unwrap()
}

fn shared(read: &ReceiptZeroReadContractV1) -> Shared {
    let parameter = |position| {
        super::super::super::text(&read.parameters, position)
            .unwrap()
            .to_owned()
    };
    let row = RESPONSE_SCHEMA
        .iter()
        .map(|(name, kind, nullable)| {
            if *nullable && *name != "installMarkerDigest" {
                return None;
            }
            Some(match *name {
                "queryVersion" => QUERY_VERSION.to_owned(),
                "scopeDigest" => parameter(9),
                "receiptDigest" => parameter(26),
                "candidateOperationEvidenceDigest" => parameter(28),
                "initialExecutionStatus" => parameter(20),
                "initialReceiptOutcome" => read.initial_receipt_outcome.clone(),
                "reportedStatus" => "absent".to_owned(),
                "installMarkerDigest" => read.historical_marker_digest.clone(),
                "serverVersionNum" => "170000".to_owned(),
                "snapshotDigest" => URL_SAFE_NO_PAD.encode(Sha256::digest(b"independent-read")),
                "observedAt" => "2027-01-01T00:00:03.000Z".to_owned(),
                "headTimestampMatchesLatestReceipt" | "executionTimestampMatchesHead" => {
                    "f".to_owned()
                }
                _ if *kind == ColumnTypeV1::Boolean => "t".to_owned(),
                _ if *kind == ColumnTypeV1::Int4 => "0".to_owned(),
                _ => panic!("unexpected field"),
            })
        })
        .collect();
    Shared {
        events: Mutex::new(Vec::new()),
        deadlines: Mutex::new(Vec::new()),
        stage_hook: None,
        expected_parameters: read.parameters.clone(),
        pending_at: None,
        fail_at: None,
        advance_at: None,
        poison_sink: false,
        clock: Arc::new(Clock::new()),
        row,
    }
}

struct Noop;
impl Wake for Noop {
    fn wake(self: Arc<Self>) {}
}

fn poll<F: Future>(future: Pin<&mut F>) -> Poll<F::Output> {
    let waker = Waker::from(Arc::new(Noop));
    future.poll(&mut Context::from_waker(&waker))
}

fn completed<F: Future>(future: F) -> F::Output {
    let mut future = pin!(future);
    match poll(future.as_mut()) {
        Poll::Ready(result) => result,
        Poll::Pending => panic!("expected a synchronous fake result"),
    }
}

const STAGES: [ReadStageV1; 8] = [
    ReadStageV1::Connect,
    ReadStageV1::BeginReadOnly,
    ReadStageV1::SearchPath,
    ReadStageV1::RowSecurity,
    ReadStageV1::StatementTimeout,
    ReadStageV1::Prepare,
    ReadStageV1::Execute,
    ReadStageV1::FinishReadOnly,
];

#[test]
fn fixed_read_stages_use_one_deadline_and_return_no_settlement_authority() {
    let read = contract();
    let state = Arc::new(shared(&read));
    let observation =
        completed(read.run_for_test(Connector(state.clone()), state.clock.as_ref())).unwrap();
    assert_eq!(*state.events.lock().unwrap(), STAGES.map(Event::Stage));
    assert_eq!(
        *state.deadlines.lock().unwrap(),
        vec![Duration::from_secs(40); 8]
    );
    assert_eq!(observation.status, ReadStateV1::Absent);
    assert!(!observation.production_transport_authenticated());
    assert!(!observation.absent_proves_prior_mutation_stopped());
    assert!(!observation.settlement_authorized());
    assert!(!observation.automatic_retry_allowed());
    assert!(!observation.receipt_v2_issued());
    assert!(!observation.release_authorized());
}

#[test]
fn unpolled_future_is_send_and_has_no_connector_or_cleanup_effects() {
    fn require_send<T: Send>(_: &T) {}
    let read = contract();
    let state = Arc::new(shared(&read));
    let future = read.run_for_test(Connector(state.clone()), state.clock.as_ref());
    require_send(&future);
    drop(future);
    assert!(state.events.lock().unwrap().is_empty());
}

#[test]
fn already_cancelled_execution_never_contacts_or_cancels_a_connector() {
    let read = contract();
    let state = Arc::new(shared(&read));
    state.clock.cancel();
    assert!(matches!(
        completed(read.run_for_test(Connector(state.clone()), state.clock.as_ref())),
        Err(RunnerErrorV1::Cancelled)
    ));
    assert!(state.events.lock().unwrap().is_empty());
}

#[test]
fn interruption_during_waker_registration_prevents_first_io_poll_without_cleanup() {
    struct InterruptOnRegistration<'a> {
        clock: &'a Clock,
        timeout: bool,
        registrations: AtomicU64,
    }

    impl InterruptSourceV1 for InterruptOnRegistration<'_> {
        fn monotonic(&self) -> Duration {
            self.clock.monotonic()
        }

        fn cancelled(&self) -> bool {
            self.clock.cancelled()
        }

        fn register_waker(&self, waker: &Waker, deadline: Duration) {
            self.registrations.fetch_add(1, Ordering::SeqCst);
            self.clock.register_waker(waker, deadline);
            if self.timeout {
                self.clock.set(u64::try_from(deadline.as_millis()).unwrap());
            } else {
                self.clock.cancel();
            }
        }
    }

    for (timeout, expected) in [
        (false, RunnerErrorV1::Cancelled),
        (true, RunnerErrorV1::TimedOut),
    ] {
        let read = contract();
        let state = Arc::new(shared(&read));
        let interrupts = InterruptOnRegistration {
            clock: state.clock.as_ref(),
            timeout,
            registrations: AtomicU64::new(0),
        };
        assert!(matches!(
            completed(read.run_for_test(Connector(state.clone()), &interrupts)),
            Err(error) if error == expected
        ));
        assert_eq!(interrupts.registrations.load(Ordering::SeqCst), 1);
        assert!(state.events.lock().unwrap().is_empty());
        assert!(state.deadlines.lock().unwrap().is_empty());
    }
}

#[test]
fn drop_of_every_pending_stage_cancels_only_the_active_request_then_aborts() {
    for stage in STAGES {
        let read = contract();
        let mut state = shared(&read);
        state.pending_at = Some(stage);
        let state = Arc::new(state);
        let mut future =
            Box::pin(read.run_for_test(Connector(state.clone()), state.clock.as_ref()));
        assert!(poll(future.as_mut()).is_pending());
        drop(future);
        let events = state.events.lock().unwrap();
        if stage == ReadStageV1::Connect {
            assert_eq!(*events, vec![Event::Stage(stage), Event::CancelConnect]);
        } else {
            assert!(events.ends_with(&[Event::Stage(stage), Event::Cancel, Event::Abort]));
            assert_eq!(
                events
                    .iter()
                    .filter(|event| **event == Event::Cancel)
                    .count(),
                1
            );
            assert_eq!(
                events
                    .iter()
                    .filter(|event| **event == Event::Abort)
                    .count(),
                1
            );
        }
    }
}

#[test]
fn cancellation_timeout_and_clock_rollback_are_enforced_while_each_stage_is_pending() {
    for stage in STAGES {
        for interruption in 0..3 {
            let read = contract();
            let mut state = shared(&read);
            state.pending_at = Some(stage);
            let state = Arc::new(state);
            let mut future =
                Box::pin(read.run_for_test(Connector(state.clone()), state.clock.as_ref()));
            assert!(poll(future.as_mut()).is_pending());
            let expected = match interruption {
                0 => {
                    state.clock.cancel();
                    RunnerErrorV1::Cancelled
                }
                1 => {
                    state.clock.set(40_000);
                    RunnerErrorV1::TimedOut
                }
                _ => {
                    state.clock.set(9_999);
                    RunnerErrorV1::ClockInvalid
                }
            };
            assert!(matches!(poll(future.as_mut()), Poll::Ready(Err(error)) if error == expected));
            drop(future);
            let events = state.events.lock().unwrap();
            if stage == ReadStageV1::Connect {
                assert!(events.ends_with(&[Event::CancelConnect]));
            } else {
                assert!(events.ends_with(&[Event::Cancel, Event::Abort]));
            }
        }
    }
}

#[test]
fn completed_database_errors_abort_without_cancelling_a_finished_request() {
    for stage in STAGES {
        let read = contract();
        let mut state = shared(&read);
        state.fail_at = Some(stage);
        let state = Arc::new(state);
        assert!(
            matches!(completed(read.run_for_test(Connector(state.clone()), state.clock.as_ref())),
            Err(RunnerErrorV1::Database { stage: actual, failure: DatabaseFailureV1::Rejected }) if actual == stage)
        );
        let events = state.events.lock().unwrap();
        assert!(!events.contains(&Event::Cancel) && !events.contains(&Event::CancelConnect));
        if stage != ReadStageV1::Connect {
            assert!(events.ends_with(&[Event::Abort]));
        }
    }
}

#[test]
fn deadline_after_every_completed_stage_never_returns_a_late_observation() {
    for (index, stage) in STAGES.into_iter().enumerate() {
        let read = contract();
        let mut state = shared(&read);
        state.advance_at = Some(stage);
        let state = Arc::new(state);
        assert!(matches!(
            completed(read.run_for_test(Connector(state.clone()), state.clock.as_ref())),
            Err(RunnerErrorV1::TimedOut)
        ));
        let events = state.events.lock().unwrap();
        assert!(!events.contains(&Event::Cancel) && !events.contains(&Event::CancelConnect));
        let mut expected = STAGES[..=index]
            .iter()
            .copied()
            .map(Event::Stage)
            .collect::<Vec<_>>();
        if !matches!(stage, ReadStageV1::Connect | ReadStageV1::FinishReadOnly) {
            expected.push(Event::Abort);
        }
        assert_eq!(*events, expected);
    }
}

#[test]
fn suppressing_sink_errors_never_yields_an_observation_or_normal_finish() {
    let read = contract();
    let mut state = shared(&read);
    state.poison_sink = true;
    let state = Arc::new(state);
    assert!(matches!(
        completed(read.run_for_test(Connector(state.clone()), state.clock.as_ref())),
        Err(RunnerErrorV1::Contract(ReadErrorV1::ResponseProtocol))
    ));
    let events = state.events.lock().unwrap();
    assert!(events.ends_with(&[Event::Abort]));
    assert!(!events.contains(&Event::Stage(ReadStageV1::FinishReadOnly)));
    assert!(!events.contains(&Event::Cancel));
}

mod recovery;
