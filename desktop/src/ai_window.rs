use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex,
    },
    time::Duration,
};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::{
    webview::{NewWindowResponse, PageLoadEvent},
    AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

const MAIN_WINDOW_LABEL: &str = "main";
const AI_WINDOW_LABEL: &str = "ai-chat-popout";
const AI_WINDOW_WRAPPER_PATH: &str = "ai-popout.html";
const AI_WINDOW_DESTROYED_EVENT: &str = "ai-window-destroyed";
const AI_WINDOW_INTENT_EVENT: &str = "ai-window-intent";
const MAX_AI_WINDOW_ENVELOPE_BYTES: usize = 768 * 1024;
const MAX_AI_WINDOW_INTENT_TEXT_BYTES: usize = 32 * 1024;
const MAX_AI_WINDOW_INTENT_ID_BYTES: usize = 128;
const AI_WINDOW_DESTROY_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AIWindowControls {
    toolbar: bool,
    clear_chat: bool,
    focus_editor: bool,
    settings: bool,
    always_on_top: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AIWindowRequest {
    envelope: String,
    controls: AIWindowControls,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
enum AIWindowOpenAction {
    Created,
    Focused,
    Recreated,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
enum AIWindowUpdateAction {
    Updated,
    Recreated,
}

#[derive(Debug, Serialize)]
pub struct AIWindowOpenResult {
    label: &'static str,
    action: AIWindowOpenAction,
}

#[derive(Debug, Serialize)]
pub struct AIWindowUpdateResult {
    label: &'static str,
    action: AIWindowUpdateAction,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct AIWindowPayload {
    envelope: String,
    controls: AIWindowControls,
    revision: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum AIWindowIntent {
    Submit {
        text: String,
        #[serde(rename = "clientActionId")]
        client_action_id: String,
        #[serde(rename = "contextId")]
        context_id: String,
    },
    Stop {
        #[serde(rename = "clientActionId")]
        client_action_id: String,
        #[serde(rename = "contextId")]
        context_id: String,
    },
    Continue {
        #[serde(rename = "clientActionId")]
        client_action_id: String,
        #[serde(rename = "contextId")]
        context_id: String,
    },
    Clear {
        #[serde(rename = "clientActionId")]
        client_action_id: String,
        #[serde(rename = "contextId")]
        context_id: String,
    },
    OpenSettings {
        #[serde(rename = "clientActionId")]
        client_action_id: String,
        #[serde(rename = "contextId")]
        context_id: String,
    },
    ToolApproval {
        token: String,
        approved: bool,
        #[serde(rename = "clientActionId")]
        client_action_id: String,
        #[serde(rename = "contextId")]
        context_id: String,
    },
    Retry {
        #[serde(rename = "clientActionId")]
        client_action_id: String,
        #[serde(rename = "contextId")]
        context_id: String,
    },
}

#[derive(Clone, Debug, Serialize)]
struct AIWindowDestroyedPayload {
    label: &'static str,
}

#[derive(Default)]
struct AIWindowRuntime {
    revision: u64,
}

#[derive(Clone)]
struct AIWindowLifecycle {
    generation: u64,
    notify_on_destroy: Arc<AtomicBool>,
    programmatic_destroy: Arc<AtomicBool>,
    destroyed: Arc<(Mutex<bool>, Condvar)>,
}

impl AIWindowLifecycle {
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
            .map_err(|_| "AI window destroy state is unavailable".to_string())?;
        let (destroyed, result) = ready
            .wait_timeout_while(destroyed, timeout, |destroyed| !*destroyed)
            .map_err(|_| "AI window destroy state is unavailable".to_string())?;
        if *destroyed {
            Ok(())
        } else if result.timed_out() {
            Err("timed out waiting for the AI window to close".into())
        } else {
            Err("AI window did not confirm that it closed".into())
        }
    }
}

#[derive(Default)]
pub struct AIWindowState {
    operations: Arc<Mutex<AIWindowRuntime>>,
    lifecycle: Arc<Mutex<Option<AIWindowLifecycle>>>,
    latest_payload: Arc<Mutex<Option<AIWindowPayload>>>,
}

fn require_main_caller(caller: &WebviewWindow) -> Result<(), String> {
    if caller.label() == MAIN_WINDOW_LABEL {
        Ok(())
    } else {
        Err("AI window commands may only be invoked by the main window".into())
    }
}

fn require_ai_window_caller(caller: &WebviewWindow) -> Result<(), String> {
    if caller.label() == AI_WINDOW_LABEL {
        Ok(())
    } else {
        Err("AI window control commands may only be invoked by the AI window".into())
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

fn allows_always_on_top_control(controls: AIWindowControls) -> bool {
    controls.toolbar && controls.always_on_top
}

fn allows_focus_editor_control(controls: AIWindowControls) -> bool {
    controls.toolbar && controls.focus_editor
}

fn allows_ai_window_intent(controls: AIWindowControls, intent: &AIWindowIntent) -> bool {
    match intent {
        AIWindowIntent::Clear { .. } => controls.toolbar && controls.clear_chat,
        AIWindowIntent::OpenSettings { .. } => controls.toolbar && controls.settings,
        _ => true,
    }
}

fn enforce_ai_window_controls(
    window: &WebviewWindow,
    controls: AIWindowControls,
) -> Result<(), String> {
    if allows_always_on_top_control(controls) {
        return Ok(());
    }
    window
        .set_always_on_top(false)
        .map_err(|error| format!("failed to disable AI window always-on-top: {error}"))
}

fn validate_envelope(envelope: &str) -> Result<(), String> {
    if envelope.is_empty() || envelope.len() > MAX_AI_WINDOW_ENVELOPE_BYTES {
        return Err(format!(
            "AI window envelope must contain 1 to {MAX_AI_WINDOW_ENVELOPE_BYTES} bytes"
        ));
    }
    if envelope.len() % 4 != 0
        || !envelope
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'='))
    {
        return Err("AI window envelope must be canonical standard base64".into());
    }
    let decoded = BASE64_STANDARD
        .decode(envelope)
        .map_err(|_| "AI window envelope must be canonical standard base64".to_string())?;
    if BASE64_STANDARD.encode(&decoded) != envelope {
        return Err("AI window envelope must be canonical standard base64".into());
    }
    let decoded: serde_json::Value = serde_json::from_slice(&decoded)
        .map_err(|_| "AI window envelope must contain valid JSON".to_string())?;
    if !decoded.is_object() {
        return Err("AI window envelope JSON must be an object".into());
    }
    Ok(())
}

fn is_safe_intent_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_AI_WINDOW_INTENT_ID_BYTES
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric()
                || (index > 0 && matches!(byte, b':' | b'.' | b'_' | b'-' | b'~'))
        })
}

fn validate_intent_id(value: &str, name: &str) -> Result<(), String> {
    if is_safe_intent_id(value) {
        Ok(())
    } else {
        Err(format!(
            "AI window {name} must be a bounded opaque identifier"
        ))
    }
}

fn validate_intent_text(text: &str) -> Result<(), String> {
    if text.is_empty() || text.len() > MAX_AI_WINDOW_INTENT_TEXT_BYTES {
        return Err(format!(
            "AI window submit text must contain 1 to {MAX_AI_WINDOW_INTENT_TEXT_BYTES} bytes"
        ));
    }
    if text
        .chars()
        .any(|character| character.is_control() && !matches!(character, '\n' | '\r' | '\t'))
    {
        return Err("AI window submit text contains a forbidden control character".into());
    }
    Ok(())
}

fn validate_intent(intent: &AIWindowIntent) -> Result<(), String> {
    let (client_action_id, context_id) = match intent {
        AIWindowIntent::Submit {
            text,
            client_action_id,
            context_id,
        } => {
            validate_intent_text(text)?;
            (client_action_id, context_id)
        }
        AIWindowIntent::Stop {
            client_action_id,
            context_id,
        }
        | AIWindowIntent::Continue {
            client_action_id,
            context_id,
        }
        | AIWindowIntent::Clear {
            client_action_id,
            context_id,
        }
        | AIWindowIntent::OpenSettings {
            client_action_id,
            context_id,
        }
        | AIWindowIntent::Retry {
            client_action_id,
            context_id,
        } => (client_action_id, context_id),
        AIWindowIntent::ToolApproval {
            token,
            client_action_id,
            context_id,
            ..
        } => {
            validate_intent_id(token, "approval token")?;
            (client_action_id, context_id)
        }
    };
    validate_intent_id(client_action_id, "client action ID")?;
    validate_intent_id(context_id, "context ID")
}

fn app_wrapper_url(mut url: Url) -> Url {
    url.set_path(&format!("/{AI_WINDOW_WRAPPER_PATH}"));
    url.set_query(None);
    url.set_fragment(None);
    url
}

fn ai_wrapper_url(caller: &WebviewWindow) -> Result<Url, String> {
    caller
        .url()
        .map(app_wrapper_url)
        .map_err(|error| format!("failed to resolve the app URL: {error}"))
}

fn is_allowed_ai_navigation(url: &Url, wrapper_url: &Url) -> bool {
    url == wrapper_url
}

fn next_payload(
    runtime: &mut AIWindowRuntime,
    request: &AIWindowRequest,
) -> Result<AIWindowPayload, String> {
    validate_envelope(&request.envelope)?;
    runtime.revision = runtime
        .revision
        .checked_add(1)
        .ok_or_else(|| "AI window revision is exhausted".to_string())?;
    Ok(AIWindowPayload {
        envelope: request.envelope.clone(),
        controls: request.controls,
        revision: runtime.revision,
    })
}

fn payload_json(payload: &AIWindowPayload) -> Result<String, String> {
    serde_json::to_string(payload)
        .map_err(|error| format!("failed to serialize AI window payload: {error}"))
}

fn initial_payload_script(payload: &AIWindowPayload) -> Result<String, String> {
    Ok(format!(
        "window.__OPENPENCIL_AI_POPOUT_INITIAL__ = {};",
        payload_json(payload)?
    ))
}

fn update_payload_script(payload: &AIWindowPayload) -> Result<String, String> {
    Ok(format!(
        "(() => {{ const payload = {}; const update = window.__OPENPENCIL_AI_POPOUT_UPDATE__; if (typeof update === 'function') {{ update(payload); }} else {{ window.__OPENPENCIL_AI_POPOUT_PENDING__ = payload; }} }})();",
        payload_json(payload)?
    ))
}

fn update_ai_payload(window: &WebviewWindow, payload: &AIWindowPayload) -> Result<(), String> {
    window
        .eval(update_payload_script(payload)?)
        .map_err(|error| format!("failed to update AI window: {error}"))
}

fn remember_latest_payload(state: &AIWindowState, payload: &AIWindowPayload) -> Result<(), String> {
    *state
        .latest_payload
        .lock()
        .map_err(|_| "AI window payload state is unavailable".to_string())? = Some(payload.clone());
    Ok(())
}

fn clear_latest_payload(state: &AIWindowState) {
    if let Ok(mut latest) = state.latest_payload.lock() {
        *latest = None;
    }
}

fn latest_ai_window_controls(state: &AIWindowState) -> Result<AIWindowControls, String> {
    state
        .latest_payload
        .lock()
        .map_err(|_| "AI window payload state is unavailable".to_string())?
        .as_ref()
        .map(|payload| payload.controls)
        .ok_or_else(|| "AI window controls are unavailable".to_string())
}

fn clone_latest_ai_window_payload(state: &AIWindowState) -> Result<AIWindowPayload, String> {
    state
        .latest_payload
        .lock()
        .map_err(|_| "AI window payload state is unavailable".to_string())?
        .clone()
        .ok_or_else(|| "AI window payload is unavailable".to_string())
}

fn latest_ai_window_payload(
    caller: &WebviewWindow,
    state: &AIWindowState,
) -> Result<AIWindowPayload, String> {
    require_ai_window_caller(caller)?;
    let _operations = state
        .operations
        .lock()
        .map_err(|_| "AI window state is unavailable".to_string())?;
    clone_latest_ai_window_payload(state)
}

fn emit_destroyed(app: &AppHandle) {
    let _ = app.emit_to(
        MAIN_WINDOW_LABEL,
        AI_WINDOW_DESTROYED_EVENT,
        AIWindowDestroyedPayload {
            label: AI_WINDOW_LABEL,
        },
    );
}

fn finish_ai_window_lifecycle(
    lifecycles: &Mutex<Option<AIWindowLifecycle>>,
    lifecycle: &AIWindowLifecycle,
) -> Option<bool> {
    lifecycles.lock().ok().and_then(|mut current| {
        if current.as_ref().map(|item| item.generation) != Some(lifecycle.generation) {
            return None;
        }
        *current = None;
        Some(lifecycle.notify_on_destroy.load(Ordering::Acquire))
    })
}

fn current_ai_window_lifecycle(state: &AIWindowState) -> Result<AIWindowLifecycle, String> {
    state
        .lifecycle
        .lock()
        .map_err(|_| "AI window lifecycle state is unavailable".to_string())?
        .clone()
        .ok_or_else(|| "AI window lifecycle is unavailable".to_string())
}

fn destroy_ai_window_and_wait(
    window: &WebviewWindow,
    state: &AIWindowState,
    notify_on_destroy: bool,
) -> Result<(), String> {
    let lifecycle = current_ai_window_lifecycle(state)?;
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
        return Err(format!("failed to close AI window: {error}"));
    }
    if let Err(error) = lifecycle.wait_until_destroyed(AI_WINDOW_DESTROY_TIMEOUT) {
        lifecycle
            .programmatic_destroy
            .store(false, Ordering::Release);
        lifecycle.notify_on_destroy.store(true, Ordering::Release);
        return Err(error);
    }
    Ok(())
}

fn create_ai_window(
    app: &AppHandle,
    state: &AIWindowState,
    payload: &AIWindowPayload,
    wrapper_url: &Url,
    focused: bool,
) -> Result<WebviewWindow, String> {
    let lifecycle = AIWindowLifecycle::new(payload.revision);
    let allowed_wrapper_url = wrapper_url.clone();
    let replay_wrapper_url = wrapper_url.clone();
    let latest_for_page_load = state.latest_payload.clone();
    let window = WebviewWindowBuilder::new(
        app,
        AI_WINDOW_LABEL,
        WebviewUrl::App(PathBuf::from(AI_WINDOW_WRAPPER_PATH)),
    )
    .initialization_script(initial_payload_script(payload)?)
    .title("OpenPencil AI")
    .inner_size(480.0, 720.0)
    .min_inner_size(360.0, 480.0)
    .resizable(true)
    .always_on_top(false)
    .visible(true)
    .focused(focused)
    .devtools(false)
    .on_navigation(move |url| is_allowed_ai_navigation(url, &allowed_wrapper_url))
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
            let _ = update_ai_payload(&window, &payload);
        }
    })
    .build()
    .map_err(|error| format!("failed to create AI window: {error}"))?;

    *state
        .lifecycle
        .lock()
        .map_err(|_| "AI window lifecycle state is unavailable".to_string())? =
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
            if finish_ai_window_lifecycle(&lifecycles_for_destroy, &lifecycle) == Some(true) {
                if let Ok(mut latest) = latest_for_destroy.lock() {
                    *latest = None;
                }
                emit_destroyed(&app_for_event);
            }
            lifecycle.signal_destroyed();
        };
        if lifecycle.programmatic_destroy.load(Ordering::Acquire) {
            finish();
        } else if let Ok(_operations) = operations_for_destroy.lock() {
            finish();
        } else {
            lifecycle.signal_destroyed();
        }
    });
    Ok(window)
}

fn replace_ai_window(
    app: &AppHandle,
    state: &AIWindowState,
    current: &WebviewWindow,
    payload: &AIWindowPayload,
    wrapper_url: &Url,
    focused: bool,
) -> Result<WebviewWindow, String> {
    destroy_ai_window_and_wait(current, state, false)?;
    match create_ai_window(app, state, payload, wrapper_url, focused) {
        Ok(window) => Ok(window),
        Err(error) => {
            clear_latest_payload(state);
            emit_destroyed(app);
            Err(error)
        }
    }
}

fn open_ai_window_impl(
    app: &AppHandle,
    caller: &WebviewWindow,
    state: &AIWindowState,
    request: AIWindowRequest,
) -> Result<AIWindowOpenResult, String> {
    require_main_caller(caller)?;
    validate_envelope(&request.envelope)?;
    let wrapper_url = ai_wrapper_url(caller)?;
    let mut runtime = state
        .operations
        .lock()
        .map_err(|_| "AI window state is unavailable".to_string())?;
    let current = app.get_webview_window(AI_WINDOW_LABEL);
    if let Some(current) = &current {
        enforce_ai_window_controls(current, request.controls)?;
    }
    let payload = next_payload(&mut runtime, &request)?;
    remember_latest_payload(state, &payload)?;

    let (window, action) = if let Some(current) = current {
        match update_ai_payload(&current, &payload) {
            Ok(()) => (current, AIWindowOpenAction::Focused),
            Err(_) => (
                replace_ai_window(app, state, &current, &payload, &wrapper_url, true)?,
                AIWindowOpenAction::Recreated,
            ),
        }
    } else {
        (
            create_ai_window(app, state, &payload, &wrapper_url, true)?,
            AIWindowOpenAction::Created,
        )
    };
    show_and_focus_window(&window, "AI window")?;
    Ok(AIWindowOpenResult {
        label: AI_WINDOW_LABEL,
        action,
    })
}

fn update_ai_window_impl(
    app: &AppHandle,
    caller: &WebviewWindow,
    state: &AIWindowState,
    request: AIWindowRequest,
) -> Result<Option<AIWindowUpdateResult>, String> {
    require_main_caller(caller)?;
    validate_envelope(&request.envelope)?;
    let wrapper_url = ai_wrapper_url(caller)?;
    let mut runtime = state
        .operations
        .lock()
        .map_err(|_| "AI window state is unavailable".to_string())?;
    let Some(current) = app.get_webview_window(AI_WINDOW_LABEL) else {
        return Ok(None);
    };
    enforce_ai_window_controls(&current, request.controls)?;
    let payload = next_payload(&mut runtime, &request)?;
    remember_latest_payload(state, &payload)?;
    let action = match update_ai_payload(&current, &payload) {
        Ok(()) => AIWindowUpdateAction::Updated,
        Err(_) => {
            replace_ai_window(app, state, &current, &payload, &wrapper_url, false)?;
            AIWindowUpdateAction::Recreated
        }
    };
    Ok(Some(AIWindowUpdateResult {
        label: AI_WINDOW_LABEL,
        action,
    }))
}

fn close_ai_window_impl(
    app: &AppHandle,
    caller: &WebviewWindow,
    state: &AIWindowState,
) -> Result<bool, String> {
    require_main_caller(caller)?;
    let _runtime = state
        .operations
        .lock()
        .map_err(|_| "AI window state is unavailable".to_string())?;
    let Some(window) = app.get_webview_window(AI_WINDOW_LABEL) else {
        clear_latest_payload(state);
        return Ok(false);
    };
    destroy_ai_window_and_wait(&window, state, true)?;
    clear_latest_payload(state);
    Ok(true)
}

fn focus_ai_editor_window_impl(
    app: &AppHandle,
    caller: &WebviewWindow,
    state: &AIWindowState,
) -> Result<(), String> {
    require_ai_window_caller(caller)?;
    let _operations = state
        .operations
        .lock()
        .map_err(|_| "AI window state is unavailable".to_string())?;
    if !allows_focus_editor_control(latest_ai_window_controls(state)?) {
        return Err("AI window focus-editor control is disabled".into());
    }
    let main = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "editor window is unavailable".to_string())?;
    show_and_focus_window(&main, "editor window")
}

fn set_ai_window_always_on_top_impl(
    caller: &WebviewWindow,
    state: &AIWindowState,
    enabled: bool,
) -> Result<(), String> {
    require_ai_window_caller(caller)?;
    let _operations = state
        .operations
        .lock()
        .map_err(|_| "AI window state is unavailable".to_string())?;
    let controls = latest_ai_window_controls(state)?;
    if !allows_always_on_top_control(controls) {
        return Err("AI window always-on-top control is disabled".into());
    }
    caller
        .set_always_on_top(enabled)
        .map_err(|error| format!("failed to update AI window always-on-top: {error}"))
}

fn send_ai_window_intent_impl(
    app: &AppHandle,
    caller: &WebviewWindow,
    state: &AIWindowState,
    intent: AIWindowIntent,
) -> Result<(), String> {
    require_ai_window_caller(caller)?;
    validate_intent(&intent)?;
    let _operations = state
        .operations
        .lock()
        .map_err(|_| "AI window state is unavailable".to_string())?;
    let payload = clone_latest_ai_window_payload(state)?;
    if !allows_ai_window_intent(payload.controls, &intent) {
        return Err("AI window action is disabled".into());
    }
    if matches!(intent, AIWindowIntent::OpenSettings { .. }) {
        let main = app
            .get_webview_window(MAIN_WINDOW_LABEL)
            .ok_or_else(|| "editor window is unavailable".to_string())?;
        show_and_focus_window(&main, "editor window")?;
    }
    app.emit_to(MAIN_WINDOW_LABEL, AI_WINDOW_INTENT_EVENT, intent)
        .map_err(|error| format!("failed to deliver AI window intent: {error}"))
}

#[tauri::command]
pub async fn open_ai_window(
    app: AppHandle,
    caller: WebviewWindow,
    state: tauri::State<'_, AIWindowState>,
    request: AIWindowRequest,
) -> Result<AIWindowOpenResult, String> {
    open_ai_window_impl(&app, &caller, &state, request)
}

#[tauri::command]
pub async fn update_ai_window(
    app: AppHandle,
    caller: WebviewWindow,
    state: tauri::State<'_, AIWindowState>,
    request: AIWindowRequest,
) -> Result<Option<AIWindowUpdateResult>, String> {
    update_ai_window_impl(&app, &caller, &state, request)
}

#[tauri::command]
pub async fn close_ai_window(
    app: AppHandle,
    caller: WebviewWindow,
    state: tauri::State<'_, AIWindowState>,
) -> Result<bool, String> {
    close_ai_window_impl(&app, &caller, &state)
}

#[tauri::command]
pub async fn focus_ai_editor_window(
    app: AppHandle,
    caller: WebviewWindow,
    state: tauri::State<'_, AIWindowState>,
) -> Result<(), String> {
    focus_ai_editor_window_impl(&app, &caller, &state)
}

#[tauri::command]
pub async fn get_ai_window_latest_payload(
    caller: WebviewWindow,
    state: tauri::State<'_, AIWindowState>,
) -> Result<AIWindowPayload, String> {
    latest_ai_window_payload(&caller, &state)
}

#[tauri::command]
pub async fn send_ai_window_intent(
    app: AppHandle,
    caller: WebviewWindow,
    state: tauri::State<'_, AIWindowState>,
    intent: AIWindowIntent,
) -> Result<(), String> {
    send_ai_window_intent_impl(&app, &caller, &state, intent)
}

#[tauri::command]
pub async fn set_ai_window_always_on_top(
    caller: WebviewWindow,
    state: tauri::State<'_, AIWindowState>,
    enabled: bool,
) -> Result<(), String> {
    set_ai_window_always_on_top_impl(&caller, &state, enabled)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn envelope(value: serde_json::Value) -> String {
        BASE64_STANDARD.encode(serde_json::to_vec(&value).unwrap())
    }

    fn controls(always_on_top: bool) -> AIWindowControls {
        AIWindowControls {
            toolbar: true,
            clear_chat: true,
            focus_editor: true,
            settings: true,
            always_on_top,
        }
    }

    fn request() -> AIWindowRequest {
        AIWindowRequest {
            envelope: envelope(serde_json::json!({"contextId": "context-1", "messages": []})),
            controls: controls(true),
        }
    }

    #[test]
    fn request_contract_requires_exact_controls_and_canonical_base64_json() {
        let valid = serde_json::json!({
            "envelope": request().envelope,
            "controls": {
                "toolbar": true,
                "clearChat": true,
                "focusEditor": true,
                "settings": true,
                "alwaysOnTop": false
            }
        });
        let parsed = serde_json::from_value::<AIWindowRequest>(valid.clone()).unwrap();
        validate_envelope(&parsed.envelope).unwrap();
        assert_eq!(parsed.controls, controls(false));

        let mut unexpected = valid.clone();
        unexpected["unexpected"] = serde_json::json!(true);
        assert!(serde_json::from_value::<AIWindowRequest>(unexpected).is_err());
        for invalid_controls in [
            serde_json::json!({
                "toolbar": true,
                "clearChat": true,
                "focusEditor": true,
                "settings": true
            }),
            serde_json::json!({
                "toolbar": true,
                "clearChat": true,
                "focusEditor": true,
                "settings": true,
                "alwaysOnTop": false,
                "unexpected": true
            }),
            serde_json::json!({
                "toolbar": true,
                "clear_chat": true,
                "focus_editor": true,
                "settings": true,
                "always_on_top": false
            }),
        ] {
            let mut invalid = valid.clone();
            invalid["controls"] = invalid_controls;
            assert!(serde_json::from_value::<AIWindowRequest>(invalid).is_err());
        }

        for invalid in [
            "".to_string(),
            "e30".to_string(),
            BASE64_STANDARD.encode(b"[]"),
            BASE64_STANDARD.encode(b"not json"),
            "A".repeat(MAX_AI_WINDOW_ENVELOPE_BYTES + 4),
        ] {
            assert!(validate_envelope(&invalid).is_err(), "{invalid}");
        }
    }

    #[test]
    fn payload_envelope_cannot_break_out_of_the_native_script() {
        let hostile = serde_json::json!({
            "text": "</script><script>alert('x')</script>",
            "separator": "\u{2028}",
            "quote": "\"'`"
        });
        let request = AIWindowRequest {
            envelope: envelope(hostile),
            controls: controls(false),
        };
        let payload = next_payload(&mut AIWindowRuntime::default(), &request).unwrap();
        let initial = initial_payload_script(&payload).unwrap();
        let update = update_payload_script(&payload).unwrap();
        assert!(!initial.contains("</script>"));
        assert!(!update.contains("</script>"));
        assert!(initial.contains(&request.envelope));
        assert!(update.contains(&request.envelope));
    }

    #[test]
    fn intents_are_exact_bounded_and_use_camel_case_fields() {
        let submit = serde_json::json!({
            "type": "submit",
            "text": "Make the selected card blue",
            "clientActionId": "action-1",
            "contextId": "context-1"
        });
        let parsed = serde_json::from_value::<AIWindowIntent>(submit.clone()).unwrap();
        validate_intent(&parsed).unwrap();
        assert_eq!(serde_json::to_value(parsed).unwrap(), submit);

        let approval = serde_json::from_value::<AIWindowIntent>(serde_json::json!({
            "type": "toolApproval",
            "token": "approval-1",
            "approved": true,
            "clientActionId": "action-2",
            "contextId": "context-1"
        }))
        .unwrap();
        validate_intent(&approval).unwrap();

        let settings = serde_json::json!({
            "type": "openSettings",
            "clientActionId": "action-3",
            "contextId": "context-1"
        });
        let parsed = serde_json::from_value::<AIWindowIntent>(settings.clone()).unwrap();
        validate_intent(&parsed).unwrap();
        assert_eq!(serde_json::to_value(parsed).unwrap(), settings);

        for invalid in [
            serde_json::json!({
                "type": "submit", "text": "ok", "clientActionId": "action-1",
                "contextId": "context-1", "unexpected": true
            }),
            serde_json::json!({
                "type": "stop", "clientActionId": "action-1"
            }),
            serde_json::json!({
                "type": "unknown", "clientActionId": "action-1", "contextId": "context-1"
            }),
        ] {
            assert!(serde_json::from_value::<AIWindowIntent>(invalid).is_err());
        }

        let oversized_text = AIWindowIntent::Submit {
            text: "x".repeat(MAX_AI_WINDOW_INTENT_TEXT_BYTES + 1),
            client_action_id: "action-1".into(),
            context_id: "context-1".into(),
        };
        assert!(validate_intent(&oversized_text).is_err());
        let unsafe_id = AIWindowIntent::Stop {
            client_action_id: "../action".into(),
            context_id: "context-1".into(),
        };
        assert!(validate_intent(&unsafe_id).is_err());
    }

    #[test]
    fn wrapper_is_fixed_and_all_other_navigation_is_rejected() {
        for (current, expected) in [
            (
                "http://localhost:1420/editor?tab=ai#chat",
                "http://localhost:1420/ai-popout.html",
            ),
            (
                "tauri://localhost/index.html#/editor",
                "tauri://localhost/ai-popout.html",
            ),
            (
                "http://tauri.localhost/index.html",
                "http://tauri.localhost/ai-popout.html",
            ),
        ] {
            assert_eq!(
                app_wrapper_url(Url::parse(current).unwrap()).as_str(),
                expected
            );
        }
        let wrapper = Url::parse("tauri://localhost/ai-popout.html").unwrap();
        assert!(is_allowed_ai_navigation(&wrapper, &wrapper));
        for blocked in [
            "tauri://localhost/index.html",
            "tauri://localhost/preview-popout.html",
            "http://localhost:1420/ai-popout.html",
            "https://example.com/",
            "about:blank",
        ] {
            assert!(!is_allowed_ai_navigation(
                &Url::parse(blocked).unwrap(),
                &wrapper
            ));
        }
    }

    #[test]
    fn controls_gate_native_always_on_top() {
        let state = AIWindowState::default();
        assert!(latest_ai_window_controls(&state).is_err());
        let mut runtime = AIWindowRuntime::default();
        let mut request = request();
        request.controls = controls(false);
        let disabled = next_payload(&mut runtime, &request).unwrap();
        remember_latest_payload(&state, &disabled).unwrap();
        assert!(!allows_always_on_top_control(
            latest_ai_window_controls(&state).unwrap()
        ));

        request.controls = controls(true);
        let enabled = next_payload(&mut runtime, &request).unwrap();
        remember_latest_payload(&state, &enabled).unwrap();
        assert!(allows_always_on_top_control(
            latest_ai_window_controls(&state).unwrap()
        ));
        assert!(!allows_always_on_top_control(AIWindowControls {
            toolbar: false,
            ..controls(true)
        }));
        assert!(allows_focus_editor_control(controls(true)));
        assert!(!allows_focus_editor_control(AIWindowControls {
            focus_editor: false,
            ..controls(true)
        }));
        assert!(!allows_focus_editor_control(AIWindowControls {
            toolbar: false,
            ..controls(true)
        }));

        let clear = AIWindowIntent::Clear {
            client_action_id: "action-1".into(),
            context_id: "context-1".into(),
        };
        let settings = AIWindowIntent::OpenSettings {
            client_action_id: "action-2".into(),
            context_id: "context-1".into(),
        };
        assert!(allows_ai_window_intent(controls(true), &clear));
        assert!(!allows_ai_window_intent(
            AIWindowControls {
                clear_chat: false,
                ..controls(true)
            },
            &clear
        ));
        assert!(!allows_ai_window_intent(
            AIWindowControls {
                settings: false,
                ..controls(true)
            },
            &settings
        ));
    }

    #[test]
    fn payloads_are_exact_clones_with_monotonic_revisions() {
        let state = AIWindowState::default();
        let mut runtime = AIWindowRuntime::default();
        let request = request();
        let first = next_payload(&mut runtime, &request).unwrap();
        let second = next_payload(&mut runtime, &request).unwrap();
        assert_eq!(first.revision, 1);
        assert_eq!(second.revision, 2);
        remember_latest_payload(&state, &second).unwrap();
        assert_eq!(clone_latest_ai_window_payload(&state).unwrap(), second);
    }

    #[test]
    fn destroy_lifecycle_waits_for_confirmation_and_rejects_stale_generations() {
        let lifecycles = Mutex::new(None);
        let old = AIWindowLifecycle::new(1);
        let current = AIWindowLifecycle::new(2);
        *lifecycles.lock().unwrap() = Some(current.clone());
        assert_eq!(finish_ai_window_lifecycle(&lifecycles, &old), None);
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
            finish_ai_window_lifecycle(&lifecycles, &current),
            Some(true)
        );
        current.signal_destroyed();
        assert!(current.wait_until_destroyed(Duration::ZERO).is_ok());
    }

    #[test]
    fn replacement_is_silent_and_destroy_wait_is_bounded() {
        let lifecycles = Mutex::new(None);
        let replacement = AIWindowLifecycle::new(7);
        replacement
            .notify_on_destroy
            .store(false, Ordering::Release);
        *lifecycles.lock().unwrap() = Some(replacement.clone());
        assert_eq!(
            finish_ai_window_lifecycle(&lifecycles, &replacement),
            Some(false)
        );
        replacement.signal_destroyed();
        assert!(replacement.wait_until_destroyed(Duration::ZERO).is_ok());

        let pending = AIWindowLifecycle::new(8);
        assert_eq!(
            pending.wait_until_destroyed(Duration::ZERO).unwrap_err(),
            "timed out waiting for the AI window to close"
        );
    }

    #[test]
    fn implementation_keeps_the_ai_wrapper_local_and_commands_label_guarded() {
        let source = include_str!("ai_window.rs");
        assert_eq!(AI_WINDOW_LABEL, "ai-chat-popout");
        assert_eq!(AI_WINDOW_WRAPPER_PATH, "ai-popout.html");
        assert!(source.contains("WebviewUrl::App(PathBuf::from(AI_WINDOW_WRAPPER_PATH))"));
        assert!(source.contains(".devtools(false)"));
        assert!(source.contains(
            ".on_navigation(move |url| is_allowed_ai_navigation(url, &allowed_wrapper_url))"
        ));
        assert!(source.contains(".on_new_window(|_, _| NewWindowResponse::Deny)"));
        assert!(!source.contains(&["WebviewUrl", "::External"].concat()));
        assert!(!source.contains(&[".", "navigate("].concat()));
        assert!(source.contains(".always_on_top(false)"));
        let main_caller_guard = ["require_main_caller", "(caller)?;"].concat();
        let ai_caller_guard = ["require_ai_window_caller", "(caller)?;"].concat();
        assert_eq!(source.matches(&main_caller_guard).count(), 3);
        assert_eq!(source.matches(&ai_caller_guard).count(), 4);
    }
}
