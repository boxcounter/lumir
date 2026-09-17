# Tasks

## Proposal 阶段

- [ ] 1.1 完成 Foundation Markdown 质量合同与 scope 边界评审（节点 1）。
- [ ] 1.2 核对 M77/M78 匿名证据已转化为频率、缺口和证据限制，不写入真实 vault 内容。

## 实现阶段（节点 1 通过后）

- [ ] 2.1 实现并记录 F0 正确路径、无源码闪现、可见 decoration/frontmatter ready 与 `requestAnimationFrame` paint 验收。
- [ ] 2.2 实现 F1 图片/wikilink 成功、失败和有界降级，不阻塞 F0。
- [ ] 2.3 建立 P0/P1/P1.5 组合与 math/mermaid fixture，并记录 dataview/canvas 延后项（需单独产品裁决）。
- [ ] 2.4 完成源码不变、原始 Markdown 复制、编辑保存、失败保留和冲突保护验收。
- [ ] 2.5 完成 AX、键盘、触控板宽表横滚和焦点路径验收。
- [ ] 2.6 以真实 Tauri/WKWebView 测量 F0/F1，并与 IO 子指标、keypress 近似分开报告；提交预算裁决点，不伪造阈值。
- [ ] 2.7 完成 Math（LaTeX）与 Mermaid 渲染、失败可读降级、源码复制不变与不阻塞 F0 的验收。

## 出口验证（节点 2 前）

- [ ] 3.1 tiny/small/medium/large fixture 均通过验收矩阵，manifest 与脱敏规则可审计。
- [ ] 3.2 `pnpm build` 通过。
- [ ] 3.3 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
- [ ] 3.4 完成文档 link 检查与 Git/visual diff 检查，并保存失败产物。
- [ ] 3.5 请求独立 review 与 OpenSpec 节点 2；节点 2 通过后方可 archive。
