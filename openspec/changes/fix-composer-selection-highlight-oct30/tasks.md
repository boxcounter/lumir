# Tasks: fix-composer-selection-highlight-oct30

> 节点 1 已于 2026-10-30 通过，批准原话见 proposal。顺序硬约束：先在未修实现上取得 WebKit 红 /
> Chromium 绿的反向证据，再实现；不得改写断言适应实现，不得更新既有视觉基线。

## 1. 合同与提案

- [x] 1.1 起草 proposal / design / tasks / harness delta，记录节点 1 两轮批准原话
- [x] 1.2 在 `docs/specs/harness-composer.md` 的 HC6 增加可证伪的可见性不变量；delta 整块复制并
      修改 living 的 composer 全选 requirement，活跃期不改 living spec

## 2. 先红：引擎像素属性测试

- [x] 2.1 新增 WebKit real-UA 像素属性测试，覆盖卡片首位 / 中间 / 末位、多卡片交错、纯文本与
      段落软断行；逐块断言像素差、composer 外无差异、折叠后无残留，保留 DOM 端点与 Backspace 整删
- [x] 2.2 未修实现上证明卡片首位用例 WebKit FAIL / Chromium PASS，原始输出与截图落
      `.local/reviews/composer-selection-highlight-oct30/before-fix/`

## 3. 实现与模型回归

- [x] 3.1 以模型选区为真源实现自绘块级高亮；selectionchange / 程序化选区 / 结构编辑 / 折叠 / 失焦
      同步，无漏绘、越界或残留；不改 HC6 端点、块模型、序列化或删除语义
- [x] 3.2 补模型 / 几何属性测试，扫块类型、卡片位置、选区方向与折叠 / 非折叠分布
- [x] 3.3 运行现有 composer 单测与 m627 回归，证明无旧行为回归

## 4. 真机验收

- [x] 4.1 新增场景 259 并更新 COVERAGE：隔离配置与合成 vault，经 `[keys]` 重绑同一命令，验
      WKWebView 高亮、全块整删、折叠无残留，保存前后截图；明确不覆盖物理 ⌘A 注入
- [x] 4.2 执行目标真机场景并保存 PASS 证据到主仓 `.local/reviews/composer-selection-highlight-oct30/`

## 5. 门禁与交付

- [x] 5.1 `openspec validate --all --strict`、`scripts/gate.sh quick`、本地 `scripts/gate.sh visual`
      通过；证据落主仓 `.local/reviews/composer-selection-highlight-oct30/`
- [x] 5.2 核对无既有视觉基线更新；若出现差异，保存 diff 并上报，不更新基线
- [x] 5.3 tasks 全勾后在 `docs/backlog.md` 归档跟踪队列登记唯一条目；提交实现分支并 TowerComplete，
      逐项报告机器断言、门禁原文、真机证据与未覆盖边界
