// Minimal mobile-first shell. Personal link (#t=<token>) -> stored token -> API calls.
// All dynamic text is set with textContent, never innerHTML.
const KEY = "dp_token";
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
};

function captureToken() {
  const m = location.hash.match(/[#&]t=([A-Za-z0-9_-]+)/);
  if (m) {
    try { localStorage.setItem(KEY, m[1]); } catch {}
    history.replaceState(null, "", location.pathname); // keep the token out of the address bar and history
    return m[1];
  }
  try { return localStorage.getItem(KEY); } catch { return null; }
}

const token = captureToken();

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  });
  if (res.status === 401) throw Object.assign(new Error("unauthorized"), { status: 401 });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.message || body.error || res.statusText), { status: res.status, body });
  return body;
}

const fmtTime = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

const fmtDate = (d) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });

function profilePrompt(onSaved) {
  const input = el("input", { id: "dietary", placeholder: "e.g. severe sesame allergy, or “none”", autocomplete: "off" });
  const msg = el("p", { className: "error" });
  const save = el("button", { className: "primary", textContent: "Save" });
  save.onclick = async () => {
    try { await api("/api/me", { method: "PUT", body: JSON.stringify({ dietary: input.value }) }); onSaved(); }
    catch (e) { msg.textContent = "Please enter your dietary needs (or “none”)."; }
  };
  return el("section", { className: "card" },
    el("label", { htmlFor: "dietary", textContent: "Allergies & dietary needs" }),
    el("p", { className: "muted", textContent: "Hosts need this before you can say yes." }),
    input, msg, el("div", { className: "row" }, save));
}

function dinnerCard(d) {
  const card = el("article", { className: "card" },
    el("h3", { textContent: fmtDate(d.date) }),
    el("div", { className: "muted", textContent: `At ${d.host_name}'s · ${fmtTime(d.start_time)}${d.status === "cancelled" ? " · cancelled" : ""}` }));
  if (d.status !== "scheduled") return card;
  const msg = el("p", { className: "error" });
  const row = el("div", { className: "row" });
  for (const [value, label] of [["yes", "Going"], ["maybe", "Maybe"], ["no", "Can't"]]) {
    const b = el("button", { textContent: label });
    b.setAttribute("aria-pressed", String(d.my_response === value));
    b.onclick = async () => {
      try { await api(`/api/dinners/${d.id}/rsvp`, { method: "PUT", body: JSON.stringify({ response: value }) });
        row.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); msg.textContent = ""; }
      catch (e) { msg.textContent = e.message; } // e.g. dietary info missing: the prompt above is already showing
    };
    row.append(b);
  }
  card.append(row, msg);
  return card;
}

async function render() {
  const app = $("app");
  if (!token) {
    app.replaceChildren(el("p", { textContent: "Open the personal link you were sent to get started." }));
    return;
  }
  try {
    const [me, { dinners }] = await Promise.all([api("/api/me"), api("/api/dinners")]);
    $("group").textContent = me.group.name;
    $("who").textContent = `Hi ${me.name}`;
    const parts = [];
    if (!me.profileComplete) parts.push(profilePrompt(render));
    parts.push(el("h2", { textContent: "Upcoming" }));
    if (dinners.length === 0) parts.push(el("p", { className: "muted", textContent: "Nothing scheduled yet." }));
    dinners.slice(0, 6).forEach((d, i) => { const c = dinnerCard(d); if (i === 0) c.classList.add("next"); parts.push(c); });
    if (me.group.chatUrl) parts.push(el("p", {}, el("a", { href: me.group.chatUrl, rel: "noopener", textContent: "Open group chat" })));
    app.replaceChildren(...parts);
  } catch (e) {
    if (e.status === 401) { try { localStorage.removeItem(KEY); } catch {} }
    app.replaceChildren(el("p", { className: "error", textContent: e.status === 401 ? "This link is no longer valid. Ask an organizer for a new one." : "Something went wrong. Try again." }));
  }
}

render();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
