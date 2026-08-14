use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use reqwest::{header::CONTENT_TYPE, Client, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::Path,
    thread,
    time::{Duration, SystemTime},
};
use tauri::WebviewWindow;

const CODEPEN_HOST: &str = "codepen.io";
const CODEPEN_SOURCE_LIMIT_BYTES: usize = 1_048_576;
const CODEPEN_TOTAL_SOURCE_LIMIT_BYTES: usize = CODEPEN_SOURCE_LIMIT_BYTES * 3;
const CODEPEN_FETCH_TIMEOUT: Duration = Duration::from_secs(12);
const CODEPEN_PREFILL_ENDPOINT: &str = "https://codepen.io/cpe/pen/define/";
const CODEPEN_PREFILL_PANE_LIMIT_BYTES: usize = 1_000_000;
const CODEPEN_PREFILL_TOTAL_LIMIT_BYTES: usize = 3_000_000;
const CODEPEN_PREFILL_FILE_LIFETIME: Duration = Duration::from_secs(120);
const CODEPEN_STALE_FILE_AGE: Duration = Duration::from_secs(60 * 60);
const CODEPEN_TEMP_PREFIX: &str = "openpencil-codepen-";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CodePenSourceRequest {
    url: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CodePenPrefillData {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    tags: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    private: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    layout: Option<String>,
    html: String,
    html_pre_processor: String,
    css: String,
    css_pre_processor: String,
    js: String,
    js_pre_processor: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CodePenPrefillRequest {
    data: CodePenPrefillData,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodePenPrefillResponse {
    endpoint: &'static str,
    opened: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodePenSourceEvidence {
    kind: &'static str,
    url: String,
    byte_length: usize,
    digest: String,
    content_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodePenSourcesResponse {
    canonical_url: String,
    html: String,
    css: String,
    js: String,
    sources: Vec<CodePenSourceEvidence>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodePenNativeError {
    code: &'static str,
    message: String,
}

impl CodePenNativeError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn invalid_url() -> Self {
        Self::new("invalid-url", "A canonical public CodePen URL is required")
    }

    fn fetch_failed(message: impl Into<String>) -> Self {
        Self::new("fetch-failed", message)
    }
}

fn bounded_text(value: &str, maximum: usize) -> bool {
    value.len() <= maximum && !value.contains('\0')
}

fn validate_prefill_data(data: &CodePenPrefillData) -> Result<(), CodePenNativeError> {
    if data
        .title
        .as_deref()
        .is_some_and(|value| !bounded_text(value, 256))
        || data
            .description
            .as_deref()
            .is_some_and(|value| !bounded_text(value, 4_096))
        || !bounded_text(&data.html, CODEPEN_PREFILL_PANE_LIMIT_BYTES)
        || !bounded_text(&data.css, CODEPEN_PREFILL_PANE_LIMIT_BYTES)
        || !bounded_text(&data.js, CODEPEN_PREFILL_PANE_LIMIT_BYTES)
    {
        return Err(CodePenNativeError::new(
            "invalid-prefill",
            "CodePen Prefill content exceeds its bounded text limits",
        ));
    }
    let total = data
        .html
        .len()
        .saturating_add(data.css.len())
        .saturating_add(data.js.len());
    if total > CODEPEN_PREFILL_TOTAL_LIMIT_BYTES {
        return Err(CodePenNativeError::new(
            "invalid-prefill",
            "CodePen Prefill content exceeds the total size limit",
        ));
    }
    if data.html_pre_processor != "none"
        || data.css_pre_processor != "none"
        || data.js_pre_processor != "none"
    {
        return Err(CodePenNativeError::new(
            "invalid-prefill",
            "OpenPencil CodePen Prefill supports only compiled HTML, CSS, and JavaScript",
        ));
    }
    if data
        .layout
        .as_deref()
        .is_some_and(|value| !matches!(value, "top" | "left" | "right"))
    {
        return Err(CodePenNativeError::new(
            "invalid-prefill",
            "CodePen Prefill layout is invalid",
        ));
    }
    if data.tags.as_ref().is_some_and(|tags| {
        tags.len() > 5
            || tags
                .iter()
                .any(|tag| tag.is_empty() || !bounded_text(tag, 64))
    }) {
        return Err(CodePenNativeError::new(
            "invalid-prefill",
            "CodePen Prefill tags are invalid",
        ));
    }
    Ok(())
}

fn escape_html_attribute(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#39;"),
            _ => escaped.push(character),
        }
    }
    escaped
}

fn prefill_launcher_html(payload: &str) -> String {
    let payload = escape_html_attribute(payload);
    format!(
        r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; form-action https://codepen.io; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OpenPencil CodePen Prefill</title>
<style>body{{font:16px system-ui,sans-serif;padding:2rem;color:#222}}button{{font:inherit;padding:.6rem 1rem}}</style>
</head>
<body>
<p>Opening this OpenPencil showcase in CodePen…</p>
<form id="openpencil-codepen-prefill" action="{CODEPEN_PREFILL_ENDPOINT}" method="post">
<input type="hidden" name="data" value="{payload}">
<noscript><button type="submit">Continue to CodePen</button></noscript>
</form>
<script>document.getElementById('openpencil-codepen-prefill').submit()</script>
</body>
</html>"#
    )
}

fn write_prefill_launcher(payload: &str) -> Result<std::path::PathBuf, CodePenNativeError> {
    let mut temporary = tempfile::Builder::new()
        .prefix(CODEPEN_TEMP_PREFIX)
        .suffix(".html")
        .tempfile()
        .map_err(|_| {
            CodePenNativeError::new(
                "launcher-failed",
                "The temporary CodePen launcher could not be created",
            )
        })?;
    temporary
        .write_all(prefill_launcher_html(payload).as_bytes())
        .map_err(|_| {
            CodePenNativeError::new(
                "launcher-failed",
                "The temporary CodePen launcher could not be written",
            )
        })?;
    temporary.flush().map_err(|_| {
        CodePenNativeError::new(
            "launcher-failed",
            "The temporary CodePen launcher could not be written",
        )
    })?;
    let (_file, path) = temporary.keep().map_err(|_| {
        CodePenNativeError::new(
            "launcher-failed",
            "The temporary CodePen launcher could not be retained",
        )
    })?;
    Ok(path)
}

fn codepen_temp_name(name: &str) -> bool {
    name.starts_with(CODEPEN_TEMP_PREFIX) && (name.ends_with(".html") || name.ends_with(".fig"))
}

fn cleanup_stale_codepen_files_in(directory: &Path, now: SystemTime, minimum_age: Duration) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if !codepen_temp_name(&name) {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.file_type().is_file() {
            continue;
        }
        let old_enough = metadata
            .modified()
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age >= minimum_age);
        if old_enough {
            let _ = fs::remove_file(entry.path());
        }
    }
}

pub(crate) fn cleanup_stale_codepen_files() {
    cleanup_stale_codepen_files_in(
        &std::env::temp_dir(),
        SystemTime::now(),
        CODEPEN_STALE_FILE_AGE,
    );
}

fn remove_codepen_launcher(path: &Path) {
    for delay in [
        Duration::ZERO,
        Duration::from_millis(250),
        Duration::from_secs(1),
    ] {
        if !delay.is_zero() {
            thread::sleep(delay);
        }
        match fs::remove_file(path) {
            Ok(()) => return,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
            Err(_) => {}
        }
    }
    eprintln!(
        "OpenPencil could not remove the temporary CodePen launcher; it will be retried at startup: {}",
        path.display()
    );
}

#[tauri::command]
pub fn open_codepen_prefill(
    caller: WebviewWindow,
    request: CodePenPrefillRequest,
) -> Result<CodePenPrefillResponse, CodePenNativeError> {
    require_main_caller(&caller)?;
    validate_prefill_data(&request.data)?;
    let payload = serde_json::to_string(&request.data).map_err(|_| {
        CodePenNativeError::new(
            "invalid-prefill",
            "CodePen Prefill content could not be encoded",
        )
    })?;
    let path = write_prefill_launcher(&payload)?;
    if tauri_plugin_opener::open_path(&path, None::<&str>).is_err() {
        remove_codepen_launcher(&path);
        return Err(CodePenNativeError::new(
            "browser-open-failed",
            "The system browser could not open the CodePen Prefill launcher",
        ));
    }
    thread::spawn(move || {
        thread::sleep(CODEPEN_PREFILL_FILE_LIFETIME);
        remove_codepen_launcher(&path);
    });
    Ok(CodePenPrefillResponse {
        endpoint: CODEPEN_PREFILL_ENDPOINT,
        opened: true,
    })
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct CanonicalCodePen {
    owner: String,
    slug: String,
    url: String,
}

fn require_main_caller(caller: &WebviewWindow) -> Result<(), CodePenNativeError> {
    if caller.label() != "main" {
        return Err(CodePenNativeError::new(
            "forbidden-caller",
            "CodePen commands are available only to the main window",
        ));
    }
    Ok(())
}

fn valid_owner(value: &str) -> bool {
    let mut bytes = value.bytes();
    (1..=64).contains(&value.len())
        && bytes
            .next()
            .is_some_and(|byte| byte.is_ascii_alphanumeric())
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn valid_slug(value: &str) -> bool {
    (1..=64).contains(&value.len()) && value.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

fn parse_canonical_codepen_url(value: &str) -> Result<CanonicalCodePen, CodePenNativeError> {
    if value.len() > 256 {
        return Err(CodePenNativeError::invalid_url());
    }
    let parsed = Url::parse(value).map_err(|_| CodePenNativeError::invalid_url())?;
    if parsed.scheme() != "https"
        || parsed.host_str() != Some(CODEPEN_HOST)
        || parsed.port().is_some()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(CodePenNativeError::invalid_url());
    }
    let segments = parsed
        .path_segments()
        .ok_or_else(CodePenNativeError::invalid_url)?
        .collect::<Vec<_>>();
    let [owner, "pen", slug] = segments.as_slice() else {
        return Err(CodePenNativeError::invalid_url());
    };
    if !valid_owner(owner) || !valid_slug(slug) {
        return Err(CodePenNativeError::invalid_url());
    }
    let canonical = format!("https://{CODEPEN_HOST}/{owner}/pen/{slug}");
    if value != canonical || parsed.as_str() != canonical {
        return Err(CodePenNativeError::invalid_url());
    }
    Ok(CanonicalCodePen {
        owner: (*owner).to_string(),
        slug: (*slug).to_string(),
        url: canonical,
    })
}

fn source_url(pen: &CanonicalCodePen, extension: &str) -> String {
    format!("{}.{extension}", pen.url)
}

fn accepted_source_content_type(kind: &str, value: &str) -> bool {
    let essence = value
        .split(';')
        .next()
        .map(str::trim)
        .unwrap_or_default()
        .to_ascii_lowercase();
    match kind {
        "html" => matches!(essence.as_str(), "text/html" | "text/plain"),
        "css" => matches!(essence.as_str(), "text/css" | "text/plain"),
        "js" => matches!(
            essence.as_str(),
            "application/javascript"
                | "application/x-javascript"
                | "text/javascript"
                | "text/plain"
        ),
        _ => false,
    }
}

fn sha256_digest(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    URL_SAFE_NO_PAD.encode(digest)
}

async fn fetch_source(
    client: &Client,
    pen: &CanonicalCodePen,
    kind: &'static str,
) -> Result<(String, CodePenSourceEvidence), CodePenNativeError> {
    let url = source_url(pen, kind);
    let mut response = client
        .get(&url)
        .send()
        .await
        .map_err(|_| CodePenNativeError::fetch_failed("CodePen source request failed"))?;
    if !response.status().is_success() {
        return Err(CodePenNativeError::fetch_failed(format!(
            "CodePen {kind} source returned HTTP {}",
            response.status().as_u16()
        )));
    }
    if response.url().as_str() != url {
        return Err(CodePenNativeError::fetch_failed(
            "CodePen source redirects are not allowed",
        ));
    }
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    if !accepted_source_content_type(kind, &content_type) {
        return Err(CodePenNativeError::fetch_failed(format!(
            "CodePen {kind} source returned an unsupported content type"
        )));
    }
    if response
        .content_length()
        .is_some_and(|length| length > CODEPEN_SOURCE_LIMIT_BYTES as u64)
    {
        return Err(CodePenNativeError::fetch_failed(format!(
            "CodePen {kind} source exceeds the size limit"
        )));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| CodePenNativeError::fetch_failed("CodePen source response failed"))?
    {
        if chunk.len() > CODEPEN_SOURCE_LIMIT_BYTES.saturating_sub(bytes.len()) {
            return Err(CodePenNativeError::fetch_failed(format!(
                "CodePen {kind} source exceeds the size limit"
            )));
        }
        bytes.extend_from_slice(&chunk);
    }
    let digest = sha256_digest(&bytes);
    let byte_length = bytes.len();
    let source = String::from_utf8(bytes).map_err(|_| {
        CodePenNativeError::fetch_failed(format!("CodePen {kind} source is not valid UTF-8"))
    })?;
    Ok((
        source,
        CodePenSourceEvidence {
            kind,
            url,
            byte_length,
            digest,
            content_type,
        },
    ))
}

#[tauri::command]
pub async fn fetch_codepen_sources(
    caller: WebviewWindow,
    request: CodePenSourceRequest,
) -> Result<CodePenSourcesResponse, CodePenNativeError> {
    require_main_caller(&caller)?;
    let pen = parse_canonical_codepen_url(&request.url)?;
    let client = Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(CODEPEN_FETCH_TIMEOUT)
        .build()
        .map_err(|_| CodePenNativeError::fetch_failed("CodePen HTTP client could not start"))?;
    let (html, html_evidence) = fetch_source(&client, &pen, "html").await?;
    let (css, css_evidence) = fetch_source(&client, &pen, "css").await?;
    let (js, js_evidence) = fetch_source(&client, &pen, "js").await?;
    let total_bytes = html_evidence
        .byte_length
        .saturating_add(css_evidence.byte_length)
        .saturating_add(js_evidence.byte_length);
    if total_bytes > CODEPEN_TOTAL_SOURCE_LIMIT_BYTES {
        return Err(CodePenNativeError::fetch_failed(
            "CodePen sources exceed the total size limit",
        ));
    }
    Ok(CodePenSourcesResponse {
        canonical_url: pen.url,
        html,
        css,
        js,
        sources: vec![html_evidence, css_evidence, js_evidence],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_canonical_public_codepen_pen_urls() {
        let parsed = parse_canonical_codepen_url("https://codepen.io/jakebogan01/pen/pvNWZWr")
            .expect("canonical URL");
        assert_eq!(parsed.owner, "jakebogan01");
        assert_eq!(parsed.slug, "pvNWZWr");
        for rejected in [
            "http://codepen.io/jakebogan01/pen/pvNWZWr",
            "https://user@codepen.io/jakebogan01/pen/pvNWZWr",
            "https://codepen.io:443/jakebogan01/pen/pvNWZWr",
            "https://codepen.io/jakebogan01/pen/pvNWZWr/",
            "https://codepen.io/jakebogan01/pen/pvNWZWr?editors=1100",
            "https://codepen.io/jakebogan01/pen/pvNWZWr#details",
            "https://codepen.io/jakebogan01/full/pvNWZWr",
            "https://codepen.io.evil.test/jakebogan01/pen/pvNWZWr",
            "https://codepen.io/%2e%2e/pen/pvNWZWr",
            "https://codepen.io/-owner/pen/pvNWZWr",
            "https://codepen.io/_owner/pen/pvNWZWr",
            "https://codepen.io/jakebogan01/pen/pv-NWZWr",
        ] {
            assert!(
                parse_canonical_codepen_url(rejected).is_err(),
                "accepted {rejected}"
            );
        }
    }

    #[test]
    fn constructs_only_fixed_codepen_source_urls() {
        let pen = parse_canonical_codepen_url("https://codepen.io/owner_name/pen/AbC123")
            .expect("canonical URL");
        assert_eq!(
            source_url(&pen, "html"),
            "https://codepen.io/owner_name/pen/AbC123.html"
        );
        assert_eq!(
            source_url(&pen, "css"),
            "https://codepen.io/owner_name/pen/AbC123.css"
        );
        assert_eq!(
            source_url(&pen, "js"),
            "https://codepen.io/owner_name/pen/AbC123.js"
        );
    }

    #[test]
    fn source_content_types_are_kind_specific() {
        assert!(accepted_source_content_type(
            "html",
            "text/html; charset=utf-8"
        ));
        assert!(accepted_source_content_type("css", "text/plain"));
        assert!(accepted_source_content_type(
            "js",
            "application/javascript; charset=utf-8"
        ));
        assert!(!accepted_source_content_type("html", "image/png"));
        assert!(!accepted_source_content_type("css", "text/html"));
        assert!(!accepted_source_content_type(
            "js",
            "application/octet-stream"
        ));
    }

    fn prefill_data() -> CodePenPrefillData {
        CodePenPrefillData {
            title: Some("OpenPencil demo".into()),
            description: Some("Generated showcase".into()),
            tags: Some(vec!["openpencil".into()]),
            private: Some(false),
            layout: Some("left".into()),
            html: "<main id=\"root\"></main>".into(),
            html_pre_processor: "none".into(),
            css: "body { margin: 0 }".into(),
            css_pre_processor: "none".into(),
            js: "document.querySelector('#root')".into(),
            js_pre_processor: "none".into(),
        }
    }

    #[test]
    fn prefill_contract_is_closed_and_compiled_only() {
        let parsed: CodePenPrefillRequest = serde_json::from_str(
            r#"{"data":{"title":"Demo","html":"<main></main>","html_pre_processor":"none","css":"","css_pre_processor":"none","js":"","js_pre_processor":"none"}}"#,
        )
        .expect("closed contract");
        validate_prefill_data(&parsed.data).expect("valid Prefill");
        assert!(serde_json::from_str::<CodePenPrefillRequest>(
            r#"{"data":{"html":"","html_pre_processor":"none","css":"","css_pre_processor":"none","js":"","js_pre_processor":"none","endpoint":"https://evil.test"}}"#
        )
        .is_err());
        let mut unsupported = prefill_data();
        unsupported.js_pre_processor = "babel".into();
        assert!(validate_prefill_data(&unsupported).is_err());
    }

    #[test]
    fn launcher_escapes_untrusted_prefill_data_inside_the_form() {
        let payload = r#"{"html":"</script><script>window.pwned=true</script>","title":"\" autofocus onfocus=alert(1) x=\""}"#;
        let launcher = prefill_launcher_html(payload);
        assert!(!launcher.contains("</script><script>window.pwned"));
        assert!(!launcher.contains("value=\"{\"html\""));
        assert!(launcher.contains("&lt;/script&gt;&lt;script&gt;window.pwned=true"));
        assert!(launcher.contains(CODEPEN_PREFILL_ENDPOINT));
        assert_eq!(
            launcher.matches("document.getElementById").count(),
            1,
            "only the fixed launcher script may execute"
        );
    }

    #[test]
    fn stale_cleanup_is_bounded_to_owned_regular_files() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let old_html = directory.path().join("openpencil-codepen-old.html");
        let old_fig = directory.path().join("openpencil-codepen-old.fig");
        let unrelated = directory.path().join("other.html");
        fs::write(&old_html, b"prefill").expect("write html");
        fs::write(&old_fig, b"snapshot").expect("write fig");
        fs::write(&unrelated, b"unrelated").expect("write unrelated");

        cleanup_stale_codepen_files_in(
            directory.path(),
            SystemTime::now() + Duration::from_secs(2),
            Duration::from_secs(1),
        );

        assert!(!old_html.exists());
        assert!(!old_fig.exists());
        assert!(unrelated.exists());
    }
}
