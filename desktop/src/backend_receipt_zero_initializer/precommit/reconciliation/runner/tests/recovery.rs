use super::super::recovery_composition::run_recovered_fixed_read_for_test;
use super::*;
use crate::backend_operation_journal::{
    BackendOperationJournalV1, DirectorySync, JournalClock, JournalEntropy,
    ReceiptZeroInitializerJournalRecoveryV1,
};
use std::{fs, path::Path};
use tempfile::TempDir;

const WALL_START: u64 = 1_800_000_000_000;

struct JournalTime {
    wall: AtomicU64,
    monotonic: AtomicU64,
}

impl JournalTime {
    fn advance(&self, milliseconds: u64) {
        self.wall.fetch_add(milliseconds, Ordering::SeqCst);
        self.monotonic.fetch_add(milliseconds, Ordering::SeqCst);
    }
}

impl JournalClock for JournalTime {
    fn wall_unix_millis(&self) -> Result<u64, JournalError> {
        Ok(self.wall.load(Ordering::SeqCst))
    }

    fn monotonic(&self) -> Duration {
        Duration::from_millis(self.monotonic.load(Ordering::SeqCst))
    }
}

struct Entropy(AtomicU64);

impl JournalEntropy for Entropy {
    fn capability_id(&self) -> Result<[u8; 32], JournalError> {
        let mut id = [0; 32];
        id[24..].copy_from_slice(&self.0.fetch_add(1, Ordering::SeqCst).to_be_bytes());
        Ok(id)
    }
}

struct SyncDirectory {
    fail_after: AtomicU64,
    delay_once_ms: AtomicU64,
    journal_time: Arc<JournalTime>,
    connector_time: Arc<Clock>,
}

impl DirectorySync for SyncDirectory {
    fn sync(&self, directory: &Path) -> Result<(), JournalError> {
        let delay = self.delay_once_ms.swap(0, Ordering::SeqCst);
        if delay > 0 {
            self.journal_time.advance(delay);
            let current = self.connector_time.millis.load(Ordering::SeqCst);
            self.connector_time.set(current + delay);
        }
        let countdown = self.fail_after.load(Ordering::SeqCst);
        if countdown > 0 && self.fail_after.fetch_sub(1, Ordering::SeqCst) == 1 {
            return Err(JournalError::Unavailable);
        }
        fs::File::open(directory)
            .and_then(|file| file.sync_all())
            .map_err(|_| JournalError::Unavailable)
    }
}

struct Harness {
    temp: TempDir,
    journal: BackendOperationJournalV1,
    clock: Arc<JournalTime>,
    sync: Arc<SyncDirectory>,
    key: String,
}

impl Harness {
    fn new(connector_time: Arc<Clock>) -> Self {
        let temp = TempDir::new().unwrap();
        let clock = Arc::new(JournalTime {
            wall: AtomicU64::new(WALL_START),
            monotonic: AtomicU64::new(0),
        });
        let sync = Arc::new(SyncDirectory {
            fail_after: AtomicU64::new(0),
            delay_once_ms: AtomicU64::new(0),
            journal_time: clock.clone(),
            connector_time,
        });
        let entropy = Arc::new(Entropy(AtomicU64::new(1)));
        let create_journal = || {
            BackendOperationJournalV1::with_test_dependencies(
                temp.path().join("app-data"),
                entropy.clone(),
                clock.clone(),
                sync.clone(),
            )
        };
        let initial = create_journal();
        let mut fixture: serde_json::Value = serde_json::from_slice(include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../tests/fixtures/backend/supabase/receipt-zero-initializer-canonical-v1.json"
        )))
        .unwrap();
        let material = serde_json::from_value(fixture["material"].take()).unwrap();
        let claim = initial
            .claim_receipt_zero_initializer_for_test(material)
            .unwrap();
        let key = claim.single_flight_key_for_test().to_owned();
        let dispatch = initial
            .precommit_receipt_zero_initializer_for_test(claim)
            .unwrap();
        drop(dispatch);
        drop(initial);
        // A restart may reconstruct only after the original five-minute claim/quiet fences.
        clock.advance(301_000);
        let journal = create_journal();
        Self {
            temp,
            journal,
            clock,
            sync,
            key,
        }
    }

    fn recovery(&self) -> ReceiptZeroInitializerJournalRecoveryV1 {
        self.journal
            .reconstruct_receipt_zero_initializer_for_test(&self.key)
            .unwrap()
    }

    fn bytes(&self) -> Vec<u8> {
        fs::read(
            self.temp
                .path()
                .join("app-data/backend-operation-journal/journal.v1.json"),
        )
        .unwrap()
    }

    fn record(&self) -> serde_json::Value {
        let mut envelope: serde_json::Value = serde_json::from_slice(&self.bytes()).unwrap();
        envelope["body"]["records"][&self.key].take()
    }

    fn assert_unresolved(&self) {
        let record = self.record();
        assert_eq!(record["state"], "outcome-unknown");
        assert!(record["finalEvidence"].is_null());
    }
}

#[test]
fn recovered_read_uses_exact_journal_bindings_and_preserves_unknown_outcome() {
    let read = contract();
    let state = Arc::new(shared(&read));
    let harness = Harness::new(state.clock.clone());
    let observation = completed(run_recovered_fixed_read_for_test(
        &harness.journal,
        harness.recovery(),
        Connector(state.clone()),
        state.clock.as_ref(),
    ))
    .unwrap();
    assert_eq!(*state.events.lock().unwrap(), STAGES.map(Event::Stage));
    assert_eq!(
        *state.deadlines.lock().unwrap(),
        vec![Duration::from_secs(40); 8]
    );
    assert_eq!(observation.status, ReadStateV1::Absent);
    assert!(!observation.production_transport_authenticated());
    assert!(!observation.absent_proves_prior_mutation_stopped());
    assert!(!observation.settlement_authorized());
    assert!(!observation.automatic_retry_allowed());
    assert!(!observation.receipt_v2_issued());
    assert!(!observation.release_authorized());
    harness.assert_unresolved();
    assert_eq!(harness.record()["reconciliationLease"]["consumed"], true);
    assert!(matches!(
        harness
            .journal
            .reconstruct_receipt_zero_initializer_for_test(&harness.key),
        Err(JournalError::LeaseActive)
    ));
}

#[test]
fn unpolled_or_precancelled_recovery_has_no_durable_or_connector_effects() {
    for cancelled in [false, true] {
        let state = Arc::new(shared(&contract()));
        let harness = Harness::new(state.clock.clone());
        let recovery = harness.recovery();
        let before = harness.bytes();
        if cancelled {
            state.clock.cancel();
        }
        let future = run_recovered_fixed_read_for_test(
            &harness.journal,
            recovery,
            Connector(state.clone()),
            state.clock.as_ref(),
        );
        fn require_send<T: Send>(_: &T) {}
        require_send(&future);
        if cancelled {
            assert!(matches!(completed(future), Err(RunnerErrorV1::Cancelled)));
        } else {
            drop(future);
        }
        assert_eq!(harness.bytes(), before);
        assert!(state.events.lock().unwrap().is_empty());
        assert!(harness.record()["reconciliationLease"].is_null());
    }
}

#[test]
fn another_journal_instance_cannot_execute_the_recovery() {
    let state = Arc::new(shared(&contract()));
    let harness = Harness::new(state.clock.clone());
    let recovery = harness.recovery();
    let before = harness.bytes();
    let foreign = BackendOperationJournalV1::with_test_dependencies(
        harness.temp.path().join("app-data"),
        Arc::new(Entropy(AtomicU64::new(2))),
        harness.clock.clone(),
        harness.sync.clone(),
    );
    // The initial claim used ID 1; A's recovery and B's independently minted recovery both use
    // ID 2. A matching runtime entry and identical durable bytes must not replace instance identity.
    let local_recovery = foreign
        .reconstruct_receipt_zero_initializer_for_test(&harness.key)
        .unwrap();
    assert!(matches!(
        completed(run_recovered_fixed_read_for_test(
            &foreign,
            recovery,
            Connector(state.clone()),
            state.clock.as_ref(),
        )),
        Err(RunnerErrorV1::Journal(JournalError::InvalidState))
    ));
    assert_eq!(harness.bytes(), before);
    assert!(state.events.lock().unwrap().is_empty());
    // Rejecting A's token must not consume B's own token with the colliding ID.
    assert!(completed(run_recovered_fixed_read_for_test(
        &foreign,
        local_recovery,
        Connector(state.clone()),
        state.clock.as_ref(),
    ))
    .is_ok());
}

#[test]
fn connector_clock_rollback_after_the_projection_sample_is_rejected() {
    struct ProjectionClock(Mutex<std::collections::VecDeque<u64>>);
    impl InterruptSourceV1 for ProjectionClock {
        fn monotonic(&self) -> Duration {
            Duration::from_millis(
                self.0
                    .lock()
                    .unwrap()
                    .pop_front()
                    .expect("bounded clock samples"),
            )
        }
        fn cancelled(&self) -> bool {
            false
        }
        fn register_waker(&self, _: &Waker, _: Duration) {
            panic!("clock regression must reject before I/O registration")
        }
    }
    let interrupts = ProjectionClock(Mutex::new(
        [10_000, 10_000, 10_000, 11_000, 10_500]
            .into_iter()
            .collect(),
    ));
    let state = Arc::new(shared(&contract()));
    let harness = Harness::new(state.clock.clone());
    assert!(matches!(
        completed(run_recovered_fixed_read_for_test(
            &harness.journal,
            harness.recovery(),
            Connector(state.clone()),
            &interrupts,
        )),
        Err(RunnerErrorV1::ClockInvalid)
    ));
    assert!(state.events.lock().unwrap().is_empty());
    harness.assert_unresolved();
    assert_eq!(harness.record()["reconciliationLease"]["consumed"], true);
}

#[test]
fn unconfirmed_begin_or_consume_durability_never_reaches_connect() {
    for fail_after in [1, 2] {
        let state = Arc::new(shared(&contract()));
        let harness = Harness::new(state.clock.clone());
        let recovery = harness.recovery();
        harness.sync.fail_after.store(fail_after, Ordering::SeqCst);
        assert!(matches!(
            completed(run_recovered_fixed_read_for_test(
                &harness.journal,
                recovery,
                Connector(state.clone()),
                state.clock.as_ref(),
            )),
            Err(RunnerErrorV1::Journal(JournalError::DurabilityUnconfirmed))
        ));
        assert!(state.events.lock().unwrap().is_empty());
        harness.assert_unresolved();
        assert!(matches!(
            harness
                .journal
                .reconstruct_receipt_zero_initializer_for_test(&harness.key),
            Err(JournalError::LeaseActive)
        ));
    }
}

#[test]
fn journal_prefix_time_consumes_the_first_poll_budget_without_resetting_it() {
    for delay in [10_000, 30_000] {
        let state = Arc::new(shared(&contract()));
        let harness = Harness::new(state.clock.clone());
        let recovery = harness.recovery();
        harness.sync.delay_once_ms.store(delay, Ordering::SeqCst);
        let result = completed(run_recovered_fixed_read_for_test(
            &harness.journal,
            recovery,
            Connector(state.clone()),
            state.clock.as_ref(),
        ));
        if delay == 10_000 {
            assert!(result.is_ok());
            assert_eq!(
                *state.deadlines.lock().unwrap(),
                vec![Duration::from_secs(40); 8]
            );
        } else {
            assert!(matches!(result, Err(RunnerErrorV1::TimedOut)));
            assert!(state.events.lock().unwrap().is_empty());
        }
        harness.assert_unresolved();
    }
}

#[test]
fn every_pending_stage_checks_both_original_journal_clocks() {
    for stage in STAGES {
        for change in 0..4 {
            let mut state = shared(&contract());
            state.pending_at = Some(stage);
            let state = Arc::new(state);
            let harness = Harness::new(state.clock.clone());
            let mut future = Box::pin(run_recovered_fixed_read_for_test(
                &harness.journal,
                harness.recovery(),
                Connector(state.clone()),
                state.clock.as_ref(),
            ));
            assert!(poll(future.as_mut()).is_pending());
            match change {
                0 => {
                    harness.clock.wall.fetch_add(30_000, Ordering::SeqCst);
                }
                1 => {
                    harness.clock.monotonic.fetch_add(30_000, Ordering::SeqCst);
                }
                2 => {
                    harness.clock.wall.fetch_sub(1, Ordering::SeqCst);
                }
                _ => {
                    harness.clock.monotonic.fetch_sub(1, Ordering::SeqCst);
                }
            }
            // The connector clock stays frozen: only the retained original journal clocks move.
            let expected = if change < 2 {
                RunnerErrorV1::TimedOut
            } else {
                RunnerErrorV1::Journal(JournalError::InvalidState)
            };
            assert!(matches!(poll(future.as_mut()), Poll::Ready(Err(error)) if error == expected));
            drop(future);
            let events = state.events.lock().unwrap();
            if stage == ReadStageV1::Connect {
                assert!(events.ends_with(&[Event::CancelConnect]));
            } else {
                assert!(events.ends_with(&[Event::Cancel, Event::Abort]));
            }
            harness.assert_unresolved();
            assert_eq!(harness.record()["reconciliationLease"]["consumed"], true);
        }
    }
}

#[test]
fn dropping_a_pending_recovery_burns_the_read_attempt_and_keeps_its_durable_fence() {
    for stage in STAGES {
        let mut state = shared(&contract());
        state.pending_at = Some(stage);
        let state = Arc::new(state);
        let harness = Harness::new(state.clock.clone());
        let mut future = Box::pin(run_recovered_fixed_read_for_test(
            &harness.journal,
            harness.recovery(),
            Connector(state.clone()),
            state.clock.as_ref(),
        ));
        assert!(poll(future.as_mut()).is_pending());
        drop(future);
        let events = state.events.lock().unwrap();
        if stage == ReadStageV1::Connect {
            assert!(events.ends_with(&[Event::CancelConnect]));
        } else {
            assert!(events.ends_with(&[Event::Cancel, Event::Abort]));
        }
        harness.assert_unresolved();
        assert_eq!(harness.record()["reconciliationLease"]["consumed"], true);
        assert!(matches!(
            harness
                .journal
                .reconstruct_receipt_zero_initializer_for_test(&harness.key),
            Err(JournalError::LeaseActive)
        ));
    }
}

#[test]
fn completed_stages_cannot_return_a_journal_expired_observation() {
    for stage in STAGES {
        let mut state = shared(&contract());
        let harness = Harness::new(state.clock.clone());
        let clock = harness.clock.clone();
        state.stage_hook = Some(Arc::new(move |current| {
            if current == stage {
                clock.wall.fetch_add(30_000, Ordering::SeqCst);
            }
        }));
        let state = Arc::new(state);
        assert!(matches!(
            completed(run_recovered_fixed_read_for_test(
                &harness.journal,
                harness.recovery(),
                Connector(state.clone()),
                state.clock.as_ref(),
            )),
            Err(RunnerErrorV1::TimedOut)
        ));
        let events = state.events.lock().unwrap();
        assert!(!events.contains(&Event::Cancel) && !events.contains(&Event::CancelConnect));
        assert_eq!(
            events.contains(&Event::Abort),
            !matches!(stage, ReadStageV1::Connect | ReadStageV1::FinishReadOnly)
        );
        harness.assert_unresolved();
    }
}
