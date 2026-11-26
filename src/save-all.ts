// 「保存全部」的屏障与**操作归属日志**（change add-acceptance-installed-app-pause）。
//
// 为什么必须是一个独立模块而不是 main.ts 里的一段：保存全部是验收通道的**退出许可**——
// 它必须能被无 DOM、无 Tauri 的单测覆盖失败链与竞态（会话 / 阅读位置真实写失败、后端镜像
// 同步失败、await 期间出现新 dirty、并发触发）。装配层只注入真实依赖与 toast / 状态日志。
//
// 成功终态的**机器判据**不是 toast 文本，而是 `log` 写出的状态日志。每次命令调用都留下一条
// 记录（带单调 seq、操作代次与状态），例如：
//   `save-all-log s0:g0:idle s1:g1:running s2:g1:ok`
//
// 为什么是**日志**而不是单个状态值（K3 第二轮 P1-3）：
//   - 验收通道触发前读基线（最后一条记录的 seq / 代次），触发后必须看到**第一条新记录是
//     running**，并锁定它的代次 G；随后只接受**同代次 G 的 ok**。无归属的更高代 ok（如基线 3
//     直接出现 g5 ok）、别的代次的 ok 覆盖 busy/failed，都不可能被当成本次成功。
//   - `busy` 与 `failed` 是**追加**的记录，不会被后来的 ok 覆盖；验收通道按顺序看到它们即失败。
//   - 屏障可能在验收通道第一次轮询前就跑完；日志仍保留 `running → ok` 的完整序列，快速完成
//     因此仍可归属（不靠猜）。
export type SaveAllLogState = "idle" | "running" | "ok" | "failed" | "busy";

export interface SaveAllRecord {
  /** 单调递增的记录序号（跨命令调用不重置）。 */
  seq: number;
  /** 操作代次：每次真正开始的保存全部加一；busy 复用当前代次（不开启新操作）。 */
  generation: number;
  state: SaveAllLogState;
}

/** 日志前缀与容量：容量只需覆盖最近几次操作——验收通道在触发前刚读过基线，一次操作最多
 *  追加 2 条记录。格式与 `scripts/acceptance/lib/installed-app.mjs` 的解析器是同一约定
 *  （两边各有一份字面量；`tests/unit/save-all.test.ts` 用验收解析器回读产品日志做跨层对账）。 */
export const SAVE_ALL_LOG_PREFIX = "save-all-log";
export const SAVE_ALL_LOG_LIMIT = 12;

export function formatSaveAllLog(records: readonly SaveAllRecord[]): string {
  const body = records.map((record) => `s${record.seq}:g${record.generation}:${record.state}`).join(" ");
  return `${SAVE_ALL_LOG_PREFIX} ${body}`;
}

/** 启动时的初始日志（验收通道的基线必须是可读的 idle，而不是「没有日志」）。 */
export function initialSaveAllLog(): string {
  return formatSaveAllLog([{ seq: 0, generation: 0, state: "idle" }]);
}

export interface SaveAllBarrierDeps {
  /** 保存全部脏标签；false = 至少一条没闭环（冲突 / 写失败 / 无落盘基准）。 */
  saveAllDirty(): Promise<boolean>;
  /** 标签会话真实落盘；false = 后端报告磁盘写失败（warning 已记）。 */
  flushSessions(): Promise<boolean>;
  /** 阅读位置真实落盘；false = 后端报告磁盘写失败（warning 已记）。 */
  flushPositions(): Promise<boolean>;
  /** 当前是否还有脏标签（任一 pane 的任一会话）。 */
  anyDirty(): boolean;
  /** 把后端退出守卫的 dirty 镜像同步为 `dirty`，await 到命令回包；reject = 同步失败。 */
  syncDirty(dirty: boolean): Promise<void>;
  /** 写给验收通道读的状态日志（视觉隐藏、AX 可达）。 */
  log(text: string): void;
  /** 用户可读的成功 / 失败 / 并发提示（既有 toast 文案）。 */
  toastSuccess(): void;
  toastFailure(): void;
  toastBusy(): void;
}

export interface SaveAllBarrier {
  /** 执行一次保存全部；返回是否**全部成功**（失败 / 并发被拒都是 false）。 */
  run(): Promise<boolean>;
  generation(): number;
  isRunning(): boolean;
  /** 当前日志文本（测试与诊断用；与 `log` 回调收到的内容同源）。 */
  logText(): string;
}

export function createSaveAllBarrier(deps: SaveAllBarrierDeps): SaveAllBarrier {
  let generation = 0;
  let seq = 0;
  let running = false;
  const records: SaveAllRecord[] = [{ seq: 0, generation: 0, state: "idle" }];

  const push = (state: SaveAllLogState, gen: number): void => {
    seq += 1;
    records.push({ seq, generation: gen, state });
    while (records.length > SAVE_ALL_LOG_LIMIT) records.shift();
    deps.log(formatSaveAllLog(records));
  };

  async function run(): Promise<boolean> {
    if (running) {
      // 单飞：并发 / 重复触发**不开新代次**，只追加一条 busy（同一代次）。日志是追加的，
      // 后来的成功不会覆盖它——验收通道按顺序看到 busy 即判失败。
      push("busy", generation);
      deps.toastBusy();
      return false;
    }
    running = true;
    generation += 1;
    const gen = generation;
    push("running", gen);
    const fail = (): false => {
      push("failed", gen);
      deps.toastFailure();
      return false;
    };
    try {
      if (!(await deps.saveAllDirty())) return fail();
      if (!(await deps.flushSessions())) return fail();
      if (!(await deps.flushPositions())) return fail();
      if (deps.anyDirty()) return fail();

      // 后端 dirty 镜像同步：await 到回包才算同步完成（不是 fire-and-forget）。
      try {
        await deps.syncDirty(false);
      } catch {
        return fail();
      }

      // 关键窗口（K3 P1-4）：同步的 await 期间用户可能继续编辑。必须在**同步返回之后**再查
      // 一次；有新 dirty 就把镜像恢复成 true（MUST NOT 用 false 覆盖新 dirty），然后失败。
      // 这里之后没有任何 await——「复查 → 发成功」是一个同步原子段。
      if (deps.anyDirty()) {
        try {
          await deps.syncDirty(true);
        } catch {
          // 恢复失败也走失败终态；下一次 onDirty 还会再推。成功终态 MUST NOT 发出。
        }
        return fail();
      }

      push("ok", gen);
      deps.toastSuccess();
      return true;
    } finally {
      running = false;
    }
  }

  return {
    run,
    generation: () => generation,
    isRunning: () => running,
    logText: () => formatSaveAllLog(records),
  };
}
