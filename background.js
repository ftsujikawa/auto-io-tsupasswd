chrome.runtime.onInstalled.addListener(() => {
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "PING") {
    sendResponse({ ok: true });
    return; // sync
  }
  if (message.type === "RUN_TSUPASSWD") {
    // ネイティブホスト名は環境に合わせて登録してください
    const hostName = message.host || "com.tsu.tsupasswd";
    chrome.storage.local.get({ auth_secret: '' }, (data) => {
      const payload = { args: message.args || [], secret: (data && data.auth_secret) || '' };
      chrome.runtime.sendNativeMessage(hostName, payload, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        const ok = !!(response) && !(response && response.ok === false);
        if (!ok) {
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
    const hostName = message.host || "com.tsu.tsupasswd";
    chrome.storage.local.get({ auth_secret: '' }, (data) => {
      const payload = { action: 'SAVE', entry, secret: (data && data.auth_secret) || '' };
      chrome.runtime.sendNativeMessage(hostName, payload, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        const ok = !(response && response.ok === false);
        if (!ok) {
          sendResponse({ ok: false, error: (response && response.error) || "native error", data: response });
        } else {
          sendResponse({ ok: true, data: response });
        }
      });
    });
    return true; // async
  }
});
