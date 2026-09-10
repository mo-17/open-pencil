//! Strict, dormant IPC mirror and Host-minted one-shot session binding.
//!
//! Decoding proves only canonical wire self-consistency. Preparing additionally requires a
//! Rust-owned evidence value, but still authenticates no database, transport, credential, query
//! execution, response, receipt, or release fact. `HostFixedReadEvidenceV1` is deliberately not
//! cloneable and `prepare` consumes it. Before any command is registered, its future trusted Host
//! producer must also atomically consume the upstream operation authority used to mint evidence.
//! A future adapter must additionally bind the retained Host identity to the exact database session
//! and prepare the embedded fixed SQL as an opaque statement handle. This dormant slice intentionally
//! exposes neither a database-session constructor nor a SQL-bearing execution API.

use super::*;
use super::{
    credential::DatabaseReadCredentialSnapshotV1, profile::SupabaseDatabaseReadConnectionProfileV1,
};
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine as _,
};
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const REQUEST_FORMAT: &str = "openpencil.supabase-backfill-native-fixed-read-request.v1";
const REQUEST_DIGEST_FORMAT: &str =
    "openpencil.supabase-backfill-native-fixed-read-request-digest.v1";
const PROVIDER_ID: &str = "supabase";
const ENVIRONMENT: &str = "staging";
const VARIANT: &str = "receipt-zero-reconciliation";
const ACCESS_MODE: &str = "read-only";
const SNAPSHOT_SCOPE: &str = "single-statement";
const MAXIMUM_RAW_REQUEST_BYTES: usize = 262_144;
const MAXIMUM_CANONICAL_PARAMETER_BYTES: usize = 65_536;
const POSTGRES_BIGINT_MAX_DECIMAL: &str = "9223372036854775807";
const POSTGRES_INTEGER_MAX_DECIMAL: &str = "2147483647";
const JAVASCRIPT_MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const SCOPE_FORMAT: &str = "openpencil.backend-backfill-execution-scope";
const RECEIPT_FORMAT: &str = "openpencil.backend-backfill-execution-receipt";
const BACKFILL_V2_VERSION: u8 = 2;
const MAXIMUM_RECEIPT_COUNT: u64 = 10_000;
const MAXIMUM_BATCH_COUNT: u64 = 9_999;
const MAXIMUM_BATCH_SIZE: u64 = 1_000;
const RESUME_POLICY: &str = "from-receipt";
const COMPLETION_RULE: &str = "predicate-exhausted-and-postconditions-satisfied";
const PARAMETER_SCHEMA_DIGEST: &str = "3j14xx4T8NmZ8gNpc3OlylDz4zSt3sIj2zVnykaHumo";
const SESSION_ID_BYTES: usize = 32;
const MAXIMUM_LIVE_SESSIONS: usize = 32;
const SESSION_TTL: Duration = Duration::from_secs(30);
const OPERATION_AUTHORITY_TTL: Duration = Duration::from_secs(30);
const SESSION_ID_ATTEMPTS: usize = 4;

const RESPONSE_FIELDS: [&str; 29] = [
    "queryVersion",
    "scopeDigest",
    "receiptDigest",
    "candidateOperationEvidenceDigest",
    "initialExecutionStatus",
    "initialReceiptOutcome",
    "reportedStatus",
    "inputValid",
    "runtimeReady",
    "fullLedgerShapeVerified",
    "collisionExecutionCount",
    "targetExecutionCount",
    "exactInitialExecutionCount",
    "exactImmutableExecutionCount",
    "receiptCount",
    "exactReceiptZeroCount",
    "headCount",
    "headRevision",
    "exactInitialHeadCount",
    "chainCount",
    "chainMinimumRevision",
    "chainMaximumRevision",
    "headTimestampMatchesLatestReceipt",
    "executionTimestampMatchesHead",
    "transactionReadOnly",
    "installMarkerDigest",
    "serverVersionNum",
    "snapshotDigest",
    "observedAt",
];

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WireBindingsV1 {
    reconciliation_review_digest: String,
    static_sql_safety_certificate_digest: String,
    reconciliation_sql_digest: String,
    reconciliation_query_digest: String,
    query_contract_digest: String,
    analysis_profile_digest: String,
    parameter_schema_digest: String,
    parameter_values_digest: String,
    parameter_order_digest: String,
    response_fields_digest: String,
    ledger_shape_digest: String,
    expected_column_inventory_digest: String,
    expected_constraint_inventory_digest: String,
    scope_digest: String,
    receipt_digest: String,
    candidate_operation_evidence_digest: String,
    historical_install_marker_digest: String,
}

impl WireBindingsV1 {
    fn values(&self) -> [&str; 17] {
        [
            &self.reconciliation_review_digest,
            &self.static_sql_safety_certificate_digest,
            &self.reconciliation_sql_digest,
            &self.reconciliation_query_digest,
            &self.query_contract_digest,
            &self.analysis_profile_digest,
            &self.parameter_schema_digest,
            &self.parameter_values_digest,
            &self.parameter_order_digest,
            &self.response_fields_digest,
            &self.ledger_shape_digest,
            &self.expected_column_inventory_digest,
            &self.expected_constraint_inventory_digest,
            &self.scope_digest,
            &self.receipt_digest,
            &self.candidate_operation_evidence_digest,
            &self.historical_install_marker_digest,
        ]
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WireQueryV1 {
    query_id: String,
    query_version: String,
    statement_count: u8,
    access_mode: String,
    snapshot_scope: String,
    sql_byte_length: usize,
    parameter_count: usize,
    parameter_order: Vec<String>,
    response_fields: Vec<String>,
    raw_sql_included: bool,
    endpoint_included: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WireRequirementsV1 {
    configured_search_path: Vec<String>,
    requires_transport_enforced_read_only_boundary: bool,
    requires_live_catalog_semantics_authentication: bool,
    server_statement_timeout_ms: u32,
    maximum_response_bytes: usize,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WireRequestV1 {
    format: String,
    version: u8,
    provider_id: String,
    environment: String,
    variant: String,
    contract_only: bool,
    native_command_registered: bool,
    request_dispatched: bool,
    query: WireQueryV1,
    requirements: WireRequirementsV1,
    bindings: WireBindingsV1,
    parameters: Vec<Option<String>>,
    production_transport_created: bool,
    production_transport_authenticated: bool,
    production_request_dispatch_authenticated: bool,
    adapter_authenticated: bool,
    dynamic_bindings_authenticated: bool,
    read_only_boundary_authenticated: bool,
    configured_search_path_authenticated: bool,
    live_catalog_semantics_authenticated: bool,
    server_statement_timeout_authenticated: bool,
    server_cancellation_authenticated: bool,
    single_statement_snapshot_authenticated: bool,
    credential_authority_created: bool,
    transport_authority_created: bool,
    database_authority_created: bool,
    mutation_authority_created: bool,
    execution_authority_created: bool,
    receipt_authority_created: bool,
    release_authority_created: bool,
    release_ready: bool,
    request_digest: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackfillExecutionScopeV2 {
    format: String,
    version: u8,
    provider_id: String,
    environment: String,
    provider_authority_digest: String,
    application_id: String,
    application_digest: String,
    migration_id: String,
    migration_digest: String,
    migration_plan_digest: String,
    source_ledger_digest: String,
    capture_digest: String,
    receipt_zero_evidence_digest: String,
    resource_identity_digest: String,
    catalog_precondition_digest: String,
    entity_id: String,
    cursor_field: String,
    cursor_field_type: String,
    target_field: String,
    batch_size: u64,
    maximum_receipt_count: u64,
    maximum_batch_count: u64,
    captured_high_water: Option<u64>,
    initial_remaining_eligible_row_count: u64,
    initial_remaining_target_row_count: u64,
    required_batch_count: u64,
    required_matched_row_count: Option<u64>,
    resume_policy: String,
    completion_rule: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackfillExecutionCountsV2 {
    scanned_row_count: u64,
    matched_row_count: u64,
    updated_row_count: u64,
}

impl BackfillExecutionCountsV2 {
    fn is_zero(&self) -> bool {
        self.scanned_row_count == 0 && self.matched_row_count == 0 && self.updated_row_count == 0
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackfillExecutionExhaustionV2 {
    checked: bool,
    remaining_eligible_row_count: Option<u64>,
    remaining_target_row_count: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackfillExecutionPostconditionsV2 {
    field_not_null: bool,
    required_matched_row_count: Option<u64>,
    matched_row_count_satisfied: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackfillExecutionReceiptV2 {
    format: String,
    version: u8,
    receipt_id: String,
    execution_id: String,
    idempotency_key: String,
    request_digest: String,
    scope: BackfillExecutionScopeV2,
    scope_digest: String,
    checkpoint_kind: String,
    batch_index: u64,
    previous_cursor: Option<u64>,
    last_processed_key: Option<u64>,
    batch_counts: BackfillExecutionCountsV2,
    cumulative_counts: BackfillExecutionCountsV2,
    exhaustion: BackfillExecutionExhaustionV2,
    postconditions: BackfillExecutionPostconditionsV2,
    outcome: String,
    terminal_reason: Option<String>,
    stable_error_code: Option<String>,
    previous_receipt_digest: Option<String>,
    catalog_evidence_digest: String,
    operation_authority_digest: String,
    database_event_id: String,
    database_head_version: u64,
    committed_at: String,
    evidence_digest: String,
}

struct DecodedEmbeddedBackfillV2 {
    scope: BackfillExecutionScopeV2,
    receipt: BackfillExecutionReceiptV2,
    scope_bytes: Vec<u8>,
    receipt_bytes: Vec<u8>,
    scope_digest: String,
    receipt_digest: String,
}

impl WireRequestV1 {
    fn has_only_required_false_claims(&self) -> bool {
        !self.native_command_registered
            && !self.request_dispatched
            && !self.production_transport_created
            && !self.production_transport_authenticated
            && !self.production_request_dispatch_authenticated
            && !self.adapter_authenticated
            && !self.dynamic_bindings_authenticated
            && !self.read_only_boundary_authenticated
            && !self.configured_search_path_authenticated
            && !self.live_catalog_semantics_authenticated
            && !self.server_statement_timeout_authenticated
            && !self.server_cancellation_authenticated
            && !self.single_statement_snapshot_authenticated
            && !self.credential_authority_created
            && !self.transport_authority_created
            && !self.database_authority_created
            && !self.mutation_authority_created
            && !self.execution_authority_created
            && !self.receipt_authority_created
            && !self.release_authority_created
            && !self.release_ready
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum FixedReadWireError {
    RequestTooLarge,
    InvalidRequest,
    BindingMismatch,
    InvalidHostEvidence,
    HostEvidenceMismatch,
    RegistryFull,
    SessionEntropyUnavailable,
    SessionIdCollision,
    SessionMissing,
    SessionExpired,
    RegistryUnavailable,
    OperationAuthorityMissing,
    OperationAuthorityExpired,
    OperationAuthorityMismatch,
}

#[derive(Debug)]
pub(super) struct DecodedFixedReadRequestV1 {
    request_digest: [u8; 32],
    bindings: WireBindingsV1,
    parameters: Vec<FixedReadParameterValue>,
    contract: ReceiptZeroFixedReadContractV1,
}

pub(super) fn decode_fixed_read_request_v1(
    raw: &[u8],
) -> Result<DecodedFixedReadRequestV1, FixedReadWireError> {
    if raw.len() > MAXIMUM_RAW_REQUEST_BYTES {
        return Err(FixedReadWireError::RequestTooLarge);
    }
    let request: WireRequestV1 =
        serde_json::from_slice(raw).map_err(|_| FixedReadWireError::InvalidRequest)?;
    validate_fixed_shape(&request)?;
    validate_bindings(&request.bindings)?;
    validate_parameter_schema(&request.parameters)?;

    let supplied_request_digest = decode_digest(&request.request_digest)?;
    let recomputed_request_digest = canonical_request_digest(&request)?;
    if supplied_request_digest != recomputed_request_digest {
        return Err(FixedReadWireError::BindingMismatch);
    }

    let parameter_values_digest = decode_digest(&request.bindings.parameter_values_digest)?;
    let parameters = parameter_values(&request.parameters);
    let contract = ReceiptZeroFixedReadContractV1::checked(
        &request.bindings.reconciliation_sql_digest,
        &request.bindings.reconciliation_query_digest,
        &request.bindings.query_contract_digest,
        &request.bindings.parameter_order_digest,
        &request.bindings.response_fields_digest,
        parameter_values_digest,
        parameters.clone(),
    )
    .map_err(|_| FixedReadWireError::BindingMismatch)?;
    validate_parameter_cross_bindings(&request.bindings, &parameters)?;
    validate_embedded_backfill_v2(&request.bindings, &request.parameters)?;

    Ok(DecodedFixedReadRequestV1 {
        request_digest: supplied_request_digest,
        bindings: request.bindings,
        parameters,
        contract,
    })
}

fn validate_fixed_shape(request: &WireRequestV1) -> Result<(), FixedReadWireError> {
    let parameter_order_matches = request.query.parameter_order.len()
        == RECEIPT_ZERO_PARAMETER_ORDER.len()
        && request
            .query
            .parameter_order
            .iter()
            .zip(RECEIPT_ZERO_PARAMETER_ORDER)
            .all(|(actual, expected)| actual == expected);
    let response_fields_match = request.query.response_fields.len() == RESPONSE_FIELDS.len()
        && request
            .query
            .response_fields
            .iter()
            .zip(RESPONSE_FIELDS)
            .all(|(actual, expected)| actual == expected);
    if request.format != REQUEST_FORMAT
        || request.version != 1
        || request.provider_id != PROVIDER_ID
        || request.environment != ENVIRONMENT
        || request.variant != VARIANT
        || !request.contract_only
        || !request.has_only_required_false_claims()
        || request.query.query_id != RECEIPT_ZERO_QUERY_ID
        || request.query.query_version != RECEIPT_ZERO_QUERY_VERSION
        || request.query.statement_count != RECEIPT_ZERO_STATEMENT_COUNT
        || request.query.access_mode != ACCESS_MODE
        || request.query.snapshot_scope != SNAPSHOT_SCOPE
        || request.query.sql_byte_length != RECEIPT_ZERO_QUERY_BYTE_LENGTH
        || request.query.parameter_count != RECEIPT_ZERO_PARAMETER_COUNT
        || !parameter_order_matches
        || !response_fields_match
        || request.query.raw_sql_included
        || request.query.endpoint_included
        || request.requirements.configured_search_path != ["pg_catalog"]
        || !request
            .requirements
            .requires_transport_enforced_read_only_boundary
        || !request
            .requirements
            .requires_live_catalog_semantics_authentication
        || request.requirements.server_statement_timeout_ms != FIXED_STATEMENT_TIMEOUT_MS
        || request.requirements.maximum_response_bytes != MAXIMUM_RESPONSE_BYTES
    {
        return Err(FixedReadWireError::InvalidRequest);
    }
    Ok(())
}

fn validate_bindings(bindings: &WireBindingsV1) -> Result<(), FixedReadWireError> {
    for value in bindings.values() {
        decode_digest(value)?;
    }
    if bindings.reconciliation_sql_digest != RECEIPT_ZERO_SQL_DIGEST
        || bindings.reconciliation_query_digest != RECEIPT_ZERO_QUERY_DIGEST
        || bindings.query_contract_digest != RECEIPT_ZERO_QUERY_CONTRACT_DIGEST
        || bindings.parameter_order_digest != RECEIPT_ZERO_PARAMETER_ORDER_DIGEST
        || bindings.parameter_schema_digest != PARAMETER_SCHEMA_DIGEST
        || bindings.response_fields_digest != RECEIPT_ZERO_RESPONSE_FIELDS_DIGEST
    {
        return Err(FixedReadWireError::BindingMismatch);
    }
    Ok(())
}

fn parameter_values(values: &[Option<String>]) -> Vec<FixedReadParameterValue> {
    values
        .iter()
        .map(|value| match value {
            Some(value) => FixedReadParameterValue::Text(value.clone()),
            None => FixedReadParameterValue::Null,
        })
        .collect()
}

fn validate_parameter_schema(values: &[Option<String>]) -> Result<(), FixedReadWireError> {
    if values.len() != RECEIPT_ZERO_PARAMETER_COUNT {
        return Err(FixedReadWireError::InvalidRequest);
    }
    for (index, value) in values.iter().enumerate() {
        let Some(value) = value else {
            if !matches!(index, 13 | 16) {
                return Err(FixedReadWireError::InvalidRequest);
            }
            continue;
        };
        if value.is_empty()
            || value.len() > MAXIMUM_PARAMETER_STRING_BYTES
            || value.chars().any(char::is_control)
        {
            return Err(FixedReadWireError::InvalidRequest);
        }
        if RECEIPT_ZERO_PARAMETER_ORDER[index].ends_with("Digest") {
            decode_digest(value)?;
        }
        let decimal_maximum = match index {
            13..=16 => Some(POSTGRES_BIGINT_MAX_DECIMAL),
            17..=18 => Some(POSTGRES_INTEGER_MAX_DECIMAL),
            _ => None,
        };
        if decimal_maximum.is_some_and(|maximum| !bounded_decimal_text(value, maximum)) {
            return Err(FixedReadWireError::InvalidRequest);
        }
        if index == 20 && !is_canonical_rfc3339_millis(value) {
            return Err(FixedReadWireError::InvalidRequest);
        }
        if matches!(index, 11 | 26) {
            decode_standard_base64_bytes(value)?;
        }
    }
    Ok(())
}

fn bounded_decimal_text(value: &str, maximum: &str) -> bool {
    let valid_syntax = value == "0"
        || (!value.is_empty()
            && !value.starts_with('0')
            && value.bytes().all(|byte| byte.is_ascii_digit()));
    valid_syntax
        && (value.len() < maximum.len()
            || (value.len() == maximum.len() && value.as_bytes() <= maximum.as_bytes()))
}

fn is_canonical_rfc3339_millis(value: &str) -> bool {
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
        return false;
    }
    let number = |range: std::ops::Range<usize>| -> Option<u32> {
        std::str::from_utf8(&bytes[range]).ok()?.parse().ok()
    };
    let year = number(0..4).unwrap_or(0);
    let month = number(5..7).unwrap_or(0);
    let day = number(8..10).unwrap_or(0);
    let hour = number(11..13).unwrap_or(99);
    let minute = number(14..16).unwrap_or(99);
    let second = number(17..19).unwrap_or(99);
    let leap = year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    day >= 1 && day <= days && hour < 24 && minute < 60 && second < 60
}

fn decode_standard_base64_bytes(value: &str) -> Result<Vec<u8>, FixedReadWireError> {
    let bytes = STANDARD
        .decode(value)
        .map_err(|_| FixedReadWireError::InvalidRequest)?;
    if bytes.is_empty()
        || bytes.len() > MAXIMUM_CANONICAL_PARAMETER_BYTES
        || STANDARD.encode(&bytes) != value
    {
        return Err(FixedReadWireError::InvalidRequest);
    }
    Ok(bytes)
}

fn validate_embedded_backfill_v2(
    bindings: &WireBindingsV1,
    parameters: &[Option<String>],
) -> Result<(), FixedReadWireError> {
    let scope = parameters
        .get(11)
        .and_then(Option::as_deref)
        .ok_or(FixedReadWireError::InvalidRequest)?;
    let receipt = parameters
        .get(26)
        .and_then(Option::as_deref)
        .ok_or(FixedReadWireError::InvalidRequest)?;
    let scope_bytes = decode_standard_base64_bytes(scope)?;
    let receipt_bytes = decode_standard_base64_bytes(receipt)?;
    let parsed_scope: BackfillExecutionScopeV2 =
        serde_json::from_slice(&scope_bytes).map_err(|_| FixedReadWireError::InvalidRequest)?;
    let parsed_receipt: BackfillExecutionReceiptV2 =
        serde_json::from_slice(&receipt_bytes).map_err(|_| FixedReadWireError::InvalidRequest)?;
    validate_scope_v2(&parsed_scope)?;
    validate_receipt_zero_v2(&parsed_receipt)?;
    if canonical_typed_bytes(&parsed_scope)? != scope_bytes
        || canonical_typed_bytes(&parsed_receipt)? != receipt_bytes
    {
        return Err(FixedReadWireError::InvalidRequest);
    }
    let decoded = DecodedEmbeddedBackfillV2 {
        scope_digest: URL_SAFE_NO_PAD.encode(Sha256::digest(&scope_bytes)),
        receipt_digest: URL_SAFE_NO_PAD.encode(Sha256::digest(&receipt_bytes)),
        scope: parsed_scope,
        receipt: parsed_receipt,
        scope_bytes,
        receipt_bytes,
    };
    validate_embedded_crosslinks(bindings, parameters, &decoded)
}

fn canonical_typed_bytes(value: &impl Serialize) -> Result<Vec<u8>, FixedReadWireError> {
    let value = serde_json::to_value(value).map_err(|_| FixedReadWireError::InvalidRequest)?;
    serde_json::to_vec(&canonicalize_value(value)).map_err(|_| FixedReadWireError::InvalidRequest)
}

fn valid_release_identifier(value: &str) -> bool {
    let mut bytes = value.bytes();
    bytes
        .next()
        .is_some_and(|byte| byte.is_ascii_alphanumeric())
        && value.len() <= 256
        && bytes.all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'/' | b'@' | b'-')
        })
        && !contains_secret_like_material(value)
}

pub(crate) fn contains_secret_like_material(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    if has_prefixed_tail(&lower, &["sk_live_", "sk_test_", "rk_live_", "rk_test_"], 3)
        || has_prefixed_tail(&lower, &["sb_secret_"], 3)
        || has_prefixed_tail(&lower, &["github_pat_"], 8)
        || has_github_token(&lower)
        || has_slack_token(&lower)
        || has_aws_access_key(value)
        || has_jwt_shape(value)
        || has_private_key_header(&lower)
        || has_basic_or_bearer(&lower)
        || has_inline_credential_label(&lower)
        || has_credential_url(value)
    {
        return true;
    }
    high_entropy_runs(value).any(|token| {
        !is_known_opaque_non_secret(token)
            && token.bytes().any(|byte| byte.is_ascii_lowercase())
            && token.bytes().any(|byte| byte.is_ascii_uppercase())
            && token.bytes().any(|byte| byte.is_ascii_digit())
            && (token
                .bytes()
                .collect::<std::collections::HashSet<_>>()
                .len() as f64
                / token.len() as f64)
                >= 0.45
    })
}

fn has_private_key_header(value: &str) -> bool {
    [
        "-----begin private key-----",
        "-----begin ec private key-----",
        "-----begin openssh private key-----",
        "-----begin rsa private key-----",
    ]
    .iter()
    .any(|marker| value.contains(marker))
}

fn has_basic_or_bearer(value: &str) -> bool {
    fn secret_whitespace(character: char) -> bool {
        character.is_whitespace() || character == '\u{feff}'
    }

    ["basic", "bearer"].iter().any(|scheme| {
        value.match_indices(scheme).any(|(index, _)| {
            let before_is_boundary = index == 0
                || !value.as_bytes()[index - 1].is_ascii_alphanumeric()
                    && value.as_bytes()[index - 1] != b'_';
            let tail = &value[index + scheme.len()..];
            before_is_boundary
                && tail.starts_with(secret_whitespace)
                && tail
                    .trim_start_matches(secret_whitespace)
                    .bytes()
                    .take_while(|byte| {
                        byte.is_ascii_alphanumeric()
                            || matches!(byte, b'.' | b'_' | b'~' | b'+' | b'/' | b'=' | b'-')
                    })
                    .count()
                    >= 12
        })
    })
}

fn has_prefixed_tail(value: &str, prefixes: &[&str], minimum_tail: usize) -> bool {
    prefixes.iter().any(|prefix| {
        value.match_indices(prefix).any(|(index, prefix)| {
            value[index + prefix.len()..]
                .bytes()
                .take_while(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
                .count()
                >= minimum_tail
        })
    })
}

fn has_github_token(value: &str) -> bool {
    value
        .as_bytes()
        .windows(4)
        .enumerate()
        .any(|(index, head)| {
            head[0..2] == *b"gh"
                && matches!(head[2], b'p' | b'o' | b'u' | b's' | b'r')
                && head[3] == b'_'
                && value[index + 4..]
                    .bytes()
                    .take_while(|byte| byte.is_ascii_alphanumeric() || *byte == b'_')
                    .count()
                    >= 8
        })
}

fn has_slack_token(value: &str) -> bool {
    value
        .as_bytes()
        .windows(5)
        .enumerate()
        .any(|(index, head)| {
            head[0..3] == *b"xox"
                && matches!(head[3], b'b' | b'a' | b'p' | b'r' | b's')
                && head[4] == b'-'
                && value[index + 5..]
                    .bytes()
                    .take_while(|byte| byte.is_ascii_alphanumeric() || *byte == b'-')
                    .count()
                    >= 8
        })
}

fn has_aws_access_key(value: &str) -> bool {
    value.as_bytes().windows(20).any(|token| {
        matches!(&token[..4], b"AKIA" | b"ASIA")
            && token[4..]
                .iter()
                .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
    })
}

fn has_jwt_shape(value: &str) -> bool {
    fn segment_length(value: &[u8]) -> usize {
        value
            .iter()
            .take_while(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
            .count()
    }

    let bytes = value.as_bytes();
    (0..bytes.len()).any(|start| {
        let candidate = &bytes[start..];
        if !candidate.starts_with(b"eyJ")
            || (start > 0 && (bytes[start - 1].is_ascii_alphanumeric() || bytes[start - 1] == b'_'))
        {
            return false;
        }
        let first = segment_length(candidate);
        if first < 11 || candidate.get(first) != Some(&b'.') {
            return false;
        }
        let second_candidate = &candidate[first + 1..];
        let second = segment_length(second_candidate);
        if second < 11
            || !second_candidate.starts_with(b"eyJ")
            || second_candidate.get(second) != Some(&b'.')
        {
            return false;
        }
        segment_length(&second_candidate[second + 1..]) >= 8
    })
}

fn has_inline_credential_label(value: &str) -> bool {
    fn trim_pattern_whitespace(value: &str) -> &str {
        value.trim_start_matches(|character: char| {
            character.is_whitespace() || character == '\u{feff}'
        })
    }

    [
        "api_key", "api-key", "apikey", "password", "secret", "token",
    ]
    .iter()
    .any(|label| {
        value.match_indices(label).any(|(index, _)| {
            let before_is_boundary = index == 0
                || !(value.as_bytes()[index - 1].is_ascii_alphanumeric()
                    || value.as_bytes()[index - 1] == b'_');
            if !before_is_boundary {
                return false;
            }
            let remainder = trim_pattern_whitespace(&value[index + label.len()..]);
            let Some(remainder) = remainder.strip_prefix([':', '=']) else {
                return false;
            };
            let remainder = trim_pattern_whitespace(remainder);
            let remainder = remainder.strip_prefix(['"', '\'']).unwrap_or(remainder);
            remainder
                .bytes()
                .take_while(|byte| {
                    byte.is_ascii_alphanumeric()
                        || matches!(byte, b'.' | b'_' | b'~' | b'+' | b'/' | b'=' | b'-')
                })
                .count()
                >= 12
        })
    })
}

fn has_credential_url(value: &str) -> bool {
    value.match_indices("://").any(|(separator, _)| {
        let prefix = &value[..separator];
        let scheme_start = prefix
            .char_indices()
            .rev()
            .find(|(_, character)| {
                !(character.is_ascii_alphanumeric() || matches!(character, '+' | '.' | '-'))
            })
            .map_or(0, |(index, character)| index + character.len_utf8());
        let scheme = &prefix[scheme_start..];
        if !(2..=21).contains(&scheme.len())
            || !scheme.as_bytes()[0].is_ascii_alphabetic()
            || !scheme
                .bytes()
                .skip(1)
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'.' | b'-'))
        {
            return false;
        }
        value[separator + 3..]
            .split(|character: char| character == '/' || character.is_whitespace())
            .next()
            .and_then(|authority| authority.split_once('@'))
            .and_then(|(user_info, _)| user_info.split_once(':'))
            .is_some_and(|(user, password)| !user.is_empty() && !password.is_empty())
    })
}

fn high_entropy_runs(value: &str) -> impl Iterator<Item = &str> {
    value
        .split(|character: char| {
            !(character.is_ascii_alphanumeric() || matches!(character, '_' | '+' | '/' | '=' | '-'))
        })
        .filter(|token| token.len() >= 32)
}

fn is_known_opaque_non_secret(value: &str) -> bool {
    is_canonical_uuid(value) || decode_digest(value).is_ok()
}

fn is_canonical_uuid(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => *byte == b'-',
            14 => matches!(byte.to_ascii_lowercase(), b'1'..=b'5'),
            19 => matches!(byte.to_ascii_lowercase(), b'8' | b'9' | b'a' | b'b'),
            _ => byte.is_ascii_hexdigit(),
        })
}

fn valid_safe_count(value: u64) -> bool {
    value <= JAVASCRIPT_MAX_SAFE_INTEGER
}

fn validate_scope_v2(scope: &BackfillExecutionScopeV2) -> Result<(), FixedReadWireError> {
    if scope.format != SCOPE_FORMAT
        || scope.version != BACKFILL_V2_VERSION
        || scope.provider_id != PROVIDER_ID
        || scope.environment != ENVIRONMENT
        || scope.cursor_field_type != "integer"
        || scope.resume_policy != RESUME_POLICY
        || scope.completion_rule != COMPLETION_RULE
        || scope.maximum_receipt_count != MAXIMUM_RECEIPT_COUNT
        || scope.maximum_batch_count != MAXIMUM_BATCH_COUNT
        || !(1..=MAXIMUM_BATCH_SIZE).contains(&scope.batch_size)
        || ![
            &scope.application_id,
            &scope.migration_id,
            &scope.entity_id,
            &scope.cursor_field,
            &scope.target_field,
        ]
        .into_iter()
        .all(|value| valid_release_identifier(value))
    {
        return Err(FixedReadWireError::InvalidRequest);
    }
    for digest in [
        &scope.provider_authority_digest,
        &scope.application_digest,
        &scope.migration_digest,
        &scope.migration_plan_digest,
        &scope.source_ledger_digest,
        &scope.capture_digest,
        &scope.receipt_zero_evidence_digest,
        &scope.resource_identity_digest,
        &scope.catalog_precondition_digest,
    ] {
        decode_digest(digest)?;
    }
    if scope.capture_digest != scope.receipt_zero_evidence_digest
        || ![
            scope.captured_high_water.unwrap_or(0),
            scope.initial_remaining_eligible_row_count,
            scope.initial_remaining_target_row_count,
            scope.required_batch_count,
            scope.required_matched_row_count.unwrap_or(0),
        ]
        .into_iter()
        .all(valid_safe_count)
        || (scope.captured_high_water.is_none()
            && (scope.initial_remaining_eligible_row_count != 0
                || scope.initial_remaining_target_row_count != 0))
        || scope.initial_remaining_target_row_count > scope.initial_remaining_eligible_row_count
        || scope
            .required_matched_row_count
            .is_some_and(|required| required > scope.initial_remaining_target_row_count)
    {
        return Err(FixedReadWireError::InvalidRequest);
    }
    let expected_batch_count = scope
        .initial_remaining_eligible_row_count
        .div_ceil(scope.batch_size);
    if expected_batch_count > MAXIMUM_BATCH_COUNT
        || scope.required_batch_count != expected_batch_count
    {
        return Err(FixedReadWireError::InvalidRequest);
    }
    Ok(())
}

fn validate_counts(counts: &BackfillExecutionCountsV2) -> Result<(), FixedReadWireError> {
    if ![
        counts.scanned_row_count,
        counts.matched_row_count,
        counts.updated_row_count,
    ]
    .into_iter()
    .all(valid_safe_count)
        || counts.matched_row_count > counts.scanned_row_count
        || counts.updated_row_count > counts.matched_row_count
    {
        return Err(FixedReadWireError::InvalidRequest);
    }
    Ok(())
}

fn validate_receipt_zero_v2(
    receipt: &BackfillExecutionReceiptV2,
) -> Result<(), FixedReadWireError> {
    validate_scope_v2(&receipt.scope)?;
    validate_counts(&receipt.batch_counts)?;
    validate_counts(&receipt.cumulative_counts)?;
    if receipt.format != RECEIPT_FORMAT
        || receipt.version != BACKFILL_V2_VERSION
        || ![
            &receipt.receipt_id,
            &receipt.execution_id,
            &receipt.idempotency_key,
            &receipt.database_event_id,
        ]
        .into_iter()
        .all(|value| valid_release_identifier(value))
        || receipt
            .stable_error_code
            .as_deref()
            .is_some_and(|value| !valid_release_identifier(value))
        || !is_canonical_rfc3339_millis(&receipt.committed_at)
        || ![
            receipt.batch_index,
            receipt.previous_cursor.unwrap_or(0),
            receipt.last_processed_key.unwrap_or(0),
            receipt.exhaustion.remaining_eligible_row_count.unwrap_or(0),
            receipt.exhaustion.remaining_target_row_count.unwrap_or(0),
            receipt
                .postconditions
                .required_matched_row_count
                .unwrap_or(0),
            receipt.database_head_version,
        ]
        .into_iter()
        .all(valid_safe_count)
    {
        return Err(FixedReadWireError::InvalidRequest);
    }
    for digest in [
        &receipt.request_digest,
        &receipt.scope_digest,
        &receipt.catalog_evidence_digest,
        &receipt.operation_authority_digest,
        &receipt.evidence_digest,
    ] {
        decode_digest(digest)?;
    }
    if let Some(previous) = &receipt.previous_receipt_digest {
        decode_digest(previous)?;
    }

    if receipt.exhaustion.checked != receipt.exhaustion.remaining_eligible_row_count.is_some()
        || receipt.exhaustion.checked != receipt.exhaustion.remaining_target_row_count.is_some()
        || receipt
            .exhaustion
            .remaining_target_row_count
            .zip(receipt.exhaustion.remaining_eligible_row_count)
            .is_some_and(|(target, eligible)| target > eligible)
        || !matches!(
            receipt.checkpoint_kind.as_str(),
            "capture" | "batch" | "failure"
        )
        || !matches!(
            receipt.outcome.as_str(),
            "in-progress" | "completed" | "failed"
        )
        || receipt.terminal_reason.as_deref().is_some_and(|reason| {
            !matches!(
                reason,
                "already-satisfied" | "predicate-exhausted" | "stable-failure"
            )
        })
    {
        return Err(FixedReadWireError::InvalidRequest);
    }
    let terminal_shape_valid = match receipt.outcome.as_str() {
        "in-progress" => receipt.terminal_reason.is_none() && receipt.stable_error_code.is_none(),
        "completed" => {
            matches!(
                receipt.terminal_reason.as_deref(),
                Some("already-satisfied" | "predicate-exhausted")
            ) && receipt.stable_error_code.is_none()
        }
        "failed" => {
            receipt.terminal_reason.as_deref() == Some("stable-failure")
                && receipt.stable_error_code.is_some()
        }
        _ => false,
    };
    if !terminal_shape_valid
        || (receipt.checkpoint_kind == "failure" && receipt.outcome != "failed")
    {
        return Err(FixedReadWireError::InvalidRequest);
    }

    let required = receipt.scope.required_matched_row_count;
    let expected_matched =
        required.is_none_or(|value| receipt.cumulative_counts.matched_row_count >= value);
    let expected_field_not_null =
        receipt.exhaustion.remaining_target_row_count == Some(0) && receipt.exhaustion.checked;
    if receipt.postconditions.required_matched_row_count != required
        || receipt.postconditions.matched_row_count_satisfied != expected_matched
        || receipt.postconditions.field_not_null != expected_field_not_null
        || receipt.checkpoint_kind != "capture"
        || receipt.batch_index != 0
        || receipt.database_head_version != 1
        || receipt.previous_receipt_digest.is_some()
        || receipt.previous_cursor.is_some()
        || receipt.last_processed_key.is_some()
        || !receipt.batch_counts.is_zero()
        || !receipt.cumulative_counts.is_zero()
        || !receipt.exhaustion.checked
        || receipt.exhaustion.remaining_eligible_row_count
            != Some(receipt.scope.initial_remaining_eligible_row_count)
        || receipt.exhaustion.remaining_target_row_count
            != Some(receipt.scope.initial_remaining_target_row_count)
        || receipt.evidence_digest != receipt.scope.receipt_zero_evidence_digest
        || receipt.catalog_evidence_digest != receipt.scope.catalog_precondition_digest
        || receipt.outcome == "failed"
    {
        return Err(FixedReadWireError::InvalidRequest);
    }

    let initially_satisfied = receipt.scope.initial_remaining_target_row_count == 0
        && receipt.postconditions.field_not_null
        && receipt.postconditions.matched_row_count_satisfied;
    match receipt.outcome.as_str() {
        "completed"
            if initially_satisfied
                && receipt.terminal_reason.as_deref() == Some("already-satisfied") => {}
        "in-progress"
            if !initially_satisfied
                && receipt.scope.captured_high_water.is_some()
                && receipt.scope.initial_remaining_target_row_count > 0
                && receipt.terminal_reason.is_none() => {}
        _ => return Err(FixedReadWireError::InvalidRequest),
    }
    Ok(())
}

fn parameter_text<'a>(
    parameters: &'a [Option<String>],
    index: usize,
) -> Result<&'a str, FixedReadWireError> {
    parameters
        .get(index)
        .and_then(Option::as_deref)
        .ok_or(FixedReadWireError::BindingMismatch)
}

fn parameter_matches_optional_count(
    parameters: &[Option<String>],
    index: usize,
    value: Option<u64>,
) -> bool {
    parameters.get(index) == Some(&value.map(|value| value.to_string()))
}

fn validate_embedded_crosslinks(
    bindings: &WireBindingsV1,
    parameters: &[Option<String>],
    decoded: &DecodedEmbeddedBackfillV2,
) -> Result<(), FixedReadWireError> {
    let scope = &decoded.scope;
    let receipt = &decoded.receipt;
    let initial_status = if receipt.outcome == "completed" {
        "completed"
    } else {
        "running"
    };
    if receipt.scope != *scope
        || receipt.scope_digest != decoded.scope_digest
        || bindings.scope_digest != decoded.scope_digest
        || bindings.receipt_digest != decoded.receipt_digest
        || receipt.operation_authority_digest != bindings.candidate_operation_evidence_digest
        || parameter_text(parameters, 0)? != receipt.execution_id
        || parameter_text(parameters, 1)? != scope.application_id
        || parameter_text(parameters, 2)? != scope.application_digest
        || parameter_text(parameters, 3)? != scope.migration_id
        || parameter_text(parameters, 4)? != scope.migration_digest
        || parameter_text(parameters, 5)? != scope.migration_plan_digest
        || parameter_text(parameters, 6)? != scope.provider_authority_digest
        || parameter_text(parameters, 7)? != scope.source_ledger_digest
        || parameter_text(parameters, 8)? != decoded.scope_digest
        || parameter_text(parameters, 9)? != scope.resource_identity_digest
        || parameter_text(parameters, 10)? != scope.catalog_precondition_digest
        || parameter_text(parameters, 11)? != STANDARD.encode(&decoded.scope_bytes)
        || parameter_text(parameters, 12)? != scope.capture_digest
        || !parameter_matches_optional_count(parameters, 13, scope.captured_high_water)
        || parameter_text(parameters, 14)? != scope.initial_remaining_eligible_row_count.to_string()
        || parameter_text(parameters, 15)? != scope.initial_remaining_target_row_count.to_string()
        || !parameter_matches_optional_count(parameters, 16, scope.required_matched_row_count)
        || parameter_text(parameters, 17)? != scope.required_batch_count.to_string()
        || parameter_text(parameters, 18)? != scope.batch_size.to_string()
        || parameter_text(parameters, 19)? != initial_status
        || parameter_text(parameters, 20)? != receipt.committed_at
        || parameter_text(parameters, 21)? != receipt.database_event_id
        || parameter_text(parameters, 22)? != receipt.receipt_id
        || parameter_text(parameters, 23)? != receipt.idempotency_key
        || parameter_text(parameters, 24)? != receipt.request_digest
        || parameter_text(parameters, 25)? != decoded.receipt_digest
        || parameter_text(parameters, 26)? != STANDARD.encode(&decoded.receipt_bytes)
        || parameter_text(parameters, 27)? != receipt.operation_authority_digest
    {
        return Err(FixedReadWireError::BindingMismatch);
    }
    Ok(())
}

fn validate_parameter_cross_bindings(
    bindings: &WireBindingsV1,
    parameters: &[FixedReadParameterValue],
) -> Result<(), FixedReadWireError> {
    let matches = |index: usize, expected: &str| {
        matches!(
            parameters.get(index),
            Some(FixedReadParameterValue::Text(actual)) if actual == expected
        )
    };
    if !matches(8, &bindings.scope_digest)
        || !matches(25, &bindings.receipt_digest)
        || !matches(27, &bindings.candidate_operation_evidence_digest)
    {
        return Err(FixedReadWireError::BindingMismatch);
    }
    Ok(())
}

fn decode_digest(value: &str) -> Result<[u8; 32], FixedReadWireError> {
    if value.len() != 43
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    {
        return Err(FixedReadWireError::InvalidRequest);
    }
    let decoded = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| FixedReadWireError::InvalidRequest)?;
    let digest: [u8; 32] = decoded
        .try_into()
        .map_err(|_| FixedReadWireError::InvalidRequest)?;
    if URL_SAFE_NO_PAD.encode(digest) != value {
        return Err(FixedReadWireError::InvalidRequest);
    }
    Ok(digest)
}

fn canonical_request_digest(request: &WireRequestV1) -> Result<[u8; 32], FixedReadWireError> {
    let mut request_value =
        serde_json::to_value(request).map_err(|_| FixedReadWireError::InvalidRequest)?;
    request_value
        .as_object_mut()
        .ok_or(FixedReadWireError::InvalidRequest)?
        .remove("requestDigest")
        .ok_or(FixedReadWireError::InvalidRequest)?;
    let mut envelope = Map::new();
    envelope.insert(
        "format".to_owned(),
        Value::String(REQUEST_DIGEST_FORMAT.to_owned()),
    );
    envelope.insert("version".to_owned(), Value::from(1));
    envelope.insert("request".to_owned(), request_value);
    digest_canonical_value(Value::Object(envelope))
}

fn digest_canonical_value(value: Value) -> Result<[u8; 32], FixedReadWireError> {
    let canonical = canonicalize_value(value);
    let bytes = serde_json::to_vec(&canonical).map_err(|_| FixedReadWireError::InvalidRequest)?;
    Ok(<[u8; 32]>::from(Sha256::digest(bytes)))
}

fn canonicalize_value(value: Value) -> Value {
    match value {
        Value::Array(values) => Value::Array(values.into_iter().map(canonicalize_value).collect()),
        Value::Object(values) => {
            let mut entries: Vec<_> = values.into_iter().collect();
            entries.sort_by(|left, right| compare_utf16_keys(&left.0, &right.0));
            let mut sorted = Map::new();
            for (key, value) in entries {
                sorted.insert(key, canonicalize_value(value));
            }
            Value::Object(sorted)
        }
        scalar => scalar,
    }
}

fn compare_utf16_keys(left: &str, right: &str) -> std::cmp::Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

#[derive(PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct HostFixedReadIdentityV1 {
    project_ref: String,
    account_id: String,
    grant_generation: String,
    read_credential_incarnation: [u8; 32],
    connection_profile_digest: [u8; 32],
}

impl HostFixedReadIdentityV1 {
    fn checked(
        project_ref: String,
        account_id: String,
        grant_generation: String,
        read_credential_incarnation: [u8; 32],
        connection_profile_digest: [u8; 32],
    ) -> Result<Self, FixedReadWireError> {
        let mut account_bytes = account_id.bytes();
        let valid_account = account_bytes
            .next()
            .is_some_and(|byte| byte.is_ascii_alphanumeric())
            && account_bytes
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'));
        if project_ref.len() != 20
            || !project_ref.bytes().all(|byte| byte.is_ascii_lowercase())
            || account_id.is_empty()
            || account_id.len() > 128
            || !valid_account
            || !is_canonical_uuid_v4(&grant_generation)
            || read_credential_incarnation == [0; 32]
            || connection_profile_digest == [0; 32]
        {
            return Err(FixedReadWireError::InvalidHostEvidence);
        }
        Ok(Self {
            project_ref,
            account_id,
            grant_generation,
            read_credential_incarnation,
            connection_profile_digest,
        })
    }

    fn into_connection_identity(self) -> Result<FixedReadConnectionIdentityV1, FixedReadError> {
        FixedReadConnectionIdentityV1::checked(
            self.project_ref,
            self.account_id,
            self.grant_generation,
            self.read_credential_incarnation,
            self.connection_profile_digest,
        )
    }
}

fn is_canonical_uuid_v4(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes[8] == b'-'
        && bytes[13] == b'-'
        && bytes[18] == b'-'
        && bytes[23] == b'-'
        && bytes[14] == b'4'
        && matches!(bytes[19], b'8' | b'9' | b'a' | b'b')
        && bytes.iter().enumerate().all(|(index, byte)| {
            matches!(index, 8 | 13 | 18 | 23)
                || byte.is_ascii_digit()
                || matches!(byte, b'a'..=b'f')
        })
}

/// Non-cloneable, non-debuggable capability value. Only a future trusted native registry may
/// construct it. In particular, derived `Debug` must not expose Host identity or credential
/// incarnation material through an error or diagnostic path.
pub(super) struct HostFixedReadEvidenceV1 {
    bindings: WireBindingsV1,
    parameters: Vec<FixedReadParameterValue>,
    identity: HostFixedReadIdentityV1,
    evidence_digest: [u8; 32],
}

/// Opaque, process-local proof that one exact Receipt-zero CAS operation is eligible for its
/// read-only reconciliation step. The real producer intentionally does not exist in this dormant
/// slice: only the future native Receipt-zero durable operation may create this value.
///
/// Deliberately not `Clone`, `Debug`, `Serialize`, or `Deserialize`.
pub(super) struct ReceiptZeroReconciliationAuthorityV1 {
    authority_id: [u8; SESSION_ID_BYTES],
}

/// Trusted values retained by the native operation, rather than reconstructed from renderer
/// digests. Removal from the issuer registry turns this into the consumed upstream authority.
struct ReceiptZeroReconciliationAuthorityEntryV1 {
    request_digest: [u8; 32],
    bindings: WireBindingsV1,
    parameters: Vec<FixedReadParameterValue>,
    identity: HostFixedReadIdentityV1,
    expires_at: Duration,
}

/// Private production-facing consumption seam. It has no production mint API until the native
/// Receipt-zero CAS durable operation exists. In particular, a renderer cannot turn a recomputed
/// request or operation digest into an entry in this registry.
///
/// Deliberately not `Clone`, `Debug`, `Serialize`, or `Deserialize`.
pub(super) struct HostFixedReadEvidenceIssuerV1 {
    entries: Mutex<HashMap<[u8; SESSION_ID_BYTES], ReceiptZeroReconciliationAuthorityEntryV1>>,
    entropy: Arc<dyn SessionEntropy>,
    clock: Arc<dyn SessionClock>,
    maximum_authorities: usize,
    ttl: Duration,
    #[cfg(test)]
    before_entries_lock: Mutex<Option<Arc<std::sync::Barrier>>>,
}

impl HostFixedReadEvidenceIssuerV1 {
    pub(super) fn new() -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            entropy: Arc::new(SystemSessionEntropy(SystemRandom::new())),
            clock: Arc::new(SystemSessionClock {
                origin: Instant::now(),
            }),
            maximum_authorities: MAXIMUM_LIVE_SESSIONS,
            ttl: OPERATION_AUTHORITY_TTL,
            #[cfg(test)]
            before_entries_lock: Mutex::new(None),
        }
    }

    /// Atomically consumes the upstream operation authority before comparing any candidate or
    /// credential value. A renderer-controlled mismatch therefore burns the authority and cannot be
    /// retried with a later self-consistent digest.
    pub(super) fn issue(
        &self,
        authority: &ReceiptZeroReconciliationAuthorityV1,
        candidate: &DecodedFixedReadRequestV1,
        credential_snapshot: &DatabaseReadCredentialSnapshotV1,
    ) -> Result<HostFixedReadEvidenceV1, FixedReadWireError> {
        #[cfg(test)]
        self.wait_before_entries_lock_for_test()?;
        let entry = {
            self.entries
                .lock()
                .map_err(|_| FixedReadWireError::RegistryUnavailable)?
                .remove(&authority.authority_id)
                .ok_or(FixedReadWireError::OperationAuthorityMissing)?
        };
        // Removal/burn happens before sampling time or comparing any retained/caller value. A
        // consumer delayed on the registry lock therefore cannot use a stale pre-wait timestamp.
        let now = self.clock.now();
        if entry.expires_at <= now {
            return Err(FixedReadWireError::OperationAuthorityExpired);
        }

        if candidate.request_digest != entry.request_digest
            || candidate.bindings != entry.bindings
            || candidate.parameters != entry.parameters
            || credential_snapshot.connection_profile().project_ref()
                != entry.identity.project_ref.as_str()
            || credential_snapshot.connection_profile().account_id()
                != entry.identity.account_id.as_str()
            || credential_snapshot.grant_generation() != entry.identity.grant_generation
            || credential_snapshot.credential_incarnation()
                != entry.identity.read_credential_incarnation
            || credential_snapshot.connection_profile_digest()
                != entry.identity.connection_profile_digest
        {
            return Err(FixedReadWireError::OperationAuthorityMismatch);
        }

        checked_host_fixed_read_evidence(entry.bindings, entry.parameters, entry.identity)
    }

    /// Test-only stand-in for the missing native Receipt-zero durable operation. Production code
    /// cannot populate this registry from renderer-supplied fields or digests.
    #[cfg(test)]
    fn authorize_for_test(
        &self,
        trusted_operation: DecodedFixedReadRequestV1,
        project_ref: String,
        account_id: String,
        grant_generation: String,
        read_credential_incarnation: [u8; 32],
        connection_profile_digest: [u8; 32],
    ) -> Result<ReceiptZeroReconciliationAuthorityV1, FixedReadWireError> {
        let identity = HostFixedReadIdentityV1::checked(
            project_ref,
            account_id,
            grant_generation,
            read_credential_incarnation,
            connection_profile_digest,
        )?;
        self.wait_before_entries_lock_for_test()?;
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| FixedReadWireError::RegistryUnavailable)?;
        // TTL starts only after this operation owns the registry lock. Time spent queued behind a
        // prior registry operation must not shorten or immediately expire the newly minted entry.
        let now = self.clock.now();
        entries.retain(|_, entry| entry.expires_at > now);
        let expires_at = now
            .checked_add(self.ttl)
            .ok_or(FixedReadWireError::InvalidHostEvidence)?;
        if entries.len() >= self.maximum_authorities {
            return Err(FixedReadWireError::RegistryFull);
        }
        for _ in 0..SESSION_ID_ATTEMPTS {
            let authority_id = self.entropy.session_id_bytes()?;
            if entries.contains_key(&authority_id) {
                continue;
            }
            entries.insert(
                authority_id,
                ReceiptZeroReconciliationAuthorityEntryV1 {
                    request_digest: trusted_operation.request_digest,
                    bindings: trusted_operation.bindings,
                    parameters: trusted_operation.parameters,
                    identity,
                    expires_at,
                },
            );
            return Ok(ReceiptZeroReconciliationAuthorityV1 { authority_id });
        }
        Err(FixedReadWireError::SessionIdCollision)
    }

    #[cfg(test)]
    fn with_test_entropy(
        maximum_authorities: usize,
        ttl: Duration,
        entropy: Arc<dyn SessionEntropy>,
        clock: Arc<dyn SessionClock>,
    ) -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            entropy,
            clock,
            maximum_authorities,
            ttl,
            before_entries_lock: Mutex::new(None),
        }
    }

    #[cfg(test)]
    fn set_before_entries_lock_for_test(
        &self,
        barrier: Arc<std::sync::Barrier>,
    ) -> Result<(), FixedReadWireError> {
        let mut hook = self
            .before_entries_lock
            .lock()
            .map_err(|_| FixedReadWireError::RegistryUnavailable)?;
        if hook.is_some() {
            return Err(FixedReadWireError::RegistryUnavailable);
        }
        *hook = Some(barrier);
        Ok(())
    }

    #[cfg(test)]
    fn wait_before_entries_lock_for_test(&self) -> Result<(), FixedReadWireError> {
        let barrier = self
            .before_entries_lock
            .lock()
            .map_err(|_| FixedReadWireError::RegistryUnavailable)?
            .take();
        if let Some(barrier) = barrier {
            barrier.wait();
        }
        Ok(())
    }
}

fn checked_host_fixed_read_evidence(
    bindings: WireBindingsV1,
    parameters: Vec<FixedReadParameterValue>,
    identity: HostFixedReadIdentityV1,
) -> Result<HostFixedReadEvidenceV1, FixedReadWireError> {
    validate_bindings(&bindings)?;
    let wire_parameters: Vec<Option<String>> = parameters
        .iter()
        .map(|value| match value {
            FixedReadParameterValue::Text(value) => Some(value.clone()),
            FixedReadParameterValue::Null => None,
        })
        .collect();
    validate_parameter_schema(&wire_parameters)?;
    validate_parameter_cross_bindings(&bindings, &parameters)?;
    validate_embedded_backfill_v2(&bindings, &wire_parameters)?;
    let parameter_values_digest = decode_digest(&bindings.parameter_values_digest)?;
    ReceiptZeroFixedReadContractV1::checked(
        &bindings.reconciliation_sql_digest,
        &bindings.reconciliation_query_digest,
        &bindings.query_contract_digest,
        &bindings.parameter_order_digest,
        &bindings.response_fields_digest,
        parameter_values_digest,
        parameters.clone(),
    )
    .map_err(|_| FixedReadWireError::InvalidHostEvidence)?;
    let evidence_digest = digest_host_evidence(&bindings, &parameters, &identity)?;
    Ok(HostFixedReadEvidenceV1 {
        bindings,
        parameters,
        identity,
        evidence_digest,
    })
}

#[cfg(test)]
impl HostFixedReadEvidenceV1 {
    fn checked(
        bindings: WireBindingsV1,
        parameters: Vec<FixedReadParameterValue>,
        project_ref: String,
        account_id: String,
        grant_generation: String,
        read_credential_incarnation: [u8; 32],
        connection_profile_digest: [u8; 32],
    ) -> Result<Self, FixedReadWireError> {
        let identity = HostFixedReadIdentityV1::checked(
            project_ref,
            account_id,
            grant_generation,
            read_credential_incarnation,
            connection_profile_digest,
        )?;
        checked_host_fixed_read_evidence(bindings, parameters, identity)
    }
}

fn digest_host_evidence(
    bindings: &WireBindingsV1,
    parameters: &[FixedReadParameterValue],
    identity: &HostFixedReadIdentityV1,
) -> Result<[u8; 32], FixedReadWireError> {
    let value = serde_json::json!({
        "bindings": bindings,
        "format": "openpencil.supabase-backfill-native-host-evidence.v1",
        "identity": identity,
        "parameters": parameters,
        "version": 1
    });
    digest_canonical_value(value)
}

trait SessionEntropy: Send + Sync {
    fn session_id_bytes(&self) -> Result<[u8; SESSION_ID_BYTES], FixedReadWireError>;
}

struct SystemSessionEntropy(SystemRandom);

impl SessionEntropy for SystemSessionEntropy {
    fn session_id_bytes(&self) -> Result<[u8; SESSION_ID_BYTES], FixedReadWireError> {
        let mut bytes = [0_u8; SESSION_ID_BYTES];
        self.0
            .fill(&mut bytes)
            .map_err(|_| FixedReadWireError::SessionEntropyUnavailable)?;
        Ok(bytes)
    }
}

trait SessionClock: Send + Sync {
    fn now(&self) -> Duration;
}

struct SystemSessionClock {
    origin: Instant,
}

impl SessionClock for SystemSessionClock {
    fn now(&self) -> Duration {
        self.origin.elapsed()
    }
}

struct SessionEntryV1 {
    request_digest: [u8; 32],
    contract: ReceiptZeroFixedReadContractV1,
    host_identity: HostFixedReadIdentityV1,
    host_evidence_digest: [u8; 32],
    expires_at: Duration,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct DormantFixedReadAuthorityV1 {
    production_transport_created: bool,
    production_transport_authenticated: bool,
    production_request_dispatch_authenticated: bool,
    adapter_authenticated: bool,
    dynamic_bindings_authenticated: bool,
    read_only_boundary_authenticated: bool,
    configured_search_path_authenticated: bool,
    live_catalog_semantics_authenticated: bool,
    server_statement_timeout_authenticated: bool,
    server_cancellation_authenticated: bool,
    single_statement_snapshot_authenticated: bool,
    credential_authority_created: bool,
    transport_authority_created: bool,
    database_authority_created: bool,
    mutation_authority_created: bool,
    execution_authority_created: bool,
    receipt_authority_created: bool,
    release_authority_created: bool,
    release_ready: bool,
}

impl DormantFixedReadAuthorityV1 {
    const NONE: Self = Self {
        production_transport_created: false,
        production_transport_authenticated: false,
        production_request_dispatch_authenticated: false,
        adapter_authenticated: false,
        dynamic_bindings_authenticated: false,
        read_only_boundary_authenticated: false,
        configured_search_path_authenticated: false,
        live_catalog_semantics_authenticated: false,
        server_statement_timeout_authenticated: false,
        server_cancellation_authenticated: false,
        single_statement_snapshot_authenticated: false,
        credential_authority_created: false,
        transport_authority_created: false,
        database_authority_created: false,
        mutation_authority_created: false,
        execution_authority_created: false,
        receipt_authority_created: false,
        release_authority_created: false,
        release_ready: false,
    };
}

#[derive(PartialEq, Eq)]
pub(super) struct FixedReadSessionHandleV1 {
    session_id: String,
    request_digest: [u8; 32],
    authority: DormantFixedReadAuthorityV1,
}

mod host_fixed_read_database_connector {
    /// Seals the connector seam inside this reviewed native module. A renderer, plugin, sibling
    /// module, or arbitrary database-session implementation cannot become a connector merely by
    /// implementing the public execution trait.
    pub trait Sealed {}
}

/// Host-only database-session factory. The connector receives only the validated profile and exact
/// zeroizing vault password retained by the consumed one-shot session. It has no SQL, endpoint,
/// identity, option, or caller-selected override argument. Its connect future must be safe to drop,
/// must not detach background work, and must retain any needed cancellation handle outside that
/// future. This dormant seam does not claim real server-side cancellation or wall-clock timing.
pub(super) trait HostFixedReadDatabaseConnectorV1:
    host_fixed_read_database_connector::Sealed + Sync
{
    type Session: FixedReadDatabaseSession + Send;
    type InterruptSource: FixedReadInterruptSourceV1;

    fn interrupt_source(&self) -> &Self::InterruptSource;

    fn connect<'a>(
        &'a self,
        profile: &'a SupabaseDatabaseReadConnectionProfileV1,
        password: &'a str,
        control: FixedReadStageControlV1<'a>,
    ) -> impl Future<Output = Result<Self::Session, FixedReadDatabaseFailure>> + Send + 'a;
}

pub(super) struct ConsumedFixedReadSessionV1 {
    request_digest: [u8; 32],
    host_identity: HostFixedReadIdentityV1,
    credential_snapshot: DatabaseReadCredentialSnapshotV1,
    session: ReceiptZeroFixedReadSessionV1,
    authority: DormantFixedReadAuthorityV1,
}

/// Result of driving the fixed statement through the identity retained by the consumed registry
/// entry. It deliberately does not echo Host identity or credential-incarnation metadata.
pub(super) struct ConsumedFixedReadResultV1 {
    pub(super) request_digest: [u8; 32],
    pub(super) fixed_read: FixedReadResultV1,
    pub(super) authority: DormantFixedReadAuthorityV1,
}

impl ConsumedFixedReadSessionV1 {
    /// Consumes the registry-issued session by value. The caller can provide only the sealed Host
    /// connector. That connector must create the database session from the exact validated profile
    /// and password moved out of the atomic vault snapshot and owns the sealed interruption source;
    /// no caller can provide a preconstructed database session, deadline, cancellation source, or
    /// second connection identity.
    pub(super) async fn run<D: HostFixedReadDatabaseConnectorV1>(
        self,
        connector: &D,
    ) -> Result<ConsumedFixedReadResultV1, FixedReadError> {
        let Self {
            request_digest,
            host_identity,
            credential_snapshot,
            session,
            authority,
        } = self;
        if authority != DormantFixedReadAuthorityV1::NONE {
            return Err(FixedReadError::InvalidContract);
        }
        let execution = FixedReadExecutionControlV1::start(connector.interrupt_source())?;
        let connection_identity = host_identity.into_connection_identity()?;
        let connect_control = execution.connect();
        let database = match race_fixed_read_future(
            connector.connect(
                credential_snapshot.connection_profile(),
                credential_snapshot.password(),
                connect_control,
            ),
            connect_control,
        )
        .await
        {
            Ok(Ok(database)) => database,
            Ok(Err(FixedReadDatabaseFailure::Cancelled)) => {
                return Err(FixedReadError::Cancelled);
            }
            Ok(Err(failure)) => {
                return Err(FixedReadError::Database {
                    stage: FixedReadStage::Connect,
                    failure,
                });
            }
            Err(interruption) => {
                return Err(interruption_error(FixedReadStage::Connect, interruption));
            }
        };
        // A successful connector owns everything it needs for the session. Drop the vault snapshot
        // now so the exact password is zeroized before catalog execution begins.
        drop(credential_snapshot);
        let fixed_read = session
            .run(database, &connection_identity, &execution)
            .await?;
        Ok(ConsumedFixedReadResultV1 {
            request_digest,
            fixed_read,
            authority: DormantFixedReadAuthorityV1::NONE,
        })
    }
}

pub(super) struct HostFixedReadSessionRegistryV1 {
    entries: Mutex<HashMap<String, SessionEntryV1>>,
    entropy: Arc<dyn SessionEntropy>,
    clock: Arc<dyn SessionClock>,
    maximum_sessions: usize,
    ttl: Duration,
    #[cfg(test)]
    before_entries_lock: Mutex<Option<Arc<std::sync::Barrier>>>,
}

impl HostFixedReadSessionRegistryV1 {
    pub(super) fn new() -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            entropy: Arc::new(SystemSessionEntropy(SystemRandom::new())),
            clock: Arc::new(SystemSessionClock {
                origin: Instant::now(),
            }),
            maximum_sessions: MAXIMUM_LIVE_SESSIONS,
            ttl: SESSION_TTL,
            #[cfg(test)]
            before_entries_lock: Mutex::new(None),
        }
    }

    pub(super) fn prepare(
        &self,
        candidate: DecodedFixedReadRequestV1,
        evidence: HostFixedReadEvidenceV1,
    ) -> Result<FixedReadSessionHandleV1, FixedReadWireError> {
        if candidate.bindings != evidence.bindings || candidate.parameters != evidence.parameters {
            return Err(FixedReadWireError::HostEvidenceMismatch);
        }
        #[cfg(test)]
        self.wait_before_entries_lock_for_test()?;
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| FixedReadWireError::RegistryUnavailable)?;
        // TTL starts only after this operation owns the registry lock. Time spent queued behind a
        // prior registry operation must not shorten or immediately expire the newly minted entry.
        let now = self.clock.now();
        let expires_at = now
            .checked_add(self.ttl)
            .ok_or(FixedReadWireError::InvalidHostEvidence)?;
        entries.retain(|_, entry| entry.expires_at > now);
        if entries.len() >= self.maximum_sessions {
            return Err(FixedReadWireError::RegistryFull);
        }
        for _ in 0..SESSION_ID_ATTEMPTS {
            let session_id = self.generate_session_id()?;
            if entries.contains_key(&session_id) {
                continue;
            }
            entries.insert(
                session_id.clone(),
                SessionEntryV1 {
                    request_digest: candidate.request_digest,
                    contract: candidate.contract,
                    host_identity: evidence.identity,
                    host_evidence_digest: evidence.evidence_digest,
                    expires_at,
                },
            );
            return Ok(FixedReadSessionHandleV1 {
                session_id,
                request_digest: candidate.request_digest,
                authority: DormantFixedReadAuthorityV1::NONE,
            });
        }
        Err(FixedReadWireError::SessionIdCollision)
    }

    pub(super) fn consume(
        &self,
        session_id: &str,
        credential_snapshot: DatabaseReadCredentialSnapshotV1,
    ) -> Result<ConsumedFixedReadSessionV1, FixedReadWireError> {
        // Validate the opaque capability before touching the registry. This rejects malformed,
        // padded, non-canonical, and non-32-byte encodings without turning them into lookup keys.
        decode_digest(session_id)?;
        #[cfg(test)]
        self.wait_before_entries_lock_for_test()?;
        let entry = {
            self.entries
                .lock()
                .map_err(|_| FixedReadWireError::RegistryUnavailable)?
                .remove(session_id)
                .ok_or(FixedReadWireError::SessionMissing)?
        };
        // Removal/burn happens before sampling time or validating any retained/caller value. A
        // consumer delayed on the registry lock therefore cannot use a stale pre-wait timestamp.
        let now = self.clock.now();
        if entry.expires_at <= now {
            return Err(FixedReadWireError::SessionExpired);
        }
        if entry.host_identity.grant_generation != credential_snapshot.grant_generation()
            || entry.host_identity.read_credential_incarnation
                != credential_snapshot.credential_incarnation()
            || entry.host_identity.connection_profile_digest
                != credential_snapshot.connection_profile_digest()
            || entry.host_identity.project_ref
                != credential_snapshot.connection_profile().project_ref()
            || entry.host_identity.account_id
                != credential_snapshot.connection_profile().account_id()
        {
            return Err(FixedReadWireError::HostEvidenceMismatch);
        }
        Ok(ConsumedFixedReadSessionV1 {
            request_digest: entry.request_digest,
            host_identity: entry.host_identity,
            credential_snapshot,
            session: ReceiptZeroFixedReadSessionV1::new(entry.contract),
            authority: DormantFixedReadAuthorityV1::NONE,
        })
    }

    fn generate_session_id(&self) -> Result<String, FixedReadWireError> {
        let bytes = self.entropy.session_id_bytes()?;
        Ok(URL_SAFE_NO_PAD.encode(bytes))
    }

    #[cfg(test)]
    fn set_before_entries_lock_for_test(
        &self,
        barrier: Arc<std::sync::Barrier>,
    ) -> Result<(), FixedReadWireError> {
        let mut hook = self
            .before_entries_lock
            .lock()
            .map_err(|_| FixedReadWireError::RegistryUnavailable)?;
        if hook.is_some() {
            return Err(FixedReadWireError::RegistryUnavailable);
        }
        *hook = Some(barrier);
        Ok(())
    }

    #[cfg(test)]
    fn wait_before_entries_lock_for_test(&self) -> Result<(), FixedReadWireError> {
        let barrier = self
            .before_entries_lock
            .lock()
            .map_err(|_| FixedReadWireError::RegistryUnavailable)?
            .take();
        if let Some(barrier) = barrier {
            barrier.wait();
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::supabase_backfill_fixed_read::profile::parse_supabase_database_read_connection_profile_v1;
    use std::future::Future;
    use std::pin::pin;
    use std::sync::{
        atomic::{AtomicBool, AtomicU64, AtomicU8, AtomicUsize, Ordering},
        Barrier,
    };
    use std::task::{Context, Poll, Wake, Waker};
    use std::thread;

    const DIGEST_A: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const DIGEST_B: &str = "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI";
    const DIGEST_C: &str = "AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM";
    const PINNED_SCOPE_DIGEST: &str = "LibNiuZSjgQl-XXIdFe_cPFbxXJ6IvbYmXT5szY5jqU";
    const PINNED_RECEIPT_DIGEST: &str = "pT8FSWqT2VWEAHDrpaX8gnnspoYIkaS97sSPnOeFGdg";
    const PINNED_PARAMETER_VALUES_DIGEST: &str = "MrcqUPBL6cHFrAgJM3FVpD4jSCJEqdB2urZVvSFXL4c";
    const PINNED_REQUEST_DIGEST: &str = "KffEdAmqSCyEz1gEp5ICefkGg857kQHTn39IOpXMSJs";
    const GRANT_GENERATION_A: &str = "018f47bb-4d9b-4f15-8c48-f8c8f8f0f0f0";
    const GRANT_GENERATION_B: &str = "018f47bb-4d9b-4f15-9c48-f8c8f8f0f0f0";
    const READ_CREDENTIAL_INCARNATION_A: [u8; 32] = [9; 32];
    const READ_CREDENTIAL_INCARNATION_B: [u8; 32] = [10; 32];
    const CONNECTION_PROFILE_A: &str = r#"{"accountId":"host-account-a","database":"postgres","environment":"staging","format":"openpencil.supabase-database-read-connection-profile.v1","host":"db.enekobitnhobuiuamvqj.supabase.co","mode":"direct","port":5432,"projectRef":"enekobitnhobuiuamvqj","providerId":"supabase","tlsMode":"verify-full","user":"postgres","version":1}"#;
    const CONNECTION_PROFILE_B: &str = r#"{"accountId":"host-account-a","database":"postgres","environment":"staging","format":"openpencil.supabase-database-read-connection-profile.v1","host":"aws-0-ap-southeast-1.pooler.supabase.com","mode":"supavisor-session","port":5432,"projectRef":"enekobitnhobuiuamvqj","providerId":"supabase","tlsMode":"verify-full","user":"postgres.enekobitnhobuiuamvqj","version":1}"#;
    const CONNECTION_PROFILE_OTHER_PROJECT: &str = r#"{"accountId":"host-account-a","database":"postgres","environment":"staging","format":"openpencil.supabase-database-read-connection-profile.v1","host":"db.abcdefghijklmnopqrst.supabase.co","mode":"direct","port":5432,"projectRef":"abcdefghijklmnopqrst","providerId":"supabase","tlsMode":"verify-full","user":"postgres","version":1}"#;
    const CONNECTION_PROFILE_OTHER_ACCOUNT: &str = r#"{"accountId":"host-account-b","database":"postgres","environment":"staging","format":"openpencil.supabase-database-read-connection-profile.v1","host":"db.enekobitnhobuiuamvqj.supabase.co","mode":"direct","port":5432,"projectRef":"enekobitnhobuiuamvqj","providerId":"supabase","tlsMode":"verify-full","user":"postgres","version":1}"#;
    const DATABASE_READ_PASSWORD: &str = "  database-read-password-for-test \n";

    struct DeterministicEntropy(AtomicU8);

    impl SessionEntropy for DeterministicEntropy {
        fn session_id_bytes(&self) -> Result<[u8; SESSION_ID_BYTES], FixedReadWireError> {
            let value = self.0.fetch_add(1, Ordering::SeqCst).wrapping_add(1);
            Ok([value; SESSION_ID_BYTES])
        }
    }

    struct UnavailableEntropy;

    impl SessionEntropy for UnavailableEntropy {
        fn session_id_bytes(&self) -> Result<[u8; SESSION_ID_BYTES], FixedReadWireError> {
            Err(FixedReadWireError::SessionEntropyUnavailable)
        }
    }

    struct ConstantEntropy {
        bytes: [u8; SESSION_ID_BYTES],
        calls: AtomicUsize,
    }

    impl ConstantEntropy {
        fn new(bytes: [u8; SESSION_ID_BYTES]) -> Self {
            Self {
                bytes,
                calls: AtomicUsize::new(0),
            }
        }
    }

    impl SessionEntropy for ConstantEntropy {
        fn session_id_bytes(&self) -> Result<[u8; SESSION_ID_BYTES], FixedReadWireError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(self.bytes)
        }
    }

    struct ManualClock(AtomicU64);

    impl ManualClock {
        fn advance(&self, milliseconds: u64) {
            self.0.fetch_add(milliseconds, Ordering::SeqCst);
        }
    }

    impl SessionClock for ManualClock {
        fn now(&self) -> Duration {
            Duration::from_millis(self.0.load(Ordering::SeqCst))
        }
    }

    #[derive(Default)]
    struct RunnerInterrupts {
        now_milliseconds: AtomicU64,
        cancelled: AtomicBool,
        waiters: Mutex<Vec<Waker>>,
    }

    impl RunnerInterrupts {
        fn wake_waiters(&self) {
            let waiters = std::mem::take(&mut *self.waiters.lock().expect("waiter lock"));
            for waiter in waiters {
                waiter.wake();
            }
        }

        fn advance(&self, duration: Duration) {
            self.now_milliseconds.fetch_add(
                u64::try_from(duration.as_millis()).expect("test duration fits in u64"),
                Ordering::AcqRel,
            );
            self.wake_waiters();
        }

        fn cancel(&self) {
            self.cancelled.store(true, Ordering::Release);
            self.wake_waiters();
        }
    }

    impl fixed_read_interrupt_source::Sealed for RunnerInterrupts {}

    impl FixedReadInterruptSourceV1 for RunnerInterrupts {
        fn now(&self) -> Duration {
            Duration::from_millis(self.now_milliseconds.load(Ordering::Acquire))
        }

        fn is_cancelled(&self) -> bool {
            self.cancelled.load(Ordering::Acquire)
        }

        fn register_interrupt_waker(&self, deadline: FixedReadDeadlineV1, waker: &Waker) {
            if self.is_cancelled() || self.now() >= deadline.monotonic_offset() {
                waker.wake_by_ref();
                return;
            }
            let mut waiters = self.waiters.lock().expect("waiter lock");
            if self.is_cancelled() || self.now() >= deadline.monotonic_offset() {
                drop(waiters);
                waker.wake_by_ref();
                return;
            }
            if !waiters.iter().any(|waiter| waiter.will_wake(waker)) {
                waiters.push(waker.clone());
            }
        }
    }

    struct ThreadWake(thread::Thread);

    impl Wake for ThreadWake {
        fn wake(self: Arc<Self>) {
            self.0.unpark();
        }

        fn wake_by_ref(self: &Arc<Self>) {
            self.0.unpark();
        }
    }

    fn block_on<F: Future>(future: F) -> F::Output {
        let waker = Waker::from(Arc::new(ThreadWake(thread::current())));
        let mut context = Context::from_waker(&waker);
        let mut future = pin!(future);
        loop {
            match future.as_mut().poll(&mut context) {
                Poll::Ready(value) => return value,
                Poll::Pending => thread::park(),
            }
        }
    }

    fn assert_send<T: Send>(_: &T) {}

    #[derive(Default)]
    struct RunnerObservation {
        begin_identity: Option<FixedReadConnectionIdentityV1>,
        connect_count: usize,
        database_created: bool,
        password_matches: bool,
        password_address: usize,
        profile_project_ref: String,
        profile_account_id: String,
        profile_mode: String,
        profile_host: String,
        profile_port: u16,
        profile_database: String,
        profile_user: String,
        profile_tls_mode: String,
        abort_count: usize,
        cancel_count: usize,
        finish_count: usize,
        lifecycle_events: Vec<&'static str>,
    }

    struct RunnerConnector {
        observation: Arc<Mutex<RunnerObservation>>,
        interrupts: Arc<RunnerInterrupts>,
        connection_failure: Option<FixedReadDatabaseFailure>,
        database_fail_at: Option<FixedReadStage>,
        pending_connect: Option<Arc<Barrier>>,
        pending_execute: Option<Arc<Barrier>>,
    }

    impl RunnerConnector {
        fn successful() -> Self {
            Self {
                observation: Arc::new(Mutex::new(RunnerObservation::default())),
                interrupts: Arc::new(RunnerInterrupts::default()),
                connection_failure: None,
                database_fail_at: None,
                pending_connect: None,
                pending_execute: None,
            }
        }

        fn failing_connection(failure: FixedReadDatabaseFailure) -> Self {
            Self {
                connection_failure: Some(failure),
                ..Self::successful()
            }
        }

        fn failing_database(stage: FixedReadStage) -> Self {
            Self {
                database_fail_at: Some(stage),
                ..Self::successful()
            }
        }

        fn pending_connect(entered: Arc<Barrier>) -> Self {
            Self {
                pending_connect: Some(entered),
                ..Self::successful()
            }
        }

        fn pending_execute(entered: Arc<Barrier>) -> Self {
            Self {
                pending_execute: Some(entered),
                ..Self::successful()
            }
        }
    }

    struct RunnerPendingDrop {
        observation: Arc<Mutex<RunnerObservation>>,
        event: &'static str,
    }

    impl Drop for RunnerPendingDrop {
        fn drop(&mut self) {
            self.observation
                .lock()
                .expect("observation lock")
                .lifecycle_events
                .push(self.event);
        }
    }

    impl host_fixed_read_database_connector::Sealed for RunnerConnector {}

    impl HostFixedReadDatabaseConnectorV1 for RunnerConnector {
        type Session = RunnerDatabase;
        type InterruptSource = RunnerInterrupts;

        fn interrupt_source(&self) -> &Self::InterruptSource {
            self.interrupts.as_ref()
        }

        async fn connect(
            &self,
            profile: &SupabaseDatabaseReadConnectionProfileV1,
            password: &str,
            control: FixedReadStageControlV1<'_>,
        ) -> Result<Self::Session, FixedReadDatabaseFailure> {
            assert_eq!(control.remaining(), FIXED_CONNECT_TIMEOUT);
            {
                let mut observation = self.observation.lock().expect("observation lock");
                observation.connect_count += 1;
                observation.password_matches = password == DATABASE_READ_PASSWORD;
                observation.password_address = password.as_ptr() as usize;
                observation.profile_project_ref = profile.project_ref().to_owned();
                observation.profile_account_id = profile.account_id().to_owned();
                observation.profile_mode = profile.mode().as_str().to_owned();
                observation.profile_host = profile.host().to_owned();
                observation.profile_port = profile.port();
                observation.profile_database = profile.database().to_owned();
                observation.profile_user = profile.user().to_owned();
                observation.profile_tls_mode = profile.tls_mode().to_owned();
            }
            if let Some(entered) = &self.pending_connect {
                self.observation
                    .lock()
                    .expect("observation lock")
                    .lifecycle_events
                    .push("connect-polled");
                let _drop_guard = RunnerPendingDrop {
                    observation: Arc::clone(&self.observation),
                    event: "connect-future-dropped",
                };
                entered.wait();
                std::future::pending::<()>().await;
                unreachable!("pending connect future resumed without interruption");
            }
            if let Some(failure) = self.connection_failure {
                return Err(failure);
            }
            self.observation
                .lock()
                .expect("observation lock")
                .database_created = true;
            Ok(RunnerDatabase {
                observation: Arc::clone(&self.observation),
                fail_at: self.database_fail_at,
                pending_execute: self.pending_execute.clone(),
            })
        }
    }

    struct RunnerDatabase {
        observation: Arc<Mutex<RunnerObservation>>,
        fail_at: Option<FixedReadStage>,
        pending_execute: Option<Arc<Barrier>>,
    }

    impl RunnerDatabase {
        fn stage(&self, stage: FixedReadStage) -> Result<(), FixedReadDatabaseFailure> {
            if self.fail_at == Some(stage) {
                Err(FixedReadDatabaseFailure::Rejected)
            } else {
                Ok(())
            }
        }
    }

    impl FixedReadDatabaseSession for RunnerDatabase {
        type PreparedStatement = ();

        async fn begin_read_only(
            &mut self,
            connection_identity: &FixedReadConnectionIdentityV1,
            _control: FixedReadStageControlV1<'_>,
        ) -> Result<(), FixedReadDatabaseFailure> {
            self.observation
                .lock()
                .expect("observation lock")
                .begin_identity = Some(connection_identity.clone());
            self.stage(FixedReadStage::BeginReadOnly)
        }

        async fn set_local_search_path_pg_catalog(
            &mut self,
            _control: FixedReadStageControlV1<'_>,
        ) -> Result<(), FixedReadDatabaseFailure> {
            self.stage(FixedReadStage::SearchPath)
        }

        async fn set_local_statement_timeout_ms(
            &mut self,
            milliseconds: u32,
            _control: FixedReadStageControlV1<'_>,
        ) -> Result<(), FixedReadDatabaseFailure> {
            assert_eq!(milliseconds, FIXED_STATEMENT_TIMEOUT_MS);
            self.stage(FixedReadStage::StatementTimeout)
        }

        async fn prepare_fixed_statement(
            &mut self,
            statement: &FixedReadStatementArtifactV1,
            _control: FixedReadStageControlV1<'_>,
        ) -> Result<Self::PreparedStatement, FixedReadDatabaseFailure> {
            assert_eq!(statement.query(), &RECEIPT_ZERO_QUERY_IDENTITY_V1);
            assert_eq!(statement.sha256(), RECEIPT_ZERO_QUERY_SHA256);
            self.stage(FixedReadStage::Prepare)
        }

        async fn execute_prepared(
            &mut self,
            (): Self::PreparedStatement,
            parameters: &[FixedReadBoundParameter],
            response_limits: FixedReadResponseLimitsV1,
            control: FixedReadStageControlV1<'_>,
        ) -> Result<Vec<Vec<u8>>, FixedReadDatabaseFailure> {
            assert_eq!(parameters.len(), RECEIPT_ZERO_PARAMETER_COUNT);
            assert_eq!(response_limits, FIXED_RESPONSE_LIMITS);
            assert_eq!(control.deadline().monotonic_offset(), FIXED_OVERALL_TIMEOUT);
            if let Some(entered) = &self.pending_execute {
                self.observation
                    .lock()
                    .expect("observation lock")
                    .lifecycle_events
                    .push("execute-polled");
                let _drop_guard = RunnerPendingDrop {
                    observation: Arc::clone(&self.observation),
                    event: "execute-future-dropped",
                };
                entered.wait();
                std::future::pending::<()>().await;
                unreachable!("pending execute future resumed without interruption");
            }
            self.stage(FixedReadStage::Execute)?;
            Ok(vec![br#"{"inputValid":true}"#.to_vec()])
        }

        async fn finish_read_only(
            &mut self,
            _control: FixedReadStageControlV1<'_>,
        ) -> Result<(), FixedReadDatabaseFailure> {
            self.observation
                .lock()
                .expect("observation lock")
                .finish_count += 1;
            self.stage(FixedReadStage::Finish)
        }

        fn abort_read_only(&mut self) {
            let mut observation = self.observation.lock().expect("observation lock");
            observation.abort_count += 1;
            observation.lifecycle_events.push("abort");
        }

        fn cancel_database_request(&mut self) {
            let mut observation = self.observation.lock().expect("observation lock");
            observation.cancel_count += 1;
            observation.lifecycle_events.push("cancel");
        }
    }

    fn test_registry(
        maximum_sessions: usize,
        ttl: Duration,
    ) -> (HostFixedReadSessionRegistryV1, Arc<ManualClock>) {
        test_registry_with_entropy(
            maximum_sessions,
            ttl,
            Arc::new(DeterministicEntropy(AtomicU8::new(0))),
        )
    }

    fn test_registry_with_entropy(
        maximum_sessions: usize,
        ttl: Duration,
        entropy: Arc<dyn SessionEntropy>,
    ) -> (HostFixedReadSessionRegistryV1, Arc<ManualClock>) {
        let clock = Arc::new(ManualClock(AtomicU64::new(0)));
        (
            HostFixedReadSessionRegistryV1 {
                entries: Mutex::new(HashMap::new()),
                entropy,
                clock: clock.clone(),
                maximum_sessions,
                ttl,
                before_entries_lock: Mutex::new(None),
            },
            clock,
        )
    }

    fn test_evidence_issuer(
        maximum_authorities: usize,
        ttl: Duration,
    ) -> (HostFixedReadEvidenceIssuerV1, Arc<ManualClock>) {
        let clock = Arc::new(ManualClock(AtomicU64::new(0)));
        (
            HostFixedReadEvidenceIssuerV1::with_test_entropy(
                maximum_authorities,
                ttl,
                Arc::new(DeterministicEntropy(AtomicU8::new(0))),
                clock.clone(),
            ),
            clock,
        )
    }

    fn authorize_test_operation(
        issuer: &HostFixedReadEvidenceIssuerV1,
        raw: &[u8],
    ) -> Result<ReceiptZeroReconciliationAuthorityV1, FixedReadWireError> {
        issuer.authorize_for_test(
            decode_fixed_read_request_v1(raw).expect("trusted operation"),
            "enekobitnhobuiuamvqj".to_owned(),
            "host-account-a".to_owned(),
            GRANT_GENERATION_A.to_owned(),
            READ_CREDENTIAL_INCARNATION_A,
            connection_profile_digest(CONNECTION_PROFILE_A),
        )
    }

    fn embedded_fixture() -> (String, String, String, String) {
        let scope = BackfillExecutionScopeV2 {
            format: SCOPE_FORMAT.to_owned(),
            version: 2,
            provider_id: PROVIDER_ID.to_owned(),
            environment: ENVIRONMENT.to_owned(),
            provider_authority_digest: DIGEST_A.to_owned(),
            application_id: "application-1".to_owned(),
            application_digest: DIGEST_A.to_owned(),
            migration_id: "migration-1".to_owned(),
            migration_digest: DIGEST_A.to_owned(),
            migration_plan_digest: DIGEST_A.to_owned(),
            source_ledger_digest: DIGEST_A.to_owned(),
            capture_digest: DIGEST_A.to_owned(),
            receipt_zero_evidence_digest: DIGEST_A.to_owned(),
            resource_identity_digest: DIGEST_A.to_owned(),
            catalog_precondition_digest: DIGEST_A.to_owned(),
            entity_id: "tasks".to_owned(),
            cursor_field: "id".to_owned(),
            cursor_field_type: "integer".to_owned(),
            target_field: "completed_at".to_owned(),
            batch_size: 100,
            maximum_receipt_count: 10_000,
            maximum_batch_count: 9_999,
            captured_high_water: Some(42),
            initial_remaining_eligible_row_count: 10,
            initial_remaining_target_row_count: 10,
            required_batch_count: 1,
            required_matched_row_count: None,
            resume_policy: RESUME_POLICY.to_owned(),
            completion_rule: COMPLETION_RULE.to_owned(),
        };
        let scope_bytes = canonical_typed_bytes(&scope).expect("canonical scope");
        let scope_digest = URL_SAFE_NO_PAD.encode(Sha256::digest(&scope_bytes));
        let receipt = BackfillExecutionReceiptV2 {
            format: RECEIPT_FORMAT.to_owned(),
            version: 2,
            receipt_id: "receipt-1".to_owned(),
            execution_id: "execution-1".to_owned(),
            idempotency_key: "idempotency-1".to_owned(),
            request_digest: DIGEST_A.to_owned(),
            scope,
            scope_digest: scope_digest.clone(),
            checkpoint_kind: "capture".to_owned(),
            batch_index: 0,
            previous_cursor: None,
            last_processed_key: None,
            batch_counts: BackfillExecutionCountsV2 {
                scanned_row_count: 0,
                matched_row_count: 0,
                updated_row_count: 0,
            },
            cumulative_counts: BackfillExecutionCountsV2 {
                scanned_row_count: 0,
                matched_row_count: 0,
                updated_row_count: 0,
            },
            exhaustion: BackfillExecutionExhaustionV2 {
                checked: true,
                remaining_eligible_row_count: Some(10),
                remaining_target_row_count: Some(10),
            },
            postconditions: BackfillExecutionPostconditionsV2 {
                field_not_null: false,
                required_matched_row_count: None,
                matched_row_count_satisfied: true,
            },
            outcome: "in-progress".to_owned(),
            terminal_reason: None,
            stable_error_code: None,
            previous_receipt_digest: None,
            catalog_evidence_digest: DIGEST_A.to_owned(),
            operation_authority_digest: DIGEST_A.to_owned(),
            database_event_id: "event-1".to_owned(),
            database_head_version: 1,
            committed_at: "2026-09-08T00:00:00.000Z".to_owned(),
            evidence_digest: DIGEST_A.to_owned(),
        };
        let receipt_bytes = canonical_typed_bytes(&receipt).expect("canonical receipt");
        let receipt_digest = URL_SAFE_NO_PAD.encode(Sha256::digest(&receipt_bytes));
        (
            STANDARD.encode(scope_bytes),
            scope_digest,
            STANDARD.encode(receipt_bytes),
            receipt_digest,
        )
    }

    fn parameters() -> Vec<Option<String>> {
        let (scope_base64, scope_digest, receipt_base64, receipt_digest) = embedded_fixture();
        vec![
            Some("execution-1".to_owned()),
            Some("application-1".to_owned()),
            Some(DIGEST_A.to_owned()),
            Some("migration-1".to_owned()),
            Some(DIGEST_A.to_owned()),
            Some(DIGEST_A.to_owned()),
            Some(DIGEST_A.to_owned()),
            Some(DIGEST_A.to_owned()),
            Some(scope_digest),
            Some(DIGEST_A.to_owned()),
            Some(DIGEST_A.to_owned()),
            Some(scope_base64),
            Some(DIGEST_A.to_owned()),
            Some("42".to_owned()),
            Some("10".to_owned()),
            Some("10".to_owned()),
            None,
            Some("1".to_owned()),
            Some("100".to_owned()),
            Some("running".to_owned()),
            Some("2026-09-08T00:00:00.000Z".to_owned()),
            Some("event-1".to_owned()),
            Some("receipt-1".to_owned()),
            Some("idempotency-1".to_owned()),
            Some(DIGEST_A.to_owned()),
            Some(receipt_digest),
            Some(receipt_base64),
            Some(DIGEST_A.to_owned()),
        ]
    }

    fn parameter_digest(values: &[Option<String>]) -> String {
        URL_SAFE_NO_PAD.encode(Sha256::digest(
            canonical_parameter_values_bytes(&parameter_values(values))
                .expect("canonical parameters"),
        ))
    }

    fn bindings(values: &[Option<String>]) -> WireBindingsV1 {
        WireBindingsV1 {
            reconciliation_review_digest: DIGEST_A.to_owned(),
            static_sql_safety_certificate_digest: DIGEST_A.to_owned(),
            reconciliation_sql_digest: RECEIPT_ZERO_SQL_DIGEST.to_owned(),
            reconciliation_query_digest: RECEIPT_ZERO_QUERY_DIGEST.to_owned(),
            query_contract_digest: RECEIPT_ZERO_QUERY_CONTRACT_DIGEST.to_owned(),
            analysis_profile_digest: DIGEST_A.to_owned(),
            parameter_schema_digest: PARAMETER_SCHEMA_DIGEST.to_owned(),
            parameter_values_digest: parameter_digest(values),
            parameter_order_digest: RECEIPT_ZERO_PARAMETER_ORDER_DIGEST.to_owned(),
            response_fields_digest: RECEIPT_ZERO_RESPONSE_FIELDS_DIGEST.to_owned(),
            ledger_shape_digest: DIGEST_A.to_owned(),
            expected_column_inventory_digest: DIGEST_A.to_owned(),
            expected_constraint_inventory_digest: DIGEST_A.to_owned(),
            scope_digest: values[8].clone().expect("scope digest"),
            receipt_digest: values[25].clone().expect("receipt digest"),
            candidate_operation_evidence_digest: values[27].clone().expect("operation evidence"),
            historical_install_marker_digest: DIGEST_A.to_owned(),
        }
    }

    fn make_request() -> WireRequestV1 {
        let values = parameters();
        let mut request = WireRequestV1 {
            format: REQUEST_FORMAT.to_owned(),
            version: 1,
            provider_id: PROVIDER_ID.to_owned(),
            environment: ENVIRONMENT.to_owned(),
            variant: VARIANT.to_owned(),
            contract_only: true,
            native_command_registered: false,
            request_dispatched: false,
            query: WireQueryV1 {
                query_id: RECEIPT_ZERO_QUERY_ID.to_owned(),
                query_version: RECEIPT_ZERO_QUERY_VERSION.to_owned(),
                statement_count: 1,
                access_mode: ACCESS_MODE.to_owned(),
                snapshot_scope: SNAPSHOT_SCOPE.to_owned(),
                sql_byte_length: RECEIPT_ZERO_QUERY_BYTE_LENGTH,
                parameter_count: RECEIPT_ZERO_PARAMETER_COUNT,
                parameter_order: RECEIPT_ZERO_PARAMETER_ORDER
                    .iter()
                    .map(|value| (*value).to_owned())
                    .collect(),
                response_fields: RESPONSE_FIELDS
                    .iter()
                    .map(|value| (*value).to_owned())
                    .collect(),
                raw_sql_included: false,
                endpoint_included: false,
            },
            requirements: WireRequirementsV1 {
                configured_search_path: vec!["pg_catalog".to_owned()],
                requires_transport_enforced_read_only_boundary: true,
                requires_live_catalog_semantics_authentication: true,
                server_statement_timeout_ms: FIXED_STATEMENT_TIMEOUT_MS,
                maximum_response_bytes: MAXIMUM_RESPONSE_BYTES,
            },
            bindings: bindings(&values),
            parameters: values,
            production_transport_created: false,
            production_transport_authenticated: false,
            production_request_dispatch_authenticated: false,
            adapter_authenticated: false,
            dynamic_bindings_authenticated: false,
            read_only_boundary_authenticated: false,
            configured_search_path_authenticated: false,
            live_catalog_semantics_authenticated: false,
            server_statement_timeout_authenticated: false,
            server_cancellation_authenticated: false,
            single_statement_snapshot_authenticated: false,
            credential_authority_created: false,
            transport_authority_created: false,
            database_authority_created: false,
            mutation_authority_created: false,
            execution_authority_created: false,
            receipt_authority_created: false,
            release_authority_created: false,
            release_ready: false,
            request_digest: DIGEST_A.to_owned(),
        };
        resign(&mut request);
        request
    }

    fn resign(request: &mut WireRequestV1) {
        request.bindings.parameter_values_digest = parameter_digest(&request.parameters);
        request.request_digest = URL_SAFE_NO_PAD.encode(
            canonical_request_digest(request).expect("canonical request digest before resigning"),
        );
    }

    fn raw_request(request: &WireRequestV1) -> Vec<u8> {
        serde_json::to_vec(request).expect("serialize request")
    }

    fn embedded_value(request: &WireRequestV1, index: usize) -> Value {
        let encoded = request.parameters[index]
            .as_deref()
            .expect("embedded parameter");
        serde_json::from_slice(&STANDARD.decode(encoded).expect("embedded base64"))
            .expect("embedded JSON")
    }

    fn replace_receipt_value(request: &mut WireRequestV1, value: Value) {
        let bytes =
            serde_json::to_vec(&canonicalize_value(value)).expect("canonical receipt value");
        let digest = URL_SAFE_NO_PAD.encode(Sha256::digest(&bytes));
        request.parameters[25] = Some(digest.clone());
        request.parameters[26] = Some(STANDARD.encode(bytes));
        request.bindings.receipt_digest = digest;
        resign(request);
    }

    fn make_completed_request() -> WireRequestV1 {
        let mut request = make_request();
        let mut scope = embedded_value(&request, 11);
        scope["initialRemainingTargetRowCount"] = Value::from(0);
        let scope_bytes =
            serde_json::to_vec(&canonicalize_value(scope.clone())).expect("completed scope");
        let scope_digest = URL_SAFE_NO_PAD.encode(Sha256::digest(&scope_bytes));

        let mut receipt = embedded_value(&request, 26);
        receipt["scope"] = scope;
        receipt["scopeDigest"] = Value::String(scope_digest.clone());
        receipt["exhaustion"]["remainingTargetRowCount"] = Value::from(0);
        receipt["postconditions"]["fieldNotNull"] = Value::Bool(true);
        receipt["outcome"] = Value::String("completed".to_owned());
        receipt["terminalReason"] = Value::String("already-satisfied".to_owned());

        request.parameters[8] = Some(scope_digest.clone());
        request.parameters[11] = Some(STANDARD.encode(scope_bytes));
        request.parameters[15] = Some("0".to_owned());
        request.parameters[19] = Some("completed".to_owned());
        request.bindings.scope_digest = scope_digest;
        replace_receipt_value(&mut request, receipt);
        request
    }

    fn evidence_for(request: &WireRequestV1) -> HostFixedReadEvidenceV1 {
        evidence_for_identity(
            request,
            GRANT_GENERATION_A,
            READ_CREDENTIAL_INCARNATION_A,
            connection_profile_digest(CONNECTION_PROFILE_A),
        )
    }

    fn connection_profile_digest(connection_profile: &str) -> [u8; 32] {
        parse_supabase_database_read_connection_profile_v1(connection_profile.as_bytes())
            .expect("valid database-read connection profile")
            .digest()
    }

    fn evidence_for_identity(
        request: &WireRequestV1,
        grant_generation: &str,
        incarnation: [u8; 32],
        connection_profile_digest: [u8; 32],
    ) -> HostFixedReadEvidenceV1 {
        HostFixedReadEvidenceV1::checked(
            request.bindings.clone(),
            parameter_values(&request.parameters),
            "enekobitnhobuiuamvqj".to_owned(),
            "host-account-a".to_owned(),
            grant_generation.to_owned(),
            incarnation,
            connection_profile_digest,
        )
        .expect("valid Host evidence")
    }

    fn credential_snapshot() -> DatabaseReadCredentialSnapshotV1 {
        credential_snapshot_for(
            GRANT_GENERATION_A,
            READ_CREDENTIAL_INCARNATION_A,
            CONNECTION_PROFILE_A,
        )
    }

    fn credential_snapshot_for(
        grant_generation: &str,
        incarnation: [u8; 32],
        connection_profile: &str,
    ) -> DatabaseReadCredentialSnapshotV1 {
        DatabaseReadCredentialSnapshotV1::checked_for_test(
            DATABASE_READ_PASSWORD.to_owned(),
            connection_profile.to_owned(),
            grant_generation.to_owned(),
            incarnation,
        )
        .expect("valid database-read credential snapshot")
    }

    fn consumed_runner_session() -> (
        HostFixedReadSessionRegistryV1,
        String,
        ConsumedFixedReadSessionV1,
    ) {
        let request = make_request();
        let (registry, _) = test_registry(32, Duration::from_secs(30));
        let handle = registry
            .prepare(
                decode_fixed_read_request_v1(&raw_request(&request)).expect("decode request"),
                evidence_for(&request),
            )
            .expect("prepare");
        let session_id = handle.session_id;
        let consumed = registry
            .consume(&session_id, credential_snapshot())
            .expect("consume");
        (registry, session_id, consumed)
    }

    #[test]
    fn decodes_the_cross_language_pinned_scope_receipt_and_request_vector() {
        let request = make_request();
        let raw = raw_request(&request);
        assert_eq!(request.bindings.scope_digest, PINNED_SCOPE_DIGEST);
        assert_eq!(request.bindings.receipt_digest, PINNED_RECEIPT_DIGEST);
        assert_eq!(
            request.bindings.parameter_values_digest,
            PINNED_PARAMETER_VALUES_DIGEST
        );
        assert_eq!(request.request_digest, PINNED_REQUEST_DIGEST);
        assert_eq!(raw.len(), 9_449);
        let decoded = decode_fixed_read_request_v1(&raw).expect("valid request");
        assert_eq!(
            URL_SAFE_NO_PAD.encode(decoded.request_digest),
            request.request_digest
        );
    }

    #[test]
    fn completed_receipt_zero_allows_eligible_rows_when_no_target_rows_remain() {
        let request = make_completed_request();
        let decoded = decode_fixed_read_request_v1(&raw_request(&request))
            .expect("TS receiptOutcome parity: eligible rows do not prevent already-satisfied");
        assert_eq!(
            decoded.parameters[14],
            FixedReadParameterValue::Text("10".to_owned())
        );
        assert_eq!(
            decoded.parameters[15],
            FixedReadParameterValue::Text("0".to_owned())
        );
        assert_eq!(
            decoded.parameters[19],
            FixedReadParameterValue::Text("completed".to_owned())
        );
    }

    #[test]
    fn embedded_scope_and_receipt_are_strict_canonical_typed_documents() {
        for index in [11, 26] {
            let request = make_request();
            let original = String::from_utf8(
                STANDARD
                    .decode(request.parameters[index].as_deref().unwrap())
                    .unwrap(),
            )
            .unwrap();
            for injected in [
                original.replacen('{', "{\"unknown\":false,", 1),
                original.replacen('{', "{\"format\":\"duplicate\",", 1),
                original.replacen('{', "{ ", 1),
            ] {
                let mut tampered = make_request();
                tampered.parameters[index] = Some(STANDARD.encode(injected));
                resign(&mut tampered);
                assert_eq!(
                    decode_fixed_read_request_v1(&raw_request(&tampered)).unwrap_err(),
                    FixedReadWireError::InvalidRequest,
                    "strict embedded document at parameter {}",
                    index + 1
                );
            }
        }
    }

    #[test]
    fn embedded_v2_rejects_scope_receipt_and_zero_checkpoint_domain_tampering() {
        for (path, value) in [
            (&["checkpointKind"][..], Value::String("batch".to_owned())),
            (&["batchIndex"][..], Value::from(1)),
            (&["previousCursor"][..], Value::from(0)),
            (&["databaseHeadVersion"][..], Value::from(2)),
            (&["outcome"][..], Value::String("completed".to_owned())),
        ] {
            let mut request = make_request();
            let mut receipt = embedded_value(&request, 26);
            receipt[path[0]] = value;
            replace_receipt_value(&mut request, receipt);
            assert_eq!(
                decode_fixed_read_request_v1(&raw_request(&request)).unwrap_err(),
                FixedReadWireError::InvalidRequest,
                "receipt domain path {}",
                path[0]
            );
        }

        let mut counted = make_request();
        let mut receipt = embedded_value(&counted, 26);
        receipt["batchCounts"]["scannedRowCount"] = Value::from(1);
        replace_receipt_value(&mut counted, receipt);
        assert_eq!(
            decode_fixed_read_request_v1(&raw_request(&counted)).unwrap_err(),
            FixedReadWireError::InvalidRequest
        );

        for (field, value) in [
            ("providerId", Value::String("other".to_owned())),
            ("environment", Value::String("production".to_owned())),
            ("batchSize", Value::from(0)),
            ("requiredBatchCount", Value::from(2)),
        ] {
            let mut request = make_request();
            let mut scope = embedded_value(&request, 11);
            scope[field] = value;
            request.parameters[11] =
                Some(STANDARD.encode(serde_json::to_vec(&canonicalize_value(scope)).unwrap()));
            resign(&mut request);
            assert_eq!(
                decode_fixed_read_request_v1(&raw_request(&request)).unwrap_err(),
                FixedReadWireError::InvalidRequest,
                "scope domain field {field}"
            );
        }
    }

    #[test]
    fn embedded_v2_requires_nested_scope_and_authority_digest_crosslinks() {
        let mut nested = make_request();
        let mut receipt = embedded_value(&nested, 26);
        receipt["scope"]["applicationId"] = Value::String("application-other".to_owned());
        replace_receipt_value(&mut nested, receipt);
        assert_eq!(
            decode_fixed_read_request_v1(&raw_request(&nested)).unwrap_err(),
            FixedReadWireError::BindingMismatch
        );

        let mut catalog = make_request();
        let mut receipt = embedded_value(&catalog, 26);
        receipt["catalogEvidenceDigest"] = Value::String(DIGEST_B.to_owned());
        replace_receipt_value(&mut catalog, receipt);
        assert_eq!(
            decode_fixed_read_request_v1(&raw_request(&catalog)).unwrap_err(),
            FixedReadWireError::InvalidRequest
        );

        let mut operation = make_request();
        let mut receipt = embedded_value(&operation, 26);
        receipt["operationAuthorityDigest"] = Value::String(DIGEST_B.to_owned());
        replace_receipt_value(&mut operation, receipt);
        assert_eq!(
            decode_fixed_read_request_v1(&raw_request(&operation)).unwrap_err(),
            FixedReadWireError::BindingMismatch
        );
    }

    #[test]
    fn every_cas_parameter_is_bound_to_the_typed_scope_or_receipt() {
        for index in 0..RECEIPT_ZERO_PARAMETER_COUNT {
            let mut request = make_request();
            request.parameters[index] = Some(match index {
                2 | 4..=10 | 12 | 24..=25 | 27 => DIGEST_B.to_owned(),
                11 => request.parameters[26].clone().unwrap(),
                13..=18 => "0".to_owned(),
                19 => "completed".to_owned(),
                20 => "2026-09-08T00:00:00.001Z".to_owned(),
                26 => request.parameters[11].clone().unwrap(),
                _ => "different".to_owned(),
            });
            resign(&mut request);
            assert!(
                decode_fixed_read_request_v1(&raw_request(&request)).is_err(),
                "parameter {} must be bound",
                index + 1
            );
        }
    }

    #[test]
    fn release_identifiers_reject_secret_like_material_but_allow_known_opaque_ids() {
        for secret in [
            "sk_live_abcdef",
            "SK_LIVE_abc",
            "github_pat_abcdefgh",
            "GITHUB_PAT_ABCDEFGH",
            "ghp_abcdefgh",
            "GHP_abcdefgh",
            "xoxb-abcdefgh",
            "XOXB-ABCDEFGH",
            "AKIA1234567890ABCDEF",
            "sb_secret_abcdef",
            "api_key:Abcdef1234567890",
            "postgres://user:password@host",
            "Abcdefghijklmnopqrstuvwxyz0123456789",
            "Abcdefghijklmnop-qrstuvwxyz0123456789",
        ] {
            assert!(
                !valid_release_identifier(secret),
                "secret-like identifier: {secret}"
            );
        }
        assert!(valid_release_identifier(
            "018f47bb-4d9b-4f15-8c48-f8c8f8f0f0f0"
        ));
        assert!(valid_release_identifier(DIGEST_A));
    }

    #[test]
    fn shared_secret_scanner_matches_release_text_credential_forms() {
        for secret in [
            "Basic Abcdefghijklmno1",
            "Bearer Abcdefghijklmno1",
            "Bearer\u{feff}Abcdefghijklmno1",
            "-----BEGIN PRIVATE KEY-----",
            "-----BEGIN EC PRIVATE KEY-----",
            "api_key=Abcdef1234567890",
            "password = 'Abcdef1234567890'",
            "postgres://user:password@host",
            "api_key : Abcdef1234567890",
            "token: +Abcdefghijklmno",
            "eyJabcdefgh.eyJabcdefgh.abcdefgh!",
            "https://example.com postgres://user:password@host",
        ] {
            assert!(
                contains_secret_like_material(secret),
                "secret-like text: {secret}"
            );
        }
    }

    #[test]
    fn raw_request_cap_is_checked_before_deserialization_at_the_exact_boundary() {
        let raw = raw_request(&make_request());
        assert!(raw.len() < MAXIMUM_RAW_REQUEST_BYTES);
        let mut exact = raw.clone();
        exact.resize(MAXIMUM_RAW_REQUEST_BYTES, b' ');
        decode_fixed_read_request_v1(&exact).expect("exact cap remains valid JSON");
        exact.push(b' ');
        assert_eq!(
            decode_fixed_read_request_v1(&exact).unwrap_err(),
            FixedReadWireError::RequestTooLarge
        );
    }

    #[test]
    fn rejects_unknown_duplicate_malformed_and_type_mismatched_json() {
        let raw = String::from_utf8(raw_request(&make_request())).expect("utf8 JSON");
        let unknown = raw.replacen('{', "{\"unknown\":false,", 1);
        assert_eq!(
            decode_fixed_read_request_v1(unknown.as_bytes()).unwrap_err(),
            FixedReadWireError::InvalidRequest
        );
        let duplicate = raw.replacen('{', "{\"format\":\"duplicate\",", 1);
        assert_eq!(
            decode_fixed_read_request_v1(duplicate.as_bytes()).unwrap_err(),
            FixedReadWireError::InvalidRequest
        );
        assert_eq!(
            decode_fixed_read_request_v1(b"{not-json").unwrap_err(),
            FixedReadWireError::InvalidRequest
        );
        let mismatch = raw.replace("\"version\":1", "\"version\":\"1\"");
        assert_eq!(
            decode_fixed_read_request_v1(mismatch.as_bytes()).unwrap_err(),
            FixedReadWireError::InvalidRequest
        );
    }

    #[test]
    fn rejects_fixed_and_false_claim_tampering() {
        let mut fixed = make_request();
        fixed.query.statement_count = 2;
        resign(&mut fixed);
        assert_eq!(
            decode_fixed_read_request_v1(&raw_request(&fixed)).unwrap_err(),
            FixedReadWireError::InvalidRequest
        );
        let mut flag = make_request();
        flag.dynamic_bindings_authenticated = true;
        resign(&mut flag);
        assert_eq!(
            decode_fixed_read_request_v1(&raw_request(&flag)).unwrap_err(),
            FixedReadWireError::InvalidRequest
        );
        let mut requirement = make_request();
        requirement
            .requirements
            .requires_live_catalog_semantics_authentication = false;
        resign(&mut requirement);
        assert_eq!(
            decode_fixed_read_request_v1(&raw_request(&requirement)).unwrap_err(),
            FixedReadWireError::InvalidRequest
        );
    }

    #[test]
    fn rejects_noncanonical_digests_digest_tampering_and_parameter_crosswire() {
        let mut malformed = make_request();
        malformed.request_digest.push('=');
        assert_eq!(
            decode_fixed_read_request_v1(&raw_request(&malformed)).unwrap_err(),
            FixedReadWireError::InvalidRequest
        );
        let mut digest = make_request();
        digest.request_digest = DIGEST_C.to_owned();
        assert_eq!(
            decode_fixed_read_request_v1(&raw_request(&digest)).unwrap_err(),
            FixedReadWireError::BindingMismatch
        );
        let mut values = make_request();
        values.parameters[0] = Some("tampered".to_owned());
        values.request_digest = URL_SAFE_NO_PAD.encode(
            canonical_request_digest(&values)
                .expect("request digest retaining old parameter digest"),
        );
        assert_eq!(
            decode_fixed_read_request_v1(&raw_request(&values)).unwrap_err(),
            FixedReadWireError::BindingMismatch
        );
        let mut crosswire = make_request();
        crosswire.parameters[8] = Some(DIGEST_C.to_owned());
        resign(&mut crosswire);
        assert_eq!(
            decode_fixed_read_request_v1(&raw_request(&crosswire)).unwrap_err(),
            FixedReadWireError::BindingMismatch
        );
    }

    #[test]
    fn rejects_control_characters_and_enforces_each_parameter_bound() {
        let mut control = make_request();
        control.parameters[0] = Some("line\nbreak".to_owned());
        resign(&mut control);
        assert_eq!(
            decode_fixed_read_request_v1(&raw_request(&control)).unwrap_err(),
            FixedReadWireError::InvalidRequest
        );

        let mut exact = make_request();
        exact.parameters[0] = Some("x".repeat(MAXIMUM_PARAMETER_STRING_BYTES));
        validate_parameter_schema(&exact.parameters).expect("exact generic parameter cap");
        let mut over = make_request();
        over.parameters[0] = Some("x".repeat(MAXIMUM_PARAMETER_STRING_BYTES + 1));
        assert_eq!(
            validate_parameter_schema(&over.parameters).unwrap_err(),
            FixedReadWireError::InvalidRequest
        );
    }

    #[test]
    fn rejects_positional_schema_and_embedded_document_tampering() {
        let mut non_nullable = make_request();
        non_nullable.parameters[17] = None;
        resign(&mut non_nullable);
        assert_eq!(
            decode_fixed_read_request_v1(&raw_request(&non_nullable)).unwrap_err(),
            FixedReadWireError::InvalidRequest
        );

        let mut decimal = make_request();
        decimal.parameters[17] = Some("01".to_owned());
        resign(&mut decimal);
        assert_eq!(
            decode_fixed_read_request_v1(&raw_request(&decimal)).unwrap_err(),
            FixedReadWireError::InvalidRequest
        );

        let mut timestamp = make_request();
        timestamp.parameters[20] = Some("2026-09-08T00:00:00Z".to_owned());
        resign(&mut timestamp);
        assert_eq!(
            decode_fixed_read_request_v1(&raw_request(&timestamp)).unwrap_err(),
            FixedReadWireError::InvalidRequest
        );

        let mut base64 = make_request();
        base64.parameters[11] = Some("eyJiIjoyLCJhIjoxfQ==".to_owned());
        resign(&mut base64);
        assert_eq!(
            decode_fixed_read_request_v1(&raw_request(&base64)).unwrap_err(),
            FixedReadWireError::InvalidRequest
        );

        let mut embedded_digest = make_request();
        embedded_digest.bindings.scope_digest = DIGEST_B.to_owned();
        embedded_digest.parameters[8] = Some(DIGEST_B.to_owned());
        resign(&mut embedded_digest);
        assert_eq!(
            decode_fixed_read_request_v1(&raw_request(&embedded_digest)).unwrap_err(),
            FixedReadWireError::BindingMismatch
        );
    }

    #[test]
    fn accepts_postgres_decimal_boundaries_and_rejects_overflow() {
        let mut exact = make_request();
        exact.parameters[13] = Some(POSTGRES_BIGINT_MAX_DECIMAL.to_owned());
        exact.parameters[16] = Some(POSTGRES_BIGINT_MAX_DECIMAL.to_owned());
        exact.parameters[17] = Some(POSTGRES_INTEGER_MAX_DECIMAL.to_owned());
        exact.parameters[18] = Some(POSTGRES_INTEGER_MAX_DECIMAL.to_owned());
        validate_parameter_schema(&exact.parameters).expect("Postgres maxima are valid");

        for (index, overflow) in [
            (13, "9223372036854775808"),
            (16, "9223372036854775808"),
            (17, "2147483648"),
            (18, "2147483648"),
            (13, "9999999999999999999999999999999999999999"),
        ] {
            let mut request = make_request();
            request.parameters[index] = Some(overflow.to_owned());
            assert_eq!(
                validate_parameter_schema(&request.parameters).unwrap_err(),
                FixedReadWireError::InvalidRequest,
                "overflow at parameter {}",
                index + 1
            );
        }
    }

    #[test]
    fn timestamp_requires_a_real_four_digit_utc_millisecond_instant() {
        for invalid in [
            "2026-02-29T00:00:00.000Z",
            "2024-02-29T24:00:00.000Z",
            "+010000-01-01T00:00:00.000Z",
            "2026-09-08T00:00:00.00Z",
            "2026-09-08T00:00:00.000+00:00",
        ] {
            let mut request = make_request();
            request.parameters[20] = Some(invalid.to_owned());
            resign(&mut request);
            assert_eq!(
                decode_fixed_read_request_v1(&raw_request(&request)).unwrap_err(),
                FixedReadWireError::InvalidRequest,
                "invalid timestamp: {invalid}"
            );
        }
    }

    #[test]
    fn every_wire_digest_requires_canonical_32_byte_base64url() {
        let request = make_request();
        let base = serde_json::to_value(request).expect("request value");
        let binding_keys = [
            "reconciliationReviewDigest",
            "staticSqlSafetyCertificateDigest",
            "reconciliationSqlDigest",
            "reconciliationQueryDigest",
            "queryContractDigest",
            "analysisProfileDigest",
            "parameterSchemaDigest",
            "parameterValuesDigest",
            "parameterOrderDigest",
            "responseFieldsDigest",
            "ledgerShapeDigest",
            "expectedColumnInventoryDigest",
            "expectedConstraintInventoryDigest",
            "scopeDigest",
            "receiptDigest",
            "candidateOperationEvidenceDigest",
            "historicalInstallMarkerDigest",
        ];
        for key in binding_keys {
            let mut tampered = base.clone();
            tampered["bindings"][key] = Value::String("B".repeat(43));
            let raw = serde_json::to_vec(&tampered).expect("tampered request");
            assert_eq!(
                decode_fixed_read_request_v1(&raw).unwrap_err(),
                FixedReadWireError::InvalidRequest,
                "noncanonical binding: {key}"
            );
        }

        for index in [2, 4, 5, 6, 7, 8, 9, 10, 12, 24, 25, 27] {
            let mut request = make_request();
            request.parameters[index] = Some("B".repeat(43));
            resign(&mut request);
            assert_eq!(
                decode_fixed_read_request_v1(&raw_request(&request)).unwrap_err(),
                FixedReadWireError::InvalidRequest,
                "noncanonical digest parameter: {}",
                index + 1
            );
        }
    }

    #[test]
    fn parent_contract_enforces_the_decoded_aggregate_bound() {
        let mut values = parameter_values(&parameters());
        let required = values
            .iter()
            .enumerate()
            .filter(|(index, _)| !matches!(index, 0 | 1 | 2))
            .map(|(_, value)| match value {
                FixedReadParameterValue::Text(value) => value.len(),
                FixedReadParameterValue::Null => 0,
            })
            .sum::<usize>();
        let remaining = MAXIMUM_AGGREGATE_PARAMETER_VALUE_BYTES - required;
        values[0] = FixedReadParameterValue::Text("a".repeat(MAXIMUM_PARAMETER_STRING_BYTES));
        values[1] = FixedReadParameterValue::Text("b".repeat(MAXIMUM_PARAMETER_STRING_BYTES));
        values[2] = FixedReadParameterValue::Text(
            "c".repeat(remaining - (2 * MAXIMUM_PARAMETER_STRING_BYTES)),
        );
        let digest = <[u8; 32]>::from(Sha256::digest(
            canonical_parameter_values_bytes(&values).expect("canonical aggregate"),
        ));
        ReceiptZeroFixedReadContractV1::checked(
            RECEIPT_ZERO_SQL_DIGEST,
            RECEIPT_ZERO_QUERY_DIGEST,
            RECEIPT_ZERO_QUERY_CONTRACT_DIGEST,
            RECEIPT_ZERO_PARAMETER_ORDER_DIGEST,
            RECEIPT_ZERO_RESPONSE_FIELDS_DIGEST,
            digest,
            values.clone(),
        )
        .expect("exact aggregate cap");
        if let FixedReadParameterValue::Text(value) = &mut values[2] {
            value.push('c');
        }
        let digest = <[u8; 32]>::from(Sha256::digest(
            canonical_parameter_values_bytes(&values).expect("canonical over aggregate"),
        ));
        assert_eq!(
            ReceiptZeroFixedReadContractV1::checked(
                RECEIPT_ZERO_SQL_DIGEST,
                RECEIPT_ZERO_QUERY_DIGEST,
                RECEIPT_ZERO_QUERY_CONTRACT_DIGEST,
                RECEIPT_ZERO_PARAMETER_ORDER_DIGEST,
                RECEIPT_ZERO_RESPONSE_FIELDS_DIGEST,
                digest,
                values,
            )
            .unwrap_err(),
            FixedReadError::InvalidContract
        );
    }

    #[test]
    fn host_evidence_is_exact_and_prepare_keeps_authority_false() {
        let request = make_request();
        let expected_request_digest = decode_digest(&request.request_digest).unwrap();
        let decoded = decode_fixed_read_request_v1(&raw_request(&request)).expect("decode");
        let (registry, _) = test_registry(32, Duration::from_secs(30));
        let handle = registry
            .prepare(decoded, evidence_for(&request))
            .expect("prepare");
        assert_eq!(handle.request_digest, expected_request_digest);
        assert_eq!(handle.authority, DormantFixedReadAuthorityV1::NONE);
        assert_eq!(handle.session_id.len(), 43);
        assert_eq!(
            URL_SAFE_NO_PAD.decode(&handle.session_id).unwrap().len(),
            32
        );
        assert!(!handle.session_id.contains("enekobitnhobuiuamvqj"));

        let mut mismatch_request = make_request();
        mismatch_request.bindings.analysis_profile_digest = DIGEST_B.to_owned();
        resign(&mut mismatch_request);
        let mismatch_decoded =
            decode_fixed_read_request_v1(&raw_request(&mismatch_request)).expect("decode mismatch");
        assert_eq!(
            registry
                .prepare(mismatch_decoded, evidence_for(&request))
                .err()
                .expect("mismatched evidence must fail"),
            FixedReadWireError::HostEvidenceMismatch
        );
    }

    #[test]
    fn evidence_issuer_consumes_exact_operation_authority_once_and_keeps_claims_false() {
        let request = make_request();
        let raw = raw_request(&request);
        let issuer = HostFixedReadEvidenceIssuerV1::new();
        let authority = issuer
            .authorize_for_test(
                decode_fixed_read_request_v1(&raw).expect("trusted operation"),
                "enekobitnhobuiuamvqj".to_owned(),
                "host-account-a".to_owned(),
                GRANT_GENERATION_A.to_owned(),
                READ_CREDENTIAL_INCARNATION_A,
                connection_profile_digest(CONNECTION_PROFILE_A),
            )
            .expect("test authority");
        let candidate = decode_fixed_read_request_v1(&raw).expect("renderer candidate");
        let evidence = issuer
            .issue(&authority, &candidate, &credential_snapshot())
            .expect("exact operation authority");
        let (registry, _) = test_registry(32, Duration::from_secs(30));
        let handle = registry.prepare(candidate, evidence).expect("prepare");
        assert_eq!(handle.authority, DormantFixedReadAuthorityV1::NONE);

        let replay = decode_fixed_read_request_v1(&raw).expect("replay candidate");
        assert_eq!(
            issuer
                .issue(&authority, &replay, &credential_snapshot())
                .err()
                .expect("upstream authority must be one-shot"),
            FixedReadWireError::OperationAuthorityMissing
        );
    }

    #[test]
    fn expired_operation_authority_is_burned_after_registry_lock_wait() {
        let request = make_request();
        let raw = Arc::new(raw_request(&request));
        let ttl = Duration::from_millis(10);
        let (issuer, clock) = test_evidence_issuer(32, ttl);
        let issuer = Arc::new(issuer);
        let authority =
            Arc::new(authorize_test_operation(&issuer, &raw).expect("test operation authority"));
        let barrier = Arc::new(Barrier::new(2));
        issuer
            .set_before_entries_lock_for_test(Arc::clone(&barrier))
            .expect("install one-shot lock hook");

        let entries_guard = issuer
            .entries
            .lock()
            .expect("prehold authority registry lock");
        let worker_issuer = Arc::clone(&issuer);
        let worker_authority = Arc::clone(&authority);
        let worker_raw = Arc::clone(&raw);
        let worker = thread::spawn(move || {
            let candidate = decode_fixed_read_request_v1(&worker_raw).expect("renderer candidate");
            worker_issuer.issue(&worker_authority, &candidate, &credential_snapshot())
        });
        barrier.wait();
        clock.advance(ttl.as_millis() as u64);
        drop(entries_guard);

        assert_eq!(
            worker
                .join()
                .expect("issuer worker")
                .err()
                .expect("expired authority must fail"),
            FixedReadWireError::OperationAuthorityExpired
        );
        let retry = decode_fixed_read_request_v1(&raw).expect("retry candidate");
        assert_eq!(
            issuer
                .issue(&authority, &retry, &credential_snapshot())
                .err()
                .expect("expired authority was already burned"),
            FixedReadWireError::OperationAuthorityMissing
        );
    }

    #[test]
    fn expired_operation_authority_reclaims_bounded_capacity() {
        let request = make_request();
        let raw = raw_request(&request);
        let ttl = Duration::from_millis(10);
        let (issuer, clock) = test_evidence_issuer(1, ttl);
        let _expired = authorize_test_operation(&issuer, &raw).expect("first authority");
        assert_eq!(
            authorize_test_operation(&issuer, &raw)
                .err()
                .expect("live authority must occupy capacity"),
            FixedReadWireError::RegistryFull
        );

        clock.advance(ttl.as_millis() as u64);
        authorize_test_operation(&issuer, &raw).expect("expired authority must be purged");
        assert_eq!(issuer.entries.lock().expect("registry lock").len(), 1);
    }

    #[test]
    fn operation_authority_ttl_starts_after_registry_lock_wait() {
        let request = make_request();
        let raw = Arc::new(raw_request(&request));
        let ttl = Duration::from_millis(10);
        let (issuer, clock) = test_evidence_issuer(32, ttl);
        let issuer = Arc::new(issuer);
        let barrier = Arc::new(Barrier::new(2));
        issuer
            .set_before_entries_lock_for_test(Arc::clone(&barrier))
            .expect("install one-shot lock hook");

        let entries_guard = issuer
            .entries
            .lock()
            .expect("prehold authority registry lock");
        let worker_issuer = Arc::clone(&issuer);
        let worker_raw = Arc::clone(&raw);
        let worker = thread::spawn(move || authorize_test_operation(&worker_issuer, &worker_raw));
        barrier.wait();
        clock.advance(10_000);
        drop(entries_guard);

        let authority = worker
            .join()
            .expect("authorize worker")
            .expect("operation authority");
        let expires_at = issuer
            .entries
            .lock()
            .expect("registry lock")
            .get(&authority.authority_id)
            .expect("authority entry")
            .expires_at;
        assert_eq!(expires_at, Duration::from_millis(10_000) + ttl);
    }

    #[test]
    fn renderer_resigned_digest_mismatch_burns_operation_authority_before_validation() {
        let request = make_request();
        let exact_raw = raw_request(&request);
        let (issuer, _) = test_evidence_issuer(32, Duration::from_secs(30));
        let authority = issuer
            .authorize_for_test(
                decode_fixed_read_request_v1(&exact_raw).expect("trusted operation"),
                "enekobitnhobuiuamvqj".to_owned(),
                "host-account-a".to_owned(),
                GRANT_GENERATION_A.to_owned(),
                READ_CREDENTIAL_INCARNATION_A,
                connection_profile_digest(CONNECTION_PROFILE_A),
            )
            .expect("test authority");

        let mut renderer_resigned = make_request();
        renderer_resigned.bindings.analysis_profile_digest = DIGEST_B.to_owned();
        resign(&mut renderer_resigned);
        let attacker_candidate = decode_fixed_read_request_v1(&raw_request(&renderer_resigned))
            .expect("self-consistent");
        assert_eq!(
            issuer
                .issue(&authority, &attacker_candidate, &credential_snapshot())
                .err()
                .expect("renderer digest must not authenticate provenance"),
            FixedReadWireError::OperationAuthorityMismatch
        );

        let exact_candidate =
            decode_fixed_read_request_v1(&exact_raw).expect("original exact candidate");
        assert_eq!(
            issuer
                .issue(&authority, &exact_candidate, &credential_snapshot())
                .err()
                .expect("mismatch must burn before validation"),
            FixedReadWireError::OperationAuthorityMissing
        );
    }

    #[test]
    fn credential_drift_burns_operation_authority_before_binding_checks() {
        for (grant_generation, incarnation, connection_profile) in [
            (
                GRANT_GENERATION_B,
                READ_CREDENTIAL_INCARNATION_A,
                CONNECTION_PROFILE_A,
            ),
            (
                GRANT_GENERATION_A,
                READ_CREDENTIAL_INCARNATION_B,
                CONNECTION_PROFILE_A,
            ),
            (
                GRANT_GENERATION_A,
                READ_CREDENTIAL_INCARNATION_A,
                CONNECTION_PROFILE_B,
            ),
        ] {
            let request = make_request();
            let raw = raw_request(&request);
            let (issuer, _) = test_evidence_issuer(32, Duration::from_secs(30));
            let authority = issuer
                .authorize_for_test(
                    decode_fixed_read_request_v1(&raw).expect("trusted operation"),
                    "enekobitnhobuiuamvqj".to_owned(),
                    "host-account-a".to_owned(),
                    GRANT_GENERATION_A.to_owned(),
                    READ_CREDENTIAL_INCARNATION_A,
                    connection_profile_digest(CONNECTION_PROFILE_A),
                )
                .expect("test authority");
            let candidate = decode_fixed_read_request_v1(&raw).expect("candidate");
            let drifted =
                credential_snapshot_for(grant_generation, incarnation, connection_profile);
            assert_eq!(
                issuer
                    .issue(&authority, &candidate, &drifted)
                    .err()
                    .expect("credential drift must fail"),
                FixedReadWireError::OperationAuthorityMismatch
            );
            let retry = decode_fixed_read_request_v1(&raw).expect("retry candidate");
            assert_eq!(
                issuer
                    .issue(&authority, &retry, &credential_snapshot())
                    .err()
                    .expect("credential mismatch must burn authority"),
                FixedReadWireError::OperationAuthorityMissing
            );
        }
    }

    #[test]
    fn connection_profile_identity_drift_burns_operation_authority() {
        for (project_ref, account_id) in [
            ("abcdefghijklmnopqrst", "host-account-a"),
            ("enekobitnhobuiuamvqj", "different-account"),
        ] {
            let request = make_request();
            let raw = raw_request(&request);
            let (issuer, _) = test_evidence_issuer(32, Duration::from_secs(30));
            let authority = issuer
                .authorize_for_test(
                    decode_fixed_read_request_v1(&raw).expect("trusted operation"),
                    project_ref.to_owned(),
                    account_id.to_owned(),
                    GRANT_GENERATION_A.to_owned(),
                    READ_CREDENTIAL_INCARNATION_A,
                    connection_profile_digest(CONNECTION_PROFILE_A),
                )
                .expect("test authority");
            let candidate = decode_fixed_read_request_v1(&raw).expect("candidate");
            assert_eq!(
                issuer
                    .issue(&authority, &candidate, &credential_snapshot())
                    .err()
                    .expect("connection-profile identity drift must fail"),
                FixedReadWireError::OperationAuthorityMismatch
            );
            let retry = decode_fixed_read_request_v1(&raw).expect("retry candidate");
            assert_eq!(
                issuer
                    .issue(&authority, &retry, &credential_snapshot())
                    .err()
                    .expect("identity mismatch must burn authority"),
                FixedReadWireError::OperationAuthorityMissing
            );
        }
    }

    #[test]
    fn concurrent_evidence_issuance_has_exactly_one_winner() {
        let request = make_request();
        let raw = Arc::new(raw_request(&request));
        let (issuer, _) = test_evidence_issuer(32, Duration::from_secs(30));
        let issuer = Arc::new(issuer);
        let authority = Arc::new(
            issuer
                .authorize_for_test(
                    decode_fixed_read_request_v1(&raw).expect("trusted operation"),
                    "enekobitnhobuiuamvqj".to_owned(),
                    "host-account-a".to_owned(),
                    GRANT_GENERATION_A.to_owned(),
                    READ_CREDENTIAL_INCARNATION_A,
                    connection_profile_digest(CONNECTION_PROFILE_A),
                )
                .expect("test authority"),
        );
        let workers: Vec<_> = (0..2)
            .map(|_| {
                let raw = raw.clone();
                let issuer = issuer.clone();
                let authority = authority.clone();
                thread::spawn(move || {
                    let candidate = decode_fixed_read_request_v1(&raw).expect("renderer candidate");
                    issuer
                        .issue(&authority, &candidate, &credential_snapshot())
                        .is_ok()
                })
            })
            .collect();
        assert_eq!(
            workers
                .into_iter()
                .map(|worker| worker.join().expect("worker"))
                .filter(|won| *won)
                .count(),
            1
        );
    }

    #[test]
    fn host_grant_generation_requires_a_canonical_uuid_v4() {
        assert!(is_canonical_uuid_v4(GRANT_GENERATION_A));
        for invalid in [
            "",
            "018f47bb4d9b4f158c48f8c8f8f0f0f0",
            "018f47bb-4d9b-1f15-8c48-f8c8f8f0f0f0",
            "018f47bb-4d9b-4f15-7c48-f8c8f8f0f0f0",
            "018F47BB-4D9B-4F15-8C48-F8C8F8F0F0F0",
        ] {
            assert!(!is_canonical_uuid_v4(invalid), "invalid UUID v4: {invalid}");
            assert_eq!(
                HostFixedReadIdentityV1::checked(
                    "enekobitnhobuiuamvqj".to_owned(),
                    "host-account-a".to_owned(),
                    invalid.to_owned(),
                    READ_CREDENTIAL_INCARNATION_A,
                    connection_profile_digest(CONNECTION_PROFILE_A),
                )
                .err()
                .expect("invalid generation must fail"),
                FixedReadWireError::InvalidHostEvidence
            );
        }
        for (incarnation, connection_profile_digest) in [
            ([0; 32], connection_profile_digest(CONNECTION_PROFILE_A)),
            (READ_CREDENTIAL_INCARNATION_A, [0; 32]),
        ] {
            assert_eq!(
                HostFixedReadIdentityV1::checked(
                    "enekobitnhobuiuamvqj".to_owned(),
                    "host-account-a".to_owned(),
                    GRANT_GENERATION_A.to_owned(),
                    incarnation,
                    connection_profile_digest,
                )
                .err()
                .expect("zero credential binding must fail"),
                FixedReadWireError::InvalidHostEvidence
            );
        }
    }

    #[test]
    fn production_session_ids_are_opaque_and_random() {
        let registry = HostFixedReadSessionRegistryV1::new();
        let first_request = make_request();
        let first = registry
            .prepare(
                decode_fixed_read_request_v1(&raw_request(&first_request)).unwrap(),
                evidence_for(&first_request),
            )
            .unwrap();
        let second_request = make_request();
        let second = registry
            .prepare(
                decode_fixed_read_request_v1(&raw_request(&second_request)).unwrap(),
                evidence_for(&second_request),
            )
            .unwrap();
        assert_ne!(first.session_id, second.session_id);
        for id in [first.session_id, second.session_id] {
            assert_eq!(id.len(), 43);
            assert_eq!(URL_SAFE_NO_PAD.decode(id).unwrap().len(), SESSION_ID_BYTES);
        }
    }

    #[test]
    fn registry_is_bounded_and_expired_entries_can_be_replaced() {
        let (registry, clock) = test_registry(1, Duration::from_millis(10));
        let first_request = make_request();
        registry
            .prepare(
                decode_fixed_read_request_v1(&raw_request(&first_request)).unwrap(),
                evidence_for(&first_request),
            )
            .unwrap();
        let second_request = make_request();
        assert_eq!(
            registry
                .prepare(
                    decode_fixed_read_request_v1(&raw_request(&second_request)).unwrap(),
                    evidence_for(&second_request),
                )
                .err()
                .expect("bounded registry must fail closed"),
            FixedReadWireError::RegistryFull
        );
        clock.advance(10);
        let third_request = make_request();
        registry
            .prepare(
                decode_fixed_read_request_v1(&raw_request(&third_request)).unwrap(),
                evidence_for(&third_request),
            )
            .expect("expired entry is purged");
    }

    #[test]
    fn prepare_samples_ttl_only_after_acquiring_the_registry_lock() {
        let ttl = Duration::from_millis(10);
        let (registry, clock) = test_registry(32, ttl);
        let registry = Arc::new(registry);
        let request = make_request();
        let candidate = decode_fixed_read_request_v1(&raw_request(&request)).unwrap();
        let evidence = evidence_for(&request);
        let barrier = Arc::new(Barrier::new(2));
        registry
            .set_before_entries_lock_for_test(Arc::clone(&barrier))
            .expect("install one-shot lock hook");

        let entries_guard = registry.entries.lock().expect("prehold registry lock");
        let worker_registry = Arc::clone(&registry);
        let worker = thread::spawn(move || worker_registry.prepare(candidate, evidence));
        barrier.wait();
        clock.advance(10_000);
        drop(entries_guard);

        let handle = worker.join().expect("prepare worker").expect("prepare");
        let expires_at = registry
            .entries
            .lock()
            .expect("registry lock")
            .get(&handle.session_id)
            .expect("prepared entry")
            .expires_at;
        assert_eq!(expires_at, Duration::from_millis(10_000) + ttl);
    }

    #[test]
    fn consume_resamples_time_after_lock_wait_and_burns_the_expired_entry() {
        let (registry, clock) = test_registry(32, Duration::from_millis(10));
        let registry = Arc::new(registry);
        let request = make_request();
        let handle = registry
            .prepare(
                decode_fixed_read_request_v1(&raw_request(&request)).unwrap(),
                evidence_for(&request),
            )
            .expect("prepare");
        let barrier = Arc::new(Barrier::new(2));
        registry
            .set_before_entries_lock_for_test(Arc::clone(&barrier))
            .expect("install one-shot lock hook");

        let entries_guard = registry.entries.lock().expect("prehold registry lock");
        let worker_registry = Arc::clone(&registry);
        let session_id = handle.session_id.clone();
        let worker =
            thread::spawn(move || worker_registry.consume(&session_id, credential_snapshot()));
        barrier.wait();
        clock.advance(10);
        drop(entries_guard);

        assert_eq!(
            worker
                .join()
                .expect("consume worker")
                .err()
                .expect("expired session must fail"),
            FixedReadWireError::SessionExpired
        );
        assert!(!registry
            .entries
            .lock()
            .expect("registry lock")
            .contains_key(&handle.session_id));
        assert_eq!(
            registry
                .consume(&handle.session_id, credential_snapshot())
                .err()
                .expect("expired session was already burned"),
            FixedReadWireError::SessionMissing
        );
    }

    #[test]
    fn entropy_failure_and_repeated_collision_exhaustion_fail_closed() {
        let (unavailable, _) =
            test_registry_with_entropy(32, Duration::from_secs(30), Arc::new(UnavailableEntropy));
        let unavailable_request = make_request();
        assert_eq!(
            unavailable
                .prepare(
                    decode_fixed_read_request_v1(&raw_request(&unavailable_request)).unwrap(),
                    evidence_for(&unavailable_request),
                )
                .err()
                .expect("unavailable entropy must fail"),
            FixedReadWireError::SessionEntropyUnavailable
        );
        assert!(unavailable.entries.lock().unwrap().is_empty());

        let entropy = Arc::new(ConstantEntropy::new([7; SESSION_ID_BYTES]));
        let (colliding, _) =
            test_registry_with_entropy(32, Duration::from_secs(30), entropy.clone());
        let first_request = make_request();
        let first = colliding
            .prepare(
                decode_fixed_read_request_v1(&raw_request(&first_request)).unwrap(),
                evidence_for(&first_request),
            )
            .expect("first fixed entropy value is unused");
        let second_request = make_request();
        assert_eq!(
            colliding
                .prepare(
                    decode_fixed_read_request_v1(&raw_request(&second_request)).unwrap(),
                    evidence_for(&second_request),
                )
                .err()
                .expect("all collision attempts must be exhausted"),
            FixedReadWireError::SessionIdCollision
        );
        assert_eq!(
            entropy.calls.load(Ordering::SeqCst),
            1 + SESSION_ID_ATTEMPTS,
            "one successful mint plus every bounded collision retry"
        );
        assert_eq!(colliding.entries.lock().unwrap().len(), 1);
        colliding
            .consume(&first.session_id, credential_snapshot())
            .expect("collision exhaustion must not replace the original session");
    }

    #[test]
    fn consume_rejects_noncanonical_session_ids_before_lookup_without_burning_entry() {
        let request = make_request();
        let (registry, _) = test_registry(32, Duration::from_secs(30));
        let handle = registry
            .prepare(
                decode_fixed_read_request_v1(&raw_request(&request)).unwrap(),
                evidence_for(&request),
            )
            .expect("prepare");
        for invalid in [
            String::new(),
            "A".repeat(42),
            format!("{}=", handle.session_id),
            format!("/{}", &handle.session_id[1..]),
            format!("{}B", "A".repeat(42)),
        ] {
            assert_eq!(
                registry
                    .consume(&invalid, credential_snapshot())
                    .err()
                    .expect("non-canonical session identifier must fail"),
                FixedReadWireError::InvalidRequest,
                "invalid session identifier: {invalid}"
            );
        }
        registry
            .consume(&handle.session_id, credential_snapshot())
            .expect("invalid identifiers must not remove the valid session");
    }

    #[test]
    fn consume_burns_before_each_credential_snapshot_binding_check() {
        for (grant_generation, incarnation, connection_profile) in [
            (
                GRANT_GENERATION_B,
                READ_CREDENTIAL_INCARNATION_A,
                CONNECTION_PROFILE_A,
            ),
            (
                GRANT_GENERATION_A,
                READ_CREDENTIAL_INCARNATION_B,
                CONNECTION_PROFILE_A,
            ),
            (
                GRANT_GENERATION_A,
                READ_CREDENTIAL_INCARNATION_A,
                CONNECTION_PROFILE_B,
            ),
        ] {
            let request = make_request();
            let (registry, _) = test_registry(32, Duration::from_secs(30));
            let handle = registry
                .prepare(
                    decode_fixed_read_request_v1(&raw_request(&request)).unwrap(),
                    evidence_for(&request),
                )
                .unwrap();
            let mismatched_snapshot =
                credential_snapshot_for(grant_generation, incarnation, connection_profile);
            assert_eq!(
                registry
                    .consume(&handle.session_id, mismatched_snapshot)
                    .err()
                    .unwrap(),
                FixedReadWireError::HostEvidenceMismatch
            );
            assert_eq!(
                registry
                    .consume(&handle.session_id, credential_snapshot())
                    .err()
                    .unwrap(),
                FixedReadWireError::SessionMissing
            );
        }
    }

    #[test]
    fn consume_burns_on_project_or_account_profile_drift() {
        for connection_profile in [
            CONNECTION_PROFILE_OTHER_PROJECT,
            CONNECTION_PROFILE_OTHER_ACCOUNT,
        ] {
            let request = make_request();
            let (registry, _) = test_registry(32, Duration::from_secs(30));
            let handle = registry
                .prepare(
                    decode_fixed_read_request_v1(&raw_request(&request)).unwrap(),
                    evidence_for_identity(
                        &request,
                        GRANT_GENERATION_A,
                        READ_CREDENTIAL_INCARNATION_A,
                        connection_profile_digest(connection_profile),
                    ),
                )
                .expect("prepare identity-bound session");

            assert_eq!(
                registry
                    .consume(
                        &handle.session_id,
                        credential_snapshot_for(
                            GRANT_GENERATION_A,
                            READ_CREDENTIAL_INCARNATION_A,
                            connection_profile,
                        ),
                    )
                    .err()
                    .expect("profile identity drift must fail closed"),
                FixedReadWireError::HostEvidenceMismatch
            );
            assert_eq!(
                registry
                    .consume(&handle.session_id, credential_snapshot())
                    .err()
                    .expect("identity mismatch must burn the one-shot session"),
                FixedReadWireError::SessionMissing
            );
        }
    }

    #[test]
    fn expiry_burns_and_success_returns_an_unrun_one_shot_session() {
        let request = make_request();
        let (registry, clock) = test_registry(32, Duration::from_millis(10));
        let handle = registry
            .prepare(
                decode_fixed_read_request_v1(&raw_request(&request)).unwrap(),
                evidence_for(&request),
            )
            .unwrap();
        clock.advance(10);
        assert_eq!(
            registry
                .consume(&handle.session_id, credential_snapshot())
                .err()
                .unwrap(),
            FixedReadWireError::SessionExpired
        );
        assert_eq!(
            registry
                .consume(&handle.session_id, credential_snapshot())
                .err()
                .unwrap(),
            FixedReadWireError::SessionMissing
        );

        let fresh_request = make_request();
        let fresh = registry
            .prepare(
                decode_fixed_read_request_v1(&raw_request(&fresh_request)).unwrap(),
                evidence_for(&fresh_request),
            )
            .unwrap();
        let credential_snapshot = credential_snapshot();
        let password_address = credential_snapshot.password().as_ptr();
        let consumed = registry
            .consume(&fresh.session_id, credential_snapshot)
            .unwrap();
        assert_eq!(
            consumed.credential_snapshot.password().as_ptr(),
            password_address,
            "the zeroizing password allocation must move into the consumed session"
        );
        assert_eq!(
            consumed.credential_snapshot.password(),
            DATABASE_READ_PASSWORD
        );
        assert_eq!(consumed.request_digest, fresh.request_digest);
        assert_eq!(consumed.host_identity.project_ref, "enekobitnhobuiuamvqj");
        assert_eq!(consumed.host_identity.account_id, "host-account-a");
        assert_eq!(consumed.host_identity.grant_generation, GRANT_GENERATION_A);
        assert_eq!(
            consumed.host_identity.read_credential_incarnation,
            READ_CREDENTIAL_INCARNATION_A
        );
        assert_eq!(
            consumed.host_identity.connection_profile_digest,
            connection_profile_digest(CONNECTION_PROFILE_A)
        );
        assert_eq!(consumed.authority, DormantFixedReadAuthorityV1::NONE);
        assert!(!consumed.session.has_been_consumed());
    }

    #[test]
    fn consumed_runner_uses_only_the_retained_host_identity_and_binds_request_digest() {
        let request = make_request();
        let expected_request_digest = decode_digest(&request.request_digest).unwrap();
        let (registry, _) = test_registry(32, Duration::from_secs(30));
        let handle = registry
            .prepare(
                decode_fixed_read_request_v1(&raw_request(&request)).unwrap(),
                evidence_for(&request),
            )
            .expect("prepare");
        let session_id = handle.session_id.clone();
        let consumed = registry
            .consume(&session_id, credential_snapshot())
            .expect("consume");
        let password_address = consumed.credential_snapshot.password().as_ptr() as usize;
        let _owned_runner = ConsumedFixedReadSessionV1::run::<RunnerConnector>;

        let connector = RunnerConnector::successful();
        let future = consumed.run(&connector);
        assert_send(&future);
        let result = block_on(future).expect("fixed read");
        let observation = connector.observation.lock().expect("observation lock");
        let identity = observation
            .begin_identity
            .as_ref()
            .expect("retained identity reaches database session");
        assert_eq!(identity.project_ref(), "enekobitnhobuiuamvqj");
        assert_eq!(identity.account_id(), "host-account-a");
        assert_eq!(identity.grant_generation(), GRANT_GENERATION_A);
        assert_eq!(
            identity.read_credential_incarnation(),
            READ_CREDENTIAL_INCARNATION_A
        );
        assert_eq!(
            identity.connection_profile_digest(),
            connection_profile_digest(CONNECTION_PROFILE_A)
        );
        assert_eq!(observation.connect_count, 1);
        assert!(observation.database_created);
        assert!(observation.password_matches);
        assert_eq!(observation.password_address, password_address);
        assert_eq!(observation.profile_project_ref, "enekobitnhobuiuamvqj");
        assert_eq!(observation.profile_account_id, "host-account-a");
        assert_eq!(observation.profile_mode, "direct");
        assert_eq!(
            observation.profile_host,
            "db.enekobitnhobuiuamvqj.supabase.co"
        );
        assert_eq!(observation.profile_port, 5_432);
        assert_eq!(observation.profile_database, "postgres");
        assert_eq!(observation.profile_user, "postgres");
        assert_eq!(observation.profile_tls_mode, "verify-full");
        assert_eq!(result.request_digest, expected_request_digest);
        assert_eq!(result.request_digest, handle.request_digest);
        assert_eq!(result.fixed_read.query, RECEIPT_ZERO_QUERY_IDENTITY_V1);
        assert_eq!(
            result.fixed_read.parameter_values_digest.0,
            decode_digest(&request.bindings.parameter_values_digest).unwrap()
        );
        assert_eq!(result.fixed_read.response_row, br#"{"inputValid":true}"#);
        assert_eq!(
            result.fixed_read.response_byte_length,
            br#"{"inputValid":true}"#.len()
        );
        assert_eq!(
            result.fixed_read.authority,
            FixedReadAuthorityClaimsV1::NONE
        );
        assert_eq!(result.authority, DormantFixedReadAuthorityV1::NONE);
        assert_eq!(observation.finish_count, 1);
        assert_eq!(observation.abort_count, 0);
        drop(observation);
        assert_eq!(
            registry
                .consume(&session_id, credential_snapshot())
                .err()
                .expect("successful registry consumption is one-shot"),
            FixedReadWireError::SessionMissing
        );
    }

    #[test]
    fn consumed_runner_failure_burns_the_registry_session_without_identity_override() {
        let request = make_request();
        let (registry, _) = test_registry(32, Duration::from_secs(30));
        let handle = registry
            .prepare(
                decode_fixed_read_request_v1(&raw_request(&request)).unwrap(),
                evidence_for(&request),
            )
            .expect("prepare");
        let session_id = handle.session_id;
        let consumed = registry
            .consume(&session_id, credential_snapshot())
            .expect("consume");
        let connector = RunnerConnector::failing_database(FixedReadStage::SearchPath);

        let failure = match block_on(consumed.run(&connector)) {
            Ok(_) => panic!("database failure must fail closed"),
            Err(error) => error,
        };
        assert_eq!(
            failure,
            FixedReadError::Database {
                stage: FixedReadStage::SearchPath,
                failure: FixedReadDatabaseFailure::Rejected,
            }
        );
        let observation = connector.observation.lock().expect("observation lock");
        let identity = observation
            .begin_identity
            .as_ref()
            .expect("retained identity was used before failure");
        assert_eq!(identity.project_ref(), "enekobitnhobuiuamvqj");
        assert_eq!(identity.account_id(), "host-account-a");
        assert_eq!(identity.grant_generation(), GRANT_GENERATION_A);
        assert_eq!(
            identity.read_credential_incarnation(),
            READ_CREDENTIAL_INCARNATION_A
        );
        assert_eq!(
            identity.connection_profile_digest(),
            connection_profile_digest(CONNECTION_PROFILE_A)
        );
        assert_eq!(observation.connect_count, 1);
        assert!(observation.database_created);
        assert_eq!(observation.abort_count, 1);
        assert_eq!(observation.finish_count, 0);
        drop(observation);
        assert_eq!(
            registry
                .consume(&session_id, credential_snapshot())
                .err()
                .expect("failed runner cannot remint the consumed session"),
            FixedReadWireError::SessionMissing
        );
    }

    #[test]
    fn connector_failure_is_fixed_redacted_and_burns_without_database_execution() {
        let request = make_request();
        let (registry, _) = test_registry(32, Duration::from_secs(30));
        let handle = registry
            .prepare(
                decode_fixed_read_request_v1(&raw_request(&request)).unwrap(),
                evidence_for(&request),
            )
            .expect("prepare");
        let session_id = handle.session_id;
        let consumed = registry
            .consume(&session_id, credential_snapshot())
            .expect("consume");
        let connector = RunnerConnector::failing_connection(FixedReadDatabaseFailure::Rejected);

        let failure = block_on(consumed.run(&connector))
            .err()
            .expect("connector failure must fail closed");
        assert_eq!(
            failure,
            FixedReadError::Database {
                stage: FixedReadStage::Connect,
                failure: FixedReadDatabaseFailure::Rejected,
            }
        );
        let rendered = format!("{failure:?}");
        assert!(!rendered.contains(DATABASE_READ_PASSWORD));
        assert!(!rendered.contains("db.enekobitnhobuiuamvqj.supabase.co"));
        let observation = connector.observation.lock().expect("observation lock");
        assert_eq!(observation.connect_count, 1);
        assert!(observation.password_matches);
        assert_eq!(
            observation.profile_host,
            "db.enekobitnhobuiuamvqj.supabase.co"
        );
        assert!(!observation.database_created);
        assert!(observation.begin_identity.is_none());
        assert_eq!(observation.abort_count, 0);
        assert_eq!(observation.finish_count, 0);
        drop(observation);
        assert_eq!(
            registry
                .consume(&session_id, credential_snapshot())
                .err()
                .expect("connection failure cannot remint the burned session"),
            FixedReadWireError::SessionMissing
        );
    }

    #[test]
    fn pending_connect_is_preempted_by_host_deadline_or_cancellation_and_dropped() {
        for cancel in [false, true] {
            let (registry, session_id, consumed) = consumed_runner_session();
            let entered = Arc::new(Barrier::new(2));
            let connector = RunnerConnector::pending_connect(Arc::clone(&entered));
            let interrupts = Arc::clone(&connector.interrupts);
            let observation = Arc::clone(&connector.observation);
            let worker = thread::spawn(move || block_on(consumed.run(&connector)));

            entered.wait();
            if cancel {
                interrupts.cancel();
            } else {
                interrupts.advance(FIXED_CONNECT_TIMEOUT);
            }
            let failure = match worker.join().expect("runner thread") {
                Ok(_) => panic!("pending connect must be preempted"),
                Err(error) => error,
            };
            assert_eq!(
                failure,
                if cancel {
                    FixedReadError::Cancelled
                } else {
                    FixedReadError::Database {
                        stage: FixedReadStage::Connect,
                        failure: FixedReadDatabaseFailure::TimedOut,
                    }
                }
            );
            let observation = observation.lock().expect("observation lock");
            assert_eq!(observation.connect_count, 1);
            assert!(observation.password_matches);
            assert!(!observation.database_created);
            assert!(observation.begin_identity.is_none());
            assert_eq!(
                observation.lifecycle_events,
                ["connect-polled", "connect-future-dropped"]
            );
            drop(observation);
            assert_eq!(
                registry
                    .consume(&session_id, credential_snapshot())
                    .err()
                    .expect("preempted connect cannot remint the consumed session"),
                FixedReadWireError::SessionMissing
            );
        }
    }

    #[test]
    fn pending_query_is_preempted_and_dropped_before_cancel_then_abort() {
        for cancel in [false, true] {
            let (registry, session_id, consumed) = consumed_runner_session();
            let entered = Arc::new(Barrier::new(2));
            let connector = RunnerConnector::pending_execute(Arc::clone(&entered));
            let interrupts = Arc::clone(&connector.interrupts);
            let observation = Arc::clone(&connector.observation);
            let worker = thread::spawn(move || block_on(consumed.run(&connector)));

            entered.wait();
            if cancel {
                interrupts.cancel();
            } else {
                interrupts.advance(FIXED_OVERALL_TIMEOUT);
            }
            let failure = match worker.join().expect("runner thread") {
                Ok(_) => panic!("pending execute must be preempted"),
                Err(error) => error,
            };
            assert_eq!(
                failure,
                if cancel {
                    FixedReadError::Cancelled
                } else {
                    FixedReadError::Database {
                        stage: FixedReadStage::Execute,
                        failure: FixedReadDatabaseFailure::TimedOut,
                    }
                }
            );
            let observation = observation.lock().expect("observation lock");
            assert!(observation.database_created);
            assert!(observation.begin_identity.is_some());
            assert_eq!(observation.cancel_count, 1);
            assert_eq!(observation.abort_count, 1);
            assert_eq!(observation.finish_count, 0);
            assert_eq!(
                observation.lifecycle_events,
                [
                    "execute-polled",
                    "execute-future-dropped",
                    "cancel",
                    "abort"
                ]
            );
            drop(observation);
            assert_eq!(
                registry
                    .consume(&session_id, credential_snapshot())
                    .err()
                    .expect("preempted query cannot remint the consumed session"),
                FixedReadWireError::SessionMissing
            );
        }
    }

    #[test]
    fn concurrent_consumers_have_exactly_one_winner() {
        let request = make_request();
        let (registry, _) = test_registry(32, Duration::from_secs(30));
        let registry = Arc::new(registry);
        let handle = registry
            .prepare(
                decode_fixed_read_request_v1(&raw_request(&request)).unwrap(),
                evidence_for(&request),
            )
            .unwrap();
        let session_id = Arc::new(handle.session_id);
        let workers: Vec<_> = (0..2)
            .map(|_| {
                let registry = registry.clone();
                let session_id = session_id.clone();
                thread::spawn(move || registry.consume(&session_id, credential_snapshot()).is_ok())
            })
            .collect();
        assert_eq!(
            workers
                .into_iter()
                .map(|worker| worker.join().expect("worker"))
                .filter(|won| *won)
                .count(),
            1
        );
    }

    #[test]
    fn wire_source_has_no_command_network_secret_or_execution_authority() {
        let source = include_str!("wire.rs");
        let production_source = source
            .split_once("#[cfg(test)]\nmod tests")
            .expect("test module boundary")
            .0;
        let forbidden = [
            ["tauri", "command"].join("::"),
            ["req", "west"].concat(),
            ["tokio", "postgres"].join("_"),
            ["connection", "string"].join("_"),
            ["personal", "access", "token"].join("_"),
            ["service", "role"].join("_"),
            ["endpoint", "override"].join("_"),
            ["with", "recursive"].join(" ").to_uppercase(),
        ];
        for forbidden in forbidden {
            assert!(
                !source.contains(&forbidden),
                "forbidden source: {forbidden}"
            );
        }
        for sensitive_struct in [
            "HostFixedReadIdentityV1",
            "HostFixedReadEvidenceV1",
            "ReceiptZeroReconciliationAuthorityV1",
            "ReceiptZeroReconciliationAuthorityEntryV1",
            "HostFixedReadEvidenceIssuerV1",
            "SessionEntryV1",
            "FixedReadSessionHandleV1",
            "ConsumedFixedReadSessionV1",
            "ConsumedFixedReadResultV1",
            "HostFixedReadSessionRegistryV1",
        ] {
            let declaration = format!("struct {sensitive_struct}");
            let declaration_offset = source.find(&declaration).expect("sensitive struct exists");
            let prefix = &source[declaration_offset.saturating_sub(160)..declaration_offset];
            let adjacent_derive = prefix
                .rsplit_once("#[derive(")
                .map(|(_, derive)| derive)
                .filter(|derive| !derive.contains("\n\n"));
            assert!(
                !adjacent_derive.is_some_and(|derive| derive.contains("Debug")),
                "sensitive struct must not derive Debug: {sensitive_struct}"
            );
        }
        for capability_struct in [
            "ReceiptZeroReconciliationAuthorityV1",
            "ReceiptZeroReconciliationAuthorityEntryV1",
            "HostFixedReadEvidenceIssuerV1",
        ] {
            let declaration = format!("struct {capability_struct}");
            let declaration_offset = source.find(&declaration).expect("capability struct exists");
            let prefix = &source[declaration_offset.saturating_sub(160)..declaration_offset];
            let adjacent_derive = prefix
                .rsplit_once("#[derive(")
                .map(|(_, derive)| derive)
                .filter(|derive| !derive.contains("\n\n"));
            for forbidden_trait in ["Clone", "Debug", "Serialize", "Deserialize"] {
                assert!(
                    !adjacent_derive.is_some_and(|derive| derive.contains(forbidden_trait)),
                    "capability struct must not derive {forbidden_trait}: {capability_struct}"
                );
            }
        }
        assert!(source.contains("trait HostFixedReadDatabaseConnectorV1:"));
        assert!(source.contains("host_fixed_read_database_connector::Sealed"));
        assert!(source.contains("type InterruptSource: FixedReadInterruptSourceV1;"));
        let connector_trait = production_source
            .split_once("trait HostFixedReadDatabaseConnectorV1:")
            .expect("connector trait")
            .1
            .split_once("pub(super) struct ConsumedFixedReadSessionV1")
            .expect("consumed session boundary")
            .0;
        assert!(connector_trait.contains("host_fixed_read_database_connector::Sealed + Sync"));
        assert!(connector_trait.contains("fn connect<'a>("));
        assert!(connector_trait.contains("impl Future<Output = Result<Self::Session"));
        assert!(connector_trait.contains("+ Send + 'a"));
        assert!(!connector_trait.contains("async fn connect("));
        assert!(
            !production_source.contains("impl HostFixedReadDatabaseConnectorV1 for"),
            "production must not add a database driver through the connector seam"
        );
        assert!(
            !production_source.contains("impl FixedReadInterruptSourceV1 for"),
            "production must not claim a wall-clock or cancellation implementation while dormant"
        );
        let consumed_impl = production_source
            .split_once("impl ConsumedFixedReadSessionV1")
            .expect("consumed implementation")
            .1
            .split_once("pub(super) struct HostFixedReadSessionRegistryV1")
            .expect("registry boundary")
            .0;
        assert!(!consumed_impl.contains("database: &mut"));
        assert!(!consumed_impl.contains("connection_identity:"));
        assert!(!consumed_impl.contains("endpoint:"));
        let run_signature = consumed_impl
            .split_once("pub(super) async fn run")
            .expect("async consumed runner")
            .1
            .split_once('{')
            .expect("runner body")
            .0;
        assert!(run_signature.contains("connector: &D"));
        assert!(!run_signature.contains("database:"));
        assert!(!run_signature.contains("deadline"));
        assert!(!run_signature.contains("timeout"));
        assert!(!run_signature.contains("cancellation"));
        assert_eq!(DormantFixedReadAuthorityV1::NONE.release_ready, false);
    }
}
