use std::{
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const CANDIDATE_FORMAT: &str = "openpencil.backend-compiler-sidecar-candidate-provenance.v1";
const BINARY_BASENAME: &str = "openpencil-backend-compiler-sidecar";
const MINIMUM_BINARY_BYTES: u64 = 1_000_000;
const MAXIMUM_BINARY_BYTES: u64 = 256 * 1024 * 1024;
const MAXIMUM_MANIFEST_BYTES: usize = 4_096;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CandidatePinErrorV1 {
    ManifestFile,
    ManifestLimit,
    ManifestCanonical,
    ManifestContract,
    TargetMismatch,
    BinaryFile,
    BinaryLength,
    BinaryHeader,
    BinaryMode,
    BinaryDigest,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CandidateManifestV1 {
    byte_length: u64,
    binary_name: String,
    execution_authority_created: bool,
    format: String,
    protocol_version: u8,
    registry_issuer_authority_created: bool,
    release_authority_created: bool,
    sha256: String,
    target: String,
    version: u8,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct VerifiedCandidatePinV1 {
    pub(crate) target: String,
    pub(crate) binary_name: String,
    pub(crate) byte_length: u64,
    pub(crate) sha256: String,
    pub(crate) binary_path: PathBuf,
}

#[derive(Clone, Copy)]
struct TargetFormatV1 {
    extension: &'static str,
    format: BinaryFormatV1,
}

#[derive(Clone, Copy)]
enum BinaryFormatV1 {
    ElfX64,
    MachArm64,
    MachX64,
    PeArm64,
    PeX64,
}

fn target_format(target: &str) -> Option<TargetFormatV1> {
    match target {
        "aarch64-apple-darwin" => Some(TargetFormatV1 {
            extension: "",
            format: BinaryFormatV1::MachArm64,
        }),
        "x86_64-apple-darwin" => Some(TargetFormatV1 {
            extension: "",
            format: BinaryFormatV1::MachX64,
        }),
        "aarch64-pc-windows-msvc" => Some(TargetFormatV1 {
            extension: ".exe",
            format: BinaryFormatV1::PeArm64,
        }),
        "x86_64-pc-windows-msvc" => Some(TargetFormatV1 {
            extension: ".exe",
            format: BinaryFormatV1::PeX64,
        }),
        "x86_64-unknown-linux-gnu" => Some(TargetFormatV1 {
            extension: "",
            format: BinaryFormatV1::ElfX64,
        }),
        _ => None,
    }
}

fn expected_binary_name(target: &str, format: TargetFormatV1) -> String {
    format!("{BINARY_BASENAME}-{target}{}", format.extension)
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

fn regular_file(path: &Path, manifest: bool) -> Result<fs::Metadata, CandidatePinErrorV1> {
    let error = if manifest {
        CandidatePinErrorV1::ManifestFile
    } else {
        CandidatePinErrorV1::BinaryFile
    };
    let metadata = fs::symlink_metadata(path).map_err(|_| error)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(error);
    }
    Ok(metadata)
}

#[cfg(unix)]
fn executable_mode(metadata: &fs::Metadata, format: TargetFormatV1) -> bool {
    use std::os::unix::fs::PermissionsExt;

    !format.extension.is_empty() || metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn executable_mode(_metadata: &fs::Metadata, _format: TargetFormatV1) -> bool {
    true
}

fn digest_and_header(
    file: &mut File,
    format: TargetFormatV1,
) -> Result<String, CandidatePinErrorV1> {
    let mut header = [0_u8; 4_096];
    let header_length = file
        .read(&mut header)
        .map_err(|_| CandidatePinErrorV1::BinaryFile)?;
    if !header_matches(&header[..header_length], format.format) {
        return Err(CandidatePinErrorV1::BinaryHeader);
    }
    file.seek(SeekFrom::Start(0))
        .map_err(|_| CandidatePinErrorV1::BinaryFile)?;
    let mut digest = Sha256::new();
    let mut chunk = [0_u8; 64 * 1_024];
    loop {
        let count = file
            .read(&mut chunk)
            .map_err(|_| CandidatePinErrorV1::BinaryFile)?;
        if count == 0 {
            break;
        }
        digest.update(&chunk[..count]);
    }
    Ok(URL_SAFE_NO_PAD.encode(digest.finalize()))
}

pub(crate) fn verify_candidate_manifest(
    manifest_path: &Path,
    expected_target: &str,
) -> Result<VerifiedCandidatePinV1, CandidatePinErrorV1> {
    let target = target_format(expected_target).ok_or(CandidatePinErrorV1::TargetMismatch)?;
    let manifest_metadata = regular_file(manifest_path, true)?;
    if manifest_metadata.len() == 0 || manifest_metadata.len() > MAXIMUM_MANIFEST_BYTES as u64 {
        return Err(CandidatePinErrorV1::ManifestLimit);
    }
    let manifest_bytes = fs::read(manifest_path).map_err(|_| CandidatePinErrorV1::ManifestFile)?;
    if manifest_bytes.is_empty()
        || manifest_bytes.len() > MAXIMUM_MANIFEST_BYTES
        || manifest_bytes.last() != Some(&b'\n')
        || manifest_bytes[..manifest_bytes.len() - 1].contains(&b'\n')
        || manifest_bytes.contains(&b'\r')
    {
        return Err(CandidatePinErrorV1::ManifestCanonical);
    }
    let manifest: CandidateManifestV1 =
        serde_json::from_slice(&manifest_bytes[..manifest_bytes.len() - 1])
            .map_err(|_| CandidatePinErrorV1::ManifestCanonical)?;
    let mut canonical =
        serde_json::to_vec(&manifest).map_err(|_| CandidatePinErrorV1::ManifestCanonical)?;
    canonical.push(b'\n');
    if canonical != manifest_bytes {
        return Err(CandidatePinErrorV1::ManifestCanonical);
    }
    if manifest.format != CANDIDATE_FORMAT
        || manifest.version != 1
        || manifest.protocol_version != 1
        || manifest.execution_authority_created
        || manifest.registry_issuer_authority_created
        || manifest.release_authority_created
    {
        return Err(CandidatePinErrorV1::ManifestContract);
    }
    if manifest.target != expected_target {
        return Err(CandidatePinErrorV1::TargetMismatch);
    }
    let binary_name = expected_binary_name(expected_target, target);
    if manifest.binary_name != binary_name
        || manifest_path.file_name().and_then(|value| value.to_str())
            != Some(&format!("{binary_name}.candidate-provenance-v1.json"))
    {
        return Err(CandidatePinErrorV1::ManifestContract);
    }
    let digest = URL_SAFE_NO_PAD
        .decode(manifest.sha256.as_bytes())
        .map_err(|_| CandidatePinErrorV1::ManifestContract)?;
    if digest.len() != 32 || URL_SAFE_NO_PAD.encode(&digest) != manifest.sha256 {
        return Err(CandidatePinErrorV1::ManifestContract);
    }
    if !(MINIMUM_BINARY_BYTES..=MAXIMUM_BINARY_BYTES).contains(&manifest.byte_length) {
        return Err(CandidatePinErrorV1::BinaryLength);
    }
    let parent = manifest_path
        .parent()
        .ok_or(CandidatePinErrorV1::ManifestFile)?;
    let binary_path = parent.join(&binary_name);
    let metadata = regular_file(&binary_path, false)?;
    if metadata.len() != manifest.byte_length {
        return Err(CandidatePinErrorV1::BinaryLength);
    }
    if !executable_mode(&metadata, target) {
        return Err(CandidatePinErrorV1::BinaryMode);
    }
    let mut binary = File::open(&binary_path).map_err(|_| CandidatePinErrorV1::BinaryFile)?;
    let observed_digest = digest_and_header(&mut binary, target)?;
    if observed_digest != manifest.sha256 {
        return Err(CandidatePinErrorV1::BinaryDigest);
    }
    Ok(VerifiedCandidatePinV1 {
        target: manifest.target,
        binary_name: manifest.binary_name,
        byte_length: manifest.byte_length,
        sha256: manifest.sha256,
        binary_path,
    })
}

pub(crate) fn generated_unavailable_pin_source() -> String {
    "const COMPILED_BACKEND_COMPILER_SIDECAR_PIN_V1: CompiledBackendCompilerSidecarPinV1 = CompiledBackendCompilerSidecarPinV1::Unavailable;\n".to_owned()
}

pub(crate) fn generated_available_pin_source(pin: &VerifiedCandidatePinV1) -> String {
    format!(
        "const COMPILED_BACKEND_COMPILER_SIDECAR_PIN_V1: CompiledBackendCompilerSidecarPinV1 = CompiledBackendCompilerSidecarPinV1::Available {{ target: {:?}, binary_name: {:?}, byte_length: {}, sha256: {:?} }};\n",
        pin.target, pin.binary_name, pin.byte_length, pin.sha256
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn candidate_bytes(target: &str) -> Vec<u8> {
        let mut bytes = vec![0_u8; MINIMUM_BINARY_BYTES as usize];
        match target_format(target).unwrap().format {
            BinaryFormatV1::ElfX64 => {
                bytes[..4].copy_from_slice(&[0x7f, b'E', b'L', b'F']);
                bytes[18..20].copy_from_slice(&0x3e_u16.to_le_bytes());
            }
            BinaryFormatV1::MachArm64 => {
                bytes[..4].copy_from_slice(&[0xcf, 0xfa, 0xed, 0xfe]);
                bytes[4..8].copy_from_slice(&0x0100_000c_u32.to_le_bytes());
            }
            BinaryFormatV1::MachX64 => {
                bytes[..4].copy_from_slice(&[0xcf, 0xfa, 0xed, 0xfe]);
                bytes[4..8].copy_from_slice(&0x0100_0007_u32.to_le_bytes());
            }
            BinaryFormatV1::PeArm64 | BinaryFormatV1::PeX64 => {
                bytes[..2].copy_from_slice(b"MZ");
                bytes[0x3c..0x40].copy_from_slice(&0x80_u32.to_le_bytes());
                bytes[0x80..0x84].copy_from_slice(b"PE\0\0");
                let machine: u16 = if matches!(
                    target_format(target).unwrap().format,
                    BinaryFormatV1::PeArm64
                ) {
                    0xaa64
                } else {
                    0x8664
                };
                bytes[0x84..0x86].copy_from_slice(&machine.to_le_bytes());
            }
        }
        bytes
    }

    fn write_candidate(directory: &Path, target: &str) -> (PathBuf, CandidateManifestV1) {
        let format = target_format(target).unwrap();
        let binary_name = expected_binary_name(target, format);
        let binary_path = directory.join(&binary_name);
        let bytes = candidate_bytes(target);
        let mut file = File::create(&binary_path).unwrap();
        file.write_all(&bytes).unwrap();
        file.sync_all().unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&binary_path, fs::Permissions::from_mode(0o755)).unwrap();
        }
        let manifest = CandidateManifestV1 {
            byte_length: bytes.len() as u64,
            binary_name: binary_name.clone(),
            execution_authority_created: false,
            format: CANDIDATE_FORMAT.to_owned(),
            protocol_version: 1,
            registry_issuer_authority_created: false,
            release_authority_created: false,
            sha256: URL_SAFE_NO_PAD.encode(Sha256::digest(&bytes)),
            target: target.to_owned(),
            version: 1,
        };
        let manifest_path = directory.join(format!("{binary_name}.candidate-provenance-v1.json"));
        let mut encoded = serde_json::to_vec(&manifest).unwrap();
        encoded.push(b'\n');
        fs::write(&manifest_path, encoded).unwrap();
        (manifest_path, manifest)
    }

    #[test]
    fn verifies_each_supported_header_and_emits_literal_pin_source() {
        for target in [
            "aarch64-apple-darwin",
            "x86_64-apple-darwin",
            "aarch64-pc-windows-msvc",
            "x86_64-pc-windows-msvc",
            "x86_64-unknown-linux-gnu",
        ] {
            let directory = tempfile::tempdir().unwrap();
            let (manifest_path, expected) = write_candidate(directory.path(), target);
            let pin = verify_candidate_manifest(&manifest_path, target).unwrap();
            assert_eq!(pin.target, target);
            assert_eq!(pin.binary_name, expected.binary_name);
            assert_eq!(pin.byte_length, expected.byte_length);
            assert_eq!(pin.sha256, expected.sha256);
            let generated = generated_available_pin_source(&pin);
            assert!(generated.contains("CompiledBackendCompilerSidecarPinV1::Available"));
            assert!(generated.contains(&format!("{:?}", target)));
        }
        assert!(generated_unavailable_pin_source().contains("::Unavailable"));
    }

    #[test]
    fn rejects_noncanonical_authoritative_target_and_binary_tamper() {
        let directory = tempfile::tempdir().unwrap();
        let target = "aarch64-apple-darwin";
        let (manifest_path, _) = write_candidate(directory.path(), target);
        let canonical = fs::read(&manifest_path).unwrap();

        let mut spaced = b" ".to_vec();
        spaced.extend_from_slice(&canonical);
        fs::write(&manifest_path, spaced).unwrap();
        assert_eq!(
            verify_candidate_manifest(&manifest_path, target).unwrap_err(),
            CandidatePinErrorV1::ManifestCanonical
        );

        let (_, mut manifest) = write_candidate(directory.path(), target);
        manifest.release_authority_created = true;
        let mut encoded = serde_json::to_vec(&manifest).unwrap();
        encoded.push(b'\n');
        fs::write(&manifest_path, encoded).unwrap();
        assert_eq!(
            verify_candidate_manifest(&manifest_path, target).unwrap_err(),
            CandidatePinErrorV1::ManifestContract
        );

        let (_, _) = write_candidate(directory.path(), target);
        assert_eq!(
            verify_candidate_manifest(&manifest_path, "x86_64-apple-darwin").unwrap_err(),
            CandidatePinErrorV1::TargetMismatch
        );

        let (_, _) = write_candidate(directory.path(), target);
        let binary_name = expected_binary_name(target, target_format(target).unwrap());
        let binary_path = directory.path().join(binary_name);
        let mut file = fs::OpenOptions::new()
            .write(true)
            .open(binary_path)
            .unwrap();
        file.write_all(b"X").unwrap();
        assert_eq!(
            verify_candidate_manifest(&manifest_path, target).unwrap_err(),
            CandidatePinErrorV1::BinaryHeader
        );
    }
}
