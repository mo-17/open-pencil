use std::{
    fs::{self, OpenOptions},
    io,
    path::{Path, PathBuf},
};

use tauri::AppHandle;
use tauri_plugin_fs::FsExt;

const TEMPORARY_SEPARATOR: &str = ".openpencil-";
const TEMPORARY_SUFFIX: &str = ".tmp";

#[derive(Debug)]
struct ValidatedSourceExportPaths {
    temporary: PathBuf,
    target: PathBuf,
}

fn invalid_path(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}

fn denied_path(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::PermissionDenied, message)
}

fn is_canonical_random_uuid(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => *byte == b'-',
            _ => byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'),
        })
        && bytes[14] == b'4'
        && matches!(bytes[19], b'8' | b'9' | b'a' | b'b')
}

fn validate_temporary_name(temporary: &Path, target: &Path) -> io::Result<()> {
    let target_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty() && !name.contains('\0'))
        .ok_or_else(|| invalid_path("Source export target has an invalid file name"))?;
    let temporary_name = temporary
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty() && !name.contains('\0'))
        .ok_or_else(|| invalid_path("Source export temporary path has an invalid file name"))?;
    let prefix = format!("{target_name}{TEMPORARY_SEPARATOR}");
    let Some(random_id) = temporary_name
        .strip_prefix(&prefix)
        .and_then(|value| value.strip_suffix(TEMPORARY_SUFFIX))
    else {
        return Err(invalid_path(
            "Source export temporary file name does not match the target",
        ));
    };
    if !is_canonical_random_uuid(random_id) {
        return Err(invalid_path(
            "Source export temporary file name has an invalid random identifier",
        ));
    }
    Ok(())
}

fn validate_source_export_paths<F>(
    temporary: &Path,
    target: &Path,
    is_allowed: &F,
) -> io::Result<ValidatedSourceExportPaths>
where
    F: Fn(&Path) -> bool,
{
    if !temporary.is_absolute() || !target.is_absolute() {
        return Err(invalid_path("Source export paths must be absolute"));
    }
    if temporary == target {
        return Err(invalid_path(
            "Source export temporary and target paths must be different",
        ));
    }

    let temporary_parent = temporary
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .ok_or_else(|| invalid_path("Source export temporary path has no parent directory"))?;
    let target_parent = target
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .ok_or_else(|| invalid_path("Source export target has no parent directory"))?;
    if temporary_parent != target_parent {
        return Err(invalid_path(
            "Source export temporary and target paths must share a directory",
        ));
    }
    validate_temporary_name(temporary, target)?;

    let parent_metadata = fs::symlink_metadata(target_parent)?;
    if parent_metadata.file_type().is_symlink() || !parent_metadata.is_dir() {
        return Err(denied_path(
            "Source export parent must be a real directory, not a symbolic link",
        ));
    }
    let canonical_parent = fs::canonicalize(target_parent)?;

    let temporary_metadata = fs::symlink_metadata(temporary)?;
    if temporary_metadata.file_type().is_symlink() || !temporary_metadata.is_file() {
        return Err(denied_path(
            "Source export temporary path must be a regular file",
        ));
    }
    let canonical_temporary = fs::canonicalize(temporary)?;
    if canonical_temporary.parent() != Some(canonical_parent.as_path()) {
        return Err(denied_path(
            "Source export temporary file resolves outside its parent directory",
        ));
    }

    let canonical_target = match fs::symlink_metadata(target) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(denied_path(
                    "Source export target must be absent or a regular file",
                ));
            }
            let resolved = fs::canonicalize(target)?;
            if resolved.parent() != Some(canonical_parent.as_path()) {
                return Err(denied_path(
                    "Source export target resolves outside its parent directory",
                ));
            }
            resolved
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => canonical_parent.join(
            target
                .file_name()
                .ok_or_else(|| invalid_path("Source export target has no file name"))?,
        ),
        Err(error) => return Err(error),
    };

    for path in [temporary, target, &canonical_temporary, &canonical_target] {
        if !is_allowed(path) {
            return Err(denied_path(
                "Source export path is outside the allowed filesystem scope",
            ));
        }
    }

    Ok(ValidatedSourceExportPaths {
        temporary: temporary.to_path_buf(),
        target: target.to_path_buf(),
    })
}

#[cfg(not(windows))]
fn replace_existing_atomically(temporary: &Path, target: &Path) -> io::Result<()> {
    fs::rename(temporary, target)
}

#[cfg(windows)]
type MoveFileExWSignature = unsafe extern "system" fn(
    windows_sys::core::PCWSTR,
    windows_sys::core::PCWSTR,
    windows_sys::Win32::Storage::FileSystem::MOVE_FILE_FLAGS,
) -> windows_sys::core::BOOL;

// Keep the official windows-sys binding behind an exact compile-time
// signature check. Both Windows release targets in build.yml compile this.
#[cfg(windows)]
const MOVE_FILE_EX_W: MoveFileExWSignature = windows_sys::Win32::Storage::FileSystem::MoveFileExW;

#[cfg(windows)]
fn replace_existing_atomically(temporary: &Path, target: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    fn wide_path(path: &Path) -> io::Result<Vec<u16>> {
        let mut encoded = path.as_os_str().encode_wide().collect::<Vec<_>>();
        if encoded.contains(&0) {
            return Err(invalid_path("Source export path contains a null character"));
        }
        encoded.push(0);
        Ok(encoded)
    }

    let temporary = wide_path(temporary)?;
    let target = wide_path(target)?;
    // MoveFileExW with REPLACE_EXISTING is the Windows rename primitive. Unlike
    // deleting the destination first, a failed call leaves the old destination
    // in place and reports the native error to the caller.
    // SAFETY: both vectors are NUL-terminated and remain alive for the call;
    // validation has already constrained both paths to ordinary files in the
    // same canonical parent and allowed filesystem scope.
    let result = unsafe {
        MOVE_FILE_EX_W(
            temporary.as_ptr(),
            target.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn commit_source_export_file_with<F, R>(
    temporary: &Path,
    target: &Path,
    is_allowed: F,
    replace: R,
) -> io::Result<()>
where
    F: Fn(&Path) -> bool,
    R: FnOnce(&Path, &Path) -> io::Result<()>,
{
    let paths = validate_source_export_paths(temporary, target, &is_allowed)?;

    // Flush staged bytes before the single commit operation. Any error before
    // replace preserves the existing target; no fallible cleanup follows a
    // successful replace, so an Err never means that the target was replaced.
    OpenOptions::new()
        .read(true)
        .write(true)
        .open(&paths.temporary)?
        .sync_all()?;

    // Re-check path kind, canonical parent, and scope after opening/flushing to
    // narrow the window for a path substitution before the native rename.
    let paths = validate_source_export_paths(&paths.temporary, &paths.target, &is_allowed)?;
    replace(&paths.temporary, &paths.target)
}

fn commit_source_export_file_scoped<F>(
    temporary: &Path,
    target: &Path,
    is_allowed: F,
) -> io::Result<()>
where
    F: Fn(&Path) -> bool,
{
    commit_source_export_file_with(temporary, target, is_allowed, replace_existing_atomically)
}

#[tauri::command]
pub async fn commit_source_export_file(
    app: AppHandle,
    temporary_path: String,
    target_path: String,
) -> Result<(), String> {
    let temporary = PathBuf::from(temporary_path);
    let target = PathBuf::from(target_path);
    let scope = app.fs_scope();
    tauri::async_runtime::spawn_blocking(move || {
        commit_source_export_file_scoped(&temporary, &target, |path| scope.is_allowed(path))
    })
    .await
    .map_err(|error| format!("Source export persistence worker failed: {error}"))?
    .map_err(|error| format!("Could not commit source export: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const UUID: &str = "550e8400-e29b-41d4-a716-446655440000";

    fn paths(directory: &Path) -> (PathBuf, PathBuf) {
        let target = directory.join("project.zip");
        let temporary = directory.join(format!("project.zip.openpencil-{UUID}.tmp"));
        (temporary, target)
    }

    #[test]
    fn replaces_an_existing_regular_file_atomically() {
        let directory = tempfile::tempdir().expect("temp directory");
        let (temporary, target) = paths(directory.path());
        fs::write(&temporary, b"replacement").expect("temporary bytes");
        fs::write(&target, b"old bytes").expect("existing target");

        commit_source_export_file_scoped(&temporary, &target, |_| true).expect("atomic replace");

        assert_eq!(fs::read(&target).expect("target bytes"), b"replacement");
        assert!(!temporary.exists());
    }

    #[test]
    fn creates_an_absent_target() {
        let directory = tempfile::tempdir().expect("temp directory");
        let (temporary, target) = paths(directory.path());
        fs::write(&temporary, b"new bytes").expect("temporary bytes");

        commit_source_export_file_scoped(&temporary, &target, |_| true).expect("atomic rename");

        assert_eq!(fs::read(&target).expect("target bytes"), b"new bytes");
        assert!(!temporary.exists());
    }

    #[test]
    fn replacement_failure_preserves_the_old_target_and_staging_file() {
        let directory = tempfile::tempdir().expect("temp directory");
        let (temporary, target) = paths(directory.path());
        fs::write(&temporary, b"replacement").expect("temporary bytes");
        fs::write(&target, b"keep old bytes").expect("existing target");

        let error = commit_source_export_file_with(
            &temporary,
            &target,
            |_| true,
            |_, _| Err(io::Error::other("injected replace failure")),
        )
        .expect_err("replace failure must surface");

        assert_eq!(error.kind(), io::ErrorKind::Other);
        assert_eq!(fs::read(&target).expect("old target"), b"keep old bytes");
        assert_eq!(fs::read(&temporary).expect("staged bytes"), b"replacement");
    }

    #[test]
    fn rejects_cross_directory_and_untrusted_temporary_paths() {
        let directory = tempfile::tempdir().expect("temp directory");
        let other = tempfile::tempdir().expect("other temp directory");
        let (_, target) = paths(directory.path());
        let cross_directory = other
            .path()
            .join(format!("project.zip.openpencil-{UUID}.tmp"));
        fs::write(&cross_directory, b"bytes").expect("cross-directory bytes");

        let error = commit_source_export_file_scoped(&cross_directory, &target, |_| true)
            .expect_err("cross-directory staging must reject");
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);

        let wrong_name = directory.path().join("project.zip.random.tmp");
        fs::write(&wrong_name, b"bytes").expect("wrong-name bytes");
        let error = commit_source_export_file_scoped(&wrong_name, &target, |_| true)
            .expect_err("untrusted staging name must reject");
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
    }

    #[test]
    fn rejects_paths_outside_the_filesystem_scope() {
        let directory = tempfile::tempdir().expect("temp directory");
        let (temporary, target) = paths(directory.path());
        fs::write(&temporary, b"bytes").expect("temporary bytes");

        let error = commit_source_export_file_scoped(&temporary, &target, |_| false)
            .expect_err("out-of-scope paths must reject");

        assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
        assert!(!target.exists());
        assert_eq!(fs::read(temporary).expect("temporary bytes"), b"bytes");
    }

    #[test]
    fn rejects_directories_for_staging_or_target() {
        let directory = tempfile::tempdir().expect("temp directory");
        let (temporary, target) = paths(directory.path());
        fs::create_dir(&temporary).expect("temporary directory");
        let error = commit_source_export_file_scoped(&temporary, &target, |_| true)
            .expect_err("temporary directory must reject");
        assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);

        fs::remove_dir(&temporary).expect("remove temporary directory");
        fs::write(&temporary, b"bytes").expect("temporary bytes");
        fs::create_dir(&target).expect("target directory");
        let error = commit_source_export_file_scoped(&temporary, &target, |_| true)
            .expect_err("target directory must reject");
        assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symbolic_links_for_staging_target_and_parent() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().expect("temp directory");
        let (temporary, target) = paths(directory.path());
        let payload = directory.path().join("payload");
        fs::write(&payload, b"payload").expect("payload");

        symlink(&payload, &temporary).expect("temporary symlink");
        let error = commit_source_export_file_scoped(&temporary, &target, |_| true)
            .expect_err("temporary symlink must reject");
        assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
        fs::remove_file(&temporary).expect("remove temporary symlink");

        fs::write(&temporary, b"bytes").expect("temporary bytes");
        symlink(&payload, &target).expect("target symlink");
        let error = commit_source_export_file_scoped(&temporary, &target, |_| true)
            .expect_err("target symlink must reject");
        assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);

        let parent_link = directory.path().join("linked-parent");
        let real_parent = directory.path().join("real-parent");
        fs::create_dir(&real_parent).expect("real parent");
        symlink(&real_parent, &parent_link).expect("parent symlink");
        let linked_target = parent_link.join("project.zip");
        let linked_temporary = parent_link.join(format!("project.zip.openpencil-{UUID}.tmp"));
        fs::write(
            real_parent.join(linked_temporary.file_name().unwrap()),
            b"bytes",
        )
        .expect("linked temporary bytes");
        let error = commit_source_export_file_scoped(&linked_temporary, &linked_target, |_| true)
            .expect_err("symlink parent must reject");
        assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
    }
}
