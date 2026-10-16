/* Requests: list, create, and multi-step detail with workflow actions. */

import { api, session } from "../api.js";
import {
  h, clear, badge, table, emptyState, modal, field, textInput,
  selectInput, card, fmtDate, titleCase, toast,
} from "../ui.js";

let statusFilter = "";
let typeFilter = "";

/* ─────────── List view ─────────── */
export async function render(view, params) {
  if (params && params[0]) return renderDetail(view, params[0]);

  view.append(
    h("div", { class: "page-head" },
      h("h3", {}, "Requests"),
      h("div", { class: "filters" },
        selectInput([
          { value: "", label: "All statuses" },
          ...["PENDING_ACADEMIC", "PENDING_HEAD_MASTER", "PENDING_APPROVAL",
              "APPROVED", "PENDING_BURSAR", "PENDING_MANAGER", "PENDING_ORDER",
              "ORDERED", "RECEIVED", "VERIFIED", "PAID", "SENT_TO_SCHOOL",
              "IN_STORE", "CATALOGUED", "REJECTED", "DISPUTED"]
            .map((s) => ({ value: s, label: titleCase(s), selected: statusFilter === s })),
        ], { onchange: (e) => { statusFilter = e.target.value; reload(); } }),
        selectInput([
          { value: "", label: "All types" },
          { value: "BOOK", label: "Book", selected: typeFilter === "BOOK" },
          { value: "OTHER", label: "Other", selected: typeFilter === "OTHER" },
        ], { onchange: (e) => { typeFilter = e.target.value; reload(); } }),
      ),
      h("button", { class: "btn btn-primary", onclick: () => newRequestModal(reload) }, "＋ New request"),
    ),
  );

  const body = h("div");
  view.append(body);

  async function reload() {
    clear(body);
    body.append(h("div", { class: "faint" }, "Loading…"));
    let rows = await api.get("/requests");
    if (statusFilter) rows = rows.filter((r) => r.status === statusFilter);
    if (typeFilter) rows = rows.filter((r) => r.type === typeFilter);
    rows.sort((a, b) => b.id - a.id);

    clear(body);
    if (!rows.length) {
      body.append(card("All requests", emptyState("No requests match your filters.", "📋")));
      return;
    }
    body.append(card("All requests", table([
      { key: "id", label: "#", render: (r) => h("strong", {}, `#${r.id}`) },
      { key: "type", label: "Type", render: (r) => badge(r.type) },
      { key: "title", label: "Title", render: (r) => r.title || r.description || h("span", { class: "faint" }, "—") },
      { key: "branch_id", label: "Branch", render: (r) => session.branchName(r.branch_id) },
      { key: "status", label: "Status", render: (r) => badge(r.status) },
      { key: "created_at", label: "Created", render: (r) => fmtDate(r.created_at) },
      {
        key: "actions", label: "",
        render: (r) => h("button", {
          class: "btn btn-secondary btn-sm",
          onclick: () => { location.hash = `#/requests/${r.id}`; },
        }, "Open"),
      },
    ], rows)));
  }

  await reload();
}

/* ─────────── Create modal ─────────── */
async function newRequestModal(onDone) {
  const typeSel = selectInput([
    { value: "BOOK", label: "BOOK — library request" },
    { value: "OTHER", label: "OTHER — supplies request" },
  ]);
  const titleInput = textInput({ placeholder: "e.g. Algebra textbooks for S1" });
  const descInput = h("textarea", { placeholder: "Optional notes / justification" });

  const branchField = h("div");
  if (session.isCentral) {
    branchField.append(field("Branch *", selectInput(
      [{ value: "", label: "Select a branch…" },
       ...session.branches.map((b) => ({ value: b.id, label: `${b.name} (${b.type})` }))],
    )));
  } else {
    const own = session.user.assignments.find((a) => a.branch_id)?.branch_id;
    branchField.append(field("Branch", textInput({
      value: session.branchName(own), disabled: true,
    })), h("input", { type: "hidden", class: "req-branch", value: own || "" }));
  }
  const branchSel = branchField.querySelector("select");

  const linesWrap = h("div", { class: "lines-editor" });
  const addLine = () => {
    const row = h("div", { class: "line-row" },
      textInput({ placeholder: "Item description", class: "line-desc" }),
      h("input", { type: "number", min: "1", value: "1", class: "line-qty" }),
      textInput({ placeholder: "unit (opt)", class: "line-unit" }),
      h("button", { type: "button", class: "line-del", onclick: () => row.remove() }, "×"),
    );
    linesWrap.append(row);
  };
  addLine();

  const m = modal({
    title: "New request",
    size: "modal-lg",
    body: h("div", {},
      h("div", { class: "field-row" }, field("Type", typeSel), branchField),
      field("Title", titleInput),
      field("Description", descInput),
      h("div", { class: "field" },
        h("span", {}, "Items"),
        linesWrap,
        h("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: addLine }, "＋ Add item")),
    ),
    footer: [
      h("button", { class: "btn btn-secondary", onclick: () => m.close() }, "Cancel"),
      h("button", { class: "btn btn-primary", onclick: submit }, "Create request"),
    ],
  });

  async function submit() {
    const body = {
      type: typeSel.value,
      title: titleInput.value.trim() || null,
      description: descInput.value.trim() || null,
      lines: [],
    };
    if (session.isCentral) {
      if (!branchSel.value) return toast("Please choose a branch.", "error");
      body.branch_id = Number(branchSel.value);
    }
    for (const row of linesWrap.querySelectorAll(".line-row")) {
      const desc = row.querySelector(".line-desc").value.trim();
      if (!desc) continue;
      body.lines.push({
        description: desc,
        quantity: Number(row.querySelector(".line-qty").value) || 1,
        unit: row.querySelector(".line-unit").value.trim() || null,
      });
    }
    try {
      const created = await api.post("/requests", body);
      m.close();
      toast("Request created.", "success");
      location.hash = `#/requests/${created.id}`;
      onDone && onDone();
    } catch (e) {
      toast(e.message, "error");
    }
  }
}

/* ─────────── Detail view ─────────── */
async function renderDetail(view, id) {
  const body = h("div");
  view.append(body);

  async function reload() {
    clear(body);
    body.append(h("div", { class: "faint" }, "Loading…"));
    const req = await api.get(`/requests/${id}`);
    clear(body);

    body.append(
      h("button", { class: "back-link", onclick: () => { location.hash = "#/requests"; } }, "← All requests"),
      h("div", { class: "page-head" },
        h("h3", {}, `Request #${req.id}${req.title ? " · " + req.title : ""}`),
        h("span", { class: `status-pill-lg badge badge-${statusColor(req.status)}` }, titleCase(req.status)),
        badge(req.type),
      ),
    );

    const kv = h("dl", { class: "kv" },
      h("dt", {}, "Branch"), h("dd", {}, session.branchName(req.branch_id)),
      h("dt", {}, "Requested by"), h("dd", {}, `Staff #${req.requestor_id}`),
      h("dt", {}, "Created"), h("dd", {}, fmtDate(req.created_at)),
      h("dt", {}, "Type"), h("dd", {}, titleCase(req.type)),
    );
    if (req.description) {
      kv.append(h("dt", {}, "Description"), h("dd", {}, req.description));
    }

    const lines = req.lines && req.lines.length
      ? table([
          { key: "description", label: "Item" },
          { key: "quantity", label: "Qty", num: true },
          { key: "unit", label: "Unit", render: (l) => l.unit || "—" },
        ], req.lines)
      : emptyState("No line items.");

    const timeline = h("ul", { class: "timeline" });
    if (!req.approvals || !req.approvals.length) {
      timeline.append(h("li", {}, h("span", { class: "tl-meta" }, "No approvals yet.")));
    }
    for (const a of req.approvals || []) {
      timeline.append(h("li", { class: a.action === "REJECT" ? "rejected" : "" },
        h("div", { class: "tl-action" },
          titleCase(a.action), h("span", { class: "faint" }, ` by staff #${a.approver_id}`)),
        h("div", { class: "tl-meta" },
          `${titleCase(a.from_status || "—")} → ${titleCase(a.to_status || "—")} · ${fmtDate(a.created_at)}`),
        a.comment ? h("div", { class: "tl-comment" }, `“${a.comment}”`) : null,
      ));
    }

    body.append(h("div", { class: "detail-grid" },
      card("Details", h("div", { class: "card-body" }, kv)),
      card("Approval history", h("div", { class: "card-body" }, timeline)),
      h("div", { class: "full" }, card("Line items", lines)),
      h("div", { class: "full" }, h("div", { class: "action-panel" }, actionPanel(req, reload))),
    ));
  }

  await reload();
}

function statusColor(s) {
  if (s.includes("PENDING")) return "amber";
  if (["REJECTED", "DISPUTED"].includes(s)) return "red";
  if (["PAID"].includes(s)) return "purple";
  if (["VERIFIED", "SENT_TO_SCHOOL", "IN_STORE", "CATALOGUED"].includes(s)) return "green";
  return "blue";
}

/* ─────────── Action panel ─────────── */
function actionPanel(req, reload) {
  const can = (...roles) => session.hasRole(...roles);
  const s = req.status;
  const isBook = req.type === "BOOK";
  const buttons = [];
  const panel = h("div");

  const simple = (label, path, cls, body = {}) => h("button", {
    class: `btn ${cls}`,
    onclick: async () => {
      try { await api.post(path, body); toast("Done.", "success"); reload(); }
      catch (e) { toast(e.message, "error"); }
    },
  }, label);

  const withComment = (label, path, cls, action) => h("button", {
    class: `btn ${cls}`,
    onclick: () => commentModal(label, async (comment) => {
      await api.post(path, { comment });
      action();
    }),
  }, label);

  const approveBtn = (roles, cls = "btn-success") => {
    if (!can(...roles)) return;
    buttons.push(withComment("Approve", `/requests/${req.id}/approve`, cls, reload));
  };
  const rejectBtn = (roles) => {
    if (!can(...roles)) return;
    buttons.push(withComment("Reject", `/requests/${req.id}/reject`, "btn-danger", reload));
  };

  let note = "";
  if (s === "PENDING_ACADEMIC") { approveBtn(["ACADEMIC_MASTER"]); rejectBtn(["ACADEMIC_MASTER"]); note = "Awaiting academic master review."; }
  else if (s === "PENDING_HEAD_MASTER") { approveBtn(["HEAD_MASTER"]); rejectBtn(["HEAD_MASTER"]); note = "Awaiting head master approval."; }
  else if (s === "PENDING_APPROVAL") { approveBtn(["ACADEMIC_MASTER", "HEAD_MASTER"]); rejectBtn(["ACADEMIC_MASTER", "HEAD_MASTER"]); note = "Awaiting academic master or head master approval."; }
  else if (s === "APPROVED") {
    if (can("LIBRARIAN")) buttons.push(simple("Create requisition", `/requests/${req.id}/requisition`, "btn-primary"));
    note = "Approved. A librarian must raise a requisition.";
  } else if (s === "PENDING_BURSAR") {
    if (can("BURSAR")) buttons.push(h("button", { class: "btn btn-primary", onclick: () => purchaseOrderModal(req, reload) }, "Create purchase order"));
    note = "Awaiting the bursar to raise a purchase order.";
  } else if (s === "PENDING_MANAGER") {
    if (can("MANAGER")) {
      buttons.push(h("button", { class: "btn btn-success", onclick: () => managerDecision(req, true, reload) }, "Approve"));
      buttons.push(h("button", { class: "btn btn-danger", onclick: () => managerDecision(req, false, reload) }, "Reject"));
    }
    note = "Awaiting manager approval.";
  } else if (s === "PENDING_ORDER") {
    if (can("STOREKEEPER")) buttons.push(simple("Place order", `/requests/${req.id}/order`, "btn-primary"));
    note = "Approved. The storekeeper must place the order.";
  } else if (s === "ORDERED") {
    if (can("STOREKEEPER")) buttons.push(receiveButton(req, reload));
    note = "Ordered. Awaiting delivery.";
  } else if (s === "RECEIVED") {
    if (req.requestor_id === session.user.id) buttons.push(h("button", { class: "btn btn-primary", onclick: () => verifyModal(req, reload) }, "Verify delivery"));
    else note = "Awaiting the requester's verification.";
    note = note || "Awaiting the requester's verification.";
  } else if (s === "VERIFIED") {
    if (can("BURSAR")) buttons.push(h("button", { class: "btn btn-primary", onclick: () => payModal(req, reload) }, "Record payment"));
    note = "Verified. Awaiting payment.";
  } else if (s === "PAID") {
    if (isBook && can("STOREKEEPER")) buttons.push(simple("Send to school", `/requests/${req.id}/send-to-school`, "btn-primary"));
    if (!isBook && can("LIBRARIAN")) buttons.push(simple("Move to store", `/requests/${req.id}/move-to-store`, "btn-primary"));
    note = "Paid. Awaiting dispatch.";
  } else if (s === "SENT_TO_SCHOOL") {
    if (can("LIBRARIAN")) buttons.push(simple("Catalogue books", "/library/catalogue", "btn-primary", { request_id: req.id }));
    note = "Delivered to school. A librarian must catalogue the books.";
  } else if (s === "REJECTED") note = "This request was rejected.";
  else if (s === "DISPUTED") note = "Delivery was disputed. Check with the storekeeper.";
  else if (s === "IN_STORE" || s === "CATALOGUED") note = "This request is complete.";

  panel.append(
    h("h4", {}, "Next step"),
    h("p", { class: "desc" }, note),
    buttons.length ? h("div", { class: "action-row" }, buttons)
      : h("p", { class: "faint" }, "No action available for your role at this stage."),
  );
  return panel;
}

/* ─────────── Sub-modals ─────────── */
function commentModal(label, onConfirm) {
  const comment = h("textarea", { placeholder: "Optional comment" });
  const m = modal({
    title: label,
    body: field("Comment", comment),
    footer: [
      h("button", { class: "btn btn-secondary", onclick: () => m.close() }, "Cancel"),
      h("button", {
        class: "btn btn-primary",
        onclick: async () => {
          try { await onConfirm(comment.value.trim() || null); m.close(); toast("Done.", "success"); }
          catch (e) { toast(e.message, "error"); }
        },
      }, "Confirm"),
    ],
  });
}

async function purchaseOrderModal(req, reload) {
  let suppliers = [];
  try { suppliers = await api.get("/suppliers"); } catch { suppliers = []; }
  const supplierSel = selectInput(suppliers.map((s) => ({ value: s.id, label: s.name })));
  const amount = h("input", { type: "number", min: "0", step: "0.01", placeholder: "e.g. 80000" });
  if (!suppliers.length) {
    supplierSel.append(h("option", { value: "" }, "No suppliers — add one first"));
  }
  const m = modal({
    title: "Create purchase order",
    body: h("div", {},
      field("Supplier", supplierSel),
      field("Total amount (TZS)", amount, "Must be greater than zero."),
    ),
    footer: [
      h("button", { class: "btn btn-secondary", onclick: () => m.close() }, "Cancel"),
      h("button", {
        class: "btn btn-primary",
        onclick: async () => {
          if (!supplierSel.value) return toast("Choose a supplier.", "error");
          if (!(Number(amount.value) > 0)) return toast("Enter a valid amount.", "error");
          try {
            await api.post(`/requests/${req.id}/purchase-order`, {
              supplier_id: Number(supplierSel.value),
              total_amount: amount.value,
            });
            m.close(); toast("Purchase order created.", "success"); reload();
          } catch (e) { toast(e.message, "error"); }
        },
      }, "Create"),
    ],
  });
}

function managerDecision(req, approve, reload) {
  const comment = h("textarea", { placeholder: "Optional comment" });
  const m = modal({
    title: approve ? "Approve purchase order" : "Reject purchase order",
    body: field("Comment", comment),
    footer: [
      h("button", { class: "btn btn-secondary", onclick: () => m.close() }, "Cancel"),
      h("button", {
        class: `btn ${approve ? "btn-success" : "btn-danger"}`,
        onclick: async () => {
          try {
            await api.post(`/requests/${req.id}/manager-approval`, {
              approve, comment: comment.value.trim() || null,
            });
            m.close(); toast("Decision recorded.", "success"); reload();
          } catch (e) { toast(e.message, "error"); }
        },
      }, approve ? "Approve" : "Reject"),
    ],
  });
}

function receiveButton(req, reload) {
  return h("button", {
    class: "btn btn-primary",
    onclick: () => {
      const note = textInput({ placeholder: "Delivery note reference (optional)" });
      const m = modal({
        title: "Receive delivery",
        body: field("Delivery note", note),
        footer: [
          h("button", { class: "btn btn-secondary", onclick: () => m.close() }, "Cancel"),
          h("button", {
            class: "btn btn-primary",
            onclick: async () => {
              try {
                await api.post(`/requests/${req.id}/receive`, { delivery_note: note.value.trim() || null });
                m.close(); toast("Delivery received.", "success"); reload();
              } catch (e) { toast(e.message, "error"); }
            },
          }, "Confirm receipt"),
        ],
      });
    },
  }, "Receive delivery");
}

function verifyModal(req, reload) {
  const matched = selectInput([
    { value: "true", label: "Yes — matches the order" },
    { value: "false", label: "No — dispute delivery" },
  ]);
  const note = h("textarea", { placeholder: "Optional note" });
  const m = modal({
    title: "Verify delivery",
    body: h("div", {}, field("Does it match?", matched), field("Note", note)),
    footer: [
      h("button", { class: "btn btn-secondary", onclick: () => m.close() }, "Cancel"),
      h("button", {
        class: "btn btn-primary",
        onclick: async () => {
          try {
            await api.post(`/requests/${req.id}/verify`, {
              matched: matched.value === "true", note: note.value.trim() || null,
            });
            m.close(); toast("Verification recorded.", "success"); reload();
          } catch (e) { toast(e.message, "error"); }
        },
      }, "Submit"),
    ],
  });
}

function payModal(req, reload) {
  const amount = h("input", { type: "number", min: "0", step: "0.01", placeholder: "Leave blank to pay the full PO total" });
  const reference = textInput({ placeholder: "Payment reference (optional)" });
  const m = modal({
    title: "Record payment",
    body: h("div", {}, field("Amount (TZS)", amount), field("Reference", reference)),
    footer: [
      h("button", { class: "btn btn-secondary", onclick: () => m.close() }, "Cancel"),
      h("button", {
        class: "btn btn-primary",
        onclick: async () => {
          const body = {};
          if (amount.value) body.amount = amount.value;
          if (reference.value.trim()) body.reference = reference.value.trim();
          try {
            await api.post(`/requests/${req.id}/pay`, body);
            m.close(); toast("Payment recorded.", "success"); reload();
          } catch (e) { toast(e.message, "error"); }
        },
      }, "Record payment"),
    ],
  });
}
