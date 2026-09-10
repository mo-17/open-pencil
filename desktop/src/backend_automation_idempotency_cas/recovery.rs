//! Dormant native recovery admission for an Automation idempotency CAS outcome whose COMMIT may
//! have succeeded.
//!
//! This module owns only secret-free intent material and opaque journal capabilities. Production
//! code cannot issue the sealed review proof. The testing path can establish and consume one
//! durable read-attempt lease, but it cannot settle the journal, retry the mutation, issue a
//! Receipt, or create release authority. An unauthenticated reconciliation result is deliberately
//! not accepted by any API in this module.

#![allow(dead_code)]

use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine as _,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::{Arc, Weak};

use super::{
    precommit::rendered_sql_digest_for_recovery,
    reconciliation::{PARAMETER_SCHEMA_DIGEST, RECONCILIATION_QUERY_DIGEST},
};

#[cfg(test)]
use crate::backend_operation_journal::{
    AutomationCasJournalOutcomeUnknownV1, AutomationCasJournalReadAttemptV1,
    AutomationCasJournalReconciliationPermitV1, AutomationCasJournalRecoveryV1,
};
use crate::{
    backend_operation_journal::{
        AutomationCasJournalClaimV1, BackendOperationJournalV1, JournalError,
    },
    supabase_backfill_fixed_read::contains_secret_like_material,
};

pub(crate) const AUTOMATION_CAS_RECOVERY_PLAN_FORMAT: &str =
    "openpencil.native-supabase-automation-idempotency-cas-recovery-plan.v1";
pub(crate) const AUTOMATION_CAS_RECOVERY_PROGRESS_FORMAT: &str =
    "openpencil.native-supabase-automation-idempotency-cas-outcome-unknown.v1";

const PROPOSAL_FORMAT: &str = "openpencil.backend-automation-idempotency-cas-proposal";
const RECORD_FORMAT: &str = "openpencil.backend-automation-idempotency-record";
const MAXIMUM_REVISION: i64 = 1_024;
const MAXIMUM_ATTEMPTS: usize = 20;
const MAXIMUM_CAUSATION_HOP: i32 = 16;
const MAXIMUM_RETENTION_HOURS: i32 = 2_160;
// The durable journal bounds every evidence string to 2,048 bytes. Standard Base64 expands 1,536
// bytes to exactly that limit, so a reviewed document can never become unpersistable after claim.
const MAXIMUM_CANONICAL_DOCUMENT_BYTES: usize = 1_536;
const RECONCILIATION_SCHEMA_SENTINEL: &str = "__OPENPENCIL_AUTOMATION_IDEMPOTENCY_SCHEMA__";
const RECONCILIATION_SQL_TEMPLATE: &str = include_str!(
    "../../../src/app/plugins/host/deployment/supabase/automation/idempotency/cas/reconciliation/v1.sql"
);
const PARAMETER_ORDER: [&str; 27] = [
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

/// The exact 27-value CAS parameter vector in a durable, secret-free representation.
#[derive(Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AutomationCasParameterSnapshotV1 {
    pub(crate) proposal_digest: String,
    pub(crate) canonical_proposal_base64: String,
    pub(crate) record_digest: String,
    pub(crate) canonical_record_base64: String,
    pub(crate) automation_id: String,
    pub(crate) event_id: String,
    pub(crate) operation_id: String,
    pub(crate) idempotency_key_digest: String,
    pub(crate) causation_id: String,
    pub(crate) causation_hop: i32,
    pub(crate) retention_hours: i32,
    pub(crate) created_at: String,
    pub(crate) expires_at: String,
    pub(crate) recorded_at: String,
    pub(crate) next_revision: i64,
    pub(crate) expected_revision: Option<i64>,
    pub(crate) expected_head_digest: Option<String>,
    pub(crate) previous_record_digest: Option<String>,
    pub(crate) attempt_ids: Vec<String>,
    pub(crate) current_attempt_id: String,
    pub(crate) state: String,
    pub(crate) completion_evidence_digest: Option<String>,
    pub(crate) known_not_dispatched_evidence_digest: Option<String>,
    pub(crate) reconciliation_evidence_digest: Option<String>,
    pub(crate) host_evidence_authenticated: bool,
    pub(crate) persistence_authority_granted: bool,
    pub(crate) dispatch_authority_granted: bool,
}

/// Complete secret-free identity retained by the durable journal. It intentionally includes the
/// parameter bytes rather than asking a renderer to reproduce them after restart.
#[derive(Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AutomationCasRecoveryMaterialV1 {
    pub(crate) provider_id: String,
    pub(crate) environment: String,
    pub(crate) project_ref: String,
    pub(crate) account_id: String,
    pub(crate) application_object_key: String,
    pub(crate) schema_name: String,
    pub(crate) write_grant_generation: String,
    pub(crate) read_grant_generation: String,
    pub(crate) write_credential_incarnation_digest: String,
    pub(crate) read_credential_incarnation_digest: String,
    pub(crate) connection_profile_digest: String,
    pub(crate) installation_incarnation_digest: String,
    pub(crate) cas_review_digest: String,
    pub(crate) cas_sql_digest: String,
    pub(crate) reconciliation_review_digest: String,
    pub(crate) reconciliation_sql_template_digest: String,
    pub(crate) reconciliation_sql_digest: String,
    pub(crate) reconciliation_query_digest: String,
    pub(crate) parameter_schema_digest: String,
    pub(crate) parameter_values_digest: String,
    pub(crate) schema_marker_digest: String,
    pub(crate) parameters: AutomationCasParameterSnapshotV1,
}

/// Opaque proof of the complete immutable review. There is no production issuer.
pub(crate) struct SealedAutomationCasRecoveryReviewProofV1 {
    material: AutomationCasRecoveryMaterialV1,
}

impl SealedAutomationCasRecoveryReviewProofV1 {
    pub(crate) fn into_claim_material(self) -> AutomationCasRecoveryMaterialV1 {
        self.material
    }

    #[cfg(test)]
    pub(crate) fn issue_for_test(
        material: AutomationCasRecoveryMaterialV1,
    ) -> Result<Self, AutomationCasRecoveryErrorV1> {
        validate_automation_cas_recovery_material(&material)?;
        Ok(Self { material })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AutomationCasRecoveryErrorV1 {
    ReviewRejected,
    ReplayBlocked,
    ScopeConflict,
    CapacityExceeded,
    DurabilityUnconfirmed,
    HandleExpired,
    LeaseActive,
    Unavailable,
}

pub(crate) struct AutomationCasRecoveryCoordinatorV1 {
    journal: Arc<BackendOperationJournalV1>,
}

impl AutomationCasRecoveryCoordinatorV1 {
    pub(crate) fn new(journal: Arc<BackendOperationJournalV1>) -> Self {
        Self { journal }
    }

    pub(crate) fn claim(
        &self,
        proof: SealedAutomationCasRecoveryReviewProofV1,
    ) -> Result<DurableAutomationCasClaimV1, AutomationCasRecoveryErrorV1> {
        let claim = self
            .journal
            .claim_automation_cas(proof)
            .map_err(map_claim_journal_error)?;
        Ok(DurableAutomationCasClaimV1 {
            journal: Arc::downgrade(&self.journal),
            claim: Some(claim),
        })
    }

    #[cfg(test)]
    pub(crate) fn recover_for_test(
        &self,
        single_flight_key: &str,
    ) -> Result<DurableAutomationCasRecoveryV1, AutomationCasRecoveryErrorV1> {
        let recovery = self
            .journal
            .reconstruct_automation_cas_for_test(single_flight_key)
            .map_err(map_journal_error)?;
        Ok(DurableAutomationCasRecoveryV1 {
            journal: Arc::downgrade(&self.journal),
            recovery: Some(recovery),
        })
    }
}

/// Opaque handle for a confirmed durable Claimed fence. Dropping it never removes that fence.
pub(crate) struct DurableAutomationCasClaimV1 {
    journal: Weak<BackendOperationJournalV1>,
    claim: Option<AutomationCasJournalClaimV1>,
}

impl DurableAutomationCasClaimV1 {
    pub(crate) const fn durably_claimed(&self) -> bool {
        true
    }

    pub(crate) const fn automatic_retry_allowed(&self) -> bool {
        false
    }

    pub(crate) const fn mutation_authorized(&self) -> bool {
        false
    }

    pub(crate) const fn release_authorized(&self) -> bool {
        false
    }

    #[cfg(test)]
    pub(crate) fn precommit_outcome_unknown_for_test(
        mut self,
    ) -> Result<DurableAutomationCasOutcomeUnknownV1, AutomationCasRecoveryErrorV1> {
        let journal = self
            .journal
            .upgrade()
            .ok_or(AutomationCasRecoveryErrorV1::Unavailable)?;
        let claim = self
            .claim
            .take()
            .ok_or(AutomationCasRecoveryErrorV1::Unavailable)?;
        let outcome = journal
            .precommit_automation_cas_for_test(claim)
            .map_err(map_journal_error)?;
        Ok(DurableAutomationCasOutcomeUnknownV1 {
            journal: Arc::downgrade(&journal),
            outcome,
        })
    }
}

/// Same-process observation that the durable record is fenced as OutcomeUnknown. It is not proof
/// that a database request ran or that a COMMIT succeeded.
#[cfg(test)]
pub(crate) struct DurableAutomationCasOutcomeUnknownV1 {
    journal: Weak<BackendOperationJournalV1>,
    outcome: AutomationCasJournalOutcomeUnknownV1,
}

#[cfg(test)]
impl DurableAutomationCasOutcomeUnknownV1 {
    pub(crate) fn single_flight_key_for_test(&self) -> &str {
        self.outcome.single_flight_key_for_test()
    }

    pub(crate) fn belongs_to_journal_for_test(
        &self,
        journal: &Arc<BackendOperationJournalV1>,
    ) -> bool {
        self.journal
            .upgrade()
            .is_some_and(|bound| Arc::ptr_eq(&bound, journal))
    }

    pub(crate) const fn commit_outcome_resolved(&self) -> bool {
        false
    }

    pub(crate) const fn database_cas_committed(&self) -> bool {
        false
    }

    pub(crate) const fn capture_consumed(&self) -> bool {
        false
    }

    pub(crate) const fn automatic_retry_allowed(&self) -> bool {
        false
    }
}

#[cfg(test)]
pub(crate) struct DurableAutomationCasRecoveryV1 {
    journal: Weak<BackendOperationJournalV1>,
    recovery: Option<AutomationCasJournalRecoveryV1>,
}

#[cfg(test)]
impl DurableAutomationCasRecoveryV1 {
    pub(crate) fn begin_for_test(
        mut self,
    ) -> Result<DurableAutomationCasReconciliationPermitV1, AutomationCasRecoveryErrorV1> {
        let journal = self
            .journal
            .upgrade()
            .ok_or(AutomationCasRecoveryErrorV1::Unavailable)?;
        let recovery = self
            .recovery
            .take()
            .ok_or(AutomationCasRecoveryErrorV1::Unavailable)?;
        let permit = journal
            .begin_automation_cas_reconciliation_for_test(recovery)
            .map_err(map_journal_error)?;
        Ok(DurableAutomationCasReconciliationPermitV1 {
            journal: Arc::downgrade(&journal),
            permit: Some(permit),
        })
    }
}

#[cfg(test)]
pub(crate) struct DurableAutomationCasReconciliationPermitV1 {
    journal: Weak<BackendOperationJournalV1>,
    permit: Option<AutomationCasJournalReconciliationPermitV1>,
}

#[cfg(test)]
impl DurableAutomationCasReconciliationPermitV1 {
    pub(crate) fn consume_for_fixed_read_for_test(
        mut self,
    ) -> Result<DurableAutomationCasReadAttemptV1, AutomationCasRecoveryErrorV1> {
        let journal = self
            .journal
            .upgrade()
            .ok_or(AutomationCasRecoveryErrorV1::Unavailable)?;
        let permit = self
            .permit
            .take()
            .ok_or(AutomationCasRecoveryErrorV1::Unavailable)?;
        let attempt = journal
            .consume_automation_cas_reconciliation_for_test(permit)
            .map_err(map_journal_error)?;
        Ok(DurableAutomationCasReadAttemptV1 {
            journal: Arc::downgrade(&journal),
            attempt,
        })
    }
}

/// One consumed durable read lease. No API can turn this handle or a raw reconciliation status into
/// terminal journal settlement in this slice.
#[cfg(test)]
pub(crate) struct DurableAutomationCasReadAttemptV1 {
    journal: Weak<BackendOperationJournalV1>,
    attempt: AutomationCasJournalReadAttemptV1,
}

#[cfg(test)]
impl DurableAutomationCasReadAttemptV1 {
    pub(crate) fn material_for_fixed_read_for_test(&self) -> &AutomationCasRecoveryMaterialV1 {
        self.attempt.material_for_composition()
    }

    pub(crate) fn belongs_to_journal_for_test(
        &self,
        journal: &Arc<BackendOperationJournalV1>,
    ) -> bool {
        self.journal
            .upgrade()
            .is_some_and(|bound| Arc::ptr_eq(&bound, journal))
    }

    pub(crate) const fn testing_only(&self) -> bool {
        true
    }

    pub(crate) const fn specific_installation_authenticated(&self) -> bool {
        false
    }

    pub(crate) const fn production_transport_authenticated(&self) -> bool {
        false
    }

    pub(crate) const fn read_only_reconciliation_completed(&self) -> bool {
        false
    }

    pub(crate) const fn operation_authority_authenticated(&self) -> bool {
        false
    }

    pub(crate) const fn credential_authority_created(&self) -> bool {
        false
    }

    pub(crate) const fn transport_authority_created(&self) -> bool {
        false
    }

    pub(crate) const fn database_authority_created(&self) -> bool {
        false
    }

    pub(crate) const fn reconciliation_result_authenticated(&self) -> bool {
        false
    }

    pub(crate) const fn commit_outcome_resolved(&self) -> bool {
        false
    }

    pub(crate) const fn automatic_retry_allowed(&self) -> bool {
        false
    }

    pub(crate) const fn mutation_authorized(&self) -> bool {
        false
    }

    pub(crate) const fn execution_authority_created(&self) -> bool {
        false
    }

    pub(crate) const fn persistence_authority_granted(&self) -> bool {
        false
    }

    pub(crate) const fn dispatch_authority_granted(&self) -> bool {
        false
    }

    pub(crate) const fn receipt_authority_created(&self) -> bool {
        false
    }

    pub(crate) const fn receipt_v2_issued(&self) -> bool {
        false
    }

    pub(crate) const fn release_authority_created(&self) -> bool {
        false
    }

    pub(crate) const fn release_authorized(&self) -> bool {
        false
    }

    pub(crate) const fn release_ready(&self) -> bool {
        false
    }
}

pub(crate) fn validate_automation_cas_recovery_material(
    material: &AutomationCasRecoveryMaterialV1,
) -> Result<(), AutomationCasRecoveryErrorV1> {
    if material.provider_id != "supabase"
        || material.environment != "staging"
        || !valid_project_ref(&material.project_ref)
        || !valid_identifier(&material.account_id)
        || !valid_application_object_key(&material.application_object_key)
        || material.schema_name != format!("op_automation_{}", material.application_object_key)
        || material.schema_marker_digest
            != digest_base64url(
                format!(
                    "openpencil.supabase-automation-idempotency-ledger.v1;application={};object=schema",
                    material.application_object_key
                )
                .as_bytes(),
            )
        || material.reconciliation_sql_template_digest
            != digest_base64url(RECONCILIATION_SQL_TEMPLATE.as_bytes())
        || material.reconciliation_sql_digest
            != digest_base64url(
                RECONCILIATION_SQL_TEMPLATE
                    .replace(RECONCILIATION_SCHEMA_SENTINEL, &material.schema_name)
                    .as_bytes(),
            )
        || rendered_sql_digest_for_recovery(&material.application_object_key).as_deref()
            != Some(material.cas_sql_digest.as_str())
        || material.parameter_schema_digest != PARAMETER_SCHEMA_DIGEST
        || material.reconciliation_query_digest != RECONCILIATION_QUERY_DIGEST
        || !valid_uuid_v4(&material.write_grant_generation)
        || !valid_uuid_v4(&material.read_grant_generation)
        || material.write_grant_generation == material.read_grant_generation
    {
        return Err(AutomationCasRecoveryErrorV1::ReviewRejected);
    }
    for digest in [
        &material.write_credential_incarnation_digest,
        &material.read_credential_incarnation_digest,
        &material.connection_profile_digest,
        &material.installation_incarnation_digest,
        &material.cas_review_digest,
        &material.cas_sql_digest,
        &material.reconciliation_review_digest,
        &material.reconciliation_sql_template_digest,
        &material.reconciliation_sql_digest,
        &material.reconciliation_query_digest,
        &material.parameter_schema_digest,
        &material.parameter_values_digest,
        &material.schema_marker_digest,
    ] {
        if !valid_digest(digest) {
            return Err(AutomationCasRecoveryErrorV1::ReviewRejected);
        }
    }
    validate_parameter_snapshot(&material.parameters)?;
    if expected_parameter_values_digest(&material.parameters)? != material.parameter_values_digest {
        return Err(AutomationCasRecoveryErrorV1::ReviewRejected);
    }
    Ok(())
}

fn validate_parameter_snapshot(
    snapshot: &AutomationCasParameterSnapshotV1,
) -> Result<(), AutomationCasRecoveryErrorV1> {
    let (proposal, proposal_bytes): (CanonicalProposalV1, Vec<u8>) =
        decode_canonical(&snapshot.canonical_proposal_base64)?;
    let (record, record_bytes): (CanonicalRecordV1, Vec<u8>) =
        decode_canonical(&snapshot.canonical_record_base64)?;
    let timestamps = (
        timestamp_millis(&record.created_at),
        timestamp_millis(&record.expires_at),
        timestamp_millis(&record.recorded_at),
    );
    let evidence_valid = match record.state.as_str() {
        "reserved" | "dispatch-started" | "outcome-unknown" => {
            record.completion_evidence_digest.is_none()
                && record.known_not_dispatched_evidence_digest.is_none()
                && record.reconciliation_evidence_digest.is_none()
        }
        "succeeded" => {
            record.completion_evidence_digest.is_some()
                && record.known_not_dispatched_evidence_digest.is_none()
        }
        "known-not-dispatched" => {
            record.completion_evidence_digest.is_none()
                && record.known_not_dispatched_evidence_digest.is_some()
        }
        _ => false,
    };
    let timestamp_relation_valid = matches!(timestamps, (Some(created), Some(expires), Some(recorded))
        if expires == created + i64::from(record.retention_hours) * 3_600_000
            && recorded >= created
            && (record.revision != 0
                || (record.state == "reserved"
                    && record.attempt_ids.len() == 1
                    && recorded == created)));
    if digest_base64url(&proposal_bytes) != snapshot.proposal_digest
        || digest_base64url(&record_bytes) != snapshot.record_digest
        || proposal.format != PROPOSAL_FORMAT
        || proposal.version != 1
        || record.format != RECORD_FORMAT
        || record.version != 1
        || !valid_identifier(&proposal.automation_id)
        || !valid_identifier(&proposal.event_id)
        || !valid_identifier(&proposal.operation_id)
        || !valid_identifier(&record.causation_id)
        || !valid_digest(&proposal.idempotency_key_digest)
        || !valid_digest(&proposal.next_record_digest)
        || proposal
            .expected_head_digest
            .as_deref()
            .is_some_and(|value| !valid_digest(value))
        || proposal.expected_revision.is_none() != proposal.expected_head_digest.is_none()
        || proposal
            .expected_revision
            .is_some_and(|value| !(0..MAXIMUM_REVISION).contains(&value))
        || proposal.next_revision != proposal.expected_revision.map_or(0, |value| value + 1)
        || proposal.next_record_digest != snapshot.record_digest
        || proposal.automation_id != record.automation_id
        || proposal.event_id != record.event_id
        || proposal.operation_id != record.operation_id
        || proposal.idempotency_key_digest != record.idempotency_key_digest
        || proposal.next_revision != record.revision
        || proposal.expected_head_digest != record.previous_record_digest
        || !(0..=MAXIMUM_REVISION).contains(&record.revision)
        || (record.revision == 0) != record.previous_record_digest.is_none()
        || record
            .previous_record_digest
            .as_deref()
            .is_some_and(|value| !valid_digest(value))
        || !(0..=MAXIMUM_CAUSATION_HOP).contains(&record.causation_hop)
        || !(1..=MAXIMUM_RETENTION_HOURS).contains(&record.retention_hours)
        || !(1..=MAXIMUM_ATTEMPTS).contains(&record.attempt_ids.len())
        || record
            .attempt_ids
            .iter()
            .any(|value| !valid_identifier(value))
        || has_duplicate_strings(&record.attempt_ids)
        || record.attempt_ids.len() > usize::try_from(record.revision + 1).unwrap_or(0)
        || record.attempt_ids.last() != Some(&record.current_attempt_id)
        || !evidence_valid
        || !timestamp_relation_valid
        || proposal.host_evidence_authenticated
        || proposal.persistence_authority_granted
        || proposal.dispatch_authority_granted
        || record.host_evidence_authenticated
        || record.persistence_authority_granted
        || record.dispatch_authority_granted
        || snapshot.proposal_digest != digest_base64url(&proposal_bytes)
        || snapshot.record_digest != digest_base64url(&record_bytes)
        || snapshot.automation_id != record.automation_id
        || snapshot.event_id != record.event_id
        || snapshot.operation_id != record.operation_id
        || snapshot.idempotency_key_digest != record.idempotency_key_digest
        || snapshot.causation_id != record.causation_id
        || snapshot.causation_hop != record.causation_hop
        || snapshot.retention_hours != record.retention_hours
        || snapshot.created_at != record.created_at
        || snapshot.expires_at != record.expires_at
        || snapshot.recorded_at != record.recorded_at
        || snapshot.next_revision != record.revision
        || snapshot.expected_revision != proposal.expected_revision
        || snapshot.expected_head_digest != proposal.expected_head_digest
        || snapshot.previous_record_digest != record.previous_record_digest
        || snapshot.attempt_ids != record.attempt_ids
        || snapshot.current_attempt_id != record.current_attempt_id
        || snapshot.state != record.state
        || snapshot.completion_evidence_digest != record.completion_evidence_digest
        || snapshot.known_not_dispatched_evidence_digest
            != record.known_not_dispatched_evidence_digest
        || snapshot.reconciliation_evidence_digest != record.reconciliation_evidence_digest
        || snapshot.host_evidence_authenticated
        || snapshot.persistence_authority_granted
        || snapshot.dispatch_authority_granted
    {
        return Err(AutomationCasRecoveryErrorV1::ReviewRejected);
    }
    for digest in [
        snapshot.expected_head_digest.as_deref(),
        snapshot.previous_record_digest.as_deref(),
        snapshot.completion_evidence_digest.as_deref(),
        snapshot.known_not_dispatched_evidence_digest.as_deref(),
        snapshot.reconciliation_evidence_digest.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        if !valid_digest(digest) {
            return Err(AutomationCasRecoveryErrorV1::ReviewRejected);
        }
    }
    Ok(())
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct CanonicalProposalV1 {
    #[serde(rename = "automationId")]
    automation_id: String,
    #[serde(rename = "dispatchAuthorityGranted")]
    dispatch_authority_granted: bool,
    #[serde(rename = "eventId")]
    event_id: String,
    #[serde(rename = "expectedHeadDigest")]
    expected_head_digest: Option<String>,
    #[serde(rename = "expectedRevision")]
    expected_revision: Option<i64>,
    format: String,
    #[serde(rename = "hostEvidenceAuthenticated")]
    host_evidence_authenticated: bool,
    #[serde(rename = "idempotencyKeyDigest")]
    idempotency_key_digest: String,
    #[serde(rename = "nextRecordDigest")]
    next_record_digest: String,
    #[serde(rename = "nextRevision")]
    next_revision: i64,
    #[serde(rename = "operationId")]
    operation_id: String,
    #[serde(rename = "persistenceAuthorityGranted")]
    persistence_authority_granted: bool,
    version: u8,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct CanonicalRecordV1 {
    #[serde(rename = "attemptIds")]
    attempt_ids: Vec<String>,
    #[serde(rename = "automationId")]
    automation_id: String,
    #[serde(rename = "causationHop")]
    causation_hop: i32,
    #[serde(rename = "causationId")]
    causation_id: String,
    #[serde(rename = "completionEvidenceDigest")]
    completion_evidence_digest: Option<String>,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "currentAttemptId")]
    current_attempt_id: String,
    #[serde(rename = "dispatchAuthorityGranted")]
    dispatch_authority_granted: bool,
    #[serde(rename = "eventId")]
    event_id: String,
    #[serde(rename = "expiresAt")]
    expires_at: String,
    format: String,
    #[serde(rename = "hostEvidenceAuthenticated")]
    host_evidence_authenticated: bool,
    #[serde(rename = "idempotencyKeyDigest")]
    idempotency_key_digest: String,
    #[serde(rename = "knownNotDispatchedEvidenceDigest")]
    known_not_dispatched_evidence_digest: Option<String>,
    #[serde(rename = "operationId")]
    operation_id: String,
    #[serde(rename = "persistenceAuthorityGranted")]
    persistence_authority_granted: bool,
    #[serde(rename = "previousRecordDigest")]
    previous_record_digest: Option<String>,
    #[serde(rename = "reconciliationEvidenceDigest")]
    reconciliation_evidence_digest: Option<String>,
    #[serde(rename = "recordedAt")]
    recorded_at: String,
    #[serde(rename = "retentionHours")]
    retention_hours: i32,
    revision: i64,
    state: String,
    version: u8,
}

fn decode_canonical<T>(encoded: &str) -> Result<(T, Vec<u8>), AutomationCasRecoveryErrorV1>
where
    T: DeserializeOwned + Serialize,
{
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| AutomationCasRecoveryErrorV1::ReviewRejected)?;
    if !(2..=MAXIMUM_CANONICAL_DOCUMENT_BYTES).contains(&bytes.len())
        || STANDARD.encode(&bytes) != encoded
    {
        return Err(AutomationCasRecoveryErrorV1::ReviewRejected);
    }
    let value: T =
        serde_json::from_slice(&bytes).map_err(|_| AutomationCasRecoveryErrorV1::ReviewRejected)?;
    if serde_json::to_vec(&value).map_err(|_| AutomationCasRecoveryErrorV1::ReviewRejected)?
        != bytes
    {
        return Err(AutomationCasRecoveryErrorV1::ReviewRejected);
    }
    Ok((value, bytes))
}

fn valid_digest(value: &str) -> bool {
    value.len() == 43
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        && URL_SAFE_NO_PAD
            .decode(value)
            .is_ok_and(|bytes| bytes.len() == 32 && URL_SAFE_NO_PAD.encode(bytes) == value)
}

fn digest_base64url(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(bytes))
}

fn expected_parameter_values_digest(
    snapshot: &AutomationCasParameterSnapshotV1,
) -> Result<String, AutomationCasRecoveryErrorV1> {
    let manifest = serde_json::json!({
        "format": "openpencil.supabase-automation-idempotency-cas-parameters.v1",
        "version": 1,
        "order": PARAMETER_ORDER,
        "values": [
            &snapshot.proposal_digest,
            &snapshot.canonical_proposal_base64,
            &snapshot.record_digest,
            &snapshot.canonical_record_base64,
            &snapshot.automation_id,
            &snapshot.event_id,
            &snapshot.operation_id,
            &snapshot.idempotency_key_digest,
            &snapshot.causation_id,
            snapshot.causation_hop,
            snapshot.retention_hours,
            &snapshot.created_at,
            &snapshot.expires_at,
            &snapshot.recorded_at,
            snapshot.next_revision,
            snapshot.expected_revision,
            &snapshot.expected_head_digest,
            &snapshot.previous_record_digest,
            &snapshot.attempt_ids,
            &snapshot.current_attempt_id,
            &snapshot.state,
            &snapshot.completion_evidence_digest,
            &snapshot.known_not_dispatched_evidence_digest,
            &snapshot.reconciliation_evidence_digest,
            snapshot.host_evidence_authenticated,
            snapshot.persistence_authority_granted,
            snapshot.dispatch_authority_granted,
        ]
    });
    let mut canonical = String::new();
    write_canonical_json(&manifest, &mut canonical)?;
    Ok(digest_base64url(canonical.as_bytes()))
}

fn write_canonical_json(
    value: &serde_json::Value,
    output: &mut String,
) -> Result<(), AutomationCasRecoveryErrorV1> {
    match value {
        serde_json::Value::Null => output.push_str("null"),
        serde_json::Value::Bool(value) => output.push_str(if *value { "true" } else { "false" }),
        serde_json::Value::Number(value) => output.push_str(&value.to_string()),
        serde_json::Value::String(value) => output.push_str(
            &serde_json::to_string(value)
                .map_err(|_| AutomationCasRecoveryErrorV1::ReviewRejected)?,
        ),
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
                output.push_str(
                    &serde_json::to_string(key)
                        .map_err(|_| AutomationCasRecoveryErrorV1::ReviewRejected)?,
                );
                output.push(':');
                write_canonical_json(value, output)?;
            }
            output.push('}');
        }
    }
    Ok(())
}

fn valid_identifier(value: &str) -> bool {
    let mut bytes = value.bytes();
    bytes
        .next()
        .is_some_and(|byte| byte.is_ascii_alphanumeric())
        && value.len() <= 256
        && bytes.all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'/' | b'@' | b'-')
        })
        && !contains_secret_like_material(value)
}

fn valid_project_ref(value: &str) -> bool {
    value.len() == 20
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
}

fn valid_application_object_key(value: &str) -> bool {
    value.len() == 20
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'_' | b'-')
        })
        && !contains_secret_like_material(value)
}

fn valid_uuid_v4(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => *byte == b'-',
            14 => *byte == b'4',
            19 => matches!(*byte, b'8' | b'9' | b'a' | b'b'),
            _ => byte.is_ascii_digit() || matches!(*byte, b'a'..=b'f'),
        })
}

fn has_duplicate_strings(values: &[String]) -> bool {
    values
        .iter()
        .enumerate()
        .any(|(index, value)| values[..index].contains(value))
}

fn timestamp_millis(value: &str) -> Option<i64> {
    let bytes = value.as_bytes();
    if bytes.len() != 24
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
        || bytes[19] != b'.'
        || bytes[23] != b'Z'
    {
        return None;
    }
    let number = |start: usize, end: usize| -> Option<i64> {
        bytes
            .get(start..end)?
            .iter()
            .try_fold(0_i64, |value, byte| {
                byte.is_ascii_digit()
                    .then_some(value * 10 + i64::from(byte - b'0'))
            })
    };
    let year = number(0, 4)?;
    let month = number(5, 7)?;
    let day = number(8, 10)?;
    let hour = number(11, 13)?;
    let minute = number(14, 16)?;
    let second = number(17, 19)?;
    let millis = number(20, 23)?;
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let maximum_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return None,
    };
    if year == 0 || !(1..=maximum_day).contains(&day) || hour > 23 || minute > 59 || second > 59 {
        return None;
    }
    let adjusted_year = year - i64::from(month <= 2);
    let era = adjusted_year.div_euclid(400);
    let year_of_era = adjusted_year - era * 400;
    let adjusted_month = month + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * adjusted_month + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    let days_since_epoch = era * 146_097 + day_of_era - 719_468;
    Some(
        days_since_epoch * 86_400_000
            + hour * 3_600_000
            + minute * 60_000
            + second * 1_000
            + millis,
    )
}

fn map_journal_error(error: JournalError) -> AutomationCasRecoveryErrorV1 {
    match error {
        JournalError::Conflict | JournalError::CapabilityMissing | JournalError::InvalidState => {
            AutomationCasRecoveryErrorV1::ReplayBlocked
        }
        JournalError::ScopeConflict => AutomationCasRecoveryErrorV1::ScopeConflict,
        JournalError::Full => AutomationCasRecoveryErrorV1::CapacityExceeded,
        JournalError::DurabilityUnconfirmed => AutomationCasRecoveryErrorV1::DurabilityUnconfirmed,
        JournalError::CapabilityExpired => AutomationCasRecoveryErrorV1::HandleExpired,
        JournalError::LeaseActive => AutomationCasRecoveryErrorV1::LeaseActive,
        JournalError::Unavailable | JournalError::Invalid | JournalError::Corrupt => {
            AutomationCasRecoveryErrorV1::Unavailable
        }
    }
}

fn map_claim_journal_error(error: JournalError) -> AutomationCasRecoveryErrorV1 {
    if error == JournalError::Invalid {
        AutomationCasRecoveryErrorV1::ReviewRejected
    } else {
        map_journal_error(error)
    }
}

#[cfg(test)]
mod source_tests;
#[cfg(test)]
mod tests;
#[cfg(test)]
pub(crate) use tests::material as recovery_material_for_composition_test;
