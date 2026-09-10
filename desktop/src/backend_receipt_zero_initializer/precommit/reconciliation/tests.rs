use super::*;
use crate::backend_operation_journal::ReceiptZeroInitializerClaimMaterialV1;

fn material() -> ReceiptZeroInitializerClaimMaterialV1 {
    let mut fixture: serde_json::Value = serde_json::from_slice(include_bytes!(
        "../../../../../tests/fixtures/backend/supabase/receipt-zero-initializer-canonical-v1.json"
    ))
    .unwrap();
    serde_json::from_value(fixture["material"].take()).unwrap()
}

fn contract() -> ReceiptZeroReadContractV1 {
    ReceiptZeroReadContractV1::from_material_for_test(&material()).unwrap()
}

fn digest(value: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(value.as_bytes()))
}

fn parameter(contract: &ReceiptZeroReadContractV1, position: usize) -> String {
    super::super::text(&contract.parameters, position)
        .unwrap()
        .to_owned()
}

fn absent_row(contract: &ReceiptZeroReadContractV1) -> Vec<Option<String>> {
    vec![
        Some(QUERY_VERSION.to_owned()),
        Some(parameter(contract, 9)),
        Some(parameter(contract, 26)),
        Some(parameter(contract, 28)),
        Some(parameter(contract, 20)),
        Some(contract.initial_receipt_outcome.clone()),
        Some("absent".to_owned()),
        Some("t".to_owned()),
        Some("t".to_owned()),
        Some("t".to_owned()),
        Some("0".to_owned()),
        Some("0".to_owned()),
        Some("0".to_owned()),
        Some("0".to_owned()),
        Some("0".to_owned()),
        Some("0".to_owned()),
        Some("0".to_owned()),
        None,
        Some("0".to_owned()),
        Some("0".to_owned()),
        None,
        None,
        Some("f".to_owned()),
        Some("f".to_owned()),
        Some("t".to_owned()),
        Some(contract.historical_marker_digest.clone()),
        Some("170000".to_owned()),
        Some(digest("independent-read-snapshot")),
        Some("2027-01-01T00:00:03.000Z".to_owned()),
    ]
}

fn sink(row: &[Option<String>]) -> Result<ResponseSinkV1, ReadErrorV1> {
    let mut result = ResponseSinkV1::new();
    result.begin_row(row.len())?;
    for ((name, kind, _), value) in RESPONSE_SCHEMA.iter().zip(row) {
        result.push_column(name, *kind, value.as_deref().map(str::as_bytes))?;
    }
    Ok(result)
}

fn decode(row: &[Option<String>]) -> Result<ReadObservationV1, ReadErrorV1> {
    contract().decode(sink(row)?)
}

fn exact_row() -> Vec<Option<String>> {
    let mut row = absent_row(&contract());
    row[6] = Some("exact-replay".to_owned());
    for index in 10..=18 {
        row[index] = Some("1".to_owned());
    }
    row[23] = Some("t".to_owned());
    row
}

fn advanced_row() -> Vec<Option<String>> {
    let mut row = exact_row();
    row[6] = Some("advanced-head".to_owned());
    row[12] = Some("0".to_owned());
    row[14] = Some("2".to_owned());
    row[17] = Some("2".to_owned());
    row[18] = Some("0".to_owned());
    row[19] = Some("2".to_owned());
    row[20] = Some("1".to_owned());
    row[21] = Some("2".to_owned());
    row[22] = Some("t".to_owned());
    row
}

fn assert_no_authority(observation: &ReadObservationV1) {
    assert!(!observation.production_transport_authenticated());
    assert!(!observation.specific_historical_installation_authenticated());
    assert!(!observation.full_portable_receipt_v2_chain_verified());
    assert!(!observation.absent_proves_prior_mutation_stopped());
    assert!(!observation.settlement_authorized());
    assert!(!observation.automatic_retry_allowed());
    assert!(!observation.receipt_v2_issued());
    assert!(!observation.release_authorized());
}

#[test]
fn shared_golden_material_projects_exact_parameters_and_fixed_read_bytes() {
    let material = material();
    let read = ReceiptZeroReadContractV1::from_material_for_test(&material).unwrap();
    assert_eq!(
        read.parameters,
        super::super::parameters_from_initializer_material_for_test(&material).unwrap()
    );
    assert_eq!(read.parameters.len(), 28);
    let source = FixedReadStatementV1.source().unwrap();
    assert_eq!(source.len(), SQL_BYTE_LENGTH);
    assert!(source
        .starts_with("-- OpenPencil Supabase Receipt-zero read-only reconciliation review v1.\n"));
    assert!(source.contains("CROSS JOIN \"classification\";"));
    assert_eq!(STATEMENT_TIMEOUT_MS, 15_000);
    assert_eq!(OVERALL_TIMEOUT, Duration::from_secs(30));
}

#[test]
fn changed_journal_parameter_or_marker_material_cannot_issue_a_read_contract() {
    let mut changed = material();
    changed.transaction.parameters.scope_digest = digest("another-scope");
    assert!(matches!(
        ReceiptZeroReadContractV1::from_material_for_test(&changed),
        Err(ReadErrorV1::Parameters)
    ));
    let mut changed = material();
    changed.installed.marker.push('x');
    assert!(matches!(
        ReceiptZeroReadContractV1::from_material_for_test(&changed),
        Err(ReadErrorV1::Parameters)
    ));
    let mut changed = material();
    changed.transaction.parameter_values_digest = digest("another-parameter-tuple");
    assert!(matches!(
        ReceiptZeroReadContractV1::from_material_for_test(&changed),
        Err(ReadErrorV1::Parameters)
    ));
}

#[test]
fn independently_recomputes_all_five_states_without_minting_authority() {
    let absent = absent_row(&contract());
    let exact = exact_row();
    let advanced = advanced_row();
    let mut corruption = exact.clone();
    corruption[6] = Some("corruption".to_owned());
    corruption[10] = Some("2".to_owned());
    let mut precondition = absent.clone();
    precondition[6] = Some("precondition-failed".to_owned());
    precondition[8] = Some("f".to_owned());
    for (row, expected) in [
        (absent, ReadStateV1::Absent),
        (exact, ReadStateV1::ExactReplay),
        (advanced, ReadStateV1::AdvancedHead),
        (corruption, ReadStateV1::Corruption),
        (precondition, ReadStateV1::PreconditionFailed),
    ] {
        let observation = decode(&row).unwrap();
        assert_eq!(observation.reported_status, expected);
        assert_eq!(observation.status, expected);
        assert!(observation.historical_marker_matches);
        assert!(observation.transaction_read_only);
        assert!(valid_digest(&observation.response_digest));
        assert!(valid_digest(&observation.snapshot_digest));
        assert_no_authority(&observation);
    }
}

#[test]
fn raw_success_status_cannot_override_inconsistent_or_absent_facts() {
    let mut row = absent_row(&contract());
    row[6] = Some("exact-replay".to_owned());
    assert!(matches!(
        decode(&row),
        Err(ReadErrorV1::ReportedStatusMismatch)
    ));
    row[6] = Some("absent".to_owned());
    row[11] = Some("1".to_owned());
    assert!(matches!(decode(&row), Err(ReadErrorV1::InconsistentFacts)));
    let mut row = exact_row();
    row[7] = Some("f".to_owned());
    assert!(matches!(decode(&row), Err(ReadErrorV1::InconsistentFacts)));
}

#[test]
fn advanced_chain_requires_exact_bounds_continuity_and_running_initial_state() {
    let row = advanced_row();
    let (parsed, _) = sink(&row).unwrap().finish().unwrap();
    let facts = ReadFactsV1::decode(&parsed).unwrap();
    assert_eq!(facts.classify(true), ReadStateV1::AdvancedHead);
    assert_eq!(facts.classify(false), ReadStateV1::Corruption);
    for (index, value) in [(19, "1"), (20, "0"), (21, "1"), (22, "f"), (23, "f")] {
        let mut changed = row.clone();
        changed[index] = Some(value.to_owned());
        assert!(decode(&changed).is_err(), "advanced chain field {index}");
    }
    let mut boundary = row.clone();
    for index in [14, 17, 19, 21] {
        boundary[index] = Some("10000".to_owned());
    }
    assert_eq!(decode(&boundary).unwrap().status, ReadStateV1::AdvancedHead);
    for index in [14, 17, 19, 21] {
        boundary[index] = Some("10001".to_owned());
    }
    assert!(matches!(
        decode(&boundary),
        Err(ReadErrorV1::ReportedStatusMismatch)
    ));
}

#[test]
fn marker_drift_and_read_write_observation_only_lower_the_result() {
    for state in [exact_row(), absent_row(&contract()), advanced_row()] {
        let mut changed = state.clone();
        changed[25] = Some(digest("different-installation"));
        let observation = decode(&changed).unwrap();
        assert_eq!(observation.status, ReadStateV1::PreconditionFailed);
        assert!(!observation.historical_marker_matches);
        assert_no_authority(&observation);
        let mut changed = state;
        changed[24] = Some("f".to_owned());
        let observation = decode(&changed).unwrap();
        assert_eq!(observation.status, ReadStateV1::PreconditionFailed);
        assert!(!observation.transaction_read_only);
        assert_no_authority(&observation);
    }
}

#[test]
fn query_scope_receipt_operation_and_initial_state_are_exactly_bound() {
    let row = absent_row(&contract());
    for index in 0..=5 {
        let mut changed = row.clone();
        changed[index] = Some(digest("substitute-binding"));
        assert!(matches!(
            decode(&changed),
            Err(ReadErrorV1::ResponseBinding)
        ));
    }
}

#[test]
fn sink_refuses_wrong_names_types_order_and_nullability_without_recovery() {
    let row = absent_row(&contract());
    for index in 0..RESPONSE_SCHEMA.len() {
        for variant in 0..3 {
            let mut output = ResponseSinkV1::new();
            output.begin_row(RESPONSE_SCHEMA.len()).unwrap();
            for prior in 0..index {
                let (name, kind, _) = RESPONSE_SCHEMA[prior];
                output
                    .push_column(name, kind, row[prior].as_deref().map(str::as_bytes))
                    .unwrap();
            }
            let (name, kind, nullable) = RESPONSE_SCHEMA[index];
            if variant == 2 && nullable {
                continue;
            }
            let result = match variant {
                0 => {
                    output.push_column("wrongName", kind, row[index].as_deref().map(str::as_bytes))
                }
                1 => output.push_column(
                    name,
                    if kind == ColumnTypeV1::Text {
                        ColumnTypeV1::Int4
                    } else {
                        ColumnTypeV1::Text
                    },
                    row[index].as_deref().map(str::as_bytes),
                ),
                _ => output.push_column(name, kind, None),
            };
            assert_eq!(result, Err(ReadErrorV1::ResponseProtocol));
            assert_eq!(
                output.push_column(name, kind, row[index].as_deref().map(str::as_bytes)),
                Err(ReadErrorV1::ResponseProtocol)
            );
            assert!(matches!(
                output.finish(),
                Err(ReadErrorV1::ResponseProtocol)
            ));
        }
    }
}

#[test]
fn missing_extra_or_repeated_rows_and_columns_poison_the_sink() {
    assert!(matches!(
        ResponseSinkV1::new().finish(),
        Err(ReadErrorV1::ResponseProtocol)
    ));
    for length in [0, 28, 30, usize::MAX] {
        let mut output = ResponseSinkV1::new();
        assert_eq!(output.begin_row(length), Err(ReadErrorV1::ResponseProtocol));
        assert_eq!(output.begin_row(29), Err(ReadErrorV1::ResponseProtocol));
    }
    let mut incomplete = ResponseSinkV1::new();
    incomplete.begin_row(29).unwrap();
    assert!(matches!(
        incomplete.finish(),
        Err(ReadErrorV1::ResponseProtocol)
    ));
    let row = absent_row(&contract());
    let mut repeated = sink(&row).unwrap();
    assert_eq!(repeated.begin_row(29), Err(ReadErrorV1::ResponseProtocol));
    assert!(matches!(
        repeated.finish(),
        Err(ReadErrorV1::ResponseProtocol)
    ));
    let mut extra = sink(&row).unwrap();
    assert_eq!(
        extra.push_column("queryVersion", ColumnTypeV1::Text, Some(b"x")),
        Err(ReadErrorV1::ResponseProtocol)
    );
    assert!(matches!(extra.finish(), Err(ReadErrorV1::ResponseProtocol)));
}

#[test]
fn invalid_utf8_control_bytes_and_oversize_cells_fail_before_storage() {
    for invalid in [
        vec![0xff],
        b"x\0y".to_vec(),
        b"x\ny".to_vec(),
        Vec::new(),
        vec![b'a'; 257],
    ] {
        let mut output = ResponseSinkV1::new();
        output.begin_row(29).unwrap();
        assert!(output
            .push_column("queryVersion", ColumnTypeV1::Text, Some(&invalid))
            .is_err());
        assert!(output.cells.is_empty());
        assert_eq!(output.byte_count, 0);
        assert!(matches!(
            output.finish(),
            Err(ReadErrorV1::ResponseProtocol)
        ));
    }
    let mut output = ResponseSinkV1::new();
    output.begin_row(29).unwrap();
    output.byte_count = MAXIMUM_RESPONSE_BYTES;
    assert_eq!(
        output.push_column("queryVersion", ColumnTypeV1::Text, Some(b"x")),
        Err(ReadErrorV1::ResponseLimit)
    );
    assert!(output.cells.is_empty());
}

#[test]
fn rejects_coerced_boolean_noncanonical_or_overflowing_integer_values() {
    let row = absent_row(&contract());
    for invalid in ["true", "false", "1", "0", "T", " f", ""] {
        let mut changed = row.clone();
        changed[7] = Some(invalid.to_owned());
        assert!(matches!(decode(&changed), Err(ReadErrorV1::ResponseValue)));
    }
    for invalid in [
        "-0",
        "+0",
        "00",
        "1.0",
        "1e0",
        " 0",
        "2147483648",
        "-2147483649",
        "",
    ] {
        let mut changed = row.clone();
        changed[10] = Some(invalid.to_owned());
        assert!(matches!(decode(&changed), Err(ReadErrorV1::ResponseValue)));
    }
    for (index, invalid) in [(10, "3"), (14, "10002"), (19, "20003"), (15, "-1")] {
        let mut changed = row.clone();
        changed[index] = Some(invalid.to_owned());
        assert!(matches!(decode(&changed), Err(ReadErrorV1::ResponseValue)));
    }
}

#[test]
fn validates_marker_snapshot_server_version_and_calendar_without_echoing_invalid_values() {
    let row = absent_row(&contract());
    for (index, invalid) in [
        (25, "not-a-digest"),
        (26, "140000"),
        (26, "180000"),
        (26, "17x000"),
        (26, "17000"),
        (27, "not-a-digest"),
        (28, "2027-02-29T00:00:00.000Z"),
        (28, "2027-01-01T24:00:00.000Z"),
        (28, "2027-01-01T00:00:00Z"),
    ] {
        let mut changed = row.clone();
        changed[index] = Some(invalid.to_owned());
        assert!(
            matches!(decode(&changed), Err(ReadErrorV1::ResponseValue)),
            "field {index}"
        );
    }
    let mut changed = row;
    changed[25] = None;
    assert!(matches!(decode(&changed), Err(ReadErrorV1::ResponseValue)));
    changed[9] = Some("f".to_owned());
    changed[6] = Some("precondition-failed".to_owned());
    let observation = decode(&changed).unwrap();
    assert_eq!(observation.status, ReadStateV1::PreconditionFailed);
    assert_no_authority(&observation);
}

#[test]
fn transcript_is_deterministic_and_changes_with_the_exact_snapshot() {
    let row = absent_row(&contract());
    let first = decode(&row).unwrap();
    let second = decode(&row).unwrap();
    assert_eq!(first.response_digest, second.response_digest);
    let mut changed = row;
    changed[27] = Some(digest("later-snapshot"));
    assert_ne!(
        first.response_digest,
        decode(&changed).unwrap().response_digest
    );
}

#[test]
fn dormant_source_exposes_no_connector_network_or_settlement_entrypoint() {
    let source = include_str!("../reconciliation.rs");
    assert!(source.contains("#[cfg(test)]\n    fn from_material_for_test("));
    for forbidden in [
        "pub(crate)",
        "pub(super)",
        "impl Clone for ReceiptZeroReadContractV1",
        "Serialize for ReceiptZeroReadContractV1",
        concat!("#[tauri", "::command]"),
        concat!("reqwest", "::"),
        concat!("tokio_postgres", "::"),
        concat!("sqlx", "::"),
        "settle_for_test",
    ] {
        assert!(
            !source.contains(forbidden),
            "unexpected authority surface {forbidden}"
        );
    }
}
