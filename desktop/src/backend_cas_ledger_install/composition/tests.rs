use super::*;
use crate::{
    backend_cas_ledger_install::{
        fixed_cas_ledger_install_sql_digest, BackendCasLedgerInstallV1,
        CasLedgerInstallPlanMaterialV1, SealedCasLedgerInstallReviewProofV1,
        CAS_LEDGER_BASE_SQL_DIGEST, CAS_LEDGER_INSTALL_MARKER_PREFIX,
        CAS_LEDGER_INSTALL_MIGRATION_NAME,
    },
    backend_operation_journal::{
        BackendOperationJournalV1, DirectorySync, JournalClock, JournalEntropy, JournalError,
    },
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use parser::{RawColumnTypeV1, RawColumnV1};
use sha2::{Digest, Sha256};
use std::{
    future::{pending, Future},
    path::{Path, PathBuf},
    pin::pin,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    task::{Context, Poll, Wake, Waker},
    thread,
};
use tempfile::TempDir;

const WALL_START_MS: u64 = 1_788_844_800_000;
const INVENTORY_SOURCE: &str = include_str!("expected-inventory-v1.json");

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum EventV1 {
    WriteConnect,
    WriteAuthority,
    Apply,
    ReadConnect,
    ReadAuthority,
    BeginReadOnly,
    SearchPath,
    RowSecurity,
    StatementTimeout,
    Prepare,
    Execute,
    Finish,
    ConnectionCancel,
    WriteCancel,
    WriteDiscard,
    ReadCancel,
    ReadAbort,
    ReadDiscard,
}

const DATABASE_STAGE_CASES: [(CompositionStageV1, EventV1); 12] = [
    (CompositionStageV1::WriteConnect, EventV1::ConnectionCancel),
    (
        CompositionStageV1::WriteProjectAuthority,
        EventV1::WriteCancel,
    ),
    (CompositionStageV1::ApplyMigration, EventV1::WriteCancel),
    (CompositionStageV1::ReadConnect, EventV1::ConnectionCancel),
    (
        CompositionStageV1::ReadProjectAuthority,
        EventV1::ReadCancel,
    ),
    (CompositionStageV1::BeginReadOnly, EventV1::ReadCancel),
    (CompositionStageV1::SearchPath, EventV1::ReadCancel),
    (CompositionStageV1::RowSecurity, EventV1::ReadCancel),
    (CompositionStageV1::StatementTimeout, EventV1::ReadCancel),
    (CompositionStageV1::PrepareVerification, EventV1::ReadCancel),
    (CompositionStageV1::ExecuteVerification, EventV1::ReadCancel),
    (CompositionStageV1::FinishVerification, EventV1::ReadCancel),
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ResponseVariantV1 {
    Exact,
    ExtraRow,
    WrongEcho,
    WrongMarker,
    Oversized,
}

#[derive(Clone, Copy)]
struct BehaviorV1 {
    fail_at: Option<CompositionStageV1>,
    pending_at: Option<CompositionStageV1>,
    authority_mismatch_at: Option<CompositionStageV1>,
    invalid_migration_response: bool,
    response_variant: ResponseVariantV1,
}

impl Default for BehaviorV1 {
    fn default() -> Self {
        Self {
            fail_at: None,
            pending_at: None,
            authority_mismatch_at: None,
            invalid_migration_response: false,
            response_variant: ResponseVariantV1::Exact,
        }
    }
}

struct SharedV1 {
    behavior: BehaviorV1,
    events: Mutex<Vec<EventV1>>,
    journal_file: PathBuf,
    first_database_state: Mutex<Option<String>>,
    marker: String,
}

impl SharedV1 {
    fn event(&self, event: EventV1) {
        if self.events.lock().expect("events").is_empty() {
            *self.first_database_state.lock().expect("first state") =
                journal_state(&self.journal_file);
        }
        self.events.lock().expect("events").push(event);
    }

    fn events(&self) -> Vec<EventV1> {
        self.events.lock().expect("events").clone()
    }
}

async fn gate(
    shared: &Arc<SharedV1>,
    stage: CompositionStageV1,
    event: EventV1,
) -> Result<(), DatabaseFailureV1> {
    shared.event(event);
    if shared.behavior.pending_at == Some(stage) {
        pending::<()>().await;
        unreachable!("pending test stage resumed")
    }
    if shared.behavior.fail_at == Some(stage) {
        Err(DatabaseFailureV1::Rejected)
    } else {
        Ok(())
    }
}

struct FakeConnectorV1 {
    shared: Arc<SharedV1>,
}

impl sealed::ConnectorV1 for FakeConnectorV1 {}

impl DatabaseConnectorV1 for FakeConnectorV1 {
    type WriteSession = FakeWriteSessionV1;
    type ReadSession = FakeReadSessionV1;

    async fn connect_write<'a>(
        &'a mut self,
        binding: &'a DatabaseAuthorityBindingV1,
        _control: StageControlV1<'a>,
    ) -> Result<Self::WriteSession, DatabaseFailureV1> {
        assert!(!binding.read_only);
        gate(
            &self.shared,
            CompositionStageV1::WriteConnect,
            EventV1::WriteConnect,
        )
        .await?;
        Ok(FakeWriteSessionV1 {
            shared: Arc::clone(&self.shared),
        })
    }

    async fn connect_read<'a>(
        &'a mut self,
        binding: &'a DatabaseAuthorityBindingV1,
        _control: StageControlV1<'a>,
    ) -> Result<Self::ReadSession, DatabaseFailureV1> {
        assert!(binding.read_only);
        gate(
            &self.shared,
            CompositionStageV1::ReadConnect,
            EventV1::ReadConnect,
        )
        .await?;
        Ok(FakeReadSessionV1 {
            shared: Arc::clone(&self.shared),
        })
    }

    fn cancel_connection_request(&mut self) {
        self.shared.event(EventV1::ConnectionCancel);
    }
}

struct FakeWriteSessionV1 {
    shared: Arc<SharedV1>,
}

fn observed_authority(
    expected: &DatabaseAuthorityBindingV1,
    mismatch: bool,
) -> ObservedProjectAuthorityV1 {
    ObservedProjectAuthorityV1 {
        project_ref: expected.project_ref.clone(),
        account_id: expected.account_id.clone(),
        grant_generation: if mismatch {
            "33333333-3333-4333-8333-333333333333".to_owned()
        } else {
            expected.grant_generation.clone()
        },
        read_only: expected.read_only,
    }
}

impl WriteSessionV1 for FakeWriteSessionV1 {
    async fn verify_project_authority<'a>(
        &'a mut self,
        expected: &'a DatabaseAuthorityBindingV1,
        _control: StageControlV1<'a>,
    ) -> Result<ObservedProjectAuthorityV1, DatabaseFailureV1> {
        gate(
            &self.shared,
            CompositionStageV1::WriteProjectAuthority,
            EventV1::WriteAuthority,
        )
        .await?;
        Ok(observed_authority(
            expected,
            self.shared.behavior.authority_mismatch_at
                == Some(CompositionStageV1::WriteProjectAuthority),
        ))
    }

    async fn execute_fixed_install_batch<'a>(
        &'a mut self,
        artifact: &'a FixedInstallArtifactV1,
        limits: InstallLimitsV1,
        _control: StageControlV1<'a>,
    ) -> Result<RawMigrationResponseV1, DatabaseFailureV1> {
        assert_eq!(limits, INSTALL_LIMITS);
        assert!(limits.self_transactional_batch);
        assert!(limits.prepare_forbidden);
        assert!(artifact
            .sql
            .starts_with("-- OpenPencil Supabase backfill database CAS ledger review v1.\n"));
        assert!(artifact.sql.contains("\nBEGIN;\n"));
        assert!(artifact.sql.ends_with("COMMIT;\n"));
        assert_eq!(artifact.sql.len(), 9_841);
        assert_eq!(
            URL_SAFE_NO_PAD.encode(Sha256::digest(artifact.sql.as_bytes())),
            artifact.sql_digest
        );
        gate(
            &self.shared,
            CompositionStageV1::ApplyMigration,
            EventV1::Apply,
        )
        .await?;
        Ok(RawMigrationResponseV1 {
            body: if self.shared.behavior.invalid_migration_response {
                br#"{"unexpected":true}"#.to_vec()
            } else {
                b"{}".to_vec()
            },
        })
    }

    fn cancel_database_request(&mut self) {
        self.shared.event(EventV1::WriteCancel);
    }

    fn discard_session(&mut self) {
        self.shared.event(EventV1::WriteDiscard);
    }
}

#[derive(Debug, PartialEq, Eq)]
struct FakePreparedStatementV1;

struct FakeReadSessionV1 {
    shared: Arc<SharedV1>,
}

impl ReadSessionV1 for FakeReadSessionV1 {
    type PreparedStatement = FakePreparedStatementV1;

    async fn verify_project_authority<'a>(
        &'a mut self,
        expected: &'a DatabaseAuthorityBindingV1,
        _control: StageControlV1<'a>,
    ) -> Result<ObservedProjectAuthorityV1, DatabaseFailureV1> {
        gate(
            &self.shared,
            CompositionStageV1::ReadProjectAuthority,
            EventV1::ReadAuthority,
        )
        .await?;
        Ok(observed_authority(
            expected,
            self.shared.behavior.authority_mismatch_at
                == Some(CompositionStageV1::ReadProjectAuthority),
        ))
    }

    async fn begin_read_only<'a>(
        &'a mut self,
        _control: StageControlV1<'a>,
    ) -> Result<(), DatabaseFailureV1> {
        gate(
            &self.shared,
            CompositionStageV1::BeginReadOnly,
            EventV1::BeginReadOnly,
        )
        .await
    }

    async fn set_local_search_path_pg_catalog_public<'a>(
        &'a mut self,
        _control: StageControlV1<'a>,
    ) -> Result<(), DatabaseFailureV1> {
        gate(
            &self.shared,
            CompositionStageV1::SearchPath,
            EventV1::SearchPath,
        )
        .await
    }

    async fn set_local_row_security_off<'a>(
        &'a mut self,
        _control: StageControlV1<'a>,
    ) -> Result<(), DatabaseFailureV1> {
        gate(
            &self.shared,
            CompositionStageV1::RowSecurity,
            EventV1::RowSecurity,
        )
        .await
    }

    async fn set_local_statement_timeout_ms<'a>(
        &'a mut self,
        milliseconds: u32,
        _control: StageControlV1<'a>,
    ) -> Result<(), DatabaseFailureV1> {
        assert_eq!(milliseconds, STATEMENT_TIMEOUT_MS);
        gate(
            &self.shared,
            CompositionStageV1::StatementTimeout,
            EventV1::StatementTimeout,
        )
        .await
    }

    async fn prepare_fixed_verification<'a>(
        &'a mut self,
        artifact: &'a FixedVerificationArtifactV1,
        _control: StageControlV1<'a>,
    ) -> Result<Self::PreparedStatement, DatabaseFailureV1> {
        assert_eq!(artifact.query_id, CAS_LEDGER_VERIFICATION_QUERY_ID);
        assert_eq!(
            artifact.query_version,
            CAS_LEDGER_VERIFICATION_QUERY_VERSION
        );
        assert_eq!(artifact.query_digest, CAS_LEDGER_VERIFICATION_QUERY_DIGEST);
        assert_eq!(artifact.sql, fixed_verification_sql().unwrap());
        gate(
            &self.shared,
            CompositionStageV1::PrepareVerification,
            EventV1::Prepare,
        )
        .await?;
        Ok(FakePreparedStatementV1)
    }

    async fn execute_prepared_verification<'a>(
        &'a mut self,
        _statement: Self::PreparedStatement,
        parameters: &'a VerificationParametersV1,
        limits: VerificationLimitsV1,
        _control: StageControlV1<'a>,
    ) -> Result<RawQueryResponseV1, DatabaseFailureV1> {
        assert_eq!(limits, VERIFICATION_LIMITS);
        assert_eq!(limits.access_mode, "read-only");
        assert_eq!(limits.search_path, "pg_catalog, public");
        gate(
            &self.shared,
            CompositionStageV1::ExecuteVerification,
            EventV1::Execute,
        )
        .await?;
        Ok(raw_response(
            &parameters.values,
            &self.shared.marker,
            self.shared.behavior.response_variant,
        ))
    }

    async fn finish_read_only<'a>(
        &'a mut self,
        _control: StageControlV1<'a>,
    ) -> Result<(), DatabaseFailureV1> {
        gate(
            &self.shared,
            CompositionStageV1::FinishVerification,
            EventV1::Finish,
        )
        .await
    }

    fn cancel_database_request(&mut self) {
        self.shared.event(EventV1::ReadCancel);
    }

    fn abort_transaction(&mut self) {
        self.shared.event(EventV1::ReadAbort);
    }

    fn discard_session(&mut self) {
        self.shared.event(EventV1::ReadDiscard);
    }
}

fn raw_column(name: &str, column_type: RawColumnTypeV1, value: Vec<u8>) -> RawColumnV1 {
    RawColumnV1 {
        name: name.to_owned(),
        column_type,
        value: Some(value),
    }
}

fn text_column(name: &str, value: &str) -> RawColumnV1 {
    raw_column(name, RawColumnTypeV1::Text, value.as_bytes().to_vec())
}

fn json_column(name: &str, value: &serde_json::Value) -> RawColumnV1 {
    raw_column(
        name,
        RawColumnTypeV1::Jsonb,
        serde_json::to_vec(value).expect("JSON fixture"),
    )
}

fn exact_catalog(marker: &str) -> serde_json::Value {
    let inventory: serde_json::Value =
        serde_json::from_str(INVENTORY_SOURCE).expect("inventory fixture");
    serde_json::json!({
        "schemaCount": 1,
        "schemaOid": "70000",
        "schemaOwnerOid": "10",
        "schemaOwnerName": "postgres",
        "schemaComment": "openpencil:release-ledger:v1",
        "installMarkerConstraintComment": marker,
        "schemaInstallMarkerPrefixCount": 1,
        "ownerRoleMemberCount": 0,
        "ownerDefaultNonOwnerPrivilegeCount": 0,
        "schemaNonOwnerPrivilegeCount": 0,
        "relationCount": 3,
        "unexpectedIndexCount": 0,
        "unexpectedTriggerCount": 0,
        "unexpectedRuleCount": 0,
        "unexpectedConstraintCount": 0,
        "inheritanceRelationCount": 0,
        "publicationExposureCount": 0,
        "droppedColumnCount": 0,
        "policyCount": 0,
        "tables": [
            {
                "tableName": "backfill_executions_v1", "tableOid": "70001",
                "ownerOid": "10", "ownerName": "postgres", "relationKind": "r",
                "persistence": "p", "isPartition": false, "replicaIdentity": "d",
                "rlsEnabled": true, "rlsForced": false,
                "comment": "openpencil:release-ledger:backfill-executions:v1",
                "nonOwnerPrivilegeCount": 0, "policyCount": 0
            },
            {
                "tableName": "backfill_receipts_v2", "tableOid": "70002",
                "ownerOid": "10", "ownerName": "postgres", "relationKind": "r",
                "persistence": "p", "isPartition": false, "replicaIdentity": "d",
                "rlsEnabled": true, "rlsForced": false,
                "comment": "openpencil:release-ledger:backfill-receipts:v2",
                "nonOwnerPrivilegeCount": 0, "policyCount": 0
            },
            {
                "tableName": "backfill_heads_v1", "tableOid": "70003",
                "ownerOid": "10", "ownerName": "postgres", "relationKind": "r",
                "persistence": "p", "isPartition": false, "replicaIdentity": "d",
                "rlsEnabled": true, "rlsForced": false,
                "comment": "openpencil:release-ledger:backfill-heads:v1",
                "nonOwnerPrivilegeCount": 0, "policyCount": 0
            }
        ],
        "columns": inventory["columns"].clone(),
        "constraints": inventory["constraints"].clone()
    })
}

fn raw_response(
    parameters: &[String; 9],
    marker: &str,
    variant: ResponseVariantV1,
) -> RawQueryResponseV1 {
    let roles = serde_json::json!({
        "currentOid": "20",
        "currentName": "supabase_read_only_user",
        "currentSuperuser": false,
        "currentBypassRls": true,
        "currentHasEffectivePgReadAllData": true,
        "sessionOid": "20",
        "sessionName": "supabase_read_only_user",
        "sessionSuperuser": false,
        "sessionBypassRls": true,
        "sessionHasEffectivePgReadAllData": true
    });
    let settings = serde_json::json!({
        "databasePrimary": true,
        "transactionReadOnly": true,
        "effectiveSearchPath": ["pg_catalog", "public"]
    });
    let mut catalog = exact_catalog(marker);
    if variant == ResponseVariantV1::WrongMarker {
        catalog["installMarkerConstraintComment"] = serde_json::Value::String(format!(
            "{CAS_LEDGER_INSTALL_MARKER_PREFIX}{}",
            "B".repeat(43)
        ));
    }
    let review_digest = if variant == ResponseVariantV1::WrongEcho {
        "A".repeat(43)
    } else {
        parameters[1].clone()
    };
    let mut row = vec![
        text_column("reviewDigest", &review_digest),
        text_column("ledgerShapeDigest", &parameters[2]),
        text_column("sqlDigest", &parameters[3]),
        text_column("projectRef", &parameters[4]),
        text_column("accountId", &parameters[5]),
        text_column("grantGeneration", &parameters[6]),
        text_column("queryVersion", &parameters[7]),
        text_column("queryDigest", &parameters[8]),
        text_column("accessMode", "read-only"),
        text_column("snapshotScope", "single-statement"),
        raw_column("catalogOnly", RawColumnTypeV1::Bool, b"t".to_vec()),
        raw_column("managedDataRead", RawColumnTypeV1::Bool, b"f".to_vec()),
        text_column("serverVersionNum", "170000"),
        text_column("snapshotMarker", "100:101:"),
        text_column("observedAt", "2026-09-08T12:00:00.000Z"),
        json_column("roles", &roles),
        json_column("settings", &settings),
        json_column("catalog", &catalog),
    ];
    if variant == ResponseVariantV1::Oversized {
        row[17].value = Some(vec![b' '; MAXIMUM_VERIFICATION_RESPONSE_BYTES + 1]);
    }
    let mut rows = vec![row];
    if variant == ResponseVariantV1::ExtraRow {
        rows.push(Vec::new());
    }
    rows
}

struct ManualJournalClockV1 {
    wall_ms: AtomicU64,
    monotonic_ms: AtomicU64,
}

impl ManualJournalClockV1 {
    fn new() -> Self {
        Self {
            wall_ms: AtomicU64::new(WALL_START_MS),
            monotonic_ms: AtomicU64::new(0),
        }
    }
}

impl JournalClock for ManualJournalClockV1 {
    fn wall_unix_millis(&self) -> Result<u64, JournalError> {
        Ok(self.wall_ms.load(Ordering::SeqCst))
    }

    fn monotonic(&self) -> Duration {
        Duration::from_millis(self.monotonic_ms.load(Ordering::SeqCst))
    }
}

struct CounterEntropyV1(AtomicU64);

impl JournalEntropy for CounterEntropyV1 {
    fn capability_id(&self) -> Result<[u8; 32], JournalError> {
        let value = self.0.fetch_add(1, Ordering::SeqCst);
        let mut id = [0_u8; 32];
        id[24..].copy_from_slice(&value.to_be_bytes());
        Ok(id)
    }
}

struct ConfirmedDirectorySyncV1;

impl DirectorySync for ConfirmedDirectorySyncV1 {
    fn sync(&self, _directory: &Path) -> Result<(), JournalError> {
        Ok(())
    }
}

struct TestInterruptsV1 {
    now_ms: AtomicU64,
    cancelled: AtomicBool,
    waiters: Mutex<Vec<Waker>>,
}

impl TestInterruptsV1 {
    fn new() -> Self {
        Self {
            now_ms: AtomicU64::new(0),
            cancelled: AtomicBool::new(false),
            waiters: Mutex::new(Vec::new()),
        }
    }

    fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        for waiter in self.waiters.lock().expect("waiters").drain(..) {
            waiter.wake();
        }
    }

    fn set_now(&self, now: Duration) {
        self.now_ms.store(
            u64::try_from(now.as_millis()).expect("test time"),
            Ordering::Release,
        );
        for waiter in self.waiters.lock().expect("waiters").drain(..) {
            waiter.wake();
        }
    }
}

impl InterruptSourceV1 for TestInterruptsV1 {
    fn now(&self) -> Duration {
        Duration::from_millis(self.now_ms.load(Ordering::Acquire))
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    fn register_waker(&self, _deadline: Duration, waker: &Waker) {
        let mut waiters = self.waiters.lock().expect("waiters");
        if !waiters.iter().any(|current| current.will_wake(waker)) {
            waiters.push(waker.clone());
        }
    }
}

struct ThreadWakeV1(thread::Thread);

impl Wake for ThreadWakeV1 {
    fn wake(self: Arc<Self>) {
        self.0.unpark();
    }

    fn wake_by_ref(self: &Arc<Self>) {
        self.0.unpark();
    }
}

fn block_on<T>(future: impl Future<Output = T>) -> T {
    let waker = Waker::from(Arc::new(ThreadWakeV1(thread::current())));
    let mut context = Context::from_waker(&waker);
    let mut future = pin!(future);
    loop {
        match future.as_mut().poll(&mut context) {
            Poll::Ready(value) => return value,
            Poll::Pending => thread::park(),
        }
    }
}

struct NoopWakeV1;

impl Wake for NoopWakeV1 {
    fn wake(self: Arc<Self>) {}
}

fn digest(label: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(label.as_bytes()))
}

fn material(label: &str) -> CasLedgerInstallPlanMaterialV1 {
    let marker_binding_digest = digest(&format!("marker:{label}"));
    let marker = format!("{CAS_LEDGER_INSTALL_MARKER_PREFIX}{marker_binding_digest}");
    let install_sql_digest =
        fixed_cas_ledger_install_sql_digest(&marker, &marker_binding_digest).unwrap();
    CasLedgerInstallPlanMaterialV1 {
        provider_id: "supabase".to_owned(),
        environment: "staging".to_owned(),
        project_ref: "abcdefghijklmnopqrst".to_owned(),
        account_id: format!("account-{label}"),
        read_grant_generation: "11111111-1111-4111-8111-111111111111".to_owned(),
        write_grant_generation: "22222222-2222-4222-8222-222222222222".to_owned(),
        migration_name: CAS_LEDGER_INSTALL_MIGRATION_NAME.to_owned(),
        install_review_digest: digest(&format!("install:{label}")),
        source_review_digest: digest(&format!("source:{label}")),
        verification_digest: digest(&format!("verification:{label}")),
        ledger_shape_digest: digest(&format!("shape:{label}")),
        base_sql_digest: CAS_LEDGER_BASE_SQL_DIGEST.to_owned(),
        marker,
        marker_binding_digest,
        install_sql_digest,
        verification_query_digest: CAS_LEDGER_VERIFICATION_QUERY_DIGEST.to_owned(),
    }
}

struct FixtureV1 {
    _temp: TempDir,
    _journal: Arc<BackendOperationJournalV1>,
    claim: DurableCasLedgerInstallClaimHandleV1,
    connector: FakeConnectorV1,
    shared: Arc<SharedV1>,
    interrupts: Arc<TestInterruptsV1>,
}

fn fixture(label: &str, behavior: BehaviorV1) -> FixtureV1 {
    let temp = TempDir::new().unwrap();
    let journal = Arc::new(BackendOperationJournalV1::with_test_dependencies(
        temp.path().join("app-data"),
        Arc::new(CounterEntropyV1(AtomicU64::new(1))),
        Arc::new(ManualJournalClockV1::new()),
        Arc::new(ConfirmedDirectorySyncV1),
    ));
    let plan = material(label);
    let marker = plan.marker.clone();
    let install = BackendCasLedgerInstallV1::new(Arc::clone(&journal));
    let claim = install
        .claim(SealedCasLedgerInstallReviewProofV1::issue_for_test(plan))
        .unwrap();
    let journal_file = temp
        .path()
        .join("app-data/backend-operation-journal/journal.v1.json");
    let shared = Arc::new(SharedV1 {
        behavior,
        events: Mutex::new(Vec::new()),
        journal_file,
        first_database_state: Mutex::new(None),
        marker,
    });
    FixtureV1 {
        _temp: temp,
        _journal: journal,
        claim,
        connector: FakeConnectorV1 {
            shared: Arc::clone(&shared),
        },
        shared,
        interrupts: Arc::new(TestInterruptsV1::new()),
    }
}

fn journal_state(path: &Path) -> Option<String> {
    let value: serde_json::Value = serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
    value["body"]["records"]
        .as_object()?
        .values()
        .next()?
        .get("state")?
        .as_str()
        .map(str::to_owned)
}

fn journal_has_final_evidence(path: &Path) -> bool {
    let value: serde_json::Value =
        serde_json::from_slice(&std::fs::read(path).expect("journal")).expect("journal JSON");
    !value["body"]["records"]
        .as_object()
        .expect("records")
        .values()
        .next()
        .expect("record")["finalEvidence"]
        .is_null()
}

fn error_of<T>(result: Result<T, CompositionErrorV1>) -> CompositionErrorV1 {
    match result {
        Ok(_) => panic!("expected composition to fail closed"),
        Err(error) => error,
    }
}

fn cleanup_events(events: &[EventV1]) -> Vec<EventV1> {
    events
        .iter()
        .copied()
        .filter(|event| {
            matches!(
                event,
                EventV1::ConnectionCancel
                    | EventV1::WriteCancel
                    | EventV1::WriteDiscard
                    | EventV1::ReadCancel
                    | EventV1::ReadAbort
                    | EventV1::ReadDiscard
            )
        })
        .collect()
}

fn expected_pending_cleanup(stage: CompositionStageV1) -> Vec<EventV1> {
    match stage {
        CompositionStageV1::WriteConnect => vec![EventV1::ConnectionCancel],
        CompositionStageV1::WriteProjectAuthority | CompositionStageV1::ApplyMigration => {
            vec![EventV1::WriteCancel, EventV1::WriteDiscard]
        }
        CompositionStageV1::ReadConnect => {
            vec![EventV1::WriteDiscard, EventV1::ConnectionCancel]
        }
        CompositionStageV1::ReadProjectAuthority => vec![
            EventV1::WriteDiscard,
            EventV1::ReadCancel,
            EventV1::ReadDiscard,
        ],
        CompositionStageV1::BeginReadOnly
        | CompositionStageV1::SearchPath
        | CompositionStageV1::RowSecurity
        | CompositionStageV1::StatementTimeout
        | CompositionStageV1::PrepareVerification
        | CompositionStageV1::ExecuteVerification
        | CompositionStageV1::FinishVerification => vec![
            EventV1::WriteDiscard,
            EventV1::ReadCancel,
            EventV1::ReadAbort,
        ],
    }
}

fn assert_exact_pending_cleanup(stage: CompositionStageV1, events: &[EventV1]) {
    assert_eq!(
        cleanup_events(events),
        expected_pending_cleanup(stage),
        "stage {stage:?}: {events:?}"
    );
}

#[test]
fn exact_readback_is_the_only_path_to_applied_and_authority_stays_false() {
    let fixture = fixture("success", BehaviorV1::default());
    let result = block_on(run_fixed_install_and_verification_for_test(
        fixture.claim,
        fixture.connector,
        fixture.interrupts.as_ref(),
    ))
    .expect("exact installed readback");

    assert_eq!(
        fixture
            .shared
            .first_database_state
            .lock()
            .unwrap()
            .as_deref(),
        Some("outcome-unknown")
    );
    assert_eq!(
        journal_state(&fixture.shared.journal_file).as_deref(),
        Some("applied")
    );
    assert!(journal_has_final_evidence(&fixture.shared.journal_file));
    assert!(result.database_ledger_bound());
    assert!(!result.mutation_authorized());
    assert!(!result.execution_authorized());
    assert!(!result.source_ledger_bound());
    assert!(!result.receipt_issued());
    assert!(!result.release_authorized());
    assert_eq!(
        fixture.shared.events(),
        vec![
            EventV1::WriteConnect,
            EventV1::WriteAuthority,
            EventV1::Apply,
            EventV1::WriteDiscard,
            EventV1::ReadConnect,
            EventV1::ReadAuthority,
            EventV1::BeginReadOnly,
            EventV1::SearchPath,
            EventV1::RowSecurity,
            EventV1::StatementTimeout,
            EventV1::Prepare,
            EventV1::Execute,
            EventV1::Finish,
        ]
    );
}

#[test]
fn unpolled_future_drop_leaves_claimed_and_never_touches_database() {
    let fixture = fixture("unpolled", BehaviorV1::default());
    let future = run_fixed_install_and_verification_for_test(
        fixture.claim,
        fixture.connector,
        fixture.interrupts.as_ref(),
    );
    drop(future);
    assert!(fixture.shared.events().is_empty());
    assert_eq!(
        journal_state(&fixture.shared.journal_file).as_deref(),
        Some("claimed")
    );
    assert!(!journal_has_final_evidence(&fixture.shared.journal_file));
}

#[test]
fn every_database_stage_failure_stays_outcome_unknown_without_final_evidence() {
    for (index, (stage, _)) in DATABASE_STAGE_CASES.into_iter().enumerate() {
        let fixture = fixture(
            &format!("failure-{index}"),
            BehaviorV1 {
                fail_at: Some(stage),
                ..BehaviorV1::default()
            },
        );
        assert_eq!(
            error_of(block_on(run_fixed_install_and_verification_for_test(
                fixture.claim,
                fixture.connector,
                fixture.interrupts.as_ref(),
            ))),
            CompositionErrorV1::Database {
                stage,
                failure: DatabaseFailureV1::Rejected,
            }
        );
        assert_eq!(
            journal_state(&fixture.shared.journal_file).as_deref(),
            Some("outcome-unknown"),
            "stage {stage:?}"
        );
        assert!(!journal_has_final_evidence(&fixture.shared.journal_file));
    }
}

#[test]
fn pending_drop_cancels_the_exact_request_and_retains_outcome_unknown() {
    for (index, (stage, expected_cancel)) in DATABASE_STAGE_CASES.into_iter().enumerate() {
        let fixture = fixture(
            &format!("pending-{index}"),
            BehaviorV1 {
                pending_at: Some(stage),
                ..BehaviorV1::default()
            },
        );
        let mut future = Box::pin(run_fixed_install_and_verification_for_test(
            fixture.claim,
            fixture.connector,
            fixture.interrupts.as_ref(),
        ));
        let waker = Waker::from(Arc::new(NoopWakeV1));
        let mut context = Context::from_waker(&waker);
        assert!(matches!(future.as_mut().poll(&mut context), Poll::Pending));
        drop(future);
        let events = fixture.shared.events();
        assert!(
            events.contains(&expected_cancel),
            "stage {stage:?}: {events:?}"
        );
        assert_exact_pending_cleanup(stage, &events);
        assert_eq!(
            journal_state(&fixture.shared.journal_file).as_deref(),
            Some("outcome-unknown")
        );
        assert!(!journal_has_final_evidence(&fixture.shared.journal_file));
    }
}

#[test]
fn cancellation_and_timeout_cancel_every_pending_request_with_exact_cleanup() {
    for (index, (stage, _)) in DATABASE_STAGE_CASES.into_iter().enumerate() {
        for (label, failure) in [
            ("cancel", DatabaseFailureV1::Cancelled),
            ("timeout", DatabaseFailureV1::TimedOut),
        ] {
            let fixture = fixture(
                &format!("{label}-{index}"),
                BehaviorV1 {
                    pending_at: Some(stage),
                    ..BehaviorV1::default()
                },
            );
            let mut future = Box::pin(run_fixed_install_and_verification_for_test(
                fixture.claim,
                fixture.connector,
                fixture.interrupts.as_ref(),
            ));
            let waker = Waker::from(Arc::new(NoopWakeV1));
            let mut context = Context::from_waker(&waker);
            assert!(matches!(future.as_mut().poll(&mut context), Poll::Pending));
            if failure == DatabaseFailureV1::Cancelled {
                fixture.interrupts.cancel();
            } else {
                fixture.interrupts.set_now(OVERALL_TIMEOUT);
            }
            assert_eq!(
                error_of(match future.as_mut().poll(&mut context) {
                    Poll::Ready(result) => result,
                    Poll::Pending => panic!("interrupt must resolve pending stage {stage:?}"),
                }),
                CompositionErrorV1::Database { stage, failure }
            );
            drop(future);
            let events = fixture.shared.events();
            assert_exact_pending_cleanup(stage, &events);
            assert_eq!(
                journal_state(&fixture.shared.journal_file).as_deref(),
                Some("outcome-unknown")
            );
            assert!(!journal_has_final_evidence(&fixture.shared.journal_file));
        }
    }
}

#[test]
fn cancellation_timeout_authority_and_response_drift_all_fail_closed() {
    let cancelled = fixture("cancelled", BehaviorV1::default());
    cancelled.interrupts.cancel();
    assert_eq!(
        error_of(block_on(run_fixed_install_and_verification_for_test(
            cancelled.claim,
            cancelled.connector,
            cancelled.interrupts.as_ref(),
        ))),
        CompositionErrorV1::Database {
            stage: CompositionStageV1::WriteConnect,
            failure: DatabaseFailureV1::Cancelled,
        }
    );
    assert_eq!(
        cleanup_events(&cancelled.shared.events()),
        vec![EventV1::ConnectionCancel]
    );
    assert_eq!(
        journal_state(&cancelled.shared.journal_file).as_deref(),
        Some("outcome-unknown")
    );

    let timed_out = fixture(
        "timed-out",
        BehaviorV1 {
            pending_at: Some(CompositionStageV1::WriteConnect),
            ..BehaviorV1::default()
        },
    );
    let mut timed_out_future = Box::pin(run_fixed_install_and_verification_for_test(
        timed_out.claim,
        timed_out.connector,
        timed_out.interrupts.as_ref(),
    ));
    let waker = Waker::from(Arc::new(NoopWakeV1));
    let mut context = Context::from_waker(&waker);
    assert!(matches!(
        timed_out_future.as_mut().poll(&mut context),
        Poll::Pending
    ));
    timed_out.interrupts.set_now(OVERALL_TIMEOUT);
    assert_eq!(
        error_of(match timed_out_future.as_mut().poll(&mut context) {
            Poll::Ready(result) => result,
            Poll::Pending => panic!("deadline must resolve pending stage"),
        }),
        CompositionErrorV1::Database {
            stage: CompositionStageV1::WriteConnect,
            failure: DatabaseFailureV1::TimedOut,
        }
    );
    drop(timed_out_future);
    assert!(timed_out.shared.events().contains(&EventV1::WriteConnect));
    assert_exact_pending_cleanup(CompositionStageV1::WriteConnect, &timed_out.shared.events());

    for (index, behavior) in [
        BehaviorV1 {
            authority_mismatch_at: Some(CompositionStageV1::WriteProjectAuthority),
            ..BehaviorV1::default()
        },
        BehaviorV1 {
            authority_mismatch_at: Some(CompositionStageV1::ReadProjectAuthority),
            ..BehaviorV1::default()
        },
        BehaviorV1 {
            invalid_migration_response: true,
            ..BehaviorV1::default()
        },
        BehaviorV1 {
            response_variant: ResponseVariantV1::ExtraRow,
            ..BehaviorV1::default()
        },
        BehaviorV1 {
            response_variant: ResponseVariantV1::WrongEcho,
            ..BehaviorV1::default()
        },
        BehaviorV1 {
            response_variant: ResponseVariantV1::WrongMarker,
            ..BehaviorV1::default()
        },
        BehaviorV1 {
            response_variant: ResponseVariantV1::Oversized,
            ..BehaviorV1::default()
        },
    ]
    .into_iter()
    .enumerate()
    {
        let fixture = fixture(&format!("drift-{index}"), behavior);
        assert!(block_on(run_fixed_install_and_verification_for_test(
            fixture.claim,
            fixture.connector,
            fixture.interrupts.as_ref(),
        ))
        .is_err());
        assert_eq!(
            journal_state(&fixture.shared.journal_file).as_deref(),
            Some("outcome-unknown")
        );
        assert!(!journal_has_final_evidence(&fixture.shared.journal_file));
    }
}

#[test]
fn future_is_send_deadline_is_inside_journal_ttl_and_source_is_test_only() {
    fn assert_send<T: Send>(_: &T) {}

    assert!(OVERALL_TIMEOUT < CAS_LEDGER_INSTALL_SETTLEMENT_CAPABILITY_TTL);
    let fixture = fixture("send", BehaviorV1::default());
    let future = run_fixed_install_and_verification_for_test(
        fixture.claim,
        fixture.connector,
        fixture.interrupts.as_ref(),
    );
    assert_send(&future);
    drop(future);

    let parent = include_str!("../composition.rs");
    let registration = include_str!("../../backend_cas_ledger_install.rs");
    for forbidden in [
        "#[tauri::command]",
        "reqwest::",
        "CredentialResolver",
        "access_token",
        "Bearer ",
        "service_role",
        "issue_receipt",
    ] {
        assert!(
            !parent.contains(forbidden),
            "forbidden production surface: {forbidden}"
        );
    }
    assert!(registration.contains("#[cfg(test)]\nmod composition;"));
}
