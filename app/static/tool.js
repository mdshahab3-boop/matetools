// MateTools inline converter widget. Reads config from #tool-widget and wires
// up the right flow (file upload, or text input for generators like QR).
// Nothing is kept client-side.
(function () {
  const root = document.getElementById("tool-widget");
  if (!root) return;
  const cfg = JSON.parse(root.dataset.config);
  const maxMb = parseInt(root.dataset.maxMb || "100", 10);
  const mode = cfg.mode || "upload";
  let files = [];

  const optionsHtml = (cfg.options || []).map((o) => {
    let control;
    if (o.type === "select") {
      control = `<select data-opt="${o.name}">${o.choices
        .map((c) => `<option value="${c[0]}">${c[1]}</option>`).join("")}</select>`;
    } else if (o.type === "number") {
      control = `<input type="number" min="1" data-opt="${o.name}" placeholder="${o.placeholder || ""}" />`;
    } else if (o.type === "password") {
      control = `<input type="password" data-opt="${o.name}" placeholder="${o.placeholder || ""}" />`;
    } else {
      control = `<input type="text" data-opt="${o.name}" placeholder="${o.placeholder || ""}" />`;
    }
    return `<div class="opt"><label>${o.label}</label>${control}${
      o.note ? `<div class="opt-note">${o.note}</div>` : ""}</div>`;
  }).join("");

  const inputArea = mode === "text"
    ? `<div class="text-input">
         <label>${(cfg.input && cfg.input.label) || "Text"}</label>
         <textarea id="text-field" rows="3" placeholder="${(cfg.input && cfg.input.placeholder) || ""}"></textarea>
       </div>`
    : `<label class="dropzone" id="dz">
         <input type="file" id="file-input" accept="${cfg.accept}" ${cfg.multiple ? "multiple" : ""} hidden />
         <span class="dz-icon">⬆</span>
         <span class="dz-text">Click to choose ${cfg.multiple ? "files" : "a file"}, or drag ${cfg.multiple ? "them" : "it"} here</span>
         <span class="dz-hint">Max ${maxMb} MB${cfg.multiple ? " each" : ""}</span>
       </label>
       <ul class="file-list" id="file-list"></ul>`;

  root.innerHTML = `${inputArea}
    <div class="options">${optionsHtml}</div>
    <button class="run-btn" id="run-btn" ${mode === "text" ? "" : "disabled"}>${cfg.cta || "Convert"}</button>
    <div class="status" id="status" hidden></div>`;

  const $ = (s) => root.querySelector(s);
  const runBtn = $("#run-btn");
  runBtn.addEventListener("click", run);

  if (mode === "text") {
    const tf = $("#text-field");
    tf.addEventListener("input", () => { runBtn.disabled = !tf.value.trim(); });
    runBtn.disabled = true;
  } else {
    const input = $("#file-input");
    const dz = $("#dz");
    input.addEventListener("change", () => addFiles(input.files));
    dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("drag"); });
    dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
    dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("drag"); addFiles(e.dataTransfer.files); });
  }

  function addFiles(list) {
    const incoming = Array.from(list);
    files = cfg.multiple ? files.concat(incoming) : incoming.slice(0, 1);
    render();
  }

  function render() {
    const ul = $("#file-list");
    ul.innerHTML = "";
    files.forEach((f, i) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${escapeHtml(f.name)} <span class="sz">(${fmtSize(f.size)})</span></span>`;
      const rm = document.createElement("button");
      rm.className = "rm"; rm.textContent = "Remove";
      rm.addEventListener("click", () => { files.splice(i, 1); render(); });
      li.appendChild(rm);
      ul.appendChild(li);
    });
    runBtn.disabled = files.length === 0;
  }

  async function run() {
    const fd = new FormData();
    if (mode === "text") {
      const val = $("#text-field").value.trim();
      if (!val) return;
      fd.append((cfg.input && cfg.input.field) || "text", val);
    } else {
      if (!files.length) return;
      files.forEach((f) => fd.append(cfg.field, f));
    }
    root.querySelectorAll("[data-opt]").forEach((el) => fd.append(el.dataset.opt, el.value));

    runBtn.disabled = true;
    runBtn.textContent = "Working…";
    setStatus("working", `<span class="spinner"></span>Processing — this stays private.`);
    try {
      const res = await fetch(cfg.endpoint, { method: "POST", body: fd });
      if (!res.ok) {
        let msg = `Something went wrong (HTTP ${res.status}).`;
        try { const j = await res.json(); if (j.detail || j.error) msg = j.detail || j.error; } catch (_) {}
        setStatus("err", "⚠️ " + msg);
        runBtn.disabled = false; runBtn.textContent = cfg.cta || "Try again";
        return;
      }
      const blob = await res.blob();
      const name = filenameFrom(res.headers.get("Content-Disposition")) || "matetools-output";
      if (cfg.preview && blob.type.startsWith("image/")) {
        showPreview(blob, name);
      } else {
        download(blob, name);
        setStatus("ok", `✅ Done! Your download "${escapeHtml(name)}" has started. Nothing was stored.`);
      }
      runBtn.disabled = false; runBtn.textContent = cfg.cta || "Convert another";
    } catch (e) {
      setStatus("err", "⚠️ Network error. Please try again.");
      runBtn.disabled = false; runBtn.textContent = cfg.cta || "Try again";
    }
  }

  function showPreview(blob, name) {
    const url = URL.createObjectURL(blob);
    const s = $("#status");
    s.hidden = false; s.className = "status ok";
    s.innerHTML = `<div class="result-preview"><img src="${url}" alt="result" /></div>
      <a class="dl-btn" download="${escapeHtml(name)}" href="${url}">⬇ Download</a>
      <p class="muted" style="margin:.5rem 0 0">Nothing was stored.</p>`;
  }

  function setStatus(kind, html) {
    const s = $("#status");
    s.hidden = false; s.className = "status " + kind; s.innerHTML = html;
  }
  function fmtSize(b) {
    if (b < 1024) return b + " B";
    if (b < 1048576) return (b / 1024).toFixed(0) + " KB";
    return (b / 1048576).toFixed(1) + " MB";
  }
  function filenameFrom(h) { if (!h) return null; const m = /filename="?([^"]+)"?/.exec(h); return m ? m[1] : null; }
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
})();
