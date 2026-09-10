#[path = "src/app_commands.rs"]
mod app_commands;
#[path = "build_support/backend_compiler_sidecar_pin.rs"]
mod backend_compiler_sidecar_pin;

use std::{env, fs, path::PathBuf};

const PIN_MANIFEST_ENV: &str = "OPENPENCIL_BACKEND_COMPILER_SIDECAR_PIN_MANIFEST";

fn write_backend_compiler_sidecar_pin() {
    println!("cargo:rerun-if-env-changed={PIN_MANIFEST_ENV}");
    println!("cargo:rerun-if-changed=build_support/backend_compiler_sidecar_pin.rs");
    let output = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo must set OUT_DIR"))
        .join("backend_compiler_sidecar_pin.rs");
    let source = match env::var_os(PIN_MANIFEST_ENV) {
        None => backend_compiler_sidecar_pin::generated_unavailable_pin_source(),
        Some(path) if path.is_empty() => {
            panic!("Backend Compiler sidecar pin manifest path must not be empty")
        }
        Some(path) => {
            let path = PathBuf::from(path);
            let target = env::var("TARGET").expect("Cargo must set TARGET");
            let pin = backend_compiler_sidecar_pin::verify_candidate_manifest(&path, &target)
                .expect("Backend Compiler sidecar candidate pin verification failed");
            println!("cargo:rerun-if-changed={}", path.display());
            println!("cargo:rerun-if-changed={}", pin.binary_path.display());
            backend_compiler_sidecar_pin::generated_available_pin_source(&pin)
        }
    };
    fs::write(output, source).expect("failed to write Backend Compiler sidecar pin");
}

fn main() {
    write_backend_compiler_sidecar_pin();
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(app_commands::APP_COMMANDS)),
    )
    .expect("failed to build the Tauri application manifest")
}
