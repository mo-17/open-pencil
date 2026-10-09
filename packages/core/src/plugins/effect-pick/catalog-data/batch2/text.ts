// Fixed local adaptations from @effect-pick/collection 0.7.0.
// Reference licenses remain unreviewed; original collection JavaScript is excluded.
import type { EffectPickCatalogEntry } from '#core/plugins/effect-pick/types'

export const EFFECT_PICK_TEXT_BATCH2: readonly EffectPickCatalogEntry[] = [
  {
    runtimeRevision: 'effect-pick-css-v1',
    id: 'text-mask-reveal',
    title: '文字遮罩入场',
    description: '文字从行内遮罩中依次露出。',
    category: '文字',
    tags: ['CSS', '文字', '入场'],
    collectionVersion: '0.7.0',
    artifactDigest: 'b911675bbc9bb1573d582413a4d37d54ce3fbee36c72c406cdc30716b35ab74e',
    source: {
      url: 'https://codepen.io/Sonick/pen/AwXJdM',
      author: 'Sonick',
      authorName: 'Nick Mkrtchyan',
      mode: 'reference',
      license: 'UNLICENSED',
      licenseStatus: 'not-reviewed',
      note: 'Local reimplementation of the referenced visual mechanism; original distribution license is not recorded. A single configurable text block replaces source lines/stagger arrays; motion is fixed CSS entry animation, with no source JavaScript.'
    },
    sourceSha256: {
      coreJs: '5c018a6e1cdbc4db70a2ff918bc9c9110da5c6ca7f5b11da36f1f2e2fe723d12',
      coreCss: '00183922ef4b796ce2d9afef601f22c139a489e22f26ab9d58809529ecf07f67',
      metadata: '181ce02bb81ba33a92e7ed00ecaede75cdc6f84bcf9ac84bb97a81c7c03e0e78',
      sharedUtils: '1652ebaca26a641065de146768b735b4d9b52d3ddd7d9152386fd7a0d9d3f0ac'
    },
    defaultConfig: {
      effectId: 'text-mask-reveal',
      collectionVersion: '0.7.0',
      artifactDigest: 'b911675bbc9bb1573d582413a4d37d54ce3fbee36c72c406cdc30716b35ab74e',
      text: '让想法登场',
      color: '#a7f3d0',
      secondaryColor: '#818cf8',
      speed: 1
    },
    defaultSize: {
      width: 400,
      height: 240
    },
    events: [],
    editableFields: ['text', 'color', 'secondaryColor', 'speed'],
    artifact: {
      markup:
        '<div class="reveal-stack"><div class="reveal-mask"><span>__EP_TEXT__</span></div><span class="reveal-rule" aria-hidden="true"></span></div>',
      css: '.fx-text-mask-reveal { --fx-accent:#a7f3d0; --fx-secondary:#818cf8; --fx-speed:1; --fx-duration:1000ms; position:relative; isolation:isolate; container-type:size; display:grid; grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(0,1fr); place-items:center; width:100%; height:100%; min-width:0; min-height:0; overflow:hidden; box-sizing:border-box; background:transparent; font-family:system-ui,"PingFang SC",sans-serif; }\n.fx-text-mask-reveal *, .fx-text-mask-reveal *::before, .fx-text-mask-reveal *::after { box-sizing:border-box; }\n.fx-text-mask-reveal .reveal-stack { width:88%; max-height:88%; min-width:0; }\n.fx-text-mask-reveal .reveal-mask { overflow:hidden; }\n.fx-text-mask-reveal .reveal-mask > span { display:block; max-height:68cqh; overflow:auto; overflow-wrap:anywhere; color:var(--fx-accent); font-size:clamp(16px,11cqw,64px); font-weight:850; line-height:1.15; letter-spacing:-.04em; animation:fx-text-mask-reveal-enter var(--fx-duration) cubic-bezier(.22,1,.36,1) both; }\n.fx-text-mask-reveal .reveal-rule { display:block; width:20%; height:3px; margin-top:min(7cqh,18px); background:var(--fx-secondary); transform-origin:left; animation:fx-text-mask-reveal-rule var(--fx-duration) ease-out 350ms both; }\n@keyframes fx-text-mask-reveal-enter { from { transform:translateY(115%) rotate(3deg); opacity:0; } to { transform:translateY(0) rotate(0); opacity:1; } }\n@keyframes fx-text-mask-reveal-rule { from { transform:scaleX(0); } to { transform:scaleX(1); } }\n.fx-text-mask-reveal[data-paused="true"], .fx-text-mask-reveal[data-paused="true"] *, .fx-text-mask-reveal[data-paused="true"] *::before, .fx-text-mask-reveal[data-paused="true"] *::after { animation-play-state:paused !important; transition:none !important; }\n@media (prefers-reduced-motion:reduce) { .fx-text-mask-reveal, .fx-text-mask-reveal *, .fx-text-mask-reveal *::before, .fx-text-mask-reveal *::after { animation:none !important; transition:none !important; } }',
      durationMs: 1000,
      behavior: 'text'
    }
  },
  {
    runtimeRevision: 'effect-pick-css-v1',
    id: 'outline-fill',
    title: '空心文字填色',
    description: '空心字的实心层在悬停或键盘聚焦时从底部升起，填满文字。',
    category: '文字',
    tags: ['文字', 'CSS', '微交互'],
    collectionVersion: '0.7.0',
    artifactDigest: 'bc05e3a7c7f481a0556091e21afe47846512fbe72304d1de81599d413dc13306',
    source: {
      url: 'https://codepen.io/Jintos/pen/OJKodm',
      author: 'Jintos',
      authorName: 'Jintos',
      mode: 'reference',
      license: 'UNLICENSED',
      licenseStatus: 'not-reviewed',
      note: 'Chrome 中发现的视觉参考。当前组件为相关运动或交互思路的独立扩展实现，不声称逐像素还原原作；具体实现与提取边界见下方说明。 Fixed CSS hover/focus fill on a focusable static text surface; original click toggle and aria-pressed state are excluded. This entry declares no click event.'
    },
    sourceSha256: {
      coreJs: '3276034db5e5dbe6d705a6e118dadaa341bb620c9d3d3695e6020621dcd3f2ef',
      coreCss: '4f09ada69692661c8a8b7c0e078b8b5ed5147529b82c54f54f771b9e20827430',
      metadata: '0fdb6d0afbd08df197e81aad03e4ba6c097714d2776a13c019700b85422636c1',
      sharedUtils: '1652ebaca26a641065de146768b735b4d9b52d3ddd7d9152386fd7a0d9d3f0ac'
    },
    defaultConfig: {
      effectId: 'outline-fill',
      collectionVersion: '0.7.0',
      artifactDigest: 'bc05e3a7c7f481a0556091e21afe47846512fbe72304d1de81599d413dc13306',
      text: '填满灵感',
      color: '#67e8f9',
      secondaryColor: '#c084fc',
      speed: 1
    },
    defaultSize: {
      width: 400,
      height: 240
    },
    events: [],
    editableFields: ['text', 'color', 'secondaryColor', 'speed'],
    artifact: {
      markup:
        '<div class="outline-word" tabindex="0" role="img" aria-label="__EP_TEXT__"><span class="outline-base" aria-hidden="true">__EP_TEXT__</span><span class="outline-solid" aria-hidden="true">__EP_TEXT__</span></div>',
      css: '.fx-outline-fill { --fx-accent:#67e8f9; --fx-secondary:#c084fc; --fx-speed:1; --fx-duration:650ms; position:relative; isolation:isolate; container-type:size; display:grid; grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(0,1fr); place-items:center; width:100%; height:100%; min-width:0; min-height:0; overflow:hidden; box-sizing:border-box; background:transparent; font-family:system-ui,"PingFang SC",sans-serif; }\n.fx-outline-fill *, .fx-outline-fill *::before, .fx-outline-fill *::after { box-sizing:border-box; }\n.fx-outline-fill .outline-word { display:grid; width:88%; min-width:0; max-height:84%; overflow:auto; color:var(--fx-secondary); font-size:clamp(18px,11cqw,70px); font-weight:800; line-height:1.25; overflow-wrap:anywhere; text-align:center; }\n.fx-outline-fill .outline-word span { grid-area:1/1; min-width:0; }\n.fx-outline-fill .outline-base { color:transparent; -webkit-text-stroke:1px var(--fx-accent); }\n.fx-outline-fill .outline-solid { clip-path:inset(100% 0 0); transition:clip-path calc(var(--fx-duration) / var(--fx-speed)) cubic-bezier(.2,.8,.2,1); }\n.fx-outline-fill .outline-word:is(:hover,:focus-visible) .outline-solid, .fx-outline-fill[data-preview] .outline-solid { clip-path:inset(0); }\n.fx-outline-fill .outline-word:focus-visible { outline:2px solid var(--fx-accent); outline-offset:4px; }\n@supports not (-webkit-text-stroke:1px black) { .fx-outline-fill .outline-base { color:var(--fx-accent); opacity:.5; } }\n.fx-outline-fill[data-paused="true"], .fx-outline-fill[data-paused="true"] *, .fx-outline-fill[data-paused="true"] *::before, .fx-outline-fill[data-paused="true"] *::after { animation-play-state:paused !important; transition:none !important; }\n@media (prefers-reduced-motion:reduce) { .fx-outline-fill, .fx-outline-fill *, .fx-outline-fill *::before, .fx-outline-fill *::after { animation:none !important; transition:none !important; } }',
      durationMs: 650,
      behavior: 'text'
    }
  },
  {
    runtimeRevision: 'effect-pick-css-v1',
    id: 'gradient-stroke-text',
    title: '流光渐变描边文字',
    description: '空心文字的轮廓由连续变化的渐变色描绘。',
    category: '文字',
    tags: ['文字', 'SVG', 'CSS'],
    collectionVersion: '0.7.0',
    artifactDigest: '1f4cc65d7fe7ebaa1afaa318aa96a5145650b22120cf6c8d99d984495fd7be46',
    source: {
      url: 'https://codepen.io/Jintos/pen/OJKodm',
      author: 'Jintos',
      authorName: 'Jintos',
      mode: 'reference',
      license: 'UNLICENSED',
      licenseStatus: 'not-reviewed',
      note: 'Chrome 中发现的视觉参考。当前组件为相关运动或交互思路的独立扩展实现，不声称逐像素还原原作；具体实现与提取边界见下方说明。 Fixed SVG markup uses the reviewed instance-ID/font-size slots; both colors drive CSS gradient-stop interpolation. Source random-ID and text-writing JavaScript are excluded.'
    },
    sourceSha256: {
      coreJs: 'b7a2db8ea06e3cac06dd7d546dd4b454f292080b96c6d43a15868310cb6f945f',
      coreCss: '3af14c865f6ea19bae14981c6470b7b2796f25db8811ddc7968d690ce0166fba',
      metadata: '5ede582beab806ee7dfab76effd998774fe58c14eb01f5dc0ea7ff9497bb7ff1',
      sharedUtils: '1652ebaca26a641065de146768b735b4d9b52d3ddd7d9152386fd7a0d9d3f0ac'
    },
    defaultConfig: {
      effectId: 'gradient-stroke-text',
      collectionVersion: '0.7.0',
      artifactDigest: '1f4cc65d7fe7ebaa1afaa318aa96a5145650b22120cf6c8d99d984495fd7be46',
      text: '流光描绘',
      color: '#67e8f9',
      secondaryColor: '#c084fc',
      speed: 1
    },
    defaultSize: {
      width: 400,
      height: 240
    },
    events: [],
    editableFields: ['text', 'color', 'secondaryColor', 'speed'],
    artifact: {
      markup:
        '<svg viewBox="0 0 600 180" role="img" aria-label="__EP_TEXT__" style="--stroke-font-size:__EP_WATER_FONT_SIZE__px"><defs><linearGradient id="ep-stroke-__EP_INSTANCE__" x1="0%" x2="100%"><stop offset="0%"/><stop offset="50%"/><stop offset="100%"/></linearGradient></defs><text x="300" y="128" text-anchor="middle" class="gradient-glyph" stroke="url(#ep-stroke-__EP_INSTANCE__)">__EP_TEXT__</text></svg>',
      css: '.fx-gradient-stroke-text { --fx-accent:#67e8f9; --fx-secondary:#c084fc; --fx-speed:1; --fx-duration:4400ms; position:relative; isolation:isolate; container-type:size; display:grid; grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(0,1fr); place-items:center; width:100%; height:100%; min-width:0; min-height:0; overflow:hidden; box-sizing:border-box; background:transparent; font-family:system-ui,"PingFang SC",sans-serif; }\n.fx-gradient-stroke-text *, .fx-gradient-stroke-text *::before, .fx-gradient-stroke-text *::after { box-sizing:border-box; }\n.fx-gradient-stroke-text > svg { display:block; width:92%; height:92%; min-width:0; max-height:100%; }\n.fx-gradient-stroke-text .gradient-glyph { fill:none; stroke-width:2; font-family:inherit; font-size:min(110px,var(--stroke-font-size)); font-weight:800; stroke-linejoin:round; }\n.fx-gradient-stroke-text stop { stop-color:var(--fx-accent); animation:fx-gradient-stroke-text-hue var(--fx-duration) ease-in-out infinite; }\n.fx-gradient-stroke-text stop:nth-child(2) { animation-delay:-1450ms; }\n.fx-gradient-stroke-text stop:nth-child(3) { animation-delay:-2900ms; }\n@keyframes fx-gradient-stroke-text-hue { 0%,100% { stop-color:var(--fx-accent); } 50% { stop-color:var(--fx-secondary); } }\n.fx-gradient-stroke-text[data-paused="true"], .fx-gradient-stroke-text[data-paused="true"] *, .fx-gradient-stroke-text[data-paused="true"] *::before, .fx-gradient-stroke-text[data-paused="true"] *::after { animation-play-state:paused !important; transition:none !important; }\n@media (prefers-reduced-motion:reduce) { .fx-gradient-stroke-text, .fx-gradient-stroke-text *, .fx-gradient-stroke-text *::before, .fx-gradient-stroke-text *::after { animation:none !important; transition:none !important; } }',
      durationMs: 4400,
      behavior: 'text'
    }
  },
  {
    runtimeRevision: 'effect-pick-css-v1',
    id: 'text-zoom-trail',
    title: '文字缩放残影',
    description: '多层文字按错开的相位向外放大并淡出，留下扩散残影。',
    category: '文字',
    tags: ['文字', 'CSS'],
    collectionVersion: '0.7.0',
    artifactDigest: 'cc24ec466b44b98e89742e0337a9510b98ef6d57ef85371a7172754d5cd3ab61',
    source: {
      url: 'https://codepen.io/juanbrujo/pen/DBKxxM',
      author: 'juanbrujo',
      authorName: 'juanbrujo',
      mode: 'reference',
      license: 'UNLICENSED',
      licenseStatus: 'not-reviewed',
      note: 'Chrome 中发现的视觉参考。当前组件为相关运动或交互思路的独立扩展实现，不声称逐像素还原原作；具体实现与提取边界见下方说明。 Selected in place of rAF-driven kinetic-kerning. Fixed CSS scale/opacity echoes retain a stable readable base text; source text-writing JavaScript is excluded.'
    },
    sourceSha256: {
      coreJs: '66584402f84c7a0e857861529c74e0abfbab50f14cc8f50b93b3386bd34da85a',
      coreCss: '12b103f22d8d907b3c6a2bad1b4facebbfc17acfce984b03c370c8adc3cea757',
      metadata: '6548da6d3abb0c667ca8b2b00a22116b0578f9bd7e610e1055115b576175402c',
      sharedUtils: '1652ebaca26a641065de146768b735b4d9b52d3ddd7d9152386fd7a0d9d3f0ac'
    },
    defaultConfig: {
      effectId: 'text-zoom-trail',
      collectionVersion: '0.7.0',
      artifactDigest: 'cc24ec466b44b98e89742e0337a9510b98ef6d57ef85371a7172754d5cd3ab61',
      text: '灵感回响',
      color: '#eaf3f7',
      secondaryColor: '#67e8f9',
      speed: 1
    },
    defaultSize: {
      width: 400,
      height: 240
    },
    events: [],
    editableFields: ['text', 'color', 'secondaryColor', 'speed'],
    artifact: {
      markup:
        '<div class="zoom-words"><span class="zoom-main">__EP_TEXT__</span><span class="zoom-trail" aria-hidden="true">__EP_TEXT__</span><span class="zoom-trail" aria-hidden="true">__EP_TEXT__</span><span class="zoom-trail" aria-hidden="true">__EP_TEXT__</span></div>',
      css: '.fx-text-zoom-trail { --fx-accent:#eaf3f7; --fx-secondary:#67e8f9; --fx-speed:1; --fx-duration:2500ms; position:relative; isolation:isolate; container-type:size; display:grid; grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(0,1fr); place-items:center; width:100%; height:100%; min-width:0; min-height:0; overflow:hidden; box-sizing:border-box; background:transparent; font-family:system-ui,"PingFang SC",sans-serif; }\n.fx-text-zoom-trail *, .fx-text-zoom-trail *::before, .fx-text-zoom-trail *::after { box-sizing:border-box; }\n.fx-text-zoom-trail .zoom-words { display:grid; width:74%; max-height:80%; min-width:0; color:var(--fx-accent); font-size:clamp(18px,11cqw,66px); font-weight:800; line-height:1.25; text-align:center; overflow-wrap:anywhere; }\n.fx-text-zoom-trail .zoom-words span { grid-area:1/1; min-width:0; max-height:80cqh; overflow:auto; }\n.fx-text-zoom-trail .zoom-main { z-index:1; }\n.fx-text-zoom-trail .zoom-trail { color:transparent; -webkit-text-stroke:1px var(--fx-secondary); opacity:0; animation:fx-text-zoom-trail-echo var(--fx-duration) ease-out infinite; }\n.fx-text-zoom-trail .zoom-trail:nth-child(3) { animation-delay:-300ms; }\n.fx-text-zoom-trail .zoom-trail:nth-child(4) { animation-delay:-600ms; }\n@keyframes fx-text-zoom-trail-echo { 0% { transform:scale(1); opacity:.5; } 75%,100% { transform:scale(1.55); opacity:0; } }\n.fx-text-zoom-trail[data-paused="true"], .fx-text-zoom-trail[data-paused="true"] *, .fx-text-zoom-trail[data-paused="true"] *::before, .fx-text-zoom-trail[data-paused="true"] *::after { animation-play-state:paused !important; transition:none !important; }\n@media (prefers-reduced-motion:reduce) { .fx-text-zoom-trail, .fx-text-zoom-trail *, .fx-text-zoom-trail *::before, .fx-text-zoom-trail *::after { animation:none !important; transition:none !important; } }',
      durationMs: 2500,
      behavior: 'text'
    }
  }
]
