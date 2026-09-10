//! Dormant native composition for the Supabase backfill database CAS-ledger installation.
//!
//! This private module deliberately owns no Tauri command, network or credential client,
//! caller-supplied SQL or SQL execution surface, database transport, production mutation runner,
//! production trust root, or production proof issuer. A
//! sealed reviewed-install proof can only be issued by tests in this slice. Production code can at
//! most consume such a future proof into a durable `Claimed` journal fence; every later transition
//! remains test-only until a separately reviewed native installer and catalog verifier exist.

#![allow(dead_code)]

#[cfg(test)]
mod composition;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use sha2::{Digest, Sha256};
use std::sync::{Arc, Weak};

use crate::backend_operation_journal::{
    BackendOperationJournalV1, CasLedgerInstallJournalClaimV1, JournalError,
};
#[cfg(test)]
use crate::backend_operation_journal::{
    CasLedgerInstallJournalAppliedV1, CasLedgerInstallJournalOutcomeUnknownV1,
};

pub(crate) const CAS_LEDGER_INSTALL_PLAN_FORMAT: &str =
    "openpencil.supabase-backfill-database-cas-ledger-install-plan.v1";
pub(crate) const CAS_LEDGER_INSTALL_MIGRATION_NAME: &str =
    "install_openpencil_backfill_database_cas_ledger_v1";
pub(crate) const CAS_LEDGER_INSTALL_MARKER_PREFIX: &str =
    "openpencil-install:v1:supabase-backfill-database-cas-ledger:";
pub(crate) const CAS_LEDGER_BASE_SQL_DIGEST: &str = "oRFYTUNJDPRM83W1tmGQygKfaBSVjAZAVpG8tR1WSdw";
pub(crate) const CAS_LEDGER_VERIFICATION_QUERY_DIGEST: &str =
    "6FHGNIR1asygQOZJ47nQOISC3aB3RL0rDv5EioVhw4Q";
const CAS_LEDGER_VERIFICATION_QUERY_ID: &str = "backfill-database-cas-ledger-verification";
const CAS_LEDGER_VERIFICATION_QUERY_VERSION: &str =
    "openpencil-supabase-backfill-database-cas-ledger-verification-v1";
const CAS_LEDGER_VERIFICATION_PARAMETER_ORDER: [&str; 9] = [
    "schemaName",
    "reviewDigest",
    "ledgerShapeDigest",
    "sqlDigest",
    "projectRef",
    "accountId",
    "grantGeneration",
    "queryVersion",
    "queryDigest",
];
const CAS_LEDGER_BASE_SQL_SOURCE: &str = include_str!(
    "../../src/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/schema-v1.sql"
);
const CAS_LEDGER_VERIFICATION_SQL_FILE: &str = include_str!(
    "../../src/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/verification-v1.sql"
);
const CAS_LEDGER_BASE_SQL_BYTES: usize = 9_627;
const CAS_LEDGER_INSTALL_SQL_BYTES: usize = 9_841;
const CAS_LEDGER_VERIFICATION_SQL_FILE_BYTES: usize = 31_244;
const CAS_LEDGER_VERIFICATION_SQL_FILE_DIGEST: &str = "zMfr0wQpYpXs8MF0cb05L9SUyePja_EdqXPKHCwd8tk";
const CAS_LEDGER_VERIFICATION_EXECUTED_SQL_BYTES: usize = 31_243;
const CAS_LEDGER_VERIFICATION_EXECUTED_SQL_DIGEST: &str =
    "jBp_hzLNyeEUb-jQdctvOw5iSNYmDMduqskFu3Q-ph8";
const CAS_LEDGER_VERIFICATION_QUERY_CANONICAL_BYTES: usize = 34_909;
const CAS_LEDGER_BASE_COMMIT_SUFFIX: &str = "COMMIT;\n";
const CAS_LEDGER_MARKER_CONSTRAINT: &str = "backfill_executions_v1_pkey";

fn digest_bytes(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(bytes))
}

fn fixed_verification_sql() -> Option<&'static str> {
    if CAS_LEDGER_VERIFICATION_SQL_FILE.len() != CAS_LEDGER_VERIFICATION_SQL_FILE_BYTES
        || digest_bytes(CAS_LEDGER_VERIFICATION_SQL_FILE.as_bytes())
            != CAS_LEDGER_VERIFICATION_SQL_FILE_DIGEST
    {
        return None;
    }
    let source = CAS_LEDGER_VERIFICATION_SQL_FILE.strip_suffix('\n')?;
    (!source.ends_with('\n')
        && source.len() == CAS_LEDGER_VERIFICATION_EXECUTED_SQL_BYTES
        && digest_bytes(source.as_bytes()) == CAS_LEDGER_VERIFICATION_EXECUTED_SQL_DIGEST)
        .then_some(source)
}

fn fixed_verification_query_digest() -> Option<String> {
    fn write_canonical_json(value: &serde_json::Value, output: &mut String) -> Option<()> {
        match value {
            serde_json::Value::Null => output.push_str("null"),
            serde_json::Value::Bool(value) => {
                output.push_str(if *value { "true" } else { "false" });
            }
            serde_json::Value::Number(value) => output.push_str(&value.to_string()),
            serde_json::Value::String(value) => {
                output.push_str(&serde_json::to_string(value).ok()?);
            }
            serde_json::Value::Array(values) => {
                output.push('[');
                for (index, value) in values.iter().enumerate() {
                    if index > 0 {
                        output.push(',');
                    }
                    write_canonical_json(value, output)?;
                }
                output.push(']');
            }
            serde_json::Value::Object(values) => {
                output.push('{');
                let mut entries = values.iter().collect::<Vec<_>>();
                entries.sort_unstable_by(|(left, _), (right, _)| left.cmp(right));
                for (index, (key, value)) in entries.into_iter().enumerate() {
                    if index > 0 {
                        output.push(',');
                    }
                    output.push_str(&serde_json::to_string(key).ok()?);
                    output.push(':');
                    write_canonical_json(value, output)?;
                }
                output.push('}');
            }
        }
        Some(())
    }

    let manifest = serde_json::json!({
        "queryId": CAS_LEDGER_VERIFICATION_QUERY_ID,
        "version": CAS_LEDGER_VERIFICATION_QUERY_VERSION,
        "sql": fixed_verification_sql()?,
        "parameterOrder": CAS_LEDGER_VERIFICATION_PARAMETER_ORDER,
        "statementCount": 1,
        "catalogOnly": true,
        "managedDataRead": false,
        "accessMode": "read-only",
        "snapshotScope": "single-statement"
    });
    let mut canonical = String::new();
    write_canonical_json(&manifest, &mut canonical)?;
    (canonical.len() == CAS_LEDGER_VERIFICATION_QUERY_CANONICAL_BYTES)
        .then(|| digest_bytes(canonical.as_bytes()))
}

fn render_install_sql_for_marker(marker: &str, marker_binding_digest: &str) -> Option<String> {
    if CAS_LEDGER_BASE_SQL_SOURCE.len() != CAS_LEDGER_BASE_SQL_BYTES
        || digest_bytes(CAS_LEDGER_BASE_SQL_SOURCE.as_bytes()) != CAS_LEDGER_BASE_SQL_DIGEST
        || fixed_verification_sql().is_none()
        || marker
            != format!(
                "{CAS_LEDGER_INSTALL_MARKER_PREFIX}{}",
                marker_binding_digest
            )
    {
        return None;
    }
    let prefix = CAS_LEDGER_BASE_SQL_SOURCE.strip_suffix(CAS_LEDGER_BASE_COMMIT_SUFFIX)?;
    if prefix.contains(CAS_LEDGER_BASE_COMMIT_SUFFIX) {
        return None;
    }
    let sql = format!(
        "{prefix}\nCOMMENT ON CONSTRAINT \"{CAS_LEDGER_MARKER_CONSTRAINT}\" ON \"openpencil_release\".\"backfill_executions_v1\"\n  IS '{}';\n{CAS_LEDGER_BASE_COMMIT_SUFFIX}",
        marker
    );
    (sql.len() == CAS_LEDGER_INSTALL_SQL_BYTES).then_some(sql)
}

pub(crate) fn fixed_cas_ledger_install_sql_digest(
    marker: &str,
    marker_binding_digest: &str,
) -> Option<String> {
    render_install_sql_for_marker(marker, marker_binding_digest)
        .map(|sql| digest_bytes(sql.as_bytes()))
}

fn rendered_install_sql(material: &CasLedgerInstallPlanMaterialV1) -> Option<String> {
    let verification_query_digest = fixed_verification_query_digest()?;
    if material.base_sql_digest != CAS_LEDGER_BASE_SQL_DIGEST
        || verification_query_digest != CAS_LEDGER_VERIFICATION_QUERY_DIGEST
        || material.verification_query_digest != verification_query_digest
    {
        return None;
    }
    let sql = render_install_sql_for_marker(&material.marker, &material.marker_binding_digest)?;
    (digest_bytes(sql.as_bytes()) == material.install_sql_digest).then_some(sql)
}

pub(crate) fn validate_fixed_cas_ledger_install_artifacts(
    material: &CasLedgerInstallPlanMaterialV1,
) -> bool {
    rendered_install_sql(material).is_some()
}

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct CasLedgerInstallPlanMaterialV1 {
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
}

/// Opaque, one-shot proof that a future native verifier reviewed the complete secret-free plan.
/// It intentionally implements neither Clone, Debug, Serialize, nor Deserialize.
pub(crate) struct SealedCasLedgerInstallReviewProofV1 {
    material: CasLedgerInstallPlanMaterialV1,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum CasLedgerInstallObservedStateV1 {
    Absent,
    Installed,
    Mismatch,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum CasLedgerInstallObservedMarkerStateV1 {
    Absent,
    ExactSingle,
    Mismatch,
}

pub(crate) struct CasLedgerInstallObservationInputV1 {
    pub(crate) state: CasLedgerInstallObservedStateV1,
    pub(crate) verified_installed: bool,
    pub(crate) exact_installed_state: bool,
    pub(crate) all_verification_checks_passed: bool,
    pub(crate) marker_state: CasLedgerInstallObservedMarkerStateV1,
    pub(crate) constraint_comment: Option<String>,
    pub(crate) schema_marker_prefix_count: u32,
    pub(crate) exact_single_marker_on_constraint: bool,
    pub(crate) installed_verification_digest: String,
    pub(crate) observed_at: String,
    pub(crate) snapshot_marker: String,
    pub(crate) server_version_num: String,
}

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct CasLedgerInstallInstalledObservationMaterialV1 {
    pub(crate) plan: CasLedgerInstallPlanMaterialV1,
    pub(crate) installed_verification_digest: String,
    pub(crate) observed_at: String,
    pub(crate) snapshot_marker: String,
    pub(crate) server_version_num: String,
}

struct CasLedgerInstallVerificationEpochV1;

/// Opaque proof of one exact `installed` catalog observation. It cannot be cloned, debugged, or
/// serialized. Its only issuer is test-only until a native fixed-query verifier is reviewed.
pub(crate) struct SealedCasLedgerInstalledObservationProofV1 {
    material: CasLedgerInstallInstalledObservationMaterialV1,
    epoch: Arc<CasLedgerInstallVerificationEpochV1>,
}

/// Epoch-checked proof consumed by the journal's test-only positive settlement boundary.
pub(crate) struct ConsumedCasLedgerInstalledObservationProofV1 {
    material: CasLedgerInstallInstalledObservationMaterialV1,
}

impl ConsumedCasLedgerInstalledObservationProofV1 {
    pub(crate) fn into_settlement_material(self) -> CasLedgerInstallInstalledObservationMaterialV1 {
        self.material
    }
}

impl SealedCasLedgerInstallReviewProofV1 {
    pub(crate) fn into_claim_material(self) -> CasLedgerInstallPlanMaterialV1 {
        self.material
    }

    #[cfg(test)]
    pub(crate) fn issue_for_test(material: CasLedgerInstallPlanMaterialV1) -> Self {
        Self { material }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum BackendCasLedgerInstallErrorV1 {
    ReviewRejected,
    ReplayBlocked,
    CapacityExceeded,
    DurabilityUnconfirmed,
    HandleExpired,
    InstalledProofRejected,
    Unavailable,
}

pub(crate) struct BackendCasLedgerInstallV1 {
    journal: Arc<BackendOperationJournalV1>,
}

impl BackendCasLedgerInstallV1 {
    pub(crate) fn new(journal: Arc<BackendOperationJournalV1>) -> Self {
        Self { journal }
    }

    pub(crate) fn claim(
        &self,
        proof: SealedCasLedgerInstallReviewProofV1,
    ) -> Result<DurableCasLedgerInstallClaimHandleV1, BackendCasLedgerInstallErrorV1> {
        let claim = self
            .journal
            .claim_cas_ledger_install(proof)
            .map_err(map_journal_error)?;
        let material = claim.material_for_composition().clone();
        Ok(DurableCasLedgerInstallClaimHandleV1 {
            journal: Arc::downgrade(&self.journal),
            claim: Some(claim),
            material,
        })
    }
}

/// Opaque, 30-second handoff for a confirmed durable `Claimed` fence. Dropping or expiring this
/// value never removes the persisted single-flight or project-scope fence.
pub(crate) struct DurableCasLedgerInstallClaimHandleV1 {
    journal: Weak<BackendOperationJournalV1>,
    claim: Option<CasLedgerInstallJournalClaimV1>,
    material: CasLedgerInstallPlanMaterialV1,
}

impl DurableCasLedgerInstallClaimHandleV1 {
    pub(crate) const fn durably_claimed(&self) -> bool {
        true
    }

    pub(crate) const fn database_ledger_bound(&self) -> bool {
        false
    }

    pub(crate) const fn mutation_authorized(&self) -> bool {
        false
    }

    pub(crate) const fn execution_authorized(&self) -> bool {
        false
    }

    pub(crate) const fn source_ledger_bound(&self) -> bool {
        false
    }

    pub(crate) const fn release_authorized(&self) -> bool {
        false
    }

    #[cfg(test)]
    pub(crate) fn plan_digest_for_test(&self) -> Option<&str> {
        self.claim
            .as_ref()
            .map(|claim| claim.plan_digest_for_test())
    }

    #[cfg(test)]
    pub(crate) fn single_flight_key_for_test(&self) -> Option<&str> {
        self.claim
            .as_ref()
            .map(|claim| claim.single_flight_key_for_test())
    }

    #[cfg(test)]
    pub(crate) fn begin_outcome_unknown_for_test(
        mut self,
    ) -> Result<DurableCasLedgerInstallOutcomeUnknownHandleV1, BackendCasLedgerInstallErrorV1> {
        let claim = self
            .claim
            .take()
            .ok_or(BackendCasLedgerInstallErrorV1::Unavailable)?;
        let journal = self
            .journal
            .upgrade()
            .ok_or(BackendCasLedgerInstallErrorV1::Unavailable)?;
        let outcome = journal
            .precommit_cas_ledger_install_for_test(claim)
            .map_err(map_journal_error)?;
        Ok(DurableCasLedgerInstallOutcomeUnknownHandleV1 {
            journal: Arc::downgrade(&journal),
            outcome: Some(outcome),
            material: self.material,
            epoch: Arc::new(CasLedgerInstallVerificationEpochV1),
        })
    }
}

#[cfg(test)]
pub(crate) struct DurableCasLedgerInstallOutcomeUnknownHandleV1 {
    journal: Weak<BackendOperationJournalV1>,
    outcome: Option<CasLedgerInstallJournalOutcomeUnknownV1>,
    material: CasLedgerInstallPlanMaterialV1,
    epoch: Arc<CasLedgerInstallVerificationEpochV1>,
}

#[cfg(test)]
impl DurableCasLedgerInstallOutcomeUnknownHandleV1 {
    pub(crate) fn issue_installed_observation_for_test(
        &self,
        input: CasLedgerInstallObservationInputV1,
    ) -> Result<SealedCasLedgerInstalledObservationProofV1, BackendCasLedgerInstallErrorV1> {
        validate_installed_observation(&self.material, &input)?;
        Ok(SealedCasLedgerInstalledObservationProofV1 {
            material: CasLedgerInstallInstalledObservationMaterialV1 {
                plan: self.material.clone(),
                installed_verification_digest: input.installed_verification_digest,
                observed_at: input.observed_at,
                snapshot_marker: input.snapshot_marker,
                server_version_num: input.server_version_num,
            },
            epoch: Arc::clone(&self.epoch),
        })
    }

    pub(crate) fn rotate_verification_epoch_for_test(&mut self) {
        self.epoch = Arc::new(CasLedgerInstallVerificationEpochV1);
    }

    pub(crate) fn settle_installed_for_test(
        &mut self,
        proof: SealedCasLedgerInstalledObservationProofV1,
    ) -> Result<DurableCasLedgerInstalledProofV1, BackendCasLedgerInstallErrorV1> {
        if !Arc::ptr_eq(&self.epoch, &proof.epoch) || proof.material.plan != self.material {
            return Err(BackendCasLedgerInstallErrorV1::InstalledProofRejected);
        }
        let journal = self
            .journal
            .upgrade()
            .ok_or(BackendCasLedgerInstallErrorV1::Unavailable)?;
        let outcome = self
            .outcome
            .take()
            .ok_or(BackendCasLedgerInstallErrorV1::Unavailable)?;
        let consumed = ConsumedCasLedgerInstalledObservationProofV1 {
            material: proof.material,
        };
        let applied = journal
            .settle_cas_ledger_install_applied_for_test(outcome, consumed)
            .map_err(map_journal_error)?;
        Ok(DurableCasLedgerInstalledProofV1 {
            journal: Arc::downgrade(&journal),
            applied,
        })
    }
}

/// Same-process proof issued only after the positive installed observation and `Applied` record
/// are durably committed. It grants no mutation, execution, source-ledger, Receipt, or release
/// authority and intentionally has no Clone/Debug/serde implementation.
#[cfg(test)]
pub(crate) struct DurableCasLedgerInstalledProofV1 {
    journal: Weak<BackendOperationJournalV1>,
    applied: CasLedgerInstallJournalAppliedV1,
}

/// Test-only sealed handoff of one durably Applied installed-ledger observation.
#[cfg(test)]
pub(crate) struct ConsumedDurableCasLedgerInstallForInitializerV1 {
    journal: Weak<BackendOperationJournalV1>,
    material: CasLedgerInstallInstalledObservationMaterialV1,
    plan_digest: String,
}

#[cfg(test)]
impl ConsumedDurableCasLedgerInstallForInitializerV1 {
    pub(crate) fn material_for_composition(
        &self,
    ) -> &CasLedgerInstallInstalledObservationMaterialV1 {
        &self.material
    }

    pub(crate) fn plan_digest_for_composition(&self) -> &str {
        &self.plan_digest
    }

    pub(crate) fn belongs_to_journal(&self, journal: &Arc<BackendOperationJournalV1>) -> bool {
        self.journal
            .upgrade()
            .is_some_and(|bound| Arc::ptr_eq(&bound, journal))
    }
}

#[cfg(test)]
impl DurableCasLedgerInstalledProofV1 {
    pub(crate) fn plan_digest_for_initializer_for_test(&self) -> &str {
        self.applied.plan_digest_for_initializer_for_test()
    }

    pub(crate) fn consume_for_initializer_for_test(
        self,
    ) -> Result<ConsumedDurableCasLedgerInstallForInitializerV1, BackendCasLedgerInstallErrorV1>
    {
        let Self { journal, applied } = self;
        let (material, plan_digest) = applied
            .into_initializer_material_for_test()
            .map_err(map_journal_error)?;
        Ok(ConsumedDurableCasLedgerInstallForInitializerV1 {
            journal,
            material,
            plan_digest,
        })
    }

    pub(crate) const fn database_ledger_bound(&self) -> bool {
        true
    }

    pub(crate) const fn mutation_authorized(&self) -> bool {
        false
    }

    pub(crate) const fn execution_authorized(&self) -> bool {
        false
    }

    pub(crate) const fn source_ledger_bound(&self) -> bool {
        false
    }

    pub(crate) const fn receipt_issued(&self) -> bool {
        false
    }

    pub(crate) const fn release_authorized(&self) -> bool {
        false
    }
}

#[cfg(test)]
fn validate_installed_observation(
    plan: &CasLedgerInstallPlanMaterialV1,
    input: &CasLedgerInstallObservationInputV1,
) -> Result<(), BackendCasLedgerInstallErrorV1> {
    let expected_marker = Some(plan.marker.as_str());
    if input.state != CasLedgerInstallObservedStateV1::Installed
        || !input.verified_installed
        || !input.exact_installed_state
        || !input.all_verification_checks_passed
        || input.marker_state != CasLedgerInstallObservedMarkerStateV1::ExactSingle
        || input.constraint_comment.as_deref() != expected_marker
        || input.schema_marker_prefix_count != 1
        || !input.exact_single_marker_on_constraint
        || !is_digest(&input.installed_verification_digest)
        || !is_canonical_timestamp(&input.observed_at)
        || !is_snapshot_marker(&input.snapshot_marker)
        || !is_supported_server_version(&input.server_version_num)
    {
        return Err(BackendCasLedgerInstallErrorV1::InstalledProofRejected);
    }
    Ok(())
}

#[cfg(test)]
fn is_digest(value: &str) -> bool {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;

    if value.len() != 43
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return false;
    }
    let Ok(bytes) = URL_SAFE_NO_PAD.decode(value) else {
        return false;
    };
    bytes.len() == 32 && URL_SAFE_NO_PAD.encode(bytes) == value
}

#[cfg(test)]
fn is_snapshot_marker(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 512
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b':' | b','))
}

#[cfg(test)]
fn is_supported_server_version(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 6
        && bytes.iter().all(u8::is_ascii_digit)
        && matches!(&bytes[..2], b"15" | b"16" | b"17")
}

#[cfg(test)]
fn is_canonical_timestamp(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 24
        || bytes.get(4) != Some(&b'-')
        || bytes.get(7) != Some(&b'-')
        || bytes.get(10) != Some(&b'T')
        || bytes.get(13) != Some(&b':')
        || bytes.get(16) != Some(&b':')
        || bytes.get(19) != Some(&b'.')
        || bytes.get(23) != Some(&b'Z')
    {
        return false;
    }
    let number = |range: std::ops::Range<usize>| -> Option<u32> {
        std::str::from_utf8(&bytes[range]).ok()?.parse().ok()
    };
    let Some(year) = number(0..4) else {
        return false;
    };
    let Some(month) = number(5..7) else {
        return false;
    };
    let Some(day) = number(8..10) else {
        return false;
    };
    let Some(hour) = number(11..13) else {
        return false;
    };
    let Some(minute) = number(14..16) else {
        return false;
    };
    let Some(second) = number(17..19) else {
        return false;
    };
    if number(20..23).is_none()
        || !(1..=12).contains(&month)
        || hour > 23
        || minute > 59
        || second > 59
    {
        return false;
    }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let maximum_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    day >= 1 && day <= maximum_day
}

fn map_journal_error(error: JournalError) -> BackendCasLedgerInstallErrorV1 {
    match error {
        JournalError::Conflict | JournalError::ScopeConflict => {
            BackendCasLedgerInstallErrorV1::ReplayBlocked
        }
        JournalError::Full => BackendCasLedgerInstallErrorV1::CapacityExceeded,
        JournalError::DurabilityUnconfirmed => {
            BackendCasLedgerInstallErrorV1::DurabilityUnconfirmed
        }
        JournalError::CapabilityExpired | JournalError::CapabilityMissing => {
            BackendCasLedgerInstallErrorV1::HandleExpired
        }
        JournalError::Invalid => BackendCasLedgerInstallErrorV1::ReviewRejected,
        JournalError::Unavailable
        | JournalError::Corrupt
        | JournalError::InvalidState
        | JournalError::LeaseActive => BackendCasLedgerInstallErrorV1::Unavailable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use sha2::{Digest, Sha256};
    use std::{
        fs,
        path::Path,
        sync::{
            atomic::{AtomicBool, AtomicU64, Ordering},
            Barrier,
        },
        thread,
        time::Duration,
    };
    use tempfile::TempDir;

    use crate::backend_operation_journal::{DirectorySync, JournalClock, JournalEntropy};

    const INITIAL_WALL_MS: u64 = 1_788_844_800_000;

    struct ManualClockV1 {
        wall_ms: AtomicU64,
        monotonic_ms: AtomicU64,
    }

    impl ManualClockV1 {
        fn new() -> Self {
            Self {
                wall_ms: AtomicU64::new(INITIAL_WALL_MS),
                monotonic_ms: AtomicU64::new(0),
            }
        }

        fn advance(&self, duration: Duration) {
            let millis = u64::try_from(duration.as_millis()).expect("test duration");
            self.wall_ms.fetch_add(millis, Ordering::SeqCst);
            self.monotonic_ms.fetch_add(millis, Ordering::SeqCst);
        }
    }

    impl JournalClock for ManualClockV1 {
        fn wall_unix_millis(&self) -> Result<u64, JournalError> {
            Ok(self.wall_ms.load(Ordering::SeqCst))
        }

        fn monotonic(&self) -> Duration {
            Duration::from_millis(self.monotonic_ms.load(Ordering::SeqCst))
        }
    }

    struct CounterEntropyV1(AtomicU64);

    impl CounterEntropyV1 {
        fn new() -> Self {
            Self(AtomicU64::new(1))
        }
    }

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

    struct FailOnceDirectorySyncV1(AtomicBool);

    impl FailOnceDirectorySyncV1 {
        fn new() -> Self {
            Self(AtomicBool::new(true))
        }
    }

    impl DirectorySync for FailOnceDirectorySyncV1 {
        fn sync(&self, _directory: &Path) -> Result<(), JournalError> {
            if self.0.swap(false, Ordering::SeqCst) {
                Err(JournalError::Unavailable)
            } else {
                Ok(())
            }
        }
    }

    fn digest(label: &str) -> String {
        URL_SAFE_NO_PAD.encode(Sha256::digest(label.as_bytes()))
    }

    fn material(project_ref: &str, label: &str) -> CasLedgerInstallPlanMaterialV1 {
        let marker_binding_digest = digest(&format!("marker-binding:{label}"));
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

    fn cross_language_material() -> CasLedgerInstallPlanMaterialV1 {
        CasLedgerInstallPlanMaterialV1 {
            provider_id: "supabase".to_owned(),
            environment: "staging".to_owned(),
            project_ref: "abcdefghijklmnopqrst".to_owned(),
            account_id: "account-a".to_owned(),
            read_grant_generation: "11111111-1111-4111-8111-111111111111".to_owned(),
            write_grant_generation: "22222222-2222-4222-8222-222222222222".to_owned(),
            migration_name: CAS_LEDGER_INSTALL_MIGRATION_NAME.to_owned(),
            install_review_digest: "3Dztut_52Xf83rrvZWzQlPh41dhr-CBR6wYoAv9SD4M".to_owned(),
            source_review_digest: "mAhSJaI_LdyqRkRsSXa4U-3ZdCL2mcxkxDp_Z3vk7MY".to_owned(),
            verification_digest: "QYO3eT_Si6R-qeeedpfykV2iGFZ-ZlehWLUb0UvOkc0".to_owned(),
            ledger_shape_digest: "R8NzC7DM_Ncx9nHAwF_6av5i9DlKiH6YXKH6eZUSKps".to_owned(),
            base_sql_digest: CAS_LEDGER_BASE_SQL_DIGEST.to_owned(),
            marker: concat!(
                "openpencil-install:v1:supabase-backfill-database-cas-ledger:",
                "_RQpcXO0LqmNq4hoA8GsquIuW5T5iTnhct2cUV1QE_0"
            )
            .to_owned(),
            marker_binding_digest: "_RQpcXO0LqmNq4hoA8GsquIuW5T5iTnhct2cUV1QE_0".to_owned(),
            install_sql_digest: "Ki4uj33DqTZd049Qcz1mDi3JQvavEYJdeHB0l3Pmd_E".to_owned(),
            verification_query_digest: CAS_LEDGER_VERIFICATION_QUERY_DIGEST.to_owned(),
        }
    }

    fn observation(
        plan: &CasLedgerInstallPlanMaterialV1,
        state: CasLedgerInstallObservedStateV1,
        marker_state: CasLedgerInstallObservedMarkerStateV1,
    ) -> CasLedgerInstallObservationInputV1 {
        CasLedgerInstallObservationInputV1 {
            state,
            verified_installed: state == CasLedgerInstallObservedStateV1::Installed,
            exact_installed_state: state == CasLedgerInstallObservedStateV1::Installed,
            all_verification_checks_passed: true,
            marker_state,
            constraint_comment: (marker_state
                == CasLedgerInstallObservedMarkerStateV1::ExactSingle)
                .then(|| plan.marker.clone()),
            schema_marker_prefix_count: u32::from(
                marker_state == CasLedgerInstallObservedMarkerStateV1::ExactSingle,
            ),
            exact_single_marker_on_constraint: marker_state
                == CasLedgerInstallObservedMarkerStateV1::ExactSingle,
            installed_verification_digest: digest("installed-verification"),
            observed_at: "2026-09-08T12:00:00.000Z".to_owned(),
            snapshot_marker: "100:101:".to_owned(),
            server_version_num: "170000".to_owned(),
        }
    }

    fn journal(
        temp: &TempDir,
        clock: Arc<ManualClockV1>,
        directory_sync: Arc<dyn DirectorySync>,
    ) -> Arc<BackendOperationJournalV1> {
        Arc::new(BackendOperationJournalV1::with_test_dependencies(
            temp.path().join("app-data"),
            Arc::new(CounterEntropyV1::new()),
            clock,
            directory_sync,
        ))
    }

    fn journal_file(temp: &TempDir) -> std::path::PathBuf {
        temp.path()
            .join("app-data/backend-operation-journal/journal.v1.json")
    }

    fn project_ref_for_index(index: usize) -> String {
        assert!(index < 26 * 26);
        format!(
            "aaaaaaaaaaaaaaaaaa{}{}",
            char::from(b'a' + u8::try_from(index / 26).unwrap()),
            char::from(b'a' + u8::try_from(index % 26).unwrap())
        )
    }

    fn claim(
        install: &BackendCasLedgerInstallV1,
        material: CasLedgerInstallPlanMaterialV1,
    ) -> Result<DurableCasLedgerInstallClaimHandleV1, BackendCasLedgerInstallErrorV1> {
        install.claim(SealedCasLedgerInstallReviewProofV1::issue_for_test(
            material,
        ))
    }

    fn error_of<T>(
        result: Result<T, BackendCasLedgerInstallErrorV1>,
    ) -> BackendCasLedgerInstallErrorV1 {
        match result {
            Ok(_) => panic!("expected the operation to fail closed"),
            Err(error) => error,
        }
    }

    #[test]
    fn committed_sql_sources_and_query_manifest_have_exact_cross_language_bytes() {
        assert_eq!(CAS_LEDGER_BASE_SQL_SOURCE.len(), CAS_LEDGER_BASE_SQL_BYTES);
        assert_eq!(
            digest_bytes(CAS_LEDGER_BASE_SQL_SOURCE.as_bytes()),
            CAS_LEDGER_BASE_SQL_DIGEST
        );
        assert!(CAS_LEDGER_BASE_SQL_SOURCE.ends_with('\n'));
        assert!(!CAS_LEDGER_BASE_SQL_SOURCE.ends_with("\n\n"));

        assert_eq!(
            CAS_LEDGER_VERIFICATION_SQL_FILE.len(),
            CAS_LEDGER_VERIFICATION_SQL_FILE_BYTES
        );
        assert_eq!(
            digest_bytes(CAS_LEDGER_VERIFICATION_SQL_FILE.as_bytes()),
            CAS_LEDGER_VERIFICATION_SQL_FILE_DIGEST
        );
        assert!(CAS_LEDGER_VERIFICATION_SQL_FILE.ends_with('\n'));
        assert!(!CAS_LEDGER_VERIFICATION_SQL_FILE.ends_with("\n\n"));

        let executed = fixed_verification_sql().expect("fixed verification SQL");
        assert_eq!(executed.len(), CAS_LEDGER_VERIFICATION_EXECUTED_SQL_BYTES);
        assert_eq!(
            digest_bytes(executed.as_bytes()),
            CAS_LEDGER_VERIFICATION_EXECUTED_SQL_DIGEST
        );
        assert_eq!(
            fixed_verification_query_digest().as_deref(),
            Some(CAS_LEDGER_VERIFICATION_QUERY_DIGEST)
        );
    }

    #[test]
    fn server_version_validation_rejects_non_ascii_without_panicking() {
        assert!(is_supported_server_version("150000"));
        assert!(is_supported_server_version("160000"));
        assert!(is_supported_server_version("170000"));
        assert!(!is_supported_server_version("1é123"));
        assert!(!is_supported_server_version("180000"));
    }

    #[test]
    fn canonical_plan_matches_the_typescript_durable_binding_and_claim_is_non_authoritative() {
        let temp = TempDir::new().unwrap();
        let journal = journal(
            &temp,
            Arc::new(ManualClockV1::new()),
            Arc::new(ConfirmedDirectorySyncV1),
        );
        let install = BackendCasLedgerInstallV1::new(journal);
        let handle = claim(&install, cross_language_material()).unwrap();
        assert_eq!(
            handle.plan_digest_for_test(),
            Some("CHPTgqKuWIWKPhK-E0ApzKpBut1HoDaDzO3JNYCgn3I")
        );
        assert_eq!(handle.single_flight_key_for_test().unwrap().len(), 43);
        assert!(handle.durably_claimed());
        assert!(!handle.database_ledger_bound());
        assert!(!handle.mutation_authorized());
        assert!(!handle.execution_authorized());
        assert!(!handle.source_ledger_bound());
        assert!(!handle.release_authorized());

        let persisted: serde_json::Value =
            serde_json::from_slice(&fs::read(journal_file(&temp)).unwrap()).unwrap();
        let record = persisted["body"]["records"]
            .as_object()
            .unwrap()
            .values()
            .next()
            .unwrap();
        assert_eq!(record["state"], "claimed");
        assert_eq!(record["ownerId"], "native-cas-ledger-install");
        assert_eq!(
            record["releaseId"],
            "cas-ledger-install:CHPTgqKuWIWKPhK-E0ApzKpBut1HoDaDzO3JNYCgn3I"
        );
    }

    #[test]
    fn malformed_tampered_secret_and_trimmed_reviews_write_nothing() {
        let temp = TempDir::new().unwrap();
        let journal = journal(
            &temp,
            Arc::new(ManualClockV1::new()),
            Arc::new(ConfirmedDirectorySyncV1),
        );
        let install = BackendCasLedgerInstallV1::new(journal);
        let base = material("abcdefghijklmnopqrst", "tamper");
        let mut candidates = Vec::new();
        let mut candidate = base.clone();
        candidate.provider_id = "other".to_owned();
        candidates.push(candidate);
        let mut candidate = base.clone();
        candidate.environment = "production".to_owned();
        candidates.push(candidate);
        let mut candidate = base.clone();
        candidate.project_ref = "abcdefghijklmnopqrs1".to_owned();
        candidates.push(candidate);
        let mut candidate = base.clone();
        candidate.account_id = "\u{feff}account".to_owned();
        candidates.push(candidate);
        let mut candidate = base.clone();
        candidate.account_id = "Abcdefghijklmnopqrstuvwxyz0123456789".to_owned();
        candidates.push(candidate);
        let mut candidate = base.clone();
        candidate.write_grant_generation = candidate.read_grant_generation.clone();
        candidates.push(candidate);
        let mut candidate = base.clone();
        candidate.install_review_digest = "not-a-digest".to_owned();
        candidates.push(candidate);
        let mut candidate = base;
        candidate.marker.push('x');
        candidates.push(candidate);

        for candidate in candidates {
            assert_eq!(
                error_of(claim(&install, candidate)),
                BackendCasLedgerInstallErrorV1::ReviewRejected
            );
        }
        assert!(!journal_file(&temp).exists());
    }

    #[test]
    fn unconfirmed_drop_ttl_restart_and_concurrency_never_unlock_replay() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClockV1::new());
        let path = temp.path().join("app-data");
        let unconfirmed = Arc::new(BackendOperationJournalV1::with_test_dependencies(
            path.clone(),
            Arc::new(CounterEntropyV1::new()),
            Arc::clone(&clock) as Arc<dyn JournalClock>,
            Arc::new(FailOnceDirectorySyncV1::new()),
        ));
        let first = BackendCasLedgerInstallV1::new(Arc::clone(&unconfirmed));
        let plan = material("abcdefghijklmnopqrst", "durability");
        assert_eq!(
            error_of(claim(&first, plan.clone())),
            BackendCasLedgerInstallErrorV1::DurabilityUnconfirmed
        );
        assert_eq!(
            error_of(claim(&first, plan.clone())),
            BackendCasLedgerInstallErrorV1::ReplayBlocked
        );

        let restarted = Arc::new(BackendOperationJournalV1::with_test_dependencies(
            path,
            Arc::new(CounterEntropyV1::new()),
            Arc::clone(&clock) as Arc<dyn JournalClock>,
            Arc::new(ConfirmedDirectorySyncV1),
        ));
        let restarted_install = BackendCasLedgerInstallV1::new(restarted);
        assert_eq!(
            error_of(claim(&restarted_install, plan)),
            BackendCasLedgerInstallErrorV1::ReplayBlocked
        );

        let second_temp = TempDir::new().unwrap();
        let second_clock = Arc::new(ManualClockV1::new());
        let concurrent_journal = journal(
            &second_temp,
            Arc::clone(&second_clock),
            Arc::new(ConfirmedDirectorySyncV1),
        );
        let barrier = Arc::new(Barrier::new(2));
        let mut workers = Vec::new();
        for _ in 0..2 {
            let journal = Arc::clone(&concurrent_journal);
            let barrier = Arc::clone(&barrier);
            workers.push(thread::spawn(move || {
                let install = BackendCasLedgerInstallV1::new(journal);
                barrier.wait();
                claim(&install, material("bcdefghijklmnopqrstu", "concurrent")).is_ok()
            }));
        }
        assert_eq!(
            workers
                .into_iter()
                .map(|worker| worker.join().unwrap())
                .filter(|claimed| *claimed)
                .count(),
            1
        );
        assert_eq!(
            error_of(claim(
                &BackendCasLedgerInstallV1::new(Arc::clone(&concurrent_journal)),
                material("bcdefghijklmnopqrstu", "concurrent"),
            )),
            BackendCasLedgerInstallErrorV1::ReplayBlocked
        );
        assert_eq!(
            error_of(claim(
                &BackendCasLedgerInstallV1::new(Arc::clone(&concurrent_journal)),
                material("bcdefghijklmnopqrstu", "concurrent-scope-conflict"),
            )),
            BackendCasLedgerInstallErrorV1::ReplayBlocked
        );

        let ttl_plan = material("cdefghijklmnopqrstuv", "ttl");
        let ttl_install = BackendCasLedgerInstallV1::new(Arc::clone(&concurrent_journal));
        let ttl_handle = claim(&ttl_install, ttl_plan.clone()).unwrap();
        second_clock.advance(Duration::from_secs(31));
        assert_eq!(
            error_of(ttl_handle.begin_outcome_unknown_for_test()),
            BackendCasLedgerInstallErrorV1::HandleExpired
        );
        assert_eq!(
            error_of(claim(&ttl_install, ttl_plan)),
            BackendCasLedgerInstallErrorV1::ReplayBlocked
        );
    }

    #[test]
    fn persistent_record_capacity_fails_closed_after_runtime_handles_expire() {
        const EXPECTED_RECORD_CAP: usize = 256;

        let temp = TempDir::new().unwrap();
        let clock = Arc::new(ManualClockV1::new());
        let journal = journal(
            &temp,
            Arc::clone(&clock),
            Arc::new(ConfirmedDirectorySyncV1),
        );
        let install = BackendCasLedgerInstallV1::new(journal);
        for index in 0..EXPECTED_RECORD_CAP {
            claim(
                &install,
                material(&project_ref_for_index(index), &format!("capacity-{index}")),
            )
            .unwrap();
        }

        clock.advance(Duration::from_secs(31));
        assert_eq!(
            error_of(claim(
                &install,
                material("zzzzzzzzzzzzzzzzzzzz", "capacity-overflow"),
            )),
            BackendCasLedgerInstallErrorV1::CapacityExceeded
        );
        let persisted: serde_json::Value =
            serde_json::from_slice(&fs::read(journal_file(&temp)).unwrap()).unwrap();
        assert_eq!(
            persisted["body"]["records"].as_object().unwrap().len(),
            EXPECTED_RECORD_CAP
        );
    }

    #[test]
    fn only_fresh_exact_installed_observation_can_durably_settle_applied() {
        let temp = TempDir::new().unwrap();
        let journal = journal(
            &temp,
            Arc::new(ManualClockV1::new()),
            Arc::new(ConfirmedDirectorySyncV1),
        );
        let install = BackendCasLedgerInstallV1::new(journal);
        let plan = material("abcdefghijklmnopqrst", "applied");
        let mut outcome = claim(&install, plan.clone())
            .unwrap()
            .begin_outcome_unknown_for_test()
            .unwrap();
        let before = fs::read(journal_file(&temp)).unwrap();
        assert_eq!(
            error_of(outcome.issue_installed_observation_for_test(observation(
                &plan,
                CasLedgerInstallObservedStateV1::Absent,
                CasLedgerInstallObservedMarkerStateV1::Absent,
            )),),
            BackendCasLedgerInstallErrorV1::InstalledProofRejected
        );
        assert_eq!(
            error_of(outcome.issue_installed_observation_for_test(observation(
                &plan,
                CasLedgerInstallObservedStateV1::Mismatch,
                CasLedgerInstallObservedMarkerStateV1::Mismatch,
            )),),
            BackendCasLedgerInstallErrorV1::InstalledProofRejected
        );
        assert_eq!(fs::read(journal_file(&temp)).unwrap(), before);

        let stale = outcome
            .issue_installed_observation_for_test(observation(
                &plan,
                CasLedgerInstallObservedStateV1::Installed,
                CasLedgerInstallObservedMarkerStateV1::ExactSingle,
            ))
            .unwrap();
        outcome.rotate_verification_epoch_for_test();
        assert_eq!(
            error_of(outcome.settle_installed_for_test(stale)),
            BackendCasLedgerInstallErrorV1::InstalledProofRejected
        );
        assert_eq!(fs::read(journal_file(&temp)).unwrap(), before);

        let current = outcome
            .issue_installed_observation_for_test(observation(
                &plan,
                CasLedgerInstallObservedStateV1::Installed,
                CasLedgerInstallObservedMarkerStateV1::ExactSingle,
            ))
            .unwrap();
        let applied = outcome.settle_installed_for_test(current).unwrap();
        assert!(applied.database_ledger_bound());
        assert!(!applied.mutation_authorized());
        assert!(!applied.execution_authorized());
        assert!(!applied.source_ledger_bound());
        assert!(!applied.receipt_issued());
        assert!(!applied.release_authorized());
        let after = fs::read(journal_file(&temp)).unwrap();
        assert_ne!(after, before);
        let persisted: serde_json::Value = serde_json::from_slice(&after).unwrap();
        let record = persisted["body"]["records"]
            .as_object()
            .unwrap()
            .values()
            .next()
            .unwrap();
        assert_eq!(record["state"], "applied");
        assert_eq!(
            record["finalEvidence"]["payload"]
                .as_str()
                .unwrap()
                .contains("\"databaseLedgerBound\":true"),
            true
        );
    }

    #[test]
    fn cross_plan_proofs_do_not_consume_the_genuine_outcome() {
        let temp = TempDir::new().unwrap();
        let journal = journal(
            &temp,
            Arc::new(ManualClockV1::new()),
            Arc::new(ConfirmedDirectorySyncV1),
        );
        let install = BackendCasLedgerInstallV1::new(journal);
        let plan_a = material("abcdefghijklmnopqrst", "plan-a");
        let plan_b = material("bcdefghijklmnopqrstu", "plan-b");
        let mut outcome_a = claim(&install, plan_a.clone())
            .unwrap()
            .begin_outcome_unknown_for_test()
            .unwrap();
        let outcome_b = claim(&install, plan_b.clone())
            .unwrap()
            .begin_outcome_unknown_for_test()
            .unwrap();
        let proof_b = outcome_b
            .issue_installed_observation_for_test(observation(
                &plan_b,
                CasLedgerInstallObservedStateV1::Installed,
                CasLedgerInstallObservedMarkerStateV1::ExactSingle,
            ))
            .unwrap();
        assert_eq!(
            error_of(outcome_a.settle_installed_for_test(proof_b)),
            BackendCasLedgerInstallErrorV1::InstalledProofRejected
        );
        let proof_a = outcome_a
            .issue_installed_observation_for_test(observation(
                &plan_a,
                CasLedgerInstallObservedStateV1::Installed,
                CasLedgerInstallObservedMarkerStateV1::ExactSingle,
            ))
            .unwrap();
        assert!(outcome_a
            .settle_installed_for_test(proof_a)
            .unwrap()
            .database_ledger_bound());
    }

    #[test]
    fn source_has_no_command_transport_credentials_sql_execution_or_real_issuer() {
        let source = include_str!("backend_cas_ledger_install.rs");
        for forbidden in [
            concat!("#[tauri", "::command]"),
            concat!("reqwest", "::"),
            concat!("Credential", "Resolver"),
            concat!("FixedReadDatabase", "Session"),
            concat!("runReadOnlyDatabase", "CASLedgerVerificationQuery"),
            concat!("CREATE ", "TABLE"),
            concat!("ALTER ", "TABLE"),
            concat!("production", "_roots"),
            concat!("production", "_issuer"),
        ] {
            assert!(!source.contains(forbidden), "forbidden source: {forbidden}");
        }
        assert!(source.contains("#[cfg(test)]\n    pub(crate) fn issue_for_test"));
        assert!(!source.contains(concat!(
            "impl Clone for SealedCasLedgerInstall",
            "ReviewProofV1"
        )));
        assert!(!source.contains(concat!(
            "impl std::fmt::Debug for SealedCasLedgerInstall",
            "ReviewProofV1"
        )));
    }
}
