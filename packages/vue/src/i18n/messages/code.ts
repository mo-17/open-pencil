import { i18n } from '#vue/i18n/create'

export const codeMessageDefaults = {
  source: 'Code source',
  sourceDesignJSX: 'Design JSX',
  sourceTailwindJSX: 'Tailwind JSX',
  sourceHTMLCSS: 'HTML/CSS',
  editorDesignLabel: 'Design JSX',
  editorHTMLCSSLabel: 'HTML and CSS',
  updating: 'Updating…',
  updatedLive: 'Updated live',
  previewFailed: 'Preview failed',
  previewSettings: 'Preview settings',
  previewSyncMode: 'Preview sync',
  previewSyncAuto: 'Auto',
  previewSyncSave: 'On save',
  previewSyncManual: 'Manual',
  previewSyncRealtime: 'Real-time',
  previewSyncAutoDescription: 'Automatically sync when editing finishes or input pauses.',
  previewSyncSaveDescription: 'Sync the latest content after this document is saved successfully.',
  previewSyncManualDescription: 'Sync when you refresh the preview manually.',
  previewSyncRealtimeDescription: 'Sync on every change.',
  previewSyncAutoBackend: 'Auto (local backend)',
  previewSyncBackendAutomatic: 'Connected NestJS previews always sync automatically.',
  previewViewportSize: 'Preview size',
  previewViewportFit: 'Fit panel',
  previewViewportPhone: 'Phone · 390 × 844',
  previewViewportLandscape: 'Landscape · 844 × 390',
  previewViewportTablet: 'Tablet · 768 × 1024',
  previewViewportDesktop: 'Desktop · 1440 × 1000',
  previewViewportCustom: 'Custom',
  previewViewportWidth: 'Width',
  previewViewportHeight: 'Height',
  previewViewportWidthSlider: 'Adjust width',
  previewTextScale: 'Web text size',
  previewTextScaleDefault: '1× (default)',
  previewKeyboard: 'Web keyboard overlay',
  previewKeyboardOverlay: 'Simulated keyboard · covers the bottom',
  previewAdaptationDiagnostics: 'Adaptation diagnostics',
  previewSimulationHint:
    'These controls simulate the Web preview. Flutter uses the simulator’s system settings.',
  previewSimulationUnavailable:
    'Text size and diagnostics are unavailable for connected local backend previews.',
  previewAdaptationDiagnosticsTitle: 'Adaptation diagnostics',
  previewAdaptationDiagnosticsWaiting: 'Checking the current preview…',
  previewAdaptationDiagnosticsEmpty: 'No detectable adaptation issues found.',
  previewAdaptationDiagnosticsTruncated: 'The check reached its limit; results may be incomplete.',
  previewAdaptationDiagnosticsDisabled: 'Adaptation diagnostics are off.',
  previewAdaptationHorizontalOverflow:
    'Content exceeds the available width. Consider Fill width or a breakpoint override.',
  previewAdaptationTextClipping:
    'Text may be clipped. Consider Hug height and a suitable minimum height.',
  previewAdaptationFixedHeightRisk:
    'A fixed height may not fit larger or wrapped text. Review Hug height or the minimum height.',
  previewAdaptationLocateNode: 'Locate node',
  flutterPreview: 'Flutter simulator preview',
  flutterPreviewDescription:
    'Preview runs in a separate simulator window and follows the selected sync mode.',
  flutterPreviewDesktopOnly:
    'Flutter preview requires the Tauri desktop app, an installed Flutter SDK and a running iOS or Android simulator.',
  flutterPreviewDevices: 'Simulator',
  flutterPreviewDiscover: 'Find simulators',
  flutterPreviewNoDevices: 'No supported running simulators found.',
  flutterPreviewStart: 'Start',
  flutterPreviewReload: 'Hot reload',
  flutterPreviewStop: 'Stop',
  flutterPreviewIdle: 'Not started',
  flutterPreviewPreparing: 'Starting',
  flutterPreviewRunning: 'Running',
  flutterPreviewReloading: 'Syncing',
  flutterPreviewStopping: 'Stopping',
  flutterPreviewFailed: 'Failed',
  flutterPreviewWarnings: 'Compiler warnings',
  flutterPreviewRevision: 'Synced revision',
  flutterPreviewStatePreserved:
    'Hot reload keeps app state; native changes may require stopping and starting again.',
  generatedReadOnly: 'Generated, read only',
  reset: 'Reset',
  copyJSXReference: 'Copy JSX prop reference to clipboard',
  jsxUpToDate: 'Up to date',
  briefTitle: 'Design handoff',
  briefDescription:
    'Review canvas facts and author notes before handing the design to AI or a developer.',
  briefScope: 'Scope',
  briefPage: 'Current page',
  briefSelection: 'Selected content',
  briefDocument: 'Whole document',
  briefLanguage: 'Output language',
  briefChinese: 'Chinese',
  briefEnglish: 'English',
  briefRefresh: 'Update brief',
  briefStale: 'The brief is out of date',
  briefStaleDetail:
    'The canvas, scope or language changed. Update the brief before copying, downloading or placing it in the AI input.',
  briefTruncated: 'Some content was omitted',
  briefTruncatedDetail:
    'This brief reached its size limit. Choose a smaller scope for a complete handoff.',
  briefNotes: 'Author notes / work to implement',
  briefNotesPlaceholder:
    'Describe intended behavior and work still needed, such as payment or logistics integration.',
  briefNotesHint:
    'Notes stay in this document session, outside the design file. Updating the brief preserves them.',
  briefPreview: 'Review the handoff',
  briefReviewHint:
    'Check configured facts separately from intended work. Configuration alone does not verify runtime behavior or deployment.',
  briefDownload: 'Download Markdown',
  briefToChat: 'Place in AI input',
  briefChatReady: 'Added to the AI input. Review it and send when ready.',
  briefChatLimit:
    'The brief and existing AI draft exceed the input limit. Shorten the draft or choose a smaller scope.',
  briefCopyFailed: 'Copy failed. Select the preview text to copy it manually.',
  briefSaveFailed: 'Download failed. Select the preview text to save it manually.',
  briefBuildFailed:
    'The brief could not be generated. Choose an available page or select valid nodes and try again.',
  briefSaved: 'Markdown exported'
} as const

export const codeMessages = i18n('code', codeMessageDefaults)
