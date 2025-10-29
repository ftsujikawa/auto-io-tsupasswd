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
  // 明確にメール/ユーザIDと判断できる入力か（誤検出を避けつつ広めに）
  const isClearlyEmailLike = function(el) {
    try {
      if (!el || el.nodeType !== 1) return false;
      const tag = (el.tagName || '').toLowerCase();
      const type = (el.getAttribute && (el.getAttribute('type') || '')) || '';
      const name = (el.getAttribute && (el.getAttribute('name') || '')) || '';
      const id = (el.getAttribute && (el.getAttribute('id') || '')) || '';
      const ac = (el.getAttribute && (el.getAttribute('autocomplete') || '')) || '';
      const im = (el.getAttribute && (el.getAttribute('inputmode') || '')) || '';
      const hint = `${name} ${id} ${ac}`.toLowerCase();
      const typeL = String(type).toLowerCase();
      const imL = String(im).toLowerCase();
      if (typeL === 'email') return true;
      if (imL === 'email') return true;
      if (/(^|\b)(email|e-mail|mail|username|user|userid|login|account)(\b|$)/.test(hint)) return true;
      if (tag === 'input' && typeL === 'text' && /(email|username)/.test(hint)) return true;
      if (tag === 'input' && ac && /(email|username)/i.test(ac)) return true;
      return false;
    } catch(_) { return false; }
  };

  const byHint = function(el) {
    const s = (el && (el.name || "")) + " " + (el && (el.id || "")) + " " + (el && (el.autocomplete || ""));
    return s.toLowerCase();
  };
  // ページからパスキー情報を推測抽出
  const extractPasskeyFromPage = function(rootDoc) {
    const doc = rootDoc || document;
    const out = { rp: '', cred: '', user: '', pub: '', count: '', transports: '' };
    // WebAuthnフックのキャッシュを優先
    try {
      const c = (window && window.__tsu_pk_cache) || {};
      if (c.rpId) out.rp = c.rpId;
      if (c.credentialIdB64) out.cred = c.credentialIdB64;
      if (c.userHandleB64) out.user = c.userHandleB64;
      if (c.publicKeyB64) out.pub = c.publicKeyB64; // まだ未設定の可能性あり
      if (typeof c.signCount === 'number') out.count = String(c.signCount);
    } catch(_) {}
    try { if (!out.rp) out.rp = (location && location.hostname) ? String(location.hostname) : ''; } catch(_) {}
    try {
      const nodes = Array.prototype.slice.call(doc.querySelectorAll('input, textarea, [data-credential-id], [data-user-handle], [data-public-key]'));
      for (const n of nodes) {
        const hint = (n.getAttribute && ((n.getAttribute('name') || '') + ' ' + (n.getAttribute('id') || '') + ' ' + (n.getAttribute('data-name') || ''))).toLowerCase();
        const val = (n.getAttribute && (n.getAttribute('value') || n.textContent || '')) || (n.value != null ? String(n.value) : '');
        if (!out.cred && /cred|credential/.test(hint)) { out.cred = (val || '').trim(); }
        if (!out.user && /user.*handle|user[_-]?id|uid\b/.test(hint)) { out.user = (val || '').trim(); }
        if (!out.pub && /public.*key|pubkey|publickey/.test(hint)) { out.pub = (val || '').trim(); }
        if (!out.count && /sign[_-]?count|signcount|counter/.test(hint)) { out.count = (val || '').trim(); }
        if (!out.transports && /transport/.test(hint)) { out.transports = (val || '').trim(); }
      }
      // script内のJSON/変数から抽出（軽量な正規表現）
      if (!(out.cred && out.user && out.pub)) {
        const scripts = Array.prototype.slice.call(doc.scripts || []);
        for (const s of scripts) {
          const txt = (s && s.textContent) ? s.textContent : '';
          if (!txt) continue;
          if (!out.cred) { const m = txt.match(/credential[_-]?id["']?\s*[:=]\s*["']([^"']+)/i); if (m) out.cred = m[1].trim(); }
          if (!out.user) { const m = txt.match(/user[_-]?handle["']?\s*[:=]\s*["']([^"']+)/i); if (m) out.user = m[1].trim(); }
          if (!out.pub) { const m = txt.match(/public[_-]?key["']?\s*[:=]\s*["']([^"']+)/i); if (m) out.pub = m[1].trim(); }
          if (!out.count) { const m = txt.match(/sign[_-]?count["']?\s*[:=]\s*([0-9]+)/i); if (m) out.count = m[1].trim(); }
          if (!out.transports) { const m = txt.match(/transports["']?\s*[:=]\s*["']([^"']+)/i); if (m) out.transports = m[1].trim(); }
          if (out.cred && out.user && out.pub) break;
        }
      }
    } catch(_) {}
    return out;
  };

  // Base64URL エンコード（ArrayBuffer -> string）
  const b64u = (buf) => {
    try {
      const b = new Uint8Array(buf);
      let s = '';
      for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
      return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/,'');
    } catch(_) { return ''; }
  };
  const toU8 = (buf) => {
    try { return buf instanceof Uint8Array ? buf : new Uint8Array(buf); } catch(_) { return new Uint8Array(0); }
  };
  // 簡易CBORデコーダ（必要最小限: uint, nint, bytes, text, array, map, simple/float）
  const cborDecodeItem = (u8, offset) => {
    const len = u8.length;
    if (offset >= len) throw new Error('CBOR: OOB');
    const ib = u8[offset];
    const major = ib >> 5;
    let ai = ib & 0x1f;
    let pos = offset + 1;
    const readLen = (n) => { if (pos + n > len) throw new Error('CBOR: OOB'); let v = 0; for (let i=0;i<n;i++) v = (v<<8) | u8[pos+i]; pos += n; return v; };
    const readAddl = () => {
      if (ai < 24) return ai;
      if (ai === 24) return readLen(1);
      if (ai === 25) return readLen(2);
      if (ai === 26) return readLen(4);
      if (ai === 27) { const hi = readLen(4), lo = readLen(4); return hi * 0x100000000 + lo; }
      throw new Error('CBOR: indef or reserved not supported');
    };
    if (major === 0) { // unsigned int
      const v = readAddl();
      return { value: v, length: pos - offset };
    } else if (major === 1) { // negative int
      const v = readAddl();
      return { value: -1 - v, length: pos - offset };
    } else if (major === 2) { // bytes
      const l = readAddl();
      if (pos + l > len) throw new Error('CBOR: bytes OOB');
      const val = u8.slice(pos, pos + l);
      pos += l;
      return { value: val, length: pos - offset };
    } else if (major === 3) { // text
      const l = readAddl();
      if (pos + l > len) throw new Error('CBOR: text OOB');
      const val = new TextDecoder('utf-8').decode(u8.slice(pos, pos + l));
      pos += l;
      return { value: val, length: pos - offset };
    } else if (major === 4) { // array
      const l = readAddl();
      const arr = [];
      for (let i=0;i<l;i++) { const it = cborDecodeItem(u8, pos); arr.push(it.value); pos += it.length; }
      return { value: arr, length: pos - offset };
    } else if (major === 5) { // map
      const l = readAddl();
      const obj = {};
      for (let i=0;i<l;i++) {
        const k = cborDecodeItem(u8, pos); pos += k.length;
        const v = cborDecodeItem(u8, pos); pos += v.length;
        obj[k.value] = v.value;
      }
      return { value: obj, length: pos - offset };
    } else if (major === 6) { // tag -> skip tag and decode tagged item
      /* const tag = */ readAddl();
      const inner = cborDecodeItem(u8, pos);
      pos += inner.length;
      return { value: inner.value, length: pos - offset };
    } else if (major === 7) {
      // simple/float: treat as null-ish
      return { value: null, length: pos - offset };
    }
    throw new Error('CBOR: unknown major');
  };
  const cborDecode = (u8) => cborDecodeItem(u8, 0);
  // attestationObject から authData を取り出し、credentialPublicKey（生CBOR）と signCount を抽出
  const parseAttestation = (u8) => {
    try {
      const top = cborDecode(u8).value; // map
      const authData = top && top.authData ? toU8(top.authData) : null;
      if (!authData || authData.length < 37) return null;
      let p = 0;
      /* const rpIdHash = */ authData.slice(p, p+32); p += 32;
      const flags = authData[p]; p += 1;
      const signCount = ((authData[p] << 24) | (authData[p+1] << 16) | (authData[p+2] << 8) | authData[p+3]) >>> 0; p += 4;
      const AT = (flags & 0x40) !== 0;
      if (!AT) return { signCount };
      p += 16; // aaguid
      const credIdLen = (authData[p] << 8) | authData[p+1]; p += 2;
      p += credIdLen; // credential id
      // ここから credentialPublicKey (CBOR). デコードして長さを取得し、その生バイトを切り出す
      const pkItem = cborDecodeItem(authData, p);
      const raw = authData.slice(p, p + pkItem.length);
      return { signCount, publicKeyRaw: raw };
    } catch(_) { return null; }
  };

  // WebAuthn フック（1度だけ）
  try {
    if (!window.__tsu_webauthn_hooked && navigator && navigator.credentials) {
      window.__tsu_pk_cache = window.__tsu_pk_cache || {};
      const origCreate = navigator.credentials.create.bind(navigator.credentials);
      const origGet = navigator.credentials.get.bind(navigator.credentials);
      navigator.credentials.create = async function(options) {
        try {
          const pub = options && options.publicKey;
          if (pub) {
            try {
              if (pub.rp && pub.rp.id) window.__tsu_pk_cache.rpId = String(pub.rp.id);
              if (pub.user && pub.user.id) {
                const u = pub.user.id; // ArrayBufferSource
                const buf = (u instanceof ArrayBuffer) ? u : (ArrayBuffer.isView(u) ? u.buffer : null);
                if (buf) window.__tsu_pk_cache.userHandleB64 = b64u(buf);
              }
            } catch(_) {}
          }
        } catch(_) {}
        const cred = await origCreate(options);
        try {
          if (cred && cred.type === 'public-key') {
            try { window.__tsu_pk_cache.credentialIdB64 = b64u(cred.rawId); } catch(_) {}
            const resp = cred.response;
            // attestationObject から公開鍵を抽出する処理は未実装。バイナリ自体は保持しておく。
            try {
              if (resp && resp.attestationObject) {
                window.__tsu_pk_cache.attestationB64 = b64u(resp.attestationObject);
                const parsed = parseAttestation(toU8(resp.attestationObject));
                if (parsed) {
                  if (typeof parsed.signCount === 'number') window.__tsu_pk_cache.signCount = parsed.signCount;
                  if (parsed.publicKeyRaw) window.__tsu_pk_cache.publicKeyB64 = b64u(parsed.publicKeyRaw);
                }
              }
            } catch(_) {}
          }
        } catch(_) {}
        return cred;
      };
      navigator.credentials.get = async function(options) {
        try {
          const pub = options && options.publicKey;
          if (pub) {
            try { if (pub.rpId) window.__tsu_pk_cache.rpId = String(pub.rpId); } catch(_) {}
          }
        } catch(_) {}
        const cred = await origGet(options);
        try {
          if (cred && cred.type === 'public-key') {
            try { window.__tsu_pk_cache.credentialIdB64 = b64u(cred.rawId); } catch(_) {}
            const resp = cred.response;
            try { if (resp && resp.userHandle) window.__tsu_pk_cache.userHandleB64 = b64u(resp.userHandle); } catch(_) {}
          }
        } catch(_) {}
        return cred;
      };
      window.__tsu_webauthn_hooked = true;
    }
  } catch(_) {}
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
  const isTextboxLike = function(el) {
    try {
      if (!el || el.nodeType !== 1) return false;
      if (el.matches && el.matches('input, textarea')) return true;
      const role = (el.getAttribute && el.getAttribute('role')) || '';
      const ce = (el.getAttribute && el.getAttribute('contenteditable')) || '';
      if (String(role).toLowerCase() === 'textbox') return true;
      if (ce && String(ce).toLowerCase() !== 'false') return true;
      return false;
    } catch(_) { return false; }
  };
  const hasAuthInputs = function(rootDoc) {
    try {
      const doc = rootDoc || document;
      const nodes = Array.prototype.slice.call(doc.querySelectorAll('input, textarea, [role="textbox"], [contenteditable]'));
      // 可視なユーザID欄またはパスワード欄のどちらか一方でもあれば true
      return nodes.some((i) => {
        try {
          if (!isProbablyVisible(i)) return false;
          if (i.matches && i.matches('input')) return (isUserLike(i) || isPassLike(i));
          // 非inputでも、ユーザ名のみ許可文脈では textbox をユーザ名欄として扱う
          if (isUsernameOnlyAllowedContext() && isTextboxLike(i)) return true;
          return false;
        } catch(_) { return false; }
      });
    } catch(_) { return false; }
  };
  // ユーザ名のみのステップを許可する文脈（JetBrainsホスト全体、Amazonはサインインページのみ）
  const isUsernameOnlyAllowedContext = function() {
    try {
      const h = location && location.hostname ? String(location.hostname) : '';
      const p = location && location.pathname ? String(location.pathname) : '';
      if (!h) return false;
      if (h === 'account.jetbrains.com') return true; // ログインドメイン専用
      if ((h === 'www.amazon.co.jp' || h === 'amazon.co.jp') && p.startsWith('/ap/signin')) return true;
      if (((h === 'www.disneyplus.com') || (h === 'disneyplus.com') || h.endsWith('.disneyplus.com')) && p.startsWith('/identity/')) return true;
      return false;
    } catch(_) { return false; }
  };
  // 同一フォーム内に可視のパスワード入力があるか
  const hasVisiblePassInSameForm = function(el) {
    try {
      if (!el) return false;
      const form = el.form || (el.closest && el.closest('form'));
      const scope = form || el.ownerDocument;
      const ins = Array.prototype.slice.call(scope.querySelectorAll('input'));
      return ins.some((i) => isPassLike(i) && isProbablyVisible(i));
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
          try {
            const t = e.target;
            const interactive = !!(t && (t.closest && (t.closest('button') || t.closest('input') || t.closest('textarea'))));
            if (!interactive) {
              try { e.stopPropagation(); } catch(_) {}
              hidePopup(true);
            }
          } catch(_) { try { e.stopPropagation(); hidePopup(true); } catch(_) {} }
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

  // パスキー保存ダイアログ（rp_id, credential_id, user_handle, public_key, [--sign-count], [--transports]）
  const openPasskeyDialog = function(anchor, prefill) {
    const box = ensureFixedPopup(anchor);
    if (!box) return null;
    dialogOpen = true;
    const urlStr = location && location.href ? String(location.href) : '';
    const rpIdInit = (prefill && prefill.rp) ? String(prefill.rp) : ((location && location.hostname) ? String(location.hostname) : '');
    const html = '<div style="display:flex;flex-direction:column;gap:8px;width:100%;">'
      + '<div style="font-weight:600;">パスキーを保存</div>'
      + '<div style="display:flex;flex-direction:column;gap:6px;">'
        + '<label style="font-size:12px;">RP ID<input id="tsu-pk-rp" type="text" style="width:100%;padding:6px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.06);color:#e8eaed;" value="' + esc(rpIdInit) + '"></label>'
        + '<label style="font-size:12px;">Credential ID<input id="tsu-pk-cred" type="text" style="width:100%;padding:6px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.06);color:#e8eaed;" value="' + esc((prefill && prefill.cred) ? prefill.cred : '') + '"></label>'
        + '<label style="font-size:12px;">User Handle<input id="tsu-pk-user" type="text" style="width:100%;padding:6px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.06);color:#e8eaed;" value="' + esc((prefill && prefill.user) ? prefill.user : '') + '"></label>'
        + '<label style="font-size:12px;">Public Key<input id="tsu-pk-pub" type="text" style="width:100%;padding:6px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.06);color:#e8eaed;" value="' + esc((prefill && prefill.pub) ? prefill.pub : '') + '"></label>'
        + '<div style="display:flex;gap:8px;">'
          + '<label style="font-size:12px;flex:1;">Sign Count<input id="tsu-pk-count" type="number" min="0" step="1" style="width:100%;padding:6px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.06);color:#e8eaed;" value="' + esc((prefill && prefill.count) ? prefill.count : '') + '"></label>'
          + '<label style="font-size:12px;flex:1;">Transports (CSV)<input id="tsu-pk-trans" type="text" placeholder="usb,nfc,ble,internal" style="width:100%;padding:6px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.06);color:#e8eaed;" value="' + esc((prefill && prefill.transports) ? prefill.transports : '') + '"></label>'
        + '</div>'
      + '</div>'
      + '<div style="display:flex;gap:8px;">'
        + '<button id="tsu-pk-cancel" style="flex:1;background:#5f6368;color:#fff;border:none;border-radius:6px;padding:8px 10px;cursor:pointer;">キャンセル</button>'
        + '<button id="tsu-pk-ok" style="flex:1;background:#34a853;color:#fff;border:none;border-radius:6px;padding:8px 10px;cursor:pointer;">保存</button>'
      + '</div>'
    + '</div>';
    box.innerHTML = html;
    box.style.display = 'block';
    try { requestAnimationFrame(() => placePopup(anchor, box)); } catch(_) { placePopup(anchor, box); }

    const q = (sel) => box.querySelector(sel);
    const rpEl = q('#tsu-pk-rp');
    const credEl = q('#tsu-pk-cred');
    const userEl = q('#tsu-pk-user');
    const pubEl = q('#tsu-pk-pub');
    const cntEl = q('#tsu-pk-count');
    const trEl = q('#tsu-pk-trans');
    const btnCancel = q('#tsu-pk-cancel');
    const btnOk = q('#tsu-pk-ok');

    const onCancel = (ev) => { try { ev.preventDefault(); ev.stopPropagation(); } catch(_) {} dialogOpen = false; hidePopup(true); };
    const onSave = (ev) => {
      try { ev.preventDefault(); ev.stopPropagation(); } catch(_) {}
      const rp = (rpEl && rpEl.value || '').trim();
      const cred = (credEl && credEl.value || '').trim();
      const usr = (userEl && userEl.value || '').trim();
      const pub = (pubEl && pubEl.value || '').trim();
      const cntRaw = (cntEl && cntEl.value || '').trim();
      const trans = (trEl && trEl.value || '').trim();
      if (!rp || !cred || !usr || !pub) {
        try { alert('必須: RP ID, Credential ID, User Handle, Public Key'); } catch(_) {}
        return;
      }
      const host = (window.tsupasswd && window.tsupasswd.host) || 'dev.happyfactory.tsupasswd';
      const args = ['passkey', 'add', rp, cred, usr, pub];
      if (cntRaw !== '') { args.push('--sign-count', String(parseInt(cntRaw, 10) || 0)); }
      if (trans !== '') { args.push('--transports', trans); }
      chrome.runtime.sendMessage({ type: 'RUN_TSUPASSWD', host, args }, (resp) => {
        try {
          if (resp && resp.ok) {
            dialogOpen = false; hidePopup(true);
          } else {
            try { alert('保存に失敗しました: ' + (resp && (resp.error || resp.stderr || resp.stdout) || 'unknown')); } catch(_) {}
          }
        } catch(_) { dialogOpen = false; hidePopup(true); }
      });
    };
    if (btnCancel) { btnCancel.addEventListener('click', onCancel, true); btnCancel.addEventListener('pointerdown', onCancel, true); }
    if (btnOk) { btnOk.addEventListener('click', onSave, true); btnOk.addEventListener('pointerdown', onSave, true); }
    return box;
  };

  const presentAuthPopup = function(anchor) {
    try {
      // パスワード欄は常に許可。ユーザ名欄は、(a) 明確にメール/ユーザID欄なら常に許可 (b) それ以外は同一フォームに可視パス有 or 許可文脈
      const userLike = !!(anchor && (isUserLike(anchor) || (isUsernameOnlyAllowedContext() && isTextboxLike(anchor))));
      const passLike = !!(anchor && isPassLike(anchor));
      if (!(anchor && (userLike || passLike))) return null;
      if (userLike && !passLike) {
        const clearEmail = isClearlyEmailLike(anchor);
        if (!clearEmail) {
          const sameFormHasPass = hasVisiblePassInSameForm(anchor);
          if (!sameFormHasPass && !isUsernameOnlyAllowedContext()) return null;
        }
      }
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
        // 資格情報が無い場合でもポップアップは表示し、保存ボタンのみ使えるようにする
        try {
          const noUser = !username || String(username).trim() === '';
          const noPass = !password || String(password).trim() === '';
          // 空エントリを除去
          if (Array.isArray(entriesAll)) {
            entriesAll = entriesAll.filter((e) => {
              try {
                const uu = (e && e.username) ? String(e.username).trim() : '';
                const pp = (e && e.password) ? String(e.password).trim() : '';
                return !!(uu || pp);
              } catch(_) { return false; }
            });
          }
          const noEntries = !Array.isArray(entriesAll) || entriesAll.length === 0;
          // 何も無ければ entriesAll は空のままにし、以降で『未検出』として表示する
          if ((!ok || !data) && noUser && noPass) {
            entriesAll = [];
          }
        } catch(_) {}
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
          listHtml = ''
            + '<div class="tsu-entry" style="padding:6px;border:1px solid rgba(255,255,255,0.08);border-radius:6px;background:rgba(255,255,255,0.03);">'
            + '  <div style="display:flex;flex-direction:column;gap:2px;font-size:12px;">'
            + '    <div>ユーザID: <span>未検出</span></div>'
            + '    <div>パスワード: <span>未検出</span></div>'
            + '  </div>'
            + '</div>';
        }
        // 検索結果がそろってから描画（一覧 + 保存ボタン）
        const bodyHtml = '<div style="display:flex;flex-direction:column;gap:8px;width:100%;">'
          + '<div id="tsu-list" style="display:flex;flex-direction:column;gap:6px;max-height:280px;overflow:auto;">' + listHtml + '</div>'
          + '<div>'
            + '<button id="tsu-save-entry" style="background:#1a73e8;color:#fff;border:none;border-radius:6px;padding:8px 10px;cursor:pointer;width:100%;">tsupasswdに保存</button>'
            + '<div style="height:6px;"></div>'
            + '<button id="tsu-save-passkey" style="background:#34a853;color:#fff;border:none;border-radius:6px;padding:8px 10px;cursor:pointer;width:100%;">パスキーを保存</button>'
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
          saveBtn.addEventListener('click', onOpen, false);
          saveBtn.addEventListener('pointerdown', onOpen, false);
        }
        // パスキー保存ボタン→パスキー保存フォーム
        const savePasskeyBtn = box.querySelector('#tsu-save-passkey');
        if (savePasskeyBtn) {
          const onOpenPK = (ev) => {
            try { ev.preventDefault(); ev.stopPropagation(); } catch(_) {}
            // ページから自動抽出し、必要4項目が揃えば即保存。足りない場合はダイアログで補完。
            try {
              const ext = extractPasskeyFromPage((anchor && anchor.ownerDocument) || document);
              const rp = (ext.rp || '').trim();
              const cred = (ext.cred || '').trim();
              const usr = (ext.user || '').trim();
              const pub = (ext.pub || '').trim();
              const cnt = (ext.count || '').trim();
              const tr = (ext.transports || '').trim();
              if (rp && cred && usr && pub) {
                const host = (window.tsupasswd && window.tsupasswd.host) || 'dev.happyfactory.tsupasswd';
                const args = ['passkey', 'add', rp, cred, usr, pub];
                if (cnt !== '') args.push('--sign-count', String(parseInt(cnt, 10) || 0));
                if (tr !== '') args.push('--transports', tr);
                chrome.runtime.sendMessage({ type: 'RUN_TSUPASSWD', host, args }, (resp) => {
                  try {
                    if (resp && resp.ok) { dialogOpen = false; hidePopup(true); }
                    else { openPasskeyDialog(anchor); }
                  } catch(_) { openPasskeyDialog(anchor); }
                });
              } else {
                openPasskeyDialog(anchor, ext);
              }
            } catch(_) {
              openPasskeyDialog(anchor);
            }
          };
          savePasskeyBtn.addEventListener('click', onOpenPK, false);
          savePasskeyBtn.addEventListener('pointerdown', onOpenPK, false);
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
              // ユーザ名のみ許可文脈では、初回はポインタ座標が無くても許可（クリック不要で1度だけ表示）
              ok = rectOk && visOk && (ptrOk || isUsernameOnlyAllowedContext());
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
            const el = (t && t.nodeType === 1)
              ? (t.matches && t.matches('input, textarea, [role="textbox"], [contenteditable]')
                  ? t
                  : (t.closest && t.closest('input, textarea, [role="textbox"], [contenteditable]')))
              : null;
            // ポップアップ外をクリックしたら、抑止中でも必ず閉じる
            if (!inPopup && !el) { hidePopup(true); return; }
            const userLikeEl = !!(el && (isUserLike(el) || (isUsernameOnlyAllowedContext() && isTextboxLike(el))));
            const passLikeEl = !!(el && isPassLike(el));
            if (!(el && (userLikeEl || passLikeEl))) { if (!inPopup) { hidePopup(true); } return; }
            // ユーザ名欄は、同一フォームに可視パスワードが無い場合は許可ホストのみ
            if (userLikeEl && !passLikeEl) {
              const clearEmail = isClearlyEmailLike(el);
              if (!clearEmail) {
                const sameFormHasPass = hasVisiblePassInSameForm(el);
                if (!sameFormHasPass && !isUsernameOnlyAllowedContext()) { if (!inPopup) { hidePopup(true); } return; }
              }
            }
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
        const onFocusIn = (e) => {
          try {
            if (dialogOpen) return;
            if (!isUsernameOnlyAllowedContext()) return;
            const path = (e.composedPath && e.composedPath()) || [];
            const t = (path && path.length ? path[0] : e.target);
            const el = (t && t.nodeType === 1)
              ? (t.matches && t.matches('input, textarea, [role="textbox"], [contenteditable]')
                  ? t
                  : (t.closest && t.closest('input, textarea, [role="textbox"], [contenteditable]')))
              : null;
            if (!el) return;
            const userLikeEl = !!(el && (isUserLike(el) || (isUsernameOnlyAllowedContext() && isTextboxLike(el))));
            const passLikeEl = !!(el && isPassLike(el));
            if (!(el && (userLikeEl || passLikeEl))) return;
            // ここからは表示トリガ。抑止中/直後は新規表示を抑える
            try { if ((window.__tsu_suppress_until && Date.now() < window.__tsu_suppress_until) || (window.__tsu_last_hidden_at && (Date.now() - window.__tsu_last_hidden_at) < 1500)) return; } catch(_) {}
            const pref = pickPreferredAnchor(el);
            try { if (window.__tsu_current_anchor && window.__tsu_current_anchor !== pref) return; } catch(_) {}
            const b = presentAuthPopup(pref);
            attachBoxClick(b);
          } catch(_) {}
        };
        document.addEventListener('click', onClickIn, true);
        document.addEventListener('pointerdown', onClickIn, true);
        document.addEventListener('focusin', onFocusIn, true);
        // 入力開始でも表示させる（username-only 文脈の textbox-like 要素）
        const onKeyDownIn = (e) => {
          try {
            if (dialogOpen) return;
            if (!isUsernameOnlyAllowedContext()) return;
            const path = (e.composedPath && e.composedPath()) || [];
            const t = (path && path.length ? path[0] : e.target);
            const el = (t && t.nodeType === 1)
              ? (t.matches && t.matches('input, textarea, [role="textbox"], [contenteditable]')
                  ? t
                  : (t.closest && t.closest('input, textarea, [role="textbox"], [contenteditable]')))
              : null;
            if (!el) return;
            const userLikeEl = !!(el && (isUserLike(el) || (isUsernameOnlyAllowedContext() && isTextboxLike(el))));
            const passLikeEl = !!(el && isPassLike(el));
            if (!(el && (userLikeEl || passLikeEl))) return;
            try { if ((window.__tsu_suppress_until && Date.now() < window.__tsu_suppress_until) || (window.__tsu_last_hidden_at && (Date.now() - window.__tsu_last_hidden_at) < 1500)) return; } catch(_) {}
            const pref = pickPreferredAnchor(el);
            try { if (window.__tsu_current_anchor && window.__tsu_current_anchor !== pref) return; } catch(_) {}
            const b = presentAuthPopup(pref);
            attachBoxClick(b);
          } catch(_) {}
        };
        document.addEventListener('keydown', onKeyDownIn, true);
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
