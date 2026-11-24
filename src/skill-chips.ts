import { RangeSetBuilder, StateEffect } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, PluginValue, ViewUpdate } from "@codemirror/view";
import { composerSkillsField } from "./harness-composer";
import type { SkillSummary } from "./bindings/SkillSummary";

export const skillCatalogRefreshEffect = StateEffect.define<null>();

export interface SkillChipLabels {
  missing: string;
  userDisabled: string;
  invalid: string;
}

function decorations(
  view: EditorView,
  catalog: readonly SkillSummary[] | null,
  labels: SkillChipLabels,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const refs = [...view.state.field(composerSkillsField)].sort((a, b) => a.from - b.from);
  for (const ref of refs) {
    const to = ref.from + ref.name.length + 1;
    if (!view.visibleRanges.some((range) => ref.from < range.to && to > range.from)) continue;
    const item = catalog?.find((candidate) => candidate.name === ref.name);
    let className = "lumir-hp-skill-ref";
    let title: string | undefined;
    if (catalog !== null) {
      if (item === undefined) {
        className += " is-missing";
        title = labels.missing;
      } else if (!item.invocation_valid) {
        className += " is-disabled";
        title = labels.invalid;
      } else if (!item.user_invocable) {
        className += " is-disabled";
        title = labels.userDisabled;
      }
    }
    builder.add(ref.from, to, Decoration.mark({
      class: className,
      attributes: title === undefined ? {} : { title },
    }));
  }
  return builder.finish();
}

export function skillChips(
  getCatalog: () => readonly SkillSummary[] | null,
  labels: SkillChipLabels,
) {
  return ViewPlugin.fromClass(class implements PluginValue {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = decorations(view, getCatalog(), labels);
    }

    update(update: ViewUpdate) {
      const refsChanged = update.startState.field(composerSkillsField)
        !== update.state.field(composerSkillsField);
      const refresh = update.transactions.some((tr) =>
        tr.effects.some((effect) => effect.is(skillCatalogRefreshEffect)));
      if (update.docChanged || update.viewportChanged || refsChanged || refresh) {
        this.decorations = decorations(update.view, getCatalog(), labels);
      }
    }
  }, { decorations: (plugin) => plugin.decorations });
}
