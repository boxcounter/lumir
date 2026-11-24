# Design: Skill 候选浮层恢复为不透底的浮层面

> 起草注记（非规格正文）：本 change 是渲染缺陷的合同先行修复
> （[rendering-defect-contract-first.md](../../../docs/process/rendering-defect-contract-first.md)）。
> 下面依次给：合同条款、不变量、根因、判据设计（含反例与仪器自证）、备选方案取舍、
> 风险与真机复验计划。

## 1. 合同条款

- [ui-design-system 规格](../../specs/ui-design-system/spec.md)「设计 token 层」：
  **浮层壳 SHALL 为 `--preview-bg` + 1px `--border` + `--shadow-raise`**（eink 为白底 + 实心黑框、
  无阴影）；界面样式 SHALL 经 token 引用取值，MUST NOT 引用未登记的 token；旧的 `--bg` 一族
  MUST NOT 以别名形式保留。
- [design-tokens-v1.md](../../../docs/specs/design-tokens-v1.md) §使用规则 2：同一份浮层壳配方，
  `--preview-bg` 是 bg 层级最亮档，用来表达「浮层在内容之上」。

## 2. 不变量（本 change 的判据面）

对**任意**打开态的 Skill 候选浮层，在 light / dark / eink 三主题下：

- **I1（底色）**：`getComputedStyle(浮层).backgroundColor` 等于该主题 `--preview-bg` 的值
  （light `rgb(255,255,255)` / dark `rgb(38,39,43)` / eink `rgb(255,255,255)`），alpha = 1。
- **I2（不穿透）**：浮层可见面（圆角与 1px 边框之内）的像素，**与浮层背后画了什么无关**——把背后
  换成另一套高对比配色后，同一区域的截图必须逐字节不变。
- **I3（判据自身有区分度）**：把浮层背景强制改成 `transparent` 后，I2 的同一对比必须出现差异。

I1 钉住「用了哪一档 token」，I2 钉住「浮层在绘制结果上真的挡住了背后」，I3 钉住「I2 不是空转」。

## 3. 根因

`src/harness-panel.css` 的 `.lumir-hp-skill-menu` 声明 `background: var(--bg-raise, var(--bg))`：

- `--bg-raise` 全仓无定义；
- fallback `var(--bg)` 同样在全仓无定义（token v1 收敛时按「替换、不留别名」删除）；
- `var()` 的 fallback 只在「var 引用的自定义属性无效」时使用，而这里 fallback 本身也是无效引用，
  于是整条声明在 computed-value 阶段失效，`background-color` 取初始值 `transparent`。

即：不是「取错了档」，是「这一条声明从来没有产生过值」。周边浮层全部取 `--preview-bg`，
本处是遗漏替写。

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
退化成 `"" === ""` 的空转（REVIEW.md「读不到当成空」条的同族）。期望值取 tokens 文档登记的
三主题常量，写死在场景里。

## 5. 备选方案与取舍

- **补回 `--bg-raise` / `--bg` 别名**：直接违反 token 层「不留双名」纪律，且会把「错引用」变成
  「合法引用」，掩盖同类缺陷。否。
- **改用 `--content-bg` / `--agent-bg`**：两者是平铺表面档，不是浮层档；浮层要靠 `--preview-bg`
  与底层形成「最亮一档」的层级差。否。
- **只加计算值断言、不做像素判据**：能挡住「透明」，但挡不住「底色对了而叠了 `opacity` /
  `backdrop-filter` / 半透明覆盖层」这类同形态缺陷。像素判据是不变量本身，计算值是它的机制读数。
- **给整页基线加一个新截图**：浮层只在交互态出现，且整页容差（0.001 ≈ 960px）能吞掉整个小浮层的
  差异——见 REVIEW.md「容差吞掉真实变化」条。否。

## 6. 风险

- **探针层的插入点**依赖 `.lumir-hp-composer-area` 是浮层的定位包含块（现状如此：浮层是它的
  绝对定位子元素）。若将来浮层移出该容器，场景会在「探针不在浮层背后」处判红（I3 失败），提醒
  更新判据，而不是静默假绿。
- **像素判据对渲染抖动敏感**：同进程、同一次运行内的两张截图之间没有跨机器差异，`animations:
  disabled` 冻结动画；场景先做 `a ≡ a'` 的稳定性自证，抖动会以「仪器自证失败」直接暴露。

## 7. 真机复验计划（不在本 change 内执行）

本 change 的定义面在 chromium 像素层；WKWebView 的配色与合成路径不同，需真机确认一次：

- 主会话后续批次跑 [验收场景 726](../../../scripts/acceptance/scenarios/726-harness-skill-hybrid-invocation.md)
  （Skill 混合调用的真机路径），在候选打开的那一步留截图证据；
- 核对三主题下候选浮层不透底（浅色 / 深色 / eink 各一次；切主题走真实配置通道）；
- 本 worker 不启动真机实例，真机项在 tasks 里保持未勾选，由主会话完成。
