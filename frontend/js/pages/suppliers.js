/* Suppliers: manage procurement suppliers (Admin / Bursar). */

import { api } from "../api.js";
import {
  h, clear, table, emptyState, card, modal, field,
  textInput, fmtDate, toast,
} from "../ui.js";

export async function render(view) {
  view.append(
    h("div", { class: "page-head" },
      h("h3", {}, "Suppliers"),
      h("button", { class: "btn btn-primary", onclick: () => newSupplierModal(reload) }, "＋ Add supplier"),
    ),
  );

  const body = h("div");
  view.append(body);

  async function reload() {
    clear(body);
    body.append(h("div", { class: "faint" }, "Loading…"));
    const rows = await api.get("/suppliers");
    clear(body);
    body.append(card(`Suppliers (${rows.length})`, rows.length ? table([
      { key: "name", label: "Name" },
      { key: "contact_person", label: "Contact", render: (r) => r.contact_person || "—" },
      { key: "phone", label: "Phone", render: (r) => r.phone || "—" },
      { key: "email", label: "Email", render: (r) => r.email || "—" },
      { key: "address", label: "Address", render: (r) => r.address || "—" },
      { key: "created_at", label: "Added", render: (r) => fmtDate(r.created_at) },
    ], rows) : emptyState("No suppliers yet. Add one to create purchase orders.", "🏢")));
  }

  await reload();
}

function newSupplierModal(onDone) {
  const name = textInput({ placeholder: "Supplier name" });
  const contact = textInput({ placeholder: "Contact person" });
  const phone = textInput({ placeholder: "Phone" });
  const email = textInput({ type: "email", placeholder: "Email" });
  const address = h("textarea", { placeholder: "Address" });

  const m = modal({
    title: "Add supplier",
    body: h("div", {},
      field("Name", name),
      h("div", { class: "field-row" }, field("Contact person", contact), field("Phone", phone)),
      field("Email", email),
      field("Address", address),
    ),
    footer: [
      h("button", { class: "btn btn-secondary", onclick: () => m.close() }, "Cancel"),
      h("button", {
        class: "btn btn-primary",
        onclick: async () => {
          const body = {
            name: name.value.trim(),
            contact_person: contact.value.trim() || null,
            phone: phone.value.trim() || null,
            email: email.value.trim() || null,
            address: address.value.trim() || null,
          };
          if (!body.name) return toast("Enter a supplier name.", "error");
          try {
            await api.post("/suppliers", body);
            m.close(); toast("Supplier added.", "success"); onDone();
          } catch (e) { toast(e.message, "error"); }
        },
      }, "Add"),
    ],
  });
}
