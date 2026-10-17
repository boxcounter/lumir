//! Harness 侧图片附件（change harness-composer-image-paste design §5）：composer 粘贴的
//! 剪贴板图片落 `<config_dir>/harness/attachments/<vault 稳定 id>/pasted-<hash16>.<ext>`——
//! 与会话留存 `sessions/<vault 稳定 id>/` 同族（兄弟根、同一 vault 稳定 id 分层），
//! **MUST NOT 触碰 vault**。命名 / 转码 / 原子写 / 上限判据全部复用 `fs_io` 原语
//! （design §5.3 裁决点 3：提为共用，不复制第二份）。
//!
//! 与会话留存的处置差异（design §5.1，如实登记）：sessions 对不合格 vault id 按
//! `_orphaned/` 兜底落盘（服务一次性归位脚本 + 运行时防御）；附件**零存量**、读路径按
//! vault id 解析，落兜底目录即永远命不中（静默缺图），故写时拿不到合格 id =
//! **拒绝落盘** + 人话错误，不建任何兜底目录。
//!
//! 投递协议侧（design §4）：会话 input 项与 JSONL 留存恒为引用形态
//! （`image_url = lumir-attachment://<name>`），发送前由 [`expand_image_refs`] 就地展开为
//! base64 data URL（真 client 与 mock 同一条函数）；JSONL MUST NOT 内联 base64。

use std::path::{Path, PathBuf};

use serde::Serialize;
use ts_rs::TS;

use crate::commands::CommandError;
use crate::config;
use crate::fs_io;

use super::jsonl;

/// harness 附件引用 scheme（会话侧 input 项的 `image_url` 前缀；design §4.3）。
pub const ATTACHMENT_SCHEME: &str = "lumir-attachment://";

/// 投递投影的一个 part（前端 `serializeDelivery` 的产物，经 `harness_send` 的 parts_json
/// 传入；design §4.2）。`kind` 判别：`text` 取 `text`，`image` 取 `name` + `label`。
///
/// `label`（change composer-image-mention design §5.1）是图片块携带的**投递标签** `Image N`
/// ——与卡片徽标同源的编号，模型指代单张图的唯一把手。**图片 part 缺 label 即非法**
/// （缺标签破坏「模型看到编号」这条硬保证，MUST NOT 静默放行）。
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
pub struct DeliveryPart {
    pub kind: String,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    /// 图片 part 的投递标签（`Image N`）；文本 part 恒为 None。
    #[serde(default)]
    pub label: Option<String>,
}

impl DeliveryPart {
    fn is_image(&self) -> bool {
        self.kind == "image"
    }
}

/// 解析 parts_json（`harness_send` 的入参面）：必须是 JSON 数组，逐项宽容取 kind/text/name/label。
/// 形状非法拒绝本次发送（与 `parse_context` 同口径：不空转线程）。图片 part 缺 `label`
/// 同样按非法投影拒绝（缺标签 = 破坏「模型看到编号」，见 `DeliveryPart` 的字段注释）。
pub fn parse_delivery_parts(parts_json: &str) -> Result<Vec<DeliveryPart>, CommandError> {
    let value: serde_json::Value = serde_json::from_str(parts_json).map_err(|e| {
        CommandError::new(
            "harness_parts_invalid",
            format!("投递投影不是合法 JSON：{e}"),
        )
    })?;
    let items = value
        .as_array()
        .ok_or_else(|| CommandError::new("harness_parts_invalid", "投递投影必须是 JSON 数组"))?;
    let mut parts = Vec::with_capacity(items.len());
    for item in items {
        let kind = item["kind"].as_str().unwrap_or("").to_string();
        if kind != "text" && kind != "image" {
            return Err(CommandError::new(
                "harness_parts_invalid",
                format!("投递投影含未知 part 类型：{kind}"),
            ));
        }
        let label = item["label"].as_str().map(str::to_string);
        if kind == "image" && label.is_none() {
            return Err(CommandError::new(
                "harness_parts_invalid",
                "投递投影的图片 part 缺少标签（Image N）".to_string(),
            ));
        }
        parts.push(DeliveryPart {
            kind,
            text: item["text"].as_str().map(str::to_string),
            name: item["name"].as_str().map(str::to_string),
            label,
        });
    }
    Ok(parts)
}

/// 本 vault 的 harness 附件目录 `<config_dir>/harness/attachments/<vault 稳定 id>/`
/// （首次写时创建；design §5.1）。目录名纪律复用 sessions 的 `vault_dir_name`；id 不合格
/// → **拒绝**（CommandError），MUST NOT 落任何兜底目录。
pub fn vault_attachments_dir(vault_id: &str) -> Result<PathBuf, CommandError> {
    let name = jsonl::vault_dir_name(vault_id).ok_or_else(|| {
        CommandError::new(
            "harness_attachment_no_vault",
            "当前 vault 无法归属（缺少有效的 vault 标识），图片未保存：请先打开一个 vault 再粘贴图片",
        )
    })?;
    let dir = config::config_dir()?
        .join("harness")
        .join("attachments")
        .join(name);
    std::fs::create_dir_all(&dir).map_err(|e| {
        CommandError::new(
            "harness_attachment_dir_failed",
            format!("无法创建图片附件目录 {}：{e}", dir.display()),
        )
        .param("dir", dir.display().to_string())
        .param("reason", e.to_string())
    })?;
    Ok(dir)
}

/// `harness_write_image` 的返回（ts-rs 导出）：内容寻址名 + 像素尺寸
///（尺寸由落盘命令一并回传，卡片元信息行的数据源；design §3）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct HarnessWrittenImage {
    /// 内容寻址文件名 `pasted-<hash16>.<ext>`。
    pub name: String,
    pub width: u32,
    pub height: u32,
}

/// 引用名形态校验：`pasted-<hash16>.<webp|jpg>`（读命令的唯一入口形态；design §5.4）。
/// 形状校验即路径逃逸防护——无分隔符 / 无 `..` 成分，拼进 vault 目录后不可能出界。
fn is_attachment_name(name: &str) -> bool {
    let Some(rest) = name.strip_prefix("pasted-") else {
        return false;
    };
    let Some((hash, ext)) = rest.rsplit_once('.') else {
        return false;
    };
    hash.len() == 16
        && hash
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        && matches!(ext, "webp" | "jpg")
}

/// 从内容寻址扩展名推回 MIME 子类型（读回 / 展开时渲染 `<img>` 与 data URL 用）。
fn mime_of_name(name: &str) -> &'static str {
    if name.ends_with(".jpg") {
        "jpeg"
    } else {
        "webp"
    }
}

/// 解码图片字节尺寸（`image` crate 已在依赖树内——与转码原语同 crate）。
fn image_dimensions(bytes: &[u8]) -> Result<(u32, u32), CommandError> {
    let image = image::load_from_memory(bytes).map_err(|e| {
        CommandError::new(
            "attachment_decode_failed",
            format!("无法解码剪贴板图片：{e}"),
        )
        .param("reason", e.to_string())
    })?;
    Ok((image.width(), image.height()))
}

/// 写原语核心（给定目标目录；`write_image` 的落点解析后的形态）：链路与 vault 附件
/// [`fs_io::write_attachment`] 同族——base64 解码 + 50MB 上限（转码前）→ 转码
/// （png → WebP 无损；jpeg / webp 原样，其余拒绝）→ 内容寻址命名 → 原子写；差异只在
/// 落点与去重范围（本目录内 `exists` 判定即可，同名即同内容；同一张图贴进两个 vault
/// 各存一份是分层布局的诚实代价，design §5.2）与回传尺寸。
fn write_image_to(
    dir: &Path,
    data_base64: &str,
    source_mime: &str,
) -> Result<HarnessWrittenImage, CommandError> {
    let (transcode, extension) = fs_io::attachment_target(source_mime)?;
    let raw = fs_io::decode_attachment_base64(data_base64)?;
    let bytes = if transcode {
        fs_io::transcode_png_to_webp(&raw)?
    } else {
        raw
    };
    let (width, height) = image_dimensions(&bytes)?;
    let name = format!("pasted-{}.{extension}", fs_io::short_hash(&bytes));
    if dir.join(&name).exists() {
        // 内容寻址：同名即同内容，跳过写盘。
        return Ok(HarnessWrittenImage {
            name,
            width,
            height,
        });
    }
    match fs_io::write_attachment_atomic(dir, &name, &bytes)? {
        fs_io::AtomicWriteOutcome::Written | fs_io::AtomicWriteOutcome::TargetExists => {
            Ok(HarnessWrittenImage {
                name,
                width,
                height,
            })
        }
    }
}

/// `harness_write_image` 的实现体（design §5.2 / §5.3）。
pub fn write_image(
    vault_id: &str,
    data_base64: &str,
    source_mime: &str,
) -> Result<HarnessWrittenImage, CommandError> {
    let dir = vault_attachments_dir(vault_id)?;
    write_image_to(&dir, data_base64, source_mime)
}

/// 读回附件字节核心（给定 vault 目录；缩略图渲染与 wire 展开共用）。限引用名形态、限尺寸。
fn read_image_bytes_from(dir: &Path, name: &str) -> Result<Vec<u8>, CommandError> {
    if !is_attachment_name(name) {
        return Err(CommandError::new(
            "harness_image_name_invalid",
            format!("非法的图片附件名：{name}"),
        )
        .param("name", name));
    }
    let path = dir.join(name);
    let bytes = std::fs::read(&path).map_err(|e| {
        CommandError::new(
            "harness_image_read_failed",
            format!("无法读取图片附件 {}：{e}", path.display()),
        )
        .param("name", name)
        .param("reason", e.to_string())
    })?;
    if bytes.len() as u64 > fs_io::ATTACHMENT_MAX_BYTES {
        return Err(CommandError::new(
            "harness_image_read_failed",
            format!(
                "图片附件超出大小上限（{}）：{name}",
                fs_io::ATTACHMENT_MAX_BYTES
            ),
        )
        .param("name", name)
        .param("reason", "超出大小上限".to_string()));
    }
    Ok(bytes)
}

/// 读回附件字节（缩略图渲染与 wire 展开的取数口）。落点 = 本 vault 目录
/// （design §5.2：引用名只在本 vault 目录内唯一，MUST NOT 跨 vault 查找）。
fn read_image_bytes(vault_id: &str, name: &str) -> Result<Vec<u8>, CommandError> {
    let dir = vault_attachments_dir(vault_id)?;
    read_image_bytes_from(&dir, name)
}

/// `harness_read_image` 的实现体：base64 返回（前端转 blob URL 渲染缩略图）。
pub fn read_image(vault_id: &str, name: &str) -> Result<String, CommandError> {
    Ok(fs_io::base64_encode(&read_image_bytes(vault_id, name)?))
}

/// wire 展开核心（给定 vault 目录；design §4.3；标签注入见 change composer-image-mention
/// design §5.3）：把 input 数组里 `image_url = lumir-attachment://<name>` 的 part 就地换成
/// `data:image/<sub>;base64,<…>`（子类型由扩展名映射），并在该图片 part **之前**插入一个
/// `{"type":"input_text","text":"<label>"}` part（label 取自 part 的本地字段 `lumir_label`、
/// 取自后剥掉该字段）——模型因此读到「编号 → 图」的紧邻配对。读文件失败 → Err（本轮以人话
/// 错误收口，MUST NOT 发出静默缺图的请求）；无引用项时原样克隆。真 client 与 mock
/// 同调这一条（mock 的验收断言因此覆盖「wire 上真的是 input_image」）。
///
/// `lumir_label` 缺席（理论上不可达：装配侧 [`content_of_parts`] 恒带上它，入参 face
/// [`parse_delivery_parts`] 又拒绝缺标签的图片 part）时不插标签行、照常展开——防御面，不 panic。
fn expand_image_refs_from(
    input: &[serde_json::Value],
    dir: &Path,
) -> Result<Vec<serde_json::Value>, CommandError> {
    let mut out = Vec::with_capacity(input.len());
    for item in input {
        let Some(parts) = item["content"].as_array() else {
            out.push(item.clone());
            continue;
        };
        let mut expanded_parts = Vec::with_capacity(parts.len());
        for part in parts {
            let url = part["image_url"].as_str().unwrap_or("");
            let Some(name) = url.strip_prefix(ATTACHMENT_SCHEME) else {
                expanded_parts.push(part.clone());
                continue;
            };
            if part["type"].as_str() != Some("input_image") {
                expanded_parts.push(part.clone());
                continue;
            }
            let bytes = read_image_bytes_from(dir, name)?;
            let mut expanded = part.clone();
            expanded["image_url"] = serde_json::json!(format!(
                "data:image/{};base64,{}",
                mime_of_name(name),
                fs_io::base64_encode(&bytes),
            ));
            // 本地字段只活在留存 / 装配面：wire part 只剩标准字段（剥掉 lumir_label）。
            if let Some(obj) = expanded.as_object_mut() {
                obj.remove("lumir_label");
            }
            // 标签行紧邻图片之前（设计 §5.3：`) [input_text "Image 1"], [input_image dataURL]`）。
            if let Some(label) = part["lumir_label"].as_str() {
                expanded_parts.push(serde_json::json!({
                    "type": "input_text",
                    "text": label,
                }));
            }
            expanded_parts.push(expanded);
        }
        let mut expanded_item = item.clone();
        expanded_item["content"] = serde_json::Value::Array(expanded_parts);
        out.push(expanded_item);
    }
    Ok(out)
}

/// wire 展开（design §4.3 的具名入口）：落点按当前会话作用域的 vault id 解析。
/// 无引用项时不解析落点、不建目录——纯文本会话路径零附件面副作用。
pub fn expand_image_refs(
    input: &[serde_json::Value],
    vault_id: &str,
) -> Result<Vec<serde_json::Value>, CommandError> {
    let has_refs = input.iter().any(|item| {
        item["content"].as_array().is_some_and(|parts| {
            parts.iter().any(|part| {
                part["image_url"]
                    .as_str()
                    .is_some_and(|url| url.starts_with(ATTACHMENT_SCHEME))
            })
        })
    });
    if !has_refs {
        return Ok(input.to_vec());
    }
    let dir = vault_attachments_dir(vault_id)?;
    expand_image_refs_from(input, &dir)
}

/// 面板文本投影（design §4.2）：把 user 消息项的 content parts 还原成面板文本形态
/// （文本 part 原文 + 图片 part 的 `<image ref="…" type="…"/>` 占位行，行间 `\n`）。
/// 投递投影与面板文本是同一块序列的两个投影——本函数是 Rust 侧的**唯一**还原口：
/// 会话入队（panel 面）与历史恢复（`restored_panel_messages`）都经它，两侧不可能漂
/// （REVIEW.md 「同一语义两处真源」条）。
///
/// 占位元素只带 ref / type（宽度/高度在 wire 引用形态里不存在，恢复的卡片只显文件名——
/// ImageCard.width/height 是可选字段，与解析侧宽容口径一致）。图片 part 的本地标签字段
/// `lumir_label` 被**有意忽略**——它承载编号但只进 wire，正文面不得出现标签行
/// （change composer-image-mention design §5.2）。
pub fn panel_text_of_content(content: &[serde_json::Value]) -> Option<String> {
    let mut lines: Vec<String> = Vec::new();
    for part in content {
        match part["type"].as_str() {
            Some("input_text") | Some("output_text") => {
                if let Some(text) = part["text"].as_str() {
                    lines.push(text.to_string());
                }
            }
            Some("input_image") => {
                let url = part["image_url"].as_str().unwrap_or("");
                let name = url.strip_prefix(ATTACHMENT_SCHEME).unwrap_or(url);
                if name.is_empty() {
                    return None;
                }
                lines.push(format!(
                    "<image ref=\"{}\" type=\"image/{}\"/>",
                    name,
                    mime_of_name(name),
                ));
            }
            _ => {}
        }
    }
    if lines.is_empty() {
        None
    } else {
        Some(lines.join("\n"))
    }
}

/// user 消息项的 content 数组（引用形态；design §4.2）——`input_text` part 逐个来自
/// 投影的 text part，`input_image` part 的 `image_url` 是 `lumir-attachment://` 引用，
/// 并携带**本地字段** `lumir_label`（图片块的投递标签 `Image N`；change composer-image-mention
/// design §5.2）。
///
/// `lumir_label` 只活在留存与装配面：它进留存的 messages（可审计地带着编号），但
/// `panel_text_of_content` 只取文本 part 原文、图片 part 只还占位行——**留存的文本面不含标签行**，
/// 恢复路径因此不会把 `Image N` 复现成正文。发送前由 [`expand_image_refs_from`] 生成标签行并剥掉
/// 该字段，provider 永不看见。parts 为空（全空消息的理论路径）时产出单个空 text part，保持历史
/// content 形状。
pub fn content_of_parts(parts: &[DeliveryPart]) -> Vec<serde_json::Value> {
    let mut content = Vec::with_capacity(parts.len());
    for part in parts {
        if part.is_image() {
            let name = part.name.clone().unwrap_or_default();
            let mut image = serde_json::json!({
                "type": "input_image",
                "image_url": format!("{ATTACHMENT_SCHEME}{name}"),
            });
            if let Some(label) = part.label.as_deref() {
                image["lumir_label"] = serde_json::json!(label);
            }
            content.push(image);
        } else {
            content.push(serde_json::json!({
                "type": "input_text",
                "text": part.text.clone().unwrap_or_default(),
            }));
        }
    }
    if content.is_empty() {
        content.push(serde_json::json!({ "type": "input_text", "text": "" }));
    }
    content
}

/// user 消息项（投递投影 + 上下文节的装配结果；引用形态入会话 input）。
pub fn user_item_of_parts(parts: &[DeliveryPart]) -> serde_json::Value {
    serde_json::json!({
        "role": "user",
        "content": content_of_parts(parts),
    })
}

/// 把上下文节追加进投影（发送装配；`turn::assemble_user_message` 的 parts 版）：
/// 节恒落在消息末尾——有 text part 则拼进**最后一个** text part 尾部（`{text}\n\n[节]`，
/// 与旧串装配逐字节一致），否则新建一个只含节的 text part。单 text part 消息的上下文
/// 节拼接结果与旧 `assemble_user_message(message)` 逐字节相同。
pub fn apply_context_section(
    mut parts: Vec<DeliveryPart>,
    section: Option<&str>,
) -> Vec<DeliveryPart> {
    let Some(section) = section else {
        return parts;
    };
    let bracketed = super::turn::bracket_context_section(section);
    match parts.iter().rposition(|part| !part.is_image()) {
        Some(index) => {
            let text = parts[index].text.clone().unwrap_or_default();
            parts[index].text = Some(format!(
                "{text}{}{bracketed}",
                super::turn::CONTEXT_SECTION_SEPARATOR
            ));
        }
        None => parts.push(DeliveryPart {
            kind: "text".to_string(),
            text: Some(bracketed),
            name: None,
            label: None,
        }),
    }
    parts
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "lumir-harness-attach-{}-{}",
            name,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// 合成 1×1 红色 png。
    fn tiny_png() -> Vec<u8> {
        let img = image::RgbImage::from_pixel(1, 1, image::Rgb([255, 0, 0]));
        let mut buf = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(img)
            .write_to(&mut buf, image::ImageFormat::Png)
            .unwrap();
        buf.into_inner()
    }

    #[test]
    fn attachment_name_shape_validation() {
        for ok in [
            "pasted-0123456789abcdef.webp",
            "pasted-0123456789abcdef.jpg",
            "pasted-ffffffffffffffff.webp",
        ] {
            assert!(is_attachment_name(ok), "{ok}");
        }
        for bad in [
            "pasted-0123456789abcde.webp", // hash 短一位
            "pasted-0123456789abcdef.png", // 未广告扩展名
            "pasted-0123456789ABCDE.webp", // 大写
            "pasted-0123456789abcdef",     // 无扩展名
            "../pasted-0123456789abcdef.webp",
            "pasted-0123456../abcdef.webp",
            "_orphaned",
            "a/b.webp",
            "",
        ] {
            assert!(!is_attachment_name(bad), "{bad}");
        }
    }

    #[test]
    fn write_read_roundtrip_and_dedupe() {
        let dir = tmpdir("write-read");
        let png = tiny_png();
        let written = write_image_to(&dir, &fs_io::base64_encode(&png), "image/png").unwrap();
        assert!(written.name.ends_with(".webp"), "{}", written.name);
        assert_eq!((written.width, written.height), (1, 1));
        // 落点在目标目录内、内容寻址名可回读。
        let read_back = read_image_bytes_from(&dir, &written.name).unwrap();
        // 无损转码往返像素一致（1×1 纯红）。
        let decoded = image::load_from_memory(&read_back).unwrap();
        assert_eq!(decoded.width(), 1);
        assert_eq!(decoded.height(), 1);
        // 同名再写 = 跳过（幂等、不报错）。
        let again = write_image_to(&dir, &fs_io::base64_encode(&png), "image/png").unwrap();
        assert_eq!(again.name, written.name);
        // jpeg 原样：把 webp 字节按 image/webp 写入（转码原语已单测，这里只验通道）。
        let written2 =
            write_image_to(&dir, &fs_io::base64_encode(&read_back), "image/webp").unwrap();
        assert_eq!(written2.name, written.name, "同内容同寻址名");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_image_rejects_unsupported_and_oversize() {
        let dir = tmpdir("reject");
        let err = write_image_to(&dir, "AAAA", "image/gif").unwrap_err();
        assert_eq!(err.code, "attachment_type_unsupported");
        // 超限判定在解码前：base64 长度上界（`len / 4 * 3 + 2`）超限即拒（与 fs_io
        // 测试同公式），超限载荷不被解码/分配。
        let huge = "A".repeat(fs_io::ATTACHMENT_MAX_BYTES as usize / 3 * 4 + 8);
        let err = write_image_to(&dir, &huge, "image/png").unwrap_err();
        assert_eq!(err.code, "attachment_too_large");
        // 坏 base64。
        let err = write_image_to(&dir, "!!!!", "image/png").unwrap_err();
        assert_eq!(err.code, "attachment_decode_failed");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_image_missing_and_escape_rejected() {
        let dir = tmpdir("read-missing");
        let err = read_image_bytes_from(&dir, "pasted-0123456789abcdef.webp").unwrap_err();
        assert_eq!(err.code, "harness_image_read_failed");
        for bad in [
            "../pasted-0123456789abcdef.webp",
            "pasted-0123456789abcdef.png",
            "sessions",
            "..",
        ] {
            let err = read_image_bytes_from(&dir, bad).unwrap_err();
            assert_eq!(err.code, "harness_image_name_invalid", "{bad}");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn vault_attachments_dir_rejects_invalid_id() {
        // 不合格 id（含保留名）拒绝落盘，MUST NOT 落任何兜底目录。
        for bad in ["", "..", "a/b", "_orphaned", "s.xxx"] {
            let err = vault_attachments_dir(bad).unwrap_err();
            assert_eq!(err.code, "harness_attachment_no_vault", "{bad}");
        }
    }

    #[test]
    fn expand_image_refs_expands_and_propagates_errors() {
        let dir = tmpdir("expand");
        let png = tiny_png();
        let written = write_image_to(&dir, &fs_io::base64_encode(&png), "image/png").unwrap();
        let input = vec![serde_json::json!({
            "role": "user",
            "content": [
                {"type": "input_text", "text": "看图"},
                {"type": "input_image", "image_url": format!("lumir-attachment://{}", written.name), "lumir_label": "Image 1"},
            ],
        })];
        let expanded = expand_image_refs_from(&input, &dir).unwrap();
        // 标签行紧邻图片之前：`[text "看图"], [text "Image 1"], [image dataURL]`。
        assert_eq!(expanded[0]["content"][1]["type"], "input_text");
        assert_eq!(expanded[0]["content"][1]["text"], "Image 1");
        let image = &expanded[0]["content"][2];
        assert_eq!(image["type"], "input_image");
        let url = image["image_url"].as_str().unwrap();
        assert!(url.starts_with("data:image/webp;base64,"), "{url}");
        // 本地字段被剥掉——wire part 只剩标准字段，provider 看不到 lumir_label。
        assert!(
            image.get("lumir_label").is_none(),
            "lumir_label 必须从 wire part 剥掉"
        );
        // 引用项之外原样：文本 part 与消息骨架不动。
        assert_eq!(expanded[0]["content"][0], input[0]["content"][0]);
        assert_eq!(expanded[0]["role"], "user");
        // 缺失附件 → 人话错误（本轮收口，不静默缺图）。
        let missing = vec![serde_json::json!({
            "role": "user",
            "content": [{"type": "input_image", "image_url": "lumir-attachment://pasted-0123456789abcdef.webp"}],
        })];
        let err = expand_image_refs_from(&missing, &dir).unwrap_err();
        assert_eq!(err.code, "harness_image_read_failed");
        // 非法 scheme / 非 input_image 带 scheme 串 → 原样保留。
        let foreign = vec![serde_json::json!({
            "role": "user",
            "content": [{"type": "input_image", "image_url": "https://example.com/a.png"}],
        })];
        assert_eq!(expand_image_refs_from(&foreign, &dir).unwrap(), foreign);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn expand_image_refs_no_refs_is_zero_side_effect() {
        // 无引用项：原样 clone，不解析落点（纯文本会话路径零附件面副作用）——逐字节相同。
        let input = vec![serde_json::json!({
            "role": "user",
            "content": [{"type": "input_text", "text": "纯文本"}],
        })];
        assert_eq!(expand_image_refs(&input, "any-vault-id").unwrap(), input);
    }

    #[test]
    fn parse_delivery_parts_validates_shape() {
        let parts = parse_delivery_parts(
            r#"[{"kind":"text","text":"问"},{"kind":"image","name":"pasted-x.webp","label":"Image 1"}]"#,
        )
        .unwrap();
        assert_eq!(parts.len(), 2);
        assert!(parts[1].is_image());
        assert!(parse_delivery_parts("not json").is_err());
        assert!(parse_delivery_parts("{}").is_err());
        assert!(parse_delivery_parts(r#"[{"kind":"video"}]"#).is_err());
        // 图片 part 缺 label = 破坏「模型看到编号」→ 拒绝本次发送（MUST NOT 静默放行）。
        let err = parse_delivery_parts(r#"[{"kind":"image","name":"pasted-x.webp"}]"#).unwrap_err();
        assert_eq!(err.code, "harness_parts_invalid");
        // 文本 part 不带 label 合法（label 只对图片 part 必选）。
        assert!(parse_delivery_parts(r#"[{"kind":"text","text":"问"}]"#).is_ok());
    }

    #[test]
    fn content_of_parts_interleaves_reference_form() {
        let parts = parse_delivery_parts(
            r#"[{"kind":"text","text":"先看图"},{"kind":"image","name":"pasted-a.webp","label":"Image 1"},{"kind":"text","text":"哪里不对"}]"#,
        )
        .unwrap();
        let content = content_of_parts(&parts);
        assert_eq!(content[0]["type"], "input_text");
        assert_eq!(content[1]["type"], "input_image");
        assert_eq!(
            content[1]["image_url"], "lumir-attachment://pasted-a.webp",
            "会话侧恒为引用形态，MUST NOT 内联 base64"
        );
        assert!(!content[1]["image_url"].as_str().unwrap().contains("base64"));
        // 本地标签字段在场（留存可审计地带着编号），但**文本面**不含标签行。
        assert_eq!(content[1]["lumir_label"], "Image 1");
        // 空投影：保持历史 content 形状（单空 text part）。
        let empty = content_of_parts(&[]);
        assert_eq!(empty.len(), 1);
        assert_eq!(empty[0]["text"], "");
    }

    #[test]
    fn panel_text_of_content_round_trips_placeholder() {
        let parts = parse_delivery_parts(
            r#"[{"kind":"text","text":"先看图"},{"kind":"image","name":"pasted-a.webp","label":"Image 1"},{"kind":"text","text":"哪里不对"}]"#,
        )
        .unwrap();
        let text = panel_text_of_content(&content_of_parts(&parts)).unwrap();
        assert_eq!(
            text,
            "先看图\n<image ref=\"pasted-a.webp\" type=\"image/webp\"/>\n哪里不对"
        );
        // 文本面 MUST NOT 出现标签行（恢复路径不会把 `Image N` 复现成正文）。
        assert!(!text.contains("Image 1"));
        // 还原回 parts 的形状（恢复路径：面板文本 ⟺ 块序列，与前端 parseQuoteMessage 同口径）。
        let image_line = text.lines().nth(1).unwrap();
        assert!(image_line.starts_with("<image ref=\"pasted-a.webp\""));
    }

    #[test]
    fn apply_context_section_appends_to_last_text_part() {
        let parts = parse_delivery_parts(r#"[{"kind":"text","text":"问"}]"#).unwrap();
        let applied = apply_context_section(parts, Some("当前编辑器上下文：\n文件：a.md"));
        assert_eq!(
            applied[0].text.as_deref(),
            Some("问\n\n[当前编辑器上下文：\n文件：a.md]"),
            "单 text part 与旧串装配逐字节一致"
        );
        // 图片-only 消息：新建只含节的 text part 压尾。
        let image_only =
            parse_delivery_parts(r#"[{"kind":"image","name":"pasted-a.webp","label":"Image 1"}]"#)
                .unwrap();
        let applied = apply_context_section(image_only, Some("节"));
        assert_eq!(applied.len(), 2);
        assert_eq!(applied[1].text.as_deref(), Some("[节]"));
        // 图在中间的交错：节落最后的 text part，交错不被打散。
        let mixed = parse_delivery_parts(
            r#"[{"kind":"text","text":"前"},{"kind":"image","name":"pasted-a.webp","label":"Image 1"},{"kind":"text","text":"后"}]"#,
        )
        .unwrap();
        let applied = apply_context_section(mixed, Some("节"));
        assert_eq!(applied.len(), 3);
        assert_eq!(applied[2].text.as_deref(), Some("后\n\n[节]"));
        assert!(applied[1].is_image());
        // 无节：原样。
        let none = parse_delivery_parts(r#"[{"kind":"text","text":"问"}]"#).unwrap();
        assert_eq!(apply_context_section(none, None).len(), 1);
    }
}
