//! Dormant read-only reconciliation kernel for Automation idempotency CAS outcomes.
//!
//! This module intentionally has no production constructor, database adapter, credential source,
//! transport, retry policy, Receipt issuer, or release authority. The settled TypeScript SQL bytes,
//! rendered-schema contract, 27 parameters, and exact JSON observation contract are pinned here.

pub(crate) const PARAMETER_SCHEMA_DIGEST: &str = "taJAW2qi1kDuxEugl0T9SFxB8lkd-jusuMbXPFKeAwA";
pub(crate) const RECONCILIATION_QUERY_DIGEST: &str = "mXwTayykW-yrJK64vm6SL6vkbMPeAikl964WxRqM01I";

mod runner;

#[cfg(test)]
mod recovery_composition;
#[cfg(test)]
mod source_tests;
#[cfg(test)]
mod tests;
