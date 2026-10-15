use rand::RngCore;
use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue},
    Method, StatusCode,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::Duration;
use tauri::async_runtime::JoinHandle;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::Manager;
use tokio::sync::oneshot;

#[derive(Clone, Deserialize, Serialize)]
pub struct ProxyHttpHeader {
    name: String,
    value: String,
}

#[derive(Deserialize)]
pub struct ProxyHttpRequest {
    /// Chosen by the page so it can cancel the request before the head arrives.
    #[serde(default = "legacy_request_id")]
    id: String,
    url: String,
    method: Option<String>,
    headers: Option<Vec<ProxyHttpHeader>>,
    body: Option<Vec<u8>>,
    max_response_bytes: Option<usize>,
    max_error_response_bytes: Option<usize>,
    follow_redirects: Option<bool>,
    timeout_ms: Option<u64>,
}

/// Older callers have no cancellation identifier; give each a distinct local identity.
fn legacy_request_id() -> String {
    let mut bytes = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Status and headers; the body follows on the request's channel.
#[derive(Serialize)]
pub struct ProxyHttpHead {
    status: u16,
    headers: Vec<ProxyHttpHeader>,
    url: String,
}

/// `network` marks failures to reach the server or read from it, which the page
/// reports the way `fetch` does so callers can retry them.
#[derive(Serialize)]
pub struct ProxyHttpError {
    network: bool,
    message: String,
}

impl ProxyHttpError {
    fn request(message: impl Into<String>) -> Self {
        Self {
            network: false,
            message: message.into(),
        }
    }

    fn network(error: reqwest::Error) -> Self {
        Self {
            network: true,
            message: error.to_string(),
        }
    }
}

/// The end of a body on the request's channel; chunks before it are raw bytes.
#[derive(Serialize)]
#[serde(untagged)]
enum ProxyHttpBodyEnd {
    Done { done: bool },
    Error { error: ProxyHttpError },
}

/// Requests in flight, so the page can cancel one, and cancellations that arrived
/// first: Tauri runs `proxy_http_request` on its own task, so `cancel_http_request`
/// can run before the request is registered.
#[derive(Default)]
pub struct ProxyHttpRequests(Mutex<Requests>);

#[derive(Default)]
struct Requests {
    tasks: HashMap<String, JoinHandle<()>>,
    cancelled: HashSet<String>,
}

impl Requests {
    /// Stops a registered request, or refuses it when it registers later.
    fn cancel(&mut self, id: String) {
        match self.tasks.remove(&id) {
            Some(task) => task.abort(),
            None => {
                self.cancelled.insert(id);
            }
        }
    }

    /// Whether a request may start; false once the page cancelled it.
    fn admit(&mut self, id: &str) -> bool {
        !self.cancelled.remove(id)
    }
}

impl ProxyHttpRequests {
    fn requests(&self) -> std::sync::MutexGuard<'_, Requests> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn cancelled() -> ProxyHttpError {
    ProxyHttpError::request("The request was cancelled")
}

type HeadResult = Result<ProxyHttpHead, ProxyHttpError>;

fn request_headers(headers: Option<Vec<ProxyHttpHeader>>) -> HeaderMap {
    let mut mapped = HeaderMap::new();
    for header in headers.unwrap_or_default() {
        let Ok(header_name) = HeaderName::from_bytes(header.name.as_bytes()) else {
            continue;
        };
        let Ok(header_value) = HeaderValue::from_str(&header.value) else {
            continue;
        };
        mapped.insert(header_name, header_value);
    }
    mapped
}

fn request_method(method: Option<String>) -> Result<Method, ProxyHttpError> {
    let raw = method.unwrap_or_else(|| "GET".into());
    Method::from_bytes(raw.as_bytes()).map_err(|e| ProxyHttpError::request(e.to_string()))
}

fn response_limit(
    status: StatusCode,
    success_limit: Option<usize>,
    error_limit: Option<usize>,
) -> Option<usize> {
    if status.is_success() {
        success_limit
    } else {
        error_limit.or(success_limit)
    }
}

fn response_chunk_exceeds_limit(current: usize, chunk: usize, limit: usize) -> bool {
    chunk > limit.saturating_sub(current)
}

async fn send(request: ProxyHttpRequest) -> Result<reqwest::Response, ProxyHttpError> {
    let parsed =
        reqwest::Url::parse(&request.url).map_err(|e| ProxyHttpError::request(e.to_string()))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(ProxyHttpError::request(
            "Only HTTP(S) requests are supported",
        ));
    }

    let redirect_policy = if request.follow_redirects.unwrap_or(true) {
        reqwest::redirect::Policy::limited(5)
    } else {
        reqwest::redirect::Policy::none()
    };
    let client = reqwest::Client::builder()
        .redirect(redirect_policy)
        // An idle limit, not a total one: a streamed model response can run for
        // minutes while still delivering bytes. Callers cap the total with timeout_ms.
        .connect_timeout(Duration::from_secs(30))
        .read_timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| ProxyHttpError::request(e.to_string()))?;
    let mut builder = client
        .request(request_method(request.method)?, parsed)
        .headers(request_headers(request.headers));
    if let Some(body) = request.body {
        builder = builder.body(body);
    }
    if let Some(timeout_ms) = request.timeout_ms {
        if timeout_ms == 0 {
            return Err(ProxyHttpError::request("timeoutMs must be greater than 0"));
        }
        builder = builder.timeout(Duration::from_millis(timeout_ms));
    }
    builder.send().await.map_err(ProxyHttpError::network)
}

fn size_limit_error() -> ProxyHttpError {
    ProxyHttpError::request("HTTP response exceeds the configured size limit")
}

fn end_body(on_body: &Channel<InvokeResponseBody>, end: ProxyHttpBodyEnd) {
    if let Ok(json) = serde_json::to_string(&end) {
        let _ = on_body.send(InvokeResponseBody::Json(json));
    }
}

async fn run(
    request: ProxyHttpRequest,
    head: oneshot::Sender<HeadResult>,
    on_body: Channel<InvokeResponseBody>,
) {
    let success_limit = request.max_response_bytes;
    let error_limit = request.max_error_response_bytes;
    let mut response = match send(request).await {
        Ok(response) => response,
        Err(error) => {
            let _ = head.send(Err(error));
            return;
        }
    };
    let limit = response_limit(response.status(), success_limit, error_limit);
    if let (Some(limit), Some(content_length)) = (limit, response.content_length()) {
        if content_length > limit as u64 {
            let _ = head.send(Err(size_limit_error()));
            return;
        }
    }
    let headers = response
        .headers()
        .iter()
        .filter_map(|(name, value)| {
            Some(ProxyHttpHeader {
                name: name.as_str().to_owned(),
                value: value.to_str().ok()?.to_owned(),
            })
        })
        .collect();
    let sent = head.send(Ok(ProxyHttpHead {
        status: response.status().as_u16(),
        headers,
        url: response.url().to_string(),
    }));
    if sent.is_err() {
        return;
    }

    let mut received = 0;
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                if limit.is_some_and(|limit| response_chunk_exceeds_limit(received, chunk.len(), limit)) {
                    end_body(
                        &on_body,
                        ProxyHttpBodyEnd::Error {
                            error: size_limit_error(),
                        },
                    );
                    return;
                }
                received = received.saturating_add(chunk.len());
                if on_body
                    .send(InvokeResponseBody::Raw(chunk.to_vec()))
                    .is_err()
                {
                    return;
                }
            }
            Ok(None) => {
                end_body(&on_body, ProxyHttpBodyEnd::Done { done: true });
                return;
            }
            Err(error) => {
                end_body(
                    &on_body,
                    ProxyHttpBodyEnd::Error {
                        error: ProxyHttpError::network(error),
                    },
                );
                return;
            }
        }
    }
}

/// Sends a request from the native side, out of reach of WebView CORS. Resolves
/// with the head as soon as it arrives and streams the body to `on_body`.
#[tauri::command]
pub async fn proxy_http_request<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: ProxyHttpRequest,
    on_body: Channel<InvokeResponseBody>,
) -> HeadResult {
    let id = request.id.clone();
    let (head, head_received) = oneshot::channel();
    {
        // Held while spawning, so the task cannot remove its entry before it exists.
        let state = app.state::<ProxyHttpRequests>();
        let mut requests = state.requests();
        if !requests.admit(&id) {
            return Err(cancelled());
        }
        let task_app = app.clone();
        let task_id = id.clone();
        let task = tauri::async_runtime::spawn(async move {
            run(request, head, on_body).await;
            task_app
                .state::<ProxyHttpRequests>()
                .requests()
                .tasks
                .remove(&task_id);
        });
        if let Some(previous) = requests.tasks.insert(id, task) {
            previous.abort();
        }
    }
    head_received.await.map_err(|_| cancelled())?
}

/// Stops a request and its body stream, closing the connection.
#[tauri::command]
pub fn cancel_http_request(requests: tauri::State<'_, ProxyHttpRequests>, id: String) {
    requests.requests().cancel(id);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(success_limit: Option<usize>, error_limit: Option<usize>) -> ProxyHttpRequest {
        ProxyHttpRequest {
            id: "test".into(),
            url: "https://example.com".into(),
            method: None,
            headers: None,
            body: None,
            max_response_bytes: success_limit,
            max_error_response_bytes: error_limit,
            follow_redirects: None,
            timeout_ms: None,
        }
    }

    #[test]
    fn proxy_request_deserializes_the_separate_error_limit() {
        let parsed: ProxyHttpRequest = serde_json::from_str(
            r#"{"url":"https://example.com","max_response_bytes":1024,"max_error_response_bytes":64}"#,
        )
        .expect("request should deserialize");
        assert_eq!(parsed.max_response_bytes, Some(1024));
        assert_eq!(parsed.max_error_response_bytes, Some(64));
    }

    #[test]
    fn proxy_request_keeps_legacy_requests_compatible() {
        let parsed: ProxyHttpRequest = serde_json::from_str(r#"{"url":"https://example.com"}"#)
            .expect("legacy request should deserialize");
        assert_eq!(parsed.max_response_bytes, None);
        assert_eq!(parsed.max_error_response_bytes, None);
        let constructed = request(Some(1024), Some(64));
        assert_eq!(constructed.max_response_bytes, Some(1024));
    }

    #[test]
    fn error_responses_use_the_smaller_error_limit() {
        assert_eq!(
            response_limit(StatusCode::OK, Some(1024), Some(64)),
            Some(1024)
        );
        assert_eq!(
            response_limit(StatusCode::BAD_REQUEST, Some(1024), Some(64)),
            Some(64)
        );
        assert_eq!(
            response_limit(StatusCode::BAD_REQUEST, Some(1024), None),
            Some(1024)
        );
    }

    #[test]
    fn chunk_limit_is_overflow_safe_and_allows_the_exact_boundary() {
        assert!(!response_chunk_exceeds_limit(4, 6, 10));
        assert!(response_chunk_exceeds_limit(4, 7, 10));
        assert!(response_chunk_exceeds_limit(usize::MAX, 1, 10));
    }
    #[test]
    fn a_cancel_before_registration_refuses_the_request() {
        let mut requests = Requests::default();
        requests.cancel("early".into());

        assert!(!requests.admit("early"));
        // The refusal is spent; the id is not refused again.
        assert!(requests.admit("early"));
        assert!(requests.admit("other"));
    }
}
