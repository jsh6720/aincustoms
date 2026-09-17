import { EditorSelection, StateEffect, StateField, Text } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import { SearchQuery } from '@codemirror/search';

const changeQuery = StateEffect.define();
const resultListeners = new WeakMap();
const matchMark = Decoration.mark({ class: 'cm-documentSearchMatch' });
const currentMark = Decoration.mark({ class: 'cm-documentSearchMatch cm-documentSearchMatch-current' });

/** Literal, case-insensitive, non-overlapping matches with CodeMirror offsets. */
export function findDocumentMatches(document, query) {
  if (!query) return [];
  const text = typeof document === 'string' ? Text.of(document.split('\n')) : document;
  const cursor = new SearchQuery({ search: query, literal: true, regexp: false, caseSensitive: false })
    .getCursor(text);
  const ranges = [];
  for (let result = cursor.next(); !result.done; result = cursor.next()) {
    ranges.push({ from: result.value.from, to: result.value.to });
  }
  return ranges;
}

/** Choose a match around the current selection, wrapping at either end. */
export function nextDocumentMatchIndex(ranges, selection, direction = 1) {
  if (!ranges.length) return -1;
  const current = ranges.findIndex(range => range.from === selection.from && range.to === selection.to);
  if (current !== -1) return (current + (direction < 0 ? ranges.length - 1 : 1)) % ranges.length;
  if (direction < 0) {
    for (let index = ranges.length - 1; index >= 0; index--) {
      if (ranges[index].to <= selection.from) return index;
    }
    return ranges.length - 1;
  }
  const next = ranges.findIndex(range => range.from >= selection.to);
  return next === -1 ? 0 : next;
}

function stateValue(query, ranges, selection) {
  const current = ranges.findIndex(range => range.from === selection.from && range.to === selection.to);
  const decorations = Decoration.set(ranges.map((range, index) =>
    (index === current ? currentMark : matchMark).range(range.from, range.to)));
  return { query, ranges, current: current + 1, decorations };
}

const searchState = StateField.define({
  create: state => stateValue('', [], state.selection.main),
  update(value, transaction) {
    let query = value.query;
    for (const effect of transaction.effects) if (effect.is(changeQuery)) query = effect.value;
    const queryChanged = query !== value.query;
    if (!queryChanged && !transaction.docChanged && !transaction.selection) return value;
    const ranges = queryChanged || transaction.docChanged
      ? findDocumentMatches(transaction.newDoc, query) : value.ranges;
    return stateValue(query, ranges, transaction.newSelection.main);
  },
  provide: field => EditorView.decorations.from(field, value => value.decorations),
});

/** Install once in the EditorState extensions of each note's EditorView. */
export const documentSearchExtension = [
  searchState,
  EditorView.baseTheme({
    '.cm-documentSearchMatch': { backgroundColor: '#fde68a66', borderRadius: '2px' },
    '.cm-documentSearchMatch-current': { backgroundColor: '#fb923c80', outline: '1px solid #c2410c' },
  }),
  EditorView.updateListener.of(update => {
    if (update.startState.field(searchState) !== update.state.field(searchState)) {
      resultListeners.get(update.view)?.();
    }
  }),
];

/**
 * onResult receives {query, count, current, ranges}; current is one-based or zero.
 * Query changes jump to their first match. Document changes only recalculate the
 * state above, preserving CodeMirror's mapped selection and external input focus.
 */
export function createDocumentSearchController(view, onResult = () => {}) {
  if (!view.state.field(searchState, false)) throw new Error('Install documentSearchExtension before creating its controller');
  if (resultListeners.has(view)) throw new Error('This editor already has a document search controller');
  let destroyed = false;
  const getResult = () => {
    const { query, ranges, current } = view.state.field(searchState);
    return { query, count: ranges.length, current, ranges: ranges.map(range => ({ ...range })) };
  };
  const notify = () => onResult(getResult());
  resultListeners.set(view, notify);
  notify();

  function selectRange(range, effects = []) {
    const selection = EditorSelection.single(range.from, range.to);
    view.dispatch({ selection, effects: [...effects, EditorView.scrollIntoView(selection.main, { y: 'center' })],
      userEvent: 'select.search' });
  }
  function setQuery(query) {
    if (destroyed) return getResult();
    query = String(query ?? '');
    if (query === view.state.field(searchState).query) return getResult();
    const effects = [changeQuery.of(query)];
    const ranges = findDocumentMatches(view.state.doc, query);
    if (ranges.length) selectRange(ranges[0], effects);
    else view.dispatch({ effects });
    return getResult();
  }
  function move(direction) {
    if (destroyed) return false;
    const { ranges } = view.state.field(searchState);
    const index = nextDocumentMatchIndex(ranges, view.state.selection.main, direction);
    if (index < 0) return false;
    selectRange(ranges[index]);
    return true;
  }
  return {
    setQuery,
    next: () => move(1),
    previous: () => move(-1),
    clear: () => setQuery(''),
    getResult,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      resultListeners.delete(view);
    },
  };
}
