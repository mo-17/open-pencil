// Fixed local adaptations from @effect-pick/collection 0.7.0.
// Reference licenses remain unreviewed; original collection JavaScript is excluded.
import type { EffectPickCatalogEntry } from '#core/plugins/effect-pick/types'

export const EFFECT_PICK_BACKGROUNDS_BATCH2: readonly EffectPickCatalogEntry[] = [
  {
    runtimeRevision: 'effect-pick-css-v1',
    id: 'aurora-curtains',
    title: '极光帘幕',
    description: '多层透光色带缓慢扭动，形成纵向极光帘幕。',
    category: '背景',
    tags: ['CSS', '背景', '循环'],
    collectionVersion: '0.7.0',
    artifactDigest: '343012905bd5c274e5004644d40ea63d74ad4ed03df94ad4533631420385e7ee',
    source: {
      url: 'https://codepen.io/P1N2O/pen/pyBNzX',
      author: 'P1N2O',
      authorName: 'P1N2O',
      mode: 'reference',
      license: 'UNLICENSED',
      licenseStatus: 'not-reviewed',
      note: 'Chrome 中发现的视觉参考。当前组件为相关运动或交互思路的独立扩展实现，不声称逐像素还原原作；具体实现与提取边界见下方说明。 Five fixed CSS strands replace source count-dependent DOM generation; optional text is a safe local overlay.'
    },
    sourceSha256: {
      coreJs: 'deb62f5a25b2c8b73fa39a6d11d364ddbf1ac410922490cd5ba7ba9724509d71',
      coreCss: '1399906a76021a16fa643417dfaeafd12d3e80437355ecc68235d74bc3cd0270',
      metadata: '8c6f5d7b701b1bc9c16c917a614487395e41d20f661187ad91e4b53dd68ab220',
      sharedUtils: '1652ebaca26a641065de146768b735b4d9b52d3ddd7d9152386fd7a0d9d3f0ac'
    },
    defaultConfig: {
      effectId: 'aurora-curtains',
      collectionVersion: '0.7.0',
      artifactDigest: '343012905bd5c274e5004644d40ea63d74ad4ed03df94ad4533631420385e7ee',
      text: '光影慢慢展开',
      color: '#5eead4',
      secondaryColor: '#818cf8',
      speed: 1
    },
    defaultSize: {
      width: 480,
      height: 280
    },
    events: [],
    editableFields: ['text', 'color', 'secondaryColor', 'speed'],
    artifact: {
      markup:
        '<div class="aurora-strands" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div><span class="aurora-copy">__EP_TEXT__</span>',
      css: '.fx-aurora-curtains { --fx-accent:#5eead4; --fx-secondary:#818cf8; --fx-speed:1; --fx-duration:12000ms; position:relative; isolation:isolate; container-type:size; display:grid; grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(0,1fr); place-items:center; width:100%; height:100%; min-width:0; min-height:0; overflow:hidden; box-sizing:border-box; background:transparent; font-family:system-ui,"PingFang SC",sans-serif; }\n.fx-aurora-curtains *, .fx-aurora-curtains *::before, .fx-aurora-curtains *::after { box-sizing:border-box; }\n.fx-aurora-curtains { background:#0d1420; border-radius:var(--fx-radius,14px); }\n.fx-aurora-curtains .aurora-strands { position:absolute; inset:-30%; filter:blur(18px); }\n.fx-aurora-curtains .aurora-strands span { position:absolute; top:0; width:26%; height:100%; transform-origin:50% 5%; opacity:.7; background:linear-gradient(180deg,transparent 3%,var(--fx-accent) 43%,var(--fx-secondary) 74%,transparent); mix-blend-mode:screen; animation:fx-aurora-curtains-fold var(--fx-duration) ease-in-out infinite alternate; }\n.fx-aurora-curtains .aurora-strands span:nth-child(1) { left:8%; }\n.fx-aurora-curtains .aurora-strands span:nth-child(2) { left:22%; animation-delay:-1700ms; }\n.fx-aurora-curtains .aurora-strands span:nth-child(3) { left:35%; animation-delay:-3400ms; }\n.fx-aurora-curtains .aurora-strands span:nth-child(4) { left:49%; animation-delay:-5100ms; }\n.fx-aurora-curtains .aurora-strands span:nth-child(5) { left:62%; animation-delay:-6800ms; }\n.fx-aurora-curtains .aurora-copy { position:relative; z-index:1; width:85%; max-height:80%; overflow:auto; overflow-wrap:anywhere; text-align:center; color:#f8fafc; font-size:clamp(12px,5cqw,28px); font-weight:550; text-shadow:0 2px 15px #0008; }\n@keyframes fx-aurora-curtains-fold { from { transform:translateX(-18px) skewX(-16deg) scaleY(.85); } to { transform:translateX(26px) skewX(16deg) scaleY(1.1); } }\n.fx-aurora-curtains[data-paused="true"], .fx-aurora-curtains[data-paused="true"] *, .fx-aurora-curtains[data-paused="true"] *::before, .fx-aurora-curtains[data-paused="true"] *::after { animation-play-state:paused !important; transition:none !important; }\n@media (prefers-reduced-motion:reduce) { .fx-aurora-curtains, .fx-aurora-curtains *, .fx-aurora-curtains *::before, .fx-aurora-curtains *::after { animation:none !important; transition:none !important; } }',
      durationMs: 12000,
      behavior: 'gradient'
    }
  },
  {
    runtimeRevision: 'effect-pick-css-v1',
    id: 'gradient-mesh',
    title: '渐变网格流动',
    description: '几个柔化色域在同一平面交叠流动。',
    category: '背景',
    tags: ['CSS', '背景', '循环'],
    collectionVersion: '0.7.0',
    artifactDigest: '10bdd132ede88297ca36b25b3804d2d5686d4e3c7afb6960cb93fdff5abeeb69',
    source: {
      url: 'https://codepen.io/P1N2O/pen/pyBNzX',
      author: 'P1N2O',
      authorName: 'P1N2O',
      mode: 'reference',
      license: 'UNLICENSED',
      licenseStatus: 'not-reviewed',
      note: 'Chrome 中发现的视觉参考。当前组件为相关运动或交互思路的独立扩展实现，不声称逐像素还原原作；具体实现与提取边界见下方说明。 Four fixed CSS gradient fields use both reviewed color props; text is a safe local overlay.'
    },
    sourceSha256: {
      coreJs: '70e55b1947713eb0d09c2fd0b0f539697b2258b0d11641e6492cc152ad4eed20',
      coreCss: '92715653d840476bca6c62a11d3a0334f9e2b9644545e115a5eeab2ac53c909a',
      metadata: '4fafcb842d9eb0a2eaf5ac148c337f9f69ca30cf9d335af289cd747ffd2b058d',
      sharedUtils: '1652ebaca26a641065de146768b735b4d9b52d3ddd7d9152386fd7a0d9d3f0ac'
    },
    defaultConfig: {
      effectId: 'gradient-mesh',
      collectionVersion: '0.7.0',
      artifactDigest: '10bdd132ede88297ca36b25b3804d2d5686d4e3c7afb6960cb93fdff5abeeb69',
      text: '让色彩相遇',
      color: '#67e8f9',
      secondaryColor: '#c084fc',
      speed: 1
    },
    defaultSize: {
      width: 480,
      height: 280
    },
    events: [],
    editableFields: ['text', 'color', 'secondaryColor', 'speed'],
    artifact: {
      markup:
        '<span class="mesh-orb mesh-one" aria-hidden="true"></span><span class="mesh-orb mesh-two" aria-hidden="true"></span><span class="mesh-orb mesh-three" aria-hidden="true"></span><span class="mesh-orb mesh-four" aria-hidden="true"></span><span class="mesh-copy">__EP_TEXT__</span>',
      css: '.fx-gradient-mesh { --fx-accent:#67e8f9; --fx-secondary:#c084fc; --fx-speed:1; --fx-duration:11000ms; position:relative; isolation:isolate; container-type:size; display:grid; grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(0,1fr); place-items:center; width:100%; height:100%; min-width:0; min-height:0; overflow:hidden; box-sizing:border-box; background:transparent; font-family:system-ui,"PingFang SC",sans-serif; }\n.fx-gradient-mesh *, .fx-gradient-mesh *::before, .fx-gradient-mesh *::after { box-sizing:border-box; }\n.fx-gradient-mesh { background:#20263d; border-radius:var(--fx-radius,14px); }\n.fx-gradient-mesh .mesh-orb { position:absolute; width:80%; height:110%; border-radius:50%; filter:blur(22px); opacity:.85; mix-blend-mode:screen; animation:fx-gradient-mesh-orbit var(--fx-duration) ease-in-out infinite alternate; }\n.fx-gradient-mesh .mesh-one { left:-25%; top:-35%; background:radial-gradient(ellipse,var(--fx-accent),transparent 65%); }\n.fx-gradient-mesh .mesh-two { right:-25%; bottom:-35%; background:radial-gradient(ellipse,var(--fx-secondary),transparent 65%); animation-delay:-3500ms; }\n.fx-gradient-mesh .mesh-three { left:35%; top:-35%; background:radial-gradient(ellipse,var(--fx-accent),transparent 65%); animation-delay:-7000ms; }\n.fx-gradient-mesh .mesh-four { left:-10%; bottom:-45%; background:radial-gradient(ellipse,var(--fx-secondary),transparent 65%); animation-direction:alternate-reverse; }\n.fx-gradient-mesh .mesh-copy { position:relative; z-index:1; width:85%; max-height:80%; overflow:auto; overflow-wrap:anywhere; text-align:center; color:#f8fafc; font-size:clamp(12px,5cqw,28px); font-weight:550; text-shadow:0 2px 15px #0005; }\n@keyframes fx-gradient-mesh-orbit { to { transform:translate(15%,30%) rotate(45deg) scale(1.3,.8); } }\n.fx-gradient-mesh[data-paused="true"], .fx-gradient-mesh[data-paused="true"] *, .fx-gradient-mesh[data-paused="true"] *::before, .fx-gradient-mesh[data-paused="true"] *::after { animation-play-state:paused !important; transition:none !important; }\n@media (prefers-reduced-motion:reduce) { .fx-gradient-mesh, .fx-gradient-mesh *, .fx-gradient-mesh *::before, .fx-gradient-mesh *::after { animation:none !important; transition:none !important; } }',
      durationMs: 11000,
      behavior: 'gradient'
    }
  },
  {
    runtimeRevision: 'effect-pick-css-v1',
    id: 'hex-grid-pulse',
    title: '六边网格脉冲',
    description: '六边形蜂巢沿对角线依次发光。',
    category: '背景',
    tags: ['SVG', '背景', '循环'],
    collectionVersion: '0.7.0',
    artifactDigest: '600a3811db256e71f8bdfcf32cef78cbe11a7b5054699d4a2b0ca82f60279548',
    source: {
      url: 'https://codepen.io/artinmn/pen/ZEMxPJ',
      author: 'artinmn',
      authorName: 'artinmn',
      mode: 'reference',
      license: 'UNLICENSED',
      licenseStatus: 'not-reviewed',
      note: 'Chrome 中发现的视觉参考。当前组件为相关运动或交互思路的独立扩展实现，不声称逐像素还原原作；具体实现与提取边界见下方说明。 Fixed audited SVG coordinates replace source polygon-generation JavaScript; text is a safe local overlay.'
    },
    sourceSha256: {
      coreJs: '92b01cb3fb9cac1e2020c1ac8514a11f79adf3e3c88f05479a9208addf183754',
      coreCss: '1bd66255ff914dc8a4dcd832b26bfe5a8decc3c986a68aadf3b8ca34f3fb63c8',
      metadata: '54a5fa83cc3853933644efa25376085aa494737869ef21eec83e55b3764616d6',
      sharedUtils: '1652ebaca26a641065de146768b735b4d9b52d3ddd7d9152386fd7a0d9d3f0ac'
    },
    defaultConfig: {
      effectId: 'hex-grid-pulse',
      collectionVersion: '0.7.0',
      artifactDigest: '600a3811db256e71f8bdfcf32cef78cbe11a7b5054699d4a2b0ca82f60279548',
      text: '灵感逐格点亮',
      color: '#a7f3d0',
      secondaryColor: '#102032',
      speed: 1
    },
    defaultSize: {
      width: 480,
      height: 280
    },
    events: [],
    editableFields: ['text', 'color', 'secondaryColor', 'speed'],
    artifact: {
      markup:
        '<svg class="hex-field" viewBox="0 0 600 280" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><polygon points="62.71,44 35,60 7.29,44 7.29,12 35,-4 62.71,12" style="--hex-delay:-4800ms"/><polygon points="127.71,44 100,60 72.29,44 72.29,12 100,-4 127.71,12" style="--hex-delay:-4610ms"/><polygon points="192.71,44 165,60 137.29,44 137.29,12 165,-4 192.71,12" style="--hex-delay:-4420ms"/><polygon points="257.71,44 230,60 202.29,44 202.29,12 230,-4 257.71,12" style="--hex-delay:-4230ms"/><polygon points="322.71,44 295,60 267.29,44 267.29,12 295,-4 322.71,12" style="--hex-delay:-4040ms"/><polygon points="387.71,44 360,60 332.29,44 332.29,12 360,-4 387.71,12" style="--hex-delay:-3850ms"/><polygon points="452.71,44 425,60 397.29,44 397.29,12 425,-4 452.71,12" style="--hex-delay:-3660ms"/><polygon points="517.71,44 490,60 462.29,44 462.29,12 490,-4 517.71,12" style="--hex-delay:-3470ms"/><polygon points="582.71,44 555,60 527.29,44 527.29,12 555,-4 582.71,12" style="--hex-delay:-3280ms"/><polygon points="95.21,97 67.5,113 39.79,97 39.79,65 67.5,49 95.21,65" style="--hex-delay:-4610ms"/><polygon points="160.21,97 132.5,113 104.79,97 104.79,65 132.5,49 160.21,65" style="--hex-delay:-4420ms"/><polygon points="225.21,97 197.5,113 169.79,97 169.79,65 197.5,49 225.21,65" style="--hex-delay:-4230ms"/><polygon points="290.21,97 262.5,113 234.79,97 234.79,65 262.5,49 290.21,65" style="--hex-delay:-4040ms"/><polygon points="355.21,97 327.5,113 299.79,97 299.79,65 327.5,49 355.21,65" style="--hex-delay:-3850ms"/><polygon points="420.21,97 392.5,113 364.79,97 364.79,65 392.5,49 420.21,65" style="--hex-delay:-3660ms"/><polygon points="485.21,97 457.5,113 429.79,97 429.79,65 457.5,49 485.21,65" style="--hex-delay:-3470ms"/><polygon points="550.21,97 522.5,113 494.79,97 494.79,65 522.5,49 550.21,65" style="--hex-delay:-3280ms"/><polygon points="615.21,97 587.5,113 559.79,97 559.79,65 587.5,49 615.21,65" style="--hex-delay:-3090ms"/><polygon points="62.71,150 35,166 7.29,150 7.29,118 35,102 62.71,118" style="--hex-delay:-4420ms"/><polygon points="127.71,150 100,166 72.29,150 72.29,118 100,102 127.71,118" style="--hex-delay:-4230ms"/><polygon points="192.71,150 165,166 137.29,150 137.29,118 165,102 192.71,118" style="--hex-delay:-4040ms"/><polygon points="257.71,150 230,166 202.29,150 202.29,118 230,102 257.71,118" style="--hex-delay:-3850ms"/><polygon points="322.71,150 295,166 267.29,150 267.29,118 295,102 322.71,118" style="--hex-delay:-3660ms"/><polygon points="387.71,150 360,166 332.29,150 332.29,118 360,102 387.71,118" style="--hex-delay:-3470ms"/><polygon points="452.71,150 425,166 397.29,150 397.29,118 425,102 452.71,118" style="--hex-delay:-3280ms"/><polygon points="517.71,150 490,166 462.29,150 462.29,118 490,102 517.71,118" style="--hex-delay:-3090ms"/><polygon points="582.71,150 555,166 527.29,150 527.29,118 555,102 582.71,118" style="--hex-delay:-2900ms"/><polygon points="95.21,203 67.5,219 39.79,203 39.79,171 67.5,155 95.21,171" style="--hex-delay:-4230ms"/><polygon points="160.21,203 132.5,219 104.79,203 104.79,171 132.5,155 160.21,171" style="--hex-delay:-4040ms"/><polygon points="225.21,203 197.5,219 169.79,203 169.79,171 197.5,155 225.21,171" style="--hex-delay:-3850ms"/><polygon points="290.21,203 262.5,219 234.79,203 234.79,171 262.5,155 290.21,171" style="--hex-delay:-3660ms"/><polygon points="355.21,203 327.5,219 299.79,203 299.79,171 327.5,155 355.21,171" style="--hex-delay:-3470ms"/><polygon points="420.21,203 392.5,219 364.79,203 364.79,171 392.5,155 420.21,171" style="--hex-delay:-3280ms"/><polygon points="485.21,203 457.5,219 429.79,203 429.79,171 457.5,155 485.21,171" style="--hex-delay:-3090ms"/><polygon points="550.21,203 522.5,219 494.79,203 494.79,171 522.5,155 550.21,171" style="--hex-delay:-2900ms"/><polygon points="615.21,203 587.5,219 559.79,203 559.79,171 587.5,155 615.21,171" style="--hex-delay:-2710ms"/><polygon points="62.71,256 35,272 7.29,256 7.29,224 35,208 62.71,224" style="--hex-delay:-4040ms"/><polygon points="127.71,256 100,272 72.29,256 72.29,224 100,208 127.71,224" style="--hex-delay:-3850ms"/><polygon points="192.71,256 165,272 137.29,256 137.29,224 165,208 192.71,224" style="--hex-delay:-3660ms"/><polygon points="257.71,256 230,272 202.29,256 202.29,224 230,208 257.71,224" style="--hex-delay:-3470ms"/><polygon points="322.71,256 295,272 267.29,256 267.29,224 295,208 322.71,224" style="--hex-delay:-3280ms"/><polygon points="387.71,256 360,272 332.29,256 332.29,224 360,208 387.71,224" style="--hex-delay:-3090ms"/><polygon points="452.71,256 425,272 397.29,256 397.29,224 425,208 452.71,224" style="--hex-delay:-2900ms"/><polygon points="517.71,256 490,272 462.29,256 462.29,224 490,208 517.71,224" style="--hex-delay:-2710ms"/><polygon points="582.71,256 555,272 527.29,256 527.29,224 555,208 582.71,224" style="--hex-delay:-2520ms"/></svg><span class="hex-copy">__EP_TEXT__</span>',
      css: '.fx-hex-grid-pulse { --fx-accent:#a7f3d0; --fx-secondary:#102032; --fx-speed:1; --fx-duration:4800ms; position:relative; isolation:isolate; container-type:size; display:grid; grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(0,1fr); place-items:center; width:100%; height:100%; min-width:0; min-height:0; overflow:hidden; box-sizing:border-box; background:transparent; font-family:system-ui,"PingFang SC",sans-serif; }\n.fx-hex-grid-pulse *, .fx-hex-grid-pulse *::before, .fx-hex-grid-pulse *::after { box-sizing:border-box; }\n.fx-hex-grid-pulse { background:var(--fx-secondary); border-radius:var(--fx-radius,14px); }\n.fx-hex-grid-pulse .hex-field { position:absolute; inset:0; display:block; width:100%; height:100%; }\n.fx-hex-grid-pulse polygon { stroke:var(--fx-accent); stroke-width:1; fill:var(--fx-accent); fill-opacity:.06; stroke-opacity:.3; animation:fx-hex-grid-pulse-energize var(--fx-duration) ease-in-out var(--hex-delay) infinite; }\n.fx-hex-grid-pulse .hex-copy { position:relative; z-index:1; width:85%; max-height:80%; overflow:auto; overflow-wrap:anywhere; text-align:center; color:#f8fafc; font-size:clamp(12px,5cqw,28px); font-weight:550; text-shadow:0 2px 15px #0008; }\n@keyframes fx-hex-grid-pulse-energize { 0%,60%,100% { fill-opacity:.04; stroke-opacity:.2; } 28% { fill-opacity:.4; stroke-opacity:1; } }\n.fx-hex-grid-pulse[data-paused="true"], .fx-hex-grid-pulse[data-paused="true"] *, .fx-hex-grid-pulse[data-paused="true"] *::before, .fx-hex-grid-pulse[data-paused="true"] *::after { animation-play-state:paused !important; transition:none !important; }\n@media (prefers-reduced-motion:reduce) { .fx-hex-grid-pulse, .fx-hex-grid-pulse *, .fx-hex-grid-pulse *::before, .fx-hex-grid-pulse *::after { animation:none !important; transition:none !important; } }',
      durationMs: 4800,
      behavior: 'gradient'
    }
  },
  {
    runtimeRevision: 'effect-pick-css-v1',
    id: 'perspective-grid-floor',
    title: '透视网格地面',
    description: '地面网格向地平线移动，形成速度感。',
    category: '背景',
    tags: ['CSS', '3D', '背景'],
    collectionVersion: '0.7.0',
    artifactDigest: '88e9b0f81b65c4a2802de188eb7d99f81d122b97b1a7a915f25207de6e35b320',
    source: {
      url: 'https://codepen.io/isladjan/pen/abdyPBw',
      author: 'isladjan',
      authorName: 'isladjan',
      mode: 'reference',
      license: 'UNLICENSED',
      licenseStatus: 'not-reviewed',
      note: 'Chrome 中发现的视觉参考。当前组件为相关运动或交互思路的独立扩展实现，不声称逐像素还原原作；具体实现与提取边界见下方说明。 Fixed CSS grid and sun; no source JavaScript is executed. Both colors theme the grid/sun, and text is a safe local overlay.'
    },
    sourceSha256: {
      coreJs: '6784185ffa64e4714c27a8bf6ad5c5b43ebf73558e56f982029caa09fbb6121e',
      coreCss: '18f16731d4165bb62d6f78f64c8259c84b7a70111974ea4606efd37362007785',
      metadata: '7253165028f8733328ecaa5d626e1622a06efc59183580478cdd7b8a94755220',
      sharedUtils: '1652ebaca26a641065de146768b735b4d9b52d3ddd7d9152386fd7a0d9d3f0ac'
    },
    defaultConfig: {
      effectId: 'perspective-grid-floor',
      collectionVersion: '0.7.0',
      artifactDigest: '88e9b0f81b65c4a2802de188eb7d99f81d122b97b1a7a915f25207de6e35b320',
      text: '沿着光线前行',
      color: '#67e8f9',
      secondaryColor: '#f9a8d4',
      speed: 1
    },
    defaultSize: {
      width: 480,
      height: 280
    },
    events: [],
    editableFields: ['text', 'color', 'secondaryColor', 'speed'],
    artifact: {
      markup:
        '<div class="floor-grid" aria-hidden="true"></div><span class="floor-horizon" aria-hidden="true"></span><span class="floor-sun" aria-hidden="true"></span><span class="floor-copy">__EP_TEXT__</span>',
      css: '.fx-perspective-grid-floor { --fx-accent:#67e8f9; --fx-secondary:#f9a8d4; --fx-speed:1; --fx-duration:1700ms; position:relative; isolation:isolate; container-type:size; display:grid; grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(0,1fr); place-items:center; width:100%; height:100%; min-width:0; min-height:0; overflow:hidden; box-sizing:border-box; background:transparent; font-family:system-ui,"PingFang SC",sans-serif; }\n.fx-perspective-grid-floor *, .fx-perspective-grid-floor *::before, .fx-perspective-grid-floor *::after { box-sizing:border-box; }\n.fx-perspective-grid-floor { perspective:400px; background:linear-gradient(#111725 0 45%,#192f3d); border-radius:var(--fx-radius,14px); }\n.fx-perspective-grid-floor .floor-grid { position:absolute; left:-50%; top:44%; width:200%; height:200%; transform:rotateX(62deg); transform-origin:center top; background-image:linear-gradient(var(--fx-accent) 1px,transparent 1px),linear-gradient(90deg,var(--fx-accent) 1px,transparent 1px); background-size:36px 36px; opacity:.4; animation:fx-perspective-grid-floor-travel var(--fx-duration) linear infinite; }\n.fx-perspective-grid-floor .floor-horizon { position:absolute; left:0; right:0; top:44%; height:2px; background:var(--fx-accent); box-shadow:0 0 18px var(--fx-accent); opacity:.5; }\n.fx-perspective-grid-floor .floor-sun { position:absolute; width:min(15cqw,28cqh); aspect-ratio:1; border-radius:50%; background:linear-gradient(var(--fx-secondary),var(--fx-accent)); top:18%; left:50%; transform:translateX(-50%); opacity:.8; }\n.fx-perspective-grid-floor .floor-copy { position:relative; z-index:1; align-self:end; width:85%; max-height:42%; margin-bottom:5cqh; overflow:auto; overflow-wrap:anywhere; text-align:center; color:#f8fafc; font-size:clamp(12px,4cqw,24px); font-weight:550; text-shadow:0 2px 15px #0008; }\n@keyframes fx-perspective-grid-floor-travel { to { background-position:0 36px,0 36px; } }\n.fx-perspective-grid-floor[data-paused="true"], .fx-perspective-grid-floor[data-paused="true"] *, .fx-perspective-grid-floor[data-paused="true"] *::before, .fx-perspective-grid-floor[data-paused="true"] *::after { animation-play-state:paused !important; transition:none !important; }\n@media (prefers-reduced-motion:reduce) { .fx-perspective-grid-floor, .fx-perspective-grid-floor *, .fx-perspective-grid-floor *::before, .fx-perspective-grid-floor *::after { animation:none !important; transition:none !important; } }',
      durationMs: 1700,
      behavior: 'gradient'
    }
  }
]
