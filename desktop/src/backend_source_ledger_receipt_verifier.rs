//! Dormant Host-only verification kernel for the portable source-ledger receipt envelope.
//!
//! This module deliberately has no Tauri command, network client, credential resolver, mutation
//! runner, or production trust root. A successful internal verification is only cryptographic and
//! structural evidence. It is not database, execution, Receipt V2, or release authority.

#![allow(dead_code)]

use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{Arc, Mutex, Weak},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ring::{
    rand::{SecureRandom, SystemRandom},
    signature::{UnparsedPublicKey, ED25519},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::supabase_backfill_fixed_read::contains_secret_like_material;

const MAX_ENVELOPE_BYTES: usize = 256 * 1024;
const MAX_APPLIED_MIGRATIONS: usize = 256;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const HANDLE_TTL: Duration = Duration::from_secs(30);
const MAX_REGISTRY_ENTRIES: usize = 256;
const MAX_ID_ATTEMPTS: usize = 4;

const ENVELOPE_FORMAT: &str = "openpencil.backend-source-ledger-signed-receipt";
const RECEIPT_FORMAT: &str = "openpencil.backend-source-ledger-binding-receipt";
const SUBJECT_FORMAT: &str = "openpencil.backend-source-ledger-binding-subject";
const ATTESTATION_FORMAT: &str = "openpencil.backend-source-ledger-ci-attestation";
const APPLIED_PREFIX_FORMAT: &str = "openpencil.backend-source-ledger-applied-prefix";

/// Production verification must remain unavailable until an audited key is compiled into a
/// release. In particular, roots never come from the renderer, environment, filesystem, or input.
const PRODUCTION_TRUST_ROOTS: &[CompiledTrustRootV1] = &[];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum VerificationError {
    InvalidInput,
    NonCanonicalInput,
    DigestMismatch,
    UntrustedKey,
    InvalidTrustRoot,
    RevokedTrustRoot,
    SignatureInvalid,
    HostBindingMismatch,
    ReceiptFromFuture,
    RegistryFull,
    Collision,
    ScopeAlreadyActive,
    HandleInvalid,
    HandleExpired,
    ClockUnavailable,
    Poisoned,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SignedReceiptEnvelopeV1 {
    format: String,
    version: u8,
    receipt: SourceLedgerBindingReceiptV1,
    integrity: SignedIntegrityV1,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SignedIntegrityV1 {
    algorithm: String,
    digest: String,
    signature: SignedSignatureV1,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SignedSignatureV1 {
    algorithm: String,
    key_id: String,
    value: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceLedgerBindingReceiptV1 {
    format: String,
    version: u8,
    subject: SourceLedgerBindingSubjectV1,
    subject_digest: String,
    attestation: SourceLedgerCiAttestationV1,
    attestation_digest: String,
    recorded_at: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceLedgerBindingSubjectV1 {
    format: String,
    version: u8,
    provider_id: String,
    environment: String,
    project_ref: String,
    account_id: String,
    provider_authority_digest: String,
    application_id: String,
    application_digest: String,
    migration_id: String,
    migration_digest: String,
    migration_plan_digest: String,
    source_ledger_digest: String,
    promotion_ledger_digest: String,
    source_artifact: SourceArtifactV1,
    inspected_ledger: InspectedLedgerV1,
    staging: StagingEvidenceV1,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceArtifactV1 {
    migration_id: String,
    phase: String,
    path: String,
    digest: String,
    execution_plan_digest: String,
    migration_plan_digest: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InspectedLedgerV1 {
    path: String,
    file_digest: String,
    head_digest: String,
    selected_entry_digest: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StagingEvidenceV1 {
    target_authority: TargetAuthorityV1,
    schema_digest: String,
    applied_migration_ids: Vec<String>,
    applied_prefix_digest: String,
    last_receipt_digest: String,
    last_no_drift_receipt_digest: String,
    drift: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TargetAuthorityV1 {
    provider_id: String,
    provider_authority_digest: String,
    project_ref: String,
    account_id: String,
    grant_generation: String,
    environment: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceLedgerCiAttestationV1 {
    format: String,
    version: u8,
    subject_digest: String,
    source_ledger_digest: String,
    staging_project_ref: String,
    ci_provider: String,
    repository: String,
    workflow: String,
    run_id: String,
    run_attempt: u64,
    protected_ref: String,
    revision: String,
    protected_ref_verified: bool,
    db_push_command_digest: String,
    db_push_receipt_digest: String,
    database_history_digest: String,
    succeeded: bool,
    unresolved_mutation: bool,
    attested_at: String,
}

#[derive(Serialize)]
struct AppliedPrefixV1<'a> {
    format: &'static str,
    version: u8,
    #[serde(rename = "migrationIds")]
    migration_ids: &'a [String],
}

#[derive(Serialize)]
struct PayloadV1<'a> {
    format: &'static str,
    version: u8,
    receipt: &'a SourceLedgerBindingReceiptV1,
}

#[derive(Serialize)]
struct SigningMessageV1<'a> {
    payload: PayloadV1<'a>,
    algorithm: &'static str,
    digest: &'a str,
}

#[derive(Clone, Copy)]
struct CompiledTrustRootV1 {
    key_id: &'static str,
    public_key: [u8; 32],
    not_before: &'static str,
    not_after: &'static str,
    revoked_at: Option<&'static str>,
}

/// Values below this boundary must be reconstructed from native project, credential, and source
/// state. There is intentionally no production constructor in this dormant slice.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrustedReceiptExpectationV1 {
    project_ref: String,
    account_id: String,
    grant_generation: String,
    provider_authority_digest: String,
    application_id: String,
    application_digest: String,
    migration_id: String,
    migration_digest: String,
    migration_plan_digest: String,
    source_ledger_digest: String,
    schema_digest: String,
    subject_digest: String,
    attestation_digest: String,
    payload_digest: String,
    ci_provider: String,
    repository: String,
    workflow: String,
    run_id: String,
    run_attempt: u64,
    protected_ref: String,
    revision: String,
    db_push_command_digest: String,
    db_push_receipt_digest: String,
    database_history_digest: String,
}

struct VerifiedReceiptCoreV1 {
    payload_digest: [u8; 32],
    subject_digest: [u8; 32],
    attestation_digest: [u8; 32],
    expectation_digest: [u8; 32],
    scope_digest: [u8; 32],
}

fn canonical_value(value: Value) -> Value {
    match value {
        Value::Array(entries) => Value::Array(entries.into_iter().map(canonical_value).collect()),
        Value::Object(entries) => Value::Object(
            entries
                .into_iter()
                .map(|(key, value)| (key, canonical_value(value)))
                .collect(),
        ),
        primitive => primitive,
    }
}

fn canonical_bytes<T: Serialize>(value: &T) -> Result<Vec<u8>, VerificationError> {
    let value = serde_json::to_value(value).map_err(|_| VerificationError::InvalidInput)?;
    serde_json::to_vec(&canonical_value(value)).map_err(|_| VerificationError::InvalidInput)
}

fn sha256(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

fn encode_digest(bytes: &[u8; 32]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

fn canonical_base64<const N: usize>(value: &str) -> Result<[u8; N], VerificationError> {
    if value.is_empty() || value.contains('=') {
        return Err(VerificationError::InvalidInput);
    }
    let decoded = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| VerificationError::InvalidInput)?;
    let decoded: [u8; N] = decoded
        .try_into()
        .map_err(|_| VerificationError::InvalidInput)?;
    if URL_SAFE_NO_PAD.encode(decoded) != value {
        return Err(VerificationError::InvalidInput);
    }
    Ok(decoded)
}

fn canonical_digest<T: Serialize>(value: &T) -> Result<[u8; 32], VerificationError> {
    Ok(sha256(&canonical_bytes(value)?))
}

fn valid_release_identifier(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 256
        && bytes[0].is_ascii_alphanumeric()
        && bytes.iter().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(*byte, b'.' | b'_' | b':' | b'/' | b'@' | b'-')
        })
        && !contains_secret_like_material(value)
}

fn valid_module_identity(value: &str) -> bool {
    if value.is_empty() || value.len() > 128 {
        return false;
    }
    let mut needs_alphanumeric = true;
    for byte in value.bytes() {
        if byte.is_ascii_lowercase() || byte.is_ascii_digit() {
            needs_alphanumeric = false;
        } else if matches!(byte, b'.' | b'_' | b'-') && !needs_alphanumeric {
            needs_alphanumeric = true;
        } else {
            return false;
        }
    }
    !needs_alphanumeric
}

fn utf16_len(value: &str) -> usize {
    value.encode_utf16().count()
}

fn is_ecmascript_trim_character(value: char) -> bool {
    matches!(
        value,
        '\u{0009}'
            | '\u{000A}'
            | '\u{000B}'
            | '\u{000C}'
            | '\u{000D}'
            | '\u{0020}'
            | '\u{00A0}'
            | '\u{1680}'
            | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

fn is_ecmascript_trimmed(value: &str) -> bool {
    !value
        .chars()
        .next()
        .is_some_and(is_ecmascript_trim_character)
        && !value
            .chars()
            .next_back()
            .is_some_and(is_ecmascript_trim_character)
}

fn valid_text(value: &str, max_utf16: usize) -> bool {
    !value.is_empty()
        && utf16_len(value) <= max_utf16
        && is_ecmascript_trimmed(value)
        && !contains_secret_like_material(value)
}

fn valid_supabase_project_ref(value: &str) -> bool {
    value.len() == 20 && value.bytes().all(|byte| byte.is_ascii_lowercase())
}

fn valid_source_path(value: &str) -> bool {
    valid_text(value, 1_024)
        && !value.starts_with('/')
        && !value.contains('\\')
        && value
            .split('/')
            .all(|segment| !segment.is_empty() && segment != "." && segment != "..")
}

fn days_in_month(year: i64, month: i64) -> i64 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        _ => 0,
    }
}

fn decimal(bytes: &[u8]) -> Option<i64> {
    if bytes.is_empty() || !bytes.iter().all(u8::is_ascii_digit) {
        return None;
    }
    std::str::from_utf8(bytes).ok()?.parse().ok()
}

fn days_from_civil(mut year: i64, month: i64, day: i64) -> i64 {
    year -= i64::from(month <= 2);
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let adjusted_month = month + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * adjusted_month + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

fn timestamp_ns(value: &str) -> Result<i128, VerificationError> {
    let bytes = value.as_bytes();
    if bytes.len() < 20
        || bytes.get(4) != Some(&b'-')
        || bytes.get(7) != Some(&b'-')
        || bytes.get(10) != Some(&b'T')
        || bytes.get(13) != Some(&b':')
        || bytes.get(16) != Some(&b':')
        || bytes.last() != Some(&b'Z')
    {
        return Err(VerificationError::InvalidInput);
    }
    let year = decimal(&bytes[0..4]).ok_or(VerificationError::InvalidInput)?;
    let month = decimal(&bytes[5..7]).ok_or(VerificationError::InvalidInput)?;
    let day = decimal(&bytes[8..10]).ok_or(VerificationError::InvalidInput)?;
    let hour = decimal(&bytes[11..13]).ok_or(VerificationError::InvalidInput)?;
    let minute = decimal(&bytes[14..16]).ok_or(VerificationError::InvalidInput)?;
    let second = decimal(&bytes[17..19]).ok_or(VerificationError::InvalidInput)?;
    if !(1..=12).contains(&month)
        || day < 1
        || day > days_in_month(year, month)
        || hour > 23
        || minute > 59
        || second > 59
    {
        return Err(VerificationError::InvalidInput);
    }
    let fraction = &bytes[19..bytes.len() - 1];
    let fraction_digits = if fraction.is_empty() {
        &[][..]
    } else if fraction[0] == b'.'
        && (2..=10).contains(&fraction.len())
        && fraction[1..].iter().all(u8::is_ascii_digit)
    {
        &fraction[1..]
    } else {
        return Err(VerificationError::InvalidInput);
    };
    let mut nanos = 0_i128;
    for digit in fraction_digits {
        nanos = nanos * 10 + i128::from(digit - b'0');
    }
    for _ in fraction_digits.len()..9 {
        nanos *= 10;
    }
    let seconds = i128::from(days_from_civil(year, month, day)) * 86_400
        + i128::from(hour * 3_600 + minute * 60 + second);
    Ok(seconds * 1_000_000_000 + nanos)
}

fn system_now_ns() -> Result<i128, VerificationError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| VerificationError::ClockUnavailable)?;
    Ok(i128::from(duration.as_secs()) * 1_000_000_000 + i128::from(duration.subsec_nanos()))
}

fn validate_digest(value: &str) -> Result<[u8; 32], VerificationError> {
    if value.len() != 43 {
        return Err(VerificationError::InvalidInput);
    }
    canonical_base64(value)
}

fn validate_envelope(envelope: &SignedReceiptEnvelopeV1) -> Result<(), VerificationError> {
    let receipt = &envelope.receipt;
    let subject = &receipt.subject;
    let attestation = &receipt.attestation;
    let staging = &subject.staging;
    let target = &staging.target_authority;
    if envelope.format != ENVELOPE_FORMAT
        || envelope.version != 1
        || receipt.format != RECEIPT_FORMAT
        || receipt.version != 1
        || subject.format != SUBJECT_FORMAT
        || subject.version != 1
        || attestation.format != ATTESTATION_FORMAT
        || attestation.version != 1
        || envelope.integrity.algorithm != "SHA-256"
        || envelope.integrity.signature.algorithm != "Ed25519"
        || !valid_module_identity(&envelope.integrity.signature.key_id)
        || subject.provider_id != "supabase"
        || subject.environment != "staging"
        || !valid_supabase_project_ref(&subject.project_ref)
        || subject.source_ledger_digest != subject.promotion_ledger_digest
        || subject.source_artifact.phase != "expand"
        || staging.drift != "none"
        || target.provider_id != subject.provider_id
        || target.environment != subject.environment
        || target.project_ref != subject.project_ref
        || target.account_id != subject.account_id
        || target.provider_authority_digest != subject.provider_authority_digest
        || !attestation.protected_ref_verified
        || !attestation.succeeded
        || attestation.unresolved_mutation
        || attestation.subject_digest != receipt.subject_digest
        || attestation.source_ledger_digest != subject.source_ledger_digest
        || attestation.staging_project_ref != subject.project_ref
        || attestation.run_attempt == 0
        || attestation.run_attempt > MAX_SAFE_INTEGER
        || staging.applied_migration_ids.is_empty()
        || staging.applied_migration_ids.len() > MAX_APPLIED_MIGRATIONS
        || staging.applied_migration_ids.last() != Some(&subject.source_artifact.migration_id)
        || staging
            .applied_migration_ids
            .contains(&subject.migration_id)
        || !valid_source_path(&subject.source_artifact.path)
        || !valid_source_path(&subject.inspected_ledger.path)
        || !valid_text(&attestation.repository, 1_024)
        || !valid_text(&attestation.protected_ref, 1_024)
    {
        return Err(VerificationError::InvalidInput);
    }

    let identifiers = [
        subject.provider_id.as_str(),
        subject.project_ref.as_str(),
        subject.account_id.as_str(),
        subject.application_id.as_str(),
        subject.migration_id.as_str(),
        subject.source_artifact.migration_id.as_str(),
        target.grant_generation.as_str(),
        attestation.ci_provider.as_str(),
        attestation.workflow.as_str(),
        attestation.run_id.as_str(),
        attestation.revision.as_str(),
    ];
    if identifiers
        .into_iter()
        .any(|value| !valid_release_identifier(value))
        || staging
            .applied_migration_ids
            .iter()
            .any(|value| !valid_release_identifier(value))
        || staging
            .applied_migration_ids
            .iter()
            .collect::<HashSet<_>>()
            .len()
            != staging.applied_migration_ids.len()
    {
        return Err(VerificationError::InvalidInput);
    }

    for digest in [
        &subject.provider_authority_digest,
        &subject.application_digest,
        &subject.migration_digest,
        &subject.migration_plan_digest,
        &subject.source_ledger_digest,
        &subject.promotion_ledger_digest,
        &subject.source_artifact.digest,
        &subject.source_artifact.execution_plan_digest,
        &subject.source_artifact.migration_plan_digest,
        &subject.inspected_ledger.file_digest,
        &subject.inspected_ledger.head_digest,
        &subject.inspected_ledger.selected_entry_digest,
        &staging.schema_digest,
        &staging.applied_prefix_digest,
        &staging.last_receipt_digest,
        &staging.last_no_drift_receipt_digest,
        &receipt.subject_digest,
        &attestation.subject_digest,
        &attestation.source_ledger_digest,
        &attestation.db_push_command_digest,
        &attestation.db_push_receipt_digest,
        &attestation.database_history_digest,
        &receipt.attestation_digest,
        &envelope.integrity.digest,
    ] {
        validate_digest(digest)?;
    }
    canonical_base64::<64>(&envelope.integrity.signature.value)?;
    let attested_at = timestamp_ns(&attestation.attested_at)?;
    let recorded_at = timestamp_ns(&receipt.recorded_at)?;
    if attested_at > recorded_at {
        return Err(VerificationError::InvalidInput);
    }
    Ok(())
}

fn parse_canonical_envelope(bytes: &[u8]) -> Result<SignedReceiptEnvelopeV1, VerificationError> {
    if bytes.is_empty() || bytes.len() > MAX_ENVELOPE_BYTES {
        return Err(VerificationError::InvalidInput);
    }
    let envelope: SignedReceiptEnvelopeV1 =
        serde_json::from_slice(bytes).map_err(|_| VerificationError::InvalidInput)?;
    validate_envelope(&envelope)?;
    if canonical_bytes(&envelope)? != bytes {
        return Err(VerificationError::NonCanonicalInput);
    }
    Ok(envelope)
}

fn validate_internal_digests(
    envelope: &SignedReceiptEnvelopeV1,
) -> Result<([u8; 32], [u8; 32], [u8; 32]), VerificationError> {
    let receipt = &envelope.receipt;
    let prefix = AppliedPrefixV1 {
        format: APPLIED_PREFIX_FORMAT,
        version: 1,
        migration_ids: &receipt.subject.staging.applied_migration_ids,
    };
    let prefix_digest = canonical_digest(&prefix)?;
    let subject_digest = canonical_digest(&receipt.subject)?;
    let attestation_digest = canonical_digest(&receipt.attestation)?;
    let payload = PayloadV1 {
        format: ENVELOPE_FORMAT,
        version: 1,
        receipt,
    };
    let payload_digest = canonical_digest(&payload)?;
    if encode_digest(&prefix_digest) != receipt.subject.staging.applied_prefix_digest
        || encode_digest(&subject_digest) != receipt.subject_digest
        || encode_digest(&attestation_digest) != receipt.attestation_digest
        || encode_digest(&payload_digest) != envelope.integrity.digest
    {
        return Err(VerificationError::DigestMismatch);
    }
    Ok((subject_digest, attestation_digest, payload_digest))
}

fn validated_root<'a>(
    roots: &'a [CompiledTrustRootV1],
    key_id: &str,
    attested_at: i128,
    now: i128,
) -> Result<&'a CompiledTrustRootV1, VerificationError> {
    let mut keys = HashSet::new();
    for root in roots {
        if !valid_module_identity(root.key_id)
            || !keys.insert(root.key_id)
            || timestamp_ns(root.not_before)? > timestamp_ns(root.not_after)?
        {
            return Err(VerificationError::InvalidTrustRoot);
        }
        if let Some(revoked_at) = root.revoked_at {
            timestamp_ns(revoked_at)?;
        }
    }
    let root = roots
        .iter()
        .find(|root| root.key_id == key_id)
        .ok_or(VerificationError::UntrustedKey)?;
    if root.revoked_at.is_some() {
        return Err(VerificationError::RevokedTrustRoot);
    }
    let not_before = timestamp_ns(root.not_before)?;
    let not_after = timestamp_ns(root.not_after)?;
    if attested_at < not_before || attested_at > not_after || now < not_before || now > not_after {
        return Err(VerificationError::UntrustedKey);
    }
    Ok(root)
}

fn expectation_matches(
    envelope: &SignedReceiptEnvelopeV1,
    expected: &TrustedReceiptExpectationV1,
) -> bool {
    let receipt = &envelope.receipt;
    let subject = &receipt.subject;
    let target = &subject.staging.target_authority;
    let attestation = &receipt.attestation;
    subject.project_ref == expected.project_ref
        && subject.account_id == expected.account_id
        && target.grant_generation == expected.grant_generation
        && subject.provider_authority_digest == expected.provider_authority_digest
        && subject.application_id == expected.application_id
        && subject.application_digest == expected.application_digest
        && subject.migration_id == expected.migration_id
        && subject.migration_digest == expected.migration_digest
        && subject.migration_plan_digest == expected.migration_plan_digest
        && subject.source_ledger_digest == expected.source_ledger_digest
        && subject.staging.schema_digest == expected.schema_digest
        && receipt.subject_digest == expected.subject_digest
        && receipt.attestation_digest == expected.attestation_digest
        && envelope.integrity.digest == expected.payload_digest
        && attestation.ci_provider == expected.ci_provider
        && attestation.repository == expected.repository
        && attestation.workflow == expected.workflow
        && attestation.run_id == expected.run_id
        && attestation.run_attempt == expected.run_attempt
        && attestation.protected_ref == expected.protected_ref
        && attestation.revision == expected.revision
        && attestation.db_push_command_digest == expected.db_push_command_digest
        && attestation.db_push_receipt_digest == expected.db_push_receipt_digest
        && attestation.database_history_digest == expected.database_history_digest
}

fn verify_core(
    bytes: &[u8],
    expected: &TrustedReceiptExpectationV1,
    roots: &[CompiledTrustRootV1],
    now: i128,
) -> Result<VerifiedReceiptCoreV1, VerificationError> {
    let envelope = parse_canonical_envelope(bytes)?;
    let (subject_digest, attestation_digest, payload_digest) =
        validate_internal_digests(&envelope)?;
    if !expectation_matches(&envelope, expected) {
        return Err(VerificationError::HostBindingMismatch);
    }
    let attested_at = timestamp_ns(&envelope.receipt.attestation.attested_at)?;
    let root = validated_root(
        roots,
        &envelope.integrity.signature.key_id,
        attested_at,
        now,
    )?;
    let recorded_at = timestamp_ns(&envelope.receipt.recorded_at)?;
    if recorded_at > now {
        return Err(VerificationError::ReceiptFromFuture);
    }
    let payload = PayloadV1 {
        format: ENVELOPE_FORMAT,
        version: 1,
        receipt: &envelope.receipt,
    };
    let signing = SigningMessageV1 {
        payload,
        algorithm: "SHA-256",
        digest: &envelope.integrity.digest,
    };
    let signature = canonical_base64::<64>(&envelope.integrity.signature.value)?;
    UnparsedPublicKey::new(&ED25519, root.public_key)
        .verify(&canonical_bytes(&signing)?, &signature)
        .map_err(|_| VerificationError::SignatureInvalid)?;
    let expectation_digest = canonical_digest(expected)?;
    let mut scope = Sha256::new();
    scope.update(b"openpencil.backend-source-ledger-verified-scope-v1\0");
    scope.update(payload_digest);
    scope.update(expectation_digest);
    Ok(VerifiedReceiptCoreV1 {
        payload_digest,
        subject_digest,
        attestation_digest,
        expectation_digest,
        scope_digest: scope.finalize().into(),
    })
}

#[derive(Clone, Copy)]
struct ClockSampleV1 {
    wall_ns: i128,
    monotonic_ns: u128,
}

trait ReceiptVerifierClockV1: Send + Sync {
    fn sample(&self) -> Result<ClockSampleV1, VerificationError>;
}

struct SystemReceiptVerifierClockV1 {
    origin: Instant,
}

impl SystemReceiptVerifierClockV1 {
    fn new() -> Self {
        Self {
            origin: Instant::now(),
        }
    }
}

impl ReceiptVerifierClockV1 for SystemReceiptVerifierClockV1 {
    fn sample(&self) -> Result<ClockSampleV1, VerificationError> {
        Ok(ClockSampleV1 {
            wall_ns: system_now_ns()?,
            monotonic_ns: self.origin.elapsed().as_nanos(),
        })
    }
}

trait ReceiptVerifierEntropyV1: Send + Sync {
    fn fill(&self, output: &mut [u8]) -> Result<(), VerificationError>;
}

struct SystemReceiptVerifierEntropyV1(SystemRandom);

impl SystemReceiptVerifierEntropyV1 {
    fn new() -> Self {
        Self(SystemRandom::new())
    }
}

impl ReceiptVerifierEntropyV1 for SystemReceiptVerifierEntropyV1 {
    fn fill(&self, output: &mut [u8]) -> Result<(), VerificationError> {
        self.0
            .fill(output)
            .map_err(|_| VerificationError::Collision)
    }
}

struct ActiveVerificationV1 {
    issuer_id: [u8; 32],
    generation: u64,
    scope_digest: [u8; 32],
    expectation_digest: [u8; 32],
    payload_digest: [u8; 32],
    subject_digest: [u8; 32],
    attestation_digest: [u8; 32],
    expires_at_monotonic_ns: u128,
}

struct BurnedVerificationV1 {
    id: [u8; 32],
    scope_digest: [u8; 32],
    expires_at_monotonic_ns: u128,
}

#[derive(Default)]
struct VerificationRegistryV1 {
    active: HashMap<[u8; 32], ActiveVerificationV1>,
    burned: VecDeque<BurnedVerificationV1>,
    last_monotonic_ns: Option<u128>,
    next_generation: u64,
}

impl VerificationRegistryV1 {
    fn observe_clock(&mut self, now: u128) -> Result<(), VerificationError> {
        if self.last_monotonic_ns.is_some_and(|last| now < last) {
            return Err(VerificationError::ClockUnavailable);
        }
        self.last_monotonic_ns = Some(now);
        Ok(())
    }

    fn purge_expired(&mut self, now: u128) {
        self.active
            .retain(|_, entry| entry.expires_at_monotonic_ns > now);
        self.burned
            .retain(|entry| entry.expires_at_monotonic_ns > now);
    }

    fn contains_id(&self, id: &[u8; 32]) -> bool {
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

    fn len(&self) -> usize {
        self.active.len() + self.burned.len()
    }

    fn burn(&mut self, id: [u8; 32], entry: ActiveVerificationV1, now: u128) {
        if entry.expires_at_monotonic_ns > now {
            self.burned.push_back(BurnedVerificationV1 {
                id,
                scope_digest: entry.scope_digest,
                expires_at_monotonic_ns: entry.expires_at_monotonic_ns,
            });
        }
    }
}

struct ReceiptVerifierInnerV1 {
    issuer_id: [u8; 32],
    roots: &'static [CompiledTrustRootV1],
    clock: Arc<dyn ReceiptVerifierClockV1>,
    entropy: Arc<dyn ReceiptVerifierEntropyV1>,
    registry: Mutex<VerificationRegistryV1>,
}

pub(crate) struct BackendSourceLedgerReceiptVerifierV1 {
    inner: Arc<ReceiptVerifierInnerV1>,
}

impl BackendSourceLedgerReceiptVerifierV1 {
    /// This constructor intentionally produces a verifier that cannot trust any signature yet.
    fn new_dormant_production() -> Result<Self, VerificationError> {
        Self::with_dependencies(
            PRODUCTION_TRUST_ROOTS,
            Arc::new(SystemReceiptVerifierClockV1::new()),
            Arc::new(SystemReceiptVerifierEntropyV1::new()),
        )
    }

    fn with_dependencies(
        roots: &'static [CompiledTrustRootV1],
        clock: Arc<dyn ReceiptVerifierClockV1>,
        entropy: Arc<dyn ReceiptVerifierEntropyV1>,
    ) -> Result<Self, VerificationError> {
        let mut issuer_id = [0_u8; 32];
        entropy.fill(&mut issuer_id)?;
        Ok(Self {
            inner: Arc::new(ReceiptVerifierInnerV1 {
                issuer_id,
                roots,
                clock,
                entropy,
                registry: Mutex::new(VerificationRegistryV1::default()),
            }),
        })
    }

    pub(crate) fn verify_and_issue(
        &self,
        bytes: &[u8],
        expected: &TrustedReceiptExpectationV1,
    ) -> Result<VerifiedSourceLedgerReceiptHandleV1, VerificationError> {
        let mut registry = self
            .inner
            .registry
            .lock()
            .map_err(|_| VerificationError::Poisoned)?;
        let sample = self.inner.clock.sample()?;
        registry.observe_clock(sample.monotonic_ns)?;
        registry.purge_expired(sample.monotonic_ns);
        let verified = verify_core(bytes, expected, self.inner.roots, sample.wall_ns)?;
        if registry.contains_scope(&verified.scope_digest) {
            return Err(VerificationError::ScopeAlreadyActive);
        }
        if registry.len() >= MAX_REGISTRY_ENTRIES {
            return Err(VerificationError::RegistryFull);
        }
        let expires_at = sample
            .monotonic_ns
            .checked_add(HANDLE_TTL.as_nanos())
            .ok_or(VerificationError::ClockUnavailable)?;
        let mut id = [0_u8; 32];
        let mut found = false;
        for _ in 0..MAX_ID_ATTEMPTS {
            self.inner.entropy.fill(&mut id)?;
            if !registry.contains_id(&id) {
                found = true;
                break;
            }
        }
        if !found {
            return Err(VerificationError::Collision);
        }
        let generation = registry
            .next_generation
            .checked_add(1)
            .ok_or(VerificationError::RegistryFull)?;
        registry.next_generation = generation;
        registry.active.insert(
            id,
            ActiveVerificationV1 {
                issuer_id: self.inner.issuer_id,
                generation,
                scope_digest: verified.scope_digest,
                expectation_digest: verified.expectation_digest,
                payload_digest: verified.payload_digest,
                subject_digest: verified.subject_digest,
                attestation_digest: verified.attestation_digest,
                expires_at_monotonic_ns: expires_at,
            },
        );
        Ok(VerifiedSourceLedgerReceiptHandleV1 {
            id,
            issuer_id: self.inner.issuer_id,
            generation,
            verifier: Arc::downgrade(&self.inner),
            armed: true,
        })
    }
}

struct ConsumedSourceLedgerReceiptProofV1 {
    payload_digest: [u8; 32],
    subject_digest: [u8; 32],
    attestation_digest: [u8; 32],
}

/// Secret-free values durably bound by the verified signed receipt and the native expectation.
/// This is data only: the journal never accepts this material without the sealed proof below.
pub(crate) struct SourceLedgerAdmissionClaimMaterialV1 {
    pub(crate) provider_id: String,
    pub(crate) environment: String,
    pub(crate) project_ref: String,
    pub(crate) account_id: String,
    pub(crate) grant_generation: String,
    pub(crate) provider_authority_digest: String,
    pub(crate) application_id: String,
    pub(crate) application_digest: String,
    pub(crate) migration_id: String,
    pub(crate) migration_digest: String,
    pub(crate) migration_plan_digest: String,
    pub(crate) source_ledger_digest: String,
    pub(crate) schema_digest: String,
    pub(crate) subject_digest: String,
    pub(crate) attestation_digest: String,
    pub(crate) payload_digest: String,
    pub(crate) expectation_digest: String,
    pub(crate) scope_digest: String,
    pub(crate) ci_provider: String,
    pub(crate) repository: String,
    pub(crate) workflow: String,
    pub(crate) run_id: String,
    pub(crate) run_attempt: u64,
    pub(crate) protected_ref: String,
    pub(crate) revision: String,
    pub(crate) db_push_command_digest: String,
    pub(crate) db_push_receipt_digest: String,
    pub(crate) database_history_digest: String,
}

/// Sealed evidence that one process-local verification capability was successfully consumed.
/// Private fields and the absence of Clone/Debug/Serialize/Deserialize prevent callers from
/// manufacturing, duplicating, logging, or persisting this authority-shaped value.
pub(crate) struct ConsumedSourceLedgerAdmissionProofV1 {
    project_ref: String,
    account_id: String,
    grant_generation: String,
    provider_authority_digest: String,
    application_id: String,
    application_digest: String,
    migration_id: String,
    migration_digest: String,
    migration_plan_digest: String,
    source_ledger_digest: String,
    schema_digest: String,
    payload_digest: [u8; 32],
    subject_digest: [u8; 32],
    attestation_digest: [u8; 32],
    expectation_digest: [u8; 32],
    scope_digest: [u8; 32],
    ci_provider: String,
    repository: String,
    workflow: String,
    run_id: String,
    run_attempt: u64,
    protected_ref: String,
    revision: String,
    db_push_command_digest: String,
    db_push_receipt_digest: String,
    database_history_digest: String,
}

impl ConsumedSourceLedgerAdmissionProofV1 {
    pub(crate) fn into_claim_material(self) -> SourceLedgerAdmissionClaimMaterialV1 {
        SourceLedgerAdmissionClaimMaterialV1 {
            provider_id: "supabase".to_owned(),
            environment: "staging".to_owned(),
            project_ref: self.project_ref,
            account_id: self.account_id,
            grant_generation: self.grant_generation,
            provider_authority_digest: self.provider_authority_digest,
            application_id: self.application_id,
            application_digest: self.application_digest,
            migration_id: self.migration_id,
            migration_digest: self.migration_digest,
            migration_plan_digest: self.migration_plan_digest,
            source_ledger_digest: self.source_ledger_digest,
            schema_digest: self.schema_digest,
            subject_digest: encode_digest(&self.subject_digest),
            attestation_digest: encode_digest(&self.attestation_digest),
            payload_digest: encode_digest(&self.payload_digest),
            expectation_digest: encode_digest(&self.expectation_digest),
            scope_digest: encode_digest(&self.scope_digest),
            ci_provider: self.ci_provider,
            repository: self.repository,
            workflow: self.workflow,
            run_id: self.run_id,
            run_attempt: self.run_attempt,
            protected_ref: self.protected_ref,
            revision: self.revision,
            db_push_command_digest: self.db_push_command_digest,
            db_push_receipt_digest: self.db_push_receipt_digest,
            database_history_digest: self.database_history_digest,
        }
    }
}

/// Opaque, one-shot, process-local evidence handle. Its fields are private and it deliberately does
/// not implement Clone, Debug, Serialize, or Deserialize.
pub(crate) struct VerifiedSourceLedgerReceiptHandleV1 {
    id: [u8; 32],
    issuer_id: [u8; 32],
    generation: u64,
    verifier: Weak<ReceiptVerifierInnerV1>,
    armed: bool,
}

impl VerifiedSourceLedgerReceiptHandleV1 {
    fn consume(
        self,
        expected: &TrustedReceiptExpectationV1,
    ) -> Result<ConsumedSourceLedgerReceiptProofV1, VerificationError> {
        let proof = self.consume_for_admission(expected)?;
        Ok(ConsumedSourceLedgerReceiptProofV1 {
            payload_digest: proof.payload_digest,
            subject_digest: proof.subject_digest,
            attestation_digest: proof.attestation_digest,
        })
    }

    pub(crate) fn consume_for_admission(
        mut self,
        expected: &TrustedReceiptExpectationV1,
    ) -> Result<ConsumedSourceLedgerAdmissionProofV1, VerificationError> {
        let expected_digest = canonical_digest(expected)?;
        let verifier = self
            .verifier
            .upgrade()
            .ok_or(VerificationError::HandleInvalid)?;
        let mut registry = verifier
            .registry
            .lock()
            .map_err(|_| VerificationError::Poisoned)?;
        let sample = verifier.clock.sample()?;
        registry.observe_clock(sample.monotonic_ns)?;
        let Some(active) = registry.active.get(&self.id) else {
            self.armed = false;
            return Err(VerificationError::HandleInvalid);
        };
        if active.issuer_id != self.issuer_id
            || self.issuer_id != verifier.issuer_id
            || active.generation != self.generation
        {
            self.armed = false;
            return Err(VerificationError::HandleInvalid);
        }
        let entry = registry
            .active
            .remove(&self.id)
            .ok_or(VerificationError::HandleInvalid)?;
        let expired = entry.expires_at_monotonic_ns <= sample.monotonic_ns;
        let valid = entry.expectation_digest == expected_digest;
        let proof = ConsumedSourceLedgerAdmissionProofV1 {
            project_ref: expected.project_ref.clone(),
            account_id: expected.account_id.clone(),
            grant_generation: expected.grant_generation.clone(),
            provider_authority_digest: expected.provider_authority_digest.clone(),
            application_id: expected.application_id.clone(),
            application_digest: expected.application_digest.clone(),
            migration_id: expected.migration_id.clone(),
            migration_digest: expected.migration_digest.clone(),
            migration_plan_digest: expected.migration_plan_digest.clone(),
            source_ledger_digest: expected.source_ledger_digest.clone(),
            schema_digest: expected.schema_digest.clone(),
            payload_digest: entry.payload_digest,
            subject_digest: entry.subject_digest,
            attestation_digest: entry.attestation_digest,
            expectation_digest: entry.expectation_digest,
            scope_digest: entry.scope_digest,
            ci_provider: expected.ci_provider.clone(),
            repository: expected.repository.clone(),
            workflow: expected.workflow.clone(),
            run_id: expected.run_id.clone(),
            run_attempt: expected.run_attempt,
            protected_ref: expected.protected_ref.clone(),
            revision: expected.revision.clone(),
            db_push_command_digest: expected.db_push_command_digest.clone(),
            db_push_receipt_digest: expected.db_push_receipt_digest.clone(),
            database_history_digest: expected.database_history_digest.clone(),
        };
        registry.burn(self.id, entry, sample.monotonic_ns);
        self.armed = false;
        if expired {
            return Err(VerificationError::HandleExpired);
        }
        if !valid {
            return Err(VerificationError::HandleInvalid);
        }
        Ok(proof)
    }
}

impl Drop for VerifiedSourceLedgerReceiptHandleV1 {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        let Some(verifier) = self.verifier.upgrade() else {
            return;
        };
        let Ok(mut registry) = verifier.registry.lock() else {
            return;
        };
        let Ok(sample) = verifier.clock.sample() else {
            return;
        };
        if registry.observe_clock(sample.monotonic_ns).is_err() {
            return;
        }
        let matches = registry.active.get(&self.id).is_some_and(|entry| {
            entry.issuer_id == self.issuer_id
                && self.issuer_id == verifier.issuer_id
                && entry.generation == self.generation
        });
        if matches {
            if let Some(entry) = registry.active.remove(&self.id) {
                registry.burn(self.id, entry, sample.monotonic_ns);
            }
        }
        self.armed = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        backend_operation_journal::{
            BackendOperationJournalV1, DirectorySync, JournalClock, JournalEntropy, JournalError,
        },
        backend_source_ledger_admission::{
            BackendSourceLedgerAdmissionErrorV1, BackendSourceLedgerAdmissionV1,
        },
    };
    use std::{
        fs::File,
        path::Path,
        sync::{
            atomic::{AtomicU64, AtomicU8, Ordering},
            Barrier,
        },
        thread,
    };
    use tempfile::TempDir;

    const FIXTURE_JSON: &[u8] = include_bytes!(
        "../../packages/lowcode/tests/fixtures/backend-source-ledger-signed-receipt-v1.json"
    );
    const ZERO_DIGEST: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const TEST_PUBLIC_KEY: [u8; 32] = [
        121, 181, 86, 46, 143, 230, 84, 249, 64, 120, 177, 18, 232, 169, 139, 167, 144, 31, 133,
        58, 230, 149, 190, 215, 224, 227, 145, 11, 173, 4, 150, 100,
    ];
    const TEST_ROOT: CompiledTrustRootV1 = CompiledTrustRootV1 {
        key_id: "openpencil.source-ledger.ci-test-2026-01",
        public_key: TEST_PUBLIC_KEY,
        not_before: "2026-09-08T09:59:00Z",
        not_after: "2026-09-08T11:00:00Z",
        revoked_at: None,
    };
    const TEST_ROOTS: &[CompiledTrustRootV1] = &[TEST_ROOT];

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct GoldenFixtureV1 {
        fixture_format: String,
        fixture_version: u8,
        evaluated_at: String,
        public_key_base64url: String,
        payload_digest: String,
        envelope: Value,
        canonical_envelope_sha256: String,
        signing_bytes_sha256: String,
    }

    fn fixture() -> GoldenFixtureV1 {
        serde_json::from_slice(FIXTURE_JSON).expect("fixture must parse")
    }

    fn envelope_bytes() -> Vec<u8> {
        canonical_bytes(&fixture().envelope).expect("fixture envelope must canonicalize")
    }

    fn parsed_fixture() -> SignedReceiptEnvelopeV1 {
        parse_canonical_envelope(&envelope_bytes()).expect("fixture envelope must parse")
    }

    fn expectation() -> TrustedReceiptExpectationV1 {
        let envelope = parsed_fixture();
        let receipt = envelope.receipt;
        let subject = receipt.subject;
        let target = subject.staging.target_authority;
        let attestation = receipt.attestation;
        TrustedReceiptExpectationV1 {
            project_ref: subject.project_ref,
            account_id: subject.account_id,
            grant_generation: target.grant_generation,
            provider_authority_digest: subject.provider_authority_digest,
            application_id: subject.application_id,
            application_digest: subject.application_digest,
            migration_id: subject.migration_id,
            migration_digest: subject.migration_digest,
            migration_plan_digest: subject.migration_plan_digest,
            source_ledger_digest: subject.source_ledger_digest,
            schema_digest: subject.staging.schema_digest,
            subject_digest: receipt.subject_digest,
            attestation_digest: receipt.attestation_digest,
            payload_digest: envelope.integrity.digest,
            ci_provider: attestation.ci_provider,
            repository: attestation.repository,
            workflow: attestation.workflow,
            run_id: attestation.run_id,
            run_attempt: attestation.run_attempt,
            protected_ref: attestation.protected_ref,
            revision: attestation.revision,
            db_push_command_digest: attestation.db_push_command_digest,
            db_push_receipt_digest: attestation.db_push_receipt_digest,
            database_history_digest: attestation.database_history_digest,
        }
    }

    fn fixture_now() -> i128 {
        timestamp_ns(&fixture().evaluated_at).expect("fixture time")
    }

    fn mutated_envelope(mutate: impl FnOnce(&mut serde_json::Map<String, Value>)) -> Vec<u8> {
        let mut envelope = fixture().envelope;
        mutate(envelope.as_object_mut().expect("envelope object"));
        canonical_bytes(&envelope).expect("mutated canonical envelope")
    }

    fn receipt_mutation(mutate: impl FnOnce(&mut serde_json::Map<String, Value>)) -> Vec<u8> {
        mutated_envelope(|envelope| {
            let receipt = envelope
                .get_mut("receipt")
                .and_then(Value::as_object_mut)
                .expect("receipt object");
            mutate(receipt);
        })
    }

    struct ManualClockV1(Mutex<ClockSampleV1>);

    impl ManualClockV1 {
        fn new() -> Self {
            Self(Mutex::new(ClockSampleV1 {
                wall_ns: fixture_now(),
                monotonic_ns: 1_000_000,
            }))
        }

        fn advance(&self, duration: Duration) {
            let mut sample = self.0.lock().expect("clock");
            sample.wall_ns += duration.as_nanos() as i128;
            sample.monotonic_ns += duration.as_nanos();
        }
    }

    impl ReceiptVerifierClockV1 for ManualClockV1 {
        fn sample(&self) -> Result<ClockSampleV1, VerificationError> {
            Ok(*self.0.lock().map_err(|_| VerificationError::Poisoned)?)
        }
    }

    struct CounterEntropyV1(AtomicU8);

    impl CounterEntropyV1 {
        fn new() -> Self {
            Self(AtomicU8::new(1))
        }
    }

    impl ReceiptVerifierEntropyV1 for CounterEntropyV1 {
        fn fill(&self, output: &mut [u8]) -> Result<(), VerificationError> {
            output.fill(0);
            output[0] = self.0.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    }

    struct ConstantEntropyV1(u8);

    impl ReceiptVerifierEntropyV1 for ConstantEntropyV1 {
        fn fill(&self, output: &mut [u8]) -> Result<(), VerificationError> {
            output.fill(self.0);
            Ok(())
        }
    }

    fn verifier(clock: Arc<ManualClockV1>) -> BackendSourceLedgerReceiptVerifierV1 {
        BackendSourceLedgerReceiptVerifierV1::with_dependencies(
            TEST_ROOTS,
            clock,
            Arc::new(CounterEntropyV1::new()),
        )
        .expect("verifier")
    }

    struct AdmissionJournalClockV1 {
        wall_millis: AtomicU64,
        monotonic_millis: AtomicU64,
    }

    impl AdmissionJournalClockV1 {
        fn new() -> Self {
            Self {
                wall_millis: AtomicU64::new(
                    u64::try_from(fixture_now() / 1_000_000).expect("fixture millis"),
                ),
                monotonic_millis: AtomicU64::new(0),
            }
        }

        fn advance(&self, duration: Duration) {
            let millis = u64::try_from(duration.as_millis()).expect("duration millis");
            self.wall_millis.fetch_add(millis, Ordering::SeqCst);
            self.monotonic_millis.fetch_add(millis, Ordering::SeqCst);
        }
    }

    impl JournalClock for AdmissionJournalClockV1 {
        fn wall_unix_millis(&self) -> Result<u64, JournalError> {
            Ok(self.wall_millis.load(Ordering::SeqCst))
        }

        fn monotonic(&self) -> Duration {
            Duration::from_millis(self.monotonic_millis.load(Ordering::SeqCst))
        }
    }

    struct AdmissionJournalEntropyV1(AtomicU64);

    impl AdmissionJournalEntropyV1 {
        fn new() -> Self {
            Self(AtomicU64::new(1))
        }
    }

    impl JournalEntropy for AdmissionJournalEntropyV1 {
        fn capability_id(&self) -> Result<[u8; 32], JournalError> {
            let mut id = [0_u8; 32];
            id[24..].copy_from_slice(&self.0.fetch_add(1, Ordering::SeqCst).to_be_bytes());
            Ok(id)
        }
    }

    struct ConfirmingDirectorySyncV1;

    impl DirectorySync for ConfirmingDirectorySyncV1 {
        fn sync(&self, directory: &Path) -> Result<(), JournalError> {
            File::open(directory)
                .and_then(|file| file.sync_all())
                .map_err(|_| JournalError::Unavailable)
        }
    }

    struct UnconfirmedDirectorySyncV1;

    impl DirectorySync for UnconfirmedDirectorySyncV1 {
        fn sync(&self, _: &Path) -> Result<(), JournalError> {
            Err(JournalError::Unavailable)
        }
    }

    fn admission_journal(
        temp: &TempDir,
        clock: Arc<AdmissionJournalClockV1>,
        directory_sync: Arc<dyn DirectorySync>,
    ) -> Arc<BackendOperationJournalV1> {
        Arc::new(BackendOperationJournalV1::with_test_dependencies(
            temp.path().join("app-data"),
            Arc::new(AdmissionJournalEntropyV1::new()),
            clock,
            directory_sync,
        ))
    }

    #[test]
    fn cross_language_fixture_matches_canonical_hashes_and_real_ed25519() {
        let fixture = fixture();
        assert_eq!(
            fixture.fixture_format,
            "openpencil.test.source-ledger-signed-receipt-cross-language"
        );
        assert_eq!(fixture.fixture_version, 1);
        assert_eq!(
            canonical_base64::<32>(&fixture.public_key_base64url).unwrap(),
            TEST_PUBLIC_KEY
        );
        let bytes = canonical_bytes(&fixture.envelope).unwrap();
        assert_eq!(
            encode_digest(&sha256(&bytes)),
            fixture.canonical_envelope_sha256
        );
        let envelope = parse_canonical_envelope(&bytes).unwrap();
        let payload = PayloadV1 {
            format: ENVELOPE_FORMAT,
            version: 1,
            receipt: &envelope.receipt,
        };
        let signing = SigningMessageV1 {
            payload,
            algorithm: "SHA-256",
            digest: &envelope.integrity.digest,
        };
        assert_eq!(
            encode_digest(&sha256(&canonical_bytes(&signing).unwrap())),
            fixture.signing_bytes_sha256
        );
        assert_eq!(envelope.integrity.digest, fixture.payload_digest);
        let verified = verify_core(&bytes, &expectation(), TEST_ROOTS, fixture_now()).unwrap();
        assert_eq!(
            encode_digest(&verified.payload_digest),
            fixture.payload_digest
        );
    }

    #[test]
    fn canonical_input_rejects_whitespace_duplicate_escape_unknown_utf8_and_size_variants() {
        let canonical = envelope_bytes();
        let mut whitespace = vec![b' '];
        whitespace.extend_from_slice(&canonical);
        assert_eq!(
            parse_canonical_envelope(&whitespace)
                .err()
                .expect("expected error"),
            VerificationError::NonCanonicalInput
        );

        let json = String::from_utf8(canonical.clone()).unwrap();
        let duplicate = json.replacen(
            "\"runId\":\"run-1001\"",
            "\"runId\":\"run-1001\",\"runId\":\"run-1001\"",
            1,
        );
        assert_eq!(
            parse_canonical_envelope(duplicate.as_bytes())
                .err()
                .expect("expected error"),
            VerificationError::InvalidInput
        );
        let alternate_escape = json.replacen('雪', "\\u96ea", 1);
        assert_eq!(
            parse_canonical_envelope(alternate_escape.as_bytes())
                .err()
                .expect("expected error"),
            VerificationError::NonCanonicalInput
        );
        let unknown = mutated_envelope(|envelope| {
            envelope.insert("trusted".into(), Value::Bool(true));
        });
        assert_eq!(
            parse_canonical_envelope(&unknown)
                .err()
                .expect("expected error"),
            VerificationError::InvalidInput
        );
        assert_eq!(
            parse_canonical_envelope(&[0xff])
                .err()
                .expect("expected error"),
            VerificationError::InvalidInput
        );
        assert_eq!(
            parse_canonical_envelope(&vec![b' '; MAX_ENVELOPE_BYTES + 1])
                .err()
                .expect("expected error"),
            VerificationError::InvalidInput
        );
    }

    #[test]
    fn internal_digest_chain_and_safe_integer_fail_closed() {
        let subject = receipt_mutation(|receipt| {
            receipt.insert("subjectDigest".into(), Value::String(ZERO_DIGEST.into()));
            receipt
                .get_mut("attestation")
                .and_then(Value::as_object_mut)
                .expect("attestation")
                .insert("subjectDigest".into(), Value::String(ZERO_DIGEST.into()));
        });
        assert_eq!(
            verify_core(&subject, &expectation(), TEST_ROOTS, fixture_now())
                .err()
                .expect("expected error"),
            VerificationError::DigestMismatch
        );
        let prefix = receipt_mutation(|receipt| {
            receipt
                .get_mut("subject")
                .and_then(Value::as_object_mut)
                .and_then(|subject| subject.get_mut("staging"))
                .and_then(Value::as_object_mut)
                .expect("staging")
                .insert(
                    "appliedPrefixDigest".into(),
                    Value::String(ZERO_DIGEST.into()),
                );
        });
        assert_eq!(
            verify_core(&prefix, &expectation(), TEST_ROOTS, fixture_now())
                .err()
                .expect("expected error"),
            VerificationError::DigestMismatch
        );
        let unsafe_integer = receipt_mutation(|receipt| {
            receipt
                .get_mut("attestation")
                .and_then(Value::as_object_mut)
                .expect("attestation")
                .insert(
                    "runAttempt".into(),
                    Value::Number(serde_json::Number::from(MAX_SAFE_INTEGER + 1)),
                );
        });
        assert_eq!(
            parse_canonical_envelope(&unsafe_integer)
                .err()
                .expect("expected error"),
            VerificationError::InvalidInput
        );
    }

    #[test]
    fn signature_root_time_and_host_snapshot_are_independent_fail_closed_inputs() {
        let bytes = envelope_bytes();
        let mut wrong = expectation();
        wrong.grant_generation = "other-grant".into();
        assert_eq!(
            verify_core(&bytes, &wrong, TEST_ROOTS, fixture_now())
                .err()
                .expect("expected error"),
            VerificationError::HostBindingMismatch
        );
        assert_eq!(
            verify_core(&bytes, &expectation(), &[], fixture_now())
                .err()
                .expect("expected error"),
            VerificationError::UntrustedKey
        );
        let revoked = [CompiledTrustRootV1 {
            revoked_at: Some("2026-09-08T10:00:01Z"),
            ..TEST_ROOT
        }];
        assert_eq!(
            verify_core(&bytes, &expectation(), &revoked, fixture_now())
                .err()
                .expect("expected error"),
            VerificationError::RevokedTrustRoot
        );
        let duplicates = [TEST_ROOT, TEST_ROOT];
        assert_eq!(
            verify_core(&bytes, &expectation(), &duplicates, fixture_now())
                .err()
                .expect("expected error"),
            VerificationError::InvalidTrustRoot
        );
        assert_eq!(
            verify_core(
                &bytes,
                &expectation(),
                TEST_ROOTS,
                timestamp_ns("2026-09-08T12:00:00Z").unwrap()
            )
            .err()
            .expect("expected error"),
            VerificationError::UntrustedKey
        );
        let signature = mutated_envelope(|envelope| {
            let value = envelope
                .get_mut("integrity")
                .and_then(Value::as_object_mut)
                .and_then(|integrity| integrity.get_mut("signature"))
                .and_then(Value::as_object_mut)
                .and_then(|signature| signature.get_mut("value"))
                .and_then(|value| value.as_str())
                .unwrap()
                .to_owned();
            let mut bytes = URL_SAFE_NO_PAD.decode(value).unwrap();
            bytes[0] ^= 1;
            envelope
                .get_mut("integrity")
                .and_then(Value::as_object_mut)
                .and_then(|integrity| integrity.get_mut("signature"))
                .and_then(Value::as_object_mut)
                .unwrap()
                .insert("value".into(), Value::String(URL_SAFE_NO_PAD.encode(bytes)));
        });
        assert_eq!(
            verify_core(&signature, &expectation(), TEST_ROOTS, fixture_now())
                .err()
                .expect("expected error"),
            VerificationError::SignatureInvalid
        );
    }

    #[test]
    fn timestamp_parser_preserves_nanoseconds_and_real_calendar_rules() {
        let earlier = timestamp_ns("2024-02-29T00:00:00.000000001Z").unwrap();
        let later = timestamp_ns("2024-02-29T00:00:00.000000002Z").unwrap();
        assert_eq!(later - earlier, 1);
        assert_eq!(
            timestamp_ns("2023-02-29T00:00:00Z")
                .err()
                .expect("expected error"),
            VerificationError::InvalidInput
        );
        assert_eq!(
            timestamp_ns("2024-02-29T00:00:00.0000000000Z")
                .err()
                .expect("expected error"),
            VerificationError::InvalidInput
        );
    }

    #[test]
    fn semantic_boundary_rejects_secret_material_ecmascript_trim_and_noncanonical_project_refs() {
        for secret in [
            "Bearer Abcdefghijklmno1",
            "Bearer\u{feff}Abcdefghijklmno1",
            "postgres://user:password@host",
            "-----BEGIN PRIVATE KEY-----",
            "api_key=Abcdef1234567890",
            "Abcdefghijklmnopqrstuvwxyz0123456789",
            "api_key : Abcdef1234567890",
            "token: +Abcdefghijklmno",
            "eyJabcdefgh.eyJabcdefgh.abcdefgh!",
            "https://example.com postgres://user:password@host",
        ] {
            assert!(!valid_text(secret, 1_024), "secret-like text: {secret}");
        }
        for secret in [
            "github_pat_abcdefgh",
            "Abcdefghijklmnopqrstuvwxyz0123456789",
        ] {
            assert!(
                !valid_release_identifier(secret),
                "secret-like identifier: {secret}"
            );
        }
        assert!(!valid_text("\u{feff}open-pencil/repository", 1_024));
        assert!(!valid_text("open-pencil/repository\u{feff}", 1_024));
        assert!(valid_supabase_project_ref("enekobitnhobuiuamvqj"));
        for invalid in [
            "ENEKOBITNHOBUIUAMVQJ",
            "enekobitnhobuiuamvq1",
            "enekobitnhobuiuamvq-",
        ] {
            assert!(
                !valid_supabase_project_ref(invalid),
                "project ref: {invalid}"
            );
        }
    }

    #[test]
    fn one_shot_handle_consumes_burns_drops_expires_and_single_flights_scope() {
        let clock = Arc::new(ManualClockV1::new());
        let verifier = verifier(clock.clone());
        let bytes = envelope_bytes();
        let expected = expectation();
        let handle = verifier.verify_and_issue(&bytes, &expected).unwrap();
        assert_eq!(
            verifier
                .verify_and_issue(&bytes, &expected)
                .err()
                .expect("expected error"),
            VerificationError::ScopeAlreadyActive
        );
        let forged = VerifiedSourceLedgerReceiptHandleV1 {
            id: handle.id,
            issuer_id: handle.issuer_id,
            generation: handle.generation,
            verifier: handle.verifier.clone(),
            armed: true,
        };
        let proof = handle.consume(&expected).unwrap();
        assert_eq!(
            encode_digest(&proof.payload_digest),
            expected.payload_digest
        );
        assert_eq!(
            forged.consume(&expected).err().expect("expected error"),
            VerificationError::HandleInvalid
        );
        assert_eq!(
            verifier
                .verify_and_issue(&bytes, &expected)
                .err()
                .expect("expected error"),
            VerificationError::ScopeAlreadyActive
        );
        clock.advance(HANDLE_TTL + Duration::from_nanos(1));
        let dropped = verifier.verify_and_issue(&bytes, &expected).unwrap();
        drop(dropped);
        assert_eq!(
            verifier
                .verify_and_issue(&bytes, &expected)
                .err()
                .expect("expected error"),
            VerificationError::ScopeAlreadyActive
        );
        clock.advance(HANDLE_TTL + Duration::from_nanos(1));
        let expired = verifier.verify_and_issue(&bytes, &expected).unwrap();
        clock.advance(HANDLE_TTL + Duration::from_nanos(1));
        assert_eq!(
            expired.consume(&expected).err().expect("expected error"),
            VerificationError::HandleExpired
        );
    }

    #[test]
    fn wrong_consume_binding_burns_handle_and_registry_limits_and_collisions_fail_closed() {
        let clock = Arc::new(ManualClockV1::new());
        let verifier = verifier(clock.clone());
        let bytes = envelope_bytes();
        let expected = expectation();
        let handle = verifier.verify_and_issue(&bytes, &expected).unwrap();
        let mut wrong = expectation();
        wrong.repository = "other/repository".into();
        assert_eq!(
            handle.consume(&wrong).err().expect("expected error"),
            VerificationError::HandleInvalid
        );
        assert_eq!(
            verifier
                .verify_and_issue(&bytes, &expected)
                .err()
                .expect("expected error"),
            VerificationError::ScopeAlreadyActive
        );

        clock.advance(HANDLE_TTL + Duration::from_nanos(1));
        {
            let mut registry = verifier.inner.registry.lock().unwrap();
            registry
                .observe_clock(clock.sample().unwrap().monotonic_ns)
                .unwrap();
            registry.purge_expired(clock.sample().unwrap().monotonic_ns);
            for index in 0..MAX_REGISTRY_ENTRIES {
                let mut id = [0_u8; 32];
                id[0..8].copy_from_slice(&(index as u64).to_be_bytes());
                registry.burned.push_back(BurnedVerificationV1 {
                    id,
                    scope_digest: sha256(&id),
                    expires_at_monotonic_ns: u128::MAX,
                });
            }
        }
        assert_eq!(
            verifier
                .verify_and_issue(&bytes, &expected)
                .err()
                .expect("expected error"),
            VerificationError::RegistryFull
        );

        let collision_clock = Arc::new(ManualClockV1::new());
        let collision_verifier = BackendSourceLedgerReceiptVerifierV1::with_dependencies(
            TEST_ROOTS,
            collision_clock.clone(),
            Arc::new(ConstantEntropyV1(7)),
        )
        .unwrap();
        {
            let mut registry = collision_verifier.inner.registry.lock().unwrap();
            registry.burned.push_back(BurnedVerificationV1 {
                id: [7; 32],
                scope_digest: [9; 32],
                expires_at_monotonic_ns: u128::MAX,
            });
        }
        assert_eq!(
            collision_verifier
                .verify_and_issue(&bytes, &expected)
                .err()
                .expect("expected error"),
            VerificationError::Collision
        );

        let reuse_clock = Arc::new(ManualClockV1::new());
        let reuse_verifier = BackendSourceLedgerReceiptVerifierV1::with_dependencies(
            TEST_ROOTS,
            reuse_clock.clone(),
            Arc::new(ConstantEntropyV1(11)),
        )
        .unwrap();
        let stale = reuse_verifier.verify_and_issue(&bytes, &expected).unwrap();
        reuse_clock.advance(HANDLE_TTL + Duration::from_nanos(1));
        let replacement = reuse_verifier.verify_and_issue(&bytes, &expected).unwrap();
        assert_eq!(stale.id, replacement.id);
        assert_ne!(stale.generation, replacement.generation);
        assert_eq!(
            stale.consume(&expected).err().expect("expected error"),
            VerificationError::HandleInvalid
        );
        assert!(replacement.consume(&expected).is_ok());
    }

    #[test]
    fn receipt_zero_admission_is_durable_one_shot_and_grants_no_later_authority() {
        let temp = TempDir::new().unwrap();
        let journal = Arc::new(BackendOperationJournalV1::new(temp.path().join("app-data")));
        let admission = BackendSourceLedgerAdmissionV1::new(journal.clone());
        let expected = expectation();
        let receipt_verifier = verifier(Arc::new(ManualClockV1::new()));
        let verified = receipt_verifier
            .verify_and_issue(&envelope_bytes(), &expected)
            .unwrap();
        let admitted = admission.admit(verified, &expected).unwrap();

        assert!(admitted.cryptographically_verified());
        assert!(admitted.durably_admitted());
        assert!(!admitted.database_authority_created());
        assert!(!admitted.mutation_authorized());
        assert!(!admitted.execution_authorized());
        assert!(!admitted.receipt_v2_issued());
        assert!(!admitted.release_authorized());
        assert_eq!(journal.source_ledger_admission_count_for_test().unwrap(), 1);

        admitted.consume_for_test().unwrap();
        assert_eq!(journal.source_ledger_admission_count_for_test().unwrap(), 1);

        let tampered_temp = TempDir::new().unwrap();
        let tampered_journal = Arc::new(BackendOperationJournalV1::new(
            tampered_temp.path().join("app-data"),
        ));
        let tampered_admission = BackendSourceLedgerAdmissionV1::new(tampered_journal.clone());
        let receipt_verifier = verifier(Arc::new(ManualClockV1::new()));
        let expected = expectation();
        let verified = receipt_verifier
            .verify_and_issue(&envelope_bytes(), &expected)
            .unwrap();
        let mut wrong = expectation();
        wrong.schema_digest = ZERO_DIGEST.to_owned();
        assert_eq!(
            tampered_admission
                .admit(verified, &wrong)
                .err()
                .expect("tampered binding must fail"),
            BackendSourceLedgerAdmissionErrorV1::ReceiptRejected
        );
        assert_eq!(
            tampered_journal
                .source_ledger_admission_count_for_test()
                .unwrap(),
            0
        );
    }

    #[test]
    fn receipt_zero_admission_replay_survives_drop_restart_and_concurrency() {
        let temp = TempDir::new().unwrap();
        let app_data = temp.path().join("app-data");
        let first_journal = Arc::new(BackendOperationJournalV1::new(app_data.clone()));
        let expected = expectation();
        let receipt_verifier = verifier(Arc::new(ManualClockV1::new()));
        let verified = receipt_verifier
            .verify_and_issue(&envelope_bytes(), &expected)
            .unwrap();
        let admitted = BackendSourceLedgerAdmissionV1::new(first_journal)
            .admit(verified, &expected)
            .unwrap();
        drop(admitted);

        let restarted_journal = Arc::new(BackendOperationJournalV1::new(app_data));
        let receipt_verifier = verifier(Arc::new(ManualClockV1::new()));
        let verified = receipt_verifier
            .verify_and_issue(&envelope_bytes(), &expected)
            .unwrap();
        assert_eq!(
            BackendSourceLedgerAdmissionV1::new(restarted_journal.clone())
                .admit(verified, &expected)
                .err()
                .expect("durable replay must fail"),
            BackendSourceLedgerAdmissionErrorV1::ReplayBlocked
        );
        assert_eq!(
            restarted_journal
                .source_ledger_admission_count_for_test()
                .unwrap(),
            1
        );

        let concurrent_temp = TempDir::new().unwrap();
        let concurrent_app_data = concurrent_temp.path().join("app-data");
        let journal_a = Arc::new(BackendOperationJournalV1::new(concurrent_app_data.clone()));
        let journal_b = Arc::new(BackendOperationJournalV1::new(concurrent_app_data.clone()));
        let expected_a = expectation();
        let expected_b = expectation();
        let verifier_a = verifier(Arc::new(ManualClockV1::new()));
        let verifier_b = verifier(Arc::new(ManualClockV1::new()));
        let verified_a = verifier_a
            .verify_and_issue(&envelope_bytes(), &expected_a)
            .unwrap();
        let verified_b = verifier_b
            .verify_and_issue(&envelope_bytes(), &expected_b)
            .unwrap();
        let barrier = Arc::new(Barrier::new(2));
        let barrier_a = barrier.clone();
        let thread_a = thread::spawn(move || {
            barrier_a.wait();
            BackendSourceLedgerAdmissionV1::new(journal_a)
                .admit(verified_a, &expected_a)
                .map(|_| ())
        });
        let thread_b = thread::spawn(move || {
            barrier.wait();
            BackendSourceLedgerAdmissionV1::new(journal_b)
                .admit(verified_b, &expected_b)
                .map(|_| ())
        });
        let results = [thread_a.join().unwrap(), thread_b.join().unwrap()];
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter(|result| {
                    matches!(
                        result,
                        Err(BackendSourceLedgerAdmissionErrorV1::ReplayBlocked)
                    )
                })
                .count(),
            1
        );
        assert_eq!(
            BackendOperationJournalV1::new(concurrent_app_data)
                .source_ledger_admission_count_for_test()
                .unwrap(),
            1
        );
    }

    #[test]
    fn unconfirmed_or_expired_admission_never_unlocks_durable_replay_fence() {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(AdmissionJournalClockV1::new());
        let unconfirmed =
            admission_journal(&temp, clock.clone(), Arc::new(UnconfirmedDirectorySyncV1));
        let expected = expectation();
        let receipt_verifier = verifier(Arc::new(ManualClockV1::new()));
        let verified = receipt_verifier
            .verify_and_issue(&envelope_bytes(), &expected)
            .unwrap();
        assert_eq!(
            BackendSourceLedgerAdmissionV1::new(unconfirmed)
                .admit(verified, &expected)
                .err()
                .expect("directory sync failure must be surfaced"),
            BackendSourceLedgerAdmissionErrorV1::DurabilityUnconfirmed
        );

        let confirmed =
            admission_journal(&temp, clock.clone(), Arc::new(ConfirmingDirectorySyncV1));
        let receipt_verifier = verifier(Arc::new(ManualClockV1::new()));
        let verified = receipt_verifier
            .verify_and_issue(&envelope_bytes(), &expected)
            .unwrap();
        assert_eq!(
            BackendSourceLedgerAdmissionV1::new(confirmed.clone())
                .admit(verified, &expected)
                .err()
                .expect("unconfirmed acknowledgement must still fence retry"),
            BackendSourceLedgerAdmissionErrorV1::ReplayBlocked
        );
        assert_eq!(
            confirmed.source_ledger_admission_count_for_test().unwrap(),
            1
        );

        let expiry_temp = TempDir::new().unwrap();
        let expiry_clock = Arc::new(AdmissionJournalClockV1::new());
        let expiry_journal = admission_journal(
            &expiry_temp,
            expiry_clock.clone(),
            Arc::new(ConfirmingDirectorySyncV1),
        );
        let receipt_verifier = verifier(Arc::new(ManualClockV1::new()));
        let verified = receipt_verifier
            .verify_and_issue(&envelope_bytes(), &expected)
            .unwrap();
        let admitted = BackendSourceLedgerAdmissionV1::new(expiry_journal.clone())
            .admit(verified, &expected)
            .unwrap();
        expiry_clock.advance(Duration::from_secs(31));
        assert_eq!(
            admitted
                .consume_for_test()
                .err()
                .expect("TTL capability must expire"),
            BackendSourceLedgerAdmissionErrorV1::HandleExpired
        );
        assert_eq!(
            expiry_journal
                .source_ledger_admission_count_for_test()
                .unwrap(),
            1
        );
        let receipt_verifier = verifier(Arc::new(ManualClockV1::new()));
        let verified = receipt_verifier
            .verify_and_issue(&envelope_bytes(), &expected)
            .unwrap();
        assert_eq!(
            BackendSourceLedgerAdmissionV1::new(expiry_journal)
                .admit(verified, &expected)
                .err()
                .expect("expiry must not unlock durable fence"),
            BackendSourceLedgerAdmissionErrorV1::ReplayBlocked
        );
    }

    #[test]
    fn production_root_table_is_empty_and_handle_is_send() {
        assert!(PRODUCTION_TRUST_ROOTS.is_empty());
        fn assert_send<T: Send>() {}
        assert_send::<VerifiedSourceLedgerReceiptHandleV1>();
        let verifier = BackendSourceLedgerReceiptVerifierV1::new_dormant_production().unwrap();
        assert_eq!(
            verifier
                .verify_and_issue(&envelope_bytes(), &expectation())
                .err()
                .expect("expected error"),
            VerificationError::UntrustedKey
        );
    }
}
