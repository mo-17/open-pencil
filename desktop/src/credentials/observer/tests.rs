use super::super::{
    persist_vault_with_directory_sync, CredentialBackend, CredentialVault,
    CredentialVaultCommitDurability, CredentialVaultCompareExchangeError,
    CredentialVaultRecordMutation,
};
use super::*;
use std::sync::atomic::AtomicUsize;
use std::task::Wake;

const PASSWORD: &str = "v1:supabase-database-read:default:password";
const INCARNATION: &str = "v1:supabase-database-read:default:credential-incarnation";
const PROFILE: &str = "v1:supabase-database-read:default:connection-profile";
const PROFILE_DIGEST: &str = "v1:supabase-database-read:default:connection-profile-digest";
const GRANT: &str = "v1:supabase-management:default:grant-generation";
const UNRELATED: &str = "v1:google-drive:default:refresh-token";
const ACCOUNTS: [&str; 5] = [PASSWORD, INCARNATION, PROFILE, PROFILE_DIGEST, GRANT];

fn vault(directory: &tempfile::TempDir) -> CredentialVault {
    let vault = CredentialVault::new(directory.path().to_path_buf());
    for account in ACCOUNTS {
        vault.write(account, "fixture-a").unwrap();
    }
    vault
}

fn observe(vault: &CredentialVault) -> CredentialVaultSnapshotObserverV1 {
    let (values, observer) = vault.read_secret_snapshot_observed(ACCOUNTS).unwrap();
    assert!(values.iter().all(Option::is_some));
    assert!(!observer.is_revoked());
    observer
}

#[derive(Default)]
struct CountWakes(AtomicUsize);
impl Wake for CountWakes {
    fn wake(self: Arc<Self>) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
}

#[test]
fn every_fixed_account_write_including_management_grant_revokes_only_matching_observers() {
    for account in ACCOUNTS {
        let directory = tempfile::tempdir().unwrap();
        let vault = vault(&directory);
        let observed = observe(&vault);
        let clone = observed.clone();
        let (_, unrelated) = vault.read_secret_snapshot_observed([UNRELATED]).unwrap();
        let wakes = Arc::new(CountWakes::default());
        observed
            .register_waker(&Waker::from(wakes.clone()))
            .unwrap();
        vault.clone().write(account, "fixture-b").unwrap();
        assert!(observed.is_revoked());
        assert!(clone.is_revoked());
        assert!(!unrelated.is_revoked());
        assert_eq!(wakes.0.load(Ordering::SeqCst), 1);
        assert!(observed.register_waker(&Waker::noop()).is_err());
    }
}

#[test]
fn same_value_write_and_same_instance_aba_never_revive_an_observer() {
    let directory = tempfile::tempdir().unwrap();
    let vault = vault(&directory);
    let same = observe(&vault);
    vault.write(PASSWORD, "fixture-a").unwrap();
    assert!(same.is_revoked());
    let aba = observe(&vault);
    let before = vault.read_secret_snapshot(ACCOUNTS).unwrap();
    vault.clone().write(GRANT, "fixture-b").unwrap();
    vault.write(GRANT, "fixture-a").unwrap();
    let after = vault.read_secret_snapshot(ACCOUNTS).unwrap();
    assert!(before
        .iter()
        .zip(&after)
        .all(|(a, b)| a.as_deref() == b.as_deref()));
    assert!(aba.is_revoked());
    assert!(!observe(&vault).is_revoked());
}

#[test]
fn unrelated_provider_changes_do_not_revoke_database_read_observation() {
    let directory = tempfile::tempdir().unwrap();
    let vault = vault(&directory);
    let observed = observe(&vault);
    vault.write(UNRELATED, "unrelated-fixture").unwrap();
    vault.remove(UNRELATED).unwrap();
    assert!(!observed.is_revoked());
}

#[test]
fn matching_remove_and_absent_record_remove_both_revoke() {
    let directory = tempfile::tempdir().unwrap();
    let vault = vault(&directory);
    let observed = observe(&vault);
    vault.remove(PASSWORD).unwrap();
    assert!(observed.is_revoked());
    let (values, absent) = vault.read_secret_snapshot_observed([PASSWORD]).unwrap();
    assert!(values[0].is_none());
    vault.remove(PASSWORD).unwrap();
    assert!(absent.is_revoked());
}

#[test]
fn compare_exchange_success_and_conflict_conservatively_revoke_the_fixed_set() {
    for conflict in [false, true] {
        let directory = tempfile::tempdir().unwrap();
        let vault = vault(&directory);
        let observed = observe(&vault);
        let (_, unrelated) = vault.read_secret_snapshot_observed([UNRELATED]).unwrap();
        let result = vault.compare_exchange_secret_records(
            GRANT,
            if conflict {
                "stale-fixture"
            } else {
                "fixture-a"
            },
            &[
                CredentialVaultRecordMutation::write(GRANT, "fixture-b"),
                CredentialVaultRecordMutation::write(PASSWORD, "fixture-a"),
            ],
        );
        if conflict {
            assert_eq!(result, Err(CredentialVaultCompareExchangeError::Conflict));
        } else {
            assert_eq!(result, Ok(CredentialVaultCommitDurability::Confirmed));
        }
        assert!(observed.is_revoked());
        assert!(!unrelated.is_revoked());
    }
}

#[test]
fn failed_persistence_and_unconfirmed_rename_keep_observers_revoked() {
    for unconfirmed in [false, true] {
        let directory = tempfile::tempdir().unwrap();
        let vault = vault(&directory);
        let observed = observe(&vault);
        let result = vault.compare_exchange_secret_records_with_persist(
            GRANT,
            "fixture-a",
            &[CredentialVaultRecordMutation::write(GRANT, "fixture-b")],
            |root, changed| {
                if unconfirmed {
                    persist_vault_with_directory_sync(root, changed, |_| Err(BackendError::Failed))
                } else {
                    Err(BackendError::Failed)
                }
            },
        );
        assert!(observed.is_revoked());
        let current = vault.read_secret_snapshot([GRANT]).unwrap();
        if unconfirmed {
            assert_eq!(result, Ok(CredentialVaultCommitDurability::Unconfirmed));
            assert_eq!(current[0].as_deref().map(String::as_str), Some("fixture-b"));
        } else {
            assert_eq!(result, Err(CredentialVaultCompareExchangeError::Failed));
            assert_eq!(current[0].as_deref().map(String::as_str), Some("fixture-a"));
        }
    }
}

#[test]
fn a_store_open_failure_still_revokes_and_wakes_before_taking_store_locks() {
    let directory = tempfile::tempdir().unwrap();
    let vault = vault(&directory);
    let observed = observe(&vault);
    let wakes = Arc::new(CountWakes::default());
    observed
        .register_waker(&Waker::from(wakes.clone()))
        .unwrap();
    let store = directory.path().join("credentials");
    std::fs::rename(&store, directory.path().join("preserved-fixture")).unwrap();
    std::fs::write(&store, b"blocked fixture directory").unwrap();
    assert!(vault.write(PASSWORD, "fixture-b").is_err());
    assert!(observed.is_revoked());
    assert_eq!(wakes.0.load(Ordering::SeqCst), 1);
}

#[test]
fn second_invalidation_catches_a_snapshot_registered_by_the_first_wakeup() {
    struct RegisterOnWake {
        vault: CredentialVault,
        next: Arc<Mutex<Option<CredentialVaultSnapshotObserverV1>>>,
        next_wakes: Arc<CountWakes>,
    }
    impl Wake for RegisterOnWake {
        fn wake(self: Arc<Self>) {
            // The first wake runs before the mutation takes its process/file locks. This fresh
            // snapshot sees old values and must therefore be caught by the in-lock revocation.
            let (values, observer) = self.vault.read_secret_snapshot_observed(ACCOUNTS).unwrap();
            assert_eq!(values[0].as_deref().map(String::as_str), Some("fixture-a"));
            observer
                .register_waker(&Waker::from(self.next_wakes.clone()))
                .unwrap();
            *self.next.lock().unwrap() = Some(observer);
        }
    }
    let directory = tempfile::tempdir().unwrap();
    let vault = vault(&directory);
    let observed = observe(&vault);
    let next = Arc::new(Mutex::new(None));
    let next_wakes = Arc::new(CountWakes::default());
    observed
        .register_waker(&Waker::from(Arc::new(RegisterOnWake {
            vault: vault.clone(),
            next: next.clone(),
            next_wakes: next_wakes.clone(),
        })))
        .unwrap();
    vault.write(PASSWORD, "fixture-b").unwrap();
    assert!(observed.is_revoked());
    assert!(next.lock().unwrap().as_ref().unwrap().is_revoked());
    assert_eq!(next_wakes.0.load(Ordering::SeqCst), 1);
}

#[test]
fn wake_and_replaced_waker_drop_reenter_only_after_all_observer_and_vault_locks_release() {
    struct CheckLocks {
        vault: CredentialVault,
        observer: Weak<ObserverState>,
        callbacks: Arc<AtomicUsize>,
    }
    impl CheckLocks {
        fn check(&self) {
            assert!(self.vault.process_lock.try_lock().is_ok());
            assert!(self.vault.observers.entries.try_lock().is_ok());
            if let Some(observer) = self.observer.upgrade() {
                assert!(observer.waker.try_lock().is_ok());
            }
            self.callbacks.fetch_add(1, Ordering::SeqCst);
        }
    }
    impl Wake for CheckLocks {
        fn wake(self: Arc<Self>) {
            self.check();
        }
    }
    impl Drop for CheckLocks {
        fn drop(&mut self) {
            self.check();
        }
    }
    let directory = tempfile::tempdir().unwrap();
    let vault = vault(&directory);
    let observed = observe(&vault);
    let callbacks = Arc::new(AtomicUsize::new(0));
    observed
        .register_waker(&Waker::from(Arc::new(CheckLocks {
            vault: vault.clone(),
            observer: Arc::downgrade(&observed.state),
            callbacks: callbacks.clone(),
        })))
        .unwrap();
    // Replacing registration drops the old executor waker outside its mutex.
    observed.register_waker(&Waker::noop()).unwrap();
    assert_eq!(callbacks.load(Ordering::SeqCst), 1);
    observed
        .register_waker(&Waker::from(Arc::new(CheckLocks {
            vault: vault.clone(),
            observer: Arc::downgrade(&observed.state),
            callbacks: callbacks.clone(),
        })))
        .unwrap();
    vault.write(GRANT, "fixture-b").unwrap();
    assert_eq!(callbacks.load(Ordering::SeqCst), 3); // old drop, wake, final waker drop
}

#[test]
fn weak_registry_is_bounded_and_reclaims_dropped_or_revoked_observations() {
    let directory = tempfile::tempdir().unwrap();
    let vault = vault(&directory);
    let mut live: Vec<_> = (0..MAX_LIVE_OBSERVERS).map(|_| observe(&vault)).collect();
    assert!(vault.read_secret_snapshot_observed(ACCOUNTS).is_err());
    live.pop();
    live.push(observe(&vault));
    vault.write(GRANT, "fixture-b").unwrap();
    assert!(live
        .iter()
        .all(CredentialVaultSnapshotObserverV1::is_revoked));
    let fresh = observe(&vault);
    assert!(!fresh.is_revoked());
    assert_eq!(vault.observers.entries.lock().unwrap().len(), 1);
    drop(fresh);
    for _ in 0..(MAX_LIVE_OBSERVERS * 2) {
        drop(observe(&vault));
    }
    assert!(vault.observers.entries.lock().unwrap().len() <= 1);
}

#[test]
fn observation_rejects_unbounded_duplicate_or_invalid_account_sets() {
    let directory = tempfile::tempdir().unwrap();
    let vault = vault(&directory);
    assert!(vault.read_secret_snapshot_observed::<0>([]).is_err());
    assert!(vault.read_secret_snapshot_observed([PASSWORD; 9]).is_err());
    assert!(vault
        .read_secret_snapshot_observed([PASSWORD, PASSWORD])
        .is_err());
    assert!(vault
        .read_secret_snapshot_observed(["invalid account fixture"])
        .is_err());
    assert!(vault.observers.entries.lock().unwrap().is_empty());
}

#[test]
fn independent_vault_instance_is_outside_active_observation_and_disk_still_changes() {
    let directory = tempfile::tempdir().unwrap();
    let vault = vault(&directory);
    let observed = observe(&vault);
    let independent = CredentialVault::new(directory.path().to_path_buf());
    independent.write(PASSWORD, "fixture-b").unwrap();
    assert!(!observed.is_revoked());
    let current = vault.read_secret_snapshot([PASSWORD]).unwrap();
    assert_eq!(current[0].as_deref().map(String::as_str), Some("fixture-b"));
}

#[test]
fn poisoned_registry_or_waker_fails_closed_without_returning_secret_values() {
    for registry in [false, true] {
        let directory = tempfile::tempdir().unwrap();
        let vault = vault(&directory);
        let observed = observe(&vault);
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            if registry {
                let _guard = vault.observers.entries.lock().unwrap();
                panic!("registry poison fixture");
            } else {
                let _guard = observed.state.waker.lock().unwrap();
                panic!("waker poison fixture");
            }
        }));
        assert!(observed.is_revoked());
        assert!(observed.register_waker(&Waker::noop()).is_err());
        if registry {
            assert!(vault.read_secret_snapshot_observed(ACCOUNTS).is_err());
        }
    }
}
