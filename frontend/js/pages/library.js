/* Library: book copies catalogue. */

import { api, session } from "../api.js";
import {
  h, clear, badge, table, emptyState, card, modal, field,
  textInput, selectInput, fmtDate, toast,
} from "../ui.js";

let titleFilter = "";
let statusFilter = "";
let branchFilter = "";

export async function render(view) {
  view.append(
    h("div", { class: "page-head" },
      h("h3", {}, "Library"),
      h("div", { class: "filters" },
        textInput({ placeholder: "Search title…", value: titleFilter, oninput: (e) => { titleFilter = e.target.value; reload(); } }),
        selectInput([
          { value: "", label: "All statuses" },
          ...["AVAILABLE", "ISSUED", "LOST", "WRITTEN_OFF"].map((s) => ({ value: s, label: s, selected: statusFilter === s })),
        ], { onchange: (e) => { statusFilter = e.target.value; reload(); } }),
        session.isCentral ? branchSelect() : null,
      ),
      session.hasRole("LIBRARIAN")
        ? h("button", { class: "btn btn-primary", onclick: () => catalogueModal(reload) }, "＋ Catalogue request")
        : null,
    ),
  );

  const body = h("div");
  view.append(body);

  function branchSelect() {
    return selectInput([
      { value: "", label: "All branches" },
      ...session.branches.map((b) => ({ value: b.id, label: b.name, selected: String(branchFilter) === String(b.id) })),
    ], { onchange: (e) => { branchFilter = e.target.value; reload(); } });
  }

  async function reload() {
    clear(body);
    body.append(h("div", { class: "faint" }, "Loading…"));
    const qs = new URLSearchParams();
    if (titleFilter) qs.set("title", titleFilter);
    if (statusFilter) qs.set("status", statusFilter);
    if (branchFilter) qs.set("branch_id", branchFilter);
    const rows = await api.get(`/library/books?${qs.toString()}`);

    clear(body);
    body.append(card(`Book copies (${rows.length})`, rows.length ? table([
      { key: "code", label: "Code", render: (r) => h("span", { class: "mono" }, r.code) },
      { key: "title", label: "Title" },
      { key: "author", label: "Author", render: (r) => r.author || "—" },
      { key: "branch_id", label: "Branch", render: (r) => session.branchName(r.branch_id) },
      { key: "status", label: "Status", render: (r) => badge(r.status) },
      { key: "request_id", label: "Request", render: (r) => r.request_id ? `#${r.request_id}` : "—" },
      { key: "created_at", label: "Added", render: (r) => fmtDate(r.created_at) },
    ], rows) : emptyState("No book copies found.", "📚")));
  }

  await reload();
}

function catalogueModal(onDone) {
  const requestId = h("input", { type: "number", min: "1", placeholder: "e.g. 12" });
  const m = modal({
    title: "Catalogue books from a request",
    body: field("Request ID", requestId, "The BOOK request must be in SENT_TO_SCHOOL status."),
    footer: [
      h("button", { class: "btn btn-secondary", onclick: () => m.close() }, "Cancel"),
      h("button", {
        class: "btn btn-primary",
        onclick: async () => {
          if (!requestId.value) return toast("Enter a request ID.", "error");
          try {
            await api.post("/library/catalogue", { request_id: Number(requestId.value) });
            m.close(); toast("Books catalogued.", "success"); onDone();
          } catch (e) { toast(e.message, "error"); }
        },
      }, "Catalogue"),
    ],
  });
}
