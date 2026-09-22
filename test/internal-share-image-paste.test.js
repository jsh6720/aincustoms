const test = require('node:test');
const assert = require('node:assert/strict');
const yModule = import('yjs');
const ID = 'a'.repeat(64);
const reply = { id: ID, url: `/api/internal-share?action=image&id=${ID}`, mime: 'image/png' };
const modulePromise = import('../internal/image-paste.mjs');
function deferred() { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes; reject=no; }); return {promise,resolve,reject}; }
async function setup(overrides = {}) {
  const {createImagePasteController} = await modulePromise;
  const Y = await yModule;
  const doc = new Y.Doc(), text = doc.getText('body'); text.insert(0,'ABCD');
  const state = {doc,text,noteId:'team',epoch:1,canEdit:true}, messages=[];
  const controller = createImagePasteController({context:()=>state,prepare:async()=>({data:'synthetic-not-stored-in-text'}),upload:async()=>reply,status:(message,kind)=>messages.push({message,kind}),...overrides});
  return {doc,text,state,messages,controller};
}
test('image paste inserts only the authenticated image reference and preserves existing text', async()=>{
  const s=await setup(); assert.equal(await s.controller.paste({},2),true);
  assert.match(s.text.toString(),/^AB\n\n!\[.*\]\(\/api\/internal-share\?action=image&id=[a-f0-9]{64}\)\n\nCD$/);
  assert.doesNotMatch(s.text.toString(),/synthetic-not-stored|base64/); assert.equal(s.controller.busy,false); s.doc.destroy();
});
test('concurrent text changes during upload retain the intended relative insertion location', async()=>{
  const gate=deferred(), s=await setup({upload:()=>gate.promise}); const pending=s.controller.paste({},2);
  await Promise.resolve(); s.text.insert(0,'원격'); gate.resolve(reply); assert.equal(await pending,true);
  assert.match(s.text.toString(),/^원격AB\n\n!/); assert.ok(s.text.toString().endsWith('\n\nCD')); s.doc.destroy();
});
test('preparation and upload errors never replace or clear existing note content', async()=>{
  for(const overrides of [{prepare:async()=>{throw new Error('unsupported');}},{upload:async()=>{throw new Error('upload unavailable');}}]){
    const s=await setup(overrides); assert.equal(await s.controller.paste({},0),false); assert.equal(s.text.toString(),'ABCD');
    assert.equal(s.messages.at(-1).kind,'error'); assert.equal(s.controller.busy,false); s.doc.destroy();
  }
});
test('read-only state cannot prepare or upload any image', async()=>{
  const s=await setup({prepare:()=>assert.fail('no prepare'),upload:()=>assert.fail('no upload')}); s.state.canEdit=false;
  assert.equal(await s.controller.paste({},0),false); assert.equal(s.text.toString(),'ABCD'); s.doc.destroy();
});
test('switching notes, closing documents, or renewing session during upload never inserts into another context', async()=>{
  for(const change of [s=>s.state.noteId='other',s=>s.state.epoch++,s=>s.state.canEdit=false,s=>s.state.doc=new s.doc.constructor()]){
    const gate=deferred(), s=await setup({upload:()=>gate.promise}); const pending=s.controller.paste({},2); await Promise.resolve();
    change(s); gate.resolve(reply); assert.equal(await pending,false); assert.equal(s.text.toString(),'ABCD');
    if(s.doc!==s.state.doc)s.state.doc.destroy(); s.doc.destroy();
  }
});
test('cancel aborts upload and a late response cannot change content or overwrite a newer status', async()=>{
  const gate=deferred(); let signal; const s=await setup({upload:(_data,passed)=>{signal=passed;return gate.promise;}});
  const pending=s.controller.paste({},1); await Promise.resolve(); s.controller.cancel('노트 변경으로 취소');
  assert.equal(signal.aborted,true); assert.equal(s.controller.busy,false); gate.resolve(reply);
  assert.equal(await pending,false); assert.equal(s.text.toString(),'ABCD'); assert.equal(s.messages.at(-1).message,'노트 변경으로 취소'); s.doc.destroy();
});
test('invalid image references and external response URLs are rejected without editing', async()=>{
  for(const response of [{id:'../other',url:'/api/internal-share?action=image&id=../other'},{...reply,url:'https://external.test/pixel'},{...reply,id:'b'.repeat(64)}]){
    const s=await setup({upload:async()=>response}); assert.equal(await s.controller.paste({},0),false); assert.equal(s.text.toString(),'ABCD'); s.doc.destroy();
  }
});
test('only one paste runs at a time and the note text byte limit remains enforced',async()=>{
  const gate=deferred();let prepared=0;const s=await setup({prepare:async()=>{prepared++;return {data:'x'};},upload:()=>gate.promise});
  const pending=s.controller.paste({},0);assert.equal(await s.controller.paste({},0),false);assert.equal(prepared,1);
  s.text.insert(0,'x'.repeat(249990));gate.resolve(reply);assert.equal(await pending,false);assert.equal(s.text.length,249994);s.doc.destroy();
});
