// Local authorized adaptations from @effect-pick/collection 0.6.0.
// Collection license is UNLICENSED; reference-source distribution rights remain unreviewed.
import type { EffectPickCatalogEntry } from './types'

export const EFFECT_PICK_CATALOG_DATA: readonly EffectPickCatalogEntry[] = [
  {
    runtimeRevision: 'effect-pick-css-v1',
    id: 'diagonal-fill',
    title: '斜向填色按钮',
    description: '一块倾斜色面横向划入按钮，形成简洁的斜切填色。',
    category: '交互',
    tags: ['CSS', '按钮', '微交互'],
    collectionVersion: '0.6.0',
    artifactDigest: '6dfdbdf04cf2c573aa6e392875709c7e86609334efa324b34463215b974f0913',
    source: {
      url: 'https://codepen.io/kjbrum/pen/wBBLXx',
      author: 'kjbrum',
      authorName: 'Kyle Brumm',
      mode: 'reference',
      license: 'UNLICENSED',
      licenseStatus: 'not-reviewed',
      note: 'Local reimplementation of the referenced visual mechanism; original distribution license is not recorded.'
    },
    sourceSha256: {
      coreJs: '429849348d50c93303d512f0cb6e99c92e12414b4fe3042b2b2f5e4160757163',
      coreCss: 'de1efc47cb2bda778749b740cb71ffbda33d1e85fa6a26fba7a7165d4415aba3',
      metadata: '309cec1a74d1e11fb16c710066497a8838a1b8aaf5e56b5ca1e171b0bd52fd9f',
      sharedUtils: '1652ebaca26a641065de146768b735b4d9b52d3ddd7d9152386fd7a0d9d3f0ac'
    },
    defaultConfig: {
      effectId: 'diagonal-fill',
      collectionVersion: '0.6.0',
      artifactDigest: '6dfdbdf04cf2c573aa6e392875709c7e86609334efa324b34463215b974f0913',
      text: '开始创作',
      color: '#fbbf24',
      secondaryColor: '#101821',
      speed: 1
    },
    defaultSize: {
      width: 320,
      height: 120
    },
    events: ['click'],
    editableFields: ['text', 'color', 'speed'],
    artifact: {
      markup:
        '<button class="fx-button" type="button"><span class="fx-label">__EP_TEXT__</span></button>',
      css: '.fx-diagonal-fill { --fx-accent: #fbbf24; --fx-speed: 1; --fx-duration: 450ms; display: grid; place-items: center; padding: 2rem; }\n.fx-diagonal-fill .fx-button { position: relative; isolation: isolate; overflow: hidden; padding: 1.1rem 2.6rem; min-width: 11rem; border: 1px solid var(--fx-accent); color: var(--fx-text, var(--fx-accent)); background: transparent; font: 600 1rem/1.3 system-ui, sans-serif; cursor: pointer; transition: color calc(var(--fx-duration) / var(--fx-speed)) ease; }\n.fx-diagonal-fill .fx-label { position: relative; z-index: 1; }\n.fx-diagonal-fill .fx-button::before { content: ""; position: absolute; inset: -1px -20%; background: var(--fx-accent); transform: translateX(-110%) skewX(-20deg); transition: transform calc(var(--fx-duration) / var(--fx-speed)) cubic-bezier(.22,.7,.2,1); }\n.fx-diagonal-fill .fx-button:is(:hover, :focus-visible), .fx-diagonal-fill[data-preview] .fx-button { color: var(--fx-on-accent, #10151d); }\n.fx-diagonal-fill .fx-button:is(:hover, :focus-visible)::before, .fx-diagonal-fill[data-preview] .fx-button::before { transform: translateX(0) skewX(-20deg); }\n.fx-diagonal-fill .fx-button:focus-visible { outline: 2px solid var(--fx-accent); outline-offset: 6px; }\n.fx-diagonal-fill[data-paused="true"] .fx-button, .fx-diagonal-fill[data-paused="true"] .fx-button::before { transition: none; }\n@media (prefers-reduced-motion: reduce) { .fx-diagonal-fill .fx-button, .fx-diagonal-fill .fx-button::before { transition: none; } }\n\n.fx-diagonal-fill { box-sizing: border-box; min-width: 0; width: 100%; }\n.fx-diagonal-fill .fx-button { box-sizing: border-box; max-width: 100%; }\n.fx-diagonal-fill { width:100%; max-width:none; height:100%; min-height:100%; }\n.fx-diagonal-fill[data-paused="true"], .fx-diagonal-fill[data-paused="true"] *, .fx-diagonal-fill[data-paused="true"] *::before, .fx-diagonal-fill[data-paused="true"] *::after { animation-play-state:paused !important; }\n@media (prefers-reduced-motion:reduce) { .fx-diagonal-fill, .fx-diagonal-fill *, .fx-diagonal-fill *::before, .fx-diagonal-fill *::after { animation:none !important; transition:none !important; } }\n.fx-diagonal-fill { grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(0,1fr); padding:clamp(8px,4%,16px); }\n.fx-diagonal-fill .fx-button { display:flex; flex-direction:column; min-width:0; min-height:0; max-height:100%; padding:.75rem clamp(.6rem,8%,2.6rem); white-space:normal; }\n.fx-diagonal-fill .fx-label { display:block; min-width:0; min-height:0; max-width:100%; overflow:auto; overflow-wrap:anywhere; }',
      durationMs: 450,
      behavior: 'button'
    }
  },
  {
    runtimeRevision: 'effect-pick-css-v1',
    id: 'animated-gradient',
    title: '动态渐变背景',
    description: '放大的四色渐变缓慢平移，用作独立背景面板。',
    category: '背景',
    tags: ['CSS', '背景', '渐变'],
    collectionVersion: '0.6.0',
    artifactDigest: '71782faf7f7476e2c6655f61d7ce87f7470b7a9ec01baef738ef7bc0cde323bb',
    source: {
      url: 'https://codepen.io/P1N2O/pen/pyBNzX',
      author: 'P1N2O',
      authorName: 'P1N2O',
      mode: 'reference',
      license: 'UNLICENSED',
      licenseStatus: 'not-reviewed',
      note: 'Local reimplementation of the referenced visual mechanism; original distribution license is not recorded.'
    },
    sourceSha256: {
      coreJs: '12056e68e4179752088dcf27e3d33e26019341841a71d7f45b87f1d5d4e8af8b',
      coreCss: '4733790a63e70f593134021faad8f21db1ef3a08b81b990faf6fced46b44947e',
      metadata: '76e46fbb93c35d7d319f39b4055ec217706102f5e59025f2af975223e47f9aed',
      sharedUtils: '1652ebaca26a641065de146768b735b4d9b52d3ddd7d9152386fd7a0d9d3f0ac'
    },
    defaultConfig: {
      effectId: 'animated-gradient',
      collectionVersion: '0.6.0',
      artifactDigest: '71782faf7f7476e2c6655f61d7ce87f7470b7a9ec01baef738ef7bc0cde323bb',
      text: '让色彩缓缓流动',
      color: '#ff719b',
      secondaryColor: '#23a6d5',
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
        '<div class="fx-animated-gradient-content"><span>EffectPick</span><h2>__EP_TEXT__</h2></div>',
      css: '.fx-animated-gradient { position: relative; display: grid; place-items: center; box-sizing: border-box; width: 100%; max-width: 740px; min-height: 270px; padding: 35px; border-radius: var(--fx-radius, 18px); overflow: hidden; color: #fff; font-family: inherit; background: linear-gradient(-45deg, #ee7752, var(--fx-accent, #ff719b), var(--fx-secondary, #23a6d5), #23d5ab); background-size: 400% 400%; animation: fx-animated-gradient-flow var(--fx-duration, 12s) ease infinite; }\n.fx-animated-gradient-content { position: relative; text-align: center; text-shadow: 0 2px 20px #23343c30; }\n.fx-animated-gradient-content span { font-size: 10px; letter-spacing: .24em; text-transform: uppercase; opacity: .85; }\n.fx-animated-gradient-content h2 { margin: 17px 0 12px; font-size: clamp(24px, 5vw, 40px); font-weight: 500; letter-spacing: -.03em; }\n.fx-animated-gradient-content p { margin: 0; max-width: 380px; font-size: 12px; line-height: 1.8; opacity: .8; }\n@keyframes fx-animated-gradient-flow { 0%, 100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }\n.fx-animated-gradient[data-paused="true"] { animation-play-state: paused !important; }\n@media (prefers-reduced-motion: reduce) { .fx-animated-gradient { animation-play-state: paused; } }\n.fx-animated-gradient { width:100%; max-width:none; height:100%; min-height:100%; }\n.fx-animated-gradient[data-paused="true"], .fx-animated-gradient[data-paused="true"] *, .fx-animated-gradient[data-paused="true"] *::before, .fx-animated-gradient[data-paused="true"] *::after { animation-play-state:paused !important; }\n@media (prefers-reduced-motion:reduce) { .fx-animated-gradient, .fx-animated-gradient *, .fx-animated-gradient *::before, .fx-animated-gradient *::after { animation:none !important; transition:none !important; } }',
      durationMs: 12000,
      behavior: 'gradient'
    }
  },
  {
    runtimeRevision: 'effect-pick-css-v1',
    id: 'blur-focus',
    title: '失焦再聚焦文字',
    description: '文字从清晰状态扩散失焦，再逐渐收紧回到锐利状态。',
    category: '文字',
    tags: ['文字', 'CSS'],
    collectionVersion: '0.6.0',
    artifactDigest: '2ad7de4d012124bed937252a130a209b0aaa72303cf819f74eab8efe5241e0d9',
    source: {
      url: 'https://codepen.io/Sonick/pen/AwXJdM',
      author: 'Sonick',
      authorName: 'Sonick',
      mode: 'reference',
      license: 'UNLICENSED',
      licenseStatus: 'not-reviewed',
      note: 'Chrome 中发现的视觉参考。当前组件为相关运动或交互思路的独立扩展实现，不声称逐像素还原原作；具体实现与提取边界见下方说明。'
    },
    sourceSha256: {
      coreJs: '434b2fe9dbb14938c741a5f32457ddcd931ba8ab6d62f655e600a9e335a12171',
      coreCss: '5f3a16ee4f5f723d0542d100a20c2ca08f212120cf876388d9ef000ff1d200de',
      metadata: 'c5afcb433e3282dd8dd5295733079ab7d73bffab0d5345f28096d480956b3611',
      sharedUtils: '1652ebaca26a641065de146768b735b4d9b52d3ddd7d9152386fd7a0d9d3f0ac'
    },
    defaultConfig: {
      effectId: 'blur-focus',
      collectionVersion: '0.6.0',
      artifactDigest: '2ad7de4d012124bed937252a130a209b0aaa72303cf819f74eab8efe5241e0d9',
      text: 'STAY FOCUSED',
      color: '#a7f3d0',
      secondaryColor: '#101821',
      speed: 1
    },
    defaultSize: {
      width: 400,
      height: 240
    },
    events: [],
    editableFields: ['text', 'color', 'secondaryColor', 'speed'],
    artifact: {
      markup: '<span class="focus-word">__EP_TEXT__</span>',
      css: '.fx-blur-focus { --fx-accent: #a7f3d0; --fx-text: #eaf3f7; --fx-speed: 1; position: relative; display: grid; place-items: center; box-sizing: border-box; min-width: 0; max-width: 100%; width: min(100%, 680px); min-height: 240px; padding: 28px; border-radius: var(--fx-radius, 16px); overflow: hidden; background: var(--fx-bg, #101821); color: var(--fx-text); font-family: inherit; }\n.fx-blur-focus *, .fx-blur-focus *::before, .fx-blur-focus *::after { box-sizing: border-box; }\n\n.fx-blur-focus .focus-word { display:block; max-width:100%; text-align:center; overflow-wrap:anywhere; color:var(--fx-accent); font-size:clamp(30px,6vw,65px); font-weight:650; line-height:1.4; animation:fx-blur-focus-shift var(--fx-duration,4600ms) ease-in-out infinite; }\n@keyframes fx-blur-focus-shift { 0%,15%,65%,100% { filter:blur(0); opacity:1; letter-spacing:.01em; } 34%,42% { filter:blur(8px); opacity:.45; letter-spacing:.16em; } }\n\n.fx-blur-focus[data-paused="true"], .fx-blur-focus[data-paused="true"] *, .fx-blur-focus[data-paused="true"] *::before, .fx-blur-focus[data-paused="true"] *::after { animation-play-state: paused !important; }\n@media(prefers-reduced-motion: reduce) { .fx-blur-focus * { transition-duration: .01ms !important; } }\n.fx-blur-focus { width:100%; max-width:none; height:100%; min-height:100%; }\n.fx-blur-focus[data-paused="true"], .fx-blur-focus[data-paused="true"] *, .fx-blur-focus[data-paused="true"] *::before, .fx-blur-focus[data-paused="true"] *::after { animation-play-state:paused !important; }\n@media (prefers-reduced-motion:reduce) { .fx-blur-focus, .fx-blur-focus *, .fx-blur-focus *::before, .fx-blur-focus *::after { animation:none !important; transition:none !important; } }',
      durationMs: 4600,
      behavior: 'text'
    }
  },
  {
    runtimeRevision: 'effect-pick-css-v1',
    id: 'character-wave',
    title: '字符波浪起伏',
    description: '每个字使用错开的相位上下移动，形成沿文字传播的波。',
    category: '文字',
    tags: ['文字', 'CSS'],
    collectionVersion: '0.6.0',
    artifactDigest: '3d882e6d1f1aa311ab28250b0a0900d5b50059a40912d78a84586272a3571fa8',
    source: {
      url: 'https://codepen.io/aaroniker/pen/BaLwKJR',
      author: 'aaroniker',
      authorName: 'aaroniker',
      mode: 'reference',
      license: 'UNLICENSED',
      licenseStatus: 'not-reviewed',
      note: 'Chrome 中发现的视觉参考。当前组件为相关运动或交互思路的独立扩展实现，不声称逐像素还原原作；具体实现与提取边界见下方说明。'
    },
    sourceSha256: {
      coreJs: '247bcc9965291cb87daf78da0270a24b8928b03ab249720c81ae447b9ff28274',
      coreCss: 'b8dcea3a71ad719bfa62cea435b3c3ecce8653cbd68c4be98da90321d0dc4db5',
      metadata: '99cea83d357825962f751dae4c955fb73513ed8389a38fc45abd6341338d8a7d',
      sharedUtils: '1652ebaca26a641065de146768b735b4d9b52d3ddd7d9152386fd7a0d9d3f0ac'
    },
    defaultConfig: {
      effectId: 'character-wave',
      collectionVersion: '0.6.0',
      artifactDigest: '3d882e6d1f1aa311ab28250b0a0900d5b50059a40912d78a84586272a3571fa8',
      text: '让文字自由呼吸',
      color: '#a7f3d0',
      secondaryColor: '#101821',
      speed: 1
    },
    defaultSize: {
      width: 400,
      height: 240
    },
    events: [],
    editableFields: ['text', 'color', 'secondaryColor', 'speed'],
    artifact: {
      markup: '<div class="wave-characters" aria-hidden="true">__EP_CHARACTERS__</div>',
      css: '.fx-character-wave { --fx-accent: #a7f3d0; --fx-text: #eaf3f7; --fx-speed: 1; position: relative; display: grid; place-items: center; box-sizing: border-box; min-width: 0; max-width: 100%; width: min(100%, 680px); min-height: 240px; padding: 28px; border-radius: var(--fx-radius, 16px); overflow: hidden; background: var(--fx-bg, #101821); color: var(--fx-text); font-family: inherit; }\n.fx-character-wave *, .fx-character-wave *::before, .fx-character-wave *::after { box-sizing: border-box; }\n\n.fx-character-wave .wave-characters { max-width:100%; display:flex; justify-content:center; flex-wrap:wrap; color:var(--fx-accent); font-size:clamp(28px,6vw,64px); font-weight:650; line-height:1.7; }\n.fx-character-wave .wave-characters span { display:inline-block; animation:fx-character-wave-float var(--fx-duration,2000ms) ease-in-out var(--wave-delay,0ms) infinite; }\n@keyframes fx-character-wave-float { 0%,100% { transform:translateY(9px); } 50% { transform:translateY(-12px); } }\n\n.fx-character-wave[data-paused="true"], .fx-character-wave[data-paused="true"] *, .fx-character-wave[data-paused="true"] *::before, .fx-character-wave[data-paused="true"] *::after { animation-play-state: paused !important; }\n@media(prefers-reduced-motion: reduce) { .fx-character-wave * { transition-duration: .01ms !important; } }\n.fx-character-wave { width:100%; max-width:none; height:100%; min-height:100%; }\n.fx-character-wave[data-paused="true"], .fx-character-wave[data-paused="true"] *, .fx-character-wave[data-paused="true"] *::before, .fx-character-wave[data-paused="true"] *::after { animation-play-state:paused !important; }\n@media (prefers-reduced-motion:reduce) { .fx-character-wave, .fx-character-wave *, .fx-character-wave *::before, .fx-character-wave *::after { animation:none !important; transition:none !important; } }',
      durationMs: 2000,
      behavior: 'characters'
    }
  },
  {
    runtimeRevision: 'effect-pick-css-v1',
    id: 'chasing-squares',
    title: '追逐方块',
    description: '四个方块沿矩形路线追逐，转角处平滑减速。',
    category: '加载',
    tags: ['CSS', '加载', '循环'],
    collectionVersion: '0.6.0',
    artifactDigest: '1a30ad520d150ef660dc2cd0aee7a70354640a887ee0f37a0d762f8375b35e74',
    source: {
      url: 'https://codepen.io/aaroniker/pen/omvYNZ',
      author: 'aaroniker',
      authorName: 'aaroniker',
      mode: 'reference',
      license: 'UNLICENSED',
      licenseStatus: 'not-reviewed',
      note: 'Chrome 中发现的视觉参考。当前组件为相关运动或交互思路的独立扩展实现，不声称逐像素还原原作；具体实现与提取边界见下方说明。'
    },
    sourceSha256: {
      coreJs: '29aec8467f4471ceba16eb5f8a013e907e9e5e1e20903f211f1aa2c5f25d3d7b',
      coreCss: '40d54913a29f35f370520feb25103f6b5d76ba5953d333455b11171c274d9716',
      metadata: '25cd2151c55c7949e4b0205d537b00d053b5291cc04b42c8dd86a538438d321d',
      sharedUtils: '1652ebaca26a641065de146768b735b4d9b52d3ddd7d9152386fd7a0d9d3f0ac'
    },
    defaultConfig: {
      effectId: 'chasing-squares',
      collectionVersion: '0.6.0',
      artifactDigest: '1a30ad520d150ef660dc2cd0aee7a70354640a887ee0f37a0d762f8375b35e74',
      text: '追逐方块',
      color: '#a7f3d0',
      secondaryColor: '#101821',
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
        '<div class="square-race" aria-hidden="true"><span></span><span></span><span></span><span></span></div>',
      css: '.fx-chasing-squares { --fx-accent: #a7f3d0; --fx-speed: 1; position: relative; isolation: isolate; display: block; width: 100%; min-width: 0; max-width: 100%; height: 280px; overflow: hidden; border-radius: 14px; box-sizing: border-box; background: var(--fx-bg, #111b23); color: var(--fx-accent, #a7f3d0); font-family: Arial, "PingFang SC", sans-serif; }\n.fx-chasing-squares *, .fx-chasing-squares *::before, .fx-chasing-squares *::after { box-sizing: border-box; }\n.fx-chasing-squares[data-paused="true"] *, .fx-chasing-squares[data-paused="true"] *::before, .fx-chasing-squares[data-paused="true"] *::after { animation-play-state: paused !important; }\n.fx-chasing-squares { display:grid; place-items:center; }\n.fx-chasing-squares .square-race { position:relative; width:95px; height:95px; }\n.fx-chasing-squares .square-race > span { position:absolute; width:18px; height:18px; border-radius:4px; background:var(--fx-accent); animation:fx-square-chase var(--fx-duration,3200ms) cubic-bezier(.65,0,.35,1) infinite; }\n.fx-chasing-squares .square-race > span:nth-child(2) { animation-delay:-800ms; opacity:.8; }\n.fx-chasing-squares .square-race > span:nth-child(3) { animation-delay:-1600ms; opacity:.6; }\n.fx-chasing-squares .square-race > span:nth-child(4) { animation-delay:-2400ms; opacity:.4; }\n@keyframes fx-square-chase { 0%,100% { transform:translate(0,0) rotate(0deg); } 25% { transform:translate(75px,0) rotate(90deg); } 50% { transform:translate(75px,75px) rotate(180deg); } 75% { transform:translate(0,75px) rotate(270deg); } }\n.fx-chasing-squares { width:100%; max-width:none; height:100%; min-height:100%; }\n.fx-chasing-squares[data-paused="true"], .fx-chasing-squares[data-paused="true"] *, .fx-chasing-squares[data-paused="true"] *::before, .fx-chasing-squares[data-paused="true"] *::after { animation-play-state:paused !important; }\n@media (prefers-reduced-motion:reduce) { .fx-chasing-squares, .fx-chasing-squares *, .fx-chasing-squares *::before, .fx-chasing-squares *::after { animation:none !important; transition:none !important; } }',
      durationMs: 3200,
      behavior: 'loader'
    }
  },
  {
    runtimeRevision: 'effect-pick-css-v1',
    id: 'cube-fold-loader',
    title: '方块折叠加载',
    description: '四块面片依次翻折，接成循环加载节奏。',
    category: '加载',
    tags: ['CSS', '加载', '3D'],
    collectionVersion: '0.6.0',
    artifactDigest: '609a6a7428940d87c1570004c07d9418bc2b52481cecd2d89627170de2b17cb3',
    source: {
      url: 'https://codepen.io/aaroniker/pen/zYOewEP',
      author: 'aaroniker',
      authorName: 'aaroniker',
      mode: 'reference',
      license: 'UNLICENSED',
      licenseStatus: 'not-reviewed',
      note: 'Chrome 中发现的视觉参考。当前组件为相关运动或交互思路的独立扩展实现，不声称逐像素还原原作；具体实现与提取边界见下方说明。'
    },
    sourceSha256: {
      coreJs: 'f5183c5265161ceb97caaa08a7d4fccc6520a1aa7e9d9c349446e7d317130238',
      coreCss: 'af46f2d2c8f4db1fe3f428d409132198cefdbd8de883f1cbf85a0c7578538ccd',
      metadata: 'd91a808b121b5ea10570880ce48f096d13226097e3220926f4dc18831c4c488d',
      sharedUtils: '1652ebaca26a641065de146768b735b4d9b52d3ddd7d9152386fd7a0d9d3f0ac'
    },
    defaultConfig: {
      effectId: 'cube-fold-loader',
      collectionVersion: '0.6.0',
      artifactDigest: '609a6a7428940d87c1570004c07d9418bc2b52481cecd2d89627170de2b17cb3',
      text: '方块折叠加载',
      color: '#a7f3d0',
      secondaryColor: '#101821',
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
        '<div class="fold-cube" aria-hidden="true"><span></span><span></span><span></span><span></span></div>',
      css: '.fx-cube-fold-loader { --fx-accent: #a7f3d0; --fx-speed: 1; position: relative; isolation: isolate; display: block; width: 100%; min-width: 0; max-width: 100%; height: 280px; overflow: hidden; border-radius: 14px; box-sizing: border-box; background: var(--fx-bg, #111b23); color: var(--fx-accent, #a7f3d0); font-family: Arial, "PingFang SC", sans-serif; }\n.fx-cube-fold-loader *, .fx-cube-fold-loader *::before, .fx-cube-fold-loader *::after { box-sizing: border-box; }\n.fx-cube-fold-loader[data-paused="true"] *, .fx-cube-fold-loader[data-paused="true"] *::before, .fx-cube-fold-loader[data-paused="true"] *::after { animation-play-state: paused !important; }\n.fx-cube-fold-loader { display:grid; place-items:center; }\n.fx-cube-fold-loader .fold-cube { position:relative; width:80px; height:80px; transform:rotate(45deg); perspective:160px; }\n.fx-cube-fold-loader .fold-cube > span { position:absolute; width:38px; height:38px; background:var(--fx-accent); transform-origin:100% 100%; animation:fx-cube-fold var(--fx-duration,3000ms) linear infinite; }\n.fx-cube-fold-loader .fold-cube > span:nth-child(1) { left:0; top:0; }\n.fx-cube-fold-loader .fold-cube > span:nth-child(2) { left:42px; top:0; transform-origin:0 100%; animation-delay:-2250ms; }\n.fx-cube-fold-loader .fold-cube > span:nth-child(3) { left:42px; top:42px; transform-origin:0 0; animation-delay:-1500ms; }\n.fx-cube-fold-loader .fold-cube > span:nth-child(4) { left:0; top:42px; transform-origin:100% 0; animation-delay:-750ms; }\n@keyframes fx-cube-fold { 0%,10%,90%,100% { transform:rotateX(0deg) rotateY(0deg); opacity:1; } 35%,65% { transform:rotateX(-90deg) rotateY(90deg); opacity:.2; } }\n.fx-cube-fold-loader { width:100%; max-width:none; height:100%; min-height:100%; }\n.fx-cube-fold-loader[data-paused="true"], .fx-cube-fold-loader[data-paused="true"] *, .fx-cube-fold-loader[data-paused="true"] *::before, .fx-cube-fold-loader[data-paused="true"] *::after { animation-play-state:paused !important; }\n@media (prefers-reduced-motion:reduce) { .fx-cube-fold-loader, .fx-cube-fold-loader *, .fx-cube-fold-loader *::before, .fx-cube-fold-loader *::after { animation:none !important; transition:none !important; } }',
      durationMs: 3000,
      behavior: 'loader'
    }
  },
  {
    runtimeRevision: 'effect-pick-css-v1',
    id: 'neon-sign',
    title: '霓虹灯管闪烁',
    description: '文字在微弱灯管与明亮辉光之间轻微闪烁。',
    category: '文字',
    tags: ['文字', 'CSS', '光效'],
    collectionVersion: '0.6.0',
    artifactDigest: '020c60218c4b677db581385968fe6d3990783cdb6b251f06ceecb71aae1281db',
    source: {
      url: 'https://codepen.io/juanbrujo/pen/DBKxxM',
      author: 'juanbrujo',
      authorName: 'juanbrujo',
      mode: 'reference',
      license: 'UNLICENSED',
      licenseStatus: 'not-reviewed',
      note: 'Chrome 中发现的视觉参考。当前组件为相关运动或交互思路的独立扩展实现，不声称逐像素还原原作；具体实现与提取边界见下方说明。'
    },
    sourceSha256: {
      coreJs: '01abd84af49d07303618460a7af8bdc012b3d0e7ce29907d19117b0a369a960b',
      coreCss: 'c167900b87eb1578bda0ade4c27e98ec3fbca96ab98eb482e163024d77b59145',
      metadata: '82025958f7bfbb78d5bd05da7ed2eb77951ff6d73ae4ba75f8624d27fd68b7c5',
      sharedUtils: '1652ebaca26a641065de146768b735b4d9b52d3ddd7d9152386fd7a0d9d3f0ac'
    },
    defaultConfig: {
      effectId: 'neon-sign',
      collectionVersion: '0.6.0',
      artifactDigest: '020c60218c4b677db581385968fe6d3990783cdb6b251f06ceecb71aae1281db',
      text: 'OPEN LATE',
      color: '#c4b5fd',
      secondaryColor: '#101821',
      speed: 1
    },
    defaultSize: {
      width: 400,
      height: 240
    },
    events: [],
    editableFields: ['text', 'color', 'secondaryColor', 'speed'],
    artifact: {
      markup: '<span class="neon-word">__EP_TEXT__</span>',
      css: '.fx-neon-sign { --fx-accent: #c4b5fd; --fx-text: #eaf3f7; --fx-speed: 1; position: relative; display: grid; place-items: center; box-sizing: border-box; min-width: 0; max-width: 100%; width: min(100%, 680px); min-height: 240px; padding: 28px; border-radius: var(--fx-radius, 16px); overflow: hidden; background: var(--fx-bg, #101821); color: var(--fx-text); font-family: inherit; }\n.fx-neon-sign *, .fx-neon-sign *::before, .fx-neon-sign *::after { box-sizing: border-box; }\n\n.fx-neon-sign .neon-word { display:block; max-width:100%; overflow-wrap:anywhere; color:var(--fx-accent); font-size:clamp(30px,7vw,74px); font-weight:300; letter-spacing:.12em; text-align:center; text-shadow:0 0 2px #fff,0 0 12px var(--fx-accent),0 0 32px var(--fx-accent); animation:fx-neon-sign-flicker var(--fx-duration,4300ms) linear infinite; }\n@keyframes fx-neon-sign-flicker { 0%,17%,19%,51%,53%,100% { opacity:1; filter:brightness(1.15); } 18%,52% { opacity:.3; filter:brightness(.6); } 77% { opacity:.88; filter:brightness(.95); } }\n\n.fx-neon-sign[data-paused="true"], .fx-neon-sign[data-paused="true"] *, .fx-neon-sign[data-paused="true"] *::before, .fx-neon-sign[data-paused="true"] *::after { animation-play-state: paused !important; }\n@media(prefers-reduced-motion: reduce) { .fx-neon-sign * { transition-duration: .01ms !important; } }\n.fx-neon-sign { width:100%; max-width:none; height:100%; min-height:100%; }\n.fx-neon-sign[data-paused="true"], .fx-neon-sign[data-paused="true"] *, .fx-neon-sign[data-paused="true"] *::before, .fx-neon-sign[data-paused="true"] *::after { animation-play-state:paused !important; }\n@media (prefers-reduced-motion:reduce) { .fx-neon-sign, .fx-neon-sign *, .fx-neon-sign *::before, .fx-neon-sign *::after { animation:none !important; transition:none !important; } }',
      durationMs: 4300,
      behavior: 'text'
    }
  },
  {
    runtimeRevision: 'effect-pick-css-v1',
    id: 'striped-text',
    title: '流动条纹文字',
    description: '条纹渐变沿字形持续移动。',
    category: '文字',
    tags: ['CSS', '文字', '循环'],
    collectionVersion: '0.6.0',
    artifactDigest: '3443219f12c41cf4bc30afa67ae72b5622dbad77fb2b26e99d9fe5a234c83d6c',
    source: {
      url: 'https://codepen.io/zitrusfrisch/pen/DbwjOR',
      author: 'zitrusfrisch',
      authorName: 'Daniel Riemer',
      mode: 'reference',
      license: 'UNLICENSED',
      licenseStatus: 'not-reviewed',
      note: 'Local reimplementation of the referenced visual mechanism; original distribution license is not recorded.'
    },
    sourceSha256: {
      coreJs: '1063c915993abd4346925d9ee2d9b9d19bf4fd1e5041538424d01a19bb80f8a2',
      coreCss: '8c1beca7226c071970b2a6d68ab2d21d7d56b1aa062df9ece67e6927363590bb',
      metadata: 'eff0f4e49b1124876ca6788ed4bbc15363932b9029b822b03a5ebb122eb75096',
      sharedUtils: '1652ebaca26a641065de146768b735b4d9b52d3ddd7d9152386fd7a0d9d3f0ac'
    },
    defaultConfig: {
      effectId: 'striped-text',
      collectionVersion: '0.6.0',
      artifactDigest: '3443219f12c41cf4bc30afa67ae72b5622dbad77fb2b26e99d9fe5a234c83d6c',
      text: 'FLOW',
      color: '#a7f3d0',
      secondaryColor: '#101821',
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
        '<span class="stripe-word">__EP_TEXT__</span><span class="stripe-caption">COLOR IN MOTION</span>',
      css: '.fx-striped-text { --fx-accent: #a7f3d0; --fx-duration: 4200ms; position: relative; max-width: 100%; width: min(100%, 540px); text-align: center; padding: 24px 10px; box-sizing: border-box; font-family: Arial, "PingFang SC", sans-serif; }\n.fx-striped-text .stripe-word { display: block; font-size: clamp(52px, 11vw, 120px); font-weight: 900; line-height: 1.1; letter-spacing: -.075em; overflow-wrap: anywhere; color: var(--fx-accent, #a7f3d0); }\n.fx-striped-text .stripe-caption { display: block; font-size: 9px; color: #7f8c99; letter-spacing: .35em; margin-top: 19px; }\n@supports ((background-clip: text) or (-webkit-background-clip: text)) { .fx-striped-text .stripe-word { background-image: repeating-linear-gradient(135deg, var(--fx-accent, #a7f3d0) 0 14px, #f4f7ff 14px 28px, var(--fx-secondary, #6e8dd0) 28px 42px, #f4f7ff 42px 56px); background-size: 158.4px 158.4px; background-clip: text; -webkit-background-clip: text; color: transparent; -webkit-text-fill-color: transparent; animation: fx-stripe-slide var(--fx-duration, 4200ms) linear infinite; } }\n.fx-striped-text[data-paused="true"] * { animation-play-state: paused !important; }\n@keyframes fx-stripe-slide { to { background-position: 158.4px 0; } }\n@media(prefers-reduced-motion:reduce) { .fx-striped-text .stripe-word { animation: none; } }\n.fx-striped-text { width:100%; max-width:none; height:100%; min-height:100%; }\n.fx-striped-text[data-paused="true"], .fx-striped-text[data-paused="true"] *, .fx-striped-text[data-paused="true"] *::before, .fx-striped-text[data-paused="true"] *::after { animation-play-state:paused !important; }\n@media (prefers-reduced-motion:reduce) { .fx-striped-text, .fx-striped-text *, .fx-striped-text *::before, .fx-striped-text *::after { animation:none !important; transition:none !important; } }',
      durationMs: 4200,
      behavior: 'text'
    }
  },
  {
    runtimeRevision: 'effect-pick-css-v1',
    id: 'text-shine',
    title: '文字斜向扫光',
    description: '一条窄亮带沿文字表面横向扫过，形成抛光反射。',
    category: '文字',
    tags: ['文字', 'CSS', '光效'],
    collectionVersion: '0.6.0',
    artifactDigest: '5693e07c72f6ce99fc501ef0f826e63fd199d012ae440ea4951d02596cfe456e',
    source: {
      url: 'https://codepen.io/Jintos/pen/OJKodm',
      author: 'Jintos',
      authorName: 'Jintos',
      mode: 'reference',
      license: 'UNLICENSED',
      licenseStatus: 'not-reviewed',
      note: 'Chrome 中发现的视觉参考。当前组件为相关运动或交互思路的独立扩展实现，不声称逐像素还原原作；具体实现与提取边界见下方说明。'
    },
    sourceSha256: {
      coreJs: '95452e357686e33d28430465896318cf934987b71e8b5db7d1bdcc900902c18e',
      coreCss: 'afd2856766c9e0d16c507e7c0480df76fd0ed870abcb7efa03d5242edad964e5',
      metadata: '9d1128ef8b5a2009db49622adde4d54ebadf55a19005803d9ef2f8d2dbbe05b6',
      sharedUtils: '1652ebaca26a641065de146768b735b4d9b52d3ddd7d9152386fd7a0d9d3f0ac'
    },
    defaultConfig: {
      effectId: 'text-shine',
      collectionVersion: '0.6.0',
      artifactDigest: '5693e07c72f6ce99fc501ef0f826e63fd199d012ae440ea4951d02596cfe456e',
      text: 'BRIGHT IDEAS',
      color: '#a7f3d0',
      secondaryColor: '#101821',
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
        '<div class="shine-word"><span>__EP_TEXT__</span><span aria-hidden="true">__EP_TEXT__</span></div>',
      css: '.fx-text-shine { --fx-accent: #a7f3d0; --fx-text: #eaf3f7; --fx-speed: 1; position: relative; display: grid; place-items: center; box-sizing: border-box; min-width: 0; max-width: 100%; width: min(100%, 680px); min-height: 240px; padding: 28px; border-radius: var(--fx-radius, 16px); overflow: hidden; background: var(--fx-bg, #101821); color: var(--fx-text); font-family: inherit; }\n.fx-text-shine *, .fx-text-shine *::before, .fx-text-shine *::after { box-sizing: border-box; }\n\n.fx-text-shine .shine-word { display:grid; max-width:100%; font-size:clamp(32px,7vw,74px); font-weight:800; line-height:1.3; overflow-wrap:anywhere; text-align:center; color:var(--fx-accent); }\n.fx-text-shine .shine-word span { grid-area:1/1; }\n.fx-text-shine .shine-word span:last-child { background:linear-gradient(110deg,transparent 35%,#fff 49%,transparent 63%) -200% 0/250% 100%; background-clip:text; -webkit-background-clip:text; color:transparent; animation:fx-text-shine-sweep var(--fx-duration,3300ms) ease-in-out infinite; }\n@keyframes fx-text-shine-sweep { 0%,15% { background-position:200% 0; } 70%,100% { background-position:-150% 0; } }\n\n.fx-text-shine[data-paused="true"], .fx-text-shine[data-paused="true"] *, .fx-text-shine[data-paused="true"] *::before, .fx-text-shine[data-paused="true"] *::after { animation-play-state: paused !important; }\n@media(prefers-reduced-motion: reduce) { .fx-text-shine * { transition-duration: .01ms !important; } }\n.fx-text-shine { width:100%; max-width:none; height:100%; min-height:100%; }\n.fx-text-shine[data-paused="true"], .fx-text-shine[data-paused="true"] *, .fx-text-shine[data-paused="true"] *::before, .fx-text-shine[data-paused="true"] *::after { animation-play-state:paused !important; }\n@media (prefers-reduced-motion:reduce) { .fx-text-shine, .fx-text-shine *, .fx-text-shine *::before, .fx-text-shine *::after { animation:none !important; transition:none !important; } }',
      durationMs: 3300,
      behavior: 'text'
    }
  },
  {
    runtimeRevision: 'effect-pick-css-v1',
    id: 'water-text',
    title: '波浪灌注文字',
    description: 'SVG 波浪在字形内缓缓升起。',
    category: '文字',
    tags: ['SVG', '文字', '循环'],
    collectionVersion: '0.6.0',
    artifactDigest: 'c1cd9d80fac12e527eb068b3f9d82c3c4cfb206c4d4cbe7eb14875ad46d261d9',
    source: {
      url: 'https://codepen.io/lbebber/pen/naarWa',
      author: 'lbebber',
      authorName: 'Lucas Bebber',
      mode: 'reference',
      license: 'UNLICENSED',
      licenseStatus: 'not-reviewed',
      note: 'Local reimplementation of the referenced visual mechanism; original distribution license is not recorded.'
    },
    sourceSha256: {
      coreJs: '72b7d209a408002d6575c50757e345ce6962c058904b512528ea450e5e1bea2f',
      coreCss: '198ca4947caf05c7aa93850360caf47055a1de38a5c4c920839edec484753b70',
      metadata: 'eb54bad8f4d2f021592d61d03de2c8d8a1553737809fe63c4f21d467382e8238',
      sharedUtils: '1652ebaca26a641065de146768b735b4d9b52d3ddd7d9152386fd7a0d9d3f0ac'
    },
    defaultConfig: {
      effectId: 'water-text',
      collectionVersion: '0.6.0',
      artifactDigest: 'c1cd9d80fac12e527eb068b3f9d82c3c4cfb206c4d4cbe7eb14875ad46d261d9',
      text: 'WAVE',
      color: '#a7f3d0',
      secondaryColor: '#101821',
      speed: 1
    },
    defaultSize: {
      width: 400,
      height: 240
    },
    events: [],
    editableFields: ['text', 'color', 'speed'],
    artifact: {
      markup:
        '<svg viewBox="0 0 600 180" role="img" aria-label="__EP_TEXT__" style="--water-font-size:__EP_WATER_FONT_SIZE__px"><defs><clipPath id="ep-water-__EP_INSTANCE__"><text class="water-glyph water-clip" x="300" y="132" text-anchor="middle">__EP_TEXT__</text></clipPath></defs><text class="water-glyph water-outline" x="300" y="132" text-anchor="middle" aria-hidden="true">__EP_TEXT__</text><g clip-path="url(#ep-water-__EP_INSTANCE__)"><rect x="0" y="0" width="600" height="180" fill="currentColor" opacity=".08"/><g class="water-level"><path class="water-wave water-wave-back" d="M -600 0 Q -525 -27 -450 0 T -300 0 T -150 0 T 0 0 T 150 0 T 300 0 T 450 0 T 600 0 T 750 0 T 900 0 L 900 260 L -600 260 Z"/><path class="water-wave water-wave-front" d="M -600 0 Q -525 -27 -450 0 T -300 0 T -150 0 T 0 0 T 150 0 T 300 0 T 450 0 T 600 0 T 750 0 T 900 0 L 900 260 L -600 260 Z"/></g></g></svg><span class="water-caption">LET YOUR IDEAS RISE</span>',
      css: '.fx-water-text { --fx-accent: #a7f3d0; --fx-duration: 5200ms; --water-y: 64px; --water-font-size: 142px; position: relative; width: min(100%, 560px); max-width: 100%; padding: 20px 8px; box-sizing: border-box; font-family: Arial, "PingFang SC", sans-serif; color: var(--fx-accent, #a7f3d0); text-align: center; }\n.fx-water-text > svg { display: block; width: 100%; height: auto; overflow: visible; }\n.fx-water-text .water-glyph { font-family: Arial, "PingFang SC", sans-serif; font-size: var(--water-font-size, 142px); font-weight: 900; letter-spacing: -.065em; }\n.fx-water-text .water-outline { fill: none; stroke: currentColor; stroke-width: 1; opacity: .6; }\n.fx-water-text .water-level { animation: fx-water-rise var(--fx-duration, 5200ms) ease-in-out infinite alternate; }\n.fx-water-text .water-wave { fill: currentColor; animation: fx-water-flow 3s linear infinite; }\n.fx-water-text .water-wave-back { opacity: .35; transform: translateY(-8px); animation-duration: 4.5s; animation-direction: reverse; }\n.fx-water-text .water-wave-front { opacity: .92; }\n.fx-water-text .water-caption { display: block; margin-top: 12px; font-size: 8px; letter-spacing: .35em; color: #7e8e9c; }\n.fx-water-text[data-paused="true"] * { animation-play-state: paused !important; }\n@keyframes fx-water-flow { from { transform: translateX(0); } to { transform: translateX(-300px); } }\n@keyframes fx-water-rise { from { transform: translateY(141px); } to { transform: translateY(var(--water-y, 64px)); } }\n@media(prefers-reduced-motion:reduce) { .fx-water-text .water-level { animation: none; transform: translateY(var(--water-y, 64px)); } .fx-water-text .water-wave { animation: none; } }\n.fx-water-text { width:100%; max-width:none; height:100%; min-height:100%; }\n.fx-water-text[data-paused="true"], .fx-water-text[data-paused="true"] *, .fx-water-text[data-paused="true"] *::before, .fx-water-text[data-paused="true"] *::after { animation-play-state:paused !important; }\n@media (prefers-reduced-motion:reduce) { .fx-water-text, .fx-water-text *, .fx-water-text *::before, .fx-water-text *::after { animation:none !important; transition:none !important; } }\n.fx-water-text { --water-y:64.36px; }',
      durationMs: 5200,
      behavior: 'water'
    }
  },
  {
    runtimeRevision: 'effect-pick-css-v1',
    id: 'orbit-eclipse',
    title: '轨道日蚀',
    description: '小卫星沿轨道运行，暗影同步掠过中心光球。',
    category: '加载',
    tags: ['CSS', '加载', '循环'],
    collectionVersion: '0.6.0',
    artifactDigest: '74a0ff2b87e99b922b659b47399dec04dc2af49a891192ddb56dfc61b1f4d7d7',
    source: {
      url: 'https://codepen.io/iamrubberducky/pen/XNjQBR',
      author: 'iamrubberducky',
      authorName: 'iamrubberducky',
      mode: 'reference',
      license: 'UNLICENSED',
      licenseStatus: 'not-reviewed',
      note: 'Chrome 中发现的视觉参考。当前组件为相关运动或交互思路的独立扩展实现，不声称逐像素还原原作；具体实现与提取边界见下方说明。'
    },
    sourceSha256: {
      coreJs: '3db0c123b0905eda8f0a86cfff6f37cb52bf61e05182b4a6ff742f5daccd548f',
      coreCss: '8f492b4d2797335c3bcb593d034a958990de3d8e1d2d5a0ed41b84f4ec9ff6c7',
      metadata: '48356298b12b83ac95adf7702a6349fbaad5275ce7b389af011afe36a5ceb25a',
      sharedUtils: '1652ebaca26a641065de146768b735b4d9b52d3ddd7d9152386fd7a0d9d3f0ac'
    },
    defaultConfig: {
      effectId: 'orbit-eclipse',
      collectionVersion: '0.6.0',
      artifactDigest: '74a0ff2b87e99b922b659b47399dec04dc2af49a891192ddb56dfc61b1f4d7d7',
      text: '轨道日蚀',
      color: '#a7f3d0',
      secondaryColor: '#101821',
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
        '<div class="eclipse-system" aria-hidden="true"><div class="eclipse-orbit"><span></span></div><div class="eclipse-sun"><span class="eclipse-shadow"></span></div></div>',
      css: '.fx-orbit-eclipse { --fx-accent: #a7f3d0; --fx-speed: 1; position: relative; isolation: isolate; display: block; width: 100%; min-width: 0; max-width: 100%; height: 280px; overflow: hidden; border-radius: 14px; box-sizing: border-box; background: var(--fx-bg, #111b23); color: var(--fx-accent, #a7f3d0); font-family: Arial, "PingFang SC", sans-serif; }\n.fx-orbit-eclipse *, .fx-orbit-eclipse *::before, .fx-orbit-eclipse *::after { box-sizing: border-box; }\n.fx-orbit-eclipse[data-paused="true"] *, .fx-orbit-eclipse[data-paused="true"] *::before, .fx-orbit-eclipse[data-paused="true"] *::after { animation-play-state: paused !important; }\n.fx-orbit-eclipse { display:grid; place-items:center; }\n.fx-orbit-eclipse .eclipse-system { position:relative; width:190px; height:190px; }\n.fx-orbit-eclipse .eclipse-orbit { position:absolute; inset:6px; border:1px solid #a7f3d033; border-radius:50%; animation:fx-eclipse-orbit var(--fx-duration,5000ms) linear infinite; }\n.fx-orbit-eclipse .eclipse-orbit > span { position:absolute; top:calc(50% - 6px); left:-6px; width:12px; height:12px; border-radius:50%; background:#c6d4e6; box-shadow:0 0 10px #c6d4e688; }\n.fx-orbit-eclipse .eclipse-sun { position:absolute; left:50%; top:50%; width:70px; height:70px; margin:-35px; border-radius:50%; background:radial-gradient(circle at 35% 30%,#eefff2,var(--fx-accent)); overflow:hidden; box-shadow:0 0 30px #a7f3d044; }\n.fx-orbit-eclipse .eclipse-shadow { position:absolute; inset:0; border-radius:50%; background:var(--fx-bg, #111b23); animation:fx-eclipse-shadow var(--fx-duration,5000ms) linear infinite; }\n@keyframes fx-eclipse-orbit { to { transform:rotate(360deg); } }\n@keyframes fx-eclipse-shadow { 0%,100% { transform:translateX(-90px); } 50% { transform:translateX(90px); } }\n.fx-orbit-eclipse { width:100%; max-width:none; height:100%; min-height:100%; }\n.fx-orbit-eclipse[data-paused="true"], .fx-orbit-eclipse[data-paused="true"] *, .fx-orbit-eclipse[data-paused="true"] *::before, .fx-orbit-eclipse[data-paused="true"] *::after { animation-play-state:paused !important; }\n@media (prefers-reduced-motion:reduce) { .fx-orbit-eclipse, .fx-orbit-eclipse *, .fx-orbit-eclipse *::before, .fx-orbit-eclipse *::after { animation:none !important; transition:none !important; } }',
      durationMs: 5000,
      behavior: 'loader'
    }
  },
  {
    runtimeRevision: 'effect-pick-css-v1',
    id: 'hourglass-sand',
    title: '沙漏流沙',
    description: '上层沙面逐渐消退，下层堆积后翻转重来。',
    category: '加载',
    tags: ['SVG', '加载', '循环'],
    collectionVersion: '0.6.0',
    artifactDigest: '5dcd51e05d24da6788c17df96d68a0550d10ce2b0351a2fb9eac141edced6a54',
    source: {
      url: 'https://codepen.io/nikhil8krishnan/pen/rVoXJa',
      author: 'nikhil8krishnan',
      authorName: 'nikhil8krishnan',
      mode: 'reference',
      license: 'UNLICENSED',
      licenseStatus: 'not-reviewed',
      note: 'Chrome 中发现的视觉参考。当前组件为相关运动或交互思路的独立扩展实现，不声称逐像素还原原作；具体实现与提取边界见下方说明。'
    },
    sourceSha256: {
      coreJs: '8ea15f73af66ee5090166e522e10f655088406fcbdcc9cadc23abfa1b33cdcb9',
      coreCss: '866af6f61d927ab029b70c7a44ee3e9eabfaf44bd78efe73c910fd38abea1460',
      metadata: 'e2a6e814f30a4c11ad1425628ead156e16ab2bbc74778acdc1de0da7a720e794',
      sharedUtils: '1652ebaca26a641065de146768b735b4d9b52d3ddd7d9152386fd7a0d9d3f0ac'
    },
    defaultConfig: {
      effectId: 'hourglass-sand',
      collectionVersion: '0.6.0',
      artifactDigest: '5dcd51e05d24da6788c17df96d68a0550d10ce2b0351a2fb9eac141edced6a54',
      text: '沙漏流沙',
      color: '#a7f3d0',
      secondaryColor: '#101821',
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
        '<svg class="hourglass" viewBox="0 0 160 180" aria-hidden="true"><path class="hourglass-frame" d="M26 15H134M26 165H134M34 17Q34 53 80 88Q34 120 34 163M126 17Q126 53 80 88Q126 120 126 163"/><path class="sand-top" d="M40 25H120L80 82Z"/><path class="sand-bottom" d="M39 155L80 105L121 155Z"/><path class="sand-stream" d="M80 85V148"/></svg>',
      css: '.fx-hourglass-sand { --fx-accent: #a7f3d0; --fx-speed: 1; position: relative; isolation: isolate; display: block; width: 100%; min-width: 0; max-width: 100%; height: 280px; overflow: hidden; border-radius: 14px; box-sizing: border-box; background: var(--fx-bg, #111b23); color: var(--fx-accent, #a7f3d0); font-family: Arial, "PingFang SC", sans-serif; }\n.fx-hourglass-sand *, .fx-hourglass-sand *::before, .fx-hourglass-sand *::after { box-sizing: border-box; }\n.fx-hourglass-sand[data-paused="true"] *, .fx-hourglass-sand[data-paused="true"] *::before, .fx-hourglass-sand[data-paused="true"] *::after { animation-play-state: paused !important; }\n.fx-hourglass-sand { display:grid; place-items:center; }\n.fx-hourglass-sand .hourglass { width:130px; height:170px; overflow:visible; animation:fx-hourglass-turn var(--fx-duration,6000ms) ease-in-out infinite; }\n.fx-hourglass-sand .hourglass-frame { fill:none; stroke:#a8b9c2; stroke-width:5; stroke-linecap:round; }\n.fx-hourglass-sand .sand-top,.fx-hourglass-sand .sand-bottom { fill:var(--fx-accent); }\n.fx-hourglass-sand .sand-top { transform-origin:80px 25px; animation:fx-sand-empty var(--fx-duration,6000ms) linear infinite; }\n.fx-hourglass-sand .sand-bottom { transform-origin:80px 155px; animation:fx-sand-fill var(--fx-duration,6000ms) linear infinite; }\n.fx-hourglass-sand .sand-stream { fill:none; stroke:var(--fx-accent); stroke-width:2; stroke-dasharray:3 3; animation:fx-sand-stream 350ms linear infinite; }\n@keyframes fx-hourglass-turn { 0%,82% { transform:rotate(0deg); } 100% { transform:rotate(180deg); } }\n@keyframes fx-sand-empty { 0% { transform:scaleY(1); } 78%,100% { transform:scaleY(.02); } }\n@keyframes fx-sand-fill { 0% { transform:scaleY(.02); } 78%,100% { transform:scaleY(1); } }\n@keyframes fx-sand-stream { to { stroke-dashoffset:-6; } }\n.fx-hourglass-sand { width:100%; max-width:none; height:100%; min-height:100%; }\n.fx-hourglass-sand[data-paused="true"], .fx-hourglass-sand[data-paused="true"] *, .fx-hourglass-sand[data-paused="true"] *::before, .fx-hourglass-sand[data-paused="true"] *::after { animation-play-state:paused !important; }\n@media (prefers-reduced-motion:reduce) { .fx-hourglass-sand, .fx-hourglass-sand *, .fx-hourglass-sand *::before, .fx-hourglass-sand *::after { animation:none !important; transition:none !important; } }',
      durationMs: 6000,
      behavior: 'loader'
    }
  }
]
