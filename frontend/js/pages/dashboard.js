/* Dashboard: live overview from /reports/*. */

import { api, session } from "../api.js";
import {
  h, clear, badge, statCard, card, table, emptyState,
  fmtMoney, fmtDate, titleCase, selectInput,
} from "../ui.js";

export async function render(view, _params) {
  const branchWrap = h("span");
  const content = h("div");
  view.append(
    h("div", { class: "page-head" }, h("h3", {}, "Overview"), branchWrap),
    content,
  );

  if (session.isCentral) {
    branchWrap.append(selectInput([
      { value: "", label: "All branches" },
      ...session.branches.map((b) => ({ value: b.id, label: b.name })),
    ], { onchange: (e) => load(e.target.value) }));
  }

  await load("");

  async function load(branchId) {
    clear(content);
    content.append(h("div", { class: "faint" }, "Loading…"));
    const q = branchId ? `?branch_id=${branchId}` : "";
    const [overview, spend, activity, actions] = await Promise.all([
      api.get(`/reports/overview${q}`),
      api.get(`/reports/spend${q}`),
      api.get(`/reports/activity?limit=12${branchId ? `&branch_id=${branchId}` : ""}`),
      api.get("/reports/my-actions"),
    ]);
    clear(content);

    const available = (overview.book_copies_by_status || [])
      .find((r) => r.status === "AVAILABLE")?.count ?? 0;

    content.append(
      h("div", { class: "stat-grid" },
        statCard("Total requests", overview.total_requests),
        statCard("Pending requests", overview.pending_requests, "awaiting an action"),
        statCard("Book copies", overview.total_book_copies, `${available} available`),
        statCard("Outstanding loans", overview.outstanding_issues),
        statCard("Stock items", overview.stock_items, `${overview.low_stock_items} low`),
        statCard("Pending write-offs", overview.pending_writeoffs),
        statCard("Total ordered", fmtMoney(overview.total_ordered)),
        statCard("Total paid", fmtMoney(overview.total_paid)),
      ),
    );

    const actionList = h("ul", { class: "feed" });
    if (!actions.length) {
      actionList.append(emptyState("Nothing is waiting on you right now."));
    }
    for (const a of actions) {
      actionList.append(h("li", {},
        h("span", { class: "feed-dot" }),
        h("div", { class: "feed-main" },
          h("div", { class: "feed-action" }, badge(a.status), " ", a.label),
          h("div", { class: "feed-detail" },
            a.branch_id ? `${a.action} · ${session.branchName(a.branch_id)}` : a.action)),
        h("button", {
          class: "btn btn-primary btn-sm",
          onclick: () => { location.hash = a.route; },
        }, "Open"),
      ));
    }
    content.append(
      h("div", { class: "section-gap" },
        card("Awaiting your action", h("div", { class: "card-body" }, actionList))),
    );

    const byStatus = h("div", { class: "card-body" });
    const statuses = overview.requests_by_status || [];
    const max = Math.max(1, ...statuses.map((s) => s.count));
    if (!statuses.length) byStatus.append(emptyState("No requests yet."));
    for (const s of statuses) {
      byStatus.append(h("div", { style: "display:flex;align-items:center;gap:10px;padding:6px 0" },
        h("span", { style: "width:190px" }, badge(s.status)),
        h("div", { style: "flex:1;background:var(--gray-bg);border-radius:6px;height:8px;overflow:hidden" },
          h("div", { style: `width:${(s.count / max) * 100}%;height:100%;background:var(--primary)` })),
        h("strong", { style: "width:34px;text-align:right" }, s.count),
      ));
    }

    const feed = h("ul", { class: "feed" });
    if (!activity.length) feed.append(emptyState("No recent activity."));
    for (const a of activity) {
      feed.append(h("li", {},
        h("span", { class: "feed-dot" }),
        h("div", { class: "feed-main" },
          h("div", { class: "feed-action" },
            titleCase(a.action),
            a.request_id ? h("span", { class: "faint" }, ` · request #${a.request_id}`) : null),
          a.from_status || a.to_status
            ? h("div", { class: "feed-detail" },
                `${titleCase(a.from_status || "—")} → ${titleCase(a.to_status || "—")}`)
            : null,
          a.detail ? h("div", { class: "feed-detail" }, a.detail) : null),
        h("span", { class: "feed-time" }, fmtDate(a.created_at)),
      ));
    }

    const spendTable = spend.length
      ? table([
          { key: "branch_name", label: "Branch", render: (r) => r.branch_name || session.branchName(r.branch_id) },
          { key: "total_ordered", label: "Ordered", num: true, render: (r) => fmtMoney(r.total_ordered) },
          { key: "total_paid", label: "Paid", num: true, render: (r) => fmtMoney(r.total_paid) },
        ], spend)
      : emptyState("No procurement spend yet.");

    content.append(h("div", { class: "dash-grid section-gap" },
      card("Requests by status", byStatus),
      card("Recent activity", h("div", { class: "card-body" }, feed)),
      h("div", { class: "full" }, card("Spend by branch", spendTable)),
    ));
  }
}
