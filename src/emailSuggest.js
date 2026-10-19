/* ============================================================================
   Remembered e-mail suggestions for the sign-in screen
   ----------------------------------------------------------------------------
   * After a successful sign-in the address is remembered on this device (e-mail only, never a password).
   * Clicking or focusing the e-mail box offers the remembered addresses; typing narrows the list, and the
     person can ignore it and just keep typing.
   * Enter in the e-mail box moves the cursor to the password box (or picks the highlighted suggestion first).
   * Every suggestion has a × to forget it, for shared computers. At most 5 are kept, most recent first.

   A real ARIA combobox (not a <datalist>) so it can be styled, keyboard-driven and have a "forget" button.
   No imports; the two inputs are passed in.
   ============================================================================ */

const KEY = 'starsys_recent_emails_v1';
const MAX = 5;

function readAll() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.includes('@')).slice(0, MAX) : [];
  } catch (e) { return []; }
}
function writeAll(list) { try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch (e) { /* storage unavailable */ } }

export function createEmailSuggest({ input, next }) {
  const list = document.createElement('ul');
  list.id = 'emailSuggest';
  list.className = 'es-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Saved email addresses');
  list.hidden = true;
  input.insertAdjacentElement('afterend', list);

  const live = document.createElement('div');
  live.className = 'sr-only'; live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
  list.insertAdjacentElement('afterend', live);

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', list.id);

  let shown = [], active = -1;

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function matches(offerAll) {
    const q = input.value.trim().toLowerCase();
    const all = readAll();
    if (!q) return all;
    // Clicking into a box that already holds a saved address: still offer the list, so another account is one click away.
    if (offerAll && all.includes(q)) return all;
    return all.filter((e) => e !== q && e.includes(q));
  }
  function setActive(i) {
    active = i;
    list.querySelectorAll('.es-item').forEach((el, idx) => {
      const on = idx === i;
      el.setAttribute('aria-selected', String(on));
      el.classList.toggle('active', on);
    });
    if (i >= 0) input.setAttribute('aria-activedescendant', 'es-opt-' + i); else input.removeAttribute('aria-activedescendant');
  }
  function close() {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    setActive(-1);
  }
  function render(offerAll) {
    shown = matches(offerAll === true);
    if (!shown.length) { close(); return; }
    list.innerHTML = shown.map((e, i) =>
      '<li class="es-item" role="option" id="es-opt-' + i + '" data-email="' + esc(e) + '" aria-selected="false">'
      + '<span class="es-mail">' + esc(e) + '</span>'
      + '<button type="button" class="es-x" tabindex="-1" aria-label="Forget ' + esc(e) + '" title="Forget this address">&times;</button></li>'
    ).join('') + '<li class="es-hint" role="presentation">Saved on this device only</li>';
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    setActive(-1);
  }
  function pick(email) {
    input.value = email;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    close();
    if (next) next.focus();
  }
  function forget(email) {
    writeAll(readAll().filter((e) => e !== email));
    live.textContent = ''; setTimeout(() => { live.textContent = email + ' removed from saved addresses.'; }, 30);
    render(true);
  }

  input.addEventListener('focus', () => render(true));
  input.addEventListener('click', () => render(true));
  input.addEventListener('input', () => render(false));
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (ev) => {
    const open = !list.hidden;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      if (!open) { render(true); if (list.hidden) return; }
      ev.preventDefault();
      const n = shown.length;
      setActive(ev.key === 'ArrowDown' ? (active + 1) % n : (active <= 0 ? n - 1 : active - 1));
    } else if (ev.key === 'Enter') {
      if (open && active >= 0) { ev.preventDefault(); pick(shown[active]); }
      else if (input.value.trim() && next) { ev.preventDefault(); close(); next.focus(); }   // Enter = on to the password box
    } else if (ev.key === 'Escape') {
      if (open) { ev.preventDefault(); close(); }
    }
  });
  // mousedown (not click) so the input keeps focus and the list does not vanish before the click lands
  list.addEventListener('mousedown', (ev) => {
    ev.preventDefault();
    const item = ev.target.closest('.es-item'); if (!item) return;
    if (ev.target.closest('.es-x')) forget(item.dataset.email); else pick(item.dataset.email);
  });

  return {
    remember(email) {
      const e = String(email || '').trim().toLowerCase();
      if (!e.includes('@')) return;
      writeAll([e, ...readAll().filter((x) => x !== e)]);
    },
    forget, list: readAll
  };
}
