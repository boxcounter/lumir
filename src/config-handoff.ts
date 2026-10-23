// 启动期配置读数的一次性交接（change app-splash-screen，design §3.4「配置读数只有一份」）。
//
// 分工：启动层（src/boot.ts）在首帧之前读一次 `config_get`（启动链路本来就要发起的那一次），
// 主模块（src/main.ts）的配置装配接这份结果——同一份配置 MUST NOT 为两处各读一次：多一次
// IPC，也让「谁是启动期配置的读者」出现两个答案（REVIEW.md『同一语义两处真源』条）。
//
// 一次性交接：消费过一次就清空。没有交接就消费 = 非产品路径（`index.html` 恒指向 boot.ts），
// 返回 null 让调用方按「读取失败」降级——不在这里补一次读取，那会重新造出第二处发起方。

import type { ConfigSnapshot } from "./bindings/ConfigSnapshot";

/** 启动层读到的快照（null = 读取失败）。undefined = 还没交接。 */
let handed: ConfigSnapshot | null | undefined;

/** 启动层交出读数（在 `await import("./main")` 之前调用）。 */
export function handOffConfig(snapshot: ConfigSnapshot | null): void {
  handed = snapshot;
}

/** 主模块取走读数（同一份读数只有一个消费者）；无交接时按读取失败返回 null。 */
export function consumeConfigSnapshot(): Promise<ConfigSnapshot | null> {
  const snapshot = handed ?? null;
  handed = undefined;
  return Promise.resolve(snapshot);
}
