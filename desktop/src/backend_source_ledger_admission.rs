//! Private composition boundary for durable source-ledger receipt-zero admission.
//!
//! This dormant module has no Tauri command, network or credential client, fixed-read issuer,
//! database transport, mutation runner, Receipt V2 issuer, or release transition. It consumes one
//! native cryptographic verification handle and asks the native journal to persist a Claimed-only
//! replay fence. The returned capability is process-local, one-shot, and TTL-bounded by the
//! journal; dropping or expiring it never removes the durable fence.

#![allow(dead_code)]

use std::sync::{Arc, Weak};

use crate::{
    backend_operation_journal::{
        BackendOperationJournalV1, JournalError, SourceLedgerAdmissionClaimV1,
    },
    backend_source_ledger_receipt_verifier::{
        TrustedReceiptExpectationV1, VerificationError, VerifiedSourceLedgerReceiptHandleV1,
    },
};

#[cfg(test)]
use crate::{
    backend_operation_journal::ConsumedSourceLedgerAdmissionClaimV1,
    backend_source_ledger_receipt_verifier::SourceLedgerAdmissionClaimMaterialV1,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum BackendSourceLedgerAdmissionErrorV1 {
    ReceiptRejected,
    ReplayBlocked,
    CapacityExceeded,
    DurabilityUnconfirmed,
    HandleExpired,
    Unavailable,
}

pub(crate) struct BackendSourceLedgerAdmissionV1 {
    journal: Arc<BackendOperationJournalV1>,
}

impl BackendSourceLedgerAdmissionV1 {
    pub(crate) fn new(journal: Arc<BackendOperationJournalV1>) -> Self {
        Self { journal }
    }

    pub(crate) fn admit(
        &self,
        verified_receipt: VerifiedSourceLedgerReceiptHandleV1,
        expected: &TrustedReceiptExpectationV1,
    ) -> Result<DurableSourceLedgerAdmissionHandleV1, BackendSourceLedgerAdmissionErrorV1> {
        let consumed = verified_receipt
            .consume_for_admission(expected)
            .map_err(map_verification_error)?;
        let claim = self
            .journal
            .claim_source_ledger_admission(consumed)
            .map_err(map_journal_error)?;
        Ok(DurableSourceLedgerAdmissionHandleV1 {
            journal: Arc::downgrade(&self.journal),
            claim: Some(claim),
        })
    }

    #[cfg(test)]
    pub(crate) fn admit_material_for_test(
        &self,
        material: SourceLedgerAdmissionClaimMaterialV1,
    ) -> Result<DurableSourceLedgerAdmissionHandleV1, BackendSourceLedgerAdmissionErrorV1> {
        let claim = self
            .journal
            .claim_source_ledger_admission_material_for_test(material)
            .map_err(map_journal_error)?;
        Ok(DurableSourceLedgerAdmissionHandleV1 {
            journal: Arc::downgrade(&self.journal),
            claim: Some(claim),
        })
    }
}

/// Test-only sealed handoff of the complete durable source-admission binding.
#[cfg(test)]
pub(crate) struct ConsumedDurableSourceLedgerAdmissionForInitializerV1 {
    journal: Weak<BackendOperationJournalV1>,
    claim: ConsumedSourceLedgerAdmissionClaimV1,
}

#[cfg(test)]
impl ConsumedDurableSourceLedgerAdmissionForInitializerV1 {
    pub(crate) fn material_for_composition(&self) -> &SourceLedgerAdmissionClaimMaterialV1 {
        self.claim.material_for_composition()
    }

    pub(crate) fn belongs_to_journal(&self, journal: &Arc<BackendOperationJournalV1>) -> bool {
        self.journal
            .upgrade()
            .is_some_and(|bound| Arc::ptr_eq(&bound, journal))
    }
}

/// Opaque receipt-zero admission capability. It deliberately has no
/// Clone/Debug/Serialize/Deserialize implementation and exposes no production transition method.
pub(crate) struct DurableSourceLedgerAdmissionHandleV1 {
    journal: Weak<BackendOperationJournalV1>,
    claim: Option<SourceLedgerAdmissionClaimV1>,
}

impl DurableSourceLedgerAdmissionHandleV1 {
    pub(crate) const fn cryptographically_verified(&self) -> bool {
        true
    }

    pub(crate) const fn durably_admitted(&self) -> bool {
        true
    }

    pub(crate) const fn database_authority_created(&self) -> bool {
        false
    }

    pub(crate) const fn mutation_authorized(&self) -> bool {
        false
    }

    pub(crate) const fn execution_authorized(&self) -> bool {
        false
    }

    pub(crate) const fn receipt_v2_issued(&self) -> bool {
        false
    }

    pub(crate) const fn release_authorized(&self) -> bool {
        false
    }

    #[cfg(test)]
    pub(crate) fn consume_for_test(mut self) -> Result<(), BackendSourceLedgerAdmissionErrorV1> {
        self.consume_claim_for_initializer_for_test().map(drop)
    }

    #[cfg(test)]
    pub(crate) fn consume_for_initializer_for_test(
        mut self,
    ) -> Result<
        ConsumedDurableSourceLedgerAdmissionForInitializerV1,
        BackendSourceLedgerAdmissionErrorV1,
    > {
        self.consume_claim_for_initializer_for_test()
    }

    #[cfg(test)]
    fn consume_claim_for_initializer_for_test(
        &mut self,
    ) -> Result<
        ConsumedDurableSourceLedgerAdmissionForInitializerV1,
        BackendSourceLedgerAdmissionErrorV1,
    > {
        let claim = self
            .claim
            .take()
            .ok_or(BackendSourceLedgerAdmissionErrorV1::Unavailable)?;
        let journal = self
            .journal
            .upgrade()
            .ok_or(BackendSourceLedgerAdmissionErrorV1::Unavailable)?;
        let claim = journal
            .consume_source_ledger_admission_for_test(claim)
            .map_err(map_journal_error)?;
        Ok(ConsumedDurableSourceLedgerAdmissionForInitializerV1 {
            journal: Arc::downgrade(&journal),
            claim,
        })
    }
}

fn map_verification_error(_: VerificationError) -> BackendSourceLedgerAdmissionErrorV1 {
    BackendSourceLedgerAdmissionErrorV1::ReceiptRejected
}

fn map_journal_error(error: JournalError) -> BackendSourceLedgerAdmissionErrorV1 {
    match error {
        JournalError::Conflict | JournalError::ScopeConflict => {
            BackendSourceLedgerAdmissionErrorV1::ReplayBlocked
        }
        JournalError::Full => BackendSourceLedgerAdmissionErrorV1::CapacityExceeded,
        JournalError::DurabilityUnconfirmed => {
            BackendSourceLedgerAdmissionErrorV1::DurabilityUnconfirmed
        }
        JournalError::CapabilityExpired | JournalError::CapabilityMissing => {
            BackendSourceLedgerAdmissionErrorV1::HandleExpired
        }
        JournalError::Unavailable
        | JournalError::Invalid
        | JournalError::Corrupt
        | JournalError::InvalidState
        | JournalError::LeaseActive => BackendSourceLedgerAdmissionErrorV1::Unavailable,
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn source_declares_no_external_or_mutation_authority() {
        let source = include_str!("backend_source_ledger_admission.rs");
        for forbidden in [
            concat!("#[tauri", "::command]"),
            concat!("reqwest", "::"),
            concat!("Credential", "Resolver"),
            concat!("supabase_backfill_fixed", "_read::"),
            concat!("precommit_for_", "test("),
            concat!("consume_dispatch_permit_for_", "test("),
            concat!("mark_dispatch_started_for_", "test("),
            concat!("settle_dispatch_for_", "test("),
        ] {
            assert!(!source.contains(forbidden), "forbidden source: {forbidden}");
        }
    }
}
