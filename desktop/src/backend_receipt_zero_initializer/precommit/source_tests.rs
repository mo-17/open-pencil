use super::*;

#[test]
fn production_source_has_no_constructor_transport_credential_or_external_entrypoint() {
    let source = include_str!("../precommit.rs");
    let runner_source = include_str!("runner.rs");
    let parent = include_str!("../../backend_receipt_zero_initializer.rs");
    let lib = include_str!("../../lib.rs");
    let production = source
        .split_once("#[cfg(test)]\nmod composition_harness;")
        .expect("test boundary")
        .0;
    assert!(lib.contains("mod backend_receipt_zero_initializer;"));
    assert_eq!(lib.matches("backend_receipt_zero_initializer").count(), 1);
    assert!(!lib.contains("#[cfg(test)]\nmod backend_receipt_zero_initializer;"));
    assert!(!parent.contains("mod proof_composition"));
    assert!(source.contains("#[path = \"proof_composition.rs\"]\nmod proof_composition;"));
    assert!(!production.contains("mod proof_composition"));
    for private_entry in [
        "fn prepare_initializer_precommit_for_test(",
        "fn capture_initializer_precommit_clock_for_test(",
        "async fn run_prepared_initializer_precommit_for_test(",
    ] {
        assert!(source.contains(private_entry));
        assert!(!source.contains(&format!("pub(super) {private_entry}")));
        assert!(!source.contains(&format!("pub(crate) {private_entry}")));
    }
    assert!(production.contains("mod runner;"));
    assert!(production.contains("const SQL_SOURCE: &str = include_str!("));
    assert!(production.contains(
        "../../../src/app/plugins/host/deployment/supabase/backfill/receipt/zero/cas/v1.sql"
    ));
    for forbidden in [
        "REVIEW_TYPESCRIPT_SOURCE",
        "SQL_START_MARKER",
        "SQL_END_MARKER",
        ".split_once(SQL_START_MARKER)",
    ] {
        assert!(
            !production.contains(forbidden),
            "forbidden SQL extraction source: {forbidden}"
        );
    }
    assert!(runner_source.contains("trait DatabaseSessionV1: Send"));
    assert!(runner_source.contains("fn begin_serializable_read_write"));
    assert!(runner_source.contains("fn set_local_row_security_off"));
    assert!(runner_source.contains("fn set_local_synchronous_commit_on"));
    assert!(runner_source.contains("fn set_local_lock_timeout_ms"));
    assert!(runner_source.contains("async fn run<D: DatabaseSessionV1>"));
    assert!(runner_source.contains("#[cfg(test)]\n    pub(super) fn issue_for_test("));
    assert!(!runner_source.contains("impl DatabaseSessionV1 for"));
    assert_eq!(
        REMAINING_PRODUCTION_BLOCKERS,
        &[
            "production-constructor-unavailable",
            "journal-outcome-unknown-precommit-unavailable",
            "capture-consumption-unavailable",
            "credential-lease-unavailable",
            "database-adapter-unavailable",
            "server-cancellation-not-certified",
            "candidate-commit-time-untrusted",
            "response-authentication-unavailable",
            "receipt-v2-issuer-unavailable",
            "reconciliation-settlement-recovery-unavailable",
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
            !production.contains(forbidden) && !runner_source.contains(forbidden),
            "forbidden source: {forbidden}"
        );
    }
    assert!(!runner_source.contains("impl Clone for ReceiptZeroPrecommitContractV1"));
    assert!(!runner_source.contains("Serialize for ReceiptZeroPrecommitContractV1"));
}
