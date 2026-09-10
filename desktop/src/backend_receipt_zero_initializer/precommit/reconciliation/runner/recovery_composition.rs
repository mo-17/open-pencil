//! Private test-only restart composition. No renderer material, SQL, parameters, credential,
//! caller deadline, prepared contract, or interchangeable live-writer authority enters this path.

use super::{
    DatabaseConnectorV1, ExecutionControlV1, InterruptSourceV1, ReadObservationV1,
    ReceiptZeroReadContractV1, RunnerErrorV1,
};
use crate::backend_operation_journal::{
    BackendOperationJournalV1, ReceiptZeroInitializerJournalRecoveryV1,
};

/// Construction and unpolled drop are inert. The first poll fixes the connector-clock deadline,
/// consumes the opaque recovery and durable lease, derives the read exclusively from journal-owned
/// material, and burns the exact read window under its original journal clocks. There is no await
/// gap before entering the independently owned sealed connector, and no authority token escapes.
pub(super) async fn run_recovered_fixed_read_for_test<C: DatabaseConnectorV1>(
    journal: &BackendOperationJournalV1,
    recovery: ReceiptZeroInitializerJournalRecoveryV1,
    connector: C,
    interrupts: &dyn InterruptSourceV1,
) -> Result<ReadObservationV1, RunnerErrorV1> {
    let execution = ExecutionControlV1::start_for_test(interrupts)?;
    let permit = journal.begin_receipt_zero_initializer_reconciliation_for_test(recovery)?;
    let window = journal.consume_receipt_zero_initializer_reconciliation_for_test(permit)?;
    let contract = ReceiptZeroReadContractV1::from_material_for_test(window.material_for_test())?;
    let ceiling =
        journal.consume_receipt_zero_initializer_read_run_window_for_execution_for_test(window)?;
    let execution = execution.bind_read_ceiling_for_test(ceiling)?;
    contract.run(connector, &execution).await
}
