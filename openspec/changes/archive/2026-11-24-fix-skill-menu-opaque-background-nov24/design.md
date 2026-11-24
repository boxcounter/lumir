# Design: Skill 候选浮层恢复为不透底的浮层面（含 token 引用链静态防线）

> 起草注记（非规格正文）：本 change 是渲染缺陷的合同先行修复
> （[rendering-defect-contract-first.md](../../../../docs/process/rendering-defect-contract-first.md)）。
> 下面依次给：合同条款、不变量、根因与审计证据、判据设计（像素 + 静态防线）、备选方案取舍、
> 风险与真机复验计划。

## 1. 合同条款

- [ui-design-system 规格](../../../specs/ui-design-system/spec.md)「设计 token 层」：
  **浮层壳 SHALL 为 `--preview-bg` + 1px `--border` + `--shadow-raise`**（eink 为白底 + 实心黑框、
  无阴影）；界面样式 SHALL 经 token 引用取值，MUST NOT 引用未登记的 token；旧的 `--bg` 一族
  MUST NOT 以别名形式保留。
- [design-tokens-v1.md](../../../../docs/specs/design-tokens-v1.md) §使用规则 2：同一份浮层壳配方，
  `--preview-bg` 是 bg 层级最亮档，用来表达「浮层在内容之上」。

## 2. 不变量（本 change 的判据面）

对**任意**打开态的 Skill 候选浮层，在 light / dark / eink 三主题下：

- **I1（底色）**：`getComputedStyle(浮层).backgroundColor` 等于该主题 `--preview-bg` 的值
  （light `rgb(255,255,255)` / dark `rgb(38,39,43)` / eink `rgb(255,255,255)`），alpha = 1。
- **I2（不穿透）**：浮层可见面（圆角与 1px 边框之内）的像素，**与浮层背后画了什么无关**——把背后
  换成另一套高对比配色后，同一区域的截图必须逐字节不变。
- **I3（判据自身有区分度）**：把浮层背景强制改成 `transparent` 后，I2 的同一对比必须出现差异。

对**任意** `src/**/*.css` 里的 `var(--x, …)` 引用：

- **I4（引用有归宿）**：`--x` 要么在 CSS 文件集里有定义，要么在运行时赋值白名单里（且有真实
  赋值点），要么回退是一条**能解析到底**的链；主引用未定义时，回退里每个 `var()` 都必须落到
  前两类之一，否则整条声明在 computed-value 阶段失效。

I1 钉住「用了哪一档 token」，I2 钉住「浮层在绘制结果上真的挡住了背后」，I3 钉住「I2 不是空转」，
I4 钉住「这一类缺陷不再需要肉眼审计才能发现」。

## 3. 根因

### 3.1 浮层背景

`src/harness-panel.css` 的 `.lumir-hp-skill-menu` 声明 `background: var(--bg-raise, var(--bg))`：

- `--bg-raise` 全仓无定义；
- fallback `var(--bg)` 同样在全仓无定义（token v1 收敛时按「替换、不留别名」删除）；
- `var()` 的 fallback 只在「被引用的自定义属性无效」时使用，而这里 fallback 本身也是无效引用，
  于是整条声明在 computed-value 阶段失效，`background-color` 取初始值 `transparent`。

### 3.2 字色

同一批 Skill 样式里 `.lumir-hp-skill-name` 用 `color: var(--text-1)`：`--text-1` 从未登记
（现行字色档是 `--text` / `--text-2` / `--text-3`），声明失效后字色回落为继承值——观感上「碰巧
接近」，所以没有像背景那样被立刻看见，但它是同一类错引用。这一处也说明**计算值判据看不见它**：
失效后的继承值恰好来自 `--text`，修前修后的 `getComputedStyle` 读数相同；只有静态引用面判据
（§4.5）能区分「声明有效且指向 `--text`」与「声明失效、碰巧继承到同一个颜色」。

### 3.3 审计证据（2026-11-24）

- **Alex 的全量审计口径**：102 个 CSS token 使用点、7 个未定义引用；其中 4 个有运行时赋值或有效
  回退（`--lumir-hp-scale` / `--toc-depth` / `--cm-lp-table-columns` / `--border-strong`），
  3 个真实问题**全部落在 Skill 样式**（`--bg-raise`、`--bg`、`--text-1`）。结论是「局部一簇 +
  静态防线缺口」，不是全仓漂移。
- **本层的复核读数**（`css-token-references.test.ts` 的诊断行，可复跑）：5 个 CSS 文件、122 个
  token 定义、1737 条顶层 `var()` 引用、100 个被 CSS 引用的 token；未落地引用在修复前恰好 1 处
  （`src/harness-panel.css:2772 --text-1`），修复后 0 处。审计的 102 = 本层 100 个 CSS 引用 token
  加上 2 个只出现在 TS 内联样式里的 token（`--lp-list-body` / `--lp-list-marker`，见 §4.5 边界）。

## 4. 判据设计

### 4.1 为什么不能只断言 `z-index`

`z-index` 只说明堆叠顺序，不说明表面是否绘制。缺陷态的 `z-index: 40` 完全正确，浮层也确实在
最上层——问题在它自身透明。因此判据必须落在**绘制结果**：计算值（挡没挡）与像素（透没透）。

### 4.2 像素判据的形状

在 `.lumir-hp-composer-area` 内注入 test-only 的实底 + 大号文字层（`position:absolute; inset:0;
z-index:0`，低于浮层的 40；`pointer-events:none`），浮层的元素盒完全落在它里面：

1. 铺配色 A → 截图 `a`；同配色再截一张 `a'`，`a ≡ a'`（仪器自证：两次截图逐字节相同）。
2. 铺配色 B（每个像素都与 A 不同）→ 截图 `b`，断言 `a ≡ b`（I2）。
3. 强制浮层 `background: transparent !important` → 截图 `c`，断言 `b ≠ c`（I3）；
   撤掉强制后回到 `a`。

比较用截图字节的逐字节相等：同一渲染输入下逐字节相同即逐像素相同（同类先例见
`tests/visual/scenes/typography.spec.ts` 的「像素读数」与 `m454-composer-image-mention.spec.ts`
的「撤掉伪元素前后必须不同」）。截图一律带 `animations: "disabled"`，冻结光标闪烁。

### 4.3 只比浮层内部（圆角与边框之内）

浮层是 `border-radius: var(--r6)` + 1px `--border`。**圆角之外的四个角像素本来就不属于浮层可见面**；
dark 档的 `--border` 是 `rgba(255,255,255,.095)` 半透明，边框像素也会按设计露出底层。这两者都不
是「背景透底」。因此像素判据只裁剪浮层盒内缩 10px 的矩形（避开 r6 圆角半径与 1px 边框），不比较
元素盒的四角与边框。

### 4.4 计算值为什么写死期望值

不拿 `var(--preview-bg)` 与浮层的计算值互比：token 缺失时两侧会同时解析成 `transparent`，断言就
退化成「透明 == 透明」的空转（REVIEW.md「读不到当成空」条的同族）。期望值取 tokens 文档登记的
三主题常量，写死在场景里。

### 4.5 静态防线（I4）

判据落在 `tests/unit/css-token-references.test.ts`（零依赖，沿用 `tests/unit` 的 node:test +
类型剥离层）。

**扫描面**：`src/**/*.css` 全文（新 CSS 文件自动进入）。先剔除注释（保留行号），再收集
`--name:` 定义与每个 `var(` 调用。

**求值规则**（这是本判据与「只扫变量名」的分界）：

1. 引用 token 在定义集合里 ⇒ 合法（不管 fallback 写了什么——主引用已定义时 fallback 是死代码，
   不误报）。
2. token 在运行时白名单里 ⇒ 合法。
3. 否则必须有回退，且回退要**递归求值**：回退里的每个 `var()` 都按 1–3 解析；回退不含 `var()`
   时按字面量处理（非空即可）。任何一层解析失败 ⇒ 整条声明在 computed-value 阶段失效 ⇒ 判红。
   空回退（`var(--x,)`）同样判红（替换成空值对绝大多数属性等价于失效）。

`var(--bg-raise, var(--bg))` 因此判红（回退 `--bg` 也未定义），
`var(--border-strong, var(--border))` 判绿（回退落到已定义的 `--border`）。

**白名单双向核对**：`--lumir-hp-scale` / `--toc-depth` / `--cm-lp-table-columns` 逐条要求在
`src/**/*.ts` 里有真实赋值点（`setProperty("--x"` 或内联样式串里的 `--x:`），且被至少一条 CSS
引用引用；缺任一侧即红。白名单因此不能靠「加一个名字」放行未赋值的 token。

**边界（已知且有意）**：判据只看 CSS 文件里的 `var()` 文本与 TS 里的写入点，不做主题作用域 /
级联分析（`--sel-text` 这类只在 eink 块里定义的 token 视为「有定义」），也不扫 TS 内联样式里的
引用面（`src/preview/theme.ts` 的 CM theme 对象引用 `var(--lp-list-body)` 等，由 `lists.ts` 同源
写入 inline style）。后者的扩面需要同时把两个 inline 赋值 token 纳入白名单，超出本 change 的
收口范围；作为已知缺口写在 change 的非目标里。

**反向输入 / 反向排除**（区分度，逐条留在测试文件里）：判红——`--text-1` bare 引用、`--bg-raise/--bg`
回退链；判绿——`--border-strong/--border` 回退到已定义 token、字面量与多级回退、运行时 token、主引用
已定义时的死回退、注释里的 `var()`、跨文件定义。

## 5. 备选方案与取舍

- **补回 `--bg-raise` / `--bg` / `--text-1` 别名**：直接违反 token 层「不留双名」纪律，且会把
  「错引用」变成「合法引用」，掩盖同类缺陷。否。
- **字色改 `--text-2`**：Skill 名字是候选列表的主标识，`--text-2` 是次级文字档；现有其他候选名
  用 `--text`。取 `--text` 与层级语义一致；且 `--text-1` 失效时的继承值本就来自 `--text`，
  修复不改变观感。
- **只加计算值断言、不做像素判据**：能挡住「透明」，但挡不住「底色对了而叠了 `opacity` /
  `backdrop-filter` / 半透明覆盖层」这类同形态缺陷。像素判据是不变量本身，计算值是它的机制读数。
- **只做运行时 CSSOM 扫描、不做静态扫描**：CSSOM 看不到「声明已失效但恰好没呈现差异」的引用
  （`--text-1` 就是这种），也让新 CSS 文件必须被某个场景加载才进入判据面。静态扫描覆盖全文件集。
- **给整页基线加一个新截图**：浮层只在交互态出现，且整页容差（0.001 ≈ 960px）能吞掉整个小浮层
  的差异——见 REVIEW.md「容差吞掉真实变化」条。否。

## 6. 风险

- **探针层的插入点**依赖 `.lumir-hp-composer-area` 是浮层的定位包含块（现状如此：浮层是它的
  绝对定位子元素）。若将来浮层移出该容器，场景会在「探针不在浮层背后」处判红（I3 失败），提醒
  更新判据，而不是静默假绿。
- **像素判据对渲染抖动敏感**：同进程、同一次运行内的两张截图之间没有跨机器差异，`animations:
  disabled` 冻结动画；场景先做 `a ≡ a'` 的稳定性自证，抖动会以「仪器自证失败」直接暴露。
- **静态判据的误报面**：定义存在性判据会把「只在某主题块里定义」当成全局有定义（漏报方向），
  不会把合法引用判红（误报方向为零）；误报比漏报更伤，这里选漏报。
- **白名单腐化**：靠双向核对（赋值点 + 引用）挡住「加了名字没加赋值」，但挡不住「赋值点存在却
  在死代码里」——那属于代码可达性问题，不在静态文本判据的能力面内。

## 7. 真机复验计划（不在本 change 内执行）

本 change 的定义面在 chromium 像素层 + Node 静态层；WKWebView 的配色与合成路径不同，需真机确认
一次：

- 主会话后续批次跑 [验收场景 726](../../../../scripts/acceptance/scenarios/726-harness-skill-hybrid-invocation.md)
  （Skill 混合调用的真机路径），在候选打开的那一步留截图证据；
- 核对三主题下候选浮层不透底、候选名的字色与列表其余文字同档（浅色 / 深色 / eink 各一次；切主题
  走真实配置通道）；
- 本 worker 不启动真机实例，真机项在 tasks 里保持未勾选，由主会话完成。
