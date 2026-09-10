use super::*;
use crate::backend_operation_journal::{
    DirectorySync, JournalClock, JournalEntropy, JournalError,
    AUTOMATION_CAS_RECONCILIATION_LEASE_TTL,
};
use std::{
    path::Path,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};
use tempfile::TempDir;

const WALL_START_MS: u64 = 1_800_000_000_000;
const APPLICATION_OBJECT_KEY: &str = "abcde12345abcde12345";
const PROJECT_REF: &str = "abcdefghijklmnopqrst";
const CAPABILITY_TTL: Duration = Duration::from_secs(30);
const CLAIM_LEASE: Duration = Duration::from_secs(5 * 60);

struct ManualClock {
    wall_ms: AtomicU64,
    monotonic_ms: AtomicU64,
}

impl ManualClock {
    fn new() -> Self {
        Self {
            wall_ms: AtomicU64::new(WALL_START_MS),
            monotonic_ms: AtomicU64::new(0),
        }
    }

    fn advance(&self, duration: Duration) {
        let millis = u64::try_from(duration.as_millis()).expect("test duration fits");
        self.wall_ms.fetch_add(millis, Ordering::SeqCst);
        self.monotonic_ms.fetch_add(millis, Ordering::SeqCst);
    }

    fn advance_wall_only(&self, duration: Duration) {
        let millis = u64::try_from(duration.as_millis()).expect("test duration fits");
        self.wall_ms.fetch_add(millis, Ordering::SeqCst);
    }
}

impl JournalClock for ManualClock {
    fn wall_unix_millis(&self) -> Result<u64, JournalError> {
        Ok(self.wall_ms.load(Ordering::SeqCst))
    }

    fn monotonic(&self) -> Duration {
        Duration::from_millis(self.monotonic_ms.load(Ordering::SeqCst))
    }
}

struct CounterEntropy {
    next: AtomicU64,
}

impl CounterEntropy {
    fn new(seed: u64) -> Self {
        Self {
            next: AtomicU64::new(seed),
        }
    }
}

impl JournalEntropy for CounterEntropy {
    fn capability_id(&self) -> Result<[u8; 32], JournalError> {
        let value = self.next.fetch_add(1, Ordering::SeqCst);
        let mut id = [0_u8; 32];
        id[24..].copy_from_slice(&value.to_be_bytes());
        Ok(id)
    }
}

struct ConfirmedDirectorySync;

impl DirectorySync for ConfirmedDirectorySync {
    fn sync(&self, _directory: &Path) -> Result<(), JournalError> {
        Ok(())
    }
}

fn journal(
    temp: &TempDir,
    clock: Arc<ManualClock>,
    entropy_seed: u64,
) -> Arc<BackendOperationJournalV1> {
    Arc::new(BackendOperationJournalV1::with_test_dependencies(
        temp.path().join("app-data"),
        Arc::new(CounterEntropy::new(entropy_seed)),
        clock,
        Arc::new(ConfirmedDirectorySync),
    ))
}

fn digest(label: &str) -> String {
    digest_base64url(label.as_bytes())
}

fn schema_marker_digest(application_object_key: &str) -> String {
    digest_base64url(
        format!(
            "openpencil.supabase-automation-idempotency-ledger.v1;application={application_object_key};object=schema"
        )
        .as_bytes(),
    )
}

fn initial_record() -> CanonicalRecordV1 {
    CanonicalRecordV1 {
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
        idempotency_key_digest: digest("idempotency-key"),
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
    }
}

fn parameter_snapshot() -> AutomationCasParameterSnapshotV1 {
    let record = initial_record();
    let record_bytes = serde_json::to_vec(&record).expect("record");
    let record_digest = digest_base64url(&record_bytes);
    let proposal = CanonicalProposalV1 {
        automation_id: record.automation_id.clone(),
        dispatch_authority_granted: false,
        event_id: record.event_id.clone(),
        expected_head_digest: None,
        expected_revision: None,
        format: PROPOSAL_FORMAT.to_owned(),
        host_evidence_authenticated: false,
        idempotency_key_digest: record.idempotency_key_digest.clone(),
        next_record_digest: record_digest.clone(),
        next_revision: 0,
        operation_id: record.operation_id.clone(),
        persistence_authority_granted: false,
        version: 1,
    };
    let proposal_bytes = serde_json::to_vec(&proposal).expect("proposal");
    AutomationCasParameterSnapshotV1 {
        proposal_digest: digest_base64url(&proposal_bytes),
        canonical_proposal_base64: STANDARD.encode(proposal_bytes),
        record_digest,
        canonical_record_base64: STANDARD.encode(record_bytes),
        automation_id: record.automation_id,
        event_id: record.event_id,
        operation_id: record.operation_id,
        idempotency_key_digest: record.idempotency_key_digest,
        causation_id: record.causation_id,
        causation_hop: record.causation_hop,
        retention_hours: record.retention_hours,
        created_at: record.created_at,
        expires_at: record.expires_at,
        recorded_at: record.recorded_at,
        next_revision: record.revision,
        expected_revision: proposal.expected_revision,
        expected_head_digest: proposal.expected_head_digest,
        previous_record_digest: record.previous_record_digest,
        attempt_ids: record.attempt_ids,
        current_attempt_id: record.current_attempt_id,
        state: record.state,
        completion_evidence_digest: record.completion_evidence_digest,
        known_not_dispatched_evidence_digest: record.known_not_dispatched_evidence_digest,
        reconciliation_evidence_digest: record.reconciliation_evidence_digest,
        host_evidence_authenticated: false,
        persistence_authority_granted: false,
        dispatch_authority_granted: false,
    }
}

pub(crate) fn material(label: &str) -> AutomationCasRecoveryMaterialV1 {
    let parameters = parameter_snapshot();
    let schema_name = format!("op_automation_{APPLICATION_OBJECT_KEY}");
    AutomationCasRecoveryMaterialV1 {
        provider_id: "supabase".to_owned(),
        environment: "staging".to_owned(),
        project_ref: PROJECT_REF.to_owned(),
        account_id: format!("account-{label}"),
        application_object_key: APPLICATION_OBJECT_KEY.to_owned(),
        schema_name: schema_name.clone(),
        write_grant_generation: "11111111-1111-4111-8111-111111111111".to_owned(),
        read_grant_generation: "22222222-2222-4222-8222-222222222222".to_owned(),
        write_credential_incarnation_digest: digest(&format!("write-credential:{label}")),
        read_credential_incarnation_digest: digest(&format!("read-credential:{label}")),
        connection_profile_digest: digest(&format!("connection-profile:{label}")),
        installation_incarnation_digest: digest(&format!("installation:{label}")),
        cas_review_digest: digest(&format!("cas-review:{label}")),
        cas_sql_digest: rendered_sql_digest_for_recovery(APPLICATION_OBJECT_KEY)
            .expect("fixed CAS SQL"),
        reconciliation_review_digest: digest(&format!("reconciliation-review:{label}")),
        reconciliation_sql_template_digest: digest_base64url(
            RECONCILIATION_SQL_TEMPLATE.as_bytes(),
        ),
        reconciliation_sql_digest: digest_base64url(
            RECONCILIATION_SQL_TEMPLATE
                .replace(RECONCILIATION_SCHEMA_SENTINEL, &schema_name)
                .as_bytes(),
        ),
        reconciliation_query_digest: RECONCILIATION_QUERY_DIGEST.to_owned(),
        parameter_schema_digest: PARAMETER_SCHEMA_DIGEST.to_owned(),
        parameter_values_digest: expected_parameter_values_digest(&parameters)
            .expect("valid parameter manifest"),
        schema_marker_digest: schema_marker_digest(APPLICATION_OBJECT_KEY),
        parameters,
    }
}

fn proof(
    material: AutomationCasRecoveryMaterialV1,
) -> Result<SealedAutomationCasRecoveryReviewProofV1, AutomationCasRecoveryErrorV1> {
    SealedAutomationCasRecoveryReviewProofV1::issue_for_test(material)
}

fn error_of<T>(result: Result<T, AutomationCasRecoveryErrorV1>) -> AutomationCasRecoveryErrorV1 {
    match result {
        Ok(_) => panic!("expected recovery error"),
        Err(error) => error,
    }
}

fn assert_material_rejected(mutator: impl FnOnce(&mut AutomationCasRecoveryMaterialV1)) {
    let mut candidate = material("validation");
    mutator(&mut candidate);
    assert!(matches!(
        proof(candidate),
        Err(AutomationCasRecoveryErrorV1::ReviewRejected)
    ));
}

fn refresh_parameter_values_digest(material: &mut AutomationCasRecoveryMaterialV1) {
    material.parameter_values_digest = expected_parameter_values_digest(&material.parameters)
        .expect("test parameter manifest remains serializable");
}

#[test]
fn material_identity_and_digest_shapes_fail_closed() {
    proof(material("valid")).expect("valid recovery material");

    assert_material_rejected(|value| value.provider_id = "postgres".to_owned());
    assert_material_rejected(|value| value.environment = "production".to_owned());
    assert_material_rejected(|value| value.project_ref = "short".to_owned());
    assert_material_rejected(|value| value.account_id = "sb_secret_abc".to_owned());
    assert_material_rejected(|value| value.application_object_key = "short".to_owned());
    assert_material_rejected(|value| {
        value.application_object_key = "sb_secret_abcdefghij".to_owned();
        value.schema_name = "op_automation_sb_secret_abcdefghij".to_owned();
        value.schema_marker_digest = schema_marker_digest(&value.application_object_key);
        value.reconciliation_sql_digest = digest_base64url(
            RECONCILIATION_SQL_TEMPLATE
                .replace(RECONCILIATION_SCHEMA_SENTINEL, &value.schema_name)
                .as_bytes(),
        );
    });
    assert_material_rejected(|value| value.schema_name = "public".to_owned());
    assert_material_rejected(|value| {
        value.application_object_key = "vwxyz12345vwxyz12345".to_owned();
        value.schema_name = "op_automation_vwxyz12345vwxyz12345".to_owned();
    });
    assert_material_rejected(|value| {
        value.reconciliation_sql_template_digest = digest("wrong-template-with-valid-shape");
    });
    assert_material_rejected(|value| {
        value.reconciliation_sql_digest = digest("wrong-rendered-sql-with-valid-shape");
    });
    assert_material_rejected(|value| {
        value.cas_sql_digest = digest("wrong-cas-sql-with-valid-shape");
    });
    assert_material_rejected(|value| {
        value.reconciliation_query_digest = digest("wrong-query-with-valid-shape");
    });
    assert_material_rejected(|value| {
        value.parameter_schema_digest = digest("wrong-schema-with-valid-shape");
    });
    assert_material_rejected(|value| {
        value.parameter_values_digest = digest("wrong-parameter-manifest-with-valid-shape");
    });
    assert_material_rejected(|value| value.write_grant_generation = "not-a-uuid".to_owned());
    assert_material_rejected(|value| value.read_grant_generation = "not-a-uuid".to_owned());
    assert_material_rejected(|value| {
        value.read_grant_generation = value.write_grant_generation.clone();
    });

    let digest_mutators: [fn(&mut AutomationCasRecoveryMaterialV1); 13] = [
        |value| value.write_credential_incarnation_digest = "invalid".to_owned(),
        |value| value.read_credential_incarnation_digest = "invalid".to_owned(),
        |value| value.connection_profile_digest = "invalid".to_owned(),
        |value| value.installation_incarnation_digest = "invalid".to_owned(),
        |value| value.cas_review_digest = "invalid".to_owned(),
        |value| value.cas_sql_digest = "invalid".to_owned(),
        |value| value.reconciliation_review_digest = "invalid".to_owned(),
        |value| value.reconciliation_sql_template_digest = "invalid".to_owned(),
        |value| value.reconciliation_sql_digest = "invalid".to_owned(),
        |value| value.reconciliation_query_digest = "invalid".to_owned(),
        |value| value.parameter_schema_digest = "invalid".to_owned(),
        |value| value.parameter_values_digest = "invalid".to_owned(),
        |value| value.schema_marker_digest = "invalid".to_owned(),
    ];
    for mutate in digest_mutators {
        assert_material_rejected(mutate);
    }

    let mut oversized = material("oversized-canonical-record");
    let mut record = initial_record();
    record.automation_id = "a".repeat(256);
    record.event_id = "b".repeat(256);
    record.operation_id = "c".repeat(256);
    record.causation_id = "d".repeat(256);
    let record_bytes = serde_json::to_vec(&record).expect("oversized canonical record");
    assert!(record_bytes.len() > MAXIMUM_CANONICAL_DOCUMENT_BYTES);
    let record_digest = digest_base64url(&record_bytes);
    let proposal = CanonicalProposalV1 {
        automation_id: record.automation_id.clone(),
        dispatch_authority_granted: false,
        event_id: record.event_id.clone(),
        expected_head_digest: None,
        expected_revision: None,
        format: PROPOSAL_FORMAT.to_owned(),
        host_evidence_authenticated: false,
        idempotency_key_digest: record.idempotency_key_digest.clone(),
        next_record_digest: record_digest.clone(),
        next_revision: 0,
        operation_id: record.operation_id.clone(),
        persistence_authority_granted: false,
        version: 1,
    };
    let proposal_bytes = serde_json::to_vec(&proposal).expect("canonical proposal");
    oversized.parameters.proposal_digest = digest_base64url(&proposal_bytes);
    oversized.parameters.canonical_proposal_base64 = STANDARD.encode(proposal_bytes);
    oversized.parameters.record_digest = record_digest;
    oversized.parameters.canonical_record_base64 = STANDARD.encode(record_bytes);
    oversized.parameters.automation_id = record.automation_id;
    oversized.parameters.event_id = record.event_id;
    oversized.parameters.operation_id = record.operation_id;
    oversized.parameters.causation_id = record.causation_id;
    refresh_parameter_values_digest(&mut oversized);
    assert!(matches!(
        proof(oversized),
        Err(AutomationCasRecoveryErrorV1::ReviewRejected)
    ));
}

#[test]
fn journal_progress_preflight_rejects_unpersistable_material_without_leaving_a_fence() {
    let temp = TempDir::new().expect("tempdir");
    let clock = Arc::new(ManualClock::new());
    let journal = journal(&temp, clock, 900);
    let coordinator = AutomationCasRecoveryCoordinatorV1::new(journal);
    let mut rejected = material("progress-preflight");
    rejected.cas_review_digest = format!("sbp_{}", "A".repeat(39));
    assert!(valid_digest(&rejected.cas_review_digest));
    assert_eq!(
        error_of(coordinator.claim(proof(rejected).expect("shape-valid sealed review"))),
        AutomationCasRecoveryErrorV1::ReviewRejected
    );

    let replacement = coordinator
        .claim(proof(material("progress-preflight")).expect("replacement review"))
        .expect("rejected preflight created no durable scope fence");
    assert!(replacement.durably_claimed());
}

#[test]
fn every_parameter_snapshot_field_is_bound_to_the_canonical_documents() {
    let valid = parameter_snapshot();
    let mut cases = Vec::new();

    let mut value = valid.clone();
    value.proposal_digest = digest("different-proposal");
    cases.push(value);
    let mut value = valid.clone();
    value.canonical_proposal_base64 = STANDARD.encode(b"{}");
    cases.push(value);
    let mut value = valid.clone();
    value.record_digest = digest("different-record");
    cases.push(value);
    let mut value = valid.clone();
    value.canonical_record_base64 = STANDARD.encode(b"{}");
    cases.push(value);
    let mut value = valid.clone();
    value.automation_id = "different".to_owned();
    cases.push(value);
    let mut value = valid.clone();
    value.event_id = "different".to_owned();
    cases.push(value);
    let mut value = valid.clone();
    value.operation_id = "different".to_owned();
    cases.push(value);
    let mut value = valid.clone();
    value.idempotency_key_digest = digest("different-key");
    cases.push(value);
    let mut value = valid.clone();
    value.causation_id = "different".to_owned();
    cases.push(value);
    let mut value = valid.clone();
    value.causation_hop = 1;
    cases.push(value);
    let mut value = valid.clone();
    value.retention_hours = 25;
    cases.push(value);
    let mut value = valid.clone();
    value.created_at = "2027-01-01T00:00:01.000Z".to_owned();
    cases.push(value);
    let mut value = valid.clone();
    value.expires_at = "2027-01-03T00:00:00.000Z".to_owned();
    cases.push(value);
    let mut value = valid.clone();
    value.recorded_at = "2027-01-01T00:00:01.000Z".to_owned();
    cases.push(value);
    let mut value = valid.clone();
    value.next_revision = 1;
    cases.push(value);
    let mut value = valid.clone();
    value.expected_revision = Some(0);
    cases.push(value);
    let mut value = valid.clone();
    value.expected_head_digest = Some(digest("expected-head"));
    cases.push(value);
    let mut value = valid.clone();
    value.previous_record_digest = Some(digest("previous-record"));
    cases.push(value);
    let mut value = valid.clone();
    value.attempt_ids = vec!["attempt-2".to_owned()];
    cases.push(value);
    let mut value = valid.clone();
    value.current_attempt_id = "attempt-2".to_owned();
    cases.push(value);
    let mut value = valid.clone();
    value.state = "dispatch-started".to_owned();
    cases.push(value);
    let mut value = valid.clone();
    value.completion_evidence_digest = Some(digest("completion"));
    cases.push(value);
    let mut value = valid.clone();
    value.known_not_dispatched_evidence_digest = Some(digest("not-dispatched"));
    cases.push(value);
    let mut value = valid.clone();
    value.reconciliation_evidence_digest = Some(digest("reconciliation"));
    cases.push(value);
    let mut value = valid.clone();
    value.host_evidence_authenticated = true;
    cases.push(value);
    let mut value = valid.clone();
    value.persistence_authority_granted = true;
    cases.push(value);
    let mut value = valid;
    value.dispatch_authority_granted = true;
    cases.push(value);

    assert_eq!(cases.len(), 27);
    for (index, parameters) in cases.into_iter().enumerate() {
        let mut candidate = material("parameter-tamper");
        candidate.parameters = parameters;
        refresh_parameter_values_digest(&mut candidate);
        assert!(
            matches!(
                proof(candidate),
                Err(AutomationCasRecoveryErrorV1::ReviewRejected)
            ),
            "parameter position {} must be bound",
            index + 1
        );
    }
}

fn replace_canonical_proposal(parameters: &mut AutomationCasParameterSnapshotV1, bytes: Vec<u8>) {
    parameters.proposal_digest = digest_base64url(&bytes);
    parameters.canonical_proposal_base64 = STANDARD.encode(bytes);
}

fn replace_canonical_record(parameters: &mut AutomationCasParameterSnapshotV1, bytes: Vec<u8>) {
    parameters.record_digest = digest_base64url(&bytes);
    parameters.canonical_record_base64 = STANDARD.encode(bytes);
}

#[test]
fn canonical_documents_reject_unknown_noncanonical_and_secret_like_content() {
    let mut trailing_space = material("proposal-space");
    let mut proposal_bytes = STANDARD
        .decode(&trailing_space.parameters.canonical_proposal_base64)
        .expect("proposal base64");
    proposal_bytes.push(b' ');
    replace_canonical_proposal(&mut trailing_space.parameters, proposal_bytes);
    refresh_parameter_values_digest(&mut trailing_space);
    assert!(matches!(
        proof(trailing_space),
        Err(AutomationCasRecoveryErrorV1::ReviewRejected)
    ));

    let mut unknown_record = material("record-unknown");
    let mut record_bytes = STANDARD
        .decode(&unknown_record.parameters.canonical_record_base64)
        .expect("record base64");
    assert_eq!(record_bytes.pop(), Some(b'}'));
    record_bytes.extend_from_slice(b",\"unknown\":true}");
    let record_digest = digest_base64url(&record_bytes);
    replace_canonical_record(&mut unknown_record.parameters, record_bytes);
    let mut proposal: CanonicalProposalV1 = serde_json::from_slice(
        &STANDARD
            .decode(&unknown_record.parameters.canonical_proposal_base64)
            .expect("proposal base64"),
    )
    .expect("proposal JSON");
    proposal.next_record_digest = record_digest;
    replace_canonical_proposal(
        &mut unknown_record.parameters,
        serde_json::to_vec(&proposal).expect("updated proposal"),
    );
    refresh_parameter_values_digest(&mut unknown_record);
    assert!(matches!(
        proof(unknown_record),
        Err(AutomationCasRecoveryErrorV1::ReviewRejected)
    ));

    let mut secret = material("secret-like");
    let mut record = initial_record();
    record.automation_id = "sb_secret_abc".to_owned();
    let record_bytes = serde_json::to_vec(&record).expect("secret-like record");
    let record_digest = digest_base64url(&record_bytes);
    let proposal = CanonicalProposalV1 {
        automation_id: record.automation_id.clone(),
        dispatch_authority_granted: false,
        event_id: record.event_id.clone(),
        expected_head_digest: None,
        expected_revision: None,
        format: PROPOSAL_FORMAT.to_owned(),
        host_evidence_authenticated: false,
        idempotency_key_digest: record.idempotency_key_digest.clone(),
        next_record_digest: record_digest.clone(),
        next_revision: 0,
        operation_id: record.operation_id.clone(),
        persistence_authority_granted: false,
        version: 1,
    };
    let proposal_bytes = serde_json::to_vec(&proposal).expect("secret-like proposal");
    secret.parameters.proposal_digest = digest_base64url(&proposal_bytes);
    secret.parameters.canonical_proposal_base64 = STANDARD.encode(proposal_bytes);
    secret.parameters.record_digest = record_digest;
    secret.parameters.canonical_record_base64 = STANDARD.encode(record_bytes);
    secret.parameters.automation_id = record.automation_id;
    refresh_parameter_values_digest(&mut secret);
    assert!(matches!(
        proof(secret),
        Err(AutomationCasRecoveryErrorV1::ReviewRejected)
    ));
}

#[test]
fn durable_claim_crosses_outcome_unknown_and_keeps_scope_fences() {
    let temp = TempDir::new().expect("tempdir");
    let clock = Arc::new(ManualClock::new());
    let journal = journal(&temp, Arc::clone(&clock), 1);
    let coordinator = AutomationCasRecoveryCoordinatorV1::new(Arc::clone(&journal));
    let reviewed = material("durable-claim");

    let claim = coordinator
        .claim(proof(reviewed.clone()).expect("review proof"))
        .expect("durable claim");
    assert!(claim.durably_claimed());
    assert!(!claim.automatic_retry_allowed());
    assert!(!claim.mutation_authorized());
    assert!(!claim.release_authorized());

    let outcome = claim
        .precommit_outcome_unknown_for_test()
        .expect("durable OutcomeUnknown");
    let single_flight_key = outcome.single_flight_key_for_test().to_owned();
    assert!(valid_digest(&single_flight_key));
    assert!(outcome.belongs_to_journal_for_test(&journal));
    assert!(!outcome.commit_outcome_resolved());
    assert!(!outcome.database_cas_committed());
    assert!(!outcome.capture_consumed());
    assert!(!outcome.automatic_retry_allowed());

    assert_eq!(
        error_of(coordinator.claim(proof(reviewed.clone()).expect("copied proof"))),
        AutomationCasRecoveryErrorV1::ReplayBlocked
    );
    assert_eq!(
        error_of(coordinator.recover_for_test(&single_flight_key)),
        AutomationCasRecoveryErrorV1::LeaseActive
    );

    let mut same_scope_different_plan = reviewed.clone();
    same_scope_different_plan.cas_review_digest = digest("different-plan");
    assert_eq!(
        error_of(coordinator.claim(proof(same_scope_different_plan).expect("same-scope proof"))),
        AutomationCasRecoveryErrorV1::ScopeConflict
    );

    let mut different_scope = reviewed;
    different_scope.application_object_key = "vwxyz12345vwxyz12345".to_owned();
    different_scope.schema_name = "op_automation_vwxyz12345vwxyz12345".to_owned();
    different_scope.schema_marker_digest =
        schema_marker_digest(&different_scope.application_object_key);
    different_scope.reconciliation_sql_digest = digest_base64url(
        RECONCILIATION_SQL_TEMPLATE
            .replace(RECONCILIATION_SCHEMA_SENTINEL, &different_scope.schema_name)
            .as_bytes(),
    );
    different_scope.cas_sql_digest =
        rendered_sql_digest_for_recovery(&different_scope.application_object_key)
            .expect("different fixed CAS SQL");
    let independent = coordinator
        .claim(proof(different_scope).expect("different-scope proof"))
        .expect("different head scope may be independently fenced");
    assert!(independent.durably_claimed());
}

#[test]
fn restart_after_high_water_issues_one_lease_and_durably_consumes_one_read_attempt() {
    let temp = TempDir::new().expect("tempdir");
    let clock = Arc::new(ManualClock::new());
    let reviewed = material("restart");
    let first = journal(&temp, Arc::clone(&clock), 100);
    let first_coordinator = AutomationCasRecoveryCoordinatorV1::new(Arc::clone(&first));
    let outcome = first_coordinator
        .claim(proof(reviewed.clone()).expect("review proof"))
        .expect("claim")
        .precommit_outcome_unknown_for_test()
        .expect("OutcomeUnknown");
    let single_flight_key = outcome.single_flight_key_for_test().to_owned();
    drop(outcome);
    drop(first_coordinator);
    drop(first);

    let restarted = journal(&temp, Arc::clone(&clock), 200);
    let coordinator = AutomationCasRecoveryCoordinatorV1::new(Arc::clone(&restarted));
    assert_eq!(
        error_of(coordinator.recover_for_test(&single_flight_key)),
        AutomationCasRecoveryErrorV1::LeaseActive
    );
    clock.advance(CLAIM_LEASE + Duration::from_millis(1));

    let permit = coordinator
        .recover_for_test(&single_flight_key)
        .expect("restart recovery")
        .begin_for_test()
        .expect("durable reconciliation lease");

    let competing = journal(&temp, Arc::clone(&clock), 300);
    let competing_coordinator = AutomationCasRecoveryCoordinatorV1::new(Arc::clone(&competing));
    let competing_recovery = competing_coordinator
        .recover_for_test(&single_flight_key)
        .expect("recovery capability itself creates no lease");
    assert_eq!(
        error_of(competing_recovery.begin_for_test()),
        AutomationCasRecoveryErrorV1::LeaseActive
    );

    let attempt = permit
        .consume_for_fixed_read_for_test()
        .expect("durably consumed fixed-read attempt");
    assert!(attempt.material_for_fixed_read_for_test() == &reviewed);
    assert!(attempt.belongs_to_journal_for_test(&restarted));
    assert!(!attempt.belongs_to_journal_for_test(&competing));
    assert!(attempt.testing_only());
    assert!(!attempt.specific_installation_authenticated());
    assert!(!attempt.production_transport_authenticated());
    assert!(!attempt.read_only_reconciliation_completed());
    assert!(!attempt.operation_authority_authenticated());
    assert!(!attempt.credential_authority_created());
    assert!(!attempt.transport_authority_created());
    assert!(!attempt.database_authority_created());
    assert!(!attempt.reconciliation_result_authenticated());
    assert!(!attempt.commit_outcome_resolved());
    assert!(!attempt.automatic_retry_allowed());
    assert!(!attempt.mutation_authorized());
    assert!(!attempt.execution_authority_created());
    assert!(!attempt.persistence_authority_granted());
    assert!(!attempt.dispatch_authority_granted());
    assert!(!attempt.receipt_authority_created());
    assert!(!attempt.receipt_v2_issued());
    assert!(!attempt.release_authority_created());
    assert!(!attempt.release_authorized());
    assert!(!attempt.release_ready());
    drop(attempt);

    let still_leased = competing_coordinator
        .recover_for_test(&single_flight_key)
        .expect("OutcomeUnknown remains reconstructable");
    assert_eq!(
        error_of(still_leased.begin_for_test()),
        AutomationCasRecoveryErrorV1::LeaseActive
    );

    clock.advance(AUTOMATION_CAS_RECONCILIATION_LEASE_TTL + Duration::from_millis(1));
    let next_attempt = competing_coordinator
        .recover_for_test(&single_flight_key)
        .expect("expired durable lease permits a later read")
        .begin_for_test()
        .expect("next single lease")
        .consume_for_fixed_read_for_test()
        .expect("next durably consumed read attempt");
    assert!(next_attempt.material_for_fixed_read_for_test() == &reviewed);
}

#[test]
fn drop_and_expiry_never_restore_claim_or_bypass_reconciliation_leases() {
    let claim_temp = TempDir::new().expect("claim tempdir");
    let claim_clock = Arc::new(ManualClock::new());
    let claim_journal = journal(&claim_temp, Arc::clone(&claim_clock), 400);
    let claim_coordinator = AutomationCasRecoveryCoordinatorV1::new(Arc::clone(&claim_journal));
    let reviewed_claim = material("claim-expiry");
    let claim = claim_coordinator
        .claim(proof(reviewed_claim.clone()).expect("claim proof"))
        .expect("claim");
    claim_clock.advance_wall_only(CAPABILITY_TTL);
    assert_eq!(
        error_of(claim.precommit_outcome_unknown_for_test()),
        AutomationCasRecoveryErrorV1::HandleExpired
    );
    assert_eq!(
        error_of(claim_coordinator.claim(proof(reviewed_claim).expect("replayed claim proof"))),
        AutomationCasRecoveryErrorV1::ReplayBlocked
    );

    let detached_temp = TempDir::new().expect("detached tempdir");
    let detached_clock = Arc::new(ManualClock::new());
    let detached_material = material("detached");
    let detached_claim = {
        let owner = journal(&detached_temp, Arc::clone(&detached_clock), 500);
        AutomationCasRecoveryCoordinatorV1::new(Arc::clone(&owner))
            .claim(proof(detached_material.clone()).expect("detached proof"))
            .expect("detached claim")
    };
    assert_eq!(
        error_of(detached_claim.precommit_outcome_unknown_for_test()),
        AutomationCasRecoveryErrorV1::Unavailable
    );
    let restarted = journal(&detached_temp, Arc::clone(&detached_clock), 600);
    assert_eq!(
        error_of(
            AutomationCasRecoveryCoordinatorV1::new(restarted)
                .claim(proof(detached_material).expect("restart proof"))
        ),
        AutomationCasRecoveryErrorV1::ReplayBlocked
    );

    let recovery_temp = TempDir::new().expect("recovery tempdir");
    let recovery_clock = Arc::new(ManualClock::new());
    let recovery_journal = journal(&recovery_temp, Arc::clone(&recovery_clock), 700);
    let recovery_coordinator =
        AutomationCasRecoveryCoordinatorV1::new(Arc::clone(&recovery_journal));
    let outcome = recovery_coordinator
        .claim(proof(material("handle-expiry")).expect("recovery proof"))
        .expect("recovery claim")
        .precommit_outcome_unknown_for_test()
        .expect("recovery OutcomeUnknown");
    let key = outcome.single_flight_key_for_test().to_owned();
    recovery_clock.advance(CLAIM_LEASE + Duration::from_millis(1));

    let recovery = recovery_coordinator
        .recover_for_test(&key)
        .expect("recovery handle");
    recovery_clock.advance_wall_only(CAPABILITY_TTL);
    assert_eq!(
        error_of(recovery.begin_for_test()),
        AutomationCasRecoveryErrorV1::HandleExpired
    );

    let permit = recovery_coordinator
        .recover_for_test(&key)
        .expect("replacement recovery")
        .begin_for_test()
        .expect("permit");
    recovery_clock.advance_wall_only(AUTOMATION_CAS_RECONCILIATION_LEASE_TTL);
    assert_eq!(
        error_of(permit.consume_for_fixed_read_for_test()),
        AutomationCasRecoveryErrorV1::HandleExpired
    );

    let dropped_permit = recovery_coordinator
        .recover_for_test(&key)
        .expect("post-expiry recovery")
        .begin_for_test()
        .expect("replacement permit");
    drop(dropped_permit);
    assert_eq!(
        error_of(
            recovery_coordinator
                .recover_for_test(&key)
                .expect("reconstruct while dropped permit lease is active")
                .begin_for_test()
        ),
        AutomationCasRecoveryErrorV1::LeaseActive
    );
    recovery_clock.advance(AUTOMATION_CAS_RECONCILIATION_LEASE_TTL + Duration::from_millis(1));
    let after_drop = recovery_coordinator
        .recover_for_test(&key)
        .expect("reconstruct after dropped permit expires")
        .begin_for_test()
        .expect("drop did not erase or permanently retain the durable lease")
        .consume_for_fixed_read_for_test()
        .expect("one replacement read attempt");
    assert!(after_drop.belongs_to_journal_for_test(&recovery_journal));
}
