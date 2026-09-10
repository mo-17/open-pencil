use super::*;
use crate::backend_operation_journal::{
    BackendOperationJournalV1, DirectorySync, JournalClock, JournalEntropy, JournalError,
    ReceiptZeroInitializerClaimMaterialV1, ReceiptZeroInitializerInertLivePrecommitRunWindowV1,
};
use std::{
    fs::File,
    future::Future,
    path::Path,
    pin::{pin, Pin},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering as AtomicOrdering},
        Arc, Mutex,
    },
    task::{Context, Poll, Wake, Waker},
    thread,
};
use tempfile::TempDir;

#[derive(Clone, Debug, PartialEq, Eq)]
enum Event {
    Connect,
    Begin,
    SearchPath,
    RowSecurity,
    SynchronousCommit,
    StatementTimeout(u32),
    LockTimeout(u32),
    Prepare {
        query_id: &'static str,
        query_version: &'static str,
        byte_length: usize,
        sha256: [u8; 32],
    },
    Execute {
        parameter_count: usize,
        limits: TransactionLimitsV1,
    },
    Commit,
    Cancel,
    Abort,
    CancelConnect,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct PreparedStatement {
    query_id: &'static str,
    query_version: &'static str,
    byte_length: usize,
    sha256: [u8; 32],
}

struct FakeDatabase {
    events: Arc<Mutex<Vec<Event>>>,
    deadlines: Arc<Mutex<Vec<(TransactionStageV1, Duration)>>>,
    fail_at: Option<(TransactionStageV1, DatabaseFailureV1)>,
    rows: QueryResponseV1,
    hang_execute: bool,
    hang_commit: bool,
    delay_commit_result: bool,
    cancel_after_execute: Option<Arc<TestInterrupts>>,
    timeout_during_execute: Option<Arc<TestInterrupts>>,
    cancel_during_commit: Option<Arc<TestInterrupts>>,
    timeout_during_commit: Option<Arc<TestInterrupts>>,
    pending_precommit_stage: Option<TransactionStageV1>,
}

impl FakeDatabase {
    fn successful(status: &[u8]) -> Self {
        Self {
            events: Arc::new(Mutex::new(Vec::new())),
            deadlines: Arc::new(Mutex::new(Vec::new())),
            fail_at: None,
            rows: response(status),
            hang_execute: false,
            hang_commit: false,
            delay_commit_result: false,
            cancel_after_execute: None,
            timeout_during_execute: None,
            cancel_during_commit: None,
            timeout_during_commit: None,
            pending_precommit_stage: None,
        }
    }

    fn record(&self, event: Event) {
        self.events.lock().expect("events lock").push(event);
    }

    fn record_deadline(&self, stage: TransactionStageV1, control: StageControlV1<'_>) {
        self.deadlines
            .lock()
            .expect("deadlines lock")
            .push((stage, control.deadline_for_test()));
    }

    fn stage(&self, stage: TransactionStageV1) -> Result<(), DatabaseFailureV1> {
        match self.fail_at {
            Some((failed_stage, failure)) if failed_stage == stage => Err(failure),
            _ => Ok(()),
        }
    }

    async fn precommit_stage(&self, stage: TransactionStageV1) -> Result<(), DatabaseFailureV1> {
        let result = self.stage(stage);
        if result.is_ok() && self.pending_precommit_stage == Some(stage) {
            std::future::pending::<()>().await;
        }
        result
    }
}

fn response(status: &[u8]) -> QueryResponseV1 {
    vec![vec![text_column(Some(status.to_vec()))]]
}

fn text_column(value: Option<Vec<u8>>) -> QueryColumnV1 {
    QueryColumnV1 {
        name: "status".to_owned(),
        column_type: DatabaseColumnTypeV1::Text,
        value,
    }
}

async fn yield_once() {
    let mut yielded = false;
    std::future::poll_fn(|context| {
        if yielded {
            Poll::Ready(())
        } else {
            yielded = true;
            context.waker().wake_by_ref();
            Poll::Pending
        }
    })
    .await;
}

impl DatabaseSessionV1 for FakeDatabase {
    type PreparedStatement = PreparedStatement;

    async fn begin_serializable_read_write(
        &mut self,
        control: StageControlV1<'_>,
    ) -> Result<(), DatabaseFailureV1> {
        self.record_deadline(TransactionStageV1::BeginSerializableReadWrite, control);
        self.record(Event::Begin);
        self.precommit_stage(TransactionStageV1::BeginSerializableReadWrite)
            .await
    }

    async fn set_local_search_path_pg_catalog(
        &mut self,
        control: StageControlV1<'_>,
    ) -> Result<(), DatabaseFailureV1> {
        self.record_deadline(TransactionStageV1::SearchPath, control);
        self.record(Event::SearchPath);
        self.precommit_stage(TransactionStageV1::SearchPath).await
    }

    async fn set_local_row_security_off(
        &mut self,
        control: StageControlV1<'_>,
    ) -> Result<(), DatabaseFailureV1> {
        self.record_deadline(TransactionStageV1::RowSecurity, control);
        self.record(Event::RowSecurity);
        self.precommit_stage(TransactionStageV1::RowSecurity).await
    }

    async fn set_local_synchronous_commit_on(
        &mut self,
        control: StageControlV1<'_>,
    ) -> Result<(), DatabaseFailureV1> {
        self.record_deadline(TransactionStageV1::SynchronousCommit, control);
        self.record(Event::SynchronousCommit);
        self.precommit_stage(TransactionStageV1::SynchronousCommit)
            .await
    }

    async fn set_local_statement_timeout_ms(
        &mut self,
        milliseconds: u32,
        control: StageControlV1<'_>,
    ) -> Result<(), DatabaseFailureV1> {
        self.record_deadline(TransactionStageV1::StatementTimeout, control);
        self.record(Event::StatementTimeout(milliseconds));
        self.precommit_stage(TransactionStageV1::StatementTimeout)
            .await
    }

    async fn set_local_lock_timeout_ms(
        &mut self,
        milliseconds: u32,
        control: StageControlV1<'_>,
    ) -> Result<(), DatabaseFailureV1> {
        self.record_deadline(TransactionStageV1::LockTimeout, control);
        self.record(Event::LockTimeout(milliseconds));
        self.precommit_stage(TransactionStageV1::LockTimeout).await
    }

    async fn prepare_fixed_statement(
        &mut self,
        statement: &FixedStatementArtifactV1,
        control: StageControlV1<'_>,
    ) -> Result<Self::PreparedStatement, DatabaseFailureV1> {
        self.record_deadline(TransactionStageV1::Prepare, control);
        let prepared = PreparedStatement {
            query_id: statement.query_id(),
            query_version: statement.query_version(),
            byte_length: statement.byte_length(),
            sha256: statement.sha256(),
        };
        self.record(Event::Prepare {
            query_id: prepared.query_id,
            query_version: prepared.query_version,
            byte_length: prepared.byte_length,
            sha256: prepared.sha256,
        });
        self.precommit_stage(TransactionStageV1::Prepare).await?;
        Ok(prepared)
    }

    async fn execute_prepared(
        &mut self,
        statement: Self::PreparedStatement,
        parameters: &[BoundParameterV1],
        limits: TransactionLimitsV1,
        control: StageControlV1<'_>,
    ) -> Result<QueryResponseV1, DatabaseFailureV1> {
        self.record_deadline(TransactionStageV1::Execute, control);
        assert_eq!(statement.query_id, QUERY_ID);
        assert_eq!(statement.query_version, QUERY_VERSION);
        assert_eq!(statement.byte_length, SQL_BYTE_LENGTH);
        assert_eq!(statement.sha256, SQL_SHA256);
        assert_eq!(parameters, test_parameters());
        self.record(Event::Execute {
            parameter_count: parameters.len(),
            limits,
        });
        self.stage(TransactionStageV1::Execute)?;
        if let Some(interrupts) = &self.timeout_during_execute {
            interrupts.advance(OVERALL_TIMEOUT);
        }
        if let Some(interrupts) = &self.cancel_after_execute {
            interrupts.cancel();
        }
        if self.hang_execute || self.timeout_during_execute.is_some() {
            std::future::pending::<()>().await;
        }
        Ok(self.rows.clone())
    }

    async fn commit(&mut self, control: StageControlV1<'_>) -> Result<(), DatabaseFailureV1> {
        self.record_deadline(TransactionStageV1::Commit, control);
        self.record(Event::Commit);
        if self.delay_commit_result {
            yield_once().await;
        }
        self.stage(TransactionStageV1::Commit)?;
        if let Some(interrupts) = &self.timeout_during_commit {
            interrupts.advance(OVERALL_TIMEOUT);
        }
        if let Some(interrupts) = &self.cancel_during_commit {
            interrupts.cancel();
        }
        if self.hang_commit
            || self.timeout_during_commit.is_some()
            || self.cancel_during_commit.is_some()
        {
            std::future::pending::<()>().await;
        }
        Ok(())
    }

    fn abort_transaction(&mut self) {
        self.record(Event::Abort);
    }

    fn cancel_database_request(&mut self) {
        self.record(Event::Cancel);
    }
}

#[derive(Default)]
struct TestInterrupts {
    cancelled: AtomicBool,
    now_milliseconds: AtomicU64,
    waiters: Mutex<Vec<Waker>>,
}

impl TestInterrupts {
    fn cancel(&self) {
        self.cancelled.store(true, AtomicOrdering::Release);
        self.wake();
    }

    fn advance(&self, duration: Duration) {
        self.now_milliseconds.fetch_add(
            u64::try_from(duration.as_millis()).expect("duration fits"),
            AtomicOrdering::AcqRel,
        );
        self.wake();
    }

    fn set_now(&self, instant: Duration) {
        self.now_milliseconds.store(
            u64::try_from(instant.as_millis()).expect("duration fits"),
            AtomicOrdering::Release,
        );
        self.wake();
    }

    fn wake(&self) {
        for waiter in std::mem::take(&mut *self.waiters.lock().expect("waiters lock")) {
            waiter.wake();
        }
    }
}

impl InterruptSourceV1 for TestInterrupts {
    fn now(&self) -> Duration {
        Duration::from_millis(self.now_milliseconds.load(AtomicOrdering::Acquire))
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(AtomicOrdering::Acquire)
    }

    fn register_waker(&self, _deadline: Duration, waker: &Waker) {
        let mut waiters = self.waiters.lock().expect("waiters lock");
        if !waiters.iter().any(|current| current.will_wake(waker)) {
            waiters.push(waker.clone());
        }
    }
}

const JOURNAL_WALL_START: u64 = 1_800_000_000_000;

struct JournalTestClock {
    wall_milliseconds: AtomicU64,
    monotonic_milliseconds: AtomicU64,
}

impl JournalTestClock {
    fn new() -> Self {
        Self {
            wall_milliseconds: AtomicU64::new(JOURNAL_WALL_START),
            monotonic_milliseconds: AtomicU64::new(0),
        }
    }

    fn advance(&self, duration: Duration) {
        let milliseconds = u64::try_from(duration.as_millis()).expect("duration fits");
        self.wall_milliseconds
            .fetch_add(milliseconds, AtomicOrdering::AcqRel);
        self.monotonic_milliseconds
            .fetch_add(milliseconds, AtomicOrdering::AcqRel);
    }
}

impl JournalClock for JournalTestClock {
    fn wall_unix_millis(&self) -> Result<u64, JournalError> {
        Ok(self.wall_milliseconds.load(AtomicOrdering::Acquire))
    }

    fn monotonic(&self) -> Duration {
        Duration::from_millis(self.monotonic_milliseconds.load(AtomicOrdering::Acquire))
    }
}

struct JournalTestEntropy(AtomicU64);

impl JournalEntropy for JournalTestEntropy {
    fn capability_id(&self) -> Result<[u8; 32], JournalError> {
        let mut id = [0_u8; 32];
        id[24..].copy_from_slice(&self.0.fetch_add(1, AtomicOrdering::AcqRel).to_be_bytes());
        Ok(id)
    }
}

struct JournalTestDirectorySync;

impl DirectorySync for JournalTestDirectorySync {
    fn sync(&self, directory: &Path) -> Result<(), JournalError> {
        File::open(directory)
            .and_then(|handle| handle.sync_all())
            .map_err(|_| JournalError::Unavailable)
    }
}

fn initializer_material_fixture() -> ReceiptZeroInitializerClaimMaterialV1 {
    let fixture: serde_json::Value = serde_json::from_slice(include_bytes!(
        "../../../../tests/fixtures/backend/supabase/receipt-zero-initializer-canonical-v1.json"
    ))
    .expect("initializer fixture");
    serde_json::from_value(fixture["material"].clone()).expect("initializer material")
}

fn inert_live_window(
    clock: Arc<JournalTestClock>,
) -> (
    TempDir,
    BackendOperationJournalV1,
    ReceiptZeroInitializerInertLivePrecommitRunWindowV1,
) {
    let temp = TempDir::new().expect("temporary journal");
    let journal = BackendOperationJournalV1::with_test_dependencies(
        temp.path().join("app-data"),
        Arc::new(JournalTestEntropy(AtomicU64::new(1))),
        clock,
        Arc::new(JournalTestDirectorySync),
    );
    let claim = journal
        .claim_receipt_zero_initializer_for_test(initializer_material_fixture())
        .expect("initializer claim");
    let dispatch = journal
        .precommit_receipt_zero_initializer_for_test(claim)
        .expect("initializer outcome unknown");
    let window = journal
        .issue_receipt_zero_initializer_live_run_window_for_test(dispatch)
        .expect("inert live window");
    (temp, journal, window)
}

#[derive(Clone, Copy)]
enum ConnectMode {
    Ready,
    Rejected,
    Pending,
}

struct FakeConnector {
    database: Option<FakeDatabase>,
    events: Arc<Mutex<Vec<Event>>>,
    deadlines: Arc<Mutex<Vec<(TransactionStageV1, Duration)>>>,
    mode: ConnectMode,
}

impl FakeConnector {
    fn new(database: FakeDatabase, mode: ConnectMode) -> Self {
        Self {
            events: Arc::clone(&database.events),
            deadlines: Arc::clone(&database.deadlines),
            database: Some(database),
            mode,
        }
    }
}

impl connector_sealed::Sealed for FakeConnector {}

impl DatabaseConnectorV1 for FakeConnector {
    type Session = FakeDatabase;

    fn connect<'a>(
        &'a mut self,
        control: StageControlV1<'a>,
    ) -> impl Future<Output = Result<Self::Session, DatabaseFailureV1>> + Send + 'a {
        async move {
            self.events
                .lock()
                .expect("events lock")
                .push(Event::Connect);
            self.deadlines
                .lock()
                .expect("deadlines lock")
                .push((TransactionStageV1::Connect, control.deadline_for_test()));
            match self.mode {
                ConnectMode::Ready => self.database.take().ok_or(DatabaseFailureV1::Unavailable),
                ConnectMode::Rejected => Err(DatabaseFailureV1::Rejected),
                ConnectMode::Pending => std::future::pending().await,
            }
        }
    }

    fn cancel_connect_request(&mut self) {
        self.events
            .lock()
            .expect("events lock")
            .push(Event::CancelConnect);
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

fn text(position: usize, value: impl Into<String>) -> BoundParameterV1 {
    BoundParameterV1 {
        position: u8::try_from(position).expect("position fits"),
        name: PARAMETER_SCHEMA[position - 1].name,
        value: BoundParameterValueV1::Text(value.into()),
    }
}

fn int8_value(position: usize, value: Option<i64>) -> BoundParameterV1 {
    BoundParameterV1 {
        position: u8::try_from(position).expect("position fits"),
        name: PARAMETER_SCHEMA[position - 1].name,
        value: BoundParameterValueV1::Int8(value),
    }
}

fn int4_value(position: usize, value: i32) -> BoundParameterV1 {
    BoundParameterV1 {
        position: u8::try_from(position).expect("position fits"),
        name: PARAMETER_SCHEMA[position - 1].name,
        value: BoundParameterValueV1::Int4(value),
    }
}

fn test_parameters() -> Vec<BoundParameterV1> {
    let digest = URL_SAFE_NO_PAD.encode(Sha256::digest(b"{}"));
    vec![
        text(1, "execution-1"),
        text(2, "application-1"),
        text(3, digest.clone()),
        text(4, "migration-1"),
        text(5, digest.clone()),
        text(6, digest.clone()),
        text(7, digest.clone()),
        text(8, digest.clone()),
        text(9, digest.clone()),
        text(10, digest.clone()),
        text(11, digest.clone()),
        text(12, STANDARD.encode(b"{}")),
        text(13, digest.clone()),
        int8_value(14, Some(42)),
        int8_value(15, Some(42)),
        int8_value(16, Some(8)),
        int8_value(17, Some(8)),
        int4_value(18, 2),
        int4_value(19, 25),
        text(20, "running"),
        text(21, "2027-01-01T00:00:00.000Z"),
        text(22, "event-1"),
        text(23, "receipt-1"),
        text(24, "idempotency-1"),
        text(25, digest.clone()),
        text(26, digest.clone()),
        text(27, STANDARD.encode(b"{}")),
        text(28, digest),
    ]
}

fn contract() -> ReceiptZeroPrecommitContractV1 {
    ReceiptZeroPrecommitContractV1::issue_for_test(test_parameters()).expect("valid contract")
}

fn run(
    contract: &ReceiptZeroPrecommitContractV1,
    database: FakeDatabase,
    interrupts: &TestInterrupts,
) -> Result<RunnerResultV1, PrecommitContractErrorV1> {
    let execution = ExecutionControlV1::start_for_test(interrupts).expect("execution control");
    block_on(contract.run(database, &execution))
}

#[test]
fn fixed_statement_pins_the_checked_in_sql_bytes_and_transaction_contract() {
    let statement = FixedStatementArtifactV1;
    statement.validate().expect("fixed statement");
    let source = statement.source().expect("source");
    assert_eq!(
        source,
        include_str!(
            "../../../../src/app/plugins/host/deployment/supabase/backfill/receipt/zero/cas/v1.sql"
        )
    );
    assert_eq!(source.len(), SQL_BYTE_LENGTH);
    assert_eq!(
        <[u8; 32]>::from(Sha256::digest(source.as_bytes())),
        SQL_SHA256
    );
    assert_eq!(
        URL_SAFE_NO_PAD.encode(Sha256::digest(source.as_bytes())),
        "ROtzUuqaSQ8SQa-B49dWe9lP1F2Tcu0wljVFaabAchc"
    );
    assert_eq!(statement.query_id(), QUERY_ID);
    assert_eq!(statement.query_version(), QUERY_VERSION);
    assert_eq!(OVERALL_TIMEOUT, Duration::from_secs(25));
    assert_eq!(
        source.matches("INSERT INTO \"openpencil_release\"").count(),
        3
    );
    assert_eq!(
        source
            .matches("\"pg_catalog\".\"current_setting\"('synchronous_commit') = 'on'")
            .count(),
        1
    );
    assert!(!source.contains("${"));
    assert!(!source.contains("\nBEGIN"));
    assert!(!source.contains("\nCOMMIT"));
    assert!(!source.contains("\nROLLBACK"));
}

#[test]
fn typed_parameter_contract_accepts_exact_nonempty_and_empty_captures() {
    validate_parameters(&test_parameters()).expect("nonempty parameters");
    let mut empty = test_parameters();
    empty[13].value = BoundParameterValueV1::Int8(None);
    empty[14].value = BoundParameterValueV1::Int8(Some(0));
    empty[15].value = BoundParameterValueV1::Int8(Some(0));
    empty[16].value = BoundParameterValueV1::Int8(None);
    empty[17].value = BoundParameterValueV1::Int4(0);
    validate_parameters(&empty).expect("empty parameters");
    assert_eq!(PARAMETER_SCHEMA.first().expect("first").position, 1);
    assert_eq!(PARAMETER_SCHEMA.last().expect("last").position, 28);
}

#[test]
fn journal_material_projects_the_exact_cross_language_golden_tuple() {
    let material = initializer_material_fixture();
    let values = &material.transaction.parameters;
    let source = &material.source;
    let capture = &material.capture;
    let contract = contract_from_initializer_material_for_test(&material)
        .expect("validated journal material projects to the fixed contract");
    let expected = vec![
        text(1, &values.execution_id),
        text(2, &source.application_id),
        text(3, &source.application_digest),
        text(4, &source.migration_id),
        text(5, &source.migration_digest),
        text(6, &source.migration_plan_digest),
        text(7, &source.provider_authority_digest),
        text(8, &source.source_ledger_digest),
        text(9, &values.scope_digest),
        text(10, &values.resource_identity_digest),
        text(11, &capture.catalog_precondition_digest),
        text(12, &values.canonical_scope_base64),
        text(13, &capture.capture_digest),
        int8_value(
            14,
            capture
                .captured_high_water
                .map(|value| i64::try_from(value).expect("golden high water fits")),
        ),
        int8_value(
            15,
            Some(i64::try_from(capture.total_row_count).expect("golden total fits")),
        ),
        int8_value(
            16,
            Some(
                i64::try_from(capture.remaining_null_target_row_count)
                    .expect("golden remaining target fits"),
            ),
        ),
        int8_value(
            17,
            values
                .required_matched_row_count
                .map(|value| i64::try_from(value).expect("golden matched rows fit")),
        ),
        int4_value(
            18,
            i32::try_from(capture.required_batch_receipt_count).expect("golden batch count fits"),
        ),
        int4_value(
            19,
            i32::try_from(capture.batch_size).expect("golden batch size fits"),
        ),
        text(20, &values.initial_execution_status),
        text(21, &values.candidate_committed_at),
        text(22, &values.event_id),
        text(23, &values.receipt_id),
        text(24, &values.idempotency_key),
        text(25, &values.request_digest),
        text(26, &values.receipt_digest),
        text(27, &values.canonical_receipt_base64),
        text(28, &values.unauthenticated_operation_evidence_digest),
    ];
    assert_eq!(contract.parameters_for_test(), expected);

    let mut tampered = material;
    tampered.transaction.parameter_values_digest =
        URL_SAFE_NO_PAD.encode(Sha256::digest(b"detached-parameter-values"));
    assert!(matches!(
        contract_from_initializer_material_for_test(&tampered),
        Err(PrecommitContractErrorV1::InvalidParameterContract)
    ));
}

#[test]
fn typed_parameter_contract_rejects_order_type_encoding_and_cross_field_drift() {
    let mutations: [fn(&mut Vec<BoundParameterV1>); 10] = [
        |values| values.swap(0, 1),
        |values| values[2].value = BoundParameterValueV1::Text("bad-digest".to_owned()),
        |values| {
            values[2].value = BoundParameterValueV1::Text(format!("{}B", "A".repeat(42)));
        },
        |values| {
            values[8].value =
                BoundParameterValueV1::Text(URL_SAFE_NO_PAD.encode(Sha256::digest(b"[]")));
        },
        |values| values[11].value = BoundParameterValueV1::Text("not-base64".to_owned()),
        |values| values[13].value = BoundParameterValueV1::Text("42".to_owned()),
        |values| values[14].value = BoundParameterValueV1::Int8(Some(-1)),
        |values| values[15].value = BoundParameterValueV1::Int8(Some(43)),
        |values| values[17].value = BoundParameterValueV1::Int4(1),
        |values| {
            values[20].value = BoundParameterValueV1::Text("2027-02-30T00:00:00.000Z".to_owned());
        },
    ];
    for mutate in mutations {
        let mut parameters = test_parameters();
        mutate(&mut parameters);
        assert_eq!(
            validate_parameters(&parameters),
            Err(PrecommitContractErrorV1::InvalidParameterContract)
        );
    }
}

#[test]
fn runner_executes_the_exact_bounded_stage_order_and_requires_readback_after_commit() {
    for (raw_status, status) in [
        (b"inserted".as_slice(), ReceiptZeroStatusV1::Inserted),
        (b"exact-replay".as_slice(), ReceiptZeroStatusV1::ExactReplay),
    ] {
        let contract = contract();
        let database = FakeDatabase::successful(raw_status);
        let events = Arc::clone(&database.events);
        let result = run(&contract, database, &TestInterrupts::default()).expect("runner result");
        assert_eq!(result.status, status);
        assert_eq!(result.response_byte_length, raw_status.len());
        assert!(!result.request_dispatch_authenticated);
        assert!(!result.database_authority_created);
        assert!(!result.mutation_authorized);
        assert!(!result.execution_authorized);
        assert!(result.requires_independent_readback);
        assert!(!result.database_cas_readback_verified);
        assert!(!result.settlement_authorized);
        assert!(!result.receipt_v2_issued);
        assert!(!result.automatic_retry_allowed);
        assert!(!result.release_authorized);
        assert_eq!(
            result.remaining_production_blockers,
            REMAINING_PRODUCTION_BLOCKERS
        );
        assert_eq!(
            *events.lock().expect("events lock"),
            vec![
                Event::Begin,
                Event::SearchPath,
                Event::RowSecurity,
                Event::SynchronousCommit,
                Event::StatementTimeout(STATEMENT_TIMEOUT_MS),
                Event::LockTimeout(LOCK_TIMEOUT_MS),
                Event::Prepare {
                    query_id: QUERY_ID,
                    query_version: QUERY_VERSION,
                    byte_length: SQL_BYTE_LENGTH,
                    sha256: SQL_SHA256,
                },
                Event::Execute {
                    parameter_count: PARAMETER_COUNT,
                    limits: TRANSACTION_LIMITS,
                },
                Event::Commit,
            ]
        );
        assert_eq!(
            run(
                &contract,
                FakeDatabase::successful(raw_status),
                &TestInterrupts::default()
            ),
            Err(PrecommitContractErrorV1::AlreadyConsumed)
        );
    }
}

#[test]
fn journal_bound_connector_is_lazy_and_all_stages_share_one_parent_deadline() {
    let journal_clock = Arc::new(JournalTestClock::new());
    let (_temp, journal, window) = inert_live_window(Arc::clone(&journal_clock));
    let interrupts = TestInterrupts::default();
    interrupts.advance(Duration::from_secs(3_600));
    let anchor = ExecutionControlV1::capture_connector_clock_for_test(&interrupts);
    let ceiling = journal
        .consume_receipt_zero_initializer_live_run_window_for_execution_for_test(window)
        .expect("exact live execution ceiling");
    let execution = ExecutionControlV1::start_with_journal_ceiling_for_test(anchor, ceiling)
        .expect("journal-bound execution control");
    let database = FakeDatabase::successful(b"inserted");
    let events = Arc::clone(&database.events);
    let deadlines = Arc::clone(&database.deadlines);
    let contract = contract();
    let future = contract
        .run_connected_for_test(FakeConnector::new(database, ConnectMode::Ready), &execution);
    assert!(events.lock().expect("events lock").is_empty());

    let result = block_on(future).expect("connected runner result");
    assert_eq!(result.status, ReceiptZeroStatusV1::Inserted);
    assert!(result.requires_independent_readback);
    let events = events.lock().expect("events lock");
    assert_eq!(events.first(), Some(&Event::Connect));
    assert_eq!(events.last(), Some(&Event::Commit));
    drop(events);
    let deadlines = deadlines.lock().expect("deadlines lock");
    assert_eq!(deadlines.len(), 10);
    assert!(deadlines
        .iter()
        .all(|(_, deadline)| *deadline == execution.deadline_for_test()));
    assert_eq!(execution.deadline_for_test(), Duration::from_secs(3_625));
}

#[test]
fn ten_second_first_poll_prefix_consumes_ten_seconds_once_not_twice() {
    let journal_clock = Arc::new(JournalTestClock::new());
    let (_temp, journal, window) = inert_live_window(Arc::clone(&journal_clock));
    let interrupts = TestInterrupts::default();
    let anchor = ExecutionControlV1::capture_connector_clock_for_test(&interrupts);

    journal_clock.advance(Duration::from_secs(10));
    interrupts.advance(Duration::from_secs(10));
    let ceiling = journal
        .consume_receipt_zero_initializer_live_run_window_for_execution_for_test(window)
        .expect("remaining journal ceiling");
    let execution = ExecutionControlV1::start_with_journal_ceiling_for_test(anchor, ceiling)
        .expect("clamped execution control");

    assert_eq!(execution.deadline_for_test(), Duration::from_secs(25));
    assert_eq!(
        execution
            .deadline_for_test()
            .checked_sub(interrupts.now())
            .expect("deadline remains in the future"),
        Duration::from_secs(15)
    );
}

#[test]
fn dropping_pending_lazy_connect_cancels_only_the_connect_request() {
    let journal_clock = Arc::new(JournalTestClock::new());
    let (_temp, journal, window) = inert_live_window(journal_clock);
    let interrupts = TestInterrupts::default();
    let anchor = ExecutionControlV1::capture_connector_clock_for_test(&interrupts);
    let ceiling = journal
        .consume_receipt_zero_initializer_live_run_window_for_execution_for_test(window)
        .expect("exact live execution ceiling");
    let execution = ExecutionControlV1::start_with_journal_ceiling_for_test(anchor, ceiling)
        .expect("journal-bound execution control");
    let database = FakeDatabase::successful(b"inserted");
    let events = Arc::clone(&database.events);
    let contract = contract();
    let mut future = Box::pin(contract.run_connected_for_test(
        FakeConnector::new(database, ConnectMode::Pending),
        &execution,
    ));
    assert!(events.lock().expect("events lock").is_empty());
    let waker = Waker::from(Arc::new(ThreadWake(thread::current())));
    let mut context = Context::from_waker(&waker);
    assert!(matches!(
        Pin::as_mut(&mut future).poll(&mut context),
        Poll::Pending
    ));
    drop(future);

    assert_eq!(
        *events.lock().expect("events lock"),
        vec![Event::Connect, Event::CancelConnect]
    );
    assert!(contract.is_burned_for_test());
}

#[test]
fn pending_lazy_connect_timeout_cancels_once_and_never_begins_a_transaction() {
    let journal_clock = Arc::new(JournalTestClock::new());
    let (_temp, journal, window) = inert_live_window(journal_clock);
    let interrupts = TestInterrupts::default();
    let anchor = ExecutionControlV1::capture_connector_clock_for_test(&interrupts);
    let ceiling = journal
        .consume_receipt_zero_initializer_live_run_window_for_execution_for_test(window)
        .expect("exact live execution ceiling");
    let execution = ExecutionControlV1::start_with_journal_ceiling_for_test(anchor, ceiling)
        .expect("journal-bound execution control");
    let database = FakeDatabase::successful(b"inserted");
    let events = Arc::clone(&database.events);
    let contract = contract();
    let mut future = Box::pin(contract.run_connected_for_test(
        FakeConnector::new(database, ConnectMode::Pending),
        &execution,
    ));
    let waker = Waker::from(Arc::new(ThreadWake(thread::current())));
    let mut context = Context::from_waker(&waker);
    assert!(matches!(
        Pin::as_mut(&mut future).poll(&mut context),
        Poll::Pending
    ));
    interrupts.advance(OVERALL_TIMEOUT);
    assert_eq!(
        Pin::as_mut(&mut future).poll(&mut context),
        Poll::Ready(Err(PrecommitContractErrorV1::Database {
            stage: TransactionStageV1::Connect,
            failure: DatabaseFailureV1::TimedOut,
        }))
    );
    drop(future);

    assert_eq!(
        *events.lock().expect("events lock"),
        vec![Event::Connect, Event::CancelConnect]
    );
    assert!(contract.is_burned_for_test());
}

#[test]
fn response_adapter_requires_one_row_one_non_null_text_status_column() {
    let cases: [(QueryResponseV1, PrecommitContractErrorV1); 11] = [
        (Vec::new(), PrecommitContractErrorV1::InvalidRowCount),
        (
            vec![Vec::new(), Vec::new()],
            PrecommitContractErrorV1::InvalidRowCount,
        ),
        (
            vec![Vec::new()],
            PrecommitContractErrorV1::InvalidColumnCount,
        ),
        (
            vec![vec![
                text_column(Some(b"inserted".to_vec())),
                text_column(Some(b"extra".to_vec())),
            ]],
            PrecommitContractErrorV1::InvalidColumnCount,
        ),
        (
            vec![vec![QueryColumnV1 {
                name: "other".to_owned(),
                column_type: DatabaseColumnTypeV1::Text,
                value: Some(b"inserted".to_vec()),
            }]],
            PrecommitContractErrorV1::InvalidColumnMetadata,
        ),
        (
            vec![vec![QueryColumnV1 {
                name: "status".to_owned(),
                column_type: DatabaseColumnTypeV1::Other,
                value: Some(b"inserted".to_vec()),
            }]],
            PrecommitContractErrorV1::InvalidColumnMetadata,
        ),
        (
            vec![vec![text_column(None)]],
            PrecommitContractErrorV1::NullResponse,
        ),
        (
            vec![vec![text_column(Some(Vec::new()))]],
            PrecommitContractErrorV1::EmptyResponse,
        ),
        (
            vec![vec![text_column(Some(vec![
                b'x';
                MAXIMUM_RESPONSE_BYTES + 1
            ]))]],
            PrecommitContractErrorV1::ResponseTooLarge,
        ),
        (
            vec![vec![text_column(Some(b"unexpected".to_vec()))]],
            PrecommitContractErrorV1::InvalidResponse,
        ),
        (
            vec![vec![text_column(Some(vec![0xff]))]],
            PrecommitContractErrorV1::InvalidResponse,
        ),
    ];
    for (rows, expected) in cases {
        let mut database = FakeDatabase::successful(b"inserted");
        database.rows = rows;
        let events = Arc::clone(&database.events);
        assert_eq!(
            run(&contract(), database, &TestInterrupts::default()),
            Err(expected)
        );
        let events = events.lock().expect("events lock");
        assert!(events.contains(&Event::Abort));
        assert!(!events.contains(&Event::Cancel));
        assert!(!events.contains(&Event::Commit));
    }
}

#[test]
fn noncommittable_classifications_always_abort_without_commit_or_cancel() {
    for (raw_status, status) in [
        (
            b"advanced-head".as_slice(),
            ReceiptZeroStatusV1::AdvancedHead,
        ),
        (b"corruption".as_slice(), ReceiptZeroStatusV1::Corruption),
        (
            b"precondition-failed".as_slice(),
            ReceiptZeroStatusV1::PreconditionFailed,
        ),
    ] {
        let database = FakeDatabase::successful(raw_status);
        let events = Arc::clone(&database.events);
        assert_eq!(
            run(&contract(), database, &TestInterrupts::default()),
            Err(PrecommitContractErrorV1::RefusedStatus(status))
        );
        let events = events.lock().expect("events lock");
        assert!(events.contains(&Event::Abort));
        assert!(!events.contains(&Event::Commit));
        assert!(!events.contains(&Event::Cancel));
    }
}

#[test]
fn completed_precommit_database_failures_abort_without_a_late_cancel() {
    for stage in [
        TransactionStageV1::BeginSerializableReadWrite,
        TransactionStageV1::SearchPath,
        TransactionStageV1::RowSecurity,
        TransactionStageV1::SynchronousCommit,
        TransactionStageV1::StatementTimeout,
        TransactionStageV1::LockTimeout,
        TransactionStageV1::Prepare,
        TransactionStageV1::Execute,
    ] {
        let mut database = FakeDatabase::successful(b"inserted");
        database.fail_at = Some((stage, DatabaseFailureV1::Rejected));
        let events = Arc::clone(&database.events);
        let contract = contract();
        assert_eq!(
            run(&contract, database, &TestInterrupts::default()),
            Err(PrecommitContractErrorV1::Database {
                stage,
                failure: DatabaseFailureV1::Rejected,
            })
        );
        let events = events.lock().expect("events lock");
        assert!(!events.contains(&Event::Cancel));
        assert!(events.contains(&Event::Abort));
        assert!(contract.is_burned_for_test());
    }
}

#[test]
fn dropping_each_pending_precommit_stage_cancels_then_aborts() {
    for stage in [
        TransactionStageV1::BeginSerializableReadWrite,
        TransactionStageV1::SearchPath,
        TransactionStageV1::RowSecurity,
        TransactionStageV1::SynchronousCommit,
        TransactionStageV1::StatementTimeout,
        TransactionStageV1::LockTimeout,
        TransactionStageV1::Prepare,
    ] {
        let contract = contract();
        let interrupts = TestInterrupts::default();
        let execution = ExecutionControlV1::start_for_test(&interrupts).expect("execution control");
        let mut database = FakeDatabase::successful(b"inserted");
        database.pending_precommit_stage = Some(stage);
        let events = Arc::clone(&database.events);
        let mut future = Box::pin(contract.run(database, &execution));
        let waker = Waker::from(Arc::new(ThreadWake(thread::current())));
        let mut context = Context::from_waker(&waker);

        assert!(matches!(
            Pin::as_mut(&mut future).poll(&mut context),
            Poll::Pending
        ));
        drop(future);

        let events = events.lock().expect("events lock");
        assert!(
            events.contains(&Event::Cancel),
            "missing cancel at {stage:?}"
        );
        assert!(events.contains(&Event::Abort), "missing abort at {stage:?}");
        assert!(!events.contains(&Event::Commit));
        assert!(contract.is_burned_for_test());
    }
}

#[test]
fn pending_execute_timeout_and_drop_cancel_then_abort() {
    let interrupts = Arc::new(TestInterrupts::default());
    let mut database = FakeDatabase::successful(b"inserted");
    database.timeout_during_execute = Some(Arc::clone(&interrupts));
    let events = Arc::clone(&database.events);
    assert_eq!(
        run(&contract(), database, interrupts.as_ref()),
        Err(PrecommitContractErrorV1::Database {
            stage: TransactionStageV1::Execute,
            failure: DatabaseFailureV1::TimedOut,
        })
    );
    let observed = events.lock().expect("events lock");
    assert!(observed.contains(&Event::Cancel));
    assert!(observed.contains(&Event::Abort));
    assert!(!observed.contains(&Event::Commit));
    drop(observed);

    let contract = contract();
    let interrupts = TestInterrupts::default();
    let execution = ExecutionControlV1::start_for_test(&interrupts).expect("execution control");
    let mut database = FakeDatabase::successful(b"inserted");
    database.hang_execute = true;
    let events = Arc::clone(&database.events);
    let mut future = Box::pin(contract.run(database, &execution));
    let waker = Waker::from(Arc::new(ThreadWake(thread::current())));
    let mut context = Context::from_waker(&waker);
    assert!(matches!(
        Pin::as_mut(&mut future).poll(&mut context),
        Poll::Pending
    ));
    drop(future);
    let observed = events.lock().expect("events lock");
    assert!(observed.contains(&Event::Cancel));
    assert!(observed.contains(&Event::Abort));
    assert!(!observed.contains(&Event::Commit));
    assert!(contract.is_burned_for_test());
}

#[test]
fn commit_timeout_cancel_and_io_are_outcome_unknown_without_cleanup_or_retry() {
    for failure in [
        DatabaseFailureV1::Unavailable,
        DatabaseFailureV1::Cancelled,
        DatabaseFailureV1::TimedOut,
    ] {
        let mut database = FakeDatabase::successful(b"inserted");
        database.fail_at = Some((TransactionStageV1::Commit, failure));
        let events = Arc::clone(&database.events);
        let expected = PrecommitContractErrorV1::CommitOutcomeUnknown { failure };
        assert_eq!(
            run(&contract(), database, &TestInterrupts::default()),
            Err(expected)
        );
        assert!(expected.requires_read_only_reconciliation());
        assert!(!expected.automatic_retry_allowed());
        let events = events.lock().expect("events lock");
        assert!(events.contains(&Event::Commit));
        assert!(!events.contains(&Event::Cancel));
        assert!(!events.contains(&Event::Abort));
    }

    let interrupts = Arc::new(TestInterrupts::default());
    let mut database = FakeDatabase::successful(b"inserted");
    database.timeout_during_commit = Some(Arc::clone(&interrupts));
    let events = Arc::clone(&database.events);
    let expected = PrecommitContractErrorV1::CommitOutcomeUnknown {
        failure: DatabaseFailureV1::TimedOut,
    };
    assert_eq!(
        run(&contract(), database, interrupts.as_ref()),
        Err(expected)
    );
    assert!(expected.requires_read_only_reconciliation());
    assert!(!expected.automatic_retry_allowed());
    let events = events.lock().expect("events lock");
    assert!(events.contains(&Event::Commit));
    assert!(!events.contains(&Event::Cancel));
    assert!(!events.contains(&Event::Abort));

    let interrupts = Arc::new(TestInterrupts::default());
    let mut database = FakeDatabase::successful(b"inserted");
    database.cancel_during_commit = Some(Arc::clone(&interrupts));
    let events = Arc::clone(&database.events);
    let expected = PrecommitContractErrorV1::CommitOutcomeUnknown {
        failure: DatabaseFailureV1::Cancelled,
    };
    assert_eq!(
        run(&contract(), database, interrupts.as_ref()),
        Err(expected)
    );
    assert!(expected.requires_read_only_reconciliation());
    assert!(!expected.automatic_retry_allowed());
    let events = events.lock().expect("events lock");
    assert!(events.contains(&Event::Commit));
    assert!(!events.contains(&Event::Cancel));
    assert!(!events.contains(&Event::Abort));
}

#[test]
fn commit_checks_timeout_and_clock_rollback_before_every_poll_after_first_pending() {
    for (initial, interrupted, failure) in [
        (Duration::ZERO, OVERALL_TIMEOUT, DatabaseFailureV1::TimedOut),
        (
            Duration::from_secs(10),
            Duration::from_secs(9),
            DatabaseFailureV1::Unavailable,
        ),
    ] {
        let contract = contract();
        let interrupts = TestInterrupts::default();
        interrupts.set_now(initial);
        let execution = ExecutionControlV1::start_for_test(&interrupts).expect("execution control");
        let mut database = FakeDatabase::successful(b"inserted");
        database.delay_commit_result = true;
        database.fail_at = Some((TransactionStageV1::Commit, DatabaseFailureV1::Rejected));
        let events = Arc::clone(&database.events);
        let mut future = Box::pin(contract.run(database, &execution));
        let waker = Waker::from(Arc::new(ThreadWake(thread::current())));
        let mut context = Context::from_waker(&waker);

        assert!(matches!(
            Pin::as_mut(&mut future).poll(&mut context),
            Poll::Pending
        ));
        assert!(events.lock().expect("events lock").contains(&Event::Commit));

        interrupts.set_now(interrupted);
        assert_eq!(
            Pin::as_mut(&mut future).poll(&mut context),
            Poll::Ready(Err(PrecommitContractErrorV1::CommitOutcomeUnknown {
                failure,
            }))
        );
        drop(future);

        let observed = events.lock().expect("events lock");
        assert!(observed.contains(&Event::Commit));
        assert!(!observed.contains(&Event::Cancel));
        assert!(!observed.contains(&Event::Abort));
        assert!(contract.is_burned_for_test());
    }
}

#[test]
fn definitive_commit_rejection_aborts_without_cancel() {
    for delayed in [false, true] {
        let mut database = FakeDatabase::successful(b"inserted");
        database.delay_commit_result = delayed;
        database.fail_at = Some((TransactionStageV1::Commit, DatabaseFailureV1::Rejected));
        let events = Arc::clone(&database.events);
        let expected = PrecommitContractErrorV1::Database {
            stage: TransactionStageV1::Commit,
            failure: DatabaseFailureV1::Rejected,
        };
        assert_eq!(
            run(&contract(), database, &TestInterrupts::default()),
            Err(expected)
        );
        // An authenticated rejection remains definitive after a Pending poll, but the durable
        // OutcomeUnknown fence still needs a read-only settlement before the operation can close.
        assert!(expected.requires_read_only_reconciliation());
        assert!(!expected.automatic_retry_allowed());
        let events = events.lock().expect("events lock");
        assert!(events.contains(&Event::Commit));
        assert!(events.contains(&Event::Abort));
        assert!(!events.contains(&Event::Cancel));
    }
}

#[test]
fn cancellation_after_execute_completion_aborts_before_commit_without_request_cancel() {
    let interrupts = Arc::new(TestInterrupts::default());
    let mut database = FakeDatabase::successful(b"inserted");
    database.cancel_after_execute = Some(Arc::clone(&interrupts));
    let events = Arc::clone(&database.events);
    let expected = PrecommitContractErrorV1::Database {
        stage: TransactionStageV1::Commit,
        failure: DatabaseFailureV1::Cancelled,
    };
    assert_eq!(
        run(&contract(), database, interrupts.as_ref()),
        Err(expected)
    );
    assert!(!expected.requires_read_only_reconciliation());
    assert!(!expected.automatic_retry_allowed());
    let events = events.lock().expect("events lock");
    assert!(events
        .iter()
        .any(|event| matches!(event, Event::Execute { .. })));
    assert!(events.contains(&Event::Abort));
    assert!(!events.contains(&Event::Commit));
    assert!(!events.contains(&Event::Cancel));
}

#[test]
fn dropping_a_pending_commit_is_outcome_unknown_and_never_runs_cleanup_hooks() {
    let contract = contract();
    let interrupts = TestInterrupts::default();
    let execution = ExecutionControlV1::start_for_test(&interrupts).expect("execution control");
    let mut database = FakeDatabase::successful(b"inserted");
    database.hang_commit = true;
    let events = Arc::clone(&database.events);
    let mut future = Box::pin(contract.run(database, &execution));
    let waker = Waker::from(Arc::new(ThreadWake(thread::current())));
    let mut context = Context::from_waker(&waker);
    assert!(matches!(
        Pin::as_mut(&mut future).poll(&mut context),
        Poll::Pending
    ));
    drop(future);
    let events = events.lock().expect("events lock");
    assert!(events.contains(&Event::Commit));
    assert!(!events.contains(&Event::Cancel));
    assert!(!events.contains(&Event::Abort));
    assert!(contract.is_burned_for_test());
}

#[test]
fn cancellation_before_begin_creates_no_database_or_transaction_authority() {
    let interrupts = TestInterrupts::default();
    interrupts.cancel();
    let database = FakeDatabase::successful(b"inserted");
    let events = Arc::clone(&database.events);
    assert_eq!(
        run(&contract(), database, &interrupts),
        Err(PrecommitContractErrorV1::Cancelled)
    );
    assert!(events.lock().expect("events lock").is_empty());
}

#[test]
fn runner_future_is_send_and_one_shot() {
    fn require_send<T: Send>(_: &T) {}

    let contract = contract();
    let interrupts = TestInterrupts::default();
    let execution = ExecutionControlV1::start_for_test(&interrupts).expect("execution control");
    let future = contract.run(FakeDatabase::successful(b"inserted"), &execution);
    require_send(&future);
    let result = block_on(future).expect("runner result");
    assert_eq!(result.status, ReceiptZeroStatusV1::Inserted);
    assert!(result.requires_independent_readback);
    assert!(contract.is_burned_for_test());
}
