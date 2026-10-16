/* App shell: login, navigation, hash router. */

import { api, session } from "./api.js";
import { h, clear, toast, roleTag } from "./ui.js";

import * as dashboard from "./pages/dashboard.js";
import * as requests from "./pages/requests.js";
import * as library from "./pages/library.js";
import * as issuing from "./pages/issuing.js";
import * as inventory from "./pages/inventory.js";
import * as writeoffs from "./pages/writeoffs.js";
import * as contributions from "./pages/contributions.js";
import * as suppliers from "./pages/suppliers.js";
import * as admin from "./pages/admin.js";

/* ─────────── Routes & navigation ─────────── */
const ROUTES = {
  dashboard: { title: "Dashboard", page: dashboard },
  requests: { title: "Requests", page: requests },
  library: { title: "Library", page: library },
  issuing: { title: "Issuing", page: issuing },
  inventory: { title: "Inventory", page: inventory },
  writeoffs: { title: "Write-offs", page: writeoffs },
  contributions: { title: "Contributions", page: contributions },
  suppliers: { title: "Suppliers", page: suppliers },
  admin: { title: "Administration", page: admin },
};

const NAV = [
  { section: "Overview", items: [{ route: "dashboard", label: "Dashboard", icon: "📊" }] },
  {
    section: "Operations",
    items: [
      { route: "requests", label: "Requests", icon: "📋" },
      { route: "library", label: "Library", icon: "📚" },
      { route: "issuing", label: "Issuing", icon: "🔄" },
      { route: "inventory", label: "Inventory", icon: "📦" },
    ],
  },
  {
    section: "Records",
    items: [
      { route: "writeoffs", label: "Write-offs", icon: "🗑️" },
      { route: "contributions", label: "Contributions", icon: "🎁" },
      { route: "suppliers", label: "Suppliers", icon: "🏢", roles: ["ADMIN", "BURSAR"] },
    ],
  },
  {
    section: "Administration",
    items: [{ route: "admin", label: "Branches & Staff", icon: "⚙️", roles: ["ADMIN"] }],
  },
];

const view = document.getElementById("view");
const loginView = document.getElementById("login-view");
const appView = document.getElementById("app-view");

/* ─────────── Navigation rendering ─────────── */
function renderNav(active) {
  const nav = document.getElementById("sidebar-nav");
  clear(nav);
  for (const group of NAV) {
    const items = group.items.filter(
      (it) => !it.roles || session.hasRole(...it.roles),
    );
    if (!items.length) continue;
    nav.append(h("div", { class: "nav-section" }, group.section));
    for (const it of items) {
      nav.append(h("button", {
        class: `nav-item ${it.route === active ? "active" : ""}`,
        onclick: () => { location.hash = `#/${it.route}`; closeSidebar(); },
      }, h("span", { class: "nav-icon" }, it.icon), it.label));
    }
  }
}

function renderUser() {
  const u = session.user;
  document.getElementById("user-name").textContent = u.full_name;
  const rolesEl = document.getElementById("user-roles");
  clear(rolesEl);
  for (const r of session.roles) rolesEl.append(roleTag(r));
  document.getElementById("user-avatar").textContent =
    (u.full_name || "?").trim().charAt(0).toUpperCase();
}

/* ─────────── Router ─────────── */
export function setPageTitle(title) {
  document.getElementById("page-title").textContent = title;
}

async function route() {
  if (!session.user) return;
  const raw = (location.hash || "#/dashboard").replace(/^#\/?/, "");
  const [name, ...params] = raw.split("/");
  const def = ROUTES[name] || ROUTES.dashboard;

  renderNav(name);
  setPageTitle(def.title);
  clear(view);
  view.append(h("div", { class: "faint" }, "Loading…"));
  try {
    clear(view);
    await def.page.render(view, params);
  } catch (e) {
    if (e.name === "AuthError") return;
    clear(view);
    view.append(
      h("div", { class: "card" }, h("div", { class: "card-body" },
        h("p", { class: "empty" }, `Could not load page: ${e.message}`))),
    );
  }
}

/* ─────────── Login / logout ─────────── */
function showLogin() {
  appView.classList.add("hidden");
  loginView.classList.remove("hidden");
  document.getElementById("login-email").focus();
}

function showApp() {
  loginView.classList.add("hidden");
  appView.classList.remove("hidden");
  renderUser();
  route();
}

const loginForm = document.getElementById("login-form");
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("login-btn");
  const errEl = document.getElementById("login-error");
  errEl.classList.add("hidden");
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  btn.disabled = true;
  btn.textContent = "Signing in…";
  try {
    await api.login(email, password);
    if (!location.hash) location.hash = "#/dashboard";
    showApp();
  } catch (err) {
    errEl.textContent = err.message || "Sign in failed";
    errEl.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "Sign in";
  }
});

for (const chip of document.querySelectorAll(".chip")) {
  chip.addEventListener("click", () => {
    document.getElementById("login-email").value = chip.dataset.email;
    document.getElementById("login-password").value = chip.dataset.password;
    document.getElementById("login-email").focus();
  });
}

document.getElementById("logout-btn").addEventListener("click", () => {
  api.logout();
  showLogin();
});

window.addEventListener("musabe:logout", () => {
  showLogin();
  toast("Your session expired. Please sign in again.", "error");
});

/* ─────────── Mobile sidebar ─────────── */
function closeSidebar() {
  document.querySelector(".sidebar")?.classList.remove("open");
}
document.getElementById("menu-toggle").addEventListener("click", () => {
  document.querySelector(".sidebar")?.classList.toggle("open");
});

window.addEventListener("hashchange", route);

/* ─────────── Boot ─────────── */
(async function boot() {
  if (await api.restore()) showApp();
  else showLogin();
})();
