use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue, CONTENT_TYPE, LOCATION, RETRY_AFTER},
    redirect::Policy,
    Client, Method, StatusCode, Url,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use zeroize::Zeroizing;

const BAIDU_DEVICE_CODE_URL: &str = "https://openapi.baidu.com/oauth/2.0/device/code";
const BAIDU_TOKEN_URL: &str = "https://openapi.baidu.com/oauth/2.0/token";
const BAIDU_USERINFO_URL: &str = "https://pan.baidu.com/rest/2.0/xpan/nas";
const BAIDU_API_HOST: &str = "pan.baidu.com";
const BAIDU_LOCATE_HOST: &str = "d.pcs.baidu.com";
const BAIDU_APP_ROOT: &str = "/apps/OpenPencil";
const BAIDU_LOCATE_APP_ID: &str = "250528";
const CANONICAL_SCOPES: [&str; 2] = ["basic", "netdisk"];
const COMPILED_BAIDU_APP_KEY: Option<&str> = option_env!("VITE_BAIDU_NETDISK_APP_KEY");
const COMPILED_BAIDU_BROKER_ORIGIN: Option<&str> =
    option_env!("OPENPENCIL_BAIDU_NETDISK_OAUTH_BROKER_ORIGIN");

const BROKER_DEVICE_CODE_PATH: &str = "/v1/baidu-netdisk/oauth/device-code";
const BROKER_DEVICE_TOKEN_PATH: &str = "/v1/baidu-netdisk/oauth/device-token";
const BROKER_REFRESH_PATH: &str = "/v1/baidu-netdisk/oauth/refresh";
const BROKER_PROTOCOL_VERSION: u8 = 1;

const DEFAULT_OAUTH_TIMEOUT_MS: u64 = 300_000;
const MIN_OAUTH_TIMEOUT_MS: u64 = 10_000;
const MAX_OAUTH_TIMEOUT_MS: u64 = 600_000;
const DEFAULT_TRANSFER_TIMEOUT_MS: u64 = 120_000;
const MAX_TRANSFER_TIMEOUT_MS: u64 = 120_000;
const MAX_OAUTH_RESPONSE_BYTES: usize = 64 * 1024;
const MAX_TOKEN_BYTES: usize = 12 * 1024;
const MAX_SCOPE_RESPONSE_BYTES: usize = 4 * 1024;
const MAX_DEVICE_CODE_BYTES: usize = 4 * 1024;
const MAX_USER_CODE_BYTES: usize = 256;
const MAX_ACCOUNT_NAME_BYTES: usize = 256;
const MAX_CONCURRENT_OAUTH_OPERATIONS: usize = 8;
const MAX_URL_BYTES: usize = 16 * 1024;
const MAX_HEADER_COUNT: usize = 16;
const MAX_HEADER_BYTES: usize = 32 * 1024;
const MAX_METADATA_BODY_BYTES: usize = 2 * 1024 * 1024;
const MAX_METADATA_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const MAX_DOCUMENT_BYTES: u64 = 512 * 1024 * 1024;
const UPLOAD_CHUNK_BYTES: u64 = 4 * 1024 * 1024;
const MAX_UPLOAD_BODY_BYTES: usize = 4 * 1024 * 1024 + 256 * 1024;
const MAX_DOWNLOAD_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
const MAX_UPLOAD_PARTS: u64 = MAX_DOCUMENT_BYTES / UPLOAD_CHUNK_BYTES;
const MAX_PREAUTHORIZED_URLS: usize = 256;
const UPLOAD_CAPABILITY_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const DOWNLOAD_CAPABILITY_TTL: Duration = Duration::from_secs(60 * 60);
const REDIRECT_CAPABILITY_TTL: Duration = Duration::from_secs(10 * 60);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum BaiduNetdiskNativeErrorCode {
    InvalidRequest,
    Unsupported,
    Cancelled,
    Timeout,
    BrowserOpenFailed,
    OauthDenied,
    OauthFailed,
    OauthClientInvalid,
    AuthorizationGrantInvalid,
    DeviceCodeExpired,
    TokenRequestInvalid,
    TokenExchangeFailed,
    TokenResponseInvalid,
    UserinfoFailed,
    ScopeMismatch,
    AccountMismatch,
    BrokerUnavailable,
    NetworkFailed,
    ResponseTooLarge,
    RateLimited,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BaiduNetdiskNativeError {
    code: BaiduNetdiskNativeErrorCode,
    message: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    retry_after_ms: Option<u64>,
}

impl BaiduNetdiskNativeError {
    fn new(code: BaiduNetdiskNativeErrorCode, message: &'static str) -> Self {
        Self {
            code,
            message,
            retry_after_ms: None,
        }
    }

    fn invalid_request() -> Self {
        Self::new(
            BaiduNetdiskNativeErrorCode::InvalidRequest,
            "Baidu Netdisk request is invalid",
        )
    }

    fn unsupported() -> Self {
        Self::new(
            BaiduNetdiskNativeErrorCode::Unsupported,
            "Baidu Netdisk authorization is unavailable in this build",
        )
    }

    fn oauth_failed() -> Self {
        Self::new(
            BaiduNetdiskNativeErrorCode::OauthFailed,
            "Baidu authorization failed",
        )
    }

    fn oauth_client_invalid() -> Self {
        Self::new(
            BaiduNetdiskNativeErrorCode::OauthClientInvalid,
            "Baidu OAuth application credentials are invalid",
        )
    }

    fn authorization_grant_invalid() -> Self {
        Self::new(
            BaiduNetdiskNativeErrorCode::AuthorizationGrantInvalid,
            "Baidu authorization grant is invalid",
        )
    }

    fn token_request_invalid() -> Self {
        Self::new(
            BaiduNetdiskNativeErrorCode::TokenRequestInvalid,
            "Baidu token request is invalid",
        )
    }

    fn token_exchange_failed() -> Self {
        Self::new(
            BaiduNetdiskNativeErrorCode::TokenExchangeFailed,
            "Baidu token exchange failed",
        )
    }

    fn token_response_invalid() -> Self {
        Self::new(
            BaiduNetdiskNativeErrorCode::TokenResponseInvalid,
            "Baidu returned an invalid token response",
        )
    }

    fn userinfo_failed() -> Self {
        Self::new(
            BaiduNetdiskNativeErrorCode::UserinfoFailed,
            "Baidu Netdisk account information could not be verified",
        )
    }

    fn scope_mismatch() -> Self {
        Self::new(
            BaiduNetdiskNativeErrorCode::ScopeMismatch,
            "Baidu did not grant the required Netdisk scopes",
        )
    }

    fn account_mismatch() -> Self {
        Self::new(
            BaiduNetdiskNativeErrorCode::AccountMismatch,
            "Baidu authorization belongs to a different account",
        )
    }

    fn broker_unavailable() -> Self {
        Self::new(
            BaiduNetdiskNativeErrorCode::BrokerUnavailable,
            "The OpenPencil Baidu OAuth Broker is unavailable",
        )
    }

    fn network_failed() -> Self {
        Self::new(
            BaiduNetdiskNativeErrorCode::NetworkFailed,
            "Baidu Netdisk network request failed",
        )
    }

    fn response_too_large() -> Self {
        Self::new(
            BaiduNetdiskNativeErrorCode::ResponseTooLarge,
            "Baidu Netdisk response exceeded the byte limit",
        )
    }

    fn rate_limited(retry_after_ms: Option<u64>) -> Self {
        Self {
            code: BaiduNetdiskNativeErrorCode::RateLimited,
            message: "Baidu Netdisk temporarily rate limited the request",
            retry_after_ms,
        }
    }
}

#[derive(Default)]
pub struct BaiduNetdiskOAuthOperations(Mutex<HashMap<String, Arc<AtomicBool>>>);

impl BaiduNetdiskOAuthOperations {
    fn begin(&self, operation_id: &str) -> Result<Arc<AtomicBool>, BaiduNetdiskNativeError> {
        if !valid_operation_id(operation_id) {
            return Err(BaiduNetdiskNativeError::invalid_request());
        }
        let mut operations = self
            .0
            .lock()
            .map_err(|_| BaiduNetdiskNativeError::oauth_failed())?;
        if operations.contains_key(operation_id)
            || operations.len() >= MAX_CONCURRENT_OAUTH_OPERATIONS
        {
            return Err(BaiduNetdiskNativeError::invalid_request());
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

    fn cancel(&self, operation_id: &str) -> Result<bool, BaiduNetdiskNativeError> {
        if !valid_operation_id(operation_id) {
            return Err(BaiduNetdiskNativeError::invalid_request());
        }
        let operations = self
            .0
            .lock()
            .map_err(|_| BaiduNetdiskNativeError::oauth_failed())?;
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

/// User-provided SecretKey. It is non-debuggable and zeroized from deserialization onward.
pub struct BaiduNetdiskSecretKey(Zeroizing<String>);

impl BaiduNetdiskSecretKey {
    fn expose(&self) -> &str {
        self.0.as_str()
    }
}

impl<'de> Deserialize<'de> for BaiduNetdiskSecretKey {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        String::deserialize(deserializer).map(|value| Self(Zeroizing::new(value)))
    }
}

#[derive(Deserialize)]
#[serde(tag = "mode", rename_all = "kebab-case", deny_unknown_fields)]
pub enum BaiduNetdiskOAuthClient {
    PublisherBroker {},
    SelfHosted {
        #[serde(rename = "appKey")]
        app_key: String,
        #[serde(rename = "secretKey")]
        secret_key: BaiduNetdiskSecretKey,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BaiduNetdiskAuthorizeRequest {
    operation_id: String,
    oauth_client: BaiduNetdiskOAuthClient,
    timeout_ms: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BaiduNetdiskRefreshRequest {
    operation_id: String,
    oauth_client: BaiduNetdiskOAuthClient,
    refresh_token: String,
    expected_uk: String,
    timeout_ms: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BaiduNetdiskTokenResponse {
    access_token: String,
    refresh_token: String,
    expires_in: u64,
    granted_scopes: Vec<&'static str>,
    uk: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    baidu_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    netdisk_name: Option<String>,
}

enum ResolvedOAuthClient {
    PublisherBroker {
        broker_origin: Url,
    },
    SelfHosted {
        app_key: String,
        secret_key: BaiduNetdiskSecretKey,
    },
}

fn valid_app_key(value: &str) -> bool {
    (8..=128).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn valid_secret_key(value: &str) -> bool {
    (8..=4 * 1024).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_graphic() && !byte.is_ascii_whitespace())
}

fn exact_https_origin(value: &str) -> Result<Url, BaiduNetdiskNativeError> {
    let url = Url::parse(value).map_err(|_| BaiduNetdiskNativeError::oauth_client_invalid())?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || url.port().is_some_and(|port| port != 443)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(BaiduNetdiskNativeError::oauth_client_invalid());
    }
    Ok(url)
}

fn resolved_oauth_client(
    client: BaiduNetdiskOAuthClient,
) -> Result<ResolvedOAuthClient, BaiduNetdiskNativeError> {
    match client {
        BaiduNetdiskOAuthClient::PublisherBroker {} => {
            let app_key = COMPILED_BAIDU_APP_KEY
                .filter(|value| valid_app_key(value))
                .ok_or_else(BaiduNetdiskNativeError::unsupported)?;
            let broker_origin = COMPILED_BAIDU_BROKER_ORIGIN
                .ok_or_else(BaiduNetdiskNativeError::unsupported)
                .and_then(exact_https_origin)?;
            let _publisher_identity = app_key;
            Ok(ResolvedOAuthClient::PublisherBroker { broker_origin })
        }
        BaiduNetdiskOAuthClient::SelfHosted {
            app_key,
            secret_key,
        } => {
            if !valid_app_key(&app_key) || !valid_secret_key(secret_key.expose()) {
                return Err(BaiduNetdiskNativeError::oauth_client_invalid());
            }
            Ok(ResolvedOAuthClient::SelfHosted {
                app_key,
                secret_key,
            })
        }
    }
}

fn oauth_timeout(value: Option<u64>) -> Result<Duration, BaiduNetdiskNativeError> {
    let milliseconds = value.unwrap_or(DEFAULT_OAUTH_TIMEOUT_MS);
    if !(MIN_OAUTH_TIMEOUT_MS..=MAX_OAUTH_TIMEOUT_MS).contains(&milliseconds) {
        return Err(BaiduNetdiskNativeError::invalid_request());
    }
    Ok(Duration::from_millis(milliseconds))
}

fn transfer_timeout(value: Option<u64>) -> Result<Duration, BaiduNetdiskNativeError> {
    let milliseconds = value.unwrap_or(DEFAULT_TRANSFER_TIMEOUT_MS);
    if !(1_000..=MAX_TRANSFER_TIMEOUT_MS).contains(&milliseconds) {
        return Err(BaiduNetdiskNativeError::invalid_request());
    }
    Ok(Duration::from_millis(milliseconds))
}

fn http_client(timeout: Duration) -> Result<Client, BaiduNetdiskNativeError> {
    Client::builder()
        .redirect(Policy::none())
        .timeout(timeout)
        .build()
        .map_err(|_| BaiduNetdiskNativeError::network_failed())
}

async fn bounded_response_body(
    response: &mut reqwest::Response,
    max_bytes: usize,
) -> Result<Vec<u8>, BaiduNetdiskNativeError> {
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes as u64)
    {
        return Err(BaiduNetdiskNativeError::response_too_large());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| BaiduNetdiskNativeError::network_failed())?
    {
        if body.len().saturating_add(chunk.len()) > max_bytes {
            return Err(BaiduNetdiskNativeError::response_too_large());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn retry_after_ms(headers: &HeaderMap) -> Option<u64> {
    headers
        .get(RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .and_then(|seconds| seconds.checked_mul(1_000))
        .map(|milliseconds| milliseconds.min(300_000))
}

fn valid_token_text(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_TOKEN_BYTES
        && value.trim() == value
        && !value.chars().any(char::is_whitespace)
        && !value.chars().any(char::is_control)
}

fn valid_decimal(value: &str, maximum: usize) -> bool {
    !value.is_empty()
        && value.len() <= maximum
        && (value == "0"
            || (value.as_bytes()[0] != b'0' && value.bytes().all(|byte| byte.is_ascii_digit())))
}

fn valid_app_path(value: &str) -> bool {
    value.starts_with(&format!("{BAIDU_APP_ROOT}/"))
        && value.len() <= 4_096
        && !value.chars().any(char::is_control)
        && !value
            .split('/')
            .any(|segment| matches!(segment, "." | ".."))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BrokerProtocolRequest {
    protocol_version: u8,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BrokerDeviceTokenRequest<'a> {
    protocol_version: u8,
    device_code: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BrokerRefreshRequest<'a> {
    protocol_version: u8,
    refresh_token: &'a str,
}

#[derive(Deserialize)]
struct DeviceCodeWire {
    device_code: Option<String>,
    user_code: Option<String>,
    verification_url: Option<String>,
    qrcode_url: Option<String>,
    expires_in: Option<u64>,
    interval: Option<u64>,
}

struct ValidatedDeviceCode {
    device_code: String,
    user_code: String,
    verification_url: Url,
    qrcode_url: Url,
    expires_in: Duration,
    interval: Duration,
}

#[derive(Deserialize)]
struct TokenWire {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    scope: Option<String>,
    token_type: Option<String>,
}

struct ValidatedToken {
    access_token: String,
    refresh_token: String,
    expires_in: u64,
}

#[derive(Deserialize)]
struct OAuthErrorWire {
    error: Option<String>,
}

enum PollDisposition {
    Pending,
    SlowDown,
    Token(ValidatedToken),
}

fn broker_url(origin: &Url, path: &str) -> Result<Url, BaiduNetdiskNativeError> {
    if !matches!(
        path,
        BROKER_DEVICE_CODE_PATH | BROKER_DEVICE_TOKEN_PATH | BROKER_REFRESH_PATH
    ) {
        return Err(BaiduNetdiskNativeError::invalid_request());
    }
    let raw = format!("{}{}", origin.as_str().trim_end_matches('/'), path);
    let url = Url::parse(&raw).map_err(|_| BaiduNetdiskNativeError::broker_unavailable())?;
    if url.origin() != origin.origin()
        || url.path() != path
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(BaiduNetdiskNativeError::broker_unavailable());
    }
    Ok(url)
}

fn broker_json_body(value: &impl Serialize) -> Result<Vec<u8>, BaiduNetdiskNativeError> {
    serde_json::to_vec(value).map_err(|_| BaiduNetdiskNativeError::broker_unavailable())
}

fn self_hosted_device_code_form(app_key: &str) -> Vec<(&'static str, String)> {
    vec![
        ("response_type", "device_code".to_owned()),
        ("client_id", app_key.to_owned()),
        ("scope", CANONICAL_SCOPES.join(",")),
    ]
}

fn self_hosted_device_token_form<'a>(
    app_key: &'a str,
    secret_key: &'a str,
    device_code: &'a str,
) -> [(&'static str, &'a str); 4] {
    [
        ("grant_type", "device_token"),
        ("code", device_code),
        ("client_id", app_key),
        ("client_secret", secret_key),
    ]
}

fn self_hosted_refresh_form<'a>(
    app_key: &'a str,
    secret_key: &'a str,
    refresh_token: &'a str,
) -> [(&'static str, &'a str); 5] {
    [
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
        ("client_id", app_key),
        ("client_secret", secret_key),
        ("scope", "basic,netdisk"),
    ]
}

fn trusted_device_url(value: &str) -> Result<Url, BaiduNetdiskNativeError> {
    if value.is_empty() || value.len() > MAX_URL_BYTES {
        return Err(BaiduNetdiskNativeError::token_response_invalid());
    }
    let url = Url::parse(value).map_err(|_| BaiduNetdiskNativeError::token_response_invalid())?;
    if url.scheme() != "https"
        || url.host_str() != Some("openapi.baidu.com")
        || url.port().is_some_and(|port| port != 443)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.path().is_empty()
        || url.path() == "/"
    {
        return Err(BaiduNetdiskNativeError::token_response_invalid());
    }
    Ok(url)
}

fn bounded_noncontrol(value: Option<String>, maximum: usize) -> Option<String> {
    value.filter(|text| {
        !text.is_empty()
            && text.len() <= maximum
            && text.trim() == text
            && !text.chars().any(char::is_control)
    })
}

fn parsed_device_code(body: &[u8]) -> Result<ValidatedDeviceCode, BaiduNetdiskNativeError> {
    let parsed: DeviceCodeWire = serde_json::from_slice(body)
        .map_err(|_| BaiduNetdiskNativeError::token_response_invalid())?;
    let device_code = parsed
        .device_code
        .filter(|value| valid_token_text(value) && value.len() <= MAX_DEVICE_CODE_BYTES)
        .ok_or_else(BaiduNetdiskNativeError::token_response_invalid)?;
    let user_code = bounded_noncontrol(parsed.user_code, MAX_USER_CODE_BYTES)
        .ok_or_else(BaiduNetdiskNativeError::token_response_invalid)?;
    let verification_url = parsed
        .verification_url
        .as_deref()
        .ok_or_else(BaiduNetdiskNativeError::token_response_invalid)
        .and_then(trusted_device_url)?;
    // The renderer command is intentionally waiting-only. Opening a bare verification URL would
    // strand the user without the code, so the provider-issued QR URL is mandatory.
    let qrcode_url = parsed
        .qrcode_url
        .as_deref()
        .ok_or_else(BaiduNetdiskNativeError::token_response_invalid)
        .and_then(trusted_device_url)?;
    let expires_in = parsed
        .expires_in
        .filter(|value| (30..=3_600).contains(value))
        .ok_or_else(BaiduNetdiskNativeError::token_response_invalid)?;
    let interval = parsed
        .interval
        .filter(|value| (1..=60).contains(value))
        .ok_or_else(BaiduNetdiskNativeError::token_response_invalid)?;
    Ok(ValidatedDeviceCode {
        device_code,
        user_code,
        verification_url,
        qrcode_url,
        expires_in: Duration::from_secs(expires_in),
        interval: Duration::from_secs(interval),
    })
}

fn exact_scopes(value: &str) -> bool {
    if value.is_empty()
        || value.len() > MAX_SCOPE_RESPONSE_BYTES
        || value.chars().any(char::is_control)
    {
        return false;
    }
    let scopes = value
        .split(|character: char| character == ',' || character.is_ascii_whitespace())
        .filter(|scope| !scope.is_empty())
        .collect::<HashSet<_>>();
    scopes == HashSet::from(CANONICAL_SCOPES)
}

fn parsed_token_response(
    body: &[u8],
    previous_refresh_token: Option<&str>,
) -> Result<ValidatedToken, BaiduNetdiskNativeError> {
    let parsed: TokenWire = serde_json::from_slice(body)
        .map_err(|_| BaiduNetdiskNativeError::token_response_invalid())?;
    if parsed
        .token_type
        .as_deref()
        .is_some_and(|value| !value.eq_ignore_ascii_case("Bearer"))
    {
        return Err(BaiduNetdiskNativeError::token_response_invalid());
    }
    if !parsed.scope.as_deref().is_some_and(exact_scopes) {
        return Err(BaiduNetdiskNativeError::scope_mismatch());
    }
    let access_token = parsed
        .access_token
        .filter(|value| valid_token_text(value))
        .ok_or_else(BaiduNetdiskNativeError::token_response_invalid)?;
    let refresh_token = parsed
        .refresh_token
        .filter(|value| valid_token_text(value))
        .ok_or_else(BaiduNetdiskNativeError::token_response_invalid)?;
    if previous_refresh_token.is_some_and(|previous| previous == refresh_token) {
        return Err(BaiduNetdiskNativeError::token_response_invalid());
    }
    let expires_in = parsed
        .expires_in
        .filter(|value| (1..=31_536_000).contains(value))
        .ok_or_else(BaiduNetdiskNativeError::token_response_invalid)?;
    Ok(ValidatedToken {
        access_token,
        refresh_token,
        expires_in,
    })
}

fn oauth_error_name(body: &[u8]) -> Option<String> {
    serde_json::from_slice::<OAuthErrorWire>(body)
        .ok()
        .and_then(|value| value.error)
        .filter(|value| {
            !value.is_empty() && value.len() <= 128 && !value.chars().any(char::is_control)
        })
}

fn classified_oauth_error(
    status: StatusCode,
    body: &[u8],
    retry_after: Option<u64>,
    broker: bool,
) -> BaiduNetdiskNativeError {
    if status == StatusCode::TOO_MANY_REQUESTS {
        return BaiduNetdiskNativeError::rate_limited(retry_after);
    }
    let error = oauth_error_name(body);
    match error.as_deref() {
        Some("access_denied") | Some("authorization_declined") => BaiduNetdiskNativeError::new(
            BaiduNetdiskNativeErrorCode::OauthDenied,
            "Baidu authorization was denied",
        ),
        Some("expired_token") | Some("device_code_expired") => BaiduNetdiskNativeError::new(
            BaiduNetdiskNativeErrorCode::DeviceCodeExpired,
            "Baidu device authorization expired",
        ),
        Some("invalid_client") | Some("unauthorized_client") => {
            BaiduNetdiskNativeError::oauth_client_invalid()
        }
        Some("invalid_grant") => BaiduNetdiskNativeError::authorization_grant_invalid(),
        Some("invalid_scope") => BaiduNetdiskNativeError::scope_mismatch(),
        Some("invalid_request") => BaiduNetdiskNativeError::token_request_invalid(),
        Some("temporarily_unavailable") | Some("server_error") => {
            if broker {
                BaiduNetdiskNativeError::broker_unavailable()
            } else {
                BaiduNetdiskNativeError::network_failed()
            }
        }
        _ if broker || status.is_server_error() => BaiduNetdiskNativeError::broker_unavailable(),
        _ => BaiduNetdiskNativeError::token_exchange_failed(),
    }
}

fn poll_disposition(
    status: StatusCode,
    body: &[u8],
    retry_after: Option<u64>,
    broker: bool,
) -> Result<PollDisposition, BaiduNetdiskNativeError> {
    if status.is_success() {
        return parsed_token_response(body, None).map(PollDisposition::Token);
    }
    match oauth_error_name(body).as_deref() {
        Some("authorization_pending") => Ok(PollDisposition::Pending),
        Some("slow_down") => Ok(PollDisposition::SlowDown),
        _ => Err(classified_oauth_error(status, body, retry_after, broker)),
    }
}

async fn request_device_code(
    client: &Client,
    oauth_client: &ResolvedOAuthClient,
) -> Result<ValidatedDeviceCode, BaiduNetdiskNativeError> {
    let (mut response, broker) = match oauth_client {
        ResolvedOAuthClient::PublisherBroker { broker_origin } => (
            client
                .post(broker_url(broker_origin, BROKER_DEVICE_CODE_PATH)?)
                .header(CONTENT_TYPE, "application/json")
                .body(broker_json_body(&BrokerProtocolRequest {
                    protocol_version: BROKER_PROTOCOL_VERSION,
                })?)
                .send()
                .await
                .map_err(|_| BaiduNetdiskNativeError::broker_unavailable())?,
            true,
        ),
        ResolvedOAuthClient::SelfHosted { app_key, .. } => (
            client
                .post(BAIDU_DEVICE_CODE_URL)
                .form(&self_hosted_device_code_form(app_key))
                .send()
                .await
                .map_err(|_| BaiduNetdiskNativeError::network_failed())?,
            false,
        ),
    };
    let status = response.status();
    let retry_after = retry_after_ms(response.headers());
    let body = bounded_response_body(&mut response, MAX_OAUTH_RESPONSE_BYTES).await?;
    if !status.is_success() {
        return Err(classified_oauth_error(status, &body, retry_after, broker));
    }
    parsed_device_code(&body)
}

async fn request_device_token(
    client: &Client,
    oauth_client: &ResolvedOAuthClient,
    device_code: &str,
) -> Result<PollDisposition, BaiduNetdiskNativeError> {
    let (mut response, broker) = match oauth_client {
        ResolvedOAuthClient::PublisherBroker { broker_origin } => (
            client
                .post(broker_url(broker_origin, BROKER_DEVICE_TOKEN_PATH)?)
                .header(CONTENT_TYPE, "application/json")
                .body(broker_json_body(&BrokerDeviceTokenRequest {
                    protocol_version: BROKER_PROTOCOL_VERSION,
                    device_code,
                })?)
                .send()
                .await
                .map_err(|_| BaiduNetdiskNativeError::broker_unavailable())?,
            true,
        ),
        ResolvedOAuthClient::SelfHosted {
            app_key,
            secret_key,
        } => (
            client
                .post(BAIDU_TOKEN_URL)
                .form(&self_hosted_device_token_form(
                    app_key,
                    secret_key.expose(),
                    device_code,
                ))
                .send()
                .await
                .map_err(|_| BaiduNetdiskNativeError::network_failed())?,
            false,
        ),
    };
    let status = response.status();
    let retry_after = retry_after_ms(response.headers());
    let body = bounded_response_body(&mut response, MAX_OAUTH_RESPONSE_BYTES).await?;
    poll_disposition(status, &body, retry_after, broker)
}

async fn request_refresh_token(
    client: &Client,
    oauth_client: &ResolvedOAuthClient,
    refresh_token: &str,
) -> Result<ValidatedToken, BaiduNetdiskNativeError> {
    let (mut response, broker) = match oauth_client {
        ResolvedOAuthClient::PublisherBroker { broker_origin } => (
            client
                .post(broker_url(broker_origin, BROKER_REFRESH_PATH)?)
                .header(CONTENT_TYPE, "application/json")
                .body(broker_json_body(&BrokerRefreshRequest {
                    protocol_version: BROKER_PROTOCOL_VERSION,
                    refresh_token,
                })?)
                .send()
                .await
                .map_err(|_| BaiduNetdiskNativeError::broker_unavailable())?,
            true,
        ),
        ResolvedOAuthClient::SelfHosted {
            app_key,
            secret_key,
        } => (
            client
                .post(BAIDU_TOKEN_URL)
                .form(&self_hosted_refresh_form(
                    app_key,
                    secret_key.expose(),
                    refresh_token,
                ))
                .send()
                .await
                .map_err(|_| BaiduNetdiskNativeError::network_failed())?,
            false,
        ),
    };
    let status = response.status();
    let retry_after = retry_after_ms(response.headers());
    let body = bounded_response_body(&mut response, MAX_OAUTH_RESPONSE_BYTES).await?;
    if !status.is_success() {
        return Err(classified_oauth_error(status, &body, retry_after, broker));
    }
    parsed_token_response(&body, Some(refresh_token))
}

async fn cancellable_wait(
    cancelled: Arc<AtomicBool>,
    duration: Duration,
) -> Result<(), BaiduNetdiskNativeError> {
    tauri::async_runtime::spawn_blocking(move || {
        let deadline = Instant::now() + duration;
        loop {
            if cancelled.load(Ordering::SeqCst) {
                return Err(BaiduNetdiskNativeError::new(
                    BaiduNetdiskNativeErrorCode::Cancelled,
                    "Baidu authorization was cancelled",
                ));
            }
            let now = Instant::now();
            if now >= deadline {
                return Ok(());
            }
            thread::sleep((deadline - now).min(Duration::from_millis(50)));
        }
    })
    .await
    .map_err(|_| BaiduNetdiskNativeError::oauth_failed())?
}

#[derive(Deserialize)]
struct UserInfoWire {
    uk: Option<serde_json::Value>,
    baidu_name: Option<String>,
    netdisk_name: Option<String>,
    errno: Option<i64>,
}

struct VerifiedUser {
    uk: String,
    baidu_name: Option<String>,
    netdisk_name: Option<String>,
}

fn lossless_decimal_json(value: serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(value) if valid_decimal(&value, 32) => Some(value),
        serde_json::Value::Number(value) => value.as_u64().map(|value| value.to_string()),
        _ => None,
    }
}

fn parsed_userinfo_response(
    body: &[u8],
    expected_uk: Option<&str>,
) -> Result<VerifiedUser, BaiduNetdiskNativeError> {
    let parsed: UserInfoWire =
        serde_json::from_slice(body).map_err(|_| BaiduNetdiskNativeError::userinfo_failed())?;
    if parsed.errno.is_some_and(|errno| errno != 0) {
        return Err(BaiduNetdiskNativeError::userinfo_failed());
    }
    let uk = parsed
        .uk
        .and_then(lossless_decimal_json)
        .ok_or_else(BaiduNetdiskNativeError::userinfo_failed)?;
    if expected_uk.is_some_and(|expected| expected != uk) {
        return Err(BaiduNetdiskNativeError::account_mismatch());
    }
    Ok(VerifiedUser {
        uk,
        baidu_name: bounded_noncontrol(parsed.baidu_name, MAX_ACCOUNT_NAME_BYTES),
        netdisk_name: bounded_noncontrol(parsed.netdisk_name, MAX_ACCOUNT_NAME_BYTES),
    })
}

async fn verified_user(
    client: &Client,
    access_token: &str,
    expected_uk: Option<&str>,
) -> Result<VerifiedUser, BaiduNetdiskNativeError> {
    let mut url =
        Url::parse(BAIDU_USERINFO_URL).map_err(|_| BaiduNetdiskNativeError::userinfo_failed())?;
    url.query_pairs_mut()
        .append_pair("method", "uinfo")
        .append_pair("vip_version", "v2")
        .append_pair("access_token", access_token);
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|_| BaiduNetdiskNativeError::network_failed())?;
    if !response.status().is_success() {
        return Err(BaiduNetdiskNativeError::userinfo_failed());
    }
    let body = bounded_response_body(&mut response, MAX_OAUTH_RESPONSE_BYTES).await?;
    parsed_userinfo_response(&body, expected_uk)
}

fn token_response(token: ValidatedToken, user: VerifiedUser) -> BaiduNetdiskTokenResponse {
    BaiduNetdiskTokenResponse {
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_in: token.expires_in,
        granted_scopes: CANONICAL_SCOPES.to_vec(),
        uk: user.uk,
        baidu_name: user.baidu_name,
        netdisk_name: user.netdisk_name,
    }
}

async fn authorize_inner(
    request: BaiduNetdiskAuthorizeRequest,
    cancelled: Arc<AtomicBool>,
) -> Result<BaiduNetdiskTokenResponse, BaiduNetdiskNativeError> {
    let timeout = oauth_timeout(request.timeout_ms)?;
    let oauth_client = resolved_oauth_client(request.oauth_client)?;
    let per_request_timeout = timeout.min(Duration::from_secs(30));
    let client = http_client(per_request_timeout)?;
    let device = request_device_code(&client, &oauth_client).await?;
    if cancelled.load(Ordering::SeqCst) {
        return Err(BaiduNetdiskNativeError::new(
            BaiduNetdiskNativeErrorCode::Cancelled,
            "Baidu authorization was cancelled",
        ));
    }
    // Validate both provider URLs, but open the QR URL because this waiting command has no
    // intermediate renderer event through which to display user_code.
    let _verification_url = &device.verification_url;
    let _user_code = &device.user_code;
    tauri_plugin_opener::open_url(device.qrcode_url.as_str(), None::<&str>).map_err(|_| {
        BaiduNetdiskNativeError::new(
            BaiduNetdiskNativeErrorCode::BrowserOpenFailed,
            "The system browser could not be opened",
        )
    })?;

    let started = Instant::now();
    let timeout_deadline = started + timeout;
    let device_deadline = started + device.expires_in;
    let mut interval = device.interval;
    let token = loop {
        let now = Instant::now();
        if now >= device_deadline {
            return Err(BaiduNetdiskNativeError::new(
                BaiduNetdiskNativeErrorCode::DeviceCodeExpired,
                "Baidu device authorization expired",
            ));
        }
        if now >= timeout_deadline {
            return Err(BaiduNetdiskNativeError::new(
                BaiduNetdiskNativeErrorCode::Timeout,
                "Baidu authorization timed out",
            ));
        }
        let remaining = device_deadline.min(timeout_deadline) - now;
        cancellable_wait(Arc::clone(&cancelled), interval.min(remaining)).await?;
        match request_device_token(&client, &oauth_client, &device.device_code).await? {
            PollDisposition::Pending => {}
            PollDisposition::SlowDown => {
                interval = (interval + Duration::from_secs(5)).min(Duration::from_secs(60));
            }
            PollDisposition::Token(token) => break token,
        }
    };
    if cancelled.load(Ordering::SeqCst) {
        return Err(BaiduNetdiskNativeError::new(
            BaiduNetdiskNativeErrorCode::Cancelled,
            "Baidu authorization was cancelled",
        ));
    }
    let user = verified_user(&client, &token.access_token, None).await?;
    if cancelled.load(Ordering::SeqCst) {
        return Err(BaiduNetdiskNativeError::new(
            BaiduNetdiskNativeErrorCode::Cancelled,
            "Baidu authorization was cancelled",
        ));
    }
    Ok(token_response(token, user))
}

#[tauri::command]
pub async fn baidu_netdisk_oauth_authorize(
    request: BaiduNetdiskAuthorizeRequest,
    operations: tauri::State<'_, BaiduNetdiskOAuthOperations>,
) -> Result<BaiduNetdiskTokenResponse, BaiduNetdiskNativeError> {
    let operation_id = request.operation_id.clone();
    let cancelled = operations.begin(&operation_id)?;
    let result = authorize_inner(request, cancelled).await;
    operations.finish(&operation_id);
    result
}

#[tauri::command]
pub async fn baidu_netdisk_oauth_refresh(
    request: BaiduNetdiskRefreshRequest,
    operations: tauri::State<'_, BaiduNetdiskOAuthOperations>,
) -> Result<BaiduNetdiskTokenResponse, BaiduNetdiskNativeError> {
    if !valid_token_text(&request.refresh_token) || !valid_decimal(&request.expected_uk, 32) {
        return Err(BaiduNetdiskNativeError::invalid_request());
    }
    let operation_id = request.operation_id.clone();
    let timeout = oauth_timeout(request.timeout_ms)?;
    let oauth_client = resolved_oauth_client(request.oauth_client)?;
    let previous_refresh_token = Zeroizing::new(request.refresh_token);
    let cancelled = operations.begin(&operation_id)?;
    let result = async {
        let client = http_client(timeout.min(Duration::from_secs(30)))?;
        let token = request_refresh_token(&client, &oauth_client, &previous_refresh_token).await?;
        if cancelled.load(Ordering::SeqCst) {
            return Err(BaiduNetdiskNativeError::new(
                BaiduNetdiskNativeErrorCode::Cancelled,
                "Baidu token refresh was cancelled",
            ));
        }
        let user = verified_user(&client, &token.access_token, Some(&request.expected_uk)).await?;
        if cancelled.load(Ordering::SeqCst) {
            return Err(BaiduNetdiskNativeError::new(
                BaiduNetdiskNativeErrorCode::Cancelled,
                "Baidu token refresh was cancelled",
            ));
        }
        Ok(token_response(token, user))
    }
    .await;
    operations.finish(&operation_id);
    result
}

#[tauri::command]
pub fn baidu_netdisk_oauth_cancel(
    operation_id: String,
    operations: tauri::State<'_, BaiduNetdiskOAuthOperations>,
) -> Result<bool, BaiduNetdiskNativeError> {
    operations.cancel(&operation_id)
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum BaiduNetdiskTransferKind {
    Api,
    Upload,
    Download,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct BaiduNetdiskTransferHeader {
    name: String,
    value: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BaiduNetdiskTransferRequest {
    kind: BaiduNetdiskTransferKind,
    url: String,
    method: String,
    #[serde(default)]
    headers: Vec<BaiduNetdiskTransferHeader>,
    body: Option<Vec<u8>>,
    max_response_bytes: usize,
    timeout_ms: Option<u64>,
}

#[derive(Serialize)]
pub struct BaiduNetdiskTransferResponse {
    status: u16,
    headers: Vec<BaiduNetdiskTransferHeader>,
    body: Vec<u8>,
}

#[derive(Clone)]
enum TransferCapability {
    Upload {
        origin: String,
        path: String,
        upload_id: String,
        access_token_digest: [u8; 32],
        expires_at: Instant,
    },
    Download {
        key: String,
        access_token_digest: Option<[u8; 32]>,
        expires_at: Instant,
    },
}

impl TransferCapability {
    fn expires_at(&self) -> Instant {
        match self {
            Self::Upload { expires_at, .. } | Self::Download { expires_at, .. } => *expires_at,
        }
    }
}

#[derive(Default)]
pub struct BaiduNetdiskTransferAuthorizations(Mutex<Vec<TransferCapability>>);

fn is_pcs_host(host: &str) -> bool {
    host == "d.pcs.baidu.com" || host.ends_with(".pcs.baidu.com")
}

fn validate_https_url(raw_url: &str) -> Result<Url, BaiduNetdiskNativeError> {
    if raw_url.is_empty() || raw_url.len() > MAX_URL_BYTES {
        return Err(BaiduNetdiskNativeError::invalid_request());
    }
    let url = Url::parse(raw_url).map_err(|_| BaiduNetdiskNativeError::invalid_request())?;
    if url.scheme() != "https"
        || url.port().is_some_and(|port| port != 443)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(BaiduNetdiskNativeError::invalid_request());
    }
    Ok(url)
}

fn query_map(url: &Url) -> Result<HashMap<String, String>, BaiduNetdiskNativeError> {
    let mut values = HashMap::new();
    let pairs = url.query_pairs().collect::<Vec<_>>();
    if pairs.len() > 24 {
        return Err(BaiduNetdiskNativeError::invalid_request());
    }
    for (key, value) in pairs {
        if key.is_empty()
            || key.len() > 128
            || value.len() > MAX_URL_BYTES
            || key.chars().any(char::is_control)
            || value.chars().any(char::is_control)
            || values
                .insert(key.into_owned(), value.into_owned())
                .is_some()
        {
            return Err(BaiduNetdiskNativeError::invalid_request());
        }
    }
    Ok(values)
}

fn exact_keys(values: &HashMap<String, String>, required: &[&str], optional: &[&str]) -> bool {
    required.iter().all(|key| values.contains_key(*key))
        && values
            .keys()
            .all(|key| required.contains(&key.as_str()) || optional.contains(&key.as_str()))
}

fn token_digest(value: &str) -> [u8; 32] {
    Sha256::digest(value.as_bytes()).into()
}

fn upload_server_origin(raw_url: &str) -> Result<String, BaiduNetdiskNativeError> {
    let url = validate_https_url(raw_url)?;
    let host = url
        .host_str()
        .ok_or_else(BaiduNetdiskNativeError::invalid_request)?
        .to_ascii_lowercase();
    if !is_pcs_host(&host) || url.path() != "/" || url.query().is_some() {
        return Err(BaiduNetdiskNativeError::invalid_request());
    }
    Ok(url.origin().ascii_serialization())
}

fn download_key(raw_url: &str) -> Result<(String, Option<String>), BaiduNetdiskNativeError> {
    let mut url = validate_https_url(raw_url)?;
    let host = url
        .host_str()
        .ok_or_else(BaiduNetdiskNativeError::invalid_request)?
        .to_ascii_lowercase();
    if !is_pcs_host(&host) || url.path().is_empty() || url.path() == "/" {
        return Err(BaiduNetdiskNativeError::invalid_request());
    }
    let values = query_map(&url)?;
    if values.contains_key("token") {
        return Err(BaiduNetdiskNativeError::invalid_request());
    }
    let access_token = values.get("access_token").cloned();
    let retained = url
        .query_pairs()
        .filter(|(key, _)| key != "access_token")
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect::<Vec<_>>();
    url.set_query(None);
    if !retained.is_empty() {
        url.query_pairs_mut().extend_pairs(retained);
    }
    Ok((url.to_string(), access_token))
}

impl BaiduNetdiskTransferAuthorizations {
    fn with_values<T>(
        &self,
        update: impl FnOnce(&mut Vec<TransferCapability>) -> Result<T, BaiduNetdiskNativeError>,
    ) -> Result<T, BaiduNetdiskNativeError> {
        let now = Instant::now();
        let mut values = self
            .0
            .lock()
            .map_err(|_| BaiduNetdiskNativeError::oauth_failed())?;
        values.retain(|value| value.expires_at() > now);
        update(&mut values)
    }

    fn make_room(values: &mut Vec<TransferCapability>) {
        if values.len() < MAX_PREAUTHORIZED_URLS {
            return;
        }
        if let Some((index, _)) = values
            .iter()
            .enumerate()
            .min_by_key(|(_, value)| value.expires_at())
        {
            values.remove(index);
        }
    }

    fn register_upload(
        &self,
        raw_origin: &str,
        path: &str,
        upload_id: &str,
        access_token: &str,
    ) -> Result<(), BaiduNetdiskNativeError> {
        let origin = upload_server_origin(raw_origin)?;
        if !valid_app_path(path) || !valid_token_text(upload_id) || !valid_token_text(access_token)
        {
            return Err(BaiduNetdiskNativeError::invalid_request());
        }
        let digest = token_digest(access_token);
        self.with_values(|values| {
            values.retain(|value| {
                !matches!(
                    value,
                    TransferCapability::Upload {
                        origin: existing_origin,
                        path: existing_path,
                        upload_id: existing_upload_id,
                        ..
                    } if existing_origin == &origin
                        && existing_path == path
                        && existing_upload_id == upload_id
                )
            });
            Self::make_room(values);
            values.push(TransferCapability::Upload {
                origin,
                path: path.to_owned(),
                upload_id: upload_id.to_owned(),
                access_token_digest: digest,
                expires_at: Instant::now() + UPLOAD_CAPABILITY_TTL,
            });
            Ok(())
        })
    }

    fn require_upload(&self, raw_url: &str) -> Result<Url, BaiduNetdiskNativeError> {
        let url = validate_https_url(raw_url)?;
        if url.path() != "/rest/2.0/pcs/superfile2" {
            return Err(BaiduNetdiskNativeError::invalid_request());
        }
        let values = query_map(&url)?;
        let required = [
            "method",
            "type",
            "path",
            "uploadid",
            "partseq",
            "access_token",
        ];
        if !exact_keys(&values, &required, &[])
            || values.get("method").map(String::as_str) != Some("upload")
            || values.get("type").map(String::as_str) != Some("tmpfile")
            || !values
                .get("path")
                .is_some_and(|value| valid_app_path(value))
            || !values
                .get("uploadid")
                .is_some_and(|value| valid_token_text(value))
            || values
                .get("partseq")
                .and_then(|value| value.parse::<u64>().ok())
                .is_none_or(|value| value >= MAX_UPLOAD_PARTS)
            || !values
                .get("access_token")
                .is_some_and(|value| valid_token_text(value))
        {
            return Err(BaiduNetdiskNativeError::invalid_request());
        }
        let origin = url.origin().ascii_serialization();
        let path = values.get("path").expect("validated path");
        let upload_id = values.get("uploadid").expect("validated uploadid");
        let digest = token_digest(values.get("access_token").expect("validated token"));
        self.with_values(|capabilities| {
            capabilities
                .iter()
                .any(|capability| {
                    matches!(
                        capability,
                        TransferCapability::Upload {
                            origin: expected_origin,
                            path: expected_path,
                            upload_id: expected_upload_id,
                            access_token_digest,
                            ..
                        } if expected_origin == &origin
                            && expected_path == path
                            && expected_upload_id == upload_id
                            && access_token_digest == &digest
                    )
                })
                .then_some(url)
                .ok_or_else(BaiduNetdiskNativeError::invalid_request)
        })
    }

    fn register_download(
        &self,
        raw_url: &str,
        access_token: Option<&str>,
        ttl: Duration,
    ) -> Result<(), BaiduNetdiskNativeError> {
        let (key, supplied_token) = download_key(raw_url)?;
        if supplied_token.is_some() || access_token.is_some_and(|value| !valid_token_text(value)) {
            return Err(BaiduNetdiskNativeError::invalid_request());
        }
        let access_token_digest = access_token.map(token_digest);
        self.with_values(|values| {
            values.retain(|value| {
                !matches!(
                    value,
                    TransferCapability::Download {
                        key: existing_key,
                        ..
                    } if existing_key == &key
                )
            });
            Self::make_room(values);
            values.push(TransferCapability::Download {
                key,
                access_token_digest,
                expires_at: Instant::now() + ttl,
            });
            Ok(())
        })
    }

    fn require_download(&self, raw_url: &str) -> Result<Url, BaiduNetdiskNativeError> {
        let url = validate_https_url(raw_url)?;
        let (key, supplied_token) = download_key(raw_url)?;
        if supplied_token
            .as_deref()
            .is_some_and(|value| !valid_token_text(value))
        {
            return Err(BaiduNetdiskNativeError::invalid_request());
        }
        self.with_values(|capabilities| {
            let capability = capabilities.iter().find(|capability| {
                matches!(
                    capability,
                    TransferCapability::Download {
                        key: expected_key,
                        ..
                    } if expected_key == &key
                )
            });
            let allowed = match (capability, supplied_token.as_deref()) {
                (
                    Some(TransferCapability::Download {
                        access_token_digest: Some(expected),
                        ..
                    }),
                    Some(token),
                ) => expected == &token_digest(token),
                (
                    Some(TransferCapability::Download {
                        access_token_digest: None,
                        ..
                    }),
                    None,
                ) => true,
                _ => false,
            };
            allowed
                .then_some(url)
                .ok_or_else(BaiduNetdiskNativeError::invalid_request)
        })
    }
}

#[derive(Clone)]
enum ApiOperation {
    List,
    Precreate,
    Create,
    FileManager {
        operation: String,
    },
    FileMetas {
        fs_id: String,
        access_token: String,
    },
    UserInfo,
    LocateUpload {
        path: String,
        upload_id: String,
        access_token: String,
    },
}

fn decimal_with_limit(value: &str, maximum: u64) -> bool {
    valid_decimal(value, 20)
        && value
            .parse::<u64>()
            .ok()
            .is_some_and(|value| value <= maximum)
}

fn validate_static_api_url(
    raw_url: &str,
    request_method: &str,
) -> Result<(Url, ApiOperation), BaiduNetdiskNativeError> {
    let url = validate_https_url(raw_url)?;
    let values = query_map(&url)?;
    if !values
        .get("access_token")
        .is_some_and(|value| valid_token_text(value))
    {
        return Err(BaiduNetdiskNativeError::invalid_request());
    }
    let method = values
        .get("method")
        .map(String::as_str)
        .ok_or_else(BaiduNetdiskNativeError::invalid_request)?;
    let operation = match (url.host_str(), url.path(), method) {
        (Some(BAIDU_API_HOST), "/rest/2.0/xpan/file", "list") => {
            let required = [
                "method",
                "access_token",
                "dir",
                "start",
                "limit",
                "order",
                "desc",
            ];
            if request_method != "GET"
                || !exact_keys(&values, &required, &[])
                || values.get("dir").map(String::as_str) != Some(BAIDU_APP_ROOT)
                || !values
                    .get("start")
                    .is_some_and(|value| decimal_with_limit(value, 100_000))
                || !values
                    .get("limit")
                    .is_some_and(|value| decimal_with_limit(value, 100) && value != "0")
                || values.get("order").map(String::as_str) != Some("name")
                || values.get("desc").map(String::as_str) != Some("0")
            {
                return Err(BaiduNetdiskNativeError::invalid_request());
            }
            ApiOperation::List
        }
        (Some(BAIDU_API_HOST), "/rest/2.0/xpan/file", "precreate") => {
            if request_method != "POST" || !exact_keys(&values, &["method", "access_token"], &[]) {
                return Err(BaiduNetdiskNativeError::invalid_request());
            }
            ApiOperation::Precreate
        }
        (Some(BAIDU_API_HOST), "/rest/2.0/xpan/file", "create") => {
            if request_method != "POST" || !exact_keys(&values, &["method", "access_token"], &[]) {
                return Err(BaiduNetdiskNativeError::invalid_request());
            }
            ApiOperation::Create
        }
        (Some(BAIDU_API_HOST), "/rest/2.0/xpan/file", "filemanager") => {
            let required = ["method", "access_token", "opera"];
            let file_operation = values.get("opera").map(String::as_str);
            if request_method != "POST"
                || !exact_keys(&values, &required, &[])
                || !matches!(file_operation, Some("delete" | "rename"))
            {
                return Err(BaiduNetdiskNativeError::invalid_request());
            }
            ApiOperation::FileManager {
                operation: file_operation.expect("validated operation").to_owned(),
            }
        }
        (Some(BAIDU_API_HOST), "/rest/2.0/xpan/multimedia", "filemetas") => {
            let required = ["method", "access_token", "fsids", "dlink"];
            let fsid = values
                .get("fsids")
                .and_then(|value| value.strip_prefix('['))
                .and_then(|value| value.strip_suffix(']'));
            if request_method != "GET"
                || !exact_keys(&values, &required, &[])
                || !fsid.is_some_and(|value| valid_decimal(value, 32))
                || values.get("dlink").map(String::as_str) != Some("1")
            {
                return Err(BaiduNetdiskNativeError::invalid_request());
            }
            ApiOperation::FileMetas {
                fs_id: fsid.expect("validated fs_id").to_owned(),
                access_token: values
                    .get("access_token")
                    .expect("validated access token")
                    .to_owned(),
            }
        }
        (Some(BAIDU_API_HOST), "/rest/2.0/xpan/nas", "uinfo") => {
            let required = ["method", "access_token", "vip_version"];
            if request_method != "GET"
                || !exact_keys(&values, &required, &[])
                || values.get("vip_version").map(String::as_str) != Some("v2")
            {
                return Err(BaiduNetdiskNativeError::invalid_request());
            }
            ApiOperation::UserInfo
        }
        (Some(BAIDU_LOCATE_HOST), "/rest/2.0/pcs/file", "locateupload") => {
            let required = [
                "method",
                "access_token",
                "appid",
                "path",
                "uploadid",
                "upload_version",
            ];
            if request_method != "GET"
                || !exact_keys(&values, &required, &[])
                || values.get("appid").map(String::as_str) != Some(BAIDU_LOCATE_APP_ID)
                || !values
                    .get("path")
                    .is_some_and(|value| valid_app_path(value))
                || !values
                    .get("uploadid")
                    .is_some_and(|value| valid_token_text(value))
                || values.get("upload_version").map(String::as_str) != Some("2.0")
            {
                return Err(BaiduNetdiskNativeError::invalid_request());
            }
            ApiOperation::LocateUpload {
                path: values.get("path").expect("validated path").to_owned(),
                upload_id: values
                    .get("uploadid")
                    .expect("validated uploadid")
                    .to_owned(),
                access_token: values
                    .get("access_token")
                    .expect("validated access token")
                    .to_owned(),
            }
        }
        _ => return Err(BaiduNetdiskNativeError::invalid_request()),
    };
    Ok((url, operation))
}

fn form_map(body: &[u8]) -> Result<HashMap<String, String>, BaiduNetdiskNativeError> {
    let text = std::str::from_utf8(body).map_err(|_| BaiduNetdiskNativeError::invalid_request())?;
    if text.is_empty() || text.len() > MAX_METADATA_BODY_BYTES || text.chars().any(char::is_control)
    {
        return Err(BaiduNetdiskNativeError::invalid_request());
    }
    let url = Url::parse(&format!("https://form.invalid/?{text}"))
        .map_err(|_| BaiduNetdiskNativeError::invalid_request())?;
    query_map(&url)
}

fn valid_md5(value: &str) -> bool {
    value.len() == 32 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn validate_block_list(value: &str) -> bool {
    serde_json::from_str::<Vec<String>>(value)
        .ok()
        .is_some_and(|values| {
            !values.is_empty()
                && values.len() <= MAX_UPLOAD_PARTS as usize
                && values.iter().all(|value| valid_md5(value))
        })
}

fn valid_file_manager_list(value: &str, operation: &str) -> bool {
    let Ok(values) = serde_json::from_str::<Vec<serde_json::Value>>(value) else {
        return false;
    };
    if values.is_empty() || values.len() > 64 {
        return false;
    }
    values.iter().all(|value| match operation {
        "delete" => value.as_str().is_some_and(valid_app_path),
        "rename" => {
            let Some(object) = value.as_object() else {
                return false;
            };
            object.len() == 2
                && object
                    .get("path")
                    .and_then(serde_json::Value::as_str)
                    .is_some_and(valid_app_path)
                && object
                    .get("newname")
                    .and_then(serde_json::Value::as_str)
                    .is_some_and(|name| {
                        !name.is_empty()
                            && name.len() <= 1_024
                            && !name.contains('/')
                            && !name.contains('\\')
                            && !name.chars().any(char::is_control)
                    })
        }
        _ => false,
    })
}

fn validate_api_body(
    operation: &ApiOperation,
    body: Option<&[u8]>,
) -> Result<(), BaiduNetdiskNativeError> {
    match operation {
        ApiOperation::List
        | ApiOperation::FileMetas { .. }
        | ApiOperation::UserInfo
        | ApiOperation::LocateUpload { .. } => {
            if body.is_some_and(|value| !value.is_empty()) {
                return Err(BaiduNetdiskNativeError::invalid_request());
            }
            Ok(())
        }
        ApiOperation::Precreate => {
            let values = form_map(body.ok_or_else(BaiduNetdiskNativeError::invalid_request)?)?;
            let required = ["path", "size", "isdir", "autoinit", "rtype", "block_list"];
            if !exact_keys(&values, &required, &[])
                || !values
                    .get("path")
                    .is_some_and(|value| valid_app_path(value))
                || !values
                    .get("size")
                    .is_some_and(|value| decimal_with_limit(value, MAX_DOCUMENT_BYTES))
                || values.get("isdir").map(String::as_str) != Some("0")
                || values.get("autoinit").map(String::as_str) != Some("1")
                || values.get("rtype").map(String::as_str) != Some("1")
                || !values
                    .get("block_list")
                    .is_some_and(|value| validate_block_list(value))
            {
                return Err(BaiduNetdiskNativeError::invalid_request());
            }
            Ok(())
        }
        ApiOperation::Create => {
            let values = form_map(body.ok_or_else(BaiduNetdiskNativeError::invalid_request)?)?;
            let required = [
                "path",
                "size",
                "isdir",
                "rtype",
                "block_list",
                "uploadid",
                "local_mtime",
            ];
            if !exact_keys(&values, &required, &[])
                || !values
                    .get("path")
                    .is_some_and(|value| valid_app_path(value))
                || !values
                    .get("size")
                    .is_some_and(|value| decimal_with_limit(value, MAX_DOCUMENT_BYTES))
                || values.get("isdir").map(String::as_str) != Some("0")
                || values.get("rtype").map(String::as_str) != Some("1")
                || !values
                    .get("block_list")
                    .is_some_and(|value| validate_block_list(value))
                || !values
                    .get("uploadid")
                    .is_some_and(|value| valid_token_text(value))
                || !values
                    .get("local_mtime")
                    .is_some_and(|value| decimal_with_limit(value, u64::MAX))
            {
                return Err(BaiduNetdiskNativeError::invalid_request());
            }
            Ok(())
        }
        ApiOperation::FileManager { operation } => {
            let values = form_map(body.ok_or_else(BaiduNetdiskNativeError::invalid_request)?)?;
            let optional = if operation == "rename" {
                ["ondup"].as_slice()
            } else {
                [].as_slice()
            };
            if !exact_keys(&values, &["async", "filelist"], optional)
                || values.get("async").map(String::as_str) != Some("0")
                || !values
                    .get("filelist")
                    .is_some_and(|value| valid_file_manager_list(value, operation))
                || (operation == "rename"
                    && values.get("ondup").map(String::as_str) != Some("fail"))
            {
                return Err(BaiduNetdiskNativeError::invalid_request());
            }
            Ok(())
        }
    }
}

fn allowed_transfer_header(kind: BaiduNetdiskTransferKind, name: &str) -> bool {
    match kind {
        BaiduNetdiskTransferKind::Api => {
            matches!(name, "accept" | "content-type" | "content-length")
        }
        BaiduNetdiskTransferKind::Upload => {
            matches!(name, "accept" | "content-type" | "content-length")
        }
        BaiduNetdiskTransferKind::Download => {
            matches!(name, "accept" | "range" | "if-range" | "user-agent")
        }
    }
}

fn validated_transfer_headers(
    kind: BaiduNetdiskTransferKind,
    values: &[BaiduNetdiskTransferHeader],
) -> Result<HeaderMap, BaiduNetdiskNativeError> {
    if values.len() > MAX_HEADER_COUNT {
        return Err(BaiduNetdiskNativeError::invalid_request());
    }
    let mut headers = HeaderMap::new();
    let mut total_bytes = 0_usize;
    for value in values {
        let name_text = value.name.to_ascii_lowercase();
        if !allowed_transfer_header(kind, &name_text)
            || value.value.is_empty()
            || value.value.len() > MAX_URL_BYTES
            || value.value.chars().any(char::is_control)
        {
            return Err(BaiduNetdiskNativeError::invalid_request());
        }
        total_bytes = total_bytes
            .saturating_add(name_text.len())
            .saturating_add(value.value.len());
        if total_bytes > MAX_HEADER_BYTES {
            return Err(BaiduNetdiskNativeError::invalid_request());
        }
        let name = HeaderName::from_bytes(name_text.as_bytes())
            .map_err(|_| BaiduNetdiskNativeError::invalid_request())?;
        if headers.contains_key(&name) {
            return Err(BaiduNetdiskNativeError::invalid_request());
        }
        let header_value = HeaderValue::from_str(&value.value)
            .map_err(|_| BaiduNetdiskNativeError::invalid_request())?;
        headers.insert(name, header_value);
    }
    if headers.contains_key("authorization") || headers.contains_key("cookie") {
        return Err(BaiduNetdiskNativeError::invalid_request());
    }
    Ok(headers)
}

fn media_type(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(str::trim)
}

fn valid_multipart_content_type(value: &str) -> bool {
    let Some((media_type, parameters)) = value.split_once(';') else {
        return false;
    };
    if !media_type
        .trim()
        .eq_ignore_ascii_case("multipart/form-data")
    {
        return false;
    }
    parameters.split(';').any(|parameter| {
        let Some((name, boundary)) = parameter.trim().split_once('=') else {
            return false;
        };
        name.trim().eq_ignore_ascii_case("boundary")
            && !boundary.is_empty()
            && boundary.len() <= 200
            && boundary.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
    })
}

fn valid_byte_range(value: &str) -> Option<(u64, u64)> {
    let (start, end) = value.strip_prefix("bytes=")?.split_once('-')?;
    let start = start.parse::<u64>().ok()?;
    let end = end.parse::<u64>().ok()?;
    (start <= end).then_some((start, end))
}

fn transfer_method(
    kind: BaiduNetdiskTransferKind,
    value: &str,
) -> Result<Method, BaiduNetdiskNativeError> {
    let allowed = match kind {
        BaiduNetdiskTransferKind::Api => matches!(value, "GET" | "POST"),
        BaiduNetdiskTransferKind::Upload => value == "POST",
        BaiduNetdiskTransferKind::Download => value == "GET",
    };
    if !allowed {
        return Err(BaiduNetdiskNativeError::invalid_request());
    }
    Method::from_bytes(value.as_bytes()).map_err(|_| BaiduNetdiskNativeError::invalid_request())
}

fn validate_transfer_limits(
    request: &BaiduNetdiskTransferRequest,
) -> Result<(), BaiduNetdiskNativeError> {
    let body_length = request.body.as_ref().map_or(0, Vec::len);
    let maximum_body = match request.kind {
        BaiduNetdiskTransferKind::Api => MAX_METADATA_BODY_BYTES,
        BaiduNetdiskTransferKind::Upload => MAX_UPLOAD_BODY_BYTES,
        BaiduNetdiskTransferKind::Download => 0,
    };
    if body_length > maximum_body
        || (matches!(request.method.as_str(), "GET" | "DELETE") && body_length > 0)
    {
        return Err(BaiduNetdiskNativeError::invalid_request());
    }
    let maximum_response = match request.kind {
        BaiduNetdiskTransferKind::Download => MAX_DOWNLOAD_RESPONSE_BYTES,
        BaiduNetdiskTransferKind::Api | BaiduNetdiskTransferKind::Upload => {
            MAX_METADATA_RESPONSE_BYTES
        }
    };
    if request.max_response_bytes == 0 || request.max_response_bytes > maximum_response {
        return Err(BaiduNetdiskNativeError::invalid_request());
    }
    Ok(())
}

fn validate_semantic_headers(
    request: &BaiduNetdiskTransferRequest,
    headers: &HeaderMap,
) -> Result<(), BaiduNetdiskNativeError> {
    if let Some(value) = headers.get("content-length") {
        let declared = value
            .to_str()
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .ok_or_else(BaiduNetdiskNativeError::invalid_request)?;
        if declared != request.body.as_ref().map_or(0, Vec::len) {
            return Err(BaiduNetdiskNativeError::invalid_request());
        }
    }
    match request.kind {
        BaiduNetdiskTransferKind::Api if request.method == "POST" => {
            if !media_type(headers).is_some_and(|value| {
                value.eq_ignore_ascii_case("application/x-www-form-urlencoded")
            }) {
                return Err(BaiduNetdiskNativeError::invalid_request());
            }
        }
        BaiduNetdiskTransferKind::Upload => {
            let content_type = headers
                .get(CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(BaiduNetdiskNativeError::invalid_request)?;
            if !valid_multipart_content_type(content_type)
                || request.body.as_ref().is_none_or(Vec::is_empty)
            {
                return Err(BaiduNetdiskNativeError::invalid_request());
            }
        }
        BaiduNetdiskTransferKind::Download => {
            if headers
                .get("user-agent")
                .and_then(|value| value.to_str().ok())
                != Some("pan.baidu.com")
            {
                return Err(BaiduNetdiskNativeError::invalid_request());
            }
            let (start, end) = headers
                .get("range")
                .and_then(|value| value.to_str().ok())
                .and_then(valid_byte_range)
                .ok_or_else(BaiduNetdiskNativeError::invalid_request)?;
            let length = end
                .checked_sub(start)
                .and_then(|value| value.checked_add(1))
                .ok_or_else(BaiduNetdiskNativeError::invalid_request)?;
            if length > MAX_DOWNLOAD_RESPONSE_BYTES as u64 {
                return Err(BaiduNetdiskNativeError::invalid_request());
            }
        }
        BaiduNetdiskTransferKind::Api => {}
    }
    Ok(())
}

fn response_headers(
    headers: &HeaderMap,
    redirect_location: Option<&Url>,
) -> Result<Vec<BaiduNetdiskTransferHeader>, BaiduNetdiskNativeError> {
    const ALLOWED: [&str; 10] = [
        "content-type",
        "content-length",
        "content-range",
        "content-disposition",
        "last-modified",
        "accept-ranges",
        "retry-after",
        "etag",
        "x-bs-request-id",
        "x-pcs-request-id",
    ];
    let mut result = Vec::new();
    for name in ALLOWED {
        let Some(value) = headers.get(name) else {
            continue;
        };
        let value = value
            .to_str()
            .map_err(|_| BaiduNetdiskNativeError::network_failed())?;
        if value.len() > MAX_URL_BYTES || value.chars().any(char::is_control) {
            return Err(BaiduNetdiskNativeError::network_failed());
        }
        result.push(BaiduNetdiskTransferHeader {
            name: name.to_owned(),
            value: value.to_owned(),
        });
    }
    if let Some(location) = redirect_location {
        result.push(BaiduNetdiskTransferHeader {
            name: "location".to_owned(),
            value: location.to_string(),
        });
    }
    Ok(result)
}

fn has_json_content_type(headers: &HeaderMap) -> bool {
    media_type(headers).is_some_and(|value| value.eq_ignore_ascii_case("application/json"))
}

#[derive(Deserialize)]
struct LocateUploadServerWire {
    server: Option<String>,
}

#[derive(Deserialize)]
struct LocateUploadResponseWire {
    servers: Option<Vec<LocateUploadServerWire>>,
    errno: Option<i64>,
    error_code: Option<i64>,
}

#[derive(Deserialize)]
struct FileMetaWire {
    fs_id: Option<serde_json::Value>,
    dlink: Option<String>,
}

#[derive(Deserialize)]
struct FileMetasResponseWire {
    list: Option<Vec<FileMetaWire>>,
    errno: Option<i64>,
}

fn register_api_capabilities(
    authorizations: &BaiduNetdiskTransferAuthorizations,
    operation: &ApiOperation,
    status: StatusCode,
    headers: &HeaderMap,
    body: &[u8],
) -> Result<(), BaiduNetdiskNativeError> {
    if !status.is_success() || body.is_empty() || !has_json_content_type(headers) {
        return Ok(());
    }
    match operation {
        ApiOperation::LocateUpload {
            path,
            upload_id,
            access_token,
        } => {
            let Ok(parsed) = serde_json::from_slice::<LocateUploadResponseWire>(body) else {
                return Ok(());
            };
            if parsed.errno.is_some_and(|value| value != 0)
                || parsed.error_code.is_some_and(|value| value != 0)
            {
                return Ok(());
            }
            let Some(servers) = parsed.servers.filter(|values| values.len() <= 32) else {
                return Ok(());
            };
            for server in servers.into_iter().filter_map(|value| value.server) {
                if upload_server_origin(&server).is_ok() {
                    authorizations.register_upload(&server, path, upload_id, access_token)?;
                }
            }
        }
        ApiOperation::FileMetas {
            fs_id,
            access_token,
        } => {
            let Ok(parsed) = serde_json::from_slice::<FileMetasResponseWire>(body) else {
                return Ok(());
            };
            if parsed.errno.is_some_and(|value| value != 0) {
                return Ok(());
            }
            let Some(items) = parsed.list.filter(|values| values.len() == 1) else {
                return Ok(());
            };
            let Some(item) = items.into_iter().next() else {
                return Ok(());
            };
            if item.fs_id.and_then(lossless_decimal_json).as_deref() != Some(fs_id.as_str()) {
                return Ok(());
            }
            if let Some(dlink) = item.dlink {
                authorizations.register_download(
                    &dlink,
                    Some(access_token),
                    DOWNLOAD_CAPABILITY_TTL,
                )?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn register_download_redirect(
    authorizations: &BaiduNetdiskTransferAuthorizations,
    request_url: &Url,
    status: StatusCode,
    headers: &HeaderMap,
) -> Result<Option<Url>, BaiduNetdiskNativeError> {
    if !matches!(status.as_u16(), 301 | 302 | 303 | 307 | 308) {
        if headers.contains_key(LOCATION) {
            return Err(BaiduNetdiskNativeError::network_failed());
        }
        return Ok(None);
    }
    let raw_location = headers
        .get(LOCATION)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty() && value.len() <= MAX_URL_BYTES)
        .ok_or_else(BaiduNetdiskNativeError::network_failed)?;
    let location = request_url
        .join(raw_location)
        .map_err(|_| BaiduNetdiskNativeError::network_failed())?;
    authorizations.register_download(location.as_str(), None, REDIRECT_CAPABILITY_TTL)?;
    Ok(Some(location))
}

#[tauri::command]
pub async fn baidu_netdisk_transfer(
    request: BaiduNetdiskTransferRequest,
    authorizations: tauri::State<'_, BaiduNetdiskTransferAuthorizations>,
) -> Result<BaiduNetdiskTransferResponse, BaiduNetdiskNativeError> {
    validate_transfer_limits(&request)?;
    let method = transfer_method(request.kind, &request.method)?;
    let (url, api_operation) = match request.kind {
        BaiduNetdiskTransferKind::Api => {
            let (url, operation) = validate_static_api_url(&request.url, &request.method)?;
            validate_api_body(&operation, request.body.as_deref())?;
            (url, Some(operation))
        }
        BaiduNetdiskTransferKind::Upload => (authorizations.require_upload(&request.url)?, None),
        BaiduNetdiskTransferKind::Download => {
            (authorizations.require_download(&request.url)?, None)
        }
    };
    let headers = validated_transfer_headers(request.kind, &request.headers)?;
    validate_semantic_headers(&request, &headers)?;
    let request_url = url.clone();
    let client = http_client(transfer_timeout(request.timeout_ms)?)?;
    let mut builder = client.request(method, url).headers(headers);
    if let Some(body) = request.body {
        builder = builder.body(body);
    }
    let mut response = builder
        .send()
        .await
        .map_err(|_| BaiduNetdiskNativeError::network_failed())?;
    let status = response.status();
    let raw_headers = response.headers().clone();
    let body = bounded_response_body(&mut response, request.max_response_bytes).await?;
    if let Some(operation) = api_operation.as_ref() {
        register_api_capabilities(
            authorizations.inner(),
            operation,
            status,
            &raw_headers,
            &body,
        )?;
    }
    let redirect_location = if request.kind == BaiduNetdiskTransferKind::Download {
        register_download_redirect(authorizations.inner(), &request_url, status, &raw_headers)?
    } else {
        None
    };
    let headers = response_headers(&raw_headers, redirect_location.as_ref())?;
    Ok(BaiduNetdiskTransferResponse {
        status: status.as_u16(),
        headers,
        body,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn error_code<T>(result: Result<T, BaiduNetdiskNativeError>) -> BaiduNetdiskNativeErrorCode {
        match result {
            Ok(_) => panic!("expected error"),
            Err(error) => error.code,
        }
    }

    fn json_headers() -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            CONTENT_TYPE,
            HeaderValue::from_static("application/json; charset=utf-8"),
        );
        headers
    }

    #[test]
    fn oauth_modes_are_explicit_and_do_not_accept_publisher_overrides() {
        let publisher =
            serde_json::from_str::<BaiduNetdiskOAuthClient>(r#"{"mode":"publisher-broker"}"#);
        assert!(matches!(
            publisher,
            Ok(BaiduNetdiskOAuthClient::PublisherBroker {})
        ));
        assert!(serde_json::from_str::<BaiduNetdiskOAuthClient>(
            r#"{"mode":"publisher-broker","appKey":"renderer-key"}"#
        )
        .is_err());
        let self_hosted = serde_json::from_str::<BaiduNetdiskOAuthClient>(
            r#"{"mode":"self-hosted","appKey":"abcdefghijkl","secretKey":"secret-key-value"}"#,
        )
        .unwrap();
        let BaiduNetdiskOAuthClient::SelfHosted { secret_key, .. } = self_hosted else {
            panic!("expected self-hosted credentials");
        };
        assert_eq!(secret_key.expose(), "secret-key-value");
        let invalid_after_deserialize = serde_json::from_str::<BaiduNetdiskOAuthClient>(
            r#"{"mode":"self-hosted","appKey":"abcdefghijkl","secretKey":"contains whitespace"}"#,
        )
        .unwrap();
        assert_eq!(
            error_code(resolved_oauth_client(invalid_after_deserialize)),
            BaiduNetdiskNativeErrorCode::OauthClientInvalid
        );
        assert!(serde_json::from_str::<BaiduNetdiskOAuthClient>(
            r#"{"mode":"self-hosted","appKey":"abcdefghijkl"}"#
        )
        .is_err());
    }

    #[test]
    fn broker_contract_uses_exact_paths_and_json_fields() {
        let origin = exact_https_origin("https://broker.openpencil.dev").unwrap();
        assert_eq!(
            broker_url(&origin, BROKER_DEVICE_CODE_PATH)
                .unwrap()
                .as_str(),
            "https://broker.openpencil.dev/v1/baidu-netdisk/oauth/device-code"
        );
        assert_eq!(
            broker_json_body(&BrokerProtocolRequest {
                protocol_version: 1
            })
            .unwrap(),
            br#"{"protocolVersion":1}"#
        );
        assert_eq!(
            broker_json_body(&BrokerDeviceTokenRequest {
                protocol_version: 1,
                device_code: "device"
            })
            .unwrap(),
            br#"{"protocolVersion":1,"deviceCode":"device"}"#
        );
        assert_eq!(
            broker_json_body(&BrokerRefreshRequest {
                protocol_version: 1,
                refresh_token: "refresh"
            })
            .unwrap(),
            br#"{"protocolVersion":1,"refreshToken":"refresh"}"#
        );
        assert!(broker_url(&origin, "/renderer/override").is_err());
    }

    #[test]
    fn self_hosted_mode_is_pinned_to_official_endpoints_and_scopes() {
        assert_eq!(
            BAIDU_DEVICE_CODE_URL,
            "https://openapi.baidu.com/oauth/2.0/device/code"
        );
        assert_eq!(BAIDU_TOKEN_URL, "https://openapi.baidu.com/oauth/2.0/token");
        let device = HashMap::<_, _>::from_iter(self_hosted_device_code_form("app-key"));
        assert_eq!(
            device.get("scope").map(String::as_str),
            Some("basic,netdisk")
        );
        assert_eq!(
            device.get("response_type").map(String::as_str),
            Some("device_code")
        );
        let refresh = HashMap::<_, _>::from_iter(self_hosted_refresh_form(
            "app-key",
            "secret-key",
            "refresh",
        ));
        assert_eq!(refresh.get("grant_type").copied(), Some("refresh_token"));
        assert_eq!(refresh.get("scope").copied(), Some("basic,netdisk"));
        assert_eq!(refresh.get("client_secret").copied(), Some("secret-key"));
    }

    #[test]
    fn device_flow_requires_a_trusted_provider_qr_url() {
        let valid = br#"{
            "device_code":"device-code",
            "user_code":"ABCD-EFGH",
            "verification_url":"https://openapi.baidu.com/device",
            "qrcode_url":"https://openapi.baidu.com/device/qrcode?code=context",
            "expires_in":300,
            "interval":5
        }"#;
        let device = parsed_device_code(valid).unwrap();
        assert_eq!(device.interval, Duration::from_secs(5));
        assert_eq!(device.qrcode_url.host_str(), Some("openapi.baidu.com"));

        let missing_qr = br#"{
            "device_code":"device-code",
            "user_code":"ABCD-EFGH",
            "verification_url":"https://openapi.baidu.com/device",
            "expires_in":300,
            "interval":5
        }"#;
        assert_eq!(
            error_code(parsed_device_code(missing_qr)),
            BaiduNetdiskNativeErrorCode::TokenResponseInvalid
        );
        assert_eq!(
            error_code(trusted_device_url(
                "https://evil.example/device?code=context"
            )),
            BaiduNetdiskNativeErrorCode::TokenResponseInvalid
        );
    }

    #[test]
    fn polling_and_token_rotation_are_fail_closed() {
        assert!(matches!(
            poll_disposition(
                StatusCode::BAD_REQUEST,
                br#"{"error":"authorization_pending"}"#,
                None,
                false
            ),
            Ok(PollDisposition::Pending)
        ));
        assert!(matches!(
            poll_disposition(
                StatusCode::BAD_REQUEST,
                br#"{"error":"slow_down"}"#,
                None,
                false
            ),
            Ok(PollDisposition::SlowDown)
        ));
        let rotated = parsed_token_response(
            br#"{"access_token":"access","refresh_token":"next","expires_in":2592000,"scope":"basic netdisk"}"#,
            Some("previous"),
        )
        .unwrap();
        assert_eq!(rotated.refresh_token, "next");
        assert_eq!(
            error_code(parsed_token_response(
                br#"{"access_token":"access","refresh_token":"previous","expires_in":2592000,"scope":"basic,netdisk"}"#,
                Some("previous")
            )),
            BaiduNetdiskNativeErrorCode::TokenResponseInvalid
        );
        assert_eq!(
            error_code(parsed_token_response(
                br#"{"access_token":"access","refresh_token":"next","expires_in":2592000,"scope":"basic,netdisk,super_msg"}"#,
                Some("previous")
            )),
            BaiduNetdiskNativeErrorCode::ScopeMismatch
        );
    }

    #[test]
    fn user_identity_preserves_decimal_u64_and_checks_expected_account() {
        let user = parsed_userinfo_response(
            br#"{"errno":0,"uk":18446744073709551615,"netdisk_name":"person"}"#,
            Some("18446744073709551615"),
        )
        .unwrap();
        assert_eq!(user.uk, "18446744073709551615");
        assert_eq!(
            error_code(parsed_userinfo_response(
                br#"{"errno":0,"uk":"208281036"}"#,
                Some("208281037")
            )),
            BaiduNetdiskNativeErrorCode::AccountMismatch
        );
        assert_eq!(
            error_code(parsed_userinfo_response(
                br#"{"errno":0,"uk":"0208281036"}"#,
                None
            )),
            BaiduNetdiskNativeErrorCode::UserinfoFailed
        );
    }

    #[test]
    fn static_data_plane_is_fixed_to_app_root_and_rejects_overwrite_rtype() {
        assert_eq!(MAX_DOCUMENT_BYTES, 512 * 1024 * 1024);
        assert_eq!(MAX_UPLOAD_PARTS, 128);
        let list = "https://pan.baidu.com/rest/2.0/xpan/file?method=list&access_token=access&dir=%2Fapps%2FOpenPencil&start=0&limit=100&order=name&desc=0";
        assert!(matches!(
            validate_static_api_url(list, "GET"),
            Ok((_, ApiOperation::List))
        ));
        assert!(validate_static_api_url(
            &list.replace("%2Fapps%2FOpenPencil", "%2Fapps%2FOther"),
            "GET"
        )
        .is_err());
        assert!(validate_static_api_url(
            "https://evil.example/rest/2.0/xpan/file?method=list&access_token=access&dir=%2Fapps%2FOpenPencil&start=0&limit=100&order=name&desc=0",
            "GET"
        )
        .is_err());

        let precreate = ApiOperation::Precreate;
        let safe = "path=%2Fapps%2FOpenPencil%2Fdoc.fig&size=1&isdir=0&autoinit=1&rtype=1&block_list=%5B%229d5ed678fe57bcca610140957afab571%22%5D";
        assert!(validate_api_body(&precreate, Some(safe.as_bytes())).is_ok());
        let maximum = safe.replace("size=1", &format!("size={MAX_DOCUMENT_BYTES}"));
        assert!(validate_api_body(&precreate, Some(maximum.as_bytes())).is_ok());
        let oversized = safe.replace("size=1", &format!("size={}", MAX_DOCUMENT_BYTES + 1));
        assert!(validate_api_body(&precreate, Some(oversized.as_bytes())).is_err());
        let overwrite = safe.replace("rtype=1", "rtype=3");
        assert!(validate_api_body(&precreate, Some(overwrite.as_bytes())).is_err());

        let hash = "9d5ed678fe57bcca610140957afab571".to_owned();
        assert!(validate_block_list(
            &serde_json::to_string(&vec![hash.clone(); MAX_UPLOAD_PARTS as usize]).unwrap()
        ));
        assert!(!validate_block_list(
            &serde_json::to_string(&vec![hash; MAX_UPLOAD_PARTS as usize + 1]).unwrap()
        ));
    }

    #[test]
    fn transfer_headers_require_exact_download_user_agent_and_bounded_range() {
        let request = BaiduNetdiskTransferRequest {
            kind: BaiduNetdiskTransferKind::Download,
            url: "https://d.pcs.baidu.com/file/exact?sign=issued".to_owned(),
            method: "GET".to_owned(),
            headers: vec![
                BaiduNetdiskTransferHeader {
                    name: "User-Agent".to_owned(),
                    value: "pan.baidu.com".to_owned(),
                },
                BaiduNetdiskTransferHeader {
                    name: "Range".to_owned(),
                    value: "bytes=0-4194303".to_owned(),
                },
            ],
            body: None,
            max_response_bytes: MAX_DOWNLOAD_RESPONSE_BYTES,
            timeout_ms: None,
        };
        let headers = validated_transfer_headers(request.kind, &request.headers).unwrap();
        assert!(validate_semantic_headers(&request, &headers).is_ok());

        let mut wrong_agent = request;
        wrong_agent.headers[0].value = "OpenPencil".to_owned();
        let headers = validated_transfer_headers(wrong_agent.kind, &wrong_agent.headers).unwrap();
        assert!(validate_semantic_headers(&wrong_agent, &headers).is_err());
        assert!(validated_transfer_headers(
            BaiduNetdiskTransferKind::Download,
            &[BaiduNetdiskTransferHeader {
                name: "Authorization".to_owned(),
                value: "Bearer secret".to_owned(),
            }]
        )
        .is_err());
    }

    #[test]
    fn locate_response_registers_only_the_observed_upload_origin_and_authority() {
        let authorizations = BaiduNetdiskTransferAuthorizations::default();
        let operation = ApiOperation::LocateUpload {
            path: "/apps/OpenPencil/doc.fig".to_owned(),
            upload_id: "upload-1".to_owned(),
            access_token: "access-1".to_owned(),
        };
        register_api_capabilities(
            &authorizations,
            &operation,
            StatusCode::OK,
            &json_headers(),
            br#"{"error_code":0,"servers":[{"server":"https://c3.pcs.baidu.com/"},{"server":"https://evil.example/"}]}"#,
        )
        .unwrap();
        let issued = "https://c3.pcs.baidu.com/rest/2.0/pcs/superfile2?method=upload&type=tmpfile&path=%2Fapps%2FOpenPencil%2Fdoc.fig&uploadid=upload-1&partseq=0&access_token=access-1";
        assert!(authorizations.require_upload(issued).is_ok());
        assert!(authorizations
            .require_upload(&issued.replace("partseq=0", "partseq=127"))
            .is_ok());
        assert!(authorizations
            .require_upload(&issued.replace("partseq=0", "partseq=128"))
            .is_err());
        assert!(authorizations
            .require_upload(&issued.replace("c3.pcs.baidu.com", "c4.pcs.baidu.com"))
            .is_err());
        assert!(authorizations
            .require_upload(&issued.replace("access-1", "access-2"))
            .is_err());
        assert!(authorizations
            .require_upload(&issued.replace("doc.fig", "other.fig"))
            .is_err());
    }

    #[test]
    fn dlink_and_redirect_capabilities_never_forward_credentials() {
        let authorizations = BaiduNetdiskTransferAuthorizations::default();
        let operation = ApiOperation::FileMetas {
            fs_id: "18446744073709551615".to_owned(),
            access_token: "access-1".to_owned(),
        };
        register_api_capabilities(
            &authorizations,
            &operation,
            StatusCode::OK,
            &json_headers(),
            br#"{"errno":0,"list":[{"fs_id":18446744073709551615,"dlink":"https://d.pcs.baidu.com/file/exact?sign=issued"}]}"#,
        )
        .unwrap();
        let first = "https://d.pcs.baidu.com/file/exact?sign=issued&access_token=access-1";
        assert!(authorizations.require_download(first).is_ok());
        assert!(authorizations
            .require_download(&first.replace("access-1", "access-2"))
            .is_err());
        assert!(authorizations
            .require_download(
                "https://d.pcs.baidu.com/file/exact?sign=changed&access_token=access-1"
            )
            .is_err());

        let mut redirect_headers = HeaderMap::new();
        redirect_headers.insert(
            LOCATION,
            HeaderValue::from_static("https://c3.pcs.baidu.com/file/final?cap=exact"),
        );
        let redirect = register_download_redirect(
            &authorizations,
            &Url::parse(first).unwrap(),
            StatusCode::FOUND,
            &redirect_headers,
        )
        .unwrap()
        .unwrap();
        assert!(authorizations.require_download(redirect.as_str()).is_ok());
        assert!(authorizations
            .require_download(&format!("{redirect}&access_token=access-1"))
            .is_err());

        redirect_headers.insert(
            LOCATION,
            HeaderValue::from_static(
                "https://c3.pcs.baidu.com/file/leak?access_token=provider-secret",
            ),
        );
        assert!(register_download_redirect(
            &authorizations,
            &Url::parse(first).unwrap(),
            StatusCode::FOUND,
            &redirect_headers
        )
        .is_err());
    }

    #[test]
    fn native_errors_are_static_and_never_include_provider_text() {
        let error = classified_oauth_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            br#"{"error":"server_error","error_description":"access_token=secret"}"#,
            None,
            true,
        );
        let serialized = serde_json::to_string(&error).unwrap();
        assert_eq!(error.code, BaiduNetdiskNativeErrorCode::BrokerUnavailable);
        assert!(!serialized.contains("access_token"));
        assert!(!serialized.contains("secret"));
    }
}
