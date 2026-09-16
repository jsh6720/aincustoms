import * as Y from 'yjs';

export const encode = bytes => {
  let value = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) value += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(value);
};
export const decode = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));

// CRDT updates, not document overwrites. Retry IDs retain their exact payload.
export class SharedDocumentSync {
  constructor({ doc, request, author = () => '', status = () => {}, interval = 1000, uuid = () => crypto.randomUUID(), hidden = () => false }) {
    Object.assign(this, { doc, request, author, status, interval, uuid, hidden });
    this.cursor = 0; this.pending = []; this.queued = []; this.ready = false;
    this.closed = false; this.paused = false; this.timer = null; this.active = null; this.failures = 0;
    this.onUpdate = (update, origin) => {
      if (origin === this || this.closed) return;
      this.queued.push(update);
      this.status({ state: 'saving', pending: this.unsaved, message: '변경사항 저장 중…' });
      this.schedule(250);
    };
    doc.on('update', this.onUpdate);
  }
  get unsaved() { return this.pending.length + this.queued.length; }
  schedule(delay = this.interval) {
    if (this.closed || this.paused || this.interval === 0) return;
    clearTimeout(this.timer);
    if (this.hidden() && !this.unsaved) delay = Math.max(delay, 30000);
    if (this.failures) delay = Math.max(delay, Math.min(30000, 1000 * 2 ** Math.min(this.failures, 5)));
    this.timer = setTimeout(() => this.tick(), delay);
  }
  makeBatch() {
    if (!this.queued.length || this.pending.length) return;
    const batch = []; let size = 0;
    while (this.queued.length && size + this.queued[0].length <= 500000) {
      const next = this.queued.shift(); batch.push(next); size += next.length;
    }
    if (!batch.length) throw new Error('입력한 내용이 너무 큽니다. 복구용 백업을 내려받고 작은 단위로 나눠 입력해 주세요.');
    this.pending.push({ op_id: this.uuid(), update: encode(Y.mergeUpdates(batch)), author: this.author() });
  }
  async pull() {
    let more;
    do {
      const page = await this.request('sync', { after: this.cursor });
      if (this.closed) return;
      if (!Array.isArray(page.updates) || !Number.isSafeInteger(page.cursor) || page.cursor < this.cursor) throw new Error('동기화 응답을 확인할 수 없습니다.');
      let next = this.cursor;
      for (const item of page.updates) {
        if (item.seq !== next + 1) throw new Error('문서 변경 이력에 빈 구간이 있습니다.');
        Y.applyUpdate(this.doc, decode(item.update), this);
        next = item.seq;
      }
      if (next !== page.cursor || (page.hasMore && next === this.cursor)) throw new Error('문서 동기화 위치가 일치하지 않습니다.');
      this.cursor = next;
      more = page.hasMore === true;
    } while (more && !this.closed);
    this.ready = !this.closed;
  }
  tick() {
    if (this.closed) return Promise.resolve(false);
    if (this.active) return this.active;
    clearTimeout(this.timer);
    this.active = this.cycle().finally(() => { this.active = null; this.schedule(); });
    return this.active;
  }
  async cycle() {
    try {
      if (!this.ready) await this.pull();
      for (let sent = 0; !this.closed && this.unsaved && sent < 4; sent++) {
        this.makeBatch();
        const reply = await this.request('append', this.pending[0]);
        if (!Number.isSafeInteger(reply.seq) || reply.seq < 1) throw new Error('저장 확인 응답이 없습니다. 다시 시도합니다.');
        this.pending.shift();
      }
      if (!this.closed) await this.pull();
      this.failures = 0;
      if (!this.closed) this.status({ state: this.unsaved ? 'saving' : 'saved', pending: this.unsaved, message: this.unsaved ? '변경사항 저장 중…' : '모든 변경사항 저장됨 · 약 1초 간격 동기화' });
      return !this.closed;
    } catch (error) {
      this.failures++;
      if (error.status === 401) this.paused = true;
      if (!this.closed) this.status({ state: error.status === 401 ? 'locked' : 'error', pending: this.unsaved, message: error.message || '연결이 끊겼습니다. 저장되지 않은 내용은 이 화면에 유지됩니다.' });
      return false;
    }
  }
  resume() { this.paused = false; return this.tick(); }
  close() { this.closed = true; clearTimeout(this.timer); this.doc.off('update', this.onUpdate); }
}
