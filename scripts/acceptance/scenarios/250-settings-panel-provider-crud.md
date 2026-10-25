---
id: "250-settings-panel-provider-crud"
item: 250
title: 设置面板：⌘, 打开、增删 provider、重复 id 被拒且文件不变、删除保护与空清单
open: harness-note.md
marker: "HNL-ALPHA"
config:
  # 只有 mock 条目：面板列表因此是空的（mock 是保留 id、不呈现），用来验空态 → 首次添加。
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
steps:
  - name: ⌘, 打开设置面板（与菜单「设置…」走同一条命令实现）
    do: keys
    keys: ["cmd+,"]
    expect:
      - label: 模态面板出现，单页两节
        ax: { has: ["设置", "模型接入", "自动化"] }
      - label: 模型清单来源写明（只来自 config.json，不内置模型表）
        ax: { has: "模型清单只来自" }
      - label: 只有 mock 条目时列表为空——显式空态，不渲染空表单骨架
        ax: { has: "还没有 provider" }
      - label: 空态主按钮在位
        ax: { has: "添加第一个 provider" }
      - shot: 01-设置面板-空态

  - name: 添加第一个 provider（id + Kimi 预设，Kimi 是默认预设）
    do: click
    target: { name: "^\\+ 添加 provider$" }
    expect:
      - label: 添加表单就地展开（不弹二级 modal）
        ax: { has: ["添加 provider", "provider id", "预设"] }

  - name: 填 id
    do: typeInNode
    target: { role: "AXTextField", name: "provider id" }
    text: "kimi-work"
    expect:
      - label: id 落进输入框
        ax: { has: "kimi-work" }

  - name: 确认添加（草稿动作）
    do: click
    target: { name: "^添加$" }
    expect:
      - label: 右列进入编辑表单，列表出现该行并带「当前」徽标（第一个 provider 自动成为当前使用）
        ax: { has: ["kimi-work", "当前", "API Key", "模型清单"] }

  - name: 填一把合成 Key
    do: typeInNode
    target: { role: "AXTextField", name: "API Key" }
    text: "test-key-acceptance-250"
    expect:
      - label: Key 输入后状态行提示有未保存修改
        ax: { has: "有未保存的修改" }

  - name: 添加一个合法模型
    do: click
    target: { name: "^\\+ 添加模型$" }
    expect:
      - label: 模型行出现（id / effort / vision / window 四列）
        ax: { has: ["模型 id", "effort", "vision", "window"] }

  - name: 填模型 id
    do: typeInNode
    target: { role: "AXTextField", name: "第 1 行模型 id" }
    text: "k3-256k"
    expect:
      - label: 模型 id 落进第一行
        ax: { has: "k3-256k" }

  - name: 保存
    do: click
    target: { name: "^保存$" }
    expect:
      - label: 保存成功（状态行给出「已保存」；MUST NOT 声称已生效）
        ax: { has: /已保存/ }
      - label: 文件落盘：条目带 preset（动态 provider 契约）与合成 Key
        file: { path: "env:config.json", has: ['"preset": "kimi"', '"kimi-work"', '"test-key-acceptance-250"'] }
      - label: 第一个 provider 同一笔被写为当前使用
        file: { path: "env:config.json", has: '"provider": "kimi-work"' }
      - shot: 02-已添加并保存

  - name: 重复 id 被拒（后端在锁内核对，前端只回填错误）
    do: record
    as: after-save
    file: "env:config.json"
  - name: 打开添加表单并填一个已存在的 id
    do: click
    target: { name: "^\\+ 添加 provider$" }
  - name: 填重复 id
    do: typeInNode
    target: { role: "AXTextField", name: "provider id" }
    text: "kimi-work"
  - name: 确认添加后保存
    do: click
    target: { name: "^添加$" }
  - name: 保存被拒
    do: click
    target: { name: "^保存$" }
    expect:
      - label: 错误回填到添加表单（id 已存在）
        ax: { has: "已存在" }
      - label: 状态行显示需要修正
        ax: { has: /需要修正/ }
      - label: config.json 逐字节不变（拒绝发生在写盘之前）
        file: { path: "env:config.json", unchangedSince: after-save }
      - shot: 03-重复-id-被拒

  - name: 删除当前使用项且它是最后一个 provider——保护文案在位
    do: click
    target: { name: "^删除…$" }
    expect:
      - label: 删除确认就地展开（同一屏，不是二级 modal）
        ax: { has: ["删除 provider", "这是最后一个 provider"] }
      - label: 写出后果：删后没有 provider、发送被挡下
        ax: { has: "删除后将没有 provider，发送消息会被挡下" }
      - shot: 04-删除保护-最后一个

  - name: 取消删除（草稿不变）
    do: click
    target: { name: "^取消$" }
    expect:
      - label: 回到编辑表单
        ax: { has: "API Key" }

  - name: 确认删除并保存
    do: click
    target: { name: "^删除…$" }
  - name: 点删除实底钮
    do: click
    target: { name: "^删除$" }
  - name: 保存删除
    do: click
    target: { name: "^保存$" }
    expect:
      - label: 删到零后回到空态（不渲染空表单骨架）
        ax: { has: ["还没有 provider", "添加第一个 provider"] }
      - label: providers 表被清空
        file: { path: "env:config.json", has: '"providers": {}' }
      - label: 当前使用键被删除（不留悬空 id）
        file: { path: "env:config.json", not: '"provider": "kimi-work"' }
      - shot: 05-删到空清单
---

# 250-settings-panel-provider-crud —— 设置面板的 provider 增删改与删除保护（单场景）

## 本场景在验什么

change `add-model-automation-settings-oct24` tasks §7.8 的验收面（真机 WKWebView）：

1. **⌘, 打开同一面板**：面板单页两节（模型接入 / 自动化），没有 TAB；空配置（只有保留的
   `mock` 条目）时列表给显式空态，不渲染空表单骨架。
2. **添加 provider 是草稿动作**：id + 预设 → 右列编辑态；点「保存」才写盘，且第一个 provider
   同一笔成为 `harness.provider`（否则「添加成功但还不能用」）。
3. **重复 id 由后端拒绝**：错误按 `path` 回填到添加表单（`settings_provider_id_duplicate`），
   文件**逐字节不变**（`unchangedSince` 证明写盘发生在校验之后）。
4. **删除保护**：最后一个 provider 被删时先给后果（删后没有 provider、发送被挡下），确认后
   才进草稿；保存后 `providers` 为空、`harness.provider` 键被删除、面板回到空态。

## 入口口径（为什么只验 ⌘,）

菜单「设置…」与 ⌘, 在前端是**同一条命令**（`app.settings-open` 的 toggle）：Rust 菜单点击只
发 `app:menu_command` 的 `settings` 载荷，装配层把它接到同一个 toggle（`src/main.ts` 的
MENU_COMMANDS）。套件没有菜单栏点击动作（README 的动作表里刻意不收），菜单侧的“结构假设
失败降级”由 `src-tauri/src/lib.rs` 的 `add_settings_item` 注释与 stderr 告警承担；真机上手点
菜单属于手感项，归 Alex。

## 已知边界

- 保存中的控件禁用、焦点圈定、ARIA 回填的细粒度形态由视觉场景
  `tests/visual/scenes/m734-settings-panel.spec.ts` 守（chromium 结构层）；本场景只验真机上的
  「打开 / 增 / 拒 / 删保护 / 空态」这条主链。
- 会话命名 / 图片命名的内联目标与视觉资格不在这里验（需要 harness pane 与命名目标引用），
  归视觉场景与设置面单测。
