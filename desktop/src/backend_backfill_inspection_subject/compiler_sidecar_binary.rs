//! Compile-time-pinned, candidate-only Backend Compiler sidecar byte verifier.
//!
//! The default build embeds `Unavailable`. A build may embed a candidate pin only after build.rs
//! independently verifies an explicitly selected manifest and binary. This module can re-verify
//! those exact bytes, but cannot locate, spawn, or issue authority from the binary.

use std::{
    fs::{self, File},
    io::Read,
    path::Path,
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use sha2::{Digest, Sha256};

const MINIMUM_BINARY_BYTES: u64 = 1_000_000;
const MAXIMUM_BINARY_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Clone, Copy)]
enum CompiledBackendCompilerSidecarPinV1 {
    Unavailable,
    Available {
        target: &'static str,
        binary_name: &'static str,
        byte_length: u64,
        sha256: &'static str,
    },
}

include!(concat!(env!("OUT_DIR"), "/backend_compiler_sidecar_pin.rs"));

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum BackendCompilerSidecarBinaryErrorV1 {
    PinUnavailable,
    PinInvalid,
    PathInvalid,
    FileInvalid,
    LengthMismatch,
    HeaderMismatch,
    DigestMismatch,
}

pub(super) struct VerifiedBackendCompilerSidecarBinaryV1 {
    _file: File,
    target: &'static str,
    binary_name: &'static str,
    byte_length: u64,
    sha256: &'static str,
}

impl VerifiedBackendCompilerSidecarBinaryV1 {
    #[cfg(unix)]
    pub(super) fn read_at(
        &self,
        output: &mut [u8],
        offset: u64,
    ) -> Result<usize, BackendCompilerSidecarBinaryErrorV1> {
        use std::os::unix::fs::FileExt;

        self._file
            .read_at(output, offset)
            .map_err(|_| BackendCompilerSidecarBinaryErrorV1::FileInvalid)
    }

    #[cfg(windows)]
    pub(super) fn read_at(
        &self,
        output: &mut [u8],
        offset: u64,
    ) -> Result<usize, BackendCompilerSidecarBinaryErrorV1> {
        use std::os::windows::fs::FileExt;

        self._file
            .seek_read(output, offset)
            .map_err(|_| BackendCompilerSidecarBinaryErrorV1::FileInvalid)
    }

    pub(super) const fn binary_name(&self) -> &'static str {
        self.binary_name
    }

    pub(super) const fn byte_length(&self) -> u64 {
        self.byte_length
    }

    pub(super) const fn sha256(&self) -> &'static str {
        self.sha256
    }

    pub(super) const fn execution_authority_created(&self) -> bool {
        false
    }

    pub(super) const fn registry_issuer_authority_created(&self) -> bool {
        false
    }

    pub(super) const fn release_authority_created(&self) -> bool {
        false
    }
}

#[derive(Clone, Copy)]
enum BinaryFormatV1 {
    ElfX64,
    MachArm64,
    MachX64,
    PeArm64,
    PeX64,
}

fn target_format(target: &str) -> Option<BinaryFormatV1> {
    match target {
        "aarch64-apple-darwin" => Some(BinaryFormatV1::MachArm64),
        "x86_64-apple-darwin" => Some(BinaryFormatV1::MachX64),
        "aarch64-pc-windows-msvc" => Some(BinaryFormatV1::PeArm64),
        "x86_64-pc-windows-msvc" => Some(BinaryFormatV1::PeX64),
        "x86_64-unknown-linux-gnu" => Some(BinaryFormatV1::ElfX64),
        _ => None,
    }
}

fn expected_binary_name(target: &str) -> Option<String> {
    target_format(target)?;
    let extension = if target.contains("windows") {
        ".exe"
    } else {
        ""
    };
    Some(format!(
        "openpencil-backend-compiler-sidecar-{target}{extension}"
    ))
}

fn read_u16_le(bytes: &[u8], offset: usize) -> Option<u16> {
    let slice = bytes.get(offset..offset.checked_add(2)?)?;
    Some(u16::from_le_bytes([slice[0], slice[1]]))
}

fn read_u32_le(bytes: &[u8], offset: usize) -> Option<u32> {
    let slice = bytes.get(offset..offset.checked_add(4)?)?;
    Some(u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

fn header_matches(bytes: &[u8], format: BinaryFormatV1) -> bool {
    match format {
        BinaryFormatV1::ElfX64 => {
            bytes.starts_with(&[0x7f, b'E', b'L', b'F']) && read_u16_le(bytes, 18) == Some(0x3e)
        }
        BinaryFormatV1::MachArm64 | BinaryFormatV1::MachX64 => {
            let expected = match format {
                BinaryFormatV1::MachArm64 => 0x0100_000c,
                BinaryFormatV1::MachX64 => 0x0100_0007,
                _ => unreachable!(),
            };
            bytes.starts_with(&[0xcf, 0xfa, 0xed, 0xfe]) && read_u32_le(bytes, 4) == Some(expected)
        }
        BinaryFormatV1::PeArm64 | BinaryFormatV1::PeX64 => {
            if !bytes.starts_with(b"MZ") {
                return false;
            }
            let Some(offset) = read_u32_le(bytes, 0x3c).map(|value| value as usize) else {
                return false;
            };
            let expected = match format {
                BinaryFormatV1::PeArm64 => 0xaa64,
                BinaryFormatV1::PeX64 => 0x8664,
                _ => unreachable!(),
            };
            bytes.get(offset..offset.saturating_add(4)) == Some(b"PE\0\0")
                && read_u16_le(bytes, offset.saturating_add(4)) == Some(expected)
        }
    }
}

#[cfg(unix)]
fn same_opened_file(before: &fs::Metadata, opened: &fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;

    before.dev() == opened.dev()
        && before.ino() == opened.ino()
        && before.len() == opened.len()
        && opened.nlink() == 1
        && opened.mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn same_opened_file(before: &fs::Metadata, opened: &fs::Metadata) -> bool {
    before.len() == opened.len()
}

fn verify_against_pin(
    path: &Path,
    pin: CompiledBackendCompilerSidecarPinV1,
) -> Result<VerifiedBackendCompilerSidecarBinaryV1, BackendCompilerSidecarBinaryErrorV1> {
    let CompiledBackendCompilerSidecarPinV1::Available {
        target,
        binary_name,
        byte_length,
        sha256,
    } = pin
    else {
        return Err(BackendCompilerSidecarBinaryErrorV1::PinUnavailable);
    };
    let format = target_format(target).ok_or(BackendCompilerSidecarBinaryErrorV1::PinInvalid)?;
    if expected_binary_name(target).as_deref() != Some(binary_name) {
        return Err(BackendCompilerSidecarBinaryErrorV1::PinInvalid);
    }
    let expected_digest = URL_SAFE_NO_PAD
        .decode(sha256.as_bytes())
        .map_err(|_| BackendCompilerSidecarBinaryErrorV1::PinInvalid)?;
    if expected_digest.len() != 32
        || URL_SAFE_NO_PAD.encode(&expected_digest) != sha256
        || !(MINIMUM_BINARY_BYTES..=MAXIMUM_BINARY_BYTES).contains(&byte_length)
    {
        return Err(BackendCompilerSidecarBinaryErrorV1::PinInvalid);
    }
    if !path.is_absolute() || path.file_name().and_then(|value| value.to_str()) != Some(binary_name)
    {
        return Err(BackendCompilerSidecarBinaryErrorV1::PathInvalid);
    }
    let before =
        fs::symlink_metadata(path).map_err(|_| BackendCompilerSidecarBinaryErrorV1::FileInvalid)?;
    if before.file_type().is_symlink() || !before.is_file() {
        return Err(BackendCompilerSidecarBinaryErrorV1::FileInvalid);
    }
    if before.len() != byte_length {
        return Err(BackendCompilerSidecarBinaryErrorV1::LengthMismatch);
    }
    let mut file =
        File::open(path).map_err(|_| BackendCompilerSidecarBinaryErrorV1::FileInvalid)?;
    let opened = file
        .metadata()
        .map_err(|_| BackendCompilerSidecarBinaryErrorV1::FileInvalid)?;
    if !same_opened_file(&before, &opened) {
        return Err(BackendCompilerSidecarBinaryErrorV1::FileInvalid);
    }
    let mut digest = Sha256::new();
    let mut header = Vec::with_capacity(4_096);
    let mut chunk = [0_u8; 64 * 1_024];
    let mut observed_length = 0_u64;
    loop {
        let count = file
            .read(&mut chunk)
            .map_err(|_| BackendCompilerSidecarBinaryErrorV1::FileInvalid)?;
        if count == 0 {
            break;
        }
        observed_length = observed_length
            .checked_add(count as u64)
            .ok_or(BackendCompilerSidecarBinaryErrorV1::LengthMismatch)?;
        if observed_length > byte_length {
            return Err(BackendCompilerSidecarBinaryErrorV1::LengthMismatch);
        }
        if header.len() < 4_096 {
            let remaining = 4_096 - header.len();
            header.extend_from_slice(&chunk[..count.min(remaining)]);
        }
        digest.update(&chunk[..count]);
    }
    if observed_length != byte_length {
        return Err(BackendCompilerSidecarBinaryErrorV1::LengthMismatch);
    }
    if !header_matches(&header, format) {
        return Err(BackendCompilerSidecarBinaryErrorV1::HeaderMismatch);
    }
    if digest.finalize().as_slice() != expected_digest {
        return Err(BackendCompilerSidecarBinaryErrorV1::DigestMismatch);
    }
    Ok(VerifiedBackendCompilerSidecarBinaryV1 {
        _file: file,
        target,
        binary_name,
        byte_length,
        sha256,
    })
}

pub(super) fn verify_compiled_backend_compiler_sidecar_binary(
    path: &Path,
) -> Result<VerifiedBackendCompilerSidecarBinaryV1, BackendCompilerSidecarBinaryErrorV1> {
    verify_against_pin(path, COMPILED_BACKEND_COMPILER_SIDECAR_PIN_V1)
}

/// Test-only equivalent of the build-time candidate proof. It binds one exact, already-opened
/// executable file to its byte length and digest without manufacturing a production pin.
#[cfg(test)]
pub(super) fn verify_backend_compiler_sidecar_candidate_for_test(
    path: &Path,
) -> Result<VerifiedBackendCompilerSidecarBinaryV1, BackendCompilerSidecarBinaryErrorV1> {
    if !path.is_absolute()
        || path.file_name().and_then(|value| value.to_str())
            != Some("openpencil-backend-compiler-sidecar-test")
    {
        return Err(BackendCompilerSidecarBinaryErrorV1::PathInvalid);
    }
    let before =
        fs::symlink_metadata(path).map_err(|_| BackendCompilerSidecarBinaryErrorV1::FileInvalid)?;
    if before.file_type().is_symlink() || !before.is_file() {
        return Err(BackendCompilerSidecarBinaryErrorV1::FileInvalid);
    }
    let mut file =
        File::open(path).map_err(|_| BackendCompilerSidecarBinaryErrorV1::FileInvalid)?;
    let opened = file
        .metadata()
        .map_err(|_| BackendCompilerSidecarBinaryErrorV1::FileInvalid)?;
    if !same_opened_file(&before, &opened) {
        return Err(BackendCompilerSidecarBinaryErrorV1::FileInvalid);
    }
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|_| BackendCompilerSidecarBinaryErrorV1::FileInvalid)?;
    if bytes.is_empty() {
        return Err(BackendCompilerSidecarBinaryErrorV1::LengthMismatch);
    }
    let digest = URL_SAFE_NO_PAD.encode(Sha256::digest(&bytes));
    let digest = Box::leak(digest.into_boxed_str());
    Ok(VerifiedBackendCompilerSidecarBinaryV1 {
        _file: file,
        target: "test-only",
        binary_name: "openpencil-backend-compiler-sidecar-test",
        byte_length: before.len(),
        sha256: digest,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Seek, SeekFrom, Write};
    use std::path::PathBuf;

    fn mach_arm64_binary(path: &Path) -> Vec<u8> {
        let mut bytes = vec![0_u8; MINIMUM_BINARY_BYTES as usize];
        bytes[..4].copy_from_slice(&[0xcf, 0xfa, 0xed, 0xfe]);
        bytes[4..8].copy_from_slice(&0x0100_000c_u32.to_le_bytes());
        fs::write(path, &bytes).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
        }
        bytes
    }

    fn pin(bytes: &[u8]) -> CompiledBackendCompilerSidecarPinV1 {
        let digest = URL_SAFE_NO_PAD.encode(Sha256::digest(bytes));
        let digest: &'static str = Box::leak(digest.into_boxed_str());
        CompiledBackendCompilerSidecarPinV1::Available {
            target: "aarch64-apple-darwin",
            binary_name: "openpencil-backend-compiler-sidecar-aarch64-apple-darwin",
            byte_length: bytes.len() as u64,
            sha256: digest,
        }
    }

    fn pin_with_length(
        pin: CompiledBackendCompilerSidecarPinV1,
        byte_length: u64,
    ) -> CompiledBackendCompilerSidecarPinV1 {
        let CompiledBackendCompilerSidecarPinV1::Available {
            target,
            binary_name,
            sha256,
            ..
        } = pin
        else {
            unreachable!()
        };
        CompiledBackendCompilerSidecarPinV1::Available {
            target,
            binary_name,
            byte_length,
            sha256,
        }
    }

    #[test]
    fn default_compiled_pin_never_accepts_an_unselected_binary() {
        let result = verify_compiled_backend_compiler_sidecar_binary(Path::new("missing"));
        assert!(result.is_err());
        if matches!(
            COMPILED_BACKEND_COMPILER_SIDECAR_PIN_V1,
            CompiledBackendCompilerSidecarPinV1::Unavailable
        ) {
            assert_eq!(
                result.err().unwrap(),
                BackendCompilerSidecarBinaryErrorV1::PinUnavailable
            );
        }
    }

    #[test]
    fn explicitly_selected_build_pin_reverifies_the_same_candidate_when_present() {
        let CompiledBackendCompilerSidecarPinV1::Available { binary_name, .. } =
            COMPILED_BACKEND_COMPILER_SIDECAR_PIN_V1
        else {
            return;
        };
        let manifest_path = std::env::var_os("OPENPENCIL_BACKEND_COMPILER_SIDECAR_PIN_MANIFEST")
            .map(PathBuf::from)
            .expect("available test pin must come from the explicit candidate manifest");
        let binary_path = manifest_path
            .parent()
            .expect("candidate manifest must have a parent")
            .join(binary_name);
        let verified = verify_compiled_backend_compiler_sidecar_binary(&binary_path).unwrap();
        assert!(!verified.execution_authority_created());
        assert!(!verified.registry_issuer_authority_created());
        assert!(!verified.release_authority_created());
    }

    #[test]
    fn exact_absolute_candidate_bytes_return_only_non_authoritative_opaque_proof() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory
            .path()
            .join("openpencil-backend-compiler-sidecar-aarch64-apple-darwin");
        let bytes = mach_arm64_binary(&path);
        let verified = verify_against_pin(&path, pin(&bytes)).unwrap();
        assert_eq!(verified.target, "aarch64-apple-darwin");
        assert_eq!(
            verified.binary_name,
            "openpencil-backend-compiler-sidecar-aarch64-apple-darwin"
        );
        assert_eq!(verified.byte_length, bytes.len() as u64);
        assert_eq!(
            verified.sha256,
            URL_SAFE_NO_PAD.encode(Sha256::digest(bytes))
        );
        assert!(!verified.execution_authority_created());
        assert!(!verified.registry_issuer_authority_created());
        assert!(!verified.release_authority_created());
    }

    #[test]
    fn rejects_relative_name_length_header_digest_and_symlink_tamper() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory
            .path()
            .join("openpencil-backend-compiler-sidecar-aarch64-apple-darwin");
        let bytes = mach_arm64_binary(&path);
        let exact_pin = pin(&bytes);
        assert_eq!(
            verify_against_pin(Path::new(path.file_name().unwrap()), exact_pin)
                .err()
                .unwrap(),
            BackendCompilerSidecarBinaryErrorV1::PathInvalid
        );

        let wrong_name = directory.path().join("foreign");
        fs::copy(&path, &wrong_name).unwrap();
        assert_eq!(
            verify_against_pin(&wrong_name, exact_pin).err().unwrap(),
            BackendCompilerSidecarBinaryErrorV1::PathInvalid
        );

        let short_pin = pin_with_length(exact_pin, bytes.len() as u64 + 1);
        assert_eq!(
            verify_against_pin(&path, short_pin).err().unwrap(),
            BackendCompilerSidecarBinaryErrorV1::LengthMismatch
        );

        let mut file = fs::OpenOptions::new().write(true).open(&path).unwrap();
        file.write_all(b"X").unwrap();
        file.flush().unwrap();
        assert_eq!(
            verify_against_pin(&path, exact_pin).err().unwrap(),
            BackendCompilerSidecarBinaryErrorV1::HeaderMismatch
        );

        file.seek(SeekFrom::Start(128)).unwrap();
        file.write_all(b"Y").unwrap();
        file.flush().unwrap();
        let header_tampered = mach_arm64_binary(&path);
        let digest_pin = pin(&header_tampered);
        let mut file = fs::OpenOptions::new().write(true).open(&path).unwrap();
        file.seek(SeekFrom::Start(128)).unwrap();
        file.write_all(b"Z").unwrap();
        file.flush().unwrap();
        assert_eq!(
            verify_against_pin(&path, digest_pin).err().unwrap(),
            BackendCompilerSidecarBinaryErrorV1::DigestMismatch
        );

        #[cfg(unix)]
        {
            let link_directory = tempfile::tempdir().unwrap();
            let symlink = link_directory
                .path()
                .join("openpencil-backend-compiler-sidecar-aarch64-apple-darwin");
            std::os::unix::fs::symlink(&path, &symlink).unwrap();
            assert_eq!(
                verify_against_pin(&symlink, exact_pin).err().unwrap(),
                BackendCompilerSidecarBinaryErrorV1::FileInvalid
            );
        }
    }

    #[test]
    fn source_contains_no_process_renderer_issuer_or_external_authority() {
        let source = include_str!("compiler_sidecar_binary.rs");
        for forbidden in [
            concat!("std", "::process"),
            concat!("tokio", "::process"),
            concat!("Command", "::new"),
            concat!("#[tauri", "::command]"),
            concat!("reqwest", "::"),
            concat!("sqlx", "::"),
            concat!("BackendBackfillInspection", "SubjectRegistryV1"),
            concat!("SealedBackfillInspection", "SubjectProofV1"),
            concat!("Credential", "Resolver"),
        ] {
            assert!(!source.contains(forbidden), "forbidden source: {forbidden}");
        }
        assert!(!source.contains(concat!(
            "impl Clone for VerifiedBackendCompiler",
            "SidecarBinaryV1"
        )));
        assert!(!source.contains(concat!(
            "Serialize for VerifiedBackendCompiler",
            "SidecarBinaryV1"
        )));
    }
}
