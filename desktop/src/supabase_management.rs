use crate::credentials::{CredentialVault, CredentialVaultSnapshotError};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use reqwest::{
    header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, CONTENT_TYPE, RETRY_AFTER},
    redirect::Policy,
    Client, Method, Response, StatusCode,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
use tauri::WebviewWindow;
use zeroize::Zeroizing;

const MANAGEMENT_ORIGIN: &str = "https://api.supabase.com";
const QUERY_VERSION: &str = "openpencil-pg-catalog-v6";
const QUERY_SOURCE: &str =
    include_str!("../../src/app/plugins/host/deployment/supabase/pg-catalog-v6.sql");
const READ_PAT_ACCOUNT: &str = "v1:supabase-management:default:personal-access-token";
const WRITE_PAT_ACCOUNT: &str =
    "v1:supabase-management:default:database-write-personal-access-token";
const GRANT_GENERATION_ACCOUNT: &str = "v1:supabase-management:default:grant-generation";
const MAX_PAT_BYTES: usize = 4_096;
const MAX_PROJECT_RESPONSE_BYTES: usize = 128 * 1024;
const MAX_CATALOG_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_RETRY_AFTER_SECONDS: u32 = 3_600;
const QUERY_ROW_LIMITS: [u64; 12] = [
    2, 1_025, 20_001, 2_049, 2_049, 1_025, 129, 1_025, 2_049, 2_049, 2_049, 2_049,
];
static INSPECTION_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupabaseManagementPgCatalogInspectRequestV1 {
    project_ref: String,
    expected_organization_id: ExpectedOrganizationId,
    expected_grant_generation: String,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum ExpectedOrganizationId {
    Bound(String),
    Discovery(()),
}

impl ExpectedOrganizationId {
    fn as_deref(&self) -> Option<&str> {
        match self {
            Self::Bound(value) => Some(value),
            Self::Discovery(()) => None,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupabaseManagementPgCatalogInspectResultV1 {
    project_ref: String,
    organization_id: String,
    grant_generation: String,
    query_version: &'static str,
    /// SHA-256 base64url of the exact JSON request body (query plus parameters).
    query_digest: String,
    query_response: Value,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SupabaseManagementNativeErrorCode {
    InvalidRequest,
    InvalidAuthority,
    CredentialMissing,
    WriteCredentialMissing,
    CredentialNotIndependent,
    CredentialChanged,
    CredentialUnavailable,
    NetworkFailed,
    HttpError,
    ResponseTooLarge,
    InvalidResponse,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupabaseManagementNativeError {
    code: SupabaseManagementNativeErrorCode,
    message: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    http_status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    retry_after_seconds: Option<u32>,
}

impl SupabaseManagementNativeError {
    fn new(code: SupabaseManagementNativeErrorCode, message: &'static str) -> Self {
        Self {
            code,
            message,
            http_status: None,
            retry_after_seconds: None,
        }
    }

    fn http(status: StatusCode, headers: &HeaderMap) -> Self {
        Self {
            code: SupabaseManagementNativeErrorCode::HttpError,
            message: "Supabase Management returned an unexpected HTTP response",
            http_status: Some(status.as_u16()),
            retry_after_seconds: retry_after_seconds(status, headers),
        }
    }
}

struct ManagementCredentialSnapshot {
    personal_access_token: Zeroizing<String>,
    database_write_personal_access_token: Option<Zeroizing<String>>,
    grant_generation: String,
}

struct InspectionSingleFlightGuard<'a> {
    in_flight: &'a AtomicBool,
}

impl<'a> InspectionSingleFlightGuard<'a> {
    fn acquire(in_flight: &'a AtomicBool) -> Result<Self, SupabaseManagementNativeError> {
        if in_flight
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Err(SupabaseManagementNativeError::new(
                SupabaseManagementNativeErrorCode::InvalidRequest,
                "A Supabase Management inspection is already running",
            ));
        }
        Ok(Self { in_flight })
    }
}

impl Drop for InspectionSingleFlightGuard<'_> {
    fn drop(&mut self) {
        self.in_flight.store(false, Ordering::Release);
    }
}

#[derive(Serialize)]
struct ReadOnlyQueryBody<'a> {
    query: &'a str,
    parameters: Vec<Value>,
}

fn aggregate_sql() -> &'static str {
    QUERY_SOURCE
        .strip_suffix("\r\n")
        .or_else(|| QUERY_SOURCE.strip_suffix('\n'))
        .unwrap_or(QUERY_SOURCE)
}

fn request_digest() -> Result<String, SupabaseManagementNativeError> {
    Ok(URL_SAFE_NO_PAD.encode(Sha256::digest(catalog_request_body()?)))
}

fn query_parameters() -> Vec<Value> {
    QUERY_ROW_LIMITS
        .into_iter()
        .flat_map(|row_limit| [Value::String("public".to_owned()), Value::from(row_limit)])
        .collect()
}

fn catalog_request_body() -> Result<Vec<u8>, SupabaseManagementNativeError> {
    serde_json::to_vec(&ReadOnlyQueryBody {
        query: aggregate_sql(),
        parameters: query_parameters(),
    })
    .map_err(|_| {
        SupabaseManagementNativeError::new(
            SupabaseManagementNativeErrorCode::InvalidRequest,
            "The fixed Supabase catalog request could not be encoded",
        )
    })
}

fn valid_project_ref(value: &str) -> bool {
    value.len() == 20 && value.bytes().all(|byte| byte.is_ascii_lowercase())
}

fn valid_stable_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric() || (index > 0 && matches!(byte, b'.' | b'_' | b'-'))
        })
}

fn valid_uuid_v4(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => *byte == b'-',
            14 => *byte == b'4',
            19 => matches!(*byte, b'8' | b'9' | b'a' | b'b'),
            _ => byte.is_ascii_digit() || matches!(*byte, b'a'..=b'f'),
        })
}

fn valid_pat(value: &str) -> bool {
    value.len() >= 16
        && value.len() <= MAX_PAT_BYTES
        && value.trim() == value
        && !value.chars().any(char::is_control)
        && !value.chars().any(char::is_whitespace)
}

fn validate_request(
    request: &SupabaseManagementPgCatalogInspectRequestV1,
) -> Result<(), SupabaseManagementNativeError> {
    if !valid_project_ref(&request.project_ref)
        || request
            .expected_organization_id
            .as_deref()
            .is_some_and(|value| !valid_stable_id(value))
        || !valid_uuid_v4(&request.expected_grant_generation)
    {
        return Err(SupabaseManagementNativeError::new(
            SupabaseManagementNativeErrorCode::InvalidRequest,
            "The Supabase Management inspection request is invalid",
        ));
    }
    Ok(())
}

fn require_main_caller_label(label: &str) -> Result<(), SupabaseManagementNativeError> {
    if label != "main" {
        return Err(SupabaseManagementNativeError::new(
            SupabaseManagementNativeErrorCode::InvalidAuthority,
            "Supabase Management inspection is available only to the main window",
        ));
    }
    Ok(())
}

fn validate_credential_values(
    personal_access_token: Option<Zeroizing<String>>,
    database_write_personal_access_token: Option<Zeroizing<String>>,
    grant_generation: Option<Zeroizing<String>>,
    expected_grant_generation: &str,
    require_independent_write_credential: bool,
) -> Result<ManagementCredentialSnapshot, SupabaseManagementNativeError> {
    let (Some(personal_access_token), Some(grant_generation)) =
        (personal_access_token, grant_generation)
    else {
        return Err(SupabaseManagementNativeError::new(
            SupabaseManagementNativeErrorCode::CredentialMissing,
            "The Supabase Management credential is not configured",
        ));
    };
    if !valid_pat(&personal_access_token) {
        return Err(SupabaseManagementNativeError::new(
            SupabaseManagementNativeErrorCode::CredentialChanged,
            "The Supabase Management credential changed before inspection",
        ));
    }
    let database_write_personal_access_token = if require_independent_write_credential {
        let Some(database_write_personal_access_token) = database_write_personal_access_token
        else {
            return Err(SupabaseManagementNativeError::new(
                SupabaseManagementNativeErrorCode::WriteCredentialMissing,
                "The independent Supabase Management database-write credential is not configured",
            ));
        };
        if !valid_pat(&database_write_personal_access_token) {
            return Err(SupabaseManagementNativeError::new(
                SupabaseManagementNativeErrorCode::CredentialChanged,
                "The Supabase Management credential changed before inspection",
            ));
        }
        if database_write_personal_access_token.as_str() == personal_access_token.as_str() {
            return Err(SupabaseManagementNativeError::new(
                SupabaseManagementNativeErrorCode::CredentialNotIndependent,
                "The Supabase Management read and database-write credentials must be independent",
            ));
        }
        Some(database_write_personal_access_token)
    } else {
        None
    };
    if grant_generation.starts_with("pending:")
        || !valid_uuid_v4(&grant_generation)
        || grant_generation.as_str() != expected_grant_generation
    {
        return Err(SupabaseManagementNativeError::new(
            SupabaseManagementNativeErrorCode::CredentialChanged,
            "The Supabase Management credential changed before inspection",
        ));
    }
    Ok(ManagementCredentialSnapshot {
        personal_access_token,
        database_write_personal_access_token,
        grant_generation: grant_generation.to_string(),
    })
}

fn same_credential_snapshot(
    before: &ManagementCredentialSnapshot,
    after: &ManagementCredentialSnapshot,
) -> bool {
    before.grant_generation == after.grant_generation
        && before.personal_access_token.as_str() == after.personal_access_token.as_str()
        && before
            .database_write_personal_access_token
            .as_ref()
            .map(|value| value.as_str())
            == after
                .database_write_personal_access_token
                .as_ref()
                .map(|value| value.as_str())
}

fn read_credential_snapshot(
    vault: &CredentialVault,
    expected_grant_generation: &str,
    require_independent_write_credential: bool,
) -> Result<ManagementCredentialSnapshot, SupabaseManagementNativeError> {
    let map_snapshot_error = |error| match error {
        CredentialVaultSnapshotError::Unavailable => SupabaseManagementNativeError::new(
            SupabaseManagementNativeErrorCode::CredentialUnavailable,
            "The app-local credential store is unavailable",
        ),
        CredentialVaultSnapshotError::Failed => SupabaseManagementNativeError::new(
            SupabaseManagementNativeErrorCode::CredentialUnavailable,
            "The app-local credential store could not be read",
        ),
    };
    let (personal_access_token, database_write_personal_access_token, grant_generation) =
        if require_independent_write_credential {
            let [personal_access_token, database_write_personal_access_token, grant_generation] =
                vault
                    .read_secret_snapshot([
                        READ_PAT_ACCOUNT,
                        WRITE_PAT_ACCOUNT,
                        GRANT_GENERATION_ACCOUNT,
                    ])
                    .map_err(map_snapshot_error)?;
            (
                personal_access_token,
                database_write_personal_access_token,
                grant_generation,
            )
        } else {
            let [personal_access_token, grant_generation] = vault
                .read_secret_snapshot([READ_PAT_ACCOUNT, GRANT_GENERATION_ACCOUNT])
                .map_err(map_snapshot_error)?;
            (personal_access_token, None, grant_generation)
        };
    validate_credential_values(
        personal_access_token,
        database_write_personal_access_token,
        grant_generation,
        expected_grant_generation,
        require_independent_write_credential,
    )
}

fn project_url(project_ref: &str) -> String {
    format!("{MANAGEMENT_ORIGIN}/v1/projects/{project_ref}")
}

fn catalog_url(project_ref: &str) -> String {
    format!("{MANAGEMENT_ORIGIN}/v1/projects/{project_ref}/database/query/read-only")
}

fn http_client() -> Result<Client, SupabaseManagementNativeError> {
    Client::builder()
        .redirect(Policy::none())
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|_| {
            SupabaseManagementNativeError::new(
                SupabaseManagementNativeErrorCode::NetworkFailed,
                "The Supabase Management client could not be created",
            )
        })
}

fn authorized_request(
    client: &Client,
    method: Method,
    url: &str,
    personal_access_token: &str,
) -> Result<reqwest::RequestBuilder, SupabaseManagementNativeError> {
    let authorization = Zeroizing::new(format!("Bearer {personal_access_token}"));
    let mut header = HeaderValue::from_str(&authorization).map_err(|_| {
        SupabaseManagementNativeError::new(
            SupabaseManagementNativeErrorCode::CredentialChanged,
            "The Supabase Management credential changed before inspection",
        )
    })?;
    header.set_sensitive(true);
    Ok(client
        .request(method, url)
        .header(ACCEPT, "application/json")
        .header(AUTHORIZATION, header))
}

fn retry_after_seconds(status: StatusCode, headers: &HeaderMap) -> Option<u32> {
    if status != StatusCode::TOO_MANY_REQUESTS {
        return None;
    }
    headers
        .get(RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|value| *value <= MAX_RETRY_AFTER_SECONDS)
}

fn json_media_type(headers: &HeaderMap) -> bool {
    headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("application/json"))
}

async fn bounded_response_body(
    response: &mut Response,
    max_bytes: usize,
) -> Result<Vec<u8>, SupabaseManagementNativeError> {
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes as u64)
    {
        return Err(SupabaseManagementNativeError::new(
            SupabaseManagementNativeErrorCode::ResponseTooLarge,
            "The Supabase Management response exceeded the byte limit",
        ));
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| {
        SupabaseManagementNativeError::new(
            SupabaseManagementNativeErrorCode::NetworkFailed,
            "The Supabase Management response could not be read",
        )
    })? {
        if body.len().saturating_add(chunk.len()) > max_bytes {
            return Err(SupabaseManagementNativeError::new(
                SupabaseManagementNativeErrorCode::ResponseTooLarge,
                "The Supabase Management response exceeded the byte limit",
            ));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

async fn response_json(
    mut response: Response,
    expected_url: &str,
    expected_status: StatusCode,
    max_bytes: usize,
) -> Result<Value, SupabaseManagementNativeError> {
    if response.url().as_str() != expected_url {
        return Err(SupabaseManagementNativeError::new(
            SupabaseManagementNativeErrorCode::InvalidResponse,
            "Supabase Management returned an unexpected response URL",
        ));
    }
    if response.status() != expected_status {
        return Err(SupabaseManagementNativeError::http(
            response.status(),
            response.headers(),
        ));
    }
    if !json_media_type(response.headers()) {
        return Err(SupabaseManagementNativeError::new(
            SupabaseManagementNativeErrorCode::InvalidResponse,
            "Supabase Management returned a non-JSON response",
        ));
    }
    let body = bounded_response_body(&mut response, max_bytes).await?;
    serde_json::from_slice(&body).map_err(|_| {
        SupabaseManagementNativeError::new(
            SupabaseManagementNativeErrorCode::InvalidResponse,
            "Supabase Management returned invalid JSON",
        )
    })
}

async fn verify_project_authority(
    client: &Client,
    request: &SupabaseManagementPgCatalogInspectRequestV1,
    credentials: &ManagementCredentialSnapshot,
) -> Result<String, SupabaseManagementNativeError> {
    let url = project_url(&request.project_ref);
    let response = authorized_request(
        client,
        Method::GET,
        &url,
        &credentials.personal_access_token,
    )?
    .send()
    .await
    .map_err(|_| {
        SupabaseManagementNativeError::new(
            SupabaseManagementNativeErrorCode::NetworkFailed,
            "The Supabase Management project request failed",
        )
    })?;
    let value = response_json(response, &url, StatusCode::OK, MAX_PROJECT_RESPONSE_BYTES).await?;
    parse_project_authority(value, request)
}

fn parse_project_authority(
    value: Value,
    request: &SupabaseManagementPgCatalogInspectRequestV1,
) -> Result<String, SupabaseManagementNativeError> {
    let Some(project) = value.as_object() else {
        return Err(SupabaseManagementNativeError::new(
            SupabaseManagementNativeErrorCode::InvalidResponse,
            "Supabase Management returned an invalid project response",
        ));
    };
    let project_ref = project.get("ref").and_then(Value::as_str);
    let organization_id = project.get("organization_id").and_then(Value::as_str);
    let organization_slug = project.get("organization_slug").and_then(Value::as_str);
    if project_ref != Some(request.project_ref.as_str())
        || !organization_id.is_some_and(valid_stable_id)
        || !organization_slug.is_some_and(valid_stable_id)
        || request
            .expected_organization_id
            .as_deref()
            .is_some_and(|expected| organization_id != Some(expected))
    {
        return Err(SupabaseManagementNativeError::new(
            SupabaseManagementNativeErrorCode::InvalidAuthority,
            "The Supabase project authority does not match the reviewed binding",
        ));
    }
    organization_id.map(str::to_owned).ok_or_else(|| {
        SupabaseManagementNativeError::new(
            SupabaseManagementNativeErrorCode::InvalidAuthority,
            "The Supabase project authority does not match the reviewed binding",
        )
    })
}

async fn inspect_catalog(
    client: &Client,
    project_ref: &str,
    credentials: &ManagementCredentialSnapshot,
) -> Result<Value, SupabaseManagementNativeError> {
    let url = catalog_url(project_ref);
    let body = catalog_request_body()?;
    let response = authorized_request(
        client,
        Method::POST,
        &url,
        &credentials.personal_access_token,
    )?
    .header(CONTENT_TYPE, "application/json")
    .body(body)
    .send()
    .await
    .map_err(|_| {
        SupabaseManagementNativeError::new(
            SupabaseManagementNativeErrorCode::NetworkFailed,
            "The Supabase Management catalog request failed",
        )
    })?;
    let value = response_json(
        response,
        &url,
        StatusCode::CREATED,
        MAX_CATALOG_RESPONSE_BYTES,
    )
    .await?;
    if !value
        .as_array()
        .is_some_and(|rows| rows.len() == 1 && rows[0].is_object())
    {
        return Err(SupabaseManagementNativeError::new(
            SupabaseManagementNativeErrorCode::InvalidResponse,
            "Supabase Management returned an invalid catalog envelope",
        ));
    }
    Ok(value)
}

#[tauri::command]
pub async fn supabase_management_inspect_pg_catalog_v1(
    caller: WebviewWindow,
    vault: tauri::State<'_, CredentialVault>,
    request: SupabaseManagementPgCatalogInspectRequestV1,
) -> Result<SupabaseManagementPgCatalogInspectResultV1, SupabaseManagementNativeError> {
    require_main_caller_label(caller.label())?;
    validate_request(&request)?;
    let _single_flight = InspectionSingleFlightGuard::acquire(&INSPECTION_IN_FLIGHT)?;
    let expected_grant_generation = request.expected_grant_generation.clone();
    let require_independent_write_credential =
        request.expected_organization_id.as_deref().is_some();
    let vault = vault.inner().clone();
    let initial_vault = vault.clone();
    let credentials = tauri::async_runtime::spawn_blocking(move || {
        read_credential_snapshot(
            &initial_vault,
            &expected_grant_generation,
            require_independent_write_credential,
        )
    })
    .await
    .map_err(|_| {
        SupabaseManagementNativeError::new(
            SupabaseManagementNativeErrorCode::CredentialUnavailable,
            "The app-local credential store could not be read",
        )
    })??;
    let client = http_client()?;
    let organization_id = verify_project_authority(&client, &request, &credentials).await?;
    let query_response = inspect_catalog(&client, &request.project_ref, &credentials).await?;
    let final_expected_grant_generation = request.expected_grant_generation.clone();
    let final_credentials = tauri::async_runtime::spawn_blocking(move || {
        read_credential_snapshot(
            &vault,
            &final_expected_grant_generation,
            require_independent_write_credential,
        )
    })
    .await
    .map_err(|_| {
        SupabaseManagementNativeError::new(
            SupabaseManagementNativeErrorCode::CredentialUnavailable,
            "The app-local credential store could not be read",
        )
    })?
    .map_err(|error| match error.code {
        SupabaseManagementNativeErrorCode::CredentialMissing
        | SupabaseManagementNativeErrorCode::WriteCredentialMissing
        | SupabaseManagementNativeErrorCode::CredentialNotIndependent
        | SupabaseManagementNativeErrorCode::CredentialChanged => {
            SupabaseManagementNativeError::new(
                SupabaseManagementNativeErrorCode::CredentialChanged,
                "The Supabase Management credential changed during inspection",
            )
        }
        _ => error,
    })?;
    if !same_credential_snapshot(&credentials, &final_credentials) {
        return Err(SupabaseManagementNativeError::new(
            SupabaseManagementNativeErrorCode::CredentialChanged,
            "The Supabase Management credential changed during inspection",
        ));
    }
    Ok(SupabaseManagementPgCatalogInspectResultV1 {
        project_ref: request.project_ref,
        organization_id,
        grant_generation: credentials.grant_generation,
        query_version: QUERY_VERSION,
        query_digest: request_digest()?,
        query_response,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread::{self, JoinHandle},
    };

    const PROJECT_REF: &str = "enekobitnhobuiuamvqj";
    const ORGANIZATION_ID: &str = "organization-123";
    const GRANT_GENERATION: &str = "123e4567-e89b-42d3-a456-426614174000";
    const PAT: &str = "sbp_test_secret_value_123456";
    const WRITE_PAT: &str = "sbp_test_write_secret_value_123456";

    async fn mock_http_response(raw_response: Vec<u8>) -> (String, Response, JoinHandle<()>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind loopback response server");
        let address = listener.local_addr().expect("loopback server address");
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept loopback request");
            let timeout = Some(Duration::from_secs(2));
            stream
                .set_read_timeout(timeout)
                .expect("bound loopback read timeout");
            stream
                .set_write_timeout(timeout)
                .expect("bound loopback write timeout");
            let mut request = Vec::new();
            let mut chunk = [0_u8; 1_024];
            while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                let read = stream.read(&mut chunk).expect("read loopback request");
                assert!(read > 0, "loopback request ended before its headers");
                assert!(
                    request.len().saturating_add(read) <= 8 * 1_024,
                    "loopback request headers exceeded the test bound"
                );
                request.extend_from_slice(&chunk[..read]);
            }
            stream
                .write_all(&raw_response)
                .expect("write loopback response");
            stream.flush().expect("flush loopback response");
        });
        let url = format!("http://{address}/catalog");
        let response = Client::builder()
            .redirect(Policy::none())
            .timeout(Duration::from_secs(2))
            .build()
            .expect("build loopback client")
            .get(&url)
            .send()
            .await
            .expect("request loopback response");
        (url, response, server)
    }

    fn fixed_length_response(
        status: &str,
        content_type: &str,
        extra_headers: &str,
        body: &[u8],
    ) -> Vec<u8> {
        let mut response = format!(
            "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\n{extra_headers}Connection: close\r\n\r\n",
            body.len()
        )
        .into_bytes();
        response.extend_from_slice(body);
        response
    }

    fn join_mock_server(server: JoinHandle<()>) {
        server.join().expect("join loopback response server");
    }

    fn request() -> SupabaseManagementPgCatalogInspectRequestV1 {
        SupabaseManagementPgCatalogInspectRequestV1 {
            project_ref: PROJECT_REF.to_owned(),
            expected_organization_id: ExpectedOrganizationId::Bound(ORGANIZATION_ID.to_owned()),
            expected_grant_generation: GRANT_GENERATION.to_owned(),
        }
    }

    #[test]
    fn binds_only_the_fixed_management_endpoints() {
        assert_eq!(
            project_url(PROJECT_REF),
            "https://api.supabase.com/v1/projects/enekobitnhobuiuamvqj"
        );
        assert_eq!(
            catalog_url(PROJECT_REF),
            "https://api.supabase.com/v1/projects/enekobitnhobuiuamvqj/database/query/read-only"
        );
    }

    #[test]
    fn serializes_only_the_shared_fixed_query_and_parameters() {
        let body: Value = serde_json::from_slice(&catalog_request_body().expect("fixed body"))
            .expect("fixed JSON");
        let object = body.as_object().expect("request object");
        assert_eq!(object.len(), 2);
        assert_eq!(
            object.get("query").and_then(Value::as_str),
            Some(aggregate_sql())
        );
        assert_eq!(
            object.get("parameters").and_then(Value::as_array),
            Some(&query_parameters())
        );
        assert!(aggregate_sql().contains("txid_current_snapshot()"));
        assert!(!aggregate_sql().contains(PAT));
    }

    #[test]
    fn rejects_unbound_request_fields_before_vault_or_network_access() {
        assert!(validate_request(&request()).is_ok());
        for invalid_project_ref in ["too-short", "enekobitnhobuiuamvq1", "ENEKOBITNHOBUIUAMVQJ"] {
            let mut invalid = request();
            invalid.project_ref = invalid_project_ref.to_owned();
            assert_eq!(
                validate_request(&invalid)
                    .expect_err("invalid project")
                    .code,
                SupabaseManagementNativeErrorCode::InvalidRequest
            );
        }
        let mut invalid = request();
        invalid.expected_grant_generation =
            "pending:123e4567-e89b-42d3-a456-426614174000".to_owned();
        assert!(validate_request(&invalid).is_err());
    }

    #[test]
    fn rejects_every_non_main_command_caller() {
        assert!(require_main_caller_label("main").is_ok());
        for label in ["lowcode-preview-popout", "ai-chat-popout", "preview", ""] {
            assert_eq!(
                require_main_caller_label(label)
                    .err()
                    .expect("non-main caller")
                    .code,
                SupabaseManagementNativeErrorCode::InvalidAuthority
            );
        }
    }

    #[test]
    fn single_flight_rejects_a_second_inspection_and_releases_after_cancellation() {
        let in_flight = AtomicBool::new(false);
        let guard = InspectionSingleFlightGuard::acquire(&in_flight).expect("first inspection");
        assert!(in_flight.load(Ordering::Acquire));
        assert_eq!(
            InspectionSingleFlightGuard::acquire(&in_flight)
                .err()
                .expect("concurrent inspection")
                .code,
            SupabaseManagementNativeErrorCode::InvalidRequest
        );

        let cancelled_operation = async move {
            let _guard = guard;
            std::future::pending::<()>().await;
        };
        drop(cancelled_operation);

        let next = InspectionSingleFlightGuard::acquire(&in_flight)
            .expect("single-flight must release when its future is dropped");
        drop(next);
        assert!(!in_flight.load(Ordering::Acquire));
    }

    #[test]
    fn safely_allows_explicit_organization_discovery() {
        let mut discovery = request();
        discovery.expected_organization_id = ExpectedOrganizationId::Discovery(());
        assert!(validate_request(&discovery).is_ok());
        assert_eq!(
            parse_project_authority(
                serde_json::json!({
                    "ref": PROJECT_REF,
                    "organization_id": ORGANIZATION_ID,
                    "organization_slug": "open-pencil-staging"
                }),
                &discovery,
            )
            .expect("discovered authority"),
            ORGANIZATION_ID
        );
        let mut mismatched = request();
        mismatched.expected_organization_id =
            ExpectedOrganizationId::Bound("other-organization".to_owned());
        assert_eq!(
            parse_project_authority(
                serde_json::json!({
                    "ref": PROJECT_REF,
                    "organization_id": ORGANIZATION_ID,
                    "organization_slug": "open-pencil-staging"
                }),
                &mismatched,
            )
            .err()
            .expect("bound mismatch")
            .code,
            SupabaseManagementNativeErrorCode::InvalidAuthority
        );
    }

    #[test]
    fn requires_the_explicit_nullable_organization_field() {
        let discovery: SupabaseManagementPgCatalogInspectRequestV1 =
            serde_json::from_value(serde_json::json!({
                "projectRef": PROJECT_REF,
                "expectedOrganizationId": null,
                "expectedGrantGeneration": GRANT_GENERATION
            }))
            .expect("explicit discovery request");
        assert!(matches!(
            discovery.expected_organization_id,
            ExpectedOrganizationId::Discovery(())
        ));
        assert!(
            serde_json::from_value::<SupabaseManagementPgCatalogInspectRequestV1>(
                serde_json::json!({
                    "projectRef": PROJECT_REF,
                    "expectedGrantGeneration": GRANT_GENERATION
                })
            )
            .is_err()
        );
    }

    #[test]
    fn rejects_missing_pending_or_mismatched_credential_snapshots() {
        assert_eq!(
            validate_credential_values(None, None, None, GRANT_GENERATION, false)
                .err()
                .expect("missing")
                .code,
            SupabaseManagementNativeErrorCode::CredentialMissing
        );
        for generation in [
            "pending:123e4567-e89b-42d3-a456-426614174000",
            "123e4567-e89b-42d3-a456-426614174001",
        ] {
            assert_eq!(
                validate_credential_values(
                    Some(Zeroizing::new(PAT.to_owned())),
                    None,
                    Some(Zeroizing::new(generation.to_owned())),
                    GRANT_GENERATION,
                    false,
                )
                .err()
                .expect("credential rotation")
                .code,
                SupabaseManagementNativeErrorCode::CredentialChanged
            );
        }
    }

    #[test]
    fn bound_authority_requires_an_independent_write_credential() {
        let discovery = validate_credential_values(
            Some(Zeroizing::new(PAT.to_owned())),
            None,
            Some(Zeroizing::new(GRANT_GENERATION.to_owned())),
            GRANT_GENERATION,
            false,
        )
        .expect("review discovery does not require a write credential");
        assert!(discovery.database_write_personal_access_token.is_none());

        assert_eq!(
            validate_credential_values(
                Some(Zeroizing::new(PAT.to_owned())),
                None,
                Some(Zeroizing::new(GRANT_GENERATION.to_owned())),
                GRANT_GENERATION,
                true,
            )
            .err()
            .expect("missing write credential")
            .code,
            SupabaseManagementNativeErrorCode::WriteCredentialMissing
        );
        assert_eq!(
            validate_credential_values(
                Some(Zeroizing::new(PAT.to_owned())),
                Some(Zeroizing::new(PAT.to_owned())),
                Some(Zeroizing::new(GRANT_GENERATION.to_owned())),
                GRANT_GENERATION,
                true,
            )
            .err()
            .expect("shared read/write credential")
            .code,
            SupabaseManagementNativeErrorCode::CredentialNotIndependent
        );
        assert_eq!(
            validate_credential_values(
                Some(Zeroizing::new(PAT.to_owned())),
                Some(Zeroizing::new("invalid write PAT".to_owned())),
                Some(Zeroizing::new(GRANT_GENERATION.to_owned())),
                GRANT_GENERATION,
                true,
            )
            .err()
            .expect("invalid write credential")
            .code,
            SupabaseManagementNativeErrorCode::CredentialChanged
        );
        let bound = validate_credential_values(
            Some(Zeroizing::new(PAT.to_owned())),
            Some(Zeroizing::new(WRITE_PAT.to_owned())),
            Some(Zeroizing::new(GRANT_GENERATION.to_owned())),
            GRANT_GENERATION,
            true,
        )
        .expect("independent bound credentials");
        assert_eq!(
            bound
                .database_write_personal_access_token
                .as_ref()
                .map(|value| value.as_str()),
            Some(WRITE_PAT)
        );
    }

    #[test]
    fn query_identity_is_stable_and_errors_do_not_echo_credentials() {
        assert_eq!(QUERY_VERSION, "openpencil-pg-catalog-v6");
        assert_eq!(
            request_digest().expect("request digest"),
            "jwBPA-A8dfd9Xz36lHlgoYFr_jVfppNhm1vl8bPSeNw"
        );
        let mut altered_parameters = query_parameters();
        altered_parameters[1] = Value::from(3_u64);
        let altered_body = serde_json::to_vec(&ReadOnlyQueryBody {
            query: aggregate_sql(),
            parameters: altered_parameters,
        })
        .expect("altered body");
        let altered_digest = URL_SAFE_NO_PAD.encode(Sha256::digest(altered_body));
        assert_ne!(altered_digest, request_digest().expect("request digest"));
        let serialized = serde_json::to_string(&SupabaseManagementNativeError::new(
            SupabaseManagementNativeErrorCode::NetworkFailed,
            "The Supabase Management request failed",
        ))
        .expect("serialized error");
        assert!(!serialized.contains(PAT));
        assert!(!serialized.contains("SELECT"));
    }

    #[test]
    fn detects_read_write_or_generation_rotation_between_network_boundaries() {
        let before = validate_credential_values(
            Some(Zeroizing::new(PAT.to_owned())),
            Some(Zeroizing::new(WRITE_PAT.to_owned())),
            Some(Zeroizing::new(GRANT_GENERATION.to_owned())),
            GRANT_GENERATION,
            true,
        )
        .expect("initial credentials");
        let same = validate_credential_values(
            Some(Zeroizing::new(PAT.to_owned())),
            Some(Zeroizing::new(WRITE_PAT.to_owned())),
            Some(Zeroizing::new(GRANT_GENERATION.to_owned())),
            GRANT_GENERATION,
            true,
        )
        .expect("same credentials");
        let changed_pat = validate_credential_values(
            Some(Zeroizing::new("sbp_changed_secret_value_123456".to_owned())),
            Some(Zeroizing::new(WRITE_PAT.to_owned())),
            Some(Zeroizing::new(GRANT_GENERATION.to_owned())),
            GRANT_GENERATION,
            true,
        )
        .expect("changed PAT snapshot");
        let changed_write_pat = validate_credential_values(
            Some(Zeroizing::new(PAT.to_owned())),
            Some(Zeroizing::new(
                "sbp_changed_write_secret_value_123456".to_owned(),
            )),
            Some(Zeroizing::new(GRANT_GENERATION.to_owned())),
            GRANT_GENERATION,
            true,
        )
        .expect("changed write PAT snapshot");
        let next_generation = "223e4567-e89b-42d3-a456-426614174000";
        let changed_generation = validate_credential_values(
            Some(Zeroizing::new(PAT.to_owned())),
            Some(Zeroizing::new(WRITE_PAT.to_owned())),
            Some(Zeroizing::new(next_generation.to_owned())),
            next_generation,
            true,
        )
        .expect("changed generation snapshot");
        assert!(same_credential_snapshot(&before, &same));
        assert!(!same_credential_snapshot(&before, &changed_pat));
        assert!(!same_credential_snapshot(&before, &changed_write_pat));
        assert!(!same_credential_snapshot(&before, &changed_generation));
    }

    #[test]
    fn retry_after_accepts_only_bounded_numeric_rate_limit_hints() {
        let mut headers = HeaderMap::new();
        headers.insert(RETRY_AFTER, HeaderValue::from_static("60"));
        assert_eq!(
            retry_after_seconds(StatusCode::TOO_MANY_REQUESTS, &headers),
            Some(60)
        );
        assert_eq!(retry_after_seconds(StatusCode::FORBIDDEN, &headers), None);
        headers.insert(RETRY_AFTER, HeaderValue::from_static("7200"));
        assert_eq!(
            retry_after_seconds(StatusCode::TOO_MANY_REQUESTS, &headers),
            None
        );
    }

    #[test]
    fn response_json_rejects_a_final_url_mismatch() {
        let (result, server) = tauri::async_runtime::block_on(async {
            let raw = fixed_length_response("200 OK", "application/json", "", b"{}");
            let (url, response, server) = mock_http_response(raw).await;
            let wrong_url = format!("{url}/unexpected");
            (
                response_json(response, &wrong_url, StatusCode::OK, 64).await,
                server,
            )
        });
        join_mock_server(server);
        assert_eq!(
            result.expect_err("final URL mismatch").code,
            SupabaseManagementNativeErrorCode::InvalidResponse
        );
    }

    #[test]
    fn response_json_preserves_only_bounded_retry_after_for_unexpected_status() {
        let (bounded_result, bounded_server) = tauri::async_runtime::block_on(async {
            let raw = fixed_length_response(
                "429 Too Many Requests",
                "application/json",
                "Retry-After: 60\r\n",
                b"{}",
            );
            let (url, response, server) = mock_http_response(raw).await;
            (
                response_json(response, &url, StatusCode::OK, 64).await,
                server,
            )
        });
        join_mock_server(bounded_server);
        let bounded = bounded_result.expect_err("unexpected rate-limited status");
        assert_eq!(bounded.code, SupabaseManagementNativeErrorCode::HttpError);
        assert_eq!(bounded.http_status, Some(429));
        assert_eq!(bounded.retry_after_seconds, Some(60));

        let (oversized_result, oversized_server) = tauri::async_runtime::block_on(async {
            let raw = fixed_length_response(
                "429 Too Many Requests",
                "application/json",
                "Retry-After: 3601\r\n",
                b"{}",
            );
            let (url, response, server) = mock_http_response(raw).await;
            (
                response_json(response, &url, StatusCode::OK, 64).await,
                server,
            )
        });
        join_mock_server(oversized_server);
        let oversized = oversized_result.expect_err("oversized retry hint");
        assert_eq!(oversized.code, SupabaseManagementNativeErrorCode::HttpError);
        assert_eq!(oversized.http_status, Some(429));
        assert_eq!(oversized.retry_after_seconds, None);
    }

    #[test]
    fn response_json_rejects_a_non_json_media_type() {
        let (result, server) = tauri::async_runtime::block_on(async {
            let raw = fixed_length_response("200 OK", "text/plain; charset=utf-8", "", b"{}");
            let (url, response, server) = mock_http_response(raw).await;
            (
                response_json(response, &url, StatusCode::OK, 64).await,
                server,
            )
        });
        join_mock_server(server);
        assert_eq!(
            result.expect_err("non-JSON response").code,
            SupabaseManagementNativeErrorCode::InvalidResponse
        );
    }

    #[test]
    fn bounded_response_body_rejects_an_oversized_content_length() {
        let (result, server) = tauri::async_runtime::block_on(async {
            let body = vec![b'x'; 64];
            let raw = fixed_length_response("200 OK", "application/json", "", &body);
            let (url, response, server) = mock_http_response(raw).await;
            assert_eq!(response.content_length(), Some(64));
            (
                response_json(response, &url, StatusCode::OK, 8).await,
                server,
            )
        });
        join_mock_server(server);
        assert_eq!(
            result.expect_err("oversized Content-Length").code,
            SupabaseManagementNativeErrorCode::ResponseTooLarge
        );
    }

    #[test]
    fn bounded_response_body_rejects_streaming_overflow_without_content_length() {
        let (result, server) = tauri::async_runtime::block_on(async {
            let raw = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n10\r\n0123456789abcdef\r\n0\r\n\r\n".to_vec();
            let (url, response, server) = mock_http_response(raw).await;
            assert_eq!(response.content_length(), None);
            (
                response_json(response, &url, StatusCode::OK, 8).await,
                server,
            )
        });
        join_mock_server(server);
        assert_eq!(
            result.expect_err("streaming response overflow").code,
            SupabaseManagementNativeErrorCode::ResponseTooLarge
        );
    }

    #[test]
    fn bounded_response_body_rejects_streaming_overflow_with_falsified_content_length() {
        let (result, server) = tauri::async_runtime::block_on(async {
            let raw = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 1\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n10\r\n0123456789abcdef\r\n0\r\n\r\n".to_vec();
            let (url, response, server) = mock_http_response(raw).await;
            (
                response_json(response, &url, StatusCode::OK, 8).await,
                server,
            )
        });
        join_mock_server(server);
        assert_eq!(
            result
                .expect_err("falsified-length streaming overflow")
                .code,
            SupabaseManagementNativeErrorCode::ResponseTooLarge
        );
    }

    #[test]
    fn response_json_accepts_bounded_valid_json() {
        let (result, server) = tauri::async_runtime::block_on(async {
            let raw = fixed_length_response(
                "200 OK",
                "application/json; charset=utf-8",
                "",
                br#"{"ok":true}"#,
            );
            let (url, response, server) = mock_http_response(raw).await;
            (
                response_json(response, &url, StatusCode::OK, 64).await,
                server,
            )
        });
        join_mock_server(server);
        assert_eq!(
            result.expect("valid bounded JSON"),
            serde_json::json!({ "ok": true })
        );
    }
}
