//! Main-window-only lifecycle commands for the fixed Supabase database-read credential.
//!
//! This boundary can observe status and atomically replace or clear the five fixed vault records.
//! It never returns the password, accepts no DSN or arbitrary connection option, and creates no
//! database connection, socket, query, or execution authority.

use crate::{
    credentials::{CredentialVault, CredentialVaultCommitDurability},
    supabase_backfill_fixed_read::{
        clear_database_read_credential_v1, read_database_read_credential_snapshot,
        replace_database_read_credential_v1, valid_uuid_v4, DatabaseReadCredentialMutationError,
        DatabaseReadCredentialMutationReceiptV1, DatabaseReadCredentialSnapshotError,
        DATABASE_READ_CONNECTION_PROFILE_MAX_BYTES, MAXIMUM_DATABASE_READ_PASSWORD_BYTES,
    },
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::Serialize;
use tauri::{
    ipc::{InvokeBody, Request as TauriRequest},
    WebviewWindow,
};
use zeroize::Zeroizing;

const MUTATION_RECEIPT_FORMAT: &str =
    "openpencil.supabase-database-read-credential-mutation-receipt.v1";
const STATUS_REQUEST_MAGIC: &[u8; 8] = b"OPDBRS01";
const REPLACE_REQUEST_MAGIC: &[u8; 8] = b"OPDBRR01";
const CLEAR_REQUEST_MAGIC: &[u8; 8] = b"OPDBRC01";
const UUID_V4_BYTES: usize = 36;
const GENERATION_REQUEST_BYTES: usize = STATUS_REQUEST_MAGIC.len() + UUID_V4_BYTES;
const REPLACE_REQUEST_HEADER_BYTES: usize = REPLACE_REQUEST_MAGIC.len() + 3 * size_of::<u32>();
const MAXIMUM_REPLACE_REQUEST_BYTES: usize = REPLACE_REQUEST_HEADER_BYTES
    + UUID_V4_BYTES
    + MAXIMUM_DATABASE_READ_PASSWORD_BYTES
    + DATABASE_READ_CONNECTION_PROFILE_MAX_BYTES;

struct SupabaseDatabaseReadCredentialStatusRequestV1 {
    expected_grant_generation: String,
}

struct SupabaseDatabaseReadCredentialReplaceRequestV1 {
    expected_grant_generation: String,
    password: String,
    connection_profile_json: String,
}

impl SupabaseDatabaseReadCredentialReplaceRequestV1 {
    fn into_zeroizing_parts(self) -> (String, Zeroizing<String>, String) {
        (
            self.expected_grant_generation,
            Zeroizing::new(self.password),
            self.connection_profile_json,
        )
    }
}

struct SupabaseDatabaseReadCredentialClearRequestV1 {
    expected_grant_generation: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SupabaseDatabaseReadCredentialStatusV1 {
    Configured,
    Missing,
    Unavailable,
    Invalid,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupabaseDatabaseReadCredentialMutationReceiptResponseV1 {
    format: &'static str,
    version: u8,
    configured: bool,
    commit_durability: SupabaseDatabaseReadCredentialCommitDurabilityV1,
    grant_generation: String,
    credential_incarnation: String,
    connection_profile_digest: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SupabaseDatabaseReadCredentialCommitDurabilityV1 {
    Confirmed,
    Unconfirmed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SupabaseDatabaseReadCredentialCommandErrorCode {
    InvalidAuthority,
    InvalidRequest,
    InvalidGrantGeneration,
    InvalidPassword,
    InvalidConnectionProfile,
    EntropyUnavailable,
    CredentialUnavailable,
    CredentialChanged,
    CredentialFailed,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupabaseDatabaseReadCredentialCommandError {
    code: SupabaseDatabaseReadCredentialCommandErrorCode,
    message: &'static str,
}

fn command_error(
    code: SupabaseDatabaseReadCredentialCommandErrorCode,
) -> SupabaseDatabaseReadCredentialCommandError {
    let message = match code {
        SupabaseDatabaseReadCredentialCommandErrorCode::InvalidAuthority => {
            "The Supabase database-read credential is available only to the main window"
        }
        SupabaseDatabaseReadCredentialCommandErrorCode::InvalidRequest => {
            "The Supabase database-read credential request is invalid"
        }
        SupabaseDatabaseReadCredentialCommandErrorCode::InvalidGrantGeneration => {
            "The Supabase credential grant generation is invalid"
        }
        SupabaseDatabaseReadCredentialCommandErrorCode::InvalidPassword => {
            "The Supabase database-read password is invalid"
        }
        SupabaseDatabaseReadCredentialCommandErrorCode::InvalidConnectionProfile => {
            "The Supabase database-read connection profile is invalid"
        }
        SupabaseDatabaseReadCredentialCommandErrorCode::EntropyUnavailable => {
            "Secure Supabase credential rotation is unavailable"
        }
        SupabaseDatabaseReadCredentialCommandErrorCode::CredentialUnavailable => {
            "The app-local credential store is unavailable"
        }
        SupabaseDatabaseReadCredentialCommandErrorCode::CredentialChanged => {
            "The Supabase credential grant changed before the operation"
        }
        SupabaseDatabaseReadCredentialCommandErrorCode::CredentialFailed => {
            "The Supabase database-read credential operation failed"
        }
    };
    SupabaseDatabaseReadCredentialCommandError { code, message }
}

fn require_main_caller(label: &str) -> Result<(), SupabaseDatabaseReadCredentialCommandError> {
    if label != "main" {
        return Err(command_error(
            SupabaseDatabaseReadCredentialCommandErrorCode::InvalidAuthority,
        ));
    }
    Ok(())
}

fn invalid_request() -> SupabaseDatabaseReadCredentialCommandError {
    command_error(SupabaseDatabaseReadCredentialCommandErrorCode::InvalidRequest)
}

fn raw_request_body(
    body: &InvokeBody,
    maximum_bytes: usize,
) -> Result<&[u8], SupabaseDatabaseReadCredentialCommandError> {
    match body {
        InvokeBody::Raw(bytes) if !bytes.is_empty() && bytes.len() <= maximum_bytes => Ok(bytes),
        InvokeBody::Raw(_) | InvokeBody::Json(_) => Err(invalid_request()),
    }
}

fn generation_request(
    body: &InvokeBody,
    magic: &[u8; 8],
) -> Result<String, SupabaseDatabaseReadCredentialCommandError> {
    let bytes = raw_request_body(body, GENERATION_REQUEST_BYTES)?;
    if bytes.len() != GENERATION_REQUEST_BYTES || bytes.get(..magic.len()) != Some(magic.as_slice())
    {
        return Err(invalid_request());
    }
    let generation = std::str::from_utf8(&bytes[magic.len()..]).map_err(|_| invalid_request())?;
    if !valid_uuid_v4(generation) {
        return Err(command_error(
            SupabaseDatabaseReadCredentialCommandErrorCode::InvalidGrantGeneration,
        ));
    }
    Ok(generation.to_owned())
}

fn u32_length(bytes: &[u8], offset: usize) -> Option<usize> {
    let value = u32::from_le_bytes(bytes.get(offset..offset + 4)?.try_into().ok()?);
    usize::try_from(value).ok()
}

fn replace_request(
    body: &InvokeBody,
) -> Result<
    SupabaseDatabaseReadCredentialReplaceRequestV1,
    SupabaseDatabaseReadCredentialCommandError,
> {
    let bytes = raw_request_body(body, MAXIMUM_REPLACE_REQUEST_BYTES)?;
    if bytes.len() < REPLACE_REQUEST_HEADER_BYTES
        || bytes.get(..REPLACE_REQUEST_MAGIC.len()) != Some(REPLACE_REQUEST_MAGIC.as_slice())
    {
        return Err(invalid_request());
    }
    let generation_length =
        u32_length(bytes, REPLACE_REQUEST_MAGIC.len()).ok_or_else(invalid_request)?;
    let password_length =
        u32_length(bytes, REPLACE_REQUEST_MAGIC.len() + 4).ok_or_else(invalid_request)?;
    let profile_length =
        u32_length(bytes, REPLACE_REQUEST_MAGIC.len() + 8).ok_or_else(invalid_request)?;
    if generation_length != UUID_V4_BYTES
        || password_length > MAXIMUM_DATABASE_READ_PASSWORD_BYTES
        || profile_length > DATABASE_READ_CONNECTION_PROFILE_MAX_BYTES
    {
        return Err(invalid_request());
    }
    let generation_end = REPLACE_REQUEST_HEADER_BYTES
        .checked_add(generation_length)
        .ok_or_else(invalid_request)?;
    let password_end = generation_end
        .checked_add(password_length)
        .ok_or_else(invalid_request)?;
    let profile_end = password_end
        .checked_add(profile_length)
        .ok_or_else(invalid_request)?;
    if profile_end != bytes.len() {
        return Err(invalid_request());
    }

    let expected_grant_generation = std::str::from_utf8(
        bytes
            .get(REPLACE_REQUEST_HEADER_BYTES..generation_end)
            .ok_or_else(invalid_request)?,
    )
    .map_err(|_| invalid_request())?
    .to_owned();
    let password = std::str::from_utf8(
        bytes
            .get(generation_end..password_end)
            .ok_or_else(invalid_request)?,
    )
    .map_err(|_| invalid_request())?
    .to_owned();
    let connection_profile_json = std::str::from_utf8(
        bytes
            .get(password_end..profile_end)
            .ok_or_else(invalid_request)?,
    )
    .map_err(|_| invalid_request())?
    .to_owned();

    Ok(SupabaseDatabaseReadCredentialReplaceRequestV1 {
        expected_grant_generation,
        password,
        connection_profile_json,
    })
}

fn status_with(
    vault: &CredentialVault,
    expected_grant_generation: &str,
) -> SupabaseDatabaseReadCredentialStatusV1 {
    if !valid_uuid_v4(expected_grant_generation) {
        return SupabaseDatabaseReadCredentialStatusV1::Invalid;
    }
    match read_database_read_credential_snapshot(vault, expected_grant_generation) {
        Ok(_) => SupabaseDatabaseReadCredentialStatusV1::Configured,
        Err(DatabaseReadCredentialSnapshotError::Missing) => {
            SupabaseDatabaseReadCredentialStatusV1::Missing
        }
        Err(DatabaseReadCredentialSnapshotError::Unavailable) => {
            SupabaseDatabaseReadCredentialStatusV1::Unavailable
        }
        Err(
            DatabaseReadCredentialSnapshotError::Failed
            | DatabaseReadCredentialSnapshotError::InvalidPassword
            | DatabaseReadCredentialSnapshotError::InvalidGrantGeneration
            | DatabaseReadCredentialSnapshotError::PendingGrantGeneration
            | DatabaseReadCredentialSnapshotError::GrantGenerationMismatch
            | DatabaseReadCredentialSnapshotError::InvalidCredentialIncarnation
            | DatabaseReadCredentialSnapshotError::InvalidConnectionProfileDigest,
        ) => SupabaseDatabaseReadCredentialStatusV1::Invalid,
    }
}

fn mutation_error(
    error: DatabaseReadCredentialMutationError,
) -> SupabaseDatabaseReadCredentialCommandError {
    command_error(match error {
        DatabaseReadCredentialMutationError::InvalidGrantGeneration => {
            SupabaseDatabaseReadCredentialCommandErrorCode::InvalidGrantGeneration
        }
        DatabaseReadCredentialMutationError::InvalidPassword => {
            SupabaseDatabaseReadCredentialCommandErrorCode::InvalidPassword
        }
        DatabaseReadCredentialMutationError::InvalidConnectionProfile => {
            SupabaseDatabaseReadCredentialCommandErrorCode::InvalidConnectionProfile
        }
        DatabaseReadCredentialMutationError::EntropyUnavailable => {
            SupabaseDatabaseReadCredentialCommandErrorCode::EntropyUnavailable
        }
        DatabaseReadCredentialMutationError::CredentialUnavailable => {
            SupabaseDatabaseReadCredentialCommandErrorCode::CredentialUnavailable
        }
        DatabaseReadCredentialMutationError::CredentialChanged => {
            SupabaseDatabaseReadCredentialCommandErrorCode::CredentialChanged
        }
        DatabaseReadCredentialMutationError::CredentialFailed => {
            SupabaseDatabaseReadCredentialCommandErrorCode::CredentialFailed
        }
    })
}

fn response_receipt(
    receipt: DatabaseReadCredentialMutationReceiptV1,
) -> SupabaseDatabaseReadCredentialMutationReceiptResponseV1 {
    SupabaseDatabaseReadCredentialMutationReceiptResponseV1 {
        format: MUTATION_RECEIPT_FORMAT,
        version: 1,
        configured: receipt.configured(),
        commit_durability: match receipt.commit_durability() {
            CredentialVaultCommitDurability::Confirmed => {
                SupabaseDatabaseReadCredentialCommitDurabilityV1::Confirmed
            }
            CredentialVaultCommitDurability::Unconfirmed => {
                SupabaseDatabaseReadCredentialCommitDurabilityV1::Unconfirmed
            }
        },
        grant_generation: receipt.grant_generation().to_owned(),
        credential_incarnation: URL_SAFE_NO_PAD.encode(receipt.credential_incarnation()),
        connection_profile_digest: receipt
            .connection_profile_digest()
            .map(|digest| URL_SAFE_NO_PAD.encode(digest)),
    }
}

#[cfg(test)]
fn replace_with(
    vault: &CredentialVault,
    request: SupabaseDatabaseReadCredentialReplaceRequestV1,
) -> Result<
    SupabaseDatabaseReadCredentialMutationReceiptResponseV1,
    SupabaseDatabaseReadCredentialCommandError,
> {
    let (expected_grant_generation, password, connection_profile_json) =
        request.into_zeroizing_parts();
    replace_parts(
        vault,
        expected_grant_generation,
        password,
        connection_profile_json,
    )
}

fn replace_parts(
    vault: &CredentialVault,
    expected_grant_generation: String,
    password: Zeroizing<String>,
    connection_profile_json: String,
) -> Result<
    SupabaseDatabaseReadCredentialMutationReceiptResponseV1,
    SupabaseDatabaseReadCredentialCommandError,
> {
    replace_database_read_credential_v1(
        vault,
        &expected_grant_generation,
        password,
        connection_profile_json.as_bytes(),
    )
    .map(response_receipt)
    .map_err(mutation_error)
}

fn clear_with(
    vault: &CredentialVault,
    request: SupabaseDatabaseReadCredentialClearRequestV1,
) -> Result<
    SupabaseDatabaseReadCredentialMutationReceiptResponseV1,
    SupabaseDatabaseReadCredentialCommandError,
> {
    clear_database_read_credential_v1(vault, &request.expected_grant_generation)
        .map(response_receipt)
        .map_err(mutation_error)
}

#[tauri::command]
pub async fn supabase_database_read_credential_status_v1(
    caller: WebviewWindow,
    vault: tauri::State<'_, CredentialVault>,
    request: TauriRequest<'_>,
) -> Result<SupabaseDatabaseReadCredentialStatusV1, SupabaseDatabaseReadCredentialCommandError> {
    require_main_caller(caller.label())?;
    let request = SupabaseDatabaseReadCredentialStatusRequestV1 {
        expected_grant_generation: generation_request(request.body(), STATUS_REQUEST_MAGIC)?,
    };
    let vault = vault.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        status_with(&vault, &request.expected_grant_generation)
    })
    .await
    .map_err(|_| command_error(SupabaseDatabaseReadCredentialCommandErrorCode::CredentialFailed))
}

#[tauri::command]
pub async fn supabase_database_read_credential_replace_v1(
    caller: WebviewWindow,
    vault: tauri::State<'_, CredentialVault>,
    request: TauriRequest<'_>,
) -> Result<
    SupabaseDatabaseReadCredentialMutationReceiptResponseV1,
    SupabaseDatabaseReadCredentialCommandError,
> {
    require_main_caller(caller.label())?;
    let request = replace_request(request.body())?;
    // Move the bounded raw-envelope copy under zeroizing ownership before any asynchronous work.
    let (expected_grant_generation, password, connection_profile_json) =
        request.into_zeroizing_parts();
    let vault = vault.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        replace_parts(
            &vault,
            expected_grant_generation,
            password,
            connection_profile_json,
        )
    })
    .await
    .map_err(|_| command_error(SupabaseDatabaseReadCredentialCommandErrorCode::CredentialFailed))?
}

#[tauri::command]
pub async fn supabase_database_read_credential_clear_v1(
    caller: WebviewWindow,
    vault: tauri::State<'_, CredentialVault>,
    request: TauriRequest<'_>,
) -> Result<
    SupabaseDatabaseReadCredentialMutationReceiptResponseV1,
    SupabaseDatabaseReadCredentialCommandError,
> {
    require_main_caller(caller.label())?;
    let request = SupabaseDatabaseReadCredentialClearRequestV1 {
        expected_grant_generation: generation_request(request.body(), CLEAR_REQUEST_MAGIC)?,
    };
    let vault = vault.inner().clone();
    tauri::async_runtime::spawn_blocking(move || clear_with(&vault, request))
        .await
        .map_err(|_| {
            command_error(SupabaseDatabaseReadCredentialCommandErrorCode::CredentialFailed)
        })?
}

#[cfg(test)]
mod tests {
    use super::*;

    const INITIAL_GENERATION: &str = "123e4567-e89b-42d3-a456-426614174000";
    const DIRECT_PROFILE: &str = r#"{"format":"openpencil.supabase-database-read-connection-profile.v1","version":1,"providerId":"supabase","environment":"staging","projectRef":"abcdefghijklmnopqrst","accountId":"account.staging_01","mode":"direct","host":"db.abcdefghijklmnopqrst.supabase.co","port":5432,"database":"postgres","user":"postgres","tlsMode":"verify-full"}"#;

    fn seeded_vault(directory: &tempfile::TempDir) -> CredentialVault {
        let vault = CredentialVault::new(directory.path().to_path_buf());
        vault
            .write_secret_for_test(
                "v1:supabase-management:default:grant-generation",
                INITIAL_GENERATION,
            )
            .expect("seed shared generation");
        vault
    }

    fn generation_envelope(magic: &[u8; 8], generation: &str) -> InvokeBody {
        let mut body = magic.to_vec();
        body.extend_from_slice(generation.as_bytes());
        InvokeBody::Raw(body)
    }

    fn replace_envelope(generation: &str, password: &str, profile: &str) -> InvokeBody {
        let mut body = REPLACE_REQUEST_MAGIC.to_vec();
        for length in [generation.len(), password.len(), profile.len()] {
            body.extend_from_slice(
                &u32::try_from(length)
                    .expect("test length fits u32")
                    .to_le_bytes(),
            );
        }
        body.extend_from_slice(generation.as_bytes());
        body.extend_from_slice(password.as_bytes());
        body.extend_from_slice(profile.as_bytes());
        InvokeBody::Raw(body)
    }

    fn replace_request_error(
        result: Result<
            SupabaseDatabaseReadCredentialReplaceRequestV1,
            SupabaseDatabaseReadCredentialCommandError,
        >,
    ) -> SupabaseDatabaseReadCredentialCommandError {
        match result {
            Ok(_) => panic!("replace request unexpectedly parsed"),
            Err(error) => error,
        }
    }

    #[test]
    fn parses_only_fixed_bounded_raw_request_envelopes() {
        assert_eq!(
            generation_request(
                &generation_envelope(STATUS_REQUEST_MAGIC, INITIAL_GENERATION),
                STATUS_REQUEST_MAGIC,
            )
            .expect("status generation envelope"),
            INITIAL_GENERATION
        );
        let password = "  database password\n";
        let parsed = replace_request(&replace_envelope(
            INITIAL_GENERATION,
            password,
            DIRECT_PROFILE,
        ))
        .expect("replace envelope");
        assert_eq!(parsed.expected_grant_generation, INITIAL_GENERATION);
        assert_eq!(parsed.password, password);
        assert_eq!(parsed.connection_profile_json, DIRECT_PROFILE);

        for body in [
            InvokeBody::Json(serde_json::Value::Null),
            InvokeBody::Raw(Vec::new()),
            generation_envelope(CLEAR_REQUEST_MAGIC, INITIAL_GENERATION),
            InvokeBody::Raw(vec![0; MAXIMUM_REPLACE_REQUEST_BYTES + 1]),
        ] {
            let error = replace_request_error(replace_request(&body));
            assert_eq!(
                error.code,
                SupabaseDatabaseReadCredentialCommandErrorCode::InvalidRequest
            );
        }
    }

    #[test]
    fn raw_request_decoder_rejects_invalid_lengths_utf8_and_trailing_bytes() {
        let invalid_generation = generation_envelope(STATUS_REQUEST_MAGIC, &"x".repeat(36));
        assert_eq!(
            generation_request(&invalid_generation, STATUS_REQUEST_MAGIC)
                .expect_err("invalid grant generation")
                .code,
            SupabaseDatabaseReadCredentialCommandErrorCode::InvalidGrantGeneration
        );

        let mut trailing = match replace_envelope(INITIAL_GENERATION, "password", DIRECT_PROFILE) {
            InvokeBody::Raw(body) => body,
            InvokeBody::Json(_) => unreachable!(),
        };
        trailing.push(0);
        assert_eq!(
            replace_request_error(replace_request(&InvokeBody::Raw(trailing))).code,
            SupabaseDatabaseReadCredentialCommandErrorCode::InvalidRequest
        );

        let mut invalid_utf8 =
            match replace_envelope(INITIAL_GENERATION, "password", DIRECT_PROFILE) {
                InvokeBody::Raw(body) => body,
                InvokeBody::Json(_) => unreachable!(),
            };
        invalid_utf8[REPLACE_REQUEST_HEADER_BYTES + UUID_V4_BYTES] = 0xff;
        assert_eq!(
            replace_request_error(replace_request(&InvokeBody::Raw(invalid_utf8))).code,
            SupabaseDatabaseReadCredentialCommandErrorCode::InvalidRequest
        );
    }

    #[test]
    fn status_is_secret_free_and_maps_missing_unavailable_invalid_and_configured() {
        let directory = tempfile::tempdir().expect("temporary app data directory");
        let vault = seeded_vault(&directory);
        assert_eq!(
            status_with(&vault, INITIAL_GENERATION),
            SupabaseDatabaseReadCredentialStatusV1::Missing
        );
        assert_eq!(
            status_with(&CredentialVault::unavailable(), INITIAL_GENERATION),
            SupabaseDatabaseReadCredentialStatusV1::Unavailable
        );
        assert_eq!(
            status_with(&vault, "pending:invalid"),
            SupabaseDatabaseReadCredentialStatusV1::Invalid
        );

        let response = replace_with(
            &vault,
            SupabaseDatabaseReadCredentialReplaceRequestV1 {
                expected_grant_generation: INITIAL_GENERATION.to_owned(),
                password: "  database password\n".to_owned(),
                connection_profile_json: DIRECT_PROFILE.to_owned(),
            },
        )
        .expect("replace credential");
        assert_eq!(
            status_with(&vault, &response.grant_generation),
            SupabaseDatabaseReadCredentialStatusV1::Configured
        );
        assert_eq!(
            status_with(&vault, INITIAL_GENERATION),
            SupabaseDatabaseReadCredentialStatusV1::Invalid
        );

        let serialized = serde_json::to_string(&response).expect("serialize receipt");
        assert!(!serialized.contains("database password"));
        assert!(!serialized.contains("db.abcdefghijklmnopqrst.supabase.co"));
        assert!(!serialized.contains(DIRECT_PROFILE));
    }

    #[test]
    fn replace_and_clear_rotate_generation_and_return_only_canonical_markers() {
        let directory = tempfile::tempdir().expect("temporary app data directory");
        let vault = seeded_vault(&directory);
        let replaced = replace_with(
            &vault,
            SupabaseDatabaseReadCredentialReplaceRequestV1 {
                expected_grant_generation: INITIAL_GENERATION.to_owned(),
                password: "password".to_owned(),
                connection_profile_json: DIRECT_PROFILE.to_owned(),
            },
        )
        .expect("replace credential");
        assert!(replaced.configured);
        assert_eq!(
            replaced.commit_durability,
            SupabaseDatabaseReadCredentialCommitDurabilityV1::Confirmed
        );
        assert!(valid_uuid_v4(&replaced.grant_generation));
        assert_ne!(replaced.grant_generation, INITIAL_GENERATION);
        assert_eq!(replaced.credential_incarnation.len(), 43);
        assert_eq!(
            replaced.connection_profile_digest.as_deref(),
            Some("4hodbEkFZompjmmZ5HCeqfAJMqz67OWIyIjrF49SwfA")
        );

        let cleared = clear_with(
            &vault,
            SupabaseDatabaseReadCredentialClearRequestV1 {
                expected_grant_generation: replaced.grant_generation,
            },
        )
        .expect("clear credential");
        assert!(!cleared.configured);
        assert_eq!(
            cleared.commit_durability,
            SupabaseDatabaseReadCredentialCommitDurabilityV1::Confirmed
        );
        assert!(valid_uuid_v4(&cleared.grant_generation));
        assert!(cleared.connection_profile_digest.is_none());
        assert_eq!(
            status_with(&vault, &cleared.grant_generation),
            SupabaseDatabaseReadCredentialStatusV1::Missing
        );
    }

    #[test]
    fn stale_mutation_and_non_main_callers_fail_without_secret_payloads() {
        let directory = tempfile::tempdir().expect("temporary app data directory");
        let vault = seeded_vault(&directory);
        let error = clear_with(
            &vault,
            SupabaseDatabaseReadCredentialClearRequestV1 {
                expected_grant_generation: "123e4567-e89b-42d3-b456-426614174000".to_owned(),
            },
        )
        .expect_err("stale mutation must fail");
        assert_eq!(
            error.code,
            SupabaseDatabaseReadCredentialCommandErrorCode::CredentialChanged
        );
        assert!(!error.message.contains(INITIAL_GENERATION));

        assert!(require_main_caller("main").is_ok());
        for label in ["lowcode-preview-popout", "ai-chat-popout", "preview", ""] {
            let error = require_main_caller(label).expect_err("non-main caller must fail");
            assert_eq!(
                error.code,
                SupabaseDatabaseReadCredentialCommandErrorCode::InvalidAuthority
            );
            if !label.is_empty() {
                assert!(!error.message.contains(label));
            }
        }
    }
}
