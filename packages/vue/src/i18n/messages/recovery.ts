import { i18n } from '#vue/i18n/create'

export const recoveryMessageDefaults = {
  dialogTitle: 'Recover unsaved work',
  dialogDescription: 'OpenPencil found documents from a previous session.',
  restoreFailed: 'Could not restore this document.',
  settingsTitle: 'Recovery',
  settingsDescription: 'Control local crash-recovery copies for unsaved documents.',
  preserveUnsavedWork: 'Automatically preserve unsaved work',
  preserveUnsavedWorkDescription:
    'Store local recovery copies so documents can be restored after an unexpected shutdown.',
  restore: 'Restore',
  discard: 'Discard',
  fileSaving: 'Saving locally…',
  fileFailed: 'Local save failed. Retry or use Save as…',
  fileSaved: 'Original file saved',
  localCacheSaved: 'Local cache saved · remote sync is separate',
  downloadRequested: 'Download requested · check your browser',
  fileNotSaved: 'No file save in this session',
  snapshotSaving: 'Creating recovery snapshot…',
  snapshotSaved: 'Recovery snapshot available',
  snapshotSessionOnly: 'Recovery copy is session-only',
  snapshotFailed: 'Recovery snapshot failed. Retry or save a file.',
  snapshotCleanupFailed: 'Could not remove recovery data. Retry cleanup.',
  snapshotDisabled: 'Recovery disabled',
  snapshotNone: 'No recovery snapshot yet',
  snapshotHelp: 'Recovery snapshots do not save the original file or sync to remote storage.',
  snapshotSessionHelp:
    'Persistent storage is unavailable. This copy will be lost when the app closes; save a file now.',
  retrySave: 'Retry save',
  retrySnapshot: 'Retry recovery',
  remoteSyncDetails: 'Remote sync status and retry…'
} as const

export const recoveryMessages = i18n('recovery', recoveryMessageDefaults)
