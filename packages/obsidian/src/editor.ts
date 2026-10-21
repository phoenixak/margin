import type { Suggestion } from '@margin/core';
import { type EditorState, type Extension, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, hoverTooltip, type Tooltip, ViewPlugin, type ViewUpdate } from '@codemirror/view';

/**
 * Margin's suggestions in Obsidian's editor (CodeMirror 6): its own decorations and a
 * hover card, separate from Harper's plugin. CodeMirror maps the stored positions
 * through edits, so underlines stay on the right words until the next check.
 */

export interface EditorHooks {
  /** A view appeared, changed or went away. `key` identifies the note. */
  attach(view: EditorView): void;
  detach(view: EditorView): void;
  changed(view: EditorView): void;
  apply(view: EditorView, s: Suggestion): void;
  ignore(view: EditorView, s: Suggestion): void;
}

interface Stored {
  s: Suggestion;
  from: number;
  to: number;
  before: string;
}

export const setSuggestions = StateEffect.define<Suggestion[]>();

const field = StateField.define<Stored[]>({
  create: () => [],
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setSuggestions)) {
        const doc = tr.state.doc;
        return e.value.map((s) => ({ s, from: s.range.start, to: s.range.end, before: doc.sliceString(s.range.start, s.range.end) }));
      }
    }
    if (!tr.docChanged) return value;
    // Move with the text; drop suggestions whose words were edited.
    return value.flatMap((x) => {
      let touched = false;
      tr.changes.iterChangedRanges((fromA, toA) => {
        if (fromA <= x.to && toA >= x.from) touched = true;
      });
      if (touched) return [];
      return [{ ...x, from: tr.changes.mapPos(x.from, 1), to: tr.changes.mapPos(x.to, -1) }];
    });
  },
  provide: (f) =>
    EditorView.decorations.from(f, (list): DecorationSet => {
      const b = new RangeSetBuilder<Decoration>();
      for (const x of [...list].sort((a, c) => a.from - c.from)) {
        const from = x.from === x.to ? Math.max(0, x.from - 1) : x.from;
        const to = Math.max(x.to, from + 1);
        b.add(from, to, Decoration.mark({ class: 'margin-suggestion' }));
      }
      return b.finish();
    }),
});

export function suggestionsAt(state: EditorState, pos: number): Stored[] {
  return state.field(field, false)?.filter((x) => pos >= Math.max(0, x.from - (x.from === x.to ? 1 : 0)) && pos <= Math.max(x.to, x.from + 1)) ?? [];
}

export function marginEditor(hooks: EditorHooks): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      constructor(readonly view: EditorView) {
        hooks.attach(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged) hooks.changed(u.view);
      }
      destroy() {
        hooks.detach(this.view);
      }
    },
  );

  const tooltip = hoverTooltip((view, pos): Tooltip | null => {
    const [x] = suggestionsAt(view.state, pos);
    if (!x) return null;
    return {
      pos: x.from,
      end: Math.max(x.to, x.from + 1),
      above: true, // Harper's plugin shows its card below
      create: () => {
        const dom = document.createElement('div');
        dom.className = 'margin-card';
        dom.createDiv({ cls: 'margin-card-title', text: 'Margin' });
        const change = dom.createDiv({ cls: 'margin-card-change' });
        if (x.before) change.createEl('del', { text: x.before });
        if (x.before && x.s.replacement) change.appendText(' → ');
        if (x.s.replacement) change.createEl('ins', { text: x.s.replacement });
        if (x.s.why) dom.createDiv({ cls: 'margin-card-why', text: x.s.why });
        const row = dom.createDiv({ cls: 'margin-card-row' });
        row.createEl('button', { text: 'Ignore' }).addEventListener('click', () => hooks.ignore(view, x.s));
        const apply = row.createEl('button', { text: 'Apply', cls: 'mod-cta' });
        apply.addEventListener('click', () => {
          const now = view.state.field(field).find((y) => y.s === x.s);
          if (!now || view.state.doc.sliceString(now.from, now.to) !== now.before) return;
          view.dispatch({ changes: { from: now.from, to: now.to, insert: x.s.replacement } });
          hooks.apply(view, x.s);
        });
        return { dom };
      },
    };
  });

  return [field, plugin, tooltip];
}

/** Removes suggestions from a view (after Apply / Ignore). */
export function removeSuggestions(view: EditorView, keep: (s: Suggestion) => boolean) {
  const list = view.state.field(field, false) ?? [];
  view.dispatch({ effects: setSuggestions.of(list.filter((x) => keep(x.s)).map((x) => ({ ...x.s, range: { start: x.from, end: x.to } }))) });
}
