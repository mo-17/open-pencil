# .fig 保存/重开 布局错位 — Bug 查找结果

> **来源**: Workflow `wf_5ac58cba-539`，6 个 Sonnet 4.6 finder 并行勘察。
> **状态**: ⚠️ Opus 4.8 验证阶段**未完成**(workflow 在 verify 阶段 paused，token 紧张挂起)。
> 下面是 **Sonnet 的查找结果，尚未经 Opus 验证/复核**。共浮现 **5 个不同的 round-trip bug**(其中 `counterAxisAlignContent` 被两个 finder 独立命中)。
> Git HEAD: `419e731` (lowcode-phase-0)。

## 现象
编辑器存 `.fig` → 重开 → **画布布局变**，但 **lowcode preview 不变**。
共同机制:某布局字段 **serialize(存) 与 deserialize(读) 不对称** → 画布的 Yoga 布局引擎用这个字段、重开后拿到错值就重排；而 lowcode 编译器只读存活的字段(绝对 x/y/w/h、padding、flex 等),所以 preview 不受影响。

---

## 候选 1 — `primaryAxisSizing`/`counterAxisSizing` 的 `FILL` 被存成 `FIXED` 【high】
- **存**: `kiwi/node-change/serialize.ts:300-301` —
  `nc.stackPrimarySizing = node.primaryAxisSizing === 'HUG' ? 'RESIZE_TO_FIT' : 'FIXED'`(counter 同)。三元只把 `HUG` 映射走,**`FILL` 落到 `FIXED`**。
- **读**: `kiwi/node-change/convert.ts:119-128` `mapStackSizing` 有 `'FILL'→'FILL'` 分支,但 Kiwi `StackSize` 枚举(`binary/schema.ts:341-344`)**根本没有 FILL**(只有 FIXED/RESIZE_TO_FIT/...),所以读回来永远是 FIXED。
- **效果**: 内存里 `FILL` 的轴,round-trip 后变 `FIXED` → 画布尺寸/排布变。
- **类型**: `scene-graph/types.ts:190` `LayoutSizing = 'FIXED'|'HUG'|'FILL'`(FILL 是合法值)。
- **why preview 不变**: 编译器 `io/formats/jsx/tailwind-classes.ts:66-69` / `export.ts:74-78` 编译期从内存 graph 读 FILL → 出 `w-full`/`100%`;部署产物是存前编译的,仍是 FILL。
- **修复方向**: Kiwi 二进制枚举无 FILL → 不能改 vendored schema;需走 pluginData(像 FREE 那样)持久化 FILL,或另寻 kiwi 字段。**非一行**。

## 候选 2 — `strokesIncludedInLayout` 存读**字段名不一致**(读错字段)【high · 一行可修】
- **存**: `serialize.ts:306` `nc.bordersTakeSpace = node.strokesIncludedInLayout`(写的是 schema 真字段 `bordersTakeSpace`,`schema.ts:1500`,正确)。
- **读**: `convert.ts:403` `strokesIncludedInLayout: (nc.strokesIncludedInLayout ?? false)` —— **`nc.strokesIncludedInLayout` 这个字段在 Kiwi schema 里不存在**(grep 0 命中),解码后恒 `undefined` → `?? false` 永远触发 → 每次 load 都被重置成 `false`。
- **效果**: 任何 `strokesIncludedInLayout: true` 的 frame,重开后变 `false` → Yoga 边框占位变化 → 画布重排。
- **现有测试盲区**: `serialize-fixes/borders/take-space.test.ts` 只验写方向;`integration.test.ts` 没断言重导入后的 `strokesIncludedInLayout`。
- **修复方向(明确)**: `convert.ts:403` 改读 `nc.bordersTakeSpace ?? false`。**一行**。

## 候选 3 — `GRID` layoutMode + 5 个 grid 字段**完全不序列化**【high】
- **存**: `serialize.ts:287-313` 只在 HORIZONTAL/VERTICAL 写 `stackMode`;GRID 明确跳过(注释 line 291)。`lowcode-plugin-data.ts:91-119` 的 `LOWCODE_PLUGIN_KEYS` **没有 grid 键** → `gridTemplateColumns/gridTemplateRows/gridColumnGap/gridRowGap/gridPosition` 既不进 kiwi 字段也不进 pluginData。(对比:FREE layout 有 `lowcode/freeLayout` pluginData 持久化。)
- **读**: `convert.ts:108-116` `mapStackMode(undefined)→'NONE'`;5 个 grid 字段在整条 kiwi→SceneNode 路径上缺席 → 回落默认 `[],[],0,0,null`。有 `freeLayoutOverride`(convert.ts:489)恢复 FREE,但**无 gridLayoutOverride**。
- **效果**: GRID 容器重开后退化成 NONE,子节点重排(`layout/grid.ts` 靠这些字段定位)。
- **修复方向**: 仿 FREE,给 GRID 加 pluginData 持久化 + override 恢复路径。**中等**。

## 候选 4 — `counterAxisAlignContent` **从不序列化**【high · 两个 finder 独立命中】
- **存**: `serialize.ts:287-313` **从未写** `nc.stackCounterAlignContent`(grep 0 命中);该字段名在 `binary/schema.ts` 也不存在(只有 stackCounterAlign/AlignItems/Spacing/stackWrap)。
- **读**: `convert.ts:400-401` `(nc.stackCounterAlignContent as string) === 'SPACE_BETWEEN' ? 'SPACE_BETWEEN' : 'AUTO'` → 恒 `undefined` → 恒 `'AUTO'`。
- **效果**: `layoutWrap:'WRAP' + counterAxisAlignContent:'SPACE_BETWEEN'` 的 frame 重开变 `'AUTO'` → `layout.ts:139-141` Yoga `setAlignContent` 变化,换行行位移。
  实测佐证: `tests/engine/layout/auto-layout/counter-axis/align-content.test.ts` — 200×300 WRAP + 3×(120×40) 子,SPACE_BETWEEN 时 y=0/130/260,AUTO 时 y=0/40/80(末子差 90px)。`editor/pages.ts:33` switchPage 触发 `computeAllLayouts` 重排。
- **why preview 不变**: 编译器(`ir/style.ts`/`tailwind-classes.ts`)0 引用 `counterAxisAlignContent`,只读存活的绝对 x/y(kiwi transform.m02/m12)+ w/h。
- **修复方向**: schema 无该字段 → 走 pluginData 持久化(或确认是否该并入既有 align 字段)。**中等**。

## 候选 5 — auto-layout 子节点 `figmaDerivedLayout.x/y` 的 `?? ` vs `0` nullish bug【high】
- **存**: `serialize.ts:373-412` `computeExportTransform` 对 auto-layout 子(父 H/V 且非 ABSOLUTE)**故意把 m02=0,m12=0**(Figma 兼容:位置由布局引擎算)。w/h 存活在 `nc.size`。`figmaDerivedLayout` 本身不序列化。
- **读**: `convert.ts:332-352` `visibleContainerDerivedLayout` 用 `{x: nc.transform?.m02 ?? 0, y: nc.transform?.m12 ?? 0, ...}` 重建 figmaDerivedLayout → 因存的是 (0,0),恒得 `{x:0,y:0,...}`。
- **效果**: `layout/apply.ts:39-40` `x: derived?.x ?? computedLeft` —— **`0 ?? computedLeft === 0`**(nullish 不对 0 回落)→ 子节点被钉在 0,而非 Yoga 计算位置。
- **why preview 不变**: 编译器对 inline flex 子**不发 absolute/left/top**,位置靠父 flex(gap/padding/justify/align,这些存活)→ node.x/y=0 不影响输出。画布直接读 node.x/y → 钉在 0。
- **修复方向**: `apply.ts` 用 `derived?.x` 存在性判断而非 `?? 0`;或重建 derivedLayout 时不把 0 当有效位置。**小**。

---

## 小结 / 下一步
| # | 候选 | 置信 | 修复量 | 备注 |
|---|---|---|---|---|
| 2 | strokesIncludedInLayout 读错字段名 | high | **一行** | 最干脆,`convert.ts:403` 读 `bordersTakeSpace` |
| 5 | figmaDerivedLayout 0-nullish | high | 小 | auto-layout 子钉 0,影响面大 |
| 4 | counterAxisAlignContent 不序列化 | high | 中 | 两 finder 命中;WRAP+SPACE_BETWEEN |
| 1 | FILL sizing 存成 FIXED | high | 中 | 需 pluginData |
| 3 | GRID 字段不序列化 | high | 中 | 仿 FREE override |

⚠️ **这些是 Sonnet 的查找结果，Opus 验证未跑完**。下个会话应:重跑 workflow(`Workflow({scriptPath: ".../find-fig-layout-roundtrip-bug-wf_5ac58cba-539.js"})`)让 Opus 收敛/复核出**用户实际撞到的那个**(可能不止一个),逐个 probe 往返坐实,再按 worktree 流程修+测+合并。**哪个是你实际遇到的?** 取决于你的设计用的是 FILL 尺寸 / GRID / WRAP+SPACE_BETWEEN / auto-layout HUG 子 / 边框占位 —— 可据此优先。
