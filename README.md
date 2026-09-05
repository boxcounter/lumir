# Lumir

把 agent 当作可见协作者的文本工作台：本地纯文件、全文件类型一等公民、agent 可见协作、极致快。定位与边界的完整论证见 [ADR 0001](docs/adr/0001-product-positioning-and-boundaries.md)。

当前处于早期开发阶段（里程碑划分见 [ADR 0004](docs/adr/0004-development-and-openness-strategy.md)），功能与接口随时会变。项目在 M3 里程碑达成前不接受外部贡献，因此暂无贡献指南。

## 开发环境要求

- Rust（stable 工具链）
- Node.js ^20.19.0 或 >=22.12.0（Vite 要求）
- pnpm

## 运行

### 开发模式

```bash
pnpm dev:app
```

`pnpm dev:app` 即 `tauri dev`（`pnpm tauri` 是 CLI 入口，其余子命令同）：CLI 会先执行 `beforeDevCommand` 自动启动 Vite dev server（固定 127.0.0.1:1420），再编译并启动 Rust shell，webview 加载 dev server，前端改动热更新。关闭 app 窗口或 Ctrl-C 即一并回收 dev server。

注意：不要同时自己再跑一个 `pnpm dev`——Vite 配置了 `strictPort`，端口 1420 被占会让 `beforeDevCommand` 失败、整个 `tauri dev` 中止。想单独看前端效果时用 `pnpm dev` + 浏览器即可。

### 发布构建（单命令）

```bash
pnpm tauri build
```

`tauri build` 会先执行 `beforeBuildCommand`（`pnpm build`）构建前端，并自动为 Rust 侧带上 `--features custom-protocol`，webview 加载内嵌的 `dist/`。

如果不用 Tauri CLI、直接走 cargo，**必须显式带 feature**，否则构建产物被视为 dev、运行时尝试连接不存在的 dev server，窗口白屏且无任何报错：

```bash
cargo run --release --features custom-protocol   # 正确
cargo run --release                              # 错误：白屏（缺 custom-protocol）
```

## 文档地图

| 目录 | 内容 |
|---|---|
| [docs/adr/](docs/adr/) | 架构决策记录（ADR）：跨切面的"为什么"（定位、技术路线、开放策略等） |
| [openspec/](openspec/) | 功能规格层：living spec 与 change proposal，管"功能做什么" |
| [docs/specs/](docs/specs/) | 专项规格（如性能测量方法学） |
| [docs/process/](docs/process/) | 制品流程约定（ADR 生命周期、OpenSpec 工作流） |

ADR 与 OpenSpec 的分工：ADR 记跨切面架构决策，OpenSpec 管功能规格；功能变更不产生 ADR，架构转向不写成 proposal（ADR 0004 第 5 条）。

## CI 门禁

所有门禁在 PR 与 master push 上强制执行，全绿才可合入：

| Workflow | 门禁内容 |
|---|---|
| `rust.yml` | `cargo fmt --check`、`clippy -D warnings`、`cargo test`（含 ts-rs bindings 导出校验） |
| `perf.yml` | 性能合同测量：绝对阈值 + 相对滚动基线回归 >20% 拒合（方法学见 [docs/specs/perf-measurement.md](docs/specs/perf-measurement.md)） |
| `visual.yml` | 视觉回归：布局、配色、间距不回归（口径见 tests/visual/README.md） |
| `docs-check.yml` | ADR 与 OpenSpec 制品的结构与合法性校验 |

## License

[MIT](LICENSE)
