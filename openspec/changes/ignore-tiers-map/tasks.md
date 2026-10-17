# Tasks: ignore-tiers-map

> **实现范围**：`src-tauri/src/{config,fs_io,commands}.rs`、`src-tauri/src/harness/{tools,turn}.rs`
> 的 `#[cfg(test)]` 内调用点（5 处，tower 已批）、`src-tauri/tests/**`、`src/bindings/**`、
> `docs/specs/config-reference.md`、`scripts/acceptance/scenarios/67-vault-open-ignore-set.md`、
> `scripts/acceptance/README.md`、`openspec/changes/ignore-tiers-map/**`。
>
> **裁决口径（2026-10-17 预审「都采纳」）**：单键 `ignore` 地图；缺省即默认不变；同名冲突规则
> 消亡；行为语义不变、只换配置面；旧 `hidden` / `lazy` 两键直接切断、零兼容层。

## 1. 配置面（`src-tauri/src/config.rs`）

- [x] 1.1 `IgnoreTier` 枚举（`Hidden` / `Lazy`，serde 小写序列化、ts-rs 导出）；**不实现** `Deserialize`。
- [x] 1.2 `VaultConfig` 的 `hidden` / `lazy` 两字段换成 `ignore: BTreeMap<String, IgnoreTier>`；
  doc comment 写清单键地图语义（缺省即默认、粒度整图、档位闭集合、第三档、生效时点）。
- [x] 1.3 `DEFAULT_HIDDEN` / `DEFAULT_LAZY` 退役，收成一张 `DEFAULT_IGNORE`（16 名）；
  `VaultConfig::default()` 由它构造。
- [x] 1.4 `RawVaultConfig.ignore` 收成 `Option<serde_json::Map<String, serde_json::Value>>`（逐项校验；
  整键错形状仍整文件回落），删掉两数组字段。
- [x] 1.5 `validate_vault` 改为 `validate_ignore_map`：名字五类非法 + 档位值两类非法各丢该项 + 一条
  人话 warning；删除跨档同名 warning 与 `hidden` 覆盖 `lazy` 的裁剪逻辑。
- [x] 1.6 单测改写：默认地图不变量、缺键 / 缺节 / `null` ⇒ 默认、`{}` ⇒ 空图、只写一名 ⇒ 整图替换、
  非法档位值、非法名字、整键错类型 ⇒ 整文件回落。

## 2. 规则表（`src-tauri/src/fs_io.rs`）

- [x] 2.1 `IgnorePolicy::load` 第三/四参合成 `&BTreeMap<String, IgnoreTier>`，内部按档位过滤出两个
  匹配器（`hidden` 仍恒定并入 `LUMIR_TMP_PATTERNS`）；分区逻辑只在 `load` 里写一次。
- [x] 2.2 判定链、watch 分流、剪枝、`validate_new_name` 一行不改；注释里旧键名改准。
- [x] 2.3 单测构造口径同步（`policy_with` / `.git` 移出 hidden 档的用例改为克隆默认地图后改值）；
  补一条「档位值直接驱动 `classify`」的用例。

## 3. 接线与测试调用点

- [x] 3.1 `commands.rs::prepare_vault_open` 把 `&vault_config.ignore` 交给 `IgnorePolicy::load`；
  测试 helper `policy_with_rules` 同步。
- [x] 3.2 `src-tauri/src/harness/{tools,turn}.rs` 的 `#[cfg(test)]` 内 5 处调用点同步（生产代码零改动）。
- [x] 3.3 `src-tauri/tests/**` 里 `DEFAULT_HIDDEN` / `DEFAULT_LAZY` 的 11 处调用点换成
  `VaultConfig::default().ignore`。

## 4. 文档与口径同步

- [x] 4.1 `docs/specs/config-reference.md` 的 `[vault]` 节改写成单键地图：键表、默认地图全表、
  两档语义、非法项口径；§2 的「整个字段给错类型」示例改准。
- [x] 4.2 `scripts/acceptance/scenarios/67-vault-open-ignore-set.md`：覆盖边界里的键名表述改准
  （场景断言走默认值，无需重写）。
- [x] 4.3 `scripts/acceptance/README.md`：涉及两档键名的措辞（如有）改准——核查零命中
  （`vault.hidden` / `vault.lazy` / `rule_files` 均未出现），无需改动。
- [x] 4.4 `src/bindings/**`：ts-rs 重导出产物（新增 `IgnoreTier.ts`、`VaultConfig.ts` 形状变化）。

## 5. 验证

- [x] 5.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
- [x] 5.2 `scripts/gate.sh quick` 全绿（GATE RESULT 原文行与退出码照抄进完成报告）。
