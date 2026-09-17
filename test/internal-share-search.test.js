const test = require('node:test');
const assert = require('node:assert/strict');
const modules = Promise.all([
  import('../internal/document-search.mjs'), import('@codemirror/state'), import('@codemirror/view'),
]);

async function harness(doc, selection = 0) {
  const [search, { EditorState }, { EditorView }] = await modules;
  const results = [], dispatches = [];
  const view = {
    state: EditorState.create({ doc, selection: { anchor: selection }, extensions: [search.documentSearchExtension] }),
    focus() { throw new Error('Search must retain external input focus'); },
    dispatch(spec) {
      dispatches.push(spec);
      const transaction = this.state.update(spec);
      const startState = this.state;
      this.state = transaction.state;
      for (const listener of this.state.facet(EditorView.updateListener)) {
        listener({ view: this, startState, state: this.state, transactions: [transaction],
          docChanged: transaction.docChanged, selectionSet: !!transaction.selection });
      }
    },
  };
  const controller = search.createDocumentSearchController(view, result => results.push(result));
  function highlights() {
    const ranges = [];
    for (const decoration of view.state.facet(EditorView.decorations)) {
      decoration.between(0, view.state.doc.length, (from, to, mark) => ranges.push({ from, to, class: mark.spec.class }));
    }
    return ranges;
  }
  return { search, view, controller, results, dispatches, highlights };
}

test('literal search supports Korean, case folding, regex symbols and backslashes', async () => {
  const [{ findDocumentMatches }] = await modules;
  assert.deepEqual(findDocumentMatches('통관 검색 / 통관', '통관'), [{ from: 0, to: 2 }, { from: 8, to: 10 }]);
  assert.deepEqual(findDocumentMatches('Alpha alpha ALPHA', 'aLpHa'), [
    { from: 0, to: 5 }, { from: 6, to: 11 }, { from: 12, to: 17 },
  ]);
  assert.deepEqual(findDocumentMatches('a.b axb a.b', 'a.b'), [{ from: 0, to: 3 }, { from: 8, to: 11 }]);
  assert.deepEqual(findDocumentMatches('[a]+ (a) [a]+', '[a]+'), [{ from: 0, to: 4 }, { from: 9, to: 13 }]);
  assert.deepEqual(findDocumentMatches('a\\nb\na\\nb', '\\n'), [{ from: 1, to: 3 }, { from: 6, to: 8 }]);
  assert.deepEqual(findDocumentMatches('abc', ''), []);
  assert.deepEqual(findDocumentMatches('abc', '없는 단어'), []);
});

test('a changed query immediately selects and scrolls to the first match while highlighting all matches', async () => {
  const { view, controller, dispatches, highlights } = await harness('검색 첫째 / 검색 둘째', 13);
  assert.deepEqual(controller.setQuery('검색'), {
    query: '검색', count: 2, current: 1, ranges: [{ from: 0, to: 2 }, { from: 8, to: 10 }],
  });
  assert.equal(view.state.selection.main.from, 0);
  assert.equal(view.state.selection.main.to, 2);
  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].effects.length, 2, 'query effect and scroll effect share one transaction');
  assert.deepEqual(highlights(), [
    { from: 0, to: 2, class: 'cm-documentSearchMatch cm-documentSearchMatch-current' },
    { from: 8, to: 10, class: 'cm-documentSearchMatch' },
  ]);
  controller.next();
  controller.setQuery('검색');
  assert.equal(controller.getResult().current, 2, 'unchanged queries do not jump back');
  assert.equal(dispatches.length, 2);
});

test('next and previous wrap in both directions without focusing the editor', async () => {
  const { controller, view } = await harness('one ONE one');
  controller.setQuery('one');
  for (const expected of [2, 3, 1]) {
    assert.equal(controller.next(), true);
    assert.equal(controller.getResult().current, expected);
  }
  for (const expected of [3, 2, 1]) {
    assert.equal(controller.previous(), true);
    assert.equal(controller.getResult().current, expected);
  }
  view.dispatch({ selection: { anchor: 3 } });
  assert.equal(controller.getResult().current, 0);
  controller.next();
  assert.equal(controller.getResult().current, 2);
  view.dispatch({ selection: { anchor: 3 } });
  controller.previous();
  assert.equal(controller.getResult().current, 1);
});

test('remote document changes recalculate ranges and counts without an extra selection transaction', async () => {
  const { controller, view, dispatches, results, highlights } = await harness('통관 / 통관');
  controller.setQuery('통관');
  view.dispatch({ selection: { anchor: 4 } });
  const before = dispatches.length;
  view.dispatch({ changes: { from: 0, insert: '통관 ' } });
  assert.equal(dispatches.length, before + 1, 'the search listener never dispatches a cursor jump');
  assert.equal(view.state.selection.main.anchor, 7, 'the typing cursor only moves with the inserted text');
  assert.equal(view.state.selection.main.empty, true);
  assert.deepEqual(results.at(-1), { query: '통관', count: 3, current: 0,
    ranges: [{ from: 0, to: 2 }, { from: 3, to: 5 }, { from: 8, to: 10 }] });
  assert.equal(highlights().length, 3);
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '다른 내용' } });
  assert.equal(controller.getResult().count, 0);
  assert.equal(highlights().length, 0);
});

test('no results and clear preserve selection, remove highlights and disable navigation', async () => {
  const { controller, view, highlights, dispatches } = await harness('문서 본문 문서');
  controller.setQuery('문서');
  controller.next();
  const previousSelection = view.state.selection.main;
  assert.equal(controller.setQuery('없는 단어').count, 0);
  assert.ok(view.state.selection.main.eq(previousSelection));
  assert.equal(highlights().length, 0);
  const before = dispatches.length;
  assert.equal(controller.next(), false);
  assert.equal(controller.previous(), false);
  assert.equal(dispatches.length, before);
  controller.setQuery('문서');
  const matchSelection = view.state.selection.main;
  assert.deepEqual(controller.clear(), { query: '', count: 0, current: 0, ranges: [] });
  assert.ok(view.state.selection.main.eq(matchSelection));
  assert.equal(highlights().length, 0);
});

test('result snapshots cannot mutate editor state and destroying detaches result updates', async () => {
  const { controller, view, results, search } = await harness('same same');
  controller.setQuery('same');
  const snapshot = controller.getResult();
  snapshot.ranges[0].from = 100;
  snapshot.ranges.pop();
  assert.equal(controller.getResult().count, 2);
  assert.equal(controller.getResult().ranges[0].from, 0);
  assert.throws(() => search.createDocumentSearchController(view), /already has/);
  controller.destroy();
  const notifications = results.length;
  view.dispatch({ changes: { from: 0, insert: 'same ' } });
  assert.equal(results.length, notifications);
  assert.equal(controller.next(), false);
  const replacementResults = [];
  const replacement = search.createDocumentSearchController(view, result => replacementResults.push(result));
  controller.destroy();
  replacement.next();
  assert.equal(replacementResults.length, 2, 'repeated cleanup cannot detach a replacement controller');
  replacement.destroy();
});
