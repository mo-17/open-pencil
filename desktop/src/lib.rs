mod acp_environment;
mod agents;
mod ai_window;
mod aliyun_drive;
#[cfg(test)]
mod app_commands;
mod backend_automation_idempotency_cas;
mod backend_backfill_inspection_subject;
mod backend_cas_ledger_install;
#[cfg(test)]
#[path = "../build_support/backend_compiler_sidecar_pin.rs"]
mod backend_compiler_sidecar_pin_build_support;
mod backend_locked_high_water_capture;
mod backend_operation_journal;
mod backend_receipt_zero_initializer;
mod backend_source_ledger_admission;
mod backend_source_ledger_receipt_verifier;
mod baidu_netdisk;
mod codepen;
mod credentials;
mod deep_link;
mod fig_container;
mod fonts;
mod google_drive;
mod http;
mod menu;
mod menu_events;
mod motion_export;
mod onedrive;
mod preview_window;
mod source_export;
mod supabase_backfill_fixed_read;
mod supabase_database_read_credentials;
mod supabase_management;
#[cfg(target_os = "macos")]
mod window;

use acp_environment::acp_process_environment;
use ai_window::{
    close_ai_window, focus_ai_editor_window, get_ai_window_latest_payload, open_ai_window,
    send_ai_window_intent, set_ai_window_always_on_top, update_ai_window, AIWindowState,
};
use aliyun_drive::{
    aliyun_drive_oauth_authorize, aliyun_drive_oauth_cancel, aliyun_drive_oauth_refresh,
    aliyun_drive_transfer, AliyunDriveOAuthOperations, AliyunDriveTransferAuthorizations,
};
use baidu_netdisk::{
    baidu_netdisk_oauth_authorize, baidu_netdisk_oauth_cancel, baidu_netdisk_oauth_refresh,
    baidu_netdisk_transfer, BaiduNetdiskOAuthOperations, BaiduNetdiskTransferAuthorizations,
};
use codepen::{cleanup_stale_codepen_files, fetch_codepen_sources, open_codepen_prefill};
#[cfg(feature = "native-test")]
use credentials::parse_native_test_profile;
use credentials::{
    credential_access_paused, credential_read, credential_remove, credential_retry_access,
    credential_status, credential_store_availability, credential_write, CredentialVault,
};
use deep_link::path_matches_suffix;
use fig_container::build_fig_file;
use fonts::{list_system_fonts, load_system_font};
use google_drive::{
    google_drive_oauth_authorize, google_drive_oauth_cancel, google_drive_oauth_refresh,
    google_drive_oauth_revoke, google_drive_transfer, GoogleDriveOAuthOperations,
};
use http::{cancel_http_request, proxy_http_request, ProxyHttpRequests};
use menu::{install_app_menu, native_menu_checked, set_native_menu_checked};
use menu_events::handle_menu_event;
use motion_export::write_motion_export_noclobber;
use onedrive::{
    onedrive_oauth_authorize, onedrive_oauth_cancel, onedrive_oauth_refresh, onedrive_transfer,
    OneDriveOAuthOperations, OneDriveTransferAuthorizations,
};
use preview_window::{
    close_preview_window, focus_preview_editor_window, get_preview_window_latest_payload,
    open_preview_window, send_preview_window_intent, set_preview_window_always_on_top,
    update_preview_window, PreviewWindowState,
};
use source_export::commit_source_export_file;
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};
use supabase_database_read_credentials::{
    supabase_database_read_credential_clear_v1, supabase_database_read_credential_replace_v1,
    supabase_database_read_credential_status_v1,
};
use supabase_management::supabase_management_inspect_pg_catalog_v1;
use tauri::{Emitter, Manager};
use tauri_plugin_fs::FsExt;
#[cfg(target_os = "macos")]
use window::show_main_window;

#[derive(Clone, serde::Serialize)]
struct PendingOpenFile {
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    node: Option<String>,
    /// Which producer queued this entry: a `openpencil://` link (true) or a file
    /// association / argv path (false). The frontend cannot tell them apart from
    /// the path alone — a canonicalized Windows path is verbatim (`\\?\C:\…`).
    #[serde(rename = "deepLink")]
    deep_link: bool,
}

struct PendingOpen(Mutex<Vec<PendingOpenFile>>);

/// Complete keyed room invitations, held only in memory until the frontend drains them.
struct PendingRooms(Mutex<Vec<String>>);

#[tauri::command]
fn take_pending_rooms(state: tauri::State<PendingRooms>) -> Vec<String> {
    state
        .0
        .lock()
        .map(|mut pending| pending.drain(..).collect())
        .unwrap_or_default()
}

#[tauri::command]
fn take_pending_open(state: tauri::State<PendingOpen>) -> Vec<PendingOpenFile> {
    state
        .0
        .lock()
        .map(|mut pending| pending.drain(..).collect())
        .unwrap_or_default()
}

/// Version of the system WebView engine the app is rendering in, so the
/// startup support gate can name it when the engine is too old. Uses the
/// WebKit bundle version on macOS, the WebKitGTK version on Linux, and the
/// WebView2 runtime version on Windows; `None` when the runtime cannot report it.
#[tauri::command]
fn webview_version() -> Option<String> {
    tauri::webview_version().ok()
}

/// Whether the environment turns off pings and usage stats: `OPENPENCIL_TELEMETRY` set to
/// `0`, `false`, or `no`, or `DO_NOT_TRACK` set to anything but `0` or `false`.
#[tauri::command]
fn sharing_disabled_by_env() -> bool {
    let is_off = |name: &str, off: &[&str]| {
        std::env::var(name)
            .map(|value| off.contains(&value.trim().to_ascii_lowercase().as_str()))
            .unwrap_or(false)
    };
    let do_not_track = std::env::var("DO_NOT_TRACK")
        .map(|value| {
            !matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "" | "0" | "false"
            )
        })
        .unwrap_or(false);
    is_off("OPENPENCIL_TELEMETRY", &["0", "false", "no"]) || do_not_track
}

#[tauri::command]
fn set_recent_files(app: tauri::AppHandle, paths: Vec<String>) -> Result<(), String> {
    install_app_menu(&app, &paths).map_err(|error| error.to_string())
}

/// Name of the MCP entry point installed by `@open-pencil/mcp`.
const MCP_EXECUTABLE: &str = "openpencil-mcp-http";
/// Bound on the directories reported back to the settings diagnostics.
const MAX_REPORTED_SEARCH_DIRS: usize = 12;

/// Directories that commonly hold a globally installed Node/Bun CLI.
///
/// GUI launches inherit launchd's minimal `PATH`, so a package installed by
/// npm, Bun, Volta, or Homebrew can be invisible even though the user's shell
/// finds it. `fix_path_env::fix()` reads the login shell first; these entries
/// cover managers that only modify an interactive rc file.
fn mcp_candidate_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    // Bun, Volta, and npm keep their Windows folders under USERPROFILE, which a HOME set by
    // Unix-style tools does not always match; HOME remains the fallback there.
    let home = if cfg!(windows) {
        std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))
    } else {
        std::env::var_os("HOME")
    };
    if let Some(home) = home.map(PathBuf::from) {
        dirs.push(home.join(".bun/bin"));
        dirs.push(home.join(".local/bin"));
        dirs.push(home.join(".npm-global/bin"));
        dirs.push(home.join(".volta/bin"));
        dirs.push(home.join("n/bin"));
        dirs.push(home.join(".local/share/mise/shims"));
    }
    #[cfg(target_os = "macos")]
    {
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
        dirs.push(PathBuf::from("/usr/local/bin"));
        dirs.push(PathBuf::from("/opt/local/bin"));
    }
    #[cfg(target_os = "linux")]
    {
        dirs.push(PathBuf::from("/usr/local/bin"));
        dirs.push(PathBuf::from("/home/linuxbrew/.linuxbrew/bin"));
    }
    #[cfg(windows)]
    {
        if let Some(appdata) = std::env::var_os("APPDATA").map(PathBuf::from) {
            dirs.push(appdata.join("npm"));
        }
    }
    dirs
}

fn push_unique_dir(dirs: &mut Vec<String>, dir: String) {
    if !dirs.contains(&dir) {
        dirs.push(dir);
    }
}

/// Existing candidate directories, most specific first, for diagnostics.
fn mcp_search_dirs() -> Vec<PathBuf> {
    mcp_candidate_dirs()
        .into_iter()
        .filter(|dir| dir.is_dir())
        .collect()
}

/// Append candidate directories that the current process `PATH` is missing.
fn augment_path(path: &str, candidates: &[PathBuf]) -> String {
    let mut entries: Vec<PathBuf> = std::env::split_paths(path).collect();
    for candidate in candidates {
        if candidate.is_dir() && !entries.contains(candidate) {
            entries.push(candidate.clone());
        }
    }
    std::env::join_paths(entries)
        .map(|joined| joined.to_string_lossy().into_owned())
        .unwrap_or_else(|_| path.to_string())
}

/// Make globally installed CLIs visible to `which` and to spawned children.
fn augment_startup_path(login_path: &str, inherited_path: &str, candidates: &[PathBuf]) -> String {
    let mut inherited_dirs: Vec<PathBuf> = std::env::split_paths(inherited_path).collect();
    inherited_dirs.extend_from_slice(candidates);
    augment_path(login_path, &inherited_dirs)
}

fn augment_mcp_path(inherited_path: &str) {
    let current = std::env::var("PATH").unwrap_or_default();
    let next = augment_startup_path(&current, inherited_path, &mcp_candidate_dirs());
    if next != current {
        std::env::set_var("PATH", next);
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct McpLookup {
    available: bool,
    path: Option<String>,
    /// Existing directories that were searched, for diagnostics.
    searched: Vec<String>,
}

#[tauri::command]
fn mcp_lookup() -> McpLookup {
    let resolved = which::which(MCP_EXECUTABLE).ok();
    let path = resolved.as_ref().map(|p| p.display().to_string());
    let mut searched: Vec<String> = Vec::new();
    if let Some(dir) = resolved.as_ref().and_then(|p| p.parent()) {
        push_unique_dir(&mut searched, dir.display().to_string());
    }
    for dir in mcp_search_dirs() {
        push_unique_dir(&mut searched, dir.display().to_string());
    }
    searched.truncate(MAX_REPORTED_SEARCH_DIRS);
    McpLookup {
        available: resolved.is_some(),
        path,
        searched,
    }
}

fn file_association_path(path: PathBuf) -> Option<PathBuf> {
    let path = path.canonicalize().ok()?;
    if !path.is_file() {
        return None;
    }
    let ext = path.extension()?.to_string_lossy().to_lowercase();
    matches!(ext.as_str(), "fig" | "pen").then_some(path)
}

fn path_from_arg(arg: String, cwd: &Path) -> Option<PathBuf> {
    if arg.starts_with('-') {
        return None;
    }

    if let Ok(url) = tauri::Url::parse(&arg) {
        if let Ok(path) = url.to_file_path() {
            return Some(path);
        }
    }

    let path = PathBuf::from(arg);
    Some(if path.is_absolute() {
        path
    } else {
        cwd.join(path)
    })
}

fn open_paths_from_args(args: Vec<String>, cwd: &Path) -> Vec<PathBuf> {
    args.into_iter()
        .filter_map(|arg| path_from_arg(arg, cwd))
        .filter_map(file_association_path)
        .collect()
}

fn queue_pending<R: tauri::Runtime>(app: &tauri::AppHandle<R>, files: Vec<PendingOpenFile>) {
    if files.is_empty() {
        return;
    }

    if let Ok(mut pending) = app.state::<PendingOpen>().0.lock() {
        pending.extend(files);
    }

    let _ = app.emit("open-associated-files", ());
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_focus();
    }
}

fn queue_open_paths<R: tauri::Runtime>(app: &tauri::AppHandle<R>, paths: Vec<PathBuf>) {
    let files = paths
        .into_iter()
        .map(|path| {
            let _ = app.fs_scope().allow_file(&path);
            PendingOpenFile {
                path: path.to_string_lossy().into_owned(),
                node: None,
                deep_link: false,
            }
        })
        .collect::<Vec<_>>();

    queue_pending(app, files);
}

/// The scheme filter is load-bearing: on macOS the plugin forwards every
/// `RunEvent::Opened` URL here, including the `file://` URLs of a double-clicked
/// document, which `queue_open_paths` already handles.
///
/// Relative paths from a link are deliberately not passed through
/// `fs_scope().allow_file`: the frontend resolves them against open tabs or the
/// file picker and allows the resolved absolute path there.
fn queue_deep_links<R: tauri::Runtime>(app: &tauri::AppHandle<R>, urls: Vec<url::Url>) {
    let mut files = Vec::new();
    let mut rooms = Vec::new();
    for url in urls.iter().filter(|url| url.scheme() == "openpencil") {
        match deep_link::parse_deep_link(url) {
            Ok(deep_link::DeepLink::Open(open)) => files.push(PendingOpenFile {
                path: open.file,
                node: open.node,
                deep_link: true,
            }),
            Ok(deep_link::DeepLink::Join(join)) => rooms.push(join.into_room_input()),
            // The sign-in that opened the browser is waiting; it checks the state itself.
            Ok(deep_link::DeepLink::OAuth(callback)) => {
                let _ = app.emit("oauth-callback", callback);
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_focus();
                }
            }
            Err(error) => eprintln!("[deep-link] refused link: {error:?}"),
        }
    }

    queue_pending(app, files);
    queue_rooms(app, rooms);
}

fn queue_rooms<R: tauri::Runtime>(app: &tauri::AppHandle<R>, rooms: Vec<String>) {
    if rooms.is_empty() {
        return;
    }

    if let Ok(mut pending) = app.state::<PendingRooms>().0.lock() {
        pending.extend(rooms);
    }

    let _ = app.emit("open-room-links", ());
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_focus();
    }
}

/// `openpencil://` URLs among a second launch's arguments: Windows and Linux start a new
/// process for a link, and the single-instance plugin hands its arguments to this one.
fn deep_links_from_args(args: &[String]) -> Vec<url::Url> {
    args.iter()
        .filter(|arg| arg.starts_with("openpencil://"))
        .filter_map(|arg| url::Url::parse(arg).ok())
        .collect()
}

fn startup_open_paths() -> Vec<PathBuf> {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    open_paths_from_args(std::env::args().skip(1).collect(), &cwd)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // A launcher may select an installed runtime (for example an NVM bin) that
    // is absent from the login shell. Retain it after fixing the shell PATH.
    let inherited_path = std::env::var("PATH").unwrap_or_default();
    let _ = fix_path_env::fix();
    augment_mcp_path(&inherited_path);

    let mut builder = tauri::Builder::default();

    #[cfg(feature = "native-test")]
    {
        builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
    }

    #[cfg(all(
        any(target_os = "macos", windows, target_os = "linux"),
        not(feature = "native-test")
    ))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            queue_deep_links(app, deep_links_from_args(&args));
            queue_open_paths(app, open_paths_from_args(args, Path::new(&cwd)));
        }));
    }

    #[cfg(debug_assertions)]
    {
        builder = builder
            .plugin(tauri_plugin_mcp_bridge::init())
            .plugin(tauri_plugin_webdriver_automation::init());
    }
    builder = builder.plugin(tauri_plugin_deep_link::init());

    builder
        .manage(PendingOpen(Mutex::new(Vec::new())))
        .manage(AliyunDriveOAuthOperations::default())
        .manage(AliyunDriveTransferAuthorizations::default())
        .manage(BaiduNetdiskOAuthOperations::default())
        .manage(BaiduNetdiskTransferAuthorizations::default())
        .manage(GoogleDriveOAuthOperations::default())
        .manage(OneDriveOAuthOperations::default())
        .manage(OneDriveTransferAuthorizations::default())
        .manage(AIWindowState::default())
        .manage(PreviewWindowState::default())
        .manage(ProxyHttpRequests::default())
        .manage(PendingRooms(Mutex::new(Vec::new())))
        .invoke_handler(tauri::generate_handler![
            agents::agent_lookup,
            acp_process_environment,
            aliyun_drive_oauth_authorize,
            aliyun_drive_oauth_cancel,
            aliyun_drive_oauth_refresh,
            aliyun_drive_transfer,
            baidu_netdisk_oauth_authorize,
            baidu_netdisk_oauth_cancel,
            baidu_netdisk_oauth_refresh,
            baidu_netdisk_transfer,
            build_fig_file,
            close_ai_window,
            credential_access_paused,
            credential_retry_access,
            credential_read,
            credential_remove,
            credential_status,
            credential_store_availability,
            credential_write,
            commit_source_export_file,
            fetch_codepen_sources,
            google_drive_oauth_authorize,
            google_drive_oauth_cancel,
            google_drive_oauth_refresh,
            google_drive_oauth_revoke,
            google_drive_transfer,
            onedrive_oauth_authorize,
            onedrive_oauth_cancel,
            onedrive_oauth_refresh,
            onedrive_transfer,
            close_preview_window,
            focus_ai_editor_window,
            focus_preview_editor_window,
            get_ai_window_latest_payload,
            get_preview_window_latest_payload,
            mcp_lookup,
            path_matches_suffix,
            list_system_fonts,
            load_system_font,
            proxy_http_request,
            cancel_http_request,
            set_recent_files,
            native_menu_checked,
            open_ai_window,
            open_codepen_prefill,
            open_preview_window,
            send_ai_window_intent,
            send_preview_window_intent,
            set_ai_window_always_on_top,
            set_preview_window_always_on_top,
            supabase_database_read_credential_clear_v1,
            supabase_database_read_credential_replace_v1,
            supabase_database_read_credential_status_v1,
            supabase_management_inspect_pg_catalog_v1,
            take_pending_open,
            update_ai_window,
            update_preview_window,
            write_motion_export_noclobber,
            set_native_menu_checked,
            take_pending_rooms,
            sharing_disabled_by_env,
            webview_version
        ])
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .on_menu_event(|app, event| {
            handle_menu_event(app, event.id().0.as_str());
        })
        .setup(|app| {
            #[cfg(feature = "native-test")]
            let native_test_profile = parse_native_test_profile(std::env::args_os().skip(1))
                .expect(
                    "invalid or duplicate --e2e-profile; expected 1-64 ASCII letters, digits, '-' or '_'",
                );
            #[cfg(feature = "native-test")]
            let credential_vault = app
                .path()
                .app_local_data_dir()
                .map(|app_data_dir| {
                    CredentialVault::new_for_native_test(app_data_dir, &native_test_profile)
                })
                .unwrap_or_else(|_| CredentialVault::unavailable());
            #[cfg(not(feature = "native-test"))]
            let credential_vault = app
                .path()
                .app_local_data_dir()
                .map(CredentialVault::new)
                .unwrap_or_else(|_| CredentialVault::unavailable());
            app.manage(credential_vault);
            cleanup_stale_codepen_files();
            queue_open_paths(app.handle(), startup_open_paths());

            use tauri_plugin_deep_link::DeepLinkExt;
            // On macOS the plugin turns `RunEvent::Opened` into this callback, so every
            // link that arrives while the app runs is handled here; the cold-start link
            // arrives before this closure and is drained from `current` below. The
            // `Opened` arm further down keeps handling file URLs.
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                queue_deep_links(&handle, event.urls());
            });
            #[cfg(any(windows, target_os = "linux"))]
            {
                if let Err(error) = app.deep_link().register_all() {
                    eprintln!("[deep-link] register_all failed: {error}");
                }
            }
            // Every desktop platform can deliver the launch link before this closure
            // runs, which means before the listener above exists, and the plugin's
            // `deep-link://new-url` emit then reaches nobody:
            //
            // - Windows / Linux: the link is argv, and the plugin parses it in its own
            //   setup (`handle_cli_arguments`).
            // - macOS: AppKit delivers the GetURL event *before* the app's setup. Traced
            //   on a cold `open openpencil://…`: `RunEvent::Opened` at T+0.085 s, this
            //   closure at T+0.342 s, and `on_open_url` never fired.
            //
            // In all three cases the URL survives only in the plugin's `current`, so it
            // is read here. No link can be queued twice: `RunEvent::Opened` is dispatched
            // on the main thread, the same thread this closure runs on, so a link cannot
            // arrive between the registration above and this read — anything later goes
            // to `on_open_url` and is no longer in `current` by the time it is read.
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                queue_deep_links(app.handle(), urls);
            }

            Ok(install_app_menu(app.handle(), &[])?)
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| match event {
            tauri::RunEvent::ExitRequested {
                api, code: None, ..
            } if !_app.webview_windows().is_empty() => {
                api.prevent_exit();
                // The frontend asks about unsaved documents and exits when they agree.
                let _ = _app.emit("menu-event", "quit");
            }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Opened { urls } => {
                let paths = urls
                    .into_iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .filter_map(file_association_path)
                    .collect();
                queue_open_paths(_app, paths);
            }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } => {
                if !has_visible_windows {
                    show_main_window(_app);
                }
            }
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn second_launch_arguments_preserve_the_room_fragment() {
        const ROOM: &str = "abcdefghijklmnopqrstuvwxyz012345";
        const KEY: &str = "0123456789abcdefghijklmnopqrstuvwxyz0123456789ab";
        let args = vec![
            "open-pencil".to_string(),
            "untitled.fig".to_string(),
            format!("openpencil://join?room={ROOM}#k={KEY}"),
        ];
        let links = deep_links_from_args(&args);
        assert_eq!(links.len(), 1);
        let deep_link::DeepLink::Join(join) = deep_link::parse_deep_link(&links[0]).unwrap() else {
            panic!("Expected a room invitation");
        };
        assert_eq!(join.into_room_input(), format!("{ROOM}#k={KEY}"));
    }

    #[test]
    fn augment_path_appends_missing_candidates_once() {
        let current_dir = std::env::temp_dir();
        let appended_dir = std::env::temp_dir().join("open-pencil-appended");
        std::fs::create_dir_all(&appended_dir).expect("create candidate dir");

        let current =
            std::env::join_paths([PathBuf::from("/open-pencil-first"), current_dir.clone()])
                .expect("join path list");
        let candidates = vec![current_dir.clone(), appended_dir.clone()];
        let entries: Vec<PathBuf> =
            std::env::split_paths(&augment_path(&current.to_string_lossy(), &candidates)).collect();

        // Existing entries keep their order and the missing candidate is
        // appended once, at the end.
        assert_eq!(
            entries,
            vec![
                PathBuf::from("/open-pencil-first"),
                current_dir,
                appended_dir.clone(),
            ]
        );

        let _ = std::fs::remove_dir(&appended_dir);
    }

    #[test]
    fn augment_path_ignores_candidates_that_do_not_exist() {
        let current =
            std::env::join_paths([PathBuf::from("/open-pencil-only")]).expect("join path list");
        let augmented = augment_path(
            &current.to_string_lossy(),
            &[PathBuf::from("/open-pencil-nonexistent")],
        );

        assert!(!augmented.contains("nonexistent"));
    }

    #[test]
    fn augment_path_keeps_an_existing_path_when_nothing_changes() {
        let current = std::env::var("PATH").unwrap_or_default();
        let augmented = augment_path(&current, &[]);
        assert_eq!(augmented, current);
    }

    #[test]
    fn augment_startup_path_keeps_login_and_inherited_dirs_without_duplicates() {
        let fixture = tempfile::tempdir().expect("create path fixture");
        let login_dir = fixture.path().join("login-bin");
        let inherited_dir = fixture.path().join("caller-selected-bin");
        let candidate_dir = fixture.path().join("candidate-bin");
        for directory in [&login_dir, &inherited_dir, &candidate_dir] {
            std::fs::create_dir(directory).expect("create existing bin directory");
        }
        let login = std::env::join_paths([&login_dir]).expect("join login path");
        let inherited = std::env::join_paths([&inherited_dir, &login_dir, &inherited_dir])
            .expect("join inherited path");
        let next = augment_startup_path(
            &login.to_string_lossy(),
            &inherited.to_string_lossy(),
            &[
                inherited_dir.clone(),
                candidate_dir.clone(),
                candidate_dir.clone(),
            ],
        );
        let entries: Vec<PathBuf> = std::env::split_paths(&next).collect();
        assert_eq!(entries, vec![login_dir, inherited_dir, candidate_dir]);
    }

    #[test]
    fn augment_startup_path_does_not_append_missing_or_empty_inherited_dirs() {
        let fixture = tempfile::tempdir().expect("create path fixture");
        let login = std::env::join_paths([fixture.path()]).expect("join login path");
        let inherited = std::env::join_paths([fixture.path().join("not-installed")])
            .expect("join missing inherited path");
        assert_eq!(
            augment_startup_path(&login.to_string_lossy(), &inherited.to_string_lossy(), &[]),
            login.to_string_lossy()
        );
        assert_eq!(
            augment_startup_path(&login.to_string_lossy(), "", &[]),
            login.to_string_lossy()
        );
    }
}
