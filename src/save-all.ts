// 「保存全部」的屏障与**操作代次**（change add-acceptance-installed-app-pause）。
//
// 为什么必须是一个独立模块而不是 main.ts 里的一段：保存全部是验收通道的**退出许可**——
// 它必须能被无 DOM、无 Tauri 的单测覆盖失败链与竞态（会话 / 阅读位置真实写失败、后端镜像
// 同步失败、await 期间出现新 dirty、并发触发）。装配层只注入真实依赖与 toast / 状态标记。
//
// 成功终态的**机器判据**不是 toast 文本，而是 `marker` 写出的状态标记：
//   `save-all#<generation> <running|ok|failed|busy>`
// 每次真正开始的保存全部都会把 generation 加一；并发触发不增加代次，只把状态置为 `busy`
// （同一代次）。验收通道读取**触发前**的代次，只接受「代次更大且状态为 ok」的标记——旧的
// 成功提示（3.5s toast）与并发的第二次触发因此都不可能让它提前放行。
export type SaveAllMarkerState = "running" | "ok" | "failed" | "busy";

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
  /** 写给验收通道读的状态标记（视觉隐藏、AX 可达）；见文件头。 */
  marker(state: SaveAllMarkerState, generation: number): void;
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
}

export function createSaveAllBarrier(deps: SaveAllBarrierDeps): SaveAllBarrier {
  let generation = 0;
  let running = false;

  async function run(): Promise<boolean> {
    if (running) {
      // 单飞：并发 / 重复触发**不开新代次**，也不排队——把状态标成同一代次的 busy，让验收
      // 通道立刻判失败（而不是等一个不属于它的完成信号），用户侧给一句「正在保存」。
      deps.marker("busy", generation);
      deps.toastBusy();
      return false;
    }
    running = true;
    generation += 1;
    const gen = generation;
    deps.marker("running", gen);
    const fail = (): false => {
      deps.marker("failed", gen);
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

      deps.marker("ok", gen);
      deps.toastSuccess();
      return true;
    } finally {
      running = false;
    }
  }

  return { run, generation: () => generation, isRunning: () => running };
}
