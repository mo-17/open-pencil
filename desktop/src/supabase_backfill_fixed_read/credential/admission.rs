//! Test-only current-credential admission for the sealed Host read connector.
//!
//! Both checks are synchronous and must run on the Host's blocking executor, outside database
//! future polling, with the original execution deadline checked before and after each await.
//! The initial snapshot checks local profile consistency, not remote project/account authority.
//! The final snapshot detects an observed rotation; there is no pending-session revocation,
//! generation notification, timer, or protection against another process restoring all five
//! original values between checks. Historical installation grants never enter this module.

use super::{
    read_current_database_read_credential_snapshot_from, DatabaseReadCredentialSnapshotError,
    DatabaseReadCredentialSnapshotV1, SupabaseDatabaseReadConnectionProfileV1,
};
use crate::credentials::CredentialVault;

/// Data-free failure values. No variant carries a password, profile, account, or grant value.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum DatabaseReadCredentialAdmissionErrorV1 {
    Snapshot(DatabaseReadCredentialSnapshotError),
    IdentityMismatch,
    Changed,
}

impl From<DatabaseReadCredentialSnapshotError> for DatabaseReadCredentialAdmissionErrorV1 {
    fn from(error: DatabaseReadCredentialSnapshotError) -> Self {
        Self::Snapshot(error)
    }
}

/// Owns the current snapshot and its exact vault instance. No caller-supplied vault/source can
/// replace it during final verification; CredentialVault::clone preserves its process lock.
/// This is local credential consistency evidence only, with no read or settlement authority.
#[must_use]
pub(crate) struct DatabaseReadCredentialAdmissionV1 {
    vault: CredentialVault,
    snapshot: DatabaseReadCredentialSnapshotV1,
}

impl DatabaseReadCredentialAdmissionV1 {
    /// The recovery composition derives these two expected values from opaque journal material.
    /// No current or historical grant hint is accepted: all five current values come from one
    /// atomic vault snapshot. A separately consumed journal window still authorizes the attempt.
    pub(crate) fn admit_for_test(
        vault: CredentialVault,
        expected_project_ref: &str,
        expected_account_id: &str,
    ) -> Result<Self, DatabaseReadCredentialAdmissionErrorV1> {
        let snapshot = read_current_database_read_credential_snapshot_from(&vault)?;
        let profile = snapshot.connection_profile();
        if profile.project_ref() != expected_project_ref
            || profile.account_id() != expected_account_id
        {
            return Err(DatabaseReadCredentialAdmissionErrorV1::IdentityMismatch);
        }
        Ok(Self { vault, snapshot })
    }

    /// Borrowed only by the independently sealed Host connector. The view cannot outlive this
    /// admission or detach its zeroizing secret; it has no constructor, Clone, Debug, or serde.
    pub(crate) fn connection_inputs_for_test(
        &self,
    ) -> DatabaseReadCredentialConnectionInputsV1<'_> {
        DatabaseReadCredentialConnectionInputsV1 {
            snapshot: &self.snapshot,
        }
    }

    /// The second and final atomic check consumes admission, including on error. Call only after
    /// the fixed read has finished, before publishing its observation, without resetting any
    /// execution clock. Dropping an admission never performs I/O or creates a reusable permit.
    pub(crate) fn finish_for_test(self) -> Result<(), DatabaseReadCredentialAdmissionErrorV1> {
        let current = read_current_database_read_credential_snapshot_from(&self.vault)?;
        if current.password() != self.snapshot.password()
            || current.connection_profile() != self.snapshot.connection_profile()
            || current.grant_generation() != self.snapshot.grant_generation()
            || current.credential_incarnation() != self.snapshot.credential_incarnation()
            || current.connection_profile_digest() != self.snapshot.connection_profile_digest()
        {
            return Err(DatabaseReadCredentialAdmissionErrorV1::Changed);
        }
        Ok(())
    }
}

/// The fixed connector may borrow exactly the admitted profile and password. Additional getters
/// expose only this snapshot's local identity witnesses for connector binding; none authenticate
/// the remote account, project, or historical installation.
pub(crate) struct DatabaseReadCredentialConnectionInputsV1<'a> {
    snapshot: &'a DatabaseReadCredentialSnapshotV1,
}

impl<'a> DatabaseReadCredentialConnectionInputsV1<'a> {
    pub(crate) fn connection_profile(&self) -> &'a SupabaseDatabaseReadConnectionProfileV1 {
        self.snapshot.connection_profile()
    }

    pub(crate) fn password(&self) -> &'a str {
        self.snapshot.password()
    }

    pub(crate) fn grant_generation(&self) -> &'a str {
        self.snapshot.grant_generation()
    }

    pub(crate) fn credential_incarnation(&self) -> [u8; 32] {
        self.snapshot.credential_incarnation()
    }

    pub(crate) fn connection_profile_digest(&self) -> [u8; 32] {
        self.snapshot.connection_profile_digest()
    }
}

#[cfg(test)]
mod tests;
