# ui-design-system 增量规格

> 起草注记（非规格正文）：本 change 新增一条 requirement，把「CSS 里的 `var()` 引用必须有归宿」
> 写成可执行的不变量；既有「设计 token 层」条不动，本条是它在**引用面**上的补充判据。
> 根因、审计证据与判据设计见 [design.md](../../design.md)。

## ADDED Requirements

### Requirement: CSS token 引用链的静态防线

`src/**/*.css` 里的每条 `var(--x, …)` 引用 SHALL 落到下列归宿之一：`--x` 在该 CSS 文件集内有
定义；`--x` 在运行期由 TS 显式写入（白名单）；或引用带**有效回退**——回退是字面量，或是一条
每个 `var()` 都能解析到底的回退链。回退 SHALL 被求值：主引用未定义时，回退里的每个 `var()` 都
MUST 解析成功；以另一个未定义 token 作回退 MUST NOT 被视为有效回退（该声明在 computed-value
阶段失效，背景 / 字色等属性回落初始值或继承值）。主引用已定义时，回退是死代码，MUST NOT 因其
内容未定义而判红。

该判据 SHALL 由 `tests/unit/css-token-references.test.ts` 承担，覆盖 `src/**/*.css` 全量（新文件
自动进入），MUST 报告违规的文件与行号。运行时赋值白名单 MUST 只含**真实有赋值点**的 token
（现行：`--lumir-hp-scale` / `--toc-depth` / `--cm-lp-table-columns`），且每条 MUST 同时满足
「`src/**/*.ts` 里有赋值点」与「被至少一条 CSS 引用」——缺任一侧即判红。新增运行期 token MUST
在同一变更内同时落赋值点与白名单条目，MUST NOT 借白名单放行没有赋值点的名字。

判据边界 SHALL 明确：只覆盖 CSS 文件里的 `var()` 文本与 TS 里的运行时写入点，MUST NOT 被表述为
覆盖 TS 内联样式（CodeMirror theme 对象、inline style 串）的引用面，也不做主题作用域 / 级联
分析——本条是「引用有归宿」判据，不是「该主题下一定生效」判据。

#### Scenario: 未定义的 bare 引用判红

- **WHEN** 某 CSS 声明引用一个既无 CSS 定义、又无运行时赋值、又没有回退的 token
- **THEN** 判据 FAIL，并给出违规文件与行号（现场：`.lumir-hp-skill-name { color: var(--text-1) }`）

#### Scenario: 回退链本身未定义判红

- **WHEN** 引用写成 `var(--a, var(--b))`，而 `--a` 与 `--b` 都没有定义或运行时赋值
- **THEN** 判据 FAIL（现场：`.lumir-hp-skill-menu { background: var(--bg-raise, var(--bg)) }`）

#### Scenario: 有效回退与运行时 token 判绿

- **WHEN** 引用写成 `var(--border-strong, var(--border))` 且 `--border` 有定义，或回退是字面量，
  或引用的 token 是白名单里的运行时赋值 token
- **THEN** 判据 PASS；主引用已定义时，回退里的未定义名字不误报

#### Scenario: 白名单双向核对

- **WHEN** 白名单新增一个在 `src/**/*.ts` 里没有赋值点、或没有被任何 CSS 引用的 token
- **THEN** 判据 FAIL（白名单不能靠加名字放行）
