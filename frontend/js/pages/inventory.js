/* Inventory: stock levels by item. */

import { api, session } from "../api.js";
import { h, clear, table, emptyState, card, selectInput } from "../ui.js";

let branchFilter = "";

export async function render(view) {
  view.append(
    h("div", { class: "page-head" },
      h("h3", {}, "Inventory"),
      session.isCentral ? h("div", { class: "filters" }, selectInput([
        { value: "", label: "All branches" },
        ...session.branches.map((b) => ({ value: b.id, label: b.name })),
      ], { onchange: (e) => { branchFilter = e.target.value; reload(); } })) : null,
    ),
  );

  const body = h("div");
  view.append(body);

  async function reload() {
    clear(body);
    body.append(h("div", { class: "faint" }, "Loading…"));
    const qs = branchFilter ? `?branch_id=${branchFilter}` : "";
    const rows = await api.get(`/reports/stock${qs}`);
    clear(body);
    body.append(card(`Stock (${rows.length} items)`, rows.length ? table([
      { key: "item_name", label: "Item" },
      { key: "branch_id", label: "Branch", render: (r) => session.branchName(r.branch_id) },
      { key: "quantity", label: "Quantity", num: true, render: (r) => h("span", { class: r.is_low ? "qty-low" : "" }, r.quantity) },
      { key: "is_low", label: "Level", render: (r) => r.is_low ? h("span", { class: "badge badge-red" }, "LOW") : h("span", { class: "badge badge-green" }, "OK") },
    ], rows) : emptyState("No stock recorded yet.", "📦")));
  }

  await reload();
}
