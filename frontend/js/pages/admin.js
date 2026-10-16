/* Administration: branches and staff management (ADMIN only). */

import { api, session } from "../api.js";
import {
  h, clear, table, emptyState, card, modal, field,
  textInput, selectInput, fmtDate, toast, roleTag, badge,
} from "../ui.js";

const CENTRAL_ROLES = ["ADMIN", "MANAGER", "BURSAR", "STOREKEEPER"];
const SCHOOL_ROLES = ["HEAD_MASTER", "ACADEMIC_MASTER", "LIBRARIAN", "REQUESTING_STAFF"];
const ALL_ROLES = [...CENTRAL_ROLES, ...SCHOOL_ROLES];
const isSchoolRole = (r) => SCHOOL_ROLES.includes(r);

let activeTab = "staff";

export async function render(view) {
  view.append(h("div", { class: "page-head" }, h("h3", {}, "Administration")));
  const tabs = h("div", { class: "tab-row" },
    h("button", { class: `tab ${activeTab === "staff" ? "active" : ""}`, onclick: () => { activeTab = "staff"; rerender(); } }, "Staff"),
    h("button", { class: `tab ${activeTab === "branches" ? "active" : ""}`, onclick: () => { activeTab = "branches"; rerender(); } }, "Branches"),
  );
  const body = h("div");
  view.append(tabs, body);

  function rerender() {
    tabs.querySelectorAll(".tab").forEach((t, i) =>
      t.classList.toggle("active", (i === 0) === (activeTab === "staff")));
    clear(body);
    (activeTab === "staff" ? renderStaff : renderBranches)(body);
  }

  rerender();
}

/* ─────────── Staff ─────────── */
async function renderStaff(host) {
  const wrap = h("div");
  const head = h("div", { class: "page-head" },
    h("h3", { style: "font-size:15px" }, "Staff accounts"),
    h("button", { class: "btn btn-primary", onclick: () => staffModal(null, reload) }, "＋ Add staff"),
  );
  host.append(head, wrap);

  async function reload() {
    clear(wrap);
    wrap.append(h("div", { class: "faint" }, "Loading…"));
    const rows = await api.get("/admin/staff");
    clear(wrap);
    wrap.append(card(`Staff (${rows.length})`, rows.length ? table([
      { key: "full_name", label: "Name" },
      { key: "email", label: "Email" },
      {
        key: "roles", label: "Roles",
        render: (r) => h("span", {}, r.assignments.map((a) => roleTag(a.role))),
      },
      {
        key: "branches", label: "Branches",
        render: (r) => {
          const names = r.assignments.filter((a) => a.branch_id).map((a) => session.branchName(a.branch_id));
          return names.length ? names.join(", ") : h("span", { class: "faint" }, "Central (all)");
        },
      },
      {
        key: "is_active", label: "Status",
        render: (r) => r.is_active
          ? h("span", { class: "badge badge-green" }, "Active")
          : h("span", { class: "badge badge-gray" }, "Inactive"),
      },
      {
        key: "actions", label: "",
        render: (r) => h("button", { class: "btn btn-secondary btn-sm", onclick: () => staffModal(r, reload) }, "Edit"),
      },
    ], rows) : emptyState("No staff accounts.", "👤")));
  }

  await reload();
}

function branchCheckboxes(selectedIds = [], roleValue) {
  const wrap = h("div", { class: "field" }, h("span", {}, "Branches"));
  const box = h("div");
  const refresh = () => {
    clear(box);
    if (!isSchoolRole(roleValue.value)) {
      box.append(h("div", { class: "field-hint" }, "Central roles apply to all branches."));
      return;
    }
    for (const b of session.branches) {
      const cb = h("input", { type: "checkbox", value: b.id, checked: selectedIds.includes(b.id) });
      box.append(h("label", { style: "display:flex;gap:8px;align-items:center;margin:5px 0;font-size:13.5px" },
        cb, b.name));
    }
  };
  roleValue.addEventListener("change", refresh);
  refresh();
  wrap.append(box);
  wrap._getSelection = () =>
    [...box.querySelectorAll("input[type=checkbox]:checked")].map((c) => Number(c.value));
  return wrap;
}

function staffModal(staff, onDone) {
  const editing = !!staff;
  const currentRole = staff?.assignments?.[0]?.role || "REQUESTING_STAFF";
  const currentBranches = staff?.assignments?.map((a) => a.branch_id).filter(Boolean) || [];

  const name = textInput({ value: staff?.full_name || "", placeholder: "Full name" });
  const email = textInput({ type: "email", value: staff?.email || "", placeholder: "name@musabe.ac.ug", disabled: editing });
  const password = textInput({ type: "password", placeholder: "Temporary password" });
  const role = selectInput(ALL_ROLES.map((r) => ({ value: r, label: r.replace(/_/g, " "), selected: r === currentRole })));
  const branches = branchCheckboxes(currentBranches, role);
  const activeSel = editing
    ? selectInput([
        { value: "true", label: "Active", selected: staff.is_active },
        { value: "false", label: "Inactive", selected: !staff.is_active },
      ])
    : null;

  const body = h("div", {},
    field("Full name", name),
    field("Email", email),
    editing ? null : field("Password", password, "The user can change this later."),
    field("Role", role),
    branches,
    editing ? field("Account status", activeSel) : null,
  );

  const m = modal({
    title: editing ? `Edit ${staff.full_name}` : "Add staff",
    body,
    footer: [
      h("button", { class: "btn btn-secondary", onclick: () => m.close() }, "Cancel"),
      h("button", { class: "btn btn-primary", onclick: submit }, editing ? "Save changes" : "Create account"),
    ],
  });

  async function submit() {
    const branch_ids = branches._getSelection();
    if (isSchoolRole(role.value) && branch_ids.length === 0) {
      return toast("Choose at least one branch for a school role.", "error");
    }
    try {
      if (editing) {
        await api.patch(`/admin/staff/${staff.id}`, {
          role: role.value,
          branch_ids,
          is_active: activeSel.value === "true",
        });
      } else {
        if (!name.value.trim() || !email.value.trim() || !password.value) {
          return toast("Name, email, and password are required.", "error");
        }
        await api.post("/admin/staff", {
          full_name: name.value.trim(),
          email: email.value.trim(),
          password: password.value,
          role: role.value,
          branch_ids,
        });
      }
      m.close(); toast(editing ? "Staff updated." : "Staff created.", "success"); onDone();
    } catch (e) { toast(e.message, "error"); }
  }
}

/* ─────────── Branches ─────────── */
async function renderBranches(host) {
  const wrap = h("div");
  host.append(
    h("div", { class: "page-head" },
      h("h3", { style: "font-size:15px" }, "School branches"),
      h("button", { class: "btn btn-primary", onclick: () => branchModal(reload) }, "＋ Add branch"),
    ),
    wrap,
  );

  async function reload() {
    clear(wrap);
    wrap.append(h("div", { class: "faint" }, "Loading…"));
    const rows = await api.get("/admin/branches");
    session.branches = rows;
    clear(wrap);
    wrap.append(card(`Branches (${rows.length})`, rows.length ? table([
      { key: "id", label: "#" },
      { key: "name", label: "Name" },
      { key: "type", label: "Type", render: (r) => badge(r.type) },
      {
        key: "is_active", label: "Status",
        render: (r) => r.is_active
          ? h("span", { class: "badge badge-green" }, "Active")
          : h("span", { class: "badge badge-gray" }, "Inactive"),
      },
    ], rows) : emptyState("No branches.", "🏫")));
  }

  await reload();
}

function branchModal(onDone) {
  const name = textInput({ placeholder: "e.g. Nursery & Primary" });
  const type = selectInput([
    { value: "PRIMARY", label: "PRIMARY" },
    { value: "SECONDARY", label: "SECONDARY" },
  ]);
  const m = modal({
    title: "Add branch",
    body: h("div", {}, field("Name", name), field("Type", type)),
    footer: [
      h("button", { class: "btn btn-secondary", onclick: () => m.close() }, "Cancel"),
      h("button", {
        class: "btn btn-primary",
        onclick: async () => {
          if (!name.value.trim()) return toast("Enter a branch name.", "error");
          try {
            await api.post("/admin/branches", { name: name.value.trim(), type: type.value });
            m.close(); toast("Branch created.", "success"); onDone();
          } catch (e) { toast(e.message, "error"); }
        },
      }, "Create"),
    ],
  });
}
