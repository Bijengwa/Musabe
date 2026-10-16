/* API client + shared session state. */

const API = "";

const store = {
  get tokens() {
    try { return JSON.parse(localStorage.getItem("musabe_tokens")) || null; }
    catch { return null; }
  },
  set tokens(v) {
    if (v) localStorage.setItem("musabe_tokens", JSON.stringify(v));
    else localStorage.removeItem("musabe_tokens");
  },
};

export const session = {
  user: null,
  branches: [],
  get branchMap() {
    const m = {};
    for (const b of this.branches) m[b.id] = b;
    return m;
  },
  get roles() {
    return (this.user?.assignments || []).map((a) => a.role);
  },
  hasRole(...roles) {
    const mine = this.roles;
    return roles.some((r) => mine.includes(r));
  },
  get isCentral() {
    return this.hasRole("ADMIN", "MANAGER", "BURSAR", "STOREKEEPER");
  },
  branchName(id) {
    if (id == null) return "—";
    const b = this.branches.find((x) => x.id === id);
    return b ? b.name : `#${id}`;
  },
};

async function request(method, path, body) {
  const headers = {};
  const tokens = store.tokens;
  if (tokens) headers.Authorization = `Bearer ${tokens.access_token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(API + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && !path.startsWith("/auth/login")) {
    store.tokens = null;
    session.user = null;
    window.dispatchEvent(new Event("musabe:logout"));
    throw new Error("Session expired — please sign in again.");
  }

  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }

  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    if (data && typeof data === "object" && data.detail) {
      msg = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    }
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (path) => request("GET", path),
  post: (path, body) => request("POST", path, body ?? {}),
  patch: (path, body) => request("PATCH", path, body ?? {}),

  async login(email, password) {
    const tokens = await request("POST", "/auth/login", { email, password });
    store.tokens = tokens;
    try {
      session.user = await request("GET", "/auth/me");
      session.branches = await request("GET", "/branches");
    } catch (e) {
      store.tokens = null;
      throw e;
    }
    return session.user;
  },

  async restore() {
    if (!store.tokens) return false;
    try {
      session.user = await request("GET", "/auth/me");
      session.branches = await request("GET", "/branches");
      return true;
    } catch {
      store.tokens = null;
      return false;
    }
  },

  logout() {
    store.tokens = null;
    session.user = null;
  },
};
