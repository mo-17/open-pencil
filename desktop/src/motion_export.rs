use std::{
    io::{self, Write},
    path::{Path, PathBuf},
};

use tauri::AppHandle;
use tauri_plugin_fs::FsExt;
use tempfile::NamedTempFile;

fn persist_motion_export_noclobber_with<F>(
    target: &Path,
    data: &[u8],
    before_persist: F,
) -> io::Result<()>
where
    F: FnOnce() -> io::Result<()>,
{
    if !target.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Motion export path must be absolute",
        ));
    }
    let parent = target
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "Motion export path has no parent directory",
            )
        })?;
    let mut temporary = NamedTempFile::new_in(parent)?;
    temporary.write_all(data)?;
    temporary.flush()?;
    temporary.as_file().sync_all()?;
    before_persist()?;
    let persisted = temporary
        .persist_noclobber(target)
        .map_err(|error| error.error)?;
    persisted.sync_all()?;
    #[cfg(unix)]
    std::fs::File::open(parent)?.sync_all()?;
    Ok(())
}

fn persist_motion_export_noclobber(target: &Path, data: &[u8]) -> io::Result<()> {
    persist_motion_export_noclobber_with(target, data, || Ok(()))
}

#[tauri::command]
pub async fn write_motion_export_noclobber(
    app: AppHandle,
    path: String,
    data: Vec<u8>,
) -> Result<(), String> {
    let target = PathBuf::from(path);
    if !app.fs_scope().is_allowed(&target) {
        return Err("Motion export path is outside the allowed filesystem scope".into());
    }
    let display_path = target.display().to_string();
    let result = tauri::async_runtime::spawn_blocking(move || {
        persist_motion_export_noclobber(&target, &data)
    })
    .await
    .map_err(|error| format!("Motion export persistence worker failed: {error}"))?;
    result.map_err(|error| {
        if error.kind() == io::ErrorKind::AlreadyExists {
            format!("Motion export output already exists: {display_path}")
        } else {
            format!("Could not persist Motion export: {error}")
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};

    #[test]
    fn racing_writers_never_replace_the_winner() {
        let directory = tempfile::tempdir().expect("temp directory");
        let target = directory.path().join("animation.webm");
        let barrier = Arc::new(Barrier::new(3));
        let mut writers = Vec::new();
        for bytes in [b"first".to_vec(), b"second".to_vec()] {
            let target = target.clone();
            let barrier = Arc::clone(&barrier);
            writers.push(std::thread::spawn(move || {
                barrier.wait();
                persist_motion_export_noclobber(&target, &bytes)
            }));
        }
        barrier.wait();
        let results = writers
            .into_iter()
            .map(|writer| writer.join().expect("writer thread"))
            .collect::<Vec<_>>();

        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter(|result| matches!(result, Err(error) if error.kind() == io::ErrorKind::AlreadyExists))
                .count(),
            1
        );
        let stored = std::fs::read(&target).expect("persisted output");
        assert!(stored == b"first" || stored == b"second");
    }

    #[test]
    fn failure_before_publish_leaves_no_target_or_staging_file() {
        let directory = tempfile::tempdir().expect("temp directory");
        let target = directory.path().join("animation.webm");
        let error = persist_motion_export_noclobber_with(&target, b"complete bytes", || {
            Err(io::Error::other("injected failure"))
        })
        .expect_err("injected failure must surface");

        assert_eq!(error.kind(), io::ErrorKind::Other);
        assert!(!target.exists());
        assert_eq!(
            std::fs::read_dir(directory.path())
                .expect("read temp directory")
                .count(),
            0
        );
    }

    #[test]
    fn existing_output_is_preserved() {
        let directory = tempfile::tempdir().expect("temp directory");
        let target = directory.path().join("animation.webm");
        std::fs::write(&target, b"keep").expect("existing output");

        let error = persist_motion_export_noclobber(&target, b"replacement")
            .expect_err("existing output must reject");

        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(std::fs::read(target).expect("existing bytes"), b"keep");
    }
}
