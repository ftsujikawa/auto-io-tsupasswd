;(function () {
  try {
    // 早期return前にAPIスタブを常時公開（既にフック済みでも利用可能にする）
    const __publishACB = (fn) => {
      try { if (typeof window !== 'undefined') window.__tsu_allowConditionalBrief = fn; } catch(_) {}
      try { if (typeof self !== 'undefined') self.__tsu_allowConditionalBrief = fn; } catch(_) {}
      try { if (typeof globalThis !== 'undefined') globalThis.__tsu_allowConditionalBrief = fn; } catch(_) {}
      try { if (window && window.top && window.top !== window) { try { window.top.__tsu_allowConditionalBrief = fn; } catch(_) {} } } catch(_) {}
    };
    try {
      if (typeof window.__tsu_allowConditionalBrief !== 'function') {
        const __acb = function(ms){
          try {
            const d = Math.max(0, Number(ms || 2500));
            window.__tsu_cond_ok_until = Date.now() + d;
            try { console.info('[tsu] injected: conditional allow window set', { ms: d }); } catch(_) {}
          } catch(_) {}
        };
        __publishACB(__acb);
      }
    } catch(_) {}
    // コンソールが別の実行ワールドでも操作できるよう postMessage で制御可能にする
    try {
      if (!window.__tsu_msg_handler_installed) {
        window.__tsu_msg_handler_installed = true;
        window.addEventListener('message', (ev) => {
          try {
            if (!ev || ev.source !== window) return;
            const d = ev.data || {};
            if (!d || d.__tsu !== true) return;
            if (d.cmd === 'allowConditional') {
              try {
                const ms = Math.max(0, Number(d.ms || 2500));
                window.__tsu_cond_ok_until = Date.now() + ms;
                try { console.info('[tsu] injected: conditional allow window set (msg)', { ms }); } catch(_) {}
              } catch(_) {}
              return;
            }
            if (d.cmd === 'setAuto') {
              try {
                const v = !!d.on;
                if (typeof window.__tsu_setAutoEnabled === 'function') {
                  window.__tsu_setAutoEnabled(v);
                } else {
                  window.__tsu_auto_enabled = v;
                  try { console.info('[tsu] injected: autoEnabled =', v, '(msg-direct)'); } catch(_) {}
                }
              } catch(_) {}
              return;
            }
            if (d.cmd === 'oneShotRecover') {
              try {
                const ms = Math.max(1000, Number(d.ms || 4000));
                if (typeof window.__tsu_oneShotRecover === 'function') {
                  window.__tsu_oneShotRecover(ms);
                }
              } catch(_) {}
              return;
            }
          } catch(_) {}
        });
      }
    } catch(_) {}
    if (window.__tsu_webauthn_page_hooked || !navigator || !navigator.credentials) return;
    window.__tsu_webauthn_page_hooked = true;
    window.__tsu_pk_cache = window.__tsu_pk_cache || {};
    try { if (!Array.isArray(window.__tsu_pk_cache.postLogs)) window.__tsu_pk_cache.postLogs = []; } catch(_) {}

    const b64u = (buf) => {
      try {
        return btoa(String.fromCharCode.apply(null, new Uint8Array(buf)))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/g, '');
      } catch (_) {
        return '';
      }
    };

    // --- Helpers: (prefixed) toU8, minimal CBOR decode, parseAttestation ---
    function __tsu_toU8(buf) {
      try { return buf instanceof Uint8Array ? buf : new Uint8Array(buf); } catch(_) { return new Uint8Array(0); }
    }
    function __tsu_cborDecodeItem(u8, offset) {
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
        throw new Error('CBOR: indef/reserved');
      };
      if (major === 0) { const v = readAddl(); return { value: v, length: pos - offset }; }
      if (major === 1) { const v = readAddl(); return { value: -1 - v, length: pos - offset }; }
      if (major === 2) { const l = readAddl(); if (pos + l > len) throw new Error('CBOR: bytes OOB'); const val = u8.slice(pos, pos+l); pos += l; return { value: val, length: pos - offset }; }
      if (major === 3) { const l = readAddl(); if (pos + l > len) throw new Error('CBOR: text OOB'); const td = new TextDecoder('utf-8'); const val = td.decode(u8.slice(pos, pos+l)); pos += l; return { value: val, length: pos - offset }; }
      if (major === 4) { const l = readAddl(); const arr = []; for (let i=0;i<l;i++) { const it = __tsu_cborDecodeItem(u8, pos); arr.push(it.value); pos += it.length; } return { value: arr, length: pos - offset }; }
      if (major === 5) { const l = readAddl(); const obj = {}; for (let i=0;i<l;i++) { const k = __tsu_cborDecodeItem(u8, pos); pos += k.length; const v = __tsu_cborDecodeItem(u8, pos); pos += v.length; obj[k.value] = v.value; } return { value: obj, length: pos - offset }; }
      if (major === 6) { /* tag */ const inner = __tsu_cborDecodeItem(u8, pos); pos += inner.length; return { value: inner.value, length: pos - offset }; }
      if (major === 7) { return { value: null, length: pos - offset }; }
      throw new Error('CBOR: unknown major');
    }
    function __tsu_parseAttestation(u8) {
      try {
        const top = __tsu_cborDecodeItem(u8, 0).value; // map
        const authData = top && top.authData ? __tsu_toU8(top.authData) : null;
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
        // credentialPublicKey (CBOR). Decode to get its length and slice raw bytes
        const pkItem = __tsu_cborDecodeItem(authData, p);
        const raw = authData.slice(p, p + pkItem.length);
        return { signCount, publicKeyRaw: raw };
      } catch(_) { return null; }
    }

  // 条件付きUIの不要表示を抑止するための許可ウィンドウ管理
  try {
    if (typeof window.__tsu_cond_ok_until !== 'number') window.__tsu_cond_ok_until = 0;
  } catch(_) {}
  function isTextLike(el) {
    try {
      if (!el) return false;
      const tn = (el.tagName || '').toLowerCase();
      if (tn === 'textarea') return true;
      if (tn === 'input') {
        const tp = (el.type || '').toLowerCase();
        return !tp || tp === 'text' || tp === 'email' || tp === 'search' || tp === 'url' || tp === 'password';
      }
      if (el.isContentEditable) return true;
    } catch(_) {}
    return false;
  }
  function allowConditionalBrief(ms) {
    try {
      const d = Math.max(0, Number(ms || 2500));
      const till = Date.now() + d;
      window.__tsu_cond_ok_until = till;
      try { console.info('[tsu] injected: conditional allow window set', { ms: d }); } catch(_) {}
    } catch(_) {}
  }
  // ユーザーがテキスト入力にフォーカスした際のみ、短時間だけ条件付きUIを許可
  try {
    document.addEventListener('focusin', (ev) => {
      try {
        const t = ev && ev.target;
        function nudgeConditionalUI() {
      try { if (!autoEnabled()) { return; } } catch(_) {}
      try { if (inBootQuiet()) { console.info('[tsu] injected: skip conditional UI nudge (boot quiet)'); return; } } catch(_) {}
      try {
        // focus/click/input で条件付きUIを促す
        const ae = document.activeElement;
        if (isTextLike(ae)) {
          if (inBootQuiet()) { try { console.info('[tsu] injected: skip allow window (boot quiet)'); } catch(_) {} return; }
          allowConditionalBrief(2500);
        }
      } catch(_) {}
    }
    if (isTextLike(t)) {
      nudgeConditionalUI();
    }
      } catch(_) {}
    }, true);
  } catch(_) {}
  try { __publishACB(allowConditionalBrief); } catch(_) {}

  // ワンショット復旧API
  try {
    window.__tsu_oneShotRecover = async function(ms) {
      try {
        const allowMs = Math.max(1000, Number(ms || 4000));
        // 明示ON
        try { window.__tsu_auto_enabled = true; } catch(_) {}
        // 当方扱い＋キャンセルガードON
        try { window.__tsu_pk_ours = true; } catch(_) {}
        try { window.__tsu_cancel_guard_on = true; } catch(_) {}
        // 許可ウィンドウ確保
        try { window.__tsu_cond_ok_until = Date.now() + allowMs; console.info('[tsu] injected: oneShot allow window', { ms: allowMs }); } catch(_) {}
        // guarded ESC（可能なら）
        try { if (typeof window.__tsu_guardedEsc === 'function') await window.__tsu_guardedEsc(); } catch(_) {}
        // 微待機してから強行テイクオーバー
        await new Promise(r => setTimeout(r, 120));
        try { if (typeof window.__tsu_startHardTakeover === 'function') await window.__tsu_startHardTakeover('oneShot', true); } catch(_) {}
      } catch(_) {}
      finally {
        try { setTimeout(() => { try { window.__tsu_cancel_guard_on = false; window.__tsu_pk_ours = false; console.info('[tsu] injected: oneShot guard released'); } catch(_) {} }, 5000); } catch(_) {}
      }
    };
  } catch(_) {}

  // マスター自動挙動スイッチ（初期OFF）
  try { if (typeof window.__tsu_auto_enabled === 'undefined') window.__tsu_auto_enabled = false; } catch(_) {}
  function autoEnabled() {
    try { return window.__tsu_auto_enabled === true; } catch(_) { return false; }
  }
  try {
    if (typeof window.__tsu_auto_enabled_prev === 'undefined') window.__tsu_auto_enabled_prev = window.__tsu_auto_enabled;
    if (typeof window.__tsu_auto_log_ts === 'undefined') window.__tsu_auto_log_ts = 0;
  } catch(_) {}
  try {
    window.__tsu_setAutoEnabled = (on) => {
      try {
        const v = !!on;
        const prev = !!window.__tsu_auto_enabled_prev;
        window.__tsu_auto_enabled = v;
        const now = Date.now();
        const shouldLog = (v !== prev) || (now - (window.__tsu_auto_log_ts || 0) > 5000);
        if (shouldLog) {
          window.__tsu_auto_log_ts = now;
          window.__tsu_auto_enabled_prev = v;
          console.info('[tsu] injected: autoEnabled =', v);
        }
      } catch(_) {}
    };
  } catch(_) {}

  // 初期状態では ESC 系の解雇は無効（リロード直後の誤発火抑止）
  try { if (typeof window.__tsu_pk_no_esc_dismiss === 'undefined') window.__tsu_pk_no_esc_dismiss = true; } catch(_) {}
  // リロード直後の静穏期間（条件付きUI/ESC/テイクオーバーを完全抑止）
  try { if (!window.__tsu_boot_quiet_until) window.__tsu_boot_quiet_until = Date.now() + 3500; } catch(_) {}
  function inBootQuiet() {
    try { const t = Number(window.__tsu_boot_quiet_until || 0); return !!t && Date.now() < t; } catch(_) { return false; }
  }
   function isTextEditable(el) { try { if (!el || !(el instanceof HTMLElement)) return false; const tag = (el.tagName||'').toLowerCase(); if (tag === 'input') { const t = (el.getAttribute('type')||'text').toLowerCase(); return ['text','email','search','url','tel','password'].includes(t); } return tag === 'textarea' || el.isContentEditable === true; } catch(_) { return false; } }
   function conditionalAllowedNow() { try { const okUntil = Number(window.__tsu_cond_ok_until || 0); if (okUntil && Date.now() < okUntil) return true; if (inBootQuiet()) return false; const a = document && document.activeElement; const vis = (document.visibilityState||'visible') === 'visible'; if (!vis) return false; if (isTextEditable(a)) return true; return false; } catch(_) { return false; } }
   function conditionalGraceActive() { try { const now = Date.now(); const det = Number(window.__tsu_pk_cond_detect_ts || 0); const recentDetect = det && (now - det) < 6000; const a = document && document.activeElement; const focused = isTextEditable(a); return !!(recentDetect || focused); } catch(_) { return false; } }
   try { window.__tsu_dumpPasskeyState = function(){ try { return { now: Date.now(), condOkUntil: Number(window.__tsu_cond_ok_until||0), bootQuietUntil: Number(window.__tsu_boot_quiet_until||0), condDetectTs: Number(window.__tsu_pk_cond_detect_ts||0), isConditional: !!window.__tsu_pk_is_conditional, preferFallback: !!window.__tsu_pk_prefer_fallback, cancelGuard: !!window.__tsu_cancel_guard_on, quietUntil: Number(window.__tsu_pk_quiet_until||0), inflight: !!window.__tsu_pk_get_inflight, depth: Number(window.__tsu_pk_get_depth||0) }; } catch(_) { return {}; } }; } catch(_) {}
   try { if (!window.__tsu_cond_ok_until) { try { document.addEventListener('focusin', function(ev){ try { const t = ev && ev.target; if (isTextEditable(t)) window.__tsu_cond_ok_until = Date.now() + 120000; } catch(_) {} }, true); } catch(_) {} try { document.addEventListener('keydown', function(){ try { const a = document && document.activeElement; if (isTextEditable(a)) window.__tsu_cond_ok_until = Date.now() + 120000; } catch(_) {} }, true); } catch(_) {} } } catch(_) {}
  // 条件付きUIを明示的に閉じるナッジ（Esc）
    function dismissConditionalUI(force) {
      try {
        try { if (!autoEnabled()) { return; } } catch(_) {}
        try { if (inBootQuiet() && force !== true) { console.info('[tsu] injected: ESC dismiss skipped (boot quiet)'); return; } } catch(_) {}
        try {
          if (window.__tsu_pk_no_esc_dismiss === true && force !== true) {
            console.info('[tsu] injected: ESC dismiss skipped by flag');
            return;
          }
        } catch(_) {}
        // UI クールダウン中は強制/通常どちらもフォールバックを抑止（OS UI 二重表示防止）
        try {
          const cool = Number(window.__tsu_pk_ui_cool_until || 0);
          if (cool && Date.now() < cool) {
            console.info('[tsu] injected: triggerLoginFallback skipped (ui cooldown active)');
            return;
          }
        } catch(_) {}
        const w = window;
        const d = document;
        const mk = (type) => { try { return new KeyboardEvent(type, { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true }); } catch(_) { return null; } };
        // window/document へ先に送出
        try { if (w && w.dispatchEvent) { const e1 = mk('keydown'); const e2 = mk('keyup'); e1 && w.dispatchEvent(e1); e2 && w.dispatchEvent(e2); } } catch(_) {}
        try { if (d && d.dispatchEvent) { const e1 = mk('keydown'); const e2 = mk('keyup'); e1 && d.dispatchEvent(e1); e2 && d.dispatchEvent(e2); } } catch(_) {}
        // activeElement がテキスト系なら限定的に送出
        try {
          const a = d.activeElement;
          const isTextInput = (el) => { try { if (!el || !(el instanceof HTMLElement)) return false; const tag = (el.tagName||'').toLowerCase(); if (tag === 'input') { const t = (el.getAttribute('type')||'text').toLowerCase(); return ['text','email','search','url','tel','password'].includes(t); } return tag === 'textarea' || el.isContentEditable === true; } catch(_) { return false; } };
          try { if (a && typeof a.blur === 'function') a.blur(); } catch(_) {}
          if (a && a.dispatchEvent && isTextInput(a)) { const e1 = mk('keydown'); const e2 = mk('keyup'); e1 && a.dispatchEvent(e1); e2 && a.dispatchEvent(e2); }
        } catch(_) {}
        try { console.info('[tsu] injected: conditional UI dismiss ESC applied'); } catch(_) {}
      } catch(_) {}
    }

    // ガード付きESC（ESC送出前後に一時的に error リスナーをキャプチャ登録し、ホスト側の例外を抑止）
    async function guardedEscOnce() {
      try {
        try { if (window.__tsu_allow_guarded_esc !== true) { console.info('[tsu] injected: guarded ESC disabled'); return false; } } catch(_) {}
        try { if (!autoEnabled()) { return false; } } catch(_) {}
        try { if (inBootQuiet()) { return false; } } catch(_) {}
        try {
          // 許可ウィンドウ外かつ prefer_fallback でない場合は ESC を行わない
          if (window.__tsu_pk_no_esc_dismiss === true && window.__tsu_pk_prefer_fallback !== true) {
            console.info('[tsu] injected: guarded ESC skip (policy)');
            return false;
          }
          if (typeof conditionalAllowedNow === 'function') {
            const allowed = conditionalAllowedNow();
            if (!allowed && window.__tsu_pk_prefer_fallback !== true) {
              console.info('[tsu] injected: guarded ESC skip (not allowed)');
              return false;
            }
          }
        } catch(_) {}
        try {
          if (window.__tsu_guarded_esc_active) { console.info('[tsu] injected: guarded ESC skip (active)'); return false; }
          const last = Number(window.__tsu_guarded_esc_last_ts || 0);
          if (last && (Date.now() - last) < 1500) { return false; }
          window.__tsu_guarded_esc_active = true; window.__tsu_guarded_esc_last_ts = Date.now();
        } catch(_) {}
        let removed = false;
        const handler = (ev) => {
          try {
            const msg = (ev && ev.message) || '';
            const src = (ev && ev.filename) || '';
            // s2k-listener の match 例外などを抑止
            if (/match/.test(String(msg)) || /s2k-listener\.js/.test(String(src||''))) {
              try { ev.preventDefault && ev.preventDefault(); } catch(_) {}
              try { ev.stopImmediatePropagation && ev.stopImmediatePropagation(); } catch(_) {}
              return true;
            }
          } catch(_) {}
          return false;
        };
        const rejHandler = (ev) => {
          try {
            const r = ev && ev.reason;
            const msg = (r && (r.message || r.toString && r.toString())) || '';
            if (/match/.test(String(msg)) || /s2k-listener\.js/.test(String(msg||''))) {
              try { ev.preventDefault && ev.preventDefault(); } catch(_) {}
              try { ev.stopImmediatePropagation && ev.stopImmediatePropagation(); } catch(_) {}
              return true;
            }
          } catch(_) {}
          return false;
        };
        try { window.addEventListener('error', handler, true); } catch(_) {}
        try { window.addEventListener('unhandledrejection', rejHandler, true); } catch(_) {}
        // window.onerror を一時的に上書きしてコンソールへの未捕捉を抑止
        let restored = false; let prevOnError = null;
        try { prevOnError = window.onerror; window.onerror = function(){ return true; }; } catch(_) {}
        // ESC を2回、120ms間隔で送出（active要素へのキー送出は抑制済み実装）
        try { dismissConditionalUI(true); } catch(_) {}
        try { setTimeout(() => { try { dismissConditionalUI(true); } catch(_) {} }, 120); } catch(_) {}
        // 監視ウィンドウを延長してホスト側例外の未捕捉を抑止
        await new Promise(r => setTimeout(r, 1000));
        if (!removed) {
          try { window.removeEventListener('error', handler, true); } catch(_) {}
          try { window.removeEventListener('unhandledrejection', rejHandler, true); } catch(_) {}
          removed = true;
        }
        try { if (!restored) { window.onerror = prevOnError; restored = true; } } catch(_) {}
        try { console.info('[tsu] injected: guarded ESC applied'); } catch(_) {}
        return true;
      } catch(_) { return false; }
      finally { try { window.__tsu_guarded_esc_active = false; } catch(_) {} }
    }
    try { window.__tsu_guardedEsc = guardedEscOnce; } catch(_) {}

    // ハードテイクオーバー: サイトの in-flight 固着時に当方の get() を直接起動
    async function startHardTakeover(reason, force) {
      try {
        try { if (!autoEnabled()) { return false; } } catch(_) {}
        try { if (inBootQuiet() && window.__tsu_pk_prefer_fallback !== true) { console.info('[tsu] injected: takeover skip (boot quiet)'); return false; } } catch(_) {}
        try {
          if (!conditionalAllowedNow() && window.__tsu_pk_prefer_fallback !== true) {
            console.info('[tsu] injected: takeover skip (not allowed)');
            return false;
          }
        } catch(_) {}
        // OS UI の二重表示抑止: 直近の get() 起動直後はテイクオーバーを抑止
        try {
          const cool = Number(window.__tsu_pk_ui_cool_until || 0);
          if (cool && Date.now() < cool) {
            console.info('[tsu] injected: takeover skip (ui cooldown active)');
            return false;
          }
        } catch(_) {}
        // フラグセット（strict保護/所有化）
        try { if (window.__tsu_disable_prefer_fallback === true) { console.info('[tsu] injected: prefer_fallback auto-enable skipped by flag'); } else { window.__tsu_pk_prefer_fallback = true; } } catch(_) {}
        try { window.__tsu_pk_takeover = true; window.__tsu_pk_ours = true; if (!window.__tsu_pk_force_strict_ts) window.__tsu_pk_force_strict_ts = Date.now(); } catch(_) {}
        // prefer_fallback期間はエラーシールドを有効化
        try { if (typeof installErrorShield === 'function') installErrorShield(); } catch(_) {}
        try { if (window.__tsu_disable_conditional_fake === true) { console.info('[tsu] injected: conditional availability disable skipped by flag'); } else { ensureDisableConditionalAvail(); } } catch(_) {}
        try { installErrorShield(); } catch(_) {}
        // 既に get が進行中なら衝突を避けるため待機し、解消しない場合は後で再試行
        try {
          if (window.__tsu_pk_get_inflight) {
            const start = Date.now();
            const cap = 5000;
            while (window.__tsu_pk_get_inflight && (Date.now() - start) < cap) { await new Promise(r => setTimeout(r, 50)); }
            if (window.__tsu_pk_get_inflight) {
              console.info('[tsu] injected: hard takeover deferred due to inflight');
              // prefer_fallback 中で inflight が長時間継続する場合はフラグを強制解除してループを断つ
              try {
                const since = Number(window.__tsu_pk_inflight_since || 0);
                const age = since ? (Date.now() - since) : 0;
                if (window.__tsu_pk_prefer_fallback === true && age > 3500) {
                  console.info('[tsu] injected: inflight force-clear due to prefer_fallback age', { ageMs: age });
                  try { window.__tsu_pk_get_inflight = false; } catch(_) {}
                  try {
                    window.__tsu_cancel_guard_on = true;
                    setTimeout(() => { try { window.__tsu_cancel_guard_on = false; } catch(_) {} }, 3000);
                  } catch(_) {}
                }
              } catch(_) {}
              try {
                const cnt = Number(window.__tsu_pk_takeover_defer_count || 0) + 1;
                window.__tsu_pk_takeover_defer_count = cnt;
                // 2回以上連続で defer したら、ガード付きESCを一度だけ送出して pending を崩す
                if (cnt >= 2) {
                  try {
                    if (!window.__tsu_guarded_esc_active) { await guardedEscOnce(); }
                  } catch(_) {}
                  try { window.__tsu_pk_takeover_defer_count = 0; } catch(_) {}
                  // ESC後、inflight=false を確認してから一度だけ起動（80ms間隔で最大2.5sチェック）。進捗ログを出す。
                  try {
                    const start2 = Date.now();
                    let fired = false;
                    let lastLog = 0;
                    try { console.info('[tsu] injected: post-guard inflight monitor start'); } catch(_) {}
                    const mini = () => {
                      try {
                        if (fired) return;
                        const elapsed = Date.now() - start2;
                        if (elapsed > 2500) {
                          try { console.info('[tsu] injected: post-guard inflight monitor give up (still inflight)'); } catch(_) {}
        try { queueMicrotask(() => { try { startHardTakeover('monitor-giveup', true); } catch(_) {} }); } catch(_) {}
                          // 最後に一度だけ試行してエラー/状態を可視化
                          fired = true;
                          startHardTakeover(reason+'-retry-esc-late');
                          return;
                        }
                        if (window.__tsu_pk_get_inflight) {
                          if (!lastLog || (elapsed - lastLog) > 320) { try { console.info('[tsu] injected: inflight still true', { elapsedMs: elapsed }); } catch(_) {} lastLog = elapsed; }
                          setTimeout(mini, 80); return;
                        }
                        fired = true;
                        startHardTakeover(reason+'-retry-esc');
                      } catch(_) {}
                    };
                    mini();
                  } catch(_) {}
                  return false;
                }
                // 代替: 待機時間を延ばし、バックオフにジッタを追加
                const base = 900;
                const jitter = Math.floor(Math.random() * 500);
                setTimeout(() => { try { startHardTakeover(reason+'-retry'); } catch(_) {} }, base + jitter);
              } catch(_) {}
              return false;
            }
          }
        } catch(_) {}
        // 直近 options/publicKey を確保
        const lastOpts = window.__tsu_pk_last_options;
        const lastPub = window.__tsu_pk_last_pubkey;
        let opts = lastOpts ? Object.assign({}, lastOpts) : (lastPub ? { publicKey: lastPub } : null);
        if (!opts || !opts.publicKey) {
          try { console.info('[tsu] injected: hard takeover aborted (no last options/publicKey)', { reason }); } catch(_) {}
          return false;
        }
        // mediation を required に強制
        try { opts.mediation = 'required'; } catch(_) {}
        // 実行
        try { console.info('[tsu] injected: hard takeover get start', { reason }); } catch(_) {}
        const cred = await navigator.credentials.get(opts);
        try { console.info('[tsu] injected: hard takeover get resolved'); } catch(_) {}
        return !!cred;
      } catch(e) {
        try { console.warn('[tsu] injected: hard takeover get error', e && e.name, e && e.message); } catch(_) {}
        return false;
      } finally { try { window.__tsu_pk_takeover = false; } catch(_) {} }
    }
    try { window.__tsu_startHardTakeover = startHardTakeover; } catch(_) {}

    const origCreate = navigator.credentials.create.bind(navigator.credentials);
    const origGet = navigator.credentials.get.bind(navigator.credentials);
    const post = (cache) => {
      try { window.postMessage({ __tsu: true, type: 'tsu:passkeyCaptured', cache }, '*'); } catch (_) {}
    };

    // prefer_fallback 中の恒久エラーシールド（s2k-listener系の例外を抑止）
    function installErrorShield() {
      try {
        if (window.__tsu_err_shield_on) return;
        const errH = (ev) => {
          try {
            const msg = (ev && ev.message) || '';
            const src = (ev && ev.filename) || '';
            if (/match/.test(String(msg)) || /s2k-listener\.js/.test(String(src||''))) {
              try { ev.preventDefault && ev.preventDefault(); } catch(_) {}
              try { ev.stopImmediatePropagation && ev.stopImmediatePropagation(); } catch(_) {}
              return true;
            }
          } catch(_) {}
          return false;
        };
        const rejH = (ev) => {
          try {
            const r = ev && ev.reason;
            const msg = (r && (r.message || (r.toString && r.toString()))) || '';
            if (/match/.test(String(msg)) || /s2k-listener\.js/.test(String(msg||''))) {
              try { ev.preventDefault && ev.preventDefault(); } catch(_) {}
              try { ev.stopImmediatePropagation && ev.stopImmediatePropagation(); } catch(_) {}
              return true;
            }
          } catch(_) {}
          return false;
        };
        window.addEventListener('error', errH, true);
        try { document.addEventListener('error', errH, true); } catch(_) {}
        window.addEventListener('unhandledrejection', rejH, true);
        window.__tsu_err_shield_on = true;
        window.__tsu_err_shield_errH = errH;
        window.__tsu_err_shield_rejH = rejH;
        // window.onerror を prefer_fallback 中は抑止へ（復元用に保存）
        try { window.__tsu_err_prev_onerror = window.onerror; window.onerror = function(){ return true; }; } catch(_) {}
        try { console.info('[tsu] injected: global error shield installed'); } catch(_) {}
      } catch(_) {}
    }
    function uninstallErrorShield() {
      try {
        if (!window.__tsu_err_shield_on) return;
        const errH = window.__tsu_err_shield_errH;
        const rejH = window.__tsu_err_shield_rejH;
        try { errH && window.removeEventListener('error', errH, true); } catch(_) {}
        try { errH && document.removeEventListener('error', errH, true); } catch(_) {}
        try { rejH && window.removeEventListener('unhandledrejection', rejH, true); } catch(_) {}
        window.__tsu_err_shield_on = false;
        window.__tsu_err_shield_errH = null;
        window.__tsu_err_shield_rejH = null;
        try { const prev = window.__tsu_err_prev_onerror; window.onerror = prev || null; window.__tsu_err_prev_onerror = null; } catch(_) {}
        try { console.info('[tsu] injected: global error shield removed'); } catch(_) {}
      } catch(_) {}
    }

    // 簡易トースト表示（アサーション送信検知の可視化）
    function showTsuToast(message) {
      try {
        const id = '__tsu_toast';
        let box = document.getElementById(id);
        if (!box) {
          box = document.createElement('div');
          box.id = id;
          box.style.position = 'fixed';
          box.style.top = '12px';
          box.style.right = '12px';
          box.style.zIndex = '2147483647';
          box.style.fontFamily = 'system-ui, sans-serif';
          document.documentElement.appendChild(box);
        }
        const item = document.createElement('div');
        item.textContent = message;
        item.style.background = 'rgba(0,0,0,0.8)';
        item.style.color = '#fff';
        item.style.padding = '8px 10px';
        item.style.marginTop = '6px';
        item.style.borderRadius = '6px';
        item.style.fontSize = '12px';
        item.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
        box.appendChild(item);
        setTimeout(() => { try { item.remove(); if (!box.childElementCount) box.remove(); } catch(_) {} }, 2500);
      } catch(_) {}
    }

    // 直近送信アサーションのメタ確認API
    try {
      window.__tsu_getLastAssertionMeta = function() { try { return (window.__tsu_pk_cache && window.__tsu_pk_cache.lastSentAssertionMeta) || null; } catch(_) { return null; } };
    } catch(_) {}
    // POST観測ログAPI
    try {
      window.__tsu_getPostLog = function(){ try { return (window.__tsu_pk_cache && window.__tsu_pk_cache.postLogs) || []; } catch(_) { return []; } };
    } catch(_) {}

    // transports 正規化ヘルパ（順序維持 + 重複除去 + 許容値のみ + 補完）
    function __tsu_normalizeTransports(input, attachHint) {
      try {
        const allowed = ['internal','hybrid','usb','nfc','ble'];
        const seen = new Set();
        const out = [];
        const pushIfValid = (v) => {
          try {
            const s = String(v||'').toLowerCase().trim();
            if (!s) return;
            if (!allowed.includes(s)) return;
            if (seen.has(s)) return;
            seen.add(s); out.push(s);
          } catch(_) {}
        };
        if (Array.isArray(input)) {
          for (const v of input) pushIfValid(v);
        } else if (typeof input === 'string') {
          String(input).split(',').forEach(pushIfValid);
        }
        // authenticatorAttachment からの推測（platform => internal）。元配列の順序は維持しつつ、未含有なら末尾に補完。
        try { if (attachHint === 'platform' && !seen.has('internal')) { seen.add('internal'); out.push('internal'); } } catch(_) {}
        return out.join(',');
      } catch(_) { return ''; }
    }

    // prefer_fallback 中は conditional 利用可否を false に偽装して、サイトの conditional UI 起動を抑止
    function ensureDisableConditionalAvail() {
      try {
        if (window.__tsu_cond_avail_disabled) return;
        window.__tsu_cond_avail_disabled = true;
        // PublicKeyCredential.isConditionalMediationAvailable を常に false にする
        try {
          const PKC = window.PublicKeyCredential;
          if (PKC && typeof PKC.isConditionalMediationAvailable === 'function') {
            const orig = PKC.isConditionalMediationAvailable.bind(PKC);
            window.__tsu_orig_isCondAvail = orig;
            PKC.isConditionalMediationAvailable = function(){ try { return Promise.resolve(false); } catch(_) { return Promise.resolve(false); } };
          }
        } catch(_) {}
        // navigator.credentials.get で mediation=conditional を required に強制（保険）
        try {
          const nc = navigator.credentials;
          if (nc && typeof nc.get === 'function' && !nc.__tsu_cond_to_required_wrapped) {
            nc.__tsu_cond_to_required_wrapped = true;
            const og = nc.get.bind(nc);
            nc.get = function(opts){
              try { if (opts && opts.mediation === 'conditional') opts.mediation = 'required'; } catch(_) {}
              return og(opts);
            };
          }
        } catch(_) {}
        try { console.info('[tsu] injected: conditional availability disabled'); } catch(_) {}
      } catch(_) {}
    }

    // --- Network probe: detect if WebAuthn assertion is sent to server ---
    function installNetworkProbe() {
      try {
        if (window.__tsu_net_probe_installed) return;
        window.__tsu_net_probe_installed = true;
        // 共通レコーダ
        const recordPost = (info) => {
          try {
            const arr = (window.__tsu_pk_cache && window.__tsu_pk_cache.postLogs) || [];
            const entry = { when: Date.now(), via: info.via || '', url: info.url || '', method: (info.method||'').toUpperCase(), matched: !!info.matched };
            arr.push(entry);
            while (arr.length > 50) arr.shift();
            try { window.__tsu_pk_cache.postLogs = arr; } catch(_) {}
            try { console.info('[tsu] injected: POST observed', entry); } catch(_) {}
          } catch(_) {}
        };
        // fetch
        try {
          const origFetch = window.fetch && window.fetch.bind(window);
          if (typeof origFetch === 'function') {
            window.fetch = async function(input, init){
              try {
                const method = (init && init.method) ? String(init.method).toUpperCase() : 'GET';
                const body = init && init.body;
                const url = (typeof input === 'string') ? input : (input && input.url) || '';
                const logAssertionIfAny = async (b) => {
                  try {
                    if (!b) return false;
                    if (typeof b === 'string') {
                      const t = b;
                      if (/"id"\s*:/.test(t) && /"response"\s*:/.test(t)) {
                        try {
                          console.info('[tsu] injected: fetch body looks like WebAuthn assertion', { url, method });
                          const meta = { when: Date.now(), via: 'fetch', url, method, keys: ['id','response'] };
                          try { window.__tsu_pk_cache.lastSentAssertionMeta = meta; } catch(_) {}
                          showTsuToast('Passkey assertion sent (fetch)');
                        } catch(_) {}
                        return true;
                      }
                      return false;
                    }
                    if (b instanceof FormData) {
                      try {
                        let has = false;
                        b.forEach((v,k)=>{ if (!has && /^(id|rawId|response)$/i.test(String(k))) has = true; });
                        if (has) {
                          console.info('[tsu] injected: fetch FormData contains WebAuthn fields', { url, method });
                          const meta = { when: Date.now(), via: 'fetch', url, method, keys: ['id/rawId/response(formdata)'] };
                          try { window.__tsu_pk_cache.lastSentAssertionMeta = meta; } catch(_) {}
                          showTsuToast('Passkey assertion sent (fetch/form)');
                          return true;
                        }
                      } catch(_) {}
                      return false;
                    }
                    return false;
                  } catch(_) {}
                };
                if (method !== 'GET') {
                  let matched = false;
                  try { matched = await logAssertionIfAny(body) === true; } catch(_) { matched = false; }
                  recordPost({ via: 'fetch', url, method, matched });
                }
                try {
                  const res = await origFetch(input, init);
                  try {
                    if (method !== 'GET') {
                      const status = Number(res && res.status);
                      const ok = !!(res && res.ok);
                      try { console.info('[tsu] injected: POST result (fetch)', { url, status, ok }); } catch(_) {}
                      try { window.__tsu_pk_cache.lastPostResult = { when: Date.now(), via: 'fetch', url, status, ok }; } catch(_) {}
                    }
                  } catch(_) {}
                  return res;
                } catch(e) {
                  try {
                    if (method !== 'GET') {
                      try { console.error('[tsu] injected: POST failed (fetch)', { url, error: String(e && (e.message||e)) }); } catch(_) {}
                      try { window.__tsu_pk_cache.lastPostResult = { when: Date.now(), via: 'fetch', url, status: 0, ok: false, error: String(e && (e.message||e)) }; } catch(_) {}
                    }
                  } catch(_) {}
                  throw e;
                }
              } catch(_) {}
              return origFetch(input, init);
            };
          }
        } catch(_) {}
        // XHR
        try {
          const X = window.XMLHttpRequest;
          if (X && X.prototype && typeof X.prototype.open === 'function' && typeof X.prototype.send === 'function') {
            const origOpen = X.prototype.open;
            const origSend = X.prototype.send;
            X.prototype.open = function(method, url){ try { this.__tsu_xhr_m = String(method||'').toUpperCase(); this.__tsu_xhr_u = String(url||''); } catch(_) {} return origOpen.apply(this, arguments); };
            X.prototype.send = function(body){
              try {
                const method = this.__tsu_xhr_m || 'GET';
                const url = this.__tsu_xhr_u || '';
                let matched = false;
                if (method !== 'GET') {
                  try {
                    if (typeof body === 'string') {
                      const t = body;
                      if (/"id"\s*:/.test(t) && /"response"\s*:/.test(t)) {
                        matched = true;
                        try {
                          console.info('[tsu] injected: XHR body looks like WebAuthn assertion', { url, method });
                          const meta = { when: Date.now(), via: 'xhr', url, method, keys: ['id','response'] };
                          try { window.__tsu_pk_cache.lastSentAssertionMeta = meta; } catch(_) {}
                          showTsuToast('Passkey assertion sent (xhr)');
                        } catch(_) {}
                      }
                    }
                  } catch(_) {}
                  try { recordPost({ via: 'xhr', url, method, matched }); } catch(_) {}
                  try {
                    const self = this;
                    const once = (fn) => {
                      let done = false;
                      return function(){ if (done) return; done = true; try { fn.apply(this, arguments); } catch(_) {} };
                    };
                    const onLoad = once(function(){ try { const status = Number(self.status); const ok = status >= 200 && status < 300; console.info('[tsu] injected: POST result (xhr)', { url, status, ok }); try { window.__tsu_pk_cache.lastPostResult = { when: Date.now(), via: 'xhr', url, status, ok }; } catch(_) {} } catch(_) {} });
                    const onErr = once(function(evt){ try { console.error('[tsu] injected: POST failed (xhr)', { url, type: (evt && evt.type) || 'error' }); try { window.__tsu_pk_cache.lastPostResult = { when: Date.now(), via: 'xhr', url, status: 0, ok: false, error: (evt && evt.type) || 'error' }; } catch(_) {} } catch(_) {} });
                    try { this.addEventListener('load', onLoad, { once: true }); } catch(_) {}
                    try { this.addEventListener('error', onErr, { once: true }); } catch(_) {}
                    try { this.addEventListener('abort', onErr, { once: true }); } catch(_) {}
                    try { this.addEventListener('timeout', onErr, { once: true }); } catch(_) {}
                  } catch(_) {}
                }
              } catch(_) {}
              return origSend.apply(this, arguments);
            };
          }
        } catch(_) {}
      } catch(_) {}
    }

    try { installNetworkProbe(); } catch(_) {}
    // 追加の堅牢な送信プローブ（多様なボディ形態を検査）。二重ラップ防止フラグ付き
    try {
      if (!window.__tsu_pk_probe2_installed) {
        window.__tsu_pk_probe2_installed = true;
        const looksLikeAssertion = (obj) => {
          try {
            if (!obj) return false;
            const o = obj;
            const hasId = typeof o.id === 'string' || (o.id && (o.id.byteLength||o.id.length));
            const hasRaw = typeof o.rawId === 'string' || (o.rawId && (o.rawId.byteLength||o.rawId.length));
            const resp = o.response || {};
            const hasResp = !!(resp.clientDataJSON || resp.authenticatorData || resp.signature || resp.attestationObject);
            return !!(hasId && hasResp);
          } catch(_) { return false; }
        };
        const parseMaybeJSON = (txt) => { try { return JSON.parse(txt); } catch(_) { return null; } };
        const bodyToObject = async (input, headers) => {
          try {
            if (!input) return null;
            if (typeof input === 'string') return parseMaybeJSON(input);
            if (input instanceof URLSearchParams) {
              const o = {}; for (const [k,v] of input.entries()) o[k]=v; return o;
            }
            if (typeof FormData !== 'undefined' && input instanceof FormData) {
              const o = {}; for (const [k,v] of input.entries()) o[k]=v; return o;
            }
            if (typeof Request !== 'undefined' && input instanceof Request) {
              const ct = (headers && headers['content-type']) || (input.headers && input.headers.get && input.headers.get('content-type')) || '';
              try { const clone = input.clone(); const txt = await clone.text(); return parseMaybeJSON(txt) || { _text: (txt||'').slice(0, 2000) }; } catch(_) { return null; }
            }
            if (typeof Blob !== 'undefined' && input instanceof Blob) {
              try { const txt = await input.text(); return parseMaybeJSON(txt) || { _text: (txt||'').slice(0, 2000) }; } catch(_) { return null; }
            }
            if (input && typeof input === 'object') return input; // 既にオブジェクト
            return null;
          } catch(_) { return null; }
        };
        // fetch ラップ
        try {
          const origFetch = window.fetch;
          window.fetch = async function(input, init) {
            try {
              const method = (init && init.method) || 'GET';
              const headers = (init && init.headers) || {};
              const body = init && init.body;
              const obj = await bodyToObject(body, headers);
              if (looksLikeAssertion(obj)) {
                console.info('[tsu] injected: fetch body looks like WebAuthn assertion', { method });
              }
            } catch(_) {}
            return origFetch.apply(this, arguments);
          };
        } catch(_) {}
        // XHR ラップ
        try {
          const OrigXHR = window.XMLHttpRequest;
          function XHRWrap() {
            const xhr = new OrigXHR();
            const origOpen = xhr.open;
            const origSend = xhr.send;
            let _method = 'GET';
            xhr.open = function(m,u,async,user,pw){ try{ _method=String(m||'GET'); }catch(_){} return origOpen.apply(xhr, arguments); };
            xhr.send = function(body) {
              (async () => {
                try {
                  const obj = await bodyToObject(body);
                  if (looksLikeAssertion(obj)) {
                    console.info('[tsu] injected: XHR body looks like WebAuthn assertion', { method: _method });
                  }
                } catch(_) {}
              })();
              return origSend.apply(xhr, arguments);
            };
            return xhr;
          }
          window.XMLHttpRequest = XHRWrap;
        } catch(_) {}
      }
    } catch(_) {}

    const toU8 = (buf) => { try { return buf instanceof Uint8Array ? buf : new Uint8Array(buf); } catch (_) { return new Uint8Array(0); } };
    const host = (() => { try { return String(location.hostname || '').toLowerCase(); } catch(_) { return ''; } })();
    const isPasskeyIo = (() => {
      try { return /(^|\.)passkeys?\.io$/i.test(String(host || '')); } catch(_) { return false; }
    })();
    const isFallbackDisabledForHost = () => {
      try {
        // Some sites break if we takeover; disable fallback for them
        if (/\.google\.com$/i.test(host)) return true;
        return false;
      } catch(_) { return false; }
    };
    const b64uToBytes = (s) => {
      try {
        if (!s) return new Uint8Array(0);
        const pad = (str) => str + '==='.slice((str.length + 3) % 4);
        const b64 = pad(String(s).replace(/-/g, '+').replace(/_/g, '/'));
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
      } catch(_) { return new Uint8Array(0); }
    };
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

    // 条件付きUIを前面に出すためのナッジ（入力へフォーカス）
    function nudgeConditionalUI() {
      try {
        if (!window.__tsu_pk_is_conditional) return;
        if (window.__tsu_pk_cond_nudged) return;
        window.__tsu_pk_cond_nudged = true;
        const d = document;
        const candidates = Array.from(d.querySelectorAll('input, textarea, [contenteditable="true"]'))
          .filter((el) => {
            try {
              if (!(el instanceof HTMLElement)) return false;
              const tag = (el.tagName||'').toLowerCase();
              if (tag === 'input') {
                const t = (el.getAttribute('type')||'text').toLowerCase();
                return ['text','email','search','url','tel','password'].includes(t);
              }
              return tag === 'textarea' || el.isContentEditable;
            } catch(_) { return false; }
          });
        const target = (document.activeElement && document.activeElement !== document.body) ? document.activeElement : (candidates[0] || null);
        if (target) {
          try { target.focus && target.focus(); } catch(_) {}
          try { target.click && target.click(); } catch(_) {}
          try {
            const ev1 = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
            const ev2 = new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
            const ev3 = new Event('input', { bubbles: true, cancelable: true });
            target.dispatchEvent(ev1); target.dispatchEvent(ev2); target.dispatchEvent(ev3);
          } catch(_) {}
          try { console.info('[tsu] injected: conditional UI nudge focus/click/input applied'); } catch(_) {}
        }
      } catch(_) {}
    }

    // ログイン起動フォールバック（外側スコープに定義して複数箇所から参照可能に）
    async function triggerLoginFallback(force, noWait) {
      try {
        // 強制フォールバックの連続起動を抑止（多重クリック/多重 get を避ける）
        try {
          const now = Date.now();
          const cd = Number(window.__tsu_pk_force_cd_ts || 0);
          const cdWindow = (window.__tsu_pk_prefer_fallback === true) ? 600 : 1200;
          if (force === true) {
            if (cd && (now - cd) < cdWindow) {
              console.info('[tsu] injected: triggerLoginFallback forced skipped (cooldown)', { sinceMs: now - cd, windowMs: cdWindow });
              return;
            }
            window.__tsu_pk_force_cd_ts = now;
          }
        } catch(_) {}
        // 強制時でも、同期イベント経由の起動では待機せずに即時実行してユーザーアクティベーションを保持
        try {
          if (force === true && noWait !== true) {
            const deadline = Date.now() + 800;
            let wait = 40;
            while (!(window.__tsu_pk_preferred && window.__tsu_pk_preferred.credentialIdB64) && Date.now() < deadline) {
              await sleep(wait);
              wait = Math.min(200, Math.floor(wait * 1.5));
            }
            if (!(window.__tsu_pk_preferred && window.__tsu_pk_preferred.credentialIdB64)) {
              try { console.info('[tsu] injected: preferred not ready, reschedule forced fallback'); } catch(_) {}
              setTimeout(() => { try { triggerLoginFallback(true, true); } catch(_) {} }, 180);
              return;
            }
          }
        } catch(_) {}
        // conditional UI が直近で起動している場合は、競合を避けるため少し待ってからクリック
        try {
          if (force === true && window.__tsu_pk_is_conditional) {
            const now = Date.now();
            const last = Number(window.__tsu_pk_last_ts || 0);
            if (last && (now - last) < 500) {
              await sleep(220);
            }
          }
        } catch(_) {}
        // 強制フォールバック直後の get に対して厳格モードを有効化し、inflight 競合があれば最大1500msだけ解消を待機
        try { if (force === true) window.__tsu_pk_force_strict_ts = Date.now(); } catch(_) {}
        try {
          if (force === true && window.__tsu_pk_get_inflight) {
            console.info('[tsu] injected: forced fallback waiting inflight to clear');
            const start = Date.now();
            const cap = (window.__tsu_pk_prefer_fallback === true) ? 400 : 2000;
            while (window.__tsu_pk_get_inflight) {
              if ((Date.now() - start) > cap) break;
              await sleep(50);
            }
            const waited = Date.now() - start;
            console.info('[tsu] injected: forced fallback inflight wait done', { waitedMs: waited, cleared: !window.__tsu_pk_get_inflight });
            if (window.__tsu_pk_get_inflight && window.__tsu_pk_prefer_fallback !== true) {
              // まだ in-flight の場合は保留し、少し後に再試行（上限を設けてループを防止）
              try {
                const now2 = Date.now();
                const startTs = Number(window.__tsu_pk_force_defer_start_ts || 0) || now2;
                const cnt = Number(window.__tsu_pk_force_defer_count || 0);
                const prefer = window.__tsu_pk_prefer_fallback === true;
                const overTime = (now2 - startTs) > 10000; // 10s 上限
                const overCount = cnt >= 5; // 最大5回
                if (prefer || overTime || overCount) {
                  console.info('[tsu] injected: defer loop stop', { prefer, overTime, overCount, count: cnt, elapsedMs: now2 - startTs });
                  // これ以上は再スケジュールしない
                } else {
                  try { if (!window.__tsu_pk_force_defer_start_ts) window.__tsu_pk_force_defer_start_ts = startTs; } catch(_) {}
                  try { window.__tsu_pk_force_defer_count = cnt + 1; } catch(_) {}
                  console.info('[tsu] injected: defer forced fallback due to inflight, reschedule in 600ms', { count: cnt + 1 });
                  setTimeout(() => { try { triggerLoginFallback(true, true); } catch(_) {} }, 600);
                }
              } catch(_) {}
              return;
            } else {
              // クリアできたのでカウンタをリセット
              try { window.__tsu_pk_force_defer_start_ts = 0; window.__tsu_pk_force_defer_count = 0; } catch(_) {}
            }
          }
        } catch(_) {}
        if (force !== true) {
          if (isFallbackDisabledForHost()) {
            try { console.info('[tsu] injected: triggerLoginFallback disabled for host', host); } catch(_) {}
            return;
          }
          // 直近/進行中の get() があるなら重複起動を避ける
          try {
            const inflight = !!window.__tsu_pk_get_inflight;
            const last = Number(window.__tsu_pk_last_ts || 0);
            const now = Date.now();
            const recent = last && (now - last) < 800; // 直近800ms以内はスキップ
            const prefSetTs = Number(window.__tsu_pk_pref_set_ts || 0);
            const prefRecent = prefSetTs && (now - prefSetTs) < 1500; // 直近に preferred 設定があれば再起動を許可
            const prefAppliedTs = Number(window.__tsu_pk_pref_applied_ts || 0);
            const appliedRecent = prefAppliedTs && (now - prefAppliedTs) < 600; // 既に allowCredentials に適用済みなら中断しない
            if ((inflight || recent) && !prefRecent) {
              console.info('[tsu] injected: triggerLoginFallback skipped', { inflight, recent, sinceMs: last ? (now - last) : -1 });
              return;
            }
            if (!inflight && appliedRecent) {
              console.info('[tsu] injected: triggerLoginFallback skipped (applied recent)', { sinceAppliedMs: now - prefAppliedTs });
              return;
            }
          } catch(_) {}
        }
        try { console.info('[tsu] injected: triggerLoginFallback start'); } catch(_) {}
        const d = document;
        const all = Array.prototype.slice.call(d.querySelectorAll('button, [role="button"], a, input[type="button"], input[type="submit"]'));
        const sameOrigin = (href) => {
          try {
            if (!href) return true;
            if (href.startsWith('#') || href.startsWith('javascript:')) return true;
            const u = new URL(href, location.href);
            return u.origin === location.origin;
          } catch(_) { return false; }
        };
        const candidates = all.filter((el) => {
          try {
            const tn = (el.tagName || '').toLowerCase();
            if (tn === 'a') {
              const href = el.getAttribute('href') || '';
              return sameOrigin(href);
            }
            return true;
          } catch(_) { return false; }
        });
        const kw = ['passkey','パスキー','webauthn','生体','security key','セキュリティキー'];
        const loginKw = ['login','sign in','signin','ログイン','サインイン'];
        const registerKw = ['register','sign up','signup','登録','新規','create','作成'];
        const score = (el) => {
          try {
            let s = 0;
            const tn = (el.tagName || '').toLowerCase();
            const tp = (el.type || '').toLowerCase();
            if (tn === 'button' || tp === 'submit' || tp === 'button') s += 5;
            if ((el.getAttribute && el.getAttribute('role')) === 'button') s += 3;
            const txt = (el.innerText || el.textContent || '').toLowerCase();
            const labs = [el.getAttribute('aria-label'), el.getAttribute('title'), el.id, el.name, el.value].map(x => (x || '').toLowerCase());
            for (const k of kw) { if (txt.includes(k) || labs.some(v => v.includes(k))) s += 2; }
            if (loginKw.some(k => txt.includes(k) || labs.some(v => v.includes(k)))) s += 4;
            if (registerKw.some(k => txt.includes(k) || labs.some(v => v.includes(k)))) s -= 6;
            try { if (el.getAttribute('data-webauthn') === 'true' || el.getAttribute('autocomplete') === 'webauthn') s += 4; } catch(_) {}
            try { if (/passkey|webauthn/i.test(String(el.className||''))) s += 2; } catch(_) {}
            const near = el.closest && el.closest('label, div, span, form');
            const ntext = near ? (near.innerText || near.textContent || '').toLowerCase() : '';
            for (const k of kw) { if (ntext.includes(k)) s += 1; }
            if (loginKw.some(k => ntext.includes(k))) s += 2;
            if (registerKw.some(k => ntext.includes(k))) s -= 3;
            if (el.closest && el.closest('form')) s += 1;
            return s;
          } catch(_) { return 0; }
        };
        const sorted = candidates.map(el => ({ el, s: score(el) })).filter(o => o.s > 0).sort((a,b) => b.s - a.s);
        if (sorted.length) {
          const target = sorted[0].el;
          try { target.focus && target.focus(); } catch(_) {}
          // クリックの連打を抑止しつつ、prefer_fallback 中で inflight のときはクリック抑止
          try {
            const lastClick = Number(window.__tsu_pk_last_click_ts || 0);
            const now2 = Date.now();
            if (window.__tsu_pk_prefer_fallback === true && window.__tsu_pk_get_inflight) {
              console.info('[tsu] injected: skip page button click due to prefer_fallback (inflight)');
            } else if (!lastClick || (now2 - lastClick) > 800) {
              window.__tsu_pk_last_click_ts = now2;
              target.click();
              console.info('[tsu] injected: clicked best login/passkey button');
            } else {
              console.info('[tsu] injected: skip duplicate click', { sinceMs: now2 - lastClick });
            }
          } catch(_) { try { target.click(); } catch(_) {} }
          return;
        }
        // 次善策: 近傍フォーム submit または Enter 送出
        try {
          const active = d.activeElement;
          const form = (active && (active.form || (active.closest && active.closest('form')))) || null;
          if (form && typeof form.submit === 'function') {
            try { form.requestSubmit ? form.requestSubmit() : form.submit(); } catch(_) { try { form.submit(); } catch(_) {} }
            try { console.info('[tsu] injected: form submit fallback'); } catch(_) {}
            return;
          }
          if (active) {
            const evEnter = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });
            try { active.dispatchEvent(evEnter); } catch(_) {}
            try { console.info('[tsu] injected: Enter key fallback'); } catch(_) {}
          }
        } catch(_) {}
      } catch(_) {}
    }

    // 受信: 優先 credential を設定
    try {
      window.addEventListener('message', (ev) => {
        try {
          if (!ev || ev.source !== window) return;
          const data = ev.data || {};
          if (!(data && data.__tsu)) return;
          if (data.type === 'tsu:setPreferredCredential') {
            const credB64 = String(data.credentialIdB64 || data.credentialId || '') || '';
            const rpId = String(data.rpId || '') || '';
            if (credB64) {
              window.__tsu_pk_preferred = { credentialIdB64: credB64, rpId };
              try { window.__tsu_pk_pref_set_ts = Date.now(); } catch(_) {}
            }
            try { console.info('[tsu] injected: setPreferredCredential', { hasId: !!credB64, rpId }); } catch(_) {}
            // 可能なら同期起動を促す
            try { if (typeof window.__tsu_setAutoEnabled === 'function') window.__tsu_setAutoEnabled(true); } catch(_) {}
            try {
              const inflight = !!window.__tsu_pk_get_inflight;
              if (!inflight) {
                setTimeout(() => { try { window.dispatchEvent(new Event('tsu:triggerPasskeyLoginSync')); } catch(_) {} }, 0);
              }
            } catch(_) {}
            return;
          }
          if (data.type === 'tsu:triggerPasskeyLogin') {
            triggerLoginFallback(false);
            return;
          }
        } catch(_) {}
      }, false);
    } catch(_) {}

    // フォールバック: 候補クリック後、サイトが get() を呼ばない場合に最低限トリガする
    try {
      const scheduleFinalBypass = () => {
        try {
          if (!window.__tsu_pk_is_conditional) return false;
          if (window.__tsu_pk_final_bypass_sched) return true;
          window.__tsu_pk_final_bypass_sched = true;
          setTimeout(async () => {
            try {
              const inflight = !!window.__tsu_pk_get_inflight;
              const condTs = Number(window.__tsu_pk_cond_detect_ts || 0);
              const resolvedTs = Number(window.__tsu_pk_last_resolved_ts || 0);
              const sinceCond = condTs ? (Date.now() - condTs) : Infinity;
              const unresolved = !resolvedTs || (condTs && resolvedTs < condTs);
              if (unresolved && sinceCond > 6000) {
                console.info('[tsu] injected: final bypass enabling prefer_fallback and forcing');
                try { window.__tsu_pk_prefer_fallback = true; window.__tsu_pk_no_esc_dismiss = false; } catch(_) {}
                try { ensureDisableConditionalAvail(); } catch(_) {}
                try {
                  if (window.__tsu_pk_no_esc_dismiss === true) {
                    console.info('[tsu] injected: final bypass skip ESC due to flag');
                  } else {
                    if (window.__tsu_allow_ui_dismiss === true) { dismissConditionalUI(); }
                  }
                } catch(_) {}
                try { await sleep(150); } catch(_) {}
                // まずはハードテイクオーバーで直接 our get() を起動
                try {
                  const ok = await startHardTakeover('final-bypass');
                  if (ok) { return; }
                } catch(_) {}
                // prefer_fallback 中は DOM フォールバックを行わず、テイクオーバー再試行に専念
                try {
                  setTimeout(() => { try { startHardTakeover('final-bypass-retry'); } catch(_) {} }, 800);
                } catch(_) {}
              } else {
                console.info('[tsu] injected: final bypass skip', { inflight, sinceCondMs: sinceCond, unresolved });
              }
            } catch(_) {} finally { try { window.__tsu_pk_final_bypass_sched = false; } catch(_) {} }
          }, 6000);
          return true;
        } catch(_) { return false; }
      };
      const scheduleInflightRescue = () => {
        try {
          if (!window.__tsu_pk_is_conditional) return false;
          if (window.__tsu_pk_prefer_fallback === true) {
            console.info('[tsu] injected: inflight rescue bypass via prefer_fallback');
            (async () => { try { if (window.__tsu_allow_ui_dismiss === true) { dismissConditionalUI(); } await sleep(300); await triggerLoginFallback(true, true); } catch(_) {} })();
            return true;
          }
          if (window.__tsu_pk_rescue_sched) return true;
          window.__tsu_pk_rescue_sched = true;
          setTimeout(async () => {
            try {
              const inflight = !!window.__tsu_pk_get_inflight;
              const condTs = Number(window.__tsu_pk_cond_detect_ts || 0);
              const resolvedTs = Number(window.__tsu_pk_last_resolved_ts || 0);
              const sinceCond = condTs ? (Date.now() - condTs) : Infinity;
              const unresolved = !resolvedTs || (condTs && resolvedTs < condTs);
              if (!inflight && unresolved && sinceCond > 3500) {
                console.info('[tsu] injected: inflight stall rescue triggering fallback (no inflight)', { sinceCondMs: sinceCond });
                await triggerLoginFallback(true, true);
              } else {
                console.info('[tsu] injected: inflight stall rescue skip', { inflight, sinceCondMs: sinceCond, unresolved });
              }
            } catch(_) {} finally { try { window.__tsu_pk_rescue_sched = false; } catch(_) {} }
          }, 3500);
          return true;
        } catch(_) { return false; }
      };
      const scheduleConditionalFallback = () => {
        try {
          if (!window.__tsu_pk_is_conditional) return false;
          if (window.__tsu_pk_prefer_fallback === true) {
            console.info('[tsu] injected: conditional bypass via prefer_fallback');
            (async () => { try { if (window.__tsu_allow_ui_dismiss === true) { dismissConditionalUI(); } await sleep(300); await triggerLoginFallback(true, true); } catch(_) {} })();
            return true;
          }
          if (window.__tsu_pk_cond_sched) return true;
          window.__tsu_pk_cond_sched = true;
          const lastBefore = Number(window.__tsu_pk_last_ts || 0);
          setTimeout(async () => {
            try {
              const inflight = !!window.__tsu_pk_get_inflight;
              const last = Number(window.__tsu_pk_last_ts || 0);
              const since = last ? (Date.now() - last) : Infinity;
              if (!inflight && (!last || since > 700)) {
                console.info('[tsu] injected: conditional window passed, triggering fallback');
                await triggerLoginFallback(true, true);
              } else {
                console.info('[tsu] injected: conditional window skip', { inflight, sinceMs: since, lastChanged: last !== lastBefore });
              }
            } catch(_) {} finally { try { window.__tsu_pk_cond_sched = false; } catch(_) {} }
          }, 700);
          return true;
        } catch(_) { return false; }
      };
      window.addEventListener('tsu:triggerPasskeyLogin', () => {
        if (scheduleConditionalFallback()) { try { scheduleInflightRescue(); scheduleFinalBypass(); } catch(_) {} return; }
        try { scheduleInflightRescue(); scheduleFinalBypass(); } catch(_) {}
        triggerLoginFallback(true);
      }, false);
      window.addEventListener('tsu:triggerPasskeyLoginSync', () => {
        if (scheduleConditionalFallback()) { try { scheduleInflightRescue(); scheduleFinalBypass(); } catch(_) {} return; }
        try { scheduleInflightRescue(); scheduleFinalBypass(); } catch(_) {}
        // 同期イベント: ユーザーアクティベーションの文脈で即時起動
        triggerLoginFallback(true, true);
      }, false);
      // すでに conditional が有効化済みのケースでも救済/最終バイパスをスケジュール
      try {
        if (window.__tsu_pk_is_conditional) { scheduleInflightRescue(); scheduleFinalBypass(); }
      } catch(_) {}
    } catch(_) {}
    const cborDecodeItem = __tsu_cborDecodeItem;
    const parseAttestation = __tsu_parseAttestation;

    navigator.credentials.create = async function (options) {
      try {
        const pub = options && options.publicKey;
        if (pub) {
          try {
            if (pub.rp && pub.rp.id) window.__tsu_pk_cache.rpId = String(pub.rp.id);
            if (pub.rp && pub.rp.name) window.__tsu_pk_cache.title = String(pub.rp.name);
            if (pub.user && pub.user.id) {
              const u = pub.user.id;
              const buf = (u instanceof ArrayBuffer) ? u : (ArrayBuffer.isView(u) ? u.buffer : null);
              if (buf) window.__tsu_pk_cache.userHandleB64 = b64u(buf);
            }
            try {
              const ex = Array.isArray(pub.excludeCredentials) ? pub.excludeCredentials : [];
              const trSet = new Set();
              for (const e of ex) {
                try {
                  const trs = (e && e.transports) || [];
                  if (Array.isArray(trs)) trs.forEach((t) => trSet.add(String(t)));
                } catch (_) {}
              }
              if (trSet.size) {
                const attachSel = (pub && pub.authenticatorSelection && pub.authenticatorSelection.authenticatorAttachment) || undefined;
                const norm = __tsu_normalizeTransports(Array.from(trSet), attachSel);
                if (norm) window.__tsu_pk_cache.transports = norm;
              }
            } catch (_) {}
          } catch (_) {}
        }
      } catch (_) {}

      // 登録フロー中はキャンセル関連の介入を一時的に無効化（OS UI への干渉を防止）
      let prevCancel = null, prevFallback = null, prevNoEsc = null;
      try {
        try { prevCancel = window.__tsu_cancel_guard_on; window.__tsu_cancel_guard_on = false; } catch(_) {}
        try { prevFallback = window.__tsu_pk_prefer_fallback; window.__tsu_pk_prefer_fallback = false; } catch(_) {}
        try { prevNoEsc = window.__tsu_pk_no_esc_dismiss; window.__tsu_pk_no_esc_dismiss = true; } catch(_) {}
      } catch(_) {}
      let cred;
      try {
        cred = await origCreate(options);
      } finally {
        try { if (prevCancel !== null) window.__tsu_cancel_guard_on = prevCancel; } catch(_) {}
        try { if (prevFallback !== null) window.__tsu_pk_prefer_fallback = prevFallback; } catch(_) {}
        try { if (prevNoEsc !== null) window.__tsu_pk_no_esc_dismiss = prevNoEsc; } catch(_) {}
      }
      try {
        if (cred && cred.type === 'public-key') {
          try { window.__tsu_pk_cache.credentialIdB64 = b64u(cred.rawId); } catch (_) {}
          const resp = cred && cred.response;
          try {
            if (resp && resp.attestationObject) {
              window.__tsu_pk_cache.attestationB64 = b64u(resp.attestationObject);
              const parsed = __tsu_parseAttestation(__tsu_toU8(resp.attestationObject));
              if (parsed) {
                if (typeof parsed.signCount === 'number') window.__tsu_pk_cache.signCount = parsed.signCount;
                if (parsed.publicKeyRaw) window.__tsu_pk_cache.publicKeyB64 = b64u(parsed.publicKeyRaw);
              }
            }
          } catch (_) {}
          // Fallback: some browsers expose response.publicKey (base64). Use it if we don't already have publicKeyB64.
          try {
            if ((!window.__tsu_pk_cache.publicKeyB64 || !window.__tsu_pk_cache.publicKeyB64.length) && resp && typeof resp.publicKey === 'string' && resp.publicKey) {
              window.__tsu_pk_cache.publicKeyB64 = String(resp.publicKey);
            }
          } catch(_) {}
          // Transports fallback（正規化あり）
          try {
            if (resp && Array.isArray(resp.transports) && resp.transports.length) {
              const attach = cred && cred.authenticatorAttachment;
              const norm = __tsu_normalizeTransports(resp.transports, attach);
              if (norm) window.__tsu_pk_cache.transports = norm;
            }
          } catch(_) {}
          // Ensure rpId and title
          try { if (!window.__tsu_pk_cache.rpId && location && location.hostname) window.__tsu_pk_cache.rpId = String(location.hostname); } catch(_) {}
          // Try to pick a better title from current inputs; exclude password; prefer email/phone
          try {
            const looksEmail = (s) => { try { return /.+@.+\..+/.test(String(s||'')); } catch(_) { return false; } };
            const looksPhone = (s) => { try { return /^[+]?[-0-9()\s]{8,}$/.test(String(s||'').replace(/[\u3000\s]+/g,' ')); } catch(_) { return false; } };
            const host = (location && location.hostname) ? String(location.hostname) : '';
            let t = '';
            try {
              const ax = (window.__tsu_current_anchor && window.__tsu_current_anchor.value && String(window.__tsu_current_anchor.value).trim()) || '';
              if (ax) t = ax;
            } catch(_) {}
            if (!t) {
              try {
                const ae = document && document.activeElement;
                if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) {
                  const tp = (ae.getAttribute && (ae.getAttribute('type')||'')).toLowerCase();
                  if (tp !== 'password') {
                    const v = String(ae.value || '').trim();
                    if (v) t = v;
                  }
                }
              } catch(_) {}
            }
            if (!t) {
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
                  let el = document && document.querySelector && document.querySelector(sel);
                  if (!el) {
                    try {
                      const hosts = document.querySelectorAll('*');
                      for (const h of hosts) {
                        try { if (h && h.shadowRoot) { const e2 = h.shadowRoot.querySelector(sel); if (e2) { el = e2; break; } } } catch(_) {}
                      }
                    } catch(_) {}
                  }
                  if (!el) {
                    try {
                      const ifs = document.querySelectorAll('iframe');
                      for (const f of ifs) {
                        try { const d = f && f.contentDocument; const e3 = d && d.querySelector && d.querySelector(sel); if (e3) { el = e3; break; } } catch(_) {}
                      }
                    } catch(_) {}
                  }
                  if (el && typeof el.value === 'string') {
                    const tp = (el.getAttribute && (el.getAttribute('type')||'')).toLowerCase();
                    if (tp === 'password') continue;
                    const v = String(el.value || '').trim();
                    if (v) { t = v; break; }
                  }
                }
              } catch(_) {}
            }
            if (!t) {
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
                  .filter(el => el && typeof el.value === 'string' && isProbablyVisible(el) && ((el.getAttribute('type')||'').toLowerCase() !== 'password'))
                  .map(el => String(el.value || '').trim())
                  .filter(Boolean);
                if (/amazon\.co\.jp$/i.test(host)) {
                  const phoneVal = vals.find(looksPhone);
                  if (phoneVal) t = phoneVal;
                  if (!t) { const emailVal = vals.find(looksEmail); if (emailVal) t = emailVal; }
                } else {
                  const emailVal = vals.find(looksEmail);
                  if (emailVal) t = emailVal;
                  if (!t) { const phoneVal = vals.find(looksPhone); if (phoneVal) t = phoneVal; }
                }
                if (!t && vals.length) t = vals[0];
              } catch(_) {}
            }
            // Avoid domain-like strings (host/rp name) when coming from inputs
            try {
              const host = (location && location.hostname) ? String(location.hostname).toLowerCase() : '';
              const isDomainLike = (s) => { try { return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(String(s||'').trim()); } catch(_) { return false; } };
              if (t && (String(t).toLowerCase() === host || (isDomainLike(t) && String(t).toLowerCase() === host))) {
                t = '';
              }
            } catch(_) {}
            if (t) {
              window.__tsu_pk_cache.title = t;
            }
          } catch(_) {}
          try { if (!window.__tsu_pk_cache.title && document && document.title) window.__tsu_pk_cache.title = String(document.title); } catch(_) {}
          try {
            const rp = String((window.__tsu_pk_cache && window.__tsu_pk_cache.rpId) || ((options && options.publicKey && (options.publicKey.rpId || (options.publicKey.rp && options.publicKey.rp.id))) || '') || '');
            const cid = String((window.__tsu_pk_cache && window.__tsu_pk_cache.credentialIdB64) || '');
            const uh = String((window.__tsu_pk_cache && window.__tsu_pk_cache.userHandleB64) || '');
            const pk = String((window.__tsu_pk_cache && window.__tsu_pk_cache.publicKeyB64) || '');
            console.info('[tsu] injected: passkey cache after create', {
              rpId: rp,
              hasCred: !!cid,
              credLen: cid.length,
              hasUser: !!uh,
              userLen: uh.length,
              hasPub: !!pk,
              pubLen: pk.length,
            });
          } catch(_) {}
          try {
            window.postMessage({ __tsu: true, type: 'tsu:passkeyCaptured', cache: { ...window.__tsu_pk_cache } }, '*');
          } catch (e) { try { console.warn('[tsu] injected: postMessage cache failed', String(e && (e.message||e))); } catch(_) {} }
          try { console.info('[tsu] injected: posted passkey cache'); } catch(_) {}
        }
      } catch (_) {}
      return cred;
    };

    // 元の get を保持
    try { if (!window.__tsu_orig_get) window.__tsu_orig_get = navigator.credentials.get; } catch(_) {}
    try { if (!window.__tsu_orig_create) window.__tsu_orig_create = navigator.credentials.create; } catch(_) {}
    navigator.credentials.create = async function(options){
      let outOptions = options;
      try {
        try { if (window.__tsu_disable_all_intervention === true) { return origCreate(options); } } catch(_) {}
        let email = '';
        try {
          const q1 = document && document.querySelector && document.querySelector('input[type="email"]');
          const q2 = document && document.querySelector && document.querySelector('input[name*="email" i]');
          const q3 = document && document.getElementById && document.getElementById('email');
          const el = q1 || q2 || q3;
          if (el && typeof el.value === 'string') { email = String(el.value).trim(); }
        } catch(_) {}
        try { if (!email && window.__tsu_pk_cache && window.__tsu_pk_cache.email) { email = String(window.__tsu_pk_cache.email||''); } } catch(_) {}
        try { if (email) { try { window.__tsu_pk_cache.email = email; } catch(_) {} } } catch(_) {}
        try {
          const host = String(location.hostname||'');
          if (/passkeys?\.io$/i.test(host) && email && options && typeof options === 'object') {
            // 仕様通り: options.publicKey を想定
            if (options.publicKey && options.publicKey.user) {
              try {
                const user = options.publicKey.user;
                if (!user.name) user.name = email;
                if (!user.displayName) user.displayName = email;
                try { console.info('[tsu] injected: applied email as passkey title', { email }); } catch(_) {}
              } catch(_) {}
            } else if (options.user) {
              // 稀に publicKey 直下ではなく、直接 PublicKeyCredentialCreationOptions 相当が渡るケースを保険
              try {
                const user = options.user;
                if (!user.name) user.name = email;
                if (!user.displayName) user.displayName = email;
                try { console.info('[tsu] injected: applied email as passkey title (direct)', { email }); } catch(_) {}
              } catch(_) {}
            }
            // 呼び出し形は維持（publicKey があればそのまま、無ければそのまま）
            outOptions = options;
          }
        } catch(_) {}
      } catch(_) {}
      // Prefer title from options.user (displayName/name) when available (but avoid domain-like/rpId)
      try {
        const pk = (outOptions && outOptions.publicKey) || outOptions || {};
        const user = pk && pk.user;
        const raw = user && (user.displayName || user.name);
        const t1 = (raw && String(raw).trim()) || '';
        try { window.__tsu_pk_cache.userTitleCandidate = t1; } catch(_) {}
        const host = (location && location.hostname) ? String(location.hostname).toLowerCase() : '';
        const isDomainLike = (s) => { try { return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(String(s||'').trim()); } catch(_) { return false; } };
        const safe = !!(t1 && t1.toLowerCase() !== host && !isDomainLike(t1));
        if (safe) {
          try { window.__tsu_pk_cache.title = t1; } catch(_) {}
        }
      } catch(_) {}
      // userHandle を options から事前取得してキャッシュ（ブラウザが assertion で返さない場合の保険）
      try {
        const pk = (outOptions && outOptions.publicKey) || outOptions || {};
        const user = pk && pk.user;
        const id = user && user.id;
        if (id) {
          let buf = null;
          try {
            if (id instanceof ArrayBuffer) buf = new Uint8Array(id);
            else if (ArrayBuffer.isView(id)) buf = new Uint8Array(id.buffer, id.byteOffset, id.byteLength);
          } catch(_) {}
          if (buf && buf.byteLength) {
            try { window.__tsu_pk_cache.userHandleB64 = b64u(buf); } catch(_) {}
          } else if (typeof id === 'string' && id) {
            // 既にBase64URL文字列の場合はそのまま採用
            try { window.__tsu_pk_cache.userHandleB64 = String(id); } catch(_) {}
          }
        }
      } catch(_) {}
      const cred = await origCreate(outOptions);
      try {
        if (cred && cred.type === 'public-key') {
          try { if (cred && cred.rawId) window.__tsu_pk_cache.credentialIdB64 = b64u(cred.rawId); } catch(_) {}
          const resp = cred && cred.response;
          try {
            if (resp && resp.attestationObject) {
              try { window.__tsu_pk_cache.attestationB64 = b64u(resp.attestationObject); } catch(_) {}
              try {
                const parsed = __tsu_parseAttestation(__tsu_toU8(resp.attestationObject));
                if (parsed) {
                  if (typeof parsed.signCount === 'number') window.__tsu_pk_cache.signCount = parsed.signCount;
                  if (parsed.publicKeyRaw) window.__tsu_pk_cache.publicKeyB64 = b64u(parsed.publicKeyRaw);
                }
              } catch(_) {}
            } else if (resp && typeof resp.publicKey === 'string' && resp.publicKey) {
              // Fallback: some browsers expose response.publicKey (base64)
              try { window.__tsu_pk_cache.publicKeyB64 = String(resp.publicKey); } catch(_) {}
            }
          } catch(_) {}
          // transports（正規化 + 推測）
          try {
            const attach = cred && cred.authenticatorAttachment;
            const norm = __tsu_normalizeTransports(resp && resp.transports, attach);
            if (norm) window.__tsu_pk_cache.transports = norm;
          } catch(_) {}
          // rpId/title fallback
          try { if (!window.__tsu_pk_cache.rpId && location && location.hostname) window.__tsu_pk_cache.rpId = String(location.hostname); } catch(_) {}
          try {
            const looksEmail = (s) => { try { return /.+@.+\..+/.test(String(s||'')); } catch(_) { return false; } };
            const looksPhone = (s) => { try { return /^[+]?[-0-9()\s]{8,}$/.test(String(s||'').replace(/[\u3000\s]+/g,' ')); } catch(_) { return false; } };
            const host = (location && location.hostname) ? String(location.hostname) : '';
            let t = '';
            try {
              const ax = (window.__tsu_current_anchor && window.__tsu_current_anchor.value && String(window.__tsu_current_anchor.value).trim()) || '';
              if (ax) t = ax;
            } catch(_) {}
            if (!t) {
              try {
                const ae = document && document.activeElement;
                if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) {
                  const tp = (ae.getAttribute && (ae.getAttribute('type')||'')).toLowerCase();
                  if (tp !== 'password') {
                    const v = String(ae.value || '').trim();
                    if (v) t = v;
                  }
                }
              } catch(_) {}
            }
            if (!t) {
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
                  let el = document && document.querySelector && document.querySelector(sel);
                  if (!el) {
                    try {
                      const hosts = document.querySelectorAll('*');
                      for (const h of hosts) {
                        try { if (h && h.shadowRoot) { const e2 = h.shadowRoot.querySelector(sel); if (e2) { el = e2; break; } } } catch(_) {}
                      }
                    } catch(_) {}
                  }
                  if (!el) {
                    try {
                      const ifs = document.querySelectorAll('iframe');
                      for (const f of ifs) {
                        try { const d = f && f.contentDocument; const e3 = d && d.querySelector && d.querySelector(sel); if (e3) { el = e3; break; } } catch(_) {}
                      }
                    } catch(_) {}
                  }
                  if (el && typeof el.value === 'string') {
                    const tp = (el.getAttribute && (el.getAttribute('type')||'')).toLowerCase();
                    if (tp === 'password') continue;
                    const v = String(el.value || '').trim();
                    if (v) { t = v; break; }
                  }
                }
              } catch(_) {}
            }
            if (!t) {
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
                  .filter(el => el && typeof el.value === 'string' && isProbablyVisible(el) && ((el.getAttribute('type')||'').toLowerCase() !== 'password'))
                  .map(el => String(el.value || '').trim())
                  .filter(Boolean);
                if (/amazon\.co\.jp$/i.test(host)) {
                  const phoneVal = vals.find(looksPhone);
                  if (phoneVal) t = phoneVal;
                  if (!t) { const emailVal = vals.find(looksEmail); if (emailVal) t = emailVal; }
                } else {
                  const emailVal = vals.find(looksEmail);
                  if (emailVal) t = emailVal;
                  if (!t) { const phoneVal = vals.find(looksPhone); if (phoneVal) t = phoneVal; }
                }
                if (!t && vals.length) t = vals[0];
              } catch(_) {}
            }
            if (t) {
              window.__tsu_pk_cache.title = t;
            }
          } catch(_) {}
          try { if (!window.__tsu_pk_cache.title && document && document.title) window.__tsu_pk_cache.title = String(document.title); } catch(_) {}
          try { console.info('[tsu] injected: posting passkey cache after create (inline)', { hasCred: !!window.__tsu_pk_cache.credentialIdB64, hasPub: !!window.__tsu_pk_cache.publicKeyB64 }); } catch(_) {}
          try { post({ ...window.__tsu_pk_cache }); } catch(_) {}
        }
      } catch(_) {}
      return cred;
    };
    navigator.credentials.get = async function (options) {
      try {
        // 完全バイパス: 介入を全て無効化して OS UI を優先
        try {
          if (window.__tsu_disable_all_intervention === true) {
            try {
              const PKC = window.PublicKeyCredential;
              if (window.__tsu_orig_isCondAvail && PKC && typeof PKC.isConditionalMediationAvailable === 'function') {
                PKC.isConditionalMediationAvailable = window.__tsu_orig_isCondAvail;
              }
            } catch(_) {}
            return origGet(options);
          }
        } catch(_) {}
        // OS UI の二重表示抑止: 直近起動後のクールダウン中は当方以外の get() を抑止
        try {
          const cool = Number(window.__tsu_pk_ui_cool_until || 0);
          if (cool && Date.now() < cool && window.__tsu_pk_ours !== true) {
            console.info('[tsu] injected: suppressing get() during UI cooldown');
            throw new DOMException('Suppressed by UI cooldown', 'AbortError');
          }
        } catch(_) {}
        // キャンセルガード: 当方以外の get() を即時中止して新規ペンディング発生を防ぐ
        try {
          if (window.__tsu_cancel_guard_on === true && window.__tsu_pk_ours !== true) {
            console.info('[tsu] injected: cancel-guard aborting site get');
            try { window.__tsu_pk_get_inflight = false; } catch(_) {}
            throw new DOMException('Cancelled by takeover guard', 'AbortError');
          }
        } catch(_) {}
        // マスターOFF中はフルパススルー（当方以外の動作・抑止を行わない）
        try {
          if (!autoEnabled() && window.__tsu_pk_ours !== true) {
            const og = (window.__tsu_orig_get || null);
            if (og) return await og.call(navigator.credentials, options);
          }
        } catch(_) {}
        // 進行中の get() がある場合のシリアライズ制御
        try {
          if (window.__tsu_pk_get_inflight) {
            if (window.__tsu_pk_ours === true && window.__tsu_pk_inflight_promise) {
              console.info('[tsu] injected: returning existing inflight get() promise (owned re-entry)');
              return await window.__tsu_pk_inflight_promise;
            } else {
              console.info('[tsu] injected: blocking site get() due to inflight');
              throw new DOMException('Blocked due to inflight', 'AbortError');
            }
          }
        } catch(_) {}
        try { if (window.__tsu_pk_prefer_fallback === true) ensureDisableConditionalAvail(); } catch(_) {}
        const pub = options && options.publicKey;
        let mediation = (options && options.mediation) || '';
        if (window.__tsu_pk_prefer_fallback === true && window.__tsu_pk_takeover !== true && conditionalAllowedNow()) {
          try { if (options) { options.mediation = 'required'; mediation = 'required'; console.info('[tsu] injected: coercing mediation to required due to prefer_fallback'); } } catch(_) {}
        }
        const isConditional = String(mediation) === 'conditional';
        // マスターOFF時のみ、許可ウィンドウ外の get() を抑止（リロード直後の不意なOSポップアップ対策）
        try {
          if (!autoEnabled()) {
            // passkey.io は「Sign in with a passkey」ボタン押下で get() を起動する。
            // activeElement が入力欄でなくてもユーザー操作直後の get() を抑止するとログイン不能になるため、例外的に許可する。
            if (isPasskeyIo) {
              try { window.__tsu_cond_ok_until = Date.now() + 6000; } catch(_) {}
            }
            const allowed = conditionalAllowedNow();
            if (!allowed && !isPasskeyIo && window.__tsu_pk_prefer_fallback !== true && window.__tsu_pk_ours !== true) {
              if (conditionalGraceActive()) {
                console.info('[tsu] injected: allow get during conditional grace window');
              } else {
                console.info('[tsu] injected: suppress get (not in allow window)');
                throw new DOMException('Suppressed by policy (not in allow window)', 'AbortError');
              }
            }
          }
        } catch(_) {}
        // 条件付きUIの抑止は、マスターOFF時のみ適用（ON時は機会を確保）
        try {
          if (isConditional) {
            const okUntil = Number(window.__tsu_cond_ok_until || 0);
            const ok = okUntil && Date.now() < okUntil;
            if (!ok && !isPasskeyIo && window.__tsu_pk_prefer_fallback !== true && !autoEnabled()) {
              if (conditionalGraceActive()) {
                console.info('[tsu] injected: allow conditional get during grace window');
              } else {
                console.info('[tsu] injected: suppress conditional get (not in allow window)');
                throw new DOMException('Conditional UI suppressed', 'AbortError');
              }
            }
          }
        } catch(_) {}
        // 成功後のサイレント期間は、当方以外の get() を抑止
        try {
          const qt = Number(window.__tsu_pk_quiet_until || 0);
          if (qt && Date.now() < qt && window.__tsu_pk_ours !== true) {
            console.info('[tsu] injected: suppressing site get() (quiet window after success)');
            throw new DOMException('Suppressed after success', 'AbortError');
          }
        } catch(_) {}
        // 直近 options のキャッシュ（ハードテイクオーバー用）。ブロック前に必ず確保する。
        try { window.__tsu_pk_last_options = options; if (pub) window.__tsu_pk_last_pubkey = pub; } catch(_) {}
        // prefer_fallback 中はサイト発の get() をブロック。ただし即座に当方の get() をスケジュールして引き継ぐ。
        try {
          if (window.__tsu_pk_prefer_fallback === true && window.__tsu_pk_ours !== true) {
            console.info('[tsu] injected: blocking site-initiated get() during prefer_fallback (redirect to ours)');
            try { (window.queueMicrotask ? queueMicrotask : setTimeout)(() => { try { startHardTakeover('block-redirect'); } catch(_) {} }, 0); } catch(_) {}
            throw new DOMException('Blocked by prefer_fallback takeover', 'AbortError');
          }
        } catch(_) {}
        // prefer_fallback 中はサイトの conditional get を required に変換して競合を解消
        if (window.__tsu_pk_prefer_fallback === true && isConditional) {
          try { console.info('[tsu] injected: converting site conditional get to required due to prefer_fallback'); } catch(_) {}
          try { options.mediation = 'required'; mediation = 'required'; } catch(_) {}
        }
        // strict 窓口中は当方以外の get() をブロック
        try {
          const strictSince = Number(window.__tsu_pk_force_strict_ts || 0);
          const strictActive = !!strictSince && (Date.now() - strictSince) < 15000; // フォールバック直後の get は厳格（15秒）
          // 既に get 実行中であれば、再入（自他問わず）を遮断（Cancel連鎖を避ける）。ただし Takeover は許可
          const depth = Number(window.__tsu_pk_get_depth || 0);
          if (strictActive && depth > 0) {
            if (window.__tsu_pk_takeover === true) {
              console.info('[tsu] injected: allow re-entrant get for takeover during strict window');
            } else {
              console.info('[tsu] injected: blocking re-entrant get during strict window');
              throw new DOMException('Blocked re-entrant during strict window', 'AbortError');
            }
          }
          // 条件付きUI検出直後（strictActive）では、非所有の get を抑止して競合キャンセルを防止
          if (strictActive && (window.__tsu_pk_prefer_fallback === true || window.__tsu_pk_is_conditional === true) && window.__tsu_pk_ours !== true) {
            console.info('[tsu] injected: blocking non-owned get during strict window');
            throw new DOMException('Blocked during strict window', 'AbortError');
          }
        } catch(_) {}
        try {
          window.__tsu_pk_is_conditional = !!isConditional;
          if (isConditional) { window.__tsu_pk_cond_detect_ts = Date.now(); window.__tsu_pk_force_strict_ts = Date.now(); nudgeConditionalUI(); }
        } catch(_) {}
        if (pub) {
          try {
            if (pub.rpId) window.__tsu_pk_cache.rpId = String(pub.rpId);
            if (!window.__tsu_pk_cache.title && document && document.title) window.__tsu_pk_cache.title = String(document.title);
            // 優先 credential を allowCredentials へ先頭追加
            try {
              if (isConditional) {
                try { console.info('[tsu] injected: conditional mediation detected'); } catch(_) {}
                try { window.__tsu_pk_cond_detect_ts = Date.now(); } catch(_) {}
                try { nudgeConditionalUI(); } catch(_) {}
              }
              const pref = (window.__tsu_pk_preferred || null);
              if (pref && pref.credentialIdB64) {
                try { console.info('[tsu] injected: applying preferred credential to allowCredentials'); } catch(_) {}
                const matchRp = () => {
                  try {
                    const reqRp = (pub && pub.rpId) ? String(pub.rpId).toLowerCase() : '';
                    const cur = String(location.hostname || '').toLowerCase();
                    const want = String(pref.rpId || '').toLowerCase();
                    if (!want) return true;
                    const ok = (!!reqRp ? (reqRp === want) : (cur === want || cur.endsWith('.'+want)));
                    try { console.info('[tsu] injected: rpId match check', { reqRp, cur, want, ok }); } catch(_) {}
                    return ok;
                  } catch(_) { return true; }
                };
                if (!matchRp()) {
                  // rpId が一致しない場合は allowCredentials には手を入れない
                } else {
                  const strictSince = Number(window.__tsu_pk_force_strict_ts || 0);
                  const strict = !!strictSince && (Date.now() - strictSince) < 10000; // フォールバック直後の get は厳格（10秒）
                  const ac = (pub.allowCredentials && Array.isArray(pub.allowCredentials)) ? pub.allowCredentials.slice() : [];
                  try { console.info('[tsu] injected: before allowCredentials length', ac.length); } catch(_) {}
                  const prefId = b64uToBytes(pref.credentialIdB64);
                  if (!prefId || prefId.length === 0) {
                    try { console.info('[tsu] injected: preferred credentialIdB64 decode failed; skip allowCredentials modification'); } catch(_) {}
                    // 不正な preferred を混入させると候補が0件になり得るため、何もしない
                    return;
                  }
                  const bytesEq = (a,b) => { if (!a || !b || a.length!==b.length) return false; for (let i=0;i<a.length;i++) if (a[i]!==b[i]) return false; return true; };
                  const toAB = (u8) => { try { return (u8 && u8.buffer) ? (u8.byteOffset===0 && u8.byteLength===u8.buffer.byteLength ? u8.buffer.slice(0) : u8.slice().buffer) : new ArrayBuffer(0); } catch(_) { return new ArrayBuffer(0); } };
                  let found = -1;
                  const norm = [];
                  ac.forEach((x, i) => {
                    try {
                      const id = (x && x.id);
                      let buf = null;
                      if (id instanceof ArrayBuffer) buf = new Uint8Array(id);
                      else if (ArrayBuffer.isView(id)) buf = new Uint8Array(id.buffer, id.byteOffset, id.byteLength);
                      else if (typeof id === 'string') buf = b64uToBytes(id);
                      else buf = new Uint8Array(0);
                      // 不正/空IDは除外（OS側で候補0件になり得るため）
                      if (!buf || buf.length === 0) return;
                      if (bytesEq(buf, prefId)) found = norm.length;
                      norm.push({ type: 'public-key', id: toAB(buf), transports: x && x.transports });
                    } catch(_) {}
                  });
                  let final = norm;
                  const prefItem = { type: 'public-key', id: toAB(prefId), transports: ['internal'] };
                  if (found >= 0) {
                    const item = final.splice(found, 1)[0];
                    final.unshift(item);
                    try { console.info('[tsu] injected: preferred moved to front'); } catch(_) {}
                  } else {
                    // 既存の allowCredentials が非空なら注入しない（RP側で未知ID扱いとなり失敗する危険）。
                    // allowCredentials が空の場合も、サイトによっては「全候補許可」を意味するため、誤って注入すると候補が0件になり得る。
                    if (ac.length === 0) {
                      if (isPasskeyIo) {
                        try { console.info('[tsu] injected: passkey.io skip preferred injection when allowCredentials is empty'); } catch(_) {}
                      } else {
                        final.unshift(prefItem);
                        try { console.info('[tsu] injected: preferred injected to front (allowCredentials was empty)'); } catch(_) {}
                      }
                    } else {
                      try { console.info('[tsu] injected: preferred not present and allowCredentials non-empty; skip injection to avoid unrecognized ID'); } catch(_) {}
                    }
                  }
                  if (strict && found >= 0) {
                    if (window.__tsu_allow_strict_narrowing === true) {
                      final = [final[0]];
                      try { console.info('[tsu] injected: strict mode applied, allowCredentials narrowed to 1'); } catch(_) {}
                    } else {
                      try { console.info('[tsu] injected: strict mode bypassed (narrowing disabled by flag)'); } catch(_) {}
                    }
                  } else if (strict && found < 0) {
                    try { console.info('[tsu] injected: strict mode skipped (preferred not present in existing allowCredentials)'); } catch(_) {}
                  }
                  // 先頭の transports に 'internal' を付与してヒント強化
                  try {
                    const head = final[0];
                    if (head) {
                      const set = new Set(Array.isArray(head.transports) ? head.transports.map(String) : []);
                      set.add('internal');
                      head.transports = Array.from(set);
                    }
                  } catch(_) {}
                  try { console.info('[tsu] injected: after allowCredentials length', final.length); } catch(_) {}
                  // 変換結果が空になった場合、元の allowCredentials を壊さない
                  if (ac.length > 0 && final.length === 0) {
                    try { console.info('[tsu] injected: skip overriding allowCredentials (would become empty)'); } catch(_) {}
                  } else {
                    pub.allowCredentials = final;
                  }
                  try { window.__tsu_pk_pref_applied_ts = Date.now(); } catch(_) {}
                  // 先頭が preferred かを検証
                  try {
                    const head = final[0] && final[0].id;
                    let isFirst = false;
                    if (head && head.byteLength === prefId.byteLength) {
                      const a = new Uint8Array(head); isFirst = bytesEq(a, prefId);
                    }
                    console.info('[tsu] injected: preferred is first', isFirst);
                  } catch(_) {}
                }
              }
            } catch(_) {}
            try {
              const allow = Array.isArray(pub.allowCredentials) ? pub.allowCredentials : [];
              const trSet = new Set((window.__tsu_pk_cache.transports ? String(window.__tsu_pk_cache.transports).split(',') : []).filter(Boolean));
              for (const a of allow) {
                try {
                  const trs = (a && a.transports) || [];
                  if (Array.isArray(trs)) trs.forEach((t) => trSet.add(String(t)));
                } catch (_) {}
              }
              if (trSet.size) window.__tsu_pk_cache.transports = Array.from(trSet).join(',');
            } catch (_) {}
          } catch (_) {}
        }
      } catch (_) {}
      // 起動タイムスタンプ・フラグ（UIクールダウンも開始）
      try {
        window.__tsu_pk_last_ts = Date.now();
        window.__tsu_pk_get_inflight = true;
        if (!window.__tsu_pk_inflight_since) window.__tsu_pk_inflight_since = window.__tsu_pk_last_ts;
        window.__tsu_pk_get_depth = Number(window.__tsu_pk_get_depth||0) + 1;
        // 初回UI提示から一定時間は新規 get() を抑止（デフォルト 3.5s）
        const coolMs = Math.max(1500, Number(window.__tsu_pk_ui_cool_ms || 3500));
        window.__tsu_pk_ui_cool_until = window.__tsu_pk_last_ts + coolMs;
      } catch(_) {}
      try {
        const pub = options && options.publicKey;
        const rp = String((pub && (pub.rpId || '')) || '');
        const ac = (pub && Array.isArray(pub.allowCredentials)) ? pub.allowCredentials : [];
        console.info('[tsu] injected: get options', { rpId: rp, allowCredentialsLen: ac.length, mediation: String((options && options.mediation) || '') });
      } catch(_) {}

      let cred;
      try {
        try { window.__tsu_pk_ours = true; } catch(_) {}
        // 共有可能な in-flight Promise を確立
        const __p = origGet(options);
        try { window.__tsu_pk_inflight_promise = __p; } catch(_) {}
        cred = await __p;
        try { console.info('[tsu] injected: navigator.credentials.get resolved'); } catch(_) {}
        try { window.__tsu_pk_last_resolved_ts = Date.now(); } catch(_) {}
      } catch(e) {
        try {
          const __msg = String((e && (e.message||'')) || '');
          const __isBrowserCancelForNew = (e && e.name) === 'AbortError' && /Cancelling\s+existing\s+WebAuthn\s+API\s+call\s+for\s+new\s+one/i.test(__msg);
          (__isBrowserCancelForNew ? console.info : console.warn).call(console, '[tsu] injected: navigator.credentials.get error', e && e.name, e && e.message);
        } catch(_) {}
        // AbortError の場合、直近で preferred が設定されていれば一度だけリトライ
        const isAbort = (e && e.name) === 'AbortError';
        const msg = String((e && (e.message||'')) || '');
        const isBrowserCancelForNew = isAbort && /Cancelling\s+existing\s+WebAuthn\s+API\s+call\s+for\s+new\s+one/i.test(msg);
        const isNotAllowed = (e && e.name) === 'NotAllowedError';
        const prefSetTs = Number(window.__tsu_pk_pref_set_ts || 0);
        const now = Date.now();
        const prefRecent = prefSetTs && (now - prefSetTs) < 2000;
        const appliedTs = Number(window.__tsu_pk_pref_applied_ts || 0);
        const appliedRecent = appliedTs && (now - appliedTs) < 2000;
        const lastStart = Number(window.__tsu_pk_last_ts || 0);
        // ブラウザ由来の競合キャンセルは、一度だけのサイレント再試行候補
        // ただし UI クールダウン中は再試行せず、二重ポップアップを回避
        if (isBrowserCancelForNew && !window.__tsu_pk_retry_on_browser_cancel_done) {
          const cool = Number(window.__tsu_pk_ui_cool_until || 0);
          if (cool && Date.now() < cool) {
            try { console.info('[tsu] injected: skip browser-cancel retry due to UI cooldown'); } catch(_) {}
          } else {
            try { console.info('[tsu] injected: handling browser cancellation for new WebAuthn call (silent retry)'); } catch(_) {}
            try { window.__tsu_pk_retry_on_browser_cancel_done = true; } catch(_) {}
            try { window.__tsu_cancel_guard_on = true; } catch(_) {}
            try { ensureDisableConditionalAvail(); } catch(_) {}
            await sleep(800);
            const latestStart = Number(window.__tsu_pk_last_ts || 0);
            if (!latestStart || latestStart <= lastStart) {
              try { window.__tsu_pk_ours = true; } catch(_) {}
              let retryOpts = options;
              try { retryOpts = Object.assign({}, options || {}); retryOpts.mediation = 'required'; } catch(_) {}
              cred = await origGet(retryOpts);
              try { console.info('[tsu] injected: navigator.credentials.get resolved (browser-cancel retry)'); } catch(_) {}
              try { window.__tsu_pk_last_resolved_ts = Date.now(); } catch(_) {}
              try { setTimeout(() => { try { window.__tsu_cancel_guard_on = false; } catch(_) {} }, 2000); } catch(_) {}
              return cred;
            } else {
              try { console.info('[tsu] injected: skip browser-cancel retry, new get started'); } catch(_) {}
              try { setTimeout(() => { try { window.__tsu_cancel_guard_on = false; } catch(_) {} }, 1500); } catch(_) {}
            }
          }
        }
        // conditional mediation 中でも再試行は許可（ユーザー操作直後の文脈で UI を確実に提示するため）
        // 監視: 短時間に複数の AbortError が発生した場合の救済
        try {
          if (isAbort) {
            const arr = Array.isArray(window.__tsu_pk_abort_errors) ? window.__tsu_pk_abort_errors : [];
            const kept = arr.filter(ts => (now - ts) < 2500);
            kept.push(now);
            window.__tsu_pk_abort_errors = kept;
            if (kept.length >= 2) {
              console.info('[tsu] injected: AbortError watchdog fired', { count: kept.length });
              // 通常は無効化しているホストでも、一度だけフォールバックを許可してループを断つ
              try { window.__tsu_pk_no_fallback = false; } catch(_) {}
              try { triggerLoginFallback(); } catch(_) {}
            }
          }
        } catch(_) {}
        // NotAllowedError の救済: 直近の preferred 反映があるなら同期フォールバックを再トリガ（1回だけ）
        try {
          if (isNotAllowed && (prefRecent || appliedRecent) && !window.__tsu_pk_notallowed_fallback_fired) {
            window.__tsu_pk_notallowed_fallback_fired = true;
            setTimeout(() => { try { window.dispatchEvent(new Event('tsu:triggerPasskeyLoginSync')); } catch(_) {} }, 0);
          }
        } catch(_) {}
        if (isAbort && (prefRecent || appliedRecent) && !window.__tsu_pk_get_retried && window.__tsu_aggressive_retry === true) {
          // UI クールダウン中はアグレッシブ再試行を抑止
          const cool = Number(window.__tsu_pk_ui_cool_until || 0);
          if (cool && Date.now() < cool) {
            try { console.info('[tsu] injected: skip aggressive retry due to UI cooldown'); } catch(_) {}
            throw e;
          }
          try { console.info('[tsu] injected: considering silent retry after AbortError', { prefRecent, appliedRecent }); } catch(_) {}
          try { window.__tsu_pk_get_retried = true; } catch(_) {}
          // リトライ保護: 短時間の cancel-guard と prefer_fallback を有効化し、conditional を抑止
          try {
            if (window.__tsu_aggressive_retry === true) {
              window.__tsu_cancel_guard_on = true;
              window.__tsu_pk_prefer_fallback = true;
              try { ensureDisableConditionalAvail(); } catch(_) {}
              try { installErrorShield(); } catch(_) {}
              try { dismissConditionalUI(true); } catch(_) {}
            }
          } catch(_) {}
          await sleep(800);
          const latestStart = Number(window.__tsu_pk_last_ts || 0);
          if (!latestStart || latestStart <= lastStart) {
            try { console.info('[tsu] injected: performing silent retry (no new get started)'); } catch(_) {}
            try { if (typeof window.__tsu_guardedEsc === 'function') { await window.__tsu_guardedEsc(); } } catch(_) {}
            try { window.__tsu_pk_ours = true; } catch(_) {}
            let retryOpts = options;
            try {
              retryOpts = Object.assign({}, options || {});
              retryOpts.mediation = 'required';
            } catch(_) {}
            cred = await origGet(retryOpts);
            try { console.info('[tsu] injected: navigator.credentials.get resolved (retry)'); } catch(_) {}
            try { window.__tsu_pk_last_resolved_ts = Date.now(); } catch(_) {}
          } else {
            try { console.info('[tsu] injected: skip retry, new get started'); } catch(_) {}
            throw e;
          }
          try { setTimeout(() => { try { window.__tsu_cancel_guard_on = false; } catch(_) {} }, 2000); } catch(_) {}
        } else {
          throw e;
        }
      } finally { try { window.__tsu_pk_get_inflight = false; window.__tsu_pk_inflight_since = 0; window.__tsu_pk_inflight_promise = null; window.__tsu_pk_get_retried = false; window.__tsu_pk_ours = false; window.__tsu_pk_takeover = false; window.__tsu_pk_get_depth = Math.max(0, Number(window.__tsu_pk_get_depth||0) - 1); } catch(_) {} try { if (window.__tsu_cancel_guard_on) { setTimeout(() => { try { window.__tsu_cancel_guard_on = false; } catch(_) {} }, 800); } } catch(_) {} }
      // 成功時の詳細ログと送信キャッシュ
      try {
        if (cred && cred.type === 'public-key') {
          const id = cred && cred.id ? String(cred.id) : '';
          const raw = cred && cred.rawId ? (cred.rawId.byteLength || 0) : 0;
          const hasResp = !!(cred && cred.response && cred.response.clientDataJSON);
          console.info('[tsu] injected: get resolved detail', { idLen: id.length, rawLen: raw, hasResponse: hasResp });
          window.__tsu_pk_cache.lastAssertion = {
            id: cred.id,
            rawId: cred.rawId && b64u(cred.rawId),
            userHandle: cred.response && cred.response.userHandle && b64u(cred.response.userHandle),
            clientDataJSON: cred.response && cred.response.clientDataJSON && b64u(cred.response.clientDataJSON),
            authenticatorData: cred.response && cred.response.authenticatorData && b64u(cred.response.authenticatorData),
            signature: cred.response && cred.response.signature && b64u(cred.response.signature),
          };
          console.info('[tsu] injected: navigator.credentials.get resolved and cached');
          // ブリッジ経由の autosave を確実に発火させるため、主要キーをキャッシュに反映して通知
          try { if (cred && cred.rawId) window.__tsu_pk_cache.credentialIdB64 = b64u(cred.rawId); } catch(_) {}
          try { if (cred && cred.response && cred.response.userHandle) window.__tsu_pk_cache.userHandleB64 = b64u(cred.response.userHandle); } catch(_) {}
          // transports（正規化 + 推測）
          try {
            const resp = cred && cred.response;
            const attach = cred && cred.authenticatorAttachment;
            const norm = __tsu_normalizeTransports(resp && resp.transports, attach);
            if (norm) window.__tsu_pk_cache.transports = norm;
          } catch(_) {}
          try { if (__tsu_shouldStore()) post({ ...window.__tsu_pk_cache }); } catch(_) {}
        }
      } catch(_) {}
      return cred;
    };
} catch (_) {}
})();
