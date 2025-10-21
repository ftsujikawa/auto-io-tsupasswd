chrome.runtime.onInstalled.addListener(() => {
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const sendNativeWithFallback = (hosts, payload, cb) => {
    const list = Array.isArray(hosts) ? hosts.filter(Boolean) : [hosts].filter(Boolean);
    const errs = [];
    const trySend = (idx) => {
      if (idx >= list.length) {
        const detail = errs.length ? errs.join(' | ') : 'no host available';
        cb({ ok: false, error: detail });
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
  if (message.type === "PING") {
    sendResponse({ ok: true });
    return; // sync
  }
  if (message.type === "RUN_TSUPASSWD") {
    // ネイティブホスト名は環境に合わせて登録してください
    const primary = message.host || "dev.happyfactory.tsupasswd";
    const fallback = "com.tsu.tsupasswd";
    chrome.storage.local.get({ auth_secret: '', host_name: '' }, (data) => {
      const payload = { args: message.args || [], secret: (data && data.auth_secret) || '' };
      const pref = message.host || (data && data.host_name) || '';
      const hosts = [pref || primary, primary, fallback].filter(Boolean);
      const uniq = Array.from(new Set(hosts));
      sendNativeWithFallback(uniq, payload, (response) => {
        if (!response || (response && response.ok === false)) {
          sendResponse({ ok: false, error: (response && response.error) || "native error", data: response });
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
    const primary = message.host || "dev.happyfactory.tsupasswd";
    const fallback = "com.tsu.tsupasswd";
    chrome.storage.local.get({ auth_secret: '', host_name: '' }, (data) => {
      const payload = { action: 'SAVE', entry, secret: (data && data.auth_secret) || '' };
      const pref = message.host || (data && data.host_name) || '';
      const hosts = [pref || primary, primary, fallback].filter(Boolean);
      const uniq = Array.from(new Set(hosts));
      sendNativeWithFallback(uniq, payload, (response) => {
        if (!response || (response && response.ok === false)) {
          sendResponse({ ok: false, error: (response && response.error) || "native error", data: response });
        } else {
          sendResponse({ ok: true, data: response });
        }
      });
    });
    return true; // async
  }
  if (message.type === "AUTH_TSUPASSWD") {
    const primary = message.host || "dev.happyfactory.tsupasswd";
    const fallback = "com.tsu.tsupasswd";
    const provided = message.secret || '';
    const mode = message.mode || 'secret';
    const proceed = (secretFromStore, hostPref) => {
      const secret = provided || secretFromStore || '';
      const payload = { action: 'AUTH', mode, secret };
      const hosts = [hostPref || primary, primary, fallback].filter(Boolean);
      const uniq = Array.from(new Set(hosts));
      sendNativeWithFallback(uniq, payload, (response) => {
        if (!response || (response && response.ok === false)) {
          sendResponse({ ok: false, error: (response && response.error) || 'native error', data: response });
        } else {
          sendResponse({ ok: true, data: response });
        }
      });
    };
    chrome.storage.local.get({ auth_secret: '', host_name: '' }, (data) => {
      const hostPref = message.host || (data && data.host_name) || '';
      if (!provided) {
        proceed((data && data.auth_secret) || '', hostPref);
      } else {
        proceed('', hostPref);
      }
    });
    return true; // async
  }
});
