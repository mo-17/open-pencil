use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex,
    },
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{
    webview::{NewWindowResponse, PageLoadEvent},
    AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

const MAIN_WINDOW_LABEL: &str = "main";
const PREVIEW_WINDOW_LABEL: &str = "lowcode-preview-popout";
const PREVIEW_WINDOW_WRAPPER_PATH: &str = "preview-popout.html";
const PREVIEW_WINDOW_DESTROYED_EVENT: &str = "preview-window-destroyed";
const PREVIEW_WINDOW_INTENT_EVENT: &str = "preview-window-intent";
const MAX_PREVIEW_ROOT_URL_BYTES: usize = 128;
const MAX_PREVIEW_PATH_BYTES: usize = 2_048;
const PREVIEW_WINDOW_DESTROY_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PreviewWindowControls {
    toolbar: bool,
    reload: bool,
    focus_editor: bool,
    diagnostics: bool,
    export_microfrontend: bool,
    deploy: bool,
    always_on_top: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreviewWindowRequest {
    url: String,
    port: u16,
    path: String,
    controls: PreviewWindowControls,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
enum PreviewWindowOpenAction {
    Created,
    Focused,
    Navigated,
    Recreated,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
enum PreviewWindowUpdateAction {
    Unchanged,
    Navigated,
    Recreated,
}

#[derive(Debug, Serialize)]
pub struct PreviewWindowOpenResult {
    label: &'static str,
    url: String,
    action: PreviewWindowOpenAction,
}

#[derive(Debug, Serialize)]
pub struct PreviewWindowUpdateResult {
    label: &'static str,
    url: String,
    action: PreviewWindowUpdateAction,
}

#[derive(Clone, Debug, Serialize)]
struct PreviewWindowDestroyedPayload {
    label: &'static str,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct PreviewWindowPayload {
    url: String,
    port: u16,
    path: String,
    controls: PreviewWindowControls,
    revision: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum PreviewWindowIntent {
    Diagnostics {},
    ExportMicrofrontend {},
    Deploy {},
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct PreviewOrigin {
    host: String,
    port: u16,
}

#[derive(Default)]
struct PreviewWindowRuntime {
    revision: u64,
    destination: Option<Url>,
}

#[derive(Clone)]
struct PreviewWindowLifecycle {
    generation: u64,
    notify_on_destroy: Arc<AtomicBool>,
    programmatic_destroy: Arc<AtomicBool>,
    destroyed: Arc<(Mutex<bool>, Condvar)>,
}

impl PreviewWindowLifecycle {
    fn new(generation: u64) -> Self {
        Self {
            generation,
            notify_on_destroy: Arc::new(AtomicBool::new(true)),
            programmatic_destroy: Arc::new(AtomicBool::new(false)),
            destroyed: Arc::new((Mutex::new(false), Condvar::new())),
        }
    }

    fn signal_destroyed(&self) {
        let (destroyed, ready) = &*self.destroyed;
        if let Ok(mut destroyed) = destroyed.lock() {
            *destroyed = true;
            ready.notify_all();
        }
    }

    fn wait_until_destroyed(&self, timeout: Duration) -> Result<(), String> {
        let (destroyed, ready) = &*self.destroyed;
        let destroyed = destroyed
            .lock()
            .map_err(|_| "preview window destroy state is unavailable".to_string())?;
        let (destroyed, result) = ready
            .wait_timeout_while(destroyed, timeout, |destroyed| !*destroyed)
            .map_err(|_| "preview window destroy state is unavailable".to_string())?;
        if *destroyed {
            Ok(())
        } else if result.timed_out() {
            Err("timed out waiting for the preview window to close".into())
        } else {
            Err("preview window did not confirm that it closed".into())
        }
    }
}

#[derive(Default)]
pub struct PreviewWindowState {
    operations: Arc<Mutex<PreviewWindowRuntime>>,
    lifecycle: Arc<Mutex<Option<PreviewWindowLifecycle>>>,
    latest_payload: Arc<Mutex<Option<PreviewWindowPayload>>>,
}

impl PreviewOrigin {
    fn from_root_url(url: &Url, expected_port: u16) -> Result<Self, String> {
        if expected_port == 0 {
            return Err("preview port must be between 1 and 65535".into());
        }
        if url.scheme() != "http" {
            return Err("preview URL must use http".into());
        }
        if !url.username().is_empty() || url.password().is_some() {
            return Err("preview URL must not contain credentials".into());
        }
        let host = url
            .host_str()
            .filter(|host| matches!(*host, "localhost" | "127.0.0.1"))
            .ok_or_else(|| "preview URL host must be localhost or 127.0.0.1".to_string())?;
        if url.port() != Some(expected_port) {
            return Err("preview URL port must match request.port".into());
        }

        Ok(Self {
            host: host.to_string(),
            port: expected_port,
        })
    }

    fn matches(&self, url: &Url) -> bool {
        url.scheme() == "http"
            && url.username().is_empty()
            && url.password().is_none()
            && url.host_str() == Some(self.host.as_str())
            && url.port() == Some(self.port)
    }
}

fn validate_preview_path(path: &str) -> Result<(), String> {
    if path.is_empty() || path.len() > MAX_PREVIEW_PATH_BYTES {
        return Err(format!(
            "preview path must contain 1 to {MAX_PREVIEW_PATH_BYTES} bytes"
        ));
    }
    if !path.starts_with('/') || path.starts_with("//") {
        return Err("preview path must be an absolute same-origin path".into());
    }
    if path.contains(['\\', '?', '#']) || path.chars().any(char::is_control) {
        return Err("preview path contains a forbidden character".into());
    }
    if !path.bytes().all(|byte| {
        byte.is_ascii_alphanumeric()
            || matches!(byte, b'/' | b'-' | b'_' | b'.' | b':' | b'*' | b'~')
    }) {
        return Err("preview path contains a non-route character".into());
    }
    if path.split('/').any(|segment| matches!(segment, "." | "..")) {
        return Err("preview path must not contain dot segments".into());
    }
    Ok(())
}

fn preview_destination(request: &PreviewWindowRequest) -> Result<(Url, PreviewOrigin), String> {
    if request.url.is_empty() || request.url.len() > MAX_PREVIEW_ROOT_URL_BYTES {
        return Err(format!(
            "preview URL must contain 1 to {MAX_PREVIEW_ROOT_URL_BYTES} bytes"
        ));
    }
    let root = Url::parse(&request.url).map_err(|_| "preview URL is invalid".to_string())?;
    if root.as_str() != request.url {
        return Err("preview URL must use its canonical form".into());
    }
    let origin = PreviewOrigin::from_root_url(&root, request.port)?;
    if root.path() != "/" || root.query().is_some() || root.fragment().is_some() {
        return Err("preview URL must be a loopback server root without query or fragment".into());
    }
    validate_preview_path(&request.path)?;

    let destination = root
        .join(&request.path)
        .map_err(|_| "preview path could not be resolved".to_string())?;
    if !origin.matches(&destination)
        || destination.query().is_some()
        || destination.fragment().is_some()
    {
        return Err("preview path escaped the validated loopback origin".into());
    }
    Ok((destination, origin))
}

fn require_main_caller(caller: &WebviewWindow) -> Result<(), String> {
    if caller.label() == MAIN_WINDOW_LABEL {
        Ok(())
    } else {
        Err("preview window commands may only be invoked by the main window".into())
    }
}

fn require_preview_window_caller(caller: &WebviewWindow) -> Result<(), String> {
    if caller.label() == PREVIEW_WINDOW_LABEL {
        Ok(())
    } else {
        Err("preview window control commands may only be invoked by the preview window".into())
    }
}

fn show_and_focus_window(window: &WebviewWindow, description: &str) -> Result<(), String> {
    window
        .show()
        .map_err(|error| format!("failed to show {description}: {error}"))?;
    window
        .unminimize()
        .map_err(|error| format!("failed to restore {description}: {error}"))?;
    window
        .set_focus()
        .map_err(|error| format!("failed to focus {description}: {error}"))
}

fn focus_preview_window(window: &WebviewWindow) -> Result<(), String> {
    show_and_focus_window(window, "preview window")
}

fn allows_always_on_top_control(controls: PreviewWindowControls) -> bool {
    controls.toolbar && controls.always_on_top
}

fn allows_focus_editor_control(controls: PreviewWindowControls) -> bool {
    controls.toolbar && controls.focus_editor
}

fn allows_preview_window_intent(
    controls: PreviewWindowControls,
    intent: PreviewWindowIntent,
) -> bool {
    controls.toolbar
        && match intent {
            PreviewWindowIntent::Diagnostics {} => controls.diagnostics,
            PreviewWindowIntent::ExportMicrofrontend {} => controls.export_microfrontend,
            PreviewWindowIntent::Deploy {} => controls.deploy,
        }
}

fn enforce_preview_window_controls(
    window: &WebviewWindow,
    controls: PreviewWindowControls,
) -> Result<(), String> {
    if allows_always_on_top_control(controls) {
        return Ok(());
    }
    window
        .set_always_on_top(false)
        .map_err(|error| format!("failed to disable preview window always-on-top: {error}"))
}

fn app_wrapper_url(mut url: Url) -> Url {
    url.set_path(&format!("/{PREVIEW_WINDOW_WRAPPER_PATH}"));
    url.set_query(None);
    url.set_fragment(None);
    url
}

fn preview_wrapper_url(caller: &WebviewWindow) -> Result<Url, String> {
    caller
        .url()
        .map(app_wrapper_url)
        .map_err(|error| format!("failed to resolve the app URL: {error}"))
}

fn is_allowed_preview_navigation(url: &Url, wrapper_url: &Url) -> bool {
    if url == wrapper_url {
        return true;
    }
    let Some(port) = url.port() else {
        return false;
    };
    PreviewOrigin::from_root_url(url, port).is_ok()
        && url.query().is_none()
        && url.fragment().is_none()
        && validate_preview_path(url.path()).is_ok()
}

fn next_payload(
    runtime: &mut PreviewWindowRuntime,
    request: &PreviewWindowRequest,
) -> Result<PreviewWindowPayload, String> {
    runtime.revision = runtime
        .revision
        .checked_add(1)
        .ok_or_else(|| "preview window revision is exhausted".to_string())?;
    Ok(PreviewWindowPayload {
        url: request.url.clone(),
        port: request.port,
        path: request.path.clone(),
        controls: request.controls,
        revision: runtime.revision,
    })
}

fn payload_json(payload: &PreviewWindowPayload) -> Result<String, String> {
    serde_json::to_string(payload)
        .map_err(|error| format!("failed to serialize preview window payload: {error}"))
}

fn initial_payload_script(payload: &PreviewWindowPayload) -> Result<String, String> {
    Ok(format!(
        "window.__OPENPENCIL_PREVIEW_POPOUT_INITIAL__ = {};",
        payload_json(payload)?
    ))
}

fn update_payload_script(payload: &PreviewWindowPayload) -> Result<String, String> {
    Ok(format!(
        "(() => {{ const payload = {}; const update = window.__OPENPENCIL_PREVIEW_POPOUT_UPDATE__; if (typeof update === 'function') {{ update(payload); }} else {{ window.__OPENPENCIL_PREVIEW_POPOUT_PENDING__ = payload; }} }})();",
        payload_json(payload)?
    ))
}

fn update_preview_payload(
    window: &WebviewWindow,
    payload: &PreviewWindowPayload,
) -> Result<(), String> {
    window
        .eval(update_payload_script(payload)?)
        .map_err(|error| format!("failed to update preview window: {error}"))
}

fn remember_latest_payload(
    state: &PreviewWindowState,
    payload: &PreviewWindowPayload,
) -> Result<(), String> {
    *state
        .latest_payload
        .lock()
        .map_err(|_| "preview window payload state is unavailable".to_string())? =
        Some(payload.clone());
    Ok(())
}

fn clear_latest_payload(state: &PreviewWindowState) {
    if let Ok(mut latest) = state.latest_payload.lock() {
        *latest = None;
    }
}

fn latest_preview_window_controls(
    state: &PreviewWindowState,
) -> Result<PreviewWindowControls, String> {
    state
        .latest_payload
        .lock()
        .map_err(|_| "preview window payload state is unavailable".to_string())?
        .as_ref()
        .map(|payload| payload.controls)
        .ok_or_else(|| "preview window controls are unavailable".to_string())
}

fn clone_latest_preview_window_payload(
    state: &PreviewWindowState,
) -> Result<PreviewWindowPayload, String> {
    state
        .latest_payload
        .lock()
        .map_err(|_| "preview window payload state is unavailable".to_string())?
        .clone()
        .ok_or_else(|| "preview window payload is unavailable".to_string())
}

fn latest_preview_window_payload(
    caller: &WebviewWindow,
    state: &PreviewWindowState,
) -> Result<PreviewWindowPayload, String> {
    require_preview_window_caller(caller)?;
    let _operations = state
        .operations
        .lock()
        .map_err(|_| "preview window state is unavailable".to_string())?;
    clone_latest_preview_window_payload(state)
}

fn emit_destroyed(app: &AppHandle) {
    let _ = app.emit_to(
        MAIN_WINDOW_LABEL,
        PREVIEW_WINDOW_DESTROYED_EVENT,
        PreviewWindowDestroyedPayload {
            label: PREVIEW_WINDOW_LABEL,
        },
    );
}

fn finish_preview_window_lifecycle(
    lifecycles: &Mutex<Option<PreviewWindowLifecycle>>,
    lifecycle: &PreviewWindowLifecycle,
) -> Option<bool> {
    lifecycles.lock().ok().and_then(|mut current| {
        if current.as_ref().map(|item| item.generation) != Some(lifecycle.generation) {
            return None;
        }
        *current = None;
        Some(lifecycle.notify_on_destroy.load(Ordering::Acquire))
    })
}

fn current_preview_window_lifecycle(
    state: &PreviewWindowState,
) -> Result<PreviewWindowLifecycle, String> {
    state
        .lifecycle
        .lock()
        .map_err(|_| "preview window lifecycle state is unavailable".to_string())?
        .clone()
        .ok_or_else(|| "preview window lifecycle is unavailable".to_string())
}

fn destroy_preview_window_and_wait(
    window: &WebviewWindow,
    state: &PreviewWindowState,
    notify_on_destroy: bool,
) -> Result<(), String> {
    let lifecycle = current_preview_window_lifecycle(state)?;
    lifecycle
        .programmatic_destroy
        .store(true, Ordering::Release);
    lifecycle
        .notify_on_destroy
        .store(notify_on_destroy, Ordering::Release);
    if let Err(error) = window.destroy() {
        lifecycle
            .programmatic_destroy
            .store(false, Ordering::Release);
        lifecycle.notify_on_destroy.store(true, Ordering::Release);
        return Err(format!("failed to close preview window: {error}"));
    }
    if let Err(error) = lifecycle.wait_until_destroyed(PREVIEW_WINDOW_DESTROY_TIMEOUT) {
        // If the runtime delivers Destroyed after our bounded wait, it must be
        // treated as a real close rather than silently suppressing the main
        // window notification forever.
        lifecycle
            .programmatic_destroy
            .store(false, Ordering::Release);
        lifecycle.notify_on_destroy.store(true, Ordering::Release);
        return Err(error);
    }
    Ok(())
}

fn create_preview_window(
    app: &AppHandle,
    state: &PreviewWindowState,
    payload: &PreviewWindowPayload,
    wrapper_url: &Url,
    focused: bool,
) -> Result<WebviewWindow, String> {
    let lifecycle = PreviewWindowLifecycle::new(payload.revision);
    let allowed_wrapper_url = wrapper_url.clone();
    let replay_wrapper_url = wrapper_url.clone();
    let latest_for_page_load = state.latest_payload.clone();
    let window = WebviewWindowBuilder::new(
        app,
        PREVIEW_WINDOW_LABEL,
        WebviewUrl::App(PathBuf::from(PREVIEW_WINDOW_WRAPPER_PATH)),
    )
    .initialization_script(initial_payload_script(payload)?)
    .title("OpenPencil Compiler Preview")
    .inner_size(960.0, 720.0)
    .min_inner_size(360.0, 240.0)
    .resizable(true)
    .always_on_top(false)
    .visible(true)
    .focused(focused)
    .devtools(false)
    // WKWebView applies this callback to the sandboxed child frame too. Keep
    // the trusted wrapper fixed while admitting only the same strict loopback
    // route grammar that native requests and the shell validate independently.
    .on_navigation(move |url| is_allowed_preview_navigation(url, &allowed_wrapper_url))
    .on_new_window(|_, _| NewWindowResponse::Deny)
    .on_page_load(move |window, event| {
        if event.event() != PageLoadEvent::Finished || event.url() != &replay_wrapper_url {
            return;
        }
        let latest = latest_for_page_load
            .lock()
            .ok()
            .and_then(|latest| latest.clone());
        if let Some(payload) = latest {
            let _ = update_preview_payload(&window, &payload);
        }
    })
    .build()
    .map_err(|error| format!("failed to create preview window: {error}"))?;

    *state
        .lifecycle
        .lock()
        .map_err(|_| "preview window lifecycle state is unavailable".to_string())? =
        Some(lifecycle.clone());
    let app_for_event = app.clone();
    let latest_for_destroy = state.latest_payload.clone();
    let lifecycles_for_destroy = state.lifecycle.clone();
    let operations_for_destroy = state.operations.clone();
    window.on_window_event(move |event| {
        if !matches!(event, WindowEvent::Destroyed) {
            return;
        }
        let finish = || {
            if finish_preview_window_lifecycle(&lifecycles_for_destroy, &lifecycle) == Some(true) {
                if let Ok(mut latest) = latest_for_destroy.lock() {
                    *latest = None;
                }
                emit_destroyed(&app_for_event);
            }
            // Release close/replacement waiters only after every side effect
            // from this generation is complete. Otherwise a quick reopen could
            // install new state between the ACK and a stale notification.
            lifecycle.signal_destroyed();
        };
        if lifecycle.programmatic_destroy.load(Ordering::Acquire) {
            // The command that initiated destroy already owns operations and
            // waits on this callback, so taking that lock here would deadlock.
            finish();
        } else if let Ok(_operations) = operations_for_destroy.lock() {
            // Native window close has no command-side owner. Serialize its
            // clear/notification with open and update so a quick reopen cannot
            // interleave new state with this generation's cleanup.
            finish();
        } else {
            lifecycle.signal_destroyed();
        }
    });
    Ok(window)
}

fn replace_preview_window(
    app: &AppHandle,
    state: &PreviewWindowState,
    current: &WebviewWindow,
    payload: &PreviewWindowPayload,
    wrapper_url: &Url,
    focused: bool,
) -> Result<WebviewWindow, String> {
    destroy_preview_window_and_wait(current, state, false)?;

    match create_preview_window(app, state, payload, wrapper_url, focused) {
        Ok(window) => Ok(window),
        Err(error) => {
            clear_latest_payload(state);
            emit_destroyed(app);
            Err(error)
        }
    }
}

fn open_preview_window_impl(
    app: &AppHandle,
    caller: &WebviewWindow,
    state: &PreviewWindowState,
    request: PreviewWindowRequest,
) -> Result<PreviewWindowOpenResult, String> {
    require_main_caller(caller)?;
    let (destination, _) = preview_destination(&request)?;
    let wrapper_url = preview_wrapper_url(caller)?;
    let mut runtime = state
        .operations
        .lock()
        .map_err(|_| "preview window state is unavailable".to_string())?;
    let current = app.get_webview_window(PREVIEW_WINDOW_LABEL);
    if let Some(current) = &current {
        enforce_preview_window_controls(current, request.controls)?;
    }
    let payload = next_payload(&mut runtime, &request)?;
    remember_latest_payload(state, &payload)?;

    let previous_destination = runtime.destination.as_ref();
    let (window, action) = if let Some(current) = current {
        let success_action = if previous_destination == Some(&destination) {
            PreviewWindowOpenAction::Focused
        } else {
            PreviewWindowOpenAction::Navigated
        };
        match update_preview_payload(&current, &payload) {
            Ok(()) => (current, success_action),
            Err(_) => (
                replace_preview_window(app, state, &current, &payload, &wrapper_url, true)?,
                PreviewWindowOpenAction::Recreated,
            ),
        }
    } else {
        (
            create_preview_window(app, state, &payload, &wrapper_url, true)?,
            PreviewWindowOpenAction::Created,
        )
    };

    focus_preview_window(&window)?;
    runtime.destination = Some(destination.clone());
    Ok(PreviewWindowOpenResult {
        label: PREVIEW_WINDOW_LABEL,
        url: destination.into(),
        action,
    })
}

fn update_preview_window_impl(
    app: &AppHandle,
    caller: &WebviewWindow,
    state: &PreviewWindowState,
    request: PreviewWindowRequest,
) -> Result<Option<PreviewWindowUpdateResult>, String> {
    require_main_caller(caller)?;
    let (destination, _) = preview_destination(&request)?;
    let wrapper_url = preview_wrapper_url(caller)?;
    let mut runtime = state
        .operations
        .lock()
        .map_err(|_| "preview window state is unavailable".to_string())?;
    let Some(current) = app.get_webview_window(PREVIEW_WINDOW_LABEL) else {
        return Ok(None);
    };
    enforce_preview_window_controls(&current, request.controls)?;
    let payload = next_payload(&mut runtime, &request)?;
    remember_latest_payload(state, &payload)?;

    let success_action = if runtime.destination.as_ref() == Some(&destination) {
        PreviewWindowUpdateAction::Unchanged
    } else {
        PreviewWindowUpdateAction::Navigated
    };
    let action = match update_preview_payload(&current, &payload) {
        Ok(()) => success_action,
        Err(_) => {
            replace_preview_window(app, state, &current, &payload, &wrapper_url, false)?;
            PreviewWindowUpdateAction::Recreated
        }
    };
    runtime.destination = Some(destination.clone());

    Ok(Some(PreviewWindowUpdateResult {
        label: PREVIEW_WINDOW_LABEL,
        url: destination.into(),
        action,
    }))
}

fn close_preview_window_impl(
    app: &AppHandle,
    caller: &WebviewWindow,
    state: &PreviewWindowState,
) -> Result<bool, String> {
    require_main_caller(caller)?;
    let mut runtime = state
        .operations
        .lock()
        .map_err(|_| "preview window state is unavailable".to_string())?;
    let Some(window) = app.get_webview_window(PREVIEW_WINDOW_LABEL) else {
        runtime.destination = None;
        clear_latest_payload(state);
        return Ok(false);
    };
    destroy_preview_window_and_wait(&window, state, true)?;
    runtime.destination = None;
    clear_latest_payload(state);
    Ok(true)
}

fn focus_preview_editor_window_impl(
    app: &AppHandle,
    caller: &WebviewWindow,
    state: &PreviewWindowState,
) -> Result<(), String> {
    require_preview_window_caller(caller)?;
    let _operations = state
        .operations
        .lock()
        .map_err(|_| "preview window state is unavailable".to_string())?;
    if !allows_focus_editor_control(latest_preview_window_controls(state)?) {
        return Err("preview window focus-editor control is disabled".into());
    }
    let main = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "editor window is unavailable".to_string())?;
    show_and_focus_window(&main, "editor window")
}

fn send_preview_window_intent_impl(
    app: &AppHandle,
    caller: &WebviewWindow,
    state: &PreviewWindowState,
    intent: PreviewWindowIntent,
) -> Result<(), String> {
    require_preview_window_caller(caller)?;
    let _operations = state
        .operations
        .lock()
        .map_err(|_| "preview window state is unavailable".to_string())?;
    let controls = latest_preview_window_controls(state)?;
    if !allows_preview_window_intent(controls, intent) {
        return Err("preview window action is disabled".into());
    }
    let main = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "editor window is unavailable".to_string())?;
    show_and_focus_window(&main, "editor window")?;
    app.emit_to(MAIN_WINDOW_LABEL, PREVIEW_WINDOW_INTENT_EVENT, intent)
        .map_err(|error| format!("failed to deliver preview window intent: {error}"))
}

fn set_preview_window_always_on_top_impl(
    caller: &WebviewWindow,
    state: &PreviewWindowState,
    enabled: bool,
) -> Result<(), String> {
    require_preview_window_caller(caller)?;
    let _operations = state
        .operations
        .lock()
        .map_err(|_| "preview window state is unavailable".to_string())?;
    let controls = latest_preview_window_controls(state)?;
    if !allows_always_on_top_control(controls) {
        return Err("preview window always-on-top control is disabled".into());
    }
    caller
        .set_always_on_top(enabled)
        .map_err(|error| format!("failed to update preview window always-on-top: {error}"))
}

#[tauri::command]
pub async fn open_preview_window(
    app: AppHandle,
    caller: WebviewWindow,
    state: tauri::State<'_, PreviewWindowState>,
    request: PreviewWindowRequest,
) -> Result<PreviewWindowOpenResult, String> {
    open_preview_window_impl(&app, &caller, &state, request)
}

#[tauri::command]
pub async fn update_preview_window(
    app: AppHandle,
    caller: WebviewWindow,
    state: tauri::State<'_, PreviewWindowState>,
    request: PreviewWindowRequest,
) -> Result<Option<PreviewWindowUpdateResult>, String> {
    update_preview_window_impl(&app, &caller, &state, request)
}

#[tauri::command]
pub async fn close_preview_window(
    app: AppHandle,
    caller: WebviewWindow,
    state: tauri::State<'_, PreviewWindowState>,
) -> Result<bool, String> {
    close_preview_window_impl(&app, &caller, &state)
}

#[tauri::command]
pub async fn focus_preview_editor_window(
    app: AppHandle,
    caller: WebviewWindow,
    state: tauri::State<'_, PreviewWindowState>,
) -> Result<(), String> {
    focus_preview_editor_window_impl(&app, &caller, &state)
}

#[tauri::command]
pub async fn get_preview_window_latest_payload(
    caller: WebviewWindow,
    state: tauri::State<'_, PreviewWindowState>,
) -> Result<PreviewWindowPayload, String> {
    latest_preview_window_payload(&caller, &state)
}

#[tauri::command]
pub async fn send_preview_window_intent(
    app: AppHandle,
    caller: WebviewWindow,
    state: tauri::State<'_, PreviewWindowState>,
    intent: PreviewWindowIntent,
) -> Result<(), String> {
    send_preview_window_intent_impl(&app, &caller, &state, intent)
}

#[tauri::command]
pub async fn set_preview_window_always_on_top(
    caller: WebviewWindow,
    state: tauri::State<'_, PreviewWindowState>,
    enabled: bool,
) -> Result<(), String> {
    set_preview_window_always_on_top_impl(&caller, &state, enabled)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn controls(always_on_top: bool) -> PreviewWindowControls {
        PreviewWindowControls {
            toolbar: true,
            reload: true,
            focus_editor: true,
            diagnostics: true,
            export_microfrontend: true,
            deploy: true,
            always_on_top,
        }
    }

    fn request(url: &str, port: u16, path: &str) -> PreviewWindowRequest {
        PreviewWindowRequest {
            url: url.into(),
            port,
            path: path.into(),
            controls: controls(true),
        }
    }

    #[test]
    fn accepts_strict_loopback_roots_and_routes() {
        let (localhost, origin) =
            preview_destination(&request("http://localhost:60140/", 60140, "/products/:id"))
                .unwrap();
        assert_eq!(localhost.as_str(), "http://localhost:60140/products/:id");
        assert_eq!(
            origin,
            PreviewOrigin {
                host: "localhost".into(),
                port: 60140
            }
        );

        let (ipv4, _) =
            preview_destination(&request("http://127.0.0.1:60141/", 60141, "/about-us")).unwrap();
        assert_eq!(ipv4.as_str(), "http://127.0.0.1:60141/about-us");
    }

    #[test]
    fn rejects_non_loopback_or_ambiguous_origins() {
        for invalid in [
            request("https://localhost:60140/", 60140, "/"),
            request("http://example.com:60140/", 60140, "/"),
            request("http://localhost.:60140/", 60140, "/"),
            request("http://[::1]:60140/", 60140, "/"),
            request("http://user@localhost:60140/", 60140, "/"),
            request("http://localhost:60140/", 60141, "/"),
            request("http://localhost/", 60140, "/"),
            request("http://localhost:60140/not-root", 60140, "/"),
            request("http://localhost:60140/?query=1", 60140, "/"),
            request("http://localhost:60140/#fragment", 60140, "/"),
            request("HTTP://LOCALHOST:60140/", 60140, "/"),
            request("http://localhost:060140/", 60140, "/"),
        ] {
            assert!(preview_destination(&invalid).is_err(), "{invalid:?}");
        }
    }

    #[test]
    fn rejects_paths_that_are_not_bounded_routes() {
        let too_long = format!("/{}", "a".repeat(MAX_PREVIEW_PATH_BYTES));
        for path in [
            "",
            "relative",
            "//example.com/path",
            "/back\\slash",
            "/query?value=1",
            "/fragment#value",
            "/line\nfeed",
            "/percent%2fescape",
            "/dot/../segment",
            too_long.as_str(),
        ] {
            assert!(
                preview_destination(&request("http://localhost:60140/", 60140, path)).is_err(),
                "{path:?}"
            );
        }
    }

    #[test]
    fn same_origin_requires_exact_loopback_host_and_port() {
        let origin = PreviewOrigin {
            host: "localhost".into(),
            port: 60140,
        };
        assert!(origin.matches(&Url::parse("http://localhost:60140/other").unwrap()));
        assert!(!origin.matches(&Url::parse("http://127.0.0.1:60140/").unwrap()));
        assert!(!origin.matches(&Url::parse("http://localhost:60141/").unwrap()));
        assert!(!origin.matches(&Url::parse("https://localhost:60140/").unwrap()));
    }

    #[test]
    fn wrapper_url_is_fixed_for_dev_and_production_app_origins() {
        for (current, expected) in [
            (
                "http://localhost:1420/editor?tab=design#canvas",
                "http://localhost:1420/preview-popout.html",
            ),
            (
                "tauri://localhost/index.html#/editor",
                "tauri://localhost/preview-popout.html",
            ),
            (
                "http://tauri.localhost/index.html",
                "http://tauri.localhost/preview-popout.html",
            ),
        ] {
            assert_eq!(
                app_wrapper_url(Url::parse(current).unwrap()).as_str(),
                expected
            );
        }
    }

    #[test]
    fn wrapper_navigation_admits_only_the_fixed_shell_or_strict_loopback_routes() {
        let wrapper = Url::parse("tauri://localhost/preview-popout.html").unwrap();
        for allowed in [
            "tauri://localhost/preview-popout.html",
            "http://127.0.0.1:60140/",
            "http://localhost:60141/products/:id",
        ] {
            assert!(is_allowed_preview_navigation(
                &Url::parse(allowed).unwrap(),
                &wrapper
            ));
        }
        for blocked in [
            "tauri://localhost/index.html",
            "https://127.0.0.1:60140/",
            "http://example.com:60140/",
            "http://127.0.0.1/",
            "http://127.0.0.1:60140/path?query=1",
            "http://127.0.0.1:60140/path%2fescape",
        ] {
            assert!(!is_allowed_preview_navigation(
                &Url::parse(blocked).unwrap(),
                &wrapper
            ));
        }
    }

    #[test]
    fn request_contract_rejects_unknown_fields_and_out_of_range_ports() {
        assert!(
            serde_json::from_value::<PreviewWindowRequest>(serde_json::json!({
                "url": "http://localhost:60140/",
                "port": 60140,
                "path": "/",
                "controls": {
                    "toolbar": true,
                    "reload": true,
                    "focusEditor": true,
                    "diagnostics": true,
                    "exportMicrofrontend": true,
                    "deploy": true,
                    "alwaysOnTop": true
                },
                "unexpected": true
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<PreviewWindowRequest>(serde_json::json!({
                "url": "http://localhost:60140/",
                "port": 65_536,
                "path": "/",
                "controls": {
                    "toolbar": true,
                    "reload": true,
                    "focusEditor": true,
                    "diagnostics": true,
                    "exportMicrofrontend": true,
                    "deploy": true,
                    "alwaysOnTop": true
                }
            }))
            .is_err()
        );
    }

    #[test]
    fn controls_require_exact_camel_case_booleans() {
        let valid = serde_json::json!({
            "url": "http://localhost:60140/",
            "port": 60140,
            "path": "/",
            "controls": {
                "toolbar": true,
                "reload": true,
                "focusEditor": true,
                "diagnostics": true,
                "exportMicrofrontend": true,
                "deploy": true,
                "alwaysOnTop": false
            }
        });
        let parsed = serde_json::from_value::<PreviewWindowRequest>(valid.clone()).unwrap();
        assert_eq!(parsed.controls, controls(false));

        for invalid_controls in [
            serde_json::json!({
                "toolbar": true,
                "reload": false,
                "focusEditor": true,
                "diagnostics": true,
                "exportMicrofrontend": true,
                "deploy": true
            }),
            serde_json::json!({
                "toolbar": true,
                "reload": false,
                "focusEditor": true,
                "diagnostics": true,
                "exportMicrofrontend": true,
                "deploy": true,
                "alwaysOnTop": "yes"
            }),
            serde_json::json!({
                "toolbar": true,
                "reload": false,
                "focusEditor": true,
                "diagnostics": true,
                "exportMicrofrontend": true,
                "deploy": true,
                "alwaysOnTop": false,
                "unexpected": true
            }),
            serde_json::json!({
                "toolbar": true,
                "reload": false,
                "focus_editor": true,
                "diagnostics": true,
                "export_microfrontend": true,
                "deploy": true,
                "always_on_top": false
            }),
        ] {
            let mut invalid = valid.clone();
            invalid["controls"] = invalid_controls;
            assert!(serde_json::from_value::<PreviewWindowRequest>(invalid).is_err());
        }
    }

    #[test]
    fn latest_controls_gate_always_on_top_permission() {
        let state = PreviewWindowState::default();
        assert!(latest_preview_window_controls(&state).is_err());

        let mut runtime = PreviewWindowRuntime::default();
        let mut request = request("http://127.0.0.1:60140/", 60140, "/");
        request.controls = controls(false);
        let disabled = next_payload(&mut runtime, &request).unwrap();
        remember_latest_payload(&state, &disabled).unwrap();
        assert!(
            !latest_preview_window_controls(&state)
                .unwrap()
                .always_on_top
        );

        request.controls = controls(true);
        let enabled = next_payload(&mut runtime, &request).unwrap();
        remember_latest_payload(&state, &enabled).unwrap();
        assert!(
            latest_preview_window_controls(&state)
                .unwrap()
                .always_on_top
        );

        assert!(allows_always_on_top_control(controls(true)));
        assert!(!allows_always_on_top_control(controls(false)));
        assert!(!allows_always_on_top_control(PreviewWindowControls {
            toolbar: false,
            ..controls(true)
        }));
        assert!(allows_focus_editor_control(controls(true)));
        assert!(!allows_focus_editor_control(PreviewWindowControls {
            focus_editor: false,
            ..controls(true)
        }));

        for intent in [
            PreviewWindowIntent::Diagnostics {},
            PreviewWindowIntent::ExportMicrofrontend {},
            PreviewWindowIntent::Deploy {},
        ] {
            assert!(allows_preview_window_intent(controls(true), intent));
            assert!(!allows_preview_window_intent(
                PreviewWindowControls {
                    toolbar: false,
                    ..controls(true)
                },
                intent
            ));
        }
        assert!(!allows_preview_window_intent(
            PreviewWindowControls {
                diagnostics: false,
                ..controls(true)
            },
            PreviewWindowIntent::Diagnostics {}
        ));
        assert!(!allows_preview_window_intent(
            PreviewWindowControls {
                export_microfrontend: false,
                ..controls(true)
            },
            PreviewWindowIntent::ExportMicrofrontend {}
        ));
        assert!(!allows_preview_window_intent(
            PreviewWindowControls {
                deploy: false,
                ..controls(true)
            },
            PreviewWindowIntent::Deploy {}
        ));
    }

    #[test]
    fn intents_are_an_exact_closed_enum() {
        for (value, expected) in [
            (
                serde_json::json!({"type": "diagnostics"}),
                PreviewWindowIntent::Diagnostics {},
            ),
            (
                serde_json::json!({"type": "exportMicrofrontend"}),
                PreviewWindowIntent::ExportMicrofrontend {},
            ),
            (
                serde_json::json!({"type": "deploy"}),
                PreviewWindowIntent::Deploy {},
            ),
        ] {
            let parsed = serde_json::from_value::<PreviewWindowIntent>(value.clone()).unwrap();
            assert_eq!(parsed, expected);
            assert_eq!(serde_json::to_value(parsed).unwrap(), value);
        }
        for invalid in [
            serde_json::json!({"type": "settings"}),
            serde_json::json!({"type": "deploy", "url": "https://example.com"}),
            serde_json::json!("diagnostics"),
        ] {
            assert!(serde_json::from_value::<PreviewWindowIntent>(invalid).is_err());
        }
    }

    #[test]
    fn startup_handshake_returns_an_exact_clone_of_latest_payload_state() {
        let state = PreviewWindowState::default();
        let mut runtime = PreviewWindowRuntime::default();
        let request = request("http://127.0.0.1:60140/", 60140, "/products/:productId");
        let payload = next_payload(&mut runtime, &request).unwrap();
        remember_latest_payload(&state, &payload).unwrap();

        let returned = clone_latest_preview_window_payload(&state).unwrap();
        assert_eq!(returned, payload);
        assert_eq!(
            serde_json::to_value(returned).unwrap(),
            serde_json::json!({
                "url": "http://127.0.0.1:60140/",
                "port": 60140,
                "path": "/products/:productId",
                "controls": {
                    "toolbar": true,
                    "reload": true,
                    "focusEditor": true,
                    "diagnostics": true,
                    "exportMicrofrontend": true,
                    "deploy": true,
                    "alwaysOnTop": true
                },
                "revision": 1
            })
        );
    }

    #[test]
    fn destroy_lifecycle_waits_for_confirmation_and_ignores_stale_generations() {
        let lifecycles = Mutex::new(None);
        let old = PreviewWindowLifecycle::new(1);
        let current = PreviewWindowLifecycle::new(2);
        *lifecycles.lock().unwrap() = Some(current.clone());

        assert_eq!(finish_preview_window_lifecycle(&lifecycles, &old), None);
        assert_eq!(
            lifecycles
                .lock()
                .unwrap()
                .as_ref()
                .map(|lifecycle| lifecycle.generation),
            Some(2)
        );
        old.signal_destroyed();
        assert!(old.wait_until_destroyed(Duration::ZERO).is_ok());

        assert_eq!(
            finish_preview_window_lifecycle(&lifecycles, &current),
            Some(true)
        );
        assert!(lifecycles.lock().unwrap().is_none());
        current.signal_destroyed();
        assert!(current.wait_until_destroyed(Duration::ZERO).is_ok());
    }

    #[test]
    fn replacement_destroy_confirmation_is_silent_but_clears_its_lifecycle() {
        let lifecycles = Mutex::new(None);
        let lifecycle = PreviewWindowLifecycle::new(7);
        lifecycle.notify_on_destroy.store(false, Ordering::Release);
        *lifecycles.lock().unwrap() = Some(lifecycle.clone());

        assert_eq!(
            finish_preview_window_lifecycle(&lifecycles, &lifecycle),
            Some(false)
        );
        assert!(lifecycles.lock().unwrap().is_none());
        lifecycle.signal_destroyed();
        assert!(lifecycle.wait_until_destroyed(Duration::ZERO).is_ok());
    }

    #[test]
    fn destroy_lifecycle_has_a_bounded_wait() {
        let lifecycle = PreviewWindowLifecycle::new(1);
        assert_eq!(
            lifecycle.wait_until_destroyed(Duration::ZERO).unwrap_err(),
            "timed out waiting for the preview window to close"
        );
    }

    #[test]
    fn lifecycle_distinguishes_native_and_command_owned_destroy() {
        let lifecycle = PreviewWindowLifecycle::new(1);
        assert!(!lifecycle.programmatic_destroy.load(Ordering::Acquire));
        lifecycle
            .programmatic_destroy
            .store(true, Ordering::Release);
        assert!(lifecycle.programmatic_destroy.load(Ordering::Acquire));
    }

    #[test]
    fn payloads_keep_validated_fields_and_monotonic_revisions() {
        let mut runtime = PreviewWindowRuntime::default();
        let request = request("http://127.0.0.1:60140/", 60140, "/products/:id");
        preview_destination(&request).unwrap();

        let first = next_payload(&mut runtime, &request).unwrap();
        let second = next_payload(&mut runtime, &request).unwrap();
        assert_eq!(
            first,
            PreviewWindowPayload {
                url: "http://127.0.0.1:60140/".into(),
                port: 60140,
                path: "/products/:id".into(),
                controls: controls(true),
                revision: 1,
            }
        );
        assert_eq!(second.revision, 2);
    }

    #[test]
    fn scripts_deliver_data_without_navigating_the_wrapper() {
        let payload = PreviewWindowPayload {
            url: "http://127.0.0.1:60140/".into(),
            port: 60140,
            path: "/products/:id".into(),
            controls: controls(false),
            revision: 7,
        };
        let json = payload_json(&payload).unwrap();
        let initial = initial_payload_script(&payload).unwrap();
        let update = update_payload_script(&payload).unwrap();

        assert_eq!(
            initial,
            format!("window.__OPENPENCIL_PREVIEW_POPOUT_INITIAL__ = {json};")
        );
        assert!(update.contains(&format!("const payload = {json};")));
        assert!(update.contains("window.__OPENPENCIL_PREVIEW_POPOUT_UPDATE__"));
        assert!(update.contains("window.__OPENPENCIL_PREVIEW_POPOUT_PENDING__ = payload"));
        assert!(json.contains("\"focusEditor\":true"));
        assert!(json.contains("\"alwaysOnTop\":false"));
        assert!(!initial.contains("location"));
        assert!(!update.contains("location"));
    }

    #[test]
    fn implementation_uses_only_the_fixed_app_owned_wrapper() {
        let source = include_str!("preview_window.rs");
        assert_eq!(PREVIEW_WINDOW_WRAPPER_PATH, "preview-popout.html");
        assert!(source.contains("WebviewUrl::App(PathBuf::from(PREVIEW_WINDOW_WRAPPER_PATH))"));
        assert!(source.contains(".initialization_script(initial_payload_script(payload)?)"));
        assert!(source.contains(".devtools(false)"));
        assert!(source.contains(
            ".on_navigation(move |url| is_allowed_preview_navigation(url, &allowed_wrapper_url))"
        ));
        assert!(source.contains(".on_new_window(|_, _| NewWindowResponse::Deny)"));
        assert!(source.contains(".on_page_load(move |window, event|"));
        assert!(source.contains("event.event() != PageLoadEvent::Finished"));
        assert!(source.contains("update_preview_payload(&window, &payload)"));
        assert!(!source.contains(&["WebviewUrl", "::External"].concat()));
        assert!(!source.contains(&[".", "navigate("].concat()));
        assert!(source.contains(".always_on_top(false)"));
        let preview_caller_guard = ["require_preview_window_caller", "(caller)?;"].concat();
        assert_eq!(source.matches(&preview_caller_guard).count(), 4);
        assert!(source.contains("enforce_preview_window_controls(current, request.controls)?"));
        assert!(source.contains("enforce_preview_window_controls(&current, request.controls)?"));
        assert!(source.contains("pub async fn get_preview_window_latest_payload("));
        assert!(source.contains("latest_preview_window_payload(&caller, &state)"));
    }
}
