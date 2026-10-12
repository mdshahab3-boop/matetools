// MateTools instant tools — run entirely in the browser. One registry keyed by
// the tool slug (data-tool on #client-tool). Nothing is sent to any server.
(function () {
  const root = document.getElementById("client-tool");
  if (!root) return;
  const slug = root.dataset.tool;
  const T = {};
  const $ = (s) => root.querySelector(s);

  function copy(text, btn) {
    if (!text) return;
    const done = () => { const o = btn.textContent; btn.textContent = "Copied!"; setTimeout(() => (btn.textContent = o), 1200); };
    const fb = () => { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); done(); } catch (e) {} ta.remove(); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done).catch(fb); else fb();
  }

  // ---- Password Generator ----
  T["password-generator"] = function () {
    root.innerHTML = `
      <div class="ctool">
        <div class="ctool-out-row"><input id="pw-out" class="ctool-out" readonly><button id="pw-copy" class="ctool-btn">Copy</button></div>
        <div id="pw-strength" class="pw-strength"></div>
        <div class="ctool-field"><label>Length: <span id="pw-len-val">16</span></label>
          <input id="pw-len" type="range" min="6" max="48" value="16" class="ctool-range"></div>
        <div class="ctool-checks">
          <label><input type="checkbox" id="pw-upper" checked> Uppercase</label>
          <label><input type="checkbox" id="pw-lower" checked> Lowercase</label>
          <label><input type="checkbox" id="pw-num" checked> Numbers</label>
          <label><input type="checkbox" id="pw-sym" checked> Symbols</label>
        </div>
        <button id="pw-gen" class="ctool-primary">↻ Generate new password</button>
      </div>`;
    const sets = { upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ", lower: "abcdefghijklmnopqrstuvwxyz", num: "0123456789", sym: "!@#$%^&*()-_=+[]{};:,.?" };
    function gen() {
      let pool = "";
      ["upper", "lower", "num", "sym"].forEach((k) => { if ($("#pw-" + k).checked) pool += sets[k]; });
      const len = +$("#pw-len").value; $("#pw-len-val").textContent = len;
      if (!pool) { $("#pw-out").value = ""; $("#pw-strength").textContent = "Select at least one character type"; $("#pw-strength").style.color = "#dc2626"; return; }
      const arr = new Uint32Array(len); crypto.getRandomValues(arr);
      let pw = ""; for (let i = 0; i < len; i++) pw += pool[arr[i] % pool.length];
      $("#pw-out").value = pw;
      const types = ["upper", "lower", "num", "sym"].filter((k) => $("#pw-" + k).checked).length;
      let s = "Weak", c = "#dc2626";
      if (len >= 16 && types >= 3) { s = "Very strong"; c = "#16a34a"; }
      else if (len >= 12 && types >= 3) { s = "Strong"; c = "#16a34a"; }
      else if (len >= 10 && types >= 2) { s = "Medium"; c = "#d97706"; }
      $("#pw-strength").textContent = "Strength: " + s; $("#pw-strength").style.color = c;
    }
    root.addEventListener("input", gen);
    $("#pw-gen").addEventListener("click", gen);
    $("#pw-copy").addEventListener("click", () => copy($("#pw-out").value, $("#pw-copy")));
    gen();
  };

  // ---- Word Counter ----
  T["word-counter"] = function () {
    root.innerHTML = `
      <textarea id="wc-in" class="ctool-textarea" rows="7" placeholder="Type or paste your text here…"></textarea>
      <div class="ctool-stats" id="wc-stats"></div>`;
    function upd() {
      const t = $("#wc-in").value;
      const words = (t.trim().match(/\S+/g) || []).length;
      const sentences = (t.match(/[^.!?]+[.!?]+/g) || []).length || (t.trim() ? 1 : 0);
      const paras = t.split(/\n+/).filter((p) => p.trim()).length;
      const mins = words ? Math.max(1, Math.round(words / 200)) : 0;
      const stats = [["Words", words], ["Characters", t.length], ["Characters (no spaces)", t.replace(/\s/g, "").length],
        ["Sentences", sentences], ["Paragraphs", paras], ["Reading time", mins + " min"]];
      $("#wc-stats").innerHTML = stats.map(([k, v]) => `<div class="stat"><span class="stat-n">${v}</span><span class="stat-l">${k}</span></div>`).join("");
    }
    $("#wc-in").addEventListener("input", upd); upd();
  };

  // ---- GST Calculator (AU) ----
  T["gst-calculator"] = function () {
    root.innerHTML = `
      <div class="ctool">
        <div class="ctool-field"><label>Amount (A$)</label><input id="gst-amt" type="number" min="0" step="0.01" placeholder="e.g. 100"></div>
        <div class="ctool-field"><label>Mode</label><select id="gst-mode">
          <option value="add">Add GST (amount excludes GST)</option>
          <option value="remove">Remove GST (amount includes GST)</option></select></div>
        <div class="ctool-field"><label>GST rate (%)</label><input id="gst-rate" type="number" min="0" step="0.1" value="10"></div>
        <div class="ctool-results" id="gst-res"></div>
      </div>`;
    const fmt = (n) => "A$" + n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    function upd() {
      const amt = parseFloat($("#gst-amt").value) || 0, rate = parseFloat($("#gst-rate").value) || 0, mode = $("#gst-mode").value;
      let net, gst, total;
      if (mode === "add") { net = amt; gst = amt * rate / 100; total = amt + gst; }
      else { net = amt / (1 + rate / 100); gst = amt - net; total = amt; }
      $("#gst-res").innerHTML = [["Net (excl. GST)", net], ["GST", gst], ["Total (incl. GST)", total]]
        .map(([k, v]) => `<div class="res-row"><span>${k}</span><strong>${fmt(v)}</strong></div>`).join("");
    }
    root.addEventListener("input", upd); root.addEventListener("change", upd); upd();
  };

  // ---- Percentage Calculator ----
  T["percentage-calculator"] = function () {
    root.innerHTML = `
      <div class="ctool pc">
        <div class="pc-block"><p class="pc-q">What is <input id="pc1a" type="number" class="pc-in" placeholder="10">% of <input id="pc1b" type="number" class="pc-in" placeholder="200">?</p><div class="pc-ans" id="pc1r">—</div></div>
        <div class="pc-block"><p class="pc-q"><input id="pc2a" type="number" class="pc-in" placeholder="25"> is what % of <input id="pc2b" type="number" class="pc-in" placeholder="200">?</p><div class="pc-ans" id="pc2r">—</div></div>
        <div class="pc-block"><p class="pc-q">% change from <input id="pc3a" type="number" class="pc-in" placeholder="120"> to <input id="pc3b" type="number" class="pc-in" placeholder="150"></p><div class="pc-ans" id="pc3r">—</div></div>
      </div>`;
    const num = (s) => { const v = parseFloat($(s).value); return isNaN(v) ? null : v; };
    const round = (n) => Math.round(n * 100) / 100;
    function upd() {
      let a = num("#pc1a"), b = num("#pc1b"); $("#pc1r").textContent = (a != null && b != null) ? round(a / 100 * b) : "—";
      a = num("#pc2a"); b = num("#pc2b"); $("#pc2r").textContent = (a != null && b) ? round(a / b * 100) + "%" : "—";
      a = num("#pc3a"); b = num("#pc3b"); $("#pc3r").textContent = (a != null && b != null && a !== 0) ? (b >= a ? "+" : "") + round((b - a) / Math.abs(a) * 100) + "%" : "—";
    }
    root.addEventListener("input", upd); upd();
  };

  // ---- Age Calculator ----
  T["age-calculator"] = function () {
    const today = new Date().toISOString().slice(0, 10);
    root.innerHTML = `
      <div class="ctool">
        <div class="ctool-field"><label>Date of birth</label><input id="ag-dob" type="date" max="${today}"></div>
        <div class="ctool-field"><label>Age at date</label><input id="ag-at" type="date" value="${today}"></div>
        <div class="ctool-results" id="ag-res"></div>
      </div>`;
    function upd() {
      const dob = $("#ag-dob").value, at = $("#ag-at").value;
      if (!dob || !at) { $("#ag-res").innerHTML = '<p class="muted">Enter a date of birth.</p>'; return; }
      const d1 = new Date(dob), d2 = new Date(at);
      if (d2 < d1) { $("#ag-res").innerHTML = '<p class="muted">The second date is before the birth date.</p>'; return; }
      let y = d2.getFullYear() - d1.getFullYear(), m = d2.getMonth() - d1.getMonth(), dd = d2.getDate() - d1.getDate();
      if (dd < 0) { m--; dd += new Date(d2.getFullYear(), d2.getMonth(), 0).getDate(); }
      if (m < 0) { y--; m += 12; }
      const totalDays = Math.floor((d2 - d1) / 86400000);
      let nb = new Date(d2.getFullYear(), d1.getMonth(), d1.getDate());
      if (nb < d2) nb = new Date(d2.getFullYear() + 1, d1.getMonth(), d1.getDate());
      const toNB = Math.ceil((nb - d2) / 86400000);
      $("#ag-res").innerHTML = `<div class="res-big">${y} years, ${m} months, ${dd} days</div>` +
        [["Total days", totalDays.toLocaleString()], ["Next birthday in", toNB + " days"]]
          .map(([k, v]) => `<div class="res-row"><span>${k}</span><strong>${v}</strong></div>`).join("");
    }
    root.addEventListener("input", upd); root.addEventListener("change", upd); upd();
  };

  // ---- Loan / Mortgage Calculator ----
  T["loan-calculator"] = function () {
    root.innerHTML = `
      <div class="ctool">
        <div class="ctool-field"><label>Loan amount (A$)</label><input id="ln-amt" type="number" min="0" placeholder="e.g. 500000"></div>
        <div class="ctool-field"><label>Annual interest rate (%)</label><input id="ln-rate" type="number" min="0" step="0.01" placeholder="e.g. 6.0"></div>
        <div class="ctool-field"><label>Term (years)</label><input id="ln-term" type="number" min="1" placeholder="e.g. 30"></div>
        <div class="ctool-results" id="ln-res"></div>
      </div>`;
    const fmt = (n) => "A$" + n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    function upd() {
      const P = parseFloat($("#ln-amt").value) || 0, rate = parseFloat($("#ln-rate").value) || 0, yrs = parseFloat($("#ln-term").value) || 0;
      if (!P || !yrs) { $("#ln-res").innerHTML = '<p class="muted">Enter an amount and term.</p>'; return; }
      const n = yrs * 12, r = rate / 100 / 12;
      const pay = r === 0 ? P / n : P * r / (1 - Math.pow(1 + r, -n));
      const total = pay * n, interest = total - P;
      $("#ln-res").innerHTML = `<div class="res-big">${fmt(pay)}<span class="res-sub"> / month</span></div>` +
        [["Total interest", fmt(interest)], ["Total paid", fmt(total)]]
          .map(([k, v]) => `<div class="res-row"><span>${k}</span><strong>${v}</strong></div>`).join("");
    }
    root.addEventListener("input", upd); upd();
  };

  // ---- Unit Converter ----
  T["unit-converter"] = function () {
    const cats = {
      Length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, yd: 0.9144, ft: 0.3048, in: 0.0254 },
      Weight: { kg: 1, g: 0.001, mg: 0.000001, t: 1000, lb: 0.45359237, oz: 0.028349523 },
      Volume: { L: 1, mL: 0.001, "m³": 1000, gal: 3.785411784, qt: 0.946352946, cup: 0.236588236, "fl oz": 0.0295735296 },
      Area: { "m²": 1, "km²": 1000000, "cm²": 0.0001, ha: 10000, acre: 4046.8564224, "ft²": 0.09290304 },
      Speed: { "m/s": 1, "km/h": 0.2777778, mph: 0.44704, knot: 0.514444 },
      Temperature: { "°C": 1, "°F": 1, K: 1 },
    };
    const names = Object.keys(cats);
    root.innerHTML = `
      <div class="ctool">
        <div class="ctool-field"><label>Category</label><select id="uc-cat">${names.map((c) => `<option>${c}</option>`).join("")}</select></div>
        <div class="uc-row">
          <div class="ctool-field"><label>From</label><input id="uc-val" type="number" value="1"><select id="uc-from"></select></div>
          <div class="ctool-field"><label>To</label><input id="uc-out" readonly><select id="uc-to"></select></div>
        </div>
      </div>`;
    function fill() {
      const us = Object.keys(cats[$("#uc-cat").value]);
      $("#uc-from").innerHTML = us.map((u) => `<option>${u}</option>`).join("");
      $("#uc-to").innerHTML = us.map((u) => `<option>${u}</option>`).join("");
      if (us.length > 1) $("#uc-to").selectedIndex = 1;
    }
    function convTemp(v, f, t) {
      let c; if (f === "°C") c = v; else if (f === "°F") c = (v - 32) * 5 / 9; else c = v - 273.15;
      if (t === "°C") return c; if (t === "°F") return c * 9 / 5 + 32; return c + 273.15;
    }
    function conv() {
      const cat = $("#uc-cat").value, from = $("#uc-from").value, to = $("#uc-to").value, v = parseFloat($("#uc-val").value);
      if (isNaN(v)) { $("#uc-out").value = ""; return; }
      const res = cat === "Temperature" ? convTemp(v, from, to) : v * cats[cat][from] / cats[cat][to];
      $("#uc-out").value = Math.round(res * 1e6) / 1e6;
    }
    $("#uc-cat").addEventListener("change", () => { fill(); conv(); });
    root.addEventListener("input", conv); root.addEventListener("change", conv);
    fill(); conv();
  };

  // ---- Case Converter ----
  T["case-converter"] = function () {
    root.innerHTML = `
      <textarea id="cc-in" class="ctool-textarea" rows="5" placeholder="Type or paste your text here…"></textarea>
      <div class="cc-btns">
        <button data-c="upper" class="ctool-btn">UPPERCASE</button>
        <button data-c="lower" class="ctool-btn">lowercase</button>
        <button data-c="title" class="ctool-btn">Title Case</button>
        <button data-c="sentence" class="ctool-btn">Sentence case</button>
        <button data-c="alt" class="ctool-btn">aLtErNaTiNg</button>
      </div>
      <textarea id="cc-out" class="ctool-textarea" rows="5" readonly placeholder="Result appears here…"></textarea>
      <button id="cc-copy" class="ctool-primary">Copy result</button>`;
    function tr(t, c) {
      switch (c) {
        case "upper": return t.toUpperCase();
        case "lower": return t.toLowerCase();
        case "title": return t.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
        case "sentence": return t.toLowerCase().replace(/(^\s*\w|[.!?]\s+\w)/g, (m) => m.toUpperCase());
        case "alt": return t.split("").map((ch, i) => (i % 2 ? ch.toUpperCase() : ch.toLowerCase())).join("");
      }
      return t;
    }
    root.querySelectorAll(".cc-btns button").forEach((b) =>
      b.addEventListener("click", () => { $("#cc-out").value = tr($("#cc-in").value, b.dataset.c); }));
    $("#cc-copy").addEventListener("click", () => copy($("#cc-out").value, $("#cc-copy")));
  };

  (T[slug] || function () { root.innerHTML = '<p class="ns">This tool is unavailable.</p>'; })();
})();
