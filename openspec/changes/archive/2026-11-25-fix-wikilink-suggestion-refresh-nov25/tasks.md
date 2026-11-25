# Tasks: fix-wikilink-suggestion-refresh-nov25

> `openspec/specs/**` 活跃期只读；规格变更只写本 change 的 delta。

## 1. 合同与复现

- [x] 1.1 记录 Alex 2026-11-25 报告为节点 1 批准依据，定位 living spec 的触发、同步与关闭不变量。
- [x] 1.2 用原生逐字输入探针记录 query、`OpenState`、items、trigger、DOM 与插件异常顺序；新增事务矩阵并证明旧实现判红。

## 2. 实现

- [x] 2.1 将候选布局读取移到合法 measure 阶段，移除 state 更新前的原生 `input` 重绘，保持事务 / 语法树 / composition settle 刷新入口。
- [x] 2.2 保持过滤、完整路径接受、键鼠、IME、blur 与上下文切换语义不变；不修改视觉样式或基线。
- [x] 2.3 候选 listbox 与空态在构造、首次打开和运行期语言切换中共用纯文案 relabel；不经过 OpenState 刷新或布局测量。

## 3. 验收场景

- [x] 3.1 新增未使用编号的 WKWebView 原生输入 / 删除场景，运行 `--check` 静态校验；本 worker 不启动真机。
- [x] 3.2 主会话串行执行新场景并归档真实 WKWebView 结果；867 最终 1/1 PASS、31 断言、17.6s，证据 `.local/acceptance/2026-11-25-wikilink-suggestion-refresh-final/`。

## 4. 验证

- [x] 4.1 新增原生事务矩阵及既有 `wikilink-suggestion` 视觉用例通过，旧实现失败日志与修复后日志均落 `.local/missions/wikilink-suggestion-ux-nov25/`。
- [x] 4.2 相关前端单测、`pnpm build`、OpenSpec strict validate 与 `scripts/docs-check.sh` 通过；记录所有实际执行与未执行项。
- [x] 4.3 中文首次有候选 / 空态使用精确文案；有候选与空态均以真实语言命令完成 zh → en → zh 即时切换，旧实现判红，read/write 分离与 IME 单刷回归保持通过。
