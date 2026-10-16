/* Contributions: parent contributions (primary branches only). */

import { api, session } from "../api.js";
import {
  h, clear, table, emptyState, card, modal, field,
  textInput, selectInput, fmtDate, toast,
} from "../ui.js";

export async function render(view) {
  view.append(
    h("div", { class: "page-head" },
      h("h3", {}, "Contributions"),
      session.hasRole("LIBRARIAN")
        ? h("button", { class: "btn btn-primary", onclick: () => newContributionModal(reload) }, "＋ Record contribution")
        : null,
    ),
  );

  const body = h("div");
  view.append(body);

  async function reload() {
    clear(body);
    body.append(h("div", { class: "faint" }, "Loading…"));
    const rows = await api.get("/contributions");
    clear(body);
    body.append(card(`Contributions (${rows.length})`, rows.length ? table([
      { key: "id", label: "#", render: (r) => `#${r.id}` },
      { key: "item_name", label: "Item" },
      { key: "quantity", label: "Qty", num: true },
      { key: "contributor", label: "Contributor", render: (r) => r.contributor || h("span", { class: "faint" }, "Anonymous") },
      { key: "branch_id", label: "Branch", render: (r) => session.branchName(r.branch_id) },
      { key: "note", label: "Note", render: (r) => r.note || "—" },
      { key: "created_at", label: "Date", render: (r) => fmtDate(r.created_at) },
    ], rows) : emptyState("No contributions recorded.", "🎁")));
  }

  await reload();
}

function newContributionModal(onDone) {
  const item = textInput({ placeholder: "e.g. Exercise books" });
  const qty = h("input", { type: "number", min: "1", value: "1" });
  const contributor = textInput({ placeholder: "Parent / guardian (optional)" });
  const note = h("textarea", { placeholder: "Optional note" });
  const branchField = session.isCentral
    ? field("Branch", selectInput([
        { value: "", label: "Select branch…" },
        ...session.branches.filter((b) => b.type === "PRIMARY").map((b) => ({ value: b.id, label: b.name })),
      ]), "Contributions are only recorded for primary branches.")
    : null;
  const branchSel = branchField?.querySelector("select");

  const m = modal({
    title: "Record a parent contribution",
    body: h("div", {},
      field("Item", item),
      h("div", { class: "field-row" }, field("Quantity", qty), field("Contributor", contributor)),
      branchField,
      field("Note", note),
    ),
    footer: [
      h("button", { class: "btn btn-secondary", onclick: () => m.close() }, "Cancel"),
      h("button", {
        class: "btn btn-primary",
        onclick: async () => {
          const body = {
            item_name: item.value.trim(),
            quantity: Number(qty.value) || 1,
            contributor: contributor.value.trim() || null,
            note: note.value.trim() || null,
          };
          if (!body.item_name) return toast("Enter an item name.", "error");
          if (branchSel?.value) body.branch_id = Number(branchSel.value);
          try {
            await api.post("/contributions", body);
            m.close(); toast("Contribution recorded.", "success"); onDone();
          } catch (e) { toast(e.message, "error"); }
        },
      }, "Record"),
    ],
  });
}
