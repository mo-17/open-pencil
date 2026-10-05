import { params } from '@nanostores/i18n'

import { i18n } from '#vue/i18n/create'

export const pageMessageDefaults = {
  newPage: 'New page',
  rename: 'Rename',
  delete: 'Delete',
  pageName: params('Page {number}'),
  applicationModeTitle: 'Application mode',
  applicationModeHint:
    'Off by default. Enable to configure application pages; design pages remain editable.',
  applicationModeInvalidTitle: 'Review application setup',
  applicationModeInvalid:
    'Some saved settings or selected targets are unavailable. Explicitly edit the affected setting to replace it.',
  applicationModeRole: 'Current page role',
  applicationModeUnassigned: 'Unassigned',
  applicationModeApplication: 'Application page',
  applicationModeReference: 'Design reference',
  applicationModeComponents: 'Shared components',
  applicationModeEntry: 'Entry frame',
  applicationModeChooseEntry: 'Choose an entry frame',
  applicationModeUnavailable: 'Unavailable selection',
  applicationModeRoute: 'Route path',
  applicationModeRouteInvalid:
    'Use an internal path starting with /, or leave it empty for the derived route.',
  applicationModeStart: 'Application start page',
  applicationModeChooseStart: 'Choose a start page',
  applicationModeStartStaticOnly: 'Concrete path required',
  applicationModeStartInvalid:
    'The start page needs a concrete internal path without parameters, wildcards, query or fragment. Choose another start page or change its route.',
  applicationStateRetention: 'Page state on return',
  applicationStateRetentionUnset: 'Not set (original behavior)',
  applicationStateRetentionReset: 'Reset on each visit',
  applicationStateRetentionPreserve: 'Preserve during this session',
  applicationStateRetentionHint:
    'React/Vue keep bound page state and scroll position for each concrete path and query during this runtime session. Reloading starts a new session.',
  applicationModeConfigureHint:
    'Classify a page, select its entry frame, then choose the application’s start page.',
  applicationEnterGuardTitle: 'Enter condition (optional)',
  applicationEnterGuardHint:
    'Allow entry only when the expression is true. Use document state and destination route values, with a concrete internal fallback. This does not replace server permissions.',
  applicationEnterGuardExpression: 'Allow entry when',
  applicationEnterGuardFallback: 'Denied entry route',
  applicationLeaveConfirmTitle: 'Confirm leaving (optional)',
  applicationLeaveConfirmHint:
    'Prompt when the dirty expression is true. It can read current page or document state. Confirming only leaves; your business workflow controls saving.',
  applicationLeaveConfirmExpression: 'Unsaved changes when',
  applicationLeaveConfirmMessage: 'Confirmation message',
  applicationGuardApply: 'Apply rule',
  applicationGuardRemove: 'Remove rule',
  applicationGuardDraftHint: 'Edits are drafts. Apply saves both fields together.',
  applicationGuardExpressionInvalid: 'Use a valid expression, up to 2048 characters.',
  applicationGuardFallbackInvalid:
    'Use a concrete internal route to another active application page, without a fallback cycle.',
  applicationGuardMessageInvalid: 'Enter a message, up to 1024 characters.',
  applicationShellTitle: 'Shared shell (optional)',
  applicationShellHint:
    'Choose a frame from a design-reference or shared-components page and an empty auto-layout content frame. Application entries use this slot during preview and export; design nodes stay unchanged.',
  applicationShellStateHint:
    'Shared interactions use Document State. The source page must have no page state, events or workflows.',
  applicationShellFrame: 'Shared shell frame',
  applicationShellChooseFrame: 'Choose a shared frame',
  applicationShellSlot: 'Content slot',
  applicationShellChooseSlot: 'Choose an empty auto-layout frame',
  applicationShellApply: 'Apply shell',
  applicationShellRemove: 'Remove shell',
  applicationShellInvalid:
    'The saved shell or content slot is unavailable. Choose valid targets and apply, or remove the shell.',
  applicationShellDraftHint: 'These selections are drafts. Apply to save them together.',
  pages: 'Pages',
  goToPage: 'Go to page…',
  recentPage: 'Recent',
  currentPage: 'Current page'
} as const

export const pageMessages = i18n('pages', pageMessageDefaults)
