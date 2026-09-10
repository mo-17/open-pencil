//! Dormant native Supabase Receipt-zero initializer contracts.
//!
//! Production builds compile the private fixed-statement precommit and bounded transaction-runner
//! shape so its SQL, parameters, limits, and stage ordering cannot drift behind a test-only module.
//! No production constructor, issuer, database adapter, caller, Tauri command, credential path, or
//! registry wiring exists. The older proof-composition harness remains test-only and still creates
//! no database, mutation, execution, Receipt, retry, request-dispatch, or release authority.

#![allow(dead_code)]

mod precommit;
