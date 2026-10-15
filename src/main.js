
import './styles.css';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/dm-sans/latin-700.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/archivo/latin-700.css';
import '@fontsource/fraunces/latin-600.css';
import '@fontsource/fraunces/latin-700.css';
import '@fontsource/fraunces/latin-400-italic.css';
import { createClient } from '@supabase/supabase-js';
import ExcelJS from 'exceljs';
import { refreshIcons } from './icons.js';
import './ui.js';

// Where password-reset / confirmation e-mails send people back to. On the web that's this page.
// In the packaged desktop app (file://) there is no web address, so set VITE_PUBLIC_APP_URL at
// build time to your hosted copy, or leave it empty to use the Site URL from Supabase Auth settings.
function appRedirectUrl(){
  if (window.location.protocol === 'file:') return import.meta.env.VITE_PUBLIC_APP_URL || undefined;
  return window.location.origin + window.location.pathname;
}

/* ============ CONFIG ============ */
const SUPABASE_URL = 'https://fwczzdckzyeszlgdelip.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3Y3p6ZGNrenllc3psZ2RlbGlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAzMzg0NDUsImV4cCI6MjEwNTkxNDQ0NX0.y2FsDidvLg7tEgSLfAkSBQ_emPCDecwR57gY-GJVAdM';
const SUPABASE_CONFIGURED = SUPABASE_URL.indexOf('REPLACE_ME') === -1 && SUPABASE_ANON_KEY.indexOf('REPLACE_ME') === -1;
let supabase = null;
if (SUPABASE_CONFIGURED) {
  try { supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { detectSessionInUrl: true } }); } catch (e) { console.error(e); }
}

/* ============ OFFERING TYPES — DB-backed (offering_types table) with the list below kept as a
   fallback default if that table hasn't been provisioned yet, so existing installs keep working. ============ */
const DEFAULT_OFFERINGS = [{"key": "tithe", "label": "Tithe"}, {"key": "combined", "label": "Combined"}, {"key": "camp", "label": "Camp"}, {"key": "c13th", "label": "13th Sabbath"}, {"key": "gc", "label": "GC"}, {"key": "kah", "label": "KAH"}, {"key": "primeRadio", "label": "Prime Radio"}, {"key": "hopeTV", "label": "Hope TV"}, {"key": "adra", "label": "ADRA"}, {"key": "others", "label": "Others"}];
let OFFERINGS = DEFAULT_OFFERINGS.slice();
let offeringsFromDb = false; // true once a real offering_types table has been read successfully
let offeringsChannel = null;
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const FIRST_YEAR = 2026; // the app's reporting start year — years before this never appear as options
let extraYears = []; // years added via "+ Next year" beyond the real-time ceiling, this session

/* ============ DISTRICTS/CHURCHES — now DB-backed, loaded at runtime ============ */
let DISTRICTS = {};          // { districtName: [churchName, ...] }
let DISTRICT_NAMES = [];

let state = {};
let auditLog = [];
let currentUser = null;
let entriesChannel = null;
let profileChannel = null;
let districtsChannel = null;
let presenceChannel = null;
let onlineUserIds = new Set();
let idleTimer = null;
const IDLE_LIMIT_MS = 8 * 60 * 60 * 1000; // 8 hours of inactivity before auto-logout
let myScope = [];            // 'all' | [districtName, ...]
let districtModalResolve = null;

function slug(s){ return String(s).trim().replace(/\s+/g,'_').replace(/[\/\\"'.]/g,''); }
function keyFor(d,c,m,y){ return d+'|'+c+'|'+m+'|'+y; }
function docId(d,c,m,y){ return slug(d)+'__'+slug(c)+'__'+slug(m)+'__'+y; }
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function entryTotal(e){ if(!e) return 0; return OFFERINGS.reduce((s,o)=> s + (e[o.key]===null||e[o.key]===undefined||e[o.key]==='' ? 0 : Number(e[o.key])), 0); }
function entryStatus(e){ if(!e) return 'Pending'; return OFFERINGS.some(o=>e[o.key]!==null&&e[o.key]!==undefined&&e[o.key]!=='') ? 'Entered' : 'Pending'; }
function fieldHasValue(e,key){ return !!(e && e[key]!==null && e[key]!==undefined && e[key]!==''); }
// Completeness is computed per OFFERING FIELD, not once for the whole month-row — a month can be
// "partially filled" (some fields on time, others still blank) and that must be visible as such,
// not collapsed into a single Entered/Pending flag.
function monthComplete(e){ return OFFERINGS.every(o=> fieldHasValue(e,o.key)); }
function monthHasAnyValue(e){ return OFFERINGS.some(o=> fieldHasValue(e,o.key)); }
function monthPartiallyFilled(e){ return monthHasAnyValue(e) && !monthComplete(e); }
function parseUserAgentBasic(ua){
  ua = ua || '';
  let os = 'Unknown OS';
  if(/Windows NT 10/.test(ua)) os='Windows 10/11';
  else if(/Windows NT/.test(ua)) os='Windows';
  else if(/Android/.test(ua)){ const m=ua.match(/Android\s([\d.]+)/); os='Android'+(m?' '+m[1]:''); }
  else if(/iPhone|iPad|iPod/.test(ua)){ const m=ua.match(/OS (\d+_\d+)/); os='iOS'+(m?' '+m[1].replace('_','.'):''); }
  else if(/Mac OS X/.test(ua)){ const m=ua.match(/Mac OS X (\d+[_.]\d+)/); os='macOS'+(m?' '+m[1].replace('_','.'):''); }
  else if(/Linux/.test(ua)) os='Linux';
  let browser = 'Unknown browser';
  if(/Edg\//.test(ua)) browser='Edge';
  else if(/OPR\//.test(ua)) browser='Opera';
  else if(/CriOS\//.test(ua)) browser='Chrome (iOS)';
  else if(/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser='Chrome';
  else if(/Firefox\//.test(ua)) browser='Firefox';
  else if(/Safari\//.test(ua)) browser='Safari';
  return { os, browser };
}
// Best-effort device/location fingerprint for the audit trail. Browsers deliberately limit how
// precisely a device can be identified from JavaScript (no exact hardware model in most cases) —
// this uses every signal that's actually available: parsed OS/browser, User-Agent Client Hints
// (Chromium — sometimes exposes a device model at high entropy), screen size, timezone, and
// high-accuracy GPS coordinates if the browser grants the location permission prompt.
async function deviceDescriptor(){
  let tz=''; try{ tz = Intl.DateTimeFormat().resolvedOptions().timeZone; }catch(e){}
  const scr = window.screen ? (window.screen.width+'x'+window.screen.height) : 'unknown';
  const { os, browser } = parseUserAgentBasic(navigator.userAgent);
  let deviceModel = '';
  try{
    if(navigator.userAgentData && navigator.userAgentData.getHighEntropyValues){
      const hi = await navigator.userAgentData.getHighEntropyValues(['model','platformVersion']);
      if(hi.model) deviceModel = hi.model;
    }
  }catch(e){}
  let loc = '';
  if('geolocation' in navigator){
    try{
      const pos = await new Promise((resolve)=>{
        navigator.geolocation.getCurrentPosition(
          p=>resolve(p),
          ()=>resolve(null), // denied, unavailable, or timed out — proceed without it
          { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 }
        );
      });
      if(pos){ loc = ' | GPS '+pos.coords.latitude.toFixed(6)+','+pos.coords.longitude.toFixed(6)+' (±'+Math.round(pos.coords.accuracy)+'m)'; }
    }catch(e){}
  }
  return browser+' on '+os+(deviceModel?' ('+deviceModel+')':'')+' | screen '+scr+(tz?' | '+tz:'')+loc;
}
function fmtDate(iso){ if(!iso) return '—'; try{ return new Date(iso).toLocaleString(); }catch(e){ return iso; } }
function initialsFor(name){
  const parts = String(name||'').trim().split(/\s+/).filter(Boolean);
  if(!parts.length) return '?';
  return (parts[0][0] + (parts.length>1?parts[parts.length-1][0]:'')).toUpperCase();
}
function colorForName(name){
  const palette = ['#163A5A','#2F7D4F','#A63232','#8A5A00','#3A5AA6','#7A3A8A','#0F7A73','#8A4B2F'];
  let hash = 0; const s = String(name||'');
  for(let i=0;i<s.length;i++){ hash = (hash*31 + s.charCodeAt(i)) >>> 0; }
  return palette[hash % palette.length];
}
function avatarHTML(name, size, url){
  const dim = size==='xl' ? 'w-24 h-24 text-2xl' : size==='lg' ? 'w-16 h-16 text-lg' : size==='md' ? 'w-9 h-9 text-[0.6875rem]' : 'w-8 h-8 text-[0.625rem]';
  const base = dim+' rounded-full overflow-hidden flex items-center justify-center font-bold flex-shrink-0';
  if(url) return '<span class="'+base+'"><img src="'+esc(url)+'" alt="" class="w-full h-full object-cover"></span>';
  return '<span class="'+base+'" style="background:'+colorForName(name)+';color:#f5ead3">'+esc(initialsFor(name))+'</span>';
}
function localAvatarKey(id){ return 'starsys_avatar_'+id; }
function avatarUrlFor(u){
  if(!u) return '';
  if(u.avatar_url) return u.avatar_url;
  try{ return localStorage.getItem(localAvatarKey(u.id)) || ''; }catch(e){ return ''; }
}

/* ============================================================
   DISTRICTS & CHURCHES — loaded from DB, cached in memory,
   re-loaded automatically via realtime whenever an admin edits them.
   ============================================================ */
async function loadDistrictsChurches(){
  if(!supabase) return;
  const { data: districts, error: dErr } = await supabase.from('districts').select('*').order('name');
  const { data: churches, error: cErr } = await supabase.from('churches').select('*').order('name');
  if(dErr || cErr){ console.error(dErr||cErr); return; }
  const byId = {};
  DISTRICTS = {};
  (districts||[]).forEach(d=>{ byId[d.id]=d.name; DISTRICTS[d.name]=[]; });
  (churches||[]).forEach(c=>{
    const dname = byId[c.district_id]; if(!dname) return;
    DISTRICTS[dname].push(c.name);
  });
  Object.keys(DISTRICTS).forEach(d=> DISTRICTS[d].sort((a,b)=>a.localeCompare(b)));
  DISTRICT_NAMES = Object.keys(DISTRICTS).sort((a,b)=>a.localeCompare(b));
}

function startDistrictsRealtime(){
  if(!supabase || districtsChannel) return;
  districtsChannel = supabase.channel('districts-churches-changes')
    .on('postgres_changes', {event:'*', schema:'public', table:'districts'}, onDistrictsChanged)
    .on('postgres_changes', {event:'*', schema:'public', table:'churches'}, onDistrictsChanged)
    .subscribe();
}
let districtsRefreshTimer = null;
function onDistrictsChanged(){
  // Debounce — bulk edits can fire several events at once.
  clearTimeout(districtsRefreshTimer);
  districtsRefreshTimer = setTimeout(async ()=>{
    await loadDistrictsChurches();
    refreshAllDistrictUI();
  }, 300);
}
function refreshAllDistrictUI(){
  if(!currentUser) return;
  populateSelect(districtSelect, scopedDistrictNames(), '-- Select district --');
  populateSelect(exportDistrict, scopedDistrictNames(), '-- Select district --');
  const d = districtSelect.value;
  if(d) populateSelect(churchSelect, scopedChurches(d), '-- Select church --');
  renderProgress();
  if(!document.getElementById('tab-overview').classList.contains('hidden')) loadOverview();
  const _tp=document.getElementById('tab-profile');
  if(_tp && !_tp.classList.contains('hidden') && !document.getElementById('tab-admin').classList.contains('hidden')) loadProfileTab();
}

/* ============================================================
   AUTH / ROLE ARCHITECTURE
   ============================================================ */
const overlays = ['setupOverlay','loginOverlay','registerOverlay','forgotOverlay','resetOverlay','noticeOverlay'];
const AUTH_VIEWS = { setupOverlay:'view-setup', loginOverlay:'view-signin', registerOverlay:'view-register', forgotOverlay:'view-forgot', resetOverlay:'view-reset', noticeOverlay:'view-verification-notice' };
function showOverlay(id){
  document.querySelectorAll('.view').forEach(v=> v.classList.remove('active'));
  const el = document.getElementById(AUTH_VIEWS[id]||id); if(el) el.classList.add('active');
  refreshIcons();
}
function clearAuthErrors(){ document.querySelectorAll('.auth-error').forEach(e=>e.textContent=''); }
function showNotice(title, body, opts={}){
  document.getElementById('noticeTitle').textContent = title;
  document.getElementById('noticeBody').textContent = body;
  document.getElementById('noticeResendBtn').style.display = opts.resend ? 'block' : 'none';
  showOverlay('noticeOverlay');
}
function populateSelect(sel, items, placeholder){
  sel.innerHTML = '';
  const opt0 = document.createElement('option'); opt0.value=''; opt0.textContent = placeholder; sel.appendChild(opt0);
  items.forEach(v=>{ const o=document.createElement('option'); o.value=v; o.textContent=v; sel.appendChild(o); });
}

document.getElementById('gotoRegister').addEventListener('click', ()=>{ clearAuthErrors(); showOverlay('registerOverlay'); });
document.getElementById('gotoLoginFromRegister').addEventListener('click', ()=>{ clearAuthErrors(); showOverlay('loginOverlay'); });
document.getElementById('gotoForgot').addEventListener('click', ()=>{ clearAuthErrors(); showOverlay('forgotOverlay'); });
document.getElementById('gotoLoginFromForgot').addEventListener('click', ()=>{ clearAuthErrors(); showOverlay('loginOverlay'); });
document.getElementById('noticeLogoutBtn').addEventListener('click', async ()=>{ await supabase.auth.signOut(); showOverlay('loginOverlay'); });

async function isSystemInitialized(){
  if(!supabase) return true;
  try{
    const {data, error} = await supabase.from('system_config').select('initialized').eq('id', true).maybeSingle();
    if(error) throw error;
    return data ? !!data.initialized : false;
  }catch(e){ console.error(e); return true; }
}

async function fetchMyProfile(){
  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if(userErr){ console.error('getUser failed:', userErr); return { reason:'no_session', detail: userErr.message }; }
  if(!user) return { reason:'no_session', detail: null };
  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if(error){ console.error('profiles query failed:', error); return { reason:'query_error', detail: error.message, userId:user.id, email:user.email }; }
  if(!data) return { reason:'no_row', detail: null, userId:user.id, email:user.email };
  return { profile: { ...data, email_confirmed_at: user.email_confirmed_at } };
}

async function routeAfterAuth(){
  const result = await fetchMyProfile();
  if(!result.profile){
    let body = 'We could not load your account. Please contact your administrator.';
    if(result.reason === 'no_row'){
      body = 'Your login succeeded, but no account record exists for '+(result.email||'this email')+' yet. Share this with your administrator: user id '+result.userId+'.';
    } else if(result.reason === 'query_error'){
      body = 'Your login succeeded, but we could not read your account record: "'+result.detail+'". Share this exact message with your administrator.';
    }
    console.error('routeAfterAuth failure:', result);
    showNotice('Account Error', body);
    return;
  }
  const profile = result.profile;

  if(profile.status === 'suspended'){
    showNotice('Account Suspended', 'Your account has been suspended by an administrator. Contact your Super Admin or Admin for assistance.');
    return;
  }
  if(profile.status === 'deactivated'){
    showNotice('Account Deactivated', 'Your account has been deactivated. Contact your Super Admin for assistance.');
    return;
  }
  if(profile.status === 'pending_approval'){
    showNotice('Pending Approval', 'Your registration was received. An administrator still needs to approve your account and assign your district(s) before you can sign in. Please check back later.', {resend: !profile.email_confirmed_at});
    return;
  }
  if(!profile.email_confirmed_at && profile.role !== 'super_admin'){
    showNotice('Verify Your Email', 'Please verify your email address using the link we sent you, then sign in again.', {resend:true});
    return;
  }
  await enterApp(profile);
}

async function bootstrap(){
  const banner = document.getElementById('configBanner');
  if(!SUPABASE_CONFIGURED || !supabase){
    document.querySelectorAll('.view').forEach(v=> v.classList.remove('active'));
    banner.style.display='flex';
    const _bt=document.getElementById('configBannerText'); if(_bt) _bt.textContent='Backend not configured — this application cannot function without Supabase configured. Contact the system owner.';
    return;
  }
  supabase.auth.onAuthStateChange((event, session)=>{
    if(event === 'PASSWORD_RECOVERY'){ showOverlay('resetOverlay'); }
  });

  const initialized = await isSystemInitialized();
  if(!initialized){ showOverlay('setupOverlay'); return; }

  const { data: { session } } = await supabase.auth.getSession();
  if(session){ await routeAfterAuth(); }
  else { showOverlay('loginOverlay'); }
}

/* ---------------- SETUP ---------------- */
document.getElementById('setupBtn').addEventListener('click', async ()=>{
  const name = document.getElementById('setupName').value.trim();
  const email = document.getElementById('setupEmail').value.trim();
  const pw = document.getElementById('setupPassword').value;
  const pw2 = document.getElementById('setupConfirm').value;
  const errEl = document.getElementById('setupError');
  errEl.textContent='';
  if(!name || !email || !pw){ errEl.textContent='All fields are required.'; return; }
  if(pw.length < 10){ errEl.textContent='Password must be at least 10 characters.'; return; }
  if(pw !== pw2){ errEl.textContent='Passwords do not match.'; return; }
  const btn = document.getElementById('setupBtn'); btn.disabled=true; btn.textContent='Creating…';
  const { error } = await supabase.auth.signUp({ email, password: pw, options: { data: { full_name: name } } });
  btn.disabled=false; btn.textContent='Create Super Admin & Initialize System';
  if(error){ errEl.textContent = error.message; return; }
  showNotice('System Initialized Successfully', 'The Super Admin account has been created. Please verify your email if prompted, then sign in.');
});

/* ---------------- REGISTER (name, email, phone, password only) ---------------- */
document.getElementById('registerBtn').addEventListener('click', async ()=>{
  const name = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const phone = document.getElementById('regPhone').value.trim();
  const pw = document.getElementById('regPassword').value;
  const pw2 = document.getElementById('regConfirm').value;
  const terms = document.getElementById('regTerms').checked;
  const errEl = document.getElementById('registerError'); errEl.textContent='';
  if(!name || !email || !pw){ errEl.textContent='Name, email and password are required.'; return; }
  if(pw.length < 8){ errEl.textContent='Password must be at least 8 characters.'; return; }
  if(pw !== pw2){ errEl.textContent='Passwords do not match.'; return; }
  if(!terms){ errEl.textContent='Please agree to the terms to continue.'; return; }
  const btn = document.getElementById('registerBtn'); btn.disabled=true; btn.textContent='Creating…';
  const { error } = await supabase.auth.signUp({
    email, password: pw, options: { data: { full_name: name, phone } }
  });
  btn.disabled=false; btn.textContent='Create Account';
  if(error){ errEl.textContent = error.message; return; }
  await supabase.auth.signOut();
  showNotice('Check Your Email', 'We sent a verification link to '+email+'. After verifying, an administrator must approve your account and assign your district(s) before you can sign in.');
});

/* ---------------- LOGIN ---------------- */
document.getElementById('loginPassword').addEventListener('keydown', ev=>{ if(ev.key==='Enter') document.getElementById('loginBtn').click(); });
document.getElementById('loginBtn').addEventListener('click', async ()=>{
  const email = document.getElementById('loginEmail').value.trim();
  const pw = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError'); errEl.textContent='';
  if(!email || !pw){ errEl.textContent='Please enter your email and password.'; return; }
  const btn = document.getElementById('loginBtn'); btn.disabled=true; btn.textContent='Checking…';
  const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
  btn.disabled=false; btn.textContent='Sign In';
  if(error){ errEl.textContent = 'Incorrect email or password.'; return; }
  try{ await supabase.rpc('record_login'); }catch(e){}
  await routeAfterAuth();
});

document.getElementById('resendVerifyBtn')?.addEventListener('click', resendVerification);
document.getElementById('noticeResendBtn').addEventListener('click', resendVerification);
async function resendVerification(){
  const { data: { user } } = await supabase.auth.getUser();
  const email = user ? user.email : document.getElementById('loginEmail').value.trim();
  if(!email) return;
  await supabase.auth.resend({ type: 'signup', email });
  await appAlert('Verification email sent to '+email+'.', 'Email sent');
}

/* ---------------- FORGOT / RESET PASSWORD ---------------- */
document.getElementById('forgotBtn').addEventListener('click', async ()=>{
  const email = document.getElementById('forgotEmail').value.trim();
  const statusEl = document.getElementById('forgotStatus');
  if(!email){ setStatus(statusEl,'Please enter your email.', true); return; }
  setStatus(statusEl,'Sending…', false);
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: appRedirectUrl() });
  setStatus(statusEl,'If that email is registered, a reset link has been sent.', false);
});
document.getElementById('resetBtn').addEventListener('click', async ()=>{
  const pw = document.getElementById('resetPassword').value;
  const pw2 = document.getElementById('resetConfirm').value;
  const errEl = document.getElementById('resetError'); errEl.textContent='';
  if(pw.length < 8){ errEl.textContent='Password must be at least 8 characters.'; return; }
  if(pw !== pw2){ errEl.textContent='Passwords do not match.'; return; }
  const btn = document.getElementById('resetBtn'); btn.disabled=true; btn.textContent='Saving…';
  const { error } = await supabase.auth.updateUser({ password: pw });
  btn.disabled=false; btn.textContent='Set New Password';
  if(error){ errEl.textContent = error.message; return; }
  showNotice('Password Reset', 'Your password has been successfully reset. Please sign in.');
});

/* ============================================================
   PRESENCE — who is currently online (Supabase Realtime Presence,
   no extra table needed). Every signed-in client tracks itself on a
   shared channel; admins/superadmins see a live online/offline dot.
   ============================================================ */
function startPresence(profile){
  if(!supabase || presenceChannel) return;
  presenceChannel = supabase.channel('online-users', { config: { presence: { key: profile.id } } });
  presenceChannel
    .on('presence', {event:'sync'}, ()=>{
      const st = presenceChannel.presenceState();
      onlineUserIds = new Set(Object.keys(st));
      if(usersCache.length) renderUsers(usersCache);
      refreshOpenProfilePresence();
    })
    .subscribe(async (status)=>{
      if(status === 'SUBSCRIBED'){
        await presenceChannel.track({ full_name: profile.full_name, role: profile.role, online_at: new Date().toISOString() });
      }
    });
}
function stopPresence(){
  if(presenceChannel){ presenceChannel.untrack(); supabase.removeChannel(presenceChannel); presenceChannel=null; }
  onlineUserIds = new Set();
}
function refreshOpenProfilePresence(){
  const overlay = document.getElementById('userProfileOverlay');
  if(!overlay.classList.contains('show')) return;
  const userId = overlay.dataset.userId; if(!userId) return;
  const online = onlineUserIds.has(userId);
  document.getElementById('upPresenceDot').className = 'presence-dot'+(online?' online':'');
  document.getElementById('upPresenceLabel').textContent = online ? 'Online now' : 'Offline';
}

/* ============================================================
   IDLE TIMEOUT — sign out after 8 hours with no interaction at all
   (deliberately long: short timeouts interrupt legitimate slow data
   entry, so we only guard against a device being left signed in).
   ============================================================ */
function resetIdleTimer(){
  if(!currentUser) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async ()=>{
    await fullSignOut();
    showNotice('Signed Out', 'You were signed out after 8 hours of inactivity. Please sign in again.');
    showOverlay('loginOverlay');
  }, IDLE_LIMIT_MS);
}
function startIdleWatch(){
  ['mousemove','mousedown','keydown','touchstart','scroll'].forEach(evt=>{
    window.addEventListener(evt, resetIdleTimer, {passive:true});
  });
  resetIdleTimer();
}
function stopIdleTimer(){ clearTimeout(idleTimer); idleTimer=null; }
startIdleWatch();

/* ---------------- LOGOUT ---------------- */
async function fullSignOut(){
  stopEntriesListener(); stopProfileListener(); stopPresence(); stopIdleTimer();
  await supabase.auth.signOut();
  currentUser = null;
}
document.getElementById('logoutBtn').addEventListener('click', async ()=>{ await fullSignOut(); showOverlay('loginOverlay'); });
document.getElementById('syncNowBtn').addEventListener('click', async ()=>{
  const line = document.getElementById('syncStatusLine'); line.textContent='Refreshing…';
  await fsGetAllEntriesOnce(); renderProgress();
  line.textContent = 'Refreshed ' + new Date().toLocaleTimeString();
});

/* ============================================================
   FORCE LOGOUT on suspend/deactivate/role-change (realtime)
   ============================================================ */
function startProfileListener(userId){
  if(!supabase || profileChannel) return;
  profileChannel = supabase.channel('own-profile-changes')
    .on('postgres_changes', {event:'UPDATE', schema:'public', table:'profiles', filter:'id=eq.'+userId}, async (payload)=>{
      const row = payload.new;
      if(row.status === 'suspended' || row.status === 'deactivated'){
        await fullSignOut();
        showNotice(row.status === 'suspended' ? 'Account Suspended' : 'Account Deactivated',
          'An administrator changed your account status. You have been signed out.');
        return;
      }
      if(currentUser && row.role !== currentUser.role){
        await fullSignOut();
        showNotice('Access Changed', 'Your account access level has changed. Please sign in again.');
        return;
      }
    })
    .subscribe();
}
function stopProfileListener(){ if(profileChannel){ supabase.removeChannel(profileChannel); profileChannel=null; } }

/* ============================================================
   MAIN APP
   ============================================================ */
const NAV_BY_ROLE = {
  audit_user: ['overview','entry','progress','export','admin'],
  admin: ['overview','entry','progress','export','admin'],
  super_admin: ['overview','entry','progress','export','admin'],
};
const SUBTABS_BY_ROLE = {
  audit_user: ['profile'],
  admin: ['users','editlog','audit','settings','profile'],
  super_admin: ['users','editlog','audit','support','settings','profile'],
};
let ADMIN_SUBTABS = ['profile'];
const NAV_TITLES = { 'tab-overview':'Overview', 'tab-entry':'Data Entry', 'tab-progress':'Progress', 'tab-export':'Export', 'tab-admin':'Administration' };
const SUBTAB_TITLES = { users:'Users', editlog:'Activity Log', audit:'Audit Trail', support:'Support Access', settings:'System Overview', profile:'My Profile' };
function subtabPanelId(sub){ return sub==='profile' ? 'tab-profile' : 'subtab-'+sub; }
function buildTabs(role){
  const navs = NAV_BY_ROLE[role] || NAV_BY_ROLE.audit_user;
  ADMIN_SUBTABS = (SUBTABS_BY_ROLE[role] || SUBTABS_BY_ROLE.audit_user).slice();
  document.querySelectorAll('#mainTabs .nav-link').forEach(l=> l.classList.toggle('hidden', !navs.includes(l.dataset.tab)));
  document.querySelectorAll('.admin-tab').forEach(b=> b.classList.toggle('hidden', !ADMIN_SUBTABS.includes(b.dataset.subtab)));
  activateTab(role==='audit_user' ? 'tab-entry' : (navs.includes('overview') ? 'tab-overview' : 'tab-entry'));
}
function activateTab(id){
  const panel = document.getElementById(id); if(!panel) return;
  document.querySelectorAll('#mainTabs .nav-link').forEach(b=> b.classList.toggle('active', 'tab-'+b.dataset.tab===id));
  document.querySelectorAll('.tab-content').forEach(p=>{ p.classList.add('hidden'); p.classList.remove('fade-in'); });
  panel.classList.remove('hidden'); void panel.offsetWidth; panel.classList.add('fade-in');
  if(id==='tab-overview') loadOverview();
  if(id==='tab-progress') renderProgress();
  if(id==='tab-export') renderRecentExports();
  if(id==='tab-admin'){ const last = panel.dataset.subtabSel && ADMIN_SUBTABS.includes(panel.dataset.subtabSel) ? panel.dataset.subtabSel : ADMIN_SUBTABS[0]; activateAdminSubtab(last); }
  const _pt=document.getElementById('page-title'); if(_pt) _pt.textContent = NAV_TITLES[id]||'Starsys';
  refreshIcons();
  var _sb=document.getElementById('sidebar'); if(_sb&&window.innerWidth<=768){ _sb.classList.remove('open'); var _bd=document.getElementById('sidebarBackdrop'); if(_bd) _bd.classList.remove('open'); }
}
function activateAdminSubtab(sub){
  if(!ADMIN_SUBTABS.includes(sub)) sub = ADMIN_SUBTABS[0];
  document.getElementById('tab-admin').dataset.subtabSel = sub;
  document.querySelectorAll('.admin-tab').forEach(b=>{
    const on = b.dataset.subtab===sub;
    b.classList.toggle('border-ink-900', on); b.classList.toggle('dark:border-gold-500', on);
    b.classList.toggle('text-ink-900', on); b.classList.toggle('dark:text-gold-400', on);
    b.classList.toggle('font-medium', on);
    b.classList.toggle('border-transparent', !on); b.classList.toggle('text-ink-500', !on); b.classList.toggle('dark:text-ink-400', !on);
    b.classList.toggle('active', on);
  });
  document.querySelectorAll('.admin-subtab').forEach(p=>{ p.classList.add('hidden'); p.classList.remove('fade-in'); });
  const panel = document.getElementById(subtabPanelId(sub));
  if(panel){ panel.classList.remove('hidden'); void panel.offsetWidth; panel.classList.add('fade-in'); }
  if(sub==='users') loadUsers();
  if(sub==='editlog') loadFinancialAudit();
  if(sub==='audit') loadAuditLog();
  if(sub==='support') loadSupportAccess();
  if(sub==='settings'){ renderDistrictChurchList(); renderOfferingsSummary(); }
  if(sub==='profile') loadProfileTab();
  const _pt2=document.getElementById('page-title'); if(_pt2) _pt2.textContent = SUBTAB_TITLES[sub]||'Administration';
  refreshIcons();
}
document.querySelectorAll('#mainTabs .nav-link').forEach(b=> b.addEventListener('click', ()=> activateTab('tab-'+b.dataset.tab)));
document.querySelectorAll('.admin-tab').forEach(b=> b.addEventListener('click', ()=> activateAdminSubtab(b.dataset.subtab)));
document.querySelectorAll('[data-goto-tab]').forEach(b=> b.addEventListener('click', ()=> activateTab(b.dataset.gotoTab)));
const _heroEntry=document.getElementById('heroEntryBtn'); if(_heroEntry) _heroEntry.addEventListener('click', ()=> activateTab('tab-entry'));
const _heroExport=document.getElementById('heroExportBtn'); if(_heroExport) _heroExport.addEventListener('click', ()=> activateTab('tab-export'));

async function loadMyScope(profile){
  myScope = [];
  if(profile.role === 'super_admin'){ myScope = 'all'; return; }
  if(profile.role === 'admin'){
    const { data } = await supabase.from('admin_scope').select('*').eq('admin_id', profile.id);
    if((data||[]).some(s=>s.system_wide)){ myScope = 'all'; return; }
    myScope = (data||[]).map(s=>s.district);
    return;
  }
  const { data } = await supabase.from('user_district_access').select('district').eq('user_id', profile.id);
  myScope = (data||[]).map(r=>r.district);
}
function scopedDistrictNames(){
  if(myScope === 'all') return DISTRICT_NAMES;
  const set = new Set(myScope);
  return DISTRICT_NAMES.filter(d=>set.has(d));
}
function scopedChurches(district){ return DISTRICTS[district] || []; }

async function enterApp(profile){
  currentUser = profile;
  await loadDistrictsChurches();
  if(await loadOfferingTypes()){ buildAmountsGrid(); }
  await loadMyScope(profile);
  document.querySelectorAll('.view').forEach(v=> v.classList.remove('active'));
  document.getElementById('view-dashboard').classList.add('active');
  refreshIcons();
  document.getElementById('chipName').textContent = profile.full_name;
  renderOwnAvatars();
  document.getElementById('chipEmail').textContent = roleLabel(profile.role)+(profile.email ? ' · '+profile.email : '');
  document.getElementById('unverifiedBanner').style.display = profile.email_confirmed_at ? 'none' : 'flex';
  document.getElementById('usersHeading').textContent = profile.role==='super_admin' ? 'User Management' : 'Users in Your Scope';

  buildTabs(profile.role);
  populateSelect(districtSelect, scopedDistrictNames(), '-- Select district --');
  populateSelect(exportDistrict, scopedDistrictNames(), '-- Select district --');
  document.getElementById('scopeNote').textContent = myScope==='all'
    ? 'You have access to all districts and their churches.'
    : 'You can only enter data for the district(s) assigned to your account (all churches within them).';

  startEntriesListener();
  startProfileListener(profile.id);
  startDistrictsRealtime();
  startOfferingsRealtime();
  startPresence(profile);
  resetIdleTimer();
  renderOfferingsSummary();
  fsGetAllEntriesOnce().then(()=>{ renderProgress(); refreshNotifications(false); });
  renderProgress();
}

function roleLabel(r){ return r==='super_admin'?'Super Admin' : r==='admin'?'Admin' : 'Audit User'; }
function setStatus(el,msg,isErr){ el.textContent=msg; el.classList.toggle('err', !!isErr); }

/* ---------------- district/church cascading selects (entry form) ---------------- */
const districtSelect = document.getElementById('districtSelect');
const churchSelect = document.getElementById('churchSelect');
const monthSelect = document.getElementById('monthSelect');
const yearSelect = document.getElementById('yearSelect');
const serialSelect = document.getElementById('serialSelect');
const exportDistrict = document.getElementById('exportDistrict');
const exportYear = document.getElementById('exportYear');
const rangeFrom = document.getElementById('rangeFrom');
const rangeTo = document.getElementById('rangeTo');
populateSelect(monthSelect, MONTHS, '-- Select month --');
populateSelect(rangeFrom, MONTHS, '');
populateSelect(rangeTo, MONTHS, '');
rangeFrom.value = 'January'; rangeTo.value = MONTHS[new Date().getMonth()];
rangeFrom.querySelector('option[value=""]')?.remove();
rangeTo.querySelector('option[value=""]')?.remove();

// Year options run from the app's fixed start year through the real current year, re-derived
// from the system clock on every load — never a hardcoded ceiling, never a cached one. Next
// year is never pre-listed; it only appears once someone explicitly opts in via "+ Next year".
function yearCeiling(){ return new Date().getFullYear(); }
function yearOptionsFor(selectEl){
  const opts = [];
  for(let y=FIRST_YEAR; y<=yearCeiling(); y++) opts.push(y);
  extraYears.forEach(y=>{ if(!opts.includes(y)) opts.push(y); });
  return opts.sort((a,b)=>a-b);
}
function populateYearSelect(selectEl, preserveValue){
  const prev = preserveValue ? selectEl.value : String(yearCeiling());
  selectEl.innerHTML = '';
  yearOptionsFor(selectEl).forEach(y=>{
    const opt = document.createElement('option'); opt.value = String(y); opt.textContent = String(y);
    selectEl.appendChild(opt);
  });
  selectEl.value = yearOptionsFor(selectEl).includes(Number(prev)) ? prev : String(yearCeiling());
}
function addNextYearTo(selectEl){
  const highest = extraYears.length ? Math.max(yearCeiling(), ...extraYears) : yearCeiling();
  const candidate = highest + 1;
  if(!extraYears.includes(candidate)) extraYears.push(candidate);
  populateYearSelect(yearSelect, true);
  populateYearSelect(exportYear, true);
  populateYearSelect(progYearSelect, true);
  selectEl.value = String(candidate);
}
populateYearSelect(yearSelect, false);
populateYearSelect(exportYear, false);
const progYearSelect = document.getElementById('progYear');
const progMonthSelect = document.getElementById('progMonth');
populateYearSelect(progYearSelect, false);
populateSelect(progMonthSelect, MONTHS, '');
progMonthSelect.querySelector('option[value=""]')?.remove();
progMonthSelect.value = MONTHS[new Date().getMonth()];
progYearSelect.addEventListener('change', ()=> renderProgressTab());
progMonthSelect.addEventListener('change', ()=> renderProgressTab());
document.getElementById('addNextYearEntryBtn').addEventListener('click', ()=> addNextYearTo(yearSelect));
document.getElementById('addNextYearExportBtn')?.addEventListener('click', ()=> addNextYearTo(exportYear));

// district/church/month/year selects auto-load the saved figures for the newly chosen combo,
// guarding against unsaved edits (see guardedSelectionChange below) instead of requiring a
// manual "Load" click.
districtSelect.addEventListener('change', async ()=>{
  const newVal = districtSelect.value;
  districtSelect.value = lastSelection.d; // snap back immediately — no visible moment with the wrong data under the new label
  await guardedSelectionChange(()=>{
    districtSelect.value = newVal;
    if(!newVal){ churchSelect.disabled=true; populateSelect(churchSelect, [], '-- Select church --'); }
    else { churchSelect.disabled=false; populateSelect(churchSelect, scopedChurches(newVal), '-- Select church --'); }
  });
});
churchSelect.addEventListener('change', async ()=>{
  const newVal = churchSelect.value;
  churchSelect.value = lastSelection.c;
  await guardedSelectionChange(()=>{ churchSelect.value = newVal; });
});
monthSelect.addEventListener('change', async ()=>{
  const newVal = monthSelect.value;
  monthSelect.value = lastSelection.m;
  await guardedSelectionChange(()=>{ monthSelect.value = newVal; });
});
yearSelect.addEventListener('change', async ()=>{
  const newVal = yearSelect.value;
  yearSelect.value = lastSelection.y;
  await guardedSelectionChange(()=>{ yearSelect.value = newVal; });
});

/* ---------------- amounts grid ---------------- */
const amountsGrid = document.getElementById('amountsGrid');
const fieldBaseline = {}; // offering key -> last known SAVED value (null if nothing saved yet for this field)
function buildAmountsGrid(){
  amountsGrid.innerHTML = '';
  Object.keys(fieldBaseline).forEach(k=> delete fieldBaseline[k]);
  OFFERINGS.forEach(o=>{
    fieldBaseline[o.key] = null;
    const div = document.createElement('div');
    div.innerHTML = '<label class="block text-[0.6875rem] font-medium text-ink-700 dark:text-ink-300 mb-2 uppercase tracking-wider">'+esc(o.label)+'</label><input type="text" inputmode="numeric" class="amt input-field w-full px-4 py-2.5 rounded-sm text-sm text-right mono dark:text-paper" id="f_'+o.key+'" placeholder="0">';
    amountsGrid.appendChild(div);
    const inp = div.querySelector('input.amt');
    inp.addEventListener('blur', async ()=>{
      const oldVal = fieldBaseline[o.key];
      const newVal = readAmountField(inp.id);
      if(oldVal!==null && newVal!==oldVal){
        const oldStr = formatWithCommas(String(oldVal));
        const newStr = newVal===null ? '0' : formatWithCommas(String(newVal));
        const proceed = await showConfirm(
          o.label+' was previously entered as UGX '+oldStr+'. Change it to UGX '+newStr+'?',
          'Confirm change — '+o.label
        );
        if(!proceed){ setAmountField(inp.id, oldVal); updateEntryTotal(); }
        else { fieldBaseline[o.key] = newVal; }
      }
    });
  });
  attachAmtHandlers();
  updateEntryTotal();
}
function digitsOnly(str){ return String(str).replace(/[^\d]/g,''); }
function formatWithCommas(digitStr){ if(digitStr==='') return ''; return Number(digitStr).toLocaleString('en-US'); }
function updateEntryTotal(){
  let total = 0;
  OFFERINGS.forEach(o=>{ const v = readAmountField('f_'+o.key); if(v) total += v; });
  const el = document.getElementById('entryTotalValue');
  if(el) el.textContent = formatWithCommas(String(total))+' UGX';
  const badge = document.getElementById('savedBadge');
  if(badge) badge.textContent = '';
}
function focusNextAmt(container, current){
  const inputs = Array.from(container.querySelectorAll('input.amt:not([disabled])'));
  const next = inputs[inputs.indexOf(current)+1];
  if(next){ next.focus(); next.select(); } else { current.blur(); }
}
function attachAmtHandlers(){
  document.querySelectorAll('input.amt').forEach(inp=>{
    inp.addEventListener('input', ()=>{ inp.value = formatWithCommas(digitsOnly(inp.value)); updateEntryTotal(); });
    inp.addEventListener('keypress', ev=>{ if(!/[0-9]/.test(ev.key)) ev.preventDefault(); });
    inp.addEventListener('keydown', ev=>{ if(ev.key==='Enter'){ ev.preventDefault(); focusNextAmt(amountsGrid, inp); } });
    inp.addEventListener('paste', ev=>{ ev.preventDefault(); const text=(ev.clipboardData||window.clipboardData).getData('text'); inp.value=formatWithCommas(digitsOnly(text)); updateEntryTotal(); });
  });
}
buildAmountsGrid();
function readAmountField(id){ const el=document.getElementById(id); if(!el) return null; const v=digitsOnly(el.value); return v===''?null:Number(v); }
function setAmountField(id, val){ const el=document.getElementById(id); if(!el) return; el.value = (val===null||val===undefined||val==='')?'':formatWithCommas(String(Math.round(Number(val)))); }
function fillFormFrom(entry){ OFFERINGS.forEach(o=> setAmountField('f_'+o.key, entry? entry[o.key]: null)); updateEntryTotal(); }
function clearForm(){ OFFERINGS.forEach(o=>{ const el=document.getElementById('f_'+o.key); if(el) el.value=''; }); serialSelect.value=''; updateEntryTotal(); }
function readForm(){ const e={}; OFFERINGS.forEach(o=>{ e[o.key]=readAmountField('f_'+o.key); }); return e; }

/* ---------------- row <-> entry mapping ---------------- */
function rowToEntry(row){
  if(!row) return null;
  // district/church/month/year are carried on the entry object itself (not just used as the
  // state[] lookup key) so export bucket-building can iterate all loaded entries directly.
  const e = { district: row.district, church: row.church, month: row.month, year: row.year,
    serialNo: row.serialno, editedBy: row.editedby, editedAt: row.editedat, device: row.device,
    lateFields: row.late_fields || {} };
  const amounts = row.amounts || {};
  OFFERINGS.forEach(o=>{ e[o.key] = amounts[o.key] === undefined ? null : amounts[o.key]; });
  return e;
}
function entryToRow(district,church,month,year,entry){
  const amounts = {};
  OFFERINGS.forEach(o=>{ amounts[o.key] = entry[o.key]; });
  return { id: docId(district,church,month,year), district, church, month, year, serialno: entry.serialNo,
    amounts, editedby: entry.editedBy, editedat: entry.editedAt, device: entry.device,
    late_fields: entry.lateFields || {} };
}

/* ---------------- Supabase data helpers ---------------- */
async function fsSetEntry(district,church,month,year,entry){
  if(!supabase) return false;
  try{ const {error} = await supabase.from('entries').upsert(entryToRow(district,church,month,year,entry)); if(error) throw error; return true; }
  catch(e){ console.error(e); return false; }
}
async function fsGetAllEntriesOnce(){
  if(!supabase) return;
  try{ const {data,error} = await supabase.from('entries').select('*'); if(error) throw error;
    (data||[]).forEach(row=>{ state[keyFor(row.district,row.church,row.month,row.year)] = rowToEntry(row); });
  }catch(e){ console.error(e); }
}
function startEntriesListener(){
  if(!supabase) return;
  entriesChannel = supabase.channel('entries-changes')
    .on('postgres_changes', {event:'*', schema:'public', table:'entries'}, (payload)=>{
      const row = payload.eventType==='DELETE' ? payload.old : payload.new;
      state[keyFor(row.district,row.church,row.month,row.year)] = payload.eventType==='DELETE' ? {} : rowToEntry(row);
      renderProgress();
      const line = document.getElementById('syncStatusLine');
      if(line) line.textContent = 'Live : last update ' + new Date().toLocaleTimeString();
    })
    .subscribe((status)=>{
      const line = document.getElementById('syncStatusLine'); if(!line) return;
      if(status==='SUBSCRIBED') line.textContent = 'Live : last update ' + new Date().toLocaleTimeString();
      else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT') line.textContent = 'Connection interrupted — trying to reconnect…';
    });
}
function stopEntriesListener(){ if(entriesChannel){ supabase.removeChannel(entriesChannel); entriesChannel=null; } }
async function fsAddAudit(rec){
  if(!supabase) return false;
  try{ const {error} = await supabase.from('audit').insert(rec); if(error) throw error; return true; }
  catch(e){ console.error(e); return false; }
}
async function fsGetAllAudit(){
  if(!supabase) return [];
  try{ const {data,error} = await supabase.from('audit').select('*').order('ts',{ascending:true}); if(error) throw error; return data||[]; }
  catch(e){ console.error(e); return []; }
}

let lastSelection = {d:'', c:'', m:'', y:''}; // the district/church/month/year combo currently loaded into the form

function syncFormToSelection(){
  const statusEl = document.getElementById('statusLine');
  const d=districtSelect.value, c=churchSelect.value, m=monthSelect.value, y=yearSelect.value;
  if(d && c && m && y){
    const entry = state[keyFor(d,c,m,y)];
    fillFormFrom(entry);
    serialSelect.value = (entry && entry.serialNo) ? String(entry.serialNo) : '';
    OFFERINGS.forEach(o=>{
      fieldBaseline[o.key] = (entry && entry[o.key]!==null && entry[o.key]!==undefined && entry[o.key]!=='') ? Number(entry[o.key]) : null;
    });
    setStatus(statusEl, entry ? ('Loaded '+c+' / '+m+' '+y+'.') : (c+' / '+m+' '+y+' has no figures yet — ready to fill in.'), false);
  } else {
    clearForm();
    OFFERINGS.forEach(o=>{ fieldBaseline[o.key] = null; });
    setStatus(statusEl, '', false);
  }
  lastSelection = {d, c, m, y};
  updateCatchUpButtonState();
  renderProgress();
}

function formIsDirty(){
  return OFFERINGS.some(o=> readAmountField('f_'+o.key) !== fieldBaseline[o.key]);
}

async function saveEntryForCombo(d,c,m,y){
  const key = keyFor(d,c,m,y);
  const entry = readForm();
  entry.serialNo = serialSelect.value.trim() || null;
  entry.editedBy = currentUser.full_name; entry.editedAt = new Date().toISOString(); entry.device = await deviceDescriptor();
  // An ordinary save (typo fixes, on-time entry) must never set or clear a late tag itself —
  // carry forward whatever lateFields the row already had, untouched.
  entry.lateFields = (state[key] && state[key].lateFields) ? state[key].lateFields : {};
  const ok = await fsSetEntry(d,c,m,y,entry);
  state[key] = Object.assign({district:d, church:c, month:m, year:Number(y)}, entry);
  const auditRec = { ts: entry.editedAt, name: currentUser.full_name, role: currentUser.role, district:d, church:c, month:m, year:Number(y), device: entry.device, total: entryTotal(entry), status: entryStatus(entry) };
  auditLog.push(auditRec); await fsAddAudit(auditRec);
  OFFERINGS.forEach(o=>{ fieldBaseline[o.key] = (entry[o.key]!==null && entry[o.key]!==undefined && entry[o.key]!=='') ? Number(entry[o.key]) : null; });
  renderProgress();
  return ok;
}

// Called by each select's 'change' listener, which has already snapped the select's
// displayed value back to the old selection before calling this. If there are unsaved
// edits, ask the user to save or discard; only then is the new value actually applied —
// so a not-yet-saved figure can never end up attributed to the wrong month/church/district.
async function guardedSelectionChange(applyNewValue){
  const hadFullSelection = !!(lastSelection.d && lastSelection.c && lastSelection.m && lastSelection.y);
  if(hadFullSelection && formIsDirty()){
    const choice = await showChoice(
      'You have unsaved changes for '+lastSelection.c+' / '+lastSelection.m+' '+lastSelection.y+'. Save them before switching, or discard them?',
      'Unsaved changes',
      [
        {label:'Cancel', value:'cancel', cls:'btn-ghost'},
        {label:'Discard changes', value:'discard', cls:'btn-ghost'},
        {label:'Save changes', value:'save', cls:'btn-primary'}
      ]
    );
    if(choice==='cancel'){ return; } // selects are already showing the old value — nothing more to do
    if(choice==='save'){ await saveEntryForCombo(lastSelection.d, lastSelection.c, lastSelection.m, lastSelection.y); }
  }
  applyNewValue();
  syncFormToSelection();
}

/* ---------------- App dialog: alert / confirm / prompt rendered as an in-app popup ---------------- */
function appDialog(opts){
  return new Promise(resolve=>{
    const ov = document.getElementById('appDialogOverlay');
    const okBtn = document.getElementById('appDialogOk'), cancelBtn = document.getElementById('appDialogCancel');
    const inputWrap = document.getElementById('appDialogInputWrap'), input = document.getElementById('appDialogInput');
    const errEl = document.getElementById('appDialogError');
    document.getElementById('appDialogTitle').textContent = opts.title || 'Confirm';
    document.getElementById('appDialogMessage').textContent = opts.message || '';
    okBtn.textContent = opts.confirmLabel || 'OK';
    cancelBtn.textContent = opts.cancelLabel || 'Cancel';
    cancelBtn.style.display = opts.hideCancel ? 'none' : '';
    okBtn.className = (opts.danger ? 'btn-danger' : 'btn-primary')+' px-4 py-2 rounded-sm text-xs font-semibold uppercase tracking-wider';
    const hasInput = !!opts.input;
    inputWrap.style.display = hasInput ? 'block' : 'none';
    errEl.textContent = '';
    if(hasInput){ input.value = opts.input.value || ''; input.placeholder = opts.input.placeholder || ''; }
    ov.style.display = 'block';
    refreshIcons();
    setTimeout(()=>{ if(hasInput){ input.focus(); input.select(); } else okBtn.focus(); }, 30);
    function finish(result){
      ov.style.display = 'none';
      okBtn.removeEventListener('click', onOk); cancelBtn.removeEventListener('click', onCancel);
      document.getElementById('appDialogBackdrop').removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKey, true);
      resolve(result);
    }
    function onOk(){
      if(hasInput){
        const v = input.value.trim();
        if(!v){ errEl.textContent = 'Please enter a value.'; input.focus(); return; }
        finish(v);
      } else finish(true);
    }
    function onCancel(){ finish(hasInput ? null : (opts.hideCancel ? true : false)); }
    function onKey(e){
      if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); onCancel(); }
      else if(e.key==='Enter' && (hasInput ? e.target===input : true)){ e.preventDefault(); e.stopPropagation(); onOk(); }
    }
    okBtn.addEventListener('click', onOk); cancelBtn.addEventListener('click', onCancel);
    document.getElementById('appDialogBackdrop').addEventListener('click', onCancel);
    document.addEventListener('keydown', onKey, true);
  });
}
function appAlert(message, title){ return appDialog({ title:title||'Notice', message, confirmLabel:'OK', hideCancel:true }); }
function appConfirm(message, o){ o=o||{}; return appDialog({ title:o.title||'Confirm', message, confirmLabel:o.confirmLabel||'Confirm', danger:!!o.danger }); }
function appPrompt(message, o){ o=o||{}; return appDialog({ title:o.title||'Enter a value', message, confirmLabel:o.confirmLabel||'Save', input:{ value:o.value||'', placeholder:o.placeholder||'' } }); }

/* ---------------- Confirmation popup (promise-based, supports 2 or 3 choices) ---------------- */
function showChoice(message, title, choices){
  return new Promise(resolve=>{
    const overlay = document.getElementById('confirmOverlay');
    document.getElementById('confirmTitle').textContent = title || 'Confirm';
    document.getElementById('confirmMessage').textContent = message;
    const container = document.getElementById('confirmButtons');
    container.innerHTML = '';
    const handlers = [];
    choices.forEach(choice=>{
      const btn = document.createElement('button');
      btn.className = (choice.cls || 'btn-ghost')+' rounded-sm text-xs font-semibold uppercase tracking-wider';
      btn.textContent = choice.label;
      const onClick = ()=> cleanup(choice.value);
      btn.addEventListener('click', onClick);
      handlers.push({btn, onClick});
      container.appendChild(btn);
    });
    overlay.style.display = 'flex';
    function cleanup(result){
      overlay.style.display = 'none';
      handlers.forEach(h=> h.btn.removeEventListener('click', h.onClick));
      resolve(result);
    }
  });
}
function showConfirm(message, title){
  return showChoice(message, title, [
    {label:'Cancel', value:false, cls:'btn-ghost'},
    {label:'Yes, update it', value:true, cls:'btn-primary'}
  ]);
}

document.getElementById('clearFormBtn').addEventListener('click', ()=>{ clearForm(); setStatus(document.getElementById('statusLine'),'',false); });

document.getElementById('doneBtn').addEventListener('click', async ()=>{
  const statusEl = document.getElementById('statusLine');
  const d=districtSelect.value, c=churchSelect.value, m=monthSelect.value, y=yearSelect.value;
  if(!d||!c||!m||!y){ setStatus(statusEl,'Please select district, church, month and year first.', true); return; }
  setStatus(statusEl,'Saving…', false);
  const ok = await saveEntryForCombo(d,c,m,y);
  document.getElementById('savedBadge').textContent = 'Saved';
  setStatus(statusEl, ok ? ('Saved '+c+' / '+m+' '+y+'.') : ('Could not save — you may not have access to this district, or the connection was interrupted.'), !ok);
});

/* ================= Catch-up a past (incomplete) month =================
   lateFields is tagged ONLY here — never inferred from editedAt, never touched by an
   ordinary save. Completeness is checked per offering field, not once per month-row, so a
   month with some fields already on-time and others still blank still shows up here. */
function monthsBeforeList(beforeMonth, beforeYear){
  const out = [];
  const by = Number(beforeYear);
  for(let y=FIRST_YEAR; y<=by; y++){
    const mLimit = (y===by) ? MONTHS.indexOf(beforeMonth) : 12;
    for(let mi=0; mi<mLimit; mi++) out.push({month: MONTHS[mi], year: y});
  }
  return out;
}
function pastIncompleteMonthsFor(d,c,beforeMonth,beforeYear){
  if(!d||!c||!beforeMonth||!beforeYear) return [];
  return monthsBeforeList(beforeMonth, beforeYear)
    .map(({month,year})=>{
      const entry = state[keyFor(d,c,month,year)];
      return { month, year, entry, partial: monthPartiallyFilled(entry) };
    })
    .filter(x=> !monthComplete(x.entry))
    .reverse(); // most-recent-first — the nearest past month is what people are usually catching up on
}
function updateCatchUpButtonState(){
  const btn = document.getElementById('catchUpBtn'); if(!btn) return;
  const d=districtSelect.value, c=churchSelect.value, m=monthSelect.value, y=yearSelect.value;
  btn.disabled = !(d && c && m && y) || pastIncompleteMonthsFor(d,c,m,y).length===0;
}

let catchUpCtx = null; // { d, c, targetMonth, targetYear, reportedMonth, reportedYear }

function openCatchUpModal(){
  const d=districtSelect.value, c=churchSelect.value, m=monthSelect.value, y=yearSelect.value;
  if(!d||!c||!m||!y) return;
  const list = pastIncompleteMonthsFor(d,c,m,y);
  document.getElementById('catchUpListSub').textContent = 'Past incomplete months for '+c+', '+d+' — before '+m+' '+y+'.';
  const listEl = document.getElementById('catchUpList');
  listEl.innerHTML = '';
  list.forEach((item, idx)=>{
    const div = document.createElement('div'); div.className='catchup-item';
    let badges = '';
    if(idx===0) badges += '<span class="badge-recent">most recent</span>';
    if(item.partial) badges += '<span class="badge-partial">partially filled</span>';
    div.innerHTML = '<span class="catchup-item-label">'+esc(item.month+' '+item.year)+'</span><span class="flex items-center gap-2">'+badges+'<i data-lucide="arrow-right" class="w-3.5 h-3.5 text-ink-300"></i></span>';
    div.addEventListener('click', ()=> showCatchUpForm(d,c,item.month,item.year,m,y));
    listEl.appendChild(div);
  });
  if(!list.length) listEl.innerHTML = '<p class="note">No incomplete months found for this church yet.</p>';
  document.getElementById('catchUpListView').style.display='flex';
  document.getElementById('catchUpFormView').style.display='none';
  document.getElementById('catchUpModal').classList.add('show');
  refreshIcons();
}
document.getElementById('catchUpBtn').addEventListener('click', openCatchUpModal);
document.getElementById('catchUpCloseBtn').addEventListener('click', ()=> document.getElementById('catchUpModal').classList.remove('show'));
document.getElementById('catchUpBackBtn').addEventListener('click', ()=>{
  document.getElementById('catchUpFormView').style.display='none';
  document.getElementById('catchUpListView').style.display='flex';
});

function buildCatchUpAmountsGrid(entry){
  const grid = document.getElementById('catchUpAmountsGrid');
  grid.innerHTML = '';
  OFFERINGS.forEach(o=>{
    const hasVal = fieldHasValue(entry, o.key);
    const div = document.createElement('div');
    const lblOpen = '<label class="block text-[0.6875rem] font-medium text-ink-700 dark:text-ink-300 mb-2 uppercase tracking-wider">'+esc(o.label);
    if(hasVal){
      div.innerHTML = lblOpen+' <span class="field-tag">already filled</span></label>'+
        '<input type="text" class="amt input-field w-full px-4 py-2.5 rounded-sm text-sm text-right mono opacity-50" id="cu_'+o.key+'" value="'+esc(formatWithCommas(String(Math.round(Number(entry[o.key])))))+'" disabled>';
    } else {
      div.innerHTML = lblOpen+'</label><input type="text" inputmode="numeric" class="amt input-field w-full px-4 py-2.5 rounded-sm text-sm text-right mono dark:text-paper" id="cu_'+o.key+'" placeholder="0">';
    }
    grid.appendChild(div);
  });
  grid.querySelectorAll('input.amt:not([disabled])').forEach(inp=>{
    inp.addEventListener('input', ()=>{ inp.value = formatWithCommas(digitsOnly(inp.value)); updateCatchUpTotal(); });
    inp.addEventListener('keypress', ev=>{ if(!/[0-9]/.test(ev.key)) ev.preventDefault(); });
    inp.addEventListener('keydown', ev=>{ if(ev.key==='Enter'){ ev.preventDefault(); focusNextAmt(grid, inp); } });
    inp.addEventListener('paste', ev=>{ ev.preventDefault(); const text=(ev.clipboardData||window.clipboardData).getData('text'); inp.value=formatWithCommas(digitsOnly(text)); updateCatchUpTotal(); });
  });
}
function updateCatchUpTotal(){
  // Running total includes both the greyed-out existing values and whatever's newly typed.
  let total = 0;
  OFFERINGS.forEach(o=>{ const v = readAmountField('cu_'+o.key); if(v) total += v; });
  document.getElementById('catchUpTotalValue').textContent = formatWithCommas(String(total))+' UGX';
}
function showCatchUpForm(d,c,targetMonth,targetYear,reportedMonth,reportedYear){
  catchUpCtx = { d, c, targetMonth, targetYear, reportedMonth, reportedYear };
  const entry = state[keyFor(d,c,targetMonth,targetYear)];
  document.getElementById('catchUpFormTitle').textContent = 'Catch up — '+c+' / '+targetMonth+' '+targetYear;
  document.getElementById('catchUpFormSub').textContent = 'Already-filled fields are locked and untouched. New figures are recorded as reported in '+reportedMonth+' '+reportedYear+' for SunPlus, and restated back into '+targetMonth+' '+targetYear+' for Management.';
  document.getElementById('catchUpSerial').value = (entry && entry.serialNo) ? String(entry.serialNo) : '';
  buildCatchUpAmountsGrid(entry);
  updateCatchUpTotal();
  document.getElementById('catchUpFormStatus').textContent = '';
  document.getElementById('catchUpListView').style.display='none';
  document.getElementById('catchUpFormView').style.display='flex';
}

async function saveCatchUpEntry(){
  if(!catchUpCtx) return;
  const { d, c, targetMonth, targetYear, reportedMonth, reportedYear } = catchUpCtx;
  const statusEl = document.getElementById('catchUpFormStatus');
  const key = keyFor(d,c,targetMonth,targetYear);
  const existing = state[key] || {};
  const entry = {};
  // Merge into any existing lateFields map — a third catch-up pass on a different field must
  // not erase the tag left by an earlier pass.
  const lateFields = Object.assign({}, existing.lateFields || {});
  let touchedAny = false;
  OFFERINGS.forEach(o=>{
    if(fieldHasValue(existing, o.key)){
      entry[o.key] = existing[o.key]; // already filled — never re-read, never re-written
    } else {
      const v = readAmountField('cu_'+o.key);
      if(v!==null){
        entry[o.key] = v;
        lateFields[o.key] = { reportedMonth, reportedYear: Number(reportedYear) };
        touchedAny = true;
      } else {
        entry[o.key] = null;
      }
    }
  });
  if(!touchedAny){ setStatus(statusEl, 'Enter at least one new figure before saving.', true); return; }
  setStatus(statusEl, 'Saving…', false);
  entry.serialNo = document.getElementById('catchUpSerial').value.trim() || null;
  entry.editedBy = currentUser.full_name; entry.editedAt = new Date().toISOString(); entry.device = await deviceDescriptor();
  entry.lateFields = lateFields;
  const ok = await fsSetEntry(d,c,targetMonth,targetYear,entry);
  state[key] = Object.assign({district:d, church:c, month:targetMonth, year:Number(targetYear)}, entry);
  const auditRec = { ts: entry.editedAt, name: currentUser.full_name, role: currentUser.role, district:d, church:c, month:targetMonth, year:Number(targetYear), device: entry.device, total: entryTotal(entry), status: entryStatus(entry) };
  auditLog.push(auditRec); await fsAddAudit(auditRec);
  renderProgress();
  updateCatchUpButtonState();
  setStatus(statusEl, ok ? 'Saved.' : 'Could not save — you may not have access to this district, or the connection was interrupted.', !ok);
  if(ok) setTimeout(()=>{ document.getElementById('catchUpModal').classList.remove('show'); }, 700);
}
document.getElementById('catchUpSaveBtn').addEventListener('click', saveCatchUpEntry);

/* ---------------- Progress (shared helper: used by main tab and profile tab) ---------------- */
// Scoped to a single year — the one currently selected in the entry form, so progress reflects
// whichever year someone is actually working in rather than merging figures across years.
function progressYear(){ return (yearSelect && yearSelect.value) ? yearSelect.value : String(yearCeiling()); }
function computeProgress(districtNames, year){
  let totalEntered=0, totalSlots=0;
  const rows = districtNames.map(d=>{
    const churches = scopedChurches(d);
    const slots = churches.length * MONTHS.length;
    let entered=0;
    churches.forEach(c=> MONTHS.forEach(m=>{ if(entryStatus(state[keyFor(d,c,m,year)])==='Entered') entered++; }));
    totalEntered+=entered; totalSlots+=slots;
    return { d, churchCount: churches.length, entered, slots, pct: slots?Math.round((entered/slots)*100):0 };
  });
  return { rows, totalEntered, totalSlots, pct: totalSlots?Math.round((totalEntered/totalSlots)*100):0 };
}
function renderProgressInto(bodyId, fillId, labelId, districtNames){
  const body = document.getElementById(bodyId); if(!body) return;
  const { rows, totalEntered, totalSlots, pct } = computeProgress(districtNames, progressYear());
  body.innerHTML='';
  rows.forEach(r=>{
    const tr = document.createElement('tr'); tr.className='table-row';
    tr.innerHTML = '<td class="px-4 py-3 font-medium text-ink-900 dark:text-paper">'+esc(r.d)+'</td>'
      + '<td class="px-4 py-3 text-right mono text-ink-600 dark:text-ink-400">'+r.churchCount+'</td>'
      + '<td class="px-4 py-3 text-right mono '+(r.entered?'text-emerald-700 dark:text-emerald-400':'text-ink-400 dark:text-ink-500')+'">'+r.entered+' / '+r.slots+'</td>'
      + '<td class="px-4 py-3 text-right"><span class="stat-num text-xs '+(r.pct>=100?'text-emerald-700 dark:text-emerald-400':'text-ink-700 dark:text-ink-300')+'">'+r.pct+'%</span></td>';
    body.appendChild(tr);
  });
  const fillEl = document.getElementById(fillId), labelEl = document.getElementById(labelId);
  if(fillEl) fillEl.style.width = pct+'%';
  if(labelEl) labelEl.textContent = totalEntered+' of '+totalSlots+' entered in '+progressYear()+' ('+pct+'%)';
}
// ---- Current-month progress (used by the Data Entry panel, hero line and the Progress tab) ----
function currentMonthName(){ return MONTHS[new Date().getMonth()]; }
function computeMonthProgress(districtNames, month, year){
  let reported=0, total=0;
  const rows = districtNames.map(d=>{
    const churches = scopedChurches(d).map(c=>({ name:c, reported: entryStatus(state[keyFor(d,c,month,year)])==='Entered' }));
    const rep = churches.filter(c=>c.reported).length;
    reported += rep; total += churches.length;
    return { d, churches, reported: rep, total: churches.length, pct: churches.length ? Math.round((rep/churches.length)*100) : 0 };
  });
  return { rows, reported, total, pct: total ? Math.round((reported/total)*100) : 0 };
}
function renderEntryMonthProgress(names, mp, month, year){
  const body = document.getElementById('districtProgressBody'); if(!body) return;
  body.innerHTML='';
  mp.rows.forEach(r=>{
    const tr = document.createElement('tr'); tr.className='table-row';
    tr.innerHTML = '<td class="px-4 py-3 font-medium text-ink-900 dark:text-paper">'+esc(r.d)+'</td>'
      + '<td class="px-4 py-3 text-right mono text-ink-600 dark:text-ink-400">'+r.total+'</td>'
      + '<td class="px-4 py-3 text-right mono '+(r.reported?'text-emerald-700 dark:text-emerald-400':'text-ink-400 dark:text-ink-500')+'">'+r.reported+' / '+r.total+'</td>'
      + '<td class="px-4 py-3 text-right"><span class="stat-num text-xs '+(r.pct>=100?'text-emerald-700 dark:text-emerald-400':'text-ink-700 dark:text-ink-300')+'">'+r.pct+'%</span></td>';
    body.appendChild(tr);
  });
  const fill = document.getElementById('progressFill'); if(fill) fill.style.width = mp.pct+'%';
  const label = document.getElementById('progressLabel'); if(label) label.textContent = mp.reported+' of '+mp.total+' in '+month+' '+year+' ('+mp.pct+'%)';
  const cap = document.getElementById('progressCaption'); if(cap) cap.textContent = 'Completion · '+month;
}
function renderProgressTab(){
  const body = document.getElementById('progressBreakdownBody'); if(!body) return;
  const names = scopedDistrictNames();
  const month = progMonthSelect.value || currentMonthName();
  const year = progYearSelect.value || String(yearCeiling());
  const mp = computeMonthProgress(names, month, year);
  document.getElementById('mpMonthLabel').textContent = month+' '+year;
  document.getElementById('mpPct').textContent = mp.pct+'%';
  document.getElementById('mpCount').textContent = mp.reported+' of '+mp.total;
  document.getElementById('mpBar').style.width = mp.pct+'%';
  const C = 2*Math.PI*42;
  const ring = document.getElementById('mpRing');
  ring.setAttribute('stroke-dasharray', C.toFixed(1));
  ring.setAttribute('stroke-dashoffset', (C*(1-mp.pct/100)).toFixed(1));
  const out = mp.total - mp.reported;
  document.getElementById('mpOutstanding').textContent = mp.total===0 ? 'No churches visible to your account yet' : (out===0 ? 'All churches reported' : out+' outstanding');
  document.getElementById('dbTitle').textContent = 'District breakdown \u2014 '+month+' '+year;
  body.innerHTML = '';
  if(!mp.rows.length){ body.innerHTML = '<tr><td colspan="3" class="px-6 py-6 note">No districts visible to your account yet.</td></tr>'; return; }
  const tick = '<span class="w-[18px] h-[18px] rounded-full bg-emerald-600 flex items-center justify-center flex-shrink-0"><svg viewBox="0 0 24 24" class="w-3 h-3" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span>';
  const empty = '<span class="w-[18px] h-[18px] rounded-full border border-ink-300 dark:border-ink-600 flex-shrink-0"></span>';
  mp.rows.forEach(r=>{
    const tr = document.createElement('tr'); tr.className = 'align-top';
    const churchHtml = r.churches.length ? r.churches.map(c=>
      '<div class="flex items-center gap-2.5 py-1">'+(c.reported?tick:empty)+'<span class="mono text-[0.75rem] '+(c.reported?'font-semibold text-ink-900 dark:text-paper':'text-ink-500 dark:text-ink-500')+'">'+esc(c.name)+'</span></div>'
    ).join('') : '<span class="note">No churches</span>';
    tr.innerHTML = '<td class="px-6 py-4 mono text-[0.75rem] font-bold text-ink-900 dark:text-paper">'+esc(r.d)+'</td>'
      + '<td class="px-6 py-3">'+churchHtml+'</td>'
      + '<td class="px-6 py-4"><div class="flex items-center gap-3"><span class="mono text-[0.6875rem] font-semibold text-ink-700 dark:text-ink-300 whitespace-nowrap">'+r.reported+' / '+r.total+'</span><div class="flex-1 h-1.5 bg-ink-100 dark:bg-ink-800 rounded-full overflow-hidden"><div class="h-full bg-gold-500 rounded-full transition-all duration-700" style="width:'+r.pct+'%"></div></div><span class="mono text-[0.6875rem] text-ink-700 dark:text-ink-300 w-10 text-right">'+r.pct+'%</span></div></td>';
    body.appendChild(tr);
  });
}
function renderProgress(){
  const names = scopedDistrictNames();
  const year = progressYear(), month = currentMonthName();
  const mp = computeMonthProgress(names, month, year);
  renderEntryMonthProgress(names, mp, month, year);
  renderProgressTab();
  const cp = computeProgress(names, year);
  const ht = document.getElementById('heroTitle'); if(ht) ht.textContent = year+' Reporting Period';
  const hs = document.getElementById('heroStats'); if(hs && currentUser) hs.textContent = cp.totalEntered+' of '+cp.totalSlots+' monthly reports entered for '+year+' ('+cp.pct+'%) across '+names.length+' district'+(names.length===1?'':'s')+'. '+mp.reported+' of '+mp.total+' reports entered for '+month+' '+year+' ('+mp.pct+'%).';
  renderOverviewProgressBars(cp.rows);
}
function renderOverviewProgressBars(rows){
  const el = document.getElementById('overviewDistrictBars'); if(!el) return;
  if(!rows.length){ el.innerHTML = '<p class="note">No districts visible to your account yet.</p>'; return; }
  el.innerHTML = rows.map(r=>{
    const color = r.pct>=100 ? 'bg-emerald-600' : r.pct>=50 ? 'bg-gold-500' : 'bg-gold-300';
    return '<div><div class="flex items-center justify-between mb-1.5"><div class="flex items-center gap-2"><span class="w-2 h-2 rounded-full '+color+'"></span><span class="text-xs font-medium text-ink-700 dark:text-ink-300">'+esc(r.d)+'</span></div><span class="stat-num text-xs text-ink-600 dark:text-ink-400">'+r.entered+' / '+r.slots+'</span></div><div class="w-full h-1.5 bg-ink-100 dark:bg-ink-800 rounded-full overflow-hidden"><div class="h-full '+color+' rounded-full transition-all duration-700" style="width:'+r.pct+'%"></div></div></div>';
  }).join('');
}

/* ============================================================
   DISTRICT ASSIGNMENT MODAL (checklist — no typing)
   ============================================================ */
function openDistrictModal(title, sub, preselected, takenBy){
  document.getElementById('districtModalTitle').textContent = title;
  document.getElementById('districtModalSub').textContent = sub;
  const box = document.getElementById('districtChecklist'); box.innerHTML='';
  const pre = new Set(preselected||[]);
  DISTRICT_NAMES.forEach(d=>{
    const label = document.createElement('label');
    label.className = 'flex items-start gap-2.5 px-3 py-2.5 border border-ink-200 dark:border-ink-700 rounded-sm text-sm font-medium cursor-pointer hover:border-ink-900 dark:hover:border-gold-500 transition-colors dark:text-ink-200';
    const others = (takenBy && takenBy[d]) || [];
    const taken = others.length
      ? '<span class="block text-[0.625rem] font-normal text-gold-600 dark:text-gold-400 leading-snug mt-0.5" title="'+esc(others.join(', '))+'">Already assigned · '+esc(others.length>2 ? others.slice(0,2).join(', ')+' +'+(others.length-2) : others.join(', '))+'</span>'
      : '';
    label.innerHTML = '<input type="checkbox" class="w-4 h-4 mt-0.5 accent-[#c98a2f]" value="'+esc(d)+'" '+(pre.has(d)?'checked':'')+'><span class="min-w-0"><span class="block">'+esc(d)+'</span>'+taken+'</span>';
    box.appendChild(label);
  });
  document.getElementById('districtModalStatus').textContent = '';
  document.getElementById('districtModal').classList.add('show');
  refreshIcons();
  return new Promise(resolve=>{ districtModalResolve = resolve; });
}
function closeDistrictModal(result){
  document.getElementById('districtModal').classList.remove('show');
  if(districtModalResolve){ districtModalResolve(result); districtModalResolve=null; }
}
document.getElementById('districtModalCancel').addEventListener('click', ()=> closeDistrictModal(null));
document.getElementById('districtModalCancelTop').addEventListener('click', ()=> closeDistrictModal(null));
document.getElementById('districtModalBackdrop').addEventListener('click', ()=> closeDistrictModal(null));
document.getElementById('catchUpBackdrop').addEventListener('click', ()=> document.getElementById('catchUpModal').classList.remove('show'));
document.getElementById('userProfileBackdrop').addEventListener('click', ()=> document.getElementById('userProfileOverlay').classList.remove('show'));
document.getElementById('districtModalSave').addEventListener('click', ()=>{
  const checked = Array.from(document.querySelectorAll('#districtChecklist input:checked')).map(i=>i.value);
  closeDistrictModal(checked);
});

/* ============================================================
   USER MANAGEMENT
   ============================================================ */
let usersCache = [];
let userDistrictsCache = {}; // userId -> [districts]
async function loadUsers(){
  const statusEl = document.getElementById('usersStatus');
  setStatus(statusEl,'Loading…', false);
  const { data, error } = await supabase.from('profiles').select('*').order('created_at', {ascending:false});
  if(error){ setStatus(statusEl, error.message, true); return; }
  usersCache = data||[];
  const { data: uda } = await supabase.from('user_district_access').select('user_id,district');
  const { data: ascope } = await supabase.from('admin_scope').select('admin_id,district,system_wide');
  userDistrictsCache = {};
  (uda||[]).forEach(r=>{ (userDistrictsCache[r.user_id] ||= []).push(r.district); });
  (ascope||[]).forEach(r=>{ (userDistrictsCache[r.admin_id] ||= []); if(r.system_wide) userDistrictsCache[r.admin_id]=['ALL']; else if(!userDistrictsCache[r.admin_id].includes('ALL')) userDistrictsCache[r.admin_id].push(r.district); });
  renderUsers(usersCache);
  setStatus(statusEl, '', false);
}
function renderUsers(rows){
  const body = document.getElementById('usersBody'); body.innerHTML='';
  rows.forEach(u=>{
    const tr = document.createElement('tr');
    const actions = [];
    const canManage = currentUser.role==='super_admin' || (currentUser.role==='admin' && u.role==='audit_user');
    const isSelf = u.id === currentUser.id;
    if(canManage && !isSelf && u.role !== 'super_admin'){
      if(u.status === 'pending_approval') actions.push('<button class="btn-secondary btn-sm approve-btn" data-id="'+u.id+'">Approve</button>');
      if(u.status === 'suspended' || u.status === 'deactivated') actions.push('<button class="btn-secondary btn-sm reactivate-btn" data-id="'+u.id+'">Reactivate</button>');
    }
    if(userMenuItems(u).length) actions.push('<button class="um-menu-btn" data-id="'+u.id+'" aria-label="More actions" title="More actions"><i data-lucide="menu" class="w-4 h-4"></i></button>');
    const districts = userDistrictsCache[u.id] || [];
    const districtLabel = districts.includes('ALL') ? 'All districts' : (districts.length ? districts.length+' district'+(districts.length>1?'s':'') : '—');
    const online = onlineUserIds.has(u.id);
    tr.className='table-row';
    tr.innerHTML = '<td class="px-6 py-4"><div class="user-cell" data-id="'+u.id+'" title="View profile">'+avatarHTML(u.full_name,'',avatarUrlFor(u))+'<span class="u-name text-sm font-medium dark:text-paper">'+esc(u.full_name)+'</span><span class="presence-dot'+(online?' online':'')+'"></span></div></td>'
      + '<td class="px-6 py-4 mono text-xs text-ink-600 dark:text-ink-400 hidden lg:table-cell">'+esc(u.email)+'</td>'
      + '<td class="px-6 py-4"><span class="text-xs font-medium text-ink-700 dark:text-ink-300">'+esc(roleLabel(u.role))+'</span></td>'
      + '<td class="px-6 py-4 text-xs text-ink-600 dark:text-ink-400 hidden md:table-cell">'+esc(districtLabel)+'</td>'
      + '<td class="px-6 py-4"><span class="pill pill-'+esc(u.status)+'">'+esc(u.status.replace('_',' '))+'</span></td>'
      + '<td class="px-6 py-4 text-xs text-ink-500 hidden xl:table-cell">'+fmtDate(u.last_login)+'</td>'
      + '<td class="px-6 py-4 text-right whitespace-nowrap">'+actions.join(' ')+'</td>';
    body.appendChild(tr);
  });
  body.querySelectorAll('.user-cell').forEach(el=> el.addEventListener('click', ()=> openUserProfile(el.dataset.id)));
  body.querySelectorAll('.approve-btn').forEach(b=> b.addEventListener('click', ()=>approveUser(b.dataset.id)));
  body.querySelectorAll('.reactivate-btn').forEach(b=> b.addEventListener('click', ()=>changeStatus(b.dataset.id,'active')));
  body.querySelectorAll('.um-menu-btn').forEach(b=> b.addEventListener('click', e=>{ e.stopPropagation(); toggleUserMenu(b); }));
  refreshIcons();
}
/* Hamburger menu: Districts, Suspend, Deactivate, Make Admin, Progress */
function userMenuItems(u){
  const items = [];
  const canManage = currentUser.role==='super_admin' || (currentUser.role==='admin' && u.role==='audit_user');
  const isSelf = u.id === currentUser.id;
  if(canManage && !isSelf && u.role !== 'super_admin'){
    items.push({ label:'Districts…', fn:()=>assignDistricts(u.id) });
    if(u.status === 'active') items.push({ label:'Suspend', fn:()=>changeStatus(u.id,'suspended') });
    if(u.status !== 'deactivated') items.push({ label:'Deactivate', cls:'danger', fn:()=>changeStatus(u.id,'deactivated') });
    if(currentUser.role==='super_admin' && u.role==='audit_user') items.push({ label:'Make Admin', fn:()=>promoteUser(u.id) });
  }
  if(u.role === 'audit_user' && (currentUser.role==='admin'||currentUser.role==='super_admin')) items.push({ label:'Progress', fn:()=>openUserProfile(u.id) });
  return items;
}
let userMenuOpenFor = null;
function closeUserMenu(){ const m=document.getElementById('userActionMenu'); m.style.display='none'; m.innerHTML=''; userMenuOpenFor=null; }
function toggleUserMenu(btn){
  const m = document.getElementById('userActionMenu');
  if(userMenuOpenFor === btn.dataset.id && m.style.display==='block'){ closeUserMenu(); return; }
  const u = usersCache.find(x=>x.id===btn.dataset.id); if(!u) return;
  m.innerHTML = '';
  userMenuItems(u).forEach(it=>{
    const b = document.createElement('button'); b.type='button'; b.setAttribute('role','menuitem');
    if(it.cls) b.className = it.cls;
    b.textContent = it.label;
    b.addEventListener('click', ()=>{ closeUserMenu(); it.fn(); });
    m.appendChild(b);
  });
  userMenuOpenFor = btn.dataset.id;
  m.style.display = 'block';
  const r = btn.getBoundingClientRect();
  const mw = m.offsetWidth, mh = m.offsetHeight;
  let left = Math.min(Math.max(8, r.right - mw), window.innerWidth - mw - 8);
  let top = r.bottom + 4;
  if(top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
  m.style.left = left+'px'; m.style.top = top+'px';
}
document.addEventListener('click', e=>{ if(!e.target.closest('#userActionMenu')) closeUserMenu(); });
document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeUserMenu(); });
window.addEventListener('resize', closeUserMenu);
window.addEventListener('scroll', closeUserMenu, true);
async function approveUser(userId){
  const { error } = await supabase.rpc('approve_user', { p_user_id: userId });
  if(error){ await appAlert(error.message, 'Could not approve user'); return; }
  loadUsers();
}
async function assignDistricts(userId){
  const u = usersCache.find(x=>x.id===userId);
  const current = (userDistrictsCache[userId]||[]).filter(d=>d!=='ALL');
  const label = u ? (u.full_name+' ('+roleLabel(u.role)+')') : 'this user';
  // Which other users already hold each district (system-wide admins are skipped — they hold all of them)
  const takenBy = {};
  usersCache.forEach(o=>{
    if(o.id===userId) return;
    const ds = userDistrictsCache[o.id] || [];
    if(ds.includes('ALL')) return;
    ds.forEach(d=>{ (takenBy[d] ||= []).push(o.full_name || o.email); });
  });
  const result = await openDistrictModal('Assign Districts', 'Assigning a district grants access to every church within it — for '+label+'.', current, takenBy);
  if(result === null) return;
  document.getElementById('districtModalStatus').textContent = 'Saving…';
  const { error } = await supabase.rpc('set_user_districts', { p_user_id: userId, p_districts: result });
  if(error){ await appAlert(error.message, 'Could not assign districts'); return; }
  loadUsers();
}
async function changeStatus(userId, status){
  const u = usersCache.find(x=>x.id===userId);
  const name = u ? u.full_name : 'this user';
  const cfg = {
    suspended:   { title:'Suspend user',    label:'Suspend',    danger:false, msg:'Suspend '+name+'? If they are currently signed in, they will be logged out immediately.' },
    deactivated: { title:'Deactivate user', label:'Deactivate', danger:true,  msg:'Deactivate '+name+'? If they are currently signed in, they will be logged out immediately.' },
    active:      { title:'Reactivate user', label:'Reactivate', danger:false, msg:'Reactivate '+name+'? They will be able to sign in again.' }
  }[status] || { title:'Change status', label:'Confirm', danger:false, msg:'Set '+name+'\'s status to "'+status+'"?' };
  if(!(await appConfirm(cfg.msg, { title:cfg.title, confirmLabel:cfg.label, danger:cfg.danger }))) return;
  const { error } = await supabase.rpc('set_user_status', { p_user_id: userId, p_status: status });
  if(error){ await appAlert(error.message, 'Could not update status'); return; }
  loadUsers();
}
async function promoteUser(userId){
  const u = usersCache.find(x=>x.id===userId);
  if(!(await appConfirm('Make '+(u?u.full_name:'this user')+' an Admin? They will get all districts by default and, if currently signed in, will be logged out to sign back in with their new access.', { title:'Make Admin', confirmLabel:'Make Admin' }))) return;
  const { error } = await supabase.rpc('promote_to_admin', { p_user_id: userId });
  if(error){ await appAlert(error.message, 'Could not promote user'); return; }
  loadUsers();
}
let upProfileNames = [];
function renderUserMonthProgress(){
  const body = document.getElementById('upMonthBody'), fill = document.getElementById('upMonthFill'), label = document.getElementById('upMonthLabel');
  const month = document.getElementById('upMonthSelect').value || currentMonthName();
  const year = progressYear();
  if(!upProfileNames.length){
    body.innerHTML = '<tr><td colspan="4" class="px-4 py-3 text-center text-ink-400">No districts assigned yet.</td></tr>';
    fill.style.width = '0%'; label.textContent = 'No data to show.'; return;
  }
  const mp = computeMonthProgress(upProfileNames, month, year);
  body.innerHTML = '';
  mp.rows.forEach(r=>{
    const tr = document.createElement('tr'); tr.className='table-row';
    tr.innerHTML = '<td class="px-4 py-3 font-medium text-ink-900 dark:text-paper">'+esc(r.d)+'</td>'
      + '<td class="px-4 py-3 text-right mono text-ink-600 dark:text-ink-400">'+r.total+'</td>'
      + '<td class="px-4 py-3 text-right mono '+(r.reported?'text-emerald-700 dark:text-emerald-400':'text-ink-400 dark:text-ink-500')+'">'+r.reported+' / '+r.total+'</td>'
      + '<td class="px-4 py-3 text-right"><span class="stat-num text-xs '+(r.pct>=100?'text-emerald-700 dark:text-emerald-400':'text-ink-700 dark:text-ink-300')+'">'+r.pct+'%</span></td>';
    body.appendChild(tr);
  });
  fill.style.width = mp.pct+'%';
  label.textContent = mp.reported+' of '+mp.total+' in '+month+' '+year+' ('+mp.pct+'%)';
}
function openUserProfile(userId){
  const u = usersCache.find(x=>x.id===userId);
  if(!u) return;
  document.getElementById('userProfileOverlay').dataset.userId = userId;
  document.getElementById('upAvatar').innerHTML = avatarHTML(u.full_name, 'lg', avatarUrlFor(u));
  document.getElementById('upName').textContent = u.full_name;
  document.getElementById('upEmail').textContent = u.email;
  document.getElementById('upRole').textContent = roleLabel(u.role);
  document.getElementById('upStatus').textContent = (u.status||'').replace('_',' ');
  document.getElementById('upPhone').textContent = u.phone || '—';
  document.getElementById('upLastLogin').textContent = fmtDate(u.last_login);
  const districts = userDistrictsCache[u.id] || [];
  document.getElementById('upDistricts').textContent = districts.includes('ALL') ? 'All districts' : (districts.length ? districts.join(', ') : 'None assigned');
  const online = onlineUserIds.has(u.id);
  document.getElementById('upPresenceDot').className = 'presence-dot'+(online?' online':'');
  document.getElementById('upPresenceLabel').textContent = online ? 'Online now' : 'Offline';

  const names = districts.includes('ALL') ? DISTRICT_NAMES : districts;
  upProfileNames = names;
  const upSel = document.getElementById('upMonthSelect');
  if(!upSel.options.length){
    MONTHS.forEach(m=>{ const o=document.createElement('option'); o.value=m; o.textContent=m; upSel.appendChild(o); });
    upSel.addEventListener('change', renderUserMonthProgress);
  }
  upSel.value = currentMonthName(); // always default to the current month
  document.getElementById('upYearCaption').textContent = progressYear();
  renderUserMonthProgress();
  if(names.length){
    renderProgressInto('upProgressBody','upProgressFill','upProgressLabel', names);
  } else {
    document.getElementById('upProgressBody').innerHTML = '<tr><td colspan="4" class="px-4 py-3 text-center text-ink-400">No districts assigned yet.</td></tr>';
    document.getElementById('upProgressFill').style.width='0%';
    document.getElementById('upProgressLabel').textContent = 'No data to show.';
  }

  const resetBtn = document.getElementById('upResetPwBtn');
  const canResetPw = currentUser.role==='super_admin' && u.id !== currentUser.id;
  resetBtn.style.display = canResetPw ? 'inline-block' : 'none';
  resetBtn.onclick = async ()=>{
    const statusEl = document.getElementById('upStatusLine');
    if(!(await appConfirm('Send a password reset email to '+u.full_name+' ('+u.email+')? They will receive a link to choose a new password.', { title:'Send password reset', confirmLabel:'Send Reset Email' }))) return;
    setStatus(statusEl,'Sending…', false);
    const { error } = await supabase.auth.resetPasswordForEmail(u.email, { redirectTo: appRedirectUrl() });
    setStatus(statusEl, error ? error.message : ('Password reset email sent to '+u.email+'.'), !!error);
  };
  document.getElementById('upStatusLine').textContent = '';
  document.getElementById('userProfileOverlay').classList.add('show');
  refreshIcons();
}
document.getElementById('upCloseBtn').addEventListener('click', ()=> document.getElementById('userProfileOverlay').classList.remove('show'));
document.getElementById('refreshUsersBtn').addEventListener('click', loadUsers);

/* ============================================================
   AUDIT LOG
   ============================================================ */
async function loadAuditLog(){
  const { data, error } = await supabase.from('audit_log').select('*').order('created_at',{ascending:false}).limit(300);
  const body = document.getElementById('auditLogBody'); body.innerHTML='';
  if(error){ body.innerHTML = '<tr><td colspan="6" class="px-6 py-4 text-center text-red-700">'+esc(error.message)+'</td></tr>'; return; }
  (data||[]).forEach(a=>{
    const tr = document.createElement('tr'); tr.className='table-row';
    tr.innerHTML = '<td class="px-6 py-4 text-xs mono text-ink-500">'+fmtDate(a.created_at)+'</td><td class="px-6 py-4 text-sm font-medium dark:text-paper">'+esc(a.actor_name||'')+'</td><td class="px-6 py-4 text-xs text-ink-600 dark:text-ink-400">'+esc(a.actor_role||'')+'</td>'
      + '<td class="px-6 py-4"><span class="text-xs mono text-ink-700 dark:text-ink-300">'+esc(a.action)+'</span></td><td class="px-6 py-4 text-xs text-ink-600 dark:text-ink-400">'+esc((a.target_type||'')+' '+(a.target_id||''))+'</td>'
      + '<td class="px-6 py-4 text-xs mono text-ink-400 max-w-[280px] truncate">'+esc(JSON.stringify(a.details||{}))+'</td>';
    body.appendChild(tr);
  });
}
function inMyScope(district){
  if(myScope === 'all') return true;
  return Array.isArray(myScope) && myScope.includes(district);
}
function renderAudit(){
  const body = document.getElementById('auditBody'); if(!body) return;
  body.innerHTML='';
  const scopedAudit = auditLog.filter(a=> inMyScope(a.district));
  scopedAudit.slice().reverse().forEach(a=>{
    const tr = document.createElement('tr'); tr.className='table-row';
    tr.innerHTML = '<td class="px-6 py-4 text-xs mono text-ink-500">'+fmtDate(a.ts)+'</td><td class="px-6 py-4 text-sm font-medium dark:text-paper">'+esc(a.name||'')+'</td><td class="px-6 py-4 text-xs text-ink-600 dark:text-ink-400">'+esc((a.district||'')+' / '+(a.church||'')+' / '+(a.month||'')+(a.year?(' '+a.year):''))+'</td><td class="px-6 py-4 text-xs text-ink-400">'+esc(a.device||'')+'</td>';
    body.appendChild(tr);
  });
  const act = document.getElementById('overviewActivity');
  if(act){
    const recent = scopedAudit.slice().reverse().slice(0,6);
    act.innerHTML = recent.length ? recent.map(a=>'<div class="flex items-start gap-3 px-6 py-4"><span class="w-8 h-8 rounded-sm bg-ink-900 dark:bg-ink-800 flex items-center justify-center flex-shrink-0"><i data-lucide="pen-line" class="w-3.5 h-3.5 text-gold-400"></i></span><div class="min-w-0"><p class="text-xs font-medium dark:text-paper truncate">'+esc(a.name||'')+' &middot; '+esc((a.month||'')+' '+(a.year||''))+'</p><p class="text-[0.625rem] text-ink-500 truncate">'+esc((a.district||'')+' / '+(a.church||''))+'</p><p class="text-[0.625rem] text-ink-400 mt-0.5">'+fmtDate(a.ts)+'</p></div></div>').join('')
      : '<p class="note p-6">No recorded activity yet.</p>';
  }
  refreshIcons();
}
async function loadFinancialAudit(){ auditLog = await fsGetAllAudit(); renderAudit(); }
async function loadOverviewActivity(){ try{ auditLog = await fsGetAllAudit(); }catch(e){} renderAudit(); }
document.getElementById('refreshAuditLogBtn').addEventListener('click', loadAuditLog);
document.getElementById('refreshAuditBtn').addEventListener('click', loadFinancialAudit);

/* ============================================================
   SUPPORT ACCESS (Super Admin only)
   ============================================================ */
document.getElementById('grantSupportBtn').addEventListener('click', async ()=>{
  const statusEl = document.getElementById('supportStatus');
  const email = document.getElementById('supportEmail').value.trim();
  const hours = Number(document.getElementById('supportHours').value) || 4;
  const reason = document.getElementById('supportReason').value.trim();
  if(!email || !reason){ setStatus(statusEl,'Email and reason are required.', true); return; }
  const { error } = await supabase.rpc('grant_support_access', { p_account_email: email, p_reason: reason, p_hours: hours, p_permissions: {} });
  if(error){ setStatus(statusEl, error.message, true); return; }
  setStatus(statusEl, 'Support access granted for '+hours+' hour(s).', false);
  loadSupportAccess();
});
async function loadSupportAccess(){
  const { data, error } = await supabase.from('support_access').select('*').order('granted_at',{ascending:false});
  const body = document.getElementById('supportBody'); body.innerHTML='';
  if(error){ body.innerHTML='<tr><td colspan="6" class="px-6 py-4 text-center text-red-700">'+esc(error.message)+'</td></tr>'; return; }
  (data||[]).forEach(s=>{
    const expired = new Date(s.expires_at) < new Date();
    const revoked = !!s.revoked_at;
    const label = revoked ? 'Revoked' : expired ? 'Expired' : 'Active';
    const pillCls = revoked ? 'pill-deactivated' : expired ? 'pill-suspended' : 'pill-active';
    const tr = document.createElement('tr'); tr.className='table-row';
    tr.innerHTML = '<td class="px-6 py-4 mono text-xs dark:text-paper">'+esc(s.account_email)+'</td><td class="px-6 py-4 text-xs text-ink-600 dark:text-ink-400">'+esc(s.reason)+'</td><td class="px-6 py-4 text-xs mono text-ink-500">'+fmtDate(s.granted_at)+'</td>'
      + '<td class="px-6 py-4 text-xs mono text-ink-500">'+fmtDate(s.expires_at)+'</td><td class="px-6 py-4"><span class="pill '+pillCls+'">'+label+'</span></td>'
      + '<td class="px-6 py-4 text-right">'+((!revoked && !expired) ? '<button class="btn-danger btn-sm revoke-btn" data-id="'+s.id+'">Revoke</button>' : '')+'</td>';
    body.appendChild(tr);
  });
  body.querySelectorAll('.revoke-btn').forEach(b=> b.addEventListener('click', async ()=>{
    await supabase.rpc('revoke_support_access', { p_id: b.dataset.id }); loadSupportAccess();
  }));
}

/* ============================================================
   SYSTEM OVERVIEW + DISTRICTS/CHURCHES MANAGEMENT
   ============================================================ */
async function loadOverview(){
  const isAuditUser = currentUser && currentUser.role === 'audit_user';
  const names = scopedDistrictNames();
  const totalChurches = names.reduce((s,d)=> s + scopedChurches(d).length, 0);
  let kpis, KPI_ICONS;
  if(isAuditUser){
    // Audit users see only figures for their own assigned districts — never system-wide user counts.
    const mp = computeMonthProgress(names, currentMonthName(), progressYear());
    kpis = [
      ['My Districts', names.length],
      ['My Churches', totalChurches],
      ['Reported This Month', mp.reported],
      ['Outstanding', mp.total - mp.reported],
    ];
    KPI_ICONS = { 'My Districts':'map', 'My Churches':'church', 'Reported This Month':'check-circle', 'Outstanding':'clock' };
  } else {
    const { data: profiles } = await supabase.from('profiles').select('role,status');
    const rows = profiles || [];
    kpis = [
      ['Total Users', rows.length],
      ['Audit Users', rows.filter(r=>r.role==='audit_user').length],
      ['Admins', rows.filter(r=>r.role==='admin').length],
      ['Pending Approval', rows.filter(r=>r.status==='pending_approval').length],
      ['Active', rows.filter(r=>r.status==='active').length],
      ['Districts', names.length],
      ['Churches', totalChurches],
    ];
    KPI_ICONS = { 'Total Users':'users', 'Audit Users':'user-check', 'Admins':'shield-check', 'Pending Approval':'clock', 'Active':'activity', 'Districts':'map', 'Churches':'church' };
  }
  const el = document.getElementById('overviewKpis'); el.innerHTML='';
  kpis.forEach(([label,n])=>{
    const d = document.createElement('div'); d.className='panel rounded-sm p-5 card-lift';
    d.innerHTML = '<div class="flex items-start justify-between mb-4"><p class="text-[0.625rem] font-semibold uppercase tracking-wider text-ink-500">'+esc(label)+'</p><span class="w-8 h-8 rounded-sm bg-ink-900 dark:bg-ink-800 flex items-center justify-center flex-shrink-0"><i data-lucide="'+(KPI_ICONS[label]||'circle')+'" class="w-4 h-4 text-gold-400"></i></span></div><p class="stat-num text-3xl font-semibold text-ink-900 dark:text-paper">'+n+'</p>';
    el.appendChild(d);
  });
  if(!isAuditUser) renderDistrictChurchList();
  renderProgress();
  loadOverviewActivity();
  refreshIcons();
}

function closeAllDcMenus(){ document.querySelectorAll('.dc-menu.show').forEach(m=> m.classList.remove('show')); }
document.addEventListener('click', (ev)=>{ if(!ev.target.closest('.dc-menu-wrap')) closeAllDcMenus(); });

function dcMenuHtml(idPrefix, opts){
  // opts: array of {label, action} rendered as buttons inside the dropdown
  return '<span class="dc-menu-wrap">'
    + '<button class="btn-ghost p-1.5 dc-more-btn" data-menu="'+idPrefix+'" title="More options"><i data-lucide="more-horizontal" class="w-4 h-4"></i></button>'
    + '<span class="dc-menu" id="'+idPrefix+'">'
    + opts.map(o=>'<button class="btn-ghost dc-menu-item" data-action="'+o.action+'">'+esc(o.label)+'</button>').join('')
    + '</span></span>';
}

function renderDistrictChurchList(){
  const container = document.getElementById('dcList'); container.innerHTML='';
  DISTRICT_NAMES.forEach((d,di)=>{
    const box = document.createElement('div'); box.className='dc-district border border-ink-200 dark:border-ink-800 rounded-sm overflow-hidden mb-3 last:mb-0';
    const churches = DISTRICTS[d]||[];
    const districtMenuId = 'dcmenu-d-'+di;
    box.innerHTML = '<div class="dc-district-head flex items-center justify-between px-4 py-3 bg-ink-50 dark:bg-ink-900/50 border-b border-ink-200 dark:border-ink-800"><strong class="text-sm font-semibold dark:text-paper">'+esc(d)+' <span class="note font-normal">· '+churches.length+' churches</span></strong>'
      + '<span class="flex items-center gap-1.5">'
      + '<button class="btn-secondary btn-sm dc-add-church" data-d="'+esc(d)+'">+ Church</button>'
      + dcMenuHtml(districtMenuId, [{label:'Rename', action:'rename-district'},{label:'Remove', action:'remove-district'}])
      + '</span></div>';
    churches.forEach((c,ci)=>{
      const churchMenuId = 'dcmenu-c-'+di+'-'+ci;
      const row = document.createElement('div'); row.className='dc-church-row flex items-center justify-between px-4 py-2.5 border-b border-ink-100 dark:border-ink-800 last:border-b-0';
      row.innerHTML = '<div class="name text-sm text-ink-700 dark:text-ink-300">'+esc(c)+'</div>'
        + dcMenuHtml(churchMenuId, [{label:'Rename', action:'rename-church'},{label:'Remove', action:'remove-church'}]);
      row.querySelector('.dc-menu-wrap').dataset.d = d;
      row.querySelector('.dc-menu-wrap').dataset.c = c;
      box.appendChild(row);
    });
    box.querySelector('.dc-district-head .dc-menu-wrap').dataset.d = d;
    container.appendChild(box);
  });
  container.querySelectorAll('.dc-add-church').forEach(b=> b.addEventListener('click', ()=>addChurch(b.dataset.d)));
  container.querySelectorAll('.dc-more-btn').forEach(b=> b.addEventListener('click', (ev)=>{
    ev.stopPropagation();
    const menu = document.getElementById(b.dataset.menu);
    const wasOpen = menu.classList.contains('show');
    closeAllDcMenus();
    if(!wasOpen) menu.classList.add('show');
  }));
  container.querySelectorAll('.dc-menu-item').forEach(b=> b.addEventListener('click', (ev)=>{
    ev.stopPropagation();
    closeAllDcMenus();
    const wrap = b.closest('.dc-menu-wrap');
    const d = wrap.dataset.d, c = wrap.dataset.c;
    const action = b.dataset.action;
    if(action==='rename-district') renameDistrict(d);
    else if(action==='remove-district') removeDistrict(d);
    else if(action==='rename-church') renameChurch(d,c);
    else if(action==='remove-church') removeChurch(d,c);
  }));
}

/* Apply a change to the in-memory district/church list and repaint straight away, then re-sync from the
   database in the background — so edits show up instantly instead of waiting on the realtime event. */
function applyDistrictsNow(mutate){
  try{ mutate(); }catch(e){ console.error(e); }
  DISTRICT_NAMES = Object.keys(DISTRICTS).sort((a,b)=>a.localeCompare(b));
  Object.keys(DISTRICTS).forEach(d=> DISTRICTS[d].sort((a,b)=>a.localeCompare(b)));
  renderDistrictChurchList();
  refreshAllDistrictUI();
  refreshIcons();
  loadDistrictsChurches().then(()=>{ renderDistrictChurchList(); refreshAllDistrictUI(); refreshIcons(); });
}
document.getElementById('addDistrictBtn').addEventListener('click', async ()=>{
  const statusEl = document.getElementById('dcStatus');
  const input = document.getElementById('newDistrictName');
  const name = input.value.trim();
  if(!name){ setStatus(statusEl,'Enter a district name.', true); return; }
  setStatus(statusEl,'Adding…', false);
  const { error } = await supabase.rpc('add_district', { p_name: name });
  if(error){ setStatus(statusEl, error.message, true); return; }
  input.value='';
  setStatus(statusEl,'District added.', false);
  applyDistrictsNow(()=>{ if(!DISTRICTS[name]) DISTRICTS[name] = []; });
});
async function renameDistrict(oldName){
  const newName = await appPrompt('Enter a new name for "'+oldName+'".', { title:'Rename district', value:oldName, confirmLabel:'Rename' });
  if(!newName || newName===oldName) return;
  const { error } = await supabase.rpc('rename_district', { p_old_name: oldName, p_new_name: newName });
  if(error){ await appAlert(error.message, 'Could not rename district'); return; }
  applyDistrictsNow(()=>{ DISTRICTS[newName] = DISTRICTS[oldName] || []; delete DISTRICTS[oldName]; });
}
async function removeDistrict(name){
  if(!(await appConfirm('Remove district "'+name+'" and all its churches? This only works if no financial records exist for it yet.', { title:'Remove district', confirmLabel:'Remove', danger:true }))) return;
  const { error } = await supabase.rpc('remove_district', { p_name: name });
  if(error){ await appAlert(error.message, 'Could not remove district'); return; }
  applyDistrictsNow(()=>{ delete DISTRICTS[name]; });
}
async function addChurch(district){
  const name = await appPrompt('Enter the name of the new church in '+district+'.', { title:'Add church', placeholder:'Church name', confirmLabel:'Add Church' });
  if(!name) return;
  const { error } = await supabase.rpc('add_church', { p_district: district, p_name: name });
  if(error){ await appAlert(error.message, 'Could not add church'); return; }
  applyDistrictsNow(()=>{ (DISTRICTS[district] ||= []); if(!DISTRICTS[district].includes(name)) DISTRICTS[district].push(name); });
}
async function renameChurch(district, oldName){
  const newName = await appPrompt('Enter a new name for "'+oldName+'".', { title:'Rename church', value:oldName, confirmLabel:'Rename' });
  if(!newName || newName===oldName) return;
  const { error } = await supabase.rpc('rename_church', { p_district: district, p_old_name: oldName, p_new_name: newName });
  if(error){ await appAlert(error.message, 'Could not rename church'); return; }
  applyDistrictsNow(()=>{ const arr = DISTRICTS[district] || []; const i = arr.indexOf(oldName); if(i>-1) arr[i] = newName; });
}
async function removeChurch(district, name){
  if(!(await appConfirm('Remove church "'+name+'" from '+district+'? This only works if no financial records exist for it yet.', { title:'Remove church', confirmLabel:'Remove', danger:true }))) return;
  const { error } = await supabase.rpc('remove_church', { p_district: district, p_name: name });
  if(error){ await appAlert(error.message, 'Could not remove church'); return; }
  applyDistrictsNow(()=>{ DISTRICTS[district] = (DISTRICTS[district]||[]).filter(c=>c!==name); });
}

/* ============================================================
   OFFERING TYPES (Overview tab — add/rename/remove) — DB-backed via
   an `offering_types` table (id, key, label, sort_order). Falls back to
   DEFAULT_OFFERINGS and disables editing if that table hasn't been
   created yet — see the setup note rendered in offeringsStatus.
   ============================================================ */
async function loadOfferingTypes(){
  if(!supabase) return false;
  const { data, error } = await supabase.from('offering_types').select('*').order('sort_order', {ascending:true});
  if(error || !data || !data.length){ offeringsFromDb = false; return false; }
  const next = data.map(r=>({ key: r.key, label: r.label }));
  const changed = JSON.stringify(next) !== JSON.stringify(OFFERINGS);
  OFFERINGS = next;
  offeringsFromDb = true;
  return changed;
}
function slugifyOfferingKey(label){
  return String(label).trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'') || ('offering_'+Date.now());
}
function renderOfferingsSummary(){
  const list = document.getElementById('offeringsList'); if(!list) return;
  list.innerHTML='';
  OFFERINGS.forEach((o,oi)=>{
    const row = document.createElement('div'); row.className='offerings-row flex items-center justify-between gap-2 px-4 py-2.5 border border-ink-200 dark:border-ink-800 rounded-sm';
    row.innerHTML = '<div class="name text-sm text-ink-700 dark:text-ink-300 truncate">'+esc(o.label)+'</div>'
      + dcMenuHtml('offmenu-'+oi, [{label:'Rename', action:'rename-offering'},{label:'Remove', action:'remove-offering'}]);
    row.querySelector('.dc-menu-wrap').dataset.key = o.key;
    list.appendChild(row);
  });
  const noteEl = document.getElementById('offeringsNote');
  const addBtn = document.getElementById('addOfferingBtn');
  if(!offeringsFromDb){
    noteEl.textContent = 'Editing is disabled until the offering_types table is created in the database — ask your developer to run the one-time setup SQL, then this list becomes editable here.';
    addBtn.disabled = true;
  } else {
    noteEl.textContent = 'Add, rename or remove offering types. Changes apply to every entry form, export sheet and audit record immediately.';
    addBtn.disabled = false;
  }
  list.querySelectorAll('.dc-more-btn').forEach(b=> b.addEventListener('click', (ev)=>{
    ev.stopPropagation();
    const menu = document.getElementById(b.dataset.menu);
    const wasOpen = menu.classList.contains('show');
    closeAllDcMenus();
    if(!wasOpen) menu.classList.add('show');
  }));
  list.querySelectorAll('.dc-menu-item').forEach(b=> b.addEventListener('click', async (ev)=>{
    ev.stopPropagation();
    closeAllDcMenus();
    const key = b.closest('.dc-menu-wrap').dataset.key;
    const off = OFFERINGS.find(o=>o.key===key);
    const statusEl = document.getElementById('offeringsStatus');
    if(b.dataset.action==='rename-offering'){
      const newLabel = await appPrompt('Enter a new name for "'+(off?off.label:key)+'".', { title:'Rename offering type', value:off?off.label:'', confirmLabel:'Rename' });
      if(!newLabel || (off && newLabel===off.label)) return;
      setStatus(statusEl,'Saving…', false);
      const { error } = await supabase.from('offering_types').update({ label: newLabel }).eq('key', key);
      if(error){ setStatus(statusEl, error.message, true); return; }
      setStatus(statusEl,'Renamed.', false);
    } else {
      if(!(await appConfirm('Remove offering "'+(off?off.label:key)+'"? Existing saved figures for it are kept in the database but will no longer show on the form or in new exports.', { title:'Remove offering type', confirmLabel:'Remove', danger:true }))) return;
      setStatus(statusEl,'Removing…', false);
      const { error } = await supabase.from('offering_types').delete().eq('key', key);
      if(error){ setStatus(statusEl, error.message, true); return; }
      setStatus(statusEl,'Removed.', false);
    }
    if(await loadOfferingTypes()){ buildAmountsGrid(); renderOfferingsSummary(); syncFormToSelection(); }
  }));
  refreshIcons();
}
document.getElementById('addOfferingBtn').addEventListener('click', async ()=>{
  const statusEl = document.getElementById('offeringsStatus');
  const label = document.getElementById('newOfferingLabel').value.trim();
  if(!label){ setStatus(statusEl,'Enter an offering label.', true); return; }
  const key = slugifyOfferingKey(label);
  setStatus(statusEl,'Adding…', false);
  const { error } = await supabase.from('offering_types').insert({ key, label, sort_order: OFFERINGS.length });
  if(error){ setStatus(statusEl, error.message, true); return; }
  document.getElementById('newOfferingLabel').value='';
  setStatus(statusEl,'Added.', false);
  if(await loadOfferingTypes()){ buildAmountsGrid(); renderOfferingsSummary(); syncFormToSelection(); }
});
function startOfferingsRealtime(){
  if(!supabase || offeringsChannel) return;
  offeringsChannel = supabase.channel('offering-types-changes')
    .on('postgres_changes', {event:'*', schema:'public', table:'offering_types'}, async ()=>{
      if(await loadOfferingTypes()){ buildAmountsGrid(); renderOfferingsSummary(); syncFormToSelection(); }
    })
    .subscribe();
}

/* ============================================================
   PROFILE (incl. own district progress)
   ============================================================ */
function loadProfileTab(){
  document.getElementById('profileName').value = currentUser.full_name || '';
  document.getElementById('profilePhone').value = currentUser.phone || '';
  document.getElementById('profileRole').value = roleLabel(currentUser.role);
  document.getElementById('profileStatus').value = currentUser.status; renderOwnAvatars();
  const chips = document.getElementById('profileDistrictChips'); chips.innerHTML='';
  const names = myScope === 'all' ? ['All districts'] : myScope;
  if(!names.length){ chips.innerHTML = '<span class="note">No districts assigned yet.</span>'; }
  else names.forEach(d=>{ const c=document.createElement('span'); c.className='district-chip selected rounded-sm px-3 py-1.5 text-xs font-medium border'; c.textContent=d; chips.appendChild(c); });
  renderProgressInto('myProgressBody','myProgressFill','myProgressLabel', scopedDistrictNames());
  const isSuperAdmin = currentUser.role === 'super_admin';
  document.getElementById('saEmailCard').style.display = isSuperAdmin ? 'block' : 'none';
}
document.getElementById('saveProfileBtn').addEventListener('click', async ()=>{
  const statusEl = document.getElementById('profileStatusLine');
  const full_name = document.getElementById('profileName').value.trim();
  const phone = document.getElementById('profilePhone').value.trim();
  const { error } = await supabase.from('profiles').update({ full_name, phone }).eq('id', currentUser.id);
  if(error){ setStatus(statusEl, error.message, true); return; }
  currentUser.full_name = full_name; currentUser.phone = phone;
  document.getElementById('chipName').textContent = full_name; renderOwnAvatars();
  setStatus(statusEl, 'Saved.', false);
});
document.getElementById('changePwBtn').addEventListener('click', async ()=>{
  const statusEl = document.getElementById('pwStatusLine');
  const pw = document.getElementById('pwNew').value;
  const pw2 = document.getElementById('pwConfirm').value;
  if(pw.length < 8){ setStatus(statusEl,'Password must be at least 8 characters.', true); return; }
  if(pw !== pw2){ setStatus(statusEl,'Passwords do not match.', true); return; }
  const { error } = await supabase.auth.updateUser({ password: pw });
  if(error){ setStatus(statusEl, error.message, true); return; }
  document.getElementById('pwNew').value=''; document.getElementById('pwConfirm').value='';
  setStatus(statusEl, 'Password updated.', false);
});

/* ---------------- Super Admin: change own email ---------------- */
document.getElementById('saChangeEmailBtn').addEventListener('click', async ()=>{
  const statusEl = document.getElementById('saEmailStatusLine');
  const email = document.getElementById('saNewEmail').value.trim();
  if(!email){ setStatus(statusEl,'Enter a new email address.', true); return; }
  setStatus(statusEl,'Sending confirmation…', false);
  const { error } = await supabase.auth.updateUser({ email });
  setStatus(statusEl, error ? error.message : ('Confirmation link sent to '+email+'. Your email changes once you click it.'), !!error);
});

/* ============================================================
   EXPORT WORKBOOKS
   ============================================================ */
function monthRange(){
  const fi = MONTHS.indexOf(rangeFrom.value), ti = MONTHS.indexOf(rangeTo.value);
  if(fi===-1||ti===-1||fi>ti) return [];
  return MONTHS.slice(fi, ti+1);
}
function colLetter(n){ let s=''; while(n>0){ const m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=Math.floor((n-1)/26); } return s; }

/* ---------------- SunPlus vs Management bucket grouping (per OFFERING FIELD) ----------------
   Management: every value groups into its OWN entry's month/year, always — ignores lateFields.
   SunPlus: a field groups into lateFields[key]'s reportedMonth/reportedYear if tagged late;
   otherwise same as management. Grouping happens per field, so a single bucket can be fed by
   individual fields pulled from more than one entry — sum contributions, never a 1:1 cell lookup.
   Buckets are always rebuilt fresh from raw entries at export time; nothing is pre-grouped/persisted. */
function effectiveBucketFor(mode, entry, offeringKey){
  let month = entry.month, year = entry.year;
  if(mode==='sunplus' && entry.lateFields && entry.lateFields[offeringKey]){
    month = entry.lateFields[offeringKey].reportedMonth;
    year = entry.lateFields[offeringKey].reportedYear;
  }
  return entry.district+'|'+entry.church+'|'+month+'|'+year;
}
function buildModeBuckets(mode, districtNames){
  const buckets = {};
  const distSet = new Set(districtNames);
  Object.values(state).forEach(entry=>{
    if(!entry || !entry.district || !distSet.has(entry.district)) return;
    OFFERINGS.forEach(o=>{
      const val = entryOfferingValue(entry, o.key);
      const bKey = effectiveBucketFor(mode, entry, o.key);
      if(!buckets[bKey]) buckets[bKey] = {};
      buckets[bKey][o.key] = (buckets[bKey][o.key]||0) + val;
    });
  });
  return buckets;
}
function bucketValue(buckets, district, church, month, year, key){
  const b = buckets[district+'|'+church+'|'+month+'|'+year];
  return (b && b[key]) ? b[key] : 0;
}
// Self-check, not just an assumption: for every non-late field, both modes must place it in its
// OWN entry's natural (district, church, month, year) bucket, unchanged — checked directly
// against the raw entry (not by trusting buildModeBuckets itself), so a bug in the grouping
// logic gets caught rather than silently producing a bad workbook.
function verifyExportParity(districtNames){
  const distSet = new Set(districtNames);
  const mismatches = [];
  Object.values(state).forEach(entry=>{
    if(!entry || !entry.district || !distSet.has(entry.district)) return;
    const natural = entry.district+'|'+entry.church+'|'+entry.month+'|'+entry.year;
    OFFERINGS.forEach(o=>{
      if(entry.lateFields && entry.lateFields[o.key]) return; // late fields are meant to diverge
      const sunTarget = effectiveBucketFor('sunplus', entry, o.key);
      const mgmtTarget = effectiveBucketFor('management', entry, o.key);
      if(sunTarget!==natural || mgmtTarget!==natural){
        mismatches.push(entry.district+'/'+entry.church+'/'+entry.month+' '+entry.year+' — '+o.label+
          ' (SunPlus target '+sunTarget+', Management target '+mgmtTarget+', expected '+natural+')');
      }
    });
  });
  if(mismatches.length){
    throw new Error('Export parity check failed for '+mismatches.length+' field(s), export blocked:\n' + mismatches.join('\n'));
  }
}

// Columns for a per-church row: Church(1) SerialNo(2) offerings(3..3+N-1) Total(3+N)
const N_OFF = OFFERINGS.length;

function styleHeaderRow(row){
  row.eachCell(c=>{ c.font = {bold:true, color:{argb:'FF163A5A'}}; c.fill = {type:'pattern', pattern:'solid', fgColor:{argb:'FFEFF2F6'}};
    c.border = {bottom:{style:'thin', color:{argb:'FFDFE3E8'}}}; });
}
function addMonthBlockHeader(ws, colCount, text){
  const r = ws.addRow([text]);
  ws.mergeCells(r.number,1,r.number,colCount);
  r.getCell(1).font = {bold:true, size:12, color:{argb:'FF163A5A'}};
  return r;
}
function styleHeaderRange(ws, rowNum, startCol, colCount){
  for(let i=0;i<colCount;i++){
    const c = ws.getRow(rowNum).getCell(startCol+i);
    c.font = {bold:true, color:{argb:'FF163A5A'}};
    c.fill = {type:'pattern', pattern:'solid', fgColor:{argb:'FFEFF2F6'}};
    c.border = {bottom:{style:'thin', color:{argb:'FFDFE3E8'}}};
  }
}
function writeRowAt(ws, rowNum, startCol, values){
  const row = ws.getRow(rowNum);
  values.forEach((v,i)=>{ row.getCell(startCol+i).value = v; });
  return row;
}
function headerLabelsByMonth(){ return ['Church','Serial No', ...OFFERINGS.map(o=>o.label), 'Total']; }
function headerLabelsByChurch(){ return ['Month','Serial No', ...OFFERINGS.map(o=>o.label), 'Total']; }
function headerLabelsCumulative(){ return ['Church', ...OFFERINGS.map(o=>o.label), 'Total']; }
function entryOfferingValue(entry, key){ return (entry && entry[key]!==null && entry[key]!==undefined && entry[key]!=='') ? Number(entry[key]) : 0; }

const NUM_FMT = '#,##0';
const BLACK = {argb:'FF000000'};
const SERIAL_RED = {argb:'FFA63232'};

function styleFigureCell(cell, opts){
  cell.font = Object.assign({color: BLACK}, opts && opts.bold ? {bold:true} : {});
  cell.numFmt = NUM_FMT;
}
function styleSerialCell(cell){
  cell.font = {color: SERIAL_RED, bold:true}; // serial numbers: red, no thousand separator
}
const BORDER_LINE = {style:'thin', color:{argb:'FFB9C2CC'}};
function addBoxBorder(ws, rowStart, colStart, rowEnd, colEnd){
  for(let r=rowStart; r<=rowEnd; r++){
    for(let c=colStart; c<=colEnd; c++){
      const cell = ws.getRow(r).getCell(c);
      cell.border = Object.assign({}, cell.border, {
        top: BORDER_LINE, left: BORDER_LINE, bottom: BORDER_LINE, right: BORDER_LINE
      });
    }
  }
}

// Reporting-template layout: three linked tables placed side by side, each one FED BY FORMULA from the previous —
//   Table 1 (left):    one block per MONTH, rows = churches   — the only manually-entered data
//   Table 2 (middle):  one block per CHURCH, rows = months    — every cell is a formula pointing at Table 1
//   Table 3 (right):   one cumulative block, rows = churches  — every cell is a formula pointing at Table 2
// Editing a figure in Table 1 automatically ripples through Table 2 and Table 3 — no other data needs re-entry.
function buildDistrictSheet(ws, districtName, churches, months, year, mode, buckets){
  const w1 = N_OFF + 3; // Church, Serial No, offerings..., Total
  const w2 = N_OFF + 3; // Month,  Serial No, offerings..., Total
  const w3 = N_OFF + 2; // Church, offerings..., Total
  const gap = 2;
  const col1 = 1;
  const col2 = col1 + w1 + gap;
  const col3 = col2 + w2 + gap;
  const totalCols = col3 + w3 - 1;

  // Title, spanning the full width of all three tables
  ws.mergeCells(1, 1, 1, totalCols);
  const titleCell = ws.getRow(1).getCell(1);
  titleCell.value = districtName.toUpperCase() + ' — FINANCIAL REPORTING (' + (mode==='sunplus'?'SUNPLUS':'MANAGEMENT') + ', ' + year + ')';
  titleCell.font = {bold:true, size:14, color:{argb:'FF163A5A'}};

  // Legend
  ws.mergeCells(2, 1, 2, totalCols);
  const legendCell = ws.getRow(2).getCell(1);
  legendCell.value = 'Enter figures only in the "BY MONTH" table (left) — "BY CHURCH" and "CUMULATIVE SUMMARY" are formulas that update automatically.';
  legendCell.font = {italic:true, size:9, color:{argb:'FF5C6B7A'}};

  // Section captions
  ws.mergeCells(3, col1, 3, col1+w1-1);
  ws.getRow(3).getCell(col1).value = 'BY MONTH (enter data here)';
  ws.mergeCells(3, col2, 3, col2+w2-1);
  ws.getRow(3).getCell(col2).value = 'BY CHURCH (auto — linked to "By Month")';
  ws.mergeCells(3, col3, 3, col3+w3-1);
  ws.getRow(3).getCell(col3).value = 'CUMULATIVE SUMMARY ('+months[0]+' – '+months[months.length-1]+') — auto — linked to "By Church"';
  [col1,col2,col3].forEach(c=>{ const cell = ws.getRow(3).getCell(c); cell.font = {bold:true, italic:true, size:10, color:{argb:'FF5C6B7A'}}; });

  /* ---------- Table 1: by month, rows = churches (the only editable data) ---------- */
  let r = 5;
  const monthChurchRow = {}; // monthChurchRow[month][church] = row number of that church's data row in Table 1
  months.forEach(month=>{
    monthChurchRow[month] = {};
    const blockStart = r;
    ws.mergeCells(r, col1, r, col1+w1-1);
    const monthHdr = ws.getRow(r).getCell(col1);
    monthHdr.value = month.toUpperCase();
    monthHdr.font = {bold:true, size:12, color:{argb:'FF163A5A'}};
    r++;
    writeRowAt(ws, r, col1, headerLabelsByMonth());
    styleHeaderRange(ws, r, col1, w1);
    r++;
    const firstData = r;
    churches.forEach(church=>{
      // Serial number comes straight from this exact (district,church,month,year)'s own entry —
      // it's not an offering figure, so late-field bucket rerouting doesn't apply to it. The
      // offering amounts themselves come from the mode's buckets, which can be fed by more than
      // one entry (e.g. this month's own on-time figures plus a late prior-month field).
      const entry = state[keyFor(districtName, church, month, year)];
      const vals = OFFERINGS.map(o=> bucketValue(buckets, districtName, church, month, year, o.key));
      const serial = entry && entry.serialNo ? entry.serialNo : '';
      writeRowAt(ws, r, col1, [church, serial, ...vals, null]);
      monthChurchRow[month][church] = r;
      for(let i=0;i<N_OFF;i++){ styleFigureCell(ws.getRow(r).getCell(col1+2+i)); }
      const totalCell = ws.getRow(r).getCell(col1+w1-1);
      totalCell.value = { formula: 'SUM('+colLetter(col1+2)+r+':'+colLetter(col1+w1-2)+r+')' };
      styleFigureCell(totalCell, {bold:true});
      styleSerialCell(ws.getRow(r).getCell(col1+1));
      r++;
    });
    const lastData = r-1;
    writeRowAt(ws, r, col1, ['TOTAL', '', ...OFFERINGS.map(()=>null), null]);
    for(let ci=col1+2; ci<=col1+w1-1; ci++){ const L=colLetter(ci); const cell = ws.getRow(r).getCell(ci); cell.value = { formula: 'SUM('+L+firstData+':'+L+lastData+')' }; styleFigureCell(cell, {bold:true}); }
    ws.getRow(r).getCell(col1).font = {bold:true};
    addBoxBorder(ws, blockStart, col1, r, col1+w1-1);
    r += 2; // blank separator row
  });

  /* ---------- Table 2: by church, rows = months — every cell formula-linked to Table 1 ---------- */
  let r2 = 5;
  const churchTotalRow = {}; // churchTotalRow[church] = row number of that church's TOTAL row in Table 2
  churches.forEach(church=>{
    const blockStart = r2;
    ws.mergeCells(r2, col2, r2, col2+w2-1);
    const churchHdr = ws.getRow(r2).getCell(col2);
    churchHdr.value = church.toUpperCase();
    churchHdr.font = {bold:true, size:12, color:{argb:'FF163A5A'}};
    r2++;
    writeRowAt(ws, r2, col2, headerLabelsByChurch());
    styleHeaderRange(ws, r2, col2, w2);
    r2++;
    const firstData = r2;
    months.forEach(month=>{
      const srcRow = monthChurchRow[month][church]; // row in Table 1 holding this church's figures for this month
      const row = ws.getRow(r2);
      row.getCell(col2).value = month;
      const serialCell = row.getCell(col2+1);
      serialCell.value = { formula: colLetter(col1+1)+srcRow };
      styleSerialCell(serialCell);
      for(let i=0;i<N_OFF;i++){
        const cell = row.getCell(col2+2+i);
        cell.value = { formula: colLetter(col1+2+i)+srcRow };
        styleFigureCell(cell);
      }
      const totalCell = row.getCell(col2+w2-1);
      totalCell.value = { formula: 'SUM('+colLetter(col2+2)+r2+':'+colLetter(col2+w2-2)+r2+')' };
      styleFigureCell(totalCell, {bold:true});
      r2++;
    });
    const lastData = r2-1;
    writeRowAt(ws, r2, col2, ['TOTAL', '', ...OFFERINGS.map(()=>null), null]);
    for(let ci=col2+2; ci<=col2+w2-1; ci++){ const L=colLetter(ci); const cell = ws.getRow(r2).getCell(ci); cell.value = { formula: 'SUM('+L+firstData+':'+L+lastData+')' }; styleFigureCell(cell, {bold:true}); }
    ws.getRow(r2).getCell(col2).font = {bold:true};
    addBoxBorder(ws, blockStart, col2, r2, col2+w2-1);
    churchTotalRow[church] = r2;
    r2 += 2;
  });

  /* ---------- Table 3: cumulative summary, rows = churches — every cell formula-linked to Table 2 ---------- */
  let r3 = 5;
  writeRowAt(ws, r3, col3, headerLabelsCumulative());
  styleHeaderRange(ws, r3, col3, w3);
  r3++;
  const firstSum = r3;
  churches.forEach(church=>{
    const srcRow = churchTotalRow[church]; // that church's TOTAL row in Table 2 (already summed across the selected months)
    const row = ws.getRow(r3);
    row.getCell(col3).value = church;
    for(let i=0;i<N_OFF;i++){
      const cell = row.getCell(col3+1+i);
      cell.value = { formula: colLetter(col2+2+i)+srcRow };
      styleFigureCell(cell);
    }
    const totalCell = row.getCell(col3+w3-1);
    totalCell.value = { formula: 'SUM('+colLetter(col3+1)+r3+':'+colLetter(col3+w3-2)+r3+')' };
    styleFigureCell(totalCell, {bold:true});
    r3++;
  });
  const lastSum = r3-1;
  writeRowAt(ws, r3, col3, ['DISTRICT TOTAL', ...OFFERINGS.map(()=>null), null]);
  for(let ci=col3+1; ci<=col3+w3-1; ci++){ const L=colLetter(ci); const cell = ws.getRow(r3).getCell(ci); cell.value = { formula: 'SUM('+L+firstSum+':'+L+lastSum+')' }; styleFigureCell(cell, {bold:true}); cell.fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FFFFF2CC'}}; }
  ws.getRow(r3).getCell(col3).font = {bold:true};
  ws.getRow(r3).getCell(col3).fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FFFFF2CC'}};
  addBoxBorder(ws, 5, col3, r3, col3+w3-1);

  // Column widths: name columns wider, offering/gap columns narrower
  const nameCols = new Set([col1, col2, col3]);
  const gapCols = new Set();
  for(let c=col1+w1; c<col2; c++) gapCols.add(c);
  for(let c=col2+w2; c<col3; c++) gapCols.add(c);
  for(let i=1;i<=totalCols;i++){
    const col = ws.getColumn(i);
    if(nameCols.has(i)) col.width = 22;
    else if(gapCols.has(i)) col.width = 3;
    else col.width = 13;
  }
}

function sheetNameFor(district, used){
  let base = district.replace(/DISTRICT/i,'').trim();
  base = base.replace(/[\\\/\?\*\[\]:]/g,'').substring(0,28).trim() || 'District';
  let name = base, n=1;
  while(used.has(name)){ n++; name = (base.substring(0,28-String(n).length-1))+'_'+n; }
  used.add(name);
  return name;
}

async function downloadWorkbook(wb, filenameBase){
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const url = URL.createObjectURL(blob);
  const fileName = filenameBase+'_'+new Date().toISOString().slice(0,10)+'.xlsx';
  const a = document.createElement('a'); a.href=url; a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  return fileName;
}

function modeLabel(mode){ return mode==='sunplus' ? 'SunPlus' : 'Management'; }

async function runExport(statusEl, fn){
  const btns = Array.from(document.querySelectorAll('#tab-export .gen-row'));
  btns.forEach(b=> b.disabled = true);
  try{
    const fileName = await fn();
    if(fileName) pushRecentExport(fileName);
    setStatus(statusEl, 'Downloaded '+(fileName||'')+'.', false);
  }
  catch(e){ console.error(e); setStatus(statusEl, e.message || 'Export failed.', true); }
  finally{ btns.forEach(b=> b.disabled = false); }
}

/* ---------------- Basis selector + recent exports (this device only) ---------------- */
let exportBasis = 'management';
function recentExportsKey(){ return 'starsys_recent_exports_'+(currentUser ? currentUser.id : ''); }
function readRecentExports(){
  try{ const v = JSON.parse(localStorage.getItem(recentExportsKey()) || '[]'); return Array.isArray(v) ? v : []; }catch(e){ return []; }
}
function pushRecentExport(name){
  const list = readRecentExports();
  list.unshift({ name, ts: new Date().toISOString() });
  try{ localStorage.setItem(recentExportsKey(), JSON.stringify(list.slice(0,5))); }catch(e){}
  renderRecentExports();
}
function renderRecentExports(){
  const el = document.getElementById('recentExportsList'); if(!el) return;
  const list = readRecentExports();
  if(!list.length){ el.innerHTML = '<p class="note py-2">No exports yet on this device.</p>'; return; }
  el.innerHTML = list.map(x=> '<div class="recent-row"><span class="tick">✓</span><span class="fname" title="'+esc(x.name)+'">'+esc(x.name)+'</span><span class="when">'+esc(timeAgo(x.ts))+'</span></div>').join('');
}
function setExportBasis(b){
  exportBasis = (b === 'sunplus') ? 'sunplus' : 'management';
  document.querySelectorAll('#basisGroup .basis-card').forEach(c=>{
    const on = c.dataset.basis === exportBasis;
    c.classList.toggle('selected', on);
    const r = c.querySelector('input[type=radio]'); if(r) r.checked = on;
  });
  const lbl = document.getElementById('basisLabel'); if(lbl) lbl.textContent = modeLabel(exportBasis);
}
document.querySelectorAll('#basisGroup input[type=radio]').forEach(r=> r.addEventListener('change', ()=> setExportBasis(r.value)));
setExportBasis('management');
renderRecentExports();

async function exportOneDistrict(mode){
  const statusEl = document.getElementById('exportStatus');
  const d = exportDistrict.value;
  if(!d){ setStatus(statusEl,'Select a district to export.', true); return; }
  if(!inMyScope(d)){ setStatus(statusEl,'That district is outside your access.', true); return; }
  const months = monthRange();
  if(!months.length){ setStatus(statusEl,'Invalid month range.', true); return; }
  const year = exportYear.value;
  await runExport(statusEl, async ()=>{
    verifyExportParity([d]);
    const buckets = buildModeBuckets(mode, [d]);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(sheetNameFor(d, new Set()));
    buildDistrictSheet(ws, d, scopedChurches(d), months, year, mode, buckets);
    return await downloadWorkbook(wb, 'Starsys_'+slug(d)+'_'+modeLabel(mode)+'_'+year);
  });
}
async function exportAllDistricts(mode){
  const statusEl = document.getElementById('exportStatus');
  const months = monthRange();
  if(!months.length){ setStatus(statusEl,'Invalid month range.', true); return; }
  const year = exportYear.value;
  const districtNames = scopedDistrictNames();
  await runExport(statusEl, async ()=>{
    verifyExportParity(districtNames);
    const buckets = buildModeBuckets(mode, districtNames);
    const wb = new ExcelJS.Workbook();
    const used = new Set();
    districtNames.forEach(d=>{
      const ws = wb.addWorksheet(sheetNameFor(d, used));
      buildDistrictSheet(ws, d, scopedChurches(d), months, year, mode, buckets);
    });
    return await downloadWorkbook(wb, 'Starsys_All_Districts_'+modeLabel(mode)+'_'+year);
  });
}
async function exportCumulative(mode){
  const statusEl = document.getElementById('exportStatus');
  const months = monthRange();
  if(!months.length){ setStatus(statusEl,'Invalid month range.', true); return; }
  const year = exportYear.value;
  const districtNames = scopedDistrictNames();
  await runExport(statusEl, async ()=>{
    verifyExportParity(districtNames);
    const buckets = buildModeBuckets(mode, districtNames);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Cumulative');
    const colCount = 1 + N_OFF + 1;
    const titleRow = ws.addRow(['STARSYS — CUMULATIVE OFFERTORY REPORT (ALL DISTRICTS) — '+modeLabel(mode).toUpperCase()+' — '+year]);
    ws.mergeCells(titleRow.number,1,titleRow.number,colCount);
    titleRow.getCell(1).font = {bold:true, size:14, color:{argb:'FF163A5A'}};
    ws.addRow([]);
    addMonthBlockHeader(ws, colCount, 'BY MONTH ('+months[0]+' – '+months[months.length-1]+')');
    const hdr = ws.addRow(['Month', ...OFFERINGS.map(o=>o.label), 'Total']);
    styleHeaderRow(hdr);
    const firstRow = hdr.number+1;
    months.forEach(month=>{
      let sums = OFFERINGS.map(()=>0);
      districtNames.forEach(d=> scopedChurches(d).forEach(c=>{
        OFFERINGS.forEach((o,i)=>{ sums[i]+= bucketValue(buckets, d, c, month, year, o.key); });
      }));
      const row = ws.addRow([month, ...sums, null]);
      row.getCell(colCount).value = { formula: 'SUM('+colLetter(2)+row.number+':'+colLetter(colCount-1)+row.number+')' };
    });
    const lastRow = firstRow + months.length - 1;
    const grand = ws.addRow(['GRAND TOTAL', ...OFFERINGS.map(()=>null), null]);
    for(let cIdx=2; cIdx<=colCount; cIdx++){ const L=colLetter(cIdx); grand.getCell(cIdx).value = { formula:'SUM('+L+firstRow+':'+L+lastRow+')' }; }
    grand.eachCell(c=>{ c.font={bold:true}; c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFF2CC'}}; });
    ws.addRow([]);

    addMonthBlockHeader(ws, colCount, 'BY DISTRICT ('+months[0]+' – '+months[months.length-1]+')');
    const hdr2 = ws.addRow(['District', ...OFFERINGS.map(o=>o.label), 'Total']);
    styleHeaderRow(hdr2);
    const firstRow2 = hdr2.number+1;
    districtNames.forEach(d=>{
      let sums = OFFERINGS.map(()=>0);
      scopedChurches(d).forEach(c=> months.forEach(month=>{
        OFFERINGS.forEach((o,i)=>{ sums[i]+= bucketValue(buckets, d, c, month, year, o.key); });
      }));
      const row = ws.addRow([d, ...sums, null]);
      row.getCell(colCount).value = { formula: 'SUM('+colLetter(2)+row.number+':'+colLetter(colCount-1)+row.number+')' };
    });
    const lastRow2 = firstRow2 + districtNames.length - 1;
    const grand2 = ws.addRow(['GRAND TOTAL', ...OFFERINGS.map(()=>null), null]);
    for(let cIdx=2; cIdx<=colCount; cIdx++){ const L=colLetter(cIdx); grand2.getCell(cIdx).value = { formula:'SUM('+L+firstRow2+':'+L+lastRow2+')' }; }
    grand2.eachCell(c=>{ c.font={bold:true}; c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFF2CC'}}; });

    ws.columns.forEach((col,i)=>{ col.width = i===0?26:14; });
    return await downloadWorkbook(wb, 'Starsys_Cumulative_report_'+modeLabel(mode)+'_'+year);
  });
}

document.getElementById('exportOneBtn').addEventListener('click', ()=> exportOneDistrict(exportBasis));
document.getElementById('exportAllBtn').addEventListener('click', ()=> exportAllDistricts(exportBasis));
document.getElementById('exportCumulativeBtn').addEventListener('click', ()=> exportCumulative(exportBasis));


/* ============================================================
   OWN AVATAR / PROFILE PHOTO
   Saved to profiles.avatar_url (shared everywhere) when that column exists;
   otherwise kept on this device so the feature still works.
   ============================================================ */
function renderOwnAvatars(){
  if(!currentUser) return;
  const url = avatarUrlFor(currentUser);
  const chip = document.getElementById('chipAvatar');
  if(chip) chip.innerHTML = avatarHTML(currentUser.full_name, 'md', url);
  const big = document.getElementById('profileAvatarPreview');
  if(big) big.innerHTML = avatarHTML(currentUser.full_name, 'xl', url);
}
function resizeImageToDataUrl(file, max){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onerror = ()=> reject(new Error('Could not read that file.'));
    reader.onload = ()=>{
      const img = new Image();
      img.onerror = ()=> reject(new Error('That file is not a valid image.'));
      img.onload = ()=>{
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side)/2, sy = (img.height - side)/2;
        const canvas = document.createElement('canvas'); canvas.width = max; canvas.height = max;
        canvas.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, max, max);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
async function saveAvatar(dataUrl){ // dataUrl === null removes the photo; resolves 'cloud' or 'device'
  const { error } = await supabase.from('profiles').update({ avatar_url: dataUrl }).eq('id', currentUser.id);
  if(!error){
    currentUser.avatar_url = dataUrl;
    try{ localStorage.removeItem(localAvatarKey(currentUser.id)); }catch(e){}
    return 'cloud';
  }
  console.warn('avatar_url could not be saved to profiles, keeping it on this device:', error.message);
  try{
    if(dataUrl) localStorage.setItem(localAvatarKey(currentUser.id), dataUrl);
    else localStorage.removeItem(localAvatarKey(currentUser.id));
  }catch(e){ throw new Error('Could not save the photo on this device (storage is full or blocked).'); }
  currentUser.avatar_url = null;
  return 'device';
}
(function(){
  const input = document.getElementById('avatarFileInput');
  const upBtn = document.getElementById('avatarUploadBtn');
  const rmBtn = document.getElementById('avatarRemoveBtn');
  const prev = document.getElementById('profileAvatarPreview');
  const statusEl = document.getElementById('avatarStatusLine');
  function syncCaches(){
    const me = usersCache.find(x=> x.id === currentUser.id);
    if(me) me.avatar_url = currentUser.avatar_url || null;
    renderOwnAvatars();
  }
  upBtn.addEventListener('click', ()=> input.click());
  prev.style.cursor = 'pointer';
  prev.addEventListener('click', ()=> input.click());
  input.addEventListener('change', async ()=>{
    const file = input.files && input.files[0]; input.value = '';
    if(!file) return;
    if(!/^image\//.test(file.type)){ setStatus(statusEl, 'Please choose an image file.', true); return; }
    if(file.size > 15*1024*1024){ setStatus(statusEl, 'That image is too large (max 15 MB).', true); return; }
    setStatus(statusEl, 'Uploading\u2026', false);
    try{
      const dataUrl = await resizeImageToDataUrl(file, 320);
      const where = await saveAvatar(dataUrl);
      syncCaches();
      setStatus(statusEl, where === 'cloud' ? 'Photo updated.' : 'Photo updated on this device. Ask your administrator to add the avatar_url column so it shows everywhere.', false);
    }catch(e){ setStatus(statusEl, e.message || 'Upload failed.', true); }
  });
  rmBtn.addEventListener('click', async ()=>{
    setStatus(statusEl, 'Removing\u2026', false);
    try{ await saveAvatar(null); syncCaches(); setStatus(statusEl, 'Photo removed.', false); }
    catch(e){ setStatus(statusEl, e.message || 'Could not remove photo.', true); }
  });
})();

/* ---------------- Sidebar: profile chip + logo are real buttons ---------------- */
(function(){
  const chip = document.getElementById('profileChip');
  function goToProfile(){ activateTab('tab-admin'); activateAdminSubtab('profile'); }
  chip.addEventListener('click', ev=>{ if(ev.target.closest('#logoutBtn')) return; goToProfile(); });
  chip.addEventListener('keydown', ev=>{
    if(ev.key !== 'Enter' && ev.key !== ' ') return;
    if(ev.target.closest('#logoutBtn')) return;
    ev.preventDefault(); goToProfile();
  });
  const sideLogo = document.querySelector('#sidebar .starsys-logo');
  if(sideLogo && sideLogo.parentElement){
    const wrap = sideLogo.parentElement;
    wrap.style.cursor = 'pointer'; wrap.title = 'Go to home';
    wrap.addEventListener('click', ()=>{
      const first = document.querySelector('#mainTabs .nav-link:not(.hidden)');
      if(first) activateTab('tab-'+first.dataset.tab);
    });
  }
})();

/* ============================================================
   NOTIFICATIONS — built from live data (no extra table needed):
   pending approvals (admins), recent saved entries, and a reminder
   for last month's missing reports within the user's scope.
   ============================================================ */
let notifItems = [];
function notifSeenKey(){ return 'starsys_notif_seen_'+(currentUser ? currentUser.id : ''); }
function notifSeenAt(){ try{ return Number(localStorage.getItem(notifSeenKey())) || 0; }catch(e){ return 0; } }
function markNotifsSeen(){ try{ localStorage.setItem(notifSeenKey(), String(Date.now())); }catch(e){} }
function timeAgo(iso){
  const t = new Date(iso).getTime(); if(!t) return '';
  const diff = Math.max(0, Date.now() - t), min = Math.floor(diff/60000);
  if(min < 1) return 'just now';
  if(min < 60) return min+' min ago';
  const hr = Math.floor(min/60); if(hr < 24) return hr+' hr ago';
  const day = Math.floor(hr/24); if(day < 30) return day+' day'+(day===1?'':'s')+' ago';
  return new Date(iso).toLocaleDateString();
}
function missingReportsReminder(){
  const now = new Date(); let mi = now.getMonth()-1, yr = now.getFullYear();
  if(mi < 0){ mi = 11; yr--; }
  if(yr < FIRST_YEAR) return null;
  const month = MONTHS[mi]; let missing = 0;
  scopedDistrictNames().forEach(d=> scopedChurches(d).forEach(c=>{
    if(entryStatus(state[keyFor(d,c,month,yr)]) !== 'Entered') missing++;
  }));
  if(!missing) return null;
  return {
    id: 'missing-'+month+yr, ts: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), icon: 'alert-triangle',
    title: missing+' church'+(missing===1?' has':'es have')+' no '+month+' '+yr+' report',
    sub: 'Open Data Entry to fill or catch up', action: ()=> activateTab('tab-entry')
  };
}
async function buildNotifications(){
  const items = [];
  if(!currentUser || !supabase) return items;
  if(currentUser.role === 'admin' || currentUser.role === 'super_admin'){
    const { data } = await supabase.from('profiles').select('id,full_name,created_at').eq('status','pending_approval').order('created_at',{ascending:false});
    (data||[]).forEach(p=> items.push({
      id: 'pending-'+p.id, ts: p.created_at, icon: 'user-plus',
      title: p.full_name+' is awaiting approval', sub: 'Open Users to approve and assign districts',
      action: ()=>{ activateTab('tab-admin'); activateAdminSubtab('users'); }
    }));
  }
  const { data: aud } = await supabase.from('audit').select('*').order('ts',{ascending:false}).limit(8);
  (aud||[]).filter(a=> inMyScope(a.district)).forEach(a=> items.push({
    id: 'audit-'+a.ts+'-'+(a.church||''), ts: a.ts, icon: 'pen-line',
    title: (a.name||'Someone')+' saved '+(a.church||'a church')+' \u00b7 '+(a.month||'')+' '+(a.year||''),
    sub: (a.district||'')+' \u00b7 '+formatWithCommas(String(Math.round(Number(a.total)||0)))+' UGX',
    action: ()=> activateTab('tab-entry')
  }));
  const rem = missingReportsReminder(); if(rem) items.push(rem);
  items.sort((a,b)=> new Date(b.ts) - new Date(a.ts));
  return items.slice(0, 12);
}
function renderNotifPanel(seenAt){
  const list = document.getElementById('notifList'); list.innerHTML = '';
  if(!notifItems.length){ list.innerHTML = '<p class="note p-5">You\u2019re all caught up \u2014 nothing new right now.</p>'; return; }
  notifItems.forEach(n=>{
    const unseen = new Date(n.ts).getTime() > seenAt;
    const btn = document.createElement('button');
    btn.className = 'w-full text-left flex items-start gap-3 px-5 py-3 table-row';
    btn.innerHTML = '<span class="w-8 h-8 rounded-full bg-ink-900 dark:bg-ink-800 flex items-center justify-center flex-shrink-0"><i data-lucide="'+n.icon+'" class="w-3.5 h-3.5 text-gold-400"></i></span>'
      + '<div class="min-w-0 flex-1"><p class="text-xs font-medium dark:text-paper">'+esc(n.title)+'</p><p class="text-[0.625rem] text-ink-500 mt-0.5">'+esc(n.sub)+'</p><p class="text-[0.625rem] text-ink-400 mt-0.5">'+esc(timeAgo(n.ts))+'</p></div>'
      + (unseen ? '<span class="w-1.5 h-1.5 bg-gold-500 rounded-full mt-1.5 flex-shrink-0"></span>' : '');
    btn.addEventListener('click', ()=>{ closeNotifPanel(); n.action(); });
    list.appendChild(btn);
  });
  refreshIcons();
}
async function refreshNotifications(){
  try{ notifItems = await buildNotifications(); }catch(e){ console.error(e); notifItems = []; }
  const seen = notifSeenAt();
  const dot = document.getElementById('notifDot');
  if(dot) dot.style.display = notifItems.some(n=> new Date(n.ts).getTime() > seen) ? 'block' : 'none';
}
function closeNotifPanel(){ document.getElementById('notifPanel').classList.add('hidden'); }
async function toggleNotifPanel(){
  const panel = document.getElementById('notifPanel');
  if(!panel.classList.contains('hidden')){ closeNotifPanel(); return; }
  panel.classList.remove('hidden');
  document.getElementById('notifList').innerHTML = '<p class="note p-5">Loading\u2026</p>';
  const seen = notifSeenAt();
  try{ notifItems = await buildNotifications(); }catch(e){ console.error(e); notifItems = []; }
  renderNotifPanel(seen);
  markNotifsSeen();
  const dot = document.getElementById('notifDot'); if(dot) dot.style.display = 'none';
}
document.getElementById('notifBtn').addEventListener('click', ev=>{ ev.stopPropagation(); toggleNotifPanel(); });
document.getElementById('notifPanel').addEventListener('click', ev=> ev.stopPropagation());
document.getElementById('notifMarkRead').addEventListener('click', ()=>{
  markNotifsSeen(); renderNotifPanel(Date.now());
  const dot = document.getElementById('notifDot'); if(dot) dot.style.display = 'none';
});
document.addEventListener('click', ()=> closeNotifPanel());
document.addEventListener('keydown', ev=>{ if(ev.key === 'Escape') closeNotifPanel(); });
setInterval(()=>{ if(currentUser) refreshNotifications(); }, 90000);

/* ---------------- kick everything off ---------------- */
bootstrap();
