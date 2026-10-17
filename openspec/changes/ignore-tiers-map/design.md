# Design: ignore-tiers-map

> 技术设计只回答「怎么落」；「为什么改」见 [proposal.md](proposal.md)。判定行为零改动——本文件
> 不重述 fs-io 的规则表语义，只写配置面形状与它到既有判定链的接法。

## 1. 配置面形状

```json
{
  "vault": {
    "rule_files": [".gitignore", ".git/info/exclude"],
    "ignore": {
      ".git": "hidden",
      ".DS_Store": "hidden",
      "node_modules": "lazy",
      "target": "lazy"
    }
  }
}
```

- 键 = 名字（合法性沿用 `ignore-tiers-config` 的名字校验：非空、无首尾空白、不含 `/`、不是
  `.` / `..`、不含 `* ? [ ] ! # \`）。
- 值 = 档位，闭集合 `"hidden"` / `"lazy"`。**档位只有这两个值**，不存在 `"visible"`：不在图里
  就是第三档。
- `vault.ignore` 缺席 = 整图取代码内置默认；存在（含 `{}`）= 整图按配置解释。粒度是**整图**
  （旧形态是「两个数组各自独立」，单键地图没有「只写一半」的形态）。

## 2. 类型

`config.rs`：

```rust
/// 忽略档位（change ignore-tiers-map）：名字 → 档位值。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum IgnoreTier {
    Hidden,
    Lazy,
}
```

- 序列化即 `"hidden"` / `"lazy"`，与配置文件字面量同一份词汇，TS 侧由 ts-rs 导出
  （`src/bindings/IgnoreTier.ts`）。
- **不实现 `Deserialize`**：解析走 `serde_json::Value` 逐项校验（见 §3），让「非法档位值」落在
  warning 通道而不是 serde 的整文件回落通道。多一个 `Deserialize` 实现只会诱使后来者改回
  「整键 typed 反序列化」，把逐项容错做没。
- 容器用 `BTreeMap<String, IgnoreTier>`：序列化顺序确定（`config_get` 与单测输出可复现），
  名字匹配本身与顺序无关。

`VaultConfig`：

```rust
pub struct VaultConfig {
    pub rule_files: Vec<String>,
    /// 名字 → 档位。
    pub ignore: BTreeMap<String, IgnoreTier>,
}
```

旧的 `hidden: Vec<String>` / `lazy: Vec<String>` 两字段**删除**，不保留派生字段（保留即两处真源，
正是本 change 要消灭的形态）。

## 3. 解析镜像与逐项校验

`RawVaultConfig`：

```rust
struct RawVaultConfig {
    rule_files: Option<Vec<serde_json::Value>>,
    /// 收成 Value：档位值逐项校验；整个键错形状走既有解析模型的整文件回落。
    ignore: Option<serde_json::Map<String, serde_json::Value>>,
}
```

- 缺席 → `None` → 默认地图；`null` 同缺席（与 `rule_files` 的 `Option` 口径一致）。
- **整个键错形状**（`"ignore": "hidden"`、`"ignore": []`）→ serde 解析期失败 → 整文件回落 +
  一条 warning。这与 `ignore-tiers-config` 对「整个字段给错类型」的既有代价同路，MUST NOT 发明
  逐字段类型容忍。
- **逐项校验**（`validate_ignore_map`，逐条 warning，其余项照常生效）：

| 输入 | 结果 | warning 文案（人话，`{…}` 为实值） |
|---|---|---|
| 名字为空 / 纯空白 | 丢该项 | `配置项 vault.ignore 的名字 "{name}" 为空，已忽略` |
| 名字首尾有空白 | 丢该项 | `配置项 vault.ignore 的名字 "{name}" 首尾有空白，已忽略` |
| 名字含 `/` | 丢该项 | `配置项 vault.ignore 的名字 "{name}" 含斜杠（只接受单个名字），已忽略` |
| 名字是 `.` / `..` | 丢该项 | `配置项 vault.ignore 的名字 "{name}" 不是有效名字，已忽略` |
| 名字含 gitignore 元字符 | 丢该项 | `配置项 vault.ignore 的名字 "{name}" 含通配符（本配置只接受名字，不支持模式），已忽略` |
| 档位值不是字符串 | 丢该项 | `配置项 vault.ignore 的 "{name}" 档位不是字符串，已忽略` |
| 档位值不在闭集合 | 丢该项 | `配置项 vault.ignore 的 "{name}" 档位取值 "{value}" 非法（可选：hidden、lazy），已忽略` |

  非法名字与非法档位值各自独立判定：名字先判、名字非法就不再看值（一条 warning，不吞两条）。
- 同名冲突**没有**判定代码：JSON 对象键唯一；重复键由 `serde_json` 按「后者覆盖前者」处理，
  不产生 warning（见 §8 已知边界）。

## 4. 默认地图（单一来源）

```rust
/// 忽略地图的内置默认（change ignore-tiers-map）：16 名，档位写在名字自己身上。
pub const DEFAULT_IGNORE: [(&str, IgnoreTier); 16] = [
    (".git", IgnoreTier::Hidden),
    (".DS_Store", IgnoreTier::Hidden),
    ("node_modules", IgnoreTier::Lazy),
    // …其余 13 名
];
```

`VaultConfig::default()` 由这张表构造地图。旧的 `DEFAULT_HIDDEN` / `DEFAULT_LAZY` 两个常量**退役**
（它们把「两档」写进默认值本身，正是要消掉的形态）。默认名的并集仍是既有 16 名、无遗漏，单测钉住。

## 5. 判定链的接法（行为零改动）

`fs_io::IgnorePolicy::load(root, rule_files, ignore: &BTreeMap<String, IgnoreTier>)`：

- 内部仍编译 **两个** `Gitignore` 匹配器（`hidden` / `lazy`），只是名字来源从两个切片变成对同一张
  地图的两次过滤：`tier == Hidden` 的键进 hidden 匹配器（并恒定并入 `LUMIR_TMP_PATTERNS`），
  `tier == Lazy` 的键进 lazy 匹配器。
- `classify` 的四层判定、`watch_verdict` 的按档分流、剪枝、索引排除、`validate_new_name` 全部
  **一行不改**——它们只认两个匹配器与档位语义，不认配置面形状。
- 分区逻辑只在 `load` 里写一次。调用点不各自 partition（否则同一映射散落 N 份，是新的真源形态）。

依赖方向：`fs_io` 只借用 `config::IgnoreTier` 这个取值类型，不读配置文件、不依赖 tauri；
`config` 不依赖 `fs_io`。

## 6. 调用点清单

| 位置 | 改动 |
|---|---|
| `commands.rs::prepare_vault_open` | `IgnorePolicy::load(&root, &vault_config.rule_files, &vault_config.ignore)` |
| `commands.rs` 测试 helper `policy_with_rules` | 同上，取 `config::VaultConfig::default().ignore` |
| `fs_io.rs` 测试（`policy_with` / `rules_outside_the_vault_are_never_read` / `.git` 移出 hidden 档的用例） | 构造地图切片或克隆默认地图后改值 |
| `harness/tools.rs`、`harness/turn.rs` 的 `#[cfg(test)]` 内 5 处 | 仅 `IgnorePolicy::load` 的第三/四参合成第三参（生产代码零改动） |
| `src-tauri/tests/**`（8 个文件、11 处） | `DEFAULT_HIDDEN` / `DEFAULT_LAZY` 两参换成 `VaultConfig::default().ignore` 一参 |

## 7. 测试矩阵（机器验收面）

- **默认地图不变量**：16 名、`hidden` 2 名 / `lazy` 14 名、并集 = 旧 16 名、无重名。
- **缺省即默认**：无 `[vault]` 节 / `ignore` 键缺席 / 值为 `null` ⇒ 默认地图。
- **空图**：`"ignore": {}` ⇒ 两档都空（只剩用户规则与临时文件模式）。
- **整图替换**：只写一个名字 ⇒ 其余 15 名全部不在图里（不再是「另一个数组仍取默认」）。
- **非法档位值**：非字符串与 `"invisible"` 各一条 warning、该项丢弃、同图其余项生效。
- **非法名字**：五类形态各一条 warning、其余项生效。
- **整键错类型**：`"ignore": "hidden"` / `"ignore": []` ⇒ 整文件回落（连 `last_vault` 一起丢）。
- **档位驱动行为**：同一名字在 `hidden` / `lazy` / 不在图里三种取值下，`classify` 分别返回
  `Hidden` / `Lazy` / `Visible`；用户规则取反翻不动前两档（既有用例保留）。
- **`.git` 无特判**：把它从地图移出后 `validate_new_name(".git")` 通过（保留既有裁决用例）。
- **bindings 漂移**：ts-rs 重导出后 `src/bindings/**` 进索引（gate 的 bindings-drift 门）。

## 8. 已知边界（如实记录）

- **重复 JSON 键**：`{ ".git": "hidden", ".git": "lazy" }` 按 `serde_json` 口径后者生效，不告警。
  这不是产品语义，是 JSON 对象解析的既有行为；为它造一条冲突判定等于把刚消灭的规则请回来。
- **整键错类型仍整文件回落**：与 `editor.font_size` / `rule_files` 给错类型同族（既有解析模型）。
- **无迁移代码 / 零兼容层**：不读 `hidden` / `lazy` 旧键。存量 `config.json` 的迁移由 tower 在合并后
  执行（Alex 已预授权；该配置面发布不足一天、唯一消费者是 Alex 本人，见 proposal 第 6 条）。
  代码里 MUST NOT 出现「检测到旧键 → 转换 / 提示 / 双读」的分支。
