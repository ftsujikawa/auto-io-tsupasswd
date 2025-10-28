(() => {
  let ran = false;
  let clickingBox = false;
  let dialogOpen = false;
  let openingDialog = false;
  let overPopup = false;

  // テキストを安全にHTMLとして表示するための簡易エスケープ
  const esc = (s) => {
    try { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); } catch(_) { return ''; }
  };

  const byHint = function(el) {
    const s = (el && (el.name || "")) + " " + (el && (el.id || "")) + " " + (el && (el.autocomplete || ""));
    return s.toLowerCase();
  };
  const isProbablyVisible = function(el) {
    try {
      if (!el) return false;
      const r = el.getClientRects && el.getClientRects();
      if (!r || r.length === 0) return false;
      const bb = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0 };
      if ((bb.width || 0) <= 0 || (bb.height || 0) <= 0) return false;
      const cs = (el.ownerDocument && el.ownerDocument.defaultView) ? el.ownerDocument.defaultView.getComputedStyle(el) : getComputedStyle(el);
      if (!cs) return true;
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
      return true;
    } catch(_) { return true; }
  };
  const hasAuthInputs = function(rootDoc) {
    try {
      const doc = rootDoc || document;
      const ins = Array.prototype.slice.call(doc.querySelectorAll('input'));
      // 可視なユーザID欄またはパスワード欄のどちらか一方でもあれば true
      return ins.some((i) => (isUserLike(i) || isPassLike(i)) && isProbablyVisible(i));
    } catch(_) { return false; }
  };
  // 同一フォーム内にユーザID/パスワード両方がある場合は、常にパスワード欄を優先してアンカーにする
  const pickPreferredAnchor = function(el) {
    try {
      const f = el && (el.form || (el.closest && el.closest('form')));
      if (f) {
        const ins = Array.prototype.slice.call(f.querySelectorAll('input'));
        const p = ins.find(isPassLike);
        if (p) return p;
        const u = ins.find(isUserLike);
        if (u) return u;
      }
    } catch(_) {}
    return el;
  };

  // JSON内を寛容に探索して最初に見つかった値を返す
  const findInObj = function(obj, keysLower) {
    try {
      const set = new Set(keysLower.map(k => String(k).toLowerCase()));
      const kvNameKeys = ['k','key','name','field','label'];
      const kvValueKeys = ['v','value','val','content'];
      const seen = new Set();
      const walk = (o) => {
        if (!o || typeof o !== 'object') return '';
        if (seen.has(o)) return ''; seen.add(o);
        if (Array.isArray(o)) {
          for (const it of o) { const r = walk(it); if (r) return r; }
          return '';
        }
        // direct keys
        for (const k in o) {
          try {
            const kl = String(k).toLowerCase();
            if (set.has(kl)) {
              const v = o[k];
              if (v == null) continue;
              if (typeof v === 'string' || typeof v === 'number') return String(v);
            }
          } catch(_) {}
        }
        // kv-shaped objects
        try {
          let nameVal = null;
          for (const nk of kvNameKeys) {
            if (typeof o[nk] === 'string' && set.has(o[nk].toLowerCase())) { nameVal = o[nk]; break; }
          }
          if (nameVal !== null) {
            for (const vk of kvValueKeys) {
              const v = o[vk];
              if (v == null) continue;
              if (typeof v === 'string' || typeof v === 'number') return String(v);
            }
          }
        } catch(_) {}
        // nested
        for (const k in o) {
          const r = walk(o[k]); if (r) return r;
        }
        return '';
      };
      return walk(obj) || '';
    } catch(_) { return ''; }
  };

  // 深いDOM探索（Shadow DOM/同一オリジンiframe対応）でinput要素を収集
  const getAllInputsDeep = function(root) {
    const out = [];
    const walk = (node) => {
      if (!node) return;
      try {
        const inputs = node.querySelectorAll ? node.querySelectorAll('input') : [];
        out.push(...Array.prototype.slice.call(inputs));
      } catch(_) {}
      // shadow roots
      const treeWalker = (node.querySelectorAll ? node.querySelectorAll('*') : []);
      for (const el of treeWalker) {
        if (el && el.shadowRoot) walk(el.shadowRoot);
      }
      // iframes (同一オリジンのみ)
      const iframes = node.querySelectorAll ? node.querySelectorAll('iframe') : [];
      for (const fr of iframes) {
        try {
          const doc = fr.contentDocument || (fr.contentWindow && fr.contentWindow.document);
          if (doc) walk(doc);
        } catch(_) { /* cross-origin */ }
      }
    };
    walk(root);
    return out;
  };

  // パスワード欄ごとにユーザ欄を近傍から推定（同一form優先→同一親要素→全体から最も近い）
  const pairUserPass = function(allInputs) {
    const passwords = allInputs.filter(isPassLike);
    const users = allInputs.filter(isUserLike);
    const pairs = [];
    const usedUsers = new Set();
    for (const pass of passwords) {
      let u = null;
      const form = pass.form || (pass.closest && pass.closest('form'));
      if (form) {
        const inForm = Array.prototype.slice.call(form.querySelectorAll('input'));
        u = inForm.find((el) => isUserLike(el) && !usedUsers.has(el));
      }
      if (!u) {
        const parent = pass.parentElement || pass.closest('*');
        if (parent) {
          const siblings = Array.prototype.slice.call(parent.querySelectorAll('input'));
          u = siblings.find((el) => isUserLike(el) && !usedUsers.has(el));
        }
      }
      if (!u) {
        // 最も近いユーザ欄
        let best = null, bestDist = Infinity;
        for (const cand of users) {
          if (usedUsers.has(cand)) continue;
          try {
            const a = pass.getBoundingClientRect();
            const b = cand.getBoundingClientRect();
            const dy = a.top - b.top; // 通常はユーザ欄が上にある
            const dx = Math.abs(a.left - b.left);
            const dist = Math.abs(dy) * 2 + dx; // 縦優先
            if (dist < bestDist) { bestDist = dist; best = cand; }
          } catch(_) {}
        }
        u = best;
      }
      if (u) {
        usedUsers.add(u);
        pairs.push({ user: u, pass });
      }
    }
    return pairs;
  };
  const isUserLike = function(el) {
    if (!el || el.tagName !== "INPUT") return false;
    const type = (el.type || "text").toLowerCase();
    if (["hidden", "submit", "button", "checkbox", "radio"].includes(type)) return false;
    const s = byHint(el);
    return (
      type === "text" || type === "email" || type === "tel" || type === "search" || type === "username" ||
      s.includes("user") || s.includes("login") || s.includes("mail") || s.includes("email") || s.includes("account") || s.includes("id")
    );
  };
  const isPassLike = function(el) {
    return el && el.tagName === "INPUT" && (el.type || "").toLowerCase() === "password";
  };

  // 入力欄が実際に編集可能かどうか
  const isEditableInput = function(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    if (el.disabled) return false;
    if (el.readOnly) return false;
    const type = (el.type || '').toLowerCase();
    if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'checkbox' || type === 'radio') return false;
    try {
      const cs = (el.ownerDocument && el.ownerDocument.defaultView && el.ownerDocument.defaultView.getComputedStyle)
        ? el.ownerDocument.defaultView.getComputedStyle(el) : (window.getComputedStyle ? window.getComputedStyle(el) : null);
      if (cs) {
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') === 0) return false;
        const rect = el.getBoundingClientRect && el.getBoundingClientRect();
        if (rect && (rect.width === 0 || rect.height === 0)) {
          // 見た目ゼロサイズは編集困難とみなす
          return false;
        }
      }
    } catch(_) {}
    return true;
  };

  const setVal = function(el, val) {
    try { el && el.focus && el.focus(); } catch(_){}
    if (!el) return;
    el.value = val;
    try {
      const event = document.createEvent("Event");
      event.initEvent("input", true, true);
      el.dispatchEvent(event);
      event.initEvent("change", true, true);
      el.dispatchEvent(event);
    } catch(_){}
  };

  const forceApply = function(user, pass, uval, pval) {
    const applyBoth = () => { if (user) setVal(user, uval); if (pass) setVal(pass, pval); };
    try { if (user) user.setAttribute('autocomplete', 'current-username'); } catch(_){ }
    try { if (pass) pass.setAttribute('autocomplete', 'current-password'); } catch(_){ }
    applyBoth();
    try { setTimeout(applyBoth, 60); } catch(_){ }
    try { setTimeout(applyBoth, 260); } catch(_){ }
  };

  // 簡易ポップアップ（検索結果のユーザID/パスワードと保存ボタンのみ）
  const ensureFixedPopup = function(anchor) {
    const doc = (anchor && anchor.ownerDocument) || document;
    let box = doc.getElementById('tsupasswd-inline-popup');
    if (!box) {
      box = doc.createElement('div');
      box.id = 'tsupasswd-inline-popup';
      box.style.position = 'fixed';
      box.style.fontSize = '12px';
      box.style.lineHeight = '1.4';
      box.style.background = 'rgba(32,33,36,0.98)';
      box.style.color = '#fff';
      box.style.border = '1px solid rgba(0,0,0,0.2)';
      box.style.borderRadius = '6px';
      box.style.padding = '8px 10px';
      box.style.boxShadow = '0 6px 18px rgba(0,0,0,0.3)';
      box.style.zIndex = '2147483647';
      box.style.display = 'none';
      box.style.width = '300px';
      box.style.maxWidth = 'calc(100vw - 24px)';
      box.style.pointerEvents = 'auto';
      (doc.body || doc.documentElement).appendChild(box);
      try {
        box.addEventListener('mouseenter', () => { window.__tsu_hovering_popup = true; }, true);
        box.addEventListener('mouseleave', () => { window.__tsu_hovering_popup = false; }, true);
        // できるだけ早い段階で抑止フラグを立て、グローバルキャプチャのclick/focusinを無視させる
        const setSuppress = () => { try { window.__tsu_suppress_until = Date.now() + 1500; } catch(_) {} };
        box.addEventListener('pointerdown', (e) => { setSuppress(); try { e.stopPropagation(); } catch(_) {} }, true);
        box.addEventListener('mousedown', (e) => { setSuppress(); try { e.stopPropagation(); } catch(_) {} }, true);
        box.addEventListener('click', (e) => {
          setSuppress();
          try { e.stopPropagation(); } catch(_) {}
          try {
            const t = e.target;
            const interactive = !!(t && (t.closest && (t.closest('button') || t.closest('input') || t.closest('textarea'))));
            if (!interactive) hidePopup(true);
          } catch(_) { try { hidePopup(true); } catch(_) {} }
        }, true);
      } catch(_) {}
    }
    return box;
  };

  const placePopup = function(anchor, box) {
    if (!anchor || !box) return;
    const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { top: 0, left: 0, bottom: 0, width: 0, height: 0 };
    const gap = 8;
    const win = (box.ownerDocument && box.ownerDocument.defaultView) || window;
    let top = Math.min(Math.max(r.bottom + gap, 8), (win.innerHeight || window.innerHeight) - (box.offsetHeight || 0) - 8);
    let left = Math.min(Math.max(r.left, 8), (win.innerWidth || window.innerWidth) - (box.offsetWidth || 0) - 8);
    // Amazon等で rect が 0,0 になるケースのフォールバック: 直近のポインタ座標を使用
    if ((r.top === 0 && r.bottom === 0 && r.left === 0 && r.width === 0) && (window.__tsu_last_pointer)) {
      try {
        const px = window.__tsu_last_pointer.x || 0;
        const py = window.__tsu_last_pointer.y || 0;
        left = Math.min(Math.max(px + 6, 8), (win.innerWidth || window.innerWidth) - (box.offsetWidth || 0) - 8);
        top = Math.min(Math.max(py + 12, 8), (win.innerHeight || window.innerHeight) - (box.offsetHeight || 0) - 8);
      } catch(_) {}
    }
    box.style.top = top + 'px';
    box.style.left = left + 'px';
  };
  const openSaveDialog = function(anchor, idText, pwText) {
    const box = ensureFixedPopup(anchor);
    if (!box) return null;
    dialogOpen = true;
    const urlStr = location && location.href ? String(location.href) : '';
    const title = document.title || '';
    // 事前にフォームから現在値を取得
    let curUser = idText || '';
    let curPass = pwText || '';
    try {
      const a = anchor;
      const form = a && (a.form || (a.closest && a.closest('form')));
      if (form) {
        const ins = Array.prototype.slice.call(form.querySelectorAll('input'));
        const uEl = ins.find(isUserLike) || null;
        const pEl = ins.find(isPassLike) || null;
        if (uEl && typeof uEl.value === 'string') curUser = uEl.value;
        if (pEl && typeof pEl.value === 'string') curPass = pEl.value;
      }
    } catch(_) {}
    box.innerHTML = ''
      + '<div style="display:flex;flex-direction:column;gap:8px;width:100%;">'
      +   '<div style="font-weight:600;">tsupasswdに保存</div>'
      +   '<label style="display:flex;gap:8px;align-items:center;">'
      +     '<div style="flex:0 0 64px;color:#9aa0a6;">タイトル</div>'
      +     '<input id="tsu-save-title" style="flex:1;min-width:0;padding:6px;border:1px solid #3c4043;border-radius:4px;background:#303134;color:#e8eaed;" />'
      +   '</label>'
      +   '<label style="display:flex;gap:8px;align-items:center;">'
      +     '<div style="flex:0 0 64px;color:#9aa0a6;">URL</div>'
      +     '<input id="tsu-save-url" style="flex:1;min-width:0;padding:6px;border:1px solid #3c4043;border-radius:4px;background:#303134;color:#e8eaed;" />'
      +   '</label>'
      +   '<label style="display:flex;gap:8px;align-items:center;">'
      +     '<div style="flex:0 0 64px;color:#9aa0a6;">ユーザID</div>'
      +     '<input id="tsu-save-user" style="flex:1;min-width:0;padding:6px;border:1px solid #3c4043;border-radius:4px;background:#303134;color:#e8eaed;" />'
      +   '</label>'
      +   '<label style="display:flex;gap:8px;align-items:center;">'
      +     '<div style="flex:0 0 64px;color:#9aa0a6;">パスワード</div>'
      +     '<input id="tsu-save-pass" type="password" style="flex:1;min-width:0;padding:6px;border:1px solid #3c4043;border-radius:4px;background:#303134;color:#e8eaed;" />'
      +   '</label>'
      +   '<label style="display:flex;gap:8px;align-items:flex-start;">'
      +     '<div style="flex:0 0 64px;color:#9aa0a6;">備考</div>'
      +     '<textarea id="tsu-save-note" rows="3" style="flex:1;min-width:0;padding:6px;border:1px solid #3c4043;border-radius:4px;background:#303134;color:#e8eaed;"></textarea>'
      +   '</label>'
      +   '<div id="tsu-save-err" style="display:none;color:#f28b82;font-size:12px;"></div>'
      +   '<div style="display:flex;gap:8px;">'
      +     '<button id="tsu-save-cancel" style="flex:1;background:#3c4043;color:#e8eaed;border:none;border-radius:6px;padding:8px 10px;cursor:pointer;">キャンセル</button>'
      +     '<button id="tsu-save-ok" style="flex:1;background:#1a73e8;color:#fff;border:none;border-radius:6px;padding:8px 10px;cursor:pointer;">保存</button>'
      +   '</div>'
      + '</div>';
    box.style.display = 'block';
    try { requestAnimationFrame(() => placePopup(anchor, box)); } catch(_) { placePopup(anchor, box); }
    const q = (sel) => box.querySelector(sel);
    q('#tsu-save-title').value = title;
    q('#tsu-save-url').value = urlStr;
    q('#tsu-save-user').value = curUser || '';
    q('#tsu-save-pass').value = curPass || '';
    const onCancel = (ev) => { try { ev.preventDefault(); ev.stopPropagation(); } catch(_) {}; try { dialogOpen = false; box.style.display = 'none'; } catch(_) {}; };
    const onSave = (ev) => {
      try { ev.preventDefault(); ev.stopPropagation(); } catch(_) {}
      const t = (q('#tsu-save-title').value || '').trim();
      const u = (q('#tsu-save-url').value || '').trim();
      const id = (q('#tsu-save-user').value || '').trim();
      const pw = (q('#tsu-save-pass').value || '').trim();
      const note = (q('#tsu-save-note').value || '').trim();
      const err = q('#tsu-save-err');
      if (!u || (!id && !pw)) {
        if (err) { err.style.display = 'block'; err.textContent = 'URLと、ユーザID/パスワードのいずれかが必要です。'; }
        return;
      }
      const host = (window.tsupasswd && window.tsupasswd.host) || 'dev.happyfactory.tsupasswd';
      const args = ['add', u, id, pw];
      if (t) { args.push('--title', t); }
      if (note) { args.push('--note', note); }
      chrome.runtime.sendMessage({ type: 'RUN_TSUPASSWD', host, args }, (resp) => {
        try {
          if (!(resp && resp.ok)) {
            if (err) { err.style.display = 'block'; err.textContent = '保存に失敗しました'; }
            return;
          }
          // 成功
          try { box.innerHTML = '<div style="padding:8px 4px;">保存しました</div>'; } catch(_) {}
          setTimeout(() => { try { dialogOpen = false; box.style.display = 'none'; } catch(_) {} }, 600);
        } catch(_) {}
      });
    };
    const btnCancel = q('#tsu-save-cancel');
    const btnOk = q('#tsu-save-ok');
    if (btnCancel) { btnCancel.addEventListener('click', onCancel, true); btnCancel.addEventListener('pointerdown', onCancel, true); }
    if (btnOk) { btnOk.addEventListener('click', onSave, true); btnOk.addEventListener('pointerdown', onSave, true); }
    return box;
  };

  const presentAuthPopup = function(anchor) {
    try {
      // アンカーがユーザID/パスワード入力なら常に許可。そうでなければページに可視の認証欄がある場合のみ許可
      if (!(anchor && (isUserLike(anchor) || isPassLike(anchor))) && !hasAuthInputs(document)) return null;
    } catch(_) {}
    try {
      if ((window.__tsu_suppress_until && Date.now() < window.__tsu_suppress_until) || (window.__tsu_last_hidden_at && (Date.now() - window.__tsu_last_hidden_at) < 1500)) {
        return null;
      }
    } catch(_) {}
    try {
      const pref = pickPreferredAnchor(anchor);
      presentAuthPopup.__anchor = pref;
      window.__tsu_current_anchor = pref;
    } catch(_) {}
    const box = ensureFixedPopup(anchor);
    if (!box) return null;
    const urlStr = location && location.href ? String(location.href) : '';
    const host = (window.tsupasswd && window.tsupasswd.host) || 'dev.happyfactory.tsupasswd';
    const buildArgs = (q) => [q];
    const trySearch = (queries, cb) => {
      if (!queries.length) { cb({ ok: false, data: null }); return; }
      const q = queries.shift();
      chrome.runtime.sendMessage({ type: 'RUN_TSUPASSWD', host, args: buildArgs(q) }, (resp) => {
        try {
          let raw = resp && resp.data;
          const parseStr = (s) => { try { return JSON.parse(s); } catch(_) { return null; } };
          let data = null;
          if (raw && typeof raw.stdout === 'string') data = parseStr(raw.stdout);
          if (!data && typeof raw === 'string') data = parseStr(raw);
          if (!data && raw && typeof raw.data === 'string') data = parseStr(raw.data);
          if (!data && typeof raw === 'object') data = raw;
          const arr = Array.isArray(data) ? data : (data && Array.isArray(data.entries) ? data.entries : []);
          if (resp && resp.ok && arr && arr.length) { cb(resp); }
          else { trySearch(queries, cb); }
        } catch(_) { trySearch(queries, cb); }
      });
    };
    let queries = [];
    try {
      const u = new URL(urlStr);
      const origin = u.origin;
      const hostOnly = u.host;
      queries = [urlStr, origin, hostOnly].filter(Boolean);
    } catch(_) {
      queries = [urlStr].filter(Boolean);
    }
    trySearch(queries, (resp) => {
      try {
        const masked = (n) => { try { return n ? '\u2022'.repeat(String(n).length) : '\u2022\u2022\u2022\u2022'; } catch(_) { return '********'; } };
        let ok = !!(resp && resp.ok);
        let raw = resp && resp.data;
        // 一部ホストは {stdout,stderr} / {data} / {output} などで返すため順に試す
        const tryParseJSON = (v) => {
          if (v == null) return null;
          if (typeof v === 'string') {
            const s = v.trim();
            if (s.startsWith('{') || s.startsWith('[')) {
              try { return JSON.parse(s); } catch(_) { return null; }
            }
            return null;
          }
          return null;
        };
        let data = null;
        // 候補順に解析
        data = tryParseJSON(raw && raw.stdout)
            || tryParseJSON(raw && raw.data)
            || tryParseJSON(raw && raw.output)
            || tryParseJSON(typeof raw === 'string' ? raw : null)
            || (raw && typeof raw.data === 'string' ? tryParseJSON(raw.data) : null)
            || raw;
        const pick = (obj, keys) => {
          if (!obj || typeof obj !== 'object') return '';
          for (const k of keys) {
            if (obj[k] != null && (typeof obj[k] === 'string' || typeof obj[k] === 'number')) return String(obj[k]);
          }
          // 大文字小文字吸収
          const lower = {};
          try { for (const k in obj) { lower[k.toLowerCase ? k.toLowerCase() : k] = obj[k]; } } catch(_) {}
          for (const k of keys) {
            const kk = k.toLowerCase();
            if (lower[kk] != null && (typeof lower[kk] === 'string' || typeof lower[kk] === 'number')) return String(lower[kk]);
          }
          return '';
        };
        let username = '', password = '';
        const userKeys = ['username','user','userid','id','login','account'];
        const passKeys = ['password','pass','pwd','secret'];
        const normalize = (v) => {
          if (v == null) return '';
          if (typeof v === 'string' || typeof v === 'number') return String(v).trim();
          return '';
        };
        // entries配列の正規化（全件表示用）
        const toSimple = (item) => {
          const u = normalize((item && item.username) != null ? item.username : (pick(item, userKeys) || findInObj(item, userKeys)));
          const p = normalize((item && item.password) != null ? item.password : (pick(item, passKeys) || findInObj(item, passKeys)));
          const title = normalize(pick(item, ['title','name'])) || '';
          const url = normalize(pick(item, ['url','link','href'])) || '';
          return { username: u, password: p, title, url };
        };
        let entriesAll = [];
        if (ok && Array.isArray(data) && data.length) {
          // ルートが配列の場合（tsupasswdが配列で返す）
          let both = null, either = null;
          for (const item of data) {
            const u = normalize((item && item.username) != null ? item.username : (pick(item, userKeys) || findInObj(item, userKeys)));
            const p = normalize((item && item.password) != null ? item.password : (pick(item, passKeys) || findInObj(item, passKeys)));
            if (u || p) { if (!either) either = { u, p }; }
            if (u && p) { both = { u, p }; break; }
          }
          const best = both || either || { u: '', p: '' };
          username = best.u; password = best.p;
          entriesAll = data.map(toSimple);
        } else if (ok && data && Array.isArray(data.entries) && data.entries.length) {
          // まずは両方揃うエントリを探す
          let both = null, either = null;
          for (const item of data.entries) {
            const u = normalize((item && item.username) != null ? item.username : (pick(item, userKeys) || findInObj(item, userKeys)));
            const p = normalize((item && item.password) != null ? item.password : (pick(item, passKeys) || findInObj(item, passKeys)));
            if (u || p) { if (!either) either = { u, p }; }
            if (u && p) { both = { u, p }; break; }
          }
          const best = both || either || { u: '', p: '' };
          username = best.u; password = best.p;
          entriesAll = data.entries.map(toSimple);
        } else if (ok && data && typeof data === 'object') {
          username = normalize((data && data.username) != null ? data.username : (pick(data, userKeys) || findInObj(data, userKeys)));
          password = normalize((data && data.password) != null ? data.password : (pick(data, passKeys) || findInObj(data, passKeys)));
          entriesAll = [toSimple(data)];
        }
        // 一覧HTMLを生成
        let listHtml = '';
        if (Array.isArray(entriesAll) && entriesAll.length) {
          for (let i = 0; i < entriesAll.length; i++) {
            const e = entriesAll[i];
            const t = e.title || e.url || '';
            const u = e.username || '';
            const p = e.password || '';
            listHtml += ''
              + '<div class="tsu-entry" data-idx="' + i + '" style="padding:6px;border:1px solid rgba(255,255,255,0.08);border-radius:6px;background:rgba(255,255,255,0.03);cursor:pointer;">'
                + (t ? '<div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(t) + '</div>' : '')
                + (e.url ? '<div style="color:#9aa0a6;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(e.url) + '</div>' : '')
                + '<div style="display:flex;flex-direction:column;gap:2px;font-size:12px;margin-top:2px;">'
                  + '<div>ユーザID: <span>' + esc(u || '未検出') + '</span></div>'
                  + '<div>パスワード: <span>' + (p ? masked(p) : '未検出') + '</span></div>'
                + '</div>'
              + '</div>';
          }
        } else {
          listHtml = '<div style="color:#9aa0a6;">未検出</div>';
        }
        // 検索結果がそろってから描画（一覧 + 保存ボタン）
        const bodyHtml = '<div style="display:flex;flex-direction:column;gap:8px;width:100%;">'
          + '<div id="tsu-list" style="display:flex;flex-direction:column;gap:6px;max-height:280px;overflow:auto;">' + listHtml + '</div>'
          + '<div>'
            + '<button id="tsu-save-entry" style="background:#1a73e8;color:#fff;border:none;border-radius:6px;padding:8px 10px;cursor:pointer;width:100%;">tsupasswdに保存</button>'
          + '</div>'
        + '</div>';
        box.innerHTML = bodyHtml;
        // ホバーで自動入力
        try {
          const items = box.querySelectorAll('.tsu-entry');
          items.forEach((node) => {
            const idx = parseInt(node.getAttribute('data-idx') || '-1', 10);
            const cred = (idx >= 0 && idx < entriesAll.length) ? entriesAll[idx] : null;
            if (!cred) return;
            const onHoverFill = () => {
              try {
                const a = anchor;
                const form = a && (a.form || (a.closest && a.closest('form')));
                let uEl = null, pEl = null;
                let ins = [];
                if (form) {
                  ins = Array.prototype.slice.call(form.querySelectorAll('input'));
                } else {
                  ins = Array.prototype.slice.call(document.querySelectorAll('input'));
                }
                uEl = ins.find(isUserLike) || null;
                pEl = ins.find(isPassLike) || null;
                forceApply(uEl, pEl, cred.username || '', cred.password || '');
              } catch(_) {}
            };
            node.addEventListener('mouseenter', onHoverFill, true);
            const onClickFillClose = (ev) => {
              try { ev.preventDefault(); ev.stopPropagation(); } catch(_) {}
              try { onHoverFill(); } catch(_) {}
              try { window.__tsu_suppress_until = Date.now() + 3000; } catch(_) {}
              try { window.__tsu_hovering_popup = false; } catch(_) {}
              try { hidePopup(true); } catch(_) {}
              try { requestAnimationFrame(() => hidePopup(true)); } catch(_) {}
            };
            node.addEventListener('pointerdown', (e) => { try { window.__tsu_suppress_until = Date.now() + 3000; e.stopPropagation(); } catch(_) {} }, true);
            node.addEventListener('click', onClickFillClose, true);
          });
        } catch(_) {}
        box.style.display = 'block';
        try { requestAnimationFrame(() => placePopup(anchor, box)); } catch(_) { placePopup(anchor, box); }

        // 保存ボタン→保存フォームダイアログを開く
        const saveBtn = box.querySelector('#tsu-save-entry');
        if (saveBtn) {
          const onOpen = (ev) => { try { ev.preventDefault(); ev.stopPropagation(); } catch(_) {} openSaveDialog(anchor, '', ''); };
          saveBtn.addEventListener('click', onOpen, true);
          saveBtn.addEventListener('pointerdown', onOpen, true);
        }
      } catch(_) {}
    });
    return box;
  };

  const hidePopup = function(force) {
    try {
      if (!force) {
        if (dialogOpen) return;
        if (window.__tsu_hovering_popup) return;
      }
      const doc = document;
      const box = doc.getElementById('tsupasswd-inline-popup');
      if (!box) return;
      try { window.__tsu_hovering_popup = false; } catch(_) {}
      box.style.display = 'none';
      try { window.__tsu_current_anchor = null; } catch(_) {}
      try { window.__tsu_last_hidden_at = Date.now(); } catch(_) {}
      if (force) { try { window.__tsu_suppress_until = Date.now() + 3000; } catch(_) {} }
    } catch(_) {}
  };
  const hidePopupDelayed = function() { try { if (dialogOpen) return; setTimeout(() => { if (!dialogOpen && !window.__tsu_hovering_popup) hidePopup(false); }, 120); } catch(_) {} };

  const filledSet = new WeakSet();
  let lastPairs = [];
  let lastCreds = null;
  let lastEntries = null;
  const attachBoxClick = function(box) { return; };

  const fillAndBind = function(creds) {
    try {
      const inputs = getAllInputsDeep(document);
      const pairs = pairUserPass(inputs);
      if (!pairs.length) {
        // ペアが無い場合でも、後続のユーザIDのみフォールバックを実行するため続行
        lastPairs = [];
        lastCreds = creds;
      } else {
        lastPairs = pairs;
        lastCreds = creds;
      }
      const userVal = creds.id || creds.username || '';
      const passVal = creds.password || '';
      let firstAnchor = null;
      for (const { user, pass } of pairs) {
        if (!user || !pass) continue;
        if (!firstAnchor) firstAnchor = pass || user;
        // クリック時にポップアップ表示、クリックで入力
        if (!user.__tsuBound) {
          const showOnClick = function(){
            if (dialogOpen) return;
            try {
              const f = user && (user.form || (user.closest && user.closest('form')));
              if (f && f.__tsuBound) return;
              if (f) f.__tsuBound = true;
            } catch(_) { return; }
            const b = presentAuthPopup(pickPreferredAnchor(user)); attachBoxClick(b);
          };
          user.addEventListener('pointerdown', showOnClick, true);
          user.addEventListener('click', showOnClick);
          user.addEventListener('blur', hidePopupDelayed);
          user.__tsuBound = true;
        }
        if (!pass.__tsuBound) {
          const showOnClickP = function(){
            if (dialogOpen) return;
            try {
              const f = pass && (pass.form || (pass.closest && pass.closest('form')));
              if (f && f.__tsuBound) return;
              if (f) f.__tsuBound = true;
            } catch(_) { return; }
            const b = presentAuthPopup(pickPreferredAnchor(pass)); attachBoxClick(b);
          };
          pass.addEventListener('pointerdown', showOnClickP, true);
          pass.addEventListener('click', showOnClickP);
          pass.addEventListener('blur', hidePopupDelayed);
          pass.__tsuBound = true;
        }
      }
      // パスワード欄が無くペアが作れないページでも、ユーザID欄で表示できるようフォールバックをバインド
      try {
        if (!pairs.length) {
          const usersOnly = (inputs || []).filter(isUserLike);
          if (!firstAnchor && usersOnly.length) firstAnchor = usersOnly[0];
          for (const uEl of usersOnly) {
            if (uEl.__tsuBound) continue;
            const showOnClickU = function(){ if (dialogOpen) return; const b = presentAuthPopup(pickPreferredAnchor(uEl)); attachBoxClick(b); };
            uEl.addEventListener('pointerdown', showOnClickU, true);
            uEl.addEventListener('click', showOnClickU);
            uEl.addEventListener('blur', hidePopupDelayed);
            uEl.__tsuBound = true;
          }
          // パスワード欄しかないページでも同様にフォールバック表示
          const passesOnly = (inputs || []).filter(isPassLike);
          if (!firstAnchor && passesOnly.length) firstAnchor = passesOnly[0];
          for (const pEl of passesOnly) {
            if (pEl.__tsuBound) continue;
            const showOnClickOnlyP = function(){ if (dialogOpen) return; const b = presentAuthPopup(pickPreferredAnchor(pEl)); attachBoxClick(b); };
            pEl.addEventListener('pointerdown', showOnClickOnlyP, true);
            pEl.addEventListener('click', showOnClickOnlyP);
            pEl.addEventListener('blur', hidePopupDelayed);
            pEl.__tsuBound = true;
          }
        }
      } catch(_) {}
      // 自動表示: 初回のみ。ただしアンカーが可視・実寸あり・直近ポインタ座標がある場合に限る（レイアウト未完了やポインタ未取得での左上表示を防ぐ）
      try {
        if (!window.__tsu_auto_shown) {
          const anchorRaw = firstAnchor || (pairs[0] && (pairs[0].pass || pairs[0].user)) || null;
          const anchor = anchorRaw ? pickPreferredAnchor(anchorRaw) : null;
          if (anchor) {
            let ok = false;
            try {
              const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
              const rectOk = !!(r && r.width > 0 && r.height > 0);
              const visOk = isProbablyVisible(anchor);
              const ptrOk = !!(window.__tsu_last_pointer);
              ok = rectOk && visOk && ptrOk;
            } catch(_) { ok = false; }
            if (ok) {
              const b = presentAuthPopup(anchor); attachBoxClick(b);
              window.__tsu_auto_shown = true;
            }
          }
        }
      } catch(_) {}

      // グローバルクリック/ポインタ（キャプチャ）で新規/Shadow DOM内のクリックにも反応
      if (!window.__tsu_click_bound) {
        const onClickIn = (e) => {
          try {
            if (dialogOpen) return;
            const path = (e.composedPath && e.composedPath()) || [];
            const t = (path && path.length ? path[0] : e.target);
            const inPopup = !!(t && (t.closest ? t.closest('#tsupasswd-inline-popup') : null));
            const el = (t && t.nodeType === 1) ? (t.matches && t.matches('input') ? t : (t.closest && t.closest('input'))) : null;
            // ポップアップ外をクリックしたら、抑止中でも必ず閉じる
            if (!inPopup && !el) { hidePopup(true); return; }
            if (!(el && (isUserLike(el) || isPassLike(el)))) { if (!inPopup) { hidePopup(true); } return; }
            // hasAuthInputs は presentAuthPopup 側でガードするためここでは不要
            // ここからは表示トリガ。抑止中/直後は新規表示を抑える
            try { if ((window.__tsu_suppress_until && Date.now() < window.__tsu_suppress_until) || (window.__tsu_last_hidden_at && (Date.now() - window.__tsu_last_hidden_at) < 1500)) return; } catch(_) {}
            const pref = pickPreferredAnchor(el);
            // 既に表示中かつロック中は、別要素（非優先アンカー）からのイベントを無視して揺れを防ぐ
            try {
              if (window.__tsu_current_anchor && window.__tsu_current_anchor !== pref) {
                return;
              }
            } catch(_) {}
            const b = presentAuthPopup(pref);
            attachBoxClick(b);
          } catch(_) {}
        };
        document.addEventListener('click', onClickIn, true);
        document.addEventListener('pointerdown', onClickIn, true);
        window.__tsu_click_bound = true;
      }
      // Escapeで閉じる
      if (!window.__tsu_key_bound) {
        document.addEventListener('keydown', (ev) => { try { if (ev.key === 'Escape') { hidePopup(true); } } catch(_) {} }, true);
        window.__tsu_key_bound = true;
      }
      // スクロール/リサイズ/ページ非表示で閉じる
      if (!window.__tsu_page_bound) {
        const closePassive = () => { try { hidePopup(false); } catch(_) {} };
        try {
          window.addEventListener('scroll', closePassive, true);
          window.addEventListener('resize', closePassive, true);
          document.addEventListener('visibilitychange', () => { if (document.hidden) hidePopup(true); }, true);
          // 最終ポインタ座標の追跡（位置決めのフォールバック用）
          const track = (ev) => {
            try { window.__tsu_last_pointer = { x: ev.clientX || 0, y: ev.clientY || 0 }; } catch(_) {}
          };
          window.addEventListener('pointermove', track, { capture: true, passive: true });
          window.addEventListener('pointerdown', track, { capture: true, passive: true });
        } catch(_) {}
        window.__tsu_page_bound = true;
      }
      return true;
    } catch(_) { return false; }
  };

  let cachedCreds = null;
  const run = async () => {
    if (ran) return; ran = true;
    try {
      const urlStr = location.href || '';
      const url = new URL(urlStr);
      const allowed = url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'file:';
      if (!allowed) return;
      // まずは即時にバインドして、フォーカス時にポップが出るようにする（資格情報は空でOK）
      try { fillAndBind({ username: '', password: '' }); } catch(_) {}

      const fetchCreds = () => new Promise((resolve) => {
        if (cachedCreds) { resolve(cachedCreds); return; }
        const host = (window.tsupasswd && window.tsupasswd.host) || 'dev.happyfactory.tsupasswd';
        const args = [urlStr];
        chrome.runtime.sendMessage({ type: 'RUN_TSUPASSWD', host, args }, (resp) => {
          if (!(resp && resp.ok)) { resolve(null); return; }
          let data = resp.data;
          try { data = (typeof data === 'string') ? JSON.parse(data) : data; } catch(_) {}
          if (!data) { resolve(null); return; }
          // entries対応
          if (data.entries && Array.isArray(data.entries) && data.entries.length > 0) {
            lastEntries = data.entries;
            const first = data.entries[0] || {};
            cachedCreds = { username: first.username || data.username, password: first.password || data.password };
            resolve(cachedCreds);
            return;
          }
          if (!(data.username && data.password)) { resolve(null); return; }
          lastEntries = null;
          cachedCreds = data;
          resolve(cachedCreds);
        });
      });

      const creds = await fetchCreds();
      if (creds) { try { fillAndBind(creds); } catch(_) {} }

      // SPAで後からフィールドが出現する場合に備え監視（早期開始済みのバインドを前提に追従）
      if (!window.__tsu_observer) {
        const debounced = (() => { let t = null; return (fn) => { clearTimeout(t); t = setTimeout(fn, 150); }; })();
        const observer = new MutationObserver(() => debounced(() => fillAndBind(cachedCreds || { username: '', password: '' })));
        observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
        window.__tsu_observer = observer;
      }

      // URL変化（SPA遷移）時に自動表示を再有効化
      if (!window.__tsu_url_bound) {
        const onUrlChange = () => {
          try {
            window.__tsu_auto_shown = false;
            fillAndBind(cachedCreds || { username: '', password: '' });
          } catch(_) {}
        };
        try {
          const origPush = history.pushState;
          const origReplace = history.replaceState;
          history.pushState = function() { try { origPush.apply(this, arguments); } finally { onUrlChange(); } };
          history.replaceState = function() { try { origReplace.apply(this, arguments); } finally { onUrlChange(); } };
        } catch(_) {}
        try { window.addEventListener('popstate', onUrlChange); } catch(_) {}
        try { window.addEventListener('hashchange', onUrlChange); } catch(_) {}
        window.__tsu_url_bound = true;
      }
    } catch(_) {}
  };

  // ポップアップからの指示で実行
  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.type === 'TSUPASSWD_FILL') {
        (async () => {
          try { await run(); sendResponse({ ok: true }); }
          catch (_) { sendResponse({ ok: false }); }
        })();
        return true; // async
      }
    });
  } catch (_) {}

  // ページ読み込み時にも自動実行（ranフラグで二重起動防止）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
})();
