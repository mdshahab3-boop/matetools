// MateTools front end — talks to the FastAPI backend, downloads the result,
// and never keeps anything client-side.

const TOOLS = [
  {
    id: "pdf-to-word", icon: "📄", title: "PDF to Word",
    desc: "Turn a PDF into an editable Word (.docx) document.",
    endpoint: "/api/pdf-to-word", accept: ".pdf", multiple: false,
    hint: "One PDF file",
  },
  {
    id: "office-to-pdf", icon: "📑", title: "Office to PDF",
    desc: "Word, Excel or PowerPoint → polished PDF.",
    endpoint: "/api/office-to-pdf", multiple: false,
    accept: ".doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.rtf,.txt,.csv",
    hint: "Word, Excel, PowerPoint, OpenDocument, RTF, TXT, CSV",
  },
  {
    id: "merge", icon: "🧩", title: "Merge PDFs",
    desc: "Combine several PDFs into one, in the order you add them.",
    endpoint: "/api/merge", accept: ".pdf", multiple: true,
    hint: "Two or more PDF files",
  },
  {
    id: "split", icon: "✂️", title: "Split PDF",
    desc: "Extract a page range, or split every page into its own file.",
    endpoint: "/api/split", accept: ".pdf", multiple: false,
    hint: "One PDF file",
    options: [
      { name: "ranges", label: "Pages to extract (optional)", type: "text",
        placeholder: "e.g. 1-3,5,8 — leave blank to split every page",
        note: "Blank = every page becomes a separate PDF (returned as a .zip)." },
    ],
  },
  {
    id: "compress", icon: "🗜️", title: "Compress PDF",
    desc: "Shrink a PDF's file size for easy sharing.",
    endpoint: "/api/compress", accept: ".pdf", multiple: false,
    hint: "One PDF file",
    options: [
      { name: "level", label: "Compression level", type: "select",
        choices: [
          ["ebook", "Recommended — good quality, smaller"],
          ["screen", "Smallest — lower quality"],
          ["printer", "High quality — larger"],
          ["prepress", "Maximum quality — largest"],
        ] },
    ],
  },
  {
    id: "images-to-pdf", icon: "🖼️", title: "Images to PDF",
    desc: "Combine JPG or PNG images into a single PDF.",
    endpoint: "/api/images-to-pdf", accept: "image/*", multiple: true,
    hint: "One or more images",
  },
  {
    id: "pdf-to-images", icon: "🏞️", title: "PDF to Images",
    desc: "Render each PDF page as a PNG image (returned as a .zip).",
    endpoint: "/api/pdf-to-images", accept: ".pdf", multiple: false,
    hint: "One PDF file",
    options: [
      { name: "dpi", label: "Resolution (DPI)", type: "select",
        choices: [["150", "150 — web / screen"], ["300", "300 — print"], ["72", "72 — small"]] },
    ],
  },
];

let active = null;      // current tool
let files = [];         // selected File objects

const $ = (s) => document.querySelector(s);
const grid = $("#tool-grid");
const overlay = $("#panel-overlay");

// Build the tool grid.
TOOLS.forEach((t) => {
  const card = document.createElement("button");
  card.className = "tool-card";
  card.innerHTML = `
    <div class="tc-icon">${t.icon}</div>
    <h3>${t.title}</h3>
    <p>${t.desc}</p>`;
  card.addEventListener("click", () => openTool(t));
  grid.appendChild(card);
});

function openTool(t) {
  active = t;
  files = [];
  $("#panel-icon").textContent = t.icon;
  $("#panel-title").textContent = t.title;
  $("#panel-desc").textContent = t.desc;
  $("#dz-hint").textContent = t.hint || "";
  const input = $("#file-input");
  input.value = "";
  input.accept = t.accept || "";
  input.multiple = !!t.multiple;

  // Options
  const optWrap = $("#options");
  optWrap.innerHTML = "";
  (t.options || []).forEach((o) => {
    const field = document.createElement("div");
    let control = "";
    if (o.type === "select") {
      control = `<select data-opt="${o.name}">${o.choices
        .map((c) => `<option value="${c[0]}">${c[1]}</option>`)
        .join("")}</select>`;
    } else {
      control = `<input type="text" data-opt="${o.name}" placeholder="${o.placeholder || ""}" />`;
    }
    field.innerHTML = `<label>${o.label}</label>${control}${
      o.note ? `<div class="opt-note">${o.note}</div>` : ""
    }`;
    optWrap.appendChild(field);
  });

  resetStatus();
  renderFiles();
  overlay.hidden = false;
}

function closeTool() {
  overlay.hidden = true;
  active = null;
  files = [];
}

$("#panel-close").addEventListener("click", closeTool);
overlay.addEventListener("click", (e) => { if (e.target === overlay) closeTool(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeTool(); });

// File selection
const input = $("#file-input");
const dz = $("#dropzone");
input.addEventListener("change", () => addFiles(input.files));
dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("drag"); });
dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
dz.addEventListener("drop", (e) => {
  e.preventDefault();
  dz.classList.remove("drag");
  addFiles(e.dataTransfer.files);
});

function addFiles(list) {
  const incoming = Array.from(list);
  if (!active) return;
  files = active.multiple ? files.concat(incoming) : incoming.slice(0, 1);
  renderFiles();
}

function renderFiles() {
  const ul = $("#file-list");
  ul.innerHTML = "";
  files.forEach((f, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${f.name} <span style="color:#94a3b8">(${fmtSize(f.size)})</span></span>`;
    const rm = document.createElement("button");
    rm.className = "rm";
    rm.textContent = "Remove";
    rm.addEventListener("click", () => { files.splice(i, 1); renderFiles(); });
    li.appendChild(rm);
    ul.appendChild(li);
  });
  $("#run-btn").disabled = files.length === 0;
}

function fmtSize(b) {
  if (b < 1024) return b + " B";
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + " KB";
  return (b / 1024 / 1024).toFixed(1) + " MB";
}

function resetStatus() {
  const s = $("#status");
  s.hidden = true;
  s.className = "status";
  s.textContent = "";
  $("#run-btn").textContent = "Convert";
}

function setStatus(kind, html) {
  const s = $("#status");
  s.hidden = false;
  s.className = "status " + kind;
  s.innerHTML = html;
}

// Run the conversion
$("#run-btn").addEventListener("click", run);

async function run() {
  if (!active || files.length === 0) return;
  const btn = $("#run-btn");
  btn.disabled = true;
  btn.textContent = "Working…";
  setStatus("working", `<span class="spinner"></span>Processing your file — this stays private.`);

  const fd = new FormData();
  const key = active.multiple ? "files" : "file";
  files.forEach((f) => fd.append(key, f));
  document.querySelectorAll("#options [data-opt]").forEach((el) => {
    fd.append(el.dataset.opt, el.value);
  });

  try {
    const res = await fetch(active.endpoint, { method: "POST", body: fd });
    if (!res.ok) {
      let msg = `Something went wrong (HTTP ${res.status}).`;
      try { const j = await res.json(); if (j.detail || j.error) msg = j.detail || j.error; } catch (_) {}
      setStatus("err", "⚠️ " + msg);
      btn.disabled = false;
      btn.textContent = "Try again";
      return;
    }
    const blob = await res.blob();
    const name = filenameFrom(res.headers.get("Content-Disposition")) || "matetools-output";
    triggerDownload(blob, name);
    setStatus("ok", `✅ Done! Your download “${name}” has started. Nothing was stored.`);
    btn.disabled = false;
    btn.textContent = "Convert another";
  } catch (err) {
    setStatus("err", "⚠️ Network error. Please try again.");
    btn.disabled = false;
    btn.textContent = "Try again";
  }
}

function filenameFrom(header) {
  if (!header) return null;
  const m = /filename="?([^"]+)"?/.exec(header);
  return m ? m[1] : null;
}

function triggerDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
