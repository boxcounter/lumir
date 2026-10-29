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
// 可访问性：`role="dialog"` + `aria-modal`、背景 `inert`、焦点圈定与交还、四条关闭路径
// （Escape / 点遮罩 / 再按 ⌘, / 底栏「取消」）、脏面板两步确认、`role="status"` 的 polite live region。
// 「取消」与另外三条同义（关闭 + 丢弃草稿），MUST NOT 有「恢复已保存配置」这第三条语义。

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
  generalErrorsTitle: "D867",
  statusLoadFailed: "D868",
  loadFailedTitle: "D869",
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
  /** **盘上**是否有 Key（快照事实，草稿里的清除 / 替换都不改它）。输入框清空时「= 清除」还是
   *  「= 什么都没改」只能按它判：`hasKey` 是显示态，清过一次之后就不再是盘上事实（P2-5 r3）。 */
  keyWasSet: boolean;
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
  /** 仅 `added` 有意义：加入草稿前的 active 值（撤销这次新增时恢复它，P1-1 r1）。 */
  activeBeforeAdd: string | null;
  /** 后端拒绝这条新增的 id 时的错误（挂在条目自己的 id 输入上，不丢已填字段，P1-1 r1）。 */
  idError: string | null;
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
  /** 被删条目在 `draft.providers` 里的**草稿下标**——删除计划的唯一身份。id 可以被复制（新增撞上
   *  已有 id 被后端拒绝时，草稿里同时有一条已保存条目和一条 `added` 条目同 id），按 id 反查会
   *  稳定命中前面那条已保存条目：用户在新增条目上点「删除…」会误删既有配置（P1-1 r2）。 */
  index: number;
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
  /** `active` / 两个命名目标各自的**持有者条目**（草稿对象身份，不是 id 字面）。id 可以被多条草稿
   *  复用（两笔未落盘的同 id 新增），改名与删除都必须按持有者改引用：「存在另一个同 id 条目」
   *  推不出归属（P1-2 r3）。`null` = 引用指向盘上 / 列表外的值（`mock`、悬空 id）或没有引用。 */
  activeOwner: DraftProvider | null;
  namingOwner: Record<NamingKind, DraftProvider | null>;
  automation: Record<AutomationKey, DraftAutomationFlag>;
  naming: Record<NamingKind, DraftNamingTarget>;
  namingTouched: Record<NamingKind, { provider: boolean; model: boolean }>;
  selection: string | null;
  /** 表单正在编辑的 provider 的**草稿下标**（id 可能重复：新增撞已有 id 时两条草稿同 id，
   *  按 id 查会稳定命中第一条，P1-1 r1 实测）。`null` = 按 `selection` 反查。 */
  focusedIndex: number | null;
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
  const providers: DraftProvider[] = snapshot.providers.map((provider) => ({
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
    keyWasSet: provider.api_key.state === "set",
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
    activeBeforeAdd: null,
    idError: null,
  }));
  // 快照里的引用只可能指向已保存条目（或列表外的 `mock` / 悬空 id → 无持有者）。
  const ownerOf = (id: string | null): DraftProvider | null =>
    id === null ? null : (providers.find((item) => item.id === id) ?? null);
  return {
    providers,
    active: snapshot.active,
    activeOwner: ownerOf(snapshot.active),
    namingOwner: {
      session: ownerOf(snapshot.naming.session.override_provider),
      attachment: ownerOf(snapshot.naming.attachment.override_provider),
    },
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
    focusedIndex: null,
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

/** 可替代候选（**已保存条目**的删除）：合法、非 mock、未被装载期忽略、未被本笔删除（与 Rust
 *  §4.2 同口径，只用于删除确认的选项渲染；后端在锁内重新计算）。按 **id** 排除：后端就是按 id
 *  删这一条，同 id 的条目不能被当成替代目标（那等于把 active 指回正在删除的 id）。 */
export function deleteCandidates(draft: Draft, exclude: string): string[] {
  return uniqueIds(
    draft.providers
      .filter((provider) => provider.id !== exclude && !provider.removed && !provider.ignored)
      .map((provider) => provider.id),
  );
}

/** 删除确认真正的候选清单：**未落盘的条目只排除它自己**——同 id 的幸存新增是合法替代目标
 *  （它没进过文件、保存后就是这个 id 的实体）。按 id 排除会把整组同 id 一起丢掉，删掉当前的
 *  那笔之后 active 只能回落到 `mock`、patch 里也不会带 `active_provider`（P1-1 r4）。 */
export function replacementCandidates(draft: Draft, provider: DraftProvider): string[] {
  if (!provider.added) return deleteCandidates(draft, provider.id);
  return uniqueIds(
    draft.providers
      .filter((item) => item !== provider && !item.removed && !item.ignored)
      .map((item) => item.id),
  );
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

/** 把「当前使用」切给某一条草稿（`id` 与**持有者**一起写）：同 id 的另一条不能被当成同一个引用
 *  （P1-2 r3）。UI 的「设为当前使用」与测试都走这里。 */
export function setActiveDraft(draft: Draft, provider: DraftProvider): void {
  draft.active = provider.id;
  draft.activeOwner = provider;
  draft.activeTouched = true;
}

/** provider 的生效模型（草稿态）：显式 `providers.<id>.model` 优先（不在清单也保留），
 *  否则清单首项，否则空串（design §9.1）。 */
export function draftEffectiveModel(
  provider: DraftProvider,
  options: { validOnly?: boolean } = {},
): string {
  const explicit = provider.effectiveModel.trim();
  if (explicit !== "") return explicit;
  return (
    provider.models
      .filter((row) => options.validOnly !== true || row.valid !== false)
      .map((row) => row.id.trim())
      .find((id) => id !== "") ?? ""
  );
}

export function draftProviderDirty(provider: DraftProvider): boolean {
  return (
    provider.keyEdit !== null ||
    provider.modelsEdit !== null ||
    provider.baseUrlEdit !== null ||
    provider.wireEdit !== null
  );
}

/** 输入框内容 → Key 的草稿编辑意图。空串的含义取决于**盘上**是否有 Key：有 ⇒ 清除（删键），
 *  没有 ⇒ 什么都不改。判据用 `keyWasSet`（快照事实）而不是 `hasKey`（显示态）——
 *  「清除 → 输入替换值 → 再清空」这条链里 `hasKey` 早就是 false 了，按它判会把清除意图丢掉，
 *  界面说「未配置」而盘上原 Key 留着（P2-5 r3）。 */
export function keyEditForInput(provider: DraftProvider, value: string): DraftKeyEdit | null {
  if (value !== "") return { kind: "replace", value };
  return provider.keyWasSet ? { kind: "clear", value: "" } : null;
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

/** 当前**草稿**的引用面（P1-3 r1）：删除保护块与删除计划的默认值都必须看用户此刻的 active /
 *  命名选择，而不是打开面板时的快照（用户可能先切了 active / 命名目标再删）。 */
export function draftReferences(draft: Draft, id: string): ProviderReferences {
  return {
    active: draft.active === id,
    session_naming: draft.naming.session.provider === id,
    attachment_naming: draft.naming.attachment.provider === id,
  };
}

function providerDelete(provider: DraftProvider, draft: Draft, providerIndex: number): ProviderEdit {
  const candidates = deleteCandidates(draft, provider.id);
  // 删除计划按**草稿下标**认领（id 可能重复，见 `DraftDeleteForm`）。
  const plan = draft.remove?.index === providerIndex ? draft.remove : null;
  const refs = draftReferences(draft, provider.id);
  const edit: Extract<ProviderEdit, { action: "delete" }> = { action: "delete", id: provider.id };
  if (refs.active && candidates.length > 0) {
    edit.active_after =
      plan !== null && candidates.includes(plan.activeAfter) ? plan.activeAfter : candidates[0]!;
  }
  if (refs.session_naming) {
    edit.session_naming_after = retargetOf(plan?.sessionAfter ?? "follow", candidates);
  }
  if (refs.attachment_naming) {
    edit.attachment_naming_after = retargetOf(plan?.attachmentAfter ?? "follow", candidates);
  }
  return edit;
}

function retargetOf(value: string, candidates: readonly string[]): NamingRetarget {
  return value !== "follow" && candidates.includes(value)
    ? { kind: "provider", value }
    : { kind: "follow_active" };
}

/** provider 编辑序列 + 每条 `Add` 在 `patch.providers` 里的下标（P1-1 r1：后端拒绝 Add 时
 *  错误路径是 `providers[<patch 下标>].id`，必须能定位到**具体哪一条**草稿新增）。 */
export interface ProviderEditsPlan {
  edits: ProviderEdit[];
  /** 每条 `Add` 的位置：`index` = `patch.providers` 下标，`providerIndex` = 草稿 providers 下标。
   *  用**草稿下标**而不是 id 关联——草稿里可能出现同 id 的两条（新增撞已有 id 时），按 id 查
   *  会命中错的那一条（r1 P1-1 实测）。 */
  adds: Array<{ index: number; providerIndex: number; id: string }>;
}

export function planProviderEdits(draft: Draft): ProviderEditsPlan {
  const edits: ProviderEdit[] = [];
  const adds: ProviderEditsPlan["adds"] = [];
  draft.providers.forEach((provider, providerIndex) => {
    if (provider.removed) {
      // 从未落盘的新增项被删掉 = 草稿里的一次撤销，不是文件的 delete（后端会报 not_found）。
      if (!provider.added) edits.push(providerDelete(provider, draft, providerIndex));
      return;
    }
    if (provider.added) {
      if (provider.preset !== null) {
        adds.push({ index: edits.length, providerIndex, id: provider.id });
        edits.push({ action: "add", id: provider.id, preset: provider.preset });
        const edit = providerUpdate(provider);
        if (edit !== null) edits.push(edit);
      }
      return;
    }
    const update = providerUpdate(provider);
    if (update !== null) edits.push(update);
  });
  return { edits, adds };
}

/** 草稿 + revision → 一笔强类型 patch（design §6）。`baseRevision` 是 CAS 基准：正常保存用
 *  快照里的 revision；「仍然保存」用冲突返回的新 revision 重新应用同一批意图。 */
export function buildPatch(draft: Draft, snapshot: SettingsSnapshot, baseRevision: string): SettingsPatch {
  const { edits: providers } = planProviderEdits(draft);
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
    keyWasSet: false,
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
    activeBeforeAdd: null,
    idError: null,
  };
  provider.activeBeforeAdd = draft.active;
  draft.providers.push(provider);
  draft.focusedIndex = draft.providers.length - 1;
  draft.selection = id;
  // 当前使用项**不可用**（没有 / 指向列表外的 id——典型是只剩 mock 的配置：mock 不呈现、
  // 也不该被缺省选中）时，新增的这条同一笔成为当前使用，否则用户体验是「添加成功但还不能用，
  // 得再去找 chip」（design §4.4）。
  const activeListed =
    draft.active !== null &&
    draft.providers.some((item) => item.id === draft.active && !item.removed && !item.ignored);
  if (!activeListed) {
    draft.active = id;
    draft.activeOwner = provider;
    draft.activeTouched = true;
  }
  return provider;
}

/** 按 id 字面寻址时「这个 id 的实体」是哪一条：**已保存条目优先**（它在盘上，后端解析的就是它），
 *  否则取第一条未删的草稿条目。用户在选择器里选的引用与删除计划给的替代目标都按这条落到具体
 *  条目上（引用持有者的初始值 / 重定向后的新持有者）。 */
export function referenceOwner(draft: Draft, id: string | null): DraftProvider | null {
  if (id === null) return null;
  const holders = draft.providers.filter((provider) => provider.id === id && !provider.removed);
  return holders.find((provider) => !provider.added) ?? holders[0] ?? null;
}

/** 给「尚未落盘的新增项」改 id（新增被后端按 id 拒绝后，用户就地改正）。
 *
 *  引用是否跟着改名只看**持有者身份**（`activeOwner` / `namingOwner`）：这条草稿是不是该引用的
 *  持有者。按 id 字面推（「有别的同 id 条目 ⇒ 引用属于它」）会在两笔同 id 未落盘新增上把引用
 *  静默转给另一条（P1-2 r3）——第一笔取了 active、用户也可能把它选成命名目标。 */
export function renameDraftProviderId(draft: Draft, provider: DraftProvider, next: string): void {
  const previous = provider.id;
  if (next === previous) return;
  provider.id = next;
  for (const kind of NAMING_KINDS) {
    if (draft.namingOwner[kind] === provider) {
      draft.naming[kind].provider = next;
      draft.namingTouched[kind].provider = true;
    }
  }
  if (draft.activeOwner === provider) {
    draft.active = next;
    draft.activeTouched = next !== draft.baseline.active;
  }
  // 选中态只是「哪一行高亮」，不是配置语义：焦点确实在这条草稿上（或它没有同 id 邻居）时跟着改。
  if (draft.selection === previous) {
    const focused = draft.focusedIndex === null ? null : (draft.providers[draft.focusedIndex] ?? null);
    const hasNeighbour = draft.providers.some(
      (item) => item !== provider && !item.removed && item.id === previous,
    );
    if (focused === provider || (focused === null && !hasNeighbour)) draft.selection = next;
  }
}

/** 这个条目的引用面（按**持有者身份**判，不按 id 字面）：同 id 的其它草稿条目可能有自己的引用，
 *  两者不能互相顶替（P1-2 r3）。删除确认的三块说明与删除计划都读它。 */
function ownedReferences(draft: Draft, provider: DraftProvider): ProviderReferences {
  return {
    active: draft.activeOwner === provider,
    session_naming: draft.namingOwner.session === provider,
    attachment_naming: draft.namingOwner.attachment === provider,
  };
}

/** 删除确认要展示、也是删除时要兑现的引用面：已保存条目按 id 字面（盘上那个 id 就是它），
 *  未落盘的新增项按持有者身份（它可能只是与别人同 id）。 */
export function deleteReferences(draft: Draft, provider: DraftProvider): ProviderReferences {
  return provider.added ? ownedReferences(draft, provider) : draftReferences(draft, provider.id);
}

/** 删除确认的确认侧（design §4.3 / §11.5）：只改草稿——标记移除、按计划改写 active 与两个
 *  命名目标、清掉属于旧 provider 的 model 覆盖，并把选中态落到替代项或列表首项。
 *
 *  两条不同的语义（r3 才拆开）：**未被任何引用指着的未落盘新增** = 撤销这次添加（从草稿里摘掉，
 *  不进 patch）；**被 active / 命名指着的**（含未落盘的新增）仍是「删除当前/被引用项」，必须兑现
 *  删除确认里选的替代目标（design §4.2：删后仍有 provider 时采用所选替代项）。 */
export function applyDraftDelete(draft: Draft): void {
  const plan = draft.remove;
  if (plan === null) return;
  // 按草稿下标取，不按 id：同 id 的多条草稿里，只有下标能指出用户点的是哪一条。
  const provider = draft.providers[plan.index] ?? null;
  if (provider === null) {
    draft.remove = null;
    return;
  }
  const refs = deleteReferences(draft, provider);
  // 候选清单与删除确认里渲染的是同一份：未落盘的新增只排除它自己（同 id 的幸存新增仍可当替代）。
  const candidates = replacementCandidates(draft, provider);
  // 计划里的替代目标可能已失效（例如打开确认后另一个 provider 也被删了）：回落第一个候选。
  const activeAfter =
    plan.activeAfter !== "" && candidates.includes(plan.activeAfter) ? plan.activeAfter : (candidates[0] ?? "");

  if (provider.added) {
    // 从未落盘的条目：**从草稿里摘掉**（它从来没进过文件，后端也没有它可删）。引用重定向照旧
    // 兑现——它是当前使用项 / 命名目标时，删除确认里选的替代项必须生效（design §4.2 / P1-1 r3）；
    // 没有任何引用指着它时，这就是一次纯粹的「撤销添加」，不改写任何引用、patch 里也不留东西。
    const removedIndex = draft.providers.indexOf(provider);
    draft.providers = draft.providers.filter((item) => item !== provider);
    if (draft.focusedIndex !== null) {
      if (draft.focusedIndex === removedIndex) draft.focusedIndex = null;
      else if (draft.focusedIndex > removedIndex) draft.focusedIndex -= 1;
    }
  } else {
    provider.removed = true;
    provider.keyEdit = null;
    provider.modelsEdit = null;
    provider.baseUrlEdit = null;
    provider.wireEdit = null;
  }
  if (refs.active) {
    if (candidates.length > 0) {
      draft.active = activeAfter;
    } else {
      // 没有替代项：未落盘的新增回到「加入草稿前」的值（可能是 `mock` / null）；已保存条目删到
      // 零则不留当前使用项（design §4.4 的删键）。
      draft.active = provider.added ? provider.activeBeforeAdd : null;
    }
    draft.activeOwner = referenceOwner(draft, draft.active);
    draft.activeTouched = draft.active !== draft.baseline.active;
  }
  for (const kind of NAMING_KINDS) {
    const referenced = kind === "session" ? refs.session_naming : refs.attachment_naming;
    if (referenced) {
      const target = kind === "session" ? plan.sessionAfter : plan.attachmentAfter;
      draft.naming[kind].provider = target === "follow" ? null : target;
      draft.naming[kind].model = null;
      draft.namingOwner[kind] = referenceOwner(draft, draft.naming[kind].provider);
      draft.namingTouched[kind].provider = true;
      draft.namingTouched[kind].model = true;
      continue;
    }
    // 删除的是当前使用项、该命名目标是「跟随当前」：目标随之隐式变化，旧 model 覆盖属于旧
    // provider 的清单，必须**当场**清掉（design §4.1 / §10.5；不能等后端保存后再清，否则草稿
    // 与说明还停在旧读数，P1-3 r1）。
    if (refs.active && draft.naming[kind].provider === null && draft.naming[kind].model !== null) {
      draft.naming[kind].model = null;
      draft.namingTouched[kind].model = true;
    }
  }
  draft.remove = null;
  if (draft.selection === provider.id) {
    draft.selection = draft.active ?? visibleProviders(draft)[0]?.id ?? null;
    draft.focusedIndex = null;
  }
  if (draft.focusedIndex !== null && draft.providers[draft.focusedIndex] === provider) draft.focusedIndex = null;
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
  draft.activeOwner = null;
  draft.activeTouched = true;
  draft.pageReset = true;
  for (const key of AUTOMATION_KEYS) draft.automation[key] = { value: defaults[key], explicit: false };
  for (const kind of NAMING_KINDS) {
    draft.naming[kind] = { provider: null, model: null };
    draft.namingOwner[kind] = null;
    draft.namingTouched[kind] = { provider: true, model: true };
  }
  draft.add = null;
  draft.remove = null;
}

/** 命名目标的 provider 选择：换目标即清 model 覆盖（它属于旧 provider 的清单，design §6）。 */
export function setNamingProviderDraft(draft: Draft, kind: NamingKind, value: string): void {
  draft.naming[kind].provider = value === "" ? null : value;
  draft.naming[kind].model = null;
  draft.namingOwner[kind] = referenceOwner(draft, draft.naming[kind].provider);
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
  /** 打开 / 上次保存时的快照：**未编辑状态**直接消费后端解析出的 `resolved` 与两个选项表
   *  （后端用装载后的有效清单与 `vision_supported` 判资格，P1-2 r1）。草稿改过时才做预览，
   *  预览同样只把 `valid !== false` 的行当作有效声明。 */
  snapshot?: SettingsSnapshot | null;
}

interface NamingOptionView {
  id: string;
  vision: boolean;
  isEffective: boolean;
}

interface NamingResolutionView {
  provider: string | null;
  model: string;
  follows: boolean;
  dangling: boolean;
  eligible: boolean;
  requested: string | null;
  inList: boolean;
  /** 目标 provider 的生效模型（「生效模型（默认：…）」标签用）。 */
  effective: string;
  /** 目标 provider 的有效模型清单（后端已逐项校验；草稿预览过滤 `valid:false`）。 */
  options: NamingOptionView[];
  /** provider 选择器的候选（不含「跟随」那一项）。 */
  providerChoices: Array<{ id: string; isActive: boolean }>;
}

/** 未编辑状态：后端的已保存解析结果。（`reference` 只用于判定 `inList` 与回落文案。） */
function backendResolution(
  state: SettingsSnapshot["naming"]["session"],
  kind: NamingKind,
): NamingResolutionView {
  void kind;
  const options = state.model_options.map((item) => ({
    id: item.id,
    vision: item.vision,
    isEffective: item.is_effective,
  }));
  const requested = state.override_model;
  return {
    provider: state.resolved.provider,
    model: state.resolved.model,
    follows: state.resolved.follows_active,
    dangling: state.resolved.dangling,
    eligible: state.resolved.eligible,
    requested,
    inList: requested !== null && options.some((item) => item.id === requested),
    effective: options.find((item) => item.isEffective)?.id ?? "",
    options,
    providerChoices: state.provider_options.map((item) => ({ id: item.id, isActive: item.is_active })),
  };
}

/** 草稿预览：从草稿的 provider / 有效模型行现算（只用于用户改过命名或改过 provider 的场合）。 */
function draftResolution(draft: Draft, kind: NamingKind): NamingResolutionView {
  const target = draft.naming[kind];
  const providers = visibleProviders(draft).filter((provider) => !provider.ignored);
  const providerById = new Map(providers.map((provider) => [provider.id, provider]));
  const danglingProvider = target.provider !== null && !providerById.has(target.provider);
  const follows = target.provider === null || danglingProvider;
  const resolvedId = danglingProvider ? draft.active : (target.provider ?? draft.active);
  const resolved = resolvedId === null ? null : (providerById.get(resolvedId) ?? null);
  // `valid === false` 的行会被装载期丢弃：预览不得把它们当成有效声明（否则 vision / 清单
  // 资格会给出与后端相反的结论，P1-2 r1）。
  const declared = resolved === null ? [] : resolved.models.filter((row) => row.id.trim() !== "" && row.valid !== false);
  const options: NamingOptionView[] = declared.map((row) => ({
    id: row.id.trim(),
    vision: row.vision === true,
    isEffective: false,
  }));
  const effective = resolved === null ? "" : draftEffectiveModel(resolved, { validOnly: true });
  for (const item of options) item.isEffective = item.id === effective;
  const requested = target.model;
  return {
    provider: resolvedId,
    model:
      resolved === null
        ? ""
        : kind === "session"
          ? modelForSessionOf(requested, options, effective)
          : (requested ?? effective),
    follows,
    dangling: danglingProvider,
    eligible:
      resolved !== null &&
      (kind === "session"
        ? modelForSessionOf(requested, options, effective) !== ""
        : options.find((item) => item.id === (requested ?? effective))?.vision === true),
    requested,
    inList: requested !== null && options.some((item) => item.id === requested),
    effective,
    options,
    providerChoices: providers.map((provider) => ({ id: provider.id, isActive: provider.id === draft.active })),
  };
}

function modelForSessionOf(
  requested: string | null,
  options: readonly NamingOptionView[],
  effective: string,
): string {
  if (requested === null) return effective;
  return options.some((item) => item.id === requested) ? requested : effective;
}

/** 一行命名目标的选择器选项 + 唯一一行生效说明。
 *
 *  会话命名的覆盖模型不在清单时是**回落**（写「已回落生效模型」），MUST NOT 写成
 *  「无模型 / 会跳过」；图片命名保留原值、按 vision 资格跳过（design §2.6 / §10.2）。
 *  **未编辑状态消费后端 `resolved` / `model_options`**：草稿预览与后端解析只有一份规则在
 *  生效——用户没改过命名目标、也没改过 provider 时，读数就是后端算出来的那一份。 */
export function namingRowModel(input: NamingRowInput): NamingRowModel {
  const { kind, draft, enabled, locked, snapshot = null } = input;
  const touched = draft.namingTouched[kind];
  const providersDirty = draft.providers.some(
    (provider) => provider.added || provider.removed || draftProviderDirty(provider),
  );
  const clean =
    !touched.provider && !touched.model && !draft.activeTouched && !providersDirty && snapshot !== null;
  const view =
    clean && snapshot !== null
      ? backendResolution(kind === "session" ? snapshot.naming.session : snapshot.naming.attachment, kind)
      : draftResolution(draft, kind);
  const target = draft.naming[kind];
  const providerValue = clean && snapshot !== null
    ? (kind === "session" ? snapshot.naming.session.override_provider : snapshot.naming.attachment.override_provider) ?? ""
    : target.provider ?? "";
  const modelValue = clean && snapshot !== null
    ? (kind === "session" ? snapshot.naming.session.override_model : snapshot.naming.attachment.override_model) ?? ""
    : target.model ?? "";

  const providerOptions: NamingOptionModel[] = [{ value: "", label: t(C.followActiveOption) }];
  for (const choice of view.providerChoices) {
    providerOptions.push({
      value: choice.id,
      label: choice.isActive ? t(C.providerOptionCurrent, { id: choice.id }) : choice.id,
    });
  }
  const danglingProvider = providerValue !== "" && !view.providerChoices.some((item) => item.id === providerValue);
  if (danglingProvider) {
    providerOptions.push({ value: providerValue, label: t(C.providerOptionDangling, { id: providerValue }) });
  }

  const modelOptions: NamingOptionModel[] = [
    {
      value: "",
      label:
        view.effective === ""
          ? t(C.effectiveModelOptionPlain)
          : t(C.effectiveModelOption, { model: view.effective }),
    },
  ];
  for (const item of view.options) {
    if (item.isEffective) continue; // 「生效模型（默认）」那一项已经覆盖它
    const suffix =
      kind === "attachment" ? (item.vision ? t(C.visionTag) : t(C.noVisionTag)) : "";
    modelOptions.push({ value: item.id, label: `${item.id}${suffix}` });
  }
  // raw 覆盖值必须能在选择器里显示出来（MUST NOT 静默规范化）：两种情况——
  //   ① 覆盖值就是生效模型（清单里被「生效模型（默认）」那一项吸收了）；
  //   ② 覆盖值不在有效清单（悬空 / 会被丢弃的坏行）。
  if (modelValue !== "" && !modelOptions.some((item) => item.value === modelValue)) {
    // 「是生效模型」只在它确实出现在**有效清单**里时才算数；否则（被装载期丢弃的坏行 / 悬空
    // 覆盖）按「不在清单」标注，资格一律不通过。
    const known = view.options.some((item) => item.id === modelValue);
    const isEffective = known && modelValue === view.effective;
    const vision = view.options.find((item) => item.id === modelValue)?.vision === true;
    const suffix = kind === "attachment" ? (vision ? t(C.visionTag) : t(C.noVisionTag)) : "";
    modelOptions.push({
      value: modelValue,
      label: isEffective
        ? `${modelValue}${suffix}`
        : kind === "attachment"
          ? t(C.modelOptionSkipped, { id: modelValue })
          : t(C.modelOptionDangling, { id: modelValue }),
    });
  }

  const timing = kind === "session" ? t(C.timingSession) : t(C.timingAttachment);
  const provenance = view.dangling
    ? t(C.provenanceDangling)
    : view.follows
      ? t(C.provenanceFollow)
      : t(C.provenanceExplicit);
  const targetText =
    view.provider === null ? "" : `${view.provider} / ${view.model === "" ? t(C.targetNone) : view.model}`;

  let note: string;
  let bad = false;
  if (!enabled) {
    note = view.provider === null ? t(C.namingClosedNoTarget) : t(C.namingClosed, { target: targetText });
  } else if (view.provider === null) {
    bad = true;
    note = kind === "attachment" ? t(C.namingNoProviderAttachment) : t(C.namingNoProviderSession);
  } else if (kind === "attachment") {
    const target = `${view.provider} / ${view.model === "" ? t(C.targetNone) : view.model}`;
    if (view.eligible) {
      note = t(C.namingAttachmentEligible, { target, source: provenance, timing });
    } else {
      bad = true;
      note = t(C.namingAttachmentSkip, { target, source: provenance, timing });
    }
  } else if (view.model === "") {
    bad = true;
    note = t(C.namingSessionNoModel, {
      target: `${view.provider} / ${t(C.targetNone)}`,
      source: provenance,
      timing,
    });
  } else {
    note = t(C.namingLine, {
      target: `${view.provider} / ${view.model}`,
      source: provenance,
      timing,
    });
    if (view.requested !== null && !view.inList) {
      note += t(C.namingSessionFallback, { model: view.requested });
    }
  }

  return {
    providerOptions,
    modelOptions,
    providerValue,
    modelValue,
    note,
    bad,
    disabled: locked || !enabled || view.providerChoices.length === 0,
  };
}

// ---------------------------------------------------------------------------
// 错误回填（design §5.6 / §6.3：按后端返回的 path 分类，不重做校验）
// ---------------------------------------------------------------------------

export interface FieldErrors {
  /** `providers[<n>].id`（新增表单）。 */
  addId: string | null;
  /** 该错误的 patch 下标（定位到具体哪一条草稿新增；P1-1 r1）。 */
  addIdIndex: number | null;
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
    addIdIndex: null,
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
const ADD_PATH = /^providers\[(\d+)\]\.id$/;

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
    const addPath = ADD_PATH.exec(path);
    if (addPath !== null) {
      out.addId ??= error.message;
      out.addIdIndex ??= Number(addPath[1]);
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
  if (errors.sessionNaming !== null) count += 1;
  if (errors.attachmentNaming !== null) count += 1;
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
    /** 该行当前挂着的后端错误节点（命名行才有）。行是持久 DOM，节点必须自己持有才能在下一次
     *  重绘 / 编辑清错时移除（P2-4 r2）。 */
    error: HTMLElement | null;
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
    // 横幅先渲染且**不依赖快照**：`settings_get` 失败时 snapshot 为 null，若只在快照就绪后
    // 才画横幅，用户会一直停在「正在读取配置文件…」（r1 P2-4）。
    renderBanner();
    if (draft === null || snapshot === null) {
      renderLoading();
      return;
    }
    // 副标题与清单来源取自快照：`relabel()` 在取数之前跑过一次（那时 snapshot 还是 null），
    // 取数落地后必须在这里补一次，否则整个面板会停在没有路径 / 没有来源说明的状态。
    subtitle.textContent = t(C.subtitle, { path: snapshot.path });
    modelSource.textContent = t(C.modelSource, { path: snapshot.path });
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
    // 底栏「取消」是第四条关闭路径（与 × / Escape / 点遮罩同义）：只有保存中禁用。读取中 /
    // 读取失败也允许关——那时草稿还没有内容，没有什么可丢弃的。
    cancelButton.disabled = mode === "saving";
    if (snapshot === null) {
      const failed = lastError !== null;
      statusLine.textContent = failed ? t(C.statusLoadFailed) : t(C.statusLoading);
      statusLine.dataset.tone = failed ? "error" : "clean";
      resetPageButton.disabled = true;
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
    if (snapshot === null) {
      if (lastError === null) return;
      const banner = element("div", "lumir-set-banner is-danger lumir-set-error-outlet");
      banner.dataset.banner = "load-error";
      banner.tabIndex = -1;
      banner.append(element("div", "lumir-set-banner-title", t(C.loadFailedTitle)));
      banner.append(element("p", "lumir-set-banner-body", lastError));
      bannerSlot.append(banner);
      return;
    }
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
      const banner = element("div", "lumir-set-banner is-danger lumir-set-error-outlet");
      banner.dataset.banner = "save-error";
      banner.tabIndex = -1;
      banner.append(element("p", "lumir-set-banner-body", lastError));
      bannerSlot.append(banner);
    }
    // 没有专属控件的字段错误（当前使用项 / 文件级）集中在这里：计数之外还要能读到具体消息
    // （r1 P2-4）。命名目标的错误挂在各自那一行（更近的入口），不在这里重复。
    const general: Array<{ path: string; message: string }> = [];
    if (errors.active !== null) general.push({ path: "harness.provider", message: errors.active });
    if (errors.fileLevel !== null) general.push({ path: "", message: errors.fileLevel });
    if (general.length > 0) {
      const banner = element("div", "lumir-set-banner is-danger lumir-set-error-outlet");
      banner.dataset.banner = "field-errors";
      banner.tabIndex = -1;
      banner.append(element("div", "lumir-set-banner-title", t(C.generalErrorsTitle)));
      const list = element("ul", "lumir-set-diag-list");
      for (const item of general) {
        const row = element("li", "lumir-set-diag-item");
        if (item.path !== "") row.append(element("span", "lumir-set-diag-path", item.path));
        row.append(document.createTextNode(item.message));
        list.append(row);
      }
      banner.append(list);
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
    const currentDraft = draft;
    providerList.replaceChildren();
    const providers = visibleProviders(draft);
    railHead.textContent = providers.length === 0 ? t(C.providerRail) : `${t(C.providerRail)} ${providers.length}`;
    addButton.disabled = locked();
    providers.forEach((provider) => {
      const providerIndex = currentDraft.providers.indexOf(provider);
      const row = element("button", "lumir-set-provider-row");
      row.type = "button";
      row.dataset.providerId = provider.id;
      row.dataset.providerIndex = String(providerIndex);
      row.setAttribute("aria-current", String(currentDraft.selection === provider.id));
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
      if (currentDraft.selection === provider.id) row.classList.add("is-on");
      const dot = element("span", "lumir-set-dot");
      dot.classList.add(provider.status === "ok" ? "is-ok" : "is-warn");
      dot.setAttribute("aria-hidden", "true");
      row.append(dot, element("span", "lumir-set-pname", provider.id));
      row.append(element("span", "lumir-set-ppreset", `· ${presetLabel(provider.preset)}`));
      if (currentDraft.active === provider.id) row.append(element("span", "lumir-set-current", t(C.currentBadge)));
      row.addEventListener("click", () => selectProvider(providerIndex));
      providerList.append(row);
    });
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
    const focused = draft.focusedIndex === null ? null : (draft.providers[draft.focusedIndex] ?? null);
    const provider = focused !== null && !focused.removed ? focused : findProvider(draft, draft.selection);
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
    focusAfterRender(`.lumir-set-provider-row[data-provider-index="${draft.focusedIndex}"]`);
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
        // 引用持有者是**这一条**（同 id 的另一条不算），改名 / 删除时按它判。
        setActiveDraft(draft, provider);
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

    if (provider.added) wrap.append(renderDraftIdField(provider));
    wrap.append(renderKeyField(provider));
    wrap.append(renderModelsField(provider));
    wrap.append(renderAdvanced(provider));
    wrap.append(renderDangerZone(provider));
    form.append(wrap);
  }

  /** 尚未落盘的新增条目的 id 编辑面（P1-1 r1）：新增被后端按 id 拒绝时，用户在这里就地改名，
   *  已填的 Key / 模型 / Base URL 全部保留。落盘后 id 不可变，本控件不再出现。 */
  function renderDraftIdField(provider: DraftProvider): HTMLElement {
    const field = element("div", "lumir-set-field");
    const head = element("div", "lumir-set-field-head");
    const label = element("label", "lumir-set-label", t(C.addIdLabel));
    label.htmlFor = "lumir-set-draft-id";
    head.append(label, element("span", "lumir-set-field-state", t(C.addIdState)));
    const input = element("input", "lumir-set-input lumir-set-mono");
    input.id = "lumir-set-draft-id";
    input.type = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder = t(C.addIdPlaceholder);
    input.value = provider.id;
    input.readOnly = locked();
    input.addEventListener("input", () => {
      renameDraftProvider(provider, input.value);
      input.removeAttribute("aria-invalid");
      input.removeAttribute("aria-errormessage");
      const existing = field.querySelector(".lumir-set-field-error");
      if (existing !== null) existing.remove();
    });
    // 不在 change / blur 上整页重绘：重绘会把用户紧接着点向的按钮从 DOM 里换掉，
    // 那一次点击（mousedown 落在旧节点、mouseup 落在新节点）就静默丢失（r1 DOM 回归实测）。
    input.addEventListener("blur", () => renderFooter());
    field.append(head, input, element("p", "lumir-set-hint", t(C.addIdHint)));
    if (provider.idError !== null) {
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-errormessage", "lumir-set-draft-id-error");
      const node = element("p", "lumir-set-field-error", provider.idError);
      node.id = "lumir-set-draft-id-error";
      field.append(node);
    }
    return field;
  }

  function renderKeyField(provider: DraftProvider): HTMLElement {
    const field = element("div", "lumir-set-field");
    const head = element("div", "lumir-set-field-head");
    const label = element("label", "lumir-set-label", t(C.apiKey));
    label.htmlFor = "lumir-set-api-key";
    head.append(label);
    const pending = provider.keyEdit?.kind === "replace";
    const state = element(
      "span",
      "lumir-set-field-state",
      pending ? t(C.keyStatePending) : provider.hasKey ? t(C.keyStateSet) : t(C.keyStateUnset),
    );
    head.append(state);
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
      provider.keyEdit = keyEditForInput(provider, input.value);
      // 显示与实际草稿一致：替换中 = 待保存；空输入 = 按草稿意图（清除 / 未改）回到盘上事实。
      provider.hasKey = provider.keyEdit === null && provider.keyWasSet;
      state.textContent =
        provider.keyEdit?.kind === "replace"
          ? t(C.keyStatePending)
          : provider.hasKey
            ? t(C.keyStateSet)
            : t(C.keyStateUnset);
      markDirty();
      renderFooter();
    });
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
      // 草稿显示同步：清掉后就是「未配置」，不能还挂着「已配置 · …末 4 位」（P2-6 r1）。
      provider.hasKey = false;
      provider.keyHint = null;
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
    const baseState = element(
      "span",
      "lumir-set-field-state",
      custom ? t(C.baseCustom) : provider.preset === "generic" ? t(C.baseMissing) : t(C.baseOfficial),
    );
    baseRight.append(baseState);
    const baseReset = button("lumir-set-btn-link", t(C.restoreDefault));
    const baseResetVisible = (): boolean =>
      provider.baseUrlEdit?.kind === "reset"
        ? false
        : provider.baseUrlPresent || provider.baseUrlEdit?.kind === "set";
    // 显式值才给「恢复默认」：键存在、或草稿里刚填了值；点了恢复默认（reset）后按钮消失
    // （P2-6 r1：此前 hidden 只看 present，reset 之后仍然挂着）。
    baseReset.hidden = !baseResetVisible();
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
      const customNow = isCustomBase(provider);
      baseState.textContent = customNow
        ? t(C.baseCustom)
        : provider.preset === "generic"
          ? t(C.baseMissing)
          : t(C.baseOfficial);
      warning.hidden = !customNow;
      baseReset.hidden = !baseResetVisible();
      markDirty();
      renderFooter();
    });
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
    const warning = element(
      "p",
      "lumir-set-inline-warning",
      provider.hasKey || provider.keyEdit !== null ? t(C.baseWarnKey) : t(C.baseWarnPlain),
    );
    warning.hidden = !custom;
    baseField.append(warning);
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
    wireReset.hidden = provider.wireEdit?.kind === "reset"
      ? true
      : !(provider.wirePresent || provider.wireEdit?.kind === "set");
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
    const wireResetVisible = (): boolean =>
      provider.wireEdit?.kind === "reset" ? false : provider.wirePresent || provider.wireEdit?.kind === "set";
    wireSelect.addEventListener("change", () => {
      const value = wireSelect.value as WireApi;
      provider.wireValue = value;
      provider.wireEdit = { kind: "set", value };
      wireReset.hidden = !wireResetVisible();
      markDirty();
      renderFooter();
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
    // 「还有别的 provider 吗」同样按条件候选判：同 id 的幸存新增算一个（否则会把「还有替代项」
    // 误写成「这是最后一个 provider」，P1-1 r4）。
    const others = draft === null ? [] : replacementCandidates(draft, provider);
    copy.append(element("div", "lumir-set-danger-desc", others.length === 0 ? t(C.dangerLast) : t(C.dangerDesc)));
    const remove = button("lumir-set-btn lumir-set-btn-danger", t(C.dangerButton));
    remove.disabled = locked();
    // 传**草稿下标**而不是 id：同 id 的两条草稿（已保存 + 被拒新增）里，id 会指向前面那条。
    remove.addEventListener("click", () => {
      if (draft === null) return;
      const index = draft.providers.indexOf(provider);
      if (index >= 0) openDelete(index);
    });
    zone.append(copy, remove);
    return zone;
  }

  function renderDeleteForm(): void {
    if (draft === null || draft.remove === null) return;
    const plan = draft.remove;
    const provider = draft.providers[plan.index] ?? null;
    if (provider === null || provider.removed) {
      draft.remove = null;
      renderForm();
      return;
    }
    const candidates = replacementCandidates(draft, provider);
    const wrap = element("div", "lumir-set-delete-card");
    wrap.append(element("div", "lumir-set-form-title", t(C.deleteTitle, { id: provider.id })));
    wrap.append(element("p", "lumir-set-hint", t(C.deleteSub)));

    // 与删除确认的实际动作同源：已保存条目按 id、未落盘新增按持有者身份（P1-2 r3）。
    const refs = deleteReferences(draft, provider);
    if (refs.active) {
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
      const referenced = kind === "session" ? refs.session_naming : refs.attachment_naming;
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

  function openDelete(index: number): void {
    if (draft === null) return;
    const provider = draft.providers[index] ?? null;
    if (provider === null || provider.removed) return;
    const candidates = replacementCandidates(draft, provider);
    draft.remove = {
      index,
      activeAfter: candidates[0] ?? "",
      sessionAfter: "follow",
      attachmentAfter: "follow",
    };
    draft.add = null;
    draft.selection = provider.id;
    draft.focusedIndex = index;
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
        renderNamingRow(kind, row);
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
      automationRows.set(key, { switchEl, badge, restore, targets, note, restart, error: null });
    }
  }

  function defaultFlagValue(key: AutomationKey): boolean {
    if (snapshot === null) return true;
    return snapshot.defaults[FLAG_KEYS[key]];
  }

  function renderNamingRow(kind: NamingKind, row: AutomationRow): void {
    if (draft === null || row.targets === null || row.note === null) return;
    const { targets, note } = row;
    const enabled = draft.automation[kind === "session" ? "session_naming" : "attachment_naming"].value;
    // 未编辑状态直接消费后端 resolved / model_options（P1-2 r1）。
    const model = namingRowModel({ kind, draft, enabled, locked: locked(), snapshot });
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
    // 命名目标的后端错误挂在这一行（最近的入口）；同时是「首错」的可见出口之一（P2-4 r1）。
    // 行是持久 DOM：每次都先撤掉上一次的节点，否则 `errors` 已清零、错误文字还留在屏幕上
    // （P2-4 r2 —— 只在有错时追加、从不在重绘前移除的写法会一直叠旧内容）。
    row.error?.remove();
    row.error = null;
    const rowError =
      kind === "session" ? errors.sessionNaming : errors.attachmentNaming;
    if (rowError !== null) {
      const outlet = element("p", "lumir-set-field-error lumir-set-error-outlet", rowError);
      outlet.tabIndex = -1;
      outlet.dataset.errorOutlet = kind;
      note.after(outlet);
      row.error = outlet;
    }
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
  function selectProvider(providerIndex: number): void {
    if (draft === null || locked()) return;
    const provider = draft.providers[providerIndex];
    if (provider === undefined) return;
    draft.focusedIndex = providerIndex;
    draft.selection = provider.id;
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
    // 冲突未解决时**守住 conflict 模式**：老 revision 的底栏保存仍要禁用，两个动作只留在冲突横幅
    // 里（重新载入 / 仍然保存）。把模式改回 dirty 会让用户拿旧 revision 再撞一次冲突、并把横幅
    // 连同「仍然保存」一起弄丢（P2-4 r3）。
    // 其余情况按草稿真实脏态取：编辑也可能把草稿改回干净态（典型：撤销一条从未落盘的新增），
    // 那时状态行必须回到「没有未保存的修改」（真机场景 250 实测）。
    if (mode !== "saving") {
      mode = mode === "conflict" ? "conflict" : draftIsDirty(draft) ? "dirty" : "clean";
    }
    errors = emptyFieldErrors();
    lastError = null;
    // 清 `errors` 的同时把已上屏的错误出口撤掉：就地编辑（输入框 input）不走整页重绘，光清状态
    // 会把旧错误文字留在持久行里（P2-4 r2）。
    clearErrorOutlets();
    // 通用字段错误 / 保存失败横幅同理：它们只描述上一次保存的结果，编辑即失效（P2-3 r3）。
    // 冲突横幅不会被这条抹掉——上面守住了 conflict 模式，renderBanner 会照 mode 重画它。
    renderBanner();
    renderFooter();
  }

  function clearErrorOutlets(): void {
    for (const row of automationRows.values()) {
      row.error?.remove();
      row.error = null;
    }
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
    // 冲突未解决时普通保存一律拒绝：唯一可写的是横幅里的「仍然保存」（force，用冲突返回的新
    // revision）。否则拿打开时的旧 revision 再存只会再冲突一次，并丢掉已经拿到的「仍然保存」
    // （P2-4 r3）。
    if (mode === "conflict" && !force) return;
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
    // blocked：文件逐字节不变，草稿保留；错误按 path 挂到控件，焦点落第一个错误控件
    // （没有绑到控件的错误 → 落第一个错误出口，P2-4 r1）。
    mode = "blocked";
    errors = mapFieldErrors(outcome.errors);
    if (errors.addId !== null && errors.addIdIndex !== null) {
      applyRejectedAdd(errors.addIdIndex, errors.addId);
    }
    render();
    const invalid = card.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (invalid !== null) invalid.focus();
    else card.querySelector<HTMLElement>(".lumir-set-error-outlet")?.focus();
  }

  /** 新增被后端拒绝（id 重复 / 非法 / 保留 id）：**按 patch 下标**定位那条草稿新增（P1-1 r1），
   *  保留它已经填好的 Key / 模型 / Base URL，把错误挂到它自己的 id 输入上——用户就地改名即可
   *  再存，不必重填。MUST NOT 猜「最后一条新增」或整条丢弃。 */
  function applyRejectedAdd(patchIndex: number, message: string): void {
    if (draft === null) return;
    const { adds } = planProviderEdits(draft);
    const rejected = adds.find((item) => item.index === patchIndex);
    if (rejected === undefined) return;
    const provider = draft.providers[rejected.providerIndex] ?? null;
    if (provider === null) return;
    provider.idError = message;
    draft.add = null;
    draft.focusedIndex = rejected.providerIndex;
    draft.selection = provider.id;
  }

  /** 给「尚未落盘的新增项」改 id：仅这一处允许改 id（落盘后 id 不可变）。引用面（active / 命名
   *  目标）是否跟着改由 `renameDraftProviderId` 按「这条草稿是否该 id 的唯一持有者」判定；这里
   *  只负责清掉回填的错误。 */
  function renameDraftProvider(provider: DraftProvider, raw: string): void {
    if (draft === null) return;
    renameDraftProviderId(draft, provider, raw);
    provider.idError = null;
    errors.addId = null;
    markDirty();
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
  // 「取消」= 关闭（放弃草稿）；不是「恢复已保存配置」。语义与 × / Escape / 点遮罩同一条
  // requestClose：干净直接关、脏先走「放弃未保存的修改？」两步确认、保存中禁用。
  cancelButton.addEventListener("click", () => requestClose());
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
