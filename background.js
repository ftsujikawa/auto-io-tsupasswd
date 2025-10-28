chrome.runtime.onInstalled.addListener(() => {
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
    // ネイティブホスト名は環境に合わせて登録してください
    chrome.storage.local.get({ auth_secret: '', host_name: '', tsupasswd_bin: '' }, (data) => {
      const payload = { args: message.args || [], secret: (message && message.secret) || (data && data.auth_secret) || '' };
      const binPath = (message && message.bin) || (data && data.tsupasswd_bin) || '';
      if (binPath) payload.bin = binPath;
      const hosts = buildHostCandidates(message.host || '', (data && data.host_name) || '');
      sendNativeWithFallback(hosts, payload, (response) => {
        if (!response || (response && response.ok === false)) {
          const base = { ok: false, error: (response && response.error) || "native error" };
          const dataOut = response && response.data ? response.data : {};
          sendResponse({ ...base, data: dataOut });
        } else {
          sendResponse({ ok: true, data: response });
        }
      });
    });
    return true; // async response
  }
  if (message.type === "SAVE_TSUPASSWD") {
    // payload は { action: 'SAVE', entry: { title, url, username, password, note } }
    const entry = message.entry || {};
    chrome.storage.local.get({ auth_secret: '', host_name: '', tsupasswd_bin: '' }, (data) => {
      const payload = { action: 'SAVE', entry, secret: (message && message.secret) || (data && data.auth_secret) || '' };
      const binPath = (message && message.bin) || (data && data.tsupasswd_bin) || '';
      if (binPath) payload.bin = binPath;
      const hosts = buildHostCandidates(message.host || '', (data && data.host_name) || '');
      sendNativeWithFallback(hosts, payload, (response) => {
        if (!response || (response && response.ok === false)) {
          const base = { ok: false, error: (response && response.error) || "native error" };
          const dataOut = response && response.data ? response.data : {};
          sendResponse({ ...base, data: dataOut });
        } else {
          sendResponse({ ok: true, data: response });
        }
      });
    });
    return true; // async
  }
  if (message.type === "DELETE_TSUPASSWD") {
    // payload は { action: 'DELETE', entry: { url, username } }
    const entry = message.entry || {};
    chrome.storage.local.get({ auth_secret: '', host_name: '', tsupasswd_bin: '' }, (data) => {
      const payload = { action: 'DELETE', entry, secret: (message && message.secret) || (data && data.auth_secret) || '' };
      const binPath = (message && message.bin) || (data && data.tsupasswd_bin) || '';
      if (binPath) payload.bin = binPath;
      const hosts = buildHostCandidates(message.host || '', (data && data.host_name) || '');
      sendNativeWithFallback(hosts, payload, (response) => {
        if (!response || (response && response.ok === false)) {
          const base = { ok: false, error: (response && response.error) || "native error" };
          const dataOut = response && response.data ? response.data : {};
          sendResponse({ ...base, data: dataOut });
        } else {
          sendResponse({ ok: true, data: response });
        }
      });
    });
    return true; // async
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
});

