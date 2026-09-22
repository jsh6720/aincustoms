import * as Y from 'yjs';
import { imageMarkdown, normalizeImageUrl } from './images.mjs';

const utf8 = new TextEncoder();
// Keep insertion anchored to the original CRDT location during upload.
// Image bytes never enter shared text or its encrypted snapshot.
export function createImagePasteController({ context, prepare, upload, status = () => {}, inserted = () => {} }) {
  let active = null;
  function current(task) {
    const now = context();
    return active === task && !task.abort.signal.aborted && now.canEdit &&
      now.doc === task.target.doc && now.text === task.target.text &&
      now.noteId === task.target.noteId && now.epoch === task.target.epoch;
  }
  function cancel(message = '') {
    const previous = active; active = null; previous?.abort.abort();
    status(message, message ? 'error' : 'idle');
  }
  return {
    get busy() { return active !== null; },
    cancel,
    async paste(file, position) {
      if (active) { status('현재 이미지 저장이 끝난 뒤 다음 이미지를 붙여넣어 주세요.', 'busy'); return false; }
      const target = { ...context() };
      if (!target.canEdit || !target.doc || !target.text) { status('최신 문서를 불러온 뒤 이미지를 붙여넣어 주세요.', 'error'); return false; }
      const index = Math.max(0, Math.min(Number.isSafeInteger(position) ? position : target.text.length, target.text.length));
      const task = { target, abort: new AbortController(), anchor: Y.createRelativePositionFromTypeIndex(target.text, index, -1) };
      active = task; status('이미지를 준비하고 저장하는 중입니다…', 'busy');
      try {
        const data = await prepare(file);
        if (!current(task)) { if (active === task) status('접속 상태나 노트가 변경되어 이미지 붙여넣기를 취소했습니다.', 'error'); return false; }
        const result = await upload(data, task.abort.signal);
        if (!current(task)) { if (active === task) status('접속 상태나 노트가 변경되어 이미지 붙여넣기를 취소했습니다.', 'error'); return false; }
        const marker = imageMarkdown(result.id);
        if (!marker || normalizeImageUrl(result.url) !== `/api/internal-share?action=image&id=${result.id}`) throw new Error('이미지 저장 결과를 확인할 수 없습니다. 다시 붙여넣어 주세요.');
        const anchor = Y.createAbsolutePositionFromRelativePosition(task.anchor, target.doc);
        if (!anchor || anchor.type !== target.text) throw new Error('붙여넣을 위치가 변경되었습니다. 다시 붙여넣어 주세요.');
        const value = `\n\n${marker}\n\n`;
        if (utf8.encode(target.text.toString()).length + utf8.encode(value).length > 250000) throw new Error('노트 본문 용량이 가득 찼습니다. 새 노트에 이미지를 붙여넣어 주세요.');
        target.doc.transact(() => target.text.insert(anchor.index, value));
        inserted(anchor.index + value.length);
        status('이미지를 첨부했습니다. 본문 저장 상태를 확인해 주세요.', 'saved');
        return true;
      } catch (error) {
        if (active === task && !task.abort.signal.aborted) status(error.message || '이미지를 저장하지 못했습니다. 다시 붙여넣어 주세요.', 'error');
        return false;
      } finally { if (active === task) active = null; }
    },
  };
}
