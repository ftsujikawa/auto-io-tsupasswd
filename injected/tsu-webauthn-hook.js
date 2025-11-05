;(function () {
  try {
    if (window.__tsu_webauthn_page_hooked || !navigator || !navigator.credentials) return;
    window.__tsu_webauthn_page_hooked = true;
    window.__tsu_pk_cache = window.__tsu_pk_cache || {};

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

    const origCreate = navigator.credentials.create.bind(navigator.credentials);
    const origGet = navigator.credentials.get.bind(navigator.credentials);
    const post = (cache) => {
      try { window.postMessage({ __tsu: true, type: 'tsu:passkeyCaptured', cache }, '*'); } catch (_) {}
    };

    // --- Network probe: detect if WebAuthn assertion is sent to server ---
    function installNetworkProbe() {
      try {
        if (window.__tsu_net_probe_installed) return;
        window.__tsu_net_probe_installed = true;
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
                    if (!b) return;
                    if (typeof b === 'string') {
                      const t = b;
                      if (/"id"\s*:/.test(t) && /"response"\s*:/.test(t)) {
                        try { console.info('[tsu] injected: fetch body looks like WebAuthn assertion', { url, method }); } catch(_) {}
                      }
                      return;
                    }
                    if (b instanceof FormData) {
                      try {
                        let has = false;
                        b.forEach((v,k)=>{ if (!has && /^(id|rawId|response)$/i.test(String(k))) has = true; });
                        if (has) console.info('[tsu] injected: fetch FormData contains WebAuthn fields', { url, method });
                      } catch(_) {}
                      return;
                    }
                  } catch(_) {}
                };
                if (method !== 'GET') await logAssertionIfAny(body);
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
                if (method !== 'GET' && typeof body === 'string') {
                  const t = body;
                  if (/"id"\s*:/.test(t) && /"response"\s*:/.test(t)) {
                    try { console.info('[tsu] injected: XHR body looks like WebAuthn assertion', { url, method }); } catch(_) {}
                  }
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
    const isFallbackDisabledForHost = () => {
      try {
        // 既定ではドメインによる抑止は行わない。必要なら window.__tsu_pk_no_fallback = true で明示的に無効化。
        if (window.__tsu_pk_no_fallback === true) return true;
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
          if (force === true) {
            if (cd && (now - cd) < 1200) {
              console.info('[tsu] injected: triggerLoginFallback forced skipped (cooldown)', { sinceMs: now - cd });
              return;
            }
            window.__tsu_pk_force_cd_ts = now;
          }
        } catch(_) {}
        // 強制時でも、同期イベント経由の起動では待機せずに即時実行してユーザーアクティベーションを保持
        try {
          if (force === true && noWait !== true) {
            const start = Date.now();
            while (!(window.__tsu_pk_preferred && window.__tsu_pk_preferred.credentialIdB64)) {
              if ((Date.now() - start) > 200) break;
              await sleep(20);
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
            while (window.__tsu_pk_get_inflight) {
              if ((Date.now() - start) > 1500) break;
              await sleep(50);
            }
            const waited = Date.now() - start;
            console.info('[tsu] injected: forced fallback inflight wait done', { waitedMs: waited, cleared: !window.__tsu_pk_get_inflight });
            if (window.__tsu_pk_get_inflight) {
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
            if (inflight && appliedRecent) {
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
          // クリックの連打を抑止
          try {
            const lastClick = Number(window.__tsu_pk_last_click_ts || 0);
            const now2 = Date.now();
            if (!lastClick || (now2 - lastClick) > 800) {
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
            // 同期イベントからの強制フォールバックに一本化（ここではスケジュールしない）
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
              if (unresolved && sinceCond > 8000) {
                console.info('[tsu] injected: final bypass enabling prefer_fallback and forcing');
                try { window.__tsu_pk_prefer_fallback = true; } catch(_) {}
                await triggerLoginFallback(true, true);
              } else {
                console.info('[tsu] injected: final bypass skip', { inflight, sinceCondMs: sinceCond, unresolved });
              }
            } catch(_) {} finally { try { window.__tsu_pk_final_bypass_sched = false; } catch(_) {} }
          }, 8000);
          return true;
        } catch(_) { return false; }
      };
      const scheduleInflightRescue = () => {
        try {
          if (!window.__tsu_pk_is_conditional) return false;
          if (window.__tsu_pk_prefer_fallback === true) {
            console.info('[tsu] injected: inflight rescue bypass via prefer_fallback');
            (async () => { try { await triggerLoginFallback(true, true); } catch(_) {} })();
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
            (async () => { try { await triggerLoginFallback(true, true); } catch(_) {} })();
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
    const cborDecodeItem = (u8, offset) => {
      const len = u8.length;
      if (offset >= len) throw new Error('OOB');
      const ib = u8[offset];
      const major = ib >> 5;
      let ai = ib & 0x1f;
      let pos = offset + 1;
      const readLen = (n) => { if (pos + n > len) throw new Error('OOB'); let v = 0; for (let i=0;i<n;i++) v = (v<<8) | u8[pos+i]; pos += n; return v; };
      const readAddl = () => { if (ai < 24) return ai; if (ai === 24) return readLen(1); if (ai === 25) return readLen(2); if (ai === 26) return readLen(4); if (ai === 27) { const hi = readLen(4), lo = readLen(4); return hi * 0x100000000 + lo; } throw new Error('indef'); };
      if (major === 0) { const v = readAddl(); return { value: v, length: pos - offset }; }
      else if (major === 1) { const v = readAddl(); return { value: -1 - v, length: pos - offset }; }
      else if (major === 2) { const l = readAddl(); if (pos + l > len) throw new Error('OOB'); const val = u8.slice(pos, pos + l); pos += l; return { value: val, length: pos - offset }; }
      else if (major === 3) { const l = readAddl(); if (pos + l > len) throw new Error('OOB'); const val = new TextDecoder('utf-8').decode(u8.slice(pos, pos + l)); pos += l; return { value: val, length: pos - offset }; }
      else if (major === 4) { const l = readAddl(); const arr = []; for (let i=0;i<l;i++) { const it = cborDecodeItem(u8, pos); arr.push(it.value); pos += it.length; } return { value: arr, length: pos - offset }; }
      else if (major === 5) { const l = readAddl(); const obj = {}; for (let i=0;i<l;i++) { const k = cborDecodeItem(u8, pos); pos += k.length; const v = cborDecodeItem(u8, pos); pos += v.length; obj[k.value] = v.value; } return { value: obj, length: pos - offset }; }
      else if (major === 6) { readAddl(); const inner = cborDecodeItem(u8, pos); pos += inner.length; return { value: inner.value, length: pos - offset }; }
      else if (major === 7) { return { value: null, length: pos - offset }; }
      throw new Error('bad');
    };
    const parseAttestation = (u8) => {
      try {
        const top = cborDecodeItem(u8, 0).value;
        const authData = top && top.authData ? toU8(top.authData) : null;
        if (!authData || authData.length < 37) return null;
        let p = 0;
        p += 32;
        const flags = authData[p]; p += 1;
        const signCount = ((authData[p] << 24) | (authData[p+1] << 16) | (authData[p+2] << 8) | authData[p+3]) >>> 0; p += 4;
        const AT = (flags & 0x40) !== 0;
        if (!AT) return { signCount };
        p += 16;
        const credIdLen = (authData[p] << 8) | authData[p+1]; p += 2;
        p += credIdLen;
        const pkItem = cborDecodeItem(authData, p);
        const raw = authData.slice(p, p + pkItem.length);
        return { signCount, publicKeyRaw: raw };
      } catch (_) { return null; }
    };

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
              if (trSet.size) window.__tsu_pk_cache.transports = Array.from(trSet).join(',');
            } catch (_) {}
          } catch (_) {}
        }
      } catch (_) {}

      const cred = await origCreate(options);
      try {
        if (cred && cred.type === 'public-key') {
          try { window.__tsu_pk_cache.credentialIdB64 = b64u(cred.rawId); } catch (_) {}
          const resp = cred && cred.response;
          try {
            if (resp && resp.attestationObject) {
              window.__tsu_pk_cache.attestationB64 = b64u(resp.attestationObject);
              const parsed = parseAttestation(toU8(resp.attestationObject));
              if (parsed) {
                if (typeof parsed.signCount === 'number') window.__tsu_pk_cache.signCount = parsed.signCount;
                if (parsed.publicKeyRaw) window.__tsu_pk_cache.publicKeyB64 = b64u(parsed.publicKeyRaw);
              }
            }
          } catch (_) {}
          try { post({ ...window.__tsu_pk_cache }); } catch (_) {}
        }
      } catch (_) {}
      return cred;
    };

    navigator.credentials.get = async function (options) {
      try {
        const pub = options && options.publicKey;
        const mediation = (options && options.mediation) || '';
        const isConditional = String(mediation) === 'conditional';
        try {
          window.__tsu_pk_is_conditional = !!isConditional;
          if (isConditional) { window.__tsu_pk_cond_detect_ts = Date.now(); nudgeConditionalUI(); }
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
                  const strict = !!strictSince && (Date.now() - strictSince) < 4000; // フォールバック直後の get は厳格（4秒）
                  const ac = (pub.allowCredentials && Array.isArray(pub.allowCredentials)) ? pub.allowCredentials.slice() : [];
                  try { console.info('[tsu] injected: before allowCredentials length', ac.length); } catch(_) {}
                  const prefId = b64ToBytes(pref.credentialIdB64);
                  const bytesEq = (a,b) => { if (!a || !b || a.length!==b.length) return false; for (let i=0;i<a.length;i++) if (a[i]!==b[i]) return false; return true; };
                  let found = -1;
                  const norm = ac.map((x, i) => {
                    try {
                      const id = (x && x.id);
                      let buf = null;
                      if (id instanceof ArrayBuffer) buf = new Uint8Array(id);
                      else if (ArrayBuffer.isView(id)) buf = new Uint8Array(id.buffer, id.byteOffset, id.byteLength);
                      else if (typeof id === 'string') buf = b64ToBytes(id);
                      else buf = new Uint8Array(0);
                      if (bytesEq(buf, prefId)) found = i;
                      return { type: 'public-key', id: buf, transports: x && x.transports };
                    } catch(_) { return { type: 'public-key', id: new Uint8Array(0) }; }
                  });
                  let final = norm;
                  const prefItem = { type: 'public-key', id: prefId };
                  if (found >= 0) {
                    const item = final.splice(found, 1)[0];
                    final.unshift(item);
                    try { console.info('[tsu] injected: preferred moved to front'); } catch(_) {}
                  } else {
                    final.unshift(prefItem);
                    try { console.info('[tsu] injected: preferred injected to front'); } catch(_) {}
                  }
                  if (strict) {
                    final = [final[0]];
                    try { console.info('[tsu] injected: strict mode applied, allowCredentials narrowed to 1'); } catch(_) {}
                  }
                  try { console.info('[tsu] injected: after allowCredentials length', final.length); } catch(_) {}
                  pub.allowCredentials = final;
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
      // 起動タイムスタンプ・フラグ
      try { window.__tsu_pk_last_ts = Date.now(); window.__tsu_pk_get_inflight = true; } catch(_) {}
      let cred;
      try {
        cred = await origGet(options);
        try { console.info('[tsu] injected: navigator.credentials.get resolved'); } catch(_) {}
        try { window.__tsu_pk_last_resolved_ts = Date.now(); } catch(_) {}
      } catch(e) {
        try { console.warn('[tsu] injected: navigator.credentials.get error', e && e.name, e && e.message); } catch(_) {}
        // AbortError の場合、直近で preferred が設定されていれば一度だけリトライ
        const isAbort = (e && e.name) === 'AbortError';
        const prefSetTs = Number(window.__tsu_pk_pref_set_ts || 0);
        const now = Date.now();
        const prefRecent = prefSetTs && (now - prefSetTs) < 2000;
        const appliedTs = Number(window.__tsu_pk_pref_applied_ts || 0);
        const appliedRecent = appliedTs && (now - appliedTs) < 2000;
        const lastStart = Number(window.__tsu_pk_last_ts || 0);
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
        if (isAbort && (prefRecent || appliedRecent) && !window.__tsu_pk_get_retried) {
          try { console.info('[tsu] injected: considering silent retry after AbortError', { prefRecent, appliedRecent }); } catch(_) {}
          try { window.__tsu_pk_get_retried = true; } catch(_) {}
          await sleep(1100);
          const latestStart = Number(window.__tsu_pk_last_ts || 0);
          if (!latestStart || latestStart <= lastStart) {
            try { console.info('[tsu] injected: performing silent retry (no new get started)'); } catch(_) {}
            cred = await origGet(options);
            try { console.info('[tsu] injected: navigator.credentials.get resolved (retry)'); } catch(_) {}
            try { window.__tsu_pk_last_resolved_ts = Date.now(); } catch(_) {}
          } else {
            try { console.info('[tsu] injected: skip retry, new get started'); } catch(_) {}
            throw e;
          }
        } else {
          throw e;
        }
      } finally { try { window.__tsu_pk_get_inflight = false; window.__tsu_pk_get_retried = false; } catch(_) {} }
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
        }
      } catch(_) {}
      return cred;
    };
} catch (_) {}
})();
