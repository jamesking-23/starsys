/* ============================================================================
   Starsys Notification Center
   ----------------------------------------------------------------------------
   Everything here is derived from live data the signed-in user can already see,
   so no database tables are needed:

   TO DO     approvals waiting (admins) · reports still missing for last month ·
             unverified email
   UPDATES   people saving reports (grouped) · "month complete" milestone ·
             monthly total with change vs. the month before · people & access
             events (admins)

   Per-user state (read / dismissed / snoozed / preferences) lives in localStorage.
   The module is dependency-injected (see createNotifications in main.js) and has
   no imports of its own.
   ============================================================================ */

const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const ACTIVITY_WINDOW = 7 * DAY;     // how far back "updates" look
const ACTIVITY_GAP = 45 * MIN;       // saves by one person closer than this collapse into one line
const KEEP_STATE = 45 * DAY;         // forget read/dismissed marks older than this
const LOG_ACTIONS = ['approve_user', 'set_user_status', 'promote_to_admin', 'grant_support_access', 'revoke_support_access'];
const TODO_PRIORITY = { approval: 1, missing: 2, verify: 3 };

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const short = (d) => String(d || '').replace(/\s+DISTRICT$/i, '');
const plural = (n, one, many) => (n === 1 ? one : many);

function compact(n) {
  n = Math.round(Number(n) || 0);
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(a >= 1e10 ? 0 : 1).replace(/\.0$/, '') + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (a >= 1e3) return Math.round(n / 1e3) + 'K';
  return String(n);
}
function rel(ts) {
  const d = Date.now() - ts;
  if (d < MIN) return 'just now';
  if (d < HOUR) return Math.floor(d / MIN) + ' min ago';
  if (d < DAY) return Math.floor(d / HOUR) + ' hr ago';
  const days = Math.floor(d / DAY);
  if (days === 1) return 'yesterday';
  if (days < 7) return days + ' days ago';
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
function bucket(ts) {
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOfDay(new Date()) - startOfDay(new Date(ts))) / DAY);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return 'This week';
  return 'Earlier';
}
function dayPart() {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}

export function createNotifications(ctx) {
  const bell = document.getElementById('notifBtn');
  const badge = document.getElementById('notifBadge');
  const todoRing = document.getElementById('notifRing');
  const baseTitle = document.title;

  let uid = null, store = null, started = false, panelOpen = false, settingsOpen = false;
  let remote = { approvals: [], log: [] };
  let items = [], allItems = [], shownIds = new Set(), keepUnread = new Set();
  let filter = 'all';
  let announced = new Map(), initialised = false;
  let panel, listEl, pulseEl, settingsEl, footEl, backdrop, toastsEl, liveEl;
  let tickTimer = null, pollTimer = null, debounceTimer = null, profChannel = null, audioCtx = null;
  let domReady = false, wired = false;

  /* ------------------------------ persistent state ------------------------------ */
  const storeKey = () => 'starsys_notif_v2_' + uid;
  function loadStore() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(storeKey()) || 'null'); } catch (e) { /* ignore */ }
    const now = Date.now();
    if (!s || s.v !== 2) s = { v: 2, baseline: now, read: {}, dismissed: {}, snoozed: {}, prefs: {} };
    s.prefs = Object.assign({ toast: true, desktop: false, sound: false }, s.prefs || {});
    ['read', 'dismissed', 'snoozed'].forEach((m) => {
      s[m] = s[m] || {};
      Object.keys(s[m]).forEach((k) => {
        const t = s[m][k];
        const stale = typeof t !== 'number' || (m === 'snoozed' ? t < now - DAY : t !== 0 && now - t > KEEP_STATE);
        if (stale) delete s[m][k];
      });
    });
    return s;
  }
  function save() { try { localStorage.setItem(storeKey(), JSON.stringify(store)); } catch (e) { /* ignore */ } }

  /* ------------------------------ item rules ------------------------------ */
  function isUnread(n) {
    if (n.own) return false;
    const r = store.read[n.id];
    if (r === 0) return true;                               // explicitly marked unread
    if (n.kind === 'update' && n.ts < store.baseline) return false;   // history from before first use
    return !(r && r >= n.ts);
  }
  function isHidden(n) {
    const d = store.dismissed[n.id];
    if (d && n.ts <= d) return true;
    const s = store.snoozed[n.id];
    return !!(s && s > Date.now());
  }
  const find = (id) => allItems.find((n) => n.id === id);

  /* ------------------------------ builders (local data) ------------------------------ */
  function lastMonthRef() {
    const now = new Date();
    let m = now.getMonth() - 1, y = now.getFullYear();
    if (m < 0) { m = 11; y--; }
    return { m, y, name: ctx.MONTHS[m] };
  }
  function monthTotals(names, month, year) {
    const state = ctx.getState();
    let sum = 0, reported = 0, total = 0;
    const byDistrict = {};
    names.forEach((d) => ctx.scopedChurches(d).forEach((c) => {
      total++;
      const e = state[ctx.keyFor(d, c, month, year)];
      if (ctx.entryStatus(e) === 'Entered') {
        const t = ctx.entryTotal(e);
        sum += t; reported++;
        byDistrict[d] = (byDistrict[d] || 0) + t;
      }
    }));
    return { sum, reported, total, byDistrict };
  }

  function buildVerify(out) {
    const u = ctx.getUser();
    if (!u || u.email_confirmed_at) return;
    out.push({
      id: 'verify-email', kind: 'todo', type: 'verify', ts: Date.parse(u.created_at) || Date.now(), tone: 'gold', icon: 'mail',
      title: 'Verify your email address', sub: 'Confirm ' + (u.email || 'your email') + ' to keep your account secure',
      when: 'Account', actions: [{ label: 'Resend email', primary: true, run: () => ctx.resendVerification() }],
      open: () => ctx.resendVerification(), snoozable: true
    });
  }

  function buildApprovals(out) {
    const rows = remote.approvals || [];
    if (!rows.length) return;
    const go = () => ctx.go.users();
    if (rows.length <= 3) {
      rows.forEach((p) => out.push({
        id: 'pend-' + p.id, kind: 'todo', type: 'approval', ts: Date.parse(p.created_at) || Date.now(), tone: 'gold', icon: 'user-plus',
        title: (p.full_name || 'A new user') + ' is waiting for approval',
        sub: 'Review the request and choose their districts', when: 'Requested ' + rel(Date.parse(p.created_at) || Date.now()),
        actions: [{ label: 'Review', primary: true, run: go }], open: go
      }));
    } else {
      const names = rows.slice(0, 3).map((p) => (p.full_name || 'Someone').split(' ')[0]);
      out.push({
        id: 'pend-group', kind: 'todo', type: 'approval', ts: Math.max(...rows.map((p) => Date.parse(p.created_at) || 0)), tone: 'gold', icon: 'user-plus',
        title: rows.length + ' people are waiting for approval',
        sub: names.join(', ') + ' and ' + (rows.length - 3) + ' more', when: 'Newest ' + rel(Math.max(...rows.map((p) => Date.parse(p.created_at) || 0))),
        actions: [{ label: 'Review all', primary: true, run: go }], open: go
      });
    }
  }

  function buildMonthStatus(out, ref) {
    const names = ctx.scopedDistrictNames();
    if (!names.length || ref.y < ctx.FIRST_YEAR) return;
    const mp = ctx.computeMonthProgress(names, ref.name, ref.y);
    if (!mp.total) return;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    if (mp.reported < mp.total) {
      const miss = mp.rows.filter((r) => r.total - r.reported > 0)
        .map((r) => ({ d: r.d, n: r.total - r.reported, first: r.churches.find((c) => !c.reported).name }))
        .sort((a, b) => b.n - a.n);
      const missing = mp.total - mp.reported;
      const fill = () => ctx.go.entry(miss[0].d, miss[0].first, ref.name, ref.y);
      out.push({
        id: 'missing-' + ref.y + '-' + ref.m, kind: 'todo', type: 'missing', ts: monthStart, tone: 'gold', icon: 'alert-triangle',
        title: missing + ' ' + plural(missing, 'church is', 'churches are') + ' still to report ' + ref.name + ' ' + ref.y,
        sub: miss.slice(0, 3).map((x) => short(x.d) + ' (' + x.n + ')').join(' · ') + (miss.length > 3 ? ' · +' + (miss.length - 3) + ' more' : ''),
        progress: { pct: mp.pct }, when: mp.reported + ' of ' + mp.total + ' reported',
        actions: [{ label: 'Fill now', primary: true, run: fill }, { label: 'Progress', run: () => ctx.go.tab('tab-progress') }],
        open: fill, snoozable: true
      });
    } else {
      out.push({
        id: 'complete-' + ref.y + '-' + ref.m, kind: 'update', type: 'complete', ts: monthStart, tone: 'emerald', icon: 'sparkles',
        title: ref.name + ' ' + ref.y + ' is fully reported',
        sub: 'All ' + mp.total + ' ' + plural(mp.total, 'church', 'churches') + ' submitted. Great work.', when: 'Milestone',
        open: () => ctx.go.tab('tab-progress')
      });
    }
  }

  function buildDigest(out, ref) {
    const names = ctx.scopedDistrictNames();
    if (!names.length || ref.y < ctx.FIRST_YEAR) return;
    const cur = monthTotals(names, ref.name, ref.y);
    if (!cur.reported) return;
    let pm = ref.m - 1, py = ref.y;
    if (pm < 0) { pm = 11; py--; }
    const prev = monthTotals(names, ctx.MONTHS[pm], py);
    const cov = (t) => (t.total ? t.reported / t.total : 0);
    // Only compare month-on-month when both months are well covered, otherwise the % would mislead.
    const comparable = prev.reported && prev.sum > 0 && cov(cur) >= 0.8 && cov(prev) >= 0.8;
    const delta = comparable ? ((cur.sum - prev.sum) / prev.sum) * 100 : null;
    const parts = [];
    if (delta !== null) parts.push((delta >= 0 ? '\u25B2 ' : '\u25BC ') + Math.abs(delta).toFixed(1) + '% vs ' + ctx.MONTHS[pm]);
    else parts.push('Based on ' + cur.reported + ' of ' + cur.total + ' churches');
    const ranked = Object.entries(cur.byDistrict).sort((a, b) => b[1] - a[1]);
    if (ranked.length > 1) parts.push('Top: ' + short(ranked[0][0]));
    const now = new Date();
    out.push({
      id: 'digest-' + ref.y + '-' + ref.m, kind: 'update', type: 'digest', ts: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
      tone: 'ink', icon: delta !== null && delta < 0 ? 'trending-down' : 'trending-up',
      title: ref.name + ' total: UGX ' + compact(cur.sum), sub: parts.join(' · '), when: 'Monthly summary',
      open: () => ctx.go.tab('tab-progress')
    });
  }

  function buildActivity(out) {
    const u = ctx.getUser();
    const myName = ((u && u.full_name) || '').trim().toLowerCase();
    const since = Date.now() - ACTIVITY_WINDOW;
    const rows = [];
    Object.values(ctx.getState()).forEach((e) => {
      if (!e || !e.editedAt || !e.district) return;
      const t = Date.parse(e.editedAt);
      if (!t || t < since || !ctx.inMyScope(e.district) || ctx.entryStatus(e) !== 'Entered') return;
      rows.push({ t, e });
    });
    rows.sort((a, b) => a.t - b.t);
    const groups = [];
    rows.forEach((r) => {
      const by = r.e.editedBy || 'Someone';
      const g = groups[groups.length - 1];
      if (g && g.by === by && g.district === r.e.district && r.t - g.last <= ACTIVITY_GAP) { g.rows.push(r); g.last = r.t; }
      else groups.push({ by, district: r.e.district, start: r.t, last: r.t, rows: [r] });
    });
    groups.slice(-8).forEach((g) => {
      const own = g.by.trim().toLowerCase() === myName;
      const who = own ? 'You' : g.by;
      const total = g.rows.reduce((s, r) => s + ctx.entryTotal(r.e), 0);
      const latest = g.rows[g.rows.length - 1].e;
      const n = g.rows.length;
      const churches = [...new Set(g.rows.map((r) => r.e.church))];
      out.push({
        id: 'act|' + g.by + '|' + g.district + '|' + g.start, kind: 'update', type: 'activity', ts: g.last, own,
        tone: 'ink', icon: 'pen-line',
        title: n === 1 ? who + ' saved ' + latest.church : who + ' saved ' + n + ' reports',
        sub: n === 1
          ? short(g.district) + ' \u00B7 ' + latest.month + ' ' + latest.year + ' \u00B7 UGX ' + compact(total)
          : short(g.district) + ' \u00B7 ' + churches.slice(0, 3).join(', ') + (churches.length > 3 ? ' +' + (churches.length - 3) : '') + ' \u00B7 UGX ' + compact(total),
        open: () => ctx.go.entry(latest.district, latest.church, latest.month, latest.year)
      });
    });
  }

  function buildLog(out) {
    const u = ctx.getUser();
    const myName = ((u && u.full_name) || '').trim().toLowerCase();
    (remote.log || []).forEach((r) => {
      const who = r.actor_name || 'An admin', d = r.details || {};
      let t = null;
      if (r.action === 'approve_user') t = { t: who + ' approved ' + (d.target_name || 'a user'), s: 'Account activated', icon: 'user-check', tone: 'emerald' };
      else if (r.action === 'set_user_status') {
        const st = d.status;
        const verb = st === 'active' ? 'reactivated' : st === 'suspended' ? 'suspended' : st === 'deactivated' ? 'deactivated' : 'updated';
        t = { t: who + ' ' + verb + ' a user account', s: 'People & access', icon: st === 'active' ? 'user-check' : 'shield-alert', tone: st === 'active' ? 'emerald' : 'rose' };
      } else if (r.action === 'promote_to_admin') t = { t: who + ' promoted a user to admin', s: 'People & access', icon: 'shield-check', tone: 'gold' };
      else if (r.action === 'grant_support_access') t = { t: who + ' granted support access', s: d.hours ? 'For ' + d.hours + ' ' + plural(Number(d.hours), 'hour', 'hours') : 'Time-limited', icon: 'shield-alert', tone: 'rose' };
      else if (r.action === 'revoke_support_access') t = { t: who + ' revoked support access', s: 'People & access', icon: 'shield-check', tone: 'emerald' };
      if (!t) return;
      out.push({
        id: 'log-' + r.id, kind: 'update', type: 'access', ts: Date.parse(r.created_at) || Date.now(),
        own: (r.actor_name || '').trim().toLowerCase() === myName, tone: t.tone, icon: t.icon, title: t.t, sub: t.s,
        open: () => ctx.go.users()
      });
    });
  }

  async function fetchRemote() {
    const out = { approvals: [], log: [] };
    const u = ctx.getUser(), sb = ctx.getSupabase();
    if (!u || !sb || !(u.role === 'admin' || u.role === 'super_admin')) return out;
    try {
      const { data } = await sb.from('profiles').select('id,full_name,created_at').eq('status', 'pending_approval').order('created_at', { ascending: false });
      out.approvals = data || [];
    } catch (e) { /* offline: keep empty */ }
    try {
      const since = new Date(Date.now() - ACTIVITY_WINDOW).toISOString();
      const { data } = await sb.from('audit_log').select('id,created_at,actor_name,actor_role,action,details')
        .in('action', LOG_ACTIONS).gte('created_at', since).order('created_at', { ascending: false }).limit(15);
      out.log = data || [];
    } catch (e) { /* ignore */ }
    return out;
  }

  /* ------------------------------ assemble + announce ------------------------------ */
  function rebuild() {
    if (!started || !ctx.getUser()) return;
    const list = [];
    const ref = lastMonthRef();
    buildVerify(list); buildApprovals(list); buildMonthStatus(list, ref); buildDigest(list, ref); buildActivity(list); buildLog(list);
    allItems = list;
    const vis = list.filter((n) => !isHidden(n));
    const todos = vis.filter((n) => n.kind === 'todo').sort((a, b) => (TODO_PRIORITY[a.type] - TODO_PRIORITY[b.type]) || (b.ts - a.ts));
    const updates = vis.filter((n) => n.kind === 'update').sort((a, b) => b.ts - a.ts);
    items = todos.concat(updates);
    announceNew();
    updateBell();
    if (panelOpen) render();
  }

  function announceNew() {
    const fresh = [];
    items.forEach((n) => {
      const prev = announced.get(n.id);
      if (initialised && (prev === undefined || prev < n.ts) && isUnread(n)) fresh.push(n);
      announced.set(n.id, n.ts);
    });
    initialised = true;
    if (!fresh.length) return;
    ringBell();
    live(fresh.length === 1 ? 'New notification: ' + fresh[0].title : fresh.length + ' new notifications');
    if (panelOpen) return;
    const p = store.prefs;
    if (p.toast) {
      fresh.slice(0, 2).forEach((n) => toast({ title: n.title, sub: n.sub, icon: n.icon, tone: n.tone, onClick: () => { markRead(n.id); n.open && n.open(); } }));
      if (fresh.length > 2) toast({ title: '+' + (fresh.length - 2) + ' more notifications', sub: 'Open the bell to see them', icon: 'bell-ring', tone: 'gold', onClick: () => open() });
    }
    if (p.desktop && 'Notification' in window && Notification.permission === 'granted' && (document.hidden || !document.hasFocus())) {
      fresh.slice(0, 3).forEach((n) => {
        try {
          const nt = new Notification(n.title, { body: n.sub || '', tag: n.id, icon: new URL('./apple-touch-icon.png', document.baseURI).href });
          nt.onclick = () => { window.focus(); nt.close(); markRead(n.id); n.open ? n.open() : open(); };
        } catch (e) { /* ignore */ }
      });
    }
    if (p.sound) chime();
  }

  /* ------------------------------ bell ------------------------------ */
  function updateBell() {
    const unread = items.filter(isUnread).length;
    const todos = items.filter((n) => n.kind === 'todo').length;
    if (badge) { badge.hidden = unread === 0; badge.textContent = unread > 9 ? '9+' : String(unread); }
    if (todoRing) todoRing.hidden = !(unread === 0 && todos > 0);
    if (bell) {
      bell.setAttribute('aria-label', 'Notifications' + (unread ? ', ' + unread + ' unread' : '') + (todos ? ', ' + todos + ' to do' : ''));
      bell.title = unread ? unread + ' unread notification' + (unread === 1 ? '' : 's') : todos ? todos + ' open to-do' + (todos === 1 ? '' : 's') : 'Notifications';
    }
    document.title = (unread ? '(' + unread + ') ' : '') + baseTitle;
    const chip = panel && panel.querySelector('#nUnreadChip');
    if (chip) { chip.hidden = unread === 0; chip.textContent = unread + ' new'; }
  }
  function ringBell() {
    if (!bell) return;
    bell.classList.remove('bell-ring'); void bell.offsetWidth; bell.classList.add('bell-ring');
    setTimeout(() => bell.classList.remove('bell-ring'), 1100);
  }
  function live(msg) { if (liveEl) { liveEl.textContent = ''; setTimeout(() => { liveEl.textContent = msg; }, 30); } }

  /* ------------------------------ DOM ------------------------------ */
  function ensureDom() {
    if (domReady) return;
    domReady = true;
    backdrop = document.createElement('div');
    backdrop.className = 'notif-backdrop';
    document.body.appendChild(backdrop);

    panel = document.createElement('section');
    panel.id = 'notifPanel';
    panel.className = 'notif-panel hidden panel rounded-sm shadow-2xl';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Notifications');
    panel.tabIndex = -1;
    panel.innerHTML =
      '<div class="notif-handle" aria-hidden="true"></div>'
      + '<header class="flex items-center gap-2 px-5 pt-4 pb-2">'
      + '<h3 class="text-sm font-semibold dark:text-paper">Notifications</h3>'
      + '<span id="nUnreadChip" class="notif-chip-new" hidden></span><span class="flex-1"></span>'
      + '<button type="button" class="notif-iconbtn" data-nact="markall" title="Mark all as read" aria-label="Mark all as read"><i data-lucide="check-check" class="w-4 h-4"></i></button>'
      + '<button type="button" class="notif-iconbtn" data-nact="settings" title="Notification settings" aria-label="Notification settings" aria-expanded="false"><i data-lucide="sliders-horizontal" class="w-4 h-4"></i></button>'
      + '<button type="button" class="notif-iconbtn notif-close" data-nact="close" title="Close" aria-label="Close notifications"><i data-lucide="x" class="w-4 h-4"></i></button>'
      + '</header>'
      + '<div id="nSettings" class="notif-settings" hidden></div>'
      + '<div id="nPulse"></div>'
      + '<div class="flex gap-1.5 px-5 pb-2 pt-1" role="tablist" aria-label="Filter notifications" id="nTabs"></div>'
      + '<ul id="nList" class="notif-scroll" role="list" aria-live="off"></ul>'
      + '<div id="nFoot" class="notif-foot" hidden></div>';
    document.body.appendChild(panel);
    listEl = panel.querySelector('#nList'); pulseEl = panel.querySelector('#nPulse');
    settingsEl = panel.querySelector('#nSettings'); footEl = panel.querySelector('#nFoot');

    toastsEl = document.createElement('div');
    toastsEl.id = 'notifToasts';
    document.body.appendChild(toastsEl);
    liveEl = document.createElement('div');
    liveEl.className = 'sr-only'; liveEl.setAttribute('aria-live', 'polite'); liveEl.setAttribute('role', 'status');
    document.body.appendChild(liveEl);
    wire();
  }

  function renderPulse() {
    const names = ctx.scopedDistrictNames();
    const ref = lastMonthRef();
    const now = new Date();
    if (!names.length) { pulseEl.innerHTML = ''; return; }
    let month = ref.name, year = ref.y, mp = ref.y >= ctx.FIRST_YEAR ? ctx.computeMonthProgress(names, month, year) : null;
    if (!mp || !mp.total || mp.reported === mp.total) {   // last month is done (or n/a): show this month
      month = ctx.MONTHS[now.getMonth()]; year = now.getFullYear(); mp = ctx.computeMonthProgress(names, month, year);
    }
    if (!mp.total) { pulseEl.innerHTML = ''; return; }
    const C = 2 * Math.PI * 15, done = mp.reported === mp.total;
    pulseEl.innerHTML =
      '<button type="button" class="notif-pulse" data-nact="pulse" aria-label="Open progress for ' + esc(month) + ' ' + year + '">'
      + '<svg viewBox="0 0 40 40" class="notif-ring-svg" aria-hidden="true"><circle cx="20" cy="20" r="15" class="trk"/><circle cx="20" cy="20" r="15" class="val' + (done ? ' done' : '') + '" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - mp.pct / 100)).toFixed(1) + '" transform="rotate(-90 20 20)"/></svg>'
      + '<span class="notif-pulse-pct">' + mp.pct + '%</span>'
      + '<span class="min-w-0 flex-1 text-left"><span class="notif-cap">Reporting pulse</span>'
      + '<span class="notif-pulse-main">' + esc(month) + ' ' + year + '</span>'
      + '<span class="note block">' + mp.reported + ' of ' + mp.total + ' ' + plural(mp.total, 'church', 'churches') + ' reported</span></span>'
      + '<i data-lucide="arrow-right" class="w-4 h-4 text-ink-400"></i></button>';
  }

  function renderTabs() {
    const todos = items.filter((n) => n.kind === 'todo').length, ups = items.length - todos;
    const tabs = [['all', 'All', items.length], ['todo', 'To do', todos], ['update', 'Updates', ups]];
    panel.querySelector('#nTabs').innerHTML = tabs.map(([k, label, c]) =>
      '<button type="button" role="tab" class="notif-tab" data-nact="tab" data-tab="' + k + '" aria-selected="' + (filter === k) + '">' + label + (c ? '<span class="notif-tab-n">' + c + '</span>' : '') + '</button>').join('');
  }

  function itemHTML(n) {
    const unread = isUnread(n);
    const acts = (n.actions || []).map((a, i) => '<button type="button" data-action="' + i + '" class="ni-act' + (a.primary ? ' ni-act-primary' : '') + '">' + esc(a.label) + '</button>').join('');
    return '<li class="ni' + (n.kind === 'todo' ? ' todo' : '') + (unread ? ' unread' : '') + (n.own ? ' own' : '') + '" data-id="' + esc(n.id) + '">'
      + '<span class="ni-icon tone-' + n.tone + '" aria-hidden="true"><i data-lucide="' + n.icon + '" class="w-4 h-4"></i></span>'
      + '<div class="ni-content">'
      + '<button type="button" class="ni-open" data-act="open"><span class="ni-title">' + esc(n.title) + '</span>'
      + (n.sub ? '<span class="ni-sub">' + esc(n.sub) + '</span>' : '')
      + (n.progress ? '<span class="ni-bar" role="progressbar" aria-valuenow="' + n.progress.pct + '" aria-valuemin="0" aria-valuemax="100"><span style="width:' + n.progress.pct + '%"></span></span>' : '')
      + '</button>'
      + '<div class="ni-foot"><time class="ni-time" datetime="' + new Date(n.ts).toISOString() + '">' + esc(n.when || rel(n.ts)) + '</time>' + acts + '</div></div>'
      + '<div class="ni-tools">'
      + '<button type="button" class="notif-iconbtn" data-act="read" title="' + (unread ? 'Mark as read' : 'Mark as unread') + '" aria-label="' + (unread ? 'Mark as read' : 'Mark as unread') + '"><i data-lucide="' + (unread ? 'check' : 'mail') + '" class="w-3.5 h-3.5"></i></button>'
      + (n.snoozable ? '<button type="button" class="notif-iconbtn" data-act="snooze" title="Snooze until tomorrow" aria-label="Snooze until tomorrow"><i data-lucide="alarm-clock" class="w-3.5 h-3.5"></i></button>' : '')
      + '<button type="button" class="notif-iconbtn" data-act="dismiss" title="Dismiss" aria-label="Dismiss"><i data-lucide="x" class="w-3.5 h-3.5"></i></button>'
      + '</div>' + (unread ? '<span class="ni-dot" role="img" aria-label="Unread"></span>' : '') + '</li>';
  }

  function render() {
    if (!domReady || !panel) return;
    const keepScroll = listEl.scrollTop;
    const act = document.activeElement;
    const focusId = act && listEl.contains(act) ? (act.closest('.ni') || {}).dataset && act.closest('.ni').dataset.id : null;
    const focusSel = act && act.dataset ? (act.dataset.act ? '[data-act="' + act.dataset.act + '"]' : act.dataset.action != null ? '[data-action="' + act.dataset.action + '"]' : '.ni-open') : '.ni-open';

    renderPulse(); renderTabs();
    const shown = items.filter((n) => filter === 'all' || n.kind === filter);
    shownIds = new Set(shown.map((n) => n.id));
    let html = '';
    const todos = shown.filter((n) => n.kind === 'todo'), ups = shown.filter((n) => n.kind === 'update');
    if (todos.length) html += '<li class="notif-day" role="presentation">Needs attention</li>' + todos.map(itemHTML).join('');
    let last = '';
    ups.forEach((n) => { const b = bucket(n.ts); if (b !== last) { html += '<li class="notif-day" role="presentation">' + b + '</li>'; last = b; } html += itemHTML(n); });
    if (!shown.length) {
      const msg = filter === 'todo' ? ['Nothing to do', 'No open tasks right now.'] : filter === 'update' ? ['No recent updates', 'Activity in your districts will appear here.'] : ['You\u2019re all caught up', 'Nothing needs you this ' + dayPart() + '. Enjoy it.'];
      html = '<li class="notif-empty" role="presentation"><span class="notif-empty-seal"><i data-lucide="check-check" class="w-5 h-5"></i></span><strong>' + msg[0] + '</strong><span class="note">' + msg[1] + '</span></li>';
    }
    listEl.innerHTML = html;
    listEl.scrollTop = keepScroll;

    const hidden = allItems.filter(isHidden).length;
    footEl.hidden = !hidden;
    footEl.innerHTML = hidden ? '<button type="button" class="notif-link" data-nact="restore"><i data-lucide="rotate-ccw" class="w-3 h-3"></i> Restore ' + hidden + ' dismissed or snoozed</button>' : '';
    renderSettings();
    ctx.refreshIcons();
    if (focusId) {
      const li = [...listEl.querySelectorAll('.ni')].find((x) => x.dataset.id === focusId);
      const target = li && (li.querySelector(focusSel) || li.querySelector('.ni-open'));
      if (target) target.focus({ preventScroll: true });
    }
  }

  function renderSettings() {
    const p = store.prefs;
    const row = (key, title, desc, on) =>
      '<label class="notif-pref"><span><span class="notif-pref-t">' + title + '</span><span class="note block">' + desc + '</span></span>'
      + '<input type="checkbox" role="switch" class="notif-switch" data-pref="' + key + '"' + (on ? ' checked' : '') + '></label>';
    settingsEl.innerHTML = row('toast', 'Pop-up alerts', 'A small banner when something new arrives', p.toast)
      + row('desktop', 'Desktop alerts', 'A system notification when Starsys is in the background', p.desktop)
      + row('sound', 'Sound', 'A soft chime for new notifications', p.sound);
  }

  /* ------------------------------ toasts ------------------------------ */
  function toast(o) {
    ensureDom();
    const el = document.createElement('div');
    el.className = 'notif-toast';
    el.setAttribute('role', 'group');
    el.innerHTML = '<span class="ni-icon tone-' + (o.tone || 'gold') + '" aria-hidden="true"><i data-lucide="' + (o.icon || 'bell') + '" class="w-4 h-4"></i></span>'
      + '<div class="min-w-0 flex-1"><p class="notif-toast-t">' + esc(o.title) + '</p>' + (o.sub ? '<p class="notif-toast-s">' + esc(o.sub) + '</p>' : '') + '</div>'
      + (o.undo ? '<button type="button" class="notif-toast-undo" data-t="undo">Undo</button>' : '')
      + '<button type="button" class="notif-toast-x" data-t="x" aria-label="Dismiss"><i data-lucide="x" class="w-3.5 h-3.5"></i></button>';
    let timer = null;
    const remove = () => { clearTimeout(timer); el.classList.add('leaving'); setTimeout(() => el.remove(), 220); };
    const arm = () => { timer = setTimeout(remove, o.ttl || 6500); };
    el.addEventListener('mouseenter', () => clearTimeout(timer));
    el.addEventListener('mouseleave', arm);
    el.addEventListener('click', (ev) => {
      const t = ev.target.closest('[data-t]');
      if (t && t.dataset.t === 'undo') { o.undo(); remove(); return; }
      if (t && t.dataset.t === 'x') { remove(); return; }
      if (o.onClick) { o.onClick(); remove(); }
    });
    toastsEl.appendChild(el);
    while (toastsEl.children.length > 3) toastsEl.firstChild.remove();
    ctx.refreshIcons();
    arm();
    return el;
  }

  function chime() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioCtx = audioCtx || new AC();
      const t0 = audioCtx.currentTime;
      [[880, 0], [1318.5, 0.11]].forEach(([f, d]) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0 + d);
        g.gain.exponentialRampToValueAtTime(0.1, t0 + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.45);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(t0 + d); o.stop(t0 + d + 0.5);
      });
    } catch (e) { /* ignore */ }
  }

  /* ------------------------------ actions ------------------------------ */
  function markRead(id) { store.read[id] = Date.now(); save(); updateBell(); }
  function markVisibleRead() {
    let changed = false;
    items.forEach((n) => { if (shownIds.has(n.id) && !keepUnread.has(n.id) && isUnread(n)) { store.read[n.id] = Date.now(); changed = true; } });
    keepUnread.clear();
    if (changed) save();
  }
  function dismiss(id) {
    const n = find(id); if (!n) return;
    store.dismissed[id] = Date.now(); save(); rebuild();
    toast({ title: 'Dismissed', sub: n.title, icon: 'x', tone: 'ink', ttl: 5000, undo: () => { delete store.dismissed[id]; save(); rebuild(); } });
  }
  function snooze(id) {
    const n = find(id); if (!n) return;
    const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(8, 0, 0, 0);
    const prevRead = store.read[id];
    store.snoozed[id] = t.getTime(); delete store.read[id]; save(); rebuild();
    toast({ title: 'Snoozed until tomorrow, 8:00 AM', sub: n.title, icon: 'alarm-clock', tone: 'gold', ttl: 5000,
      undo: () => { delete store.snoozed[id]; if (prevRead !== undefined) store.read[id] = prevRead; save(); rebuild(); } });
  }
  function toggleRead(id) {
    const n = find(id); if (!n) return;
    if (isUnread(n)) { store.read[id] = Date.now(); keepUnread.delete(id); }
    else { store.read[id] = 0; keepUnread.add(id); }
    save(); updateBell(); render();
  }
  function markAll() { items.forEach((n) => { if (!n.own) store.read[n.id] = Date.now(); }); save(); updateBell(); render(); }

  async function setPref(key, on, inputEl) {
    if (key === 'desktop' && on) {
      if (!('Notification' in window)) { inputEl.checked = false; toast({ title: 'Desktop alerts are not supported here', icon: 'bell-off', tone: 'ink' }); return; }
      let perm = Notification.permission;
      if (perm === 'default') perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        inputEl.checked = false;
        toast({ title: 'Desktop alerts are blocked', sub: 'Allow notifications for Starsys in your system or browser settings.', icon: 'bell-off', tone: 'rose', ttl: 8000 });
        return;
      }
    }
    store.prefs[key] = !!on; save();
    if (key === 'sound' && on) chime();
    if (key === 'desktop' && on) { try { new Notification('Desktop alerts are on', { body: 'You will be notified when Starsys is in the background.', icon: new URL('./apple-touch-icon.png', document.baseURI).href }); } catch (e) { /* ignore */ } }
  }

  /* ------------------------------ open / close ------------------------------ */
  function open() {
    if (!started) return;
    ensureDom();
    panelOpen = true; closeSettings();
    panel.classList.remove('hidden'); backdrop.classList.add('show');
    bell.setAttribute('aria-expanded', 'true');
    render();
    refresh({ remote: true });
    const first = listEl.querySelector('.ni-open');
    (first || panel).focus({ preventScroll: true });
  }
  function close(opts) {
    if (!panelOpen) return;
    panelOpen = false;
    panel.classList.add('hidden'); backdrop.classList.remove('show');
    bell.setAttribute('aria-expanded', 'false');
    markVisibleRead(); updateBell();
    if (opts && opts.focusBell) bell.focus();
  }
  function closeSettings() {
    settingsOpen = false;
    if (settingsEl) settingsEl.hidden = true;
    const b = panel && panel.querySelector('[data-nact="settings"]');
    if (b) b.setAttribute('aria-expanded', 'false');
  }
  function toggleSettings() {
    settingsOpen = !settingsOpen;
    settingsEl.hidden = !settingsOpen;
    panel.querySelector('[data-nact="settings"]').setAttribute('aria-expanded', String(settingsOpen));
  }

  /* ------------------------------ events ------------------------------ */
  function wire() {
    if (wired) return;
    wired = true;
    backdrop.addEventListener('click', () => close({ focusBell: true }));
    panel.addEventListener('click', (ev) => {
      const nact = ev.target.closest('[data-nact]');
      if (nact) {
        const k = nact.dataset.nact;
        if (k === 'close') close({ focusBell: true });
        else if (k === 'markall') markAll();
        else if (k === 'settings') toggleSettings();
        else if (k === 'tab') { filter = nact.dataset.tab; render(); }
        else if (k === 'restore') { store.dismissed = {}; store.snoozed = {}; save(); rebuild(); }
        else if (k === 'pulse') { close(); ctx.go.tab('tab-progress'); }
        return;
      }
      const li = ev.target.closest('.ni'); if (!li) return;
      const id = li.dataset.id, n = find(id); if (!n) return;
      const actBtn = ev.target.closest('[data-action]');
      if (actBtn) { markRead(id); close(); const a = n.actions && n.actions[Number(actBtn.dataset.action)]; if (a) a.run(); return; }
      const t = ev.target.closest('[data-act]'); if (!t) return;
      if (t.dataset.act === 'open') { markRead(id); close(); n.open && n.open(); }
      else if (t.dataset.act === 'read') toggleRead(id);
      else if (t.dataset.act === 'dismiss') {
        const next = li.nextElementSibling && li.nextElementSibling.querySelector && li.nextElementSibling.querySelector('.ni-open');
        dismiss(id);
        const target = next ? [...listEl.querySelectorAll('.ni')].find((x) => x.dataset.id === (next.closest('.ni') || {}).dataset.id) : null;
        (target ? target.querySelector('.ni-open') : listEl.querySelector('.ni-open') || panel).focus({ preventScroll: true });
      }
      else if (t.dataset.act === 'snooze') snooze(id);
    });
    panel.addEventListener('change', (ev) => { const sw = ev.target.closest('[data-pref]'); if (sw) setPref(sw.dataset.pref, sw.checked, sw); });
    panel.addEventListener('keydown', (ev) => {
      const opens = [...listEl.querySelectorAll('.ni-open')];
      const idx = opens.indexOf(document.activeElement);
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        if (!opens.length) return;
        ev.preventDefault();
        const nxt = ev.key === 'ArrowDown' ? (idx < 0 ? 0 : Math.min(opens.length - 1, idx + 1)) : (idx < 0 ? 0 : Math.max(0, idx - 1));
        opens[nxt].focus();
      } else if (ev.key === 'Home' && idx >= 0) { ev.preventDefault(); opens[0].focus(); }
      else if (ev.key === 'End' && idx >= 0) { ev.preventDefault(); opens[opens.length - 1].focus(); }
      else if ((ev.key === 'Delete' || ev.key === 'Backspace') && idx >= 0) {
        ev.preventDefault();
        const li = opens[idx].closest('.ni');
        const nextOpen = opens[idx + 1] || opens[idx - 1];
        dismiss(li.dataset.id);
        if (nextOpen) { const nid = nextOpen.closest('.ni').dataset.id; const t = [...listEl.querySelectorAll('.ni')].find((x) => x.dataset.id === nid); if (t) t.querySelector('.ni-open').focus(); }
      }
    });
    document.addEventListener('click', (ev) => {
      if (!panelOpen) return;
      // Actions inside the panel (dismiss, snooze, tabs...) re-render the list, which detaches the clicked
      // button from the page by the time this handler runs. composedPath() is recorded at dispatch time, so
      // it still tells us the click began inside the panel, and it must not be mistaken for an outside click.
      const inside = ev.composedPath().some((n) => n && n.nodeType === 1 && (n.id === 'notifPanel' || n.id === 'notifBtn' || n.classList.contains('notif-toast')));
      if (!inside) close();
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape' || !panelOpen) return;
      if (settingsOpen) { closeSettings(); panel.querySelector('[data-nact="settings"]').focus(); return; }
      close({ focusBell: true });
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && started) refresh({ remote: true }); });
    window.addEventListener('focus', () => { if (started) refresh({ remote: true }); });
  }

  if (bell) {
    bell.setAttribute('aria-haspopup', 'dialog');
    bell.setAttribute('aria-expanded', 'false');
    bell.addEventListener('click', (ev) => { ev.stopPropagation(); if (!started) return; panelOpen ? close({ focusBell: false }) : open(); });
  }

  /* ------------------------------ lifecycle ------------------------------ */
  async function refresh(opts) {
    if (!started) return;
    if (opts && opts.remote) { try { remote = await fetchRemote(); } catch (e) { /* keep last */ } }
    rebuild();
  }
  function schedule() { clearTimeout(debounceTimer); debounceTimer = setTimeout(() => rebuild(), 350); }

  async function start() {
    const u = ctx.getUser();
    if (!u) return;
    if (started && uid === u.id) { refresh({ remote: true }); return; }
    stop();
    uid = u.id; store = loadStore(); save();
    started = true; initialised = false; announced = new Map(); filter = 'all'; remote = { approvals: [], log: [] };
    ensureDom();
    await refresh({ remote: true });
    tickTimer = setInterval(() => rebuild(), 60000);         // relative times, snooze expiry, month roll-over
    pollTimer = setInterval(() => refresh({ remote: true }), 120000);
    const sb = ctx.getSupabase();
    if (sb && (u.role === 'admin' || u.role === 'super_admin')) {
      profChannel = sb.channel('notif-profiles')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => { clearTimeout(debounceTimer); debounceTimer = setTimeout(() => refresh({ remote: true }), 400); })
        .subscribe();
    }
  }
  function stop() {
    started = false;
    clearInterval(tickTimer); clearInterval(pollTimer); clearTimeout(debounceTimer);
    const sb = ctx.getSupabase();
    if (profChannel && sb) { try { sb.removeChannel(profChannel); } catch (e) { /* ignore */ } }
    profChannel = null;
    if (panelOpen) { panelOpen = false; panel.classList.add('hidden'); backdrop.classList.remove('show'); }
    if (toastsEl) toastsEl.innerHTML = '';
    items = []; allItems = [];
    if (badge) badge.hidden = true;
    if (todoRing) todoRing.hidden = true;
    document.title = baseTitle;
  }

  return {
    start, stop, refresh, open, close,
    onEntryEvent() { if (started) schedule(); },
    get isOpen() { return panelOpen; }
  };
}
