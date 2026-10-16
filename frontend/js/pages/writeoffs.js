/* Write-offs: report and approve lost/damaged book copies. */

import { api, session } from "../api.js";
import {
  h, clear, badge, table, emptyState, card, modal, field,
  textInput, selectInput, fmtDate, toast,
} from "../ui.js";

let statusFilter = "";

export async function render(view) {
  view.append(
    h("div", { class: "page-head" },
      h("h3", {}, "Write-offs"),
      h("div", { class: "filters" }, selectInput([
        { value: "", label: "All statuses" },
        { value: "PENDING", label: "Pending", selected: statusFilter === "PENDING" },
        { value: "APPROVED", label: "Approved", selected: statusFilter === "APPROVED" },
        { value: "REJECTED", label: "Rejected", selected: statusFilter === "REJECTED" },
      ], { onchange: (e) => { statusFilter = e.target.value; reload(); } })),
      session.hasRole("LIBRARIAN")
        ? h("button", { class: "btn btn-primary", onclick: () => newWriteOffModal(reload) }, "＋ Report write-off")
        : null,
    ),
  );

  const body = h("div");
  view.append(body);

  async function reload() {
    clear(body);
    body.append(h("div", { class: "faint" }, "Loading…"));
    const qs = statusFilter ? `?status=${statusFilter}` : "";
    const rows = await api.get(`/write-offs${qs}`);
    clear(body);

    body.append(card(`Write-offs (${rows.length})`, rows.length ? table([
      { key: "id", label: "#", render: (r) => `#${r.id}` },
      { key: "book_copy_id", label: "Book copy", render: (r) => `#${r.book_copy_id}` },
      { key: "branch_id", label: "Branch", render: (r) => session.branchName(r.branch_id) },
      { key: "reason", label: "Reason", render: (r) => badge(r.reason) },
      { key: "report", label: "Report", render: (r) => r.report || h("span", { class: "faint" }, "—") },
      { key: "status", label: "Status", render: (r) => badge(r.status) },
      { key: "created_at", label: "Reported", render: (r) => fmtDate(r.created_at) },
      {
        key: "actions", label: "",
        render: (r) => r.status === "PENDING" && session.hasRole("HEAD_MASTER")
          ? h("div", { class: "action-row" },
              h("button", { class: "btn btn-success btn-sm", onclick: () => decide(r, true, reload) }, "Approve"),
              h("button", { class: "btn btn-danger btn-sm", onclick: () => decide(r, false, reload) }, "Reject"))
          : (r.decision_note ? h("span", { class: "faint" }, r.decision_note) : null),
      },
    ], rows) : emptyState("No write-offs recorded.", "🗑️")));
  }

  await reload();
}

function decide(row, approve, reload) {
  const note = textInput({ placeholder: "Optional decision note" });
  const m = modal({
    title: approve ? "Approve write-off" : "Reject write-off",
    body: field("Note", note),
    footer: [
      h("button", { class: "btn btn-secondary", onclick: () => m.close() }, "Cancel"),
      h("button", {
        class: `btn ${approve ? "btn-success" : "btn-danger"}`,
        onclick: async () => {
          try {
            await api.post(`/write-offs/${row.id}/approve`, { approve, note: note.value.trim() || null });
            m.close(); toast("Decision recorded.", "success"); reload();
          } catch (e) { toast(e.message, "error"); }
        },
      }, approve ? "Approve" : "Reject"),
    ],
  });
}

function newWriteOffModal(onDone) {
  const code = textInput({ placeholder: "e.g. BK-0001" });
  const reason = selectInput([{ value: "LOST", label: "LOST" }, { value: "DAMAGED", label: "DAMAGED" }]);
  const report = h("textarea", { placeholder: "What happened?" });
  const branchField = session.isCentral
    ? field("Branch", selectInput([
        { value: "", label: "Select branch…" },
        ...session.branches.map((b) => ({ value: b.id, label: b.name })),
      ]))
    : null;
  const branchSel = branchField?.querySelector("select");

  const m = modal({
    title: "Report a write-off",
    body: h("div", {}, field("Book code", code), field("Reason", reason), branchField, field("Report", report)),
    footer: [
      h("button", { class: "btn btn-secondary", onclick: () => m.close() }, "Cancel"),
      h("button", {
        class: "btn btn-primary",
        onclick: async () => {
          const body = { book_code: code.value.trim(), reason: reason.value, report: report.value.trim() || null };
          if (!body.book_code) return toast("Enter a book code.", "error");
          if (branchSel?.value) body.branch_id = Number(branchSel.value);
          try {
            await api.post("/write-offs", body);
            m.close(); toast("Write-off reported.", "success"); onDone();
          } catch (e) { toast(e.message, "error"); }
        },
      }, "Submit"),
    ],
  });
}
