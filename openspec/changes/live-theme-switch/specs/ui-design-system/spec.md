## MODIFIED Requirements

### Requirement: 三主题与主题选择

系统 SHALL 提供 light / dark / eink 三个主题，同一套 token 名经 `data-theme` 属性切换取值；
三主题 SHALL 共享同一套非色 token（字体阶梯 / 间距 / 圆角 / 布局 / 动效）——「共享结构与排版
基因，只分档对比度」。主题选择 SHALL 走配置：`[ui]` 配置表的 `theme` 字段（`light` / `dark` /
`eink`，默认 `light`）是**启动真源**，启动装载时读一次并施加；非法值 SHALL 回落 `light` 并附
一条人话 warning（配置即数据 + schema 校验，ADR 0002 §5）。MUST NOT 引入跟随系统
（`prefers-color-scheme`）通道。

主题 SHALL 支持**运行期切换**（本 change 修订 restyle-ui-tokens-v1 节点 1 裁决 D3 的「重启
生效」部分）：切换入口为命令 `view.theme-cycle`（循环 light → dark → eink，键位口径见
`keymap-commands` 的「主题切换命令」）与 modeline 右段的主题指示钮——钮文案 SHALL 为当前
主题名（常驻的「这是哪个主题」归因出口），点击 SHALL 与命令走同一条切换路径。切换 SHALL
即时生效：改写 `<html data-theme>` 后 token 层、chrome 表面、CM 编辑器主题、两路语法高亮、
KaTeX 全部经 CSS 变量跟随，MUST NOT 要求重启或整窗 reload。启动施加与运行期切换 SHALL
共用同一施加点（同一函数写 `data-theme`），MUST NOT 出现第二处主题写入者。

mermaid 已渲染 SVG SHALL 在主题切换时按新主题重渲染（颜色烧进 SVG 内联样式，CSS 变量无法
事后跟随）：切换时使渲染缓存与 initialize 态失效、经 `previewRefresh` 触发装饰重建，重建期间
各块回落既有 pending 占位，重渲经既有串行队列与有限 settle；切换前已发出的渲染（in-flight）
settle 时 SHALL 按主题世代号丢弃，旧主题色 SVG MUST NOT 落地为新缓存。

运行期切换 SHALL 在切换时把新主题写回 `config.json` 的 `[ui] theme`（合并既有内容、原子写），
让启动真源跟上运行态；写回失败 SHALL NOT 阻塞或回滚运行期切换——主题保持已切换状态，并以
toast 告知「重启后将回到配置文件值」。主题指示钮与相关 chrome 样式 SHALL 只取 token 层取值
（eink 下适用 chip 描边化规则），MUST NOT 引入新色值。

#### Scenario: 配置驱动主题

- **WHEN** 配置 `ui.theme` 为 `dark`（或 `eink`）并启动
- **THEN** 首帧即为对应主题：底色、文字、边线、语法高亮取该主题的 token 值；未配置时与
  `light` 逐项一致

#### Scenario: 非法值回落

- **WHEN** 配置 `ui.theme` 为取值表之外的字符串
- **THEN** 记一条 warning、主题为 `light`，界面无其他可见变化

#### Scenario: 运行期切换即时生效

- **WHEN** 在运行期经 `view.theme-cycle` 命令（或点击 modeline 主题指示钮）切换主题
- **THEN** `data-theme` 立即改写，chrome 表面与编辑器（含语法高亮）的计算样式同步跟随到新
  主题取值，全程不重启、不整窗 reload；modeline 指示钮文案同步更新为新主题名；三档循环
  顺序为 light → dark → eink → light

#### Scenario: mermaid 按新主题重渲染

- **WHEN** 含已渲染 mermaid 图的文档在运行期切换主题
- **THEN** 各 mermaid 块先回落「渲染中…」占位，随后以新主题的 token 取值重渲染并 settle；
  切换前发出的渲染结果不得落地（旧色 SVG 不出现在切换后的界面上）

#### Scenario: 切换写回与失败降级

- **WHEN** 运行期切换主题成功
- **THEN** `config.json` 的 `[ui] theme` 被写回为新主题（文件中其他字段保持不变），下次启动
  首帧即为该主题；写回失败时界面保持新主题、弹出 toast 告知重启后回落，应用其他行为不受
  影响
