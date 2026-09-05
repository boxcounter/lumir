//! wikilink fixture 全量断言（ADR 0003 §4 兼容性本体，双解析器纪律的 Rust 侧）。
//!
//! 唯一事实来源：tests/wikilink-fixtures/cases.json（frozen spec v1.1 的机器可执行形态）。
//! 本测试消费全部 parseCases（解析字段）、resolveCases 与 createCases；静态 vault
//! 无法建模的"创建时目标已存在"（索引过期守卫，spec §4.4）由末尾单测直接构造。
//! fixture 只读：createCases 在临时副本上执行，不改动仓内 vault。

use lumir_lib::fs_io;
use lumir_lib::link_graph::{parse_links, AnchorStatus, LinkGraph, LinkStatus};
use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Deserialize)]
struct Cases {
    #[serde(rename = "vaultRoot")]
    vault_root: String,
    #[serde(rename = "parseCases")]
    parse_cases: Vec<ParseCase>,
    #[serde(rename = "resolveCases")]
    resolve_cases: Vec<ResolveCase>,
    #[serde(rename = "createCases")]
    create_cases: Vec<CreateCase>,
}

#[derive(Deserialize)]
struct ParseCase {
    id: String,
    input: String,
    expect: ParseExpect,
}

#[derive(Deserialize)]
struct ParseExpect {
    links: Vec<LinkExpect>,
}

#[derive(Deserialize)]
struct LinkExpect {
    span: (usize, usize),
    embed: bool,
    path: String,
    #[serde(rename = "headingPath")]
    heading_path: Vec<String>,
    alias: Option<String>,
    #[serde(rename = "blockRef")]
    block_ref: bool,
}

#[derive(Deserialize)]
struct ResolveCase {
    id: String,
    from: String,
    link: String,
    expect: ResolveExpect,
}

#[derive(Deserialize)]
struct ResolveExpect {
    status: String,
    path: Option<String>,
    candidates: Option<Vec<String>>,
    #[serde(rename = "embedTarget")]
    embed_target: Option<String>,
    anchor: Option<AnchorExpect>,
}

#[derive(Deserialize)]
struct AnchorExpect {
    status: String,
    heading: Option<String>,
}

#[derive(Deserialize)]
struct CreateCase {
    id: String,
    from: String,
    link: String,
    expect: CreateExpect,
}

#[derive(Deserialize)]
struct CreateExpect {
    created: String,
}

fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/wikilink-fixtures")
}

fn load_cases() -> Cases {
    let text = std::fs::read_to_string(fixture_dir().join("cases.json")).expect("read cases.json");
    serde_json::from_str(&text).expect("parse cases.json")
}

/// 从 vault 目录建图：全量枚举 + 读取全部 .md 内容（与 open_vault 的建图路径同口径）。
fn build_graph(root: &Path) -> LinkGraph {
    let entries = fs_io::scan_workspace(root).expect("scan fixture vault");
    let mut graph = LinkGraph::new();
    for e in &entries {
        if e.kind != lumir_lib::fs_io::FsEntryKind::File {
            continue;
        }
        let content = if lumir_lib::link_graph::is_markdown(&e.path) {
            fs_io::read_text_file(root, &e.path).ok()
        } else {
            None
        };
        graph.upsert(&e.path, content.as_deref());
    }
    graph
}

#[test]
fn parse_cases_all() {
    let cases = load_cases();
    assert!(!cases.parse_cases.is_empty());
    for c in &cases.parse_cases {
        let links = parse_links(&c.input);
        assert_eq!(
            links.len(),
            c.expect.links.len(),
            "case {}: 链接数量不符（{links:?}）",
            c.id
        );
        for (got, want) in links.iter().zip(c.expect.links.iter()) {
            assert_eq!(got.span, want.span, "case {}: span", c.id);
            assert_eq!(got.embed, want.embed, "case {}: embed", c.id);
            assert_eq!(got.path, want.path, "case {}: path", c.id);
            assert_eq!(
                got.heading_path, want.heading_path,
                "case {}: headingPath",
                c.id
            );
            assert_eq!(got.alias, want.alias, "case {}: alias", c.id);
            assert_eq!(got.block_ref, want.block_ref, "case {}: blockRef", c.id);
        }
    }
}

#[test]
fn resolve_cases_all() {
    let cases = load_cases();
    assert!(!cases.resolve_cases.is_empty());
    let graph = build_graph(&fixture_dir().join(&cases.vault_root));
    for c in &cases.resolve_cases {
        let res = graph
            .resolve_link(&c.from, &c.link)
            .unwrap_or_else(|e| panic!("case {}: resolve_link 失败：{e}", c.id));
        let status = match res.status {
            LinkStatus::Resolved => "resolved",
            LinkStatus::Ambiguous => "ambiguous",
            LinkStatus::Unresolved => "unresolved",
            LinkStatus::Unsupported => "unsupported",
        };
        assert_eq!(status, c.expect.status, "case {}: status", c.id);
        if let Some(want) = &c.expect.path {
            assert_eq!(res.path.as_ref(), Some(want), "case {}: path", c.id);
        }
        if let Some(want) = &c.expect.candidates {
            // 有序性不作要求，按集合比较（fixture README）
            let mut got = res.candidates.clone();
            let mut want = want.clone();
            got.sort();
            want.sort();
            assert_eq!(got, want, "case {}: candidates", c.id);
        }
        if let Some(want) = &c.expect.embed_target {
            let got = res.embed_target.map(|t| match t {
                lumir_lib::link_graph::EmbedTarget::Attachment => "attachment",
                lumir_lib::link_graph::EmbedTarget::Note => "note",
            });
            assert_eq!(got, Some(want.as_str()), "case {}: embedTarget", c.id);
        }
        if let Some(want) = &c.expect.anchor {
            let status = match res.anchor.status {
                AnchorStatus::None => "none",
                AnchorStatus::Found => "found",
                AnchorStatus::Missing => "missing",
            };
            assert_eq!(status, want.status, "case {}: anchor.status", c.id);
            if let Some(h) = &want.heading {
                assert_eq!(
                    res.anchor.heading.as_ref(),
                    Some(h),
                    "case {}: anchor.heading",
                    c.id
                );
            }
        }
    }
}

// ---------------------------------------------------------------------------
// createCases：临时副本执行（fixture vault 只读）
// ---------------------------------------------------------------------------

/// 无 tempfile 依赖（同 fs_io 测试纪律）：pid + 用例 id 造唯一目录，drop 时递归删除。
struct TempVault(PathBuf);

impl TempVault {
    fn copy_of(src: &Path, id: &str) -> Self {
        let dst =
            std::env::temp_dir().join(format!("lumir-wikilink-test-{}-{id}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dst);
        copy_dir(src, &dst);
        Self(dst)
    }
}

impl Drop for TempVault {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn copy_dir(src: &Path, dst: &Path) {
    std::fs::create_dir_all(dst).expect("create temp copy");
    for item in std::fs::read_dir(src).expect("read src dir") {
        let item = item.expect("dir entry");
        let to = dst.join(item.file_name());
        if item.file_type().expect("file type").is_dir() {
            copy_dir(&item.path(), &to);
        } else {
            std::fs::copy(item.path(), &to).expect("copy file");
        }
    }
}

/// vault 快照：相对路径 → 内容字节（用于"既有文件零改动"断言）。
fn snapshot(root: &Path) -> Vec<(String, Vec<u8>)> {
    let mut out = Vec::new();
    let entries = fs_io::scan_workspace(root).expect("scan temp vault");
    for e in entries {
        if e.kind == fs_io::FsEntryKind::File {
            out.push((
                e.path.clone(),
                std::fs::read(root.join(&e.path)).expect("read file"),
            ));
        }
    }
    out.sort();
    out
}

#[test]
fn create_cases_all() {
    let cases = load_cases();
    assert!(!cases.create_cases.is_empty());
    let src = fixture_dir().join(&cases.vault_root);
    for c in &cases.create_cases {
        let temp = TempVault::copy_of(&src, &c.id);
        let before = snapshot(&temp.0);
        let mut graph = build_graph(&temp.0);
        let created = graph
            .create_note(&temp.0, &c.from, &c.link)
            .unwrap_or_else(|e| panic!("case {}: create_note 失败：{e}", c.id));
        assert_eq!(created, c.expect.created, "case {}: created", c.id);
        // 新文件存在且内容为空
        assert_eq!(
            std::fs::read(temp.0.join(&created)).expect("created file exists"),
            Vec::<u8>::new(),
            "case {}: 创建内容必须为空",
            c.id
        );
        // 既有文件零改动
        let after: Vec<_> = snapshot(&temp.0)
            .into_iter()
            .filter(|(p, _)| p != &created)
            .collect();
        assert_eq!(before, after, "case {}: 既有文件被改动", c.id);
        // 创建后重解析 → resolved（spec §4.4）
        let res = graph
            .resolve_link(&c.from, &c.link)
            .expect("resolve after create");
        assert_eq!(
            res.status,
            LinkStatus::Resolved,
            "case {}: 创建后应 resolved",
            c.id
        );
        assert_eq!(res.path.as_deref(), Some(created.as_str()), "case {}", c.id);
    }
}

#[test]
fn create_never_overwrites_existing_file() {
    // 索引过期守卫（spec §4.4）：静态 vault 无法建模，直接构造——
    // 图建成后在磁盘上手工放置同名文件（不更新图），create 必须报错且不覆盖。
    let src = fixture_dir().join(load_cases().vault_root);
    let temp = TempVault::copy_of(&src, "stale-guard");
    let mut graph = build_graph(&temp.0);
    let occupied = temp.0.join("stale.md");
    std::fs::write(&occupied, "既有内容").expect("plant stale file");
    let err = graph
        .create_note(&temp.0, "Alpha.md", "[[stale]]")
        .expect_err("目标已存在必须报错");
    assert_eq!(err.code, "wikilink_target_exists");
    assert_eq!(
        std::fs::read_to_string(&occupied).expect("read"),
        "既有内容",
        "MUST NOT 覆盖既有文件"
    );
}
