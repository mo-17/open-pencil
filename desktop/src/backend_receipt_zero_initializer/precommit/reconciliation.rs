//! Dormant independent Receipt-zero read contract and private, test-only recovery runner.
//!
//! The read pins the existing reviewed SQL and shares the writer's exact parameter projection.
//! Its scalar sink accepts only the native PostgreSQL text protocol's one-row, 29-column shape.
//! No JSON response coercion, caller SQL, credential source, or production constructor is provided.
//! The testing-only fused runner consumes the journal-owned durable read window and enforces the
//! fixed transaction limits and original clock ceiling. Parsing alone never authenticates a read.

use super::{valid_canonical_utc_millis, valid_digest, BoundParameterV1};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use sha2::{Digest, Sha256};
use std::time::Duration;

mod runner;

#[cfg(test)]
mod tests;

const SQL_SOURCE: &str = include_str!(
    "../../../../src/app/plugins/host/deployment/supabase/backfill/receipt/zero/reconciliation/v1.sql"
);
const SQL_BYTE_LENGTH: usize = 115_192;
const SQL_SHA256: [u8; 32] = [
    0x21, 0x4b, 0x3b, 0x55, 0x19, 0x93, 0x23, 0xc4, 0x92, 0xc8, 0x1d, 0x0a, 0xf8, 0x08, 0xcf, 0xf3,
    0x3f, 0xfc, 0xe8, 0xc0, 0x66, 0xc1, 0xc4, 0x80, 0xe1, 0x6e, 0x1b, 0xa9, 0xc0, 0xd3, 0x3f, 0x5a,
];
const QUERY_VERSION: &str = "openpencil-supabase-backfill-receipt-zero-reconciliation-v1";
const MAXIMUM_RESPONSE_BYTES: usize = 4 * 1_024;
const MAXIMUM_CELL_BYTES: usize = 256;
const STATEMENT_TIMEOUT_MS: u32 = 15_000;
const OVERALL_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ColumnTypeV1 {
    Text,
    Boolean,
    Int4,
}

const RESPONSE_SCHEMA: [(&str, ColumnTypeV1, bool); 29] = [
    ("queryVersion", ColumnTypeV1::Text, false),
    ("scopeDigest", ColumnTypeV1::Text, false),
    ("receiptDigest", ColumnTypeV1::Text, false),
    (
        "candidateOperationEvidenceDigest",
        ColumnTypeV1::Text,
        false,
    ),
    ("initialExecutionStatus", ColumnTypeV1::Text, false),
    ("initialReceiptOutcome", ColumnTypeV1::Text, false),
    ("reportedStatus", ColumnTypeV1::Text, false),
    ("inputValid", ColumnTypeV1::Boolean, false),
    ("runtimeReady", ColumnTypeV1::Boolean, false),
    ("fullLedgerShapeVerified", ColumnTypeV1::Boolean, false),
    ("collisionExecutionCount", ColumnTypeV1::Int4, false),
    ("targetExecutionCount", ColumnTypeV1::Int4, false),
    ("exactInitialExecutionCount", ColumnTypeV1::Int4, false),
    ("exactImmutableExecutionCount", ColumnTypeV1::Int4, false),
    ("receiptCount", ColumnTypeV1::Int4, false),
    ("exactReceiptZeroCount", ColumnTypeV1::Int4, false),
    ("headCount", ColumnTypeV1::Int4, false),
    ("headRevision", ColumnTypeV1::Int4, true),
    ("exactInitialHeadCount", ColumnTypeV1::Int4, false),
    ("chainCount", ColumnTypeV1::Int4, false),
    ("chainMinimumRevision", ColumnTypeV1::Int4, true),
    ("chainMaximumRevision", ColumnTypeV1::Int4, true),
    (
        "headTimestampMatchesLatestReceipt",
        ColumnTypeV1::Boolean,
        false,
    ),
    (
        "executionTimestampMatchesHead",
        ColumnTypeV1::Boolean,
        false,
    ),
    ("transactionReadOnly", ColumnTypeV1::Boolean, false),
    ("installMarkerDigest", ColumnTypeV1::Text, true),
    ("serverVersionNum", ColumnTypeV1::Text, false),
    ("snapshotDigest", ColumnTypeV1::Text, false),
    ("observedAt", ColumnTypeV1::Text, false),
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ReadErrorV1 {
    StaticStatement,
    Parameters,
    ResponseProtocol,
    ResponseLimit,
    ResponseValue,
    ResponseBinding,
    InconsistentFacts,
    ReportedStatusMismatch,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ReadStateV1 {
    Absent,
    ExactReplay,
    AdvancedHead,
    Corruption,
    PreconditionFailed,
}

impl ReadStateV1 {
    fn parse(value: &str) -> Result<Self, ReadErrorV1> {
        match value {
            "absent" => Ok(Self::Absent),
            "exact-replay" => Ok(Self::ExactReplay),
            "advanced-head" => Ok(Self::AdvancedHead),
            "corruption" => Ok(Self::Corruption),
            "precondition-failed" => Ok(Self::PreconditionFailed),
            _ => Err(ReadErrorV1::ResponseValue),
        }
    }
}

struct FixedReadStatementV1;

impl FixedReadStatementV1 {
    fn source(&self) -> Result<&'static str, ReadErrorV1> {
        if SQL_SOURCE.len() != SQL_BYTE_LENGTH
            || <[u8; 32]>::from(Sha256::digest(SQL_SOURCE.as_bytes())) != SQL_SHA256
        {
            return Err(ReadErrorV1::StaticStatement);
        }
        Ok(SQL_SOURCE)
    }
}

#[derive(Debug, PartialEq, Eq)]
enum CellV1 {
    Text(String),
    Boolean(bool),
    Int4(i32),
    Null,
}

/// Any protocol failure poisons the entire sink, even if an adapter ignores the returned error.
/// The sink allocates only after checking each incoming slice and the fixed aggregate limit.
struct ResponseSinkV1 {
    row_started: bool,
    poisoned: bool,
    byte_count: usize,
    cells: Vec<CellV1>,
    transcript: Sha256,
}

impl ResponseSinkV1 {
    fn new() -> Self {
        Self {
            row_started: false,
            poisoned: false,
            byte_count: 0,
            cells: Vec::with_capacity(RESPONSE_SCHEMA.len()),
            transcript: Sha256::new(),
        }
    }

    fn begin_row(&mut self, column_count: usize) -> Result<(), ReadErrorV1> {
        if self.poisoned || self.row_started || column_count != RESPONSE_SCHEMA.len() {
            self.poisoned = true;
            return Err(ReadErrorV1::ResponseProtocol);
        }
        self.row_started = true;
        self.transcript
            .update(b"openpencil.receipt-zero-native-scalar-response.v1\0");
        Ok(())
    }

    /// Only decoded PostgreSQL Text, Boolean and Int4 OIDs may be passed as column_type. A future
    /// adapter must reject unknown/domain OIDs and binary formats rather than coerce them here.
    fn push_column(
        &mut self,
        name: &str,
        column_type: ColumnTypeV1,
        value: Option<&[u8]>,
    ) -> Result<(), ReadErrorV1> {
        let result = self.push_column_inner(name, column_type, value);
        if result.is_err() {
            self.poisoned = true;
        }
        result
    }

    fn push_column_inner(
        &mut self,
        name: &str,
        column_type: ColumnTypeV1,
        value: Option<&[u8]>,
    ) -> Result<(), ReadErrorV1> {
        let Some(&(expected_name, expected_type, nullable)) = RESPONSE_SCHEMA.get(self.cells.len())
        else {
            return Err(ReadErrorV1::ResponseProtocol);
        };
        if self.poisoned
            || !self.row_started
            || name != expected_name
            || column_type != expected_type
            || (value.is_none() && !nullable)
        {
            return Err(ReadErrorV1::ResponseProtocol);
        }
        let length = value.map_or(0, <[u8]>::len);
        if length > MAXIMUM_CELL_BYTES
            || self.byte_count.saturating_add(length) > MAXIMUM_RESPONSE_BYTES
        {
            return Err(ReadErrorV1::ResponseLimit);
        }
        let cell = match value {
            None => CellV1::Null,
            Some(bytes) => match column_type {
                ColumnTypeV1::Text => {
                    let text =
                        std::str::from_utf8(bytes).map_err(|_| ReadErrorV1::ResponseValue)?;
                    if text.is_empty() || text.chars().any(char::is_control) {
                        return Err(ReadErrorV1::ResponseValue);
                    }
                    CellV1::Text(text.to_owned())
                }
                ColumnTypeV1::Boolean => match bytes {
                    b"t" => CellV1::Boolean(true),
                    b"f" => CellV1::Boolean(false),
                    _ => return Err(ReadErrorV1::ResponseValue),
                },
                ColumnTypeV1::Int4 => {
                    let text =
                        std::str::from_utf8(bytes).map_err(|_| ReadErrorV1::ResponseValue)?;
                    let number = text
                        .parse::<i32>()
                        .map_err(|_| ReadErrorV1::ResponseValue)?;
                    if number.to_string() != text {
                        return Err(ReadErrorV1::ResponseValue);
                    }
                    CellV1::Int4(number)
                }
            },
        };
        self.byte_count += length;
        self.transcript.update([u8::from(value.is_some())]);
        self.transcript.update((length as u32).to_be_bytes());
        if let Some(bytes) = value {
            self.transcript.update(bytes);
        }
        self.cells.push(cell);
        Ok(())
    }

    fn finish(self) -> Result<(ResponseRowV1, String), ReadErrorV1> {
        if self.poisoned || !self.row_started || self.cells.len() != RESPONSE_SCHEMA.len() {
            return Err(ReadErrorV1::ResponseProtocol);
        }
        Ok((
            ResponseRowV1(self.cells),
            URL_SAFE_NO_PAD.encode(self.transcript.finalize()),
        ))
    }
}

struct ResponseRowV1(Vec<CellV1>);

impl ResponseRowV1 {
    fn text(&self, index: usize) -> Result<&str, ReadErrorV1> {
        match self.0.get(index) {
            Some(CellV1::Text(value)) => Ok(value),
            _ => Err(ReadErrorV1::ResponseValue),
        }
    }

    fn boolean(&self, index: usize) -> Result<bool, ReadErrorV1> {
        match self.0.get(index) {
            Some(CellV1::Boolean(value)) => Ok(*value),
            _ => Err(ReadErrorV1::ResponseValue),
        }
    }

    fn count(&self, index: usize, maximum: i32) -> Result<i32, ReadErrorV1> {
        match self.0.get(index) {
            Some(CellV1::Int4(value)) if (0..=maximum).contains(value) => Ok(*value),
            _ => Err(ReadErrorV1::ResponseValue),
        }
    }

    fn revision(&self, index: usize) -> Result<Option<i32>, ReadErrorV1> {
        match self.0.get(index) {
            Some(CellV1::Int4(value)) => Ok(Some(*value)),
            Some(CellV1::Null) => Ok(None),
            _ => Err(ReadErrorV1::ResponseValue),
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
struct ReadFactsV1 {
    input_valid: bool,
    runtime_ready: bool,
    full_ledger_shape_verified: bool,
    collision: i32,
    target: i32,
    initial_execution: i32,
    immutable_execution: i32,
    receipts: i32,
    receipt_zero: i32,
    heads: i32,
    head_revision: Option<i32>,
    initial_head: i32,
    chain: i32,
    chain_minimum: Option<i32>,
    chain_maximum: Option<i32>,
    head_timestamp_matches: bool,
    execution_timestamp_matches: bool,
}

impl ReadFactsV1 {
    fn decode(row: &ResponseRowV1) -> Result<Self, ReadErrorV1> {
        let facts = Self {
            input_valid: row.boolean(7)?,
            runtime_ready: row.boolean(8)?,
            full_ledger_shape_verified: row.boolean(9)?,
            collision: row.count(10, 2)?,
            target: row.count(11, 2)?,
            initial_execution: row.count(12, 2)?,
            immutable_execution: row.count(13, 2)?,
            receipts: row.count(14, 10_001)?,
            receipt_zero: row.count(15, 2)?,
            heads: row.count(16, 2)?,
            head_revision: row.revision(17)?,
            initial_head: row.count(18, 2)?,
            chain: row.count(19, 20_002)?,
            chain_minimum: row.revision(20)?,
            chain_maximum: row.revision(21)?,
            head_timestamp_matches: row.boolean(22)?,
            execution_timestamp_matches: row.boolean(23)?,
        };
        facts.require_consistent()?;
        Ok(facts)
    }

    fn gated(&self) -> bool {
        self.input_valid && self.runtime_ready && self.full_ledger_shape_verified
    }

    fn empty(&self) -> bool {
        self.collision == 0
            && self.target == 0
            && self.initial_execution == 0
            && self.immutable_execution == 0
            && self.receipts == 0
            && self.receipt_zero == 0
            && self.heads == 0
            && self.head_revision.is_none()
            && self.initial_head == 0
            && self.chain == 0
            && self.chain_minimum.is_none()
            && self.chain_maximum.is_none()
            && !self.head_timestamp_matches
            && !self.execution_timestamp_matches
    }

    fn require_consistent(&self) -> Result<(), ReadErrorV1> {
        let chain_range_invalid = if self.chain == 0 {
            self.chain_minimum.is_some() || self.chain_maximum.is_some()
        } else {
            match (self.chain_minimum, self.chain_maximum) {
                (Some(minimum), Some(maximum)) => minimum > maximum,
                _ => true,
            }
        };
        if self.target > self.collision
            || self.initial_execution > self.target
            || self.immutable_execution > self.target
            || self.initial_execution > self.immutable_execution
            || self.receipt_zero > self.receipts
            || self.initial_head > self.heads
            || (self.heads == 0 && self.head_revision.is_some())
            || self.chain > self.receipts * self.heads
            || chain_range_invalid
            || ((self.heads == 0 || self.chain == 0) && self.head_timestamp_matches)
            || ((self.target == 0 || self.heads == 0) && self.execution_timestamp_matches)
            || (!self.gated() && !self.empty())
        {
            return Err(ReadErrorV1::InconsistentFacts);
        }
        Ok(())
    }

    fn classify(&self, initially_running: bool) -> ReadStateV1 {
        if !self.gated() {
            return ReadStateV1::PreconditionFailed;
        }
        if self.empty() {
            return ReadStateV1::Absent;
        }
        let exact_identity = self.collision == 1
            && self.target == 1
            && self.immutable_execution == 1
            && self.receipt_zero == 1
            && self.heads == 1;
        if exact_identity
            && self.initial_execution == 1
            && self.receipts == 1
            && self.head_revision == Some(1)
            && self.initial_head == 1
            && self.chain == 0
            && self.chain_minimum.is_none()
            && self.chain_maximum.is_none()
            && !self.head_timestamp_matches
            && self.execution_timestamp_matches
        {
            return ReadStateV1::ExactReplay;
        }
        if initially_running
            && exact_identity
            && self
                .head_revision
                .is_some_and(|revision| (2..=10_000).contains(&revision))
            && self.head_revision == Some(self.receipts)
            && self.initial_head == 0
            && self.chain == self.receipts
            && self.chain_minimum == Some(1)
            && self.chain_maximum == self.head_revision
            && self.head_timestamp_matches
            && self.execution_timestamp_matches
        {
            return ReadStateV1::AdvancedHead;
        }
        ReadStateV1::Corruption
    }
}

/// Secret-free diagnostics only. There are intentionally no conversion/settlement methods.
#[derive(Debug)]
struct ReadObservationV1 {
    reported_status: ReadStateV1,
    status: ReadStateV1,
    facts: ReadFactsV1,
    historical_marker_matches: bool,
    transaction_read_only: bool,
    response_digest: String,
    snapshot_digest: String,
    observed_at: String,
}

impl ReadObservationV1 {
    const fn production_transport_authenticated(&self) -> bool {
        false
    }
    const fn specific_historical_installation_authenticated(&self) -> bool {
        false
    }
    const fn full_portable_receipt_v2_chain_verified(&self) -> bool {
        false
    }
    const fn absent_proves_prior_mutation_stopped(&self) -> bool {
        false
    }
    const fn settlement_authorized(&self) -> bool {
        false
    }
    const fn automatic_retry_allowed(&self) -> bool {
        false
    }
    const fn receipt_v2_issued(&self) -> bool {
        false
    }
    const fn release_authorized(&self) -> bool {
        false
    }
}

/// Non-cloneable structural contract. Decoding consumes it, but does not consume a journal lease.
/// The only constructor is testing-only and revalidates the complete journal-owned material.
struct ReceiptZeroReadContractV1 {
    parameters: Vec<BoundParameterV1>,
    historical_marker_digest: String,
    initial_receipt_outcome: String,
}

impl ReceiptZeroReadContractV1 {
    #[cfg(test)]
    fn from_material_for_test(
        material: &crate::backend_operation_journal::ReceiptZeroInitializerClaimMaterialV1,
    ) -> Result<Self, ReadErrorV1> {
        use base64::engine::general_purpose::STANDARD;
        let parameters = super::parameters_from_initializer_material_for_test(material)
            .map_err(|_| ReadErrorV1::Parameters)?;
        FixedReadStatementV1.source()?;
        let bytes = STANDARD
            .decode(&material.transaction.parameters.canonical_receipt_base64)
            .map_err(|_| ReadErrorV1::Parameters)?;
        // The shared journal validator has already rejected duplicate/unknown keys, noncanonical
        // JSON and every cross-field mismatch before this bounded, data-only extraction.
        let receipt: serde_json::Value =
            serde_json::from_slice(&bytes).map_err(|_| ReadErrorV1::Parameters)?;
        let initial_receipt_outcome = receipt
            .get("outcome")
            .and_then(serde_json::Value::as_str)
            .filter(|value| matches!(*value, "in-progress" | "completed"))
            .ok_or(ReadErrorV1::Parameters)?
            .to_owned();
        Ok(Self {
            parameters,
            historical_marker_digest: URL_SAFE_NO_PAD
                .encode(Sha256::digest(material.installed.marker.as_bytes())),
            initial_receipt_outcome,
        })
    }

    fn decode(self, sink: ResponseSinkV1) -> Result<ReadObservationV1, ReadErrorV1> {
        super::validate_parameters(&self.parameters).map_err(|_| ReadErrorV1::Parameters)?;
        FixedReadStatementV1.source()?;
        let (row, response_digest) = sink.finish()?;
        for (column, position) in [(1, 9), (2, 26), (3, 28), (4, 20)] {
            if row.text(column)?
                != super::text(&self.parameters, position).map_err(|_| ReadErrorV1::Parameters)?
            {
                return Err(ReadErrorV1::ResponseBinding);
            }
        }
        if row.text(0)? != QUERY_VERSION || row.text(5)? != self.initial_receipt_outcome {
            return Err(ReadErrorV1::ResponseBinding);
        }
        let facts = ReadFactsV1::decode(&row)?;
        let reported_status = ReadStateV1::parse(row.text(6)?)?;
        let initially_running = row.text(4)? == "running" && row.text(5)? == "in-progress";
        if facts.classify(initially_running) != reported_status {
            return Err(ReadErrorV1::ReportedStatusMismatch);
        }
        let marker = match row.0.get(25) {
            Some(CellV1::Null) if !facts.full_ledger_shape_verified => None,
            Some(CellV1::Text(value)) if valid_digest(value) => Some(value.as_str()),
            _ => return Err(ReadErrorV1::ResponseValue),
        };
        let version = row.text(26)?;
        let snapshot_digest = row.text(27)?;
        let observed_at = row.text(28)?;
        if version.len() != 6
            || !version.bytes().all(|byte| byte.is_ascii_digit())
            || !matches!(&version[..2], "15" | "16" | "17")
            || !valid_digest(snapshot_digest)
            || !valid_canonical_utc_millis(observed_at)
        {
            return Err(ReadErrorV1::ResponseValue);
        }
        let historical_marker_matches = marker == Some(self.historical_marker_digest.as_str());
        let transaction_read_only = row.boolean(24)?;
        // Unlike the testing Management parser, this native read contract also treats an observed
        // read-write transaction as a failed precondition. Neither value authenticates transport.
        let status = if historical_marker_matches && transaction_read_only {
            reported_status
        } else {
            ReadStateV1::PreconditionFailed
        };
        Ok(ReadObservationV1 {
            reported_status,
            status,
            facts,
            historical_marker_matches,
            transaction_read_only,
            response_digest,
            snapshot_digest: snapshot_digest.to_owned(),
            observed_at: observed_at.to_owned(),
        })
    }
}
