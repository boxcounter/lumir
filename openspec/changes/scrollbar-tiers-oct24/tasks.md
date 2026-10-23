# Tasks: scrollbar-tiers-oct24

## 1. 规范修订（delta + 归档承接）

- [ ] 1.1 `specs/ui-design-system/spec.md`：REMOVED「阅读面横向滚动条」+ ADDED「滚动条分档与滚动容器注册表」（作用域 / 三档白名单 / 右缘 12px 不变量 / 浮层验收先断言溢出 / `scrollbar-gutter` 禁则 / WebKit 按容器分档的实测依据）
- [ ] 1.2 delta 文件头写明改名通道与「不按轴分档」的理由（REMOVED 段内），并核对 `scripts/openspec-archive-check.mjs` 的机器判据（REMOVED 目标存在、ADDED 不撞名）

## 2. 细条档落地（P2）

- [ ] 2.1 把细条组从 `src/harness-panel.css` 迁到 `src/style.css`（与隐藏档同区段），声明值逐字不变；`harness-panel.css` 侧留一行指针注释
- [ ] 2.2 细条组扩面：`.cm-lp-block-scroll` / `.cm-lp-table-scroll` / `.cm-lp-math-block` / `.cm-lp-mermaid` 并入同一份声明组
- [ ] 2.3 删除 `.cm-lp-table-scroll` 的 `scrollbar-gutter: stable` 并改准就地注释
- [ ] 2.4 `.cm-scroller` 按 D2 裁决落档（A：无声明、登记豁免档；B：两轴细条）——裁决前按 A 起草

## 3. 机器判据

- [ ] 3.1 新增 `tests/unit/scrollbar-registry.test.ts`：注册表数据 + CSS/theme.ts 静态扫描器（注释剔除、嵌套规则、多选择器、shorthand）+ 双向对账
- [ ] 3.2 按档位核验声明：细条 / 隐藏档实际持有声明且全组共用一份规则；豁免档 MUST NOT 持有滚动条声明
- [ ] 3.3 反向输入（区分度）：删一条注册表条目 → 报「未登记」；加一条源码里不存在的条目 → 报「僵尸条目」；给豁免档容器加 `scrollbar-width` → 报「豁免档持有声明」；给细条容器改 5px → 报「配方值漂移」
- [ ] 3.4 `tests/unit/README.md` 的覆盖表补一行

## 4. 验收判据

- [ ] 4.1 新增 `tests/visual/scenes/m663-scrollbar-tiers.spec.ts`：四个预览横滚面「先断言溢出 → 再断言细条声明」；`.cm-scroller` 无滚动条声明；宽表 `scrollbar-gutter` 计算值为 `auto`
- [ ] 4.2 反向验证一次：临时把某个细条容器从组里移除，确认 4.1 的场景如实判红（证明有区分度），再还原

## 5. 人肉防线与台账

- [ ] 5.1 `REVIEW.md` 加开工前 checklist 一条（新增 / 修改 overflow 容器：先定档；右缘 12px 内别放常驻可交互件）
- [ ] 5.2 `docs/backlog.md` 核销 M177 条的「可选动作」（`scrollbar-gutter` 必要性重估）——按「核销即删除」改准该条
- [ ] 5.3 真机前后对比截图（横向溢出的预览块）落 `.local/reviews/scrollbar-tiers-oct24/`，等 Alex 过目；未批准不 `--update` 任何像素基线

## 6. 验证

- [ ] 6.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 6.2 `pnpm test` 全绿（含新注册表单测）
- [ ] 6.3 `scripts/gate.sh quick` 全绿，报告照抄 `GATE RESULT` 原文行 + 退出码
- [ ] 6.4 `LUMIR_VISUAL_STRUCTURAL=1 scripts/visual/run.sh`（或 `scripts/gate.sh visual`）全绿；像素层本地跑一次确认四个新消费者零差异
