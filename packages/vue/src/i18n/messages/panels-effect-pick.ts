import { params } from '@nanostores/i18n'

export const effectPickPanelMessageDefaults = {
  effectPickModuleName: 'EffectPick effects',
  effectPickModuleDescription:
    'Configure reviewed local CSS and SVG effects. The canvas shows a static placeholder; web previews and exports play the effect.',
  effectPickFieldText: 'Effect text',
  effectPickFieldColor: 'Effect color',
  effectPickFieldSecondaryColor: 'Secondary color',
  effectPickFieldSpeed: 'Playback speed',
  effectPickBrowseLibrary: 'Browse effect library',
  effectPickLibraryWideWindow: 'Enlarge the window to browse the effect library.',
  effectPickSwitchEffect: 'Switch effect',
  effectPickSwitchHint:
    'Settings supported by both effects are kept. Other settings use the selected effect’s defaults.',
  effectPickClickInactive:
    'Click actions are kept, but this effect does not trigger them. Switch back to the button effect to use them.',
  effectPickSwitchError: 'The effect could not be switched. Select the node again and retry.',
  effectPickPreviewTitle: 'Effect playground',
  effectPickPreviewPlay: 'Play effect',
  effectPickPreviewPause: 'Pause effect',
  effectPickPreviewReplay: 'Replay effect',
  effectPickPreviewHint:
    'Use this playground to check appearance and interaction. Configured actions run in the web preview or exported page.',
  effectPickPreviewClicked: params('Button clicks in this playground: {count}.'),
  effectPickPreviewError:
    'The effect playground could not start. Select the effect again to retry.',
  effectPickSource: 'Reference source',
  effectPickLicense:
    'Local collection: UNLICENSED. Reference-source permissions have not been reviewed for public distribution.'
} as const
