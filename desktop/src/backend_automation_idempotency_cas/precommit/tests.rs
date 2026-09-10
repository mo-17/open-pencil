use super::*;
use std::{
    future::Future,
    pin::{pin, Pin},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering as AtomicOrdering},
        Arc, Mutex,
    },
    task::{Context, Poll, Wake, Waker},
    thread,
};

const APPLICATION_OBJECT_KEY: &str = "abcdefghijklmnopqrst";

#[derive(Clone, Debug, PartialEq, Eq)]
enum Event {
    Begin,
    SearchPath,
    RowSecurity,
    SynchronousCommit,
    StatementTimeout(u32),
    LockTimeout(u32),
    Prepare {
        query_id: &'static str,
        query_version: &'static str,
        schema_name: String,
        byte_length: usize,
        template_byte_length: usize,
        template_sha256: [u8; 32],
        rendered_sha256: [u8; 32],
    },
    Execute {
        parameter_count: usize,
        limits: TransactionLimitsV1,
    },
    Commit,
    Cancel,
    Abort,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct PreparedStatement {
    query_id: &'static str,
    query_version: &'static str,
    schema_name: String,
    byte_length: usize,
    rendered_sha256: [u8; 32],
}

struct FakeDatabase {
    events: Arc<Mutex<Vec<Event>>>,
    fail_at: Option<(TransactionStageV1, DatabaseFailureV1)>,
    rows: QueryResponseV1,
    hang_execute: bool,
    hang_commit: bool,
    cancel_after_execute: Option<Arc<TestInterrupts>>,
    timeout_during_execute: Option<Arc<TestInterrupts>>,
    timeout_during_commit: Option<Arc<TestInterrupts>>,
    pending_precommit_stage: Option<TransactionStageV1>,
}

impl FakeDatabase {
    fn successful(status: &[u8]) -> Self {
        Self {
            events: Arc::new(Mutex::new(Vec::new())),
            fail_at: None,
            rows: response(status),
            hang_execute: false,
            hang_commit: false,
            cancel_after_execute: None,
            timeout_during_execute: None,
            timeout_during_commit: None,
            pending_precommit_stage: None,
        }
    }

    fn record(&self, event: Event) {
        self.events.lock().expect("events lock").push(event);
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

impl DatabaseSessionV1 for FakeDatabase {
    type PreparedStatement = PreparedStatement;

    async fn begin_serializable_read_write(
        &mut self,
        _control: StageControlV1<'_>,
    ) -> Result<(), DatabaseFailureV1> {
        self.record(Event::Begin);
        self.precommit_stage(TransactionStageV1::BeginSerializableReadWrite)
            .await
    }

    async fn set_local_search_path_pg_catalog(
        &mut self,
        _control: StageControlV1<'_>,
    ) -> Result<(), DatabaseFailureV1> {
        self.record(Event::SearchPath);
        self.precommit_stage(TransactionStageV1::SearchPath).await
    }

    async fn set_local_row_security_off(
        &mut self,
        _control: StageControlV1<'_>,
    ) -> Result<(), DatabaseFailureV1> {
        self.record(Event::RowSecurity);
        self.precommit_stage(TransactionStageV1::RowSecurity).await
    }

    async fn set_local_synchronous_commit_on(
        &mut self,
        _control: StageControlV1<'_>,
    ) -> Result<(), DatabaseFailureV1> {
        self.record(Event::SynchronousCommit);
        self.precommit_stage(TransactionStageV1::SynchronousCommit)
            .await
    }

    async fn set_local_statement_timeout_ms(
        &mut self,
        milliseconds: u32,
        _control: StageControlV1<'_>,
    ) -> Result<(), DatabaseFailureV1> {
        self.record(Event::StatementTimeout(milliseconds));
        self.precommit_stage(TransactionStageV1::StatementTimeout)
            .await
    }

    async fn set_local_lock_timeout_ms(
        &mut self,
        milliseconds: u32,
        _control: StageControlV1<'_>,
    ) -> Result<(), DatabaseFailureV1> {
        self.record(Event::LockTimeout(milliseconds));
        self.precommit_stage(TransactionStageV1::LockTimeout).await
    }

    async fn prepare_fixed_statement(
        &mut self,
        statement: &FixedStatementArtifactV1,
        _control: StageControlV1<'_>,
    ) -> Result<Self::PreparedStatement, DatabaseFailureV1> {
        let prepared = PreparedStatement {
            query_id: statement.query_id(),
            query_version: statement.query_version(),
            schema_name: statement.schema_name.clone(),
            byte_length: statement.byte_length(),
            rendered_sha256: statement.rendered_sha256(),
        };
        self.record(Event::Prepare {
            query_id: prepared.query_id,
            query_version: prepared.query_version,
            schema_name: prepared.schema_name.clone(),
            byte_length: prepared.byte_length,
            template_byte_length: statement.template_byte_length(),
            template_sha256: statement.template_sha256(),
            rendered_sha256: prepared.rendered_sha256,
        });
        self.precommit_stage(TransactionStageV1::Prepare).await?;
        Ok(prepared)
    }

    async fn execute_prepared(
        &mut self,
        statement: Self::PreparedStatement,
        parameters: &[BoundParameterV1],
        limits: TransactionLimitsV1,
        _control: StageControlV1<'_>,
    ) -> Result<QueryResponseV1, DatabaseFailureV1> {
        assert_eq!(statement.query_id, QUERY_ID);
        assert_eq!(statement.query_version, QUERY_VERSION);
        assert_eq!(statement.schema_name, "op_automation_abcdefghijklmnopqrst");
        assert_eq!(
            statement.rendered_sha256,
            <[u8; 32]>::from(Sha256::digest(
                FixedStatementArtifactV1::render(APPLICATION_OBJECT_KEY)
                    .expect("statement")
                    .source()
                    .as_bytes()
            ))
        );
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

    async fn commit(&mut self, _control: StageControlV1<'_>) -> Result<(), DatabaseFailureV1> {
        self.record(Event::Commit);
        self.stage(TransactionStageV1::Commit)?;
        if let Some(interrupts) = &self.timeout_during_commit {
            interrupts.advance(OVERALL_TIMEOUT);
        }
        if self.hang_commit || self.timeout_during_commit.is_some() {
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

fn text_value(position: usize, value: impl Into<String>) -> BoundParameterV1 {
    BoundParameterV1 {
        position: u8::try_from(position).expect("position fits"),
        name: PARAMETER_SCHEMA[position - 1].name,
        value: BoundParameterValueV1::Text(Some(value.into())),
    }
}

fn nullable_text(position: usize, value: Option<String>) -> BoundParameterV1 {
    BoundParameterV1 {
        position: u8::try_from(position).expect("position fits"),
        name: PARAMETER_SCHEMA[position - 1].name,
        value: BoundParameterValueV1::Text(value),
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

fn text_array_value(position: usize, values: &[&str]) -> BoundParameterV1 {
    BoundParameterV1 {
        position: u8::try_from(position).expect("position fits"),
        name: PARAMETER_SCHEMA[position - 1].name,
        value: BoundParameterValueV1::TextArray(
            values.iter().map(|value| (*value).to_owned()).collect(),
        ),
    }
}

fn boolean_value(position: usize, value: bool) -> BoundParameterV1 {
    BoundParameterV1 {
        position: u8::try_from(position).expect("position fits"),
        name: PARAMETER_SCHEMA[position - 1].name,
        value: BoundParameterValueV1::Boolean(value),
    }
}

fn test_documents() -> (CanonicalProposalV1, CanonicalRecordV1) {
    let idempotency_key_digest = digest_base64url(b"idempotency-key");
    let record = CanonicalRecordV1 {
        attempt_ids: vec!["attempt-1".to_owned()],
        automation_id: "automation-1".to_owned(),
        causation_hop: 0,
        causation_id: "causation-1".to_owned(),
        completion_evidence_digest: None,
        created_at: "2027-01-01T00:00:00.000Z".to_owned(),
        current_attempt_id: "attempt-1".to_owned(),
        dispatch_authority_granted: false,
        event_id: "event-1".to_owned(),
        expires_at: "2027-01-02T00:00:00.000Z".to_owned(),
        format: RECORD_FORMAT.to_owned(),
        host_evidence_authenticated: false,
        idempotency_key_digest,
        known_not_dispatched_evidence_digest: None,
        operation_id: "operation-1".to_owned(),
        persistence_authority_granted: false,
        previous_record_digest: None,
        reconciliation_evidence_digest: None,
        recorded_at: "2027-01-01T00:00:00.000Z".to_owned(),
        retention_hours: 24,
        revision: 0,
        state: "reserved".to_owned(),
        version: 1,
    };
    let record_digest = digest_base64url(&serde_json::to_vec(&record).expect("record"));
    let proposal = CanonicalProposalV1 {
        automation_id: record.automation_id.clone(),
        dispatch_authority_granted: false,
        event_id: record.event_id.clone(),
        expected_head_digest: None,
        expected_revision: None,
        format: PROPOSAL_FORMAT.to_owned(),
        host_evidence_authenticated: false,
        idempotency_key_digest: record.idempotency_key_digest.clone(),
        next_record_digest: record_digest,
        next_revision: 0,
        operation_id: record.operation_id.clone(),
        persistence_authority_granted: false,
        version: 1,
    };
    (proposal, record)
}

fn parameters_for(
    proposal: CanonicalProposalV1,
    record: CanonicalRecordV1,
) -> Vec<BoundParameterV1> {
    let proposal_bytes = serde_json::to_vec(&proposal).expect("proposal");
    let record_bytes = serde_json::to_vec(&record).expect("record");
    vec![
        text_value(1, digest_base64url(&proposal_bytes)),
        text_value(2, STANDARD.encode(&proposal_bytes)),
        text_value(3, digest_base64url(&record_bytes)),
        text_value(4, STANDARD.encode(&record_bytes)),
        text_value(5, &record.automation_id),
        text_value(6, &record.event_id),
        text_value(7, &record.operation_id),
        text_value(8, &record.idempotency_key_digest),
        text_value(9, &record.causation_id),
        int4_value(10, record.causation_hop),
        int4_value(11, record.retention_hours),
        text_value(12, &record.created_at),
        text_value(13, &record.expires_at),
        text_value(14, &record.recorded_at),
        int8_value(15, Some(record.revision)),
        int8_value(16, proposal.expected_revision),
        nullable_text(17, proposal.expected_head_digest),
        nullable_text(18, record.previous_record_digest),
        text_array_value(19, &["attempt-1"]),
        text_value(20, &record.current_attempt_id),
        text_value(21, &record.state),
        nullable_text(22, record.completion_evidence_digest),
        nullable_text(23, record.known_not_dispatched_evidence_digest),
        nullable_text(24, record.reconciliation_evidence_digest),
        boolean_value(25, false),
        boolean_value(26, false),
        boolean_value(27, false),
    ]
}

fn test_parameters() -> Vec<BoundParameterV1> {
    let (proposal, record) = test_documents();
    parameters_for(proposal, record)
}

fn successor_documents() -> (CanonicalProposalV1, CanonicalRecordV1) {
    let (_, previous) = test_documents();
    let previous_digest = digest_base64url(&serde_json::to_vec(&previous).expect("previous"));
    let mut record = previous;
    record.previous_record_digest = Some(previous_digest.clone());
    record.recorded_at = "2027-01-01T00:01:00.000Z".to_owned();
    record.revision = 1;
    record.state = "dispatch-started".to_owned();
    let record_digest = digest_base64url(&serde_json::to_vec(&record).expect("record"));
    let proposal = CanonicalProposalV1 {
        automation_id: record.automation_id.clone(),
        dispatch_authority_granted: false,
        event_id: record.event_id.clone(),
        expected_head_digest: Some(previous_digest),
        expected_revision: Some(0),
        format: PROPOSAL_FORMAT.to_owned(),
        host_evidence_authenticated: false,
        idempotency_key_digest: record.idempotency_key_digest.clone(),
        next_record_digest: record_digest,
        next_revision: 1,
        operation_id: record.operation_id.clone(),
        persistence_authority_granted: false,
        version: 1,
    };
    (proposal, record)
}

fn contract() -> AutomationIdempotencyCasPrecommitContractV1 {
    AutomationIdempotencyCasPrecommitContractV1::issue_for_test(
        APPLICATION_OBJECT_KEY,
        test_parameters(),
    )
    .expect("valid contract")
}

fn run(
    contract: &AutomationIdempotencyCasPrecommitContractV1,
    database: FakeDatabase,
    interrupts: &TestInterrupts,
) -> Result<RunnerResultV1, PrecommitContractErrorV1> {
    let execution = ExecutionControlV1::start_for_test(interrupts).expect("execution control");
    block_on(contract.run(database, &execution))
}

#[test]
fn fixed_statement_pins_template_renders_only_the_strict_schema_and_exact_casts() {
    validate_fixed_template().expect("fixed template");
    let template = fixed_sql_template().expect("template");
    assert_eq!(template.len(), SQL_TEMPLATE_BYTE_LENGTH);
    assert_eq!(
        <[u8; 32]>::from(Sha256::digest(template.as_bytes())),
        SQL_TEMPLATE_SHA256
    );
    assert_eq!(
        template.matches(SQL_SCHEMA_SENTINEL).count(),
        SQL_SCHEMA_SENTINEL_COUNT
    );
    assert!(!template.contains('\\'));
    assert!(!template.contains('`'));
    assert!(has_exact_placeholder_cast_contract(template));

    let statement = FixedStatementArtifactV1::render(APPLICATION_OBJECT_KEY).expect("statement");
    statement.validate().expect("fixed statement");
    assert_eq!(statement.query_id(), QUERY_ID);
    assert_eq!(statement.query_version(), QUERY_VERSION);
    assert_eq!(statement.schema_name, "op_automation_abcdefghijklmnopqrst");
    assert!(!statement.source().contains(SQL_SCHEMA_SENTINEL));
    assert_eq!(
        statement.source().matches(&statement.schema_name).count(),
        SQL_SCHEMA_SENTINEL_COUNT
    );
    assert!(!statement.source().contains("${"));
}

#[test]
fn application_key_and_placeholder_contract_reject_near_misses() {
    for key in [
        "abcdefghijklmnopqrs",
        "abcdefghijklmnopqrstu",
        "Abcdefghijklmnopqrst",
        "abcdefghijklmnopqrs/",
        "abcdefghijklmnopqrs@",
    ] {
        assert_eq!(
            FixedStatementArtifactV1::render(key),
            Err(PrecommitContractErrorV1::InvalidApplicationObjectKey)
        );
    }
    let template = fixed_sql_template().expect("template");
    assert!(!has_exact_placeholder_cast_contract(&template.replacen(
        "$27::\"pg_catalog\".\"bool\"",
        "$27::\"pg_catalog\".\"text\"",
        1
    )));
    assert!(!has_exact_placeholder_cast_contract(&template.replacen(
        "$26::\"pg_catalog\".\"bool\"",
        "$25::\"pg_catalog\".\"bool\"",
        1
    )));
    assert!(!has_exact_placeholder_cast_contract(&format!(
        "{template}\n$28::text"
    )));
}

#[test]
fn typed_parameters_verify_exact_canonical_documents_digests_and_bindings() {
    assert!(has_valid_parameter_schema());
    validate_parameters(&test_parameters()).expect("valid parameters");
    let (successor_proposal, successor_record) = successor_documents();
    validate_parameters(&parameters_for(successor_proposal, successor_record))
        .expect("valid successor parameters");
    let (proposal, record) = test_documents();
    assert_eq!(
        STANDARD
            .decode(required_text(&test_parameters(), 2).unwrap())
            .unwrap(),
        serde_json::to_vec(&proposal).unwrap()
    );
    assert_eq!(
        STANDARD
            .decode(required_text(&test_parameters(), 4).unwrap())
            .unwrap(),
        serde_json::to_vec(&record).unwrap()
    );
    assert_eq!(PARAMETER_SCHEMA.first().expect("first").position, 1);
    assert_eq!(PARAMETER_SCHEMA.last().expect("last").position, 27);
}

#[test]
fn typed_parameters_reject_order_type_encoding_canonical_and_cross_field_drift() {
    let mutations: [fn(&mut Vec<BoundParameterV1>); 12] = [
        |values| values.swap(0, 1),
        |values| values[0].value = BoundParameterValueV1::Text(Some("bad-digest".to_owned())),
        |values| values[1].value = BoundParameterValueV1::Text(Some("not-base64".to_owned())),
        |values| {
            let decoded = STANDARD
                .decode(required_text(values, 1 + 1).unwrap())
                .unwrap();
            let mut value: serde_json::Value = serde_json::from_slice(&decoded).unwrap();
            value
                .as_object_mut()
                .unwrap()
                .insert("unknown".to_owned(), serde_json::json!(true));
            values[1].value = BoundParameterValueV1::Text(Some(
                STANDARD.encode(serde_json::to_vec(&value).unwrap()),
            ));
        },
        |values| {
            let decoded = STANDARD.decode(required_text(values, 2).unwrap()).unwrap();
            values[1].value = BoundParameterValueV1::Text(Some(
                STANDARD.encode([b" ".as_slice(), decoded.as_slice()].concat()),
            ));
        },
        |values| values[4].value = BoundParameterValueV1::Text(Some("other-automation".to_owned())),
        |values| values[9].value = BoundParameterValueV1::Int4(MAXIMUM_CAUSATION_HOP + 1),
        |values| values[10].value = BoundParameterValueV1::Int4(0),
        |values| values[14].value = BoundParameterValueV1::Int8(Some(1)),
        |values| {
            values[18].value = BoundParameterValueV1::TextArray(vec![
                "attempt-1".to_owned(),
                "attempt-1".to_owned(),
            ])
        },
        |values| values[20].value = BoundParameterValueV1::Text(Some("succeeded".to_owned())),
        |values| values[24].value = BoundParameterValueV1::Boolean(true),
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
fn canonical_documents_reject_semantically_invalid_but_self_digested_records() {
    let (mut proposal, mut record) = successor_documents();
    record.state = "succeeded".to_owned();
    record.completion_evidence_digest = None;
    proposal.next_record_digest = digest_base64url(&serde_json::to_vec(&record).unwrap());
    assert_eq!(
        validate_parameters(&parameters_for(proposal, record)),
        Err(PrecommitContractErrorV1::InvalidParameterContract)
    );

    let (mut proposal, record) = successor_documents();
    proposal.expected_revision = None;
    proposal.expected_head_digest = None;
    assert_eq!(
        validate_parameters(&parameters_for(proposal, record)),
        Err(PrecommitContractErrorV1::InvalidParameterContract)
    );
}

#[test]
fn canonical_timestamp_parser_matches_leap_day_and_rejects_calendar_drift() {
    assert!(parse_timestamp_millis("2024-02-29T23:59:59.999Z").is_some());
    for invalid in [
        "2023-02-29T00:00:00.000Z",
        "2027-01-01T24:00:00.000Z",
        "0000-01-01T00:00:00.000Z",
        "2027-01-01T00:00:00Z",
    ] {
        assert_eq!(parse_timestamp_millis(invalid), None);
    }
    assert_eq!(
        parse_timestamp_millis("2027-01-02T00:00:00.000Z").unwrap()
            - parse_timestamp_millis("2027-01-01T00:00:00.000Z").unwrap(),
        86_400_000
    );
}

#[test]
fn runner_executes_exact_bounded_order_and_commits_only_positive_states() {
    for (raw_status, status) in [
        (
            b"inserted".as_slice(),
            AutomationIdempotencyCasStatusV1::Inserted,
        ),
        (
            b"advanced-head".as_slice(),
            AutomationIdempotencyCasStatusV1::AdvancedHead,
        ),
        (
            b"exact-replay".as_slice(),
            AutomationIdempotencyCasStatusV1::ExactReplay,
        ),
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
        assert!(!result.database_cas_readback_verified);
        assert!(!result.receipt_v2_issued);
        assert!(!result.automatic_retry_allowed);
        assert!(!result.release_authorized);
        assert_eq!(
            result.remaining_production_blockers,
            REMAINING_PRODUCTION_BLOCKERS
        );
        let events = events.lock().expect("events lock");
        let statement =
            FixedStatementArtifactV1::render(APPLICATION_OBJECT_KEY).expect("statement");
        assert_eq!(
            *events,
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
                    schema_name: statement.schema_name.clone(),
                    byte_length: statement.byte_length(),
                    template_byte_length: SQL_TEMPLATE_BYTE_LENGTH,
                    template_sha256: SQL_TEMPLATE_SHA256,
                    rendered_sha256: statement.rendered_sha256(),
                },
                Event::Execute {
                    parameter_count: PARAMETER_COUNT,
                    limits: TRANSACTION_LIMITS,
                },
                Event::Commit,
            ]
        );
        drop(events);
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
fn response_adapter_requires_one_row_one_non_null_text_column_with_closed_status() {
    let cases = [
        (Vec::new(), PrecommitContractErrorV1::InvalidRowCount),
        (
            vec![vec![], vec![]],
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
fn refused_classifications_abort_without_commit_or_cancel() {
    for (raw_status, status) in [
        (
            b"cas-conflict".as_slice(),
            AutomationIdempotencyCasStatusV1::CasConflict,
        ),
        (
            b"corruption".as_slice(),
            AutomationIdempotencyCasStatusV1::Corruption,
        ),
        (
            b"precondition-failed".as_slice(),
            AutomationIdempotencyCasStatusV1::PreconditionFailed,
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

    let mut rejected_execute = FakeDatabase::successful(b"inserted");
    rejected_execute.fail_at = Some((TransactionStageV1::Execute, DatabaseFailureV1::Rejected));
    let events = Arc::clone(&rejected_execute.events);
    assert_eq!(
        run(&contract(), rejected_execute, &TestInterrupts::default()),
        Err(PrecommitContractErrorV1::Database {
            stage: TransactionStageV1::Execute,
            failure: DatabaseFailureV1::Rejected,
        })
    );
    let events = events.lock().expect("events lock");
    assert!(events.contains(&Event::Abort));
    assert!(!events.contains(&Event::Cancel));
    drop(events);

    let interrupts = Arc::new(TestInterrupts::default());
    let mut pending_execute = FakeDatabase::successful(b"inserted");
    pending_execute.timeout_during_execute = Some(Arc::clone(&interrupts));
    let events = Arc::clone(&pending_execute.events);
    assert_eq!(
        run(&contract(), pending_execute, interrupts.as_ref()),
        Err(PrecommitContractErrorV1::Database {
            stage: TransactionStageV1::Execute,
            failure: DatabaseFailureV1::TimedOut,
        })
    );
    let events = events.lock().expect("events lock");
    assert!(events.contains(&Event::Abort));
    assert!(events.contains(&Event::Cancel));
    drop(events);

    let mut malformed = FakeDatabase::successful(b"inserted");
    malformed.rows = response(b"invalid");
    let events = Arc::clone(&malformed.events);
    assert_eq!(
        run(&contract(), malformed, &TestInterrupts::default()),
        Err(PrecommitContractErrorV1::InvalidResponse)
    );
    let events = events.lock().expect("events lock");
    assert!(events.contains(&Event::Abort));
    assert!(!events.contains(&Event::Cancel));
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
fn commit_timeout_cancel_and_io_are_outcome_unknown_without_cleanup_or_retry_claim() {
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
}

#[test]
fn definitive_commit_rejection_aborts_without_cancel() {
    let mut database = FakeDatabase::successful(b"inserted");
    database.fail_at = Some((TransactionStageV1::Commit, DatabaseFailureV1::Rejected));
    let events = Arc::clone(&database.events);
    assert_eq!(
        run(&contract(), database, &TestInterrupts::default()),
        Err(PrecommitContractErrorV1::Database {
            stage: TransactionStageV1::Commit,
            failure: DatabaseFailureV1::Rejected,
        })
    );
    let events = events.lock().expect("events lock");
    assert!(events.contains(&Event::Commit));
    assert!(events.contains(&Event::Abort));
    assert!(!events.contains(&Event::Cancel));
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
    assert!(!expected.automatic_retry_allowed());
    assert!(!expected.requires_read_only_reconciliation());
    let events = events.lock().expect("events lock");
    assert!(events
        .iter()
        .any(|event| matches!(event, Event::Execute { .. })));
    assert!(events.contains(&Event::Abort));
    assert!(!events.contains(&Event::Commit));
    assert!(!events.contains(&Event::Cancel));
}

#[test]
fn dropping_pending_execute_cancels_and_aborts_but_dropping_pending_commit_is_unknown() {
    let interrupts = TestInterrupts::default();

    let execute_contract = contract();
    let execution = ExecutionControlV1::start_for_test(&interrupts).expect("execution control");
    let mut execute_database = FakeDatabase::successful(b"inserted");
    execute_database.hang_execute = true;
    let execute_events = Arc::clone(&execute_database.events);
    let mut execute_future = Box::pin(execute_contract.run(execute_database, &execution));
    let waker = Waker::from(Arc::new(ThreadWake(thread::current())));
    let mut context = Context::from_waker(&waker);
    assert!(matches!(
        Pin::as_mut(&mut execute_future).poll(&mut context),
        Poll::Pending
    ));
    drop(execute_future);
    let events = execute_events.lock().expect("events lock");
    assert!(events
        .iter()
        .any(|event| matches!(event, Event::Execute { .. })));
    assert!(events.contains(&Event::Cancel));
    assert!(events.contains(&Event::Abort));
    drop(events);

    let commit_contract = contract();
    let mut commit_database = FakeDatabase::successful(b"inserted");
    commit_database.hang_commit = true;
    let commit_events = Arc::clone(&commit_database.events);
    let mut commit_future = Box::pin(commit_contract.run(commit_database, &execution));
    assert!(matches!(
        Pin::as_mut(&mut commit_future).poll(&mut context),
        Poll::Pending
    ));
    drop(commit_future);
    let events = commit_events.lock().expect("events lock");
    assert!(events.contains(&Event::Commit));
    assert!(!events.contains(&Event::Cancel));
    assert!(!events.contains(&Event::Abort));
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
    assert_eq!(result.status, AutomationIdempotencyCasStatusV1::Inserted);
    assert!(contract.is_burned_for_test());
}
