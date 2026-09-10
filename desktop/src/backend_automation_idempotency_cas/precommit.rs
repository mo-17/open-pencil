//! Production-compiled, privately unreachable Automation idempotency CAS precommit kernel.
//!
//! The reviewed TypeScript artifact is the sole SQL source. This module pins and renders only its
//! fixed application-schema sentinel, validates the exact 27-position PostgreSQL cast contract,
//! independently verifies both canonical JSON documents and their digests, and exposes no
//! production issuer or transport.

use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine as _,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::Duration;

const REVIEW_TYPESCRIPT_SOURCE: &str = include_str!(
    "../../../src/app/plugins/host/deployment/supabase/automation/idempotency/cas/review.ts"
);
const SQL_START_MARKER: &str = "export const SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_SQL_TEMPLATE = `";
const SQL_END_MARKER: &str =
    "`\n\nexport interface CreateSupabaseAutomationIdempotencyCASReviewForTestingOptionsV1";
const SQL_SCHEMA_SENTINEL: &str = "__OPENPENCIL_AUTOMATION_IDEMPOTENCY_SCHEMA__";
const SQL_TEMPLATE_BYTE_LENGTH: usize = 76_443;
const SQL_TEMPLATE_SHA256: [u8; 32] = [
    0x79, 0x96, 0xbd, 0x29, 0xc9, 0x22, 0x96, 0xa6, 0x97, 0x01, 0x66, 0x6b, 0x6a, 0xd4, 0x20, 0x61,
    0xd4, 0x71, 0x48, 0x01, 0xa3, 0xed, 0x9d, 0x97, 0x2e, 0x72, 0x49, 0xf7, 0xdd, 0x91, 0x82, 0xbc,
];
const SQL_SCHEMA_SENTINEL_COUNT: usize = 19;
const QUERY_ID: &str = "supabase-automation-idempotency-cas";
const QUERY_VERSION: &str = "openpencil-supabase-automation-idempotency-cas-v1";
const PARAMETER_COUNT: usize = 27;
const STATEMENT_COUNT: u8 = 1;
const STATEMENT_TIMEOUT_MS: u32 = 15_000;
const LOCK_TIMEOUT_MS: u32 = 5_000;
const OVERALL_TIMEOUT: Duration = Duration::from_secs(30);
const MAXIMUM_SQL_BYTES: usize = 128 * 1_024;
const MAXIMUM_PARAMETER_STRING_BYTES: usize = 32 * 1_024;
const MAXIMUM_AGGREGATE_PARAMETER_BYTES: usize = 64 * 1_024;
const MAXIMUM_CANONICAL_DOCUMENT_BYTES: usize = 16_384;
const MAXIMUM_RESPONSE_ROWS: u8 = 1;
const MAXIMUM_RESPONSE_COLUMNS: u8 = 1;
const MAXIMUM_RESPONSE_BYTES: usize = 64;
const MAXIMUM_IDENTIFIER_BYTES: usize = 256;
const MAXIMUM_ATTEMPTS: usize = 20;
const MAXIMUM_CAUSATION_HOP: i32 = 16;
const MAXIMUM_RETENTION_HOURS: i32 = 2_160;
const MAXIMUM_REVISION: i64 = 1_024;
const REMAINING_PRODUCTION_BLOCKERS: &[&str] = &[
    "production-constructor-unavailable",
    "operation-journal-precommit-unavailable",
    "credential-lease-unavailable",
    "database-adapter-unavailable",
    "wire-response-bounds-unavailable",
    "server-cancellation-not-certified",
    "commit-outcome-reconciliation-unavailable",
    "response-authentication-unavailable",
    "database-cas-readback-unavailable",
    "receipt-v2-issuer-unavailable",
    "release-authority-unavailable",
];

const PROPOSAL_FORMAT: &str = "openpencil.backend-automation-idempotency-cas-proposal";
const RECORD_FORMAT: &str = "openpencil.backend-automation-idempotency-record";

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

#[derive(Clone, Debug, PartialEq, Eq)]
enum BoundParameterValueV1 {
    Text(Option<String>),
    Int8(Option<i64>),
    Int4(i32),
    TextArray(Vec<String>),
    Boolean(bool),
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct BoundParameterV1 {
    position: u8,
    name: &'static str,
    value: BoundParameterValueV1,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PrecommitContractErrorV1 {
    InvalidStaticStatement,
    InvalidApplicationObjectKey,
    InvalidParameterContract,
    AlreadyConsumed,
    Cancelled,
    Database {
        stage: TransactionStageV1,
        failure: DatabaseFailureV1,
    },
    CommitOutcomeUnknown {
        failure: DatabaseFailureV1,
    },
    InvalidRowCount,
    InvalidColumnCount,
    InvalidColumnMetadata,
    NullResponse,
    EmptyResponse,
    ResponseTooLarge,
    InvalidResponse,
    RefusedStatus(AutomationIdempotencyCasStatusV1),
}

impl PrecommitContractErrorV1 {
    const fn automatic_retry_allowed(self) -> bool {
        false
    }

    const fn requires_read_only_reconciliation(self) -> bool {
        matches!(self, Self::CommitOutcomeUnknown { .. })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct FixedStatementArtifactV1 {
    schema_name: String,
    rendered_sql: String,
    rendered_sha256: [u8; 32],
}

impl FixedStatementArtifactV1 {
    fn render(application_object_key: &str) -> Result<Self, PrecommitContractErrorV1> {
        validate_fixed_template()?;
        if !valid_application_object_key(application_object_key) {
            return Err(PrecommitContractErrorV1::InvalidApplicationObjectKey);
        }
        let schema_name = format!("op_automation_{application_object_key}");
        let rendered_sql = fixed_sql_template()?.replace(SQL_SCHEMA_SENTINEL, &schema_name);
        if rendered_sql.contains(SQL_SCHEMA_SENTINEL)
            || rendered_sql.matches(&schema_name).count() != SQL_SCHEMA_SENTINEL_COUNT
            || rendered_sql.len() > MAXIMUM_SQL_BYTES
        {
            return Err(PrecommitContractErrorV1::InvalidStaticStatement);
        }
        let rendered_sha256 = <[u8; 32]>::from(Sha256::digest(rendered_sql.as_bytes()));
        Ok(Self {
            schema_name,
            rendered_sql,
            rendered_sha256,
        })
    }

    fn source(&self) -> &str {
        &self.rendered_sql
    }

    const fn query_id(&self) -> &'static str {
        QUERY_ID
    }

    const fn query_version(&self) -> &'static str {
        QUERY_VERSION
    }

    fn byte_length(&self) -> usize {
        self.rendered_sql.len()
    }

    const fn template_byte_length(&self) -> usize {
        SQL_TEMPLATE_BYTE_LENGTH
    }

    const fn template_sha256(&self) -> [u8; 32] {
        SQL_TEMPLATE_SHA256
    }

    const fn rendered_sha256(&self) -> [u8; 32] {
        self.rendered_sha256
    }

    fn validate(&self) -> Result<(), PrecommitContractErrorV1> {
        validate_fixed_template()?;
        let expected = Self::render(
            self.schema_name
                .strip_prefix("op_automation_")
                .ok_or(PrecommitContractErrorV1::InvalidStaticStatement)?,
        )?;
        if self.schema_name != expected.schema_name
            || self.rendered_sql != expected.rendered_sql
            || self.rendered_sha256 != expected.rendered_sha256
        {
            return Err(PrecommitContractErrorV1::InvalidStaticStatement);
        }
        Ok(())
    }
}

/// Recompute the digest of the sole fixed mutation statement without exposing its SQL or an
/// executable contract. Recovery uses this only to reject journal material that was not bound to
/// the exact application-scoped CAS artifact.
pub(crate) fn rendered_sql_digest_for_recovery(application_object_key: &str) -> Option<String> {
    FixedStatementArtifactV1::render(application_object_key)
        .ok()
        .map(|statement| URL_SAFE_NO_PAD.encode(statement.rendered_sha256()))
}

fn fixed_sql_template() -> Result<&'static str, PrecommitContractErrorV1> {
    if REVIEW_TYPESCRIPT_SOURCE.matches(SQL_START_MARKER).count() != 1
        || REVIEW_TYPESCRIPT_SOURCE.matches(SQL_END_MARKER).count() != 1
    {
        return Err(PrecommitContractErrorV1::InvalidStaticStatement);
    }
    let (_, tail) = REVIEW_TYPESCRIPT_SOURCE
        .split_once(SQL_START_MARKER)
        .ok_or(PrecommitContractErrorV1::InvalidStaticStatement)?;
    let (source, _) = tail
        .split_once(SQL_END_MARKER)
        .ok_or(PrecommitContractErrorV1::InvalidStaticStatement)?;
    Ok(source)
}

fn validate_fixed_template() -> Result<(), PrecommitContractErrorV1> {
    let source = fixed_sql_template()?;
    let statement_semicolons = source
        .lines()
        .filter(|line| !line.trim_start().starts_with("--"))
        .map(|line| line.matches(';').count())
        .sum::<usize>();
    let required_fragments = [
        "WITH RECURSIVE",
        "'transaction_isolation') = 'serializable'",
        "'transaction_read_only') = 'off'",
        "'row_security') = 'off'",
        "'search_path') = 'pg_catalog'",
        "'session_replication_role') = 'origin'",
        "'synchronous_commit') = 'on'",
        "FOR UPDATE OF \"head\" NOWAIT",
        "FOR SHARE OF \"revision_row\" NOWAIT",
        "\"idempotency_revisions\"",
        "\"idempotency_heads\"",
        "\"status\"",
    ];
    let sentinel_count = source.matches(SQL_SCHEMA_SENTINEL).count();
    if source.len() != SQL_TEMPLATE_BYTE_LENGTH
        || source.len() > MAXIMUM_SQL_BYTES
        || <[u8; 32]>::from(Sha256::digest(source.as_bytes())) != SQL_TEMPLATE_SHA256
        || sentinel_count != SQL_SCHEMA_SENTINEL_COUNT
        || !source.starts_with(
            "-- OpenPencil Supabase Backend Automation idempotency CAS statement review v1.\n",
        )
        || !source.ends_with("END = 1;\n")
        || source.contains('\0')
        || source.contains('\\')
        || source.contains('`')
        || source.contains("${")
        || statement_semicolons != usize::from(STATEMENT_COUNT)
        || !has_valid_parameter_schema()
        || !has_exact_placeholder_cast_contract(source)
        || required_fragments
            .iter()
            .any(|fragment| !source.contains(fragment))
        || source.contains("\nBEGIN")
        || source.contains("\nCOMMIT")
        || source.contains("\nROLLBACK")
        || source.contains("\nEXECUTE")
    {
        return Err(PrecommitContractErrorV1::InvalidStaticStatement);
    }
    Ok(())
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

fn has_exact_placeholder_cast_contract(source: &str) -> bool {
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

fn valid_application_object_key(value: &str) -> bool {
    value.len() == 20
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"_-".contains(&byte))
}

fn validate_parameters(parameters: &[BoundParameterV1]) -> Result<(), PrecommitContractErrorV1> {
    if !has_valid_parameter_schema() || parameters.len() != PARAMETER_SCHEMA.len() {
        return Err(PrecommitContractErrorV1::InvalidParameterContract);
    }
    let mut aggregate_bytes = 0_usize;
    for (parameter, spec) in parameters.iter().zip(PARAMETER_SCHEMA) {
        if parameter.position != spec.position || parameter.name != spec.name {
            return Err(PrecommitContractErrorV1::InvalidParameterContract);
        }
        let bytes = validate_parameter_value(&parameter.value, spec)?;
        aggregate_bytes = aggregate_bytes
            .checked_add(bytes)
            .ok_or(PrecommitContractErrorV1::InvalidParameterContract)?;
        if aggregate_bytes > MAXIMUM_AGGREGATE_PARAMETER_BYTES {
            return Err(PrecommitContractErrorV1::InvalidParameterContract);
        }
    }
    validate_canonical_documents(parameters)
}

fn validate_parameter_value(
    value: &BoundParameterValueV1,
    spec: ParameterSpecV1,
) -> Result<usize, PrecommitContractErrorV1> {
    match (spec.parameter_type, value) {
        (ParameterTypeV1::Text, BoundParameterValueV1::Text(value)) => {
            let Some(value) = value.as_deref() else {
                return if spec.nullable {
                    Ok(0)
                } else {
                    Err(PrecommitContractErrorV1::InvalidParameterContract)
                };
            };
            if value.is_empty()
                || value.len() > MAXIMUM_PARAMETER_STRING_BYTES
                || value.chars().any(char::is_control)
            {
                return Err(PrecommitContractErrorV1::InvalidParameterContract);
            }
            let valid = match spec.encoding {
                ParameterEncodingV1::Digest => valid_digest(value),
                ParameterEncodingV1::StandardBase64 => valid_canonical_document_base64(value),
                ParameterEncodingV1::Identifier => valid_identifier(value),
                ParameterEncodingV1::CanonicalUtcMillis => parse_timestamp_millis(value).is_some(),
                ParameterEncodingV1::State => valid_state(value),
                _ => false,
            };
            if !valid {
                return Err(PrecommitContractErrorV1::InvalidParameterContract);
            }
            Ok(value.len())
        }
        (ParameterTypeV1::Int8, BoundParameterValueV1::Int8(value)) => {
            if spec.encoding != ParameterEncodingV1::Integer || (value.is_none() && !spec.nullable)
            {
                return Err(PrecommitContractErrorV1::InvalidParameterContract);
            }
            Ok(value.map_or(0, |number| number.to_string().len()))
        }
        (ParameterTypeV1::Int4, BoundParameterValueV1::Int4(value))
            if spec.encoding == ParameterEncodingV1::Integer && !spec.nullable =>
        {
            Ok(value.to_string().len())
        }
        (ParameterTypeV1::TextArray, BoundParameterValueV1::TextArray(values)) => {
            if spec.encoding != ParameterEncodingV1::IdentifierArray
                || spec.nullable
                || values.is_empty()
                || values.len() > MAXIMUM_ATTEMPTS
                || values.iter().any(|value| !valid_identifier(value))
                || has_duplicate_strings(values)
            {
                return Err(PrecommitContractErrorV1::InvalidParameterContract);
            }
            Ok(values.iter().map(String::len).sum())
        }
        (ParameterTypeV1::Boolean, BoundParameterValueV1::Boolean(value)) => {
            if spec.encoding != ParameterEncodingV1::FixedFalse || spec.nullable || *value {
                return Err(PrecommitContractErrorV1::InvalidParameterContract);
            }
            Ok(1)
        }
        _ => Err(PrecommitContractErrorV1::InvalidParameterContract),
    }
}

fn has_duplicate_strings(values: &[String]) -> bool {
    values
        .iter()
        .enumerate()
        .any(|(index, value)| values[..index].contains(value))
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
    let number = |start: usize, end: usize| value[start..end].parse::<i64>().ok();
    let (year, month, day, hour, minute, second, millis) = (
        number(0, 4)?,
        number(5, 7)?,
        number(8, 10)?,
        number(11, 13)?,
        number(14, 16)?,
        number(17, 19)?,
        number(20, 23)?,
    );
    if year == 0 || !(1..=12).contains(&month) || hour >= 24 || minute >= 60 || second >= 60 {
        return None;
    }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
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
    let adjusted_year = year - i64::from(month <= 2);
    let era = adjusted_year.div_euclid(400);
    let year_of_era = adjusted_year - era * 400;
    let adjusted_month = month + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * adjusted_month + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    let days_since_epoch = era * 146_097 + day_of_era - 719_468;
    Some(
        days_since_epoch * 86_400_000
            + hour * 3_600_000
            + minute * 60_000
            + second * 1_000
            + millis,
    )
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct CanonicalProposalV1 {
    #[serde(rename = "automationId")]
    automation_id: String,
    #[serde(rename = "dispatchAuthorityGranted")]
    dispatch_authority_granted: bool,
    #[serde(rename = "eventId")]
    event_id: String,
    #[serde(rename = "expectedHeadDigest")]
    expected_head_digest: Option<String>,
    #[serde(rename = "expectedRevision")]
    expected_revision: Option<i64>,
    format: String,
    #[serde(rename = "hostEvidenceAuthenticated")]
    host_evidence_authenticated: bool,
    #[serde(rename = "idempotencyKeyDigest")]
    idempotency_key_digest: String,
    #[serde(rename = "nextRecordDigest")]
    next_record_digest: String,
    #[serde(rename = "nextRevision")]
    next_revision: i64,
    #[serde(rename = "operationId")]
    operation_id: String,
    #[serde(rename = "persistenceAuthorityGranted")]
    persistence_authority_granted: bool,
    version: u8,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct CanonicalRecordV1 {
    #[serde(rename = "attemptIds")]
    attempt_ids: Vec<String>,
    #[serde(rename = "automationId")]
    automation_id: String,
    #[serde(rename = "causationHop")]
    causation_hop: i32,
    #[serde(rename = "causationId")]
    causation_id: String,
    #[serde(rename = "completionEvidenceDigest")]
    completion_evidence_digest: Option<String>,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "currentAttemptId")]
    current_attempt_id: String,
    #[serde(rename = "dispatchAuthorityGranted")]
    dispatch_authority_granted: bool,
    #[serde(rename = "eventId")]
    event_id: String,
    #[serde(rename = "expiresAt")]
    expires_at: String,
    format: String,
    #[serde(rename = "hostEvidenceAuthenticated")]
    host_evidence_authenticated: bool,
    #[serde(rename = "idempotencyKeyDigest")]
    idempotency_key_digest: String,
    #[serde(rename = "knownNotDispatchedEvidenceDigest")]
    known_not_dispatched_evidence_digest: Option<String>,
    #[serde(rename = "operationId")]
    operation_id: String,
    #[serde(rename = "persistenceAuthorityGranted")]
    persistence_authority_granted: bool,
    #[serde(rename = "previousRecordDigest")]
    previous_record_digest: Option<String>,
    #[serde(rename = "reconciliationEvidenceDigest")]
    reconciliation_evidence_digest: Option<String>,
    #[serde(rename = "recordedAt")]
    recorded_at: String,
    #[serde(rename = "retentionHours")]
    retention_hours: i32,
    revision: i64,
    state: String,
    version: u8,
}

fn decode_canonical<T>(encoded: &str) -> Result<(T, Vec<u8>), PrecommitContractErrorV1>
where
    T: DeserializeOwned + Serialize,
{
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| PrecommitContractErrorV1::InvalidParameterContract)?;
    if !(2..=MAXIMUM_CANONICAL_DOCUMENT_BYTES).contains(&bytes.len())
        || STANDARD.encode(&bytes) != encoded
    {
        return Err(PrecommitContractErrorV1::InvalidParameterContract);
    }
    let value: T = serde_json::from_slice(&bytes)
        .map_err(|_| PrecommitContractErrorV1::InvalidParameterContract)?;
    let canonical = serde_json::to_vec(&value)
        .map_err(|_| PrecommitContractErrorV1::InvalidParameterContract)?;
    if canonical != bytes {
        return Err(PrecommitContractErrorV1::InvalidParameterContract);
    }
    Ok((value, bytes))
}

fn validate_canonical_documents(
    parameters: &[BoundParameterV1],
) -> Result<(), PrecommitContractErrorV1> {
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
        return Err(PrecommitContractErrorV1::InvalidParameterContract);
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
        && !has_duplicate_strings(&record.attempt_ids)
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

fn digest_base64url(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(bytes))
}

fn text(
    parameters: &[BoundParameterV1],
    position: usize,
) -> Result<Option<&str>, PrecommitContractErrorV1> {
    match &parameters[position - 1].value {
        BoundParameterValueV1::Text(value) => Ok(value.as_deref()),
        _ => Err(PrecommitContractErrorV1::InvalidParameterContract),
    }
}

fn required_text(
    parameters: &[BoundParameterV1],
    position: usize,
) -> Result<&str, PrecommitContractErrorV1> {
    text(parameters, position)?.ok_or(PrecommitContractErrorV1::InvalidParameterContract)
}

fn int8(
    parameters: &[BoundParameterV1],
    position: usize,
) -> Result<Option<i64>, PrecommitContractErrorV1> {
    match parameters[position - 1].value {
        BoundParameterValueV1::Int8(value) => Ok(value),
        _ => Err(PrecommitContractErrorV1::InvalidParameterContract),
    }
}

fn required_int8(
    parameters: &[BoundParameterV1],
    position: usize,
) -> Result<i64, PrecommitContractErrorV1> {
    int8(parameters, position)?.ok_or(PrecommitContractErrorV1::InvalidParameterContract)
}

fn int4(parameters: &[BoundParameterV1], position: usize) -> Result<i32, PrecommitContractErrorV1> {
    match parameters[position - 1].value {
        BoundParameterValueV1::Int4(value) => Ok(value),
        _ => Err(PrecommitContractErrorV1::InvalidParameterContract),
    }
}

fn text_array(
    parameters: &[BoundParameterV1],
    position: usize,
) -> Result<&[String], PrecommitContractErrorV1> {
    match &parameters[position - 1].value {
        BoundParameterValueV1::TextArray(value) => Ok(value),
        _ => Err(PrecommitContractErrorV1::InvalidParameterContract),
    }
}

fn boolean(
    parameters: &[BoundParameterV1],
    position: usize,
) -> Result<bool, PrecommitContractErrorV1> {
    match parameters[position - 1].value {
        BoundParameterValueV1::Boolean(value) => Ok(value),
        _ => Err(PrecommitContractErrorV1::InvalidParameterContract),
    }
}

mod runner;
use runner::*;

#[cfg(test)]
mod source_tests;
#[cfg(test)]
mod tests;
