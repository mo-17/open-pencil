//! Host-only mutation lifecycle for the dormant database-read credential.
//!
//! This module has no Tauri command or renderer bridge. It validates the fixed non-secret profile,
//! creates fresh Host markers, and replaces the five encrypted vault records through one CAS-backed
//! vault persistence operation. The database password is never returned by this API.

use super::{
    credential::{
        DATABASE_READ_CONNECTION_PROFILE_ACCOUNT, DATABASE_READ_CONNECTION_PROFILE_DIGEST_ACCOUNT,
        DATABASE_READ_CREDENTIAL_INCARNATION_ACCOUNT, DATABASE_READ_PASSWORD_ACCOUNT,
        MAXIMUM_DATABASE_READ_PASSWORD_BYTES, SHARED_GRANT_GENERATION_ACCOUNT,
    },
    profile::parse_supabase_database_read_connection_profile_v1,
    valid_uuid_v4,
};
use crate::credentials::{
    CredentialVault, CredentialVaultCommitDurability, CredentialVaultCompareExchangeError,
    CredentialVaultRecordMutation,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ring::rand::{SecureRandom, SystemRandom};
use std::fmt::Write as _;
use zeroize::Zeroizing;

const MARKER_BYTES: usize = 32;
const GENERATION_BYTES: usize = 16;
const ENTROPY_ATTEMPTS: usize = 4;

/// Non-secret result of an atomic credential generation change.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct DatabaseReadCredentialMutationReceiptV1 {
    configured: bool,
    commit_durability: CredentialVaultCommitDurability,
    grant_generation: String,
    credential_incarnation: [u8; MARKER_BYTES],
    connection_profile_digest: Option<[u8; MARKER_BYTES]>,
}

impl DatabaseReadCredentialMutationReceiptV1 {
    pub(crate) const fn configured(&self) -> bool {
        self.configured
    }

    pub(crate) const fn commit_durability(&self) -> CredentialVaultCommitDurability {
        self.commit_durability
    }

    pub(crate) fn grant_generation(&self) -> &str {
        &self.grant_generation
    }

    pub(crate) const fn credential_incarnation(&self) -> [u8; MARKER_BYTES] {
        self.credential_incarnation
    }

    pub(crate) const fn connection_profile_digest(&self) -> Option<[u8; MARKER_BYTES]> {
        self.connection_profile_digest
    }
}

/// Data-free failures: caller-controlled profile, password, and marker values are never retained.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum DatabaseReadCredentialMutationError {
    InvalidGrantGeneration,
    InvalidPassword,
    InvalidConnectionProfile,
    EntropyUnavailable,
    CredentialUnavailable,
    CredentialChanged,
    CredentialFailed,
}

trait LifecycleEntropy {
    fn fill(&self, destination: &mut [u8]) -> Result<(), ()>;
}

struct SystemLifecycleEntropy(SystemRandom);

impl LifecycleEntropy for SystemLifecycleEntropy {
    fn fill(&self, destination: &mut [u8]) -> Result<(), ()> {
        self.0.fill(destination).map_err(|_| ())
    }
}

pub(crate) fn replace_database_read_credential_v1(
    vault: &CredentialVault,
    expected_grant_generation: &str,
    password: Zeroizing<String>,
    raw_connection_profile: impl AsRef<[u8]>,
) -> Result<DatabaseReadCredentialMutationReceiptV1, DatabaseReadCredentialMutationError> {
    replace_database_read_credential_with_entropy(
        vault,
        expected_grant_generation,
        password,
        raw_connection_profile.as_ref(),
        &SystemLifecycleEntropy(SystemRandom::new()),
    )
}

pub(crate) fn clear_database_read_credential_v1(
    vault: &CredentialVault,
    expected_grant_generation: &str,
) -> Result<DatabaseReadCredentialMutationReceiptV1, DatabaseReadCredentialMutationError> {
    clear_database_read_credential_with_entropy(
        vault,
        expected_grant_generation,
        &SystemLifecycleEntropy(SystemRandom::new()),
    )
}

fn replace_database_read_credential_with_entropy(
    vault: &CredentialVault,
    expected_grant_generation: &str,
    password: Zeroizing<String>,
    raw_connection_profile: &[u8],
    entropy: &impl LifecycleEntropy,
) -> Result<DatabaseReadCredentialMutationReceiptV1, DatabaseReadCredentialMutationError> {
    validate_expected_generation(expected_grant_generation)?;
    validate_password(&password)?;
    let profile = parse_supabase_database_read_connection_profile_v1(raw_connection_profile)
        .map_err(|_| DatabaseReadCredentialMutationError::InvalidConnectionProfile)?;
    let profile_digest = profile.digest();
    if profile_digest == [0; MARKER_BYTES] {
        return Err(DatabaseReadCredentialMutationError::InvalidConnectionProfile);
    }
    let grant_generation = next_grant_generation(entropy, expected_grant_generation)?;
    let credential_incarnation = next_nonzero_marker(entropy)?;
    let encoded_incarnation = URL_SAFE_NO_PAD.encode(credential_incarnation);
    let encoded_profile_digest = URL_SAFE_NO_PAD.encode(profile_digest);

    let commit_durability = vault
        .compare_exchange_secret_records(
            SHARED_GRANT_GENERATION_ACCOUNT,
            expected_grant_generation,
            &[
                CredentialVaultRecordMutation::write(
                    DATABASE_READ_PASSWORD_ACCOUNT,
                    password.as_str(),
                ),
                CredentialVaultRecordMutation::write(
                    DATABASE_READ_CREDENTIAL_INCARNATION_ACCOUNT,
                    &encoded_incarnation,
                ),
                CredentialVaultRecordMutation::write(
                    DATABASE_READ_CONNECTION_PROFILE_ACCOUNT,
                    profile.canonical_json(),
                ),
                CredentialVaultRecordMutation::write(
                    DATABASE_READ_CONNECTION_PROFILE_DIGEST_ACCOUNT,
                    &encoded_profile_digest,
                ),
                CredentialVaultRecordMutation::write(
                    SHARED_GRANT_GENERATION_ACCOUNT,
                    &grant_generation,
                ),
            ],
        )
        .map_err(mutation_error)?;

    Ok(DatabaseReadCredentialMutationReceiptV1 {
        configured: true,
        commit_durability,
        grant_generation,
        credential_incarnation,
        connection_profile_digest: Some(profile_digest),
    })
}

fn clear_database_read_credential_with_entropy(
    vault: &CredentialVault,
    expected_grant_generation: &str,
    entropy: &impl LifecycleEntropy,
) -> Result<DatabaseReadCredentialMutationReceiptV1, DatabaseReadCredentialMutationError> {
    validate_expected_generation(expected_grant_generation)?;
    let grant_generation = next_grant_generation(entropy, expected_grant_generation)?;
    let credential_incarnation = next_nonzero_marker(entropy)?;
    let encoded_incarnation = URL_SAFE_NO_PAD.encode(credential_incarnation);

    let commit_durability = vault
        .compare_exchange_secret_records(
            SHARED_GRANT_GENERATION_ACCOUNT,
            expected_grant_generation,
            &[
                CredentialVaultRecordMutation::remove(DATABASE_READ_PASSWORD_ACCOUNT),
                CredentialVaultRecordMutation::write(
                    DATABASE_READ_CREDENTIAL_INCARNATION_ACCOUNT,
                    &encoded_incarnation,
                ),
                CredentialVaultRecordMutation::remove(DATABASE_READ_CONNECTION_PROFILE_ACCOUNT),
                CredentialVaultRecordMutation::remove(
                    DATABASE_READ_CONNECTION_PROFILE_DIGEST_ACCOUNT,
                ),
                CredentialVaultRecordMutation::write(
                    SHARED_GRANT_GENERATION_ACCOUNT,
                    &grant_generation,
                ),
            ],
        )
        .map_err(mutation_error)?;

    Ok(DatabaseReadCredentialMutationReceiptV1 {
        configured: false,
        commit_durability,
        grant_generation,
        credential_incarnation,
        connection_profile_digest: None,
    })
}

fn validate_expected_generation(value: &str) -> Result<(), DatabaseReadCredentialMutationError> {
    if !valid_uuid_v4(value) {
        return Err(DatabaseReadCredentialMutationError::InvalidGrantGeneration);
    }
    Ok(())
}

fn validate_password(value: &str) -> Result<(), DatabaseReadCredentialMutationError> {
    if value.is_empty()
        || value.len() > MAXIMUM_DATABASE_READ_PASSWORD_BYTES
        || value.as_bytes().contains(&0)
    {
        return Err(DatabaseReadCredentialMutationError::InvalidPassword);
    }
    Ok(())
}

fn next_grant_generation(
    entropy: &impl LifecycleEntropy,
    expected: &str,
) -> Result<String, DatabaseReadCredentialMutationError> {
    for _ in 0..ENTROPY_ATTEMPTS {
        let mut bytes = [0_u8; GENERATION_BYTES];
        entropy
            .fill(&mut bytes)
            .map_err(|_| DatabaseReadCredentialMutationError::EntropyUnavailable)?;
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        let generation = uuid_string(bytes);
        if generation != expected {
            return Ok(generation);
        }
    }
    Err(DatabaseReadCredentialMutationError::EntropyUnavailable)
}

fn uuid_string(bytes: [u8; GENERATION_BYTES]) -> String {
    let mut result = String::with_capacity(36);
    for (index, byte) in bytes.into_iter().enumerate() {
        if matches!(index, 4 | 6 | 8 | 10) {
            result.push('-');
        }
        write!(&mut result, "{byte:02x}").expect("writing to a String cannot fail");
    }
    result
}

fn next_nonzero_marker(
    entropy: &impl LifecycleEntropy,
) -> Result<[u8; MARKER_BYTES], DatabaseReadCredentialMutationError> {
    for _ in 0..ENTROPY_ATTEMPTS {
        let mut marker = [0_u8; MARKER_BYTES];
        entropy
            .fill(&mut marker)
            .map_err(|_| DatabaseReadCredentialMutationError::EntropyUnavailable)?;
        if marker != [0; MARKER_BYTES] {
            return Ok(marker);
        }
    }
    Err(DatabaseReadCredentialMutationError::EntropyUnavailable)
}

fn mutation_error(
    error: CredentialVaultCompareExchangeError,
) -> DatabaseReadCredentialMutationError {
    match error {
        CredentialVaultCompareExchangeError::Unavailable => {
            DatabaseReadCredentialMutationError::CredentialUnavailable
        }
        CredentialVaultCompareExchangeError::Conflict => {
            DatabaseReadCredentialMutationError::CredentialChanged
        }
        CredentialVaultCompareExchangeError::Failed => {
            DatabaseReadCredentialMutationError::CredentialFailed
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::credentials::CredentialVaultSnapshotError;
    use crate::supabase_backfill_fixed_read::{
        read_database_read_credential_snapshot, DatabaseReadCredentialSnapshotError,
    };
    use std::{cell::RefCell, collections::VecDeque};

    const INITIAL_GENERATION: &str = "123e4567-e89b-42d3-a456-426614174000";
    const DIRECT_PROFILE: &str = r#"{"format":"openpencil.supabase-database-read-connection-profile.v1","version":1,"providerId":"supabase","environment":"staging","projectRef":"abcdefghijklmnopqrst","accountId":"account.staging_01","mode":"direct","host":"db.abcdefghijklmnopqrst.supabase.co","port":5432,"database":"postgres","user":"postgres","tlsMode":"verify-full"}"#;
    const DIRECT_PROFILE_DIGEST: &str = "4hodbEkFZompjmmZ5HCeqfAJMqz67OWIyIjrF49SwfA";

    struct DeterministicEntropy {
        chunks: RefCell<VecDeque<Vec<u8>>>,
    }

    impl DeterministicEntropy {
        fn new(chunks: impl IntoIterator<Item = Vec<u8>>) -> Self {
            Self {
                chunks: RefCell::new(chunks.into_iter().collect()),
            }
        }
    }

    impl LifecycleEntropy for DeterministicEntropy {
        fn fill(&self, destination: &mut [u8]) -> Result<(), ()> {
            let chunk = self.chunks.borrow_mut().pop_front().ok_or(())?;
            if chunk.len() != destination.len() {
                return Err(());
            }
            destination.copy_from_slice(&chunk);
            Ok(())
        }
    }

    fn test_vault(directory: &tempfile::TempDir) -> CredentialVault {
        let vault = CredentialVault::new(directory.path().to_path_buf());
        vault
            .write_secret_for_test(SHARED_GRANT_GENERATION_ACCOUNT, INITIAL_GENERATION)
            .expect("seed shared generation");
        vault
    }

    fn raw_records(
        vault: &CredentialVault,
    ) -> Result<[Option<Zeroizing<String>>; 5], CredentialVaultSnapshotError> {
        vault.read_secret_snapshot([
            DATABASE_READ_PASSWORD_ACCOUNT,
            DATABASE_READ_CREDENTIAL_INCARNATION_ACCOUNT,
            DATABASE_READ_CONNECTION_PROFILE_ACCOUNT,
            DATABASE_READ_CONNECTION_PROFILE_DIGEST_ACCOUNT,
            SHARED_GRANT_GENERATION_ACCOUNT,
        ])
    }

    #[test]
    fn replaces_all_records_atomically_and_returns_only_nonsecret_markers() {
        let directory = tempfile::tempdir().expect("temporary app data directory");
        let vault = test_vault(&directory);
        let entropy =
            DeterministicEntropy::new([vec![0x11; GENERATION_BYTES], vec![0x22; MARKER_BYTES]]);
        let password = "  database pass\tword\n ";
        let receipt = replace_database_read_credential_with_entropy(
            &vault,
            INITIAL_GENERATION,
            Zeroizing::new(password.to_owned()),
            DIRECT_PROFILE.as_bytes(),
            &entropy,
        )
        .expect("replace database-read credential");

        assert!(receipt.configured());
        assert_eq!(
            receipt.commit_durability(),
            CredentialVaultCommitDurability::Confirmed
        );
        assert_eq!(
            receipt.grant_generation(),
            "11111111-1111-4111-9111-111111111111"
        );
        assert_eq!(receipt.credential_incarnation(), [0x22; MARKER_BYTES]);
        assert_eq!(
            URL_SAFE_NO_PAD.encode(receipt.connection_profile_digest().expect("profile digest")),
            DIRECT_PROFILE_DIGEST
        );
        let [stored_password, incarnation, profile, profile_digest, generation] =
            raw_records(&vault).expect("read committed records");
        let expected_incarnation = URL_SAFE_NO_PAD.encode([0x22; MARKER_BYTES]);
        assert_eq!(
            stored_password.as_deref().map(String::as_str),
            Some(password)
        );
        assert_eq!(
            incarnation.as_deref().map(String::as_str),
            Some(expected_incarnation.as_str())
        );
        assert_eq!(
            profile.as_deref().map(String::as_str),
            Some(
                parse_supabase_database_read_connection_profile_v1(DIRECT_PROFILE)
                    .expect("valid profile")
                    .canonical_json()
            )
        );
        assert_eq!(
            profile_digest.as_deref().map(String::as_str),
            Some(DIRECT_PROFILE_DIGEST)
        );
        assert_eq!(
            generation.as_deref().map(String::as_str),
            Some(receipt.grant_generation())
        );
    }

    #[test]
    fn clear_removes_secret_and_profile_witness_and_rotates_both_markers() {
        let directory = tempfile::tempdir().expect("temporary app data directory");
        let vault = test_vault(&directory);
        let replace_entropy =
            DeterministicEntropy::new([vec![0x11; GENERATION_BYTES], vec![0x22; MARKER_BYTES]]);
        let replaced = replace_database_read_credential_with_entropy(
            &vault,
            INITIAL_GENERATION,
            Zeroizing::new("password".to_owned()),
            DIRECT_PROFILE.as_bytes(),
            &replace_entropy,
        )
        .expect("replace credential");
        let clear_entropy =
            DeterministicEntropy::new([vec![0x33; GENERATION_BYTES], vec![0x44; MARKER_BYTES]]);
        let cleared = clear_database_read_credential_with_entropy(
            &vault,
            replaced.grant_generation(),
            &clear_entropy,
        )
        .expect("clear credential");

        assert!(!cleared.configured());
        assert_eq!(
            cleared.commit_durability(),
            CredentialVaultCommitDurability::Confirmed
        );
        assert_ne!(cleared.grant_generation(), replaced.grant_generation());
        assert_eq!(cleared.credential_incarnation(), [0x44; MARKER_BYTES]);
        assert_eq!(cleared.connection_profile_digest(), None);
        let [password, incarnation, profile, profile_digest, generation] =
            raw_records(&vault).expect("read cleared records");
        let expected_incarnation = URL_SAFE_NO_PAD.encode([0x44; MARKER_BYTES]);
        assert!(password.is_none());
        assert!(profile.is_none());
        assert!(profile_digest.is_none());
        assert_eq!(
            incarnation.as_deref().map(String::as_str),
            Some(expected_incarnation.as_str())
        );
        assert_eq!(
            generation.as_deref().map(String::as_str),
            Some(cleared.grant_generation())
        );
    }

    #[test]
    fn stale_compare_exchange_cannot_change_any_record() {
        let directory = tempfile::tempdir().expect("temporary app data directory");
        let vault = test_vault(&directory);
        let entropy =
            DeterministicEntropy::new([vec![0x11; GENERATION_BYTES], vec![0x22; MARKER_BYTES]]);
        assert_eq!(
            replace_database_read_credential_with_entropy(
                &vault,
                "123e4567-e89b-42d3-b456-426614174000",
                Zeroizing::new("replacement".to_owned()),
                DIRECT_PROFILE.as_bytes(),
                &entropy,
            ),
            Err(DatabaseReadCredentialMutationError::CredentialChanged)
        );
        let [password, incarnation, profile, profile_digest, generation] =
            raw_records(&vault).expect("read preserved records");
        assert!(password.is_none());
        assert!(incarnation.is_none());
        assert!(profile.is_none());
        assert!(profile_digest.is_none());
        assert_eq!(
            generation.as_deref().map(String::as_str),
            Some(INITIAL_GENERATION)
        );
    }

    #[test]
    fn legacy_four_record_configuration_fails_closed_until_replaced() {
        let directory = tempfile::tempdir().expect("temporary app data directory");
        let vault = test_vault(&directory);
        vault
            .write_secret_for_test(DATABASE_READ_PASSWORD_ACCOUNT, "legacy-password")
            .expect("seed legacy password");
        vault
            .write_secret_for_test(
                DATABASE_READ_CREDENTIAL_INCARNATION_ACCOUNT,
                &URL_SAFE_NO_PAD.encode([0x22; MARKER_BYTES]),
            )
            .expect("seed legacy incarnation");
        vault
            .write_secret_for_test(
                DATABASE_READ_CONNECTION_PROFILE_DIGEST_ACCOUNT,
                DIRECT_PROFILE_DIGEST,
            )
            .expect("seed legacy profile digest");

        let error = match read_database_read_credential_snapshot(&vault, INITIAL_GENERATION) {
            Ok(_) => panic!("legacy four-record state must not create connection material"),
            Err(error) => error,
        };
        assert_eq!(error, DatabaseReadCredentialSnapshotError::Missing);
        let [password, incarnation, profile, profile_digest, generation] =
            raw_records(&vault).expect("read legacy records");
        assert_eq!(
            password.as_deref().map(String::as_str),
            Some("legacy-password")
        );
        assert!(incarnation.is_some());
        assert!(profile.is_none());
        assert_eq!(
            profile_digest.as_deref().map(String::as_str),
            Some(DIRECT_PROFILE_DIGEST)
        );
        assert_eq!(
            generation.as_deref().map(String::as_str),
            Some(INITIAL_GENERATION)
        );
    }

    #[test]
    fn rejects_invalid_inputs_and_entropy_before_mutation() {
        let directory = tempfile::tempdir().expect("temporary app data directory");
        let vault = test_vault(&directory);
        let valid_entropy =
            || DeterministicEntropy::new([vec![0x11; GENERATION_BYTES], vec![0x22; MARKER_BYTES]]);
        for password in [
            String::new(),
            "before\0after".to_owned(),
            "x".repeat(MAXIMUM_DATABASE_READ_PASSWORD_BYTES + 1),
        ] {
            assert_eq!(
                replace_database_read_credential_with_entropy(
                    &vault,
                    INITIAL_GENERATION,
                    Zeroizing::new(password),
                    DIRECT_PROFILE.as_bytes(),
                    &valid_entropy(),
                ),
                Err(DatabaseReadCredentialMutationError::InvalidPassword)
            );
        }
        assert_eq!(
            replace_database_read_credential_with_entropy(
                &vault,
                INITIAL_GENERATION,
                Zeroizing::new("password".to_owned()),
                br#"{"dsn":"postgresql://postgres:secret@attacker.invalid/postgres"}"#,
                &valid_entropy(),
            ),
            Err(DatabaseReadCredentialMutationError::InvalidConnectionProfile)
        );
        assert_eq!(
            clear_database_read_credential_with_entropy(
                &vault,
                "pending:123e4567-e89b-42d3-a456-426614174000",
                &valid_entropy(),
            ),
            Err(DatabaseReadCredentialMutationError::InvalidGrantGeneration)
        );
        let failed_entropy = DeterministicEntropy::new([]);
        assert_eq!(
            clear_database_read_credential_with_entropy(
                &vault,
                INITIAL_GENERATION,
                &failed_entropy,
            ),
            Err(DatabaseReadCredentialMutationError::EntropyUnavailable)
        );
        let [password, incarnation, profile, profile_digest, generation] =
            raw_records(&vault).expect("read untouched records");
        assert!(password.is_none());
        assert!(incarnation.is_none());
        assert!(profile.is_none());
        assert!(profile_digest.is_none());
        assert_eq!(
            generation.as_deref().map(String::as_str),
            Some(INITIAL_GENERATION)
        );
    }

    #[test]
    fn zero_markers_and_generation_collisions_exhaust_bounded_retries() {
        let zero_marker_entropy =
            DeterministicEntropy::new((0..ENTROPY_ATTEMPTS).map(|_| vec![0; MARKER_BYTES]));
        assert_eq!(
            next_nonzero_marker(&zero_marker_entropy),
            Err(DatabaseReadCredentialMutationError::EntropyUnavailable),
            "marker helper consumes only marker-sized chunks"
        );

        let expected = "11111111-1111-4111-9111-111111111111";
        let collision_entropy =
            DeterministicEntropy::new((0..ENTROPY_ATTEMPTS).map(|_| vec![0x11; GENERATION_BYTES]));
        assert_eq!(
            next_grant_generation(&collision_entropy, expected),
            Err(DatabaseReadCredentialMutationError::EntropyUnavailable)
        );
    }
}
