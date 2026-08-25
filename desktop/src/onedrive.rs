use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{rngs::OsRng, RngCore};
use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue, CONTENT_TYPE, LOCATION, RETRY_AFTER},
    redirect::Policy,
    Client, Method, StatusCode, Url,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    io::{ErrorKind, Read, Write},
    net::{Ipv4Addr, Ipv6Addr, SocketAddr, TcpListener, TcpStream, ToSocketAddrs},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

const MICROSOFT_TENANT: &str = "common";
const MICROSOFT_AUTHORITY_ORIGIN: &str = "https://login.microsoftonline.com";
const MICROSOFT_USERINFO_URL: &str = "https://graph.microsoft.com/oidc/userinfo";
const MICROSOFT_GRAPH_ORIGIN: &str = "graph.microsoft.com";
const MICROSOFT_GRAPH_SCOPE: &str = "https://graph.microsoft.com/Files.ReadWrite.AppFolder";
const MICROSOFT_GRAPH_SCOPE_SHORT: &str = "Files.ReadWrite.AppFolder";
const COMPILED_ONEDRIVE_CLIENT_ID: Option<&str> = option_env!("VITE_ONEDRIVE_CLIENT_ID");
const CANONICAL_SCOPES: [&str; 5] = [
    "openid",
    "profile",
    "email",
    "offline_access",
    MICROSOFT_GRAPH_SCOPE,
];

const DEFAULT_OAUTH_TIMEOUT_MS: u64 = 180_000;
const MIN_OAUTH_TIMEOUT_MS: u64 = 10_000;
const MAX_OAUTH_TIMEOUT_MS: u64 = 300_000;
const DEFAULT_TRANSFER_TIMEOUT_MS: u64 = 30_000;
const MAX_TRANSFER_TIMEOUT_MS: u64 = 120_000;
const MAX_CALLBACK_HEAD_BYTES: usize = 8 * 1024;
const MAX_AUTHORIZATION_CODE_LENGTH: usize = 4 * 1024;
const MAX_OAUTH_RESPONSE_BYTES: usize = 64 * 1024;
const MAX_TOKEN_LENGTH: usize = 8 * 1024;
const MAX_SCOPE_RESPONSE_BYTES: usize = 4 * 1024;
const MAX_CONCURRENT_OAUTH_OPERATIONS: usize = 8;
const MAX_URL_LENGTH: usize = 8 * 1024;
const MAX_HEADER_COUNT: usize = 16;
const MAX_HEADER_BYTES: usize = 32 * 1024;
const MAX_METADATA_BODY_BYTES: usize = 1024 * 1024;
const MAX_METADATA_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const MAX_TRANSFER_CHUNK_BYTES: usize = 10 * 1024 * 1024;
const MAX_PREAUTHORIZED_URLS: usize = 128;
const UPLOAD_URL_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const DOWNLOAD_URL_TTL: Duration = Duration::from_secs(60 * 60);
const AUTHORIZATION_RECEIVED_MESSAGE: &str =
    "Authorization received. Return to OpenPencil while it finishes connecting.";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum OneDriveNativeErrorCode {
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
    RateLimited,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OneDriveNativeError {
    code: OneDriveNativeErrorCode,
    message: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    retry_after_ms: Option<u64>,
}

impl OneDriveNativeError {
    fn new(code: OneDriveNativeErrorCode, message: &'static str) -> Self {
        Self {
            code,
            message,
            retry_after_ms: None,
        }
    }

    fn invalid_request() -> Self {
        Self::new(
            OneDriveNativeErrorCode::InvalidRequest,
            "OneDrive request is invalid",
        )
    }

    fn unsupported() -> Self {
        Self::new(
            OneDriveNativeErrorCode::Unsupported,
            "OneDrive authorization is unavailable in this build",
        )
    }

    fn oauth_failed() -> Self {
        Self::new(
            OneDriveNativeErrorCode::OauthFailed,
            "Microsoft authorization failed",
        )
    }

    fn oauth_client_invalid() -> Self {
        Self::new(
            OneDriveNativeErrorCode::OauthClientInvalid,
            "Microsoft OAuth client is invalid",
        )
    }

    fn authorization_grant_invalid() -> Self {
        Self::new(
            OneDriveNativeErrorCode::AuthorizationGrantInvalid,
            "Microsoft authorization grant is invalid",
        )
    }

    fn redirect_uri_mismatch() -> Self {
        Self::new(
            OneDriveNativeErrorCode::RedirectUriMismatch,
            "Microsoft redirect URI did not match",
        )
    }

    fn token_request_invalid() -> Self {
        Self::new(
            OneDriveNativeErrorCode::TokenRequestInvalid,
            "Microsoft token request is invalid",
        )
    }

    fn token_exchange_failed() -> Self {
        Self::new(
            OneDriveNativeErrorCode::TokenExchangeFailed,
            "Microsoft token exchange failed",
        )
    }

    fn token_response_invalid() -> Self {
        Self::new(
            OneDriveNativeErrorCode::TokenResponseInvalid,
            "Microsoft returned an invalid token response",
        )
    }

    fn userinfo_failed() -> Self {
        Self::new(
            OneDriveNativeErrorCode::UserinfoFailed,
            "Microsoft account information could not be verified",
        )
    }

    fn scope_mismatch() -> Self {
        Self::new(
            OneDriveNativeErrorCode::ScopeMismatch,
            "Microsoft did not grant the required OneDrive scopes",
        )
    }

    fn network_failed() -> Self {
        Self::new(
            OneDriveNativeErrorCode::NetworkFailed,
            "OneDrive network request failed",
        )
    }

    fn response_too_large() -> Self {
        Self::new(
            OneDriveNativeErrorCode::ResponseTooLarge,
            "OneDrive response exceeded the byte limit",
        )
    }

    fn rate_limited(retry_after_ms: Option<u64>) -> Self {
        Self {
            code: OneDriveNativeErrorCode::RateLimited,
            message: "Microsoft temporarily rate limited OneDrive",
            retry_after_ms,
        }
    }
}

#[derive(Default)]
pub struct OneDriveOAuthOperations(Mutex<HashMap<String, Arc<AtomicBool>>>);

impl OneDriveOAuthOperations {
    fn begin(&self, operation_id: &str) -> Result<Arc<AtomicBool>, OneDriveNativeError> {
        if !valid_operation_id(operation_id) {
            return Err(OneDriveNativeError::invalid_request());
        }
        let mut operations = self
            .0
            .lock()
            .map_err(|_| OneDriveNativeError::oauth_failed())?;
        if operations.contains_key(operation_id)
            || operations.len() >= MAX_CONCURRENT_OAUTH_OPERATIONS
        {
            return Err(OneDriveNativeError::invalid_request());
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

    fn cancel(&self, operation_id: &str) -> Result<bool, OneDriveNativeError> {
        if !valid_operation_id(operation_id) {
            return Err(OneDriveNativeError::invalid_request());
        }
        let operations = self
            .0
            .lock()
            .map_err(|_| OneDriveNativeError::oauth_failed())?;
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OneDriveAuthorizeRequest {
    operation_id: String,
    timeout_ms: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OneDriveAuthorizeResponse {
    access_token: String,
    refresh_token: String,
    expires_in: u64,
    granted_scopes: Vec<&'static str>,
    subject: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OneDriveRefreshRequest {
    operation_id: String,
    refresh_token: String,
    expected_subject: String,
    timeout_ms: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OneDriveRefreshResponse {
    access_token: String,
    refresh_token: String,
    expires_in: u64,
    granted_scopes: Vec<&'static str>,
    subject: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
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
    error_codes: Option<Vec<i64>>,
}

struct ValidatedTokenResponse {
    access_token: String,
    refresh_token: String,
    expires_in: u64,
}

#[derive(Deserialize)]
struct UserInfoResponse {
    sub: Option<String>,
    email: Option<String>,
    name: Option<String>,
}

struct VerifiedUser {
    subject: String,
    email: Option<String>,
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
    Failed(OneDriveNativeError),
}

fn valid_client_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && [8, 13, 18, 23].iter().all(|index| bytes[*index] == b'-')
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| [8, 13, 18, 23].contains(&index) || byte.is_ascii_hexdigit())
}

fn configured_client_id() -> Result<&'static str, OneDriveNativeError> {
    let value = COMPILED_ONEDRIVE_CLIENT_ID.ok_or_else(OneDriveNativeError::unsupported)?;
    valid_client_id(value)
        .then_some(value)
        .ok_or_else(OneDriveNativeError::oauth_client_invalid)
}

fn oauth_timeout(value: Option<u64>) -> Result<Duration, OneDriveNativeError> {
    let milliseconds = value.unwrap_or(DEFAULT_OAUTH_TIMEOUT_MS);
    if !(MIN_OAUTH_TIMEOUT_MS..=MAX_OAUTH_TIMEOUT_MS).contains(&milliseconds) {
        return Err(OneDriveNativeError::invalid_request());
    }
    Ok(Duration::from_millis(milliseconds))
}

fn transfer_timeout(value: Option<u64>) -> Result<Duration, OneDriveNativeError> {
    let milliseconds = value.unwrap_or(DEFAULT_TRANSFER_TIMEOUT_MS);
    if !(1_000..=MAX_TRANSFER_TIMEOUT_MS).contains(&milliseconds) {
        return Err(OneDriveNativeError::invalid_request());
    }
    Ok(Duration::from_millis(milliseconds))
}

struct LoopbackListeners {
    listeners: Vec<TcpListener>,
    port: u16,
}

impl LoopbackListeners {
    fn port(&self) -> u16 {
        self.port
    }
}

fn bind_loopback_listeners() -> Result<LoopbackListeners, OneDriveNativeError> {
    // Microsoft requires the registered desktop redirect to use `localhost` and ignores its
    // ephemeral port. Resolve that same hostname in OS preference order (often IPv6 first), then
    // also bind the other loopback family on the selected port when the platform permits it.
    let mut candidates = ("localhost", 0)
        .to_socket_addrs()
        .map(|addresses| {
            addresses
                .filter(|address| address.ip().is_loopback())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    for fallback in [
        SocketAddr::new(Ipv6Addr::LOCALHOST.into(), 0),
        SocketAddr::new(Ipv4Addr::LOCALHOST.into(), 0),
    ] {
        if !candidates
            .iter()
            .any(|candidate| candidate.is_ipv4() == fallback.is_ipv4())
        {
            candidates.push(fallback);
        }
    }
    'ports: for _ in 0..16 {
        for primary_address in &candidates {
            let Ok(primary) = TcpListener::bind(primary_address) else {
                continue;
            };
            let port = primary
                .local_addr()
                .map_err(|_| OneDriveNativeError::oauth_failed())?
                .port();
            let mut listeners = vec![primary];
            if let Some(secondary_address) = candidates
                .iter()
                .find(|candidate| candidate.is_ipv4() != primary_address.is_ipv4())
                .map(|candidate| SocketAddr::new(candidate.ip(), port))
            {
                match TcpListener::bind(secondary_address) {
                    Ok(secondary) => listeners.push(secondary),
                    Err(error) if error.kind() == ErrorKind::AddrInUse => continue 'ports,
                    Err(_) => {}
                }
            }
            return Ok(LoopbackListeners { listeners, port });
        }
    }
    Err(OneDriveNativeError::new(
        OneDriveNativeErrorCode::Unsupported,
        "A local authorization callback could not be started",
    ))
}

fn loopback_redirect_uri(port: u16) -> String {
    format!("http://localhost:{port}/")
}

fn authority_url(path: &str) -> Result<Url, OneDriveNativeError> {
    Url::parse(&format!(
        "{MICROSOFT_AUTHORITY_ORIGIN}/{MICROSOFT_TENANT}/oauth2/v2.0/{path}"
    ))
    .map_err(|_| OneDriveNativeError::oauth_failed())
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
) -> Result<String, OneDriveNativeError> {
    if !valid_client_id(client_id) {
        return Err(OneDriveNativeError::oauth_client_invalid());
    }
    let mut url = authority_url("authorize")?;
    url.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("response_mode", "query")
        .append_pair("scope", &CANONICAL_SCOPES.join(" "))
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("prompt", "select_account")
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

fn read_request_head(stream: &mut TcpStream) -> Result<String, OneDriveNativeError> {
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(|_| OneDriveNativeError::oauth_failed())?;
    let mut bytes = Vec::with_capacity(1024);
    let mut buffer = [0_u8; 1024];
    loop {
        let read = stream
            .read(&mut buffer)
            .map_err(|_| OneDriveNativeError::oauth_failed())?;
        if read == 0 {
            break;
        }
        bytes.extend_from_slice(&buffer[..read]);
        if bytes.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
        if bytes.len() > MAX_CALLBACK_HEAD_BYTES {
            return Err(OneDriveNativeError::invalid_request());
        }
    }
    if bytes.len() > MAX_CALLBACK_HEAD_BYTES {
        return Err(OneDriveNativeError::invalid_request());
    }
    String::from_utf8(bytes).map_err(|_| OneDriveNativeError::invalid_request())
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
            return CallbackDecision::Failed(OneDriveNativeError::oauth_failed())
        }
    }
    if let Some(error) = query.get("error") {
        let denied = error == "access_denied";
        return CallbackDecision::Failed(if denied {
            OneDriveNativeError::new(
                OneDriveNativeErrorCode::OauthDenied,
                "Microsoft authorization was denied",
            )
        } else {
            OneDriveNativeError::oauth_failed()
        });
    }
    let Some(code) = query.get("code") else {
        return CallbackDecision::Failed(OneDriveNativeError::oauth_failed());
    };
    if code.is_empty()
        || code.len() > MAX_AUTHORIZATION_CODE_LENGTH
        || code.chars().any(char::is_control)
    {
        return CallbackDecision::Failed(OneDriveNativeError::oauth_failed());
    }
    CallbackDecision::Success(code.to_owned())
}

fn wait_for_callback(
    listeners: LoopbackListeners,
    expected_state: String,
    cancelled: Arc<AtomicBool>,
    timeout: Duration,
) -> Result<String, OneDriveNativeError> {
    for listener in &listeners.listeners {
        listener
            .set_nonblocking(true)
            .map_err(|_| OneDriveNativeError::oauth_failed())?;
    }
    let deadline = Instant::now() + timeout;
    let mut state = OneTimeState::new(expected_state);
    loop {
        if cancelled.load(Ordering::SeqCst) {
            return Err(OneDriveNativeError::new(
                OneDriveNativeErrorCode::Cancelled,
                "Microsoft authorization was cancelled",
            ));
        }
        if Instant::now() >= deadline {
            return Err(OneDriveNativeError::new(
                OneDriveNativeErrorCode::Timeout,
                "Microsoft authorization timed out",
            ));
        }
        let mut accepted = false;
        for listener in &listeners.listeners {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    accepted = true;
                    let head = match read_request_head(&mut stream) {
                        Ok(head) => head,
                        Err(_) => {
                            browser_response(
                                &mut stream,
                                "400 Bad Request",
                                "Authorization failed.",
                            );
                            continue;
                        }
                    };
                    match callback_decision(&head, &mut state) {
                        CallbackDecision::Ignore => {
                            browser_response(
                                &mut stream,
                                "400 Bad Request",
                                "Authorization failed.",
                            );
                        }
                        CallbackDecision::Success(code) => {
                            browser_response(&mut stream, "200 OK", AUTHORIZATION_RECEIVED_MESSAGE);
                            return Ok(code);
                        }
                        CallbackDecision::Failed(error) => {
                            browser_response(
                                &mut stream,
                                "400 Bad Request",
                                "Authorization failed.",
                            );
                            return Err(error);
                        }
                    }
                }
                Err(error) if error.kind() == ErrorKind::WouldBlock => {}
                Err(_) => return Err(OneDriveNativeError::oauth_failed()),
            }
        }
        if !accepted {
            thread::sleep(Duration::from_millis(25));
        }
    }
}

fn http_client(timeout: Duration) -> Result<Client, OneDriveNativeError> {
    Client::builder()
        .redirect(Policy::none())
        .timeout(timeout)
        .build()
        .map_err(|_| OneDriveNativeError::network_failed())
}

async fn bounded_response_body(
    response: &mut reqwest::Response,
    max_bytes: usize,
) -> Result<Vec<u8>, OneDriveNativeError> {
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes as u64)
    {
        return Err(OneDriveNativeError::response_too_large());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| OneDriveNativeError::network_failed())?
    {
        if body.len().saturating_add(chunk.len()) > max_bytes {
            return Err(OneDriveNativeError::response_too_large());
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

fn validate_granted_scopes(value: Option<String>) -> Result<(), OneDriveNativeError> {
    let Some(value) = value else {
        return Err(OneDriveNativeError::scope_mismatch());
    };
    if value.is_empty()
        || value.len() > MAX_SCOPE_RESPONSE_BYTES
        || value.chars().any(char::is_control)
    {
        return Err(OneDriveNativeError::scope_mismatch());
    }
    let scopes = value.split_ascii_whitespace().collect::<HashSet<_>>();
    let graph_scope_count = usize::from(scopes.contains(MICROSOFT_GRAPH_SCOPE))
        + usize::from(scopes.contains(MICROSOFT_GRAPH_SCOPE_SHORT));
    let allowed = HashSet::from([
        "openid",
        "profile",
        "email",
        "offline_access",
        MICROSOFT_GRAPH_SCOPE,
        MICROSOFT_GRAPH_SCOPE_SHORT,
    ]);
    if graph_scope_count != 1 || scopes.iter().any(|scope| !allowed.contains(*scope)) {
        return Err(OneDriveNativeError::scope_mismatch());
    }
    Ok(())
}

fn parsed_token_response(body: &[u8]) -> Result<ValidatedTokenResponse, OneDriveNativeError> {
    let parsed: OAuthTokenResponse =
        serde_json::from_slice(body).map_err(|_| OneDriveNativeError::token_response_invalid())?;
    if !parsed
        .token_type
        .as_deref()
        .is_some_and(|value| value.eq_ignore_ascii_case("Bearer"))
    {
        return Err(OneDriveNativeError::token_response_invalid());
    }
    validate_granted_scopes(parsed.scope)?;
    let expires_in = parsed
        .expires_in
        .filter(|value| (1..=86_400).contains(value))
        .ok_or_else(OneDriveNativeError::token_response_invalid)?;
    let access_token = parsed
        .access_token
        .filter(|value| valid_token_text(value))
        .ok_or_else(OneDriveNativeError::token_response_invalid)?;
    let refresh_token = parsed
        .refresh_token
        .filter(|value| valid_token_text(value))
        .ok_or_else(OneDriveNativeError::token_response_invalid)?;
    Ok(ValidatedTokenResponse {
        access_token,
        refresh_token,
        expires_in,
    })
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
) -> OneDriveNativeError {
    if status == StatusCode::TOO_MANY_REQUESTS {
        return OneDriveNativeError::rate_limited(retry_after);
    }
    if status.is_server_error() {
        return OneDriveNativeError::network_failed();
    }
    let response = serde_json::from_slice::<OAuthErrorResponse>(body).ok();
    let redirect_mismatch = response
        .as_ref()
        .and_then(|value| value.error_codes.as_ref())
        .is_some_and(|codes| codes.len() <= 16 && codes.contains(&50011));
    if redirect_mismatch {
        return OneDriveNativeError::redirect_uri_mismatch();
    }
    match response.and_then(|value| value.error) {
        Some(error) if error.len() > 128 || error.chars().any(char::is_control) => {
            OneDriveNativeError::token_exchange_failed()
        }
        Some(error) => match error.as_str() {
            "invalid_client" | "unauthorized_client" => OneDriveNativeError::oauth_client_invalid(),
            "invalid_grant" | "interaction_required" | "consent_required" => {
                OneDriveNativeError::authorization_grant_invalid()
            }
            "invalid_scope" => OneDriveNativeError::scope_mismatch(),
            "invalid_request" => OneDriveNativeError::token_request_invalid(),
            "temporarily_unavailable" | "server_error" => OneDriveNativeError::network_failed(),
            _ => OneDriveNativeError::token_exchange_failed(),
        },
        None => OneDriveNativeError::token_exchange_failed(),
    }
}

async fn validate_token_exchange_response(
    response: &mut reqwest::Response,
) -> Result<(), OneDriveNativeError> {
    if response.status().is_success() {
        return Ok(());
    }
    let status = response.status();
    let retry_after = retry_after_ms(response.headers());
    let body = bounded_response_body(response, MAX_OAUTH_RESPONSE_BYTES).await?;
    Err(classified_token_exchange_error(status, &body, retry_after))
}

fn authorization_code_token_form(
    client_id: &str,
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> Vec<(&'static str, String)> {
    vec![
        ("client_id", client_id.to_owned()),
        ("code", code.to_owned()),
        ("code_verifier", verifier.to_owned()),
        ("grant_type", "authorization_code".to_owned()),
        ("redirect_uri", redirect_uri.to_owned()),
        ("scope", CANONICAL_SCOPES.join(" ")),
    ]
}

fn refresh_token_form(client_id: &str, refresh_token: &str) -> Vec<(&'static str, String)> {
    vec![
        ("client_id", client_id.to_owned()),
        ("refresh_token", refresh_token.to_owned()),
        ("grant_type", "refresh_token".to_owned()),
        ("scope", CANONICAL_SCOPES.join(" ")),
    ]
}

async fn exchange_authorization_code(
    client: &Client,
    client_id: &str,
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> Result<ValidatedTokenResponse, OneDriveNativeError> {
    let mut response = client
        .post(authority_url("token")?)
        .form(&authorization_code_token_form(
            client_id,
            code,
            verifier,
            redirect_uri,
        ))
        .send()
        .await
        .map_err(|_| OneDriveNativeError::network_failed())?;
    validate_token_exchange_response(&mut response).await?;
    let body = bounded_response_body(&mut response, MAX_OAUTH_RESPONSE_BYTES).await?;
    parsed_token_response(&body)
}

async fn refresh_access_token(
    client: &Client,
    client_id: &str,
    refresh_token: &str,
) -> Result<ValidatedTokenResponse, OneDriveNativeError> {
    let mut response = client
        .post(authority_url("token")?)
        .form(&refresh_token_form(client_id, refresh_token))
        .send()
        .await
        .map_err(|_| OneDriveNativeError::network_failed())?;
    validate_token_exchange_response(&mut response).await?;
    let body = bounded_response_body(&mut response, MAX_OAUTH_RESPONSE_BYTES).await?;
    parsed_token_response(&body)
}

fn bounded_display_text(value: Option<String>, maximum: usize) -> Option<String> {
    value.filter(|text| {
        !text.is_empty() && text.len() <= maximum && !text.chars().any(char::is_control)
    })
}

fn parsed_userinfo_response(
    body: &[u8],
    expected_subject: Option<&str>,
) -> Result<VerifiedUser, OneDriveNativeError> {
    let parsed: UserInfoResponse =
        serde_json::from_slice(body).map_err(|_| OneDriveNativeError::userinfo_failed())?;
    let subject = parsed
        .sub
        .ok_or_else(OneDriveNativeError::userinfo_failed)?;
    if subject.is_empty() || subject.len() > 256 || subject.chars().any(char::is_control) {
        return Err(OneDriveNativeError::userinfo_failed());
    }
    if expected_subject.is_some_and(|expected| expected != subject) {
        return Err(OneDriveNativeError::new(
            OneDriveNativeErrorCode::SubjectMismatch,
            "OneDrive authorization belongs to a different account",
        ));
    }
    Ok(VerifiedUser {
        subject,
        email: bounded_display_text(parsed.email, 320),
        name: bounded_display_text(parsed.name, 256),
    })
}

async fn verified_user(
    client: &Client,
    access_token: &str,
    expected_subject: Option<&str>,
) -> Result<VerifiedUser, OneDriveNativeError> {
    let mut response = client
        .get(MICROSOFT_USERINFO_URL)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|_| OneDriveNativeError::network_failed())?;
    if !response.status().is_success() {
        return Err(OneDriveNativeError::userinfo_failed());
    }
    let body = bounded_response_body(&mut response, MAX_OAUTH_RESPONSE_BYTES).await?;
    parsed_userinfo_response(&body, expected_subject)
}

fn cancelled_error(message: &'static str) -> OneDriveNativeError {
    OneDriveNativeError::new(OneDriveNativeErrorCode::Cancelled, message)
}

async fn authorize_inner(
    request: &OneDriveAuthorizeRequest,
    cancelled: Arc<AtomicBool>,
) -> Result<OneDriveAuthorizeResponse, OneDriveNativeError> {
    let client_id = configured_client_id()?;
    let timeout = oauth_timeout(request.timeout_ms)?;
    let listeners = bind_loopback_listeners()?;
    let redirect_uri = loopback_redirect_uri(listeners.port());
    let state = random_urlsafe(32);
    let (verifier, challenge) = pkce_pair();
    let url = authorization_url(client_id, &redirect_uri, &state, &challenge)?;
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|_| {
        OneDriveNativeError::new(
            OneDriveNativeErrorCode::BrowserOpenFailed,
            "The system browser could not be opened",
        )
    })?;
    let callback_cancelled = Arc::clone(&cancelled);
    let code = tauri::async_runtime::spawn_blocking(move || {
        wait_for_callback(listeners, state, callback_cancelled, timeout)
    })
    .await
    .map_err(|_| OneDriveNativeError::oauth_failed())??;
    if cancelled.load(Ordering::SeqCst) {
        return Err(cancelled_error("Microsoft authorization was cancelled"));
    }
    let client = http_client(timeout)?;
    let token =
        exchange_authorization_code(&client, client_id, &code, &verifier, &redirect_uri).await?;
    if cancelled.load(Ordering::SeqCst) {
        return Err(cancelled_error("Microsoft authorization was cancelled"));
    }
    let user = verified_user(&client, &token.access_token, None).await?;
    if cancelled.load(Ordering::SeqCst) {
        return Err(cancelled_error("Microsoft authorization was cancelled"));
    }
    Ok(OneDriveAuthorizeResponse {
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_in: token.expires_in,
        granted_scopes: CANONICAL_SCOPES.to_vec(),
        subject: user.subject,
        email: user.email,
        name: user.name,
    })
}

#[tauri::command]
pub async fn onedrive_oauth_authorize(
    request: OneDriveAuthorizeRequest,
    operations: tauri::State<'_, OneDriveOAuthOperations>,
) -> Result<OneDriveAuthorizeResponse, OneDriveNativeError> {
    let cancelled = operations.begin(&request.operation_id)?;
    let result = authorize_inner(&request, cancelled).await;
    operations.finish(&request.operation_id);
    result
}

#[tauri::command]
pub async fn onedrive_oauth_refresh(
    request: OneDriveRefreshRequest,
    operations: tauri::State<'_, OneDriveOAuthOperations>,
) -> Result<OneDriveRefreshResponse, OneDriveNativeError> {
    if !valid_token_text(&request.refresh_token)
        || request.expected_subject.is_empty()
        || request.expected_subject.len() > 256
        || request.expected_subject.chars().any(char::is_control)
    {
        return Err(OneDriveNativeError::invalid_request());
    }
    let client_id = configured_client_id()?;
    let timeout = oauth_timeout(request.timeout_ms)?;
    let cancelled = operations.begin(&request.operation_id)?;
    let result = async {
        let client = http_client(timeout)?;
        let token = refresh_access_token(&client, client_id, &request.refresh_token).await?;
        if cancelled.load(Ordering::SeqCst) {
            return Err(cancelled_error("Microsoft token refresh was cancelled"));
        }
        let user = verified_user(
            &client,
            &token.access_token,
            Some(&request.expected_subject),
        )
        .await?;
        if cancelled.load(Ordering::SeqCst) {
            return Err(cancelled_error("Microsoft token refresh was cancelled"));
        }
        Ok(OneDriveRefreshResponse {
            access_token: token.access_token,
            refresh_token: token.refresh_token,
            expires_in: token.expires_in,
            granted_scopes: CANONICAL_SCOPES.to_vec(),
            subject: user.subject,
            email: user.email,
            name: user.name,
        })
    }
    .await;
    operations.finish(&request.operation_id);
    result
}

#[tauri::command]
pub fn onedrive_oauth_cancel(
    operation_id: String,
    operations: tauri::State<'_, OneDriveOAuthOperations>,
) -> Result<bool, OneDriveNativeError> {
    operations.cancel(&operation_id)
}

// The Microsoft Graph returns upload and download URLs carrying bearer-like capability material.
// The renderer may use one only after this native module observed that exact URL in a bounded Graph
// response. Host suffix checks alone would allow exfiltration to an unrelated Microsoft tenant.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum OneDriveTransferKind {
    Api,
    UploadSession,
    Download,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct OneDriveTransferHeader {
    name: String,
    value: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OneDriveTransferRequest {
    kind: OneDriveTransferKind,
    url: String,
    method: String,
    #[serde(default)]
    headers: Vec<OneDriveTransferHeader>,
    body: Option<Vec<u8>>,
    max_response_bytes: usize,
    timeout_ms: Option<u64>,
}

#[derive(Serialize)]
pub struct OneDriveTransferResponse {
    status: u16,
    headers: Vec<OneDriveTransferHeader>,
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
pub struct OneDriveTransferAuthorizations(Mutex<HashMap<String, PreauthorizedUrl>>);

impl OneDriveTransferAuthorizations {
    fn register(&self, raw_url: &str, kind: PreauthorizedKind) -> Result<(), OneDriveNativeError> {
        let url = validate_preauthorized_url(raw_url, kind)?;
        let key = url.to_string();
        let now = Instant::now();
        let mut values = self
            .0
            .lock()
            .map_err(|_| OneDriveNativeError::oauth_failed())?;
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

    fn require(&self, raw_url: &str, kind: PreauthorizedKind) -> Result<Url, OneDriveNativeError> {
        let url = validate_preauthorized_url(raw_url, kind)?;
        let key = url.to_string();
        let now = Instant::now();
        let mut values = self
            .0
            .lock()
            .map_err(|_| OneDriveNativeError::oauth_failed())?;
        values.retain(|_, value| value.expires_at > now);
        values
            .get(&key)
            .filter(|value| value.kind == kind)
            .ok_or_else(OneDriveNativeError::invalid_request)?;
        Ok(url)
    }
}

fn valid_preauthorized_host(host: &str, kind: PreauthorizedKind) -> bool {
    match kind {
        PreauthorizedKind::Upload => {
            host.ends_with(".up.1drv.com") || host.ends_with(".sharepoint.com")
        }
        PreauthorizedKind::Download => {
            host.ends_with(".files.1drv.com")
                || host.ends_with(".sharepoint.com")
                || host.ends_with(".sharepoint-df.com")
        }
    }
}

fn validate_preauthorized_url(
    raw_url: &str,
    kind: PreauthorizedKind,
) -> Result<Url, OneDriveNativeError> {
    if raw_url.is_empty() || raw_url.len() > MAX_URL_LENGTH {
        return Err(OneDriveNativeError::invalid_request());
    }
    let url = Url::parse(raw_url).map_err(|_| OneDriveNativeError::invalid_request())?;
    let host = url
        .host_str()
        .ok_or_else(OneDriveNativeError::invalid_request)?
        .to_ascii_lowercase();
    if url.scheme() != "https"
        || !valid_preauthorized_host(&host, kind)
        || url.port().is_some_and(|port| port != 443)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.path().is_empty()
        || url.path() == "/"
    {
        return Err(OneDriveNativeError::invalid_request());
    }
    Ok(url)
}

fn validate_graph_url(raw_url: &str) -> Result<Url, OneDriveNativeError> {
    if raw_url.is_empty() || raw_url.len() > MAX_URL_LENGTH {
        return Err(OneDriveNativeError::invalid_request());
    }
    let url = Url::parse(raw_url).map_err(|_| OneDriveNativeError::invalid_request())?;
    if url.scheme() != "https"
        || url.host_str() != Some(MICROSOFT_GRAPH_ORIGIN)
        || url.port().is_some_and(|port| port != 443)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || !(url.path() == "/v1.0" || url.path().starts_with("/v1.0/"))
    {
        return Err(OneDriveNativeError::invalid_request());
    }
    let mut keys = HashSet::new();
    let query = url.query_pairs().collect::<Vec<_>>();
    if query.len() > 32
        || query.iter().any(|(key, value)| {
            key.len() > 128
                || value.len() > 4096
                || key.chars().any(char::is_control)
                || value.chars().any(char::is_control)
                || !keys.insert(key.as_ref())
                || matches!(key.as_ref(), "access_token" | "token")
        })
    {
        return Err(OneDriveNativeError::invalid_request());
    }
    Ok(url)
}

fn allowed_header(kind: OneDriveTransferKind, name: &str) -> bool {
    match kind {
        OneDriveTransferKind::Api => matches!(
            name,
            "authorization"
                | "accept"
                | "content-type"
                | "if-match"
                | "if-none-match"
                | "prefer"
                | "range"
        ),
        OneDriveTransferKind::UploadSession => matches!(
            name,
            "accept" | "content-type" | "content-length" | "content-range"
        ),
        OneDriveTransferKind::Download => matches!(name, "accept" | "range" | "if-range"),
    }
}

fn valid_byte_range(value: &str) -> Option<(u64, u64)> {
    let (start, end) = value.strip_prefix("bytes=")?.split_once('-')?;
    let start = start.parse::<u64>().ok()?;
    let end = end.parse::<u64>().ok()?;
    (start <= end).then_some((start, end))
}

fn valid_content_range(value: &str, body_length: usize) -> bool {
    let Some((range, total)) = value
        .strip_prefix("bytes ")
        .and_then(|value| value.split_once('/'))
    else {
        return false;
    };
    let Some((start, end)) = range.split_once('-') else {
        return false;
    };
    let (Ok(start), Ok(end), Ok(total)) = (
        start.parse::<u64>(),
        end.parse::<u64>(),
        total.parse::<u64>(),
    ) else {
        return false;
    };
    let Some(length) = end
        .checked_sub(start)
        .and_then(|value| value.checked_add(1))
    else {
        return false;
    };
    let alignment = 320 * 1024_u64;
    start % alignment == 0
        && end < total
        && length == body_length as u64
        && length <= MAX_TRANSFER_CHUNK_BYTES as u64
        && (length % alignment == 0 || end + 1 == total)
}

fn validated_headers(
    kind: OneDriveTransferKind,
    values: &[OneDriveTransferHeader],
) -> Result<HeaderMap, OneDriveNativeError> {
    if values.len() > MAX_HEADER_COUNT {
        return Err(OneDriveNativeError::invalid_request());
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
            return Err(OneDriveNativeError::invalid_request());
        }
        total_bytes = total_bytes
            .saturating_add(name_text.len())
            .saturating_add(value.value.len());
        if total_bytes > MAX_HEADER_BYTES {
            return Err(OneDriveNativeError::invalid_request());
        }
        let name = HeaderName::from_bytes(name_text.as_bytes())
            .map_err(|_| OneDriveNativeError::invalid_request())?;
        if headers.contains_key(&name) {
            return Err(OneDriveNativeError::invalid_request());
        }
        let header_value = HeaderValue::from_str(&value.value)
            .map_err(|_| OneDriveNativeError::invalid_request())?;
        headers.insert(name, header_value);
    }
    if kind == OneDriveTransferKind::Api {
        let authorization = headers
            .get("authorization")
            .and_then(|value| value.to_str().ok())
            .ok_or_else(OneDriveNativeError::invalid_request)?;
        let token = authorization
            .strip_prefix("Bearer ")
            .ok_or_else(OneDriveNativeError::invalid_request)?;
        if !valid_token_text(token) {
            return Err(OneDriveNativeError::invalid_request());
        }
    } else if headers.contains_key("authorization") {
        return Err(OneDriveNativeError::invalid_request());
    }
    Ok(headers)
}

fn transfer_method(kind: OneDriveTransferKind, value: &str) -> Result<Method, OneDriveNativeError> {
    let allowed = match kind {
        OneDriveTransferKind::Api => matches!(value, "GET" | "POST" | "PATCH" | "PUT" | "DELETE"),
        OneDriveTransferKind::UploadSession => matches!(value, "GET" | "PUT" | "POST" | "DELETE"),
        OneDriveTransferKind::Download => value == "GET",
    };
    if !allowed {
        return Err(OneDriveNativeError::invalid_request());
    }
    Method::from_bytes(value.as_bytes()).map_err(|_| OneDriveNativeError::invalid_request())
}

fn validate_transfer_limits(request: &OneDriveTransferRequest) -> Result<(), OneDriveNativeError> {
    let body_length = request.body.as_ref().map_or(0, Vec::len);
    let max_body = match request.kind {
        OneDriveTransferKind::Api => MAX_METADATA_BODY_BYTES,
        OneDriveTransferKind::UploadSession => MAX_TRANSFER_CHUNK_BYTES,
        OneDriveTransferKind::Download => 0,
    };
    if body_length > max_body
        || (matches!(request.method.as_str(), "GET" | "DELETE") && body_length > 0)
    {
        return Err(OneDriveNativeError::invalid_request());
    }
    let max_response = match request.kind {
        OneDriveTransferKind::Download => MAX_TRANSFER_CHUNK_BYTES,
        _ => MAX_METADATA_RESPONSE_BYTES,
    };
    if request.max_response_bytes == 0 || request.max_response_bytes > max_response {
        return Err(OneDriveNativeError::invalid_request());
    }
    Ok(())
}

fn validate_semantic_headers(
    request: &OneDriveTransferRequest,
    headers: &HeaderMap,
) -> Result<(), OneDriveNativeError> {
    if let Some(value) = headers.get("content-length") {
        let declared = value
            .to_str()
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .ok_or_else(OneDriveNativeError::invalid_request)?;
        if declared != request.body.as_ref().map_or(0, Vec::len) {
            return Err(OneDriveNativeError::invalid_request());
        }
    }
    match request.kind {
        OneDriveTransferKind::Download => {
            let range = headers
                .get("range")
                .and_then(|value| value.to_str().ok())
                .and_then(valid_byte_range)
                .ok_or_else(OneDriveNativeError::invalid_request)?;
            if range.1 - range.0 + 1 > MAX_TRANSFER_CHUNK_BYTES as u64 {
                return Err(OneDriveNativeError::invalid_request());
            }
        }
        OneDriveTransferKind::UploadSession if request.method == "PUT" => {
            let value = headers
                .get("content-range")
                .and_then(|value| value.to_str().ok())
                .ok_or_else(OneDriveNativeError::invalid_request)?;
            if !valid_content_range(value, request.body.as_ref().map_or(0, Vec::len)) {
                return Err(OneDriveNativeError::invalid_request());
            }
        }
        _ => {}
    }
    Ok(())
}

fn response_headers(
    headers: &HeaderMap,
) -> Result<Vec<OneDriveTransferHeader>, OneDriveNativeError> {
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
        "request-id",
        "client-request-id",
    ];
    let mut result = Vec::new();
    for name in ALLOWED {
        let Some(value) = headers.get(name) else {
            continue;
        };
        let value = value
            .to_str()
            .map_err(|_| OneDriveNativeError::oauth_failed())?;
        if value.len() > MAX_URL_LENGTH || value.chars().any(char::is_control) {
            return Err(OneDriveNativeError::oauth_failed());
        }
        result.push(OneDriveTransferHeader {
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
struct GraphCapabilityResponse {
    #[serde(rename = "uploadUrl")]
    upload_url: Option<String>,
    #[serde(rename = "@microsoft.graph.downloadUrl")]
    download_url: Option<String>,
}

fn register_graph_capabilities(
    authorizations: &OneDriveTransferAuthorizations,
    headers: &HeaderMap,
    body: &[u8],
) -> Result<(), OneDriveNativeError> {
    if let Some(location) = headers.get(LOCATION).and_then(|value| value.to_str().ok()) {
        if validate_preauthorized_url(location, PreauthorizedKind::Download).is_ok() {
            authorizations.register(location, PreauthorizedKind::Download)?;
        }
    }
    if body.is_empty() || !has_json_content_type(headers) {
        return Ok(());
    }
    let parsed: GraphCapabilityResponse = match serde_json::from_slice(body) {
        Ok(parsed) => parsed,
        Err(_) => return Ok(()),
    };
    if let Some(url) = parsed.upload_url {
        authorizations.register(&url, PreauthorizedKind::Upload)?;
    }
    if let Some(url) = parsed.download_url {
        authorizations.register(&url, PreauthorizedKind::Download)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn onedrive_transfer(
    request: OneDriveTransferRequest,
    authorizations: tauri::State<'_, OneDriveTransferAuthorizations>,
) -> Result<OneDriveTransferResponse, OneDriveNativeError> {
    validate_transfer_limits(&request)?;
    let method = transfer_method(request.kind, &request.method)?;
    let url = match request.kind {
        OneDriveTransferKind::Api => validate_graph_url(&request.url)?,
        OneDriveTransferKind::UploadSession => {
            authorizations.require(&request.url, PreauthorizedKind::Upload)?
        }
        OneDriveTransferKind::Download => {
            authorizations.require(&request.url, PreauthorizedKind::Download)?
        }
    };
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
        .map_err(|_| OneDriveNativeError::network_failed())?;
    let status = response.status().as_u16();
    let raw_headers = response.headers().clone();
    let result_headers = response_headers(&raw_headers)?;
    let body = bounded_response_body(&mut response, request.max_response_bytes).await?;
    if request.kind == OneDriveTransferKind::Api {
        register_graph_capabilities(authorizations.inner(), &raw_headers, &body)?;
    }
    Ok(OneDriveTransferResponse {
        status,
        headers: result_headers,
        body,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn error_code<T>(result: Result<T, OneDriveNativeError>) -> OneDriveNativeErrorCode {
        match result {
            Ok(_) => panic!("expected error"),
            Err(error) => error.code,
        }
    }

    #[test]
    fn client_id_and_authority_are_fixed() {
        assert!(valid_client_id("12345678-1234-1234-1234-123456789abc"));
        assert!(!valid_client_id("https://evil.example/client"));
        assert_eq!(
            authority_url("authorize").unwrap().as_str(),
            "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
        );
    }

    #[test]
    fn authorization_url_uses_exact_scopes_state_and_s256() {
        let redirect_uri = loopback_redirect_uri(43_210);
        let url = Url::parse(
            &authorization_url(
                "12345678-1234-1234-1234-123456789abc",
                &redirect_uri,
                "state",
                "challenge",
            )
            .unwrap(),
        )
        .unwrap();
        let query = url.query_pairs().collect::<HashMap<_, _>>();
        assert_eq!(url.host_str(), Some("login.microsoftonline.com"));
        assert_eq!(url.path(), "/common/oauth2/v2.0/authorize");
        assert_eq!(
            query.get("response_type").map(|value| value.as_ref()),
            Some("code")
        );
        assert_eq!(
            query.get("response_mode").map(|value| value.as_ref()),
            Some("query")
        );
        let scopes = CANONICAL_SCOPES.join(" ");
        assert_eq!(
            query.get("scope").map(|value| value.as_ref()),
            Some(scopes.as_str())
        );
        let requested_scopes = scopes.split_ascii_whitespace().collect::<HashSet<_>>();
        assert!(requested_scopes.contains("https://graph.microsoft.com/Files.ReadWrite.AppFolder"));
        assert!(!requested_scopes.contains("https://graph.microsoft.com/Files.ReadWrite"));
        assert!(!requested_scopes.contains("https://graph.microsoft.com/Files.ReadWrite.All"));
        assert_eq!(
            query
                .get("code_challenge_method")
                .map(|value| value.as_ref()),
            Some("S256")
        );
        assert_eq!(
            query.get("prompt").map(|value| value.as_ref()),
            Some("select_account")
        );
        assert_eq!(
            query.get("state").map(|value| value.as_ref()),
            Some("state")
        );
        assert_eq!(
            query.get("redirect_uri").map(|value| value.as_ref()),
            Some("http://localhost:43210/")
        );
    }

    #[test]
    fn localhost_callback_listens_on_every_available_loopback_family() {
        let listeners = bind_loopback_listeners().unwrap();
        assert_eq!(
            loopback_redirect_uri(listeners.port()),
            format!("http://localhost:{}/", listeners.port())
        );
        assert!(!listeners.listeners.is_empty());
        let ipv4_available = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).is_ok();
        let ipv6_available = TcpListener::bind((Ipv6Addr::LOCALHOST, 0)).is_ok();
        if ipv4_available && ipv6_available {
            assert!(listeners
                .listeners
                .iter()
                .any(|listener| listener.local_addr().unwrap().is_ipv4()));
            assert!(listeners
                .listeners
                .iter()
                .any(|listener| listener.local_addr().unwrap().is_ipv6()));
        }
        for listener in &listeners.listeners {
            let address = listener.local_addr().unwrap();
            assert!(address.ip().is_loopback());
            assert_eq!(address.port(), listeners.port());
            let client = TcpStream::connect(address).unwrap();
            let (accepted, peer) = listener.accept().unwrap();
            assert!(peer.ip().is_loopback());
            drop((accepted, client));
        }
    }

    #[test]
    fn token_forms_never_contain_a_client_secret() {
        let exchange = authorization_code_token_form(
            "12345678-1234-1234-1234-123456789abc",
            "code",
            "verifier",
            "http://127.0.0.1:43210/",
        );
        let refresh = refresh_token_form("12345678-1234-1234-1234-123456789abc", "refresh-token");
        assert!(exchange.iter().all(|(key, _)| *key != "client_secret"));
        assert!(refresh.iter().all(|(key, _)| *key != "client_secret"));
        for form in [&exchange, &refresh] {
            let scopes = form
                .iter()
                .find_map(|(key, value)| (*key == "scope").then_some(value.as_str()))
                .unwrap()
                .split_ascii_whitespace()
                .collect::<HashSet<_>>();
            assert!(scopes.contains(MICROSOFT_GRAPH_SCOPE));
            assert!(!scopes.contains("https://graph.microsoft.com/Files.ReadWrite"));
            assert!(!scopes.contains("https://graph.microsoft.com/Files.ReadWrite.All"));
        }
    }

    #[test]
    fn token_response_requires_rotated_refresh_token_and_exact_app_folder_scope() {
        let valid = br#"{"access_token":"access","refresh_token":"refresh","expires_in":3600,"token_type":"Bearer","scope":"openid profile email Files.ReadWrite.AppFolder"}"#;
        assert_eq!(
            parsed_token_response(valid).unwrap().refresh_token,
            "refresh"
        );
        for body in [
            br#"{"access_token":"access","expires_in":3600,"token_type":"Bearer","scope":"Files.ReadWrite.AppFolder"}"#.as_slice(),
            br#"{"access_token":"access","refresh_token":"refresh","expires_in":3600,"token_type":"Bearer","scope":"Files.ReadWrite"}"#.as_slice(),
            br#"{"access_token":"access","refresh_token":"refresh","expires_in":3600,"token_type":"Bearer","scope":"https://graph.microsoft.com/Files.ReadWrite"}"#.as_slice(),
            br#"{"access_token":"access","refresh_token":"refresh","expires_in":3600,"token_type":"Bearer","scope":"Files.ReadWrite.AppFolder Files.ReadWrite.All"}"#.as_slice(),
            br#"{"access_token":"access","refresh_token":"refresh","expires_in":3600,"token_type":"Bearer","scope":"Files.ReadWrite.All"}"#.as_slice(),
        ] {
            assert!(parsed_token_response(body).is_err());
        }
    }

    #[test]
    fn pkce_and_callback_are_one_time_and_bounded() {
        let (verifier, challenge) = pkce_pair();
        assert!((43..=128).contains(&verifier.len()));
        assert_eq!(
            challenge,
            URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
        );

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
                "GET /?code=again&state=expected HTTP/1.1\r\n\r\n",
                &mut state
            ),
            CallbackDecision::Failed(_)
        ));
    }

    #[test]
    fn microsoft_errors_are_static_and_semantically_classified() {
        assert_eq!(
            classified_token_exchange_error(
                StatusCode::BAD_REQUEST,
                br#"{"error":"invalid_grant","error_description":"secret detail"}"#,
                None,
            )
            .code,
            OneDriveNativeErrorCode::AuthorizationGrantInvalid
        );
        assert_eq!(
            classified_token_exchange_error(
                StatusCode::BAD_REQUEST,
                br#"{"error":"invalid_request","error_codes":[50011]}"#,
                None,
            )
            .code,
            OneDriveNativeErrorCode::RedirectUriMismatch
        );
        let serialized = serde_json::to_string(&classified_token_exchange_error(
            StatusCode::BAD_REQUEST,
            br#"{"error":"invalid_grant","error_description":"secret detail"}"#,
            None,
        ))
        .unwrap();
        assert!(!serialized.contains("secret detail"));
    }

    #[test]
    fn userinfo_subject_is_the_only_account_identity() {
        let user = parsed_userinfo_response(
            br#"{"sub":"subject","email":"test@example.com","name":"Test"}"#,
            Some("subject"),
        )
        .unwrap();
        assert_eq!(user.subject, "subject");
        assert_eq!(
            error_code(parsed_userinfo_response(
                br#"{"sub":"other"}"#,
                Some("subject")
            )),
            OneDriveNativeErrorCode::SubjectMismatch
        );
    }

    #[test]
    fn graph_api_and_preauthorized_hosts_fail_closed() {
        assert!(validate_graph_url("https://graph.microsoft.com/v1.0/me/drive").is_ok());
        assert!(validate_graph_url("https://graph.microsoft.com/beta/me/drive").is_err());
        assert!(validate_graph_url("https://evil.example/v1.0/me/drive").is_err());
        assert!(validate_preauthorized_url(
            "https://sn3302.up.1drv.com/up/capability",
            PreauthorizedKind::Upload
        )
        .is_ok());
        assert!(validate_preauthorized_url(
            "https://b0mpua-by3301.files.1drv.com/capability",
            PreauthorizedKind::Download
        )
        .is_ok());
        assert!(validate_preauthorized_url(
            "https://evil.example/capability",
            PreauthorizedKind::Download
        )
        .is_err());
    }

    #[test]
    fn preauthorized_urls_require_exact_graph_observation() {
        let authorizations = OneDriveTransferAuthorizations::default();
        let upload = "https://sn3302.up.1drv.com/up/exact-capability";
        assert!(authorizations
            .require(upload, PreauthorizedKind::Upload)
            .is_err());
        let headers =
            HeaderMap::from_iter([(CONTENT_TYPE, HeaderValue::from_static("application/json"))]);
        register_graph_capabilities(
            &authorizations,
            &headers,
            br#"{"uploadUrl":"https://sn3302.up.1drv.com/up/exact-capability"}"#,
        )
        .unwrap();
        assert!(authorizations
            .require(upload, PreauthorizedKind::Upload)
            .is_ok());
        assert!(authorizations
            .require(
                "https://sn3302.up.1drv.com/up/other-capability",
                PreauthorizedKind::Upload
            )
            .is_err());
    }

    #[test]
    fn transfer_headers_reject_bearer_tokens_on_preauthorized_urls() {
        assert_eq!(MAX_TRANSFER_CHUNK_BYTES, 10 * 1024 * 1024);
        let bearer = vec![OneDriveTransferHeader {
            name: "authorization".to_owned(),
            value: "Bearer token".to_owned(),
        }];
        assert!(validated_headers(OneDriveTransferKind::Api, &bearer).is_ok());
        assert!(validated_headers(OneDriveTransferKind::UploadSession, &bearer).is_err());
        assert!(validated_headers(OneDriveTransferKind::Download, &bearer).is_err());
    }
}
