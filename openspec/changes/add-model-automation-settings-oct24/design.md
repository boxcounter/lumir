# Design: 模型接入与自动化的可见设置面板（全功能 provider 管理）

- Change ID: `add-model-automation-settings-oct24`
- 日期: 2026-10-24（r3：从「固定两项 provider 的编辑器」改为「完整 provider 管理」；
  r4 2026-10-25：自动化节按 Alex 六项反馈重做为内联命名目标，确认单页两节）
- 分支基线：`feat/full-provider-management-proposal-oct24`（起草时 `git log -1` = `58bab1a5`；
  行号是起草时逐一读过的原文位置，实现前以符号名 / 检索串为准）
- 本 change 只重做节点 1 提案、spec delta 与可点击原型；**不实现产品代码**。tasks.md 是实现计划。

> **r3 的根因纠正**（Alex 2026-10-24 原话：「我希望的全功能版本，不是残疾版。现在连增删
> provider 都没有。你是不是误解了我的意图？」）：r1 / r2 把「provider 固定为 `kimi` /
> `deepseek` / `mock` 闭集合」当成不可动的现状，于是只做了「两项的编辑器」，并把「新增
> provider」推给一个不存在的 schema change。那是把实现现状当成了产品边界。本版把
> `HarnessProviders` 的固定三字段改成**以稳定 id 为键的可扩展映射**，设置页提供完整的
> provider 增删改、删除保护、默认回退与一次性迁移。固定枚举的成本不在「少一个按钮」，而在
> 它把「接一个新模型供应商」变成了要改 Rust 枚举、运行时装配、前端表单三处的代码变更。

> **r4 的六项重做（Alex 2026-10-25 原型评审，逐项已采纳）**：① 会话命名与图片命名的目标
> 内联到各自开关行，provider 与模型都可编辑；② 默认跟随当前 provider（删键，不是快照）；
> ③ 关闭功能时选择器禁用，但选择、草稿与 `config.json` 里的键都保留；④ 图片命名的模型选项
> 标 `vision` 资格；⑤ 选择旁只保留**一行**实际生效说明；⑥ 移除自动化节顶部那块独立的命名
> 目标摘要框。同时确认本页是**单页两节**：不做编辑器 / 权限设置页，不预设 TAB 或侧边导航。
> 覆盖键的语义（每组一份全局键、每次只解析一个目标）不变——改的是编辑面，不是配置模型。

本文只写「怎么做到 proposal 已裁的行为」与「为什么这样做」。安全写通道的判据按**输入分布**
表述（任意 patch、任意既有文件内容），不按案例打补丁。

## 0. 事实清单与消费者盘点（起草时核对过原文）

### 0.1 固定结构的位置

| 事实 | 锚点（起草分支） | 与本 change 的关系 |
|---|---|---|
| provider 闭集合枚举 `HarnessProvider { Kimi, Deepseek, Mock }` | `src-tauri/src/config.rs:608`；`as_str` / `parse` 在 `:614-635` | 改为「provider id 字符串 + 映射查表」，枚举整体删除 |
| 固定三字段容器 `HarnessProviders { kimi, deepseek, mock }` | `config.rs:937` | 改为 `BTreeMap<String, HarnessProviderConfig>` |
| 单个网络 provider 参数 `HarnessProviderConfig` | `config.rs:981` | 增加 `preset`；条目由映射键定位 |
| mock 独立结构 `HarnessMockConfig { fixture }` | `config.rs:1185` | `fixture` 并入统一条目（`preset = mock`），独立结构删除 |
| `config.json` 的 `[harness].providers` 解析镜像 `RawHarnessProviders` | `config.rs:1581` | 改为「对象 → 逐条解析」的宽容映射 |
| 生效配置 `HarnessConfig { provider, providers, ... }` | `config.rs:875` | `provider` 变 `String`（active id），`providers` 变映射 |
| 能力读取：`model_specs` / `context_window` / `effort_supported` / `wire_api` / `vision_supported` | `config.rs:1003-1061` | 全部改为按 id 查条目；未命中走既有保守默认 |
| 命名目标唯一解析口：`title_target` / `attachment_naming_target` | `config.rs:1070` / `:1104` | 参数从枚举改为 target id；目标不存在时回落到 active + warning |
| 校验入口：`validate_harness` / `validate_harness_provider` / `validate_wire_api` / `validate_harness_model_specs` / `validate_harness_mock` | `config.rs:2746` / `:3121` / `:3202` / `:3230` / `:3320` | 遍历映射逐条校验；provider 名不再硬编码 |
| 两张命名表校验：`validate_session_naming` / `validate_attachment_naming` | `config.rs:2960` / `:3041` | 收「映射 + active id」，target 按 id 解析 |
| 配置快照 `ConfigSnapshot { config, warnings, path, cron_issues, fallback }` | `config.rs:1385` | warnings 只有人话字符串；设置页需要结构化诊断（§7） |
| 读命令 `config_get` | `src-tauri/src/commands.rs:112` | 仍返回整份生效配置；设置面改用独立快照（§5） |
| 写通道 `config_set_value` / `write_config_value_to` / `merge_config_value` | `commands.rs:606` / `:637` / `:678` | 泛化合并写、不校验、无删键；样式写回与 chip 写回仍走它 |
| 读—改—写同锁 `update_json_atomic` + `CONFIG_WRITE_LOCK` | `config.rs:1812` / `:1831-1886` | 设置写通道必须复用同一把锁与同一个原子写 |
| 一次性迁移的既有先例：退役 kimi model 值 | `config.rs:1645-1770` | r3 的 preset 迁移沿用同一条形态（加载期一次改写、幂等、写失败只 warning） |
| 宽容读入（解析失败按 `{}`） | `config.rs:1890-1898` | 设置写通道要新增严格读，防盲写 |
| 配置 warning 唯一出口是 console + 诊断日志 | `src/main.ts`（`consumeConfigSnapshot` 段） | 设置页是第一个 UI 出口 |
| 图片命名开关启动闸 | `src/main.ts:1387-1402`（`semanticNamingEnabled`） | 「关→开需重启」不对称的来源 |
| 每回合现读配置 | `src-tauri/src/harness.rs:1409` | provider / 模型 / 开关的生效时机 = 下一回合 |
| 会话记录 `session_open.provider` | `src-tauri/src/harness/turn.rs:943` | 历史记录里的 provider 是自由字符串；读取侧不按枚举解析，无需迁移 |
| provider 请求闸按 `provider.as_str()` 取键 | `src-tauri/src/harness/scheduler.rs:149-168` | 键从 `&'static str` 变 `String`（动态 id） |
| 任务模型覆盖写回 `providers.kimi.model` / `providers.deepseek.model` | `src-tauri/src/harness.rs:1683-1711` | 改为写 `providers.<active>.model`（点分路径，见 §3.3 的 id 约束） |
| mock 判定散落四处 | `harness/subagents.rs:1686`、`:1875`；`harness/agents.rs:565`；`attachment_naming.rs:546` | 改为按条目 `preset == mock` 判定 |
| 前端 provider 闭集合常量与提取 | `src/harness-panel.ts:1528`（`PROVIDER_IDS`）、`:1571-1610`（`harnessSelection`） | 改为动态 id 列表 + 后端派生 `configured` |
| 前端 chip 选中与写回 | `src/harness-panel.ts:6151` / `:6179` | 写 `providers.<id>.model`；空态去向改为设置 |
| 模型缺失文案 D402 / D403 / D404 | `src/copy-data.ts:1152-1175` | 改写为「去设置」+ 多 provider + 补 `vision` |
| 生成类型 | `src/bindings/HarnessProvider.ts`、`HarnessProviders.ts` | 重导出后联合类型消失、容器变映射 |
| 验收套件的 provider 段读取口径 | `scripts/acceptance/README.md:447` | 从「恒列三档」改为「动态列表 + 空态」 |
| 键位表无 `Cmd-,`；原生菜单自建项只有 ⌘Q | `src/keys.ts` 全局绑定段；`src-tauri/src/lib.rs:580` | `⌘,` 可用 |
| 浮层可见性合同 O1–O5 | `docs/specs/overlay-visibility.md` | 设置面板适用 |
| 模型清单唯一来源是配置 | `config.rs:959-999`、`:922-934` | 本 change 不恢复任何内置模型表 |

### 0.2 消费者清单（改固定枚举要动的地方，逐面列出）

**计数口径（基线 `58bab1a5`；下面的命令可直接复跑）**：下面几个口径必须分开说，否则数字无法
复核——ts-rs 生成物会整体重写、测试与验收文档需要回扫、产品源码才是主要改动面。

```bash
# A 精确类型引用：含生成物、单测、注释与验收文档
git grep -l HarnessProvider 58bab1a5 -- 'src/**' 'src-tauri/**' 'scripts/**' 'tests/**' | wc -l   # 30
git grep -o HarnessProvider 58bab1a5 -- 'src/**' 'src-tauri/**' 'scripts/**' 'tests/**' | wc -l   # 255

# B 去掉 ts-rs 生成物（src/bindings/** 由 cargo test 整批重导出）
git grep -l HarnessProvider 58bab1a5 -- 'src/**' 'src-tauri/**' 'scripts/**' 'tests/**' ':!src/bindings/**' | wc -l   # 21
git grep -o HarnessProvider 58bab1a5 -- 'src/**' 'src-tauri/**' 'scripts/**' 'tests/**' ':!src/bindings/**' | wc -l   # 233

# C 产品源码（含 src/harness-panel.ts，不含生成物）
git grep -l HarnessProvider 58bab1a5 -- 'src-tauri/src' 'src' ':!src/bindings/**' | wc -l   # 13
git grep -o HarnessProvider 58bab1a5 -- 'src-tauri/src' 'src' ':!src/bindings/**' | wc -l   # 211

# D 测试与验收文档（6 个 Rust 集成测试 + 1 个 TS 单测 + 验收 README）
git grep -l HarnessProvider 58bab1a5 -- 'src-tauri/tests' 'tests' 'scripts' | wc -l   # 8
git grep -o HarnessProvider 58bab1a5 -- 'src-tauri/tests' 'tests' 'scripts' | wc -l   # 22
```

**A 的完整文件清单（30 个；括号内为该文件的出现次数，含注释与测试）**：

| 类别 | 文件（次数） | 小计 |
|---|---|---|
| 产品源码 Rust | `config.rs`(125)、`harness/llm.rs`(30)、`harness/thinking.rs`(12)、`harness.rs`(11)、`harness/title.rs`(7)、`harness/subagents.rs`(6)、`harness/turn.rs`(5)、`harness/run.rs`(4)、`harness/agents.rs`(4)、`harness/scheduler.rs`(3)、`attachment_naming.rs`(2)、`commands.rs`(1) | 12 文件 / 210 处 |
| 产品源码 TS | `src/harness-panel.ts`(1) | 1 / 1 |
| 生成类型（ts-rs） | `HarnessConfig`(6)、`HarnessProviders`(5)、`SessionNamingConfig`(3)、`AttachmentNamingConfig`(3)、`WireApi` / `ThinkingEffort` / `PermissionMode` / `HarnessProviderConfig` / `HarnessProvider` 各 1 | 9 / 22 |
| Rust 集成测试 | `session_recording.rs`(7)、`harness_runtime.rs`(4)、`harness_real_deepseek.rs`(3)、`harness_real_kimi_image.rs`(2)、`harness_real_kimi_cache.rs`(2)、`abort_turn.rs`(2) | 6 / 20 |
| TS 单测 | `tests/unit/harness-panel-control.test.ts`(1) | 1 / 1 |
| 验收文档 | `scripts/acceptance/README.md`(1) | 1 / 1 |
| **合计** | | **30 / 255**（非生成物 **21 / 233**；产品源码 **13 / 211**） |

**第二类：不含 `HarnessProvider` 类型名、但硬编码固定 provider 形状 / 选项的文件**。
这些是 `git grep HarnessProvider` 抓不到的实质消费者，实现与测试回扫时必须一起改：

- `src/ipc.ts`：注释写死 `providers.kimi.model` 的点分写回路径。
- `src/copy-data.ts`：D402 / D403 / D404 的 `harness.providers.{provider}.models` 文案。
- `tests/unit/harness-thinking-reset.test.ts`：构造 `provider: "kimi"` 的会话桩。
- `tests/visual/scenes/m347-harness-composer.spec.ts`：provider 选项与 `providers.kimi.model`
  写回断言。
- `tests/visual/scenes/m702-overlay-width.spec.ts`、`tests/visual/scenes/tauri-stub.ts`：
  `provider: "kimi"` 的配置桩。
- `scripts/acceptance/lib/app.mjs`：`h.providers.kimi` 的合成配置写入。
- `scripts/acceptance/scenarios/90-harness-model-chip.md`、`101-harness-k2-chip-disabled.md`、
  `102-harness-model-dimension.md`：provider / chip / model 维度的既有期望。
- `docs/specs/config-reference.md`：§1.5 / §1.6 / §1.7 / §3 的 provider id 取值表与写回路径。

按消费者类型归并：

| 面 | 文件 / 符号 | 现在依赖什么固定结构 | 改映射后 |
|---|---|---|---|
| 配置类型 | `config.rs` 的 `HarnessProvider` / `HarnessProviders` / `HarnessMockConfig` | 三档枚举、三字段容器、mock 独立结构 | id 字符串 + 映射 + 统一条目 |
| 能力读取 | `config.rs:1003-1061` 五个方法 | 对三个变体 `match` | 按 id 查条目；缺失 = 空清单 / 保守默认 |
| 命名解析 | `config.rs:1070/1104`、`harness/title.rs`（`title_target` 消费 + mock 装配测试） | 目标参数是枚举，五字段从固定字段取 | 目标 id 查映射；悬空回落 active |
| 校验 | `config.rs:2746-3350` | provider 名硬编码为 `"kimi"` / `"deepseek"`；mock 单独校验 | 遍历映射、按 preset 校验、warning 带全路径 |
| LLM 装配 | `harness/llm.rs:375/565/650/692/709/778` | `match` 三档；`store:false` 只按 `Kimi`；mock 借 kimi 的 model | 按 preset 取预设与 store 口径；active id 查条目 |
| 运行期写回 | `harness.rs:1683` | 写死两个 provider 的 model 字段 | 写 `providers.<active>.model` |
| 并发闸 | `harness/scheduler.rs:149` | `HashMap<&'static str, _>` | `HashMap<String, _>` |
| mock 分支 | `harness/subagents.rs:1686/1875`、`harness/agents.rs:565`、`attachment_naming.rs:546` | `config.provider == Mock` | `entry.preset == Mock`（或 `is_mock(id)`） |
| 会话记录 | `harness/turn.rs:618/943` | `context_window(&enum)`；`provider` 序列化为枚举 | id 字符串；历史记录按字符串读，无需迁移 |
| IPC | `commands.rs:112/606/637/678`、`src/ipc.ts` | `config_get` 形状是固定三字段；写通道点分下钻 | 形状变映射；chip 写回键 `providers.<id>.model`；设置面走 `settings_*` |
| 前端选择器 | `harness-panel.ts:1528/1571/6151/6179` | 闭集合常量；`id in providers` 推断「已配置」 | 动态 id；后端 `configured`；空态去设置 |
| 文案 | `copy-data.ts:1152-1175` | 单 provider、指向 config.json | 多 provider、指向设置面板、补 `vision` |
| 生成类型 | `src/bindings/HarnessProvider.ts` / `HarnessProviders.ts` 等 9 个文件 | 联合类型 + 三字段 | 重导出：联合类型消失、容器变映射 |
| 测试与桩 | `config.rs` 单测、`harness/thinking.rs`、`harness.rs`、`llm.rs`、`run.rs` / `turn.rs` 的 mock 段；`tests/session_recording.rs`、`harness_runtime.rs`、`harness_real_deepseek.rs`、`harness_real_kimi_cache.rs`、`harness_real_kimi_image.rs`、`abort_turn.rs`；`tests/unit/harness-panel-control.test.ts`、`tests/unit/harness-thinking-reset.test.ts`、`tests/visual/scenes/{m347-harness-composer.spec.ts,m702-overlay-width.spec.ts,tauri-stub.ts}` | 直接构造 `HarnessProviders { kimi, deepseek, mock }` 或 `provider: "kimi"` 桩 | 改构造 helper；新增迁移 / 回退 / 删除保护用例 |
| 验收套件 | `scripts/acceptance/README.md:447`、`lib/app.mjs`、场景 90 / 101 / 102 | 三档恒序列化；`h.providers.kimi` 合成配置 | 动态列表 + 空态；回扫既有 provider / chip 期望 |

**结论**：固定枚举的代价不是「设置页少一个按钮」，而是 **30 个文件、255 处引用**（去掉生成物
仍有 21 个文件 / 233 处；产品源码 13 个文件 / 211 处）共同假设「世界上只有三家 provider」。
只做编辑器、把增删留给「另立 schema change」，等于让用户继续为这个假设付费。本 change 的
scope 必须包含 schema 迁移本身。

## 1. 范围与信息架构

设置面只有两节，顺序固定：

```
设置（单页两节，无 TAB / 侧边导航）
├─ 模型接入（provider 列表 + 选中项的编辑表单）
│  ├─ provider 列表：每行 id + 预设标签 + 可用状态；当前使用项有徽标
│  ├─ 「+ 添加 provider」：id + 预设（创建后都不可改）
│  ├─ 编辑表单
│  │  ├─ 基础区：API Key（掩码）· 模型清单（id / effort / vision / window）
│  │  ├─ 高级区（默认折叠）：预设（只读）· Base URL · Wire 方言
│  │  └─ 危险区：删除此 provider（带保护与替代目标，见 §4）
│  └─ 空清单态：还没有 provider → 「添加第一个 provider」
└─ 自动化（全局节，不属于任何 provider）
   ├─ 自动压缩 / 子代理：一行一个开关
   └─ 会话命名 / 图片命名：开关 + **行内可编辑**的目标（provider / 模型）+ 一行生效说明
```

- **自动化是全局节**：四个开关的键在 `harness.*` 下，只有一份。provider 的切换 / 新增 /
  删除 MUST NOT 复制、重排、重置自动化节，也 MUST NOT 生成「Kimi 的会话命名 / DeepSeek 的
  会话命名」这类复本。
- **provider 列表可以增删改**：这是 r3 与 r1/r2 的实质差别。列表是设置页的一等公民，不是
  一个「固定两项」的分段控件。
- **模型清单只来自配置**：`models[]` 的唯一来源是 `config.json` 中该 provider 条目的
  `models`；系统不内置任何模型 id / 能力 / 窗口表，页面不提供「模型目录 / 推荐模型」。
  原型与截图里的模型 id 是**合成数据**。
- **不做的**：主题 / 语言 / 字号 / 折行 / 栏宽 / 权限 / 忽略规则 / 键位 / cron / 日志。
  这些键在设置页出现的代价不是「多一行」，而是同一读数出现两处写入口。
- **单页两节，不设导航**：没有 TAB、分段控件或侧边栏；不为编辑器 / 权限等未做的设置预留
  空壳页。第三类设置出现时另立提案并重新裁决形态（r4 已裁）。
- 页面是**固定两节**，不是通用 schema 表单：将来新增设置项要改前端，不靠 schema 自动长出
  控件——`describe-config` 仍是 backlog 里另立项的中期能力。

## 2. 数据模型：以稳定 id 为键的 provider 映射

### 2.1 schema

```jsonc
{
  "harness": {
    "provider": "kimi-work",            // active provider id；键可省（= 走 §2.5 的默认回退）
    "providers": {
      "kimi-work": {                    // id = 对象键，稳定、不可改
        "preset": "kimi",               // kimi | deepseek | generic | mock
        "api_key": "…",
        "model": "k3-256k",             // 可选；缺省 = models 清单首项
        "models": [
          { "id": "k3-256k", "effort": true, "vision": true, "window": 262144 }
        ],
        "base_url": "https://api.moonshot.cn/v1",  // 可选；缺省 = preset 官方地址
        "wire_api": "chat_completions"             // 可选；缺省随 preset（§2.2）
      },
      "local-lab": {
        "preset": "generic",
        "base_url": "http://127.0.0.1:8080/v1",
        "models": [{ "id": "local-chat", "effort": false, "vision": false, "window": 32768 }]
      },
      "mock": { "preset": "mock", "fixture": "/tmp/lumir-fixture.json" }
    },
    "session_naming": { "enabled": true, "provider": null, "model": null },
    "attachment_naming": { "enabled": true, "provider": null, "model": null },
    "auto_compact": true,
    "subagents": { "enabled": true }
  }
}
```

条目字段与非法处置：

| 字段 | 类型 | 缺省 | 非法处置 |
|---|---|---|---|
| `preset` | `kimi` / `deepseek` / `generic` / `mock` | 缺键 ⇒ `generic` + warning（迁移会把旧三档补上，见 §3） | 闭集合外 ⇒ **整条忽略** + 点名 warning（猜错协议比丢弃更危险） |
| `api_key` | string | `""` | 非字符串 ⇒ 整条忽略 + warning |
| `model` | string | 清单首项 id；清单空 ⇒ `""` | 非字符串 ⇒ 整条忽略 + warning；不在清单内 ⇒ 保留值 + warning（窗口 / 能力按保守默认） |
| `models` | array | `[]` | 非数组 ⇒ 整条忽略 + warning；元素逐项校验（§9） |
| `base_url` | string | kimi / deepseek 用预设官方地址；generic / mock 无 | 空串 ⇒ 视同缺省 + warning；generic 缺省 / 空 ⇒ 条目可用性为否 + warning |
| `wire_api` | enum | kimi / deepseek：`responses`；generic：`chat_completions`；mock：`responses`（不消费） | 闭集合外 / 该 preset 不支持 ⇒ 回落 preset 缺省 + warning |
| `fixture` | string | `null` | 仅 `preset = mock` 消费；其它 preset 上出现按未知键保留 |

- **条目级宽容**：`providers` 必须是对象（否则整文件回落，沿用 ADR 0002 §5 的既有模板）；
  单个条目形状非法只丢该条 + warning，MUST NOT 拖垮整份配置（与 `vault.ignore` 地图、
  `permissions.allow` 清单的逐项口径同族）。理由：动态 id 之后，一个手写条目的笔误不应连带
  丢掉 `last_vault`。
- **「映射」指有效条目**：下文（§2.2–§2.6、§4、§5）说的「条目 / 映射内」都是指校验后保留下来的
  有效条目；被丢弃的条目只存在于 raw JSON 里，不参与 active / 命名目标 / wire 的任何解析，
  但会出现在设置页的「装载期已忽略」行里（原因来自 `harness.providers.<id>` 的诊断）。
- **未知子键**：条目里设置面不认识的键在运行期忽略、在经设置面保存时原样保留（§6.5）。

### 2.2 preset 语义（行为由 preset 决定，不由 id 猜）

| preset | 官方 base_url | Responses 的 `store:false` | 超限特征串 | 支持的 wire | 缺省 wire | 是否要求 api_key |
|---|---|---|---|---|---|---|
| `kimi` | `https://api.moonshot.cn/v1` | 发送 `store:false` | kimi 预设表（现有） | `responses` / `chat_completions` | `responses` | 是（未配置则不可用） |
| `deepseek` | `https://api.deepseek.com` | 不发 | deepseek 预设表（现有） | `responses`（v1；chat 档未实现） | `responses` | 是 |
| `generic` | 无（`base_url` 必填才可用） | 不发 | 已知话术并集（保守识别，不承诺覆盖任意厂商） | `chat_completions` / `responses` | `chat_completions` | 否（空 = 不发 Authorization 头，见 Q9） |
| `mock` | 无 | 不经过 HTTP | 并集（验收要能模拟任一家） | 不消费 | `responses` | 否 |

- **preset 是显式的、不是从 id 推断的**：id 叫 `kimi` 不代表协议是 kimi。旧配置的三档由
  迁移显式补上 preset（§3），之后不再有「按 id 猜行为」的分支——一份数据只有一个真源。
- **多个同厂商 provider**：`preset` 可复用。例如工作 / 个人两把 Kimi Key 可建成
  `kimi-work` / `kimi-personal`，各自独立的 Key、模型清单与 Base URL，行为都走 kimi 预设。
  这正是固定枚举做不到的事。
- **`mock` 是保留 id**：`preset = mock` 只允许 id 恰好是 `mock`；其它 id 声明 mock 预设按
  整条忽略 + warning。设置页不呈现 mock、不允许删除它（验收专用档，配置可手写）。

### 2.3 provider id 规则（稳定 id）

- **id 是映射键，创建后不可改名**。「重命名」= 新增一个 id + 删除旧 id；旧 id 的未知子键与
  引用不会被静默继承。理由：id 是配置路径（`harness.providers.<id>.model` 会进
  `config_set_value` 的点分下钻）、会话记录的 provider 字段、命名目标的引用值三处的锚点，
  改名会同时制造三处悬空引用。
- 字符集：`^[a-z0-9][a-z0-9_-]{0,31}$`（小写 ASCII、数字、`-`、`_`；**不含点**——点分写回
  路径按 `.` 分段，点会在写通道里制造第二级键）。大写 / 空格 / 中文 / 空串一律拒绝并给
  人话错误；装载期命中非法 id 的条目整条忽略 + warning（它无法被任何写通道寻址）。
- 唯一性：同一映射内必然唯一（JSON 对象键）；「重复 id」只发生在**新增**动作上（目标 id 已
  存在）。后端 MUST 在锁内重新核对，不能只信前端草稿。
- `mock` 是保留 id：不可新增、不可删除（设置页不呈现）。
- 当前使用项的 id 与命名目标引用都按字符串精确匹配（区分大小写；因字符集只允许小写，实际
  不会出现仅大小写不同的两个 id）。

### 2.4 校验与回落

`validate_harness` 改为：

1. 解析 `providers` 对象 → 对每个键值对调用 `validate_provider_entry(id, value)`；
2. 逐条返回 `(id, entry, diagnostics)`；非法条目丢弃但保留在 raw 里（写回时不碰它）；
3. `provider`（active id）按 §2.5 解析；
4. `session_naming` / `attachment_naming` 按 §2.6 解析；
5. 其余键不变。

`configured`（是否可用）由 preset 决定：

```text
configured = match preset {
  Mock      => fixture 非空
  Generic   => !models.is_empty() && base_url 非空
  Kimi|Deepseek => !api_key.trim().is_empty() && !models.is_empty()
}
```

- 它是**派生读数**，不落盘；快照与模型 chip 都消费它，前端 MUST NOT 自己拼这个判据
  （REVIEW.md『同一语义两处真源』条）。
- `configured = false` 的 provider 仍可保存（半成品可以存在），但不可发送、不进 chip 的
  可选列表（当前使用项除外，见 §8）。

### 2.5 生效 provider 的解析与默认回退

```text
resolve_active(providers, raw_provider):
  1. raw_provider 是有效条目的 id（合法 preset、未被装载期忽略）→ 用它（不因未配置而换）
  2. raw_provider 缺省 → 按下列顺序取第一个 **configured 的非 mock** 条目：
       preset 顺序 kimi → deepseek → generic（同组内按 id 字典序）
  3. 没有 configured 条目 → 按同一顺序取第一个合法**非 mock** 条目
  4. 映射为空（或只剩 mock）→ 无 active provider（`""`）
  5. raw_provider 非空但不在映射内 → 按 2/3 回退 + warning（点名原值与落点）
```

- **只在「缺失 / 悬空」时回退**；显式选中但未配置的 provider 不会被自动换掉——那是用户
  的选择，发送时给「该 provider 未配置完整」的人话错误。
- 回退优先 **configured** 而不是纯字典序：文件被手改坏时，优先落到能用的 provider 上，
  而不是一个空壳。
- **回退只在「普通 provider」里选，`mock` 不参与**：`mock` 是验收专用档，只有显式
  `provider: "mock"` 才进入它。否则一份只剩 mock 的配置会在用户不知情时让整个应用进入
  fixture 驱动模式。显式写 `"mock"` 仍按 ① 生效。
- `harness.provider` 类型不符（非字符串）仍走整文件回落（既有模板）。
- 空字符串按「未写」处理 + warning（显式写空没有额外语义）。

### 2.6 命名目标的解析

`session_naming.provider` / `attachment_naming.provider` 从闭集合枚举改为 **provider id**：

```text
resolve_naming_target(providers, active, override):
  override 非空且是有效条目 id → override
  override 非空但悬空 / 被忽略 → active + warning（不阻断启动）
  override 缺省 / 空串         → active
```

- 每次触发只解析出**一个** provider + 一个模型，只发一次调用；MUST NOT 对每个 provider 各
  做一次（r2 已确定的产品语义，本版不变）。
- `model` 覆盖项仍然只能来自选定 provider 的 `models` 清单：会话命名不满足时回落该 provider
  的生效模型 + warning；图片命名**原样保留值**并在发起时因 vision 资格不通过而跳过
  （既有语义，§10）。
- **这两个覆盖键在设置面板里可编辑**（r4）：面板只写 `harness.<kind>.provider` 与
  `harness.<kind>.model` 两个键，解析语义仍是本条规则；面板提交的 `provider` 必须指向合法、
  非 `mock`、未被装载期忽略的条目，`model` 必须在该目标的清单内（patch 校验见 §6.1），所以
  面板本身不会产生新的悬空引用。手改文件造成的悬空仍按上面的回落 + warning 处理。
- 面板 MUST NOT 引入「按 provider 的命名模型矩阵」：仍只有两组全局键，编辑面只是这两组键的
  控件；provider 增删只刷新选项，不复制控件（§10.2）。

## 3. 迁移：一次性、无双写

### 3.1 迁移算法

现有文件的 `providers` 已经是「对象 + kimi / deepseek / mock 三个键」的形状，因此**不搬字段、
不改 id、不改值**，只补 `preset`：

```text
migrate_provider_presets(value) -> { rewritten: bool, entries: Vec<id> }
  providers = value.harness.providers
  若 providers 不是对象 → 不做任何事（留给整文件回落）
  对每个 (id, entry)：
    entry 不是对象 → 跳过（校验侧会给 warning）
    entry.preset 已存在 → 不动（用户显式值优先）
    id == "kimi"     → entry.preset = "kimi"
    id == "deepseek" → entry.preset = "deepseek"
    id == "mock"     → entry.preset = "mock"
    其它 id          → 不写（校验侧按 generic + warning 处理）
```

- **一次改写、幂等**：第二次加载时三个条目都已有 preset，`rewritten = false`，不再写盘。
- **无双写**：迁移在同一份 JSON 值上原地补齐后原子写回；不存在「旧结构和新结构并存」「旧键
  继续读」的第二条读取路径。改完之后代码里没有任何 enum 分支。
- **写失败不阻断**：与既有退役 model 迁移同口径——内存里的值已经补齐（本次生效值正确），
  只多一条 warning，下次加载再试。
- **未知 id 不迁移**：旧 schema 下 `providers.<其它 id>` 本来就被 serde 静默忽略；若用户手写
  过，新版本按 generic + warning 对待（条目出现、但不可用除非补 base_url）。这不是数据丢失，
  是把它第一次纳入管理。

### 3.2 迁移与退役 model 迁移的合并

加载期已经有一次写副作用（`migrate_retired_kimi_model`，`config.rs:1645`）。r3 把两次迁移
串在同一份 `serde_json::Value` 上，最多写盘一次：

```text
value = parse(file)
m1 = migrate_provider_presets(&mut value)
m2 = migrate_retired_kimi_model(&mut value)
if m1.rewritten || m2.rewritten { write_json_atomic(path, &value) }
```

两条迁移都幂等、都只改自己负责的键、都不碰未知字段。

### 3.3 历史会话记录不迁移

`session_open.provider` 与会话 JSONL 里记录的是**当时的 provider id 字符串**。字段形状本来就是
字符串，历史值 `kimi` / `deepseek` / `mock` 在动态 id 世界里仍是合法字符串。恢复会话不按
provider 重新解析（恢复语义不依赖它），因此 MUST NOT 改写历史文件。

## 4. 删除保护与替代目标

删除是**一次原子操作**，不是「先删条目、再让用户去别处修引用」。引用面分硬引用（删除后必须
有替代目标，否则拒绝整笔保存）与软引用（只提示，不阻断）。

### 4.1 引用面

| 引用 | 位置 | 类型 | 删除时 |
|---|---|---|---|
| 当前使用 | `harness.provider == id` | 硬 | 必须选择替代 active id（删除后仍有 provider 时）；删除最后一个 provider 时允许，active 变「无」 |
| 会话命名目标 | `harness.session_naming.provider == id` | 硬 | 必须选择「跟随当前 provider」或另一个 id |
| 图片命名目标 | `harness.attachment_naming.provider == id` | 硬 | 同上 |
| 命名模型覆盖 | `session_naming.model` / `attachment_naming.model` | 随目标 | 目标 provider 变化的，**清除 model 覆盖**（它属于旧 provider 的清单） |
| cron 任务的模型覆盖 | `[cron].tasks[].model` | 软 | 只提示「这些任务的模型覆盖将在下次运行时按当前 provider 重新校验」；不阻断（运行期已有回落 + warning） |
| 子代理定义的 `model` | 定义文件 | 软 | 同上；不阻断 |

- 命名目标默认跟随当前 provider（`provider: null`）。如果删除的是 active provider，而两个
  命名目标都是跟随，那么它们的目标**隐式**变化；UI MUST 在删除确认里把这条说出来，并清除
  两个 model 覆盖（若有）。
- 删除后 MUST NOT 留下任何硬引用；装载期仍对悬空引用做回落（§2.6），但那是手改文件的兜底，
  不是设置面允许产生的状态。

### 4.2 删除计划（后端在锁内计算，前端不得自行推断）

```rust
struct ProviderDelete {
    id: String,
    active_after: Option<String>,              // 删除 active 时必填（除非删后没有可替代候选）
    session_naming_after: Option<NamingRetarget>, // FollowActive | Provider(id)
    attachment_naming_after: Option<NamingRetarget>,
}
```

- 后端从**锁内构造的 candidate**（已应用本笔 Add / Update，但不信前端草稿）计算引用：
  - **可替代候选** = 合法条目中排除 `mock` 与装载期被忽略的条目；`mock` 与坏条目不能被选为
    当前使用项或命名目标的替代。
  - `id` 是 active 且删后仍有**可替代候选** → `active_after` 必须是其中一个，否则 `Blocked`
    （错误指向 `harness.provider`，文案给可选项）；
  - 任一命名目标显式等于 `id` → 对应 `*_after` 必填，否则 `Blocked`（错误列出两个命名表的
    键路径）；
  - `*_after = Provider(x)` 且 `x` 不在可替代候选里（不存在 / 等于被删 id / 是 mock / 被忽略）
    → `Blocked`；
  - 删除后没有可替代候选 → active 键删除、两个命名目标的 `provider` 键删除（= 跟随 active =
    无目标），允许但 UI 必须先确认（§4.4）。**映射里仍留着 `mock` 条目不算「还有 provider」**
    ——否则按了「删除最后一个」的用户会收到一条看不懂的 Blocked。
- 被清除的 `model` 覆盖随同一笔 patch 删除；`Blocked` 时文件逐字节不变。
- **替代目标的选择放在删除确认里**（同一屏、同一笔保存）：避免「先删掉再报错、让用户自己
  去别处修」的半状态。

### 4.3 未保存草稿的保护

- 被删 provider 在草稿里有未保存修改（Key / 模型 / Base URL / Wire 任一脏）→ 删除确认多一行
  「该 provider 有未保存的修改，删除会一并丢弃」。这是 UI 层的确认，不是后端错误（后端只看到
  最终 patch）。
- 删除其他 provider 不影响当前编辑项的草稿；当前选中项被删时，选中态落到替代 active 或列表
  首项。

### 4.4 空清单

- 允许删到零个 provider（用户可能只是清理）。删除确认必须写明后果：
  「删除后将没有 provider，发送消息会被挡下，直到你添加新的 provider」。
- 删到零后：`harness.provider` 键删除；composer 的模型 chip 进入空态（§8）；发送返回
  `harness_provider_missing`（指向设置）；设置页显示空态卡片 + 「添加第一个 provider」。
- 新增第一个 provider 时，同一笔 patch 自动把它设为 active（`active_provider = Set(new_id)`），
  否则用户体验是「添加成功但还不能用，得再去找 chip」。

## 5. 读：设置面快照

`settings_snapshot() -> SettingsSnapshot` 只暴露设置面的键，不把整份 `AppConfig` 交给页面。

```rust
pub struct SettingsSnapshot {
    pub path: String,
    pub file: SettingsFileState,          // Missing | Valid | Invalid { message, line, column }
    pub revision: Option<String>,         // 非 Invalid 恒有：Missing 按空对象算；Invalid = None
    pub providers: Vec<ProviderSettings>, // 规范顺序（§5.1），mock 不出现
    pub active: Option<String>,           // 生效 active id；None = 无 provider
    pub active_explicit: bool,            // harness.provider 键是否显式存在且合法
    pub automation: AutomationSettings,
    pub naming: NamingSettings,           // 两个解析后的目标 + 覆盖项 raw
    pub capabilities: SettingsCapabilities,
    pub defaults: SettingsDefaults,
    pub diagnostics: Vec<ConfigDiagnostic>, // 仅设置面路径 + 文件级
}

pub struct ProviderSettings {
    pub id: String,
    pub preset: Option<ProviderPreset>,    // None = 预设非法 / 未知（status = Invalid）
    pub raw_preset: String,                // 文件里的原文，供「装载期已忽略」行显示
    pub configured: bool,
    pub status: ProviderStatus,            // Ok | MissingApiKey | MissingModels | MissingBaseUrl | Invalid
    pub api_key: ApiKeyState,              // Unset | Set { hint: Option<String> }（末 4 位）
    pub models: Vec<ModelDraft>,           // raw 条目，含会被 validate 丢弃的坏项
    pub model: String,                     // 生效模型
    pub base_url: FieldState<String>,      // Absent | Present(raw)
    pub wire_api: FieldState<serde_json::Value>, // raw 原 JSON 值
    pub effective: ProviderEffective,      // 官方 base_url / 生效方言 / 有效模型清单
    pub references: ProviderReferences,    // active / session_naming / attachment_naming 布尔
    pub unknown_keys: Vec<String>,         // 仅键名，保存时保留
}

pub struct NamingSettings {
    pub session: NamingTargetState,
    pub attachment: NamingTargetState,
}

/// 一组命名目标：两个可编辑的覆盖键 + 解析结果 + 选择器选项（r4）。
pub struct NamingTargetState {
    pub override_provider: Option<String>,          // raw harness.<kind>.provider；None = 跟随当前
    pub override_model: Option<String>,             // raw harness.<kind>.model；None = 生效模型
    pub provider_options: Vec<NamingProviderOption>,// 合法、非 mock、未被忽略的目标，规范顺序
    pub model_options: Vec<NamingModelOption>,      // 目标 provider 的模型清单（含 vision）
    pub resolved: ResolvedNamingTarget,
}

pub struct NamingProviderOption { pub id: String, pub is_active: bool, pub configured: bool }
pub struct NamingModelOption { pub id: String, pub vision: bool, pub is_effective: bool }

pub struct ResolvedNamingTarget {
    pub provider: Option<String>,          // 解析后的目标 id
    pub model: String,                     // 解析后的模型（空 = 无可用模型 / mock）
    pub follows_active: bool,              // 是否来自缺省而非显式覆盖
    pub dangling: bool,                    // raw 覆盖悬空（已回落当前 provider）
    pub eligible: bool,                    // 图片命名：vision 资格；会话命名：模型非空
    pub reason: Option<String>,            // 不合格的原因码（D 编号文案在前端）
}
```

- **raw vs 生效**：`FieldState::Absent` 与 `Present` 区分「键缺席（跟随默认）」与「显式写了
  值」；`effective` 单独给装载后的读数。字段旁的「默认」徽标与「恢复默认」（删键）都靠它。
- **`wire_api` 的 raw 与生效分开**：raw 承载文件里的原 JSON 值（含闭集合外的字符串），生效
  方言在 `effective.wire_api`；前端显示生效值，raw 非法时旁注「装载期已回落」。
- **API Key 永不回传**：`Set { hint }` 至多带末 4 位；完整 Key 已经明文存在 `config.json`
  （Alex 已裁），但「界面不提供复制字段」是另一个决定。
- **`automation` 与 `providers` 平级，不挂在 provider 下**：四个开关的键在 `harness.*` 下，
  快照里只有一份 `AutomationSettings`（每个开关 `{ value, explicit }`——`explicit = false` 表示
  键缺席、用的是默认，前端据此显示「默认」徽标与「恢复默认」）；provider 切换只替换前端的
  表单草稿，不触碰它。
- **`naming` 是「可编辑的覆盖键 + 解析后的目标」**（r4）：`override_provider` /
  `override_model` 就是面板里的两个选择器（空 = 删键 = 跟随），`provider_options` /
  `model_options` 由后端按当前草稿的 provider 计算，前端 MUST NOT 自己拼清单或自行推导资格；
  `resolved` 只用于渲染那一行实际生效说明（跟随 / 指定 / 悬空回落 / 无 vision 跳过）。
- **关闭功能不清空快照**：开关关闭时快照照常回传两组 override 与选项，前端只把控件置灰
  （§10.2）。「禁用但保留」是 UI 层行为，MUST NOT 在快照或 patch 里把值抹成空。
- **`capabilities` 由后端下发**：预设表（官方 base URL / 支持的 wire / 缺省 wire / 是否要求
  Key）、`window` 上下限、provider id 的正则与保留 id、规范顺序；前端 MUST NOT 复制这些常量
  或取值区间（与 `window` / 枚举同一条「单一校验来源」纪律）。
- **`references` 供删除确认用**：`active` / `session_naming` / `attachment_naming` 三个布尔，
  前端据此渲染替代目标控件；后端在 apply 时重新计算（§4.2），两者不互为真源。
- **规范顺序**（列表展示与 revision 遍历共用）：按 preset 分组 `kimi` → `deepseek` →
  `generic` → `mock`，组内按 id 字典序；mock 不出现。`serde_json` 默认按对象键排序落盘，
  所以文件里的顺序不承载语义，展示顺序由本规则决定。
- **既有 `config_get` 的契约不变**：它仍返回完整生效配置（含 `api_key`），服务启动装配与
  既有面板。设置面 MUST NOT 消费它的 `api_key` 字段，也不新增第二处暴露；收窄它是另一个
  change。
- `file = Invalid` 时，`providers` / `automation` 仍尽力从 raw JSON 按路径读出（只读展示），
  但 `apply` 一律拒绝（§6.6）。

## 6. 写：强类型 patch + CAS

`settings_apply(patch) -> SettingsApplyOutcome`。

```rust
pub struct SettingsPatch {
    pub base_revision: String,
    pub active_provider: Option<FieldEdit<String>>, // Set(id) | Reset（删键）
    pub providers: Vec<ProviderEdit>,
    pub automation: AutomationPatch,
    pub naming: Option<NamingPatch>,                // r4：两个命名目标的覆盖键
}

pub struct NamingPatch {
    pub session: Option<NamingEdit>,                // None = 本笔不动会话命名目标
    pub attachment: Option<NamingEdit>,
}

/// 每个键独立：None = 不动该键；Set = 写入；Reset = 删键（provider 删键 = 跟随当前，
/// model 删键 = 用目标 provider 的生效模型）。
pub struct NamingEdit {
    pub provider: Option<FieldEdit<String>>,
    pub model: Option<FieldEdit<String>>,
}

pub enum ProviderEdit {
    Add { id: String, preset: ProviderPreset },
    Update {
        id: String,
        api_key: Option<ApiKeyEdit>,          // None = 不动；Replace(String) | Clear
        models: Option<Vec<ModelInput>>,      // None = 不动；Some = 整表替换（四项全显式）
        base_url: Option<FieldEdit<String>>,  // Set | Reset（删键）
        wire_api: Option<FieldEdit<WireApi>>,
    },
    Delete(ProviderDelete),
}

pub struct ModelInput { pub id: String, pub effort: bool, pub vision: bool, pub window: u64 }
pub enum FieldEdit<T> { Set(T), Reset }
pub enum ApiKeyEdit { Replace(String), Clear }
pub enum NamingRetarget { FollowActive, Provider(String) }

pub struct SettingsApplyOutcome {
    pub status: SettingsApplyStatus, // Applied | Blocked | Conflict | FileInvalid
    pub snapshot: SettingsSnapshot,  // 每次返回最新快照
    pub errors: Vec<SettingsFieldError>, // path + code + message
    pub warnings: Vec<ConfigDiagnostic>,
}
```

- 所有结构 `deny_unknown_fields`；未知字段 = 协议错误，不静默忽略。
- `preset` 只在 `Add` 出现；`Update` 没有 preset 字段——**预设创建后不可改**。想换协议就
  新增一个 provider 再删旧的（§2.2）。
- `Add` 只带 `id` + `preset`，其余字段为空（可作为半成品保存）；添加第一个 provider 时前端
  同一笔 patch 带 `active_provider = Set(new_id)`。
- `Reset` 是**删键**（Base URL / Wire / 四个开关 / active / 命名目标）；`api_key.Clear` 同样是
  删键（回到未配置）。「恢复默认」不会把默认值钉进文件。
- **命名目标的两个选择器就是两个键的编辑面**（r4）：provider 的「跟随当前 provider（默认）」
  = `Reset`（删 `harness.<kind>.provider`），具体 id = `Set`；模型的「生效模型（默认）」
  = `Reset`（删 `harness.<kind>.model`），具体模型 = `Set`。
- **同一笔里 provider 与 model 的先后是语义**：先应用 provider 变化（换目标会清除旧 model
  覆盖），再应用显式 model；因此同一笔 `Set(provider)` + `Set(model)` 合法，且 model 按**新
  目标**的清单校验。`Reset(provider)` 同时清除 model 覆盖（跟随当前即没有「旧目标的模型」）。
- **开关关闭不改变 patch 的内容**：前端按草稿提交目标键；关闭功能只让控件不可编辑，MUST NOT
  因为开关关闭就发 `Reset`（那等于把用户的选择抹掉）。
- **同一笔 patch 不允许「删掉 id X + 新增 id X」**：处理顺序不应承载语义，id 复用要拆成两次
  保存（先删、再新增）。想换 preset 时直接用一个新 id（设计本来就要求「新增 + 删除旧」）。

### 6.1 一次 apply 的完整序列

```text
1. 取 CONFIG_WRITE_LOCK
2. 严格读 config.json：
     不存在        → 视为空对象
     JSON 解析失败 → FileInvalid，文件不动，返回解析错误（line/column）
     非对象        → FileInvalid
3. 反序列化为 RawConfig；失败 → FileInvalid
4. baseline = validate(raw) 的诊断（只用于未改路径豁免）
5. revision(raw) != patch.base_revision → Conflict，文件不动
6. 按序应用 patch：
     6.1 Add：id 字符集 / 保留字 / 已存在（**含本笔 patch 要删除的条目**）→ Blocked；
         写入 {preset}；id 复用（删掉旧条目、同一笔再加同名 id）一律拒绝，拆成两次保存
     6.2 Update：id 不存在 → Blocked；只改提交的字段
     6.3 Delete：按 §4.2 计算引用与替代目标，缺目标 / 目标非法 → Blocked；
         删除条目、改写 active 与两个命名目标、清除被牵连的 model 覆盖
     6.4 active_provider：Set 的 id 必须在（应用后的）映射内；Reset 删键
     6.5 automation：开关 Set / Reset
     6.6 naming：按 session / attachment 逐组应用；provider 先——Set 必须是应用后映射内
         合法、非 mock、未被忽略的条目，换目标 / Reset 一律清除该组 model；model 后——
         Set 必须在该组目标 provider 的清单内，Reset 删键
7. 反序列化 candidate 为 RawConfig：失败 → Blocked（只能是 patch 引入的）
8. diagnostics = validate(candidate).diagnostics
9. 非回归判据（§6.3）：与改动路径相交的阻断级诊断 → Blocked，文件不动
10. 引用完整性复核：active / 两个命名目标均不存在悬空（§4.1）
11. 原子写 candidate（tmp + sync + rename，复用 write_file_atomic）
12. 释放锁；返回 Applied + 重新读出的 SettingsSnapshot
```

- **锁内比对 revision**：读 revision、比对、写必须在同一把锁内，否则是 check-then-write
  竞态（REVIEW.md『cargo 锁「先复核再创建」』条的同类形态）。
- **复用唯一原子写实现**：不新增第二套 tmp/rename；新增的只是严格读变体
  （`update_json_atomic_strict`，与 `update_json_atomic` 共用同一把锁与同一个
  `write_file_atomic`）。
- **既有写入口顺带收口**：`write_config_value_to` / `write_last_vault_to` 改为在
  `update_json_atomic` 闭包内读—改—写（今天读在取锁之前，见 `config.rs:1852-1859`）。
  设置页是新增写者，不关掉这条窗口，chip / 主题 / 设置页三者仍会丢更新。

### 6.2 revision 的口径

```text
revision = sha256(canonical_json({
  "provider": <raw active id / absent: null>,
  "providers": {
    <id>: { preset, api_key, models, base_url, wire_api, fixture, <unknown keys> },
    ...                                  // 全量；**不含 providers.<id>.model**
  },
  "auto_compact":      <present: value | absent: null>,
  "session_naming":    { enabled, provider, model },
  "attachment_naming": { enabled, provider, model },
  "subagents":         { enabled }
}))
```

- **覆盖设置面能写的全部键**：provider 条目、active id、四个开关、两个命名目标（面板可编辑，
  删除也会改）。
- **不覆盖 `providers.<id>.model`**：它由 composer 的 chip 写回（`config_set_value`）；把它
  纳入 revision 会让「面板打开时切一次模型」变成一次无意义的冲突。
- **覆盖 `session_naming.model` / `attachment_naming.model`**：面板会直接编辑它们（r4），删除
  provider 也会清除它们；若外部在面板打开期间改了这两个值，必须让用户看到冲突，不能静默
  覆盖。
- `models` 的 raw 数组整体入 hash（含未知子键），外部改任何一条都会触发冲突。
- `wire_api` 入 hash 的是 **raw JSON 值**（含非法字符串），不是生效枚举。
- `api_key` 入 hash：外部改了 Key，保存时必须让用户知道。
- `revision` 是快照顶层字段：`Missing` = 把文件视为空对象后按同一函数计算（首次接入的
  主路径）；`Invalid` = `None`，保存禁用。

### 6.3 非回归判据（「不把整文件回落的风险留给前端」）

**改动路径集合 `changed_paths`**：

| patch 项 | 路径 |
|---|---|
| Add / Delete provider | `harness.providers.<id>`（含全部后代） |
| Update api_key / models / base_url / wire_api | `harness.providers.<id>.<field>`（models 含 `[i]` 后代） |
| active_provider | `harness.provider` |
| 四个开关 | `harness.auto_compact` / `harness.session_naming.enabled` / `harness.attachment_naming.enabled` / `harness.subagents.enabled` |
| 删除牵连的命名目标 / model 覆盖 **或命名目标编辑** | `harness.session_naming.provider` / `.model`、`harness.attachment_naming.provider` / `.model` |

**相交判据**：诊断路径与改动路径逐段比较，满足「相等 / 诊断在改动路径之下 / 诊断是改动路径的
祖先」之一即相交（`providers.kimi` 与 `providers.kimi.models[2].window` 相交）。

**阻断级诊断**（`RejectOnWrite`；词表是 Rust 里的一张显式表，不在前端）：

- `harness_model_id_empty` / `harness_model_id_duplicate` / `harness_model_window_invalid` /
  `harness_model_effort_invalid` / `harness_model_vision_invalid`
- `harness_models_empty_when_configured`（有 Key、无模型 = 半配置）
- `harness_wire_api_invalid` / `harness_wire_api_unsupported`
- `harness_base_url_empty`（空串是显式错误输入；「用官方地址」应发 `Reset`）
- `harness_base_url_required`（generic 预设缺 base_url）
- `settings_provider_id_invalid` / `settings_provider_id_duplicate` /
  `settings_provider_reserved_id` / `settings_provider_not_found` /
  `settings_provider_preset_immutable`
- `settings_active_provider_missing` / `settings_provider_delete_active_requires_target` /
  `settings_provider_delete_referenced` / `settings_naming_target_missing` /
  `settings_naming_model_missing`
- `settings_unknown_field`

**放行规则**：candidate 中**任何**阻断级诊断，只要路径与 `changed_paths` 相交，整笔 Blocked
——**不看 baseline 是否已有同一条**。baseline 只豁免**未改路径**上的既有诊断（例如 provider A
已有越界 window，用户只改 provider B 的开关 → 允许）。

这条规则必须「看 candidate × changed paths」，不能退化成「看新增诊断」：窗口越界的全部取值
（`0`、`10000001`、非整数）产出**同一 code / path / message**；`0 → 10000001` 按「新增诊断」
完全看不出变化，但它确实与改动路径相交，必须拒绝。

| baseline | patch | 期望 |
|---|---|---|
| 同一项 `window: 0` | 同一项改为 `10000001` | Blocked |
| 同一项 `window: 0` | 同一项改为 `262144` | Applied |
| provider A 已有非法项 | 只切 provider B 的某个开关 | Applied（未改路径豁免） |
| provider 条目有未知子键 | 只改同一项 `window` | Applied，未知子键保留 |
| 新增 generic 条目并填了 Key、但缺 base_url | Add/Update | Blocked（路径相交） |
| 删除 provider，命名目标悬空且未给替代 | Delete | Blocked，文件不变 |

**为什么不用「前端先校验」**：id 字符集、preset 能力、窗口区间、模型 id 唯一性若在 TS 再写
一份，就是 REVIEW.md『同一语义两处真源』条。前端只做输入整形（trim、`type="number"`、按
`capabilities` 置灰选项），语义裁决全在后端；错误回填带 path，前端按 path 挂到控件。

### 6.4 半配置与「可保存的最小状态」

- `api_key` 非空而 `models` 为空（kimi / deepseek / generic 均适用）→ 阻断，错误指向
  `harness.providers.<id>`，文案给两条出路：添加至少一个模型，或清除 Key。
- `api_key` 为空而 `models` 非空 → 允许（保存清单本身合法；kimi / deepseek 预设只是尚不可用）。
- `generic` 的 `base_url`：条目**已有 Key 或模型清单**时必填，缺失 / `Reset` 删掉即阻断
  （缺了无法构造任何请求）；完全空的 generic 条目例外——它是「刚点添加、还没填」的半成品，
  允许保存，`configured = false`。否则「添加一个 generic provider 后先保存」和「还原此页
  默认」都会变成不可保存的死路。
- Add 一个完全空的条目 → 允许（半成品可以存在，`configured = false`），但 UI 必须显示
  「未配置完整」状态；它不进 chip 的可用列表。
- **页级「还原此页默认」不删 provider 条目本身**：它把每个条目的 Key / 模型清单 / Base URL /
  Wire 与本页四个开关标为删除，并删除 `harness.provider`；provider id 与 preset 是身份，
  不是设置值，保留。这样还原后的文件仍可保存（空条目是合法状态），列表也不会突然清空。
- 两个 provider 互不影响：只编辑 kimi 时，deepseek 的半配置状态不在 `changed_paths` 里，
  不阻断（即使 baseline 里已经存在）。

### 6.5 未知字段保留

- **provider 条目**：Update 只改提交的字段路径，条目里设置面不认识的键（未来版本写的字段、
  用户备注）原样保留；Add 不产生未知键；Delete 整条移除（未知键随条目消失，属预期）。
- **models[]**：整表替换前，对每个提交项按 `id` 在**当前 raw 清单**里找第一条全等项；命中则
  把该项里除 `id` / `effort` / `vision` / `window` 之外的键原样并入提交项。新增 id 或 id 被
  重命名 → 不复制旧键（重命名 = 新条目）。
- 文件里其它节、以及 providers 下被丢弃的非法条目，本来就不在 patch 的路径上，merge 天然保留。
- 代价：同 id 的两条历史项只跟第一条走——清单里重复 id 本身会被阻断，不会成为既有状态。

### 6.6 文件不可解析 / 整文件回落

- `RawConfig` 解析失败（任何一节类型不符）→ `FileInvalid`：面板顶部横幅给 `path` + 解析
  错误行号，保存禁用、字段只读。理由：装载期整文件回落意味着**当前生效值不是用户的配置**，
  此时写入会把一份用户没看见的默认状态盖到坏文件上。
- JSON 本身不合法 → 同上，多给一行「文件不是合法 JSON」。
- 文件不存在 → 视为空对象，正常可写（首次启动）。
- 文件可解析但部分条目被 `validate` 丢弃 / 回落 → 正常可写；相关诊断在设置面范围内展示，
  保存时不碰未改动的路径，坏值原样留在文件里（由用户决定修还是留）。设置页 MUST 把这些
  坏条目显示出来（「装载期已忽略」徽标 + 原因），MUST NOT 让它们从列表里消失——否则一次
  保存就会静默清掉文件里的坏项。

### 6.7 生效时机

| 设置面字段 | 生效时机 | 面板提示 |
|---|---|---|
| provider 条目（key / models / base_url / wire_api）、active provider | 下一回合（`harness.rs:1409` 每回合现读） | 「已保存 · 下一回合生效」 |
| auto_compact | 下一回合 | 同上 |
| session_naming.enabled | 下一次评估触发点（在途结果落盘前复核开关，关掉即丢弃） | 「已保存 · 下一次评估触发时生效」 |
| subagents.enabled | 下一回合 | 同上 |
| attachment_naming.enabled | 关→开需重启；开→关立即 | 命中「关→开」时提示「重启后生效」 |
| 命名目标 / 模型覆盖 | 每次触发现读（下一次评估 / 下一次粘贴） | 「已保存 · 下一次触发时生效」 |

面板 MUST NOT 声称「已生效」：保存成功只代表文件写成功。会话命名的结果还是**异步**的：
后台调用完成、且会话空闲时才落盘；MUST NOT 把保存状态写成「下一轮必定生效」。

## 7. 诊断单一来源

### 7.1 结构

`validate()` 的 warning 生产改为「结构化诊断 + 派生字符串」：

```rust
pub struct ConfigDiagnostic {
    pub code: String,                 // 稳定 code，供前端分类 / 计数 / 阻断表
    pub path: Option<String>,         // 键路径；文件级为 None
    pub severity: DiagnosticSeverity, // Warning | RejectOnWrite
    pub message: String,              // 现有的人话文案，逐字不变
}
```

- `ConfigSnapshot.warnings: Vec<String>` **保持现有形状**，由 `diagnostics.iter().map(message)`
  派生——现有 warning 文案断言、诊断日志、前端 console 出口全部零改动。
- `validate()` 内部把 `&mut Vec<String>` 换成 `DiagnosticSink`：`warn(code, path, message)`
  仍是同一条人话文案，只多带 code / path。**不存在第二份校验逻辑**。
- 阻断级与否由 code 在构造点决定（同一张表），不是设置页再判一次。

### 7.2 设置页的 warning 呈现

- 只展示 `path` 在设置面范围内（或 `None` 的文件级）的诊断；`theme` / `editor` 之类的 warning
  不进这个面板。
- provider 条目的诊断挂在对应条目 / 字段下；命名目标的诊断挂在自动化节内并带键路径
  （不单独渲染摘要框）；被丢弃的非法
  条目在 provider 列表里显示「装载期已忽略」行（不可编辑，只能删除或去配置文件修）。
- 整文件回落 `fallback == true` 或 `file = Invalid` → 顶部横幅，优先级高于字段级。

## 8. 模型 chip 与配置缺失

- `HarnessProviderConfig` 增加派生 `configured`（§2.4）。
- 模型 chip 的 provider 选项 = **configured 的 provider ∪ 当前 provider**，按 §5.1 的规范
  顺序排列；mock 恒被过滤。当前 provider 即使不可用也保留（否则 chip 会消失，用户看不到自己
  正处在一个坏配置上）。
- **空态**：没有任何 provider（或没有任何 configured 且无 active）时，chip 显示「未配置模型」；
  点开选择器 = 一行「还没有可用的 provider」+「去设置」动作（打开设置面板）。
- **切换当前 provider**：chip 与设置面板都可以写 `harness.provider`（设置面板在
  provider 列表上提供「设为当前使用」，也是删除 active 时必须选替代目标的地方）。两者都经
  配置写通道、都下一回合生效；MUST NOT 打断进行中的轮次。设置面板不再是「只能换编辑面」的
  纯选择器——r2 的这条限制随 provider 管理一起解除（见 Q7）。
- 设置页保存后 chip 的刷新：面板关闭时发一次既有 `configGet` 重取，不引入全局配置状态层。

## 9. 模型清单与 vision 指引（harness delta）

### 9.1 `models[]` 元素 schema

| 字段 | 类型 | 缺省 | 非法处置 |
|---|---|---|---|
| `id` | 非空字符串，清单内唯一 | 无（必需） | 丢该项 + warning |
| `effort` | 布尔 | `false` + warning | 丢该项 + warning |
| `vision` | 布尔 | `false` + warning | 丢该项 + warning |
| `window` | 整数 `1..=10_000_000` | `131072` + warning | 丢该项 + warning |

- 未知子键：运行期忽略，设置页保存时按 §6.5 保留。
- **来源唯一**：生效清单只来自该 provider 的 `models`；系统 MUST NOT 内置模型 id / 能力 /
  窗口表，设置页 MUST NOT 提供「可用模型目录 / 推荐模型」。
- **provider 集合是动态的**：任何合法 id 都可以有清单；不存在「闭集合外」这个概念。
- 生效清单 = 逐项校验后按原顺序保留的项；`model` 缺省 / 空串取首项；当前 `model` 不在清单内
  时保留该值、窗口按 `FALLBACK_CONTEXT_WINDOW` 保守估算、`effort` 与 `vision` 都按不支持
  处理（既有行为）。
- 任何用户可见的模型声明指引 SHALL 同时列出 `id` / `effort` / `vision` / `window` 四项。

### 9.2 vision 与图片命名

- `vision` 是图片发送闸与图片命名的唯一依据；provider 动态化不改变这条。
- 图片命名的目标解析（§2.6）之后，仍要求目标 provider 的清单里该模型声明
  `vision: true`；不满足即跳过、保留暂存名、不换模型。
- 设置页的图片命名行 MUST 在**模型选择器**上标出资格（每项后缀 `✓ vision` 或
  `未声明 vision`），并在选择旁的那一行生效说明里写出解析后的目标与后果（例如
  「实际：kimi-work / k3-256k ✓ vision · 跟随当前 provider · 下一次粘贴生效」或
  「实际：local-lab / local-chat · 未声明 vision → 粘贴图片不会改名，保留暂存名」）。
  MUST NOT 为「哪个模型能做图片命名」另建一块摘要或矩阵。

## 10. 自动化与命名目标呈现

### 10.1 四个全局开关

| 开关 | 键 | 默认 | 行为（可上屏的准确表述） | 敏感 | 时机 |
|---|---|---|---|---|---|
| 自动压缩 | `harness.auto_compact` | `true` | 上下文接近上限时压缩并开新会话 | 费用（多一次压缩调用） | 下一回合 |
| 会话命名 | `harness.session_naming.enabled` | `true` | 首轮生成；此后 5 轮周期重估、漂移可提前、失败按自然节奏重试、单飞行、异步落盘（§10.3） | 出域 + 费用（一次便宜档调用） | 下一次评估触发点 |
| 图片命名 | `harness.attachment_naming.enabled` | `true` | 每次粘贴新图异步命名；目标无 `vision` 时跳过、保留暂存名 | 出域 + 费用（一次视觉调用） | 关→开重启；开→关立即 |
| 子代理 | `harness.subagents.enabled` | `true` | 允许主对话派生并行子代理 | 费用（独立计费） | 下一回合 |

- 四个开关是 `harness.*` 下的**全局键**，不属于任何 provider：provider 的增 / 删 / 切换
  MUST NOT 复制、重排、重置它们的值或 DOM。
- 每行显示「默认」徽标（键缺席）与「恢复默认」（显式存在时，动作 = 删键）。

### 10.2 命名目标：内联可编辑、一处解析、一次调用

- 两个命名调用默认跟随**当前使用**的 provider 与它的生效模型。
- `config.json` 的 `harness.session_naming.provider` / `.model` 与
  `harness.attachment_naming.provider` / `.model` 可单独覆盖目标；每次触发只向解析出的
  **一个** provider + 一个模型发起**一次**调用，MUST NOT 对每个 provider 各做一次。
- **面板把这两组覆盖键做成各自开关行里的两个选择器**（r4）：
  - provider 选择器：「跟随当前 provider（默认）」= 删键；其余选项 = 合法、非 `mock`、未被
    装载期忽略的条目（规范顺序，当前项带标记）。
  - 模型选择器：选项 = **目标 provider 的 `models`**；「生效模型（默认）」= 删键；图片命名
    每个选项后缀 `✓ vision` / `未声明 vision`。
  - 换 provider 时旧 model 覆盖被清除（它属于旧 provider 的清单）；同一笔保存里显式选的
    model 按**新目标**校验（§6.1）。
  - 选择改变只改草稿；点「保存」才写入，生效时机见 §6.7（下一次评估触发点 / 下一次粘贴）。
- **关闭功能时禁用但保留**：两个选择器置灰；选择、草稿与 `config.json` 里的键都不变，
  那一行说明改为「已关闭：不发起命名调用；选择保留（…），重新开启后按此目标执行」。
  MUST NOT 在关闭时清空选择或写空值——「关闭」表达的是不调用，不是「忘掉目标」。
- **每组目标只有一份全局键**：不为每个 provider 复制选择器，也不做「按 provider 的命名模型
  矩阵」；provider 增删 / 切换只刷新选项与那一行说明，开关行本身不重排（§11.6）。
- **只有一行生效说明，没有独立摘要框**（r4）：见 §10.5。同一读数 MUST NOT 再以第二块形式
  出现——两处必然漂移。
- 诊断（悬空覆盖、模型不在清单）挂在自动化节内并带键路径。
- 删除 provider 会重定向这些覆盖项（§4）；保存后两个选择器与那一行说明立即按新目标重绘。

### 10.3 会话命名的触发节奏（文案唯一事实源）

上屏文案 MUST 与 `harness/title.rs` 的 `TitleSchedule` 一致，MUST NOT 简化成「每轮生成」：

- **首轮**：逻辑会话首个正常完成的轮即生成初始标题（`reason=first-turn`）。
- **周期**：距上一次评估满 **5 轮**时重估（`cadence`）。
- **漂移提前**：已有标题时，连续两条用户消息（各 ≥8 码点）与标题的确定性词元重合度 < 0.2
  （标题词元 ≥3 个才判）即命中；但任两次评估 MUST 至少间隔 **3 轮**。
- **失败重试**：触发时即记一次评估，失败也算；尚无有效标题时在下一个满足 3 轮间隔的正常完成
  轮重试初始生成。已有标题时失败不立即重试，按自然节奏再来。
- **单飞行**：同一逻辑会话同时最多一个命名调用在途；在途期间的触发点直接跳过、不排队。
- **异步落盘**：命名在 `release_turn` 之后的后台线程执行（锁外 HTTP）；落盘前重新取会话锁并
  复核「同 vault / 同 session / 会话空闲 / 开关仍开」，任一不满足即丢弃；记录只在会话空闲时
  追加，MUST NOT 插进一对 `llm_request` / `llm_response` 之间。
- 因此面板 MUST NOT 写「每轮生成」或「下一轮必定生效」；正确表述是「从下一次评估触发点起
  生效，结果在会话空闲时异步落盘」。

### 10.4 图片命名的触发与资格

- 每次粘贴**新写盘**的图片异步排一次命名（串行队列，同一文件至多一个任务；去重命中、已是
  语义名、开关关闭时不投递）。粘贴路径只多一次 invoke 投递，MUST NOT 等待模型。
- 目标模型必须由目标 provider 的 `models` 声明 `vision: true`；不满足即跳过、保留暂存名。
- `attachment_naming.enabled` 关→开需重启（前端投递闸读启动装载值），开→关立即（后端每次
  调用现场读配置）。重启不对称必须在**行内**写出。

### 10.5 行内目标与生效说明（取代原独立读数块）

r4 移除了自动化节顶部的独立读数块。现在的唯一呈现是每个命名行末尾那一行：

```
会话命名  发往 [跟随当前 provider（默认） ▾] [生效模型（默认：k3-256k） ▾]
          实际：kimi-work / k3-256k · 跟随当前 provider · 下一次评估触发点生效
图片命名  发往 [跟随当前 provider（默认） ▾] [k3-256k ✓ vision ▾]
          实际：kimi-work / k3-256k ✓ vision · 跟随当前 provider · 下一次粘贴生效
```

- 目标 provider 被删除 / 覆盖项悬空时，说明写「… · 覆盖项悬空，已回落当前 provider」；选择器
  保留那个悬空的原始 id（选项标「不存在，已回落」），让用户看见文件里的旧值而不是被静默
  规范化。
- 图片命名没有 vision 资格时，说明写「未声明 vision → 粘贴图片不会改名，保留暂存名」。
- 关闭时写「已关闭：不发起命名调用；选择保留（<provider> / <model>），重新开启后按此目标
  执行」。
- 这一行在 provider 增删 / 切换后立即重算（草稿态也按草稿的 active 计算，便于用户预判）。
- MUST NOT 把这一行扩成多行读数、表格或第二块卡片：一行之外的信息属于行内描述（节奏 /
  敏感性），不属于目标读数。

## 11. 视觉保真（有原型，必填）

原型：`design/prototypes/model-automation-settings-oct24.html`（自包含、合成数据、内置控制
面板；三主题）。实现按**观感一致**验收，不逐像素对齐。

### 11.1 面板骨架

- **遮罩**：`var(--scrim)`；遮罩与卡片之间无描边。
- **卡片**：宽 `780px`（`max-width: 100%`），`max-height: calc(100vh - 64px)`；遮罩内边距
  32px；`var(--preview-bg)` + 1px `var(--border)` + `var(--r10)` 圆角 + `var(--shadow-raise)`；
  eink 升到 `1.4px` 边框、无阴影（与 `.lumir-bindings-panel` 同配方）。
- **头部**：标题 15px / 650；副标题 12px `var(--text-3)`（配置文件路径）；关闭钮 16px 图标，
  静息 `var(--text-3)`、hover `var(--text)`。
- **正文**：单列两节；节与节之间 16px 间距 + 1px `var(--border)` 分隔线；每节内容装在一张
  1px `--border-soft` / `--r8` 的 pane 卡片里（自动化与模型接入各自独立，不嵌套）。节标题
  11px / 650、`letter-spacing: 0.08em`、`var(--text-3)`。
- **底部**：粘在卡片底部，1px `var(--border)` 上边线，`padding: 12px 24px`；左「还原此页
  默认」，中状态行，右「取消」「保存」（保存 = `--accent-fill` 实底，28px 高，`--r5`）。
- **焦点**：所有可聚焦控件 2px `--accent` 环 + 2px offset；eink 用 2px 黑环。
- 卡片打开/关闭不产生布局重排；动效 120ms 透明度，`prefers-reduced-motion` 下取消。

### 11.2 模型接入：provider 列表（左列）

- 模型接入 pane 内部两栏：左列 `176px` 固定宽、右列自适应；中间 1px `--border-soft` 分隔。
- 左列行高 34px：状态点 6px（configured = `--ok`，未配置 = `--text-3` 空心）、id 12.5px /
  500、preset 标签 10px `--text-3`（`Kimi` / `DeepSeek` / `OpenAI 兼容`）；当前使用项行内右侧
  一枚 10px `--accent` 的「当前」徽标（或 eink 黑底白字）。
- 选中行 = `--accent-tint` 底 + 左侧 2px `--accent` 竖条；hover = `--hover`。
- 左列底部是整行文本钮「+ 添加 provider」（11.5px `--accent`），与列表用 1px
  `--border-soft` 分隔；空清单时该按钮上移为面板中央空态卡片的主按钮。
- **列表行不承载删除按钮**：删除是危险动作，放在右侧表单底部的危险区（§11.5），避免误点。

### 11.3 添加 provider 的行内表单

- 点击「+ 添加 provider」后，左列保持不动，右列切换成一张表单卡（不弹二级 modal）：
  - 标题「添加 provider」（13px / 600）
  - `id` 输入（mono、占满宽），下方 11px 提示「小写字母 / 数字 / `-` / `_`；创建后不可修改」
  - 预设：三枚分段按钮（Kimi / DeepSeek / OpenAI 兼容），28px 高；选中 = `--accent-tint` +
    `--accent` 文字；每枚下方一行 11px 说明（`官方地址 + responses 缺省` / `官方地址 +
    responses` / `需填 Base URL + chat_completions 缺省`）
  - 错误：重复 id / 字符集非法时，输入框 1px `--danger` + 行下 11.5px `--danger` 文本
  - 底部「取消」「添加」（添加 = `--accent-fill` 实底）
- 添加成功后该 provider 被选中、表单进入普通编辑态；若它是第一个 provider，自动成为当前使用
  （列表行出现「当前」徽标）。
- eink：分段按钮选中 = 黑底白字。

### 11.4 provider 编辑表单

- **表单头**：id 14px / 650（mono）、preset 标签、状态徽标（已配置 / 缺 Key / 缺模型 /
  缺 Base URL / 装载期已忽略）；右侧「设为当前使用」文本钮（当前使用项不渲染）。
- **基础区**：
  - API Key 行：`type="password"` 输入占满剩余宽，右侧「替换」「清除」两枚 30px 次级钮；
    已配置时 placeholder =「已配置 · …3f9a」；字段下常驻 11.5px `--text-3`「明文存储在
    config.json，任何能读该文件的人都能读到它」。
  - 模型清单：表头 11px `--text-3`；行 32px，列宽 `minmax(0,1fr) 64px 64px 110px 28px`；
    空态一行「还没有声明模型。至少添加一个模型后，这个 provider 才可用。」；「+ 添加模型」
    11.5px `--accent`。
  - 行内错误：控件下 11.5px `--danger`；重复 id **两行都标**。
- **高级区**（默认折叠，触发器 11.5px `--text-2` + chevron）：
  - 预设：只读标签 + 一行说明「预设创建后不可改；换协议请新增 provider」。MUST NOT 渲染成
    可编辑的选择器（否则用户在不知情的情况下改变 store / 超限行为）。
  - Base URL：输入框占满宽；空值 placeholder = 官方地址（generic 显示「必填」）；字段头右侧
    「自定义 / 官方地址」状态 +「恢复默认」（仅显式存在时）。
  - 目的地警示：值与官方地址不同（或 generic 有值时）出现，1px `var(--pending)` 左边线 +
    12px 内边距浅底块，11.5px `--text-2`：「带密钥的请求会发往这个地址。非官方地址意味着把它
    交给了该主机的运维者。」generic 无 Key 时文案改为「请求会发往这个地址」。
  - Wire 方言：`<select>` 28px；不支持的档位 `disabled` + 行下 11px 说明。
  - raw 非法值提示：raw 是闭集合外字符串时，选择控件显示生效值，下面一块 `--pending` 提示
    「文件中的值是「chat」，不是合法方言；装载期已回落为 responses，保存后写为 responses」。
- **错误**：控件下 11.5px `--danger` + `aria-invalid` / `aria-errormessage`；保存失败后焦点
  落到第一个错误控件。

### 11.5 删除确认（右列原地切换，不弹二级 modal）

- 标题「删除 provider「kimi」？」（13px / 650，`--danger` 不用于标题，只用正文）。
- 三块可能出现的说明：
  1. **当前使用**（1px `--pending` 左边线浅底）：「它是当前使用的 provider。删除后切换到」
     + `<select>`（其余 provider；删最后一个时显示「删除后将没有 provider，发送消息会被挡下，
     直到你添加新的 provider」）。
  2. **命名引用**：「会话命名 / 图片命名正在使用它。删除后」+ 每行一个选择（跟随当前 provider /
     指定某个 provider）+ 一行「模型覆盖将被清除」。
  3. **草稿**（`--pending` 文本）：「该 provider 有未保存的修改，删除会一并丢弃」。
- 底部「取消」「删除」（删除 = `--danger` 实底、白字；eink 黑底白字）。
- 删除只改草稿；点「保存」才落盘（与其他编辑同一保存语义）。删除后列表实时少一项，active
  徽标移到替代目标。

### 11.6 空清单与自动化节

- **空清单**：右列一张空态卡片（居中，max-width 360px）：「还没有 provider」13px / 600 +
  一句说明 + 「添加第一个 provider」主按钮；左列只剩「+ 添加 provider」。MUST NOT 渲染空的
  表单骨架或假的 provider 行。
- **自动化节**：模型接入卡片的**兄弟**，独立 `--pane` 卡片；节标题右侧「全局 · 与所选
  provider 无关；增删或切换 provider 不会复制开关、也不会改变它们的值」。卡片顶部一段
  11.5px 说明（四个开关是 `harness.*` 全局键；命名目标默认跟随当前 provider，每组只有一份
  键）。四行开关每行两列（左文案 / 右「恢复默认」+ 开关）；会话命名与图片命名两行的文案列
  末尾是「发往 `[provider ▾]` `[model ▾]`」两个选择器 + **一行**生效说明。provider 的
  增删 / 切换 MUST NOT 重渲染开关行（DOM 与开关值不变），只刷新两行里的选择器选项与那一行
  说明。
- **选择器**：宽 ≤190px、28px 高、1px `--border`、`--r5`；禁用态 45% 不透明；焦点环同其他
  控件。图片命名的模型选项文本带 `✓ vision` / `未声明 vision`。
- **关闭态**：两个选择器 disabled，说明文字「已关闭：不发起命名调用；选择保留（…），重新
  开启后按此目标执行」用 `--text-3`（不是 danger）。视觉上 MUST NOT 隐藏控件，也 MUST NOT
  把已选值显示成空。
- **没有独立摘要框**：自动化节顶部不再有卡片 / 边框 / 底色块；`#naming-readout` 这类块
  MUST NOT 回来——目标读数只存在于那两行里。
- 开关样式：32×18 轨道、14px 圆钮；开 = `--accent-fill` 轨道 + 白钮；eink 开 = 黑底白钮、
  关 = 白底 1px 黑边。

### 11.7 状态与错误

- **保存状态行**：11.5px；干净 `--text-3`、脏 `--text-2`、已保存 `--ok`、需要修正
  `--danger`、冲突 `--pending`。同一文本进 `role="status" aria-live="polite"`。
- **横幅**（顶部，正文之上）：圆角 `--r6`、1px 边、12px 文本、`padding: 8px 12px`；危险档
  `--danger` / `--danger-tint`，提示档 `--pending` / 10% 底。冲突横幅带两枚动作
  （「重新载入」「仍然保存」）；文件损坏横幅只有说明与路径，无动作。
- **保存中**：保存钮文案变「保存中…」并禁用；**全部编辑控件禁用或只读**（输入 / 选择 /
  开关 / 模型行增删 / provider 切换 / 添加 / 删除 / 逐项恢复默认 / 页级还原 / 取消），避免
  请求期间的编辑被返回快照覆盖；完成（成功或进入需修正）后解锁。

### 11.8 三主题纪律

- 只消费 token；不新增色值。eink 下所有描边 1px → 1.4px 面板 / 1px 控件、无阴影；开关、
  分段控件、危险按钮用黑白实底。
- 三个主题的布局几何一致（`border-box` 下外框尺寸不变；主题切换不引起重排）。

## 12. 测试与验收计划

### 12.1 Rust 单测

- **迁移**：旧三档补 preset；已有 preset 不改；幂等（第二次不写）；写失败只 warning 且
  本次生效值正确；未知 id 不迁移；退役 model 迁移与 preset 迁移同一次写。
- **映射解析**：非法条目只丢自己（不拖垮整文件）；preset 非法忽略；generic 缺 base_url
  不可用；mock 只能 id=mock；id 字符集。
- **active 回退**：显式合法保持（即使未配置，含显式 mock）；缺失 → 第一个 configured；
  全未配置 → 第一个合法非 mock 条目；空映射 / 只剩 mock → 无；悬空 → 回退 + warning。
- **命名目标**：override 合法 / 悬空 / 缺省三种；model 覆盖与目标 provider 的清单对账；
  图片命名 vision 资格；**编辑面**（r4）——Set 的目标必须是合法非 mock 条目、Set 的 model
  必须在目标清单内、换 provider / Reset 清 model、同一笔 provider+model 按新目标校验、
  Reset 删键、开关关闭不影响目标键。
- **删除保护**：删 active 无替代 → Blocked；有替代 → active 改写；删被命名引用项无 retarget
  → Blocked；retarget 指向不存在 / mock / 被忽略条目 → Blocked；删最后一个 → active 与命名键
  删除（映射里仍有 mock 也算「最后一个」）；model 覆盖被清除；文件逐字节不变。
- **快照**：raw vs effective（含 `wire_api` 原 JSON 值）、revision 在顶层、Missing 空对象
  哈希、Invalid = None、键缺席 vs 显式、坏条目可见（`status = Invalid` + 原因）、Key 只回
  hint、references 三个布尔。
- **页级还原**：保留 provider id / preset、清空各条目的设置值、删除 active 与命名覆盖；
  还原后的空条目可保存（含 generic 缺 base_url 的半成品）。
- **patch**：未知字段拒绝、preset 不可改、重复 id 拒绝、字符集拒绝、未知子键保留、
  `Reset` 删键、`Clear` 删 Key、models 按 id 保留未知子键、重命名不跟随。
- **非回归**：`0 → 10000001` 拒 / `0 → 262144` 过 / 未改路径既有非法项放行 / 新增 generic
  缺 base_url 拒。
- **并发**：两笔同 revision 只有一笔成功；既有写入口改为锁内读后，`config_set_value` 与
  `settings_apply` 并发不丢键。
- **revision 冲突**：外部改了 `session_naming.model` / `attachment_naming.model`，再在面板里
  删除 provider（会清这两个键）→ Conflict，不得静默清除外部新值；外部仅改
  `providers.<id>.model`（chip 写回）→ 不冲突。

### 12.2 前端单测（`pnpm test`）

- 草稿状态机（clean / dirty / saving / saved / blocked / conflict / fileInvalid）；
  保存中全部编辑控件禁用。
- 增删改：添加重复 id 报错、添加成功选中、删除保护控件按 `references` 出现、删除后 active
  与命名目标按选择改写、删最后一个显示空态警告。
- 错误按 path 回填、首错聚焦、重复模型 id 两行都标；逐项恢复默认仅显式存在时出现。
- **自动化不随 provider 增删 / 切换变化**：开关行的键、顺序、值与默认 / 显式徽标不变。
- **内联命名目标（r4）**：跟随当前 / 指定 provider / 悬空回落三种初值；换 provider 清 model
  并重算选项；关闭开关时两个选择器 disabled 且值原样保留（重新开启后仍是原值）；图片命名的
  模型选项带 vision 标记、无资格时那一行写「不会改名」。
- **反向断言**：页面 MUST NOT 有独立命名摘要框（`#naming-readout` / `[data-naming-readout]`
  不存在）；每个命名行只有一行生效说明；没有按 provider 复制的第二组选择器；单页两节，无
  TAB / 编辑器 / 权限设置页。
- 反向文案断言：无「每轮生成」「下一轮必定生效」；模型来源写 `config.json`；无「模型目录」。
- 三主题 class / `data-theme` 切换不改变布局（结构性断言）。

### 12.3 视觉场景（`tests/visual`）

- 面板在 1280×800 与 900×700 下打开即完整可见（O1 / O2）、无水平溢出、Tab 不逃出面板。
- 三主题各一屏（已配置 + 自动化），外加：空清单、添加表单（含重复 id 错误）、删除确认
  （active + 命名引用）、命名关闭（选择器禁用但保留）、图片命名无 vision、校验错误、
  保存中（控件禁用）各一屏。
- 左列 provider 列表的选中 / hover / 当前徽标三态；eink 下徽标黑底白字。

### 12.4 原型语义与规则回归（本 change 自带）

- `evidence/prototype-semantics-check.mjs`：静态 + 浏览器断言，共 33 项。覆盖 provider 增删
  流程、重复 id、删除保护控件、空清单、自动化全局性、内联命名目标（可编辑 / 跟随 / 覆盖 /
  悬空 / vision 标记 / 关闭禁用但保留 / 一行生效说明 / 无摘要框）、单页两节、高级区
  （DeepSeek 禁用档 / generic 条件文案）、会话命名完整节奏、控制面板全选项点击、三主题 ×
  14 场景；文本 predicate 配负向对照（REVIEW.md『断言等价于子串』条），交互路径由 B1–B13 实测。
- `evidence/provider-rules-check.mjs`：把 §2.5 / §3 / §4 / §2.3 / §10.2 的判定表写成可执行
  纯函数，共 42 项检查；其中 **15 个 mutant 对照**覆盖关键规则组——迁移 R1/R2/R3/R4/R5、
  configured R6、回退顺序 R8/R9、命名目标编辑 R12b/R12e、删除 R13/R15/R16/R18、id R19。
  MUST NOT 宣称「每条规则各有一个 mutant」；其余检查是正向判定表。它是实现的测试 oracle，
  不是产品代码的替代。
- 两个脚本都不进 CI（提案期工具）；实现 PR 把同一判定表移植成 Rust 单测后再删掉
  `provider-rules-check.mjs`（或降级为文档，见 tasks）。

### 12.5 验收场景（真机套件）

- 打开设置 → 看到 provider 列表与四个开关；`⌘,` 与菜单两条入口都打开同一面板；面板只有
  「模型接入」与「自动化」两节，没有 TAB / 侧边导航 / 编辑器或权限设置页。
- 在会话命名行把目标 provider 改为另一个已配置项、模型选它的清单项 → 保存 → 下一次评估
  调用发往新目标；该行只显示一行「实际：… · 指定目标 · …」。
- 关闭会话命名 → 两个选择器禁用、值不变；重新开启后仍是原目标；期间 `config.json` 里的
  两个覆盖键未被删除。
- 图片命名选一个未声明 `vision` 的模型 → 行内写「未声明 vision → 粘贴图片不会改名」；
  粘贴图片后文件名仍是暂存名，且不发起视觉调用。
- 添加一个 provider（合成 Key + 模型）→ 保存 → chip 出现该 provider；重启后仍在。
- 添加重复 id → 保存被拒（后端）、文件逐字节不变。
- 删除当前 provider → 必须选替代目标，保存后 chip 显示新 provider。
- 删除被会话命名 / 图片命名引用的 provider → 目标改为「跟随当前 provider」或指定项，保存后
  自动化节两行的目标选择与生效说明更新。
- 删除最后一个 provider → chip 空态，「去设置」可回到面板；发送给出 `harness_provider_missing`。
- 未配置 Key 时发送 → 错误文案指向设置（不再是 `config.json`）。
- 迁移：用旧格式（无 preset）的合成配置启动 → 运行正常，文件被补上 preset，第二次启动不再写。
- 门禁：`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`、`scripts/docs-check.sh`、
  `scripts/gate.sh quick`、UI 改动后 `scripts/gate.sh visual`。

## 13. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 动态 id 让一处 match 漏改，运行时 panic / 静默走错配置 | 0.2 的消费者清单作为核对表；`HarnessProvider` 枚举整体删除，编译器逼出全部站点；单测覆盖回退与悬空 |
| 迁移写坏用户配置 | 迁移只补 preset、原地改、幂等；解析失败不迁移；写失败只 warning；单测钉「其余键逐字节不变」 |
| 删除 active / 命名引用后留下悬空引用 | 删除是原子 patch + 锁内引用计算；缺替代目标整笔 Blocked；装载期回落只是手改文件的兜底 |
| 设置页把非法值写进文件导致整文件回落 | 强类型 patch + 严格复解析 + 非回归阻断；Blocked 时文件不动 |
| 「非法值 → 另一种非法值」被 baseline 放行 | 非回归看 candidate × changed paths，不看是否新增 |
| 旧版 UI 洗掉未知子键 | provider 条目只改提交字段；models 按 id 合并；其它节不在 patch 路径 |
| 多写者丢更新 / check-then-write | 读—改—写同锁；revision 锁内比对；既有两个写入口一并收口 |
| 空清单 / 半配置状态未定义 | §4.4 / §6.4 明确定义；UI 空态与 chip 空态都有去向 |
| 命名目标被做成按 provider 的多份 | 每组只有一份全局键 + 行内两个选择器；provider 变化只刷新选项；反向断言守「不按 provider 各渲染一份」 |
| 关闭命名时清掉用户的目标选择 | 关闭只禁用控件，值、草稿与配置键全部保留；前端单测 + 原型断言守「禁用但保留」 |
| 命名目标读数出现第二处（摘要框与行内说明漂移） | 只保留行内一行（§10.5）；`#naming-readout` 类块由断言禁止 |
| 会话命名文案退回「每轮生成」 | 文案以 §10.3 为唯一事实源；反向断言禁掉 |
| generic 预设的协议差异（store / 超限识别 / 空 Key） | §2.2 显式定义；不支持的组合在保存前阻断；Q9 交 Alex 裁决空 Key |
| 原型规模变大后控制面板漏场景 | 控制面板按「场景 / 主题 / provider / 操作」四组列全；断言遍历全部场景与主题 |

## 14. 裁决点（与 proposal 的 Q1–Q11 对应）

| 编号 | 取舍 | 倾向 | 备选与代价 |
|---|---|---|---|
| Q1 | 模态面板 + `⌘,` + 菜单项，还是独立全窗页 | 模态 | 全窗页要新增导航 / 返回；对两节内容过重 |
| Q2 | 显式保存，还是逐字段即时写 | 显式保存 | 即时写少一步，但半行模型 / 半配置会被写入，且没有「保存状态」可看 |
| Q3 | Key 提示只显示「已配置」，还是带末 4 位 | 末 4 位 | 只显示「已配置」更保守，但多 Key / 替换确认时无从分辨 |
| Q4 | 半配置（Key 有、模型空）阻断还是仅警告 | 阻断 | 仅警告允许先存 Key，但保存后不可用、发送报错 |
| Q5 | 外部冲突阻断 + 两个动作，还是静默覆盖 | 阻断 | 静默覆盖实现最简，但会丢外部修改 |
| Q6 | 模型清单未知子键按 id 保留，还是整表替换丢弃 | 保留 | 整表替换简单，但旧 UI 会洗掉新版字段 |
| Q7 | 设置面板能否切换当前 provider | 能（列表「设为当前使用」） | 不能则删 active 时仍要选替代，规则自相矛盾；代价是 chip 不再是唯一入口，spec 同步改 |
| Q8 | 删除 active / 被命名引用项：同一笔 patch 里选替代目标，还是先阻断让用户去别处改 | 同一笔 | 先阻断会产生「删一半 → 报错 → 用户不知道去哪修」的半状态 |
| Q9 | generic 预设是否允许空 api_key（不发 Authorization 头） | 允许 | 不允许则本地模型（Ollama / LM Studio）要填假 Key；允许则网络层要按空 Key 省略头 |
| Q10 | provider id 是否允许改名 | 不允许（创建后不可改） | 允许改名要同时搬三处引用（配置路径 / 会话记录 / 命名目标），代价远大于收益 |
| Q11 | preset 是否允许在编辑时切换 | 不允许 | 允许会静默改变 store / 超限识别 / wire 缺省，用户在不知情下改变行为 |
