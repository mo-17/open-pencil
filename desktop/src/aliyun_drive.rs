use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{rngs::OsRng, RngCore};
use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue, ACCEPT, CONTENT_TYPE, RETRY_AFTER},
    redirect::Policy,
    Client, Method, StatusCode, Url,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    io::{ErrorKind, Read, Write},
    net::{Ipv4Addr, TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use zeroize::Zeroize;

const ALIYUN_DRIVE_OPENAPI_ORIGIN: &str = "https://openapi.alipan.com";
const ALIYUN_DRIVE_AUTHORIZE_URL: &str = "https://openapi.alipan.com/oauth/authorize";
const ALIYUN_DRIVE_TOKEN_URL: &str = "https://openapi.alipan.com/oauth/access_token";
const ALIYUN_DRIVE_USERINFO_URL: &str = "https://openapi.alipan.com/oauth/users/info";
const ALIYUN_DRIVE_OAUTH_SCOPE: &str = "user:base,file:all:read,file:all:write";
const ALIYUN_DRIVE_OAUTH_STYLE: &str = "folder";
const ALIYUN_DRIVE_OAUTH_DRIVE: &str = "backup";
const ALIYUN_DRIVE_PUBLISHER_REDIRECT_PATH: &str = "/oauth/aliyun-drive/callback";
const OAUTH_BROKER_EXCHANGE_PATH: &str = "/v1/aliyun-drive/oauth/exchange";
const OAUTH_BROKER_REFRESH_PATH: &str = "/v1/aliyun-drive/oauth/refresh";
const OAUTH_BROKER_PROTOCOL_VERSION: u8 = 1;

const COMPILED_ALIYUN_DRIVE_CLIENT_ID: Option<&str> = option_env!("VITE_ALIYUN_DRIVE_CLIENT_ID");
const COMPILED_ALIYUN_DRIVE_BROKER_ORIGIN: Option<&str> =
    option_env!("OPENPENCIL_ALIYUN_DRIVE_OAUTH_BROKER_ORIGIN");
const COMPILED_ALIYUN_DRIVE_REDIRECT_URI: Option<&str> =
    option_env!("OPENPENCIL_ALIYUN_DRIVE_REDIRECT_URI");

const CANONICAL_SCOPES: [&str; 3] = ["user:base", "file:all:read", "file:all:write"];
const ALLOWED_API_PATHS: [&str; 10] = [
    "/adrive/v1.0/user/getDriveInfo",
    "/adrive/v1.0/openFile/list",
    "/adrive/v1.0/openFile/get",
    "/adrive/v1.0/openFile/create",
    "/adrive/v1.0/openFile/getUploadUrl",
    "/adrive/v1.0/openFile/complete",
    "/adrive/v1.0/openFile/getDownloadUrl",
    "/adrive/v1.0/recyclebin/trash",
    "/adrive/v1.0/openFile/move",
    "/adrive/v1.0/async_task/get",
];

const DEFAULT_OAUTH_TIMEOUT_MS: u64 = 180_000;
const MIN_OAUTH_TIMEOUT_MS: u64 = 10_000;
const MAX_OAUTH_TIMEOUT_MS: u64 = 300_000;
const DEFAULT_TRANSFER_TIMEOUT_MS: u64 = 120_000;
const MAX_TRANSFER_TIMEOUT_MS: u64 = 120_000;
const MAX_CALLBACK_HEAD_BYTES: usize = 8 * 1024;
const MAX_AUTHORIZATION_CODE_LENGTH: usize = 4 * 1024;
const MAX_OAUTH_RESPONSE_BYTES: usize = 64 * 1024;
const MAX_TOKEN_LENGTH: usize = 8 * 1024;
const MAX_SECRET_LENGTH: usize = 4 * 1024;
const MAX_SUBJECT_LENGTH: usize = 512;
const MAX_DISPLAY_NAME_LENGTH: usize = 512;
const MAX_CONCURRENT_OAUTH_OPERATIONS: usize = 8;
const MAX_URL_LENGTH: usize = 16 * 1024;
const MAX_HEADER_COUNT: usize = 16;
const MAX_HEADER_BYTES: usize = 64 * 1024;
const MAX_METADATA_BODY_BYTES: usize = 1024 * 1024;
const MAX_METADATA_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const MAX_TRANSFER_CHUNK_BYTES: usize = 10 * 1024 * 1024;
const MAX_DOWNLOAD_RESPONSE_BYTES: usize = 2 * 1024 * 1024 * 1024;
const MAX_PREAUTHORIZED_URLS: usize = 10_016;
const UPLOAD_URL_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const DOWNLOAD_URL_TTL: Duration = Duration::from_secs(60 * 60);
const AUTHORIZATION_RECEIVED_MESSAGE: &str =
    "Authorization received. Return to OpenPencil while it finishes connecting.";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AliyunDriveNativeErrorCode {
    InvalidRequest,
    InvalidResponse,
    Unsupported,
    Cancelled,
    Timeout,
    BrowserOpenFailed,
    OauthDenied,
    OauthFailed,
    OauthClientInvalid,
    AuthorizationGrantInvalid,
    RedirectUriMismatch,
    TokenRequestInvalid,
    TokenExchangeFailed,
    TokenResponseInvalid,
    UserinfoFailed,
    ScopeMismatch,
    SubjectMismatch,
    NetworkFailed,
    ResponseTooLarge,
    RateLimited,
    BrokerUnavailable,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AliyunDriveNativeError {
    code: AliyunDriveNativeErrorCode,
    message: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    retry_after_ms: Option<u64>,
}

impl AliyunDriveNativeError {
    fn new(code: AliyunDriveNativeErrorCode, message: &'static str) -> Self {
        Self {
            code,
            message,
            retry_after_ms: None,
        }
    }

    fn invalid_request() -> Self {
        Self::new(
            AliyunDriveNativeErrorCode::InvalidRequest,
            "Aliyun Drive request is invalid",
        )
    }

    fn invalid_response() -> Self {
        Self::new(
            AliyunDriveNativeErrorCode::InvalidResponse,
            "Aliyun Drive returned an invalid response",
        )
    }

    fn unsupported() -> Self {
        Self::new(
            AliyunDriveNativeErrorCode::Unsupported,
            "Aliyun Drive authorization is unavailable in this build",
        )
    }

    fn oauth_failed() -> Self {
        Self::new(
            AliyunDriveNativeErrorCode::OauthFailed,
            "Aliyun Drive authorization failed",
        )
    }

    fn oauth_client_invalid() -> Self {
        Self::new(
            AliyunDriveNativeErrorCode::OauthClientInvalid,
            "Aliyun Drive OAuth client is invalid",
        )
    }

    fn authorization_grant_invalid() -> Self {
        Self::new(
            AliyunDriveNativeErrorCode::AuthorizationGrantInvalid,
            "Aliyun Drive authorization grant is invalid or expired",
        )
    }

    fn redirect_uri_mismatch() -> Self {
        Self::new(
            AliyunDriveNativeErrorCode::RedirectUriMismatch,
            "Aliyun Drive redirect URI did not match",
        )
    }

    fn token_request_invalid() -> Self {
        Self::new(
            AliyunDriveNativeErrorCode::TokenRequestInvalid,
            "Aliyun Drive token request is invalid",
        )
    }

    fn token_exchange_failed() -> Self {
        Self::new(
            AliyunDriveNativeErrorCode::TokenExchangeFailed,
            "Aliyun Drive token exchange failed",
        )
    }

    fn token_response_invalid() -> Self {
        Self::new(
            AliyunDriveNativeErrorCode::TokenResponseInvalid,
            "Aliyun Drive returned an invalid token response",
        )
    }

    fn userinfo_failed() -> Self {
        Self::new(
            AliyunDriveNativeErrorCode::UserinfoFailed,
            "Aliyun Drive account information could not be verified",
        )
    }

    fn scope_mismatch() -> Self {
        Self::new(
            AliyunDriveNativeErrorCode::ScopeMismatch,
            "Aliyun Drive did not grant the required scopes",
        )
    }

    fn subject_mismatch() -> Self {
        Self::new(
            AliyunDriveNativeErrorCode::SubjectMismatch,
            "Aliyun Drive authorization belongs to a different account",
        )
    }

    fn network_failed() -> Self {
        Self::new(
            AliyunDriveNativeErrorCode::NetworkFailed,
            "Aliyun Drive network request failed",
        )
    }

    fn response_too_large() -> Self {
        Self::new(
            AliyunDriveNativeErrorCode::ResponseTooLarge,
            "Aliyun Drive response exceeded the byte limit",
        )
    }

    fn rate_limited(retry_after_ms: Option<u64>) -> Self {
        Self {
            code: AliyunDriveNativeErrorCode::RateLimited,
            message: "Aliyun Drive temporarily rate limited requests",
            retry_after_ms,
        }
    }

    fn broker_unavailable() -> Self {
        Self::new(
            AliyunDriveNativeErrorCode::BrokerUnavailable,
            "The Aliyun Drive OAuth Broker is temporarily unavailable",
        )
    }
}

#[derive(Default)]
pub struct AliyunDriveOAuthOperations(Mutex<HashMap<String, Arc<AtomicBool>>>);

impl AliyunDriveOAuthOperations {
    fn begin(&self, operation_id: &str) -> Result<Arc<AtomicBool>, AliyunDriveNativeError> {
        if !valid_operation_id(operation_id) {
            return Err(AliyunDriveNativeError::invalid_request());
        }
        let mut operations = self
            .0
            .lock()
            .map_err(|_| AliyunDriveNativeError::oauth_failed())?;
        if operations.contains_key(operation_id)
            || operations.len() >= MAX_CONCURRENT_OAUTH_OPERATIONS
        {
            return Err(AliyunDriveNativeError::invalid_request());
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        operations.insert(operation_id.to_owned(), Arc::clone(&cancelled));
        Ok(cancelled)
    }

    fn finish(&self, operation_id: &str) {
        if let Ok(mut operations) = self.0.lock() {
            operations.remove(operation_id);
        }
    }

    fn cancel(&self, operation_id: &str) -> Result<bool, AliyunDriveNativeError> {
        if !valid_operation_id(operation_id) {
            return Err(AliyunDriveNativeError::invalid_request());
        }
        let operations = self
            .0
            .lock()
            .map_err(|_| AliyunDriveNativeError::oauth_failed())?;
        let Some(cancelled) = operations.get(operation_id) else {
            return Ok(false);
        };
        cancelled.store(true, Ordering::SeqCst);
        Ok(true)
    }
}

fn valid_operation_id(value: &str) -> bool {
    value.len() == 32
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// User-provided confidential-app secret. It is never serializable or debuggable and is zeroized.
#[derive(Deserialize)]
#[serde(transparent)]
pub struct AliyunDriveClientSecret(String);

impl AliyunDriveClientSecret {
    fn expose(&self) -> &str {
        &self.0
    }
}

impl Drop for AliyunDriveClientSecret {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

#[derive(Deserialize)]
#[serde(tag = "mode", rename_all = "kebab-case", deny_unknown_fields)]
pub enum AliyunDriveOAuthClient {
    PublisherBrokerConfidential {},
    SelfHostedConfidential {
        #[serde(rename = "clientId")]
        client_id: String,
        #[serde(rename = "clientSecret")]
        client_secret: AliyunDriveClientSecret,
        #[serde(rename = "redirectUri")]
        redirect_uri: String,
    },
    SelfHostedPublic {
        #[serde(rename = "clientId")]
        client_id: String,
        #[serde(rename = "redirectUri")]
        redirect_uri: String,
    },
}

#[derive(Deserialize)]
#[serde(tag = "mode", rename_all = "kebab-case", deny_unknown_fields)]
pub enum AliyunDriveConfidentialOAuthClient {
    PublisherBrokerConfidential {},
    SelfHostedConfidential {
        #[serde(rename = "clientId")]
        client_id: String,
        #[serde(rename = "clientSecret")]
        client_secret: AliyunDriveClientSecret,
        #[serde(rename = "redirectUri")]
        redirect_uri: String,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AliyunDriveAuthorizeRequest {
    oauth_client: AliyunDriveOAuthClient,
    operation_id: String,
    timeout_ms: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AliyunDriveRefreshRequest {
    oauth_client: AliyunDriveConfidentialOAuthClient,
    operation_id: String,
    refresh_token: String,
    expected_subject: String,
    timeout_ms: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AliyunDriveAuthorizeResponse {
    grant_type: &'static str,
    access_token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    refresh_token: Option<String>,
    expires_in: u64,
    granted_scopes: Vec<&'static str>,
    subject: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AliyunDriveRefreshResponse {
    grant_type: &'static str,
    access_token: String,
    refresh_token: String,
    expires_in: u64,
    granted_scopes: Vec<&'static str>,
    subject: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
}

#[derive(Deserialize)]
struct DirectTokenResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    token_type: Option<String>,
    scope: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BrokerTokenResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    token_type: Option<String>,
}

#[derive(Deserialize)]
struct OAuthErrorResponse {
    error: Option<String>,
    code: Option<String>,
}

struct ValidatedTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: u64,
}

#[derive(Deserialize)]
struct UserInfoResponse {
    id: Option<Value>,
    name: Option<String>,
}

struct VerifiedUser {
    subject: String,
    name: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
enum StateValidationError {
    Mismatch,
    Replay,
}

struct OneTimeState {
    expected: String,
    consumed: bool,
}

impl OneTimeState {
    fn new(expected: String) -> Self {
        Self {
            expected,
            consumed: false,
        }
    }

    fn consume(&mut self, candidate: &str) -> Result<(), StateValidationError> {
        if self.consumed {
            return Err(StateValidationError::Replay);
        }
        if candidate != self.expected {
            return Err(StateValidationError::Mismatch);
        }
        self.consumed = true;
        Ok(())
    }
}

enum CallbackDecision {
    Ignore,
    Success(String),
    Failed(AliyunDriveNativeError),
}

#[derive(Clone)]
struct PublisherConfiguration {
    client_id: String,
    redirect_uri: Url,
    exchange_url: Url,
    refresh_url: Url,
}

enum TokenBackend<'a> {
    Broker {
        exchange_url: Url,
        refresh_url: Url,
    },
    DirectConfidential {
        client_secret: &'a AliyunDriveClientSecret,
    },
    DirectPublic,
}

struct ResolvedAuthorizationClient<'a> {
    client_id: String,
    redirect_uri: Url,
    backend: TokenBackend<'a>,
}

struct ResolvedRefreshClient<'a> {
    client_id: String,
    backend: TokenBackend<'a>,
}

fn valid_client_id(value: &str) -> bool {
    (8..=256).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

fn valid_client_secret(value: &AliyunDriveClientSecret) -> bool {
    let value = value.expose();
    (8..=MAX_SECRET_LENGTH).contains(&value.len())
        && value.trim() == value
        && value.bytes().all(|byte| byte.is_ascii_graphic())
}

fn parse_loopback_redirect_uri(
    value: &str,
    expected_path: Option<&str>,
) -> Result<Url, AliyunDriveNativeError> {
    if value.is_empty() || value.len() > 512 || value.trim() != value {
        return Err(AliyunDriveNativeError::redirect_uri_mismatch());
    }
    let url = Url::parse(value).map_err(|_| AliyunDriveNativeError::redirect_uri_mismatch())?;
    let port = url
        .port()
        .filter(|port| (1024..=65_535).contains(port))
        .ok_or_else(AliyunDriveNativeError::redirect_uri_mismatch)?;
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || port < 1024
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() == "/"
        || expected_path.is_some_and(|path| url.path() != path)
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(AliyunDriveNativeError::redirect_uri_mismatch());
    }
    Ok(url)
}

fn oauth_broker_urls(origin: &str) -> Result<(Url, Url), AliyunDriveNativeError> {
    let parsed = Url::parse(origin).map_err(|_| AliyunDriveNativeError::unsupported())?;
    if parsed.scheme() != "https"
        || parsed.host_str().is_none()
        || parsed.port().is_some_and(|port| port != 443)
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.path() != "/"
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || parsed.origin().ascii_serialization() != origin
    {
        return Err(AliyunDriveNativeError::unsupported());
    }
    let mut exchange_url = parsed.clone();
    exchange_url.set_path(OAUTH_BROKER_EXCHANGE_PATH);
    let mut refresh_url = parsed;
    refresh_url.set_path(OAUTH_BROKER_REFRESH_PATH);
    Ok((exchange_url, refresh_url))
}

fn publisher_configuration(
    client_id: Option<&str>,
    broker_origin: Option<&str>,
    redirect_uri: Option<&str>,
) -> Result<PublisherConfiguration, AliyunDriveNativeError> {
    let client_id = client_id.ok_or_else(AliyunDriveNativeError::unsupported)?;
    if !valid_client_id(client_id) {
        return Err(AliyunDriveNativeError::oauth_client_invalid());
    }
    let redirect_uri = parse_loopback_redirect_uri(
        redirect_uri.ok_or_else(AliyunDriveNativeError::unsupported)?,
        Some(ALIYUN_DRIVE_PUBLISHER_REDIRECT_PATH),
    )?;
    let (exchange_url, refresh_url) =
        oauth_broker_urls(broker_origin.ok_or_else(AliyunDriveNativeError::unsupported)?)?;
    Ok(PublisherConfiguration {
        client_id: client_id.to_owned(),
        redirect_uri,
        exchange_url,
        refresh_url,
    })
}

fn compiled_publisher_configuration() -> Result<PublisherConfiguration, AliyunDriveNativeError> {
    publisher_configuration(
        COMPILED_ALIYUN_DRIVE_CLIENT_ID,
        COMPILED_ALIYUN_DRIVE_BROKER_ORIGIN,
        COMPILED_ALIYUN_DRIVE_REDIRECT_URI,
    )
}

fn resolve_authorization_client(
    client: &AliyunDriveOAuthClient,
) -> Result<ResolvedAuthorizationClient<'_>, AliyunDriveNativeError> {
    match client {
        AliyunDriveOAuthClient::PublisherBrokerConfidential {} => {
            let configured = compiled_publisher_configuration()?;
            Ok(ResolvedAuthorizationClient {
                client_id: configured.client_id,
                redirect_uri: configured.redirect_uri,
                backend: TokenBackend::Broker {
                    exchange_url: configured.exchange_url,
                    refresh_url: configured.refresh_url,
                },
            })
        }
        AliyunDriveOAuthClient::SelfHostedConfidential {
            client_id,
            client_secret,
            redirect_uri,
        } => {
            if !valid_client_id(client_id) || !valid_client_secret(client_secret) {
                return Err(AliyunDriveNativeError::oauth_client_invalid());
            }
            Ok(ResolvedAuthorizationClient {
                client_id: client_id.clone(),
                redirect_uri: parse_loopback_redirect_uri(redirect_uri, None)?,
                backend: TokenBackend::DirectConfidential { client_secret },
            })
        }
        AliyunDriveOAuthClient::SelfHostedPublic {
            client_id,
            redirect_uri,
        } => {
            if !valid_client_id(client_id) {
                return Err(AliyunDriveNativeError::oauth_client_invalid());
            }
            Ok(ResolvedAuthorizationClient {
                client_id: client_id.clone(),
                redirect_uri: parse_loopback_redirect_uri(redirect_uri, None)?,
                backend: TokenBackend::DirectPublic,
            })
        }
    }
}

fn resolve_refresh_client(
    client: &AliyunDriveConfidentialOAuthClient,
) -> Result<ResolvedRefreshClient<'_>, AliyunDriveNativeError> {
    match client {
        AliyunDriveConfidentialOAuthClient::PublisherBrokerConfidential {} => {
            let configured = compiled_publisher_configuration()?;
            Ok(ResolvedRefreshClient {
                client_id: configured.client_id,
                backend: TokenBackend::Broker {
                    exchange_url: configured.exchange_url,
                    refresh_url: configured.refresh_url,
                },
            })
        }
        AliyunDriveConfidentialOAuthClient::SelfHostedConfidential {
            client_id,
            client_secret,
            redirect_uri,
        } => {
            if !valid_client_id(client_id) || !valid_client_secret(client_secret) {
                return Err(AliyunDriveNativeError::oauth_client_invalid());
            }
            parse_loopback_redirect_uri(redirect_uri, None)?;
            Ok(ResolvedRefreshClient {
                client_id: client_id.clone(),
                backend: TokenBackend::DirectConfidential { client_secret },
            })
        }
    }
}

fn oauth_timeout(value: Option<u64>) -> Result<Duration, AliyunDriveNativeError> {
    let milliseconds = value.unwrap_or(DEFAULT_OAUTH_TIMEOUT_MS);
    if !(MIN_OAUTH_TIMEOUT_MS..=MAX_OAUTH_TIMEOUT_MS).contains(&milliseconds) {
        return Err(AliyunDriveNativeError::invalid_request());
    }
    Ok(Duration::from_millis(milliseconds))
}

fn transfer_timeout(value: Option<u64>) -> Result<Duration, AliyunDriveNativeError> {
    let milliseconds = value.unwrap_or(DEFAULT_TRANSFER_TIMEOUT_MS);
    if !(1_000..=MAX_TRANSFER_TIMEOUT_MS).contains(&milliseconds) {
        return Err(AliyunDriveNativeError::invalid_request());
    }
    Ok(Duration::from_millis(milliseconds))
}

fn random_urlsafe(byte_length: usize) -> String {
    let mut bytes = vec![0_u8; byte_length];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn pkce_pair() -> (String, String) {
    let verifier = random_urlsafe(64);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

fn authorization_url(
    client_id: &str,
    redirect_uri: &Url,
    state: &str,
    challenge: &str,
) -> Result<String, AliyunDriveNativeError> {
    if !valid_client_id(client_id) {
        return Err(AliyunDriveNativeError::oauth_client_invalid());
    }
    let mut url = Url::parse(ALIYUN_DRIVE_AUTHORIZE_URL)
        .map_err(|_| AliyunDriveNativeError::oauth_failed())?;
    url.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", redirect_uri.as_str())
        .append_pair("response_type", "code")
        .append_pair("scope", ALIYUN_DRIVE_OAUTH_SCOPE)
        .append_pair("state", state)
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("style", ALIYUN_DRIVE_OAUTH_STYLE)
        .append_pair("drive", ALIYUN_DRIVE_OAUTH_DRIVE);
    Ok(url.into())
}

struct LoopbackCallback {
    listener: TcpListener,
    path: String,
}

fn bind_loopback_callback(redirect_uri: &Url) -> Result<LoopbackCallback, AliyunDriveNativeError> {
    let port = redirect_uri
        .port()
        .ok_or_else(AliyunDriveNativeError::redirect_uri_mismatch)?;
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, port)).map_err(|_| {
        AliyunDriveNativeError::new(
            AliyunDriveNativeErrorCode::Unsupported,
            "The registered Aliyun Drive callback port is unavailable",
        )
    })?;
    let local = listener
        .local_addr()
        .map_err(|_| AliyunDriveNativeError::oauth_failed())?;
    if local.ip() != Ipv4Addr::LOCALHOST || local.port() != port {
        return Err(AliyunDriveNativeError::redirect_uri_mismatch());
    }
    Ok(LoopbackCallback {
        listener,
        path: redirect_uri.path().to_owned(),
    })
}

fn browser_response(stream: &mut TcpStream, status: &str, message: &str) {
    let body =
        format!("<!doctype html><meta charset=\"utf-8\"><title>OpenPencil</title><p>{message}</p>");
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn read_request_head(stream: &mut TcpStream) -> Result<String, AliyunDriveNativeError> {
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(|_| AliyunDriveNativeError::oauth_failed())?;
    let mut bytes = Vec::with_capacity(1024);
    let mut buffer = [0_u8; 1024];
    loop {
        let read = stream
            .read(&mut buffer)
            .map_err(|_| AliyunDriveNativeError::oauth_failed())?;
        if read == 0 {
            break;
        }
        bytes.extend_from_slice(&buffer[..read]);
        if bytes.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
        if bytes.len() > MAX_CALLBACK_HEAD_BYTES {
            return Err(AliyunDriveNativeError::invalid_request());
        }
    }
    if bytes.len() > MAX_CALLBACK_HEAD_BYTES {
        return Err(AliyunDriveNativeError::invalid_request());
    }
    String::from_utf8(bytes).map_err(|_| AliyunDriveNativeError::invalid_request())
}

fn callback_decision(
    head: &str,
    expected_path: &str,
    state: &mut OneTimeState,
) -> CallbackDecision {
    let Some(first_line) = head.lines().next() else {
        return CallbackDecision::Ignore;
    };
    let mut parts = first_line.split_ascii_whitespace();
    if parts.next() != Some("GET") {
        return CallbackDecision::Ignore;
    }
    let Some(target) = parts.next() else {
        return CallbackDecision::Ignore;
    };
    if target.len() > 4096 || !matches!(parts.next(), Some("HTTP/1.0" | "HTTP/1.1")) {
        return CallbackDecision::Ignore;
    }
    let Ok(url) = Url::parse(&format!("http://127.0.0.1{target}")) else {
        return CallbackDecision::Ignore;
    };
    if url.path() != expected_path || url.fragment().is_some() {
        return CallbackDecision::Ignore;
    }
    let mut query = HashMap::new();
    for (key, value) in url.query_pairs() {
        if key.len() > 64
            || value.len() > 4096
            || query.len() >= 8
            || query.insert(key.into_owned(), value.into_owned()).is_some()
        {
            return CallbackDecision::Ignore;
        }
    }
    let Some(candidate_state) = query.get("state") else {
        return CallbackDecision::Ignore;
    };
    match state.consume(candidate_state) {
        Ok(()) => {}
        Err(StateValidationError::Mismatch) => return CallbackDecision::Ignore,
        Err(StateValidationError::Replay) => {
            return CallbackDecision::Failed(AliyunDriveNativeError::oauth_failed())
        }
    }
    if let Some(error) = query.get("error") {
        return CallbackDecision::Failed(if error == "access_denied" {
            AliyunDriveNativeError::new(
                AliyunDriveNativeErrorCode::OauthDenied,
                "Aliyun Drive authorization was denied",
            )
        } else {
            AliyunDriveNativeError::oauth_failed()
        });
    }
    let Some(code) = query.get("code") else {
        return CallbackDecision::Failed(AliyunDriveNativeError::oauth_failed());
    };
    if code.is_empty()
        || code.len() > MAX_AUTHORIZATION_CODE_LENGTH
        || code.chars().any(char::is_control)
    {
        return CallbackDecision::Failed(AliyunDriveNativeError::oauth_failed());
    }
    CallbackDecision::Success(code.to_owned())
}

fn wait_for_callback(
    callback: LoopbackCallback,
    expected_state: String,
    cancelled: Arc<AtomicBool>,
    timeout: Duration,
) -> Result<String, AliyunDriveNativeError> {
    callback
        .listener
        .set_nonblocking(true)
        .map_err(|_| AliyunDriveNativeError::oauth_failed())?;
    let deadline = Instant::now() + timeout;
    let mut state = OneTimeState::new(expected_state);
    loop {
        if cancelled.load(Ordering::SeqCst) {
            return Err(cancelled_error("Aliyun Drive authorization was cancelled"));
        }
        if Instant::now() >= deadline {
            return Err(AliyunDriveNativeError::new(
                AliyunDriveNativeErrorCode::Timeout,
                "Aliyun Drive authorization timed out",
            ));
        }
        match callback.listener.accept() {
            Ok((mut stream, peer)) => {
                if !peer.ip().is_loopback() {
                    browser_response(&mut stream, "400 Bad Request", "Authorization failed.");
                    continue;
                }
                let head = match read_request_head(&mut stream) {
                    Ok(head) => head,
                    Err(_) => {
                        browser_response(&mut stream, "400 Bad Request", "Authorization failed.");
                        continue;
                    }
                };
                match callback_decision(&head, &callback.path, &mut state) {
                    CallbackDecision::Ignore => {
                        browser_response(&mut stream, "400 Bad Request", "Authorization failed.");
                    }
                    CallbackDecision::Success(code) => {
                        browser_response(&mut stream, "200 OK", AUTHORIZATION_RECEIVED_MESSAGE);
                        return Ok(code);
                    }
                    CallbackDecision::Failed(error) => {
                        browser_response(&mut stream, "400 Bad Request", "Authorization failed.");
                        return Err(error);
                    }
                }
            }
            Err(error) if error.kind() == ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(25));
            }
            Err(_) => return Err(AliyunDriveNativeError::oauth_failed()),
        }
    }
}

fn http_client(timeout: Duration) -> Result<Client, AliyunDriveNativeError> {
    Client::builder()
        .redirect(Policy::none())
        .timeout(timeout)
        .build()
        .map_err(|_| AliyunDriveNativeError::network_failed())
}

async fn bounded_response_body(
    response: &mut reqwest::Response,
    max_bytes: usize,
) -> Result<Vec<u8>, AliyunDriveNativeError> {
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes as u64)
    {
        return Err(AliyunDriveNativeError::response_too_large());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| AliyunDriveNativeError::network_failed())?
    {
        if body.len().saturating_add(chunk.len()) > max_bytes {
            return Err(AliyunDriveNativeError::response_too_large());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn valid_token_text(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_TOKEN_LENGTH
        && value.trim() == value
        && !value.chars().any(char::is_whitespace)
        && !value.chars().any(char::is_control)
}

fn valid_subject(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_SUBJECT_LENGTH
        && value.trim() == value
        && !value.chars().any(char::is_control)
}

fn validate_direct_scope(scope: Option<&str>) -> Result<(), AliyunDriveNativeError> {
    if scope.is_some_and(|value| value != ALIYUN_DRIVE_OAUTH_SCOPE) {
        return Err(AliyunDriveNativeError::scope_mismatch());
    }
    Ok(())
}

fn validated_token_fields(
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    token_type: Option<String>,
    require_refresh: bool,
) -> Result<ValidatedTokenResponse, AliyunDriveNativeError> {
    if !token_type
        .as_deref()
        .is_some_and(|value| value.eq_ignore_ascii_case("Bearer"))
    {
        return Err(AliyunDriveNativeError::token_response_invalid());
    }
    let expires_in = expires_in
        .filter(|value| (1..=31 * 24 * 60 * 60).contains(value))
        .ok_or_else(AliyunDriveNativeError::token_response_invalid)?;
    let access_token = access_token
        .filter(|value| valid_token_text(value))
        .ok_or_else(AliyunDriveNativeError::token_response_invalid)?;
    let refresh_token = match (require_refresh, refresh_token) {
        (true, Some(value)) if valid_token_text(&value) => Some(value),
        (true, _) => return Err(AliyunDriveNativeError::token_response_invalid()),
        (false, None) => None,
        (false, Some(_)) => return Err(AliyunDriveNativeError::token_response_invalid()),
    };
    Ok(ValidatedTokenResponse {
        access_token,
        refresh_token,
        expires_in,
    })
}

fn parsed_direct_token_response(
    body: &[u8],
    require_refresh: bool,
) -> Result<ValidatedTokenResponse, AliyunDriveNativeError> {
    let parsed: DirectTokenResponse = serde_json::from_slice(body)
        .map_err(|_| AliyunDriveNativeError::token_response_invalid())?;
    validate_direct_scope(parsed.scope.as_deref())?;
    validated_token_fields(
        parsed.access_token,
        parsed.refresh_token,
        parsed.expires_in,
        parsed.token_type,
        require_refresh,
    )
}

fn parsed_broker_token_response(
    body: &[u8],
) -> Result<ValidatedTokenResponse, AliyunDriveNativeError> {
    let parsed: BrokerTokenResponse = serde_json::from_slice(body)
        .map_err(|_| AliyunDriveNativeError::token_response_invalid())?;
    validated_token_fields(
        parsed.access_token,
        parsed.refresh_token,
        parsed.expires_in,
        parsed.token_type,
        true,
    )
}

fn retry_after_ms(headers: &HeaderMap) -> Option<u64> {
    headers
        .get(RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .and_then(|seconds| seconds.checked_mul(1000))
        .map(|milliseconds| milliseconds.min(300_000))
}

fn classified_token_exchange_error(
    status: StatusCode,
    body: &[u8],
    retry_after: Option<u64>,
    broker: bool,
) -> AliyunDriveNativeError {
    if status == StatusCode::TOO_MANY_REQUESTS {
        return AliyunDriveNativeError::rate_limited(retry_after);
    }
    if status.is_server_error() {
        return if broker {
            AliyunDriveNativeError::broker_unavailable()
        } else {
            AliyunDriveNativeError::network_failed()
        };
    }
    let parsed = serde_json::from_slice::<OAuthErrorResponse>(body).ok();
    let code = parsed.and_then(|value| value.error.or(value.code));
    let Some(code) = code.filter(|value| {
        value.len() <= 128 && !value.is_empty() && !value.chars().any(char::is_control)
    }) else {
        return AliyunDriveNativeError::token_exchange_failed();
    };
    match code.as_str() {
        "invalid_client" | "unauthorized_client" => AliyunDriveNativeError::oauth_client_invalid(),
        "invalid_grant" | "code_expired" | "refresh_token_expired" => {
            AliyunDriveNativeError::authorization_grant_invalid()
        }
        "redirect_uri_mismatch" => AliyunDriveNativeError::redirect_uri_mismatch(),
        "invalid_scope" => AliyunDriveNativeError::scope_mismatch(),
        "invalid_request" => AliyunDriveNativeError::token_request_invalid(),
        "temporarily_unavailable" | "server_error" => {
            if broker {
                AliyunDriveNativeError::broker_unavailable()
            } else {
                AliyunDriveNativeError::network_failed()
            }
        }
        _ => AliyunDriveNativeError::token_exchange_failed(),
    }
}

async fn validate_token_exchange_response(
    response: &mut reqwest::Response,
    broker: bool,
) -> Result<(), AliyunDriveNativeError> {
    if response.status().is_success() {
        return Ok(());
    }
    let status = response.status();
    let retry_after = retry_after_ms(response.headers());
    let body = bounded_response_body(response, MAX_OAUTH_RESPONSE_BYTES).await?;
    Err(classified_token_exchange_error(
        status,
        &body,
        retry_after,
        broker,
    ))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BrokerExchangeRequest<'a> {
    protocol_version: u8,
    code: &'a str,
    code_verifier: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BrokerRefreshRequest<'a> {
    protocol_version: u8,
    refresh_token: &'a str,
}

#[derive(Serialize)]
struct DirectExchangeRequest<'a> {
    client_id: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    client_secret: Option<&'a str>,
    grant_type: &'static str,
    code: &'a str,
    code_verifier: &'a str,
}

#[derive(Serialize)]
struct DirectRefreshRequest<'a> {
    client_id: &'a str,
    client_secret: &'a str,
    grant_type: &'static str,
    refresh_token: &'a str,
}

fn json_request<T: Serialize>(
    client: &Client,
    url: Url,
    value: &T,
    broker: bool,
) -> Result<reqwest::Request, AliyunDriveNativeError> {
    let body = serde_json::to_vec(value).map_err(|_| {
        if broker {
            AliyunDriveNativeError::broker_unavailable()
        } else {
            AliyunDriveNativeError::token_request_invalid()
        }
    })?;
    client
        .post(url)
        .header(ACCEPT, "application/json")
        .header(CONTENT_TYPE, "application/json")
        .body(body)
        .build()
        .map_err(|_| {
            if broker {
                AliyunDriveNativeError::broker_unavailable()
            } else {
                AliyunDriveNativeError::token_request_invalid()
            }
        })
}

fn broker_exchange_request(
    client: &Client,
    url: &Url,
    code: &str,
    verifier: &str,
) -> Result<reqwest::Request, AliyunDriveNativeError> {
    json_request(
        client,
        url.clone(),
        &BrokerExchangeRequest {
            protocol_version: OAUTH_BROKER_PROTOCOL_VERSION,
            code,
            code_verifier: verifier,
        },
        true,
    )
}

fn broker_refresh_request(
    client: &Client,
    url: &Url,
    refresh_token: &str,
) -> Result<reqwest::Request, AliyunDriveNativeError> {
    json_request(
        client,
        url.clone(),
        &BrokerRefreshRequest {
            protocol_version: OAUTH_BROKER_PROTOCOL_VERSION,
            refresh_token,
        },
        true,
    )
}

fn direct_exchange_request(
    client: &Client,
    client_id: &str,
    client_secret: Option<&AliyunDriveClientSecret>,
    code: &str,
    verifier: &str,
) -> Result<reqwest::Request, AliyunDriveNativeError> {
    let url = Url::parse(ALIYUN_DRIVE_TOKEN_URL)
        .map_err(|_| AliyunDriveNativeError::token_request_invalid())?;
    json_request(
        client,
        url,
        &DirectExchangeRequest {
            client_id,
            client_secret: client_secret.map(AliyunDriveClientSecret::expose),
            grant_type: "authorization_code",
            code,
            code_verifier: verifier,
        },
        false,
    )
}

fn direct_refresh_request(
    client: &Client,
    client_id: &str,
    client_secret: &AliyunDriveClientSecret,
    refresh_token: &str,
) -> Result<reqwest::Request, AliyunDriveNativeError> {
    let url = Url::parse(ALIYUN_DRIVE_TOKEN_URL)
        .map_err(|_| AliyunDriveNativeError::token_request_invalid())?;
    json_request(
        client,
        url,
        &DirectRefreshRequest {
            client_id,
            client_secret: client_secret.expose(),
            grant_type: "refresh_token",
            refresh_token,
        },
        false,
    )
}

async fn execute_broker_token_request(
    client: &Client,
    request: reqwest::Request,
) -> Result<ValidatedTokenResponse, AliyunDriveNativeError> {
    let mut response = client
        .execute(request)
        .await
        .map_err(|_| AliyunDriveNativeError::broker_unavailable())?;
    validate_token_exchange_response(&mut response, true).await?;
    let body = bounded_response_body(&mut response, MAX_OAUTH_RESPONSE_BYTES).await?;
    parsed_broker_token_response(&body)
}

async fn execute_direct_token_request(
    client: &Client,
    request: reqwest::Request,
    require_refresh: bool,
) -> Result<ValidatedTokenResponse, AliyunDriveNativeError> {
    let mut response = client
        .execute(request)
        .await
        .map_err(|_| AliyunDriveNativeError::network_failed())?;
    validate_token_exchange_response(&mut response, false).await?;
    let body = bounded_response_body(&mut response, MAX_OAUTH_RESPONSE_BYTES).await?;
    parsed_direct_token_response(&body, require_refresh)
}

async fn exchange_authorization_code(
    client: &Client,
    resolved: &ResolvedAuthorizationClient<'_>,
    code: &str,
    verifier: &str,
) -> Result<ValidatedTokenResponse, AliyunDriveNativeError> {
    match &resolved.backend {
        TokenBackend::Broker { exchange_url, .. } => {
            let request = broker_exchange_request(client, exchange_url, code, verifier)?;
            execute_broker_token_request(client, request).await
        }
        TokenBackend::DirectConfidential { client_secret } => {
            let request = direct_exchange_request(
                client,
                &resolved.client_id,
                Some(client_secret),
                code,
                verifier,
            )?;
            execute_direct_token_request(client, request, true).await
        }
        TokenBackend::DirectPublic => {
            let request =
                direct_exchange_request(client, &resolved.client_id, None, code, verifier)?;
            execute_direct_token_request(client, request, false).await
        }
    }
}

async fn refresh_access_token(
    client: &Client,
    resolved: &ResolvedRefreshClient<'_>,
    refresh_token: &str,
) -> Result<ValidatedTokenResponse, AliyunDriveNativeError> {
    match &resolved.backend {
        TokenBackend::Broker { refresh_url, .. } => {
            let request = broker_refresh_request(client, refresh_url, refresh_token)?;
            execute_broker_token_request(client, request).await
        }
        TokenBackend::DirectConfidential { client_secret } => {
            let request =
                direct_refresh_request(client, &resolved.client_id, client_secret, refresh_token)?;
            execute_direct_token_request(client, request, true).await
        }
        TokenBackend::DirectPublic => Err(AliyunDriveNativeError::invalid_request()),
    }
}

fn rotated_refresh_token(
    previous: &str,
    replacement: Option<String>,
) -> Result<String, AliyunDriveNativeError> {
    replacement
        .filter(|value| value != previous)
        .ok_or_else(AliyunDriveNativeError::token_response_invalid)
}

fn bounded_display_text(value: Option<String>, maximum: usize) -> Option<String> {
    value.filter(|text| {
        !text.is_empty()
            && text.len() <= maximum
            && text.trim() == text
            && !text.chars().any(char::is_control)
    })
}

fn lossless_subject(value: Value) -> Result<String, AliyunDriveNativeError> {
    let subject = match value {
        Value::String(value) => value,
        Value::Number(value) => value
            .as_u64()
            .map(|number| number.to_string())
            .ok_or_else(AliyunDriveNativeError::userinfo_failed)?,
        _ => return Err(AliyunDriveNativeError::userinfo_failed()),
    };
    valid_subject(&subject)
        .then_some(subject)
        .ok_or_else(AliyunDriveNativeError::userinfo_failed)
}

fn parsed_userinfo_response(
    body: &[u8],
    expected_subject: Option<&str>,
) -> Result<VerifiedUser, AliyunDriveNativeError> {
    let parsed: UserInfoResponse =
        serde_json::from_slice(body).map_err(|_| AliyunDriveNativeError::userinfo_failed())?;
    let subject = lossless_subject(
        parsed
            .id
            .ok_or_else(AliyunDriveNativeError::userinfo_failed)?,
    )?;
    if expected_subject.is_some_and(|expected| expected != subject) {
        return Err(AliyunDriveNativeError::subject_mismatch());
    }
    Ok(VerifiedUser {
        subject,
        name: bounded_display_text(parsed.name, MAX_DISPLAY_NAME_LENGTH),
    })
}

async fn verified_user(
    client: &Client,
    access_token: &str,
    expected_subject: Option<&str>,
) -> Result<VerifiedUser, AliyunDriveNativeError> {
    let mut response = client
        .get(ALIYUN_DRIVE_USERINFO_URL)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|_| AliyunDriveNativeError::network_failed())?;
    if response.status() == StatusCode::TOO_MANY_REQUESTS {
        return Err(AliyunDriveNativeError::rate_limited(retry_after_ms(
            response.headers(),
        )));
    }
    if response.status().is_server_error() {
        return Err(AliyunDriveNativeError::network_failed());
    }
    if !response.status().is_success() {
        return Err(AliyunDriveNativeError::userinfo_failed());
    }
    let body = bounded_response_body(&mut response, MAX_OAUTH_RESPONSE_BYTES).await?;
    parsed_userinfo_response(&body, expected_subject)
}

fn cancelled_error(message: &'static str) -> AliyunDriveNativeError {
    AliyunDriveNativeError::new(AliyunDriveNativeErrorCode::Cancelled, message)
}

async fn authorize_inner(
    request: &AliyunDriveAuthorizeRequest,
    cancelled: Arc<AtomicBool>,
) -> Result<AliyunDriveAuthorizeResponse, AliyunDriveNativeError> {
    let resolved = resolve_authorization_client(&request.oauth_client)?;
    let timeout = oauth_timeout(request.timeout_ms)?;
    let callback = bind_loopback_callback(&resolved.redirect_uri)?;
    let state = random_urlsafe(32);
    let (verifier, challenge) = pkce_pair();
    let url = authorization_url(
        &resolved.client_id,
        &resolved.redirect_uri,
        &state,
        &challenge,
    )?;
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|_| {
        AliyunDriveNativeError::new(
            AliyunDriveNativeErrorCode::BrowserOpenFailed,
            "The system browser could not be opened",
        )
    })?;
    let callback_cancelled = Arc::clone(&cancelled);
    let code = tauri::async_runtime::spawn_blocking(move || {
        wait_for_callback(callback, state, callback_cancelled, timeout)
    })
    .await
    .map_err(|_| AliyunDriveNativeError::oauth_failed())??;
    if cancelled.load(Ordering::SeqCst) {
        return Err(cancelled_error("Aliyun Drive authorization was cancelled"));
    }
    let client = http_client(timeout)?;
    let token = exchange_authorization_code(&client, &resolved, &code, &verifier).await?;
    if cancelled.load(Ordering::SeqCst) {
        return Err(cancelled_error("Aliyun Drive authorization was cancelled"));
    }
    let user = verified_user(&client, &token.access_token, None).await?;
    if cancelled.load(Ordering::SeqCst) {
        return Err(cancelled_error("Aliyun Drive authorization was cancelled"));
    }
    let public_grant = matches!(resolved.backend, TokenBackend::DirectPublic);
    Ok(AliyunDriveAuthorizeResponse {
        grant_type: if public_grant {
            "access-grant"
        } else {
            "refresh-grant"
        },
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_in: token.expires_in,
        granted_scopes: CANONICAL_SCOPES.to_vec(),
        subject: user.subject,
        name: user.name,
    })
}

#[tauri::command]
pub async fn aliyun_drive_oauth_authorize(
    request: AliyunDriveAuthorizeRequest,
    operations: tauri::State<'_, AliyunDriveOAuthOperations>,
) -> Result<AliyunDriveAuthorizeResponse, AliyunDriveNativeError> {
    let cancelled = operations.begin(&request.operation_id)?;
    let result = authorize_inner(&request, cancelled).await;
    operations.finish(&request.operation_id);
    result
}

#[tauri::command]
pub async fn aliyun_drive_oauth_refresh(
    request: AliyunDriveRefreshRequest,
    operations: tauri::State<'_, AliyunDriveOAuthOperations>,
) -> Result<AliyunDriveRefreshResponse, AliyunDriveNativeError> {
    if !valid_token_text(&request.refresh_token) || !valid_subject(&request.expected_subject) {
        return Err(AliyunDriveNativeError::invalid_request());
    }
    let resolved = resolve_refresh_client(&request.oauth_client)?;
    let timeout = oauth_timeout(request.timeout_ms)?;
    let cancelled = operations.begin(&request.operation_id)?;
    let result = async {
        let client = http_client(timeout)?;
        let token = refresh_access_token(&client, &resolved, &request.refresh_token).await?;
        let refresh_token = rotated_refresh_token(&request.refresh_token, token.refresh_token)?;
        if cancelled.load(Ordering::SeqCst) {
            return Err(cancelled_error("Aliyun Drive token refresh was cancelled"));
        }
        let user = verified_user(
            &client,
            &token.access_token,
            Some(&request.expected_subject),
        )
        .await?;
        if cancelled.load(Ordering::SeqCst) {
            return Err(cancelled_error("Aliyun Drive token refresh was cancelled"));
        }
        Ok(AliyunDriveRefreshResponse {
            grant_type: "refresh-grant",
            access_token: token.access_token,
            refresh_token,
            expires_in: token.expires_in,
            granted_scopes: CANONICAL_SCOPES.to_vec(),
            subject: user.subject,
            name: user.name,
        })
    }
    .await;
    operations.finish(&request.operation_id);
    result
}

#[tauri::command]
pub fn aliyun_drive_oauth_cancel(
    operation_id: String,
    operations: tauri::State<'_, AliyunDriveOAuthOperations>,
) -> Result<bool, AliyunDriveNativeError> {
    operations.cancel(&operation_id)
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AliyunDriveTransferKind {
    Api,
    Upload,
    Download,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct AliyunDriveTransferHeader {
    name: String,
    value: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AliyunDriveTransferRequest {
    kind: AliyunDriveTransferKind,
    url: String,
    method: String,
    #[serde(default)]
    headers: Vec<AliyunDriveTransferHeader>,
    body: Option<Vec<u8>>,
    max_response_bytes: usize,
    timeout_ms: Option<u64>,
}

#[derive(Serialize)]
pub struct AliyunDriveTransferResponse {
    status: u16,
    headers: Vec<AliyunDriveTransferHeader>,
    body: Vec<u8>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PreauthorizedKind {
    Upload,
    Download,
}

struct PreauthorizedUrl {
    kind: PreauthorizedKind,
    expires_at: Instant,
}

#[derive(Default)]
pub struct AliyunDriveTransferAuthorizations(Mutex<HashMap<String, PreauthorizedUrl>>);

impl AliyunDriveTransferAuthorizations {
    fn register(
        &self,
        raw_url: &str,
        kind: PreauthorizedKind,
    ) -> Result<(), AliyunDriveNativeError> {
        let url = validate_preauthorized_url(raw_url)?;
        let key = url.to_string();
        let now = Instant::now();
        let mut values = self
            .0
            .lock()
            .map_err(|_| AliyunDriveNativeError::oauth_failed())?;
        values.retain(|_, value| value.expires_at > now);
        if values.len() >= MAX_PREAUTHORIZED_URLS && !values.contains_key(&key) {
            let oldest = values
                .iter()
                .min_by_key(|(_, value)| value.expires_at)
                .map(|(key, _)| key.clone());
            if let Some(oldest) = oldest {
                values.remove(&oldest);
            }
        }
        let ttl = match kind {
            PreauthorizedKind::Upload => UPLOAD_URL_TTL,
            PreauthorizedKind::Download => DOWNLOAD_URL_TTL,
        };
        values.insert(
            key,
            PreauthorizedUrl {
                kind,
                expires_at: now + ttl,
            },
        );
        Ok(())
    }

    fn require(
        &self,
        raw_url: &str,
        kind: PreauthorizedKind,
    ) -> Result<Url, AliyunDriveNativeError> {
        let url = validate_preauthorized_url(raw_url)?;
        let key = url.to_string();
        let now = Instant::now();
        let mut values = self
            .0
            .lock()
            .map_err(|_| AliyunDriveNativeError::oauth_failed())?;
        values.retain(|_, value| value.expires_at > now);
        values
            .get(&key)
            .filter(|value| value.kind == kind)
            .ok_or_else(AliyunDriveNativeError::invalid_request)?;
        Ok(url)
    }
}

fn validate_preauthorized_url(raw_url: &str) -> Result<Url, AliyunDriveNativeError> {
    if raw_url.is_empty() || raw_url.len() > MAX_URL_LENGTH {
        return Err(AliyunDriveNativeError::invalid_response());
    }
    let url = Url::parse(raw_url).map_err(|_| AliyunDriveNativeError::invalid_response())?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || url.port().is_some_and(|port| port != 443)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.path().is_empty()
        || url.path() == "/"
    {
        return Err(AliyunDriveNativeError::invalid_response());
    }
    Ok(url)
}

fn validate_api_url(raw_url: &str) -> Result<Url, AliyunDriveNativeError> {
    if raw_url.is_empty() || raw_url.len() > MAX_URL_LENGTH {
        return Err(AliyunDriveNativeError::invalid_request());
    }
    let url = Url::parse(raw_url).map_err(|_| AliyunDriveNativeError::invalid_request())?;
    if url.scheme() != "https"
        || url.origin().ascii_serialization() != ALIYUN_DRIVE_OPENAPI_ORIGIN
        || url.port().is_some_and(|port| port != 443)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !ALLOWED_API_PATHS.contains(&url.path())
    {
        return Err(AliyunDriveNativeError::invalid_request());
    }
    Ok(url)
}

fn allowed_header(kind: AliyunDriveTransferKind, name: &str) -> bool {
    match kind {
        AliyunDriveTransferKind::Api => matches!(
            name,
            "authorization" | "accept" | "content-type" | "content-length"
        ),
        AliyunDriveTransferKind::Upload => {
            matches!(name, "accept" | "content-type" | "content-length")
        }
        AliyunDriveTransferKind::Download => matches!(name, "accept" | "range"),
    }
}

fn validated_headers(
    kind: AliyunDriveTransferKind,
    values: &[AliyunDriveTransferHeader],
) -> Result<HeaderMap, AliyunDriveNativeError> {
    if values.len() > MAX_HEADER_COUNT {
        return Err(AliyunDriveNativeError::invalid_request());
    }
    let mut headers = HeaderMap::new();
    let mut total_bytes = 0_usize;
    for value in values {
        let name_text = value.name.to_ascii_lowercase();
        let maximum = if name_text == "authorization" {
            MAX_TOKEN_LENGTH + "Bearer ".len()
        } else {
            MAX_URL_LENGTH
        };
        if !allowed_header(kind, &name_text)
            || value.value.is_empty()
            || value.value.len() > maximum
            || value.value.chars().any(char::is_control)
        {
            return Err(AliyunDriveNativeError::invalid_request());
        }
        total_bytes = total_bytes
            .saturating_add(name_text.len())
            .saturating_add(value.value.len());
        if total_bytes > MAX_HEADER_BYTES {
            return Err(AliyunDriveNativeError::invalid_request());
        }
        let name = HeaderName::from_bytes(name_text.as_bytes())
            .map_err(|_| AliyunDriveNativeError::invalid_request())?;
        if headers.contains_key(&name) {
            return Err(AliyunDriveNativeError::invalid_request());
        }
        let header_value = HeaderValue::from_str(&value.value)
            .map_err(|_| AliyunDriveNativeError::invalid_request())?;
        headers.insert(name, header_value);
    }
    if kind == AliyunDriveTransferKind::Api {
        let authorization = headers
            .get("authorization")
            .and_then(|value| value.to_str().ok())
            .ok_or_else(AliyunDriveNativeError::invalid_request)?;
        let token = authorization
            .strip_prefix("Bearer ")
            .ok_or_else(AliyunDriveNativeError::invalid_request)?;
        if !valid_token_text(token) {
            return Err(AliyunDriveNativeError::invalid_request());
        }
        let content_type = headers
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(';').next())
            .map(str::trim);
        if !content_type.is_some_and(|value| value.eq_ignore_ascii_case("application/json")) {
            return Err(AliyunDriveNativeError::invalid_request());
        }
    } else if headers.contains_key("authorization") {
        return Err(AliyunDriveNativeError::invalid_request());
    }
    Ok(headers)
}

fn transfer_method(
    kind: AliyunDriveTransferKind,
    value: &str,
) -> Result<Method, AliyunDriveNativeError> {
    let allowed = match kind {
        AliyunDriveTransferKind::Api => value == "POST",
        AliyunDriveTransferKind::Upload => value == "PUT",
        AliyunDriveTransferKind::Download => value == "GET",
    };
    if !allowed {
        return Err(AliyunDriveNativeError::invalid_request());
    }
    Method::from_bytes(value.as_bytes()).map_err(|_| AliyunDriveNativeError::invalid_request())
}

fn validate_transfer_limits(
    request: &AliyunDriveTransferRequest,
) -> Result<(), AliyunDriveNativeError> {
    let body_length = request.body.as_ref().map_or(0, Vec::len);
    let max_body = match request.kind {
        AliyunDriveTransferKind::Api => MAX_METADATA_BODY_BYTES,
        AliyunDriveTransferKind::Upload => MAX_TRANSFER_CHUNK_BYTES,
        AliyunDriveTransferKind::Download => 0,
    };
    if body_length > max_body
        || (request.kind == AliyunDriveTransferKind::Api && body_length == 0)
        || (request.kind == AliyunDriveTransferKind::Download && body_length > 0)
    {
        return Err(AliyunDriveNativeError::invalid_request());
    }
    if request.kind == AliyunDriveTransferKind::Api {
        let body = request.body.as_deref().unwrap_or_default();
        if !serde_json::from_slice::<Value>(body).is_ok_and(|value| value.is_object()) {
            return Err(AliyunDriveNativeError::invalid_request());
        }
    }
    let max_response = match request.kind {
        AliyunDriveTransferKind::Download => MAX_DOWNLOAD_RESPONSE_BYTES,
        _ => MAX_METADATA_RESPONSE_BYTES,
    };
    if request.max_response_bytes == 0 || request.max_response_bytes > max_response {
        return Err(AliyunDriveNativeError::invalid_request());
    }
    Ok(())
}

fn validate_semantic_headers(
    request: &AliyunDriveTransferRequest,
    headers: &HeaderMap,
) -> Result<(), AliyunDriveNativeError> {
    if let Some(value) = headers.get("content-length") {
        let declared = value
            .to_str()
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .ok_or_else(AliyunDriveNativeError::invalid_request)?;
        if declared != request.body.as_ref().map_or(0, Vec::len) {
            return Err(AliyunDriveNativeError::invalid_request());
        }
    }
    if let Some(value) = headers.get("range") {
        let value = value
            .to_str()
            .map_err(|_| AliyunDriveNativeError::invalid_request())?;
        let Some((start, end)) = value
            .strip_prefix("bytes=")
            .and_then(|value| value.split_once('-'))
        else {
            return Err(AliyunDriveNativeError::invalid_request());
        };
        let (Ok(start), Ok(end)) = (start.parse::<u64>(), end.parse::<u64>()) else {
            return Err(AliyunDriveNativeError::invalid_request());
        };
        if start > end
            || end
                .checked_sub(start)
                .and_then(|value| value.checked_add(1))
                .is_none_or(|length| length > request.max_response_bytes as u64)
        {
            return Err(AliyunDriveNativeError::invalid_request());
        }
    }
    Ok(())
}

fn response_headers(
    headers: &HeaderMap,
) -> Result<Vec<AliyunDriveTransferHeader>, AliyunDriveNativeError> {
    const ALLOWED: [&str; 9] = [
        "content-type",
        "content-length",
        "content-range",
        "content-disposition",
        "last-modified",
        "range",
        "retry-after",
        "etag",
        "x-request-id",
    ];
    let mut result = Vec::new();
    for name in ALLOWED {
        let Some(value) = headers.get(name) else {
            continue;
        };
        let value = value
            .to_str()
            .map_err(|_| AliyunDriveNativeError::invalid_response())?;
        if value.len() > MAX_URL_LENGTH || value.chars().any(char::is_control) {
            return Err(AliyunDriveNativeError::invalid_response());
        }
        result.push(AliyunDriveTransferHeader {
            name: name.to_owned(),
            value: value.to_owned(),
        });
    }
    Ok(result)
}

fn has_json_content_type(headers: &HeaderMap) -> bool {
    headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("application/json"))
}

#[derive(Deserialize)]
struct AliyunDrivePartCapability {
    upload_url: Option<String>,
}

#[derive(Deserialize)]
struct AliyunDriveCapabilityResponse {
    url: Option<String>,
    part_info_list: Option<Vec<AliyunDrivePartCapability>>,
}

fn register_api_capabilities(
    authorizations: &AliyunDriveTransferAuthorizations,
    api_path: &str,
    status: StatusCode,
    headers: &HeaderMap,
    body: &[u8],
) -> Result<(), AliyunDriveNativeError> {
    if !status.is_success() || body.is_empty() || !has_json_content_type(headers) {
        return Ok(());
    }
    let parsed: AliyunDriveCapabilityResponse = match serde_json::from_slice(body) {
        Ok(parsed) => parsed,
        Err(_) => return Ok(()),
    };
    match api_path {
        "/adrive/v1.0/openFile/getDownloadUrl" => {
            if let Some(url) = parsed.url {
                authorizations.register(&url, PreauthorizedKind::Download)?;
            }
        }
        "/adrive/v1.0/openFile/create" | "/adrive/v1.0/openFile/getUploadUrl" => {
            let parts = parsed.part_info_list.unwrap_or_default();
            if parts.len() > 10_000 {
                return Err(AliyunDriveNativeError::invalid_response());
            }
            for part in parts {
                if let Some(url) = part.upload_url {
                    authorizations.register(&url, PreauthorizedKind::Upload)?;
                }
            }
        }
        _ => {}
    }
    Ok(())
}

#[tauri::command]
pub async fn aliyun_drive_transfer(
    request: AliyunDriveTransferRequest,
    authorizations: tauri::State<'_, AliyunDriveTransferAuthorizations>,
) -> Result<AliyunDriveTransferResponse, AliyunDriveNativeError> {
    validate_transfer_limits(&request)?;
    let method = transfer_method(request.kind, &request.method)?;
    let url = match request.kind {
        AliyunDriveTransferKind::Api => validate_api_url(&request.url)?,
        AliyunDriveTransferKind::Upload => {
            authorizations.require(&request.url, PreauthorizedKind::Upload)?
        }
        AliyunDriveTransferKind::Download => {
            authorizations.require(&request.url, PreauthorizedKind::Download)?
        }
    };
    let api_path = (request.kind == AliyunDriveTransferKind::Api).then(|| url.path().to_owned());
    let headers = validated_headers(request.kind, &request.headers)?;
    validate_semantic_headers(&request, &headers)?;
    let client = http_client(transfer_timeout(request.timeout_ms)?)?;
    let mut builder = client.request(method, url).headers(headers);
    if let Some(body) = request.body {
        builder = builder.body(body);
    }
    let mut response = builder
        .send()
        .await
        .map_err(|_| AliyunDriveNativeError::network_failed())?;
    if response.status().is_redirection() {
        return Err(AliyunDriveNativeError::invalid_response());
    }
    let status = response.status();
    let raw_headers = response.headers().clone();
    let result_headers = response_headers(&raw_headers)?;
    let body = bounded_response_body(&mut response, request.max_response_bytes).await?;
    if let Some(api_path) = api_path {
        register_api_capabilities(
            authorizations.inner(),
            &api_path,
            status,
            &raw_headers,
            &body,
        )?;
    }
    Ok(AliyunDriveTransferResponse {
        status: status.as_u16(),
        headers: result_headers,
        body,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn error_code<T>(result: Result<T, AliyunDriveNativeError>) -> AliyunDriveNativeErrorCode {
        match result {
            Ok(_) => panic!("expected error"),
            Err(error) => error.code,
        }
    }

    fn test_secret() -> AliyunDriveClientSecret {
        AliyunDriveClientSecret("test-confidential-secret".to_owned())
    }

    #[test]
    fn publisher_configuration_is_all_or_nothing_and_uses_exact_compiled_coordinates() {
        let configured = publisher_configuration(
            Some("aliyun-client-123"),
            Some("https://broker.example"),
            Some("http://127.0.0.1:43127/oauth/aliyun-drive/callback"),
        )
        .unwrap();
        assert_eq!(configured.client_id, "aliyun-client-123");
        assert_eq!(
            configured.exchange_url.as_str(),
            "https://broker.example/v1/aliyun-drive/oauth/exchange"
        );
        assert_eq!(
            configured.refresh_url.as_str(),
            "https://broker.example/v1/aliyun-drive/oauth/refresh"
        );
        assert_eq!(
            configured.redirect_uri.as_str(),
            "http://127.0.0.1:43127/oauth/aliyun-drive/callback"
        );
        for values in [
            (
                None,
                Some("https://broker.example"),
                Some("http://127.0.0.1:43127/oauth/aliyun-drive/callback"),
            ),
            (
                Some("aliyun-client-123"),
                None,
                Some("http://127.0.0.1:43127/oauth/aliyun-drive/callback"),
            ),
            (
                Some("aliyun-client-123"),
                Some("https://broker.example"),
                None,
            ),
        ] {
            assert_eq!(
                error_code(publisher_configuration(values.0, values.1, values.2)),
                AliyunDriveNativeErrorCode::Unsupported
            );
        }
        assert_eq!(
            error_code(publisher_configuration(
                Some("aliyun-client-123"),
                Some("https://broker.example"),
                Some("http://127.0.0.1:43127/other"),
            )),
            AliyunDriveNativeErrorCode::RedirectUriMismatch
        );
    }

    #[test]
    fn oauth_ipc_modes_are_exact_and_never_fall_back() {
        let publisher: AliyunDriveOAuthClient =
            serde_json::from_str(r#"{"mode":"publisher-broker-confidential"}"#).unwrap();
        assert!(matches!(
            publisher,
            AliyunDriveOAuthClient::PublisherBrokerConfidential {}
        ));
        assert!(serde_json::from_str::<AliyunDriveOAuthClient>(
            r#"{"mode":"publisher-broker-confidential","clientId":"renderer-override"}"#
        )
        .is_err());
        assert!(serde_json::from_str::<AliyunDriveConfidentialOAuthClient>(
            r#"{"mode":"self-hosted-public","clientId":"aliyun-client-123","redirectUri":"http://127.0.0.1:43127/custom/callback"}"#
        )
        .is_err());
        let direct: AliyunDriveOAuthClient = serde_json::from_str(
            r#"{"mode":"self-hosted-public","clientId":"aliyun-client-123","redirectUri":"http://127.0.0.1:43127/custom/callback"}"#,
        )
        .unwrap();
        let resolved = resolve_authorization_client(&direct).unwrap();
        assert!(matches!(resolved.backend, TokenBackend::DirectPublic));
    }

    #[test]
    fn authorization_url_uses_fixed_endpoint_exact_scopes_folder_style_and_s256() {
        let redirect =
            parse_loopback_redirect_uri("http://127.0.0.1:43127/oauth/aliyun-drive/callback", None)
                .unwrap();
        let url = Url::parse(
            &authorization_url("aliyun-client-123", &redirect, "state", "challenge").unwrap(),
        )
        .unwrap();
        let query = url.query_pairs().collect::<HashMap<_, _>>();
        assert_eq!(
            url.as_str().split('?').next(),
            Some(ALIYUN_DRIVE_AUTHORIZE_URL)
        );
        assert_eq!(query.len(), 9);
        assert_eq!(
            query.get("scope").map(|value| value.as_ref()),
            Some(ALIYUN_DRIVE_OAUTH_SCOPE)
        );
        assert_eq!(
            query.get("style").map(|value| value.as_ref()),
            Some("folder")
        );
        assert_eq!(
            query.get("drive").map(|value| value.as_ref()),
            Some("backup")
        );
        assert_eq!(
            query
                .get("code_challenge_method")
                .map(|value| value.as_ref()),
            Some("S256")
        );
        assert_eq!(
            query.get("redirect_uri").map(|value| value.as_ref()),
            Some("http://127.0.0.1:43127/oauth/aliyun-drive/callback")
        );
    }

    #[test]
    fn loopback_callback_and_state_are_fixed_one_time_and_bounded() {
        for invalid in [
            "http://localhost:43127/oauth/aliyun-drive/callback",
            "http://127.0.0.1/oauth/aliyun-drive/callback",
            "https://127.0.0.1:43127/oauth/aliyun-drive/callback",
            "http://127.0.0.1:43127/",
        ] {
            assert!(parse_loopback_redirect_uri(invalid, None).is_err());
        }
        let (verifier, challenge) = pkce_pair();
        assert!((43..=128).contains(&verifier.len()));
        assert_eq!(
            challenge,
            URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
        );
        let path = "/oauth/aliyun-drive/callback";
        let mut state = OneTimeState::new("expected".to_owned());
        assert!(matches!(
            callback_decision(
                "GET /oauth/aliyun-drive/callback?code=x&state=wrong HTTP/1.1\r\n\r\n",
                path,
                &mut state
            ),
            CallbackDecision::Ignore
        ));
        assert!(matches!(
            callback_decision(
                "GET /wrong?code=x&state=expected HTTP/1.1\r\n\r\n",
                path,
                &mut state
            ),
            CallbackDecision::Ignore
        ));
        assert!(matches!(
            callback_decision(
                "GET /oauth/aliyun-drive/callback?code=authorization-code&state=expected HTTP/1.1\r\n\r\n",
                path,
                &mut state
            ),
            CallbackDecision::Success(code) if code == "authorization-code"
        ));
        assert!(matches!(
            callback_decision(
                "GET /oauth/aliyun-drive/callback?code=again&state=expected HTTP/1.1\r\n\r\n",
                path,
                &mut state
            ),
            CallbackDecision::Failed(_)
        ));
    }

    #[test]
    fn broker_and_direct_token_requests_have_exact_authority_and_mode_fields() {
        let client = http_client(Duration::from_secs(10)).unwrap();
        let (exchange_url, refresh_url) = oauth_broker_urls("https://broker.example").unwrap();
        let broker_exchange =
            broker_exchange_request(&client, &exchange_url, "code", "verifier").unwrap();
        let broker_exchange_body: Value = serde_json::from_slice(
            broker_exchange
                .body()
                .and_then(reqwest::Body::as_bytes)
                .unwrap(),
        )
        .unwrap();
        assert_eq!(broker_exchange.url().as_str(), exchange_url.as_str());
        assert_eq!(broker_exchange_body["protocolVersion"], 1);
        assert_eq!(broker_exchange_body["code"], "code");
        assert_eq!(broker_exchange_body["codeVerifier"], "verifier");
        assert_eq!(broker_exchange_body.as_object().unwrap().len(), 3);

        let broker_refresh =
            broker_refresh_request(&client, &refresh_url, "refresh-token").unwrap();
        let broker_refresh_body: Value = serde_json::from_slice(
            broker_refresh
                .body()
                .and_then(reqwest::Body::as_bytes)
                .unwrap(),
        )
        .unwrap();
        assert_eq!(broker_refresh.url().as_str(), refresh_url.as_str());
        assert_eq!(broker_refresh_body.as_object().unwrap().len(), 2);

        let secret = test_secret();
        let confidential = direct_exchange_request(
            &client,
            "aliyun-client-123",
            Some(&secret),
            "code",
            "verifier",
        )
        .unwrap();
        let confidential_body: Value = serde_json::from_slice(
            confidential
                .body()
                .and_then(reqwest::Body::as_bytes)
                .unwrap(),
        )
        .unwrap();
        assert_eq!(confidential.url().as_str(), ALIYUN_DRIVE_TOKEN_URL);
        assert_eq!(confidential_body["client_secret"], secret.expose());
        assert_eq!(confidential_body["code_verifier"], "verifier");
        assert!(confidential_body.get("redirect_uri").is_none());

        let public =
            direct_exchange_request(&client, "aliyun-client-123", None, "code", "verifier")
                .unwrap();
        let public_body: Value =
            serde_json::from_slice(public.body().and_then(reqwest::Body::as_bytes).unwrap())
                .unwrap();
        assert!(public_body.get("client_secret").is_none());
        assert!(public_body.get("redirect_uri").is_none());
    }

    #[test]
    fn token_contract_enforces_grant_class_scope_and_refresh_rotation() {
        let confidential = br#"{"access_token":"access","refresh_token":"refresh-new","expires_in":7200,"token_type":"Bearer","scope":"user:base,file:all:read,file:all:write"}"#;
        assert_eq!(
            parsed_direct_token_response(confidential, true)
                .unwrap()
                .refresh_token
                .as_deref(),
            Some("refresh-new")
        );
        let public = br#"{"access_token":"access","expires_in":2592000,"token_type":"Bearer","scope":"user:base,file:all:read,file:all:write"}"#;
        assert!(parsed_direct_token_response(public, false).is_ok());
        assert!(parsed_direct_token_response(confidential, false).is_err());
        assert!(parsed_direct_token_response(public, true).is_err());
        assert!(parsed_direct_token_response(
            br#"{"access_token":"access","expires_in":3600,"token_type":"Bearer","scope":"file:all:read,file:all:write"}"#,
            false
        )
        .is_err());
        assert!(rotated_refresh_token("same", Some("same".to_owned())).is_err());
        assert_eq!(
            rotated_refresh_token("old", Some("new".to_owned())).unwrap(),
            "new"
        );
        assert!(parsed_broker_token_response(
            br#"{"access_token":"access","refresh_token":"refresh","expires_in":7200,"token_type":"Bearer","scope":"unexpected"}"#
        )
        .is_err());
    }

    #[test]
    fn userinfo_uses_only_lossless_bounded_id_as_authority() {
        let string_user = parsed_userinfo_response(
            br#"{"id":"stable-id","name":"Person","email":"ignored@example.com"}"#,
            Some("stable-id"),
        )
        .unwrap();
        assert_eq!(string_user.subject, "stable-id");
        assert_eq!(string_user.name.as_deref(), Some("Person"));
        assert_eq!(
            parsed_userinfo_response(br#"{"id":123456789}"#, None)
                .unwrap()
                .subject,
            "123456789"
        );
        assert_eq!(
            error_code(parsed_userinfo_response(
                br#"{"id":"other"}"#,
                Some("stable-id")
            )),
            AliyunDriveNativeErrorCode::SubjectMismatch
        );
        assert!(parsed_userinfo_response(br#"{"sub":"wrong-field"}"#, None).is_err());
        assert!(parsed_userinfo_response(br#"{"id":1.5}"#, None).is_err());
    }

    #[test]
    fn provider_errors_are_static_and_never_reflect_secrets() {
        let error = classified_token_exchange_error(
            StatusCode::BAD_REQUEST,
            br#"{"error":"invalid_client","error_description":"test-confidential-secret"}"#,
            None,
            false,
        );
        assert_eq!(error.code, AliyunDriveNativeErrorCode::OauthClientInvalid);
        let serialized = serde_json::to_string(&error).unwrap();
        assert!(!serialized.contains("test-confidential-secret"));
        assert_eq!(
            classified_token_exchange_error(
                StatusCode::SERVICE_UNAVAILABLE,
                b"provider detail",
                None,
                true
            )
            .code,
            AliyunDriveNativeErrorCode::BrokerUnavailable
        );
    }

    #[test]
    fn openapi_paths_methods_and_headers_are_exact() {
        for path in ALLOWED_API_PATHS {
            assert!(validate_api_url(&format!("{ALIYUN_DRIVE_OPENAPI_ORIGIN}{path}")).is_ok());
        }
        for invalid in [
            "https://openapi.alipan.com/adrive/v1.0/openFile/delete",
            "https://openapi.alipan.com/adrive/v1.0/openFile/list?marker=renderer",
            "https://openapi.alipan.com.evil.example/adrive/v1.0/openFile/list",
            "http://openapi.alipan.com/adrive/v1.0/openFile/list",
        ] {
            assert!(validate_api_url(invalid).is_err());
        }
        assert!(transfer_method(AliyunDriveTransferKind::Api, "POST").is_ok());
        assert!(transfer_method(AliyunDriveTransferKind::Api, "GET").is_err());
        assert!(transfer_method(AliyunDriveTransferKind::Upload, "PUT").is_ok());
        assert!(transfer_method(AliyunDriveTransferKind::Download, "GET").is_ok());

        let api_headers = vec![
            AliyunDriveTransferHeader {
                name: "authorization".to_owned(),
                value: "Bearer access-token".to_owned(),
            },
            AliyunDriveTransferHeader {
                name: "content-type".to_owned(),
                value: "application/json".to_owned(),
            },
        ];
        assert!(validated_headers(AliyunDriveTransferKind::Api, &api_headers).is_ok());
        assert!(validated_headers(AliyunDriveTransferKind::Upload, &api_headers).is_err());
        assert!(validated_headers(AliyunDriveTransferKind::Download, &api_headers).is_err());
    }

    #[test]
    fn signed_urls_require_exact_trusted_api_observation() {
        let authorizations = AliyunDriveTransferAuthorizations::default();
        let upload = "https://upload.example.test/exact-part?signature=one";
        let download = "https://download.example.test/exact-file?signature=two";
        assert!(authorizations
            .require(upload, PreauthorizedKind::Upload)
            .is_err());
        let headers =
            HeaderMap::from_iter([(CONTENT_TYPE, HeaderValue::from_static("application/json"))]);
        register_api_capabilities(
            &authorizations,
            "/adrive/v1.0/openFile/create",
            StatusCode::OK,
            &headers,
            br#"{"part_info_list":[{"part_number":1,"upload_url":"https://upload.example.test/exact-part?signature=one"}]}"#,
        )
        .unwrap();
        register_api_capabilities(
            &authorizations,
            "/adrive/v1.0/openFile/getDownloadUrl",
            StatusCode::OK,
            &headers,
            br#"{"url":"https://download.example.test/exact-file?signature=two"}"#,
        )
        .unwrap();
        assert!(authorizations
            .require(upload, PreauthorizedKind::Upload)
            .is_ok());
        assert!(authorizations
            .require(download, PreauthorizedKind::Download)
            .is_ok());
        assert!(authorizations
            .require(
                "https://upload.example.test/other-part?signature=one",
                PreauthorizedKind::Upload
            )
            .is_err());
        assert!(authorizations
            .require(upload, PreauthorizedKind::Download)
            .is_err());
    }
}
