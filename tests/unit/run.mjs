// tests/unit/run.mjs — 前端单测层入口（零新增依赖：node:test + Node 自带的 TypeScript 类型剥离）。
//
// 为什么是「类型剥离 + 现跑源码」而不是「tsc 预编译成产物再跑」：
//   - 预编译要么被无扩展名相对导入卡住（tsc 不会把 `./ipc` 改写成 `./ipc.js`，源码不改就
//     跑不起来），要么转成 CJS 再打补丁替换模块边界——两种都多出一份产物目录、一套「跑的
//     到底是不是当前源码」的核对，以及第二种解释器口径。类型剥离直接跑 src/*.ts。
//   - 代价是 Node 下限：类型剥离需 ≥22.6（22.18+ 默认开启，22.6–22.17 需显式 flag）。仓库
//     README 声明的下限 ^20.19.0 跑不了这一层（Node 20 已于 2026-04-30 EOL）。取舍与后续
//     处置见 tests/unit/README.md。
//   - 版本不足时**报错退出**，不静默跳过：留下一个「跑了但其实没跑」的绿正是本层要修的病。
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, "../..");

const probe = spawnSync(process.execPath, ["--experimental-strip-types", "-e", "0"], { stdio: "ignore" });
if (probe.status !== 0) {
  console.error(
    `unit-tests: Node ${process.version} 不支持 TypeScript 类型剥离（--experimental-strip-types，需 ≥22.6；22.18 起默认开启）。`,
  );
  console.error("本层零依赖的前提就是 Node 自带的类型剥离；请升级 Node 后重跑（取舍见 tests/unit/README.md）。");
  process.exit(1);
}

const tests = readdirSync(dir)
  .filter((name) => name.endsWith(".test.ts"))
  .sort()
  .map((name) => path.join(dir, name));
if (tests.length === 0) {
  console.error("unit-tests: tests/unit 下没有 *.test.ts——这一层形同没有，请先补测试。");
  process.exit(1);
}

// 显式传测试文件列表：不依赖 node --test 的默认匹配规则（它是否把 *.test.ts 算进来随版本变化）。
const result = spawnSync(
  process.execPath,
  ["--experimental-strip-types", "--import", pathToFileURL(path.join(dir, "register.mjs")).href, "--test", ...tests],
  { stdio: "inherit", cwd: root },
);
process.exit(result.status ?? 1);
