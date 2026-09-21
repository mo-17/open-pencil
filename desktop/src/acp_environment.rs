const LOOPBACK_PROXY_EXCEPTIONS: [&str; 3] = ["127.0.0.1", "localhost", "::1"];

#[derive(Debug, PartialEq, Eq, serde::Serialize)]
pub struct AcpProcessEnvironment {
    #[serde(rename = "NO_PROXY")]
    upper_no_proxy: String,
    #[serde(rename = "no_proxy")]
    lower_no_proxy: String,
}

fn with_loopback_exceptions(existing: Option<&str>) -> String {
    let existing = existing.unwrap_or_default();
    let mut value = existing.to_owned();
    for host in LOOPBACK_PROXY_EXCEPTIONS {
        if existing
            .split(',')
            .any(|entry| entry.trim().eq_ignore_ascii_case(host))
        {
            continue;
        }
        if !value.is_empty() && !value.ends_with(',') {
            value.push(',');
        }
        value.push_str(host);
    }
    value
}

fn process_environment(upper: Option<&str>, lower: Option<&str>) -> AcpProcessEnvironment {
    AcpProcessEnvironment {
        upper_no_proxy: with_loopback_exceptions(upper.or(lower)),
        lower_no_proxy: with_loopback_exceptions(lower.or(upper)),
    }
}

/// Return only child-process proxy exceptions; never mutate the application's environment.
#[tauri::command]
pub fn acp_process_environment() -> AcpProcessEnvironment {
    let upper = std::env::var("NO_PROXY").ok();
    let lower = std::env::var("no_proxy").ok();
    process_environment(upper.as_deref(), lower.as_deref())
}

#[cfg(test)]
mod tests {
    use super::{process_environment, with_loopback_exceptions};

    const LOOPBACK: &str = "127.0.0.1,localhost,::1";

    #[test]
    fn supplies_loopback_exceptions_when_both_variables_are_absent() {
        let environment = process_environment(None, None);
        assert_eq!(environment.upper_no_proxy, LOOPBACK);
        assert_eq!(environment.lower_no_proxy, LOOPBACK);
    }

    #[test]
    fn inherits_uppercase_exceptions_when_lowercase_is_absent() {
        let environment = process_environment(Some("example.test,10.0.0.0/8"), None);
        let expected = format!("example.test,10.0.0.0/8,{LOOPBACK}");
        assert_eq!(environment.upper_no_proxy, expected);
        assert_eq!(environment.lower_no_proxy, expected);
    }

    #[test]
    fn inherits_lowercase_exceptions_when_uppercase_is_absent() {
        let environment = process_environment(None, Some("example.test"));
        let expected = format!("example.test,{LOOPBACK}");
        assert_eq!(environment.upper_no_proxy, expected);
        assert_eq!(environment.lower_no_proxy, expected);
    }

    #[test]
    fn preserves_distinct_values_for_both_variables() {
        let environment = process_environment(Some("upper.test"), Some("lower.test"));
        assert_eq!(environment.upper_no_proxy, format!("upper.test,{LOOPBACK}"));
        assert_eq!(environment.lower_no_proxy, format!("lower.test,{LOOPBACK}"));
    }

    #[test]
    fn preserves_explicit_empty_values_instead_of_inheriting() {
        let environment = process_environment(Some(""), Some("lower.test"));
        assert_eq!(environment.upper_no_proxy, LOOPBACK);
        assert_eq!(environment.lower_no_proxy, format!("lower.test,{LOOPBACK}"));
    }

    #[test]
    fn preserves_existing_entries_and_does_not_duplicate_loopback_hosts() {
        assert_eq!(
            with_loopback_exceptions(Some("example.test, LOCALHOST ,127.0.0.1,")),
            "example.test, LOCALHOST ,127.0.0.1,::1"
        );
        assert_eq!(with_loopback_exceptions(Some(LOOPBACK)), LOOPBACK);
    }

    #[test]
    fn preserves_wildcard_proxy_bypass() {
        let environment = process_environment(Some("*"), None);
        let expected = format!("*,{LOOPBACK}");
        assert_eq!(environment.upper_no_proxy, expected);
        assert_eq!(environment.lower_no_proxy, expected);
    }

    #[test]
    fn serializes_only_the_two_fixed_environment_keys() {
        let value = serde_json::to_value(process_environment(None, None)).unwrap();
        assert_eq!(
            value,
            serde_json::json!({ "NO_PROXY": LOOPBACK, "no_proxy": LOOPBACK })
        );
    }
}
