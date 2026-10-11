// MateTools inline converter widget. Reads config from #tool-widget and wires
// up an upload → convert → download flow. Nothing is kept client-side.
(function () {
  const root = document.getElementById("tool-widget");
  if (!root) return;
  const cfg = JSON.parse(root.dataset.config);
  const maxMb = parseInt(root.dataset.maxMb || "100", 10);
  let files = [];

  const optionsHtml = (cfg.options || []).map((o) => {
    let control;
    if (o.type === "select") {
      control = `<select data-opt="${o.name}">${o.choices
        .map((c) => `<option value="${c[0]}">${c[1]}</option>`).join("")}</select>`;
    } else {
      control = `<input type="text" data-opt="${o.name}" placeholder="${o.placeholder || ""}" />`;
    }
    return `<div class="opt"><label>${o.label}</label>${control}${
      o.note ? `<div class="opt-note">${o.note}</div>` : ""}</div>`;
  }).join("");

  root.innerHTML = `
    <label class="dropzone" id="dz">
      <input type="file" id="file-input" accept="${cfg.accept}" ${cfg.multiple ? "multiple" : ""} hidden />
      <span class="dz-icon">⬆</span>
      <span class="dz-text">Click to choose ${cfg.multiple ? "files" : "a file"}, or drag ${cfg.multiple ? "them" : "it"} here</span>
      <span class="dz-hint">Max ${maxMb} MB${cfg.multiple ? " each" : ""}</span>
    </label>
    <ul class="file-list" id="file-list"></ul>
    <div class="options">${optionsHtml}</div>
    <button class="run-btn" id="run-btn" disabled>Convert</button>
    <div class="status" id="status" hidden></div>`;

  const $ = (s) => root.querySelector(s);
  const input = $("#file-input");
  const dz = $("#dz");
  const runBtn = $("#run-btn");

  input.addEventListener("change", () => addFiles(input.files));
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("drag"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
  dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("drag"); addFiles(e.dataTransfer.files); });
  runBtn.addEventListener("click", run);

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
    if (!files.length) return;
    runBtn.disabled = true;
    runBtn.textContent = "Working…";
    setStatus("working", `<span class="spinner"></span>Processing — this stays private.`);
    const fd = new FormData();
    files.forEach((f) => fd.append(cfg.field, f));
    root.querySelectorAll("[data-opt]").forEach((el) => fd.append(el.dataset.opt, el.value));
    try {
      const res = await fetch(cfg.endpoint, { method: "POST", body: fd });
      if (!res.ok) {
        let msg = `Something went wrong (HTTP ${res.status}).`;
        try { const j = await res.json(); if (j.detail || j.error) msg = j.detail || j.error; } catch (_) {}
        setStatus("err", "⚠️ " + msg);
        runBtn.disabled = false; runBtn.textContent = "Try again";
        return;
      }
      const blob = await res.blob();
      const name = filenameFrom(res.headers.get("Content-Disposition")) || "matetools-output";
      download(blob, name);
      setStatus("ok", `✅ Done! Your download "${escapeHtml(name)}" has started. Nothing was stored.`);
      runBtn.disabled = false; runBtn.textContent = "Convert another";
    } catch (e) {
      setStatus("err", "⚠️ Network error. Please try again.");
      runBtn.disabled = false; runBtn.textContent = "Try again";
    }
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
