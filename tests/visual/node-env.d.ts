// tests/visual 是自包含子项目（独立 lockfile，不进根 workspace），未装 @types/node；
// 但 scenes/*.ts 与 playwright.config.ts 是 Node 端执行的 spec（读 fixture、写探针读数、
// 起 vite dev server、读环境变量）。本文件补齐用到的那一小撮 Node API 的环境声明，让
// tests/visual/tsconfig.json 的 tsc --noEmit 在零新增依赖下通过。若将来允许改
// tests/visual/package.json，应换正装 @types/node 并删除本文件。
declare module "node:fs" {
  export function readFileSync(path: string | URL, encoding: string): string;
  export function writeFileSync(path: string | URL, data: string): void;
  export function mkdirSync(path: string | URL, options: { recursive: boolean }): void;
}
declare module "node:path" {
  export function join(...parts: string[]): string;
}
declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}
declare var process: {
  cwd(): string;
  env: Record<string, string | undefined>;
};
