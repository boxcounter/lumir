// 设置面板（change add-model-automation-settings-oct24 tasks §5；capability `settings`）。
//
// 单页两节，没有 TAB / 侧边导航：**模型接入**（provider 列表 + 选中项的编辑表单，可增删改）
// 与**自动化**（四个全局开关 + 会话命名 / 图片命名各自内联的目标选择与一行生效说明）。
//
// 分层（与本仓既有面板同一条纪律）：
//   - **纯模型层**（本文件上半部，零 DOM）：草稿 `Draft`、脏判定、patch 构造、命名目标预览、
//     错误按 path 回填的分类。`tests/unit/settings-panel.test.ts` 直接驱动这些函数。
//   - **视图层**（`createSettingsPanel`）：只渲染纯模型的产物，不自行判定校验规则。
//
// 三条不可越界的口径：
//   1. **校验只在 Rust**（design §6.3）：前端不做 id 字符集 / 窗口区间 / 重复 / 互斥判定，
//      只做输入整形（trim、number input、按 `capabilities` 置灰选项）；保存失败后按后端返回的
//      `path` 把错误挂到控件上。原型里的 `validateDraft` 是演示形态的模拟，MUST NOT 搬进实现。
//   2. **单一来源**：预设表、id 规则、窗口区间、默认值全部来自后端快照的 `capabilities` /
//      `defaults`，前端不复制常量；命名目标的**已保存读数**由后端在快照里给出，草稿改过时
//      才用 `namingRowModel` 做「便于预判」的预览（design §10.5）。
//   3. **删除保护**：删除只改草稿；替代目标在删除确认里就位，同一笔 patch 原子落盘。前端算的
//      引用面只用于**显示**，后端在锁内重新计算（design §4.2）。
//
// 可访问性：`role="dialog"` + `aria-modal`、背景 `inert`、焦点圈定与交还、三条关闭路径
// （Escape / 点遮罩 / 再按 ⌘,）、脏面板两步确认、`role="status"` 的 polite live region。

import { errorText, t, onRelabel } from "./copy";
import type { CopyKey } from "./copy-data";
import { escapeDisposition, escapeRouter, registerEscapeLayer, unregisterEscapeLayer } from "./escape-router";
import { settingsApply, settingsGet } from "./ipc";
import type { SettingsSnapshot } from "./bindings/SettingsSnapshot";
import type { SettingsPatch } from "./bindings/SettingsPatch";
import type { ProviderEdit } from "./bindings/ProviderEdit";
import type { ProviderPreset } from "./bindings/ProviderPreset";
import type { ProviderStatus } from "./bindings/ProviderStatus";
import type { ProviderReferences } from "./bindings/ProviderReferences";
import type { SettingsFieldError } from "./bindings/SettingsFieldError";
import type { SettingsApplyOutcome } from "./bindings/SettingsApplyOutcome";
import type { NamingEdit } from "./bindings/NamingEdit";
import type { NamingRetarget } from "./bindings/NamingRetarget";
import type { ModelInput } from "./bindings/ModelInput";
import type { WireApi } from "./bindings/WireApi";
import type { FieldEdit } from "./bindings/FieldEdit";
import type { ApiKeyEdit } from "./bindings/ApiKeyEdit";
import type { AutomationPatch } from "./bindings/AutomationPatch";

// ---------------------------------------------------------------------------
// 文案键（全部走文案表；本文件零 CJK 串字面量——文案层门禁扫描 src/**）
// ---------------------------------------------------------------------------

const C = {
  title: "D698",
  subtitle: "D699",
  closeLabel: "D700",
  sectionModel: "D701",
  modelNote: "D702",
  modelSource: "D703",
  providerRail: "D704",
  providerAdd: "D705",
  emptyTitle: "D706",
  emptyBody: "D707",
  emptyAction: "D708",
  statusOk: "D709",
  statusMissingKey: "D710",
  statusMissingModels: "D711",
  statusMissingBaseUrl: "D712",
  statusIgnored: "D713",
  currentBadge: "D714",
  setCurrent: "D715",
  addTitle: "D716",
  addSub: "D717",
  addIdLabel: "D718",
  addIdState: "D719",
  addIdHint: "D720",
  addIdPlaceholder: "D721",
  presetLabel: "D722",
  presetKimi: "D723",
  presetDeepseek: "D724",
  presetGeneric: "D725",
  presetKimiDesc: "D726",
  presetDeepseekDesc: "D727",
  presetGenericDesc: "D728",
  addConfirm: "D729",
  apiKey: "D730",
  keyStateSet: "D731",
  keyStateUnset: "D732",
  keyStatePending: "D733",
  keyPlaceholderSet: "D734",
  keyPlaceholderUnset: "D735",
  keyReplace: "D736",
  keyClear: "D737",
  keyNote: "D738",
  keyNoteGeneric: "D739",
  models: "D740",
  modelAdd: "D741",
  modelId: "D742",
  modelEffort: "D743",
  modelVision: "D744",
  modelWindow: "D745",
  modelsEmpty: "D746",
  modelsHint: "D747",
  modelMissing: "D748",
  modelRowIdAria: "D749",
  modelRowEffortAria: "D750",
  modelRowVisionAria: "D751",
  modelRowWindowAria: "D752",
  modelRowRemoveAria: "D753",
  advanced: "D754",
  readonly: "D755",
  presetHint: "D756",
  baseUrl: "D757",
  baseCustom: "D758",
  baseOfficial: "D759",
  baseMissing: "D760",
  restoreDefault: "D761",
  basePlaceholderGeneric: "D762",
  basePlaceholderOfficial: "D763",
  baseHintGeneric: "D764",
  baseHintOfficial: "D765",
  baseWarnKey: "D766",
  baseWarnPlain: "D767",
  wire: "D768",
  wireHintDeepseek: "D769",
  wireHint: "D770",
  wireRawNote: "D771",
  dangerTitle: "D772",
  dangerDesc: "D773",
  dangerLast: "D774",
  dangerButton: "D775",
  deleteTitle: "D776",
  deleteSub: "D777",
  deleteActiveLead: "D778",
  deleteActiveLabel: "D779",
  deleteLast: "D780",
  deleteSessionLead: "D781",
  deleteAttachmentLead: "D782",
  deleteSessionModelNote: "D783",
  deleteAttachmentModelNote: "D784",
  deleteDraftNote: "D785",
  deleteCancel: "D136",
  deleteConfirm: "D419",
  followActive: "D786",
  sectionAutomation: "D787",
  automationNote: "D788",
  automationBody: "D789",
  autoCompact: "D790",
  autoCompactDesc: "D791",
  autoCompactMeta: "D792",
  sessionNaming: "D793",
  sessionNamingDesc: "D794",
  sessionNamingMeta: "D795",
  attachmentNaming: "D796",
  attachmentNamingDesc: "D797",
  attachmentNamingMeta: "D798",
  subagents: "D799",
  subagentsDesc: "D800",
  subagentsMeta: "D801",
  defaultBadge: "D802",
  restartNote: "D803",
  sendTo: "D804",
  namingProviderAria: "D805",
  namingModelAria: "D806",
  followActiveOption: "D807",
  providerOptionCurrent: "D808",
  providerOptionDangling: "D809",
  effectiveModelOption: "D810",
  effectiveModelOptionPlain: "D811",
  modelOptionDangling: "D812",
  modelOptionSkipped: "D813",
  visionTag: "D814",
  noVisionTag: "D815",
  namingClosed: "D816",
  namingClosedNoTarget: "D817",
  namingNoProviderAttachment: "D819",
  namingNoProviderSession: "D820",
  namingAttachmentEligible: "D821",
  namingAttachmentSkip: "D822",
  namingSessionNoModel: "D823",
  namingLine: "D824",
  namingSessionFallback: "D825",
  provenanceFollow: "D826",
  provenanceExplicit: "D827",
  provenanceDangling: "D828",
  timingSession: "D829",
  timingAttachment: "D830",
  resetPage: "D831",
  statusClean: "D832",
  statusDirty: "D833",
  statusSaving: "D834",
  statusSaved: "D835",
  statusSavedRestart: "D836",
  statusBlocked: "D837",
  statusConflict: "D838",
  statusFileInvalid: "D839",
  statusLoading: "D840",
  save: "D841",
  discardTitle: "D842",
  discardContinue: "D843",
  discardConfirm: "D844",
  conflictTitle: "D845",
  conflictBody: "D846",
  reload: "D847",
  forceSave: "D848",
  fileInvalidTitle: "D849",
  fileInvalidLine: "D850",
  fileInvalidBody: "D851",
  diagnosticsTitle: "D852",
  loadFailed: "D853",
  saveFailed: "D854",
  providerListAria: "D855",
  providerRowAria: "D866",
  presetGroupAria: "D856",
  unknownPreset: "D857",
  providerIgnoredBody: "D858",
  targetNone: "D818",
} satisfies Record<string, CopyKey>;

// ---------------------------------------------------------------------------
// 草稿模型（纯数据；视图只读这里）
// ---------------------------------------------------------------------------

export type NamingKind = "session" | "attachment";
export type AutomationKey = "auto_compact" | "session_naming" | "attachment_naming" | "subagents";

/** 一行模型草稿：`effort` / `vision` / `window` 的 `null` = 文件里未声明（装载期按默认），
 *  渲染时标「未声明」，保存时按默认显式写入（design §9.1 的显式归一化）。 */
export interface DraftModelRow {
  id: string;
  effort: boolean | null;
  vision: boolean | null;
  window: number | null;
  /** 装载期诊断（坏行必须可见，MUST NOT 从编辑面消失）。 */
  notes: readonly string[];
  valid: boolean;
}

export interface DraftKeyEdit {
  kind: "replace" | "clear";
  value: string;
}

export interface DraftFieldEdit<T> {
  kind: "set" | "reset";
  value: T;
}

export interface DraftProvider {
  id: string;
  preset: ProviderPreset | null;
  rawPreset: string;
  /** 装载期被忽略的条目：只读、只能删除（design §6.6）。 */
  ignored: boolean;
  added: boolean;
  removed: boolean;
  status: ProviderStatus;
  configured: boolean;
  references: ProviderReferences;
  /** 生效模型（后端解析；草稿改动后由 `draftEffectiveModel` 现算）。 */
  effectiveModel: string;
  /** Key 的可见状态：完整值永不回传，至多末 4 位。 */
  hasKey: boolean;
  keyHint: string | null;
  keyEdit: DraftKeyEdit | null;
  /** 模型清单草稿（含未声明字段与会被丢弃的坏行）。 */
  models: DraftModelRow[];
  /** `null` = 未编辑（patch 不带 models）；数组 = 整表替换。 */
  modelsEdit: DraftModelRow[] | null;
  baseUrlPresent: boolean;
  baseUrlValue: string;
  baseUrlEffective: string | null;
  baseUrlEdit: DraftFieldEdit<string> | null;
  wirePresent: boolean;
  wireRawText: string | null;
  wireEffective: WireApi;
  wireValue: WireApi;
  wireEdit: DraftFieldEdit<WireApi> | null;
  presetCapability: DraftPresetCapability | null;
}

export interface DraftPresetCapability {
  officialBaseUrl: string | null;
  supportedWires: WireApi[];
  defaultWire: WireApi;
  requiresApiKey: boolean;
}

export interface DraftAddForm {
  id: string;
  preset: ProviderPreset;
  error: string | null;
}

export interface DraftDeleteForm {
  id: string;
  activeAfter: string;
  sessionAfter: string;
  attachmentAfter: string;
}

export interface DraftAutomationFlag {
  value: boolean;
  explicit: boolean;
}

export interface DraftNamingTarget {
  provider: string | null;
  model: string | null;
}

export interface Draft {
  providers: DraftProvider[];
  active: string | null;
  activeTouched: boolean;
  automation: Record<AutomationKey, DraftAutomationFlag>;
  naming: Record<NamingKind, DraftNamingTarget>;
  namingTouched: Record<NamingKind, { provider: boolean; model: boolean }>;
  selection: string | null;
  add: DraftAddForm | null;
  remove: DraftDeleteForm | null;
  /** 页级「还原此页默认」已把全部条目字段标为删键。 */
  pageReset: boolean;
  /** 打开（或上次保存成功）时的快照读数：开关 / 命名目标 / active 的「显式 vs 默认」比较基准。
   *  没有它，一份本来就显式写了开关的配置一打开就是「有未保存的修改」。 */
  baseline: {
    active: string | null;
    automation: Record<AutomationKey, DraftAutomationFlag>;
    naming: Record<NamingKind, DraftNamingTarget>;
  };
}

export const AUTOMATION_KEYS: readonly AutomationKey[] = [
  "auto_compact",
  "session_naming",
  "attachment_naming",
  "subagents",
];

const NAMING_KINDS: readonly NamingKind[] = ["session", "attachment"];

const DEFAULT_PRESET_FOR_ADD: ProviderPreset = "kimi";

function capabilityOf(snapshot: SettingsSnapshot, preset: ProviderPreset | null): DraftPresetCapability | null {
  const cap =
    preset === null ? undefined : snapshot.capabilities.presets.find((item) => item.preset === preset);
  if (cap === undefined) return null;
  return {
    officialBaseUrl: cap.official_base_url,
    supportedWires: [...cap.supported_wire_apis],
    defaultWire: cap.default_wire_api,
    requiresApiKey: cap.requires_api_key,
  };
}

/** 快照 → 草稿（打开面板 / 保存成功 / 重新载入后的唯一入口）。 */
export function createDraft(snapshot: SettingsSnapshot): Draft {
  return {
    providers: snapshot.providers.map((provider) => ({
      id: provider.id,
      preset: provider.preset,
      rawPreset: provider.raw_preset,
      ignored: provider.status === "invalid",
      added: false,
      removed: false,
      status: provider.status,
      configured: provider.configured,
      references: provider.references,
      effectiveModel: provider.model,
      hasKey: provider.api_key.state === "set",
      keyHint: provider.api_key.state === "set" ? provider.api_key.hint : null,
      keyEdit: null,
      models: provider.models.map((model) => ({
        id: model.id,
        effort: model.effort,
        vision: model.vision,
        window: model.window === null ? null : Number(model.window),
        notes: model.diagnostics,
        valid: model.valid,
      })),
      modelsEdit: null,
      baseUrlPresent: provider.base_url.kind === "present",
      baseUrlValue: provider.base_url.kind === "present" ? provider.base_url.value : "",
      baseUrlEffective: provider.effective.base_url,
      baseUrlEdit: null,
      wirePresent: provider.wire_api.kind === "present",
      wireRawText: provider.wire_api.kind === "present" ? provider.wire_api.value.text : null,
      wireEffective: provider.effective.wire_api,
      wireValue: provider.effective.wire_api,
      wireEdit: null,
      presetCapability: capabilityOf(snapshot, provider.preset),
    })),
    active: snapshot.active,
    activeTouched: false,
    automation: {
      auto_compact: { ...snapshot.automation.auto_compact },
      session_naming: { ...snapshot.automation.session_naming },
      attachment_naming: { ...snapshot.automation.attachment_naming },
      subagents: { ...snapshot.automation.subagents },
    },
    naming: {
      session: {
        provider: snapshot.naming.session.override_provider,
        model: snapshot.naming.session.override_model,
      },
      attachment: {
        provider: snapshot.naming.attachment.override_provider,
        model: snapshot.naming.attachment.override_model,
      },
    },
    namingTouched: {
      session: { provider: false, model: false },
      attachment: { provider: false, model: false },
    },
    selection: defaultSelection(snapshot.providers),
    add: null,
    remove: null,
    pageReset: false,
    baseline: {
      active: snapshot.active,
      automation: {
        auto_compact: { ...snapshot.automation.auto_compact },
        session_naming: { ...snapshot.automation.session_naming },
        attachment_naming: { ...snapshot.automation.attachment_naming },
        subagents: { ...snapshot.automation.subagents },
      },
      naming: {
        session: {
          provider: snapshot.naming.session.override_provider,
          model: snapshot.naming.session.override_model,
        },
        attachment: {
          provider: snapshot.naming.attachment.override_provider,
          model: snapshot.naming.attachment.override_model,
        },
      },
    },
  };
}

/** 默认选中项：provider 列表首项（规范顺序由后端给），空清单 = null。 */
export function defaultSelection(providers: readonly { id: string }[]): string | null {
  return providers.length > 0 ? providers[0]!.id : null;
}

export function findProvider(draft: Draft, id: string | null): DraftProvider | null {
  return id === null ? null : (draft.providers.find((provider) => provider.id === id) ?? null);
}

/** 列表可见的 provider：装载期被忽略的条目**保留**（可见、只能删除），已删的不再出现。 */
export function visibleProviders(draft: Draft): DraftProvider[] {
  return draft.providers.filter((provider) => !provider.removed);
}

/** 可替代候选：合法、非 mock、未被装载期忽略、未被本笔删除（与 Rust §4.2 同口径，只用于
 *  删除确认的选项渲染；后端在锁内重新计算）。 */
export function deleteCandidates(draft: Draft, exclude: string): string[] {
  return draft.providers
    .filter((provider) => provider.id !== exclude && !provider.removed && !provider.ignored)
    .map((provider) => provider.id);
}

/** provider 的生效模型（草稿态）：显式 `providers.<id>.model` 优先（不在清单也保留），
 *  否则清单首项，否则空串（design §9.1）。 */
export function draftEffectiveModel(provider: DraftProvider): string {
  const explicit = provider.effectiveModel.trim();
  if (explicit !== "") return explicit;
  return provider.models.map((row) => row.id.trim()).find((id) => id !== "") ?? "";
}

export function draftProviderDirty(provider: DraftProvider): boolean {
  return (
    provider.keyEdit !== null ||
    provider.modelsEdit !== null ||
    provider.baseUrlEdit !== null ||
    provider.wireEdit !== null
  );
}

/** 草稿是否有未保存的修改（保存钮启用 / 关闭两步确认的判据）。 */
export function draftIsDirty(draft: Draft): boolean {
  if (draft.pageReset) return true;
  if (draft.providers.some((provider) => provider.added || provider.removed || draftProviderDirty(provider))) {
    return true;
  }
  if (draft.activeTouched) return true;
  if (AUTOMATION_KEYS.some((key) => automationTouched(draft, key))) return true;
  return NAMING_KINDS.some((kind) => draft.namingTouched[kind].provider || draft.namingTouched[kind].model);
}

/** 与基线比：该开关是否会被写进 patch（显式状态或值任一变化）。 */
export function automationTouched(draft: Draft, key: AutomationKey): boolean {
  const flag = draft.automation[key];
  const base = draft.baseline.automation[key];
  if (flag.explicit !== base.explicit) return true;
  return flag.explicit && flag.value !== base.value;
}

function automationEdit(draft: Draft, key: AutomationKey): FieldEdit<boolean> | undefined {
  if (!automationTouched(draft, key)) return undefined;
  const flag = draft.automation[key];
  return flag.explicit ? { kind: "set", value: flag.value } : { kind: "reset" };
}

function providerUpdate(provider: DraftProvider): ProviderEdit | null {
  // `added` 也允许：`Add` 只带 id + preset（design §6.1），用户在同一份草稿里继续填的
  // Key / 模型 / Base URL 必须作为同一笔 patch 的 `Update` 跟上（后端顺序是先 Add 后 Update），
  // 否则「添加后填完保存」会静默丢掉刚填的内容。
  if (provider.ignored || provider.removed) return null;
  const edit: Extract<ProviderEdit, { action: "update" }> = { action: "update", id: provider.id };
  let touched = false;
  if (provider.keyEdit !== null) {
    edit.api_key =
      provider.keyEdit.kind === "clear"
        ? { kind: "clear" }
        : { kind: "replace", value: provider.keyEdit.value };
    touched = true;
  }
  if (provider.modelsEdit !== null) {
    edit.models = provider.modelsEdit.map((row) => ({
      id: row.id.trim(),
      effort: row.effort === true,
      vision: row.vision === true,
      // ts-rs 把 u64 导出成 bigint，IPC 载荷是 JSON 数字；边界处按数字发送。
      window: Math.trunc(row.window ?? 0) as unknown as bigint,
    })) satisfies ModelInput[];
    touched = true;
  }
  if (provider.baseUrlEdit !== null) {
    edit.base_url =
      provider.baseUrlEdit.kind === "reset"
        ? { kind: "reset" }
        : { kind: "set", value: provider.baseUrlEdit.value.trim() };
    touched = true;
  }
  if (provider.wireEdit !== null) {
    edit.wire_api =
      provider.wireEdit.kind === "reset" ? { kind: "reset" } : { kind: "set", value: provider.wireEdit.value };
    touched = true;
  }
  return touched ? edit : null;
}

function providerDelete(provider: DraftProvider, draft: Draft): ProviderEdit {
  const candidates = deleteCandidates(draft, provider.id);
  const plan = draft.remove?.id === provider.id ? draft.remove : null;
  const edit: Extract<ProviderEdit, { action: "delete" }> = { action: "delete", id: provider.id };
  if (provider.references.active && candidates.length > 0) {
    edit.active_after =
      plan !== null && candidates.includes(plan.activeAfter) ? plan.activeAfter : candidates[0]!;
  }
  if (provider.references.session_naming) {
    edit.session_naming_after = retargetOf(plan?.sessionAfter ?? "follow", candidates);
  }
  if (provider.references.attachment_naming) {
    edit.attachment_naming_after = retargetOf(plan?.attachmentAfter ?? "follow", candidates);
  }
  return edit;
}

function retargetOf(value: string, candidates: readonly string[]): NamingRetarget {
  return value !== "follow" && candidates.includes(value)
    ? { kind: "provider", value }
    : { kind: "follow_active" };
}

/** 草稿 + revision → 一笔强类型 patch（design §6）。`baseRevision` 是 CAS 基准：正常保存用
 *  快照里的 revision；「仍然保存」用冲突返回的新 revision 重新应用同一批意图。 */
export function buildPatch(draft: Draft, snapshot: SettingsSnapshot, baseRevision: string): SettingsPatch {
  const providers: ProviderEdit[] = [];
  for (const provider of draft.providers) {
    if (provider.removed) {
      // 从未落盘的新增项被删掉 = 草稿里的一次撤销，不是文件的 delete（后端会报 not_found）。
      if (!provider.added) providers.push(providerDelete(provider, draft));
      continue;
    }
    if (provider.added) {
      if (provider.preset !== null) {
        providers.push({ action: "add", id: provider.id, preset: provider.preset });
        const edit = providerUpdate(provider);
        if (edit !== null) providers.push(edit);
      }
      continue;
    }
    const update = providerUpdate(provider);
    if (update !== null) providers.push(update);
  }

  const patch: SettingsPatch = {
    base_revision: baseRevision,
    providers,
    automation: buildAutomation(draft, snapshot),
  };

  if (draft.activeTouched || draft.active !== draft.baseline.active) {
    patch.active_provider = draft.active === null ? { kind: "reset" } : { kind: "set", value: draft.active };
  }

  const naming = buildNaming(draft);
  if (naming !== undefined) patch.naming = naming;
  return patch;
}

function buildAutomation(draft: Draft, snapshot: SettingsSnapshot): AutomationPatch {
  void snapshot;
  const patch: AutomationPatch = {};
  for (const key of AUTOMATION_KEYS) {
    const edit = automationEdit(draft, key);
    if (edit !== undefined) patch[key] = edit;
  }
  return patch;
}

function buildNaming(draft: Draft): SettingsPatch["naming"] {
  const session = buildNamingEdit(draft, "session");
  const attachment = buildNamingEdit(draft, "attachment");
  if (session === undefined && attachment === undefined) return undefined;
  return { session, attachment };
}

function buildNamingEdit(draft: Draft, kind: NamingKind): NamingEdit | undefined {
  const touched = draft.namingTouched[kind];
  if (!touched.provider && !touched.model) return undefined;
  const target = draft.naming[kind];
  const base = draft.baseline.naming[kind];
  const edit: NamingEdit = {};
  if (touched.provider) {
    edit.provider = target.provider === null ? { kind: "reset" } : { kind: "set", value: target.provider };
  }
  // 换 provider 时模型覆盖由后端清除（design §6「provider 先、model 后」）；只有草稿里的
  // model 选择**与基线不同**时才带 model 键——「清回默认」只在基线确实有覆盖时才是删键，
  // 否则是一条无消费者的冗余 Reset。
  if (touched.model && target.model !== base.model) {
    edit.model = target.model === null ? { kind: "reset" } : { kind: "set", value: target.model };
  }
  if (edit.provider === undefined && edit.model === undefined) return undefined;
  return edit;
}

// ---------------------------------------------------------------------------
// 草稿操作（纯函数；视图只调用它们，测试直接驱动）
// ---------------------------------------------------------------------------

/** 在草稿里新增一个 provider（添加表单确认后的唯一入口）。第一个 provider 自动成为当前使用
 *  （design §4.4：否则「添加成功但还不能用，得再去找 chip」）。 */
export function addProviderDraft(
  draft: Draft,
  id: string,
  preset: ProviderPreset,
  capability: DraftPresetCapability | null,
): DraftProvider {
  const provider: DraftProvider = {
    id,
    preset,
    rawPreset: preset,
    ignored: false,
    added: true,
    removed: false,
    // 显示用状态：新条目的真实状态由后端在保存后的快照里给（这里只求列表徽标不撒谎）。
    status: preset === "generic" ? "missing_base_url" : "missing_api_key",
    configured: false,
    references: { active: false, session_naming: false, attachment_naming: false },
    effectiveModel: "",
    hasKey: false,
    keyHint: null,
    keyEdit: null,
    models: [],
    modelsEdit: null,
    baseUrlPresent: false,
    baseUrlValue: "",
    baseUrlEffective: null,
    baseUrlEdit: null,
    wirePresent: false,
    wireRawText: null,
    wireEffective: capability?.defaultWire ?? "responses",
    wireValue: capability?.defaultWire ?? "responses",
    wireEdit: null,
    presetCapability: capability,
  };
  draft.providers.push(provider);
  draft.selection = id;
  if (draft.active === null) {
    draft.active = id;
    draft.activeTouched = true;
  }
  return provider;
}

/** 删除确认的确认侧（design §4.3 / §11.5）：只改草稿——标记移除、按计划改写 active 与两个
 *  命名目标、清掉属于旧 provider 的 model 覆盖，并把选中态落到替代项或列表首项。 */
export function applyDraftDelete(draft: Draft): void {
  const plan = draft.remove;
  if (plan === null) return;
  const provider = findProvider(draft, plan.id);
  if (provider === null) {
    draft.remove = null;
    return;
  }
  // 从未落盘的新增项：直接从草稿里摘掉（= 撤销这次添加），既不进 patch 也不算脏。
  if (provider.added) {
    draft.providers = draft.providers.filter((item) => item !== provider);
    draft.remove = null;
    if (draft.selection === provider.id) draft.selection = defaultSelection(visibleProviders(draft));
    return;
  }
  const candidates = deleteCandidates(draft, provider.id);
  const wasActive = draft.active === provider.id;
  // 计划里的替代目标可能已失效（例如打开确认后另一个 provider 也被删了）：回落第一个候选。
  const activeAfter =
    plan.activeAfter !== "" && candidates.includes(plan.activeAfter) ? plan.activeAfter : (candidates[0] ?? "");
  provider.removed = true;
  provider.keyEdit = null;
  provider.modelsEdit = null;
  provider.baseUrlEdit = null;
  provider.wireEdit = null;
  if (wasActive) {
    draft.active = candidates.length > 0 ? activeAfter : null;
    draft.activeTouched = true;
  }
  for (const kind of NAMING_KINDS) {
    if (draft.naming[kind].provider !== provider.id) continue;
    const target = kind === "session" ? plan.sessionAfter : plan.attachmentAfter;
    draft.naming[kind].provider = target === "follow" ? null : target;
    draft.naming[kind].model = null;
    draft.namingTouched[kind].provider = true;
    draft.namingTouched[kind].model = true;
  }
  draft.remove = null;
  if (draft.selection === provider.id) {
    draft.selection = draft.active ?? visibleProviders(draft)[0]?.id ?? null;
  }
}

/** 页级「还原此页默认」（spec「页级还原默认只改草稿」）：把设置面拥有的键全部标为删键；
 *  provider 条目本身保留（id 与预设是身份，不是设置值），还原后的空条目仍可保存。 */
export function pageResetDraft(
  draft: Draft,
  defaults: Record<AutomationKey, boolean>,
): void {
  for (const provider of draft.providers) {
    if (provider.removed || provider.ignored) continue;
    provider.keyEdit = { kind: "clear", value: "" };
    provider.hasKey = false;
    provider.keyHint = null;
    provider.models = [];
    provider.modelsEdit = [];
    provider.baseUrlValue = "";
    provider.baseUrlPresent = false;
    provider.baseUrlEdit = { kind: "reset", value: "" };
    provider.wireValue = provider.wireEffective;
    provider.wirePresent = false;
    provider.wireEdit = { kind: "reset", value: provider.wireEffective };
  }
  draft.active = null;
  draft.activeTouched = true;
  draft.pageReset = true;
  for (const key of AUTOMATION_KEYS) draft.automation[key] = { value: defaults[key], explicit: false };
  for (const kind of NAMING_KINDS) {
    draft.naming[kind] = { provider: null, model: null };
    draft.namingTouched[kind] = { provider: true, model: true };
  }
  draft.add = null;
  draft.remove = null;
}

/** 命名目标的 provider 选择：换目标即清 model 覆盖（它属于旧 provider 的清单，design §6）。 */
export function setNamingProviderDraft(draft: Draft, kind: NamingKind, value: string): void {
  draft.naming[kind].provider = value === "" ? null : value;
  draft.naming[kind].model = null;
  draft.namingTouched[kind].provider = true;
  draft.namingTouched[kind].model = true;
}

/** 命名目标的 model 选择：`""` = 回到「生效模型（默认）」，即删键。 */
export function setNamingModelDraft(draft: Draft, kind: NamingKind, value: string): void {
  draft.naming[kind].model = value === "" ? null : value;
  draft.namingTouched[kind].model = true;
}

// ---------------------------------------------------------------------------
// 命名目标：行内选项与那一行生效说明（design §10.5；纯模型层）
// ---------------------------------------------------------------------------

export interface NamingOptionModel {
  value: string;
  label: string;
}

export interface NamingRowModel {
  providerOptions: NamingOptionModel[];
  modelOptions: NamingOptionModel[];
  providerValue: string;
  modelValue: string;
  /** 唯一一行生效说明：任何分支都同时含「来源」与「生效时机」（design §10.5）。 */
  note: string;
  bad: boolean;
  disabled: boolean;
}

export interface NamingRowInput {
  kind: NamingKind;
  draft: Draft;
  enabled: boolean;
  locked: boolean;
}

/** 一行命名目标的选择器选项 + 唯一一行生效说明。
 *
 *  会话命名的覆盖模型不在清单时是**回落**（写「已回落生效模型」），MUST NOT 写成
 *  「无模型 / 会跳过」；图片命名保留原值、按 vision 资格跳过（design §2.6 / §10.2）。 */
export function namingRowModel(input: NamingRowInput): NamingRowModel {
  const { kind, draft, enabled, locked } = input;
  const target = draft.naming[kind];
  const providers = visibleProviders(draft).filter((provider) => !provider.ignored);
  const providerById = new Map(providers.map((provider) => [provider.id, provider]));
  const danglingProvider = target.provider !== null && !providerById.has(target.provider);
  const follows = target.provider === null || danglingProvider;
  const resolvedId = danglingProvider ? draft.active : (target.provider ?? draft.active);
  const resolved = resolvedId === null ? null : (providerById.get(resolvedId) ?? null);
  const declared = resolved === null ? [] : resolved.models.filter((row) => row.id.trim() !== "");
  const effective = resolved === null ? "" : draftEffectiveModel(resolved);
  const declaredIds = declared.map((row) => row.id.trim());
  const requested = target.model;
  const inList = requested !== null && declaredIds.includes(requested);
  const danglingModel = requested !== null && !inList;
  const modelForSession = requested === null ? effective : inList ? requested : effective;
  const requestedVision = requested === null ? false : declared.find((row) => row.id.trim() === requested)?.vision === true;
  const effectiveVision = declared.find((row) => row.id.trim() === effective)?.vision === true;

  const providerOptions: NamingOptionModel[] = [{ value: "", label: t(C.followActiveOption) }];
  for (const provider of providers) {
    providerOptions.push({
      value: provider.id,
      label: provider.id === draft.active ? t(C.providerOptionCurrent, { id: provider.id }) : provider.id,
    });
  }
  if (danglingProvider && target.provider !== null) {
    providerOptions.push({ value: target.provider, label: t(C.providerOptionDangling, { id: target.provider }) });
  }

  const modelOptions: NamingOptionModel[] = [
    {
      value: "",
      label:
        effective === ""
          ? t(C.effectiveModelOptionPlain)
          : t(C.effectiveModelOption, { model: effective }),
    },
  ];
  for (const row of declared) {
    const id = row.id.trim();
    const suffix =
      kind === "attachment" ? (row.vision === true ? t(C.visionTag) : t(C.noVisionTag)) : "";
    modelOptions.push({ value: id, label: `${id}${suffix}` });
  }
  if (danglingModel && requested !== null) {
    modelOptions.push({
      value: requested,
      label:
        kind === "attachment"
          ? t(C.modelOptionSkipped, { id: requested })
          : t(C.modelOptionDangling, { id: requested }),
    });
  }

  const timing = kind === "session" ? t(C.timingSession) : t(C.timingAttachment);
  const provenance = danglingProvider
    ? t(C.provenanceDangling)
    : follows
      ? t(C.provenanceFollow)
      : t(C.provenanceExplicit);
  const targetText = resolved === null ? "" : `${resolved.id} / ${effective === "" ? t(C.targetNone) : effective}`;

  let note: string;
  let bad = false;
  if (!enabled) {
    note = resolved === null ? t(C.namingClosedNoTarget) : t(C.namingClosed, { target: targetText });
  } else if (resolved === null) {
    bad = true;
    note = kind === "attachment" ? t(C.namingNoProviderAttachment) : t(C.namingNoProviderSession);
  } else if (kind === "attachment") {
    const eligible = requested === null ? effectiveVision : requestedVision;
    const target = `${resolved.id} / ${modelForSession === "" ? t(C.targetNone) : modelForSession}`;
    if (eligible) {
      note = t(C.namingAttachmentEligible, { target, source: provenance, timing });
    } else {
      bad = true;
      note = t(C.namingAttachmentSkip, { target, source: provenance, timing });
    }
  } else if (modelForSession === "") {
    bad = true;
    note = t(C.namingSessionNoModel, {
      target: `${resolved.id} / ${t(C.targetNone)}`,
      source: provenance,
      timing,
    });
  } else {
    note = t(C.namingLine, {
      target: `${resolved.id} / ${modelForSession}`,
      source: provenance,
      timing,
    });
    if (danglingModel) note += t(C.namingSessionFallback, { model: requested ?? "" });
  }

  return {
    providerOptions,
    modelOptions,
    providerValue: target.provider ?? "",
    modelValue: target.model ?? "",
    note,
    bad,
    disabled: locked || !enabled || providers.length === 0,
  };
}

// ---------------------------------------------------------------------------
// 错误回填（design §5.6 / §6.3：按后端返回的 path 分类，不重做校验）
// ---------------------------------------------------------------------------

export interface FieldErrors {
  /** `providers[<n>].id`（新增表单）。 */
  addId: string | null;
  /** `harness.provider`。 */
  active: string | null;
  provider: Record<string, string>;
  apiKey: Record<string, string>;
  baseUrl: Record<string, string>;
  wireApi: Record<string, string>;
  models: Record<string, Record<number, { id?: string; window?: string; other?: string }>>;
  sessionNaming: string | null;
  attachmentNaming: string | null;
  fileLevel: string | null;
  conflict: string | null;
}

export function emptyFieldErrors(): FieldErrors {
  return {
    addId: null,
    active: null,
    provider: {},
    apiKey: {},
    baseUrl: {},
    wireApi: {},
    models: {},
    sessionNaming: null,
    attachmentNaming: null,
    fileLevel: null,
    conflict: null,
  };
}

const MODEL_FIELD = /^harness\.providers\.([^.]+)\.models\[(\d+)\](?:\.(.+))?$/;
const PROVIDER_FIELD = /^harness\.providers\.([^.]+)(?:\.(.+))?$/;
const ADD_PATH = /^providers\[\d+\]\.id$/;

/** 字段级错误按 path 归类：patch 相对路径（新增表单）与配置绝对路径（校验诊断）都要认。 */
export function mapFieldErrors(errors: readonly SettingsFieldError[]): FieldErrors {
  const out = emptyFieldErrors();
  for (const error of errors) {
    const path = error.path;
    if (path === "" || path === "providers" || path === "automation" || path === "naming") {
      out.fileLevel ??= error.message;
      continue;
    }
    if (path === "base_revision") {
      out.conflict ??= error.message;
      continue;
    }
    if (ADD_PATH.test(path)) {
      out.addId ??= error.message;
      continue;
    }
    if (path === "harness.provider" || path === "active_provider") {
      out.active ??= error.message;
      continue;
    }
    if (path.startsWith("harness.session_naming")) {
      out.sessionNaming ??= error.message;
      continue;
    }
    if (path.startsWith("harness.attachment_naming")) {
      out.attachmentNaming ??= error.message;
      continue;
    }
    const model = MODEL_FIELD.exec(path);
    if (model !== null) {
      const id = model[1]!;
      const index = Number(model[2]);
      const field = model[3];
      const rows = (out.models[id] ??= {});
      const row = (rows[index] ??= {});
      if (field === "id") row.id ??= error.message;
      else if (field === "window") row.window ??= error.message;
      else row.other ??= error.message;
      continue;
    }
    const provider = PROVIDER_FIELD.exec(path);
    if (provider !== null) {
      const id = provider[1]!;
      const field = provider[2];
      if (field === undefined) out.provider[id] ??= error.message;
      else if (field === "api_key") out.apiKey[id] ??= error.message;
      else if (field === "base_url") out.baseUrl[id] ??= error.message;
      else if (field === "wire_api") out.wireApi[id] ??= error.message;
      else out.provider[id] ??= error.message;
      continue;
    }
    out.fileLevel ??= error.message;
  }
  return out;
}

export function errorCount(errors: FieldErrors): number {
  let count = 0;
  if (errors.addId !== null) count += 1;
  if (errors.active !== null) count += 1;
  if (errors.fileLevel !== null) count += 1;
  count += Object.keys(errors.provider).length;
  count += Object.keys(errors.apiKey).length;
  count += Object.keys(errors.baseUrl).length;
  count += Object.keys(errors.wireApi).length;
  for (const rows of Object.values(errors.models)) count += Object.keys(rows).length;
  return count;
}

// ---------------------------------------------------------------------------
// 状态机（design §5.4）
// ---------------------------------------------------------------------------

export type PanelMode =
  | "loading"
  | "clean"
  | "dirty"
  | "saving"
  | "saved"
  | "blocked"
  | "conflict"
  | "fileInvalid";

const STATUS_COPY: Record<PanelMode, CopyKey> = {
  loading: C.statusLoading,
  clean: C.statusClean,
  dirty: C.statusDirty,
  saving: C.statusSaving,
  saved: C.statusSaved,
  blocked: C.statusBlocked,
  conflict: C.statusConflict,
  fileInvalid: C.statusFileInvalid,
};

export type StatusTone = "clean" | "dirty" | "saved" | "error" | "warn";

/** 状态行语气：颜色只是辅助，可见文本恒在 `role="status"` 里（spec「保存状态可被辅助技术
 *  读到」）。`saved` 的文案按「图片命名是否被关→开」二选一（design §6.7）。 */
export function statusFor(
  mode: PanelMode,
  attachmentTurnedOn: boolean,
  fieldErrorCount: number,
): { text: string; tone: StatusTone } {
  const key = mode === "saved" && attachmentTurnedOn ? C.statusSavedRestart : STATUS_COPY[mode];
  const tone: StatusTone =
    mode === "saved"
      ? "saved"
      : mode === "blocked" || mode === "fileInvalid"
        ? "error"
        : mode === "conflict"
          ? "warn"
          : mode === "dirty" || mode === "saving"
            ? "dirty"
            : "clean";
  // 需要修正的计数来自后端返回的字段级错误（不另做前端校验）；其余状态不带占位名。
  return { text: mode === "blocked" ? t(key, { count: fieldErrorCount }) : t(key), tone };
}

// ---------------------------------------------------------------------------
// 视图
// ---------------------------------------------------------------------------

export interface SettingsPanelDeps {
  /** 遮罩的挂载点（`document.body`：它必须是 `#app` 的兄弟，才能把 `#app` 整体置为 inert）。 */
  mount: HTMLElement;
  /** 打开期间置 `inert` 的背景根（`#app`）。 */
  inertRoot: HTMLElement;
  /** 关闭后把焦点交还打开前的元素。 */
  restoreFocus(): void;
  /** 面板关闭后的一次取数（chip 重取；不引入全局配置状态层）。 */
  onClosed?(): void;
}

export interface SettingsPanelHandle {
  toggle(): void;
  open(): void;
  close(): void;
  isOpen(): boolean;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className: string, label: string): HTMLButtonElement {
  const node = element("button", className, label);
  node.type = "button";
  return node;
}

function option(label: string, value: string, selected: boolean): HTMLOptionElement {
  const node = element("option", undefined, label);
  node.value = value;
  node.selected = selected;
  return node;
}

export function createSettingsPanel(deps: SettingsPanelDeps): SettingsPanelHandle {
  const overlay = element("div", "lumir-set-overlay");
  overlay.hidden = true;

  const card = element("section", "lumir-set-panel");
  card.tabIndex = -1;
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.id = "lumir-settings-panel";

  const head = element("header", "lumir-set-head");
  const titles = element("div", "lumir-set-titles");
  const title = element("h1", "lumir-set-title");
  title.id = "lumir-set-title";
  card.setAttribute("aria-labelledby", title.id);
  const subtitle = element("p", "lumir-set-sub");
  titles.append(title, subtitle);
  const closeButton = element("button", "lumir-set-close", "×");
  closeButton.type = "button";
  head.append(titles, closeButton);

  const body = element("div", "lumir-set-body");
  const bannerSlot = element("div", "lumir-set-banner-slot");

  const modelSection = element("section", "lumir-set-section");
  const modelHead = element("div", "lumir-set-section-head");
  const modelTitle = element("h2", "lumir-set-section-title");
  const modelNote = element("span", "lumir-set-section-note");
  modelHead.append(modelTitle, modelNote);
  const modelPane = element("div", "lumir-set-pane lumir-set-pane-model");
  const modelSource = element("p", "lumir-set-source");
  const modelDiags = element("div", "lumir-set-diags");
  const providerLayout = element("div", "lumir-set-provider-layout");
  const rail = element("aside", "lumir-set-rail");
  const railHead = element("div", "lumir-set-rail-head");
  const providerList = element("div", "lumir-set-provider-list");
  providerList.setAttribute("role", "group");
  const addButton = button("lumir-set-add", "");
  rail.append(railHead, providerList, addButton);
  const form = element("div", "lumir-set-form");
  form.tabIndex = -1;
  providerLayout.append(rail, form);
  modelPane.append(modelSource, modelDiags, providerLayout);
  modelSection.append(modelHead, modelPane);

  const automationSection = element("section", "lumir-set-section");
  const automationHead = element("div", "lumir-set-section-head");
  const automationTitle = element("h2", "lumir-set-section-title");
  const automationNote = element("span", "lumir-set-section-note");
  automationHead.append(automationTitle, automationNote);
  const automationPane = element("div", "lumir-set-pane lumir-set-pane-automation");
  const automationBody = element("p", "lumir-set-source");
  const automationDiags = element("div", "lumir-set-diags");
  const automationList = element("div", "lumir-set-auto-list");
  automationPane.append(automationBody, automationDiags, automationList);
  automationSection.append(automationHead, automationPane);

  body.append(bannerSlot, modelSection, automationSection);

  const foot = element("footer", "lumir-set-foot");
  const resetPageButton = button("lumir-set-btn lumir-set-btn-ghost", "");
  const statusLine = element("span", "lumir-set-status");
  statusLine.setAttribute("role", "status");
  statusLine.setAttribute("aria-live", "polite");
  const spacer = element("span", "lumir-set-spacer");
  const discardBox = element("div", "lumir-set-discard");
  const discardTitle = element("span", "lumir-set-discard-title");
  const discardContinue = button("lumir-set-btn", "");
  const discardConfirm = button("lumir-set-btn lumir-set-btn-danger", "");
  discardBox.append(discardTitle, discardContinue, discardConfirm);
  const actions = element("div", "lumir-set-actions");
  const cancelButton = button("lumir-set-btn", "");
  const saveButton = button("lumir-set-btn lumir-set-btn-primary", "");
  actions.append(cancelButton, saveButton);
  foot.append(resetPageButton, statusLine, spacer, discardBox, actions);

  card.append(head, body, foot);
  overlay.append(card);
  deps.mount.append(overlay);

  // ── 状态 ────────────────────────────────────────────────────────────────
  interface AutomationRow {
    switchEl: HTMLButtonElement;
    badge: HTMLElement;
    restore: HTMLButtonElement;
    targets: HTMLElement | null;
    note: HTMLElement | null;
    restart: HTMLElement | null;
  }

  let snapshot: SettingsSnapshot | null = null;
  let draft: Draft | null = null;
  let mode: PanelMode = "loading";
  let errors: FieldErrors = emptyFieldErrors();
  let conflictRevision: string | null = null;
  let attachmentTurnedOn = false;
  let advanced = false;
  let discardPending = false;
  let lastError: string | null = null;
  let returnFocus: HTMLElement | null = null;
  const automationRows = new Map<AutomationKey, AutomationRow>();

  function locked(): boolean {
    return mode === "saving" || mode === "fileInvalid" || draft === null;
  }

  function dirty(): boolean {
    return draft !== null && draftIsDirty(draft);
  }

  // ── 文案 ────────────────────────────────────────────────────────────────
  function relabel(): void {
    title.textContent = t(C.title);
    closeButton.setAttribute("aria-label", t(C.closeLabel));
    closeButton.title = t(C.closeLabel);
    modelTitle.textContent = t(C.sectionModel);
    modelNote.textContent = t(C.modelNote);
    automationTitle.textContent = t(C.sectionAutomation);
    automationNote.textContent = t(C.automationNote);
    automationBody.textContent = t(C.automationBody);
    providerList.setAttribute("aria-label", t(C.providerListAria));
    addButton.textContent = t(C.providerAdd);
    resetPageButton.textContent = t(C.resetPage);
    discardTitle.textContent = t(C.discardTitle);
    discardContinue.textContent = t(C.discardContinue);
    discardConfirm.textContent = t(C.discardConfirm);
    cancelButton.textContent = t(C.deleteCancel);
    saveButton.textContent = mode === "saving" ? t(C.statusSaving) : t(C.save);
    subtitle.textContent = snapshot === null ? "" : t(C.subtitle, { path: snapshot.path });
    modelSource.textContent = snapshot === null ? "" : t(C.modelSource, { path: snapshot.path });
    if (!overlay.hidden && draft !== null) render();
  }

  // ── 渲染 ────────────────────────────────────────────────────────────────
  function render(): void {
    if (draft === null || snapshot === null) {
      renderLoading();
      return;
    }
    // 副标题与清单来源取自快照：`relabel()` 在取数之前跑过一次（那时 snapshot 还是 null），
    // 取数落地后必须在这里补一次，否则整个面板会停在没有路径 / 没有来源说明的状态。
    subtitle.textContent = t(C.subtitle, { path: snapshot.path });
    modelSource.textContent = t(C.modelSource, { path: snapshot.path });
    renderBanner();
    renderModelPane();
    renderAutomation();
    renderDiagnostics();
    renderFooter();
  }

  function renderLoading(): void {
    subtitle.textContent = "";
    modelSource.textContent = "";
    railHead.textContent = "";
    providerList.replaceChildren();
    form.replaceChildren(element("p", "lumir-set-hint", t(C.statusLoading)));
    automationList.replaceChildren();
    automationRows.clear();
    renderFooter();
  }

  function renderFooter(): void {
    if (snapshot === null) {
      statusLine.textContent = t(C.statusLoading);
      statusLine.dataset.tone = "clean";
      resetPageButton.disabled = true;
      cancelButton.disabled = true;
      saveButton.disabled = true;
      discardBox.hidden = true;
      actions.hidden = false;
      return;
    }
    const status = statusFor(mode, attachmentTurnedOn, errorCount(errors));
    statusLine.textContent = status.text;
    statusLine.dataset.tone = status.tone;
    resetPageButton.disabled = locked();
    resetPageButton.hidden = mode === "fileInvalid";
    cancelButton.disabled = mode === "saving";
    closeButton.disabled = mode === "saving";
    // 冲突态只走横幅里的两个动作（重新载入 / 仍然保存）；底栏的保存按钮用的是打开时的旧
    // revision，再点只会再冲突一次。
    saveButton.disabled = locked() || !dirty() || mode === "conflict";
    saveButton.textContent = mode === "saving" ? t(C.statusSaving) : t(C.save);
    discardBox.hidden = !discardPending;
    actions.hidden = discardPending;
  }

  function renderBanner(): void {
    bannerSlot.replaceChildren();
    if (snapshot === null) return;
    if (snapshot.file.state === "invalid") {
      const banner = element("div", "lumir-set-banner is-danger");
      banner.dataset.banner = "file";
      banner.append(element("div", "lumir-set-banner-title", t(C.fileInvalidTitle)));
      banner.append(
        element(
          "p",
          "lumir-set-banner-body",
          snapshot.file.line !== null
            ? t(C.fileInvalidLine, { line: snapshot.file.line, message: snapshot.file.message })
            : snapshot.file.message,
        ),
      );
      banner.append(element("p", "lumir-set-banner-body", t(C.fileInvalidBody, { path: snapshot.path })));
      bannerSlot.append(banner);
      return;
    }
    if (mode === "conflict") {
      const banner = element("div", "lumir-set-banner is-warn");
      banner.dataset.banner = "conflict";
      banner.append(element("div", "lumir-set-banner-title", t(C.conflictTitle)));
      banner.append(element("p", "lumir-set-banner-body", t(C.conflictBody)));
      const bannerActions = element("div", "lumir-set-banner-actions");
      const reload = button("lumir-set-btn", t(C.reload));
      reload.addEventListener("click", () => {
        void reloadFromDisk();
      });
      const force = button("lumir-set-btn lumir-set-btn-primary", t(C.forceSave));
      force.addEventListener("click", () => void save(true));
      bannerActions.append(reload, force);
      banner.append(bannerActions);
      bannerSlot.append(banner);
      return;
    }
    if (lastError !== null) {
      const banner = element("div", "lumir-set-banner is-danger");
      banner.append(element("p", "lumir-set-banner-body", lastError));
      bannerSlot.append(banner);
    }
  }

  function renderDiagnostics(): void {
    if (snapshot === null) return;
    const automationScoped = (path: string | null): boolean =>
      path !== null && /^harness\.(session_naming|attachment_naming|auto_compact|subagents)\b/.test(path);
    fillDiagnostics(modelDiags, snapshot.diagnostics.filter((entry) => !automationScoped(entry.path)));
    fillDiagnostics(automationDiags, snapshot.diagnostics.filter((entry) => automationScoped(entry.path)));
  }

  function fillDiagnostics(slot: HTMLElement, entries: SettingsSnapshot["diagnostics"]): void {
    slot.replaceChildren();
    slot.hidden = entries.length === 0;
    if (entries.length === 0) return;
    const callout = element("div", "lumir-set-diag");
    callout.append(element("div", "lumir-set-diag-title", t(C.diagnosticsTitle)));
    const list = element("ul", "lumir-set-diag-list");
    for (const entry of entries) {
      const item = element("li", "lumir-set-diag-item");
      if (entry.path !== null) item.append(element("span", "lumir-set-diag-path", entry.path));
      item.append(document.createTextNode(entry.message));
      list.append(item);
    }
    callout.append(list);
    slot.append(callout);
  }

  // ── provider 列表与表单 ─────────────────────────────────────────────────
  function statusLabel(status: ProviderStatus): string {
    switch (status) {
      case "invalid":
        return t(C.statusIgnored);
      case "missing_api_key":
        return t(C.statusMissingKey);
      case "missing_models":
        return t(C.statusMissingModels);
      case "missing_base_url":
        return t(C.statusMissingBaseUrl);
      default:
        return t(C.statusOk);
    }
  }

  function presetLabel(preset: ProviderPreset | null): string {
    switch (preset) {
      case "kimi":
        return t(C.presetKimi);
      case "deepseek":
        return t(C.presetDeepseek);
      case "generic":
        return t(C.presetGeneric);
      default:
        return t(C.unknownPreset);
    }
  }

  function renderModelPane(): void {
    if (draft === null) return;
    providerList.replaceChildren();
    const providers = visibleProviders(draft);
    railHead.textContent = providers.length === 0 ? t(C.providerRail) : `${t(C.providerRail)} ${providers.length}`;
    addButton.disabled = locked();
    for (const provider of providers) {
      const row = element("button", "lumir-set-provider-row");
      row.type = "button";
      row.dataset.providerId = provider.id;
      row.setAttribute("aria-current", String(draft.selection === provider.id));
      // 可用状态对辅助技术可达（视觉面是状态点 + 表单头徽标；读屏名把 id / 预设 / 状态一次说全）。
      row.setAttribute(
        "aria-label",
        t(C.providerRowAria, {
          id: provider.id,
          preset: presetLabel(provider.preset),
          status: statusLabel(provider.status),
        }),
      );
      // 保存中禁用 provider 切换（design §11.7：避免请求期间的编辑被返回快照覆盖）。
      row.disabled = locked();
      if (draft.selection === provider.id) row.classList.add("is-on");
      const dot = element("span", "lumir-set-dot");
      dot.classList.add(provider.status === "ok" ? "is-ok" : "is-warn");
      dot.setAttribute("aria-hidden", "true");
      row.append(dot, element("span", "lumir-set-pname", provider.id));
      row.append(element("span", "lumir-set-ppreset", `· ${presetLabel(provider.preset)}`));
      if (draft.active === provider.id) row.append(element("span", "lumir-set-current", t(C.currentBadge)));
      row.addEventListener("click", () => selectProvider(provider.id));
      providerList.append(row);
    }
    renderForm();
  }

  function renderForm(): void {
    if (draft === null) return;
    form.replaceChildren();
    if (draft.add !== null) {
      renderAddForm();
      return;
    }
    if (draft.remove !== null) {
      renderDeleteForm();
      return;
    }
    const provider = findProvider(draft, draft.selection);
    if (provider === null) renderEmptyState();
    else renderProviderForm(provider);
  }

  function renderEmptyState(): void {
    const empty = element("div", "lumir-set-empty");
    empty.append(element("h3", "lumir-set-empty-title", t(C.emptyTitle)));
    empty.append(element("p", "lumir-set-empty-body", t(C.emptyBody)));
    const action = button("lumir-set-btn lumir-set-btn-primary", t(C.emptyAction));
    action.disabled = locked();
    action.addEventListener("click", () => openAdd());
    empty.append(action);
    form.append(empty);
  }

  function renderAddForm(): void {
    if (draft === null || draft.add === null || snapshot === null) return;
    const addForm = draft.add;
    const wrap = element("div", "lumir-set-add-card");
    wrap.append(element("div", "lumir-set-form-title", t(C.addTitle)));
    wrap.append(element("p", "lumir-set-hint", t(C.addSub)));

    const idField = element("div", "lumir-set-field");
    const idHead = element("div", "lumir-set-field-head");
    const idLabel = element("label", "lumir-set-label", t(C.addIdLabel));
    idLabel.htmlFor = "lumir-set-add-id";
    idHead.append(idLabel, element("span", "lumir-set-field-state", t(C.addIdState)));
    const idInput = element("input", "lumir-set-input lumir-set-mono");
    idInput.id = "lumir-set-add-id";
    idInput.type = "text";
    idInput.autocomplete = "off";
    idInput.spellcheck = false;
    idInput.placeholder = t(C.addIdPlaceholder);
    idInput.value = addForm.id;
    idInput.readOnly = locked();
    idInput.addEventListener("input", () => {
      if (draft === null || draft.add === null) return;
      draft.add.id = idInput.value;
      draft.add.error = null;
      errors.addId = null;
      idInput.removeAttribute("aria-invalid");
    });
    idField.append(idHead, idInput, element("p", "lumir-set-hint", t(C.addIdHint)));
    const idError = errors.addId ?? addForm.error;
    if (idError !== null) {
      idInput.setAttribute("aria-invalid", "true");
      idInput.setAttribute("aria-errormessage", "lumir-set-add-id-error");
      const node = element("p", "lumir-set-field-error", idError);
      node.id = "lumir-set-add-id-error";
      idField.append(node);
    }
    wrap.append(idField);

    const presetField = element("div", "lumir-set-field");
    presetField.append(element("div", "lumir-set-label", t(C.presetLabel)));
    const row = element("div", "lumir-set-preset-row");
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", t(C.presetGroupAria));
    const addPresets: ProviderPreset[] = ["kimi", "deepseek", "generic"];
    for (const preset of addPresets) {
      const optionEl = element("button", "lumir-set-preset");
      optionEl.type = "button";
      optionEl.dataset.preset = preset;
      optionEl.setAttribute("aria-pressed", String(addForm.preset === preset));
      if (addForm.preset === preset) optionEl.classList.add("is-on");
      optionEl.disabled = locked() || capabilityOf(snapshot, preset) === null;
      optionEl.append(element("span", "lumir-set-preset-name", presetLabel(preset)));
      optionEl.append(
        element(
          "span",
          "lumir-set-preset-desc",
          preset === "kimi" ? t(C.presetKimiDesc) : preset === "deepseek" ? t(C.presetDeepseekDesc) : t(C.presetGenericDesc),
        ),
      );
      optionEl.addEventListener("click", () => {
        if (draft === null || draft.add === null) return;
        draft.add.preset = preset;
        renderForm();
      });
      row.append(optionEl);
    }
    presetField.append(row);
    wrap.append(presetField);

    const actionsRow = element("div", "lumir-set-form-actions");
    const cancel = button("lumir-set-btn", t(C.deleteCancel));
    cancel.disabled = locked();
    cancel.addEventListener("click", () => {
      if (draft === null) return;
      draft.add = null;
      renderForm();
    });
    const confirm = button("lumir-set-btn lumir-set-btn-primary", t(C.addConfirm));
    confirm.disabled = locked();
    confirm.addEventListener("click", () => confirmAdd());
    actionsRow.append(cancel, confirm);
    wrap.append(actionsRow);
    form.append(wrap);
  }

  function confirmAdd(): void {
    if (draft === null || draft.add === null || snapshot === null) return;
    const id = draft.add.id.trim();
    const preset = draft.add.preset;
    draft.add = null;
    addProviderDraft(draft, id, preset, capabilityOf(snapshot, preset));
    markDirty();
    render();
    focusAfterRender(`.lumir-set-provider-row[data-provider-id="${id}"]`);
  }

  function renderProviderForm(provider: DraftProvider): void {
    if (snapshot === null) return;
    const wrap = element("div", "lumir-set-provider-form");

    const headRow = element("div", "lumir-set-provider-head");
    headRow.append(element("span", "lumir-set-provider-title", provider.id));
    headRow.append(element("span", "lumir-set-provider-sub", presetLabel(provider.preset)));
    const status = element("span", "lumir-set-provider-status");
    status.dataset.tone = provider.status === "ok" ? "ok" : "warn";
    status.textContent = statusLabel(provider.status);
    headRow.append(status);
    if (draft?.active === provider.id) {
      headRow.append(element("span", "lumir-set-current", t(C.currentBadge)));
    } else if (!provider.ignored) {
      const setCurrent = button("lumir-set-btn lumir-set-btn-ghost", t(C.setCurrent));
      setCurrent.disabled = locked();
      setCurrent.addEventListener("click", () => {
        if (draft === null) return;
        draft.active = provider.id;
        draft.activeTouched = true;
        markDirty();
        render();
      });
      headRow.append(setCurrent);
    }
    wrap.append(headRow);

    if (provider.ignored) {
      const note = element("div", "lumir-set-ignore-note");
      note.append(element("p", "lumir-set-hint", t(C.providerIgnoredBody)));
      const reason = errors.provider[provider.id];
      if (reason !== undefined) note.append(element("p", "lumir-set-field-error", reason));
      // 装载期诊断挂在这一条上（键路径 + 原因，spec「provider 条目诊断挂在条目上」）：
      // 只取 `harness.providers.<id>` 及其后代的诊断，其它条目的问题不串到这一行。
      const prefix = `harness.providers.${provider.id}`;
      const scoped =
        snapshot === null
          ? []
          : snapshot.diagnostics.filter(
              (entry) => entry.path !== null && (entry.path === prefix || entry.path.startsWith(`${prefix}.`)),
            );
      for (const entry of scoped) {
        const line = element("p", "lumir-set-hint");
        line.append(element("span", "lumir-set-diag-path", entry.path ?? ""));
        line.append(document.createTextNode(entry.message));
        note.append(line);
      }
      wrap.append(note);
      wrap.append(renderDangerZone(provider));
      form.append(wrap);
      return;
    }

    wrap.append(renderKeyField(provider));
    wrap.append(renderModelsField(provider));
    wrap.append(renderAdvanced(provider));
    wrap.append(renderDangerZone(provider));
    form.append(wrap);
  }

  function renderKeyField(provider: DraftProvider): HTMLElement {
    const field = element("div", "lumir-set-field");
    const head = element("div", "lumir-set-field-head");
    const label = element("label", "lumir-set-label", t(C.apiKey));
    label.htmlFor = "lumir-set-api-key";
    head.append(label);
    const pending = provider.keyEdit?.kind === "replace";
    head.append(
      element(
        "span",
        "lumir-set-field-state",
        pending ? t(C.keyStatePending) : provider.hasKey ? t(C.keyStateSet) : t(C.keyStateUnset),
      ),
    );
    const row = element("div", "lumir-set-key-row");
    const input = element("input", "lumir-set-input");
    input.id = "lumir-set-api-key";
    input.type = "password";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.value = provider.keyEdit?.kind === "replace" ? provider.keyEdit.value : "";
    input.placeholder = provider.hasKey
      ? t(C.keyPlaceholderSet, { hint: provider.keyHint ?? "…" })
      : t(C.keyPlaceholderUnset);
    input.readOnly = locked();
    input.addEventListener("input", () => {
      provider.keyEdit = input.value === "" ? null : { kind: "replace", value: input.value };
      markDirty();
      renderFooter();
    });
    input.addEventListener("change", () => render());
    const replace = button("lumir-set-btn lumir-set-btn-ghost", t(C.keyReplace));
    replace.disabled = locked();
    replace.addEventListener("click", () => {
      input.focus();
      input.select();
    });
    const clear = button("lumir-set-btn lumir-set-btn-ghost", t(C.keyClear));
    clear.disabled = locked() || (!provider.hasKey && provider.keyEdit === null);
    clear.addEventListener("click", () => {
      provider.keyEdit = { kind: "clear", value: "" };
      markDirty();
      render();
    });
    row.append(input, replace, clear);
    field.append(head, row);
    field.append(element("p", "lumir-set-hint", provider.preset === "generic" ? t(C.keyNoteGeneric) : t(C.keyNote)));
    const keyError = errors.apiKey[provider.id];
    if (keyError !== undefined) {
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-errormessage", `lumir-set-key-error-${provider.id}`);
      const node = element("p", "lumir-set-field-error", keyError);
      node.id = `lumir-set-key-error-${provider.id}`;
      field.append(node);
    }
    return field;
  }

  function renderModelsField(provider: DraftProvider): HTMLElement {
    const field = element("div", "lumir-set-field lumir-set-models-field");
    const head = element("div", "lumir-set-models-head");
    head.append(element("span", "lumir-set-label", t(C.models)));
    const addModelButton = button("lumir-set-btn lumir-set-btn-ghost", t(C.modelAdd));
    addModelButton.disabled = locked();
    addModelButton.addEventListener("click", () => addModelRow(provider));
    head.append(addModelButton);
    field.append(head, renderModelTable(provider));
    field.append(
      element(
        "p",
        "lumir-set-hint",
        snapshot === null
          ? ""
          : t(C.modelsHint, {
              min: Number(snapshot.capabilities.model_window_min),
              max: Number(snapshot.capabilities.model_window_max).toLocaleString("en-US"),
            }),
      ),
    );
    const providerError = errors.provider[provider.id];
    if (providerError !== undefined) field.append(element("p", "lumir-set-field-error", providerError));
    return field;
  }

  function renderModelTable(provider: DraftProvider): HTMLElement {
    const table = element("div", "lumir-set-model-table");
    const headRow = element("div", "lumir-set-model-head");
    headRow.setAttribute("aria-hidden", "true");
    for (const label of [t(C.modelId), t(C.modelEffort), t(C.modelVision), t(C.modelWindow), ""]) {
      headRow.append(element("span", "lumir-set-model-head-cell", label));
    }
    table.append(headRow);
    if (provider.models.length === 0) {
      table.append(element("p", "lumir-set-models-empty", t(C.modelsEmpty)));
      return table;
    }
    provider.models.forEach((rowModel, index) => {
      const row = element("div", "lumir-set-model-row");
      row.dataset.modelIndex = String(index);
      const idInput = element("input", "lumir-set-mi lumir-set-mono");
      idInput.type = "text";
      idInput.value = rowModel.id;
      idInput.placeholder = t(C.modelId);
      idInput.setAttribute("aria-label", t(C.modelRowIdAria, { n: index + 1 }));
      idInput.readOnly = locked();
      idInput.addEventListener("input", () => {
        rowModel.id = idInput.value;
        markModelsEdited(provider);
        markDirty();
        renderFooter();
      });
      const effort = element("input", "lumir-set-cb");
      effort.type = "checkbox";
      effort.checked = rowModel.effort === true;
      effort.setAttribute("aria-label", t(C.modelRowEffortAria, { n: index + 1 }));
      effort.disabled = locked();
      effort.addEventListener("change", () => {
        rowModel.effort = effort.checked;
        markModelsEdited(provider);
        markDirty();
      });
      const vision = element("input", "lumir-set-cb");
      vision.type = "checkbox";
      vision.checked = rowModel.vision === true;
      vision.setAttribute("aria-label", t(C.modelRowVisionAria, { n: index + 1 }));
      vision.disabled = locked();
      vision.addEventListener("change", () => {
        rowModel.vision = vision.checked;
        markModelsEdited(provider);
        markDirty();
      });
      const windowInput = element("input", "lumir-set-mi lumir-set-win");
      windowInput.type = "number";
      windowInput.step = "1";
      if (snapshot !== null) {
        windowInput.min = String(Number(snapshot.capabilities.model_window_min));
        windowInput.max = String(Number(snapshot.capabilities.model_window_max));
      }
      windowInput.value = rowModel.window === null ? "" : String(rowModel.window);
      windowInput.placeholder = "131072";
      windowInput.setAttribute("aria-label", t(C.modelRowWindowAria, { n: index + 1 }));
      windowInput.readOnly = locked();
      windowInput.addEventListener("input", () => {
        rowModel.window = windowInput.value === "" ? null : Number(windowInput.value);
        markModelsEdited(provider);
        markDirty();
        renderFooter();
      });
      const remove = element("button", "lumir-set-icon-btn lumir-set-row-del", "×");
      remove.type = "button";
      remove.setAttribute("aria-label", t(C.modelRowRemoveAria, { n: index + 1 }));
      remove.disabled = locked();
      remove.addEventListener("click", () => {
        provider.models.splice(index, 1);
        markModelsEdited(provider);
        markDirty();
        render();
      });
      row.append(idInput, effort, vision, windowInput, remove);
      const missing = (["effort", "vision", "window"] as const)
        .filter((fieldName) => rowModel[fieldName] === null)
        .map((fieldName) =>
          t(fieldName === "effort" ? C.modelEffort : fieldName === "vision" ? C.modelVision : C.modelWindow),
        );
      if (missing.length > 0) row.append(element("p", "lumir-set-row-note", t(C.modelMissing, { fields: missing.join(" / ") })));
      for (const note of rowModel.notes) row.append(element("p", "lumir-set-row-note", note));
      const rowError = errors.models[provider.id]?.[index];
      if (rowError?.id !== undefined) {
        idInput.setAttribute("aria-invalid", "true");
        idInput.setAttribute("aria-errormessage", `lumir-set-model-${provider.id}-${index}-id`);
        const node = element("p", "lumir-set-field-error lumir-set-row-error", rowError.id);
        node.id = `lumir-set-model-${provider.id}-${index}-id`;
        row.append(node);
      }
      if (rowError?.window !== undefined) {
        windowInput.setAttribute("aria-invalid", "true");
        windowInput.setAttribute("aria-errormessage", `lumir-set-model-${provider.id}-${index}-win`);
        const node = element("p", "lumir-set-field-error lumir-set-row-error", rowError.window);
        node.id = `lumir-set-model-${provider.id}-${index}-win`;
        row.append(node);
      }
      if (rowError?.other !== undefined) {
        row.append(element("p", "lumir-set-field-error lumir-set-row-error", rowError.other));
      }
      table.append(row);
    });
    return table;
  }

  function markModelsEdited(provider: DraftProvider): void {
    provider.modelsEdit = provider.models.map((row) => ({ ...row }));
  }

  function addModelRow(provider: DraftProvider): void {
    const fallback = snapshot === null ? 131072 : Number(snapshot.defaults.model_window);
    provider.models.push({ id: "", effort: false, vision: false, window: fallback, notes: [], valid: true });
    markModelsEdited(provider);
    markDirty();
    render();
    const rows = form.querySelectorAll<HTMLInputElement>(".lumir-set-model-row input[type=text]");
    rows[rows.length - 1]?.focus();
  }

  function isCustomBase(provider: DraftProvider): boolean {
    const value = provider.baseUrlValue.trim().replace(/\/+$/, "");
    if (value === "") return false;
    const official = (provider.presetCapability?.officialBaseUrl ?? "").trim().replace(/\/+$/, "");
    return official === "" || value !== official;
  }

  function renderAdvanced(provider: DraftProvider): HTMLElement {
    const wrap = element("div", "lumir-set-advanced");
    const toggle = button("lumir-set-adv-toggle", t(C.advanced));
    toggle.disabled = locked();
    toggle.setAttribute("aria-expanded", String(advanced));
    toggle.setAttribute("aria-controls", "lumir-set-advanced-body");
    toggle.addEventListener("click", () => {
      advanced = !advanced;
      renderForm();
    });
    wrap.append(toggle);
    if (!advanced) return wrap;

    const bodyEl = element("div", "lumir-set-adv-body");
    bodyEl.id = "lumir-set-advanced-body";

    const presetField = element("div", "lumir-set-field");
    const presetHead = element("div", "lumir-set-field-head");
    presetHead.append(element("span", "lumir-set-label", t(C.presetLabel)));
    presetHead.append(element("span", "lumir-set-field-state", t(C.readonly)));
    const presetInput = element("input", "lumir-set-input lumir-set-mono");
    presetInput.type = "text";
    presetInput.readOnly = true;
    presetInput.value = `${provider.preset ?? provider.rawPreset} (${presetLabel(provider.preset)})`;
    presetInput.setAttribute("aria-label", t(C.presetLabel));
    presetField.append(presetHead, presetInput, element("p", "lumir-set-hint", t(C.presetHint)));
    bodyEl.append(presetField);

    const baseField = element("div", "lumir-set-field");
    const baseHead = element("div", "lumir-set-field-head");
    const baseLabel = element("label", "lumir-set-label", t(C.baseUrl));
    baseLabel.htmlFor = "lumir-set-base-url";
    baseHead.append(baseLabel);
    const baseRight = element("span", "lumir-set-field-head-right");
    const custom = isCustomBase(provider);
    baseRight.append(
      element(
        "span",
        "lumir-set-field-state",
        custom ? t(C.baseCustom) : provider.preset === "generic" ? t(C.baseMissing) : t(C.baseOfficial),
      ),
    );
    const baseReset = button("lumir-set-btn-link", t(C.restoreDefault));
    baseReset.hidden = !provider.baseUrlPresent && provider.baseUrlEdit === null;
    baseReset.disabled = locked();
    baseReset.addEventListener("click", () => {
      provider.baseUrlEdit = { kind: "reset", value: "" };
      provider.baseUrlValue = "";
      provider.baseUrlPresent = false;
      markDirty();
      render();
    });
    baseRight.append(baseReset);
    baseHead.append(baseRight);
    const baseInput = element("input", "lumir-set-input lumir-set-mono");
    baseInput.id = "lumir-set-base-url";
    baseInput.type = "text";
    baseInput.value = provider.baseUrlValue;
    baseInput.placeholder =
      provider.preset === "generic"
        ? t(C.basePlaceholderGeneric)
        : t(C.basePlaceholderOfficial, { url: provider.presetCapability?.officialBaseUrl ?? "" });
    baseInput.readOnly = locked();
    baseInput.addEventListener("input", () => {
      provider.baseUrlValue = baseInput.value;
      provider.baseUrlEdit = { kind: "set", value: baseInput.value };
      markDirty();
      renderFooter();
    });
    baseInput.addEventListener("change", () => render());
    baseField.append(baseHead, baseInput);
    baseField.append(
      element(
        "p",
        "lumir-set-hint",
        provider.preset === "generic"
          ? t(C.baseHintGeneric)
          : t(C.baseHintOfficial, { url: provider.presetCapability?.officialBaseUrl ?? "" }),
      ),
    );
    if (custom) {
      baseField.append(
        element(
          "p",
          "lumir-set-inline-warning",
          provider.hasKey || provider.keyEdit !== null ? t(C.baseWarnKey) : t(C.baseWarnPlain),
        ),
      );
    }
    const baseError = errors.baseUrl[provider.id];
    if (baseError !== undefined) {
      baseInput.setAttribute("aria-invalid", "true");
      baseInput.setAttribute("aria-errormessage", `lumir-set-base-error-${provider.id}`);
      const node = element("p", "lumir-set-field-error", baseError);
      node.id = `lumir-set-base-error-${provider.id}`;
      baseField.append(node);
    }
    bodyEl.append(baseField);

    const wireField = element("div", "lumir-set-field");
    const wireHead = element("div", "lumir-set-field-head");
    const wireLabel = element("label", "lumir-set-label", t(C.wire));
    wireLabel.htmlFor = "lumir-set-wire";
    wireHead.append(wireLabel);
    const wireReset = button("lumir-set-btn-link", t(C.restoreDefault));
    wireReset.hidden = !provider.wirePresent && provider.wireEdit === null;
    wireReset.disabled = locked();
    wireReset.addEventListener("click", () => {
      provider.wireEdit = { kind: "reset", value: provider.wireEffective };
      provider.wireValue = provider.wireEffective;
      provider.wirePresent = false;
      markDirty();
      render();
    });
    wireHead.append(wireReset);
    const wireSelect = element("select", "lumir-set-select");
    wireSelect.id = "lumir-set-wire";
    wireSelect.disabled = locked();
    for (const wire of ["responses", "chat_completions"] as const) {
      const node = option(wire, wire, provider.wireValue === wire);
      node.disabled = !(provider.presetCapability?.supportedWires.includes(wire) ?? false);
      wireSelect.append(node);
    }
    wireSelect.addEventListener("change", () => {
      const value = wireSelect.value as WireApi;
      provider.wireValue = value;
      provider.wireEdit = { kind: "set", value };
      markDirty();
      render();
    });
    wireField.append(wireHead, wireSelect);
    wireField.append(
      element(
        "p",
        "lumir-set-hint",
        provider.preset === "deepseek"
          ? t(C.wireHintDeepseek)
          : t(C.wireHint, {
              wire: provider.presetCapability?.defaultWire ?? "responses",
              base: provider.presetCapability?.officialBaseUrl ?? "…",
            }),
      ),
    );
    if (provider.wireRawText !== null && provider.wireRawText !== provider.wireEffective) {
      wireField.append(
        element(
          "p",
          "lumir-set-inline-warning",
          t(C.wireRawNote, { raw: provider.wireRawText, effective: provider.wireEffective }),
        ),
      );
    }
    const wireError = errors.wireApi[provider.id];
    if (wireError !== undefined) {
      wireSelect.setAttribute("aria-invalid", "true");
      wireSelect.setAttribute("aria-errormessage", `lumir-set-wire-error-${provider.id}`);
      const node = element("p", "lumir-set-field-error", wireError);
      node.id = `lumir-set-wire-error-${provider.id}`;
      wireField.append(node);
    }
    bodyEl.append(wireField);
    wrap.append(bodyEl);
    return wrap;
  }

  function renderDangerZone(provider: DraftProvider): HTMLElement {
    const zone = element("div", "lumir-set-danger");
    const copy = element("div", "lumir-set-danger-copy");
    copy.append(element("div", "lumir-set-danger-title", t(C.dangerTitle)));
    const others = draft === null ? [] : deleteCandidates(draft, provider.id);
    copy.append(element("div", "lumir-set-danger-desc", others.length === 0 ? t(C.dangerLast) : t(C.dangerDesc)));
    const remove = button("lumir-set-btn lumir-set-btn-danger", t(C.dangerButton));
    remove.disabled = locked();
    remove.addEventListener("click", () => openDelete(provider.id));
    zone.append(copy, remove);
    return zone;
  }

  function renderDeleteForm(): void {
    if (draft === null || draft.remove === null) return;
    const plan = draft.remove;
    const provider = findProvider(draft, plan.id);
    if (provider === null) {
      draft.remove = null;
      renderForm();
      return;
    }
    const candidates = deleteCandidates(draft, provider.id);
    const wrap = element("div", "lumir-set-delete-card");
    wrap.append(element("div", "lumir-set-form-title", t(C.deleteTitle, { id: provider.id })));
    wrap.append(element("p", "lumir-set-hint", t(C.deleteSub)));

    if (provider.references.active) {
      const block = element("div", "lumir-set-delete-block");
      block.dataset.deleteBlock = "active";
      if (candidates.length > 0) {
        block.append(element("strong", undefined, t(C.deleteActiveLead)));
        const row = element("div", "lumir-set-delete-row");
        row.append(element("label", "lumir-set-label", t(C.deleteActiveLabel)));
        const select = element("select", "lumir-set-select");
        select.disabled = locked();
        for (const id of candidates) select.append(option(id, id, plan.activeAfter === id));
        select.addEventListener("change", () => {
          plan.activeAfter = select.value;
        });
        row.append(select);
        block.append(row);
      } else {
        block.append(element("strong", undefined, t(C.deleteLast)));
      }
      wrap.append(block);
    }
    for (const kind of NAMING_KINDS) {
      const referenced =
        kind === "session" ? provider.references.session_naming : provider.references.attachment_naming;
      if (!referenced) continue;
      const block = element("div", "lumir-set-delete-block");
      block.dataset.deleteBlock = kind;
      block.append(element("strong", undefined, kind === "session" ? t(C.deleteSessionLead) : t(C.deleteAttachmentLead)));
      const row = element("div", "lumir-set-delete-row");
      row.append(element("label", "lumir-set-label", kind === "session" ? t(C.sessionNaming) : t(C.attachmentNaming)));
      const select = element("select", "lumir-set-select");
      select.disabled = locked();
      const current = kind === "session" ? plan.sessionAfter : plan.attachmentAfter;
      select.append(option(t(C.followActive), "follow", current === "follow"));
      for (const id of candidates) select.append(option(id, id, current === id));
      select.addEventListener("change", () => {
        if (kind === "session") plan.sessionAfter = select.value;
        else plan.attachmentAfter = select.value;
      });
      row.append(select);
      block.append(row);
      block.append(
        element(
          "p",
          "lumir-set-delete-note",
          kind === "session" ? t(C.deleteSessionModelNote) : t(C.deleteAttachmentModelNote),
        ),
      );
      wrap.append(block);
    }
    if (draftProviderDirty(provider)) {
      const block = element("div", "lumir-set-delete-block");
      block.dataset.deleteBlock = "draft";
      block.append(element("strong", undefined, t(C.deleteDraftNote)));
      wrap.append(block);
    }

    const actionsRow = element("div", "lumir-set-form-actions");
    const cancel = button("lumir-set-btn", t(C.deleteCancel));
    cancel.disabled = locked();
    cancel.addEventListener("click", () => {
      if (draft === null) return;
      draft.remove = null;
      renderForm();
    });
    const confirm = button("lumir-set-btn lumir-set-btn-danger", t(C.deleteConfirm));
    confirm.disabled = locked();
    confirm.addEventListener("click", () => confirmDelete());
    actionsRow.append(cancel, confirm);
    wrap.append(actionsRow);
    form.append(wrap);
  }

  function openDelete(id: string): void {
    if (draft === null) return;
    const provider = findProvider(draft, id);
    if (provider === null) return;
    const candidates = deleteCandidates(draft, id);
    draft.remove = {
      id,
      activeAfter: candidates[0] ?? "",
      sessionAfter: "follow",
      attachmentAfter: "follow",
    };
    draft.add = null;
    draft.selection = id;
    render();
  }

  function confirmDelete(): void {
    if (draft === null) return;
    applyDraftDelete(draft);
    markDirty();
    render();
    focusAfterRender('.lumir-set-provider-row[aria-current="true"]');
  }

  // ── 自动化 ──────────────────────────────────────────────────────────────
  function automationCopy(key: AutomationKey): { title: string; desc: string; meta: string } {
    switch (key) {
      case "auto_compact":
        return { title: t(C.autoCompact), desc: t(C.autoCompactDesc), meta: t(C.autoCompactMeta) };
      case "session_naming":
        return { title: t(C.sessionNaming), desc: t(C.sessionNamingDesc), meta: t(C.sessionNamingMeta) };
      case "attachment_naming":
        return { title: t(C.attachmentNaming), desc: t(C.attachmentNamingDesc), meta: t(C.attachmentNamingMeta) };
      default:
        return { title: t(C.subagents), desc: t(C.subagentsDesc), meta: t(C.subagentsMeta) };
    }
  }

  function namingKindOf(key: AutomationKey): NamingKind | null {
    if (key === "session_naming") return "session";
    if (key === "attachment_naming") return "attachment";
    return null;
  }

  function renderAutomation(): void {
    if (draft === null) return;
    // 开关行只在首次建；provider 增删 / 切换只刷新命名行的选项与说明（design §11.6：
    // MUST NOT 重渲染开关行——DOM 与开关值不变）。
    if (automationRows.size !== AUTOMATION_KEYS.length) buildAutomationRows();
    for (const key of AUTOMATION_KEYS) {
      const row = automationRows.get(key);
      if (row === undefined) continue;
      const flag = draft.automation[key];
      row.switchEl.setAttribute("aria-checked", String(flag.value));
      row.switchEl.classList.toggle("is-on", flag.value);
      row.switchEl.disabled = locked();
      row.badge.hidden = flag.explicit;
      row.restore.hidden = !flag.explicit;
      row.restore.disabled = locked();
      if (row.restart !== null) row.restart.hidden = !(key === "attachment_naming" && attachmentTurnedOn);
      const kind = namingKindOf(key);
      if (kind !== null && row.targets !== null && row.note !== null) {
        renderNamingRow(kind, row.targets, row.note);
      }
    }
  }

  function buildAutomationRows(): void {
    if (draft === null) return;
    automationList.replaceChildren();
    automationRows.clear();
    for (const key of AUTOMATION_KEYS) {
      const copy = automationCopy(key);
      const root = element("div", "lumir-set-auto-row");
      root.dataset.autoRow = key;
      const copyCol = element("div", "lumir-set-auto-copy");
      const titleRow = element("div", "lumir-set-auto-title");
      titleRow.append(document.createTextNode(copy.title));
      const badge = element("span", "lumir-set-badge", t(C.defaultBadge));
      titleRow.append(badge);
      copyCol.append(
        titleRow,
        element("p", "lumir-set-auto-desc", copy.desc),
        element("p", "lumir-set-auto-meta", copy.meta),
      );
      let restart: HTMLElement | null = null;
      if (key === "attachment_naming") {
        restart = element("p", "lumir-set-auto-restart", t(C.restartNote));
        restart.hidden = true;
        copyCol.append(restart);
      }
      let targets: HTMLElement | null = null;
      let note: HTMLElement | null = null;
      if (namingKindOf(key) !== null) {
        const line = element("div", "lumir-set-auto-target");
        line.append(element("span", "lumir-set-target-label", t(C.sendTo)));
        targets = element("div", "lumir-set-target-slots");
        line.append(targets);
        copyCol.append(line);
        note = element("p", "lumir-set-auto-effective");
        copyCol.append(note);
      }
      const actionsCol = element("div", "lumir-set-auto-actions");
      const restore = button("lumir-set-btn-link", t(C.restoreDefault));
      restore.addEventListener("click", () => {
        if (draft === null) return;
        draft.automation[key] = { value: defaultFlagValue(key), explicit: false };
        markDirty();
        render();
      });
      actionsCol.append(restore);
      const switchEl = element("button", "lumir-set-switch");
      switchEl.type = "button";
      switchEl.setAttribute("role", "switch");
      switchEl.setAttribute("aria-label", copy.title);
      switchEl.append(element("span", "lumir-set-knob"));
      switchEl.addEventListener("click", () => {
        if (draft === null || locked()) return;
        const flag = draft.automation[key];
        flag.value = !flag.value;
        flag.explicit = true;
        markDirty();
        render();
      });
      actionsCol.append(switchEl);
      root.append(copyCol, actionsCol);
      automationList.append(root);
      automationRows.set(key, { switchEl, badge, restore, targets, note, restart });
    }
  }

  function defaultFlagValue(key: AutomationKey): boolean {
    if (snapshot === null) return true;
    return snapshot.defaults[FLAG_KEYS[key]];
  }

  function renderNamingRow(kind: NamingKind, targets: HTMLElement, note: HTMLElement): void {
    if (draft === null) return;
    const enabled = draft.automation[kind === "session" ? "session_naming" : "attachment_naming"].value;
    const model = namingRowModel({ kind, draft, enabled, locked: locked() });
    targets.replaceChildren();
    const label = kind === "session" ? t(C.sessionNaming) : t(C.attachmentNaming);
    const providerSelect = element("select", "lumir-set-naming-select");
    providerSelect.setAttribute("aria-label", t(C.namingProviderAria, { label }));
    providerSelect.disabled = model.disabled;
    for (const item of model.providerOptions) {
      providerSelect.append(option(item.label, item.value, model.providerValue === item.value));
    }
    providerSelect.addEventListener("change", () => setNamingProvider(kind, providerSelect.value));
    const modelSelect = element("select", "lumir-set-naming-select");
    modelSelect.setAttribute("aria-label", t(C.namingModelAria, { label }));
    modelSelect.disabled = model.disabled;
    for (const item of model.modelOptions) {
      modelSelect.append(option(item.label, item.value, model.modelValue === item.value));
    }
    modelSelect.addEventListener("change", () => setNamingModel(kind, modelSelect.value));
    targets.append(providerSelect, modelSelect);
    note.textContent = model.note;
    note.classList.toggle("is-bad", model.bad);
  }

  function setNamingProvider(kind: NamingKind, value: string): void {
    if (draft === null || locked()) return;
    setNamingProviderDraft(draft, kind, value);
    markDirty();
    renderAutomation();
    renderFooter();
  }

  function setNamingModel(kind: NamingKind, value: string): void {
    if (draft === null || locked()) return;
    setNamingModelDraft(draft, kind, value);
    markDirty();
    renderAutomation();
    renderFooter();
  }

  // ── 交互 ────────────────────────────────────────────────────────────────
  function selectProvider(id: string): void {
    if (draft === null || locked()) return;
    draft.selection = id;
    draft.add = null;
    draft.remove = null;
    renderModelPane();
  }

  function openAdd(): void {
    if (draft === null || locked()) return;
    draft.add = { id: "", preset: DEFAULT_PRESET_FOR_ADD, error: null };
    draft.remove = null;
    renderModelPane();
    focusAfterRender("#lumir-set-add-id");
  }

  /** 任何把草稿改脏的操作都经过这里：切状态、清旧错误、**刷新底栏**。底栏必须随每次编辑重算
   *  （保存钮的可用性 = 有脏改动），否则「改了但保存钮还是灰的」——勾一个复选框不触发整页
   *  重绘，漏掉这一次刷新就是死按钮（本 mission 的场景实测踩到）。 */
  function markDirty(): void {
    if (draft === null) return;
    if (mode !== "saving") mode = "dirty";
    errors = emptyFieldErrors();
    lastError = null;
    renderFooter();
  }

  function resetDraftFrom(next: SettingsSnapshot): void {
    const selection = draft?.selection ?? null;
    snapshot = next;
    draft = createDraft(next);
    draft.selection = findProvider(draft, selection)?.id ?? defaultSelection(next.providers);
    mode = next.file.state === "invalid" ? "fileInvalid" : "clean";
    errors = emptyFieldErrors();
    lastError = null;
    conflictRevision = null;
    discardPending = false;
    attachmentTurnedOn = false;
    automationRows.clear();
    render();
  }

  async function reloadFromDisk(): Promise<void> {
    try {
      resetDraftFrom(await settingsGet());
      focusInitial();
    } catch (error) {
      lastError = t(C.loadFailed, { message: errorText(error) });
      render();
    }
  }

  async function save(force: boolean): Promise<void> {
    if (draft === null || snapshot === null) return;
    if (mode === "saving" || mode === "fileInvalid") return;
    const revision = force ? conflictRevision : snapshot.revision;
    if (revision === null) return;
    const patch = buildPatch(draft, snapshot, revision);
    // 图片命名的方向不对称只认**落盘前后**的取值：落盘前关、落盘后开 ⇒ 重启后生效。
    // 用「用户点过开关」当判据会把「关掉再开回来」误报成需要重启。
    const restartNeeded =
      snapshot.automation.attachment_naming.value === false &&
      draft.automation.attachment_naming.value === true;
    mode = "saving";
    errors = emptyFieldErrors();
    lastError = null;
    render();
    try {
      applyOutcome(await settingsApply(patch), restartNeeded);
    } catch (error) {
      mode = dirty() ? "dirty" : "clean";
      lastError = t(C.saveFailed, { message: errorText(error) });
      render();
    }
  }

  function applyOutcome(outcome: SettingsApplyOutcome, restartNeeded: boolean): void {
    if (draft === null) return;
    if (outcome.status === "applied") {
      const selection = draft.selection;
      snapshot = outcome.snapshot;
      draft = createDraft(outcome.snapshot);
      draft.selection = findProvider(draft, selection)?.id ?? defaultSelection(outcome.snapshot.providers);
      mode = "saved";
      errors = emptyFieldErrors();
      conflictRevision = null;
      attachmentTurnedOn = restartNeeded;
      automationRows.clear();
      render();
      return;
    }
    if (outcome.status === "conflict") {
      // 只换 CAS 基准，**不换快照**：草稿的 diff 必须仍以打开（或上次保存）时那份为基线，
      // 否则「仍然保存」会拿用户没编辑过的外部值重算出一笔不同的 patch（design §6 的
      // 「以本页为准」= 在当前文件上重新应用同一 patch）。重新载入走 settingsGet 现读。
      conflictRevision = outcome.snapshot.revision;
      mode = "conflict";
      errors = mapFieldErrors(outcome.errors);
      render();
      return;
    }
    if (outcome.status === "file_invalid") {
      snapshot = outcome.snapshot;
      mode = "fileInvalid";
      errors = mapFieldErrors(outcome.errors);
      render();
      return;
    }
    // blocked：文件逐字节不变，草稿保留；错误按 path 挂到控件，焦点落第一个错误控件。
    mode = "blocked";
    errors = mapFieldErrors(outcome.errors);
    if (errors.addId !== null) reopenRejectedAdd(errors.addId);
    render();
    card.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }

  /** 新增被后端拒绝（id 重复 / 非法 / 保留 id）时，把那条草稿新增撤回并重开添加表单，把错误
   *  回填到 id 输入框（spec「重复 id 被拒绝」：id 输入框标 aria-invalid 并显示原因）。新增项
   *  刚建出来、还没有用户填的内容，撤回不丢东西；不撤回的话错误会挂在一条「看起来已添加」
   *  的草稿行上，而添加表单已经关了，用户没有可修改的入口。 */
  function reopenRejectedAdd(message: string): void {
    if (draft === null) return;
    const index = [...draft.providers].reverse().findIndex((provider) => provider.added && !provider.removed);
    if (index < 0) return;
    const realIndex = draft.providers.length - 1 - index;
    const rejected = draft.providers[realIndex]!;
    draft.providers.splice(realIndex, 1);
    if (rejected.preset !== null) {
      draft.add = { id: rejected.id, preset: rejected.preset, error: message };
    }
    if (draft.selection === rejected.id) draft.selection = defaultSelection(visibleProviders(draft));
  }

  function focusAfterRender(selector: string): void {
    queueMicrotask(() => {
      card.querySelector<HTMLElement>(selector)?.focus();
    });
  }

  function focusInitial(): void {
    const row = card.querySelector<HTMLElement>('.lumir-set-provider-row[aria-current="true"]');
    if (row !== null) {
      row.focus();
      return;
    }
    const empty = card.querySelector<HTMLElement>(".lumir-set-empty .lumir-set-btn-primary");
    if (empty !== null) {
      empty.focus();
      return;
    }
    closeButton.focus();
  }

  // ── 打开 / 关闭 ─────────────────────────────────────────────────────────
  function open(): void {
    if (!overlay.hidden) return;
    if (document.activeElement instanceof HTMLElement) returnFocus = document.activeElement;
    overlay.hidden = false;
    deps.inertRoot.inert = true;
    registerEscapeLayer("settings-panel", requestClose);
    mode = "loading";
    snapshot = null;
    draft = null;
    errors = emptyFieldErrors();
    lastError = null;
    conflictRevision = null;
    discardPending = false;
    attachmentTurnedOn = false;
    advanced = false;
    automationRows.clear();
    relabel();
    renderLoading();
    // 取数放在下一拍：`open()` 自身同步完成（Escape / 焦点 / 层栈都已就位），异步返回时的
    // 渲染因此不会撞上「面板还没显示」的中间态。
    queueMicrotask(() => {
      settingsGet()
        .then((next) => {
          if (overlay.hidden) return; // 取数落地前面板已被关掉：不渲染、也不抢焦点
          resetDraftFrom(next);
          focusInitial();
        })
        .catch((error: unknown) => {
          if (overlay.hidden) return;
          mode = "fileInvalid";
          lastError = t(C.loadFailed, { message: errorText(error) });
          render();
          closeButton.focus();
        });
    });
  }

  function requestClose(): void {
    if (overlay.hidden) return;
    if (mode === "saving") return;
    if (discardPending) {
      discardPending = false;
      renderFooter();
      return;
    }
    if (dirty()) {
      discardPending = true;
      renderFooter();
      discardContinue.focus();
      return;
    }
    close();
  }

  function close(): void {
    if (overlay.hidden) return;
    overlay.hidden = true;
    discardPending = false;
    deps.inertRoot.inert = false;
    unregisterEscapeLayer("settings-panel");
    const target = returnFocus;
    returnFocus = null;
    if (target !== null && target.isConnected) target.focus();
    else deps.restoreFocus();
    deps.onClosed?.();
  }

  function toggle(): void {
    if (overlay.hidden) open();
    else requestClose();
  }

  // ── 事件接线 ────────────────────────────────────────────────────────────
  closeButton.addEventListener("click", () => requestClose());
  cancelButton.addEventListener("click", () => {
    if (snapshot === null || mode === "saving") return;
    resetDraftFrom(snapshot);
    focusInitial();
  });
  saveButton.addEventListener("click", () => void save(false));
  resetPageButton.addEventListener("click", () => {
    if (draft === null || locked()) return;
    pageReset(draft);
    markDirty();
    render();
  });
  discardContinue.addEventListener("click", () => {
    discardPending = false;
    renderFooter();
    card.focus();
  });
  discardConfirm.addEventListener("click", () => {
    discardPending = false;
    close();
  });
  addButton.addEventListener("click", () => openAdd());

  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) requestClose();
  });

  overlay.addEventListener("keydown", (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.defaultPrevented) return;
    const topLayer = escapeRouter.top();
    if (topLayer !== null && topLayer.id !== "settings-panel") {
      if (escapeRouter.handle(event)) return;
    }
    const disposition = escapeDisposition(event);
    if (disposition === "close") {
      event.preventDefault();
      requestClose();
      return;
    }
    if (disposition === "swallow") {
      event.preventDefault();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      moveFocus(event.shiftKey);
    }
  });

  function focusables(): HTMLElement[] {
    return [...card.querySelectorAll<HTMLElement>("button, input, select, textarea, [tabindex]")].filter(
      (node) =>
        !node.hasAttribute("disabled") &&
        node.tabIndex >= 0 &&
        !(node instanceof HTMLInputElement && node.readOnly && node.type !== "checkbox") &&
        node.getClientRects().length > 0,
    );
  }

  function moveFocus(backward: boolean): void {
    const stops = focusables();
    if (stops.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const index = active === null ? -1 : stops.indexOf(active);
    const next =
      index < 0 ? (backward ? stops.length - 1 : 0) : (index + (backward ? -1 : 1) + stops.length) % stops.length;
    stops[next]?.focus();
  }

  // ── 页级还原（默认值来自快照，纯函数在模块层）──────────────────────────
  function pageReset(target: Draft): void {
    const defaults = {} as Record<AutomationKey, boolean>;
    for (const key of AUTOMATION_KEYS) defaults[key] = defaultFlagValue(key);
    pageResetDraft(target, defaults);
    automationRows.clear();
  }

  relabel();
  onRelabel(relabel);

  return {
    toggle,
    open,
    close,
    isOpen: () => !overlay.hidden,
  };
}

const FLAG_KEYS: Record<
  AutomationKey,
  "auto_compact" | "session_naming_enabled" | "attachment_naming_enabled" | "subagents_enabled"
> = {
  auto_compact: "auto_compact",
  session_naming: "session_naming_enabled",
  attachment_naming: "attachment_naming_enabled",
  subagents: "subagents_enabled",
};
