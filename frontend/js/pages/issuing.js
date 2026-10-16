/* Issuing: lend and return book copies / stock items. */

import { api, session } from "../api.js";
import {
  h, clear, badge, table, emptyState, card, modal, field,
  textInput, selectInput, fmtDate, toast,
} from "../ui.js";

let borrowerFilter = "";
let statusFilter = "";

export async function render(view) {
  view.append(
    h("div", { class: "page-head" },
      h("h3", {}, "Issuing"),
      h("div", { class: "filters" },
        textInput({ placeholder: "Borrower…", value: borrowerFilter, oninput: (e) => { borrowerFilter = e.target.value; reload(); } }),
        selectInput([
          { value: "", label: "All" },
          { value: "ISSUED", label: "Issued", selected: statusFilter === "ISSUED" },
          { value: "RETURNED", label: "Returned", selected: statusFilter === "RETURNED" },
        ], { onchange: (e) => { statusFilter = e.target.value; reload(); } }),
      ),
      session.hasRole("LIBRARIAN")
        ? h("button", { class: "btn btn-primary", onclick: () => newIssueModal(reload) }, "＋ Issue item")
        : null,
    ),
  );

  const body = h("div");
  view.append(body);

  async function reload() {
    clear(body);
    body.append(h("div", { class: "faint" }, "Loading…"));
    const qs = new URLSearchParams();
    if (borrowerFilter) qs.set("borrower", borrowerFilter);
    if (statusFilter) qs.set("status", statusFilter);
    const rows = await api.get(`/issues?${qs.toString()}`);
    clear(body);

    body.append(card(`Loans (${rows.length})`, rows.length ? table([
      { key: "id", label: "#", render: (r) => `#${r.id}` },
      { key: "borrower", label: "Borrower" },
      { key: "branch_id", label: "Branch", render: (r) => session.branchName(r.branch_id) },
      {
        key: "item", label: "Item",
        render: (r) => r.book_copy_id
          ? h("span", {}, `Book copy #${r.book_copy_id}`, r.size ? ` · ${r.size}` : "")
          : `Stock item #${r.stock_item_id}${r.quantity ? ` · ×${r.quantity}` : ""}`,
      },
      { key: "status", label: "Status", render: (r) => badge(r.status) },
      { key: "created_at", label: "Issued", render: (r) => fmtDate(r.created_at) },
      {
        key: "actions", label: "",
        render: (r) => r.status === "ISSUED" && session.hasRole("LIBRARIAN")
          ? h("button", {
              class: "btn btn-secondary btn-sm",
              onclick: async () => {
                try { await api.post(`/issues/${r.id}/return`); toast("Marked as returned.", "success"); reload(); }
                catch (e) { toast(e.message, "error"); }
              },
            }, "Return")
          : (r.returned_at ? h("span", { class: "faint" }, fmtDate(r.returned_at)) : null),
      },
    ], rows) : emptyState("No loans recorded.", "🔄")));
  }

  await reload();
}

function newIssueModal(onDone) {
  const mode = selectInput([
    { value: "book", label: "Book copy (by code)" },
    { value: "item", label: "Stock item (by name)" },
  ]);
  const borrower = textInput({ placeholder: "Borrower name" });

  const bookWrap = field("Book code", textInput({ placeholder: "e.g. BK-0001" }));
  const itemWrap = h("div", {},
    field("Item name", textInput({ placeholder: "e.g. Exercise books" })),
    h("div", { class: "field-row" },
      field("Quantity", h("input", { type: "number", min: "1", value: "1" })),
      field("Size (optional)", textInput({ placeholder: "e.g. A4" })),
    ),
  );
  itemWrap.classList.add("hidden");

  mode.addEventListener("change", () => {
    bookWrap.classList.toggle("hidden", mode.value !== "book");
    itemWrap.classList.toggle("hidden", mode.value !== "item");
  });

  const branchField = session.isCentral
    ? field("Branch", selectInput([
        { value: "", label: "Select branch…" },
        ...session.branches.map((b) => ({ value: b.id, label: b.name })),
      ]))
    : null;
  const branchSel = branchField?.querySelector("select");

  const m = modal({
    title: "Issue item",
    body: h("div", {}, field("Type", mode), field("Borrower", borrower), branchField, bookWrap, itemWrap),
    footer: [
      h("button", { class: "btn btn-secondary", onclick: () => m.close() }, "Cancel"),
      h("button", {
        class: "btn btn-primary",
        onclick: async () => {
          const body = { borrower: borrower.value.trim() };
          if (!body.borrower) return toast("Enter a borrower name.", "error");
          if (branchSel?.value) body.branch_id = Number(branchSel.value);
          if (mode.value === "book") {
            const code = bookWrap.querySelector("input").value.trim();
            if (!code) return toast("Enter a book code.", "error");
            body.book_code = code;
          } else {
            const inputs = itemWrap.querySelectorAll("input");
            const name = inputs[0].value.trim();
            if (!name) return toast("Enter an item name.", "error");
            body.item_name = name;
            body.quantity = Number(inputs[1].value) || 1;
            if (inputs[2].value.trim()) body.size = inputs[2].value.trim();
          }
          try {
            await api.post("/issues", body);
            m.close(); toast("Item issued.", "success"); onDone();
          } catch (e) { toast(e.message, "error"); }
        },
      }, "Issue"),
    ],
  });
}
