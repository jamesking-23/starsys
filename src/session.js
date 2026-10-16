/* ============================================================================
   Starsys session policy
   ----------------------------------------------------------------------------
   Two independent limits, both required for apps that handle financial data:

     IDLE      sign out after 30 minutes with no activity (a "Still there?" countdown first)
     ABSOLUTE  sign out 12 hours after signing in, however active the person is

   Why timestamps instead of timers: a setTimeout does not reliably count the time a computer spends
   asleep, and it is gone entirely after a shutdown or restart, while the saved login is restored. So the
   policy is enforced by comparing the current time with timestamps saved in localStorage:

     * every few seconds while the app is open     (heartbeat)
     * the moment a window is shown or focused     (wake from sleep, switching back to the app)
     * when the app starts                         (restart, new tab, reopening after a shutdown)

   The record is shared by every window, so activity in one keeps all of them alive and signing out
   in one signs out the rest. This module has no imports; main.js injects the few things it needs.
   ============================================================================ */

export const SESSION_POLICY = {
  idleMs: 30 * 60 * 1000,            // sign out after this long without activity
  idleWarnMs: 60 * 1000,             // show "Still there?" this long before that
  absoluteMs: 12 * 60 * 60 * 1000,   // hard limit on one sign-in
  absoluteWarnMs: 5 * 60 * 1000,     // warn this long before the hard limit
  tickMs: 5000,                      // heartbeat
  writeEveryMs: 5000,                // how often activity is written to storage at most
  clockSkewMs: 5 * 60 * 1000         // a clock set backwards by more than this is treated as tampering
};

const KEY = 'starsys_session_v1';

const human = (ms) => {
  const m = Math.round(ms / 60000);
  if (m >= 60 && m % 60 === 0) { const h = m / 60; return h + (h === 1 ? ' hour' : ' hours'); }
  return m + (m === 1 ? ' minute' : ' minutes');
};
export function sessionMessage(reason, p = SESSION_POLICY) {
  if (reason === 'idle') return 'You were signed out after ' + human(p.idleMs) + ' of inactivity. Please sign in again.';
  if (reason === 'absolute') return 'For your security, a sign-in lasts at most ' + human(p.absoluteMs) + '. Please sign in again.';
  if (reason === 'other') return 'You were signed out in another window.';
  return 'We could not verify your previous session, so you were signed out for your security. Please sign in again.';
}

function read() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    return s && typeof s.start === 'number' && typeof s.last === 'number' && s.uid ? s : null;
  } catch (e) { return null; }
}
function write(rec) { try { localStorage.setItem(KEY, JSON.stringify(rec)); } catch (e) { /* storage unavailable */ } }
function clear() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }

/** Pure decision: is this saved record still a valid session for this user at time t? */
export function judge(rec, uid, t = Date.now(), p = SESSION_POLICY) {
  if (!rec || rec.uid !== uid) return { ok: false, reason: 'unverified' };
  const idle = t - rec.last, age = t - rec.start;
  if (idle < -p.clockSkewMs || age < -p.clockSkewMs) return { ok: false, reason: 'unverified' };   // clock moved back
  if (age >= p.absoluteMs) return { ok: false, reason: 'absolute' };
  if (idle >= p.idleMs) return { ok: false, reason: 'idle' };
  return { ok: true, idleLeft: p.idleMs - Math.max(idle, 0), ageLeft: p.absoluteMs - Math.max(age, 0) };
}

export function createSessionGuard(ctx, policy = SESSION_POLICY) {
  const P = policy;
  let started = false, uid = null, expiring = false;
  let tickTimer = null, cdTimer = null, lastWrite = 0;
  let warning = null, absDismissed = false, prevFocus = null;
  let overlay, dialog, titleEl, descEl, countEl, ringEl, stayBtn, outBtn, liveEl, announcedAt = Infinity;

  /* ------------------------------ record ------------------------------ */
  function begin(userId) {            // a fresh sign-in
    const t = Date.now();
    write({ uid: userId, start: t, last: t });
    absDismissed = false; expiring = false;
  }
  function ensure(userId) { const r = read(); if (!r || r.uid !== userId) begin(userId); }
  function verdictForRestored(userId) { return judge(read(), userId); }

  /* ------------------------------ activity ------------------------------ */
  const ACTIVITY = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'];
  function onActivity() {
    if (!started || warning === 'idle') return;      // while the countdown is up, only an explicit click counts
    const t = Date.now();
    if (t - lastWrite < P.writeEveryMs) return;
    const rec = read();
    // Activity must never revive a session that has already expired (e.g. the first mouse move after waking).
    const v = judge(rec, uid, t, P);
    if (!v.ok) { check(); return; }
    lastWrite = t; rec.last = t; write(rec);
  }
  function touch() { const rec = read(); if (rec && rec.uid === uid) { rec.last = Date.now(); lastWrite = rec.last; write(rec); } }

  /* ------------------------------ warning dialog ------------------------------ */
  function ensureDom() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'sg-overlay'; overlay.hidden = true;
    overlay.innerHTML =
      '<div class="sg-dialog panel rounded-sm shadow-2xl" role="alertdialog" aria-modal="true" aria-labelledby="sgTitle" aria-describedby="sgDesc" tabindex="-1">'
      + '<div class="sg-ring"><svg viewBox="0 0 44 44" aria-hidden="true"><circle class="trk" cx="22" cy="22" r="19"/><circle class="val" cx="22" cy="22" r="19" transform="rotate(-90 22 22)"/></svg><span class="sg-count" id="sgCount"></span></div>'
      + '<h3 id="sgTitle" class="sg-title"></h3><p id="sgDesc" class="sg-desc"></p>'
      + '<div class="sg-actions"><button type="button" class="btn-primary sg-btn" id="sgStay"></button><button type="button" class="btn-ghost sg-btn" id="sgOut">Sign out now</button></div></div>';
    document.body.appendChild(overlay);
    liveEl = document.createElement('div');
    liveEl.className = 'sr-only'; liveEl.setAttribute('role', 'status'); liveEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(liveEl);
    dialog = overlay.querySelector('.sg-dialog'); titleEl = overlay.querySelector('#sgTitle'); descEl = overlay.querySelector('#sgDesc');
    countEl = overlay.querySelector('#sgCount'); ringEl = overlay.querySelector('.val');
    stayBtn = overlay.querySelector('#sgStay'); outBtn = overlay.querySelector('#sgOut');
    const C = 2 * Math.PI * 19; ringEl.setAttribute('stroke-dasharray', C.toFixed(1));
    stayBtn.addEventListener('click', () => dismissWarning());
    outBtn.addEventListener('click', () => expire('manual'));
    overlay.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); dismissWarning(); }
      else if (ev.key === 'Tab') { ev.preventDefault(); (document.activeElement === stayBtn ? outBtn : stayBtn).focus(); }
    });
  }
  const fmt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  function showWarning(kind) {
    ensureDom();
    if (warning !== kind) {
      warning = kind; announcedAt = Infinity;
      prevFocus = document.activeElement;
      if (kind === 'idle') {
        titleEl.textContent = 'Are you still there?';
        stayBtn.textContent = 'Stay signed in';
      } else {
        titleEl.textContent = 'Your sign-in is ending soon';
        stayBtn.textContent = 'Understood';
      }
      overlay.hidden = false;
      clearInterval(cdTimer); cdTimer = setInterval(updateCountdown, 1000);
      stayBtn.focus();
    }
    updateCountdown();
  }
  function updateCountdown() {
    if (!warning) return;
    const v = judge(read(), uid, Date.now(), P);
    if (!v.ok) { check(); return; }
    const left = warning === 'idle' ? v.idleLeft : v.ageLeft;
    const total = warning === 'idle' ? P.idleWarnMs : P.absoluteWarnMs;
    countEl.textContent = warning === 'idle' ? String(Math.max(0, Math.ceil(left / 1000))) : fmt(left);
    ringEl.setAttribute('stroke-dashoffset', ((2 * Math.PI * 19) * (1 - Math.max(0, Math.min(1, left / total)))).toFixed(1));
    descEl.innerHTML = warning === 'idle'
      ? 'For your security you will be signed out in <strong>' + Math.max(0, Math.ceil(left / 1000)) + ' seconds</strong> because there has been no activity.'
      : 'A sign-in lasts at most ' + human(P.absoluteMs) + '. You will be signed out in <strong>' + fmt(left) + '</strong>. Please save your work now; you can sign in again straight away.';
    const sec = Math.ceil(left / 1000);       // screen readers: announce at 30s, 10s, 5s (not every second)
    for (const mark of [30, 10, 5]) {
      if (sec <= mark && announcedAt > mark) { announcedAt = mark; liveEl.textContent = (warning === 'idle' ? 'Signing out in ' + sec + ' seconds.' : 'Sign-in ends in ' + fmt(left) + '.'); break; }
    }
  }
  function hideWarning() {
    if (!warning) return;
    warning = null; clearInterval(cdTimer); cdTimer = null;
    if (overlay) overlay.hidden = true;
    if (prevFocus && prevFocus.focus && document.contains(prevFocus)) { try { prevFocus.focus(); } catch (e) { /* ignore */ } }
    prevFocus = null;
  }
  function dismissWarning() {
    if (warning === 'idle') touch(); else if (warning === 'absolute') absDismissed = true;
    hideWarning();
  }

  /* ------------------------------ decisions ------------------------------ */
  async function expire(reason) {
    if (expiring) return;
    expiring = true;
    hideWarning();
    try { await ctx.endSession(reason, reason === 'manual' ? null : sessionMessage(reason, P)); } finally { expiring = false; }
  }

  function check() {
    if (!started || expiring || !ctx.isSignedIn()) return;
    const v = judge(read(), uid, Date.now(), P);
    if (!v.ok) { expire(v.reason); return; }
    if (v.idleLeft <= P.idleWarnMs) showWarning('idle');
    else if (warning === 'idle') hideWarning();                                  // activity in another window
    else if (v.ageLeft <= P.absoluteWarnMs && !absDismissed) showWarning('absolute');
    else if (warning === 'absolute' && v.ageLeft > P.absoluteWarnMs) hideWarning();
  }

  /* ------------------------------ lifecycle ------------------------------ */
  const onWake = () => { if (!document.hidden) check(); };
  const onStorage = (ev) => { if (ev.key === KEY && ev.newValue === null && started && !expiring) expire('other'); };

  function start() {
    uid = ctx.getUserId();
    if (!uid) return;
    if (started) { check(); return; }
    ensure(uid);
    started = true; expiring = false; absDismissed = false; lastWrite = Date.now();
    ACTIVITY.forEach((e) => window.addEventListener(e, onActivity, { passive: true, capture: true }));
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    window.addEventListener('pageshow', onWake);
    window.addEventListener('online', onWake);
    window.addEventListener('storage', onStorage);
    tickTimer = setInterval(check, P.tickMs);
    check();
  }
  function stop() {
    started = false;
    clearInterval(tickTimer); tickTimer = null;
    ACTIVITY.forEach((e) => window.removeEventListener(e, onActivity, { capture: true }));
    document.removeEventListener('visibilitychange', onWake);
    window.removeEventListener('focus', onWake);
    window.removeEventListener('pageshow', onWake);
    window.removeEventListener('online', onWake);
    window.removeEventListener('storage', onStorage);
    hideWarning();
    clear();                       // other windows see the record disappear and sign out too
  }

  return { begin, ensure, verdictForRestored, start, stop, check, clear, message: (r) => sessionMessage(r, P), get running() { return started; } };
}
