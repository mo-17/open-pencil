#[path = "../vendor/tauri-plugin-shell/src/argument_validator.rs"]
mod argument_validator;

use serde_json::Value;

fn validators() -> Vec<(String, Vec<String>)> {
    let capability: Value =
        serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
    capability["permissions"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|permission| permission["identifier"] == "shell:allow-spawn")
        .flat_map(|permission| permission["allow"].as_array().unwrap())
        .map(|command| {
            let patterns = command["args"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|arg| arg["validator"].as_str())
                // The shell plugin anchors configured validators this way.
                .map(|pattern| format!("^{pattern}$"))
                .collect();
            (command["name"].as_str().unwrap().to_owned(), patterns)
        })
        .collect()
}

#[test]
fn every_configured_shell_validator_compiles() {
    for (command, patterns) in validators() {
        for pattern in patterns {
            argument_validator::compile(&pattern)
                .unwrap_or_else(|error| panic!("{command} validator failed: {error}"));
        }
    }
}

#[test]
fn json_scopes_retain_unicode_lengths_delimiters_and_control_rejection() {
    for (command, open, close, limit) in [
        ("lowcode-preview-local-backend", '{', '}', 16384),
        ("lowcode-microfrontend", '[', ']', 32768),
        ("lowcode-deploy", '[', ']', 32768),
    ] {
        let pattern = validators()
            .into_iter()
            .find(|(name, _)| name == command)
            .unwrap()
            .1
            .pop()
            .unwrap();
        let validator = argument_validator::compile(&pattern).unwrap();
        assert!(validator.is_match(&format!("{open}中{close}")));
        assert!(validator.is_match(&format!("{open}🖌{close}")));
        assert!(validator.is_match(&format!("{open}{}{close}", "中".repeat(limit))));
        assert!(!validator.is_match(&format!("{open}{}{close}", "a".repeat(limit + 1))));
        assert!(!validator.is_match(&format!("{open}{}{close}", "中".repeat(limit + 1))));
        assert!(!validator.is_match(&format!("{open}{close}")));
        assert!(!validator.is_match("payload"));
        for control in '\u{0}'..='\u{1f}' {
            assert!(!validator.is_match(&format!("{open}a{control}b{close}")));
        }
        assert!(!validator.is_match(&format!("prefix{open}a{close}")));
        assert!(!validator.is_match(&format!("{open}a{close}suffix")));
    }
}

#[test]
fn malformed_or_excessive_patterns_return_errors() {
    assert!(argument_validator::compile("[").is_err());
    assert!(argument_validator::compile(r"[^\x00-\x1f]{1,1000000}").is_err());
}
