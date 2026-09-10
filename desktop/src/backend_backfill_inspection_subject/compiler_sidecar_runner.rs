//! Dormant Host-only execution kernel for the pinned Backend Compiler sidecar.
//!
//! The kernel copies bytes from an already verified open file into a fresh private snapshot,
//! executes that snapshot with bounded pipes, and delegates all response trust decisions to the
//! strict decoder. The only registry-producing path consumes that unforgeable decoded value; no
//! production caller outside this dormant Host-only module is exposed yet. This path does not
//! claim protection from a compromised same-UID process until an OS-specific immutable execution
//! primitive is joined to the packaged-binary/post-sign gate, nor containment of a hostile binary
//! that escapes its process group with `setsid` before the future OS sandbox gate exists.

use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use sha2::{Digest, Sha256};
use tempfile::TempDir;

use super::super::compiler_sidecar_binary::VerifiedBackendCompilerSidecarBinaryV1;
use super::{
    decode_compiler_sidecar_response, BackendCompilerSidecarErrorV1, CompilerBackfillRequestV1,
    ValidatedCompilerInspectionV1,
};

const MAXIMUM_REQUEST_FRAME_BYTES: usize = 1_048_576 + 1;
const MAXIMUM_STDOUT_BYTES: usize = 262_144 + 1;
const MAXIMUM_STDERR_BYTES: usize = 64 * 1024;
const EXECUTION_TIMEOUT: Duration = Duration::from_secs(30);
const POLL_INTERVAL: Duration = Duration::from_millis(2);
const PIPE_SHUTDOWN_GRACE: Duration = Duration::from_millis(250);
const PROCESS_REAP_GRACE: Duration = Duration::from_secs(1);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum BackendCompilerSidecarRunnerErrorV1 {
    BinaryInvalid,
    PlatformUnavailable,
    AdmissionUnavailable,
    SnapshotUnavailable,
    SpawnUnavailable,
    InputUnavailable,
    OutputUnavailable,
    StdoutLimit,
    StderrLimit,
    Timeout,
    ExitStatusUnavailable,
    ReapUnavailable,
    CleanupUnavailable,
    Decoder(BackendCompilerSidecarErrorV1),
    Registry(super::super::BackendBackfillInspectionSubjectErrorV1),
}

struct ExecutableSnapshotV1 {
    _opened_read_only_file: File,
    path: PathBuf,
    _directory: TempDir,
}

/// Opaque private-directory capability. No production constructor exists until the Desktop owns a
/// reviewed runtime-root locator and lifecycle.
struct HostOwnedCompilerRuntimeRootV1 {
    directory: TempDir,
    in_flight: AtomicBool,
}

struct CompilerSidecarAdmissionV1<'a> {
    in_flight: &'a AtomicBool,
}

impl Drop for CompilerSidecarAdmissionV1<'_> {
    fn drop(&mut self) {
        self.in_flight.store(false, Ordering::Release);
    }
}

impl HostOwnedCompilerRuntimeRootV1 {
    fn path(&self) -> &std::path::Path {
        self.directory.path()
    }

    fn try_admit(
        &self,
    ) -> Result<CompilerSidecarAdmissionV1<'_>, BackendCompilerSidecarRunnerErrorV1> {
        self.in_flight
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| BackendCompilerSidecarRunnerErrorV1::AdmissionUnavailable)?;
        Ok(CompilerSidecarAdmissionV1 {
            in_flight: &self.in_flight,
        })
    }

    #[cfg(test)]
    fn new_for_test() -> Result<Self, BackendCompilerSidecarRunnerErrorV1> {
        let directory = tempfile::Builder::new()
            .prefix("openpencil-backend-compiler-host-")
            .tempdir()
            .map_err(|_| BackendCompilerSidecarRunnerErrorV1::SnapshotUnavailable)?;
        harden_new_private_directory(&directory)?;
        Ok(Self {
            directory,
            in_flight: AtomicBool::new(false),
        })
    }
}

fn single_file_name(value: &str) -> bool {
    let mut components = Path::new(value).components();
    matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none()
}

#[cfg(unix)]
fn create_snapshot_file(path: &std::path::Path) -> std::io::Result<File> {
    use std::os::unix::fs::OpenOptionsExt;

    OpenOptions::new()
        .create_new(true)
        .read(true)
        .write(true)
        .mode(0o700)
        .open(path)
}

#[cfg(unix)]
fn open_snapshot_read_only(path: &std::path::Path) -> std::io::Result<File> {
    use std::os::unix::fs::OpenOptionsExt;

    OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
}

#[cfg(not(unix))]
fn open_snapshot_read_only(path: &std::path::Path) -> std::io::Result<File> {
    OpenOptions::new().read(true).open(path)
}

#[cfg(not(unix))]
fn create_snapshot_file(path: &std::path::Path) -> std::io::Result<File> {
    OpenOptions::new()
        .create_new(true)
        .read(true)
        .write(true)
        .open(path)
}

fn executable_snapshot(
    binary: &VerifiedBackendCompilerSidecarBinaryV1,
    runtime_root: &HostOwnedCompilerRuntimeRootV1,
) -> Result<ExecutableSnapshotV1, BackendCompilerSidecarRunnerErrorV1> {
    let name = binary.binary_name();
    if !single_file_name(name) {
        return Err(BackendCompilerSidecarRunnerErrorV1::BinaryInvalid);
    }
    validate_private_directory(runtime_root.path())?;
    let directory = tempfile::Builder::new()
        .prefix("openpencil-backend-compiler-")
        .tempdir_in(runtime_root.path())
        .map_err(|_| BackendCompilerSidecarRunnerErrorV1::SnapshotUnavailable)?;
    harden_new_private_directory(&directory)?;
    let path = directory.path().join(name);
    let mut output = create_snapshot_file(&path)
        .map_err(|_| BackendCompilerSidecarRunnerErrorV1::SnapshotUnavailable)?;
    let mut digest = Sha256::new();
    let mut observed = 0_u64;
    let mut chunk = [0_u8; 64 * 1024];
    loop {
        let count = binary
            .read_at(&mut chunk, observed)
            .map_err(|_| BackendCompilerSidecarRunnerErrorV1::BinaryInvalid)?;
        if count == 0 {
            break;
        }
        observed = observed
            .checked_add(count as u64)
            .ok_or(BackendCompilerSidecarRunnerErrorV1::BinaryInvalid)?;
        if observed > binary.byte_length() {
            return Err(BackendCompilerSidecarRunnerErrorV1::BinaryInvalid);
        }
        digest.update(&chunk[..count]);
        output
            .write_all(&chunk[..count])
            .map_err(|_| BackendCompilerSidecarRunnerErrorV1::SnapshotUnavailable)?;
    }
    if observed != binary.byte_length()
        || URL_SAFE_NO_PAD.encode(digest.finalize()) != binary.sha256()
    {
        return Err(BackendCompilerSidecarRunnerErrorV1::BinaryInvalid);
    }
    output
        .flush()
        .and_then(|()| output.sync_all())
        .map_err(|_| BackendCompilerSidecarRunnerErrorV1::SnapshotUnavailable)?;
    #[cfg(unix)]
    fs::set_permissions(
        &path,
        <fs::Permissions as PermissionsMode>::from_private_executable(),
    )
    .map_err(|_| BackendCompilerSidecarRunnerErrorV1::SnapshotUnavailable)?;
    validate_snapshot_file(&path, &output, binary.byte_length())?;
    let written_metadata = output
        .metadata()
        .map_err(|_| BackendCompilerSidecarRunnerErrorV1::SnapshotUnavailable)?;
    drop(output);
    let opened_read_only = open_snapshot_read_only(&path)
        .map_err(|_| BackendCompilerSidecarRunnerErrorV1::SnapshotUnavailable)?;
    validate_snapshot_file(&path, &opened_read_only, binary.byte_length())?;
    validate_reopened_snapshot_identity(&written_metadata, &opened_read_only)?;
    Ok(ExecutableSnapshotV1 {
        _opened_read_only_file: opened_read_only,
        path,
        _directory: directory,
    })
}

#[cfg(unix)]
fn validate_reopened_snapshot_identity(
    written_metadata: &fs::Metadata,
    reopened: &File,
) -> Result<(), BackendCompilerSidecarRunnerErrorV1> {
    use std::os::unix::fs::MetadataExt;

    let reopened_metadata = reopened
        .metadata()
        .map_err(|_| BackendCompilerSidecarRunnerErrorV1::SnapshotUnavailable)?;
    if written_metadata.dev() != reopened_metadata.dev()
        || written_metadata.ino() != reopened_metadata.ino()
        || written_metadata.len() != reopened_metadata.len()
        || reopened_metadata.nlink() != 1
        || reopened_metadata.uid() != unsafe { libc::geteuid() }
        || reopened_metadata.mode() & 0o777 != 0o500
    {
        return Err(BackendCompilerSidecarRunnerErrorV1::SnapshotUnavailable);
    }
    Ok(())
}

#[cfg(not(unix))]
fn validate_reopened_snapshot_identity(
    written_metadata: &fs::Metadata,
    reopened: &File,
) -> Result<(), BackendCompilerSidecarRunnerErrorV1> {
    let reopened_metadata = reopened
        .metadata()
        .map_err(|_| BackendCompilerSidecarRunnerErrorV1::SnapshotUnavailable)?;
    if written_metadata.len() != reopened_metadata.len() {
        return Err(BackendCompilerSidecarRunnerErrorV1::SnapshotUnavailable);
    }
    Ok(())
}

#[cfg(unix)]
fn validate_snapshot_file(
    path: &std::path::Path,
    opened: &File,
    expected_length: u64,
) -> Result<(), BackendCompilerSidecarRunnerErrorV1> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    let path_metadata = fs::symlink_metadata(path)
        .map_err(|_| BackendCompilerSidecarRunnerErrorV1::SnapshotUnavailable)?;
    let opened_metadata = opened
        .metadata()
        .map_err(|_| BackendCompilerSidecarRunnerErrorV1::SnapshotUnavailable)?;
    if path_metadata.file_type().is_symlink()
        || !path_metadata.is_file()
        || path_metadata.dev() != opened_metadata.dev()
        || path_metadata.ino() != opened_metadata.ino()
        || opened_metadata.len() != expected_length
        || opened_metadata.nlink() != 1
        || opened_metadata.uid() != unsafe { libc::geteuid() }
        || opened_metadata.permissions().mode() & 0o777 != 0o500
    {
        return Err(BackendCompilerSidecarRunnerErrorV1::SnapshotUnavailable);
    }
    Ok(())
}

#[cfg(not(unix))]
fn validate_snapshot_file(
    path: &std::path::Path,
    opened: &File,
    expected_length: u64,
) -> Result<(), BackendCompilerSidecarRunnerErrorV1> {
    let path_metadata = fs::symlink_metadata(path)
        .map_err(|_| BackendCompilerSidecarRunnerErrorV1::SnapshotUnavailable)?;
    let opened_metadata = opened
        .metadata()
        .map_err(|_| BackendCompilerSidecarRunnerErrorV1::SnapshotUnavailable)?;
    if path_metadata.file_type().is_symlink()
        || !path_metadata.is_file()
        || opened_metadata.len() != expected_length
    {
        return Err(BackendCompilerSidecarRunnerErrorV1::SnapshotUnavailable);
    }
    Ok(())
}

#[cfg(unix)]
fn harden_new_private_directory(
    directory: &TempDir,
) -> Result<(), BackendCompilerSidecarRunnerErrorV1> {
    use std::os::unix::fs::PermissionsExt;

    let path = directory.path();
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|_| BackendCompilerSidecarRunnerErrorV1::SnapshotUnavailable)?;
    validate_private_directory(path)
}

#[cfg(unix)]
fn validate_private_directory(
    path: &std::path::Path,
) -> Result<(), BackendCompilerSidecarRunnerErrorV1> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    let metadata = fs::symlink_metadata(path)
        .map_err(|_| BackendCompilerSidecarRunnerErrorV1::SnapshotUnavailable)?;
    if !path.is_absolute()
        || metadata.file_type().is_symlink()
        || !metadata.is_dir()
        || metadata.permissions().mode() & 0o077 != 0
        || metadata.uid() != unsafe { libc::geteuid() }
    {
        return Err(BackendCompilerSidecarRunnerErrorV1::SnapshotUnavailable);
    }
    Ok(())
}

#[cfg(not(unix))]
fn harden_new_private_directory(
    directory: &TempDir,
) -> Result<(), BackendCompilerSidecarRunnerErrorV1> {
    validate_private_directory(directory.path())
}

#[cfg(not(unix))]
fn validate_private_directory(
    path: &std::path::Path,
) -> Result<(), BackendCompilerSidecarRunnerErrorV1> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| BackendCompilerSidecarRunnerErrorV1::SnapshotUnavailable)?;
    if !path.is_absolute() || metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(BackendCompilerSidecarRunnerErrorV1::SnapshotUnavailable);
    }
    Ok(())
}

#[cfg(unix)]
trait PermissionsMode {
    fn from_private_executable() -> Self;
}

#[cfg(unix)]
impl PermissionsMode for fs::Permissions {
    fn from_private_executable() -> Self {
        use std::os::unix::fs::PermissionsExt;

        Self::from_mode(0o500)
    }
}

struct DrainResultV1 {
    bytes: Vec<u8>,
    exceeded: bool,
    failed: bool,
}

struct ThreadCompletionV1(Arc<AtomicBool>);

impl Drop for ThreadCompletionV1 {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Release);
    }
}

fn write_bounded<W: Write>(
    mut stream: W,
    bytes: &[u8],
    cancelled: &AtomicBool,
) -> std::io::Result<()> {
    let mut written = 0;
    while written < bytes.len() {
        if cancelled.load(Ordering::Acquire) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Interrupted,
                "sidecar pipe write cancelled",
            ));
        }
        match stream.write(&bytes[written..]) {
            Ok(0) => {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::WriteZero,
                    "sidecar pipe closed",
                ))
            }
            Ok(count) => written += count,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(POLL_INTERVAL);
            }
            Err(error) => return Err(error),
        }
    }
    stream.flush()
}

fn drain_bounded<R: Read>(
    mut stream: R,
    maximum: usize,
    exceeded: Arc<AtomicBool>,
    cancelled: Arc<AtomicBool>,
) -> DrainResultV1 {
    let mut bytes = Vec::with_capacity(maximum.min(8 * 1024));
    let mut chunk = [0_u8; 8 * 1024];
    loop {
        let count = match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(count) => count,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if cancelled.load(Ordering::Acquire) {
                    break;
                }
                thread::sleep(POLL_INTERVAL);
                continue;
            }
            Err(_) => {
                return DrainResultV1 {
                    bytes,
                    exceeded: false,
                    failed: true,
                }
            }
        };
        let remaining = maximum.saturating_add(1).saturating_sub(bytes.len());
        bytes.extend_from_slice(&chunk[..count.min(remaining)]);
        if count > remaining || bytes.len() > maximum {
            exceeded.store(true, Ordering::Release);
            return DrainResultV1 {
                bytes,
                exceeded: true,
                failed: false,
            };
        }
    }
    DrainResultV1 {
        bytes,
        exceeded: false,
        failed: false,
    }
}

#[cfg(unix)]
fn set_pipe_nonblocking<T: std::os::fd::AsRawFd>(stream: &T) -> std::io::Result<()> {
    let descriptor = stream.as_raw_fd();
    let flags = unsafe { libc::fcntl(descriptor, libc::F_GETFL) };
    if flags < 0 {
        return Err(std::io::Error::last_os_error());
    }
    if unsafe { libc::fcntl(descriptor, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(unix)]
fn configure_private_process(command: &mut Command) {
    use std::os::unix::process::CommandExt;

    command.process_group(0);
}

#[cfg(not(unix))]
fn configure_private_process(_command: &mut Command) {}

#[cfg(unix)]
fn terminate_process_group(child: &Child) {
    // The sidecar is a pinned single binary, but a process group also closes inherited pipes if a
    // compromised candidate unexpectedly creates descendants.
    unsafe {
        libc::killpg(child.id() as i32, libc::SIGKILL);
    }
}

#[cfg(not(unix))]
fn terminate_process_group(_child: &Child) {}

fn terminate_and_reap(child: &mut Child) -> Result<(), BackendCompilerSidecarRunnerErrorV1> {
    terminate_process_group(child);
    let _ = child.kill();
    let deadline = Instant::now()
        .checked_add(PROCESS_REAP_GRACE)
        .ok_or(BackendCompilerSidecarRunnerErrorV1::ReapUnavailable)?;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return Ok(()),
            Ok(None) => {}
            Err(_) => return Err(BackendCompilerSidecarRunnerErrorV1::ReapUnavailable),
        }
        let now = Instant::now();
        if now >= deadline {
            return Err(BackendCompilerSidecarRunnerErrorV1::ReapUnavailable);
        }
        thread::sleep(POLL_INTERVAL.min(deadline.saturating_duration_since(now)));
    }
}

fn pipe_threads_done(
    input_done: &AtomicBool,
    stdout_done: &AtomicBool,
    stderr_done: &AtomicBool,
) -> bool {
    input_done.load(Ordering::Acquire)
        && stdout_done.load(Ordering::Acquire)
        && stderr_done.load(Ordering::Acquire)
}

fn wait_for_pipe_shutdown(
    input_done: &AtomicBool,
    stdout_done: &AtomicBool,
    stderr_done: &AtomicBool,
) -> bool {
    let Some(deadline) = Instant::now().checked_add(PIPE_SHUTDOWN_GRACE) else {
        return false;
    };
    while !pipe_threads_done(input_done, stdout_done, stderr_done) {
        let now = Instant::now();
        if now >= deadline {
            return false;
        }
        thread::sleep(POLL_INTERVAL.min(deadline.saturating_duration_since(now)));
    }
    true
}

fn wait_bounded(
    child: &mut Child,
    timeout: Duration,
    stdout_exceeded: &AtomicBool,
    stderr_exceeded: &AtomicBool,
    input_done: &AtomicBool,
    stdout_done: &AtomicBool,
    stderr_done: &AtomicBool,
) -> Result<ExitStatus, BackendCompilerSidecarRunnerErrorV1> {
    let deadline = Instant::now()
        .checked_add(timeout)
        .ok_or(BackendCompilerSidecarRunnerErrorV1::Timeout)?;
    let mut exit_status = None;
    let mut terminated_descendants = false;
    loop {
        if stdout_exceeded.load(Ordering::Acquire) {
            return Err(BackendCompilerSidecarRunnerErrorV1::StdoutLimit);
        }
        if stderr_exceeded.load(Ordering::Acquire) {
            return Err(BackendCompilerSidecarRunnerErrorV1::StderrLimit);
        }
        if exit_status.is_none() {
            exit_status = child
                .try_wait()
                .map_err(|_| BackendCompilerSidecarRunnerErrorV1::OutputUnavailable)?;
        }
        if pipe_threads_done(input_done, stdout_done, stderr_done) {
            if let Some(status) = exit_status {
                return Ok(status);
            }
        } else if exit_status.is_some() && !terminated_descendants {
            terminate_process_group(child);
            terminated_descendants = true;
        }
        let now = Instant::now();
        if now >= deadline {
            return Err(BackendCompilerSidecarRunnerErrorV1::Timeout);
        }
        thread::sleep(POLL_INTERVAL.min(deadline.saturating_duration_since(now)));
    }
}

#[cfg(unix)]
fn run_admitted_with_timeout(
    binary: &VerifiedBackendCompilerSidecarBinaryV1,
    request: &CompilerBackfillRequestV1,
    runtime_root: &HostOwnedCompilerRuntimeRootV1,
    timeout: Duration,
) -> Result<ValidatedCompilerInspectionV1, BackendCompilerSidecarRunnerErrorV1> {
    let request_frame = request.canonical_frame_with_lf();
    if request_frame.is_empty() || request_frame.len() > MAXIMUM_REQUEST_FRAME_BYTES {
        return Err(BackendCompilerSidecarRunnerErrorV1::InputUnavailable);
    }
    let snapshot = executable_snapshot(binary, runtime_root)?;
    // This is a validated private path snapshot, not an fd-bound exec. The runtime-root capability
    // is intentionally unreachable from production callers today; a compromised same-UID process
    // remains outside this slice's safety boundary until the packaged-binary/post-sign gate can
    // supply an OS-specific immutable execution primitive.
    let mut command = Command::new(&snapshot.path);
    command
        .args(std::iter::empty::<&str>())
        .env_clear()
        .env("LANG", "C")
        .env("LC_ALL", "C")
        .env("TZ", "UTC")
        .current_dir(snapshot._directory.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_private_process(&mut command);
    let mut child = command
        .spawn()
        .map_err(|_| BackendCompilerSidecarRunnerErrorV1::SpawnUnavailable)?;
    let Some(stdin) = child.stdin.take() else {
        terminate_and_reap(&mut child)?;
        return Err(BackendCompilerSidecarRunnerErrorV1::InputUnavailable);
    };
    let Some(stdout) = child.stdout.take() else {
        terminate_and_reap(&mut child)?;
        return Err(BackendCompilerSidecarRunnerErrorV1::OutputUnavailable);
    };
    let Some(stderr) = child.stderr.take() else {
        terminate_and_reap(&mut child)?;
        return Err(BackendCompilerSidecarRunnerErrorV1::OutputUnavailable);
    };
    if set_pipe_nonblocking(&stdin).is_err() {
        terminate_and_reap(&mut child)?;
        return Err(BackendCompilerSidecarRunnerErrorV1::InputUnavailable);
    }
    if set_pipe_nonblocking(&stdout).is_err() || set_pipe_nonblocking(&stderr).is_err() {
        terminate_and_reap(&mut child)?;
        return Err(BackendCompilerSidecarRunnerErrorV1::OutputUnavailable);
    }

    let stdout_exceeded = Arc::new(AtomicBool::new(false));
    let stderr_exceeded = Arc::new(AtomicBool::new(false));
    let cancelled = Arc::new(AtomicBool::new(false));
    let input_done = Arc::new(AtomicBool::new(false));
    let stdout_done = Arc::new(AtomicBool::new(false));
    let stderr_done = Arc::new(AtomicBool::new(false));
    let input_done_thread = Arc::clone(&input_done);
    let stdout_flag = Arc::clone(&stdout_exceeded);
    let stderr_flag = Arc::clone(&stderr_exceeded);
    let input_cancelled = Arc::clone(&cancelled);
    let stdout_cancelled = Arc::clone(&cancelled);
    let stderr_cancelled = Arc::clone(&cancelled);
    let input_thread = match thread::Builder::new()
        .name("backend-compiler-stdin".to_owned())
        .spawn(move || {
            let _completion = ThreadCompletionV1(input_done_thread);
            write_bounded(stdin, &request_frame, input_cancelled.as_ref())
        }) {
        Ok(handle) => handle,
        Err(_) => {
            terminate_and_reap(&mut child)?;
            return Err(BackendCompilerSidecarRunnerErrorV1::InputUnavailable);
        }
    };
    let stdout_done_thread = Arc::clone(&stdout_done);
    let stdout_thread = match thread::Builder::new()
        .name("backend-compiler-stdout".to_owned())
        .spawn(move || {
            let _completion = ThreadCompletionV1(stdout_done_thread);
            drain_bounded(stdout, MAXIMUM_STDOUT_BYTES, stdout_flag, stdout_cancelled)
        }) {
        Ok(handle) => handle,
        Err(_) => {
            stdout_done.store(true, Ordering::Release);
            stderr_done.store(true, Ordering::Release);
            drop(stderr);
            cancelled.store(true, Ordering::Release);
            let reap = terminate_and_reap(&mut child);
            let shutdown = wait_for_pipe_shutdown(
                input_done.as_ref(),
                stdout_done.as_ref(),
                stderr_done.as_ref(),
            );
            if shutdown {
                let _ = input_thread.join();
            }
            reap?;
            if !shutdown {
                return Err(BackendCompilerSidecarRunnerErrorV1::CleanupUnavailable);
            }
            return Err(BackendCompilerSidecarRunnerErrorV1::OutputUnavailable);
        }
    };
    let stderr_done_thread = Arc::clone(&stderr_done);
    let stderr_thread = match thread::Builder::new()
        .name("backend-compiler-stderr".to_owned())
        .spawn(move || {
            let _completion = ThreadCompletionV1(stderr_done_thread);
            drain_bounded(stderr, MAXIMUM_STDERR_BYTES, stderr_flag, stderr_cancelled)
        }) {
        Ok(handle) => handle,
        Err(_) => {
            stderr_done.store(true, Ordering::Release);
            cancelled.store(true, Ordering::Release);
            let reap = terminate_and_reap(&mut child);
            let shutdown = wait_for_pipe_shutdown(
                input_done.as_ref(),
                stdout_done.as_ref(),
                stderr_done.as_ref(),
            );
            if shutdown {
                let _ = input_thread.join();
                let _ = stdout_thread.join();
            }
            reap?;
            if !shutdown {
                return Err(BackendCompilerSidecarRunnerErrorV1::CleanupUnavailable);
            }
            return Err(BackendCompilerSidecarRunnerErrorV1::OutputUnavailable);
        }
    };

    let status = wait_bounded(
        &mut child,
        timeout,
        stdout_exceeded.as_ref(),
        stderr_exceeded.as_ref(),
        input_done.as_ref(),
        stdout_done.as_ref(),
        stderr_done.as_ref(),
    );
    let mut reap_error = None;
    if status.is_err() {
        cancelled.store(true, Ordering::Release);
        reap_error = terminate_and_reap(&mut child).err();
        let shutdown = wait_for_pipe_shutdown(
            input_done.as_ref(),
            stdout_done.as_ref(),
            stderr_done.as_ref(),
        );
        if !shutdown {
            return Err(
                reap_error.unwrap_or(BackendCompilerSidecarRunnerErrorV1::CleanupUnavailable)
            );
        }
    }
    let input = input_thread
        .join()
        .map_err(|_| BackendCompilerSidecarRunnerErrorV1::InputUnavailable)?;
    let stdout = stdout_thread
        .join()
        .map_err(|_| BackendCompilerSidecarRunnerErrorV1::OutputUnavailable)?;
    let stderr = stderr_thread
        .join()
        .map_err(|_| BackendCompilerSidecarRunnerErrorV1::OutputUnavailable)?;
    if let Some(error) = reap_error {
        return Err(error);
    }
    if stdout.exceeded {
        return Err(BackendCompilerSidecarRunnerErrorV1::StdoutLimit);
    }
    if stderr.exceeded {
        return Err(BackendCompilerSidecarRunnerErrorV1::StderrLimit);
    }
    let status = status?;
    input.map_err(|_| BackendCompilerSidecarRunnerErrorV1::InputUnavailable)?;
    if stdout.failed || stderr.failed {
        return Err(BackendCompilerSidecarRunnerErrorV1::OutputUnavailable);
    }
    let exit_code = status
        .code()
        .ok_or(BackendCompilerSidecarRunnerErrorV1::ExitStatusUnavailable)?;
    decode_compiler_sidecar_response(request, exit_code, &stdout.bytes, &stderr.bytes)
        .map_err(BackendCompilerSidecarRunnerErrorV1::Decoder)
}

#[cfg(not(unix))]
fn run_admitted_with_timeout(
    _binary: &VerifiedBackendCompilerSidecarBinaryV1,
    _request: &CompilerBackfillRequestV1,
    _runtime_root: &HostOwnedCompilerRuntimeRootV1,
    _timeout: Duration,
) -> Result<ValidatedCompilerInspectionV1, BackendCompilerSidecarRunnerErrorV1> {
    Err(BackendCompilerSidecarRunnerErrorV1::PlatformUnavailable)
}

fn run_with_timeout(
    binary: &VerifiedBackendCompilerSidecarBinaryV1,
    request: &CompilerBackfillRequestV1,
    runtime_root: &HostOwnedCompilerRuntimeRootV1,
    timeout: Duration,
) -> Result<ValidatedCompilerInspectionV1, BackendCompilerSidecarRunnerErrorV1> {
    let _admission = runtime_root.try_admit()?;
    run_admitted_with_timeout(binary, request, runtime_root, timeout)
}

/// Production-compiled execution core. It has no production caller and returns no registry proof.
fn run_verified_backend_compiler_sidecar(
    binary: &VerifiedBackendCompilerSidecarBinaryV1,
    request: &CompilerBackfillRequestV1,
    runtime_root: &HostOwnedCompilerRuntimeRootV1,
) -> Result<ValidatedCompilerInspectionV1, BackendCompilerSidecarRunnerErrorV1> {
    run_with_timeout(binary, request, runtime_root, EXECUTION_TIMEOUT)
}

fn run_with_timeout_and_issue(
    registry: &super::super::BackendBackfillInspectionSubjectRegistryV1,
    binary: &VerifiedBackendCompilerSidecarBinaryV1,
    request: &CompilerBackfillRequestV1,
    runtime_root: &HostOwnedCompilerRuntimeRootV1,
    timeout: Duration,
) -> Result<super::super::SealedBackfillInspectionSubjectProofV1, BackendCompilerSidecarRunnerErrorV1>
{
    let _admission = runtime_root.try_admit()?;
    let validated = run_admitted_with_timeout(binary, request, runtime_root, timeout)?;
    registry
        .issue_validated_compiler_inspection(validated)
        .map_err(BackendCompilerSidecarRunnerErrorV1::Registry)
}

/// Production-compiled Host-only composition. Nothing outside the dormant native subject module
/// can call it, construct its validated input, or turn the proof into execution authority.
fn run_verified_backend_compiler_sidecar_and_issue(
    registry: &super::super::BackendBackfillInspectionSubjectRegistryV1,
    binary: &VerifiedBackendCompilerSidecarBinaryV1,
    request: &CompilerBackfillRequestV1,
    runtime_root: &HostOwnedCompilerRuntimeRootV1,
) -> Result<super::super::SealedBackfillInspectionSubjectProofV1, BackendCompilerSidecarRunnerErrorV1>
{
    run_with_timeout_and_issue(registry, binary, request, runtime_root, EXECUTION_TIMEOUT)
}

#[cfg(all(test, unix))]
mod tests {
    use super::super::super::{
        compiler_sidecar_binary::verify_backend_compiler_sidecar_candidate_for_test,
        BackendBackfillInspectionSubjectErrorV1, BackendBackfillInspectionSubjectRegistryV1,
    };
    use super::super::CompilerBackfillTargetV1;
    use super::*;
    use serde_json::Value;
    use std::io::{Seek, SeekFrom};

    const FIXTURE: &[u8] = include_bytes!(
        "../../../tests/fixtures/backend/supabase/backfill-compiler-sidecar-v1.json"
    );

    fn fixture() -> Value {
        serde_json::from_slice(FIXTURE).unwrap()
    }

    fn request() -> CompilerBackfillRequestV1 {
        let fixture = fixture();
        let application = &fixture["request"]["application"];
        let canonical = serde_json::to_vec(application).unwrap();
        assert!(canonical.len() <= MAXIMUM_REQUEST_FRAME_BYTES - 1);
        CompilerBackfillRequestV1::from_canonical_application(
            CompilerBackfillTargetV1::React,
            [0; 32],
            &canonical,
        )
        .unwrap()
    }

    fn success_script() -> String {
        let response = serde_json::to_string(&fixture()["response"]).unwrap();
        assert!(!response.contains('\''));
        format!("#!/bin/sh\n/bin/cat >/dev/null\nprintf '%s\\n' '{response}'\n")
    }

    fn candidate(script: &str) -> (TempDir, PathBuf, VerifiedBackendCompilerSidecarBinaryV1) {
        let directory = tempfile::tempdir().unwrap();
        let path = directory
            .path()
            .join("openpencil-backend-compiler-sidecar-test");
        fs::write(&path, script).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
        }
        let verified = verify_backend_compiler_sidecar_candidate_for_test(&path).unwrap();
        (directory, path, verified)
    }

    fn test_runtime_root() -> HostOwnedCompilerRuntimeRootV1 {
        HostOwnedCompilerRuntimeRootV1::new_for_test().unwrap()
    }

    fn assert_failed_run_leaves_scope_available(
        script: &str,
        expected: BackendCompilerSidecarRunnerErrorV1,
        timeout: Duration,
    ) {
        let registry =
            BackendBackfillInspectionSubjectRegistryV1::new_dormant_production().unwrap();
        let (_bad_directory, _bad_path, bad_binary) = candidate(script);
        let runtime_root = test_runtime_root();
        assert_eq!(
            run_with_timeout_and_issue(&registry, &bad_binary, &request(), &runtime_root, timeout,)
                .err()
                .unwrap(),
            expected
        );

        let (_good_directory, _good_path, good_binary) = candidate(&success_script());
        let proof = run_with_timeout_and_issue(
            &registry,
            &good_binary,
            &request(),
            &runtime_root,
            Duration::from_secs(2),
        )
        .unwrap();
        registry.consume_for_initializer(proof).unwrap();
    }

    #[test]
    fn host_temp_directory_is_private() {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};

        let runtime_root = test_runtime_root();
        validate_private_directory(runtime_root.path()).unwrap();
        let metadata = fs::symlink_metadata(runtime_root.path()).unwrap();
        assert_eq!(metadata.permissions().mode() & 0o777, 0o700);
        assert_eq!(metadata.uid(), unsafe { libc::geteuid() });
    }

    #[test]
    fn held_admission_fails_before_snapshot_and_raii_releases_on_error_and_panic() {
        use std::panic::{catch_unwind, AssertUnwindSafe};

        let runtime_root = test_runtime_root();
        let (_directory, _path, binary) = candidate(&success_script());
        let entries_before = fs::read_dir(runtime_root.path()).unwrap().count();
        let held = runtime_root.try_admit().unwrap();
        assert_eq!(
            run_with_timeout(&binary, &request(), &runtime_root, Duration::from_secs(2))
                .err()
                .unwrap(),
            BackendCompilerSidecarRunnerErrorV1::AdmissionUnavailable
        );
        assert_eq!(
            fs::read_dir(runtime_root.path()).unwrap().count(),
            entries_before
        );
        drop(held);

        let panic_result = catch_unwind(AssertUnwindSafe(|| {
            let _admission = runtime_root.try_admit().unwrap();
            panic!("test admission unwind");
        }));
        assert!(panic_result.is_err());

        let validated =
            run_with_timeout(&binary, &request(), &runtime_root, Duration::from_secs(2)).unwrap();
        assert_eq!(
            validated.material().application_id,
            "test.supabase-receipt-backfill"
        );
    }

    #[test]
    fn concurrent_run_is_denied_then_the_same_host_capability_is_reusable() {
        let coordination = tempfile::tempdir().unwrap();
        let started = coordination.path().join("started");
        let release = coordination.path().join("release");
        let started_text = started.to_string_lossy();
        let release_text = release.to_string_lossy();
        assert!(!started_text.contains('\''));
        assert!(!release_text.contains('\''));
        let response = serde_json::to_string(&fixture()["response"]).unwrap();
        let script = format!(
            "#!/bin/sh\nprintf started > '{started_text}'\nwhile [ ! -f '{release_text}' ]; do :; done\n/bin/cat >/dev/null\nprintf '%s\\n' '{response}'\n"
        );
        let (first_directory, _first_path, first_binary) = candidate(&script);
        let runtime_root = Arc::new(test_runtime_root());
        let first_root = Arc::clone(&runtime_root);
        let first_request = request();
        let first = thread::Builder::new()
            .name("backend-compiler-admission-test".to_owned())
            .spawn(move || {
                let _keep_candidate_alive = first_directory;
                run_with_timeout(
                    &first_binary,
                    &first_request,
                    first_root.as_ref(),
                    Duration::from_secs(2),
                )
            })
            .unwrap();

        let deadline = Instant::now() + Duration::from_secs(1);
        while !started.exists() && Instant::now() < deadline {
            thread::sleep(POLL_INTERVAL);
        }
        assert!(
            started.exists(),
            "first sidecar did not reach its held execution"
        );

        let (_second_directory, _second_path, second_binary) = candidate(&success_script());
        assert_eq!(
            run_with_timeout(
                &second_binary,
                &request(),
                runtime_root.as_ref(),
                Duration::from_secs(2),
            )
            .err()
            .unwrap(),
            BackendCompilerSidecarRunnerErrorV1::AdmissionUnavailable
        );
        fs::write(&release, b"release").unwrap();
        let first_validated = first.join().unwrap().unwrap();
        assert_eq!(
            first_validated.material().application_id,
            "test.supabase-receipt-backfill"
        );

        let reused = run_with_timeout(
            &second_binary,
            &request(),
            runtime_root.as_ref(),
            Duration::from_secs(2),
        )
        .unwrap();
        assert_eq!(
            reused.material().application_id,
            "test.supabase-receipt-backfill"
        );
    }

    #[test]
    fn altered_runtime_root_capability_is_rejected_before_snapshot_or_spawn() {
        use std::os::unix::fs::PermissionsExt;

        let runtime_root = test_runtime_root();
        fs::set_permissions(runtime_root.path(), fs::Permissions::from_mode(0o755)).unwrap();
        let (_directory, _path, binary) = candidate(&success_script());
        let registry =
            BackendBackfillInspectionSubjectRegistryV1::new_dormant_production().unwrap();
        assert_eq!(
            run_with_timeout_and_issue(
                &registry,
                &binary,
                &request(),
                &runtime_root,
                Duration::from_secs(2),
            )
            .err()
            .unwrap(),
            BackendCompilerSidecarRunnerErrorV1::SnapshotUnavailable
        );
        let good_runtime_root = test_runtime_root();
        let proof = run_with_timeout_and_issue(
            &registry,
            &binary,
            &request(),
            &good_runtime_root,
            Duration::from_secs(2),
        )
        .unwrap();
        registry.consume_for_initializer(proof).unwrap();
    }

    #[test]
    fn executable_snapshot_closes_its_writer_and_retains_only_a_read_only_handle() {
        use std::os::fd::AsRawFd;

        let (_directory, _path, binary) = candidate(&success_script());
        let runtime_root = test_runtime_root();
        let snapshot = executable_snapshot(&binary, &runtime_root).unwrap();
        let flags =
            unsafe { libc::fcntl(snapshot._opened_read_only_file.as_raw_fd(), libc::F_GETFL) };
        assert!(flags >= 0);
        assert_eq!(flags & libc::O_ACCMODE, libc::O_RDONLY);
        validate_snapshot_file(
            &snapshot.path,
            &snapshot._opened_read_only_file,
            binary.byte_length(),
        )
        .unwrap();
    }

    #[test]
    fn exact_verified_snapshot_decodes_then_issues_one_shot_production_proof() {
        let (_directory, _path, binary) = candidate(&success_script());
        let request = request();
        let runtime_root = test_runtime_root();
        let registry =
            BackendBackfillInspectionSubjectRegistryV1::new_dormant_production().unwrap();
        let proof = run_verified_backend_compiler_sidecar_and_issue(
            &registry,
            &binary,
            &request,
            &runtime_root,
        )
        .unwrap();
        let consumed = registry.consume_for_initializer(proof).unwrap();
        assert_eq!(
            consumed.material_for_composition().application_id,
            "test.supabase-receipt-backfill"
        );
        assert!(!consumed.database_authority_created());
        assert!(!consumed.mutation_authorized());
        assert!(!consumed.execution_authorized());
        assert!(!consumed.receipt_authority_created());
        assert!(!consumed.release_authorized());
    }

    #[test]
    fn snapshot_copy_reads_the_verified_handle_after_original_path_replacement() {
        let (directory, path, binary) = candidate(&success_script());
        let moved = directory.path().join("verified-opened-candidate");
        fs::rename(&path, &moved).unwrap();
        fs::write(&path, "#!/bin/sh\nexit 99\n").unwrap();
        let runtime_root = test_runtime_root();
        let validated =
            run_with_timeout(&binary, &request(), &runtime_root, Duration::from_secs(2)).unwrap();
        assert_eq!(
            validated.material().application_id,
            "test.supabase-receipt-backfill"
        );
    }

    #[test]
    fn rejects_candidate_bytes_mutated_after_verification() {
        let (_directory, path, binary) = candidate(&success_script());
        let mut file = OpenOptions::new().write(true).open(path).unwrap();
        file.seek(SeekFrom::Start(0)).unwrap();
        file.write_all(b"X").unwrap();
        file.flush().unwrap();
        let runtime_root = test_runtime_root();
        let registry =
            BackendBackfillInspectionSubjectRegistryV1::new_dormant_production().unwrap();
        assert_eq!(
            run_with_timeout_and_issue(
                &registry,
                &binary,
                &request(),
                &runtime_root,
                Duration::from_secs(2),
            )
            .err()
            .unwrap(),
            BackendCompilerSidecarRunnerErrorV1::BinaryInvalid
        );
        let (_good_directory, _good_path, good_binary) = candidate(&success_script());
        let proof = run_with_timeout_and_issue(
            &registry,
            &good_binary,
            &request(),
            &runtime_root,
            Duration::from_secs(2),
        )
        .unwrap();
        registry.consume_for_initializer(proof).unwrap();
    }

    #[test]
    fn enforces_timeout_and_bounded_output_while_draining_both_pipes() {
        let cases = [
            (
                "#!/bin/sh\nwhile :; do :; done\n",
                BackendCompilerSidecarRunnerErrorV1::Timeout,
            ),
            (
                "#!/bin/sh\n/usr/bin/yes x\n",
                BackendCompilerSidecarRunnerErrorV1::StdoutLimit,
            ),
            (
                "#!/bin/sh\n/usr/bin/yes x >&2\n",
                BackendCompilerSidecarRunnerErrorV1::StderrLimit,
            ),
        ];
        for (script, expected) in cases {
            assert_failed_run_leaves_scope_available(script, expected, Duration::from_millis(100));
        }
    }

    #[test]
    fn spawn_and_decoder_failures_leave_the_scope_available() {
        assert_failed_run_leaves_scope_available(
            "#!/definitely/not-an-openpencil-interpreter\n",
            BackendCompilerSidecarRunnerErrorV1::SpawnUnavailable,
            Duration::from_secs(2),
        );
        assert_failed_run_leaves_scope_available(
            "#!/bin/sh\n/bin/cat >/dev/null\nprintf '{}\\n'\n",
            BackendCompilerSidecarRunnerErrorV1::Decoder(
                BackendCompilerSidecarErrorV1::InvalidResponse,
            ),
            Duration::from_secs(2),
        );
    }

    #[test]
    fn same_scope_collision_drop_and_cross_registry_consume_are_fail_closed() {
        let (_directory, _path, binary) = candidate(&success_script());
        let request = request();
        let runtime_root = test_runtime_root();

        let collision_registry =
            BackendBackfillInspectionSubjectRegistryV1::new_dormant_production().unwrap();
        let proof = run_verified_backend_compiler_sidecar_and_issue(
            &collision_registry,
            &binary,
            &request,
            &runtime_root,
        )
        .unwrap();
        assert_eq!(
            run_verified_backend_compiler_sidecar_and_issue(
                &collision_registry,
                &binary,
                &request,
                &runtime_root,
            )
            .err()
            .unwrap(),
            BackendCompilerSidecarRunnerErrorV1::Registry(
                BackendBackfillInspectionSubjectErrorV1::ScopeAlreadyActive,
            )
        );
        collision_registry.consume_for_initializer(proof).unwrap();

        let drop_registry =
            BackendBackfillInspectionSubjectRegistryV1::new_dormant_production().unwrap();
        let dropped = run_verified_backend_compiler_sidecar_and_issue(
            &drop_registry,
            &binary,
            &request,
            &runtime_root,
        )
        .unwrap();
        drop(dropped);
        assert_eq!(
            run_verified_backend_compiler_sidecar_and_issue(
                &drop_registry,
                &binary,
                &request,
                &runtime_root,
            )
            .err()
            .unwrap(),
            BackendCompilerSidecarRunnerErrorV1::Registry(
                BackendBackfillInspectionSubjectErrorV1::ScopeAlreadyActive,
            )
        );

        let first = BackendBackfillInspectionSubjectRegistryV1::new_dormant_production().unwrap();
        let second = BackendBackfillInspectionSubjectRegistryV1::new_dormant_production().unwrap();
        let cross_registry = run_verified_backend_compiler_sidecar_and_issue(
            &first,
            &binary,
            &request,
            &runtime_root,
        )
        .unwrap();
        assert_eq!(
            second
                .consume_for_initializer(cross_registry)
                .err()
                .unwrap(),
            BackendBackfillInspectionSubjectErrorV1::HandleInvalid
        );
        assert_eq!(
            run_verified_backend_compiler_sidecar_and_issue(
                &first,
                &binary,
                &request,
                &runtime_root,
            )
            .err()
            .unwrap(),
            BackendCompilerSidecarRunnerErrorV1::Registry(
                BackendBackfillInspectionSubjectErrorV1::ScopeAlreadyActive,
            )
        );
    }

    #[test]
    fn concurrent_pipe_flood_and_descendant_pipe_holder_are_killed_without_deadlock() {
        let (_directory, _path, binary) =
            candidate("#!/bin/sh\n/usr/bin/yes stdout &\n/usr/bin/yes stderr >&2 &\nwait\n");
        let runtime_root = test_runtime_root();
        let started = Instant::now();
        assert!(matches!(
            run_with_timeout(
                &binary,
                &request(),
                &runtime_root,
                Duration::from_millis(200),
            ),
            Err(BackendCompilerSidecarRunnerErrorV1::StdoutLimit)
                | Err(BackendCompilerSidecarRunnerErrorV1::StderrLimit)
        ));
        assert!(started.elapsed() < Duration::from_secs(2));

        let (_directory, _path, binary) =
            candidate("#!/bin/sh\n(/usr/bin/yes ignored >/dev/null) &\nexit 0\n");
        let runtime_root = test_runtime_root();
        let started = Instant::now();
        assert!(matches!(
            run_with_timeout(
                &binary,
                &request(),
                &runtime_root,
                Duration::from_millis(100),
            ),
            Err(BackendCompilerSidecarRunnerErrorV1::Decoder(
                BackendCompilerSidecarErrorV1::ResponseLimit
            )) | Err(BackendCompilerSidecarRunnerErrorV1::Timeout)
        ));
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn zero_arguments_fixed_environment_and_private_cwd_reach_strict_decoder() {
        let response = serde_json::to_string(&fixture()["response"]).unwrap();
        let script = format!(
            "#!/bin/sh\n[ \"$#\" -eq 0 ] || exit 90\n[ \"$LANG\" = C ] || exit 91\n[ \"$LC_ALL\" = C ] || exit 92\n[ \"$TZ\" = UTC ] || exit 93\ncase \"$PWD\" in *openpencil-backend-compiler-*) ;; *) exit 94 ;; esac\n/bin/cat >/dev/null\nprintf '%s\\n' '{response}'\n"
        );
        let (_directory, _path, binary) = candidate(&script);
        let runtime_root = test_runtime_root();
        run_with_timeout(&binary, &request(), &runtime_root, Duration::from_secs(2)).unwrap();
    }

    #[test]
    fn nonempty_stderr_and_invalid_exit_never_create_a_registry_proof() {
        let response = serde_json::to_string(&fixture()["response"]).unwrap();
        for script in [
            format!(
                "#!/bin/sh\n/bin/cat >/dev/null\nprintf diagnostic >&2\nprintf '%s\\n' '{response}'\n"
            ),
            format!(
                "#!/bin/sh\n/bin/cat >/dev/null\nprintf '%s\\n' '{response}'\nexit 1\n"
            ),
        ] {
            let (_directory, _path, binary) = candidate(&script);
            let registry =
                BackendBackfillInspectionSubjectRegistryV1::new_dormant_production().unwrap();
            let runtime_root = test_runtime_root();
            assert!(run_with_timeout_and_issue(
                &registry,
                &binary,
                &request(),
                &runtime_root,
                Duration::from_secs(2)
            )
            .is_err());
            let (_good_directory, _good_path, good_binary) = candidate(&success_script());
            let proof = run_with_timeout_and_issue(
                &registry,
                &good_binary,
                &request(),
                &runtime_root,
                Duration::from_secs(2),
            )
            .unwrap();
            registry.consume_for_initializer(proof).unwrap();
        }
    }

    #[test]
    fn production_source_has_no_renderer_tauri_network_database_or_raw_issuer() {
        let source = include_str!("compiler_sidecar_runner.rs");
        let parent = include_str!("../backend_backfill_inspection_subject.rs");
        let compiler_sidecar = include_str!("compiler_sidecar.rs");
        assert!(!parent.contains("mod compiler_sidecar_runner;"));
        assert!(!parent.contains("run_verified_backend_compiler_sidecar"));
        assert!(compiler_sidecar.contains("#[path = \"compiler_sidecar_runner.rs\"]\nmod runner;"));
        assert!(source.contains("#[cfg(test)]\n    fn new_for_test()"));
        assert!(source.contains("fn run_verified_backend_compiler_sidecar_and_issue("));
        assert!(source.contains(".issue_validated_compiler_inspection(validated)"));
        assert!(source.contains("thread::Builder::new()"));
        assert!(!source.contains(concat!("thread", "::spawn(")));
        assert!(source.contains("_opened_read_only_file"));
        assert!(source.contains("custom_flags(libc::O_NOFOLLOW)"));
        assert!(source.contains("drop(output);"));
        assert!(source.contains("compromised same-UID process"));
        assert!(source.contains("packaged-binary/post-sign gate"));
        assert!(source.contains("escapes its process group with `setsid`"));
        assert!(!source.contains(concat!("child", ".wait()")));
        assert!(source.contains("PROCESS_REAP_GRACE"));
        assert!(source.contains("BackendCompilerSidecarRunnerErrorV1::ReapUnavailable"));
        assert!(source.contains("BackendCompilerSidecarRunnerErrorV1::CleanupUnavailable"));
        assert!(source.contains("set_pipe_nonblocking"));
        assert!(source.contains("in_flight: AtomicBool"));
        assert!(source.contains("compare_exchange(false, true, Ordering::AcqRel"));
        assert!(source.contains("impl Drop for CompilerSidecarAdmissionV1<'_>"));
        let admission_statement = ["let _admission = runtime_root.", "try_admit()?;"].concat();
        assert_eq!(source.matches(&admission_statement).count(), 2);
        assert!(!source.contains(&["static ", "ADMISSION"].concat()));
        assert!(!source.contains(concat!("Cond", "var")));
        assert!(source.contains("BackendCompilerSidecarRunnerErrorV1::PlatformUnavailable"));
        for forbidden in [
            concat!("#[tauri", "::command]"),
            concat!("reqwest", "::"),
            concat!("sqlx", "::"),
            concat!("Credential", "Resolver"),
            concat!("backend_operation", "_journal"),
            concat!("backend_receipt_zero", "_initializer"),
            concat!("external", "Bin"),
            concat!("shell", "plugin"),
        ] {
            assert!(!source.contains(forbidden), "forbidden source: {forbidden}");
        }
        assert!(!source.contains(concat!("pub(super) fn issue_", "validated")));
        assert!(!source.contains(concat!("Serialize for ", "ValidatedCompiler")));
    }
}
