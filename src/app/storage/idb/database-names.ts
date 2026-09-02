/** Stable names for the app's independent IndexedDB databases. */
export const APP_DATABASE_NAMES = {
  credentials: 'open-pencil-credentials',
  libraries: 'open-pencil-libraries',
  localCanvas: 'open-pencil-cloud-local',
  outbox: 'open-pencil-cloud-outbox',
  backendReleaseJournal: 'open-pencil-backend-release-journal',
  recovery: 'open-pencil-recovery',
  diagnostics: 'open-pencil-diagnostics'
} as const
