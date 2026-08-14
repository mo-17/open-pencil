use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue},
    Method, StatusCode,
};
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Clone, Deserialize, Serialize)]
pub struct ProxyHttpHeader {
    name: String,
    value: String,
}

#[derive(Deserialize)]
pub struct ProxyHttpRequest {
    url: String,
    method: Option<String>,
    headers: Option<Vec<ProxyHttpHeader>>,
    body: Option<Vec<u8>>,
    max_response_bytes: Option<usize>,
    max_error_response_bytes: Option<usize>,
    follow_redirects: Option<bool>,
    timeout_ms: Option<u64>,
}

#[derive(Serialize)]
pub struct ProxyHttpResponse {
    status: u16,
    headers: Vec<ProxyHttpHeader>,
    body: Vec<u8>,
    url: String,
}

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

fn request_method(method: Option<String>) -> Result<Method, String> {
    let raw = method.unwrap_or_else(|| "GET".into());
    Method::from_bytes(raw.as_bytes()).map_err(|e| e.to_string())
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

#[tauri::command]
pub async fn proxy_http_request(request: ProxyHttpRequest) -> Result<ProxyHttpResponse, String> {
    let parsed = reqwest::Url::parse(&request.url).map_err(|e| e.to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Only HTTP(S) requests are supported".into());
    }

    let redirect_policy = if request.follow_redirects.unwrap_or(true) {
        reqwest::redirect::Policy::limited(5)
    } else {
        reqwest::redirect::Policy::none()
    };
    let client = reqwest::Client::builder()
        .redirect(redirect_policy)
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let mut builder = client
        .request(request_method(request.method)?, parsed)
        .headers(request_headers(request.headers));
    if let Some(body) = request.body {
        builder = builder.body(body);
    }
    if let Some(timeout_ms) = request.timeout_ms {
        if timeout_ms == 0 {
            return Err("timeoutMs must be greater than 0".into());
        }
        builder = builder.timeout(Duration::from_millis(timeout_ms));
    }

    let mut response = builder.send().await.map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    let url = response.url().to_string();
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
    let response_limit = response_limit(
        response.status(),
        request.max_response_bytes,
        request.max_error_response_bytes,
    );
    if let (Some(limit), Some(content_length)) = (response_limit, response.content_length()) {
        if content_length > limit as u64 {
            return Err("HTTP response exceeds the configured size limit".into());
        }
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if response_limit
            .is_some_and(|limit| response_chunk_exceeds_limit(body.len(), chunk.len(), limit))
        {
            return Err("HTTP response exceeds the configured size limit".into());
        }
        body.extend_from_slice(&chunk);
    }

    Ok(ProxyHttpResponse {
        status,
        headers,
        body,
        url,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(success_limit: Option<usize>, error_limit: Option<usize>) -> ProxyHttpRequest {
        ProxyHttpRequest {
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
}
