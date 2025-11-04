chrome.runtime.onInstalled.addListener(() => {
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try { console.log('[tsu][bg] onMessage:', { type: message && message.type, from: sender && sender.tab ? 'content' : 'unknown' }); } catch(_) {}
  const sendNativeWithFallback = (hosts, payload, cb) => {
    const list = Array.isArray(hosts) ? hosts.filter(Boolean) : [hosts].filter(Boolean);
    const errs = [];
    const trySend = (idx) => {
      if (idx >= list.length) {
        const detail = errs.length ? errs.join(' | ') : 'no host available';
        cb({ ok: false, error: detail, data: { errors: errs.slice(), hosts: list.slice() } });
        return;
      }
      const host = list[idx];
      chrome.runtime.sendNativeMessage(host, payload, (response) => {
        if (chrome.runtime.lastError) {
          try { errs.push(`${host}: ${chrome.runtime.lastError.message}`); } catch (_) { errs.push(`${host}: lastError`); }
          return trySend(idx + 1);
        }
        cb(response);
      });
    };
    trySend(0);
  };
  // 共通のホスト候補生成（message.host → storage.host_name → 既定 → フォールバック群）
  const buildHostCandidates = (msgHost, storeHost) => {
    const primaryDefault = 'dev.happyfactory.tsupasswd';
    const fallbacks = ['dev.happyfactory.tsupasswd'];
    const base = msgHost || storeHost || primaryDefault;
    return Array.from(new Set([base, ...fallbacks].filter(Boolean)));
  };
  if (message.type === "PING") {
    sendResponse({ ok: true });
    return; // sync
  }
  if (message.type === "RUN_TSUPASSWD") {
    try {
      let settled = false;
      const tid = setTimeout(() => { if (settled) return; settled = true; try { sendResponse({ ok: false, error: 'timeout: RUN_TSUPASSWD' }); } catch(_) {} }, 15000);
      // ネイティブホスト名は環境に合わせて登録してください
      chrome.storage.local.get({ auth_secret: '', host_name: '', tsupasswd_bin: '' }, (data) => {
        try {
          const payload = { args: message.args || [], secret: (message && message.secret) || (data && data.auth_secret) || '' };
          const binPath = (message && message.bin) || (data && data.tsupasswd_bin) || '';
          if (binPath) payload.bin = binPath;
          const hosts = buildHostCandidates(message.host || '', (data && data.host_name) || '');
          try {
            console.log('[tsu][bg] RUN begin', {
              hosts,
              args: payload.args,
              bin: binPath || null,
            });
          } catch(_) {}
          sendNativeWithFallback(hosts, payload, (response) => {
            if (settled) return; settled = true; try { clearTimeout(tid); } catch(_) {}
            try {
              console.log('[tsu][bg] RUN end', {
                ok: !!(response && response.ok),
                err: (response && response.error) || null,
                cmd: (response && (response.cmd || (response.data && response.data.cmd))) || null,
              });
            } catch(_) {}
            if (!response || (response && response.ok === false)) {
              const base = { ok: false, error: (response && response.error) || "native error" };
              const dataOut = response && response.data ? response.data : {};
              sendResponse({ ...base, data: dataOut });
            } else {
              sendResponse({ ok: true, data: response });
            }
          });
        } catch (e) {
          if (settled) return; settled = true; try { clearTimeout(tid); } catch(_) {}
          try { sendResponse({ ok: false, error: String(e && e.message || e) }); } catch(_) {}
        }
      });
      return true; // async response
    } catch (e) {
      try { sendResponse({ ok: false, error: String(e && e.message || e) }); } catch(_) {}
      return false;
    }
  }
  if (message.type === "SAVE_TSUPASSWD") {
    try {
      let settled = false;
      const tid = setTimeout(() => { if (settled) return; settled = true; try { sendResponse({ ok: false, error: 'timeout: SAVE_TSUPASSWD' }); } catch(_) {} }, 20000);
      // payload は { action: 'SAVE', entry: { title, url, username, password, note, credential?, meta? } }
      const entry = message.entry || {};
      chrome.storage.local.get({ auth_secret: '', host_name: '', tsupasswd_bin: '' }, (data) => {
        try {
          const payload = { action: 'SAVE', entry, secret: (message && message.secret) || (data && data.auth_secret) || '' };
          const binPath = (message && message.bin) || (data && data.tsupasswd_bin) || '';
          if (binPath) payload.bin = binPath;
          const hosts = buildHostCandidates(message.host || '', (data && data.host_name) || '');
          try {
            const m = (entry && entry.meta) || {};
            console.log('[tsu][bg] SAVE begin', {
              hostCandidates: hosts,
              hasCredential: !!(entry && entry.credential),
              rpId: m.rpId || m.rp_id || null,
              userHandle: m.userHandle || null,
              title: entry && entry.title || null,
            });
          } catch(_) {}
          sendNativeWithFallback(hosts, payload, (response) => {
            if (settled) return; settled = true; try { clearTimeout(tid); } catch(_) {}
            try {
              console.log('[tsu][bg] SAVE end', {
                ok: !!(response && response.ok),
                err: (response && response.error) || null,
                cmd: (response && (response.cmd || (response.data && response.data.cmd))) || null,
              });
            } catch(_) {}
            if (!response || (response && response.ok === false)) {
              const base = { ok: false, error: (response && response.error) || "native error" };
              const dataOut = response && response.data ? response.data : {};
              sendResponse({ ...base, data: dataOut });
            } else {
              sendResponse({ ok: true, data: response });
            }
          });
        } catch (e) {
          if (settled) return; settled = true; try { clearTimeout(tid); } catch(_) {}
          try { sendResponse({ ok: false, error: String(e && e.message || e) }); } catch(_) {}
        }
      });
      return true; // async
    } catch (e) {
      try { sendResponse({ ok: false, error: String(e && e.message || e) }); } catch(_) {}
      return false;
    }
  }
  if (message.type === "DELETE_TSUPASSWD") {
    // payload は { action: 'DELETE', entry: { url, username } }
    const entry = message.entry || {};
    try {
      let settled = false;
      const tid = setTimeout(() => { if (settled) return; settled = true; try { sendResponse({ ok: false, error: 'timeout: DELETE_TSUPASSWD' }); } catch(_) {} }, 15000);
      chrome.storage.local.get({ auth_secret: '', host_name: '', tsupasswd_bin: '' }, (data) => {
        try {
          const payload = { action: 'DELETE', entry, secret: (message && message.secret) || (data && data.auth_secret) || '' };
          const binPath = (message && message.bin) || (data && data.tsupasswd_bin) || '';
          if (binPath) payload.bin = binPath;
          const hosts = buildHostCandidates(message.host || '', (data && data.host_name) || '');
          sendNativeWithFallback(hosts, payload, (response) => {
            if (settled) return; settled = true; try { clearTimeout(tid); } catch(_) {}
            if (!response || (response && response.ok === false)) {
              const base = { ok: false, error: (response && response.error) || "native error" };
              const dataOut = response && response.data ? response.data : {};
              sendResponse({ ...base, data: dataOut });
            } else {
              sendResponse({ ok: true, data: response });
            }
          });
        } catch (e) {
          if (settled) return; settled = true; try { clearTimeout(tid); } catch(_) {}
          try { sendResponse({ ok: false, error: String(e && e.message || e) }); } catch(_) {}
        }
      });
      return true; // async
    } catch (e) {
      try { sendResponse({ ok: false, error: String(e && e.message || e) }); } catch(_) {}
      return false;
    }
  }
  if (message.type === "AUTH_TSUPASSWD") {
    const provided = message.secret || '';
    const mode = message.mode || 'secret';
    const proceed = (secretFromStore, hostPref, binPath) => {
      const secret = provided || secretFromStore || '';
      const payload = { action: 'AUTH', mode, secret };
      if (binPath) payload.bin = binPath;
      const hosts = buildHostCandidates(message.host || '', hostPref || '');
      sendNativeWithFallback(hosts, payload, (response) => {
        if (!response || (response && response.ok === false)) {
          const base = { ok: false, error: (response && response.error) || 'native error' };
          const dataOut = response && response.data ? response.data : {};
          sendResponse({ ...base, data: dataOut });
        } else {
          sendResponse({ ok: true, data: response });
        }
      });
    };
    chrome.storage.local.get({ auth_secret: '', host_name: '', tsupasswd_bin: '' }, (data) => {
      const hostPref = message.host || (data && data.host_name) || '';
      if (!provided) {
        proceed((data && data.auth_secret) || '', hostPref, (data && data.tsupasswd_bin) || '');
      } else {
        proceed('', hostPref, (data && data.tsupasswd_bin) || '');
      }
    });
    return true; // async
  }
  if (message.type === 'PING') {
    try { sendResponse({ ok: true, ts: Date.now() }); } catch(_) {}
    return false; // sync
  }
  if (message.type === 'TSU_FETCH') {
    (async () => {
      try {
        try { console.log('[tsu][bg] TSU_FETCH begin:', { url: message && message.url, method: message && message.method }); } catch(_) {}
        const url = message.url;
        const method = message.method || 'GET';
        const headers = message.headers || {};
        const body = typeof message.body === 'string' ? message.body : (message.body ? JSON.stringify(message.body) : undefined);
        const controller = new AbortController();
        const tid = setTimeout(() => { try { controller.abort(); } catch(_) {} }, Math.max(10000, message.timeout || 0));
        let res;
        try {
          res = await fetch(url, { method, headers, body, signal: controller.signal });
        } finally { clearTimeout(tid); }
        let data;
        try {
          const ct = (res && res.headers && res.headers.get && res.headers.get('content-type')) ? res.headers.get('content-type') : '';
          data = ct && ct.includes('application/json') ? await res.json() : await res.text();
        } catch (e) { data = null; }
        try { console.log('[tsu][bg] TSU_FETCH end:', { status: (res && res.status) || 0, ok: !!(res && res.ok) }); } catch(_) {}
        try { sendResponse({ ok: !!(res && res.ok), status: (res && res.status) || 0, data, headers: res ? Array.from(res.headers.entries()) : [] }); } catch(_) {}
      } catch (e) {
        try { console.log('[tsu][bg] TSU_FETCH error:', e && e.message ? e.message : e); } catch(_) {}
        try { sendResponse({ ok: false, status: 0, error: String((e && e.message) || e) }); } catch(_) {}
      }
    })();
    return true; // async
  }
  // 未知のメッセージにも応答してチャネルを閉じる
  try { sendResponse({ ok: false, error: 'unknown message.type' }); } catch(_) {}
  return false;
});

