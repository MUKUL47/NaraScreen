// ─── Acme Tasks: a fake team task-tracker (NaraScreen demo + test target) ─
//
// Plain browser JavaScript, no build step, no network. State lives in
// localStorage so a fresh browser profile always starts from the same seed:
//   acme.session   who is signed in (any non-empty email + password works)
//   acme.tasks     the task list (seeded on first load, dates relative to today)
//   acme.settings  profile, notification switches, API key
//
// Routes are hash routes: #/login, #/dashboard, #/tasks, #/settings. Signed-out
// visitors to a protected route are sent to #/login?next=<route>.
//
// The markup is deliberately accessible (labels, roles, aria-labels, one h1 per
// page) because demo scripts find elements the way assistive tech does:
// role + accessible name, label, text.

(function () {
  "use strict";

  const KEYS = { session: "acme.session", tasks: "acme.tasks", settings: "acme.settings" };
  const DAY = 24 * 60 * 60 * 1000;
  const PRIORITIES = ["Low", "Medium", "High"];
  const TEAM = { "Priya Shah": 262, "Jordan Lee": 199, "Sam Rivera": 24, "Mei Chen": 150 };

  const app = document.getElementById("app");
  const toastRegion = document.getElementById("toasts");

  // ─── tiny safe templating ──────────────────────────────────────────
  // html`…${value}…` escapes every value unless it is already html (Raw), so
  // task titles typed by a user can never inject markup.

  class Raw {
    constructor(s) {
      this.s = s;
    }
    toString() {
      return this.s;
    }
  }
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function fmt(v) {
    if (v == null || v === false) return "";
    if (Array.isArray(v)) return v.map(fmt).join("");
    if (v instanceof Raw) return v.s;
    return String(v).replace(/[&<>"']/g, (c) => ESC[c]);
  }
  function html(strings, ...values) {
    let out = "";
    strings.forEach((s, i) => {
      out += s;
      if (i < values.length) out += fmt(values[i]);
    });
    return new Raw(out);
  }

  const ICONS = {
    dashboard:
      '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    tasks: '<path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>',
    settings:
      '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    trash:
      '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>',
    close: '<path d="M18 6L6 18M6 6l12 12"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
    alert:
      '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    trend: '<path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/>',
    done: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    refresh: '<path d="M23 4v6h-6"/><path d="M20.5 15a9 9 0 1 1-2.1-9.4L23 10"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  };
  const icon = (name) =>
    new Raw(`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`);
  const LOGO = new Raw(
    '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect width="32" height="32" rx="8" fill="#4f46e5"/><path d="M9 16.5l4.5 4.5L23 11.5" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  );

  // ─── storage ───────────────────────────────────────────────────────

  function load(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  }
  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage full or blocked: the app still works for this page view */
    }
  }

  // ─── dates (stored as local YYYY-MM-DD) ────────────────────────────

  function isoDate(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function parseIso(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  function today() {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }
  function daysFromToday(s) {
    return Math.round((parseIso(s) - today()) / DAY);
  }
  function fmtDue(s) {
    if (!s) return "No due date";
    const n = daysFromToday(s);
    if (n === 0) return "Today";
    if (n === 1) return "Tomorrow";
    if (n === -1) return "Yesterday";
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(parseIso(s));
  }
  function relDue(s) {
    if (!s) return "No due date";
    const n = daysFromToday(s);
    if (n < -1) return `${-n} days overdue`;
    if (n > 1) return `In ${n} days`;
    return fmtDue(s);
  }

  // ─── session / people ──────────────────────────────────────────────

  function nameFromEmail(email) {
    const local = email.split("@")[0] || email;
    return local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(" ");
  }
  function initials(name) {
    const parts = name.trim().split(/\s+/);
    return ((parts[0] || "?")[0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  }
  function hueFor(name) {
    if (TEAM[name] != null) return TEAM[name];
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
    return h;
  }
  function avatar(name, small) {
    return html`<span class="avatar${small ? " avatar-sm" : ""}" style="--hue:${hueFor(name)}" aria-hidden="true">${initials(name)}</span>`;
  }
  const getSession = () => load(KEYS.session, null);

  // ─── tasks store ───────────────────────────────────────────────────

  function seedTasks() {
    const due = (days) => isoDate(new Date(today().getTime() + days * DAY));
    const seed = [
      ["Draft Q4 roadmap", "Outline goals and milestones for next quarter.", "High", "Priya Shah", 2, false],
      ["Buy milk", "For the office fridge: oat and regular.", "Low", "Sam Rivera", 0, false],
      ["Fix typo on pricing page", "\"Anual\" should read \"Annual\" in the plan comparison.", "High", "Jordan Lee", -1, false],
      ["Review onboarding checklist", "Make sure new hires can reach every tool on day one.", "Medium", "Mei Chen", 4, false],
      ["Update billing FAQ", "Add answers about invoices and changing plans.", "Low", "Jordan Lee", 8, false],
      ["Plan team offsite", "Shortlist three venues and share a budget estimate.", "Medium", "Priya Shah", 13, false],
      ["Renew design tool licenses", "Seats expire at the end of the month.", "Medium", "Mei Chen", -3, true],
    ];
    return seed.map(([title, description, priority, assignee, days, done], i) => ({
      id: i + 1,
      title,
      description,
      priority,
      assignee,
      due: due(days),
      done,
    }));
  }
  function getTasks() {
    let tasks = load(KEYS.tasks, null);
    if (!Array.isArray(tasks)) {
      tasks = seedTasks();
      save(KEYS.tasks, tasks);
    }
    return tasks;
  }
  const setTasks = (tasks) => save(KEYS.tasks, tasks);
  const isOverdue = (t) => !t.done && t.due && daysFromToday(t.due) < 0;

  // ─── settings store ────────────────────────────────────────────────

  function getSettings(session) {
    const defaults = {
      fullName: session ? session.name : "",
      email: session ? session.email : "",
      emailNotifications: true,
      weeklySummary: false,
      desktopAlerts: true,
      apiKey: "acme_live_7Hq2Xk9RmW4tLp8Nc3VbZ6dF",
    };
    return Object.assign(defaults, load(KEYS.settings, {}));
  }
  function randomKey() {
    const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    let s = "acme_live_";
    for (let i = 0; i < 24; i++) s += abc[Math.floor(Math.random() * abc.length)];
    return s;
  }

  // ─── toasts ────────────────────────────────────────────────────────

  /** action (optional): { label, href, download } rendered as a link in the toast. */
  function toast(title, body, kind, action) {
    const el = document.createElement("div");
    el.className = `toast toast-${kind || "success"}`;
    el.innerHTML = html`<span class="toast-icon">${icon(kind === "info" ? "info" : "check")}</span>
      <div>
        <p class="toast-title">${title}</p>${body ? html`<p class="toast-body">${body}</p>` : ""}
        ${action ? html`<a class="toast-action" href="${action.href}" download="${action.download || ""}">${action.label}</a>` : ""}
      </div>`.s;
    toastRegion.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("is-visible")));
    setTimeout(() => {
      el.classList.remove("is-visible");
      setTimeout(() => el.remove(), 250);
    }, 4500);
  }

  // ─── router ────────────────────────────────────────────────────────

  const ROUTES = {
    "/login": { title: "Sign in", public: true, render: renderLogin },
    "/dashboard": { title: "Dashboard", render: renderDashboard },
    "/tasks": { title: "Tasks", render: renderTasks },
    "/settings": { title: "Settings", render: renderSettings },
  };

  function parseHash() {
    const h = location.hash.replace(/^#/, "") || "/dashboard";
    const [path, query] = h.split("?");
    return { path, params: new URLSearchParams(query || "") };
  }

  let firstRender = true;
  function router() {
    const { path, params } = parseHash();
    const session = getSession();
    const route = ROUTES[path];
    if (!route) return location.replace(session ? "#/dashboard" : "#/login");
    if (!route.public && !session) return location.replace(`#/login?next=${encodeURIComponent(path)}`);
    if (path === "/login" && session) return location.replace("#/dashboard");

    closeDialog(true);
    document.title = `${route.title} · Acme Tasks`;
    route.render(params, session);
    window.scrollTo(0, 0);
    // Move focus to the new page's heading (what a screen reader user expects
    // after a route change), but don't steal focus on the very first load.
    if (!firstRender && !route.public) {
      const h1 = app.querySelector("h1");
      if (h1) h1.focus({ preventScroll: true });
    }
    firstRender = false;
  }

  window.addEventListener("hashchange", router);
  document.addEventListener("click", (e) => {
    // Hash routing owns "#…" URLs, so the skip link focuses <main> by hand.
    const skip = e.target.closest && e.target.closest(".skip-link");
    if (skip) {
      e.preventDefault();
      const main = document.getElementById("main");
      if (main) main.focus();
    }
  });

  // ─── app shell (sidebar + top bar) ─────────────────────────────────

  function shell(active, session, content) {
    const link = (path, label, ic) =>
      html`<li><a href="#${path}"${new Raw(active === path ? ' aria-current="page"' : "")}>${icon(ic)}<span>${label}</span></a></li>`;
    return html`
      <div class="shell">
        <aside class="sidebar">
          <div class="brand">${LOGO}<span>Acme Tasks</span></div>
          <nav class="nav" aria-label="Main">
            <p class="nav-label" aria-hidden="true">Workspace</p>
            <ul>
              ${link("/dashboard", "Dashboard", "dashboard")}
              ${link("/tasks", "Tasks", "tasks")}
              ${link("/settings", "Settings", "settings")}
            </ul>
          </nav>
          <div class="sidebar-foot">
            <div class="me">
              ${avatar(session.name)}
              <div class="me-text">
                <p class="me-name">${session.name}</p>
                <p class="me-email">${session.email}</p>
              </div>
            </div>
            <button type="button" class="btn btn-ghost btn-sm" id="sign-out">${icon("logout")}Sign out</button>
          </div>
        </aside>
        <div class="main-col">
          <header class="topbar">
            <p class="workspace"><strong>Acme Inc.</strong><span class="plan-pill">Team plan</span></p>
            <div class="topbar-actions">
              <button type="button" class="icon-btn bell" id="notifications" aria-label="Notifications">${icon("bell")}</button>
              ${avatar(session.name, true)}
            </div>
          </header>
          <main id="main" class="content" tabindex="-1">${content}</main>
        </div>
      </div>`;
  }

  function mountShell(active, session, content) {
    app.innerHTML = shell(active, session, content).s;
    document.getElementById("sign-out").addEventListener("click", () => {
      localStorage.removeItem(KEYS.session);
      location.hash = "#/login";
    });
    document.getElementById("notifications").addEventListener("click", () =>
      toast("You're all caught up", "No new notifications.", "info"),
    );
  }

  // ─── #/login ───────────────────────────────────────────────────────

  function renderLogin(params) {
    app.innerHTML = html`
      <div class="auth">
        <section class="auth-hero" aria-labelledby="hero-title">
          <div class="brand">${LOGO}<span>Acme Tasks</span></div>
          <div>
            <h2 id="hero-title">Plan, track and ship work together.</h2>
            <p class="lead">One shared list for everything your team is working on, with clear owners and due dates.</p>
            <ul class="hero-points">
              <li><span class="tick">${icon("check")}</span>See the whole week at a glance</li>
              <li><span class="tick">${icon("check")}</span>Assign work and set priorities in seconds</li>
              <li><span class="tick">${icon("check")}</span>Weekly summaries, straight to your inbox</li>
            </ul>
          </div>
          <p class="hero-foot">Acme Tasks is a demo app. No real data leaves this page.</p>
        </section>
        <main class="auth-main" id="main" tabindex="-1">
          <div class="auth-card">
            <h1>Welcome back</h1>
            <p class="subtitle">Sign in to your Acme Tasks workspace.</p>
            <form id="login-form" novalidate>
              <div class="field">
                <label for="email">Email</label>
                <input class="input" id="email" name="email" type="email" autocomplete="username" placeholder="you@company.com" />
              </div>
              <div class="field">
                <label for="password">Password</label>
                <input class="input" id="password" name="password" type="password" autocomplete="current-password" placeholder="Enter your password" />
              </div>
              <div class="auth-options">
                <label class="checkbox"><input type="checkbox" id="remember" checked /> Keep me signed in</label>
                <button type="button" class="link-btn" id="forgot">Forgot password?</button>
              </div>
              <p class="form-error" id="login-error" role="alert" hidden></p>
              <button class="btn btn-primary btn-block" type="submit" id="sign-in">Sign in</button>
            </form>
            <p class="auth-foot">New to Acme Tasks? Ask your workspace admin for an invite.</p>
          </div>
        </main>
      </div>`.s;

    const form = document.getElementById("login-form");
    const email = document.getElementById("email");
    const password = document.getElementById("password");
    const error = document.getElementById("login-error");
    const submit = document.getElementById("sign-in");
    email.focus();

    document.getElementById("forgot").addEventListener("click", () =>
      toast("Check your inbox", "If that email has an account, we sent a reset link.", "info"),
    );

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const missing = [];
      if (!email.value.trim()) missing.push(email);
      if (!password.value) missing.push(password);
      [email, password].forEach((el) => el.setAttribute("aria-invalid", String(missing.includes(el))));
      if (missing.length) {
        error.textContent = "Enter your email and password to sign in.";
        error.hidden = false;
        missing[0].focus();
        return;
      }
      error.hidden = true;
      // A short, visible "signing in" state, like a real round-trip.
      submit.disabled = true;
      submit.innerHTML = '<span class="spinner" aria-hidden="true"></span>Signing in…';
      setTimeout(() => {
        const addr = email.value.trim();
        save(KEYS.session, { email: addr, name: nameFromEmail(addr), at: Date.now() });
        const next = params.get("next");
        location.hash = next && ROUTES[next] && !ROUTES[next].public ? `#${next}` : "#/dashboard";
      }, 450);
    });
  }

  // ─── #/dashboard ───────────────────────────────────────────────────

  const WEEK = [
    ["Mon", 3],
    ["Tue", 5],
    ["Wed", 4],
    ["Thu", 6],
    ["Fri", 7],
    ["Sat", 1],
    ["Sun", 2],
  ]; // sums to 28, the "Completed this week" figure

  function renderDashboard(_params, session) {
    const tasks = getTasks();
    const open = tasks.filter((t) => !t.done);
    const overdue = tasks.filter(isOverdue);
    const dueSoon = open
      .filter((t) => t.due)
      .sort((a, b) => a.due.localeCompare(b.due))
      .slice(0, 4);
    const max = Math.max(...WEEK.map(([, n]) => n));
    const todayIdx = (new Date().getDay() + 6) % 7; // Monday = 0
    const first = session.name.split(" ")[0];

    const stat = (id, title, value, ic, tone, meta) => html`
      <article class="card stat" aria-labelledby="${id}">
        <div class="stat-top">
          <h3 id="${id}">${title}</h3>
          <span class="stat-icon ${tone}">${icon(ic)}</span>
        </div>
        <p class="stat-value">${value}</p>
        <p class="stat-meta">${meta}</p>
      </article>`;

    mountShell(
      "/dashboard",
      session,
      html`
        <div class="page-header">
          <div>
            <h1 tabindex="-1">Dashboard</h1>
            <p class="subtitle">Welcome back, ${first}. Here's how your team is doing this week.</p>
          </div>
        </div>
        <section aria-labelledby="overview-title">
          <h2 id="overview-title" class="sr-only">This week at a glance</h2>
          <div class="stats">
            ${stat("stat-open", "Open tasks", open.length, "tasks", "", html`<span class="trend up">${icon("trend")}+2</span> since last week`)}
            ${stat("stat-completed", "Completed this week", 28, "done", "good", html`<span class="trend up">${icon("trend")}12%</span> vs last week`)}
            ${stat(
              "stat-overdue",
              "Overdue",
              overdue.length,
              "alert",
              "bad",
              overdue.length ? html`<span class="trend warn">Needs attention</span>` : "Nothing overdue",
            )}
          </div>
        </section>
        <div class="dash-grid">
          <section class="card card-pad" aria-labelledby="progress-title">
            <div class="card-header">
              <div>
                <h2 id="progress-title">Weekly progress</h2>
                <p class="hint">Tasks completed each day</p>
              </div>
            </div>
            <div class="chart" role="img" aria-label="${"Tasks completed per day: " + WEEK.map(([d, n]) => `${d} ${n}`).join(", ")}">
              ${WEEK.map(
                ([day, n], i) => html`
                  <div class="bar-col">
                    <span class="bar-value">${n}</span>
                    <span class="bar${i === todayIdx ? " is-today" : ""}" style="height:${Math.round((n / max) * 160)}px; animation-delay:${i * 50}ms"></span>
                    <span class="bar-day">${day}</span>
                  </div>`,
              )}
            </div>
          </section>
          <section class="card card-pad" aria-labelledby="due-title">
            <div class="card-header">
              <div>
                <h2 id="due-title">Due soon</h2>
                <p class="hint">The next deadlines across the team</p>
              </div>
            </div>
            <ul class="due-list">
              ${dueSoon.map(
                (t) => html`
                  <li>
                    <div>
                      <p class="due-title">${t.title}</p>
                      <p class="due-when${isOverdue(t) ? " overdue" : ""}">${relDue(t.due)} · ${t.assignee}</p>
                    </div>
                    <span class="badge badge-${t.priority.toLowerCase()}">${t.priority}</span>
                  </li>`,
              )}
            </ul>
          </section>
        </div>`,
    );
  }

  // ─── #/tasks ───────────────────────────────────────────────────────

  const view = { filter: "all", query: "", freshId: null };

  function renderTasks(_params, session) {
    view.filter = "all";
    view.query = "";
    const filterBtn = (key, label) =>
      html`<button type="button" data-filter="${key}" aria-pressed="${String(view.filter === key)}">${label}</button>`;

    mountShell(
      "/tasks",
      session,
      html`
        <div class="page-header">
          <div>
            <h1 tabindex="-1">Tasks</h1>
            <p class="subtitle">Everything your team is working on, in one place.</p>
          </div>
          <div class="page-actions">
            <button type="button" class="btn btn-secondary" id="export-csv">${icon("download")}Export CSV</button>
            <button type="button" class="btn btn-primary" id="new-task">${icon("plus")}New task</button>
          </div>
        </div>
        <div class="card">
          <div class="toolbar">
            <div class="search">
              <label for="task-search" class="sr-only">Search tasks</label>
              ${icon("search")}
              <input class="input" id="task-search" type="search" placeholder="Search tasks" autocomplete="off" />
            </div>
            <div class="segmented" role="group" aria-label="Filter tasks">
              ${filterBtn("all", "All")}${filterBtn("open", "Open")}${filterBtn("done", "Completed")}
            </div>
          </div>
          <table class="table">
            <caption class="sr-only">Tasks</caption>
            <thead>
              <tr>
                <th scope="col" class="col-check"><span class="sr-only">Done</span></th>
                <th scope="col">Task</th>
                <th scope="col">Priority</th>
                <th scope="col">Assignee</th>
                <th scope="col">Due</th>
                <th scope="col" class="col-actions"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody id="task-rows"></tbody>
          </table>
          <div class="table-foot" id="task-foot"></div>
        </div>`,
    );

    renderRows();
    document.getElementById("new-task").addEventListener("click", (e) => openTaskDialog(null, e.currentTarget));
    document.getElementById("export-csv").addEventListener("click", (e) => exportCsv(e.currentTarget));
    document.getElementById("task-search").addEventListener("input", (e) => {
      view.query = e.target.value;
      renderRows();
    });
    document.querySelector(".segmented").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-filter]");
      if (!btn) return;
      view.filter = btn.dataset.filter;
      document
        .querySelectorAll(".segmented button")
        .forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      renderRows();
    });
    document.getElementById("task-rows").addEventListener("click", onRowClick);
    document.getElementById("task-rows").addEventListener("change", onRowChange);
  }

  function visibleTasks() {
    const q = view.query.trim().toLowerCase();
    return getTasks().filter((t) => {
      if (view.filter === "open" && t.done) return false;
      if (view.filter === "done" && !t.done) return false;
      return !q || t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q);
    });
  }

  function renderRows() {
    const body = document.getElementById("task-rows");
    if (!body) return;
    const rows = visibleTasks();
    body.innerHTML = rows.length
      ? rows.map(taskRow).join("")
      : html`<tr><td colspan="6" class="empty">No tasks match your search.</td></tr>`.s;
    const all = getTasks();
    const open = all.filter((t) => !t.done).length;
    document.getElementById("task-foot").innerHTML = html`
      <span>Showing ${rows.length} of ${all.length} tasks</span><span>${open} open · ${all.length - open} completed</span>`.s;
    view.freshId = null;
  }

  function taskRow(t) {
    const overdue = isOverdue(t);
    const cls = [t.done ? "is-done" : "", view.freshId === t.id ? "is-new" : ""].filter(Boolean).join(" ");
    return html`
      <tr data-id="${t.id}"${new Raw(cls ? ` class="${cls}"` : "")}>
        <td class="col-check"><input type="checkbox" aria-label="Mark ${t.title} as done"${new Raw(t.done ? " checked" : "")} /></td>
        <td>
          <div class="task-title">${t.title}</div>
          ${t.description ? html`<div class="task-desc">${t.description}</div>` : ""}
        </td>
        <td><span class="badge badge-${t.priority.toLowerCase()}">${t.priority}</span></td>
        <td><span class="assignee">${avatar(t.assignee, true)}${t.assignee}</span></td>
        <td>
          <time class="due${overdue ? " overdue" : ""}" datetime="${t.due || ""}">${fmtDue(t.due)}</time>${overdue ? html`<span class="sr-only"> (overdue)</span>` : ""}
        </td>
        <td class="col-actions">
          <span class="actions">
            <button type="button" class="icon-btn" data-action="edit" aria-label="Edit ${t.title}">${icon("edit")}</button>
            <button type="button" class="icon-btn danger" data-action="delete" aria-label="Delete ${t.title}">${icon("trash")}</button>
          </span>
        </td>
      </tr>`.s;
  }

  function taskIdOf(el) {
    const tr = el.closest("tr[data-id]");
    return tr ? Number(tr.dataset.id) : null;
  }

  function onRowClick(e) {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = taskIdOf(btn);
    const tasks = getTasks();
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    if (btn.dataset.action === "edit") openTaskDialog(task, btn);
    if (btn.dataset.action === "delete") {
      setTasks(tasks.filter((t) => t.id !== id));
      renderRows();
      toast("Task deleted", `"${task.title}" was removed.`);
      document.getElementById("new-task").focus();
    }
  }

  function onRowChange(e) {
    if (e.target.type !== "checkbox") return;
    const id = taskIdOf(e.target);
    const tasks = getTasks().map((t) => (t.id === id ? { ...t, done: e.target.checked } : t));
    setTasks(tasks);
    renderRows();
    const again = document.querySelector(`tr[data-id="${id}"] input[type="checkbox"]`);
    if (again) again.focus();
  }

  // ─── CSV export ────────────────────────────────────────────────────
  // Deliberately slow (~3 s "Exporting…" spinner), like a real server-side
  // export: a realistic wait that a demo can cut out (fx "skip").

  const EXPORT_MS = 3000;

  function toCsv(tasks) {
    const cell = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const rows = tasks.map((t) => [t.title, t.priority, t.assignee, t.due || "", t.done ? "Done" : "Open", t.description]);
    return [["Title", "Priority", "Assignee", "Due", "Status", "Description"], ...rows]
      .map((r) => r.map((v) => cell(String(v))).join(","))
      .join("\n");
  }

  function exportCsv(btn) {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    btn.innerHTML = '<span class="spinner" aria-hidden="true"></span>Exporting…';
    setTimeout(() => {
      const tasks = getTasks();
      const url = URL.createObjectURL(new Blob([toCsv(tasks)], { type: "text/csv" }));
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
      btn.innerHTML = html`${icon("download")}Export CSV`.s;
      toast("Export ready", `tasks.csv · ${tasks.length} tasks`, "success", { label: "Download tasks.csv", href: url, download: "tasks.csv" });
    }, EXPORT_MS);
  }

  // ─── task dialog (new + edit) ──────────────────────────────────────

  let dialog = null; // { overlay, opener, keydown }

  function openTaskDialog(task, opener) {
    closeDialog(true);
    const editing = !!task;
    const t = task || { title: "", priority: "Medium", due: "", description: "" };
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = html`
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="task-dialog-title" aria-describedby="task-dialog-hint">
        <div class="dialog-header">
          <div>
            <h2 id="task-dialog-title">${editing ? "Edit task" : "New task"}</h2>
            <p class="hint" id="task-dialog-hint">Tasks are visible to everyone in your workspace.</p>
          </div>
          <button type="button" class="icon-btn" data-close aria-label="Close">${icon("close")}</button>
        </div>
        <form id="task-form" novalidate>
          <div class="dialog-body">
            <div class="field">
              <label for="task-title">Title</label>
              <input class="input" id="task-title" name="title" autocomplete="off" placeholder="What needs to be done?" value="${t.title}" aria-describedby="task-title-error" />
              <p class="field-error" id="task-title-error" role="alert"></p>
            </div>
            <div class="field-row">
              <div class="field">
                <label for="task-priority">Priority</label>
                <select class="select" id="task-priority" name="priority">
                  ${PRIORITIES.map((p) => html`<option${new Raw(p === t.priority ? " selected" : "")}>${p}</option>`)}
                </select>
              </div>
              <div class="field">
                <label for="task-due">Due date</label>
                <input class="input" id="task-due" name="due" type="date" value="${t.due || ""}" />
              </div>
            </div>
            <div class="field">
              <label for="task-description">Description</label>
              <textarea class="textarea" id="task-description" name="description" rows="3" placeholder="Add details, links or next steps" aria-describedby="task-description-hint">${t.description}</textarea>
              <p class="hint" id="task-description-hint">Optional.</p>
            </div>
          </div>
          <div class="dialog-footer">
            <button type="button" class="btn btn-secondary" data-close>Cancel</button>
            <button type="submit" class="btn btn-primary">${editing ? "Save task" : "Create task"}</button>
          </div>
        </form>
      </div>`.s;
    document.body.appendChild(overlay);
    // The page behind a modal is inert: not focusable, not clickable, and
    // hidden from the accessibility tree.
    document.querySelector(".shell")?.setAttribute("inert", "");

    const keydown = (e) => {
      if (e.key === "Escape") closeDialog();
      if (e.key === "Tab") trapFocus(e, overlay);
    };
    document.addEventListener("keydown", keydown);
    dialog = { overlay, opener, keydown };

    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) closeDialog();
    });
    overlay.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => closeDialog()));
    overlay.querySelector("#task-form").addEventListener("submit", (e) => {
      e.preventDefault();
      submitTask(task, overlay);
    });

    requestAnimationFrame(() => overlay.classList.add("is-open"));
    overlay.querySelector("#task-title").focus();
  }

  function trapFocus(e, root) {
    const items = [...root.querySelectorAll("button, input, select, textarea")].filter((el) => !el.disabled);
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function submitTask(task, overlay) {
    const title = overlay.querySelector("#task-title");
    const error = overlay.querySelector("#task-title-error");
    const value = title.value.trim();
    if (!value) {
      title.setAttribute("aria-invalid", "true");
      error.textContent = "Give the task a title.";
      title.focus();
      return;
    }
    const fields = {
      title: value,
      priority: overlay.querySelector("#task-priority").value,
      due: overlay.querySelector("#task-due").value,
      description: overlay.querySelector("#task-description").value.trim(),
    };
    const tasks = getTasks();
    if (task) {
      setTasks(tasks.map((t) => (t.id === task.id ? { ...t, ...fields } : t)));
      closeDialog();
      renderRows();
      toast("Task updated", `"${value}" was saved.`);
      return;
    }
    const session = getSession();
    const id = tasks.reduce((m, t) => Math.max(m, t.id), 0) + 1;
    setTasks([{ id, ...fields, assignee: session ? session.name : "You", done: false }, ...tasks]);
    closeDialog();
    // Show the new task: clear filters that could hide it, then highlight its row.
    view.filter = "all";
    view.query = "";
    const search = document.getElementById("task-search");
    if (search) search.value = "";
    document.querySelectorAll(".segmented button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.filter === "all")));
    view.freshId = id;
    renderRows();
    toast("Task created", `"${value}" was added to the list.`);
  }

  function closeDialog(immediate) {
    if (!dialog) return;
    const { overlay, opener, keydown } = dialog;
    dialog = null;
    document.removeEventListener("keydown", keydown);
    document.querySelector(".shell")?.removeAttribute("inert");
    if (immediate) {
      overlay.remove();
      return;
    }
    overlay.classList.remove("is-open");
    setTimeout(() => overlay.remove(), 220);
    if (opener && document.body.contains(opener)) opener.focus();
    else document.getElementById("new-task")?.focus();
  }

  // ─── #/settings ────────────────────────────────────────────────────

  const SWITCHES = [
    ["emailNotifications", "Email notifications", "Get an email when someone assigns you a task."],
    ["weeklySummary", "Weekly summary", "A short Monday digest of what your team finished."],
    ["desktopAlerts", "Desktop alerts", "A reminder when one of your tasks is due today."],
  ];

  function renderSettings(_params, session) {
    const s = getSettings(session);
    const sw = ([key, title, desc]) => html`
      <div class="setting">
        <div>
          <p class="setting-title" id="sw-${key}-label">${title}</p>
          <p class="setting-desc" id="sw-${key}-desc">${desc}</p>
        </div>
        <button type="button" class="switch" role="switch" data-key="${key}" aria-checked="${String(!!s[key])}" aria-labelledby="sw-${key}-label" aria-describedby="sw-${key}-desc"></button>
      </div>`;

    mountShell(
      "/settings",
      session,
      html`
        <div class="page-header">
          <div>
            <h1 tabindex="-1">Settings</h1>
            <p class="subtitle">Manage your profile, notifications and API access.</p>
          </div>
          <div class="page-actions">
            <span class="unsaved" id="unsaved" aria-live="polite"></span>
            <button type="button" class="btn btn-primary" id="save-settings">Save changes</button>
          </div>
        </div>
        <div class="settings-grid">
          <div class="stack">
            <section class="card card-pad" aria-labelledby="profile-title">
              <div class="card-header">
                <div>
                  <h2 id="profile-title">Profile</h2>
                  <p class="hint">How your teammates see you.</p>
                </div>
              </div>
              <div class="field">
                <label for="full-name">Full name</label>
                <input class="input" id="full-name" data-key="fullName" autocomplete="name" value="${s.fullName}" />
              </div>
              <div class="field">
                <label for="profile-email">Email</label>
                <input class="input" id="profile-email" data-key="email" type="email" autocomplete="email" value="${s.email}" />
              </div>
            </section>
            <section class="card card-pad" aria-labelledby="api-title">
              <div class="card-header">
                <div>
                  <h2 id="api-title">API access</h2>
                  <p class="hint">Connect Acme Tasks to your other tools.</p>
                </div>
              </div>
              <div class="field">
                <label for="api-key">API key</label>
                <input class="input input-mono" id="api-key" readonly value="${s.apiKey}" aria-describedby="api-key-hint" />
                <p class="hint" id="api-key-hint">Keep this key secret. Anyone who has it can read and change your tasks.</p>
                <div class="key-actions">
                  <button type="button" class="btn btn-secondary btn-sm" id="copy-key">${icon("copy")}Copy</button>
                  <button type="button" class="btn btn-secondary btn-sm" id="regenerate-key">${icon("refresh")}Regenerate</button>
                </div>
              </div>
            </section>
          </div>
          <section class="card card-pad" aria-labelledby="notifications-title">
            <div class="card-header">
              <div>
                <h2 id="notifications-title">Notifications</h2>
                <p class="hint">Choose what we tell you about, and how.</p>
              </div>
            </div>
            ${SWITCHES.map(sw)}
          </section>
        </div>`,
    );

    const draft = { ...s };
    const unsaved = document.getElementById("unsaved");
    const markDirty = (dirty) => {
      unsaved.textContent = dirty ? "Unsaved changes" : "";
      unsaved.classList.toggle("is-visible", dirty);
    };

    document.querySelectorAll(".switch").forEach((btn) =>
      btn.addEventListener("click", () => {
        const on = btn.getAttribute("aria-checked") !== "true";
        btn.setAttribute("aria-checked", String(on));
        draft[btn.dataset.key] = on;
        markDirty(true);
      }),
    );
    document.querySelectorAll("input[data-key]").forEach((input) =>
      input.addEventListener("input", () => {
        draft[input.dataset.key] = input.value;
        markDirty(true);
      }),
    );
    // A short "Saving…" state, like a real round-trip.
    const saveBtn = document.getElementById("save-settings");
    saveBtn.addEventListener("click", () => {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span>Saving…';
      setTimeout(() => {
        save(KEYS.settings, draft);
        markDirty(false);
        saveBtn.disabled = false;
        saveBtn.textContent = "Save changes";
        toast("Settings saved", "Your preferences are up to date.");
      }, 400);
    });
    document.getElementById("copy-key").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(document.getElementById("api-key").value);
        toast("API key copied", "Paste it into the tool you're connecting.");
      } catch {
        document.getElementById("api-key").select();
        toast("Press Ctrl+C to copy", "The key is selected.", "info");
      }
    });
    document.getElementById("regenerate-key").addEventListener("click", () => {
      draft.apiKey = randomKey();
      document.getElementById("api-key").value = draft.apiKey;
      save(KEYS.settings, { ...getSettings(session), apiKey: draft.apiKey });
      toast("New API key generated", "The old key stops working right away.");
    });
  }

  router();
})();
