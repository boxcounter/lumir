# attachment-display Specification

## Purpose

定义 md 文档内附件图片的内联显示（ADR 0003 §1 兼容范围）：Obsidian 方言 `![[image.png]]` 与标准 `![alt](path)` 两种语法、路径解析口径（唯一匹配 + 歧义确定性）、失败占位人话提示；内容嵌入（transclusion）明确不做（ADR 0003 §2）。字节来源为 fs-io「二进制附件读取」。由 change `add-editor-live-preview` 归档并入（2026-09-05，实现 M19 + M20 接线；完整短路径语义留 wikilink spec 冻结裁决）。

## Requirements

### Requirement: 附件图片内联显示

md 文档中的图片引用 SHALL 在文档内对应位置内联渲染图片，覆盖两种语法（ADR 0003 §1）：Obsidian 方言
`![[image.png]]` 与标准 Markdown `![alt](path)`。图片字节来源 SHALL 为 add-vault-workspace 的 fs-io
「二进制附件读取」能力（跨 change 依赖，proposal 已显式声明）；webview MUST NOT 直接访问文件系统
（ADR 0002 §3）。附件读取的接口形态（invoke+base64 / asset protocol）以 add-vault-workspace 裁决点 A
的裁决为准，本 capability 对两种形态 SHALL 均可适配。

「可渲染的图片格式」集合 SHALL 以扩展名注册表（`src/preview/attachments.ts` 的 image 分类，含
`svg`）为唯一事实源，MUST NOT 出现第二份图片格式表；标准 Markdown 图片的渲染路径 MUST NOT 按扩展名
做准入判定或按格式分流——格式是否可渲染由渲染引擎决定，前端只负责「引擎给不出可见像素时有可见
回退」。SVG SHALL 与位图走**同一条**渲染路径（同一 `<img>` + `data:` URL 形态、同一路径解析、
同一占位口径），MUST NOT 为 `svg` 单立分支。内联渲染的终态 SHALL 可见：替换区最终没有可见图像
像素时按「图片引用的可见回退不变量」处置，MUST NOT 出现「分类已收录、渲染结果为不可见」的形态。

#### Scenario: 两种语法均渲染

- **WHEN** 文档同时含 `![[photo.png]]` 与 `![截图](./assets/shot.png)`，且两附件存在
- **THEN** 两张图片在文档内对应位置内联显示

#### Scenario: SVG 与位图经同一路径渲染

- **WHEN** 文档含 `![Hooks Overview](images/hooks-overview.en.svg)`，且该 svg 是带 `width`/`height`
  的正常矢量图
- **THEN** 该位置内联显示该 svg，且它走的是与同场景 `png` 引用完全相同的渲染路径（同一 `<img>` +
  `data:image/svg+xml;base64,…` 形态）；`EditorState.doc` 与磁盘文件逐字节不变

#### Scenario: 图片引用不因扩展名被前端拦下

- **WHEN** 文档含 `![x](a.psd)`、`![y](scan.heic)` 这类渲染引擎可能不支持的扩展
- **THEN** 前端不新增「格式白名单」判定、不产出「暂不支持」类文案；该引用照常交给 `<img>`，其终态
  按「图片引用的可见回退不变量」判定（能渲染则显示，不能渲染则可见占位）

### Requirement: 附件路径解析口径

标准 md 图片路径 SHALL 按相对当前文件路径解析（解析不到时允许回退相对 vault 根）。`![[...]]` 不带目录前缀时 SHALL 按 vault 内文件名唯一匹配解析（⚠ 裁决点 F，推荐口径）：全 vault 恰有一个同名附件时解析成功；存在同名歧义时按确定性顺序取第一个，MUST NOT 随机或按修改时间选择。完整 Obsidian 短路径语义 MUST NOT 在本 change 实现——属于 wikilink spec 冻结范围（ADR 0003 §4），由 wikilink change 统一裁决。

#### Scenario: 唯一匹配解析

- **WHEN** `![[photo.png]]` 且 vault 内仅 `attachments/photo.png` 一个同名文件
- **THEN** 图片解析到该路径并显示

#### Scenario: 同名歧义确定性

- **WHEN** vault 内两个目录各有一个 `photo.png`
- **THEN** 按确定性顺序（如路径字典序）取第一个显示；同一 vault 两次打开显示同一结果

### Requirement: 解析或读取失败的占位

附件不存在、路径解析失败、读取返回错误，**或字节读取成功但最终渲染不出可见像素**（解码失败 /
格式不被渲染引擎支持 / 渲染尺寸为零）时，系统 SHALL 在引用位置显示占位块与人话提示（含原始引用
文本），MUST NOT 显示破图图标、抛错弹窗或阻断文档其余渲染。

#### Scenario: 附件缺失占位

- **WHEN** `![[missing.png]]` 指向的附件不存在
- **THEN** 该位置显示占位块，提示附件未找到并保留原始引用文本

#### Scenario: 读取成功但渲染不可见时回落占位

- **WHEN** 引用指向的附件存在且字节读取成功，但渲染结果没有任何可见像素（例如 0 字节或损坏的位图、
  其格式渲染引擎无法解码、或引擎对该输入给出零尺寸渲染）
- **THEN** 该位置显示可见占位（含原始引用文本），MUST NOT 留下零高度空白、MUST NOT 让该行看起来
  什么也没有

注：**「只声明 viewBox、宽高为 auto 的 svg」不再是本场景的输入**（M182，2026-09-18）：这类「固有
尺寸不确定」的 svg 在替换区包含块宽度确定后按栏宽填充、渲染结果可见（见「图片显示宽度的时序无关性」
requirement 与 [docs/specs/image-reading.md](../../../docs/specs/image-reading.md) §1），不落入本条。
引擎在「固有尺寸声明为零」（`width="0"` + `viewBox`）这类形态上不一致（M178 实测：chromium 给自然
尺寸 0、WKWebView 给默认对象尺寸 300×100），两条路径都满足不变量（可见占位或可见图像），本场景的
判据是**终态可见**，不是某一条具体路径。

### Requirement: 内容嵌入不做

`![[note]]`、`![[note#heading]]` 等指向笔记内容的嵌入（transclusion）MUST NOT 实现递归渲染（ADR 0003 §2 明确不做）。`![[...]]` 解析结果指向非附件（笔记）时 SHALL 按「解析或读取失败的占位」口径显示原文与"内容嵌入不支持"提示。

#### Scenario: 笔记嵌入不渲染

- **WHEN** 文档含 `![[another-note]]`
- **THEN** 显示原文与"内容嵌入不支持"提示，不递归渲染该笔记

### Requirement: 图片引用的可见回退不变量

对任意被 live preview 识别为图片引用的源码片段——标准 Markdown `![alt](target)`、标准 Markdown 的
外部 `http(s)` 目标、Obsidian 方言 `![[target]]` 三种形态——只要替换区最终没有可见图像像素（成因
包括但不限于：读取失败、解码失败、格式不可渲染、渲染尺寸为零、外部目标被安全策略拦下），替换区
SHALL 呈现**可见**占位，占位 SHALL 含人话成因与**原始引用文本**（原始引用文本即含 alt 与路径，二者
MUST NOT 在占位里丢失）。替换区 MUST NOT 出现零高度空白；MUST NOT 让源码被替换后不留任何可见痕迹。
从源码被替换到终态之间 SHALL 始终有可见内容，MUST NOT 存在「有内容 → 空白 → 有内容」的空窗。
终态判据 SHALL 落在替换区自身的可见尺寸上，MUST NOT 只依赖 `naturalWidth` 一类图片内在尺寸信号。
占位形态 SHALL 复用既有图片占位的视觉语言，MUST NOT 为回退单独引入一套新样式。本不变量 SHALL 覆盖
**全部**图片形态（MUST NOT 只对 `svg` 生效），且 MUST NOT 改写文档（ADR 0003 §3）。

#### Scenario: 加载中不出现空窗

- **WHEN** 打开含图片引用的文档，字节读取尚未返回
- **THEN** 该位置显示可见的加载中状态（含原始引用文本）；从这一刻到终态之间任一时刻，替换区都有
  可见内容，MUST NOT 出现「先有内容、中途空白、再出现占位」的闪烁

#### Scenario: 三种失败路径都留下可见占位

- **WHEN** 同一文档里分别存在：目标不存在、字节读取报错、渲染不可见的三条图片引用
- **THEN** 三处都是可见占位且各含原始引用文本（alt 与路径可见）；文档其余部分照常渲染，MUST NOT
  抛错弹窗、MUST NOT 阻断渲染

#### Scenario: 零尺寸渲染回落占位

- **WHEN** 引用指向一份内容合法、但渲染结果尺寸为零的图片（例如 0 字节位图，或引擎给出零尺寸渲染的
  `width="0"` svg）
- **THEN** 该替换区回落为可见占位（含原始引用文本）；替换区的可见内容高度 > 0（不是「零高度空白」
  也不是「只有不可见的空元素」）

#### Scenario: 三种引用形态都受不变量覆盖

- **WHEN** 同一文档里分别用 `![alt](rel.svg)`、`![alt](https://example.invalid/x.png)` 与
  `![[file.ext]]` 引用三种不可渲染目标
- **THEN** 三处都呈现可见占位并各含原始引用文本；三条路径 MUST NOT 出现「有占位、有空白」的分歧

### Requirement: 图片显示宽度的时序无关性

图片替换区的显示宽度 SHALL 只由「图片固有尺寸」与「替换区包含块宽度（阅读栏宽）」两个量决定：固有
尺寸确定的引用宽度 = min(固有宽, 栏宽)；固有尺寸不确定的引用（只给百分比宽 / 只声明 `viewBox` 的
矢量图）宽度 = 栏宽、高度按固有比例。显示宽度 MUST NOT 依赖字节加载快慢、图片缓存命中、打开次序、
以及加载中状态块的在否与其文本宽度；同一引用首次打开与重开（切走再切回）SHALL 收敛到同一宽度。
判据 SHALL 落在替换区自身的布局盒上，MUST NOT 用 `naturalWidth` 一类内在尺寸信号推断显示宽度。
权威条款、输入分布与机制说明见 [docs/specs/image-reading.md](../../../docs/specs/image-reading.md)
§1–§3，本 requirement 只写 capability 级口径、不复制全文。

#### Scenario: 首开与重开收敛到同一宽度

- **WHEN** 同一文档含固有尺寸确定的图片（宽于栏宽与窄于栏宽各一）与固有尺寸不确定的图片（`width="100%"`
  + `viewBox`），文档首次打开后读取各替换区的布局盒，再切到另一篇文档、切回后重读
- **THEN** 每条引用的显示宽度两态相同；宽于栏宽者与固有尺寸不确定者等于栏宽，窄于栏宽者等于其固有宽；
  MUST NOT 出现首开一态、重开另一态

#### Scenario: 固有尺寸不确定的引用不回落成固定像素宽度

- **WHEN** 引用的 svg 只给百分比宽或只声明 `viewBox`（无固有像素尺寸），栏宽在渲染前后不变
- **THEN** 该替换区的显示宽度等于栏宽（高度按固有比例），MUST NOT 出现与栏宽无关的固定像素宽度
  （如引擎的默认对象尺寸 300px）

### Requirement: SVG 图片的渲染安全性

SVG 图片 SHALL 只经 HTML `<img>` 元素渲染（含 `data:` URL 形态），MUST NOT 用 `innerHTML` /
`insertAdjacentHTML` / `DOMParser` 后插入 DOM 等任何把 SVG 内容**内联进文档**的方式渲染。理由：
`<img>` 引用上下文对应 SVG 规范中关闭脚本执行与外部资源解析的处理模式，而内联插入会同时打开两者。
本条款 MUST NOT 依赖内容侧净化：引用文件的内容 SHALL 视为不可信输入，安全问题由载入上下文关闭，
而非由前端改写 SVG 内容（MUST NOT 引入仓内 SVG 净化器）。本条款 MUST NOT 改变外部 URL 引用的
既有处置：成品 CSP 未放行的外部目标必然加载失败，其终态按「图片引用的可见回退不变量」处置。

#### Scenario: 含脚本的 SVG 不执行脚本

- **WHEN** vault 内某 svg 含 `<script>` 元素与 `onload` 事件属性，文档以 `![x](evil.svg)` 引用它
- **THEN** 该 svg 不执行任何脚本：无脚本产生的 DOM 变化、无诊断日志、无 toast；图片本身正常渲染
  （或在其渲染不可见时回落可见占位）

#### Scenario: 含外链的 SVG 不发起网络请求

- **WHEN** vault 内某 svg 含指向 vault 外地址的资源引用（如 `<image href="https://example.invalid/x.png">`）
- **THEN** 打开该笔记时对该外部地址不产生任何请求；图片本身正常渲染（或在其渲染不可见时回落可见
  占位）
