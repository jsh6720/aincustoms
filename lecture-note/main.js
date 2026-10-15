// Bundle: npx esbuild lecture-note/main.js --bundle --minify --format=esm --outfile=lecture-note/app.js
import { marked } from "marked";
import DOMPurify from "dompurify";

const API = "/api/lecture-note";
const $ = id => document.getElementById(id);
let state = { notes: [], updatedAt: null, role: "viewer", csrf: "" };
let current = 0, editing = false, dirty = false;

async function api(body) {
  const response = await fetch(API, body ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  } : { cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "요청에 실패했습니다.");
  return data;
}

function status(text) { $("status").textContent = text; }

function renderList() {
  $("note-list").replaceChildren(...state.notes.map((note, index) => {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = note.title;
    button.className = index === current ? "active" : "";
    button.onclick = () => select(index);
    li.append(button);
    return li;
  }));
}

function renderNote() {
  const note = state.notes[current];
  const editor = state.role === "editor";
  $("title").value = note ? note.title : "";
  $("title").readOnly = !editing;
  $("editor").hidden = !editing;
  $("editor").value = note ? note.body : "";
  $("edit").hidden = !editor || !note;
  $("edit").textContent = editing ? "미리보기" : "편집";
  $("save").hidden = !editor;
  $("delete").hidden = !editor || !note;
  $("view").hidden = editing;
  $("view").innerHTML = note ? DOMPurify.sanitize(marked.parse(note.body)) : "<p class=\"empty\">노트가 없습니다.</p>";
  $("view").querySelectorAll("a[href^='http']").forEach(a => { a.target = "_blank"; a.rel = "noopener noreferrer"; });
}

function select(index) {
  current = index;
  renderList();
  renderNote();
  $("view").scrollTop = 0;
}

function syncEditor() {
  const note = state.notes[current];
  if (!note || !editing) return;
  note.title = $("title").value.trim() || "제목 없음";
  note.body = $("editor").value;
}

async function save() {
  syncEditor();
  status("저장 중…");
  try {
    const result = await api({ action: "save", csrf: state.csrf, baseUpdatedAt: state.updatedAt, notes: state.notes });
    state.updatedAt = result.updatedAt;
    dirty = false;
    status("저장됨");
    renderList();
  } catch (error) { status(error.message); }
}

async function load() {
  const data = await api();
  $("login").hidden = data.authenticated;
  $("app").hidden = !data.authenticated;
  if (!data.authenticated) return;
  state = data;
  $("who").textContent = `${data.user} · ${data.role === "editor" ? "작성/수정" : "열람"}`;
  $("add-note").hidden = data.role !== "editor";
  current = Math.min(current, Math.max(0, state.notes.length - 1));
  select(current);
}

$("login-form").onsubmit = async event => {
  event.preventDefault();
  $("login-error").hidden = true;
  try {
    await api({ action: "login", id: $("login-id").value.trim(), password: $("login-password").value });
    $("login-password").value = "";
    await load();
  } catch (error) {
    $("login-error").textContent = error.message;
    $("login-error").hidden = false;
  }
};
$("logout").onclick = async () => { await api({ action: "logout" }).catch(() => {}); location.reload(); };
$("copy").onclick = async () => {
  const note = state.notes[current];
  if (!note) return;
  syncEditor();
  try { await navigator.clipboard.writeText(note.body); status("본문을 복사했습니다"); }
  catch { status("복사하지 못했습니다. 본문을 드래그해서 복사해 주세요."); }
};
$("edit").onclick = () => { syncEditor(); editing = !editing; renderNote(); renderList(); };
$("save").onclick = save;
$("delete").onclick = () => {
  if (!confirm(`"${state.notes[current].title}" 노트를 삭제할까요? 저장을 눌러야 반영됩니다.`)) return;
  state.notes.splice(current, 1);
  dirty = true;
  status("삭제됨 · 저장 필요");
  select(Math.max(0, current - 1));
};
$("add-note").onclick = () => {
  syncEditor();
  state.notes.push({ id: crypto.randomUUID(), title: "새 노트", body: "" });
  editing = true;
  dirty = true;
  select(state.notes.length - 1);
  $("title").select();
};
$("editor").oninput = $("title").oninput = () => { dirty = true; status("저장 필요"); };
document.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key === "s" && state.role === "editor") { event.preventDefault(); save(); }
});
window.addEventListener("beforeunload", event => { if (dirty) event.preventDefault(); });

load().catch(error => { $("login").hidden = false; $("login-error").textContent = error.message; $("login-error").hidden = false; });
