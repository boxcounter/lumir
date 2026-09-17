// tests/unit 是 Node 端执行的 TypeScript（node:test 用例 + 测试替身），未装 @types/node
// （本层零新增依赖）。本文件按 tests/visual/node-env.d.ts 的同一口径，补齐用到的这一小撮
// Node API 的环境声明，让 tsconfig.json 的 tsc --noEmit 能跑。
// 若将来允许加 devDependency，应换正装 @types/node 并删除本文件。
declare module "node:test" {
  export interface TestContext {
    name: string;
    diagnostic(message: string): void;
  }
  export function test(name: string, fn: (t: TestContext) => void | Promise<void>): void;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
  export const mock: {
    timers: {
      enable(options?: { apis?: string[]; now?: number | Date }): void;
      tick(ms: number): void;
      runAll(): void;
      reset(): void;
    };
  };
}

declare module "node:assert/strict" {
  interface Assert {
    ok(value: unknown, message?: string): asserts value;
    equal(actual: unknown, expected: unknown, message?: string): void;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    match(value: string, pattern: RegExp, message?: string): void;
    throws(fn: () => unknown, expected?: RegExp | string, message?: string): void;
    doesNotThrow(fn: () => unknown, message?: string): void;
  }
  const assert: Assert;
  export default assert;
}

declare var process: {
  version: string;
  exitCode?: number;
  exit(code?: number): never;
};

// flush 微任务链用（mock timers 只接管 setTimeout，setImmediate 仍是 Node 原生的）。
declare function setImmediate(callback: (...args: unknown[]) => void, ...args: unknown[]): unknown;
