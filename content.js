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

  let showToast = function(text) {
    try { console.info('[tsu] toast', String(text || '')); } catch(_) {}
  };

  // ユーザID候補の入力を優先度付きで探索
  const findUserInputCandidate = function(scope) {
    try {
      const doc = scope && scope.ownerDocument ? scope.ownerDocument : (scope.querySelectorAll ? scope : document);
      const qAll = (sel) => { try { return Array.prototype.slice.call((scope.querySelectorAll ? scope : doc).querySelectorAll(sel)); } catch(_) { return []; } };
      // 優先度: autocomplete=username > type=email > name/id に user/mail を含む > その他テキスト
      const buckets = [
        'input[autocomplete="username"]',
        'input[autocomplete="tel"]',
        'input[inputmode="tel"]',
        'input[type="tel"]',
        'input[type="email"]',
        'input[name*="user" i]',
        'input[name*="mail" i]',
        'input[name*="tel" i]',
        'input[name*="phone" i]',
        'input[id*="user" i]',
        'input[id*="mail" i]',
        'input[id*="tel" i]',
        'input[id*="phone" i]',
        'input[type="text"]'
      ];
      for (const sel of buckets) {
        const list = qAll(sel).filter((el) => { try { return isProbablyVisible(el) && isEditableInput(el); } catch(_) { return false; } });
        if (list.length) return list[0];
      }
      // 見つからない場合は null を返す
      return null;
    } catch(_) { return null; }
  };

  // --- パスキー環境での従来ポップアップ徹底無効化（最終ガード） ---
  try {
    (function(){
      // presentAuthPopup をラップし、パスキー環境では常に候補一覧のみ表示して return
      try {
        const __origPresent = presentAuthPopup;
        if (typeof __origPresent === 'function' && !presentAuthPopup.__wrappedForPasskey) {
          const wrapped = function(anchor){
            try {
              if (isPasskeyEnvOn() || isPasskeyActiveNow()) {
                try { showPasskeyCandidatePopup(anchor); } catch(_) {}
                return null;
              }
            } catch(_) {}
            return __origPresent.apply(this, arguments);
          };
          try { wrapped.__wrappedForPasskey = true; } catch(_) {}
          presentAuthPopup = wrapped;
        }
      } catch(_) {}
      // 緊急フェイルセーフ: もし従来ポップアップDOMが生成されても、パスキー環境では即時に非表示化
      try {
        const mo = new MutationObserver(() => {
          try {
            if (!(isPasskeyEnvOn() || isPasskeyActiveNow())) return;
            const box = document.getElementById('tsupasswd-inline-popup');
            if (box && box.style.display !== 'none') {
              try { box.style.display = 'none'; } catch(_) {}
              try { window.__tsu_last_hidden_at = Date.now(); } catch(_) {}
              try { window.__tsu_suppress_until = Date.now() + 3000; } catch(_) {}
              try { if (typeof dialogOpen !== 'undefined') dialogOpen = false; } catch(_) {}
            }
          } catch(_) {}
        });
        mo.observe(document.documentElement || document, { subtree: true, childList: true, attributes: true, attributeFilter: ['style','class','hidden'] });
      } catch(_) {}
      // presentAuthPopup が後から定義される場合に備え、一定時間ポーリングしてラップを適用
      try {
        if (!window.__tsu_present_wrap_polling) {
          window.__tsu_present_wrap_polling = true;
          const start = Date.now();
          const poll = () => {
            try {
              if (typeof presentAuthPopup === 'function' && !presentAuthPopup.__wrappedForPasskey) {
                const __origPresent2 = presentAuthPopup;
                const wrapped2 = function(anchor){
                  try {
                    if (isPasskeyEnvOn() || isPasskeyActiveNow()) {
                      try { showPasskeyCandidatePopup(anchor); } catch(_) {}
                      return null;
                    }
                  } catch(_) {}
                  return __origPresent2.apply(this, arguments);
                };
                try { wrapped2.__wrappedForPasskey = true; } catch(_) {}
                presentAuthPopup = wrapped2;
                return; // wrapped
              }
            } catch(_) {}
            if (Date.now() - start < 8000) { try { setTimeout(poll, 200); } catch(_) {} }
          };
          try { setTimeout(poll, 200); } catch(_) { poll(); }
        }
      } catch(_) {}
    })();
  } catch(_) {}

  // 直近ユーザ操作の有無
  function hasRecentUserGesture(maxMs) {
    try {
      const now = Date.now();
      const last = Number(window.__tsu_last_user_interact || 0);
      const span = Number(maxMs || 1200);
      return !!(last && (now - last) <= span);
    } catch(_) { return false; }
  }

  // 直近にパスキーが発火したか（数秒間だけ true）。有効化検出ではなく「実際の発火」を重視して従来ポップアップを抑止する
  function isPasskeyActiveNow() {
    try {
      const now = Date.now();
      const last = Number(window.__tsu_pk_last_ts || 0);
      const span = Number(window.__tsu_pk_recent_ms || 4000); // 抑止ウィンドウ（ms）
      return !!(last && (now - last) < span);
    } catch(_) { return false; }
  }

  // パスキー環境が有効（同期判定）か
  function isPasskeyEnvOn() {
    try {
      // 明示的な無効化フラグを優先
      try {
        const cfg = (window && window.tsupasswd) ? window.tsupasswd : null;
        if (cfg && (cfg.disablePasskey === true || cfg.passkeyEnabled === false)) return false;
      } catch(_) {}
      // PublicKeyCredential が存在しない環境は非対応（無効）
      if (typeof window.PublicKeyCredential !== 'function') return false;
      if (window.__tsu_passkey_capable === true) return true;
      if (window.__tsu_passkey_active === true) return true;
      try {
        const c = window.__tsu_pk_cache || {};
        if (c && (c.rpId || c.credentialIdB64)) return true;
      } catch(_) {}
      return false;
    } catch(_) { return false; }
  }

  // 抑止時間のデフォルト設定と、表示再開のためのリセットポイント
  try { if (typeof window.__tsu_pk_recent_ms !== 'number') window.__tsu_pk_recent_ms = 4000; } catch(_) {}
  try { window.addEventListener('pageshow', () => { try { window.__tsu_pk_last_ts = 0; } catch(_) {} }, true); } catch(_) {}
  try {
    document.addEventListener('visibilitychange', () => {
      try { if (!document.hidden) setTimeout(() => { try { window.__tsu_pk_last_ts = 0; } catch(_) {} }, 300); } catch(_) {}
    }, true);
  } catch(_) {}

  // 初期ロード自動表示は行わない（チラつき防止）
  // 公開: window と tsupasswd 名前空間に参照をセット
  try { window.savePasskeySilentlyRef = savePasskeySilently; } catch(_) {}
  try {
    window.tsupasswd = window.tsupasswd || {};
    window.tsupasswd.savePasskeySilently = savePasskeySilently;
    // デバッグ用: 判定ヘルパーも公開
    window.tsupasswd.isPasskeyEnvOn = isPasskeyEnvOn;
    window.tsupasswd.isPasskeyActiveNow = isPasskeyActiveNow;
  } catch(_) {}

  // パスキー登録ボタンのフック（クリック後に認証情報を保存）
  function tsuPasskeyBrandName() {
    try { return 'auto I/O tsupasswd'; } catch(_) { return 'tsupasswd'; }
  }
  function tsuShowPasskeySaveGuidance(state, errText) {
    try {
      const h = (location && location.hostname) ? String(location.hostname).toLowerCase() : '';
      if (!/(^|\.)passkey\.io$/i.test(h)) return;
      const brand = tsuPasskeyBrandName();
      const id = 'tsu-passkey-save-guidance';
      let el = document.getElementById(id);
      if (!el) {
        el = document.createElement('div');
        el.id = id;
        el.style.position = 'fixed';
        el.style.top = '12px';
        el.style.left = '50%';
        el.style.transform = 'translateX(-50%)';
        el.style.zIndex = '2147483647';
        el.style.maxWidth = 'min(680px, calc(100vw - 24px))';
        el.style.padding = '10px 12px';
        el.style.borderRadius = '10px';
        el.style.fontSize = '13px';
        el.style.lineHeight = '1.35';
        el.style.boxShadow = '0 10px 30px rgba(0,0,0,0.18)';
        el.style.border = '1px solid rgba(0,0,0,0.12)';
        el.style.background = 'rgba(255,255,255,0.96)';
        el.style.color = '#111';
        el.style.backdropFilter = 'blur(6px)';
        el.style.display = 'none';
        document.body.appendChild(el);
      }

      const setStyle = (kind) => {
        try {
          if (kind === 'saved') {
            el.style.border = '1px solid rgba(0,128,0,0.25)';
          } else if (kind === 'failed') {
            el.style.border = '1px solid rgba(160,0,0,0.25)';
          } else {
            el.style.border = '1px solid rgba(0,0,0,0.12)';
          }
        } catch(_) {}
      };

      let msg = '';
      if (state === 'saved') {
        msg = brand + ' にパスキーを保存しました。保存先リストに ' + brand + ' は表示されません。';
      } else if (state === 'failed') {
        const e = errText ? String(errText).slice(0, 160) : '';
        msg = e ? (brand + ' への保存に失敗しました: ' + e + '（保存先リストに ' + brand + ' は表示されません）') : (brand + ' への保存に失敗しました。保存先リストに ' + brand + ' は表示されません。');
      } else {
        msg = '保存先リストに ' + brand + ' は表示できませんが、この拡張が自動で ' + brand + ' にパスキーを保存します。';
      }
      try { setStyle(state); } catch(_) {}
      try { el.textContent = msg; } catch(_) {}
      try { el.style.display = 'block'; } catch(_) {}

      try {
        const prev = Number(el.__tsu_hide_timer || 0);
        if (prev) clearTimeout(prev);
      } catch(_) {}
      try {
        const ms = (state === 'failed') ? 9000 : (state === 'saved' ? 4500 : 6500);
        el.__tsu_hide_timer = setTimeout(() => { try { el.style.display = 'none'; } catch(_) {} }, ms);
      } catch(_) {}
    } catch(_) {}
  }

  function bindPasskeyRegisterButtons() {
    try {
      if (window.__tsu_reg_btn_bound) return;
      window.__tsu_reg_btn_bound = true;
      const doc = document;
      const sel = 'button, input[type="button"], input[type="submit"], [role="button"]';
      const nodes = Array.prototype.slice.call(doc.querySelectorAll(sel));
      const isReg = (el) => {
        try {
          const text = ((el.innerText || el.textContent || '') + ' ' + (el.value || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.name || '') + ' ' + (el.id || '')).toLowerCase();
          return /\b(register|signup|sign\s*up|create|作成|登録|passkey|パスキー)\b/i.test(text);
        } catch(_) { return false; }
      };
      nodes.filter(isReg).forEach((el) => {
        try {
          const markActivity = () => { try { window.__tsu_external_webauthn_at = Date.now(); } catch(_) {} };
          el.addEventListener('pointerdown', markActivity, true);
          el.addEventListener('click', (ev) => {
            try {
              markActivity();
              const anchor = document.activeElement || el;
              try {
                const h = (location && location.hostname) ? String(location.hostname).toLowerCase() : '';
                if (/(^|\.)passkey\.io$/i.test(h)) {
                  const brand = tsuPasskeyBrandName();
                  try { window.__tsu_pk_save_intent_ts = Date.now(); } catch(_) {}
                  try { showToast(brand + ' に保存します…'); } catch(_) {}
                  try { tsuShowPasskeySaveGuidance('intent'); } catch(_) {}
                }
              } catch(_) {}
              // ページ側フックからの tsu:passkeyCaptured を待ってサイレント保存
              try {
                const waitMs = 20000;
                if (window.tsupasswd && typeof window.tsupasswd.waitPasskey === 'function') {
                  window.tsupasswd.waitPasskey(waitMs)
                    .then(() => { /* autosave via bridge; do not call directly */ })
                    .catch(() => { try { if (!(isPasskeyEnvOn() || isPasskeyActiveNow())) { openPasskeyDialog(anchor, extractPasskeyFromPage(document)); } } catch(_) {} });
                } else {
                  // フック未準備時はフォールバック
                  setTimeout(() => { try { if (!(isPasskeyEnvOn() || isPasskeyActiveNow())) { openPasskeyDialog(anchor, extractPasskeyFromPage(document)); } } catch(_) {} }, 800);
                }
              } catch(_) {}
            } catch(_) {}
          }, true);
        } catch(_) {}
      });
    } catch(_) {}
  }
  // サイレント保存（ネイティブ tsupasswd passkey add）
  function savePasskeySilently(anchor, providedDetail) {
    try {
      try { console.info('[tsu] passkey save enter'); } catch(_) {}
      try { window.__tsu_last_save_enter = Date.now(); } catch(_) {}
      const raw = (providedDetail && typeof providedDetail === 'object') ? providedDetail : (extractPasskeyFromPage(document) || {});
      // bridge/page hook 由来のキー名ゆれを正規化
      try {
        if (raw && typeof raw === 'object') {
          if (!raw.cred && raw.credentialIdB64) raw.cred = raw.credentialIdB64;
          if (!raw.user && raw.userHandleB64) raw.user = raw.userHandleB64;
          if (!raw.pub && raw.publicKeyB64) raw.pub = raw.publicKeyB64;
          if (!raw.att && raw.attestationB64) raw.att = raw.attestationB64;
        }
      } catch(_) {}
      // 多重保存防止（同一 credentialId を一定時間内に二重保存しない）
      try {
        const keyNow = String((raw && (raw.cred || raw.credentialIdB64)) || '');
        if (keyNow) {
          window.__tsu_saved_cred = window.__tsu_saved_cred || {};
          const last = Number(window.__tsu_saved_cred[keyNow] || 0);
          const now = Date.now();
          if (last && (now - last) < 5000) {
            try { console.info('[tsu] passkey save dedup skip (recent)'); } catch(_) {}
            return;
          }
        }
      } catch(_) {}
      const rpId = raw.rp || (location && location.hostname) || '';
      let title = '';
      try {
        const pick = () => {
          try {
            // 入力欄の値を最優先
            try {
              const ax = (window.__tsu_current_anchor && window.__tsu_current_anchor.value && String(window.__tsu_current_anchor.value).trim()) || '';
              if (ax) return ax;
            } catch(_) {}
          } catch(_) {}
          try {
            const ae = document && document.activeElement;
            if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) {
              const v = String(ae.value || '').trim();
              if (v) return v;
              // placeholder fallback
              try { const ph = String(ae.getAttribute && ae.getAttribute('placeholder') || '').trim(); if (ph) return ph; } catch(_) {}
              // label fallback
              try {
                const id = ae.id && String(ae.id);
                if (id) {
                  const lb = document.querySelector(`label[for="${CSS.escape(id)}"]`);
                  const txt = lb && (lb.textContent||'').trim();
                  if (txt) return txt;
                }
              } catch(_) {}
            }
          } catch(_) {}
          try {
            const cand = findUserInputCandidate(document);
            if (cand && cand.element && typeof cand.element.value === 'string') {
              const v = String(cand.element.value).trim();
              if (v) return v;
              // placeholder/label fallback for candidate
              try { const ph = String(cand.element.getAttribute && cand.element.getAttribute('placeholder') || '').trim(); if (ph) return ph; } catch(_) {}
              try {
                const id = cand.element.id && String(cand.element.id);
                if (id) {
                  const lb = document.querySelector(`label[for="${CSS.escape(id)}"]`);
                  const txt = lb && (lb.textContent||'').trim();
                  if (txt) return txt;
                }
              } catch(_) {}
            }
          } catch(_) {}
          // Manual override from extension/page config
          try {
            const ov = (window.tsupasswd && typeof window.tsupasswd.titleOverride === 'string') ? String(window.tsupasswd.titleOverride).trim() : '';
            if (ov) return ov;
          } catch(_) {}
          // Prefer injected page cache title if available
          try {
            const tcache = (window.__tsu_pk_cache && window.__tsu_pk_cache.title) ? String(window.__tsu_pk_cache.title).trim() : '';
            if (tcache) return tcache;
          } catch(_) {}
          // Or prefer userTitleCandidate from options.user if present and safe
          try {
            const cand = (window.__tsu_pk_cache && window.__tsu_pk_cache.userTitleCandidate) ? String(window.__tsu_pk_cache.userTitleCandidate).trim() : '';
            if (cand) {
              const host = (location && location.hostname) ? String(location.hostname).toLowerCase() : '';
              const isDomainLike = (s) => { try { return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(String(s||'').trim()); } catch(_) { return false; } };
              if (cand.toLowerCase() !== host && !isDomainLike(cand)) return cand;
            }
          } catch(_) {}
          try {
            const sels = [
              'input[autocomplete="username"]',
              'input[autocomplete="email"]',
              'input[autocomplete="tel"]',
              'input[inputmode="tel"]',
              'input[type="email"]',
              'input[type="tel"]',
              'input[name*="email" i]',
              'input[id*="email" i]',
              'input[name*="user" i]',
              'input[name*="mail" i]',
              'input[name*="tel" i]',
              'input[name*="phone" i]',
              'input[id*="user" i]',
              'input[id*="mail" i]',
              'input[id*="tel" i]',
              'input[id*="phone" i]',
              'input[type="text"]'
            ];
            for (const sel of sels) {
              const el = document && document.querySelector && document.querySelector(sel);
              if (el && typeof el.value === 'string') {
                const v = String(el.value || '').trim();
                if (v) return v;
                try { const ph = String(el.getAttribute && el.getAttribute('placeholder') || '').trim(); if (ph) return ph; } catch(_) {}
                try {
                  const id = el.id && String(el.id);
                  if (id) {
                    const lb = document.querySelector(`label[for="${CSS.escape(id)}"]`);
                    const txt = lb && (lb.textContent||'').trim();
                    if (txt) return txt;
                  }
                } catch(_) {}
              }
            }
          } catch(_) {}
          // フォールバック: 画面上の入力から email らしい値を優先抽出
          try {
            const isProbablyVisible = (el) => {
              try {
                const r = el.getBoundingClientRect();
                const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
                return !!(r && r.width > 0 && r.height > 0 && (!style || (style.visibility !== 'hidden' && style.display !== 'none')));
              } catch(_) { return true; }
            };
            const nodes = Array.prototype.slice.call(document.querySelectorAll('input, textarea'));
            const vals = nodes
              .filter(el => el && typeof el.value === 'string' && isProbablyVisible(el))
              .map(el => String(el.value || '').trim())
              .filter(Boolean);
            const looksEmail = (s) => { try { return /.+@.+\..+/.test(s); } catch(_) { return false; } };
            const looksPhone = (s) => { try { return /^[+]?[-0-9()\s]{8,}$/.test(s.replace(/[\u3000\s]+/g,' ')); } catch(_) { return false; } };
            // amazon.co.jp では phone を優先、それ以外は email を優先
            const host = (location && location.hostname) ? String(location.hostname) : '';
            if (/amazon\.co\.jp$/i.test(host)) {
              const phoneVal = vals.find(looksPhone);
              if (phoneVal) return phoneVal;
              const emailVal = vals.find(looksEmail);
              if (emailVal) return emailVal;
            } else {
              const emailVal = vals.find(looksEmail);
              if (emailVal) return emailVal;
              const phoneVal = vals.find(looksPhone);
              if (phoneVal) return phoneVal;
            }
            // それでも無ければ最初の非空テキストを返す
            if (vals.length) return vals[0];
          } catch(_) {}
          return '';
        };
        title = pick();
        // sanitize: avoid using plain host/domain as title
        try {
          const host = (location && location.hostname) ? String(location.hostname).toLowerCase() : '';
          const isDomainLike = (s) => { try { return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(String(s||'').trim()); } catch(_) { return false; } };
          if (title && (String(title).toLowerCase() === host || (isDomainLike(title) && String(title).toLowerCase() === host))) {
            title = '';
          }
        } catch(_) {}
      } catch(_) {}
      if (!title) { title = String(raw.title || ''); }
      try { console.info('[tsu] passkey title decide', { fromInput: !!(title && title.length), title }); } catch(_) {}

      try {
        const looksEmail = (s) => { try { return /.+@.+\..+/.test(String(s || '').trim()); } catch(_) { return false; } };
        const email = (function(){
          try {
            const cand = (window.__tsu_pk_cache && window.__tsu_pk_cache.userTitleCandidate) ? String(window.__tsu_pk_cache.userTitleCandidate).trim() : '';
            if (looksEmail(cand)) return cand;
          } catch(_) {}
          try {
            const ae = document && document.activeElement;
            if (ae && typeof ae.value === 'string') {
              const v = String(ae.value || '').trim();
              if (looksEmail(v)) return v;
            }
          } catch(_) {}
          try {
            const nodes = Array.prototype.slice.call(document.querySelectorAll('input, textarea'));
            for (const el of nodes) {
              try {
                if (!el || typeof el.value !== 'string') continue;
                const v = String(el.value || '').trim();
                if (looksEmail(v)) return v;
              } catch(_) {}
            }
          } catch(_) {}
          return '';
        })();

        if (email) {
          const siteLabel = (function(){
            try {
              const tcache = (window.__tsu_pk_cache && window.__tsu_pk_cache.title) ? String(window.__tsu_pk_cache.title).trim() : '';
              if (tcache) return tcache;
            } catch(_) {}
            try { if (document && document.title) { const t = String(document.title).trim(); if (t) return t; } } catch(_) {}
            try { if (rpId) return String(rpId); } catch(_) {}
            return '';
          })();

          const emailL = String(email).toLowerCase();
          const titleL = String(title || '').toLowerCase();
          if (!titleL.includes(emailL)) {
            if (siteLabel && String(siteLabel).toLowerCase() !== emailL) {
              title = `${siteLabel} - ${email}`;
            } else {
              title = String(email);
            }
          } else {
            if (siteLabel && String(title || '').trim() === String(email).trim() && String(siteLabel).toLowerCase() !== emailL) {
              title = `${siteLabel} - ${email}`;
            }
          }
          try {
            const maxLen = 160;
            if (title && String(title).length > maxLen) title = String(title).slice(0, maxLen);
          } catch(_) {}
        }
      } catch(_) {}

      // If title still empty after sanitization, fallback to userTitleCandidate/doc title/rpId to ensure saving proceeds
      if (!title) {
        try {
          const cand = (window.__tsu_pk_cache && window.__tsu_pk_cache.userTitleCandidate) ? String(window.__tsu_pk_cache.userTitleCandidate).trim() : '';
          if (cand) title = cand;
        } catch(_) {}
        if (!title) { try { if (document && document.title) title = String(document.title); } catch(_) {}
        }
        if (!title) { title = String(raw.rp || rpId || ''); }
      }
      const detail = (function(){
        const cntStr = raw.count != null ? String(raw.count) : '';
        const cntNum = (cntStr && !isNaN(Number(cntStr))) ? Number(cntStr) : undefined;
        return {
          rp: String(raw.rp || rpId || ''),
          cred: String(raw.cred || ''),
          user: String(raw.user || ''),
          pub: String(raw.pub || ''),
          count: String(cntStr || ''),
          transports: String(raw.transports || ''),
          title: String(title || raw.title || ''),
          rpId: String(raw.rp || rpId || ''),
          credentialIdB64: String(raw.cred || ''),
          userHandleB64: String(raw.user || raw.userHandleB64 || (window.__tsu_pk_cache && window.__tsu_pk_cache.userHandleB64) || ''),
          publicKeyB64: String(raw.pub || ''),
          signCount: cntNum,
        };
      })();
      // デバッグ: 抽出状況をロギング
      try { console.info('[tsu] passkey extracted', { rpId, hasCred: !!detail.credentialIdB64, hasUser: !!detail.userHandleB64, hasPub: !!detail.publicKeyB64, signCount: detail.signCount }); } catch(_) {}
      // 必須チェック（credential と publicKey の両方を必須に変更）
      const hasCred = !!detail.credentialIdB64;
      const hasPub = !!detail.publicKeyB64;
      if (!hasCred || !hasPub) {
        try { console.info('[tsu] passkey save precheck: missing field(s)', { hasCred, hasPub }); } catch(_) {}
        // Fallback: if attestation is available, delegate to native host (SAVE_TSUPASSWD) to derive publicKey from attestationObject
        try {
          const attB64 = String((raw && (raw.att || raw.attestationB64)) || (window.__tsu_pk_cache && window.__tsu_pk_cache.attestationB64) || '') || '';
          if (hasCred && !hasPub && attB64) {
            const host = (window.tsupasswd && window.tsupasswd.host) || 'dev.happyfactory.tsupasswd';
            const entry = {
              title: String(detail.title || ''),
              url: '',
              username: '',
              password: '',
              note: '',
              credential: {
                rawId: String(detail.credentialIdB64 || ''),
                response: { attestationObject: String(attB64) },
                // transport list if available (comma separated -> array)
                transports: (function(){ try { return detail.transports ? String(detail.transports).split(',').filter(Boolean) : undefined; } catch(_) { return undefined; } })()
              },
              meta: {
                rpId: String(rpId || ''),
                userHandle: String(detail.userHandleB64 || (window.__tsu_pk_cache && window.__tsu_pk_cache.userHandleB64) || ''),
                origin: (function(){ try { return (location && location.origin) ? String(location.origin) : ''; } catch(_) { return ''; } })()
              }
            };
            try { console.info('[tsu] passkey save fallback via host(SAVE)', { hasAtt: true }); } catch(_) {}

            const doSaveViaHost = () => {
              try {
                safeSendMessage({ type: 'SAVE_TSUPASSWD', host, entry }, (resp) => {
                  try {
                    const ok = !!(resp && (resp.ok === true || (resp.data && resp.data.ok === true)));
                    if (ok) {
                      try {
                        const brand = tsuPasskeyBrandName();
                        const h = (location && location.hostname) ? String(location.hostname).toLowerCase() : '';
                        showToast((/(^|\.)passkey\.io$/i.test(h)) ? (brand + ' にパスキーを保存しました') : '保存しました');
                      } catch(_) { try { showToast('保存しました'); } catch(__) {} }
                      try { tsuShowPasskeySaveGuidance('saved'); } catch(_) {}
                      try {
                        window.__tsu_pk_recent_entries = window.__tsu_pk_recent_entries || [];
                        window.__tsu_pk_recent_entries.unshift({ title: entry.title || '', rp: entry.meta.rpId || '', cred: detail.credentialIdB64 || '' });
                        if (window.__tsu_pk_recent_entries.length > 30) window.__tsu_pk_recent_entries.length = 30;
                      } catch(_) {}
                    } else {
                      try {
                        const err = (resp && (resp.error || (resp.data && resp.data.error))) || '';
                        try {
                          const h = (location && location.hostname) ? String(location.hostname).toLowerCase() : '';
                          if (/(^|\.)passkey\.io$/i.test(h)) {
                            const brand = tsuPasskeyBrandName();
                            showToast(err ? (brand + ' への保存に失敗しました: ' + String(err).slice(0, 160)) : (brand + ' への保存に失敗しました'));
                          } else {
                            showToast(err ? ('保存に失敗しました: ' + String(err).slice(0, 160)) : '保存に失敗しました');
                          }
                        } catch(_) {
                          showToast(err ? ('保存に失敗しました: ' + String(err).slice(0, 160)) : '保存に失敗しました');
                        }
                        try { tsuShowPasskeySaveGuidance('failed', err); } catch(_) {}
                      } catch(_) { try { showToast('保存に失敗しました'); } catch(__) {} }
                    }
                  } catch(_) {}
                });
              } catch(_) {}
            };

            const readEntries = (v) => {
              try {
                if (!v) return [];
                if (typeof v === 'string') { try { const d = JSON.parse(v); return Array.isArray(d) ? d : (d && d.entries) || []; } catch(_) { return []; } }
                if (v.stdout && typeof v.stdout === 'string') { try { const d = JSON.parse(v.stdout); return Array.isArray(d) ? d : (d && d.entries) || []; } catch(_) { return []; } }
                if (v.data && typeof v.data === 'string') { try { const d = JSON.parse(v.data); return Array.isArray(d) ? d : (d && d.entries) || []; } catch(_) { return []; } }
                if (Array.isArray(v.entries)) return v.entries;
                if (Array.isArray(v)) return v;
                return [];
              } catch(_) { return []; }
            };

            const deleteIds = (ids, cb) => {
              try {
                const list = Array.isArray(ids) ? ids.slice() : [];
                const step = () => {
                  try {
                    const id = String(list.shift() || '');
                    if (!id) { try { cb && cb(); } catch(_) {} return; }
                    sendWithPreflight({ type: 'RUN_TSUPASSWD', host, args: ['passkey', 'delete', id] }, () => {
                      try { step(); } catch(_) { try { cb && cb(); } catch(__) {} }
                    });
                  } catch(_) { try { cb && cb(); } catch(__) {} }
                };
                step();
              } catch(_) { try { cb && cb(); } catch(__) {} }
            };

            const baseTitle = String(entry.title || '').trim();
            if (!baseTitle) { doSaveViaHost(); return; }
            const norm = (s) => { try { return String(s || '').trim().toLowerCase(); } catch(_) { return ''; } };
            const want = norm(baseTitle);
            sendWithPreflight({ type: 'RUN_TSUPASSWD', host, args: ['passkey', 'search', String(rpId || ''), '--json'] }, (respS) => {
              try {
                const entries = readEntries(respS && (respS.data || respS));
                const ids = (Array.isArray(entries) ? entries : [])
                  .filter(e => e && typeof e === 'object' && want && (norm(e.title || e.name || '') === want))
                  .map(e => String((e && e.id) || '').trim())
                  .filter(Boolean);
                if (ids.length) {
                  deleteIds(ids, () => { try { doSaveViaHost(); } catch(_) {} });
                } else {
                  doSaveViaHost();
                }
              } catch(_) { doSaveViaHost(); }
            });
            return;
          }
        } catch(_) {}
        try { console.info('[tsu] passkey save skip: insufficient data and no attestation fallback'); } catch(_) {}
        try { if (!(isPasskeyEnvOn() || isPasskeyActiveNow())) { openPasskeyDialog(anchor, raw); } } catch(_) {}
        return;
      }
      const payload = { rpId: String(rpId || ''), title: String(title || ''), detail };
      const host = (window.tsupasswd && window.tsupasswd.host) || 'dev.happyfactory.tsupasswd';
      try { console.info('[tsu] passkey save begin', { rpId: payload.rpId, hasCred: !!detail.credentialIdB64 }); } catch(_) {}
      try { window.__tsu_last_save_started = Date.now(); } catch(_) {}

      const deleteIds = (ids, cb) => {
        try {
          const list = Array.isArray(ids) ? ids.slice() : [];
          const step = () => {
            try {
              const id = String(list.shift() || '');
              if (!id) { try { cb && cb(); } catch(_) {} return; }
              sendWithPreflight({ type: 'RUN_TSUPASSWD', host, args: ['passkey', 'delete', id] }, () => {
                try { step(); } catch(_) { try { cb && cb(); } catch(__) {} }
              });
            } catch(_) { try { cb && cb(); } catch(__) {} }
          };
          step();
        } catch(_) { try { cb && cb(); } catch(__) {} }
      };

      // 一意タイトル生成
      const uniqueTitle = (base, exists) => {
        try {
          const used = new Set((exists || []).map(s => String(s || '').trim()));
          let t = String(base || '').trim();
          if (!t) return '';
          if (!used.has(t)) return t;
          let i = 2;
          while (i < 1000) {
            const cand = `${t} (${i})`;
            if (!used.has(cand)) return cand;
            i++;
          }
          return `${t} (${Date.now()})`;
        } catch(_) { return String(base || ''); }
      };

      const doSave = (finalTitle) => {
        // 位置引数で渡す: rp_id, credential_id, user_handle, public_key
        const args1 = ['passkey', 'add', payload.rpId, detail.credentialIdB64, detail.userHandleB64 || '', detail.publicKeyB64 || ''];
        // 任意オプション
        if (typeof detail.signCount === 'number') { args1.push('--sign-count', String(detail.signCount)); }
        if (detail.transports) { args1.push('--transports', String(detail.transports)); }
        if (finalTitle) {
          const t = String(finalTitle);
          args1.push('--title', t);
        }
        try { console.info('[tsu] passkey save args', { title: String(finalTitle||''), args: args1 }); } catch(_) {}
        sendWithPreflight({ type: 'RUN_TSUPASSWD', host, args: args1 }, (resp) => {
          try { console.info('[tsu] passkey save end', resp); } catch(_) {}
          try { window.__tsu_last_save_ended = Date.now(); } catch(_) {}
          try {
            const ok = !!(resp && (
              resp.ok === true ||
              resp.status === 'ok' ||
              (resp.data && (resp.data.ok === true || resp.data.status === 'ok'))
            ));
            if (ok) {
              try {
                const brand = tsuPasskeyBrandName();
                const h = (location && location.hostname) ? String(location.hostname).toLowerCase() : '';
                showToast((/(^|\.)passkey\.io$/i.test(h)) ? (brand + ' にパスキーを保存しました') : '保存しました');
              } catch(_) { try { showToast('保存しました'); } catch(__) {} }
              try { tsuShowPasskeySaveGuidance('saved'); } catch(_) {}
              // 直近の候補に加える（ポップアップ即時反映用）
              try {
                window.__tsu_pk_recent_entries = window.__tsu_pk_recent_entries || [];
                window.__tsu_pk_recent_entries.unshift({ title: detail.title || '', rp: detail.rpId || detail.rp || '', cred: detail.credentialIdB64 || '' });
                if (window.__tsu_pk_recent_entries.length > 30) window.__tsu_pk_recent_entries.length = 30;
              } catch(_) {}
            }
            else {
              try {
                const err = (resp && (resp.error || (resp.data && resp.data.error))) || '';
                try {
                  const h = (location && location.hostname) ? String(location.hostname).toLowerCase() : '';
                  if (/(^|\.)passkey\.io$/i.test(h)) {
                    const brand = tsuPasskeyBrandName();
                    showToast(err ? (brand + ' への保存に失敗しました: ' + String(err).slice(0, 160)) : (brand + ' への保存に失敗しました'));
                  } else {
                    showToast(err ? ('保存に失敗しました: ' + String(err).slice(0, 160)) : '保存に失敗しました');
                  }
                } catch(_) {
                  showToast(err ? ('保存に失敗しました: ' + String(err).slice(0, 160)) : '保存に失敗しました');
                }
                try { tsuShowPasskeySaveGuidance('failed', err); } catch(_) {}
              } catch(_) { try { showToast('保存に失敗しました'); } catch(__) {} }
            }
          } catch(_) {}
        });
      };

      // 既存タイトルを検索して重複回避（失敗時はそのまま保存）
      const parseEntriesForUpdate = (raw) => {
        try {
          const read = (v) => {
            if (!v) return [];
            if (typeof v === 'string') { try { const d = JSON.parse(v); return Array.isArray(d) ? d : (d && d.entries) || []; } catch(_) { return []; } }
            if (v.stdout && typeof v.stdout === 'string') { try { const d = JSON.parse(v.stdout); return Array.isArray(d) ? d : (d && d.entries) || []; } catch(_) { return []; } }
            if (v.data && typeof v.data === 'string') { try { const d = JSON.parse(v.data); return Array.isArray(d) ? d : (d && d.entries) || []; } catch(_) { return []; } }
            if (Array.isArray(v.entries)) return v.entries;
            if (Array.isArray(v)) return v;
            return [];
          };
          const arr = read(raw && (raw.data || raw));
          return (Array.isArray(arr) ? arr : []).filter(e => e && typeof e === 'object');
        } catch(_) { return []; }
      };

      try {
        sendWithPreflight({ type: 'RUN_TSUPASSWD', host, args: ['passkey', 'search', payload.rpId, '--json'] }, (resp) => {
          try {
            const entries = parseEntriesForUpdate(resp);
            const baseTitle = (payload.title || payload.rpId || '');
            const norm = (s) => { try { return String(s || '').trim().toLowerCase(); } catch(_) { return ''; } };
            const want = norm(baseTitle);
            const ids = entries
              .filter(e => want && (norm(e.title || e.name || '') === want))
              .map(e => String((e && e.id) || '').trim())
              .filter(Boolean);
            if (ids.length) {
              deleteIds(ids, () => { try { doSave(baseTitle); } catch(_) {} });
            } else {
              doSave(baseTitle);
            }
          } catch(_) { doSave(payload.title); }
        });
      } catch(_) {
        doSave(payload.title);
      }
    } catch(e) { try { console.info('[tsu] passkey save error', String(e && e.message || e)); } catch(_) {} }
  }

  try { window.savePasskeySilentlyRef = savePasskeySilently; } catch(_) {}
  try { window.tsupasswd = window.tsupasswd || {}; window.tsupasswd.savePasskeySilently = savePasskeySilently; } catch(_) {}

  // 送信前に拡張の生存確認（PING）が通ったら本送信
  const sendWithPreflight = function(payload, cb) {
    try {
      const maxAttempts = 5;
      const tryPing = (attempt) => {
        safeSendMessage({ type: 'PING' }, (pong) => {
          if (pong && pong.ok) {
            return safeSendMessage(payload, cb);
          }
          if (attempt < maxAttempts) {
            const delay = Math.min(200 * Math.pow(2, attempt), 2000);
            try { console.info('[tsu] preflight PING failed: retry', { attempt, delay }); } catch(_) {}
            return setTimeout(() => tryPing(attempt + 1), delay);
          }
          // 最後の手段: PINGが通らなくても本送信を試みる
          try { console.info('[tsu] preflight PING giveup: try payload anyway'); } catch(_) {}
          safeSendMessage(payload, (resp) => {
            if (!(resp && resp.ok)) {
              try { showToast('拡張が応答しません。ページを再読み込みしてください'); } catch(_) {}
            }
            try { cb && cb(resp); } catch(_) {}
          });
        });
      };
      tryPing(0);
    } catch (_) {
      try { showToast('拡張が応答しません。ページを再読み込みしてください'); } catch(_) {}
      try { console.info('[tsu] preflight exception'); } catch(_) {}
      return cb && cb({ ok: false, error: 'ping_failed' });
    }
  };

  try { window.tsupasswd = window.tsupasswd || {}; if (window.tsupasswd.disableAutoPasskeyPopup == null) window.tsupasswd.disableAutoPasskeyPopup = false; } catch(_) {}
  try {
    window.tsupasswd.waitPasskey = function(timeoutMs) {
      return new Promise(function(resolve, reject) {
        var timer = null;
        var cleanup = function() {
          try { window.removeEventListener('tsu:passkeyCaptured', on); } catch(_) {}
          if (timer) { try { clearTimeout(timer); } catch(_) {} timer = null; }
        };
        var on = function(e) { cleanup(); resolve(e && e.detail); };
        try { window.addEventListener('tsu:passkeyCaptured', on, { once: true }); } catch(_) { try { window.addEventListener('tsu:passkeyCaptured', on); } catch(_) {} }
        if (typeof timeoutMs === 'number' && timeoutMs > 0) {
          try { timer = setTimeout(function(){ cleanup(); reject(new Error('timeout')); }, timeoutMs); } catch(_) {}
        }
      });
    };
  } catch(_) {}

  try {
    if (!window.__tsu_pk_event_bound) {
      window.addEventListener('tsu:passkeyCaptured', function(ev){
        try {
          const d = ev && ev.detail ? ev.detail : extractPasskeyFromPage(document);
          const key = String((d && (d.credentialIdB64 || d.cred)) || '');
          // ここでは保存は実行しない（bridge 側 autosave に委譲）。
          // また、dedup 用の保存済みマーク(__tsu_saved_cred)は付けない（保存がスキップされてしまうため）。
          // 多重イベント観測用の seen マークのみ付ける。
          try {
            window.__tsu_seen_cred = window.__tsu_seen_cred || {};
            if (key && !window.__tsu_seen_cred[key]) {
              window.__tsu_seen_cred[key] = Date.now();
            }
          } catch(_) {}
          // フォールバック: ブリッジが受信できなかった場合でも、登録(create)直後で十分な情報がそろっているなら自動保存を試みる
          try {
            const det = d || extractPasskeyFromPage(document) || {};
            const hasCred = !!(det.credentialIdB64 || det.cred);
            const hasPub = !!(det.publicKeyB64 || det.pub);
            if (false && hasCred && hasPub) {
              const f = (window.savePasskeySilentlyRef || (window.tsupasswd && window.tsupasswd.savePasskeySilently) || (typeof savePasskeySilently === 'function' && savePasskeySilently));
              if (typeof f === 'function') {
                // 二重保存防止: 直近開始から短時間は再起動しない
                const now = Date.now();
                const started = Number(window.__tsu_last_save_started || 0);
                if (!started || (now - started) > 1500) {
                  setTimeout(() => { try { f(null, det); } catch(_) {} }, 120);
                }
              }
            }
          } catch(_) {}
        } catch(_) {}
      }, false);
      window.__tsu_pk_event_bound = true;
    }
  } catch(_) {}

  // ページコンテキストへ WebAuthn フックを注入（isolated world を回避）
  (function injectPageHookOnce(){
    try {
      if (window.__tsu_page_injected) return;

      const requestMainHook = (reason) => {
        try {
          if (window.__tsu_main_hook_requested) return;
          window.__tsu_main_hook_requested = true;
        } catch(_) {}
        try {
          if (!(chrome && chrome.runtime && chrome.runtime.sendMessage)) return;
          chrome.runtime.sendMessage({ type: 'TSU_INJECT_MAIN', reason: String(reason || '') }, () => {
            try {
              if (chrome.runtime && chrome.runtime.lastError) {
                console.info('[tsu] main hook inject failed:', chrome.runtime.lastError.message);
              } else {
                console.info('[tsu] main hook inject requested');
              }
            } catch(_) {}
          });
        } catch(_) {}
      };

      // passkey.io 等の強CSPサイトでは先にMAIN world注入を試す（重複はフラグで抑止）
      try {
        const h = (location && location.hostname) ? String(location.hostname).toLowerCase() : '';
        if (h === 'passkey.io' || h.endsWith('.passkey.io')) {
          requestMainHook('domain:passkey.io');
        }
      } catch(_) {}

      const s = document.createElement('script');
      s.type = 'text/javascript';
      let url = '';
      try { url = chrome.runtime.getURL('injected/tsu-webauthn-hook.js'); } catch(_) {}
      if (url) s.src = url;
      s.onload = function(){
        try { window.__tsu_page_injected = true; } catch(_) {}
        try { console.info('[tsu] page hook injected'); } catch(_) {}
        try { s.remove(); } catch(_) {}
      };
      s.onerror = function(){
        try { window.__tsu_page_injected_error = true; } catch(_) {}
        try { console.info('[tsu] page hook injection error'); } catch(_) {}
        // CSP等で注入に失敗した場合は MAIN world へフォールバック
        try { requestMainHook('script_onerror'); } catch(_) {}
        try { s.remove(); } catch(_) {}
      };
      (document.head || document.documentElement).appendChild(s);

      // onerror が発火しない/検知できないケース向けのウォッチドッグ
      try {
        setTimeout(() => {
          try {
            if (!window.__tsu_page_injected) {
              requestMainHook('watchdog');
            }
          } catch(_) {}
        }, 1200);
      } catch(_) {}
    } catch(_) {}
  })();

  // ページ→コンテンツへのメッセージブリッジ
  (function setupBridge(){
    try {
      window.addEventListener('message', (ev) => {
        try {
          if (!ev || ev.source !== window) return;
          const data = ev.data || {};
          if (!data || !data.__tsu) return;
          // ページ側からの設定反映
          if (data.type === 'tsu:setConfig' && data.config && typeof data.config === 'object') {
            try {
              window.tsupasswd = window.tsupasswd || {};
              Object.assign(window.tsupasswd, data.config);
              try { showToast('設定を反映しました'); } catch(_) {}
            } catch(_) {}
            return;
          }
          if (data.type === 'tsu:set' && data.key) {
            try {
              window.tsupasswd = window.tsupasswd || {};
              window.tsupasswd[String(data.key)] = data.value;
              try { showToast('設定を反映しました'); } catch(_) {}
            } catch(_) {}
            return;
          }
          if (data.type !== 'tsu:passkeyCaptured') return;
          try { console.info('[tsu] bridge: passkeyCaptured received'); } catch(_) {}
          window.__tsu_pk_cache = Object.assign(window.__tsu_pk_cache || {}, data.cache || {});
          // コンテンツ側でもイベント発火
          try {
            // 受信した cache を優先して detail を構築（不足分は extract で補完）
            const detail = Object.assign({}, (data && data.cache) || {}, extractPasskeyFromPage(document) || {});
            window.dispatchEvent(new CustomEvent('tsu:passkeyCaptured', { detail }));
            try { window.__tsu_passkey_active = true; } catch(_) {}
            // 取得時にサイレント保存を自動実行（抑止せず常にトリガー）
            try {
              try { console.info('[tsu] autosave(passkey): trigger from bridge'); } catch(_) {}
              const f = (window.savePasskeySilentlyRef || (window.tsupasswd && window.tsupasswd.savePasskeySilently) || (typeof savePasskeySilently === 'function' && savePasskeySilently));
              const exists = (typeof f === 'function');
              try { console.info('[tsu] autosave(passkey): callable', { exists }); } catch(_) {}
              if (!exists) { /* 関数未定義なら終了 */ return; }
              // キャッシュ反映の遅延に備えて少し待ってから実行
              try {
                const startTs = Date.now();
                setTimeout(() => {
                  try { console.info('[tsu] autosave(passkey): invoke'); } catch(_) {}
                  try {
                    const det0 = detail || extractPasskeyFromPage(document) || {};
                    const det = Object.assign({}, det0, {
                      attestationB64: (det0 && det0.attestationB64) || (window.__tsu_pk_cache && window.__tsu_pk_cache.attestationB64) || ''
                    });
                    const hasCred = !!(det && det.credentialIdB64);
                    const hasPub = !!(det && det.publicKeyB64);
                    const hasAtt = !!(det && det.attestationB64);
                    if (hasCred && (hasPub || hasAtt)) {
                      (window.savePasskeySilentlyRef || f)(null, det);
                    } else {
                      try { console.info('[tsu] autosave(passkey) skip: missing credential and (publicKey or attestation)'); } catch(_) {}
                    }
                  } catch(e) { try { console.info('[tsu] autosave(passkey) error', String(e && e.message || e)); } catch(_) {} }
                }, 350);
                // ウォッチドッグ: 一定時間内に enter マーカーが更新されなければフォールバック
                setTimeout(() => {
                  try {
                    const entered = window.__tsu_last_save_enter || 0;
                    if (!(entered && entered >= startTs)) {
                      console.info('[tsu] autosave(passkey) watchdog: fallback inline');
                      const raw = detail || extractPasskeyFromPage(document) || {};
                      const rpId = raw.rp || (location && location.hostname) || '';
                      let title = '';
                      try {
                        const pick = () => {
                          try {
                            // Manual override from extension/page config
                            try {
                              const ov = (window.tsupasswd && typeof window.tsupasswd.titleOverride === 'string') ? String(window.tsupasswd.titleOverride).trim() : '';
                              if (ov) return ov;
                            } catch(_) {}
                            // Prefer injected page cache title if available
                            try {
                              const tcache = (window.__tsu_pk_cache && window.__tsu_pk_cache.title) ? String(window.__tsu_pk_cache.title).trim() : '';
                              if (tcache) return tcache;
                            } catch(_) {}
                            const ax = (window.__tsu_current_anchor && window.__tsu_current_anchor.value && String(window.__tsu_current_anchor.value).trim()) || '';
                            if (ax) return ax;
                          } catch(_) {}
                          try {
                            const ae = document && document.activeElement;
                            if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) {
                              const v = String(ae.value || '').trim();
                              if (v) return v;
                              // placeholder fallback
                              try { const ph = String(ae.getAttribute && ae.getAttribute('placeholder') || '').trim(); if (ph) return ph; } catch(_) {}
                              // label fallback
                              try {
                                const id = ae.id && String(ae.id);
                                if (id) {
                                  const lb = document.querySelector(`label[for="${CSS.escape(id)}"]`);
                                  const txt = lb && (lb.textContent||'').trim();
                                  if (txt) return txt;
                                }
                              } catch(_) {}
                            }
                          } catch(_) {}
                          try {
                            const cand = findUserInputCandidate(document);
                            if (cand && cand.element && typeof cand.element.value === 'string') {
                              const v = String(cand.element.value).trim();
                              if (v) return v;
                              // placeholder/label fallback for candidate
                              try { const ph = String(cand.element.getAttribute && cand.element.getAttribute('placeholder') || '').trim(); if (ph) return ph; } catch(_) {}
                              try {
                                const id = cand.element.id && String(cand.element.id);
                                if (id) {
                                  const lb = document.querySelector(`label[for="${CSS.escape(id)}"]`);
                                  const txt = lb && (lb.textContent||'').trim();
                                  if (txt) return txt;
                                }
                              } catch(_) {}
                            }
                          } catch(_) {}
                          try {
                            const sels = [
                              'input[autocomplete="username"]',
                              'input[type="email"]',
                              'input[name*="user" i]',
                              'input[name*="mail" i]',
                              'input[type="text"]'
                            ];
                            for (const sel of sels) {
                              const el = document && document.querySelector && document.querySelector(sel);
                              if (el && typeof el.value === 'string') {
                                const v = String(el.value).trim();
                                if (v) return v;
                                try { const ph = String(el.getAttribute && el.getAttribute('placeholder') || '').trim(); if (ph) return ph; } catch(_) {}
                                try {
                                  const id = el.id && String(el.id);
                                  if (id) {
                                    const lb = document.querySelector(`label[for="${CSS.escape(id)}"]`);
                                    const txt = lb && (lb.textContent||'').trim();
                                    if (txt) return txt;
                                  }
                                } catch(_) {}
                              }
                            }
                          } catch(_) {}
                          return '';
                        };
                        title = pick();
                        // sanitize: avoid using plain host/domain as title
                        try {
                          const host = (location && location.hostname) ? String(location.hostname).toLowerCase() : '';
                          const isDomainLike = (s) => { try { return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(String(s||'').trim()); } catch(_) { return false; } };
                          if (title && (String(title).toLowerCase() === host || (isDomainLike(title) && String(title).toLowerCase() === host))) {
                            title = '';
                          }
                        } catch(_) {}
                      } catch(_) {}
                      if (!title) { title = String(raw.title || ''); }
                      try { console.info('[tsu] passkey title decide(fallback)', { fromInput: !!(title && title.length), title }); } catch(_) {}

                      try {
                        const looksEmail = (s) => { try { return /.+@.+\..+/.test(String(s || '').trim()); } catch(_) { return false; } };
                        const email = (function(){
                          try {
                            const cand = (window.__tsu_pk_cache && window.__tsu_pk_cache.userTitleCandidate) ? String(window.__tsu_pk_cache.userTitleCandidate).trim() : '';
                            if (looksEmail(cand)) return cand;
                          } catch(_) {}
                          try {
                            const nodes = Array.prototype.slice.call(document.querySelectorAll('input, textarea'));
                            for (const el of nodes) {
                              try {
                                if (!el || typeof el.value !== 'string') continue;
                                const v = String(el.value || '').trim();
                                if (looksEmail(v)) return v;
                              } catch(_) {}
                            }
                          } catch(_) {}
                          return '';
                        })();

                        if (email) {
                          const siteLabel = (function(){
                            try {
                              const tcache = (window.__tsu_pk_cache && window.__tsu_pk_cache.title) ? String(window.__tsu_pk_cache.title).trim() : '';
                              if (tcache) return tcache;
                            } catch(_) {}
                            try { if (document && document.title) { const t = String(document.title).trim(); if (t) return t; } } catch(_) {}
                            try { if (rpId) return String(rpId); } catch(_) {}
                            return '';
                          })();

                          const emailL = String(email).toLowerCase();
                          const titleL = String(title || '').toLowerCase();
                          if (!titleL.includes(emailL)) {
                            if (siteLabel && String(siteLabel).toLowerCase() !== emailL) {
                              title = `${siteLabel} - ${email}`;
                            } else {
                              title = String(email);
                            }
                          } else {
                            if (siteLabel && String(title || '').trim() === String(email).trim() && String(siteLabel).toLowerCase() !== emailL) {
                              title = `${siteLabel} - ${email}`;
                            }
                          }
                          try {
                            const maxLen = 160;
                            if (title && String(title).length > maxLen) title = String(title).slice(0, maxLen);
                          } catch(_) {}
                        }
                      } catch(_) {}

                      if (!title) {
                        try {
                          const cand = (window.__tsu_pk_cache && window.__tsu_pk_cache.userTitleCandidate) ? String(window.__tsu_pk_cache.userTitleCandidate).trim() : '';
                          if (cand) title = cand;
                        } catch(_) {}
                        if (!title) { try { if (document && document.title) title = String(document.title); } catch(_) {}
                        }
                        if (!title) { title = String(raw.rp || rpId || ''); }
                      }
                      const det = {
                        rp: String(raw.rp || rpId || ''),
                        cred: String(raw.cred || raw.credentialIdB64 || ''),
                        user: String(raw.user || raw.userHandleB64 || ''),
                        pub: String(raw.pub || raw.publicKeyB64 || ''),
                        count: String((raw.count != null ? String(raw.count) : '')),
                        transports: String(raw.transports || ''),
                        title: String(title || raw.title || ''),
                        rpId: String(raw.rp || rpId || ''),
                        credentialIdB64: String(raw.cred || raw.credentialIdB64 || ''),
                        userHandleB64: String(raw.user || raw.userHandleB64 || ''),
                        publicKeyB64: String(raw.pub || raw.publicKeyB64 || ''),
                        signCount: (raw.signCount != null ? Number(raw.signCount) : undefined),
                      };
                      console.info('[tsu] passkey extracted', { rpId, hasCred: !!det.credentialIdB64, hasUser: !!det.userHandleB64, hasPub: !!det.publicKeyB64, signCount: det.signCount });
                      if (!det.credentialIdB64) { console.info('[tsu] passkey save skip: missing credentialIdB64'); return; }
                      const host = (window.tsupasswd && window.tsupasswd.host) || 'dev.happyfactory.tsupasswd';
                      console.info('[tsu] passkey save begin', { rpId: det.rpId, hasCred: !!det.credentialIdB64 });
                      // フォールバック経路でもタイトル一意化を実施
                      const uniqueTitle = (base, exists) => {
                        try {
                          const used = new Set((exists || []).map(s => String(s || '').trim()));
                          let t = String(base || '').trim();
                          if (!t) return '';
                          if (!used.has(t)) return t;
                          let i = 2;
                          while (i < 1000) {
                            const cand = `${t} (${i})`;
                            if (!used.has(cand)) return cand;
                            i++;
                          }
                          return `${t} (${Date.now()})`;
                        } catch(_) { return String(base || ''); }
                      };

                      const readEntries = (raw) => {
                        try {
                          const read = (v) => {
                            if (!v) return [];
                            if (typeof v === 'string') { try { const d = JSON.parse(v); return Array.isArray(d) ? d : (d && d.entries) || []; } catch(_) { return []; } }
                            if (v.stdout && typeof v.stdout === 'string') { try { const d = JSON.parse(v.stdout); return Array.isArray(d) ? d : (d && d.entries) || []; } catch(_) { return []; } }
                            if (v.data && typeof v.data === 'string') { try { const d = JSON.parse(v.data); return Array.isArray(d) ? d : (d && d.entries) || []; } catch(_) { return []; } }
                            if (Array.isArray(v.entries)) return v.entries;
                            if (Array.isArray(v)) return v;
                            return [];
                          };
                          const arr = read(raw && (raw.data || raw));
                          return (Array.isArray(arr) ? arr : []).filter(e => e && typeof e === 'object');
                        } catch(_) { return []; }
                      };

                      const deleteIds = (ids, cb) => {
                        try {
                          const list = Array.isArray(ids) ? ids.slice() : [];
                          const step = () => {
                            try {
                              const id = String(list.shift() || '');
                              if (!id) { try { cb && cb(); } catch(_) {} return; }
                              sendWithPreflight({ type: 'RUN_TSUPASSWD', host, args: ['passkey', 'delete', id] }, () => {
                                try { step(); } catch(_) { try { cb && cb(); } catch(__) {} }
                              });
                            } catch(_) { try { cb && cb(); } catch(__) {} }
                          };
                          step();
                        } catch(_) { try { cb && cb(); } catch(__) {} }
                      };

                      const doSave2 = (finalTitle) => {
                        const args2 = ['passkey', 'add', det.rpId, det.credentialIdB64, det.userHandleB64 || '', det.publicKeyB64 || ''];
                        if (typeof det.signCount === 'number') { args2.push('--sign-count', String(det.signCount)); }
                        if (det.transports) { args2.push('--transports', String(det.transports)); }
                        if (finalTitle) { args2.push('--title', String(finalTitle)); }
                        try { console.info('[tsu] passkey save args(fallback)', { args: args2 }); } catch(_) {}
                        sendWithPreflight({ type: 'RUN_TSUPASSWD', host, args: args2 }, (resp) => {
                          try { console.info('[tsu] passkey save end', resp); } catch(_) {}
                          try {
                            const ok = !!(resp && (resp.ok === true || resp.status === 'ok' || (resp.data && (resp.data.ok === true || resp.data.status === 'ok'))));
                            if (ok) { try { showToast('保存しました'); } catch(_) {} } else { try { showToast('保存に失敗しました'); } catch(_) {} }
                          } catch(_) {}
                        });
                      };

                      try {
                        sendWithPreflight({ type: 'RUN_TSUPASSWD', host, args: ['passkey', 'search', det.rpId, '--json'] }, (resp2) => {
                          try {
                            const baseTitle = (det.title || det.rpId || '');
                            const norm = (s) => { try { return String(s || '').trim().toLowerCase(); } catch(_) { return ''; } };
                            const want = norm(baseTitle);
                            const entries = readEntries(resp2);
                            const ids = (Array.isArray(entries) ? entries : [])
                              .filter(e => want && (norm(e.title || e.name || '') === want))
                              .map(e => String((e && e.id) || '').trim())
                              .filter(Boolean);
                            if (ids.length) {
                              deleteIds(ids, () => { try { doSave2(baseTitle); } catch(_) {} });
                            } else {
                              doSave2(baseTitle);
                            }
                          } catch(_) { doSave2(det.title); }
                        });
                      } catch(_) {
                        doSave2(det.title);
                      }
                    }
                  } catch(_) {}
                }, 700);
              } catch(e) { try { console.info('[tsu] autosave(passkey) schedule error', String(e && e.message || e)); } catch(_) {} }
              // autosave 直後の自動表示は行わない（チラつき防止）
            } catch(e) { try { console.info('[tsu] autosave(passkey) outer error', String(e && e.message || e)); } catch(_) {} }
            if (isAutoPopupEnabled()) {
              try {
                const now = Date.now();
                if (!window.__tsu_pk_last_popup || (now - window.__tsu_pk_last_popup) > 1500) {
                  window.__tsu_pk_last_popup = now;
                  const anchor = (window.__tsu_current_anchor)
                    || document.querySelector('input[type="password"]')
                    || document.querySelector('input')
                    || null;
                  // 直近のユーザ操作が無い場合は表示しない（ページロード/自動フォーカス対策）
                  if (!hasRecentUserGesture()) { return; }
                  if (!(isPasskeyEnvOn() || isPasskeyActiveNow())) { openPasskeyDialog(anchor, detail); }
                }
              } catch(_) {}
            }
          } catch(_) {}
        } catch(_) {}
      }, false);
    } catch(_) {}
    // ユーザ操作のタイムスタンプを追跡（表示ガード用）
    try {
      const onInteract = () => { try { window.__tsu_last_user_interact = Date.now(); } catch(_) {} };
      window.addEventListener('pointerdown', onInteract, { capture: true, passive: true });
      window.addEventListener('mousedown', onInteract, { capture: true, passive: true });
      window.addEventListener('touchstart', onInteract, { capture: true, passive: true });
      window.addEventListener('keydown', (e) => { try { if (!e.isComposing) window.__tsu_last_user_interact = Date.now(); } catch(_) {} }, true);
      window.addEventListener('focusin', () => { try { window.__tsu_last_user_interact = Date.now(); } catch(_) {} }, true);
    } catch(_) {}
  })();
  // ブリッジ疎通テスト用ヘルパー（ページフックを模倣）
  try {
    window.tsupasswd = window.tsupasswd || {};
    window.tsupasswd.testHook = function(cache){
      try { window.postMessage({ __tsu: true, type: 'tsu:passkeyCaptured', cache: cache || {} }, '*'); return true; } catch(_) { return false; }
    };
  } catch(_) {}
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
    const out = { rp: '', cred: '', user: '', pub: '', count: '', transports: '', title: '' };
    // WebAuthnフックのキャッシュを優先
    try {
      const c = (window && window.__tsu_pk_cache) || {};
      if (c.rpId) out.rp = c.rpId;
      if (c.credentialIdB64) out.cred = c.credentialIdB64;
      if (c.userHandleB64) out.user = c.userHandleB64;
      if (c.publicKeyB64) out.pub = c.publicKeyB64; // まだ未設定の可能性あり
      if (c.attestationB64) out.att = c.attestationB64;
      if (typeof c.signCount === 'number') out.count = String(c.signCount);
      if (c.transports) out.transports = String(c.transports);
      if (c.title) out.title = String(c.title);
    } catch(_) {}
    try { if (!out.rp) out.rp = (location && location.hostname) ? String(location.hostname) : ''; } catch(_) {}
    try { if (!out.title) out.title = (document && document.title) ? String(document.title) : ''; } catch(_) {}
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
              try { if (pub.rp && pub.rp.name) window.__tsu_pk_cache.title = String(pub.rp.name); } catch(_) {}
              if (pub.user && pub.user.id) {
                const u = pub.user.id; // ArrayBufferSource
                const buf = (u instanceof ArrayBuffer) ? u : (ArrayBuffer.isView(u) ? u.buffer : null);
                if (buf) window.__tsu_pk_cache.userHandleB64 = b64u(buf);
              }
              // transports 補完（excludeCredentialsに含まれる可能性）
              try {
                const ex = Array.isArray(pub.excludeCredentials) ? pub.excludeCredentials : [];
                const trSet = new Set();
                for (const e of ex) {
                  try {
                    const trs = (e && e.transports) || [];
                    if (Array.isArray(trs)) trs.forEach(t => trSet.add(String(t)));
                  } catch(_) {}
                }
                if (trSet.size) window.__tsu_pk_cache.transports = Array.from(trSet).join(',');
              } catch(_) {}
            } catch(_) {}
          }
        } catch(_) {}
        try { console.info('[tsu] webauthn.create start'); } catch(_) {}
        const cred = await origCreate(options);
        try { console.info('[tsu] webauthn.create done'); } catch(_) {}
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
            // 取得通知イベント + 自動ポップアップ
            try {
              const detail = extractPasskeyFromPage((cred && cred.id && document) ? document : document);
              window.dispatchEvent(new CustomEvent('tsu:passkeyCaptured', { detail }));
              if (isAutoPopupEnabled()) {
                try {
                  const now = Date.now();
                  if (!window.__tsu_pk_last_popup || (now - window.__tsu_pk_last_popup) > 1500) {
                    window.__tsu_pk_last_popup = now;
                    const anchor = (window.__tsu_current_anchor)
                      || document.querySelector('input[type="password"]')
                      || document.querySelector('input')
                      || null;
                    // 直近のユーザ操作が無い場合は表示しない
                    if (!hasRecentUserGesture()) { return; }
                    if (!(isPasskeyEnvOn() || isPasskeyActiveNow())) { openPasskeyDialog(anchor, detail); }
                  }
                } catch(_) {}
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
            try {
              if (pub.rpId) window.__tsu_pk_cache.rpId = String(pub.rpId);
              if (!window.__tsu_pk_cache.title && document && document.title) window.__tsu_pk_cache.title = String(document.title);
              // transports 補完（allowCredentialsに含まれる可能性）
              try {
                const allow = Array.isArray(pub.allowCredentials) ? pub.allowCredentials : [];
                const trSet = new Set((window.__tsu_pk_cache.transports ? String(window.__tsu_pk_cache.transports).split(',') : []).filter(Boolean));
                for (const a of allow) {
                  try {
                    const trs = (a && a.transports) || [];
                    if (Array.isArray(trs)) trs.forEach(t => trSet.add(String(t)));
                  } catch(_) {}
                }
                if (trSet.size) window.__tsu_pk_cache.transports = Array.from(trSet).join(',');
              } catch(_) {}
            } catch(_) {}
          }
        } catch(_) {}
        try { console.info('[tsu] webauthn.get start'); } catch(_) {}
        const cred = await origGet(options);
        try { console.info('[tsu] webauthn.get done'); } catch(_) {}
        try {
          if (cred && cred.type === 'public-key') {
            try { window.__tsu_pk_cache.credentialIdB64 = b64u(cred.rawId); } catch(_) {}
            const resp = cred.response;
            try { if (resp && resp.userHandle) window.__tsu_pk_cache.userHandleB64 = b64u(resp.userHandle); } catch(_) {}
            // 取得通知イベント + 自動ポップアップ
            try {
              const detail = extractPasskeyFromPage(document);
              window.dispatchEvent(new CustomEvent('tsu:passkeyCaptured', { detail }));
              if (isAutoPopupEnabled()) {
                try {
                  const now = Date.now();
                  if (!window.__tsu_pk_last_popup || (now - window.__tsu_pk_last_popup) > 1500) {
                    window.__tsu_pk_last_popup = now;
                    const anchor = (window.__tsu_current_anchor)
                      || document.querySelector('input[type="password"]')
                      || document.querySelector('input')
                      || null;
                    if (!(isPasskeyEnvOn() || isPasskeyActiveNow())) { openPasskeyDialog(anchor, detail); }
                  }
                } catch(_) {}
              }
            } catch(_) {}
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

  // タイトル用にページの入力値（ユーザID想定）を優先取得（値が無ければプレースホルダ/ラベル/属性名を利用）
  const getUserValueForTitle = function(anchor, rootDoc) {
    try {
      const doc = rootDoc || document;
      const pickTextLike = (s) => { try { return (s == null) ? '' : String(s).trim(); } catch(_) { return ''; } };
      const normalizeUser = (v) => {
        try {
          const s = pickTextLike(v);
          if (!s) return '';
          // そのまま使用（メールも全体を保持）
          return s;
        } catch(_) { return ''; }
      };
      const pickVal = (el) => {
        try {
          if (!el) return '';
          // 1) 値
          const v = (typeof el.value === 'string') ? el.value.trim() : '';
          if (v) return normalizeUser(v);
          // 2) placeholder
          const ph = pickTextLike(el.getAttribute && el.getAttribute('placeholder'));
          if (ph) return normalizeUser(ph);
          // 3) 関連ラベル
          try {
            const id = el.id && String(el.id);
            if (id) {
              const lab = doc.querySelector && doc.querySelector(`label[for="${CSS.escape(id)}"]`);
              const txt = pickTextLike(lab && lab.textContent);
              if (txt) return normalizeUser(txt);
            }
          } catch(_) {}
          // 4) name/id 属性
          const hint = pickTextLike((el.name || '')) || pickTextLike((el.id || ''));
          if (hint) return normalizeUser(hint);
          return '';
        } catch(_) { return ''; }
      };
      // 1) まずアクティブ要素がテキスト入力ならその値
      try {
        const ae = doc.activeElement;
        if (ae && isTextboxLike(ae)) { const v = pickVal(ae); if (v) return v; }
      } catch(_) {}
      // 2) 同一フォーム内のユーザ欄の値（優先度付き）
      try {
        const a = anchor;
        const form = a && (a.form || (a.closest && a.closest('form')));
        if (form) {
          const uEl = findUserInputCandidate(form) || null;
          const v = pickVal(uEl);
          if (v) return v;
        }
      } catch(_) {}
      // 3) ドキュメント全体から可視なユーザ欄の値（優先度付き）
      try {
        const uEl2 = findUserInputCandidate(doc);
        const v2 = pickVal(uEl2);
        if (v2) return v2;
      } catch(_) {}
      return '';
    } catch(_) { return ''; }
  };

  // ホストとユーザ文字列からタイトルを合成
  const composeTitle = function(baseTitle, userLike) {
    try {
      const host = (location && location.hostname) ? String(location.hostname) : '';
      const u = (userLike && String(userLike).trim()) || '';
      if (host && u) return `${host} / ${u}`;
      if (u) return u;
      return baseTitle || host || '';
    } catch(_) { return baseTitle || ''; }
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
        box.addEventListener('mouseleave', () => { window.__tsu_hovering_popup = false; try { scheduleAutoHide(1500); } catch(_) {} }, true);
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

  const isAutoPopupEnabled = function() {
    try {
      const cfg = (window && window.tsupasswd) || null;
      if (cfg && cfg.disableAutoPasskeyPopup) return false;
      if (cfg && cfg.autoPasskeyPopup === false) return false;
    } catch(_) {}
    return true;
  };

  showToast = function(text) {
    try {
      let doc = document;
      try {
        const topDoc = (window.top && window.top.document) ? window.top.document : null;
        // 同一オリジンであればトップドキュメントに挿入
        if (topDoc && topDoc.location && document.location && topDoc.location.origin === document.location.origin) {
          doc = topDoc;
        }
      } catch(_) {}
      let t = doc.getElementById('tsu-toast');
      if (!t) {
        t = doc.createElement('div');
        t.id = 'tsu-toast';
        t.style.position = 'fixed';
        t.style.right = '16px';
        t.style.bottom = '16px';
        t.style.zIndex = '2147483647';
        t.style.background = 'rgba(32,33,36,0.98)';
        t.style.color = '#e8eaed';
        t.style.border = '1px solid rgba(0,0,0,0.2)';
        t.style.borderRadius = '8px';
        t.style.padding = '10px 12px';
        t.style.boxShadow = '0 6px 18px rgba(0,0,0,0.3)';
        t.style.fontSize = '13px';
        t.style.display = 'none';
        (doc.body || doc.documentElement).appendChild(t);
      }
      t.textContent = String(text || '');
      t.style.display = 'block';
      try { if (t.__timer) { clearTimeout(t.__timer); } } catch(_) {}
      try { t.__timer = setTimeout(function(){ try { t.style.display = 'none'; } catch(_) {} }, 1600); } catch(_) {}
    } catch(_) {}
  };
  try {
    window.tsupasswd = window.tsupasswd || {};
    window.tsupasswd.toast = showToast;
    // savePasskeySilently をグローバル公開（IIFE 内の定義を window から参照できるように）
    if (typeof window.tsupasswd.savePasskeySilently !== 'function') {
      try { window.tsupasswd.savePasskeySilently = function(){ try { return savePasskeySilently.apply(null, arguments); } catch(_) {} }; } catch(_) {}
    }
    if (typeof window.savePasskeySilentlyRef !== 'function') {
      try { window.savePasskeySilentlyRef = window.tsupasswd.savePasskeySilently; } catch(_) {}
    }
  } catch(_) {}

  const safeSendMessage = function(payload, cb, _attempt) {
    try {
      const attempt = (typeof _attempt === 'number') ? _attempt : 0;
      if (!(chrome && chrome.runtime && chrome.runtime.sendMessage)) throw new Error('runtime_unavailable');
      chrome.runtime.sendMessage(payload, (resp) => {
        const err = chrome.runtime.lastError;
        if (err) {
          try {
            const msg = String(err && err.message || err || '');
            // 一時的な無効化/未接続/応答前クローズなどは短時間で再試行（最大5回、指数バックオフ）
            const retryable = /Extension context invalidated|Receiving end does not exist|Could not establish connection|The message port closed before a response was received/i.test(msg);
            if (retryable && attempt < 5) {
              const delay = Math.min(3200, 200 * Math.pow(2, attempt));
              return setTimeout(() => safeSendMessage(payload, cb, attempt + 1), delay);
            }
            try { showToast('拡張が無効になっています。ページを再読み込みしてください'); } catch(_) {}
            return cb && cb({ ok: false, error: msg });
          } catch(_) { return cb && cb({ ok: false, error: 'runtime_error' }); }
        }
        try { cb && cb(resp); } catch(_) {}
      });
    } catch (e) {
      try {
        const msg = String(e && e.message || e || '');
        if (/Extension context invalidated|Receiving end does not exist|Could not establish connection|The message port closed before a response was received/i.test(msg) && attempt < 5) {
          const delay = Math.min(3200, 200 * Math.pow(2, attempt));
          return setTimeout(() => safeSendMessage(payload, cb, attempt + 1), delay);
        }
        try { showToast('拡張がリロードされました。ページを再読み込みしてください'); } catch(_) {}
        return cb && cb({ ok: false, error: msg });
      } catch(_) { return cb && cb({ ok: false, error: 'runtime_exception' }); }
    }
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
    // パスキー環境では従来ポップアップを表示しない（最終ガード）
    try { if (isPasskeyEnvOn() || isPasskeyActiveNow()) { return null; } } catch(_) {}
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
    const fromInput = getUserValueForTitle(anchor, document);
    const userHint = (fromInput && fromInput.trim()) ? fromInput.trim() : ((curUser && String(curUser).trim()) ? String(curUser).trim() : '');
    const defaultTitle = userHint || title;
    const titleInput = q('#tsu-save-title');
    const userInput = q('#tsu-save-user');
    const passInput = q('#tsu-save-pass');
    const urlInput  = q('#tsu-save-url');
    if (titleInput) titleInput.value = defaultTitle;
    if (urlInput) urlInput.value = urlStr;
    if (userInput) userInput.value = curUser || '';
    if (passInput) passInput.value = curPass || '';
    // タイトル手動編集検知と自動追従
    let titleEdited = false;
    if (titleInput) {
      titleInput.addEventListener('input', () => { titleEdited = true; }, { once: true });
    }
    if (userInput && titleInput) {
      const onUserChange = () => {
        try {
          if (!titleEdited) {
            const v = (userInput.value || '').trim();
            titleInput.value = v || (document && document.title);
          }
        } catch(_) {}
      };
      userInput.addEventListener('input', onUserChange, false);
      userInput.addEventListener('change', onUserChange, false);
    }
    const onCancel = (ev) => { try { ev.preventDefault(); ev.stopPropagation(); } catch(_) {}; try { dialogOpen = false; box.style.display = 'none'; } catch(_) {}; };
    // 事前PINGで拡張の接続性を確認し、失敗時は保存ボタンを無効化
    try {
      const btn = q('#tsu-save-ok');
      const err = q('#tsu-save-err');
      if (btn) {
        btn.disabled = true;
        sendWithPreflight({ type: 'PING' }, (pong) => {
          try {
            if (!(pong && pong.ok)) {
              if (err) {
                err.style.display = 'block';
                err.innerHTML = '拡張に接続できません。<button id="tsu-reload-page2" style="margin-left:8px;padding:2px 6px;">ページを再読み込み</button>';
                const b = err.querySelector('#tsu-reload-page2');
                if (b) b.addEventListener('click', () => { try { location.reload(); } catch(_) {} }, { once: true });
              }
            } else {
              btn.disabled = false;
            }
          } catch(_) {}
        });
      }
    } catch(_) {}
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
      sendWithPreflight({ type: 'RUN_TSUPASSWD', host, args }, (resp) => {
        try {
          if (!(resp && resp.ok)) {
            if (err) {
              err.style.display = 'block';
              try {
                const detail = (resp && (resp.error || (resp.data && (resp.data.stderr || resp.data.stdout)) || '')) || '';
                const needsReload = /Extension context invalidated/i.test(String(detail));
                if (needsReload) {
                  err.innerHTML = '保存に失敗しました: Extension context invalidated. <button id="tsu-reload-page" style="margin-left:8px;padding:2px 6px;">ページを再読み込み</button>';
                  try {
                    const b = err.querySelector('#tsu-reload-page');
                    if (b) b.addEventListener('click', () => { try { location.reload(); } catch(_) {} }, { once: true });
                  } catch(_) {}
                } else {
                  err.textContent = '保存に失敗しました' + (detail ? (': ' + String(detail)) : '');
                }
              } catch(_) { err.textContent = '保存に失敗しました'; }
            }
            return;
          }
          // 成功
          try { box.innerHTML = '<div style="padding:8px 4px;">保存しました</div>'; } catch(_) {}
          try { showToast('保存しました'); } catch(_) {}
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

  // ==========================
  // パスワード保存提案（フォーム送信→次ページでダイアログ表示）
  // ==========================
  (function(){
    try {
      if (window.__tsu_pw_save_suggest_installed) return;
      window.__tsu_pw_save_suggest_installed = true;
    } catch(_) {}

    const STORE_KEY = '__tsu_pending_save_cred';

    const getStore = () => {
      try {
        if (chrome && chrome.storage && chrome.storage.session) return chrome.storage.session;
      } catch(_) {}
      return chrome.storage.local;
    };

    const nowTs = () => { try { return Date.now(); } catch(_) { return 0; } };

    const shouldSkip = () => {
      try {
        if (document && document.visibilityState && document.visibilityState !== 'visible') return true;
      } catch(_) {}
      try {
        // 直近のユーザ操作が無い場合は保存提案しない（自動サブミット等の誤検知対策）
        if (typeof hasRecentUserGesture === 'function' && !hasRecentUserGesture()) return true;
      } catch(_) {}
      return false;
    };

    const summarize = (form) => {
      try {
        if (!form || !form.querySelectorAll) return null;
        const ins = Array.prototype.slice.call(form.querySelectorAll('input'));
        const pEl = ins.find(isPassLike) || null;
        if (!pEl || typeof pEl.value !== 'string') return null;
        const pw = String(pEl.value || '').trim();
        if (!pw) return null;
        const uEl = ins.find((el) => { try { return el && el !== pEl && isUserLike(el); } catch(_) { return false; } }) || null;
        const user = (uEl && typeof uEl.value === 'string') ? String(uEl.value || '').trim() : '';
        // password だけでも保存したいケースがあるので user は空許容。ただし URL は必須。
        const url = (location && location.href) ? String(location.href) : '';
        if (!url) return null;
        return {
          url,
          username: user,
          password: pw,
          at: nowTs(),
        };
      } catch(_) { return null; }
    };

    // submit 時に候補を一時保存（次ページで表示）
    try {
      document.addEventListener('submit', (ev) => {
        try {
          if (shouldSkip()) return;
          const form = ev && ev.target;
          const data = summarize(form);
          if (!data) return;
          // 連続送信による上書きを抑止（同一URL/ユーザ/パスの短時間連続は無視）
          try {
            const k = String(data.url || '') + '|' + String(data.username || '') + '|' + String(data.password || '');
            const lastK = String(window.__tsu_last_pending_key || '');
            const lastT = Number(window.__tsu_last_pending_ts || 0);
            const t = nowTs();
            if (k && lastK === k && lastT && (t - lastT) < 2000) return;
            window.__tsu_last_pending_key = k;
            window.__tsu_last_pending_ts = t;
          } catch(_) {}

          const store = getStore();
          store.set({ [STORE_KEY]: data }, () => { /* ignore */ });
        } catch(_) {}
      }, true);
    } catch(_) {}

    // 次ページ（同一オリジン）で一時保存があればダイアログ表示
    try {
      const store = getStore();
      store.get({ [STORE_KEY]: null }, (obj) => {
        try {
          const pending = obj && obj[STORE_KEY];
          if (!pending) return;
          // 期限切れ（60秒）
          const age = nowTs() - Number(pending.at || 0);
          if (!(age >= 0 && age < 60000)) {
            try { store.remove([STORE_KEY]); } catch(_) {}
            return;
          }
          // 同一オリジン以外は出さない
          try {
            const u = pending.url ? new URL(String(pending.url)) : null;
            if (u && location && u.origin !== location.origin) {
              try { store.remove([STORE_KEY]); } catch(_) {}
              return;
            }
          } catch(_) {}

          // ダイアログを表示（DOM 準備後）
          setTimeout(() => {
            try {
              if (shouldSkip()) return;
              const anchor = (document && (document.querySelector('input[type="password"]') || document.activeElement)) || null;
              openSaveDialog(anchor, String(pending.username || ''), String(pending.password || ''));
            } catch(_) {}
          }, 350);

          try { store.remove([STORE_KEY]); } catch(_) {}
        } catch(_) {}
      });
    } catch(_) {}
  })();

  // パスキー専用ポップアップ呼び出し
  function showPasskeyPopup(anchor) {
    try {
      try { console.info('[tsu] showPasskeyPopup called', { anchorExists: !!anchor }); } catch(_) {}
      const detail = extractPasskeyFromPage(document);
      try { if (isPasskeyEnvOn() || isPasskeyActiveNow()) { showPasskeyCandidatePopup(anchor); return; } } catch(_) {}
      openPasskeyDialog(anchor, detail);
    } catch(_) {}
  }

  // パスキー候補一覧（rpIdで検索し、タイトルを表示）
  function showPasskeyCandidatePopup(anchor) {
    try {
      // 従来のインラインポップアップを強制的に閉じて干渉を避ける
      try { const oldBox = document.getElementById('tsupasswd-inline-popup'); if (oldBox) { oldBox.style.display = 'none'; } } catch(_) {}
      const doc = (anchor && anchor.ownerDocument) || document;
      let box = doc.getElementById('tsupasswd-passkey-list');
      if (!box) {
        box = doc.createElement('div');
        box.id = 'tsupasswd-passkey-list';
        box.style.position = 'fixed';
        box.style.background = 'rgba(32,33,36,0.98)';
        box.style.color = '#e8eaed';
        box.style.border = '1px solid rgba(0,0,0,0.2)';
        box.style.borderRadius = '10px';
        box.style.padding = '10px 12px';
        box.style.fontSize = '12px';
        box.style.lineHeight = '1.5';
        box.style.boxShadow = '0 6px 18px rgba(0,0,0,0.3)';
        box.style.zIndex = '2147483647';
        box.style.display = 'none';
        box.style.minWidth = '260px';
        box.style.maxWidth = '420px';
        box.style.maxHeight = '50vh';
        box.style.overflowY = 'auto';
        try { box.setAttribute('data-tsu-menu', 'passkey'); } catch(_) {}
        (doc.body || doc.documentElement).appendChild(box);
        // hover スタイル
        try {
          if (!doc.getElementById('tsu-passkey-list-style')) {
            const style = doc.createElement('style');
            style.id = 'tsu-passkey-list-style';
            style.textContent = '\n#tsupasswd-passkey-list .tsu-item{transition:background-color 120ms ease;padding:6px 4px;border-radius:6px;cursor:pointer;}\n#tsupasswd-passkey-list .tsu-item:hover{background:rgba(138,180,248,0.12);}\n';
            (doc.head || doc.documentElement).appendChild(style);
          }
        } catch(_) {}
      }
      const place = () => {
        try {
          const r = (anchor && anchor.getBoundingClientRect) ? anchor.getBoundingClientRect() : null;
          const gap = 8;
          const vw = window.innerWidth || 0;
          const vh = window.innerHeight || 0;
          const bx = box.offsetWidth || 0;
          const by = box.offsetHeight || 0;
          let top = 32;
          let left = 16;
          if (r) {
            // 横位置: アンカー左に合わせつつ画面内に収める
            left = Math.min(Math.max(r.left, 8), Math.max(8, vw - bx - 8));
            // 縦位置: 下配置が入るなら下、入らない場合は上に配置
            const spaceBelow = (vh - r.bottom - gap);
            const spaceAbove = (r.top - gap);
            if (spaceBelow >= by || spaceBelow >= spaceAbove) {
              top = Math.min(Math.max(r.bottom + gap, 8), Math.max(8, vh - by - 8));
            } else {
              top = Math.max(8, r.top - gap - by);
              // 万一はみ出す場合は下配置にフォールバック
              if (top > (vh - by - 8)) {
                top = Math.min(Math.max(r.bottom + gap, 8), Math.max(8, vh - by - 8));
              }
            }
          } else {
            // アンカー不明時は左上寄りの既定位置
            top = Math.min(Math.max(32, 8), Math.max(8, vh - by - 8));
            left = Math.min(Math.max(16, 8), Math.max(8, vw - bx - 8));
          }
          box.style.top = top + 'px';
          box.style.left = left + 'px';
        } catch(_) {}
      };
      // rpId を取得し正規化
      let rpId = '';
      try {
        const rp = (window.tsupasswd && typeof window.tsupasswd.getRpInfo === 'function') ? window.tsupasswd.getRpInfo() : null;
        if (rp && rp.rpId) rpId = String(rp.rpId);
      } catch(_) {}
      try { if (!rpId && location && location.hostname) rpId = String(location.hostname); } catch(_) {}
      try { if (rpId) rpId = String(rpId).trim().toLowerCase().replace(/\.$/, ''); } catch(_) {}
      if (!rpId) { try { box.innerHTML = '<div style="opacity:0.85;">rpId が見つかりません</div>'; } catch(_) {} return box; }
      // 直近と同一 rpId の呼び出しが短時間に連続した場合は検索を再実行しない
      try {
        const now = Date.now();
        const lastRp = window.__tsu_last_pk_list_rp;
        const lastTs = Number(window.__tsu_last_pk_list_ts || 0);
        if (lastRp === rpId && (now - lastTs) < 800) { place(); return box; }
        window.__tsu_last_pk_list_rp = rpId;
        window.__tsu_last_pk_list_ts = now;
      } catch(_) {}
      // 初期表示（ここでのみ表示文言をセットし、レントラ時は上記で return 済み）
      try { box.innerHTML = '<div style="opacity:0.85;">検索中...</div>'; box.style.display = 'block'; place(); } catch(_) {}
      try { console.info('[tsu] list search passkey q=', rpId); } catch(_) {}

      const host = (window.tsupasswd && window.tsupasswd.host) || 'dev.happyfactory.tsupasswd';
      // rpId の部分一致（サブドメインを落とした suffix）でも検索しマージ
      const buildRpCandidates = (rp) => {
        try {
          const out = [];
          const base = String(rp || '').trim().toLowerCase().replace(/\.$/, '');
          const parts = base.split('.').filter(Boolean);
          // よくある汎用サブドメインを一段落とした候補も追加（www, m, account, login, app）
          try {
            const common = new Set(['www','m','account','login','app']);
            if (parts.length >= 3 && common.has(parts[0])) {
              const cand1 = parts.slice(1).join('.');
              if (cand1 && cand1 !== base) out.push(cand1);
            }
          } catch(_) {}
          if (parts.length >= 2) {
            for (let k = 2; k <= parts.length; k++) {
              const cand = parts.slice(parts.length - k).join('.');
              // あまりに短い/広すぎる候補は除外（例: 'jp', 'co.jp'）
              if (cand.length >= 4 && /\./.test(cand) && !/^([a-z]{2}|co|or|ne|ac|go|ed)\.jp$/i.test(cand) && !/^(com|net|org)\.[a-z]{2,}$/i.test(cand)) {
                out.push(cand);
              }
            }
          }
          // 元の rpId を先頭に
          const uniq = [];
          [base].concat(out.map(s => String(s).toLowerCase())).forEach(v => { if (v && !uniq.includes(v)) uniq.push(v); });
          return uniq;
        } catch(_) { return [String(rp || '').trim().toLowerCase().replace(/\.$/, '')]; }
      };
      const parseEntries = (raw) => {
        try {
          if (!raw) return [];
          if (typeof raw === 'string') { try { const d = JSON.parse(raw); return Array.isArray(d) ? d : (d && d.entries) || []; } catch(_) { return []; } }
          if (raw.stdout && typeof raw.stdout === 'string') { try { const d = JSON.parse(raw.stdout); return Array.isArray(d) ? d : (d && d.entries) || []; } catch(_) { return []; } }
          if (raw.data && typeof raw.data === 'string') { try { const d = JSON.parse(raw.data); return Array.isArray(d) ? d : (d && d.entries) || []; } catch(_) { return []; } }
          if (Array.isArray(raw.entries)) return raw.entries;
          if (Array.isArray(raw)) return raw;
          return [];
        } catch(_) { return []; }
      };
      // 段階的検索: 1) 完全一致 2) 結果0件ならサフィックス候補 3) それでも0件ならラベル由来のキーワード
      const allCands = buildRpCandidates(rpId);
      const exact = [String(rpId)].filter(Boolean);
      const suffix = allCands.filter(c => String(c) !== String(rpId));
      const labelKeywords = (() => {
        try {
          const base = String(rpId || '').trim().toLowerCase();
          const parts = base.split('.').filter(Boolean);
          const out = [];
          // 最下位ラベル（例: webauthn.io -> 'webauthn'）
          if (parts.length) out.push(parts[0]);
          // 2ラベル結合（例: account.bandainamcoid.com -> 'bandainamcoid', 'account bandainamcoid'）
          if (parts.length >= 2) {
            out.push(parts[parts.length - 2]);
            out.push(parts.slice(Math.max(0, parts.length - 2)).join(' '));
          }
          // 3ラベル結合（スペース区切り）
          if (parts.length >= 3) out.push(parts.slice(Math.max(0, parts.length - 3)).join(' '));
          // フィルタ: 4文字未満や一般TLDのみは除外
          const bad = new Set(['com','net','org','jp','co','or','ne','ac','go','ed']);
          const uniq = [];
          out.map(s => String(s).trim().toLowerCase()).forEach(s => {
            if (s && s.length >= 4 && !bad.has(s) && !uniq.includes(s)) uniq.push(s);
          });
          return uniq;
        } catch(_) { return []; }
      })();
      const merged = [];
      const seen = new Set();
      let rendered = false;
      const addAll = (arr) => {
        try {
          const a = Array.isArray(arr) ? arr : [];
          try { console.info('[tsu] passkey search hits =', a.length); } catch(_) {}
          const before = merged.length;
          a.forEach(e => {
            try {
              const key = JSON.stringify({ id: e && e.id, title: e && (e.title||e.name||''), rp: e && (e.rp||e.rp_id||'') });
              if (!seen.has(key)) { seen.add(key); merged.push(e); }
            } catch(_) {}
          });
          // 初回ヒット時に即時描画（後続ステージを待たずに UI を確定）
          try {
            if (!rendered && merged.length > 0 && before === 0) {
              finalize(merged);
            }
          } catch(_) {}
        } catch(_) {}
      };
      const runStage = (list, next) => {
        try {
          const qlist = Array.isArray(list) ? list.slice() : [];
          const step = () => {
            try {
              if (!qlist.length) { next && next(); return; }
              const q = String(qlist.shift() || '').trim().toLowerCase();
              try { console.info('[tsu] passkey search (keyword) =', q); } catch(_) {}
              let responded = false;
              let timer = null;
              try { timer = setTimeout(() => { if (!responded) { responded = true; try { console.info('[tsu] passkey search timeout, skip =', q); } catch(_) {} step(); } }, 1500); } catch(_) {}
              sendWithPreflight({ type: 'RUN_TSUPASSWD', host, args: ['passkey', 'search', q, '--json'] }, (resp) => {
                if (responded) return;
                responded = true;
                try { if (timer) clearTimeout(timer); } catch(_) {}
                try { addAll(parseEntries(resp && (resp.data || resp))); } catch(_) {}
                step();
              });
            } catch(_) { next && next(); }
          };
          step();
        } catch(_) { next && next(); }
      };
      const runSearch = () => {
        const isExactEntry = (e) => {
          try {
            const base = String(rpId || '').trim().toLowerCase();
            const r = String((e && (e.rp || e.rp_id || '')) || '').trim().toLowerCase();
            return !!(base && r && r === base);
          } catch(_) { return false; }
        };
        // まずは直近保存キャッシュから即時候補を提示
        try {
          const recent = Array.isArray(window.__tsu_pk_recent_entries) ? window.__tsu_pk_recent_entries : [];
          const recHits = recent.filter(e => {
            try {
              const r = String((e && (e.rp || e.rp_id || '')) || '').trim().toLowerCase();
              return !!(r && (r === rpId || r.endsWith('.' + rpId) || rpId.endsWith('.' + r)));
            } catch(_) { return false; }
          }).map(e => ({ id: e.id || '', title: e.title || e.name || '', rp: e.rp || e.rp_id || '' }));
          if (recHits.length) { addAll(recHits); finalize(merged); return; }
        } catch(_) {}
        runStage(exact, () => {
          // 完全一致があればそれだけで確定
          const exactOnly = merged.filter(isExactEntry);
          if (exactOnly.length > 0) { finalize(exactOnly); return; }
          runStage(suffix, () => {
            // まだ0件ならラベルキーワードでも検索
            if (merged.length === 0 && labelKeywords.length > 0) {
              runStage(labelKeywords, () => finalize(merged));
            } else {
              finalize(merged);
            }
          });
        });
      };
      const finalize = (list) => {
        if (rendered) return;
        let entries = [];
        try { entries = Array.isArray(list) ? list : []; } catch(_) { entries = []; }
        // 並び順: 完全一致 > サフィックス一致 > その他
        try {
          const base = String(rpId || '').trim().toLowerCase();
          const getRp = (e) => {
            try { return String((e && (e.rp || e.rp_id || '')) || '').trim().toLowerCase(); } catch(_) { return ''; }
          };
          const score = (e) => {
            try {
              const r = getRp(e);
              if (!r || !base) return 0;
              if (r === base) return 200;
              if (r.endsWith('.' + base)) return 120;
              if (base.endsWith('.' + r)) return 40; // 広め一致
              return 0;
            } catch(_) { return 0; }
          };
          entries.sort((a,b) => score(b) - score(a));
        } catch(_) {}
        const header = ''
          + '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">'
          +   '<div style="font-weight:600;">パスキー候補</div>'
          +   '<button id="tsu-pk-close" aria-label="閉じる" title="閉じる" style="border:none;background:transparent;color:#e8eaed;font-size:16px;line-height:1;cursor:pointer;padding:2px 6px;">×</button>'
          + '</div>';
        try {
          if (!entries.length) {
            box.innerHTML = header + '<div style="opacity:0.85">該当するパスキーが見つかりません</div>';
          } else {
            const items = entries.map((e, i) => {
              const t = (e && (e.title || e.name || e.rp || e.rp_id)) ? String(e.title || e.name || e.rp || e.rp_id) : '(no title)';
              return '<div class="tsu-item" data-idx="' + i + '">' + t.replace(/</g,'&lt;') + '</div>';
            }).join('');
            box.innerHTML = header + '<div style="display:flex;flex-direction:column;gap:2px;max-height:42vh;overflow:auto;">' + items + '</div>';
            // ホバー中のタイトルをページの入力欄へ反映
            try {
              const fillTitleInput = (text) => {
                try {
                  const d = box.ownerDocument || document;
                  const val = String(text || '');
                  const isTextEl = (el) => {
                    if (!el) return false;
                    const tn = (el.tagName || '').toLowerCase();
                    if (tn === 'input') {
                      const tp = (el.type || '').toLowerCase();
                      return ['text','search','email','url','tel','password'].includes(tp);
                    }
                    if (tn === 'textarea') return true;
                    if (el.isContentEditable) return true;
                    return false;
                  };
                  const setVal = (el) => {
                    try {
                      if (!el) return false;
                      if (el.isContentEditable) { el.textContent = val; }
                      else if (typeof el.value === 'string') { el.value = val; }
                      else return false;
                      try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch(_) {}
                      try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch(_) {}
                      return true;
                    } catch(_) { return false; }
                  };
                  // アクティブ要素を優先
                  const ae = d.activeElement;
                  if (isTextEl(ae) && !ae.readOnly && !ae.disabled) { if (setVal(ae)) return; }
                  // title を示唆する入力欄を優先して探索
                  const sel = [
                    'input[name*="title" i]:not([readonly]):not([disabled])',
                    'input[id*="title" i]:not([readonly]):not([disabled])',
                    'input[type="text"]:not([readonly]):not([disabled])',
                    'textarea:not([readonly]):not([disabled])',
                    '[contenteditable="true"]'
                  ].join(',');
                  const cand = Array.prototype.slice.call(d.querySelectorAll(sel));
                  for (const el of cand) { if (setVal(el)) return; }
                } catch(_) {}
              };
              const nodes = box.querySelectorAll('.tsu-item');
              nodes.forEach((node) => {
                try {
                  node.addEventListener('mouseenter', () => {
                    try {
                      const idx = parseInt(node.getAttribute('data-idx') || '-1', 10);
                      const e = (idx >= 0 && idx < entries.length) ? entries[idx] : null;
                      const t = e ? (e.title || e.name || e.rp || e.rp_id || '') : '';
                      if (t) fillTitleInput(String(t));
                    } catch(_) {}
                  }, { passive: true });
                  // クリック時: サイト側のパスキー認証をトリガ
                  node.addEventListener('click', (ev) => {
                    try { ev.preventDefault(); ev.stopPropagation(); } catch(_) {}
                    try { window.__tsu_suppress_until = Date.now() + 3000; } catch(_) {}
                    try { window.__tsu_pk_last_ts = Date.now(); } catch(_) {}
                    // 直接認証情報を指定する（ページの get() フックが allowCredentials に反映）
                    try {
                      const idx = parseInt(node.getAttribute('data-idx') || '-1', 10);
                      const e = (idx >= 0 && idx < entries.length) ? entries[idx] : null;
                      const clickedTitle = e ? String(e.title || e.name || e.rp || e.rp_id || '') : '';
                      const pickCredIdB64 = (o) => {
                        try {
                          if (!o || typeof o !== 'object') return '';
                          const cands = ['credential_id','credentialId','cred','raw_id','rawId','id'];
                          for (const k of cands) {
                            const v = o[k] != null ? o[k] : (o[k.toUpperCase ? k.toUpperCase() : k]);
                            if (!v) continue;
                            const s = String(v);
                            if (s.length > 10) return s;
                          }
                          return '';
                        } catch(_) { return ''; }
                      };
                      let credB64 = e ? pickCredIdB64(e) : '';
                      const rpId = (location && location.hostname) ? String(location.hostname) : '';
                      const setPref = (idb64) => {
                        try { window.postMessage({ __tsu: true, type: 'tsu:setPreferredCredential', credentialIdB64: idb64 || '', rpId }, '*'); } catch(_) {}
                      };
                      if (!credB64) {
                        // クリック後に詳細を再解決（CLI検索のエントリに credentialId が含まれていない場合があるため）
                        try {
                          const host = (window.tsupasswd && window.tsupasswd.host) || 'dev.happyfactory.tsupasswd';
                          sendWithPreflight({ type: 'RUN_TSUPASSWD', host, args: ['passkey', 'search', rpId, '--json'] }, (resp) => {
                            try {
                              const list = parseEntries(resp && (resp.data || resp));
                              const m = Array.isArray(list) ? list : [];
                              // タイトル完全一致 > rp完全一致の先頭
                              const exact = m.find((x) => {
                                try { return String(x && (x.title || x.name || '')) === clickedTitle; } catch(_) { return false; }
                              });
                              const picked = exact || m.find((x) => {
                                try { const r = String(x && (x.rp || x.rp_id || '')); return !!r && (r === rpId || r.endsWith('.'+rpId) || rpId.endsWith('.'+r)); } catch(_) { return false; }
                              }) || null;
                              const cid = picked ? pickCredIdB64(picked) : '';
                              credB64 = cid || '';
                            } catch(_) { credB64 = ''; }
                            try { setPref(credB64); } catch(_) {}
                            // 同期発火でユーザーアクティベーションを維持
                            try { window.dispatchEvent(new CustomEvent('tsu:triggerPasskeyLoginSync', { detail: { rpId } })); } catch(_) {}
                          });
                        } catch(_) { try { setPref(''); } catch(_) {} }
                      } else {
                        setPref(credB64);
                        // 同期発火でユーザーアクティベーションを維持
                        try { window.dispatchEvent(new CustomEvent('tsu:triggerPasskeyLoginSync', { detail: { rpId } })); } catch(_) {}
                      }
                    } catch(_) {}
                    // trigger は injected 側で setPreferredCredential 受信後に自動スケジュール
                    // 最後に候補ポップアップを閉じる
                    try { if (box && box.parentNode) box.parentNode.removeChild(box); } catch(_) {}
                  }, { capture: true });
                } catch(_) {}
              });
            } catch(_) {}
          }
          // 表示確定
          try { box.style.display = 'block'; place(); } catch(_) {}
        } catch(e) {
          // 異常時でも検索中で止まらないようにフォールバック描画
          try { box.innerHTML = '<div style="opacity:0.85;">候補の描画に失敗しました</div>'; box.style.display = 'block'; place(); } catch(_) {}
        } finally {
          rendered = true;
          try { box.setAttribute('data-rendered', '1'); } catch(_) {}
          // close ボタンバインドは最後に（可能なら）
          try {
            const closeBtn = box.querySelector('#tsu-pk-close');
            const onClose = (ev) => { try { ev.preventDefault(); ev.stopPropagation(); } catch(_) {} try { if (box && box.parentNode) box.parentNode.removeChild(box); } catch(_) {} };
            if (closeBtn) { closeBtn.addEventListener('click', onClose, { once: true }); closeBtn.addEventListener('pointerdown', onClose, { once: true }); }
          } catch(_) {}
        }
      };
      // グローバルなフォールバック: 一定時間応答が無い場合でもレンダリングを完了
      try {
        setTimeout(() => { try { if (!rendered) finalize(merged); } catch(_) {} }, 2200);
      } catch(_) {}
      // DOM レベルのウォッチドッグ: data-rendered が付かない場合は強制的に表示文言を更新
      try {
        setTimeout(() => {
          try {
            const ok = box && box.getAttribute && box.getAttribute('data-rendered') === '1';
            if (!ok && !rendered) {
              try { finalize(merged); } catch(_) {}
              // finalize が失敗した場合でもメッセージを更新
              try { if (!rendered) { box.innerHTML = '<div style="opacity:0.85;">該当するパスキーが見つかりません</div>'; box.style.display = 'block'; place(); } } catch(_) {}
            }
          } catch(_) {}
        }, 3000);
      } catch(_) {}
      runSearch();
      return box;
    } catch(_) { return null; }
  }

  // パスキー利用可否（キーワード判定）
  function isPasskeyCapable() {
    try {
      // 既に判定済みならそれを返す（多重呼び出しの無駄とログ連発を抑止）
      try {
        if (typeof window.__tsu_passkey_capable === 'boolean') {
          // ログは初回のみ
          if (!window.__tsu_pk_capability_logged) {
            try { console.info('[tsu] passkey capability(keyword)', { found: !!window.__tsu_passkey_capable }); } catch(_) {}
            try { window.__tsu_pk_capability_logged = true; } catch(_) {}
          }
          return Promise.resolve(!!window.__tsu_passkey_capable);
        }
      } catch(_) {}
      const parts = [];
      try { if (document && document.title) parts.push(String(document.title)); } catch(_) {}
      try { if (document && document.body && document.body.innerText) parts.push(String(document.body.innerText)); } catch(_) {}
      try {
        const metas = Array.prototype.slice.call(document.querySelectorAll('meta[name], meta[property], meta[content]'));
        metas.forEach(m => { try { const c = m.getAttribute('content'); if (c) parts.push(String(c)); } catch(_) {} });
      } catch(_) {}
      const haystack = parts.join('\n');
      // 英語/日本語の関連語を幅広く判定
      const patterns = [
        /passkey/i,
        /webauthn/i,
        /fido\s?2?/i,
        /security\s?key/i,
        /パスキー/i,
        /生体/i,
        /指紋/i,
        /顔認証/i,
        /セキュリティキー/i,
        /セキュリティ\s?キー/i
      ];
      const found = patterns.some((re) => {
        try { return re.test(haystack); } catch(_) { return false; }
      });
      // 判定結果をキャッシュし、ログは初回のみ
      try { window.__tsu_passkey_capable = !!found; } catch(_) {}
      try {
        if (!window.__tsu_pk_capability_logged) {
          console.info('[tsu] passkey capability(keyword)', { found });
          window.__tsu_pk_capability_logged = true;
        }
      } catch(_) {}
      return Promise.resolve(!!found);
    } catch(_) { return Promise.resolve(false); }
  }

  let presentAuthPopup = function(anchor) {
    try {
      // パスキー環境では従来ポップアップを出さず、候補一覧のみ表示
      try { if (isPasskeyEnvOn() || isPasskeyActiveNow()) { try { showPasskeyCandidatePopup(anchor); } catch(_) {} return null; } } catch(_) {}
      // パスキーが使用できる場合は、登録ボタンのみフック（自動表示はしない）
      try { isPasskeyCapable().then((ok) => { try { if (ok) { bindPasskeyRegisterButtons(); /* no auto show */ } } catch(_) {} }); } catch(_) {}
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
      sendWithPreflight({ type: 'RUN_TSUPASSWD', host, args: buildArgs(q) }, (resp) => {
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
      const title = (document && document.title) ? String(document.title) : '';
      queries = [urlStr, origin, hostOnly, title].filter(Boolean);
    } catch(_) {
      const title = (document && document.title) ? String(document.title) : '';
      queries = [urlStr, title].filter(Boolean);
    }
    try { queries = Array.from(new Set(queries)); } catch(_) {}
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
          const id = normalize(pick(item, ['id'])) || '';
          return { id, username: u, password: p, title, url };
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

        // 自動入力（候補が1件のみ & 未入力のとき）
        try {
          if (Array.isArray(entriesAll) && entriesAll.length === 1) {
            const only = entriesAll[0] || null;
            if (only) {
              const a = anchor;
              const form = a && (a.form || (a.closest && a.closest('form')));
              const scope = form || document;
              const ins = Array.prototype.slice.call(scope.querySelectorAll('input'));
              const uEl = ins.find(isUserLike) || null;
              const pEl = ins.find(isPassLike) || null;
              const uNow = (uEl && typeof uEl.value === 'string') ? String(uEl.value || '').trim() : '';
              const pNow = (pEl && typeof pEl.value === 'string') ? String(pEl.value || '').trim() : '';
              // 上書きはしない: 未入力のみ補完
              const uVal = (!uNow && only.username) ? String(only.username) : '';
              const pVal = (!pNow && only.password) ? String(only.password) : '';
              if (uVal || pVal) {
                forceApply(uEl, pEl, uVal || uNow, pVal || pNow);
              }
            }
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
        // 削除ボタンは使用しないため、関連UI/イベントは無し
        box.style.display = 'block';
        try { requestAnimationFrame(() => placePopup(anchor, box)); } catch(_) { placePopup(anchor, box); }
        try { scheduleAutoHide(6000); } catch(_) {}

        // 保存ボタン→保存フォームダイアログを開く
        const saveBtn = box.querySelector('#tsu-save-entry');
        if (saveBtn) {
          const onOpen = (ev) => { try { ev.preventDefault(); ev.stopPropagation(); } catch(_) {} openSaveDialog(anchor, '', ''); };
          saveBtn.addEventListener('click', onOpen, false);
          saveBtn.addEventListener('pointerdown', onOpen, false);
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

  // 一定時間操作が無い場合に自動で閉じる
  const scheduleAutoHide = function(ms) {
    try {
      const dur = (typeof ms === 'number' && ms > 0) ? ms : 6000;
      if (window.__tsu_auto_hide_timer) { try { clearTimeout(window.__tsu_auto_hide_timer); } catch(_) {} }
      window.__tsu_auto_hide_timer = setTimeout(function(){
        try { if (!dialogOpen && !window.__tsu_hovering_popup) hidePopup(false); } catch(_) {}
      }, dur);
    } catch(_) {}
  };

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
            // パスキー環境では従来ポップアップを出さない
            try { if (isPasskeyEnvOn() || isPasskeyActiveNow()) return; } catch(_) {}
            // パスキー有効時はクリックでも表示しない（チラつき防止）
            try {
              if (isPasskeyActiveNow()) {
                try { hidePopup(true); } catch(_) {}
                try { window.__tsu_suppress_until = Date.now() + 3000; } catch(_) {}
                return;
              }
            } catch(_) {}
            try {
              const f = user && (user.form || (user.closest && user.closest('form')));
              if (f && f.__tsuBound) return;
              if (f) f.__tsuBound = true;
            } catch(_) { return; }
            // パスキー環境では従来ポップアップを出さず候補一覧に切り替え
            try { if (isPasskeyEnvOn() || isPasskeyActiveNow()) { try { showPasskeyCandidatePopup(pickPreferredAnchor(user)); } catch(_) {} return; } } catch(_) {}
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
            // パスキー環境では従来ポップアップを出さず候補一覧に切り替え
            try { if (isPasskeyEnvOn() || isPasskeyActiveNow()) { try { showPasskeyCandidatePopup(pickPreferredAnchor(pass)); } catch(_) {} return; } } catch(_) {}
            // パスキー有効時はクリックでも表示しない
            try {
              if (typeof window.PublicKeyCredential === 'function' || isPasskeyActiveNow()) {
                try { hidePopup(true); } catch(_) {}
                try { window.__tsu_suppress_until = Date.now() + 3000; } catch(_) {}
                return;
              }
            } catch(_) {}
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
            const showOnClickU = function(){
              if (dialogOpen) return;
              // パスキー環境では従来ポップアップを出さず候補一覧に切り替え
              try { if (isPasskeyEnvOn() || isPasskeyActiveNow()) { try { showPasskeyCandidatePopup(pickPreferredAnchor(uEl)); } catch(_) {} return; } } catch(_) {}
              // パスキー有効時はクリックでも表示しない
              try {
                if (isPasskeyActiveNow()) {
                  try { hidePopup(true); } catch(_) {}
                  try { window.__tsu_suppress_until = Date.now() + 3000; } catch(_) {}
                  return;
                }
              } catch(_) {}
              const b = presentAuthPopup(pickPreferredAnchor(uEl)); attachBoxClick(b);
            };
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
            const showOnClickOnlyP = function(){
              if (dialogOpen) return;
              // パスキー環境では従来ポップアップを出さず候補一覧に切り替え
              try { if (isPasskeyEnvOn() || isPasskeyActiveNow()) { try { showPasskeyCandidatePopup(pickPreferredAnchor(pEl)); } catch(_) {} return; } } catch(_) {}
              // パスキー有効時はクリックでも表示しない
              try {
                if (typeof window.PublicKeyCredential === 'function' || isPasskeyActiveNow()) {
                  try { hidePopup(true); } catch(_) {}
                  try { window.__tsu_suppress_until = Date.now() + 3000; } catch(_) {}
                  return;
                }
              } catch(_) {}
              const b = presentAuthPopup(pickPreferredAnchor(pEl)); attachBoxClick(b);
            };
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
              // パスキー環境では従来ポップアップを出さない
              try { if (isPasskeyEnvOn() || isPasskeyActiveNow()) return; } catch(_) {}
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
            if (dialogOpen) {
              try {
                const box = document.getElementById('tsupasswd-inline-popup');
                const shown = !!(box && box.style && box.style.display !== 'none');
                if (!shown) { dialogOpen = false; } else { return; }
              } catch(_) { return; }
            }
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
            // 優先アンカーを決定し、まずパスキー環境なら必ず候補ポップを表示（抑止ガードより先に評価）
            const pref = pickPreferredAnchor(el);
            try {
              if (isPasskeyEnvOn() || isPasskeyActiveNow()) {
                try { window.__tsu_current_anchor = pref; } catch(_) {}
                try { showPasskeyCandidatePopup(pref); } catch(_) {}
                return;
              }
            } catch(_) {}
            // ここからは従来ポップアップ向けの抑止ガード
            // パスキー非発火時は suppress を解除して、クリックでも確実に表示できるようにする
            try { if (!isPasskeyActiveNow()) { window.__tsu_suppress_until = 0; } } catch(_) {}
            try { if ((window.__tsu_suppress_until && Date.now() < window.__tsu_suppress_until) || (window.__tsu_last_hidden_at && (Date.now() - window.__tsu_last_hidden_at) < 1500)) return; } catch(_) {}
            // 既に表示中かつロック中は、別要素（非優先アンカー）からのイベントを無視して揺れを防ぐ
            try {
              if (window.__tsu_current_anchor && window.__tsu_current_anchor !== pref) {
                // 異なるアンカーに移った場合は現在アンカーを更新して表示を許可
                window.__tsu_current_anchor = pref;
              }
            } catch(_) {}
            const b = presentAuthPopup(pref);
            attachBoxClick(b);
          } catch(_) {}
        };
        const onFocusIn = (e) => {
          try {
            if (dialogOpen) {
              try {
                const box = document.getElementById('tsupasswd-inline-popup');
                const shown = !!(box && box.style && box.style.display !== 'none');
                if (!shown) { dialogOpen = false; } else { return; }
              } catch(_) { return; }
            }
            // 直近パスキー発火時は従来ポップアップを抑止するが、候補一覧の表示は許可する（チラつきは抑止フラグで対応）
            try {
              if (isPasskeyActiveNow()) {
                try { hidePopup(true); } catch(_) {}
                try { window.__tsu_suppress_until = Date.now() + 1200; } catch(_) {}
              } else {
                // 抑止フラグを解除（再フォーカスで確実に表示）
                try { window.__tsu_suppress_until = 0; } catch(_) {}
              }
            } catch(_) {}
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
            // パスキー環境では一般のテキスト入力でも候補を許可
            if (!(el && (userLikeEl || passLikeEl)) && !(isPasskeyEnvOn() || isPasskeyActiveNow())) return;
            const pref = pickPreferredAnchor(el);
            // まずパスキー環境なら抑止ガードより先に候補一覧を必ず表示
            try {
              if (isPasskeyEnvOn() || isPasskeyActiveNow()) {
                try { window.__tsu_current_anchor = pref; } catch(_) {}
                try { showPasskeyCandidatePopup(pref); } catch(_) {}
                return;
              }
            } catch(_) {}
            // ここからは従来ポップアップ向けの抑止ガード（パスワード欄はバイパス）
            {
              let guarded = false;
              try { guarded = !!((window.__tsu_suppress_until && Date.now() < window.__tsu_suppress_until) || (window.__tsu_last_hidden_at && (Date.now() - window.__tsu_last_hidden_at) < 1500)); } catch(_) {}
              if (guarded && !passLikeEl) return;
            }
            // 現在アンカーを無条件に更新
            try { window.__tsu_current_anchor = pref; } catch(_) {}
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
            // 直近パスキー発火時はキー入力表示を抑止（チラつき防止）
            try { if (isPasskeyActiveNow()) return; } catch(_) {}
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
            // パスキー環境では従来ポップアップを出さない
            try { if (isPasskeyEnvOn() || isPasskeyActiveNow()) return; } catch(_) {}
            try { if (isPasskeyEnvOn() || isPasskeyActiveNow()) return; } catch(_) {}
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
      try { bindPasskeyRegisterButtons(); } catch(_) {}
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
            try { bindPasskeyRegisterButtons(); } catch(_) {}
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
