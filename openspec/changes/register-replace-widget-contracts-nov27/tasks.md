# Tasks: register-replace-widget-contracts-nov27

## 1. 合同与增量

- [x] 1.1 `docs/specs/replace-widget-contracts.md`：适用面 / 不变量 R1–R5 / 29 条清单 / 证伪方式
- [x] 1.2 `openspec/changes/register-replace-widget-contracts-nov27/specs/editor-live-preview/spec.md`：ADDED「replace 装饰构造的责任登记」+ 场景（未登记 / 僵尸 / 站点漂移 / 字段锚点失效 / 单一实现）
- [x] 1.3 核对 delta 与 `docs/specs/replace-widget-contracts.md` 的口径一致（无「文档说 A、delta 说 B」）

## 2. 静态注册表与判据

- [x] 2.1 `tests/unit/replace-widget-registry.test.ts`：`Decoration.replace` AST 扫描器（纯隐藏 / widget / 工厂 / 简写属性 / block 标志 / owner 解析）
- [x] 2.2 注册表 29 条：每条登记 inline/block、显露策略、指针/只读策略、原生编辑策略、几何写入者、IME 策略、测试指针
- [x] 2.3 双向对账：未登记站点即红、僵尸条目即红、同组站点序号漂移即红、字段缺项即红
- [x] 2.4 锚点与测试指针可解析：代码符号 / CSS 选择器 MUST 当下存在，测试文件与验收场景路径 MUST 当下存在
- [x] 2.5 单一实现判据：所有条目原生编辑指向 `absorbNativeEdit`；`src/preview/**` 无 `beforeinput`；`Decoration.replace` 无别名引用

## 3. 先红后绿与反向证据

- [x] 3.1 空注册表跑一次，确认按「未登记站点」判红并列出全部 29 个站点（日志落 `.local/reports/replace-widget-registry-nov27/`）
- [x] 3.2 临时新增一个未登记的 replace 站点，确认判红并指名该站点；删除探针文件后转绿
- [x] 3.3 临时加一条源码里不存在的僵尸条目，确认判红并指名该条目；还原后转绿
- [x] 3.4 反向测试内建：合成扫描结果缺条目 / 多条目 / 序号漂移 / 字段锚点失效分别判红（不依赖临时改源码）

## 4. 文档与覆盖表

- [x] 4.1 `tests/unit/README.md` 覆盖表补 `replace-widget-registry` 一行
- [x] 4.2 全仓扫一遍旧表述：确认没有另一份 replace 构造清单（避免 REVIEW.md「同一语义两处真源」）

## 5. 验证

- [x] 5.1 `pnpm test` 全绿（含新注册表用例）
- [x] 5.2 `scripts/gate.sh quick` 全绿（照抄 `GATE RESULT` 原文行 + 退出码）
- [x] 5.3 `node scripts/docs-check.sh` PASS
- [x] 5.4 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` PASS
- [x] 5.5 `git status` 核对：只 commit 本 change 的制品，无临时探针 / 日志 / 基线改动

## 6. 边界（如实登记，不做事后扩写）

- [x] 6.1 静态扫描只认直接调用 `Decoration.replace(...)`；别名 / 解构 / 整体赋值 / import 重命名 / 字面量元素访问 `Decoration["replace"]` 均判红；`Decoration[method]` 这类计算动态属性访问与第三方库内部构造不在判据内
- [x] 6.2 注册表不证明运行时正确；行为证据归各条目的测试指针
- [x] 6.3 站点序号对同组内插入 / 删除 / 换序敏感（刻意的准入成本），不引入行号这类更易腐烂的定位

## 7. 移交（本批显式禁止，不勾）

- [ ] 7.1 merge / push / 归档：本批明确禁止，由 tower 后续批次处理；`tasks.md` 因此不是全勾状态，docs-check 的归档队列判据不要求本 change 先落 `docs/backlog.md` 跟踪条目

## 8. K3 返修（needs-changes，2026-11-27）

- [x] 8.1 不支持的参数形态（非对象 / spread / 计算属性名 / 非字面 `block` 简写 / 动态 `widget`）一律产生 `problems` 判红，并补合成反向用例
- [x] 8.2 `geometry.owner` 非空校验；`nativeEdit` 锚点必须恰好是 `src/editor.ts` / `absorbNativeEdit`，并补反向用例
- [x] 8.3 符号锚点改为遍历 TS AST 的 `Identifier` 节点；注释 / 字符串不可冒充（新增 fixture 与反向用例）
- [x] 8.4 修正人读文档失效测试路径；新增「文档测试路径全部存在」判据与缺失路径反向用例
- [x] 8.5 边界改准：字面量元素访问 `Decoration["replace"]` 判红，`Decoration[method]` 计算动态访问不在扫描范围；文档 / tasks / 测试头注释同步
