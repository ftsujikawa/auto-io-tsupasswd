const userIdInput = document.getElementById("user-id-input");
const searchBtn = document.getElementById("search-btn");
const result = document.getElementById("result");
const credBox = document.getElementById("cred-box");
const userIdText = document.getElementById("user-id-text");
const passwordField = document.getElementById("password-field");
const toggleBtn = document.getElementById("toggle-visibility");

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

window.tsupasswd = window.tsupasswd || {};
(function(){
  function runTsupasswd(urlStr) {
    return new Promise(function(resolve, reject) {
      try {
        // 設定は window.tsupasswd から安全に取得
        const cfg = window.tsupasswd || {};
        const args = Array.isArray(cfg.extraArgs) ? cfg.extraArgs.slice() : [];
        if (urlStr) args.push(urlStr);
        const nativeHost = cfg.host || "com.tsu.tsupasswd";
        chrome.runtime.sendMessage({ type: "RUN_TSUPASSWD", host: nativeHost, args: args }, function(resp) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!resp || !resp.ok) {
            reject(new Error((resp && resp.error) ? resp.error : "Unknown error"));
            return;
          }
          // 常に JSON 文字列を返す
          const payload = (typeof resp.data === "string") ? resp.data : JSON.stringify(resp.data);
          resolve(payload);
        });
      } catch (e) {
        reject(e);
      }
    });
  }
  window.tsupasswd.get = async function(urlStr) {
    // ここでネイティブホスト経由で tsupasswd を実行
    // 返却形式はネイティブホスト側の実装に合わせてください。
    // 期待する戻り値の一例: { username: "...", password: "..." }
    const data = await runTsupasswd(urlStr);
    // 常に JSON 文字列で返す
    if (typeof data === "string") {
      return data.trim();
    }
    // オブジェクトで返ってきた場合は必要フィールドのみ整形
    return JSON.stringify({ username: (data && data.username) || "", password: (data && data.password) || "" });
  };
  window.tsupasswd.search = async function(query) {
    const raw = await runTsupasswd(query);
    const text = (typeof raw === 'string') ? raw.trim() : JSON.stringify(raw || {});
    try {
      return JSON.parse(text);
    } catch (_) {
      // 非JSONの可能性は低いが、失敗時は空の形で返す
      return { ok: false, error: 'invalid json', raw: text };
    }
  };
})();

async function handleSearch() {
  const query = (userIdInput && userIdInput.value || '').trim();
  credBox.style.display = 'none';
  passwordField.type = 'password';
  toggleBtn.textContent = '表示';
  if (!query) {
    result.textContent = 'ユーザIDを入力してください。';
    return;
  }
  result.textContent = '検索中…';
  try {
    const resp = await window.tsupasswd.search(query);
    if (!resp || resp.ok === false) {
      result.textContent = '検索に失敗しました。' + (resp && resp.error ? ' ' + resp.error : '');
      return;
    }
    // entries優先、なければ username/password を使う
    let username = '';
    let password = '';
    if (resp && Array.isArray(resp.entries) && resp.entries.length) {
      username = resp.entries[0].username || '';
      password = resp.entries[0].password || '';
    } else {
      username = resp.username || '';
      password = resp.password || '';
    }
    if (!username && !password) {
      result.textContent = '該当する資格情報が見つかりません。';
      return;
    }
    userIdText.textContent = username || query;
    passwordField.value = password || '';
    credBox.style.display = 'block';
    result.textContent = '';
  } catch (e) {
    console.error(e);
    result.textContent = 'エラー: ' + (e && e.message ? e.message : e);
  }
}

function handleToggleVisibility() {
  if (passwordField.type === 'password') {
    passwordField.type = 'text';
    toggleBtn.textContent = '非表示';
  } else {
    passwordField.type = 'password';
    toggleBtn.textContent = '表示';
  }
}

if (searchBtn) searchBtn.addEventListener('click', handleSearch);
if (userIdInput) userIdInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleSearch();
});
if (toggleBtn) toggleBtn.addEventListener('click', handleToggleVisibility);
