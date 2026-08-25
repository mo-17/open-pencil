pub const APP_COMMANDS: &[&str] = &[
    "build_fig_file",
    "close_ai_window",
    "close_preview_window",
    "credential_read",
    "credential_remove",
    "credential_status",
    "credential_store_availability",
    "credential_write",
    "commit_source_export_file",
    "fetch_codepen_sources",
    "google_drive_oauth_authorize",
    "google_drive_oauth_cancel",
    "google_drive_oauth_refresh",
    "google_drive_oauth_revoke",
    "google_drive_transfer",
    "mcp_executable_available",
    "focus_ai_editor_window",
    "focus_preview_editor_window",
    "get_ai_window_latest_payload",
    "get_preview_window_latest_payload",
    "list_system_fonts",
    "load_system_font",
    "native_menu_checked",
    "open_ai_window",
    "open_codepen_prefill",
    "open_preview_window",
    "proxy_http_request",
    "send_ai_window_intent",
    "send_preview_window_intent",
    "set_ai_window_always_on_top",
    "set_native_menu_checked",
    "set_preview_window_always_on_top",
    "set_recent_files",
    "take_pending_open",
    "update_ai_window",
    "update_preview_window",
    "write_motion_export_noclobber",
];

#[cfg(test)]
pub fn app_command_permission(command: &str) -> String {
    format!("allow-{}", command.replace('_', "-"))
}

#[cfg(test)]
const PREVIEW_WINDOW_APP_COMMANDS: &[&str] = &[
    "focus_preview_editor_window",
    "get_preview_window_latest_payload",
    "send_preview_window_intent",
    "set_preview_window_always_on_top",
];

#[cfg(test)]
const AI_WINDOW_APP_COMMANDS: &[&str] = &[
    "focus_ai_editor_window",
    "get_ai_window_latest_payload",
    "send_ai_window_intent",
    "set_ai_window_always_on_top",
];

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::{
        app_command_permission, AI_WINDOW_APP_COMMANDS, APP_COMMANDS, PREVIEW_WINDOW_APP_COMMANDS,
    };

    fn popup_permissions(
        file: &str,
        expected_label: &str,
        expected_commands: &[&str],
    ) -> BTreeSet<String> {
        let capability: serde_json::Value =
            serde_json::from_str(file).expect("popup capability must be valid JSON");
        assert_eq!(capability["windows"], serde_json::json!([expected_label]));
        assert!(capability.get("webviews").is_none());
        assert!(capability.get("remote").is_none());
        let actual = capability["permissions"]
            .as_array()
            .expect("popup capability must contain permissions")
            .iter()
            .map(|permission| {
                permission
                    .as_str()
                    .expect("popup permissions must be identifiers")
                    .to_string()
            })
            .collect::<BTreeSet<_>>();
        let expected = expected_commands
            .iter()
            .map(|command| app_command_permission(command))
            .collect::<BTreeSet<_>>();
        assert_eq!(actual, expected);
        actual
    }

    #[test]
    fn app_manifest_matches_the_registered_handler_and_window_capabilities() {
        let lib = include_str!("lib.rs");
        let handler = lib
            .split_once(".invoke_handler(tauri::generate_handler![")
            .and_then(|(_, rest)| rest.split_once("])"))
            .map(|(body, _)| body)
            .expect("lib.rs must contain one generate_handler list");
        let registered = handler
            .split(',')
            .map(str::trim)
            .filter(|command| !command.is_empty())
            .collect::<BTreeSet<_>>();
        let manifested = APP_COMMANDS.iter().copied().collect::<BTreeSet<_>>();
        assert_eq!(
            manifested.len(),
            APP_COMMANDS.len(),
            "manifest has duplicates"
        );
        assert_eq!(registered, manifested);

        let main_capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json"))
                .expect("default capability must be valid JSON");
        assert_eq!(main_capability["windows"], serde_json::json!(["main"]));
        assert!(main_capability.get("webviews").is_none());
        assert!(main_capability.get("remote").is_none());
        let main_permissions = main_capability["permissions"]
            .as_array()
            .expect("default capability must contain permissions");
        for command in APP_COMMANDS {
            let permission = app_command_permission(command);
            assert_eq!(
                main_permissions.iter().any(|entry| entry == &permission),
                !PREVIEW_WINDOW_APP_COMMANDS.contains(command)
                    && !AI_WINDOW_APP_COMMANDS.contains(command),
                "main capability has the wrong assignment for {permission}"
            );
        }

        let preview_permissions = popup_permissions(
            include_str!("../capabilities/preview-popout.json"),
            "lowcode-preview-popout",
            PREVIEW_WINDOW_APP_COMMANDS,
        );
        let ai_permissions = popup_permissions(
            include_str!("../capabilities/ai-popout.json"),
            "ai-chat-popout",
            AI_WINDOW_APP_COMMANDS,
        );
        assert!(preview_permissions.is_disjoint(&ai_permissions));
    }

    #[test]
    fn tauri_generated_allow_and_deny_permissions_exist_for_every_command() {
        for command in APP_COMMANDS {
            let path = format!(
                "{}/permissions/autogenerated/{command}.toml",
                env!("CARGO_MANIFEST_DIR")
            );
            let permission = std::fs::read_to_string(&path)
                .unwrap_or_else(|error| panic!("could not read {path}: {error}"));
            let command_id = command.replace('_', "-");
            assert!(permission.contains(&format!("identifier = \"allow-{command_id}\"")));
            assert!(permission.contains(&format!("commands.allow = [\"{command}\"]")));
            assert!(permission.contains(&format!("identifier = \"deny-{command_id}\"")));
            assert!(permission.contains(&format!("commands.deny = [\"{command}\"]")));
        }
    }
}
