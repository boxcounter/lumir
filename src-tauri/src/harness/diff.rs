//! edits → unified diff 预览（design §7：批准闸的 diff 由 Rust 侧直接生成）。
//!
//! 最小 Myers 差分 + unified 格式输出（3 行上下文、`@@ -a,b +c,d @@` 头、
//! `\ No newline at end of file` 标记）。只服务**预览**：批准面板里给人看，
//! 不追求最小 diff 的极限（超大输入退化为「公共前后缀裁剪 + 中段整体替换」单 hunk，
//! 仍语义正确）。落盘永远走 `fs_io::fs_patch_file`，diff 不参与写路径。

/// 生成 unified diff。`path` 取 vault 相对路径（`--- a/<path>` / `+++ b/<path>`）。
pub fn unified_diff(path: &str, old: &str, new: &str) -> String {
    let a = split_lines(old);
    let b = split_lines(new);
    let ops = diff_ops(&a, &b);
    render(
        path,
        &a,
        &b,
        &ops,
        old.ends_with('\n') || old.is_empty(),
        new.ends_with('\n') || new.is_empty(),
    )
}

/// 按行切分（不含换行符）；结尾换行不产生空尾行。
fn split_lines(text: &str) -> Vec<&str> {
    if text.is_empty() {
        return Vec::new();
    }
    let mut lines: Vec<&str> = text.split('\n').collect();
    if text.ends_with('\n') {
        lines.pop();
    }
    lines
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Op {
    Keep,
    Del,
    Add,
}

/// Myers 贪心差分（回溯出编辑脚本）。输入规模 guard：乘积过大时退化为前后缀裁剪，
/// 避免病态大文件把预览卡死。
fn diff_ops(a: &[&str], b: &[&str]) -> Vec<Op> {
    const MAX_PRODUCT: usize = 25_000_000; // 5000 × 5000 行
    if a.len() * b.len() > MAX_PRODUCT {
        return trim_fallback_ops(a, b);
    }
    myers_ops(a, b)
}

/// 退化路径：公共前缀 / 后缀保留，中段整段 Del+Add。
fn trim_fallback_ops(a: &[&str], b: &[&str]) -> Vec<Op> {
    let mut prefix = 0;
    while prefix < a.len() && prefix < b.len() && a[prefix] == b[prefix] {
        prefix += 1;
    }
    let mut suffix = 0;
    while suffix < a.len() - prefix
        && suffix < b.len() - prefix
        && a[a.len() - 1 - suffix] == b[b.len() - 1 - suffix]
    {
        suffix += 1;
    }
    let mut ops = vec![Op::Keep; prefix];
    ops.extend(std::iter::repeat_n(Op::Del, a.len() - prefix - suffix));
    ops.extend(std::iter::repeat_n(Op::Add, b.len() - prefix - suffix));
    ops.extend(std::iter::repeat_n(Op::Keep, suffix));
    ops
}

/// 经典 Myers O(ND)：带 trace 的回溯实现（V 数组逐 D 存档）。
fn myers_ops(a: &[&str], b: &[&str]) -> Vec<Op> {
    let n = a.len() as isize;
    let m = b.len() as isize;
    let max = n + m;
    if max == 0 {
        return Vec::new();
    }
    let offset = max;
    let mut v = vec![0isize; (2 * max + 1) as usize];
    let mut trace: Vec<Vec<isize>> = Vec::new();
    let mut found_d = None;
    'outer: for d in 0..=max {
        trace.push(v.clone());
        let mut k = -d;
        while k <= d {
            let idx = (k + offset) as usize;
            let mut x = if k == -d || (k != d && v[idx - 1] < v[idx + 1]) {
                v[idx + 1]
            } else {
                v[idx - 1] + 1
            };
            let mut y = x - k;
            while x < n && y < m && a[x as usize] == b[y as usize] {
                x += 1;
                y += 1;
            }
            v[idx] = x;
            if x >= n && y >= m {
                found_d = Some(d);
                break 'outer;
            }
            k += 2;
        }
    }
    let d_final = found_d.expect("myers: no path found");
    // 回溯编辑脚本。
    let mut ops = Vec::new();
    let mut x = n;
    let mut y = m;
    for d in (0..=d_final).rev() {
        let vd = &trace[d as usize];
        let k = x - y;
        let idx = (k + offset) as usize;
        let prev_k = if k == -d || (k != d && vd[idx - 1] < vd[idx + 1]) {
            k + 1
        } else {
            k - 1
        };
        let prev_x = vd[(prev_k + offset) as usize];
        let prev_y = prev_x - prev_k;
        while x > prev_x && y > prev_y {
            ops.push(Op::Keep);
            x -= 1;
            y -= 1;
        }
        // d=0 的最后一跳只消费 snake（已回到原点），不再产生编辑动作——
        // 否则会把一步 bogus 的 Add/Del 编进脚本（Myers 回溯的标准守卫）。
        if d == 0 {
            break;
        }
        if x == prev_x {
            ops.push(Op::Add);
            y -= 1;
        } else {
            ops.push(Op::Del);
            x -= 1;
        }
    }
    ops.reverse();
    ops
}

const CONTEXT: usize = 3;

/// unified 格式渲染：把 op 序列切成带上下文的 hunk。
fn render(
    path: &str,
    a: &[&str],
    b: &[&str],
    ops: &[Op],
    old_eof_nl: bool,
    new_eof_nl: bool,
) -> String {
    let mut out = String::new();
    out.push_str(&format!("--- a/{path}\n+++ b/{path}\n"));
    let mut i = 0usize; // ops 游标
    let mut old_pos = 0usize; // 已消费的旧行数（hunk 内计数基准）
    let mut new_pos = 0usize;
    let a_len = a.len();
    let b_len = b.len();
    while i < ops.len() {
        if ops[i] == Op::Keep {
            i += 1;
            old_pos += 1;
            new_pos += 1;
            continue;
        }
        // 变更起点：向前取最多 CONTEXT 行上下文。
        let change_start = i;
        let ctx_back = CONTEXT.min(
            change_start
                .saturating_sub(0)
                .min(old_pos.saturating_sub(0)),
        );
        let hunk_old_start = old_pos - ctx_back;
        let hunk_new_start = new_pos - ctx_back;
        let mut hunk_old_len = 0usize;
        let mut hunk_new_len = 0usize;
        let emit_start = change_start - ctx_back;
        // 收集到下一个变更后 CONTEXT 行，或输入结束。
        let mut j = change_start;
        let mut last_change_end = change_start;
        while j < ops.len() {
            match ops[j] {
                Op::Keep => {
                    // 向后看是否还有变更在 CONTEXT 以内。
                    let mut lookahead = j;
                    let mut keeps = 0usize;
                    while lookahead < ops.len() && ops[lookahead] == Op::Keep {
                        keeps += 1;
                        lookahead += 1;
                    }
                    if keeps > 2 * CONTEXT && lookahead < ops.len() {
                        break; // 上下文窗口外还有变更：截断本 hunk
                    }
                    j = lookahead;
                }
                _ => {
                    j += 1;
                    last_change_end = j;
                }
            }
        }
        let emit_end = (last_change_end + CONTEXT).min(ops.len());
        // 渲染 hunk 体并统计行数。
        let mut body = String::new();
        let mut old_idx = hunk_old_start;
        let mut new_idx = hunk_new_start;
        for op in &ops[emit_start..emit_end] {
            match op {
                Op::Keep => {
                    body.push(' ');
                    body.push_str(a[old_idx]);
                    body.push('\n');
                    old_idx += 1;
                    new_idx += 1;
                    hunk_old_len += 1;
                    hunk_new_len += 1;
                }
                Op::Del => {
                    body.push('-');
                    body.push_str(a[old_idx]);
                    body.push('\n');
                    if old_idx == a_len - 1 && !old_eof_nl {
                        body.push_str("\\ No newline at end of file\n");
                    }
                    old_idx += 1;
                    hunk_old_len += 1;
                }
                Op::Add => {
                    body.push('+');
                    body.push_str(b[new_idx]);
                    body.push('\n');
                    if new_idx == b_len - 1 && !new_eof_nl {
                        body.push_str("\\ No newline at end of file\n");
                    }
                    new_idx += 1;
                    hunk_new_len += 1;
                }
            }
        }
        // unified 约定：空区间起点取「插入位置前一行号」（可为 0）。
        let old_hdr = if hunk_old_len == 0 {
            hunk_old_start
        } else {
            hunk_old_start + 1
        };
        let new_hdr = if hunk_new_len == 0 {
            hunk_new_start
        } else {
            hunk_new_start + 1
        };
        out.push_str(&format!(
            "@@ -{old_hdr},{hunk_old_len} +{new_hdr},{hunk_new_len} @@\n{body}"
        ));
        // 推进游标到 hunk 结束。
        let consumed_old = old_idx - hunk_old_start;
        let consumed_new = new_idx - hunk_new_start;
        old_pos = hunk_old_start + consumed_old;
        new_pos = hunk_new_start + consumed_new;
        i = emit_end;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_line_change() {
        let d = unified_diff("a.md", "one\ntwo\nthree\n", "one\nTWO\nthree\n");
        assert!(d.contains("--- a/a.md\n+++ b/a.md\n"), "{d}");
        assert!(d.contains("@@ -1,3 +1,3 @@"), "{d}");
        assert!(d.contains("-two\n+TWO\n"), "{d}");
        assert!(d.contains(" one\n"), "{d}");
    }

    #[test]
    fn insertion_at_end() {
        let d = unified_diff("a.md", "one\n", "one\ntwo\n");
        assert!(d.contains("@@ -1,1 +1,2 @@"), "{d}");
        assert!(d.contains("+two\n"), "{d}");
    }

    #[test]
    fn empty_old_is_all_additions() {
        let d = unified_diff("new.md", "", "hello\nworld\n");
        assert!(d.contains("@@ -0,0 +1,2 @@"), "{d}");
        assert!(d.contains("+hello\n+world\n"), "{d}");
        assert!(!d.contains("\n-"), "{d}");
    }

    #[test]
    fn deletion_only() {
        let d = unified_diff("a.md", "one\ntwo\nthree\n", "one\nthree\n");
        assert!(d.contains("-two\n"), "{d}");
    }

    #[test]
    fn no_newline_marker() {
        let d = unified_diff("a.md", "one", "one\ntwo");
        assert!(d.contains("\\ No newline at end of file\n"), "{d}");
        assert!(d.contains("+two\n"), "{d}");
    }

    #[test]
    fn multiple_hunks_split_by_context() {
        let old: String = (0..30).map(|i| format!("line{i}\n")).collect();
        let new: String = (0..30)
            .map(|i| {
                if i == 2 || i == 27 {
                    format!("L{i}\n")
                } else {
                    format!("line{i}\n")
                }
            })
            .collect();
        let d = unified_diff("a.md", &old, &new);
        assert!(d.contains("@@ -1,6 +1,6 @@"), "{d}");
        assert!(d.contains("@@ -25,6 +25,6 @@"), "{d}");
    }
}
