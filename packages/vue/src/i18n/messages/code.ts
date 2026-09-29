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
