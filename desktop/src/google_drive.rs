use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{rngs::OsRng, RngCore};
use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue},
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
const MAX_METADATA_BODY_BYTES: usize = 1024 * 1024;
const MAX_TRANSFER_CHUNK_BYTES: usize = 8 * 1024 * 1024;
const MAX_HEADER_COUNT: usize = 16;
const MAX_HEADER_BYTES: usize = 32 * 1024;
const MAX_URL_LENGTH: usize = 8 * 1024;
const MAX_TOKEN_LENGTH: usize = 16 * 1024;
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
}

impl GoogleDriveNativeError {
    fn new(code: GoogleDriveNativeErrorCode, message: &'static str) -> Self {
        Self { code, message }
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleDriveAuthorizeRequest {
    operation_id: String,
    client_id: String,
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
#[serde(rename_all = "camelCase")]
pub struct GoogleDriveRefreshRequest {
    operation_id: String,
    client_id: String,
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
    if value.len() < 20
        || value.len() > 256
        || !value.ends_with(suffix)
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        return Err(GoogleDriveNativeError::invalid_request());
    }
    Ok(())
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
    if value.is_empty() || value.len() > MAX_TOKEN_LENGTH || value.chars().any(char::is_control) {
        return Err(GoogleDriveNativeError::oauth_failed());
    }
    Ok(value)
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

fn parsed_token_response(
    body: &[u8],
    require_refresh_token: bool,
    require_scopes: bool,
) -> Result<ValidatedTokenResponse, GoogleDriveNativeError> {
    let parsed: OAuthTokenResponse = serde_json::from_slice(body)
        .map_err(|_| GoogleDriveNativeError::token_response_invalid())?;
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
) -> [(&'static str, &'a str); 5] {
    [
        ("client_id", client_id),
        ("code", code),
        ("code_verifier", verifier),
        ("grant_type", "authorization_code"),
        ("redirect_uri", redirect_uri),
    ]
}

fn refresh_token_form<'a>(
    client_id: &'a str,
    refresh_token: &'a str,
) -> [(&'static str, &'a str); 3] {
    [
        ("client_id", client_id),
        ("refresh_token", refresh_token),
        ("grant_type", "refresh_token"),
    ]
}

async fn exchange_authorization_code(
    client: &Client,
    client_id: &str,
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> Result<ValidatedTokenResponse, GoogleDriveNativeError> {
    let mut response = client
        .post(GOOGLE_TOKEN_URL)
        .form(&authorization_code_token_form(
            client_id,
            code,
            verifier,
            redirect_uri,
        ))
        .send()
        .await
        .map_err(|_| GoogleDriveNativeError::network_failed())?;
    validate_token_exchange_response(&mut response).await?;
    let body = bounded_response_body(&mut response, MAX_OAUTH_RESPONSE_BYTES).await?;
    parsed_token_response(&body, true, true)
}

async fn refresh_access_token(
    client: &Client,
    client_id: &str,
    refresh_token: &str,
) -> Result<ValidatedTokenResponse, GoogleDriveNativeError> {
    let mut response = client
        .post(GOOGLE_TOKEN_URL)
        .form(&refresh_token_form(client_id, refresh_token))
        .send()
        .await
        .map_err(|_| GoogleDriveNativeError::network_failed())?;
    validate_token_exchange_response(&mut response).await?;
    let body = bounded_response_body(&mut response, MAX_OAUTH_RESPONSE_BYTES).await?;
    parsed_token_response(&body, false, false)
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
    validate_client_id(&request.client_id)?;
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
    let url = authorization_url(&request.client_id, &redirect_uri, &state, &challenge)?;
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
        exchange_authorization_code(&client, &request.client_id, &code, &verifier, &redirect_uri)
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
    validate_client_id(&request.client_id)?;
    validate_token(Some(request.refresh_token.clone()))?;
    if request.expected_subject.is_empty()
        || request.expected_subject.len() > 256
        || request.expected_subject.chars().any(char::is_control)
    {
        return Err(GoogleDriveNativeError::invalid_request());
    }
    let timeout = oauth_timeout(request.timeout_ms)?;
    let cancelled = operations.begin(&request.operation_id)?;
    let result = async {
        let client = http_client(timeout)?;
        let token =
            refresh_access_token(&client, &request.client_id, &request.refresh_token).await?;
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
        if !allowed_header(kind, &name_text)
            || value.value.is_empty()
            || value.value.len() > MAX_TOKEN_LENGTH
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
    if !authorization.starts_with("Bearer ") || authorization.len() <= "Bearer ".len() {
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
    fn callback_success_message_describes_pending_connection() {
        assert_eq!(
            AUTHORIZATION_RECEIVED_MESSAGE,
            "Authorization received. Return to OpenPencil while it finishes connecting."
        );
    }

    #[test]
    fn token_forms_use_public_client_id_without_client_secret() {
        let authorization_names = authorization_code_token_form(
            "desktop-test.apps.googleusercontent.com",
            "test-code",
            "test-verifier",
            "http://127.0.0.1:12345",
        )
        .map(|(name, _)| name);
        assert_eq!(
            authorization_names,
            [
                "client_id",
                "code",
                "code_verifier",
                "grant_type",
                "redirect_uri"
            ]
        );

        let refresh_names = refresh_token_form(
            "desktop-test.apps.googleusercontent.com",
            "test-refresh-token",
        )
        .map(|(name, _)| name);
        assert_eq!(refresh_names, ["client_id", "refresh_token", "grant_type"]);
        assert!(!authorization_names.contains(&"client_secret"));
        assert!(!refresh_names.contains(&"client_secret"));
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
        assert!(validate_client_id("123-abc.apps.googleusercontent.com").is_ok());
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
