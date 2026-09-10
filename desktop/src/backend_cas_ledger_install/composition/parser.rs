//! Strict, testing-only decoder for the fixed CAS-ledger catalog query.
//!
//! The database adapter is deliberately not allowed to classify the result. It supplies one raw,
//! typed row and this module derives the only observation that the journal may consume.

#![cfg(test)]

use super::super::{
    CasLedgerInstallObservationInputV1, CasLedgerInstallObservedMarkerStateV1,
    CasLedgerInstallObservedStateV1,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{de, Deserialize, Deserializer};
use serde_json::{Map, Number, Value};
use sha2::{Digest, Sha256};
use std::{collections::BTreeSet, fmt};

pub(super) const MAXIMUM_RESPONSE_BYTES: usize = 512 * 1_024;
pub(super) const MAXIMUM_RESPONSE_ROWS: usize = 1;
pub(super) const MAXIMUM_RESPONSE_COLUMNS: usize = 18;

const FIXED_SCHEMA_NAME: &str = "openpencil_release";
const READ_ONLY_ROLE: &str = "supabase_read_only_user";
const SCHEMA_COMMENT: &str = "openpencil:release-ledger:v1";
const EXPECTED_COLUMN_COUNT: usize = 46;
const EXPECTED_CONSTRAINT_COUNT: usize = 33;
const EXPECTED_COLUMNS_DIGEST: &str = "-xBHcKEYTORxyllW2_A3rnBcFJGWog9obafMY0wnl58";
const EXPECTED_CONSTRAINTS_DIGEST: &str = "U72poT-RJyt-rNHyXqNjOZoDjjsMnRZSs5pvUwjN8aY";
const INSTALLED_RESPONSE_DIGEST_DOMAIN: &[u8] =
    b"openpencil.native-cas-ledger-installed-raw-response.v1\0";

const ROLE_KEYS: [&str; 10] = [
    "currentOid",
    "currentName",
    "currentSuperuser",
    "currentBypassRls",
    "currentHasEffectivePgReadAllData",
    "sessionOid",
    "sessionName",
    "sessionSuperuser",
    "sessionBypassRls",
    "sessionHasEffectivePgReadAllData",
];
const SETTINGS_KEYS: [&str; 3] = [
    "databasePrimary",
    "transactionReadOnly",
    "effectiveSearchPath",
];
const CATALOG_KEYS: [&str; 22] = [
    "schemaCount",
    "schemaOid",
    "schemaOwnerOid",
    "schemaOwnerName",
    "schemaComment",
    "installMarkerConstraintComment",
    "schemaInstallMarkerPrefixCount",
    "ownerRoleMemberCount",
    "ownerDefaultNonOwnerPrivilegeCount",
    "schemaNonOwnerPrivilegeCount",
    "relationCount",
    "unexpectedIndexCount",
    "unexpectedTriggerCount",
    "unexpectedRuleCount",
    "unexpectedConstraintCount",
    "inheritanceRelationCount",
    "publicationExposureCount",
    "droppedColumnCount",
    "policyCount",
    "tables",
    "columns",
    "constraints",
];
const TABLE_KEYS: [&str; 13] = [
    "tableName",
    "tableOid",
    "ownerOid",
    "ownerName",
    "relationKind",
    "persistence",
    "isPartition",
    "replicaIdentity",
    "rlsEnabled",
    "rlsForced",
    "comment",
    "nonOwnerPrivilegeCount",
    "policyCount",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum RawColumnTypeV1 {
    Text,
    Bool,
    Jsonb,
    Other,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct RawColumnV1 {
    pub(super) name: String,
    pub(super) column_type: RawColumnTypeV1,
    pub(super) value: Option<Vec<u8>>,
}

/// Rows -> columns. Values use PostgreSQL text format; booleans are exactly `t` or `f`.
pub(super) type RawQueryResponseV1 = Vec<Vec<RawColumnV1>>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ParseErrorV1 {
    ResponseLimitExceeded,
    InvalidRowCount,
    InvalidColumnCount,
    InvalidColumnMetadata,
    NullColumn,
    InvalidUtf8,
    InvalidBoolean,
    InvalidJson,
    QueryBindingMismatch,
    InvalidServerVersion,
    InvalidSnapshotMarker,
    InvalidObservedAt,
    InvalidRoles,
    InvalidSettings,
    CatalogMismatch,
}

#[derive(Clone, Copy)]
struct ColumnSpecV1 {
    name: &'static str,
    column_type: RawColumnTypeV1,
}

const fn column(name: &'static str, column_type: RawColumnTypeV1) -> ColumnSpecV1 {
    ColumnSpecV1 { name, column_type }
}

const RESPONSE_SCHEMA: [ColumnSpecV1; MAXIMUM_RESPONSE_COLUMNS] = [
    column("reviewDigest", RawColumnTypeV1::Text),
    column("ledgerShapeDigest", RawColumnTypeV1::Text),
    column("sqlDigest", RawColumnTypeV1::Text),
    column("projectRef", RawColumnTypeV1::Text),
    column("accountId", RawColumnTypeV1::Text),
    column("grantGeneration", RawColumnTypeV1::Text),
    column("queryVersion", RawColumnTypeV1::Text),
    column("queryDigest", RawColumnTypeV1::Text),
    column("accessMode", RawColumnTypeV1::Text),
    column("snapshotScope", RawColumnTypeV1::Text),
    column("catalogOnly", RawColumnTypeV1::Bool),
    column("managedDataRead", RawColumnTypeV1::Bool),
    column("serverVersionNum", RawColumnTypeV1::Text),
    column("snapshotMarker", RawColumnTypeV1::Text),
    column("observedAt", RawColumnTypeV1::Text),
    column("roles", RawColumnTypeV1::Jsonb),
    column("settings", RawColumnTypeV1::Jsonb),
    column("catalog", RawColumnTypeV1::Jsonb),
];

pub(super) fn parse_fixed_verification_response(
    response: RawQueryResponseV1,
    expected_parameters: &[String; 9],
    expected_marker: &str,
    max_bytes: usize,
) -> Result<CasLedgerInstallObservationInputV1, ParseErrorV1> {
    if expected_parameters[0] != FIXED_SCHEMA_NAME {
        return Err(ParseErrorV1::QueryBindingMismatch);
    }
    if response.len() != MAXIMUM_RESPONSE_ROWS {
        return Err(ParseErrorV1::InvalidRowCount);
    }
    let row = &response[0];
    if row.len() != MAXIMUM_RESPONSE_COLUMNS {
        return Err(ParseErrorV1::InvalidColumnCount);
    }

    let mut aggregate_bytes = 0usize;
    for (observed, specification) in row.iter().zip(RESPONSE_SCHEMA) {
        if observed.name != specification.name || observed.column_type != specification.column_type
        {
            return Err(ParseErrorV1::InvalidColumnMetadata);
        }
        let value = observed.value.as_deref().ok_or(ParseErrorV1::NullColumn)?;
        aggregate_bytes = aggregate_bytes
            .checked_add(observed.name.len())
            .and_then(|size| size.checked_add(value.len()))
            .ok_or(ParseErrorV1::ResponseLimitExceeded)?;
        if aggregate_bytes > max_bytes.min(MAXIMUM_RESPONSE_BYTES) {
            return Err(ParseErrorV1::ResponseLimitExceeded);
        }
    }

    for (index, expected_value) in [
        expected_parameters[1].as_str(),
        expected_parameters[2].as_str(),
        expected_parameters[3].as_str(),
        expected_parameters[4].as_str(),
        expected_parameters[5].as_str(),
        expected_parameters[6].as_str(),
        expected_parameters[7].as_str(),
        expected_parameters[8].as_str(),
        "read-only",
        "single-statement",
    ]
    .into_iter()
    .enumerate()
    {
        if text_value(row, index)? != expected_value {
            return Err(ParseErrorV1::QueryBindingMismatch);
        }
    }
    if !boolean_value(row, 10)? || boolean_value(row, 11)? {
        return Err(ParseErrorV1::QueryBindingMismatch);
    }

    let server_version_num = text_value(row, 12)?;
    if !supported_server_version(server_version_num) {
        return Err(ParseErrorV1::InvalidServerVersion);
    }
    let snapshot_marker = text_value(row, 13)?;
    if !snapshot_marker_is_valid(snapshot_marker) {
        return Err(ParseErrorV1::InvalidSnapshotMarker);
    }
    let observed_at = text_value(row, 14)?;
    if !canonical_utc_millis(observed_at) {
        return Err(ParseErrorV1::InvalidObservedAt);
    }

    let roles_value = strict_json_value(value(row, 15)?)?;
    require_exact_object_keys(&roles_value, &ROLE_KEYS).map_err(|_| ParseErrorV1::InvalidRoles)?;
    let roles: RolesV1 =
        serde_json::from_value(roles_value).map_err(|_| ParseErrorV1::InvalidRoles)?;
    validate_roles(&roles)?;

    let settings_value = strict_json_value(value(row, 16)?)?;
    require_exact_object_keys(&settings_value, &SETTINGS_KEYS)
        .map_err(|_| ParseErrorV1::InvalidSettings)?;
    let settings: SettingsV1 =
        serde_json::from_value(settings_value).map_err(|_| ParseErrorV1::InvalidSettings)?;
    validate_settings(&settings)?;

    let catalog_value = strict_json_value(value(row, 17)?)?;
    require_exact_object_keys(&catalog_value, &CATALOG_KEYS)
        .map_err(|_| ParseErrorV1::CatalogMismatch)?;
    let catalog: CatalogV1 =
        serde_json::from_value(catalog_value.clone()).map_err(|_| ParseErrorV1::CatalogMismatch)?;
    validate_catalog(&catalog_value, &catalog, &roles, expected_marker)?;

    Ok(CasLedgerInstallObservationInputV1 {
        state: CasLedgerInstallObservedStateV1::Installed,
        verified_installed: true,
        exact_installed_state: true,
        all_verification_checks_passed: true,
        marker_state: CasLedgerInstallObservedMarkerStateV1::ExactSingle,
        constraint_comment: Some(expected_marker.to_owned()),
        schema_marker_prefix_count: 1,
        exact_single_marker_on_constraint: true,
        installed_verification_digest: digest_raw_response(row),
        observed_at: observed_at.to_owned(),
        snapshot_marker: snapshot_marker.to_owned(),
        server_version_num: server_version_num.to_owned(),
    })
}

fn value(row: &[RawColumnV1], index: usize) -> Result<&[u8], ParseErrorV1> {
    row[index].value.as_deref().ok_or(ParseErrorV1::NullColumn)
}

fn text_value(row: &[RawColumnV1], index: usize) -> Result<&str, ParseErrorV1> {
    std::str::from_utf8(value(row, index)?).map_err(|_| ParseErrorV1::InvalidUtf8)
}

fn boolean_value(row: &[RawColumnV1], index: usize) -> Result<bool, ParseErrorV1> {
    match value(row, index)? {
        b"t" => Ok(true),
        b"f" => Ok(false),
        _ => Err(ParseErrorV1::InvalidBoolean),
    }
}

fn strict_json_value(bytes: &[u8]) -> Result<Value, ParseErrorV1> {
    let mut deserializer = serde_json::Deserializer::from_slice(bytes);
    let value = StrictValueV1::deserialize(&mut deserializer)
        .map_err(|_| ParseErrorV1::InvalidJson)?
        .0;
    deserializer.end().map_err(|_| ParseErrorV1::InvalidJson)?;
    Ok(value)
}

struct StrictValueV1(Value);

impl<'de> Deserialize<'de> for StrictValueV1 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct StrictVisitorV1;

        impl<'de> de::Visitor<'de> for StrictVisitorV1 {
            type Value = StrictValueV1;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("JSON without duplicate object keys")
            }

            fn visit_bool<E>(self, value: bool) -> Result<Self::Value, E> {
                Ok(StrictValueV1(Value::Bool(value)))
            }

            fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E> {
                Ok(StrictValueV1(Value::Number(Number::from(value))))
            }

            fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E> {
                Ok(StrictValueV1(Value::Number(Number::from(value))))
            }

            fn visit_f64<E>(self, value: f64) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                Number::from_f64(value)
                    .map(Value::Number)
                    .map(StrictValueV1)
                    .ok_or_else(|| E::custom("non-finite JSON number"))
            }

            fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                self.visit_string(value.to_owned())
            }

            fn visit_string<E>(self, value: String) -> Result<Self::Value, E> {
                Ok(StrictValueV1(Value::String(value)))
            }

            fn visit_none<E>(self) -> Result<Self::Value, E> {
                Ok(StrictValueV1(Value::Null))
            }

            fn visit_unit<E>(self) -> Result<Self::Value, E> {
                Ok(StrictValueV1(Value::Null))
            }

            fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
            where
                A: de::SeqAccess<'de>,
            {
                let mut values = Vec::new();
                while let Some(value) = sequence.next_element::<StrictValueV1>()? {
                    values.push(value.0);
                }
                Ok(StrictValueV1(Value::Array(values)))
            }

            fn visit_map<A>(self, mut object: A) -> Result<Self::Value, A::Error>
            where
                A: de::MapAccess<'de>,
            {
                let mut keys = BTreeSet::new();
                let mut values = Map::new();
                while let Some(key) = object.next_key::<String>()? {
                    if !keys.insert(key.clone()) {
                        return Err(de::Error::custom("duplicate JSON object key"));
                    }
                    let value = object.next_value::<StrictValueV1>()?;
                    values.insert(key, value.0);
                }
                Ok(StrictValueV1(Value::Object(values)))
            }
        }

        deserializer.deserialize_any(StrictVisitorV1)
    }
}

fn require_exact_object_keys(value: &Value, expected: &[&str]) -> Result<(), ()> {
    let Value::Object(object) = value else {
        return Err(());
    };
    if object.len() != expected.len() || expected.iter().any(|key| !object.contains_key(*key)) {
        return Err(());
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RolesV1 {
    current_oid: String,
    current_name: String,
    current_superuser: bool,
    current_bypass_rls: bool,
    current_has_effective_pg_read_all_data: bool,
    session_oid: String,
    session_name: String,
    session_superuser: bool,
    session_bypass_rls: bool,
    session_has_effective_pg_read_all_data: bool,
}

fn validate_roles(roles: &RolesV1) -> Result<(), ParseErrorV1> {
    if !valid_oid(&roles.current_oid)
        || !valid_oid(&roles.session_oid)
        || !valid_stable_id(&roles.current_name)
        || !valid_stable_id(&roles.session_name)
        || roles.current_oid != roles.session_oid
        || roles.current_name != READ_ONLY_ROLE
        || roles.session_name != READ_ONLY_ROLE
        || roles.current_superuser
        || roles.session_superuser
        || !roles.current_bypass_rls
        || !roles.session_bypass_rls
        || !roles.current_has_effective_pg_read_all_data
        || !roles.session_has_effective_pg_read_all_data
    {
        return Err(ParseErrorV1::InvalidRoles);
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SettingsV1 {
    database_primary: bool,
    transaction_read_only: bool,
    effective_search_path: Vec<String>,
}

fn validate_settings(settings: &SettingsV1) -> Result<(), ParseErrorV1> {
    if !settings.database_primary
        || !settings.transaction_read_only
        || settings.effective_search_path != ["pg_catalog", "public"]
    {
        return Err(ParseErrorV1::InvalidSettings);
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CatalogV1 {
    schema_count: u64,
    schema_oid: Option<String>,
    schema_owner_oid: Option<String>,
    schema_owner_name: Option<String>,
    schema_comment: Option<String>,
    install_marker_constraint_comment: Option<String>,
    schema_install_marker_prefix_count: u64,
    owner_role_member_count: u64,
    owner_default_non_owner_privilege_count: u64,
    schema_non_owner_privilege_count: u64,
    relation_count: u64,
    unexpected_index_count: u64,
    unexpected_trigger_count: u64,
    unexpected_rule_count: u64,
    unexpected_constraint_count: u64,
    inheritance_relation_count: u64,
    publication_exposure_count: u64,
    dropped_column_count: u64,
    policy_count: u64,
    tables: Vec<TableV1>,
    columns: Vec<Value>,
    constraints: Vec<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TableV1 {
    table_name: String,
    table_oid: String,
    owner_oid: String,
    owner_name: String,
    relation_kind: String,
    persistence: String,
    is_partition: bool,
    replica_identity: String,
    rls_enabled: bool,
    rls_forced: bool,
    comment: Option<String>,
    non_owner_privilege_count: u64,
    policy_count: u64,
}

fn validate_catalog(
    raw: &Value,
    catalog: &CatalogV1,
    roles: &RolesV1,
    expected_marker: &str,
) -> Result<(), ParseErrorV1> {
    let schema_oid = catalog
        .schema_oid
        .as_deref()
        .filter(|value| valid_oid(value))
        .ok_or(ParseErrorV1::CatalogMismatch)?;
    let owner_oid = catalog
        .schema_owner_oid
        .as_deref()
        .filter(|value| valid_oid(value))
        .ok_or(ParseErrorV1::CatalogMismatch)?;
    let owner_name = catalog
        .schema_owner_name
        .as_deref()
        .filter(|value| valid_stable_id(value))
        .ok_or(ParseErrorV1::CatalogMismatch)?;
    if !valid_oid(schema_oid)
        || catalog.schema_count != 1
        || catalog.schema_comment.as_deref() != Some(SCHEMA_COMMENT)
        || catalog.install_marker_constraint_comment.as_deref() != Some(expected_marker)
        || catalog.schema_install_marker_prefix_count != 1
        || catalog.owner_role_member_count != 0
        || catalog.owner_default_non_owner_privilege_count != 0
        || catalog.schema_non_owner_privilege_count != 0
        || catalog.relation_count != 3
        || catalog.unexpected_index_count != 0
        || catalog.unexpected_trigger_count != 0
        || catalog.unexpected_rule_count != 0
        || catalog.unexpected_constraint_count != 0
        || catalog.inheritance_relation_count != 0
        || catalog.publication_exposure_count != 0
        || catalog.dropped_column_count != 0
        || catalog.policy_count != 0
        || roles.current_oid == owner_oid
        || roles.current_name == owner_name
        || catalog.tables.len() != 3
        || catalog.columns.len() != EXPECTED_COLUMN_COUNT
        || catalog.constraints.len() != EXPECTED_CONSTRAINT_COUNT
    {
        return Err(ParseErrorV1::CatalogMismatch);
    }

    let raw_tables = raw
        .get("tables")
        .and_then(Value::as_array)
        .ok_or(ParseErrorV1::CatalogMismatch)?;
    for table in raw_tables {
        require_exact_object_keys(table, &TABLE_KEYS).map_err(|_| ParseErrorV1::CatalogMismatch)?;
    }
    let expected_tables = [
        (
            "backfill_executions_v1",
            "openpencil:release-ledger:backfill-executions:v1",
        ),
        (
            "backfill_receipts_v2",
            "openpencil:release-ledger:backfill-receipts:v2",
        ),
        (
            "backfill_heads_v1",
            "openpencil:release-ledger:backfill-heads:v1",
        ),
    ];
    for (table, (expected_name, expected_comment)) in catalog.tables.iter().zip(expected_tables) {
        if table.table_name != expected_name
            || !valid_oid(&table.table_oid)
            || table.owner_oid != owner_oid
            || table.owner_name != owner_name
            || table.relation_kind != "r"
            || table.persistence != "p"
            || table.is_partition
            || table.replica_identity != "d"
            || !table.rls_enabled
            || table.rls_forced
            || table.comment.as_deref() != Some(expected_comment)
            || table.non_owner_privilege_count != 0
            || table.policy_count != 0
            || roles.current_oid == table.owner_oid
            || roles.current_name == table.owner_name
        {
            return Err(ParseErrorV1::CatalogMismatch);
        }
    }

    let columns = raw.get("columns").ok_or(ParseErrorV1::CatalogMismatch)?;
    let constraints = raw
        .get("constraints")
        .ok_or(ParseErrorV1::CatalogMismatch)?;
    if canonical_json_digest(columns)? != EXPECTED_COLUMNS_DIGEST
        || canonical_json_digest(constraints)? != EXPECTED_CONSTRAINTS_DIGEST
    {
        return Err(ParseErrorV1::CatalogMismatch);
    }
    Ok(())
}

fn canonical_json_digest(value: &Value) -> Result<String, ParseErrorV1> {
    fn write(value: &Value, output: &mut Vec<u8>) -> Result<(), ParseErrorV1> {
        match value {
            Value::Null => output.extend_from_slice(b"null"),
            Value::Bool(value) => output.extend_from_slice(if *value { b"true" } else { b"false" }),
            Value::Number(value) => output.extend_from_slice(value.to_string().as_bytes()),
            Value::String(value) => output.extend_from_slice(
                serde_json::to_string(value)
                    .map_err(|_| ParseErrorV1::InvalidJson)?
                    .as_bytes(),
            ),
            Value::Array(values) => {
                output.push(b'[');
                for (index, value) in values.iter().enumerate() {
                    if index != 0 {
                        output.push(b',');
                    }
                    write(value, output)?;
                }
                output.push(b']');
            }
            Value::Object(values) => {
                output.push(b'{');
                let mut entries = values.iter().collect::<Vec<_>>();
                entries.sort_unstable_by(|(left, _), (right, _)| left.cmp(right));
                for (index, (key, value)) in entries.into_iter().enumerate() {
                    if index != 0 {
                        output.push(b',');
                    }
                    output.extend_from_slice(
                        serde_json::to_string(key)
                            .map_err(|_| ParseErrorV1::InvalidJson)?
                            .as_bytes(),
                    );
                    output.push(b':');
                    write(value, output)?;
                }
                output.push(b'}');
            }
        }
        if output.len() > MAXIMUM_RESPONSE_BYTES {
            return Err(ParseErrorV1::ResponseLimitExceeded);
        }
        Ok(())
    }

    let mut canonical = Vec::new();
    write(value, &mut canonical)?;
    Ok(URL_SAFE_NO_PAD.encode(Sha256::digest(canonical)))
}

fn digest_raw_response(row: &[RawColumnV1]) -> String {
    let mut hash = Sha256::new();
    hash.update(INSTALLED_RESPONSE_DIGEST_DOMAIN);
    hash.update(u64::try_from(row.len()).unwrap_or(u64::MAX).to_be_bytes());
    for column in row {
        let type_tag = match column.column_type {
            RawColumnTypeV1::Text => 1_u8,
            RawColumnTypeV1::Bool => 2_u8,
            RawColumnTypeV1::Jsonb => 3_u8,
            RawColumnTypeV1::Other => 255_u8,
        };
        hash.update(
            u64::try_from(column.name.len())
                .unwrap_or(u64::MAX)
                .to_be_bytes(),
        );
        hash.update(column.name.as_bytes());
        hash.update([type_tag]);
        if let Some(value) = &column.value {
            hash.update([1]);
            hash.update(u64::try_from(value.len()).unwrap_or(u64::MAX).to_be_bytes());
            hash.update(value);
        } else {
            hash.update([0]);
        }
    }
    URL_SAFE_NO_PAD.encode(hash.finalize())
}

fn valid_oid(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 10
        && value.bytes().all(|byte| byte.is_ascii_digit())
        && (value == "0" || !value.starts_with('0'))
}

fn valid_stable_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 128
        && bytes[0].is_ascii_alphanumeric()
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
}

fn supported_server_version(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 6
        && bytes.iter().all(u8::is_ascii_digit)
        && matches!(&bytes[..2], b"15" | b"16" | b"17")
}

fn snapshot_marker_is_valid(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 512
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b':' | b','))
}

fn canonical_utc_millis(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 24
        || bytes.get(4) != Some(&b'-')
        || bytes.get(7) != Some(&b'-')
        || bytes.get(10) != Some(&b'T')
        || bytes.get(13) != Some(&b':')
        || bytes.get(16) != Some(&b':')
        || bytes.get(19) != Some(&b'.')
        || bytes.get(23) != Some(&b'Z')
    {
        return false;
    }
    let number = |range: std::ops::Range<usize>| -> Option<u32> {
        std::str::from_utf8(&bytes[range]).ok()?.parse().ok()
    };
    let (Some(year), Some(month), Some(day), Some(hour), Some(minute), Some(second), Some(_)) = (
        number(0..4),
        number(5..7),
        number(8..10),
        number(11..13),
        number(14..16),
        number(17..19),
        number(20..23),
    ) else {
        return false;
    };
    if !(1..=12).contains(&month) || hour > 23 || minute > 59 || second > 59 {
        return false;
    }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let maximum_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    (1..=maximum_day).contains(&day)
}

#[cfg(test)]
mod tests {
    use super::*;

    const INVENTORY_SOURCE: &str = include_str!("expected-inventory-v1.json");

    fn parameters() -> [String; 9] {
        [
            FIXED_SCHEMA_NAME.to_owned(),
            "review-digest".to_owned(),
            "shape-digest".to_owned(),
            "sql-digest".to_owned(),
            "abcdefghijklmnopqrst".to_owned(),
            "account-a".to_owned(),
            "11111111-1111-4111-8111-111111111111".to_owned(),
            "openpencil-supabase-backfill-database-cas-ledger-verification-v1".to_owned(),
            "query-digest".to_owned(),
        ]
    }

    fn column(name: &str, column_type: RawColumnTypeV1, value: impl Into<Vec<u8>>) -> RawColumnV1 {
        RawColumnV1 {
            name: name.to_owned(),
            column_type,
            value: Some(value.into()),
        }
    }

    fn json_column(name: &str, value: &Value) -> RawColumnV1 {
        column(
            name,
            RawColumnTypeV1::Jsonb,
            serde_json::to_vec(value).expect("JSON fixture"),
        )
    }

    fn exact_response(parameters: &[String; 9], marker: &str) -> RawQueryResponseV1 {
        let inventory: Value = serde_json::from_str(INVENTORY_SOURCE).expect("inventory fixture");
        let roles = serde_json::json!({
            "currentOid": "20",
            "currentName": READ_ONLY_ROLE,
            "currentSuperuser": false,
            "currentBypassRls": true,
            "currentHasEffectivePgReadAllData": true,
            "sessionOid": "20",
            "sessionName": READ_ONLY_ROLE,
            "sessionSuperuser": false,
            "sessionBypassRls": true,
            "sessionHasEffectivePgReadAllData": true
        });
        let settings = serde_json::json!({
            "databasePrimary": true,
            "transactionReadOnly": true,
            "effectiveSearchPath": ["pg_catalog", "public"]
        });
        let catalog = serde_json::json!({
            "schemaCount": 1,
            "schemaOid": "70000",
            "schemaOwnerOid": "10",
            "schemaOwnerName": "postgres",
            "schemaComment": SCHEMA_COMMENT,
            "installMarkerConstraintComment": marker,
            "schemaInstallMarkerPrefixCount": 1,
            "ownerRoleMemberCount": 0,
            "ownerDefaultNonOwnerPrivilegeCount": 0,
            "schemaNonOwnerPrivilegeCount": 0,
            "relationCount": 3,
            "unexpectedIndexCount": 0,
            "unexpectedTriggerCount": 0,
            "unexpectedRuleCount": 0,
            "unexpectedConstraintCount": 0,
            "inheritanceRelationCount": 0,
            "publicationExposureCount": 0,
            "droppedColumnCount": 0,
            "policyCount": 0,
            "tables": [
                {
                    "tableName": "backfill_executions_v1", "tableOid": "70001",
                    "ownerOid": "10", "ownerName": "postgres", "relationKind": "r",
                    "persistence": "p", "isPartition": false, "replicaIdentity": "d",
                    "rlsEnabled": true, "rlsForced": false,
                    "comment": "openpencil:release-ledger:backfill-executions:v1",
                    "nonOwnerPrivilegeCount": 0, "policyCount": 0
                },
                {
                    "tableName": "backfill_receipts_v2", "tableOid": "70002",
                    "ownerOid": "10", "ownerName": "postgres", "relationKind": "r",
                    "persistence": "p", "isPartition": false, "replicaIdentity": "d",
                    "rlsEnabled": true, "rlsForced": false,
                    "comment": "openpencil:release-ledger:backfill-receipts:v2",
                    "nonOwnerPrivilegeCount": 0, "policyCount": 0
                },
                {
                    "tableName": "backfill_heads_v1", "tableOid": "70003",
                    "ownerOid": "10", "ownerName": "postgres", "relationKind": "r",
                    "persistence": "p", "isPartition": false, "replicaIdentity": "d",
                    "rlsEnabled": true, "rlsForced": false,
                    "comment": "openpencil:release-ledger:backfill-heads:v1",
                    "nonOwnerPrivilegeCount": 0, "policyCount": 0
                }
            ],
            "columns": inventory["columns"].clone(),
            "constraints": inventory["constraints"].clone()
        });
        vec![vec![
            column(
                "reviewDigest",
                RawColumnTypeV1::Text,
                parameters[1].as_bytes(),
            ),
            column(
                "ledgerShapeDigest",
                RawColumnTypeV1::Text,
                parameters[2].as_bytes(),
            ),
            column("sqlDigest", RawColumnTypeV1::Text, parameters[3].as_bytes()),
            column(
                "projectRef",
                RawColumnTypeV1::Text,
                parameters[4].as_bytes(),
            ),
            column("accountId", RawColumnTypeV1::Text, parameters[5].as_bytes()),
            column(
                "grantGeneration",
                RawColumnTypeV1::Text,
                parameters[6].as_bytes(),
            ),
            column(
                "queryVersion",
                RawColumnTypeV1::Text,
                parameters[7].as_bytes(),
            ),
            column(
                "queryDigest",
                RawColumnTypeV1::Text,
                parameters[8].as_bytes(),
            ),
            column("accessMode", RawColumnTypeV1::Text, b"read-only".as_slice()),
            column(
                "snapshotScope",
                RawColumnTypeV1::Text,
                b"single-statement".as_slice(),
            ),
            column("catalogOnly", RawColumnTypeV1::Bool, b"t".as_slice()),
            column("managedDataRead", RawColumnTypeV1::Bool, b"f".as_slice()),
            column(
                "serverVersionNum",
                RawColumnTypeV1::Text,
                b"170000".as_slice(),
            ),
            column(
                "snapshotMarker",
                RawColumnTypeV1::Text,
                b"100:101:".as_slice(),
            ),
            column(
                "observedAt",
                RawColumnTypeV1::Text,
                b"2026-09-08T12:00:00.000Z".as_slice(),
            ),
            json_column("roles", &roles),
            json_column("settings", &settings),
            json_column("catalog", &catalog),
        ]]
    }

    #[test]
    fn exact_raw_inventory_is_the_only_installed_observation() {
        let parameters = parameters();
        let marker = format!(
            "openpencil-install:v1:supabase-backfill-database-cas-ledger:{}",
            "A".repeat(43)
        );
        let response = exact_response(&parameters, &marker);
        let observation = parse_fixed_verification_response(
            response.clone(),
            &parameters,
            &marker,
            MAXIMUM_RESPONSE_BYTES,
        )
        .expect("exact installed response");
        assert!(observation.state == CasLedgerInstallObservedStateV1::Installed);
        assert!(observation.verified_installed);
        assert!(observation.exact_installed_state);
        assert!(observation.all_verification_checks_passed);
        assert_eq!(
            observation.constraint_comment.as_deref(),
            Some(marker.as_str())
        );
        assert_eq!(observation.schema_marker_prefix_count, 1);
        assert_eq!(observation.installed_verification_digest.len(), 43);
        assert_eq!(
            observation.installed_verification_digest,
            parse_fixed_verification_response(
                response,
                &parameters,
                &marker,
                MAXIMUM_RESPONSE_BYTES,
            )
            .unwrap()
            .installed_verification_digest
        );
    }

    #[test]
    fn shape_type_null_boolean_echo_and_size_fail_closed() {
        let parameters = parameters();
        let marker = format!(
            "openpencil-install:v1:supabase-backfill-database-cas-ledger:{}",
            "A".repeat(43)
        );
        let base = exact_response(&parameters, &marker);
        let mut cases = Vec::new();
        cases.push((Vec::new(), ParseErrorV1::InvalidRowCount));
        let mut extra_row = base.clone();
        extra_row.push(Vec::new());
        cases.push((extra_row, ParseErrorV1::InvalidRowCount));
        let mut short = base.clone();
        short[0].pop();
        cases.push((short, ParseErrorV1::InvalidColumnCount));
        let mut wrong_name = base.clone();
        wrong_name[0][0].name.push('x');
        cases.push((wrong_name, ParseErrorV1::InvalidColumnMetadata));
        let mut wrong_type = base.clone();
        wrong_type[0][0].column_type = RawColumnTypeV1::Other;
        cases.push((wrong_type, ParseErrorV1::InvalidColumnMetadata));
        let mut null = base.clone();
        null[0][0].value = None;
        cases.push((null, ParseErrorV1::NullColumn));
        let mut bool_coercion = base.clone();
        bool_coercion[0][10].value = Some(b"true".to_vec());
        cases.push((bool_coercion, ParseErrorV1::InvalidBoolean));
        let mut wrong_echo = base.clone();
        wrong_echo[0][5].value = Some(b"cross-wired".to_vec());
        cases.push((wrong_echo, ParseErrorV1::QueryBindingMismatch));
        let mut non_ascii_server_version = base.clone();
        non_ascii_server_version[0][12].value = Some("1é123".as_bytes().to_vec());
        cases.push((non_ascii_server_version, ParseErrorV1::InvalidServerVersion));
        let mut oversized = base;
        oversized[0][17].value = Some(vec![b' '; MAXIMUM_RESPONSE_BYTES + 1]);
        cases.push((oversized, ParseErrorV1::ResponseLimitExceeded));

        for (response, expected) in cases {
            assert_eq!(
                parse_fixed_verification_response(
                    response,
                    &parameters,
                    &marker,
                    MAXIMUM_RESPONSE_BYTES,
                )
                .err(),
                Some(expected)
            );
        }
    }
}
