//! Testing-only composition of the inert Receipt-zero initializer prerequisite proof.

use std::sync::{Arc, Weak};

use super::{
    capture_initializer_precommit_clock_for_test, prepare_initializer_precommit_for_test,
    run_prepared_initializer_precommit_for_test, JournalBoundPrecommitDispositionV1,
    ReceiptZeroPrecommitTestConnectorV1, ReceiptZeroPrecommitTestInterruptsV1,
};
use crate::{
    backend_backfill_inspection_subject::{
        BackendBackfillInspectionSubjectErrorV1, BackendBackfillInspectionSubjectRegistryV1,
        BackfillInspectionSubjectMaterialV1, ConsumedBackfillInspectionSubjectProofV1,
        SealedBackfillInspectionSubjectProofV1,
    },
    backend_cas_ledger_install::{
        ConsumedDurableCasLedgerInstallForInitializerV1, DurableCasLedgerInstalledProofV1,
    },
    backend_locked_high_water_capture::{
        ConsumedLockedHighWaterCaptureProofV1, LockedHighWaterCaptureMaterialV1,
        LockedHighWaterCaptureRegistryV1, SealedLockedHighWaterCaptureProofV1,
    },
    backend_operation_journal::{
        BackendOperationJournalV1, JournalError, ReceiptZeroInitializerCaptureMaterialV1,
        ReceiptZeroInitializerClaimMaterialV1, ReceiptZeroInitializerInspectionMaterialV1,
        ReceiptZeroInitializerInstallMaterialV1, ReceiptZeroInitializerJournalClaimV1,
        ReceiptZeroInitializerJournalDispatchV1, ReceiptZeroInitializerSourceMaterialV1,
        ReceiptZeroInitializerTransactionMaterialV1,
    },
    backend_source_ledger_admission::{
        ConsumedDurableSourceLedgerAdmissionForInitializerV1, DurableSourceLedgerAdmissionHandleV1,
    },
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ReceiptZeroInitializerErrorV1 {
    StaleCapture,
    InspectionUnavailable,
    SourceAdmissionUnavailable,
    CasInstallUnavailable,
    JournalAuthorityMismatch,
    BindingMismatch,
    ReplayBlocked,
    CapacityExceeded,
    DurabilityUnconfirmed,
    JournalUnavailable,
    ExecutionUnavailable,
}

/// Inert, non-cloneable and non-serializable proof that the four test-only prerequisites and exact
/// transaction material matched and that the initializer's durable `Claimed` fence was confirmed.
/// The capture remains sealed and unconsumed until a future precommit can consume it immediately
/// beside the transaction.
struct DurableReceiptZeroInitializerClaimHandleV1 {
    journal: Weak<BackendOperationJournalV1>,
    claim: ReceiptZeroInitializerJournalClaimV1,
    _source: ConsumedDurableSourceLedgerAdmissionForInitializerV1,
    _installed: ConsumedDurableCasLedgerInstallForInitializerV1,
    _inspection: ConsumedBackfillInspectionSubjectProofV1,
    capture: SealedLockedHighWaterCaptureProofV1,
}

/// Inert proof-level B3a handoff. The capture was consumed exactly once and the exact initializer
/// record is durably OutcomeUnknown, but this wrapper exposes no database, SQL, execution,
/// settlement, Receipt, retry, or release authority.
#[must_use]
struct DurableReceiptZeroInitializerOutcomeUnknownV1 {
    _journal: Weak<BackendOperationJournalV1>,
    _dispatch: ReceiptZeroInitializerJournalDispatchV1,
    _source: ConsumedDurableSourceLedgerAdmissionForInitializerV1,
    _installed: ConsumedDurableCasLedgerInstallForInitializerV1,
    _inspection: ConsumedBackfillInspectionSubjectProofV1,
    _capture: ConsumedLockedHighWaterCaptureProofV1,
}

/// Private B3b terminal handoff. The fixed writer was attempted under the journal-bound runway,
/// but every successful ACK, definitive COMMIT rejection, and ambiguous COMMIT outcome still
/// requires a fresh, independent read-only reconciliation. This token has no settlement, Receipt,
/// retry, or release authority and retains only secret-free durable lineage for B3c.
#[must_use]
struct DurableReceiptZeroInitializerNeedsIndependentReadV1 {
    _journal: Weak<BackendOperationJournalV1>,
    _material: ReceiptZeroInitializerClaimMaterialV1,
    _source: ConsumedDurableSourceLedgerAdmissionForInitializerV1,
    _installed: ConsumedDurableCasLedgerInstallForInitializerV1,
    _inspection: ConsumedBackfillInspectionSubjectProofV1,
    _capture: ConsumedLockedHighWaterCaptureProofV1,
}

impl DurableReceiptZeroInitializerNeedsIndependentReadV1 {
    const fn request_dispatch_authenticated(&self) -> bool {
        false
    }

    const fn database_authority_created(&self) -> bool {
        false
    }

    const fn mutation_authorized(&self) -> bool {
        false
    }

    const fn execution_authorized(&self) -> bool {
        false
    }

    const fn requires_independent_readback(&self) -> bool {
        true
    }

    const fn database_cas_readback_verified(&self) -> bool {
        false
    }

    const fn settlement_authorized(&self) -> bool {
        false
    }

    const fn receipt_v2_issued(&self) -> bool {
        false
    }

    const fn automatic_retry_allowed(&self) -> bool {
        false
    }

    const fn release_authorized(&self) -> bool {
        false
    }

    fn material_for_test(&self) -> &ReceiptZeroInitializerClaimMaterialV1 {
        &self._material
    }
}

impl DurableReceiptZeroInitializerOutcomeUnknownV1 {
    /// The only B3b executable entry consumes the complete private B3a wrapper by value. Merely
    /// constructing the returned future performs no journal or connector work. Its first poll
    /// captures the connector clock, revalidates and projects the exact 28 parameters, consumes
    /// the journal dispatch and live window, and immediately polls the sealed connector under one
    /// fixed runway; there is no await gap inside that synchronous prefix.
    fn execute_for_test<'a>(
        self,
        connector: ReceiptZeroPrecommitTestConnectorV1,
        interrupts: &'a ReceiptZeroPrecommitTestInterruptsV1,
    ) -> impl std::future::Future<
        Output = Result<
            DurableReceiptZeroInitializerNeedsIndependentReadV1,
            ReceiptZeroInitializerErrorV1,
        >,
    > + Send
           + 'a {
        async move {
            let anchor = capture_initializer_precommit_clock_for_test(interrupts);
            let material = self._dispatch.material_for_test().clone();
            let prepared = prepare_initializer_precommit_for_test(&material)
                .map_err(|_| ReceiptZeroInitializerErrorV1::BindingMismatch)?;
            let journal = self
                ._journal
                .upgrade()
                .ok_or(ReceiptZeroInitializerErrorV1::JournalUnavailable)?;
            let DurableReceiptZeroInitializerOutcomeUnknownV1 {
                _journal: _,
                _dispatch: dispatch,
                _source: source,
                _installed: installed,
                _inspection: inspection,
                _capture: capture,
            } = self;
            let window = journal
                .issue_receipt_zero_initializer_live_run_window_for_test(dispatch)
                .map_err(map_journal_error)?;
            let ceiling = journal
                .consume_receipt_zero_initializer_live_run_window_for_execution_for_test(window)
                .map_err(map_journal_error)?;
            match run_prepared_initializer_precommit_for_test(prepared, anchor, ceiling, connector)
                .await
            {
                JournalBoundPrecommitDispositionV1::NeedsIndependentReadback => {
                    Ok(DurableReceiptZeroInitializerNeedsIndependentReadV1 {
                        _journal: Arc::downgrade(&journal),
                        _material: material,
                        _source: source,
                        _installed: installed,
                        _inspection: inspection,
                        _capture: capture,
                    })
                }
                JournalBoundPrecommitDispositionV1::FailedBeforeCommit => {
                    Err(ReceiptZeroInitializerErrorV1::ExecutionUnavailable)
                }
            }
        }
    }

    const fn capture_consumed(&self) -> bool {
        true
    }

    const fn durably_outcome_unknown(&self) -> bool {
        true
    }

    const fn request_dispatch_authenticated(&self) -> bool {
        false
    }

    const fn database_authority_created(&self) -> bool {
        false
    }

    const fn mutation_authorized(&self) -> bool {
        false
    }

    const fn execution_authorized(&self) -> bool {
        false
    }

    const fn settlement_authorized(&self) -> bool {
        false
    }

    const fn receipt_v2_issued(&self) -> bool {
        false
    }

    const fn automatic_retry_allowed(&self) -> bool {
        false
    }

    const fn release_authorized(&self) -> bool {
        false
    }

    fn single_flight_key_for_test(&self) -> &str {
        self._dispatch.single_flight_key_for_test()
    }
}

impl DurableReceiptZeroInitializerClaimHandleV1 {
    const fn source_admission_cryptographically_verified(&self) -> bool {
        true
    }

    const fn source_admission_durably_claimed(&self) -> bool {
        true
    }

    const fn cas_ledger_install_durably_applied(&self) -> bool {
        true
    }

    const fn high_water_capture_bound(&self) -> bool {
        true
    }

    const fn inspection_subject_bound(&self) -> bool {
        true
    }

    const fn capture_consumed(&self) -> bool {
        false
    }

    const fn durably_claimed(&self) -> bool {
        true
    }

    const fn request_dispatch_authenticated(&self) -> bool {
        false
    }

    const fn database_authority_created(&self) -> bool {
        false
    }

    const fn mutation_authorized(&self) -> bool {
        false
    }

    const fn execution_authorized(&self) -> bool {
        false
    }

    const fn receipt_v2_issued(&self) -> bool {
        false
    }

    const fn automatic_retry_allowed(&self) -> bool {
        false
    }

    const fn release_authorized(&self) -> bool {
        false
    }

    fn capture_digest_for_test(&self) -> &str {
        &self.claim.material_for_composition().capture.capture_digest
    }

    fn single_flight_key_for_test(&self) -> &str {
        self.claim.single_flight_key_for_test()
    }

    fn transaction_parameter_values_digest_for_test(&self) -> &str {
        &self
            .claim
            .material_for_composition()
            .transaction
            .parameter_values_digest
    }

    fn transaction_execution_id_for_test(&self) -> &str {
        &self
            .claim
            .material_for_composition()
            .transaction
            .parameters
            .execution_id
    }

    /// B3a's fused, by-value boundary. Durable OutcomeUnknown staging happens before the capture is
    /// consumed. Once staging succeeds, every later failure remains conservatively OutcomeUnknown
    /// and cannot restore either the claim or capture authority.
    fn precommit_for_test(
        self,
    ) -> Result<DurableReceiptZeroInitializerOutcomeUnknownV1, ReceiptZeroInitializerErrorV1> {
        self.precommit_with_after_stage_for_test(|| {})
    }

    fn precommit_with_after_stage_for_test(
        self,
        after_stage: impl FnOnce(),
    ) -> Result<DurableReceiptZeroInitializerOutcomeUnknownV1, ReceiptZeroInitializerErrorV1> {
        let journal = self
            .journal
            .upgrade()
            .ok_or(ReceiptZeroInitializerErrorV1::JournalUnavailable)?;
        let DurableReceiptZeroInitializerClaimHandleV1 {
            journal: _,
            claim,
            _source: source,
            _installed: installed,
            _inspection: inspection,
            capture,
        } = self;
        let staged = journal
            .stage_receipt_zero_initializer_outcome_unknown_for_test(claim)
            .map_err(map_journal_error)?;
        after_stage();
        let consumed_capture = capture
            .consume_for_initializer()
            .map_err(|_| ReceiptZeroInitializerErrorV1::StaleCapture)?;
        let projected_capture =
            journal_capture_material(consumed_capture.material_for_composition());
        if &projected_capture != staged.capture_material_for_composition() {
            return Err(ReceiptZeroInitializerErrorV1::BindingMismatch);
        }
        let dispatch = journal
            .publish_receipt_zero_initializer_staged_dispatch_for_test(staged)
            .map_err(map_journal_error)?;
        Ok(DurableReceiptZeroInitializerOutcomeUnknownV1 {
            _journal: Arc::downgrade(&journal),
            _dispatch: dispatch,
            _source: source,
            _installed: installed,
            _inspection: inspection,
            _capture: consumed_capture,
        })
    }
}

fn claim_for_test(
    journal: Arc<BackendOperationJournalV1>,
    inspection_registry: &BackendBackfillInspectionSubjectRegistryV1,
    capture_registry: &LockedHighWaterCaptureRegistryV1,
    source: DurableSourceLedgerAdmissionHandleV1,
    installed: DurableCasLedgerInstalledProofV1,
    inspection: SealedBackfillInspectionSubjectProofV1,
    capture: SealedLockedHighWaterCaptureProofV1,
    transaction: ReceiptZeroInitializerTransactionMaterialV1,
) -> Result<DurableReceiptZeroInitializerClaimHandleV1, ReceiptZeroInitializerErrorV1> {
    let source = source
        .consume_for_initializer_for_test()
        .map_err(|_| ReceiptZeroInitializerErrorV1::SourceAdmissionUnavailable)?;
    let installed = installed
        .consume_for_initializer_for_test()
        .map_err(|_| ReceiptZeroInitializerErrorV1::CasInstallUnavailable)?;
    let inspection = inspection_registry
        .consume_for_initializer(inspection)
        .map_err(|_| ReceiptZeroInitializerErrorV1::InspectionUnavailable)?;
    if !source.belongs_to_journal(&journal) || !installed.belongs_to_journal(&journal) {
        return Err(ReceiptZeroInitializerErrorV1::JournalAuthorityMismatch);
    }
    let capture_material = capture_registry
        .inspect_for_composition(&capture)
        .map_err(|_| ReceiptZeroInitializerErrorV1::StaleCapture)?;
    require_exact_bindings(
        &source,
        &installed,
        inspection.material_for_composition(),
        &capture_material,
    )?;
    let material = journal_claim_material(
        &source,
        &installed,
        &inspection,
        &capture_material,
        transaction,
    );
    let claim = journal
        .claim_receipt_zero_initializer_for_test(material)
        .map_err(map_journal_error)?;

    Ok(DurableReceiptZeroInitializerClaimHandleV1 {
        journal: Arc::downgrade(&journal),
        claim,
        _source: source,
        _installed: installed,
        _inspection: inspection,
        capture,
    })
}

fn map_journal_error(error: JournalError) -> ReceiptZeroInitializerErrorV1 {
    match error {
        JournalError::Conflict | JournalError::ScopeConflict => {
            ReceiptZeroInitializerErrorV1::ReplayBlocked
        }
        JournalError::Full => ReceiptZeroInitializerErrorV1::CapacityExceeded,
        JournalError::DurabilityUnconfirmed => ReceiptZeroInitializerErrorV1::DurabilityUnconfirmed,
        JournalError::Unavailable
        | JournalError::Invalid
        | JournalError::Corrupt
        | JournalError::InvalidState
        | JournalError::CapabilityMissing
        | JournalError::CapabilityExpired
        | JournalError::LeaseActive => ReceiptZeroInitializerErrorV1::JournalUnavailable,
    }
}

fn journal_claim_material(
    source: &ConsumedDurableSourceLedgerAdmissionForInitializerV1,
    installed: &ConsumedDurableCasLedgerInstallForInitializerV1,
    inspection: &ConsumedBackfillInspectionSubjectProofV1,
    capture: &LockedHighWaterCaptureMaterialV1,
    transaction: ReceiptZeroInitializerTransactionMaterialV1,
) -> ReceiptZeroInitializerClaimMaterialV1 {
    let source = source.material_for_composition();
    let installed_material = installed.material_for_composition();
    let install = &installed_material.plan;
    let inspection = inspection.material_for_composition();
    ReceiptZeroInitializerClaimMaterialV1 {
        source: ReceiptZeroInitializerSourceMaterialV1 {
            provider_id: source.provider_id.clone(),
            environment: source.environment.clone(),
            project_ref: source.project_ref.clone(),
            account_id: source.account_id.clone(),
            grant_generation: source.grant_generation.clone(),
            provider_authority_digest: source.provider_authority_digest.clone(),
            application_id: source.application_id.clone(),
            application_digest: source.application_digest.clone(),
            migration_id: source.migration_id.clone(),
            migration_digest: source.migration_digest.clone(),
            migration_plan_digest: source.migration_plan_digest.clone(),
            source_ledger_digest: source.source_ledger_digest.clone(),
            schema_digest: source.schema_digest.clone(),
            subject_digest: source.subject_digest.clone(),
            attestation_digest: source.attestation_digest.clone(),
            payload_digest: source.payload_digest.clone(),
            expectation_digest: source.expectation_digest.clone(),
            scope_digest: source.scope_digest.clone(),
            ci_provider: source.ci_provider.clone(),
            repository: source.repository.clone(),
            workflow: source.workflow.clone(),
            run_id: source.run_id.clone(),
            run_attempt: source.run_attempt,
            protected_ref: source.protected_ref.clone(),
            revision: source.revision.clone(),
            db_push_command_digest: source.db_push_command_digest.clone(),
            db_push_receipt_digest: source.db_push_receipt_digest.clone(),
            database_history_digest: source.database_history_digest.clone(),
        },
        installed: ReceiptZeroInitializerInstallMaterialV1 {
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
            installed_verification_digest: installed_material.installed_verification_digest.clone(),
            observed_at: installed_material.observed_at.clone(),
            snapshot_marker: installed_material.snapshot_marker.clone(),
            server_version_num: installed_material.server_version_num.clone(),
        },
        inspection: ReceiptZeroInitializerInspectionMaterialV1 {
            provider_id: inspection.provider_id.clone(),
            provider_authority_digest: inspection.provider_authority_digest.clone(),
            application_id: inspection.application_id.clone(),
            application_digest: inspection.application_digest.clone(),
            migration_id: inspection.migration_id.clone(),
            migration_digest: inspection.migration_digest.clone(),
            migration_plan_digest: inspection.migration_plan_digest.clone(),
            inspection_subject_digest: inspection.inspection_subject_digest.clone(),
            table_name: inspection.table_name.clone(),
            cursor_field: inspection.cursor_field.clone(),
            target_field: inspection.target_field.clone(),
            maximum_cursor: inspection.maximum_cursor,
            batch_size: inspection.batch_size,
            maximum_batch_receipt_count: inspection.maximum_batch_receipt_count,
        },
        capture: journal_capture_material(capture),
        transaction,
    }
}

fn journal_capture_material(
    capture: &LockedHighWaterCaptureMaterialV1,
) -> ReceiptZeroInitializerCaptureMaterialV1 {
    ReceiptZeroInitializerCaptureMaterialV1 {
        provider_id: capture.provider_id.clone(),
        environment: capture.environment.clone(),
        project_ref: capture.project_ref.clone(),
        account_id: capture.account_id.clone(),
        source_grant_generation: capture.source_grant_generation.clone(),
        read_grant_generation: capture.read_grant_generation.clone(),
        install_write_grant_generation: capture.install_write_grant_generation.clone(),
        capture_write_grant_generation: capture.capture_write_grant_generation.clone(),
        provider_authority_digest: capture.provider_authority_digest.clone(),
        application_id: capture.application_id.clone(),
        application_digest: capture.application_digest.clone(),
        migration_id: capture.migration_id.clone(),
        migration_digest: capture.migration_digest.clone(),
        migration_plan_digest: capture.migration_plan_digest.clone(),
        source_ledger_digest: capture.source_ledger_digest.clone(),
        source_scope_digest: capture.source_scope_digest.clone(),
        schema_digest: capture.schema_digest.clone(),
        source_ledger_subject_digest: capture.source_ledger_subject_digest.clone(),
        inspection_subject_digest: capture.inspection_subject_digest.clone(),
        attestation_digest: capture.attestation_digest.clone(),
        source_review_digest: capture.source_review_digest.clone(),
        install_plan_digest: capture.install_plan_digest.clone(),
        install_review_digest: capture.install_review_digest.clone(),
        marker_binding_digest: capture.marker_binding_digest.clone(),
        installed_verification_digest: capture.installed_verification_digest.clone(),
        capture_review_digest: capture.capture_review_digest.clone(),
        catalog_precondition_digest: capture.catalog_precondition_digest.clone(),
        query_digest: capture.query_digest.clone(),
        capture_digest: capture.capture_digest.clone(),
        schema_name: capture.schema_name.clone(),
        schema_oid: capture.schema_oid.clone(),
        table_name: capture.table_name.clone(),
        table_oid: capture.table_oid.clone(),
        cursor_field: capture.cursor_field.clone(),
        cursor_sub_id: capture.cursor_sub_id,
        cursor_type_oid: capture.cursor_type_oid.clone(),
        target_field: capture.target_field.clone(),
        target_sub_id: capture.target_sub_id,
        target_type_oid: capture.target_type_oid.clone(),
        primary_key_oid: capture.primary_key_oid.clone(),
        sequence_oid: capture.sequence_oid.clone(),
        barrier_constraint_oid: capture.barrier_constraint_oid.clone(),
        statement_count: capture.statement_count,
        access_mode: capture.access_mode.clone(),
        snapshot_scope: capture.snapshot_scope.clone(),
        lock_mode: capture.lock_mode.clone(),
        transaction_isolation: capture.transaction_isolation.clone(),
        transaction_read_only: capture.transaction_read_only,
        row_security: capture.row_security,
        search_path: capture.search_path.clone(),
        database_primary: capture.database_primary,
        maximum_cursor: capture.maximum_cursor,
        captured_high_water: capture.captured_high_water,
        minimum_cursor: capture.minimum_cursor,
        total_row_count: capture.total_row_count,
        remaining_null_target_row_count: capture.remaining_null_target_row_count,
        unsafe_cursor_row_count: capture.unsafe_cursor_row_count,
        batch_size: capture.batch_size,
        required_batch_receipt_count: capture.required_batch_receipt_count,
        maximum_batch_receipt_count: capture.maximum_batch_receipt_count,
        observed_at: capture.observed_at.clone(),
        snapshot_marker: capture.snapshot_marker.clone(),
        server_version_num: capture.server_version_num.clone(),
        query_bindings_match: capture.query_bindings_match,
        current_and_session_role_match: capture.current_and_session_role_match,
        full_table_read_authority_observed: capture.full_table_read_authority_observed,
        exact_address_matches: capture.exact_address_matches,
        cursor_range_safe: capture.cursor_range_safe,
        receipt_capacity_fits: capture.receipt_capacity_fits,
        all_capture_checks_passed: capture.all_capture_checks_passed,
    }
}

fn require_exact_bindings(
    source: &ConsumedDurableSourceLedgerAdmissionForInitializerV1,
    installed: &ConsumedDurableCasLedgerInstallForInitializerV1,
    inspection: &BackfillInspectionSubjectMaterialV1,
    capture: &LockedHighWaterCaptureMaterialV1,
) -> Result<(), ReceiptZeroInitializerErrorV1> {
    let source = source.material_for_composition();
    let installed_material = installed.material_for_composition();
    let install = &installed_material.plan;
    let exact = source.provider_id == capture.provider_id
        && source.environment == capture.environment
        && source.project_ref == capture.project_ref
        && source.account_id == capture.account_id
        && source.grant_generation == capture.source_grant_generation
        && source.provider_authority_digest == capture.provider_authority_digest
        && source.application_id == capture.application_id
        && source.application_digest == capture.application_digest
        && source.migration_id == capture.migration_id
        && source.migration_digest == capture.migration_digest
        && source.migration_plan_digest == capture.migration_plan_digest
        && source.source_ledger_digest == capture.source_ledger_digest
        && source.scope_digest == capture.source_scope_digest
        && source.schema_digest == capture.schema_digest
        && source.subject_digest == capture.source_ledger_subject_digest
        && source.attestation_digest == capture.attestation_digest
        && inspection.provider_id == capture.provider_id
        && inspection.provider_authority_digest == capture.provider_authority_digest
        && inspection.application_id == capture.application_id
        && inspection.application_digest == capture.application_digest
        && inspection.migration_id == capture.migration_id
        && inspection.migration_digest == capture.migration_digest
        && inspection.migration_plan_digest == capture.migration_plan_digest
        && inspection.inspection_subject_digest == capture.inspection_subject_digest
        && inspection.table_name == capture.table_name
        && inspection.cursor_field == capture.cursor_field
        && inspection.target_field == capture.target_field
        && inspection.maximum_cursor == capture.maximum_cursor
        && inspection.batch_size == capture.batch_size
        && inspection.maximum_batch_receipt_count == capture.maximum_batch_receipt_count
        && install.provider_id == capture.provider_id
        && install.environment == capture.environment
        && install.project_ref == capture.project_ref
        && install.account_id == capture.account_id
        && install.read_grant_generation == capture.read_grant_generation
        && install.write_grant_generation == capture.install_write_grant_generation
        && install.source_review_digest == capture.source_review_digest
        && install.install_review_digest == capture.install_review_digest
        && install.marker_binding_digest == capture.marker_binding_digest
        && installed_material.installed_verification_digest
            == capture.installed_verification_digest
        && installed.plan_digest_for_composition() == capture.install_plan_digest
        && installed_material.server_version_num == capture.server_version_num;
    if exact {
        Ok(())
    } else {
        Err(ReceiptZeroInitializerErrorV1::BindingMismatch)
    }
}

#[cfg(test)]
#[path = "proof_composition/tests.rs"]
mod tests;
