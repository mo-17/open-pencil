use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{rngs::OsRng, RngCore};
use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue, ACCEPT, CONTENT_TYPE, RETRY_AFTER},
    redirect::Policy,
    Client, Method, StatusCode, Url,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    io::{ErrorKind, Read, Write},
    net::{TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

const GOOGLE_AUTHORIZATION_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
const GOOGLE_USERINFO_URL: &str = "https://openidconnect.googleapis.com/v1/userinfo";
const OAUTH_BROKER_EXCHANGE_PATH: &str = "/v1/google-drive/oauth/exchange";
const OAUTH_BROKER_REFRESH_PATH: &str = "/v1/google-drive/oauth/refresh";
const OAUTH_BROKER_PROTOCOL_VERSION: u8 = 1;
const COMPILED_GOOGLE_DRIVE_CLIENT_ID: Option<&str> = option_env!("VITE_GOOGLE_DRIVE_CLIENT_ID");
const COMPILED_GOOGLE_DRIVE_OAUTH_BROKER_ORIGIN: Option<&str> =
    option_env!("OPENPENCIL_GOOGLE_DRIVE_OAUTH_BROKER_ORIGIN");
const DRIVE_API_ORIGIN: &str = "www.googleapis.com";
const DRIVE_SCOPE: &str = "https://www.googleapis.com/auth/drive.file";
const USERINFO_EMAIL_SCOPE: &str = "https://www.googleapis.com/auth/userinfo.email";
const CANONICAL_SCOPES: [&str; 3] = ["openid", "email", DRIVE_SCOPE];
const DEFAULT_OAUTH_TIMEOUT_MS: u64 = 180_000;
const MIN_OAUTH_TIMEOUT_MS: u64 = 10_000;
const MAX_OAUTH_TIMEOUT_MS: u64 = 300_000;
const DEFAULT_TRANSFER_TIMEOUT_MS: u64 = 30_000;
const MAX_TRANSFER_TIMEOUT_MS: u64 = 120_000;
const MAX_CALLBACK_HEAD_BYTES: usize = 8 * 1024;
const MAX_OAUTH_RESPONSE_BYTES: usize = 64 * 1024;
const MAX_OAUTH_BROKER_RESPONSE_BYTES: usize = 32 * 1024;
const MAX_OAUTH_BROKER_REQUEST_TOKEN_LENGTH: usize = 8 * 1024;
const MAX_AUTHORIZATION_CODE_LENGTH: usize = 4 * 1024;
const DEFAULT_OAUTH_BROKER_RETRY_AFTER_MS: u64 = 60_000;
const MAX_OAUTH_BROKER_RETRY_AFTER_SECONDS: u64 = 300;
const MAX_METADATA_BODY_BYTES: usize = 1024 * 1024;
const MAX_TRANSFER_CHUNK_BYTES: usize = 8 * 1024 * 1024;
const MAX_HEADER_COUNT: usize = 16;
const MAX_HEADER_BYTES: usize = 32 * 1024;
const MAX_URL_LENGTH: usize = 8 * 1024;
const MAX_TOKEN_LENGTH: usize = 8 * 1024;
const MIN_DESKTOP_CLIENT_SECRET_LENGTH: usize = 8;
const MAX_DESKTOP_CLIENT_SECRET_LENGTH: usize = 4 * 1024;
const MAX_CONCURRENT_OAUTH_OPERATIONS: usize = 8;
const AUTHORIZATION_RECEIVED_MESSAGE: &str =
    "Authorization received. Return to OpenPencil while it finishes connecting.";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum GoogleDriveNativeErrorCode {
    InvalidRequest,
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
    OauthBrokerRateLimited,
    OauthBrokerUnavailable,
    OauthBrokerMisconfigured,
    OauthBrokerProtocolInvalid,
    UserinfoFailed,
    ScopeMismatch,
    SubjectMismatch,
    NetworkFailed,
    ResponseTooLarge,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleDriveNativeError {
    code: GoogleDriveNativeErrorCode,
    message: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    retry_after_ms: Option<u64>,
}

impl GoogleDriveNativeError {
    fn new(code: GoogleDriveNativeErrorCode, message: &'static str) -> Self {
        Self {
            code,
            message,
            retry_after_ms: None,
        }
    }

    fn invalid_request() -> Self {
        Self::new(
            GoogleDriveNativeErrorCode::InvalidRequest,
            "Google Drive request is invalid",
        )
    }

    fn network_failed() -> Self {
        Self::new(
            GoogleDriveNativeErrorCode::NetworkFailed,
            "Google Drive network request failed",
        )
    }

    fn oauth_failed() -> Self {
        Self::new(
            GoogleDriveNativeErrorCode::OauthFailed,
            "Google authorization failed",
        )
    }

    fn token_exchange_failed() -> Self {
        Self::new(
            GoogleDriveNativeErrorCode::TokenExchangeFailed,
            "Google token exchange failed",
        )
    }

    fn oauth_client_invalid() -> Self {
        Self::new(
            GoogleDriveNativeErrorCode::OauthClientInvalid,
            "Google OAuth client is invalid",
        )
    }

    fn authorization_grant_invalid() -> Self {
        Self::new(
            GoogleDriveNativeErrorCode::AuthorizationGrantInvalid,
            "Google authorization grant is invalid",
        )
    }

    fn redirect_uri_mismatch() -> Self {
        Self::new(
            GoogleDriveNativeErrorCode::RedirectUriMismatch,
            "Google redirect URI did not match",
        )
    }

    fn token_request_invalid() -> Self {
        Self::new(
            GoogleDriveNativeErrorCode::TokenRequestInvalid,
            "Google token request is invalid",
        )
    }

    fn token_response_invalid() -> Self {
        Self::new(
            GoogleDriveNativeErrorCode::TokenResponseInvalid,
            "Google returned an invalid token response",
        )
    }

    fn oauth_broker_rate_limited(retry_after_ms: Option<u64>) -> Self {
        Self {
            code: GoogleDriveNativeErrorCode::OauthBrokerRateLimited,
            message: "OpenPencil OAuth Broker rate limit was reached",
            retry_after_ms: Some(retry_after_ms.unwrap_or(DEFAULT_OAUTH_BROKER_RETRY_AFTER_MS)),
        }
    }

    fn oauth_broker_unavailable() -> Self {
        Self::new(
            GoogleDriveNativeErrorCode::OauthBrokerUnavailable,
            "OpenPencil OAuth Broker is temporarily unavailable",
        )
    }

    fn oauth_broker_misconfigured() -> Self {
        Self::new(
            GoogleDriveNativeErrorCode::OauthBrokerMisconfigured,
            "OpenPencil OAuth Broker is not configured for this build",
        )
    }

    fn oauth_broker_protocol_invalid() -> Self {
        Self::new(
            GoogleDriveNativeErrorCode::OauthBrokerProtocolInvalid,
            "OpenPencil OAuth Broker returned an invalid response",
        )
    }

    fn userinfo_failed() -> Self {
        Self::new(
            GoogleDriveNativeErrorCode::UserinfoFailed,
            "Google user information could not be verified",
        )
    }

    fn response_too_large() -> Self {
        Self::new(
            GoogleDriveNativeErrorCode::ResponseTooLarge,
            "Google Drive response exceeded the byte limit",
        )
    }
}

#[derive(Default)]
pub struct GoogleDriveOAuthOperations(Mutex<HashMap<String, Arc<AtomicBool>>>);

impl GoogleDriveOAuthOperations {
    fn begin(&self, operation_id: &str) -> Result<Arc<AtomicBool>, GoogleDriveNativeError> {
        if !valid_operation_id(operation_id) {
            return Err(GoogleDriveNativeError::invalid_request());
        }
        let mut operations = self
            .0
            .lock()
            .map_err(|_| GoogleDriveNativeError::oauth_failed())?;
        if operations.contains_key(operation_id) {
            return Err(GoogleDriveNativeError::invalid_request());
        }
        if operations.len() >= MAX_CONCURRENT_OAUTH_OPERATIONS {
            return Err(GoogleDriveNativeError::new(
                GoogleDriveNativeErrorCode::OauthFailed,
                "Too many Google authorization operations are active",
            ));
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

    fn cancel(&self, operation_id: &str) -> Result<bool, GoogleDriveNativeError> {
        if !valid_operation_id(operation_id) {
            return Err(GoogleDriveNativeError::invalid_request());
        }
        let operations = self
            .0
            .lock()
            .map_err(|_| GoogleDriveNativeError::oauth_failed())?;
        let Some(cancelled) = operations.get(operation_id) else {
            return Ok(false);
        };
        cancelled.store(true, Ordering::SeqCst);
        Ok(true)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GoogleDriveAuthorizeRequest {
    operation_id: String,
    oauth_client: GoogleDriveOAuthClient,
    timeout_ms: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleDriveAuthorizeResponse {
    access_token: String,
    refresh_token: String,
    expires_in: u64,
    granted_scopes: Vec<&'static str>,
    subject: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    email: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GoogleDriveRefreshRequest {
    operation_id: String,
    oauth_client: GoogleDriveOAuthClient,
    refresh_token: String,
    expected_subject: String,
    timeout_ms: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleDriveRefreshResponse {
    access_token: String,
    expires_in: u64,
    subject: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    email: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleDriveRevokeRequest {
    token: String,
    timeout_ms: Option<u64>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum GoogleDriveTransferKind {
    Api,
    ResumableInit,
    UploadChunk,
    DownloadChunk,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct GoogleDriveTransferHeader {
    name: String,
    value: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleDriveTransferRequest {
    kind: GoogleDriveTransferKind,
    url: String,
    method: String,
    #[serde(default)]
    headers: Vec<GoogleDriveTransferHeader>,
    body: Option<Vec<u8>>,
    max_response_bytes: usize,
    timeout_ms: Option<u64>,
}

#[derive(Serialize)]
pub struct GoogleDriveTransferResponse {
    status: u16,
    headers: Vec<GoogleDriveTransferHeader>,
    body: Vec<u8>,
}

#[derive(Deserialize)]
struct OAuthTokenResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    token_type: Option<String>,
    scope: Option<String>,
}

#[derive(Deserialize)]
struct OAuthErrorResponse {
    error: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OAuthBrokerErrorResponse {
    error: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OAuthBrokerTokenResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    token_type: Option<String>,
    scope: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OAuthBrokerExchangeRequest<'a> {
    code: &'a str,
    code_verifier: &'a str,
    protocol_version: u8,
    redirect_uri: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OAuthBrokerRefreshRequest<'a> {
    protocol_version: u8,
    refresh_token: &'a str,
}

#[derive(Deserialize)]
struct UserInfoResponse {
    sub: Option<String>,
    email: Option<String>,
    email_verified: Option<bool>,
}

struct ValidatedTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: u64,
}

struct VerifiedUser {
    subject: String,
    email: Option<String>,
}

#[derive(Deserialize)]
#[serde(tag = "mode", rename_all = "kebab-case", deny_unknown_fields)]
enum GoogleDriveOAuthClient {
    PublisherBroker {},
    SelfHostedDesktop {
        #[serde(rename = "clientId")]
        client_id: String,
        #[serde(rename = "clientSecret")]
        client_secret: GoogleDriveDesktopClientSecret,
    },
}

enum OAuthTokenBackend<'a> {
    Broker {
        client_id: &'a str,
        exchange_url: Url,
        refresh_url: Url,
    },
    SelfHostedDesktop {
        client_id: &'a str,
        client_secret: &'a GoogleDriveDesktopClientSecret,
    },
}

impl OAuthTokenBackend<'_> {
    fn client_id(&self) -> &str {
        match self {
            Self::Broker { client_id, .. } | Self::SelfHostedDesktop { client_id, .. } => client_id,
        }
    }
}

/// User-provided installed-app credential for Google's fixed Desktop token endpoint.
///
/// Desktop client secrets are not confidential client credentials, but this wrapper still
/// intentionally implements neither `Debug` nor `Serialize` so IPC values cannot be reflected by
/// ordinary diagnostics or native responses.
#[derive(Deserialize)]
#[serde(transparent)]
struct GoogleDriveDesktopClientSecret(String);

impl GoogleDriveDesktopClientSecret {
    fn expose(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, PartialEq)]
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
    Failed(GoogleDriveNativeError),
}

fn valid_operation_id(value: &str) -> bool {
    value.len() == 32
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn validate_client_id(value: &str) -> Result<(), GoogleDriveNativeError> {
    let suffix = ".apps.googleusercontent.com";
    let Some(prefix) = value.strip_suffix(suffix) else {
        return Err(GoogleDriveNativeError::invalid_request());
    };
    if !(10..=200).contains(&prefix.len())
        || !prefix
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    {
        return Err(GoogleDriveNativeError::invalid_request());
    }
    Ok(())
}

fn validate_desktop_client_secret(
    value: &GoogleDriveDesktopClientSecret,
) -> Result<(), GoogleDriveNativeError> {
    let value = value.expose();
    if !(MIN_DESKTOP_CLIENT_SECRET_LENGTH..=MAX_DESKTOP_CLIENT_SECRET_LENGTH).contains(&value.len())
        || value.trim() != value
        || !value.bytes().all(|byte| byte.is_ascii_graphic())
    {
        return Err(GoogleDriveNativeError::invalid_request());
    }
    Ok(())
}

fn oauth_broker_urls(origin: &str) -> Result<(Url, Url), GoogleDriveNativeError> {
    let parsed =
        Url::parse(origin).map_err(|_| GoogleDriveNativeError::oauth_broker_misconfigured())?;
    if parsed.scheme() != "https"
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.path() != "/"
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || parsed.origin().ascii_serialization() != origin
    {
        return Err(GoogleDriveNativeError::oauth_broker_misconfigured());
    }
    let mut exchange_url = parsed.clone();
    exchange_url.set_path(OAUTH_BROKER_EXCHANGE_PATH);
    let mut refresh_url = parsed;
    refresh_url.set_path(OAUTH_BROKER_REFRESH_PATH);
    Ok((exchange_url, refresh_url))
}

fn oauth_token_backend_from_config<'a>(
    oauth_client: &'a GoogleDriveOAuthClient,
    broker_origin: Option<&str>,
    compiled_client_id: Option<&'a str>,
) -> Result<OAuthTokenBackend<'a>, GoogleDriveNativeError> {
    match oauth_client {
        GoogleDriveOAuthClient::PublisherBroker {} => {
            let origin =
                broker_origin.ok_or_else(GoogleDriveNativeError::oauth_broker_misconfigured)?;
            let client_id = compiled_client_id
                .ok_or_else(GoogleDriveNativeError::oauth_broker_misconfigured)?;
            validate_client_id(client_id)
                .map_err(|_| GoogleDriveNativeError::oauth_broker_misconfigured())?;
            let (exchange_url, refresh_url) = oauth_broker_urls(origin)?;
            Ok(OAuthTokenBackend::Broker {
                client_id,
                exchange_url,
                refresh_url,
            })
        }
        GoogleDriveOAuthClient::SelfHostedDesktop {
            client_id,
            client_secret,
        } => {
            validate_client_id(client_id)?;
            validate_desktop_client_secret(client_secret)?;
            Ok(OAuthTokenBackend::SelfHostedDesktop {
                client_id,
                client_secret,
            })
        }
    }
}

fn oauth_token_backend(
    oauth_client: &GoogleDriveOAuthClient,
) -> Result<OAuthTokenBackend<'_>, GoogleDriveNativeError> {
    oauth_token_backend_from_config(
        oauth_client,
        COMPILED_GOOGLE_DRIVE_OAUTH_BROKER_ORIGIN,
        COMPILED_GOOGLE_DRIVE_CLIENT_ID,
    )
}

fn oauth_timeout(value: Option<u64>) -> Result<Duration, GoogleDriveNativeError> {
    let milliseconds = value.unwrap_or(DEFAULT_OAUTH_TIMEOUT_MS);
    if !(MIN_OAUTH_TIMEOUT_MS..=MAX_OAUTH_TIMEOUT_MS).contains(&milliseconds) {
        return Err(GoogleDriveNativeError::invalid_request());
    }
    Ok(Duration::from_millis(milliseconds))
}

fn transfer_timeout(value: Option<u64>) -> Result<Duration, GoogleDriveNativeError> {
    let milliseconds = value.unwrap_or(DEFAULT_TRANSFER_TIMEOUT_MS);
    if !(1_000..=MAX_TRANSFER_TIMEOUT_MS).contains(&milliseconds) {
        return Err(GoogleDriveNativeError::invalid_request());
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
    redirect_uri: &str,
    state: &str,
    challenge: &str,
) -> Result<String, GoogleDriveNativeError> {
    let mut url =
        Url::parse(GOOGLE_AUTHORIZATION_URL).map_err(|_| GoogleDriveNativeError::oauth_failed())?;
    url.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", &CANONICAL_SCOPES.join(" "))
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent")
        .append_pair("include_granted_scopes", "false")
        .append_pair("state", state);
    Ok(url.into())
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

fn read_request_head(stream: &mut TcpStream) -> Result<String, GoogleDriveNativeError> {
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(|_| GoogleDriveNativeError::oauth_failed())?;
    let mut bytes = Vec::with_capacity(1024);
    let mut buffer = [0_u8; 1024];
    loop {
        let read = stream
            .read(&mut buffer)
            .map_err(|_| GoogleDriveNativeError::oauth_failed())?;
        if read == 0 {
            break;
        }
        bytes.extend_from_slice(&buffer[..read]);
        if bytes.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
        if bytes.len() > MAX_CALLBACK_HEAD_BYTES {
            return Err(GoogleDriveNativeError::invalid_request());
        }
    }
    if bytes.len() > MAX_CALLBACK_HEAD_BYTES {
        return Err(GoogleDriveNativeError::invalid_request());
    }
    String::from_utf8(bytes).map_err(|_| GoogleDriveNativeError::invalid_request())
}

fn callback_decision(head: &str, state: &mut OneTimeState) -> CallbackDecision {
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
    if url.path() != "/" {
        return CallbackDecision::Ignore;
    }
    let mut query = HashMap::new();
    for (key, value) in url.query_pairs() {
        if key.len() > 64
            || value.len() > 4096
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
            return CallbackDecision::Failed(GoogleDriveNativeError::new(
                GoogleDriveNativeErrorCode::OauthFailed,
                "Google authorization response was already consumed",
            ));
        }
    }
    if query.contains_key("error") {
        return CallbackDecision::Failed(GoogleDriveNativeError::new(
            GoogleDriveNativeErrorCode::OauthDenied,
            "Google authorization was denied",
        ));
    }
    let Some(code) = query.get("code") else {
        return CallbackDecision::Failed(GoogleDriveNativeError::oauth_failed());
    };
    if code.is_empty() || code.len() > 4096 || code.chars().any(char::is_control) {
        return CallbackDecision::Failed(GoogleDriveNativeError::oauth_failed());
    }
    CallbackDecision::Success(code.to_owned())
}

fn wait_for_callback(
    listener: TcpListener,
    expected_state: String,
    cancelled: Arc<AtomicBool>,
    timeout: Duration,
) -> Result<String, GoogleDriveNativeError> {
    listener
        .set_nonblocking(true)
        .map_err(|_| GoogleDriveNativeError::oauth_failed())?;
    let deadline = Instant::now() + timeout;
    let mut state = OneTimeState::new(expected_state);
    loop {
        if cancelled.load(Ordering::SeqCst) {
            return Err(GoogleDriveNativeError::new(
                GoogleDriveNativeErrorCode::Cancelled,
                "Google authorization was cancelled",
            ));
        }
        if Instant::now() >= deadline {
            return Err(GoogleDriveNativeError::new(
                GoogleDriveNativeErrorCode::Timeout,
                "Google authorization timed out",
            ));
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                let head = match read_request_head(&mut stream) {
                    Ok(head) => head,
                    Err(_) => {
                        browser_response(&mut stream, "400 Bad Request", "Authorization failed.");
                        continue;
                    }
                };
                match callback_decision(&head, &mut state) {
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
                thread::sleep(Duration::from_millis(20));
            }
            Err(_) => return Err(GoogleDriveNativeError::oauth_failed()),
        }
    }
}

fn http_client(timeout: Duration) -> Result<Client, GoogleDriveNativeError> {
    Client::builder()
        .redirect(Policy::none())
        .timeout(timeout)
        .build()
        .map_err(|_| GoogleDriveNativeError::network_failed())
}

async fn bounded_response_body(
    response: &mut reqwest::Response,
    max_bytes: usize,
) -> Result<Vec<u8>, GoogleDriveNativeError> {
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes as u64)
    {
        return Err(GoogleDriveNativeError::response_too_large());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| GoogleDriveNativeError::network_failed())?
    {
        if body.len().saturating_add(chunk.len()) > max_bytes {
            return Err(GoogleDriveNativeError::response_too_large());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn validate_token(value: Option<String>) -> Result<String, GoogleDriveNativeError> {
    let Some(value) = value else {
        return Err(GoogleDriveNativeError::oauth_failed());
    };
    if !valid_token_text(&value) {
        return Err(GoogleDriveNativeError::oauth_failed());
    }
    Ok(value)
}

fn valid_token_text(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_TOKEN_LENGTH
        && value.trim() == value
        && !value.chars().any(char::is_whitespace)
        && !value.chars().any(char::is_control)
}

fn validate_granted_scopes(value: Option<String>) -> Result<(), GoogleDriveNativeError> {
    let Some(value) = value else {
        return Err(GoogleDriveNativeError::new(
            GoogleDriveNativeErrorCode::ScopeMismatch,
            "Google did not return the required authorization scopes",
        ));
    };
    if value.len() > 2048 || value.chars().any(char::is_control) {
        return Err(GoogleDriveNativeError::new(
            GoogleDriveNativeErrorCode::ScopeMismatch,
            "Google did not return the required authorization scopes",
        ));
    }
    let scopes = value.split_ascii_whitespace().collect::<HashSet<_>>();
    let email_granted = scopes.contains("email") || scopes.contains(USERINFO_EMAIL_SCOPE);
    let allowed = HashSet::from(["openid", "email", USERINFO_EMAIL_SCOPE, DRIVE_SCOPE]);
    if !scopes.contains("openid")
        || !email_granted
        || !scopes.contains(DRIVE_SCOPE)
        || scopes.iter().any(|scope| !allowed.contains(scope))
    {
        return Err(GoogleDriveNativeError::new(
            GoogleDriveNativeErrorCode::ScopeMismatch,
            "Google did not return the required authorization scopes",
        ));
    }
    Ok(())
}

fn validated_token_response(
    parsed: OAuthTokenResponse,
    require_refresh_token: bool,
    require_scopes: bool,
) -> Result<ValidatedTokenResponse, GoogleDriveNativeError> {
    if parsed.token_type.as_deref() != Some("Bearer") {
        return Err(GoogleDriveNativeError::token_response_invalid());
    }
    if require_scopes {
        validate_granted_scopes(parsed.scope)?;
    }
    let expires_in = parsed
        .expires_in
        .ok_or_else(GoogleDriveNativeError::token_response_invalid)?;
    if expires_in == 0 || expires_in > 86_400 {
        return Err(GoogleDriveNativeError::token_response_invalid());
    }
    let access_token = validate_token(parsed.access_token)
        .map_err(|_| GoogleDriveNativeError::token_response_invalid())?;
    let refresh_token = match parsed.refresh_token {
        Some(value) => Some(
            validate_token(Some(value))
                .map_err(|_| GoogleDriveNativeError::token_response_invalid())?,
        ),
        None if require_refresh_token => {
            return Err(GoogleDriveNativeError::token_response_invalid());
        }
        None => None,
    };
    Ok(ValidatedTokenResponse {
        access_token,
        refresh_token,
        expires_in,
    })
}

fn parsed_token_response(
    body: &[u8],
    require_refresh_token: bool,
    require_scopes: bool,
) -> Result<ValidatedTokenResponse, GoogleDriveNativeError> {
    let parsed: OAuthTokenResponse = serde_json::from_slice(body)
        .map_err(|_| GoogleDriveNativeError::token_response_invalid())?;
    validated_token_response(parsed, require_refresh_token, require_scopes)
}

fn parsed_oauth_broker_token_response(
    body: &[u8],
    require_refresh_token: bool,
    require_scopes: bool,
) -> Result<ValidatedTokenResponse, GoogleDriveNativeError> {
    let parsed = serde_json::from_slice::<OAuthBrokerTokenResponse>(body)
        .map_err(|_| GoogleDriveNativeError::oauth_broker_protocol_invalid())?;
    validated_token_response(
        OAuthTokenResponse {
            access_token: parsed.access_token,
            refresh_token: parsed.refresh_token,
            expires_in: parsed.expires_in,
            token_type: parsed.token_type,
            scope: parsed.scope,
        },
        require_refresh_token,
        require_scopes,
    )
    .map_err(|_| GoogleDriveNativeError::oauth_broker_protocol_invalid())
}

fn classified_token_exchange_error(
    status: StatusCode,
    body: &[u8],
) -> Option<GoogleDriveNativeError> {
    if status.is_success() {
        return None;
    }
    let response = serde_json::from_slice::<OAuthErrorResponse>(body).ok();
    let error = match response
        .as_ref()
        .and_then(|response| response.error.as_deref())
    {
        Some("invalid_client") | Some("unauthorized_client") => {
            GoogleDriveNativeError::oauth_client_invalid()
        }
        Some("invalid_grant") => GoogleDriveNativeError::authorization_grant_invalid(),
        Some("redirect_uri_mismatch") => GoogleDriveNativeError::redirect_uri_mismatch(),
        Some("invalid_request") => GoogleDriveNativeError::token_request_invalid(),
        _ => GoogleDriveNativeError::token_exchange_failed(),
    };
    Some(error)
}

async fn validate_token_exchange_response(
    response: &mut reqwest::Response,
) -> Result<(), GoogleDriveNativeError> {
    let status = response.status();
    if status.is_success() {
        return Ok(());
    }
    let body = bounded_response_body(response, MAX_OAUTH_RESPONSE_BYTES).await?;
    Err(classified_token_exchange_error(status, &body)
        .unwrap_or_else(GoogleDriveNativeError::token_exchange_failed))
}

fn has_json_content_type(headers: &HeaderMap) -> bool {
    headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("application/json"))
}

fn oauth_broker_non_contract_error(
    status: StatusCode,
    retry_after_ms: Option<u64>,
) -> GoogleDriveNativeError {
    if status == StatusCode::TOO_MANY_REQUESTS {
        return GoogleDriveNativeError::oauth_broker_rate_limited(retry_after_ms);
    }
    if status.is_server_error() {
        return GoogleDriveNativeError::oauth_broker_unavailable();
    }
    GoogleDriveNativeError::oauth_broker_protocol_invalid()
}

async fn bounded_oauth_broker_response_body(
    response: &mut reqwest::Response,
    status: StatusCode,
    retry_after_ms: Option<u64>,
) -> Result<Vec<u8>, GoogleDriveNativeError> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_OAUTH_BROKER_RESPONSE_BYTES as u64)
    {
        return Err(oauth_broker_non_contract_error(status, retry_after_ms));
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| GoogleDriveNativeError::oauth_broker_unavailable())?
    {
        if body.len().saturating_add(chunk.len()) > MAX_OAUTH_BROKER_RESPONSE_BYTES {
            return Err(oauth_broker_non_contract_error(status, retry_after_ms));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn oauth_broker_retry_after_ms(headers: &HeaderMap) -> Option<u64> {
    let value = headers.get(RETRY_AFTER)?.to_str().ok()?;
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let seconds = value.parse::<u64>().ok()?;
    if seconds == 0 || seconds > MAX_OAUTH_BROKER_RETRY_AFTER_SECONDS {
        return None;
    }
    seconds.checked_mul(1_000)
}

fn classified_oauth_broker_error(
    status: StatusCode,
    body: &[u8],
    retry_after_ms: Option<u64>,
) -> Option<GoogleDriveNativeError> {
    if status.is_success() {
        return None;
    }
    let response = match serde_json::from_slice::<OAuthBrokerErrorResponse>(body) {
        Ok(response) => response,
        Err(_) => return Some(oauth_broker_non_contract_error(status, retry_after_ms)),
    };
    let error = match (response.error.as_str(), status.as_u16()) {
        ("invalid_client" | "unauthorized_client", 400..=499) => {
            GoogleDriveNativeError::oauth_client_invalid()
        }
        ("invalid_grant", 400..=499) => GoogleDriveNativeError::authorization_grant_invalid(),
        ("redirect_uri_mismatch", 400..=499) => GoogleDriveNativeError::redirect_uri_mismatch(),
        ("invalid_request", 400..=499) => GoogleDriveNativeError::token_request_invalid(),
        ("server_error" | "temporarily_unavailable", 503) => {
            GoogleDriveNativeError::oauth_broker_unavailable()
        }
        ("rate_limited", 429) => GoogleDriveNativeError::oauth_broker_rate_limited(retry_after_ms),
        ("provider_unavailable", 503) => GoogleDriveNativeError::oauth_broker_unavailable(),
        ("internal_error", 500) => GoogleDriveNativeError::oauth_broker_unavailable(),
        ("server_misconfigured", 503) => GoogleDriveNativeError::oauth_broker_misconfigured(),
        ("origin_mismatch", 421)
        | ("method_not_allowed", 405)
        | ("not_found", 404)
        | ("unsupported_media_type", 415) => GoogleDriveNativeError::oauth_broker_misconfigured(),
        ("broker_invalid_request", 400)
        | ("browser_request_forbidden", 403)
        | ("payload_too_large", 413) => GoogleDriveNativeError::oauth_broker_protocol_invalid(),
        ("provider_response_invalid", 502) => GoogleDriveNativeError::oauth_broker_unavailable(),
        _ => oauth_broker_non_contract_error(status, retry_after_ms),
    };
    Some(error)
}

async fn validated_oauth_broker_response(
    response: &mut reqwest::Response,
    require_refresh_token: bool,
    require_scopes: bool,
) -> Result<ValidatedTokenResponse, GoogleDriveNativeError> {
    let status = response.status();
    let retry_after_ms = oauth_broker_retry_after_ms(response.headers());
    if !has_json_content_type(response.headers()) {
        return Err(oauth_broker_non_contract_error(status, retry_after_ms));
    }
    let body = bounded_oauth_broker_response_body(response, status, retry_after_ms).await?;
    if let Some(error) = classified_oauth_broker_error(status, &body, retry_after_ms) {
        return Err(error);
    }
    parsed_oauth_broker_token_response(&body, require_refresh_token, require_scopes)
}

fn valid_oauth_broker_request_text(value: &str, minimum: usize, maximum: usize) -> bool {
    (minimum..=maximum).contains(&value.len())
        && value.trim() == value
        && !value.chars().any(char::is_whitespace)
        && !value.chars().any(char::is_control)
}

fn valid_oauth_broker_redirect_uri(value: &str) -> bool {
    if value.len() > 128 {
        return false;
    }
    let Ok(parsed) = Url::parse(value) else {
        return false;
    };
    let Some(port) = parsed.port() else {
        return false;
    };
    (1024..=65_535).contains(&port)
        && parsed.scheme() == "http"
        && parsed.host_str() == Some("127.0.0.1")
        && parsed.username().is_empty()
        && parsed.password().is_none()
        && parsed.path() == "/"
        && parsed.query().is_none()
        && parsed.fragment().is_none()
        && (value == format!("http://127.0.0.1:{port}")
            || value == format!("http://127.0.0.1:{port}/"))
}

fn oauth_broker_exchange_body(
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> Result<Vec<u8>, GoogleDriveNativeError> {
    let valid_verifier = (43..=128).contains(&verifier.len())
        && verifier
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'~' | b'-'));
    if !valid_oauth_broker_request_text(code, 8, MAX_AUTHORIZATION_CODE_LENGTH)
        || !valid_verifier
        || !valid_oauth_broker_redirect_uri(redirect_uri)
    {
        return Err(GoogleDriveNativeError::token_request_invalid());
    }
    serde_json::to_vec(&OAuthBrokerExchangeRequest {
        code,
        code_verifier: verifier,
        protocol_version: OAUTH_BROKER_PROTOCOL_VERSION,
        redirect_uri,
    })
    .map_err(|_| GoogleDriveNativeError::oauth_broker_protocol_invalid())
}

fn oauth_broker_refresh_body(refresh_token: &str) -> Result<Vec<u8>, GoogleDriveNativeError> {
    if !valid_oauth_broker_request_text(refresh_token, 8, MAX_OAUTH_BROKER_REQUEST_TOKEN_LENGTH) {
        return Err(GoogleDriveNativeError::authorization_grant_invalid());
    }
    serde_json::to_vec(&OAuthBrokerRefreshRequest {
        protocol_version: OAUTH_BROKER_PROTOCOL_VERSION,
        refresh_token,
    })
    .map_err(|_| GoogleDriveNativeError::oauth_broker_protocol_invalid())
}

fn oauth_broker_request(
    client: &Client,
    url: &Url,
    body: Vec<u8>,
) -> Result<reqwest::Request, GoogleDriveNativeError> {
    client
        .post(url.clone())
        .header(ACCEPT, "application/json")
        .header(CONTENT_TYPE, "application/json")
        .body(body)
        .build()
        .map_err(|_| GoogleDriveNativeError::oauth_broker_protocol_invalid())
}

fn validate_userinfo_status(status: StatusCode) -> Result<(), GoogleDriveNativeError> {
    if status.is_success() {
        Ok(())
    } else {
        Err(GoogleDriveNativeError::userinfo_failed())
    }
}

fn authorization_code_token_form<'a>(
    client_id: &'a str,
    code: &'a str,
    verifier: &'a str,
    redirect_uri: &'a str,
    client_secret: &'a GoogleDriveDesktopClientSecret,
) -> Vec<(&'static str, &'a str)> {
    vec![
        ("client_id", client_id),
        ("client_secret", client_secret.expose()),
        ("code", code),
        ("code_verifier", verifier),
        ("grant_type", "authorization_code"),
        ("redirect_uri", redirect_uri),
    ]
}

fn refresh_token_form<'a>(
    client_id: &'a str,
    refresh_token: &'a str,
    client_secret: &'a GoogleDriveDesktopClientSecret,
) -> Vec<(&'static str, &'a str)> {
    vec![
        ("client_id", client_id),
        ("client_secret", client_secret.expose()),
        ("refresh_token", refresh_token),
        ("grant_type", "refresh_token"),
    ]
}

fn authorization_code_token_request(
    client: &Client,
    client_id: &str,
    code: &str,
    verifier: &str,
    redirect_uri: &str,
    client_secret: &GoogleDriveDesktopClientSecret,
) -> Result<reqwest::Request, GoogleDriveNativeError> {
    client
        .post(GOOGLE_TOKEN_URL)
        .form(&authorization_code_token_form(
            client_id,
            code,
            verifier,
            redirect_uri,
            client_secret,
        ))
        .build()
        .map_err(|_| GoogleDriveNativeError::token_request_invalid())
}

fn refresh_token_request(
    client: &Client,
    client_id: &str,
    refresh_token: &str,
    client_secret: &GoogleDriveDesktopClientSecret,
) -> Result<reqwest::Request, GoogleDriveNativeError> {
    client
        .post(GOOGLE_TOKEN_URL)
        .form(&refresh_token_form(client_id, refresh_token, client_secret))
        .build()
        .map_err(|_| GoogleDriveNativeError::token_request_invalid())
}

async fn exchange_authorization_code_direct(
    client: &Client,
    client_id: &str,
    code: &str,
    verifier: &str,
    redirect_uri: &str,
    client_secret: &GoogleDriveDesktopClientSecret,
) -> Result<ValidatedTokenResponse, GoogleDriveNativeError> {
    let request = authorization_code_token_request(
        client,
        client_id,
        code,
        verifier,
        redirect_uri,
        client_secret,
    )?;
    let mut response = client
        .execute(request)
        .await
        .map_err(|_| GoogleDriveNativeError::network_failed())?;
    validate_token_exchange_response(&mut response).await?;
    let body = bounded_response_body(&mut response, MAX_OAUTH_RESPONSE_BYTES).await?;
    parsed_token_response(&body, true, true)
}

async fn refresh_access_token_direct(
    client: &Client,
    client_id: &str,
    refresh_token: &str,
    client_secret: &GoogleDriveDesktopClientSecret,
) -> Result<ValidatedTokenResponse, GoogleDriveNativeError> {
    let request = refresh_token_request(client, client_id, refresh_token, client_secret)?;
    let mut response = client
        .execute(request)
        .await
        .map_err(|_| GoogleDriveNativeError::network_failed())?;
    validate_token_exchange_response(&mut response).await?;
    let body = bounded_response_body(&mut response, MAX_OAUTH_RESPONSE_BYTES).await?;
    parsed_token_response(&body, false, false)
}

async fn exchange_authorization_code(
    client: &Client,
    backend: &OAuthTokenBackend<'_>,
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> Result<ValidatedTokenResponse, GoogleDriveNativeError> {
    match backend {
        OAuthTokenBackend::Broker { exchange_url, .. } => {
            let body = oauth_broker_exchange_body(code, verifier, redirect_uri)?;
            let request = oauth_broker_request(client, exchange_url, body)?;
            let mut response = client
                .execute(request)
                .await
                .map_err(|_| GoogleDriveNativeError::oauth_broker_unavailable())?;
            validated_oauth_broker_response(&mut response, true, true).await
        }
        OAuthTokenBackend::SelfHostedDesktop {
            client_id,
            client_secret,
        } => {
            exchange_authorization_code_direct(
                client,
                client_id,
                code,
                verifier,
                redirect_uri,
                client_secret,
            )
            .await
        }
    }
}

async fn refresh_access_token(
    client: &Client,
    backend: &OAuthTokenBackend<'_>,
    refresh_token: &str,
) -> Result<ValidatedTokenResponse, GoogleDriveNativeError> {
    match backend {
        OAuthTokenBackend::Broker { refresh_url, .. } => {
            let body = oauth_broker_refresh_body(refresh_token)?;
            let request = oauth_broker_request(client, refresh_url, body)?;
            let mut response = client
                .execute(request)
                .await
                .map_err(|_| GoogleDriveNativeError::oauth_broker_unavailable())?;
            validated_oauth_broker_response(&mut response, false, false).await
        }
        OAuthTokenBackend::SelfHostedDesktop {
            client_id,
            client_secret,
        } => refresh_access_token_direct(client, client_id, refresh_token, client_secret).await,
    }
}

fn parsed_userinfo_response(
    body: &[u8],
    expected_subject: Option<&str>,
) -> Result<VerifiedUser, GoogleDriveNativeError> {
    let parsed: UserInfoResponse =
        serde_json::from_slice(body).map_err(|_| GoogleDriveNativeError::userinfo_failed())?;
    let subject = parsed
        .sub
        .ok_or_else(GoogleDriveNativeError::userinfo_failed)?;
    if subject.is_empty() || subject.len() > 256 || subject.chars().any(char::is_control) {
        return Err(GoogleDriveNativeError::userinfo_failed());
    }
    if expected_subject.is_some_and(|expected| expected != subject) {
        return Err(GoogleDriveNativeError::new(
            GoogleDriveNativeErrorCode::SubjectMismatch,
            "Google authorization belongs to a different account",
        ));
    }
    let email = match (parsed.email, parsed.email_verified) {
        (Some(email), Some(true))
            if !email.is_empty() && email.len() <= 320 && !email.chars().any(char::is_control) =>
        {
            Some(email)
        }
        _ => None,
    };
    Ok(VerifiedUser { subject, email })
}

async fn verified_user(
    client: &Client,
    access_token: &str,
    expected_subject: Option<&str>,
) -> Result<VerifiedUser, GoogleDriveNativeError> {
    let mut response = client
        .get(GOOGLE_USERINFO_URL)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|_| GoogleDriveNativeError::network_failed())?;
    validate_userinfo_status(response.status())?;
    let body = bounded_response_body(&mut response, MAX_OAUTH_RESPONSE_BYTES).await?;
    parsed_userinfo_response(&body, expected_subject)
}

async fn revoke_token(client: &Client, token: &str) -> Result<(), GoogleDriveNativeError> {
    let response = client
        .post(GOOGLE_REVOKE_URL)
        .form(&[("token", token)])
        .send()
        .await
        .map_err(|_| GoogleDriveNativeError::network_failed())?;
    if !response.status().is_success() {
        return Err(GoogleDriveNativeError::oauth_failed());
    }
    Ok(())
}

async fn authorize_inner(
    request: &GoogleDriveAuthorizeRequest,
    cancelled: Arc<AtomicBool>,
) -> Result<GoogleDriveAuthorizeResponse, GoogleDriveNativeError> {
    // Resolve and validate the explicitly selected authority before opening the browser. A token
    // request is sent to exactly one backend and is never retried against another backend.
    let token_backend = oauth_token_backend(&request.oauth_client)?;
    let client_id = token_backend.client_id();
    let timeout = oauth_timeout(request.timeout_ms)?;
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|_| {
        GoogleDriveNativeError::new(
            GoogleDriveNativeErrorCode::Unsupported,
            "A local authorization callback could not be started",
        )
    })?;
    let port = listener
        .local_addr()
        .map_err(|_| GoogleDriveNativeError::oauth_failed())?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}");
    let state = random_urlsafe(32);
    let (verifier, challenge) = pkce_pair();
    let url = authorization_url(client_id, &redirect_uri, &state, &challenge)?;
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|_| {
        GoogleDriveNativeError::new(
            GoogleDriveNativeErrorCode::BrowserOpenFailed,
            "The system browser could not be opened",
        )
    })?;
    let callback_cancelled = Arc::clone(&cancelled);
    let code = tauri::async_runtime::spawn_blocking(move || {
        wait_for_callback(listener, state, callback_cancelled, timeout)
    })
    .await
    .map_err(|_| GoogleDriveNativeError::oauth_failed())??;
    if cancelled.load(Ordering::SeqCst) {
        return Err(GoogleDriveNativeError::new(
            GoogleDriveNativeErrorCode::Cancelled,
            "Google authorization was cancelled",
        ));
    }
    let client = http_client(timeout)?;
    let token =
        exchange_authorization_code(&client, &token_backend, &code, &verifier, &redirect_uri)
            .await?;
    let refresh_token = token
        .refresh_token
        .ok_or_else(GoogleDriveNativeError::oauth_failed)?;
    if cancelled.load(Ordering::SeqCst) {
        let _ = revoke_token(&client, &refresh_token).await;
        return Err(GoogleDriveNativeError::new(
            GoogleDriveNativeErrorCode::Cancelled,
            "Google authorization was cancelled",
        ));
    }
    let user = match verified_user(&client, &token.access_token, None).await {
        Ok(user) => user,
        Err(error) => {
            let _ = revoke_token(&client, &refresh_token).await;
            return Err(error);
        }
    };
    if cancelled.load(Ordering::SeqCst) {
        let _ = revoke_token(&client, &refresh_token).await;
        return Err(GoogleDriveNativeError::new(
            GoogleDriveNativeErrorCode::Cancelled,
            "Google authorization was cancelled",
        ));
    }
    Ok(GoogleDriveAuthorizeResponse {
        access_token: token.access_token,
        refresh_token,
        expires_in: token.expires_in,
        granted_scopes: CANONICAL_SCOPES.to_vec(),
        subject: user.subject,
        email: user.email,
    })
}

#[tauri::command]
pub async fn google_drive_oauth_authorize(
    request: GoogleDriveAuthorizeRequest,
    operations: tauri::State<'_, GoogleDriveOAuthOperations>,
) -> Result<GoogleDriveAuthorizeResponse, GoogleDriveNativeError> {
    let cancelled = operations.begin(&request.operation_id)?;
    let result = authorize_inner(&request, cancelled).await;
    operations.finish(&request.operation_id);
    result
}

#[tauri::command]
pub async fn google_drive_oauth_refresh(
    request: GoogleDriveRefreshRequest,
    operations: tauri::State<'_, GoogleDriveOAuthOperations>,
) -> Result<GoogleDriveRefreshResponse, GoogleDriveNativeError> {
    validate_token(Some(request.refresh_token.clone()))?;
    if request.expected_subject.is_empty()
        || request.expected_subject.len() > 256
        || request.expected_subject.chars().any(char::is_control)
    {
        return Err(GoogleDriveNativeError::invalid_request());
    }
    let token_backend = oauth_token_backend(&request.oauth_client)?;
    let timeout = oauth_timeout(request.timeout_ms)?;
    let cancelled = operations.begin(&request.operation_id)?;
    let result = async {
        let client = http_client(timeout)?;
        let token = refresh_access_token(&client, &token_backend, &request.refresh_token).await?;
        if cancelled.load(Ordering::SeqCst) {
            return Err(GoogleDriveNativeError::new(
                GoogleDriveNativeErrorCode::Cancelled,
                "Google token refresh was cancelled",
            ));
        }
        let user = verified_user(
            &client,
            &token.access_token,
            Some(&request.expected_subject),
        )
        .await?;
        if cancelled.load(Ordering::SeqCst) {
            return Err(GoogleDriveNativeError::new(
                GoogleDriveNativeErrorCode::Cancelled,
                "Google token refresh was cancelled",
            ));
        }
        Ok(GoogleDriveRefreshResponse {
            access_token: token.access_token,
            expires_in: token.expires_in,
            subject: user.subject,
            email: user.email,
        })
    }
    .await;
    operations.finish(&request.operation_id);
    result
}

#[tauri::command]
pub fn google_drive_oauth_cancel(
    operation_id: String,
    operations: tauri::State<'_, GoogleDriveOAuthOperations>,
) -> Result<bool, GoogleDriveNativeError> {
    operations.cancel(&operation_id)
}

#[tauri::command]
pub async fn google_drive_oauth_revoke(
    request: GoogleDriveRevokeRequest,
) -> Result<(), GoogleDriveNativeError> {
    let token = validate_token(Some(request.token))?;
    let client = http_client(oauth_timeout(request.timeout_ms)?)?;
    revoke_token(&client, &token).await
}

fn query_value<'a>(url: &'a Url, name: &str) -> Option<std::borrow::Cow<'a, str>> {
    url.query_pairs()
        .find_map(|(key, value)| (key == name).then_some(value))
}

fn validate_drive_url(
    kind: GoogleDriveTransferKind,
    raw_url: &str,
) -> Result<Url, GoogleDriveNativeError> {
    if raw_url.is_empty() || raw_url.len() > MAX_URL_LENGTH {
        return Err(GoogleDriveNativeError::invalid_request());
    }
    let url = Url::parse(raw_url).map_err(|_| GoogleDriveNativeError::invalid_request())?;
    if url.scheme() != "https"
        || url.host_str() != Some(DRIVE_API_ORIGIN)
        || url.port().is_some_and(|port| port != 443)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(GoogleDriveNativeError::invalid_request());
    }
    let query = url.query_pairs().collect::<Vec<_>>();
    let mut query_keys = HashSet::new();
    if query.len() > 32
        || query.iter().any(|(key, value)| {
            key.len() > 128
                || value.len() > 4096
                || key.chars().any(char::is_control)
                || value.chars().any(char::is_control)
                || !query_keys.insert(key.as_ref())
        })
        || query
            .iter()
            .any(|(key, _)| matches!(key.as_ref(), "access_token" | "key"))
    {
        return Err(GoogleDriveNativeError::invalid_request());
    }
    let drive_path = url.path().starts_with("/drive/v3/");
    let upload_path =
        url.path() == "/upload/drive/v3/files" || url.path().starts_with("/upload/drive/v3/files/");
    let valid = match kind {
        GoogleDriveTransferKind::Api => {
            drive_path && query_value(&url, "alt").as_deref() != Some("media")
        }
        GoogleDriveTransferKind::ResumableInit => {
            upload_path && query_value(&url, "uploadType").as_deref() == Some("resumable")
        }
        GoogleDriveTransferKind::UploadChunk => {
            upload_path && query_value(&url, "upload_id").is_some_and(|value| !value.is_empty())
        }
        GoogleDriveTransferKind::DownloadChunk => {
            url.path().starts_with("/drive/v3/files/")
                && query_value(&url, "alt").as_deref() == Some("media")
        }
    };
    valid
        .then_some(url)
        .ok_or_else(GoogleDriveNativeError::invalid_request)
}

fn allowed_header(kind: GoogleDriveTransferKind, name: &str) -> bool {
    match kind {
        GoogleDriveTransferKind::Api => {
            matches!(
                name,
                "authorization" | "accept" | "content-type" | "if-none-match"
            )
        }
        GoogleDriveTransferKind::ResumableInit => matches!(
            name,
            "authorization"
                | "accept"
                | "content-type"
                | "if-match"
                | "x-upload-content-type"
                | "x-upload-content-length"
        ),
        GoogleDriveTransferKind::UploadChunk => {
            matches!(
                name,
                "authorization" | "accept" | "content-type" | "content-length" | "content-range"
            )
        }
        GoogleDriveTransferKind::DownloadChunk => {
            matches!(name, "authorization" | "accept" | "range" | "if-match")
        }
    }
}

fn valid_strong_etag(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 2
        && bytes.len() <= 1024
        && bytes.first() == Some(&b'"')
        && bytes.last() == Some(&b'"')
        && bytes[1..bytes.len() - 1]
            .iter()
            .all(|byte| *byte == 0x21 || (0x23..=0x7e).contains(byte) || *byte >= 0x80)
}

fn validated_headers(
    kind: GoogleDriveTransferKind,
    values: &[GoogleDriveTransferHeader],
) -> Result<HeaderMap, GoogleDriveNativeError> {
    if values.is_empty() || values.len() > MAX_HEADER_COUNT {
        return Err(GoogleDriveNativeError::invalid_request());
    }
    let mut headers = HeaderMap::new();
    let mut total_bytes = 0_usize;
    for value in values {
        let name_text = value.name.to_ascii_lowercase();
        let max_value_length = if name_text == "authorization" {
            MAX_TOKEN_LENGTH + "Bearer ".len()
        } else {
            MAX_TOKEN_LENGTH
        };
        if !allowed_header(kind, &name_text)
            || value.value.is_empty()
            || value.value.len() > max_value_length
            || value.value.chars().any(char::is_control)
        {
            return Err(GoogleDriveNativeError::invalid_request());
        }
        total_bytes = total_bytes
            .saturating_add(name_text.len())
            .saturating_add(value.value.len());
        if total_bytes > MAX_HEADER_BYTES {
            return Err(GoogleDriveNativeError::invalid_request());
        }
        let name = HeaderName::from_bytes(name_text.as_bytes())
            .map_err(|_| GoogleDriveNativeError::invalid_request())?;
        if headers.contains_key(&name) {
            return Err(GoogleDriveNativeError::invalid_request());
        }
        let header_value = HeaderValue::from_str(&value.value)
            .map_err(|_| GoogleDriveNativeError::invalid_request())?;
        headers.insert(name, header_value);
    }
    let authorization = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(GoogleDriveNativeError::invalid_request)?;
    let Some(bearer_token) = authorization.strip_prefix("Bearer ") else {
        return Err(GoogleDriveNativeError::invalid_request());
    };
    if !valid_token_text(bearer_token) {
        return Err(GoogleDriveNativeError::invalid_request());
    }
    if kind == GoogleDriveTransferKind::UploadChunk && !headers.contains_key("content-range") {
        return Err(GoogleDriveNativeError::invalid_request());
    }
    if kind == GoogleDriveTransferKind::DownloadChunk && !headers.contains_key("range") {
        return Err(GoogleDriveNativeError::invalid_request());
    }
    if kind == GoogleDriveTransferKind::DownloadChunk {
        let range = headers
            .get("range")
            .and_then(|value| value.to_str().ok())
            .ok_or_else(GoogleDriveNativeError::invalid_request)?;
        let Some((start, end)) = range
            .strip_prefix("bytes=")
            .and_then(|value| value.split_once('-'))
        else {
            return Err(GoogleDriveNativeError::invalid_request());
        };
        let start = start
            .parse::<u64>()
            .map_err(|_| GoogleDriveNativeError::invalid_request())?;
        let end = end
            .parse::<u64>()
            .map_err(|_| GoogleDriveNativeError::invalid_request())?;
        let Some(length) = end
            .checked_sub(start)
            .and_then(|value| value.checked_add(1))
        else {
            return Err(GoogleDriveNativeError::invalid_request());
        };
        if length > MAX_TRANSFER_CHUNK_BYTES as u64 {
            return Err(GoogleDriveNativeError::invalid_request());
        }
        let if_match = headers
            .get("if-match")
            .and_then(|value| value.to_str().ok());
        if (start == 0 && if_match.is_some())
            || (start > 0 && !if_match.is_some_and(valid_strong_etag))
        {
            return Err(GoogleDriveNativeError::invalid_request());
        }
    }
    Ok(headers)
}

fn transfer_method(
    kind: GoogleDriveTransferKind,
    value: &str,
) -> Result<Method, GoogleDriveNativeError> {
    let allowed = match kind {
        GoogleDriveTransferKind::Api => matches!(value, "GET" | "POST" | "PATCH" | "DELETE"),
        GoogleDriveTransferKind::ResumableInit => matches!(value, "POST" | "PATCH"),
        GoogleDriveTransferKind::UploadChunk => value == "PUT",
        GoogleDriveTransferKind::DownloadChunk => value == "GET",
    };
    if !allowed {
        return Err(GoogleDriveNativeError::invalid_request());
    }
    Method::from_bytes(value.as_bytes()).map_err(|_| GoogleDriveNativeError::invalid_request())
}

fn validate_transfer_limits(
    request: &GoogleDriveTransferRequest,
) -> Result<(), GoogleDriveNativeError> {
    let body_length = request.body.as_ref().map_or(0, Vec::len);
    let max_body = match request.kind {
        GoogleDriveTransferKind::Api | GoogleDriveTransferKind::ResumableInit => {
            MAX_METADATA_BODY_BYTES
        }
        GoogleDriveTransferKind::UploadChunk => MAX_TRANSFER_CHUNK_BYTES,
        GoogleDriveTransferKind::DownloadChunk => 0,
    };
    if body_length > max_body
        || (matches!(request.method.as_str(), "GET" | "DELETE") && body_length > 0)
    {
        return Err(GoogleDriveNativeError::invalid_request());
    }
    let max_response = match request.kind {
        GoogleDriveTransferKind::DownloadChunk => MAX_TRANSFER_CHUNK_BYTES,
        _ => 2 * MAX_METADATA_BODY_BYTES,
    };
    if request.max_response_bytes == 0 || request.max_response_bytes > max_response {
        return Err(GoogleDriveNativeError::invalid_request());
    }
    Ok(())
}

fn response_headers(
    kind: GoogleDriveTransferKind,
    headers: &HeaderMap,
) -> Result<Vec<GoogleDriveTransferHeader>, GoogleDriveNativeError> {
    const ALLOWED: [&str; 11] = [
        "content-type",
        "content-length",
        "content-range",
        "content-disposition",
        "last-modified",
        "range",
        "location",
        "retry-after",
        "etag",
        "x-goog-generation",
        "x-goog-hash",
    ];
    let mut result = Vec::new();
    for name in ALLOWED {
        let Some(value) = headers.get(name) else {
            continue;
        };
        let value = value
            .to_str()
            .map_err(|_| GoogleDriveNativeError::oauth_failed())?;
        if value.len() > MAX_URL_LENGTH || value.chars().any(char::is_control) {
            return Err(GoogleDriveNativeError::oauth_failed());
        }
        if name == "location"
            && (kind != GoogleDriveTransferKind::ResumableInit
                || validate_drive_url(GoogleDriveTransferKind::UploadChunk, value).is_err())
        {
            return Err(GoogleDriveNativeError::oauth_failed());
        }
        result.push(GoogleDriveTransferHeader {
            name: name.to_owned(),
            value: value.to_owned(),
        });
    }
    Ok(result)
}

#[tauri::command]
pub async fn google_drive_transfer(
    request: GoogleDriveTransferRequest,
) -> Result<GoogleDriveTransferResponse, GoogleDriveNativeError> {
    validate_transfer_limits(&request)?;
    let url = validate_drive_url(request.kind, &request.url)?;
    let method = transfer_method(request.kind, &request.method)?;
    let headers = validated_headers(request.kind, &request.headers)?;
    if let Some(value) = headers.get("content-length") {
        let declared = value
            .to_str()
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .ok_or_else(GoogleDriveNativeError::invalid_request)?;
        if declared != request.body.as_ref().map_or(0, Vec::len) {
            return Err(GoogleDriveNativeError::invalid_request());
        }
    }
    let client = http_client(transfer_timeout(request.timeout_ms)?)?;
    let mut builder = client.request(method, url).headers(headers);
    if let Some(body) = request.body {
        builder = builder.body(body);
    }
    let mut response = builder
        .send()
        .await
        .map_err(|_| GoogleDriveNativeError::network_failed())?;
    let status = response.status().as_u16();
    let headers = response_headers(request.kind, response.headers())?;
    let body = bounded_response_body(&mut response, request.max_response_bytes).await?;
    Ok(GoogleDriveTransferResponse {
        status,
        headers,
        body,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn result_error_code<T>(
        result: Result<T, GoogleDriveNativeError>,
    ) -> GoogleDriveNativeErrorCode {
        match result {
            Ok(_) => panic!("expected Google Drive native error"),
            Err(error) => error.code,
        }
    }

    #[test]
    fn oauth_diagnostic_errors_serialize_exactly() {
        let errors = [
            (
                GoogleDriveNativeError::oauth_client_invalid(),
                r#"{"code":"oauth-client-invalid","message":"Google OAuth client is invalid"}"#,
            ),
            (
                GoogleDriveNativeError::authorization_grant_invalid(),
                r#"{"code":"authorization-grant-invalid","message":"Google authorization grant is invalid"}"#,
            ),
            (
                GoogleDriveNativeError::redirect_uri_mismatch(),
                r#"{"code":"redirect-uri-mismatch","message":"Google redirect URI did not match"}"#,
            ),
            (
                GoogleDriveNativeError::token_request_invalid(),
                r#"{"code":"token-request-invalid","message":"Google token request is invalid"}"#,
            ),
            (
                GoogleDriveNativeError::token_exchange_failed(),
                r#"{"code":"token-exchange-failed","message":"Google token exchange failed"}"#,
            ),
            (
                GoogleDriveNativeError::token_response_invalid(),
                r#"{"code":"token-response-invalid","message":"Google returned an invalid token response"}"#,
            ),
            (
                GoogleDriveNativeError::oauth_broker_rate_limited(Some(60_000)),
                r#"{"code":"oauth-broker-rate-limited","message":"OpenPencil OAuth Broker rate limit was reached","retryAfterMs":60000}"#,
            ),
            (
                GoogleDriveNativeError::oauth_broker_unavailable(),
                r#"{"code":"oauth-broker-unavailable","message":"OpenPencil OAuth Broker is temporarily unavailable"}"#,
            ),
            (
                GoogleDriveNativeError::oauth_broker_misconfigured(),
                r#"{"code":"oauth-broker-misconfigured","message":"OpenPencil OAuth Broker is not configured for this build"}"#,
            ),
            (
                GoogleDriveNativeError::oauth_broker_protocol_invalid(),
                r#"{"code":"oauth-broker-protocol-invalid","message":"OpenPencil OAuth Broker returned an invalid response"}"#,
            ),
            (
                GoogleDriveNativeError::userinfo_failed(),
                r#"{"code":"userinfo-failed","message":"Google user information could not be verified"}"#,
            ),
            (
                GoogleDriveNativeError::network_failed(),
                r#"{"code":"network-failed","message":"Google Drive network request failed"}"#,
            ),
            (
                GoogleDriveNativeError::response_too_large(),
                r#"{"code":"response-too-large","message":"Google Drive response exceeded the byte limit"}"#,
            ),
        ];
        for (error, expected) in errors {
            assert_eq!(serde_json::to_string(&error).unwrap(), expected);
        }
    }

    #[test]
    fn oauth_client_modes_are_explicit_and_never_fall_back() {
        let client_id = "1234567890-test.apps.googleusercontent.com";
        let publisher = GoogleDriveOAuthClient::PublisherBroker {};
        let backend = oauth_token_backend_from_config(
            &publisher,
            Some("https://oauth-broker.example.com"),
            Some(client_id),
        )
        .unwrap();
        match backend {
            OAuthTokenBackend::Broker {
                client_id: resolved_client_id,
                exchange_url,
                refresh_url,
            } => {
                assert_eq!(resolved_client_id, client_id);
                assert_eq!(
                    exchange_url.as_str(),
                    "https://oauth-broker.example.com/v1/google-drive/oauth/exchange"
                );
                assert_eq!(
                    refresh_url.as_str(),
                    "https://oauth-broker.example.com/v1/google-drive/oauth/refresh"
                );
            }
            OAuthTokenBackend::SelfHostedDesktop { .. } => {
                panic!("publisher mode must not select Google directly")
            }
        }

        assert_eq!(
            result_error_code(oauth_token_backend_from_config(&publisher, None, None)),
            GoogleDriveNativeErrorCode::OauthBrokerMisconfigured
        );
        assert_eq!(
            result_error_code(oauth_token_backend_from_config(
                &publisher,
                Some("https://oauth-broker.example.com"),
                Some("attacker.example"),
            )),
            GoogleDriveNativeErrorCode::OauthBrokerMisconfigured,
        );

        let secret = GoogleDriveDesktopClientSecret("test-local-secret".to_owned());
        let self_hosted = GoogleDriveOAuthClient::SelfHostedDesktop {
            client_id: client_id.to_owned(),
            client_secret: secret,
        };
        let backend = oauth_token_backend_from_config(
            &self_hosted,
            Some("https://invalid broker origin"),
            Some("1234567890-other.apps.googleusercontent.com"),
        )
        .unwrap();
        match backend {
            OAuthTokenBackend::SelfHostedDesktop {
                client_id: resolved_client_id,
                client_secret,
            } => {
                assert_eq!(resolved_client_id, client_id);
                assert_eq!(client_secret.expose(), "test-local-secret");
            }
            OAuthTokenBackend::Broker { .. } => {
                panic!("self-hosted mode must not select the publisher Broker")
            }
        }

        for invalid_origin in [
            "http://oauth-broker.example.com",
            "https://oauth-broker.example.com/",
            "https://oauth-broker.example.com/path",
            "https://oauth-broker.example.com?query=1",
            "https://user@oauth-broker.example.com",
        ] {
            assert_eq!(
                result_error_code(oauth_broker_urls(invalid_origin)),
                GoogleDriveNativeErrorCode::OauthBrokerMisconfigured
            );
        }
    }

    #[test]
    fn oauth_broker_requests_have_exact_versioned_json_without_client_identity() {
        let exchange = oauth_broker_exchange_body(
            "test-authorization-code",
            "a234567890123456789012345678901234567890123456789012345678901234",
            "http://127.0.0.1:43123",
        )
        .unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&exchange).unwrap(),
            serde_json::json!({
                "code": "test-authorization-code",
                "codeVerifier": "a234567890123456789012345678901234567890123456789012345678901234",
                "protocolVersion": 1,
                "redirectUri": "http://127.0.0.1:43123",
            })
        );

        let refresh = oauth_broker_refresh_body("test-refresh-token").unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&refresh).unwrap(),
            serde_json::json!({
                "protocolVersion": 1,
                "refreshToken": "test-refresh-token",
            })
        );
        for body in [&exchange, &refresh] {
            let text = String::from_utf8_lossy(body);
            assert!(!text.contains("clientId"));
            assert!(!text.contains("client_id"));
            assert!(!text.contains("clientSecret"));
            assert!(!text.contains("client_secret"));
            assert!(!text.contains("scope"));
        }
        let (exchange_url, _) = oauth_broker_urls("https://oauth-broker.example.com").unwrap();
        let client = http_client(Duration::from_secs(10)).unwrap();
        let request = oauth_broker_request(&client, &exchange_url, exchange.clone()).unwrap();
        assert_eq!(request.method(), Method::POST);
        assert_eq!(request.url(), &exchange_url);
        assert_eq!(
            request.headers().get(ACCEPT),
            Some(&HeaderValue::from_static("application/json"))
        );
        assert_eq!(
            request.headers().get(CONTENT_TYPE),
            Some(&HeaderValue::from_static("application/json"))
        );
        for forbidden in ["authorization", "cookie", "origin"] {
            assert!(!request.headers().contains_key(forbidden));
        }
        assert_eq!(
            request.body().and_then(|body| body.as_bytes()),
            Some(exchange.as_slice())
        );

        assert_eq!(
            result_error_code(oauth_broker_exchange_body(
                "test-authorization-code",
                "a234567890123456789012345678901234567890123456789012345678901234",
                "https://evil.example/callback",
            )),
            GoogleDriveNativeErrorCode::TokenRequestInvalid
        );
        assert_eq!(
            result_error_code(oauth_broker_refresh_body(
                &"x".repeat(MAX_OAUTH_BROKER_REQUEST_TOKEN_LENGTH + 1)
            )),
            GoogleDriveNativeErrorCode::AuthorizationGrantInvalid
        );
    }

    #[test]
    fn oauth_broker_errors_are_status_bound_and_never_reflect_response_data() {
        let mut retry_headers = HeaderMap::new();
        retry_headers.insert(RETRY_AFTER, HeaderValue::from_static("60"));
        assert_eq!(oauth_broker_retry_after_ms(&retry_headers), Some(60_000));
        retry_headers.insert(RETRY_AFTER, HeaderValue::from_static("301"));
        assert_eq!(oauth_broker_retry_after_ms(&retry_headers), None);

        let cases: &[(StatusCode, &[u8], GoogleDriveNativeErrorCode)] = &[
            (
                StatusCode::BAD_REQUEST,
                br#"{"error":"invalid_grant"}"#,
                GoogleDriveNativeErrorCode::AuthorizationGrantInvalid,
            ),
            (
                StatusCode::UNAUTHORIZED,
                br#"{"error":"invalid_client"}"#,
                GoogleDriveNativeErrorCode::OauthClientInvalid,
            ),
            (
                StatusCode::TOO_MANY_REQUESTS,
                br#"{"error":"rate_limited"}"#,
                GoogleDriveNativeErrorCode::OauthBrokerRateLimited,
            ),
            (
                StatusCode::SERVICE_UNAVAILABLE,
                br#"{"error":"provider_unavailable"}"#,
                GoogleDriveNativeErrorCode::OauthBrokerUnavailable,
            ),
            (
                StatusCode::SERVICE_UNAVAILABLE,
                br#"{"error":"server_misconfigured"}"#,
                GoogleDriveNativeErrorCode::OauthBrokerMisconfigured,
            ),
            (
                StatusCode::BAD_GATEWAY,
                br#"{"error":"provider_response_invalid"}"#,
                GoogleDriveNativeErrorCode::OauthBrokerUnavailable,
            ),
            (
                StatusCode::BAD_REQUEST,
                br#"{"error":"invalid_grant","error_description":"must-not-leak"}"#,
                GoogleDriveNativeErrorCode::OauthBrokerProtocolInvalid,
            ),
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                b"not-json-must-not-leak",
                GoogleDriveNativeErrorCode::OauthBrokerUnavailable,
            ),
            (
                StatusCode::BAD_REQUEST,
                br#"{"error":"rate_limited"}"#,
                GoogleDriveNativeErrorCode::OauthBrokerProtocolInvalid,
            ),
        ];
        for (status, body, expected) in cases {
            let error = classified_oauth_broker_error(*status, body, Some(60_000)).unwrap();
            assert_eq!(error.code, *expected);
            let serialized = serde_json::to_string(&error).unwrap();
            assert!(!serialized.contains("must-not-leak"));
            assert!(!serialized.contains("error_description"));
        }
    }

    #[test]
    fn oauth_broker_non_contract_responses_preserve_outage_semantics() {
        assert_eq!(
            oauth_broker_non_contract_error(StatusCode::SERVICE_UNAVAILABLE, None).code,
            GoogleDriveNativeErrorCode::OauthBrokerUnavailable
        );
        assert_eq!(
            oauth_broker_non_contract_error(StatusCode::OK, None).code,
            GoogleDriveNativeErrorCode::OauthBrokerProtocolInvalid
        );
        assert_eq!(
            oauth_broker_non_contract_error(StatusCode::TOO_MANY_REQUESTS, Some(60_000)).code,
            GoogleDriveNativeErrorCode::OauthBrokerRateLimited
        );
        assert_eq!(
            classified_oauth_broker_error(
                StatusCode::SERVICE_UNAVAILABLE,
                br#"{"error":"provider_unavailable"}"#,
                None,
            )
            .unwrap()
            .code,
            GoogleDriveNativeErrorCode::OauthBrokerUnavailable
        );
    }

    #[test]
    fn oauth_broker_success_is_exact_and_protocol_bounded() {
        let token = parsed_oauth_broker_token_response(
            br#"{"access_token":"test-access","refresh_token":"test-refresh","expires_in":3600,"token_type":"Bearer","scope":"openid email https://www.googleapis.com/auth/drive.file"}"#,
            true,
            true,
        )
        .unwrap();
        assert_eq!(token.access_token, "test-access");
        assert_eq!(token.refresh_token.as_deref(), Some("test-refresh"));
        for invalid in [
            br#"{"access_token":"test-access","refresh_token":"test-refresh","expires_in":3600,"token_type":"Bearer","scope":"openid email https://www.googleapis.com/auth/drive.file","id_token":"must-not-leak"}"#.as_slice(),
            b"not-json".as_slice(),
        ] {
            assert_eq!(
                result_error_code(parsed_oauth_broker_token_response(invalid, true, true)),
                GoogleDriveNativeErrorCode::OauthBrokerProtocolInvalid
            );
        }
    }

    #[test]
    fn callback_success_message_describes_pending_connection() {
        assert_eq!(
            AUTHORIZATION_RECEIVED_MESSAGE,
            "Authorization received. Return to OpenPencil while it finishes connecting."
        );
    }

    #[test]
    fn self_hosted_requests_use_fixed_google_endpoints_and_exact_client_identity() {
        let client_secret = GoogleDriveDesktopClientSecret("test-local-secret".to_owned());
        let authorization_form = authorization_code_token_form(
            "desktop-test.apps.googleusercontent.com",
            "test-code",
            "test-verifier",
            "http://127.0.0.1:12345",
            &client_secret,
        );
        let authorization_names = authorization_form
            .iter()
            .map(|(name, _)| *name)
            .collect::<Vec<_>>();
        assert_eq!(
            authorization_names,
            [
                "client_id",
                "client_secret",
                "code",
                "code_verifier",
                "grant_type",
                "redirect_uri"
            ]
        );

        let refresh_form = refresh_token_form(
            "desktop-test.apps.googleusercontent.com",
            "test-refresh-token",
            &client_secret,
        );
        let refresh_names = refresh_form
            .iter()
            .map(|(name, _)| *name)
            .collect::<Vec<_>>();
        assert_eq!(
            refresh_names,
            ["client_id", "client_secret", "refresh_token", "grant_type"]
        );
        for form in [&authorization_form, &refresh_form] {
            let secrets = form
                .iter()
                .filter_map(|(name, value)| (*name == "client_secret").then_some(*value))
                .collect::<Vec<_>>();
            assert_eq!(secrets, ["test-local-secret"]);
        }

        let client = http_client(Duration::from_secs(10)).unwrap();
        let authorization_request = authorization_code_token_request(
            &client,
            "desktop-test.apps.googleusercontent.com",
            "test-code",
            "test-verifier",
            "http://127.0.0.1:12345",
            &client_secret,
        )
        .unwrap();
        assert_eq!(authorization_request.method(), Method::POST);
        assert_eq!(authorization_request.url().as_str(), GOOGLE_TOKEN_URL);
        assert_eq!(
            authorization_request
                .body()
                .and_then(reqwest::Body::as_bytes),
            Some(
                b"client_id=desktop-test.apps.googleusercontent.com&client_secret=test-local-secret&code=test-code&code_verifier=test-verifier&grant_type=authorization_code&redirect_uri=http%3A%2F%2F127.0.0.1%3A12345"
                    .as_slice()
            )
        );

        let refresh_request = refresh_token_request(
            &client,
            "desktop-test.apps.googleusercontent.com",
            "test-refresh-token",
            &client_secret,
        )
        .unwrap();
        assert_eq!(refresh_request.method(), Method::POST);
        assert_eq!(refresh_request.url().as_str(), GOOGLE_TOKEN_URL);
        assert_eq!(
            refresh_request.body().and_then(reqwest::Body::as_bytes),
            Some(
                b"client_id=desktop-test.apps.googleusercontent.com&client_secret=test-local-secret&refresh_token=test-refresh-token&grant_type=refresh_token"
                    .as_slice()
            )
        );

        let authorization_url = authorization_url(
            "desktop-test.apps.googleusercontent.com",
            "http://127.0.0.1:12345",
            "test-state",
            "test-challenge",
        )
        .unwrap();
        let parsed_authorization_url = Url::parse(&authorization_url).unwrap();
        assert_eq!(parsed_authorization_url.scheme(), "https");
        assert_eq!(
            parsed_authorization_url.host_str(),
            Some("accounts.google.com")
        );
        assert_eq!(parsed_authorization_url.port(), None);
        assert_eq!(parsed_authorization_url.path(), "/o/oauth2/v2/auth");
        let query = parsed_authorization_url
            .query_pairs()
            .into_owned()
            .collect::<HashMap<_, _>>();
        assert_eq!(query.len(), 10);
        assert_eq!(
            query.get("scope").map(String::as_str),
            Some("openid email https://www.googleapis.com/auth/drive.file")
        );
        assert_eq!(
            query.get("code_challenge").map(String::as_str),
            Some("test-challenge")
        );
        assert_eq!(
            query.get("code_challenge_method").map(String::as_str),
            Some("S256")
        );
        assert_eq!(
            query.get("access_type").map(String::as_str),
            Some("offline")
        );
        assert_eq!(query.get("prompt").map(String::as_str), Some("consent"));
        assert!(!authorization_url.contains("client_secret"));
        assert!(!authorization_url.contains("test-local-secret"));
    }

    #[test]
    fn oauth_ipc_client_modes_are_exact_and_do_not_reflect_secrets() {
        let client_id = "desktop-test.apps.googleusercontent.com";
        let publisher: GoogleDriveAuthorizeRequest = serde_json::from_value(serde_json::json!({
            "operationId": "00000000000000000000000000000000",
            "oauthClient": { "mode": "publisher-broker" },
            "timeoutMs": 180000,
        }))
        .unwrap();
        assert!(matches!(
            publisher.oauth_client,
            GoogleDriveOAuthClient::PublisherBroker {}
        ));

        let self_hosted: GoogleDriveRefreshRequest = serde_json::from_value(serde_json::json!({
            "operationId": "00000000000000000000000000000000",
            "oauthClient": {
                "mode": "self-hosted-desktop",
                "clientId": client_id,
                "clientSecret": "test-local-secret",
            },
            "refreshToken": "test-refresh-token",
            "expectedSubject": "test-subject",
            "timeoutMs": 180000,
        }))
        .unwrap();
        match self_hosted.oauth_client {
            GoogleDriveOAuthClient::SelfHostedDesktop {
                client_id: parsed_client_id,
                client_secret,
            } => {
                assert_eq!(parsed_client_id, client_id);
                assert_eq!(client_secret.expose(), "test-local-secret");
            }
            GoogleDriveOAuthClient::PublisherBroker {} => {
                panic!("self-hosted request must retain its explicit client identity")
            }
        }

        let invalid_authorize_requests = [
            serde_json::json!({
                "operationId": "00000000000000000000000000000000",
                "oauthClient": {
                    "mode": "publisher-broker",
                    "clientId": client_id,
                },
                "timeoutMs": 180000,
            }),
            serde_json::json!({
                "operationId": "00000000000000000000000000000000",
                "oauthClient": {
                    "mode": "publisher-broker",
                    "clientSecret": "must-not-cross-modes",
                },
                "timeoutMs": 180000,
            }),
            serde_json::json!({
                "operationId": "00000000000000000000000000000000",
                "oauthClient": {
                    "mode": "self-hosted-desktop",
                    "clientId": client_id,
                },
                "timeoutMs": 180000,
            }),
            serde_json::json!({
                "operationId": "00000000000000000000000000000000",
                "oauthClient": {
                    "mode": "self-hosted-desktop",
                    "clientSecret": "must-not-cross-modes",
                },
                "timeoutMs": 180000,
            }),
            serde_json::json!({
                "operationId": "00000000000000000000000000000000",
                "oauthClient": {
                    "mode": "self-hosted-desktop",
                    "clientId": client_id,
                    "clientSecret": "must-not-cross-modes",
                    "tokenEndpoint": "https://attacker.example/token",
                },
                "timeoutMs": 180000,
            }),
            serde_json::json!({
                "operationId": "00000000000000000000000000000000",
                "oauthClient": { "mode": "unknown" },
                "timeoutMs": 180000,
            }),
            serde_json::json!({
                "operationId": "00000000000000000000000000000000",
                "clientId": client_id,
                "clientSecret": "legacy-top-level-secret",
                "timeoutMs": 180000,
            }),
        ];
        for request in invalid_authorize_requests {
            assert!(serde_json::from_value::<GoogleDriveAuthorizeRequest>(request).is_err());
        }

        let invalid_secrets = [
            "".to_owned(),
            "short".to_owned(),
            " test-local-secret".to_owned(),
            "test local secret".to_owned(),
            "test-local-secret\n".to_owned(),
            "非ascii-client-secret".to_owned(),
            "x".repeat(MAX_DESKTOP_CLIENT_SECRET_LENGTH + 1),
        ];
        for invalid_secret in invalid_secrets {
            let oauth_client = GoogleDriveOAuthClient::SelfHostedDesktop {
                client_id: client_id.to_owned(),
                client_secret: GoogleDriveDesktopClientSecret(invalid_secret.clone()),
            };
            let error = match oauth_token_backend_from_config(&oauth_client, None, None) {
                Ok(_) => panic!("invalid self-hosted secret must be rejected"),
                Err(error) => error,
            };
            assert_eq!(error.code, GoogleDriveNativeErrorCode::InvalidRequest);
            assert_eq!(
                serde_json::to_string(&error).unwrap(),
                r#"{"code":"invalid-request","message":"Google Drive request is invalid"}"#
            );
        }

        let invalid_client = GoogleDriveOAuthClient::SelfHostedDesktop {
            client_id: "attacker.example".to_owned(),
            client_secret: GoogleDriveDesktopClientSecret("test-local-secret".to_owned()),
        };
        assert_eq!(
            result_error_code(oauth_token_backend_from_config(&invalid_client, None, None)),
            GoogleDriveNativeErrorCode::InvalidRequest
        );
    }

    #[test]
    fn token_exchange_errors_use_only_the_top_level_error_identifier() {
        assert!(
            classified_token_exchange_error(StatusCode::OK, br#"{"error":"invalid_grant"}"#)
                .is_none()
        );

        let cases: &[(StatusCode, &[u8], GoogleDriveNativeErrorCode)] = &[
            (
                StatusCode::BAD_REQUEST,
                br#"{"error":"invalid_client","error_description":"must-not-leak","code":"must-not-leak","access_token":"must-not-leak","refresh_token":"must-not-leak"}"#,
                GoogleDriveNativeErrorCode::OauthClientInvalid,
            ),
            (
                StatusCode::UNAUTHORIZED,
                br#"{"error":"unauthorized_client"}"#,
                GoogleDriveNativeErrorCode::OauthClientInvalid,
            ),
            (
                StatusCode::BAD_REQUEST,
                br#"{"error":"invalid_grant"}"#,
                GoogleDriveNativeErrorCode::AuthorizationGrantInvalid,
            ),
            (
                StatusCode::BAD_REQUEST,
                br#"{"error":"redirect_uri_mismatch"}"#,
                GoogleDriveNativeErrorCode::RedirectUriMismatch,
            ),
            (
                StatusCode::BAD_REQUEST,
                br#"{"error":"invalid_request"}"#,
                GoogleDriveNativeErrorCode::TokenRequestInvalid,
            ),
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                br#"{"error":"temporarily_unavailable"}"#,
                GoogleDriveNativeErrorCode::TokenExchangeFailed,
            ),
            (
                StatusCode::BAD_REQUEST,
                br#"{"error":{"code":"invalid_grant"}}"#,
                GoogleDriveNativeErrorCode::TokenExchangeFailed,
            ),
            (
                StatusCode::BAD_REQUEST,
                b"not-json",
                GoogleDriveNativeErrorCode::TokenExchangeFailed,
            ),
        ];
        for (status, body, expected) in cases {
            let error = classified_token_exchange_error(*status, body)
                .expect("non-success token status must produce a safe error");
            assert_eq!(error.code, *expected);
            let serialized = serde_json::to_string(&error).unwrap();
            assert!(!serialized.contains("must-not-leak"));
            assert!(!serialized.contains("error_description"));
            assert!(!serialized.contains("access_token"));
            assert!(!serialized.contains("refresh_token"));
        }
    }

    #[test]
    fn token_responses_are_classified_without_response_data() {
        let valid = parsed_token_response(
            br#"{"access_token":"test-access","refresh_token":"test-refresh","expires_in":3600,"token_type":"Bearer","scope":"openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive.file"}"#,
            true,
            true,
        )
        .unwrap();
        assert_eq!(valid.access_token, "test-access");
        assert_eq!(valid.refresh_token.as_deref(), Some("test-refresh"));
        assert_eq!(valid.expires_in, 3600);

        let invalid_responses: &[&[u8]] = &[
            b"not-json",
            br#"{"access_token":"test-access","refresh_token":"test-refresh","expires_in":3600,"token_type":"bearer","scope":"openid email https://www.googleapis.com/auth/drive.file"}"#,
            br#"{"access_token":"test-access","refresh_token":"test-refresh","expires_in":0,"token_type":"Bearer","scope":"openid email https://www.googleapis.com/auth/drive.file"}"#,
            br#"{"access_token":"test-access","expires_in":3600,"token_type":"Bearer","scope":"openid email https://www.googleapis.com/auth/drive.file"}"#,
        ];
        for body in invalid_responses {
            assert_eq!(
                result_error_code(parsed_token_response(body, true, true)),
                GoogleDriveNativeErrorCode::TokenResponseInvalid
            );
        }

        assert_eq!(
            result_error_code(parsed_token_response(
                br#"{"access_token":"test-access","refresh_token":"test-refresh","expires_in":3600,"token_type":"Bearer","scope":"openid email"}"#,
                true,
                true,
            )),
            GoogleDriveNativeErrorCode::ScopeMismatch
        );
    }

    #[test]
    fn userinfo_failures_preserve_subject_and_network_diagnostics() {
        assert!(validate_userinfo_status(StatusCode::OK).is_ok());
        assert_eq!(
            result_error_code(validate_userinfo_status(StatusCode::UNAUTHORIZED)),
            GoogleDriveNativeErrorCode::UserinfoFailed
        );
        assert_eq!(
            result_error_code(parsed_userinfo_response(b"not-json", None)),
            GoogleDriveNativeErrorCode::UserinfoFailed
        );
        assert_eq!(
            result_error_code(parsed_userinfo_response(
                br#"{"email":"test@example.com"}"#,
                None
            )),
            GoogleDriveNativeErrorCode::UserinfoFailed
        );
        assert_eq!(
            result_error_code(parsed_userinfo_response(
                br#"{"sub":"different-subject"}"#,
                Some("expected-subject"),
            )),
            GoogleDriveNativeErrorCode::SubjectMismatch
        );

        let user = parsed_userinfo_response(
            br#"{"sub":"expected-subject","email":"test@example.com","email_verified":true}"#,
            Some("expected-subject"),
        )
        .unwrap();
        assert_eq!(user.subject, "expected-subject");
        assert_eq!(user.email.as_deref(), Some("test@example.com"));
    }

    #[test]
    fn pkce_uses_s256_and_bounded_verifier() {
        let (verifier, challenge) = pkce_pair();
        assert!((43..=128).contains(&verifier.len()));
        assert_eq!(challenge.len(), 43);
        assert_eq!(
            challenge,
            URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
        );
    }

    #[test]
    fn one_time_state_rejects_mismatch_and_replay() {
        let mut state = OneTimeState::new("expected".to_owned());
        assert_eq!(state.consume("wrong"), Err(StateValidationError::Mismatch));
        assert_eq!(state.consume("expected"), Ok(()));
        assert_eq!(state.consume("expected"), Err(StateValidationError::Replay));
    }

    #[test]
    fn callback_requires_matching_state_and_single_code() {
        let mut state = OneTimeState::new("expected".to_owned());
        assert!(matches!(
            callback_decision("GET /?code=x&state=wrong HTTP/1.1\r\n\r\n", &mut state),
            CallbackDecision::Ignore
        ));
        assert!(matches!(
            callback_decision(
                "GET /?code=authorization-code&state=expected HTTP/1.1\r\n\r\n",
                &mut state
            ),
            CallbackDecision::Success(code) if code == "authorization-code"
        ));
        assert!(matches!(
            callback_decision(
                "GET /?code=authorization-code&state=expected HTTP/1.1\r\n\r\n",
                &mut state
            ),
            CallbackDecision::Failed(_)
        ));
    }

    #[test]
    fn validates_client_and_timeout_bounds() {
        assert!(validate_client_id("1234567890-abc.apps.googleusercontent.com").is_ok());
        assert!(validate_client_id("123.4567890.apps.googleusercontent.com").is_err());
        assert!(validate_client_id("https://evil.example").is_err());
        assert!(oauth_timeout(Some(MIN_OAUTH_TIMEOUT_MS)).is_ok());
        assert!(oauth_timeout(Some(MIN_OAUTH_TIMEOUT_MS - 1)).is_err());
        assert!(oauth_timeout(Some(MAX_OAUTH_TIMEOUT_MS + 1)).is_err());
    }

    #[test]
    fn bounds_concurrent_oauth_operations() {
        let operations = GoogleDriveOAuthOperations::default();
        for index in 0..MAX_CONCURRENT_OAUTH_OPERATIONS {
            let operation_id = format!("{index:032x}");
            assert!(operations.begin(&operation_id).is_ok());
        }
        assert!(operations.begin(&format!("{:032x}", usize::MAX)).is_err());
    }

    #[test]
    fn transfer_url_is_exact_and_kind_bounded() {
        assert!(validate_drive_url(
            GoogleDriveTransferKind::Api,
            "https://www.googleapis.com/drive/v3/files?pageSize=10"
        )
        .is_ok());
        assert!(validate_drive_url(
            GoogleDriveTransferKind::ResumableInit,
            "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable"
        )
        .is_ok());
        assert!(validate_drive_url(
            GoogleDriveTransferKind::UploadChunk,
            "https://www.googleapis.com/upload/drive/v3/files?upload_id=secret"
        )
        .is_ok());
        assert!(validate_drive_url(
            GoogleDriveTransferKind::DownloadChunk,
            "https://www.googleapis.com/drive/v3/files/file-id?alt=media"
        )
        .is_ok());
        assert!(validate_drive_url(
            GoogleDriveTransferKind::Api,
            "https://www.googleapis.com.evil.example/drive/v3/files"
        )
        .is_err());
        assert!(validate_drive_url(
            GoogleDriveTransferKind::Api,
            "https://www.googleapis.com/drive/v3/files?access_token=secret"
        )
        .is_err());
        assert!(validate_drive_url(
            GoogleDriveTransferKind::DownloadChunk,
            "https://www.googleapis.com/drive/v3/files/file-id?alt=media&alt=media"
        )
        .is_err());
    }

    #[test]
    fn transfer_requires_bearer_and_kind_headers() {
        let headers = [GoogleDriveTransferHeader {
            name: "authorization".to_owned(),
            value: "Bearer token".to_owned(),
        }];
        assert!(validated_headers(GoogleDriveTransferKind::Api, &headers).is_ok());
        assert!(validated_headers(GoogleDriveTransferKind::UploadChunk, &headers).is_err());
        assert!(validated_headers(GoogleDriveTransferKind::DownloadChunk, &headers).is_err());

        let maximum_token = [GoogleDriveTransferHeader {
            name: "authorization".to_owned(),
            value: format!("Bearer {}", "a".repeat(MAX_TOKEN_LENGTH)),
        }];
        assert!(validated_headers(GoogleDriveTransferKind::Api, &maximum_token).is_ok());
        let oversized_token = [GoogleDriveTransferHeader {
            name: "authorization".to_owned(),
            value: format!("Bearer {}", "a".repeat(MAX_TOKEN_LENGTH + 1)),
        }];
        assert!(validated_headers(GoogleDriveTransferKind::Api, &oversized_token).is_err());

        let overflowing_range = [
            GoogleDriveTransferHeader {
                name: "authorization".to_owned(),
                value: "Bearer token".to_owned(),
            },
            GoogleDriveTransferHeader {
                name: "range".to_owned(),
                value: "bytes=0-18446744073709551615".to_owned(),
            },
        ];
        assert!(
            validated_headers(GoogleDriveTransferKind::DownloadChunk, &overflowing_range).is_err()
        );

        let first_download = [
            GoogleDriveTransferHeader {
                name: "authorization".to_owned(),
                value: "Bearer token".to_owned(),
            },
            GoogleDriveTransferHeader {
                name: "range".to_owned(),
                value: "bytes=0-1048575".to_owned(),
            },
        ];
        assert!(validated_headers(GoogleDriveTransferKind::DownloadChunk, &first_download).is_ok());

        let continuation_without_etag = [
            GoogleDriveTransferHeader {
                name: "authorization".to_owned(),
                value: "Bearer token".to_owned(),
            },
            GoogleDriveTransferHeader {
                name: "range".to_owned(),
                value: "bytes=1048576-2097151".to_owned(),
            },
        ];
        assert!(validated_headers(
            GoogleDriveTransferKind::DownloadChunk,
            &continuation_without_etag
        )
        .is_err());

        let continuation = [
            GoogleDriveTransferHeader {
                name: "authorization".to_owned(),
                value: "Bearer token".to_owned(),
            },
            GoogleDriveTransferHeader {
                name: "range".to_owned(),
                value: "bytes=1048576-2097151".to_owned(),
            },
            GoogleDriveTransferHeader {
                name: "if-match".to_owned(),
                value: "\"stable-revision\"".to_owned(),
            },
        ];
        assert!(validated_headers(GoogleDriveTransferKind::DownloadChunk, &continuation).is_ok());

        let weak_continuation = [
            GoogleDriveTransferHeader {
                name: "authorization".to_owned(),
                value: "Bearer token".to_owned(),
            },
            GoogleDriveTransferHeader {
                name: "range".to_owned(),
                value: "bytes=1048576-2097151".to_owned(),
            },
            GoogleDriveTransferHeader {
                name: "if-match".to_owned(),
                value: "W/\"weak-revision\"".to_owned(),
            },
        ];
        assert!(
            validated_headers(GoogleDriveTransferKind::DownloadChunk, &weak_continuation).is_err()
        );
        assert!(!allowed_header(
            GoogleDriveTransferKind::DownloadChunk,
            "if-range"
        ));
    }
}
