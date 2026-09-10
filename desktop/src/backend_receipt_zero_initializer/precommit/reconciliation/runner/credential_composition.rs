//! Test-only Host credential integration for the recovered fixed read.
//!
//! Vault reads run outside executor polling. Admission and final revalidation share the original
//! execution control, including its journal clock ceiling; neither can restart the read budget.
//! A started blocking vault read cannot be force-stopped, but its late result is discarded and
//! cannot reach a connector or escape as an observation. Only temporary fixture vaults are used
//! until a separately reviewed production entry point and database adapter exist.

use super::{
    DatabaseConnectorV1, ExecutionControlV1, InterruptSourceV1, ReadObservationV1,
    ReceiptZeroReadContractV1, RunnerErrorV1,
};
use crate::{
    backend_operation_journal::{
        BackendOperationJournalV1, ReceiptZeroInitializerJournalRecoveryV1,
    },
    credentials::CredentialVault,
    supabase_backfill_fixed_read::{
        DatabaseReadCredentialAdmissionErrorV1, DatabaseReadCredentialAdmissionV1,
        DatabaseReadCredentialConnectionInputsV1,
    },
};
use std::{future::poll_fn, pin::Pin, task::Poll};

pub(super) mod sealed {
    pub(in super::super) trait Factory {}
}

/// The factory only constructs an inert connector borrowing Host-owned connection inputs. It
/// must perform no I/O or retain a credential copy. The connector is dropped before the admission
/// is consumed by the final vault check. This is local profile consistency, not remote authority.
pub(super) trait CredentialBoundConnectorFactoryV1: sealed::Factory + Send + Sync {
    type Connector<'a>: DatabaseConnectorV1
    where
        Self: 'a;

    fn bind<'a>(
        &'a self,
        inputs: DatabaseReadCredentialConnectionInputsV1<'a>,
    ) -> Result<Self::Connector<'a>, RunnerErrorV1>;
}

struct BlockingCredentialRead<T> {
    handle: tokio::task::JoinHandle<Result<T, DatabaseReadCredentialAdmissionErrorV1>>,
}

impl<T> Drop for BlockingCredentialRead<T> {
    fn drop(&mut self) {
        // Abort prevents a queued task starting. A task already holding a vault lock is read-only;
        // Tokio drops its output after it finishes, including any zeroizing credential values.
        self.handle.abort();
    }
}

pub(super) async fn wait_for_credential<T: Send + 'static>(
    execution: &ExecutionControlV1<'_>,
    read: impl FnOnce() -> Result<T, DatabaseReadCredentialAdmissionErrorV1> + Send + 'static,
) -> Result<T, RunnerErrorV1> {
    execution.require_ready()?;
    let runtime = tokio::runtime::Handle::try_current()
        .map_err(|_| RunnerErrorV1::CredentialTaskUnavailable)?;
    let mut read = Some(read);
    let mut task = None;
    let result = poll_fn(|context| {
        execution.require_ready()?;
        execution
            .source
            .register_waker(context.waker(), execution.deadline)?;
        execution.require_ready()?;
        // Even a cancellation raised while registering the first wakeup must prevent the
        // blocking snapshot from being scheduled. Later polls retain this same owned task.
        let task = task.get_or_insert_with(|| BlockingCredentialRead {
            handle: runtime.spawn_blocking(read.take().expect("one credential read task")),
        });
        match std::future::Future::poll(Pin::new(&mut task.handle), context) {
            Poll::Pending => Poll::Pending,
            Poll::Ready(result) => Poll::Ready(
                result
                    .map_err(|_| RunnerErrorV1::CredentialTaskUnavailable)
                    .and_then(|result| result.map_err(RunnerErrorV1::Credential)),
            ),
        }
    })
    .await?;
    execution.require_ready()?;
    Ok(result)
}

/// No caller credential, endpoint, grant generation or expected project/account enters the
/// composition. Only the opaque journal recovery supplies expected local identity. The current
/// database credential generation is independently captured from the five-record vault snapshot.
pub(super) async fn run_credential_bound_recovered_read_for_test<
    F: CredentialBoundConnectorFactoryV1,
>(
    journal: &BackendOperationJournalV1,
    recovery: ReceiptZeroInitializerJournalRecoveryV1,
    vault: CredentialVault,
    factory: F,
    interrupts: &dyn InterruptSourceV1,
) -> Result<ReadObservationV1, RunnerErrorV1> {
    let execution = ExecutionControlV1::start_for_test(interrupts)?;
    let permit = journal.begin_receipt_zero_initializer_reconciliation_for_test(recovery)?;
    let window = journal.consume_receipt_zero_initializer_reconciliation_for_test(permit)?;
    let material = window.material_for_test();
    let project_ref = material.installed.project_ref.clone();
    let account_id = material.installed.account_id.clone();
    let contract = ReceiptZeroReadContractV1::from_material_for_test(material)?;
    let ceiling =
        journal.consume_receipt_zero_initializer_read_run_window_for_execution_for_test(window)?;
    let execution = execution.bind_read_ceiling_for_test(ceiling)?;
    let admission = wait_for_credential(&execution, move || {
        DatabaseReadCredentialAdmissionV1::admit_for_test(vault, &project_ref, &account_id)
    })
    .await?;
    let connector = factory.bind(admission.connection_inputs_for_test())?;
    execution.require_ready()?;
    let observation = contract.run(connector, &execution).await?;
    wait_for_credential(&execution, move || admission.finish_for_test()).await?;
    execution.require_ready()?;
    Ok(observation)
}
