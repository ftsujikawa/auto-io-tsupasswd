chrome.runtime.onInstalled.addListener(() => {
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "PING") {
    sendResponse({ ok: true });
    return; // sync
  }
  if (message.type === "RUN_TSUPASSWD") {
    const payload = { args: message.args || [] };
    // ネイティブホスト名は環境に合わせて登録してください
    const hostName = message.host || "com.tsu.tsupasswd";
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
    return true; // async response
  }
  if (message.type === "SAVE_TSUPASSWD") {
    // payload は { action: 'SAVE', entry: { title, url, username, password, note } }
    const entry = message.entry || {};
    const payload = { action: 'SAVE', entry };
    const hostName = message.host || "com.tsu.tsupasswd";
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
    return true; // async
  }
});
