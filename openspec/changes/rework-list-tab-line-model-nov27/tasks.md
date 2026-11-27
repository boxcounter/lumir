# Tasks: rework-list-tab-line-model-nov27

> 节点 1 已通过（Alex 2026-11-27「我希望改为『行』的操作对象模式」）。实现进度与偏差逐条记在
> 勾选项上；真机执行不在本 mission 授权内（禁止启 app），场景 888 只交付静态契约并通过门禁校验。

## 1. 纯判定：行模型

- [x] 1.1 `src/list-indent.ts` 的 `listIndentChange` 改为按选区展开行集（全部 range；空选区 =
      head 行；非空选区尾落行首不计），逐行归属、逐行产 changes；删除 `main.head` 单点判定
- [x] 1.2 首行 / 续行两套步长落地：首行 indent = 上一同级项内容列 − 本行 marker 列、outdent =
      本行 marker 列 − 祖先项 marker 列（无祖先为 0）；续行 = owner 内容列宽；删除量与可删空白
      取 min，不越过 `>` 分隔空白
- [x] 1.3 显式裁决点落地：首项 TAB 无操作（续行照常）、非列表行 / 代码块 / 表格 / HTML 块跳过、
      纯空白行不写、选区尾落行首不计、有序编号与标记零改写
- [x] 1.4 `src/editor.ts` 的 `applyListIndent` 注释改准（runner 与 dispatch 形态不变，仍是
      readOnly 提前返回 + 单次 dispatch、不重设选区）；模块头注释从「项 / 子树」改为「行」

## 2. 先红后绿：单测

- [x] 2.1 先写期望后改实现，逐组跑红：单行 TAB / SHIFT+TAB 不带子树、首项、续行、
      引用前缀、纯空白行、首行选区（单行内部分选区）
- [x] 2.2 多行选区：正向 / 反向、尾落行首、6–8 行嵌套块 Shift+Tab、未选中的首行与子项
      逐字节不动、混合列表 / 非列表选区
- [x] 2.3 有序列表：TAB / SHIFT+TAB 只动空白、源码编号全程不变（切断 D2c 的红测）
- [x] 2.4 单次 dispatch：一次 undo 还原整次多行编辑；选区 / caret 按 change mapping 保留；
      无编辑时不 dispatch

## 3. 键位链路与真机场景

- [x] 3.1 `tests/visual/scenes/m239-list-tab-indent.spec.ts`：更新有序列表期望（不重排）与
      注释；新增多行选区 Tab / Shift+Tab、首项 / 子项不受牵连、反向选区用例
- [x] 3.2 `scripts/acceptance/scenarios/43-list-tab-indent.md`：有序列表期望改为 `   2. dosq`
      （编号不动），说明段与已知边界改准
- [x] 3.3 新增真机场景 `888-list-line-indent`（编号对账：当前最大 887）与 fixture：6–8 行选区
      Shift+Tab 逐行凸排、正向 / 反向、首行与未选子项不动、一次撤销还原；`coverage.mjs` 重生成
      覆盖表

## 4. 验证

- [x] 4.1 `node --experimental-strip-types --import ./tests/unit/register.mjs --test tests/unit/list-indent.test.ts`
- [x] 4.2 `pnpm test`（前端单测全量）
- [x] 4.3 `scripts/gate.sh quick`（tsc 三份 + 单测 + docs-check + openspec validate）
- [x] 4.4 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`
- [x] 4.5 `node scripts/acceptance/coverage.mjs --check` 与 `run.mjs --check`（场景静态契约）
- [x] 4.6 真机执行已完成并 PASS：43 `PASS / 76 断言`（证据
      `.local/acceptance/2026-11-27-list-line-indent`）、888 `PASS / 51 断言`（证据
      `.local/acceptance/2026-11-27-list-line-indent-final`）。归档按本 mission 执行（归档提交、包装器
      与 `--archived` 审计读数见 proposal 节点 2 块）；merge / push / 视觉基线更新不在本 mission
      授权内，由主会话按批次安排
