## Purpose

定义「粘贴剪贴板图片」的编辑通道：md 模式且可编辑时，剪贴板含 `image/*` 数据的粘贴
被拦截并转码压缩落盘 vault（当前笔记同目录，无路径文档退 vault 根；内容寻址命名
`pasted-<hash16>.<ext>`、全 vault 同名去重、默认 WebP 无损转码），随后在光标处插入
`![[文件名]]` 引用；非图片剪贴板在有可插入文本（`text/plain` / `text/uri-list`）时逐字节走
既有默认文本粘贴，**无可插入文本时（HTML-only / 只有文件项）是严格空操作**；失败一律人话
toast、不留半截。渲染侧（引用语法的内联显示、占位、lightbox）由 `attachment-display` 承接，
字节写落盘由 `fs-io` 的「二进制附件写入」承接。由 change `paste-clipboard-image` 归档并入
（2026-10-10，实现 M415 通道探针 + M416 后端写原语与前端链路）。语义命名是同一通道的异步
后续、不属落盘原语：落盘仍先取内容寻址的暂存名 `pasted-<hash16>.<ext>`，仅在
`harness.attachment_naming.enabled` 开且选定 provider 声明了 vision 模型时，粘贴成功后再发起
一次独立命名调用，成功才改名为 `<slug>-<hash6>.<ext>` 并按解析结果更新全 vault 引用（toast 给
一次撤销入口，撤销即对称反向操作）；命名失败 / 超时 / 开关关闭时保留暂存名，粘贴路径不等待、
不阻塞插入（change `add-semantic-image-naming` 归档并入，2026-10-24，实现 M709）。

## MODIFIED Requirements

### Requirement: 非图片剪贴板降级

粘贴的剪贴板不含 `image/*` 数据时（纯文本、富文本、文件等非图片内容），行为 SHALL 由剪贴板
**是否含可插入文本**决定：`text/plain` 或 `text/uri-list` 任一取到非空值时，粘贴 SHALL 走
既有默认文本粘贴（`text/plain` 优先，其次 `text/uri-list`），行为与本能力存在之前逐字节一致
——本能力的拦截层 MUST NOT 消费事件、MUST NOT 改变任何现有文本粘贴行为。有非空选区时，插入
SHALL 恰好替换选区（caret 落在插入文本之后），与键入同权。

两者都取不到非空值时（典型形态：只有 `text/html` 的富剪贴板、只有文件项的剪贴板），可编辑
正文里的粘贴 SHALL 是**严格空操作**：文档、选区、撤销栈与 dirty MUST 全部不变；MUST NOT 以
空串替换非空选区，MUST NOT 把 HTML 解析或转换成文本插入，MUST NOT 插入任何内容、MUST NOT
产生 toast 或落盘。折叠 caret 与正 / 反向非空选区同权；md 与 code 会话共用同一条判据。

判据 SHALL 与编辑器默认粘贴读**同一组**剪贴板数据（`text/plain` 与 `text/uri-list`），
MUST NOT 另立「哪些 MIME 算文本」的集合。只读（不可编辑）会话 MUST NOT 被这条降级拦截改变：
拦截层不消费事件，保持既有只读粘贴语义（文档不变）。图片粘贴的优先级（`image/*` 文件项优先）
与 uri-list 的既有降级顺序 MUST NOT 改变。远程图片 URL 以文本形态粘贴时 SHALL 只粘贴 URL
文本本身，MUST NOT 触发下载或落盘。

#### Scenario: 文本粘贴回归

- **WHEN** 剪贴板为纯文本，在 md 编辑器执行 ⌘V（折叠 caret 或有非空选区）
- **THEN** 文档插入该文本 / 恰好替换选区，与既有默认粘贴行为完全一致；笔记目录无新增文件

#### Scenario: 远程图片 URL 不下载

- **WHEN** 剪贴板含一段图片 URL 文本，执行 ⌘V
- **THEN** 只插入 URL 文本本身，不产生任何网络请求、不落盘

#### Scenario: HTML-only 加非空选区是严格空操作

- **GIVEN** md 正文可编辑，选区为 `[2,8)`（或反向 `[8,2)`），文档为 `alpha beta\n`
- **WHEN** 粘贴只含 `text/html`（无 `text/plain`、无 `text/uri-list`）的剪贴板
- **THEN** 文档逐字节仍为 `alpha beta\n`，选区与方向不变，撤销栈不新增一步（一次 undo 撤销的
  是此前的一次真实编辑），dirty 不变——MUST NOT 出现「选区被删、无内容插入」的形态

#### Scenario: 只有文件项的剪贴板不删选区

- **GIVEN** 可编辑正文存在非空选区
- **WHEN** 粘贴的剪贴板只有非图片文件项、取不到非空 `text/plain` 与 `text/uri-list`
- **THEN** 文档与选区逐字节不变，不落盘、不插入引用；同一剪贴板若是 `image/*` 且会话是 md，
  仍按图片粘贴优先插入引用（既有优先级）

#### Scenario: 只读会话不拦截

- **GIVEN** vault 外只读会话（不可编辑）存在非空选区
- **WHEN** 粘贴 HTML-only 剪贴板
- **THEN** 拦截层不消费事件、文档不变；行为与只读粘贴的既有语义一致
