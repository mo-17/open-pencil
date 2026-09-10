//! Dormant native Supabase Automation idempotency CAS contracts.
//!
//! Production builds compile the private fixed-statement precommit and bounded one-shot runner so
//! the reviewed SQL, parameter schema, transaction ordering, and ambiguous-commit behavior cannot
//! drift behind a test-only sketch. There is deliberately no production constructor, caller,
//! credential resolver, database adapter, Tauri command, queue hook, Receipt issuer, or release
//! authority.

#![allow(dead_code)]

mod precommit;
mod reconciliation;
mod recovery;

#[cfg(test)]
pub(crate) use precommit::rendered_sql_digest_for_recovery;
#[cfg(test)]
pub(crate) use reconciliation::{PARAMETER_SCHEMA_DIGEST, RECONCILIATION_QUERY_DIGEST};
pub(crate) use recovery::{
    validate_automation_cas_recovery_material, AutomationCasRecoveryMaterialV1,
    SealedAutomationCasRecoveryReviewProofV1, AUTOMATION_CAS_RECOVERY_PLAN_FORMAT,
    AUTOMATION_CAS_RECOVERY_PROGRESS_FORMAT,
};
