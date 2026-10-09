// Fixed local adaptations from @effect-pick/collection 0.7.0.
// Reference licenses remain unreviewed; original collection JavaScript is excluded.
import type { EffectPickCatalogEntry } from '#core/plugins/effect-pick/types'

export const EFFECT_PICK_BUTTONS_BATCH2: readonly EffectPickCatalogEntry[] = [
  {
    runtimeRevision: 'effect-pick-css-v1',
    id: 'arrow-expand',
    title: '箭头展开按钮',
    description: '箭头旁的圆形背景延展成完整胶囊，文字随之改变颜色。',
    category: '交互',
    tags: ['CSS', '按钮', '微交互'],
    collectionVersion: '0.7.0',
    artifactDigest: '5d34853c7d6f3818cee0b308ae746f2d78ff00eca4d0b50a9e9c51e54524a59d',
    source: {
      url: 'https://codepen.io/kathykato/pen/rZRaNe',
      author: 'kathykato',
      authorName: 'Kathy Kato',
      mode: 'reference',
      license: 'UNLICENSED',
      licenseStatus: 'not-reviewed',
      note: 'Local reimplementation of the referenced visual mechanism; original distribution license is not recorded. Fixed CSS hover/focus capsule expansion; collection replay timers and original JavaScript are excluded.'
    },
    sourceSha256: {
      coreJs: '9b983471c38ac2584ae8bb1f3ddb3d7a02af55b523c2da2d7d69dbc093a1f5b4',
      coreCss: 'e67155179f6ecc479d21d4838093aabe8bab8e37e3777096999cc03ebd0b865e',
      metadata: 'c87beddeb2e2ebfeec27cc7023eeb2a8524342e94b85bea18da565d0aeffee25',
      sharedUtils: '1652ebaca26a641065de146768b735b4d9b52d3ddd7d9152386fd7a0d9d3f0ac'
    },
    defaultConfig: {
      effectId: 'arrow-expand',
      collectionVersion: '0.7.0',
      artifactDigest: '5d34853c7d6f3818cee0b308ae746f2d78ff00eca4d0b50a9e9c51e54524a59d',
      text: '继续创作',
      color: '#f9a8d4',
      secondaryColor: '#101821',
      speed: 1
    },
    defaultSize: {
      width: 320,
      height: 120
    },
    events: ['click'],
    editableFields: ['text', 'color', 'secondaryColor', 'speed'],
    artifact: {
      markup:
        '<button class="fx-button" type="button"><span class="fx-circle" aria-hidden="true"><i class="fx-arrow"></i></span><span class="fx-label">__EP_TEXT__</span></button>',
      css: '.fx-arrow-expand { --fx-accent:#f9a8d4; --fx-secondary:#101821; --fx-speed:1; --fx-duration:400ms; position:relative; isolation:isolate; container-type:size; display:grid; grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(0,1fr); place-items:center; width:100%; height:100%; min-width:0; min-height:0; overflow:hidden; box-sizing:border-box; background:transparent; font-family:system-ui,"PingFang SC",sans-serif; }\n.fx-arrow-expand *, .fx-arrow-expand *::before, .fx-arrow-expand *::after { box-sizing:border-box; }\n.fx-arrow-expand .fx-button { position:relative; display:flex; align-items:center; justify-content:center; width:min(92%,320px); min-width:0; min-height:0; max-height:84%; border:0; border-radius:999px; padding:clamp(8px,7cqh,18px) clamp(12px,6cqw,24px) clamp(8px,7cqh,18px) clamp(38px,20cqw,64px); color:var(--fx-accent); background:transparent; font:600 clamp(12px,5cqw,18px)/1.3 system-ui,sans-serif; cursor:pointer; }\n.fx-arrow-expand .fx-circle { position:absolute; inset:0 auto 0 0; width:clamp(30px,18cqw,54px); border-radius:inherit; background:var(--fx-accent); transition:width calc(var(--fx-duration) / var(--fx-speed)) cubic-bezier(.2,.8,.2,1); }\n.fx-arrow-expand .fx-arrow { position:absolute; left:35%; top:50%; width:18px; height:2px; background:var(--fx-secondary); transform:translateY(-50%); transition:left calc(var(--fx-duration) / var(--fx-speed)); }\n.fx-arrow-expand .fx-arrow::after { content:""; position:absolute; right:0; top:-3px; width:8px; height:8px; border-top:2px solid var(--fx-secondary); border-right:2px solid var(--fx-secondary); transform:rotate(45deg); }\n.fx-arrow-expand .fx-label { position:relative; min-width:0; max-width:100%; max-height:65cqh; overflow:auto; overflow-wrap:anywhere; transition:color calc(var(--fx-duration) / var(--fx-speed)); }\n.fx-arrow-expand .fx-button:is(:hover,:focus-visible) .fx-circle, .fx-arrow-expand[data-preview] .fx-circle { width:100%; }\n.fx-arrow-expand .fx-button:is(:hover,:focus-visible) .fx-arrow, .fx-arrow-expand[data-preview] .fx-arrow { left:clamp(12px,7cqw,24px); }\n.fx-arrow-expand .fx-button:is(:hover,:focus-visible) .fx-label, .fx-arrow-expand[data-preview] .fx-label { color:var(--fx-secondary); }\n.fx-arrow-expand .fx-button:focus-visible { outline:2px solid var(--fx-accent); outline-offset:4px; }\n.fx-arrow-expand[data-paused="true"], .fx-arrow-expand[data-paused="true"] *, .fx-arrow-expand[data-paused="true"] *::before, .fx-arrow-expand[data-paused="true"] *::after { animation-play-state:paused !important; transition:none !important; }\n@media (prefers-reduced-motion:reduce) { .fx-arrow-expand, .fx-arrow-expand *, .fx-arrow-expand *::before, .fx-arrow-expand *::after { animation:none !important; transition:none !important; } }',
      durationMs: 400,
      behavior: 'button'
    }
  },
  {
    runtimeRevision: 'effect-pick-css-v1',
    id: 'border-trace',
    title: '环绕描边按钮',
    description: '四条边线按顺序围绕按钮绘制，悬停和键盘聚焦都可触发。',
    category: '交互',
    tags: ['CSS', '按钮', '微交互'],
    collectionVersion: '0.7.0',
    artifactDigest: 'bee0623a92ea802216751eac964d53ed6f45629929abcbfa62cf7c86a33d1418',
    source: {
      url: 'https://codepen.io/davidicus/pen/emgQKJ',
      author: 'davidicus',
      authorName: 'davidicus',
      mode: 'reference',
      license: 'UNLICENSED',
      licenseStatus: 'not-reviewed',
      note: 'Local reimplementation of the referenced visual mechanism; original distribution license is not recorded. Fixed CSS hover/focus border trace; collection replay timers and original JavaScript are excluded.'
    },
    sourceSha256: {
      coreJs: 'ff1e7cdcba10f480517b68b4409f996cf1c587dbbc4200c15d66ebb29e2c8664',
      coreCss: '885035e90e44c9bd660afafe53772669edf824d5cd3fbf5108a6365992b38247',
      metadata: '4c59e56b31d410beeef005f502ed5ea68912bf91588ad763d74986b6dfeb4bdf',
      sharedUtils: '1652ebaca26a641065de146768b735b4d9b52d3ddd7d9152386fd7a0d9d3f0ac'
    },
    defaultConfig: {
      effectId: 'border-trace',
      collectionVersion: '0.7.0',
      artifactDigest: 'bee0623a92ea802216751eac964d53ed6f45629929abcbfa62cf7c86a33d1418',
      text: '探索细节',
      color: '#a7f3d0',
      secondaryColor: '#475569',
      speed: 1
    },
    defaultSize: {
      width: 320,
      height: 120
    },
    events: ['click'],
    editableFields: ['text', 'color', 'secondaryColor', 'speed'],
    artifact: {
      markup:
        '<button class="fx-button" type="button"><span class="fx-label">__EP_TEXT__</span><i class="fx-edge fx-top" aria-hidden="true"></i><i class="fx-edge fx-right" aria-hidden="true"></i><i class="fx-edge fx-bottom" aria-hidden="true"></i><i class="fx-edge fx-left" aria-hidden="true"></i></button>',
      css: '.fx-border-trace { --fx-accent:#a7f3d0; --fx-secondary:#475569; --fx-speed:1; --fx-duration:650ms; position:relative; isolation:isolate; container-type:size; display:grid; grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(0,1fr); place-items:center; width:100%; height:100%; min-width:0; min-height:0; overflow:hidden; box-sizing:border-box; background:transparent; font-family:system-ui,"PingFang SC",sans-serif; }\n.fx-border-trace *, .fx-border-trace *::before, .fx-border-trace *::after { box-sizing:border-box; }\n.fx-border-trace .fx-button { position:relative; width:min(88%,320px); min-width:0; min-height:0; max-height:84%; padding:clamp(9px,8cqh,20px) clamp(12px,8cqw,30px); border:1px solid var(--fx-secondary); background:transparent; color:var(--fx-accent); font:600 clamp(12px,5cqw,18px)/1.3 system-ui,sans-serif; cursor:pointer; }\n.fx-border-trace .fx-label { display:block; min-width:0; max-height:65cqh; overflow:auto; overflow-wrap:anywhere; }\n.fx-border-trace .fx-edge { position:absolute; background:var(--fx-accent); pointer-events:none; transition:transform calc(var(--fx-duration) / var(--fx-speed)) ease; }\n.fx-border-trace .fx-top, .fx-border-trace .fx-bottom { left:-1px; right:-1px; height:2px; transform:scaleX(0); }\n.fx-border-trace .fx-top { top:-1px; transform-origin:left; }\n.fx-border-trace .fx-bottom { bottom:-1px; transform-origin:right; }\n.fx-border-trace .fx-right, .fx-border-trace .fx-left { top:-1px; bottom:-1px; width:2px; transform:scaleY(0); }\n.fx-border-trace .fx-right { right:-1px; transform-origin:top; }\n.fx-border-trace .fx-left { left:-1px; transform-origin:bottom; }\n.fx-border-trace .fx-button:is(:hover,:focus-visible) .fx-top, .fx-border-trace .fx-button:is(:hover,:focus-visible) .fx-bottom, .fx-border-trace[data-preview] .fx-top, .fx-border-trace[data-preview] .fx-bottom { transform:scaleX(1); }\n.fx-border-trace .fx-button:is(:hover,:focus-visible) .fx-right, .fx-border-trace .fx-button:is(:hover,:focus-visible) .fx-left, .fx-border-trace[data-preview] .fx-right, .fx-border-trace[data-preview] .fx-left { transform:scaleY(1); }\n.fx-border-trace .fx-right { transition-delay:calc(100ms / var(--fx-speed)); }\n.fx-border-trace .fx-bottom { transition-delay:calc(200ms / var(--fx-speed)); }\n.fx-border-trace .fx-left { transition-delay:calc(300ms / var(--fx-speed)); }\n.fx-border-trace .fx-button:focus-visible { outline:2px solid var(--fx-accent); outline-offset:4px; }\n.fx-border-trace[data-paused="true"], .fx-border-trace[data-paused="true"] *, .fx-border-trace[data-paused="true"] *::before, .fx-border-trace[data-paused="true"] *::after { animation-play-state:paused !important; transition:none !important; }\n@media (prefers-reduced-motion:reduce) { .fx-border-trace, .fx-border-trace *, .fx-border-trace *::before, .fx-border-trace *::after { animation:none !important; transition:none !important; } }',
      durationMs: 650,
      behavior: 'button'
    }
  },
  {
    runtimeRevision: 'effect-pick-css-v1',
    id: 'gradient-button',
    title: '流动渐变按钮',
    description: '放大的渐变背景在悬停时滑动，形成柔和连续的色彩变化。',
    category: '交互',
    tags: ['CSS', '按钮', '微交互', '渐变'],
    collectionVersion: '0.7.0',
    artifactDigest: 'eaff0f2ea6e2be8b76c4b895d0f279d65f3520faa3a94a7c8f7ea5eb39a408da',
    source: {
      url: 'https://codepen.io/pirrera/pen/bqVeGx',
      author: 'pirrera',
      authorName: 'pirrera',
      mode: 'reference',
      license: 'UNLICENSED',
      licenseStatus: 'not-reviewed',
      note: 'Local reimplementation of the referenced visual mechanism; original distribution license is not recorded. Fixed CSS hover/focus gradient shift; no collection JavaScript or timer is emitted.'
    },
    sourceSha256: {
      coreJs: '3c0cc89b3c557a507fa743bd6f33fb7de17864025ace9f863de88571e12d58ff',
      coreCss: '0d2f077a1e7f7c32b12130b8c39b097302efe4d985c362e8534f8378f4d7aa71',
      metadata: '0b78c4fd61121c8ed8192c34d546dbda219fcd4aaf71d46be11ecaf4262eee7c',
      sharedUtils: '1652ebaca26a641065de146768b735b4d9b52d3ddd7d9152386fd7a0d9d3f0ac'
    },
    defaultConfig: {
      effectId: 'gradient-button',
      collectionVersion: '0.7.0',
      artifactDigest: 'eaff0f2ea6e2be8b76c4b895d0f279d65f3520faa3a94a7c8f7ea5eb39a408da',
      text: '发现灵感',
      color: '#a7f3d0',
      secondaryColor: '#818cf8',
      speed: 1
    },
    defaultSize: {
      width: 320,
      height: 120
    },
    events: ['click'],
    editableFields: ['text', 'color', 'secondaryColor', 'speed'],
    artifact: {
      markup:
        '<button class="fx-button" type="button"><span class="fx-label">__EP_TEXT__</span></button>',
      css: '.fx-gradient-button { --fx-accent:#a7f3d0; --fx-secondary:#818cf8; --fx-speed:1; --fx-duration:650ms; position:relative; isolation:isolate; container-type:size; display:grid; grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(0,1fr); place-items:center; width:100%; height:100%; min-width:0; min-height:0; overflow:hidden; box-sizing:border-box; background:transparent; font-family:system-ui,"PingFang SC",sans-serif; }\n.fx-gradient-button *, .fx-gradient-button *::before, .fx-gradient-button *::after { box-sizing:border-box; }\n.fx-gradient-button .fx-button { width:min(88%,320px); min-width:0; min-height:0; max-height:84%; border:0; border-radius:12px; padding:clamp(9px,8cqh,20px) clamp(12px,8cqw,30px); color:#101821; background:linear-gradient(110deg,var(--fx-accent),var(--fx-secondary) 45%,var(--fx-accent)); background-size:230% 100%; background-position:0 50%; font:700 clamp(12px,5cqw,18px)/1.3 system-ui,sans-serif; cursor:pointer; transition:background-position calc(var(--fx-duration) / var(--fx-speed)) ease,transform calc(250ms / var(--fx-speed)) ease; }\n.fx-gradient-button .fx-label { display:block; min-width:0; max-height:65cqh; overflow:auto; overflow-wrap:anywhere; }\n.fx-gradient-button .fx-button:is(:hover,:focus-visible), .fx-gradient-button[data-preview] .fx-button { background-position:100% 50%; transform:translateY(-2px); }\n.fx-gradient-button .fx-button:focus-visible { outline:2px solid var(--fx-accent); outline-offset:4px; }\n.fx-gradient-button[data-paused="true"], .fx-gradient-button[data-paused="true"] *, .fx-gradient-button[data-paused="true"] *::before, .fx-gradient-button[data-paused="true"] *::after { animation-play-state:paused !important; transition:none !important; }\n@media (prefers-reduced-motion:reduce) { .fx-gradient-button, .fx-gradient-button *, .fx-gradient-button *::before, .fx-gradient-button *::after { animation:none !important; transition:none !important; } }',
      durationMs: 650,
      behavior: 'button'
    }
  },
  {
    runtimeRevision: 'effect-pick-css-v1',
    id: 'underline-slide',
    title: '滑动下划线',
    description: '下划线从左侧扫入，从右侧收回，可用于按钮和文字式导航操作。',
    category: '交互',
    tags: ['CSS', '按钮', '微交互', '文字'],
    collectionVersion: '0.7.0',
    artifactDigest: '8a6f5b0bf1c838d74318e55f4dab324f7270f0482d3765eced4960c2839e695f',
    source: {
      url: 'https://codepen.io/IanLunn/pen/AxBReL',
      author: 'IanLunn',
      authorName: 'Ian Lunn',
      mode: 'reference',
      license: 'UNLICENSED',
      licenseStatus: 'not-reviewed',
      note: 'Local reimplementation of the referenced visual mechanism; original distribution license is not recorded. Fixed CSS hover/focus text-action variant; original option/lifecycle JavaScript is excluded.'
    },
    sourceSha256: {
      coreJs: '2a39ecfde40abfcca7767c0f6476e7e84b0d66ebec152b9df7117f009612535b',
      coreCss: '944f4ee555ee8affeb0fc30128c9e74df7cb705ed4db789017c22a9bd47ebb90',
      metadata: 'e7575999bcf2f82b131124aa669f4bd61572bbb0d2aa367c5a1aea3a82018dc0',
      sharedUtils: '1652ebaca26a641065de146768b735b4d9b52d3ddd7d9152386fd7a0d9d3f0ac'
    },
    defaultConfig: {
      effectId: 'underline-slide',
      collectionVersion: '0.7.0',
      artifactDigest: '8a6f5b0bf1c838d74318e55f4dab324f7270f0482d3765eced4960c2839e695f',
      text: '查看作品',
      color: '#7dd3fc',
      secondaryColor: '#dbeafe',
      speed: 1
    },
    defaultSize: {
      width: 320,
      height: 120
    },
    events: ['click'],
    editableFields: ['text', 'color', 'secondaryColor', 'speed'],
    artifact: {
      markup:
        '<button class="fx-button" type="button"><span class="fx-label">__EP_TEXT__</span></button>',
      css: '.fx-underline-slide { --fx-accent:#7dd3fc; --fx-secondary:#dbeafe; --fx-speed:1; --fx-duration:350ms; position:relative; isolation:isolate; container-type:size; display:grid; grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(0,1fr); place-items:center; width:100%; height:100%; min-width:0; min-height:0; overflow:hidden; box-sizing:border-box; background:transparent; font-family:system-ui,"PingFang SC",sans-serif; }\n.fx-underline-slide *, .fx-underline-slide *::before, .fx-underline-slide *::after { box-sizing:border-box; }\n.fx-underline-slide .fx-button { position:relative; min-width:0; min-height:0; max-width:88%; max-height:84%; padding:clamp(9px,8cqh,20px) clamp(8px,4cqw,18px); border:0; background:transparent; color:var(--fx-secondary); font:600 clamp(12px,5cqw,18px)/1.3 system-ui,sans-serif; cursor:pointer; }\n.fx-underline-slide .fx-label { display:block; min-width:0; max-height:65cqh; overflow:auto; overflow-wrap:anywhere; }\n.fx-underline-slide .fx-button::after { content:""; position:absolute; inset:auto 0 0; height:3px; background:var(--fx-accent); transform:scaleX(0); transform-origin:right; transition:transform calc(var(--fx-duration) / var(--fx-speed)) cubic-bezier(.22,.7,.2,1); }\n.fx-underline-slide .fx-button:is(:hover,:focus-visible)::after, .fx-underline-slide[data-preview] .fx-button::after { transform:scaleX(1); transform-origin:left; }\n.fx-underline-slide .fx-button:focus-visible { outline:2px solid var(--fx-accent); outline-offset:4px; }\n.fx-underline-slide[data-paused="true"], .fx-underline-slide[data-paused="true"] *, .fx-underline-slide[data-paused="true"] *::before, .fx-underline-slide[data-paused="true"] *::after { animation-play-state:paused !important; transition:none !important; }\n@media (prefers-reduced-motion:reduce) { .fx-underline-slide, .fx-underline-slide *, .fx-underline-slide *::before, .fx-underline-slide *::after { animation:none !important; transition:none !important; } }',
      durationMs: 350,
      behavior: 'button'
    }
  }
]
