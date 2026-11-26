// 输入面清单与源码静态对账（change fix-text-input-select-all-nov26）。
//
// 合同居所：`docs/specs/text-input-faces.md`。本文件是它的可执行判据，守三件事：
//   ① **覆盖**：凡在 `src/` 里创建原生文本输入（`document.createElement("input" | "textarea")` /
//      共享 `element(...)` 助手）的文件，都必须在下面的清单里登记——新增一个浮层 / 内联编辑面
//      忘了登记，这里判红；
//   ② **新鲜度**：清单条目对应的文件必须仍然创建文本输入（改名 / 删除 / 搬走后的僵尸条目同样判红）；
//   ③ **单一分派**：⌘A 在源码里只剩统一键位层这一条来源——除两个**只读**全屏遮罩（选的是渲染
//      出来的内容根，不是输入框）外，任何文件出现字符串字面量 `Cmd-A` 都判红；`.select()` 只允许
//      出现在白名单里（统一分派入口 + 三处「打开即预选」的既有焦点动作）。
//
// 为什么是静态对账而不是给每个输入面写一条 DOM 用例：缺陷的形态是「每个浮层各写一份就地
// `input.select()`，新输入面漏写」。逐面用例只证明已知的面，抓不到「下一个新面」；把判据反过来
// （凡创建输入端必须登记、凡本地 ⌘A 必须解释）才拦得住复发。行为面（真的选中了吗）由
// `tests/visual/scenes/text-input-select-all-nov26.spec.ts` 的真实 DOM 矩阵与真机场景分工。
//
// 已知边界：扫描认 `document.createElement` 与共享 `element(...)` 两种工厂；新模块若另造一个
// 工厂名（如 `makeTag("input")`），静态面看不见——那一层由行为面兜底（任何原生文本宿主都落
// 统一分派的「原生文本宿主」支）。边界写在这里，避免判据被读成「已穷尽所有输入面」。

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const srcDir = path.join(root, "src");

interface Site {
  file: string;
  line: number;
  /** 创建的是哪个标签（input / textarea）。 */
  tag: string;
}

interface RegistryEntry {
  /** 仓库相对路径。 */
  file: string;
  /** 输入面的可读名（与合同文档的清单同名）。 */
  surface: string;
  /** 该面的 ⌘A 落在这条链路的哪一段。 */
  selectAll: string;
}

/**
 * 原生文本输入宿主清单（`src/` 下创建 input / textarea 的模块）。
 *
 * 每个条目的 `selectAll` 都应指向**同一条**统一分派（`src/main.ts` 的 `selectAllAt`）——它按
 * 事件目标（键盘）或当前焦点（菜单）落到原生宿主并调用宿主自己的全选。条目里写清的是「这个面
 * 以什么形态进入分派」，不是第二份实现。
 */
const REGISTRY: readonly RegistryEntry[] = [
  {
    file: "src/tree.ts",
    surface: "文件树内联编辑（重命名 / 新建文件 / 新建子目录，`.ft-edit`）",
    selectAll: "原生 input → selectAllAt → 宿主 `.select()`",
  },
  {
    file: "src/quick-open.ts",
    surface: "按路径快速打开（⌘P）的筛选框",
    selectAll: "原生 input → selectAllAt → 宿主 `.select()`",
  },
  {
    file: "src/toc.ts",
    surface: "大纲浮层（⌘⇧O）的筛选框",
    selectAll: "原生 input → selectAllAt → 宿主 `.select()`",
  },
  {
    file: "src/vault-switcher.ts",
    surface: "vault 切换器（⌘O）的筛选框",
    selectAll: "原生 input → selectAllAt → 宿主 `.select()`",
  },
  {
    file: "src/search.ts",
    surface: "文件内搜索（⌘F）的查询框",
    selectAll: "原生 input → selectAllAt → 宿主 `.select()`",
  },
  {
    file: "src/goto-line.ts",
    surface: "跳转到行（⌥G）的行号框",
    selectAll: "原生 input → selectAllAt → 宿主 `.select()`（打开时另有预选）",
  },
  {
    file: "src/bindings-panel.ts",
    surface: "键位查看面板（⌘/）的查询框",
    selectAll: "原生 input → selectAllAt → 宿主 `.select()`",
  },
  {
    file: "src/settings-panel.ts",
    surface: "设置面板的文本输入（模型 id / Base URL / API key / 窗口等；两个 checkbox 不是文本面）",
    selectAll: "原生 input → selectAllAt → 宿主 `.select()`",
  },
  {
    file: "src/harness-panel.ts",
    surface: "权限理由 textarea（审批对话框的两处）",
    selectAll: "原生 textarea → selectAllAt → 宿主 `.select()`",
  },
];

/**
 * 允许保留**本地** `Cmd-A` 处理的文件：两个只读全屏遮罩。
 *
 * 它们选中的是渲染出来的内容根（不可编辑的 DOM 子树），不是输入框——⌘A 在那里等价于「选中
 * 这段只读内容」，与「输入面全选」是两条合同（change fullscreen-table-text-selection / M650 的
 * `overlay-select.ts`）。除它们之外，⌘A 只允许存在于统一键位层（`src/keys.ts` 的 token 是
 * 小写 `Cmd-a`，不在本扫描的匹配面内）。
 */
const LOCAL_CMD_A_ALLOWED: Readonly<Record<string, string>> = {
  "src/table-fullscreen.ts": "只读表格遮罩：选中渲染出来的表格内容根",
  "src/code-block-fullscreen.ts": "只读代码块遮罩：选中渲染出来的代码块内容根",
};

/**
 * 允许直接调用 `.select()` 的文件（白名单 + 理由）。新出现一处就必须在这里登记——它要么是
 * 统一分派入口，要么是「打开浮层即预选」这类与 ⌘A 无关的焦点动作；第三种情形多半是有人又写了
 * 一份本地全选。
 */
const SELECT_CALL_ALLOWED: Readonly<Record<string, string>> = {
  "src/main.ts": "统一分派 selectAllAt 的原生宿主分支（唯一的 ⌘A 实现）",
  "src/search.ts": "打开搜索面板即聚焦并预选查询串（mount，与 ⌘A 无关）",
  "src/goto-line.ts": "打开行号条即预选当前行号（open，与 ⌘A 无关）",
  "src/settings-panel.ts": "「替换」按钮把焦点送回 API key 输入框并预选（点击动作，与 ⌘A 无关）",
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out.sort();
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function rel(file: string): string {
  return path.relative(root, file).replaceAll("\\", "/");
}

/** 只认 `document.createElement(...)` 与共享 `element(...)` 两种工厂（口径见文件头的已知边界）。 */
function isElementFactory(callee: ts.Expression): boolean {
  if (ts.isIdentifier(callee)) return callee.text === "element";
  return ts.isPropertyAccessExpression(callee) && callee.name.text === "createElement";
}

/** 扫描一个文件：原生文本输入创建点、字符串字面量 `Cmd-A`、无参 `.select()` 调用。 */
function scan(file: string): { sites: Site[]; cmdA: number[]; selects: number[] } {
  const source = parse(file);
  const sites: Site[] = [];
  const cmdA: number[] = [];
  const selects: number[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) && node.text === "Cmd-A") {
      cmdA.push(source.getLineAndCharacterOfPosition(node.getStart()).line + 1);
    }
    if (
      ts.isCallExpression(node) &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0] as ts.Node) &&
      ["input", "textarea"].includes((node.arguments[0] as ts.StringLiteralLike).text) &&
      isElementFactory(node.expression)
    ) {
      sites.push({
        file: rel(file),
        line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        tag: (node.arguments[0] as ts.StringLiteralLike).text,
      });
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "select" &&
      node.arguments.length === 0
    ) {
      selects.push(source.getLineAndCharacterOfPosition(node.getStart()).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { sites, cmdA, selects };
}

const SCAN = new Map(
  sourceFiles(srcDir).map((file) => {
    const result = scan(file);
    return [rel(file), result] as const;
  }),
);

function filesWithSites(): string[] {
  return [...SCAN.entries()]
    .filter(([, result]) => result.sites.length > 0)
    .map(([file]) => file)
    .sort();
}

test("覆盖：每个创建原生文本输入的模块都在输入面清单里（新增输入端未登记即红）", () => {
  const registered = new Set(REGISTRY.map((entry) => entry.file));
  const unregistered = filesWithSites().filter((file) => !registered.has(file));
  const siteLines = unregistered
    .map((file) => `${file}:${(SCAN.get(file)?.sites ?? []).map((site) => site.line).join(",")}`)
    .join("；");
  assert.deepEqual(
    unregistered,
    [],
    `这些模块创建了原生文本输入但没有登记输入面（登记到 tests/unit/text-input-faces.test.ts 的 ` +
      `REGISTRY，并在 docs/specs/text-input-faces.md 的清单里写明该面的 ⌘A 落面）：${siteLines}`,
  );
});

test("新鲜度：清单里的每条都仍在一个创建原生文本输入的文件上（僵尸条目同样判红）", () => {
  const creators = new Set(filesWithSites());
  const stale = REGISTRY.filter((entry) => !creators.has(entry.file)).map((entry) => entry.file);
  assert.deepEqual(stale, [], `输入面清单里的条目已不再创建原生文本输入（改名 / 删除后未更新清单）`);
  // 清单自身不得有重复条目（同一文件两条会掩盖「两个面共用一个文件」的真实结构）。
  const files = REGISTRY.map((entry) => entry.file);
  assert.equal(new Set(files).size, files.length, "输入面清单有重复条目");
  // 每条的说明非空：清单不是「文件名列表」，而是「这个面从哪儿进入统一分派」。
  for (const entry of REGISTRY) {
    assert.ok(entry.surface.length > 0 && entry.selectAll.length > 0, `${entry.file} 缺少面名或 ⌘A 落面说明`);
    assert.ok(entry.selectAll.includes("selectAllAt"), `${entry.file} 的 ⌘A 落面必须指向统一分派 selectAllAt`);
  }
});

test("单一分派：除两个只读全屏遮罩外，源码里不存在本地 Cmd-A 处理", () => {
  const found = [...SCAN.entries()]
    .filter(([, result]) => result.cmdA.length > 0)
    .map(([file]) => file)
    .sort();
  const allowed = Object.keys(LOCAL_CMD_A_ALLOWED).sort();
  assert.deepEqual(
    found,
    allowed,
    "⌘A 只允许出现在统一键位层，或两个只读全屏遮罩的本地处理里；" +
      "新写一份就地 input.select() 会让输入面再次分叉（清单见 LOCAL_CMD_A_ALLOWED）",
  );
  // 白名单条目必须是真在用的（防止「删了遮罩分支、白名单还留着」的僵尸豁免）。
  for (const file of allowed) {
    assert.ok((SCAN.get(file)?.cmdA.length ?? 0) > 0, `${file} 已在白名单里但不再处理 Cmd-A，应删除该豁免`);
  }
});

test("单一分派：.select() 只出现在统一分派入口与三处「打开即预选」的焦点动作里", () => {
  const found = [...SCAN.entries()]
    .filter(([, result]) => result.selects.length > 0)
    .map(([file]) => file)
    .sort();
  assert.deepEqual(found, Object.keys(SELECT_CALL_ALLOWED).sort(), "出现了未登记的 .select() 调用");
  for (const [file, reason] of Object.entries(SELECT_CALL_ALLOWED)) {
    assert.ok((SCAN.get(file)?.selects.length ?? 0) > 0, `${file} 的 .select() 豁免已失效（${reason}），应删除该条`);
  }
  // 三处浮层的就地副本（本 change 收掉的形态）必须保持为零：它们最容易被重新加回来。
  for (const file of ["src/quick-open.ts", "src/toc.ts", "src/vault-switcher.ts"]) {
    assert.equal(SCAN.get(file)?.selects.length, 0, `${file} MUST NOT 再写就地 input.select()（⌘A 归统一分派）`);
    assert.equal(SCAN.get(file)?.cmdA.length, 0, `${file} MUST NOT 再处理 Cmd-A`);
  }
});
