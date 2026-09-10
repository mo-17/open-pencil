//! Strict non-secret connection-profile mirror for the dormant fixed-read transport.
//!
//! This module accepts only a small persisted JSON envelope and derives its canonical digest. It
//! creates no connection, command, credential, network client, or dispatch authority. Passwords,
//! DSNs, arbitrary options, alternate ports, and TLS overrides have no representation in the
//! parsed value.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::Deserialize;
use serde_json::{Number, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

pub(crate) const DATABASE_READ_CONNECTION_PROFILE_MAX_BYTES: usize = 2_048;

const FORMAT: &str = "openpencil.supabase-database-read-connection-profile.v1";
const PROVIDER_ID: &str = "supabase";
const ENVIRONMENT: &str = "staging";
const PORT: u16 = 5_432;
const DATABASE: &str = "postgres";
const TLS_MODE: &str = "verify-full";
const SESSION_POOLER_SUFFIX: &str = ".pooler.supabase.com";

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum SupabaseDatabaseReadConnectionMode {
    Direct,
    SupavisorSession,
}

impl SupabaseDatabaseReadConnectionMode {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Direct => "direct",
            Self::SupavisorSession => "supavisor-session",
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProfileWireV1 {
    format: String,
    version: u8,
    provider_id: String,
    environment: String,
    project_ref: String,
    account_id: String,
    mode: SupabaseDatabaseReadConnectionMode,
    host: String,
    port: u16,
    database: String,
    user: String,
    tls_mode: String,
}

/// Validated connection coordinates and their canonical identity digest.
///
/// All fields are private. The type deliberately has no password, DSN, URL, query parameter, or
/// generic connection-options field through which caller-controlled authority could be smuggled.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SupabaseDatabaseReadConnectionProfileV1 {
    project_ref: String,
    account_id: String,
    mode: SupabaseDatabaseReadConnectionMode,
    host: String,
    user: String,
    canonical_json: String,
    digest: [u8; 32],
}

impl SupabaseDatabaseReadConnectionProfileV1 {
    pub(crate) const fn format(&self) -> &'static str {
        FORMAT
    }

    pub(crate) const fn version(&self) -> u8 {
        1
    }

    pub(crate) const fn provider_id(&self) -> &'static str {
        PROVIDER_ID
    }

    pub(crate) const fn environment(&self) -> &'static str {
        ENVIRONMENT
    }

    pub(crate) fn project_ref(&self) -> &str {
        &self.project_ref
    }

    pub(crate) fn account_id(&self) -> &str {
        &self.account_id
    }

    pub(crate) const fn mode(&self) -> SupabaseDatabaseReadConnectionMode {
        self.mode
    }

    pub(crate) fn host(&self) -> &str {
        &self.host
    }

    pub(crate) const fn port(&self) -> u16 {
        PORT
    }

    pub(crate) const fn database(&self) -> &'static str {
        DATABASE
    }

    pub(crate) fn user(&self) -> &str {
        &self.user
    }

    pub(crate) const fn tls_mode(&self) -> &'static str {
        TLS_MODE
    }

    pub(crate) fn canonical_json(&self) -> &str {
        &self.canonical_json
    }

    pub(crate) const fn digest(&self) -> [u8; 32] {
        self.digest
    }

    pub(crate) fn digest_base64url(&self) -> String {
        URL_SAFE_NO_PAD.encode(self.digest)
    }
}

/// Fixed, data-free failures. No variant retains parser text or caller-controlled input.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SupabaseDatabaseReadConnectionProfileError {
    TooLarge,
    Invalid,
}

/// Parses either UTF-8 bytes or a string without first copying the caller's raw JSON.
pub(crate) fn parse_supabase_database_read_connection_profile_v1(
    raw: impl AsRef<[u8]>,
) -> Result<SupabaseDatabaseReadConnectionProfileV1, SupabaseDatabaseReadConnectionProfileError> {
    let raw = raw.as_ref();
    if raw.is_empty() || raw.len() > DATABASE_READ_CONNECTION_PROFILE_MAX_BYTES {
        return Err(if raw.len() > DATABASE_READ_CONNECTION_PROFILE_MAX_BYTES {
            SupabaseDatabaseReadConnectionProfileError::TooLarge
        } else {
            SupabaseDatabaseReadConnectionProfileError::Invalid
        });
    }

    // Derived struct deserialization rejects both unknown and duplicate fields. Discard the serde
    // error so an attacker-controlled field name or value never crosses this API boundary.
    let wire: ProfileWireV1 = serde_json::from_slice(raw)
        .map_err(|_| SupabaseDatabaseReadConnectionProfileError::Invalid)?;
    validate_fixed_fields(&wire)?;
    validate_project_ref(&wire.project_ref)?;
    validate_account_id(&wire.account_id)?;

    let expected_user = match wire.mode {
        SupabaseDatabaseReadConnectionMode::Direct => {
            if wire.host != direct_host(&wire.project_ref) {
                return Err(SupabaseDatabaseReadConnectionProfileError::Invalid);
            }
            DATABASE.to_owned()
        }
        SupabaseDatabaseReadConnectionMode::SupavisorSession => {
            validate_session_pooler_host(&wire.host)?;
            format!("postgres.{}", wire.project_ref)
        }
    };
    if wire.user != expected_user {
        return Err(SupabaseDatabaseReadConnectionProfileError::Invalid);
    }

    let canonical_json = canonical_profile_json(&wire)?;
    let digest = <[u8; 32]>::from(Sha256::digest(canonical_json.as_bytes()));
    Ok(SupabaseDatabaseReadConnectionProfileV1 {
        project_ref: wire.project_ref,
        account_id: wire.account_id,
        mode: wire.mode,
        host: wire.host,
        user: expected_user,
        canonical_json,
        digest,
    })
}

fn validate_fixed_fields(
    wire: &ProfileWireV1,
) -> Result<(), SupabaseDatabaseReadConnectionProfileError> {
    if wire.format != FORMAT
        || wire.version != 1
        || wire.provider_id != PROVIDER_ID
        || wire.environment != ENVIRONMENT
        || wire.port != PORT
        || wire.database != DATABASE
        || wire.tls_mode != TLS_MODE
    {
        return Err(SupabaseDatabaseReadConnectionProfileError::Invalid);
    }
    Ok(())
}

fn validate_project_ref(value: &str) -> Result<(), SupabaseDatabaseReadConnectionProfileError> {
    if value.len() != 20 || !value.bytes().all(|byte| byte.is_ascii_lowercase()) {
        return Err(SupabaseDatabaseReadConnectionProfileError::Invalid);
    }
    Ok(())
}

fn validate_account_id(value: &str) -> Result<(), SupabaseDatabaseReadConnectionProfileError> {
    let bytes = value.as_bytes();
    let lowercase = value.to_ascii_lowercase();
    if bytes.is_empty()
        || bytes.len() > 128
        || !bytes[0].is_ascii_alphanumeric()
        || !bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
        || matches!(lowercase.as_str(), "anon" | "service_role")
        || ["sbp_", "sb_publishable_", "sb_secret_"]
            .iter()
            .any(|prefix| lowercase.starts_with(prefix))
        || value.starts_with("eyJ")
    {
        return Err(SupabaseDatabaseReadConnectionProfileError::Invalid);
    }
    Ok(())
}

fn direct_host(project_ref: &str) -> String {
    format!("db.{project_ref}.supabase.co")
}

fn validate_session_pooler_host(
    value: &str,
) -> Result<(), SupabaseDatabaseReadConnectionProfileError> {
    if value.len() > 253
        || !value.ends_with(SESSION_POOLER_SUFFIX)
        || value.split('.').count() < 4
        || value
            .split('.')
            .any(|label| !valid_lowercase_dns_label(label))
    {
        return Err(SupabaseDatabaseReadConnectionProfileError::Invalid);
    }
    Ok(())
}

fn valid_lowercase_dns_label(label: &str) -> bool {
    let bytes = label.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 63
        && bytes[0].is_ascii_lowercase_or_digit()
        && bytes[bytes.len() - 1].is_ascii_lowercase_or_digit()
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_lowercase_or_digit() || *byte == b'-')
}

trait AsciiLowercaseOrDigit {
    fn is_ascii_lowercase_or_digit(&self) -> bool;
}

impl AsciiLowercaseOrDigit for u8 {
    fn is_ascii_lowercase_or_digit(&self) -> bool {
        self.is_ascii_lowercase() || self.is_ascii_digit()
    }
}

fn canonical_profile_json(
    wire: &ProfileWireV1,
) -> Result<String, SupabaseDatabaseReadConnectionProfileError> {
    // All keys are fixed ASCII, so BTreeMap ordering is byte-for-byte the same as the TypeScript
    // canonicalManifestJSON UTF-16 key ordering. Every accepted string is also restricted ASCII.
    let mut canonical = BTreeMap::new();
    canonical.insert("accountId", Value::String(wire.account_id.clone()));
    canonical.insert("database", Value::String(DATABASE.to_owned()));
    canonical.insert("environment", Value::String(ENVIRONMENT.to_owned()));
    canonical.insert("format", Value::String(FORMAT.to_owned()));
    canonical.insert("host", Value::String(wire.host.clone()));
    canonical.insert("mode", Value::String(wire.mode.as_str().to_owned()));
    canonical.insert("port", Value::Number(Number::from(PORT)));
    canonical.insert("projectRef", Value::String(wire.project_ref.clone()));
    canonical.insert("providerId", Value::String(PROVIDER_ID.to_owned()));
    canonical.insert("tlsMode", Value::String(TLS_MODE.to_owned()));
    canonical.insert("user", Value::String(wire.user.clone()));
    canonical.insert("version", Value::Number(Number::from(1)));
    serde_json::to_string(&canonical)
        .map_err(|_| SupabaseDatabaseReadConnectionProfileError::Invalid)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DIRECT_RAW: &str = concat!(
        r#"{"tlsMode":"verify-full","user":"postgres","database":"postgres","port":5432,"host":"db.abcdefghijklmnopqrst.supabase.co","mode":"direct","accountId":"account.staging_01","projectRef":"abcdefghijklmnopqrst","environment":"staging","providerId":"supabase","version":1,"format":"openpencil.supabase-database-read-connection-profile.v1"}"#
    );
    const DIRECT_CANONICAL_JSON: &str = concat!(
        r#"{"accountId":"account.staging_01","database":"postgres","environment":"staging","format":"openpencil.supabase-database-read-connection-profile.v1","host":"db.abcdefghijklmnopqrst.supabase.co","mode":"direct","port":5432,"projectRef":"abcdefghijklmnopqrst","providerId":"supabase","tlsMode":"verify-full","user":"postgres","version":1}"#
    );
    const DIRECT_DIGEST: &str = "4hodbEkFZompjmmZ5HCeqfAJMqz67OWIyIjrF49SwfA";
    const SESSION_RAW: &str = concat!(
        r#"{"format":"openpencil.supabase-database-read-connection-profile.v1","version":1,"providerId":"supabase","environment":"staging","projectRef":"zyxwvutsrqponmlkjihg","accountId":"acct-Session_02","mode":"supavisor-session","host":"aws-0-ap-southeast-1.pooler.supabase.com","port":5432,"database":"postgres","user":"postgres.zyxwvutsrqponmlkjihg","tlsMode":"verify-full"}"#
    );
    const SESSION_CANONICAL_JSON: &str = concat!(
        r#"{"accountId":"acct-Session_02","database":"postgres","environment":"staging","format":"openpencil.supabase-database-read-connection-profile.v1","host":"aws-0-ap-southeast-1.pooler.supabase.com","mode":"supavisor-session","port":5432,"projectRef":"zyxwvutsrqponmlkjihg","providerId":"supabase","tlsMode":"verify-full","user":"postgres.zyxwvutsrqponmlkjihg","version":1}"#
    );
    const SESSION_DIGEST: &str = "Xx0js2Z138ugBXZ0QnZQgZueCxsCfrrWVGH63R2Rtok";

    fn replace_once(raw: &str, from: &str, to: &str) -> String {
        assert!(raw.contains(from));
        raw.replacen(from, to, 1)
    }

    #[test]
    fn matches_bun_typescript_direct_vector_and_derives_endpoint() {
        let profile =
            parse_supabase_database_read_connection_profile_v1(DIRECT_RAW).expect("direct profile");

        assert_eq!(profile.format(), FORMAT);
        assert_eq!(profile.version(), 1);
        assert_eq!(profile.provider_id(), PROVIDER_ID);
        assert_eq!(profile.environment(), ENVIRONMENT);
        assert_eq!(profile.project_ref(), "abcdefghijklmnopqrst");
        assert_eq!(profile.account_id(), "account.staging_01");
        assert_eq!(profile.mode(), SupabaseDatabaseReadConnectionMode::Direct);
        assert_eq!(profile.host(), "db.abcdefghijklmnopqrst.supabase.co");
        assert_eq!(profile.port(), PORT);
        assert_eq!(profile.database(), DATABASE);
        assert_eq!(profile.user(), DATABASE);
        assert_eq!(profile.tls_mode(), TLS_MODE);
        assert_eq!(profile.canonical_json(), DIRECT_CANONICAL_JSON);
        assert_eq!(profile.digest_base64url(), DIRECT_DIGEST);
        assert_eq!(
            URL_SAFE_NO_PAD.encode(profile.digest()),
            DIRECT_DIGEST,
            "byte digest must match its canonical base64url form"
        );
    }

    #[test]
    fn matches_bun_typescript_session_vector_from_bytes() {
        let profile = parse_supabase_database_read_connection_profile_v1(SESSION_RAW.as_bytes())
            .expect("session profile");

        assert_eq!(
            profile.mode(),
            SupabaseDatabaseReadConnectionMode::SupavisorSession
        );
        assert_eq!(profile.project_ref(), "zyxwvutsrqponmlkjihg");
        assert_eq!(profile.account_id(), "acct-Session_02");
        assert_eq!(profile.host(), "aws-0-ap-southeast-1.pooler.supabase.com");
        assert_eq!(profile.user(), "postgres.zyxwvutsrqponmlkjihg");
        assert_eq!(profile.canonical_json(), SESSION_CANONICAL_JSON);
        assert_eq!(profile.digest_base64url(), SESSION_DIGEST);
    }

    #[test]
    fn enforces_raw_byte_cap_before_json_parsing() {
        let oversized = vec![b' '; DATABASE_READ_CONNECTION_PROFILE_MAX_BYTES + 1];
        assert_eq!(
            parse_supabase_database_read_connection_profile_v1(&oversized).unwrap_err(),
            SupabaseDatabaseReadConnectionProfileError::TooLarge
        );

        let mut boundary = DIRECT_RAW.to_owned();
        boundary.push_str(&" ".repeat(DATABASE_READ_CONNECTION_PROFILE_MAX_BYTES - boundary.len()));
        assert_eq!(boundary.len(), DATABASE_READ_CONNECTION_PROFILE_MAX_BYTES);
        parse_supabase_database_read_connection_profile_v1(boundary)
            .expect("exact byte cap remains accepted");
    }

    #[test]
    fn serde_rejects_missing_unknown_duplicate_and_non_utf8_input() {
        let cases = [
            replace_once(DIRECT_RAW, r#"{"tlsMode":"verify-full","#, "{"),
            replace_once(
                DIRECT_RAW,
                r#"{"tlsMode""#,
                r#"{"dsn":"postgresql://postgres:secret@attacker.invalid/postgres","tlsMode""#,
            ),
            replace_once(
                DIRECT_RAW,
                r#"{"tlsMode""#,
                r#"{"password":"secret","tlsMode""#,
            ),
            replace_once(
                DIRECT_RAW,
                r#"{"tlsMode""#,
                r#"{"options":{"sslmode":"disable"},"tlsMode""#,
            ),
            replace_once(
                DIRECT_RAW,
                r#"{"tlsMode""#,
                r#"{"host":"db.abcdefghijklmnopqrst.supabase.co","tlsMode""#,
            ),
        ];
        for raw in cases {
            assert_eq!(
                parse_supabase_database_read_connection_profile_v1(raw).unwrap_err(),
                SupabaseDatabaseReadConnectionProfileError::Invalid
            );
        }
        assert_eq!(
            parse_supabase_database_read_connection_profile_v1([0xff]).unwrap_err(),
            SupabaseDatabaseReadConnectionProfileError::Invalid
        );
    }

    #[test]
    fn rejects_fixed_field_and_direct_derivation_substitution() {
        for raw in [
            replace_once(DIRECT_RAW, r#""version":1"#, r#""version":2"#),
            replace_once(
                DIRECT_RAW,
                r#""providerId":"supabase""#,
                r#""providerId":"other""#,
            ),
            replace_once(
                DIRECT_RAW,
                r#""environment":"staging""#,
                r#""environment":"production""#,
            ),
            replace_once(
                DIRECT_RAW,
                r#""host":"db.abcdefghijklmnopqrst.supabase.co""#,
                r#""host":"db.attacker.invalid""#,
            ),
            replace_once(DIRECT_RAW, r#""port":5432"#, r#""port":6543"#),
            replace_once(
                DIRECT_RAW,
                r#""database":"postgres""#,
                r#""database":"other""#,
            ),
            replace_once(
                DIRECT_RAW,
                r#""user":"postgres""#,
                r#""user":"postgres.abcdefghijklmnopqrst""#,
            ),
            replace_once(
                DIRECT_RAW,
                r#""tlsMode":"verify-full""#,
                r#""tlsMode":"require""#,
            ),
            replace_once(DIRECT_RAW, r#""mode":"direct""#, r#""mode":"transaction""#),
        ] {
            assert_eq!(
                parse_supabase_database_read_connection_profile_v1(raw).unwrap_err(),
                SupabaseDatabaseReadConnectionProfileError::Invalid
            );
        }
    }

    #[test]
    fn rejects_secret_shaped_account_identity() {
        for account_id in [
            "anon",
            "service_role",
            "sbp_secret-shaped-value",
            "sb_publishable_secret-shaped-value",
            "sb_secret_secret-shaped-value",
            "eyJsecretShapedJwt",
        ] {
            let raw = replace_once(
                DIRECT_RAW,
                r#""accountId":"account.staging_01""#,
                &format!(r#""accountId":"{account_id}""#),
            );
            assert_eq!(
                parse_supabase_database_read_connection_profile_v1(raw).unwrap_err(),
                SupabaseDatabaseReadConnectionProfileError::Invalid
            );
        }
    }

    #[test]
    fn rejects_invalid_project_and_account_identities() {
        for project_ref in [
            "bcdefghijklmnopqrst",
            "abcdefghijklmnopqrstx",
            "ABCDEFGHIJKLMNOPQRST",
        ] {
            let raw = replace_once(DIRECT_RAW, "abcdefghijklmnopqrst", project_ref);
            assert!(parse_supabase_database_read_connection_profile_v1(raw).is_err());
        }
        for account_id in ["", ".account", "account/other"] {
            let raw = replace_once(DIRECT_RAW, "account.staging_01", account_id);
            assert!(parse_supabase_database_read_connection_profile_v1(raw).is_err());
        }
        let too_long_account = format!("a{}", "b".repeat(128));
        let raw = replace_once(DIRECT_RAW, "account.staging_01", &too_long_account);
        assert!(parse_supabase_database_read_connection_profile_v1(raw).is_err());
    }

    #[test]
    fn rejects_non_session_pooler_hosts() {
        for host in [
            "aws-0-ap-southeast-1.pooler.supabase.com:6543",
            "postgresql://aws-0-ap-southeast-1.pooler.supabase.com",
            "aws-0-ap-southeast-1.pooler.supabase.com/path",
            "127.0.0.1",
            "pooler.supabase.com",
            "aws-0-ap-southeast-1.pooler.supabase.com.evil.test",
            "AWS-0-ap-southeast-1.pooler.supabase.com",
            "-aws.pooler.supabase.com",
            "aws-.pooler.supabase.com",
            "aws..pooler.supabase.com",
        ] {
            let raw = replace_once(
                SESSION_RAW,
                "aws-0-ap-southeast-1.pooler.supabase.com",
                host,
            );
            assert_eq!(
                parse_supabase_database_read_connection_profile_v1(raw).unwrap_err(),
                SupabaseDatabaseReadConnectionProfileError::Invalid,
                "host must fail closed: {host}"
            );
        }
    }
}
