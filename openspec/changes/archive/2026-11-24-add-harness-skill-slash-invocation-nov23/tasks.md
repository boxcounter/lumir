# Tasks: add-harness-skill-slash-invocation-nov23

> 施工前提：**节点 1 已通过**（Alex 2026-11-24「批准 Skill 混合方案」）。按本清单逐项勾选；
> 未勾项不删除，放弃的就地写理由。

## 0. 前置与红线

- [x] 0.1 节点 1 通过：Alex 2026-11-24 明确「批准 Skill 混合方案」（显式确定性加载 + 保留自动
      `skill_load` + 双入口策略）
- [x] 0.2 开工前过一遍 `REVIEW.md`，重点对照「同一语义两处真源」「断言等价于子串」「读不到当成空」
      「证据只在终端跑过」
- [x] 0.3 红线：不改 `permissions.rs` 的权限语义；不把显式选择做成授权；不收紧默认
      `discover_skills` / 索引 / 模型自主 `skill_load`
- [x] 0.4 红线：只支持 `disable-model-invocation` 与 `user-invocable` 这一套字段，不添加 Codex 别名或
      第二套嵌套语法，不宣称是 Agent Skills 标准字段
- [x] 0.5 红线：不提前改写 living spec；living 只由归档并入
- [x] 0.6 红线：新增 fixture 不覆盖 `scripts/acceptance/fixtures/harness-mock-skill.json`（场景 77 在用）
- [x] 0.7 开工当天复核 design §2 的行号锚点；漂了就先改 design 再施工
- [x] 0.8 若实现期发现需要重写既有自动工具历史、在重试 / 恢复时重新执行显式注入，或为字段增加兼容别名，
      停下上报；这些都超出 H1 的批准范围
- [x] 0.9 读取边界：发现期可按现状整份读入 SKILL.md 解析元数据，发生在权限 / 策略前；拒绝路径只承诺
      各自被拒入口的执行期正文加载器未调用与对应输出面无正文，另一放行入口保留正文正向对照。不得写
      「任何 Skill 文件零读取」断言，不在本 change 夹带发现期只读 frontmatter 优化

## 1. 先红（测试先行，旧实现上必须红）

- [x] 1.1 Rust 单测：frontmatter 缺省双入口开放；`disable-model-invocation: true` 只禁模型；
      `user-invocable: false` 只禁用户；两种禁用组合双入口均禁；vault 覆盖时策略随整项覆盖
- [x] 1.2 Rust 单测：非法元数据（重复字段、带引号、`yes` / `no`、大小写变体、非布尔值）均
      `skill_invocation_invalid`，两个入口 fail closed，执行期正文加载器调用计数为零且各输出面无正文；
      未知字段仍忽略。不得用发现期文件系统读取计数为零作判据
- [x] 1.3 Rust 单测：自动入口保留——默认 Skill 的索引条目、工具定义与 `skill_load` 正文 / 错误回执不变；
      禁自动条目返回 `skill_model_invocation_disabled`，执行期正文加载器未调用且 SKILL.md 与其他目录内
      文件均无正文进入工具结果；禁手动条目的自动加载仍成功
- [x] 1.4 Rust 单测：显式 `skills_json` 注入（选中 → input 多一个带 `lumir_skill` 的 part、段头 + 正文；
      未知 / 超限 / 读失败 / 不合 grammar 跳过；重复去重；结构非法拒绝发送）
- [x] 1.5 Rust 单测：显式入口策略——禁自动仍可显式注入；禁手动返回非阻断
      `skill_user_invocation_disabled`，执行期正文加载器未调用且不注入；非法元数据同 fail closed；
      旧 ref / 伪造名字不能绕过
- [x] 1.6 Rust 单测：两入口权限矩阵——tool 级 `deny = ["skill_load"]` 与名字模式
      `deny = ["skill_load(<name>)"]`，分别在 `read_only` / `vault_write` / `full_access` 三档、
      显式 / 自动两入口下：执行期正文加载器调用计数为零；显式的 `input` / `llm_request.messages` /
      provider wire 无正文；自动工具结果无正文；同配置未命中 deny 的名字正常加载
- [x] 1.6a Rust 反例矩阵：fixture 的 SKILL.md 含唯一 body marker。先运行 `discover_skills` 并断言
      description / 策略已成功解析，证明发现期读取已发生；再分别施加以下条件并按入口断言：
      ① deny：显式与自动两入口的执行期正文加载器均未调用，显式 `input` / `llm_request.messages` /
      provider wire 与自动工具结果均无 marker；
      ② 禁自动：仅自动入口加载器未调用、工具结果无 marker；显式入口仍加载，`input` /
      `llm_request.messages` / provider wire 均有 marker；
      ③ 禁手动：仅显式入口加载器未调用，显式 `input` / `llm_request.messages` / provider wire 无 marker；
      自动 `skill_load` 仍加载且工具结果有 marker；
      ④ 非法元数据：两入口均 fail closed，加载器均未调用，两个输出面均无 marker。
      不得把禁自动 / 禁手动的负向断言扩大到另一放行入口；不得断言或暗示发现期零 IO，不得用删除目录 /
      整文件不可读冒充这个反例
- [x] 1.7 Rust 单测：wire 剥离（三个 client 的 wire body 不含 `lumir_skill`，正文仍在；无图片、
      仅用户文本 + 技能 part 也剥离，且不解析附件目录）
- [x] 1.8 Rust 单测：投影与命名素材（`panel_text_of_content` / 恢复面板 / `turn_user_text` /
      `first_user_text` / `title::material` 首轮与最近轮均不含显式技能正文）
- [x] 1.9 Rust 单测：重试 / 恢复 / 压缩——显式 part 原样在且显式预加载器调用计数不增；
      自动旧工具结果按历史保留，不被当前策略回写；压缩不重新执行显式注入
- [x] 1.10 Rust 单测：清单与索引（名字升序、source、策略字段、无 dir；默认索引无策略标记；
      禁自动 / 禁手动 / 非法标记正确；禁手动不进候选但仍可自动；禁自动仍可候选；grammar 外名字现有
      自动能力不变，点开头仍 `skill_name_invalid`）
- [x] 1.11 Rust 单测：提示装配（identity 含显式段头、斜杠路径与混合调用约定；固定段字节指纹按实测更新）
- [x] 1.12 前端单测：被动候选（初始无高亮；Enter / Tab 不消费；↑/↓ 进入选择态；Enter / Tab / 点击选中；
      Esc 只关浮层；禁手动与非法项不进入候选）
- [x] 1.13 前端单测：`⌃N` / `⌃P` 驱动真实 composer 捕获处理器：主动关闭、`defaultPrevented === false`、
      行移动仍生效；覆盖单行末尾 / 单行开头 / 多行跨行
- [x] 1.14 前端单测：refs（选中创建；编辑失效；undo / redo 同步；同名去重；mergeRejected 偏移；
      `skills_json` 只含当前消息 refs）
- [x] 1.15 前端单测：chip 与 catalog（由 refs 画；missing / 禁手动 disabled / 非法 disabled 区分；
      catalog 失败不误标；草稿恢复立即可见；候选只显示用户可调用项）
- [x] 1.16 前端单测：草稿 v3（往返；v2 → skills 空 + 立即写 v3；v1 → v3；脏 refs 丢弃；不保存策略快照；
      CRLF v3 / v2 / v1 装载后 caret、卡片 `at` 与 refs `from` / `to` 经同一 offset 映射重定位，
      CRLF 之后的合法 ref 切片不变且不被丢弃）
- [x] 1.17 视觉结构场景：被动 / 选择两态、listbox / option / aria-selected / aria-activedescendant、
      位置钳制、chip missing / disabled、关闭后零残留
- [ ] 1.18 真机场景骨架（见 7.1），旧实现跑出预期红；既有自动场景 77 作为不削弱基线保持绿
      未勾原因：未补做旧实现真机红跑，不把评审期验收脚本失败冒充产品红。当前实现 726 最终 1/1 PASS（36 断言），
      77 真机 PASS；早期红跑根因与修正见 proposal 节点 2。
- [ ] 1.19 在旧实现上跑 1.1–1.18 留红 / 基线绿证据，落 `.local/`；天然绿项不冒充先红
      未勾原因：核心 Rust/TS 先红证据已落 `.local/missions/skill-hybrid-nov24/`；视觉与真机未补做旧实现红跑，
      最终当前实现证据不能倒填成旧实现红证据。

## 2. Rust：元数据、两入口、留存与投影

- [x] 2.1 `SkillEntry` 增加 `source` 与单一内部 `SkillInvocation` 表示；在一次双根遍历里解析，
      vault 同名覆盖整项；frontmatter 解析只有一处，不引入 YAML 依赖。发现期沿用当前可能整份读入
      SKILL.md 的实现，只消费元数据，不虚称零 IO 或改变索引行为
- [x] 2.2 实现两个字段的缺省 / 布尔校验 / 非法 fail closed；未知字段忽略；索引只为非默认 / 非法项追加标记，
      默认索引文本不变
- [x] 2.3 新增 `SkillSummary {name,description,source,user_invocable,model_invocable,invocation_valid}`（ts-rs
      导出，无 dir）与 `harness_skills_list`；复用 `discover_skills`，只按 `/` grammar 过滤 DTO
- [x] 2.4 自动 `skill_load` 在现有权限判定后检查模型入口策略；禁自动 / 非法返回明确错误，执行期正文
      加载器未调用且工具结果无正文；默认与禁手动条目走原加载路径
- [x] 2.5 抽取共享执行期正文加载器，统一名称解析、根内路径校验、200KB 上限与读取错误；显式和自动 MUST
      共用，不复制第二套实现。拒绝路径测试给该加载器加调用计数，不给发现期文件系统读取加零计数断言
- [x] 2.6 `harness_send` 增加必填 `skills_json`；结构非法 → `harness_skills_invalid` 不建会话不入队；
      不合 grammar 防御性丢弃；唯一前端调用点同步，不做旧前端兼容层
- [x] 2.7 `TurnInput::User` 携带名字数组（子运行 / cron / 测试构造点显式空数组）；回合发现后、入队前，
      先过同一 `skill_load` 权限判定，再检查用户入口策略，仅 Allow + 可用户调用 + 合法时读取
- [x] 2.8 显式注入顺序：`apply_context_section` 后按名字数组追加 part；同名一次；段头常量单点；
      deny / 禁手动 / 非法分别给明确非阻断反馈，不伪装未知名字，执行期正文加载器未调用，且
      `input` / `llm_request.messages` / provider wire 无正文
- [x] 2.9 `expand_image_refs` 在无图片早退前无条件剥掉 `lumir_skill`、保留正文；三 client + 无图片单测
- [x] 2.10 `panel_text_of_content` 与 `title::item_text` 跳过显式技能 part；恢复面板与命名素材共用判据；
      自动工具结果投影不改
- [x] 2.11 `identity.md` 补混合调用、段头、路径与禁自动提示；索引策略标记与固定段指纹测试更新
- [x] 2.12 `cargo fmt` / `clippy` / `test` 通过；`src/bindings/SkillSummary.ts` 生成后 `git add`

## 3. 前端：候选、refs、catalog、chip

- [x] 3.1 `src/skill-menu.ts` 纯模型：边界、token、前缀过滤、被动 / 选择态、选中事务、grammar；
      候选只收 `invocation_valid && user_invocable`
- [x] 3.2 composer 增加 refs `StateField`：add / remove、`invertedEffects`、文档映射、切片校验、撤销同步；
      `ComposerContent` 带 `skills`
- [x] 3.3 `send()` 从当前 refs 生成 `skills_json`（位置排序、同名首次、grammar）；`ipc.ts` 的
      `harnessSend` 增参
- [x] 3.4 `mergeRejectedComposerContent`：current refs 偏移原文长度；合并后逐条校验
- [x] 3.5 keydown：`⌃N` / `⌃P` 专用分支在 generic `mod` 前；关闭但不消费；其余候选分支在 IME 闸门后、
      Enter 发送前；被动态不消费 Enter / Tab，选择态才消费
- [x] 3.6 Escape：打开时注册 `harness-skill-menu` 层，关闭注销；焦点留在输入区
- [x] 3.7 catalog store：按 vault 缓存最新成功清单；新 `/` 强制刷新；关闭保留；草稿装载异步取一次；
      切 vault 清空 + 世代作废；失败不误标、不阻塞输入
- [x] 3.8 chip：从 refs 画；missing / 禁手动 disabled / 非法 disabled 区分；只扫可视范围；
      `pointer-events: none`；catalog 失败只画基础 chip
- [x] 3.9 生命周期：面板销毁 / vault 切换 / 新会话时注销监听、清 refs、丢弃在途 catalog
- [x] 3.10 1.12–1.16 转绿

## 4. 草稿 v3

- [x] 4.1 `src/quote-card.ts`：`ComposerDraft` 升 `version: 3`，增加 `skills: ComposerSkillRef[]`；
      serialize / read 均产 v3，不保存策略快照；读路径的共同出口先归一 CRLF，用同一映射重定位
      caret、卡片 `at` 与 refs `from` / `to`
- [x] 4.2 v2 → skills 空、migrated 后立即写 v3；v1 按既有规则转换后写 v3；成功后只写 v3，不双写；
      v2 / v1 的卡片 `at: 0` 语义不因 skills 为空而改变
- [x] 4.3 v3 refs 校验范围、切片、grammar；不合格丢弃，不影响其余草稿；校验在 CRLF 归一与
      重映射之后执行，不得用原始坐标校验后把旧偏移留在归一草稿里
- [x] 4.4 `harness-draft.ts` / `harness-panel.ts` 接线；refs 选中 / 失效 / undo 均触发草稿落盘
- [x] 4.5 1.16 转绿；v1 / v2 一次性转换不丢文本 / 卡片；CRLF 之后的引用经同一映射后仍指向原切片

## 5. 样式与可访问性

- [x] 5.1 浮层：`list` 档宽度、最大 6 行、细条滚动并登记 `scrollbar-registry`
- [x] 5.2 被动 / 选择两态：被动无高亮；选择态既有 hover 底色 + 左缘 2px 强调条；eink 描边
- [x] 5.3 chip：`--r-pill` 级圆角、既有弱强调面；missing / disabled 变暗且 title 区分；无动画
- [x] 5.4 ARIA：listbox / option / aria-selected；选择态 aria-autocomplete + aria-activedescendant；
      被动态不设，关闭清除
- [ ] 5.5 三主题 / eink 目检 + 结构断言；不新增整页像素基线
      未勾原因：未另做人工目检；相关结构 15/15 与完整视觉 `GATE RESULT: 15/15 PASS（SKIP 0）`（exit 0）
      已通过，未更新基线。机器像素结果不写成人工手感验收。

## 6. 文案

- [x] 6.1 `src/copy-data.ts` 新增浮层可读名、missing / 禁手动 / 非法 title 与必要策略反馈键；
      编号按实现期最大值 +1，不预占
- [x] 6.2 `文案-Copy.md` 同步中英双档
- [x] 6.3 chip 内不写文案；技能名不是文案

## 7. 验收场景（真机矩阵）

- [x] 7.1 新增真机场景 `harness-skill-hybrid-invocation`（id 以当时 `run.mjs --list` 最大值 +1，不预占，
      `tier: core`），独立 fixture 与合成 Skill：
  1. 预置默认 `acc-skill-abc`、路径同前缀 `tmp-acc`、禁自动 `acc-deploy`、禁手动 `acc-background`
     与非法元数据 `acc-invalid`；只写验收 vault
  2. **普通路径不误判**：行首 / 空格后 / 列表项键入 `/tmp` 直接 Enter；候选可出现但不消费，JSONL 无
     `lumir_skill`
  3. **显式确定性加载**：选择 `tmp-acc` 与 `acc-skill-abc` 后发送；首个 `llm_request.messages` 有标记与
     正文，AX 无正文；手打完整名字不选择则无显式注入
  4. **默认自动能力不削弱**：既有场景 77 逐条通过；默认 Skill 的索引与自动工具结果保持原形态
  5. **禁自动**：`acc-deploy` 先经发现取得索引与仅用户调用标记；mock 发起自动 `skill_load` 得到策略错误，
     执行期正文加载器未调用且工具结果无正文；用户显式选择后正文正常注入
  6. **禁手动**：`acc-background` 先经发现取得策略，不出现在候选；mock 自动 `skill_load` 有正文；构造旧 ref
     发送时执行期正文加载器未调用、不注入并给非阻断策略反馈
  7. **非法元数据**：`acc-invalid` 先经发现解析出非法状态，两入口均 `skill_invocation_invalid`，执行期正文
     加载器未调用，显式 `input` / `llm_request.messages` / provider wire 与自动工具结果均无正文
  8. **权限一致**：先证明发现期 description 已取得，再对同一 Skill 分别走显式 / 自动并命中 deny；两者执行期
     正文加载器均未调用，显式 `input` / `llm_request.messages` / provider wire 与自动工具结果均无正文；
     不断言发现期文件系统零读取
  9. **恢复与策略变化**：恢复含显式 part / 自动工具结果的会话，AX 与 JSONL 投影不变；改为禁自动后旧历史
     仍在，只有新自动调用被拦
  10. **键位 / IME / 草稿**：⌃N/P 三态不消费；组合期不弹不吞 Enter；切 vault 草稿往返后 refs 恢复并按
      当前策略执行
- [x] 7.2 键入通道探针：实测能把 `/` 与字符送进 CM 模型的通道；不触发就改 `do: keys` 逐字符；
      最终普通文本 / slash 均用 `typeInNode` 的「占位名 | 本轮文本」联合身份，候选选择保留真实方向键与 Enter；
      早期 `keys` 的 placeholder→value 身份消失问题已消除，726 最终 1/1 PASS
- [x] 7.3 新 fixture 只证明注入 / 留存 / 投影 / 策略执行 / 发送链路，不声称证明真实模型遵守
- [x] 7.4 场景 77 回归：既有 `harness-mock-skill.json` 与脚本逐条不变，列入本批必跑
      真机 PASS（14.3s），证据 `/Users/boxcounter/Code/Boxcounter/lumir/.local/missions/skill-hybrid-nov24/acceptance-726-related-r2.log`
      与 `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-24-skill-hybrid-r2/77-harness-skill-load/`
- [x] 7.5 dev flavour 不隔离 `HOME` 时只断言合成名，不断言清单条数或首项
- [x] 7.6 回扫既有 composer 键入 `/` 的场景，命中按新行为改准
- [x] 7.7 `coverage.mjs` 重新生成 `COVERAGE.md`；`coverage.mjs --check` 与 `run.mjs --check` 通过
- [x] 7.8 真机跑新场景 + 77 + 受影响场景；证据落 `.local/acceptance/<批次>/`；FAIL 逐条定位
      726 最终 1/1 PASS（36 断言、34.4s，r5）；723 PASS（r3）；77 / 135 / 725 PASS（r2）。
      早期失败已逐条按 AX、合成 JSONL、fixture 与输入通道修正，详见 proposal 节点 2
- [x] 7.9 报告前用绝对路径 `ls` 证据目录（REVIEW.md「证据只在终端跑过」条）
      已核 r2 / r3 / r5 acceptance 目录与 summary/results 真实存在；最终 726 证据根为
      `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-24-skill-hybrid-r5/`

## 8. 提示装配与 dogfood

- [x] 8.1 提示装配单测覆盖显式段头、路径、默认自动与禁自动标记；固定段指纹同步
- [ ] 8.2 dogfood 观察记录（非门禁）：真实模型是否按显式正文行事、是否遵守禁自动索引提示；
      未勾原因：按主会话限制不做真实模型 dogfood；mock 不用于证明模型遵守。
      记录模型 / 日期 / 观察，落 `.local/reports/`
- [x] 8.3 报告明确：mock 与单测证明执行层，不证明真实模型遵守；执行层策略闸另有机器断言

## 9. 文档与门禁

- [x] 9.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过，记录 `Totals:` 原文
- [x] 9.2 `bash scripts/docs-check.sh` 通过
- [x] 9.3 `scripts/gate.sh quick` 通过，照抄 `GATE RESULT` 原文行 + 退出码；跑前 `git add` 新 bindings
      完整视觉 gate 日志同时包含 quick 全部检查与 visual-regression：`GATE RESULT: 15/15 PASS（SKIP 0）`，exit 0；
      未另跑 quick，证据 `gate-visual-final-isolated.log`
- [x] 9.4 动过 `src/harness-panel.css` 后 `scripts/gate.sh visual` 通过；基线未更新，确需更新先送 Alex 过目
      `GATE RESULT: 15/15 PASS（SKIP 0）`，exit 0，基线未更新；证据 `gate-visual-final-isolated.log`
- [x] 9.5 真机场景 PASS，证据指针可 `ls`
      726 最终 1/1 PASS、36 断言、34.4s（r5）；723 PASS；77 / 135 / 725 相关 PASS；
      证据目录与 runner 日志均已读取核对
- [x] 9.6 门禁日志落 `.local/reviews/` 或批次证据目录，报告绝对路径

## 10. 信息卫生

- [x] 10.1 fixture / 视觉 / 验收只用合成 Skill 名、合成 vault 名与合成正文
- [x] 10.2 提交前 text 级 grep 清扫；截图与证据只落 `.local/`
- [x] 10.3 新 fixture 独立命名；`git diff --name-only` 确认未改场景 77 fixture
- [x] 10.4 本 change 无原型 HTML；如实现期新增，按硬规则做控制面板与截图重截

## 11. 收尾

- [x] 11.1 `tasks.md` 全部勾选；未勾项就地写放弃理由
      已完成项按最终证据勾选；旧实现真机红跑、人工目检与真实模型 dogfood 保留未勾及就地理由，不冒充完成
- [x] 11.2 `proposal.md` 节点状态与 H1 按 Alex 原话更新，不把待批写成已批
- [x] 11.3 `docs/backlog.md` 归档跟踪队列落一条
- [x] 11.4 交独立 reviewer；verdict 绑定当前 tip
      r3 clean/merge、无 P1/P2，绑定产品 tip `27df529bc4f86fe5b2b806cd27614c95417ec198`；
      其后仅 test-only 场景 / fixture 提交，最终 tip `32e795f70275aced4b2f4842daf4d93f6399bd46`；
      评审 `/Users/boxcounter/Code/Boxcounter/lumir/.local/reviews/skill-hybrid-final-r3.md`
- [ ] 11.5 节点 2 五要件齐后归档；归档提交后 `--archived` 审计至 PASS
      未勾原因：归档时执行；五要件与证据已记入 proposal 节点 2，归档提交后补实际 hash、包装器输出与审计读数，
      未取得 `--archived` PASS 前不宣称完成。
