//! 链接图名称索引一致性差分测试（M33 性能重构的行为保障）。
//!
//! 语义本体仍由 wikilink_fixtures.rs（frozen spec cases.json 全量断言）保障；
//! 本测试专防索引维护错误：在随机增删改序列后，增量维护名称索引（path/tail/
//! stem 三组 HashMap）的 LinkGraph 必须与同内容全新重建的图产出完全一致的
//! resolve / backlinks 结果（历史敏感性差分，捕获索引残留）。

use lumir_lib::link_graph::{parse_links, LinkGraph};
use std::collections::BTreeMap;

/// 确定性 xorshift64（不引入 rand 依赖；种子固定，失败可复现）。
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
        (self.next() % n as u64) as usize
    }
}

/// 候选文件池：多目录 × 共享 stem（制造 ambiguous）、大小写变体（exact/folded
/// 分层）、附件（embed 双语义）、无扩展名文件。
fn file_pool() -> Vec<String> {
    let mut pool = Vec::new();
    for d in 0..4 {
        for s in 0..6 {
            pool.push(format!("dir-{d}/note-{s}.md"));
            pool.push(format!("dir-{d}/sub/note-{s}.md"));
        }
    }
    pool.push("Foo.md".to_string());
    pool.push("foo.md".to_string());
    pool.push("note-1.md".to_string()); // 与 dir-*/note-1.md 撞 stem
    pool.push("assets/img-0.png".to_string());
    pool.push("assets/img-1.PNG".to_string());
    pool.push("assets/plain".to_string());
    pool
}

/// 生成文档内容：混合短名 / 带路径 / 带锚点 / 大小写变体 / 未创建 / embed 形态。
fn gen_content(rng: &mut Rng, tag: u64) -> String {
    let mut s = format!("# 标题 {tag}\n\n## 第一节\n\n");
    let stems = ["note-0", "note-1", "note-2", "foo", "Foo", "ghost", "assets/plain"];
    for i in 0..8 {
        let stem = stems[rng.below(stems.len())];
        match i % 5 {
            0 => s.push_str(&format!("短名 [[{stem}]]。\n")),
            1 => s.push_str(&format!("带路径 [[dir-{}/{}.md]]。\n", rng.below(4), stems[rng.below(6)])),
            2 => s.push_str(&format!("带锚点 [[{stem}#第一节]]。\n")),
            3 => s.push_str(&format!("附件 ![[assets/img-{}.png]]。\n", rng.below(2))),
            _ => s.push_str(&format!("后缀 [[dir-{}/note-{}]] 无扩展名。\n", rng.below(4), rng.below(6))),
        }
    }
    s.push_str("[[#第一节]] 自引用。[[a^b]] 非块引用词法。\n");
    s
}

/// 全新重建（build_graph 口径）：非 md 只登记路径，md 带内容。
fn rebuild(state: &BTreeMap<String, Option<String>>) -> LinkGraph {
    let mut g = LinkGraph::new();
    for (path, content) in state {
        g.upsert(path, content.as_deref());
    }
    g
}

/// 两图全口径一致：全部曾出现 target 的 backlinks + 全部文档全部链接的 resolve。
fn assert_equivalent(a: &LinkGraph, b: &LinkGraph, state: &BTreeMap<String, Option<String>>, ghosts: &[String]) {
    let mut targets: Vec<&str> = state.keys().map(|p| p.as_str()).collect();
    targets.extend(ghosts.iter().map(|p| p.as_str()));
    for t in targets {
        assert_eq!(a.backlinks(t), b.backlinks(t), "backlinks 不一致：target={t}");
    }
    for (path, content) in state {
        let Some(content) = content else { continue };
        for link in parse_links(content) {
            assert_eq!(
                a.resolve(path, &link),
                b.resolve(path, &link),
                "resolve 不一致：from={path} link={link:?}"
            );
        }
    }
}

#[test]
fn incremental_index_matches_fresh_rebuild() {
    let pool = file_pool();
    let mut rng = Rng(0x9E3779B97F4A7C15);
    let mut state: BTreeMap<String, Option<String>> = BTreeMap::new();
    let mut removed: Vec<String> = Vec::new();
    let mut graph = LinkGraph::new();
    let mut tag = 0u64;

    // 初始装载一半文件
    for path in pool.iter().take(pool.len() / 2) {
        let content = if path.ends_with(".md") {
            tag += 1;
            Some(gen_content(&mut rng, tag))
        } else {
            None
        };
        graph.upsert(path, content.as_deref());
        state.insert(path.clone(), content);
    }
    assert_equivalent(&graph, &rebuild(&state), &state, &removed);

    for _step in 0..300 {
        match rng.below(10) {
            // 新增或改写（含同路径重复 upsert）
            0..=4 => {
                let path = pool[rng.below(pool.len())].clone();
                let content = if path.ends_with(".md") {
                    tag += 1;
                    Some(gen_content(&mut rng, tag))
                } else {
                    None
                };
                graph.upsert(&path, content.as_deref());
                state.insert(path, content);
            }
            // md 读取失败口径（内容丢弃，路径保留在候选全集）
            5 => {
                let md_files: Vec<&String> = state
                    .keys()
                    .filter(|p| p.ends_with(".md"))
                    .collect();
                if !md_files.is_empty() {
                    let path = md_files[rng.below(md_files.len())].clone();
                    graph.upsert(&path, None);
                    state.insert(path, None);
                }
            }
            // 删除单文件
            6..=7 => {
                let keys: Vec<&String> = state.keys().collect();
                if !keys.is_empty() {
                    let path = keys[rng.below(keys.len())].clone();
                    graph.remove(&path);
                    state.remove(&path);
                    removed.push(path);
                }
            }
            // 删除目录（级联移除子孙）
            8 => {
                let dir = format!("dir-{}", rng.below(4));
                graph.remove(&dir);
                let prefix = format!("{dir}/");
                let gone: Vec<String> = state
                    .keys()
                    .filter(|p| p.starts_with(&prefix))
                    .cloned()
                    .collect();
                for p in gone {
                    state.remove(&p);
                    removed.push(p);
                }
            }
            // 原地不动（对照组：等价性在无操作时也必须保持）
            _ => {}
        }
        assert_equivalent(&graph, &rebuild(&state), &state, &removed);
    }
}

/// 反链（deprecated 的全量重算路径）针对性断言：新文件把既有 unresolved 链接
/// 变 resolved 后反链必须出现；候选集变化（ambiguous 裁决点 G 抢占）与删除
/// 目标后反链必须相应转移/消失。语义断言，与实现是否走索引无关。
#[test]
fn backlink_tracks_create_and_delete() {
    let mut g = LinkGraph::new();
    g.upsert("a.md", Some("指向 [[b]] 与 [[c]]。\n"));
    assert!(g.backlinks("b.md").is_empty());

    g.upsert("b.md", Some("# B\n"));
    let items = g.backlinks("b.md");
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].source, "a.md");
    assert_eq!(items[0].line, 1);

    // 短名 [[c]] 的 stem 候选初始只有 dir/c.md
    g.upsert("dir/c.md", Some("# C\n"));
    assert_eq!(g.backlinks("dir/c.md").len(), 1);

    // 新增根级 c.md：候选变 ambiguous，裁决点 G 段数最少优先 → c.md 抢占
    g.upsert("c.md", Some("# 根级 C\n"));
    assert_eq!(g.backlinks("dir/c.md").len(), 0, "c.md 应抢占 [[c]]");
    assert_eq!(g.backlinks("c.md").len(), 1);

    g.remove("c.md");
    assert_eq!(g.backlinks("dir/c.md").len(), 1, "删除 c.md 后 [[c]] 回落到 dir/c.md");
    g.remove("dir");
    assert!(g.backlinks("dir/c.md").is_empty());

    // 源文档内容改写：旧反链消失、新反链出现
    g.upsert("a.md", Some("改指 [[b]]。\n"));
    assert_eq!(g.backlinks("b.md").len(), 1);
    g.upsert("a.md", Some("不再指向任何文件。\n"));
    assert!(g.backlinks("b.md").is_empty());
}
