# Tasks: ui-polish-batch-oct24

## 1. #1 浮层列表滚动条（vault 切换 / harness 会话 / 权限规则段）

- [x] 1.1 断言先行（红）：`mv-vault-switcher` 新用例构造 14 行真实溢出，先证明旧实现「移除钮右缘与
      内容右缘差 0px」「scrollbar-width 为 auto」两条必红；`m303` / `m347` 各补一条 24 行 / 10 条
      规则的溢出态用例（同轮跑红或先 red 后 green）
- [x] 1.2 三处列表归隐藏档：`src/style.css` 的隐藏档共用组扩到 `.vault-list` /
      `.lumir-hp-sesspop-list` / `.lumir-hp-permpop-rules`（`scrollbar-width: none` +
      `::-webkit-scrollbar { display: none }`，值只有一份）
- [x] 1.3 判据覆盖「溢出态前置」：三处都先断言 `scrollHeight > clientHeight` 与 `scrollTop` 可推进，
      再断言两条通道的声明与 `offsetWidth === clientWidth`（0 = 不占位）
- [x] 1.4 细条组注释写明三处浮层为何不进细条档（右缘 0 留白 + 常驻钮，4px 仍压钮）

## 2. #4 harness 表格全屏钮锚点

- [x] 2.1 断言先行（红）：`m634` 新用例先红（旧实现 slot 右缘与表格右缘差 318px）
- [x] 2.2 `.lumir-hp-block-slot[data-hp-block="table"]` 取 `width: max-content; max-width: 100%`；
      代码块 slot 不动
- [x] 2.3 断言含「表确实窄于面板」的区分度前置 + 钮仍在内侧 6px + 代码块 slot 仍满宽

## 3. #5 全屏代码块窄内容居中

- [x] 3.1 断言先行（红）：`m277` 的 5.7b（缩进窄块）断言两侧余量相等，先红
- [x] 3.2 `.lumir-codeblock-fs-content` 加 `margin-inline: auto`（仅既有布局手段，零新 token）
- [x] 3.3 5.5 补宽内容不变量：内容吃满可用宽、左余量 0、壳横向可滚

## 4. #7 只读标签图形化

- [x] 4.1 断言先行（红）：`quick-open` 用例改为「可见文字只有文件名 + 锁图标 aria-hidden + 读屏名
      仍是 D579」，并补 vault 内标签的负向对照；`tests/unit/tabs.test.ts` 补同口径单测
- [x] 4.2 `src/tabs.ts` 在文件名前插入锁形图标（10×10 细线 SVG），可见文字去掉「· 只读」
- [x] 4.3 `src/style.css` 补 `.tab-readonly`（`--text-2`、flex 不伸缩、SVG 块级）
- [x] 4.4 D578 零消费者 → 从 `文案-Copy.md` 与 `src/copy-data.ts` 删除，编号登记进「不复用」清单；
      D583 的 `D577–D579` 引用改准为 `D577 / D579`

## 5. 验证与证据

- [x] 5.1 `pnpm exec tsc --noEmit` 通过；`node tests/unit/run.mjs` 1252 全 PASS（含 copy 漂移门禁）
- [x] 5.2 相关视觉场景逐条跑绿：`mv-vault-switcher` / `m303` / `m347` / `m634` / `m277` / `quick-open`
- [x] 5.3 `node scripts/acceptance/run.mjs --check` 全绿（场景 17 / 62 / 106 / 223 / 226 / 229 / 230 已同步）
- [x] 5.4 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 5.5 `pnpm test` 与 `scripts/gate.sh quick` 全绿（cargo 锁按 mkdir 口径持有并释放）
- [x] 5.6 `scripts/gate.sh visual` 跑过；本批**无基线差**（隐藏档改动在 fixture 的不溢出列表上像素
      零变化；#4/#5/#7 的判据都在结构层，不落整页/元素基线）——`--update` 不需要执行
- [x] 5.7 前后对比截图落 `.local/reviews/ui-polish-oct24/`（git 外）供 Alex 过目：四个表面各一组
      before / after，附说明
