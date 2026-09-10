use super::{
    recovery_composition::{run_recovered_fixed_read_for_test, RecoveryCompositionErrorV1},
    runner::*,
    PARAMETER_SCHEMA_DIGEST, RECONCILIATION_QUERY_DIGEST,
};
use crate::{
    backend_automation_idempotency_cas::recovery::{
        recovery_material_for_composition_test, AutomationCasRecoveryCoordinatorV1,
        AutomationCasRecoveryErrorV1, DurableAutomationCasRecoveryV1,
        SealedAutomationCasRecoveryReviewProofV1,
    },
    backend_operation_journal::{
        BackendOperationJournalV1, DirectorySync, JournalClock, JournalEntropy, JournalError,
        AUTOMATION_CAS_RECONCILIATION_LEASE_TTL,
    },
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use sha2::Digest;
use std::{
    fs,
    future::Future,
    path::{Path, PathBuf},
    pin::pin,
    sync::{Arc, Mutex},
    task::{Context, Poll, Wake, Waker},
    time::Duration,
};
use tempfile::TempDir;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Event {
    BeginReadOnly,
    SearchPath,
    RowSecurity,
    StatementTimeout(u32),
    Prepare,
    Execute,
    Finish,
    Cancel,
    Abort,
}

#[derive(Default)]
struct TestInterrupts {
    cancelled: std::sync::atomic::AtomicBool,
}

impl InterruptSourceV1 for TestInterrupts {
    fn now(&self) -> Duration {
        Duration::ZERO
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(std::sync::atomic::Ordering::Acquire)
    }

    fn register_waker(&self, _deadline: Duration, _waker: &Waker) {}
}

struct NoopWake;

impl Wake for NoopWake {
    fn wake(self: Arc<Self>) {}
}

fn block_on<T>(future: impl Future<Output = T>) -> T {
    let waker = Waker::from(Arc::new(NoopWake));
    let mut context = Context::from_waker(&waker);
    let mut future = pin!(future);
    loop {
        match future.as_mut().poll(&mut context) {
            Poll::Ready(value) => return value,
            Poll::Pending => std::thread::yield_now(),
        }
    }
}

const COMPOSITION_WALL_START_MS: u64 = 1_800_000_000_000;
const CLAIM_HIGH_WATER: Duration = Duration::from_secs(5 * 60);
const RECOVERY_CAPABILITY_TTL: Duration = Duration::from_secs(30);

struct CompositionClock {
    wall_ms: std::sync::atomic::AtomicU64,
    monotonic_ms: std::sync::atomic::AtomicU64,
}

impl CompositionClock {
    fn new() -> Self {
        Self {
            wall_ms: std::sync::atomic::AtomicU64::new(COMPOSITION_WALL_START_MS),
            monotonic_ms: std::sync::atomic::AtomicU64::new(0),
        }
    }

    fn advance(&self, duration: Duration) {
        let millis = u64::try_from(duration.as_millis()).expect("test duration fits");
        self.wall_ms
            .fetch_add(millis, std::sync::atomic::Ordering::SeqCst);
        self.monotonic_ms
            .fetch_add(millis, std::sync::atomic::Ordering::SeqCst);
    }

    fn advance_wall_only(&self, duration: Duration) {
        let millis = u64::try_from(duration.as_millis()).expect("test duration fits");
        self.wall_ms
            .fetch_add(millis, std::sync::atomic::Ordering::SeqCst);
    }
}

impl JournalClock for CompositionClock {
    fn wall_unix_millis(&self) -> Result<u64, JournalError> {
        Ok(self.wall_ms.load(std::sync::atomic::Ordering::SeqCst))
    }

    fn monotonic(&self) -> Duration {
        Duration::from_millis(self.monotonic_ms.load(std::sync::atomic::Ordering::SeqCst))
    }
}

struct CompositionEntropy {
    next: std::sync::atomic::AtomicU64,
}

impl CompositionEntropy {
    fn new(seed: u64) -> Self {
        Self {
            next: std::sync::atomic::AtomicU64::new(seed),
        }
    }
}

impl JournalEntropy for CompositionEntropy {
    fn capability_id(&self) -> Result<[u8; 32], JournalError> {
        let value = self.next.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let mut id = [0_u8; 32];
        id[24..].copy_from_slice(&value.to_be_bytes());
        Ok(id)
    }
}

struct CompositionDirectorySync;

impl DirectorySync for CompositionDirectorySync {
    fn sync(&self, _directory: &Path) -> Result<(), JournalError> {
        Ok(())
    }
}

struct FailAfterCompositionDirectorySync {
    successful_calls: usize,
    calls: std::sync::atomic::AtomicUsize,
}

impl DirectorySync for FailAfterCompositionDirectorySync {
    fn sync(&self, _directory: &Path) -> Result<(), JournalError> {
        let call = self.calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        if call >= self.successful_calls {
            Err(JournalError::Unavailable)
        } else {
            Ok(())
        }
    }
}

struct RecoveryHarness {
    _temp: TempDir,
    journal_path: PathBuf,
    clock: Arc<CompositionClock>,
    journal: Arc<BackendOperationJournalV1>,
    coordinator: AutomationCasRecoveryCoordinatorV1,
    single_flight_key: String,
}

impl RecoveryHarness {
    fn new(label: &str) -> Self {
        Self::new_with_directory_sync(label, Arc::new(CompositionDirectorySync))
    }

    fn new_with_directory_sync(label: &str, directory_sync: Arc<dyn DirectorySync>) -> Self {
        let temp = TempDir::new().expect("composition tempdir");
        let clock = Arc::new(CompositionClock::new());
        let journal = Arc::new(BackendOperationJournalV1::with_test_dependencies(
            temp.path().join("app-data"),
            Arc::new(CompositionEntropy::new(1)),
            clock.clone(),
            directory_sync,
        ));
        let coordinator = AutomationCasRecoveryCoordinatorV1::new(Arc::clone(&journal));
        let proof = SealedAutomationCasRecoveryReviewProofV1::issue_for_test(
            recovery_material_for_composition_test(label),
        )
        .expect("composition review proof");
        let outcome = coordinator
            .claim(proof)
            .expect("composition claim")
            .precommit_outcome_unknown_for_test()
            .expect("composition OutcomeUnknown");
        let single_flight_key = outcome.single_flight_key_for_test().to_owned();
        drop(outcome);
        clock.advance(CLAIM_HIGH_WATER + Duration::from_millis(1));
        let journal_path = temp
            .path()
            .join("app-data/backend-operation-journal/journal.v1.json");
        Self {
            _temp: temp,
            journal_path,
            clock,
            journal,
            coordinator,
            single_flight_key,
        }
    }

    fn recovery(&self) -> DurableAutomationCasRecoveryV1 {
        self.coordinator
            .recover_for_test(&self.single_flight_key)
            .expect("recoverable OutcomeUnknown")
    }

    fn record_json(&self) -> serde_json::Value {
        let envelope: serde_json::Value = serde_json::from_slice(
            &fs::read(&self.journal_path).expect("durable journal remains readable"),
        )
        .expect("journal JSON");
        envelope["body"]["records"][&self.single_flight_key].clone()
    }

    fn assert_outcome_unknown(&self, consumed: Option<bool>) {
        let record = self.record_json();
        assert_eq!(record["state"], serde_json::json!("outcome-unknown"));
        assert!(record["finalEvidence"].is_null());
        match consumed {
            Some(expected) => {
                assert_eq!(record["reconciliationLease"]["consumed"], expected);
            }
            None => assert!(record["reconciliationLease"].is_null()),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Prepared;

struct FakeDatabase {
    events: Arc<Mutex<Vec<Event>>>,
    before_begin: Option<Arc<dyn Fn() + Send + Sync>>,
    expected_parameters: Option<Vec<BoundParameterV1>>,
    fail_stage: Option<ReadStageV1>,
    pending_stage: Option<ReadStageV1>,
    observation: Vec<u8>,
    column_name: &'static str,
    column_type: DatabaseColumnTypeV1,
    declared_nullable: bool,
    value_is_null: bool,
    declared_value_bytes: Option<usize>,
    swallow_extra_row_error: bool,
}

impl FakeDatabase {
    fn successful(observation: &[u8]) -> Self {
        Self {
            events: Arc::new(Mutex::new(Vec::new())),
            before_begin: None,
            expected_parameters: None,
            fail_stage: None,
            pending_stage: None,
            observation: observation.to_vec(),
            column_name: "observation",
            column_type: DatabaseColumnTypeV1::Text,
            declared_nullable: false,
            value_is_null: false,
            declared_value_bytes: None,
            swallow_extra_row_error: false,
        }
    }

    fn record(&self, event: Event) {
        self.events.lock().expect("events lock").push(event);
    }

    async fn stage(&self, stage: ReadStageV1, event: Event) -> Result<(), DatabaseFailureV1> {
        self.record(event);
        if self.pending_stage == Some(stage) {
            std::future::pending::<()>().await;
        }
        if self.fail_stage == Some(stage) {
            Err(DatabaseFailureV1::Rejected)
        } else {
            Ok(())
        }
    }
}

impl DatabaseSessionV1 for FakeDatabase {
    type PreparedStatement = Prepared;

    async fn begin_read_only(
        &mut self,
        _control: StageControlV1<'_>,
    ) -> Result<(), DatabaseFailureV1> {
        if let Some(before_begin) = &self.before_begin {
            before_begin();
        }
        self.stage(ReadStageV1::BeginReadOnly, Event::BeginReadOnly)
            .await
    }

    async fn set_local_search_path_pg_catalog(
        &mut self,
        _control: StageControlV1<'_>,
    ) -> Result<(), DatabaseFailureV1> {
        self.stage(ReadStageV1::SearchPath, Event::SearchPath).await
    }

    async fn set_local_row_security_off(
        &mut self,
        _control: StageControlV1<'_>,
    ) -> Result<(), DatabaseFailureV1> {
        self.stage(ReadStageV1::RowSecurity, Event::RowSecurity)
            .await
    }

    async fn set_local_statement_timeout_ms(
        &mut self,
        milliseconds: u32,
        _control: StageControlV1<'_>,
    ) -> Result<(), DatabaseFailureV1> {
        assert_eq!(milliseconds, STATEMENT_TIMEOUT_MS);
        self.stage(
            ReadStageV1::StatementTimeout,
            Event::StatementTimeout(milliseconds),
        )
        .await
    }

    async fn prepare_fixed_statement(
        &mut self,
        statement: &FixedStatementArtifactV1,
        _control: StageControlV1<'_>,
    ) -> Result<Self::PreparedStatement, DatabaseFailureV1> {
        assert_eq!(
            statement.query_id(),
            "supabase-automation-idempotency-cas-reconciliation"
        );
        assert_eq!(
            statement.query_version(),
            "openpencil-supabase-automation-idempotency-cas-reconciliation-v1"
        );
        assert_eq!(statement.source().len(), statement.byte_length());
        assert_eq!(statement.template_byte_length(), 72_823);
        assert_ne!(statement.rendered_sha256(), [0; 32]);
        self.record(Event::Prepare);
        if self.pending_stage == Some(ReadStageV1::Prepare) {
            std::future::pending::<()>().await;
        }
        if self.fail_stage == Some(ReadStageV1::Prepare) {
            Err(DatabaseFailureV1::Rejected)
        } else {
            Ok(Prepared)
        }
    }

    async fn execute_prepared(
        &mut self,
        _statement: Self::PreparedStatement,
        parameters: &[BoundParameterV1],
        limits: ReadLimitsV1,
        response: &mut BoundedObservationSinkV1,
        _control: StageControlV1<'_>,
    ) -> Result<(), DatabaseFailureV1> {
        assert_eq!(parameters.len(), 27);
        if let Some(expected) = &self.expected_parameters {
            assert_eq!(parameters, expected);
        }
        assert_eq!(limits, READ_LIMITS);
        self.record(Event::Execute);
        if self.pending_stage == Some(ReadStageV1::Execute) {
            std::future::pending::<()>().await;
        }
        if self.fail_stage == Some(ReadStageV1::Execute) {
            return Err(DatabaseFailureV1::Rejected);
        }
        response.begin_row()?;
        let declared_length = self.declared_value_bytes.unwrap_or(self.observation.len());
        response.begin_column(
            self.column_name,
            self.column_type,
            self.declared_nullable,
            self.value_is_null,
            declared_length,
        )?;
        let midpoint = self.observation.len() / 2;
        if midpoint > 0 {
            response.push_value_chunk(&self.observation[..midpoint])?;
        }
        response.push_value_chunk(&self.observation[midpoint..])?;
        response.finish_column()?;
        response.finish_row()?;
        response.finish_response()?;
        if self.swallow_extra_row_error {
            let _ = response.begin_row();
        }
        Ok(())
    }

    async fn finish_read_only(
        &mut self,
        _control: StageControlV1<'_>,
    ) -> Result<(), DatabaseFailureV1> {
        self.stage(ReadStageV1::Finish, Event::Finish).await
    }

    fn abort_read_only(&mut self) {
        self.record(Event::Abort);
    }

    fn cancel_database_request(&mut self) {
        self.record(Event::Cancel);
    }
}

const PARAMETER_NAMES: [&str; 27] = [
    "proposalDigest",
    "canonicalProposalBase64",
    "recordDigest",
    "canonicalRecordBase64",
    "automationId",
    "eventId",
    "operationId",
    "idempotencyKeyDigest",
    "causationId",
    "causationHop",
    "retentionHours",
    "createdAt",
    "expiresAt",
    "recordedAt",
    "nextRevision",
    "expectedRevision",
    "expectedHeadDigest",
    "previousRecordDigest",
    "attemptIds",
    "currentAttemptId",
    "state",
    "completionEvidenceDigest",
    "knownNotDispatchedEvidenceDigest",
    "reconciliationEvidenceDigest",
    "hostEvidenceAuthenticated",
    "persistenceAuthorityGranted",
    "dispatchAuthorityGranted",
];

const APPLICATION_OBJECT_KEY: &str = "abcde12345abcde12345";

fn parameter(position: usize, value: BoundParameterValueV1) -> BoundParameterV1 {
    BoundParameterV1 {
        position: u8::try_from(position).expect("position fits"),
        name: PARAMETER_NAMES[position - 1],
        value,
    }
}

fn parameters() -> Vec<BoundParameterV1> {
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
        format: "openpencil.backend-automation-idempotency-record".to_owned(),
        host_evidence_authenticated: false,
        idempotency_key_digest: digest_base64url(b"idempotency-key"),
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
    let record_bytes = serde_json::to_vec(&record).expect("record");
    let record_digest = digest_base64url(&record_bytes);
    let proposal = CanonicalProposalV1 {
        automation_id: record.automation_id.clone(),
        dispatch_authority_granted: false,
        event_id: record.event_id.clone(),
        expected_head_digest: None,
        expected_revision: None,
        format: "openpencil.backend-automation-idempotency-cas-proposal".to_owned(),
        host_evidence_authenticated: false,
        idempotency_key_digest: record.idempotency_key_digest.clone(),
        next_record_digest: record_digest.clone(),
        next_revision: 0,
        operation_id: record.operation_id.clone(),
        persistence_authority_granted: false,
        version: 1,
    };
    let proposal_bytes = serde_json::to_vec(&proposal).expect("proposal");
    vec![
        parameter(
            1,
            BoundParameterValueV1::Text(Some(digest_base64url(&proposal_bytes))),
        ),
        parameter(
            2,
            BoundParameterValueV1::Text(Some(STANDARD.encode(&proposal_bytes))),
        ),
        parameter(3, BoundParameterValueV1::Text(Some(record_digest))),
        parameter(
            4,
            BoundParameterValueV1::Text(Some(STANDARD.encode(&record_bytes))),
        ),
        parameter(5, BoundParameterValueV1::Text(Some(record.automation_id))),
        parameter(6, BoundParameterValueV1::Text(Some(record.event_id))),
        parameter(7, BoundParameterValueV1::Text(Some(record.operation_id))),
        parameter(
            8,
            BoundParameterValueV1::Text(Some(record.idempotency_key_digest)),
        ),
        parameter(9, BoundParameterValueV1::Text(Some(record.causation_id))),
        parameter(10, BoundParameterValueV1::Int4(record.causation_hop)),
        parameter(11, BoundParameterValueV1::Int4(record.retention_hours)),
        parameter(12, BoundParameterValueV1::Text(Some(record.created_at))),
        parameter(13, BoundParameterValueV1::Text(Some(record.expires_at))),
        parameter(14, BoundParameterValueV1::Text(Some(record.recorded_at))),
        parameter(15, BoundParameterValueV1::Int8(Some(record.revision))),
        parameter(16, BoundParameterValueV1::Int8(None)),
        parameter(17, BoundParameterValueV1::Text(None)),
        parameter(18, BoundParameterValueV1::Text(None)),
        parameter(19, BoundParameterValueV1::TextArray(record.attempt_ids)),
        parameter(
            20,
            BoundParameterValueV1::Text(Some(record.current_attempt_id)),
        ),
        parameter(21, BoundParameterValueV1::Text(Some(record.state))),
        parameter(22, BoundParameterValueV1::Text(None)),
        parameter(23, BoundParameterValueV1::Text(None)),
        parameter(24, BoundParameterValueV1::Text(None)),
        parameter(25, BoundParameterValueV1::Boolean(false)),
        parameter(26, BoundParameterValueV1::Boolean(false)),
        parameter(27, BoundParameterValueV1::Boolean(false)),
    ]
}

fn successor_parameters() -> Vec<BoundParameterV1> {
    let mut parameters = parameters();
    let previous_record_digest = required_parameter_text(&parameters, 3);
    let record_bytes = STANDARD
        .decode(required_parameter_text(&parameters, 4))
        .expect("initial record base64");
    let mut record: CanonicalRecordV1 =
        serde_json::from_slice(&record_bytes).expect("initial record");
    record.previous_record_digest = Some(previous_record_digest.clone());
    record.recorded_at = "2027-01-01T00:01:00.000Z".to_owned();
    record.revision = 1;
    record.state = "dispatch-started".to_owned();
    let next_record_bytes = serde_json::to_vec(&record).expect("successor record");
    let next_record_digest = digest_base64url(&next_record_bytes);

    let proposal_bytes = STANDARD
        .decode(required_parameter_text(&parameters, 2))
        .expect("initial proposal base64");
    let mut proposal: CanonicalProposalV1 =
        serde_json::from_slice(&proposal_bytes).expect("initial proposal");
    proposal.expected_head_digest = Some(previous_record_digest.clone());
    proposal.expected_revision = Some(0);
    proposal.next_record_digest = next_record_digest.clone();
    proposal.next_revision = 1;
    let next_proposal_bytes = serde_json::to_vec(&proposal).expect("successor proposal");

    parameters[0].value = BoundParameterValueV1::Text(Some(digest_base64url(&next_proposal_bytes)));
    parameters[1].value = BoundParameterValueV1::Text(Some(STANDARD.encode(&next_proposal_bytes)));
    parameters[2].value = BoundParameterValueV1::Text(Some(next_record_digest));
    parameters[3].value = BoundParameterValueV1::Text(Some(STANDARD.encode(&next_record_bytes)));
    parameters[13].value = BoundParameterValueV1::Text(Some(record.recorded_at));
    parameters[14].value = BoundParameterValueV1::Int8(Some(1));
    parameters[15].value = BoundParameterValueV1::Int8(Some(0));
    parameters[16].value = BoundParameterValueV1::Text(Some(previous_record_digest.clone()));
    parameters[17].value = BoundParameterValueV1::Text(Some(previous_record_digest));
    parameters[20].value = BoundParameterValueV1::Text(Some(record.state));
    parameters
}

fn parameters_with_automation_id(automation_id: &str) -> Vec<BoundParameterV1> {
    let mut parameters = parameters();
    let record_bytes = STANDARD
        .decode(required_parameter_text(&parameters, 4))
        .expect("record base64");
    let mut record: CanonicalRecordV1 = serde_json::from_slice(&record_bytes).expect("record");
    record.automation_id = automation_id.to_owned();
    let next_record_bytes = serde_json::to_vec(&record).expect("rewritten record");
    let next_record_digest = digest_base64url(&next_record_bytes);

    let proposal_bytes = STANDARD
        .decode(required_parameter_text(&parameters, 2))
        .expect("proposal base64");
    let mut proposal: CanonicalProposalV1 =
        serde_json::from_slice(&proposal_bytes).expect("proposal");
    proposal.automation_id = automation_id.to_owned();
    proposal.next_record_digest = next_record_digest.clone();
    let next_proposal_bytes = serde_json::to_vec(&proposal).expect("rewritten proposal");

    parameters[0].value = BoundParameterValueV1::Text(Some(digest_base64url(&next_proposal_bytes)));
    parameters[1].value = BoundParameterValueV1::Text(Some(STANDARD.encode(&next_proposal_bytes)));
    parameters[2].value = BoundParameterValueV1::Text(Some(next_record_digest));
    parameters[3].value = BoundParameterValueV1::Text(Some(STANDARD.encode(&next_record_bytes)));
    parameters[4].value = BoundParameterValueV1::Text(Some(automation_id.to_owned()));
    parameters
}

fn observation() -> Vec<u8> {
    let parameters = parameters();
    let text = |position: usize| match &parameters[position - 1].value {
        BoundParameterValueV1::Text(Some(value)) => value.clone(),
        _ => panic!("text parameter {position}"),
    };
    serde_json::to_vec(&serde_json::json!({
        "queryVersion": "openpencil-supabase-automation-idempotency-cas-reconciliation-v1",
        "proposalDigest": text(1),
        "recordDigest": text(3),
        "reportedStatus": "precondition-failed",
        "inputValid": false,
        "runtimeReady": false,
        "fullLedgerShapeVerified": false,
        "headCount": 0,
        "headRevision": null,
        "revisionCount": 0,
        "revisionMinimum": null,
        "revisionMaximum": null,
        "exactInitialRevisionCount": 0,
        "exactPredecessorLinkCount": 0,
        "exactHeadTipCount": 0,
        "candidateCount": 0,
        "candidateDigestMatchCount": 0,
        "candidateExactCount": 0,
        "expectedHeadMatchCount": 0,
        "transactionReadOnly": false,
        "databasePrimary": false,
        "sessionReplicationRoleOrigin": false,
        "schemaMarkerDigest": null,
        "serverVersionNum": "160013",
        "snapshotDigest": digest_base64url(b"snapshot"),
        "observedAt": "2027-01-01T00:00:00.000Z"
    }))
    .expect("observation")
}

fn classified_observation(status: ReconciliationStatusV1) -> Vec<u8> {
    if status == ReconciliationStatusV1::PreconditionFailed {
        return observation();
    }
    let mut value: serde_json::Value = serde_json::from_slice(&observation()).expect("base");
    value["inputValid"] = serde_json::json!(true);
    value["runtimeReady"] = serde_json::json!(true);
    value["fullLedgerShapeVerified"] = serde_json::json!(true);
    value["transactionReadOnly"] = serde_json::json!(true);
    value["databasePrimary"] = serde_json::json!(true);
    value["sessionReplicationRoleOrigin"] = serde_json::json!(true);
    value["schemaMarkerDigest"] = serde_json::json!(digest_base64url(
        b"openpencil.supabase-automation-idempotency-ledger.v1;application=abcde12345abcde12345;object=schema"
    ));
    let reported = match status {
        ReconciliationStatusV1::Absent => "absent",
        ReconciliationStatusV1::ExactReplay => "exact-replay",
        ReconciliationStatusV1::AdvancedHead => "advanced-head",
        ReconciliationStatusV1::CasConflict => "cas-conflict",
        ReconciliationStatusV1::Corruption => "corruption",
        ReconciliationStatusV1::PreconditionFailed => unreachable!(),
    };
    value["reportedStatus"] = serde_json::json!(reported);

    if status != ReconciliationStatusV1::Absent {
        value["headCount"] = serde_json::json!(1);
        value["headRevision"] = serde_json::json!(0);
        value["revisionCount"] = serde_json::json!(1);
        value["revisionMinimum"] = serde_json::json!(0);
        value["revisionMaximum"] = serde_json::json!(0);
        value["exactInitialRevisionCount"] = serde_json::json!(1);
        value["exactHeadTipCount"] = serde_json::json!(1);
    }
    match status {
        ReconciliationStatusV1::ExactReplay => {
            value["candidateCount"] = serde_json::json!(1);
            value["candidateDigestMatchCount"] = serde_json::json!(1);
            value["candidateExactCount"] = serde_json::json!(1);
        }
        ReconciliationStatusV1::AdvancedHead => {
            value["headRevision"] = serde_json::json!(1);
            value["revisionCount"] = serde_json::json!(2);
            value["revisionMaximum"] = serde_json::json!(1);
            value["exactPredecessorLinkCount"] = serde_json::json!(1);
            value["candidateCount"] = serde_json::json!(1);
            value["candidateDigestMatchCount"] = serde_json::json!(1);
            value["candidateExactCount"] = serde_json::json!(1);
        }
        ReconciliationStatusV1::CasConflict => {
            value["candidateCount"] = serde_json::json!(1);
        }
        ReconciliationStatusV1::Corruption => {
            value["candidateCount"] = serde_json::json!(1);
            value["candidateDigestMatchCount"] = serde_json::json!(1);
        }
        ReconciliationStatusV1::Absent | ReconciliationStatusV1::PreconditionFailed => {}
    }
    serde_json::to_vec(&value).expect("classified observation")
}

fn required_parameter_text(parameters: &[BoundParameterV1], position: usize) -> String {
    match &parameters[position - 1].value {
        BoundParameterValueV1::Text(Some(value)) => value.clone(),
        _ => panic!("text parameter {position}"),
    }
}

fn review_binding(
    application_object_key: &str,
    parameters: &[BoundParameterV1],
) -> TestingReviewBindingInputV1 {
    let schema_name = format!("op_automation_{application_object_key}");
    let rendered_sql =
        SQL_TEMPLATE_SOURCE.replace("__OPENPENCIL_AUTOMATION_IDEMPOTENCY_SCHEMA__", &schema_name);
    TestingReviewBindingInputV1 {
        review_format:
            "openpencil.supabase-automation-idempotency-cas-reconciliation-review.v1".to_owned(),
        review_digest: digest_base64url(b"review"),
        cas_review_digest: digest_base64url(b"cas-review"),
        query_id: "supabase-automation-idempotency-cas-reconciliation".to_owned(),
        query_version:
            "openpencil-supabase-automation-idempotency-cas-reconciliation-v1".to_owned(),
        application_object_key: application_object_key.to_owned(),
        schema_name,
        reconciliation_sql_template_digest: digest_base64url(SQL_TEMPLATE_SOURCE.as_bytes()),
        reconciliation_sql_digest: digest_base64url(rendered_sql.as_bytes()),
        reconciliation_query_digest: RECONCILIATION_QUERY_DIGEST.to_owned(),
        parameter_schema_digest: PARAMETER_SCHEMA_DIGEST.to_owned(),
        parameter_values_digest: digest_base64url(b"parameter-values"),
        proposal_digest: required_parameter_text(parameters, 1),
        record_digest: required_parameter_text(parameters, 3),
        schema_marker_digest: digest_base64url(
            format!(
                "openpencil.supabase-automation-idempotency-ledger.v1;application={application_object_key};object=schema"
            )
            .as_bytes(),
        ),
        response_column_name: "observation".to_owned(),
        response_column_type: "text".to_owned(),
        response_column_nullable: false,
        response_field_count: 26,
        response_maximum_bytes: MAXIMUM_RESPONSE_BYTES,
        statement_count: 1,
        access_mode: "read-only".to_owned(),
        snapshot_scope: "single-statement".to_owned(),
        testing_only: true,
        review_only: true,
        production_reachable: false,
        automatic_retry_allowed: false,
    }
}

fn issue(
    application_object_key: &str,
    parameters: Vec<BoundParameterV1>,
) -> Result<AutomationReconciliationContractV1, ReconciliationErrorV1> {
    let review = review_binding(application_object_key, &parameters);
    AutomationReconciliationContractV1::issue_for_test(review, parameters)
}

fn contract() -> AutomationReconciliationContractV1 {
    issue(APPLICATION_OBJECT_KEY, parameters()).expect("test contract")
}

fn run(
    contract: &AutomationReconciliationContractV1,
    database: FakeDatabase,
    interrupts: &TestInterrupts,
) -> Result<ReconciliationResultV1, ReconciliationErrorV1> {
    let execution = ExecutionControlV1::start_for_test(interrupts).expect("execution control");
    block_on(contract.run(database, &execution))
}

fn assert_untrusted_composition_result(result: &ReconciliationResultV1) {
    assert!(result.testing_only);
    assert!(!result.specific_installation_authenticated);
    assert!(!result.production_transport_authenticated);
    assert!(!result.read_only_reconciliation_completed);
    assert!(!result.commit_outcome_resolved);
    assert!(!result.database_cas_committed);
    assert!(!result.capture_consumed);
    assert!(!result.operation_authority_authenticated);
    assert!(!result.credential_authority_created);
    assert!(!result.transport_authority_created);
    assert!(!result.database_authority_created);
    assert!(!result.mutation_authority_created);
    assert!(!result.execution_authority_created);
    assert!(!result.receipt_authority_created);
    assert!(!result.release_authority_created);
    assert!(!result.reconciliation_result_authenticated);
    assert!(!result.automatic_retry_allowed);
    assert!(!result.persistence_authority_granted);
    assert!(!result.dispatch_authority_granted);
    assert!(!result.receipt_v2_issued);
    assert!(!result.release_authorized);
    assert!(!result.release_ready);
}

#[test]
fn recovered_composition_derives_exact_parameters_and_keeps_all_six_states_untrusted() {
    for status in [
        ReconciliationStatusV1::Absent,
        ReconciliationStatusV1::ExactReplay,
        ReconciliationStatusV1::AdvancedHead,
        ReconciliationStatusV1::CasConflict,
        ReconciliationStatusV1::Corruption,
        ReconciliationStatusV1::PreconditionFailed,
    ] {
        let harness = RecoveryHarness::new(&format!("composition-{status:?}"));
        let path = harness.journal_path.clone();
        let key = harness.single_flight_key.clone();
        let mut database = FakeDatabase::successful(&classified_observation(status));
        database.expected_parameters = Some(parameters());
        database.before_begin = Some(Arc::new(move || {
            let envelope: serde_json::Value = serde_json::from_slice(
                &fs::read(&path).expect("journal before first database event"),
            )
            .expect("journal JSON before database event");
            assert_eq!(
                envelope["body"]["records"][&key]["reconciliationLease"]["consumed"],
                true
            );
        }));

        let result = block_on(run_recovered_fixed_read_for_test(
            harness.recovery(),
            database,
            &TestInterrupts::default(),
        ))
        .expect("fused recovered read");
        assert_eq!(result.status, status);
        assert_untrusted_composition_result(&result);
        harness.assert_outcome_unknown(Some(true));
        assert!(matches!(
            harness.recovery().begin_for_test(),
            Err(AutomationCasRecoveryErrorV1::LeaseActive)
        ));
    }
}

#[test]
fn recovered_composition_drop_before_first_poll_creates_no_lease_or_database_event() {
    let harness = RecoveryHarness::new("composition-unpolled-drop");
    let database = FakeDatabase::successful(&classified_observation(
        ReconciliationStatusV1::PreconditionFailed,
    ));
    let events = Arc::clone(&database.events);
    let interrupts = TestInterrupts::default();
    let future = run_recovered_fixed_read_for_test(harness.recovery(), database, &interrupts);
    drop(future);

    assert!(events.lock().expect("events lock").is_empty());
    harness.assert_outcome_unknown(None);
    let attempt = harness
        .recovery()
        .begin_for_test()
        .expect("drop created no durable lease")
        .consume_for_fixed_read_for_test()
        .expect("replacement read attempt");
    assert!(attempt.belongs_to_journal_for_test(&harness.journal));
}

#[test]
fn recovered_composition_expired_before_first_poll_fails_before_database() {
    let harness = RecoveryHarness::new("composition-expired-before-poll");
    let database = FakeDatabase::successful(&classified_observation(
        ReconciliationStatusV1::PreconditionFailed,
    ));
    let events = Arc::clone(&database.events);
    let interrupts = TestInterrupts::default();
    let future = run_recovered_fixed_read_for_test(harness.recovery(), database, &interrupts);
    harness.clock.advance_wall_only(RECOVERY_CAPABILITY_TTL);

    assert_eq!(
        block_on(future),
        Err(RecoveryCompositionErrorV1::Recovery(
            AutomationCasRecoveryErrorV1::HandleExpired
        ))
    );
    assert!(events.lock().expect("events lock").is_empty());
    harness.assert_outcome_unknown(None);
}

#[test]
fn recovered_composition_unconfirmed_attempt_durability_fails_before_database() {
    let harness = RecoveryHarness::new_with_directory_sync(
        "composition-unconfirmed-consume",
        Arc::new(FailAfterCompositionDirectorySync {
            successful_calls: 3,
            calls: std::sync::atomic::AtomicUsize::new(0),
        }),
    );
    let database = FakeDatabase::successful(&classified_observation(
        ReconciliationStatusV1::PreconditionFailed,
    ));
    let events = Arc::clone(&database.events);

    assert_eq!(
        block_on(run_recovered_fixed_read_for_test(
            harness.recovery(),
            database,
            &TestInterrupts::default(),
        )),
        Err(RecoveryCompositionErrorV1::Recovery(
            AutomationCasRecoveryErrorV1::DurabilityUnconfirmed
        ))
    );
    assert!(events.lock().expect("events lock").is_empty());
    harness.assert_outcome_unknown(Some(true));
}

#[test]
fn recovered_composition_pending_drop_cancels_aborts_and_retains_deadline_runway() {
    assert!(AUTOMATION_CAS_RECONCILIATION_LEASE_TTL > OVERALL_TIMEOUT);
    let harness = RecoveryHarness::new("composition-pending-drop");
    let mut database = FakeDatabase::successful(&classified_observation(
        ReconciliationStatusV1::PreconditionFailed,
    ));
    database.pending_stage = Some(ReadStageV1::BeginReadOnly);
    let events = Arc::clone(&database.events);
    let interrupts = TestInterrupts::default();
    let mut future = Box::pin(run_recovered_fixed_read_for_test(
        harness.recovery(),
        database,
        &interrupts,
    ));
    let waker = Waker::from(Arc::new(NoopWake));
    let mut context = Context::from_waker(&waker);
    assert!(matches!(future.as_mut().poll(&mut context), Poll::Pending));
    harness.assert_outcome_unknown(Some(true));
    drop(future);

    let events = events.lock().expect("events lock").clone();
    assert_eq!(events, [Event::BeginReadOnly, Event::Cancel, Event::Abort]);
    harness.assert_outcome_unknown(Some(true));

    harness
        .clock
        .advance(OVERALL_TIMEOUT + Duration::from_secs(1));
    assert!(matches!(
        harness.recovery().begin_for_test(),
        Err(AutomationCasRecoveryErrorV1::LeaseActive)
    ));
}

#[test]
fn recovered_composition_rejects_a_different_material_response_without_journal_authority() {
    let harness = RecoveryHarness::new("composition-binding-mismatch");
    let mut observation: serde_json::Value =
        serde_json::from_slice(&classified_observation(ReconciliationStatusV1::Absent))
            .expect("observation");
    observation["proposalDigest"] = serde_json::json!(digest_base64url(b"material-b"));
    let database = FakeDatabase::successful(&serde_json::to_vec(&observation).expect("JSON"));
    let events = Arc::clone(&database.events);

    assert_eq!(
        block_on(run_recovered_fixed_read_for_test(
            harness.recovery(),
            database,
            &TestInterrupts::default(),
        )),
        Err(RecoveryCompositionErrorV1::Reconciliation(
            ReconciliationErrorV1::ResponseBindingMismatch
        ))
    );
    let events = events.lock().expect("events lock");
    assert!(events.contains(&Event::Abort));
    assert!(!events.contains(&Event::Finish));
    drop(events);
    harness.assert_outcome_unknown(Some(true));
}

#[test]
fn success_uses_exact_read_only_stages_and_disarms_after_finish() {
    let expected_observation = observation();
    let database = FakeDatabase::successful(&expected_observation);
    let events = Arc::clone(&database.events);
    let contract = contract();
    let result = run(&contract, database, &TestInterrupts::default()).expect("result");

    assert_eq!(result.observation_json, expected_observation);
    assert_eq!(result.response_byte_length, result.observation_json.len());
    assert!(result.testing_only);
    assert!(!result.specific_installation_authenticated);
    assert!(!result.production_transport_authenticated);
    assert!(!result.read_only_reconciliation_completed);
    assert!(!result.commit_outcome_resolved);
    assert!(!result.database_cas_committed);
    assert!(!result.capture_consumed);
    assert!(!result.operation_authority_authenticated);
    assert!(!result.credential_authority_created);
    assert!(!result.transport_authority_created);
    assert!(!result.database_authority_created);
    assert!(!result.mutation_authority_created);
    assert!(!result.execution_authority_created);
    assert!(!result.receipt_authority_created);
    assert!(!result.release_authority_created);
    assert!(!result.reconciliation_result_authenticated);
    assert!(!result.automatic_retry_allowed);
    assert!(!result.persistence_authority_granted);
    assert!(!result.dispatch_authority_granted);
    assert!(!result.receipt_v2_issued);
    assert!(!result.release_authorized);
    assert!(!result.release_ready);
    assert_eq!(
        *events.lock().expect("events lock"),
        [
            Event::BeginReadOnly,
            Event::SearchPath,
            Event::RowSecurity,
            Event::StatementTimeout(STATEMENT_TIMEOUT_MS),
            Event::Prepare,
            Event::Execute,
            Event::Finish,
        ]
    );
    assert!(contract.is_burned_for_test());
    assert_eq!(
        run(
            &contract,
            FakeDatabase::successful(&observation()),
            &TestInterrupts::default()
        ),
        Err(ReconciliationErrorV1::AlreadyConsumed)
    );
}

#[test]
fn every_ready_database_rejection_aborts_without_late_cancel() {
    for stage in [
        ReadStageV1::BeginReadOnly,
        ReadStageV1::SearchPath,
        ReadStageV1::RowSecurity,
        ReadStageV1::StatementTimeout,
        ReadStageV1::Prepare,
        ReadStageV1::Execute,
        ReadStageV1::Finish,
    ] {
        let mut database = FakeDatabase::successful(&observation());
        database.fail_stage = Some(stage);
        let events = Arc::clone(&database.events);
        assert_eq!(
            run(&contract(), database, &TestInterrupts::default()),
            Err(ReconciliationErrorV1::Database {
                stage,
                failure: DatabaseFailureV1::Rejected,
            })
        );
        let events = events.lock().expect("events lock");
        assert!(events.contains(&Event::Abort), "stage {stage:?}");
        assert!(!events.contains(&Event::Cancel), "stage {stage:?}");
    }
}

#[test]
fn dropping_each_pending_stage_cancels_then_aborts_and_burns() {
    for stage in [
        ReadStageV1::BeginReadOnly,
        ReadStageV1::SearchPath,
        ReadStageV1::RowSecurity,
        ReadStageV1::StatementTimeout,
        ReadStageV1::Prepare,
        ReadStageV1::Execute,
        ReadStageV1::Finish,
    ] {
        let contract = contract();
        let mut database = FakeDatabase::successful(&observation());
        database.pending_stage = Some(stage);
        let events = Arc::clone(&database.events);
        let interrupts = TestInterrupts::default();
        let execution = ExecutionControlV1::start_for_test(&interrupts).expect("control");
        let waker = Waker::from(Arc::new(NoopWake));
        let mut context = Context::from_waker(&waker);
        let mut future = Box::pin(contract.run(database, &execution));
        assert!(matches!(future.as_mut().poll(&mut context), Poll::Pending));
        drop(future);

        let events = events.lock().expect("events lock");
        assert!(events.contains(&Event::Cancel), "stage {stage:?}");
        assert!(events.contains(&Event::Abort), "stage {stage:?}");
        assert!(contract.is_burned_for_test(), "stage {stage:?}");
    }
}

#[test]
fn response_metadata_size_utf8_and_json_fail_closed_without_cancel() {
    let cases = [
        {
            let mut database = FakeDatabase::successful(&observation());
            database.column_name = "wrong";
            database
        },
        {
            let mut database = FakeDatabase::successful(&observation());
            database.column_type = DatabaseColumnTypeV1::Other;
            database
        },
        {
            let mut database = FakeDatabase::successful(&observation());
            database.declared_nullable = true;
            database
        },
        {
            let mut database = FakeDatabase::successful(&observation());
            database.value_is_null = true;
            database
        },
        {
            let mut database = FakeDatabase::successful(&observation());
            database.declared_value_bytes = Some(MAXIMUM_RESPONSE_BYTES + 1);
            database
        },
    ];
    for database in cases {
        let events = Arc::clone(&database.events);
        assert_eq!(
            run(&contract(), database, &TestInterrupts::default()),
            Err(ReconciliationErrorV1::Database {
                stage: ReadStageV1::Execute,
                failure: DatabaseFailureV1::ResponseLimitExceeded,
            })
        );
        let events = events.lock().expect("events lock");
        assert!(events.contains(&Event::Abort));
        assert!(!events.contains(&Event::Cancel));
    }

    let invalid_utf8 = FakeDatabase::successful(&[0xff]);
    let events = Arc::clone(&invalid_utf8.events);
    assert_eq!(
        run(&contract(), invalid_utf8, &TestInterrupts::default()),
        Err(ReconciliationErrorV1::InvalidResponseUtf8)
    );
    assert!(!events.lock().expect("events lock").contains(&Event::Cancel));

    let invalid_json = FakeDatabase::successful(b"not-json");
    let events = Arc::clone(&invalid_json.events);
    assert_eq!(
        run(&contract(), invalid_json, &TestInterrupts::default()),
        Err(ReconciliationErrorV1::InvalidResponseJson)
    );
    assert!(!events.lock().expect("events lock").contains(&Event::Cancel));

    assert_eq!(
        run(
            &contract(),
            FakeDatabase::successful(b"[]"),
            &TestInterrupts::default()
        ),
        Err(ReconciliationErrorV1::InvalidResponseJson)
    );
}

#[test]
fn swallowed_protocol_violation_permanently_poisons_the_response_sink() {
    let mut database = FakeDatabase::successful(&observation());
    database.swallow_extra_row_error = true;
    let events = Arc::clone(&database.events);

    assert_eq!(
        run(&contract(), database, &TestInterrupts::default()),
        Err(ReconciliationErrorV1::InvalidResponseShape)
    );
    let events = events.lock().expect("events lock");
    assert!(events.contains(&Event::Abort));
    assert!(!events.contains(&Event::Cancel));
    assert!(!events.contains(&Event::Finish));
}

#[test]
fn host_truth_table_recomputes_all_six_states() {
    for status in [
        ReconciliationStatusV1::Absent,
        ReconciliationStatusV1::ExactReplay,
        ReconciliationStatusV1::AdvancedHead,
        ReconciliationStatusV1::CasConflict,
        ReconciliationStatusV1::Corruption,
        ReconciliationStatusV1::PreconditionFailed,
    ] {
        let database = FakeDatabase::successful(&classified_observation(status));
        let result =
            run(&contract(), database, &TestInterrupts::default()).expect("classification");
        assert_eq!(result.status, status);
    }
}

#[test]
fn overflow_sentinel_is_corruption_and_reported_status_is_only_a_cross_check() {
    let mut overflow: serde_json::Value = serde_json::from_slice(&classified_observation(
        ReconciliationStatusV1::AdvancedHead,
    ))
    .expect("observation");
    overflow["candidateCount"] = serde_json::json!(2);
    overflow["reportedStatus"] = serde_json::json!("corruption");
    let bytes = serde_json::to_vec(&overflow).expect("overflow");
    let result = run(
        &contract(),
        FakeDatabase::successful(&bytes),
        &TestInterrupts::default(),
    )
    .expect("overflow classification");
    assert_eq!(result.status, ReconciliationStatusV1::Corruption);

    overflow["reportedStatus"] = serde_json::json!("exact-replay");
    let mismatch = serde_json::to_vec(&overflow).expect("mismatch");
    assert_eq!(
        run(
            &contract(),
            FakeDatabase::successful(&mismatch),
            &TestInterrupts::default(),
        ),
        Err(ReconciliationErrorV1::ResponseStatusMismatch)
    );
}

#[test]
fn response_tamper_matrix_rejects_shape_binding_snapshot_and_fact_drift() {
    let valid = classified_observation(ReconciliationStatusV1::Absent);
    let mut missing: serde_json::Value = serde_json::from_slice(&valid).expect("valid");
    missing
        .as_object_mut()
        .expect("object")
        .remove("observedAt");
    let mut extra: serde_json::Value = serde_json::from_slice(&valid).expect("valid");
    extra["extra"] = serde_json::json!(true);
    let valid_text = std::str::from_utf8(&valid).expect("utf8");
    let duplicate = valid_text.replacen(
        '{',
        "{\"queryVersion\":\"openpencil-supabase-automation-idempotency-cas-reconciliation-v1\",",
        1,
    );
    let negative_zero = valid_text.replacen("\"headCount\":0", "\"headCount\":-0", 1);
    for bytes in [
        serde_json::to_vec(&missing).expect("missing"),
        serde_json::to_vec(&extra).expect("extra"),
        duplicate.into_bytes(),
        negative_zero.into_bytes(),
    ] {
        assert_eq!(
            run(
                &contract(),
                FakeDatabase::successful(&bytes),
                &TestInterrupts::default(),
            ),
            Err(ReconciliationErrorV1::InvalidResponseJson)
        );
    }

    let mut binding: serde_json::Value = serde_json::from_slice(&valid).expect("valid");
    binding["proposalDigest"] = serde_json::json!(digest_base64url(b"different"));
    let bytes = serde_json::to_vec(&binding).expect("binding");
    assert_eq!(
        run(
            &contract(),
            FakeDatabase::successful(&bytes),
            &TestInterrupts::default(),
        ),
        Err(ReconciliationErrorV1::ResponseBindingMismatch)
    );

    let mut snapshot: serde_json::Value = serde_json::from_slice(&valid).expect("valid");
    snapshot["transactionReadOnly"] = serde_json::json!(false);
    let bytes = serde_json::to_vec(&snapshot).expect("snapshot");
    assert_eq!(
        run(
            &contract(),
            FakeDatabase::successful(&bytes),
            &TestInterrupts::default(),
        ),
        Err(ReconciliationErrorV1::InvalidResponse)
    );

    let mut gated = snapshot;
    gated["inputValid"] = serde_json::json!(false);
    gated["runtimeReady"] = serde_json::json!(false);
    gated["fullLedgerShapeVerified"] = serde_json::json!(false);
    gated["schemaMarkerDigest"] = serde_json::Value::Null;
    gated["headCount"] = serde_json::json!(1);
    gated["reportedStatus"] = serde_json::json!("precondition-failed");
    let bytes = serde_json::to_vec(&gated).expect("gated");
    assert_eq!(
        run(
            &contract(),
            FakeDatabase::successful(&bytes),
            &TestInterrupts::default(),
        ),
        Err(ReconciliationErrorV1::InvalidResponse)
    );

    let relation_cases = [
        {
            let mut value: serde_json::Value = serde_json::from_slice(&classified_observation(
                ReconciliationStatusV1::ExactReplay,
            ))
            .expect("exact replay");
            value["candidateCount"] = serde_json::json!(2);
            value
        },
        {
            let mut value: serde_json::Value = serde_json::from_slice(&classified_observation(
                ReconciliationStatusV1::AdvancedHead,
            ))
            .expect("advanced head");
            value["exactPredecessorLinkCount"] = serde_json::json!(2);
            value
        },
        {
            let mut value: serde_json::Value = serde_json::from_slice(&classified_observation(
                ReconciliationStatusV1::ExactReplay,
            ))
            .expect("exact replay");
            value["expectedHeadMatchCount"] = serde_json::json!(1);
            value
        },
        {
            let mut value: serde_json::Value = serde_json::from_slice(&classified_observation(
                ReconciliationStatusV1::ExactReplay,
            ))
            .expect("exact replay");
            value["revisionMinimum"] = serde_json::json!(1);
            value
        },
    ];
    for relation in relation_cases {
        let bytes = serde_json::to_vec(&relation).expect("relation case");
        assert_eq!(
            run(
                &contract(),
                FakeDatabase::successful(&bytes),
                &TestInterrupts::default(),
            ),
            Err(ReconciliationErrorV1::InvalidResponse)
        );
    }
}

#[test]
fn trusted_review_binding_and_both_parameter_generations_are_required() {
    issue(APPLICATION_OBJECT_KEY, parameters()).expect("initial parameters");
    issue(APPLICATION_OBJECT_KEY, successor_parameters()).expect("successor parameters");

    let mut cases = Vec::new();
    let mut wrong_query = review_binding(APPLICATION_OBJECT_KEY, &parameters());
    wrong_query.query_version.push_str("-changed");
    cases.push(wrong_query);
    let mut wrong_template = review_binding(APPLICATION_OBJECT_KEY, &parameters());
    wrong_template.reconciliation_sql_template_digest = digest_base64url(b"wrong-template");
    cases.push(wrong_template);
    let mut wrong_render = review_binding(APPLICATION_OBJECT_KEY, &parameters());
    wrong_render.reconciliation_sql_digest = digest_base64url(b"wrong-render");
    cases.push(wrong_render);
    let mut wrong_query_digest = review_binding(APPLICATION_OBJECT_KEY, &parameters());
    wrong_query_digest.reconciliation_query_digest = digest_base64url(b"wrong-query-contract");
    cases.push(wrong_query_digest);
    let mut wrong_parameter_schema = review_binding(APPLICATION_OBJECT_KEY, &parameters());
    wrong_parameter_schema.parameter_schema_digest = digest_base64url(b"wrong-parameter-schema");
    cases.push(wrong_parameter_schema);
    let mut wrong_schema = review_binding(APPLICATION_OBJECT_KEY, &parameters());
    wrong_schema.schema_name = "op_automation_zzzzz12345zzzzz12345".to_owned();
    cases.push(wrong_schema);
    let mut wrong_binding = review_binding(APPLICATION_OBJECT_KEY, &parameters());
    wrong_binding.proposal_digest = digest_base64url(b"wrong-proposal");
    cases.push(wrong_binding);
    let mut wrong_shape = review_binding(APPLICATION_OBJECT_KEY, &parameters());
    wrong_shape.response_field_count = 25;
    cases.push(wrong_shape);
    let mut wrong_policy = review_binding(APPLICATION_OBJECT_KEY, &parameters());
    wrong_policy.automatic_retry_allowed = true;
    cases.push(wrong_policy);

    for review in cases {
        assert!(matches!(
            AutomationReconciliationContractV1::issue_for_test(review, parameters()),
            Err(ReconciliationErrorV1::InvalidReviewBinding)
        ));
    }
}

#[test]
fn canonical_parameter_validation_rejects_secret_like_identifiers() {
    for secret_like_identifier in ["sb_secret_abc", "Abcdefghijklmnopqrstuvwxyz0123456789"] {
        assert!(matches!(
            issue(
                APPLICATION_OBJECT_KEY,
                parameters_with_automation_id(secret_like_identifier),
            ),
            Err(ReconciliationErrorV1::InvalidContract)
        ));
    }
}

#[test]
fn fixed_artifact_and_parameter_tamper_matrix_fail_closed() {
    validate_fixed_template().expect("fixed template");
    assert_eq!(
        recompute_parameter_schema_digest_for_test(),
        PARAMETER_SCHEMA_DIGEST
    );
    assert_eq!(
        recompute_reconciliation_query_digest_for_test(),
        RECONCILIATION_QUERY_DIGEST
    );
    assert_eq!(SQL_TEMPLATE_SOURCE.len(), SQL_TEMPLATE_BYTE_LENGTH);
    assert_eq!(
        <[u8; 32]>::from(sha2::Sha256::digest(SQL_TEMPLATE_SOURCE.as_bytes())),
        SQL_TEMPLATE_SHA256
    );
    assert!(has_exact_placeholder_cast_contract(SQL_TEMPLATE_SOURCE));
    let statement = FixedStatementArtifactV1::render("abcde12345abcde12345").expect("rendered");
    assert_eq!(
        statement.schema_name(),
        "op_automation_abcde12345abcde12345"
    );
    assert!(!statement.source().contains("__OPENPENCIL_"));
    assert_eq!(
        statement.source().matches(statement.schema_name()).count(),
        17
    );
    assert_eq!(statement.template_sha256(), SQL_TEMPLATE_SHA256);
    assert!(matches!(
        issue("short", parameters()),
        Err(ReconciliationErrorV1::InvalidApplicationObjectKey)
    ));

    let mut cases = Vec::new();
    let mut wrong_name = parameters();
    wrong_name[0].name = "wrong";
    cases.push(wrong_name);
    let mut wrong_type = parameters();
    wrong_type[9].value = BoundParameterValueV1::Boolean(false);
    cases.push(wrong_type);
    let mut wrong_digest = parameters();
    wrong_digest[0].value = BoundParameterValueV1::Text(Some("invalid".to_owned()));
    cases.push(wrong_digest);
    let mut wrong_document = parameters();
    wrong_document[3].value = BoundParameterValueV1::Text(Some(STANDARD.encode(b"{}")));
    cases.push(wrong_document);
    let mut wrong_crosslink = parameters();
    wrong_crosslink[4].value = BoundParameterValueV1::Text(Some("different".to_owned()));
    cases.push(wrong_crosslink);
    let mut wrong_timestamp = parameters();
    wrong_timestamp[11].value =
        BoundParameterValueV1::Text(Some("2027-02-30T00:00:00.000Z".to_owned()));
    cases.push(wrong_timestamp);
    let mut duplicate_attempt = parameters();
    duplicate_attempt[18].value =
        BoundParameterValueV1::TextArray(vec!["attempt-1".to_owned(), "attempt-1".to_owned()]);
    cases.push(duplicate_attempt);
    let mut authority_true = parameters();
    authority_true[24].value = BoundParameterValueV1::Boolean(true);
    cases.push(authority_true);
    for parameters in cases {
        assert!(matches!(
            issue(APPLICATION_OBJECT_KEY, parameters),
            Err(ReconciliationErrorV1::InvalidContract)
        ));
    }
}
