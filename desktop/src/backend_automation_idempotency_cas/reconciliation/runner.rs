//! One-shot, fixed-stage runner state machine for the dormant reconciliation read.

use super::{PARAMETER_SCHEMA_DIGEST, RECONCILIATION_QUERY_DIGEST};
use crate::supabase_backfill_fixed_read::contains_secret_like_material;

use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine as _,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    future::{poll_fn, Future},
    pin::pin,
    sync::atomic::{AtomicU8, Ordering},
    task::{Poll, Waker},
    time::Duration,
};

const READY: u8 = 0;
const RUNNING: u8 = 1;
const BURNED: u8 = 2;

pub(super) const STATEMENT_TIMEOUT_MS: u32 = 15_000;
pub(super) const OVERALL_TIMEOUT: Duration = Duration::from_secs(30);
pub(super) const MAXIMUM_RESPONSE_ROWS: u8 = 1;
pub(super) const MAXIMUM_RESPONSE_COLUMNS: u8 = 1;
pub(super) const MAXIMUM_RESPONSE_BYTES: usize = 128 * 1_024;
const PARAMETER_COUNT: usize = 27;
const MAXIMUM_PARAMETER_STRING_BYTES: usize = 32 * 1_024;
const MAXIMUM_AGGREGATE_PARAMETER_BYTES: usize = 64 * 1_024;
const MAXIMUM_CANONICAL_DOCUMENT_BYTES: usize = 16_384;
const MAXIMUM_IDENTIFIER_BYTES: usize = 256;
const MAXIMUM_ATTEMPTS: usize = 20;
const MAXIMUM_CAUSATION_HOP: i32 = 16;
const MAXIMUM_RETENTION_HOURS: i32 = 2_160;
const MAXIMUM_REVISION: i64 = 1_024;
const MAXIMUM_SQL_BYTES: usize = 128 * 1_024;
const PROPOSAL_FORMAT: &str = "openpencil.backend-automation-idempotency-cas-proposal";
const RECORD_FORMAT: &str = "openpencil.backend-automation-idempotency-record";
const QUERY_ID: &str = "supabase-automation-idempotency-cas-reconciliation";
const QUERY_VERSION: &str = "openpencil-supabase-automation-idempotency-cas-reconciliation-v1";
const SQL_SCHEMA_SENTINEL: &str = "__OPENPENCIL_AUTOMATION_IDEMPOTENCY_SCHEMA__";
const SQL_SCHEMA_SENTINEL_COUNT: usize = 17;
pub(super) const SQL_TEMPLATE_SOURCE: &str = include_str!(
    "../../../../src/app/plugins/host/deployment/supabase/automation/idempotency/cas/reconciliation/v1.sql"
);
pub(super) const SQL_TEMPLATE_BYTE_LENGTH: usize = 72_823;
pub(super) const SQL_TEMPLATE_SHA256: [u8; 32] = [
    0x71, 0x29, 0xd8, 0xee, 0xd3, 0xad, 0x3a, 0x4e, 0xc6, 0x64, 0x67, 0xc3, 0xc6, 0xf8, 0x57, 0x2e,
    0x64, 0xa8, 0x78, 0x9a, 0x69, 0x8a, 0xa5, 0x53, 0xfe, 0x97, 0x52, 0xa3, 0x65, 0x75, 0xb7, 0xea,
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct ReadLimitsV1 {
    pub(super) access_mode: &'static str,
    pub(super) statement_timeout_ms: u32,
    pub(super) overall_timeout: Duration,
    pub(super) maximum_response_rows: u8,
    pub(super) maximum_response_columns: u8,
    pub(super) maximum_response_bytes: usize,
}

pub(super) const READ_LIMITS: ReadLimitsV1 = ReadLimitsV1 {
    access_mode: "read-only",
    statement_timeout_ms: STATEMENT_TIMEOUT_MS,
    overall_timeout: OVERALL_TIMEOUT,
    maximum_response_rows: MAXIMUM_RESPONSE_ROWS,
    maximum_response_columns: MAXIMUM_RESPONSE_COLUMNS,
    maximum_response_bytes: MAXIMUM_RESPONSE_BYTES,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum DatabaseFailureV1 {
    /// No complete, authenticated server reply exists for the stage.
    Unavailable,
    /// A complete server reply proves that the stage was rejected.
    Rejected,
    Cancelled,
    TimedOut,
    ResponseLimitExceeded,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ReadStageV1 {
    BeginReadOnly,
    SearchPath,
    RowSecurity,
    StatementTimeout,
    Prepare,
    Execute,
    Finish,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum DatabaseColumnTypeV1 {
    Text,
    Other,
}

/// Opaque, deterministically rendered fixed statement. There is no caller-SQL field or production
/// constructor, so the adapter can receive only the pinned TypeScript artifact.
#[derive(Clone)]
pub(super) struct FixedStatementArtifactV1 {
    schema_name: String,
    rendered_sql: String,
    rendered_sha256: [u8; 32],
}

impl FixedStatementArtifactV1 {
    pub(super) fn render(application_object_key: &str) -> Result<Self, ReconciliationErrorV1> {
        validate_fixed_template()?;
        if !valid_application_object_key(application_object_key) {
            return Err(ReconciliationErrorV1::InvalidApplicationObjectKey);
        }
        let schema_name = format!("op_automation_{application_object_key}");
        let rendered_sql = SQL_TEMPLATE_SOURCE.replace(SQL_SCHEMA_SENTINEL, &schema_name);
        if rendered_sql.contains(SQL_SCHEMA_SENTINEL)
            || rendered_sql.matches(&schema_name).count() != SQL_SCHEMA_SENTINEL_COUNT
            || rendered_sql.len() > MAXIMUM_SQL_BYTES
        {
            return Err(ReconciliationErrorV1::InvalidStaticStatement);
        }
        let rendered_sha256 = <[u8; 32]>::from(Sha256::digest(rendered_sql.as_bytes()));
        Ok(Self {
            schema_name,
            rendered_sql,
            rendered_sha256,
        })
    }

    pub(super) fn query_id(&self) -> &'static str {
        QUERY_ID
    }

    pub(super) fn query_version(&self) -> &'static str {
        QUERY_VERSION
    }

    pub(super) fn schema_name(&self) -> &str {
        &self.schema_name
    }

    pub(super) fn source(&self) -> &str {
        &self.rendered_sql
    }

    pub(super) fn byte_length(&self) -> usize {
        self.rendered_sql.len()
    }

    pub(super) fn template_byte_length(&self) -> usize {
        SQL_TEMPLATE_BYTE_LENGTH
    }

    pub(super) fn template_sha256(&self) -> [u8; 32] {
        SQL_TEMPLATE_SHA256
    }

    pub(super) fn rendered_sha256(&self) -> [u8; 32] {
        self.rendered_sha256
    }

    fn schema_marker_digest(&self) -> String {
        let application_object_key = self
            .schema_name
            .strip_prefix("op_automation_")
            .expect("validated schema prefix");
        digest_base64url(
            format!(
                "openpencil.supabase-automation-idempotency-ledger.v1;application={application_object_key};object=schema"
            )
            .as_bytes(),
        )
    }

    fn validate(&self) -> Result<(), ReconciliationErrorV1> {
        let key = self
            .schema_name
            .strip_prefix("op_automation_")
            .ok_or(ReconciliationErrorV1::InvalidStaticStatement)?;
        let expected = Self::render(key)?;
        if self.schema_name != expected.schema_name
            || self.rendered_sql != expected.rendered_sql
            || self.rendered_sha256 != expected.rendered_sha256
        {
            return Err(ReconciliationErrorV1::InvalidStaticStatement);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum BoundParameterValueV1 {
    Text(Option<String>),
    Int8(Option<i64>),
    Int4(i32),
    TextArray(Vec<String>),
    Boolean(bool),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct BoundParameterV1 {
    pub(super) position: u8,
    pub(super) name: &'static str,
    pub(super) value: BoundParameterValueV1,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ParameterTypeV1 {
    Text,
    Int8,
    Int4,
    TextArray,
    Boolean,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ParameterEncodingV1 {
    Digest,
    StandardBase64,
    Identifier,
    Integer,
    CanonicalUtcMillis,
    IdentifierArray,
    State,
    FixedFalse,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ParameterSpecV1 {
    position: u8,
    name: &'static str,
    parameter_type: ParameterTypeV1,
    nullable: bool,
    encoding: ParameterEncodingV1,
    sql_cast: &'static str,
}

const fn parameter(
    position: u8,
    name: &'static str,
    parameter_type: ParameterTypeV1,
    nullable: bool,
    encoding: ParameterEncodingV1,
    sql_cast: &'static str,
) -> ParameterSpecV1 {
    ParameterSpecV1 {
        position,
        name,
        parameter_type,
        nullable,
        encoding,
        sql_cast,
    }
}

const TEXT_CAST: &str = "\"pg_catalog\".\"text\"";
const INT8_CAST: &str = "\"pg_catalog\".\"int8\"";
const INT4_CAST: &str = "\"pg_catalog\".\"int4\"";
const TEXT_ARRAY_CAST: &str = "\"pg_catalog\".\"text\"[]";
const BOOL_CAST: &str = "\"pg_catalog\".\"bool\"";

const PARAMETER_SCHEMA: [ParameterSpecV1; PARAMETER_COUNT] = [
    parameter(
        1,
        "proposalDigest",
        ParameterTypeV1::Text,
        false,
        ParameterEncodingV1::Digest,
        TEXT_CAST,
    ),
    parameter(
        2,
        "canonicalProposalBase64",
        ParameterTypeV1::Text,
        false,
        ParameterEncodingV1::StandardBase64,
        TEXT_CAST,
    ),
    parameter(
        3,
        "recordDigest",
        ParameterTypeV1::Text,
        false,
        ParameterEncodingV1::Digest,
        TEXT_CAST,
    ),
    parameter(
        4,
        "canonicalRecordBase64",
        ParameterTypeV1::Text,
        false,
        ParameterEncodingV1::StandardBase64,
        TEXT_CAST,
    ),
    parameter(
        5,
        "automationId",
        ParameterTypeV1::Text,
        false,
        ParameterEncodingV1::Identifier,
        TEXT_CAST,
    ),
    parameter(
        6,
        "eventId",
        ParameterTypeV1::Text,
        false,
        ParameterEncodingV1::Identifier,
        TEXT_CAST,
    ),
    parameter(
        7,
        "operationId",
        ParameterTypeV1::Text,
        false,
        ParameterEncodingV1::Identifier,
        TEXT_CAST,
    ),
    parameter(
        8,
        "idempotencyKeyDigest",
        ParameterTypeV1::Text,
        false,
        ParameterEncodingV1::Digest,
        TEXT_CAST,
    ),
    parameter(
        9,
        "causationId",
        ParameterTypeV1::Text,
        false,
        ParameterEncodingV1::Identifier,
        TEXT_CAST,
    ),
    parameter(
        10,
        "causationHop",
        ParameterTypeV1::Int4,
        false,
        ParameterEncodingV1::Integer,
        INT4_CAST,
    ),
    parameter(
        11,
        "retentionHours",
        ParameterTypeV1::Int4,
        false,
        ParameterEncodingV1::Integer,
        INT4_CAST,
    ),
    parameter(
        12,
        "createdAt",
        ParameterTypeV1::Text,
        false,
        ParameterEncodingV1::CanonicalUtcMillis,
        TEXT_CAST,
    ),
    parameter(
        13,
        "expiresAt",
        ParameterTypeV1::Text,
        false,
        ParameterEncodingV1::CanonicalUtcMillis,
        TEXT_CAST,
    ),
    parameter(
        14,
        "recordedAt",
        ParameterTypeV1::Text,
        false,
        ParameterEncodingV1::CanonicalUtcMillis,
        TEXT_CAST,
    ),
    parameter(
        15,
        "nextRevision",
        ParameterTypeV1::Int8,
        false,
        ParameterEncodingV1::Integer,
        INT8_CAST,
    ),
    parameter(
        16,
        "expectedRevision",
        ParameterTypeV1::Int8,
        true,
        ParameterEncodingV1::Integer,
        INT8_CAST,
    ),
    parameter(
        17,
        "expectedHeadDigest",
        ParameterTypeV1::Text,
        true,
        ParameterEncodingV1::Digest,
        TEXT_CAST,
    ),
    parameter(
        18,
        "previousRecordDigest",
        ParameterTypeV1::Text,
        true,
        ParameterEncodingV1::Digest,
        TEXT_CAST,
    ),
    parameter(
        19,
        "attemptIds",
        ParameterTypeV1::TextArray,
        false,
        ParameterEncodingV1::IdentifierArray,
        TEXT_ARRAY_CAST,
    ),
    parameter(
        20,
        "currentAttemptId",
        ParameterTypeV1::Text,
        false,
        ParameterEncodingV1::Identifier,
        TEXT_CAST,
    ),
    parameter(
        21,
        "state",
        ParameterTypeV1::Text,
        false,
        ParameterEncodingV1::State,
        TEXT_CAST,
    ),
    parameter(
        22,
        "completionEvidenceDigest",
        ParameterTypeV1::Text,
        true,
        ParameterEncodingV1::Digest,
        TEXT_CAST,
    ),
    parameter(
        23,
        "knownNotDispatchedEvidenceDigest",
        ParameterTypeV1::Text,
        true,
        ParameterEncodingV1::Digest,
        TEXT_CAST,
    ),
    parameter(
        24,
        "reconciliationEvidenceDigest",
        ParameterTypeV1::Text,
        true,
        ParameterEncodingV1::Digest,
        TEXT_CAST,
    ),
    parameter(
        25,
        "hostEvidenceAuthenticated",
        ParameterTypeV1::Boolean,
        false,
        ParameterEncodingV1::FixedFalse,
        BOOL_CAST,
    ),
    parameter(
        26,
        "persistenceAuthorityGranted",
        ParameterTypeV1::Boolean,
        false,
        ParameterEncodingV1::FixedFalse,
        BOOL_CAST,
    ),
    parameter(
        27,
        "dispatchAuthorityGranted",
        ParameterTypeV1::Boolean,
        false,
        ParameterEncodingV1::FixedFalse,
        BOOL_CAST,
    ),
];

#[cfg(test)]
pub(super) fn recompute_parameter_schema_digest_for_test() -> String {
    let manifest = serde_json::Value::Array(
        PARAMETER_SCHEMA
            .iter()
            .map(|spec| {
                serde_json::json!({
                    "position": spec.position,
                    "name": spec.name,
                    "pgType": match spec.parameter_type {
                        ParameterTypeV1::Text => "text",
                        ParameterTypeV1::Int8 => "bigint",
                        ParameterTypeV1::Int4 => "integer",
                        ParameterTypeV1::TextArray => "text[]",
                        ParameterTypeV1::Boolean => "boolean",
                    },
                    "nullable": spec.nullable,
                    "encoding": match spec.encoding {
                        ParameterEncodingV1::Digest => "sha256-base64url",
                        ParameterEncodingV1::StandardBase64 => "standard-base64",
                        ParameterEncodingV1::Identifier => "identifier",
                        ParameterEncodingV1::Integer => "integer",
                        ParameterEncodingV1::CanonicalUtcMillis => "rfc3339-millis",
                        ParameterEncodingV1::IdentifierArray => "identifier-array",
                        ParameterEncodingV1::State => "state",
                        ParameterEncodingV1::FixedFalse => "fixed-false",
                    }
                })
            })
            .collect(),
    );
    digest_canonical_manifest_for_test(&manifest)
}

fn valid_application_object_key(value: &str) -> bool {
    value.len() == 20
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"_-".contains(&byte))
}

fn has_valid_parameter_schema() -> bool {
    let expected_names = [
        "proposalDigest",
        "canonicalProposalBase64",
        "recordDigest",
        "canonicalRecordBase64",
        "automationId",
        "eventId",
        "operationId",
        "idempotencyKeyDigest",
        "causationId",
        "causationHop",
        "retentionHours",
        "createdAt",
        "expiresAt",
        "recordedAt",
        "nextRevision",
        "expectedRevision",
        "expectedHeadDigest",
        "previousRecordDigest",
        "attemptIds",
        "currentAttemptId",
        "state",
        "completionEvidenceDigest",
        "knownNotDispatchedEvidenceDigest",
        "reconciliationEvidenceDigest",
        "hostEvidenceAuthenticated",
        "persistenceAuthorityGranted",
        "dispatchAuthorityGranted",
    ];
    PARAMETER_SCHEMA.iter().enumerate().all(|(index, spec)| {
        Some(spec.position) == u8::try_from(index + 1).ok()
            && spec.name == expected_names[index]
            && spec.nullable == matches!(spec.position, 16 | 17 | 18 | 22 | 23 | 24)
            && !PARAMETER_SCHEMA[..index]
                .iter()
                .any(|previous| previous.name == spec.name)
            && match spec.parameter_type {
                ParameterTypeV1::Text => {
                    spec.sql_cast == TEXT_CAST
                        && matches!(
                            spec.encoding,
                            ParameterEncodingV1::Digest
                                | ParameterEncodingV1::StandardBase64
                                | ParameterEncodingV1::Identifier
                                | ParameterEncodingV1::CanonicalUtcMillis
                                | ParameterEncodingV1::State
                        )
                }
                ParameterTypeV1::Int8 => {
                    spec.sql_cast == INT8_CAST && spec.encoding == ParameterEncodingV1::Integer
                }
                ParameterTypeV1::Int4 => {
                    spec.sql_cast == INT4_CAST
                        && spec.encoding == ParameterEncodingV1::Integer
                        && !spec.nullable
                }
                ParameterTypeV1::TextArray => {
                    spec.sql_cast == TEXT_ARRAY_CAST
                        && spec.encoding == ParameterEncodingV1::IdentifierArray
                        && !spec.nullable
                }
                ParameterTypeV1::Boolean => {
                    spec.sql_cast == BOOL_CAST
                        && spec.encoding == ParameterEncodingV1::FixedFalse
                        && !spec.nullable
                }
            }
    })
}

pub(super) fn has_exact_placeholder_cast_contract(source: &str) -> bool {
    let bytes = source.as_bytes();
    let mut found = Vec::new();
    let mut offset = 0_usize;
    while offset < bytes.len() {
        if bytes[offset] != b'$'
            || bytes
                .get(offset + 1)
                .is_none_or(|byte| !byte.is_ascii_digit())
        {
            offset += 1;
            continue;
        }
        let start = offset;
        offset += 1;
        let digits_start = offset;
        while bytes.get(offset).is_some_and(u8::is_ascii_digit) {
            offset += 1;
        }
        let Ok(position) = source[digits_start..offset].parse::<usize>() else {
            return false;
        };
        let Some(spec) = position
            .checked_sub(1)
            .and_then(|index| PARAMETER_SCHEMA.get(index))
        else {
            return false;
        };
        let token = format!("${position}::{}", spec.sql_cast);
        if !source[start..].starts_with(&token) {
            return false;
        }
        found.push(position);
        offset = start + token.len();
    }
    found == (1..=PARAMETER_COUNT).collect::<Vec<_>>()
}

pub(super) fn validate_fixed_template() -> Result<(), ReconciliationErrorV1> {
    let source = SQL_TEMPLATE_SOURCE;
    let semicolons = source.matches(';').count();
    let required_fragments = [
        "WITH RECURSIVE",
        "'transaction_read_only') = 'on'",
        "'row_security') = 'off'",
        "'search_path') = 'pg_catalog'",
        "'statement_timeout'",
        "\"idempotency_revisions\"",
        "\"idempotency_heads\"",
        "AS \"observation\"",
    ];
    if source.len() != SQL_TEMPLATE_BYTE_LENGTH
        || source.len() > MAXIMUM_SQL_BYTES
        || <[u8; 32]>::from(Sha256::digest(source.as_bytes())) != SQL_TEMPLATE_SHA256
        || source.matches(SQL_SCHEMA_SENTINEL).count() != SQL_SCHEMA_SENTINEL_COUNT
        || source.matches("__OPENPENCIL_").count() != SQL_SCHEMA_SENTINEL_COUNT
        || !source.starts_with(
            "-- OpenPencil Supabase Backend Automation idempotency CAS reconciliation fixed read v1.\n",
        )
        || !source.ends_with("CROSS JOIN \"classification\";\n")
        || source.contains('\0')
        || source.contains('\\')
        || source.contains('`')
        || source.contains("${")
        || semicolons != 1
        || !has_valid_parameter_schema()
        || !has_exact_placeholder_cast_contract(source)
        || required_fragments
            .iter()
            .any(|fragment| !source.contains(fragment))
    {
        return Err(ReconciliationErrorV1::InvalidStaticStatement);
    }
    Ok(())
}

fn validate_parameters(parameters: &[BoundParameterV1]) -> Result<(), ReconciliationErrorV1> {
    if !has_valid_parameter_schema() || parameters.len() != PARAMETER_SCHEMA.len() {
        return Err(ReconciliationErrorV1::InvalidContract);
    }
    let mut aggregate_bytes = 0_usize;
    for (parameter, spec) in parameters.iter().zip(PARAMETER_SCHEMA) {
        if parameter.position != spec.position || parameter.name != spec.name {
            return Err(ReconciliationErrorV1::InvalidContract);
        }
        let bytes = validate_parameter_value(&parameter.value, spec)?;
        aggregate_bytes = aggregate_bytes
            .checked_add(bytes)
            .ok_or(ReconciliationErrorV1::InvalidContract)?;
        if aggregate_bytes > MAXIMUM_AGGREGATE_PARAMETER_BYTES {
            return Err(ReconciliationErrorV1::InvalidContract);
        }
    }
    validate_canonical_documents(parameters)
}

fn validate_parameter_value(
    value: &BoundParameterValueV1,
    spec: ParameterSpecV1,
) -> Result<usize, ReconciliationErrorV1> {
    match (spec.parameter_type, value) {
        (ParameterTypeV1::Text, BoundParameterValueV1::Text(value)) => {
            let Some(value) = value.as_deref() else {
                return if spec.nullable {
                    Ok(0)
                } else {
                    Err(ReconciliationErrorV1::InvalidContract)
                };
            };
            if value.is_empty()
                || value.len() > MAXIMUM_PARAMETER_STRING_BYTES
                || value.chars().any(char::is_control)
            {
                return Err(ReconciliationErrorV1::InvalidContract);
            }
            let valid = match spec.encoding {
                ParameterEncodingV1::Digest => valid_digest(value),
                ParameterEncodingV1::StandardBase64 => valid_canonical_document_base64(value),
                ParameterEncodingV1::Identifier => valid_identifier(value),
                ParameterEncodingV1::CanonicalUtcMillis => is_canonical_timestamp_millis(value),
                ParameterEncodingV1::State => valid_state(value),
                _ => false,
            };
            if !valid {
                return Err(ReconciliationErrorV1::InvalidContract);
            }
            Ok(value.len())
        }
        (ParameterTypeV1::Int8, BoundParameterValueV1::Int8(value)) => {
            if value.is_none() && !spec.nullable {
                return Err(ReconciliationErrorV1::InvalidContract);
            }
            Ok(value.map_or(0, |number| number.to_string().len()))
        }
        (ParameterTypeV1::Int4, BoundParameterValueV1::Int4(value)) if !spec.nullable => {
            Ok(value.to_string().len())
        }
        (ParameterTypeV1::TextArray, BoundParameterValueV1::TextArray(values)) => {
            if spec.nullable
                || values.is_empty()
                || values.len() > MAXIMUM_ATTEMPTS
                || values.iter().any(|value| !valid_identifier(value))
                || values
                    .iter()
                    .enumerate()
                    .any(|(index, value)| values[..index].contains(value))
            {
                return Err(ReconciliationErrorV1::InvalidContract);
            }
            Ok(values.iter().map(String::len).sum())
        }
        (ParameterTypeV1::Boolean, BoundParameterValueV1::Boolean(value))
            if !spec.nullable && !*value =>
        {
            Ok(1)
        }
        _ => Err(ReconciliationErrorV1::InvalidContract),
    }
}

fn valid_identifier(value: &str) -> bool {
    (1..=MAXIMUM_IDENTIFIER_BYTES).contains(&value.len())
        && value
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._:/@-".contains(&byte))
        && !contains_secret_like_material(value)
}

fn valid_digest(value: &str) -> bool {
    value.len() == 43
        && URL_SAFE_NO_PAD
            .decode(value)
            .is_ok_and(|bytes| bytes.len() == 32 && URL_SAFE_NO_PAD.encode(&bytes) == value)
}

fn valid_canonical_document_base64(value: &str) -> bool {
    STANDARD.decode(value).is_ok_and(|bytes| {
        (2..=MAXIMUM_CANONICAL_DOCUMENT_BYTES).contains(&bytes.len())
            && STANDARD.encode(&bytes) == value
            && std::str::from_utf8(&bytes).is_ok()
    })
}

fn valid_state(value: &str) -> bool {
    matches!(
        value,
        "reserved" | "dispatch-started" | "outcome-unknown" | "succeeded" | "known-not-dispatched"
    )
}

fn parse_timestamp_millis(value: &str) -> Option<i64> {
    let bytes = value.as_bytes();
    if bytes.len() != 24
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
        || bytes[19] != b'.'
        || bytes[23] != b'Z'
        || bytes.iter().enumerate().any(|(index, byte)| {
            !matches!(index, 4 | 7 | 10 | 13 | 16 | 19 | 23) && !byte.is_ascii_digit()
        })
    {
        return None;
    }
    let number = |range: std::ops::Range<usize>| -> Option<u32> {
        std::str::from_utf8(&bytes[range]).ok()?.parse().ok()
    };
    let year = number(0..4)?;
    let month = number(5..7)?;
    let day = number(8..10)?;
    let hour = number(11..13)?;
    let minute = number(14..16)?;
    let second = number(17..19)?;
    let millis = number(20..23)?;
    if year == 0 || !(1..=12).contains(&month) || hour >= 24 || minute >= 60 || second >= 60 {
        return None;
    }
    let leap = year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
    let maximum_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return None,
    };
    if !(1..=maximum_day).contains(&day) {
        return None;
    }
    let year = i64::from(year);
    let month = i64::from(month);
    let day = i64::from(day);
    let adjusted_year = year - i64::from(month <= 2);
    let era = adjusted_year.div_euclid(400);
    let year_of_era = adjusted_year - era * 400;
    let adjusted_month = month + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * adjusted_month + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    let days_since_epoch = era * 146_097 + day_of_era - 719_468;
    Some(
        days_since_epoch * 86_400_000
            + i64::from(hour) * 3_600_000
            + i64::from(minute) * 60_000
            + i64::from(second) * 1_000
            + i64::from(millis),
    )
}

fn is_canonical_timestamp_millis(value: &str) -> bool {
    parse_timestamp_millis(value).is_some()
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct CanonicalProposalV1 {
    #[serde(rename = "automationId")]
    pub(super) automation_id: String,
    #[serde(rename = "dispatchAuthorityGranted")]
    pub(super) dispatch_authority_granted: bool,
    #[serde(rename = "eventId")]
    pub(super) event_id: String,
    #[serde(rename = "expectedHeadDigest")]
    pub(super) expected_head_digest: Option<String>,
    #[serde(rename = "expectedRevision")]
    pub(super) expected_revision: Option<i64>,
    pub(super) format: String,
    #[serde(rename = "hostEvidenceAuthenticated")]
    pub(super) host_evidence_authenticated: bool,
    #[serde(rename = "idempotencyKeyDigest")]
    pub(super) idempotency_key_digest: String,
    #[serde(rename = "nextRecordDigest")]
    pub(super) next_record_digest: String,
    #[serde(rename = "nextRevision")]
    pub(super) next_revision: i64,
    #[serde(rename = "operationId")]
    pub(super) operation_id: String,
    #[serde(rename = "persistenceAuthorityGranted")]
    pub(super) persistence_authority_granted: bool,
    pub(super) version: u8,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct CanonicalRecordV1 {
    #[serde(rename = "attemptIds")]
    pub(super) attempt_ids: Vec<String>,
    #[serde(rename = "automationId")]
    pub(super) automation_id: String,
    #[serde(rename = "causationHop")]
    pub(super) causation_hop: i32,
    #[serde(rename = "causationId")]
    pub(super) causation_id: String,
    #[serde(rename = "completionEvidenceDigest")]
    pub(super) completion_evidence_digest: Option<String>,
    #[serde(rename = "createdAt")]
    pub(super) created_at: String,
    #[serde(rename = "currentAttemptId")]
    pub(super) current_attempt_id: String,
    #[serde(rename = "dispatchAuthorityGranted")]
    pub(super) dispatch_authority_granted: bool,
    #[serde(rename = "eventId")]
    pub(super) event_id: String,
    #[serde(rename = "expiresAt")]
    pub(super) expires_at: String,
    pub(super) format: String,
    #[serde(rename = "hostEvidenceAuthenticated")]
    pub(super) host_evidence_authenticated: bool,
    #[serde(rename = "idempotencyKeyDigest")]
    pub(super) idempotency_key_digest: String,
    #[serde(rename = "knownNotDispatchedEvidenceDigest")]
    pub(super) known_not_dispatched_evidence_digest: Option<String>,
    #[serde(rename = "operationId")]
    pub(super) operation_id: String,
    #[serde(rename = "persistenceAuthorityGranted")]
    pub(super) persistence_authority_granted: bool,
    #[serde(rename = "previousRecordDigest")]
    pub(super) previous_record_digest: Option<String>,
    #[serde(rename = "reconciliationEvidenceDigest")]
    pub(super) reconciliation_evidence_digest: Option<String>,
    #[serde(rename = "recordedAt")]
    pub(super) recorded_at: String,
    #[serde(rename = "retentionHours")]
    pub(super) retention_hours: i32,
    pub(super) revision: i64,
    pub(super) state: String,
    pub(super) version: u8,
}

fn decode_canonical<T>(encoded: &str) -> Result<(T, Vec<u8>), ReconciliationErrorV1>
where
    T: DeserializeOwned + Serialize,
{
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| ReconciliationErrorV1::InvalidContract)?;
    if !(2..=MAXIMUM_CANONICAL_DOCUMENT_BYTES).contains(&bytes.len())
        || STANDARD.encode(&bytes) != encoded
    {
        return Err(ReconciliationErrorV1::InvalidContract);
    }
    let value: T =
        serde_json::from_slice(&bytes).map_err(|_| ReconciliationErrorV1::InvalidContract)?;
    let canonical =
        serde_json::to_vec(&value).map_err(|_| ReconciliationErrorV1::InvalidContract)?;
    if canonical != bytes {
        return Err(ReconciliationErrorV1::InvalidContract);
    }
    Ok((value, bytes))
}

fn validate_canonical_documents(
    parameters: &[BoundParameterV1],
) -> Result<(), ReconciliationErrorV1> {
    let proposal_digest = required_text(parameters, 1)?;
    let (proposal, proposal_bytes): (CanonicalProposalV1, Vec<u8>) =
        decode_canonical(required_text(parameters, 2)?)?;
    let record_digest = required_text(parameters, 3)?;
    let (record, record_bytes): (CanonicalRecordV1, Vec<u8>) =
        decode_canonical(required_text(parameters, 4)?)?;
    if digest_base64url(&proposal_bytes) != proposal_digest
        || digest_base64url(&record_bytes) != record_digest
        || !valid_proposal(&proposal)
        || !valid_record(&record)
        || proposal.next_record_digest != record_digest
        || proposal.automation_id != record.automation_id
        || proposal.event_id != record.event_id
        || proposal.operation_id != record.operation_id
        || proposal.idempotency_key_digest != record.idempotency_key_digest
        || proposal.next_revision != record.revision
        || proposal.expected_head_digest != record.previous_record_digest
        || proposal.automation_id != required_text(parameters, 5)?
        || proposal.event_id != required_text(parameters, 6)?
        || proposal.operation_id != required_text(parameters, 7)?
        || proposal.idempotency_key_digest != required_text(parameters, 8)?
        || record.causation_id != required_text(parameters, 9)?
        || record.causation_hop != int4(parameters, 10)?
        || record.retention_hours != int4(parameters, 11)?
        || record.created_at != required_text(parameters, 12)?
        || record.expires_at != required_text(parameters, 13)?
        || record.recorded_at != required_text(parameters, 14)?
        || record.revision != required_int8(parameters, 15)?
        || proposal.expected_revision != int8(parameters, 16)?
        || proposal.expected_head_digest.as_deref() != text(parameters, 17)?
        || record.previous_record_digest.as_deref() != text(parameters, 18)?
        || record.attempt_ids != text_array(parameters, 19)?
        || record.current_attempt_id != required_text(parameters, 20)?
        || record.state != required_text(parameters, 21)?
        || record.completion_evidence_digest.as_deref() != text(parameters, 22)?
        || record.known_not_dispatched_evidence_digest.as_deref() != text(parameters, 23)?
        || record.reconciliation_evidence_digest.as_deref() != text(parameters, 24)?
        || proposal.host_evidence_authenticated != boolean(parameters, 25)?
        || proposal.persistence_authority_granted != boolean(parameters, 26)?
        || proposal.dispatch_authority_granted != boolean(parameters, 27)?
        || record.host_evidence_authenticated != proposal.host_evidence_authenticated
        || record.persistence_authority_granted != proposal.persistence_authority_granted
        || record.dispatch_authority_granted != proposal.dispatch_authority_granted
    {
        return Err(ReconciliationErrorV1::InvalidContract);
    }
    Ok(())
}

fn valid_proposal(proposal: &CanonicalProposalV1) -> bool {
    proposal.format == PROPOSAL_FORMAT
        && proposal.version == 1
        && valid_identifier(&proposal.automation_id)
        && valid_identifier(&proposal.event_id)
        && valid_identifier(&proposal.operation_id)
        && valid_digest(&proposal.idempotency_key_digest)
        && valid_digest(&proposal.next_record_digest)
        && proposal
            .expected_head_digest
            .as_deref()
            .is_none_or(valid_digest)
        && (proposal.expected_revision.is_none() == proposal.expected_head_digest.is_none())
        && proposal
            .expected_revision
            .is_none_or(|value| (0..MAXIMUM_REVISION).contains(&value))
        && proposal.next_revision
            == proposal
                .expected_revision
                .map_or(0, |expected| expected + 1)
        && !proposal.host_evidence_authenticated
        && !proposal.persistence_authority_granted
        && !proposal.dispatch_authority_granted
}

fn valid_record(record: &CanonicalRecordV1) -> bool {
    let Some(created_at) = parse_timestamp_millis(&record.created_at) else {
        return false;
    };
    let Some(expires_at) = parse_timestamp_millis(&record.expires_at) else {
        return false;
    };
    let Some(recorded_at) = parse_timestamp_millis(&record.recorded_at) else {
        return false;
    };
    let evidence_valid = match record.state.as_str() {
        "reserved" | "dispatch-started" | "outcome-unknown" => {
            record.completion_evidence_digest.is_none()
                && record.known_not_dispatched_evidence_digest.is_none()
                && record.reconciliation_evidence_digest.is_none()
        }
        "succeeded" => {
            record.completion_evidence_digest.is_some()
                && record.known_not_dispatched_evidence_digest.is_none()
        }
        "known-not-dispatched" => {
            record.completion_evidence_digest.is_none()
                && record.known_not_dispatched_evidence_digest.is_some()
        }
        _ => false,
    };
    record.format == RECORD_FORMAT
        && record.version == 1
        && valid_identifier(&record.automation_id)
        && valid_identifier(&record.event_id)
        && valid_identifier(&record.operation_id)
        && valid_digest(&record.idempotency_key_digest)
        && valid_identifier(&record.causation_id)
        && (0..=MAXIMUM_CAUSATION_HOP).contains(&record.causation_hop)
        && (1..=MAXIMUM_RETENTION_HOURS).contains(&record.retention_hours)
        && (0..=MAXIMUM_REVISION).contains(&record.revision)
        && (record.revision == 0) == record.previous_record_digest.is_none()
        && record
            .previous_record_digest
            .as_deref()
            .is_none_or(valid_digest)
        && (1..=MAXIMUM_ATTEMPTS).contains(&record.attempt_ids.len())
        && record
            .attempt_ids
            .iter()
            .all(|value| valid_identifier(value))
        && !record
            .attempt_ids
            .iter()
            .enumerate()
            .any(|(index, value)| record.attempt_ids[..index].contains(value))
        && record.attempt_ids.len() <= usize::try_from(record.revision + 1).unwrap_or(0)
        && record.attempt_ids.last() == Some(&record.current_attempt_id)
        && valid_identifier(&record.current_attempt_id)
        && record
            .completion_evidence_digest
            .as_deref()
            .is_none_or(valid_digest)
        && record
            .known_not_dispatched_evidence_digest
            .as_deref()
            .is_none_or(valid_digest)
        && record
            .reconciliation_evidence_digest
            .as_deref()
            .is_none_or(valid_digest)
        && evidence_valid
        && expires_at == created_at + i64::from(record.retention_hours) * 3_600_000
        && recorded_at >= created_at
        && (record.revision != 0
            || (record.state == "reserved"
                && record.attempt_ids.len() == 1
                && recorded_at == created_at))
        && !record.host_evidence_authenticated
        && !record.persistence_authority_granted
        && !record.dispatch_authority_granted
}

pub(super) fn digest_base64url(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(bytes))
}

#[cfg(test)]
fn digest_canonical_manifest_for_test(value: &serde_json::Value) -> String {
    fn write(value: &serde_json::Value, output: &mut String) {
        match value {
            serde_json::Value::Null => output.push_str("null"),
            serde_json::Value::Bool(value) => {
                output.push_str(if *value { "true" } else { "false" });
            }
            serde_json::Value::Number(value) => output.push_str(&value.to_string()),
            serde_json::Value::String(value) => {
                output.push_str(&serde_json::to_string(value).expect("JSON string"));
            }
            serde_json::Value::Array(values) => {
                output.push('[');
                for (index, value) in values.iter().enumerate() {
                    if index > 0 {
                        output.push(',');
                    }
                    write(value, output);
                }
                output.push(']');
            }
            serde_json::Value::Object(values) => {
                output.push('{');
                let mut entries = values.iter().collect::<Vec<_>>();
                entries.sort_unstable_by(|(left, _), (right, _)| left.cmp(right));
                for (index, (key, value)) in entries.into_iter().enumerate() {
                    if index > 0 {
                        output.push(',');
                    }
                    output.push_str(&serde_json::to_string(key).expect("JSON object key"));
                    output.push(':');
                    write(value, output);
                }
                output.push('}');
            }
        }
    }

    let mut canonical = String::new();
    write(value, &mut canonical);
    digest_base64url(canonical.as_bytes())
}

fn text(
    parameters: &[BoundParameterV1],
    position: usize,
) -> Result<Option<&str>, ReconciliationErrorV1> {
    match &parameters[position - 1].value {
        BoundParameterValueV1::Text(value) => Ok(value.as_deref()),
        _ => Err(ReconciliationErrorV1::InvalidContract),
    }
}

fn required_text(
    parameters: &[BoundParameterV1],
    position: usize,
) -> Result<&str, ReconciliationErrorV1> {
    text(parameters, position)?.ok_or(ReconciliationErrorV1::InvalidContract)
}

fn int8(
    parameters: &[BoundParameterV1],
    position: usize,
) -> Result<Option<i64>, ReconciliationErrorV1> {
    match parameters[position - 1].value {
        BoundParameterValueV1::Int8(value) => Ok(value),
        _ => Err(ReconciliationErrorV1::InvalidContract),
    }
}

fn required_int8(
    parameters: &[BoundParameterV1],
    position: usize,
) -> Result<i64, ReconciliationErrorV1> {
    int8(parameters, position)?.ok_or(ReconciliationErrorV1::InvalidContract)
}

fn int4(parameters: &[BoundParameterV1], position: usize) -> Result<i32, ReconciliationErrorV1> {
    match parameters[position - 1].value {
        BoundParameterValueV1::Int4(value) => Ok(value),
        _ => Err(ReconciliationErrorV1::InvalidContract),
    }
}

fn text_array(
    parameters: &[BoundParameterV1],
    position: usize,
) -> Result<&[String], ReconciliationErrorV1> {
    match &parameters[position - 1].value {
        BoundParameterValueV1::TextArray(value) => Ok(value),
        _ => Err(ReconciliationErrorV1::InvalidContract),
    }
}

fn boolean(
    parameters: &[BoundParameterV1],
    position: usize,
) -> Result<bool, ReconciliationErrorV1> {
    match parameters[position - 1].value {
        BoundParameterValueV1::Boolean(value) => Ok(value),
        _ => Err(ReconciliationErrorV1::InvalidContract),
    }
}

/// Runner-owned response collector. A production adapter must inspect protocol-declared lengths
/// before allocating and then feed each field incrementally through this sink. It must never build
/// an unbounded row, column, or JSON buffer on the side and hand it to the runner afterwards.
pub(super) struct BoundedObservationSinkV1 {
    poisoned: bool,
    row_started: bool,
    column_started: bool,
    column_finished: bool,
    row_finished: bool,
    response_finished: bool,
    expected_value_byte_length: Option<usize>,
    observation: Vec<u8>,
}

impl BoundedObservationSinkV1 {
    fn new() -> Self {
        Self {
            poisoned: false,
            row_started: false,
            column_started: false,
            column_finished: false,
            row_finished: false,
            response_finished: false,
            expected_value_byte_length: None,
            observation: Vec::new(),
        }
    }

    pub(super) fn begin_row(&mut self) -> Result<(), DatabaseFailureV1> {
        if self.poisoned || self.row_started || self.row_finished || self.response_finished {
            return self.poison();
        }
        self.row_started = true;
        Ok(())
    }

    pub(super) fn begin_column(
        &mut self,
        name: &str,
        column_type: DatabaseColumnTypeV1,
        declared_nullable: bool,
        value_is_null: bool,
        protocol_value_byte_length: usize,
    ) -> Result<(), DatabaseFailureV1> {
        if self.poisoned
            || !self.row_started
            || self.column_started
            || self.column_finished
            || self.row_finished
            || self.response_finished
            || name != "observation"
            || column_type != DatabaseColumnTypeV1::Text
            || declared_nullable
            || value_is_null
            || protocol_value_byte_length == 0
            || protocol_value_byte_length > MAXIMUM_RESPONSE_BYTES
        {
            return self.poison();
        }
        if self
            .observation
            .try_reserve_exact(protocol_value_byte_length)
            .is_err()
        {
            return self.poison();
        }
        self.expected_value_byte_length = Some(protocol_value_byte_length);
        self.column_started = true;
        Ok(())
    }

    pub(super) fn push_value_chunk(&mut self, chunk: &[u8]) -> Result<(), DatabaseFailureV1> {
        if self.poisoned
            || !self.column_started
            || self.column_finished
            || self.response_finished
            || chunk.is_empty()
        {
            return self.poison();
        }
        let Some(next_length) = self.observation.len().checked_add(chunk.len()) else {
            return self.poison();
        };
        if next_length > MAXIMUM_RESPONSE_BYTES
            || self
                .expected_value_byte_length
                .is_none_or(|expected| next_length > expected)
        {
            return self.poison();
        }
        self.observation.extend_from_slice(chunk);
        Ok(())
    }

    pub(super) fn finish_column(&mut self) -> Result<(), DatabaseFailureV1> {
        if self.poisoned
            || !self.column_started
            || self.column_finished
            || self
                .expected_value_byte_length
                .is_none_or(|expected| self.observation.len() != expected)
        {
            return self.poison();
        }
        self.column_finished = true;
        Ok(())
    }

    pub(super) fn finish_row(&mut self) -> Result<(), DatabaseFailureV1> {
        if self.poisoned || !self.row_started || !self.column_finished || self.row_finished {
            return self.poison();
        }
        self.row_finished = true;
        Ok(())
    }

    pub(super) fn finish_response(&mut self) -> Result<(), DatabaseFailureV1> {
        if self.poisoned || !self.row_finished || self.response_finished {
            return self.poison();
        }
        self.response_finished = true;
        Ok(())
    }

    fn into_observation(self) -> Result<Vec<u8>, ReconciliationErrorV1> {
        if self.poisoned || !self.response_finished || self.observation.is_empty() {
            return Err(ReconciliationErrorV1::InvalidResponseShape);
        }
        Ok(self.observation)
    }

    fn poison<T>(&mut self) -> Result<T, DatabaseFailureV1> {
        self.poisoned = true;
        Err(DatabaseFailureV1::ResponseLimitExceeded)
    }
}

pub(super) trait DatabaseSessionV1: Send {
    type PreparedStatement: Send;

    fn begin_read_only<'a>(
        &'a mut self,
        control: StageControlV1<'a>,
    ) -> impl Future<Output = Result<(), DatabaseFailureV1>> + Send + 'a;
    fn set_local_search_path_pg_catalog<'a>(
        &'a mut self,
        control: StageControlV1<'a>,
    ) -> impl Future<Output = Result<(), DatabaseFailureV1>> + Send + 'a;
    fn set_local_row_security_off<'a>(
        &'a mut self,
        control: StageControlV1<'a>,
    ) -> impl Future<Output = Result<(), DatabaseFailureV1>> + Send + 'a;
    fn set_local_statement_timeout_ms<'a>(
        &'a mut self,
        milliseconds: u32,
        control: StageControlV1<'a>,
    ) -> impl Future<Output = Result<(), DatabaseFailureV1>> + Send + 'a;
    fn prepare_fixed_statement<'a>(
        &'a mut self,
        statement: &'a FixedStatementArtifactV1,
        control: StageControlV1<'a>,
    ) -> impl Future<Output = Result<Self::PreparedStatement, DatabaseFailureV1>> + Send + 'a;
    /// The adapter must enforce `limits` while decoding the database protocol. It must reject an
    /// excess row, column, or declared field length before allocation and stream accepted field
    /// bytes through `response`; returning `Ok` without a complete sink is an invalid response.
    fn execute_prepared<'a>(
        &'a mut self,
        statement: Self::PreparedStatement,
        parameters: &'a [BoundParameterV1],
        limits: ReadLimitsV1,
        response: &'a mut BoundedObservationSinkV1,
        control: StageControlV1<'a>,
    ) -> impl Future<Output = Result<(), DatabaseFailureV1>> + Send + 'a;
    fn finish_read_only<'a>(
        &'a mut self,
        control: StageControlV1<'a>,
    ) -> impl Future<Output = Result<(), DatabaseFailureV1>> + Send + 'a;

    /// Local, idempotent, nonblocking, and cancellation-safe after any stage future is dropped.
    fn abort_read_only(&mut self);
    /// Local, idempotent, and nonblocking. It is used only while a stage future may remain pending.
    /// The adapter must make this a no-op unless that future actually placed a wire request in
    /// flight; in particular, cancellation before the future's first poll must never target an
    /// earlier request or a subsequently reused connection.
    fn cancel_database_request(&mut self);
}

pub(super) trait InterruptSourceV1: Sync {
    fn now(&self) -> Duration;
    fn is_cancelled(&self) -> bool;
    fn register_waker(&self, deadline: Duration, waker: &Waker);
}

#[derive(Clone, Copy)]
pub(super) struct StageControlV1<'a> {
    deadline: Duration,
    interrupts: &'a dyn InterruptSourceV1,
}

impl StageControlV1<'_> {
    fn current_interruption(&self) -> Option<DatabaseFailureV1> {
        if self.interrupts.is_cancelled() {
            Some(DatabaseFailureV1::Cancelled)
        } else if self.interrupts.now() >= self.deadline {
            Some(DatabaseFailureV1::TimedOut)
        } else {
            None
        }
    }
}

pub(super) struct ExecutionControlV1<'a> {
    stage: StageControlV1<'a>,
}

impl<'a> ExecutionControlV1<'a> {
    #[cfg(test)]
    pub(super) fn start_for_test(
        interrupts: &'a dyn InterruptSourceV1,
    ) -> Result<Self, ReconciliationErrorV1> {
        let deadline = interrupts
            .now()
            .checked_add(OVERALL_TIMEOUT)
            .ok_or(ReconciliationErrorV1::InvalidContract)?;
        Ok(Self {
            stage: StageControlV1 {
                deadline,
                interrupts,
            },
        })
    }
}

async fn race_stage<T>(
    future: impl Future<Output = T>,
    control: StageControlV1<'_>,
) -> Result<T, DatabaseFailureV1> {
    let mut future = pin!(future);
    poll_fn(|context| {
        if let Some(interruption) = control.current_interruption() {
            return Poll::Ready(Err(interruption));
        }
        control
            .interrupts
            .register_waker(control.deadline, context.waker());
        if let Some(interruption) = control.current_interruption() {
            return Poll::Ready(Err(interruption));
        }
        match future.as_mut().poll(context) {
            // Do not perform a post-Ready interruption check. Ready is the definitive boundary at
            // which the caller must synchronously switch from CancelThenAbort to AbortOnly.
            Poll::Ready(value) => Poll::Ready(Ok(value)),
            Poll::Pending => control
                .current_interruption()
                .map_or(Poll::Pending, |failure| Poll::Ready(Err(failure))),
        }
    })
    .await
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ReconciliationErrorV1 {
    InvalidStaticStatement,
    InvalidApplicationObjectKey,
    InvalidContract,
    InvalidReviewBinding,
    AlreadyConsumed,
    Cancelled,
    Database {
        stage: ReadStageV1,
        failure: DatabaseFailureV1,
    },
    InvalidResponseShape,
    InvalidResponseUtf8,
    InvalidResponseJson,
    InvalidResponse,
    ResponseBindingMismatch,
    ResponseStatusMismatch,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(super) enum ReconciliationStatusV1 {
    Absent,
    ExactReplay,
    AdvancedHead,
    CasConflict,
    Corruption,
    PreconditionFailed,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawObservationV1 {
    query_version: String,
    proposal_digest: String,
    record_digest: String,
    reported_status: ReconciliationStatusV1,
    input_valid: bool,
    runtime_ready: bool,
    full_ledger_shape_verified: bool,
    head_count: u16,
    head_revision: Option<i64>,
    revision_count: u16,
    revision_minimum: Option<i64>,
    revision_maximum: Option<i64>,
    exact_initial_revision_count: u16,
    exact_predecessor_link_count: u16,
    exact_head_tip_count: u16,
    candidate_count: u16,
    candidate_digest_match_count: u16,
    candidate_exact_count: u16,
    expected_head_match_count: u16,
    transaction_read_only: bool,
    database_primary: bool,
    session_replication_role_origin: bool,
    schema_marker_digest: Option<String>,
    server_version_num: String,
    snapshot_digest: String,
    observed_at: String,
}

const RESPONSE_FIELDS: [&str; 26] = [
    "queryVersion",
    "proposalDigest",
    "recordDigest",
    "reportedStatus",
    "inputValid",
    "runtimeReady",
    "fullLedgerShapeVerified",
    "headCount",
    "headRevision",
    "revisionCount",
    "revisionMinimum",
    "revisionMaximum",
    "exactInitialRevisionCount",
    "exactPredecessorLinkCount",
    "exactHeadTipCount",
    "candidateCount",
    "candidateDigestMatchCount",
    "candidateExactCount",
    "expectedHeadMatchCount",
    "transactionReadOnly",
    "databasePrimary",
    "sessionReplicationRoleOrigin",
    "schemaMarkerDigest",
    "serverVersionNum",
    "snapshotDigest",
    "observedAt",
];

#[cfg(test)]
pub(super) fn recompute_reconciliation_query_digest_for_test() -> String {
    let manifest = serde_json::json!({
        "format": "openpencil.supabase-automation-idempotency-cas-reconciliation-query.v1",
        "version": 1,
        "queryId": QUERY_ID,
        "queryVersion": QUERY_VERSION,
        "sqlTemplateDigest": digest_base64url(SQL_TEMPLATE_SOURCE.as_bytes()),
        "parameterSchemaDigest": recompute_parameter_schema_digest_for_test(),
        "responseColumn": {
            "name": "observation",
            "pgType": "text",
            "nullable": false
        },
        "responseFields": RESPONSE_FIELDS,
        "responseMaximumBytes": MAXIMUM_RESPONSE_BYTES
    });
    digest_canonical_manifest_for_test(&manifest)
}

fn skip_json_whitespace(bytes: &[u8], mut index: usize) -> usize {
    while bytes
        .get(index)
        .is_some_and(|byte| matches!(byte, b' ' | b'\n' | b'\r' | b'\t'))
    {
        index += 1;
    }
    index
}

fn parse_json_string(text: &str, start: usize) -> Result<(String, usize), ReconciliationErrorV1> {
    let bytes = text.as_bytes();
    if bytes.get(start) != Some(&b'"') {
        return Err(ReconciliationErrorV1::InvalidResponseJson);
    }
    let mut index = start + 1;
    while let Some(byte) = bytes.get(index).copied() {
        match byte {
            b'"' => {
                let end = index + 1;
                let value = serde_json::from_str::<String>(&text[start..end])
                    .map_err(|_| ReconciliationErrorV1::InvalidResponseJson)?;
                return Ok((value, end));
            }
            b'\\' => {
                index += 1;
                match bytes.get(index).copied() {
                    Some(b'"' | b'\\' | b'/' | b'b' | b'f' | b'n' | b'r' | b't') => {}
                    Some(b'u') => {
                        for offset in 1..=4 {
                            if bytes
                                .get(index + offset)
                                .is_none_or(|value| !value.is_ascii_hexdigit())
                            {
                                return Err(ReconciliationErrorV1::InvalidResponseJson);
                            }
                        }
                        index += 4;
                    }
                    _ => return Err(ReconciliationErrorV1::InvalidResponseJson),
                }
            }
            0x00..=0x1f => return Err(ReconciliationErrorV1::InvalidResponseJson),
            _ => {}
        }
        index += 1;
    }
    Err(ReconciliationErrorV1::InvalidResponseJson)
}

fn parse_json_primitive_end(text: &str, start: usize) -> Result<usize, ReconciliationErrorV1> {
    let bytes = text.as_bytes();
    if bytes.get(start) == Some(&b'"') {
        return parse_json_string(text, start).map(|(_, end)| end);
    }
    for literal in [b"true".as_slice(), b"false".as_slice(), b"null".as_slice()] {
        if bytes.get(start..start + literal.len()) == Some(literal) {
            return Ok(start + literal.len());
        }
    }
    let mut index = start;
    let negative = bytes.get(index) == Some(&b'-');
    if negative {
        index += 1;
    }
    let digits_start = index;
    match bytes.get(index).copied() {
        Some(b'0') => {
            index += 1;
            if negative || bytes.get(index).is_some_and(u8::is_ascii_digit) {
                return Err(ReconciliationErrorV1::InvalidResponseJson);
            }
        }
        Some(b'1'..=b'9') => {
            index += 1;
            while bytes.get(index).is_some_and(u8::is_ascii_digit) {
                index += 1;
            }
        }
        _ => return Err(ReconciliationErrorV1::InvalidResponseJson),
    }
    if digits_start == index
        || text[start..index].parse::<i64>().is_err()
        || bytes
            .get(index)
            .is_some_and(|byte| matches!(byte, b'.' | b'e' | b'E'))
    {
        return Err(ReconciliationErrorV1::InvalidResponseJson);
    }
    Ok(index)
}

fn require_exact_flat_json_fields(text: &str) -> Result<(), ReconciliationErrorV1> {
    let bytes = text.as_bytes();
    let mut index = skip_json_whitespace(bytes, 0);
    if bytes.get(index) != Some(&b'{') {
        return Err(ReconciliationErrorV1::InvalidResponseJson);
    }
    index = skip_json_whitespace(bytes, index + 1);
    let mut keys = Vec::with_capacity(RESPONSE_FIELDS.len());
    loop {
        if bytes.get(index) == Some(&b'}') {
            index += 1;
            break;
        }
        let (key, key_end) = parse_json_string(text, index)?;
        if keys.contains(&key) {
            return Err(ReconciliationErrorV1::InvalidResponseJson);
        }
        keys.push(key);
        index = skip_json_whitespace(bytes, key_end);
        if bytes.get(index) != Some(&b':') {
            return Err(ReconciliationErrorV1::InvalidResponseJson);
        }
        index = skip_json_whitespace(bytes, index + 1);
        index = parse_json_primitive_end(text, index)?;
        index = skip_json_whitespace(bytes, index);
        match bytes.get(index) {
            Some(b',') => index = skip_json_whitespace(bytes, index + 1),
            Some(b'}') => {
                index += 1;
                break;
            }
            _ => return Err(ReconciliationErrorV1::InvalidResponseJson),
        }
    }
    if skip_json_whitespace(bytes, index) != bytes.len()
        || keys.len() != RESPONSE_FIELDS.len()
        || keys
            .iter()
            .any(|key| !RESPONSE_FIELDS.contains(&key.as_str()))
    {
        return Err(ReconciliationErrorV1::InvalidResponseJson);
    }
    Ok(())
}

fn nullable_revision_in_range(value: Option<i64>) -> bool {
    value.is_none_or(|revision| (0..=MAXIMUM_REVISION).contains(&revision))
}

fn valid_server_version_num(value: &str) -> bool {
    value.len() == 6
        && matches!(&value.as_bytes()[..2], b"15" | b"16" | b"17")
        && value.bytes().all(|byte| byte.is_ascii_digit())
}

fn data_facts_are_empty(value: &RawObservationV1) -> bool {
    value.head_count == 0
        && value.head_revision.is_none()
        && value.revision_count == 0
        && value.revision_minimum.is_none()
        && value.revision_maximum.is_none()
        && value.exact_initial_revision_count == 0
        && value.exact_predecessor_link_count == 0
        && value.exact_head_tip_count == 0
        && value.candidate_count == 0
        && value.candidate_digest_match_count == 0
        && value.candidate_exact_count == 0
        && value.expected_head_match_count == 0
}

fn ledger_healthy(value: &RawObservationV1) -> bool {
    if value.head_count == 0 {
        return value.head_revision.is_none()
            && value.revision_count == 0
            && value.revision_minimum.is_none()
            && value.revision_maximum.is_none()
            && value.exact_initial_revision_count == 0
            && value.exact_predecessor_link_count == 0
            && value.exact_head_tip_count == 0;
    }
    let Some(head_revision) = value.head_revision else {
        return false;
    };
    value.head_count == 1
        && (0..=MAXIMUM_REVISION).contains(&head_revision)
        && i64::from(value.revision_count) == head_revision + 1
        && value.revision_minimum == Some(0)
        && value.revision_maximum == Some(head_revision)
        && value.exact_initial_revision_count == 1
        && i64::from(value.exact_predecessor_link_count) == head_revision
        && value.exact_head_tip_count == 1
}

fn recompute_status(
    value: &RawObservationV1,
    next_revision: i64,
    expected_revision: Option<i64>,
) -> ReconciliationStatusV1 {
    if !value.input_valid || !value.runtime_ready || !value.full_ledger_shape_verified {
        return ReconciliationStatusV1::PreconditionFailed;
    }
    if !ledger_healthy(value)
        || value.head_count == 2
        || value.revision_count == 1_026
        || value.exact_initial_revision_count == 2
        || value.exact_predecessor_link_count == 1_025
        || value.exact_head_tip_count == 2
        || value.candidate_count == 2
        || value.candidate_digest_match_count == 2
        || value.candidate_exact_count == 2
        || value.expected_head_match_count == 2
    {
        return ReconciliationStatusV1::Corruption;
    }
    if value.candidate_count == 1
        && value.candidate_digest_match_count == 1
        && value.candidate_exact_count == 0
    {
        return ReconciliationStatusV1::Corruption;
    }
    if value.candidate_count == 1 && value.candidate_digest_match_count == 0 {
        return ReconciliationStatusV1::CasConflict;
    }
    if value.candidate_count == 1
        && value.candidate_digest_match_count == 1
        && value.candidate_exact_count == 1
        && value.head_revision == Some(next_revision)
    {
        return ReconciliationStatusV1::ExactReplay;
    }
    if value.candidate_count == 1
        && value.candidate_digest_match_count == 1
        && value.candidate_exact_count == 1
        && value
            .head_revision
            .is_some_and(|head_revision| head_revision > next_revision)
    {
        return ReconciliationStatusV1::AdvancedHead;
    }
    if value.candidate_count == 0
        && value.head_count == 0
        && value.revision_count == 0
        && expected_revision.is_none()
        && next_revision == 0
    {
        return ReconciliationStatusV1::Absent;
    }
    if value.candidate_count == 0
        && value.head_count == 1
        && expected_revision.is_some()
        && value.head_revision == expected_revision
        && value.expected_head_match_count == 1
    {
        return ReconciliationStatusV1::Absent;
    }
    ReconciliationStatusV1::CasConflict
}

fn parse_observation(
    text: &str,
    parameters: &[BoundParameterV1],
    statement: &FixedStatementArtifactV1,
) -> Result<ReconciliationStatusV1, ReconciliationErrorV1> {
    require_exact_flat_json_fields(text)?;
    let value: RawObservationV1 =
        serde_json::from_str(text).map_err(|_| ReconciliationErrorV1::InvalidResponseJson)?;
    let next_revision = required_int8(parameters, 15)?;
    let expected_revision = int8(parameters, 16)?;
    let expected_marker = statement.schema_marker_digest();
    if value.query_version != QUERY_VERSION
        || !valid_digest(&value.proposal_digest)
        || !valid_digest(&value.record_digest)
        || value.proposal_digest != required_text(parameters, 1)?
        || value.record_digest != required_text(parameters, 3)?
        || value
            .schema_marker_digest
            .as_deref()
            .is_some_and(|digest| !valid_digest(digest))
        || (value.full_ledger_shape_verified
            && value.schema_marker_digest.as_deref() != Some(expected_marker.as_str()))
        || (!value.full_ledger_shape_verified && value.schema_marker_digest.is_some())
    {
        return Err(ReconciliationErrorV1::ResponseBindingMismatch);
    }
    if value.head_count > 2
        || !nullable_revision_in_range(value.head_revision)
        || value.revision_count > 1_026
        || !nullable_revision_in_range(value.revision_minimum)
        || !nullable_revision_in_range(value.revision_maximum)
        || value.exact_initial_revision_count > 2
        || value.exact_predecessor_link_count > 1_025
        || value.exact_head_tip_count > 2
        || value.candidate_count > 2
        || value.candidate_digest_match_count > 2
        || value.candidate_exact_count > 2
        || value.expected_head_match_count > 2
        || !valid_server_version_num(&value.server_version_num)
        || !valid_digest(&value.snapshot_digest)
        || parse_timestamp_millis(&value.observed_at).is_none()
    {
        return Err(ReconciliationErrorV1::InvalidResponse);
    }
    let revision_bounds_consistent = if value.revision_count == 0 {
        value.revision_minimum.is_none() && value.revision_maximum.is_none()
    } else {
        value
            .revision_minimum
            .zip(value.revision_maximum)
            .is_some_and(|(minimum, maximum)| minimum <= maximum)
    };
    if (value.head_count == 1) != value.head_revision.is_some()
        || !revision_bounds_consistent
        || value.exact_initial_revision_count > value.revision_count
        || value.exact_predecessor_link_count > value.revision_count.saturating_sub(1)
        || value.exact_head_tip_count > value.head_count
        || value.exact_head_tip_count > value.revision_count
        || value.candidate_digest_match_count > value.candidate_count
        || value.candidate_exact_count > value.candidate_digest_match_count
        || value.candidate_count > value.revision_count
        || value.expected_head_match_count > value.head_count
        || value.expected_head_match_count > value.revision_count
        || (expected_revision.is_none() && value.expected_head_match_count != 0)
        || (value.candidate_count > 0
            && (value.revision_minimum.is_none()
                || value.revision_maximum.is_none()
                || value
                    .revision_minimum
                    .is_some_and(|minimum| minimum > next_revision)
                || value
                    .revision_maximum
                    .is_some_and(|maximum| maximum < next_revision)))
        || (value.candidate_count > 0 && value.expected_head_match_count != 0)
        || (value.expected_head_match_count > 0
            && (expected_revision.is_none()
                || value.revision_minimum.is_none()
                || value.revision_maximum.is_none()
                || value
                    .revision_minimum
                    .zip(expected_revision)
                    .is_some_and(|(minimum, expected)| minimum > expected)
                || value
                    .revision_maximum
                    .zip(expected_revision)
                    .is_some_and(|(maximum, expected)| maximum < expected)))
        || (value.expected_head_match_count == 1 && value.head_revision != expected_revision)
        || (value.exact_initial_revision_count > 0 && value.revision_minimum != Some(0))
        || (value.runtime_ready
            && (!value.transaction_read_only
                || !value.database_primary
                || !value.session_replication_role_origin))
        || ((!value.input_valid || !value.runtime_ready || !value.full_ledger_shape_verified)
            && !data_facts_are_empty(&value))
    {
        return Err(ReconciliationErrorV1::InvalidResponse);
    }
    let status = recompute_status(&value, next_revision, expected_revision);
    if status != value.reported_status {
        return Err(ReconciliationErrorV1::ResponseStatusMismatch);
    }
    Ok(status)
}

#[derive(Debug, PartialEq, Eq)]
pub(super) struct ReconciliationResultV1 {
    pub(super) status: ReconciliationStatusV1,
    pub(super) observation_json: Vec<u8>,
    pub(super) response_byte_length: usize,
    pub(super) testing_only: bool,
    pub(super) specific_installation_authenticated: bool,
    pub(super) production_transport_authenticated: bool,
    pub(super) read_only_reconciliation_completed: bool,
    pub(super) commit_outcome_resolved: bool,
    pub(super) database_cas_committed: bool,
    pub(super) capture_consumed: bool,
    pub(super) operation_authority_authenticated: bool,
    pub(super) credential_authority_created: bool,
    pub(super) transport_authority_created: bool,
    pub(super) database_authority_created: bool,
    pub(super) mutation_authority_created: bool,
    pub(super) execution_authority_created: bool,
    pub(super) receipt_authority_created: bool,
    pub(super) release_authority_created: bool,
    pub(super) reconciliation_result_authenticated: bool,
    pub(super) automatic_retry_allowed: bool,
    pub(super) persistence_authority_granted: bool,
    pub(super) dispatch_authority_granted: bool,
    pub(super) receipt_v2_issued: bool,
    pub(super) release_authorized: bool,
    pub(super) release_ready: bool,
}

#[cfg(test)]
pub(super) struct TestingReviewBindingInputV1 {
    pub(super) review_format: String,
    pub(super) review_digest: String,
    pub(super) cas_review_digest: String,
    pub(super) query_id: String,
    pub(super) query_version: String,
    pub(super) application_object_key: String,
    pub(super) schema_name: String,
    pub(super) reconciliation_sql_template_digest: String,
    pub(super) reconciliation_sql_digest: String,
    pub(super) reconciliation_query_digest: String,
    pub(super) parameter_schema_digest: String,
    pub(super) parameter_values_digest: String,
    pub(super) proposal_digest: String,
    pub(super) record_digest: String,
    pub(super) schema_marker_digest: String,
    pub(super) response_column_name: String,
    pub(super) response_column_type: String,
    pub(super) response_column_nullable: bool,
    pub(super) response_field_count: usize,
    pub(super) response_maximum_bytes: usize,
    pub(super) statement_count: u8,
    pub(super) access_mode: String,
    pub(super) snapshot_scope: String,
    pub(super) testing_only: bool,
    pub(super) review_only: bool,
    pub(super) production_reachable: bool,
    pub(super) automatic_retry_allowed: bool,
}

/// Opaque identity proof standing in for the TypeScript WeakMap context in deterministic tests.
/// It is owned by the one-shot contract and cannot be constructed in production code.
struct TrustedTestingReviewBindingV1 {
    review_format: String,
    review_digest: String,
    cas_review_digest: String,
    query_id: String,
    query_version: String,
    reconciliation_sql_template_digest: String,
    reconciliation_sql_digest: String,
    reconciliation_query_digest: String,
    parameter_schema_digest: String,
    parameter_values_digest: String,
    proposal_digest: String,
    record_digest: String,
    schema_marker_digest: String,
    application_object_key: String,
}

impl TrustedTestingReviewBindingV1 {
    #[cfg(test)]
    fn checked_for_test(
        input: TestingReviewBindingInputV1,
        statement: &FixedStatementArtifactV1,
        parameters: &[BoundParameterV1],
    ) -> Result<Self, ReconciliationErrorV1> {
        let template_digest = digest_base64url(SQL_TEMPLATE_SOURCE.as_bytes());
        let rendered_digest = digest_base64url(statement.source().as_bytes());
        let proposal_digest = required_text(parameters, 1)?;
        let record_digest = required_text(parameters, 3)?;
        if input.review_format
            != "openpencil.supabase-automation-idempotency-cas-reconciliation-review.v1"
            || input.query_id != QUERY_ID
            || input.query_version != QUERY_VERSION
            || !valid_application_object_key(&input.application_object_key)
            || input.schema_name != statement.schema_name()
            || input.schema_name != format!("op_automation_{}", input.application_object_key)
            || input.reconciliation_sql_template_digest != template_digest
            || input.reconciliation_sql_digest != rendered_digest
            || input.reconciliation_query_digest != RECONCILIATION_QUERY_DIGEST
            || input.parameter_schema_digest != PARAMETER_SCHEMA_DIGEST
            || input.proposal_digest != proposal_digest
            || input.record_digest != record_digest
            || input.schema_marker_digest != statement.schema_marker_digest()
            || input.response_column_name != "observation"
            || input.response_column_type != "text"
            || input.response_column_nullable
            || input.response_field_count != RESPONSE_FIELDS.len()
            || input.response_maximum_bytes != MAXIMUM_RESPONSE_BYTES
            || input.statement_count != 1
            || input.access_mode != "read-only"
            || input.snapshot_scope != "single-statement"
            || !input.testing_only
            || !input.review_only
            || input.production_reachable
            || input.automatic_retry_allowed
            || [
                input.review_digest.as_str(),
                input.cas_review_digest.as_str(),
                input.reconciliation_query_digest.as_str(),
                input.parameter_schema_digest.as_str(),
                input.parameter_values_digest.as_str(),
            ]
            .iter()
            .any(|digest| !valid_digest(digest))
        {
            return Err(ReconciliationErrorV1::InvalidReviewBinding);
        }
        Ok(Self {
            review_format: input.review_format,
            review_digest: input.review_digest,
            cas_review_digest: input.cas_review_digest,
            query_id: input.query_id,
            query_version: input.query_version,
            reconciliation_sql_template_digest: input.reconciliation_sql_template_digest,
            reconciliation_sql_digest: input.reconciliation_sql_digest,
            reconciliation_query_digest: input.reconciliation_query_digest,
            parameter_schema_digest: input.parameter_schema_digest,
            parameter_values_digest: input.parameter_values_digest,
            proposal_digest: input.proposal_digest,
            record_digest: input.record_digest,
            schema_marker_digest: input.schema_marker_digest,
            application_object_key: input.application_object_key,
        })
    }

    fn validate(
        &self,
        statement: &FixedStatementArtifactV1,
        parameters: &[BoundParameterV1],
    ) -> Result<(), ReconciliationErrorV1> {
        if self.review_format
            != "openpencil.supabase-automation-idempotency-cas-reconciliation-review.v1"
            || self.query_id != QUERY_ID
            || self.query_version != QUERY_VERSION
            || self.reconciliation_sql_template_digest
                != digest_base64url(SQL_TEMPLATE_SOURCE.as_bytes())
            || self.reconciliation_sql_digest != digest_base64url(statement.source().as_bytes())
            || !valid_digest(&self.review_digest)
            || !valid_digest(&self.cas_review_digest)
            || self.reconciliation_query_digest != RECONCILIATION_QUERY_DIGEST
            || self.parameter_schema_digest != PARAMETER_SCHEMA_DIGEST
            || !valid_digest(&self.parameter_values_digest)
            || self.proposal_digest != required_text(parameters, 1)?
            || self.record_digest != required_text(parameters, 3)?
            || self.schema_marker_digest != statement.schema_marker_digest()
            || statement.schema_name() != format!("op_automation_{}", self.application_object_key)
        {
            return Err(ReconciliationErrorV1::InvalidReviewBinding);
        }
        Ok(())
    }
}

pub(super) struct AutomationReconciliationContractV1 {
    statement: FixedStatementArtifactV1,
    parameters: Vec<BoundParameterV1>,
    review_binding: TrustedTestingReviewBindingV1,
    state: AtomicU8,
}

impl AutomationReconciliationContractV1 {
    #[cfg(test)]
    pub(super) fn issue_for_test(
        review: TestingReviewBindingInputV1,
        parameters: Vec<BoundParameterV1>,
    ) -> Result<Self, ReconciliationErrorV1> {
        let statement = FixedStatementArtifactV1::render(&review.application_object_key)?;
        statement.validate()?;
        validate_parameters(&parameters)?;
        let review_binding =
            TrustedTestingReviewBindingV1::checked_for_test(review, &statement, &parameters)?;
        Ok(Self {
            statement,
            parameters,
            review_binding,
            state: AtomicU8::new(READY),
        })
    }

    #[cfg(test)]
    pub(super) fn is_burned_for_test(&self) -> bool {
        self.state.load(Ordering::Acquire) == BURNED
    }

    pub(super) async fn run<D: DatabaseSessionV1>(
        &self,
        database: D,
        execution: &ExecutionControlV1<'_>,
    ) -> Result<ReconciliationResultV1, ReconciliationErrorV1> {
        self.state
            .compare_exchange(READY, RUNNING, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| ReconciliationErrorV1::AlreadyConsumed)?;
        let _burn = BurnAfterRun { state: &self.state };
        self.statement.validate()?;
        validate_parameters(&self.parameters)?;
        self.review_binding
            .validate(&self.statement, &self.parameters)?;
        if let Some(failure) = execution.stage.current_interruption() {
            return interruption_error(ReadStageV1::BeginReadOnly, failure);
        }

        let mut guard = DatabaseExecutionGuardV1::new(database);
        guard.arm_pending_request();
        let begin = race_stage(
            guard.database_mut().begin_read_only(execution.stage),
            execution.stage,
        )
        .await;
        finish_ready_stage(&mut guard, ReadStageV1::BeginReadOnly, begin)?;

        guard.arm_pending_request();
        let search_path = race_stage(
            guard
                .database_mut()
                .set_local_search_path_pg_catalog(execution.stage),
            execution.stage,
        )
        .await;
        finish_ready_stage(&mut guard, ReadStageV1::SearchPath, search_path)?;

        guard.arm_pending_request();
        let row_security = race_stage(
            guard
                .database_mut()
                .set_local_row_security_off(execution.stage),
            execution.stage,
        )
        .await;
        finish_ready_stage(&mut guard, ReadStageV1::RowSecurity, row_security)?;

        guard.arm_pending_request();
        let statement_timeout = race_stage(
            guard
                .database_mut()
                .set_local_statement_timeout_ms(STATEMENT_TIMEOUT_MS, execution.stage),
            execution.stage,
        )
        .await;
        finish_ready_stage(&mut guard, ReadStageV1::StatementTimeout, statement_timeout)?;

        guard.arm_pending_request();
        let prepare = race_stage(
            guard
                .database_mut()
                .prepare_fixed_statement(&self.statement, execution.stage),
            execution.stage,
        )
        .await;
        let prepared = finish_ready_stage(&mut guard, ReadStageV1::Prepare, prepare)?;

        let mut response = BoundedObservationSinkV1::new();
        guard.arm_pending_request();
        let execute = race_stage(
            guard.database_mut().execute_prepared(
                prepared,
                &self.parameters,
                READ_LIMITS,
                &mut response,
                execution.stage,
            ),
            execution.stage,
        )
        .await;
        finish_ready_stage(&mut guard, ReadStageV1::Execute, execute)?;

        // Response validation happens only after Execute has completed and AbortOnly is armed.
        let observation_json = response.into_observation()?;
        let observation_text = std::str::from_utf8(&observation_json)
            .map_err(|_| ReconciliationErrorV1::InvalidResponseUtf8)?;
        let status = parse_observation(observation_text, &self.parameters, &self.statement)?;

        guard.arm_pending_request();
        let finish = race_stage(
            guard.database_mut().finish_read_only(execution.stage),
            execution.stage,
        )
        .await;
        match finish {
            Ok(database_result) => {
                // Finish is also an adapter stage: a Ready result first removes cancellation
                // authority. A successful finish can then disarm cleanup entirely.
                guard.abort_only();
                match database_result {
                    Ok(()) => guard.disarm_after_finish(),
                    Err(failure) => {
                        return Err(ReconciliationErrorV1::Database {
                            stage: ReadStageV1::Finish,
                            failure,
                        });
                    }
                }
            }
            Err(failure) => {
                return interruption_error(ReadStageV1::Finish, failure);
            }
        }

        Ok(ReconciliationResultV1 {
            status,
            response_byte_length: observation_json.len(),
            observation_json,
            testing_only: true,
            specific_installation_authenticated: false,
            production_transport_authenticated: false,
            read_only_reconciliation_completed: false,
            commit_outcome_resolved: false,
            database_cas_committed: false,
            capture_consumed: false,
            operation_authority_authenticated: false,
            credential_authority_created: false,
            transport_authority_created: false,
            database_authority_created: false,
            mutation_authority_created: false,
            execution_authority_created: false,
            receipt_authority_created: false,
            release_authority_created: false,
            reconciliation_result_authenticated: false,
            automatic_retry_allowed: false,
            persistence_authority_granted: false,
            dispatch_authority_granted: false,
            receipt_v2_issued: false,
            release_authorized: false,
            release_ready: false,
        })
    }
}

fn finish_ready_stage<D: DatabaseSessionV1, T>(
    guard: &mut DatabaseExecutionGuardV1<D>,
    stage: ReadStageV1,
    outcome: Result<Result<T, DatabaseFailureV1>, DatabaseFailureV1>,
) -> Result<T, ReconciliationErrorV1> {
    match outcome {
        Ok(database_result) => {
            // A Ready adapter future has no outstanding request, even when the server rejected the
            // operation. Switch before interpreting the inner result or allocating/parsing bytes.
            guard.abort_only();
            database_result.map_err(|failure| ReconciliationErrorV1::Database { stage, failure })
        }
        Err(failure) => interruption_error(stage, failure),
    }
}

fn interruption_error<T>(
    stage: ReadStageV1,
    failure: DatabaseFailureV1,
) -> Result<T, ReconciliationErrorV1> {
    if failure == DatabaseFailureV1::Cancelled {
        Err(ReconciliationErrorV1::Cancelled)
    } else {
        Err(ReconciliationErrorV1::Database { stage, failure })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CleanupDispositionV1 {
    Disarmed,
    AbortOnly,
    CancelThenAbort,
}

struct DatabaseExecutionGuardV1<D: DatabaseSessionV1> {
    database: D,
    disposition: CleanupDispositionV1,
}

impl<D: DatabaseSessionV1> DatabaseExecutionGuardV1<D> {
    fn new(database: D) -> Self {
        Self {
            database,
            disposition: CleanupDispositionV1::Disarmed,
        }
    }

    fn database_mut(&mut self) -> &mut D {
        &mut self.database
    }

    fn arm_pending_request(&mut self) {
        self.disposition = CleanupDispositionV1::CancelThenAbort;
    }

    fn abort_only(&mut self) {
        self.disposition = CleanupDispositionV1::AbortOnly;
    }

    fn disarm_after_finish(&mut self) {
        self.disposition = CleanupDispositionV1::Disarmed;
    }
}

impl<D: DatabaseSessionV1> Drop for DatabaseExecutionGuardV1<D> {
    fn drop(&mut self) {
        if self.disposition == CleanupDispositionV1::CancelThenAbort {
            self.database.cancel_database_request();
        }
        if self.disposition != CleanupDispositionV1::Disarmed {
            self.database.abort_read_only();
        }
        self.disposition = CleanupDispositionV1::Disarmed;
    }
}

struct BurnAfterRun<'a> {
    state: &'a AtomicU8,
}

impl Drop for BurnAfterRun<'_> {
    fn drop(&mut self) {
        self.state.store(BURNED, Ordering::Release);
    }
}
