//! Dormant native durability kernel for Backend mutation operations.
//!
//! This file deliberately registers no Tauri command and owns no network client. Production code
//! also has no constructor for a trusted mutation plan yet. Trusted plans can only be assembled by
//! this module's tests, so renderer JSON, document fields, and plugin data cannot create mutation
//! authority.
//!
//! The journal is a local operation authority, not the remote database CAS/fencing ledger. It
//! serializes claim, outcome-unknown precommit, evidence, and terminal settlement through one
//! bounded file replacement. A claim lease expiring never unlocks a project scope or permits a
//! second mutation. Once dispatch may have started, direct settlement and restart reconciliation
//! may terminally record only a positive Applied observation; a negative/error observation stays
//! unresolved until a future remote fenced/CAS ledger can prove finality. The checksum detects
//! corruption but is not an authenticity proof; a
//! compromised same-user process, local file deletion, or backup rollback is outside this boundary
//! and is one reason the future database ledger remains mandatory.

#![allow(dead_code)] // Dormant until a separately reviewed native installer/verifier is composed.

use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine as _,
};
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard, TryLockError},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[cfg(test)]
use std::sync::Weak;

#[cfg(test)]
use crate::backend_automation_idempotency_cas::{
    rendered_sql_digest_for_recovery, PARAMETER_SCHEMA_DIGEST, RECONCILIATION_QUERY_DIGEST,
};
#[cfg(test)]
use crate::backend_cas_ledger_install::{
    fixed_cas_ledger_install_sql_digest, CasLedgerInstallInstalledObservationMaterialV1,
    ConsumedCasLedgerInstalledObservationProofV1, CAS_LEDGER_BASE_SQL_DIGEST,
    CAS_LEDGER_VERIFICATION_QUERY_DIGEST,
};
use crate::{
    backend_automation_idempotency_cas::{
        validate_automation_cas_recovery_material, AutomationCasRecoveryMaterialV1,
        SealedAutomationCasRecoveryReviewProofV1, AUTOMATION_CAS_RECOVERY_PLAN_FORMAT,
        AUTOMATION_CAS_RECOVERY_PROGRESS_FORMAT,
    },
    backend_cas_ledger_install::{
        validate_fixed_cas_ledger_install_artifacts, CasLedgerInstallPlanMaterialV1,
        SealedCasLedgerInstallReviewProofV1, CAS_LEDGER_INSTALL_MARKER_PREFIX,
        CAS_LEDGER_INSTALL_MIGRATION_NAME, CAS_LEDGER_INSTALL_PLAN_FORMAT,
    },
    backend_source_ledger_receipt_verifier::{
        ConsumedSourceLedgerAdmissionProofV1, SourceLedgerAdmissionClaimMaterialV1,
    },
    supabase_backfill_fixed_read::contains_secret_like_material,
};

const STORE_DIRECTORY: &str = "backend-operation-journal";
const JOURNAL_FILE: &str = "journal.v1.json";
const LOCK_FILE: &str = "journal.v1.lock";
const JOURNAL_FORMAT: &str = "openpencil.native-backend-operation-journal.v1";
const JOURNAL_LEGACY_VERSION: u32 = 1;
const JOURNAL_VERSION: u32 = 2;
const TOMBSTONE_FORMAT: &str = "openpencil.native-backend-operation-tombstone.v1";
const TOMBSTONE_VERSION: u32 = 1;
const EVIDENCE_FORMAT: &str = "openpencil.native-backend-operation-evidence.v1";
const EVIDENCE_VERSION: u32 = 1;
const CLAIM_LEASE: Duration = Duration::from_secs(5 * 60);
const CAPABILITY_TTL: Duration = Duration::from_secs(30);
#[cfg(test)]
pub(crate) const CAS_LEDGER_INSTALL_SETTLEMENT_CAPABILITY_TTL: Duration = CAPABILITY_TTL;
pub(crate) const AUTOMATION_CAS_RECONCILIATION_LEASE_TTL: Duration = Duration::from_secs(60);
pub(crate) const RECEIPT_ZERO_INITIALIZER_RECONCILIATION_LEASE_TTL: Duration =
    Duration::from_secs(60);
#[cfg(test)]
const RECEIPT_ZERO_INITIALIZER_LIVE_PRECOMMIT_RUNNER_WINDOW: Duration = Duration::from_secs(25);
#[cfg(test)]
const RECEIPT_ZERO_INITIALIZER_READ_RUNNER_WINDOW: Duration = CAPABILITY_TTL;
const LOCK_WAIT_TIMEOUT: Duration = Duration::from_secs(5);
const LOCK_RETRY_INTERVAL: Duration = Duration::from_millis(25);
const MAX_JOURNAL_BYTES: usize = 16 * 1024 * 1024;
// Active records intentionally stay within a small fail-closed working set. On the first locked
// access after restart, only already-terminal records move atomically into the separate bounded
// tombstone map; unresolved records never move and therefore never release their project scope.
const MAX_RECORDS: usize = 256;
// Tombstones retain the complete, secret-free terminal record and its digest so archiving can free
// active capacity without reopening an exact single-flight key. This is deliberately bounded and
// never pruned automatically; exhausting it fails closed until a separately authorized export or
// retention mechanism exists.
const MAX_TOMBSTONES: usize = 4_096;
// Source-ledger admissions are permanent replay fences and therefore never enter the terminal
// tombstone archive. Keep a fixed share of the active store available for CAS-ledger installation
// and recovery records so a burst of valid admissions cannot starve the database-ledger prerequisite.
const RESERVED_NON_ADMISSION_RECORDS: usize = 32;
const MAX_ADMISSION_OCCUPIED_RECORDS: usize = MAX_RECORDS - RESERVED_NON_ADMISSION_RECORDS;
const MAX_KEY_BYTES: usize = 2_048;
const MAX_ID_BYTES: usize = 256;
const MAX_CODE_BYTES: usize = 256;
const MAX_EVIDENCE_BYTES: usize = 1024 * 1024;
const MAX_EVIDENCE_DEPTH: usize = 32;
const MAX_EVIDENCE_NODES: usize = 16_384;
const CAPABILITY_BYTES: usize = 32;
const CAPABILITY_ID_ATTEMPTS: usize = 4;
const MAX_RUNTIME_AUTHORITY_IDS: usize = 256;
// Admission handoffs are short lived but can otherwise occupy the entire process-local registry.
// Preserve the same fixed share for mutation/recovery capabilities. Non-admission operations may
// use the reserve; admissions never may.
const RESERVED_NON_ADMISSION_RUNTIME_IDS: usize = 32;
const MAX_ADMISSION_OCCUPIED_RUNTIME_IDS: usize =
    MAX_RUNTIME_AUTHORITY_IDS - RESERVED_NON_ADMISSION_RUNTIME_IDS;
const OUTCOME_UNKNOWN_CODE: &str = "native-backend-operation-outcome-unknown";
const KNOWN_NOT_DISPATCHED_CODE: &str = "native-backend-operation-known-not-dispatched";
const SOURCE_LEDGER_ADMISSION_OWNER: &str = "native-source-ledger-admission";
const SOURCE_LEDGER_ADMISSION_FORMAT: &str =
    "openpencil.native-source-ledger-receipt-zero-admission.v1";
const CAS_LEDGER_INSTALL_OWNER: &str = "native-cas-ledger-install";
const CAS_LEDGER_INSTALL_RELEASE_PREFIX: &str = "cas-ledger-install:";
const CAS_LEDGER_INSTALL_SINGLE_FLIGHT_DOMAIN: &[u8] =
    b"openpencil.native-cas-ledger-install-single-flight.v1";
const CAS_LEDGER_INSTALL_SCOPE_DOMAIN: &[u8] =
    b"openpencil.native-cas-ledger-install-project-scope.v1";
const RECEIPT_ZERO_INITIALIZER_OWNER: &str = "native-receipt-zero-initializer";
const RECEIPT_ZERO_INITIALIZER_FORMAT: &str =
    "openpencil.native-supabase-backfill-receipt-zero-initializer-claim.v1";
const RECEIPT_ZERO_INITIALIZER_RELEASE_PREFIX: &str = "receipt-zero-initializer:";
const RECEIPT_ZERO_INITIALIZER_PLAN_DOMAIN: &[u8] =
    b"openpencil.native-receipt-zero-initializer-plan.v1";
const RECEIPT_ZERO_INITIALIZER_SINGLE_FLIGHT_DOMAIN: &[u8] =
    b"openpencil.native-receipt-zero-initializer-single-flight.v1";
const RECEIPT_ZERO_INITIALIZER_SCOPE_DOMAIN: &[u8] =
    b"openpencil.native-receipt-zero-initializer-stable-scope.v1";
const RECEIPT_ZERO_TRANSACTION_FORMAT: &str =
    "openpencil.native-supabase-backfill-receipt-zero-transaction.v1";
const RECEIPT_ZERO_CAS_QUERY_ID: &str = "backfill-receipt-zero-cas";
const RECEIPT_ZERO_CAS_QUERY_VERSION: &str = "openpencil-supabase-backfill-receipt-zero-cas-v1";
const RECEIPT_ZERO_CAS_SQL_DIGEST: &str = "ROtzUuqaSQ8SQa-B49dWe9lP1F2Tcu0wljVFaabAchc";
const RECEIPT_ZERO_CAS_PARAMETER_SCHEMA_DIGEST: &str =
    "3j14xx4T8NmZ8gNpc3OlylDz4zSt3sIj2zVnykaHumo";
const RECEIPT_ZERO_CAS_PARAMETER_VALUES_FORMAT: &str =
    "openpencil.supabase-backfill-receipt-zero-cas-parameters.v1";
const RECEIPT_ZERO_CAS_PARAMETER_ORDER: [&str; 28] = [
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
    "unauthenticatedOperationEvidenceDigest",
];
const RECEIPT_ZERO_MAXIMUM_CANONICAL_DOCUMENT_BYTES: usize = 65_536;
const RECEIPT_ZERO_MAXIMUM_PARAMETER_STRING_BYTES: usize = 87_384;
const RECEIPT_ZERO_MAXIMUM_AGGREGATE_PARAMETER_BYTES: usize = 256 * 1_024;
const RECEIPT_ZERO_INITIALIZER_OUTCOME_UNKNOWN_PROGRESS_FORMAT: &str =
    "openpencil.native-supabase-backfill-receipt-zero-initializer-outcome-unknown.v1";
const RECEIPT_ZERO_INITIALIZER_RECOVERY_FORMAT: &str =
    "openpencil.native-supabase-backfill-receipt-zero-initializer-recovery.v1";
const RECEIPT_ZERO_INITIALIZER_RECOVERY_ENCODING: &str = "canonical-json-standard-base64-chunks";
const RECEIPT_ZERO_INITIALIZER_RECOVERY_MAX_CANONICAL_BYTES: usize = 512 * 1_024;
const RECEIPT_ZERO_INITIALIZER_RECOVERY_CHUNK_BYTES: usize = MAX_KEY_BYTES;
const RECEIPT_ZERO_INITIALIZER_RECOVERY_MAX_ENCODED_BYTES: usize = 699_052;
const RECEIPT_ZERO_INITIALIZER_RECOVERY_MAX_CHUNKS: usize = 342;
#[cfg(test)]
const RECEIPT_ZERO_INITIALIZER_RECONCILIATION_AUTHORITY_DOMAIN: &[u8] =
    b"openpencil.native-receipt-zero-initializer-reconciliation-authority.v1";
const AUTOMATION_CAS_OWNER: &str = "native-automation-idempotency-cas";
const AUTOMATION_CAS_RELEASE_PREFIX: &str = "automation-idempotency-cas:";
const AUTOMATION_CAS_PLAN_DOMAIN: &[u8] =
    b"openpencil.native-supabase-automation-idempotency-cas-recovery-plan.v1";
const AUTOMATION_CAS_SINGLE_FLIGHT_DOMAIN: &[u8] =
    b"openpencil.native-automation-idempotency-cas-single-flight.v1";
const AUTOMATION_CAS_SCOPE_DOMAIN: &[u8] =
    b"openpencil.native-automation-idempotency-cas-head-scope.v1";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum JournalError {
    Unavailable,
    Invalid,
    Corrupt,
    Full,
    Conflict,
    ScopeConflict,
    InvalidState,
    CapabilityMissing,
    CapabilityExpired,
    LeaseActive,
    DurabilityUnconfirmed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CommitDurability {
    Confirmed,
    Unconfirmed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
enum OperationKindV1 {
    SupabaseAutomationIdempotencyCas,
    SupabaseBackfillDatabaseCasLedgerInstall,
    SupabaseBackfillReceiptZeroAdmission,
    SupabaseBackfillReceiptZeroInitializer,
}

const fn reconciliation_lease_ttl(operation_kind: OperationKindV1) -> Duration {
    match operation_kind {
        // The fixed read has a 30-second overall deadline. Give the fused testing composition a
        // fresh full deadline plus an equal cleanup/scheduling margin without changing any other
        // operation capability lifetime.
        OperationKindV1::SupabaseAutomationIdempotencyCas => {
            AUTOMATION_CAS_RECONCILIATION_LEASE_TTL
        }
        OperationKindV1::SupabaseBackfillReceiptZeroInitializer => {
            RECEIPT_ZERO_INITIALIZER_RECONCILIATION_LEASE_TTL
        }
        OperationKindV1::SupabaseBackfillDatabaseCasLedgerInstall
        | OperationKindV1::SupabaseBackfillReceiptZeroAdmission => CAPABILITY_TTL,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
enum OperationStateV1 {
    Claimed,
    OutcomeUnknown,
    Applied,
    Failed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
enum EvidencePhaseV1 {
    Progress,
    Final,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OperationEvidenceV1 {
    format: String,
    version: u32,
    phase: EvidencePhaseV1,
    payload: String,
    payload_digest: String,
    recorded_at_unix_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReconciliationLeaseRecordV1 {
    generation: u64,
    authority_digest: String,
    issued_at_unix_ms: u64,
    expires_at_unix_ms: u64,
    consumed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackendOperationRecordV1 {
    single_flight_key: String,
    dispatch_scope_key: String,
    provider_id: String,
    project_id: String,
    operation_kind: OperationKindV1,
    release_id: String,
    owner_id: String,
    plan_digest: String,
    claimed_at_unix_ms: u64,
    claim_lease_expires_at_unix_ms: u64,
    revision: u64,
    state: OperationStateV1,
    transitioned_at_unix_ms: Option<u64>,
    code: Option<String>,
    progress_evidence: Option<OperationEvidenceV1>,
    final_evidence: Option<OperationEvidenceV1>,
    reconciliation_lease: Option<ReconciliationLeaseRecordV1>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackendOperationTombstoneV1 {
    format: String,
    version: u32,
    record: BackendOperationRecordV1,
    record_digest: String,
    archived_generation: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyJournalBodyV1 {
    generation: u64,
    records: BTreeMap<String, BackendOperationRecordV1>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct JournalBodyV1 {
    generation: u64,
    records: BTreeMap<String, BackendOperationRecordV1>,
    tombstones: BTreeMap<String, BackendOperationTombstoneV1>,
}

impl Default for JournalBodyV1 {
    fn default() -> Self {
        Self {
            generation: 0,
            records: BTreeMap::new(),
            tombstones: BTreeMap::new(),
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct JournalEnvelopeV1 {
    format: String,
    version: u32,
    body: JournalBodyV1,
    body_digest: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyJournalEnvelopeV1 {
    format: String,
    version: u32,
    body: LegacyJournalBodyV1,
    body_digest: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct JournalEnvelopeHeaderV1 {
    format: String,
    version: u32,
    body: Value,
    body_digest: String,
}

/// Secret-free identity that will eventually be created only by the native installer review.
/// There is intentionally no production constructor in this slice.
#[derive(Clone)]
struct TrustedOperationPlanV1 {
    single_flight_key: String,
    dispatch_scope_key: String,
    provider_id: String,
    project_id: String,
    operation_kind: OperationKindV1,
    release_id: String,
    owner_id: String,
    plan_digest: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceLedgerAdmissionBindingV1<'a> {
    format: &'static str,
    version: u8,
    provider_id: &'a str,
    environment: &'a str,
    project_ref: &'a str,
    account_id: &'a str,
    grant_generation: &'a str,
    provider_authority_digest: &'a str,
    application_id: &'a str,
    application_digest: &'a str,
    migration_id: &'a str,
    migration_digest: &'a str,
    migration_plan_digest: &'a str,
    source_ledger_digest: &'a str,
    schema_digest: &'a str,
    subject_digest: &'a str,
    attestation_digest: &'a str,
    payload_digest: &'a str,
    expectation_digest: &'a str,
    verified_scope_digest: &'a str,
    ci_provider: &'a str,
    repository: &'a str,
    workflow: &'a str,
    run_id: &'a str,
    run_attempt: u64,
    protected_ref: &'a str,
    revision: &'a str,
    db_push_command_digest: &'a str,
    db_push_receipt_digest: &'a str,
    database_history_digest: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceLedgerAdmissionScopeV1<'a> {
    format: &'static str,
    version: u8,
    provider_id: &'a str,
    environment: &'a str,
    project_ref: &'a str,
    account_id: &'a str,
    grant_generation: &'a str,
    provider_authority_digest: &'a str,
    application_id: &'a str,
    application_digest: &'a str,
    migration_id: &'a str,
    migration_digest: &'a str,
    migration_plan_digest: &'a str,
    source_ledger_digest: &'a str,
    schema_digest: &'a str,
}

/// Journal-owned, secret-free copies of the four prerequisite subjects consumed by C0. The pure
/// data model, strict recovery deserialization, and validator compile in production, but conversion
/// into a trusted operation plan remains test-only. The Claimed record persists only their
/// canonical plan digest and stable scope digest.
#[derive(Clone, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReceiptZeroInitializerSourceMaterialV1 {
    pub(crate) provider_id: String,
    pub(crate) environment: String,
    pub(crate) project_ref: String,
    pub(crate) account_id: String,
    pub(crate) grant_generation: String,
    pub(crate) provider_authority_digest: String,
    pub(crate) application_id: String,
    pub(crate) application_digest: String,
    pub(crate) migration_id: String,
    pub(crate) migration_digest: String,
    pub(crate) migration_plan_digest: String,
    pub(crate) source_ledger_digest: String,
    pub(crate) schema_digest: String,
    pub(crate) subject_digest: String,
    pub(crate) attestation_digest: String,
    pub(crate) payload_digest: String,
    pub(crate) expectation_digest: String,
    pub(crate) scope_digest: String,
    pub(crate) ci_provider: String,
    pub(crate) repository: String,
    pub(crate) workflow: String,
    pub(crate) run_id: String,
    pub(crate) run_attempt: u64,
    pub(crate) protected_ref: String,
    pub(crate) revision: String,
    pub(crate) db_push_command_digest: String,
    pub(crate) db_push_receipt_digest: String,
    pub(crate) database_history_digest: String,
}

#[derive(Clone, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReceiptZeroInitializerInstallMaterialV1 {
    pub(crate) provider_id: String,
    pub(crate) environment: String,
    pub(crate) project_ref: String,
    pub(crate) account_id: String,
    pub(crate) read_grant_generation: String,
    pub(crate) write_grant_generation: String,
    pub(crate) migration_name: String,
    pub(crate) install_review_digest: String,
    pub(crate) source_review_digest: String,
    pub(crate) verification_digest: String,
    pub(crate) ledger_shape_digest: String,
    pub(crate) base_sql_digest: String,
    pub(crate) marker: String,
    pub(crate) marker_binding_digest: String,
    pub(crate) install_sql_digest: String,
    pub(crate) verification_query_digest: String,
    pub(crate) installed_verification_digest: String,
    pub(crate) observed_at: String,
    pub(crate) snapshot_marker: String,
    pub(crate) server_version_num: String,
}

#[derive(Clone, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReceiptZeroInitializerInspectionMaterialV1 {
    pub(crate) provider_id: String,
    pub(crate) provider_authority_digest: String,
    pub(crate) application_id: String,
    pub(crate) application_digest: String,
    pub(crate) migration_id: String,
    pub(crate) migration_digest: String,
    pub(crate) migration_plan_digest: String,
    pub(crate) inspection_subject_digest: String,
    pub(crate) table_name: String,
    pub(crate) cursor_field: String,
    pub(crate) target_field: String,
    pub(crate) maximum_cursor: u64,
    pub(crate) batch_size: u32,
    pub(crate) maximum_batch_receipt_count: u64,
}

#[derive(Clone, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReceiptZeroInitializerCaptureMaterialV1 {
    pub(crate) provider_id: String,
    pub(crate) environment: String,
    pub(crate) project_ref: String,
    pub(crate) account_id: String,
    pub(crate) source_grant_generation: String,
    pub(crate) read_grant_generation: String,
    pub(crate) install_write_grant_generation: String,
    pub(crate) capture_write_grant_generation: String,
    pub(crate) provider_authority_digest: String,
    pub(crate) application_id: String,
    pub(crate) application_digest: String,
    pub(crate) migration_id: String,
    pub(crate) migration_digest: String,
    pub(crate) migration_plan_digest: String,
    pub(crate) source_ledger_digest: String,
    pub(crate) source_scope_digest: String,
    pub(crate) schema_digest: String,
    pub(crate) source_ledger_subject_digest: String,
    pub(crate) inspection_subject_digest: String,
    pub(crate) attestation_digest: String,
    pub(crate) source_review_digest: String,
    pub(crate) install_plan_digest: String,
    pub(crate) install_review_digest: String,
    pub(crate) marker_binding_digest: String,
    pub(crate) installed_verification_digest: String,
    pub(crate) capture_review_digest: String,
    pub(crate) catalog_precondition_digest: String,
    pub(crate) query_digest: String,
    pub(crate) capture_digest: String,
    pub(crate) schema_name: String,
    pub(crate) schema_oid: String,
    pub(crate) table_name: String,
    pub(crate) table_oid: String,
    pub(crate) cursor_field: String,
    pub(crate) cursor_sub_id: u16,
    pub(crate) cursor_type_oid: String,
    pub(crate) target_field: String,
    pub(crate) target_sub_id: u16,
    pub(crate) target_type_oid: String,
    pub(crate) primary_key_oid: String,
    pub(crate) sequence_oid: String,
    pub(crate) barrier_constraint_oid: String,
    pub(crate) statement_count: u8,
    pub(crate) access_mode: String,
    pub(crate) snapshot_scope: String,
    pub(crate) lock_mode: String,
    pub(crate) transaction_isolation: String,
    pub(crate) transaction_read_only: bool,
    pub(crate) row_security: bool,
    pub(crate) search_path: String,
    pub(crate) database_primary: bool,
    pub(crate) maximum_cursor: u64,
    pub(crate) captured_high_water: Option<u64>,
    pub(crate) minimum_cursor: Option<u64>,
    pub(crate) total_row_count: u64,
    pub(crate) remaining_null_target_row_count: u64,
    pub(crate) unsafe_cursor_row_count: u64,
    pub(crate) batch_size: u32,
    pub(crate) required_batch_receipt_count: u64,
    pub(crate) maximum_batch_receipt_count: u64,
    pub(crate) observed_at: String,
    pub(crate) snapshot_marker: String,
    pub(crate) server_version_num: String,
    pub(crate) query_bindings_match: bool,
    pub(crate) current_and_session_role_match: bool,
    pub(crate) full_table_read_authority_observed: bool,
    pub(crate) exact_address_matches: bool,
    pub(crate) cursor_range_safe: bool,
    pub(crate) receipt_capacity_fits: bool,
    pub(crate) all_capture_checks_passed: bool,
}

/// Exact typed values for the reviewed Receipt-zero CAS statement's 28 positional parameters.
/// Keeping this as a named structure prevents callers from reordering or changing a parameter's
/// type after the initializer claim has been created.
#[derive(Clone, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReceiptZeroInitializerTransactionParametersV1 {
    pub(crate) execution_id: String,
    pub(crate) application_id: String,
    pub(crate) application_digest: String,
    pub(crate) migration_id: String,
    pub(crate) migration_digest: String,
    pub(crate) migration_plan_digest: String,
    pub(crate) provider_authority_digest: String,
    pub(crate) source_ledger_digest: String,
    pub(crate) scope_digest: String,
    pub(crate) resource_identity_digest: String,
    pub(crate) catalog_precondition_digest: String,
    pub(crate) canonical_scope_base64: String,
    pub(crate) capture_digest: String,
    pub(crate) captured_high_water: Option<u64>,
    pub(crate) initial_remaining_eligible_row_count: u64,
    pub(crate) initial_remaining_target_row_count: u64,
    pub(crate) required_matched_row_count: Option<u64>,
    pub(crate) required_batch_count: u32,
    pub(crate) batch_size: u32,
    pub(crate) initial_execution_status: String,
    pub(crate) candidate_committed_at: String,
    pub(crate) event_id: String,
    pub(crate) receipt_id: String,
    pub(crate) idempotency_key: String,
    pub(crate) request_digest: String,
    pub(crate) receipt_digest: String,
    pub(crate) canonical_receipt_base64: String,
    pub(crate) unauthenticated_operation_evidence_digest: String,
}

/// Secret-free immutable transaction material retained by the opaque initializer handle. At the
/// Claimed stage the journal persists only the canonical plan digest, never these raw values or
/// canonical documents. A future specialized precommit may durably copy the minimum recovery
/// material only while crossing the OutcomeUnknown fence.
#[derive(Clone, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReceiptZeroInitializerTransactionMaterialV1 {
    pub(crate) format: String,
    pub(crate) version: u8,
    pub(crate) query_id: String,
    pub(crate) query_version: String,
    pub(crate) statement_count: u8,
    pub(crate) isolation: String,
    pub(crate) access_mode: String,
    pub(crate) transaction_sql_digest: String,
    pub(crate) parameter_schema_digest: String,
    pub(crate) parameter_values_digest: String,
    pub(crate) parameters: ReceiptZeroInitializerTransactionParametersV1,
}

#[derive(Clone, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReceiptZeroInitializerClaimMaterialV1 {
    pub(crate) source: ReceiptZeroInitializerSourceMaterialV1,
    pub(crate) installed: ReceiptZeroInitializerInstallMaterialV1,
    pub(crate) inspection: ReceiptZeroInitializerInspectionMaterialV1,
    pub(crate) capture: ReceiptZeroInitializerCaptureMaterialV1,
    pub(crate) transaction: ReceiptZeroInitializerTransactionMaterialV1,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReceiptZeroInitializerCanonicalPlanV1<'a> {
    format: &'static str,
    version: u8,
    material: &'a ReceiptZeroInitializerClaimMaterialV1,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReceiptZeroInitializerStableScopeV1<'a> {
    format: &'static str,
    version: u8,
    provider_id: &'a str,
    project_ref: &'a str,
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReceiptZeroScopeDocumentV2 {
    format: String,
    version: u8,
    provider_id: String,
    environment: String,
    provider_authority_digest: String,
    application_id: String,
    application_digest: String,
    migration_id: String,
    migration_digest: String,
    migration_plan_digest: String,
    source_ledger_digest: String,
    capture_digest: String,
    receipt_zero_evidence_digest: String,
    resource_identity_digest: String,
    catalog_precondition_digest: String,
    entity_id: String,
    cursor_field: String,
    cursor_field_type: String,
    target_field: String,
    batch_size: u64,
    maximum_receipt_count: u64,
    maximum_batch_count: u64,
    captured_high_water: Option<u64>,
    initial_remaining_eligible_row_count: u64,
    initial_remaining_target_row_count: u64,
    required_batch_count: u64,
    required_matched_row_count: Option<u64>,
    resume_policy: String,
    completion_rule: String,
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReceiptZeroCountsDocumentV2 {
    scanned_row_count: u64,
    matched_row_count: u64,
    updated_row_count: u64,
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReceiptZeroExhaustionDocumentV2 {
    checked: bool,
    remaining_eligible_row_count: Option<u64>,
    remaining_target_row_count: Option<u64>,
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReceiptZeroPostconditionsDocumentV2 {
    field_not_null: bool,
    required_matched_row_count: Option<u64>,
    matched_row_count_satisfied: bool,
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReceiptZeroReceiptDocumentV2 {
    format: String,
    version: u8,
    receipt_id: String,
    execution_id: String,
    idempotency_key: String,
    request_digest: String,
    scope: ReceiptZeroScopeDocumentV2,
    scope_digest: String,
    checkpoint_kind: String,
    batch_index: u64,
    previous_cursor: Option<u64>,
    last_processed_key: Option<u64>,
    batch_counts: ReceiptZeroCountsDocumentV2,
    cumulative_counts: ReceiptZeroCountsDocumentV2,
    exhaustion: ReceiptZeroExhaustionDocumentV2,
    postconditions: ReceiptZeroPostconditionsDocumentV2,
    outcome: String,
    terminal_reason: Option<String>,
    stable_error_code: Option<String>,
    previous_receipt_digest: Option<String>,
    catalog_evidence_digest: String,
    operation_authority_digest: String,
    database_event_id: String,
    database_head_version: u64,
    committed_at: String,
    evidence_digest: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReceiptZeroParameterValuesDocumentV1<'a> {
    format: &'static str,
    version: u8,
    order: &'static [&'static str; 28],
    values: &'a [Value],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReceiptZeroResourceIdentityV1<'a> {
    format: &'static str,
    project_ref: &'a str,
    address: ReceiptZeroResourceAddressV1<'a>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReceiptZeroResourceAddressV1<'a> {
    schema_name: &'a str,
    schema_oid: &'a str,
    table_name: &'a str,
    table_oid: &'a str,
    cursor_field: &'a str,
    cursor_sub_id: u16,
    cursor_type_oid: &'a str,
    target_field: &'a str,
    target_sub_id: u16,
    target_type_oid: &'a str,
    primary_key_oid: &'a str,
    sequence_oid: &'a str,
    barrier_constraint_oid: &'a str,
}

/// Pure, private result of validating and canonicalizing all initializer prerequisites plus the
/// exact Receipt-zero transaction material. It is not a journal capability or a constructor for a
/// trusted operation plan.
#[derive(PartialEq, Eq)]
struct ValidatedReceiptZeroInitializerIdentityV1 {
    single_flight_key: String,
    dispatch_scope_key: String,
    provider_id: String,
    project_id: String,
    release_id: String,
    owner_id: String,
    plan_digest: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AutomationCasCanonicalPlanV1<'a> {
    format: &'static str,
    material: &'a AutomationCasRecoveryMaterialV1,
    version: u8,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AutomationCasSingleFlightV1<'a> {
    operation: &'static str,
    plan_digest: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AutomationCasHeadScopeV1<'a> {
    application_object_key: &'a str,
    automation_id: &'a str,
    idempotency_key_digest: &'a str,
    project_ref: &'a str,
    provider_id: &'a str,
    schema_name: &'a str,
}

#[derive(Clone, PartialEq, Eq)]
struct AutomationCasJournalIdentityV1 {
    dispatch_scope_key: String,
    plan_digest: String,
    single_flight_key: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AutomationCasOutcomeUnknownProgressV1 {
    automatic_retry_allowed: bool,
    execution_authorized: bool,
    format: String,
    material: AutomationCasRecoveryMaterialV1,
    mutation_authorized: bool,
    phase: String,
    plan_digest: String,
    receipt_v2_issued: bool,
    release_authorized: bool,
    version: u8,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReceiptZeroInitializerRecoveryMaterialV1 {
    canonical_byte_length: u32,
    canonical_digest: String,
    chunks: Vec<String>,
    encoding: String,
    format: String,
    version: u8,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReceiptZeroInitializerOutcomeUnknownProgressV1 {
    automatic_retry_allowed: bool,
    execution_authorized: bool,
    format: String,
    mutation_authorized: bool,
    phase: String,
    plan_digest: String,
    receipt_v2_issued: bool,
    recovery: ReceiptZeroInitializerRecoveryMaterialV1,
    release_authorized: bool,
    version: u8,
}

struct ClaimCapabilityV1 {
    id: [u8; CAPABILITY_BYTES],
}

/// Opaque journal capability for one durably claimed, fully reviewed Automation CAS plan. Raw
/// renderer material cannot construct this value.
pub(crate) struct AutomationCasJournalClaimV1 {
    capability: ClaimCapabilityV1,
    identity: AutomationCasJournalIdentityV1,
    material: AutomationCasRecoveryMaterialV1,
}

/// Same-process evidence that the Automation CAS record crossed the durable OutcomeUnknown fence.
/// The retained settlement authority is deliberately accepted by no Automation API in this slice.
pub(crate) struct AutomationCasJournalOutcomeUnknownV1 {
    _settlement: DispatchSettlementAuthorityV1,
    identity: AutomationCasJournalIdentityV1,
    _material: AutomationCasRecoveryMaterialV1,
}

#[cfg(test)]
impl AutomationCasJournalOutcomeUnknownV1 {
    pub(crate) fn single_flight_key_for_test(&self) -> &str {
        &self.identity.single_flight_key
    }
}

/// Restart capability reconstructed only from the exact record and its journal-owned progress
/// evidence. It is not serializable or cloneable.
pub(crate) struct AutomationCasJournalRecoveryV1 {
    capability: RecoveryCapabilityV1,
    identity: AutomationCasJournalIdentityV1,
    material: AutomationCasRecoveryMaterialV1,
}

/// One durable reconciliation lease which has not yet been consumed for a fixed read.
pub(crate) struct AutomationCasJournalReconciliationPermitV1 {
    identity: AutomationCasJournalIdentityV1,
    material: AutomationCasRecoveryMaterialV1,
    permit: ReconciliationPermitV1,
}

/// One durably consumed read attempt. The opaque observation authority has no public consumption or
/// settlement path in this slice.
pub(crate) struct AutomationCasJournalReadAttemptV1 {
    _authority: ReconciliationObservationAuthorityV1,
    _identity: AutomationCasJournalIdentityV1,
    material: AutomationCasRecoveryMaterialV1,
}

#[cfg(test)]
impl AutomationCasJournalReadAttemptV1 {
    pub(crate) fn material_for_composition(&self) -> &AutomationCasRecoveryMaterialV1 {
        &self.material
    }
}

#[derive(Clone, PartialEq, Eq)]
struct CasLedgerInstallJournalIdentityV1 {
    single_flight_key: String,
    dispatch_scope_key: String,
    plan_digest: String,
}

/// Opaque journal capability for one durably claimed CAS-ledger install plan. It deliberately has
/// no Clone/Debug/Serialize/Deserialize implementation.
pub(crate) struct CasLedgerInstallJournalClaimV1 {
    capability: ClaimCapabilityV1,
    material: CasLedgerInstallPlanMaterialV1,
    identity: CasLedgerInstallJournalIdentityV1,
}

impl CasLedgerInstallJournalClaimV1 {
    pub(crate) fn material_for_composition(&self) -> &CasLedgerInstallPlanMaterialV1 {
        &self.material
    }

    #[cfg(test)]
    pub(crate) fn plan_digest_for_test(&self) -> &str {
        &self.identity.plan_digest
    }

    #[cfg(test)]
    pub(crate) fn single_flight_key_for_test(&self) -> &str {
        &self.identity.single_flight_key
    }
}

#[cfg(test)]
pub(crate) struct CasLedgerInstallJournalOutcomeUnknownV1 {
    settlement: DispatchSettlementAuthorityV1,
    material: CasLedgerInstallPlanMaterialV1,
    identity: CasLedgerInstallJournalIdentityV1,
}

#[cfg(test)]
pub(crate) struct CasLedgerInstallJournalAppliedV1 {
    material: CasLedgerInstallInstalledObservationMaterialV1,
    identity: CasLedgerInstallJournalIdentityV1,
}

#[cfg(test)]
impl CasLedgerInstallJournalAppliedV1 {
    pub(crate) fn plan_digest_for_initializer_for_test(&self) -> &str {
        &self.identity.plan_digest
    }

    pub(crate) fn into_initializer_material_for_test(
        self,
    ) -> Result<(CasLedgerInstallInstalledObservationMaterialV1, String), JournalError> {
        let (_, identity) = cas_ledger_install_plan(&self.material.plan)?;
        if identity != self.identity {
            return Err(JournalError::InvalidState);
        }
        Ok((self.material, self.identity.plan_digest))
    }
}

/// Opaque journal capability for a durably persisted receipt-zero admission. It deliberately has
/// no Clone/Debug/Serialize/Deserialize implementation and cannot be turned into a dispatch permit.
pub(crate) struct SourceLedgerAdmissionClaimV1 {
    capability: ClaimCapabilityV1,
    material: SourceLedgerAdmissionClaimMaterialV1,
}

/// Opaque claim-only handoff for one durably fenced Receipt-zero initializer. It cannot be cloned
/// or serialized; only the exact initializer precommit consumes it.
#[cfg(test)]
#[must_use]
pub(crate) struct ReceiptZeroInitializerJournalClaimV1 {
    capability: ClaimCapabilityV1,
    material: ReceiptZeroInitializerClaimMaterialV1,
    single_flight_key: String,
    plan_digest: String,
}

/// Durable, but still inert, initializer precommit staging. The journal has crossed the exact
/// OutcomeUnknown fence and the original claim runtime id is already burned. This token creates no
/// dispatch authority by itself; only the exact journal instance which staged it may publish the
/// one-shot handoff after rechecking the same record and the original dual-clock ceiling.
#[cfg(test)]
#[must_use]
pub(crate) struct ReceiptZeroInitializerJournalStagedOutcomeUnknownV1 {
    journal_process_lock: Weak<Mutex<()>>,
    capability_id: [u8; CAPABILITY_BYTES],
    record_digest: String,
    record_revision: u64,
    issued_at_unix_ms: u64,
    issued_at_monotonic: Duration,
    expires_at_unix_ms: u64,
    expires_at_monotonic: Duration,
    identity: ValidatedReceiptZeroInitializerIdentityV1,
    material: ReceiptZeroInitializerClaimMaterialV1,
    capture_digest: String,
}

#[cfg(test)]
impl ReceiptZeroInitializerJournalStagedOutcomeUnknownV1 {
    pub(crate) fn capture_material_for_composition(
        &self,
    ) -> &ReceiptZeroInitializerCaptureMaterialV1 {
        &self.material.capture
    }

    pub(crate) fn single_flight_key_for_test(&self) -> &str {
        &self.identity.single_flight_key
    }
}

/// Opaque one-shot dispatch handoff returned only after the initializer's OutcomeUnknown record
/// and journal-owned recovery chunks are durably persisted. Only the exact live-run-window issuer
/// can consume it.
#[cfg(test)]
#[must_use]
pub(crate) struct ReceiptZeroInitializerJournalDispatchV1 {
    permit: DispatchPermitV1,
    issued_at_monotonic: Duration,
    identity: ValidatedReceiptZeroInitializerIdentityV1,
    material: ReceiptZeroInitializerClaimMaterialV1,
}

#[cfg(test)]
impl ReceiptZeroInitializerJournalDispatchV1 {
    pub(crate) fn material_for_test(&self) -> &ReceiptZeroInitializerClaimMaterialV1 {
        &self.material
    }

    pub(crate) fn single_flight_key_for_test(&self) -> &str {
        &self.identity.single_flight_key
    }
}

/// Opaque restart-only handle reconstructed from exact journal-owned OutcomeUnknown evidence.
/// Only the initializer-specific lease issuer can consume it.
#[cfg(test)]
#[must_use]
pub(crate) struct ReceiptZeroInitializerJournalRecoveryV1 {
    capability: RecoveryCapabilityV1,
    issued_at_monotonic: Duration,
    identity: ValidatedReceiptZeroInitializerIdentityV1,
    material: ReceiptZeroInitializerClaimMaterialV1,
}

#[cfg(test)]
impl ReceiptZeroInitializerJournalRecoveryV1 {
    pub(crate) fn material_for_test(&self) -> &ReceiptZeroInitializerClaimMaterialV1 {
        &self.material
    }

    pub(crate) fn single_flight_key_for_test(&self) -> &str {
        &self.identity.single_flight_key
    }
}

/// One opaque, one-shot 60-second durable reconciliation lease handoff. The caller cannot choose
/// a timeout or convert this into live mutation authority.
#[cfg(test)]
#[must_use]
pub(crate) struct ReceiptZeroInitializerJournalReconciliationPermitV1 {
    permit: ReconciliationPermitV1,
    issued_at_monotonic: Duration,
    identity: ValidatedReceiptZeroInitializerIdentityV1,
    material: ReceiptZeroInitializerClaimMaterialV1,
}

/// A fixed 25-second live mutation runner window. It has no database adapter in this slice and is
/// intentionally a different type from the restart fixed-read window.
#[cfg(test)]
#[must_use]
pub(crate) struct ReceiptZeroInitializerInertLivePrecommitRunWindowV1 {
    _attempt: DispatchAttemptV1,
    journal_process_lock: Weak<Mutex<()>>,
    record_digest: String,
    identity: ValidatedReceiptZeroInitializerIdentityV1,
    material: ReceiptZeroInitializerClaimMaterialV1,
    issued_at_unix_ms: u64,
    issued_at_monotonic: Duration,
    expires_at_unix_ms: u64,
    expires_at_monotonic: Duration,
}

/// Final, one-shot clock ceiling for the test-only fused initializer writer. Creating it consumes
/// the inert live window only after the exact OutcomeUnknown record and runtime attempt binding are
/// rechecked. It exposes only a relative remaining budget to the private fixed runner, never either
/// JournalClock absolute value.
#[cfg(test)]
#[must_use]
pub(crate) struct ReceiptZeroInitializerLiveExecutionCeilingV1 {
    clock: Arc<dyn JournalClock>,
    last_sample: Mutex<JournalClockSampleV1>,
    issued_at_unix_ms: u64,
    issued_at_monotonic: Duration,
    expires_at_unix_ms: u64,
    expires_at_monotonic: Duration,
}

#[cfg(test)]
impl ReceiptZeroInitializerLiveExecutionCeilingV1 {
    /// Consumes the projection token exactly once. The returned relative duration is the only
    /// value which may be mapped onto the connector clock; the active ceiling independently keeps
    /// checking both journal clocks without ever returning another budget to re-project.
    pub(crate) fn activate_for_runner_for_test(
        self,
    ) -> Result<(ReceiptZeroInitializerActiveLiveExecutionCeilingV1, Duration), JournalError> {
        let remaining = receipt_zero_initializer_live_ceiling_remaining(
            self.clock.as_ref(),
            &self.last_sample,
            self.issued_at_unix_ms,
            self.issued_at_monotonic,
            self.expires_at_unix_ms,
            self.expires_at_monotonic,
        )?;
        Ok((
            ReceiptZeroInitializerActiveLiveExecutionCeilingV1 {
                clock: self.clock,
                last_sample: self.last_sample,
                issued_at_unix_ms: self.issued_at_unix_ms,
                issued_at_monotonic: self.issued_at_monotonic,
                expires_at_unix_ms: self.expires_at_unix_ms,
                expires_at_monotonic: self.expires_at_monotonic,
            },
            remaining,
        ))
    }
}

/// Active half of the one-shot live ceiling. It can only fail closed on later polls; it cannot
/// yield another relative duration and therefore cannot extend the connector-clock projection.
#[cfg(test)]
#[must_use]
pub(crate) struct ReceiptZeroInitializerActiveLiveExecutionCeilingV1 {
    clock: Arc<dyn JournalClock>,
    last_sample: Mutex<JournalClockSampleV1>,
    issued_at_unix_ms: u64,
    issued_at_monotonic: Duration,
    expires_at_unix_ms: u64,
    expires_at_monotonic: Duration,
}

#[cfg(test)]
impl ReceiptZeroInitializerActiveLiveExecutionCeilingV1 {
    pub(crate) fn require_fresh_for_runner_for_test(&self) -> Result<(), JournalError> {
        receipt_zero_initializer_live_ceiling_remaining(
            self.clock.as_ref(),
            &self.last_sample,
            self.issued_at_unix_ms,
            self.issued_at_monotonic,
            self.expires_at_unix_ms,
            self.expires_at_monotonic,
        )?;
        Ok(())
    }
}

#[cfg(test)]
fn receipt_zero_initializer_live_ceiling_remaining(
    clock: &dyn JournalClock,
    last_sample: &Mutex<JournalClockSampleV1>,
    issued_at_unix_ms: u64,
    issued_at_monotonic: Duration,
    expires_at_unix_ms: u64,
    expires_at_monotonic: Duration,
) -> Result<Duration, JournalError> {
    let sample = JournalClockSampleV1 {
        wall_unix_ms: clock.wall_unix_millis()?,
        monotonic: clock.monotonic(),
    };
    let mut last_sample = last_sample.lock().map_err(|_| JournalError::Unavailable)?;
    if sample.wall_unix_ms < last_sample.wall_unix_ms
        || sample.monotonic < last_sample.monotonic
        || sample.wall_unix_ms < issued_at_unix_ms
        || sample.monotonic < issued_at_monotonic
    {
        return Err(JournalError::InvalidState);
    }
    if sample.wall_unix_ms >= expires_at_unix_ms || sample.monotonic >= expires_at_monotonic {
        return Err(JournalError::CapabilityExpired);
    }
    let wall_remaining = Duration::from_millis(
        expires_at_unix_ms
            .checked_sub(sample.wall_unix_ms)
            .ok_or(JournalError::InvalidState)?,
    );
    let monotonic_remaining = expires_at_monotonic
        .checked_sub(sample.monotonic)
        .ok_or(JournalError::InvalidState)?;
    *last_sample = sample;
    Ok(wall_remaining.min(monotonic_remaining))
}

/// A fixed 30-second restart reconciliation read window. It has no database adapter or settlement
/// path in this slice and cannot be exchanged for mutation authority.
#[cfg(test)]
#[must_use]
pub(crate) struct ReceiptZeroInitializerReconciliationReadRunWindowV1 {
    _authority: ReconciliationObservationAuthorityV1,
    identity: ValidatedReceiptZeroInitializerIdentityV1,
    material: ReceiptZeroInitializerClaimMaterialV1,
    issued_at_unix_ms: u64,
    issued_at_monotonic: Duration,
    expires_at_unix_ms: u64,
    expires_at_monotonic: Duration,
}

#[cfg(test)]
impl ReceiptZeroInitializerInertLivePrecommitRunWindowV1 {
    pub(crate) const fn database_authority_created_for_test(&self) -> bool {
        false
    }

    pub(crate) const fn execution_authorized_for_test(&self) -> bool {
        false
    }

    pub(crate) fn material_for_test(&self) -> &ReceiptZeroInitializerClaimMaterialV1 {
        &self.material
    }

    pub(crate) fn single_flight_key_for_test(&self) -> &str {
        &self.identity.single_flight_key
    }

    pub(crate) fn window_for_test(&self) -> (u64, u64, Duration, Duration) {
        (
            self.issued_at_unix_ms,
            self.expires_at_unix_ms,
            self.issued_at_monotonic,
            self.expires_at_monotonic,
        )
    }
}

#[cfg(test)]
impl ReceiptZeroInitializerReconciliationReadRunWindowV1 {
    pub(crate) const fn database_authority_created_for_test(&self) -> bool {
        false
    }

    pub(crate) const fn settlement_authorized_for_test(&self) -> bool {
        false
    }

    pub(crate) fn material_for_test(&self) -> &ReceiptZeroInitializerClaimMaterialV1 {
        &self.material
    }

    pub(crate) fn single_flight_key_for_test(&self) -> &str {
        &self.identity.single_flight_key
    }

    pub(crate) fn window_for_test(&self) -> (u64, u64, Duration, Duration) {
        (
            self.issued_at_unix_ms,
            self.expires_at_unix_ms,
            self.issued_at_monotonic,
            self.expires_at_monotonic,
        )
    }
}

#[cfg(test)]
impl ReceiptZeroInitializerJournalClaimV1 {
    pub(crate) fn material_for_composition(&self) -> &ReceiptZeroInitializerClaimMaterialV1 {
        &self.material
    }

    pub(crate) fn plan_digest_for_test(&self) -> &str {
        &self.plan_digest
    }

    pub(crate) fn single_flight_key_for_test(&self) -> &str {
        &self.single_flight_key
    }
}

/// Test-only, sealed material released after the transient admission capability is consumed. The
/// durable Claimed replay fence remains in the journal.
#[cfg(test)]
pub(crate) struct ConsumedSourceLedgerAdmissionClaimV1 {
    material: SourceLedgerAdmissionClaimMaterialV1,
}

#[cfg(test)]
impl ConsumedSourceLedgerAdmissionClaimV1 {
    pub(crate) fn material_for_composition(&self) -> &SourceLedgerAdmissionClaimMaterialV1 {
        &self.material
    }
}

struct DispatchPermitV1 {
    id: [u8; CAPABILITY_BYTES],
}

struct DispatchAttemptV1 {
    id: [u8; CAPABILITY_BYTES],
}

struct DispatchSettlementAuthorityV1 {
    id: [u8; CAPABILITY_BYTES],
}

struct KnownNotDispatchedProofV1 {
    id: [u8; CAPABILITY_BYTES],
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum RecoveryKindV1 {
    ClaimedKnownNotDispatched,
    OutcomeUnknownReconciliation,
}

struct RecoveryCapabilityV1 {
    id: [u8; CAPABILITY_BYTES],
    kind: RecoveryKindV1,
}

struct ReconciliationPermitV1 {
    id: [u8; CAPABILITY_BYTES],
}

struct ReconciliationObservationAuthorityV1 {
    id: [u8; CAPABILITY_BYTES],
}

#[derive(Clone)]
struct CapabilityBindingV1 {
    single_flight_key: String,
    operation_kind: OperationKindV1,
    record_digest: String,
    issued_at_unix_ms: u64,
    expires_at_unix_ms: u64,
    expires_at_monotonic: Duration,
}

#[derive(Clone)]
struct ReconciliationCapabilityBindingV1 {
    binding: CapabilityBindingV1,
    authority_digest: String,
    lease_generation: u64,
    lease_expires_at_unix_ms: u64,
    lease_expires_at_monotonic: Duration,
}

#[derive(Default)]
struct RuntimeAuthoritiesV1 {
    /// IDs are reserved while a durable state transition is in progress so another thread cannot
    /// receive the same opaque capability between collision checking and activation.
    reserved: HashMap<[u8; CAPABILITY_BYTES], Duration>,
    /// Consumed terminal IDs stay burned until their original expiry. This prevents an entropy
    /// collision from turning a replayed old token into authority for a newer operation.
    burned: HashMap<[u8; CAPABILITY_BYTES], Duration>,
    claims: HashMap<[u8; CAPABILITY_BYTES], CapabilityBindingV1>,
    permits: HashMap<[u8; CAPABILITY_BYTES], CapabilityBindingV1>,
    dispatch_attempts: HashMap<[u8; CAPABILITY_BYTES], CapabilityBindingV1>,
    dispatch_settlements: HashMap<[u8; CAPABILITY_BYTES], CapabilityBindingV1>,
    known_not_dispatched: HashMap<[u8; CAPABILITY_BYTES], CapabilityBindingV1>,
    recoveries: HashMap<[u8; CAPABILITY_BYTES], (CapabilityBindingV1, RecoveryKindV1)>,
    reconciliation_permits: HashMap<[u8; CAPABILITY_BYTES], ReconciliationCapabilityBindingV1>,
    reconciliation_observations: HashMap<[u8; CAPABILITY_BYTES], ReconciliationCapabilityBindingV1>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum StartupRecoveryStateV1 {
    Pending,
    Ready,
    Blocked(JournalError),
}

pub(crate) trait JournalEntropy: Send + Sync {
    fn capability_id(&self) -> Result<[u8; CAPABILITY_BYTES], JournalError>;
}

struct SystemJournalEntropy(SystemRandom);

impl JournalEntropy for SystemJournalEntropy {
    fn capability_id(&self) -> Result<[u8; CAPABILITY_BYTES], JournalError> {
        let mut bytes = [0_u8; CAPABILITY_BYTES];
        self.0
            .fill(&mut bytes)
            .map_err(|_| JournalError::Unavailable)?;
        Ok(bytes)
    }
}

#[cfg(test)]
#[derive(Clone, Copy)]
struct JournalClockSampleV1 {
    wall_unix_ms: u64,
    monotonic: Duration,
}

#[cfg(test)]
#[derive(Clone, Copy)]
struct FixedRunnerWindowV1 {
    issued_at_unix_ms: u64,
    issued_at_monotonic: Duration,
    expires_at_unix_ms: u64,
    expires_at_monotonic: Duration,
}

pub(crate) trait JournalClock: Send + Sync {
    fn wall_unix_millis(&self) -> Result<u64, JournalError>;
    fn monotonic(&self) -> Duration;
}

struct SystemJournalClock {
    origin: Instant,
}

impl JournalClock for SystemJournalClock {
    fn wall_unix_millis(&self) -> Result<u64, JournalError> {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| JournalError::Unavailable)?
            .as_millis();
        u64::try_from(millis).map_err(|_| JournalError::Unavailable)
    }

    fn monotonic(&self) -> Duration {
        self.origin.elapsed()
    }
}

pub(crate) trait DirectorySync: Send + Sync {
    fn sync(&self, directory: &Path) -> Result<(), JournalError>;
}

struct SystemDirectorySync;

impl DirectorySync for SystemDirectorySync {
    fn sync(&self, directory: &Path) -> Result<(), JournalError> {
        sync_directory(directory)
    }
}

pub(crate) struct BackendOperationJournalV1 {
    root: Option<PathBuf>,
    process_lock: Arc<Mutex<()>>,
    startup_recovery: Mutex<StartupRecoveryStateV1>,
    runtime: Mutex<RuntimeAuthoritiesV1>,
    entropy: Arc<dyn JournalEntropy>,
    clock: Arc<dyn JournalClock>,
    directory_sync: Arc<dyn DirectorySync>,
}

impl BackendOperationJournalV1 {
    pub(crate) fn new(app_local_data_dir: PathBuf) -> Self {
        Self {
            root: Some(app_local_data_dir.join(STORE_DIRECTORY)),
            process_lock: Arc::new(Mutex::new(())),
            startup_recovery: Mutex::new(StartupRecoveryStateV1::Pending),
            runtime: Mutex::new(RuntimeAuthoritiesV1::default()),
            entropy: Arc::new(SystemJournalEntropy(SystemRandom::new())),
            clock: Arc::new(SystemJournalClock {
                origin: Instant::now(),
            }),
            directory_sync: Arc::new(SystemDirectorySync),
        }
    }

    fn unavailable() -> Self {
        Self {
            root: None,
            process_lock: Arc::new(Mutex::new(())),
            startup_recovery: Mutex::new(StartupRecoveryStateV1::Pending),
            runtime: Mutex::new(RuntimeAuthoritiesV1::default()),
            entropy: Arc::new(SystemJournalEntropy(SystemRandom::new())),
            clock: Arc::new(SystemJournalClock {
                origin: Instant::now(),
            }),
            directory_sync: Arc::new(SystemDirectorySync),
        }
    }

    #[cfg(test)]
    pub(crate) fn with_test_dependencies(
        app_local_data_dir: PathBuf,
        entropy: Arc<dyn JournalEntropy>,
        clock: Arc<dyn JournalClock>,
        directory_sync: Arc<dyn DirectorySync>,
    ) -> Self {
        Self {
            root: Some(app_local_data_dir.join(STORE_DIRECTORY)),
            process_lock: Arc::new(Mutex::new(())),
            startup_recovery: Mutex::new(StartupRecoveryStateV1::Pending),
            runtime: Mutex::new(RuntimeAuthoritiesV1::default()),
            entropy,
            clock,
            directory_sync,
        }
    }

    fn with_store<T>(
        &self,
        operation: impl FnOnce(&Path) -> Result<T, JournalError>,
    ) -> Result<T, JournalError> {
        let root = self.root.as_deref().ok_or(JournalError::Unavailable)?;
        let _process_guard = acquire_process_lock(&self.process_lock)?;
        ensure_store_directory(root)?;
        let _file_guard = JournalFileLock::acquire(&root.join(LOCK_FILE))?;
        cleanup_stale_staging_files(root)?;
        self.ensure_startup_recovery(root)?;
        operation(root)
    }

    fn ensure_startup_recovery(&self, root: &Path) -> Result<(), JournalError> {
        let mut state = self
            .startup_recovery
            .lock()
            .map_err(|_| JournalError::Unavailable)?;
        match *state {
            StartupRecoveryStateV1::Ready => return Ok(()),
            StartupRecoveryStateV1::Blocked(error) => return Err(error),
            StartupRecoveryStateV1::Pending => {}
        }
        let result = (|| {
            let mut body = load_journal(root)?;
            if archive_terminal_records(&mut body)? == 0 {
                return Ok(());
            }
            match persist_journal(root, &body, self.directory_sync.as_ref())? {
                CommitDurability::Confirmed => Ok(()),
                CommitDurability::Unconfirmed => Err(JournalError::DurabilityUnconfirmed),
            }
        })();
        *state = match result {
            Ok(()) => StartupRecoveryStateV1::Ready,
            Err(error) => StartupRecoveryStateV1::Blocked(error),
        };
        result
    }

    fn list_unresolved(&self) -> Result<Vec<BackendOperationRecordV1>, JournalError> {
        self.with_store(|root| {
            let body = load_journal(root)?;
            Ok(body
                .records
                .values()
                .filter(|record| {
                    record.operation_kind
                        == OperationKindV1::SupabaseBackfillDatabaseCasLedgerInstall
                        && matches!(
                            record.state,
                            OperationStateV1::Claimed | OperationStateV1::OutcomeUnknown
                        )
                })
                .cloned()
                .collect())
        })
    }

    #[cfg(test)]
    pub(crate) fn source_ledger_admission_count_for_test(&self) -> Result<usize, JournalError> {
        self.with_store(|root| {
            Ok(load_journal(root)?
                .records
                .values()
                .filter(|record| {
                    record.operation_kind == OperationKindV1::SupabaseBackfillReceiptZeroAdmission
                        && record.state == OperationStateV1::Claimed
                })
                .count())
        })
    }

    #[cfg(test)]
    pub(crate) fn receipt_zero_initializer_count_for_test(&self) -> Result<usize, JournalError> {
        self.with_store(|root| {
            Ok(load_journal(root)?
                .records
                .values()
                .filter(|record| {
                    record.operation_kind == OperationKindV1::SupabaseBackfillReceiptZeroInitializer
                        && record.state == OperationStateV1::Claimed
                })
                .count())
        })
    }

    #[cfg(test)]
    pub(crate) fn receipt_zero_initializer_outcome_unknown_count_for_test(
        &self,
    ) -> Result<usize, JournalError> {
        self.with_store(|root| {
            Ok(load_journal(root)?
                .records
                .values()
                .filter(|record| {
                    record.operation_kind == OperationKindV1::SupabaseBackfillReceiptZeroInitializer
                        && record.state == OperationStateV1::OutcomeUnknown
                })
                .count())
        })
    }

    #[cfg(test)]
    pub(crate) fn receipt_zero_initializer_dispatch_permit_count_for_test(
        &self,
    ) -> Result<usize, JournalError> {
        Ok(self
            .runtime_lock()?
            .permits
            .values()
            .filter(|binding| {
                binding.operation_kind == OperationKindV1::SupabaseBackfillReceiptZeroInitializer
            })
            .count())
    }

    pub(crate) fn claim_source_ledger_admission(
        &self,
        proof: ConsumedSourceLedgerAdmissionProofV1,
    ) -> Result<SourceLedgerAdmissionClaimV1, JournalError> {
        self.claim_source_ledger_admission_material(proof.into_claim_material())
    }

    fn claim_source_ledger_admission_material(
        &self,
        material: SourceLedgerAdmissionClaimMaterialV1,
    ) -> Result<SourceLedgerAdmissionClaimV1, JournalError> {
        let plan = source_ledger_admission_plan(&material)?;
        let capability = self.claim_plan(plan, CAPABILITY_TTL)?;
        Ok(SourceLedgerAdmissionClaimV1 {
            capability,
            material,
        })
    }

    #[cfg(test)]
    pub(crate) fn claim_source_ledger_admission_material_for_test(
        &self,
        material: SourceLedgerAdmissionClaimMaterialV1,
    ) -> Result<SourceLedgerAdmissionClaimV1, JournalError> {
        self.claim_source_ledger_admission_material(material)
    }

    /// Test-only composition boundary. Production has no path from caller data to an initializer
    /// claim. The returned handle is inert: its capability is accepted by no transition API.
    #[cfg(test)]
    pub(crate) fn claim_receipt_zero_initializer_for_test(
        &self,
        material: ReceiptZeroInitializerClaimMaterialV1,
    ) -> Result<ReceiptZeroInitializerJournalClaimV1, JournalError> {
        let (plan, plan_digest) = receipt_zero_initializer_plan(&material)?;
        // Preflight the exact future recovery evidence before creating the durable Claimed fence.
        // Claimed persists none of these bytes; material which cannot satisfy the recovery/evidence
        // bounds therefore fails before a record is written. Whole-journal capacity can still
        // change and is checked again, fail closed, by the later precommit.
        receipt_zero_initializer_outcome_unknown_payload(&material, &plan_digest)?;
        let single_flight_key = plan.single_flight_key.clone();
        let capability = self.claim_plan(plan, CAPABILITY_TTL)?;
        Ok(ReceiptZeroInitializerJournalClaimV1 {
            capability,
            material,
            single_flight_key,
            plan_digest,
        })
    }

    /// First half of the initializer-only precommit. It burns the transient claim, constructs and
    /// exactly size-checks revision-two OutcomeUnknown while holding the journal store lock, and
    /// returns only an inert staged token after file replacement and directory fsync are confirmed.
    /// No runtime dispatch permit is published by this step. The existing B2a fail-closed behavior
    /// is intentionally retained: a deterministic pre-persist capacity failure leaves the original
    /// runtime claim burned and the durable Claimed fence unresolved; this slice adds no Deferred
    /// retry or Claimed repair authority.
    #[cfg(test)]
    pub(crate) fn stage_receipt_zero_initializer_outcome_unknown_for_test(
        &self,
        claim: ReceiptZeroInitializerJournalClaimV1,
    ) -> Result<ReceiptZeroInitializerJournalStagedOutcomeUnknownV1, JournalError> {
        let identity = derive_receipt_zero_initializer_identity(&claim.material)?;
        if identity.single_flight_key != claim.single_flight_key
            || identity.plan_digest != claim.plan_digest
        {
            return Err(JournalError::InvalidState);
        }
        let payload =
            receipt_zero_initializer_outcome_unknown_payload(&claim.material, &claim.plan_digest)?;
        let binding = {
            let mut runtime = self.runtime_lock()?;
            let operation_kind = runtime
                .claims
                .get(&claim.capability.id)
                .ok_or(JournalError::CapabilityMissing)?
                .operation_kind;
            if operation_kind != OperationKindV1::SupabaseBackfillReceiptZeroInitializer {
                return Err(JournalError::InvalidState);
            }
            let binding = runtime
                .claims
                .remove(&claim.capability.id)
                .ok_or(JournalError::CapabilityMissing)?;
            burn_runtime_id(
                &mut runtime,
                claim.capability.id,
                binding.expires_at_monotonic,
            );
            binding
        };
        self.require_capability_fresh(&binding)?;
        let id = claim.capability.id;
        let transition = self.with_store(|root| {
            self.require_capability_fresh(&binding)?;
            let mut body = load_journal(root)?;
            let record = exact_record_mut(&mut body, &binding)?;
            if record.operation_kind != OperationKindV1::SupabaseBackfillReceiptZeroInitializer
                || record.state != OperationStateV1::Claimed
                || record.revision != 1
                || record.progress_evidence.is_some()
                || record.final_evidence.is_some()
                || record.reconciliation_lease.is_some()
            {
                return Err(JournalError::InvalidState);
            }
            let now_wall = self.clock.wall_unix_millis()?;
            let issued_at_monotonic = self.clock.monotonic();
            if now_wall < record.claimed_at_unix_ms {
                return Err(JournalError::InvalidState);
            }
            let expires_at_unix_ms = add_duration_millis(now_wall, CAPABILITY_TTL)?;
            let expires_at_monotonic = issued_at_monotonic
                .checked_add(CAPABILITY_TTL)
                .ok_or(JournalError::Unavailable)?;
            let progress = evidence(EvidencePhaseV1::Progress, payload, now_wall)?;
            record.revision = record.revision.checked_add(1).ok_or(JournalError::Full)?;
            record.state = OperationStateV1::OutcomeUnknown;
            record.transitioned_at_unix_ms = Some(now_wall);
            record.code = Some(OUTCOME_UNKNOWN_CODE.to_owned());
            record.progress_evidence = Some(progress);
            validate_record(record)?;
            let digest = record_digest(record)?;
            let revision = record.revision;
            body.generation = body.generation.checked_add(1).ok_or(JournalError::Full)?;
            let serialized = serialize_journal(&body)?;
            let durability =
                persist_serialized_journal(root, &serialized, self.directory_sync.as_ref())?;
            Ok((
                digest,
                revision,
                now_wall,
                expires_at_unix_ms,
                issued_at_monotonic,
                expires_at_monotonic,
                durability,
            ))
        });
        let (
            record_digest,
            record_revision,
            issued_at_unix_ms,
            expires_at_unix_ms,
            issued_at_monotonic,
            expires_at_monotonic,
            durability,
        ) = transition?;
        if durability != CommitDurability::Confirmed {
            return Err(JournalError::DurabilityUnconfirmed);
        }
        let capture_digest = claim.material.capture.capture_digest.clone();
        Ok(ReceiptZeroInitializerJournalStagedOutcomeUnknownV1 {
            journal_process_lock: Arc::downgrade(&self.process_lock),
            capability_id: id,
            record_digest,
            record_revision,
            issued_at_unix_ms,
            issued_at_monotonic,
            expires_at_unix_ms,
            expires_at_monotonic,
            identity,
            material: claim.material,
            capture_digest,
        })
    }

    /// Second half of the initializer-only precommit. The staged token is accepted only by the
    /// exact journal instance which durably wrote it. The exact revision-two OutcomeUnknown record
    /// and its complete recovery material are checked again before the final runtime-lock clock
    /// sample publishes one one-shot dispatch permit.
    #[cfg(test)]
    pub(crate) fn publish_receipt_zero_initializer_staged_dispatch_for_test(
        &self,
        staged: ReceiptZeroInitializerJournalStagedOutcomeUnknownV1,
    ) -> Result<ReceiptZeroInitializerJournalDispatchV1, JournalError> {
        if !Weak::ptr_eq(
            &staged.journal_process_lock,
            &Arc::downgrade(&self.process_lock),
        ) || staged.record_revision != 2
            || staged.capture_digest != staged.material.capture.capture_digest
            || derive_receipt_zero_initializer_identity(&staged.material)? != staged.identity
        {
            return Err(JournalError::InvalidState);
        }
        let next_binding = CapabilityBindingV1 {
            single_flight_key: staged.identity.single_flight_key.clone(),
            operation_kind: OperationKindV1::SupabaseBackfillReceiptZeroInitializer,
            record_digest: staged.record_digest.clone(),
            issued_at_unix_ms: staged.issued_at_unix_ms,
            expires_at_unix_ms: staged.expires_at_unix_ms,
            expires_at_monotonic: staged.expires_at_monotonic,
        };
        self.with_store(|root| {
            let body = load_journal(root)?;
            let record = exact_record(&body, &next_binding)?;
            if record.operation_kind != OperationKindV1::SupabaseBackfillReceiptZeroInitializer
                || record.state != OperationStateV1::OutcomeUnknown
                || record.revision != staged.record_revision
                || record.code.as_deref() != Some(OUTCOME_UNKNOWN_CODE)
                || record.final_evidence.is_some()
                || record.reconciliation_lease.is_some()
            {
                return Err(JournalError::InvalidState);
            }
            let (persisted_material, persisted_identity) =
                receipt_zero_initializer_material_from_outcome_unknown(record)?;
            if persisted_material != staged.material || persisted_identity != staged.identity {
                return Err(JournalError::Conflict);
            }
            Ok(())
        })?;

        // All blocking store work is complete. Re-sample the same journal clock only after the
        // final runtime lock is held, never extend the original staged 30-second ceilings, and
        // require a complete fixed 25-second runner window before publishing the permit.
        let mut runtime = self.runtime_lock()?;
        let post_fsync = self.clock_sample_for_test()?;
        self.require_specialized_capability_fresh_for_test(
            &next_binding,
            staged.issued_at_monotonic,
            post_fsync,
        )?;
        self.fixed_runner_window_for_test(
            post_fsync,
            RECEIPT_ZERO_INITIALIZER_LIVE_PRECOMMIT_RUNNER_WINDOW,
            next_binding.expires_at_unix_ms,
            next_binding.expires_at_monotonic,
        )?;
        ensure_transfer_slot_available(&runtime, &staged.capability_id)?;
        runtime.permits.insert(staged.capability_id, next_binding);
        Ok(ReceiptZeroInitializerJournalDispatchV1 {
            permit: DispatchPermitV1 {
                id: staged.capability_id,
            },
            issued_at_monotonic: staged.issued_at_monotonic,
            identity: staged.identity,
            material: staged.material,
        })
    }

    /// Exact-kind B2a transition. This deliberately does not route through the generic mutation
    /// whitelist and returns no executable callback, SQL, or settlement authority. Its historical
    /// test-only surface composes the same durable staging and exact publish steps used by B3a.
    #[cfg(test)]
    pub(crate) fn precommit_receipt_zero_initializer_for_test(
        &self,
        claim: ReceiptZeroInitializerJournalClaimV1,
    ) -> Result<ReceiptZeroInitializerJournalDispatchV1, JournalError> {
        let staged = self.stage_receipt_zero_initializer_outcome_unknown_for_test(claim)?;
        self.publish_receipt_zero_initializer_staged_dispatch_for_test(staged)
    }

    /// Reconstructs only an exact initializer OutcomeUnknown record after both the original claim
    /// lease and the post-transition quiet period. Claimed records contain no recovery bytes and
    /// intentionally have no restart path.
    #[cfg(test)]
    pub(crate) fn reconstruct_receipt_zero_initializer_for_test(
        &self,
        single_flight_key: &str,
    ) -> Result<ReceiptZeroInitializerJournalRecoveryV1, JournalError> {
        validate_digest(single_flight_key)?;
        let (record, material, identity, issued_at_unix_ms, issued_at_monotonic) = self
            .with_store(|root| {
                let body = load_journal(root)?;
                let record = body
                    .records
                    .get(single_flight_key)
                    .cloned()
                    .ok_or(JournalError::Conflict)?;
                if record.operation_kind != OperationKindV1::SupabaseBackfillReceiptZeroInitializer
                    || record.state != OperationStateV1::OutcomeUnknown
                {
                    return Err(JournalError::InvalidState);
                }
                let transitioned_at = record
                    .transitioned_at_unix_ms
                    .ok_or(JournalError::Corrupt)?;
                let recovery_not_before_unix_ms = record
                    .claim_lease_expires_at_unix_ms
                    .max(add_duration_millis(transitioned_at, CAPABILITY_TTL)?);
                let recovery_not_before_unix_ms = record
                    .reconciliation_lease
                    .as_ref()
                    .map_or(recovery_not_before_unix_ms, |lease| {
                        recovery_not_before_unix_ms.max(lease.expires_at_unix_ms)
                    });
                let issued_at_unix_ms = self.clock.wall_unix_millis()?;
                let issued_at_monotonic = self.clock.monotonic();
                if issued_at_unix_ms < record.claimed_at_unix_ms
                    || issued_at_unix_ms < recovery_not_before_unix_ms
                {
                    return Err(JournalError::LeaseActive);
                }
                let (material, identity) =
                    receipt_zero_initializer_material_from_outcome_unknown(&record)?;
                Ok((
                    record,
                    material,
                    identity,
                    issued_at_unix_ms,
                    issued_at_monotonic,
                ))
            })?;
        let expires_at_monotonic = issued_at_monotonic
            .checked_add(CAPABILITY_TTL)
            .ok_or(JournalError::Unavailable)?;
        let expires_at_unix_ms = add_duration_millis(issued_at_unix_ms, CAPABILITY_TTL)?;
        let record_digest = record_digest(&record)?;
        let (id, binding) = self.new_capability_binding(
            record.single_flight_key,
            record.operation_kind,
            record_digest,
            issued_at_unix_ms,
            expires_at_unix_ms,
            expires_at_monotonic,
        )?;
        let mut runtime = self.runtime_lock()?;
        if let Err(error) = self.require_capability_fresh(&binding) {
            runtime.reserved.remove(&id);
            return Err(error);
        }
        if runtime.reserved.remove(&id).is_none() {
            return Err(JournalError::Unavailable);
        }
        runtime
            .recoveries
            .insert(id, (binding, RecoveryKindV1::OutcomeUnknownReconciliation));
        Ok(ReceiptZeroInitializerJournalRecoveryV1 {
            capability: RecoveryCapabilityV1 {
                id,
                kind: RecoveryKindV1::OutcomeUnknownReconciliation,
            },
            issued_at_monotonic,
            identity,
            material,
        })
    }

    /// Consumes one exact initializer recovery and durably installs a 60-second reconciliation
    /// lease. The process-local permit is minted only after confirmed directory durability and is
    /// limited to a fresh 30-second dual-clock lifetime inside that fixed durable lease.
    #[cfg(test)]
    pub(crate) fn begin_receipt_zero_initializer_reconciliation_for_test(
        &self,
        recovery: ReceiptZeroInitializerJournalRecoveryV1,
    ) -> Result<ReceiptZeroInitializerJournalReconciliationPermitV1, JournalError> {
        if derive_receipt_zero_initializer_identity(&recovery.material)? != recovery.identity {
            return Err(JournalError::InvalidState);
        }
        let authority_id = recovery.capability.id;
        let (binding, kind) = {
            let mut runtime = self.runtime_lock()?;
            let (candidate, kind) = runtime
                .recoveries
                .get(&authority_id)
                .ok_or(JournalError::CapabilityMissing)?;
            if candidate.operation_kind != OperationKindV1::SupabaseBackfillReceiptZeroInitializer
                || *kind != RecoveryKindV1::OutcomeUnknownReconciliation
                || recovery.capability.kind != *kind
            {
                return Err(JournalError::InvalidState);
            }
            let (binding, kind) = runtime
                .recoveries
                .remove(&authority_id)
                .ok_or(JournalError::CapabilityMissing)?;
            burn_runtime_id(&mut runtime, authority_id, binding.expires_at_monotonic);
            (binding, kind)
        };
        if kind != RecoveryKindV1::OutcomeUnknownReconciliation {
            return Err(JournalError::InvalidState);
        }

        let transition = self.with_store(|root| {
            let pre_fsync = self.clock_sample_for_test()?;
            self.require_specialized_capability_fresh_for_test(
                &binding,
                recovery.issued_at_monotonic,
                pre_fsync,
            )?;
            let mut body = load_journal(root)?;
            let record = exact_record_mut(&mut body, &binding)?;
            if record.operation_kind != OperationKindV1::SupabaseBackfillReceiptZeroInitializer
                || record.state != OperationStateV1::OutcomeUnknown
            {
                return Err(JournalError::InvalidState);
            }
            let (persisted_material, persisted_identity) =
                receipt_zero_initializer_material_from_outcome_unknown(record)?;
            if persisted_material != recovery.material || persisted_identity != recovery.identity {
                return Err(JournalError::Conflict);
            }
            let transitioned_at = record
                .transitioned_at_unix_ms
                .ok_or(JournalError::Corrupt)?;
            if pre_fsync.wall_unix_ms < transitioned_at {
                return Err(JournalError::InvalidState);
            }
            let lease_generation = match record.reconciliation_lease.as_ref() {
                Some(lease)
                    if pre_fsync.wall_unix_ms < lease.issued_at_unix_ms
                        || pre_fsync.wall_unix_ms < lease.expires_at_unix_ms =>
                {
                    return Err(JournalError::LeaseActive)
                }
                Some(lease) => lease.generation.checked_add(1).ok_or(JournalError::Full)?,
                None => 1,
            };
            let authority_digest = receipt_zero_initializer_reconciliation_authority_digest(
                &authority_id,
                &record.single_flight_key,
                lease_generation,
            )?;
            let lease_expires_at_unix_ms = add_duration_millis(
                pre_fsync.wall_unix_ms,
                RECEIPT_ZERO_INITIALIZER_RECONCILIATION_LEASE_TTL,
            )?;
            let lease_expires_at_monotonic = pre_fsync
                .monotonic
                .checked_add(RECEIPT_ZERO_INITIALIZER_RECONCILIATION_LEASE_TTL)
                .ok_or(JournalError::Unavailable)?;
            record.revision = record.revision.checked_add(1).ok_or(JournalError::Full)?;
            record.reconciliation_lease = Some(ReconciliationLeaseRecordV1 {
                generation: lease_generation,
                authority_digest: authority_digest.clone(),
                issued_at_unix_ms: pre_fsync.wall_unix_ms,
                expires_at_unix_ms: lease_expires_at_unix_ms,
                consumed: false,
            });
            validate_record(record)?;
            let record_digest = record_digest(record)?;
            body.generation = body.generation.checked_add(1).ok_or(JournalError::Full)?;
            let durability = persist_journal(root, &body, self.directory_sync.as_ref())?;
            Ok((
                record_digest,
                authority_digest,
                lease_generation,
                lease_expires_at_unix_ms,
                lease_expires_at_monotonic,
                pre_fsync,
                durability,
            ))
        })?;
        let (
            record_digest,
            authority_digest,
            lease_generation,
            lease_expires_at_unix_ms,
            lease_expires_at_monotonic,
            pre_fsync,
            durability,
        ) = transition;
        if durability != CommitDurability::Confirmed {
            return Err(JournalError::DurabilityUnconfirmed);
        }
        let mut runtime = self.runtime_lock()?;
        let post_fsync = self.clock_sample_for_test()?;
        if post_fsync.wall_unix_ms < pre_fsync.wall_unix_ms
            || post_fsync.monotonic < pre_fsync.monotonic
        {
            return Err(JournalError::InvalidState);
        }
        self.require_specialized_capability_fresh_for_test(
            &binding,
            recovery.issued_at_monotonic,
            post_fsync,
        )?;
        let permit_window = self.fixed_runner_window_for_test(
            post_fsync,
            RECEIPT_ZERO_INITIALIZER_READ_RUNNER_WINDOW,
            lease_expires_at_unix_ms,
            lease_expires_at_monotonic,
        )?;
        let next_binding = ReconciliationCapabilityBindingV1 {
            binding: CapabilityBindingV1 {
                single_flight_key: binding.single_flight_key,
                operation_kind: binding.operation_kind,
                record_digest,
                issued_at_unix_ms: permit_window.issued_at_unix_ms,
                expires_at_unix_ms: permit_window.expires_at_unix_ms,
                expires_at_monotonic: permit_window.expires_at_monotonic,
            },
            authority_digest,
            lease_generation,
            lease_expires_at_unix_ms,
            lease_expires_at_monotonic,
        };
        ensure_transfer_slot_available(&runtime, &authority_id)?;
        runtime
            .reconciliation_permits
            .insert(authority_id, next_binding);
        Ok(ReceiptZeroInitializerJournalReconciliationPermitV1 {
            permit: ReconciliationPermitV1 { id: authority_id },
            issued_at_monotonic: permit_window.issued_at_monotonic,
            identity: recovery.identity,
            material: recovery.material,
        })
    }

    /// Burns one initializer reconciliation permit, durably marks its lease consumed, and only
    /// then publishes a distinct fixed 30-second read window. No observation parser or settlement
    /// authority is exposed by this slice.
    #[cfg(test)]
    pub(crate) fn consume_receipt_zero_initializer_reconciliation_for_test(
        &self,
        permit: ReceiptZeroInitializerJournalReconciliationPermitV1,
    ) -> Result<ReceiptZeroInitializerReconciliationReadRunWindowV1, JournalError> {
        if derive_receipt_zero_initializer_identity(&permit.material)? != permit.identity {
            return Err(JournalError::InvalidState);
        }
        let authority_id = permit.permit.id;
        let mut binding = {
            let mut runtime = self.runtime_lock()?;
            let candidate = runtime
                .reconciliation_permits
                .get(&authority_id)
                .ok_or(JournalError::CapabilityMissing)?;
            if candidate.binding.operation_kind
                != OperationKindV1::SupabaseBackfillReceiptZeroInitializer
            {
                return Err(JournalError::InvalidState);
            }
            let binding = runtime
                .reconciliation_permits
                .remove(&authority_id)
                .ok_or(JournalError::CapabilityMissing)?;
            burn_runtime_id(
                &mut runtime,
                authority_id,
                binding.binding.expires_at_monotonic,
            );
            binding
        };

        let transition = self.with_store(|root| {
            let pre_fsync = self.clock_sample_for_test()?;
            self.require_specialized_capability_fresh_for_test(
                &binding.binding,
                permit.issued_at_monotonic,
                pre_fsync,
            )?;
            // Do not consume the durable lease unless a complete fixed-read window fits before
            // the lease's original, non-extendable dual deadlines.
            self.fixed_runner_window_for_test(
                pre_fsync,
                RECEIPT_ZERO_INITIALIZER_READ_RUNNER_WINDOW,
                binding.lease_expires_at_unix_ms,
                binding.lease_expires_at_monotonic,
            )?;
            let mut body = load_journal(root)?;
            let record = exact_record_mut(&mut body, &binding.binding)?;
            if record.operation_kind != OperationKindV1::SupabaseBackfillReceiptZeroInitializer
                || record.state != OperationStateV1::OutcomeUnknown
            {
                return Err(JournalError::InvalidState);
            }
            let (persisted_material, persisted_identity) =
                receipt_zero_initializer_material_from_outcome_unknown(record)?;
            if persisted_material != permit.material || persisted_identity != permit.identity {
                return Err(JournalError::Conflict);
            }
            let expected_authority_digest =
                receipt_zero_initializer_reconciliation_authority_digest(
                    &authority_id,
                    &record.single_flight_key,
                    binding.lease_generation,
                )?;
            let lease = record
                .reconciliation_lease
                .as_mut()
                .ok_or(JournalError::InvalidState)?;
            if lease.generation != binding.lease_generation
                || lease.authority_digest != binding.authority_digest
                || lease.authority_digest != expected_authority_digest
                || lease.expires_at_unix_ms != binding.lease_expires_at_unix_ms
                || lease.consumed
                || pre_fsync.wall_unix_ms < lease.issued_at_unix_ms
                || pre_fsync.wall_unix_ms >= lease.expires_at_unix_ms
            {
                return Err(JournalError::InvalidState);
            }
            lease.consumed = true;
            record.revision = record.revision.checked_add(1).ok_or(JournalError::Full)?;
            validate_record(record)?;
            let record_digest = record_digest(record)?;
            body.generation = body.generation.checked_add(1).ok_or(JournalError::Full)?;
            let durability = persist_journal(root, &body, self.directory_sync.as_ref())?;
            Ok((record_digest, pre_fsync, durability))
        })?;
        let (record_digest, pre_fsync, durability) = transition;
        if durability != CommitDurability::Confirmed {
            return Err(JournalError::DurabilityUnconfirmed);
        }
        let mut runtime = self.runtime_lock()?;
        let post_fsync = self.clock_sample_for_test()?;
        if post_fsync.wall_unix_ms < pre_fsync.wall_unix_ms
            || post_fsync.monotonic < pre_fsync.monotonic
        {
            return Err(JournalError::InvalidState);
        }
        self.require_specialized_capability_fresh_for_test(
            &binding.binding,
            permit.issued_at_monotonic,
            post_fsync,
        )?;
        let read_window = self.fixed_runner_window_for_test(
            post_fsync,
            RECEIPT_ZERO_INITIALIZER_READ_RUNNER_WINDOW,
            binding.lease_expires_at_unix_ms,
            binding.lease_expires_at_monotonic,
        )?;
        binding.binding.record_digest = record_digest;
        binding.binding.issued_at_unix_ms = read_window.issued_at_unix_ms;
        binding.binding.expires_at_unix_ms = read_window.expires_at_unix_ms;
        binding.binding.expires_at_monotonic = read_window.expires_at_monotonic;
        ensure_transfer_slot_available(&runtime, &authority_id)?;
        burn_runtime_id(&mut runtime, authority_id, read_window.expires_at_monotonic);
        runtime
            .reconciliation_observations
            .insert(authority_id, binding);
        Ok(ReceiptZeroInitializerReconciliationReadRunWindowV1 {
            _authority: ReconciliationObservationAuthorityV1 { id: authority_id },
            identity: permit.identity,
            material: permit.material,
            issued_at_unix_ms: read_window.issued_at_unix_ms,
            issued_at_monotonic: read_window.issued_at_monotonic,
            expires_at_unix_ms: read_window.expires_at_unix_ms,
            expires_at_monotonic: read_window.expires_at_monotonic,
        })
    }

    /// Converts the same-process post-precommit handoff into exactly one fixed 25-second live
    /// mutation runway. Both original 30-second deadlines are rechecked; no caller duration is
    /// accepted and no journal state is settled.
    #[cfg(test)]
    pub(crate) fn issue_receipt_zero_initializer_live_run_window_for_test(
        &self,
        dispatch: ReceiptZeroInitializerJournalDispatchV1,
    ) -> Result<ReceiptZeroInitializerInertLivePrecommitRunWindowV1, JournalError> {
        if derive_receipt_zero_initializer_identity(&dispatch.material)? != dispatch.identity {
            return Err(JournalError::InvalidState);
        }
        let authority_id = dispatch.permit.id;
        let mut binding = {
            let mut runtime = self.runtime_lock()?;
            let candidate = runtime
                .permits
                .get(&authority_id)
                .ok_or(JournalError::CapabilityMissing)?;
            if candidate.operation_kind != OperationKindV1::SupabaseBackfillReceiptZeroInitializer {
                return Err(JournalError::InvalidState);
            }
            let binding = runtime
                .permits
                .remove(&authority_id)
                .ok_or(JournalError::CapabilityMissing)?;
            burn_runtime_id(&mut runtime, authority_id, binding.expires_at_monotonic);
            binding
        };
        self.with_store(|root| {
            let body = load_journal(root)?;
            let record = exact_record(&body, &binding)?;
            let (persisted_material, persisted_identity) =
                receipt_zero_initializer_material_from_outcome_unknown(record)?;
            if persisted_material != dispatch.material || persisted_identity != dispatch.identity {
                return Err(JournalError::Conflict);
            }
            Ok(())
        })?;
        let mut runtime = self.runtime_lock()?;
        let sample = self.clock_sample_for_test()?;
        self.require_specialized_capability_fresh_for_test(
            &binding,
            dispatch.issued_at_monotonic,
            sample,
        )?;
        let run_window = self.fixed_runner_window_for_test(
            sample,
            RECEIPT_ZERO_INITIALIZER_LIVE_PRECOMMIT_RUNNER_WINDOW,
            binding.expires_at_unix_ms,
            binding.expires_at_monotonic,
        )?;
        binding.issued_at_unix_ms = run_window.issued_at_unix_ms;
        binding.expires_at_unix_ms = run_window.expires_at_unix_ms;
        binding.expires_at_monotonic = run_window.expires_at_monotonic;
        ensure_transfer_slot_available(&runtime, &authority_id)?;
        burn_runtime_id(&mut runtime, authority_id, run_window.expires_at_monotonic);
        let record_digest = binding.record_digest.clone();
        runtime.dispatch_attempts.insert(authority_id, binding);
        Ok(ReceiptZeroInitializerInertLivePrecommitRunWindowV1 {
            _attempt: DispatchAttemptV1 { id: authority_id },
            journal_process_lock: Arc::downgrade(&self.process_lock),
            record_digest,
            identity: dispatch.identity,
            material: dispatch.material,
            issued_at_unix_ms: run_window.issued_at_unix_ms,
            issued_at_monotonic: run_window.issued_at_monotonic,
            expires_at_unix_ms: run_window.expires_at_unix_ms,
            expires_at_monotonic: run_window.expires_at_monotonic,
        })
    }

    /// Final B3b1 boundary before a connector may be polled. The inert live handoff is accepted
    /// only by its staging journal, its exact revision-two OutcomeUnknown record is re-read, and
    /// its exact runtime attempt is removed and burned while the final dual-clock sample is taken.
    /// The returned ceiling has no database/session/SQL surface and cannot settle the journal.
    #[cfg(test)]
    pub(crate) fn consume_receipt_zero_initializer_live_run_window_for_execution_for_test(
        &self,
        window: ReceiptZeroInitializerInertLivePrecommitRunWindowV1,
    ) -> Result<ReceiptZeroInitializerLiveExecutionCeilingV1, JournalError> {
        if !Weak::ptr_eq(
            &window.journal_process_lock,
            &Arc::downgrade(&self.process_lock),
        ) || derive_receipt_zero_initializer_identity(&window.material)? != window.identity
        {
            return Err(JournalError::InvalidState);
        }
        let authority_id = window._attempt.id;
        let expected = CapabilityBindingV1 {
            single_flight_key: window.identity.single_flight_key.clone(),
            operation_kind: OperationKindV1::SupabaseBackfillReceiptZeroInitializer,
            record_digest: window.record_digest.clone(),
            issued_at_unix_ms: window.issued_at_unix_ms,
            expires_at_unix_ms: window.expires_at_unix_ms,
            expires_at_monotonic: window.expires_at_monotonic,
        };
        self.with_store(|root| {
            let body = load_journal(root)?;
            let record = exact_record(&body, &expected)?;
            if record.operation_kind != OperationKindV1::SupabaseBackfillReceiptZeroInitializer
                || record.state != OperationStateV1::OutcomeUnknown
                || record.revision != 2
                || record.code.as_deref() != Some(OUTCOME_UNKNOWN_CODE)
                || record.final_evidence.is_some()
                || record.reconciliation_lease.is_some()
            {
                return Err(JournalError::InvalidState);
            }
            let (persisted_material, persisted_identity) =
                receipt_zero_initializer_material_from_outcome_unknown(record)?;
            if persisted_material != window.material || persisted_identity != window.identity {
                return Err(JournalError::Conflict);
            }
            Ok(())
        })?;

        // Store/file work precedes the runtime lock. The initializer's existing five-minute
        // restart high-water fence prevents a competing recovery transition during this live
        // 25-second lineage; no lock or file guard crosses into the asynchronous runner.
        let mut runtime = self.runtime_lock()?;
        let candidate = runtime
            .dispatch_attempts
            .get(&authority_id)
            .ok_or(JournalError::CapabilityMissing)?;
        if candidate.operation_kind != OperationKindV1::SupabaseBackfillReceiptZeroInitializer {
            return Err(JournalError::InvalidState);
        }
        let binding = runtime
            .dispatch_attempts
            .remove(&authority_id)
            .ok_or(JournalError::CapabilityMissing)?;
        burn_runtime_id(&mut runtime, authority_id, binding.expires_at_monotonic);
        if binding.single_flight_key != expected.single_flight_key
            || binding.operation_kind != expected.operation_kind
            || binding.record_digest != expected.record_digest
            || binding.issued_at_unix_ms != expected.issued_at_unix_ms
            || binding.expires_at_unix_ms != expected.expires_at_unix_ms
            || binding.expires_at_monotonic != expected.expires_at_monotonic
        {
            return Err(JournalError::InvalidState);
        }
        let sample = self.clock_sample_for_test()?;
        self.require_specialized_capability_fresh_for_test(
            &binding,
            window.issued_at_monotonic,
            sample,
        )?;
        Ok(ReceiptZeroInitializerLiveExecutionCeilingV1 {
            clock: Arc::clone(&self.clock),
            last_sample: Mutex::new(sample),
            issued_at_unix_ms: window.issued_at_unix_ms,
            issued_at_monotonic: window.issued_at_monotonic,
            expires_at_unix_ms: window.expires_at_unix_ms,
            expires_at_monotonic: window.expires_at_monotonic,
        })
    }

    pub(crate) fn claim_cas_ledger_install(
        &self,
        proof: SealedCasLedgerInstallReviewProofV1,
    ) -> Result<CasLedgerInstallJournalClaimV1, JournalError> {
        let material = proof.into_claim_material();
        let (plan, identity) = cas_ledger_install_plan(&material)?;
        let capability = self.claim_plan(plan, CAPABILITY_TTL)?;
        Ok(CasLedgerInstallJournalClaimV1 {
            capability,
            material,
            identity,
        })
    }

    pub(crate) fn claim_automation_cas(
        &self,
        proof: SealedAutomationCasRecoveryReviewProofV1,
    ) -> Result<AutomationCasJournalClaimV1, JournalError> {
        let material = proof.into_claim_material();
        let (plan, identity) = automation_cas_plan(&material)?;
        // Preflight the exact later progress evidence before creating a durable Claimed fence. This
        // keeps the review/material bounds and the journal's string/secret/node limits coherent.
        automation_cas_outcome_unknown_payload(&material, &identity.plan_digest)?;
        let capability = self.claim_plan(plan, CAPABILITY_TTL)?;
        Ok(AutomationCasJournalClaimV1 {
            capability,
            identity,
            material,
        })
    }

    #[cfg(test)]
    pub(crate) fn precommit_automation_cas_for_test(
        &self,
        claim: AutomationCasJournalClaimV1,
    ) -> Result<AutomationCasJournalOutcomeUnknownV1, JournalError> {
        let (_, recomputed_identity) = automation_cas_plan(&claim.material)?;
        if recomputed_identity != claim.identity {
            return Err(JournalError::InvalidState);
        }
        let payload =
            automation_cas_outcome_unknown_payload(&claim.material, &claim.identity.plan_digest)?;
        let permit = self.precommit_for_test(claim.capability, payload)?;
        let attempt = self.consume_dispatch_permit_for_test(permit)?;
        let settlement = self.mark_dispatch_started_for_test(attempt)?;
        Ok(AutomationCasJournalOutcomeUnknownV1 {
            _settlement: settlement,
            identity: claim.identity,
            _material: claim.material,
        })
    }

    #[cfg(test)]
    pub(crate) fn reconstruct_automation_cas_for_test(
        &self,
        single_flight_key: &str,
    ) -> Result<AutomationCasJournalRecoveryV1, JournalError> {
        let capability = self.reconstruct_for_test(single_flight_key)?;
        let restored = (|| {
            if capability.kind != RecoveryKindV1::OutcomeUnknownReconciliation {
                return Err(JournalError::InvalidState);
            }
            let binding = {
                let runtime = self.runtime_lock()?;
                let (binding, kind) = runtime
                    .recoveries
                    .get(&capability.id)
                    .cloned()
                    .ok_or(JournalError::CapabilityMissing)?;
                if kind != capability.kind
                    || binding.operation_kind != OperationKindV1::SupabaseAutomationIdempotencyCas
                {
                    return Err(JournalError::InvalidState);
                }
                binding
            };
            self.with_store(|root| {
                let body = load_journal(root)?;
                let record = exact_record(&body, &binding)?;
                automation_cas_material_from_outcome_unknown(record)
            })
        })();
        let (material, identity) = match restored {
            Ok(restored) => restored,
            Err(error) => {
                let mut runtime = self.runtime_lock()?;
                if let Some((binding, _)) = runtime.recoveries.remove(&capability.id) {
                    burn_runtime_id(&mut runtime, capability.id, binding.expires_at_monotonic);
                }
                return Err(error);
            }
        };
        Ok(AutomationCasJournalRecoveryV1 {
            capability,
            identity,
            material,
        })
    }

    #[cfg(test)]
    pub(crate) fn begin_automation_cas_reconciliation_for_test(
        &self,
        recovery: AutomationCasJournalRecoveryV1,
    ) -> Result<AutomationCasJournalReconciliationPermitV1, JournalError> {
        require_exact_automation_cas_identity(&recovery.material, &recovery.identity)?;
        let permit = self.begin_reconciliation_for_test(recovery.capability)?;
        Ok(AutomationCasJournalReconciliationPermitV1 {
            identity: recovery.identity,
            material: recovery.material,
            permit,
        })
    }

    #[cfg(test)]
    pub(crate) fn consume_automation_cas_reconciliation_for_test(
        &self,
        permit: AutomationCasJournalReconciliationPermitV1,
    ) -> Result<AutomationCasJournalReadAttemptV1, JournalError> {
        require_exact_automation_cas_identity(&permit.material, &permit.identity)?;
        let authority = self.consume_reconciliation_for_test(permit.permit)?;
        Ok(AutomationCasJournalReadAttemptV1 {
            _authority: authority,
            _identity: permit.identity,
            material: permit.material,
        })
    }

    #[cfg(test)]
    pub(crate) fn precommit_cas_ledger_install_for_test(
        &self,
        claim: CasLedgerInstallJournalClaimV1,
    ) -> Result<CasLedgerInstallJournalOutcomeUnknownV1, JournalError> {
        let progress = serde_json::json!({
            "format": "openpencil.native-cas-ledger-install-progress.v1",
            "version": 1,
            "phase": "outcome-unknown",
            "providerId": claim.material.provider_id,
            "environment": claim.material.environment,
            "projectRef": claim.material.project_ref,
            "accountId": claim.material.account_id,
            "planDigest": claim.identity.plan_digest,
            "installReviewDigest": claim.material.install_review_digest,
            "markerBindingDigest": claim.material.marker_binding_digest,
            "installSqlDigest": claim.material.install_sql_digest,
            "automaticRetryAllowed": false,
            "databaseLedgerBound": false,
            "mutationAuthorized": false,
            "executionAuthorized": false,
            "sourceLedgerBound": false,
            "releaseAuthorized": false
        });
        let permit = self.precommit_for_test(claim.capability, progress)?;
        let attempt = self.consume_dispatch_permit_for_test(permit)?;
        let settlement = self.mark_dispatch_started_for_test(attempt)?;
        Ok(CasLedgerInstallJournalOutcomeUnknownV1 {
            settlement,
            material: claim.material,
            identity: claim.identity,
        })
    }

    #[cfg(test)]
    pub(crate) fn settle_cas_ledger_install_applied_for_test(
        &self,
        outcome: CasLedgerInstallJournalOutcomeUnknownV1,
        proof: ConsumedCasLedgerInstalledObservationProofV1,
    ) -> Result<CasLedgerInstallJournalAppliedV1, JournalError> {
        let installed = proof.into_settlement_material();
        let (_, recomputed_identity) = cas_ledger_install_plan(&installed.plan)?;
        if installed.plan != outcome.material || recomputed_identity != outcome.identity {
            return Err(JournalError::InvalidState);
        }
        validate_digest(&installed.installed_verification_digest)?;
        validate_cas_ledger_text(&installed.observed_at, 64)?;
        validate_cas_ledger_text(&installed.snapshot_marker, 512)?;
        validate_cas_ledger_text(&installed.server_version_num, 16)?;
        let final_evidence = serde_json::json!({
            "format": "openpencil.native-cas-ledger-install-final.v1",
            "version": 1,
            "phase": "installed-proof-observed",
            "providerId": installed.plan.provider_id,
            "environment": installed.plan.environment,
            "projectRef": installed.plan.project_ref,
            "accountId": installed.plan.account_id,
            "planDigest": outcome.identity.plan_digest,
            "installReviewDigest": installed.plan.install_review_digest,
            "sourceReviewDigest": installed.plan.source_review_digest,
            "verificationDigest": installed.plan.verification_digest,
            "installedVerificationDigest": installed.installed_verification_digest,
            "ledgerShapeDigest": installed.plan.ledger_shape_digest,
            "baseSqlDigest": installed.plan.base_sql_digest,
            "marker": installed.plan.marker,
            "markerBindingDigest": installed.plan.marker_binding_digest,
            "installSqlDigest": installed.plan.install_sql_digest,
            "verificationQueryDigest": installed.plan.verification_query_digest,
            "observedAt": installed.observed_at,
            "snapshotMarker": installed.snapshot_marker,
            "serverVersionNum": installed.server_version_num,
            "automaticRetryAllowed": false,
            "databaseLedgerBound": true,
            "mutationAuthorized": false,
            "executionAuthorized": false,
            "sourceLedgerBound": false,
            "releaseAuthorized": false
        });
        self.settle_dispatch_for_test(
            outcome.settlement,
            OperationStateV1::Applied,
            final_evidence,
        )?;
        Ok(CasLedgerInstallJournalAppliedV1 {
            material: installed,
            identity: outcome.identity,
        })
    }

    #[cfg(test)]
    fn claim_for_test(
        &self,
        plan: TrustedOperationPlanV1,
    ) -> Result<ClaimCapabilityV1, JournalError> {
        self.claim_plan(plan, CLAIM_LEASE)
    }

    fn claim_plan(
        &self,
        plan: TrustedOperationPlanV1,
        capability_ttl: Duration,
    ) -> Result<ClaimCapabilityV1, JournalError> {
        validate_plan(&plan)?;
        let reservation_expires_at = self
            .clock
            .monotonic()
            .checked_add(capability_ttl)
            .ok_or(JournalError::Unavailable)?;
        let runtime_capacity = match plan.operation_kind {
            OperationKindV1::SupabaseBackfillReceiptZeroAdmission => {
                MAX_ADMISSION_OCCUPIED_RUNTIME_IDS
            }
            OperationKindV1::SupabaseAutomationIdempotencyCas
            | OperationKindV1::SupabaseBackfillDatabaseCasLedgerInstall
            | OperationKindV1::SupabaseBackfillReceiptZeroInitializer => MAX_RUNTIME_AUTHORITY_IDS,
        };
        let persistent_capacity = match plan.operation_kind {
            OperationKindV1::SupabaseBackfillReceiptZeroAdmission => MAX_ADMISSION_OCCUPIED_RECORDS,
            OperationKindV1::SupabaseAutomationIdempotencyCas
            | OperationKindV1::SupabaseBackfillDatabaseCasLedgerInstall
            | OperationKindV1::SupabaseBackfillReceiptZeroInitializer => MAX_RECORDS,
        };
        let id = self.unique_runtime_id(reservation_expires_at, runtime_capacity)?;
        let single_flight_key = plan.single_flight_key.clone();
        let durability = match self.with_store(|root| {
            let mut body = load_journal(root)?;
            if body.records.contains_key(&single_flight_key)
                || body.tombstones.contains_key(&single_flight_key)
            {
                return Err(JournalError::Conflict);
            }
            if body.records.len() >= persistent_capacity {
                return Err(JournalError::Full);
            }
            let claimed_at_unix_ms = self.clock.wall_unix_millis()?;
            let issued_at_monotonic = self.clock.monotonic();
            let claim_lease_expires_at_unix_ms =
                add_duration_millis(claimed_at_unix_ms, CLAIM_LEASE)?;
            let capability_expires_at_unix_ms =
                add_duration_millis(claimed_at_unix_ms, capability_ttl)?;
            let record = BackendOperationRecordV1 {
                single_flight_key: single_flight_key.clone(),
                dispatch_scope_key: plan.dispatch_scope_key,
                provider_id: plan.provider_id,
                project_id: plan.project_id,
                operation_kind: plan.operation_kind,
                release_id: plan.release_id,
                owner_id: plan.owner_id,
                plan_digest: plan.plan_digest,
                claimed_at_unix_ms,
                claim_lease_expires_at_unix_ms,
                revision: 1,
                state: OperationStateV1::Claimed,
                transitioned_at_unix_ms: None,
                code: None,
                progress_evidence: None,
                final_evidence: None,
                reconciliation_lease: None,
            };
            validate_record(&record)?;
            if unresolved_scope_conflict(body.records.values(), &record) {
                return Err(JournalError::ScopeConflict);
            }
            body.generation = body.generation.checked_add(1).ok_or(JournalError::Full)?;
            body.records
                .insert(record.single_flight_key.clone(), record.clone());
            let durability = persist_journal(root, &body, self.directory_sync.as_ref())?;
            Ok((
                record_digest(&record)?,
                claimed_at_unix_ms,
                capability_expires_at_unix_ms,
                issued_at_monotonic,
                durability,
            ))
        }) {
            Ok(result) => result,
            Err(error) => {
                self.release_reserved(id);
                return Err(error);
            }
        };
        let (record_digest, issued_at_unix_ms, expires_at_unix_ms, issued_at_monotonic, durability) =
            durability;
        if durability != CommitDurability::Confirmed {
            self.release_reserved(id);
            return Err(JournalError::DurabilityUnconfirmed);
        }
        let expires_at_monotonic = issued_at_monotonic
            .checked_add(capability_ttl)
            .ok_or(JournalError::Unavailable)?;
        let mut runtime = self.runtime_lock()?;
        if runtime.reserved.remove(&id).is_none() {
            return Err(JournalError::Unavailable);
        }
        runtime.claims.insert(
            id,
            CapabilityBindingV1 {
                single_flight_key,
                operation_kind: plan.operation_kind,
                record_digest,
                issued_at_unix_ms,
                expires_at_unix_ms,
                expires_at_monotonic,
            },
        );
        Ok(ClaimCapabilityV1 { id })
    }

    /// Test-only observation of the receipt-zero handoff. Consuming this transient capability does
    /// not transition or delete the durable Claimed replay fence.
    #[cfg(test)]
    pub(crate) fn consume_source_ledger_admission_for_test(
        &self,
        claim: SourceLedgerAdmissionClaimV1,
    ) -> Result<ConsumedSourceLedgerAdmissionClaimV1, JournalError> {
        let id = claim.capability.id;
        let binding = {
            let mut runtime = self.runtime_lock()?;
            let operation_kind = runtime
                .claims
                .get(&id)
                .ok_or(JournalError::CapabilityMissing)?
                .operation_kind;
            if operation_kind != OperationKindV1::SupabaseBackfillReceiptZeroAdmission {
                return Err(JournalError::InvalidState);
            }
            let binding = runtime
                .claims
                .remove(&id)
                .ok_or(JournalError::CapabilityMissing)?;
            burn_runtime_id(&mut runtime, id, binding.expires_at_monotonic);
            binding
        };
        self.require_capability_fresh(&binding)?;
        self.with_store(|root| {
            let body = load_journal(root)?;
            let record = exact_record(&body, &binding)?;
            if record.operation_kind != OperationKindV1::SupabaseBackfillReceiptZeroAdmission
                || record.state != OperationStateV1::Claimed
            {
                return Err(JournalError::InvalidState);
            }
            Ok(ConsumedSourceLedgerAdmissionClaimV1 {
                material: claim.material,
            })
        })
    }

    #[cfg(test)]
    fn precommit_for_test(
        &self,
        claim: ClaimCapabilityV1,
        payload: Value,
    ) -> Result<DispatchPermitV1, JournalError> {
        let binding = {
            let mut runtime = self.runtime_lock()?;
            let operation_kind = runtime
                .claims
                .get(&claim.id)
                .ok_or(JournalError::CapabilityMissing)?
                .operation_kind;
            require_mutation_operation_kind(operation_kind)?;
            let binding = runtime
                .claims
                .remove(&claim.id)
                .ok_or(JournalError::CapabilityMissing)?;
            burn_runtime_id(&mut runtime, claim.id, binding.expires_at_monotonic);
            binding
        };
        self.require_capability_fresh(&binding)?;
        let id = claim.id;
        let transition = self.with_store(|root| {
            self.require_capability_fresh(&binding)?;
            let mut body = load_journal(root)?;
            let record = exact_record_mut(&mut body, &binding)?;
            if record.state != OperationStateV1::Claimed {
                return Err(JournalError::InvalidState);
            }
            let now_wall = self.clock.wall_unix_millis()?;
            let issued_at_monotonic = self.clock.monotonic();
            if now_wall < record.claimed_at_unix_ms {
                return Err(JournalError::InvalidState);
            }
            let expires_at_unix_ms = add_duration_millis(now_wall, CAPABILITY_TTL)?;
            let evidence = evidence(EvidencePhaseV1::Progress, payload, now_wall)?;
            record.revision = record.revision.checked_add(1).ok_or(JournalError::Full)?;
            record.state = OperationStateV1::OutcomeUnknown;
            record.transitioned_at_unix_ms = Some(now_wall);
            record.code = Some(OUTCOME_UNKNOWN_CODE.to_owned());
            record.progress_evidence = Some(evidence);
            validate_record(record)?;
            let digest = record_digest(record)?;
            body.generation = body.generation.checked_add(1).ok_or(JournalError::Full)?;
            let durability = persist_journal(root, &body, self.directory_sync.as_ref())?;
            Ok((
                digest,
                now_wall,
                expires_at_unix_ms,
                issued_at_monotonic,
                durability,
            ))
        });
        let (record_digest, issued_at_unix_ms, expires_at_unix_ms, issued_at_monotonic, durability) =
            match transition {
                Ok(result) => result,
                Err(error) => return Err(error),
            };
        if durability != CommitDurability::Confirmed {
            return Err(JournalError::DurabilityUnconfirmed);
        }
        let expires_at_monotonic = issued_at_monotonic
            .checked_add(CAPABILITY_TTL)
            .ok_or(JournalError::Unavailable)?;
        let mut runtime = self.runtime_lock()?;
        self.require_capability_fresh(&CapabilityBindingV1 {
            single_flight_key: binding.single_flight_key.clone(),
            operation_kind: binding.operation_kind,
            record_digest: record_digest.clone(),
            issued_at_unix_ms,
            expires_at_unix_ms,
            expires_at_monotonic,
        })?;
        ensure_transfer_slot_available(&runtime, &id)?;
        runtime.permits.insert(
            id,
            CapabilityBindingV1 {
                single_flight_key: binding.single_flight_key,
                operation_kind: binding.operation_kind,
                record_digest,
                issued_at_unix_ms,
                expires_at_unix_ms,
                expires_at_monotonic,
            },
        );
        Ok(DispatchPermitV1 { id })
    }

    #[cfg(test)]
    fn consume_dispatch_permit_for_test(
        &self,
        permit: DispatchPermitV1,
    ) -> Result<DispatchAttemptV1, JournalError> {
        let binding = {
            let mut runtime = self.runtime_lock()?;
            let operation_kind = runtime
                .permits
                .get(&permit.id)
                .ok_or(JournalError::CapabilityMissing)?
                .operation_kind;
            require_mutation_operation_kind(operation_kind)?;
            let binding = runtime
                .permits
                .remove(&permit.id)
                .ok_or(JournalError::CapabilityMissing)?;
            burn_runtime_id(&mut runtime, permit.id, binding.expires_at_monotonic);
            binding
        };
        self.require_capability_fresh(&binding)?;
        self.require_exact_state(&binding, OperationStateV1::OutcomeUnknown)?;
        let mut runtime = self.runtime_lock()?;
        self.require_capability_fresh(&binding)?;
        ensure_transfer_slot_available(&runtime, &permit.id)?;
        burn_runtime_id(&mut runtime, permit.id, binding.expires_at_monotonic);
        runtime.dispatch_attempts.insert(permit.id, binding);
        Ok(DispatchAttemptV1 { id: permit.id })
    }

    #[cfg(test)]
    fn attest_known_not_dispatched_for_test(
        &self,
        attempt: DispatchAttemptV1,
    ) -> Result<KnownNotDispatchedProofV1, JournalError> {
        let binding = {
            let mut runtime = self.runtime_lock()?;
            let operation_kind = runtime
                .dispatch_attempts
                .get(&attempt.id)
                .ok_or(JournalError::CapabilityMissing)?
                .operation_kind;
            require_mutation_operation_kind(operation_kind)?;
            let binding = runtime
                .dispatch_attempts
                .remove(&attempt.id)
                .ok_or(JournalError::CapabilityMissing)?;
            burn_runtime_id(&mut runtime, attempt.id, binding.expires_at_monotonic);
            binding
        };
        self.require_capability_fresh(&binding)?;
        self.require_exact_state(&binding, OperationStateV1::OutcomeUnknown)?;
        let mut runtime = self.runtime_lock()?;
        self.require_capability_fresh(&binding)?;
        ensure_transfer_slot_available(&runtime, &attempt.id)?;
        burn_runtime_id(&mut runtime, attempt.id, binding.expires_at_monotonic);
        runtime.known_not_dispatched.insert(attempt.id, binding);
        Ok(KnownNotDispatchedProofV1 { id: attempt.id })
    }

    #[cfg(test)]
    fn mark_dispatch_started_for_test(
        &self,
        attempt: DispatchAttemptV1,
    ) -> Result<DispatchSettlementAuthorityV1, JournalError> {
        let binding = {
            let mut runtime = self.runtime_lock()?;
            let operation_kind = runtime
                .dispatch_attempts
                .get(&attempt.id)
                .ok_or(JournalError::CapabilityMissing)?
                .operation_kind;
            require_mutation_operation_kind(operation_kind)?;
            let binding = runtime
                .dispatch_attempts
                .remove(&attempt.id)
                .ok_or(JournalError::CapabilityMissing)?;
            burn_runtime_id(&mut runtime, attempt.id, binding.expires_at_monotonic);
            binding
        };
        self.require_capability_fresh(&binding)?;
        self.require_exact_state(&binding, OperationStateV1::OutcomeUnknown)?;
        let mut runtime = self.runtime_lock()?;
        self.require_capability_fresh(&binding)?;
        ensure_transfer_slot_available(&runtime, &attempt.id)?;
        burn_runtime_id(&mut runtime, attempt.id, binding.expires_at_monotonic);
        runtime.dispatch_settlements.insert(attempt.id, binding);
        Ok(DispatchSettlementAuthorityV1 { id: attempt.id })
    }

    #[cfg(test)]
    fn settle_dispatch_for_test(
        &self,
        authority: DispatchSettlementAuthorityV1,
        outcome: OperationStateV1,
        payload: Value,
    ) -> Result<BackendOperationRecordV1, JournalError> {
        let binding = {
            let mut runtime = self.runtime_lock()?;
            let operation_kind = runtime
                .dispatch_settlements
                .get(&authority.id)
                .ok_or(JournalError::CapabilityMissing)?
                .operation_kind;
            require_mutation_operation_kind(operation_kind)?;
            let binding = runtime
                .dispatch_settlements
                .remove(&authority.id)
                .ok_or(JournalError::CapabilityMissing)?;
            burn_runtime_id(&mut runtime, authority.id, binding.expires_at_monotonic);
            binding
        };
        self.require_capability_fresh(&binding)?;
        if outcome != OperationStateV1::Applied {
            return Err(JournalError::InvalidState);
        }
        self.settle_exact(
            binding,
            OperationStateV1::OutcomeUnknown,
            outcome,
            None,
            payload,
        )
    }

    #[cfg(test)]
    fn settle_known_not_dispatched_for_test(
        &self,
        proof: KnownNotDispatchedProofV1,
        payload: Value,
    ) -> Result<BackendOperationRecordV1, JournalError> {
        let binding = {
            let mut runtime = self.runtime_lock()?;
            let operation_kind = runtime
                .known_not_dispatched
                .get(&proof.id)
                .ok_or(JournalError::CapabilityMissing)?
                .operation_kind;
            require_mutation_operation_kind(operation_kind)?;
            let binding = runtime
                .known_not_dispatched
                .remove(&proof.id)
                .ok_or(JournalError::CapabilityMissing)?;
            burn_runtime_id(&mut runtime, proof.id, binding.expires_at_monotonic);
            binding
        };
        self.require_capability_fresh(&binding)?;
        self.settle_exact(
            binding,
            OperationStateV1::OutcomeUnknown,
            OperationStateV1::Failed,
            Some(KNOWN_NOT_DISPATCHED_CODE),
            payload,
        )
    }

    #[cfg(test)]
    fn reconstruct_for_test(
        &self,
        single_flight_key: &str,
    ) -> Result<RecoveryCapabilityV1, JournalError> {
        validate_digest(single_flight_key)?;
        let (record, kind, issued_at_unix_ms, issued_at_monotonic) = self.with_store(|root| {
            let body = load_journal(root)?;
            let record = body
                .records
                .get(single_flight_key)
                .cloned()
                .ok_or(JournalError::Conflict)?;
            require_mutation_operation_kind(record.operation_kind)?;
            let (kind, recovery_not_before_unix_ms) = match record.state {
                OperationStateV1::Claimed => (
                    RecoveryKindV1::ClaimedKnownNotDispatched,
                    record.claim_lease_expires_at_unix_ms,
                ),
                OperationStateV1::OutcomeUnknown => {
                    let transitioned_at = record
                        .transitioned_at_unix_ms
                        .ok_or(JournalError::Corrupt)?;
                    (
                        RecoveryKindV1::OutcomeUnknownReconciliation,
                        record
                            .claim_lease_expires_at_unix_ms
                            .max(add_duration_millis(transitioned_at, CAPABILITY_TTL)?),
                    )
                }
                OperationStateV1::Applied | OperationStateV1::Failed => {
                    return Err(JournalError::InvalidState)
                }
            };
            let issued_at_unix_ms = self.clock.wall_unix_millis()?;
            let issued_at_monotonic = self.clock.monotonic();
            if issued_at_unix_ms < record.claimed_at_unix_ms
                || issued_at_unix_ms < recovery_not_before_unix_ms
            {
                return Err(JournalError::LeaseActive);
            }
            Ok((record, kind, issued_at_unix_ms, issued_at_monotonic))
        })?;
        let expires_at_monotonic = issued_at_monotonic
            .checked_add(CAPABILITY_TTL)
            .ok_or(JournalError::Unavailable)?;
        let expires_at_unix_ms = add_duration_millis(issued_at_unix_ms, CAPABILITY_TTL)?;
        let record_digest = record_digest(&record)?;
        let (id, binding) = self.new_capability_binding(
            record.single_flight_key,
            record.operation_kind,
            record_digest,
            issued_at_unix_ms,
            expires_at_unix_ms,
            expires_at_monotonic,
        )?;
        let mut runtime = self.runtime_lock()?;
        if runtime.reserved.remove(&id).is_none() {
            return Err(JournalError::Unavailable);
        }
        runtime.recoveries.insert(id, (binding, kind));
        Ok(RecoveryCapabilityV1 { id, kind })
    }

    #[cfg(test)]
    fn settle_reconstructed_claim_for_test(
        &self,
        recovery: RecoveryCapabilityV1,
        payload: Value,
    ) -> Result<BackendOperationRecordV1, JournalError> {
        let (binding, kind) = {
            let mut runtime = self.runtime_lock()?;
            let operation_kind = runtime
                .recoveries
                .get(&recovery.id)
                .ok_or(JournalError::CapabilityMissing)?
                .0
                .operation_kind;
            require_mutation_operation_kind(operation_kind)?;
            let (binding, kind) = runtime
                .recoveries
                .remove(&recovery.id)
                .ok_or(JournalError::CapabilityMissing)?;
            burn_runtime_id(&mut runtime, recovery.id, binding.expires_at_monotonic);
            (binding, kind)
        };
        if recovery.kind != kind || kind != RecoveryKindV1::ClaimedKnownNotDispatched {
            return Err(JournalError::InvalidState);
        }
        self.require_capability_fresh(&binding)?;
        self.settle_exact(
            binding,
            OperationStateV1::Claimed,
            OperationStateV1::Failed,
            Some(KNOWN_NOT_DISPATCHED_CODE),
            payload,
        )
    }

    #[cfg(test)]
    fn begin_reconciliation_for_test(
        &self,
        recovery: RecoveryCapabilityV1,
    ) -> Result<ReconciliationPermitV1, JournalError> {
        let (binding, kind) = {
            let mut runtime = self.runtime_lock()?;
            let operation_kind = runtime
                .recoveries
                .get(&recovery.id)
                .ok_or(JournalError::CapabilityMissing)?
                .0
                .operation_kind;
            require_mutation_operation_kind(operation_kind)?;
            let (binding, kind) = runtime
                .recoveries
                .remove(&recovery.id)
                .ok_or(JournalError::CapabilityMissing)?;
            burn_runtime_id(&mut runtime, recovery.id, binding.expires_at_monotonic);
            (binding, kind)
        };
        if recovery.kind != kind || kind != RecoveryKindV1::OutcomeUnknownReconciliation {
            return Err(JournalError::InvalidState);
        }
        self.require_capability_fresh(&binding)?;
        let lease_ttl = reconciliation_lease_ttl(binding.operation_kind);
        let authority_id = recovery.id;
        let authority_digest = digest_bytes(&authority_id);
        let transition = self.with_store(|root| {
            self.require_capability_fresh(&binding)?;
            let mut body = load_journal(root)?;
            let record = exact_record_mut(&mut body, &binding)?;
            if record.state != OperationStateV1::OutcomeUnknown {
                return Err(JournalError::InvalidState);
            }
            let now_wall = self.clock.wall_unix_millis()?;
            let issued_at_monotonic = self.clock.monotonic();
            let transitioned_at = record
                .transitioned_at_unix_ms
                .ok_or(JournalError::Corrupt)?;
            if now_wall < transitioned_at {
                return Err(JournalError::InvalidState);
            }
            let expires_wall = add_duration_millis(now_wall, lease_ttl)?;
            let lease_generation = match record.reconciliation_lease.as_ref() {
                Some(lease)
                    if now_wall < lease.issued_at_unix_ms
                        || now_wall < lease.expires_at_unix_ms =>
                {
                    return Err(JournalError::LeaseActive)
                }
                Some(lease) => lease.generation.checked_add(1).ok_or(JournalError::Full)?,
                None => 1,
            };
            record.revision = record.revision.checked_add(1).ok_or(JournalError::Full)?;
            record.reconciliation_lease = Some(ReconciliationLeaseRecordV1 {
                generation: lease_generation,
                authority_digest: authority_digest.clone(),
                issued_at_unix_ms: now_wall,
                expires_at_unix_ms: expires_wall,
                consumed: false,
            });
            validate_record(record)?;
            let digest = record_digest(record)?;
            body.generation = body.generation.checked_add(1).ok_or(JournalError::Full)?;
            let durability = persist_journal(root, &body, self.directory_sync.as_ref())?;
            Ok((
                digest,
                lease_generation,
                now_wall,
                expires_wall,
                issued_at_monotonic,
                durability,
            ))
        });
        let (
            record_digest,
            lease_generation,
            issued_at_unix_ms,
            expires_wall,
            issued_at_monotonic,
            durability,
        ) = match transition {
            Ok(result) => result,
            Err(error) => return Err(error),
        };
        if durability != CommitDurability::Confirmed {
            return Err(JournalError::DurabilityUnconfirmed);
        }
        let expires_at_monotonic = issued_at_monotonic
            .checked_add(lease_ttl)
            .ok_or(JournalError::Unavailable)?;
        let mut runtime = self.runtime_lock()?;
        ensure_transfer_slot_available(&runtime, &authority_id)?;
        let next_binding = CapabilityBindingV1 {
            single_flight_key: binding.single_flight_key,
            operation_kind: binding.operation_kind,
            record_digest,
            issued_at_unix_ms,
            expires_at_unix_ms: expires_wall,
            expires_at_monotonic,
        };
        self.require_capability_fresh(&next_binding)?;
        runtime.reconciliation_permits.insert(
            authority_id,
            ReconciliationCapabilityBindingV1 {
                binding: next_binding,
                authority_digest,
                lease_generation,
                lease_expires_at_unix_ms: expires_wall,
                lease_expires_at_monotonic: expires_at_monotonic,
            },
        );
        Ok(ReconciliationPermitV1 { id: authority_id })
    }

    #[cfg(test)]
    fn consume_reconciliation_for_test(
        &self,
        permit: ReconciliationPermitV1,
    ) -> Result<ReconciliationObservationAuthorityV1, JournalError> {
        let mut binding = {
            let mut runtime = self.runtime_lock()?;
            let operation_kind = runtime
                .reconciliation_permits
                .get(&permit.id)
                .ok_or(JournalError::CapabilityMissing)?
                .binding
                .operation_kind;
            require_mutation_operation_kind(operation_kind)?;
            let binding = runtime
                .reconciliation_permits
                .remove(&permit.id)
                .ok_or(JournalError::CapabilityMissing)?;
            burn_runtime_id(
                &mut runtime,
                permit.id,
                binding.binding.expires_at_monotonic,
            );
            binding
        };
        self.require_capability_fresh(&binding.binding)?;
        let (record_digest, durability) = self.with_store(|root| {
            self.require_capability_fresh(&binding.binding)?;
            let mut body = load_journal(root)?;
            let record = exact_record_mut(&mut body, &binding.binding)?;
            if record.state != OperationStateV1::OutcomeUnknown {
                return Err(JournalError::InvalidState);
            }
            let now_wall = self.clock.wall_unix_millis()?;
            if now_wall >= binding.lease_expires_at_unix_ms {
                return Err(JournalError::CapabilityExpired);
            }
            let lease = record
                .reconciliation_lease
                .as_mut()
                .ok_or(JournalError::InvalidState)?;
            if lease.generation != binding.lease_generation
                || lease.authority_digest != binding.authority_digest
                || lease.consumed
                || now_wall < lease.issued_at_unix_ms
                || now_wall >= lease.expires_at_unix_ms
            {
                return Err(JournalError::InvalidState);
            }
            lease.consumed = true;
            record.revision = record.revision.checked_add(1).ok_or(JournalError::Full)?;
            validate_record(record)?;
            let digest = record_digest(record)?;
            body.generation = body.generation.checked_add(1).ok_or(JournalError::Full)?;
            let durability = persist_journal(root, &body, self.directory_sync.as_ref())?;
            Ok((digest, durability))
        })?;
        if durability != CommitDurability::Confirmed {
            return Err(JournalError::DurabilityUnconfirmed);
        }
        binding.binding.record_digest = record_digest;
        let mut runtime = self.runtime_lock()?;
        self.require_capability_fresh(&binding.binding)?;
        ensure_transfer_slot_available(&runtime, &permit.id)?;
        burn_runtime_id(
            &mut runtime,
            permit.id,
            binding.binding.expires_at_monotonic,
        );
        runtime
            .reconciliation_observations
            .insert(permit.id, binding);
        Ok(ReconciliationObservationAuthorityV1 { id: permit.id })
    }

    #[cfg(test)]
    fn settle_reconciliation_for_test(
        &self,
        authority: ReconciliationObservationAuthorityV1,
        outcome: OperationStateV1,
        payload: Value,
    ) -> Result<BackendOperationRecordV1, JournalError> {
        let binding = {
            let mut runtime = self.runtime_lock()?;
            let operation_kind = runtime
                .reconciliation_observations
                .get(&authority.id)
                .ok_or(JournalError::CapabilityMissing)?
                .binding
                .operation_kind;
            require_mutation_operation_kind(operation_kind)?;
            let binding = runtime
                .reconciliation_observations
                .remove(&authority.id)
                .ok_or(JournalError::CapabilityMissing)?;
            burn_runtime_id(
                &mut runtime,
                authority.id,
                binding.binding.expires_at_monotonic,
            );
            binding
        };
        self.require_capability_fresh(&binding.binding)?;
        if outcome != OperationStateV1::Applied {
            return Err(JournalError::InvalidState);
        }
        self.settle_exact_with_lease(binding, outcome, None, payload)
    }

    #[cfg(test)]
    fn settle_exact(
        &self,
        binding: CapabilityBindingV1,
        expected: OperationStateV1,
        outcome: OperationStateV1,
        code: Option<&str>,
        payload: Value,
    ) -> Result<BackendOperationRecordV1, JournalError> {
        require_mutation_operation_kind(binding.operation_kind)?;
        let (record, durability) = self.with_store(|root| {
            self.require_capability_fresh(&binding)?;
            let mut body = load_journal(root)?;
            let record = exact_record_mut(&mut body, &binding)?;
            if record.state != expected {
                return Err(JournalError::InvalidState);
            }
            let now_wall = self.clock.wall_unix_millis()?;
            let not_before = record
                .transitioned_at_unix_ms
                .unwrap_or(record.claimed_at_unix_ms);
            if now_wall < not_before {
                return Err(JournalError::InvalidState);
            }
            let evidence = evidence(EvidencePhaseV1::Final, payload, now_wall)?;
            apply_terminal(record, outcome, code, evidence)?;
            let result = record.clone();
            body.generation = body.generation.checked_add(1).ok_or(JournalError::Full)?;
            let durability = persist_journal(root, &body, self.directory_sync.as_ref())?;
            Ok((result, durability))
        })?;
        if durability != CommitDurability::Confirmed {
            return Err(JournalError::DurabilityUnconfirmed);
        }
        Ok(record)
    }

    #[cfg(test)]
    fn settle_exact_with_lease(
        &self,
        binding: ReconciliationCapabilityBindingV1,
        outcome: OperationStateV1,
        code: Option<&str>,
        payload: Value,
    ) -> Result<BackendOperationRecordV1, JournalError> {
        require_mutation_operation_kind(binding.binding.operation_kind)?;
        let (record, durability) = self.with_store(|root| {
            self.require_capability_fresh(&binding.binding)?;
            let mut body = load_journal(root)?;
            let record = exact_record_mut(&mut body, &binding.binding)?;
            let now_wall = self.clock.wall_unix_millis()?;
            if now_wall >= binding.lease_expires_at_unix_ms {
                return Err(JournalError::CapabilityExpired);
            }
            let lease = record
                .reconciliation_lease
                .as_ref()
                .ok_or(JournalError::InvalidState)?;
            if record.state != OperationStateV1::OutcomeUnknown
                || lease.generation != binding.lease_generation
                || lease.authority_digest != binding.authority_digest
                || !lease.consumed
                || now_wall < lease.issued_at_unix_ms
                || now_wall >= lease.expires_at_unix_ms
            {
                return Err(JournalError::InvalidState);
            }
            let transitioned_at = record
                .transitioned_at_unix_ms
                .ok_or(JournalError::Corrupt)?;
            if now_wall < transitioned_at {
                return Err(JournalError::InvalidState);
            }
            let evidence = evidence(EvidencePhaseV1::Final, payload, now_wall)?;
            apply_terminal(record, outcome, code, evidence)?;
            let result = record.clone();
            body.generation = body.generation.checked_add(1).ok_or(JournalError::Full)?;
            let durability = persist_journal(root, &body, self.directory_sync.as_ref())?;
            Ok((result, durability))
        })?;
        if durability != CommitDurability::Confirmed {
            return Err(JournalError::DurabilityUnconfirmed);
        }
        Ok(record)
    }

    fn require_exact_state(
        &self,
        binding: &CapabilityBindingV1,
        expected: OperationStateV1,
    ) -> Result<(), JournalError> {
        self.with_store(|root| {
            self.require_capability_fresh(binding)?;
            let body = load_journal(root)?;
            let record = exact_record(&body, binding)?;
            if record.state != expected {
                return Err(JournalError::InvalidState);
            }
            Ok(())
        })
    }

    fn require_capability_fresh(&self, binding: &CapabilityBindingV1) -> Result<(), JournalError> {
        let now_wall = self.clock.wall_unix_millis()?;
        if now_wall < binding.issued_at_unix_ms {
            return Err(JournalError::InvalidState);
        }
        if now_wall >= binding.expires_at_unix_ms
            || self.clock.monotonic() >= binding.expires_at_monotonic
        {
            return Err(JournalError::CapabilityExpired);
        }
        Ok(())
    }

    #[cfg(test)]
    fn clock_sample_for_test(&self) -> Result<JournalClockSampleV1, JournalError> {
        Ok(JournalClockSampleV1 {
            wall_unix_ms: self.clock.wall_unix_millis()?,
            monotonic: self.clock.monotonic(),
        })
    }

    #[cfg(test)]
    fn require_specialized_capability_fresh_for_test(
        &self,
        binding: &CapabilityBindingV1,
        issued_at_monotonic: Duration,
        sample: JournalClockSampleV1,
    ) -> Result<(), JournalError> {
        if sample.wall_unix_ms < binding.issued_at_unix_ms || sample.monotonic < issued_at_monotonic
        {
            return Err(JournalError::InvalidState);
        }
        if sample.wall_unix_ms >= binding.expires_at_unix_ms
            || sample.monotonic >= binding.expires_at_monotonic
        {
            return Err(JournalError::CapabilityExpired);
        }
        Ok(())
    }

    #[cfg(test)]
    fn fixed_runner_window_for_test(
        &self,
        sample: JournalClockSampleV1,
        required: Duration,
        wall_ceiling_unix_ms: u64,
        monotonic_ceiling: Duration,
    ) -> Result<FixedRunnerWindowV1, JournalError> {
        let expires_at_unix_ms = add_duration_millis(sample.wall_unix_ms, required)?;
        let expires_at_monotonic = sample
            .monotonic
            .checked_add(required)
            .ok_or(JournalError::Unavailable)?;
        if expires_at_unix_ms > wall_ceiling_unix_ms || expires_at_monotonic > monotonic_ceiling {
            return Err(JournalError::CapabilityExpired);
        }
        Ok(FixedRunnerWindowV1 {
            issued_at_unix_ms: sample.wall_unix_ms,
            issued_at_monotonic: sample.monotonic,
            expires_at_unix_ms,
            expires_at_monotonic,
        })
    }

    fn new_capability_binding(
        &self,
        single_flight_key: String,
        operation_kind: OperationKindV1,
        record_digest: String,
        issued_at_unix_ms: u64,
        expires_at_unix_ms: u64,
        expires_at_monotonic: Duration,
    ) -> Result<([u8; CAPABILITY_BYTES], CapabilityBindingV1), JournalError> {
        let id = self.unique_runtime_id(expires_at_monotonic, MAX_RUNTIME_AUTHORITY_IDS)?;
        Ok((
            id,
            CapabilityBindingV1 {
                single_flight_key,
                operation_kind,
                record_digest,
                issued_at_unix_ms,
                expires_at_unix_ms,
                expires_at_monotonic,
            },
        ))
    }

    fn unique_runtime_id(
        &self,
        reservation_expires_at: Duration,
        maximum_occupied_ids: usize,
    ) -> Result<[u8; CAPABILITY_BYTES], JournalError> {
        if maximum_occupied_ids == 0 || maximum_occupied_ids > MAX_RUNTIME_AUTHORITY_IDS {
            return Err(JournalError::Invalid);
        }
        let mut runtime = self.runtime_lock()?;
        if runtime_id_count(&runtime) >= maximum_occupied_ids {
            return Err(JournalError::Full);
        }
        for _ in 0..CAPABILITY_ID_ATTEMPTS {
            let id = self.entropy.capability_id()?;
            if !runtime_contains_id(&runtime, &id) {
                runtime.reserved.insert(id, reservation_expires_at);
                return Ok(id);
            }
        }
        Err(JournalError::Unavailable)
    }

    fn release_reserved(&self, id: [u8; CAPABILITY_BYTES]) {
        if let Ok(mut runtime) = self.runtime_lock() {
            runtime.reserved.remove(&id);
        }
    }

    fn runtime_lock(&self) -> Result<MutexGuard<'_, RuntimeAuthoritiesV1>, JournalError> {
        let now = self.clock.monotonic();
        let mut runtime = self.runtime.lock().map_err(|_| JournalError::Unavailable)?;
        purge_expired_runtime_authorities(&mut runtime, now);
        Ok(runtime)
    }
}

fn automation_cas_plan(
    material: &AutomationCasRecoveryMaterialV1,
) -> Result<(TrustedOperationPlanV1, AutomationCasJournalIdentityV1), JournalError> {
    validate_automation_cas_recovery_material(material).map_err(|_| JournalError::Invalid)?;
    let canonical = AutomationCasCanonicalPlanV1 {
        format: AUTOMATION_CAS_RECOVERY_PLAN_FORMAT,
        material,
        version: 1,
    };
    let plan_digest = digest_canonical_serialized(AUTOMATION_CAS_PLAN_DOMAIN, &canonical)?;
    let single_flight_key = automation_cas_single_flight_key(&plan_digest)?;
    let dispatch_scope_key = digest_canonical_serialized(
        AUTOMATION_CAS_SCOPE_DOMAIN,
        &AutomationCasHeadScopeV1 {
            application_object_key: &material.application_object_key,
            automation_id: &material.parameters.automation_id,
            idempotency_key_digest: &material.parameters.idempotency_key_digest,
            project_ref: &material.project_ref,
            provider_id: &material.provider_id,
            schema_name: &material.schema_name,
        },
    )?;
    let identity = AutomationCasJournalIdentityV1 {
        dispatch_scope_key: dispatch_scope_key.clone(),
        plan_digest: plan_digest.clone(),
        single_flight_key: single_flight_key.clone(),
    };
    Ok((
        TrustedOperationPlanV1 {
            single_flight_key,
            dispatch_scope_key,
            provider_id: material.provider_id.clone(),
            project_id: material.project_ref.clone(),
            operation_kind: OperationKindV1::SupabaseAutomationIdempotencyCas,
            release_id: format!("{AUTOMATION_CAS_RELEASE_PREFIX}{plan_digest}"),
            owner_id: AUTOMATION_CAS_OWNER.to_owned(),
            plan_digest,
        },
        identity,
    ))
}

fn automation_cas_single_flight_key(plan_digest: &str) -> Result<String, JournalError> {
    validate_digest(plan_digest)?;
    digest_canonical_serialized(
        AUTOMATION_CAS_SINGLE_FLIGHT_DOMAIN,
        &AutomationCasSingleFlightV1 {
            operation: "supabase-automation-idempotency-cas",
            plan_digest,
        },
    )
}

fn validate_automation_cas_record_identity(
    single_flight_key: &str,
    provider_id: &str,
    project_id: &str,
    release_id: &str,
    owner_id: &str,
    expected_plan_digest: &str,
) -> Result<(), JournalError> {
    let plan_digest = release_id
        .strip_prefix(AUTOMATION_CAS_RELEASE_PREFIX)
        .ok_or(JournalError::Invalid)?;
    if provider_id != "supabase"
        || !is_supabase_project_ref(project_id)
        || owner_id != AUTOMATION_CAS_OWNER
        || plan_digest != expected_plan_digest
        || single_flight_key != automation_cas_single_flight_key(plan_digest)?
    {
        return Err(JournalError::Invalid);
    }
    validate_digest(plan_digest)
}

fn require_exact_automation_cas_identity(
    material: &AutomationCasRecoveryMaterialV1,
    expected: &AutomationCasJournalIdentityV1,
) -> Result<(), JournalError> {
    let (_, actual) = automation_cas_plan(material).map_err(|_| JournalError::InvalidState)?;
    if &actual != expected {
        return Err(JournalError::InvalidState);
    }
    Ok(())
}

fn automation_cas_material_from_outcome_unknown(
    record: &BackendOperationRecordV1,
) -> Result<
    (
        AutomationCasRecoveryMaterialV1,
        AutomationCasJournalIdentityV1,
    ),
    JournalError,
> {
    if record.operation_kind != OperationKindV1::SupabaseAutomationIdempotencyCas
        || record.state != OperationStateV1::OutcomeUnknown
        || record.final_evidence.is_some()
    {
        return Err(JournalError::Corrupt);
    }
    let progress_evidence = record
        .progress_evidence
        .as_ref()
        .ok_or(JournalError::Corrupt)?;
    let progress: AutomationCasOutcomeUnknownProgressV1 =
        serde_json::from_str(&progress_evidence.payload).map_err(|_| JournalError::Corrupt)?;
    if progress.format != AUTOMATION_CAS_RECOVERY_PROGRESS_FORMAT
        || progress.version != 1
        || progress.phase != "outcome-unknown"
        || progress.automatic_retry_allowed
        || progress.execution_authorized
        || progress.mutation_authorized
        || progress.receipt_v2_issued
        || progress.release_authorized
    {
        return Err(JournalError::Corrupt);
    }
    let (plan, identity) =
        automation_cas_plan(&progress.material).map_err(|_| JournalError::Corrupt)?;
    if progress.plan_digest != identity.plan_digest
        || record.single_flight_key != plan.single_flight_key
        || record.dispatch_scope_key != plan.dispatch_scope_key
        || record.provider_id != plan.provider_id
        || record.project_id != plan.project_id
        || record.operation_kind != plan.operation_kind
        || record.release_id != plan.release_id
        || record.owner_id != plan.owner_id
        || record.plan_digest != plan.plan_digest
    {
        return Err(JournalError::Corrupt);
    }
    Ok((progress.material, identity))
}

fn automation_cas_outcome_unknown_payload(
    material: &AutomationCasRecoveryMaterialV1,
    plan_digest: &str,
) -> Result<Value, JournalError> {
    let payload = serde_json::to_value(AutomationCasOutcomeUnknownProgressV1 {
        automatic_retry_allowed: false,
        execution_authorized: false,
        format: AUTOMATION_CAS_RECOVERY_PROGRESS_FORMAT.to_owned(),
        material: material.clone(),
        mutation_authorized: false,
        phase: "outcome-unknown".to_owned(),
        plan_digest: plan_digest.to_owned(),
        receipt_v2_issued: false,
        release_authorized: false,
        version: 1,
    })
    .map_err(|_| JournalError::Invalid)?;
    validate_evidence_payload(&payload)?;
    Ok(payload)
}

fn receipt_zero_initializer_recovery_encoded_length(
    canonical_byte_length: usize,
) -> Result<usize, JournalError> {
    if !(2..=RECEIPT_ZERO_INITIALIZER_RECOVERY_MAX_CANONICAL_BYTES).contains(&canonical_byte_length)
    {
        return Err(JournalError::Invalid);
    }
    let groups = canonical_byte_length
        .checked_add(2)
        .ok_or(JournalError::Invalid)?
        / 3;
    let encoded_length = groups.checked_mul(4).ok_or(JournalError::Invalid)?;
    if encoded_length > RECEIPT_ZERO_INITIALIZER_RECOVERY_MAX_ENCODED_BYTES {
        return Err(JournalError::Invalid);
    }
    Ok(encoded_length)
}

fn split_receipt_zero_initializer_recovery_chunks(
    canonical: &[u8],
) -> Result<Vec<String>, JournalError> {
    let expected_encoded_length =
        receipt_zero_initializer_recovery_encoded_length(canonical.len())?;
    let encoded = STANDARD.encode(canonical);
    if encoded.len() != expected_encoded_length {
        return Err(JournalError::Invalid);
    }
    let chunks = encoded
        .as_bytes()
        .chunks(RECEIPT_ZERO_INITIALIZER_RECOVERY_CHUNK_BYTES)
        .map(|chunk| String::from_utf8(chunk.to_vec()).map_err(|_| JournalError::Invalid))
        .collect::<Result<Vec<_>, _>>()?;
    if chunks.is_empty() || chunks.len() > RECEIPT_ZERO_INITIALIZER_RECOVERY_MAX_CHUNKS {
        return Err(JournalError::Invalid);
    }
    Ok(chunks)
}

fn join_receipt_zero_initializer_recovery_chunks(
    canonical_byte_length: usize,
    chunks: &[String],
) -> Result<Vec<u8>, JournalError> {
    let expected_encoded_length =
        receipt_zero_initializer_recovery_encoded_length(canonical_byte_length)?;
    let expected_chunk_count = expected_encoded_length
        .checked_add(RECEIPT_ZERO_INITIALIZER_RECOVERY_CHUNK_BYTES - 1)
        .ok_or(JournalError::Invalid)?
        / RECEIPT_ZERO_INITIALIZER_RECOVERY_CHUNK_BYTES;
    if chunks.is_empty()
        || chunks.len() != expected_chunk_count
        || chunks.len() > RECEIPT_ZERO_INITIALIZER_RECOVERY_MAX_CHUNKS
    {
        return Err(JournalError::Invalid);
    }
    let mut actual_encoded_length = 0_usize;
    for (index, chunk) in chunks.iter().enumerate() {
        let is_final = index + 1 == chunks.len();
        if chunk.is_empty()
            || !chunk.is_ascii()
            || chunk.len() > RECEIPT_ZERO_INITIALIZER_RECOVERY_CHUNK_BYTES
            || (!is_final && chunk.len() != RECEIPT_ZERO_INITIALIZER_RECOVERY_CHUNK_BYTES)
        {
            return Err(JournalError::Invalid);
        }
        actual_encoded_length = actual_encoded_length
            .checked_add(chunk.len())
            .ok_or(JournalError::Invalid)?;
    }
    if actual_encoded_length != expected_encoded_length {
        return Err(JournalError::Invalid);
    }
    let mut encoded = String::with_capacity(expected_encoded_length);
    for chunk in chunks {
        encoded.push_str(chunk);
    }
    let canonical = STANDARD
        .decode(encoded.as_bytes())
        .map_err(|_| JournalError::Invalid)?;
    if canonical.len() != canonical_byte_length || STANDARD.encode(&canonical) != encoded {
        return Err(JournalError::Invalid);
    }
    Ok(canonical)
}

fn receipt_zero_initializer_recovery_material(
    material: &ReceiptZeroInitializerClaimMaterialV1,
) -> Result<ReceiptZeroInitializerRecoveryMaterialV1, JournalError> {
    validate_receipt_zero_initializer_material(material)?;
    let canonical = canonical_serialized_bytes(material)?;
    let canonical_byte_length =
        u32::try_from(canonical.len()).map_err(|_| JournalError::Invalid)?;
    Ok(ReceiptZeroInitializerRecoveryMaterialV1 {
        canonical_byte_length,
        canonical_digest: digest_bytes(&canonical),
        chunks: split_receipt_zero_initializer_recovery_chunks(&canonical)?,
        encoding: RECEIPT_ZERO_INITIALIZER_RECOVERY_ENCODING.to_owned(),
        format: RECEIPT_ZERO_INITIALIZER_RECOVERY_FORMAT.to_owned(),
        version: 1,
    })
}

fn receipt_zero_initializer_material_from_recovery(
    recovery: ReceiptZeroInitializerRecoveryMaterialV1,
) -> Result<ReceiptZeroInitializerClaimMaterialV1, JournalError> {
    if recovery.format != RECEIPT_ZERO_INITIALIZER_RECOVERY_FORMAT
        || recovery.version != 1
        || recovery.encoding != RECEIPT_ZERO_INITIALIZER_RECOVERY_ENCODING
    {
        return Err(JournalError::Invalid);
    }
    validate_digest(&recovery.canonical_digest)?;
    let canonical_byte_length =
        usize::try_from(recovery.canonical_byte_length).map_err(|_| JournalError::Invalid)?;
    let canonical =
        join_receipt_zero_initializer_recovery_chunks(canonical_byte_length, &recovery.chunks)?;
    if digest_bytes(&canonical) != recovery.canonical_digest {
        return Err(JournalError::Invalid);
    }
    let material: ReceiptZeroInitializerClaimMaterialV1 =
        serde_json::from_slice(&canonical).map_err(|_| JournalError::Invalid)?;
    if canonical_serialized_bytes(&material)? != canonical {
        return Err(JournalError::Invalid);
    }
    validate_receipt_zero_initializer_material(&material)?;
    Ok(material)
}

fn receipt_zero_initializer_outcome_unknown_payload(
    material: &ReceiptZeroInitializerClaimMaterialV1,
    plan_digest: &str,
) -> Result<Value, JournalError> {
    let identity = derive_receipt_zero_initializer_identity(material)?;
    if identity.plan_digest != plan_digest {
        return Err(JournalError::Invalid);
    }
    let payload = serde_json::to_value(ReceiptZeroInitializerOutcomeUnknownProgressV1 {
        automatic_retry_allowed: false,
        execution_authorized: false,
        format: RECEIPT_ZERO_INITIALIZER_OUTCOME_UNKNOWN_PROGRESS_FORMAT.to_owned(),
        mutation_authorized: false,
        phase: "outcome-unknown".to_owned(),
        plan_digest: plan_digest.to_owned(),
        receipt_v2_issued: false,
        recovery: receipt_zero_initializer_recovery_material(material)?,
        release_authorized: false,
        version: 1,
    })
    .map_err(|_| JournalError::Invalid)?;
    validate_evidence_payload(&payload)?;
    Ok(payload)
}

fn receipt_zero_initializer_material_from_outcome_unknown(
    record: &BackendOperationRecordV1,
) -> Result<
    (
        ReceiptZeroInitializerClaimMaterialV1,
        ValidatedReceiptZeroInitializerIdentityV1,
    ),
    JournalError,
> {
    if record.operation_kind != OperationKindV1::SupabaseBackfillReceiptZeroInitializer
        || record.state != OperationStateV1::OutcomeUnknown
        || record.final_evidence.is_some()
    {
        return Err(JournalError::Corrupt);
    }
    let progress_evidence = record
        .progress_evidence
        .as_ref()
        .ok_or(JournalError::Corrupt)?;
    validate_evidence(progress_evidence, EvidencePhaseV1::Progress)
        .map_err(|_| JournalError::Corrupt)?;
    let progress: ReceiptZeroInitializerOutcomeUnknownProgressV1 =
        serde_json::from_str(&progress_evidence.payload).map_err(|_| JournalError::Corrupt)?;
    if progress.format != RECEIPT_ZERO_INITIALIZER_OUTCOME_UNKNOWN_PROGRESS_FORMAT
        || progress.version != 1
        || progress.phase != "outcome-unknown"
        || progress.automatic_retry_allowed
        || progress.execution_authorized
        || progress.mutation_authorized
        || progress.receipt_v2_issued
        || progress.release_authorized
    {
        return Err(JournalError::Corrupt);
    }
    let material = receipt_zero_initializer_material_from_recovery(progress.recovery)
        .map_err(|_| JournalError::Corrupt)?;
    let identity =
        derive_receipt_zero_initializer_identity(&material).map_err(|_| JournalError::Corrupt)?;
    if progress.plan_digest != identity.plan_digest
        || record.single_flight_key != identity.single_flight_key
        || record.dispatch_scope_key != identity.dispatch_scope_key
        || record.provider_id != identity.provider_id
        || record.project_id != identity.project_id
        || record.release_id != identity.release_id
        || record.owner_id != identity.owner_id
        || record.plan_digest != identity.plan_digest
    {
        return Err(JournalError::Corrupt);
    }
    Ok((material, identity))
}

// Field order is the ASCII/UTF-16 key order used by `digestCanonicalManifest`. All keys are ASCII,
// so serializing this struct produces the same canonical plan bytes as the TypeScript review.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CasLedgerInstallCanonicalPlanV1<'a> {
    account_id: &'a str,
    base_sql_digest: &'a str,
    environment: &'a str,
    format: &'static str,
    install_review_digest: &'a str,
    install_sql_digest: &'a str,
    ledger_shape_digest: &'a str,
    marker: &'a str,
    marker_binding_digest: &'a str,
    migration_name: &'a str,
    project_ref: &'a str,
    provider_id: &'a str,
    read_grant_generation: &'a str,
    source_review_digest: &'a str,
    verification_digest: &'a str,
    verification_query_digest: &'a str,
    version: u8,
    write_grant_generation: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CasLedgerInstallSingleFlightV1<'a> {
    account_id: &'a str,
    operation: &'static str,
    plan_digest: &'a str,
    project_ref: &'a str,
    provider_id: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CasLedgerInstallProjectScopeV1<'a> {
    project_ref: &'a str,
    provider_id: &'a str,
}

fn cas_ledger_install_plan(
    material: &CasLedgerInstallPlanMaterialV1,
) -> Result<(TrustedOperationPlanV1, CasLedgerInstallJournalIdentityV1), JournalError> {
    validate_cas_ledger_install_material(material)?;
    let canonical = CasLedgerInstallCanonicalPlanV1 {
        account_id: &material.account_id,
        base_sql_digest: &material.base_sql_digest,
        environment: &material.environment,
        format: CAS_LEDGER_INSTALL_PLAN_FORMAT,
        install_review_digest: &material.install_review_digest,
        install_sql_digest: &material.install_sql_digest,
        ledger_shape_digest: &material.ledger_shape_digest,
        marker: &material.marker,
        marker_binding_digest: &material.marker_binding_digest,
        migration_name: &material.migration_name,
        project_ref: &material.project_ref,
        provider_id: &material.provider_id,
        read_grant_generation: &material.read_grant_generation,
        source_review_digest: &material.source_review_digest,
        verification_digest: &material.verification_digest,
        verification_query_digest: &material.verification_query_digest,
        version: 1,
        write_grant_generation: &material.write_grant_generation,
    };
    // The format field is the plan digest's domain separator and matches the TypeScript manifest.
    let plan_digest =
        digest_bytes(&serde_json::to_vec(&canonical).map_err(|_| JournalError::Invalid)?);
    let single_flight_key = digest_serialized(
        CAS_LEDGER_INSTALL_SINGLE_FLIGHT_DOMAIN,
        &CasLedgerInstallSingleFlightV1 {
            account_id: &material.account_id,
            operation: "backfill-database-cas-ledger-install",
            plan_digest: &plan_digest,
            project_ref: &material.project_ref,
            provider_id: &material.provider_id,
        },
    )?;
    let dispatch_scope_key = digest_serialized(
        CAS_LEDGER_INSTALL_SCOPE_DOMAIN,
        &CasLedgerInstallProjectScopeV1 {
            project_ref: &material.project_ref,
            provider_id: &material.provider_id,
        },
    )?;
    let identity = CasLedgerInstallJournalIdentityV1 {
        single_flight_key: single_flight_key.clone(),
        dispatch_scope_key: dispatch_scope_key.clone(),
        plan_digest: plan_digest.clone(),
    };
    Ok((
        TrustedOperationPlanV1 {
            single_flight_key,
            dispatch_scope_key,
            provider_id: material.provider_id.clone(),
            project_id: material.project_ref.clone(),
            operation_kind: OperationKindV1::SupabaseBackfillDatabaseCasLedgerInstall,
            release_id: format!("{CAS_LEDGER_INSTALL_RELEASE_PREFIX}{plan_digest}"),
            owner_id: CAS_LEDGER_INSTALL_OWNER.to_owned(),
            plan_digest,
        },
        identity,
    ))
}

fn validate_cas_ledger_install_material(
    material: &CasLedgerInstallPlanMaterialV1,
) -> Result<(), JournalError> {
    if material.provider_id != "supabase"
        || material.environment != "staging"
        || material.migration_name != CAS_LEDGER_INSTALL_MIGRATION_NAME
        || !is_exact_supabase_project_ref(&material.project_ref)
        || !is_canonical_uuid_v4(&material.read_grant_generation)
        || !is_canonical_uuid_v4(&material.write_grant_generation)
        || material.read_grant_generation == material.write_grant_generation
        || material.marker
            != format!(
                "{CAS_LEDGER_INSTALL_MARKER_PREFIX}{}",
                material.marker_binding_digest
            )
        || !validate_fixed_cas_ledger_install_artifacts(material)
    {
        return Err(JournalError::Invalid);
    }
    validate_cas_ledger_stable_id(&material.account_id, 128)?;
    for digest in [
        &material.install_review_digest,
        &material.source_review_digest,
        &material.verification_digest,
        &material.ledger_shape_digest,
        &material.base_sql_digest,
        &material.marker_binding_digest,
        &material.install_sql_digest,
        &material.verification_query_digest,
    ] {
        validate_digest(digest)?;
    }
    for value in [
        &material.provider_id,
        &material.environment,
        &material.project_ref,
        &material.account_id,
        &material.read_grant_generation,
        &material.write_grant_generation,
        &material.migration_name,
        &material.marker,
    ] {
        validate_cas_ledger_text(value, 256)?;
    }
    Ok(())
}

fn validate_cas_ledger_stable_id(value: &str, maximum: usize) -> Result<(), JournalError> {
    validate_cas_ledger_text(value, maximum)?;
    if !value.bytes().enumerate().all(|(index, byte)| {
        byte.is_ascii_alphanumeric() || (index > 0 && matches!(byte, b'.' | b'_' | b':' | b'-'))
    }) {
        return Err(JournalError::Invalid);
    }
    Ok(())
}

fn validate_cas_ledger_text(value: &str, maximum_utf16: usize) -> Result<(), JournalError> {
    if value.is_empty()
        || value.encode_utf16().count() > maximum_utf16
        || value
            .chars()
            .next()
            .is_some_and(is_ecmascript_trim_character)
        || value
            .chars()
            .next_back()
            .is_some_and(is_ecmascript_trim_character)
        || contains_secret_like_material(value)
    {
        return Err(JournalError::Invalid);
    }
    Ok(())
}

fn is_ecmascript_trim_character(value: char) -> bool {
    matches!(
        value,
        '\u{0009}'
            | '\u{000A}'
            | '\u{000B}'
            | '\u{000C}'
            | '\u{000D}'
            | '\u{0020}'
            | '\u{00A0}'
            | '\u{1680}'
            | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

fn is_exact_supabase_project_ref(value: &str) -> bool {
    value.len() == 20 && value.bytes().all(|byte| byte.is_ascii_lowercase())
}

fn is_canonical_uuid_v4(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => *byte == b'-',
            14 => *byte == b'4',
            19 => matches!(*byte, b'8' | b'9' | b'a' | b'b'),
            _ => byte.is_ascii_digit() || matches!(*byte, b'a'..=b'f'),
        })
}

fn derive_receipt_zero_initializer_identity(
    material: &ReceiptZeroInitializerClaimMaterialV1,
) -> Result<ValidatedReceiptZeroInitializerIdentityV1, JournalError> {
    validate_receipt_zero_initializer_material(material)?;
    let canonical = ReceiptZeroInitializerCanonicalPlanV1 {
        format: RECEIPT_ZERO_INITIALIZER_FORMAT,
        version: 1,
        material,
    };
    let plan_digest =
        digest_canonical_serialized(RECEIPT_ZERO_INITIALIZER_PLAN_DOMAIN, &canonical)?;
    let single_flight_key = receipt_zero_initializer_single_flight_key(&plan_digest)?;
    let capture = &material.capture;
    let dispatch_scope_key =
        receipt_zero_initializer_scope_key(&capture.provider_id, &capture.project_ref)?;
    Ok(ValidatedReceiptZeroInitializerIdentityV1 {
        single_flight_key,
        dispatch_scope_key,
        provider_id: capture.provider_id.clone(),
        project_id: capture.project_ref.clone(),
        release_id: format!("{RECEIPT_ZERO_INITIALIZER_RELEASE_PREFIX}{plan_digest}"),
        owner_id: RECEIPT_ZERO_INITIALIZER_OWNER.to_owned(),
        plan_digest,
    })
}

#[cfg(test)]
fn receipt_zero_initializer_plan(
    material: &ReceiptZeroInitializerClaimMaterialV1,
) -> Result<(TrustedOperationPlanV1, String), JournalError> {
    let identity = derive_receipt_zero_initializer_identity(material)?;
    let plan_digest = identity.plan_digest.clone();
    Ok((
        TrustedOperationPlanV1 {
            single_flight_key: identity.single_flight_key,
            dispatch_scope_key: identity.dispatch_scope_key,
            provider_id: identity.provider_id,
            project_id: identity.project_id,
            operation_kind: OperationKindV1::SupabaseBackfillReceiptZeroInitializer,
            release_id: identity.release_id,
            owner_id: identity.owner_id,
            plan_digest: identity.plan_digest,
        },
        plan_digest,
    ))
}

#[cfg(test)]
pub(crate) fn validate_receipt_zero_initializer_material_for_runner_for_test(
    material: &ReceiptZeroInitializerClaimMaterialV1,
) -> Result<(), JournalError> {
    validate_receipt_zero_initializer_material(material)
}

fn validate_receipt_zero_initializer_material(
    material: &ReceiptZeroInitializerClaimMaterialV1,
) -> Result<(), JournalError> {
    const MAXIMUM_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
    let source = &material.source;
    let installed = &material.installed;
    let inspection = &material.inspection;
    let capture = &material.capture;

    if source.provider_id != "supabase"
        || source.environment != "staging"
        || !is_exact_supabase_project_ref(&source.project_ref)
        || source.run_attempt == 0
        || source.run_attempt > MAXIMUM_SAFE_INTEGER
        || !is_canonical_uuid_v4(&capture.read_grant_generation)
        || !is_canonical_uuid_v4(&capture.install_write_grant_generation)
        || !is_canonical_uuid_v4(&capture.capture_write_grant_generation)
        || capture.read_grant_generation == capture.install_write_grant_generation
        || capture.read_grant_generation == capture.capture_write_grant_generation
        || capture.install_write_grant_generation == capture.capture_write_grant_generation
        || capture.source_ledger_subject_digest == capture.inspection_subject_digest
    {
        return Err(JournalError::Invalid);
    }
    for digest in [
        &source.provider_authority_digest,
        &source.application_digest,
        &source.migration_digest,
        &source.migration_plan_digest,
        &source.source_ledger_digest,
        &source.schema_digest,
        &source.subject_digest,
        &source.attestation_digest,
        &source.payload_digest,
        &source.expectation_digest,
        &source.scope_digest,
        &source.db_push_command_digest,
        &source.db_push_receipt_digest,
        &source.database_history_digest,
        &installed.install_review_digest,
        &installed.source_review_digest,
        &installed.verification_digest,
        &installed.ledger_shape_digest,
        &installed.base_sql_digest,
        &installed.marker_binding_digest,
        &installed.install_sql_digest,
        &installed.verification_query_digest,
        &installed.installed_verification_digest,
        &inspection.provider_authority_digest,
        &inspection.application_digest,
        &inspection.migration_digest,
        &inspection.migration_plan_digest,
        &inspection.inspection_subject_digest,
        &capture.provider_authority_digest,
        &capture.application_digest,
        &capture.migration_digest,
        &capture.migration_plan_digest,
        &capture.source_ledger_digest,
        &capture.source_scope_digest,
        &capture.schema_digest,
        &capture.source_ledger_subject_digest,
        &capture.inspection_subject_digest,
        &capture.attestation_digest,
        &capture.source_review_digest,
        &capture.install_plan_digest,
        &capture.install_review_digest,
        &capture.marker_binding_digest,
        &capture.installed_verification_digest,
        &capture.capture_review_digest,
        &capture.catalog_precondition_digest,
        &capture.query_digest,
        &capture.capture_digest,
    ] {
        validate_digest(digest)?;
    }
    for identifier in [
        &source.account_id,
        &source.grant_generation,
        &source.application_id,
        &source.migration_id,
        &source.ci_provider,
        &source.workflow,
        &source.run_id,
        &source.revision,
        &inspection.table_name,
        &inspection.cursor_field,
        &inspection.target_field,
    ] {
        validate_secret_free_stable_id(identifier)?;
    }
    for text in [&source.repository, &source.protected_ref] {
        if text.is_empty()
            || text.encode_utf16().count() > 1_024
            || contains_secret_like_value(text)
            || contains_secret_like_material(text)
        {
            return Err(JournalError::Invalid);
        }
    }

    let install_plan = CasLedgerInstallPlanMaterialV1 {
        provider_id: installed.provider_id.clone(),
        environment: installed.environment.clone(),
        project_ref: installed.project_ref.clone(),
        account_id: installed.account_id.clone(),
        read_grant_generation: installed.read_grant_generation.clone(),
        write_grant_generation: installed.write_grant_generation.clone(),
        migration_name: installed.migration_name.clone(),
        install_review_digest: installed.install_review_digest.clone(),
        source_review_digest: installed.source_review_digest.clone(),
        verification_digest: installed.verification_digest.clone(),
        ledger_shape_digest: installed.ledger_shape_digest.clone(),
        base_sql_digest: installed.base_sql_digest.clone(),
        marker: installed.marker.clone(),
        marker_binding_digest: installed.marker_binding_digest.clone(),
        install_sql_digest: installed.install_sql_digest.clone(),
        verification_query_digest: installed.verification_query_digest.clone(),
    };
    let (_, install_identity) = cas_ledger_install_plan(&install_plan)?;
    if !initializer_valid_timestamp(&installed.observed_at)
        || !initializer_valid_snapshot_marker(&installed.snapshot_marker)
        || !initializer_valid_server_version(&installed.server_version_num)
    {
        return Err(JournalError::Invalid);
    }

    if source.provider_id != capture.provider_id
        || source.environment != capture.environment
        || source.project_ref != capture.project_ref
        || source.account_id != capture.account_id
        || source.grant_generation != capture.source_grant_generation
        || source.provider_authority_digest != capture.provider_authority_digest
        || source.application_id != capture.application_id
        || source.application_digest != capture.application_digest
        || source.migration_id != capture.migration_id
        || source.migration_digest != capture.migration_digest
        || source.migration_plan_digest != capture.migration_plan_digest
        || source.source_ledger_digest != capture.source_ledger_digest
        || source.scope_digest != capture.source_scope_digest
        || source.schema_digest != capture.schema_digest
        || source.subject_digest != capture.source_ledger_subject_digest
        || source.attestation_digest != capture.attestation_digest
        || inspection.provider_id != capture.provider_id
        || inspection.provider_authority_digest != capture.provider_authority_digest
        || inspection.application_id != capture.application_id
        || inspection.application_digest != capture.application_digest
        || inspection.migration_id != capture.migration_id
        || inspection.migration_digest != capture.migration_digest
        || inspection.migration_plan_digest != capture.migration_plan_digest
        || inspection.inspection_subject_digest != capture.inspection_subject_digest
        || inspection.table_name != capture.table_name
        || inspection.cursor_field != capture.cursor_field
        || inspection.target_field != capture.target_field
        || inspection.maximum_cursor != capture.maximum_cursor
        || inspection.batch_size != capture.batch_size
        || inspection.maximum_batch_receipt_count != capture.maximum_batch_receipt_count
        || installed.provider_id != capture.provider_id
        || installed.environment != capture.environment
        || installed.project_ref != capture.project_ref
        || installed.account_id != capture.account_id
        || installed.read_grant_generation != capture.read_grant_generation
        || installed.write_grant_generation != capture.install_write_grant_generation
        || installed.source_review_digest != capture.source_review_digest
        || installed.install_review_digest != capture.install_review_digest
        || installed.marker_binding_digest != capture.marker_binding_digest
        || installed.installed_verification_digest != capture.installed_verification_digest
        || install_identity.plan_digest != capture.install_plan_digest
        || installed.server_version_num != capture.server_version_num
    {
        return Err(JournalError::Invalid);
    }
    if capture.observed_at < installed.observed_at {
        return Err(JournalError::Invalid);
    }
    validate_receipt_zero_initializer_capture(capture)?;
    validate_receipt_zero_initializer_transaction(material)
}

fn validate_receipt_zero_initializer_capture(
    capture: &ReceiptZeroInitializerCaptureMaterialV1,
) -> Result<(), JournalError> {
    const MAXIMUM_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
    const MAXIMUM_BATCH_RECEIPT_COUNT: u64 = 9_999;
    if capture.schema_name != "public"
        || !valid_oid(&capture.schema_oid)
        || !valid_oid(&capture.table_oid)
        || capture.cursor_sub_id == 0
        || !valid_oid(&capture.cursor_type_oid)
        || capture.target_sub_id == 0
        || !valid_oid(&capture.target_type_oid)
        || !valid_oid(&capture.primary_key_oid)
        || !valid_oid(&capture.sequence_oid)
        || !valid_oid(&capture.barrier_constraint_oid)
        || capture.statement_count != 10
        || capture.access_mode != "read-write-locked-read"
        || capture.snapshot_scope != "explicit-serializable-transaction"
        || capture.lock_mode != "share-row-exclusive"
        || capture.transaction_isolation != "serializable"
        || capture.transaction_read_only
        || capture.row_security
        || capture.search_path != "pg_catalog"
        || !capture.database_primary
        || !capture.query_bindings_match
        || !capture.current_and_session_role_match
        || !capture.full_table_read_authority_observed
        || !capture.exact_address_matches
        || !capture.cursor_range_safe
        || !capture.receipt_capacity_fits
        || !capture.all_capture_checks_passed
        || !initializer_valid_timestamp(&capture.observed_at)
        || !initializer_valid_snapshot_marker(&capture.snapshot_marker)
        || !initializer_valid_server_version(&capture.server_version_num)
        || capture.maximum_cursor != MAXIMUM_SAFE_INTEGER
        || capture.total_row_count > MAXIMUM_SAFE_INTEGER
        || capture.remaining_null_target_row_count > capture.total_row_count
        || capture.unsafe_cursor_row_count != 0
        || capture.batch_size == 0
        || capture.batch_size > 1_000
        || capture.maximum_batch_receipt_count != MAXIMUM_BATCH_RECEIPT_COUNT
        || capture.required_batch_receipt_count > capture.maximum_batch_receipt_count
    {
        return Err(JournalError::Invalid);
    }
    for identifier in [
        &capture.account_id,
        &capture.source_grant_generation,
        &capture.application_id,
        &capture.migration_id,
        &capture.table_name,
        &capture.cursor_field,
        &capture.target_field,
    ] {
        validate_secret_free_stable_id(identifier)?;
    }
    let has_rows = capture.total_row_count > 0;
    if has_rows != capture.captured_high_water.is_some()
        || has_rows != capture.minimum_cursor.is_some()
    {
        return Err(JournalError::Invalid);
    }
    if let (Some(high), Some(minimum)) = (capture.captured_high_water, capture.minimum_cursor) {
        if high > capture.maximum_cursor
            || minimum > high
            || high
                .checked_sub(minimum)
                .and_then(|span| span.checked_add(1))
                .is_none_or(|span| capture.total_row_count > span)
        {
            return Err(JournalError::Invalid);
        }
    }
    let batch_size = u64::from(capture.batch_size);
    let required = if capture.total_row_count == 0 {
        0
    } else {
        capture
            .total_row_count
            .checked_add(batch_size - 1)
            .ok_or(JournalError::Invalid)?
            / batch_size
    };
    if capture.required_batch_receipt_count != required {
        return Err(JournalError::Invalid);
    }
    Ok(())
}

fn validate_receipt_zero_initializer_transaction(
    material: &ReceiptZeroInitializerClaimMaterialV1,
) -> Result<(), JournalError> {
    const MAXIMUM_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
    let transaction = &material.transaction;
    let parameters = &transaction.parameters;
    let source = &material.source;
    let installed = &material.installed;
    let inspection = &material.inspection;
    let capture = &material.capture;

    if transaction.format != RECEIPT_ZERO_TRANSACTION_FORMAT
        || transaction.version != 1
        || transaction.query_id != RECEIPT_ZERO_CAS_QUERY_ID
        || transaction.query_version != RECEIPT_ZERO_CAS_QUERY_VERSION
        || transaction.statement_count != 1
        || transaction.isolation != "serializable"
        || transaction.access_mode != "read-write"
        || transaction.transaction_sql_digest != RECEIPT_ZERO_CAS_SQL_DIGEST
        || transaction.parameter_schema_digest != RECEIPT_ZERO_CAS_PARAMETER_SCHEMA_DIGEST
    {
        return Err(JournalError::Invalid);
    }
    for digest in [
        &transaction.transaction_sql_digest,
        &transaction.parameter_schema_digest,
        &transaction.parameter_values_digest,
        &parameters.application_digest,
        &parameters.migration_digest,
        &parameters.migration_plan_digest,
        &parameters.provider_authority_digest,
        &parameters.source_ledger_digest,
        &parameters.scope_digest,
        &parameters.resource_identity_digest,
        &parameters.catalog_precondition_digest,
        &parameters.capture_digest,
        &parameters.request_digest,
        &parameters.receipt_digest,
        &parameters.unauthenticated_operation_evidence_digest,
    ] {
        validate_digest(digest)?;
    }
    validate_receipt_zero_generated_identifier(&parameters.execution_id, "execution:")?;
    validate_receipt_zero_generated_identifier(&parameters.event_id, "event:")?;
    validate_receipt_zero_generated_identifier(&parameters.receipt_id, "receipt:")?;
    validate_receipt_zero_generated_identifier(&parameters.idempotency_key, "receipt-zero:")?;
    validate_receipt_zero_precommit_identifier(&parameters.application_id)?;
    validate_receipt_zero_precommit_identifier(&parameters.migration_id)?;
    if !initializer_valid_timestamp(&parameters.candidate_committed_at)
        || parameters.candidate_committed_at < installed.observed_at
        || parameters.candidate_committed_at < capture.observed_at
        || parameters.captured_high_water != capture.captured_high_water
        || parameters.initial_remaining_eligible_row_count != capture.total_row_count
        || parameters.initial_remaining_target_row_count != capture.remaining_null_target_row_count
        || parameters
            .required_matched_row_count
            .is_some_and(|required| required > parameters.initial_remaining_target_row_count)
        || u64::from(parameters.required_batch_count) != capture.required_batch_receipt_count
        || parameters.batch_size != capture.batch_size
        || parameters.initial_remaining_eligible_row_count > MAXIMUM_SAFE_INTEGER
        || parameters.initial_remaining_target_row_count > MAXIMUM_SAFE_INTEGER
        || parameters
            .required_matched_row_count
            .is_some_and(|value| value > MAXIMUM_SAFE_INTEGER)
        || parameters.application_id != source.application_id
        || parameters.application_digest != source.application_digest
        || parameters.migration_id != source.migration_id
        || parameters.migration_digest != source.migration_digest
        || parameters.migration_plan_digest != source.migration_plan_digest
        || parameters.provider_authority_digest != source.provider_authority_digest
        || parameters.source_ledger_digest != source.source_ledger_digest
        || parameters.catalog_precondition_digest != capture.catalog_precondition_digest
        || parameters.capture_digest != capture.capture_digest
        || parameters.application_id != inspection.application_id
        || parameters.application_digest != inspection.application_digest
        || parameters.migration_id != inspection.migration_id
        || parameters.migration_digest != inspection.migration_digest
        || parameters.migration_plan_digest != inspection.migration_plan_digest
    {
        return Err(JournalError::Invalid);
    }

    let expected_resource_identity_digest = receipt_zero_resource_identity_digest(capture)?;
    if parameters.resource_identity_digest != expected_resource_identity_digest {
        return Err(JournalError::Invalid);
    }
    let (scope, scope_bytes) = decode_receipt_zero_scope(parameters)?;
    let (receipt, receipt_bytes) = decode_receipt_zero_receipt(parameters)?;
    validate_receipt_zero_scope(&scope, material, &expected_resource_identity_digest)?;
    validate_receipt_zero_receipt(&receipt, &scope, material)?;
    if digest_bytes(&scope_bytes) != parameters.scope_digest
        || digest_bytes(&receipt_bytes) != parameters.receipt_digest
        || receipt.scope != scope
        || transaction.parameter_values_digest != receipt_zero_parameter_values_digest(parameters)?
    {
        return Err(JournalError::Invalid);
    }
    Ok(())
}

fn validate_receipt_zero_generated_identifier(
    value: &str,
    prefix: &str,
) -> Result<(), JournalError> {
    validate_receipt_zero_precommit_identifier(value)?;
    let digest = value.strip_prefix(prefix).ok_or(JournalError::Invalid)?;
    validate_digest(digest)
}

fn validate_receipt_zero_precommit_identifier(value: &str) -> Result<(), JournalError> {
    if value.len() <= 128
        && value
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._:-".contains(&byte))
    {
        Ok(())
    } else {
        Err(JournalError::Invalid)
    }
}

fn decode_receipt_zero_canonical_document<T>(value: &str) -> Result<(T, Vec<u8>), JournalError>
where
    T: for<'de> Deserialize<'de> + Serialize,
{
    if value.is_empty() || value.len() > RECEIPT_ZERO_MAXIMUM_PARAMETER_STRING_BYTES {
        return Err(JournalError::Invalid);
    }
    let bytes = STANDARD.decode(value).map_err(|_| JournalError::Invalid)?;
    if !(2..=RECEIPT_ZERO_MAXIMUM_CANONICAL_DOCUMENT_BYTES).contains(&bytes.len())
        || STANDARD.encode(&bytes) != value
    {
        return Err(JournalError::Invalid);
    }
    let document: T = serde_json::from_slice(&bytes).map_err(|_| JournalError::Invalid)?;
    if canonical_serialized_bytes(&document)? != bytes {
        return Err(JournalError::Invalid);
    }
    Ok((document, bytes))
}

fn decode_receipt_zero_scope(
    parameters: &ReceiptZeroInitializerTransactionParametersV1,
) -> Result<(ReceiptZeroScopeDocumentV2, Vec<u8>), JournalError> {
    decode_receipt_zero_canonical_document(&parameters.canonical_scope_base64)
}

fn decode_receipt_zero_receipt(
    parameters: &ReceiptZeroInitializerTransactionParametersV1,
) -> Result<(ReceiptZeroReceiptDocumentV2, Vec<u8>), JournalError> {
    decode_receipt_zero_canonical_document(&parameters.canonical_receipt_base64)
}

fn validate_receipt_zero_scope(
    scope: &ReceiptZeroScopeDocumentV2,
    material: &ReceiptZeroInitializerClaimMaterialV1,
    expected_resource_identity_digest: &str,
) -> Result<(), JournalError> {
    const MAXIMUM_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
    let source = &material.source;
    let inspection = &material.inspection;
    let capture = &material.capture;
    // `entityId` is a logical DataModel identifier from the reviewed V2 scope, not necessarily the
    // physical table name, and no native prerequisite currently carries an independent copy. Do
    // not invent an `entityId == tableName` binding here. This slice instead pins it inside the
    // canonical scope bytes, the embedded Receipt, the parameter-values digest, and the initializer
    // plan digest. A future production issuer must accept it only from the trusted V2 review
    // context; production still has no caller-data constructor for this material.
    if scope.format != "openpencil.backend-backfill-execution-scope"
        || scope.version != 2
        || scope.provider_id != "supabase"
        || scope.environment != "staging"
        || scope.provider_authority_digest != source.provider_authority_digest
        || scope.application_id != source.application_id
        || scope.application_digest != source.application_digest
        || scope.migration_id != source.migration_id
        || scope.migration_digest != source.migration_digest
        || scope.migration_plan_digest != source.migration_plan_digest
        || scope.source_ledger_digest != source.source_ledger_digest
        || scope.capture_digest != capture.capture_digest
        || scope.receipt_zero_evidence_digest != capture.capture_digest
        || scope.resource_identity_digest != expected_resource_identity_digest
        || scope.catalog_precondition_digest != capture.catalog_precondition_digest
        || scope.cursor_field != inspection.cursor_field
        || scope.cursor_field_type != "integer"
        || scope.target_field != inspection.target_field
        || scope.batch_size != u64::from(capture.batch_size)
        || scope.maximum_receipt_count != 10_000
        || scope.maximum_batch_count != capture.maximum_batch_receipt_count
        || scope.captured_high_water != capture.captured_high_water
        || scope.initial_remaining_eligible_row_count != capture.total_row_count
        || scope.initial_remaining_target_row_count != capture.remaining_null_target_row_count
        || scope.required_batch_count != capture.required_batch_receipt_count
        || scope
            .required_matched_row_count
            .is_some_and(|required| required > scope.initial_remaining_target_row_count)
        || scope.resume_policy != "from-receipt"
        || scope.completion_rule != "predicate-exhausted-and-postconditions-satisfied"
        || ![
            scope.captured_high_water.unwrap_or(0),
            scope.initial_remaining_eligible_row_count,
            scope.initial_remaining_target_row_count,
            scope.required_batch_count,
            scope.required_matched_row_count.unwrap_or(0),
        ]
        .into_iter()
        .all(|value| value <= MAXIMUM_SAFE_INTEGER)
    {
        return Err(JournalError::Invalid);
    }
    for identifier in [
        &scope.application_id,
        &scope.migration_id,
        &scope.entity_id,
        &scope.cursor_field,
        &scope.target_field,
    ] {
        // Mirror the portable Receipt V2 `releaseIdentifier` contract instead of silently
        // narrowing legitimate logical IDs containing `/` or `@`.
        validate_secret_free_stable_id(identifier)?;
    }
    for digest in [
        &scope.provider_authority_digest,
        &scope.application_digest,
        &scope.migration_digest,
        &scope.migration_plan_digest,
        &scope.source_ledger_digest,
        &scope.capture_digest,
        &scope.receipt_zero_evidence_digest,
        &scope.resource_identity_digest,
        &scope.catalog_precondition_digest,
    ] {
        validate_digest(digest)?;
    }
    Ok(())
}

fn validate_receipt_zero_counts(counts: &ReceiptZeroCountsDocumentV2) -> bool {
    counts.scanned_row_count == 0 && counts.matched_row_count == 0 && counts.updated_row_count == 0
}

fn validate_receipt_zero_receipt(
    receipt: &ReceiptZeroReceiptDocumentV2,
    scope: &ReceiptZeroScopeDocumentV2,
    material: &ReceiptZeroInitializerClaimMaterialV1,
) -> Result<(), JournalError> {
    let parameters = &material.transaction.parameters;
    let matched_satisfied = scope
        .required_matched_row_count
        .is_none_or(|required| required == 0);
    let field_not_null = scope.initial_remaining_target_row_count == 0;
    let initially_satisfied = field_not_null && matched_satisfied;
    let expected_status = if initially_satisfied {
        "completed"
    } else {
        "running"
    };
    let expected_outcome = if initially_satisfied {
        "completed"
    } else {
        "in-progress"
    };
    let expected_terminal_reason = initially_satisfied.then_some("already-satisfied");
    if receipt.format != "openpencil.backend-backfill-execution-receipt"
        || receipt.version != 2
        || receipt.receipt_id != parameters.receipt_id
        || receipt.execution_id != parameters.execution_id
        || receipt.idempotency_key != parameters.idempotency_key
        || receipt.request_digest != parameters.request_digest
        || receipt.scope_digest != parameters.scope_digest
        || receipt.checkpoint_kind != "capture"
        || receipt.batch_index != 0
        || receipt.previous_cursor.is_some()
        || receipt.last_processed_key.is_some()
        || !validate_receipt_zero_counts(&receipt.batch_counts)
        || !validate_receipt_zero_counts(&receipt.cumulative_counts)
        || !receipt.exhaustion.checked
        || receipt.exhaustion.remaining_eligible_row_count
            != Some(scope.initial_remaining_eligible_row_count)
        || receipt.exhaustion.remaining_target_row_count
            != Some(scope.initial_remaining_target_row_count)
        || receipt.postconditions.field_not_null != field_not_null
        || receipt.postconditions.required_matched_row_count != scope.required_matched_row_count
        || receipt.postconditions.matched_row_count_satisfied != matched_satisfied
        || receipt.outcome != expected_outcome
        || receipt.terminal_reason.as_deref() != expected_terminal_reason
        || receipt.stable_error_code.is_some()
        || receipt.previous_receipt_digest.is_some()
        || receipt.catalog_evidence_digest != scope.catalog_precondition_digest
        || receipt.operation_authority_digest
            != parameters.unauthenticated_operation_evidence_digest
        || receipt.database_event_id != parameters.event_id
        || receipt.database_head_version != 1
        || receipt.committed_at != parameters.candidate_committed_at
        || receipt.evidence_digest != scope.receipt_zero_evidence_digest
        || parameters.initial_execution_status != expected_status
    {
        return Err(JournalError::Invalid);
    }
    validate_receipt_zero_generated_identifier(&receipt.receipt_id, "receipt:")?;
    validate_receipt_zero_generated_identifier(&receipt.execution_id, "execution:")?;
    validate_receipt_zero_generated_identifier(&receipt.idempotency_key, "receipt-zero:")?;
    validate_receipt_zero_generated_identifier(&receipt.database_event_id, "event:")?;
    for digest in [
        &receipt.request_digest,
        &receipt.scope_digest,
        &receipt.catalog_evidence_digest,
        &receipt.operation_authority_digest,
        &receipt.evidence_digest,
    ] {
        validate_digest(digest)?;
    }
    if !initializer_valid_timestamp(&receipt.committed_at) {
        return Err(JournalError::Invalid);
    }
    Ok(())
}

fn receipt_zero_resource_identity_digest(
    capture: &ReceiptZeroInitializerCaptureMaterialV1,
) -> Result<String, JournalError> {
    canonical_manifest_digest(&ReceiptZeroResourceIdentityV1 {
        format: "openpencil.supabase-backfill-resource-identity.v1",
        project_ref: &capture.project_ref,
        address: ReceiptZeroResourceAddressV1 {
            schema_name: &capture.schema_name,
            schema_oid: &capture.schema_oid,
            table_name: &capture.table_name,
            table_oid: &capture.table_oid,
            cursor_field: &capture.cursor_field,
            cursor_sub_id: capture.cursor_sub_id,
            cursor_type_oid: &capture.cursor_type_oid,
            target_field: &capture.target_field,
            target_sub_id: capture.target_sub_id,
            target_type_oid: &capture.target_type_oid,
            primary_key_oid: &capture.primary_key_oid,
            sequence_oid: &capture.sequence_oid,
            barrier_constraint_oid: &capture.barrier_constraint_oid,
        },
    })
}

fn receipt_zero_parameter_values(
    parameters: &ReceiptZeroInitializerTransactionParametersV1,
) -> Vec<Value> {
    vec![
        Value::String(parameters.execution_id.clone()),
        Value::String(parameters.application_id.clone()),
        Value::String(parameters.application_digest.clone()),
        Value::String(parameters.migration_id.clone()),
        Value::String(parameters.migration_digest.clone()),
        Value::String(parameters.migration_plan_digest.clone()),
        Value::String(parameters.provider_authority_digest.clone()),
        Value::String(parameters.source_ledger_digest.clone()),
        Value::String(parameters.scope_digest.clone()),
        Value::String(parameters.resource_identity_digest.clone()),
        Value::String(parameters.catalog_precondition_digest.clone()),
        Value::String(parameters.canonical_scope_base64.clone()),
        Value::String(parameters.capture_digest.clone()),
        parameters
            .captured_high_water
            .map(|value| Value::String(value.to_string()))
            .unwrap_or(Value::Null),
        Value::String(parameters.initial_remaining_eligible_row_count.to_string()),
        Value::String(parameters.initial_remaining_target_row_count.to_string()),
        parameters
            .required_matched_row_count
            .map(|value| Value::String(value.to_string()))
            .unwrap_or(Value::Null),
        Value::String(parameters.required_batch_count.to_string()),
        Value::String(parameters.batch_size.to_string()),
        Value::String(parameters.initial_execution_status.clone()),
        Value::String(parameters.candidate_committed_at.clone()),
        Value::String(parameters.event_id.clone()),
        Value::String(parameters.receipt_id.clone()),
        Value::String(parameters.idempotency_key.clone()),
        Value::String(parameters.request_digest.clone()),
        Value::String(parameters.receipt_digest.clone()),
        Value::String(parameters.canonical_receipt_base64.clone()),
        Value::String(parameters.unauthenticated_operation_evidence_digest.clone()),
    ]
}

fn receipt_zero_parameter_values_digest(
    parameters: &ReceiptZeroInitializerTransactionParametersV1,
) -> Result<String, JournalError> {
    let values = receipt_zero_parameter_values(parameters);
    let aggregate_bytes = values.iter().try_fold(0_usize, |total, value| {
        let bytes = match value {
            Value::Null => 0,
            Value::String(value) => value.len(),
            _ => return Err(JournalError::Invalid),
        };
        total.checked_add(bytes).ok_or(JournalError::Invalid)
    })?;
    if aggregate_bytes > RECEIPT_ZERO_MAXIMUM_AGGREGATE_PARAMETER_BYTES {
        return Err(JournalError::Invalid);
    }
    canonical_manifest_digest(&ReceiptZeroParameterValuesDocumentV1 {
        format: RECEIPT_ZERO_CAS_PARAMETER_VALUES_FORMAT,
        version: 1,
        order: &RECEIPT_ZERO_CAS_PARAMETER_ORDER,
        values: &values,
    })
}

fn valid_oid(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 10
        && value.bytes().all(|byte| byte.is_ascii_digit())
        && (value == "0" || !value.starts_with('0'))
}

fn validate_secret_free_stable_id(value: &str) -> Result<(), JournalError> {
    validate_stable_id(value)?;
    if contains_secret_like_value(value) {
        return Err(JournalError::Invalid);
    }
    Ok(())
}

fn initializer_valid_timestamp(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 24
        || !bytes.iter().enumerate().all(|(index, byte)| match index {
            4 | 7 => *byte == b'-',
            10 => *byte == b'T',
            13 | 16 => *byte == b':',
            19 => *byte == b'.',
            23 => *byte == b'Z',
            _ => byte.is_ascii_digit(),
        })
    {
        return false;
    }
    let decimal = |range: std::ops::Range<usize>| {
        bytes[range].iter().try_fold(0_u32, |value, byte| {
            byte.is_ascii_digit()
                .then(|| value * 10 + u32::from(byte - b'0'))
        })
    };
    let Some(year) = decimal(0..4) else {
        return false;
    };
    let Some(month) = decimal(5..7) else {
        return false;
    };
    let Some(day) = decimal(8..10) else {
        return false;
    };
    let Some(hour) = decimal(11..13) else {
        return false;
    };
    let Some(minute) = decimal(14..16) else {
        return false;
    };
    let Some(second) = decimal(17..19) else {
        return false;
    };
    let Some(millisecond) = decimal(20..23) else {
        return false;
    };
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 400 == 0 || (year % 4 == 0 && year % 100 != 0) => 29,
        2 => 28,
        _ => 0,
    };
    year > 0
        && day > 0
        && day <= days
        && hour <= 23
        && minute <= 59
        && second <= 59
        && millisecond <= 999
}

fn initializer_valid_snapshot_marker(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 512
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b':' | b','))
}

fn initializer_valid_server_version(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 6
        && matches!(bytes.get(..2), Some(b"15" | b"16" | b"17"))
        && bytes.iter().all(u8::is_ascii_digit)
}

fn source_ledger_admission_plan(
    material: &SourceLedgerAdmissionClaimMaterialV1,
) -> Result<TrustedOperationPlanV1, JournalError> {
    validate_source_ledger_admission_material(material)?;
    let binding = SourceLedgerAdmissionBindingV1 {
        format: SOURCE_LEDGER_ADMISSION_FORMAT,
        version: 1,
        provider_id: &material.provider_id,
        environment: &material.environment,
        project_ref: &material.project_ref,
        account_id: &material.account_id,
        grant_generation: &material.grant_generation,
        provider_authority_digest: &material.provider_authority_digest,
        application_id: &material.application_id,
        application_digest: &material.application_digest,
        migration_id: &material.migration_id,
        migration_digest: &material.migration_digest,
        migration_plan_digest: &material.migration_plan_digest,
        source_ledger_digest: &material.source_ledger_digest,
        schema_digest: &material.schema_digest,
        subject_digest: &material.subject_digest,
        attestation_digest: &material.attestation_digest,
        payload_digest: &material.payload_digest,
        expectation_digest: &material.expectation_digest,
        verified_scope_digest: &material.scope_digest,
        ci_provider: &material.ci_provider,
        repository: &material.repository,
        workflow: &material.workflow,
        run_id: &material.run_id,
        run_attempt: material.run_attempt,
        protected_ref: &material.protected_ref,
        revision: &material.revision,
        db_push_command_digest: &material.db_push_command_digest,
        db_push_receipt_digest: &material.db_push_receipt_digest,
        database_history_digest: &material.database_history_digest,
    };
    let scope = SourceLedgerAdmissionScopeV1 {
        format: SOURCE_LEDGER_ADMISSION_FORMAT,
        version: 1,
        provider_id: &material.provider_id,
        environment: &material.environment,
        project_ref: &material.project_ref,
        account_id: &material.account_id,
        grant_generation: &material.grant_generation,
        provider_authority_digest: &material.provider_authority_digest,
        application_id: &material.application_id,
        application_digest: &material.application_digest,
        migration_id: &material.migration_id,
        migration_digest: &material.migration_digest,
        migration_plan_digest: &material.migration_plan_digest,
        source_ledger_digest: &material.source_ledger_digest,
        schema_digest: &material.schema_digest,
    };
    let single_flight_key = digest_serialized(
        b"openpencil.native-source-ledger-admission-single-flight-v1",
        &binding,
    )?;
    let dispatch_scope_key = digest_serialized(
        b"openpencil.native-source-ledger-admission-scope-v1",
        &scope,
    )?;
    let plan_digest = digest_serialized(
        b"openpencil.native-source-ledger-admission-plan-v1",
        &binding,
    )?;
    Ok(TrustedOperationPlanV1 {
        single_flight_key,
        dispatch_scope_key,
        provider_id: material.provider_id.clone(),
        project_id: material.project_ref.clone(),
        operation_kind: OperationKindV1::SupabaseBackfillReceiptZeroAdmission,
        release_id: format!("source-ledger-admission:{}", material.payload_digest),
        owner_id: SOURCE_LEDGER_ADMISSION_OWNER.to_owned(),
        plan_digest,
    })
}

fn validate_source_ledger_admission_material(
    material: &SourceLedgerAdmissionClaimMaterialV1,
) -> Result<(), JournalError> {
    if material.provider_id != "supabase"
        || material.environment != "staging"
        || !is_supabase_project_ref(&material.project_ref)
        || material.run_attempt == 0
    {
        return Err(JournalError::Invalid);
    }
    for digest in [
        &material.provider_authority_digest,
        &material.application_digest,
        &material.migration_digest,
        &material.migration_plan_digest,
        &material.source_ledger_digest,
        &material.schema_digest,
        &material.subject_digest,
        &material.attestation_digest,
        &material.payload_digest,
        &material.expectation_digest,
        &material.scope_digest,
        &material.db_push_command_digest,
        &material.db_push_receipt_digest,
        &material.database_history_digest,
    ] {
        validate_digest(digest)?;
    }
    for identifier in [
        &material.account_id,
        &material.grant_generation,
        &material.application_id,
        &material.migration_id,
        &material.ci_provider,
        &material.workflow,
        &material.run_id,
        &material.revision,
    ] {
        validate_stable_id(identifier)?;
    }
    for text in [&material.repository, &material.protected_ref] {
        // These already passed the verifier's ECMAScript/UTF-16 text contract and are hashed, not
        // persisted. Do not narrow that portable contract here (the cross-language fixture
        // intentionally contains JSON-escaped control and Unicode characters).
        if text.is_empty()
            || text.encode_utf16().count() > 1_024
            || contains_secret_like_value(text)
        {
            return Err(JournalError::Invalid);
        }
    }
    Ok(())
}

fn digest_serialized<T: Serialize>(domain: &[u8], value: &T) -> Result<String, JournalError> {
    let bytes = serde_json::to_vec(value).map_err(|_| JournalError::Invalid)?;
    let mut digest = Sha256::new();
    digest.update(domain);
    digest.update([0]);
    digest.update(bytes);
    Ok(URL_SAFE_NO_PAD.encode(digest.finalize()))
}

/// Matches the recursively sorted ASCII-key manifest encoding used by the TypeScript host. The
/// initializer structs intentionally do not rely on Rust declaration order for their authority
/// digest.
fn canonical_serialized_bytes<T: Serialize>(value: &T) -> Result<Vec<u8>, JournalError> {
    fn write(value: &Value, output: &mut String) -> Result<(), JournalError> {
        match value {
            Value::Null => output.push_str("null"),
            Value::Bool(value) => output.push_str(if *value { "true" } else { "false" }),
            Value::Number(value) => output.push_str(&value.to_string()),
            Value::String(value) => {
                output.push_str(&serde_json::to_string(value).map_err(|_| JournalError::Invalid)?)
            }
            Value::Array(values) => {
                output.push('[');
                for (index, value) in values.iter().enumerate() {
                    if index > 0 {
                        output.push(',');
                    }
                    write(value, output)?;
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
                    output
                        .push_str(&serde_json::to_string(key).map_err(|_| JournalError::Invalid)?);
                    output.push(':');
                    write(value, output)?;
                }
                output.push('}');
            }
        }
        Ok(())
    }

    let value = serde_json::to_value(value).map_err(|_| JournalError::Invalid)?;
    let mut canonical = String::new();
    write(&value, &mut canonical)?;
    Ok(canonical.into_bytes())
}

fn canonical_manifest_digest<T: Serialize>(value: &T) -> Result<String, JournalError> {
    Ok(digest_bytes(&canonical_serialized_bytes(value)?))
}

fn digest_canonical_serialized<T: Serialize>(
    domain: &[u8],
    value: &T,
) -> Result<String, JournalError> {
    let canonical = canonical_serialized_bytes(value)?;
    let mut digest = Sha256::new();
    digest.update(domain);
    digest.update([0]);
    digest.update(canonical);
    Ok(URL_SAFE_NO_PAD.encode(digest.finalize()))
}

#[cfg(test)]
fn receipt_zero_initializer_reconciliation_authority_digest(
    authority_id: &[u8; CAPABILITY_BYTES],
    single_flight_key: &str,
    lease_generation: u64,
) -> Result<String, JournalError> {
    validate_digest(single_flight_key)?;
    if lease_generation == 0 {
        return Err(JournalError::Invalid);
    }
    let mut digest = Sha256::new();
    digest.update(RECEIPT_ZERO_INITIALIZER_RECONCILIATION_AUTHORITY_DOMAIN);
    digest.update([0]);
    digest.update(authority_id);
    digest.update([0]);
    digest.update(single_flight_key.as_bytes());
    digest.update([0]);
    digest.update(lease_generation.to_be_bytes());
    Ok(URL_SAFE_NO_PAD.encode(digest.finalize()))
}

fn apply_terminal(
    record: &mut BackendOperationRecordV1,
    outcome: OperationStateV1,
    code: Option<&str>,
    evidence: OperationEvidenceV1,
) -> Result<(), JournalError> {
    require_mutation_operation_kind(record.operation_kind)?;
    if !matches!(
        outcome,
        OperationStateV1::Applied | OperationStateV1::Failed
    ) {
        return Err(JournalError::InvalidState);
    }
    if (outcome == OperationStateV1::Applied) != code.is_none() {
        return Err(JournalError::Invalid);
    }
    if let Some(code) = code {
        validate_code(code)?;
    }
    record.revision = record.revision.checked_add(1).ok_or(JournalError::Full)?;
    record.state = outcome;
    record.transitioned_at_unix_ms = Some(evidence.recorded_at_unix_ms);
    record.code = code.map(str::to_owned);
    record.final_evidence = Some(evidence);
    record.reconciliation_lease = None;
    validate_record(record)
}

fn is_terminal_state(state: OperationStateV1) -> bool {
    matches!(state, OperationStateV1::Applied | OperationStateV1::Failed)
}

fn terminal_tombstone(
    record: BackendOperationRecordV1,
    archived_generation: u64,
) -> Result<BackendOperationTombstoneV1, JournalError> {
    if !is_terminal_state(record.state) || archived_generation == 0 {
        return Err(JournalError::InvalidState);
    }
    let record_digest = record_digest(&record)?;
    let tombstone = BackendOperationTombstoneV1 {
        format: TOMBSTONE_FORMAT.to_owned(),
        version: TOMBSTONE_VERSION,
        record,
        record_digest,
        archived_generation,
    };
    validate_tombstone(&tombstone)?;
    Ok(tombstone)
}

fn archive_terminal_records(body: &mut JournalBodyV1) -> Result<usize, JournalError> {
    let terminal_keys: Vec<_> = body
        .records
        .iter()
        .filter_map(|(key, record)| is_terminal_state(record.state).then(|| key.clone()))
        .collect();
    if terminal_keys.is_empty() {
        return Ok(0);
    }
    if body
        .tombstones
        .len()
        .checked_add(terminal_keys.len())
        .map_or(true, |total| total > MAX_TOMBSTONES)
    {
        return Err(JournalError::Full);
    }
    let next_generation = body.generation.checked_add(1).ok_or(JournalError::Full)?;
    for key in &terminal_keys {
        if body.tombstones.contains_key(key) {
            return Err(JournalError::Corrupt);
        }
        let record = body.records.remove(key).ok_or(JournalError::Corrupt)?;
        body.tombstones
            .insert(key.clone(), terminal_tombstone(record, next_generation)?);
    }
    body.generation = next_generation;
    validate_body(body)?;
    Ok(terminal_keys.len())
}

fn exact_record<'a>(
    body: &'a JournalBodyV1,
    binding: &CapabilityBindingV1,
) -> Result<&'a BackendOperationRecordV1, JournalError> {
    let record = body
        .records
        .get(&binding.single_flight_key)
        .ok_or(JournalError::Conflict)?;
    if record.operation_kind != binding.operation_kind
        || record_digest(record)? != binding.record_digest
    {
        return Err(JournalError::Conflict);
    }
    Ok(record)
}

fn exact_record_mut<'a>(
    body: &'a mut JournalBodyV1,
    binding: &CapabilityBindingV1,
) -> Result<&'a mut BackendOperationRecordV1, JournalError> {
    let record = body
        .records
        .get_mut(&binding.single_flight_key)
        .ok_or(JournalError::Conflict)?;
    if record.operation_kind != binding.operation_kind
        || record_digest(record)? != binding.record_digest
    {
        return Err(JournalError::Conflict);
    }
    Ok(record)
}

fn require_mutation_operation_kind(kind: OperationKindV1) -> Result<(), JournalError> {
    if matches!(
        kind,
        OperationKindV1::SupabaseAutomationIdempotencyCas
            | OperationKindV1::SupabaseBackfillDatabaseCasLedgerInstall
    ) {
        Ok(())
    } else {
        Err(JournalError::InvalidState)
    }
}

fn burn_runtime_id(
    runtime: &mut RuntimeAuthoritiesV1,
    id: [u8; CAPABILITY_BYTES],
    expires_at: Duration,
) {
    runtime
        .burned
        .entry(id)
        .and_modify(|current| *current = (*current).max(expires_at))
        .or_insert(expires_at);
}

fn runtime_contains_id(runtime: &RuntimeAuthoritiesV1, id: &[u8; CAPABILITY_BYTES]) -> bool {
    runtime.burned.contains_key(id) || runtime_active_contains_id(runtime, id)
}

fn runtime_active_contains_id(runtime: &RuntimeAuthoritiesV1, id: &[u8; CAPABILITY_BYTES]) -> bool {
    runtime.reserved.contains_key(id)
        || runtime.claims.contains_key(id)
        || runtime.permits.contains_key(id)
        || runtime.dispatch_attempts.contains_key(id)
        || runtime.dispatch_settlements.contains_key(id)
        || runtime.known_not_dispatched.contains_key(id)
        || runtime.recoveries.contains_key(id)
        || runtime.reconciliation_permits.contains_key(id)
        || runtime.reconciliation_observations.contains_key(id)
}

fn ensure_transfer_slot_available(
    runtime: &RuntimeAuthoritiesV1,
    id: &[u8; CAPABILITY_BYTES],
) -> Result<(), JournalError> {
    if runtime_active_contains_id(runtime, id) {
        Err(JournalError::Unavailable)
    } else {
        Ok(())
    }
}

fn runtime_id_count(runtime: &RuntimeAuthoritiesV1) -> usize {
    let mut ids = HashSet::new();
    ids.extend(runtime.reserved.keys().copied());
    ids.extend(runtime.burned.keys().copied());
    ids.extend(runtime.claims.keys().copied());
    ids.extend(runtime.permits.keys().copied());
    ids.extend(runtime.dispatch_attempts.keys().copied());
    ids.extend(runtime.dispatch_settlements.keys().copied());
    ids.extend(runtime.known_not_dispatched.keys().copied());
    ids.extend(runtime.recoveries.keys().copied());
    ids.extend(runtime.reconciliation_permits.keys().copied());
    ids.extend(runtime.reconciliation_observations.keys().copied());
    ids.len()
}

fn purge_expired_runtime_authorities(runtime: &mut RuntimeAuthoritiesV1, now: Duration) {
    runtime.reserved.retain(|_, expires_at| *expires_at > now);
    runtime.burned.retain(|_, expires_at| *expires_at > now);
    runtime
        .claims
        .retain(|_, binding| binding.expires_at_monotonic > now);
    runtime
        .permits
        .retain(|_, binding| binding.expires_at_monotonic > now);
    runtime
        .dispatch_attempts
        .retain(|_, binding| binding.expires_at_monotonic > now);
    runtime
        .dispatch_settlements
        .retain(|_, binding| binding.expires_at_monotonic > now);
    runtime
        .known_not_dispatched
        .retain(|_, binding| binding.expires_at_monotonic > now);
    runtime
        .recoveries
        .retain(|_, (binding, _)| binding.expires_at_monotonic > now);
    runtime
        .reconciliation_permits
        .retain(|_, binding| binding.binding.expires_at_monotonic > now);
    runtime
        .reconciliation_observations
        .retain(|_, binding| binding.binding.expires_at_monotonic > now);
}

fn unresolved_scope_conflict<'a>(
    mut records: impl Iterator<Item = &'a BackendOperationRecordV1>,
    candidate: &BackendOperationRecordV1,
) -> bool {
    records.any(|record| {
        record.single_flight_key != candidate.single_flight_key
            && unresolved_records_conflict(record, candidate)
    })
}

fn unresolved_records_conflict(
    left: &BackendOperationRecordV1,
    right: &BackendOperationRecordV1,
) -> bool {
    if !matches!(
        left.state,
        OperationStateV1::Claimed | OperationStateV1::OutcomeUnknown
    ) || !matches!(
        right.state,
        OperationStateV1::Claimed | OperationStateV1::OutcomeUnknown
    ) {
        return false;
    }
    match (left.operation_kind, right.operation_kind) {
        (
            OperationKindV1::SupabaseAutomationIdempotencyCas,
            OperationKindV1::SupabaseAutomationIdempotencyCas,
        ) => left.dispatch_scope_key == right.dispatch_scope_key,
        (
            OperationKindV1::SupabaseBackfillReceiptZeroAdmission,
            OperationKindV1::SupabaseBackfillReceiptZeroAdmission,
        ) => left.dispatch_scope_key == right.dispatch_scope_key,
        (
            OperationKindV1::SupabaseBackfillDatabaseCasLedgerInstall,
            OperationKindV1::SupabaseBackfillDatabaseCasLedgerInstall,
        ) => left.provider_id == right.provider_id && left.project_id == right.project_id,
        (
            OperationKindV1::SupabaseBackfillReceiptZeroInitializer,
            OperationKindV1::SupabaseBackfillReceiptZeroInitializer,
        ) => left.provider_id == right.provider_id && left.project_id == right.project_id,
        (
            OperationKindV1::SupabaseBackfillReceiptZeroInitializer,
            OperationKindV1::SupabaseBackfillDatabaseCasLedgerInstall,
        )
        | (
            OperationKindV1::SupabaseBackfillDatabaseCasLedgerInstall,
            OperationKindV1::SupabaseBackfillReceiptZeroInitializer,
        ) => left.provider_id == right.provider_id && left.project_id == right.project_id,
        _ => false,
    }
}

fn validate_plan(plan: &TrustedOperationPlanV1) -> Result<(), JournalError> {
    validate_digest(&plan.single_flight_key)?;
    validate_digest(&plan.dispatch_scope_key)?;
    validate_stable_id(&plan.provider_id)?;
    validate_stable_id(&plan.project_id)?;
    validate_stable_id(&plan.release_id)?;
    validate_stable_id(&plan.owner_id)?;
    validate_digest(&plan.plan_digest)?;
    match plan.operation_kind {
        OperationKindV1::SupabaseAutomationIdempotencyCas => {
            validate_automation_cas_record_identity(
                &plan.single_flight_key,
                &plan.provider_id,
                &plan.project_id,
                &plan.release_id,
                &plan.owner_id,
                &plan.plan_digest,
            )?;
        }
        OperationKindV1::SupabaseBackfillDatabaseCasLedgerInstall => {
            if plan.provider_id != "supabase" || !is_supabase_project_ref(&plan.project_id) {
                return Err(JournalError::Invalid);
            }
        }
        OperationKindV1::SupabaseBackfillReceiptZeroAdmission => {
            validate_source_ledger_admission_record_identity(
                &plan.provider_id,
                &plan.project_id,
                &plan.release_id,
                &plan.owner_id,
            )?;
        }
        OperationKindV1::SupabaseBackfillReceiptZeroInitializer => {
            validate_receipt_zero_initializer_record_identity(
                &plan.single_flight_key,
                &plan.dispatch_scope_key,
                &plan.provider_id,
                &plan.project_id,
                &plan.release_id,
                &plan.owner_id,
                &plan.plan_digest,
            )?;
        }
    }
    Ok(())
}

fn validate_record(record: &BackendOperationRecordV1) -> Result<(), JournalError> {
    validate_digest(&record.single_flight_key)?;
    validate_digest(&record.dispatch_scope_key)?;
    validate_stable_id(&record.provider_id)?;
    validate_stable_id(&record.project_id)?;
    validate_stable_id(&record.release_id)?;
    validate_stable_id(&record.owner_id)?;
    validate_digest(&record.plan_digest)?;
    match record.operation_kind {
        OperationKindV1::SupabaseAutomationIdempotencyCas => {
            validate_automation_cas_record_identity(
                &record.single_flight_key,
                &record.provider_id,
                &record.project_id,
                &record.release_id,
                &record.owner_id,
                &record.plan_digest,
            )
            .map_err(|_| JournalError::Corrupt)?;
            if record.state == OperationStateV1::OutcomeUnknown {
                automation_cas_material_from_outcome_unknown(record)?;
            } else if matches!(
                record.state,
                OperationStateV1::Applied | OperationStateV1::Failed
            ) {
                return Err(JournalError::Corrupt);
            }
        }
        OperationKindV1::SupabaseBackfillDatabaseCasLedgerInstall => {
            if record.provider_id != "supabase" || !is_supabase_project_ref(&record.project_id) {
                return Err(JournalError::Corrupt);
            }
        }
        OperationKindV1::SupabaseBackfillReceiptZeroAdmission => {
            validate_source_ledger_admission_record_identity(
                &record.provider_id,
                &record.project_id,
                &record.release_id,
                &record.owner_id,
            )
            .map_err(|_| JournalError::Corrupt)?;
            if record.state != OperationStateV1::Claimed {
                return Err(JournalError::Corrupt);
            }
        }
        OperationKindV1::SupabaseBackfillReceiptZeroInitializer => {
            validate_receipt_zero_initializer_record_identity(
                &record.single_flight_key,
                &record.dispatch_scope_key,
                &record.provider_id,
                &record.project_id,
                &record.release_id,
                &record.owner_id,
                &record.plan_digest,
            )
            .map_err(|_| JournalError::Corrupt)?;
            match record.state {
                OperationStateV1::Claimed => {}
                OperationStateV1::OutcomeUnknown => {
                    let progress = record
                        .progress_evidence
                        .as_ref()
                        .ok_or(JournalError::Corrupt)?;
                    // The typed parser sees only evidence which has already passed its checksum,
                    // canonical JSON, global size, depth, node, string, and secret checks.
                    validate_evidence(progress, EvidencePhaseV1::Progress)
                        .map_err(|_| JournalError::Corrupt)?;
                    receipt_zero_initializer_material_from_outcome_unknown(record)?;
                    match record.reconciliation_lease.as_ref() {
                        None if record.revision == 2 => {}
                        None => return Err(JournalError::Corrupt),
                        Some(lease) => {
                            // Each generation adds one durable begin revision and may add one
                            // durable consume revision. Earlier generations may have expired either
                            // before or after consumption, so the legal cumulative range is
                            // intentionally bounded rather than a single formula.
                            let doubled_generation = lease
                                .generation
                                .checked_mul(2)
                                .ok_or(JournalError::Corrupt)?;
                            let (minimum_revision, maximum_revision) = if lease.consumed {
                                (
                                    lease
                                        .generation
                                        .checked_add(3)
                                        .ok_or(JournalError::Corrupt)?,
                                    doubled_generation
                                        .checked_add(2)
                                        .ok_or(JournalError::Corrupt)?,
                                )
                            } else {
                                (
                                    lease
                                        .generation
                                        .checked_add(2)
                                        .ok_or(JournalError::Corrupt)?,
                                    doubled_generation
                                        .checked_add(1)
                                        .ok_or(JournalError::Corrupt)?,
                                )
                            };
                            if record.revision < minimum_revision
                                || record.revision > maximum_revision
                            {
                                return Err(JournalError::Corrupt);
                            }
                        }
                    }
                }
                OperationStateV1::Applied | OperationStateV1::Failed => {
                    return Err(JournalError::Corrupt)
                }
            }
        }
    }
    if record.claimed_at_unix_ms == 0
        || record.claim_lease_expires_at_unix_ms
            != add_duration_millis(record.claimed_at_unix_ms, CLAIM_LEASE)?
        || record.revision == 0
    {
        return Err(JournalError::Corrupt);
    }
    if let Some(progress) = &record.progress_evidence {
        validate_evidence(progress, EvidencePhaseV1::Progress)?;
        if progress.recorded_at_unix_ms < record.claimed_at_unix_ms {
            return Err(JournalError::Corrupt);
        }
    }
    if let Some(final_evidence) = &record.final_evidence {
        validate_evidence(final_evidence, EvidencePhaseV1::Final)?;
        if final_evidence.recorded_at_unix_ms < record.claimed_at_unix_ms {
            return Err(JournalError::Corrupt);
        }
    }
    if let Some(lease) = &record.reconciliation_lease {
        if lease.generation == 0
            || lease.issued_at_unix_ms == 0
            || lease.expires_at_unix_ms
                != add_duration_millis(
                    lease.issued_at_unix_ms,
                    reconciliation_lease_ttl(record.operation_kind),
                )?
        {
            return Err(JournalError::Corrupt);
        }
        validate_digest(&lease.authority_digest)?;
    }
    match record.state {
        OperationStateV1::Claimed => {
            if record.revision != 1
                || record.transitioned_at_unix_ms.is_some()
                || record.code.is_some()
                || record.progress_evidence.is_some()
                || record.final_evidence.is_some()
                || record.reconciliation_lease.is_some()
            {
                return Err(JournalError::Corrupt);
            }
        }
        OperationStateV1::OutcomeUnknown => {
            let Some(transitioned) = record.transitioned_at_unix_ms else {
                return Err(JournalError::Corrupt);
            };
            let Some(progress) = record.progress_evidence.as_ref() else {
                return Err(JournalError::Corrupt);
            };
            if record.revision < 2
                || transitioned != progress.recorded_at_unix_ms
                || record.code.as_deref() != Some(OUTCOME_UNKNOWN_CODE)
                || record.final_evidence.is_some()
            {
                return Err(JournalError::Corrupt);
            }
            if record
                .reconciliation_lease
                .as_ref()
                .is_some_and(|lease| lease.issued_at_unix_ms < transitioned)
            {
                return Err(JournalError::Corrupt);
            }
        }
        OperationStateV1::Applied | OperationStateV1::Failed => {
            let Some(transitioned) = record.transitioned_at_unix_ms else {
                return Err(JournalError::Corrupt);
            };
            let Some(final_evidence) = record.final_evidence.as_ref() else {
                return Err(JournalError::Corrupt);
            };
            if record.revision < 2
                || transitioned != final_evidence.recorded_at_unix_ms
                || record.reconciliation_lease.is_some()
                || (record.state == OperationStateV1::Applied) != record.code.is_none()
                || record.progress_evidence.as_ref().is_some_and(|progress| {
                    final_evidence.recorded_at_unix_ms < progress.recorded_at_unix_ms
                })
            {
                return Err(JournalError::Corrupt);
            }
            if let Some(code) = &record.code {
                validate_code(code)?;
            }
        }
    }
    Ok(())
}

fn validate_tombstone(tombstone: &BackendOperationTombstoneV1) -> Result<(), JournalError> {
    if tombstone.format != TOMBSTONE_FORMAT
        || tombstone.version != TOMBSTONE_VERSION
        || tombstone.archived_generation == 0
        || !is_terminal_state(tombstone.record.state)
    {
        return Err(JournalError::Corrupt);
    }
    validate_record(&tombstone.record)?;
    if record_digest(&tombstone.record)? != tombstone.record_digest {
        return Err(JournalError::Corrupt);
    }
    Ok(())
}

fn validate_source_ledger_admission_record_identity(
    provider_id: &str,
    project_id: &str,
    release_id: &str,
    owner_id: &str,
) -> Result<(), JournalError> {
    let payload_digest = release_id
        .strip_prefix("source-ledger-admission:")
        .ok_or(JournalError::Invalid)?;
    if provider_id != "supabase"
        || !is_supabase_project_ref(project_id)
        || owner_id != SOURCE_LEDGER_ADMISSION_OWNER
    {
        return Err(JournalError::Invalid);
    }
    validate_digest(payload_digest)
}

fn validate_receipt_zero_initializer_record_identity(
    single_flight_key: &str,
    dispatch_scope_key: &str,
    provider_id: &str,
    project_id: &str,
    release_id: &str,
    owner_id: &str,
    expected_plan_digest: &str,
) -> Result<(), JournalError> {
    let plan_digest = release_id
        .strip_prefix(RECEIPT_ZERO_INITIALIZER_RELEASE_PREFIX)
        .ok_or(JournalError::Invalid)?;
    if provider_id != "supabase"
        || !is_exact_supabase_project_ref(project_id)
        || owner_id != RECEIPT_ZERO_INITIALIZER_OWNER
        || plan_digest != expected_plan_digest
        || single_flight_key != receipt_zero_initializer_single_flight_key(plan_digest)?
        || dispatch_scope_key != receipt_zero_initializer_scope_key(provider_id, project_id)?
    {
        return Err(JournalError::Invalid);
    }
    validate_digest(plan_digest)
}

fn receipt_zero_initializer_single_flight_key(plan_digest: &str) -> Result<String, JournalError> {
    validate_digest(plan_digest)?;
    digest_canonical_serialized(
        RECEIPT_ZERO_INITIALIZER_SINGLE_FLIGHT_DOMAIN,
        &("supabase-backfill-receipt-zero-initializer", plan_digest),
    )
}

fn receipt_zero_initializer_scope_key(
    provider_id: &str,
    project_ref: &str,
) -> Result<String, JournalError> {
    digest_canonical_serialized(
        RECEIPT_ZERO_INITIALIZER_SCOPE_DOMAIN,
        &ReceiptZeroInitializerStableScopeV1 {
            format: RECEIPT_ZERO_INITIALIZER_FORMAT,
            version: 1,
            provider_id,
            project_ref,
        },
    )
}

fn is_supabase_project_ref(value: &str) -> bool {
    value.len() == 20
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
}

fn validate_body(body: &JournalBodyV1) -> Result<(), JournalError> {
    if body.records.len() > MAX_RECORDS {
        return Err(JournalError::Full);
    }
    for (key, record) in &body.records {
        if key != &record.single_flight_key {
            return Err(JournalError::Corrupt);
        }
        validate_record(record)?;
    }
    if body.tombstones.len() > MAX_TOMBSTONES {
        return Err(JournalError::Full);
    }
    for (key, tombstone) in &body.tombstones {
        if key != &tombstone.record.single_flight_key
            || body.records.contains_key(key)
            || tombstone.archived_generation > body.generation
        {
            return Err(JournalError::Corrupt);
        }
        validate_tombstone(tombstone)?;
    }
    let unresolved: Vec<_> = body
        .records
        .values()
        .filter(|record| {
            matches!(
                record.state,
                OperationStateV1::Claimed | OperationStateV1::OutcomeUnknown
            )
        })
        .collect();
    for (index, record) in unresolved.iter().enumerate() {
        if unresolved[index + 1..]
            .iter()
            .any(|other| unresolved_records_conflict(record, other))
        {
            return Err(JournalError::Corrupt);
        }
    }
    Ok(())
}

fn evidence(
    phase: EvidencePhaseV1,
    payload: Value,
    recorded_at_unix_ms: u64,
) -> Result<OperationEvidenceV1, JournalError> {
    if recorded_at_unix_ms == 0 {
        return Err(JournalError::Invalid);
    }
    let payload = validate_evidence_payload(&payload)?;
    let record = OperationEvidenceV1 {
        format: EVIDENCE_FORMAT.to_owned(),
        version: EVIDENCE_VERSION,
        phase,
        payload_digest: digest_bytes(payload.as_bytes()),
        payload,
        recorded_at_unix_ms,
    };
    validate_evidence(&record, phase)?;
    Ok(record)
}

fn validate_evidence_payload(payload: &Value) -> Result<String, JournalError> {
    if !payload.is_object() {
        return Err(JournalError::Invalid);
    }
    let mut nodes = 0;
    validate_evidence_value(payload, 0, &mut nodes)?;
    let payload = serde_json::to_string(&payload).map_err(|_| JournalError::Invalid)?;
    if payload.len() > MAX_EVIDENCE_BYTES {
        return Err(JournalError::Invalid);
    }
    Ok(payload)
}

fn validate_evidence(
    evidence: &OperationEvidenceV1,
    expected_phase: EvidencePhaseV1,
) -> Result<(), JournalError> {
    if evidence.format != EVIDENCE_FORMAT
        || evidence.version != EVIDENCE_VERSION
        || evidence.phase != expected_phase
        || evidence.recorded_at_unix_ms == 0
        || evidence.payload.len() > MAX_EVIDENCE_BYTES
        || digest_bytes(evidence.payload.as_bytes()) != evidence.payload_digest
    {
        return Err(JournalError::Corrupt);
    }
    validate_digest(&evidence.payload_digest)?;
    let payload: Value =
        serde_json::from_str(&evidence.payload).map_err(|_| JournalError::Corrupt)?;
    if !payload.is_object()
        || serde_json::to_string(&payload).map_err(|_| JournalError::Corrupt)? != evidence.payload
    {
        return Err(JournalError::Corrupt);
    }
    let mut nodes = 0;
    validate_evidence_value(&payload, 0, &mut nodes)
}

fn validate_evidence_value(
    value: &Value,
    depth: usize,
    nodes: &mut usize,
) -> Result<(), JournalError> {
    *nodes = nodes.checked_add(1).ok_or(JournalError::Invalid)?;
    if depth > MAX_EVIDENCE_DEPTH || *nodes > MAX_EVIDENCE_NODES {
        return Err(JournalError::Invalid);
    }
    match value {
        Value::Null | Value::Bool(_) => Ok(()),
        Value::Number(number) if number.is_i64() || number.is_u64() => Ok(()),
        Value::Number(_) => Err(JournalError::Invalid),
        Value::String(text) => {
            validate_bounded_text(text, MAX_KEY_BYTES)?;
            if contains_secret_like_value(text) {
                return Err(JournalError::Invalid);
            }
            Ok(())
        }
        Value::Array(values) => {
            for entry in values {
                validate_evidence_value(entry, depth + 1, nodes)?;
            }
            Ok(())
        }
        Value::Object(values) => {
            for (key, entry) in values {
                validate_bounded_text(key, MAX_ID_BYTES)?;
                if secret_field_name(key) {
                    return Err(JournalError::Invalid);
                }
                validate_evidence_value(entry, depth + 1, nodes)?;
            }
            Ok(())
        }
    }
}

fn secret_field_name(value: &str) -> bool {
    let normalized = value
        .bytes()
        .filter(|byte| byte.is_ascii_alphanumeric())
        .map(|byte| byte.to_ascii_lowercase())
        .collect::<Vec<_>>();
    matches!(
        normalized.as_slice(),
        b"password"
            | b"secret"
            | b"token"
            | b"accesstoken"
            | b"refreshtoken"
            | b"personalaccesstoken"
            | b"authorization"
            | b"apikey"
            | b"servicekey"
            | b"servicerolekey"
    )
}

fn contains_secret_like_value(value: &str) -> bool {
    value.starts_with("sbp_")
        || value.starts_with("sb_secret_")
        || value.starts_with("Bearer ")
        || (value.starts_with("eyJ") && value.matches('.').count() == 2)
}

fn validate_bounded_text(value: &str, maximum: usize) -> Result<(), JournalError> {
    if value.is_empty()
        || value.len() > maximum
        || value
            .chars()
            .any(|character| character.is_control() || character == '\u{7f}')
    {
        return Err(JournalError::Invalid);
    }
    Ok(())
}

fn validate_stable_id(value: &str) -> Result<(), JournalError> {
    validate_bounded_text(value, MAX_ID_BYTES)?;
    if !value.bytes().enumerate().all(|(index, byte)| {
        byte.is_ascii_alphanumeric()
            || (index > 0 && matches!(byte, b'.' | b'_' | b':' | b'/' | b'@' | b'-'))
    }) {
        return Err(JournalError::Invalid);
    }
    Ok(())
}

fn validate_code(value: &str) -> Result<(), JournalError> {
    validate_bounded_text(value, MAX_CODE_BYTES)?;
    validate_stable_id(value)
}

fn validate_digest(value: &str) -> Result<(), JournalError> {
    if value.len() != 43
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(JournalError::Invalid);
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| JournalError::Invalid)?;
    if bytes.len() != 32 || URL_SAFE_NO_PAD.encode(bytes) != value {
        return Err(JournalError::Invalid);
    }
    Ok(())
}

fn add_duration_millis(value: u64, duration: Duration) -> Result<u64, JournalError> {
    let millis = u64::try_from(duration.as_millis()).map_err(|_| JournalError::Invalid)?;
    value.checked_add(millis).ok_or(JournalError::Invalid)
}

fn digest_bytes(value: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(value))
}

fn record_digest(record: &BackendOperationRecordV1) -> Result<String, JournalError> {
    let bytes = serde_json::to_vec(record).map_err(|_| JournalError::Corrupt)?;
    Ok(digest_bytes(&bytes))
}

fn load_journal(root: &Path) -> Result<JournalBodyV1, JournalError> {
    let path = root.join(JOURNAL_FILE);
    let Some(bytes) = read_bounded_regular_file(&path, MAX_JOURNAL_BYTES)? else {
        return Ok(JournalBodyV1::default());
    };
    let header: JournalEnvelopeHeaderV1 =
        serde_json::from_slice(&bytes).map_err(|_| JournalError::Corrupt)?;
    if header.format != JOURNAL_FORMAT {
        return Err(JournalError::Corrupt);
    }
    match header.version {
        JOURNAL_LEGACY_VERSION => {
            let envelope: LegacyJournalEnvelopeV1 =
                serde_json::from_slice(&bytes).map_err(|_| JournalError::Corrupt)?;
            let body_bytes =
                serde_json::to_vec(&envelope.body).map_err(|_| JournalError::Corrupt)?;
            if digest_bytes(&body_bytes) != envelope.body_digest {
                return Err(JournalError::Corrupt);
            }
            let body = JournalBodyV1 {
                generation: envelope.body.generation,
                records: envelope.body.records,
                tombstones: BTreeMap::new(),
            };
            validate_body(&body)?;
            Ok(body)
        }
        JOURNAL_VERSION => {
            let envelope: JournalEnvelopeV1 =
                serde_json::from_slice(&bytes).map_err(|_| JournalError::Corrupt)?;
            validate_body(&envelope.body)?;
            let body_bytes =
                serde_json::to_vec(&envelope.body).map_err(|_| JournalError::Corrupt)?;
            if digest_bytes(&body_bytes) != envelope.body_digest {
                return Err(JournalError::Corrupt);
            }
            Ok(envelope.body)
        }
        _ => Err(JournalError::Corrupt),
    }
}

fn persist_journal(
    root: &Path,
    body: &JournalBodyV1,
    directory_sync: &dyn DirectorySync,
) -> Result<CommitDurability, JournalError> {
    let bytes = serialize_journal(body)?;
    persist_serialized_journal(root, &bytes, directory_sync)
}

fn serialize_journal(body: &JournalBodyV1) -> Result<Vec<u8>, JournalError> {
    validate_body(body)?;
    let body_bytes = serde_json::to_vec(body).map_err(|_| JournalError::Invalid)?;
    let envelope = JournalEnvelopeV1 {
        format: JOURNAL_FORMAT.to_owned(),
        version: JOURNAL_VERSION,
        body: body.clone(),
        body_digest: digest_bytes(&body_bytes),
    };
    let bytes = serde_json::to_vec(&envelope).map_err(|_| JournalError::Invalid)?;
    if bytes.len() > MAX_JOURNAL_BYTES {
        return Err(JournalError::Full);
    }
    Ok(bytes)
}

fn persist_serialized_journal(
    root: &Path,
    bytes: &[u8],
    directory_sync: &dyn DirectorySync,
) -> Result<CommitDurability, JournalError> {
    if bytes.len() > MAX_JOURNAL_BYTES {
        return Err(JournalError::Full);
    }
    let target = root.join(JOURNAL_FILE);
    reject_non_regular_file_if_present(&target)?;
    let temporary = stage_private_file(root, "journal", bytes)?;
    if let Err(error) = reject_non_regular_file_if_present(&target) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    if let Err(error) = replace_existing_atomically(&temporary, &target) {
        let _ = fs::remove_file(&temporary);
        return Err(map_io_error(error));
    }
    Ok(match directory_sync.sync(root) {
        Ok(()) => CommitDurability::Confirmed,
        Err(_) => CommitDurability::Unconfirmed,
    })
}

fn acquire_process_lock(lock: &Mutex<()>) -> Result<MutexGuard<'_, ()>, JournalError> {
    let deadline = Instant::now() + LOCK_WAIT_TIMEOUT;
    loop {
        match lock.try_lock() {
            Ok(guard) => return Ok(guard),
            Err(TryLockError::Poisoned(_)) => return Err(JournalError::Unavailable),
            Err(TryLockError::WouldBlock) if Instant::now() >= deadline => {
                return Err(JournalError::Unavailable)
            }
            Err(TryLockError::WouldBlock) => thread::sleep(LOCK_RETRY_INTERVAL),
        }
    }
}

struct JournalFileLock {
    file: File,
    #[cfg(windows)]
    overlapped: windows_sys::Win32::System::IO::OVERLAPPED,
}

impl JournalFileLock {
    fn acquire(path: &Path) -> Result<Self, JournalError> {
        reject_non_regular_file_if_present(path)?;
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true);
        configure_private_open_options(&mut options);
        let file = options.open(path).map_err(map_io_error)?;
        validate_open_file(&file)?;
        set_private_file_permissions(&file)?;

        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            let deadline = Instant::now() + LOCK_WAIT_TIMEOUT;
            loop {
                // SAFETY: the descriptor belongs to `file` and remains open for the guard lifetime.
                let result =
                    unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
                if result == 0 {
                    return Ok(Self { file });
                }
                let error = io::Error::last_os_error();
                if error.kind() == io::ErrorKind::Interrupted {
                    continue;
                }
                if error.kind() != io::ErrorKind::WouldBlock {
                    return Err(map_io_error(error));
                }
                if Instant::now() >= deadline {
                    return Err(JournalError::Unavailable);
                }
                thread::sleep(LOCK_RETRY_INTERVAL);
            }
        }

        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawHandle;
            use windows_sys::Win32::{
                Foundation::ERROR_LOCK_VIOLATION,
                Storage::FileSystem::{
                    LockFileEx, LOCKFILE_EXCLUSIVE_LOCK, LOCKFILE_FAIL_IMMEDIATELY,
                },
            };
            let mut overlapped = unsafe { std::mem::zeroed() };
            let deadline = Instant::now() + LOCK_WAIT_TIMEOUT;
            loop {
                // SAFETY: the handle, file, and OVERLAPPED stay alive for the guard lifetime.
                let result = unsafe {
                    LockFileEx(
                        file.as_raw_handle() as _,
                        LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY,
                        0,
                        u32::MAX,
                        u32::MAX,
                        &mut overlapped,
                    )
                };
                if result != 0 {
                    return Ok(Self { file, overlapped });
                }
                let error = io::Error::last_os_error();
                if error.raw_os_error() != Some(ERROR_LOCK_VIOLATION as i32) {
                    return Err(map_io_error(error));
                }
                if Instant::now() >= deadline {
                    return Err(JournalError::Unavailable);
                }
                thread::sleep(LOCK_RETRY_INTERVAL);
            }
        }

        #[cfg(not(any(unix, windows)))]
        {
            Ok(Self { file })
        }
    }
}

impl Drop for JournalFileLock {
    fn drop(&mut self) {
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            // SAFETY: this guard owns a still-open descriptor locked by `acquire`.
            let _ = unsafe { libc::flock(self.file.as_raw_fd(), libc::LOCK_UN) };
        }
        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawHandle;
            use windows_sys::Win32::Storage::FileSystem::UnlockFileEx;
            // SAFETY: the handle and OVERLAPPED pair match the successful LockFileEx call.
            let _ = unsafe {
                UnlockFileEx(
                    self.file.as_raw_handle() as _,
                    0,
                    u32::MAX,
                    u32::MAX,
                    &mut self.overlapped,
                )
            };
        }
    }
}

fn map_io_error(error: io::Error) -> JournalError {
    if error.kind() == io::ErrorKind::PermissionDenied {
        JournalError::Unavailable
    } else {
        JournalError::Corrupt
    }
}

fn ensure_store_directory(root: &Path) -> Result<(), JournalError> {
    let app_data_dir = root.parent().ok_or(JournalError::Unavailable)?;
    ensure_private_directory(app_data_dir)?;
    ensure_private_directory(root)
}

fn ensure_private_directory(path: &Path) -> Result<(), JournalError> {
    let existed = match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(JournalError::Unavailable);
            }
            true
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => false,
        Err(error) => return Err(map_io_error(error)),
    };
    if !existed {
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        match builder.create(path) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(map_io_error(error)),
        }
    }
    let metadata = fs::symlink_metadata(path).map_err(map_io_error)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(JournalError::Unavailable);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(map_io_error)?;
    }
    if !existed {
        sync_directory(path.parent().ok_or(JournalError::Unavailable)?)?;
    }
    Ok(())
}

fn reject_non_regular_file_if_present(path: &Path) -> Result<bool, JournalError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(JournalError::Unavailable);
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                if metadata.nlink() != 1 {
                    return Err(JournalError::Unavailable);
                }
            }
            Ok(true)
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(map_io_error(error)),
    }
}

fn validate_open_file(file: &File) -> Result<(), JournalError> {
    let metadata = file.metadata().map_err(map_io_error)?;
    if !metadata.is_file() {
        return Err(JournalError::Unavailable);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 {
            return Err(JournalError::Unavailable);
        }
    }
    Ok(())
}

fn configure_private_open_options(options: &mut OpenOptions) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
}

fn set_private_file_permissions(file: &File) -> Result<(), JournalError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(map_io_error)?;
    }
    Ok(())
}

fn read_bounded_regular_file(
    path: &Path,
    max_bytes: usize,
) -> Result<Option<Vec<u8>>, JournalError> {
    if !reject_non_regular_file_if_present(path)? {
        return Ok(None);
    }
    let mut options = OpenOptions::new();
    options.read(true);
    configure_private_open_options(&mut options);
    let mut file = options.open(path).map_err(map_io_error)?;
    validate_open_file(&file)?;
    set_private_file_permissions(&file)?;
    let metadata = file.metadata().map_err(map_io_error)?;
    if metadata.len() > max_bytes as u64 {
        return Err(JournalError::Full);
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    Read::by_ref(&mut file)
        .take((max_bytes + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(map_io_error)?;
    if bytes.len() > max_bytes {
        return Err(JournalError::Full);
    }
    Ok(Some(bytes))
}

fn stage_private_file(root: &Path, label: &str, bytes: &[u8]) -> Result<PathBuf, JournalError> {
    for _ in 0..8 {
        let mut random = [0_u8; 16];
        SystemRandom::new()
            .fill(&mut random)
            .map_err(|_| JournalError::Unavailable)?;
        let path = root.join(format!(".{label}-{}.tmp", URL_SAFE_NO_PAD.encode(random)));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        configure_private_open_options(&mut options);
        let mut file = match options.open(&path) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(map_io_error(error)),
        };
        let staged = (|| {
            validate_open_file(&file)?;
            set_private_file_permissions(&file)?;
            file.write_all(bytes).map_err(map_io_error)?;
            file.sync_all().map_err(map_io_error)
        })();
        drop(file);
        if let Err(error) = staged {
            let _ = fs::remove_file(&path);
            return Err(error);
        }
        return Ok(path);
    }
    Err(JournalError::Unavailable)
}

fn cleanup_stale_staging_files(root: &Path) -> Result<(), JournalError> {
    let mut removed_any = false;
    for entry in fs::read_dir(root).map_err(map_io_error)? {
        let entry = entry.map_err(map_io_error)?;
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        let managed = name
            .strip_prefix(".journal-")
            .and_then(|value| value.strip_suffix(".tmp"))
            .is_some_and(|random| {
                random.len() == 22
                    && random
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
            });
        if !managed {
            continue;
        }
        let path = entry.path();
        if !reject_non_regular_file_if_present(&path)? {
            continue;
        }
        fs::remove_file(path).map_err(map_io_error)?;
        removed_any = true;
    }
    if removed_any {
        sync_directory(root)?;
    }
    Ok(())
}

#[cfg(not(windows))]
fn replace_existing_atomically(temporary: &Path, target: &Path) -> io::Result<()> {
    fs::rename(temporary, target)
}

#[cfg(windows)]
fn replace_existing_atomically(temporary: &Path, target: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    fn wide_path(path: &Path) -> io::Result<Vec<u16>> {
        let mut encoded = path.as_os_str().encode_wide().collect::<Vec<_>>();
        if encoded.contains(&0) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Backend operation journal path contains a null character",
            ));
        }
        encoded.push(0);
        Ok(encoded)
    }
    let temporary = wide_path(temporary)?;
    let target = wide_path(target)?;
    // SAFETY: both paths are NUL-terminated and remain alive for the native call.
    let result = unsafe {
        MoveFileExW(
            temporary.as_ptr(),
            target.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn sync_directory(root: &Path) -> Result<(), JournalError> {
    #[cfg(unix)]
    {
        File::open(root)
            .and_then(|directory| directory.sync_all())
            .map_err(map_io_error)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::STANDARD;
    use serde_json::json;
    use std::sync::{
        atomic::{AtomicU64, AtomicUsize, Ordering},
        Barrier,
    };
    use tempfile::TempDir;

    const WALL_START: u64 = 1_800_000_000_000;
    const PROJECT_A: &str = "abcdefghijklmnopqrst";
    const RECEIPT_ZERO_INITIALIZER_FIXTURE_JSON: &[u8] = include_bytes!(
        "../../tests/fixtures/backend/supabase/receipt-zero-initializer-canonical-v1.json"
    );

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct ReceiptZeroInitializerGoldenFixtureV1 {
        fixture_format: String,
        fixture_version: u8,
        initializer_format: String,
        initializer_version: u8,
        plan_domain: String,
        single_flight_domain: String,
        scope_domain: String,
        capture_consumed: bool,
        material: ReceiptZeroInitializerClaimMaterialV1,
        plan_digest: String,
        single_flight_key: String,
        dispatch_scope_key: String,
    }

    fn receipt_zero_initializer_fixture() -> ReceiptZeroInitializerGoldenFixtureV1 {
        serde_json::from_slice(RECEIPT_ZERO_INITIALIZER_FIXTURE_JSON)
            .expect("initializer fixture must parse strictly")
    }

    struct ManualClock {
        wall: AtomicU64,
        monotonic_millis: AtomicU64,
    }

    impl ManualClock {
        fn new() -> Self {
            Self {
                wall: AtomicU64::new(WALL_START),
                monotonic_millis: AtomicU64::new(0),
            }
        }

        fn advance(&self, duration: Duration) {
            let millis = u64::try_from(duration.as_millis()).unwrap();
            self.wall.fetch_add(millis, Ordering::SeqCst);
            self.monotonic_millis.fetch_add(millis, Ordering::SeqCst);
        }

        fn advance_wall(&self, duration: Duration) {
            let millis = u64::try_from(duration.as_millis()).unwrap();
            self.wall.fetch_add(millis, Ordering::SeqCst);
        }

        fn advance_monotonic(&self, duration: Duration) {
            let millis = u64::try_from(duration.as_millis()).unwrap();
            self.monotonic_millis.fetch_add(millis, Ordering::SeqCst);
        }

        fn set_wall(&self, value: u64) {
            self.wall.store(value, Ordering::SeqCst);
        }

        fn set_monotonic(&self, value: Duration) {
            self.monotonic_millis
                .store(u64::try_from(value.as_millis()).unwrap(), Ordering::SeqCst);
        }
    }

    impl JournalClock for ManualClock {
        fn wall_unix_millis(&self) -> Result<u64, JournalError> {
            Ok(self.wall.load(Ordering::SeqCst))
        }

        fn monotonic(&self) -> Duration {
            Duration::from_millis(self.monotonic_millis.load(Ordering::SeqCst))
        }
    }

    struct CounterEntropy(AtomicU64);

    impl CounterEntropy {
        fn new() -> Self {
            Self(AtomicU64::new(1))
        }
    }

    impl JournalEntropy for CounterEntropy {
        fn capability_id(&self) -> Result<[u8; CAPABILITY_BYTES], JournalError> {
            let mut id = [0_u8; CAPABILITY_BYTES];
            id[CAPABILITY_BYTES - 8..]
                .copy_from_slice(&self.0.fetch_add(1, Ordering::SeqCst).to_be_bytes());
            Ok(id)
        }
    }

    struct AdvanceWallEntropy {
        clock: Arc<ManualClock>,
        duration: Duration,
        next: AtomicU64,
    }

    impl JournalEntropy for AdvanceWallEntropy {
        fn capability_id(&self) -> Result<[u8; CAPABILITY_BYTES], JournalError> {
            self.clock.advance_wall(self.duration);
            let mut id = [0_u8; CAPABILITY_BYTES];
            id[CAPABILITY_BYTES - 8..]
                .copy_from_slice(&self.next.fetch_add(1, Ordering::SeqCst).to_be_bytes());
            Ok(id)
        }
    }

    struct ConstantEntropy([u8; CAPABILITY_BYTES]);

    impl JournalEntropy for ConstantEntropy {
        fn capability_id(&self) -> Result<[u8; CAPABILITY_BYTES], JournalError> {
            Ok(self.0)
        }
    }

    struct FailAfterDirectorySync {
        successful_calls: usize,
        calls: AtomicUsize,
    }

    impl DirectorySync for FailAfterDirectorySync {
        fn sync(&self, directory: &Path) -> Result<(), JournalError> {
            let call = self.calls.fetch_add(1, Ordering::SeqCst);
            if call >= self.successful_calls {
                return Err(JournalError::Unavailable);
            }
            sync_directory(directory)
        }
    }

    struct AdvanceClockDirectorySync {
        clock: Arc<ManualClock>,
        duration: Duration,
    }

    struct AdvanceClockOnDirectorySync {
        clock: Arc<ManualClock>,
        wall_duration: Duration,
        monotonic_duration: Duration,
        advance_on_call: usize,
        calls: AtomicUsize,
    }

    struct BlockingDirectorySync {
        entered: Arc<Barrier>,
        release: Arc<Barrier>,
    }

    struct BlockingNthDirectorySync {
        block_on_call: usize,
        calls: AtomicUsize,
        entered: Arc<Barrier>,
        release: Arc<Barrier>,
    }

    impl DirectorySync for BlockingDirectorySync {
        fn sync(&self, directory: &Path) -> Result<(), JournalError> {
            self.entered.wait();
            self.release.wait();
            sync_directory(directory)
        }
    }

    impl DirectorySync for BlockingNthDirectorySync {
        fn sync(&self, directory: &Path) -> Result<(), JournalError> {
            sync_directory(directory)?;
            let call = self.calls.fetch_add(1, Ordering::SeqCst) + 1;
            if call == self.block_on_call {
                self.entered.wait();
                self.release.wait();
            }
            Ok(())
        }
    }

    impl DirectorySync for AdvanceClockDirectorySync {
        fn sync(&self, directory: &Path) -> Result<(), JournalError> {
            sync_directory(directory)?;
            self.clock.advance(self.duration);
            Ok(())
        }
    }

    impl DirectorySync for AdvanceClockOnDirectorySync {
        fn sync(&self, directory: &Path) -> Result<(), JournalError> {
            sync_directory(directory)?;
            let call = self.calls.fetch_add(1, Ordering::SeqCst) + 1;
            if call == self.advance_on_call {
                self.clock.advance_wall(self.wall_duration);
                self.clock.advance_monotonic(self.monotonic_duration);
            }
            Ok(())
        }
    }

    fn journal(
        temp: &TempDir,
        clock: Arc<ManualClock>,
        entropy: Arc<dyn JournalEntropy>,
        directory_sync: Arc<dyn DirectorySync>,
    ) -> BackendOperationJournalV1 {
        BackendOperationJournalV1::with_test_dependencies(
            temp.path().join("app-data"),
            entropy,
            clock,
            directory_sync,
        )
    }

    fn confirmed_journal(
        temp: &TempDir,
        clock: Arc<ManualClock>,
        entropy: Arc<dyn JournalEntropy>,
    ) -> BackendOperationJournalV1 {
        journal(temp, clock, entropy, Arc::new(SystemDirectorySync))
    }

    fn plan(label: &str, project_id: &str) -> TrustedOperationPlanV1 {
        TrustedOperationPlanV1 {
            single_flight_key: digest_bytes(format!("single:{label}").as_bytes()),
            dispatch_scope_key: digest_bytes(format!("scope:{project_id}").as_bytes()),
            provider_id: "supabase".to_owned(),
            project_id: project_id.to_owned(),
            operation_kind: OperationKindV1::SupabaseBackfillDatabaseCasLedgerInstall,
            release_id: format!("release-{label}"),
            owner_id: "host-owner".to_owned(),
            plan_digest: digest_bytes(format!("plan:{label}").as_bytes()),
        }
    }

    fn admission_plan(label: &str, scope: &str) -> TrustedOperationPlanV1 {
        let payload_digest = digest_bytes(format!("admission-payload:{label}").as_bytes());
        TrustedOperationPlanV1 {
            single_flight_key: digest_bytes(format!("admission-single:{label}").as_bytes()),
            dispatch_scope_key: digest_bytes(format!("admission-scope:{scope}").as_bytes()),
            provider_id: "supabase".to_owned(),
            project_id: PROJECT_A.to_owned(),
            operation_kind: OperationKindV1::SupabaseBackfillReceiptZeroAdmission,
            release_id: format!("source-ledger-admission:{payload_digest}"),
            owner_id: SOURCE_LEDGER_ADMISSION_OWNER.to_owned(),
            plan_digest: digest_bytes(format!("admission-plan:{label}").as_bytes()),
        }
    }

    fn cas_ledger_install_material(
        label: &str,
        project_ref: &str,
    ) -> CasLedgerInstallPlanMaterialV1 {
        let marker_binding_digest = digest_bytes(format!("cas-marker-binding:{label}").as_bytes());
        let marker = format!("{CAS_LEDGER_INSTALL_MARKER_PREFIX}{marker_binding_digest}");
        let install_sql_digest =
            fixed_cas_ledger_install_sql_digest(&marker, &marker_binding_digest)
                .expect("fixed install SQL");
        CasLedgerInstallPlanMaterialV1 {
            provider_id: "supabase".to_owned(),
            environment: "staging".to_owned(),
            project_ref: project_ref.to_owned(),
            account_id: format!("account-{label}"),
            read_grant_generation: "11111111-1111-4111-8111-111111111111".to_owned(),
            write_grant_generation: "22222222-2222-4222-8222-222222222222".to_owned(),
            migration_name: CAS_LEDGER_INSTALL_MIGRATION_NAME.to_owned(),
            install_review_digest: digest_bytes(format!("cas-review:{label}").as_bytes()),
            source_review_digest: digest_bytes(format!("cas-source:{label}").as_bytes()),
            verification_digest: digest_bytes(format!("cas-verification:{label}").as_bytes()),
            ledger_shape_digest: digest_bytes(format!("cas-shape:{label}").as_bytes()),
            base_sql_digest: CAS_LEDGER_BASE_SQL_DIGEST.to_owned(),
            marker,
            marker_binding_digest,
            install_sql_digest,
            verification_query_digest: CAS_LEDGER_VERIFICATION_QUERY_DIGEST.to_owned(),
        }
    }

    fn canonical_value_digest_for_test(value: &Value) -> String {
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
        digest_bytes(canonical.as_bytes())
    }

    fn automation_cas_material(label: &str) -> AutomationCasRecoveryMaterialV1 {
        let idempotency_key_digest = digest_bytes(format!("idempotency:{label}").as_bytes());
        let record = json!({
            "attemptIds": [format!("attempt-{label}")],
            "automationId": "automation-1",
            "causationHop": 0,
            "causationId": "causation-1",
            "completionEvidenceDigest": null,
            "createdAt": "2026-09-09T00:00:00.000Z",
            "currentAttemptId": format!("attempt-{label}"),
            "dispatchAuthorityGranted": false,
            "eventId": "event-1",
            "expiresAt": "2026-09-09T01:00:00.000Z",
            "format": "openpencil.backend-automation-idempotency-record",
            "hostEvidenceAuthenticated": false,
            "idempotencyKeyDigest": idempotency_key_digest,
            "knownNotDispatchedEvidenceDigest": null,
            "operationId": "operation-1",
            "persistenceAuthorityGranted": false,
            "previousRecordDigest": null,
            "reconciliationEvidenceDigest": null,
            "recordedAt": "2026-09-09T00:00:00.000Z",
            "retentionHours": 1,
            "revision": 0,
            "state": "reserved",
            "version": 1
        });
        let record_bytes = serde_json::to_vec(&record).unwrap();
        let record_digest = digest_bytes(&record_bytes);
        let proposal = json!({
            "automationId": "automation-1",
            "dispatchAuthorityGranted": false,
            "eventId": "event-1",
            "expectedHeadDigest": null,
            "expectedRevision": null,
            "format": "openpencil.backend-automation-idempotency-cas-proposal",
            "hostEvidenceAuthenticated": false,
            "idempotencyKeyDigest": idempotency_key_digest,
            "nextRecordDigest": record_digest,
            "nextRevision": 0,
            "operationId": "operation-1",
            "persistenceAuthorityGranted": false,
            "version": 1
        });
        let proposal_bytes = serde_json::to_vec(&proposal).unwrap();
        let parameters = json!({
            "proposalDigest": digest_bytes(&proposal_bytes),
            "canonicalProposalBase64": STANDARD.encode(&proposal_bytes),
            "recordDigest": record_digest,
            "canonicalRecordBase64": STANDARD.encode(&record_bytes),
            "automationId": "automation-1",
            "eventId": "event-1",
            "operationId": "operation-1",
            "idempotencyKeyDigest": idempotency_key_digest,
            "causationId": "causation-1",
            "causationHop": 0,
            "retentionHours": 1,
            "createdAt": "2026-09-09T00:00:00.000Z",
            "expiresAt": "2026-09-09T01:00:00.000Z",
            "recordedAt": "2026-09-09T00:00:00.000Z",
            "nextRevision": 0,
            "expectedRevision": null,
            "expectedHeadDigest": null,
            "previousRecordDigest": null,
            "attemptIds": [format!("attempt-{label}")],
            "currentAttemptId": format!("attempt-{label}"),
            "state": "reserved",
            "completionEvidenceDigest": null,
            "knownNotDispatchedEvidenceDigest": null,
            "reconciliationEvidenceDigest": null,
            "hostEvidenceAuthenticated": false,
            "persistenceAuthorityGranted": false,
            "dispatchAuthorityGranted": false
        });
        let parameter_order = [
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
        let parameter_values = parameter_order
            .iter()
            .map(|key| parameters[*key].clone())
            .collect::<Vec<_>>();
        let parameter_values_digest = canonical_value_digest_for_test(&json!({
            "format": "openpencil.supabase-automation-idempotency-cas-parameters.v1",
            "order": parameter_order,
            "values": parameter_values,
            "version": 1
        }));
        let reconciliation_template = include_str!(
            "../../src/app/plugins/host/deployment/supabase/automation/idempotency/cas/reconciliation/v1.sql"
        );
        let reconciliation_sql = reconciliation_template.replace(
            "__OPENPENCIL_AUTOMATION_IDEMPOTENCY_SCHEMA__",
            "op_automation_application000000001",
        );
        serde_json::from_value(json!({
            "providerId": "supabase",
            "environment": "staging",
            "projectRef": PROJECT_A,
            "accountId": "account-automation",
            "applicationObjectKey": "application000000001",
            "schemaName": "op_automation_application000000001",
            "writeGrantGeneration": "11111111-1111-4111-8111-111111111111",
            "readGrantGeneration": "22222222-2222-4222-8222-222222222222",
            "writeCredentialIncarnationDigest": digest_bytes(format!("write-credential:{label}").as_bytes()),
            "readCredentialIncarnationDigest": digest_bytes(format!("read-credential:{label}").as_bytes()),
            "connectionProfileDigest": digest_bytes(format!("connection:{label}").as_bytes()),
            "installationIncarnationDigest": digest_bytes(format!("installation:{label}").as_bytes()),
            "casReviewDigest": digest_bytes(format!("cas-review:{label}").as_bytes()),
            "casSqlDigest": rendered_sql_digest_for_recovery("application000000001")
                .expect("fixed CAS SQL"),
            "reconciliationReviewDigest": digest_bytes(format!("reconciliation-review:{label}").as_bytes()),
            "reconciliationSqlTemplateDigest": digest_bytes(reconciliation_template.as_bytes()),
            "reconciliationSqlDigest": digest_bytes(reconciliation_sql.as_bytes()),
            "reconciliationQueryDigest": RECONCILIATION_QUERY_DIGEST,
            "parameterSchemaDigest": PARAMETER_SCHEMA_DIGEST,
            "parameterValuesDigest": parameter_values_digest,
            "schemaMarkerDigest": digest_bytes(
                b"openpencil.supabase-automation-idempotency-ledger.v1;application=application000000001;object=schema"
            ),
            "parameters": parameters
        }))
        .expect("Automation CAS material fixture must deserialize strictly")
    }

    fn receipt_zero_initializer_transaction_for_test(
        label: &str,
        project_ref: &str,
    ) -> ReceiptZeroInitializerTransactionMaterialV1 {
        let application_id = format!("application-{label}");
        let migration_id = format!("migration-{label}");
        let provider_authority_digest = digest_bytes(format!("provider:{label}").as_bytes());
        let application_digest = digest_bytes(format!("application:{label}").as_bytes());
        let migration_digest = digest_bytes(format!("migration:{label}").as_bytes());
        let migration_plan_digest = digest_bytes(format!("migration-plan:{label}").as_bytes());
        let source_ledger_digest = digest_bytes(format!("source-ledger:{label}").as_bytes());
        let capture_digest = digest_bytes(format!("capture:{label}").as_bytes());
        let catalog_precondition_digest =
            digest_bytes(format!("catalog-precondition:{label}").as_bytes());
        let resource_identity_digest = canonical_manifest_digest(&ReceiptZeroResourceIdentityV1 {
            format: "openpencil.supabase-backfill-resource-identity.v1",
            project_ref,
            address: ReceiptZeroResourceAddressV1 {
                schema_name: "public",
                schema_oid: "2200",
                table_name: "tasks",
                table_oid: "16384",
                cursor_field: "id",
                cursor_sub_id: 1,
                cursor_type_oid: "20",
                target_field: "normalized_title",
                target_sub_id: 2,
                target_type_oid: "25",
                primary_key_oid: "16385",
                sequence_oid: "16386",
                barrier_constraint_oid: "16387",
            },
        })
        .unwrap();
        let scope = ReceiptZeroScopeDocumentV2 {
            format: "openpencil.backend-backfill-execution-scope".to_owned(),
            version: 2,
            provider_id: "supabase".to_owned(),
            environment: "staging".to_owned(),
            provider_authority_digest: provider_authority_digest.clone(),
            application_id: application_id.clone(),
            application_digest: application_digest.clone(),
            migration_id: migration_id.clone(),
            migration_digest: migration_digest.clone(),
            migration_plan_digest: migration_plan_digest.clone(),
            source_ledger_digest: source_ledger_digest.clone(),
            capture_digest: capture_digest.clone(),
            receipt_zero_evidence_digest: capture_digest.clone(),
            resource_identity_digest: resource_identity_digest.clone(),
            catalog_precondition_digest: catalog_precondition_digest.clone(),
            entity_id: "tasks".to_owned(),
            cursor_field: "id".to_owned(),
            cursor_field_type: "integer".to_owned(),
            target_field: "normalized_title".to_owned(),
            batch_size: 25,
            maximum_receipt_count: 10_000,
            maximum_batch_count: 9_999,
            captured_high_water: Some(42),
            initial_remaining_eligible_row_count: 42,
            initial_remaining_target_row_count: 8,
            required_batch_count: 2,
            required_matched_row_count: Some(8),
            resume_policy: "from-receipt".to_owned(),
            completion_rule: "predicate-exhausted-and-postconditions-satisfied".to_owned(),
        };
        let scope_bytes = canonical_serialized_bytes(&scope).unwrap();
        let scope_digest = digest_bytes(&scope_bytes);
        let execution_id = format!(
            "execution:{}",
            digest_bytes(format!("execution:{label}").as_bytes())
        );
        let event_id = format!(
            "event:{}",
            digest_bytes(format!("event:{label}").as_bytes())
        );
        let receipt_id = format!(
            "receipt:{}",
            digest_bytes(format!("receipt:{label}").as_bytes())
        );
        let idempotency_key = format!(
            "receipt-zero:{}",
            digest_bytes(format!("idempotency:{label}").as_bytes())
        );
        let request_digest = digest_bytes(format!("request:{label}").as_bytes());
        let operation_evidence_digest =
            digest_bytes(format!("operation-evidence:{label}").as_bytes());
        let committed_at = "2027-01-01T00:00:03.000Z".to_owned();
        let receipt = ReceiptZeroReceiptDocumentV2 {
            format: "openpencil.backend-backfill-execution-receipt".to_owned(),
            version: 2,
            receipt_id: receipt_id.clone(),
            execution_id: execution_id.clone(),
            idempotency_key: idempotency_key.clone(),
            request_digest: request_digest.clone(),
            scope: scope.clone(),
            scope_digest: scope_digest.clone(),
            checkpoint_kind: "capture".to_owned(),
            batch_index: 0,
            previous_cursor: None,
            last_processed_key: None,
            batch_counts: ReceiptZeroCountsDocumentV2 {
                scanned_row_count: 0,
                matched_row_count: 0,
                updated_row_count: 0,
            },
            cumulative_counts: ReceiptZeroCountsDocumentV2 {
                scanned_row_count: 0,
                matched_row_count: 0,
                updated_row_count: 0,
            },
            exhaustion: ReceiptZeroExhaustionDocumentV2 {
                checked: true,
                remaining_eligible_row_count: Some(42),
                remaining_target_row_count: Some(8),
            },
            postconditions: ReceiptZeroPostconditionsDocumentV2 {
                field_not_null: false,
                required_matched_row_count: Some(8),
                matched_row_count_satisfied: false,
            },
            outcome: "in-progress".to_owned(),
            terminal_reason: None,
            stable_error_code: None,
            previous_receipt_digest: None,
            catalog_evidence_digest: catalog_precondition_digest.clone(),
            operation_authority_digest: operation_evidence_digest.clone(),
            database_event_id: event_id.clone(),
            database_head_version: 1,
            committed_at: committed_at.clone(),
            evidence_digest: capture_digest.clone(),
        };
        let receipt_bytes = canonical_serialized_bytes(&receipt).unwrap();
        let receipt_digest = digest_bytes(&receipt_bytes);
        let parameters = ReceiptZeroInitializerTransactionParametersV1 {
            execution_id,
            application_id,
            application_digest,
            migration_id,
            migration_digest,
            migration_plan_digest,
            provider_authority_digest,
            source_ledger_digest,
            scope_digest,
            resource_identity_digest,
            catalog_precondition_digest,
            canonical_scope_base64: STANDARD.encode(scope_bytes),
            capture_digest,
            captured_high_water: Some(42),
            initial_remaining_eligible_row_count: 42,
            initial_remaining_target_row_count: 8,
            required_matched_row_count: Some(8),
            required_batch_count: 2,
            batch_size: 25,
            initial_execution_status: "running".to_owned(),
            candidate_committed_at: committed_at,
            event_id,
            receipt_id,
            idempotency_key,
            request_digest,
            receipt_digest,
            canonical_receipt_base64: STANDARD.encode(receipt_bytes),
            unauthenticated_operation_evidence_digest: operation_evidence_digest,
        };
        ReceiptZeroInitializerTransactionMaterialV1 {
            format: RECEIPT_ZERO_TRANSACTION_FORMAT.to_owned(),
            version: 1,
            query_id: RECEIPT_ZERO_CAS_QUERY_ID.to_owned(),
            query_version: RECEIPT_ZERO_CAS_QUERY_VERSION.to_owned(),
            statement_count: 1,
            isolation: "serializable".to_owned(),
            access_mode: "read-write".to_owned(),
            transaction_sql_digest: RECEIPT_ZERO_CAS_SQL_DIGEST.to_owned(),
            parameter_schema_digest: RECEIPT_ZERO_CAS_PARAMETER_SCHEMA_DIGEST.to_owned(),
            parameter_values_digest: receipt_zero_parameter_values_digest(&parameters).unwrap(),
            parameters,
        }
    }

    fn initializer_material(
        label: &str,
        project_ref: &str,
    ) -> ReceiptZeroInitializerClaimMaterialV1 {
        let account_id = format!("account-{label}");
        let application_id = format!("application-{label}");
        let migration_id = format!("migration-{label}");
        let provider_authority_digest = digest_bytes(format!("provider:{label}").as_bytes());
        let application_digest = digest_bytes(format!("application:{label}").as_bytes());
        let migration_digest = digest_bytes(format!("migration:{label}").as_bytes());
        let migration_plan_digest = digest_bytes(format!("migration-plan:{label}").as_bytes());
        let source_ledger_digest = digest_bytes(format!("source-ledger:{label}").as_bytes());
        let schema_digest = digest_bytes(format!("schema:{label}").as_bytes());
        let source_subject_digest = digest_bytes(format!("source-subject:{label}").as_bytes());
        let inspection_subject_digest =
            digest_bytes(format!("inspection-subject:{label}").as_bytes());
        let attestation_digest = digest_bytes(format!("attestation:{label}").as_bytes());
        let source_scope_digest = digest_bytes(format!("source-scope:{label}").as_bytes());
        let source_review_digest = digest_bytes(format!("source-review:{label}").as_bytes());
        let install_review_digest = digest_bytes(format!("install-review:{label}").as_bytes());
        let marker_binding_digest = digest_bytes(format!("marker-binding:{label}").as_bytes());
        let installed_verification_digest =
            digest_bytes(format!("installed-verification:{label}").as_bytes());
        let read_grant_generation = "11111111-1111-4111-8111-111111111111".to_owned();
        let install_write_grant_generation = "22222222-2222-4222-8222-222222222222".to_owned();
        let capture_write_grant_generation = "33333333-3333-4333-8333-333333333333".to_owned();
        let marker = format!("{CAS_LEDGER_INSTALL_MARKER_PREFIX}{marker_binding_digest}");
        let install_sql_digest =
            fixed_cas_ledger_install_sql_digest(&marker, &marker_binding_digest)
                .expect("fixed CAS-ledger install SQL");
        let install = ReceiptZeroInitializerInstallMaterialV1 {
            provider_id: "supabase".to_owned(),
            environment: "staging".to_owned(),
            project_ref: project_ref.to_owned(),
            account_id: account_id.clone(),
            read_grant_generation: read_grant_generation.clone(),
            write_grant_generation: install_write_grant_generation.clone(),
            migration_name: CAS_LEDGER_INSTALL_MIGRATION_NAME.to_owned(),
            install_review_digest: install_review_digest.clone(),
            source_review_digest: source_review_digest.clone(),
            verification_digest: digest_bytes(format!("verification:{label}").as_bytes()),
            ledger_shape_digest: digest_bytes(format!("ledger-shape:{label}").as_bytes()),
            base_sql_digest: CAS_LEDGER_BASE_SQL_DIGEST.to_owned(),
            marker: marker.clone(),
            marker_binding_digest: marker_binding_digest.clone(),
            install_sql_digest,
            verification_query_digest: CAS_LEDGER_VERIFICATION_QUERY_DIGEST.to_owned(),
            installed_verification_digest: installed_verification_digest.clone(),
            observed_at: "2027-01-01T00:00:00.000Z".to_owned(),
            snapshot_marker: "1:2,3:4".to_owned(),
            server_version_num: "150000".to_owned(),
        };
        let install_plan = CasLedgerInstallPlanMaterialV1 {
            provider_id: install.provider_id.clone(),
            environment: install.environment.clone(),
            project_ref: install.project_ref.clone(),
            account_id: install.account_id.clone(),
            read_grant_generation: install.read_grant_generation.clone(),
            write_grant_generation: install.write_grant_generation.clone(),
            migration_name: install.migration_name.clone(),
            install_review_digest: install.install_review_digest.clone(),
            source_review_digest: install.source_review_digest.clone(),
            verification_digest: install.verification_digest.clone(),
            ledger_shape_digest: install.ledger_shape_digest.clone(),
            base_sql_digest: install.base_sql_digest.clone(),
            marker: install.marker.clone(),
            marker_binding_digest: install.marker_binding_digest.clone(),
            install_sql_digest: install.install_sql_digest.clone(),
            verification_query_digest: install.verification_query_digest.clone(),
        };
        let (_, install_identity) = cas_ledger_install_plan(&install_plan).unwrap();
        ReceiptZeroInitializerClaimMaterialV1 {
            source: ReceiptZeroInitializerSourceMaterialV1 {
                provider_id: "supabase".to_owned(),
                environment: "staging".to_owned(),
                project_ref: project_ref.to_owned(),
                account_id: account_id.clone(),
                grant_generation: format!("source-grant-{label}"),
                provider_authority_digest: provider_authority_digest.clone(),
                application_id: application_id.clone(),
                application_digest: application_digest.clone(),
                migration_id: migration_id.clone(),
                migration_digest: migration_digest.clone(),
                migration_plan_digest: migration_plan_digest.clone(),
                source_ledger_digest: source_ledger_digest.clone(),
                schema_digest: schema_digest.clone(),
                subject_digest: source_subject_digest.clone(),
                attestation_digest: attestation_digest.clone(),
                payload_digest: digest_bytes(format!("payload:{label}").as_bytes()),
                expectation_digest: digest_bytes(format!("expectation:{label}").as_bytes()),
                scope_digest: source_scope_digest.clone(),
                ci_provider: "github-actions".to_owned(),
                repository: "owner/repository".to_owned(),
                workflow: "backend-release".to_owned(),
                run_id: format!("run-{label}"),
                run_attempt: 1,
                protected_ref: "refs/heads/main".to_owned(),
                revision: format!("revision-{label}"),
                db_push_command_digest: digest_bytes(format!("db-push-command:{label}").as_bytes()),
                db_push_receipt_digest: digest_bytes(format!("db-push-receipt:{label}").as_bytes()),
                database_history_digest: digest_bytes(
                    format!("database-history:{label}").as_bytes(),
                ),
            },
            installed: install,
            inspection: ReceiptZeroInitializerInspectionMaterialV1 {
                provider_id: "supabase".to_owned(),
                provider_authority_digest: provider_authority_digest.clone(),
                application_id: application_id.clone(),
                application_digest: application_digest.clone(),
                migration_id: migration_id.clone(),
                migration_digest: migration_digest.clone(),
                migration_plan_digest: migration_plan_digest.clone(),
                inspection_subject_digest: inspection_subject_digest.clone(),
                table_name: "tasks".to_owned(),
                cursor_field: "id".to_owned(),
                target_field: "normalized_title".to_owned(),
                maximum_cursor: 9_007_199_254_740_991,
                batch_size: 25,
                maximum_batch_receipt_count: 9_999,
            },
            capture: ReceiptZeroInitializerCaptureMaterialV1 {
                provider_id: "supabase".to_owned(),
                environment: "staging".to_owned(),
                project_ref: project_ref.to_owned(),
                account_id,
                source_grant_generation: format!("source-grant-{label}"),
                read_grant_generation,
                install_write_grant_generation,
                capture_write_grant_generation,
                provider_authority_digest,
                application_id,
                application_digest,
                migration_id,
                migration_digest,
                migration_plan_digest,
                source_ledger_digest,
                source_scope_digest,
                schema_digest,
                source_ledger_subject_digest: source_subject_digest,
                inspection_subject_digest,
                attestation_digest,
                source_review_digest,
                install_plan_digest: install_identity.plan_digest,
                install_review_digest,
                marker_binding_digest,
                installed_verification_digest,
                capture_review_digest: digest_bytes(format!("capture-review:{label}").as_bytes()),
                catalog_precondition_digest: digest_bytes(
                    format!("catalog-precondition:{label}").as_bytes(),
                ),
                query_digest: digest_bytes(format!("capture-query:{label}").as_bytes()),
                capture_digest: digest_bytes(format!("capture:{label}").as_bytes()),
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
                observed_at: "2027-01-01T00:00:02.000Z".to_owned(),
                snapshot_marker: "5:8,6:7".to_owned(),
                server_version_num: "150000".to_owned(),
                query_bindings_match: true,
                current_and_session_role_match: true,
                full_table_read_authority_observed: true,
                exact_address_matches: true,
                cursor_range_safe: true,
                receipt_capacity_fits: true,
                all_capture_checks_passed: true,
            },
            transaction: receipt_zero_initializer_transaction_for_test(label, project_ref),
        }
    }

    fn body(journal: &BackendOperationJournalV1) -> JournalBodyV1 {
        journal.with_store(load_journal).unwrap()
    }

    fn rewrite_initializer_progress_for_test(
        temp: &TempDir,
        single_flight_key: &str,
        mutate: impl FnOnce(&mut Value),
    ) {
        let path = temp
            .path()
            .join("app-data")
            .join(STORE_DIRECTORY)
            .join(JOURNAL_FILE);
        let mut envelope: JournalEnvelopeV1 =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        let progress = envelope
            .body
            .records
            .get_mut(single_flight_key)
            .unwrap()
            .progress_evidence
            .as_mut()
            .unwrap();
        let mut payload: Value = serde_json::from_str(&progress.payload).unwrap();
        mutate(&mut payload);
        progress.payload = serde_json::to_string(&payload).unwrap();
        progress.payload_digest = digest_bytes(progress.payload.as_bytes());
        envelope.body_digest = digest_bytes(&serde_json::to_vec(&envelope.body).unwrap());
        fs::write(path, serde_json::to_vec(&envelope).unwrap()).unwrap();
    }

    fn journal_envelope_size_for_test(body: &JournalBodyV1) -> usize {
        let body_bytes = serde_json::to_vec(body).unwrap();
        serde_json::to_vec(&JournalEnvelopeV1 {
            format: JOURNAL_FORMAT.to_owned(),
            version: JOURNAL_VERSION,
            body: body.clone(),
            body_digest: digest_bytes(&body_bytes),
        })
        .unwrap()
        .len()
    }

    fn padding_tombstone_for_test(
        index: usize,
        padding_bytes: usize,
    ) -> (String, BackendOperationTombstoneV1) {
        let mut padding = vec!["x".repeat(MAX_KEY_BYTES); padding_bytes / MAX_KEY_BYTES];
        let remainder = padding_bytes % MAX_KEY_BYTES;
        if remainder > 0 {
            padding.push("x".repeat(remainder));
        }
        if padding.is_empty() {
            padding.push("x".to_owned());
        }
        let mut record = claimed_record(plan(
            &format!("near-full-{index}"),
            &project_ref(index + 100),
        ));
        record.revision = 2;
        record.state = OperationStateV1::Applied;
        record.transitioned_at_unix_ms = Some(WALL_START);
        record.final_evidence = Some(
            evidence(
                EvidencePhaseV1::Final,
                json!({"padding": padding}),
                WALL_START,
            )
            .unwrap(),
        );
        validate_record(&record).unwrap();
        let key = record.single_flight_key.clone();
        (key, terminal_tombstone(record, 1).unwrap())
    }

    fn unchecked_initializer_identity(
        material: &ReceiptZeroInitializerClaimMaterialV1,
    ) -> (String, String, String) {
        let canonical = ReceiptZeroInitializerCanonicalPlanV1 {
            format: RECEIPT_ZERO_INITIALIZER_FORMAT,
            version: 1,
            material,
        };
        let plan_digest =
            digest_canonical_serialized(RECEIPT_ZERO_INITIALIZER_PLAN_DOMAIN, &canonical).unwrap();
        let single_flight_key = receipt_zero_initializer_single_flight_key(&plan_digest).unwrap();
        let dispatch_scope_key = receipt_zero_initializer_scope_key(
            &material.capture.provider_id,
            &material.capture.project_ref,
        )
        .unwrap();
        (plan_digest, single_flight_key, dispatch_scope_key)
    }

    fn assert_initializer_domain_mutation_changes_plan_only(
        material: &ReceiptZeroInitializerClaimMaterialV1,
        baseline: &(String, String, String),
    ) {
        let mutated = unchecked_initializer_identity(material);
        assert_ne!(mutated.0, baseline.0);
        assert_ne!(mutated.1, baseline.1);
        assert_eq!(mutated.2, baseline.2);
    }

    fn project_ref(index: usize) -> String {
        let mut value = vec![b'a'; 20];
        let mut remainder = index;
        for byte in value.iter_mut().rev() {
            *byte = b'a' + u8::try_from(remainder % 26).unwrap();
            remainder /= 26;
        }
        String::from_utf8(value).unwrap()
    }

    fn claimed_record(operation: TrustedOperationPlanV1) -> BackendOperationRecordV1 {
        BackendOperationRecordV1 {
            single_flight_key: operation.single_flight_key,
            dispatch_scope_key: operation.dispatch_scope_key,
            provider_id: operation.provider_id,
            project_id: operation.project_id,
            operation_kind: operation.operation_kind,
            release_id: operation.release_id,
            owner_id: operation.owner_id,
            plan_digest: operation.plan_digest,
            claimed_at_unix_ms: WALL_START,
            claim_lease_expires_at_unix_ms: WALL_START
                + u64::try_from(CLAIM_LEASE.as_millis()).unwrap(),
            revision: 1,
            state: OperationStateV1::Claimed,
            transitioned_at_unix_ms: None,
            code: None,
            progress_evidence: None,
            final_evidence: None,
            reconciliation_lease: None,
        }
    }

    fn initializer_outcome_unknown_for_test(
        journal: &BackendOperationJournalV1,
        label: &str,
        project_ref: &str,
    ) -> (
        String,
        ReceiptZeroInitializerClaimMaterialV1,
        ReceiptZeroInitializerJournalDispatchV1,
    ) {
        let material = initializer_material(label, project_ref);
        let claim = journal
            .claim_receipt_zero_initializer_for_test(material.clone())
            .unwrap();
        let single_flight_key = claim.single_flight_key_for_test().to_owned();
        let dispatch = journal
            .precommit_receipt_zero_initializer_for_test(claim)
            .unwrap();
        (single_flight_key, material, dispatch)
    }

    fn settle_applied(
        journal: &BackendOperationJournalV1,
        operation: TrustedOperationPlanV1,
    ) -> String {
        let key = operation.single_flight_key.clone();
        let claim = journal.claim_for_test(operation).unwrap();
        let permit = journal
            .precommit_for_test(claim, json!({"stage": "precommit"}))
            .unwrap();
        let attempt = journal.consume_dispatch_permit_for_test(permit).unwrap();
        let settlement = journal.mark_dispatch_started_for_test(attempt).unwrap();
        journal
            .settle_dispatch_for_test(
                settlement,
                OperationStateV1::Applied,
                json!({"remoteLedgerObserved": true}),
            )
            .unwrap();
        key
    }

    #[test]
    fn automation_cas_claim_is_canonical_and_fences_exact_database_head_scope() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let journal = confirmed_journal(&temp, clock, Arc::new(CounterEntropy::new()));
        let material = automation_cas_material("first");
        let (expected_plan, expected_identity) = automation_cas_plan(&material).unwrap();
        assert_eq!(expected_plan.owner_id, AUTOMATION_CAS_OWNER);
        assert_eq!(
            expected_plan.release_id,
            format!(
                "{AUTOMATION_CAS_RELEASE_PREFIX}{}",
                expected_identity.plan_digest
            )
        );
        assert_eq!(expected_plan.single_flight_key.len(), 43);
        assert_eq!(expected_plan.dispatch_scope_key.len(), 43);

        let claim = journal
            .claim_automation_cas(
                SealedAutomationCasRecoveryReviewProofV1::issue_for_test(material.clone()).unwrap(),
            )
            .unwrap();
        assert!(claim.identity == expected_identity);
        assert!(claim.material == material);

        assert!(matches!(
            journal.claim_automation_cas(
                SealedAutomationCasRecoveryReviewProofV1::issue_for_test(material.clone()).unwrap()
            ),
            Err(JournalError::Conflict)
        ));

        let mut changed_review = material;
        changed_review.cas_review_digest = digest_bytes(b"changed-reviewed-cas");
        assert!(matches!(
            journal.claim_automation_cas(
                SealedAutomationCasRecoveryReviewProofV1::issue_for_test(changed_review).unwrap()
            ),
            Err(JournalError::ScopeConflict)
        ));

        journal
            .claim_automation_cas(
                SealedAutomationCasRecoveryReviewProofV1::issue_for_test(automation_cas_material(
                    "different-head",
                ))
                .unwrap(),
            )
            .unwrap();
    }

    #[test]
    fn automation_cas_restart_restores_exact_progress_material_and_consumes_one_read_lease() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let material = automation_cas_material("restart");
        let writer = confirmed_journal(&temp, clock.clone(), Arc::new(CounterEntropy::new()));
        let claim = writer
            .claim_automation_cas(
                SealedAutomationCasRecoveryReviewProofV1::issue_for_test(material.clone()).unwrap(),
            )
            .unwrap();
        let key = claim.identity.single_flight_key.clone();
        let outcome = writer.precommit_automation_cas_for_test(claim).unwrap();
        assert_eq!(outcome.single_flight_key_for_test(), key);

        let persisted = body(&writer).records.get(&key).unwrap().clone();
        assert_eq!(persisted.state, OperationStateV1::OutcomeUnknown);
        assert!(persisted.final_evidence.is_none());
        let progress: AutomationCasOutcomeUnknownProgressV1 =
            serde_json::from_str(&persisted.progress_evidence.as_ref().unwrap().payload).unwrap();
        assert!(progress.material == material);
        assert!(!progress.automatic_retry_allowed);
        assert!(!progress.mutation_authorized);
        assert!(!progress.execution_authorized);
        assert!(!progress.receipt_v2_issued);
        assert!(!progress.release_authorized);

        let restarted = confirmed_journal(&temp, clock.clone(), Arc::new(CounterEntropy::new()));
        assert!(matches!(
            restarted.reconstruct_automation_cas_for_test(&key),
            Err(JournalError::LeaseActive)
        ));
        clock.advance(CLAIM_LEASE);
        let recovery = restarted.reconstruct_automation_cas_for_test(&key).unwrap();
        assert!(recovery.material == material);
        let permit = restarted
            .begin_automation_cas_reconciliation_for_test(recovery)
            .unwrap();
        let attempt = restarted
            .consume_automation_cas_reconciliation_for_test(permit)
            .unwrap();
        assert!(attempt.material_for_composition() == &material);
        let persisted = body(&restarted).records.get(&key).unwrap().clone();
        let lease = persisted
            .reconciliation_lease
            .as_ref()
            .expect("durable Automation reconciliation lease");
        assert!(lease.consumed);
        assert_eq!(
            lease.expires_at_unix_ms - lease.issued_at_unix_ms,
            u64::try_from(AUTOMATION_CAS_RECONCILIATION_LEASE_TTL.as_millis()).unwrap()
        );
        assert!(AUTOMATION_CAS_RECONCILIATION_LEASE_TTL > CAPABILITY_TTL);
        assert_eq!(persisted.state, OperationStateV1::OutcomeUnknown);
        assert!(persisted.final_evidence.is_none());

        let competing = restarted.reconstruct_automation_cas_for_test(&key).unwrap();
        assert!(matches!(
            restarted.begin_automation_cas_reconciliation_for_test(competing),
            Err(JournalError::LeaseActive)
        ));

        clock.advance(CAPABILITY_TTL + Duration::from_millis(1));
        let after_runner_deadline = restarted
            .reconstruct_automation_cas_for_test(&key)
            .expect("OutcomeUnknown remains recoverable after runner deadline");
        assert!(matches!(
            restarted.begin_automation_cas_reconciliation_for_test(after_runner_deadline),
            Err(JournalError::LeaseActive)
        ));
    }

    #[test]
    fn automation_cas_recovery_rejects_tampered_journal_owned_material() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let journal = confirmed_journal(&temp, clock.clone(), Arc::new(CounterEntropy::new()));
        let claim = journal
            .claim_automation_cas(
                SealedAutomationCasRecoveryReviewProofV1::issue_for_test(automation_cas_material(
                    "tamper",
                ))
                .unwrap(),
            )
            .unwrap();
        let key = claim.identity.single_flight_key.clone();
        journal.precommit_automation_cas_for_test(claim).unwrap();

        let root = temp.path().join("app-data").join(STORE_DIRECTORY);
        let path = root.join(JOURNAL_FILE);
        let mut envelope: JournalEnvelopeV1 =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        let progress = envelope
            .body
            .records
            .get_mut(&key)
            .unwrap()
            .progress_evidence
            .as_mut()
            .unwrap();
        let mut payload: Value = serde_json::from_str(&progress.payload).unwrap();
        payload["material"]["casReviewDigest"] = Value::String(digest_bytes(b"forged-review"));
        progress.payload = serde_json::to_string(&payload).unwrap();
        progress.payload_digest = digest_bytes(progress.payload.as_bytes());
        envelope.body_digest = digest_bytes(&serde_json::to_vec(&envelope.body).unwrap());
        fs::write(&path, serde_json::to_vec(&envelope).unwrap()).unwrap();

        clock.advance(CLAIM_LEASE);
        let restarted = confirmed_journal(&temp, clock, Arc::new(CounterEntropy::new()));
        assert!(matches!(
            restarted.reconstruct_automation_cas_for_test(&key),
            Err(JournalError::Corrupt)
        ));
    }

    #[test]
    fn automation_cas_claimed_record_cannot_be_promoted_to_a_read_recovery() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let journal = confirmed_journal(&temp, clock.clone(), Arc::new(CounterEntropy::new()));
        let claim = journal
            .claim_automation_cas(
                SealedAutomationCasRecoveryReviewProofV1::issue_for_test(automation_cas_material(
                    "claimed-only",
                ))
                .unwrap(),
            )
            .unwrap();
        let key = claim.identity.single_flight_key.clone();
        drop(claim);
        clock.advance(CLAIM_LEASE);
        assert!(matches!(
            journal.reconstruct_automation_cas_for_test(&key),
            Err(JournalError::InvalidState)
        ));
        assert_eq!(
            body(&journal).records.get(&key).unwrap().state,
            OperationStateV1::Claimed
        );
    }

    #[test]
    fn automation_cas_terminal_states_fail_closed_even_through_the_generic_test_kernel() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let journal = confirmed_journal(&temp, clock, Arc::new(CounterEntropy::new()));
        let claim = journal
            .claim_automation_cas(
                SealedAutomationCasRecoveryReviewProofV1::issue_for_test(automation_cas_material(
                    "no-terminal",
                ))
                .unwrap(),
            )
            .unwrap();
        let key = claim.identity.single_flight_key.clone();
        let outcome = journal.precommit_automation_cas_for_test(claim).unwrap();
        assert!(matches!(
            journal.settle_dispatch_for_test(
                outcome._settlement,
                OperationStateV1::Applied,
                json!({"observed": true})
            ),
            Err(JournalError::Corrupt)
        ));
        let persisted = body(&journal).records.get(&key).unwrap().clone();
        assert_eq!(persisted.state, OperationStateV1::OutcomeUnknown);
        assert!(persisted.final_evidence.is_none());
    }

    #[test]
    fn receipt_zero_admission_fences_exact_and_semantic_replay_without_locking_mutations() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let journal = confirmed_journal(&temp, clock, Arc::new(CounterEntropy::new()));
        journal
            .claim_plan(admission_plan("first", "ledger-a"), CAPABILITY_TTL)
            .unwrap();
        assert!(matches!(
            journal.claim_plan(admission_plan("first", "ledger-a"), CAPABILITY_TTL),
            Err(JournalError::Conflict)
        ));
        assert!(matches!(
            journal.claim_plan(admission_plan("resigned", "ledger-a"), CAPABILITY_TTL),
            Err(JournalError::ScopeConflict)
        ));

        journal
            .claim_plan(admission_plan("next-migration", "ledger-b"), CAPABILITY_TTL)
            .unwrap();
        journal
            .claim_cas_ledger_install(SealedCasLedgerInstallReviewProofV1::issue_for_test(
                cas_ledger_install_material("installer", PROJECT_A),
            ))
            .unwrap();
        assert!(matches!(
            journal.claim_cas_ledger_install(SealedCasLedgerInstallReviewProofV1::issue_for_test(
                cas_ledger_install_material("different-installer-plan", PROJECT_A),
            )),
            Err(JournalError::ScopeConflict)
        ));

        let persisted = body(&journal);
        assert_eq!(persisted.records.len(), 3);
        assert_eq!(journal.list_unresolved().unwrap().len(), 1);
        assert_eq!(journal.source_ledger_admission_count_for_test().unwrap(), 2);
    }

    #[test]
    fn receipt_zero_initializer_cross_language_fixture_matches_canonical_identity() {
        let fixture = receipt_zero_initializer_fixture();
        assert_eq!(
            fixture.fixture_format,
            "openpencil.test.backend.supabase.receipt-zero-initializer-canonical.v1"
        );
        assert_eq!(fixture.fixture_version, 1);
        assert_eq!(fixture.initializer_format, RECEIPT_ZERO_INITIALIZER_FORMAT);
        assert_eq!(fixture.initializer_version, 1);
        assert_eq!(
            fixture.plan_domain.as_bytes(),
            RECEIPT_ZERO_INITIALIZER_PLAN_DOMAIN
        );
        assert_eq!(
            fixture.single_flight_domain.as_bytes(),
            RECEIPT_ZERO_INITIALIZER_SINGLE_FLIGHT_DOMAIN
        );
        assert_eq!(
            fixture.scope_domain.as_bytes(),
            RECEIPT_ZERO_INITIALIZER_SCOPE_DOMAIN
        );
        assert!(!fixture.capture_consumed);
        assert!(fixture.material == initializer_material("golden", PROJECT_A));

        let (plan, plan_digest) = receipt_zero_initializer_plan(&fixture.material).unwrap();
        assert_eq!(plan_digest, fixture.plan_digest);
        assert_eq!(plan.plan_digest, fixture.plan_digest);
        assert_eq!(plan.single_flight_key, fixture.single_flight_key);
        assert_eq!(plan.dispatch_scope_key, fixture.dispatch_scope_key);

        let baseline = unchecked_initializer_identity(&fixture.material);
        assert_eq!(baseline.0, fixture.plan_digest);
        assert_eq!(baseline.1, fixture.single_flight_key);
        assert_eq!(baseline.2, fixture.dispatch_scope_key);

        let mut source_mutation = fixture.material.clone();
        source_mutation.source.payload_digest = digest_bytes(b"fixture-source-mutation");
        assert_initializer_domain_mutation_changes_plan_only(&source_mutation, &baseline);

        let mut install_mutation = fixture.material.clone();
        install_mutation.installed.observed_at = "2027-01-01T00:00:01.000Z".to_owned();
        assert_initializer_domain_mutation_changes_plan_only(&install_mutation, &baseline);

        let mut inspection_mutation = fixture.material.clone();
        inspection_mutation.inspection.table_name = "tasks_v2".to_owned();
        assert_initializer_domain_mutation_changes_plan_only(&inspection_mutation, &baseline);
        assert!(matches!(
            receipt_zero_initializer_plan(&inspection_mutation),
            Err(JournalError::Invalid)
        ));

        let mut capture_mutation = fixture.material.clone();
        capture_mutation.capture.capture_digest = digest_bytes(b"fixture-capture-mutation");
        assert_initializer_domain_mutation_changes_plan_only(&capture_mutation, &baseline);

        let mut transaction_mutation = fixture.material.clone();
        transaction_mutation.transaction.query_version = "forged-query-version".to_owned();
        assert_initializer_domain_mutation_changes_plan_only(&transaction_mutation, &baseline);
        assert!(matches!(
            receipt_zero_initializer_plan(&transaction_mutation),
            Err(JournalError::Invalid)
        ));

        let mut unsafe_javascript_number = fixture.material.clone();
        unsafe_javascript_number.source.run_attempt = 9_007_199_254_740_992;
        assert!(matches!(
            receipt_zero_initializer_plan(&unsafe_javascript_number),
            Err(JournalError::Invalid)
        ));

        let mut unsupported_provider = fixture.material.clone();
        unsupported_provider.source.provider_id = "alternate-provider".to_owned();
        unsupported_provider.installed.provider_id = "alternate-provider".to_owned();
        unsupported_provider.inspection.provider_id = "alternate-provider".to_owned();
        unsupported_provider.capture.provider_id = "alternate-provider".to_owned();
        assert!(matches!(
            derive_receipt_zero_initializer_identity(&unsupported_provider),
            Err(JournalError::Invalid)
        ));

        let mut invalid_project = fixture.material.clone();
        invalid_project.source.project_ref = "abcdefghijklmnopqrs1".to_owned();
        invalid_project.installed.project_ref = "abcdefghijklmnopqrs1".to_owned();
        invalid_project.capture.project_ref = "abcdefghijklmnopqrs1".to_owned();
        assert!(matches!(
            derive_receipt_zero_initializer_identity(&invalid_project),
            Err(JournalError::Invalid)
        ));

        let moved = derive_receipt_zero_initializer_identity(&initializer_material(
            "golden",
            "bcdefghijklmnopqrstu",
        ))
        .unwrap();
        assert_ne!(moved.dispatch_scope_key, fixture.dispatch_scope_key);
        assert_ne!(moved.plan_digest, fixture.plan_digest);

        assert_ne!(
            receipt_zero_initializer_scope_key("alternate-provider", PROJECT_A).unwrap(),
            fixture.dispatch_scope_key
        );
        assert_ne!(
            receipt_zero_initializer_scope_key("supabase", "abcdefghijklmnopqrsu").unwrap(),
            fixture.dispatch_scope_key
        );

        let mut unknown_field: Value =
            serde_json::from_slice(RECEIPT_ZERO_INITIALIZER_FIXTURE_JSON).unwrap();
        unknown_field
            .as_object_mut()
            .unwrap()
            .insert("precommit".to_owned(), Value::Bool(true));
        assert!(
            serde_json::from_value::<ReceiptZeroInitializerGoldenFixtureV1>(unknown_field).is_err()
        );

        let mut nested_unknown: Value =
            serde_json::from_slice(RECEIPT_ZERO_INITIALIZER_FIXTURE_JSON).unwrap();
        nested_unknown
            .get_mut("material")
            .and_then(Value::as_object_mut)
            .and_then(|material| material.get_mut("capture"))
            .and_then(Value::as_object_mut)
            .unwrap()
            .insert(
                "credential".to_owned(),
                Value::String("forbidden".to_owned()),
            );
        assert!(
            serde_json::from_value::<ReceiptZeroInitializerGoldenFixtureV1>(nested_unknown)
                .is_err()
        );
    }

    #[test]
    fn receipt_zero_initializer_recovery_chunk_codec_enforces_exact_bounds() {
        assert_eq!(
            receipt_zero_initializer_recovery_encoded_length(
                RECEIPT_ZERO_INITIALIZER_RECOVERY_MAX_CANONICAL_BYTES
            )
            .unwrap(),
            RECEIPT_ZERO_INITIALIZER_RECOVERY_MAX_ENCODED_BYTES
        );

        let exact_chunk = vec![b'x'; 1_536];
        let exact_chunks = split_receipt_zero_initializer_recovery_chunks(&exact_chunk).unwrap();
        assert_eq!(exact_chunks.len(), 1);
        assert_eq!(
            exact_chunks[0].len(),
            RECEIPT_ZERO_INITIALIZER_RECOVERY_CHUNK_BYTES
        );
        assert_eq!(
            join_receipt_zero_initializer_recovery_chunks(exact_chunk.len(), &exact_chunks)
                .unwrap(),
            exact_chunk
        );

        let crosses_boundary = vec![b'y'; 1_537];
        let crossing_chunks =
            split_receipt_zero_initializer_recovery_chunks(&crosses_boundary).unwrap();
        assert_eq!(crossing_chunks.len(), 2);
        assert_eq!(
            crossing_chunks[0].len(),
            RECEIPT_ZERO_INITIALIZER_RECOVERY_CHUNK_BYTES
        );
        assert_eq!(crossing_chunks[1].len(), 4);

        let maximum = vec![b'z'; RECEIPT_ZERO_INITIALIZER_RECOVERY_MAX_CANONICAL_BYTES];
        let maximum_chunks = split_receipt_zero_initializer_recovery_chunks(&maximum).unwrap();
        assert_eq!(
            maximum_chunks.len(),
            RECEIPT_ZERO_INITIALIZER_RECOVERY_MAX_CHUNKS
        );
        assert_eq!(maximum_chunks.last().unwrap().len(), 684);
        assert_eq!(
            maximum_chunks.iter().map(String::len).sum::<usize>(),
            RECEIPT_ZERO_INITIALIZER_RECOVERY_MAX_ENCODED_BYTES
        );
        assert_eq!(
            join_receipt_zero_initializer_recovery_chunks(maximum.len(), &maximum_chunks).unwrap(),
            maximum
        );

        assert!(matches!(
            split_receipt_zero_initializer_recovery_chunks(&[]),
            Err(JournalError::Invalid)
        ));
        assert!(matches!(
            split_receipt_zero_initializer_recovery_chunks(&[b'x']),
            Err(JournalError::Invalid)
        ));
        assert!(matches!(
            split_receipt_zero_initializer_recovery_chunks(&vec![
                b'x';
                RECEIPT_ZERO_INITIALIZER_RECOVERY_MAX_CANONICAL_BYTES
                    + 1
            ]),
            Err(JournalError::Invalid)
        ));

        let mut short_nonfinal = crossing_chunks.clone();
        short_nonfinal[0].pop();
        assert!(matches!(
            join_receipt_zero_initializer_recovery_chunks(crosses_boundary.len(), &short_nonfinal),
            Err(JournalError::Invalid)
        ));
        let mut oversized = crossing_chunks.clone();
        oversized[0].push('A');
        assert!(matches!(
            join_receipt_zero_initializer_recovery_chunks(crosses_boundary.len(), &oversized),
            Err(JournalError::Invalid)
        ));
        let mut nonstandard = crossing_chunks;
        nonstandard[0].replace_range(0..1, "-");
        assert!(matches!(
            join_receipt_zero_initializer_recovery_chunks(crosses_boundary.len(), &nonstandard),
            Err(JournalError::Invalid)
        ));
    }

    #[test]
    fn receipt_zero_initializer_recovery_round_trips_maximum_legal_source_text() {
        let mut material = initializer_material("maximum-legal", PROJECT_A);
        material.source.repository = "界".repeat(1_024);
        material.source.protected_ref = "界".repeat(1_024);
        validate_receipt_zero_initializer_material(&material).unwrap();
        assert_eq!(material.source.repository.encode_utf16().count(), 1_024);
        assert!(material.source.repository.len() > MAX_KEY_BYTES);

        let canonical = canonical_serialized_bytes(&material).unwrap();
        let recovery = receipt_zero_initializer_recovery_material(&material).unwrap();
        assert_eq!(recovery.format, RECEIPT_ZERO_INITIALIZER_RECOVERY_FORMAT);
        assert_eq!(
            recovery.encoding,
            RECEIPT_ZERO_INITIALIZER_RECOVERY_ENCODING
        );
        assert_eq!(recovery.version, 1);
        assert!(
            usize::try_from(recovery.canonical_byte_length).unwrap()
                <= RECEIPT_ZERO_INITIALIZER_RECOVERY_MAX_CANONICAL_BYTES
        );
        assert_eq!(
            usize::try_from(recovery.canonical_byte_length).unwrap(),
            canonical.len()
        );
        assert_eq!(recovery.canonical_digest, digest_bytes(&canonical));
        assert_eq!(recovery.chunks.concat(), STANDARD.encode(&canonical));
        assert!(recovery
            .chunks
            .iter()
            .all(|chunk| !chunk.is_empty() && chunk.len() <= MAX_KEY_BYTES));

        let encoded = serde_json::to_value(&recovery).unwrap();
        let restored = receipt_zero_initializer_material_from_recovery(
            serde_json::from_value(encoded).unwrap(),
        )
        .unwrap();
        assert!(restored == material);

        let identity = derive_receipt_zero_initializer_identity(&material).unwrap();
        let payload =
            receipt_zero_initializer_outcome_unknown_payload(&material, &identity.plan_digest)
                .unwrap();
        let serialized = validate_evidence_payload(&payload).unwrap();
        assert!(serialized.len() < MAX_EVIDENCE_BYTES);
        let mut nodes = 0;
        validate_evidence_value(&payload, 0, &mut nodes).unwrap();
        assert!(nodes < MAX_EVIDENCE_NODES);
    }

    #[test]
    fn receipt_zero_initializer_claim_is_canonical_durable_and_reopens_claimed() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let entropy = Arc::new(CounterEntropy::new());
        let journal = confirmed_journal(&temp, clock.clone(), entropy.clone());
        let material = initializer_material("happy", PROJECT_A);
        let expected_capture_digest = material.capture.capture_digest.clone();
        let expected_transaction = material.transaction.clone();
        let mut detached_transaction = expected_transaction.clone();
        let claim = journal
            .claim_receipt_zero_initializer_for_test(material)
            .unwrap();
        detached_transaction.parameters.execution_id = "execution:detached".to_owned();
        assert_eq!(
            claim.material_for_composition().capture.capture_digest,
            expected_capture_digest
        );
        assert!(claim.material_for_composition().transaction == expected_transaction);
        assert!(claim.material_for_composition().transaction != detached_transaction);
        assert_eq!(claim.plan_digest_for_test().len(), 43);
        assert_eq!(claim.single_flight_key_for_test().len(), 43);
        assert_eq!(
            journal.receipt_zero_initializer_count_for_test().unwrap(),
            1
        );
        assert!(journal.list_unresolved().unwrap().is_empty());

        let persisted = fs::read_to_string(
            temp.path()
                .join("app-data")
                .join(STORE_DIRECTORY)
                .join(JOURNAL_FILE),
        )
        .unwrap();
        assert!(!persisted.contains("inspectionSubjectDigest"));
        assert!(!persisted.contains("captureDigest"));
        assert!(!persisted.contains("canonicalScopeBase64"));
        assert!(!persisted.contains("canonicalReceiptBase64"));
        assert!(!persisted.contains(&expected_transaction.parameters.execution_id));
        assert!(!persisted.contains("application-happy"));

        let reopened = confirmed_journal(&temp, clock, entropy);
        assert_eq!(
            reopened.receipt_zero_initializer_count_for_test().unwrap(),
            1
        );
    }

    #[test]
    fn receipt_zero_initializer_precommit_durably_persists_exact_recovery_before_dispatch() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let journal = confirmed_journal(&temp, clock, Arc::new(CounterEntropy::new()));
        let material = initializer_material("precommit", PROJECT_A);
        let raw_execution_id = material.transaction.parameters.execution_id.clone();
        let claim = journal
            .claim_receipt_zero_initializer_for_test(material.clone())
            .unwrap();
        let key = claim.single_flight_key_for_test().to_owned();
        let before = fs::read_to_string(
            temp.path()
                .join("app-data")
                .join(STORE_DIRECTORY)
                .join(JOURNAL_FILE),
        )
        .unwrap();
        assert!(!before.contains(RECEIPT_ZERO_INITIALIZER_RECOVERY_FORMAT));
        assert!(!before.contains("\"chunks\""));

        let dispatch = journal
            .precommit_receipt_zero_initializer_for_test(claim)
            .unwrap();
        assert!(dispatch.material_for_test() == &material);
        assert_eq!(dispatch.single_flight_key_for_test(), key);
        assert_eq!(journal.runtime_lock().unwrap().permits.len(), 1);

        let persisted_body = body(&journal);
        let record = persisted_body.records.get(&key).unwrap();
        assert_eq!(record.state, OperationStateV1::OutcomeUnknown);
        assert_eq!(record.revision, 2);
        assert!(record.final_evidence.is_none());
        assert!(record.reconciliation_lease.is_none());
        let progress: ReceiptZeroInitializerOutcomeUnknownProgressV1 =
            serde_json::from_str(&record.progress_evidence.as_ref().unwrap().payload).unwrap();
        assert_eq!(
            progress.format,
            RECEIPT_ZERO_INITIALIZER_OUTCOME_UNKNOWN_PROGRESS_FORMAT
        );
        assert_eq!(progress.phase, "outcome-unknown");
        assert_eq!(progress.version, 1);
        assert!(!progress.automatic_retry_allowed);
        assert!(!progress.execution_authorized);
        assert!(!progress.mutation_authorized);
        assert!(!progress.receipt_v2_issued);
        assert!(!progress.release_authorized);
        assert_eq!(progress.plan_digest, record.plan_digest);
        assert!(progress
            .recovery
            .chunks
            .iter()
            .all(|chunk| !chunk.is_empty() && chunk.len() <= MAX_KEY_BYTES));
        let restored = receipt_zero_initializer_material_from_recovery(progress.recovery).unwrap();
        assert!(restored == material);

        let persisted = fs::read_to_string(
            temp.path()
                .join("app-data")
                .join(STORE_DIRECTORY)
                .join(JOURNAL_FILE),
        )
        .unwrap();
        assert!(persisted.contains(RECEIPT_ZERO_INITIALIZER_RECOVERY_FORMAT));
        assert!(!persisted.contains("canonicalScopeBase64"));
        assert!(!persisted.contains("canonicalReceiptBase64"));
        assert!(!persisted.contains(&raw_execution_id));
    }

    #[test]
    fn receipt_zero_initializer_staging_is_inert_and_bound_to_its_journal_instance() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let entropy = Arc::new(CounterEntropy::new());
        let journal = confirmed_journal(&temp, clock.clone(), entropy.clone());
        let claim = journal
            .claim_receipt_zero_initializer_for_test(initializer_material(
                "staged-instance",
                PROJECT_A,
            ))
            .unwrap();
        let staged = journal
            .stage_receipt_zero_initializer_outcome_unknown_for_test(claim)
            .unwrap();
        assert_eq!(staged.single_flight_key_for_test().len(), 43);
        assert!(journal.runtime_lock().unwrap().permits.is_empty());

        let foreign_temp = TempDir::new().unwrap();
        let foreign = confirmed_journal(&foreign_temp, clock, entropy);
        assert!(matches!(
            foreign.publish_receipt_zero_initializer_staged_dispatch_for_test(staged),
            Err(JournalError::InvalidState)
        ));
        assert!(journal.runtime_lock().unwrap().permits.is_empty());
        assert!(foreign.runtime_lock().unwrap().permits.is_empty());
    }

    #[test]
    fn dropping_receipt_zero_initializer_staging_never_publishes_authority() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let journal = confirmed_journal(&temp, clock, Arc::new(CounterEntropy::new()));
        let claim = journal
            .claim_receipt_zero_initializer_for_test(initializer_material("staged-drop", PROJECT_A))
            .unwrap();
        let staged = journal
            .stage_receipt_zero_initializer_outcome_unknown_for_test(claim)
            .unwrap();
        assert!(journal.runtime_lock().unwrap().permits.is_empty());
        drop(staged);
        assert!(journal.runtime_lock().unwrap().permits.is_empty());
        assert_eq!(
            journal
                .receipt_zero_initializer_outcome_unknown_count_for_test()
                .unwrap(),
            1
        );
    }

    #[test]
    fn receipt_zero_initializer_publish_rejects_record_tamper_and_active_read_lease() {
        let tamper_temp = TempDir::new().unwrap();
        let tamper_clock = Arc::new(ManualClock::new());
        let tamper = confirmed_journal(&tamper_temp, tamper_clock, Arc::new(CounterEntropy::new()));
        let tamper_claim = tamper
            .claim_receipt_zero_initializer_for_test(initializer_material(
                "staged-tamper",
                PROJECT_A,
            ))
            .unwrap();
        let tamper_key = tamper_claim.single_flight_key_for_test().to_owned();
        let tampered_stage = tamper
            .stage_receipt_zero_initializer_outcome_unknown_for_test(tamper_claim)
            .unwrap();
        rewrite_initializer_progress_for_test(&tamper_temp, &tamper_key, |progress| {
            progress["phase"] = Value::String("tampered".to_owned());
        });
        assert!(matches!(
            tamper.publish_receipt_zero_initializer_staged_dispatch_for_test(tampered_stage),
            Err(JournalError::Conflict | JournalError::Corrupt)
        ));
        assert!(tamper.runtime_lock().unwrap().permits.is_empty());

        let lease_temp = TempDir::new().unwrap();
        let lease_clock = Arc::new(ManualClock::new());
        let lease_entropy = Arc::new(CounterEntropy::new());
        let writer = confirmed_journal(&lease_temp, lease_clock.clone(), lease_entropy.clone());
        let lease_claim = writer
            .claim_receipt_zero_initializer_for_test(initializer_material(
                "staged-lease",
                PROJECT_A,
            ))
            .unwrap();
        let lease_key = lease_claim.single_flight_key_for_test().to_owned();
        let leased_stage = writer
            .stage_receipt_zero_initializer_outcome_unknown_for_test(lease_claim)
            .unwrap();
        lease_clock.advance(CLAIM_LEASE);
        let reconciler = confirmed_journal(&lease_temp, lease_clock, lease_entropy);
        let recovery = reconciler
            .reconstruct_receipt_zero_initializer_for_test(&lease_key)
            .unwrap();
        let _permit = reconciler
            .begin_receipt_zero_initializer_reconciliation_for_test(recovery)
            .unwrap();
        assert!(matches!(
            writer.publish_receipt_zero_initializer_staged_dispatch_for_test(leased_stage),
            Err(JournalError::Conflict | JournalError::CapabilityExpired)
        ));
        assert!(writer.runtime_lock().unwrap().permits.is_empty());
    }

    #[test]
    fn receipt_zero_initializer_slow_stage_fsync_never_shortens_the_fixed_runner() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let journal = journal(
            &temp,
            clock.clone(),
            Arc::new(CounterEntropy::new()),
            Arc::new(AdvanceClockOnDirectorySync {
                clock,
                wall_duration: Duration::from_millis(5_001),
                monotonic_duration: Duration::from_millis(5_001),
                advance_on_call: 2,
                calls: AtomicUsize::new(0),
            }),
        );
        let claim = journal
            .claim_receipt_zero_initializer_for_test(initializer_material(
                "staged-slow-fsync",
                PROJECT_A,
            ))
            .unwrap();
        let staged = journal
            .stage_receipt_zero_initializer_outcome_unknown_for_test(claim)
            .unwrap();
        assert!(matches!(
            journal.publish_receipt_zero_initializer_staged_dispatch_for_test(staged),
            Err(JournalError::CapabilityExpired)
        ));
        assert_eq!(
            journal
                .receipt_zero_initializer_outcome_unknown_count_for_test()
                .unwrap(),
            1
        );
        assert!(journal.runtime_lock().unwrap().permits.is_empty());
    }

    #[test]
    fn receipt_zero_initializer_b2b_issues_distinct_fixed_live_and_restart_windows() {
        let live_temp = TempDir::new().unwrap();
        let live_clock = Arc::new(ManualClock::new());
        let live_journal = confirmed_journal(
            &live_temp,
            live_clock.clone(),
            Arc::new(CounterEntropy::new()),
        );
        let (live_key, live_material, dispatch) =
            initializer_outcome_unknown_for_test(&live_journal, "b2b-live", PROJECT_A);
        let live = live_journal
            .issue_receipt_zero_initializer_live_run_window_for_test(dispatch)
            .unwrap();
        assert!(!live.database_authority_created_for_test());
        assert!(!live.execution_authorized_for_test());
        assert_eq!(live.single_flight_key_for_test(), live_key);
        assert!(live.material_for_test() == &live_material);
        let (issued_wall, expires_wall, issued_mono, expires_mono) = live.window_for_test();
        assert_eq!(
            expires_wall - issued_wall,
            u64::try_from(RECEIPT_ZERO_INITIALIZER_LIVE_PRECOMMIT_RUNNER_WINDOW.as_millis())
                .unwrap()
        );
        assert_eq!(
            expires_mono - issued_mono,
            RECEIPT_ZERO_INITIALIZER_LIVE_PRECOMMIT_RUNNER_WINDOW
        );
        assert_eq!(
            live_journal.runtime_lock().unwrap().dispatch_attempts.len(),
            1
        );

        let restart_temp = TempDir::new().unwrap();
        let restart_clock = Arc::new(ManualClock::new());
        let entropy = Arc::new(CounterEntropy::new());
        let writer = confirmed_journal(&restart_temp, restart_clock.clone(), entropy.clone());
        let (restart_key, restart_material, dispatch) =
            initializer_outcome_unknown_for_test(&writer, "b2b-restart", PROJECT_A);
        drop(dispatch);
        drop(writer);
        restart_clock.advance(CLAIM_LEASE);

        let restarted = confirmed_journal(&restart_temp, restart_clock, entropy);
        let recovery = restarted
            .reconstruct_receipt_zero_initializer_for_test(&restart_key)
            .unwrap();
        let permit = restarted
            .begin_receipt_zero_initializer_reconciliation_for_test(recovery)
            .unwrap();
        let leased = body(&restarted).records.get(&restart_key).unwrap().clone();
        assert_eq!(leased.revision, 3);
        let lease = leased.reconciliation_lease.as_ref().unwrap();
        assert_eq!(lease.generation, 1);
        assert!(!lease.consumed);
        assert_eq!(
            lease.expires_at_unix_ms - lease.issued_at_unix_ms,
            u64::try_from(RECEIPT_ZERO_INITIALIZER_RECONCILIATION_LEASE_TTL.as_millis()).unwrap()
        );

        let read = restarted
            .consume_receipt_zero_initializer_reconciliation_for_test(permit)
            .unwrap();
        assert!(!read.database_authority_created_for_test());
        assert!(!read.settlement_authorized_for_test());
        assert_eq!(read.single_flight_key_for_test(), restart_key);
        assert!(read.material_for_test() == &restart_material);
        let (issued_wall, expires_wall, issued_mono, expires_mono) = read.window_for_test();
        assert_eq!(
            expires_wall - issued_wall,
            u64::try_from(RECEIPT_ZERO_INITIALIZER_READ_RUNNER_WINDOW.as_millis()).unwrap()
        );
        assert_eq!(
            expires_mono - issued_mono,
            RECEIPT_ZERO_INITIALIZER_READ_RUNNER_WINDOW
        );
        let consumed = body(&restarted).records.get(&restart_key).unwrap().clone();
        assert_eq!(consumed.revision, 4);
        assert!(consumed.reconciliation_lease.unwrap().consumed);
        assert!(consumed.final_evidence.is_none());
        assert_eq!(
            restarted
                .runtime_lock()
                .unwrap()
                .reconciliation_observations
                .len(),
            1
        );
    }

    #[test]
    fn receipt_zero_initializer_b3b_consumes_exact_live_attempt_into_one_shot_ceiling() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let journal = confirmed_journal(&temp, clock.clone(), Arc::new(CounterEntropy::new()));
        let (_, _, dispatch) =
            initializer_outcome_unknown_for_test(&journal, "b3b-execution", PROJECT_A);
        let window = journal
            .issue_receipt_zero_initializer_live_run_window_for_test(dispatch)
            .unwrap();
        let ceiling = journal
            .consume_receipt_zero_initializer_live_run_window_for_execution_for_test(window)
            .unwrap();
        assert!(journal.runtime_lock().unwrap().dispatch_attempts.is_empty());

        let (active, remaining) = ceiling.activate_for_runner_for_test().unwrap();
        assert_eq!(remaining, Duration::from_secs(25));
        active.require_fresh_for_runner_for_test().unwrap();
        clock.advance_wall(Duration::from_secs(25));
        assert_eq!(
            active.require_fresh_for_runner_for_test(),
            Err(JournalError::CapabilityExpired)
        );
    }

    #[test]
    fn receipt_zero_initializer_b3b_rejects_all_sql_identifier_drift_before_claim() {
        assert!(
            validate_receipt_zero_precommit_identifier(&format!("a{}", ":".repeat(127))).is_ok()
        );
        for invalid in [
            format!("a{}", ":".repeat(128)),
            "-bad-first".to_owned(),
            "bad/id".to_owned(),
            "bad@id".to_owned(),
        ] {
            assert_eq!(
                validate_receipt_zero_precommit_identifier(&invalid),
                Err(JournalError::Invalid)
            );
        }
        type Mutator = fn(&mut ReceiptZeroInitializerTransactionParametersV1);
        let cases: [(&str, Mutator); 6] = [
            ("execution", |parameters| {
                parameters.execution_id = "bad/id".to_owned()
            }),
            ("application", |parameters| {
                parameters.application_id = "bad@app".to_owned()
            }),
            ("migration", |parameters| {
                parameters.migration_id = "bad/migration".to_owned()
            }),
            ("event", |parameters| {
                parameters.event_id = "bad/event".to_owned()
            }),
            ("receipt", |parameters| {
                parameters.receipt_id = "bad@receipt".to_owned()
            }),
            ("idempotency", |parameters| {
                parameters.idempotency_key = "bad/idempotency".to_owned()
            }),
        ];
        for (label, mutate) in cases {
            let temp = TempDir::new().unwrap();
            let clock = Arc::new(ManualClock::new());
            let journal = confirmed_journal(&temp, clock, Arc::new(CounterEntropy::new()));
            let mut material = initializer_material(&format!("identifier-{label}"), PROJECT_A);
            mutate(&mut material.transaction.parameters);
            assert!(
                matches!(
                    journal.claim_receipt_zero_initializer_for_test(material),
                    Err(JournalError::Invalid)
                ),
                "invalid {label} identifier reached Claimed"
            );
            let runtime = journal.runtime_lock().unwrap();
            assert!(runtime.claims.is_empty());
            assert!(runtime.permits.is_empty());
            drop(runtime);
            assert!(!temp
                .path()
                .join("app-data")
                .join(STORE_DIRECTORY)
                .join(JOURNAL_FILE)
                .exists());
        }
    }

    #[test]
    fn initializer_reconciliation_lease_blocks_restart_races_and_advances_generation_once() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let entropy = Arc::new(CounterEntropy::new());
        let writer = confirmed_journal(&temp, clock.clone(), entropy.clone());
        let (key, _, dispatch) =
            initializer_outcome_unknown_for_test(&writer, "lease-race", PROJECT_A);
        drop(dispatch);
        drop(writer);
        clock.advance(CLAIM_LEASE);

        let first = confirmed_journal(&temp, clock.clone(), entropy.clone());
        let second = confirmed_journal(&temp, clock.clone(), entropy.clone());
        let first_recovery = first
            .reconstruct_receipt_zero_initializer_for_test(&key)
            .unwrap();
        let second_recovery = second
            .reconstruct_receipt_zero_initializer_for_test(&key)
            .unwrap();
        let first_permit = first
            .begin_receipt_zero_initializer_reconciliation_for_test(first_recovery)
            .unwrap();
        assert!(matches!(
            second.begin_receipt_zero_initializer_reconciliation_for_test(second_recovery),
            Err(JournalError::Conflict)
        ));
        assert!(second.runtime_lock().unwrap().recoveries.is_empty());
        let observer = confirmed_journal(&temp, clock.clone(), entropy.clone());
        assert!(matches!(
            observer.reconstruct_receipt_zero_initializer_for_test(&key),
            Err(JournalError::LeaseActive)
        ));
        drop(first_permit);

        clock.advance(RECEIPT_ZERO_INITIALIZER_RECONCILIATION_LEASE_TTL);
        let after_expiry = confirmed_journal(&temp, clock, entropy);
        let second_generation = after_expiry
            .reconstruct_receipt_zero_initializer_for_test(&key)
            .and_then(|recovery| {
                after_expiry.begin_receipt_zero_initializer_reconciliation_for_test(recovery)
            })
            .unwrap();
        let unconsumed = body(&after_expiry).records.get(&key).unwrap().clone();
        let lease = unconsumed.reconciliation_lease.as_ref().unwrap();
        assert_eq!(lease.generation, 2);
        assert!(!lease.consumed);
        // Generation one expired without consumption, so generation two starts at revision four.
        assert_eq!(unconsumed.revision, 4);
        drop(
            after_expiry
                .consume_receipt_zero_initializer_reconciliation_for_test(second_generation)
                .unwrap(),
        );
        let consumed = body(&after_expiry).records.get(&key).unwrap().clone();
        assert_eq!(consumed.revision, 5);
        let lease = consumed.reconciliation_lease.unwrap();
        assert_eq!(lease.generation, 2);
        assert!(lease.consumed);
    }

    #[test]
    fn initializer_runways_require_complete_dual_clock_windows() {
        for (label, advance_wall, advance_monotonic) in [
            ("wall", Duration::from_millis(5_001), Duration::ZERO),
            ("monotonic", Duration::ZERO, Duration::from_millis(5_001)),
        ] {
            let temp = TempDir::new().unwrap();
            let clock = Arc::new(ManualClock::new());
            let journal = confirmed_journal(&temp, clock.clone(), Arc::new(CounterEntropy::new()));
            let (_, _, dispatch) = initializer_outcome_unknown_for_test(
                &journal,
                &format!("live-expiry-{label}"),
                PROJECT_A,
            );
            clock.advance_wall(advance_wall);
            clock.advance_monotonic(advance_monotonic);
            assert!(matches!(
                journal.issue_receipt_zero_initializer_live_run_window_for_test(dispatch),
                Err(JournalError::CapabilityExpired)
            ));
            assert!(journal.runtime_lock().unwrap().dispatch_attempts.is_empty());
        }

        let exact_temp = TempDir::new().unwrap();
        let exact_clock = Arc::new(ManualClock::new());
        let exact = confirmed_journal(
            &exact_temp,
            exact_clock.clone(),
            Arc::new(CounterEntropy::new()),
        );
        let (_, _, dispatch) =
            initializer_outcome_unknown_for_test(&exact, "live-exact", PROJECT_A);
        exact_clock.advance(Duration::from_secs(5));
        let window = exact
            .issue_receipt_zero_initializer_live_run_window_for_test(dispatch)
            .unwrap();
        let (issued_wall, expires_wall, issued_mono, expires_mono) = window.window_for_test();
        assert_eq!(expires_wall - issued_wall, 25_000);
        assert_eq!(expires_mono - issued_mono, Duration::from_secs(25));
    }

    #[test]
    fn initializer_reconciliation_post_fsync_expiry_persists_fence_without_authority() {
        // The third directory sync is reconciliation begin: claim and initializer precommit are
        // calls one and two. A 31-second pause expires the recovery capability and leaves less than
        // a full read window in the fixed 60-second durable lease.
        let begin_temp = TempDir::new().unwrap();
        let begin_clock = Arc::new(ManualClock::new());
        let begin_entropy = Arc::new(CounterEntropy::new());
        let begin_journal = journal(
            &begin_temp,
            begin_clock.clone(),
            begin_entropy,
            Arc::new(AdvanceClockOnDirectorySync {
                clock: begin_clock.clone(),
                wall_duration: Duration::from_secs(31),
                monotonic_duration: Duration::from_secs(31),
                advance_on_call: 3,
                calls: AtomicUsize::new(0),
            }),
        );
        let (begin_key, _, dispatch) =
            initializer_outcome_unknown_for_test(&begin_journal, "slow-begin", PROJECT_A);
        drop(dispatch);
        begin_clock.advance(CLAIM_LEASE);
        let recovery = begin_journal
            .reconstruct_receipt_zero_initializer_for_test(&begin_key)
            .unwrap();
        assert!(matches!(
            begin_journal.begin_receipt_zero_initializer_reconciliation_for_test(recovery),
            Err(JournalError::CapabilityExpired)
        ));
        let record = body(&begin_journal)
            .records
            .get(&begin_key)
            .unwrap()
            .clone();
        assert_eq!(record.revision, 3);
        assert!(!record.reconciliation_lease.unwrap().consumed);
        assert!(begin_journal
            .runtime_lock()
            .unwrap()
            .reconciliation_permits
            .is_empty());

        // The fourth sync is consume. Its durable consumed bit may be visible, but no read window
        // is published after the original permit expires during fsync.
        let consume_temp = TempDir::new().unwrap();
        let consume_clock = Arc::new(ManualClock::new());
        let consume_journal = journal(
            &consume_temp,
            consume_clock.clone(),
            Arc::new(CounterEntropy::new()),
            Arc::new(AdvanceClockOnDirectorySync {
                clock: consume_clock.clone(),
                wall_duration: Duration::from_secs(31),
                monotonic_duration: Duration::from_secs(31),
                advance_on_call: 4,
                calls: AtomicUsize::new(0),
            }),
        );
        let (consume_key, _, dispatch) =
            initializer_outcome_unknown_for_test(&consume_journal, "slow-consume", PROJECT_A);
        drop(dispatch);
        consume_clock.advance(CLAIM_LEASE);
        let permit = consume_journal
            .reconstruct_receipt_zero_initializer_for_test(&consume_key)
            .and_then(|recovery| {
                consume_journal.begin_receipt_zero_initializer_reconciliation_for_test(recovery)
            })
            .unwrap();
        assert!(matches!(
            consume_journal.consume_receipt_zero_initializer_reconciliation_for_test(permit),
            Err(JournalError::CapabilityExpired)
        ));
        let record = body(&consume_journal)
            .records
            .get(&consume_key)
            .unwrap()
            .clone();
        assert_eq!(record.revision, 4);
        assert!(record.reconciliation_lease.unwrap().consumed);
        assert!(consume_journal
            .runtime_lock()
            .unwrap()
            .reconciliation_observations
            .is_empty());
    }

    #[test]
    fn initializer_read_window_rejects_wall_or_monotonic_only_fsync_expiry() {
        for (label, wall_duration, monotonic_duration) in [
            ("wall", Duration::from_secs(31), Duration::ZERO),
            ("monotonic", Duration::ZERO, Duration::from_secs(31)),
        ] {
            let temp = TempDir::new().unwrap();
            let clock = Arc::new(ManualClock::new());
            let journal = journal(
                &temp,
                clock.clone(),
                Arc::new(CounterEntropy::new()),
                Arc::new(AdvanceClockOnDirectorySync {
                    clock: clock.clone(),
                    wall_duration,
                    monotonic_duration,
                    advance_on_call: 4,
                    calls: AtomicUsize::new(0),
                }),
            );
            let (key, _, dispatch) = initializer_outcome_unknown_for_test(
                &journal,
                &format!("read-single-clock-{label}"),
                PROJECT_A,
            );
            drop(dispatch);
            clock.advance(CLAIM_LEASE);
            let permit = journal
                .reconstruct_receipt_zero_initializer_for_test(&key)
                .and_then(|recovery| {
                    journal.begin_receipt_zero_initializer_reconciliation_for_test(recovery)
                })
                .unwrap();
            assert!(matches!(
                journal.consume_receipt_zero_initializer_reconciliation_for_test(permit),
                Err(JournalError::CapabilityExpired)
            ));
            assert!(
                body(&journal)
                    .records
                    .get(&key)
                    .unwrap()
                    .reconciliation_lease
                    .as_ref()
                    .unwrap()
                    .consumed
            );
            assert!(journal
                .runtime_lock()
                .unwrap()
                .reconciliation_observations
                .is_empty());
        }
    }

    #[test]
    fn initializer_authority_publish_rechecks_clock_after_final_runtime_lock_wait() {
        // Precommit: the second sync is already complete while the publisher waits for the final
        // runtime lock. Losing more than the five-second settlement margin must suppress dispatch.
        let precommit_temp = TempDir::new().unwrap();
        let precommit_clock = Arc::new(ManualClock::new());
        let entered = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));
        let precommit = Arc::new(journal(
            &precommit_temp,
            precommit_clock.clone(),
            Arc::new(CounterEntropy::new()),
            Arc::new(BlockingNthDirectorySync {
                block_on_call: 2,
                calls: AtomicUsize::new(0),
                entered: entered.clone(),
                release: release.clone(),
            }),
        ));
        let claim = precommit
            .claim_receipt_zero_initializer_for_test(initializer_material(
                "publish-lock-precommit",
                PROJECT_A,
            ))
            .unwrap();
        let worker_journal = precommit.clone();
        let worker = thread::spawn(move || {
            worker_journal.precommit_receipt_zero_initializer_for_test(claim)
        });
        entered.wait();
        let guard = precommit.runtime.lock().unwrap();
        release.wait();
        precommit_clock.advance(Duration::from_secs(6));
        drop(guard);
        assert!(matches!(
            worker.join().unwrap(),
            Err(JournalError::CapabilityExpired)
        ));
        assert!(precommit.runtime_lock().unwrap().permits.is_empty());

        // Begin: a 31-second final-lock wait expires the consumed recovery and leaves the durable
        // 60-second lease with insufficient room for a fresh 30-second permit.
        let begin_temp = TempDir::new().unwrap();
        let begin_clock = Arc::new(ManualClock::new());
        let entered = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));
        let begin = Arc::new(journal(
            &begin_temp,
            begin_clock.clone(),
            Arc::new(CounterEntropy::new()),
            Arc::new(BlockingNthDirectorySync {
                block_on_call: 3,
                calls: AtomicUsize::new(0),
                entered: entered.clone(),
                release: release.clone(),
            }),
        ));
        let (begin_key, _, dispatch) =
            initializer_outcome_unknown_for_test(&begin, "publish-lock-begin", PROJECT_A);
        drop(dispatch);
        begin_clock.advance(CLAIM_LEASE);
        let recovery = begin
            .reconstruct_receipt_zero_initializer_for_test(&begin_key)
            .unwrap();
        let worker_journal = begin.clone();
        let worker = thread::spawn(move || {
            worker_journal.begin_receipt_zero_initializer_reconciliation_for_test(recovery)
        });
        entered.wait();
        let guard = begin.runtime.lock().unwrap();
        release.wait();
        begin_clock.advance(Duration::from_secs(31));
        drop(guard);
        assert!(matches!(
            worker.join().unwrap(),
            Err(JournalError::CapabilityExpired)
        ));
        assert!(begin
            .runtime_lock()
            .unwrap()
            .reconciliation_permits
            .is_empty());

        // Consume: the durable consumed bit may land, but a late final lock can never receive a
        // shortened read attempt.
        let consume_temp = TempDir::new().unwrap();
        let consume_clock = Arc::new(ManualClock::new());
        let entered = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));
        let consume = Arc::new(journal(
            &consume_temp,
            consume_clock.clone(),
            Arc::new(CounterEntropy::new()),
            Arc::new(BlockingNthDirectorySync {
                block_on_call: 4,
                calls: AtomicUsize::new(0),
                entered: entered.clone(),
                release: release.clone(),
            }),
        ));
        let (consume_key, _, dispatch) =
            initializer_outcome_unknown_for_test(&consume, "publish-lock-consume", PROJECT_A);
        drop(dispatch);
        consume_clock.advance(CLAIM_LEASE);
        let permit = consume
            .reconstruct_receipt_zero_initializer_for_test(&consume_key)
            .and_then(|recovery| {
                consume.begin_receipt_zero_initializer_reconciliation_for_test(recovery)
            })
            .unwrap();
        let worker_journal = consume.clone();
        let worker = thread::spawn(move || {
            worker_journal.consume_receipt_zero_initializer_reconciliation_for_test(permit)
        });
        entered.wait();
        let guard = consume.runtime.lock().unwrap();
        release.wait();
        consume_clock.advance(Duration::from_secs(31));
        drop(guard);
        assert!(matches!(
            worker.join().unwrap(),
            Err(JournalError::CapabilityExpired)
        ));
        assert!(consume
            .runtime_lock()
            .unwrap()
            .reconciliation_observations
            .is_empty());

        // Live window: first block the read-only file check after its permit has been removed, then
        // hold the final runtime lock while the clock loses the five-second margin.
        let live_temp = TempDir::new().unwrap();
        let live_clock = Arc::new(ManualClock::new());
        let live = Arc::new(confirmed_journal(
            &live_temp,
            live_clock.clone(),
            Arc::new(CounterEntropy::new()),
        ));
        let (_, _, dispatch) =
            initializer_outcome_unknown_for_test(&live, "publish-lock-live", PROJECT_A);
        let dispatch_id = dispatch.permit.id;
        let file_entered = Arc::new(Barrier::new(2));
        let file_release = Arc::new(Barrier::new(2));
        let blocker_journal = live.clone();
        let blocker_entered = file_entered.clone();
        let blocker_release = file_release.clone();
        let blocker = thread::spawn(move || {
            blocker_journal.with_store(|_| {
                blocker_entered.wait();
                blocker_release.wait();
                Ok(())
            })
        });
        file_entered.wait();
        let worker_journal = live.clone();
        let worker = thread::spawn(move || {
            worker_journal.issue_receipt_zero_initializer_live_run_window_for_test(dispatch)
        });
        let deadline = Instant::now() + Duration::from_secs(1);
        loop {
            if !live
                .runtime
                .lock()
                .unwrap()
                .permits
                .contains_key(&dispatch_id)
            {
                break;
            }
            assert!(Instant::now() < deadline, "live permit was not consumed");
            thread::yield_now();
        }
        let guard = live.runtime.lock().unwrap();
        file_release.wait();
        live_clock.advance(Duration::from_secs(6));
        drop(guard);
        assert!(blocker.join().unwrap().is_ok());
        assert!(matches!(
            worker.join().unwrap(),
            Err(JournalError::CapabilityExpired)
        ));
        assert!(live.runtime_lock().unwrap().dispatch_attempts.is_empty());
    }

    #[test]
    fn unconfirmed_initializer_reconciliation_writes_never_publish_runtime_authority() {
        let begin_temp = TempDir::new().unwrap();
        let begin_clock = Arc::new(ManualClock::new());
        let begin_entropy = Arc::new(CounterEntropy::new());
        let begin = journal(
            &begin_temp,
            begin_clock.clone(),
            begin_entropy.clone(),
            Arc::new(FailAfterDirectorySync {
                successful_calls: 2,
                calls: AtomicUsize::new(0),
            }),
        );
        let (key, _, dispatch) =
            initializer_outcome_unknown_for_test(&begin, "unconfirmed-begin", PROJECT_A);
        drop(dispatch);
        begin_clock.advance(CLAIM_LEASE);
        let recovery = begin
            .reconstruct_receipt_zero_initializer_for_test(&key)
            .unwrap();
        assert!(matches!(
            begin.begin_receipt_zero_initializer_reconciliation_for_test(recovery),
            Err(JournalError::DurabilityUnconfirmed)
        ));
        assert!(begin
            .runtime_lock()
            .unwrap()
            .reconciliation_permits
            .is_empty());
        let visible = confirmed_journal(&begin_temp, begin_clock.clone(), begin_entropy);
        let record = body(&visible).records.get(&key).unwrap().clone();
        assert_eq!(record.revision, 3);
        assert!(!record.reconciliation_lease.as_ref().unwrap().consumed);
        assert!(matches!(
            visible.reconstruct_receipt_zero_initializer_for_test(&key),
            Err(JournalError::LeaseActive)
        ));
        begin_clock.advance(RECEIPT_ZERO_INITIALIZER_RECONCILIATION_LEASE_TTL);
        let next = visible
            .reconstruct_receipt_zero_initializer_for_test(&key)
            .and_then(|recovery| {
                visible.begin_receipt_zero_initializer_reconciliation_for_test(recovery)
            })
            .unwrap();
        drop(next);
        assert_eq!(
            body(&visible)
                .records
                .get(&key)
                .unwrap()
                .reconciliation_lease
                .as_ref()
                .unwrap()
                .generation,
            2
        );

        let consume_temp = TempDir::new().unwrap();
        let consume_clock = Arc::new(ManualClock::new());
        let consume_entropy = Arc::new(CounterEntropy::new());
        let consume = journal(
            &consume_temp,
            consume_clock.clone(),
            consume_entropy.clone(),
            Arc::new(FailAfterDirectorySync {
                successful_calls: 3,
                calls: AtomicUsize::new(0),
            }),
        );
        let (key, _, dispatch) =
            initializer_outcome_unknown_for_test(&consume, "unconfirmed-consume", PROJECT_A);
        drop(dispatch);
        consume_clock.advance(CLAIM_LEASE);
        let permit = consume
            .reconstruct_receipt_zero_initializer_for_test(&key)
            .and_then(|recovery| {
                consume.begin_receipt_zero_initializer_reconciliation_for_test(recovery)
            })
            .unwrap();
        assert!(matches!(
            consume.consume_receipt_zero_initializer_reconciliation_for_test(permit),
            Err(JournalError::DurabilityUnconfirmed)
        ));
        assert!(consume
            .runtime_lock()
            .unwrap()
            .reconciliation_observations
            .is_empty());
        let visible = confirmed_journal(&consume_temp, consume_clock.clone(), consume_entropy);
        let record = body(&visible).records.get(&key).unwrap().clone();
        assert_eq!(record.revision, 4);
        assert!(record.reconciliation_lease.unwrap().consumed);
        assert!(matches!(
            visible.reconstruct_receipt_zero_initializer_for_test(&key),
            Err(JournalError::LeaseActive)
        ));
        consume_clock.advance(RECEIPT_ZERO_INITIALIZER_RECONCILIATION_LEASE_TTL);
        let next = visible
            .reconstruct_receipt_zero_initializer_for_test(&key)
            .and_then(|recovery| {
                visible.begin_receipt_zero_initializer_reconciliation_for_test(recovery)
            })
            .unwrap();
        drop(next);
        assert_eq!(
            body(&visible)
                .records
                .get(&key)
                .unwrap()
                .reconciliation_lease
                .as_ref()
                .unwrap()
                .generation,
            2
        );
    }

    #[test]
    fn receipt_zero_initializer_restart_recovers_only_outcome_unknown_after_quiet_period() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let entropy = Arc::new(CounterEntropy::new());
        let journal = confirmed_journal(&temp, clock.clone(), entropy.clone());
        let material = initializer_material("restart", PROJECT_A);
        let claim = journal
            .claim_receipt_zero_initializer_for_test(material.clone())
            .unwrap();
        let key = claim.single_flight_key_for_test().to_owned();
        drop(
            journal
                .precommit_receipt_zero_initializer_for_test(claim)
                .unwrap(),
        );
        drop(journal);

        let restarted = confirmed_journal(&temp, clock.clone(), entropy);
        assert!(matches!(
            restarted.reconstruct_receipt_zero_initializer_for_test(&key),
            Err(JournalError::LeaseActive)
        ));
        clock.advance(CLAIM_LEASE);
        let recovery = restarted
            .reconstruct_receipt_zero_initializer_for_test(&key)
            .unwrap();
        assert_eq!(recovery.single_flight_key_for_test(), key);
        assert!(recovery.material_for_test() == &material);
        let record = body(&restarted).records.get(&key).unwrap().clone();
        assert_eq!(record.state, OperationStateV1::OutcomeUnknown);
        assert_eq!(record.revision, 2);
        assert!(record.reconciliation_lease.is_none());
        assert!(record.final_evidence.is_none());
    }

    #[test]
    fn receipt_zero_initializer_reconstruct_rechecks_freshness_before_runtime_publish() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let journal = confirmed_journal(&temp, clock.clone(), Arc::new(CounterEntropy::new()));
        let claim = journal
            .claim_receipt_zero_initializer_for_test(initializer_material(
                "reconstruct-expiry",
                PROJECT_A,
            ))
            .unwrap();
        let key = claim.single_flight_key_for_test().to_owned();
        drop(
            journal
                .precommit_receipt_zero_initializer_for_test(claim)
                .unwrap(),
        );
        drop(journal);
        clock.advance(CLAIM_LEASE);

        let restarted = confirmed_journal(
            &temp,
            clock.clone(),
            Arc::new(AdvanceWallEntropy {
                clock,
                duration: CAPABILITY_TTL,
                next: AtomicU64::new(900),
            }),
        );
        assert!(matches!(
            restarted.reconstruct_receipt_zero_initializer_for_test(&key),
            Err(JournalError::CapabilityExpired)
        ));
        let runtime = restarted.runtime_lock().unwrap();
        assert!(runtime.reserved.is_empty());
        assert!(runtime.recoveries.is_empty());
    }

    #[test]
    fn receipt_zero_initializer_claimed_restart_has_no_recovery_material_or_path() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let entropy = Arc::new(CounterEntropy::new());
        let journal = confirmed_journal(&temp, clock.clone(), entropy.clone());
        let claim = journal
            .claim_receipt_zero_initializer_for_test(initializer_material(
                "claimed-restart",
                PROJECT_A,
            ))
            .unwrap();
        let key = claim.single_flight_key_for_test().to_owned();
        drop(claim);
        drop(journal);
        clock.advance(CLAIM_LEASE + CAPABILITY_TTL);
        let restarted = confirmed_journal(&temp, clock, entropy);
        assert!(matches!(
            restarted.reconstruct_receipt_zero_initializer_for_test(&key),
            Err(JournalError::InvalidState)
        ));
        let record = body(&restarted).records.get(&key).unwrap().clone();
        assert_eq!(record.state, OperationStateV1::Claimed);
        assert!(record.progress_evidence.is_none());
    }

    #[test]
    fn unconfirmed_initializer_precommit_issues_no_dispatch_but_restart_recovers_durable_ou() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let entropy = Arc::new(CounterEntropy::new());
        let journal = journal(
            &temp,
            clock.clone(),
            entropy.clone(),
            Arc::new(FailAfterDirectorySync {
                successful_calls: 1,
                calls: AtomicUsize::new(0),
            }),
        );
        let material = initializer_material("unconfirmed-precommit", PROJECT_A);
        let claim = journal
            .claim_receipt_zero_initializer_for_test(material.clone())
            .unwrap();
        let key = claim.single_flight_key_for_test().to_owned();
        assert!(matches!(
            journal.precommit_receipt_zero_initializer_for_test(claim),
            Err(JournalError::DurabilityUnconfirmed)
        ));
        assert!(journal.runtime_lock().unwrap().permits.is_empty());
        assert_eq!(
            body(&confirmed_journal(&temp, clock.clone(), entropy.clone()))
                .records
                .get(&key)
                .unwrap()
                .state,
            OperationStateV1::OutcomeUnknown
        );

        clock.advance(CLAIM_LEASE);
        let restarted = confirmed_journal(&temp, clock, entropy);
        let recovery = restarted
            .reconstruct_receipt_zero_initializer_for_test(&key)
            .unwrap();
        assert!(recovery.material_for_test() == &material);
    }

    #[test]
    fn receipt_zero_initializer_restart_rejects_rechecksummed_progress_tampering() {
        let tamper_cases: [(&str, fn(&mut Value)); 20] = [
            ("format", |payload| {
                payload["format"] = Value::String("forged-format".to_owned())
            }),
            ("version", |payload| payload["version"] = Value::from(2)),
            ("phase", |payload| {
                payload["phase"] = Value::String("applied".to_owned())
            }),
            ("plan-digest", |payload| {
                payload["planDigest"] = Value::String(digest_bytes(b"forged-plan"))
            }),
            ("retry", |payload| {
                payload["automaticRetryAllowed"] = Value::Bool(true)
            }),
            ("execution", |payload| {
                payload["executionAuthorized"] = Value::Bool(true)
            }),
            ("mutation", |payload| {
                payload["mutationAuthorized"] = Value::Bool(true)
            }),
            ("receipt", |payload| {
                payload["receiptV2Issued"] = Value::Bool(true)
            }),
            ("release", |payload| {
                payload["releaseAuthorized"] = Value::Bool(true)
            }),
            ("recovery-format", |payload| {
                payload["recovery"]["format"] = Value::String("forged-recovery".to_owned())
            }),
            ("recovery-version", |payload| {
                payload["recovery"]["version"] = Value::from(2)
            }),
            ("encoding", |payload| {
                payload["recovery"]["encoding"] = Value::String("base64url".to_owned())
            }),
            ("length", |payload| {
                payload["recovery"]["canonicalByteLength"] = Value::from(0)
            }),
            ("digest", |payload| {
                payload["recovery"]["canonicalDigest"] =
                    Value::String(digest_bytes(b"forged-canonical"))
            }),
            ("empty-chunk", |payload| {
                payload["recovery"]["chunks"][0] = Value::String(String::new())
            }),
            ("oversized-chunk", |payload| {
                payload["recovery"]["chunks"][0] =
                    Value::String("A".repeat(RECEIPT_ZERO_INITIALIZER_RECOVERY_CHUNK_BYTES + 1))
            }),
            ("non-standard-base64", |payload| {
                let chunk = payload["recovery"]["chunks"][0]
                    .as_str()
                    .unwrap()
                    .to_owned();
                payload["recovery"]["chunks"][0] = Value::String(format!("-{}", &chunk[1..]));
            }),
            ("too-many-chunks", |payload| {
                payload["recovery"]["chunks"] = Value::Array(vec![
                    Value::String("AAAA".to_owned());
                    RECEIPT_ZERO_INITIALIZER_RECOVERY_MAX_CHUNKS
                        + 1
                ]);
            }),
            ("reordered-chunks", |payload| {
                payload["recovery"]["chunks"]
                    .as_array_mut()
                    .unwrap()
                    .swap(0, 1);
            }),
            ("unknown-field", |payload| {
                payload["recovery"]
                    .as_object_mut()
                    .unwrap()
                    .insert("unexpected".to_owned(), Value::Bool(false));
            }),
        ];
        for (label, tamper) in tamper_cases {
            let temp = TempDir::new().unwrap();
            let clock = Arc::new(ManualClock::new());
            let entropy = Arc::new(CounterEntropy::new());
            let journal = confirmed_journal(&temp, clock.clone(), entropy.clone());
            let claim = journal
                .claim_receipt_zero_initializer_for_test(initializer_material(
                    &format!("tamper-{label}"),
                    PROJECT_A,
                ))
                .unwrap();
            let key = claim.single_flight_key_for_test().to_owned();
            drop(
                journal
                    .precommit_receipt_zero_initializer_for_test(claim)
                    .unwrap(),
            );
            drop(journal);
            rewrite_initializer_progress_for_test(&temp, &key, tamper);
            clock.advance(CLAIM_LEASE);
            let restarted = confirmed_journal(&temp, clock, entropy);
            assert!(
                matches!(
                    restarted.reconstruct_receipt_zero_initializer_for_test(&key),
                    Err(JournalError::Corrupt)
                ),
                "tamper case must fail closed: {label}"
            );
        }
    }

    #[test]
    fn receipt_zero_initializer_restart_rejects_valid_recovery_bound_to_another_plan() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let entropy = Arc::new(CounterEntropy::new());
        let journal = confirmed_journal(&temp, clock.clone(), entropy.clone());
        let material = initializer_material("cross-bound", PROJECT_A);
        let claim = journal
            .claim_receipt_zero_initializer_for_test(material.clone())
            .unwrap();
        let key = claim.single_flight_key_for_test().to_owned();
        drop(
            journal
                .precommit_receipt_zero_initializer_for_test(claim)
                .unwrap(),
        );
        drop(journal);

        let mut other_material = material;
        other_material.source.repository.push_str("-other");
        validate_receipt_zero_initializer_material(&other_material).unwrap();
        let other_recovery = serde_json::to_value(
            receipt_zero_initializer_recovery_material(&other_material).unwrap(),
        )
        .unwrap();
        rewrite_initializer_progress_for_test(&temp, &key, move |payload| {
            payload["recovery"] = other_recovery;
        });
        clock.advance(CLAIM_LEASE);
        let restarted = confirmed_journal(&temp, clock, entropy);
        assert!(matches!(
            restarted.reconstruct_receipt_zero_initializer_for_test(&key),
            Err(JournalError::Corrupt)
        ));
    }

    #[test]
    fn receipt_zero_initializer_outcome_unknown_rejects_unexpected_revision() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let entropy = Arc::new(CounterEntropy::new());
        let journal = confirmed_journal(&temp, clock.clone(), entropy.clone());
        let claim = journal
            .claim_receipt_zero_initializer_for_test(initializer_material("revision", PROJECT_A))
            .unwrap();
        let key = claim.single_flight_key_for_test().to_owned();
        drop(
            journal
                .precommit_receipt_zero_initializer_for_test(claim)
                .unwrap(),
        );
        drop(journal);
        let path = temp
            .path()
            .join("app-data")
            .join(STORE_DIRECTORY)
            .join(JOURNAL_FILE);
        let mut envelope: JournalEnvelopeV1 =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        envelope.body.records.get_mut(&key).unwrap().revision = 3;
        envelope.body_digest = digest_bytes(&serde_json::to_vec(&envelope.body).unwrap());
        fs::write(path, serde_json::to_vec(&envelope).unwrap()).unwrap();
        clock.advance(CLAIM_LEASE);
        let restarted = confirmed_journal(&temp, clock, entropy);
        assert!(matches!(
            restarted.reconstruct_receipt_zero_initializer_for_test(&key),
            Err(JournalError::Corrupt)
        ));
    }

    #[test]
    fn initializer_reconciliation_revision_windows_are_checked_without_overflow() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let journal = confirmed_journal(&temp, clock, Arc::new(CounterEntropy::new()));
        let (key, _, dispatch) =
            initializer_outcome_unknown_for_test(&journal, "revision-windows", PROJECT_A);
        drop(dispatch);
        let baseline = body(&journal).records.get(&key).unwrap().clone();
        let lease = |generation: u64, consumed: bool| ReconciliationLeaseRecordV1 {
            generation,
            authority_digest: digest_bytes(format!("authority-{generation}").as_bytes()),
            issued_at_unix_ms: WALL_START,
            expires_at_unix_ms: WALL_START
                + u64::try_from(RECEIPT_ZERO_INITIALIZER_RECONCILIATION_LEASE_TTL.as_millis())
                    .unwrap(),
            consumed,
        };

        for (generation, consumed, revisions) in [
            (1, false, vec![3]),
            (1, true, vec![4]),
            (2, false, vec![4, 5]),
            (2, true, vec![5, 6]),
            (3, false, vec![5, 6, 7]),
            (3, true, vec![6, 7, 8]),
        ] {
            for revision in revisions {
                let mut record = baseline.clone();
                record.revision = revision;
                record.reconciliation_lease = Some(lease(generation, consumed));
                validate_record(&record).unwrap_or_else(|error| {
                    panic!(
                        "legal generation {generation} consumed={consumed} revision={revision}: {error:?}"
                    )
                });
            }
        }

        for (generation, consumed, revision) in [
            (1, false, 2),
            (1, false, 4),
            (1, true, 3),
            (1, true, 5),
            (2, false, 3),
            (2, false, 6),
            (2, true, 4),
            (2, true, 7),
            (u64::MAX, false, u64::MAX),
            (u64::MAX, true, u64::MAX),
        ] {
            let mut record = baseline.clone();
            record.revision = revision;
            record.reconciliation_lease = Some(lease(generation, consumed));
            assert!(matches!(
                validate_record(&record),
                Err(JournalError::Corrupt)
            ));
        }
    }

    #[test]
    fn initializer_reconciliation_rejects_runtime_and_durable_authority_tampering() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let entropy = Arc::new(CounterEntropy::new());
        let journal = confirmed_journal(&temp, clock.clone(), entropy);
        let (key, _, dispatch) =
            initializer_outcome_unknown_for_test(&journal, "lease-tamper", PROJECT_A);
        drop(dispatch);
        clock.advance(CLAIM_LEASE);
        let permit = journal
            .reconstruct_receipt_zero_initializer_for_test(&key)
            .and_then(|recovery| {
                journal.begin_receipt_zero_initializer_reconciliation_for_test(recovery)
            })
            .unwrap();
        let permit_id = permit.permit.id;
        let path = temp
            .path()
            .join("app-data")
            .join(STORE_DIRECTORY)
            .join(JOURNAL_FILE);
        let mut envelope: JournalEnvelopeV1 =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        let record = envelope.body.records.get_mut(&key).unwrap();
        record
            .reconciliation_lease
            .as_mut()
            .unwrap()
            .authority_digest = digest_bytes(b"forged-initializer-lease-authority");
        let forged_record_digest = record_digest(record).unwrap();
        envelope.body_digest = digest_bytes(&serde_json::to_vec(&envelope.body).unwrap());
        fs::write(&path, serde_json::to_vec(&envelope).unwrap()).unwrap();
        journal
            .runtime_lock()
            .unwrap()
            .reconciliation_permits
            .get_mut(&permit_id)
            .unwrap()
            .binding
            .record_digest = forged_record_digest;

        assert!(matches!(
            journal.consume_receipt_zero_initializer_reconciliation_for_test(permit),
            Err(JournalError::InvalidState)
        ));
        assert!(journal
            .runtime_lock()
            .unwrap()
            .reconciliation_permits
            .is_empty());
        assert!(journal
            .runtime_lock()
            .unwrap()
            .reconciliation_observations
            .is_empty());
    }

    #[test]
    fn receipt_zero_initializer_blocks_exact_replay_and_changed_same_project_scope() {
        let temp = TempDir::new().unwrap();
        let journal = confirmed_journal(
            &temp,
            Arc::new(ManualClock::new()),
            Arc::new(CounterEntropy::new()),
        );
        let original = initializer_material("replay", PROJECT_A);
        drop(
            journal
                .claim_receipt_zero_initializer_for_test(original.clone())
                .unwrap(),
        );
        assert!(matches!(
            journal.claim_receipt_zero_initializer_for_test(original),
            Err(JournalError::Conflict)
        ));
        let changed = initializer_material("changed", PROJECT_A);
        assert!(matches!(
            journal.claim_receipt_zero_initializer_for_test(changed),
            Err(JournalError::ScopeConflict)
        ));
    }

    #[test]
    fn receipt_zero_initializer_rejects_tampered_transaction_material_before_writing() {
        let mutations: [fn(&mut ReceiptZeroInitializerClaimMaterialV1); 12] = [
            |material| material.transaction.query_version = "forged-version".to_owned(),
            |material| material.transaction.transaction_sql_digest = digest_bytes(b"forged-sql"),
            |material| {
                material.transaction.parameter_schema_digest = digest_bytes(b"forged-schema")
            },
            |material| {
                material.transaction.parameter_values_digest = digest_bytes(b"forged-values")
            },
            |material| {
                material.transaction.parameters.execution_id = "invalid identifier".to_owned()
            },
            |material| {
                material.transaction.parameters.application_digest = digest_bytes(b"crosswire")
            },
            |material| {
                material
                    .transaction
                    .parameters
                    .canonical_scope_base64
                    .push('=')
            },
            |material| {
                material.transaction.parameters.canonical_receipt_base64 = STANDARD.encode(b"{}")
            },
            |material| {
                material.transaction.parameters.candidate_committed_at =
                    "2027-01-01T00:00:03Z".to_owned()
            },
            |material| {
                material
                    .transaction
                    .parameters
                    .initial_remaining_target_row_count += 1
            },
            |material| material.transaction.parameters.required_batch_count += 1,
            |material| {
                material.transaction.parameters.receipt_digest = digest_bytes(b"forged-receipt")
            },
        ];
        for (index, mutate) in mutations.into_iter().enumerate() {
            let temp = TempDir::new().unwrap();
            let journal = confirmed_journal(
                &temp,
                Arc::new(ManualClock::new()),
                Arc::new(CounterEntropy::new()),
            );
            let mut material = initializer_material(&format!("tampered-{index}"), PROJECT_A);
            mutate(&mut material);
            assert!(matches!(
                journal.claim_receipt_zero_initializer_for_test(material),
                Err(JournalError::Invalid)
            ));
            assert_eq!(
                journal.receipt_zero_initializer_count_for_test().unwrap(),
                0
            );
        }
    }

    #[test]
    fn receipt_zero_initializer_requires_distinct_write_grants_and_causal_capture_time() {
        let reject = |label: &str, mutate: fn(&mut ReceiptZeroInitializerClaimMaterialV1)| {
            let temp = TempDir::new().unwrap();
            let journal = confirmed_journal(
                &temp,
                Arc::new(ManualClock::new()),
                Arc::new(CounterEntropy::new()),
            );
            let mut material = initializer_material(label, PROJECT_A);
            mutate(&mut material);
            assert!(matches!(
                journal.claim_receipt_zero_initializer_for_test(material),
                Err(JournalError::Invalid)
            ));
            assert_eq!(
                journal.receipt_zero_initializer_count_for_test().unwrap(),
                0
            );
        };

        reject("reused-write-grant", |material| {
            material.capture.capture_write_grant_generation =
                material.capture.install_write_grant_generation.clone();
        });
        reject("capture-before-install", |material| {
            material.installed.observed_at = "2027-01-01T00:00:02.001Z".to_owned();
        });

        for (label, capture_observed_at) in [
            ("capture-at-install", "2027-01-01T00:00:00.000Z"),
            ("capture-after-install", "2027-01-01T00:00:00.001Z"),
        ] {
            let temp = TempDir::new().unwrap();
            let journal = confirmed_journal(
                &temp,
                Arc::new(ManualClock::new()),
                Arc::new(CounterEntropy::new()),
            );
            let mut material = initializer_material(label, PROJECT_A);
            material.capture.observed_at = capture_observed_at.to_owned();
            assert!(journal
                .claim_receipt_zero_initializer_for_test(material)
                .is_ok());
        }
    }

    #[test]
    fn receipt_zero_initializer_and_unresolved_cas_install_conflict_both_directions() {
        let initializer_first = TempDir::new().unwrap();
        let journal = confirmed_journal(
            &initializer_first,
            Arc::new(ManualClock::new()),
            Arc::new(CounterEntropy::new()),
        );
        drop(
            journal
                .claim_receipt_zero_initializer_for_test(initializer_material(
                    "initializer-first",
                    PROJECT_A,
                ))
                .unwrap(),
        );
        assert!(matches!(
            journal.claim_cas_ledger_install(SealedCasLedgerInstallReviewProofV1::issue_for_test(
                cas_ledger_install_material("cas-second", PROJECT_A)
            )),
            Err(JournalError::ScopeConflict)
        ));

        let cas_first = TempDir::new().unwrap();
        let journal = confirmed_journal(
            &cas_first,
            Arc::new(ManualClock::new()),
            Arc::new(CounterEntropy::new()),
        );
        journal
            .claim_cas_ledger_install(SealedCasLedgerInstallReviewProofV1::issue_for_test(
                cas_ledger_install_material("cas-first", PROJECT_A),
            ))
            .unwrap();
        assert!(matches!(
            journal.claim_receipt_zero_initializer_for_test(initializer_material(
                "initializer-second",
                PROJECT_A
            )),
            Err(JournalError::ScopeConflict)
        ));
    }

    #[test]
    fn receipt_zero_initializer_coexists_with_source_admission() {
        let temp = TempDir::new().unwrap();
        let journal = confirmed_journal(
            &temp,
            Arc::new(ManualClock::new()),
            Arc::new(CounterEntropy::new()),
        );
        journal
            .claim_plan(admission_plan("admission", "signed-ledger"), CAPABILITY_TTL)
            .unwrap();
        drop(
            journal
                .claim_receipt_zero_initializer_for_test(initializer_material(
                    "initializer",
                    PROJECT_A,
                ))
                .unwrap(),
        );
        assert_eq!(journal.source_ledger_admission_count_for_test().unwrap(), 1);
        assert_eq!(
            journal.receipt_zero_initializer_count_for_test().unwrap(),
            1
        );
    }

    #[test]
    fn receipt_zero_initializer_concurrent_claim_has_one_winner() {
        let temp = TempDir::new().unwrap();
        let journal = Arc::new(confirmed_journal(
            &temp,
            Arc::new(ManualClock::new()),
            Arc::new(CounterEntropy::new()),
        ));
        let barrier = Arc::new(Barrier::new(3));
        let material = initializer_material("concurrent", PROJECT_A);
        let mut workers = Vec::new();
        for _ in 0..2 {
            let journal = journal.clone();
            let barrier = barrier.clone();
            let material = material.clone();
            workers.push(thread::spawn(move || {
                barrier.wait();
                journal.claim_receipt_zero_initializer_for_test(material)
            }));
        }
        barrier.wait();
        let results = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter(|result| matches!(result, Err(JournalError::Conflict)))
                .count(),
            1
        );
    }

    #[test]
    fn receipt_zero_initializer_drop_ttl_and_restart_never_remove_durable_fence() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let entropy = Arc::new(CounterEntropy::new());
        let journal = confirmed_journal(&temp, clock.clone(), entropy.clone());
        let claim = journal
            .claim_receipt_zero_initializer_for_test(initializer_material("drop", PROJECT_A))
            .unwrap();
        drop(claim);
        clock.advance(CAPABILITY_TTL + Duration::from_millis(1));
        assert!(matches!(
            journal.claim_receipt_zero_initializer_for_test(initializer_material(
                "after-ttl",
                PROJECT_A
            )),
            Err(JournalError::ScopeConflict)
        ));
        let reopened = confirmed_journal(&temp, clock, entropy);
        assert!(matches!(
            reopened.claim_receipt_zero_initializer_for_test(initializer_material(
                "after-restart",
                PROJECT_A
            )),
            Err(JournalError::ScopeConflict)
        ));
    }

    #[test]
    fn unconfirmed_initializer_claim_leaves_fail_closed_persistent_fence() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let entropy = Arc::new(CounterEntropy::new());
        let journal = journal(
            &temp,
            clock.clone(),
            entropy.clone(),
            Arc::new(FailAfterDirectorySync {
                successful_calls: 0,
                calls: AtomicUsize::new(0),
            }),
        );
        assert!(matches!(
            journal.claim_receipt_zero_initializer_for_test(initializer_material(
                "unconfirmed",
                PROJECT_A
            )),
            Err(JournalError::DurabilityUnconfirmed)
        ));
        assert!(journal.runtime_lock().unwrap().claims.is_empty());
        assert!(journal.runtime_lock().unwrap().reserved.is_empty());

        let reopened = confirmed_journal(&temp, clock, entropy);
        assert!(matches!(
            reopened.claim_receipt_zero_initializer_for_test(initializer_material(
                "after-unconfirmed",
                PROJECT_A
            )),
            Err(JournalError::ScopeConflict)
        ));
    }

    #[test]
    fn receipt_zero_initializer_generic_precommit_is_rejected_without_mutation() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let journal = confirmed_journal(&temp, clock.clone(), Arc::new(CounterEntropy::new()));
        let claim = journal
            .claim_receipt_zero_initializer_for_test(initializer_material(
                "no-precommit",
                PROJECT_A,
            ))
            .unwrap();
        let key = claim.single_flight_key_for_test().to_owned();
        let binding = journal
            .runtime_lock()
            .unwrap()
            .claims
            .get(&claim.capability.id)
            .unwrap()
            .clone();
        let before = body(&journal);
        let before_bytes = fs::read(
            temp.path()
                .join("app-data")
                .join(STORE_DIRECTORY)
                .join(JOURNAL_FILE),
        )
        .unwrap();
        assert!(matches!(
            journal.precommit_for_test(claim.capability, json!({"forbidden": true})),
            Err(JournalError::InvalidState)
        ));
        let forged_settlement_id = [91_u8; CAPABILITY_BYTES];
        journal
            .runtime_lock()
            .unwrap()
            .dispatch_settlements
            .insert(forged_settlement_id, binding);
        assert!(matches!(
            journal.settle_dispatch_for_test(
                DispatchSettlementAuthorityV1 {
                    id: forged_settlement_id
                },
                OperationStateV1::Applied,
                json!({"forbidden": true})
            ),
            Err(JournalError::InvalidState)
        ));
        clock.advance(CLAIM_LEASE + Duration::from_millis(1));
        assert!(matches!(
            journal.reconstruct_for_test(&key),
            Err(JournalError::InvalidState)
        ));
        assert_eq!(body(&journal), before);
        assert_eq!(
            fs::read(
                temp.path()
                    .join("app-data")
                    .join(STORE_DIRECTORY)
                    .join(JOURNAL_FILE)
            )
            .unwrap(),
            before_bytes
        );
    }

    #[test]
    fn initializer_specialized_ids_are_invisible_to_every_generic_transition() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let journal = confirmed_journal(&temp, clock.clone(), Arc::new(CounterEntropy::new()));
        let (key, _, dispatch) =
            initializer_outcome_unknown_for_test(&journal, "generic-negative-b2b", PROJECT_A);
        let journal_path = temp
            .path()
            .join("app-data")
            .join(STORE_DIRECTORY)
            .join(JOURNAL_FILE);
        let dispatch_id = dispatch.permit.id;
        let before = fs::read(&journal_path).unwrap();
        assert!(matches!(
            journal.consume_dispatch_permit_for_test(DispatchPermitV1 { id: dispatch_id }),
            Err(JournalError::InvalidState)
        ));
        assert_eq!(fs::read(&journal_path).unwrap(), before);
        assert!(journal
            .runtime_lock()
            .unwrap()
            .permits
            .contains_key(&dispatch_id));
        let live = journal
            .issue_receipt_zero_initializer_live_run_window_for_test(dispatch)
            .unwrap();
        let live_id = live._attempt.id;
        let before = fs::read(&journal_path).unwrap();
        assert!(matches!(
            journal.mark_dispatch_started_for_test(DispatchAttemptV1 { id: live_id }),
            Err(JournalError::InvalidState)
        ));
        assert_eq!(fs::read(&journal_path).unwrap(), before);
        assert!(journal
            .runtime_lock()
            .unwrap()
            .dispatch_attempts
            .contains_key(&live_id));
        drop(live);

        clock.advance(CLAIM_LEASE);
        let recovery = journal
            .reconstruct_receipt_zero_initializer_for_test(&key)
            .unwrap();
        let recovery_id = recovery.capability.id;
        let before = fs::read(&journal_path).unwrap();
        assert!(matches!(
            journal.begin_reconciliation_for_test(RecoveryCapabilityV1 {
                id: recovery_id,
                kind: RecoveryKindV1::OutcomeUnknownReconciliation,
            }),
            Err(JournalError::InvalidState)
        ));
        assert_eq!(fs::read(&journal_path).unwrap(), before);
        assert!(journal
            .runtime_lock()
            .unwrap()
            .recoveries
            .contains_key(&recovery_id));
        let permit = journal
            .begin_receipt_zero_initializer_reconciliation_for_test(recovery)
            .unwrap();
        let permit_id = permit.permit.id;
        let before = fs::read(&journal_path).unwrap();
        assert!(matches!(
            journal.consume_reconciliation_for_test(ReconciliationPermitV1 { id: permit_id }),
            Err(JournalError::InvalidState)
        ));
        assert_eq!(fs::read(&journal_path).unwrap(), before);
        assert!(journal
            .runtime_lock()
            .unwrap()
            .reconciliation_permits
            .contains_key(&permit_id));
        let read = journal
            .consume_receipt_zero_initializer_reconciliation_for_test(permit)
            .unwrap();
        let observation_id = read._authority.id;
        let before = fs::read(&journal_path).unwrap();
        assert!(matches!(
            journal.settle_reconciliation_for_test(
                ReconciliationObservationAuthorityV1 { id: observation_id },
                OperationStateV1::Applied,
                json!({"forbidden": true})
            ),
            Err(JournalError::InvalidState)
        ));
        assert_eq!(fs::read(&journal_path).unwrap(), before);
        assert!(journal
            .runtime_lock()
            .unwrap()
            .reconciliation_observations
            .contains_key(&observation_id));

        let mut record = body(&journal).records.get(&key).unwrap().clone();
        let before = record.clone();
        let terminal_evidence = evidence(
            EvidencePhaseV1::Final,
            json!({"forbidden": true}),
            WALL_START,
        )
        .unwrap();
        assert!(matches!(
            apply_terminal(
                &mut record,
                OperationStateV1::Applied,
                None,
                terminal_evidence
            ),
            Err(JournalError::InvalidState)
        ));
        assert_eq!(record, before);
    }

    #[test]
    fn receipt_zero_initializer_rejects_secret_like_material_before_writing() {
        let temp = TempDir::new().unwrap();
        let journal = confirmed_journal(
            &temp,
            Arc::new(ManualClock::new()),
            Arc::new(CounterEntropy::new()),
        );
        let mut material = initializer_material("secret-free", PROJECT_A);
        material.source.grant_generation = "sb_secret_forged".to_owned();
        material.capture.source_grant_generation = "sb_secret_forged".to_owned();
        assert!(matches!(
            journal.claim_receipt_zero_initializer_for_test(material),
            Err(JournalError::Invalid)
        ));
        assert_eq!(
            journal.receipt_zero_initializer_count_for_test().unwrap(),
            0
        );

        let mut material = initializer_material("secret-table", PROJECT_A);
        material.inspection.table_name = "sbp_forged".to_owned();
        material.capture.table_name = "sbp_forged".to_owned();
        assert!(matches!(
            journal.claim_receipt_zero_initializer_for_test(material),
            Err(JournalError::Invalid)
        ));
        assert_eq!(
            journal.receipt_zero_initializer_count_for_test().unwrap(),
            0
        );

        let mut material = initializer_material("secret-repository", PROJECT_A);
        material.source.repository = "postgres://user:password@host".to_owned();
        assert!(matches!(
            journal.claim_receipt_zero_initializer_for_test(material),
            Err(JournalError::Invalid)
        ));
        assert_eq!(
            journal.receipt_zero_initializer_count_for_test().unwrap(),
            0
        );

        let mut material = initializer_material("secret-protected-ref", PROJECT_A);
        material.source.protected_ref = "api_key=Abcdef1234567890".to_owned();
        assert!(matches!(
            journal.claim_receipt_zero_initializer_for_test(material),
            Err(JournalError::Invalid)
        ));
        assert_eq!(
            journal.receipt_zero_initializer_count_for_test().unwrap(),
            0
        );
    }

    #[test]
    fn receipt_zero_initializer_recovery_rejects_decoded_secret_like_source_text() {
        for (label, mutate) in [
            (
                "repository",
                (|material: &mut ReceiptZeroInitializerClaimMaterialV1| {
                    material.source.repository = "postgres://user:password@host".to_owned();
                }) as fn(&mut ReceiptZeroInitializerClaimMaterialV1),
            ),
            ("protected-ref", |material| {
                material.source.protected_ref = "api_key=Abcdef1234567890".to_owned();
            }),
        ] {
            let mut material = initializer_material(&format!("recovery-secret-{label}"), PROJECT_A);
            mutate(&mut material);
            let canonical = canonical_serialized_bytes(&material).unwrap();
            let recovery = ReceiptZeroInitializerRecoveryMaterialV1 {
                canonical_byte_length: u32::try_from(canonical.len()).unwrap(),
                canonical_digest: digest_bytes(&canonical),
                chunks: split_receipt_zero_initializer_recovery_chunks(&canonical).unwrap(),
                encoding: RECEIPT_ZERO_INITIALIZER_RECOVERY_ENCODING.to_owned(),
                format: RECEIPT_ZERO_INITIALIZER_RECOVERY_FORMAT.to_owned(),
                version: 1,
            };
            assert!(
                matches!(
                    receipt_zero_initializer_material_from_recovery(recovery),
                    Err(JournalError::Invalid)
                ),
                "decoded recovery secret must fail closed: {label}"
            );
        }
    }

    #[test]
    fn receipt_zero_initializer_uses_non_admission_capacity_and_preserves_bounds() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let journal = confirmed_journal(&temp, clock, Arc::new(CounterEntropy::new()));
        journal
            .with_store(|root| {
                let mut body = JournalBodyV1::default();
                for index in 0..MAX_ADMISSION_OCCUPIED_RECORDS {
                    let operation =
                        admission_plan(&format!("reserve-{index}"), &format!("scope-{index}"));
                    body.records.insert(
                        operation.single_flight_key.clone(),
                        claimed_record(operation),
                    );
                }
                body.generation = u64::try_from(body.records.len()).unwrap();
                persist_journal(root, &body, &SystemDirectorySync)?;
                Ok(())
            })
            .unwrap();
        drop(
            journal
                .claim_receipt_zero_initializer_for_test(initializer_material(
                    "uses-reserve",
                    PROJECT_A,
                ))
                .expect("initializer is a non-admission claim and may use the reserve"),
        );

        journal
            .with_store(|root| {
                let mut body = load_journal(root)?;
                while body.records.len() < MAX_RECORDS {
                    let index = body.records.len();
                    let operation = plan(&format!("fill-{index}"), &project_ref(index + 1));
                    body.records.insert(
                        operation.single_flight_key.clone(),
                        claimed_record(operation),
                    );
                }
                body.generation = u64::try_from(body.records.len()).unwrap();
                persist_journal(root, &body, &SystemDirectorySync)?;
                Ok(())
            })
            .unwrap();
        assert!(matches!(
            journal.claim_receipt_zero_initializer_for_test(initializer_material(
                "full",
                &project_ref(MAX_RECORDS + 1)
            )),
            Err(JournalError::Full)
        ));
    }

    #[test]
    fn receipt_zero_initializer_near_full_precommit_leaves_auditable_claimed_fence() {
        const LARGE_PADDING_BYTES: usize = 1_000_000;
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let journal = confirmed_journal(&temp, clock.clone(), Arc::new(CounterEntropy::new()));
        let material = initializer_material("near-full", PROJECT_A);
        let claim = journal
            .claim_receipt_zero_initializer_for_test(material.clone())
            .unwrap();
        let key = claim.single_flight_key_for_test().to_owned();
        let plan_digest = claim.plan_digest_for_test().to_owned();

        let mut filled = body(&journal);
        let mut filled_size = journal_envelope_size_for_test(&filled);
        let mut filler_index = 0_usize;
        loop {
            let (filler_key, tombstone) =
                padding_tombstone_for_test(filler_index, LARGE_PADDING_BYTES);
            let entry_size = usize::from(!filled.tombstones.is_empty())
                + serde_json::to_vec(&filler_key).unwrap().len()
                + 1
                + serde_json::to_vec(&tombstone).unwrap().len();
            if filled_size + entry_size > MAX_JOURNAL_BYTES {
                break;
            }
            filled_size += entry_size;
            filled.tombstones.insert(filler_key, tombstone);
            filler_index += 1;
        }

        let mut lower = 1_usize;
        let mut upper = LARGE_PADDING_BYTES;
        let mut best = None;
        while lower <= upper {
            let middle = lower + (upper - lower) / 2;
            let (filler_key, tombstone) = padding_tombstone_for_test(filler_index, middle);
            let entry_size = usize::from(!filled.tombstones.is_empty())
                + serde_json::to_vec(&filler_key).unwrap().len()
                + 1
                + serde_json::to_vec(&tombstone).unwrap().len();
            if filled_size + entry_size <= MAX_JOURNAL_BYTES {
                best = Some((filler_key, tombstone, entry_size));
                lower = middle + 1;
            } else {
                upper = middle - 1;
            }
        }
        if let Some((filler_key, tombstone, entry_size)) = best {
            filled.tombstones.insert(filler_key, tombstone);
            filled_size += entry_size;
        }
        assert_eq!(journal_envelope_size_for_test(&filled), filled_size);
        assert!(filled_size <= MAX_JOURNAL_BYTES);

        let mut projected = filled.clone();
        let record = projected.records.get_mut(&key).unwrap();
        record.revision = 2;
        record.state = OperationStateV1::OutcomeUnknown;
        record.transitioned_at_unix_ms = Some(WALL_START);
        record.code = Some(OUTCOME_UNKNOWN_CODE.to_owned());
        record.progress_evidence = Some(
            evidence(
                EvidencePhaseV1::Progress,
                receipt_zero_initializer_outcome_unknown_payload(&material, &plan_digest).unwrap(),
                WALL_START,
            )
            .unwrap(),
        );
        validate_record(record).unwrap();
        projected.generation += 1;
        assert!(journal_envelope_size_for_test(&projected) > MAX_JOURNAL_BYTES);

        journal
            .with_store(
                |root| match persist_journal(root, &filled, &SystemDirectorySync)? {
                    CommitDurability::Confirmed => Ok(()),
                    CommitDurability::Unconfirmed => Err(JournalError::DurabilityUnconfirmed),
                },
            )
            .unwrap();
        let journal_path = temp
            .path()
            .join("app-data")
            .join(STORE_DIRECTORY)
            .join(JOURNAL_FILE);
        let before = fs::read(&journal_path).unwrap();
        assert!(matches!(
            journal.precommit_receipt_zero_initializer_for_test(claim),
            Err(JournalError::Full)
        ));
        assert!(journal.runtime_lock().unwrap().permits.is_empty());
        assert_eq!(fs::read(&journal_path).unwrap(), before);
        let persisted = body(&journal);
        let record = persisted.records.get(&key).unwrap();
        assert_eq!(record.state, OperationStateV1::Claimed);
        assert!(record.progress_evidence.is_none());

        clock.advance(CLAIM_LEASE + CAPABILITY_TTL);
        assert!(matches!(
            journal.reconstruct_receipt_zero_initializer_for_test(&key),
            Err(JournalError::InvalidState)
        ));
    }

    #[test]
    fn initializer_reconciliation_near_full_burns_recovery_without_partial_lease() {
        const LARGE_PADDING_BYTES: usize = 1_000_000;
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let journal = confirmed_journal(&temp, clock.clone(), Arc::new(CounterEntropy::new()));
        let (key, _, dispatch) =
            initializer_outcome_unknown_for_test(&journal, "near-full-begin", PROJECT_A);
        drop(dispatch);

        let mut filled = body(&journal);
        let mut filled_size = journal_envelope_size_for_test(&filled);
        let mut filler_index = 0_usize;
        loop {
            let (filler_key, tombstone) =
                padding_tombstone_for_test(filler_index, LARGE_PADDING_BYTES);
            let entry_size = usize::from(!filled.tombstones.is_empty())
                + serde_json::to_vec(&filler_key).unwrap().len()
                + 1
                + serde_json::to_vec(&tombstone).unwrap().len();
            if filled_size + entry_size > MAX_JOURNAL_BYTES {
                break;
            }
            filled_size += entry_size;
            filled.tombstones.insert(filler_key, tombstone);
            filler_index += 1;
        }
        let mut lower = 1_usize;
        let mut upper = LARGE_PADDING_BYTES;
        let mut best = None;
        while lower <= upper {
            let middle = lower + (upper - lower) / 2;
            let (filler_key, tombstone) = padding_tombstone_for_test(filler_index, middle);
            let entry_size = usize::from(!filled.tombstones.is_empty())
                + serde_json::to_vec(&filler_key).unwrap().len()
                + 1
                + serde_json::to_vec(&tombstone).unwrap().len();
            if filled_size + entry_size <= MAX_JOURNAL_BYTES {
                best = Some((filler_key, tombstone, entry_size));
                lower = middle + 1;
            } else {
                upper = middle - 1;
            }
        }
        if let Some((filler_key, tombstone, entry_size)) = best {
            filled.tombstones.insert(filler_key, tombstone);
            filled_size += entry_size;
        }
        assert_eq!(journal_envelope_size_for_test(&filled), filled_size);
        assert!(filled_size <= MAX_JOURNAL_BYTES);

        let mut projected = filled.clone();
        let record = projected.records.get_mut(&key).unwrap();
        record.revision = 3;
        record.reconciliation_lease = Some(ReconciliationLeaseRecordV1 {
            generation: 1,
            authority_digest: digest_bytes(b"projected-initializer-lease"),
            issued_at_unix_ms: WALL_START + 300_000,
            expires_at_unix_ms: WALL_START + 360_000,
            consumed: false,
        });
        validate_record(record).unwrap();
        projected.generation += 1;
        assert!(journal_envelope_size_for_test(&projected) > MAX_JOURNAL_BYTES);

        journal
            .with_store(
                |root| match persist_journal(root, &filled, &SystemDirectorySync)? {
                    CommitDurability::Confirmed => Ok(()),
                    CommitDurability::Unconfirmed => Err(JournalError::DurabilityUnconfirmed),
                },
            )
            .unwrap();
        clock.advance(CLAIM_LEASE);
        let recovery = journal
            .reconstruct_receipt_zero_initializer_for_test(&key)
            .unwrap();
        assert!(matches!(
            journal.begin_receipt_zero_initializer_reconciliation_for_test(recovery),
            Err(JournalError::Full)
        ));
        let persisted = body(&journal);
        let record = persisted.records.get(&key).unwrap();
        assert_eq!(record.revision, 2);
        assert!(record.reconciliation_lease.is_none());
        let runtime = journal.runtime_lock().unwrap();
        assert!(runtime.recoveries.is_empty());
        assert!(runtime.reconciliation_permits.is_empty());
    }

    #[test]
    fn corrupt_initializer_record_identity_fails_closed_after_checksum_recalculation() {
        for field in ["owner", "dispatch-scope", "single-flight"] {
            let temp = TempDir::new().unwrap();
            let journal = confirmed_journal(
                &temp,
                Arc::new(ManualClock::new()),
                Arc::new(CounterEntropy::new()),
            );
            drop(
                journal
                    .claim_receipt_zero_initializer_for_test(initializer_material(
                        &format!("corrupt-{field}"),
                        PROJECT_A,
                    ))
                    .unwrap(),
            );
            let path = temp
                .path()
                .join("app-data")
                .join(STORE_DIRECTORY)
                .join(JOURNAL_FILE);
            let mut envelope: JournalEnvelopeV1 =
                serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
            let original_key = envelope.body.records.keys().next().unwrap().clone();
            let mut record = envelope.body.records.remove(&original_key).unwrap();
            match field {
                "owner" => record.owner_id = "forged-owner".to_owned(),
                "dispatch-scope" => {
                    record.dispatch_scope_key = digest_bytes(b"forged-dispatch-scope")
                }
                "single-flight" => record.single_flight_key = digest_bytes(b"forged-single-flight"),
                _ => unreachable!(),
            }
            envelope
                .body
                .records
                .insert(record.single_flight_key.clone(), record);
            envelope.body_digest = digest_bytes(&serde_json::to_vec(&envelope.body).unwrap());
            fs::write(&path, serde_json::to_vec(&envelope).unwrap()).unwrap();
            assert!(matches!(
                journal.receipt_zero_initializer_count_for_test(),
                Err(JournalError::Corrupt)
            ));
        }
    }

    #[test]
    fn initializer_plan_rejects_tampered_derived_identity() {
        let (plan, _) =
            receipt_zero_initializer_plan(&initializer_material("plan-identity", PROJECT_A))
                .unwrap();
        let mut forged_scope = plan.clone();
        forged_scope.dispatch_scope_key = digest_bytes(b"forged-dispatch-scope");
        assert!(matches!(
            validate_plan(&forged_scope),
            Err(JournalError::Invalid)
        ));

        let mut forged_single_flight = plan;
        forged_single_flight.single_flight_key = digest_bytes(b"forged-single-flight");
        assert!(matches!(
            validate_plan(&forged_single_flight),
            Err(JournalError::Invalid)
        ));
    }

    #[test]
    fn initializer_recovery_kernel_is_production_compiled_but_authority_remains_test_only() {
        let source = include_str!("backend_operation_journal.rs");
        for name in [
            "ReceiptZeroInitializerSourceMaterialV1",
            "ReceiptZeroInitializerInstallMaterialV1",
            "ReceiptZeroInitializerInspectionMaterialV1",
            "ReceiptZeroInitializerCaptureMaterialV1",
            "ReceiptZeroInitializerTransactionParametersV1",
            "ReceiptZeroInitializerTransactionMaterialV1",
            "ReceiptZeroInitializerClaimMaterialV1",
        ] {
            let declaration = format!("pub(crate) struct {name}");
            let offset = source
                .find(&declaration)
                .unwrap_or_else(|| panic!("missing production material: {name}"));
            let attributes = source[..offset].rsplit("\n\n").next().unwrap();
            assert!(attributes.contains("Deserialize"));
            assert!(attributes.contains("serde(rename_all = \"camelCase\", deny_unknown_fields)"));
            assert!(!attributes.lines().any(|line| line.trim() == "#[cfg(test)]"));
        }
        for name in [
            "ReceiptZeroInitializerRecoveryMaterialV1",
            "ReceiptZeroInitializerOutcomeUnknownProgressV1",
        ] {
            let declaration = format!("struct {name}");
            let offset = source
                .find(&declaration)
                .unwrap_or_else(|| panic!("missing production recovery DTO: {name}"));
            let attributes = source[..offset].rsplit("\n\n").next().unwrap();
            assert!(attributes.contains("Deserialize"));
            assert!(attributes.contains("serde(rename_all = \"camelCase\", deny_unknown_fields)"));
            assert!(!attributes.lines().any(|line| line.trim() == "#[cfg(test)]"));
        }
        for function in [
            "derive_receipt_zero_initializer_identity",
            "validate_receipt_zero_initializer_material",
            "validate_receipt_zero_initializer_capture",
            "validate_receipt_zero_initializer_transaction",
            "receipt_zero_initializer_recovery_material",
            "receipt_zero_initializer_material_from_recovery",
            "receipt_zero_initializer_outcome_unknown_payload",
            "receipt_zero_initializer_material_from_outcome_unknown",
        ] {
            let declaration = format!("\nfn {function}(");
            let offset = source
                .find(&declaration)
                .unwrap_or_else(|| panic!("missing production function: {function}"));
            assert!(!source[..offset].ends_with("#[cfg(test)]"));
        }
        let plan_declaration = concat!("\nfn receipt_zero_initializer_", "plan(");
        let plan_offset = source
            .find(plan_declaration)
            .expect("missing test-only trusted plan constructor");
        assert!(source[..plan_offset].ends_with("#[cfg(test)]"));
        assert!(!source.contains(concat!("pub(crate) fn receipt_zero_initializer_", "plan(")));

        for name in [
            "ReceiptZeroInitializerJournalClaimV1",
            "ReceiptZeroInitializerJournalStagedOutcomeUnknownV1",
            "ReceiptZeroInitializerJournalDispatchV1",
            "ReceiptZeroInitializerJournalRecoveryV1",
            "ReceiptZeroInitializerJournalReconciliationPermitV1",
            "ReceiptZeroInitializerInertLivePrecommitRunWindowV1",
            "ReceiptZeroInitializerLiveExecutionCeilingV1",
            "ReceiptZeroInitializerActiveLiveExecutionCeilingV1",
            "ReceiptZeroInitializerReconciliationReadRunWindowV1",
        ] {
            let declaration = format!("pub(crate) struct {name}");
            let offset = source
                .find(&declaration)
                .unwrap_or_else(|| panic!("missing test-only opaque handle: {name}"));
            let attributes = source[..offset].rsplit("\n\n").next().unwrap();
            assert!(attributes.lines().any(|line| line.trim() == "#[cfg(test)]"));
            assert!(attributes.lines().any(|line| line.trim() == "#[must_use]"));
            assert!(!attributes.contains("#[derive("));
        }
        for forbidden in [
            concat!("Database", "SessionV1"),
            concat!("Database", "ReadCredential"),
            concat!("settle_receipt_zero_", "initializer"),
            concat!("execute_receipt_zero_", "initializer"),
            concat!("run_receipt_zero_", "initializer"),
        ] {
            assert!(
                !source.contains(forbidden),
                "B2b must retain zero database/settlement authority: {forbidden}"
            );
        }
    }

    #[test]
    fn mutation_dispatch_and_recovery_declarations_remain_test_only() {
        let source = include_str!("backend_operation_journal.rs");
        for declaration in [
            "\n    pub(crate) fn claim_receipt_zero_initializer_for_test(",
            "\n    pub(crate) fn stage_receipt_zero_initializer_outcome_unknown_for_test(",
            "\n    pub(crate) fn publish_receipt_zero_initializer_staged_dispatch_for_test(",
            "\n    pub(crate) fn precommit_receipt_zero_initializer_for_test(",
            "\n    pub(crate) fn reconstruct_receipt_zero_initializer_for_test(",
            "\n    pub(crate) fn begin_receipt_zero_initializer_reconciliation_for_test(",
            "\n    pub(crate) fn consume_receipt_zero_initializer_reconciliation_for_test(",
            "\n    pub(crate) fn issue_receipt_zero_initializer_live_run_window_for_test(",
            "\n    pub(crate) fn consume_receipt_zero_initializer_live_run_window_for_execution_for_test(",
            "\n    pub(crate) fn precommit_cas_ledger_install_for_test(",
            "\n    pub(crate) fn settle_cas_ledger_install_applied_for_test(",
            "\n    fn precommit_for_test(",
            "\n    fn consume_dispatch_permit_for_test(",
            "\n    fn attest_known_not_dispatched_for_test(",
            "\n    fn mark_dispatch_started_for_test(",
            "\n    fn settle_dispatch_for_test(",
            "\n    fn settle_known_not_dispatched_for_test(",
            "\n    fn reconstruct_for_test(",
            "\n    fn settle_reconstructed_claim_for_test(",
            "\n    fn begin_reconciliation_for_test(",
            "\n    fn consume_reconciliation_for_test(",
            "\n    fn settle_reconciliation_for_test(",
        ] {
            let offset = source
                .find(declaration)
                .unwrap_or_else(|| panic!("missing guarded declaration: {declaration}"));
            assert!(
                source[..offset].ends_with("    #[cfg(test)]"),
                "declaration is not immediately guarded by cfg(test): {declaration}"
            );
            let signature_end = source[offset..]
                .find(") ->")
                .map(|relative| offset + relative)
                .expect("guarded declaration must have a return type");
            assert!(
                !source[offset..signature_end].contains("Duration"),
                "opaque callers must not supply a Duration: {declaration}"
            );
        }
    }

    #[test]
    fn receipt_zero_admission_cannot_enter_any_mutation_or_recovery_transition() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let entropy = Arc::new(CounterEntropy::new());
        let journal = confirmed_journal(&temp, clock.clone(), entropy.clone());
        let operation = admission_plan("sealed", "ledger-sealed");
        let key = operation.single_flight_key.clone();
        let claim = journal.claim_plan(operation, CAPABILITY_TTL).unwrap();
        let claim_id = claim.id;
        let journal_path = temp
            .path()
            .join("app-data")
            .join(STORE_DIRECTORY)
            .join(JOURNAL_FILE);
        let before_bytes = fs::read(&journal_path).unwrap();
        let before_body = body(&journal);

        assert!(matches!(
            journal.precommit_for_test(claim, json!({"stage": "forbidden"})),
            Err(JournalError::InvalidState)
        ));
        let binding = journal
            .runtime_lock()
            .unwrap()
            .claims
            .get(&claim_id)
            .unwrap()
            .clone();

        let permit_id = [31_u8; CAPABILITY_BYTES];
        let attest_id = [32_u8; CAPABILITY_BYTES];
        let dispatch_id = [33_u8; CAPABILITY_BYTES];
        let settlement_id = [34_u8; CAPABILITY_BYTES];
        let known_id = [35_u8; CAPABILITY_BYTES];
        let recovery_settle_id = [36_u8; CAPABILITY_BYTES];
        let recovery_begin_id = [37_u8; CAPABILITY_BYTES];
        let reconciliation_permit_id = [38_u8; CAPABILITY_BYTES];
        let reconciliation_observation_id = [39_u8; CAPABILITY_BYTES];
        {
            let mut runtime = journal.runtime_lock().unwrap();
            runtime.permits.insert(permit_id, binding.clone());
            runtime.dispatch_attempts.insert(attest_id, binding.clone());
            runtime
                .dispatch_attempts
                .insert(dispatch_id, binding.clone());
            runtime
                .dispatch_settlements
                .insert(settlement_id, binding.clone());
            runtime
                .known_not_dispatched
                .insert(known_id, binding.clone());
            runtime.recoveries.insert(
                recovery_settle_id,
                (binding.clone(), RecoveryKindV1::ClaimedKnownNotDispatched),
            );
            runtime.recoveries.insert(
                recovery_begin_id,
                (
                    binding.clone(),
                    RecoveryKindV1::OutcomeUnknownReconciliation,
                ),
            );
            let reconciliation = ReconciliationCapabilityBindingV1 {
                binding: binding.clone(),
                authority_digest: digest_bytes(b"forged-admission-reconciliation"),
                lease_generation: 1,
                lease_expires_at_unix_ms: WALL_START + 30_000,
                lease_expires_at_monotonic: Duration::from_secs(30),
            };
            runtime
                .reconciliation_permits
                .insert(reconciliation_permit_id, reconciliation.clone());
            runtime
                .reconciliation_observations
                .insert(reconciliation_observation_id, reconciliation);
        }

        assert!(matches!(
            journal.consume_dispatch_permit_for_test(DispatchPermitV1 { id: permit_id }),
            Err(JournalError::InvalidState)
        ));
        assert!(matches!(
            journal.attest_known_not_dispatched_for_test(DispatchAttemptV1 { id: attest_id }),
            Err(JournalError::InvalidState)
        ));
        assert!(matches!(
            journal.mark_dispatch_started_for_test(DispatchAttemptV1 { id: dispatch_id }),
            Err(JournalError::InvalidState)
        ));
        assert!(matches!(
            journal.settle_dispatch_for_test(
                DispatchSettlementAuthorityV1 { id: settlement_id },
                OperationStateV1::Applied,
                json!({"forbidden": true})
            ),
            Err(JournalError::InvalidState)
        ));
        assert!(matches!(
            journal.settle_known_not_dispatched_for_test(
                KnownNotDispatchedProofV1 { id: known_id },
                json!({"forbidden": true})
            ),
            Err(JournalError::InvalidState)
        ));
        assert!(matches!(
            journal.settle_reconstructed_claim_for_test(
                RecoveryCapabilityV1 {
                    id: recovery_settle_id,
                    kind: RecoveryKindV1::ClaimedKnownNotDispatched,
                },
                json!({"forbidden": true})
            ),
            Err(JournalError::InvalidState)
        ));
        assert!(matches!(
            journal.begin_reconciliation_for_test(RecoveryCapabilityV1 {
                id: recovery_begin_id,
                kind: RecoveryKindV1::OutcomeUnknownReconciliation,
            }),
            Err(JournalError::InvalidState)
        ));
        assert!(matches!(
            journal.consume_reconciliation_for_test(ReconciliationPermitV1 {
                id: reconciliation_permit_id,
            }),
            Err(JournalError::InvalidState)
        ));
        assert!(matches!(
            journal.settle_reconciliation_for_test(
                ReconciliationObservationAuthorityV1 {
                    id: reconciliation_observation_id,
                },
                OperationStateV1::Applied,
                json!({"forbidden": true})
            ),
            Err(JournalError::InvalidState)
        ));
        assert!(matches!(
            journal.settle_exact(
                binding.clone(),
                OperationStateV1::Claimed,
                OperationStateV1::Failed,
                Some(KNOWN_NOT_DISPATCHED_CODE),
                json!({"forbidden": true})
            ),
            Err(JournalError::InvalidState)
        ));
        let reconstructed = confirmed_journal(&temp, clock, entropy);
        assert!(matches!(
            reconstructed.reconstruct_for_test(&key),
            Err(JournalError::InvalidState)
        ));

        assert_eq!(fs::read(&journal_path).unwrap(), before_bytes);
        assert_eq!(body(&journal), before_body);
    }

    #[test]
    fn receipt_zero_admission_record_cap_preserves_non_admission_reserve() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let journal = confirmed_journal(&temp, clock.clone(), Arc::new(CounterEntropy::new()));
        for index in 0..MAX_ADMISSION_OCCUPIED_RECORDS {
            journal
                .claim_plan(
                    admission_plan(&format!("cap-{index}"), &format!("ledger-{index}")),
                    CAPABILITY_TTL,
                )
                .unwrap();
        }
        clock.advance(CAPABILITY_TTL + Duration::from_millis(1));
        assert!(matches!(
            journal.claim_plan(admission_plan("overflow", "overflow"), CAPABILITY_TTL),
            Err(JournalError::Full)
        ));
        journal
            .claim_for_test(plan("reserved-cas-install", "zyxwvutsrqponmlkjihg"))
            .expect("admissions must leave capacity for a non-admission claim");
        assert_eq!(
            body(&journal).records.len(),
            MAX_ADMISSION_OCCUPIED_RECORDS + 1
        );
    }

    #[test]
    fn direct_dispatch_persists_atomic_evidence_and_capabilities_are_one_shot() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let journal = confirmed_journal(&temp, clock, Arc::new(CounterEntropy::new()));
        let operation = plan("direct", PROJECT_A);
        let key = operation.single_flight_key.clone();

        let claim = journal.claim_for_test(operation).unwrap();
        let permit = journal
            .precommit_for_test(claim, json!({"stage": "precommit"}))
            .unwrap();
        let permit_id = permit.id;
        let attempt = journal.consume_dispatch_permit_for_test(permit).unwrap();
        assert!(matches!(
            journal.consume_dispatch_permit_for_test(DispatchPermitV1 { id: permit_id }),
            Err(JournalError::CapabilityMissing)
        ));
        let attempt_id = attempt.id;
        let settlement = journal.mark_dispatch_started_for_test(attempt).unwrap();
        assert!(matches!(
            journal.mark_dispatch_started_for_test(DispatchAttemptV1 { id: attempt_id }),
            Err(JournalError::CapabilityMissing)
        ));
        let settlement_id = settlement.id;
        let settled = journal
            .settle_dispatch_for_test(
                settlement,
                OperationStateV1::Applied,
                json!({"verified": true}),
            )
            .unwrap();

        assert_eq!(settled.state, OperationStateV1::Applied);
        assert!(settled.progress_evidence.is_some());
        assert!(settled.final_evidence.is_some());
        assert!(journal.list_unresolved().unwrap().is_empty());
        let persisted = body(&journal).records.get(&key).unwrap().clone();
        assert_eq!(persisted, settled);
        assert!(matches!(
            journal.settle_dispatch_for_test(
                DispatchSettlementAuthorityV1 { id: settlement_id },
                OperationStateV1::Applied,
                json!({"verified": true})
            ),
            Err(JournalError::CapabilityMissing)
        ));
    }

    #[test]
    fn lease_expiry_allows_only_recovery_and_never_unlocks_scope() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let entropy = Arc::new(CounterEntropy::new());
        let journal = confirmed_journal(&temp, clock.clone(), entropy);
        let first = plan("first", PROJECT_A);
        let key = first.single_flight_key.clone();
        journal.claim_for_test(first).unwrap();

        assert!(matches!(
            journal.reconstruct_for_test(&key),
            Err(JournalError::LeaseActive)
        ));
        clock.set_wall(WALL_START - 1);
        assert!(matches!(
            journal.reconstruct_for_test(&key),
            Err(JournalError::LeaseActive)
        ));
        clock.set_wall(WALL_START);
        clock.advance(CLAIM_LEASE + Duration::from_millis(1));
        assert!(matches!(
            journal.claim_for_test(plan("second", PROJECT_A)),
            Err(JournalError::ScopeConflict)
        ));

        let recovery = journal.reconstruct_for_test(&key).unwrap();
        journal
            .settle_reconstructed_claim_for_test(
                recovery,
                json!({"reason": "restart-before-precommit"}),
            )
            .unwrap();
        assert!(journal.claim_for_test(plan("second", PROJECT_A)).is_ok());
    }

    #[test]
    fn late_precommit_extends_recovery_barrier_by_dispatch_ttl() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let entropy = Arc::new(CounterEntropy::new());
        let first = confirmed_journal(&temp, clock.clone(), entropy.clone());
        let operation = plan("late-precommit", PROJECT_A);
        let key = operation.single_flight_key.clone();
        let claim = first.claim_for_test(operation).unwrap();
        clock.advance(CLAIM_LEASE - Duration::from_millis(1));
        first
            .precommit_for_test(claim, json!({"stage": "precommit"}))
            .unwrap();

        let restarted = confirmed_journal(&temp, clock.clone(), entropy);
        clock.advance(Duration::from_millis(1));
        assert!(matches!(
            restarted.reconstruct_for_test(&key),
            Err(JournalError::LeaseActive)
        ));
        clock.advance(CAPABILITY_TTL - Duration::from_millis(2));
        assert!(matches!(
            restarted.reconstruct_for_test(&key),
            Err(JournalError::LeaseActive)
        ));
        clock.advance(Duration::from_millis(1));
        assert!(restarted.reconstruct_for_test(&key).is_ok());
    }

    #[test]
    fn restart_reconciliation_is_leased_one_shot_and_settles_terminally() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let entropy = Arc::new(CounterEntropy::new());
        let first = confirmed_journal(&temp, clock.clone(), entropy.clone());
        let operation = plan("reconcile", PROJECT_A);
        let key = operation.single_flight_key.clone();
        let claim = first.claim_for_test(operation).unwrap();
        first
            .precommit_for_test(claim, json!({"stage": "precommit"}))
            .unwrap();
        clock.advance(CLAIM_LEASE + Duration::from_millis(1));

        let restarted = confirmed_journal(&temp, clock.clone(), entropy.clone());
        let recovery = restarted.reconstruct_for_test(&key).unwrap();
        let permit = restarted.begin_reconciliation_for_test(recovery).unwrap();
        let competing = confirmed_journal(&temp, clock.clone(), entropy);
        let competing_recovery = competing.reconstruct_for_test(&key).unwrap();
        assert!(matches!(
            competing.begin_reconciliation_for_test(competing_recovery),
            Err(JournalError::LeaseActive)
        ));

        let permit_id = permit.id;
        let observation = restarted.consume_reconciliation_for_test(permit).unwrap();
        assert!(matches!(
            restarted.consume_reconciliation_for_test(ReconciliationPermitV1 { id: permit_id }),
            Err(JournalError::CapabilityMissing)
        ));
        let settled = restarted
            .settle_reconciliation_for_test(
                observation,
                OperationStateV1::Applied,
                json!({"remoteLedgerObserved": true}),
            )
            .unwrap();
        assert_eq!(settled.state, OperationStateV1::Applied);
        assert!(settled.reconciliation_lease.is_none());
        assert!(restarted.list_unresolved().unwrap().is_empty());
    }

    #[test]
    fn negative_reconciliation_observation_cannot_terminally_settle() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let journal = confirmed_journal(&temp, clock.clone(), Arc::new(CounterEntropy::new()));
        let operation = plan("negative-reconcile", PROJECT_A);
        let key = operation.single_flight_key.clone();
        let claim = journal.claim_for_test(operation).unwrap();
        journal
            .precommit_for_test(claim, json!({"stage": "precommit"}))
            .unwrap();
        clock.advance(CLAIM_LEASE + Duration::from_millis(1));
        let recovery = journal.reconstruct_for_test(&key).unwrap();
        let permit = journal.begin_reconciliation_for_test(recovery).unwrap();
        let observation = journal.consume_reconciliation_for_test(permit).unwrap();
        assert!(matches!(
            journal.settle_reconciliation_for_test(
                observation,
                OperationStateV1::Failed,
                json!({"remoteLedgerObserved": false})
            ),
            Err(JournalError::InvalidState)
        ));
        let persisted = body(&journal).records.get(&key).unwrap().clone();
        assert_eq!(persisted.state, OperationStateV1::OutcomeUnknown);
        assert!(persisted.final_evidence.is_none());
    }

    #[test]
    fn negative_dispatch_result_cannot_terminally_settle() {
        let temp = TempDir::new().unwrap();
        let journal = confirmed_journal(
            &temp,
            Arc::new(ManualClock::new()),
            Arc::new(CounterEntropy::new()),
        );
        let operation = plan("negative-dispatch", PROJECT_A);
        let key = operation.single_flight_key.clone();
        let claim = journal.claim_for_test(operation).unwrap();
        let permit = journal
            .precommit_for_test(claim, json!({"stage": "precommit"}))
            .unwrap();
        let attempt = journal.consume_dispatch_permit_for_test(permit).unwrap();
        let settlement = journal.mark_dispatch_started_for_test(attempt).unwrap();
        assert!(matches!(
            journal.settle_dispatch_for_test(
                settlement,
                OperationStateV1::Failed,
                json!({"transportError": true})
            ),
            Err(JournalError::InvalidState)
        ));
        let persisted = body(&journal).records.get(&key).unwrap().clone();
        assert_eq!(persisted.state, OperationStateV1::OutcomeUnknown);
        assert!(persisted.final_evidence.is_none());
    }

    #[test]
    fn unconfirmed_precommit_persists_outcome_unknown_but_issues_no_permit() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let sync = Arc::new(FailAfterDirectorySync {
            successful_calls: 1,
            calls: AtomicUsize::new(0),
        });
        let journal = journal(&temp, clock, Arc::new(CounterEntropy::new()), sync);
        let operation = plan("unconfirmed", PROJECT_A);
        let key = operation.single_flight_key.clone();
        let claim = journal.claim_for_test(operation).unwrap();

        assert!(matches!(
            journal.precommit_for_test(claim, json!({"stage": "precommit"})),
            Err(JournalError::DurabilityUnconfirmed)
        ));
        let persisted = body(&journal).records.get(&key).unwrap().clone();
        assert_eq!(persisted.state, OperationStateV1::OutcomeUnknown);
        assert!(persisted.progress_evidence.is_some());
        let runtime = journal.runtime_lock().unwrap();
        assert!(runtime.permits.is_empty());
        assert!(runtime.reserved.is_empty());
    }

    #[test]
    fn durable_and_runtime_expiry_share_the_in_lock_sample() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let journal = journal(
            &temp,
            clock.clone(),
            Arc::new(CounterEntropy::new()),
            Arc::new(AdvanceClockDirectorySync {
                clock: clock.clone(),
                duration: Duration::from_secs(10),
            }),
        );
        let operation = plan("same-sample", PROJECT_A);
        let key = operation.single_flight_key.clone();
        let claim = journal.claim_for_test(operation).unwrap();
        let persisted = body(&journal).records.get(&key).unwrap().clone();
        let claim_binding = journal
            .runtime_lock()
            .unwrap()
            .claims
            .get(&claim.id)
            .unwrap()
            .clone();
        assert_eq!(persisted.claimed_at_unix_ms, WALL_START);
        assert_eq!(
            claim_binding.expires_at_unix_ms,
            persisted.claim_lease_expires_at_unix_ms
        );
        assert_eq!(claim_binding.expires_at_monotonic, CLAIM_LEASE);

        let permit = journal
            .precommit_for_test(claim, json!({"stage": "precommit"}))
            .unwrap();
        let persisted = body(&journal).records.get(&key).unwrap().clone();
        let permit_binding = journal
            .runtime_lock()
            .unwrap()
            .permits
            .get(&permit.id)
            .unwrap()
            .clone();
        let transitioned_at = persisted.transitioned_at_unix_ms.unwrap();
        assert_eq!(transitioned_at, WALL_START + 10_000);
        assert_eq!(permit_binding.expires_at_unix_ms, transitioned_at + 30_000);
        assert_eq!(permit_binding.expires_at_monotonic, Duration::from_secs(40));
    }

    #[test]
    fn lock_wait_is_excluded_from_precommit_ttl_and_wall_jump_blocks_dispatch() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let journal = Arc::new(confirmed_journal(
            &temp,
            clock.clone(),
            Arc::new(CounterEntropy::new()),
        ));
        let operation = plan("lock-wait", PROJECT_A);
        let key = operation.single_flight_key.clone();
        let claim = journal.claim_for_test(operation).unwrap();
        let claim_id = claim.id;
        let root = temp.path().join("app-data").join(STORE_DIRECTORY);
        let file_lock = JournalFileLock::acquire(&root.join(LOCK_FILE)).unwrap();
        let worker_journal = journal.clone();
        let worker = thread::spawn(move || {
            worker_journal.precommit_for_test(claim, json!({"stage": "precommit"}))
        });
        let deadline = Instant::now() + Duration::from_secs(1);
        loop {
            let reached_file_lock_boundary = {
                let runtime = journal.runtime_lock().unwrap();
                runtime.claims.is_empty() && runtime.burned.contains_key(&claim_id)
            };
            if reached_file_lock_boundary {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "worker did not reach file-lock boundary"
            );
            thread::sleep(Duration::from_millis(1));
        }
        // The worker has consumed and burned the claim ID, while this guard makes entry into the
        // timestamp-sampling store closure impossible.
        thread::sleep(Duration::from_millis(25));
        clock.advance(Duration::from_secs(10));
        drop(file_lock);
        let permit = worker.join().unwrap().unwrap();
        let persisted = body(&journal).records.get(&key).unwrap().clone();
        assert_eq!(persisted.transitioned_at_unix_ms, Some(WALL_START + 10_000));
        let binding = journal
            .runtime_lock()
            .unwrap()
            .permits
            .get(&permit.id)
            .unwrap()
            .clone();
        assert_eq!(binding.issued_at_unix_ms, WALL_START + 10_000);
        assert_eq!(binding.expires_at_unix_ms, WALL_START + 40_000);
        assert_eq!(binding.expires_at_monotonic, Duration::from_secs(40));

        clock.set_wall(binding.expires_at_unix_ms);
        assert!(matches!(
            journal.consume_dispatch_permit_for_test(permit),
            Err(JournalError::CapabilityExpired)
        ));
    }

    #[test]
    fn wall_forward_jump_blocks_claim_and_reconciliation_capabilities() {
        let claim_temp = TempDir::new().unwrap();
        let claim_clock = Arc::new(ManualClock::new());
        let claim_journal = confirmed_journal(
            &claim_temp,
            claim_clock.clone(),
            Arc::new(CounterEntropy::new()),
        );
        let claim = claim_journal
            .claim_for_test(plan("wall-claim", PROJECT_A))
            .unwrap();
        claim_clock.set_wall(WALL_START + 300_000);
        assert!(matches!(
            claim_journal.precommit_for_test(claim, json!({"stage": "precommit"})),
            Err(JournalError::CapabilityExpired)
        ));

        let reconcile_temp = TempDir::new().unwrap();
        let reconcile_clock = Arc::new(ManualClock::new());
        let entropy = Arc::new(CounterEntropy::new());
        let reconcile_journal =
            confirmed_journal(&reconcile_temp, reconcile_clock.clone(), entropy.clone());
        let operation = plan("wall-reconcile", PROJECT_A);
        let key = operation.single_flight_key.clone();
        let claim = reconcile_journal.claim_for_test(operation).unwrap();
        reconcile_journal
            .precommit_for_test(claim, json!({"stage": "precommit"}))
            .unwrap();
        reconcile_clock.advance(CLAIM_LEASE + Duration::from_millis(1));
        let recovery = reconcile_journal.reconstruct_for_test(&key).unwrap();
        let recovery_expiry = reconcile_journal
            .runtime_lock()
            .unwrap()
            .recoveries
            .get(&recovery.id)
            .unwrap()
            .0
            .expires_at_unix_ms;
        reconcile_clock.set_wall(recovery_expiry);
        assert!(matches!(
            reconcile_journal.begin_reconciliation_for_test(recovery),
            Err(JournalError::CapabilityExpired)
        ));

        let recovery = reconcile_journal.reconstruct_for_test(&key).unwrap();
        let permit = reconcile_journal
            .begin_reconciliation_for_test(recovery)
            .unwrap();
        let permit_expiry = reconcile_journal
            .runtime_lock()
            .unwrap()
            .reconciliation_permits
            .get(&permit.id)
            .unwrap()
            .binding
            .expires_at_unix_ms;
        reconcile_clock.set_wall(permit_expiry);
        assert!(matches!(
            reconcile_journal.consume_reconciliation_for_test(permit),
            Err(JournalError::CapabilityExpired)
        ));
    }

    #[test]
    fn runtime_registry_reserves_collisions_is_bounded_and_cleans_expiry() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let journal = confirmed_journal(
            &temp,
            clock.clone(),
            Arc::new(ConstantEntropy([7_u8; CAPABILITY_BYTES])),
        );
        journal
            .claim_for_test(plan("collision-a", PROJECT_A))
            .unwrap();
        assert!(matches!(
            journal.claim_for_test(plan("collision-b", "zyxwvutsrqponmlkjihg")),
            Err(JournalError::Unavailable)
        ));
        assert_eq!(body(&journal).records.len(), 1);

        let bounded = confirmed_journal(&temp, clock.clone(), Arc::new(CounterEntropy::new()));
        {
            let mut runtime = bounded.runtime_lock().unwrap();
            for index in 0..MAX_RUNTIME_AUTHORITY_IDS {
                let mut id = [0_u8; CAPABILITY_BYTES];
                id[..8].copy_from_slice(&(index as u64).to_be_bytes());
                runtime.reserved.insert(id, Duration::from_secs(1));
            }
        }
        assert!(matches!(
            bounded.unique_runtime_id(Duration::from_secs(2), MAX_RUNTIME_AUTHORITY_IDS),
            Err(JournalError::Full)
        ));
        clock.advance(Duration::from_secs(1));
        assert!(bounded
            .unique_runtime_id(Duration::from_secs(2), MAX_RUNTIME_AUTHORITY_IDS)
            .is_ok());
    }

    #[test]
    fn admission_runtime_cap_preserves_non_admission_authority_reserve() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let journal = confirmed_journal(&temp, clock, Arc::new(CounterEntropy::new()));
        {
            let mut runtime = journal.runtime_lock().unwrap();
            for index in 0..MAX_ADMISSION_OCCUPIED_RUNTIME_IDS {
                let mut id = [0_u8; CAPABILITY_BYTES];
                id[..8].copy_from_slice(&(index as u64).to_be_bytes());
                runtime.reserved.insert(id, Duration::from_secs(60));
            }
        }

        assert!(matches!(
            journal.claim_plan(
                admission_plan("runtime-full", "runtime-full"),
                CAPABILITY_TTL
            ),
            Err(JournalError::Full)
        ));
        journal
            .claim_for_test(plan("runtime-reserved-cas", PROJECT_A))
            .expect("admission handles must leave runtime capacity for non-admission authority");
        assert_eq!(
            runtime_id_count(&journal.runtime_lock().unwrap()),
            MAX_ADMISSION_OCCUPIED_RUNTIME_IDS + 1
        );
    }

    #[test]
    fn reserved_id_blocks_collision_during_unconfirmed_commit_window() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let entered = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));
        let journal = Arc::new(journal(
            &temp,
            clock,
            Arc::new(ConstantEntropy([9_u8; CAPABILITY_BYTES])),
            Arc::new(BlockingDirectorySync {
                entered: entered.clone(),
                release: release.clone(),
            }),
        ));
        let worker_journal = journal.clone();
        let worker =
            thread::spawn(move || worker_journal.claim_for_test(plan("reserved-a", PROJECT_A)));
        entered.wait();
        assert!(matches!(
            journal.claim_for_test(plan("reserved-b", "zyxwvutsrqponmlkjihg")),
            Err(JournalError::Unavailable)
        ));
        release.wait();
        assert!(worker.join().unwrap().is_ok());
        assert_eq!(body(&journal).records.len(), 1);
    }

    #[test]
    fn full_runtime_registry_does_not_starve_in_place_transitions() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let journal = confirmed_journal(&temp, clock, Arc::new(CounterEntropy::new()));
        let claim = journal
            .claim_for_test(plan("full-precommit", PROJECT_A))
            .unwrap();
        {
            let mut runtime = journal.runtime_lock().unwrap();
            let template = runtime.claims.get(&claim.id).unwrap().clone();
            for prefix in 1..=u8::MAX {
                let mut id = [0_u8; CAPABILITY_BYTES];
                id[0] = prefix;
                runtime.claims.insert(id, template.clone());
            }
            assert_eq!(runtime_id_count(&runtime), MAX_RUNTIME_AUTHORITY_IDS);
        }
        let permit = journal
            .precommit_for_test(claim, json!({"stage": "precommit"}))
            .unwrap();
        assert!(journal
            .runtime_lock()
            .unwrap()
            .permits
            .contains_key(&permit.id));

        let reconcile_temp = TempDir::new().unwrap();
        let reconcile_clock = Arc::new(ManualClock::new());
        let reconcile_journal = confirmed_journal(
            &reconcile_temp,
            reconcile_clock.clone(),
            Arc::new(CounterEntropy::new()),
        );
        let operation = plan("full-reconcile", PROJECT_A);
        let key = operation.single_flight_key.clone();
        let claim = reconcile_journal.claim_for_test(operation).unwrap();
        reconcile_journal
            .precommit_for_test(claim, json!({"stage": "precommit"}))
            .unwrap();
        reconcile_clock.advance(CLAIM_LEASE + Duration::from_millis(1));
        let recovery = reconcile_journal.reconstruct_for_test(&key).unwrap();
        {
            let mut runtime = reconcile_journal.runtime_lock().unwrap();
            let template = runtime.recoveries.get(&recovery.id).unwrap().0.clone();
            for prefix in 1..=u8::MAX {
                let mut id = [0_u8; CAPABILITY_BYTES];
                id[0] = prefix;
                runtime.claims.insert(id, template.clone());
            }
            assert_eq!(runtime_id_count(&runtime), MAX_RUNTIME_AUTHORITY_IDS);
        }
        let reconciliation = reconcile_journal
            .begin_reconciliation_for_test(recovery)
            .unwrap();
        assert!(reconcile_journal
            .runtime_lock()
            .unwrap()
            .reconciliation_permits
            .contains_key(&reconciliation.id));
    }

    #[test]
    fn stale_cross_instance_recovery_cannot_overwrite_terminal_record() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let entropy = Arc::new(CounterEntropy::new());
        let owner = confirmed_journal(&temp, clock.clone(), entropy.clone());
        let operation = plan("cas", PROJECT_A);
        let key = operation.single_flight_key.clone();
        owner.claim_for_test(operation).unwrap();
        clock.advance(CLAIM_LEASE + Duration::from_millis(1));
        let first = confirmed_journal(&temp, clock.clone(), entropy.clone());
        let second = confirmed_journal(&temp, clock, entropy);
        let first_recovery = first.reconstruct_for_test(&key).unwrap();
        let second_recovery = second.reconstruct_for_test(&key).unwrap();
        first
            .settle_reconstructed_claim_for_test(first_recovery, json!({"owner": "first"}))
            .unwrap();
        assert!(matches!(
            second.settle_reconstructed_claim_for_test(second_recovery, json!({"owner": "second"})),
            Err(JournalError::Conflict)
        ));
    }

    #[test]
    fn validation_and_persistence_tamper_fail_closed() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let journal = confirmed_journal(&temp, clock, Arc::new(CounterEntropy::new()));
        let mut invalid = plan("bad-key", PROJECT_A);
        invalid.single_flight_key = "not-a-canonical-digest".to_owned();
        assert!(matches!(
            journal.claim_for_test(invalid),
            Err(JournalError::Invalid)
        ));
        let mut invalid = plan("bad-provider", PROJECT_A);
        invalid.provider_id = "other".to_owned();
        assert!(matches!(
            journal.claim_for_test(invalid),
            Err(JournalError::Invalid)
        ));
        assert!(matches!(
            evidence(
                EvidencePhaseV1::Final,
                json!({"accessToken": "should-never-persist"}),
                WALL_START
            ),
            Err(JournalError::Invalid)
        ));

        journal.claim_for_test(plan("tamper", PROJECT_A)).unwrap();
        let path = temp
            .path()
            .join("app-data")
            .join(STORE_DIRECTORY)
            .join(JOURNAL_FILE);
        let mut envelope: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        envelope["body"]["generation"] = json!(999_u64);
        fs::write(&path, serde_json::to_vec(&envelope).unwrap()).unwrap();
        assert!(matches!(
            journal.list_unresolved(),
            Err(JournalError::Corrupt)
        ));
    }

    #[test]
    fn evidence_and_journal_size_caps_fail_closed() {
        let chunk = "x".repeat(MAX_KEY_BYTES);
        let payload = json!({
            "chunks": vec![chunk; (MAX_EVIDENCE_BYTES / MAX_KEY_BYTES) + 8]
        });
        assert!(matches!(
            evidence(EvidencePhaseV1::Final, payload, WALL_START),
            Err(JournalError::Invalid)
        ));

        let temp = TempDir::new().unwrap();
        let app = temp.path().join("app-data");
        let store = app.join(STORE_DIRECTORY);
        fs::create_dir_all(&store).unwrap();
        fs::write(store.join(JOURNAL_FILE), vec![b' '; MAX_JOURNAL_BYTES + 1]).unwrap();
        let journal = confirmed_journal(
            &temp,
            Arc::new(ManualClock::new()),
            Arc::new(CounterEntropy::new()),
        );
        assert!(matches!(journal.list_unresolved(), Err(JournalError::Full)));
    }

    #[test]
    fn restart_archives_only_terminal_records_and_keeps_replay_fences() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let journal = confirmed_journal(&temp, clock.clone(), Arc::new(CounterEntropy::new()));
        let terminal_plan = plan("archive-terminal", PROJECT_A);
        let terminal_key = settle_applied(&journal, terminal_plan.clone());
        let pending_plan = plan("archive-pending", &project_ref(1));
        let pending_key = pending_plan.single_flight_key.clone();
        journal.claim_for_test(pending_plan).unwrap();
        let unknown_plan = plan("archive-unknown", &project_ref(2));
        let unknown_key = unknown_plan.single_flight_key.clone();
        let unknown_claim = journal.claim_for_test(unknown_plan).unwrap();
        journal
            .precommit_for_test(unknown_claim, json!({"stage": "precommit"}))
            .unwrap();

        let before_restart = body(&journal);
        assert_eq!(before_restart.records.len(), 3);
        assert!(before_restart.tombstones.is_empty());

        let restarted = confirmed_journal(&temp, clock, Arc::new(CounterEntropy::new()));
        let unresolved = restarted.list_unresolved().unwrap();
        assert_eq!(unresolved.len(), 2);
        let recovered = body(&restarted);
        assert!(!recovered.records.contains_key(&terminal_key));
        assert!(recovered.records.contains_key(&pending_key));
        assert!(recovered.records.contains_key(&unknown_key));
        let tombstone = recovered.tombstones.get(&terminal_key).unwrap();
        assert_eq!(tombstone.record.state, OperationStateV1::Applied);
        assert_eq!(
            record_digest(&tombstone.record).unwrap(),
            tombstone.record_digest
        );
        assert!(tombstone.record.final_evidence.is_some());

        assert!(matches!(
            restarted.claim_for_test(terminal_plan),
            Err(JournalError::Conflict)
        ));
        restarted
            .claim_for_test(plan("archive-new-plan", PROJECT_A))
            .expect("a different plan may reuse a scope only after its old record is terminal");
    }

    #[test]
    fn restart_migrates_a_legacy_envelope_and_archives_its_terminal_record() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let writer = confirmed_journal(&temp, clock.clone(), Arc::new(CounterEntropy::new()));
        let terminal_key = settle_applied(&writer, plan("legacy-terminal", PROJECT_A));
        let terminal = body(&writer).records.get(&terminal_key).unwrap().clone();
        let pending = claimed_record(plan("legacy-pending", &project_ref(3)));
        let mut records = BTreeMap::new();
        records.insert(terminal_key.clone(), terminal);
        records.insert(pending.single_flight_key.clone(), pending.clone());
        let legacy_body = LegacyJournalBodyV1 {
            generation: 8,
            records,
        };
        let legacy = LegacyJournalEnvelopeV1 {
            format: JOURNAL_FORMAT.to_owned(),
            version: JOURNAL_LEGACY_VERSION,
            body_digest: digest_bytes(&serde_json::to_vec(&legacy_body).unwrap()),
            body: legacy_body,
        };
        let root = temp.path().join("app-data").join(STORE_DIRECTORY);
        fs::write(
            root.join(JOURNAL_FILE),
            serde_json::to_vec(&legacy).unwrap(),
        )
        .unwrap();

        let restarted = confirmed_journal(&temp, clock, Arc::new(CounterEntropy::new()));
        assert_eq!(restarted.list_unresolved().unwrap().len(), 1);
        let recovered = body(&restarted);
        assert!(recovered.tombstones.contains_key(&terminal_key));
        assert!(recovered.records.contains_key(&pending.single_flight_key));
        let envelope: JournalEnvelopeV1 =
            serde_json::from_slice(&fs::read(root.join(JOURNAL_FILE)).unwrap()).unwrap();
        assert_eq!(envelope.version, JOURNAL_VERSION);
        assert_eq!(envelope.body, recovered);
    }

    #[test]
    fn unconfirmed_startup_archival_latches_closed_without_retrying() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let writer = confirmed_journal(&temp, clock.clone(), Arc::new(CounterEntropy::new()));
        let terminal_key = settle_applied(&writer, plan("unconfirmed-archive", PROJECT_A));
        let sync = Arc::new(FailAfterDirectorySync {
            successful_calls: 0,
            calls: AtomicUsize::new(0),
        });
        let restarted = journal(
            &temp,
            clock.clone(),
            Arc::new(CounterEntropy::new()),
            sync.clone(),
        );
        assert!(matches!(
            restarted.list_unresolved(),
            Err(JournalError::DurabilityUnconfirmed)
        ));
        assert!(matches!(
            restarted.list_unresolved(),
            Err(JournalError::DurabilityUnconfirmed)
        ));
        assert_eq!(sync.calls.load(Ordering::SeqCst), 1);

        let next_process = confirmed_journal(&temp, clock, Arc::new(CounterEntropy::new()));
        assert!(body(&next_process).tombstones.contains_key(&terminal_key));
    }

    #[test]
    fn startup_cleans_only_owned_staging_files_before_archival() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let writer = confirmed_journal(&temp, clock.clone(), Arc::new(CounterEntropy::new()));
        let terminal_key = settle_applied(&writer, plan("staging-archive", PROJECT_A));
        let root = temp.path().join("app-data").join(STORE_DIRECTORY);
        let owned = root.join(".journal-AAAAAAAAAAAAAAAAAAAAAA.tmp");
        let unmanaged = root.join(".journal-short.tmp");
        fs::write(&owned, b"interrupted replacement").unwrap();
        fs::write(&unmanaged, b"unmanaged").unwrap();

        let restarted = confirmed_journal(&temp, clock, Arc::new(CounterEntropy::new()));
        assert!(body(&restarted).tombstones.contains_key(&terminal_key));
        assert!(!owned.exists());
        assert!(unmanaged.exists());
    }

    #[test]
    fn tombstone_digest_tampering_and_capacity_exhaustion_fail_closed() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let writer = confirmed_journal(&temp, clock.clone(), Arc::new(CounterEntropy::new()));
        let terminal_key = settle_applied(&writer, plan("tamper-archive", PROJECT_A));
        let restarted = confirmed_journal(&temp, clock.clone(), Arc::new(CounterEntropy::new()));
        restarted.list_unresolved().unwrap();
        let root = temp.path().join("app-data").join(STORE_DIRECTORY);
        let path = root.join(JOURNAL_FILE);
        let mut envelope: JournalEnvelopeV1 =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        let valid_tombstone = envelope.body.tombstones.get(&terminal_key).unwrap().clone();
        envelope
            .body
            .tombstones
            .get_mut(&terminal_key)
            .unwrap()
            .record_digest = digest_bytes(b"forged-terminal-record");
        envelope.body_digest = digest_bytes(&serde_json::to_vec(&envelope.body).unwrap());
        fs::write(&path, serde_json::to_vec(&envelope).unwrap()).unwrap();
        let tampered = confirmed_journal(&temp, clock, Arc::new(CounterEntropy::new()));
        assert!(matches!(
            tampered.list_unresolved(),
            Err(JournalError::Corrupt)
        ));

        let mut over_capacity = JournalBodyV1::default();
        for index in 0..=MAX_TOMBSTONES {
            over_capacity
                .tombstones
                .insert(format!("tombstone-{index}"), valid_tombstone.clone());
        }
        assert!(matches!(
            validate_body(&over_capacity),
            Err(JournalError::Full)
        ));
    }

    #[test]
    fn wall_rollback_cannot_write_terminal_evidence_before_precommit() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let journal = confirmed_journal(&temp, clock.clone(), Arc::new(CounterEntropy::new()));
        let operation = plan("terminal-rollback", PROJECT_A);
        let key = operation.single_flight_key.clone();
        let claim = journal.claim_for_test(operation).unwrap();
        let permit = journal
            .precommit_for_test(claim, json!({"stage": "precommit"}))
            .unwrap();
        let attempt = journal.consume_dispatch_permit_for_test(permit).unwrap();
        let settlement = journal.mark_dispatch_started_for_test(attempt).unwrap();
        clock.set_wall(WALL_START - 1);
        assert!(matches!(
            journal.settle_dispatch_for_test(
                settlement,
                OperationStateV1::Applied,
                json!({"verified": true})
            ),
            Err(JournalError::InvalidState)
        ));
        let persisted = body(&journal).records.get(&key).unwrap().clone();
        assert_eq!(persisted.state, OperationStateV1::OutcomeUnknown);
        assert!(persisted.final_evidence.is_none());
    }

    #[cfg(unix)]
    #[test]
    fn unix_store_rejects_symlinks_and_hardlinks_and_enforces_private_modes() {
        use std::os::unix::fs::{symlink, MetadataExt, PermissionsExt};

        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClock::new());
        let journal = confirmed_journal(&temp, clock.clone(), Arc::new(CounterEntropy::new()));
        journal.claim_for_test(plan("modes", PROJECT_A)).unwrap();
        let root = temp.path().join("app-data").join(STORE_DIRECTORY);
        assert_eq!(
            fs::metadata(&root).unwrap().permissions().mode() & 0o777,
            0o700
        );
        for name in [JOURNAL_FILE, LOCK_FILE] {
            let metadata = fs::metadata(root.join(name)).unwrap();
            assert_eq!(metadata.permissions().mode() & 0o777, 0o600);
            assert_eq!(metadata.nlink(), 1);
        }

        let symlink_temp = TempDir::new().unwrap();
        let app = symlink_temp.path().join("app-data");
        let store = app.join(STORE_DIRECTORY);
        fs::create_dir_all(&store).unwrap();
        let outside = symlink_temp.path().join("outside.json");
        fs::write(&outside, b"{}").unwrap();
        symlink(&outside, store.join(JOURNAL_FILE)).unwrap();
        let symlink_journal = confirmed_journal(
            &symlink_temp,
            clock.clone(),
            Arc::new(CounterEntropy::new()),
        );
        assert!(matches!(
            symlink_journal.list_unresolved(),
            Err(JournalError::Unavailable)
        ));

        let hardlink_temp = TempDir::new().unwrap();
        let app = hardlink_temp.path().join("app-data");
        let store = app.join(STORE_DIRECTORY);
        fs::create_dir_all(&store).unwrap();
        let outside = hardlink_temp.path().join("outside.json");
        fs::write(&outside, b"{}").unwrap();
        fs::hard_link(&outside, store.join(JOURNAL_FILE)).unwrap();
        let hardlink_journal =
            confirmed_journal(&hardlink_temp, clock, Arc::new(CounterEntropy::new()));
        assert!(matches!(
            hardlink_journal.list_unresolved(),
            Err(JournalError::Unavailable)
        ));
    }
}
