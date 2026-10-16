/* Tiny DOM + UI helpers (no framework). */

/** Create an element: h('div', {class:'x', onclick:fn}, child1, child2) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === "class") {
      el.className = v;
    } else if (k === "dataset") {
      Object.assign(el.dataset, v);
    } else if (k === "html") {
      el.innerHTML = v;
    } else if (k in el && k !== "list") {
      el[k] = v;
    } else {
      el.setAttribute(k, v);
    }
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/* ─────────── Formatting ─────────── */
export function fmtDate(iso, withTime = true) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const opts = { day: "2-digit", month: "short", year: "numeric" };
  if (withTime) { opts.hour = "2-digit"; opts.minute = "2-digit"; }
  return d.toLocaleString(undefined, opts);
}

export function fmtMoney(v) {
  if (v == null) return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return "TZS " + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function titleCase(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const STATUS_COLOR = {
  PENDING_ACADEMIC: "amber", PENDING_HEAD_MASTER: "amber",
  PENDING_APPROVAL: "amber", PENDING_BURSAR: "amber", PENDING_MANAGER: "amber",
  PENDING_ORDER: "amber", PENDING: "amber",
  APPROVED: "blue", ORDERED: "blue", RECEIVED: "blue", VERIFIED: "blue",
  REJECTED: "red", DISPUTED: "red", LOST: "red", DAMAGED: "red",
  PAID: "purple",
  SENT_TO_SCHOOL: "green", IN_STORE: "green", CATALOGUED: "green",
  RETURNED: "green", WRITTEN_OFF: "gray", CANCELLED: "gray",
  ISSUED: "blue", AVAILABLE: "green",
};

export function badge(status) {
  const color = STATUS_COLOR[status] || "gray";
  return h("span", { class: `badge badge-${color}` }, titleCase(status));
}

export function roleTag(role) {
  return h("span", { class: "role-tag" }, titleCase(role).replace(" ", "\u00a0"));
}

/* ─────────── Toasts ─────────── */
export function toast(message, type = "info") {
  const el = h("div", { class: `toast ${type}` }, message);
  document.getElementById("toast-root").append(el);
  setTimeout(() => {
    el.style.transition = "opacity .25s, transform .25s";
    el.style.opacity = "0";
    el.style.transform = "translateX(16px)";
    setTimeout(() => el.remove(), 260);
  }, 3200);
}

/* ─────────── Modal ─────────── */
export function modal({ title, body, footer, size = "" }) {
  const root = document.getElementById("modal-root");
  const backdrop = h("div", { class: "modal-backdrop" });
  const box = h("div", { class: `modal ${size}` });

  const close = () => backdrop.remove();
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  document.addEventListener("keydown", function esc(e) {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc); }
  });

  const head = h("div", { class: "modal-head" },
    h("h3", {}, title),
    h("button", { class: "modal-close", onclick: close, title: "Close" }, "×"),
  );
  box.append(head, h("div", { class: "modal-body" }, body));
  if (footer) box.append(h("div", { class: "modal-foot" }, footer));
  backdrop.append(box);
  root.append(backdrop);
  return { close, backdrop, box };
}

/* ─────────── Form field helper ─────────── */
export function field(label, input, hint) {
  const wrap = h("label", { class: "field" }, h("span", {}, label), input);
  if (hint) wrap.append(h("div", { class: "field-hint" }, hint));
  return wrap;
}

export function textInput(attrs = {}) {
  return h("input", { type: "text", ...attrs });
}

export function selectInput(options, attrs = {}) {
  const sel = h("select", attrs);
  for (const o of options) {
    sel.append(h("option", { value: o.value, selected: o.selected }, o.label));
  }
  return sel;
}

/* ─────────── Shared building blocks ─────────── */
export function card(title, bodyEl, actions) {
  const head = h("div", { class: "card-head" }, h("h3", {}, title));
  if (actions) head.append(...[actions].flat());
  return h("div", { class: "card" }, head, bodyEl);
}

export function statCard(label, value, sub) {
  return h("div", { class: "stat" },
    h("div", { class: "stat-label" }, label),
    h("div", { class: "stat-value" }, value),
    sub ? h("div", { class: "stat-sub" }, sub) : null,
  );
}

export function emptyState(message, icon = "📭") {
  return h("div", { class: "empty" },
    h("div", { class: "empty-icon" }, icon),
    h("p", {}, message),
  );
}

/**
 * Render a table: columns = [{ key, label, num?, render?(row) }]
 */
export function table(columns, rows) {
  const thead = h("thead", {}, h("tr", {}, columns.map((c) =>
    h("th", { class: c.num ? "num" : "" }, c.label))));
  const tbody = h("tbody", {}, rows.map((row) =>
    h("tr", {}, columns.map((c) => {
      const cell = h("td", { class: c.num ? "num" : "" });
      const val = c.render ? c.render(row) : row[c.key];
      appendChildren(cell, [val ?? "—"]);
      return cell;
    }))));
  return h("div", { class: "table-wrap" }, h("table", {}, thead, tbody));
}

/** Wrap async button behaviour with loading + error toast. */
export function withBusy(btn, fn) {
  return async (...args) => {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Working…";
    try {
      await fn(...args);
    } catch (e) {
      toast(e.message || "Something went wrong", "error");
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  };
}
