use super::super::super::{
    credential_composition::{
        self, run_credential_bound_recovered_read_for_test, wait_for_credential,
        CredentialBoundConnectorFactoryV1,
    },
    interrupt::ActiveReadInterruptV1,
};
use super::*;
use crate::{
    credentials::CredentialVault,
    supabase_backfill_fixed_read::{
        clear_database_read_credential_v1, replace_database_read_credential_v1,
        DatabaseReadCredentialAdmissionErrorV1, DatabaseReadCredentialConnectionInputsV1,
    },
};
use std::{future::Future, sync::atomic::AtomicUsize};
use zeroize::Zeroizing;

const INITIAL_GRANT: &str = "22222222-2222-4222-8222-222222222222";
const HISTORICAL_GRANT: &str = "11111111-1111-4111-8111-111111111111";
const FIXTURE_PASSWORD: &str = "  local database fixture\tvalue\n ";
const GRANT_ACCOUNT: &str = "v1:supabase-management:default:grant-generation";
const PASSWORD_ACCOUNT: &str = "v1:supabase-database-read:default:password";

fn runtime_test<F: Future<Output = ()>>(test: impl FnOnce() -> F) {
    tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .unwrap()
        .block_on(async {
            tokio::time::timeout(Duration::from_secs(20), test())
                .await
                .expect("bounded async fixture");
        });
}

fn profile(project: &str, account: &str) -> String {
    serde_json::json!({
        "format": "openpencil.supabase-database-read-connection-profile.v1",
        "version": 1,
        "providerId": "supabase",
        "environment": "staging",
        "projectRef": project,
        "accountId": account,
        "mode": "direct",
        "host": format!("db.{project}.supabase.co"),
        "port": 5432,
        "database": "postgres",
        "user": "postgres",
        "tlsMode": "verify-full"
    })
    .to_string()
}

fn configured_vault(harness: &Harness, project: &str, account: &str) -> (CredentialVault, String) {
    let vault = CredentialVault::new(harness.temp.path().join("vault-app"));
    vault
        .write_secret_for_test(GRANT_ACCOUNT, INITIAL_GRANT)
        .unwrap();
    let receipt = replace_database_read_credential_v1(
        &vault,
        INITIAL_GRANT,
        Zeroizing::new(FIXTURE_PASSWORD.to_owned()),
        profile(project, account),
    )
    .unwrap();
    (vault, receipt.grant_generation().to_owned())
}

struct Factory {
    state: Arc<Shared>,
    bindings: Arc<AtomicUsize>,
    expected_grant: String,
}

struct BorrowedConnector<'a> {
    inner: Connector,
    inputs: DatabaseReadCredentialConnectionInputsV1<'a>,
}

impl credential_composition::sealed::Factory for Factory {}
impl CredentialBoundConnectorFactoryV1 for Factory {
    type Connector<'a> = BorrowedConnector<'a>;

    fn bind<'a>(
        &'a self,
        inputs: DatabaseReadCredentialConnectionInputsV1<'a>,
    ) -> Result<Self::Connector<'a>, RunnerErrorV1> {
        assert_eq!(
            inputs.connection_profile().project_ref(),
            "abcdefghijklmnopqrst"
        );
        assert_eq!(inputs.connection_profile().account_id(), "account-golden");
        assert_eq!(inputs.connection_profile().tls_mode(), "verify-full");
        assert_eq!(inputs.grant_generation(), self.expected_grant);
        assert_ne!(inputs.grant_generation(), HISTORICAL_GRANT);
        assert_ne!(inputs.credential_incarnation(), [0; 32]);
        assert_eq!(
            inputs.connection_profile_digest(),
            inputs.connection_profile().digest()
        );
        assert!(inputs.password() == FIXTURE_PASSWORD);
        self.bindings.fetch_add(1, Ordering::SeqCst);
        Ok(BorrowedConnector {
            inner: Connector(self.state.clone()),
            inputs,
        })
    }
}

impl sealed::Connector for BorrowedConnector<'_> {}
impl DatabaseConnectorV1 for BorrowedConnector<'_> {
    type Session = Session;

    async fn connect(&mut self, control: StageControlV1<'_>) -> Result<Session, DatabaseFailureV1> {
        // The secret remains borrowed from the admission even across an asynchronous connect.
        assert!(self.inputs.password() == FIXTURE_PASSWORD);
        self.inner.connect(control).await
    }

    fn cancel_connect(&mut self) {
        self.inner.cancel_connect();
    }
}

fn factory(state: Arc<Shared>, expected_grant: String) -> (Factory, Arc<AtomicUsize>) {
    let bindings = Arc::new(AtomicUsize::new(0));
    (
        Factory {
            state,
            bindings: bindings.clone(),
            expected_grant,
        },
        bindings,
    )
}

#[test]
fn credential_bound_recovery_borrows_current_snapshot_without_remote_authority() {
    runtime_test(|| async {
        let state = Arc::new(shared(&contract()));
        let harness = Harness::new(state.clock.clone());
        let (vault, grant) = configured_vault(&harness, "abcdefghijklmnopqrst", "account-golden");
        let (factory, bindings) = factory(state.clone(), grant);
        let interrupts = ActiveReadInterruptV1::new().unwrap();
        let observation = run_credential_bound_recovered_read_for_test(
            &harness.journal,
            harness.recovery(),
            vault,
            factory,
            &interrupts,
        )
        .await
        .unwrap();
        assert_eq!(bindings.load(Ordering::SeqCst), 1);
        assert_eq!(*state.events.lock().unwrap(), STAGES.map(Event::Stage));
        let deadlines = state.deadlines.lock().unwrap();
        assert_eq!(deadlines.len(), 8);
        assert!(deadlines.iter().all(|deadline| *deadline == deadlines[0]));
        assert!(!observation.production_transport_authenticated());
        assert!(!observation.settlement_authorized());
        assert!(!observation.automatic_retry_allowed());
        assert!(!observation.receipt_v2_issued());
        assert!(!observation.release_authorized());
        harness.assert_unresolved();
        assert_eq!(harness.record()["reconciliationLease"]["consumed"], true);
    });
}

#[test]
fn missing_or_mismatched_current_credentials_never_bind_or_connect() {
    runtime_test(|| async {
        for case in ["missing", "unavailable", "account", "project"] {
            let state = Arc::new(shared(&contract()));
            let harness = Harness::new(state.clock.clone());
            let (vault, grant) = match case {
                "missing" => (
                    CredentialVault::new(harness.temp.path().join("empty-vault")),
                    String::new(),
                ),
                "unavailable" => (CredentialVault::unavailable(), String::new()),
                "account" => configured_vault(&harness, "abcdefghijklmnopqrst", "account-other"),
                _ => configured_vault(&harness, "bcdefghijklmnopqrstu", "account-golden"),
            };
            let (factory, bindings) = factory(state.clone(), grant);
            let interrupts = ActiveReadInterruptV1::new().unwrap();
            let result = run_credential_bound_recovered_read_for_test(
                &harness.journal,
                harness.recovery(),
                vault,
                factory,
                &interrupts,
            )
            .await;
            assert!(matches!(result, Err(RunnerErrorV1::Credential(_))));
            assert_eq!(bindings.load(Ordering::SeqCst), 0);
            assert!(state.events.lock().unwrap().is_empty());
            harness.assert_unresolved();
            assert_eq!(harness.record()["reconciliationLease"]["consumed"], true);
        }
    });
}

#[test]
fn current_credential_changes_during_fixed_read_suppress_the_observation() {
    runtime_test(|| async {
        for stage in [ReadStageV1::Execute, ReadStageV1::FinishReadOnly] {
            for change in ["replace", "clear", "password"] {
                let mut state = shared(&contract());
                let harness = Harness::new(state.clock.clone());
                let (vault, grant) =
                    configured_vault(&harness, "abcdefghijklmnopqrst", "account-golden");
                let changed_vault = vault.clone();
                let current_grant = grant.clone();
                state.stage_hook = Some(Arc::new(move |current| {
                    if current != stage {
                        return;
                    }
                    match change {
                        "replace" => {
                            replace_database_read_credential_v1(
                                &changed_vault,
                                &current_grant,
                                Zeroizing::new(FIXTURE_PASSWORD.to_owned()),
                                profile("abcdefghijklmnopqrst", "account-golden"),
                            )
                            .unwrap();
                        }
                        "clear" => {
                            clear_database_read_credential_v1(&changed_vault, &current_grant)
                                .unwrap();
                        }
                        _ => {
                            changed_vault
                                .write_secret_for_test(PASSWORD_ACCOUNT, "changed local fixture")
                                .unwrap();
                        }
                    }
                }));
                let state = Arc::new(state);
                let (factory, _) = factory(state.clone(), grant);
                let interrupts = ActiveReadInterruptV1::new().unwrap();
                let result = run_credential_bound_recovered_read_for_test(
                    &harness.journal,
                    harness.recovery(),
                    vault,
                    factory,
                    &interrupts,
                )
                .await;
                assert!(matches!(result, Err(RunnerErrorV1::Credential(_))));
                let events = state.events.lock().unwrap();
                if stage == ReadStageV1::Execute {
                    let mut expected = STAGES[..7].iter().copied().map(Event::Stage).collect::<Vec<_>>();
                    expected.push(Event::Abort);
                    assert_eq!(*events, expected);
                } else {
                    assert_eq!(*events, STAGES.map(Event::Stage));
                }
                harness.assert_unresolved();
                assert_eq!(harness.record()["reconciliationLease"]["consumed"], true);
            }
        }
    });
}

#[test]
fn unpolled_or_precancelled_credential_recovery_never_touches_vault_or_journal() {
    runtime_test(|| async {
        for cancelled in [false, true] {
            let state = Arc::new(shared(&contract()));
            let harness = Harness::new(state.clock.clone());
            let recovery = harness.recovery();
            let before = harness.bytes();
            let untouched = harness.temp.path().join("untouched-vault");
            let vault = CredentialVault::new(untouched.clone());
            let (factory, bindings) = factory(state.clone(), String::new());
            let interrupts = ActiveReadInterruptV1::new().unwrap();
            if cancelled {
                interrupts.cancel();
            }
            let future = run_credential_bound_recovered_read_for_test(
                &harness.journal,
                recovery,
                vault,
                factory,
                &interrupts,
            );
            fn require_send<T: Send>(_: &T) {}
            require_send(&future);
            if cancelled {
                assert!(matches!(future.await, Err(RunnerErrorV1::Cancelled)));
            } else {
                drop(future);
            }
            assert!(!untouched.exists());
            assert_eq!(harness.bytes(), before);
            assert_eq!(bindings.load(Ordering::SeqCst), 0);
            assert!(state.events.lock().unwrap().is_empty());
        }
    });
}

#[test]
fn dropping_pending_credential_bound_read_cancels_the_request_and_keeps_unknown() {
    runtime_test(|| async {
        for stage in [ReadStageV1::Connect, ReadStageV1::Execute] {
            let mut state = shared(&contract());
            state.pending_at = Some(stage);
            let state = Arc::new(state);
            let harness = Harness::new(state.clock.clone());
            let (vault, grant) =
                configured_vault(&harness, "abcdefghijklmnopqrst", "account-golden");
            let (factory, _) = factory(state.clone(), grant);
            let interrupts = ActiveReadInterruptV1::new().unwrap();
            let mut future = Box::pin(run_credential_bound_recovered_read_for_test(
                &harness.journal,
                harness.recovery(),
                vault,
                factory,
                &interrupts,
            ));
            poll_fn(|context| {
                assert!(future.as_mut().poll(context).is_pending());
                if state.events.lock().unwrap().contains(&Event::Stage(stage)) {
                    Poll::Ready(())
                } else {
                    Poll::Pending
                }
            })
            .await;
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
    });
}

#[test]
fn timed_out_credential_work_discards_queued_or_late_output() {
    struct Output(Arc<AtomicBool>);
    impl Drop for Output {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }
    runtime_test(|| async {
        let interrupts = ActiveReadInterruptV1::new().unwrap();
        let mut execution = ExecutionControlV1::start_for_test(&interrupts).unwrap();
        execution.deadline = interrupts.monotonic() + Duration::from_millis(35);
        let dropped = Arc::new(AtomicBool::new(false));
        // Create the value before scheduling: both a queued task aborted before first execution
        // and a started task returning after the deadline must release its owned output.
        let output = Output(dropped.clone());
        let result = wait_for_credential(&execution, move || {
            std::thread::sleep(Duration::from_millis(120));
            Ok::<_, DatabaseReadCredentialAdmissionErrorV1>(output)
        })
        .await;
        assert!(matches!(result, Err(RunnerErrorV1::TimedOut)));
        while !dropped.load(Ordering::SeqCst) {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    });
}

#[test]
fn cancelling_or_dropping_started_credential_work_discards_its_output() {
    struct WorkerGate {
        started: AtomicBool,
        waiter: Mutex<Option<Waker>>,
        released: Mutex<bool>,
        signal: std::sync::Condvar,
        output_dropped: AtomicBool,
    }
    struct Output(Arc<WorkerGate>);
    impl Drop for Output {
        fn drop(&mut self) {
            self.0.output_dropped.store(true, Ordering::SeqCst);
        }
    }
    runtime_test(|| async {
        for cancel in [false, true] {
            let gate = Arc::new(WorkerGate {
                started: AtomicBool::new(false),
                waiter: Mutex::new(None),
                released: Mutex::new(false),
                signal: std::sync::Condvar::new(),
                output_dropped: AtomicBool::new(false),
            });
            let worker_gate = gate.clone();
            let interrupts = ActiveReadInterruptV1::new().unwrap();
            let execution = ExecutionControlV1::start_for_test(&interrupts).unwrap();
            let mut future = Box::pin(wait_for_credential(&execution, move || {
                let output = Output(worker_gate.clone());
                worker_gate.started.store(true, Ordering::SeqCst);
                let waiter = worker_gate.waiter.lock().unwrap().take();
                if let Some(waiter) = waiter {
                    waiter.wake();
                }
                let (_released, timeout) = worker_gate
                    .signal
                    .wait_timeout_while(
                        worker_gate.released.lock().unwrap(),
                        Duration::from_secs(5),
                        |released| !*released,
                    )
                    .unwrap();
                assert!(
                    !timeout.timed_out(),
                    "the fixture must release its started worker"
                );
                Ok::<_, DatabaseReadCredentialAdmissionErrorV1>(output)
            }));
            // Explicit worker-start handshake: the cancellation/drop assertion never depends on
            // the thread pool winning a race against a short wall-clock deadline.
            poll_fn(|context| {
                *gate.waiter.lock().unwrap() = Some(context.waker().clone());
                assert!(future.as_mut().poll(context).is_pending());
                if gate.started.load(Ordering::SeqCst) {
                    Poll::Ready(())
                } else {
                    Poll::Pending
                }
            })
            .await;
            if cancel {
                interrupts.cancel();
                assert!(matches!(
                    future.as_mut().await,
                    Err(RunnerErrorV1::Cancelled)
                ));
            }
            drop(future);
            assert!(!gate.output_dropped.load(Ordering::SeqCst));
            *gate.released.lock().unwrap() = true;
            gate.signal.notify_all();
            while !gate.output_dropped.load(Ordering::SeqCst) {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }
    });
}

#[test]
fn interrupted_waker_registration_never_schedules_a_credential_read() {
    struct RegisterInterrupt {
        cancelled: AtomicBool,
        fail: bool,
    }
    impl InterruptSourceV1 for RegisterInterrupt {
        fn monotonic(&self) -> Duration {
            Duration::ZERO
        }
        fn cancelled(&self) -> bool {
            self.cancelled.load(Ordering::SeqCst)
        }
        fn register_waker(&self, _: &Waker, _: Duration) -> Result<(), RunnerErrorV1> {
            if self.fail {
                Err(RunnerErrorV1::InterruptUnavailable)
            } else {
                self.cancelled.store(true, Ordering::SeqCst);
                Ok(())
            }
        }
    }
    runtime_test(|| async {
        for fail in [false, true] {
            let interrupts = RegisterInterrupt {
                cancelled: AtomicBool::new(false),
                fail,
            };
            let execution = ExecutionControlV1::start_for_test(&interrupts).unwrap();
            let started = Arc::new(AtomicBool::new(false));
            let observed = started.clone();
            let result = wait_for_credential(&execution, move || {
                observed.store(true, Ordering::SeqCst);
                Ok::<_, DatabaseReadCredentialAdmissionErrorV1>(())
            })
            .await;
            assert_eq!(
                result,
                Err(if fail {
                    RunnerErrorV1::InterruptUnavailable
                } else {
                    RunnerErrorV1::Cancelled
                })
            );
            assert!(!started.load(Ordering::SeqCst));
        }
    });
}


struct RevocationWake {
    target: Waker,
    count: Arc<AtomicUsize>,
}
impl std::task::Wake for RevocationWake {
    fn wake(self: Arc<Self>) { self.wake_by_ref(); }
    fn wake_by_ref(self: &Arc<Self>) {
        self.count.fetch_add(1, Ordering::SeqCst);
        self.target.wake_by_ref();
    }
}

async fn reach_pending_with_observed_waker<F: Future>(
    mut future: std::pin::Pin<&mut F>,
    state: &Shared,
    stage: ReadStageV1,
    count: Arc<AtomicUsize>,
) {
    poll_fn(|context| {
        let waker = Waker::from(Arc::new(RevocationWake {
            target: context.waker().clone(), count: count.clone(),
        }));
        assert!(future.as_mut().poll(&mut Context::from_waker(&waker)).is_pending());
        if state.events.lock().unwrap().contains(&Event::Stage(stage)) {
            Poll::Ready(())
        } else { Poll::Pending }
    }).await;
    count.store(0, Ordering::SeqCst);
}

#[test]
fn same_value_shared_grant_write_wakes_and_revokes_every_pending_stage() {
    runtime_test(|| async {
        for stage in STAGES {
            let mut state = shared(&contract());
            state.pending_at = Some(stage);
            let state = Arc::new(state);
            let harness = Harness::new(state.clock.clone());
            let (vault, grant) = configured_vault(&harness, "abcdefghijklmnopqrst", "account-golden");
            let changed = vault.clone();
            let (factory, _) = factory(state.clone(), grant.clone());
            let interrupts = ActiveReadInterruptV1::new().unwrap();
            let mut future = Box::pin(run_credential_bound_recovered_read_for_test(
                &harness.journal, harness.recovery(), vault, factory, &interrupts,
            ));
            let wakes = Arc::new(AtomicUsize::new(0));
            reach_pending_with_observed_waker(future.as_mut(), &state, stage, wakes.clone()).await;
            // Generic Management-grant mutation, not a database lifecycle callback. Rewriting the
            // exact same value must still revoke the old snapshot and wake a silent DB future.
            tokio::task::spawn_blocking(move || changed.write_secret_for_test(GRANT_ACCOUNT, &grant))
                .await.unwrap().unwrap();
            assert!(wakes.load(Ordering::SeqCst) > 0);
            assert!(matches!(future.await, Err(RunnerErrorV1::Credential(
                DatabaseReadCredentialAdmissionErrorV1::Changed
            ))));
            let events = state.events.lock().unwrap();
            if stage == ReadStageV1::Connect {
                assert!(events.ends_with(&[Event::CancelConnect]));
            } else {
                assert!(events.ends_with(&[Event::Cancel, Event::Abort]));
            }
            harness.assert_unresolved();
            assert_eq!(harness.record()["reconciliationLease"]["consumed"], true);
        }
    });
}

#[test]
fn unrelated_vault_write_keeps_pending_read_alive_until_a_watched_write() {
    runtime_test(|| async {
        let mut state = shared(&contract());
        state.pending_at = Some(ReadStageV1::Execute);
        let state = Arc::new(state);
        let harness = Harness::new(state.clock.clone());
        let (vault, grant) = configured_vault(&harness, "abcdefghijklmnopqrst", "account-golden");
        let changed = vault.clone();
        let (factory, _) = factory(state.clone(), grant);
        let interrupts = ActiveReadInterruptV1::new().unwrap();
        let mut future = Box::pin(run_credential_bound_recovered_read_for_test(
            &harness.journal, harness.recovery(), vault, factory, &interrupts,
        ));
        let wakes = Arc::new(AtomicUsize::new(0));
        reach_pending_with_observed_waker(future.as_mut(), &state, ReadStageV1::Execute, wakes.clone()).await;
        let changed = tokio::task::spawn_blocking(move || {
            changed.write_secret_for_test("v1:github:default:token", "unrelated fixture").unwrap();
            changed
        }).await.unwrap();
        assert_eq!(wakes.load(Ordering::SeqCst), 0);
        assert!(poll(future.as_mut()).is_pending());
        tokio::task::spawn_blocking(move || {
            changed.write_secret_for_test(PASSWORD_ACCOUNT, "replacement fixture").unwrap();
        }).await.unwrap();
        assert!(matches!(future.await, Err(RunnerErrorV1::Credential(_))));
        assert!(state.events.lock().unwrap().ends_with(&[Event::Cancel, Event::Abort]));
        harness.assert_unresolved();
    });
}
