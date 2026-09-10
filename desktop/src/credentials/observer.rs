//! Local, secret-free revocation observations for one vault instance and its clones.
//!
//! Registry entries are weak and bounded. Observers retain only static account names, revocation
//! state, and a task waker. They grant no credential read or execution authority. Independent
//! vault instances and other processes do not share this registry; callers still recheck disk.

#![allow(dead_code)] // Registration currently has only the test-gated fixed-read consumer.

use super::{validate_account, BackendError, CredentialVaultSnapshotError};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, Weak,
    },
    task::Waker,
};

const MAX_OBSERVED_ACCOUNTS: usize = 8;
const MAX_LIVE_OBSERVERS: usize = 128;

#[derive(Clone)]
pub(crate) struct CredentialVaultSnapshotObserverV1 {
    state: Arc<ObserverState>,
}

struct ObserverState {
    accounts: Box<[&'static str]>,
    revoked: AtomicBool,
    waker: Mutex<Option<Waker>>,
    registry: Arc<CredentialVaultObserverRegistry>,
}

impl CredentialVaultSnapshotObserverV1 {
    /// A local nonblocking check. A poisoned observation/registry also fails closed.
    pub(crate) fn is_revoked(&self) -> bool {
        self.state.is_revoked()
    }

    /// One active runner owns the registration; clones share that same waiter and revocation.
    /// Cloning/dropping a waker can invoke executor code, so neither happens while locked.
    pub(crate) fn register_waker(&self, waker: &Waker) -> Result<(), CredentialVaultSnapshotError> {
        let mut incoming = Some(waker.clone());
        let (previous, wake_previous) = {
            let mut slot = match self.state.waker.lock() {
                Ok(slot) => slot,
                Err(poisoned) => {
                    self.state.revoked.store(true, Ordering::Release);
                    poisoned.into_inner()
                }
            };
            if self.is_revoked() {
                (slot.take(), true)
            } else {
                (std::mem::replace(&mut *slot, incoming.take()), false)
            }
        };
        if wake_previous {
            if let Some(previous) = previous {
                previous.wake();
            }
        } else {
            drop(previous);
        }
        drop(incoming);
        if self.is_revoked() {
            Err(CredentialVaultSnapshotError::Failed)
        } else {
            Ok(())
        }
    }
}

impl ObserverState {
    fn is_revoked(&self) -> bool {
        self.revoked.load(Ordering::Acquire)
            || self.waker.is_poisoned()
            || self.registry.is_failed()
    }

    fn revoke(&self) -> Option<Waker> {
        self.revoked.store(true, Ordering::Release);
        self.waker
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take()
    }
}

pub(super) struct CredentialVaultObserverRegistry {
    entries: Mutex<Vec<Weak<ObserverState>>>,
}

impl CredentialVaultObserverRegistry {
    pub(super) fn new() -> Self {
        Self {
            entries: Mutex::new(Vec::new()),
        }
    }

    pub(super) fn is_failed(&self) -> bool {
        self.entries.is_poisoned()
    }

    pub(super) fn validate_accounts<const N: usize>(
        accounts: &[&'static str; N],
    ) -> Result<(), BackendError> {
        if N == 0
            || N > MAX_OBSERVED_ACCOUNTS
            || accounts.iter().enumerate().any(|(index, account)| {
                validate_account(account).is_err() || accounts[..index].contains(account)
            })
        {
            return Err(BackendError::Failed);
        }
        Ok(())
    }

    /// Called while the vault's process/file locks still protect the matching snapshot.
    /// The caller must retain `deferred` until after those locks have been released.
    pub(super) fn register<const N: usize>(
        self: &Arc<Self>,
        accounts: [&'static str; N],
        deferred: &mut DeferredObserverNotifications,
    ) -> Result<CredentialVaultSnapshotObserverV1, BackendError> {
        let first = deferred.states.len();
        let result = {
            let mut entries = self
                .entries
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            entries.retain(|entry| match entry.upgrade() {
                Some(state) => {
                    let live = !state.is_revoked();
                    // This upgrade may be the last strong reference. Keep it until no vault
                    // lock remains, so dropping its stored waker cannot reenter a held lock.
                    deferred.states.push(state);
                    live
                }
                None => false,
            });
            if self.is_failed() || entries.len() >= MAX_LIVE_OBSERVERS {
                Err(BackendError::Failed)
            } else {
                let state = Arc::new(ObserverState {
                    accounts: accounts.into(),
                    revoked: AtomicBool::new(false),
                    waker: Mutex::new(None),
                    registry: Arc::clone(self),
                });
                entries.push(Arc::downgrade(&state));
                Ok(CredentialVaultSnapshotObserverV1 { state })
            }
        };
        if self.is_failed() {
            for state in &deferred.states[first..] {
                if let Some(waker) = state.revoke() {
                    deferred.wakers.push(waker);
                }
            }
        }
        result
    }

    /// Mark before any mutation, regardless of same-value replacement, no-op removal, conflict,
    /// or later I/O failure. Wakeups and all upgraded strong references remain deferred.
    pub(super) fn revoke_accounts(
        &self,
        accounts: &[&str],
        deferred: &mut DeferredObserverNotifications,
    ) {
        let first = deferred.states.len();
        {
            let mut entries = self
                .entries
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            entries.retain(|entry| match entry.upgrade() {
                Some(state) => {
                    let live = !state.is_revoked();
                    deferred.states.push(state);
                    live
                }
                None => false,
            });
        }
        for state in &deferred.states[first..] {
            if self.is_failed() || state.accounts.iter().any(|name| accounts.contains(name)) {
                if let Some(waker) = state.revoke() {
                    deferred.wakers.push(waker);
                }
            }
        }
    }
}

/// Must be constructed outside `with_store`, then dropped only after every vault/registry/observer
/// lock is released. This also preserves that order if the storage operation unwinds.
#[derive(Default)]
pub(super) struct DeferredObserverNotifications {
    states: Vec<Arc<ObserverState>>,
    wakers: Vec<Waker>,
}

impl Drop for DeferredObserverNotifications {
    fn drop(&mut self) {
        for waker in self.wakers.drain(..) {
            waker.wake();
        }
        // The strong states (and any remaining stored wakers) drop after this method returns.
    }
}

#[cfg(test)]
mod tests;
