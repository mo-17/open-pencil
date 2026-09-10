//! Testing-only fused handoff from one durable recovery capability into the fixed read runner.
//!
//! Calling this async function creates no journal lease. Its first poll consumes the recovery,
//! durably marks one read attempt consumed, reconstructs the runner contract exclusively from the
//! journal-owned immutable material, and immediately polls the runner. The opaque attempt remains
//! owned by the future until the runner returns or the future is dropped. No capability is returned.

use super::runner::{
    AutomationReconciliationContractV1, BoundParameterV1, BoundParameterValueV1, DatabaseSessionV1,
    ExecutionControlV1, InterruptSourceV1, ReconciliationErrorV1, ReconciliationResultV1,
    TestingReviewBindingInputV1, MAXIMUM_RESPONSE_BYTES, OVERALL_TIMEOUT,
};
use crate::{
    backend_automation_idempotency_cas::recovery::{
        validate_automation_cas_recovery_material, AutomationCasRecoveryErrorV1,
        AutomationCasRecoveryMaterialV1, DurableAutomationCasRecoveryV1,
    },
    backend_operation_journal::AUTOMATION_CAS_RECONCILIATION_LEASE_TTL,
};

const _: () =
    assert!(AUTOMATION_CAS_RECONCILIATION_LEASE_TTL.as_secs() > OVERALL_TIMEOUT.as_secs());

#[derive(Debug, PartialEq, Eq)]
pub(super) enum RecoveryCompositionErrorV1 {
    Recovery(AutomationCasRecoveryErrorV1),
    Reconciliation(ReconciliationErrorV1),
}

impl From<AutomationCasRecoveryErrorV1> for RecoveryCompositionErrorV1 {
    fn from(error: AutomationCasRecoveryErrorV1) -> Self {
        Self::Recovery(error)
    }
}

impl From<ReconciliationErrorV1> for RecoveryCompositionErrorV1 {
    fn from(error: ReconciliationErrorV1) -> Self {
        Self::Reconciliation(error)
    }
}

pub(super) async fn run_recovered_fixed_read_for_test<D: DatabaseSessionV1>(
    recovery: DurableAutomationCasRecoveryV1,
    database: D,
    interrupts: &dyn InterruptSourceV1,
) -> Result<ReconciliationResultV1, RecoveryCompositionErrorV1> {
    // An async fn does not execute until first poll. Keep this synchronous prefix free of await so
    // callers cannot retain a near-expiry permit or consumed attempt outside the fused operation.
    let permit = recovery.begin_for_test()?;
    let attempt = permit.consume_for_fixed_read_for_test()?;
    let contract = contract_from_journal_material(attempt.material_for_fixed_read_for_test())?;
    let execution = ExecutionControlV1::start_for_test(interrupts)?;

    let result = contract.run(database, &execution).await;
    drop(attempt);
    result.map_err(RecoveryCompositionErrorV1::Reconciliation)
}

fn contract_from_journal_material(
    material: &AutomationCasRecoveryMaterialV1,
) -> Result<AutomationReconciliationContractV1, RecoveryCompositionErrorV1> {
    validate_automation_cas_recovery_material(material)?;
    let parameters = bound_parameters(material);
    let review = TestingReviewBindingInputV1 {
        review_format: "openpencil.supabase-automation-idempotency-cas-reconciliation-review.v1"
            .to_owned(),
        review_digest: material.reconciliation_review_digest.clone(),
        cas_review_digest: material.cas_review_digest.clone(),
        query_id: "supabase-automation-idempotency-cas-reconciliation".to_owned(),
        query_version: "openpencil-supabase-automation-idempotency-cas-reconciliation-v1"
            .to_owned(),
        application_object_key: material.application_object_key.clone(),
        schema_name: material.schema_name.clone(),
        reconciliation_sql_template_digest: material.reconciliation_sql_template_digest.clone(),
        reconciliation_sql_digest: material.reconciliation_sql_digest.clone(),
        reconciliation_query_digest: material.reconciliation_query_digest.clone(),
        parameter_schema_digest: material.parameter_schema_digest.clone(),
        parameter_values_digest: material.parameter_values_digest.clone(),
        proposal_digest: material.parameters.proposal_digest.clone(),
        record_digest: material.parameters.record_digest.clone(),
        schema_marker_digest: material.schema_marker_digest.clone(),
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
    };
    AutomationReconciliationContractV1::issue_for_test(review, parameters).map_err(Into::into)
}

fn bound_parameters(material: &AutomationCasRecoveryMaterialV1) -> Vec<BoundParameterV1> {
    let values = &material.parameters;
    vec![
        parameter(1, "proposalDigest", text(&values.proposal_digest)),
        parameter(
            2,
            "canonicalProposalBase64",
            text(&values.canonical_proposal_base64),
        ),
        parameter(3, "recordDigest", text(&values.record_digest)),
        parameter(
            4,
            "canonicalRecordBase64",
            text(&values.canonical_record_base64),
        ),
        parameter(5, "automationId", text(&values.automation_id)),
        parameter(6, "eventId", text(&values.event_id)),
        parameter(7, "operationId", text(&values.operation_id)),
        parameter(
            8,
            "idempotencyKeyDigest",
            text(&values.idempotency_key_digest),
        ),
        parameter(9, "causationId", text(&values.causation_id)),
        parameter(
            10,
            "causationHop",
            BoundParameterValueV1::Int4(values.causation_hop),
        ),
        parameter(
            11,
            "retentionHours",
            BoundParameterValueV1::Int4(values.retention_hours),
        ),
        parameter(12, "createdAt", text(&values.created_at)),
        parameter(13, "expiresAt", text(&values.expires_at)),
        parameter(14, "recordedAt", text(&values.recorded_at)),
        parameter(
            15,
            "nextRevision",
            BoundParameterValueV1::Int8(Some(values.next_revision)),
        ),
        parameter(
            16,
            "expectedRevision",
            BoundParameterValueV1::Int8(values.expected_revision),
        ),
        parameter(
            17,
            "expectedHeadDigest",
            optional_text(&values.expected_head_digest),
        ),
        parameter(
            18,
            "previousRecordDigest",
            optional_text(&values.previous_record_digest),
        ),
        parameter(
            19,
            "attemptIds",
            BoundParameterValueV1::TextArray(values.attempt_ids.clone()),
        ),
        parameter(20, "currentAttemptId", text(&values.current_attempt_id)),
        parameter(21, "state", text(&values.state)),
        parameter(
            22,
            "completionEvidenceDigest",
            optional_text(&values.completion_evidence_digest),
        ),
        parameter(
            23,
            "knownNotDispatchedEvidenceDigest",
            optional_text(&values.known_not_dispatched_evidence_digest),
        ),
        parameter(
            24,
            "reconciliationEvidenceDigest",
            optional_text(&values.reconciliation_evidence_digest),
        ),
        parameter(
            25,
            "hostEvidenceAuthenticated",
            BoundParameterValueV1::Boolean(false),
        ),
        parameter(
            26,
            "persistenceAuthorityGranted",
            BoundParameterValueV1::Boolean(false),
        ),
        parameter(
            27,
            "dispatchAuthorityGranted",
            BoundParameterValueV1::Boolean(false),
        ),
    ]
}

fn parameter(position: u8, name: &'static str, value: BoundParameterValueV1) -> BoundParameterV1 {
    BoundParameterV1 {
        position,
        name,
        value,
    }
}

fn text(value: &str) -> BoundParameterValueV1 {
    BoundParameterValueV1::Text(Some(value.to_owned()))
}

fn optional_text(value: &Option<String>) -> BoundParameterValueV1 {
    BoundParameterValueV1::Text(value.clone())
}
