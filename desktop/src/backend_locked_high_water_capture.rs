//! Dormant native provenance for one Supabase locked high-water capture.
//!
//! This private, production-compiled module owns only an opaque process-local registry and strict,
//! secret-free capture material. Production has no issuer: only tests may populate the registry
//! until a separately reviewed native SERIALIZABLE locked-read transport can supply the exact Host
//! observation. The proof grants no database, mutation, execution, Receipt, retry, or release
//! authority.

#![allow(dead_code)]

use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Mutex, Weak},
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ring::rand::{SecureRandom, SystemRandom};

use crate::supabase_backfill_fixed_read::contains_secret_like_material;

const CAPTURE_HANDLE_TTL: Duration = Duration::from_secs(30);
const MAXIMUM_LIVE_CAPTURE_ENTRIES: usize = 32;
const CAPTURE_ID_ATTEMPTS: usize = 8;
const CAPTURE_ID_BYTES: usize = 32;
const MAXIMUM_BATCH_SIZE: u32 = 1_000;
const MAXIMUM_BATCH_RECEIPT_COUNT: u64 = 9_999;
const MAXIMUM_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

/// Secret-free values retained from one exact Host observation. These values are data only: no
/// caller can create a sealed proof from this struct in a production build.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct LockedHighWaterCaptureMaterialV1 {
    pub(crate) provider_id: String,
    pub(crate) environment: String,
    pub(crate) project_ref: String,
    pub(crate) account_id: String,
    pub(crate) source_grant_generation: String,
    pub(crate) read_grant_generation: String,
    pub(crate) install_write_grant_generation: String,
    pub(crate) capture_write_grant_generation: String,
    pub(crate) provider_authority_digest: String,
    pub(crate) application_id: String,
    pub(crate) application_digest: String,
    pub(crate) migration_id: String,
    pub(crate) migration_digest: String,
    pub(crate) migration_plan_digest: String,
    pub(crate) source_ledger_digest: String,
    pub(crate) source_scope_digest: String,
    pub(crate) schema_digest: String,
    pub(crate) source_ledger_subject_digest: String,
    pub(crate) inspection_subject_digest: String,
    pub(crate) attestation_digest: String,
    pub(crate) source_review_digest: String,
    pub(crate) install_plan_digest: String,
    pub(crate) install_review_digest: String,
    pub(crate) marker_binding_digest: String,
    pub(crate) installed_verification_digest: String,
    pub(crate) capture_review_digest: String,
    pub(crate) catalog_precondition_digest: String,
    pub(crate) query_digest: String,
    pub(crate) capture_digest: String,
    pub(crate) schema_name: String,
    pub(crate) schema_oid: String,
    pub(crate) table_name: String,
    pub(crate) table_oid: String,
    pub(crate) cursor_field: String,
    pub(crate) cursor_sub_id: u16,
    pub(crate) cursor_type_oid: String,
    pub(crate) target_field: String,
    pub(crate) target_sub_id: u16,
    pub(crate) target_type_oid: String,
    pub(crate) primary_key_oid: String,
    pub(crate) sequence_oid: String,
    pub(crate) barrier_constraint_oid: String,
    pub(crate) statement_count: u8,
    pub(crate) access_mode: String,
    pub(crate) snapshot_scope: String,
    pub(crate) lock_mode: String,
    pub(crate) transaction_isolation: String,
    pub(crate) transaction_read_only: bool,
    pub(crate) row_security: bool,
    pub(crate) search_path: String,
    pub(crate) database_primary: bool,
    pub(crate) maximum_cursor: u64,
    pub(crate) captured_high_water: Option<u64>,
    pub(crate) minimum_cursor: Option<u64>,
    pub(crate) total_row_count: u64,
    pub(crate) remaining_null_target_row_count: u64,
    pub(crate) unsafe_cursor_row_count: u64,
    pub(crate) batch_size: u32,
    pub(crate) required_batch_receipt_count: u64,
    pub(crate) maximum_batch_receipt_count: u64,
    pub(crate) observed_at: String,
    pub(crate) snapshot_marker: String,
    pub(crate) server_version_num: String,
    pub(crate) query_bindings_match: bool,
    pub(crate) current_and_session_role_match: bool,
    pub(crate) full_table_read_authority_observed: bool,
    pub(crate) exact_address_matches: bool,
    pub(crate) cursor_range_safe: bool,
    pub(crate) receipt_capacity_fits: bool,
    pub(crate) all_capture_checks_passed: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum LockedHighWaterCaptureErrorV1 {
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

struct ActiveCaptureV1 {
    issuer_id: [u8; CAPTURE_ID_BYTES],
    generation: u64,
    scope_digest: [u8; 32],
    material: LockedHighWaterCaptureMaterialV1,
    expires_at_monotonic_ns: u128,
}

struct BurnedCaptureV1 {
    id: [u8; CAPTURE_ID_BYTES],
    scope_digest: [u8; 32],
    expires_at_monotonic_ns: u128,
}

#[derive(Default)]
struct CaptureRegistryStateV1 {
    active: HashMap<[u8; CAPTURE_ID_BYTES], ActiveCaptureV1>,
    burned: VecDeque<BurnedCaptureV1>,
    last_monotonic_ns: Option<u128>,
    next_generation: u64,
}

impl CaptureRegistryStateV1 {
    fn observe_clock(&mut self, now: u128) -> Result<(), LockedHighWaterCaptureErrorV1> {
        if self.last_monotonic_ns.is_some_and(|last| now < last) {
            return Err(LockedHighWaterCaptureErrorV1::ClockUnavailable);
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

    fn contains_id(&self, id: &[u8; CAPTURE_ID_BYTES]) -> bool {
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

    fn burn(&mut self, id: [u8; CAPTURE_ID_BYTES], entry: ActiveCaptureV1, now: u128) {
        if entry.expires_at_monotonic_ns > now {
            self.burned.push_back(BurnedCaptureV1 {
                id,
                scope_digest: entry.scope_digest,
                expires_at_monotonic_ns: entry.expires_at_monotonic_ns,
            });
        }
    }
}

trait CaptureClockV1: Send + Sync {
    fn monotonic_ns(&self) -> Result<u128, LockedHighWaterCaptureErrorV1>;
}

struct SystemCaptureClockV1 {
    origin: Instant,
}

impl SystemCaptureClockV1 {
    fn new() -> Self {
        Self {
            origin: Instant::now(),
        }
    }
}

impl CaptureClockV1 for SystemCaptureClockV1 {
    fn monotonic_ns(&self) -> Result<u128, LockedHighWaterCaptureErrorV1> {
        Ok(self.origin.elapsed().as_nanos())
    }
}

trait CaptureEntropyV1: Send + Sync {
    fn fill(&self, output: &mut [u8]) -> Result<(), LockedHighWaterCaptureErrorV1>;
}

struct SystemCaptureEntropyV1(SystemRandom);

impl SystemCaptureEntropyV1 {
    fn new() -> Self {
        Self(SystemRandom::new())
    }
}

impl CaptureEntropyV1 for SystemCaptureEntropyV1 {
    fn fill(&self, output: &mut [u8]) -> Result<(), LockedHighWaterCaptureErrorV1> {
        self.0
            .fill(output)
            .map_err(|_| LockedHighWaterCaptureErrorV1::EntropyUnavailable)
    }
}

struct CaptureRegistryInnerV1 {
    issuer_id: [u8; CAPTURE_ID_BYTES],
    clock: Arc<dyn CaptureClockV1>,
    entropy: Arc<dyn CaptureEntropyV1>,
    maximum_entries: usize,
    ttl: Duration,
    state: Mutex<CaptureRegistryStateV1>,
    #[cfg(test)]
    before_state_lock: Mutex<Option<Arc<std::sync::Barrier>>>,
}

/// Private production-facing registry. Its production constructor creates an empty consumer seam;
/// there is deliberately no production method that can insert an observation.
pub(crate) struct LockedHighWaterCaptureRegistryV1 {
    inner: Arc<CaptureRegistryInnerV1>,
}

impl LockedHighWaterCaptureRegistryV1 {
    pub(crate) fn new_dormant_production() -> Result<Self, LockedHighWaterCaptureErrorV1> {
        Self::with_dependencies(
            MAXIMUM_LIVE_CAPTURE_ENTRIES,
            CAPTURE_HANDLE_TTL,
            Arc::new(SystemCaptureClockV1::new()),
            Arc::new(SystemCaptureEntropyV1::new()),
        )
    }

    fn with_dependencies(
        maximum_entries: usize,
        ttl: Duration,
        clock: Arc<dyn CaptureClockV1>,
        entropy: Arc<dyn CaptureEntropyV1>,
    ) -> Result<Self, LockedHighWaterCaptureErrorV1> {
        if maximum_entries == 0 || maximum_entries > MAXIMUM_LIVE_CAPTURE_ENTRIES || ttl.is_zero() {
            return Err(LockedHighWaterCaptureErrorV1::RegistryUnavailable);
        }
        let mut issuer_id = [0_u8; CAPTURE_ID_BYTES];
        entropy.fill(&mut issuer_id)?;
        if issuer_id == [0; CAPTURE_ID_BYTES] {
            return Err(LockedHighWaterCaptureErrorV1::EntropyUnavailable);
        }
        Ok(Self {
            inner: Arc::new(CaptureRegistryInnerV1 {
                issuer_id,
                clock,
                entropy,
                maximum_entries,
                ttl,
                state: Mutex::new(CaptureRegistryStateV1::default()),
                #[cfg(test)]
                before_state_lock: Mutex::new(None),
            }),
        })
    }

    /// Read-only composition check. It neither consumes the proof nor extends its TTL. A future
    /// durable initializer must consume the proof again immediately beside its precommit boundary.
    pub(crate) fn inspect_for_composition(
        &self,
        proof: &SealedLockedHighWaterCaptureProofV1,
    ) -> Result<LockedHighWaterCaptureMaterialV1, LockedHighWaterCaptureErrorV1> {
        let proof_registry = proof
            .registry
            .upgrade()
            .ok_or(LockedHighWaterCaptureErrorV1::HandleInvalid)?;
        if !Arc::ptr_eq(&proof_registry, &self.inner) {
            return Err(LockedHighWaterCaptureErrorV1::HandleInvalid);
        }
        #[cfg(test)]
        self.wait_before_state_lock_for_test()?;
        let mut state = self
            .inner
            .state
            .lock()
            .map_err(|_| LockedHighWaterCaptureErrorV1::RegistryUnavailable)?;
        let now = self.inner.clock.monotonic_ns()?;
        state.observe_clock(now)?;
        let Some(entry) = state.active.get(&proof.id) else {
            state.purge_expired(now);
            return Err(LockedHighWaterCaptureErrorV1::HandleInvalid);
        };
        if entry.issuer_id != proof.issuer_id
            || proof.issuer_id != self.inner.issuer_id
            || entry.generation != proof.generation
        {
            return Err(LockedHighWaterCaptureErrorV1::HandleInvalid);
        }
        if entry.expires_at_monotonic_ns <= now {
            state.active.remove(&proof.id);
            state.purge_expired(now);
            return Err(LockedHighWaterCaptureErrorV1::HandleExpired);
        }
        let scope_digest = entry.scope_digest;
        let material = entry.material.clone();
        state.purge_expired(now);
        if validate_capture_material(&material)? != scope_digest {
            return Err(LockedHighWaterCaptureErrorV1::InvalidMaterial);
        }
        Ok(material)
    }

    /// Test-only stand-in for the future trusted native locked-read result decoder. Renderer JSON,
    /// digests, and public TypeScript capture objects cannot reach this insertion path in production.
    #[cfg(test)]
    pub(crate) fn issue_for_test(
        &self,
        material: LockedHighWaterCaptureMaterialV1,
    ) -> Result<SealedLockedHighWaterCaptureProofV1, LockedHighWaterCaptureErrorV1> {
        let scope_digest = validate_capture_material(&material)?;
        self.wait_before_state_lock_for_test()?;
        let mut state = self
            .inner
            .state
            .lock()
            .map_err(|_| LockedHighWaterCaptureErrorV1::RegistryUnavailable)?;
        // The TTL begins only after this operation owns the registry lock.
        let now = self.inner.clock.monotonic_ns()?;
        state.observe_clock(now)?;
        state.purge_expired(now);
        if state.contains_scope(&scope_digest) {
            return Err(LockedHighWaterCaptureErrorV1::ScopeAlreadyActive);
        }
        if state.len() >= self.inner.maximum_entries {
            return Err(LockedHighWaterCaptureErrorV1::RegistryFull);
        }
        let expires_at_monotonic_ns = now
            .checked_add(self.inner.ttl.as_nanos())
            .ok_or(LockedHighWaterCaptureErrorV1::ClockUnavailable)?;
        let generation = state
            .next_generation
            .checked_add(1)
            .ok_or(LockedHighWaterCaptureErrorV1::RegistryFull)?;
        for _ in 0..CAPTURE_ID_ATTEMPTS {
            let mut id = [0_u8; CAPTURE_ID_BYTES];
            self.inner.entropy.fill(&mut id)?;
            if id == [0; CAPTURE_ID_BYTES] || state.contains_id(&id) {
                continue;
            }
            state.next_generation = generation;
            state.active.insert(
                id,
                ActiveCaptureV1 {
                    issuer_id: self.inner.issuer_id,
                    generation,
                    scope_digest,
                    material,
                    expires_at_monotonic_ns,
                },
            );
            return Ok(SealedLockedHighWaterCaptureProofV1 {
                id,
                issuer_id: self.inner.issuer_id,
                generation,
                registry: Arc::downgrade(&self.inner),
                armed: true,
            });
        }
        Err(LockedHighWaterCaptureErrorV1::IdCollision)
    }

    #[cfg(test)]
    fn set_before_state_lock_for_test(
        &self,
        barrier: Arc<std::sync::Barrier>,
    ) -> Result<(), LockedHighWaterCaptureErrorV1> {
        let mut hook = self
            .inner
            .before_state_lock
            .lock()
            .map_err(|_| LockedHighWaterCaptureErrorV1::RegistryUnavailable)?;
        if hook.is_some() {
            return Err(LockedHighWaterCaptureErrorV1::RegistryUnavailable);
        }
        *hook = Some(barrier);
        Ok(())
    }

    #[cfg(test)]
    fn wait_before_state_lock_for_test(&self) -> Result<(), LockedHighWaterCaptureErrorV1> {
        let barrier = self
            .inner
            .before_state_lock
            .lock()
            .map_err(|_| LockedHighWaterCaptureErrorV1::RegistryUnavailable)?
            .take();
        if let Some(barrier) = barrier {
            barrier.wait();
        }
        Ok(())
    }
}

/// Opaque Host proof. It deliberately implements neither Clone, Debug, Serialize, nor Deserialize.
pub(crate) struct SealedLockedHighWaterCaptureProofV1 {
    id: [u8; CAPTURE_ID_BYTES],
    issuer_id: [u8; CAPTURE_ID_BYTES],
    generation: u64,
    registry: Weak<CaptureRegistryInnerV1>,
    armed: bool,
}

/// One-shot data handoff reserved for the future durable initializer. It carries no executable
/// authority and deliberately implements neither Clone, Debug, Serialize, nor Deserialize.
pub(crate) struct ConsumedLockedHighWaterCaptureProofV1 {
    material: LockedHighWaterCaptureMaterialV1,
}

impl ConsumedLockedHighWaterCaptureProofV1 {
    pub(crate) fn material_for_composition(&self) -> &LockedHighWaterCaptureMaterialV1 {
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

impl SealedLockedHighWaterCaptureProofV1 {
    /// Burns the registry entry before checking expiry or revalidating the retained material.
    /// Production cannot call this successfully until a trusted native issuer is added.
    pub(crate) fn consume_for_initializer(
        mut self,
    ) -> Result<ConsumedLockedHighWaterCaptureProofV1, LockedHighWaterCaptureErrorV1> {
        let registry = self
            .registry
            .upgrade()
            .ok_or(LockedHighWaterCaptureErrorV1::HandleInvalid)?;
        #[cfg(test)]
        {
            let barrier = registry
                .before_state_lock
                .lock()
                .map_err(|_| LockedHighWaterCaptureErrorV1::RegistryUnavailable)?
                .take();
            if let Some(barrier) = barrier {
                barrier.wait();
            }
        }
        let mut state = registry
            .state
            .lock()
            .map_err(|_| LockedHighWaterCaptureErrorV1::RegistryUnavailable)?;
        // Sample time after the registry lock wait so queued consumption cannot use stale time.
        let now = registry.clock.monotonic_ns()?;
        state.observe_clock(now)?;
        let Some(active) = state.active.get(&self.id) else {
            self.armed = false;
            state.purge_expired(now);
            return Err(LockedHighWaterCaptureErrorV1::HandleInvalid);
        };
        if active.issuer_id != self.issuer_id
            || self.issuer_id != registry.issuer_id
            || active.generation != self.generation
        {
            self.armed = false;
            return Err(LockedHighWaterCaptureErrorV1::HandleInvalid);
        }
        let entry = state
            .active
            .remove(&self.id)
            .ok_or(LockedHighWaterCaptureErrorV1::HandleInvalid)?;
        let expired = entry.expires_at_monotonic_ns <= now;
        let scope_digest = entry.scope_digest;
        let material = entry.material.clone();
        state.burn(self.id, entry, now);
        state.purge_expired(now);
        self.armed = false;
        if expired {
            return Err(LockedHighWaterCaptureErrorV1::HandleExpired);
        }
        if validate_capture_material(&material)? != scope_digest {
            return Err(LockedHighWaterCaptureErrorV1::InvalidMaterial);
        }
        Ok(ConsumedLockedHighWaterCaptureProofV1 { material })
    }
}

impl Drop for SealedLockedHighWaterCaptureProofV1 {
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

fn validate_capture_material(
    material: &LockedHighWaterCaptureMaterialV1,
) -> Result<[u8; 32], LockedHighWaterCaptureErrorV1> {
    if material.provider_id != "supabase"
        || material.environment != "staging"
        || !valid_project_ref(&material.project_ref)
        || !valid_stable_id(&material.account_id)
        || !valid_release_identifier(&material.source_grant_generation)
        || !is_canonical_uuid_v4(&material.read_grant_generation)
        || !is_canonical_uuid_v4(&material.install_write_grant_generation)
        || !is_canonical_uuid_v4(&material.capture_write_grant_generation)
        || material.install_write_grant_generation == material.read_grant_generation
        || material.capture_write_grant_generation == material.read_grant_generation
        || material.source_ledger_subject_digest == material.inspection_subject_digest
        || !valid_stable_id(&material.application_id)
        || !valid_stable_id(&material.migration_id)
    {
        return Err(LockedHighWaterCaptureErrorV1::InvalidMaterial);
    }
    for digest in [
        &material.provider_authority_digest,
        &material.application_digest,
        &material.migration_digest,
        &material.migration_plan_digest,
        &material.source_ledger_digest,
        &material.source_scope_digest,
        &material.schema_digest,
        &material.source_ledger_subject_digest,
        &material.inspection_subject_digest,
        &material.attestation_digest,
        &material.source_review_digest,
        &material.install_plan_digest,
        &material.install_review_digest,
        &material.marker_binding_digest,
        &material.installed_verification_digest,
        &material.capture_review_digest,
        &material.catalog_precondition_digest,
        &material.query_digest,
        &material.capture_digest,
    ] {
        decode_digest(digest)?;
    }
    if material.schema_name != "public"
        || !valid_oid(&material.schema_oid)
        || !valid_stable_id(&material.table_name)
        || !valid_oid(&material.table_oid)
        || !valid_stable_id(&material.cursor_field)
        || material.cursor_sub_id == 0
        || !valid_oid(&material.cursor_type_oid)
        || !valid_stable_id(&material.target_field)
        || material.target_sub_id == 0
        || !valid_oid(&material.target_type_oid)
        || !valid_oid(&material.primary_key_oid)
        || !valid_oid(&material.sequence_oid)
        || !valid_oid(&material.barrier_constraint_oid)
        || material.statement_count != 10
        || material.access_mode != "read-write-locked-read"
        || material.snapshot_scope != "explicit-serializable-transaction"
        || material.lock_mode != "share-row-exclusive"
        || material.transaction_isolation != "serializable"
        || material.transaction_read_only
        || material.row_security
        || material.search_path != "pg_catalog"
        || !material.database_primary
        || !material.query_bindings_match
        || !material.current_and_session_role_match
        || !material.full_table_read_authority_observed
        || !material.exact_address_matches
        || !material.cursor_range_safe
        || !material.receipt_capacity_fits
        || !material.all_capture_checks_passed
        || !valid_timestamp(&material.observed_at)
        || !valid_snapshot_marker(&material.snapshot_marker)
        || !valid_server_version(&material.server_version_num)
    {
        return Err(LockedHighWaterCaptureErrorV1::InvalidMaterial);
    }
    validate_high_water(material)?;
    // Single-flight the signed source-ledger operation, not the caller-shaped capture digest. A
    // second capture candidate for the same source scope therefore cannot coexist under another
    // self-consistent digest.
    decode_digest(&material.source_scope_digest)
}

fn validate_high_water(
    material: &LockedHighWaterCaptureMaterialV1,
) -> Result<(), LockedHighWaterCaptureErrorV1> {
    if material.total_row_count > MAXIMUM_SAFE_INTEGER
        || material.maximum_cursor != MAXIMUM_SAFE_INTEGER
        || material.remaining_null_target_row_count > material.total_row_count
        || material.unsafe_cursor_row_count != 0
        || material.batch_size == 0
        || material.batch_size > MAXIMUM_BATCH_SIZE
        || material.maximum_batch_receipt_count != MAXIMUM_BATCH_RECEIPT_COUNT
        || material.required_batch_receipt_count > material.maximum_batch_receipt_count
    {
        return Err(LockedHighWaterCaptureErrorV1::InvalidMaterial);
    }
    let has_rows = material.total_row_count > 0;
    if has_rows != material.captured_high_water.is_some()
        || has_rows != material.minimum_cursor.is_some()
    {
        return Err(LockedHighWaterCaptureErrorV1::InvalidMaterial);
    }
    if let (Some(high), Some(minimum)) = (material.captured_high_water, material.minimum_cursor) {
        if high > material.maximum_cursor
            || minimum > high
            || high
                .checked_sub(minimum)
                .and_then(|span| span.checked_add(1))
                .is_none_or(|span| material.total_row_count > span)
        {
            return Err(LockedHighWaterCaptureErrorV1::InvalidMaterial);
        }
    }
    let batch_size = u64::from(material.batch_size);
    let expected_batches = if material.total_row_count == 0 {
        0
    } else {
        material
            .total_row_count
            .checked_add(batch_size - 1)
            .ok_or(LockedHighWaterCaptureErrorV1::InvalidMaterial)?
            / batch_size
    };
    if material.required_batch_receipt_count != expected_batches {
        return Err(LockedHighWaterCaptureErrorV1::InvalidMaterial);
    }
    Ok(())
}

fn decode_digest(value: &str) -> Result<[u8; 32], LockedHighWaterCaptureErrorV1> {
    if value.len() != 43 {
        return Err(LockedHighWaterCaptureErrorV1::InvalidMaterial);
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| LockedHighWaterCaptureErrorV1::InvalidMaterial)?;
    if bytes.len() != 32 || URL_SAFE_NO_PAD.encode(&bytes) != value {
        return Err(LockedHighWaterCaptureErrorV1::InvalidMaterial);
    }
    bytes
        .try_into()
        .map_err(|_| LockedHighWaterCaptureErrorV1::InvalidMaterial)
}

fn valid_project_ref(value: &str) -> bool {
    value.len() == 20 && value.bytes().all(|byte| byte.is_ascii_lowercase())
}

fn valid_stable_id(value: &str) -> bool {
    value.len() <= 128
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric() || (index > 0 && matches!(byte, b'.' | b'_' | b':' | b'-'))
        })
        && value
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
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

fn valid_oid(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 10
        && value.bytes().all(|byte| byte.is_ascii_digit())
        && (value == "0" || !value.starts_with('0'))
}

fn valid_timestamp(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 24
        || !bytes.iter().enumerate().all(|(index, byte)| match index {
            4 | 7 => *byte == b'-',
            10 => *byte == b'T',
            13 | 16 => *byte == b':',
            19 => *byte == b'.',
            23 => *byte == b'Z',
            _ => byte.is_ascii_digit(),
        })
    {
        return false;
    }
    let Some(year) = decimal(&bytes[0..4]) else {
        return false;
    };
    let Some(month) = decimal(&bytes[5..7]) else {
        return false;
    };
    let Some(day) = decimal(&bytes[8..10]) else {
        return false;
    };
    let Some(hour) = decimal(&bytes[11..13]) else {
        return false;
    };
    let Some(minute) = decimal(&bytes[14..16]) else {
        return false;
    };
    let Some(second) = decimal(&bytes[17..19]) else {
        return false;
    };
    let Some(millisecond) = decimal(&bytes[20..23]) else {
        return false;
    };
    year > 0
        && (1..=12).contains(&month)
        && day > 0
        && day <= days_in_month(year, month)
        && hour <= 23
        && minute <= 59
        && second <= 59
        && millisecond <= 999
}

fn decimal(bytes: &[u8]) -> Option<u32> {
    bytes.iter().try_fold(0_u32, |value, byte| {
        byte.is_ascii_digit()
            .then(|| value * 10 + u32::from(byte - b'0'))
    })
}

fn days_in_month(year: u32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 400 == 0 || (year % 4 == 0 && year % 100 != 0) => 29,
        2 => 28,
        _ => 0,
    }
}

fn valid_snapshot_marker(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 512
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b':' | b','))
}

fn valid_server_version(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 6
        && matches!(bytes.get(..2), Some(b"15" | b"16" | b"17"))
        && bytes.iter().all(u8::is_ascii_digit)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::{
        sync::{
            atomic::{AtomicU64, Ordering},
            Barrier,
        },
        thread,
    };

    struct ManualClockV1(AtomicU64);

    impl ManualClockV1 {
        fn new() -> Self {
            Self(AtomicU64::new(0))
        }

        fn advance(&self, duration: Duration) {
            self.0
                .fetch_add(duration.as_nanos() as u64, Ordering::SeqCst);
        }

        fn set(&self, value: Duration) {
            self.0.store(value.as_nanos() as u64, Ordering::SeqCst);
        }
    }

    impl CaptureClockV1 for ManualClockV1 {
        fn monotonic_ns(&self) -> Result<u128, LockedHighWaterCaptureErrorV1> {
            Ok(u128::from(self.0.load(Ordering::SeqCst)))
        }
    }

    struct CounterEntropyV1(AtomicU64);

    impl CaptureEntropyV1 for CounterEntropyV1 {
        fn fill(&self, output: &mut [u8]) -> Result<(), LockedHighWaterCaptureErrorV1> {
            output.fill(0);
            let next = self.0.fetch_add(1, Ordering::SeqCst) + 1;
            let suffix = output.len() - 8;
            output[suffix..].copy_from_slice(&next.to_be_bytes());
            Ok(())
        }
    }

    struct ConstantEntropyV1(u8);

    impl CaptureEntropyV1 for ConstantEntropyV1 {
        fn fill(&self, output: &mut [u8]) -> Result<(), LockedHighWaterCaptureErrorV1> {
            output.fill(self.0);
            Ok(())
        }
    }

    struct UnavailableEntropyV1;

    impl CaptureEntropyV1 for UnavailableEntropyV1 {
        fn fill(&self, _output: &mut [u8]) -> Result<(), LockedHighWaterCaptureErrorV1> {
            Err(LockedHighWaterCaptureErrorV1::EntropyUnavailable)
        }
    }

    fn digest(label: &str) -> String {
        URL_SAFE_NO_PAD.encode(Sha256::digest(label.as_bytes()))
    }

    fn material(label: &str) -> LockedHighWaterCaptureMaterialV1 {
        LockedHighWaterCaptureMaterialV1 {
            provider_id: "supabase".to_owned(),
            environment: "staging".to_owned(),
            project_ref: "abcdefghijklmnopqrst".to_owned(),
            account_id: format!("account-{label}"),
            source_grant_generation: "source-ledger-grant-1".to_owned(),
            read_grant_generation: "11111111-1111-4111-8111-111111111111".to_owned(),
            install_write_grant_generation: "22222222-2222-4222-8222-222222222222".to_owned(),
            capture_write_grant_generation: "44444444-4444-4444-8444-444444444444".to_owned(),
            provider_authority_digest: digest(&format!("provider:{label}")),
            application_id: format!("application-{label}"),
            application_digest: digest(&format!("application:{label}")),
            migration_id: format!("migration-{label}"),
            migration_digest: digest(&format!("migration:{label}")),
            migration_plan_digest: digest(&format!("migration-plan:{label}")),
            source_ledger_digest: digest(&format!("source-ledger:{label}")),
            source_scope_digest: digest(&format!("source-scope:{label}")),
            schema_digest: digest(&format!("schema:{label}")),
            source_ledger_subject_digest: digest(&format!("source-ledger-subject:{label}")),
            inspection_subject_digest: digest(&format!("inspection-subject:{label}")),
            attestation_digest: digest(&format!("attestation:{label}")),
            source_review_digest: digest(&format!("source-review:{label}")),
            install_plan_digest: digest(&format!("install-plan:{label}")),
            install_review_digest: digest(&format!("install-review:{label}")),
            marker_binding_digest: digest(&format!("marker:{label}")),
            installed_verification_digest: digest(&format!("installed:{label}")),
            capture_review_digest: digest(&format!("capture-review:{label}")),
            catalog_precondition_digest: digest(&format!("catalog:{label}")),
            query_digest: digest(&format!("query:{label}")),
            capture_digest: digest(&format!("capture:{label}")),
            schema_name: "public".to_owned(),
            schema_oid: "2200".to_owned(),
            table_name: "tasks".to_owned(),
            table_oid: "16384".to_owned(),
            cursor_field: "id".to_owned(),
            cursor_sub_id: 1,
            cursor_type_oid: "20".to_owned(),
            target_field: "normalized_title".to_owned(),
            target_sub_id: 2,
            target_type_oid: "25".to_owned(),
            primary_key_oid: "16385".to_owned(),
            sequence_oid: "16386".to_owned(),
            barrier_constraint_oid: "16387".to_owned(),
            statement_count: 10,
            access_mode: "read-write-locked-read".to_owned(),
            snapshot_scope: "explicit-serializable-transaction".to_owned(),
            lock_mode: "share-row-exclusive".to_owned(),
            transaction_isolation: "serializable".to_owned(),
            transaction_read_only: false,
            row_security: false,
            search_path: "pg_catalog".to_owned(),
            database_primary: true,
            maximum_cursor: MAXIMUM_SAFE_INTEGER,
            captured_high_water: Some(42),
            minimum_cursor: Some(1),
            total_row_count: 42,
            remaining_null_target_row_count: 8,
            unsafe_cursor_row_count: 0,
            batch_size: 25,
            required_batch_receipt_count: 2,
            maximum_batch_receipt_count: MAXIMUM_BATCH_RECEIPT_COUNT,
            observed_at: "2027-01-01T00:00:02.000Z".to_owned(),
            snapshot_marker: "5:8,6:7".to_owned(),
            server_version_num: "150000".to_owned(),
            query_bindings_match: true,
            current_and_session_role_match: true,
            full_table_read_authority_observed: true,
            exact_address_matches: true,
            cursor_range_safe: true,
            receipt_capacity_fits: true,
            all_capture_checks_passed: true,
        }
    }

    fn registry(
        maximum_entries: usize,
        ttl: Duration,
        clock: Arc<ManualClockV1>,
        entropy: Arc<dyn CaptureEntropyV1>,
    ) -> LockedHighWaterCaptureRegistryV1 {
        LockedHighWaterCaptureRegistryV1::with_dependencies(maximum_entries, ttl, clock, entropy)
            .unwrap()
    }

    fn duplicate_handle(
        handle: &SealedLockedHighWaterCaptureProofV1,
    ) -> SealedLockedHighWaterCaptureProofV1 {
        SealedLockedHighWaterCaptureProofV1 {
            id: handle.id,
            issuer_id: handle.issuer_id,
            generation: handle.generation,
            registry: handle.registry.clone(),
            armed: true,
        }
    }

    #[test]
    fn production_registry_is_empty_and_cannot_mint() {
        let registry = LockedHighWaterCaptureRegistryV1::new_dormant_production().unwrap();
        assert_eq!(registry.inner.state.lock().unwrap().len(), 0);
    }

    #[test]
    fn exact_host_material_can_be_inspected_then_consumed_once_without_authority() {
        let clock = Arc::new(ManualClockV1::new());
        let registry = registry(
            4,
            Duration::from_secs(30),
            clock,
            Arc::new(CounterEntropyV1(AtomicU64::new(0))),
        );
        let expected = material("happy");
        let handle = registry.issue_for_test(expected.clone()).unwrap();
        let forged_replay = duplicate_handle(&handle);
        assert!(registry.inspect_for_composition(&handle).unwrap() == expected);
        let consumed = handle.consume_for_initializer().unwrap();
        assert!(consumed.material_for_composition() == &expected);
        assert!(!consumed.database_authority_created());
        assert!(!consumed.mutation_authorized());
        assert!(!consumed.execution_authorized());
        assert!(!consumed.receipt_authority_created());
        assert!(!consumed.automatic_retry_allowed());
        assert!(!consumed.release_authorized());
        assert_eq!(
            forged_replay.consume_for_initializer().err().unwrap(),
            LockedHighWaterCaptureErrorV1::HandleInvalid
        );
    }

    #[test]
    fn foreign_registry_and_drop_burn_fail_closed_until_ttl() {
        let clock = Arc::new(ManualClockV1::new());
        let first = registry(
            1,
            Duration::from_millis(10),
            Arc::clone(&clock),
            Arc::new(CounterEntropyV1(AtomicU64::new(0))),
        );
        let second = registry(
            1,
            Duration::from_millis(10),
            Arc::clone(&clock),
            Arc::new(CounterEntropyV1(AtomicU64::new(100))),
        );
        let value = material("drop");
        let handle = first.issue_for_test(value.clone()).unwrap();
        assert_eq!(
            second.inspect_for_composition(&handle).err().unwrap(),
            LockedHighWaterCaptureErrorV1::HandleInvalid
        );
        drop(handle);
        assert_eq!(
            first.issue_for_test(material("other")).err().unwrap(),
            LockedHighWaterCaptureErrorV1::RegistryFull
        );
        clock.advance(Duration::from_millis(10));
        first.issue_for_test(value).unwrap();
    }

    #[test]
    fn expiry_is_sampled_after_lock_wait_and_burns_before_returning() {
        let clock = Arc::new(ManualClockV1::new());
        let registry = Arc::new(registry(
            4,
            Duration::from_millis(10),
            Arc::clone(&clock),
            Arc::new(CounterEntropyV1(AtomicU64::new(0))),
        ));
        let handle = registry.issue_for_test(material("expiry")).unwrap();
        let barrier = Arc::new(Barrier::new(2));
        registry
            .set_before_state_lock_for_test(Arc::clone(&barrier))
            .unwrap();
        let state_guard = registry.inner.state.lock().unwrap();
        let worker = thread::spawn(move || handle.consume_for_initializer());
        barrier.wait();
        clock.advance(Duration::from_millis(10));
        drop(state_guard);
        assert_eq!(
            worker.join().unwrap().err().unwrap(),
            LockedHighWaterCaptureErrorV1::HandleExpired
        );
        assert!(registry.inner.state.lock().unwrap().active.is_empty());
    }

    #[test]
    fn ttl_begins_after_issue_owns_the_registry_lock() {
        let clock = Arc::new(ManualClockV1::new());
        let registry = Arc::new(registry(
            4,
            Duration::from_millis(10),
            Arc::clone(&clock),
            Arc::new(CounterEntropyV1(AtomicU64::new(0))),
        ));
        let barrier = Arc::new(Barrier::new(2));
        registry
            .set_before_state_lock_for_test(Arc::clone(&barrier))
            .unwrap();
        let state_guard = registry.inner.state.lock().unwrap();
        let worker_registry = Arc::clone(&registry);
        let worker = thread::spawn(move || worker_registry.issue_for_test(material("queued")));
        barrier.wait();
        clock.advance(Duration::from_secs(5));
        drop(state_guard);
        let handle = worker.join().unwrap().unwrap();
        assert_eq!(
            registry
                .inspect_for_composition(&handle)
                .unwrap()
                .capture_digest,
            material("queued").capture_digest
        );
    }

    #[test]
    fn generation_prevents_aba_and_concurrent_consumers_have_one_winner() {
        let clock = Arc::new(ManualClockV1::new());
        let registry = Arc::new(registry(
            4,
            Duration::from_millis(10),
            Arc::clone(&clock),
            Arc::new(ConstantEntropyV1(7)),
        ));
        let first = registry.issue_for_test(material("aba-first")).unwrap();
        let stale = duplicate_handle(&first);
        clock.advance(Duration::from_millis(10));
        let replacement = registry.issue_for_test(material("aba-second")).unwrap();
        assert_eq!(first.id, replacement.id);
        assert_ne!(first.generation, replacement.generation);
        assert_eq!(
            stale.consume_for_initializer().err().unwrap(),
            LockedHighWaterCaptureErrorV1::HandleInvalid
        );
        assert!(replacement.consume_for_initializer().is_ok());
        drop(first);

        clock.advance(Duration::from_millis(10));
        let winner = registry.issue_for_test(material("race")).unwrap();
        let contender = duplicate_handle(&winner);
        let left = thread::spawn(move || winner.consume_for_initializer().is_ok());
        let right = thread::spawn(move || contender.consume_for_initializer().is_ok());
        assert_eq!(
            u8::from(left.join().unwrap()) + u8::from(right.join().unwrap()),
            1
        );
    }

    #[test]
    fn registry_capacity_entropy_collision_and_clock_rollback_fail_closed() {
        let clock = Arc::new(ManualClockV1::new());
        let bounded = registry(
            1,
            Duration::from_secs(30),
            Arc::clone(&clock),
            Arc::new(CounterEntropyV1(AtomicU64::new(0))),
        );
        let _first = bounded.issue_for_test(material("capacity-a")).unwrap();
        assert_eq!(
            bounded
                .issue_for_test(material("capacity-b"))
                .err()
                .unwrap(),
            LockedHighWaterCaptureErrorV1::RegistryFull
        );

        let collision = registry(
            4,
            Duration::from_secs(30),
            Arc::new(ManualClockV1::new()),
            Arc::new(ConstantEntropyV1(9)),
        );
        let _occupied = collision.issue_for_test(material("collision-a")).unwrap();
        assert_eq!(
            collision
                .issue_for_test(material("collision-b"))
                .err()
                .unwrap(),
            LockedHighWaterCaptureErrorV1::IdCollision
        );
        assert_eq!(
            LockedHighWaterCaptureRegistryV1::with_dependencies(
                4,
                Duration::from_secs(30),
                Arc::new(ManualClockV1::new()),
                Arc::new(UnavailableEntropyV1),
            )
            .err()
            .unwrap(),
            LockedHighWaterCaptureErrorV1::EntropyUnavailable
        );

        let rollback_clock = Arc::new(ManualClockV1::new());
        rollback_clock.set(Duration::from_secs(5));
        let rollback = registry(
            4,
            Duration::from_secs(30),
            Arc::clone(&rollback_clock),
            Arc::new(CounterEntropyV1(AtomicU64::new(0))),
        );
        let _live = rollback.issue_for_test(material("clock-a")).unwrap();
        rollback_clock.set(Duration::from_secs(4));
        assert_eq!(
            rollback.issue_for_test(material("clock-b")).err().unwrap(),
            LockedHighWaterCaptureErrorV1::ClockUnavailable
        );
    }

    #[test]
    fn retained_material_failure_is_burned_before_semantic_validation() {
        let clock = Arc::new(ManualClockV1::new());
        let registry = registry(
            4,
            Duration::from_secs(30),
            clock,
            Arc::new(CounterEntropyV1(AtomicU64::new(0))),
        );
        let value = material("burn-before-validation");
        let handle = registry.issue_for_test(value.clone()).unwrap();
        registry
            .inner
            .state
            .lock()
            .unwrap()
            .active
            .get_mut(&handle.id)
            .unwrap()
            .material
            .query_bindings_match = false;
        assert_eq!(
            handle.consume_for_initializer().err().unwrap(),
            LockedHighWaterCaptureErrorV1::InvalidMaterial
        );
        assert_eq!(
            registry.issue_for_test(value).err().unwrap(),
            LockedHighWaterCaptureErrorV1::ScopeAlreadyActive
        );
    }

    #[test]
    fn retained_source_scope_rebinding_is_rejected_and_burned() {
        let registry = registry(
            4,
            Duration::from_secs(30),
            Arc::new(ManualClockV1::new()),
            Arc::new(CounterEntropyV1(AtomicU64::new(0))),
        );
        let value = material("scope-rebind");
        let handle = registry.issue_for_test(value.clone()).unwrap();
        registry
            .inner
            .state
            .lock()
            .unwrap()
            .active
            .get_mut(&handle.id)
            .unwrap()
            .material
            .source_scope_digest = digest("different-valid-source-scope");
        assert_eq!(
            registry.inspect_for_composition(&handle).err().unwrap(),
            LockedHighWaterCaptureErrorV1::InvalidMaterial
        );
        assert_eq!(
            handle.consume_for_initializer().err().unwrap(),
            LockedHighWaterCaptureErrorV1::InvalidMaterial
        );
        assert_eq!(
            registry.issue_for_test(value).err().unwrap(),
            LockedHighWaterCaptureErrorV1::ScopeAlreadyActive
        );
    }

    #[test]
    fn signed_source_scope_single_flights_distinct_capture_digests() {
        let registry = registry(
            4,
            Duration::from_secs(30),
            Arc::new(ManualClockV1::new()),
            Arc::new(CounterEntropyV1(AtomicU64::new(0))),
        );
        let first = material("same-source-scope");
        let mut second = first.clone();
        second.capture_digest = digest("different-capture");
        let _active = registry.issue_for_test(first).unwrap();
        assert_eq!(
            registry.issue_for_test(second).err().unwrap(),
            LockedHighWaterCaptureErrorV1::ScopeAlreadyActive
        );
    }

    #[test]
    fn empty_capture_still_bounds_declared_maximum_cursor() {
        let registry = registry(
            4,
            Duration::from_secs(30),
            Arc::new(ManualClockV1::new()),
            Arc::new(CounterEntropyV1(AtomicU64::new(0))),
        );
        let mut empty = material("empty-maximum");
        empty.maximum_cursor = MAXIMUM_SAFE_INTEGER + 1;
        empty.captured_high_water = None;
        empty.minimum_cursor = None;
        empty.total_row_count = 0;
        empty.remaining_null_target_row_count = 0;
        empty.required_batch_receipt_count = 0;
        assert_eq!(
            registry.issue_for_test(empty).err().unwrap(),
            LockedHighWaterCaptureErrorV1::InvalidMaterial
        );
    }

    #[test]
    fn every_locked_capture_domain_is_validated_before_issue() {
        let mutations: [fn(&mut LockedHighWaterCaptureMaterialV1); 21] = [
            |value| value.project_ref = "invalid".to_owned(),
            |value| value.source_grant_generation = "-invalid".to_owned(),
            |value| value.capture_digest = "not-a-digest".to_owned(),
            |value| value.source_ledger_subject_digest = "not-a-digest".to_owned(),
            |value| value.inspection_subject_digest = "not-a-digest".to_owned(),
            |value| value.inspection_subject_digest = value.source_ledger_subject_digest.clone(),
            |value| value.capture_write_grant_generation = value.read_grant_generation.clone(),
            |value| value.schema_name = "private".to_owned(),
            |value| value.cursor_sub_id = 0,
            |value| value.statement_count = 9,
            |value| value.transaction_read_only = true,
            |value| value.database_primary = false,
            |value| value.minimum_cursor = None,
            |value| value.maximum_cursor = 41,
            |value| value.batch_size = MAXIMUM_BATCH_SIZE + 1,
            |value| value.maximum_batch_receipt_count = MAXIMUM_BATCH_RECEIPT_COUNT - 1,
            |value| value.required_batch_receipt_count = 1,
            |value| value.query_bindings_match = false,
            |value| value.snapshot_marker = "invalid marker".to_owned(),
            |value| value.observed_at = "2027-02-30T00:00:02.000Z".to_owned(),
            |value| value.server_version_num = "aé123".to_owned(),
        ];
        for (index, mutate) in mutations.into_iter().enumerate() {
            let clock = Arc::new(ManualClockV1::new());
            let registry = registry(
                4,
                Duration::from_secs(30),
                clock,
                Arc::new(CounterEntropyV1(AtomicU64::new(0))),
            );
            let mut candidate = material(&format!("invalid-{index}"));
            mutate(&mut candidate);
            assert_eq!(
                registry.issue_for_test(candidate).err().unwrap(),
                LockedHighWaterCaptureErrorV1::InvalidMaterial
            );
        }
    }

    #[test]
    fn source_has_no_command_transport_secret_or_production_mint_path() {
        let source = include_str!("backend_locked_high_water_capture.rs");
        let lib = include_str!("lib.rs");
        assert!(lib.contains("mod backend_locked_high_water_capture;"));
        assert_eq!(lib.matches("backend_locked_high_water_capture").count(), 1);
        for forbidden in [
            ["tauri", "command"].join("::"),
            ["req", "west"].concat(),
            ["tokio", "postgres"].join("_"),
            ["connection", "string"].join("_"),
            ["personal", "access", "token"].join("_"),
            ["service", "role"].join("_"),
            ["execute", "sql"].join("_"),
            ["production", "issuer"].join("_"),
        ] {
            assert!(
                !source.contains(&forbidden),
                "forbidden source: {forbidden}"
            );
        }
        assert!(source.contains("#[cfg(test)]\n    pub(crate) fn issue_for_test("));
        for capability in [
            "LockedHighWaterCaptureRegistryV1",
            "SealedLockedHighWaterCaptureProofV1",
            "ConsumedLockedHighWaterCaptureProofV1",
        ] {
            let declaration = format!("struct {capability}");
            let offset = source.find(&declaration).unwrap();
            let prefix = &source[offset.saturating_sub(160)..offset];
            let adjacent_derive = prefix
                .rsplit_once("#[derive(")
                .map(|(_, derive)| derive)
                .filter(|derive| !derive.contains("\n\n"));
            for forbidden_trait in ["Clone", "Debug", "Serialize", "Deserialize"] {
                assert!(
                    !adjacent_derive.is_some_and(|derive| derive.contains(forbidden_trait)),
                    "capability must not derive {forbidden_trait}: {capability}"
                );
            }
        }
    }
}
