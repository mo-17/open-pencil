use super::*;
use crate::backend_receipt_zero_initializer::precommit::{
    receipt_zero_precommit_test_connector_for_scenario, ReceiptZeroPrecommitTestEventV1,
    ReceiptZeroPrecommitTestInterruptsV1, ReceiptZeroPrecommitTestScenarioV1,
};
use std::{
    future::Future,
    task::{Context, Poll, Waker},
};

fn ready_on_first_poll<F: Future>(future: F) -> F::Output {
    let mut future = Box::pin(future);
    let mut context = Context::from_waker(Waker::noop());
    match future.as_mut().poll(&mut context) {
        Poll::Ready(output) => output,
        Poll::Pending => panic!("bounded composition harness must complete on its first poll"),
    }
}

fn outcome_unknown_for_execution(
    label: &str,
) -> (
    TempDir,
    Arc<BackendOperationJournalV1>,
    DurableReceiptZeroInitializerOutcomeUnknownV1,
) {
    let (temp, journal, source, installed, inspection, material, transaction) =
        prerequisites(label);
    let registry = LockedHighWaterCaptureRegistryV1::new_dormant_production().unwrap();
    let capture = registry.issue_for_test(material).unwrap();
    let (inspection_registry, inspection) = issue_inspection(inspection);
    let outcome_unknown = claim_for_test(
        Arc::clone(&journal),
        &inspection_registry,
        &registry,
        source,
        installed,
        inspection,
        capture,
        transaction,
    )
    .unwrap()
    .precommit_for_test()
    .unwrap();
    (temp, journal, outcome_unknown)
}

fn stage_names_and_deadlines(
    events: &[ReceiptZeroPrecommitTestEventV1],
) -> Vec<(&'static str, Duration)> {
    events
        .iter()
        .filter_map(|event| match event {
            ReceiptZeroPrecommitTestEventV1::Stage { name, deadline } => Some((*name, *deadline)),
            ReceiptZeroPrecommitTestEventV1::CancelDatabaseRequest
            | ReceiptZeroPrecommitTestEventV1::AbortTransaction
            | ReceiptZeroPrecommitTestEventV1::CancelConnectRequest => None,
        })
        .collect()
}

#[test]
fn constructing_then_dropping_execution_future_has_zero_side_effects() {
    let (_temp, journal, outcome_unknown) = outcome_unknown_for_execution("future-drop");
    let (connector, probe) = receipt_zero_precommit_test_connector_for_scenario(
        ReceiptZeroPrecommitTestScenarioV1::AckInserted,
    );
    let interrupts = ReceiptZeroPrecommitTestInterruptsV1::default();
    let future = outcome_unknown.execute_for_test(connector, &interrupts);

    assert!(probe.events_for_test().is_empty());
    drop(future);
    assert!(probe.events_for_test().is_empty());
    assert_eq!(
        journal
            .receipt_zero_initializer_outcome_unknown_count_for_test()
            .unwrap(),
        1
    );
    assert_eq!(
        journal
            .receipt_zero_initializer_dispatch_permit_count_for_test()
            .unwrap(),
        1
    );
}

#[test]
fn first_poll_consumes_the_lineage_and_uses_one_deadline_for_all_ten_stages() {
    let (_temp, journal, outcome_unknown) = outcome_unknown_for_execution("writer-ack");
    let expected_material = outcome_unknown._dispatch.material_for_test().clone();
    let (connector, probe) = receipt_zero_precommit_test_connector_for_scenario(
        ReceiptZeroPrecommitTestScenarioV1::AckInserted,
    );
    let interrupts = ReceiptZeroPrecommitTestInterruptsV1::default();

    let needs_read = ready_on_first_poll(outcome_unknown.execute_for_test(connector, &interrupts))
        .expect("ACK still produces only a private independent-read handoff");
    assert!(!needs_read.request_dispatch_authenticated());
    assert!(!needs_read.database_authority_created());
    assert!(!needs_read.mutation_authorized());
    assert!(!needs_read.execution_authorized());
    assert!(needs_read.requires_independent_readback());
    assert!(!needs_read.database_cas_readback_verified());
    assert!(!needs_read.settlement_authorized());
    assert!(!needs_read.receipt_v2_issued());
    assert!(!needs_read.automatic_retry_allowed());
    assert!(!needs_read.release_authorized());
    assert!(needs_read.material_for_test() == &expected_material);

    let stages = stage_names_and_deadlines(&probe.events_for_test());
    assert_eq!(
        stages.iter().map(|(name, _)| *name).collect::<Vec<_>>(),
        vec![
            "connect",
            "begin",
            "search-path",
            "row-security",
            "synchronous-commit",
            "statement-timeout",
            "lock-timeout",
            "prepare",
            "execute",
            "commit",
        ]
    );
    assert_eq!(stages.len(), 10);
    assert!(stages
        .iter()
        .all(|(_, deadline)| *deadline == Duration::from_secs(25)));
    assert_eq!(
        journal
            .receipt_zero_initializer_outcome_unknown_count_for_test()
            .unwrap(),
        1
    );
    assert_eq!(
        journal
            .receipt_zero_initializer_dispatch_permit_count_for_test()
            .unwrap(),
        0
    );
}

#[test]
fn commit_rejection_and_commit_unknown_both_require_independent_readback() {
    for (label, scenario) in [
        (
            "writer-commit-rejected",
            ReceiptZeroPrecommitTestScenarioV1::CommitRejected,
        ),
        (
            "writer-commit-unknown",
            ReceiptZeroPrecommitTestScenarioV1::CommitUnavailable,
        ),
    ] {
        let (_temp, journal, outcome_unknown) = outcome_unknown_for_execution(label);
        let (connector, probe) = receipt_zero_precommit_test_connector_for_scenario(scenario);
        let interrupts = ReceiptZeroPrecommitTestInterruptsV1::default();
        let needs_read =
            ready_on_first_poll(outcome_unknown.execute_for_test(connector, &interrupts))
                .expect("COMMIT terminal states must remain readback-only");

        assert!(needs_read.requires_independent_readback());
        assert!(!needs_read.settlement_authorized());
        assert!(!needs_read.release_authorized());
        assert_eq!(
            stage_names_and_deadlines(&probe.events_for_test())
                .iter()
                .filter(|(name, _)| *name == "commit")
                .count(),
            1
        );
        assert_eq!(
            journal
                .receipt_zero_initializer_outcome_unknown_count_for_test()
                .unwrap(),
            1
        );
    }
}

#[test]
fn failures_before_commit_return_no_readback_or_retry_authority() {
    for (label, scenario) in [
        (
            "writer-connect-rejected",
            ReceiptZeroPrecommitTestScenarioV1::ConnectRejected,
        ),
        (
            "writer-begin-rejected",
            ReceiptZeroPrecommitTestScenarioV1::BeginRejected,
        ),
    ] {
        let (_temp, journal, outcome_unknown) = outcome_unknown_for_execution(label);
        let (connector, probe) = receipt_zero_precommit_test_connector_for_scenario(scenario);
        let interrupts = ReceiptZeroPrecommitTestInterruptsV1::default();
        let error =
            match ready_on_first_poll(outcome_unknown.execute_for_test(connector, &interrupts)) {
                Err(error) => error,
                Ok(_) => panic!("a pre-COMMIT failure creates no successor authority"),
            };

        assert_eq!(error, ReceiptZeroInitializerErrorV1::ExecutionUnavailable);
        let events = probe.events_for_test();
        assert_eq!(
            stage_names_and_deadlines(&events)
                .iter()
                .filter(|(name, _)| *name == "connect")
                .count(),
            1
        );
        assert!(!stage_names_and_deadlines(&events)
            .iter()
            .any(|(name, _)| *name == "commit"));
        assert_eq!(
            journal
                .receipt_zero_initializer_outcome_unknown_count_for_test()
                .unwrap(),
            1
        );
    }
}

#[test]
fn exact_prerequisites_create_only_an_inert_durable_claim() {
    let (_temp, journal, source, installed, inspection, material, transaction) =
        prerequisites("happy");
    let source_before = journal.source_ledger_admission_count_for_test().unwrap();
    let initializer_before = journal.receipt_zero_initializer_count_for_test().unwrap();
    let registry = LockedHighWaterCaptureRegistryV1::new_dormant_production().unwrap();
    let capture = registry.issue_for_test(material.clone()).unwrap();
    let (inspection_registry, inspection) = issue_inspection(inspection);
    let claimed = claim_for_test(
        Arc::clone(&journal),
        &inspection_registry,
        &registry,
        source,
        installed,
        inspection,
        capture,
        transaction.clone(),
    )
    .unwrap();
    assert!(claimed.source_admission_cryptographically_verified());
    assert!(claimed.source_admission_durably_claimed());
    assert!(claimed.cas_ledger_install_durably_applied());
    assert!(claimed.high_water_capture_bound());
    assert!(claimed.inspection_subject_bound());
    assert!(claimed.durably_claimed());
    assert!(!claimed.capture_consumed());
    assert!(!claimed.request_dispatch_authenticated());
    assert!(!claimed.database_authority_created());
    assert!(!claimed.mutation_authorized());
    assert!(!claimed.execution_authorized());
    assert!(!claimed.receipt_v2_issued());
    assert!(!claimed.automatic_retry_allowed());
    assert!(!claimed.release_authorized());
    assert_eq!(claimed.capture_digest_for_test(), material.capture_digest);
    assert_eq!(
        claimed.transaction_parameter_values_digest_for_test(),
        transaction.parameter_values_digest
    );
    assert_eq!(
        claimed.transaction_execution_id_for_test(),
        transaction.parameters.execution_id
    );
    assert_eq!(claimed.single_flight_key_for_test().len(), 43);
    assert!(registry.inspect_for_composition(&claimed.capture).unwrap() == material);
    assert_eq!(
        journal.source_ledger_admission_count_for_test().unwrap(),
        source_before
    );
    assert_eq!(
        journal.receipt_zero_initializer_count_for_test().unwrap(),
        initializer_before + 1
    );
}

#[test]
fn fused_precommit_consumes_capture_only_after_durable_outcome_unknown() {
    let (_temp, journal, source, installed, inspection, material, transaction) =
        prerequisites("fused-happy");
    let registry = LockedHighWaterCaptureRegistryV1::new_dormant_production().unwrap();
    let capture = registry.issue_for_test(material).unwrap();
    let (inspection_registry, inspection) = issue_inspection(inspection);
    let claimed = claim_for_test(
        Arc::clone(&journal),
        &inspection_registry,
        &registry,
        source,
        installed,
        inspection,
        capture,
        transaction,
    )
    .unwrap();

    let outcome_unknown = claimed.precommit_for_test().unwrap();
    assert!(outcome_unknown.capture_consumed());
    assert!(outcome_unknown.durably_outcome_unknown());
    assert!(!outcome_unknown.request_dispatch_authenticated());
    assert!(!outcome_unknown.database_authority_created());
    assert!(!outcome_unknown.mutation_authorized());
    assert!(!outcome_unknown.execution_authorized());
    assert!(!outcome_unknown.settlement_authorized());
    assert!(!outcome_unknown.receipt_v2_issued());
    assert!(!outcome_unknown.automatic_retry_allowed());
    assert!(!outcome_unknown.release_authorized());
    assert_eq!(outcome_unknown.single_flight_key_for_test().len(), 43);
    assert_eq!(
        journal.receipt_zero_initializer_count_for_test().unwrap(),
        0
    );
    assert_eq!(
        journal
            .receipt_zero_initializer_outcome_unknown_count_for_test()
            .unwrap(),
        1
    );
    assert_eq!(
        journal
            .receipt_zero_initializer_dispatch_permit_count_for_test()
            .unwrap(),
        1
    );
}

#[test]
fn capture_registry_loss_after_claim_leaves_durable_outcome_unknown_without_permit() {
    let (_temp, journal, source, installed, inspection, material, transaction) =
        prerequisites("fused-stale-after-stage");
    let registry = LockedHighWaterCaptureRegistryV1::new_dormant_production().unwrap();
    let capture = registry.issue_for_test(material).unwrap();
    let (inspection_registry, inspection) = issue_inspection(inspection);
    let claimed = claim_for_test(
        Arc::clone(&journal),
        &inspection_registry,
        &registry,
        source,
        installed,
        inspection,
        capture,
        transaction,
    )
    .unwrap();
    assert_eq!(
        claimed
            .precommit_with_after_stage_for_test(|| drop(registry))
            .err()
            .unwrap(),
        ReceiptZeroInitializerErrorV1::StaleCapture
    );
    assert_eq!(
        journal.receipt_zero_initializer_count_for_test().unwrap(),
        0
    );
    assert_eq!(
        journal
            .receipt_zero_initializer_outcome_unknown_count_for_test()
            .unwrap(),
        1
    );
    assert_eq!(
        journal
            .receipt_zero_initializer_dispatch_permit_count_for_test()
            .unwrap(),
        0
    );
}

#[test]
fn unconfirmed_outcome_unknown_stage_returns_no_wrapper_or_dispatch_permit() {
    let sync = Arc::new(SwitchableSync::confirmed());
    let (temp, bound_journal, source, installed, inspection, material, transaction) =
        prerequisites_with_sync("fused-unconfirmed-stage", sync.clone());
    let registry = LockedHighWaterCaptureRegistryV1::new_dormant_production().unwrap();
    let capture = registry.issue_for_test(material.clone()).unwrap();
    let (inspection_registry, inspection) = issue_inspection(inspection);
    let claimed = claim_for_test(
        Arc::clone(&bound_journal),
        &inspection_registry,
        &registry,
        source,
        installed,
        inspection,
        capture,
        transaction,
    )
    .unwrap();
    sync.make_unconfirmed();

    assert_eq!(
        claimed.precommit_for_test().err().unwrap(),
        ReceiptZeroInitializerErrorV1::DurabilityUnconfirmed
    );
    assert_eq!(
        bound_journal
            .receipt_zero_initializer_dispatch_permit_count_for_test()
            .unwrap(),
        0
    );
    assert_eq!(
        registry.issue_for_test(material).err().unwrap(),
        LockedHighWaterCaptureErrorV1::ScopeAlreadyActive
    );
    let reopened = journal(&temp);
    assert_eq!(
        reopened.receipt_zero_initializer_count_for_test().unwrap(),
        0
    );
    assert_eq!(
        reopened
            .receipt_zero_initializer_outcome_unknown_count_for_test()
            .unwrap(),
        1
    );
    assert_eq!(
        reopened
            .receipt_zero_initializer_dispatch_permit_count_for_test()
            .unwrap(),
        0
    );
}

#[test]
fn stale_capture_registry_is_rejected() {
    let (_temp, journal, source, installed, inspection, material, transaction) =
        prerequisites("stale");
    let registry = LockedHighWaterCaptureRegistryV1::new_dormant_production().unwrap();
    let capture = registry.issue_for_test(material).unwrap();
    drop(registry);
    let (inspection_registry, inspection) = issue_inspection(inspection);
    assert_eq!(
        claim_for_test(
            Arc::clone(&journal),
            &inspection_registry,
            &LockedHighWaterCaptureRegistryV1::new_dormant_production().unwrap(),
            source,
            installed,
            inspection,
            capture,
            transaction,
        )
        .err()
        .unwrap(),
        ReceiptZeroInitializerErrorV1::StaleCapture
    );
    assert_eq!(
        journal.receipt_zero_initializer_count_for_test().unwrap(),
        0
    );
}

#[test]
fn unconfirmed_claim_leaves_an_orphan_fence_and_burns_the_capture() {
    let sync = Arc::new(SwitchableSync::confirmed());
    let (temp, bound_journal, source, installed, inspection, material, transaction) =
        prerequisites_with_sync("unconfirmed", sync.clone());
    sync.make_unconfirmed();
    let registry = LockedHighWaterCaptureRegistryV1::new_dormant_production().unwrap();
    let capture = registry.issue_for_test(material.clone()).unwrap();
    let (inspection_registry, inspection) = issue_inspection(inspection);
    assert_eq!(
        claim_for_test(
            bound_journal,
            &inspection_registry,
            &registry,
            source,
            installed,
            inspection,
            capture,
            transaction,
        )
        .err()
        .unwrap(),
        ReceiptZeroInitializerErrorV1::DurabilityUnconfirmed
    );

    let reopened = journal(&temp);
    assert_eq!(
        reopened.receipt_zero_initializer_count_for_test().unwrap(),
        1
    );
    assert_eq!(
        registry.issue_for_test(material).err().unwrap(),
        LockedHighWaterCaptureErrorV1::ScopeAlreadyActive
    );
}

#[test]
fn durable_prerequisites_cannot_be_rebound_to_a_foreign_journal() {
    let (_temp, source_journal, source, installed, inspection, material, transaction) =
        prerequisites("foreign-journal");
    let foreign_temp = TempDir::new().unwrap();
    let foreign_journal = journal(&foreign_temp);
    let registry = LockedHighWaterCaptureRegistryV1::new_dormant_production().unwrap();
    let capture = registry.issue_for_test(material).unwrap();
    let (inspection_registry, inspection) = issue_inspection(inspection);
    assert_eq!(
        claim_for_test(
            Arc::clone(&foreign_journal),
            &inspection_registry,
            &registry,
            source,
            installed,
            inspection,
            capture,
            transaction,
        )
        .err()
        .unwrap(),
        ReceiptZeroInitializerErrorV1::JournalAuthorityMismatch
    );
    assert_eq!(
        source_journal
            .receipt_zero_initializer_count_for_test()
            .unwrap(),
        0
    );
    assert_eq!(
        foreign_journal
            .receipt_zero_initializer_count_for_test()
            .unwrap(),
        0
    );
}

#[test]
fn every_authority_domain_is_cross_bound() {
    let mutations: [fn(&mut LockedHighWaterCaptureMaterialV1); 14] = [
        |value| value.account_id.push('x'),
        |value| value.source_grant_generation = "source-ledger-grant-2".to_owned(),
        |value| value.provider_authority_digest = digest("wrong-provider"),
        |value| value.application_digest = digest("wrong-application"),
        |value| value.source_ledger_digest = digest("wrong-source-ledger"),
        |value| value.source_scope_digest = digest("wrong-source-scope"),
        |value| value.source_ledger_subject_digest = digest("wrong-source-subject"),
        |value| value.inspection_subject_digest = digest("wrong-inspection-subject"),
        |value| value.read_grant_generation = OTHER_READ_GRANT.to_owned(),
        |value| value.install_plan_digest = digest("wrong-install-plan"),
        |value| value.installed_verification_digest = digest("wrong-installed"),
        |value| value.table_name = "other_tasks".to_owned(),
        |value| value.batch_size = 21,
        |value| value.server_version_num = "160000".to_owned(),
    ];
    for (index, mutate) in mutations.into_iter().enumerate() {
        let label = format!("mismatch-{index}");
        let (_temp, journal, source, installed, inspection, mut material, transaction) =
            prerequisites(&label);
        mutate(&mut material);
        let registry = LockedHighWaterCaptureRegistryV1::new_dormant_production().unwrap();
        let capture = registry.issue_for_test(material).unwrap();
        let (inspection_registry, inspection) = issue_inspection(inspection);
        assert_eq!(
            claim_for_test(
                Arc::clone(&journal),
                &inspection_registry,
                &registry,
                source,
                installed,
                inspection,
                capture,
                transaction,
            )
            .err()
            .unwrap(),
            ReceiptZeroInitializerErrorV1::BindingMismatch
        );
        assert_eq!(
            journal.receipt_zero_initializer_count_for_test().unwrap(),
            0
        );
    }
}

#[test]
fn every_compiler_inspection_subject_domain_is_cross_bound() {
    let mutations: [fn(&mut BackfillInspectionSubjectMaterialV1); 14] = [
        |value| value.provider_id = "other-provider".to_owned(),
        |value| value.provider_authority_digest = digest("wrong-provider"),
        |value| value.application_id = "other-application".to_owned(),
        |value| value.application_digest = digest("wrong-application"),
        |value| value.migration_id = "other-migration".to_owned(),
        |value| value.migration_digest = digest("wrong-migration"),
        |value| value.migration_plan_digest = digest("wrong-migration-plan"),
        |value| value.inspection_subject_digest = digest("wrong-inspection-subject"),
        |value| value.table_name = "other_tasks".to_owned(),
        |value| value.cursor_field = "other_id".to_owned(),
        |value| value.target_field = "other_target".to_owned(),
        |value| value.maximum_cursor -= 1,
        |value| value.batch_size += 1,
        |value| value.maximum_batch_receipt_count -= 1,
    ];
    for (index, mutate) in mutations.into_iter().enumerate() {
        let label = format!("inspection-mismatch-{index}");
        let (_temp, journal, source, installed, mut inspection, material, transaction) =
            prerequisites(&label);
        mutate(&mut inspection);
        let registry = LockedHighWaterCaptureRegistryV1::new_dormant_production().unwrap();
        let capture = registry.issue_for_test(material).unwrap();
        let inspection_registry =
            BackendBackfillInspectionSubjectRegistryV1::new_dormant_production().unwrap();
        let inspection = match inspection_registry.issue_material_for_test(inspection) {
            Ok(inspection) => inspection,
            Err(error) => {
                assert!(matches!(index, 0 | 11 | 13));
                assert_eq!(
                    error,
                    BackendBackfillInspectionSubjectErrorV1::InvalidMaterial
                );
                assert_eq!(
                    journal.receipt_zero_initializer_count_for_test().unwrap(),
                    0
                );
                continue;
            }
        };
        assert_eq!(
            claim_for_test(
                Arc::clone(&journal),
                &inspection_registry,
                &registry,
                source,
                installed,
                inspection,
                capture,
                transaction,
            )
            .err()
            .unwrap(),
            ReceiptZeroInitializerErrorV1::BindingMismatch
        );
        assert_eq!(
            journal.receipt_zero_initializer_count_for_test().unwrap(),
            0
        );
    }
}

#[test]
fn malformed_capture_is_rejected_before_composition() {
    let (_temp, _journal, _source, _installed, _inspection, mut material, _transaction) =
        prerequisites("invalid");
    material.capture_digest = "not-a-digest".to_owned();
    let registry = LockedHighWaterCaptureRegistryV1::new_dormant_production().unwrap();
    assert_eq!(
        registry.issue_for_test(material).err().unwrap(),
        LockedHighWaterCaptureErrorV1::InvalidMaterial
    );
}

#[test]
fn proof_composition_is_test_only_and_has_no_external_authority() {
    let source = include_str!("../proof_composition.rs");
    let parent_source = include_str!("../../backend_receipt_zero_initializer.rs");
    let precommit_source = include_str!("../precommit.rs");
    let inspection_source = include_str!("../../backend_backfill_inspection_subject.rs");
    let lib = include_str!("../../lib.rs");
    assert!(lib.contains("mod backend_receipt_zero_initializer;"));
    assert!(!lib.contains("#[cfg(test)]\nmod backend_receipt_zero_initializer;"));
    assert!(!parent_source.contains("mod proof_composition;"));
    assert!(precommit_source.contains("#[path = \"proof_composition.rs\"]\nmod proof_composition;"));
    assert!(lib.contains("mod backend_backfill_inspection_subject;"));
    for forbidden in [
        concat!("#[tauri", "::command]"),
        concat!("reqwest", "::"),
        concat!("Credential", "Resolver"),
        concat!("Database", "SessionV1"),
        concat!("begin_serializable", "_read_write"),
        concat!("execute_", "prepared"),
        concat!("CREATE ", "TABLE"),
        concat!("ALTER ", "TABLE"),
        concat!("ReceiptZeroReconciliation", "AuthorityV1"),
        concat!("HostFixedReadEvidence", "IssuerV1"),
        concat!("production", "_issuer"),
    ] {
        assert_eq!(
            source.matches(forbidden).count(),
            0,
            "forbidden source: {forbidden}"
        );
    }
    assert!(source.contains("struct DurableReceiptZeroInitializerOutcomeUnknownV1"));
    assert!(!source.contains("pub(crate) struct DurableReceiptZeroInitializerOutcomeUnknownV1"));
    assert!(source.contains("struct DurableReceiptZeroInitializerNeedsIndependentReadV1"));
    assert!(
        !source.contains("pub(crate) struct DurableReceiptZeroInitializerNeedsIndependentReadV1")
    );
    assert_eq!(source.matches("fn execute_for_test<'a>(").count(), 1);
    assert!(source.contains("self,\n        connector: ReceiptZeroPrecommitTestConnectorV1"));
    assert!(!source.contains("fn dispatch_for_test("));
    assert!(!source.contains("fn live_run_window_for_test("));
    for forbidden in [
        "DatabaseConnectorV1",
        "DatabaseSessionV1",
        "JournalBoundExecutionControlV1",
        "BoundParameterV1",
        "FixedStatementArtifactV1",
    ] {
        assert!(
            !source.contains(forbidden),
            "proof layer exposed precommit raw surface: {forbidden}"
        );
    }
    assert!(!source.contains("impl Clone for DurableReceiptZeroInitializerNeedsIndependentReadV1"));
    assert!(!source.contains("Serialize for DurableReceiptZeroInitializerNeedsIndependentReadV1"));
    assert!(source.contains("_dispatch: ReceiptZeroInitializerJournalDispatchV1"));
    assert!(!source.contains("fn dispatch_for_test("));
    assert!(!source.contains(concat!(
        "impl Clone for DurableReceiptZero",
        "InitializerClaimHandleV1"
    )));
    assert!(!source.contains(concat!(
        "impl std::fmt::Debug for DurableReceiptZero",
        "InitializerClaimHandleV1"
    )));
    assert!(!source.contains(concat!(
        "Serialize for DurableReceiptZero",
        "InitializerClaimHandleV1"
    )));
    assert!(!source.contains(concat!(
        "impl Clone for DurableReceiptZero",
        "InitializerOutcomeUnknownV1"
    )));
    assert!(!source.contains(concat!(
        "Serialize for DurableReceiptZero",
        "InitializerOutcomeUnknownV1"
    )));
    assert!(!source.contains(concat!(
        "impl Clone for SealedBackfillInspection",
        "SubjectProofV1"
    )));
    assert!(!source.contains(concat!(
        "Serialize for SealedBackfillInspection",
        "SubjectProofV1"
    )));
    assert_eq!(
        source
            .matches(concat!(".consume_for_", "initializer()"))
            .count(),
        1
    );
    assert!(!inspection_source.contains(concat!("#[tauri", "::command]")));
    assert!(!inspection_source.contains(concat!("reqwest", "::")));
    assert!(!inspection_source.contains(concat!("Credential", "Resolver")));
    assert!(!inspection_source.contains(concat!("TrustedOperation", "PlanV1")));
    assert!(!inspection_source.contains(concat!("CREATE ", "TABLE")));
    assert!(inspection_source.contains("#[cfg(test)]\n    pub(crate) fn issue_material_for_test("));
}
