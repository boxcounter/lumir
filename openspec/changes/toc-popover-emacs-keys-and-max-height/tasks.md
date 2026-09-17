# Tasks: toc-popover-emacs-keys-and-max-height

> 本 change 停在**节点 1（提案评审）**：Alex 裁决 proposal 与 delta 后才进入实现。实现批次逐项勾选，
> 每条须给**可复核的证据指针**（命令 / 场景名 / 文件 / 基线名），拿不出证据的写「未验」。

## 1. 浮层最大高度 80%（响应式）

- [ ] 1.1 `src/style.css`：`.lumir-toc` 增 `max-height: 80vh` 与列向 flex
      （`display: flex; flex-direction: column`）。注意全局 `* { box-sizing: border-box }`，
      因此这里的 80vh 天然是**含内边距与底部提示的总高**——与 spec 的「浮层总高」口径同一件事，
      不要写成 `calc(80vh - 提示高)` 那类减法（那会引入第二处高度真源）
- [ ] 1.2 `src/style.css`：`.lumir-toc-list` 从 `max-height: 55vh` 改为 `flex: 1 1 auto; min-height: 0`
      （保留 `overflow: auto` 与 `outline: none`）——列表成为唯一滚动容器；`min-height: 0`
      是 flex 子项能收缩到内容高以下的前提，漏了它上限会失效
- [ ] 1.3 `src/style.css`：`.lumir-toc-hint` 增 `flex: 0 0 auto`，否则 flex 会压缩它
      （「提示常驻可见」是 requirement，不是观感偏好）
- [ ] 1.4 复核 `.lumir-toc[hidden] { display: none }` 在加了 `display: flex` 之后仍然生效
      （`.lumir-toc[hidden]` 的选择器优先级 0-1-1 高于 `.lumir-toc` 的 0-1-0），空态 MUST NOT 因
      这次改动把隐藏的浮层露出来：`tests/visual/scenes/toc-outline.spec.ts` 的空态断言即防线
- [ ] 1.5 证据：视觉场景新增高度断言——浮层 `getBoundingClientRect().height ≤ innerHeight * 0.8`；
      **必须用标题条数远超一屏的 fixture**（现有 `toc-outline.md` 只有 10 条标题，10 × 25.5px 连
      55vh 都填不满，拿它断言「不超 80%」是恒真断言，见 REVIEW.md 第 1 条）；同时断言列表
      `scrollHeight > clientHeight`（真在浮层内滚）与底部提示 `toBeVisible()`
- [ ] 1.6 证据：同一场景里 `page.setViewportSize()` 改窗口高后重读高度，断言上限跟着变
      （响应式口径），且浮层保持打开时不需重开

## 2. 浮层内的 Emacs 上下键

- [ ] 2.1 `src/toc.ts` 的 `onKeydown`：`Ctrl-N` → `move(1)`、`Ctrl-P` → `move(-1)`
      （与 `↑↓` 共用同一移动实现，MUST NOT 写第二套下标逻辑）
- [ ] 2.2 实测两条 token 的实际输出（`Ctrl-N` / `Ctrl-P`）与表内既有 `Ctrl-n` 的归一化一致，
      避免大小写漂移成静默不匹配；浮层关闭后这两个 token 归 `editor.cursor-down/up`，本 change
      不改那两条绑定
- [ ] 2.3 `src/toc.ts` 文件头注释补一段：这两条键为什么**不进** `keys.ts`（同 `↑↓` 的口径；
      已被 `editor` 作用域占用、同 token 第二条绑定会被构造期拒绝），指针指向 `toc-outline` spec
      的「命令入口与浮层内键位的归属」
- [ ] 2.4 证据：视觉场景新增「`⌃N` / `⌃P` 与 `↑↓` 同落点（含末项钳制）」「`Esc` 关闭后再按 `⌃N`
      由编辑器接管（光标真的下移一行、文档字节不变）」两组断言；真机 `13-toc` 补对应步骤（键盘注入
      走「回读 + 只在字节未变时重试」，不用重试次数当判据——套件 README 的历史教训）

## 3. 键位提示文案（D86）

- [ ] 3.1 `文案-Copy.md` D86 更新为覆盖五个就地键。建议文案：
      `↑↓ ⌃N⌃P 选择 · Enter 跳转 · Esc 关闭`（同义键并成一组、共用一个动作词，与既有
      「键 + 动作词」的行文一致）。宽度预算：浮层宽 300px、提示内边距 12px → 可用约 276px，
      且 `.lumir-toc` 继承 `.masthead` 的 `letter-spacing: .08em`——该串**预计单行放得下，
      以实测为准**；实测放不下时改紧凑写法
- [ ] 3.2 同文件末尾的「文案实现备注」段补 M157 的出处（与本 deck 既有记法一致）
- [ ] 3.3 证据：`tests/visual/scenes/toc-outline.spec.ts:122` 的 `toHaveText` 断言更新为新串；
      `scripts/acceptance/scenarios/13-toc.md` 里 **13 处** `↑↓ 选择` 探针与正文「断言口径」段的
      说明同步（该串是套件判定「浮层开着」的唯一依据，漏一处就是整条场景假绿或假红）

## 4. 验收与视觉门禁

- [ ] 4.1 `scripts/acceptance/fixtures/`：新增一份标题条数远超一屏的 fixture（如 60 条标题，
      H1–H4 混排），供高度上限断言使用；现有 `toc-outline.md`（10 条）保留原用途
- [ ] 4.2 `scripts/acceptance/scenarios/13-toc.md`：新增 `⌃N` / `⌃P` 移动步骤——移动判据沿用既有
      「同一 AX 行同时带条目标题与 `(focused)`」形态（不用跨节点正则，REVIEW.md 第 1 条）；
      「关闭后 `⌃N` 归还」用编辑器文档文本的派生证据（导航后按 `⌃K`，行尾才会连带换行）
- [ ] 4.3 `node scripts/acceptance/run.mjs --check` 静态校验通过（新增 fixture 名与步骤形态）
- [ ] 4.4 `tests/visual/scenes/toc-outline.spec.ts`：提示文案断言、`⌃N` / `⌃P` 导航、关闭后归还、
      高度上限与响应式断言；元素级基线 `toc-popover-chromium-darwin.png` 重拍
      （浮层变高 + 提示文案变化都会反映在该元素截图里）
- [ ] 4.5 整页基线核对：浮层只在该场景里短暂出现，**预期整页基线零变化**；按 REVIEW.md 第 3 条
      的纪律，逐张核对 `tests/visual/baselines/**` 里出现过浮层的那张的时间戳是否随本次更新，
      并如实记录「零变化」的核对方式（不是默认它没变）
- [ ] 4.6 基线更新前截图须 Alex 过目（`tests/visual/README.md` 的基线更新纪律：基线更新是人肉
      裁决点）

## 5. openspec 制品

- [ ] 5.1 `specs/toc-outline/spec.md`：MODIFIED `大纲浮层`（`⌃N` / `⌃P` 等价口径 + 80% 高度
      口径 + 提示覆盖义务 + 3 条新 scenario：`⌃N`/`⌃P` 等价、高度 80% 响应式、就地键与新提示同步）
- [ ] 5.2 `specs/toc-outline/spec.md`：MODIFIED `命令入口与浮层内键位的归属`（就地键集合扩到五个、
      「不进表」的理由、生效条件与归还 + 2 条新 scenario）
- [ ] 5.3 `specs/keymap-commands/spec.md`：MODIFIED `大纲开关——⌘⇧O 与 toc.toggle`（就地键枚举
      同步为五个——那份 living spec 点名了浮层的就地键集合，不同步就在归档后留下与实现不符的枚举）
- [ ] 5.4 实现期若发现 proposal 的意图需要变更（例如 Alex 在节点 1 把 `⌥<` / `⌥>` 或
      `⌃V` / `⌥V` 拉回来），先更新 proposal 再动代码，不静默扩 scope（`openspec-workflow.md` 第 4 条）

## 6. 验证

- [ ] 6.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 6.2 `scripts/gate.sh quick` 全绿（本 change 无 Rust 改动，Rust 门禁应无新增失败）
- [ ] 6.3 `scripts/gate.sh visual` 全绿（含 `toc-outline` 场景的新断言与新基线）
- [ ] 6.4 真机（WKWebView）：`node scripts/acceptance/run.mjs 13` 单场景 PASS，再跑全量；
      证据落 `test-results/acceptance/<日期>/`，报告里给可 `ls` 的绝对路径指针
- [ ] 6.5 `git diff --check` 通过；改动文件集合与 mission scope 一致（跨 scope 的只读依赖若出现，
      须在 tower 批准后再动）
- [ ] 6.6 实现 PR 合并时在 `docs/backlog.md` 的「待 Alex 裁决」节落一条**待归档记录**
      （`openspec-workflow.md` 的批次收尾 checklist 第一条），批次收尾时跟踪到归档

## 7. 已知边界 / 不做

- [ ] 7.1 翻页键（`⌃V` / `⌥V`）不做：Emacs 的这两个键是视口命令（按窗口高滚动 + 2 行重叠 + 光标
      仅在滚出窗口时落到边界行），忠实复刻要引入几何测量——留待手感证据再议
- [ ] 7.2 首末项键（`⌥<` / `⌥>`）不做：编辑器侧没有 `M-<` / `M->`（表内无 `Alt-Comma` /
      `Alt-Period`），只做浮层会造成「同一物理键两个上下文两种语义、编辑器那侧还是坏的」。
      编辑器层的缺口已作为 finding 交 tower 路由；浮层的首末项等那一层定下来再对齐
- [ ] 7.3 就地键不进 `KEY_BINDINGS`、不进 `[keys]` 配置、不出现在键位面板：唯一出口是浮层提示
- [ ] 7.4 浮层的水平定位不随窗口 resize 重排（M148 既有边界，本 change 只动高度）
- [ ] 7.5 窗口内容区高 < 285px 时浮层底边可能越出窗口——不加钳制（避免把 masthead 高度复制成
      第二处真源），作为已知边界写进 spec
