use base64::{
    engine::general_purpose::{STANDARD_NO_PAD, URL_SAFE_NO_PAD},
    Engine as _,
};
use ring::{
    aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM},
    rand::{SecureRandom, SystemRandom},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard, TryLockError},
    thread,
    time::{Duration, Instant},
};
use zeroize::Zeroizing;

const STORE_DIRECTORY: &str = "credentials";
const MASTER_KEY_FILE: &str = "master-key.v1";
const VAULT_FILE: &str = "vault.v1.json";
const LOCK_FILE: &str = "vault.v1.lock";
const VAULT_VERSION: u32 = 1;
const KEY_LENGTH: usize = 32;
const NONCE_LENGTH: usize = 12;
const TAG_LENGTH: usize = 16;
const MAX_SEGMENT_LENGTH: usize = 64;
const MAX_CREDENTIAL_LENGTH: usize = 16 * 1024;
const MAX_CREDENTIAL_RECORDS: usize = 512;
const MAX_VAULT_BYTES: usize = 16 * 1024 * 1024;
const AAD_PREFIX: &[u8] = b"net.dannote.open-pencil:credential:v1:";
const LOCK_WAIT_TIMEOUT: Duration = Duration::from_secs(5);
const LOCK_RETRY_INTERVAL: Duration = Duration::from_millis(25);

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialRef {
    integration_id: String,
    profile_id: String,
    field: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialError {
    code: CredentialErrorCode,
    message: &'static str,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
enum CredentialErrorCode {
    InvalidReference,
    InvalidValue,
    Unavailable,
    Failed,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CredentialStatus {
    Configured,
    Missing,
    Unavailable,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CredentialStoreAvailability {
    Available,
    Unavailable,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum BackendError {
    Unavailable,
    Failed,
}

trait CredentialBackend {
    fn availability(&self) -> Result<(), BackendError>;
    fn read(&self, account: &str) -> Result<Option<String>, BackendError>;
    fn write(&self, account: &str, value: &str) -> Result<(), BackendError>;
    fn remove(&self, account: &str) -> Result<(), BackendError>;
}

#[derive(Clone)]
pub(crate) struct CredentialVault {
    root: Option<PathBuf>,
    process_lock: Arc<Mutex<()>>,
}

impl CredentialVault {
    pub(crate) fn new(app_data_dir: PathBuf) -> Self {
        Self {
            root: Some(app_data_dir.join(STORE_DIRECTORY)),
            process_lock: Arc::new(Mutex::new(())),
        }
    }

    pub(crate) fn unavailable() -> Self {
        Self {
            root: None,
            process_lock: Arc::new(Mutex::new(())),
        }
    }

    fn with_store<T>(
        &self,
        operation: impl FnOnce(&Path) -> Result<T, BackendError>,
    ) -> Result<T, BackendError> {
        let root = self.root.as_deref().ok_or(BackendError::Unavailable)?;
        let _process_guard = acquire_process_lock(&self.process_lock)?;
        ensure_store_directory(root)?;
        let _file_guard = CredentialFileLock::acquire(&root.join(LOCK_FILE))?;
        cleanup_stale_staging_files(root)?;
        operation(root)
    }
}

fn acquire_process_lock(lock: &Mutex<()>) -> Result<MutexGuard<'_, ()>, BackendError> {
    let deadline = Instant::now() + LOCK_WAIT_TIMEOUT;
    loop {
        match lock.try_lock() {
            Ok(guard) => return Ok(guard),
            Err(TryLockError::Poisoned(_)) => return Err(BackendError::Failed),
            Err(TryLockError::WouldBlock) if Instant::now() >= deadline => {
                return Err(BackendError::Unavailable)
            }
            Err(TryLockError::WouldBlock) => thread::sleep(LOCK_RETRY_INTERVAL),
        }
    }
}

impl CredentialBackend for CredentialVault {
    fn availability(&self) -> Result<(), BackendError> {
        self.with_store(|root| {
            let vault = load_vault(root)?;
            let key = load_or_create_master_key(root, !vault.records.is_empty())?;
            verify_vault_records(&key, &vault)
        })
    }

    fn read(&self, account: &str) -> Result<Option<String>, BackendError> {
        self.with_store(|root| {
            let vault = load_vault(root)?;
            let Some(record) = vault.records.get(account) else {
                return Ok(None);
            };
            let key = load_or_create_master_key(root, true)?;
            decrypt_record(&key, account, record).map(Some)
        })
    }

    fn write(&self, account: &str, value: &str) -> Result<(), BackendError> {
        self.with_store(|root| {
            let mut vault = load_vault(root)?;
            if !vault.records.contains_key(account) && vault.records.len() >= MAX_CREDENTIAL_RECORDS
            {
                return Err(BackendError::Failed);
            }
            let key = load_or_create_master_key(root, !vault.records.is_empty())?;
            verify_vault_records(&key, &vault)?;
            let record = encrypt_record(&key, account, value)?;
            vault.records.insert(account.to_owned(), record);
            persist_vault(root, &vault)
        })
    }

    fn remove(&self, account: &str) -> Result<(), BackendError> {
        self.with_store(|root| {
            let mut vault = load_vault(root)?;
            if !vault.records.contains_key(account) {
                return Ok(());
            }
            let key = load_or_create_master_key(root, true)?;
            verify_vault_records(&key, &vault)?;
            vault.records.remove(account);
            persist_vault(root, &vault)
        })
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct EncryptedCredential {
    nonce: String,
    ciphertext: String,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct CredentialVaultFile {
    version: u32,
    records: BTreeMap<String, EncryptedCredential>,
}

impl Default for CredentialVaultFile {
    fn default() -> Self {
        Self {
            version: VAULT_VERSION,
            records: BTreeMap::new(),
        }
    }
}

struct CredentialFileLock {
    file: File,
    #[cfg(windows)]
    overlapped: windows_sys::Win32::System::IO::OVERLAPPED,
}

impl CredentialFileLock {
    fn acquire(path: &Path) -> Result<Self, BackendError> {
        reject_non_regular_file_if_present(path)?;
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true);
        configure_private_open_options(&mut options);
        let file = options.open(path).map_err(map_io_error)?;
        validate_open_file(&file)?;
        set_private_file_permissions(&file)?;

        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            let deadline = Instant::now() + LOCK_WAIT_TIMEOUT;
            loop {
                // SAFETY: the descriptor belongs to `file` and remains open for the guard lifetime.
                let result =
                    unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
                if result == 0 {
                    return Ok(Self { file });
                }
                let error = io::Error::last_os_error();
                if error.kind() == io::ErrorKind::Interrupted {
                    continue;
                }
                if error.kind() != io::ErrorKind::WouldBlock {
                    return Err(map_io_error(error));
                }
                if Instant::now() >= deadline {
                    return Err(BackendError::Unavailable);
                }
                thread::sleep(LOCK_RETRY_INTERVAL);
            }
        }

        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawHandle;
            use windows_sys::Win32::{
                Foundation::ERROR_LOCK_VIOLATION,
                Storage::FileSystem::{
                    LockFileEx, LOCKFILE_EXCLUSIVE_LOCK, LOCKFILE_FAIL_IMMEDIATELY,
                },
            };

            // An all-zero OVERLAPPED locks from offset zero and stays alive in the guard.
            let mut overlapped = unsafe { std::mem::zeroed() };
            let deadline = Instant::now() + LOCK_WAIT_TIMEOUT;
            loop {
                // SAFETY: the handle is valid for `file`; both it and `overlapped` remain alive
                // until the matching UnlockFileEx call in Drop.
                let result = unsafe {
                    LockFileEx(
                        file.as_raw_handle() as _,
                        LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY,
                        0,
                        u32::MAX,
                        u32::MAX,
                        &mut overlapped,
                    )
                };
                if result != 0 {
                    return Ok(Self { file, overlapped });
                }
                let error = io::Error::last_os_error();
                if error.raw_os_error() != Some(ERROR_LOCK_VIOLATION as i32) {
                    return Err(map_io_error(error));
                }
                if Instant::now() >= deadline {
                    return Err(BackendError::Unavailable);
                }
                thread::sleep(LOCK_RETRY_INTERVAL);
            }
        }

        #[cfg(not(any(unix, windows)))]
        {
            Ok(Self { file })
        }
    }
}

impl Drop for CredentialFileLock {
    fn drop(&mut self) {
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            // SAFETY: this guard owns a still-open descriptor locked by `acquire`.
            let _ = unsafe { libc::flock(self.file.as_raw_fd(), libc::LOCK_UN) };
        }

        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawHandle;
            use windows_sys::Win32::Storage::FileSystem::UnlockFileEx;
            // SAFETY: the handle and OVERLAPPED pair match the successful LockFileEx call.
            let _ = unsafe {
                UnlockFileEx(
                    self.file.as_raw_handle() as _,
                    0,
                    u32::MAX,
                    u32::MAX,
                    &mut self.overlapped,
                )
            };
        }
    }
}

fn map_io_error(error: io::Error) -> BackendError {
    if error.kind() == io::ErrorKind::PermissionDenied {
        BackendError::Unavailable
    } else {
        BackendError::Failed
    }
}

fn ensure_store_directory(root: &Path) -> Result<(), BackendError> {
    let app_data_dir = root.parent().ok_or(BackendError::Failed)?;
    ensure_private_directory(app_data_dir)?;
    ensure_private_directory(root)
}

fn ensure_private_directory(path: &Path) -> Result<(), BackendError> {
    let existed = match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(BackendError::Unavailable);
            }
            true
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => false,
        Err(error) => return Err(map_io_error(error)),
    };
    if !existed {
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        match builder.create(path) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(map_io_error(error)),
        }
    }

    let metadata = fs::symlink_metadata(path).map_err(map_io_error)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(BackendError::Unavailable);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(map_io_error)?;
    }
    if !existed {
        let parent = path.parent().ok_or(BackendError::Failed)?;
        sync_directory(parent)?;
    }
    Ok(())
}

fn reject_non_regular_file_if_present(path: &Path) -> Result<bool, BackendError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(BackendError::Unavailable);
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                if metadata.nlink() != 1 {
                    return Err(BackendError::Unavailable);
                }
            }
            Ok(true)
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(map_io_error(error)),
    }
}

fn validate_open_file(file: &File) -> Result<(), BackendError> {
    let metadata = file.metadata().map_err(map_io_error)?;
    if !metadata.is_file() {
        return Err(BackendError::Unavailable);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 {
            return Err(BackendError::Unavailable);
        }
    }
    Ok(())
}

fn configure_private_open_options(options: &mut OpenOptions) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
}

fn set_private_file_permissions(file: &File) -> Result<(), BackendError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(map_io_error)?;
    }
    Ok(())
}

fn read_bounded_regular_file(
    path: &Path,
    max_bytes: usize,
) -> Result<Option<Vec<u8>>, BackendError> {
    if !reject_non_regular_file_if_present(path)? {
        return Ok(None);
    }
    let mut options = OpenOptions::new();
    options.read(true);
    configure_private_open_options(&mut options);
    let mut file = options.open(path).map_err(map_io_error)?;
    validate_open_file(&file)?;
    set_private_file_permissions(&file)?;
    let metadata = file.metadata().map_err(map_io_error)?;
    if metadata.len() > max_bytes as u64 {
        return Err(BackendError::Failed);
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    Read::by_ref(&mut file)
        .take((max_bytes + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(map_io_error)?;
    if bytes.len() > max_bytes {
        return Err(BackendError::Failed);
    }
    Ok(Some(bytes))
}

fn load_or_create_master_key(
    root: &Path,
    vault_requires_key: bool,
) -> Result<Zeroizing<Vec<u8>>, BackendError> {
    let path = root.join(MASTER_KEY_FILE);
    if let Some(bytes) = read_bounded_regular_file(&path, KEY_LENGTH)? {
        if bytes.len() != KEY_LENGTH {
            return Err(BackendError::Failed);
        }
        return Ok(Zeroizing::new(bytes));
    }
    if vault_requires_key || reject_non_regular_file_if_present(&root.join(VAULT_FILE))? {
        return Err(BackendError::Failed);
    }

    let mut key = Zeroizing::new(vec![0_u8; KEY_LENGTH]);
    SystemRandom::new()
        .fill(key.as_mut_slice())
        .map_err(|_| BackendError::Failed)?;
    persist_new_file(root, &path, &key)?;
    Ok(key)
}

fn load_vault(root: &Path) -> Result<CredentialVaultFile, BackendError> {
    let path = root.join(VAULT_FILE);
    let Some(bytes) = read_bounded_regular_file(&path, MAX_VAULT_BYTES)? else {
        return Ok(CredentialVaultFile::default());
    };
    let vault: CredentialVaultFile =
        serde_json::from_slice(&bytes).map_err(|_| BackendError::Failed)?;
    validate_vault(&vault)?;
    Ok(vault)
}

fn validate_vault(vault: &CredentialVaultFile) -> Result<(), BackendError> {
    if vault.version != VAULT_VERSION || vault.records.len() > MAX_CREDENTIAL_RECORDS {
        return Err(BackendError::Failed);
    }
    for (account, record) in &vault.records {
        validate_account(account)?;
        let _decoded = decode_record(record)?;
    }
    Ok(())
}

fn validate_account(account: &str) -> Result<(), BackendError> {
    let mut segments = account.split(':');
    match (
        segments.next(),
        segments.next(),
        segments.next(),
        segments.next(),
        segments.next(),
    ) {
        (Some("v1"), Some(integration), Some(profile), Some(field), None)
            if validate_segment(integration)
                && validate_segment(profile)
                && validate_segment(field) =>
        {
            Ok(())
        }
        _ => Err(BackendError::Failed),
    }
}

fn decode_record(
    record: &EncryptedCredential,
) -> Result<([u8; NONCE_LENGTH], Zeroizing<Vec<u8>>), BackendError> {
    let nonce = URL_SAFE_NO_PAD
        .decode(&record.nonce)
        .map_err(|_| BackendError::Failed)?;
    let nonce: [u8; NONCE_LENGTH] = nonce.try_into().map_err(|_| BackendError::Failed)?;
    let ciphertext = Zeroizing::new(
        STANDARD_NO_PAD
            .decode(&record.ciphertext)
            .map_err(|_| BackendError::Failed)?,
    );
    if ciphertext.len() <= TAG_LENGTH || ciphertext.len() > MAX_CREDENTIAL_LENGTH + TAG_LENGTH {
        return Err(BackendError::Failed);
    }
    Ok((nonce, ciphertext))
}

fn cipher(key: &[u8]) -> Result<LessSafeKey, BackendError> {
    UnboundKey::new(&AES_256_GCM, key)
        .map(LessSafeKey::new)
        .map_err(|_| BackendError::Failed)
}

fn additional_data(account: &str) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(AAD_PREFIX.len() + account.len());
    bytes.extend_from_slice(AAD_PREFIX);
    bytes.extend_from_slice(account.as_bytes());
    bytes
}

fn encrypt_record(
    key: &[u8],
    account: &str,
    value: &str,
) -> Result<EncryptedCredential, BackendError> {
    let mut nonce_bytes = [0_u8; NONCE_LENGTH];
    SystemRandom::new()
        .fill(&mut nonce_bytes)
        .map_err(|_| BackendError::Failed)?;
    let mut plaintext = Zeroizing::new(value.as_bytes().to_vec());
    cipher(key)?
        .seal_in_place_append_tag(
            Nonce::assume_unique_for_key(nonce_bytes),
            Aad::from(additional_data(account)),
            &mut *plaintext,
        )
        .map_err(|_| BackendError::Failed)?;
    Ok(EncryptedCredential {
        nonce: URL_SAFE_NO_PAD.encode(nonce_bytes),
        ciphertext: STANDARD_NO_PAD.encode(&*plaintext),
    })
}

fn decrypt_record(
    key: &[u8],
    account: &str,
    record: &EncryptedCredential,
) -> Result<String, BackendError> {
    let (nonce, mut ciphertext) = decode_record(record)?;
    let plaintext = cipher(key)?
        .open_in_place(
            Nonce::assume_unique_for_key(nonce),
            Aad::from(additional_data(account)),
            ciphertext.as_mut_slice(),
        )
        .map_err(|_| BackendError::Failed)?;
    let value = std::str::from_utf8(plaintext).map_err(|_| BackendError::Failed)?;
    if value.is_empty() || value.len() > MAX_CREDENTIAL_LENGTH {
        return Err(BackendError::Failed);
    }
    Ok(value.to_owned())
}

fn verify_vault_records(key: &[u8], vault: &CredentialVaultFile) -> Result<(), BackendError> {
    for (account, record) in &vault.records {
        let _plaintext = Zeroizing::new(decrypt_record(key, account, record)?);
    }
    Ok(())
}

fn stage_private_file(root: &Path, label: &str, bytes: &[u8]) -> Result<PathBuf, BackendError> {
    for _ in 0..8 {
        let mut random = [0_u8; 16];
        SystemRandom::new()
            .fill(&mut random)
            .map_err(|_| BackendError::Failed)?;
        let path = root.join(format!(".{label}-{}.tmp", URL_SAFE_NO_PAD.encode(random)));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        configure_private_open_options(&mut options);
        let mut file = match options.open(&path) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(map_io_error(error)),
        };
        let staged = (|| {
            validate_open_file(&file)?;
            set_private_file_permissions(&file)?;
            file.write_all(bytes).map_err(map_io_error)?;
            file.sync_all().map_err(map_io_error)
        })();
        drop(file);
        if let Err(error) = staged {
            let _ = fs::remove_file(&path);
            return Err(error);
        }
        return Ok(path);
    }
    Err(BackendError::Failed)
}

fn cleanup_stale_staging_files(root: &Path) -> Result<(), BackendError> {
    let mut removed_any = false;
    for entry in fs::read_dir(root).map_err(map_io_error)? {
        let entry = entry.map_err(map_io_error)?;
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if !is_staging_file_name(&name) {
            continue;
        }
        let path = entry.path();
        if !reject_non_regular_file_if_present(&path)? {
            continue;
        }
        fs::remove_file(path).map_err(map_io_error)?;
        removed_any = true;
    }
    if removed_any {
        sync_directory(root)?;
    }
    Ok(())
}

fn is_staging_file_name(name: &str) -> bool {
    [".master-key-", ".vault-"].into_iter().any(|prefix| {
        name.strip_prefix(prefix)
            .and_then(|value| value.strip_suffix(".tmp"))
            .is_some_and(|random| {
                random.len() == 22
                    && random
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
            })
    })
}

fn persist_new_file(root: &Path, target: &Path, bytes: &[u8]) -> Result<(), BackendError> {
    if reject_non_regular_file_if_present(target)? {
        return Err(BackendError::Failed);
    }
    let temporary = stage_private_file(root, "master-key", bytes)?;
    if reject_non_regular_file_if_present(target)? {
        let _ = fs::remove_file(&temporary);
        return Err(BackendError::Failed);
    }
    if let Err(error) = move_new_file_atomically(&temporary, target) {
        let _ = fs::remove_file(&temporary);
        return Err(map_io_error(error));
    }
    sync_directory(root)
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn unix_path(path: &Path) -> io::Result<std::ffi::CString> {
    use std::os::unix::ffi::OsStrExt;
    std::ffi::CString::new(path.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "Credential path is invalid"))
}

#[cfg(target_os = "macos")]
fn move_new_file_atomically(temporary: &Path, target: &Path) -> io::Result<()> {
    let temporary = unix_path(temporary)?;
    let target = unix_path(target)?;
    // SAFETY: both C strings are NUL-terminated and remain alive for the call.
    let result =
        unsafe { libc::renamex_np(temporary.as_ptr(), target.as_ptr(), libc::RENAME_EXCL) };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(target_os = "linux")]
fn move_new_file_atomically(temporary: &Path, target: &Path) -> io::Result<()> {
    let temporary = unix_path(temporary)?;
    let target = unix_path(target)?;
    // SAFETY: both C strings are NUL-terminated and remain alive for the call.
    let result = unsafe {
        libc::syscall(
            libc::SYS_renameat2,
            libc::AT_FDCWD,
            temporary.as_ptr(),
            libc::AT_FDCWD,
            target.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(windows)]
fn move_new_file_atomically(temporary: &Path, target: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_WRITE_THROUGH};

    fn wide_path(path: &Path) -> io::Result<Vec<u16>> {
        let mut encoded = path.as_os_str().encode_wide().collect::<Vec<_>>();
        if encoded.contains(&0) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Credential path contains a null character",
            ));
        }
        encoded.push(0);
        Ok(encoded)
    }

    let temporary = wide_path(temporary)?;
    let target = wide_path(target)?;
    // SAFETY: both paths are NUL-terminated and remain alive for the native call.
    let result =
        unsafe { MoveFileExW(temporary.as_ptr(), target.as_ptr(), MOVEFILE_WRITE_THROUGH) };
    if result == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
fn move_new_file_atomically(_temporary: &Path, _target: &Path) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "Atomic credential key persistence is unsupported",
    ))
}

fn persist_vault(root: &Path, vault: &CredentialVaultFile) -> Result<(), BackendError> {
    validate_vault(vault)?;
    let bytes = serde_json::to_vec(vault).map_err(|_| BackendError::Failed)?;
    if bytes.len() > MAX_VAULT_BYTES {
        return Err(BackendError::Failed);
    }
    let target = root.join(VAULT_FILE);
    reject_non_regular_file_if_present(&target)?;
    let temporary = stage_private_file(root, "vault", &bytes)?;
    if let Err(error) = reject_non_regular_file_if_present(&target) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    if let Err(error) = replace_existing_atomically(&temporary, &target) {
        let _ = fs::remove_file(&temporary);
        return Err(map_io_error(error));
    }
    sync_directory(root)
}

#[cfg(not(windows))]
fn replace_existing_atomically(temporary: &Path, target: &Path) -> io::Result<()> {
    fs::rename(temporary, target)
}

#[cfg(windows)]
fn replace_existing_atomically(temporary: &Path, target: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    fn wide_path(path: &Path) -> io::Result<Vec<u16>> {
        let mut encoded = path.as_os_str().encode_wide().collect::<Vec<_>>();
        if encoded.contains(&0) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Credential path contains a null character",
            ));
        }
        encoded.push(0);
        Ok(encoded)
    }

    let temporary = wide_path(temporary)?;
    let target = wide_path(target)?;
    // SAFETY: both paths are NUL-terminated and remain alive for the native call.
    let result = unsafe {
        MoveFileExW(
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

fn sync_directory(root: &Path) -> Result<(), BackendError> {
    #[cfg(unix)]
    {
        File::open(root)
            .and_then(|directory| directory.sync_all())
            .map_err(map_io_error)?;
    }
    Ok(())
}

fn validate_segment(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_SEGMENT_LENGTH
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'_' | b'-')
        })
}

fn account_for(reference: &CredentialRef) -> Result<String, CredentialError> {
    if !validate_segment(&reference.integration_id)
        || !validate_segment(&reference.profile_id)
        || !validate_segment(&reference.field)
    {
        return Err(CredentialError {
            code: CredentialErrorCode::InvalidReference,
            message: "Credential reference is invalid",
        });
    }

    Ok(format!(
        "v1:{}:{}:{}",
        reference.integration_id, reference.profile_id, reference.field
    ))
}

fn public_error(error: BackendError) -> CredentialError {
    match error {
        BackendError::Unavailable => CredentialError {
            code: CredentialErrorCode::Unavailable,
            message: "The app-local credential store is unavailable",
        },
        BackendError::Failed => CredentialError {
            code: CredentialErrorCode::Failed,
            message: "The credential operation failed",
        },
    }
}

fn read_with(
    backend: &impl CredentialBackend,
    reference: &CredentialRef,
) -> Result<Option<String>, CredentialError> {
    let account = account_for(reference)?;
    backend.read(&account).map_err(public_error)
}

fn write_with(
    backend: &impl CredentialBackend,
    reference: &CredentialRef,
    value: &str,
) -> Result<(), CredentialError> {
    if value.is_empty() || value.len() > MAX_CREDENTIAL_LENGTH {
        return Err(CredentialError {
            code: CredentialErrorCode::InvalidValue,
            message: "Credential value is invalid",
        });
    }
    let account = account_for(reference)?;
    backend.write(&account, value).map_err(public_error)
}

fn remove_with(
    backend: &impl CredentialBackend,
    reference: &CredentialRef,
) -> Result<(), CredentialError> {
    let account = account_for(reference)?;
    backend.remove(&account).map_err(public_error)
}

#[tauri::command]
pub async fn credential_store_availability(
    vault: tauri::State<'_, CredentialVault>,
) -> Result<CredentialStoreAvailability, CredentialError> {
    let vault = vault.inner().clone();
    tauri::async_runtime::spawn_blocking(move || match vault.availability() {
        Ok(()) => Ok(CredentialStoreAvailability::Available),
        Err(BackendError::Unavailable) => Ok(CredentialStoreAvailability::Unavailable),
        Err(error) => Err(public_error(error)),
    })
    .await
    .map_err(|_| public_error(BackendError::Failed))?
}

#[tauri::command]
pub async fn credential_status(
    vault: tauri::State<'_, CredentialVault>,
    reference: CredentialRef,
) -> Result<CredentialStatus, CredentialError> {
    let vault = vault.inner().clone();
    tauri::async_runtime::spawn_blocking(move || match read_with(&vault, &reference) {
        Ok(Some(value)) => {
            let _value = Zeroizing::new(value);
            Ok(CredentialStatus::Configured)
        }
        Ok(None) => Ok(CredentialStatus::Missing),
        Err(CredentialError {
            code: CredentialErrorCode::Unavailable,
            ..
        }) => Ok(CredentialStatus::Unavailable),
        Err(error) => Err(error),
    })
    .await
    .map_err(|_| public_error(BackendError::Failed))?
}

#[tauri::command]
pub async fn credential_read(
    vault: tauri::State<'_, CredentialVault>,
    reference: CredentialRef,
) -> Result<Option<String>, CredentialError> {
    let vault = vault.inner().clone();
    tauri::async_runtime::spawn_blocking(move || read_with(&vault, &reference))
        .await
        .map_err(|_| public_error(BackendError::Failed))?
}

#[tauri::command]
pub async fn credential_write(
    vault: tauri::State<'_, CredentialVault>,
    reference: CredentialRef,
    value: String,
) -> Result<(), CredentialError> {
    let vault = vault.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let value = Zeroizing::new(value);
        write_with(&vault, &reference, &value)
    })
    .await
    .map_err(|_| public_error(BackendError::Failed))?
}

#[tauri::command]
pub async fn credential_remove(
    vault: tauri::State<'_, CredentialVault>,
    reference: CredentialRef,
) -> Result<(), CredentialError> {
    let vault = vault.inner().clone();
    tauri::async_runtime::spawn_blocking(move || remove_with(&vault, &reference))
        .await
        .map_err(|_| public_error(BackendError::Failed))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        collections::HashMap,
        sync::{Arc, Barrier, Mutex},
        thread,
    };

    #[derive(Default)]
    struct MemoryBackend(Mutex<HashMap<String, String>>);

    impl CredentialBackend for MemoryBackend {
        fn availability(&self) -> Result<(), BackendError> {
            Ok(())
        }

        fn read(&self, account: &str) -> Result<Option<String>, BackendError> {
            Ok(self
                .0
                .lock()
                .ok()
                .and_then(|values| values.get(account).cloned()))
        }

        fn write(&self, account: &str, value: &str) -> Result<(), BackendError> {
            self.0
                .lock()
                .map_err(|_| BackendError::Failed)?
                .insert(account.to_owned(), value.to_owned());
            Ok(())
        }

        fn remove(&self, account: &str) -> Result<(), BackendError> {
            self.0
                .lock()
                .map_err(|_| BackendError::Failed)?
                .remove(account);
            Ok(())
        }
    }

    fn reference() -> CredentialRef {
        CredentialRef {
            integration_id: "openai-compatible".to_owned(),
            profile_id: "default".to_owned(),
            field: "api-key".to_owned(),
        }
    }

    fn second_reference() -> CredentialRef {
        CredentialRef {
            integration_id: "google-drive".to_owned(),
            profile_id: "personal".to_owned(),
            field: "authorization".to_owned(),
        }
    }

    fn test_vault(directory: &tempfile::TempDir) -> CredentialVault {
        CredentialVault::new(directory.path().to_path_buf())
    }

    #[test]
    fn creates_stable_versioned_account_names() {
        assert_eq!(
            account_for(&reference()).expect("valid reference"),
            "v1:openai-compatible:default:api-key"
        );
    }

    #[test]
    fn rejects_untrusted_account_segments() {
        let invalid = CredentialRef {
            integration_id: "../../other-app".to_owned(),
            ..reference()
        };

        assert!(account_for(&invalid).is_err());
    }

    #[test]
    fn rejects_empty_credential_values() {
        let backend = MemoryBackend::default();
        assert!(write_with(&backend, &reference(), "").is_err());
    }

    #[test]
    fn reads_writes_and_removes_through_backend_contract() {
        let backend = MemoryBackend::default();
        let reference = reference();

        assert_eq!(read_with(&backend, &reference).expect("initial read"), None);
        write_with(&backend, &reference, "secret").expect("write");
        assert_eq!(
            read_with(&backend, &reference).expect("configured read"),
            Some("secret".to_owned())
        );
        remove_with(&backend, &reference).expect("remove");
        remove_with(&backend, &reference).expect("idempotent remove");
        assert_eq!(read_with(&backend, &reference).expect("removed read"), None);
    }

    #[test]
    fn persists_encrypted_credentials_across_vault_instances() {
        let directory = tempfile::tempdir().expect("temporary app data");
        let reference = reference();
        let vault = test_vault(&directory);

        write_with(&vault, &reference, "disk-secret-marker").expect("encrypted write");
        let reopened = test_vault(&directory);
        assert_eq!(
            read_with(&reopened, &reference).expect("persisted read"),
            Some("disk-secret-marker".to_owned())
        );

        let store_root = directory.path().join(STORE_DIRECTORY);
        let vault_bytes = fs::read(store_root.join(VAULT_FILE)).expect("vault bytes");
        assert!(!String::from_utf8_lossy(&vault_bytes).contains("disk-secret-marker"));
        assert_eq!(
            fs::read(store_root.join(MASTER_KEY_FILE))
                .expect("master key")
                .len(),
            KEY_LENGTH
        );

        remove_with(&reopened, &reference).expect("remove");
        assert_eq!(
            read_with(&reopened, &reference).expect("removed read"),
            None
        );
    }

    #[test]
    fn rewrites_the_same_value_with_a_fresh_nonce() {
        let directory = tempfile::tempdir().expect("temporary app data");
        let vault = test_vault(&directory);
        let reference = reference();
        let account = account_for(&reference).expect("account");

        write_with(&vault, &reference, "same-secret").expect("first write");
        let mut first_vault =
            load_vault(&directory.path().join(STORE_DIRECTORY)).expect("first vault");
        let first = first_vault.records.remove(&account).expect("first record");
        write_with(&vault, &reference, "same-secret").expect("second write");
        let mut second_vault =
            load_vault(&directory.path().join(STORE_DIRECTORY)).expect("second vault");
        let second = second_vault
            .records
            .remove(&account)
            .expect("second record");

        assert_ne!(first.nonce, second.nonce);
        assert_ne!(first.ciphertext, second.ciphertext);
    }

    #[test]
    fn ciphertext_is_bound_to_its_credential_account() {
        let directory = tempfile::tempdir().expect("temporary app data");
        let vault = test_vault(&directory);
        let first = reference();
        let second = second_reference();
        write_with(&vault, &first, "first-secret").expect("first write");
        write_with(&vault, &second, "second-secret").expect("second write");

        let root = directory.path().join(STORE_DIRECTORY);
        let path = root.join(VAULT_FILE);
        let mut stored = load_vault(&root).expect("vault");
        let first_account = account_for(&first).expect("first account");
        let second_account = account_for(&second).expect("second account");
        let first_record = stored.records.remove(&first_account).expect("first record");
        let second_record = stored
            .records
            .remove(&second_account)
            .expect("second record");
        stored.records.insert(first_account, second_record);
        stored.records.insert(second_account, first_record);
        fs::write(&path, serde_json::to_vec(&stored).expect("tampered vault"))
            .expect("tamper vault");

        assert!(vault.read(&account_for(&first).unwrap()).is_err());
    }

    #[test]
    fn corrupted_vault_fails_closed_without_being_overwritten() {
        let directory = tempfile::tempdir().expect("temporary app data");
        let vault = test_vault(&directory);
        write_with(&vault, &reference(), "original-secret").expect("initial write");
        let path = directory.path().join(STORE_DIRECTORY).join(VAULT_FILE);
        let corrupted = b"{\"version\":1,\"records\":".to_vec();
        fs::write(&path, &corrupted).expect("corrupt vault");

        assert!(write_with(&vault, &second_reference(), "replacement").is_err());
        assert_eq!(fs::read(path).expect("preserved corruption"), corrupted);
    }

    #[test]
    fn missing_key_for_an_existing_vault_fails_closed() {
        let directory = tempfile::tempdir().expect("temporary app data");
        let vault = test_vault(&directory);
        write_with(&vault, &reference(), "keep-secret").expect("initial write");
        let root = directory.path().join(STORE_DIRECTORY);
        fs::remove_file(root.join(MASTER_KEY_FILE)).expect("simulate missing key");
        let before = fs::read(root.join(VAULT_FILE)).expect("vault before");

        assert!(write_with(&vault, &second_reference(), "must-not-replace").is_err());
        assert_eq!(
            fs::read(root.join(VAULT_FILE)).expect("vault after"),
            before
        );
        assert!(!root.join(MASTER_KEY_FILE).exists());
    }

    #[test]
    fn wrong_key_fails_authentication_without_overwriting_the_vault() {
        let directory = tempfile::tempdir().expect("temporary app data");
        let vault = test_vault(&directory);
        write_with(&vault, &reference(), "keep-secret").expect("initial write");
        let root = directory.path().join(STORE_DIRECTORY);
        let vault_path = root.join(VAULT_FILE);
        let before = fs::read(&vault_path).expect("vault before");
        fs::write(root.join(MASTER_KEY_FILE), [7_u8; KEY_LENGTH]).expect("replace key");

        assert!(write_with(&vault, &second_reference(), "must-not-replace").is_err());
        assert_eq!(fs::read(vault_path).expect("vault after"), before);
    }

    #[test]
    fn unknown_vault_version_fails_closed_without_replacement() {
        let directory = tempfile::tempdir().expect("temporary app data");
        let vault = test_vault(&directory);
        write_with(&vault, &reference(), "keep-secret").expect("initial write");
        let path = directory.path().join(STORE_DIRECTORY).join(VAULT_FILE);
        let mut stored: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).expect("vault")).expect("vault json");
        stored["version"] = serde_json::json!(VAULT_VERSION + 1);
        let unsupported = serde_json::to_vec(&stored).expect("unsupported vault");
        fs::write(&path, &unsupported).expect("replace version");

        assert!(write_with(&vault, &second_reference(), "must-not-replace").is_err());
        assert_eq!(fs::read(path).expect("vault after"), unsupported);
    }

    #[test]
    fn creates_each_missing_managed_directory_before_opening_the_vault() {
        let directory = tempfile::tempdir().expect("temporary data root");
        let app_data = directory.path().join("app-local-data");
        let vault = CredentialVault::new(app_data.clone());

        assert_eq!(vault.availability(), Ok(()));
        assert!(app_data.is_dir());
        assert!(app_data.join(STORE_DIRECTORY).is_dir());
        assert!(app_data
            .join(STORE_DIRECTORY)
            .join(MASTER_KEY_FILE)
            .is_file());
    }

    #[test]
    fn removes_interrupted_staging_files_before_access() {
        let directory = tempfile::tempdir().expect("temporary app data");
        let root = directory.path().join(STORE_DIRECTORY);
        ensure_store_directory(&root).expect("store directory");
        let staged_key = root.join(".master-key-AAAAAAAAAAAAAAAAAAAAAA.tmp");
        let staged_vault = root.join(".vault-BBBBBBBBBBBBBBBBBBBBBB.tmp");
        let similarly_named_file = root.join(".vault-user-note.tmp");
        fs::write(&staged_key, b"unfinished-key").expect("staged key");
        fs::write(&staged_vault, b"unfinished-vault").expect("staged vault");
        fs::write(&similarly_named_file, b"keep").expect("unmanaged file");

        assert_eq!(test_vault(&directory).availability(), Ok(()));
        assert!(!staged_key.exists());
        assert!(!staged_vault.exists());
        assert_eq!(
            fs::read(similarly_named_file).expect("preserved unmanaged file"),
            b"keep"
        );
    }

    #[test]
    fn atomic_key_publish_never_replaces_an_existing_target() {
        let directory = tempfile::tempdir().expect("temporary app data");
        let root = directory.path().join(STORE_DIRECTORY);
        ensure_store_directory(&root).expect("store directory");
        let temporary =
            stage_private_file(&root, "master-key", b"replacement").expect("stage replacement");
        let target = root.join(MASTER_KEY_FILE);
        fs::write(&target, b"existing").expect("existing key");

        assert!(move_new_file_atomically(&temporary, &target).is_err());
        assert_eq!(fs::read(&target).expect("preserved target"), b"existing");
        assert_eq!(
            fs::read(&temporary).expect("preserved staging file"),
            b"replacement"
        );
    }

    #[test]
    fn file_lock_prevents_lost_updates_between_vault_instances() {
        let directory = tempfile::tempdir().expect("temporary app data");
        let first_vault = test_vault(&directory);
        let second_vault = test_vault(&directory);
        let barrier = Arc::new(Barrier::new(3));

        let first_barrier = barrier.clone();
        let first = thread::spawn(move || {
            first_barrier.wait();
            write_with(&first_vault, &reference(), "first-secret")
        });
        let second_barrier = barrier.clone();
        let second = thread::spawn(move || {
            second_barrier.wait();
            write_with(&second_vault, &second_reference(), "second-secret")
        });
        barrier.wait();

        first.join().expect("first writer").expect("first write");
        second.join().expect("second writer").expect("second write");
        let reopened = test_vault(&directory);
        assert_eq!(
            read_with(&reopened, &reference()).expect("first read"),
            Some("first-secret".to_owned())
        );
        assert_eq!(
            read_with(&reopened, &second_reference()).expect("second read"),
            Some("second-secret".to_owned())
        );
    }

    #[cfg(unix)]
    #[test]
    fn uses_private_unix_permissions() {
        use std::os::unix::fs::MetadataExt;
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().expect("temporary app data");
        let vault = test_vault(&directory);
        write_with(&vault, &reference(), "secret").expect("write");
        let root = directory.path().join(STORE_DIRECTORY);

        assert_eq!(
            fs::metadata(&root).unwrap().permissions().mode() & 0o777,
            0o700
        );
        for file in [MASTER_KEY_FILE, VAULT_FILE, LOCK_FILE] {
            assert_eq!(
                fs::metadata(root.join(file)).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        assert_eq!(fs::metadata(root.join(MASTER_KEY_FILE)).unwrap().nlink(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symbolic_links_and_hard_links() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().expect("temporary app data");
        let root = directory.path().join(STORE_DIRECTORY);
        let real = directory.path().join("real-store");
        fs::create_dir(&real).expect("real directory");
        symlink(&real, &root).expect("store symlink");
        assert_eq!(
            test_vault(&directory).availability(),
            Err(BackendError::Unavailable)
        );
        fs::remove_file(&root).expect("remove symlink");

        let vault = test_vault(&directory);
        write_with(&vault, &reference(), "secret").expect("write");
        fs::hard_link(root.join(MASTER_KEY_FILE), root.join("copied-key")).expect("hard-link key");
        assert!(read_with(&vault, &reference()).is_err());
    }
}
