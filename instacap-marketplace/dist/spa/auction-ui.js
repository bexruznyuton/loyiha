/* Auksion UI — "Akkauntlar" sarlavhasi o'rniga 2 ta tab: Akkaunt | Auksion */
(function () {
  'use strict';
  if (window.__aucLoaded) return;
  window.__aucLoaded = true;

  var tg = (window.Telegram && window.Telegram.WebApp) || null;
  var S = { mode: 'acc', sub: 'active', me: null, items: [], my: null, admin: [], offset: 0, loading: false, sheet: null, timer: null, poll: null };
  try { if (sessionStorage.getItem('auc_mode') === 'auc') S.mode = 'auc'; } catch (e) {}

  // Oyna (sheet) ochiq bo'lsa, Telegram "orqaga" tugmasi faqat oynani yopadi — ilova sahifasidan chiqib ketmaydi
  (function guardBack() {
    if (!tg) return;
    function wrap(fn) {
      if (typeof fn !== 'function' || fn === backHandler || fn.__aucOwn) return fn;
      if (fn.__aucw) return fn.__aucw;
      if (fn.__aucIsWrap) return fn;
      var w = function () { if (S.sheet || S.swallowBack || (window.__aucFS && window.__aucFS.on)) return; return fn.apply(this, arguments); };
      w.__aucIsWrap = true;
      fn.__aucw = w;
      return w;
    }
    function unwrap(fn) { return (fn && fn.__aucw) || fn; }
    try {
      var BB = tg.BackButton;
      if (BB && !BB.__aucPatched) {
        var on = BB.onClick, off = BB.offClick;
        BB.onClick = function (fn) { return on.call(BB, wrap(fn)); };
        BB.offClick = function (fn) { return off.call(BB, unwrap(fn)); };
        BB.__aucPatched = true;
      }
      if (!tg.__aucPatched) {
        var onE = tg.onEvent, offE = tg.offEvent;
        tg.onEvent = function (ev, fn) { return onE.call(tg, ev, ev === 'backButtonClicked' ? wrap(fn) : fn); };
        tg.offEvent = function (ev, fn) { return offE.call(tg, ev, ev === 'backButtonClicked' ? unwrap(fn) : fn); };
        tg.__aucPatched = true;
      }
    } catch (e) {}
  })();

  // ---------- yordamchilar ----------
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    (Array.isArray(kids) ? kids : kids == null ? [] : [kids]).forEach(function (c) {
      if (c == null || c === false) return;
      el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return el;
  }
  // ---------- Premium emoji (animatsiyali rasm) ----------
  var EMO = { '🔨': 'gavel', '🛡': 'shield', '🏆': 'trophy', '👑': 'crown', '📈': 'trend', '📎': 'clip', '📷': 'camera', '⏱': 'timer', '✅': 'check', '⚠': 'alert', '🥇': 'medal', '📭': 'inbox', '🏁': 'flag', '📦': 'package', 'ℹ': 'info', '🗑': 'trash', '💰': 'money', '📄': 'file' };
  var ICO = {
    gavel: '<path d="m14.5 12.5-8 8a2.119 2.119 0 1 1-3-3l8-8"/><path d="m16 16 6-6"/><path d="m8 8 6-6"/><path d="m9 7 8 8"/><path d="m21 11-8-8"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
    trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    crown: '<path fill="#f5c542" stroke="#a4720a" d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/><path stroke="#a4720a" d="M5 21h14"/>',
    trend: '<path d="M22 7 13.5 15.5 8.5 10.5 2 17"/><path d="M16 7h6v6"/>',
    clip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
    timer: '<path d="M10 2h4"/><path d="M12 14l3-3"/><circle cx="12" cy="14" r="8"/>',
    check: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    medal: '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
    package: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>',
    money: '<path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>'
  };
  var EMO_RE = new RegExp('(' + Object.keys(EMO).join('|') + ')️?\\s?', 'g');
  function emoImg(ch) { var n = EMO[ch]; return '<svg class="auc-ico auc-ico-' + n + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICO[n] + '</svg>'; }
  function emoHTML(t) { return String(t).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }).replace(EMO_RE, function (m, ch) { return emoImg(ch); }); }
  function emojify(root) {
    if (!root) return;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), list = [], n;
    while ((n = w.nextNode())) { EMO_RE.lastIndex = 0; if (EMO_RE.test(n.nodeValue) && !(n.parentNode && /^(TEXTAREA|INPUT|SCRIPT|STYLE)$/.test(n.parentNode.nodeName))) list.push(n); }
    list.forEach(function (t) {
      var span = document.createElement('span');
      span.innerHTML = emoHTML(t.nodeValue);
      var frag = document.createDocumentFragment();
      while (span.firstChild) frag.appendChild(span.firstChild);
      t.parentNode.replaceChild(frag, t);
    });
  }
  function igName(it) { return /^lot_/.test(it.igUsername || '') ? 'Lot #' + it.id : '@' + it.igUsername; }
  function money(n) { return Number(n || 0).toLocaleString('ru-RU').replace(/,/g, ' ').replace(/ /g, ' '); }
  function kfmt(n) { n = Number(n || 0); if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.0', '') + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace('.0', '') + 'K'; return String(n); }
  function haptic(t) { try { tg && tg.HapticFeedback && (t === 'ok' ? tg.HapticFeedback.notificationOccurred('success') : t === 'err' ? tg.HapticFeedback.notificationOccurred('error') : tg.HapticFeedback.impactOccurred('light')); } catch (e) {} }
  function alertMsg(m) { try { if (tg && tg.showAlert) return tg.showAlert(m); } catch (e) {} alert(m); }
  function confirmMsg(m, cb) { try { if (tg && tg.showConfirm) return tg.showConfirm(m, function (ok) { if (ok) cb(); }); } catch (e) {} if (confirm(m)) cb(); }
  function now() { return Date.now() + S.offset; }
  function left(iso) {
    var ms = new Date(iso).getTime() - now();
    if (!(ms > 0)) return 'Tugadi';
    var s = Math.floor(ms / 1000), d = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    function p(x) { return (x < 10 ? '0' : '') + x; }
    return d > 0 ? d + 'k ' + p(hh) + ':' + p(mm) + ':' + p(ss) : p(hh) + ':' + p(mm) + ':' + p(ss);
  }
  function api(method, url, body) {
    var headers = { 'Content-Type': 'application/json' };
    if (tg && tg.initData) headers['Authorization'] = 'tma ' + tg.initData;
    return fetch(url, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return { success: false, error: 'Server javobi noto\'g\'ri' }; }); })
      .then(function (j) {
        if (j && j.serverTime) S.offset = new Date(j.serverTime).getTime() - Date.now();
        if (!j || j.success === false) { var e = new Error((j && j.error) || 'Xatolik'); e.code = j && j.code; throw e; }
        return j;
      });
  }
  var STATUS = {
    PENDING: ['Tasdiqlash kutilmoqda', '#f1aa05'], ACTIVE: ['Faol', '#49df64'], REJECTED: ['Rad etildi', '#ff5a5f'],
    CANCELLED: ['Bekor qilindi', '#8a8a8a'], ENDED_NO_BIDS: ['Stavkasiz tugadi', '#8a8a8a'],
    AWAITING_TRANSFER: ['Topshirish kutilmoqda', '#f1aa05'], TRANSFERRED: ['Topshirildi, tasdiq kutilmoqda', '#55a9ff'],
    COMPLETED: ['Sotildi', '#49df64'], DISPUTED: ['Nizo (admin ko\'rmoqda)', '#ff5a5f'], REFUNDED: ['Pul qaytarildi', '#8a8a8a'],
  };
  function badge(st) { var s = STATUS[st] || [st, '#888']; return h('span', { class: 'auc-badge', style: 'color:' + s[1] + ';background:' + s[1] + '22' }, s[0]); }
  function phone(src, onclick) {
    return h('div', { class: 'auc-phone', onclick: onclick || null }, src ? h('img', { src: src, alt: '', loading: 'lazy' }) : null);
  }
  function zoom(src) {
    var z = h('div', { class: 'auc-zoom', onclick: function () { z.remove(); } }, h('img', { src: src, alt: '' }));
    document.body.appendChild(z);
  }
  function thumb(it) { return it.photoUrl ? phone(it.photoUrl) : avatar(it); }
  function avatar(it, big) {
    var letter = (it.igUsername || '?').charAt(0).toUpperCase();
    var box = h('div', { class: big ? 'auc-ava auc-ava-big' : 'auc-ava' }, it.photoUrl ? h('img', { src: it.photoUrl, alt: '', loading: 'lazy', onerror: function () { this.remove(); } }) : null);
    box.setAttribute('data-letter', letter);
    return box;
  }

  // ---------- CSS ----------
  var css = '' +
    'html[data-auc-mode="auc"] [data-auc-hide]{display:none!important}' +
    'html[data-auc-mode="auc"] [data-auc-mkt-block] > :not([data-auc-nav]):not(#auc-root){display:none!important}' +
    'html[data-auc-mode="auc"] [data-auc-acclist]{display:none!important}' +
    'nav[data-auc-nav]{width:100%}' +
    '.auc-tabs{position:relative;display:flex;flex:1;width:100%;padding:4px;border-radius:999px;background:var(--card-surface,#1a1a1a);box-shadow:var(--glass-shadow)}' +
    '.auc-tabs .auc-pill{position:absolute;top:4px;bottom:4px;left:4px;width:calc(50% - 4px);border-radius:999px;background:linear-gradient(180deg,var(--brand-blue-2,#55a9ff),var(--brand-blue,#35aff1));box-shadow:0 6px 16px rgba(47,143,237,.4);transition:transform .5s cubic-bezier(.22,1,.36,1),box-shadow .5s ease;will-change:transform}' +
    '.auc-tabs[data-on=auc] .auc-pill{transform:translateX(100%)}' +
    '.auc-tab{position:relative;z-index:1;flex:1;font-size:16px;font-weight:800;letter-spacing:-.02em;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif!important;-webkit-font-smoothing:antialiased;color:var(--muted-foreground,#a8a8a8);background:none;border:0;padding:11px 8px;cursor:pointer;transition:color .45s ease;font-family:inherit;white-space:nowrap;-webkit-tap-highlight-color:transparent}' +
    '.auc-tab.on{color:#fff}' +
    '.auc-tabs{background:none!important;box-shadow:none!important;padding:0!important;border-radius:0!important;width:auto!important;flex:0 0 auto!important;align-items:baseline;gap:10px}' +
    '.auc-tabs .auc-pill{display:none!important}' +
    '.auc-tab{flex:0 0 auto!important;padding:0!important;font-size:22px!important;font-weight:800!important;letter-spacing:-.02em!important;color:var(--muted-foreground,#a8a8a8)!important;opacity:.45;transition:opacity .3s ease,color .3s ease}' +
    '.auc-tab.on{color:var(--foreground,#fff)!important;opacity:1}' +
    '.auc-sep{font-size:22px;font-weight:300;color:var(--muted-foreground,#a8a8a8);opacity:.35;user-select:none}' +
    '#auc-root{animation:aucin .45s cubic-bezier(.22,1,.36,1)}@keyframes aucin{from{opacity:0;transform:translateY(8px)}}' +
    '.auc-pillinfo{flex:1;min-width:0;display:flex;align-items:center;gap:8px;border-radius:999px;padding:11px 16px;font-size:13.5px;color:var(--muted-foreground,#a8a8a8);background:var(--card-surface,#1a1a1a);box-shadow:var(--glass-shadow);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.auc-round{position:relative;width:42px;height:42px;flex-shrink:0;border-radius:50%;border:0;display:grid;place-items:center;color:#f1aa05;background:var(--card-surface,#1a1a1a);box-shadow:var(--glass-shadow);cursor:pointer}' +
    '.auc-n{position:absolute;top:-3px;right:-3px;min-width:18px;height:18px;border-radius:9px;background:#ff4d6d;color:#fff;font-size:11px;font-weight:700;display:grid;place-items:center;padding:0 4px;box-sizing:border-box}' +
        '.auc-tab .auc-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#ff4d6d;margin-left:4px;vertical-align:super}' +
    '#auc-root,.auc-ov,.auc-zoom{font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}#auc-root button,.auc-ov button,.auc-ov input,.auc-ov textarea{font-family:inherit}' +
    '#auc-root{padding:0 16px 24px;color:var(--foreground,#fff)}' +
    '.auc-row{display:flex;align-items:center;gap:8px}' +
    '.auc-chips{display:flex;gap:8px;overflow-x:auto;padding-bottom:12px;scrollbar-width:none;flex:1}' +
    '.auc-chip{flex-shrink:0;border-radius:999px;padding:8px 14px;font-size:13px;background:var(--card-surface,#1a1a1a);box-shadow:var(--glass-shadow);border:0;color:var(--foreground,#fff);cursor:pointer;font-family:inherit;white-space:nowrap;transition:transform .15s}.auc-chip:active{transform:scale(.95)}' +
    '.auc-chip.on{color:var(--brand-blue-2,#55a9ff);font-weight:600}' +
    '.auc-chip .n{margin-left:6px;background:#ff4d6d;color:#fff;border-radius:999px;padding:0 6px;font-size:11px}' +
    '.auc-plus{width:42px;height:42px;flex-shrink:0;border-radius:50%;border:0;display:grid;place-items:center;color:#fff;background:var(--brand-blue,#35aff1);box-shadow:0 6px 16px rgba(47,143,237,.4);cursor:pointer;margin-bottom:12px}' +
    '.auc-info{display:flex;gap:10px;align-items:center;padding:12px 14px;border-radius:var(--r-md,18px);margin-bottom:12px;font-size:12.5px;line-height:1.35;color:var(--muted-foreground,#a8a8a8);background:var(--card-surface,#1a1a1a);box-shadow:var(--glass-shadow)}' +
    '.auc-info b{color:var(--foreground,#fff)}' +
    '.auc-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}' +
    '.auc-card{background:var(--card-surface,#1a1a1a);border-radius:var(--r-lg,24px);padding:8px;box-shadow:var(--glass-shadow);cursor:pointer;position:relative;overflow:hidden;min-width:0;transition:transform .12s}' +
    '.auc-card:active{transform:scale(.98)}' +
    '.auc-card-top{position:relative;border-radius:var(--r-md,18px);background:radial-gradient(120% 120% at 30% 20%,#2E3B52 0%,#161C28 100%);aspect-ratio:1;display:grid;place-items:center;overflow:hidden}.auc-card-top:before{content:"";position:absolute;inset:0;opacity:.5;pointer-events:none;background-image:radial-gradient(circle,rgba(255,255,255,.14) 1.5px,transparent 1.6px);background-size:22px 22px}' +
    '.auc-ava{width:64%;aspect-ratio:1;border-radius:50%;overflow:hidden;background:radial-gradient(circle at 30% 107%,#fdf497 0% 5%,#fd5949 45%,#d6249f 60%,#285aeb 90%);display:grid;place-items:center;position:relative;z-index:1;box-shadow:0 8px 24px rgba(0,0,0,.4)}' +
    '.auc-ava:before{content:attr(data-letter);font-size:30px;font-weight:700;color:#fff}' +
    '.auc-ava img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}' +
    '.auc-ava-big{width:110px;cursor:default}' +
    '.auc-timer{position:absolute;z-index:2;top:8px;left:8px;font-size:11px;font-weight:700;padding:4px 8px;border-radius:999px;background:rgba(0,0,0,.55);color:#fff;font-variant-numeric:tabular-nums;backdrop-filter:blur(6px)}' +
    '.auc-timer.hot{background:rgba(255,77,109,.85)}' +
    '.auc-bids{position:absolute;z-index:2;top:8px;right:8px;font-size:11px;font-weight:700;padding:4px 8px;border-radius:999px;background:rgba(0,0,0,.55);color:#fff}' +
    '.auc-lead{position:absolute;z-index:2;bottom:8px;left:50%;transform:translateX(-50%);font-size:10.5px;font-weight:800;padding:3px 9px;border-radius:999px;background:#49df64;color:#062b0e;white-space:nowrap}' +
    '.auc-lead.out{background:#ff4d6d;color:#fff}' +
    '.auc-name{font-weight:700;font-size:15px;color:#fff;padding:10px 6px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.auc-sub{font-size:12px;color:var(--muted-foreground,#a8a8a8);padding:2px 6px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.auc-prow{display:flex;align-items:center;gap:8px;margin:10px 6px 4px}.auc-price{flex:1;display:flex;align-items:center;justify-content:center;gap:4px;border-radius:999px;padding:6px 10px;font-weight:700;font-size:13.5px;color:#fff;white-space:nowrap;background:linear-gradient(45deg,#feda75 0%,#fa7e1e 18%,#d62976 45%,#962fbf 70%,#4f5bd5 100%);box-shadow:0 0 0 1px rgba(214,41,118,.45),0 4px 14px rgba(214,41,118,.40),0 2px 10px rgba(150,47,191,.30),inset 0 1px 0 rgba(255,255,255,.28)}.auc-ibtn{width:34px;height:34px;flex-shrink:0;border-radius:50%;display:grid;place-items:center;background:var(--card-icon-btn,#282727);color:#fff}' +
    '.auc-price small{font-size:10px;font-weight:600;opacity:.9}' +
    '.auc-empty{text-align:center;padding:40px 16px;color:var(--muted-foreground,#9a9a9a);font-size:14px}' +
    '.auc-empty .e{font-size:40px;margin-bottom:8px}' +
    '.auc-badge{display:inline-block;font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px}' +
    '.auc-list{display:flex;flex-direction:column;gap:10px}' +
    '.auc-li{display:flex;gap:12px;align-items:center;padding:12px;border-radius:var(--r-md,18px);background:var(--card-surface,#1a1a1a);box-shadow:var(--glass-shadow);cursor:pointer}' +
    '.auc-li .auc-ava{width:48px;flex-shrink:0}.auc-li .auc-ava:before{font-size:20px}' +
    '.auc-li .t{flex:1;min-width:0}.auc-li .t b{display:block;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.auc-li .t span{font-size:12px;color:var(--muted-foreground,#9a9a9a)}' +
    '.auc-li .p{font-weight:800;font-size:14px;text-align:right;white-space:nowrap}' +
    '.auc-h{font-size:13px;font-weight:700;color:var(--muted-foreground,#9a9a9a);margin:14px 2px 8px;text-transform:uppercase;letter-spacing:.04em}' +
    '.auc-skel{height:250px;border-radius:var(--r-lg,24px);background:linear-gradient(90deg,#1a1a1a,#232323,#1a1a1a);background-size:200% 100%;animation:aucsk 1.2s infinite}' +
    '@keyframes aucsk{to{background-position:-200% 0}}' +
    /* sheet */
    '.auc-ov{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.72);display:flex;align-items:stretch;justify-content:center;animation:aucfade .18s}' +
    '@keyframes aucfade{from{opacity:0}}' +
    '.auc-sheet{width:100%;max-width:512px;height:100%;max-height:none;box-sizing:border-box;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;padding-top:calc(var(--tg-safe-area-inset-top,0px) + var(--tg-content-safe-area-inset-top,0px) + 10px)!important;background:var(--background,#141414);border-radius:0;padding:10px 16px calc(20px + var(--tg-safe-area-inset-bottom,0px));color:var(--foreground,#fff);animation:aucup .22s cubic-bezier(.2,.8,.2,1);box-shadow:0 -10px 40px rgba(0,0,0,.5)}' +
    '.auc-sheet::-webkit-scrollbar{display:none}' +
    '@keyframes aucup{from{transform:translateY(40px);opacity:.4}}' +
    '.auc-grab{height:6px}' +
    '.auc-x{position:sticky;float:none;display:block;z-index:5;top:0;margin:0 0 10px auto;width:32px;height:32px;border-radius:50%;border:0;background:var(--card-icon-btn,#282727);color:#fff;font-size:18px;cursor:pointer}' +
    '.auc-hero{display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px;padding:6px 0 12px}' +
    '.auc-hero h3{font-size:20px;font-weight:800;margin:6px 0 0}' +
    '.auc-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:6px 0 12px}' +
    '.auc-stat{background:var(--card-surface,#1a1a1a);border-radius:var(--r-sm,16px);padding:10px 8px;text-align:center;box-shadow:var(--glass-shadow)}' +
    '.auc-stat b{display:block;font-size:15px;font-variant-numeric:tabular-nums}.auc-stat span{font-size:11px;color:var(--muted-foreground,#9a9a9a)}' +
    '.auc-box{background:var(--card-surface,#1a1a1a);border-radius:var(--r-md,18px);padding:14px;margin-bottom:12px;box-shadow:var(--glass-shadow)}' +
    '.auc-box p{margin:0;font-size:13.5px;line-height:1.45;white-space:pre-wrap;word-break:break-word}' +
    '.auc-big{font-size:28px;font-weight:800;letter-spacing:-.01em;background:linear-gradient(45deg,#fa7e1e,#d62976 45%,#962fbf 75%,#4f5bd5);-webkit-background-clip:text;background-clip:text;color:transparent}' +
    '.auc-lbl{font-size:12px;color:var(--muted-foreground,#9a9a9a);margin-bottom:6px;display:block}' +
    '.auc-in{width:100%;box-sizing:border-box;border-radius:var(--r-md,18px);padding:12px 14px;font-size:15px;color:var(--foreground,#fff);background:var(--card-surface,#1a1a1a);box-shadow:var(--glass-shadow);border:1px solid transparent;outline:none;font-family:inherit}.auc-in::placeholder{color:rgba(168,168,168,.5)}' +
    '.auc-in:focus{border-color:var(--brand-blue,#35aff1)}' +
    'textarea.auc-in{min-height:84px;resize:vertical}' +
    '.auc-quick{display:flex;gap:8px;margin-top:8px}' +
    '.auc-quick button{flex:1;border-radius:999px;padding:9px 4px;font-size:12.5px;font-weight:700;border:0;background:var(--card-icon-btn,#282727);color:#fff;cursor:pointer;font-family:inherit}' +
    '.auc-btn{width:100%;border:0;border-radius:var(--r-md,18px);padding:14px;font-size:15px;font-weight:700;transition:transform .15s;color:#fff;cursor:pointer;margin-top:10px;font-family:inherit;background:linear-gradient(180deg,var(--brand-blue-2,#55a9ff),var(--brand-blue,#35aff1));box-shadow:0 6px 18px rgba(53,175,241,.35)}' +
    '.auc-btn.hot{border-radius:999px;background:linear-gradient(135deg,#9B36C9 0%,#D63284 22%,#F02D6F 42%,#FF1F1F 60%,#FF7B36 78%,#FFC247 100%);box-shadow:0 6px 18px rgba(240,45,111,.3)}' +
    '.auc-btn.green{background:linear-gradient(180deg,#5ee879,#2fc24c);box-shadow:0 6px 18px rgba(73,223,100,.3);color:#04220a}' +
    '.auc-btn.ghost{background:var(--card-icon-btn,#282727);box-shadow:none}' +
    '.auc-btn.red{background:rgba(255,77,109,.15);color:#ff5a7a;box-shadow:none}' +
    '.auc-btn[disabled]{opacity:.5;pointer-events:none}' +
    '.auc-2{display:flex;gap:8px}.auc-2>*{flex:1}' +
    '.auc-bidrow{display:flex;justify-content:space-between;align-items:center;padding:9px 2px;border-bottom:1px solid rgba(255,255,255,.05);font-size:13.5px}' +
    '.auc-bidrow:last-child{border-bottom:0}.auc-bidrow.me{color:var(--brand-blue-2,#55a9ff);font-weight:700}' +
    '.auc-bidrow span:last-child{font-weight:800;font-variant-numeric:tabular-nums}' +
    '.auc-seg{display:flex;gap:8px;flex-wrap:wrap}' +
    '.auc-seg button{flex:1;min-width:70px;border-radius:999px;padding:10px 6px;font-size:13px;font-weight:600;border:1px solid transparent;background:var(--card-surface,#1a1a1a);box-shadow:var(--glass-shadow);color:var(--foreground,#fff);cursor:pointer;font-family:inherit}' +
    '.auc-seg button.on{border-color:var(--brand-blue,#35aff1);background:var(--brand-soft,rgba(85,169,255,.15));color:var(--brand-blue-2,#55a9ff)}' +
    '.auc-f{margin-bottom:12px}' +
    '.auc-photo{display:flex;align-items:center;gap:12px}' +
    '.auc-photo .auc-ava{width:64px;flex-shrink:0}' +
    '.auc-note{font-size:12px;color:var(--muted-foreground,#9a9a9a);line-height:1.4;margin-top:8px}' +
    '.auc-steps{margin:0;padding-left:18px;font-size:13px;line-height:1.55;color:var(--muted-foreground,#b0b0b0)}' +
    '.auc-steps b{color:var(--foreground,#fff)}' +'.auc-phone{position:relative;aspect-ratio:9/19.5;border-radius:18px;overflow:hidden;background:#0b0b0b;box-shadow:0 0 0 3px #2a2a2a,0 0 0 4px #111,0 10px 26px rgba(0,0,0,.5);flex-shrink:0}' +'.auc-phone:before{content:"";position:absolute;top:6px;left:50%;transform:translateX(-50%);width:34%;height:7px;border-radius:7px;background:#000;z-index:2;opacity:.85}' +'.auc-noisland:before{display:none}.auc-phone img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}' +'.auc-card-top{aspect-ratio:4/5!important}.auc-card-top .auc-phone{height:92%;z-index:1;border-radius:14px}.auc-card-top .auc-phone img,.auc-li .auc-phone img{object-fit:contain;background:#000}.auc-card-top .auc-phone:before{height:5px;top:4px}' +'.auc-gal{display:flex;gap:16px;overflow-x:auto;scrollbar-width:none;padding:8px 6px 14px;justify-content:center}.auc-gal::-webkit-scrollbar{display:none}' +'.auc-gal{scroll-snap-type:x mandatory}.auc-gal .auc-phone{width:46%;max-width:200px;cursor:zoom-in;scroll-snap-align:center}.auc-gal.one .auc-phone{width:62%;max-width:250px}.auc-gal .auc-phone img{object-fit:contain;background:#000}' +'.auc-slots{display:flex;gap:12px}.auc-slots .auc-phone{flex:1;max-width:110px}' +'.auc-slot-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;height:100%;color:var(--muted-foreground,#a8a8a8);font-size:11.5px;font-weight:600;border:1.5px dashed rgba(255,255,255,.15);border-radius:18px;box-sizing:border-box;cursor:pointer;text-align:center;padding:6px}' +'.auc-slot-x{position:absolute;top:6px;right:6px;z-index:3;width:24px;height:24px;border-radius:50%;border:0;background:rgba(0,0,0,.65);color:#fff;font-size:15px;line-height:1;cursor:pointer}' +'.auc-zoom{position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,.94);display:grid;place-items:center;padding:20px}.auc-zoom img{max-width:100%;max-height:100%;border-radius:16px}' +'[data-auc-acclist]{display:none!important}' +'[data-auc-full]{max-height:none!important;height:100%!important;height:100dvh!important;border-radius:0!important}' +'[data-auc-full][data-auc-pad]{padding-top:calc(var(--tg-safe-area-inset-top,0px) + var(--tg-content-safe-area-inset-top,0px) + 20px)!important}' +'[data-auc-full] > :first-child[draggable], [data-auc-full] > .cursor-grab{padding-top:calc(var(--tg-safe-area-inset-top,0px) + var(--tg-content-safe-area-inset-top,0px) + 14px)!important}';
  css += '.auc-uava{position:relative;display:inline-grid;place-items:center;flex-shrink:0;border-radius:50%;overflow:hidden;color:#fff;font-weight:800}' +
    '.auc-uava img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}' +
    '.auc-lb{background:radial-gradient(120% 90% at 50% 0%,rgba(79,91,213,.22),transparent 60%),var(--card-surface,#1a1a1a)}' +
    '.auc-pod{display:grid;grid-template-columns:1fr 1.15fr 1fr;align-items:end;gap:8px;margin-top:10px}' +
    '.auc-pcol{display:flex;flex-direction:column;align-items:center;min-width:0;position:relative}' +
    '.auc-crown{font-size:22px;line-height:1;margin-bottom:2px;animation:auccr 2.4s ease-in-out infinite}' +
    '@keyframes auccr{50%{transform:translateY(-3px) rotate(-6deg)}}' +
    '.auc-pname{font-size:12.5px;font-weight:700;margin-top:8px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.auc-pcol.me .auc-pname{color:#55a9ff}' +
    '.auc-pamt{font-size:12.5px;font-weight:800;margin:2px 0 6px;font-variant-numeric:tabular-nums}' +
    '.auc-ped{width:100%;border-radius:14px 14px 6px 6px;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding-top:6px;box-sizing:border-box;transform-origin:bottom;animation:aucgrow .6s cubic-bezier(.2,.8,.2,1)}' +
    '@keyframes aucgrow{from{transform:scaleY(.2);opacity:.3}}' +
    '.auc-ped b{font-size:20px;font-weight:900;line-height:1;color:rgba(255,255,255,.92)}.auc-ped span{font-size:10px;color:rgba(255,255,255,.75);margin-top:3px}' +
    '.auc-ped.p0{background:linear-gradient(180deg,#f5c542,#a4720a)}.auc-ped.p1{background:linear-gradient(180deg,#c9d1d9,#5e6875)}.auc-ped.p2{background:linear-gradient(180deg,#d08a4b,#7a4316)}' +
    '.auc-rest{margin-top:14px;display:flex;flex-direction:column;gap:10px}' +
    '.auc-rrow{display:flex;align-items:center;gap:10px}.auc-rk{width:18px;text-align:center;font-size:12px;font-weight:800;color:#8a8a8a}' +
    '.auc-rmid{flex:1;min-width:0}.auc-rtop{display:flex;justify-content:space-between;gap:8px;font-size:12.5px;margin-bottom:5px}' +
    '.auc-rtop span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.auc-rtop b{font-variant-numeric:tabular-nums;flex-shrink:0}' +
    '.auc-rrow.me .auc-rtop span{color:#55a9ff;font-weight:700}' +
    '.auc-bar{height:6px;border-radius:6px;background:rgba(255,255,255,.06);overflow:hidden}.auc-bar i{display:block;height:100%;border-radius:6px;background:linear-gradient(90deg,#4f5bd5,#d62976,#fa7e1e)}';
  css += '.auc-arena{margin:0 0 12px}' +
    '.auc-ar-head{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-radius:22px 22px 0 0;background:var(--card-surface,#1a1a1a);box-shadow:var(--glass-shadow);font-size:15px;color:var(--muted-foreground,#a8a8a8);font-variant-numeric:tabular-nums}' +
    '.auc-ar-head b{color:#35aff1;font-weight:800;margin-left:4px}' +
    '.auc-ar-frame{padding:12px;margin-top:-6px;border-radius:22px;background:linear-gradient(180deg,#2b2b2b,#1c1c1c);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08),0 10px 28px rgba(0,0,0,.45)}' +
    '.auc-ar-sq{position:relative;width:100%;aspect-ratio:1;border-radius:6px;overflow:hidden;background:#111;container-type:inline-size}' +
    '.auc-ar-sq svg{position:absolute;inset:0;display:block}' +
    '.auc-ar-poly{transform-origin:50% 50%;animation:aucpoly .7s cubic-bezier(.22,1,.36,1) both}' +
    '@keyframes aucpoly{from{opacity:0}}' +
    '.auc-ar-ava{position:absolute!important;aspect-ratio:1;font-size:5cqw!important;animation:aucpop .6s cubic-bezier(.34,1.56,.64,1) both;animation-delay:.25s;overflow:visible!important}' +
    '.auc-ar-ava img{border-radius:50%}' +
    '@keyframes aucpop{from{transform:scale(0);opacity:0}}' +
    '.auc-ar-crown{position:absolute;top:-38%;left:50%;transform:translateX(-50%) rotate(-8deg);font-size:6cqw;filter:drop-shadow(0 2px 4px rgba(0,0,0,.4))}' +
    '.auc-ar-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:#a8a8a8;font-size:14px;background:radial-gradient(circle,rgba(255,255,255,.14) 1.5px,transparent 1.6px) 0 0/22px 22px,radial-gradient(120% 120% at 30% 20%,#2E3B52 0%,#161C28 100%)}' +
    '.auc-ar-empty div:last-child{color:#fff;font-weight:700}' +
    '.auc-ar-title{display:flex;justify-content:space-between;align-items:baseline;margin:16px 2px 8px}' +
    '.auc-ar-title>span:first-child{font-size:24px;font-weight:800}.auc-ar-title em{font-style:normal;color:#8a8a8a;font-weight:700}' +
    '.auc-ar-id{font-size:14px;color:#6f6f6f;font-weight:600}' +
    '.auc-ar-list{display:flex;flex-direction:column;gap:8px}' +
    '.auc-ar-row{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:16px;background:var(--card-surface,#1a1a1a);box-shadow:var(--glass-shadow)}' +
    '.auc-ar-row>i{width:6px;align-self:stretch;border-radius:6px;flex-shrink:0}' +
    '.auc-ar-row .n{flex:1;min-width:0;font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.auc-ar-row.me .n{color:#55a9ff}' +
    '.auc-ar-row .p{font-size:12px;color:#8a8a8a;font-weight:600;font-variant-numeric:tabular-nums}' +
    '.auc-ar-row b{font-size:14px;font-variant-numeric:tabular-nums;min-width:70px;text-align:right}' +
    '.auc-ar-lead{margin-left:6px;font-size:10px;font-weight:800;padding:2px 6px;border-radius:999px;color:#062b0e;background:#49df64;vertical-align:middle}' +
    '.auc-cardlead{font-size:11.5px;font-weight:700;padding:3px 6px 0}' +
    '.auc-li .auc-phone{width:40px;flex-shrink:0;border-radius:9px;box-shadow:0 0 0 2px #2a2a2a}.auc-li .auc-phone:before{display:none}';
  css += '.auc-gen{position:relative;overflow:hidden;display:grid!important;place-items:center}' +
    '.auc-gen i{position:absolute;width:70%;height:70%;border-radius:50%;filter:blur(38px);opacity:.75;mix-blend-mode:screen;will-change:transform}' +
    '.auc-gen .b1{background:#35aff1;left:-15%;top:-10%;animation:aucb1 7s ease-in-out infinite alternate}' +
    '.auc-gen .b2{background:#4f5bd5;right:-20%;top:5%;animation:aucb2 8s ease-in-out infinite alternate}' +
    '.auc-gen .b3{background:#d62976;left:5%;bottom:-25%;animation:aucb3 9s ease-in-out infinite alternate}' +
    '.auc-gen .b4{background:#22d3a6;right:-10%;bottom:-15%;width:55%;height:55%;animation:aucb4 6s ease-in-out infinite alternate}' +
    '@keyframes aucb1{to{transform:translate(35%,40%) scale(1.15)}}@keyframes aucb2{to{transform:translate(-40%,30%) scale(.9)}}' +
    '@keyframes aucb3{to{transform:translate(30%,-45%) scale(1.2)}}@keyframes aucb4{to{transform:translate(-45%,-35%) scale(1.1)}}' +
    '.auc-gen-grain{position:absolute;inset:-50%;opacity:.16;pointer-events:none;background-image:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27160%27 height=%27160%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%27.9%27 numOctaves=%272%27 stitchTiles=%27stitch%27/%3E%3C/filter%3E%3Crect width=%27100%25%27 height=%27100%25%27 filter=%27url(%23n)%27/%3E%3C/svg%3E");animation:aucgrain 1s steps(6) infinite}' +
    '@keyframes aucgrain{0%{transform:translate(0,0)}20%{transform:translate(-5%,3%)}40%{transform:translate(4%,-4%)}60%{transform:translate(-3%,-6%)}80%{transform:translate(6%,4%)}100%{transform:translate(0,0)}}' +
    '.auc-gen-shine{position:absolute;inset:0;pointer-events:none;background:linear-gradient(110deg,transparent 35%,rgba(255,255,255,.08) 50%,transparent 65%);background-size:250% 100%;animation:aucshine 2.6s linear infinite}' +
    '@keyframes aucshine{from{background-position:150% 0}to{background-position:-100% 0}}' +
    '.auc-gen-txt{position:relative;z-index:2;text-align:center;display:flex;flex-direction:column;align-items:center;gap:6px;color:#fff;font-weight:700;font-size:15px;text-shadow:0 2px 12px rgba(0,0,0,.45)}' +
    '.auc-gen-txt small{font-size:12px;font-weight:500;color:rgba(255,255,255,.75)}' +
    '.auc-gen-dots{display:flex;gap:6px;margin-bottom:4px}.auc-gen-dots b{width:8px;height:8px;border-radius:50%;background:#fff;animation:aucdot 1.2s ease-in-out infinite}' +
    '.auc-gen-dots b:nth-child(2){animation-delay:.15s}.auc-gen-dots b:nth-child(3){animation-delay:.3s}' +
    '@keyframes aucdot{0%,80%,100%{opacity:.3;transform:scale(.7)}40%{opacity:1;transform:scale(1)}}';
  css += '.auc-ico{display:inline-block;width:1.15em;height:1.15em;vertical-align:-.2em;margin-right:.35em;flex-shrink:0}.auc-hero > div > .auc-ico,.auc-empty .e .auc-ico{color:var(--brand-blue-2,#55a9ff);margin:0}.auc-ar-crown .auc-ico,.auc-crown .auc-ico{margin:0;width:1.2em;height:1.2em}.auc-ico-trash{color:#ff5a7a}.auc-ico-shield{color:#f1aa05}.auc-ico-check{color:#49df64}.auc-ico-trophy,.auc-ico-medal{color:#f5c542}.auc-ico-trend{color:#d62976}.auc-btn .auc-ico{color:inherit}.auc-emo{display:inline-block;height:1.25em;width:auto;vertical-align:-.28em;margin:0 .08em;pointer-events:none;-webkit-user-drag:none}.auc-ar-crown .auc-emo,.auc-crown .auc-emo{height:1.1em}';
  css += '.auc-ov{touch-action:pan-y;overscroll-behavior:contain}.auc-sheet{overflow-x:hidden!important;touch-action:pan-y;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}.auc-sheet *{max-width:100%;box-sizing:border-box}.auc-in{min-width:0}.auc-seg button{min-width:0!important}';
  css += '.auc-gen{background:radial-gradient(ellipse 80% 75% at 50% 50%,#191d1f 0%,#1c2124 70%,#202629 100%)!important}' +
    '.auc-gen::before{content:"";position:absolute;inset:0;z-index:0;pointer-events:none;background:radial-gradient(ellipse 72% 68% at 50% 52%,transparent 0%,transparent 42%,rgba(31,64,73,.75) 70%,rgba(43,95,107,.95) 100%);transform-origin:50% 50%;animation:aucvig 4.5s ease-in-out infinite alternate}' +
    '@keyframes aucvig{0%{transform:scale(1);opacity:1}100%{transform:scale(1.55);opacity:.55}}' +
    '.auc-wait-tex{position:absolute;inset:0;pointer-events:none;opacity:.22;mix-blend-mode:overlay;background-image:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27300%27 height=%27300%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%27.02 .035%27 numOctaves=%274%27 seed=%273%27/%3E%3CfeColorMatrix values=%270 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1.3 -.35%27/%3E%3C/filter%3E%3Crect width=%27100%25%27 height=%27100%25%27 filter=%27url(%23n)%27/%3E%3C/svg%3E");background-size:cover}' +
    '.auc-ar-empty .auc-wait-txt{position:relative;z-index:2;font-size:clamp(17px,6.2cqw,26px);font-weight:500!important;letter-spacing:.01em;color:#2a7f93!important;white-space:nowrap}' +
    '.auc-wait-txt span{display:inline-block;color:#2a7f93;animation:aucletter 2.6s ease-in-out infinite}' +
    '@keyframes aucletter{0%,100%{color:#2a7f93;text-shadow:none}12%{color:#4fd3ee;text-shadow:0 0 10px rgba(79,211,238,.35)}24%{color:#2a7f93;text-shadow:none}}' +
    '@keyframes aucsmoke{0%{transform:translate(0,0) scale(1)}50%{transform:translate(-6%,4%) scale(1.08)}100%{transform:translate(5%,-5%) scale(1.04)}}' +
    
    '@keyframes aucedge{0%,100%{box-shadow:inset 0 0 40px 6px rgba(70,180,200,.18)}50%{box-shadow:inset 0 0 70px 18px rgba(86,216,240,.42)}}';
  css += '.auc-paysheet{padding:0!important}.auc-paysheet .auc-paybox{max-width:560px;border-radius:22px 22px 0 0;padding-top:4px;animation:aucSheetUp .26s cubic-bezier(.2,.8,.2,1);will-change:transform}.auc-grab{display:flex;justify-content:center;padding:8px 0 14px;margin:0 -16px;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none}.auc-grab i{display:block;width:64px;height:5px;border-radius:5px;background:rgba(255,255,255,.32)}@keyframes aucSheetUp{from{transform:translateY(100%)}to{transform:translateY(0)}}.auc-payov{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.65);display:flex;align-items:flex-end;justify-content:center;padding:16px}.auc-paybox{width:100%;max-width:440px;background:var(--card,#1b1b1b);border-radius:22px;padding:18px 16px calc(16px + var(--tg-safe-area-inset-bottom,0px));box-shadow:0 -10px 40px rgba(0,0,0,.5)}.auc-paylogo{display:inline-block;width:34px;height:34px;min-width:34px;flex:0 0 34px;margin:-4px 10px -4px -4px;padding:0;border-radius:10px;background-color:#fff;background-repeat:no-repeat;background-position:center;background-size:78% 78%;overflow:hidden;box-shadow:0 2px 6px rgba(0,0,0,.2)}.auc-tier{display:grid;grid-template-columns:1fr 1fr 40px;gap:8px;align-items:end;margin-top:10px}.auc-tier label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9a9a9a;font-weight:600}.auc-tier .auc-in{margin:0;font-weight:700}.auc-tier-del{height:46px;border:0;border-radius:14px;background:rgba(255,77,109,.15);color:#ff5a7a;font-size:16px;font-weight:800;cursor:pointer}.auc-dur{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.auc-dur label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9a9a9a;text-align:center;font-weight:600}.auc-dur .auc-in{text-align:center;font-weight:800;font-size:18px;margin:0}';
  css += '.auc-share-btn{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;margin:7px 0 2px;padding:8px 10px;border-radius:999px;border:1px solid rgba(85,169,255,.35);background:rgba(85,169,255,.12);color:#55a9ff;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit;transition:transform .12s,background .15s;-webkit-tap-highlight-color:transparent}.auc-share-btn:active{transform:scale(.96);background:rgba(85,169,255,.24)}.auc-share-btn.big{padding:12px 18px;font-size:14.5px;margin:10px 0 6px;background:linear-gradient(135deg,rgba(85,169,255,.2),rgba(47,143,237,.32));border:1px solid rgba(85,169,255,.45);box-shadow:0 4px 14px rgba(47,143,237,.25)}';
  var st = document.createElement('style');
  css += 'button[aria-label="Til tanlang"], button[aria-label="Выберите язык"], button[aria-label="Choose a language"], button[aria-label="Til"], button[aria-label="Language"], .plain-ui-toggle { display: none !important; }';
  st.id = 'auc-css';
  st.textContent = css;
  (document.head || document.documentElement).appendChild(st);

  // ---------- DOM ilmoqlash ----------
  function findNav() {
    var spans = document.querySelectorAll('nav > span');
    for (var i = 0; i < spans.length; i++) {
      if (spans[i].textContent.trim() === 'Akkauntlar' && !spans[i].closest('.auc-tabs')) return spans[i].parentElement;
    }
    var navs = document.querySelectorAll('nav[data-auc-nav]');
    return navs[0] || null;
  }

  function markFullSheets() {
    var list = document.querySelectorAll('.fixed.inset-0 > .max-w-lg:not([data-auc-full])');
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      var mh = el.style.maxHeight;
      var cls = el.className || '';
      var txt = '';
      if (mh === '92vh') { el.setAttribute('data-auc-full', '1'); continue; }
      if (cls.indexOf('max-h-[85vh]') >= 0) {
        txt = el.textContent || '';
        if (txt.indexOf("Akkauntingizni qo'shing") >= 0 || TXT_TARGET.some(function (x) { return txt.indexOf(x) >= 0; }) || el.querySelector('input[type=file]')) { el.setAttribute('data-auc-full', '1'); el.setAttribute('data-auc-pad', '1'); }
      }
    }
  }
  // ---------- Qimmat atmetka (profil → Atmetka qilish) ----------
  var TXT_TARGET = ['Atmetka qilinadigan akkaunt', 'Аккаунт для отметки', 'Account to tag'];
  var TXT_SIMPLE = ['Oddiy atmetka', 'Обычная отметка', 'Simple tag'];
  var TAG = { prem: 0, rules: null, simple: null, admin: false, opt_simple_title: '', opt_simple_sub: '', opt_prem_title: '', opt_prem_sub: '' };
  try {
    if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
      var _uid = String(tg.initDataUnsafe.user.id);
      if (['6472624701','5027595868','8341424795','8897050018'].indexOf(_uid) !== -1) TAG.admin = true;
    }
  } catch (e) {}

  function shareAuction(it) {
    if (!it) return;
    var botUser = 'Top_sxema_instagrambot';
    var shareUrl = 'https://t.me/' + botUser + '?startapp=auction_' + it.id;
    var name = it.igUsername ? ('@' + it.igUsername) : ('Lot #' + it.id);
    var shareText = '🔥 ' + name + ' auksioni boshlandi!\nBoshlang\'ich narx: ' + money(it.currentPrice) + " so'm\n\nStavka qo'yish uchun bosing 👇";
    var tgUrl = 'https://t.me/share/url?url=' + encodeURIComponent(shareUrl) + '&text=' + encodeURIComponent(shareText);

    try {
      if (tg && tg.openTelegramLink) {
        tg.openTelegramLink(tgUrl);
        return;
      }
    } catch (e) {}

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(shareUrl).then(function () {
          alertMsg("Havola nusxalandi: " + shareUrl);
        }).catch(function () {
          window.open(tgUrl, '_blank');
        });
        return;
      }
    } catch (e) {}

    window.open(tgUrl, '_blank');
  }

  function findTextEl(root, txt, sel) {
    var els = (root || document).querySelectorAll(sel || 'p,span,div,h1,h2,h3');
    for (var i = 0; i < els.length; i++) if (els[i].childElementCount === 0 && (Array.isArray(txt) ? txt.indexOf(els[i].textContent.trim()) >= 0 : els[i].textContent.trim() === txt)) return els[i];
    return null;
  }
  function parseRules(t) {
    try {
      var o = JSON.parse(t);
      if (o && typeof o === 'object') return o;
    } catch (e) {}
    return { prem: t || '', simple: '' };
  }
  function applyParsedRules(j) {
    var o = parseRules(typeof j === 'string' ? j : (j && j.text));
    TAG.rules = o.prem || '';
    TAG.simple = o.simple || '';
    TAG.opt_simple_title = o.opt_simple_title || 'Oddiy atmetka';
    TAG.opt_simple_sub = o.opt_simple_sub || 'Istalgan videoda akkauntni atmetka qiling';
    TAG.simple_copy = o.simple_copy || '';
    TAG.simple_rule = o.simple_rule != null ? o.simple_rule : '';
    TAG.opt_prem_title = o.opt_prem_title || "Text qo'shish";
    TAG.opt_prem_sub = o.opt_prem_sub || 'Qoidaga muvofiq atmetka qiling';
    TAG.prem_copy = o.prem_copy || '';
    TAG.prem_rule = o.prem_rule != null ? o.prem_rule : (o.prem || '');

    if (!TAG.prem_copy && TAG.rules) {
      var lines = TAG.rules.split('\n');
      TAG.prem_copy = lines[0] || '';
      if (!TAG.prem_rule && lines.length > 1) {
        TAG.prem_rule = lines.slice(1).join('\n').trim();
      }
    }
    if (!TAG.simple_copy) {
      TAG.simple_copy = '@top_sxema_rek67';
    }

    window.__tagOptions = {
      simple_title: TAG.opt_simple_title,
      simple_sub: TAG.opt_simple_sub,
      simple_copy: TAG.simple_copy,
      simple_rule: TAG.simple_rule,
      prem_title: TAG.opt_prem_title,
      prem_sub: TAG.opt_prem_sub,
      prem_copy: TAG.prem_copy,
      prem_rule: TAG.prem_rule
    };
    if (j && j.isAdmin != null) TAG.admin = !!j.isAdmin;
    try {
      if (!TAG.admin && tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
        var _uid = String(tg.initDataUnsafe.user.id);
        if (['6472624701','5027595868','8341424795','8897050018'].indexOf(_uid) !== -1) TAG.admin = true;
      }
    } catch (e) {}
  }
  function saveRules(data) {
    var p = data || {};
    var payload = {
      __v: 4,
      opt_simple_title: p.opt_simple_title != null ? p.opt_simple_title : (TAG.opt_simple_title || 'Oddiy atmetka'),
      opt_simple_sub: p.opt_simple_sub != null ? p.opt_simple_sub : (TAG.opt_simple_sub || ''),
      simple_copy: p.simple_copy != null ? p.simple_copy : (TAG.simple_copy || ''),
      simple_rule: p.simple_rule != null ? p.simple_rule : (TAG.simple_rule || ''),
      opt_prem_title: p.opt_prem_title != null ? p.opt_prem_title : (TAG.opt_prem_title || "Text qo'shish"),
      opt_prem_sub: p.opt_prem_sub != null ? p.opt_prem_sub : (TAG.opt_prem_sub || ''),
      prem_copy: p.prem_copy != null ? p.prem_copy : (TAG.prem_copy || ''),
      prem_rule: p.prem_rule != null ? p.prem_rule : (TAG.prem_rule || ''),
      prem: (p.prem_copy ? p.prem_copy + (p.prem_rule ? '\n\n' + p.prem_rule : '') : (TAG.rules || '')),
      simple: p.simple_rule != null ? p.simple_rule : (TAG.simple || '')
    };
    return api('POST', '/api/auction/admin/tag-rules', { text: JSON.stringify(payload) }).then(function (j) {
      applyParsedRules(j);
      return j;
    });
  }
  function loadTagRules(cb) {
    api('GET', '/api/auction/tag-rules').then(function (j) {
      applyParsedRules(j);
      cb && cb();
    }).catch(function () {
      TAG.rules = TAG.rules || '';
      cb && cb();
    });
  }
  function premiumPicker() { return; }
  function openTagOptionsEditor() {
    var old = document.querySelector('.auc-payov'); if (old) old.remove();
    var ov; function close() { if (ov) ov.remove(); }

    var inSimpleTitle = h('input', {
      class: 'auc-in',
      placeholder: 'Oddiy atmetka',
      value: TAG.opt_simple_title || 'Oddiy atmetka',
      style: 'margin-bottom:6px;font-weight:700'
    });
    var inSimpleSub = h('textarea', {
      class: 'auc-in',
      placeholder: 'Kichik izoh (masalan: Istalgan videoda belgilang)',
      style: 'min-height:50px;margin-bottom:8px;font-size:13px'
    });
    inSimpleSub.value = TAG.opt_simple_sub || 'Istalgan videoda akkauntni atmetka qiling';

    var inSimpleCopy = h('textarea', {
      class: 'auc-in',
      placeholder: 'Copy qiladigan joyini kiriting (masalan: @akkaunt yoki matn)',
      style: 'min-height:55px;margin-bottom:8px;font-size:13px;border-color:rgba(85,169,255,0.5)'
    });
    inSimpleCopy.value = TAG.simple_copy || '';

    var inSimpleRule = h('textarea', {
      class: 'auc-in',
      placeholder: 'Kichik qoidasi (agar bo\'lsa, ixtiyoriy)',
      style: 'min-height:55px;margin-bottom:14px;font-size:13px'
    });
    inSimpleRule.value = TAG.simple_rule || '';

    var inPremTitle = h('input', {
      class: 'auc-in',
      placeholder: "Text qo'shish",
      value: TAG.opt_prem_title || "Text qo'shish",
      style: 'margin-bottom:6px;font-weight:700'
    });
    var inPremSub = h('textarea', {
      class: 'auc-in',
      placeholder: 'Kichik izoh (masalan: Qoidaga muvofiq atmetka qiling)',
      style: 'min-height:50px;margin-bottom:8px;font-size:13px'
    });
    inPremSub.value = TAG.opt_prem_sub || 'Qoidaga muvofiq atmetka qiling';

    var inPremCopy = h('textarea', {
      class: 'auc-in',
      placeholder: 'Copy qiladigan joyini kiriting (matn / heshteg)',
      style: 'min-height:65px;margin-bottom:8px;font-size:13px;border-color:rgba(241,170,5,0.5)'
    });
    inPremCopy.value = TAG.prem_copy || '';

    var inPremRule = h('textarea', {
      class: 'auc-in',
      placeholder: 'Qoidasini kiriting (kichik qoida)',
      style: 'min-height:75px;margin-bottom:14px;font-size:13px'
    });
    inPremRule.value = TAG.prem_rule || '';

    var saveBtn = h('button', { class: 'auc-btn hot', type: 'button' }, '💾 Saqlash');
    saveBtn.addEventListener('click', function () {
      busy(saveBtn, true);
      saveRules({
        opt_simple_title: inSimpleTitle.value.trim() || 'Oddiy atmetka',
        opt_simple_sub: inSimpleSub.value.trim() || 'Istalgan videoda akkauntni atmetka qiling',
        simple_copy: inSimpleCopy.value.trim(),
        simple_rule: inSimpleRule.value.trim(),
        opt_prem_title: inPremTitle.value.trim() || "Text qo'shish",
        opt_prem_sub: inPremSub.value.trim() || 'Qoidaga muvofiq atmetka qiling',
        prem_copy: inPremCopy.value.trim(),
        prem_rule: inPremRule.value.trim()
      }).then(function () {
        busy(saveBtn, false);
        haptic('ok');
        close();
        updateCustomTagSheet();
        updateChooserButtons();
        alertMsg("✅ Muvaffaqiyatli saqlandi!");
      }).catch(function (e) {
        busy(saveBtn, false);
        haptic('err');
        alertMsg(e.message || "Xatolik yuz berdi");
      });
    });

    var cancelBtn = h('button', { class: 'auc-btn ghost', type: 'button', style: 'margin-top:8px', onclick: function () { haptic(); close(); } }, 'Bekor qilish');

    var card = h('div', { class: 'auc-paybox', style: 'max-height:85vh;overflow:auto' }, [
      h('div', { style: 'font-size:17px;font-weight:800;margin-bottom:4px;text-align:center' }, '✏️ Atmetka va matnlarni tahrirlash'),
      h('div', { class: 'auc-note', style: 'margin-bottom:12px;text-align:center' }, 'Copy qilinadigan matnlar va qoidalarni kiritish'),

      h('div', { style: 'font-size:12px;font-weight:800;color:var(--brand-blue-2,#55a9ff);margin-bottom:4px' }, '1. Oddiy atmetka:'),
      h('div', { style: 'font-size:11px;color:var(--muted-foreground);margin-bottom:3px' }, 'Sarlavha & Izoh:'),
      inSimpleTitle,
      inSimpleSub,
      h('div', { style: 'font-size:11px;color:var(--muted-foreground);margin-bottom:3px' }, 'Copy qiladigan joyini kiriting:'),
      inSimpleCopy,
      h('div', { style: 'font-size:11px;color:var(--muted-foreground);margin-bottom:3px' }, 'Qoidasini kiriting (kichik qoida, agar bo\'lsa):'),
      inSimpleRule,

      h('div', { style: 'font-size:12px;font-weight:800;color:var(--brand-gold,#f1aa05);margin-top:10px;margin-bottom:4px' }, '2. Text qo\'shish:'),
      h('div', { style: 'font-size:11px;color:var(--muted-foreground);margin-bottom:3px' }, 'Sarlavha & Izoh:'),
      inPremTitle,
      inPremSub,
      h('div', { style: 'font-size:11px;color:var(--muted-foreground);margin-bottom:3px' }, 'Copy qiladigan joyini kiriting:'),
      inPremCopy,
      h('div', { style: 'font-size:11px;color:var(--muted-foreground);margin-bottom:3px' }, 'Qoidasini kiriting (kichik qoida):'),
      inPremRule,

      saveBtn,
      cancelBtn
    ]);

    ov = h('div', { class: 'auc-payov' }, card);
    ov.style.zIndex = '2147483600';
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.body.appendChild(ov);
  }

  function updateCustomTagSheet() {
    var sheet = document.querySelector('[data-auc-full]') || document.querySelector('div[role="dialog"]');
    if (!sheet) return;
    var h2 = sheet.querySelector('h2');
    if (!h2) return;
    var title = (h2.textContent || '').trim();
    var isPrem = title.indexOf("Text qo") >= 0 || (TAG.opt_prem_title && title.indexOf(TAG.opt_prem_title) >= 0) || (window.__aucPremAt && Date.now() - window.__aucPremAt < 30000);
    var isSimple = !isPrem && (title.indexOf("Oddiy") >= 0 || (TAG.opt_simple_title && title.indexOf(TAG.opt_simple_title) >= 0));
    if (!isPrem && !isSimple) return;

    if (isPrem) {
      sheet.setAttribute('data-auc-premdone', '1');
      window.__aucPremActive = true;
    } else {
      sheet.removeAttribute('data-auc-premdone');
      window.__aucPremActive = false;
    }

    // 1. Hide/remove old target account card
    var lbl = findTextEl(sheet, TXT_TARGET, 'p');
    if (lbl) {
      var oldCard = lbl.closest('.rounded-\\[var\\(--r-lg\\)\\]') || lbl.parentElement;
      if (oldCard) {
        oldCard.style.setProperty('display', 'none', 'important');
        oldCard.setAttribute('data-auc-target-card', '1');
        try { oldCard.remove(); } catch(e){}
      }
    }
    var allBtns = sheet.querySelectorAll('button');
    for (var bi = 0; bi < allBtns.length; bi++) {
      var btxt = (allBtns[bi].textContent || '').trim();
      if (btxt === 'Profilni ochish' || btxt === 'Открыть профиль' || btxt === 'Open profile') {
        var pcard = allBtns[bi].closest('.rounded-\\[var\\(--r-lg\\)\\]') || allBtns[bi].parentElement.parentElement;
        if (pcard) {
          pcard.style.setProperty('display', 'none', 'important');
          pcard.setAttribute('data-auc-target-card', '1');
          try { pcard.remove(); } catch(e){}
        }
      }
    }
    var oldRules = sheet.querySelector('.auc-rules');
    if (oldRules) oldRules.remove();

    // 2. Determine copy text and rule text
    var copyText = (isPrem ? TAG.prem_copy : TAG.simple_copy) || '';
    var ruleText = (isPrem ? TAG.prem_rule : TAG.simple_rule) || '';
    if (!copyText) {
      if (isSimple) copyText = '@top_sxema_rek67';
      else copyText = 'Need an Instagram marketplace? Visit topsxema.uz';
    }

    // 3. Put rule inside the top card right below the title (o'zi tepasida bitta bo'lim bor, o'shayerda qoida bo'ladi)
    var introCard = sheet.querySelector('.flex.items-start.gap-3');
    if (introCard) {
      var introP = introCard.querySelector('p');
      var topRuleText = ruleText && ruleText.trim() ? ruleText.trim() : (isSimple ? 'Quyidagi akkauntni videongizda atmetka qiling, havolasini pastga joylashtiring — prosmotr oshgani sayin hisobingizga pul tushadi.' : 'Qoidaga muvofiq atmetka qiling');
      if (introP) {
        introP.style.display = '';
        introP.style.whiteSpace = 'pre-wrap';
        introP.style.lineHeight = '1.45';
        introP.textContent = topRuleText;
      }
    }

    // 4. Render copy box with native-style Nusxalash button
    var cardKey = (isPrem ? 'prem:' : 'simple:') + copyText + '::' + (TAG.admin ? '1' : '0');
    var existingCard = sheet.querySelector('#auc-tag-custom-card');

    if (!existingCard) {
      existingCard = h('div', { id: 'auc-tag-custom-card', class: 'auc-custom-tag-box' });
    }

    var container = sheet.querySelector('.space-y-4') || sheet;
    var tiersList = container.querySelector('.space-y-1\\.5');

    // Joylashuv tartibi:
    // 1. Atmetka matni (existingCard) — tepasida turishi kerak
    // 2. Qoida (introCard) — uni pasida
    // 3. Narxi (tiersList) — uni pasida (qancha prosmotrga qancha berishi)
    if (introCard && introCard.parentElement === container) {
      if (existingCard.nextElementSibling !== introCard) {
        container.insertBefore(existingCard, introCard);
      }
      if (tiersList && tiersList.parentElement === container && introCard.nextElementSibling !== tiersList) {
        container.insertBefore(introCard, tiersList);
      }
    } else if (container.firstElementChild && container.firstElementChild !== existingCard) {
      container.insertBefore(existingCard, container.firstElementChild);
    }

    // 5. Mening postlarim oldiga Yangiliklar kanali linki
    attachNewsChannelLink(sheet);

    if (existingCard.getAttribute('data-ckey') === cardKey) return;

    existingCard.setAttribute('data-ckey', cardKey);
    existingCard.innerHTML = '';

    // Copy Card
    var copyBox = h('div', { class: 'auc-copy-card' + (isPrem ? ' auc-copy-prem' : '') });

    // Header with SVG Tag icon
    var copyHead = h('div', { class: 'auc-copy-header' });
    var labelWrap = h('div', { class: 'auc-copy-label-wrap' });
    labelWrap.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-tag shrink-0"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"></path><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"></circle></svg><span class="auc-copy-label">Atmetka matni</span>';
    copyHead.appendChild(labelWrap);

    // Content text box
    var copyContent = h('div', { class: 'auc-copy-content', title: 'Bosing — nusxalash' }, copyText);

    // Native-style Nusxalash button with SVG Copy icon
    var copyBtn = h('button', { type: 'button', class: 'auc-copy-btn-native' });
    var iconCopyHtml = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-copy shrink-0"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>';
    var iconCheckHtml = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check shrink-0" style="color:#10b981"><polyline points="20 6 9 17 4 12"></polyline></svg>';

    copyBtn.innerHTML = iconCopyHtml + '<span>Nusxalash</span>';

    function doCopy() {
      haptic('light');
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(copyText);
        } else {
          var ta = document.createElement('textarea');
          ta.value = copyText;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
      } catch (e) {}
      copyBtn.innerHTML = iconCheckHtml + '<span>Nusxalandi!</span>';
      copyBtn.classList.add('copied');
      setTimeout(function () {
        copyBtn.innerHTML = iconCopyHtml + '<span>Nusxalash</span>';
        copyBtn.classList.remove('copied');
      }, 1800);
    }

    copyBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      doCopy();
    });
    copyContent.addEventListener('click', doCopy);

    copyBox.appendChild(copyHead);
    copyBox.appendChild(copyContent);
    copyBox.appendChild(copyBtn);
    existingCard.appendChild(copyBox);

    // Admin edit row (agar admin bo'lsa)
    if (TAG.admin) {
      var adminRow = h('div', { class: 'auc-admin-row' });
      var editBtn = h('button', {
        type: 'button',
        class: 'auc-rules-edit',
        style: 'margin-top:8px;padding:6px 14px;font-size:12px;font-weight:700',
        onclick: function (e) {
          e.stopPropagation();
          haptic();
          openTagOptionsEditor();
        }
      }, '✏️ Matn va qoidani tahrirlash');
      adminRow.appendChild(editBtn);

      if (isPrem) {
        var tiersBtn = h('button', {
          type: 'button',
          class: 'auc-rules-edit',
          style: 'margin-top:8px;margin-left:8px;padding:6px 14px;font-size:12px;font-weight:700',
          onclick: function (e) {
            e.stopPropagation();
            haptic();
            openTiers('premium');
          }
        }, 'Prosmotr narxlari');
        adminRow.appendChild(tiersBtn);
      }
      existingCard.appendChild(adminRow);
    }
  }

  function attachNewsChannelLink(sheet) {
    if (!sheet) return;
    var allH2s = sheet.querySelectorAll('h2');
    for (var hi = 0; hi < allH2s.length; hi++) {
      var h2El = allH2s[hi];
      var h2Text = (h2El.textContent || '').trim();
      if (h2Text.indexOf('Mening postlarim') >= 0 || h2Text.indexOf('Мои посты') >= 0 || h2Text.indexOf('My posts') >= 0) {
        if (!h2El.querySelector('.auc-news-link')) {
          h2El.style.display = 'flex';
          h2El.style.alignItems = 'center';
          h2El.style.justifyContent = 'space-between';
          h2El.style.gap = '8px';

          var newsLink = h('a', {
            class: 'auc-news-link',
            href: 'https://t.me/sx_marketing',
            target: '_blank',
            rel: 'noopener noreferrer'
          });
          newsLink.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg><span>Yangiliklar kanali</span>';

          newsLink.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            try { haptic('light'); } catch (err) {}
            var url = 'https://t.me/sx_marketing';
            try {
              if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.openTelegramLink) {
                window.Telegram.WebApp.openTelegramLink(url);
                return;
              }
            } catch (err) {}
            window.open(url, '_blank', 'noopener,noreferrer');
          });

          h2El.appendChild(newsLink);
        }
        break;
      }
    }
  }

  function premiumSheet() {
    updateCustomTagSheet();
  }
  function simpleSheet() {
    updateCustomTagSheet();
  }

  st.textContent += '[data-auc-target-card]{display:none!important}' +
    '.auc-news-link{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:700;text-transform:none;letter-spacing:normal;color:var(--brand-blue-2,#55a9ff);background:rgba(85,169,255,0.12);border:1px solid rgba(85,169,255,0.28);border-radius:999px;padding:3px 10px;text-decoration:none;cursor:pointer;transition:all 0.15s ease;user-select:none;-webkit-tap-highlight-color:transparent;margin-left:auto}' +
    '.auc-news-link:active{transform:scale(0.96);background:rgba(85,169,255,0.22)}' +
    '.auc-custom-tag-box{margin-bottom:12px}' +
    '.auc-copy-card{border-radius:var(--r-lg,16px);padding:14px;background:var(--card-surface,rgba(255,255,255,0.05));box-shadow:var(--glass-shadow);border:1px solid rgba(255,255,255,0.08);transition:border-color 0.2s}' +
    '.auc-copy-card.auc-copy-prem{border-color:rgba(255,255,255,0.08)}' +
    '.auc-copy-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}' +
    '.auc-copy-label-wrap{display:flex;align-items:center;gap:6px;color:var(--muted-foreground,#8e8e93)}' +
    '.auc-copy-label{font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted-foreground,#8e8e93)}' +
    '.auc-copy-prem .auc-copy-label-wrap{color:var(--brand-gold,#f1aa05)}' +
    '.auc-copy-prem .auc-copy-label{color:var(--brand-gold,#f1aa05)}' +
    '.auc-copy-content{font-size:15px;font-weight:700;line-height:1.45;color:var(--brand-blue-2,#55a9ff);background:rgba(255,255,255,0.04);border-radius:var(--r-md,10px);padding:11px 14px;cursor:pointer;user-select:all;white-space:pre-wrap;word-break:break-word;border:1px dashed rgba(85,169,255,0.25);transition:background 0.15s}' +
    '.auc-copy-prem .auc-copy-content{color:var(--brand-gold,#f1aa05);border-color:rgba(255,255,255,0.14)}' +
    '.auc-copy-content:active{background:rgba(255,255,255,0.08)}' +
    '.auc-copy-btn-native{width:100%;margin-top:10px;display:flex;align-items:center;justify-content:center;gap:8px;padding:10px 16px;border-radius:var(--r-md,12px);font-size:13.5px;font-weight:600;font-family:inherit;color:var(--foreground,#fff);background:var(--glass-bg,rgba(255,255,255,0.08));backdrop-filter:var(--glass-blur,blur(16px));-webkit-backdrop-filter:var(--glass-blur,blur(16px));box-shadow:var(--glass-shadow,0 2px 8px rgba(0,0,0,0.25));border:1px solid rgba(255,255,255,0.1);cursor:pointer;transition:all 0.15s ease}' +
    '.auc-copy-btn-native:active{transform:scale(0.98)}' +
    '.auc-copy-btn-native.copied{background:rgba(16,185,129,0.15)!important;border-color:rgba(16,185,129,0.35)!important;color:#10b981!important}' +
    '.auc-admin-row{margin-top:6px;display:flex;align-items:center;flex-wrap:wrap}' +
    '.auc-rules-edit{margin-top:10px;border:0;border-radius:999px;padding:7px 14px;font-size:12.5px;font-weight:700;color:#f1aa05;background:rgba(241,170,5,.14);cursor:pointer;font-family:inherit}'
    '.auc-copy-card{border-radius:var(--r-lg,16px);padding:14px;background:var(--card-surface,rgba(255,255,255,0.05));box-shadow:var(--glass-shadow);border:1px solid rgba(255,255,255,0.08);transition:border-color 0.2s}' +
    '.auc-copy-card.auc-copy-prem{border-color:rgba(255,255,255,0.08)}' +
    '.auc-copy-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}' +
    '.auc-copy-label-wrap{display:flex;align-items:center;gap:6px;color:var(--muted-foreground,#8e8e93)}' +
    '.auc-copy-label{font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted-foreground,#8e8e93)}' +
    '.auc-copy-prem .auc-copy-label-wrap{color:var(--brand-gold,#f1aa05)}' +
    '.auc-copy-prem .auc-copy-label{color:var(--brand-gold,#f1aa05)}' +
    '.auc-copy-content{font-size:15px;font-weight:700;line-height:1.45;color:var(--brand-blue-2,#55a9ff);background:rgba(255,255,255,0.04);border-radius:var(--r-md,10px);padding:11px 14px;cursor:pointer;user-select:all;white-space:pre-wrap;word-break:break-word;border:1px dashed rgba(85,169,255,0.25);transition:background 0.15s}' +
    '.auc-copy-prem .auc-copy-content{color:var(--brand-gold,#f1aa05);border-color:rgba(255,255,255,0.14)}' +
    '.auc-copy-content:active{background:rgba(255,255,255,0.08)}' +
    '.auc-copy-btn-native{width:100%;margin-top:10px;display:flex;align-items:center;justify-content:center;gap:8px;padding:10px 16px;border-radius:var(--r-md,12px);font-size:13.5px;font-weight:600;font-family:inherit;color:var(--foreground,#fff);background:var(--glass-bg,rgba(255,255,255,0.08));backdrop-filter:var(--glass-blur,blur(16px));-webkit-backdrop-filter:var(--glass-blur,blur(16px));box-shadow:var(--glass-shadow,0 2px 8px rgba(0,0,0,0.25));border:1px solid rgba(255,255,255,0.1);cursor:pointer;transition:all 0.15s ease}' +
    '.auc-copy-btn-native:active{transform:scale(0.98)}' +
    '.auc-copy-btn-native.copied{background:rgba(16,185,129,0.15)!important;border-color:rgba(16,185,129,0.35)!important;color:#10b981!important}' +
    '.auc-rule-card{margin-top:10px;border-radius:var(--r-md,12px);padding:12px 14px;background:rgba(241,170,5,0.07);border:1px solid rgba(241,170,5,0.22)}' +
    '.auc-rule-label-wrap{display:flex;align-items:center;gap:5px;color:var(--brand-gold,#f1aa05);margin-bottom:5px}' +
    '.auc-rule-label{font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--brand-gold,#f1aa05)}' +
    '.auc-rule-text{font-size:13px;line-height:1.45;color:var(--foreground,#fff);white-space:pre-wrap;word-break:break-word}' +
    '.auc-admin-row{margin-top:6px;display:flex;align-items:center;flex-wrap:wrap}' +
    '.auc-rules-edit{margin-top:10px;border:0;border-radius:999px;padding:7px 14px;font-size:12.5px;font-weight:700;color:#f1aa05;background:rgba(241,170,5,.14);cursor:pointer;font-family:inherit}'
    '.auc-copy-card{border-radius:16px;padding:12px 14px;background:var(--card-surface,rgba(255,255,255,0.05));border:1px solid rgba(85,169,255,0.3);box-shadow:0 4px 16px rgba(0,0,0,0.2);transition:all 0.2s}' +
    '.auc-copy-card.auc-copy-prem{border-color:rgba(255,255,255,0.08)}' +
    '.auc-copy-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}' +
    '.auc-copy-label{font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--brand-blue-2,#55a9ff)}' +
    '.auc-copy-prem .auc-copy-label{color:var(--brand-gold,#f1aa05)}' +
    '.auc-copy-btn{display:inline-flex;align-items:center;gap:5px;border:0;border-radius:999px;padding:5px 12px;font-size:12px;font-weight:700;font-family:inherit;color:#fff;background:linear-gradient(135deg,#0088cc,#006699);cursor:pointer;transition:all 0.15s ease}' +
    '.auc-copy-btn:active{transform:scale(0.95)}' +
    '.auc-copy-btn.copied{background:#10b981!important;color:#fff!important}' +
    '.auc-copy-content{font-size:14px;font-weight:600;line-height:1.45;color:var(--foreground,#fff);background:rgba(0,0,0,0.25);border-radius:10px;padding:10px 12px;cursor:pointer;user-select:all;white-space:pre-wrap;word-break:break-word;border:1px dashed rgba(255,255,255,0.18)}' +
    '.auc-copy-content:active{opacity:0.85}' +
    '.auc-rule-card{margin-top:10px;border-radius:14px;padding:11px 13px;background:rgba(241,170,5,0.08);border:1px solid rgba(241,170,5,0.25)}' +
    '.auc-rule-label{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;color:var(--brand-gold,#f1aa05);margin-bottom:4px}' +
    '.auc-rule-text{font-size:12.5px;line-height:1.45;color:var(--foreground,#fff);white-space:pre-wrap;word-break:break-word}' +
    '.auc-admin-row{margin-top:6px;display:flex;align-items:center;flex-wrap:wrap}' +
    '.auc-rules-edit{margin-top:10px;border:0;border-radius:999px;padding:7px 14px;font-size:12.5px;font-weight:700;color:#f1aa05;background:rgba(241,170,5,.14);cursor:pointer;font-family:inherit}'

  function openTiers(kind) {
    var prem = kind === 'premium';
    var old = document.querySelector('.auc-payov'); if (old) old.remove();
    var rows = [];
    var list = h('div');
    var ov;
    function close() { if (ov) ov.remove(); }
    function addRow(views, reward) {
      var vIn = h('input', { class: 'auc-in', inputmode: 'numeric', placeholder: 'Prosmotr', value: views ? money(views) : '' });
      var rIn = h('input', { class: 'auc-in', inputmode: 'numeric', placeholder: "So'm", value: reward ? money(reward) : '' });
      [vIn, rIn].forEach(function (el) { el.addEventListener('input', function () { var n = parseInt(el.value.replace(/\D/g, ''), 10); el.value = n ? money(n) : ''; }); });
      var row = { v: vIn, r: rIn };
      var del = h('button', { type: 'button', class: 'auc-tier-del', 'aria-label': "O'chirish" }, '✕');
      var el = h('div', { class: 'auc-tier' }, [h('label', null, ['Prosmotr', vIn]), h('label', null, ["Narx (so'm)", rIn]), del]);
      del.addEventListener('click', function () { haptic(); rows.splice(rows.indexOf(row), 1); el.remove(); });
      rows.push(row); list.appendChild(el);
    }
    var add = h('button', { class: 'auc-btn ghost', type: 'button' }, "+ Qo'shish");
    add.addEventListener('click', function () { haptic(); addRow(0, 0); });
    var save = h('button', { class: 'auc-btn hot', type: 'button' }, 'Saqlash');
    save.addEventListener('click', function () {
      var tiers = [];
      for (var i = 0; i < rows.length; i++) {
        var v = parseInt(rows[i].v.value.replace(/\D/g, ''), 10) || 0, r = parseInt(rows[i].r.value.replace(/\D/g, ''), 10) || 0;
        if (!v && !r) continue;
        if (!v || !r) { haptic('err'); return alertMsg("Har bir qatorda prosmotr soni va narxni kiriting"); }
        tiers.push({ views: v, reward: r });
      }
      busy(save, true);
      api('POST', '/api/auction/admin/reward-tiers', { tiers: tiers, kind: prem ? 'premium' : 'simple' }).then(function () {
        haptic('ok'); close();
        alertMsg("Saqlandi. Yangi narxlar 1 daqiqa ichida hammaga ko'rinadi.");
      }).catch(function (e) { busy(save, false); alertMsg(e.message); });
    });
    var cancel = h('button', { class: 'auc-btn ghost', type: 'button' }, 'Bekor qilish');
    cancel.addEventListener('click', function () { haptic(); close(); });
    var card = h('div', { class: 'auc-paybox', style: 'max-height:85vh;overflow:auto' }, [
      h('div', { style: 'font-size:18px;font-weight:800;margin-bottom:4px' }, 'Prosmotr narxlari'),
      h('div', { class: 'auc-note', style: 'margin:0 0 6px' }, "Oddiy atmetka: nechta prosmotr uchun qancha so'm to'lanadi."),
      list, add, save, cancel,
    ]);
    ov = h('div', { class: 'auc-payov' }, card);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.body.appendChild(ov);
    list.appendChild(h('div', { class: 'auc-skel', style: 'height:60px' }));
    api('GET', '/api/auction/admin/reward-tiers' + (prem ? '?kind=premium' : '')).then(function (j) {
      list.innerHTML = '';
      (j.tiers || []).forEach(function (t) { addRow(t.views, t.reward); });
      if (!rows.length) addRow(0, 0);
    }).catch(function (e) { list.innerHTML = ''; list.appendChild(h('div', { class: 'auc-note' }, e.message)); });
  }

  var BUD = { b: null };
  var BUD_TITLES = ['Atmetka uchun ajratilgan pul', 'Выделенный бюджет на отметки', 'Budget allocated for tags'];
  function fmtB(b) { return b && b.enabled ? ("Qolgan: " + money(b.remaining) + " so'm · jami: " + money(b.total) + " · to'langan: " + money(b.spent)) : "Pul ajratilmagan — to'lovlar cheklanmagan"; }
  function loadBud(cb) {
    api('GET', '/api/auction/admin/tag-budgets').then(function (j) { BUD.b = (j.budgets || {}).TAG_ONLY || null; paintBudgetCards(BUD.b); if (cb) cb(BUD.b); })
      .catch(function (e) { if (cb) cb(null, e); });
  }
  function paintBudgetCards(b) {
    var ps = document.querySelectorAll('p');
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      if (p.childElementCount !== 0 || BUD_TITLES.indexOf(p.textContent.trim()) < 0) continue;
      var c = p.parentElement; if (!c || c.closest('[data-auc-hide]')) continue;
      if (!b || !b.enabled) { c.style.display = 'none'; continue; }
      c.style.display = '';
      var big = c.children[1] && c.children[1].firstElementChild;
      if (big) { big.textContent = money(b.remaining) + " so'm"; big.style.color = b.remaining > 0 ? 'var(--brand-green)' : 'var(--destructive)'; }
      var bar = c.children[2] && c.children[2].firstElementChild;
      if (bar) bar.style.width = (b.total > 0 ? Math.min(100, Math.round(b.spent / b.total * 100)) : 0) + '%';
      var bs = c.children[3] ? c.children[3].querySelectorAll('b') : [];
      if (bs[0]) bs[0].textContent = money(b.total) + " so'm";
      if (bs[1]) bs[1].textContent = money(b.spent) + " so'm";
    }
    document.querySelectorAll('[data-auc-bstat]').forEach(function (el) { el.textContent = fmtB(b); });
  }
  function numIn(v) {
    var inp = h('input', { class: 'auc-in', inputmode: 'numeric', placeholder: "Summa (so'm)", style: 'text-align:center;font-weight:800;font-size:20px' });
    if (v) inp.value = money(v);
    inp.addEventListener('input', function () { var x = parseInt(String(inp.value).replace(/\D/g, ''), 10) || 0; inp.value = x ? money(x) : ''; });
    inp.num = function () { return parseInt(String(inp.value).replace(/\D/g, ''), 10) || 0; };
    return inp;
  }
  function budgetAction(mode) {
    var old = document.querySelector('.auc-payov'); if (old) old.remove();
    var ov; function close() { if (ov) ov.remove(); }
    var T = { add: "➕ Pul qo'shish", set: "✏️ Summani tahrirlash", clear: "🗑 Ajratilgan pulni o'chirish" };
    var H = { add: "Kiritilgan summa hozirgi pulga qo'shiladi.", set: "Jami ajratilgan summa shu songa almashtiriladi. To'langan pul o'zgarmaydi.", clear: "Ajratilgan pul olib tashlanadi. Shundan keyin to'lovlar cheklovsiz davom etadi." };
    var stat = h('div', { class: 'auc-note', 'data-auc-bstat': '1', style: 'text-align:center;margin-bottom:10px;font-weight:700' }, fmtB(BUD.b));
    var inp = mode === 'clear' ? null : numIn(mode === 'set' && BUD.b && BUD.b.enabled ? BUD.b.total : 0);
    var go = h('button', { class: 'auc-btn', style: 'margin-top:10px' + (mode === 'clear' ? ';background:#ff5a5f;color:#fff' : '') }, mode === 'clear' ? "Ha, o'chirish" : 'Saqlash');
    go.addEventListener('click', function () {
      var x = inp ? inp.num() : 0;
      if (mode !== 'clear' && !x) { haptic('err'); return alertMsg('Summani kiriting'); }
      busy(go, true);
      api('POST', '/api/auction/admin/tag-budget', { method: 'TAG_ONLY', total: x, mode: mode }).then(function (r) {
        busy(go, false); haptic('ok'); BUD.b = r.budget; paintBudgetCards(r.budget); close();
      }).catch(function (e) { busy(go, false); haptic('err'); alertMsg(e.message); });
    });
    var card = h('div', { class: 'auc-paybox' }, [
      h('div', { class: 'auc-lbl', style: 'display:block;text-align:center;font-size:16px;font-weight:800;margin-bottom:4px' }, T[mode]),
      h('div', { class: 'auc-note', style: 'text-align:center;margin-bottom:8px' }, H[mode]),
      stat, inp, go,
      h('button', { class: 'auc-btn ghost', style: 'margin-top:8px', onclick: function () { haptic(); close(); } }, 'Bekor qilish'),
    ]);
    ov = h('div', { class: 'auc-payov' }, card);
    ov.style.zIndex = '2147483600';
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.body.appendChild(ov);
    if (!BUD.b) loadBud();
    if (inp) setTimeout(function () { try { inp.focus(); } catch (e) {} }, 60);
  }
  function budgetButtons() {
    return h('div', { style: 'display:flex;gap:6px' }, [['add', "➕ Qo'shish"], ['set', '✏️ Tahrirlash'], ['clear', "🗑 O'chirish"]].map(function (x) {
      return h('button', { type: 'button', class: 'auc-rules-edit', style: 'flex:1;margin:0;padding:10px 4px;text-align:center' + (x[0] === 'clear' ? ';color:#ff5a5f' : ''), onclick: function (e) { e.stopPropagation(); haptic(); budgetAction(x[0]); } }, x[1]);
    }));
  }
  function openBudgets() {
    var old = document.querySelector('.auc-payov'); if (old) old.remove();
    var ov; function close() { if (ov) ov.remove(); }
    var stat = h('div', { class: 'auc-note', 'data-auc-bstat': '1', style: 'text-align:center;margin-bottom:12px;font-weight:700' }, 'Yuklanmoqda...');
    var card = h('div', { class: 'auc-paybox' }, [
      h('div', { class: 'auc-lbl', style: 'display:block;text-align:center;font-size:16px;font-weight:800;margin-bottom:4px' }, "💰 Atmetka uchun ajratilgan pul"),
      h('div', { class: 'auc-note', style: 'text-align:center;margin-bottom:8px' }, "Oddiy atmetka va Text qo'shish uchun umumiy pul"),
      stat, budgetButtons(),
      h('button', { class: 'auc-btn ghost', style: 'margin-top:12px', onclick: function () { haptic(); close(); } }, 'Yopish'),
    ]);
    ov = h('div', { class: 'auc-payov' }, card);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.body.appendChild(ov);
    loadBud(function (b, err) { stat.textContent = err ? err.message : fmtB(b); });
  }
  function chooserAdminBar() {
    if (!TAG.admin) { if (!TAG.__rl) { TAG.__rl = 1; loadTagRules(function () {}); } return; }
    var hs = document.querySelectorAll('h2'), h2 = null;
    for (var i = 0; i < hs.length; i++) if (hs[i].textContent.trim().indexOf('Qaysi usulni tanlaysiz') === 0) h2 = hs[i];
    if (!h2 || !h2.parentElement || !h2.parentElement.parentNode) return;
    var sheet = h2.parentElement.parentNode;
    if (sheet.querySelector('#auc-badmin')) return;
    var stat = h('div', { 'data-auc-bstat': '1', style: 'font-size:12.5px;font-weight:700;margin:2px 0 10px;line-height:1.35' }, 'Yuklanmoqda...');
    var editOptionsBtn = h('button', {
      type: 'button',
      class: 'auc-rules-edit',
      style: 'width:100%;margin-top:8px;padding:9px;text-align:center;color:#55a9ff;background:rgba(85,169,255,.14)',
      onclick: function (e) {
        e.stopPropagation();
        haptic();
        openTagOptionsEditor();
      }
    }, "✏️ Matn va qoidalarni tahrirlash");
    var bar = h('div', { id: 'auc-badmin', style: 'border-radius:18px;padding:12px;background:rgba(245,180,0,.08);border:1px solid rgba(245,180,0,.28)' }, [
      h('div', { style: 'font-size:11px;font-weight:800;letter-spacing:normal;text-transform:none;color:var(--brand-gold,#f5b400)' }, 'Admin · Ajratilgan pul va variantlar'),
      stat,
      budgetButtons(),
      editOptionsBtn
    ]);
    sheet.insertBefore(bar, h2.parentElement.nextSibling);
    loadBud(function (b, err) { stat.textContent = err ? err.message : fmtB(b); });
  }

  function simpleSheet() { return; }
  function hideSheetBudget() {
    var fullSheet = document.querySelector('[data-auc-full]');
    if (!fullSheet) return;
    var ps = fullSheet.querySelectorAll('p');
    for (var i = 0; i < ps.length; i++) {
      if (ps[i].textContent.trim().indexOf('Atmetka uchun ajratilgan pul') === 0) {
        var card = ps[i].closest('.rounded-\\[var\\(--r-lg\\)\\]') || ps[i].parentElement;
        if (card) card.style.display = 'none';
      }
    }
  }
  function updateChooserButtons() {
    var btns = document.querySelectorAll('div.space-y-2\\.5 button, div[class*="space-y"] button');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      var titleEl = b.querySelector('h3, .font-bold');
      var descEl = b.querySelector('p.text-muted-foreground, p[class*="text-muted"]');
      if (!titleEl) continue;
      var t = titleEl.textContent.trim();
      if (t === 'Oddiy atmetka' || (TAG.opt_simple_title && t === TAG.opt_simple_title)) {
        if (TAG.opt_simple_title) titleEl.textContent = TAG.opt_simple_title;
        if (TAG.opt_simple_sub && descEl) descEl.textContent = TAG.opt_simple_sub;
      } else if (t === "Text qo'shish" || (TAG.opt_prem_title && t === TAG.opt_prem_title)) {
        if (TAG.opt_prem_title) titleEl.textContent = TAG.opt_prem_title;
        if (TAG.opt_prem_sub && descEl) descEl.textContent = TAG.opt_prem_sub;
      }
    }
  }
  function stripTagAt() {
    var lbl = findTextEl(document, TXT_TARGET, 'p');
    if (!lbl || !lbl.parentElement) return;
    var els = lbl.parentElement.querySelectorAll('*');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el === lbl || el.closest('button,a') || el.hasAttribute('data-auc-hide')) continue;
      if (/^@?[A-Za-z0-9._]{2,40}$/.test((el.textContent || '').trim()) && !el.querySelector('button,a,svg')) el.setAttribute('data-auc-hide', '1');
    }
  }

  var FS = window.__aucFS = { on: false, was: false };
  function fullSheetEl() { return document.querySelector('[data-auc-full]'); }
  function fsBack() {
    S.swallowBack = true; setTimeout(function () { S.swallowBack = false; }, 400);
    var el = fullSheetEl(); if (!el) return;
    var b = el.querySelector(':scope > .flex.items-center.justify-between > button');
    if (b) b.click(); else if (el.parentElement) el.parentElement.click();
  }
  fsBack.__aucOwn = true;
  function syncFullBack() {
    if (!tg || !tg.BackButton) return;
    var open = !!fullSheetEl() && !S.sheet;
    if (open && !FS.on) { FS.on = true; FS.was = !!tg.BackButton.isVisible; tg.BackButton.show(); tg.BackButton.onClick(fsBack); }
    else if (!open && FS.on) { FS.on = false; tg.BackButton.offClick(fsBack); if (!FS.was) tg.BackButton.hide(); }
  }
  var PB = { at: 0, b: null };
  function premBudgetLine() {
    return; // oddiy va qimmat atmetka endi bitta umumiy pulda — summa tanlash oynasi tepasida
    var c = document.querySelector('[data-auc-prem]');
    if (!c || c.hasAttribute('data-auc-pb')) return;
    c.setAttribute('data-auc-pb', '1');
    var old = c.querySelector('[data-tb]'); if (old) old.remove();
    var host = c.querySelector('.min-w-0.flex-1') || c;
    function put(b) {
      if (!b || !b.enabled || !c.isConnected) return;
      var f = function (n) { return money(n || 0); };
      host.appendChild(h('p', { class: 'text-[11px] mt-1', style: 'line-height:1.35;color:var(--muted-foreground)' }, ["💰 Ajratilgan pul: ", h('b', { style: 'color:var(--foreground)' }, f(b.total) + " so'm"), " · qolgan ", h('b', { style: 'color:' + (b.remaining > 0 ? 'var(--brand-green)' : 'var(--destructive)') }, f(b.remaining) + " so'm")]));
    }
    if (PB.b && Date.now() - PB.at < 20000) return put(PB.b);
    fetch('/api/tag-campaign/config').then(function (r) { return r.json(); }).then(function (j) { PB.b = j.premiumBudget || null; PB.at = Date.now(); put(PB.b); }).catch(function () {});
  }
  (function patchFetch() {
    var of = window.fetch; if (!of || of.__aucPatched) return;
    var nf = function (input, init) {
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        if (/\/api\/tag-campaign\/(submit|check)/.test(url) && init && typeof init.body === 'string') {
          var isPremMode = !!document.querySelector('[data-auc-premdone]') || !!window.__aucPremActive || (window.__aucPremAt && Date.now() - window.__aucPremAt < 60000);
          if (isPremMode) {
            var b = JSON.parse(init.body);
            b.premium = true;
            init = Object.assign({}, init, { body: JSON.stringify(b) });
          }
        }
      } catch (e) {}
      return of.apply(window, arguments);
    };
    nf.__aucPatched = true; window.fetch = nf;
  })();
  function hideSheetExtras() {
    var lbl = findTextEl(document, TXT_TARGET, 'p'); if (!lbl) return;
    var card = lbl.parentElement, box = card && card.parentElement; if (!box) return;
    if (!card.hasAttribute('data-auc-hide')) card.setAttribute('data-auc-hide', '1');
    var budgetTitles = ['Atmetka uchun ajratilgan pul', 'Выделенный бюджет на отметки', 'Budget allocated for tags'];
    Array.prototype.forEach.call(box.children, function (c) {
      if (c.hasAttribute('data-auc-hide')) return;
      if (c.classList.contains('space-y-1.5') && /prosmotr|просмотр|views/i.test(c.textContent || '')) { c.setAttribute('data-auc-hide', '1'); return; }
      var t = c.firstElementChild;
      if (t && budgetTitles.indexOf((t.textContent || '').trim()) >= 0) c.setAttribute('data-auc-hide', '1');
    });
  }
  function hideVideoBanner() {
    var hs = document.querySelectorAll('.snap-x h3');
    for (var i = 0; i < hs.length; i++) {
      if (hs[i].textContent.trim().indexOf('Sifatli video ulash') !== 0) continue;
      var slide = hs[i].closest('.snap-center');
      if (slide && slide.style.display !== 'none') slide.style.display = 'none';
    }
  }
  function renameToAuction() {
    var els = document.querySelectorAll('.fixed.inset-x-0 span');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.childElementCount === 0 && el.textContent.trim() === 'Video ulash' && !el.closest('.auc-tabs')) el.textContent = 'Auksion';
    }
    var bb = document.querySelectorAll('button[aria-label="Video ulash"]');
    for (var j = 0; j < bb.length; j++) bb[j].setAttribute('aria-label', 'Auksion');
  }
  function checkRouteCleanup() {
    if (window.location.pathname === '/marketplace') return;
    document.documentElement.removeAttribute('data-auc-mode');
    document.body.classList.remove('auc-on');
    stopPoll();
    var root = document.getElementById('auc-root');
    if (root) root.remove();
    var closed = document.getElementById('auc-closed');
    if (closed) closed.remove();
    document.querySelectorAll('[data-auc-mkt-block]').forEach(function (b) {
      b.removeAttribute('data-auc-mkt-block');
      b.removeAttribute('data-auc-block');
    });
    document.querySelectorAll('[data-auc-hide]').forEach(function (el) {
      el.removeAttribute('data-auc-hide');
      el.style.display = '';
    });
    document.querySelectorAll('[data-auc-orig]').forEach(function (el) {
      el.style.display = '';
    });
  }

  function mount() {
    try { renameToAuction(); } catch (e) {}
    try { premiumPicker(); updateCustomTagSheet(); premBudgetLine(); } catch (e) {}
    try { syncFullBack(); } catch (e) {}
    try { hideSheetExtras(); } catch (e) {}
    try { chooserAdminBar(); updateChooserButtons(); hideSheetBudget(); } catch (e) {}
    markFullSheets();

    if (window.location.pathname !== '/marketplace') {
      checkRouteCleanup();
      return;
    }

    try { checkDeepLink(); } catch (e) {}
    try { hideVideoBanner(); } catch (e) {}
    try { hideSheetExtras(); } catch (e) {}
    try { chooserAdminBar(); updateChooserButtons(); hideSheetBudget(); } catch (e) {}
    markFullSheets();
    var nav = findNav();
    if (!nav) return;
    if (!nav.hasAttribute('data-auc-nav')) {
      nav.setAttribute('data-auc-nav', '1');
      var orig = nav.querySelector(':scope > span');
      if (orig) orig.setAttribute('data-auc-orig', '1'), orig.style.display = 'none';
    }
    if (!nav.querySelector('.auc-tabs')) {
      var tabs = h('div', { class: 'auc-tabs' }, [
        h('button', { class: 'auc-tab', 'data-m': 'acc', onclick: function () { setMode('acc'); } }, 'Video ulash'),
        h('span', { class: 'auc-sep' }, '/'),
        h('button', { class: 'auc-tab', 'data-m': 'auc', onclick: function () { setMode('auc'); } }, 'Auksion'),
      ]);
      nav.appendChild(tabs);
    }
    var orig2 = nav.querySelector('[data-auc-orig]');
    if (orig2 && orig2.style.display !== 'none') orig2.style.display = 'none';
    applyMode(nav);
    closedNotice(nav);
  }

  function closedSticker() {
    var box = h('div', { style: 'width:120px;height:120px;margin:0 auto 10px' });
    function play() {
      if (!window.lottie) { box.textContent = '🔒'; box.style.cssText += ';font-size:40px;display:grid;place-items:center'; return; }
      try { window.lottie.loadAnimation({ container: box, renderer: 'svg', loop: true, autoplay: true, path: '/auc-emoji/vu-closed2.json?v=1' }); }
      catch (e) { box.textContent = '🔒'; box.style.cssText += ';font-size:40px;display:grid;place-items:center'; }
    }
    if (window.lottie) play();
    else {
      var s = document.querySelector('script[data-auc-lottie]');
      if (!s) { s = document.createElement('script'); s.src = '/auc-emoji/lottie_light.min.js'; s.setAttribute('data-auc-lottie', '1'); document.head.appendChild(s); }
      s.addEventListener('load', play);
      s.addEventListener('error', function () { box.textContent = '🔒'; box.style.cssText += ';font-size:40px;display:grid;place-items:center'; });
    }
    return box;
  }
  function closedNotice(nav) {
    var block = nav && nav.parentElement; if (!block || !block.parentNode) return;
    var ex = document.getElementById('auc-closed');
    if (S.mode === 'acc') {
      hideTargets(nav).forEach(function (el) { if (el.id !== 'auc-closed' && !el.hasAttribute('data-auc-hide')) el.setAttribute('data-auc-hide', '1'); });
      if (!ex) {
        ex = h('div', { id: 'auc-closed', style: 'margin:14px 16px;padding:26px 18px;border-radius:22px;text-align:center;background:var(--glass-bg,rgba(255,255,255,.04));border:1px solid rgba(255,255,255,.08);box-shadow:var(--glass-shadow,none)' }, [
          closedSticker(),
          h('div', { style: 'font-size:15.5px;font-weight:800;line-height:1.45' }, 'Afsuski Video ulash xizmati yopildi.'),
          h('div', { style: 'margin-top:6px;font-size:13px;line-height:1.5;color:var(--muted-foreground,#9a9a9a)' }, "E'tiboringizni yanada foydali va yangi funksiyalarga qaratamiz."),
        ]);
      }
      if (ex.previousElementSibling !== block) block.parentNode.insertBefore(ex, block.nextSibling);
    } else if (ex) ex.remove();
  }

  function hideTargets(nav) {
    var out = [];
    var block = nav.parentElement;
    if (!block) return out;
    Array.prototype.forEach.call(block.children, function (c) { if (c !== nav && c.id !== 'auc-root') out.push(c); });
    var n = block.nextElementSibling;
    while (n) {
      if (n.id !== 'auc-root') {
        var pos = '';
        try { pos = getComputedStyle(n).position; } catch (e) {}
        if (pos !== 'fixed') out.push(n);
      }
      n = n.nextElementSibling;
    }
    return out;
  }

  function applyMode(nav) {
    if (window.location.pathname !== '/marketplace') return;
    nav = nav || findNav();
    if (!nav) return;
    try { var al = nav.parentElement && nav.parentElement.nextElementSibling; if (al && al.classList.contains('pb-4') && al.classList.contains('space-y-4') && !al.hasAttribute('data-auc-acclist')) al.setAttribute('data-auc-acclist', '1'); } catch (e) {}
    nav.querySelectorAll('.auc-tab').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-m') === S.mode); });
    var tb = nav.querySelector('.auc-tabs'); if (tb) tb.setAttribute('data-on', S.mode);
    var block = nav.parentElement;
    if (block && !block.hasAttribute('data-auc-block')) block.setAttribute('data-auc-block', '1');
    if (block && !block.hasAttribute('data-auc-mkt-block')) block.setAttribute('data-auc-mkt-block', '1');
    document.documentElement.setAttribute('data-auc-mode', S.mode);
    var root = document.getElementById('auc-root');
    if (S.mode === 'auc') {
      document.body.classList.toggle('auc-on', true);
      hideTargets(nav).forEach(function (el) {
        if (!el.hasAttribute('data-auc-hide')) el.setAttribute('data-auc-hide', '1');
        el.style.display = 'none';
      });
      if (!root) {
        root = h('div', { id: 'auc-root' });
        block.parentNode.insertBefore(root, block.nextSibling);
        render();
        load();
      } else if (root.previousElementSibling !== block) {
        block.parentNode.insertBefore(root, block.nextSibling);
      }
    } else {
      document.body.classList.remove('auc-on');
      document.querySelectorAll('[data-auc-hide]').forEach(function (el) {
        el.removeAttribute('data-auc-hide');
        el.style.display = '';
      });
      if (root) root.remove();
    }
  }

  function setMode(m) {
    if (S.mode === m) return;
    haptic();
    S.mode = m;
    lastRenderHash = '';
    try { sessionStorage.setItem('auc_mode', m); } catch (e) {}
    applyMode();
    if (m === 'auc') {
      if (window.location.pathname === '/marketplace') startPoll();
    } else {
      stopPoll();
    }
  }

  var mo = new MutationObserver(function () {
    if (mo._t) return;
    mo._t = setTimeout(function () {
      mo._t = null;
      if (window.location.pathname !== '/marketplace') {
        checkRouteCleanup();
        mount();
        return;
      }
      if (S.mode === 'auc') {
        var nav = findNav();
        if (nav && nav.parentElement) {
          var ch = nav.parentElement.children;
          for (var i = 0; i < ch.length; i++) {
            if (ch[i] !== nav && ch[i].id !== 'auc-root' && ch[i].style.display !== 'none') {
              ch[i].setAttribute('data-auc-hide', '1');
              ch[i].style.display = 'none';
            }
          }
        }
        var arts = document.querySelectorAll('[data-auc-mkt-block] article.cursor-pointer, [data-auc-mkt-block] .grid.grid-cols-2.gap-3');
        for (var j = 0; j < arts.length; j++) {
          if (arts[j].style.display !== 'none') {
            arts[j].setAttribute('data-auc-hide', '1');
            arts[j].style.display = 'none';
          }
        }
      }
      mount();
      document.querySelectorAll('#auc-root,.auc-ov').forEach(emojify);
    }, 40);
  });
  function goToMarketplace() {
    if (window.location.pathname === '/marketplace') return true;
    var btn = document.querySelector('button[aria-label="Auksion"], button[aria-label="Video ulash"]');
    if (!btn) {
      var spans = document.querySelectorAll('.fixed.inset-x-0 span');
      for (var i = 0; i < spans.length; i++) {
        var txt = spans[i].textContent.trim();
        if (txt === 'Auksion' || txt === 'Video ulash') {
          btn = spans[i].closest('button');
          if (btn) break;
        }
      }
    }
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  }

  window.__aucDeepHandled = false;

  function checkDeepLink(force) {
    if (window.__aucDeepHandled && !force) return;

    var p = '';
    try {
      if (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) {
        p = String(tg.initDataUnsafe.start_param);
      }
    } catch (e) {}

    if (!p) {
      try {
        var sp = new URLSearchParams(window.location.search);
        p = sp.get('startapp') || sp.get('tgWebAppStartParam') || '';
        if (!p && (sp.get('tab') === 'auction' || sp.get('tab') === 'auc')) p = 'auction';
      } catch (e) {}
    }

    if (!p) {
      var hsh = (window.location.hash || '').replace(/^#/, '');
      if (hsh.indexOf('auction') >= 0 || hsh.indexOf('auc') >= 0) p = hsh;
    }

    if (!p) {
      var path = window.location.pathname || '';
      if (path.indexOf('/auction') >= 0) {
        var m = path.match(/\/auction(?:_|\/)?(\d+)?/i);
        p = (m && m[1]) ? ('auction_' + m[1]) : 'auction';
      }
    }

    if (!p) {
      try { p = sessionStorage.getItem('auc_deep') || ''; } catch (e) {}
    }

    window.__aucDeepHandled = true;
    try { sessionStorage.removeItem('auc_deep'); } catch (e) {}

    if (p && /auction|auc/i.test(p)) {
      try {
        if (tg && tg.initDataUnsafe) tg.initDataUnsafe.start_param = '';
      } catch (e) {}
      if (window.location.pathname !== '/marketplace') {
        goToMarketplace();
      }
      if (S.mode !== 'auc') {
        setMode('auc');
      }
      var mId = p.match(/(?:auction|auc)[_-]?(\d+)/i);
      if (mId && mId[1]) {
        var targetId = parseInt(mId[1], 10);
        if (targetId > 0 && window.__lastOpenedAucId !== targetId) {
          window.__lastOpenedAucId = targetId;
          setTimeout(function () {
            openDetail(targetId);
          }, 350);
        }
      }
    }
  }

  function boot() {
    try { loadTagRules(); } catch (e) {}
    mount();
    mo.observe(document.body, { childList: true, subtree: true });
    checkDeepLink();
    if (S.mode === 'auc' && window.location.pathname === '/marketplace') startPoll();
    S.timer = setInterval(tickTimers, 1000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden && S.mode === 'auc' && window.location.pathname === '/marketplace') load(true); });
    window.addEventListener('hashchange', function () {
      var h = (window.location.hash || '').replace(/^#/, '');
      if (/^(?:auction|auc)/i.test(h)) {
        checkDeepLink(true);
      }
    });
    window.addEventListener('popstate', function () {
      if (window.location.pathname !== '/marketplace') {
        checkRouteCleanup();
      }
    });
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest && e.target.closest('.fixed.inset-x-0 button');
      if (btn) {
        var txt = btn.textContent.trim();
        if (txt !== 'Auksion' && txt !== 'Video ulash') {
          setTimeout(checkRouteCleanup, 30);
        }
      }
    }, true);
  }
  if (document.body) boot(); else document.addEventListener('DOMContentLoaded', boot);

  function startPoll() {
    stopPoll();
    if (window.location.pathname !== '/marketplace' || S.mode !== 'auc') return;
    S.poll = setInterval(function () {
      if (window.location.pathname !== '/marketplace' || S.mode !== 'auc') {
        stopPoll();
        return;
      }
      var ae = document.activeElement, root = document.getElementById('auc-root');
      if (root && ae && root.contains(ae) && /INPUT|TEXTAREA/.test(ae.tagName)) return;
      if (!document.hidden && !S.sheet) load(true);
    }, 15000);
  }
  function stopPoll() { if (S.poll) clearInterval(S.poll); S.poll = null; }

  function tickTimers() {
    document.querySelectorAll('[data-ends]').forEach(function (el) {
      var iso = el.getAttribute('data-ends');
      el.innerHTML = emoHTML((el.getAttribute('data-pre') || '') + left(iso));
      var ms = new Date(iso).getTime() - now();
      if (el.classList.contains('auc-timer')) el.classList.toggle('hot', ms > 0 && ms < 3600e3);
    });
  }

  // ---------- Ma'lumot yuklash ----------
  function load(silent) {
    if (window.location.pathname !== '/marketplace') return;
    if (S.loading) return;
    S.loading = true;
    if (!silent) { S.items = null; render(); }
    var jobs = [];
    if (!S.me) jobs.push(api('GET', '/api/auction/me').then(function (j) { S.me = j; }).catch(function () {}));
    jobs.push(api('GET', '/api/auction/list?tab=active').then(function (j) {
      S.items = j.items;
      if (!j.items.length) { S.detail = null; return; }
      return api('GET', '/api/auction/' + j.items[0].id).then(function (d) { S.detail = d; });
    }));
    jobs.push(api('GET', '/api/auction/my').then(function (j) { S.my = j; }).catch(function () {}));
    Promise.all(jobs).then(function () {
      S.err = null;
      if (S.me && S.me.isAdmin) return api('GET', '/api/auction/admin/list').then(function (j) { S.admin = j.items; }).catch(function () {});
    }).catch(function (e) { S.err = e.message; }).then(function () { S.loading = false; render(); });
  }

  // ---------- Render ----------
  var ICON_PLUS = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
  var ICON_SHIELD = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';

  // Diqqat talab qiladigan (amal kerak) lotlar
  function attention() {
    var out = [];
    if (!S.my) return out;
    (S.my.selling || []).forEach(function (it) {
      if (['PENDING', 'AWAITING_TRANSFER', 'TRANSFERRED', 'DISPUTED', 'REJECTED'].indexOf(it.status) >= 0) {
        var t = { PENDING: 'Lotingiz tasdiqlash kutmoqda', AWAITING_TRANSFER: 'Sotildi — akkauntni topshiring', TRANSFERRED: 'Xaridor tasdig\'i kutilmoqda', DISPUTED: 'Nizo — admin ko\'rmoqda', REJECTED: 'Lotingiz rad etildi' }[it.status];
        if (it.status === 'REJECTED' && Date.now() - new Date(it.createdAt).getTime() > 3 * 86400e3) return;
        out.push([it, t, it.status === 'AWAITING_TRANSFER' ? '#f1aa05' : it.status === 'REJECTED' || it.status === 'DISPUTED' ? '#ff5a7a' : '#55a9ff']);
      }
    });
    (S.my.bidding || []).forEach(function (it) {
      if (it.isWinner && ['AWAITING_TRANSFER', 'TRANSFERRED', 'DISPUTED'].indexOf(it.status) >= 0) {
        out.push([it, it.status === 'TRANSFERRED' ? '🏆 Akkaunt topshirildi — tekshiring' : it.status === 'DISPUTED' ? 'Nizo — admin ko\'rmoqda' : '🏆 G\'olib bo\'ldingiz — topshirish kutilmoqda', '#f1aa05']);
      }
    });
    return out;
  }

  var lastRenderHash = '';
  function render() {
    if (window.location.pathname !== '/marketplace' || S.mode !== 'auc') {
      var r = document.getElementById('auc-root');
      if (r) r.remove();
      return;
    }
    var root = document.getElementById('auc-root');
    if (!root) return;
    var hash = JSON.stringify({
      err: S.err,
      items: (S.items || []).map(function (it) { return [it.id, it.currentPrice, it.bidsCount, it.status, it.endsAt]; }),
      detail: S.detail ? [S.detail.item.id, S.detail.item.currentPrice, S.detail.item.bidsCount, (S.detail.bids || []).length, (S.detail.leaders || []).map(function(l){ return [l.name, l.amount]; })] : null,
      adminN: (S.admin || []).filter(function (a) { return a.status === 'PENDING' || a.status === 'DISPUTED'; }).length,
      att: attention().map(function (x) { return [x[0].id, x[1], x[2]]; }),
      mode: S.mode
    });
    if (root.hasChildNodes() && hash === lastRenderHash) {
      tickTimers();
      return;
    }
    lastRenderHash = hash;
    root.innerHTML = '';
    var adminN = (S.admin || []).filter(function (a) { return a.status === 'PENDING' || a.status === 'DISPUTED'; }).length;
    if (S.me && S.me.isAdmin) root.appendChild(h('div', { class: 'auc-row', style: 'justify-content:flex-end;padding-bottom:12px' }, [
      h('button', { class: 'auc-round', 'aria-label': 'Admin', onclick: openAdmin, html: ICON_SHIELD + (adminN ? '<span class="auc-n">' + adminN + '</span>' : '') }),
    ]));
    if (S.err) { root.appendChild(h('div', { class: 'auc-empty' }, [h('div', { class: 'e' }, '⚠️'), S.err, h('br'), h('button', { class: 'auc-btn ghost', style: 'max-width:200px;margin:14px auto 0', onclick: function () { load(); } }, 'Qayta urinish')])); return; }
    var att = attention();
    if (att.length) {
      root.appendChild(h('div', { class: 'auc-list', style: 'margin-bottom:12px' }, att.map(function (x) {
        return li(x[0], h('span', { style: 'font-size:18px;color:#8a8a8a' }, '›'), h('span', { style: 'color:' + x[2] + ';font-weight:600' }, x[1]));
      })));
    }
    renderGrid(root);
    tickTimers();
  }

  function openAdmin() {
    haptic();
    var body = openSheet(null, function () { load(true); });
    body.appendChild(h('div', { class: 'auc-hero' }, [h('div', { style: 'font-size:34px' }, '🛡'), h('h3', null, 'Auksion — Admin')]));
    body.appendChild(h('button', { class: 'auc-btn', style: 'margin:0 0 14px', onclick: function () { openCreate(); } }, '+ Yangi lot qo\'shish'));
    (function () {
      var srIn = h('input', { class: 'auc-in', inputmode: 'numeric', placeholder: "Masalan: 200", style: 'text-align:center;font-weight:800;font-size:18px' });
      srIn.addEventListener('input', function () { var x = parseInt(String(srIn.value).replace(/\D/g, ''), 10) || 0; srIn.value = x ? money(x) : ''; });
      var srBtn = h('button', { class: 'auc-btn', style: 'margin-top:8px' }, 'Saqlash');
      srBtn.addEventListener('click', function () {
        var x = parseInt(String(srIn.value).replace(/\D/g, ''), 10) || 0;
        if (!(x > 0)) { haptic('err'); return alertMsg("1 Stars narxini so'mda kiriting"); }
        busy(srBtn, true);
        api('POST', '/api/auction/admin/stars-rate', { rate: x }).then(function (j) {
          busy(srBtn, false); haptic('ok'); srIn.value = money(j.rate);
          alertMsg('✅ Saqlandi: 1 ⭐ = ' + money(j.rate) + " so'm");
        }).catch(function (e) { busy(srBtn, false); haptic('err'); alertMsg(e.message); });
      });
      body.appendChild(h('div', { class: 'auc-box', style: 'margin:0 0 14px' }, [h('span', { class: 'auc-lbl' }, "⭐ Telegram Stars kursi — 1 Stars necha so'm"), srIn, srBtn]));
      api('GET', '/api/auction/stars-rate').then(function (j) { if (j.rate) srIn.value = money(j.rate); }).catch(function () {});
    })();
    var box = h('div');
    body.appendChild(box);
    box.appendChild(h('div', { class: 'auc-skel', style: 'height:140px' }));
    api('GET', '/api/auction/admin/list').then(function (j) { S.admin = j.items; box.innerHTML = ''; renderAdmin(box); }).catch(function (e) { box.innerHTML = ''; box.appendChild(h('div', { class: 'auc-empty' }, e.message)); });
  }

  function renderGrid(root) {
    if (S.items == null) { root.appendChild(h('div', { class: 'auc-skel', style: 'height:420px' })); return; }
    if (!S.items.length || !S.detail || !S.detail.item) {
      root.appendChild(h('div', { class: 'auc-empty', style: 'padding:56px 16px' }, [
        h('div', { class: 'e', style: 'font-size:52px' }, '🔨'),
        h('div', { style: 'font-size:18px;font-weight:800;color:var(--foreground,#fff);margin-bottom:6px' }, 'Hozircha auksion yo\'q'),
        h('span', { style: 'font-size:13px' }, 'Yangi auksion boshlanganda shu yerda chiqadi'),
      ]));
      return;
    }
    var box = h('div', { class: 'auc-inline' });
    root.appendChild(box);
    drawDetail(box, S.detail.item, S.detail.bids, S.detail);
  }

  function card(it) {
    var active = it.status === 'ACTIVE';
    var lead = null;
    if (active && it.iAmLeader) lead = h('div', { class: 'auc-cardlead', style: 'color:#49df64' }, '✓ Siz yetakchisiz');
    else if (active && it.myBid) lead = h('div', { class: 'auc-cardlead', style: 'color:#ff5a7a' }, 'Oshib ketildi');
    return h('div', { class: 'auc-card', onclick: function () { openDetail(it.id); } }, [
      h('div', { class: 'auc-card-top' + (it.photoUrl ? ' shot' : '') }, [
        thumb(it),
        active ? h('div', { class: 'auc-timer', 'data-ends': it.endsAt, 'data-pre': '⏱ ' }) : h('div', { class: 'auc-timer' }, (STATUS[it.status] || [''])[0]),
        h('div', { class: 'auc-bids' }, '🔨 ' + it.bidsCount),
      ]),
      h('div', { class: 'auc-name' }, igName(it)),
      h('div', { class: 'auc-sub' }, kfmt(it.followers) + ' obunachi' + (it.category ? ' · ' + it.category : '')),
      lead,
      h('div', { class: 'auc-prow' }, [
        h('div', { class: 'auc-price' }, [money(it.currentPrice), h('small', null, "so'm")]),
        h('span', { class: 'auc-ibtn', html: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m14.5 12.5-8 8a2.12 2.12 0 1 1-3-3l8-8"/><path d="m16 16 6-6"/><path d="m8 8 6-6"/><path d="m9 7 8 8"/><path d="m21 11-8-8"/></svg>' }),
      ]),
      h('button', {
        class: 'auc-share-btn',
        type: 'button',
        onclick: function (e) {
          e.preventDefault();
          e.stopPropagation();
          haptic();
          shareAuction(it);
        }
      }, [
        h('span', { html: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px;margin-right:5px"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>' }),
        'Ulashish'
      ]),
    ]);
  }

  function li(it, right, sub) {
    return h('div', { class: 'auc-li', onclick: function () { openDetail(it.id); } }, [
      thumb(it),
      h('div', { class: 't' }, [h('b', null, igName(it)), sub || badge(it.status)]),
      h('div', { class: 'p' }, right),
    ]);
  }

  function renderMy(root) {
    if (!S.my) { root.appendChild(h('div', { class: 'auc-skel', style: 'height:140px' })); return; }
    var sel = S.my.selling || [], bid = S.my.bidding || [];
    if (!sel.length && !bid.length) {
      root.appendChild(h('div', { class: 'auc-empty' }, [h('div', { class: 'e' }, '📭'), 'Siz hali auksionda qatnashmagansiz']));
      return;
    }
    if (bid.length) {
      root.appendChild(h('div', { class: 'auc-h' }, 'Stavkalarim'));
      root.appendChild(h('div', { class: 'auc-list' }, bid.map(function (it) {
        var sub;
        if (it.status === 'ACTIVE') sub = h('span', { style: 'color:' + (it.iAmLeader ? '#49df64' : '#ff5a7a') + ';font-weight:700' }, it.iAmLeader ? 'Siz yetakchisiz' : 'Oshib ketildi');
        else if (it.isWinner) sub = h('span', null, [h('span', { style: 'color:#49df64;font-weight:700' }, '🏆 G\'olib · '), (STATUS[it.status] || [''])[0]]);
        else sub = h('span', null, 'Yutqazildi');
        return li(it, [money(it.currentPrice), h('div', { style: 'font-size:11px;color:#9a9a9a;font-weight:600' }, 'Siz: ' + money(it.myBid))], sub);
      })));
    }
    if (sel.length) {
      root.appendChild(h('div', { class: 'auc-h' }, 'Sotayotganlarim'));
      root.appendChild(h('div', { class: 'auc-list' }, sel.map(function (it) {
        return li(it, [money(it.currentPrice), h('div', { style: 'font-size:11px;color:#9a9a9a;font-weight:600' }, it.bidsCount + ' stavka')]);
      })));
    }
  }

  function renderAdmin(root) {
    var adminTools = h('div', { class: 'auc-box', style: 'margin-bottom:14px' }, [
      h('div', { style: 'font-size:14px;font-weight:800;margin-bottom:8px' }, '⚙️ Atmetka va Auksion sozlamalari'),
      h('button', {
        class: 'auc-btn ghost',
        type: 'button',
        style: 'font-size:13px;padding:10px 14px;margin-bottom:6px',
        onclick: function () { haptic(); openTagOptionsEditor(); }
      }, '✏️ "Oddiy atmetka" & "Text qo\'shish" matnlarini tahrirlash'),
      h('button', {
        class: 'auc-btn ghost',
        type: 'button',
        style: 'font-size:13px;padding:10px 14px',
        onclick: function () { haptic(); openBudgets(); }
      }, '💰 Ajratilgan pulni boshqarish')
    ]);
    root.appendChild(adminTools);
    var arr = S.admin || [];
    if (!arr.length) { root.appendChild(h('div', { class: 'auc-empty' }, [h('div', { class: 'e' }, '✅'), 'Ko\'rib chiqiladigan lot yo\'q'])); return; }
    var groups = [['PENDING', 'Tasdiqlash kutilmoqda'], ['DISPUTED', 'Nizolar'], ['AWAITING_TRANSFER', 'Topshirish kutilmoqda'], ['TRANSFERRED', 'Xaridor tasdig\'i kutilmoqda']];
    groups.forEach(function (g) {
      var list = arr.filter(function (a) { return a.status === g[0]; });
      if (!list.length) return;
      root.appendChild(h('div', { class: 'auc-h' }, g[1] + ' (' + list.length + ')'));
      root.appendChild(h('div', { class: 'auc-list' }, list.map(function (it) {
        return li(it, money(it.currentPrice), h('span', null, (it.seller && (it.seller.username ? '@' + it.seller.username : it.seller.firstName)) || ''));
      })));
    });
  }

  // ---------- Sheet ----------
  function openSheet(content, onClose) {
    closeSheet(true);
    var sheet = h('div', { class: 'auc-sheet' }, [h('div', { class: 'auc-grab' })]);
    sheet.style.position = 'relative';
    sheet.appendChild(h('button', { class: 'auc-x', onclick: function () { closeSheet(); } }, '×'));
    var body = h('div');
    sheet.appendChild(body);
    var ov = h('div', { class: 'auc-ov', onclick: function (e) { if (e.target === ov) closeSheet(); } }, sheet);
    document.body.appendChild(ov);
    document.documentElement.style.overflow = 'hidden';
    S.sheet = { ov: ov, body: body, onClose: onClose };
    try { if (tg && tg.disableVerticalSwipes) { S.swWas = tg.isVerticalSwipesEnabled !== false; tg.disableVerticalSwipes(); } } catch (e) {}
    try { if (tg && tg.BackButton) { S.bbWasVisible = !!tg.BackButton.isVisible; tg.BackButton.show(); tg.BackButton.onClick(backHandler); } } catch (e) {}
    if (content) body.appendChild(content);
    return body;
  }
  function backHandler() { S.swallowBack = true; setTimeout(function () { S.swallowBack = false; }, 400); closeSheet(); }
  function closeSheet(silent) {
    if (!S.sheet) return;
    var s = S.sheet;
    S.sheet = null;
    s.ov.remove();
    document.documentElement.style.overflow = '';
    try { if (tg && tg.enableVerticalSwipes && S.swWas) tg.enableVerticalSwipes(); } catch (e) {}
    try { if (tg && tg.BackButton) { tg.BackButton.offClick(backHandler); if (!S.bbWasVisible) tg.BackButton.hide(); } } catch (e) {}
    if (!silent && s.onClose) s.onClose();
    if (window.location.pathname !== '/marketplace') {
      checkRouteCleanup();
    }
  }

  function busy(btn, on, txt) {
    if (!btn) return;
    if (on) { btn._t = btn.textContent; btn.textContent = txt || 'Kuting...'; btn.setAttribute('disabled', ''); }
    else { btn.textContent = btn._t || btn.textContent; btn.removeAttribute('disabled'); }
  }

  // ---------- Pul taklif qilish + to'lov ----------
  function offerFlow(it, v, btn, body) {
    haptic();
    busy(btn, true);
    api('GET', '/api/auction/me').then(function (me) {
      S.me = me;
      busy(btn, false);
      var avail = (me.balance || 0) + (it.iAmLeader ? (it.myBid || 0) : 0);
      if (avail >= v) {
        confirmMsg(money(v) + " so'm taklif qilasizmi?\nSumma garantga muzlatiladi. Kimdir oshirsa yoki auksionda yutolmasangiz, pul to'liq balansingizga qaytariladi.", function () { placeBid(it, v, btn, body); });
      } else {
        openPay(it, v, Math.max(1000, v - avail), body);
      }
    }).catch(function (e) { busy(btn, false); haptic('err'); alertMsg(e.message); });
  }
  function placeBid(it, v, btn, body, fromPay) {
    busy(btn, true);
    return api('POST', '/api/auction/' + it.id + '/bid', { amount: v }).then(function () {
      haptic('ok');
      api('GET', '/api/auction/me').then(function (j) { S.me = j; }).catch(function () {});
      return api('GET', '/api/auction/' + it.id).then(function (j) {
        if (S.detail && S.detail.item && S.detail.item.id === it.id) S.detail = j;
        if (body && body.isConnected) drawDetail(body, j.item, j.bids, j); else if (!S.sheet) render();
        return true;
      });
    }).catch(function (e) {
      haptic('err'); busy(btn, false);
      if (e.code === 'INSUFFICIENT_BALANCE' && !fromPay) { openPay(it, v, Math.max(1000, v - ((S.me && S.me.balance) || 0)), body); return false; }
      alertMsg(e.message);
      return false;
    });
  }
  var PAY_LOGO = { click: 'data:image/png;base64,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', payme: 'data:image/png;base64,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' };
  function openLinkSafe(u) { try { if (tg && tg.openLink) return tg.openLink(u); } catch (e) {} window.open(u, '_blank'); }
  function openPay(it, v, need, body) {
    var old = document.querySelector('.auc-payov'); if (old) old.remove();
    var timer = null, closed = false, ov;
    function close() { closed = true; if (timer) clearInterval(timer); timer = null; if (ov) ov.remove(); }
    var st = h('div', { class: 'auc-note', style: 'text-align:center;margin-top:10px' }, "To'lov havolasi tayyorlanmoqda...");
    var links = h('div');
    var starsSlot = h('div');
    var cancel = h('button', { class: 'auc-btn ghost' }, 'Bekor qilish');
    cancel.addEventListener('click', function () { haptic(); close(); });
    var grab = h('div', { class: 'auc-grab' }, [h('i', null)]);
    var card = h('div', { class: 'auc-paybox' }, [
      grab,
      h('div', { class: 'auc-lbl', style: 'display:block;text-align:center' }, "To'lov summasi"),
      h('div', { class: 'auc-big', style: 'text-align:center' }, money(need) + " so'm"),
      h('div', { class: 'auc-note', style: 'text-align:center' }, "To'lov tushishi bilan " + money(v) + " so'm taklifingiz avtomatik qo'yiladi."),
      links, starsSlot, st, cancel,
    ]);
    ov = h('div', { class: 'auc-payov auc-paysheet' }, card);
    (function () {
      var sy = null, dy = 0;
      function pt(e) { return (e.touches && e.touches[0]) || e; }
      function down(e) { sy = pt(e).clientY; dy = 0; card.style.transition = 'none'; }
      function move(e) { if (sy === null) return; dy = Math.max(0, pt(e).clientY - sy); card.style.transform = 'translateY(' + dy + 'px)'; if (e.cancelable) e.preventDefault(); }
      function up() {
        if (sy === null) return; sy = null; card.style.transition = 'transform .2s ease';
        if (dy > 70) { haptic(); card.style.transform = 'translateY(110%)'; setTimeout(close, 190); }
        else { card.style.transform = ''; }
      }
      grab.addEventListener('touchstart', down, { passive: true });
      grab.addEventListener('touchmove', move, { passive: false });
      grab.addEventListener('touchend', up);
      grab.addEventListener('touchcancel', up);
      grab.addEventListener('mousedown', function (e) {
        down(e);
        function mm(ev) { move(ev); }
        function mu() { up(); document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); }
        document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu);
      });
      grab.addEventListener('click', function () { if (dy < 5) { haptic(); close(); } });
    })();
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.body.appendChild(ov);
    function waitStarsBalance() {
      var n = 0;
      var iv = setInterval(function () {
        if (closed) { clearInterval(iv); return; }
        n++;
        api('GET', '/api/auction/me').then(function (me) {
          if (closed) return;
          S.me = me;
          var avail = (me.balance || 0) + (it.iAmLeader ? (it.myBid || 0) : 0);
          if (avail >= v) {
            clearInterval(iv);
            if (timer) clearInterval(timer);
            timer = null;
            st.textContent = "✅ To'lov qabul qilindi. Taklif qo'yilmoqda...";
            placeBid(it, v, null, body, true).then(function (ok) {
              if (ok) { close(); alertMsg('✅ ' + money(v) + " so'm taklifingiz qabul qilindi!"); }
              else st.textContent = "To'lov balansingizga tushdi. Taklifni qayta yuboring.";
            });
          }
        }).catch(function () {});
        if (n > 40) { clearInterval(iv); st.textContent = "Stars to'lovi balansingizga tushishi kutilmoqda. Birozdan so'ng taklifni qayta yuboring."; }
      }, 2500);
    }
    api('GET', '/api/auction/stars-rate').then(function (r) {
      if (closed || !(r.rate > 0)) return;
      var stars = Math.max(5, Math.ceil(need / r.rate));
      var sbtn = h('button', { class: 'auc-btn', style: 'background:linear-gradient(135deg,#FFC93C 0%,#FF9F0A 100%);color:#1b1200;border-radius:999px;display:flex;align-items:center;justify-content:center;gap:8px;font-weight:800' }, '⭐ Stars orqali to\'lash · ' + money(stars) + ' ⭐');
      sbtn.addEventListener('click', function () {
        haptic();
        busy(sbtn, true);
        api('POST', '/api/marketplace/wallet/topup/stars', { stars: stars }).then(function (j) {
          busy(sbtn, false);
          var link = j.topup && j.topup.invoiceLink;
          if (!link) throw new Error("Stars to'lov havolasi yaratilmadi");
          var wa = window.Telegram && window.Telegram.WebApp;
          if (wa && wa.openInvoice) {
            wa.openInvoice(link, function (status) {
              if (status === 'paid') { st.textContent = "⏳ Stars to'lovi tekshirilmoqda..."; waitStarsBalance(); }
              else if (status === 'failed') { haptic('err'); st.textContent = "Stars to'lovi amalga oshmadi."; }
            });
          } else { openLinkSafe(link); waitStarsBalance(); }
        }).catch(function (e) { busy(sbtn, false); haptic('err'); alertMsg(e.message); });
      });
      starsSlot.appendChild(sbtn);
      starsSlot.appendChild(h('div', { class: 'auc-note', style: 'text-align:center;margin-top:4px' }, '1 ⭐ = ' + money(r.rate) + " so'm"));
    }).catch(function () {});
    api('POST', '/api/marketplace/wallet/topup/checkout', { amount: need }).then(function (j) {
      if (closed) return;
      var t = j.topup || {}, urls = t.payUrls || {}, list = [];
      if (urls.click) list.push(["Click orqali to'lash", '#00AEEF', urls.click, PAY_LOGO.click, '#000']);
      if (urls.payme) list.push(["Payme orqali to'lash", '#00CBC8', urls.payme, PAY_LOGO.payme, '#fff;background-size:100% 100%']);
      Object.keys(urls).forEach(function (k) { if (k !== 'click' && k !== 'payme' && urls[k]) list.push([k + " orqali to'lash", '#55a9ff', urls[k]]); });
      if (!list.length || !t.id) { st.textContent = "To'lov havolasi topilmadi. Keyinroq urinib ko'ring."; return; }
      list.forEach(function (x) {
        links.appendChild(h('button', { class: 'auc-btn', style: 'background:' + x[1] + ';border-radius:999px;display:flex;align-items:center;justify-content:center', onclick: function () { haptic(); openLinkSafe(x[2]); } }, [x[3] ? h('span', { class: 'auc-paylogo', style: 'background-image:url(' + x[3] + ')' + (x[4] ? ';background-color:' + x[4] : '') }) : null, x[0]]));
      });
      st.textContent = "⏳ To'lov kutilmoqda...";
      if (list.length === 1) openLinkSafe(list[0][2]);
      var checking = false;
      timer = setInterval(function () {
        if (closed || checking) return;
        checking = true;
        api('POST', '/api/marketplace/wallet/topup/checkout/' + t.id + '/check').then(function (r) {
          if (closed) return;
          if (r.status === 'credited' || r.status === 'already') {
            if (timer) clearInterval(timer); timer = null;
            st.textContent = "✅ To'lov qabul qilindi. Taklif qo'yilmoqda...";
            S.me = null;
            return placeBid(it, v, null, body, true).then(function (ok) {
              if (ok) { close(); alertMsg('✅ ' + money(v) + " so'm taklifingiz qabul qilindi!"); }
              else st.textContent = "To'lov balansingizga tushdi. Taklifni qayta yuboring.";
            });
          }
          if (r.status === 'expired') { if (timer) clearInterval(timer); timer = null; st.textContent = "To'lov muddati tugadi. Qaytadan urinib ko'ring."; }
        }).catch(function () {}).then(function () { checking = false; });
      }, 4000);
    }).catch(function (e) { if (!closed) st.textContent = e.message || "To'lov havolasi yaratilmadi"; });
  }

  // ---------- Lot tafsiloti ----------
  function openDetail(id) {
    haptic();
    var body = openSheet(h('div', { class: 'auc-skel', style: 'height:320px' }), function () {
      if (window.location.pathname === '/marketplace' && S.mode === 'auc') load(true);
    });
    api('GET', '/api/auction/' + id).then(function (j) { if (body.isConnected) drawDetail(body, j.item, j.bids, j); })
      .catch(function (e) {
        if (body.isConnected) {
          body.innerHTML = '';
          body.appendChild(h('div', { class: 'auc-empty' }, e.message));
        }
      });
  }

  function drawDetail(body, it, bids, full) {
    body.innerHTML = '';
    S.nick = S.nick || {}; ((full && full.leaders) || []).forEach(function (u) { if (u.firstName) S.nick[u.name] = u.firstName; });
    var active = it.status === 'ACTIVE';
    var photos = it.photos && it.photos.length ? it.photos : (it.photoUrl ? [it.photoUrl] : []);
    var ar = arenaBlock(it, full || {});
    var bidSlot = h('div', { class: 'auc-bidslot' });
    if (ar) {
      body.appendChild(ar);
      var fr = ar.querySelector('.auc-ar-frame');
      if (fr && fr.nextSibling) ar.insertBefore(bidSlot, fr.nextSibling); else ar.appendChild(bidSlot);
    } else body.appendChild(bidSlot);
    body.appendChild(h('div', { class: 'auc-hero' }, [
      it.postUrl ? h('button', { class: 'auc-btn', style: 'margin-top:10px', onclick: function () {
        haptic();
        try { if (tg && tg.openTelegramLink) return tg.openTelegramLink(it.postUrl); } catch (e) {}
        window.open(it.postUrl, '_blank');
      } }, 'Yutuqdagi akkauntni ko\'rish') : null,
      h('button', {
        class: 'auc-share-btn big',
        type: 'button',
        onclick: function (e) {
          e.preventDefault();
          haptic();
          shareAuction(it);
        }
      }, [
        h('span', { html: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-3px;margin-right:6px"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>' }),
        'Ulashish'
      ])
    ]));

    // narx
    body.appendChild(h('div', { class: 'auc-box' }, [
      h('span', { class: 'auc-lbl' }, it.bidsCount ? 'Joriy narx' : 'Boshlang\'ich narx'),
      h('div', { class: 'auc-big' }, money(it.currentPrice) + " so'm"),
      it.myBid ? h('div', { class: 'auc-note', style: 'color:' + (it.iAmLeader ? '#49df64' : '#ff7a90') }, it.iAmLeader ? '✅ Eng yuqori stavka sizniki: ' + money(it.myBid) + " so'm" : 'Sizning stavkangiz: ' + money(it.myBid) + " so'm (oshib ketilgan, pul qaytarilgan)") : null,
    ]));

    if (it.category || it.description) {
      body.appendChild(h('div', { class: 'auc-box' }, [
        it.category ? h('span', { class: 'auc-lbl' }, 'Yo\'nalish: ' + it.category) : null,
        it.description ? h('p', null, it.description) : null,
      ]));
    }


    // pul taklif qilish
    if (active && !it.isMine) {
      var inp = h('input', { class: 'auc-in', inputmode: 'numeric', value: money(it.minNext), style: 'font-size:20px;font-weight:800;text-align:center' });
      var val = function () { return parseInt(String(inp.value).replace(/\D/g, ''), 10) || 0; };
      inp.addEventListener('input', function () { var v = val(); inp.value = v ? money(v) : ''; });
      var bal = S.me ? h('div', { class: 'auc-note' }, 'Balansingiz: ' + money(S.me.balance) + " so'm") : null;
      var btn = h('button', { class: 'auc-btn hot' }, it.myBid ? 'Yana pul taklif qilish' : 'Pul taklif qilish');
      btn.addEventListener('click', function () {
        var v = val();
        if (v < it.minNext) { haptic('err'); return alertMsg('Minimal taklif: ' + money(it.minNext) + " so'm"); }
        offerFlow(it, v, btn, body);
      });
      bidSlot.appendChild(h('div', { class: 'auc-box', style: 'margin:12px 0 0' }, [
        h('span', { class: 'auc-lbl' }, 'Taklif summasi (min. ' + money(it.minNext) + " so'm)"),
        inp,
        h('div', { class: 'auc-quick' }, [1, 2, 5].map(function (k) {
          return h('button', { onclick: function () { inp.value = money(Math.max(it.minNext, (it.bidsCount ? it.currentPrice : it.startPrice) + it.step * k)); haptic(); } }, '+' + kfmt(it.step * k));
        })),
        btn,
        bal,
        h('div', { class: 'auc-note' }, 'Oxirgi 40 soniyada taklif qilinsa, auksion vaqtiga 40 soniya qo\'shiladi.'),
          h('div', { class: 'auc-note', style: 'margin-top:8px;padding:9px 11px;border-radius:12px;background:rgba(73,223,100,.10);color:#49df64;font-weight:600;line-height:1.35' }, "ℹ️ Agar auksionda yutolmasangiz, pullaringiz to'liq balansingizga qaytariladi va uni istalgan vaqtda kartangizga yechib olishingiz mumkin."),
      ]));
    }

    // g'olib / sotuvchi amallari
    dealBlock(body, it);

    if (it.isMine && !(S.me && S.me.isAdmin) && (it.status === 'PENDING' || (active && !it.bidsCount))) {
      var cb = h('button', { class: 'auc-btn red' }, 'Lotni bekor qilish');
      cb.addEventListener('click', function () {
        confirmMsg('Lotni bekor qilasizmi?', function () {
          busy(cb, true);
          api('POST', '/api/auction/' + it.id + '/cancel').then(function () { haptic('ok'); closeSheet(); }).catch(function (e) { busy(cb, false); alertMsg(e.message); });
        });
      });
      body.appendChild(cb);
    }
    if (it.isMine && it.status === 'REJECTED' && it.rejectReason) body.appendChild(h('div', { class: 'auc-box' }, [h('span', { class: 'auc-lbl' }, 'Rad etish sababi'), h('p', null, it.rejectReason)]));

    // admin amallari
    if (S.me && S.me.isAdmin) adminBlock(body, it);

    // stavkalar tarixi
    if (bids && bids.length) {
      body.appendChild(h('div', { class: 'auc-h' }, "So'nggi stavkalar"));
      body.appendChild(h('div', { class: 'auc-box', style: 'padding:4px 14px' }, bids.map(function (b) {
        return h('div', { class: 'auc-bidrow' + (b.isMe ? ' me' : '') }, [h('span', { style: 'display:flex;align-items:center;gap:10px;min-width:0' }, [uava(b.photo, nick(b), 30), h('span', { style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, b.isMe ? 'Siz' : nick(b)), h('span', { style: 'font-size:11px;color:#8a8a8a;font-weight:500;flex-shrink:0' }, ago(b.createdAt))]), h('span', null, money(b.amount) + " so'm")]);
      })));
    }
    tickTimers();
  }

  function ago(iso) {
    var s2 = Math.max(0, Math.floor((now() - new Date(iso).getTime()) / 1000));
    if (s2 < 60) return 'hozir';
    if (s2 < 3600) return Math.floor(s2 / 60) + ' daq';
    if (s2 < 86400) return Math.floor(s2 / 3600) + ' soat';
    return Math.floor(s2 / 86400) + ' kun';
  }
  var GRAD = ['#ff7a18,#d62976', '#4f5bd5,#962fbf', '#2fc24c,#1a8f8f', '#f1aa05,#ff3d77', '#35aff1,#4f5bd5'];
  function nick(u) { if (!u) return ''; return u.firstName || (S.nick && S.nick[u.name]) || String(u.name || '').replace(/^@/, ''); }
  function uava(photo, name, size, ring) {
    var letter = String(name || '?').replace(/^@/, '').charAt(0).toUpperCase() || '?';
    var g = GRAD[(letter.charCodeAt(0) || 0) % GRAD.length];
    var el = h('span', { class: 'auc-uava', style: 'width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.42) + 'px;background:linear-gradient(135deg,' + g + ')' + (ring ? ';box-shadow:0 0 0 3px ' + ring + ',0 6px 18px rgba(0,0,0,.45)' : '') }, letter);
    if (photo) {
      var im = h('img', { src: photo, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
      im.onerror = function () { im.remove(); };
      el.appendChild(im);
    }
    return el;
  }
  function priceChart(tl, it) {
    if (!tl || tl.length < 2) return null;
    var W = 320, H = 110, P = 8;
    var pts = [{ amount: it.startPrice, at: tl[0].at }].concat(tl);
    var t0 = new Date(pts[0].at).getTime(), t1 = Math.max(new Date(pts[pts.length - 1].at).getTime(), t0 + 1);
    var mn = it.startPrice * 0.95, mx = Math.max.apply(null, pts.map(function (p) { return p.amount; }));
    if (mx <= mn) mx = mn + 1;
    var X = function (t) { return P + (W - 2 * P) * (new Date(t).getTime() - t0) / (t1 - t0); };
    var Y = function (v) { return H - P - (H - 2 * P) * (v - mn) / (mx - mn); };
    var d = 'M' + X(pts[0].at).toFixed(1) + ',' + Y(pts[0].amount).toFixed(1);
    for (var i = 1; i < pts.length; i++) d += ' H' + X(pts[i].at).toFixed(1) + ' V' + Y(pts[i].amount).toFixed(1);
    d += ' H' + (W - P);
    var area = d + ' V' + (H - P) + ' H' + P + ' Z';
    var last = pts[pts.length - 1];
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" preserveAspectRatio="none" style="display:block;overflow:visible">' +
      '<defs><linearGradient id="aucg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d62976" stop-opacity=".45"/><stop offset="1" stop-color="#4f5bd5" stop-opacity="0"/></linearGradient>' +
      '<linearGradient id="aucl" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fa7e1e"/><stop offset=".5" stop-color="#d62976"/><stop offset="1" stop-color="#962fbf"/></linearGradient></defs>' +
      '<path d="' + area + '" fill="url(#aucg)"/><path d="' + d + '" fill="none" stroke="url(#aucl)" stroke-width="2.6" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>';
    var growth = Math.round((it.currentPrice / it.startPrice - 1) * 100);
    var wrap = h('div', { style: 'position:relative' }, [h('div', { html: svg }), h('span', { style: 'position:absolute;width:10px;height:10px;border-radius:50%;background:#fff;box-shadow:0 0 0 4px rgba(214,41,118,.45);left:calc(' + (X(last.at) / W * 100).toFixed(2) + '% - 5px);top:' + (Y(last.amount) - 5).toFixed(1) + 'px' })]);
    return h('div', { class: 'auc-box' }, [
      h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px' }, [
        h('span', { class: 'auc-lbl', style: 'margin:0' }, "📈 Narx o'sishi · " + tl.length + ' stavka'),
        h('span', { class: 'auc-badge', style: 'color:#49df64;background:rgba(73,223,100,.14)' }, (growth >= 0 ? '+' : '') + growth + '%'),
      ]),
      wrap,
      h('div', { style: 'display:flex;justify-content:space-between;font-size:11px;color:#8a8a8a;margin-top:6px' }, [h('span', null, 'Start: ' + money(it.startPrice)), h('span', null, 'Hozir: ' + money(it.currentPrice))]),
    ]);
  }
  function leaderBlock(body, it, full) {
    var L = full.leaders || [];
    if (!L.length) {
      if (it.status === 'ACTIVE') body.appendChild(h('div', { class: 'auc-box', style: 'text-align:center' }, [h('div', { style: 'font-size:30px' }, '🥇'), h('p', { style: 'color:#a8a8a8' }, "Hali hech kim stavka qo'ymadi — birinchi bo'ling!")]));
      return;
    }
    var max = L[0].amount || 1;
    var box = h('div', { class: 'auc-box auc-lb' });
    box.appendChild(h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px' }, [
      h('span', { style: 'font-size:15px;font-weight:800' }, "🏆 Eng ko'p tikkanlar"),
      h('span', { class: 'auc-badge', style: 'color:#55a9ff;background:rgba(85,169,255,.14)' }, L.length + ' ishtirokchi'),
    ]));
    var RING = ['#f5c542', '#c9d1d9', '#d08a4b'];
    var POD = [[1, 64], [0, 88], [2, 48]];
    var pod = h('div', { class: 'auc-pod' });
    POD.forEach(function (pp) {
      var i = pp[0], u = L[i];
      if (!u) { pod.appendChild(h('div', { class: 'auc-pcol' })); return; }
      var sz = i === 0 ? 66 : 52;
      pod.appendChild(h('div', { class: 'auc-pcol' + (u.isMe ? ' me' : '') }, [
        i === 0 ? h('div', { class: 'auc-crown' }, '👑') : null,
        uava(u.photo, nick(u), sz, RING[i]),
        h('div', { class: 'auc-pname' }, u.isMe ? 'Siz' : nick(u)),
        h('div', { class: 'auc-pamt', style: 'color:' + RING[i] }, money(u.amount)),
        h('div', { class: 'auc-ped p' + i, style: 'height:' + pp[1] + 'px' }, [h('b', null, String(i + 1)), h('span', null, u.count + ' stavka')]),
      ]));
    });
    box.appendChild(pod);
    if (L.length > 3) {
      var rest = h('div', { class: 'auc-rest' });
      L.slice(3).forEach(function (u, k) {
        rest.appendChild(h('div', { class: 'auc-rrow' + (u.isMe ? ' me' : '') }, [
          h('span', { class: 'auc-rk' }, String(k + 4)),
          uava(u.photo, nick(u), 30),
          h('div', { class: 'auc-rmid' }, [
            h('div', { class: 'auc-rtop' }, [h('span', null, u.isMe ? 'Siz' : nick(u)), h('b', null, money(u.amount))]),
            h('div', { class: 'auc-bar' }, h('i', { style: 'width:' + Math.max(6, Math.round(u.amount / max * 100)) + '%' })),
          ]),
        ]));
      });
      box.appendChild(rest);
    }
    body.appendChild(box);
    var ch = priceChart(full.timeline, it);
    if (ch) body.appendChild(ch);
  }

  // ---------- Arena (ulush diagrammasi) ----------
  var ARENA = [['#4338ca', '#8b5cf6'], ['#22d3a6', '#a7f3e4'], ['#65d61f', '#d9f99d'], ['#f0632b', '#f6b13b'], ['#ec4899', '#fda4af'], ['#0ea5e9', '#67e8f9'], ['#eab308', '#fde68a'], ['#a855f7', '#f0abfc'], ['#06b6d4', '#5eead4'], ['#ef4444', '#fdba74']];
  function polyArea(P) { var a = 0; for (var i = 0; i < P.length; i++) { var p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; }
  function clipHalf(P, nx, ny, c, keepBelow) {
    var out = [];
    function inside(p) { var v = p[0] * nx + p[1] * ny - c; return keepBelow ? v >= 0 : v <= 0; }
    for (var i = 0; i < P.length; i++) {
      var A = P[i], B = P[(i + 1) % P.length], ia = inside(A), ib = inside(B);
      if (ia) out.push(A);
      if (ia !== ib) {
        var da = A[0] * nx + A[1] * ny - c, db = B[0] * nx + B[1] * ny - c, t = da / (da - db);
        out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]);
      }
    }
    return out;
  }
  function centroid(P) {
    var a = 0, cx = 0, cy = 0;
    for (var i = 0; i < P.length; i++) { var p = P[i], q = P[(i + 1) % P.length], f = p[0] * q[1] - q[0] * p[1]; a += f; cx += (p[0] + q[0]) * f; cy += (p[1] + q[1]) * f; }
    if (Math.abs(a) < 1e-9) return P[0] || [50, 50];
    return [cx / (3 * a), cy / (3 * a)];
  }
  // Kvadratni ulushlarga bo'lish: har safar qolgan qismdan pastdan qiya chiziq bilan kesamiz
  function territories(shares) {
    var S0 = 100, rest = [[0, 0], [S0, 0], [S0, S0], [0, S0]], out = [];
    var angles = [-22, 18, -30, 12, -16, 26, -10, 20, -26, 14];
    var total = shares.reduce(function (a, b) { return a + b; }, 0) || 1;
    for (var k = 0; k < shares.length; k++) {
      if (k === shares.length - 1) { out.push(rest); break; }
      var target = shares[k] / total * S0 * S0;
      var ang = angles[k % angles.length] * Math.PI / 180;
      var nx = Math.sin(ang), ny = Math.cos(ang); // pastga qaragan normal
      var vals = rest.map(function (p) { return p[0] * nx + p[1] * ny; });
      var hi = Math.max.apply(null, vals), lo = Math.min.apply(null, vals), c = hi;
      for (var it = 0; it < 40; it++) {
        var mid = (lo + hi) / 2, piece = clipHalf(rest, nx, ny, mid, true);
        if (polyArea(piece) > target) lo = mid; else hi = mid;
      }
      c = (lo + hi) / 2;
      out.push(clipHalf(rest, nx, ny, c, true));
      rest = clipHalf(rest, nx, ny, c, false);
    }
    return out;
  }
  function arenaBlock(it, full) {
    var L = (full.leaders || []).slice();
    if (!L.length) {
      if (it.status !== 'ACTIVE') return null;
      return h('div', { class: 'auc-arena' }, [
        h('div', { class: 'auc-ar-head' }, [h('span', null, ['Boshlang\'ich ', h('b', null, money(it.startPrice))]), h('span', { 'data-ends': it.endsAt, 'data-pre': 'Tugashiga ' })]),
        h('div', { class: 'auc-ar-frame waiting' }, h('div', { class: 'auc-ar-sq auc-ar-empty auc-gen' }, [
          h('span', { class: 'auc-wait-tex' }),
          h('div', { class: 'auc-wait-txt' }, 'Ishtirokchilar kutilmoqda...'.split('').map(function (ch, i) { return h('span', { style: 'animation-delay:' + (i * 0.07).toFixed(2) + 's' }, ch === ' ' ? '\u00a0' : ch); })),
        ])),
      ]);
    }
    // Kichikdan kattaga: katta ulush yuqorida qoladi (rasmdagidek)
    var ordered = L.map(function (u, i) { u._c = ARENA[i % ARENA.length]; return u; }).slice().reverse();
    var total = L.reduce(function (a, u) { return a + u.amount; }, 0);
    var polys = territories(ordered.map(function (u) { return u.amount; }));
    var defs = '', paths = '';
    ordered.forEach(function (u, i) {
      var id = 'aucar' + i, P = polys[i], cen = centroid(P);
      defs += '<linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + u._c[0] + '"/><stop offset="1" stop-color="' + u._c[1] + '"/></linearGradient>';
      paths += '<polygon class="auc-ar-poly" style="animation-delay:' + (i * 70) + 'ms" points="' + P.map(function (p) { return p[0].toFixed(2) + ',' + p[1].toFixed(2); }).join(' ') + '" fill="url(#' + id + ')"/>';
      u._cen = cen; u._area = polyArea(P);
    });
    var sq = h('div', { class: 'auc-ar-sq', html: '<svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%"><defs>' + defs + '</defs>' + paths + '</svg>' });
    ordered.forEach(function (u) {
      var size = Math.max(9, Math.min(26, Math.sqrt(u._area) * 0.45)); // % kenglik
      var av = uava(u.photo, nick(u), 10, 'rgba(255,255,255,.9)');
      av.classList.add('auc-ar-ava');
      av.style.width = av.style.height = size + '%';
      av.style.fontSize = '';
      av.style.left = Math.max(2, Math.min(98 - size, u._cen[0] - size / 2)) + '%';
      av.style.top = Math.max(4, Math.min(98 - size, u._cen[1] - size / 2)) + '%';
      av.style.boxShadow = '0 0 0 2px rgba(255,255,255,.85),0 6px 18px rgba(0,0,0,.35)';
      if (u.isLeader) av.appendChild(h('span', { class: 'auc-ar-crown' }, '👑'));
      sq.appendChild(av);
    });
    var list = h('div', { class: 'auc-ar-list' }, L.map(function (u) {
      var pct = total ? Math.round(u.amount / total * 1000) / 10 : 0;
      return h('div', { class: 'auc-ar-row' + (u.isMe ? ' me' : '') }, [
        h('i', { style: 'background:linear-gradient(135deg,' + u._c[0] + ',' + u._c[1] + ')' }),
        uava(u.photo, nick(u), 30),
        h('span', { class: 'n' }, [u.isMe ? 'Siz' : nick(u), u.isLeader ? h('span', { class: 'auc-ar-lead' }, 'Yetakchi') : null]),
        h('span', { class: 'p' }, pct + '%'),
        h('b', null, money(u.amount)),
      ]);
    }));
    return h('div', { class: 'auc-arena' }, [
      h('div', { class: 'auc-ar-head' }, [
        h('span', null, ['Eng yuqori ', h('b', null, money(it.currentPrice))]),
        it.status === 'ACTIVE' ? h('span', { 'data-ends': it.endsAt, 'data-pre': 'Tugashiga ' }) : h('span', null, (STATUS[it.status] || [''])[0]),
      ]),
      h('div', { class: 'auc-ar-frame' }, sq),
      h('div', { class: 'auc-ar-title' }, [h('span', null, ['Ishtirokchilar', h('em', null, ' · ' + L.length)]), h('span', { class: 'auc-ar-id' }, 'Lot #' + it.id)]),
      list,
    ]);
  }

  function refreshDetail(body, id) {
    return api('GET', '/api/auction/' + id).then(function (j) { if (body.isConnected) drawDetail(body, j.item, j.bids, j); });
  }

  function dealBlock(body, it) {
    var deal = ['AWAITING_TRANSFER', 'TRANSFERRED', 'DISPUTED', 'COMPLETED', 'REFUNDED'];
    if (deal.indexOf(it.status) < 0) return;
    if (it.isMine) {
      if (it.status === 'AWAITING_TRANSFER' || it.status === 'TRANSFERRED') {
        var ta = h('textarea', { class: 'auc-in', placeholder: 'Login, parol, ulangan pochta/telefon va boshqa kerakli ma\'lumotlar' });
        ta.value = it.transferInfo || '';
        var b = h('button', { class: 'auc-btn green' }, it.status === 'TRANSFERRED' ? 'Ma\'lumotni yangilash' : 'Akkauntni topshirish');
        b.addEventListener('click', function () {
          busy(b, true);
          api('POST', '/api/auction/' + it.id + '/transfer', { info: ta.value }).then(function () { haptic('ok'); return refreshDetail(body, it.id); }).catch(function (e) { busy(b, false); alertMsg(e.message); });
        });
        body.appendChild(h('div', { class: 'auc-box' }, [
          h('span', { class: 'auc-lbl' }, '🏁 Lot ' + money(it.currentPrice) + " so'mga sotildi"),
          h('ol', { class: 'auc-steps' }, [
            h('li', { html: 'Akkaunt <b>kirish ma\'lumotlarini</b> quyida yozing.' }),
            h('li', { html: 'Xaridor tekshirib <b>“Akkauntni oldim”</b> ni bosadi.' }),
            h('li', { html: 'Pul (komissiyasiz qismi) <b>balansingizga</b> tushadi.' }),
          ]),
          it.status === 'AWAITING_TRANSFER' && it.transferDeadline ? h('div', { class: 'auc-note', style: 'color:#f1aa05', 'data-ends': it.transferDeadline, 'data-pre': '⏱ Topshirish uchun qoldi: ' }) : null,
          h('div', { style: 'height:10px' }), ta, b,
        ]));
      } else if (it.status === 'DISPUTED') {
        body.appendChild(h('div', { class: 'auc-box' }, [h('span', { class: 'auc-lbl' }, 'Xaridor muammo bildirdi — admin ko\'rib chiqmoqda'), h('p', null, it.disputeReason || '')]));
      }
      return;
    }
    if (!it.isWinner) return;
    var box = h('div', { class: 'auc-box' }, [h('span', { class: 'auc-lbl' }, '🏆 Siz g\'olibsiz — ' + money(it.currentPrice) + " so'm garantda")]);
    if (it.status === 'AWAITING_TRANSFER') {
      box.appendChild(h('p', null, 'Sotuvchi akkauntni topshirishini kuting. Topshirmasa, pul avtomatik qaytariladi.'));
      if (it.transferDeadline) box.appendChild(h('div', { class: 'auc-note', 'data-ends': it.transferDeadline, 'data-pre': '⏱ Sotuvchiga qolgan vaqt: ' }));
    }
    if (it.transferInfo) {
      box.appendChild(h('span', { class: 'auc-lbl', style: 'margin-top:10px' }, 'Kirish ma\'lumotlari:'));
      box.appendChild(h('p', { style: 'background:#111;border-radius:12px;padding:12px;font-family:ui-monospace,monospace;font-size:13px;user-select:text' }, it.transferInfo));
      box.appendChild(h('div', { class: 'auc-note' }, 'Kirgach parol, pochta va telefonni darhol o\'zingiznikiga almashtiring.'));
    }
    if (it.status === 'TRANSFERRED' || it.status === 'AWAITING_TRANSFER') {
      if (it.status === 'TRANSFERRED' && it.confirmDeadline) box.appendChild(h('div', { class: 'auc-note', style: 'color:#f1aa05', 'data-ends': it.confirmDeadline, 'data-pre': '⏱ Avto-tasdiqgacha: ' }));
      var ok = h('button', { class: 'auc-btn green' }, '✅ Akkauntni oldim');
      ok.addEventListener('click', function () {
        confirmMsg('Akkauntni to\'liq oldingizmi? Tasdiqlagach pul sotuvchiga o\'tadi va qaytarib bo\'lmaydi.', function () {
          busy(ok, true);
          api('POST', '/api/auction/' + it.id + '/confirm').then(function () { haptic('ok'); return refreshDetail(body, it.id); }).catch(function (e) { busy(ok, false); alertMsg(e.message); });
        });
      });
      var bad = h('button', { class: 'auc-btn red' }, 'Muammo bor');
      bad.addEventListener('click', function () {
        var ta = h('textarea', { class: 'auc-in', placeholder: 'Nima muammo? (masalan: parol noto\'g\'ri, pochta ulanmagan...)' });
        var send = h('button', { class: 'auc-btn hot' }, 'Adminga yuborish');
        send.addEventListener('click', function () {
          busy(send, true);
          api('POST', '/api/auction/' + it.id + '/dispute', { reason: ta.value }).then(function () { haptic('ok'); return refreshDetail(body, it.id); }).catch(function (e) { busy(send, false); alertMsg(e.message); });
        });
        bad.replaceWith(h('div', { style: 'margin-top:10px' }, [ta, send]));
      });
      if (it.status === 'TRANSFERRED') box.appendChild(ok);
      box.appendChild(bad);
    }
    if (it.status === 'DISPUTED') box.appendChild(h('p', { style: 'margin-top:8px;color:#ff7a90' }, 'Muammo adminga yuborildi. Qaror chiqquncha pul garantda turadi.'));
    if (it.status === 'COMPLETED') box.appendChild(h('p', { style: 'color:#49df64' }, 'Savdo yakunlangan. Xaridingiz bilan!'));
    if (it.status === 'REFUNDED') box.appendChild(h('p', null, 'Pul balansingizga qaytarilgan.'));
    body.appendChild(box);
  }

  function adminBlock(body, it) {
    var row = null;
    function act(url, data, okMsg) {
      return api('POST', url, data).then(function () { haptic('ok'); if (okMsg) alertMsg(okMsg); S.admin = null; return refreshDetail(body, it.id); }).catch(function (e) { alertMsg(e.message); });
    }
    if (it.status === 'PENDING') {
      var ap = h('button', { class: 'auc-btn green' }, 'Tasdiqlash');
      ap.addEventListener('click', function () { confirmMsg('Lotni tasdiqlab, auksionni boshlaysizmi?', function () { busy(ap, true); act('/api/auction/admin/' + it.id + '/approve'); }); });
      var rj = h('button', { class: 'auc-btn red' }, 'Rad etish');
      rj.addEventListener('click', function () {
        var reason = prompt('Rad etish sababi (ixtiyoriy):', '') ;
        if (reason === null) return;
        act('/api/auction/admin/' + it.id + '/reject', { reason: reason });
      });
      row = h('div', { class: 'auc-2' }, [ap, rj]);
    } else if (['DISPUTED', 'TRANSFERRED', 'AWAITING_TRANSFER'].indexOf(it.status) >= 0) {
      var s = h('button', { class: 'auc-btn green' }, 'Pul sotuvchiga');
      s.addEventListener('click', function () { confirmMsg('Pulni sotuvchiga o\'tkazasizmi?', function () { act('/api/auction/admin/' + it.id + '/resolve', { to: 'seller' }); }); });
      var b = h('button', { class: 'auc-btn ghost' }, 'Xaridorga qaytarish');
      b.addEventListener('click', function () { confirmMsg('Pulni xaridorga qaytarasizmi?', function () { act('/api/auction/admin/' + it.id + '/resolve', { to: 'buyer' }); }); });
      row = h('div', { class: 'auc-2' }, [s, b]);
    }
    var del = null;
    if (['DELETED', 'CANCELLED'].indexOf(it.status) < 0) {
      del = h('button', { class: 'auc-btn red' }, '🗑 Auksionni o\'chirish');
      del.addEventListener('click', function () {
        confirmMsg('Auksionni o\'chirasizmi? Barcha muzlatilgan stavkalar egalariga qaytariladi.', function () {
          busy(del, true);
          api('POST', '/api/auction/admin/' + it.id + '/delete').then(function (j) {
            haptic('ok'); alertMsg('Auksion o\'chirildi.' + (j.refunded ? ' ' + j.refunded + ' ta stavka qaytarildi.' : ''));
            if (S.sheet) closeSheet(); else load();
          }).catch(function (e) { busy(del, false); alertMsg(e.message); });
        });
      });
    }
    if (!row && !del) return;
    var box = h('div', { class: 'auc-box', style: 'border-color:rgba(241,170,5,.3)' }, [h('span', { class: 'auc-lbl', style: 'color:#f1aa05' }, '🛡 Admin')]);
    if (it.disputeReason) box.appendChild(h('p', { style: 'margin-bottom:8px' }, 'Nizo: ' + it.disputeReason));
    if (it.transferInfo) box.appendChild(h('p', { style: 'margin-bottom:8px;font-family:ui-monospace,monospace;font-size:12.5px' }, 'Topshirilgan: ' + it.transferInfo));
    if (row) box.appendChild(row);
    if (del) box.appendChild(del);
    body.appendChild(box);
  }

  // ---------- Lot yaratish ----------
  function openCreate() {
    haptic();
    var body = openSheet(null, function () { load(true); });
    body.appendChild(h('div', { class: 'auc-hero' }, [h('div', { style: 'font-size:40px' }, '🔨'), h('h3', null, 'Yangi auksion'), h('div', { class: 'auc-note', style: 'margin:0' }, 'Lot darhol auksionga chiqadi')]));
    function field(label, el, note) { return h('div', { class: 'auc-f' }, [h('span', { class: 'auc-lbl' }, label), el, note ? h('div', { class: 'auc-note' }, note) : null]); }
    var ig = h('input', { class: 'auc-in', placeholder: '@username', autocapitalize: 'off', autocomplete: 'off' });
    ig.addEventListener('input', function () { var v = ig.value.replace(/\s/g, ''); if (v && v.charAt(0) !== '@') v = '@' + v.replace(/^@+/, ''); ig.value = v; });
    var price = h('input', { class: 'auc-in', inputmode: 'numeric', placeholder: 'Masalan: 100 000' });
    price.addEventListener('input', function () { var v = parseInt(price.value.replace(/\D/g, ''), 10); price.value = v ? money(v) : ''; });
    var dIn = h('input', { class: 'auc-in', inputmode: 'numeric', value: '1' });
    var hIn = h('input', { class: 'auc-in', inputmode: 'numeric', value: '0' });
    var mIn = h('input', { class: 'auc-in', inputmode: 'numeric', value: '0' });
    function num(el, max) { var n = parseInt(String(el.value).replace(/\D/g, ''), 10) || 0; return Math.min(max, n); }
    function durMs() { return ((num(dIn, 60) * 24 + num(hIn, 9999)) * 60 + num(mIn, 99999)) * 60000; }
    var durNote = h('div', { class: 'auc-note' });
    function durUpd() {
      var ms = durMs();
      if (ms < 600000) { durNote.textContent = "Kamida 10 daqiqa bo'lishi kerak"; return; }
      if (ms > 60 * 86400000) { durNote.textContent = "Ko'pi bilan 60 kun"; return; }
      var e = new Date(now() + ms); function p(x) { return (x < 10 ? '0' : '') + x; }
      durNote.textContent = 'Tugash vaqti: ' + p(e.getDate()) + '.' + p(e.getMonth() + 1) + '.' + e.getFullYear() + ' ' + p(e.getHours()) + ':' + p(e.getMinutes());
    }
    [dIn, hIn, mIn].forEach(function (el) { el.addEventListener('input', function () { el.value = el.value.replace(/\D/g, '').slice(0, 5); durUpd(); }); });
    var durSeg = h('div', null, [h('div', { class: 'auc-dur' }, [h('label', null, [dIn, 'kun']), h('label', null, [hIn, 'soat']), h('label', null, [mIn, 'daqiqa'])]), durNote]);
    durUpd();
    var link = h('input', { class: 'auc-in', placeholder: 'https://t.me/kanal/123', autocapitalize: 'off', autocomplete: 'off', inputmode: 'url' });

    body.appendChild(field('Boshlang\'ich narx (so\'m) *', price, 'Har bir keyingi stavka kamida 7 000 so\'m yuqori bo\'ladi.'));
    body.appendChild(field('Auksion davomiyligi (kun / soat / daqiqa) *', durSeg));
    body.appendChild(field('Ma\'lumot havolasi *', link, 'Telegram post havolasi — foydalanuvchilar «Yutuqdagi akkauntni ko\'rish» tugmasi orqali shu postga o\'tadi.'));
    var go = h('button', { class: 'auc-btn hot' }, 'Auksionga chiqarish');
    go.addEventListener('click', function () {
      var f = {
        igUsername: ig.value.trim(),
        startPrice: parseInt(price.value.replace(/\D/g, ''), 10) || 0,
        postUrl: link.value.trim(),
        followers: 0,
      };
      if (f.startPrice < 10000) return alertMsg('Boshlang\'ich narx kamida 10 000 so\'m');
      if (!/^(https?:\/\/)?(t\.me|telegram\.me)\/(s\/)?[A-Za-z0-9_]{4,64}\/\d+/i.test(f.postUrl)) return alertMsg('Ma\'lumot havolasini to\'g\'ri kiriting (masalan https://t.me/kanal/123)');
      var ms = durMs();
      if (ms < 600000) return alertMsg('Auksion kamida 10 daqiqa davom etishi kerak');
      if (ms > 60 * 86400000) return alertMsg("Auksion ko'pi bilan 60 kun davom etishi mumkin");
      f.endsAt = new Date(now() + ms + 20000).toISOString();
      f.durationHours = Math.max(1, Math.ceil(ms / 3600000));
      busy(go, true);
      var genName = function () { return 'lot_' + Date.now().toString(36); };
      api('POST', '/api/auction/admin/import', { url: f.postUrl }).then(function (j) { return j.igUsername || ''; }).catch(function () { return ''; }).then(function (u) {
        f.igUsername = u || genName();
        return api('POST', '/api/auction', f).catch(function (e) {
          if (u && /allaqachon|noto'g'ri/.test(e.message || '')) { f.igUsername = genName(); return api('POST', '/api/auction', f); }
          throw e;
        });
      }).then(function () {
        haptic('ok');
        closeSheet(true);
        alertMsg('Auksion boshlandi!');
        load();
      }).catch(function (e) { haptic('err'); busy(go, false); alertMsg(e.message); });
    });
    body.appendChild(go);
  }

  function shrink(file, cb) {
    var r = new FileReader();
    r.onload = function () {
      var img = new Image();
      img.onload = function () {
        var m = 640, w = img.width, hh = img.height, k = Math.min(1, m / Math.max(w, hh));
        var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(hh * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        cb(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = function () { cb(r.result); };
      img.src = r.result;
    };
    r.readAsDataURL(file);
  }
})();
