use super::*;
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
fn production_source_has_no_constructor_transport_credential_or_external_entrypoint() {
    let source = include_str!("../precommit.rs");
    let runner_source = include_str!("runner.rs");
    let parent = include_str!("../../backend_automation_idempotency_cas.rs");
    let lib = include_str!("../../lib.rs");
    let production = source
        .split_once("#[cfg(test)]\nmod source_tests;")
        .expect("test boundary")
        .0;
    assert!(lib.contains("mod backend_automation_idempotency_cas;"));
    assert_eq!(lib.matches("backend_automation_idempotency_cas").count(), 1);
    assert!(!lib.contains("pub mod backend_automation_idempotency_cas;"));
    assert!(!lib.contains("#[cfg(test)]\nmod backend_automation_idempotency_cas;"));
    assert!(parent.contains("#![allow(dead_code)]"));
    assert!(production.contains("mod runner;"));
    assert!(runner_source.contains("trait DatabaseSessionV1: Send"));
    assert!(runner_source.contains("fn begin_serializable_read_write"));
    assert!(runner_source.contains("fn set_local_row_security_off"));
    assert!(runner_source.contains("fn set_local_synchronous_commit_on"));
    assert!(runner_source.contains("fn set_local_lock_timeout_ms"));
    assert!(runner_source.contains("struct QueryColumnV1"));
    assert!(runner_source.contains("column.name != \"status\""));
    assert!(runner_source.contains("DatabaseColumnTypeV1::Text"));
    assert!(runner_source.contains("async fn run<D: DatabaseSessionV1>"));
    assert!(runner_source.contains("#[cfg(test)]\n    pub(super) fn issue_for_test("));
    assert!(runner_source.contains("guard.abort_only();"));
    assert!(runner_source.contains("CommitOutcomeUnknown"));
    assert!(!runner_source.contains("impl DatabaseSessionV1 for"));
    assert_eq!(
        REMAINING_PRODUCTION_BLOCKERS,
        &[
            "production-constructor-unavailable",
            "operation-journal-precommit-unavailable",
            "credential-lease-unavailable",
            "database-adapter-unavailable",
            "wire-response-bounds-unavailable",
            "server-cancellation-not-certified",
            "commit-outcome-reconciliation-unavailable",
            "response-authentication-unavailable",
            "database-cas-readback-unavailable",
            "receipt-v2-issuer-unavailable",
            "release-authority-unavailable",
        ]
    );
    for forbidden in [
        concat!("#[tauri", "::command]"),
        concat!("reqwest", "::"),
        concat!("tokio_postgres", "::"),
        concat!("sqlx", "::"),
        concat!("Credential", "Resolver"),
        concat!("service", "_role"),
        concat!("production", "_issuer"),
        concat!("TrustedOperation", "PlanV1"),
    ] {
        assert!(
            !parent.contains(forbidden)
                && !production.contains(forbidden)
                && !runner_source.contains(forbidden),
            "forbidden production source: {forbidden}"
        );
    }
    assert!(!runner_source.contains("impl Clone for AutomationIdempotencyCasPrecommitContractV1"));
    assert!(!runner_source.contains("Serialize for AutomationIdempotencyCasPrecommitContractV1"));
}

#[test]
fn production_topology_has_no_hidden_caller_or_authority_wiring() {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repository = manifest.parent().expect("repository root");
    let module_root = manifest.join("src/backend_automation_idempotency_cas.rs");
    let module_directory = manifest.join("src/backend_automation_idempotency_cas");
    let operation_journal = manifest.join("src/backend_operation_journal.rs");
    let lib = manifest.join("src/lib.rs");
    let mut unexpected = Vec::new();
    for root in [
        repository.join("src"),
        repository.join("packages"),
        manifest.join("src"),
        repository.join("extensions"),
    ] {
        scan_source_files(&root, &mut |path, source| {
            let allowed = path == module_root
                || path == lib
                || path == operation_journal
                || path.starts_with(&module_directory);
            if !allowed
                && (source.contains("backend_automation_idempotency_cas")
                    || source.contains("AutomationIdempotencyCasPrecommitContractV1"))
            {
                unexpected.push(path.to_path_buf());
            }
        });
    }
    assert!(
        unexpected.is_empty(),
        "unexpected CAS wiring: {unexpected:?}"
    );
    let journal_source = fs::read_to_string(operation_journal).expect("journal remains UTF-8");
    assert!(!journal_source.contains("backend_automation_idempotency_cas::precommit"));
    assert!(!journal_source.contains("AutomationIdempotencyCasPrecommitContractV1"));
}
