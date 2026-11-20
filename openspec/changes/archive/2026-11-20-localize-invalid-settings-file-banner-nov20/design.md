# Design: localize-invalid-settings-file-banner-nov20

本 change 的技术决策与依据。节点 1（提案评审）由 tower 按既有裁决通道处理；以下 D1–D5 是
实现口径。

## D1：复用 `config.rs` 的三个装载失败 code，不新造一套

`config.rs` 的 `load_from` 在装载失败时已经产出稳定的文件级诊断 code（`failed_snapshot(path, code, …)`）：

| 真实变体 | 既有 code | 构造点 |
|---|---|---|
| 读取失败（权限 / 目录 / I/O） | `config_read_failed` | `load_from` 的 `read_to_string` `Err` 分支 |
| JSON 语法错误 | `config_invalid_json` | `serde_json::from_str::<Value>` 的 `Err` 分支（带 line） |
| 顶层非对象 / 字段类型不符 | `config_invalid_structure` | `serde_json::from_str::<RawConfig>` 的 `Err` 分支 |

`settings.rs::snapshot_at` 为设置面板**独立**重读同一份文件，过去只产 message。若为它另造
`settings_file_*` 一族 code，同一类失败在 console 诊断与设置横幅上会出现两个 code
（REVIEW.md『同一语义两处真源』条）。因此 `Invalid.code` 直接复用上表三个码：

- 读失败 → `config_read_failed`
- 语法错误（有 line / column）→ `config_invalid_json`
- `!parsed.is_object()` 与 `validate_value` 的结构回落 → `config_invalid_structure`

**顶层非对象为什么不单独取码**：`config.rs` 在 `serde_json::from_str::<RawConfig>` 处已把
「顶层不是对象」与「字段类型不符」归成同一类（两者都是 serde 的 `invalid type`）；设置侧单独
分码会让同一个文件在两处得到不同 code。文案写成覆盖两类的句子（D942 明写「顶层必须是 JSON
对象，字段类型须与配置规范一致」），是 D6(a) 的既有明账。

## D2：`code: String` 而不是 Rust 枚举

`ConfigDiagnostic.code` 是 `String`，`failed_snapshot` 的 code 是参数；`SettingsFileState::Invalid`
若用枚举，就要在 Rust 侧再维护一份「code 全集」并与 `config.rs` 的字符串常量对账。设为
`String` 保持同一条数据流：前端 `errorText` 的未知 code 兜底本来就在，枚举只会把
「未登记的 code」从运行时兜底变成反序列化失败（更糟）。

## D3：单一构造出口 + 门禁扫描通道

四个构造点统一走：

```rust
fn invalid_file(code: &str, message: String, line: Option<u32>, column: Option<u32>) -> SettingsFileState
```

`tests/unit/error-text.test.ts` 按 `invalid_file(` 的**第一个参数**取 code（与
`failed_snapshot(path, "code", …)` 的扫描同形）。这样新增构造点只有两种结果：走这个出口
（被门禁扫到、缺文案即红）或绕过它（review 可见）。扫描在 `maskRust` 掩码上做，注释 / 字符串
里的示例不算构造点；`#[cfg(test)]` 之后不计。

## D4：行号是结构化读数，不进原因模板

`Invalid` 同时携带 `line` / `column`（`Option<u32>`）。原因模板不带任何占位——三个 code 的
文案只描述「发生了什么 + 怎么修」，行号由 D850「第 {line} 行：{reason}」前缀承担。这样：

- `config_invalid_json` 的行号仍然可见（既有诊断位置不丢）；
- 模板不会被 `errorText` 的缺参兜底打回 message（与 M865 的诊断同一条防线）；
- os / parser 内部串没有进入模板的通道。

`column` 继续只留在信封里（与既有行为一致：横幅只展示行号，列号供诊断日志 / 后续扩展）。

## D5：测试分层与反向判据

- **Rust 单测**：四个变体各一条——读失败用「把 config.json 建成目录」造真实 I/O 错误
  （不是 mock），断言 code、message 非空、line / column 的形态。
- **前端单测**：`fileInvalidReason` / `fileInvalidBody` 的 zh / en 两档、可行动方向（含
  「重新载入 / reload」）、内部串负向断言（配正观测：文案表条目确实被取到）、未知 code 回落；
  D851 的覆盖句语义（两类现场共用、旧全称句必须退场）。
- **视觉场景**：zh（JSON 非法带行号，整文件无效 → 默认空态）与 en（读失败带 os 串）各一条，
  外加一条「结构不符但 harness 子树有效 → 面板读数来自文件里的 provider」；断言横幅标题 /
  正文 / 路径 / 只读态与**实际读数**（不是只查无 CJK）；不调 `expectScreenshot`——新基线须
  Alex 过目（tests/visual/README.md）。
- **门禁反向判据**：`LOG_ONLY_DIAGNOSTIC_CODES` 里不再有这三个码；豁免表「必须真实存在构造点、
  不得与 `ERROR_COPY` 并存」两条断言保留，另外新增 `invalid_file` 构造点 / code 数量下限，
  防止扫描退化后覆盖断言恒真。

## D6：D851 的正文覆盖两类 Invalid 现场，而不是一句「全默认」

`SettingsFileState::Invalid` 的四个变体在**生效读数**上分两类：

| 现场 | `effective` | 面板读数 |
|---|---|---|
| 读取失败 / JSON 非法 / 顶层非对象 | `None` | 全部默认（空 provider 清单等） |
| `config_invalid_structure` 且结构错误只在 harness 之外 | harness 子树的 best-effort 结果 | 文件里的 provider / 自动化 / 命名 |

M865 的 D851 写死「生效的是默认配置」，对第二类是事实错误（finding
`20261120-worker-invalid-settings-banner-improve-d851.md` 的现场）。本 change 把正文改成覆盖句：

> {path} 当前无法按完整配置读取：可用部分按文件内容生效，其余用默认值。先修复该文件再回来保存。字段暂为只读。

- 第一类：没有「可用部分」→ 全部走「其余用默认值」，句子仍为真；
- 第二类：harness 子树是「可用部分」→ 「按文件内容生效」为真，其余段落（编辑器等）不在设置面板范围内。

**为什么不用一句「部分生效」含糊带过**：覆盖句必须同时给出两个可核对的事实（哪些生效、
其余是什么），否则用户无法判断面板上的 provider 清单是不是文件里的值。测试也必须核对
**实际读数**（第二类渲染文件里的 provider 行、第一类渲染默认空态），不能只做「无 CJK /
无内部串」这类负向断言。

