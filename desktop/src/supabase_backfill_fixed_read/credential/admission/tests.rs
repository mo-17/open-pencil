use super::super::{
    DATABASE_READ_CONNECTION_PROFILE_ACCOUNT, DATABASE_READ_CONNECTION_PROFILE_DIGEST_ACCOUNT,
    DATABASE_READ_CREDENTIAL_INCARNATION_ACCOUNT, DATABASE_READ_PASSWORD_ACCOUNT,
    SHARED_GRANT_GENERATION_ACCOUNT,
};
use super::*;
use crate::credentials::CredentialVaultRecordMutation;
use crate::supabase_backfill_fixed_read::{
    clear_database_read_credential_v1, replace_database_read_credential_v1,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use zeroize::Zeroizing;

const PROJECT: &str = "abcdefghijklmnopqrst";
const ACCOUNT: &str = "account.staging_01";
const INITIAL_GRANT: &str = "123e4567-e89b-42d3-a456-426614174000";
const OTHER_GRANT: &str = "223e4567-e89b-42d3-a456-426614174000";
const PASSWORD: &str = "  fixture database pass\tword\n ";
const PROFILE: &str = r#"{"format":"openpencil.supabase-database-read-connection-profile.v1","version":1,"providerId":"supabase","environment":"staging","projectRef":"abcdefghijklmnopqrst","accountId":"account.staging_01","mode":"direct","host":"db.abcdefghijklmnopqrst.supabase.co","port":5432,"database":"postgres","user":"postgres","tlsMode":"verify-full"}"#;

struct Fixture {
    directory: tempfile::TempDir,
    vault: CredentialVault,
}

impl Fixture {
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let vault = CredentialVault::new(directory.path().to_path_buf());
        vault
            .write_secret_for_test(SHARED_GRANT_GENERATION_ACCOUNT, INITIAL_GRANT)
            .unwrap();
        replace_database_read_credential_v1(
            &vault,
            INITIAL_GRANT,
            Zeroizing::new(PASSWORD.to_owned()),
            PROFILE,
        )
        .unwrap();
        Self { directory, vault }
    }

    fn admit(&self) -> DatabaseReadCredentialAdmissionV1 {
        DatabaseReadCredentialAdmissionV1::admit_for_test(self.vault.clone(), PROJECT, ACCOUNT)
            .unwrap()
    }

    fn current(&self) -> DatabaseReadCredentialSnapshotV1 {
        read_current_database_read_credential_snapshot_from(&self.vault).unwrap()
    }

    fn write(&self, account: &str, value: &str) {
        self.vault.write_secret_for_test(account, value).unwrap();
    }
}

#[test]
fn admits_current_grant_without_historical_hint_and_preserves_borrowed_password() {
    let fixture = Fixture::new();
    let current = fixture.current();
    assert_ne!(current.grant_generation(), INITIAL_GRANT);
    let admission = fixture.admit();
    {
        let inputs = admission.connection_inputs_for_test();
        assert_eq!(inputs.password(), PASSWORD);
        assert_eq!(inputs.connection_profile().project_ref(), PROJECT);
        assert_eq!(inputs.connection_profile().account_id(), ACCOUNT);
        assert_eq!(inputs.grant_generation(), current.grant_generation());
        assert_eq!(
            inputs.credential_incarnation(),
            current.credential_incarnation()
        );
        assert_eq!(
            inputs.connection_profile_digest(),
            current.connection_profile_digest()
        );
    }
    admission.finish_for_test().unwrap();
}

#[test]
fn rejects_same_project_wrong_account_and_same_account_wrong_project() {
    let fixture = Fixture::new();
    for (project, account) in [
        (PROJECT, "other-account"),
        ("bcdefghijklmnopqrstu", ACCOUNT),
    ] {
        assert_eq!(
            DatabaseReadCredentialAdmissionV1::admit_for_test(
                fixture.vault.clone(),
                project,
                account
            )
            .err(),
            Some(DatabaseReadCredentialAdmissionErrorV1::IdentityMismatch),
        );
    }
    fixture.admit().finish_for_test().unwrap();
}

#[test]
fn rejects_rotation_and_clear_through_the_real_temporary_vault_lifecycle() {
    for clear in [false, true] {
        let fixture = Fixture::new();
        let admission = fixture.admit();
        let current = fixture.current();
        if clear {
            clear_database_read_credential_v1(&fixture.vault, current.grant_generation()).unwrap();
            assert_eq!(
                admission.finish_for_test(),
                Err(DatabaseReadCredentialAdmissionErrorV1::Snapshot(
                    DatabaseReadCredentialSnapshotError::Missing
                )),
            );
        } else {
            // Same password/profile still constitute a new credential incarnation and grant.
            replace_database_read_credential_v1(
                &fixture.vault,
                current.grant_generation(),
                Zeroizing::new(PASSWORD.to_owned()),
                PROFILE,
            )
            .unwrap();
            assert_eq!(
                admission.finish_for_test(),
                Err(DatabaseReadCredentialAdmissionErrorV1::Changed)
            );
            fixture.admit().finish_for_test().unwrap();
        }
    }
}

#[test]
fn rejects_independent_password_grant_incarnation_and_canonical_profile_changes() {
    for field in ["password", "grant", "incarnation", "profile"] {
        let fixture = Fixture::new();
        let admission = fixture.admit();
        match field {
            "password" => fixture.write(DATABASE_READ_PASSWORD_ACCOUNT, "changed fixture value"),
            "grant" => fixture.write(SHARED_GRANT_GENERATION_ACCOUNT, OTHER_GRANT),
            "incarnation" => fixture.write(
                DATABASE_READ_CREDENTIAL_INCARNATION_ACCOUNT,
                &URL_SAFE_NO_PAD.encode([0x55; 32]),
            ),
            _ => {
                let raw = PROFILE.replace(ACCOUNT, "account.other_02");
                let profile =
                    super::super::parse_supabase_database_read_connection_profile_v1(raw).unwrap();
                // Recompute the profile digest too, so validation succeeds and final exact
                // comparison detects the changed profile independently of the current grant.
                fixture.write(
                    DATABASE_READ_CONNECTION_PROFILE_ACCOUNT,
                    profile.canonical_json(),
                );
                fixture.write(
                    DATABASE_READ_CONNECTION_PROFILE_DIGEST_ACCOUNT,
                    &profile.digest_base64url(),
                );
            }
        }
        fixture.current();
        assert_eq!(
            admission.finish_for_test(),
            Err(DatabaseReadCredentialAdmissionErrorV1::Changed)
        );
    }
}

#[test]
fn rejects_each_missing_record_at_final_check() {
    for removed in [
        DATABASE_READ_PASSWORD_ACCOUNT,
        DATABASE_READ_CREDENTIAL_INCARNATION_ACCOUNT,
        DATABASE_READ_CONNECTION_PROFILE_ACCOUNT,
        DATABASE_READ_CONNECTION_PROFILE_DIGEST_ACCOUNT,
        SHARED_GRANT_GENERATION_ACCOUNT,
    ] {
        let fixture = Fixture::new();
        let admission = fixture.admit();
        let current = fixture.current();
        // A raw Host test mutation makes each missing-record case reachable. Use a distinct
        // existing marker as the CAS predicate when the record being removed is the grant.
        let (expected_account, expected_value, next) = if removed == SHARED_GRANT_GENERATION_ACCOUNT
        {
            (
                DATABASE_READ_CREDENTIAL_INCARNATION_ACCOUNT,
                URL_SAFE_NO_PAD.encode(current.credential_incarnation()),
                URL_SAFE_NO_PAD.encode([0x66; 32]),
            )
        } else {
            (
                SHARED_GRANT_GENERATION_ACCOUNT,
                current.grant_generation().to_owned(),
                OTHER_GRANT.to_owned(),
            )
        };
        fixture
            .vault
            .compare_exchange_secret_records(
                expected_account,
                &expected_value,
                &[
                    CredentialVaultRecordMutation::write(expected_account, &next),
                    CredentialVaultRecordMutation::remove(removed),
                ],
            )
            .unwrap();
        assert_eq!(
            admission.finish_for_test(),
            Err(DatabaseReadCredentialAdmissionErrorV1::Snapshot(
                DatabaseReadCredentialSnapshotError::Missing
            ))
        );
    }
}

#[test]
fn rejects_invalid_current_values_without_echoing_them() {
    let cases = [
        (
            DATABASE_READ_PASSWORD_ACCOUNT,
            "bad\0fixture",
            DatabaseReadCredentialSnapshotError::InvalidPassword,
        ),
        (
            SHARED_GRANT_GENERATION_ACCOUNT,
            "pending:123e4567-e89b-42d3-a456-426614174000",
            DatabaseReadCredentialSnapshotError::PendingGrantGeneration,
        ),
        (
            SHARED_GRANT_GENERATION_ACCOUNT,
            "invalid-grant-fixture",
            DatabaseReadCredentialSnapshotError::InvalidGrantGeneration,
        ),
        (
            DATABASE_READ_CREDENTIAL_INCARNATION_ACCOUNT,
            "invalid-marker-fixture",
            DatabaseReadCredentialSnapshotError::InvalidCredentialIncarnation,
        ),
        (
            DATABASE_READ_CONNECTION_PROFILE_ACCOUNT,
            "invalid-profile-fixture",
            DatabaseReadCredentialSnapshotError::InvalidConnectionProfileDigest,
        ),
        (
            DATABASE_READ_CONNECTION_PROFILE_DIGEST_ACCOUNT,
            "invalid-digest-fixture",
            DatabaseReadCredentialSnapshotError::InvalidConnectionProfileDigest,
        ),
    ];
    for (account, value, expected) in cases {
        let fixture = Fixture::new();
        let admission = fixture.admit();
        fixture.write(account, value);
        let error = admission.finish_for_test().unwrap_err();
        assert_eq!(
            error,
            DatabaseReadCredentialAdmissionErrorV1::Snapshot(expected)
        );
        assert!(!format!("{error:?}").contains(value));
        assert!(!format!("{error:?}").contains(PASSWORD));
    }
}

#[test]
fn final_check_uses_captured_vault_and_detects_same_store_other_instance_rotation() {
    let fixture = Fixture::new();
    let foreign = Fixture::new();
    let admission = fixture.admit();
    foreign.write(
        DATABASE_READ_PASSWORD_ACCOUNT,
        "foreign fixture replacement",
    );
    admission.finish_for_test().unwrap();

    let admission = fixture.admit();
    let same_store = CredentialVault::new(fixture.directory.path().to_path_buf());
    same_store
        .write_secret_for_test(
            DATABASE_READ_PASSWORD_ACCOUNT,
            "same-store fixture replacement",
        )
        .unwrap();
    assert_eq!(
        admission.finish_for_test(),
        Err(DatabaseReadCredentialAdmissionErrorV1::Changed)
    );
}

#[test]
fn unavailable_or_disappeared_vault_fails_closed_and_drop_does_not_read() {
    assert_eq!(
        DatabaseReadCredentialAdmissionV1::admit_for_test(
            CredentialVault::unavailable(),
            PROJECT,
            ACCOUNT
        )
        .err(),
        Some(DatabaseReadCredentialAdmissionErrorV1::Snapshot(
            DatabaseReadCredentialSnapshotError::Unavailable
        )),
    );
    let fixture = Fixture::new();
    let admission = fixture.admit();
    let dropped = fixture.admit();
    std::fs::remove_dir_all(fixture.directory.path().join("credentials")).unwrap();
    drop(dropped);
    assert!(!fixture.directory.path().join("credentials").exists());
    assert_eq!(
        admission.finish_for_test(),
        Err(DatabaseReadCredentialAdmissionErrorV1::Snapshot(
            DatabaseReadCredentialSnapshotError::Missing
        ))
    );
}
