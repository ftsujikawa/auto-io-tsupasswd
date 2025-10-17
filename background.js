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
      sendResponse({ ok: true, data: response });
    });
    return true; // async response
  }
});
