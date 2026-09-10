use super::*;
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine as _,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};
use tempfile::TempDir;

use crate::{
    backend_cas_ledger_install::{
        fixed_cas_ledger_install_sql_digest, BackendCasLedgerInstallV1,
        CasLedgerInstallObservationInputV1, CasLedgerInstallObservedMarkerStateV1,
        CasLedgerInstallObservedStateV1, CasLedgerInstallPlanMaterialV1,
        SealedCasLedgerInstallReviewProofV1, CAS_LEDGER_BASE_SQL_DIGEST,
        CAS_LEDGER_INSTALL_MARKER_PREFIX, CAS_LEDGER_INSTALL_MIGRATION_NAME,
        CAS_LEDGER_VERIFICATION_QUERY_DIGEST,
    },
    backend_locked_high_water_capture::{
        LockedHighWaterCaptureErrorV1, LockedHighWaterCaptureRegistryV1,
    },
    backend_operation_journal::{
        BackendOperationJournalV1, DirectorySync, JournalClock, JournalEntropy, JournalError,
    },
    backend_source_ledger_admission::BackendSourceLedgerAdmissionV1,
    backend_source_ledger_receipt_verifier::SourceLedgerAdmissionClaimMaterialV1,
};

const PROJECT: &str = "abcdefghijklmnopqrst";
const SOURCE_GRANT: &str = "source-ledger-grant-1";
const READ_GRANT: &str = "11111111-1111-4111-8111-111111111111";
const WRITE_GRANT: &str = "22222222-2222-4222-8222-222222222222";
const CAPTURE_WRITE_GRANT: &str = "44444444-4444-4444-8444-444444444444";
const OTHER_READ_GRANT: &str = "55555555-5555-4555-8555-555555555555";
const OBSERVED_AT: &str = "2027-01-01T00:00:00.000Z";
const SNAPSHOT: &str = "1:2,3:4";
const CAPTURE_OBSERVED_AT: &str = "2027-01-01T00:00:02.000Z";
const CAPTURE_SNAPSHOT: &str = "5:8,6:7";
const SERVER_VERSION: &str = "150000";

struct Clock;

impl JournalClock for Clock {
    fn wall_unix_millis(&self) -> Result<u64, JournalError> {
        Ok(1_800_000_000_000)
    }

    fn monotonic(&self) -> Duration {
        Duration::ZERO
    }
}

struct Entropy(AtomicU64);

impl JournalEntropy for Entropy {
    fn capability_id(&self) -> Result<[u8; 32], JournalError> {
        let mut id = [0_u8; 32];
        id[24..].copy_from_slice(&self.0.fetch_add(1, Ordering::SeqCst).to_be_bytes());
        Ok(id)
    }
}

struct ConfirmedSync;

impl DirectorySync for ConfirmedSync {
    fn sync(&self, _directory: &Path) -> Result<(), JournalError> {
        Ok(())
    }
}

struct SwitchableSync {
    fail: AtomicBool,
}

impl SwitchableSync {
    fn confirmed() -> Self {
        Self {
            fail: AtomicBool::new(false),
        }
    }

    fn make_unconfirmed(&self) {
        self.fail.store(true, Ordering::SeqCst);
    }
}

impl DirectorySync for SwitchableSync {
    fn sync(&self, _directory: &Path) -> Result<(), JournalError> {
        if self.fail.load(Ordering::SeqCst) {
            Err(JournalError::Unavailable)
        } else {
            Ok(())
        }
    }
}

fn digest(label: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(label.as_bytes()))
}

fn canonical_bytes(value: &Value) -> Vec<u8> {
    fn write(value: &Value, output: &mut String) {
        match value {
            Value::Null => output.push_str("null"),
            Value::Bool(value) => output.push_str(if *value { "true" } else { "false" }),
            Value::Number(value) => output.push_str(&value.to_string()),
            Value::String(value) => output.push_str(&serde_json::to_string(value).unwrap()),
            Value::Array(values) => {
                output.push('[');
                for (index, value) in values.iter().enumerate() {
                    if index > 0 {
                        output.push(',');
                    }
                    write(value, output);
                }
                output.push(']');
            }
            Value::Object(values) => {
                output.push('{');
                let mut entries = values.iter().collect::<Vec<_>>();
                entries.sort_unstable_by(|(left, _), (right, _)| left.cmp(right));
                for (index, (key, value)) in entries.into_iter().enumerate() {
                    if index > 0 {
                        output.push(',');
                    }
                    output.push_str(&serde_json::to_string(key).unwrap());
                    output.push(':');
                    write(value, output);
                }
                output.push('}');
            }
        }
    }
    let mut canonical = String::new();
    write(value, &mut canonical);
    canonical.into_bytes()
}

fn canonical_digest(value: &Value) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(canonical_bytes(value)))
}

fn journal(temp: &TempDir) -> Arc<BackendOperationJournalV1> {
    journal_with_sync(temp, Arc::new(ConfirmedSync))
}

fn journal_with_sync(
    temp: &TempDir,
    sync: Arc<dyn DirectorySync>,
) -> Arc<BackendOperationJournalV1> {
    Arc::new(BackendOperationJournalV1::with_test_dependencies(
        temp.path().join("app-data"),
        Arc::new(Entropy(AtomicU64::new(1))),
        Arc::new(Clock),
        sync,
    ))
}

fn source_material(label: &str) -> SourceLedgerAdmissionClaimMaterialV1 {
    SourceLedgerAdmissionClaimMaterialV1 {
        provider_id: "supabase".to_owned(),
        environment: "staging".to_owned(),
        project_ref: PROJECT.to_owned(),
        account_id: format!("account-{label}"),
        grant_generation: SOURCE_GRANT.to_owned(),
        provider_authority_digest: digest(&format!("provider:{label}")),
        application_id: format!("application-{label}"),
        application_digest: digest(&format!("application:{label}")),
        migration_id: format!("migration-{label}"),
        migration_digest: digest(&format!("migration:{label}")),
        migration_plan_digest: digest(&format!("migration-plan:{label}")),
        source_ledger_digest: digest(&format!("source-ledger:{label}")),
        schema_digest: digest(&format!("schema:{label}")),
        subject_digest: digest(&format!("subject:{label}")),
        attestation_digest: digest(&format!("attestation:{label}")),
        payload_digest: digest(&format!("payload:{label}")),
        expectation_digest: digest(&format!("expectation:{label}")),
        scope_digest: digest(&format!("scope:{label}")),
        ci_provider: "github-actions".to_owned(),
        repository: "owner/repository".to_owned(),
        workflow: "backend-release".to_owned(),
        run_id: format!("run-{label}"),
        run_attempt: 1,
        protected_ref: "refs/heads/main".to_owned(),
        revision: format!("revision-{label}"),
        db_push_command_digest: digest(&format!("db-push-command:{label}")),
        db_push_receipt_digest: digest(&format!("db-push-receipt:{label}")),
        database_history_digest: digest(&format!("database-history:{label}")),
    }
}

fn install_material(label: &str) -> CasLedgerInstallPlanMaterialV1 {
    let marker_binding_digest = digest(&format!("marker:{label}"));
    let marker = format!("{CAS_LEDGER_INSTALL_MARKER_PREFIX}{marker_binding_digest}");
    let install_sql_digest = fixed_cas_ledger_install_sql_digest(&marker, &marker_binding_digest)
        .expect("fixed install SQL");
    CasLedgerInstallPlanMaterialV1 {
        provider_id: "supabase".to_owned(),
        environment: "staging".to_owned(),
        project_ref: PROJECT.to_owned(),
        account_id: format!("account-{label}"),
        read_grant_generation: READ_GRANT.to_owned(),
        write_grant_generation: WRITE_GRANT.to_owned(),
        migration_name: CAS_LEDGER_INSTALL_MIGRATION_NAME.to_owned(),
        install_review_digest: digest(&format!("install-review:{label}")),
        source_review_digest: digest(&format!("source-review:{label}")),
        verification_digest: digest(&format!("verification:{label}")),
        ledger_shape_digest: digest(&format!("ledger-shape:{label}")),
        base_sql_digest: CAS_LEDGER_BASE_SQL_DIGEST.to_owned(),
        marker,
        marker_binding_digest,
        install_sql_digest,
        verification_query_digest: CAS_LEDGER_VERIFICATION_QUERY_DIGEST.to_owned(),
    }
}

fn capture_material(
    label: &str,
    source: &SourceLedgerAdmissionClaimMaterialV1,
    install: &CasLedgerInstallPlanMaterialV1,
    install_plan_digest: String,
    installed_verification_digest: String,
) -> LockedHighWaterCaptureMaterialV1 {
    LockedHighWaterCaptureMaterialV1 {
        provider_id: source.provider_id.clone(),
        environment: source.environment.clone(),
        project_ref: source.project_ref.clone(),
        account_id: source.account_id.clone(),
        source_grant_generation: source.grant_generation.clone(),
        read_grant_generation: install.read_grant_generation.clone(),
        install_write_grant_generation: install.write_grant_generation.clone(),
        capture_write_grant_generation: CAPTURE_WRITE_GRANT.to_owned(),
        provider_authority_digest: source.provider_authority_digest.clone(),
        application_id: source.application_id.clone(),
        application_digest: source.application_digest.clone(),
        migration_id: source.migration_id.clone(),
        migration_digest: source.migration_digest.clone(),
        migration_plan_digest: source.migration_plan_digest.clone(),
        source_ledger_digest: source.source_ledger_digest.clone(),
        source_scope_digest: source.scope_digest.clone(),
        schema_digest: source.schema_digest.clone(),
        source_ledger_subject_digest: source.subject_digest.clone(),
        inspection_subject_digest: digest(&format!("inspection-subject:{label}")),
        attestation_digest: source.attestation_digest.clone(),
        source_review_digest: install.source_review_digest.clone(),
        install_plan_digest,
        install_review_digest: install.install_review_digest.clone(),
        marker_binding_digest: install.marker_binding_digest.clone(),
        installed_verification_digest,
        capture_review_digest: digest(&format!("capture-review:{label}")),
        catalog_precondition_digest: digest(&format!("catalog:{label}")),
        query_digest: digest(&format!("capture-query:{label}")),
        capture_digest: digest(&format!("capture:{label}")),
        schema_name: "public".to_owned(),
        schema_oid: "2200".to_owned(),
        table_name: "tasks".to_owned(),
        table_oid: "16384".to_owned(),
        cursor_field: "id".to_owned(),
        cursor_sub_id: 1,
        cursor_type_oid: "20".to_owned(),
        target_field: "normalized_title".to_owned(),
        target_sub_id: 2,
        target_type_oid: "25".to_owned(),
        primary_key_oid: "16385".to_owned(),
        sequence_oid: "16386".to_owned(),
        barrier_constraint_oid: "16387".to_owned(),
        statement_count: 10,
        access_mode: "read-write-locked-read".to_owned(),
        snapshot_scope: "explicit-serializable-transaction".to_owned(),
        lock_mode: "share-row-exclusive".to_owned(),
        transaction_isolation: "serializable".to_owned(),
        transaction_read_only: false,
        row_security: false,
        search_path: "pg_catalog".to_owned(),
        database_primary: true,
        maximum_cursor: 9_007_199_254_740_991,
        captured_high_water: Some(42),
        minimum_cursor: Some(1),
        total_row_count: 42,
        remaining_null_target_row_count: 8,
        unsafe_cursor_row_count: 0,
        batch_size: 25,
        required_batch_receipt_count: 2,
        maximum_batch_receipt_count: 9_999,
        observed_at: CAPTURE_OBSERVED_AT.to_owned(),
        snapshot_marker: CAPTURE_SNAPSHOT.to_owned(),
        server_version_num: SERVER_VERSION.to_owned(),
        query_bindings_match: true,
        current_and_session_role_match: true,
        full_table_read_authority_observed: true,
        exact_address_matches: true,
        cursor_range_safe: true,
        receipt_capacity_fits: true,
        all_capture_checks_passed: true,
    }
}

fn inspection_material(
    label: &str,
    source: &SourceLedgerAdmissionClaimMaterialV1,
) -> BackfillInspectionSubjectMaterialV1 {
    BackfillInspectionSubjectMaterialV1 {
        provider_id: source.provider_id.clone(),
        provider_authority_digest: source.provider_authority_digest.clone(),
        application_id: source.application_id.clone(),
        application_digest: source.application_digest.clone(),
        migration_id: source.migration_id.clone(),
        migration_digest: source.migration_digest.clone(),
        migration_plan_digest: source.migration_plan_digest.clone(),
        inspection_subject_digest: digest(&format!("inspection-subject:{label}")),
        table_name: "tasks".to_owned(),
        cursor_field: "id".to_owned(),
        target_field: "normalized_title".to_owned(),
        maximum_cursor: 9_007_199_254_740_991,
        batch_size: 25,
        maximum_batch_receipt_count: 9_999,
    }
}

fn transaction_material(
    label: &str,
    source: &SourceLedgerAdmissionClaimMaterialV1,
    capture: &LockedHighWaterCaptureMaterialV1,
) -> ReceiptZeroInitializerTransactionMaterialV1 {
    let resource_identity_digest = canonical_digest(&json!({
        "address": {
            "barrierConstraintOid": capture.barrier_constraint_oid,
            "cursorField": capture.cursor_field,
            "cursorSubId": capture.cursor_sub_id,
            "cursorTypeOid": capture.cursor_type_oid,
            "primaryKeyOid": capture.primary_key_oid,
            "schemaName": capture.schema_name,
            "schemaOid": capture.schema_oid,
            "sequenceOid": capture.sequence_oid,
            "tableName": capture.table_name,
            "tableOid": capture.table_oid,
            "targetField": capture.target_field,
            "targetSubId": capture.target_sub_id,
            "targetTypeOid": capture.target_type_oid
        },
        "format": "openpencil.supabase-backfill-resource-identity.v1",
        "projectRef": capture.project_ref
    }));
    let scope = json!({
        "applicationDigest": source.application_digest,
        "applicationId": source.application_id,
        "batchSize": capture.batch_size,
        "captureDigest": capture.capture_digest,
        "capturedHighWater": capture.captured_high_water,
        "catalogPreconditionDigest": capture.catalog_precondition_digest,
        "completionRule": "predicate-exhausted-and-postconditions-satisfied",
        "cursorField": capture.cursor_field,
        "cursorFieldType": "integer",
        "entityId": "tasks",
        "environment": "staging",
        "format": "openpencil.backend-backfill-execution-scope",
        "initialRemainingEligibleRowCount": capture.total_row_count,
        "initialRemainingTargetRowCount": capture.remaining_null_target_row_count,
        "maximumBatchCount": capture.maximum_batch_receipt_count,
        "maximumReceiptCount": 10_000,
        "migrationDigest": source.migration_digest,
        "migrationId": source.migration_id,
        "migrationPlanDigest": source.migration_plan_digest,
        "providerAuthorityDigest": source.provider_authority_digest,
        "providerId": "supabase",
        "receiptZeroEvidenceDigest": capture.capture_digest,
        "requiredBatchCount": capture.required_batch_receipt_count,
        "requiredMatchedRowCount": capture.remaining_null_target_row_count,
        "resourceIdentityDigest": resource_identity_digest,
        "resumePolicy": "from-receipt",
        "sourceLedgerDigest": source.source_ledger_digest,
        "targetField": capture.target_field,
        "version": 2
    });
    let scope_bytes = canonical_bytes(&scope);
    let scope_digest = URL_SAFE_NO_PAD.encode(Sha256::digest(&scope_bytes));
    let execution_id = format!("execution:{}", digest(&format!("execution:{label}")));
    let event_id = format!("event:{}", digest(&format!("event:{label}")));
    let receipt_id = format!("receipt:{}", digest(&format!("receipt:{label}")));
    let idempotency_key = format!("receipt-zero:{}", digest(&format!("idempotency:{label}")));
    let request_digest = digest(&format!("request:{label}"));
    let operation_evidence_digest = digest(&format!("operation-evidence:{label}"));
    let committed_at = "2027-01-01T00:00:03.000Z";
    let receipt = json!({
        "batchCounts": {"matchedRowCount": 0, "scannedRowCount": 0, "updatedRowCount": 0},
        "batchIndex": 0,
        "catalogEvidenceDigest": capture.catalog_precondition_digest,
        "checkpointKind": "capture",
        "committedAt": committed_at,
        "cumulativeCounts": {"matchedRowCount": 0, "scannedRowCount": 0, "updatedRowCount": 0},
        "databaseEventId": event_id,
        "databaseHeadVersion": 1,
        "evidenceDigest": capture.capture_digest,
        "executionId": execution_id,
        "exhaustion": {
            "checked": true,
            "remainingEligibleRowCount": capture.total_row_count,
            "remainingTargetRowCount": capture.remaining_null_target_row_count
        },
        "format": "openpencil.backend-backfill-execution-receipt",
        "idempotencyKey": idempotency_key,
        "lastProcessedKey": null,
        "operationAuthorityDigest": operation_evidence_digest,
        "outcome": "in-progress",
        "postconditions": {
            "fieldNotNull": false,
            "matchedRowCountSatisfied": false,
            "requiredMatchedRowCount": capture.remaining_null_target_row_count
        },
        "previousCursor": null,
        "previousReceiptDigest": null,
        "receiptId": receipt_id,
        "requestDigest": request_digest,
        "scope": scope,
        "scopeDigest": scope_digest,
        "stableErrorCode": null,
        "terminalReason": null,
        "version": 2
    });
    let receipt_bytes = canonical_bytes(&receipt);
    let receipt_digest = URL_SAFE_NO_PAD.encode(Sha256::digest(&receipt_bytes));
    let values = json!([
        execution_id,
        source.application_id,
        source.application_digest,
        source.migration_id,
        source.migration_digest,
        source.migration_plan_digest,
        source.provider_authority_digest,
        source.source_ledger_digest,
        scope_digest,
        resource_identity_digest,
        capture.catalog_precondition_digest,
        STANDARD.encode(&scope_bytes),
        capture.capture_digest,
        capture.captured_high_water.map(|value| value.to_string()),
        capture.total_row_count.to_string(),
        capture.remaining_null_target_row_count.to_string(),
        Some(capture.remaining_null_target_row_count.to_string()),
        capture.required_batch_receipt_count.to_string(),
        capture.batch_size.to_string(),
        "running",
        committed_at,
        event_id,
        receipt_id,
        idempotency_key,
        request_digest,
        receipt_digest,
        STANDARD.encode(&receipt_bytes),
        operation_evidence_digest
    ]);
    let order = json!([
        "executionId",
        "applicationId",
        "applicationDigest",
        "migrationId",
        "migrationDigest",
        "migrationPlanDigest",
        "providerAuthorityDigest",
        "sourceLedgerDigest",
        "scopeDigest",
        "resourceIdentityDigest",
        "catalogPreconditionDigest",
        "canonicalScopeBase64",
        "captureDigest",
        "capturedHighWater",
        "initialRemainingEligibleRowCount",
        "initialRemainingTargetRowCount",
        "requiredMatchedRowCount",
        "requiredBatchCount",
        "batchSize",
        "initialExecutionStatus",
        "candidateCommittedAt",
        "eventId",
        "receiptId",
        "idempotencyKey",
        "requestDigest",
        "receiptDigest",
        "canonicalReceiptBase64",
        "unauthenticatedOperationEvidenceDigest"
    ]);
    let parameter_values_digest = canonical_digest(&json!({
        "format": "openpencil.supabase-backfill-receipt-zero-cas-parameters.v1",
        "order": order,
        "values": values,
        "version": 1
    }));
    serde_json::from_value(json!({
        "accessMode": "read-write",
        "format": "openpencil.native-supabase-backfill-receipt-zero-transaction.v1",
        "isolation": "serializable",
        "parameterSchemaDigest": "3j14xx4T8NmZ8gNpc3OlylDz4zSt3sIj2zVnykaHumo",
        "parameterValuesDigest": parameter_values_digest,
        "parameters": {
            "applicationDigest": source.application_digest,
            "applicationId": source.application_id,
            "batchSize": capture.batch_size,
            "candidateCommittedAt": committed_at,
            "canonicalReceiptBase64": STANDARD.encode(receipt_bytes),
            "canonicalScopeBase64": STANDARD.encode(scope_bytes),
            "captureDigest": capture.capture_digest,
            "capturedHighWater": capture.captured_high_water,
            "catalogPreconditionDigest": capture.catalog_precondition_digest,
            "eventId": event_id,
            "executionId": execution_id,
            "idempotencyKey": idempotency_key,
            "initialExecutionStatus": "running",
            "initialRemainingEligibleRowCount": capture.total_row_count,
            "initialRemainingTargetRowCount": capture.remaining_null_target_row_count,
            "migrationDigest": source.migration_digest,
            "migrationId": source.migration_id,
            "migrationPlanDigest": source.migration_plan_digest,
            "providerAuthorityDigest": source.provider_authority_digest,
            "receiptDigest": receipt_digest,
            "receiptId": receipt_id,
            "requestDigest": request_digest,
            "requiredBatchCount": capture.required_batch_receipt_count,
            "requiredMatchedRowCount": capture.remaining_null_target_row_count,
            "resourceIdentityDigest": resource_identity_digest,
            "scopeDigest": scope_digest,
            "sourceLedgerDigest": source.source_ledger_digest,
            "unauthenticatedOperationEvidenceDigest": operation_evidence_digest
        },
        "queryId": "backfill-receipt-zero-cas",
        "queryVersion": "openpencil-supabase-backfill-receipt-zero-cas-v1",
        "statementCount": 1,
        "transactionSqlDigest": "ROtzUuqaSQ8SQa-B49dWe9lP1F2Tcu0wljVFaabAchc",
        "version": 1
    }))
    .unwrap()
}

fn prerequisites(
    label: &str,
) -> (
    TempDir,
    Arc<BackendOperationJournalV1>,
    DurableSourceLedgerAdmissionHandleV1,
    DurableCasLedgerInstalledProofV1,
    BackfillInspectionSubjectMaterialV1,
    LockedHighWaterCaptureMaterialV1,
    ReceiptZeroInitializerTransactionMaterialV1,
) {
    prerequisites_with_sync(label, Arc::new(ConfirmedSync))
}

fn prerequisites_with_sync(
    label: &str,
    sync: Arc<dyn DirectorySync>,
) -> (
    TempDir,
    Arc<BackendOperationJournalV1>,
    DurableSourceLedgerAdmissionHandleV1,
    DurableCasLedgerInstalledProofV1,
    BackfillInspectionSubjectMaterialV1,
    LockedHighWaterCaptureMaterialV1,
    ReceiptZeroInitializerTransactionMaterialV1,
) {
    let temp = TempDir::new().unwrap();
    let journal = journal_with_sync(&temp, sync);
    let source_binding = source_material(label);
    let install_material = install_material(label);
    let installed_verification_digest = digest(&format!("installed-verification:{label}"));
    let source = BackendSourceLedgerAdmissionV1::new(Arc::clone(&journal))
        .admit_material_for_test(source_material(label))
        .unwrap();
    let install = BackendCasLedgerInstallV1::new(Arc::clone(&journal));
    let mut outcome = install
        .claim(SealedCasLedgerInstallReviewProofV1::issue_for_test(
            install_material.clone(),
        ))
        .unwrap()
        .begin_outcome_unknown_for_test()
        .unwrap();
    let observation = CasLedgerInstallObservationInputV1 {
        state: CasLedgerInstallObservedStateV1::Installed,
        verified_installed: true,
        exact_installed_state: true,
        all_verification_checks_passed: true,
        marker_state: CasLedgerInstallObservedMarkerStateV1::ExactSingle,
        constraint_comment: Some(install_material.marker.clone()),
        schema_marker_prefix_count: 1,
        exact_single_marker_on_constraint: true,
        installed_verification_digest: installed_verification_digest.clone(),
        observed_at: OBSERVED_AT.to_owned(),
        snapshot_marker: SNAPSHOT.to_owned(),
        server_version_num: SERVER_VERSION.to_owned(),
    };
    let proof = outcome
        .issue_installed_observation_for_test(observation)
        .unwrap();
    let installed = outcome.settle_installed_for_test(proof).unwrap();
    let capture = capture_material(
        label,
        &source_binding,
        &install_material,
        installed.plan_digest_for_initializer_for_test().to_owned(),
        installed_verification_digest,
    );
    let inspection = inspection_material(label, &source_binding);
    let transaction = transaction_material(label, &source_binding, &capture);
    (
        temp,
        journal,
        source,
        installed,
        inspection,
        capture,
        transaction,
    )
}

fn issue_inspection(
    material: BackfillInspectionSubjectMaterialV1,
) -> (
    BackendBackfillInspectionSubjectRegistryV1,
    SealedBackfillInspectionSubjectProofV1,
) {
    let registry = BackendBackfillInspectionSubjectRegistryV1::new_dormant_production().unwrap();
    let proof = registry.issue_material_for_test(material).unwrap();
    (registry, proof)
}

#[path = "cases.rs"]
mod cases;
