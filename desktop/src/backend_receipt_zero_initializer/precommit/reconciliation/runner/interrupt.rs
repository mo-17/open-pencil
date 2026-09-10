//! Host-owned active wakeups for one fixed read. This source owns a Tokio timer, never a worker,
//! detached task, database handle or authority issuer. Construction does not register a timer;
//! the first runner poll registers it, and dropping the source unregisters it immediately.

use super::{InterruptSourceV1, RunnerErrorV1};
use std::{
    future::Future,
    panic::{catch_unwind, AssertUnwindSafe},
    pin::Pin,
    sync::Mutex,
    task::{Context, Poll, Waker},
    time::{Duration, Instant},
};
use tokio::{runtime::Handle, time::Sleep};

struct InterruptStateV1 {
    timer: Option<Pin<Box<Sleep>>>,
    deadline: Option<Duration>,
    waiter: Option<Waker>,
    cancelled: bool,
    unavailable: bool,
}

pub(super) struct ActiveReadInterruptV1 {
    origin: Instant,
    runtime: Handle,
    state: Mutex<InterruptStateV1>,
}

impl ActiveReadInterruptV1 {
    pub(super) fn new() -> Result<Self, RunnerErrorV1> {
        let runtime = Handle::try_current().map_err(|_| RunnerErrorV1::InterruptUnavailable)?;
        Ok(Self {
            origin: Instant::now(),
            runtime,
            state: Mutex::new(InterruptStateV1 {
                timer: None,
                deadline: None,
                waiter: None,
                cancelled: false,
                unavailable: false,
            }),
        })
    }

    /// Cancellation is local and idempotent. Wake outside the mutex so the executor may immediately
    /// poll the runner without reentering this lock. A poisoned source still cancels and disarms.
    pub(super) fn cancel(&self) {
        let (timer, waiter) = {
            let mut state = self.state.lock().unwrap_or_else(|poisoned| {
                let mut state = poisoned.into_inner();
                state.unavailable = true;
                state
            });
            state.cancelled = true;
            (state.timer.take(), state.waiter.take())
        };
        drop(timer);
        if let Some(waiter) = waiter {
            waiter.wake();
        }
    }
}

impl InterruptSourceV1 for ActiveReadInterruptV1 {
    fn monotonic(&self) -> Duration {
        self.origin.elapsed()
    }

    fn cancelled(&self) -> bool {
        // The trait's boolean health read cannot return an error. Registration reports the
        // precise data-free failure; a later final check must still fail closed after poisoning.
        self.state
            .lock()
            .map_or(true, |state| state.cancelled || state.unavailable)
    }

    fn register_waker(&self, waker: &Waker, requested: Duration) -> Result<(), RunnerErrorV1> {
        let next_waiter = waker.clone();
        let mut state = match self.state.lock() {
            Ok(state) => state,
            Err(poisoned) => {
                let mut state = poisoned.into_inner();
                state.unavailable = true;
                let timer = state.timer.take();
                let waiter = state.waiter.take();
                drop(state);
                drop(timer);
                if let Some(waiter) = waiter {
                    waiter.wake();
                }
                return Err(RunnerErrorV1::InterruptUnavailable);
            }
        };
        if state.unavailable {
            return Err(RunnerErrorV1::InterruptUnavailable);
        }
        if state.cancelled {
            drop(state);
            next_waiter.wake();
            return Ok(());
        }
        let deadline = state
            .deadline
            .map_or(requested, |prior| prior.min(requested));
        let Some(absolute) = self.origin.checked_add(deadline) else {
            state.unavailable = true;
            let timer = state.timer.take();
            let waiter = state.waiter.take();
            drop(state);
            drop(timer);
            drop(waiter);
            return Err(RunnerErrorV1::InterruptUnavailable);
        };
        let changed = state.deadline != Some(deadline);
        state.deadline = Some(deadline);
        let previous_waiter = state.waiter.replace(next_waiter);
        // Tokio has no public "time driver enabled" query. Handle::try_current excludes a missing
        // runtime, while a runtime without enable_time (or a shut-down driver) may panic while
        // constructing/polling Sleep. Catch only this timer boundary, retain no panic payload, and
        // permanently fail closed. Never replace the process-wide panic hook.
        let result = catch_unwind(AssertUnwindSafe(|| {
            let _entered = self.runtime.enter();
            match &mut state.timer {
                Some(timer) if changed => {
                    timer
                        .as_mut()
                        .reset(tokio::time::Instant::from_std(absolute));
                }
                None => {
                    state.timer = Some(Box::pin(tokio::time::sleep_until(
                        tokio::time::Instant::from_std(absolute),
                    )));
                }
                _ => {}
            }
            state
                .timer
                .as_mut()
                .expect("the timer was just installed")
                .as_mut()
                .poll(&mut Context::from_waker(waker))
        }));
        let (timer, wake, error) = match result {
            Ok(Poll::Pending) => (None, None, None),
            Ok(Poll::Ready(())) => (state.timer.take(), state.waiter.take(), None),
            Err(_) => {
                state.unavailable = true;
                (
                    state.timer.take(),
                    state.waiter.take(),
                    Some(RunnerErrorV1::InterruptUnavailable),
                )
            }
        };
        drop(state);
        drop(timer);
        drop(previous_waiter);
        if let Some(wake) = wake {
            wake.wake();
        }
        error.map_or(Ok(()), Err)
    }
}

impl Drop for ActiveReadInterruptV1 {
    fn drop(&mut self) {
        let state = self
            .state
            .get_mut()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        // Sleep's Drop unregisters its timer entry and releases its retained task waker.
        // No task or thread was spawned, so there is nothing to detach, join or asynchronously reap.
        drop(state.timer.take());
        drop(state.waiter.take());
    }
}

#[cfg(test)]
mod tests;
