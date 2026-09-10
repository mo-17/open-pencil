use std::{fs, path::Path};

fn assert_opaque_handle_has_no_copy_or_wire_derives(source: &str, type_name: &str) {
    let declaration = format!("struct {type_name}");
    let declaration_offset = source
        .find(&declaration)
        .expect("opaque type remains present");
    let declaration_prefix = &source[..declaration_offset];
    let attributes_and_docs = declaration_prefix
        .rsplit_once("\n\n")
        .map_or(declaration_prefix, |(_, suffix)| suffix);
    for forbidden in ["Clone", "Copy", "Deserialize", "Serialize"] {
        assert!(
            !attributes_and_docs.contains(forbidden),
            "{type_name} must not derive {forbidden}"
        );
    }
}

fn scan_rust_sources(root: &Path, visit: &mut impl FnMut(&Path, &str)) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            if matches!(
                path.file_name().and_then(|value| value.to_str()),
                Some("target" | ".git" | "node_modules" | "dist" | "coverage")
            ) {
                continue;
            }
            scan_rust_sources(&path, visit);
        } else if path.extension().and_then(|value| value.to_str()) == Some("rs") {
            let source = fs::read_to_string(&path).expect("Rust source remains UTF-8");
            visit(&path, &source);
        }
    }
}

#[test]
fn recovery_topology_is_private_dormant_and_has_no_settlement_surface() {
    let parent = include_str!("../../backend_automation_idempotency_cas.rs");
    let recovery = include_str!("../recovery.rs");
    let journal = include_str!("../../backend_operation_journal.rs");

    assert_eq!(parent.matches("mod recovery;").count(), 1);
    assert!(!parent.contains("pub mod recovery"));
    assert!(recovery.contains("#[cfg(test)]\nmod source_tests;"));
    assert!(recovery.contains("#[cfg(test)]\nmod tests;"));
    assert!(recovery.contains("#[cfg(test)]\n    pub(crate) fn issue_for_test("));
    assert!(recovery.contains("#[cfg(test)]\n    pub(crate) fn recover_for_test("));
    assert!(
        recovery.contains("#[cfg(test)]\n    pub(crate) fn precommit_outcome_unknown_for_test(")
    );
    assert!(recovery.contains(
        "#[cfg(test)]\nimpl DurableAutomationCasRecoveryV1 {\n    pub(crate) fn begin_for_test("
    ));
    assert!(recovery.contains(
        "#[cfg(test)]\nimpl DurableAutomationCasReconciliationPermitV1 {\n    pub(crate) fn consume_for_fixed_read_for_test("
    ));

    for opaque_type in [
        "SealedAutomationCasRecoveryReviewProofV1",
        "DurableAutomationCasClaimV1",
        "DurableAutomationCasOutcomeUnknownV1",
        "DurableAutomationCasRecoveryV1",
        "DurableAutomationCasReconciliationPermitV1",
        "DurableAutomationCasReadAttemptV1",
    ] {
        assert_opaque_handle_has_no_copy_or_wire_derives(recovery, opaque_type);
    }

    for forbidden in [
        "ReconciliationStatusV1",
        "reported_status",
        "reportedStatus",
        "fn settle",
        "settle_automation_cas",
        "complete_automation_cas",
        "mark_automation_cas_applied",
        "mark_automation_cas_known_not_dispatched",
        "retry_automation_cas",
        "impl Clone for SealedAutomationCasRecoveryReviewProofV1",
        "impl Clone for DurableAutomationCasClaimV1",
        "impl Clone for DurableAutomationCasRecoveryV1",
        "impl Clone for DurableAutomationCasReconciliationPermitV1",
        "impl Clone for DurableAutomationCasReadAttemptV1",
        concat!("#[tauri", "::command]"),
        concat!("reqwest", "::"),
        concat!("tokio_postgres", "::"),
        concat!("sqlx", "::"),
        concat!("Credential", "Resolver"),
        concat!("automatic", "_retry_allowed: true"),
        concat!("release", "_authorized: true"),
    ] {
        assert!(
            !recovery.contains(forbidden),
            "forbidden recovery authority surface: {forbidden}"
        );
    }

    for raw_status in [
        "\"absent\"",
        "\"inserted\"",
        "\"exact-replay\"",
        "\"advanced-head\"",
        "\"cas-conflict\"",
        "\"corruption\"",
        "\"precondition-failed\"",
    ] {
        assert!(
            !recovery.contains(raw_status),
            "raw database status must not become settlement input: {raw_status}"
        );
        assert!(
            !journal.contains(raw_status),
            "raw database status must not enter the journal facade: {raw_status}"
        );
    }

    for forbidden_journal_surface in [
        "settle_automation_cas",
        "complete_automation_cas",
        "AutomationCasJournalSettlement",
        "AutomationCasReconciliationStatus",
    ] {
        assert!(
            !journal.contains(forbidden_journal_surface),
            "journal must not expose Automation CAS settlement: {forbidden_journal_surface}"
        );
    }
}

#[test]
fn recovery_has_no_production_caller_or_hidden_adapter() {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let recovery = manifest.join("src/backend_automation_idempotency_cas/recovery.rs");
    let recovery_directory = manifest.join("src/backend_automation_idempotency_cas/recovery");
    let module_root = manifest.join("src/backend_automation_idempotency_cas.rs");
    let journal = manifest.join("src/backend_operation_journal.rs");
    let composition = manifest
        .join("src/backend_automation_idempotency_cas/reconciliation/recovery_composition.rs");
    let composition_tests =
        manifest.join("src/backend_automation_idempotency_cas/reconciliation/tests.rs");
    let composition_source_tests =
        manifest.join("src/backend_automation_idempotency_cas/reconciliation/source_tests.rs");
    let mut unexpected = Vec::new();
    scan_rust_sources(&manifest.join("src"), &mut |path, source| {
        let allowed = path == recovery
            || path == module_root
            || path == journal
            || path == composition
            || path == composition_tests
            || path == composition_source_tests
            || path.starts_with(&recovery_directory);
        if !allowed
            && (source.contains("AutomationCasRecoveryCoordinatorV1")
                || source.contains("SealedAutomationCasRecoveryReviewProofV1")
                || source.contains("DurableAutomationCasReadAttemptV1"))
        {
            unexpected.push(path.to_path_buf());
        }
    });
    assert!(
        unexpected.is_empty(),
        "unexpected production recovery wiring: {unexpected:?}"
    );
}
