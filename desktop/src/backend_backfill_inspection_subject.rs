//! Dormant native provenance for one trusted Compiler Supabase backfill inspection subject.
//!
//! The complete, secret-free Compiler subject is mirrored and validated here so Rust and
//! TypeScript agree on one canonical boundary. Production can create only an empty process-local
//! registry and consume proofs produced by the private native Compiler bridge. The sole production
//! issuer accepts only the unforgeable result of the strict sidecar decoder; raw JSON, digests, and
//! projected material remain test-only ingress. This module grants no database, mutation,
//! execution, Receipt, retry, or release authority.

#![allow(dead_code)]

mod compiler_sidecar;
mod compiler_sidecar_binary;

use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Mutex, Weak},
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::supabase_backfill_fixed_read::contains_secret_like_material;

const SUBJECT_FORMAT: &str = "openpencil.supabase-backfill-inspection-subject.v1";
const QUERY_FAMILY: &str = "openpencil.supabase-backfill-catalog-inspection.v1";
const PLUGIN_ID: &str = "open-pencil.supabase-backend";
const CONTRIBUTION_ID: &str = "supabase.backend.v2";
const ADAPTER_ID: &str = "open-pencil.backend.supabase.v2";
const ADAPTER_VERSION: &str = "2.3.0";
const MIGRATION_PLAN_PATH: &str = "backend/supabase-v2/backfill/migration-plan.json";
const REVIEW_MANIFEST_PATH: &str = "backend/supabase-v2/backfill/review-manifest.json";
const REVIEW_SQL_TEMPLATE_PATH: &str = "backend/supabase-v2/backfill/review-query-template.sql";
const INSPECTION_SCOPE_DOMAIN: &str = "openpencil.native-supabase-backfill-inspection-scope.v1";
const MAXIMUM_CANONICAL_BYTES: usize = 64 * 1024;
const MAXIMUM_ARTIFACT_BYTES: u64 = 4 * 1024 * 1024;
const MAXIMUM_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const MAXIMUM_BATCH_SIZE: u32 = 1_000;
const MAXIMUM_BATCH_RECEIPT_COUNT: u64 = 9_999;
const HANDLE_TTL: Duration = Duration::from_secs(30);
const MAXIMUM_ENTRIES: usize = 32;
const ID_ATTEMPTS: usize = 8;
const ID_BYTES: usize = 32;

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompilerBackfillInspectionSubjectEnvelopeV1 {
    subject: CompilerBackfillInspectionSubjectV1,
    subject_digest: String,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompilerBackfillInspectionSubjectV1 {
    format: String,
    version: u8,
    provider_id: String,
    review_only: bool,
    apply_available: bool,
    release_ready: bool,
    execution_authority_created: bool,
    provider_authority: CompilerProviderAuthorityV1,
    application: CompilerApplicationBindingV1,
    plan: CompilerPlanBindingV1,
    emission: CompilerEmissionBindingV1,
    migration: CompilerMigrationBindingV1,
    inspection: CompilerInspectionPolicyV1,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompilerProviderAuthorityV1 {
    digest: String,
    plugin_id: String,
    package_digest: String,
    contribution_id: String,
    adapter_id: String,
    adapter_version: String,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompilerApplicationBindingV1 {
    id: String,
    digest: String,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompilerPlanBindingV1 {
    digest: String,
    adapter_plan_digest: String,
    target: String,
    mode: String,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompilerEmissionBindingV1 {
    manifest_digest: String,
    artifacts: CompilerArtifactBindingsV1,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompilerArtifactBindingsV1 {
    migration_plan: CompilerArtifactBindingV1,
    review_manifest: CompilerArtifactBindingV1,
    review_sql_template: CompilerArtifactBindingV1,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompilerArtifactBindingV1 {
    path: String,
    digest: String,
    byte_length: u64,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompilerMigrationBindingV1 {
    id: String,
    digest: String,
    entity: CompilerEntityBindingV1,
    cursor: CompilerCursorBindingV1,
    target: CompilerTargetBindingV1,
    batch_size: u32,
    maximum_receipt_count: u64,
    maximum_batch_receipt_count: u64,
    required_matched_row_count: Option<u64>,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompilerEntityBindingV1 {
    id: String,
    table: String,
    marker: String,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompilerCursorBindingV1 {
    field_id: String,
    field: String,
    marker: String,
    primary_key_marker: String,
    postgres_type: String,
    identity_generation: String,
    minimum: u64,
    maximum: u64,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompilerTargetBindingV1 {
    field_id: String,
    field: String,
    marker: String,
    postgres_type: String,
    desired_nullable: bool,
    expected_literal: Value,
    r#enum: Option<CompilerEnumBindingV1>,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompilerEnumBindingV1 {
    id: String,
    name: String,
    marker: String,
    ordered_values: Vec<String>,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompilerInspectionPolicyV1 {
    query_family: String,
    catalog_only: bool,
    generated_review_sql_is_authority: bool,
    observed_high_water_is_locked_capture: bool,
    may_create_receipt: bool,
}

/// The exact secret-free projection consumed by the testing-only C0 composition. Production
/// callers cannot manufacture its opaque proof from this data.
#[derive(Clone, PartialEq, Eq)]
#[cfg_attr(test, derive(Debug, Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub(crate) struct BackfillInspectionSubjectMaterialV1 {
    pub(crate) provider_id: String,
    pub(crate) provider_authority_digest: String,
    pub(crate) application_id: String,
    pub(crate) application_digest: String,
    pub(crate) migration_id: String,
    pub(crate) migration_digest: String,
    pub(crate) migration_plan_digest: String,
    pub(crate) inspection_subject_digest: String,
    pub(crate) table_name: String,
    pub(crate) cursor_field: String,
    pub(crate) target_field: String,
    pub(crate) maximum_cursor: u64,
    pub(crate) batch_size: u32,
    pub(crate) maximum_batch_receipt_count: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum BackendBackfillInspectionSubjectErrorV1 {
    InvalidEnvelope,
    NonCanonicalEnvelope,
    InvalidMaterial,
    ClockUnavailable,
    EntropyUnavailable,
    RegistryUnavailable,
    RegistryFull,
    ScopeAlreadyActive,
    IdCollision,
    HandleInvalid,
    HandleExpired,
}

fn valid_stable_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
}

fn valid_postgres_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 63
        && (value.as_bytes()[0].is_ascii_alphabetic() || value.as_bytes()[0] == b'_')
        && value
            .bytes()
            .skip(1)
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

fn decode_digest(value: &str) -> Result<[u8; 32], BackendBackfillInspectionSubjectErrorV1> {
    if value.len() != 43
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(BackendBackfillInspectionSubjectErrorV1::InvalidEnvelope);
    }
    let decoded = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| BackendBackfillInspectionSubjectErrorV1::InvalidEnvelope)?;
    if URL_SAFE_NO_PAD.encode(&decoded) != value {
        return Err(BackendBackfillInspectionSubjectErrorV1::InvalidEnvelope);
    }
    decoded
        .try_into()
        .map_err(|_| BackendBackfillInspectionSubjectErrorV1::InvalidEnvelope)
}

fn valid_package_digest(value: &str) -> bool {
    ["sha256:", "app-bundle-sha256:"]
        .into_iter()
        .find_map(|prefix| value.strip_prefix(prefix))
        .is_some_and(|digest| decode_digest(digest).is_ok())
}

fn validate_json_literal(value: &Value) -> Result<(), BackendBackfillInspectionSubjectErrorV1> {
    match value {
        Value::Bool(_) => Ok(()),
        Value::String(value) if !value.contains('\0') => Ok(()),
        Value::Number(number) => {
            let value = number
                .as_f64()
                .ok_or(BackendBackfillInspectionSubjectErrorV1::InvalidEnvelope)?;
            if value.is_finite() && !(value == 0.0 && value.is_sign_negative()) {
                Ok(())
            } else {
                Err(BackendBackfillInspectionSubjectErrorV1::InvalidEnvelope)
            }
        }
        Value::Null | Value::String(_) | Value::Array(_) | Value::Object(_) => {
            Err(BackendBackfillInspectionSubjectErrorV1::InvalidEnvelope)
        }
    }
}

fn valid_date(value: &str) -> bool {
    if value.len() != 10
        || value.as_bytes()[4] != b'-'
        || value.as_bytes()[7] != b'-'
        || value
            .bytes()
            .enumerate()
            .any(|(index, byte)| !matches!(index, 4 | 7) && !byte.is_ascii_digit())
    {
        return false;
    }
    let (Ok(year), Ok(month), Ok(day)) = (
        value[0..4].parse::<u32>(),
        value[5..7].parse::<u32>(),
        value[8..10].parse::<u32>(),
    ) else {
        return false;
    };
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let maximum_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    day >= 1 && day <= maximum_day
}

fn valid_uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => byte == b'-',
            _ => byte.is_ascii_hexdigit(),
        })
        && matches!(value.as_bytes()[14].to_ascii_lowercase(), b'1'..=b'5')
        && matches!(
            value.as_bytes()[19].to_ascii_lowercase(),
            b'8' | b'9' | b'a' | b'b'
        )
}

fn valid_datetime(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() < 20
        || !bytes[..10].is_ascii()
        || bytes[10] != b'T'
        || !std::str::from_utf8(&bytes[..10]).is_ok_and(valid_date)
    {
        return false;
    }
    if !bytes[11..13].iter().all(u8::is_ascii_digit)
        || bytes[13] != b':'
        || !bytes[14..16].iter().all(u8::is_ascii_digit)
        || bytes[16] != b':'
        || !bytes[17..19].iter().all(u8::is_ascii_digit)
    {
        return false;
    }
    let hour = (bytes[11] - b'0') * 10 + (bytes[12] - b'0');
    let minute = (bytes[14] - b'0') * 10 + (bytes[15] - b'0');
    let second = (bytes[17] - b'0') * 10 + (bytes[18] - b'0');
    if hour > 23 || minute > 59 || second > 59 {
        return false;
    }
    let mut index = 19;
    if bytes.get(index) == Some(&b'.') {
        index += 1;
        let start = index;
        while bytes.get(index).is_some_and(u8::is_ascii_digit) {
            index += 1;
        }
        if index == start || index - start > 9 {
            return false;
        }
    }
    if bytes.get(index) == Some(&b'Z') {
        return index + 1 == bytes.len();
    }
    if !matches!(bytes.get(index), Some(b'+') | Some(b'-')) || index + 6 != bytes.len() {
        return false;
    }
    let zone = &bytes[index + 1..];
    if !zone[0..2].iter().all(u8::is_ascii_digit)
        || zone[2] != b':'
        || !zone[3..5].iter().all(u8::is_ascii_digit)
    {
        return false;
    }
    let zone_hour = (zone[0] - b'0') * 10 + (zone[1] - b'0');
    let zone_minute = (zone[3] - b'0') * 10 + (zone[4] - b'0');
    zone_minute <= 59 && (zone_hour < 14 || (zone_hour == 14 && zone_minute == 0))
}

fn literal_matches_postgres_type(target: &CompilerTargetBindingV1) -> bool {
    if target.r#enum.is_some() {
        return target.expected_literal.is_string();
    }
    match target.postgres_type.as_str() {
        "pg_catalog.text" => target
            .expected_literal
            .as_str()
            .is_some_and(|value| !value.contains('\0')),
        "pg_catalog.date" => target.expected_literal.as_str().is_some_and(valid_date),
        "pg_catalog.timestamptz" => target.expected_literal.as_str().is_some_and(valid_datetime),
        "pg_catalog.uuid" => target.expected_literal.as_str().is_some_and(valid_uuid),
        "pg_catalog.int8" => {
            target
                .expected_literal
                .as_i64()
                .is_some_and(|value| value.unsigned_abs() <= MAXIMUM_SAFE_INTEGER)
                || target
                    .expected_literal
                    .as_u64()
                    .is_some_and(|value| value <= MAXIMUM_SAFE_INTEGER)
        }
        "pg_catalog.float8" => target
            .expected_literal
            .as_f64()
            .is_some_and(|value| value.is_finite() && !(value == 0.0 && value.is_sign_negative())),
        "pg_catalog.bool" => target.expected_literal.is_boolean(),
        "pg_catalog.jsonb" => !target.expected_literal.is_null(),
        _ => false,
    }
}

fn validate_artifact(
    artifact: &CompilerArtifactBindingV1,
    expected_path: &str,
) -> Result<(), BackendBackfillInspectionSubjectErrorV1> {
    if artifact.path != expected_path
        || artifact.byte_length == 0
        || artifact.byte_length > MAXIMUM_ARTIFACT_BYTES
    {
        return Err(BackendBackfillInspectionSubjectErrorV1::InvalidEnvelope);
    }
    decode_digest(&artifact.digest)?;
    Ok(())
}

fn marker(kind: &str, id: &str) -> String {
    format!("openpencil:v1:{kind}:{id}")
}

fn validate_subject(
    subject: &CompilerBackfillInspectionSubjectV1,
) -> Result<(), BackendBackfillInspectionSubjectErrorV1> {
    if subject.format != SUBJECT_FORMAT
        || subject.version != 1
        || subject.provider_id != "supabase"
        || !subject.review_only
        || subject.apply_available
        || subject.release_ready
        || subject.execution_authority_created
        || subject.provider_authority.plugin_id != PLUGIN_ID
        || subject.provider_authority.contribution_id != CONTRIBUTION_ID
        || subject.provider_authority.adapter_id != ADAPTER_ID
        || subject.provider_authority.adapter_version != ADAPTER_VERSION
        || !valid_package_digest(&subject.provider_authority.package_digest)
        || !valid_stable_id(&subject.application.id)
        || !valid_stable_id(&subject.migration.id)
        || !valid_stable_id(&subject.migration.entity.id)
        || !valid_postgres_identifier(&subject.migration.entity.table)
        || !valid_stable_id(&subject.migration.cursor.field_id)
        || !valid_postgres_identifier(&subject.migration.cursor.field)
        || !valid_stable_id(&subject.migration.target.field_id)
        || !valid_postgres_identifier(&subject.migration.target.field)
        || subject.migration.cursor.field_id == subject.migration.target.field_id
        || subject.migration.cursor.field == subject.migration.target.field
        || !matches!(subject.plan.target.as_str(), "react" | "vue")
        || subject.plan.mode != "production"
    {
        return Err(BackendBackfillInspectionSubjectErrorV1::InvalidEnvelope);
    }
    for digest in [
        &subject.provider_authority.digest,
        &subject.application.digest,
        &subject.plan.digest,
        &subject.plan.adapter_plan_digest,
        &subject.emission.manifest_digest,
        &subject.migration.digest,
    ] {
        decode_digest(digest)?;
    }
    validate_artifact(
        &subject.emission.artifacts.migration_plan,
        MIGRATION_PLAN_PATH,
    )?;
    validate_artifact(
        &subject.emission.artifacts.review_manifest,
        REVIEW_MANIFEST_PATH,
    )?;
    validate_artifact(
        &subject.emission.artifacts.review_sql_template,
        REVIEW_SQL_TEMPLATE_PATH,
    )?;
    let migration = &subject.migration;
    if migration.entity.marker != marker("entity", &migration.entity.id)
        || migration.cursor.marker != marker("field", &migration.cursor.field_id)
        || migration.cursor.primary_key_marker != marker("primary-key", &migration.entity.id)
        || migration.cursor.postgres_type != "pg_catalog.int8"
        || migration.cursor.identity_generation != "always"
        || migration.cursor.minimum != 0
        || migration.cursor.maximum != MAXIMUM_SAFE_INTEGER
        || migration.target.marker != marker("field", &migration.target.field_id)
        || !literal_matches_postgres_type(&migration.target)
        || migration.target.desired_nullable
        || migration.batch_size == 0
        || migration.batch_size > MAXIMUM_BATCH_SIZE
        || migration.maximum_receipt_count != MAXIMUM_BATCH_RECEIPT_COUNT + 1
        || migration.maximum_batch_receipt_count != MAXIMUM_BATCH_RECEIPT_COUNT
        || migration.required_matched_row_count.is_some_and(|minimum| {
            minimum > MAXIMUM_SAFE_INTEGER
                || minimum
                    > u64::from(migration.batch_size)
                        .saturating_mul(migration.maximum_batch_receipt_count)
        })
        || subject.inspection.query_family != QUERY_FAMILY
        || !subject.inspection.catalog_only
        || subject.inspection.generated_review_sql_is_authority
        || subject.inspection.observed_high_water_is_locked_capture
        || subject.inspection.may_create_receipt
    {
        return Err(BackendBackfillInspectionSubjectErrorV1::InvalidEnvelope);
    }
    validate_json_literal(&migration.target.expected_literal)?;
    if let Some(enum_binding) = &migration.target.r#enum {
        let expected_literal = migration.target.expected_literal.as_str();
        let expected_postgres_type = format!("\"public\".\"{}\"", enum_binding.name);
        if !valid_stable_id(&enum_binding.id)
            || !valid_postgres_identifier(&enum_binding.name)
            || enum_binding.marker != marker("enum", &enum_binding.id)
            || migration.target.postgres_type != expected_postgres_type
            || enum_binding.ordered_values.is_empty()
            || enum_binding.ordered_values.len() > 256
            || enum_binding
                .ordered_values
                .iter()
                .any(|value| !valid_postgres_identifier(value))
            || enum_binding
                .ordered_values
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len()
                != enum_binding.ordered_values.len()
            || !expected_literal.is_some_and(|literal| {
                enum_binding
                    .ordered_values
                    .iter()
                    .any(|value| value == literal)
            })
        {
            return Err(BackendBackfillInspectionSubjectErrorV1::InvalidEnvelope);
        }
    }
    let subject_value = serde_json::to_value(subject)
        .map_err(|_| BackendBackfillInspectionSubjectErrorV1::InvalidEnvelope)?;
    reject_secret_like_data(&subject_value)?;
    Ok(())
}

fn reject_secret_like_data(value: &Value) -> Result<(), BackendBackfillInspectionSubjectErrorV1> {
    match value {
        Value::String(value) => {
            if contains_secret_like_material(value) {
                Err(BackendBackfillInspectionSubjectErrorV1::InvalidEnvelope)
            } else {
                Ok(())
            }
        }
        Value::Array(values) => values.iter().try_for_each(reject_secret_like_data),
        Value::Object(entries) => entries.iter().try_for_each(|(key, value)| {
            if contains_secret_like_material(key) {
                Err(BackendBackfillInspectionSubjectErrorV1::InvalidEnvelope)
            } else {
                reject_secret_like_data(value)
            }
        }),
        Value::Null | Value::Bool(_) | Value::Number(_) => Ok(()),
    }
}

fn compare_ecmascript_keys(left: &str, right: &str) -> std::cmp::Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

/// Formats one finite IEEE-754 value using the decimal placement rules used by
/// `JSON.stringify`. Rust's shortest representation supplies the digits; this function normalizes
/// the fixed/exponential threshold and the explicit positive exponent sign.
fn ecmascript_number_json(
    number: &serde_json::Number,
) -> Result<String, BackendBackfillInspectionSubjectErrorV1> {
    let value = number
        .as_f64()
        .ok_or(BackendBackfillInspectionSubjectErrorV1::InvalidEnvelope)?;
    if !value.is_finite() || (value == 0.0 && value.is_sign_negative()) {
        return Err(BackendBackfillInspectionSubjectErrorV1::InvalidEnvelope);
    }
    if value == 0.0 {
        return Ok("0".to_owned());
    }

    let negative = value.is_sign_negative();
    let raw = value.abs().to_string().to_ascii_lowercase();
    let (mantissa, exponent) = match raw.split_once('e') {
        Some((mantissa, exponent)) => {
            let exponent = exponent
                .parse::<i32>()
                .map_err(|_| BackendBackfillInspectionSubjectErrorV1::InvalidEnvelope)?;
            (mantissa, exponent)
        }
        None => (raw.as_str(), 0),
    };
    let decimal_index = mantissa.find('.').unwrap_or(mantissa.len()) as i32;
    let mut digits: String = mantissa
        .chars()
        .filter(|character| *character != '.')
        .collect();
    let leading_zeroes = digits.bytes().take_while(|byte| *byte == b'0').count();
    digits.drain(..leading_zeroes);
    while digits.len() > 1 && digits.ends_with('0') {
        digits.pop();
    }
    if digits.is_empty() {
        return Ok("0".to_owned());
    }
    let decimal_position = decimal_index - leading_zeroes as i32 + exponent;
    let digit_count = digits.len() as i32;
    let mut output = String::new();
    if negative {
        output.push('-');
    }
    if digit_count <= decimal_position && decimal_position <= 21 {
        output.push_str(&digits);
        output.push_str(&"0".repeat((decimal_position - digit_count) as usize));
    } else if decimal_position > 0 && decimal_position <= 21 {
        let split = decimal_position as usize;
        output.push_str(&digits[..split]);
        output.push('.');
        output.push_str(&digits[split..]);
    } else if decimal_position > -6 && decimal_position <= 0 {
        output.push_str("0.");
        output.push_str(&"0".repeat((-decimal_position) as usize));
        output.push_str(&digits);
    } else {
        output.push(digits.as_bytes()[0] as char);
        if digits.len() > 1 {
            output.push('.');
            output.push_str(&digits[1..]);
        }
        output.push('e');
        let exponent = decimal_position - 1;
        if exponent >= 0 {
            output.push('+');
        }
        output.push_str(&exponent.to_string());
    }
    Ok(output)
}

fn write_canonical_json(
    value: &Value,
    output: &mut String,
) -> Result<(), BackendBackfillInspectionSubjectErrorV1> {
    match value {
        Value::Null => output.push_str("null"),
        Value::Bool(value) => output.push_str(if *value { "true" } else { "false" }),
        Value::Number(value) => output.push_str(&ecmascript_number_json(value)?),
        Value::String(value) => output.push_str(
            &serde_json::to_string(value)
                .map_err(|_| BackendBackfillInspectionSubjectErrorV1::InvalidEnvelope)?,
        ),
        Value::Array(values) => {
            output.push('[');
            for (index, value) in values.iter().enumerate() {
                if index > 0 {
                    output.push(',');
                }
                write_canonical_json(value, output)?;
            }
            output.push(']');
        }
        Value::Object(entries) => {
            output.push('{');
            let mut entries: Vec<_> = entries.iter().collect();
            entries.sort_unstable_by(|(left, _), (right, _)| compare_ecmascript_keys(left, right));
            for (index, (key, value)) in entries.into_iter().enumerate() {
                if index > 0 {
                    output.push(',');
                }
                output.push_str(
                    &serde_json::to_string(key)
                        .map_err(|_| BackendBackfillInspectionSubjectErrorV1::InvalidEnvelope)?,
                );
                output.push(':');
                write_canonical_json(value, output)?;
            }
            output.push('}');
        }
    }
    if output.len() > MAXIMUM_CANONICAL_BYTES {
        return Err(BackendBackfillInspectionSubjectErrorV1::InvalidEnvelope);
    }
    Ok(())
}

fn canonical_bytes<T: Serialize>(
    value: &T,
) -> Result<Vec<u8>, BackendBackfillInspectionSubjectErrorV1> {
    let value = serde_json::to_value(value)
        .map_err(|_| BackendBackfillInspectionSubjectErrorV1::InvalidEnvelope)?;
    let mut output = String::new();
    write_canonical_json(&value, &mut output)?;
    Ok(output.into_bytes())
}

fn digest_bytes(value: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(value))
}

fn validate_and_project(
    envelope: &CompilerBackfillInspectionSubjectEnvelopeV1,
) -> Result<BackfillInspectionSubjectMaterialV1, BackendBackfillInspectionSubjectErrorV1> {
    validate_subject(&envelope.subject)?;
    decode_digest(&envelope.subject_digest)?;
    let actual_digest = digest_bytes(&canonical_bytes(&envelope.subject)?);
    if actual_digest != envelope.subject_digest {
        return Err(BackendBackfillInspectionSubjectErrorV1::InvalidEnvelope);
    }
    let subject = &envelope.subject;
    let material = BackfillInspectionSubjectMaterialV1 {
        provider_id: subject.provider_id.clone(),
        provider_authority_digest: subject.provider_authority.digest.clone(),
        application_id: subject.application.id.clone(),
        application_digest: subject.application.digest.clone(),
        migration_id: subject.migration.id.clone(),
        migration_digest: subject.migration.digest.clone(),
        migration_plan_digest: subject.emission.artifacts.migration_plan.digest.clone(),
        inspection_subject_digest: actual_digest,
        table_name: subject.migration.entity.table.clone(),
        cursor_field: subject.migration.cursor.field.clone(),
        target_field: subject.migration.target.field.clone(),
        maximum_cursor: subject.migration.cursor.maximum,
        batch_size: subject.migration.batch_size,
        maximum_batch_receipt_count: subject.migration.maximum_batch_receipt_count,
    };
    validate_material(&material)?;
    Ok(material)
}

fn validate_material(
    material: &BackfillInspectionSubjectMaterialV1,
) -> Result<[u8; 32], BackendBackfillInspectionSubjectErrorV1> {
    if material.provider_id != "supabase"
        || !valid_stable_id(&material.application_id)
        || !valid_stable_id(&material.migration_id)
        || !valid_postgres_identifier(&material.table_name)
        || !valid_postgres_identifier(&material.cursor_field)
        || !valid_postgres_identifier(&material.target_field)
        || material.cursor_field == material.target_field
        || material.maximum_cursor != MAXIMUM_SAFE_INTEGER
        || material.batch_size == 0
        || material.batch_size > MAXIMUM_BATCH_SIZE
        || material.maximum_batch_receipt_count != MAXIMUM_BATCH_RECEIPT_COUNT
    {
        return Err(BackendBackfillInspectionSubjectErrorV1::InvalidMaterial);
    }
    for digest in [
        &material.provider_authority_digest,
        &material.application_digest,
        &material.migration_digest,
        &material.migration_plan_digest,
        &material.inspection_subject_digest,
    ] {
        decode_digest(digest)
            .map_err(|_| BackendBackfillInspectionSubjectErrorV1::InvalidMaterial)?;
    }
    let scope = serde_json::json!({
        "applicationDigest": material.application_digest,
        "applicationId": material.application_id,
        "migrationDigest": material.migration_digest,
        "migrationId": material.migration_id,
        "migrationPlanDigest": material.migration_plan_digest,
        "providerAuthorityDigest": material.provider_authority_digest,
        "providerId": material.provider_id,
    });
    let canonical = canonical_bytes(&scope)
        .map_err(|_| BackendBackfillInspectionSubjectErrorV1::InvalidMaterial)?;
    let mut hasher = Sha256::new();
    hasher.update(INSPECTION_SCOPE_DOMAIN.as_bytes());
    hasher.update([0]);
    hasher.update(canonical);
    Ok(hasher.finalize().into())
}

struct ActiveEntryV1 {
    issuer_id: [u8; ID_BYTES],
    generation: u64,
    scope_digest: [u8; 32],
    material: BackfillInspectionSubjectMaterialV1,
    expires_at_ns: u128,
}

struct BurnedEntryV1 {
    id: [u8; ID_BYTES],
    scope_digest: [u8; 32],
    expires_at_ns: u128,
}

#[derive(Default)]
struct RegistryStateV1 {
    active: HashMap<[u8; ID_BYTES], ActiveEntryV1>,
    burned: VecDeque<BurnedEntryV1>,
    last_monotonic_ns: Option<u128>,
    next_generation: u64,
}

impl RegistryStateV1 {
    fn observe_clock(&mut self, now: u128) -> Result<(), BackendBackfillInspectionSubjectErrorV1> {
        if self.last_monotonic_ns.is_some_and(|last| now < last) {
            return Err(BackendBackfillInspectionSubjectErrorV1::ClockUnavailable);
        }
        self.last_monotonic_ns = Some(now);
        Ok(())
    }

    fn purge_expired(&mut self, now: u128) {
        self.active.retain(|_, entry| entry.expires_at_ns > now);
        self.burned.retain(|entry| entry.expires_at_ns > now);
    }

    fn contains_id(&self, id: &[u8; ID_BYTES]) -> bool {
        self.active.contains_key(id) || self.burned.iter().any(|entry| &entry.id == id)
    }

    fn contains_scope(&self, scope_digest: &[u8; 32]) -> bool {
        self.active
            .values()
            .any(|entry| &entry.scope_digest == scope_digest)
            || self
                .burned
                .iter()
                .any(|entry| &entry.scope_digest == scope_digest)
    }

    fn burn(&mut self, id: [u8; ID_BYTES], entry: ActiveEntryV1, now: u128) {
        if entry.expires_at_ns > now {
            self.burned.push_back(BurnedEntryV1 {
                id,
                scope_digest: entry.scope_digest,
                expires_at_ns: entry.expires_at_ns,
            });
        }
    }
}

trait InspectionClockV1: Send + Sync {
    fn monotonic_ns(&self) -> Result<u128, BackendBackfillInspectionSubjectErrorV1>;
}

struct SystemInspectionClockV1(Instant);

impl SystemInspectionClockV1 {
    fn new() -> Self {
        Self(Instant::now())
    }
}

impl InspectionClockV1 for SystemInspectionClockV1 {
    fn monotonic_ns(&self) -> Result<u128, BackendBackfillInspectionSubjectErrorV1> {
        Ok(self.0.elapsed().as_nanos())
    }
}

trait InspectionEntropyV1: Send + Sync {
    fn fill(&self, output: &mut [u8]) -> Result<(), BackendBackfillInspectionSubjectErrorV1>;
}

struct SystemInspectionEntropyV1(SystemRandom);

impl SystemInspectionEntropyV1 {
    fn new() -> Self {
        Self(SystemRandom::new())
    }
}

impl InspectionEntropyV1 for SystemInspectionEntropyV1 {
    fn fill(&self, output: &mut [u8]) -> Result<(), BackendBackfillInspectionSubjectErrorV1> {
        self.0
            .fill(output)
            .map_err(|_| BackendBackfillInspectionSubjectErrorV1::EntropyUnavailable)
    }
}

struct RegistryInnerV1 {
    issuer_id: [u8; ID_BYTES],
    clock: Arc<dyn InspectionClockV1>,
    entropy: Arc<dyn InspectionEntropyV1>,
    maximum_entries: usize,
    ttl: Duration,
    state: Mutex<RegistryStateV1>,
}

/// Dormant process-local registry. Its sole production issuer accepts only the private strict
/// Compiler decoder result, never JSON, a digest, a renderer value, or this projection.
pub(crate) struct BackendBackfillInspectionSubjectRegistryV1 {
    inner: Arc<RegistryInnerV1>,
}

impl BackendBackfillInspectionSubjectRegistryV1 {
    pub(crate) fn new_dormant_production() -> Result<Self, BackendBackfillInspectionSubjectErrorV1>
    {
        Self::with_dependencies(
            MAXIMUM_ENTRIES,
            HANDLE_TTL,
            Arc::new(SystemInspectionClockV1::new()),
            Arc::new(SystemInspectionEntropyV1::new()),
        )
    }

    fn with_dependencies(
        maximum_entries: usize,
        ttl: Duration,
        clock: Arc<dyn InspectionClockV1>,
        entropy: Arc<dyn InspectionEntropyV1>,
    ) -> Result<Self, BackendBackfillInspectionSubjectErrorV1> {
        if maximum_entries == 0 || maximum_entries > MAXIMUM_ENTRIES || ttl.is_zero() {
            return Err(BackendBackfillInspectionSubjectErrorV1::RegistryUnavailable);
        }
        let mut issuer_id = [0_u8; ID_BYTES];
        entropy.fill(&mut issuer_id)?;
        if issuer_id == [0; ID_BYTES] {
            return Err(BackendBackfillInspectionSubjectErrorV1::EntropyUnavailable);
        }
        Ok(Self {
            inner: Arc::new(RegistryInnerV1 {
                issuer_id,
                clock,
                entropy,
                maximum_entries,
                ttl,
                state: Mutex::new(RegistryStateV1::default()),
            }),
        })
    }

    pub(crate) fn consume_for_initializer(
        &self,
        mut proof: SealedBackfillInspectionSubjectProofV1,
    ) -> Result<ConsumedBackfillInspectionSubjectProofV1, BackendBackfillInspectionSubjectErrorV1>
    {
        let proof_registry = proof
            .registry
            .upgrade()
            .ok_or(BackendBackfillInspectionSubjectErrorV1::HandleInvalid)?;
        if !Arc::ptr_eq(&proof_registry, &self.inner) {
            return Err(BackendBackfillInspectionSubjectErrorV1::HandleInvalid);
        }
        let mut state = self
            .inner
            .state
            .lock()
            .map_err(|_| BackendBackfillInspectionSubjectErrorV1::RegistryUnavailable)?;
        let now = self.inner.clock.monotonic_ns()?;
        state.observe_clock(now)?;
        let matches = state.active.get(&proof.id).is_some_and(|entry| {
            entry.issuer_id == proof.issuer_id
                && proof.issuer_id == self.inner.issuer_id
                && entry.generation == proof.generation
        });
        if !matches {
            proof.armed = false;
            state.purge_expired(now);
            return Err(BackendBackfillInspectionSubjectErrorV1::HandleInvalid);
        }
        let entry = state
            .active
            .remove(&proof.id)
            .ok_or(BackendBackfillInspectionSubjectErrorV1::HandleInvalid)?;
        let expired = entry.expires_at_ns <= now;
        let scope_digest = entry.scope_digest;
        let material = entry.material.clone();
        state.burn(proof.id, entry, now);
        state.purge_expired(now);
        proof.armed = false;
        if expired {
            return Err(BackendBackfillInspectionSubjectErrorV1::HandleExpired);
        }
        if validate_material(&material)? != scope_digest {
            return Err(BackendBackfillInspectionSubjectErrorV1::InvalidMaterial);
        }
        Ok(ConsumedBackfillInspectionSubjectProofV1 { material })
    }

    #[cfg(test)]
    pub(crate) fn issue_material_for_test(
        &self,
        material: BackfillInspectionSubjectMaterialV1,
    ) -> Result<SealedBackfillInspectionSubjectProofV1, BackendBackfillInspectionSubjectErrorV1>
    {
        let scope_digest = validate_material(&material)?;
        self.issue_validated_for_test(material, scope_digest)
    }

    #[cfg(test)]
    fn issue_canonical_envelope_for_test(
        &self,
        bytes: &[u8],
    ) -> Result<SealedBackfillInspectionSubjectProofV1, BackendBackfillInspectionSubjectErrorV1>
    {
        if bytes.len() > MAXIMUM_CANONICAL_BYTES {
            return Err(BackendBackfillInspectionSubjectErrorV1::InvalidEnvelope);
        }
        let envelope: CompilerBackfillInspectionSubjectEnvelopeV1 =
            serde_json::from_slice(bytes)
                .map_err(|_| BackendBackfillInspectionSubjectErrorV1::InvalidEnvelope)?;
        if canonical_bytes(&envelope)? != bytes {
            return Err(BackendBackfillInspectionSubjectErrorV1::NonCanonicalEnvelope);
        }
        let material = validate_and_project(&envelope)?;
        let scope_digest = validate_material(&material)?;
        self.issue_validated_for_test(material, scope_digest)
    }

    #[cfg(test)]
    fn issue_validated_for_test(
        &self,
        material: BackfillInspectionSubjectMaterialV1,
        scope_digest: [u8; 32],
    ) -> Result<SealedBackfillInspectionSubjectProofV1, BackendBackfillInspectionSubjectErrorV1>
    {
        let mut state = self
            .inner
            .state
            .lock()
            .map_err(|_| BackendBackfillInspectionSubjectErrorV1::RegistryUnavailable)?;
        let now = self.inner.clock.monotonic_ns()?;
        state.observe_clock(now)?;
        state.purge_expired(now);
        if state.contains_scope(&scope_digest) {
            return Err(BackendBackfillInspectionSubjectErrorV1::ScopeAlreadyActive);
        }
        if state.active.len() + state.burned.len() >= self.inner.maximum_entries {
            return Err(BackendBackfillInspectionSubjectErrorV1::RegistryFull);
        }
        let expires_at_ns = now
            .checked_add(self.inner.ttl.as_nanos())
            .ok_or(BackendBackfillInspectionSubjectErrorV1::ClockUnavailable)?;
        let generation = state
            .next_generation
            .checked_add(1)
            .ok_or(BackendBackfillInspectionSubjectErrorV1::RegistryFull)?;
        for _ in 0..ID_ATTEMPTS {
            let mut id = [0_u8; ID_BYTES];
            self.inner.entropy.fill(&mut id)?;
            if id == [0; ID_BYTES] || state.contains_id(&id) {
                continue;
            }
            state.next_generation = generation;
            state.active.insert(
                id,
                ActiveEntryV1 {
                    issuer_id: self.inner.issuer_id,
                    generation,
                    scope_digest,
                    material,
                    expires_at_ns,
                },
            );
            return Ok(SealedBackfillInspectionSubjectProofV1 {
                id,
                issuer_id: self.inner.issuer_id,
                generation,
                registry: Arc::downgrade(&self.inner),
                armed: true,
            });
        }
        Err(BackendBackfillInspectionSubjectErrorV1::IdCollision)
    }
}

/// Opaque, non-cloneable and non-serializable proof. Production issuance requires the private
/// strict Compiler decoder result.
pub(crate) struct SealedBackfillInspectionSubjectProofV1 {
    id: [u8; ID_BYTES],
    issuer_id: [u8; ID_BYTES],
    generation: u64,
    registry: Weak<RegistryInnerV1>,
    armed: bool,
}

/// One-shot, non-cloneable and non-serializable data handoff retained by C0.
pub(crate) struct ConsumedBackfillInspectionSubjectProofV1 {
    material: BackfillInspectionSubjectMaterialV1,
}

impl ConsumedBackfillInspectionSubjectProofV1 {
    pub(crate) fn material_for_composition(&self) -> &BackfillInspectionSubjectMaterialV1 {
        &self.material
    }

    pub(crate) const fn database_authority_created(&self) -> bool {
        false
    }

    pub(crate) const fn mutation_authorized(&self) -> bool {
        false
    }

    pub(crate) const fn execution_authorized(&self) -> bool {
        false
    }

    pub(crate) const fn receipt_authority_created(&self) -> bool {
        false
    }

    pub(crate) const fn automatic_retry_allowed(&self) -> bool {
        false
    }

    pub(crate) const fn release_authorized(&self) -> bool {
        false
    }
}

impl Drop for SealedBackfillInspectionSubjectProofV1 {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        let Some(registry) = self.registry.upgrade() else {
            return;
        };
        let Ok(mut state) = registry.state.lock() else {
            return;
        };
        let Ok(now) = registry.clock.monotonic_ns() else {
            return;
        };
        if state.observe_clock(now).is_err() {
            return;
        }
        let matches = state.active.get(&self.id).is_some_and(|entry| {
            entry.issuer_id == self.issuer_id
                && self.issuer_id == registry.issuer_id
                && entry.generation == self.generation
        });
        if matches {
            if let Some(entry) = state.active.remove(&self.id) {
                state.burn(self.id, entry, now);
            }
        }
        self.armed = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &[u8] =
        include_bytes!("../../tests/fixtures/backend/supabase/backfill-inspection-subject-v1.json");
    const FLOAT_FIXTURE: &[u8] = include_bytes!(
        "../../tests/fixtures/backend/supabase/backfill-inspection-subject-float-v1.json"
    );

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct FixtureV1 {
        fixture_format: String,
        fixture_version: u8,
        envelope: CompilerBackfillInspectionSubjectEnvelopeV1,
        projection: BackfillInspectionSubjectMaterialV1,
    }

    fn fixture() -> FixtureV1 {
        serde_json::from_slice(FIXTURE).unwrap()
    }

    fn float_fixture() -> FixtureV1 {
        serde_json::from_slice(FLOAT_FIXTURE).unwrap()
    }

    fn canonical_envelope(fixture: &FixtureV1) -> Vec<u8> {
        canonical_bytes(&fixture.envelope).unwrap()
    }

    #[test]
    fn typescript_golden_has_the_exact_native_digest_and_projection() {
        let fixture = fixture();
        assert_eq!(
            fixture.fixture_format,
            "openpencil.test.backend.supabase.backfill-inspection-subject.v1"
        );
        assert_eq!(fixture.fixture_version, 1);
        assert_eq!(
            fixture.envelope.subject_digest,
            "of6OQvbmeAAGrQ334AOIBgYYNfud1MwG6k-QyODzL_A"
        );
        assert_eq!(
            digest_bytes(&canonical_bytes(&fixture.envelope.subject).unwrap()),
            fixture.envelope.subject_digest
        );
        assert_eq!(
            validate_and_project(&fixture.envelope).unwrap(),
            fixture.projection
        );

        let registry =
            BackendBackfillInspectionSubjectRegistryV1::new_dormant_production().unwrap();
        let proof = registry
            .issue_canonical_envelope_for_test(&canonical_envelope(&fixture))
            .unwrap();
        let consumed = registry.consume_for_initializer(proof).unwrap();
        assert_eq!(consumed.material_for_composition(), &fixture.projection);
        assert!(!consumed.database_authority_created());
        assert!(!consumed.mutation_authorized());
        assert!(!consumed.execution_authorized());
        assert!(!consumed.receipt_authority_created());
        assert!(!consumed.automatic_retry_allowed());
        assert!(!consumed.release_authorized());
    }

    #[test]
    fn typescript_float_and_optional_matched_row_golden_match_native_canonical_json() {
        let fixture = float_fixture();
        assert_eq!(
            fixture.fixture_format,
            "openpencil.test.backend.supabase.backfill-inspection-subject-float.v1"
        );
        assert_eq!(
            fixture.envelope.subject_digest,
            "ATiXbwjwvx9pOGdqm1tweQlyN4CwIlMCSAC3xzX3vtc"
        );
        assert_eq!(
            digest_bytes(&canonical_bytes(&fixture.envelope.subject).unwrap()),
            fixture.envelope.subject_digest
        );
        assert_eq!(
            validate_and_project(&fixture.envelope).unwrap(),
            fixture.projection
        );
        assert_eq!(
            fixture
                .envelope
                .subject
                .migration
                .target
                .expected_literal
                .as_f64(),
            Some(1.5)
        );
        assert_eq!(
            fixture
                .envelope
                .subject
                .migration
                .required_matched_row_count,
            None
        );
    }

    #[test]
    fn ecmascript_number_formatter_matches_json_stringify_boundaries() {
        let cases = [
            (1.0, "1"),
            (1.5, "1.5"),
            (1e-6, "0.000001"),
            (1e-7, "1e-7"),
            (1e20, "100000000000000000000"),
            (1e21, "1e+21"),
            (333_333_333.333_333_3, "333333333.3333333"),
            (1e23, "1e+23"),
            (1e-27, "1e-27"),
            (5e-324, "5e-324"),
            (1.797_693_134_862_315_7e308, "1.7976931348623157e+308"),
            (2.225_073_858_507_201_4e-308, "2.2250738585072014e-308"),
            (9_007_199_254_740_992.0, "9007199254740992"),
            (0.000_001_234_5, "0.0000012345"),
            (1_000_000_000_000_000_100.0, "1000000000000000100"),
            (-12.5, "-12.5"),
        ];
        for (value, expected) in cases {
            let number = serde_json::Number::from_f64(value).unwrap();
            assert_eq!(ecmascript_number_json(&number).unwrap(), expected);
        }
        let negative_zero = serde_json::Number::from_f64(-0.0).unwrap();
        assert_eq!(
            ecmascript_number_json(&negative_zero).err().unwrap(),
            BackendBackfillInspectionSubjectErrorV1::InvalidEnvelope
        );
    }

    #[test]
    fn semantic_validator_accepts_bounded_matched_rows_and_rejects_forged_type_or_identifiers() {
        let mut bounded = fixture().envelope;
        bounded.subject.migration.required_matched_row_count = Some(500);
        bounded.subject_digest = digest_bytes(&canonical_bytes(&bounded.subject).unwrap());
        validate_and_project(&bounded).unwrap();

        let mut wrong_type = bounded.clone();
        wrong_type.subject.migration.target.postgres_type = "pg_catalog.bool".to_owned();
        wrong_type.subject_digest = digest_bytes(&canonical_bytes(&wrong_type.subject).unwrap());
        assert_eq!(
            validate_and_project(&wrong_type).err().unwrap(),
            BackendBackfillInspectionSubjectErrorV1::InvalidEnvelope
        );

        let mut same_field = bounded.clone();
        same_field.subject.migration.target.field_id =
            same_field.subject.migration.cursor.field_id.clone();
        same_field.subject.migration.target.field =
            same_field.subject.migration.cursor.field.clone();
        same_field.subject.migration.target.marker =
            same_field.subject.migration.cursor.marker.clone();
        same_field.subject_digest = digest_bytes(&canonical_bytes(&same_field.subject).unwrap());
        assert_eq!(
            validate_and_project(&same_field).err().unwrap(),
            BackendBackfillInspectionSubjectErrorV1::InvalidEnvelope
        );

        let mut invalid_table = bounded;
        invalid_table.subject.migration.entity.table = "9-invalid".to_owned();
        invalid_table.subject_digest =
            digest_bytes(&canonical_bytes(&invalid_table.subject).unwrap());
        assert_eq!(
            validate_and_project(&invalid_table).err().unwrap(),
            BackendBackfillInspectionSubjectErrorV1::InvalidEnvelope
        );
    }

    #[test]
    fn parser_rejects_unknown_noncanonical_and_semantically_forged_envelopes() {
        let fixture = fixture();
        let registry =
            BackendBackfillInspectionSubjectRegistryV1::new_dormant_production().unwrap();
        let pretty = serde_json::to_vec_pretty(&fixture.envelope).unwrap();
        assert_eq!(
            registry
                .issue_canonical_envelope_for_test(&pretty)
                .err()
                .unwrap(),
            BackendBackfillInspectionSubjectErrorV1::NonCanonicalEnvelope
        );

        let mut unknown = serde_json::to_value(&fixture.envelope).unwrap();
        unknown["subject"]["inspection"]["unexpected"] = Value::Bool(true);
        let unknown = canonical_bytes(&unknown).unwrap();
        assert_eq!(
            registry
                .issue_canonical_envelope_for_test(&unknown)
                .err()
                .unwrap(),
            BackendBackfillInspectionSubjectErrorV1::InvalidEnvelope
        );

        let mut forged = serde_json::to_value(&fixture.envelope).unwrap();
        forged["subject"]["reviewOnly"] = Value::Bool(false);
        let forged_subject = canonical_bytes(&forged["subject"]).unwrap();
        forged["subjectDigest"] = Value::String(digest_bytes(&forged_subject));
        let forged = canonical_bytes(&forged).unwrap();
        assert_eq!(
            registry
                .issue_canonical_envelope_for_test(&forged)
                .err()
                .unwrap(),
            BackendBackfillInspectionSubjectErrorV1::InvalidEnvelope
        );
    }

    #[test]
    fn parser_rejects_duplicate_oversized_invalid_utf8_and_unsafe_numbers() {
        let fixture = fixture();
        let registry =
            BackendBackfillInspectionSubjectRegistryV1::new_dormant_production().unwrap();
        assert_eq!(
            registry
                .issue_canonical_envelope_for_test(&vec![b' '; MAXIMUM_CANONICAL_BYTES + 1])
                .err()
                .unwrap(),
            BackendBackfillInspectionSubjectErrorV1::InvalidEnvelope
        );
        assert_eq!(
            registry
                .issue_canonical_envelope_for_test(&[0xff])
                .err()
                .unwrap(),
            BackendBackfillInspectionSubjectErrorV1::InvalidEnvelope
        );

        let subject =
            String::from_utf8(canonical_bytes(&fixture.envelope.subject).unwrap()).unwrap();
        let duplicate = format!(
            "{{\"subject\":{subject},\"subject\":{subject},\"subjectDigest\":{}}}",
            serde_json::to_string(&fixture.envelope.subject_digest).unwrap()
        );
        assert_eq!(
            registry
                .issue_canonical_envelope_for_test(duplicate.as_bytes())
                .err()
                .unwrap(),
            BackendBackfillInspectionSubjectErrorV1::InvalidEnvelope
        );

        let canonical = String::from_utf8(canonical_envelope(&fixture)).unwrap();
        let unsafe_number = canonical.replace(
            &MAXIMUM_SAFE_INTEGER.to_string(),
            &(MAXIMUM_SAFE_INTEGER + 1).to_string(),
        );
        assert_ne!(unsafe_number, canonical);
        assert_eq!(
            registry
                .issue_canonical_envelope_for_test(unsafe_number.as_bytes())
                .err()
                .unwrap(),
            BackendBackfillInspectionSubjectErrorV1::InvalidEnvelope
        );

        let negative_zero = canonical.replace(
            "\"requiredMatchedRowCount\":1",
            "\"requiredMatchedRowCount\":-0",
        );
        assert_ne!(negative_zero, canonical);
        assert_eq!(
            registry
                .issue_canonical_envelope_for_test(negative_zero.as_bytes())
                .err()
                .unwrap(),
            BackendBackfillInspectionSubjectErrorV1::InvalidEnvelope
        );
    }

    #[test]
    fn registry_is_single_flight_one_shot_and_wrong_registry_burns_the_proof() {
        let fixture = fixture();
        let first = BackendBackfillInspectionSubjectRegistryV1::new_dormant_production().unwrap();
        let second = BackendBackfillInspectionSubjectRegistryV1::new_dormant_production().unwrap();
        let canonical = canonical_envelope(&fixture);
        let proof = first.issue_canonical_envelope_for_test(&canonical).unwrap();
        assert_eq!(
            first
                .issue_canonical_envelope_for_test(&canonical)
                .err()
                .unwrap(),
            BackendBackfillInspectionSubjectErrorV1::ScopeAlreadyActive
        );
        assert_eq!(
            second.consume_for_initializer(proof).err().unwrap(),
            BackendBackfillInspectionSubjectErrorV1::HandleInvalid
        );
        assert_eq!(
            first
                .issue_canonical_envelope_for_test(&canonical)
                .err()
                .unwrap(),
            BackendBackfillInspectionSubjectErrorV1::ScopeAlreadyActive
        );
    }

    #[test]
    fn production_source_has_no_raw_issuer_or_external_authority() {
        let source = include_str!("backend_backfill_inspection_subject.rs");
        let sidecar = include_str!("backend_backfill_inspection_subject/compiler_sidecar.rs");
        let lib = include_str!("lib.rs");
        assert!(lib.contains("mod backend_backfill_inspection_subject;"));
        assert!(source.contains("#[cfg(test)]\n    pub(crate) fn issue_material_for_test("));
        assert!(source.contains("#[cfg(test)]\n    fn issue_canonical_envelope_for_test("));
        let issuer_start = sidecar
            .find("fn issue_validated_compiler_inspection(")
            .unwrap();
        let issuer_end = issuer_start
            + sidecar[issuer_start..]
                .find("    {")
                .expect("production issuer signature must end before its body");
        let issuer_signature = &sidecar[issuer_start..issuer_end];
        assert!(issuer_signature.contains("validated: ValidatedCompilerInspectionV1"));
        for forbidden in [
            "BackfillInspectionSubjectMaterialV1",
            "CompilerBackfillInspectionSubjectEnvelopeV1",
            "Value",
            "&[u8]",
            "[u8; 32]",
            "String",
        ] {
            assert!(
                !issuer_signature.contains(forbidden),
                "raw issuer input in production signature: {forbidden}"
            );
        }
        assert!(sidecar.contains("fn into_material(self) -> BackfillInspectionSubjectMaterialV1"));
        assert!(sidecar.contains("#[path = \"compiler_sidecar_runner.rs\"]\nmod runner;"));
        for private_item in [
            "struct CompilerBackfillRequestV1",
            "struct ValidatedCompilerInspectionV1",
            "fn decode_compiler_sidecar_response(",
            "fn issue_validated_compiler_inspection(",
        ] {
            assert!(sidecar.contains(private_item));
            assert!(!sidecar.contains(&format!("pub(super) {private_item}")));
            assert!(!sidecar.contains(&format!("pub(crate) {private_item}")));
            assert!(!sidecar.contains(&format!("pub {private_item}")));
        }
        for forbidden in [
            concat!("#[tauri", "::command]"),
            concat!("reqwest", "::"),
            concat!("Credential", "Resolver"),
            concat!("TrustedOperation", "PlanV1"),
            concat!("CREATE ", "TABLE"),
            concat!("ALTER ", "TABLE"),
            concat!("begin_outcome_", "unknown"),
            concat!("production", "_issuer"),
        ] {
            assert!(!source.contains(forbidden), "forbidden source: {forbidden}");
        }
        assert!(!source.contains(concat!(
            "impl Clone for SealedBackfillInspection",
            "SubjectProofV1"
        )));
        assert!(!source.contains(concat!(
            "Serialize for SealedBackfillInspection",
            "SubjectProofV1"
        )));
        for forbidden in [
            concat!("std", "::process"),
            concat!("tokio", "::process"),
            concat!("Command", "::new"),
            concat!("#[tauri", "::command]"),
            concat!("reqwest", "::"),
            concat!("sqlx", "::"),
            concat!("backend_operation", "_journal"),
            concat!("backend_receipt_zero", "_initializer"),
        ] {
            assert!(
                !sidecar.contains(forbidden),
                "forbidden Compiler sidecar decoder source: {forbidden}"
            );
        }
    }
}
