use super::super::{DatabaseFailureV1, ExecutionControlV1, ReadStageV1};
use super::*;
use std::{
    future::{pending, poll_fn},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Barrier,
    },
    task::Wake,
};
use tokio::runtime::{Builder, Runtime};

const WATCHDOG: Duration = Duration::from_secs(3);

fn runtime() -> Runtime {
    Builder::new_current_thread().enable_time().build().unwrap()
}

struct CountingWake(Arc<AtomicUsize>);

impl Wake for CountingWake {
    fn wake(self: Arc<Self>) {
        self.wake_by_ref();
    }

    fn wake_by_ref(self: &Arc<Self>) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
}

struct ForwardWake {
    target: Waker,
    count: Arc<AtomicUsize>,
}

impl Wake for ForwardWake {
    fn wake(self: Arc<Self>) {
        self.wake_by_ref();
    }

    fn wake_by_ref(self: &Arc<Self>) {
        self.count.fetch_add(1, Ordering::SeqCst);
        self.target.wake_by_ref();
    }
}

fn control(source: &ActiveReadInterruptV1, deadline: Duration) -> ExecutionControlV1<'_> {
    ExecutionControlV1 {
        source,
        deadline,
        last_sample: Mutex::new(source.monotonic()),
        journal_ceiling: None,
    }
}

/// The watchdog gets the executor's original waker; only the runner receives the counting proxy.
/// A watchdog poll alone therefore cannot pass the assertion that the active source woke a task.
async fn counted<F: Future>(future: F, count: Arc<AtomicUsize>) -> F::Output {
    let mut future = std::pin::pin!(future);
    tokio::time::timeout(
        WATCHDOG,
        poll_fn(|context| {
            let waker = Waker::from(Arc::new(ForwardWake {
                target: context.waker().clone(),
                count: count.clone(),
            }));
            future.as_mut().poll(&mut Context::from_waker(&waker))
        }),
    )
    .await
    .expect("the active source must wake before the test watchdog")
}

#[test]
fn never_waking_database_future_is_interrupted_by_real_timer() {
    runtime().block_on(async {
        let source = ActiveReadInterruptV1::new().unwrap();
        let execution = control(&source, source.monotonic() + Duration::from_millis(50));
        let count = Arc::new(AtomicUsize::new(0));
        let mut was_pending = false;
        let wait = execution.wait(
            ReadStageV1::Execute,
            &mut was_pending,
            pending::<Result<(), DatabaseFailureV1>>(),
        );
        // Constructing either the source or the unpolled wait does not register a timer.
        assert!(source.state.lock().unwrap().timer.is_none());
        assert_eq!(
            counted(wait, count.clone()).await,
            Err(RunnerErrorV1::TimedOut)
        );
        assert!(was_pending);
        assert!(count.load(Ordering::SeqCst) > 0);
    });
}

#[test]
fn explicit_cancel_wakes_pending_database_and_disarms_timer() {
    runtime().block_on(async {
        let source = Arc::new(ActiveReadInterruptV1::new().unwrap());
        let execution = control(&source, source.monotonic() + WATCHDOG + WATCHDOG);
        let count = Arc::new(AtomicUsize::new(0));
        let cancel_source = source.clone();
        // This joined task is a test caller. The source itself never spawns a task or thread.
        let cancellation = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(20)).await;
            cancel_source.cancel();
        });
        let mut was_pending = false;
        assert_eq!(
            counted(
                execution.wait(
                    ReadStageV1::Execute,
                    &mut was_pending,
                    pending::<Result<(), DatabaseFailureV1>>(),
                ),
                count.clone(),
            )
            .await,
            Err(RunnerErrorV1::Cancelled),
        );
        cancellation.await.unwrap();
        assert!(was_pending);
        assert!(count.load(Ordering::SeqCst) > 0);
        source.cancel();
        let state = source.state.lock().unwrap();
        assert!(state.timer.is_none());
        assert!(state.waiter.is_none());
    });
}

#[test]
fn registration_racing_cancel_never_loses_wakeup_or_retains_timer() {
    runtime().block_on(async {
        for _ in 0..32 {
            let source = Arc::new(ActiveReadInterruptV1::new().unwrap());
            let barrier = Arc::new(Barrier::new(2));
            let count = Arc::new(AtomicUsize::new(0));
            let waker = Waker::from(Arc::new(CountingWake(count.clone())));
            std::thread::scope(|scope| {
                let cancel_source = source.clone();
                let cancel_barrier = barrier.clone();
                let cancelling = scope.spawn(move || {
                    cancel_barrier.wait();
                    cancel_source.cancel();
                });
                barrier.wait();
                source.register_waker(&waker, WATCHDOG).unwrap();
                cancelling.join().unwrap();
            });
            assert!(source.cancelled());
            assert!(count.load(Ordering::SeqCst) > 0);
            let state = source.state.lock().unwrap();
            assert!(state.timer.is_none());
            assert!(state.waiter.is_none());
        }
    });
}

#[test]
fn cancellation_before_registration_is_immediately_observable() {
    runtime().block_on(async {
        let source = ActiveReadInterruptV1::new().unwrap();
        source.cancel();
        let count = Arc::new(AtomicUsize::new(0));
        let waker = Waker::from(Arc::new(CountingWake(count.clone())));
        source.register_waker(&waker, WATCHDOG).unwrap();
        assert_eq!(count.load(Ordering::SeqCst), 1);
        assert!(source.cancelled());
        assert!(source.state.lock().unwrap().timer.is_none());
    });
}

#[test]
fn projected_deadline_can_only_shorten_and_still_actively_wakes() {
    runtime().block_on(async {
        let source = ActiveReadInterruptV1::new().unwrap();
        let count = Arc::new(AtomicUsize::new(0));
        let waker = Waker::from(Arc::new(CountingWake(count.clone())));
        let earlier = source.monotonic() + Duration::from_millis(50);
        source.register_waker(&waker, earlier + WATCHDOG).unwrap();
        source.register_waker(&waker, earlier).unwrap();
        source
            .register_waker(&waker, earlier + WATCHDOG + WATCHDOG)
            .unwrap();
        assert_eq!(source.state.lock().unwrap().deadline, Some(earlier));
        let execution = control(&source, earlier);
        let mut was_pending = false;
        let active_wakes = Arc::new(AtomicUsize::new(0));
        assert_eq!(
            counted(
                execution.wait(
                    ReadStageV1::Prepare,
                    &mut was_pending,
                    pending::<Result<(), DatabaseFailureV1>>(),
                ),
                active_wakes.clone(),
            )
            .await,
            Err(RunnerErrorV1::TimedOut),
        );
        assert!(was_pending);
        assert!(active_wakes.load(Ordering::SeqCst) > 0);
        // Even registration after expiry keeps the original earlier deadline.
        source
            .register_waker(&waker, source.monotonic() + WATCHDOG)
            .unwrap();
        assert_eq!(source.state.lock().unwrap().deadline, Some(earlier));
    });
}

#[test]
fn dropping_source_unregisters_timer_and_releases_retained_wakers() {
    runtime().block_on(async {
        let source = ActiveReadInterruptV1::new().unwrap();
        let count = Arc::new(AtomicUsize::new(0));
        let wake = Arc::new(CountingWake(count.clone()));
        let weak = Arc::downgrade(&wake);
        let waker = Waker::from(wake);
        source
            .register_waker(&waker, source.monotonic() + Duration::from_millis(30))
            .unwrap();
        assert!(source.state.lock().unwrap().timer.is_some());
        drop(waker);
        assert!(weak.upgrade().is_some());
        drop(source);
        assert!(weak.upgrade().is_none());
        tokio::time::sleep(Duration::from_millis(60)).await;
        assert_eq!(count.load(Ordering::SeqCst), 0);
    });
}

#[test]
fn missing_runtime_rejects_construction() {
    assert!(matches!(
        ActiveReadInterruptV1::new(),
        Err(RunnerErrorV1::InterruptUnavailable),
    ));
}

#[test]
fn runtime_without_time_fails_closed_at_registration_without_escaping_panic() {
    let runtime = Builder::new_current_thread().build().unwrap();
    runtime.block_on(async {
        let source = ActiveReadInterruptV1::new().unwrap();
        let waker = Waker::from(Arc::new(CountingWake(Arc::new(AtomicUsize::new(0)))));
        // Tokio itself panics when Sleep is constructed without a time driver. This test verifies
        // the narrow source boundary catches that panic without changing the global panic hook.
        assert_eq!(
            source.register_waker(&waker, WATCHDOG),
            Err(RunnerErrorV1::InterruptUnavailable)
        );
        assert_eq!(
            source.register_waker(&waker, WATCHDOG),
            Err(RunnerErrorV1::InterruptUnavailable)
        );
        assert!(source.cancelled());
        let state = source.state.lock().unwrap();
        assert!(state.unavailable);
        assert!(state.timer.is_none());
        assert!(state.waiter.is_none());
    });
}

#[test]
fn deadline_overflow_latches_data_free_failure() {
    runtime().block_on(async {
        let source = ActiveReadInterruptV1::new().unwrap();
        let waker = Waker::from(Arc::new(CountingWake(Arc::new(AtomicUsize::new(0)))));
        assert_eq!(
            source.register_waker(&waker, Duration::MAX),
            Err(RunnerErrorV1::InterruptUnavailable)
        );
        assert_eq!(
            source.register_waker(&waker, WATCHDOG),
            Err(RunnerErrorV1::InterruptUnavailable)
        );
        assert!(source.cancelled());
        assert!(source.state.lock().unwrap().timer.is_none());
    });
}

#[test]
fn poisoned_mutex_fails_closed_and_disarms_without_panicking_on_cancel_or_drop() {
    runtime().block_on(async {
        let source = ActiveReadInterruptV1::new().unwrap();
        let count = Arc::new(AtomicUsize::new(0));
        let waker = Waker::from(Arc::new(CountingWake(count.clone())));
        source.register_waker(&waker, WATCHDOG).unwrap();
        let poisoned = catch_unwind(AssertUnwindSafe(|| {
            let _held = source.state.lock().unwrap();
            panic!("test poison");
        }));
        assert!(poisoned.is_err());
        assert_eq!(
            source.register_waker(&waker, WATCHDOG),
            Err(RunnerErrorV1::InterruptUnavailable)
        );
        assert!(source.cancelled());
        assert!(count.load(Ordering::SeqCst) > 0);
        source.cancel();
        let state = source
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        assert!(state.timer.is_none());
        assert!(state.waiter.is_none());
        drop(state);
        drop(source);
    });
}
