//! vault 打开段的合成读数（M283，change vault-switch-restore-perf 的 1.3 / 1.4）。
//!
//! 为什么是 `#[ignore]` 的集成测试：读数必须在**复刻真实形状**的合成 vault 上做
//! （≈2500 项 / 1341 md / 7MB、行长正常、含一个 node_modules），而这份 vault 是几 MB 的
//! 生成物——既不进仓库，也不该让每次 `cargo test` 都跑一遍。用法：
//!
//! ```text
//! cargo test --release --test vault_open_readings -- --ignored --nocapture
//! ```
//!
//! 口径：**release**（与 M154 在真实 vault 上的 14.0ms / 111.2ms 可比；debug 下这些数字没有
//! 意义）。**MUST NOT** 复用 M252 的稀疏单行文件放大器——M265 §三 已证那是测量假象（4MB 单行
//! 文件的成本远高于 1525 个 5KB 正常笔记）。
//!
//! 段与真源：
//!   - `scan_workspace` —— 直调生产函数；
//!   - 建图 —— `VaultState::build_graph` 是**私有**方法，这里复刻它的循环
//!     （`commands.rs` 的 build_graph：逐 file 取 markdown 内容后 `LinkGraph::upsert`），
//!     读数因此仍与生产路径逐语句对应；
//!   - 建图（canonicalize 外提 + 批量读）—— **只用于估上限**的复刻实现（裁决点 2 的收益面，
//!     M154 §7）。它省掉的是 `resolve_in_vault` 每文件一次的 `canonicalize(root)`；生产路径
//!     要落地必须自带逃逸校验（见 `fs_io::resolve_in_vault` 的符号链接分支与它那组测试）；
//!   - `watch` —— 直调生产函数（FSEvents 建流；M283 之前从未测过）。
//!
//! 真实 vault 的形状（M265 §一，`/Users/boxcounter/Downloads/Everything-copy` 的
//! scan-visible 规模）：2142 文件 / 426 目录 / 1341 md / 7.01MB。本 harness 生成同形状的
//! 合成 vault（`$TMPDIR/lumir-m283-real-shape`，已存在则复用，`LUMIR_M283_REGENERATE=1`
//! 强制重建）。

use lumir_lib::fs_io::{scan_workspace, watch, FsEntry, FsEntryKind, IgnorePolicy};

/// 生产口径的忽略策略（出厂 `vault.rule_files` 清单）：harness / 场景装配要走生产路径的
/// 同一份规则表，不能用一个「什么都不忽略」的近似——那会让读数与行为都不代表发布形态。
fn production_policy(root: &std::path::Path) -> IgnorePolicy {
    let rule_files: Vec<String> = lumir_lib::config::DEFAULT_RULE_FILES
        .iter()
        .map(|s| s.to_string())
        .collect();
    IgnorePolicy::load(root, &rule_files)
}
use lumir_lib::link_graph::{is_markdown, LinkGraph};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// 合成 vault 的形状参数（复刻真实 vault；改这里等于改「真实形状」的定义）。
const DIRS: usize = 426; // 含根；子目录 425
const MD_FILES: usize = 1341; // md 文件数
const OTHER_FILES: usize = 2142 - MD_FILES; // 非 md 文件（2142 = scan-visible 文件总数）
const MD_TOTAL_BYTES: usize = 7_010_000; // md 总字节（≈7.01MB）
const MAX_MD_BYTES: usize = 239_000; // 单个 md 上限（真实 vault 的最大值）
const RUNS: usize = 5; // 每段的重复次数（取中位数；单次读数在真机上抖动大）

/// 确定性 xorshift64（不引入 rand；失败可复现）。
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next() % n.max(1) as u64) as usize
    }
}

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

fn median(values: &mut [f64]) -> f64 {
    values.sort_by(|a, b| a.partial_cmp(b).expect("finite"));
    values[values.len() / 2]
}

fn shape_dir() -> PathBuf {
    std::env::temp_dir().join("lumir-m283-real-shape")
}

/// 一段正常长度的 markdown 正文（行长 ~78 字符、含标题与 wikilink：建图的解析成本主要落在
/// 行切分与链接解析上，稀疏单行文件在这一点上不成比例）。
fn md_body(size: usize, seed: u64) -> String {
    let words = [
        "vault",
        "index",
        "notes",
        "graph",
        "render",
        "preview",
        "buffer",
        "session",
        "restore",
        "measure",
        "committed",
        "frozen",
        "reader",
        "window",
        "scroll",
        "target",
    ];
    let mut rng = Rng(seed | 1);
    let mut out = String::with_capacity(size + 128);
    out.push_str("# 合成读数样本\n\n");
    out.push_str("> 复刻真实 vault 的文件形状：行长正常、md 正文、含 wikilink。\n\n");
    let mut line = 0usize;
    while out.len() < size {
        match line % 9 {
            0 => out.push_str(&format!("## 小节 {line}\n")),
            1..=3 => {
                // 一行 ~78 字符：16 个词左右，词间空格，行尾换行
                let mut words_in_line = 0;
                while words_in_line < 13 {
                    out.push_str(words[rng.below(words.len())]);
                    out.push(' ');
                    words_in_line += 1;
                }
                out.push('\n');
            }
            4 => out.push_str(&format!("- 条目 {line}：[[notes-{}]]\n", rng.below(400))),
            5 => out.push_str(&format!("  - 子条目 {line}\n")),
            6 => out.push_str(&format!(
                "| 列 A | 列 B {line} |\n| --- | --- |\n| 1 | 2 |\n"
            )),
            7 => out.push_str(&format!("```text\ncode line {line}\n```\n")),
            _ => out.push_str(&format!("\n段落分隔 {line}\n\n")),
        }
        line += 1;
    }
    out
}

/// 按真实形状生成合成 vault（幂等：已存在且目录数匹配就直接复用）。
fn ensure_shape_vault(dir: &Path) -> PathBuf {
    let regenerate = std::env::var("LUMIR_M283_REGENERATE").is_ok();
    if dir.is_dir() && !regenerate {
        let entries =
            scan_workspace(dir, &production_policy(dir)).expect("scan existing synthetic vault");
        println!(
            "复用已存在的合成 vault：{}（scan 可见 {} 项 / md {}）",
            dir.display(),
            entries
                .iter()
                .filter(|e| e.kind == FsEntryKind::File)
                .count(),
            entries
                .iter()
                .filter(|e| e.kind == FsEntryKind::File && is_markdown(&e.path))
                .count()
        );
        return dir.to_path_buf();
    }
    if dir.exists() {
        std::fs::remove_dir_all(dir).expect("clear synthetic vault");
    }
    std::fs::create_dir_all(dir).expect("create synthetic vault root");

    // 目录树：真实 vault 426 个目录，根级 24 项。这里按 24 个一级目录 × 每组若干子目录铺开。
    let top: Vec<PathBuf> = (0..24).map(|i| dir.join(format!("area-{i:02}"))).collect();
    for t in &top {
        std::fs::create_dir_all(t).expect("create top dir");
    }
    let mut rng = Rng(0x283_283);
    let mut subdirs: Vec<PathBuf> = Vec::new();
    let mut made = top.len();
    let mut cursor = 0usize;
    while made + 1 < DIRS {
        let parent = top[cursor % top.len()].clone();
        cursor += 1;
        let sub = parent.join(format!("sub-{:03}", subdirs.len()));
        std::fs::create_dir_all(&sub).expect("create sub dir");
        subdirs.push(sub);
        made += 1;
    }
    let mut dirs: Vec<PathBuf> = top.clone();
    dirs.extend(subdirs.clone());

    // md 文件：总数 MD_FILES / 总字节 ≈ MD_TOTAL_BYTES / 单个上限 MAX_MD_BYTES。
    // 分档复刻真实分布（绝大多数 4–5KB、20 个数十 KB、一个 239KB 的极值），
    // 三档之和 ≈ MD_TOTAL_BYTES。
    let bulk = MD_FILES - 21;
    let mut written_bytes = 0usize;
    for i in 0..MD_FILES {
        let size = if i + 1 == MD_FILES {
            MAX_MD_BYTES
        } else if i < bulk {
            4_100 + rng.below(1_000)
        } else {
            35_000
        };
        written_bytes += size;
        let target = &dirs[i % dirs.len()];
        std::fs::write(
            target.join(format!("note-{i:04}.md")),
            md_body(size, i as u64),
        )
        .expect("write md");
    }

    // 非 md 文件：图片 / 配置 / 代码，散在目录里（真实 vault 的另外 801 个文件）。
    for i in 0..OTHER_FILES {
        let target = &dirs[(i * 7) % dirs.len()];
        let (name, body) = match i % 4 {
            0 => (format!("asset-{i:04}.txt"), "纯文本附件\n".to_string()),
            1 => (format!("data-{i:04}.json"), "{\"v\":1}\n".to_string()),
            2 => (format!("img-{i:04}.svg"), "<svg/>\n".to_string()),
            _ => (
                format!("script-{i:04}.js"),
                "export const v = 1;\n".to_string(),
            ),
        };
        std::fs::write(target.join(name), body).expect("write other file");
    }

    // 忽略生效的探针：node_modules 下的 md MUST NOT 进枚举（fs_io::IGNORED_NAMES）。
    let nm = dir.join("node_modules").join("left-pad");
    std::fs::create_dir_all(&nm).expect("create node_modules");
    for i in 0..40 {
        std::fs::write(
            nm.join(format!("ignored-{i:02}.md")),
            md_body(2_000, i as u64),
        )
        .expect("write ignored md");
    }

    println!(
        "生成合成 vault：{}（目标 {} 目录 / {} md / 约 {:.2}MB，实际 md 字节 {}）",
        dir.display(),
        DIRS,
        MD_FILES,
        MD_TOTAL_BYTES as f64 / 1_048_576.0,
        written_bytes
    );
    dir.to_path_buf()
}

/// `VaultState::build_graph`（commands.rs，私有）的复刻：逐 file 读 markdown 内容后 upsert。
/// 生产路径走 `fs_io::read_text_file`（每次经 `resolve_in_vault` 做两次 canonicalize）。
fn build_graph_replica(root: &Path, entries: &[FsEntry]) -> LinkGraph {
    let mut graph = LinkGraph::new();
    for e in entries {
        if e.kind != FsEntryKind::File {
            continue;
        }
        let content = if is_markdown(&e.path) {
            lumir_lib::fs_io::read_text_file(root, &e.path).ok()
        } else {
            None
        };
        graph.upsert(&e.path, content.as_deref());
    }
    graph
}

/// 复刻 M154 §7 的「canonicalize 外提 + 批量读」（**只用于估收益上限**，不是生产实现）：
/// 根只规范化一次，逐文件直接读（没有 `resolve_in_vault` 的两次 canonicalize）。
fn build_graph_hoisted(root: &Path, entries: &[FsEntry]) -> Result<LinkGraph, String> {
    let canon_root = root.canonicalize().map_err(|e| e.to_string())?;
    let mut graph = LinkGraph::new();
    for e in entries {
        if e.kind != FsEntryKind::File {
            continue;
        }
        let content = if is_markdown(&e.path) {
            std::fs::read(canon_root.join(&e.path))
                .ok()
                .and_then(|bytes| String::from_utf8(bytes).ok())
        } else {
            None
        };
        graph.upsert(&e.path, content.as_deref());
    }
    Ok(graph)
}

/// 整段读数：枚举 / 建图（生产复刻）/ 建图（外提复刻）/ watch 建流。
///
/// 断言只留结构性事实（隔离与忽略生效），耗时全部打印不设阈值——门禁不覆盖 vault 切换
/// （裁决点 4），读数由人读、落 `test-results/`。
#[test]
#[ignore = "读数 harness：cargo test --release --test vault_open_readings -- --ignored --nocapture"]
fn vault_open_segments_on_real_shape_vault() {
    let dir = shape_dir();
    let root = ensure_shape_vault(&dir);

    let entries = scan_workspace(&root, &production_policy(&root)).expect("scan synthetic vault");
    let files: Vec<&FsEntry> = entries
        .iter()
        .filter(|e| e.kind == FsEntryKind::File)
        .collect();
    let md: Vec<&FsEntry> = files
        .iter()
        .copied()
        .filter(|e| is_markdown(&e.path))
        .collect();
    let md_bytes: u64 = md.iter().map(|e| e.size).sum();
    let max_md: u64 = md.iter().map(|e| e.size).max().unwrap_or(0);
    println!("—— 合成 vault 形状 ——");
    println!(
        "目录 {} / 全部条目 {} / 文件 {} / md {}",
        entries
            .iter()
            .filter(|e| e.kind == FsEntryKind::Dir)
            .count(),
        entries.len(),
        files.len(),
        md.len()
    );
    println!(
        "md 总字节 {md_bytes}（{:.2}MB）/ 单文件最大 {max_md}",
        md_bytes as f64 / 1_048_576.0
    );
    assert!(md.len() > 1000, "md 数量应复刻真实形状：{}", md.len());
    // 忽略生效的正负配对（REVIEW.md 第 2 条）：探针文件**确实在盘上**，而枚举结果里
    // 没有它——只断言「没有 node_modules」在探针根本不存在时也会恒真。
    assert!(
        dir.join("node_modules/left-pad/ignored-00.md").is_file(),
        "忽略探针必须真的在盘上"
    );
    assert!(
        !entries.iter().any(|e| e.path.contains("node_modules")),
        "node_modules 下的条目 MUST NOT 出现在枚举结果里（IGNORED_NAMES）"
    );

    println!("—— 分段读数（release，每段 {RUNS} 次取中位数）——");
    let mut scan_samples = Vec::new();
    for _ in 0..RUNS {
        let t = Instant::now();
        let out = scan_workspace(&root, &production_policy(&root)).expect("scan");
        scan_samples.push(ms(t.elapsed()));
        std::hint::black_box(&out);
    }
    let scan = median(&mut scan_samples.clone());
    println!("scan_workspace          中位 {scan:.1}ms  样本 {scan_samples:?}");

    let mut graph_samples = Vec::new();
    for _ in 0..RUNS {
        let t = Instant::now();
        let graph = build_graph_replica(&root, &entries);
        graph_samples.push(ms(t.elapsed()));
        std::hint::black_box(&graph);
    }
    let graph = median(&mut graph_samples.clone());
    println!("build_graph（生产复刻）   中位 {graph:.1}ms  样本 {graph_samples:?}");

    let mut hoisted_samples = Vec::new();
    for _ in 0..RUNS {
        let t = Instant::now();
        let graph = build_graph_hoisted(&root, &entries).expect("hoisted build");
        hoisted_samples.push(ms(t.elapsed()));
        std::hint::black_box(&graph);
    }
    let hoisted = median(&mut hoisted_samples.clone());
    println!(
        "build_graph（canonicalize 外提复刻，仅估上限） 中位 {hoisted:.1}ms  样本 {hoisted_samples:?}"
    );

    let mut watch_samples = Vec::new();
    for _ in 0..RUNS {
        let t = Instant::now();
        let watcher = watch(&root, &production_policy(&root), |_changes| {}).expect("watch");
        watch_samples.push(ms(t.elapsed()));
        drop(watcher);
    }
    let watch_ms = median(&mut watch_samples.clone());
    println!("watch（FSEvents 建流）    中位 {watch_ms:.1}ms  样本 {watch_samples:?}");

    println!(
        "\nvault_load_open 的 Rust 侧合计（scan + build_graph，不含 watch / IPC）≈ {:.1}ms",
        scan + graph
    );
    println!(
        "canonicalize 外提的收益上限（build_graph 复刻差）≈ {:.1}ms",
        graph - hoisted
    );
}
