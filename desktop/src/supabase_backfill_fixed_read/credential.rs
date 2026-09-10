//! Atomic database-read credential snapshot for the dormant fixed-read transport.
//!
//! This module only reads and validates existing vault records. It creates no command, connection,
//! network client, database authority, or dispatch path. All five records are read under the vault's
//! single snapshot lock so a credential rotation cannot be observed partially.

use super::{
    profile::{
        parse_supabase_database_read_connection_profile_v1, SupabaseDatabaseReadConnectionProfileV1,
    },
    valid_uuid_v4,
};
use crate::credentials::{CredentialVault, CredentialVaultSnapshotError};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use zeroize::Zeroizing;

#[cfg(test)]
mod admission;
#[cfg(test)]
pub(crate) use admission::{
    DatabaseReadCredentialAdmissionErrorV1, DatabaseReadCredentialAdmissionV1,
    DatabaseReadCredentialConnectionInputsV1,
};

pub(super) const DATABASE_READ_PASSWORD_ACCOUNT: &str =
    "v1:supabase-database-read:default:password";
pub(super) const DATABASE_READ_CREDENTIAL_INCARNATION_ACCOUNT: &str =
    "v1:supabase-database-read:default:credential-incarnation";
pub(super) const DATABASE_READ_CONNECTION_PROFILE_ACCOUNT: &str =
    "v1:supabase-database-read:default:connection-profile";
pub(super) const DATABASE_READ_CONNECTION_PROFILE_DIGEST_ACCOUNT: &str =
    "v1:supabase-database-read:default:connection-profile-digest";
pub(super) const SHARED_GRANT_GENERATION_ACCOUNT: &str =
    "v1:supabase-management:default:grant-generation";
const DATABASE_READ_CREDENTIAL_ACCOUNT_COUNT: usize = 5;
pub(crate) const MAXIMUM_DATABASE_READ_PASSWORD_BYTES: usize = 16 * 1024;
const MARKER_BYTES: usize = 32;

type RawCredentialSnapshot = [Option<Zeroizing<String>>; DATABASE_READ_CREDENTIAL_ACCOUNT_COUNT];

/// A validated, one-generation view of the database-read credential records.
///
/// Deliberately not `Clone`, `Debug`, or serializable. The password retains its exact vault value,
/// including leading, trailing, and internal whitespace.
pub(crate) struct DatabaseReadCredentialSnapshotV1 {
    password: Zeroizing<String>,
    connection_profile: SupabaseDatabaseReadConnectionProfileV1,
    grant_generation: String,
    credential_incarnation: [u8; MARKER_BYTES],
    connection_profile_digest: [u8; MARKER_BYTES],
}

impl DatabaseReadCredentialSnapshotV1 {
    pub(crate) fn password(&self) -> &str {
        self.password.as_str()
    }

    pub(crate) fn connection_profile(&self) -> &SupabaseDatabaseReadConnectionProfileV1 {
        &self.connection_profile
    }

    pub(crate) fn grant_generation(&self) -> &str {
        &self.grant_generation
    }

    pub(crate) fn credential_incarnation(&self) -> [u8; MARKER_BYTES] {
        self.credential_incarnation
    }

    pub(crate) fn connection_profile_digest(&self) -> [u8; MARKER_BYTES] {
        self.connection_profile_digest
    }

    #[cfg(test)]
    pub(super) fn checked_for_test(
        password: String,
        connection_profile: String,
        grant_generation: String,
        credential_incarnation: [u8; MARKER_BYTES],
    ) -> Result<Self, DatabaseReadCredentialSnapshotError> {
        struct TestCredentialSource {
            snapshot: std::cell::RefCell<Option<RawCredentialSnapshot>>,
        }

        impl DatabaseReadCredentialSource for TestCredentialSource {
            fn read_secret_snapshot(
                &self,
                _accounts: [&str; DATABASE_READ_CREDENTIAL_ACCOUNT_COUNT],
            ) -> Result<RawCredentialSnapshot, CredentialVaultSnapshotError> {
                self.snapshot
                    .borrow_mut()
                    .take()
                    .ok_or(CredentialVaultSnapshotError::Failed)
            }
        }

        let expected_grant_generation = grant_generation.clone();
        let connection_profile =
            parse_supabase_database_read_connection_profile_v1(&connection_profile)
                .map_err(|_| DatabaseReadCredentialSnapshotError::InvalidConnectionProfileDigest)?;
        let canonical_connection_profile = connection_profile.canonical_json().to_owned();
        let connection_profile_digest = connection_profile.digest();
        let source = TestCredentialSource {
            snapshot: std::cell::RefCell::new(Some([
                Some(Zeroizing::new(password)),
                Some(Zeroizing::new(
                    URL_SAFE_NO_PAD.encode(credential_incarnation),
                )),
                Some(Zeroizing::new(canonical_connection_profile)),
                Some(Zeroizing::new(
                    URL_SAFE_NO_PAD.encode(connection_profile_digest),
                )),
                Some(Zeroizing::new(grant_generation)),
            ])),
        };
        read_database_read_credential_snapshot_from(&source, &expected_grant_generation)
    }
}

/// Fixed, data-free failures. No variant can retain or echo secret material.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum DatabaseReadCredentialSnapshotError {
    Missing,
    Unavailable,
    Failed,
    InvalidPassword,
    InvalidGrantGeneration,
    PendingGrantGeneration,
    GrantGenerationMismatch,
    InvalidCredentialIncarnation,
    InvalidConnectionProfileDigest,
}

/// Private seam used only to prove atomic-read behavior without constructing a filesystem vault.
trait DatabaseReadCredentialSource {
    fn read_secret_snapshot(
        &self,
        accounts: [&str; DATABASE_READ_CREDENTIAL_ACCOUNT_COUNT],
    ) -> Result<RawCredentialSnapshot, CredentialVaultSnapshotError>;
}

impl DatabaseReadCredentialSource for CredentialVault {
    fn read_secret_snapshot(
        &self,
        accounts: [&str; DATABASE_READ_CREDENTIAL_ACCOUNT_COUNT],
    ) -> Result<RawCredentialSnapshot, CredentialVaultSnapshotError> {
        CredentialVault::read_secret_snapshot(self, accounts)
    }
}

/// Reads the complete database-read credential generation exactly once.
pub(crate) fn read_database_read_credential_snapshot(
    vault: &CredentialVault,
    expected_grant_generation: &str,
) -> Result<DatabaseReadCredentialSnapshotV1, DatabaseReadCredentialSnapshotError> {
    read_database_read_credential_snapshot_from(vault, expected_grant_generation)
}

fn read_database_read_credential_snapshot_from(
    source: &impl DatabaseReadCredentialSource,
    expected_grant_generation: &str,
) -> Result<DatabaseReadCredentialSnapshotV1, DatabaseReadCredentialSnapshotError> {
    read_database_read_credential_snapshot_with_expected(source, Some(expected_grant_generation))
}

/// The Host learns the current grant from the same five-record snapshot, never from a caller or
/// historical installation grant. This private reader is only reachable by test-only admission.
#[cfg(test)]
fn read_current_database_read_credential_snapshot_from(
    source: &impl DatabaseReadCredentialSource,
) -> Result<DatabaseReadCredentialSnapshotV1, DatabaseReadCredentialSnapshotError> {
    read_database_read_credential_snapshot_with_expected(source, None)
}

fn read_database_read_credential_snapshot_with_expected(
    source: &impl DatabaseReadCredentialSource,
    expected_grant_generation: Option<&str>,
) -> Result<DatabaseReadCredentialSnapshotV1, DatabaseReadCredentialSnapshotError> {
    let values = source
        .read_secret_snapshot([
            DATABASE_READ_PASSWORD_ACCOUNT,
            DATABASE_READ_CREDENTIAL_INCARNATION_ACCOUNT,
            DATABASE_READ_CONNECTION_PROFILE_ACCOUNT,
            DATABASE_READ_CONNECTION_PROFILE_DIGEST_ACCOUNT,
            SHARED_GRANT_GENERATION_ACCOUNT,
        ])
        .map_err(map_vault_snapshot_error)?;
    parse_database_read_credential_snapshot(values, expected_grant_generation)
}

fn map_vault_snapshot_error(error: CredentialVaultSnapshotError) -> DatabaseReadCredentialSnapshotError {
    match error {
        CredentialVaultSnapshotError::Unavailable => DatabaseReadCredentialSnapshotError::Unavailable,
        CredentialVaultSnapshotError::Failed => DatabaseReadCredentialSnapshotError::Failed,
    }
}

fn parse_database_read_credential_snapshot(
    values: RawCredentialSnapshot,
    expected_grant_generation: Option<&str>,
) -> Result<DatabaseReadCredentialSnapshotV1, DatabaseReadCredentialSnapshotError> {
    let [password, credential_incarnation, connection_profile, connection_profile_digest, grant_generation] = values;

    let (
        Some(password),
        Some(credential_incarnation),
        Some(connection_profile),
        Some(connection_profile_digest),
        Some(grant_generation),
    ) = (
        password,
        credential_incarnation,
        connection_profile,
        connection_profile_digest,
        grant_generation,
    )
    else {
        return Err(DatabaseReadCredentialSnapshotError::Missing);
    };

    if password.is_empty()
        || password.len() > MAXIMUM_DATABASE_READ_PASSWORD_BYTES
        || password.as_bytes().contains(&0)
    {
        return Err(DatabaseReadCredentialSnapshotError::InvalidPassword);
    }

    if grant_generation.starts_with("pending:") {
        return Err(DatabaseReadCredentialSnapshotError::PendingGrantGeneration);
    }
    if !valid_uuid_v4(&grant_generation) {
        return Err(DatabaseReadCredentialSnapshotError::InvalidGrantGeneration);
    }
    if expected_grant_generation.is_some_and(|expected| grant_generation.as_str() != expected) {
        return Err(DatabaseReadCredentialSnapshotError::GrantGenerationMismatch);
    }

    let credential_incarnation = canonical_nonzero_marker(&credential_incarnation)
        .ok_or(DatabaseReadCredentialSnapshotError::InvalidCredentialIncarnation)?;
    let connection_profile_digest = canonical_nonzero_marker(&connection_profile_digest)
        .ok_or(DatabaseReadCredentialSnapshotError::InvalidConnectionProfileDigest)?;
    let parsed_connection_profile =
        parse_supabase_database_read_connection_profile_v1(connection_profile.as_bytes())
            .map_err(|_| DatabaseReadCredentialSnapshotError::InvalidConnectionProfileDigest)?;
    if connection_profile.as_str() != parsed_connection_profile.canonical_json()
        || parsed_connection_profile.digest() != connection_profile_digest
    {
        return Err(DatabaseReadCredentialSnapshotError::InvalidConnectionProfileDigest);
    }

    Ok(DatabaseReadCredentialSnapshotV1 {
        password,
        connection_profile: parsed_connection_profile,
        grant_generation: grant_generation.to_string(),
        credential_incarnation,
        connection_profile_digest,
    })
}

fn canonical_nonzero_marker(value: &str) -> Option<[u8; MARKER_BYTES]> {
    // SHA-256 in unpadded base64url is always exactly 43 ASCII bytes. Checking first also bounds
    // decoder work even if a future vault format admits larger record values.
    if value.len() != 43 || !value.is_ascii() {
        return None;
    }
    let decoded: [u8; MARKER_BYTES] = URL_SAFE_NO_PAD.decode(value).ok()?.try_into().ok()?;
    if decoded == [0; MARKER_BYTES] || URL_SAFE_NO_PAD.encode(decoded) != value {
        return None;
    }
    Some(decoded)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        cell::{Cell, RefCell},
        fmt::Debug,
    };

    const GRANT_GENERATION: &str = "123e4567-e89b-42d3-a456-426614174000";
    const OTHER_GRANT_GENERATION: &str = "123e4567-e89b-42d3-b456-426614174000";
    const PASSWORD: &str = "  database pass\tword\n ";
    const CONNECTION_PROFILE: &str = r#"{"accountId":"account.staging_01","database":"postgres","environment":"staging","format":"openpencil.supabase-database-read-connection-profile.v1","host":"db.abcdefghijklmnopqrst.supabase.co","mode":"direct","port":5432,"projectRef":"abcdefghijklmnopqrst","providerId":"supabase","tlsMode":"verify-full","user":"postgres","version":1}"#;

    struct FakeCredentialSource {
        result: RefCell<Option<Result<RawCredentialSnapshot, CredentialVaultSnapshotError>>>,
        calls: Cell<usize>,
        accounts: RefCell<Vec<[String; DATABASE_READ_CREDENTIAL_ACCOUNT_COUNT]>>,
    }

    impl FakeCredentialSource {
        fn values(values: RawCredentialSnapshot) -> Self {
            Self::result(Ok(values))
        }

        fn error(error: CredentialVaultSnapshotError) -> Self {
            Self::result(Err(error))
        }

        fn result(result: Result<RawCredentialSnapshot, CredentialVaultSnapshotError>) -> Self {
            Self {
                result: RefCell::new(Some(result)),
                calls: Cell::new(0),
                accounts: RefCell::new(Vec::new()),
            }
        }
    }

    impl DatabaseReadCredentialSource for FakeCredentialSource {
        fn read_secret_snapshot(
            &self,
            accounts: [&str; DATABASE_READ_CREDENTIAL_ACCOUNT_COUNT],
        ) -> Result<RawCredentialSnapshot, CredentialVaultSnapshotError> {
            self.calls.set(self.calls.get() + 1);
            self.accounts.borrow_mut().push(accounts.map(str::to_owned));
            self.result
                .borrow_mut()
                .take()
                .expect("fake credential snapshot must be read only once")
        }
    }

    fn raw_values(password: &str) -> RawCredentialSnapshot {
        let profile = parse_supabase_database_read_connection_profile_v1(CONNECTION_PROFILE)
            .expect("valid canonical profile fixture");
        [
            Some(Zeroizing::new(password.to_owned())),
            Some(Zeroizing::new(marker(0x11))),
            Some(Zeroizing::new(CONNECTION_PROFILE.to_owned())),
            Some(Zeroizing::new(URL_SAFE_NO_PAD.encode(profile.digest()))),
            Some(Zeroizing::new(GRANT_GENERATION.to_owned())),
        ]
    }

    fn marker(byte: u8) -> String {
        URL_SAFE_NO_PAD.encode([byte; MARKER_BYTES])
    }

    fn noncanonical_marker(byte: u8) -> String {
        const BASE64URL_ALPHABET: &[u8; 64] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        let mut value = marker(byte).into_bytes();
        let last = value
            .last_mut()
            .expect("a 32-byte marker has a trailing base64url symbol");
        let index = BASE64URL_ALPHABET
            .iter()
            .position(|symbol| symbol == last)
            .expect("canonical base64url symbol is in the alphabet");
        assert_eq!(index % 4, 0, "canonical trailing pad bits are zero");
        *last = BASE64URL_ALPHABET[index + 1];
        String::from_utf8(value).expect("base64url is ASCII")
    }

    fn snapshot_error(
        result: Result<DatabaseReadCredentialSnapshotV1, DatabaseReadCredentialSnapshotError>,
    ) -> DatabaseReadCredentialSnapshotError {
        match result {
            Ok(_) => panic!("credential snapshot unexpectedly succeeded"),
            Err(error) => error,
        }
    }

    fn assert_error<T: Debug>(
        source: &FakeCredentialSource,
        expected: DatabaseReadCredentialSnapshotError,
        secret: T,
    ) {
        let error = snapshot_error(read_database_read_credential_snapshot_from(
            source,
            GRANT_GENERATION,
        ));
        assert_eq!(error, expected);
        assert!(!format!("{error:?}").contains(&format!("{secret:?}")));
    }

    #[test]
    fn reads_exact_accounts_once_and_preserves_password_whitespace() {
        let source = FakeCredentialSource::values(raw_values(PASSWORD));
        let snapshot = read_database_read_credential_snapshot_from(&source, GRANT_GENERATION)
            .expect("valid credential snapshot");

        assert_eq!(source.calls.get(), 1);
        assert_eq!(
            source.accounts.borrow().as_slice(),
            &[DATABASE_READ_CREDENTIAL_ACCOUNTS.map(str::to_owned)]
        );
        assert_eq!(snapshot.password(), PASSWORD);
        assert_eq!(
            snapshot.connection_profile().canonical_json(),
            CONNECTION_PROFILE
        );
        assert_eq!(
            snapshot.connection_profile().project_ref(),
            "abcdefghijklmnopqrst"
        );
        assert_eq!(
            snapshot.connection_profile().account_id(),
            "account.staging_01"
        );
        assert_eq!(snapshot.grant_generation(), GRANT_GENERATION);
        assert_eq!(snapshot.credential_incarnation(), [0x11; MARKER_BYTES]);
        assert_eq!(
            snapshot.connection_profile_digest(),
            snapshot.connection_profile().digest()
        );
    }

    const DATABASE_READ_CREDENTIAL_ACCOUNTS: [&str; DATABASE_READ_CREDENTIAL_ACCOUNT_COUNT] = [
        DATABASE_READ_PASSWORD_ACCOUNT,
        DATABASE_READ_CREDENTIAL_INCARNATION_ACCOUNT,
        DATABASE_READ_CONNECTION_PROFILE_ACCOUNT,
        DATABASE_READ_CONNECTION_PROFILE_DIGEST_ACCOUNT,
        SHARED_GRANT_GENERATION_ACCOUNT,
    ];

    #[test]
    fn current_reader_observes_exactly_one_atomic_snapshot_without_an_expected_grant() {
        let mut values = raw_values(PASSWORD);
        values[4] = Some(Zeroizing::new(OTHER_GRANT_GENERATION.to_owned()));
        let source = FakeCredentialSource::values(values);
        let snapshot = read_current_database_read_credential_snapshot_from(&source).unwrap();
        assert_eq!(source.calls.get(), 1);
        assert_eq!(
            source.accounts.borrow().as_slice(),
            &[DATABASE_READ_CREDENTIAL_ACCOUNTS.map(str::to_owned)]
        );
        assert_eq!(snapshot.grant_generation(), OTHER_GRANT_GENERATION);
        assert_eq!(snapshot.password(), PASSWORD);
    }

    #[test]
    fn rejects_each_missing_record() {
        for missing_index in 0..DATABASE_READ_CREDENTIAL_ACCOUNT_COUNT {
            let mut values = raw_values(PASSWORD);
            values[missing_index] = None;
            let source = FakeCredentialSource::values(values);
            assert_eq!(
                snapshot_error(read_database_read_credential_snapshot_from(
                    &source,
                    GRANT_GENERATION,
                )),
                DatabaseReadCredentialSnapshotError::Missing
            );
        }
    }

    #[test]
    fn maps_vault_unavailable_and_failed_without_payloads() {
        for (vault_error, expected) in [
            (
                CredentialVaultSnapshotError::Unavailable,
                DatabaseReadCredentialSnapshotError::Unavailable,
            ),
            (
                CredentialVaultSnapshotError::Failed,
                DatabaseReadCredentialSnapshotError::Failed,
            ),
        ] {
            let source = FakeCredentialSource::error(vault_error);
            assert_eq!(
                snapshot_error(read_database_read_credential_snapshot_from(
                    &source,
                    GRANT_GENERATION,
                )),
                expected
            );
        }
    }

    #[test]
    fn rejects_empty_nul_and_oversized_passwords_without_echoing_them() {
        for password in [
            String::new(),
            "before\0after".to_owned(),
            "x".repeat(MAXIMUM_DATABASE_READ_PASSWORD_BYTES + 1),
        ] {
            let source = FakeCredentialSource::values(raw_values(&password));
            assert_error(
                &source,
                DatabaseReadCredentialSnapshotError::InvalidPassword,
                &password,
            );
        }
    }

    #[test]
    fn accepts_password_at_the_exact_byte_limit() {
        let password = "x".repeat(MAXIMUM_DATABASE_READ_PASSWORD_BYTES);
        let source = FakeCredentialSource::values(raw_values(&password));
        let snapshot = read_database_read_credential_snapshot_from(&source, GRANT_GENERATION)
            .expect("maximum-length password remains valid");
        assert_eq!(snapshot.password(), password);
    }

    #[test]
    fn rejects_malformed_noncanonical_and_non_v4_generations() {
        for generation in [
            "not-a-generation",
            "123E4567-E89B-42D3-A456-426614174000",
            "123e4567-e89b-32d3-a456-426614174000",
            "123e4567-e89b-42d3-c456-426614174000",
        ] {
            let mut values = raw_values(PASSWORD);
            values[4] = Some(Zeroizing::new(generation.to_owned()));
            let source = FakeCredentialSource::values(values);
            assert_error(
                &source,
                DatabaseReadCredentialSnapshotError::InvalidGrantGeneration,
                generation,
            );
        }
    }

    #[test]
    fn rejects_pending_generation_without_echoing_it() {
        let generation = format!("pending:{GRANT_GENERATION}");
        let mut values = raw_values(PASSWORD);
        values[4] = Some(Zeroizing::new(generation.clone()));
        let source = FakeCredentialSource::values(values);
        assert_error(
            &source,
            DatabaseReadCredentialSnapshotError::PendingGrantGeneration,
            generation,
        );
    }

    #[test]
    fn rejects_generation_mismatch_without_echoing_either_generation() {
        let source = FakeCredentialSource::values(raw_values(PASSWORD));
        let error = snapshot_error(read_database_read_credential_snapshot_from(
            &source,
            OTHER_GRANT_GENERATION,
        ));
        assert_eq!(
            error,
            DatabaseReadCredentialSnapshotError::GrantGenerationMismatch
        );
        let rendered = format!("{error:?}");
        assert!(!rendered.contains(GRANT_GENERATION));
        assert!(!rendered.contains(OTHER_GRANT_GENERATION));
    }

    #[test]
    fn rejects_padded_wrong_length_zero_and_noncanonical_markers() {
        let invalid_markers = [
            format!("{}=", marker(0x33)),
            URL_SAFE_NO_PAD.encode([0x33; MARKER_BYTES - 1]),
            marker(0),
            noncanonical_marker(0x33),
        ];
        for marker_index in [1, 3] {
            for invalid_marker in &invalid_markers {
                let mut values = raw_values(PASSWORD);
                values[marker_index] = Some(Zeroizing::new(invalid_marker.clone()));
                let source = FakeCredentialSource::values(values);
                let expected = if marker_index == 1 {
                    DatabaseReadCredentialSnapshotError::InvalidCredentialIncarnation
                } else {
                    DatabaseReadCredentialSnapshotError::InvalidConnectionProfileDigest
                };
                assert_error(&source, expected, invalid_marker);
            }
        }
    }

    #[test]
    fn rejects_invalid_noncanonical_and_digest_mismatched_profiles() {
        let mut invalid = raw_values(PASSWORD);
        invalid[2] = Some(Zeroizing::new(
            r#"{"dsn":"postgresql://postgres:secret@attacker.invalid/postgres"}"#.to_owned(),
        ));
        let source = FakeCredentialSource::values(invalid);
        assert_error(
            &source,
            DatabaseReadCredentialSnapshotError::InvalidConnectionProfileDigest,
            "attacker.invalid",
        );

        let noncanonical = CONNECTION_PROFILE.replacen(
            r#"{"accountId":"account.staging_01","database":"postgres""#,
            r#"{"database":"postgres","accountId":"account.staging_01""#,
            1,
        );
        let mut values = raw_values(PASSWORD);
        values[2] = Some(Zeroizing::new(noncanonical.clone()));
        let source = FakeCredentialSource::values(values);
        assert_error(
            &source,
            DatabaseReadCredentialSnapshotError::InvalidConnectionProfileDigest,
            noncanonical,
        );

        let mut mismatched = raw_values(PASSWORD);
        mismatched[3] = Some(Zeroizing::new(marker(0x22)));
        let source = FakeCredentialSource::values(mismatched);
        assert_error(
            &source,
            DatabaseReadCredentialSnapshotError::InvalidConnectionProfileDigest,
            marker(0x22),
        );
    }
}
