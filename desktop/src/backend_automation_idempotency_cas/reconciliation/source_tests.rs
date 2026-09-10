use super::runner::*;
use std::{fs, path::Path};

fn scan_source_files(root: &Path, visit: &mut impl FnMut(&Path, &str)) {
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
                Some("node_modules" | "target" | "dist" | "coverage" | ".git")
            ) {
                continue;
            }
            scan_source_files(&path, visit);
            continue;
        }
        let supported = path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| {
                matches!(value, "rs" | "ts" | "tsx" | "vue" | "js" | "mjs" | "cjs")
            });
        if supported {
            let source = fs::read_to_string(&path).expect("source file remains UTF-8");
            visit(&path, &source);
        }
    }
}

#[test]
fn production_topology_is_private_dormant_and_adapter_free() {
    let parent = include_str!("../../backend_automation_idempotency_cas.rs");
    let module = include_str!("../reconciliation.rs");
    let runner = include_str!("runner.rs");
    let lib = include_str!("../../lib.rs");

    assert!(lib.contains("mod backend_automation_idempotency_cas;"));
    assert_eq!(lib.matches("backend_automation_idempotency_cas").count(), 1);
    assert!(parent.contains("mod reconciliation;"));
    assert_eq!(parent.matches("mod reconciliation;").count(), 1);
    assert!(!parent.contains("pub mod reconciliation"));
    assert!(module.contains("mod runner;"));
    assert!(runner.contains("trait DatabaseSessionV1: Send"));
    assert!(runner.contains("fn begin_read_only"));
    assert!(runner.contains("fn set_local_search_path_pg_catalog"));
    assert!(runner.contains("fn set_local_row_security_off"));
    assert!(runner.contains("fn set_local_statement_timeout_ms"));
    assert!(runner.contains("fn prepare_fixed_statement"));
    assert!(runner.contains("fn execute_prepared"));
    assert!(runner.contains("fn finish_read_only"));
    assert!(runner.contains("cancellation before the future's first poll must never target"));
    assert!(runner.contains("#[cfg(test)]\n    pub(super) fn issue_for_test("));
    assert!(runner.contains("#[cfg(test)]\npub(super) struct TestingReviewBindingInputV1"));
    assert!(!runner.contains("impl DatabaseSessionV1 for"));
    assert!(!runner.contains("impl Clone for AutomationReconciliationContractV1"));
    assert!(!runner.contains("Serialize for AutomationReconciliationContractV1"));

    for forbidden in [
        concat!("#[tauri", "::command]"),
        concat!("reqwest", "::"),
        concat!("tokio_postgres", "::"),
        concat!("sqlx", "::"),
        concat!("Credential", "Resolver"),
        concat!("service", "_role"),
        concat!("production", "_issuer"),
        concat!("automatic", "_retry_allowed: true"),
        concat!("release", "_authorized: true"),
    ] {
        assert!(
            !module.contains(forbidden) && !runner.contains(forbidden),
            "forbidden production source: {forbidden}"
        );
    }

    assert_eq!(READ_LIMITS.access_mode, "read-only");
    assert_eq!(READ_LIMITS.maximum_response_rows, 1);
    assert_eq!(READ_LIMITS.maximum_response_columns, 1);
    assert_eq!(READ_LIMITS.maximum_response_bytes, 128 * 1_024);
}

#[test]
fn production_topology_has_no_hidden_reconciliation_caller_or_authority_wiring() {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repository = manifest.parent().expect("repository root");
    let module_root = manifest.join("src/backend_automation_idempotency_cas.rs");
    let module_directory = manifest.join("src/backend_automation_idempotency_cas");
    let lib = manifest.join("src/lib.rs");
    let mut unexpected = Vec::new();
    for root in [
        repository.join("src"),
        repository.join("packages"),
        manifest.join("src"),
        repository.join("extensions"),
    ] {
        scan_source_files(&root, &mut |path, source| {
            let allowed = path == module_root || path == lib || path.starts_with(&module_directory);
            if !allowed
                && (source.contains("backend_automation_idempotency_cas::reconciliation")
                    || source.contains("AutomationReconciliationContractV1")
                    || source.contains("TestingReviewBindingInputV1"))
            {
                unexpected.push(path.to_path_buf());
            }
        });
    }
    assert!(
        unexpected.is_empty(),
        "unexpected Automation reconciliation wiring: {unexpected:?}"
    );
}

#[test]
fn recovered_runner_composition_is_fused_test_only_and_authority_free() {
    let module = include_str!("../reconciliation.rs");
    let composition = include_str!("recovery_composition.rs");

    assert!(module.contains("#[cfg(test)]\nmod recovery_composition;"));
    assert_eq!(module.matches("mod recovery_composition;").count(), 1);
    assert!(composition.contains(
        "pub(super) async fn run_recovered_fixed_read_for_test<D: DatabaseSessionV1>(\n    recovery: DurableAutomationCasRecoveryV1,"
    ));
    assert!(composition.contains("let permit = recovery.begin_for_test()?;"));
    assert!(composition.contains("let attempt = permit.consume_for_fixed_read_for_test()?;"));
    assert!(composition.contains("drop(attempt);"));
    assert!(!composition.contains("DurableAutomationCasReconciliationPermitV1"));
    assert!(!composition.contains("DurableAutomationCasReadAttemptV1"));

    for forbidden in [
        "unsafe",
        "transmute",
        "ManuallyDrop",
        "mem::forget",
        "impl Clone for DurableAutomationCas",
        "impl Copy for DurableAutomationCas",
        "impl Debug for DurableAutomationCas",
        "Serialize for DurableAutomationCas",
        "Deserialize for DurableAutomationCas",
        "fn settle",
        concat!("#[tauri", "::command]"),
        concat!("reqwest", "::"),
        concat!("tokio_postgres", "::"),
        concat!("sqlx", "::"),
        concat!("Credential", "Resolver"),
        concat!("automatic", "_retry_allowed: true"),
        concat!("release", "_authorized: true"),
    ] {
        assert!(
            !composition.contains(forbidden),
            "forbidden recovered runner composition source: {forbidden}"
        );
    }
}
