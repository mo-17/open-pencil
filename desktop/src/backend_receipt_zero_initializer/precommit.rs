//! Production-compiled, privately unreachable Receipt-zero CAS precommit kernel.
//!
//! The only SQL source is the reviewed checked-in SQL artifact. This module pins those exact bytes,
//! validates the 28-position typed parameter contract, and fixes the transaction stage order and
//! resource limits. It intentionally has no production constructor, database adapter, credential
//! resolver, journal transition, or caller.

use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine as _,
};
use sha2::{Digest, Sha256};
use std::time::Duration;

#[cfg(test)]
use crate::backend_operation_journal::{
    validate_receipt_zero_initializer_material_for_runner_for_test,
    ReceiptZeroInitializerClaimMaterialV1, ReceiptZeroInitializerLiveExecutionCeilingV1,
};

const SQL_SOURCE: &str = include_str!(
    "../../../src/app/plugins/host/deployment/supabase/backfill/receipt/zero/cas/v1.sql"
);
const SQL_BYTE_LENGTH: usize = 23_004;
const SQL_SHA256: [u8; 32] = [
    0x44, 0xeb, 0x73, 0x52, 0xea, 0x9a, 0x49, 0x0f, 0x12, 0x41, 0xaf, 0x81, 0xe3, 0xd7, 0x56, 0x7b,
    0xd9, 0x4f, 0xd4, 0x5d, 0x93, 0x72, 0xed, 0x30, 0x96, 0x35, 0x45, 0x69, 0xa6, 0xc0, 0x72, 0x17,
];
const QUERY_ID: &str = "backfill-receipt-zero-cas";
const QUERY_VERSION: &str = "openpencil-supabase-backfill-receipt-zero-cas-v1";
#[cfg(test)]
const JOURNAL_TRANSACTION_FORMAT: &str =
    "openpencil.native-supabase-backfill-receipt-zero-transaction.v1";
#[cfg(test)]
const PARAMETER_SCHEMA_DIGEST: &str = "3j14xx4T8NmZ8gNpc3OlylDz4zSt3sIj2zVnykaHumo";
const PARAMETER_COUNT: usize = 28;
const STATEMENT_COUNT: u8 = 1;
const STATEMENT_TIMEOUT_MS: u32 = 15_000;
const LOCK_TIMEOUT_MS: u32 = 5_000;
// Leaves settlement margin inside the journal's 30-second one-shot capability. A future
// composition must additionally clamp this against the journal's same-clock remaining TTL.
const OVERALL_TIMEOUT: Duration = Duration::from_secs(25);
const MAXIMUM_SQL_BYTES: usize = 32 * 1_024;
const MAXIMUM_PARAMETER_STRING_BYTES: usize = 87_384;
const MAXIMUM_AGGREGATE_PARAMETER_BYTES: usize = 256 * 1_024;
const MAXIMUM_CANONICAL_DOCUMENT_BYTES: usize = 65_536;
const MAXIMUM_RESPONSE_ROWS: u8 = 1;
const MAXIMUM_RESPONSE_COLUMNS: u8 = 1;
const MAXIMUM_RESPONSE_BYTES: usize = 64;
const MAXIMUM_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
const MAXIMUM_BATCH_COUNT: i32 = 9_999;
const REMAINING_PRODUCTION_BLOCKERS: &[&str] = &[
    "production-constructor-unavailable",
    "journal-outcome-unknown-precommit-unavailable",
    "capture-consumption-unavailable",
    "credential-lease-unavailable",
    "database-adapter-unavailable",
    "server-cancellation-not-certified",
    "candidate-commit-time-untrusted",
    "response-authentication-unavailable",
    "receipt-v2-issuer-unavailable",
    "reconciliation-settlement-recovery-unavailable",
    "release-authority-unavailable",
];
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ParameterTypeV1 {
    Text,
    Int8,
    Int4,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ParameterEncodingV1 {
    Identifier,
    Digest,
    StandardBase64,
    Decimal,
    CanonicalUtcMillis,
    ExecutionStatus,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ParameterSpecV1 {
    position: u8,
    name: &'static str,
    parameter_type: ParameterTypeV1,
    nullable: bool,
    encoding: ParameterEncodingV1,
}

const fn parameter(
    position: u8,
    name: &'static str,
    parameter_type: ParameterTypeV1,
    nullable: bool,
    encoding: ParameterEncodingV1,
) -> ParameterSpecV1 {
    ParameterSpecV1 {
        position,
        name,
        parameter_type,
        nullable,
        encoding,
    }
}

const PARAMETER_SCHEMA: [ParameterSpecV1; PARAMETER_COUNT] = [
    parameter(
        1,
        "executionId",
        ParameterTypeV1::Text,
        false,
        ParameterEncodingV1::Identifier,
    ),
    parameter(
        2,
        "applicationId",
        ParameterTypeV1::Text,
        false,
        ParameterEncodingV1::Identifier,
    ),
    parameter(
        3,
        "applicationDigest",
        ParameterTypeV1::Text,
        false,
        ParameterEncodingV1::Digest,
    ),
    parameter(
        4,
        "migrationId",
        ParameterTypeV1::Text,
        false,
        ParameterEncodingV1::Identifier,
    ),
    parameter(
        5,
        "migrationDigest",
        ParameterTypeV1::Text,
        false,
        ParameterEncodingV1::Digest,
    ),
    parameter(
        6,
        "migrationPlanDigest",
        ParameterTypeV1::Text,
        false,
        ParameterEncodingV1::Digest,
    ),
    parameter(
        7,
        "providerAuthorityDigest",
        ParameterTypeV1::Text,
        false,
        ParameterEncodingV1::Digest,
    ),
    parameter(
        8,
        "sourceLedgerDigest",
        ParameterTypeV1::Text,
        false,
        ParameterEncodingV1::Digest,
    ),
    parameter(
        9,
        "scopeDigest",
        ParameterTypeV1::Text,
        false,
        ParameterEncodingV1::Digest,
    ),
    parameter(
        10,
        "resourceIdentityDigest",
        ParameterTypeV1::Text,
        false,
        ParameterEncodingV1::Digest,
    ),
    parameter(
        11,
        "catalogPreconditionDigest",
        ParameterTypeV1::Text,
        false,
        ParameterEncodingV1::Digest,
    ),
    parameter(
        12,
        "canonicalScopeBase64",
        ParameterTypeV1::Text,
        false,
        ParameterEncodingV1::StandardBase64,
    ),
    parameter(
        13,
        "captureDigest",
        ParameterTypeV1::Text,
        false,
        ParameterEncodingV1::Digest,
    ),
    parameter(
        14,
        "capturedHighWater",
        ParameterTypeV1::Int8,
        true,
        ParameterEncodingV1::Decimal,
    ),
    parameter(
        15,
        "initialRemainingEligibleRowCount",
        ParameterTypeV1::Int8,
        false,
        ParameterEncodingV1::Decimal,
    ),
    parameter(
        16,
        "initialRemainingTargetRowCount",
        ParameterTypeV1::Int8,
        false,
        ParameterEncodingV1::Decimal,
    ),
    parameter(
        17,
        "requiredMatchedRowCount",
        ParameterTypeV1::Int8,
        true,
        ParameterEncodingV1::Decimal,
    ),
    parameter(
        18,
        "requiredBatchCount",
        ParameterTypeV1::Int4,
        false,
        ParameterEncodingV1::Decimal,
    ),
    parameter(
        19,
        "batchSize",
        ParameterTypeV1::Int4,
        false,
        ParameterEncodingV1::Decimal,
    ),
    parameter(
        20,
        "initialExecutionStatus",
        ParameterTypeV1::Text,
        false,
        ParameterEncodingV1::ExecutionStatus,
    ),
    parameter(
        21,
        "candidateCommittedAt",
        ParameterTypeV1::Text,
        false,
        ParameterEncodingV1::CanonicalUtcMillis,
    ),
    parameter(
        22,
        "eventId",
        ParameterTypeV1::Text,
        false,
        ParameterEncodingV1::Identifier,
    ),
    parameter(
        23,
        "receiptId",
        ParameterTypeV1::Text,
        false,
        ParameterEncodingV1::Identifier,
    ),
    parameter(
        24,
        "idempotencyKey",
        ParameterTypeV1::Text,
        false,
        ParameterEncodingV1::Identifier,
    ),
    parameter(
        25,
        "requestDigest",
        ParameterTypeV1::Text,
        false,
        ParameterEncodingV1::Digest,
    ),
    parameter(
        26,
        "receiptDigest",
        ParameterTypeV1::Text,
        false,
        ParameterEncodingV1::Digest,
    ),
    parameter(
        27,
        "canonicalReceiptBase64",
        ParameterTypeV1::Text,
        false,
        ParameterEncodingV1::StandardBase64,
    ),
    parameter(
        28,
        "unauthenticatedOperationEvidenceDigest",
        ParameterTypeV1::Text,
        false,
        ParameterEncodingV1::Digest,
    ),
];

#[derive(Clone, Debug, PartialEq, Eq)]
enum BoundParameterValueV1 {
    Text(String),
    Int8(Option<i64>),
    Int4(i32),
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
    RefusedStatus(ReceiptZeroStatusV1),
}

impl PrecommitContractErrorV1 {
    const fn automatic_retry_allowed(self) -> bool {
        false
    }

    const fn requires_read_only_reconciliation(self) -> bool {
        matches!(
            self,
            Self::CommitOutcomeUnknown { .. }
                | Self::Database {
                    stage: TransactionStageV1::Commit,
                    failure: DatabaseFailureV1::Rejected,
                }
        )
    }
}

#[derive(Clone, Copy)]
struct FixedStatementArtifactV1;

impl FixedStatementArtifactV1 {
    fn source(&self) -> Result<&'static str, PrecommitContractErrorV1> {
        fixed_sql_source()
    }

    const fn query_id(&self) -> &'static str {
        QUERY_ID
    }

    const fn query_version(&self) -> &'static str {
        QUERY_VERSION
    }

    const fn byte_length(&self) -> usize {
        SQL_BYTE_LENGTH
    }

    const fn sha256(&self) -> [u8; 32] {
        SQL_SHA256
    }

    fn validate(&self) -> Result<(), PrecommitContractErrorV1> {
        let source = self.source()?;
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
            "FOR UPDATE OF \"execution\" NOWAIT",
            "FOR UPDATE OF \"head\" NOWAIT",
            "FOR UPDATE OF \"receipt\" NOWAIT",
            "INSERT INTO \"openpencil_release\".\"backfill_executions_v1\"",
            "INSERT INTO \"openpencil_release\".\"backfill_receipts_v2\"",
            "INSERT INTO \"openpencil_release\".\"backfill_heads_v1\"",
        ];
        let placeholders_are_complete =
            (1..=PARAMETER_COUNT).all(|position| source.contains(&format!("${position}::")));
        if source.len() != SQL_BYTE_LENGTH
            || source.len() > MAXIMUM_SQL_BYTES
            || <[u8; 32]>::from(Sha256::digest(source.as_bytes())) != SQL_SHA256
            || !source.starts_with("-- OpenPencil Supabase Receipt-zero CAS statement review v1.\n")
            || !source.ends_with("END = 1;\n")
            || source.contains('\0')
            || source.contains("${")
            || source.contains("$29::")
            || statement_semicolons != usize::from(STATEMENT_COUNT)
            || !placeholders_are_complete
            || required_fragments
                .iter()
                .any(|fragment| !source.contains(fragment))
            || source.contains("\nBEGIN")
            || source.contains("\nCOMMIT")
            || source.contains("\nROLLBACK")
        {
            return Err(PrecommitContractErrorV1::InvalidStaticStatement);
        }
        Ok(())
    }
}

fn fixed_sql_source() -> Result<&'static str, PrecommitContractErrorV1> {
    Ok(SQL_SOURCE)
}

fn validate_parameters(parameters: &[BoundParameterV1]) -> Result<(), PrecommitContractErrorV1> {
    if parameters.len() != PARAMETER_SCHEMA.len() {
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

    for (digest_position, document_position) in [(9, 12), (26, 27)] {
        let digest = text(parameters, digest_position)?;
        let document = text(parameters, document_position)?;
        let decoded = STANDARD
            .decode(document)
            .map_err(|_| PrecommitContractErrorV1::InvalidParameterContract)?;
        if URL_SAFE_NO_PAD.encode(Sha256::digest(&decoded)) != digest {
            return Err(PrecommitContractErrorV1::InvalidParameterContract);
        }
    }

    let captured_high_water = int8(parameters, 14)?;
    let eligible =
        int8(parameters, 15)?.ok_or(PrecommitContractErrorV1::InvalidParameterContract)?;
    let target = int8(parameters, 16)?.ok_or(PrecommitContractErrorV1::InvalidParameterContract)?;
    let matched = int8(parameters, 17)?;
    let required_batches = int4(parameters, 18)?;
    let batch_size = int4(parameters, 19)?;
    let expected_batches = if eligible == 0 {
        0
    } else {
        i32::try_from((eligible - 1) / i64::from(batch_size) + 1)
            .map_err(|_| PrecommitContractErrorV1::InvalidParameterContract)?
    };
    if (captured_high_water.is_none() != (eligible == 0))
        || captured_high_water.is_some_and(|value| !(0..=MAXIMUM_SAFE_INTEGER).contains(&value))
        || !(0..=MAXIMUM_SAFE_INTEGER).contains(&eligible)
        || !(0..=eligible).contains(&target)
        || matched.is_some_and(|value| !(0..=target).contains(&value))
        || !(0..=MAXIMUM_BATCH_COUNT).contains(&required_batches)
        || !(1..=1_000).contains(&batch_size)
        || required_batches != expected_batches
        || eligible > i64::from(batch_size) * i64::from(MAXIMUM_BATCH_COUNT)
    {
        return Err(PrecommitContractErrorV1::InvalidParameterContract);
    }
    Ok(())
}

fn validate_parameter_value(
    value: &BoundParameterValueV1,
    spec: ParameterSpecV1,
) -> Result<usize, PrecommitContractErrorV1> {
    match (spec.parameter_type, value) {
        (ParameterTypeV1::Text, BoundParameterValueV1::Text(value)) => {
            if value.is_empty()
                || value.len() > MAXIMUM_PARAMETER_STRING_BYTES
                || value.chars().any(char::is_control)
            {
                return Err(PrecommitContractErrorV1::InvalidParameterContract);
            }
            let valid = match spec.encoding {
                ParameterEncodingV1::Identifier => valid_identifier(value),
                ParameterEncodingV1::Digest => valid_digest(value),
                ParameterEncodingV1::StandardBase64 => valid_canonical_document(value),
                ParameterEncodingV1::CanonicalUtcMillis => valid_canonical_utc_millis(value),
                ParameterEncodingV1::ExecutionStatus => {
                    matches!(value.as_str(), "running" | "completed")
                }
                ParameterEncodingV1::Decimal => false,
            };
            if !valid {
                return Err(PrecommitContractErrorV1::InvalidParameterContract);
            }
            Ok(value.len())
        }
        (ParameterTypeV1::Int8, BoundParameterValueV1::Int8(value)) => {
            if value.is_none() && !spec.nullable {
                return Err(PrecommitContractErrorV1::InvalidParameterContract);
            }
            Ok(value.map_or(0, |number| number.to_string().len()))
        }
        (ParameterTypeV1::Int4, BoundParameterValueV1::Int4(value)) => Ok(value.to_string().len()),
        _ => Err(PrecommitContractErrorV1::InvalidParameterContract),
    }
}

fn valid_identifier(value: &str) -> bool {
    value.len() <= 128
        && value
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._:-".contains(&byte))
}

fn valid_digest(value: &str) -> bool {
    value.len() == 43
        && URL_SAFE_NO_PAD
            .decode(value)
            .is_ok_and(|bytes| bytes.len() == 32 && URL_SAFE_NO_PAD.encode(&bytes) == value)
}

fn valid_canonical_document(value: &str) -> bool {
    STANDARD.decode(value).is_ok_and(|bytes| {
        (2..=MAXIMUM_CANONICAL_DOCUMENT_BYTES).contains(&bytes.len())
            && STANDARD.encode(&bytes) == value
            && std::str::from_utf8(&bytes).is_ok()
    })
}

fn valid_canonical_utc_millis(value: &str) -> bool {
    if value.len() != 24 {
        return false;
    }
    let bytes = value.as_bytes();
    if bytes[4] != b'-'
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
    let number = |start: usize, end: usize| value[start..end].parse::<u32>().ok();
    let (Some(year), Some(month), Some(day), Some(hour), Some(minute), Some(second)) = (
        number(0, 4),
        number(5, 7),
        number(8, 10),
        number(11, 13),
        number(14, 16),
        number(17, 19),
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
    year > 0 && (1..=maximum_day).contains(&day) && hour < 24 && minute < 60 && second < 60
}

fn int8(
    parameters: &[BoundParameterV1],
    position: usize,
) -> Result<Option<i64>, PrecommitContractErrorV1> {
    match &parameters[position - 1].value {
        BoundParameterValueV1::Int8(value) => Ok(*value),
        _ => Err(PrecommitContractErrorV1::InvalidParameterContract),
    }
}

fn text(
    parameters: &[BoundParameterV1],
    position: usize,
) -> Result<&str, PrecommitContractErrorV1> {
    match &parameters[position - 1].value {
        BoundParameterValueV1::Text(value) => Ok(value),
        _ => Err(PrecommitContractErrorV1::InvalidParameterContract),
    }
}

fn int4(parameters: &[BoundParameterV1], position: usize) -> Result<i32, PrecommitContractErrorV1> {
    match parameters[position - 1].value {
        BoundParameterValueV1::Int4(value) => Ok(value),
        _ => Err(PrecommitContractErrorV1::InvalidParameterContract),
    }
}

mod runner;
use runner::*;
mod reconciliation;

#[cfg(test)]
mod composition_harness;
#[cfg(test)]
use composition_harness::{
    receipt_zero_precommit_test_connector_for_scenario, ReceiptZeroPrecommitTestConnectorV1,
    ReceiptZeroPrecommitTestEventV1, ReceiptZeroPrecommitTestInterruptsV1,
    ReceiptZeroPrecommitTestScenarioV1,
};

/// Opaque, structural projection of the exact durable initializer material into the reviewed
/// fixed-statement contract. It contains no connector, clock, journal, session, settlement, or
/// release authority and cannot be cloned or serialized.
#[cfg(test)]
#[must_use]
struct PreparedReceiptZeroPrecommitV1 {
    contract: ReceiptZeroPrecommitContractV1,
}

/// Opaque connector-clock sample captured at the beginning of the outer future's first poll. The
/// caller cannot supply or inspect an absolute clock value.
#[cfg(test)]
#[must_use]
struct ReceiptZeroPrecommitClockAnchorV1<'a> {
    anchor: ConnectorClockAnchorV1<'a>,
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum JournalBoundPrecommitDispositionV1 {
    NeedsIndependentReadback,
    FailedBeforeCommit,
}

#[cfg(test)]
fn prepare_initializer_precommit_for_test(
    material: &ReceiptZeroInitializerClaimMaterialV1,
) -> Result<PreparedReceiptZeroPrecommitV1, ()> {
    contract_from_initializer_material_for_test(material)
        .map(|contract| PreparedReceiptZeroPrecommitV1 { contract })
        .map_err(|_| ())
}

#[cfg(test)]
fn capture_initializer_precommit_clock_for_test(
    interrupts: &ReceiptZeroPrecommitTestInterruptsV1,
) -> ReceiptZeroPrecommitClockAnchorV1<'_> {
    ReceiptZeroPrecommitClockAnchorV1 {
        anchor: ExecutionControlV1::capture_connector_clock_for_test(interrupts),
    }
}

/// Runs only the precommit-owned sealed test connector under the journal ceiling. The proof layer
/// receives neither the raw runner result nor any SQL, parameter, session, caller-controlled
/// deadline, or transport surface. ACK, a definitive COMMIT rejection, and an ambiguous COMMIT
/// outcome all require the same later independent read; no outcome here creates settlement or
/// release authority. The test probe may observe, but never choose, the projected deadline.
#[cfg(test)]
async fn run_prepared_initializer_precommit_for_test(
    prepared: PreparedReceiptZeroPrecommitV1,
    anchor: ReceiptZeroPrecommitClockAnchorV1<'_>,
    ceiling: ReceiptZeroInitializerLiveExecutionCeilingV1,
    connector: ReceiptZeroPrecommitTestConnectorV1,
) -> JournalBoundPrecommitDispositionV1 {
    let Ok(control) =
        ExecutionControlV1::start_with_journal_ceiling_for_test(anchor.anchor, ceiling)
    else {
        return JournalBoundPrecommitDispositionV1::FailedBeforeCommit;
    };
    match prepared
        .contract
        .run_connected_for_test(connector, &control)
        .await
    {
        Ok(result)
            if result.requires_independent_readback
                && !result.request_dispatch_authenticated
                && !result.database_authority_created
                && !result.mutation_authorized
                && !result.execution_authorized
                && !result.database_cas_readback_verified
                && !result.settlement_authorized
                && !result.receipt_v2_issued
                && !result.automatic_retry_allowed
                && !result.release_authorized =>
        {
            JournalBoundPrecommitDispositionV1::NeedsIndependentReadback
        }
        // Any `Ok` is necessarily post-COMMIT ACK. Unexpected result metadata must therefore
        // remain conservative readback-only rather than being mislabeled as a precommit failure.
        Ok(_) => JournalBoundPrecommitDispositionV1::NeedsIndependentReadback,
        Err(error) if error.requires_read_only_reconciliation() => {
            JournalBoundPrecommitDispositionV1::NeedsIndependentReadback
        }
        Err(_) => JournalBoundPrecommitDispositionV1::FailedBeforeCommit,
    }
}

/// Projects only the already validated, journal-owned initializer material into the fixed typed
/// parameter tuple. This structural helper is testing-only and creates no connector, clock,
/// database, dispatch, settlement, Receipt, or release authority. The eventual executable entry
/// must still consume the private B3a lineage wrapper by value.
#[cfg(test)]
fn contract_from_initializer_material_for_test(
    material: &ReceiptZeroInitializerClaimMaterialV1,
) -> Result<ReceiptZeroPrecommitContractV1, PrecommitContractErrorV1> {
    ReceiptZeroPrecommitContractV1::issue_for_test(parameters_from_initializer_material_for_test(
        material,
    )?)
}

/// Shared structural projection for the fixed writer and independent read contract. Neither
/// projection creates a connector or converts journal-owned data into execution authority.
#[cfg(test)]
fn parameters_from_initializer_material_for_test(
    material: &ReceiptZeroInitializerClaimMaterialV1,
) -> Result<Vec<BoundParameterV1>, PrecommitContractErrorV1> {
    validate_receipt_zero_initializer_material_for_runner_for_test(material)
        .map_err(|_| PrecommitContractErrorV1::InvalidParameterContract)?;
    let transaction = &material.transaction;
    if transaction.format != JOURNAL_TRANSACTION_FORMAT
        || transaction.version != 1
        || transaction.query_id != QUERY_ID
        || transaction.query_version != QUERY_VERSION
        || transaction.statement_count != STATEMENT_COUNT
        || transaction.isolation != TRANSACTION_LIMITS.isolation
        || transaction.access_mode != TRANSACTION_LIMITS.access_mode
        || transaction.transaction_sql_digest != URL_SAFE_NO_PAD.encode(SQL_SHA256)
        || transaction.parameter_schema_digest != PARAMETER_SCHEMA_DIGEST
    {
        return Err(PrecommitContractErrorV1::InvalidParameterContract);
    }

    let source = &material.source;
    let capture = &material.capture;
    let int8 = |value: u64| {
        i64::try_from(value).map_err(|_| PrecommitContractErrorV1::InvalidParameterContract)
    };
    let optional_int8 = |value: Option<u64>| {
        value
            .map(i64::try_from)
            .transpose()
            .map_err(|_| PrecommitContractErrorV1::InvalidParameterContract)
    };
    let int4 = |value: u64| {
        i32::try_from(value).map_err(|_| PrecommitContractErrorV1::InvalidParameterContract)
    };
    let parameter = |position: usize, value: BoundParameterValueV1| BoundParameterV1 {
        position: u8::try_from(position).expect("the fixed parameter positions fit u8"),
        name: PARAMETER_SCHEMA[position - 1].name,
        value,
    };
    let text = |position: usize, value: &str| {
        parameter(position, BoundParameterValueV1::Text(value.to_owned()))
    };

    let parameters = exact_parameter_tuple_from_material(
        material,
        &parameter,
        &text,
        &int8,
        &optional_int8,
        &int4,
    )?;
    // Keep the authoritative source/capture projections visible beside the tuple construction;
    // every equality below was already required before the durable claim, but must not silently
    // drift if this helper is edited independently later.
    if parameters[1].value != BoundParameterValueV1::Text(source.application_id.clone())
        || parameters[2].value != BoundParameterValueV1::Text(source.application_digest.clone())
        || parameters[3].value != BoundParameterValueV1::Text(source.migration_id.clone())
        || parameters[6].value
            != BoundParameterValueV1::Text(source.provider_authority_digest.clone())
        || parameters[7].value != BoundParameterValueV1::Text(source.source_ledger_digest.clone())
        || parameters[10].value
            != BoundParameterValueV1::Text(capture.catalog_precondition_digest.clone())
        || parameters[12].value != BoundParameterValueV1::Text(capture.capture_digest.clone())
    {
        return Err(PrecommitContractErrorV1::InvalidParameterContract);
    }
    validate_parameters(&parameters)?;
    Ok(parameters)
}

#[cfg(test)]
fn exact_parameter_tuple_from_material(
    material: &ReceiptZeroInitializerClaimMaterialV1,
    parameter: &impl Fn(usize, BoundParameterValueV1) -> BoundParameterV1,
    text: &impl Fn(usize, &str) -> BoundParameterV1,
    int8: &impl Fn(u64) -> Result<i64, PrecommitContractErrorV1>,
    optional_int8: &impl Fn(Option<u64>) -> Result<Option<i64>, PrecommitContractErrorV1>,
    int4: &impl Fn(u64) -> Result<i32, PrecommitContractErrorV1>,
) -> Result<Vec<BoundParameterV1>, PrecommitContractErrorV1> {
    let source = &material.source;
    let capture = &material.capture;
    let values = &material.transaction.parameters;
    Ok(vec![
        text(1, &values.execution_id),
        text(2, &source.application_id),
        text(3, &source.application_digest),
        text(4, &source.migration_id),
        text(5, &source.migration_digest),
        text(6, &source.migration_plan_digest),
        text(7, &source.provider_authority_digest),
        text(8, &source.source_ledger_digest),
        text(9, &values.scope_digest),
        text(10, &values.resource_identity_digest),
        text(11, &capture.catalog_precondition_digest),
        text(12, &values.canonical_scope_base64),
        text(13, &capture.capture_digest),
        parameter(
            14,
            BoundParameterValueV1::Int8(optional_int8(capture.captured_high_water)?),
        ),
        parameter(
            15,
            BoundParameterValueV1::Int8(Some(int8(capture.total_row_count)?)),
        ),
        parameter(
            16,
            BoundParameterValueV1::Int8(Some(int8(capture.remaining_null_target_row_count)?)),
        ),
        parameter(
            17,
            BoundParameterValueV1::Int8(optional_int8(values.required_matched_row_count)?),
        ),
        parameter(
            18,
            BoundParameterValueV1::Int4(int4(capture.required_batch_receipt_count)?),
        ),
        parameter(
            19,
            BoundParameterValueV1::Int4(int4(u64::from(capture.batch_size))?),
        ),
        text(20, &values.initial_execution_status),
        text(21, &values.candidate_committed_at),
        text(22, &values.event_id),
        text(23, &values.receipt_id),
        text(24, &values.idempotency_key),
        // Parameters 21, 25, and 28 remain self-consistent durable data, not independently
        // authenticated time, canonical-request, or operation-evidence authority.
        text(25, &values.request_digest),
        text(26, &values.receipt_digest),
        text(27, &values.canonical_receipt_base64),
        text(28, &values.unauthenticated_operation_evidence_digest),
    ])
}

#[cfg(test)]
#[path = "proof_composition.rs"]
mod proof_composition;
#[cfg(test)]
mod source_tests;
#[cfg(test)]
mod tests;
