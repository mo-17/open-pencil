// Fixed local adaptations from @effect-pick/collection 0.7.0.
// Reference licenses remain unreviewed; original collection JavaScript is excluded.
import type { EffectPickCatalogEntry } from '#core/plugins/effect-pick/types'

export const EFFECT_PICK_CARDS_BATCH2: readonly EffectPickCatalogEntry[] = [
  {
    runtimeRevision: 'effect-pick-css-v1',
    id: 'tilt-card',
    title: '悬停倾斜卡',
    description: '卡片在悬停或键盘聚焦时固定倾斜，文字与几何符号沿纵深抬起。',
    category: '卡片',
    tags: ['UI', '微交互'],
    collectionVersion: '0.7.0',
    artifactDigest: 'd560e88ca8f82f13e02175dc9526eb47d3ab0c05835d910814c13d7edbd42294',
    source: {
      url: 'https://codepen.io/aaroniker/pen/yLEPJXj',
      author: 'aaroniker',
      authorName: 'aaroniker',
      mode: 'reference',
      license: 'UNLICENSED',
      licenseStatus: 'not-reviewed',
      note: 'Chrome 中发现的视觉参考。当前组件为相关运动或交互思路的独立扩展实现，不声称逐像素还原原作；具体实现与提取边界见下方说明。 Fixed CSS hover/focus rotateX/rotateY with translateZ depth; this adaptation does not follow the pointer. Original pointer tracking and source JavaScript are excluded.'
    },
    sourceSha256: {
      coreJs: '1c6d37f2885f592e76eeb6de7743c8a8fe8f8474ea8755461e5ec742515f37aa',
      coreCss: '04ba4a232783561bad43561abf367745a471767cb2d6a9a0b6ab24d51e5386d7',
      metadata: '6526e5f971b5a9ba5dfb9c444c3356eb45a35ee9c6970774a8e458fcfbe01227',
      sharedUtils: '1652ebaca26a641065de146768b735b4d9b52d3ddd7d9152386fd7a0d9d3f0ac'
    },
    defaultConfig: {
      effectId: 'tilt-card',
      collectionVersion: '0.7.0',
      artifactDigest: 'd560e88ca8f82f13e02175dc9526eb47d3ab0c05835d910814c13d7edbd42294',
      text: '换个角度看设计',
      color: '#67e8f9',
      secondaryColor: '#142536',
      speed: 1
    },
    defaultSize: {
      width: 320,
      height: 220
    },
    events: [],
    editableFields: ['text', 'color', 'secondaryColor', 'speed'],
    artifact: {
      markup:
        '<div class="tilt-face" tabindex="0" role="img" aria-label="__EP_TEXT__"><span class="tilt-symbol" aria-hidden="true"></span><span class="tilt-copy" aria-hidden="true">__EP_TEXT__</span></div>',
      css: '.fx-tilt-card { --fx-accent:#67e8f9; --fx-secondary:#142536; --fx-speed:1; --fx-duration:500ms; position:relative; isolation:isolate; container-type:size; display:grid; grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(0,1fr); place-items:center; width:100%; height:100%; min-width:0; min-height:0; overflow:hidden; box-sizing:border-box; background:transparent; font-family:system-ui,"PingFang SC",sans-serif; }\n.fx-tilt-card *, .fx-tilt-card *::before, .fx-tilt-card *::after { box-sizing:border-box; }\n.fx-tilt-card { perspective:700px; }\n.fx-tilt-card .tilt-face { position:relative; display:grid; place-items:center; width:min(84%,340px); height:80%; min-width:0; min-height:0; border:1px solid var(--fx-accent); border-radius:14px; background:var(--fx-secondary); color:#f8fafc; transform-style:preserve-3d; transition:transform calc(var(--fx-duration) / var(--fx-speed)) ease; }\n.fx-tilt-card .tilt-symbol { position:absolute; top:12%; right:10%; width:min(11cqw,20cqh); aspect-ratio:1; border:2px solid var(--fx-accent); border-radius:20%; transform:translateZ(8px) rotate(12deg); transition:transform calc(var(--fx-duration) / var(--fx-speed)) ease; }\n.fx-tilt-card .tilt-copy { display:block; width:80%; max-height:65%; margin-top:10%; overflow:auto; overflow-wrap:anywhere; text-align:center; font-size:clamp(12px,6cqw,26px); font-weight:650; line-height:1.35; transform:translateZ(8px); transition:transform calc(var(--fx-duration) / var(--fx-speed)) ease; }\n.fx-tilt-card .tilt-face:is(:hover,:focus-visible), .fx-tilt-card[data-preview] .tilt-face { transform:rotateX(8deg) rotateY(-10deg); }\n.fx-tilt-card .tilt-face:is(:hover,:focus-visible) .tilt-copy, .fx-tilt-card[data-preview] .tilt-copy { transform:translateZ(24px); }\n.fx-tilt-card .tilt-face:is(:hover,:focus-visible) .tilt-symbol, .fx-tilt-card[data-preview] .tilt-symbol { transform:translateZ(32px) rotate(12deg); }\n.fx-tilt-card .tilt-face:focus-visible { outline:2px solid var(--fx-accent); outline-offset:4px; }\n.fx-tilt-card[data-paused="true"], .fx-tilt-card[data-paused="true"] *, .fx-tilt-card[data-paused="true"] *::before, .fx-tilt-card[data-paused="true"] *::after { animation-play-state:paused !important; transition:none !important; }\n@media (prefers-reduced-motion:reduce) { .fx-tilt-card, .fx-tilt-card *, .fx-tilt-card *::before, .fx-tilt-card *::after { animation:none !important; transition:none !important; } }',
      durationMs: 500,
      behavior: 'card'
    }
  },
  {
    runtimeRevision: 'effect-pick-css-v1',
    id: 'glare-card',
    title: '镜面扫光卡',
    description: '卡面保持平直，高光带在悬停或键盘聚焦时固定横扫，呈现镜面反射。',
    category: '卡片',
    tags: ['UI', '微交互'],
    collectionVersion: '0.7.0',
    artifactDigest: '32317306be2de15bf4b0d4aa6ea47438f29ca15242115cc0dd37d79fbcad4fd4',
    source: {
      url: 'https://codepen.io/aaroniker/pen/yLEPJXj',
      author: 'aaroniker',
      authorName: 'aaroniker',
      mode: 'reference',
      license: 'UNLICENSED',
      licenseStatus: 'not-reviewed',
      note: 'Chrome 中发现的视觉参考。当前组件为相关运动或交互思路的独立扩展实现，不声称逐像素还原原作；具体实现与提取边界见下方说明。 Fixed CSS hover/focus reflection sweep on a card that remains flat; this adaptation does not follow the pointer or tilt the card. Original pointer tracking and source JavaScript are excluded.'
    },
    sourceSha256: {
      coreJs: '10d5b4730ff0031c0d33992325ea2f63d517f2c4fe2b024665cd34247cd8e60e',
      coreCss: '0a81641f188ed9bbc6f0bc231ca775f7b88f4ff3ec929408b6a55b2f8a5cef20',
      metadata: '9812dfd01e44febc9ed31f3182d2adfdcd1819d16a2f5da86b4dcc7f4426c974',
      sharedUtils: '1652ebaca26a641065de146768b735b4d9b52d3ddd7d9152386fd7a0d9d3f0ac'
    },
    defaultConfig: {
      effectId: 'glare-card',
      collectionVersion: '0.7.0',
      artifactDigest: '32317306be2de15bf4b0d4aa6ea47438f29ca15242115cc0dd37d79fbcad4fd4',
      text: '让细节闪耀',
      color: '#a7f3d0',
      secondaryColor: '#172b3d',
      speed: 1
    },
    defaultSize: {
      width: 320,
      height: 220
    },
    events: [],
    editableFields: ['text', 'color', 'secondaryColor', 'speed'],
    artifact: {
      markup:
        '<div class="glare-face" tabindex="0" role="img" aria-label="__EP_TEXT__"><span class="glare-line" aria-hidden="true"></span><span class="glare-copy" aria-hidden="true">__EP_TEXT__</span></div>',
      css: '.fx-glare-card { --fx-accent:#a7f3d0; --fx-secondary:#172b3d; --fx-speed:1; --fx-duration:750ms; position:relative; isolation:isolate; container-type:size; display:grid; grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(0,1fr); place-items:center; width:100%; height:100%; min-width:0; min-height:0; overflow:hidden; box-sizing:border-box; background:transparent; font-family:system-ui,"PingFang SC",sans-serif; }\n.fx-glare-card *, .fx-glare-card *::before, .fx-glare-card *::after { box-sizing:border-box; }\n.fx-glare-card .glare-face { position:relative; display:grid; place-items:center; isolation:isolate; width:min(84%,340px); height:80%; min-width:0; min-height:0; overflow:hidden; border:1px solid var(--fx-accent); border-radius:14px; background:var(--fx-secondary); color:#f8fafc; }\n.fx-glare-card .glare-face::after { content:""; position:absolute; z-index:2; top:-60%; left:0; width:55%; height:220%; background:linear-gradient(90deg,transparent,#ffffff80,transparent); opacity:0; transform:translateX(-180%) rotate(24deg); pointer-events:none; transition:transform calc(var(--fx-duration) / var(--fx-speed)) ease,opacity calc(var(--fx-duration) / var(--fx-speed)) ease; }\n.fx-glare-card .glare-line { position:absolute; inset:14% 12% auto; height:3px; background:var(--fx-accent); opacity:.7; }\n.fx-glare-card .glare-copy { position:relative; width:80%; max-height:65%; overflow:auto; overflow-wrap:anywhere; text-align:center; font-size:clamp(12px,6cqw,26px); font-weight:650; line-height:1.35; }\n.fx-glare-card .glare-face:is(:hover,:focus-visible)::after, .fx-glare-card[data-preview] .glare-face::after { opacity:.85; transform:translateX(230%) rotate(24deg); }\n.fx-glare-card .glare-face:focus-visible { outline:2px solid var(--fx-accent); outline-offset:4px; }\n.fx-glare-card[data-paused="true"], .fx-glare-card[data-paused="true"] *, .fx-glare-card[data-paused="true"] *::before, .fx-glare-card[data-paused="true"] *::after { animation-play-state:paused !important; transition:none !important; }\n@media (prefers-reduced-motion:reduce) { .fx-glare-card, .fx-glare-card *, .fx-glare-card *::before, .fx-glare-card *::after { animation:none !important; transition:none !important; } }',
      durationMs: 750,
      behavior: 'card'
    }
  },
  {
    runtimeRevision: 'effect-pick-css-v1',
    id: 'exploded-layer-card',
    title: '悬停分层卡',
    description: '三层卡面在悬停或键盘聚焦时沿纵深分离，露出渐变网格层。',
    category: '卡片',
    tags: ['交互', '卡片', 'CSS 3D', '原生 JS'],
    collectionVersion: '0.7.0',
    artifactDigest: '0246e03483ea035dadf8e438fb6980b2aaba54263796892fca114a6fd1d70c0f',
    source: {
      url: 'https://codepen.io/candroo/pen/wKEwRL',
      author: 'Andrew Canham',
      authorName: 'Andrew Canham',
      mode: 'reference',
      license: 'UNLICENSED',
      licenseStatus: 'not-reviewed',
      note: '独立实现三个 DOM 卡层的 Z 位移和旋转观察视角，使用折叠揭示作品作为空间展示方向参考；不复制其 HTML、图片或原始时间线。 仅据已发现标题与方向做机制扩展；未读取完整原作源码，不声称逐像素克隆。 Fixed CSS hover/focus layer separation; original progress/range controls and source JavaScript are excluded. The static surface does not declare a click event.'
    },
    sourceSha256: {
      coreJs: 'c9aee59c648237c575d42e40101119a301b996b5ab4668bebadc66a92e4d00ca',
      coreCss: 'a17a9f357c9ebeb2ae5fe192fb7c12220fc318566fc6ea155e47b61a59186276',
      metadata: '297e2e4d511363de2f7d95556cae9d6bd44c89164c3fc25a0e4c554881b6206f',
      sharedUtils: '1652ebaca26a641065de146768b735b4d9b52d3ddd7d9152386fd7a0d9d3f0ac'
    },
    defaultConfig: {
      effectId: 'exploded-layer-card',
      collectionVersion: '0.7.0',
      artifactDigest: '0246e03483ea035dadf8e438fb6980b2aaba54263796892fca114a6fd1d70c0f',
      text: '看见设计层次',
      color: '#a7f3d0',
      secondaryColor: '#142536',
      speed: 1
    },
    defaultSize: {
      width: 320,
      height: 220
    },
    events: [],
    editableFields: ['text', 'color', 'secondaryColor', 'speed'],
    artifact: {
      markup:
        '<div class="layer-stack" tabindex="0" role="img" aria-label="__EP_TEXT__"><span class="layer-base" aria-hidden="true"></span><span class="layer-grid" aria-hidden="true"></span><span class="layer-cover" aria-hidden="true"><span class="layer-copy">__EP_TEXT__</span></span></div>',
      css: '.fx-exploded-layer-card { --fx-accent:#a7f3d0; --fx-secondary:#142536; --fx-speed:1; --fx-duration:650ms; position:relative; isolation:isolate; container-type:size; display:grid; grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(0,1fr); place-items:center; width:100%; height:100%; min-width:0; min-height:0; overflow:hidden; box-sizing:border-box; background:transparent; font-family:system-ui,"PingFang SC",sans-serif; }\n.fx-exploded-layer-card *, .fx-exploded-layer-card *::before, .fx-exploded-layer-card *::after { box-sizing:border-box; }\n.fx-exploded-layer-card { perspective:700px; }\n.fx-exploded-layer-card .layer-stack { position:relative; width:min(74%,320px); height:64%; min-width:0; min-height:0; transform:rotateX(27deg) rotateZ(-12deg); transform-style:preserve-3d; }\n.fx-exploded-layer-card .layer-stack > span { position:absolute; inset:0; border:1px solid var(--fx-accent); border-radius:12px; background-color:var(--fx-secondary); transition:transform calc(var(--fx-duration) / var(--fx-speed)) ease; }\n.fx-exploded-layer-card .layer-base { opacity:.7; transform:translateZ(0); }\n.fx-exploded-layer-card .layer-grid { opacity:.6; transform:translateZ(3px); background-image:repeating-linear-gradient(0deg,transparent 0 15px,var(--fx-accent) 16px 17px),repeating-linear-gradient(90deg,transparent 0 15px,var(--fx-accent) 16px 17px); }\n.fx-exploded-layer-card .layer-cover { display:grid; place-items:center; transform:translateZ(6px); color:#f8fafc; }\n.fx-exploded-layer-card .layer-copy { display:block; width:82%; max-height:80%; overflow:auto; overflow-wrap:anywhere; text-align:center; font-size:clamp(12px,6cqw,26px); font-weight:650; line-height:1.35; }\n.fx-exploded-layer-card .layer-stack:is(:hover,:focus-visible) .layer-grid, .fx-exploded-layer-card[data-preview] .layer-grid { transform:translateZ(20px); }\n.fx-exploded-layer-card .layer-stack:is(:hover,:focus-visible) .layer-cover, .fx-exploded-layer-card[data-preview] .layer-cover { transform:translateZ(40px); }\n.fx-exploded-layer-card .layer-stack:focus-visible { outline:2px solid var(--fx-accent); outline-offset:4px; }\n.fx-exploded-layer-card[data-paused="true"], .fx-exploded-layer-card[data-paused="true"] *, .fx-exploded-layer-card[data-paused="true"] *::before, .fx-exploded-layer-card[data-paused="true"] *::after { animation-play-state:paused !important; transition:none !important; }\n@media (prefers-reduced-motion:reduce) { .fx-exploded-layer-card, .fx-exploded-layer-card *, .fx-exploded-layer-card *::before, .fx-exploded-layer-card *::after { animation:none !important; transition:none !important; } }',
      durationMs: 650,
      behavior: 'card'
    }
  },
  {
    runtimeRevision: 'effect-pick-css-v1',
    id: 'gatefold-reveal-card',
    title: '悬停双门卡',
    description: '左右门页在悬停或键盘聚焦时向外翻开，错峰显露中心文字。',
    category: '卡片',
    tags: ['卡片', '3D', '微交互'],
    collectionVersion: '0.7.0',
    artifactDigest: '19a519d69e12d6344fa9c8a67e943345b0de2b941dd44df97458b70aa5d321de',
    source: {
      url: 'https://codepen.io/candroo/pen/wKEwRL',
      author: 'Andrew Canham',
      authorName: 'Andrew Canham',
      mode: 'reference',
      license: 'UNLICENSED',
      licenseStatus: 'not-reviewed',
      note: '本轮 Chrome 中发现的视觉参考。本组件独立实现下述机制扩展，未采用原作网页结构、素材或依赖；未阅读原作完整算法，不声称精确克隆。 Fixed CSS hover/focus gatefold opening with a staggered right door; original open/toggle/progress controls and source JavaScript are excluded. No business click event is declared.'
    },
    sourceSha256: {
      coreJs: 'f729ed98ca30ec7121284ea9a04577a54b40b43271f55f396fbf2a3b9a347050',
      coreCss: 'a52664e15e1ef0597887fbedf1962cd24222a93ad015de0008a34d667e5c61e7',
      metadata: 'b697a9d90e4143708f71188a48c4d1ce87fc9e06e0137348c6478144c6d57f8c',
      sharedUtils: '1652ebaca26a641065de146768b735b4d9b52d3ddd7d9152386fd7a0d9d3f0ac'
    },
    defaultConfig: {
      effectId: 'gatefold-reveal-card',
      collectionVersion: '0.7.0',
      artifactDigest: '19a519d69e12d6344fa9c8a67e943345b0de2b941dd44df97458b70aa5d321de',
      text: '打开新的视角',
      color: '#f9a8d4',
      secondaryColor: '#172536',
      speed: 1
    },
    defaultSize: {
      width: 320,
      height: 220
    },
    events: [],
    editableFields: ['text', 'color', 'secondaryColor', 'speed'],
    artifact: {
      markup:
        '<div class="gatefold-face" tabindex="0" role="img" aria-label="__EP_TEXT__"><span class="gatefold-copy" aria-hidden="true">__EP_TEXT__</span><span class="gatefold-door gatefold-left" aria-hidden="true"></span><span class="gatefold-door gatefold-right" aria-hidden="true"></span></div>',
      css: '.fx-gatefold-reveal-card { --fx-accent:#f9a8d4; --fx-secondary:#172536; --fx-speed:1; --fx-duration:700ms; position:relative; isolation:isolate; container-type:size; display:grid; grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(0,1fr); place-items:center; width:100%; height:100%; min-width:0; min-height:0; overflow:hidden; box-sizing:border-box; background:transparent; font-family:system-ui,"PingFang SC",sans-serif; }\n.fx-gatefold-reveal-card *, .fx-gatefold-reveal-card *::before, .fx-gatefold-reveal-card *::after { box-sizing:border-box; }\n.fx-gatefold-reveal-card { perspective:900px; }\n.fx-gatefold-reveal-card .gatefold-face { position:relative; display:grid; place-items:center; width:min(82%,340px); height:74%; min-width:0; min-height:0; border:1px solid var(--fx-accent); border-radius:12px; background:var(--fx-secondary); transform-style:preserve-3d; }\n.fx-gatefold-reveal-card .gatefold-copy { display:block; width:84%; max-height:85%; overflow:auto; overflow-wrap:anywhere; text-align:center; color:var(--fx-accent); font-size:clamp(12px,6cqw,26px); font-weight:650; line-height:1.35; }\n.fx-gatefold-reveal-card .gatefold-door { position:absolute; top:-1px; bottom:-1px; width:50%; border:1px solid var(--fx-accent); background:var(--fx-secondary); backface-visibility:hidden; transition:transform calc(var(--fx-duration) / var(--fx-speed)) cubic-bezier(.2,.8,.2,1); }\n.fx-gatefold-reveal-card .gatefold-door::after { content:""; position:absolute; inset:18% 18%; border:1px solid var(--fx-accent); opacity:.45; }\n.fx-gatefold-reveal-card .gatefold-left { left:-1px; border-radius:12px 0 0 12px; transform-origin:left center; }\n.fx-gatefold-reveal-card .gatefold-right { right:-1px; border-radius:0 12px 12px 0; transform-origin:right center; transition-delay:calc(60ms / var(--fx-speed)); }\n.fx-gatefold-reveal-card .gatefold-face:is(:hover,:focus-visible) .gatefold-left, .fx-gatefold-reveal-card[data-preview] .gatefold-left { transform:rotateY(-104deg); }\n.fx-gatefold-reveal-card .gatefold-face:is(:hover,:focus-visible) .gatefold-right, .fx-gatefold-reveal-card[data-preview] .gatefold-right { transform:rotateY(104deg); }\n.fx-gatefold-reveal-card .gatefold-face:focus-visible { outline:2px solid var(--fx-accent); outline-offset:4px; }\n.fx-gatefold-reveal-card[data-paused="true"], .fx-gatefold-reveal-card[data-paused="true"] *, .fx-gatefold-reveal-card[data-paused="true"] *::before, .fx-gatefold-reveal-card[data-paused="true"] *::after { animation-play-state:paused !important; transition:none !important; }\n@media (prefers-reduced-motion:reduce) { .fx-gatefold-reveal-card, .fx-gatefold-reveal-card *, .fx-gatefold-reveal-card *::before, .fx-gatefold-reveal-card *::after { animation:none !important; transition:none !important; } }',
      durationMs: 700,
      behavior: 'card'
    }
  }
]
