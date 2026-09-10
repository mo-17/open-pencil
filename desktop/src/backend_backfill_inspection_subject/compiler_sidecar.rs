//! Private, dormant Host boundary for the review-only Backend Compiler sidecar.
//!
//! This module proves that Rust can create and bind one canonical Compiler request and strictly
//! validate the two response envelopes. Its private runner child is the only production-compiled
//! path that may turn that unforgeable result into a registry proof. Nothing is exposed to parent
//! siblings, Tauri, or the renderer; binary location and platform packaging remain separate gates.

#[path = "compiler_sidecar_runner.rs"]
mod runner;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use super::{
    compare_ecmascript_keys, decode_digest, digest_bytes, ecmascript_number_json, valid_stable_id,
    validate_and_project, validate_material, ActiveEntryV1,
    BackendBackfillInspectionSubjectErrorV1, BackendBackfillInspectionSubjectRegistryV1,
    BackfillInspectionSubjectMaterialV1, CompilerBackfillInspectionSubjectEnvelopeV1,
    SealedBackfillInspectionSubjectProofV1, ID_ATTEMPTS, ID_BYTES,
};

const REQUEST_VERSION: u8 = 1;
const REQUEST_DIGEST_DOMAIN: &str = "openpencil.compiler.supabase-backfill-inspection-request.v1";
const COMPILER_TRUST_DIGEST: &str = "oDpvqWPIvv_9Xs47gJBTH2NwOYb8hFvuCii2nrUe7fw";
const COMPILER_SELECTION_PACKAGE_DIGEST: &str =
    "sha256:oDpvqWPIvv_9Xs47gJBTH2NwOYb8hFvuCii2nrUe7fw";
const COMPILER_PROVIDER_AUTHORITY_DIGEST: &str = "yxHu60plP0KqrMD40EHcA7lKz45BN6NC9B26FBLltOo";
const MAXIMUM_REQUEST_BYTES: usize = 1_048_576;
const MAXIMUM_OUTPUT_PAYLOAD_BYTES: usize = 262_144;
const MAXIMUM_OUTPUT_FRAME_BYTES: usize = MAXIMUM_OUTPUT_PAYLOAD_BYTES + 1;
const MAXIMUM_STDERR_BYTES: usize = 64 * 1024;
const MAXIMUM_JSON_DEPTH: usize = 24;
const MAXIMUM_JSON_NODES: usize = 20_000;

// This is the canonical, recursively ASCII-key-sorted Compiler-only trust declaration. Its digest
// is not a binary hash, app-bundle identity, installed-package receipt, or publisher attestation.
const EXPECTED_COMPILER_BUILD_AUTHORITY: &str = r#"{"appBundleAuthorityCreated":false,"compilerTrustDomain":{"descriptor":{"providerDescriptor":{"adapterId":"open-pencil.backend.supabase.v2","adapterVersion":"2.3.0","capabilities":["auth.identity","data.read","data.write","events.data-change","migrations.backfill","migrations.data","migrations.schema","policy.row-level","realtime.subscribe","transactions.atomic"],"contractVersion":2,"contributionId":"supabase.backend.v2","outputs":["client-config","database-schema","deployment-manifest","migration-plan","security-policy","server-runtime"],"pluginId":"open-pencil.supabase-backend","providerId":"supabase","supportedModelVersions":[2]},"trustProfile":{"appBundleAuthorityCreated":false,"application":{"format":"openpencil.backend-application","version":2},"compilationMode":"production","credentialAuthorityCreated":false,"executionAuthorityCreated":false,"format":"openpencil.supabase-backfill-compiler-trust-profile.v1","installAuthorityCreated":false,"networkAuthorityCreated":false,"output":{"queryFamily":"openpencil.supabase-backfill-catalog-inspection.v1","subjectFormat":"openpencil.supabase-backfill-inspection-subject.v1"},"releaseAuthorityCreated":false,"reviewOnly":true,"sqlExecutionAuthorityCreated":false,"targets":["react","vue"],"version":1}},"digest":"oDpvqWPIvv_9Xs47gJBTH2NwOYb8hFvuCii2nrUe7fw","domain":"openpencil.compiler.supabase-backfill-inspection-trust.v1"},"credentialAuthorityCreated":false,"executionAuthorityCreated":false,"format":"openpencil.supabase-backfill-compiler-build-authority.v1","installAuthorityCreated":false,"networkAuthorityCreated":false,"protocol":{"id":"openpencil.supabase-backfill-inspection-wire.v1","version":1},"releaseAuthorityCreated":false,"sqlExecutionAuthorityCreated":false,"version":1}"#;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CompilerBackfillTargetV1 {
    React,
    Vue,
}

impl CompilerBackfillTargetV1 {
    const fn as_str(self) -> &'static str {
        match self {
            Self::React => "react",
            Self::Vue => "vue",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum BackendCompilerSidecarErrorV1 {
    InvalidRequest,
    RequestLimit,
    InvalidFrame,
    ResponseLimit,
    UnexpectedStderr,
    ExitStatusMismatch,
    InvalidResponse,
    RequestBindingMismatch,
    CompilerAuthorityMismatch,
    SubjectInvalid,
    ReportedFailure(BackendCompilerSidecarFailureCodeV1),
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum BackendCompilerSidecarFailureCodeV1 {
    ArgumentsForbidden,
    IncompleteFrame,
    InvalidFrame,
    InvalidRequest,
    InvalidUtf8,
    InspectionFailed,
    PlanRejected,
    RequestLimit,
    ResponseLimit,
}

impl BackendCompilerSidecarFailureCodeV1 {
    const fn carries_validated_nonce(self) -> bool {
        matches!(
            self,
            Self::InspectionFailed | Self::PlanRejected | Self::ResponseLimit
        )
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WireRequestV1 {
    version: u8,
    request_nonce: String,
    target: String,
    application: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RequestDigestPayloadV1<'a> {
    version: u8,
    target: &'a str,
    application: &'a Value,
}

/// Host-owned request material. It contains no Provider selection, mode, SQL, credential, or
/// execution field and is never accepted from the renderer by this module.
struct CompilerBackfillRequestV1 {
    request: WireRequestV1,
    canonical_frame: Vec<u8>,
    request_digest: String,
    application_id: String,
    application_digest: String,
}

impl CompilerBackfillRequestV1 {
    fn from_canonical_application(
        target: CompilerBackfillTargetV1,
        nonce: [u8; 32],
        canonical_application: &[u8],
    ) -> Result<Self, BackendCompilerSidecarErrorV1> {
        let application = parse_canonical_json(
            canonical_application,
            MAXIMUM_REQUEST_BYTES,
            BackendCompilerSidecarErrorV1::InvalidRequest,
        )?;
        let application_object = application
            .as_object()
            .ok_or(BackendCompilerSidecarErrorV1::InvalidRequest)?;
        if application_object.get("format").and_then(Value::as_str)
            != Some("openpencil.backend-application")
            || application_object.get("version").and_then(Value::as_u64) != Some(2)
        {
            return Err(BackendCompilerSidecarErrorV1::InvalidRequest);
        }
        let application_id = application_object
            .get("applicationId")
            .and_then(Value::as_str)
            .filter(|value| valid_stable_id(value))
            .ok_or(BackendCompilerSidecarErrorV1::InvalidRequest)?
            .to_owned();
        let request_nonce = URL_SAFE_NO_PAD.encode(nonce);
        decode_digest(&request_nonce).map_err(|_| BackendCompilerSidecarErrorV1::InvalidRequest)?;
        let target_text = target.as_str();
        let application_digest = digest_bytes(canonical_application);
        let request = WireRequestV1 {
            version: REQUEST_VERSION,
            request_nonce,
            target: target_text.to_owned(),
            application,
        };
        let canonical_frame = canonical_bytes(&request, MAXIMUM_REQUEST_BYTES)
            .map_err(|_| BackendCompilerSidecarErrorV1::RequestLimit)?;
        let digest_payload = RequestDigestPayloadV1 {
            version: request.version,
            target: target_text,
            application: &request.application,
        };
        let digest_bytes = canonical_bytes(&digest_payload, MAXIMUM_REQUEST_BYTES)
            .map_err(|_| BackendCompilerSidecarErrorV1::RequestLimit)?;
        let mut hasher = Sha256::new();
        hasher.update(REQUEST_DIGEST_DOMAIN.as_bytes());
        hasher.update([0]);
        hasher.update(digest_bytes);
        let request_digest = URL_SAFE_NO_PAD.encode(hasher.finalize());
        Ok(Self {
            request,
            canonical_frame,
            request_digest,
            application_id,
            application_digest,
        })
    }

    fn canonical_frame_with_lf(&self) -> Vec<u8> {
        let mut framed = Vec::with_capacity(self.canonical_frame.len() + 1);
        framed.extend_from_slice(&self.canonical_frame);
        framed.push(b'\n');
        framed
    }
}

/// Fully checked data that still creates no registry, database, mutation, or Receipt authority.
struct ValidatedCompilerInspectionV1 {
    _envelope: CompilerBackfillInspectionSubjectEnvelopeV1,
    material: BackfillInspectionSubjectMaterialV1,
}

impl ValidatedCompilerInspectionV1 {
    fn material(&self) -> &BackfillInspectionSubjectMaterialV1 {
        &self.material
    }

    fn into_material(self) -> BackfillInspectionSubjectMaterialV1 {
        self.material
    }

    const fn database_authority_created(&self) -> bool {
        false
    }

    const fn mutation_authorized(&self) -> bool {
        false
    }

    const fn execution_authorized(&self) -> bool {
        false
    }

    const fn receipt_authority_created(&self) -> bool {
        false
    }

    const fn release_authorized(&self) -> bool {
        false
    }
}

impl BackendBackfillInspectionSubjectRegistryV1 {
    /// Sole production registry ingress. Module privacy prevents parent siblings from obtaining or
    /// constructing the validated value, and the child runner calls this only after strict decode.
    fn issue_validated_compiler_inspection(
        &self,
        validated: ValidatedCompilerInspectionV1,
    ) -> Result<SealedBackfillInspectionSubjectProofV1, BackendBackfillInspectionSubjectErrorV1>
    {
        let material = validated.into_material();
        let scope_digest = validate_material(&material)?;
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
                registry: std::sync::Arc::downgrade(&self.inner),
                armed: true,
            });
        }
        Err(BackendBackfillInspectionSubjectErrorV1::IdCollision)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProcessSuccessV1 {
    version: u8,
    request_nonce: String,
    ok: bool,
    result: CompilerWireResponseV1,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProcessFailureV1 {
    version: u8,
    request_nonce: NullableNonceV1,
    ok: bool,
    error: ProcessFailureBodyV1,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum NullableNonceV1 {
    Text(String),
    Null(()),
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProcessFailureBodyV1 {
    code: BackendCompilerSidecarFailureCodeV1,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum ProcessResponseV1 {
    Success(ProcessSuccessV1),
    Failure(ProcessFailureV1),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompilerWireResponseV1 {
    version: u8,
    request_nonce: String,
    request_digest: String,
    compiler_build_authority: Value,
    subject_envelope: CompilerBackfillInspectionSubjectEnvelopeV1,
}

fn validate_json_shape(
    value: &Value,
    depth: usize,
    node_count: &mut usize,
) -> Result<(), BackendCompilerSidecarErrorV1> {
    *node_count = node_count
        .checked_add(1)
        .ok_or(BackendCompilerSidecarErrorV1::InvalidFrame)?;
    if *node_count > MAXIMUM_JSON_NODES || depth > MAXIMUM_JSON_DEPTH {
        return Err(BackendCompilerSidecarErrorV1::InvalidFrame);
    }
    match value {
        Value::Array(values) => values
            .iter()
            .try_for_each(|value| validate_json_shape(value, depth + 1, node_count)),
        Value::Object(entries) => entries.iter().try_for_each(|(key, value)| {
            if matches!(key.as_str(), "__proto__" | "constructor" | "prototype") {
                return Err(BackendCompilerSidecarErrorV1::InvalidFrame);
            }
            validate_json_shape(value, depth + 1, node_count)
        }),
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => Ok(()),
    }
}

fn write_canonical_json(
    value: &Value,
    output: &mut String,
    maximum_bytes: usize,
) -> Result<(), BackendCompilerSidecarErrorV1> {
    match value {
        Value::Null => output.push_str("null"),
        Value::Bool(value) => output.push_str(if *value { "true" } else { "false" }),
        Value::Number(value) => output.push_str(
            &ecmascript_number_json(value)
                .map_err(|_| BackendCompilerSidecarErrorV1::InvalidFrame)?,
        ),
        Value::String(value) => output.push_str(
            &serde_json::to_string(value)
                .map_err(|_| BackendCompilerSidecarErrorV1::InvalidFrame)?,
        ),
        Value::Array(values) => {
            output.push('[');
            for (index, value) in values.iter().enumerate() {
                if index > 0 {
                    output.push(',');
                }
                write_canonical_json(value, output, maximum_bytes)?;
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
                        .map_err(|_| BackendCompilerSidecarErrorV1::InvalidFrame)?,
                );
                output.push(':');
                write_canonical_json(value, output, maximum_bytes)?;
            }
            output.push('}');
        }
    }
    if output.len() > maximum_bytes {
        return Err(BackendCompilerSidecarErrorV1::ResponseLimit);
    }
    Ok(())
}

fn canonical_value_bytes(
    value: &Value,
    maximum_bytes: usize,
) -> Result<Vec<u8>, BackendCompilerSidecarErrorV1> {
    let mut nodes = 0;
    validate_json_shape(value, 0, &mut nodes)?;
    let mut output = String::new();
    write_canonical_json(value, &mut output, maximum_bytes)?;
    Ok(output.into_bytes())
}

fn canonical_bytes<T: Serialize>(
    value: &T,
    maximum_bytes: usize,
) -> Result<Vec<u8>, BackendCompilerSidecarErrorV1> {
    let value =
        serde_json::to_value(value).map_err(|_| BackendCompilerSidecarErrorV1::InvalidFrame)?;
    canonical_value_bytes(&value, maximum_bytes)
}

fn parse_canonical_json(
    bytes: &[u8],
    maximum_bytes: usize,
    invalid: BackendCompilerSidecarErrorV1,
) -> Result<Value, BackendCompilerSidecarErrorV1> {
    if bytes.is_empty() || bytes.len() > maximum_bytes {
        return Err(invalid);
    }
    let value: Value = serde_json::from_slice(bytes).map_err(|_| invalid)?;
    let canonical = canonical_value_bytes(&value, maximum_bytes).map_err(|_| invalid)?;
    if canonical != bytes {
        return Err(invalid);
    }
    Ok(value)
}

fn response_payload(frame: &[u8]) -> Result<&[u8], BackendCompilerSidecarErrorV1> {
    if frame.is_empty() || frame.len() > MAXIMUM_OUTPUT_FRAME_BYTES {
        return Err(BackendCompilerSidecarErrorV1::ResponseLimit);
    }
    if frame.last() != Some(&b'\n') {
        return Err(BackendCompilerSidecarErrorV1::InvalidFrame);
    }
    let payload = &frame[..frame.len() - 1];
    if payload.is_empty()
        || payload.len() > MAXIMUM_OUTPUT_PAYLOAD_BYTES
        || payload.iter().any(|byte| matches!(byte, b'\n' | b'\r'))
    {
        return Err(BackendCompilerSidecarErrorV1::InvalidFrame);
    }
    std::str::from_utf8(payload).map_err(|_| BackendCompilerSidecarErrorV1::InvalidFrame)?;
    Ok(payload)
}

fn expected_compiler_authority() -> Result<Value, BackendCompilerSidecarErrorV1> {
    let authority = parse_canonical_json(
        EXPECTED_COMPILER_BUILD_AUTHORITY.as_bytes(),
        MAXIMUM_OUTPUT_PAYLOAD_BYTES,
        BackendCompilerSidecarErrorV1::CompilerAuthorityMismatch,
    )?;
    let trust = authority
        .get("compilerTrustDomain")
        .and_then(Value::as_object)
        .ok_or(BackendCompilerSidecarErrorV1::CompilerAuthorityMismatch)?;
    let domain = trust
        .get("domain")
        .and_then(Value::as_str)
        .ok_or(BackendCompilerSidecarErrorV1::CompilerAuthorityMismatch)?;
    let descriptor = trust
        .get("descriptor")
        .ok_or(BackendCompilerSidecarErrorV1::CompilerAuthorityMismatch)?;
    let descriptor = canonical_value_bytes(descriptor, MAXIMUM_OUTPUT_PAYLOAD_BYTES)
        .map_err(|_| BackendCompilerSidecarErrorV1::CompilerAuthorityMismatch)?;
    let mut hasher = Sha256::new();
    hasher.update(domain.as_bytes());
    hasher.update([0]);
    hasher.update(descriptor);
    if trust.get("digest").and_then(Value::as_str) != Some(COMPILER_TRUST_DIGEST)
        || URL_SAFE_NO_PAD.encode(hasher.finalize()) != COMPILER_TRUST_DIGEST
    {
        return Err(BackendCompilerSidecarErrorV1::CompilerAuthorityMismatch);
    }
    Ok(authority)
}

fn decode_compiler_sidecar_response(
    request: &CompilerBackfillRequestV1,
    exit_code: i32,
    stdout_frame: &[u8],
    stderr: &[u8],
) -> Result<ValidatedCompilerInspectionV1, BackendCompilerSidecarErrorV1> {
    if stderr.len() > MAXIMUM_STDERR_BYTES {
        return Err(BackendCompilerSidecarErrorV1::ResponseLimit);
    }
    if !stderr.is_empty() {
        return Err(BackendCompilerSidecarErrorV1::UnexpectedStderr);
    }
    let payload = response_payload(stdout_frame)?;
    let value = parse_canonical_json(
        payload,
        MAXIMUM_OUTPUT_PAYLOAD_BYTES,
        BackendCompilerSidecarErrorV1::InvalidResponse,
    )?;
    let response: ProcessResponseV1 = serde_json::from_value(value)
        .map_err(|_| BackendCompilerSidecarErrorV1::InvalidResponse)?;
    match response {
        ProcessResponseV1::Failure(failure) => {
            if exit_code != 1 || failure.version != REQUEST_VERSION || failure.ok {
                return Err(BackendCompilerSidecarErrorV1::ExitStatusMismatch);
            }
            match (
                failure.error.code.carries_validated_nonce(),
                failure.request_nonce,
            ) {
                (true, NullableNonceV1::Text(nonce)) if nonce == request.request.request_nonce => {}
                (false, NullableNonceV1::Null(())) => {}
                _ => return Err(BackendCompilerSidecarErrorV1::RequestBindingMismatch),
            }
            Err(BackendCompilerSidecarErrorV1::ReportedFailure(
                failure.error.code,
            ))
        }
        ProcessResponseV1::Success(success) => {
            if exit_code != 0 || success.version != REQUEST_VERSION || !success.ok {
                return Err(BackendCompilerSidecarErrorV1::ExitStatusMismatch);
            }
            let result = success.result;
            if success.request_nonce != request.request.request_nonce
                || result.version != REQUEST_VERSION
                || result.request_nonce != request.request.request_nonce
                || result.request_digest != request.request_digest
            {
                return Err(BackendCompilerSidecarErrorV1::RequestBindingMismatch);
            }
            if result.compiler_build_authority != expected_compiler_authority()? {
                return Err(BackendCompilerSidecarErrorV1::CompilerAuthorityMismatch);
            }
            let subject = &result.subject_envelope.subject;
            if subject.provider_authority.package_digest != COMPILER_SELECTION_PACKAGE_DIGEST
                || subject.provider_authority.digest != COMPILER_PROVIDER_AUTHORITY_DIGEST
                || subject.application.id != request.application_id
                || subject.application.digest != request.application_digest
                || subject.plan.target != request.request.target
                || subject.plan.mode != "production"
            {
                return Err(BackendCompilerSidecarErrorV1::RequestBindingMismatch);
            }
            let material = validate_and_project(&result.subject_envelope)
                .map_err(|_| BackendCompilerSidecarErrorV1::SubjectInvalid)?;
            Ok(ValidatedCompilerInspectionV1 {
                _envelope: result.subject_envelope,
                material,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &[u8] = include_bytes!(
        "../../../tests/fixtures/backend/supabase/backfill-compiler-sidecar-v1.json"
    );

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct FixtureV1 {
        fixture_format: String,
        fixture_version: u8,
        request: Value,
        request_digest: String,
        response: Value,
    }

    fn fixture() -> FixtureV1 {
        serde_json::from_slice(FIXTURE).unwrap()
    }

    fn request(fixture: &FixtureV1) -> CompilerBackfillRequestV1 {
        let application = fixture.request.get("application").unwrap();
        let application = canonical_value_bytes(application, MAXIMUM_REQUEST_BYTES).unwrap();
        CompilerBackfillRequestV1::from_canonical_application(
            CompilerBackfillTargetV1::React,
            [0; 32],
            &application,
        )
        .unwrap()
    }

    fn response_frame(fixture: &FixtureV1) -> Vec<u8> {
        let mut response =
            canonical_value_bytes(&fixture.response, MAXIMUM_OUTPUT_PAYLOAD_BYTES).unwrap();
        response.push(b'\n');
        response
    }

    fn mutated_response(fixture: &FixtureV1, mutate: impl FnOnce(&mut Value)) -> Vec<u8> {
        let mut response = fixture.response.clone();
        mutate(&mut response);
        let mut bytes = canonical_value_bytes(&response, MAXIMUM_OUTPUT_PAYLOAD_BYTES).unwrap();
        bytes.push(b'\n');
        bytes
    }

    fn result_mut(value: &mut Value) -> &mut serde_json::Map<String, Value> {
        value
            .get_mut("result")
            .and_then(Value::as_object_mut)
            .unwrap()
    }

    fn subject_mut(value: &mut Value) -> &mut serde_json::Map<String, Value> {
        result_mut(value)
            .get_mut("subjectEnvelope")
            .and_then(Value::as_object_mut)
            .unwrap()
            .get_mut("subject")
            .and_then(Value::as_object_mut)
            .unwrap()
    }

    #[test]
    fn typescript_golden_binds_request_digest_and_complete_success_response() {
        let fixture = fixture();
        assert_eq!(
            fixture.fixture_format,
            "openpencil.test.backend.supabase.backfill-compiler-sidecar.v1"
        );
        assert_eq!(fixture.fixture_version, 1);
        let request = request(&fixture);
        assert_eq!(request.request_digest, fixture.request_digest);
        assert_eq!(
            request.canonical_frame,
            canonical_value_bytes(&fixture.request, MAXIMUM_REQUEST_BYTES).unwrap()
        );
        assert_eq!(request.canonical_frame_with_lf().last(), Some(&b'\n'));

        let validated =
            decode_compiler_sidecar_response(&request, 0, &response_frame(&fixture), b"").unwrap();
        let material = validated.material();
        assert_eq!(material.provider_id, "supabase");
        assert_eq!(material.application_id, "test.supabase-receipt-backfill");
        assert_eq!(material.migration_id, "backfill-account-status");
        assert_eq!(
            material.inspection_subject_digest,
            "-8lwTIjIKmRHkOe-mkvtpfWOXr8xKQ-EU9mLESbQU7A"
        );
        assert!(!validated.database_authority_created());
        assert!(!validated.mutation_authorized());
        assert!(!validated.execution_authorized());
        assert!(!validated.receipt_authority_created());
        assert!(!validated.release_authorized());
    }

    #[test]
    fn request_digest_excludes_nonce_but_binds_target_and_application() {
        let fixture = fixture();
        let base = request(&fixture);
        let application = fixture.request.get("application").unwrap();
        let application = canonical_value_bytes(application, MAXIMUM_REQUEST_BYTES).unwrap();
        let other_nonce = CompilerBackfillRequestV1::from_canonical_application(
            CompilerBackfillTargetV1::React,
            [7; 32],
            &application,
        )
        .unwrap();
        let vue = CompilerBackfillRequestV1::from_canonical_application(
            CompilerBackfillTargetV1::Vue,
            [0; 32],
            &application,
        )
        .unwrap();
        assert_eq!(base.request_digest, other_nonce.request_digest);
        assert_ne!(
            base.request.request_nonce,
            other_nonce.request.request_nonce
        );
        assert_ne!(base.request_digest, vue.request_digest);

        let mut changed: Value = serde_json::from_slice(&application).unwrap();
        changed["applicationId"] = Value::String("test.changed".to_owned());
        let changed = canonical_value_bytes(&changed, MAXIMUM_REQUEST_BYTES).unwrap();
        let changed = CompilerBackfillRequestV1::from_canonical_application(
            CompilerBackfillTargetV1::React,
            [0; 32],
            &changed,
        )
        .unwrap();
        assert_ne!(base.request_digest, changed.request_digest);
    }

    #[test]
    fn rejects_noncanonical_request_data_unsafe_keys_and_limits() {
        let fixture = fixture();
        let application = fixture.request.get("application").unwrap();
        let pretty = serde_json::to_vec_pretty(application).unwrap();
        assert_eq!(
            CompilerBackfillRequestV1::from_canonical_application(
                CompilerBackfillTargetV1::React,
                [0; 32],
                &pretty,
            )
            .err()
            .unwrap(),
            BackendCompilerSidecarErrorV1::InvalidRequest
        );
        for invalid in [
            br#"{"__proto__":{},"applicationId":"x","format":"openpencil.backend-application","version":2}"#.as_slice(),
            br#"[]"#.as_slice(),
            br#"{"applicationId":"x","format":"wrong","version":2}"#.as_slice(),
        ] {
            assert_eq!(
                CompilerBackfillRequestV1::from_canonical_application(
                    CompilerBackfillTargetV1::React,
                    [0; 32],
                    invalid,
                )
                .err()
                .unwrap(),
                BackendCompilerSidecarErrorV1::InvalidRequest
            );
        }
        let oversized = vec![b'x'; MAXIMUM_REQUEST_BYTES + 1];
        assert_eq!(
            CompilerBackfillRequestV1::from_canonical_application(
                CompilerBackfillTargetV1::React,
                [0; 32],
                &oversized,
            )
            .err()
            .unwrap(),
            BackendCompilerSidecarErrorV1::InvalidRequest
        );
    }

    #[test]
    fn rejects_frame_status_stderr_and_protocol_shape_mismatch() {
        let fixture = fixture();
        let request = request(&fixture);
        let frame = response_frame(&fixture);
        assert_eq!(
            decode_compiler_sidecar_response(&request, 1, &frame, b"")
                .err()
                .unwrap(),
            BackendCompilerSidecarErrorV1::ExitStatusMismatch
        );
        assert_eq!(
            decode_compiler_sidecar_response(&request, 0, &frame, b"diagnostic")
                .err()
                .unwrap(),
            BackendCompilerSidecarErrorV1::UnexpectedStderr
        );
        assert_eq!(
            decode_compiler_sidecar_response(&request, 0, &frame[..frame.len() - 1], b"")
                .err()
                .unwrap(),
            BackendCompilerSidecarErrorV1::InvalidFrame
        );
        let mut crlf = frame[..frame.len() - 1].to_vec();
        crlf.extend_from_slice(b"\r\n");
        assert_eq!(
            decode_compiler_sidecar_response(&request, 0, &crlf, b"")
                .err()
                .unwrap(),
            BackendCompilerSidecarErrorV1::InvalidFrame
        );
        let extra = mutated_response(&fixture, |value| {
            value["extra"] = Value::Bool(true);
        });
        assert_eq!(
            decode_compiler_sidecar_response(&request, 0, &extra, b"")
                .err()
                .unwrap(),
            BackendCompilerSidecarErrorV1::InvalidResponse
        );
    }

    #[test]
    fn rejects_nonce_digest_compiler_and_provider_authority_tamper() {
        let fixture = fixture();
        let request = request(&fixture);
        let cases = [
            mutated_response(&fixture, |value| {
                value["requestNonce"] = Value::String("B".repeat(43));
            }),
            mutated_response(&fixture, |value| {
                result_mut(value)["requestDigest"] = Value::String("B".repeat(43));
            }),
            mutated_response(&fixture, |value| {
                result_mut(value)["compilerBuildAuthority"]["compilerTrustDomain"]["digest"] =
                    Value::String("B".repeat(43));
            }),
            mutated_response(&fixture, |value| {
                subject_mut(value)["providerAuthority"]["packageDigest"] =
                    Value::String("sha256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB".to_owned());
            }),
            mutated_response(&fixture, |value| {
                subject_mut(value)["providerAuthority"]["digest"] = Value::String("B".repeat(43));
            }),
        ];
        for frame in cases {
            assert!(matches!(
                decode_compiler_sidecar_response(&request, 0, &frame, b""),
                Err(BackendCompilerSidecarErrorV1::RequestBindingMismatch)
                    | Err(BackendCompilerSidecarErrorV1::CompilerAuthorityMismatch)
            ));
        }
    }

    #[test]
    fn rejects_null_nested_subjects_unknown_fields_and_secret_like_material() {
        let fixture = fixture();
        let request = request(&fixture);
        let cases = [
            mutated_response(&fixture, |value| {
                subject_mut(value)["migration"] = Value::Null;
            }),
            mutated_response(&fixture, |value| {
                subject_mut(value)["emission"] = Value::Null;
            }),
            mutated_response(&fixture, |value| {
                subject_mut(value).insert("unknown".to_owned(), Value::Bool(true));
            }),
            mutated_response(&fixture, |value| {
                subject_mut(value)
                    .get_mut("migration")
                    .and_then(Value::as_object_mut)
                    .unwrap()
                    .get_mut("target")
                    .and_then(Value::as_object_mut)
                    .unwrap()
                    .insert(
                        "expectedLiteral".to_owned(),
                        Value::String("sb_secret_must_never_cross".to_owned()),
                    );
                let subject = result_mut(value)["subjectEnvelope"]["subject"].clone();
                let digest = digest_bytes(
                    &canonical_value_bytes(&subject, MAXIMUM_OUTPUT_PAYLOAD_BYTES).unwrap(),
                );
                result_mut(value)["subjectEnvelope"]["subjectDigest"] = Value::String(digest);
            }),
        ];
        for frame in cases {
            assert!(matches!(
                decode_compiler_sidecar_response(&request, 0, &frame, b""),
                Err(BackendCompilerSidecarErrorV1::InvalidResponse)
                    | Err(BackendCompilerSidecarErrorV1::SubjectInvalid)
            ));
        }
    }

    #[test]
    fn accepts_only_static_failure_contracts_with_matching_exit_and_nonce_policy() {
        let fixture = fixture();
        let request = request(&fixture);
        let null_nonce =
            b"{\"error\":{\"code\":\"invalid-request\"},\"ok\":false,\"requestNonce\":null,\"version\":1}\n";
        assert_eq!(
            decode_compiler_sidecar_response(&request, 1, null_nonce, b"")
                .err()
                .unwrap(),
            BackendCompilerSidecarErrorV1::ReportedFailure(
                BackendCompilerSidecarFailureCodeV1::InvalidRequest
            )
        );
        let bound = format!(
            "{{\"error\":{{\"code\":\"plan-rejected\"}},\"ok\":false,\"requestNonce\":\"{}\",\"version\":1}}\n",
            request.request.request_nonce
        );
        assert_eq!(
            decode_compiler_sidecar_response(&request, 1, bound.as_bytes(), b"")
                .err()
                .unwrap(),
            BackendCompilerSidecarErrorV1::ReportedFailure(
                BackendCompilerSidecarFailureCodeV1::PlanRejected
            )
        );
        let unknown =
            b"{\"error\":{\"code\":\"internal-detail\"},\"ok\":false,\"requestNonce\":null,\"version\":1}\n";
        assert_eq!(
            decode_compiler_sidecar_response(&request, 1, unknown, b"")
                .err()
                .unwrap(),
            BackendCompilerSidecarErrorV1::InvalidResponse
        );
    }

    #[test]
    fn canonical_codec_keeps_ecmascript_float_boundaries_and_separate_limits() {
        let value = serde_json::json!({"large": 1e21, "small": 1e-7, "fixed": 1e-6});
        assert_eq!(
            std::str::from_utf8(&canonical_value_bytes(&value, 1_024).unwrap()).unwrap(),
            r#"{"fixed":0.000001,"large":1e+21,"small":1e-7}"#
        );
        let utf16_order = serde_json::json!({"\u{e000}": 2, "😀": 1});
        assert_eq!(
            std::str::from_utf8(&canonical_value_bytes(&utf16_order, 1_024).unwrap()).unwrap(),
            "{\"😀\":1,\"\u{e000}\":2}"
        );
        assert_eq!(
            parse_canonical_json(
                br#"{"value":"\ud800"}"#,
                1_024,
                BackendCompilerSidecarErrorV1::InvalidRequest,
            )
            .err()
            .unwrap(),
            BackendCompilerSidecarErrorV1::InvalidRequest
        );
        let request_limit = vec![b'x'; MAXIMUM_REQUEST_BYTES + 1];
        assert_eq!(
            parse_canonical_json(
                &request_limit,
                MAXIMUM_REQUEST_BYTES,
                BackendCompilerSidecarErrorV1::RequestLimit,
            )
            .err()
            .unwrap(),
            BackendCompilerSidecarErrorV1::RequestLimit
        );
        let response_limit = vec![b'x'; MAXIMUM_OUTPUT_FRAME_BYTES + 1];
        assert_eq!(
            response_payload(&response_limit).err().unwrap(),
            BackendCompilerSidecarErrorV1::ResponseLimit
        );
    }
}
