// Fixed local adaptations from @effect-pick/collection 0.7.0.
// Reference licenses remain unreviewed; original collection JavaScript is excluded.
import type { EffectPickCatalogEntry } from '#core/plugins/effect-pick/types'

export const EFFECT_PICK_LOADERS_BATCH2: readonly EffectPickCatalogEntry[] = [
  {
    runtimeRevision: 'effect-pick-css-v1',
    id: 'gooey-dots',
    title: '粘液圆点聚合',
    description: '两个圆点在中央圆点之间穿行，靠近时出现粘液般的桥接。',
    category: '加载',
    tags: ['SVG', 'CSS', '加载'],
    collectionVersion: '0.7.0',
    artifactDigest: '3838c98411d63ff7c714bca169490464654c6c3baddbf842fc7ade292f5b1a12',
    source: {
      url: 'https://codepen.io/aaroniker/pen/YoqNRB',
      author: 'aaroniker',
      authorName: 'aaroniker',
      mode: 'reference',
      license: 'UNLICENSED',
      licenseStatus: 'not-reviewed',
      note: 'Chrome 中发现的视觉参考。当前组件为相关运动或交互思路的独立扩展实现，不声称逐像素还原原作；具体实现与提取边界见下方说明。 Fixed SVG circles and CSS transforms use a reviewed per-instance filter ID; source random IDs, Math.random fallback and all original JavaScript are excluded.'
    },
    sourceSha256: {
      coreJs: '80eafa89f7b21a34022c0f7a513ed7c890dba5e3292c21985e5c02db1ba0f107',
      coreCss: 'aae9667c9b1e947ec8988456b28e3e5f291ee0efc690e98d21d354ac54e6c451',
      metadata: '8f89747c1a8610bc22bc0bd5b3bea95902a0273eb924ca979ab614a1ad941f94',
      sharedUtils: '1652ebaca26a641065de146768b735b4d9b52d3ddd7d9152386fd7a0d9d3f0ac'
    },
    defaultConfig: {
      effectId: 'gooey-dots',
      collectionVersion: '0.7.0',
      artifactDigest: '3838c98411d63ff7c714bca169490464654c6c3baddbf842fc7ade292f5b1a12',
      text: '',
      color: '#a7f3d0',
      secondaryColor: '#102032',
      speed: 1
    },
    defaultSize: {
      width: 280,
      height: 240
    },
    events: [],
    editableFields: ['color', 'secondaryColor', 'speed'],
    artifact: {
      markup:
        '<svg viewBox="0 0 300 180" role="img" aria-label="粘液圆点聚合示意"><defs><filter id="ep-gooey-__EP_INSTANCE__" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur"/><feColorMatrix in="blur" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 17 -7"/></filter></defs><g filter="url(#ep-gooey-__EP_INSTANCE__)"><circle cx="150" cy="90" r="23"/><circle class="gooey-moving" cx="150" cy="90" r="17"/><circle class="gooey-moving gooey-delayed" cx="150" cy="90" r="17"/></g></svg>',
      css: '.fx-gooey-dots { --fx-accent:#a7f3d0; --fx-secondary:#102032; --fx-speed:1; --fx-duration:2400ms; position:relative; isolation:isolate; container-type:size; display:grid; grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(0,1fr); place-items:center; width:100%; height:100%; min-width:0; min-height:0; overflow:hidden; box-sizing:border-box; background:transparent; font-family:system-ui,"PingFang SC",sans-serif; }\n.fx-gooey-dots *, .fx-gooey-dots *::before, .fx-gooey-dots *::after { box-sizing:border-box; }\n.fx-gooey-dots { background:var(--fx-secondary); border-radius:var(--fx-radius,14px); }\n.fx-gooey-dots > svg { display:block; width:100%; height:100%; }\n.fx-gooey-dots circle { fill:var(--fx-accent); }\n.fx-gooey-dots .gooey-moving { animation:fx-gooey-dots-cross var(--fx-duration) ease-in-out infinite; }\n.fx-gooey-dots .gooey-delayed { animation-delay:-1200ms; }\n@keyframes fx-gooey-dots-cross { 0%,100% { transform:translateX(-65px); } 50% { transform:translateX(65px); } }\n.fx-gooey-dots[data-paused="true"], .fx-gooey-dots[data-paused="true"] *, .fx-gooey-dots[data-paused="true"] *::before, .fx-gooey-dots[data-paused="true"] *::after { animation-play-state:paused !important; transition:none !important; }\n@media (prefers-reduced-motion:reduce) { .fx-gooey-dots, .fx-gooey-dots *, .fx-gooey-dots *::before, .fx-gooey-dots *::after { animation:none !important; transition:none !important; } }',
      durationMs: 2400,
      behavior: 'loader'
    }
  },
  {
    runtimeRevision: 'effect-pick-css-v1',
    id: 'infinity-runner',
    title: '无限轨迹追踪',
    description: '一个光点沿八字曲线匀速绕行。',
    category: '加载',
    tags: ['SVG', '加载', '路径'],
    collectionVersion: '0.7.0',
    artifactDigest: 'beca8c35334e13221b647c95b151f1df2aaccf32bf044f1d70092644d721b14e',
    source: {
      url: 'https://codepen.io/aaroniker/pen/mZgRMr',
      author: 'aaroniker',
      authorName: 'aaroniker',
      mode: 'reference',
      license: 'UNLICENSED',
      licenseStatus: 'not-reviewed',
      note: 'Chrome 中发现的视觉参考。当前组件为相关运动或交互思路的独立扩展实现，不声称逐像素还原原作；具体实现与提取边界见下方说明。 A CSS-animated SVG dash replaces source offset-path motion while preserving the eight-figure runner mechanism. No SMIL, source JavaScript or external path asset is emitted.'
    },
    sourceSha256: {
      coreJs: 'e7c2958a8c5beb97068e7235a4d8c00d504527df8110d1dd6b0ae0bac2096deb',
      coreCss: '1018e88c4b5bd421840153b9b6b5ca27fe51572037a6a6af138ae16054799d8d',
      metadata: '242c9885a26fb198554b303067598879ea6868157d51c96096c9eb2b3485c06b',
      sharedUtils: '1652ebaca26a641065de146768b735b4d9b52d3ddd7d9152386fd7a0d9d3f0ac'
    },
    defaultConfig: {
      effectId: 'infinity-runner',
      collectionVersion: '0.7.0',
      artifactDigest: 'beca8c35334e13221b647c95b151f1df2aaccf32bf044f1d70092644d721b14e',
      text: '',
      color: '#a7f3d0',
      secondaryColor: '#102032',
      speed: 1
    },
    defaultSize: {
      width: 280,
      height: 240
    },
    events: [],
    editableFields: ['color', 'secondaryColor', 'speed'],
    artifact: {
      markup:
        '<svg viewBox="0 0 400 280" role="img" aria-label="八字轨迹光点示意"><path class="infinity-track" d="M90 140C90 70 155 70 200 140C245 210 310 210 310 140C310 70 245 70 200 140C155 210 90 210 90 140Z"/><path class="infinity-runner" pathLength="1000" d="M90 140C90 70 155 70 200 140C245 210 310 210 310 140C310 70 245 70 200 140C155 210 90 210 90 140Z"/></svg>',
      css: '.fx-infinity-runner { --fx-accent:#a7f3d0; --fx-secondary:#102032; --fx-speed:1; --fx-duration:3800ms; position:relative; isolation:isolate; container-type:size; display:grid; grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(0,1fr); place-items:center; width:100%; height:100%; min-width:0; min-height:0; overflow:hidden; box-sizing:border-box; background:transparent; font-family:system-ui,"PingFang SC",sans-serif; }\n.fx-infinity-runner *, .fx-infinity-runner *::before, .fx-infinity-runner *::after { box-sizing:border-box; }\n.fx-infinity-runner { background:var(--fx-secondary); border-radius:var(--fx-radius,14px); }\n.fx-infinity-runner > svg { display:block; width:100%; height:100%; }\n.fx-infinity-runner .infinity-track { fill:none; stroke:var(--fx-accent); stroke-width:2; opacity:.25; }\n.fx-infinity-runner .infinity-runner { fill:none; stroke:var(--fx-accent); stroke-width:14; stroke-linecap:round; stroke-dasharray:.01 999.99; animation:fx-infinity-runner-travel var(--fx-duration) linear infinite; }\n@keyframes fx-infinity-runner-travel { to { stroke-dashoffset:-1000; } }\n.fx-infinity-runner[data-paused="true"], .fx-infinity-runner[data-paused="true"] *, .fx-infinity-runner[data-paused="true"] *::before, .fx-infinity-runner[data-paused="true"] *::after { animation-play-state:paused !important; transition:none !important; }\n@media (prefers-reduced-motion:reduce) { .fx-infinity-runner, .fx-infinity-runner *, .fx-infinity-runner *::before, .fx-infinity-runner *::after { animation:none !important; transition:none !important; } }',
      durationMs: 3800,
      behavior: 'loader'
    }
  },
  {
    runtimeRevision: 'effect-pick-css-v1',
    id: 'newtons-cradle',
    title: '牛顿摆球',
    description: '外侧摆球交替摆动，把节奏传递到另一侧。',
    category: '加载',
    tags: ['CSS', '加载', '物理'],
    collectionVersion: '0.7.0',
    artifactDigest: 'ab2727f0d33780be3df5eb9a4c9e290030f494f22b9f234fc0115afad7b87bd7',
    source: {
      url: 'https://codepen.io/aaroniker/pen/omvYNZ',
      author: 'aaroniker',
      authorName: 'aaroniker',
      mode: 'reference',
      license: 'UNLICENSED',
      licenseStatus: 'not-reviewed',
      note: 'Chrome 中发现的视觉参考。当前组件为相关运动或交互思路的独立扩展实现，不声称逐像素还原原作；具体实现与提取边界见下方说明。 Fixed CSS pendulums adapt the authored cradle to width/height container units; this is a decorative rhythm, not a rigid-body solver or task-progress indicator.'
    },
    sourceSha256: {
      coreJs: '20c94931e4a5a426e1ed6899cf22d8b08198a464b7597e016f78a8aaa5980589',
      coreCss: 'cac81e259760c73264ef89dbc36c7c82f3d732d5945f71a359aa4d8974456146',
      metadata: '87dc05bcc187ccca07cfaf39e9f176a9ffa494d745c492074c552d7e95bba457',
      sharedUtils: '1652ebaca26a641065de146768b735b4d9b52d3ddd7d9152386fd7a0d9d3f0ac'
    },
    defaultConfig: {
      effectId: 'newtons-cradle',
      collectionVersion: '0.7.0',
      artifactDigest: 'ab2727f0d33780be3df5eb9a4c9e290030f494f22b9f234fc0115afad7b87bd7',
      text: '',
      color: '#a7f3d0',
      secondaryColor: '#102032',
      speed: 1
    },
    defaultSize: {
      width: 280,
      height: 240
    },
    events: [],
    editableFields: ['color', 'secondaryColor', 'speed'],
    artifact: {
      markup:
        '<div class="cradle" role="img" aria-label="牛顿摆球节奏示意"><span class="cradle-beam" aria-hidden="true"></span><span class="cradle-pendulum" aria-hidden="true"><i></i></span><span class="cradle-pendulum" aria-hidden="true"><i></i></span><span class="cradle-pendulum" aria-hidden="true"><i></i></span><span class="cradle-pendulum" aria-hidden="true"><i></i></span><span class="cradle-pendulum" aria-hidden="true"><i></i></span></div>',
      css: '.fx-newtons-cradle { --fx-accent:#a7f3d0; --fx-secondary:#102032; --fx-speed:1; --fx-duration:2400ms; position:relative; isolation:isolate; container-type:size; display:grid; grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(0,1fr); place-items:center; width:100%; height:100%; min-width:0; min-height:0; overflow:hidden; box-sizing:border-box; background:transparent; font-family:system-ui,"PingFang SC",sans-serif; }\n.fx-newtons-cradle *, .fx-newtons-cradle *::before, .fx-newtons-cradle *::after { box-sizing:border-box; }\n.fx-newtons-cradle { background:var(--fx-secondary); border-radius:var(--fx-radius,14px); }\n.fx-newtons-cradle .cradle { position:relative; width:min(84cqw,106cqh,240px); height:min(67cqw,85cqh,192px); }\n.fx-newtons-cradle .cradle-beam { position:absolute; left:8%; right:8%; top:14%; height:3px; border-radius:2px; background:var(--fx-accent); opacity:.6; }\n.fx-newtons-cradle .cradle-pendulum { position:absolute; top:15%; width:2px; height:60%; background:#94a3b8; transform-origin:50% 0; }\n.fx-newtons-cradle .cradle-pendulum i { position:absolute; left:50%; bottom:0; width:min(10cqw,12.5cqh,28px); height:min(10cqw,12.5cqh,28px); transform:translate(-50%,50%); border-radius:50%; background:radial-gradient(circle at 35% 30%,#f0faff,var(--fx-accent) 45%,#254a4c); box-shadow:0 4px 6px #0003; }\n.fx-newtons-cradle .cradle-pendulum:nth-child(2) { left:26%; animation:fx-newtons-cradle-left var(--fx-duration) ease-in-out infinite; }\n.fx-newtons-cradle .cradle-pendulum:nth-child(3) { left:38%; }\n.fx-newtons-cradle .cradle-pendulum:nth-child(4) { left:50%; }\n.fx-newtons-cradle .cradle-pendulum:nth-child(5) { left:62%; }\n.fx-newtons-cradle .cradle-pendulum:nth-child(6) { left:74%; animation:fx-newtons-cradle-right var(--fx-duration) ease-in-out infinite; }\n@keyframes fx-newtons-cradle-left { 0%,50%,100% { transform:rotate(0); } 25% { transform:rotate(36deg); } }\n@keyframes fx-newtons-cradle-right { 0%,50%,100% { transform:rotate(0); } 75% { transform:rotate(-36deg); } }\n.fx-newtons-cradle[data-paused="true"], .fx-newtons-cradle[data-paused="true"] *, .fx-newtons-cradle[data-paused="true"] *::before, .fx-newtons-cradle[data-paused="true"] *::after { animation-play-state:paused !important; transition:none !important; }\n@media (prefers-reduced-motion:reduce) { .fx-newtons-cradle, .fx-newtons-cradle *, .fx-newtons-cradle *::before, .fx-newtons-cradle *::after { animation:none !important; transition:none !important; } }',
      durationMs: 2400,
      behavior: 'loader'
    }
  },
  {
    runtimeRevision: 'effect-pick-css-v1',
    id: 'equalizer-bars',
    title: '节拍均衡器',
    description: '高度各异的频段条持续随节奏跳动。',
    category: '加载',
    tags: ['CSS', '加载', '循环'],
    collectionVersion: '0.7.0',
    artifactDigest: '011851410ee46a256e64aff8953f4206f11306e0d0b9b5b3a9c6d9a3efbda019',
    source: {
      url: 'https://codepen.io/sdras/pen/OReWOw',
      author: 'sdras',
      authorName: 'sdras',
      mode: 'reference',
      license: 'UNLICENSED',
      licenseStatus: 'not-reviewed',
      note: 'Chrome 中发现的视觉参考。当前组件为相关运动或交互思路的独立扩展实现，不声称逐像素还原原作；具体实现与提取边界见下方说明。 Twenty-two deterministic authored bars replace source count/seed DOM generation. This is silent decoration; it does not read audio, microphone input or real spectra.'
    },
    sourceSha256: {
      coreJs: 'ca738abd9df20ec20ec0722ce4609dd1978d3342aec96caa7e0e976dae16da91',
      coreCss: '36e3cccf7a7a3b528313eea51fd5b745e5bf5325e39b4565a9850ca04f30d98e',
      metadata: '37f0b5f34303aaf1fcd3fcc531f504c839ae8f01c68caecb352535bb02383322',
      sharedUtils: '1652ebaca26a641065de146768b735b4d9b52d3ddd7d9152386fd7a0d9d3f0ac'
    },
    defaultConfig: {
      effectId: 'equalizer-bars',
      collectionVersion: '0.7.0',
      artifactDigest: '011851410ee46a256e64aff8953f4206f11306e0d0b9b5b3a9c6d9a3efbda019',
      text: '',
      color: '#a7f3d0',
      secondaryColor: '#818cf8',
      speed: 1
    },
    defaultSize: {
      width: 280,
      height: 240
    },
    events: [],
    editableFields: ['color', 'secondaryColor', 'speed'],
    artifact: {
      markup:
        '<div class="equalizer" role="img" aria-label="装饰节拍条示意"><span style="--beat-factor:0.63;--beat-delay:0ms"></span><span style="--beat-factor:0.91;--beat-delay:-193ms"></span><span style="--beat-factor:1.12;--beat-delay:-386ms"></span><span style="--beat-factor:0.74;--beat-delay:-579ms"></span><span style="--beat-factor:1.21;--beat-delay:-772ms"></span><span style="--beat-factor:0.82;--beat-delay:-965ms"></span><span style="--beat-factor:1.08;--beat-delay:-1158ms"></span><span style="--beat-factor:0.69;--beat-delay:-1351ms"></span><span style="--beat-factor:0.98;--beat-delay:-1544ms"></span><span style="--beat-factor:1.24;--beat-delay:-137ms"></span><span style="--beat-factor:0.77;--beat-delay:-330ms"></span><span style="--beat-factor:0.63;--beat-delay:-523ms"></span><span style="--beat-factor:0.91;--beat-delay:-716ms"></span><span style="--beat-factor:1.12;--beat-delay:-909ms"></span><span style="--beat-factor:0.74;--beat-delay:-1102ms"></span><span style="--beat-factor:1.21;--beat-delay:-1295ms"></span><span style="--beat-factor:0.82;--beat-delay:-1488ms"></span><span style="--beat-factor:1.08;--beat-delay:-81ms"></span><span style="--beat-factor:0.69;--beat-delay:-274ms"></span><span style="--beat-factor:0.98;--beat-delay:-467ms"></span><span style="--beat-factor:1.24;--beat-delay:-660ms"></span><span style="--beat-factor:0.77;--beat-delay:-853ms"></span></div>',
      css: '.fx-equalizer-bars { --fx-accent:#a7f3d0; --fx-secondary:#818cf8; --fx-speed:1; --fx-duration:1200ms; position:relative; isolation:isolate; container-type:size; display:grid; grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(0,1fr); place-items:center; width:100%; height:100%; min-width:0; min-height:0; overflow:hidden; box-sizing:border-box; background:transparent; font-family:system-ui,"PingFang SC",sans-serif; }\n.fx-equalizer-bars *, .fx-equalizer-bars *::before, .fx-equalizer-bars *::after { box-sizing:border-box; }\n.fx-equalizer-bars .equalizer { display:flex; align-items:center; justify-content:center; gap:clamp(2px,1cqw,6px); width:82%; height:65%; min-width:0; min-height:0; }\n.fx-equalizer-bars .equalizer span { flex:1 1 0; min-width:0; max-width:10px; height:100%; border-radius:5px; background:linear-gradient(var(--fx-accent),var(--fx-secondary)); transform:scaleY(.25); animation:fx-equalizer-bars-beat calc(var(--fx-duration) * var(--beat-factor)) ease-in-out var(--beat-delay) infinite alternate; }\n@keyframes fx-equalizer-bars-beat { 0% { transform:scaleY(.18); } 25% { transform:scaleY(.7); } 55% { transform:scaleY(.38); } 85%,100% { transform:scaleY(1); } }\n.fx-equalizer-bars[data-paused="true"], .fx-equalizer-bars[data-paused="true"] *, .fx-equalizer-bars[data-paused="true"] *::before, .fx-equalizer-bars[data-paused="true"] *::after { animation-play-state:paused !important; transition:none !important; }\n@media (prefers-reduced-motion:reduce) { .fx-equalizer-bars, .fx-equalizer-bars *, .fx-equalizer-bars *::before, .fx-equalizer-bars *::after { animation:none !important; transition:none !important; } }',
      durationMs: 1200,
      behavior: 'loader'
    }
  }
]
