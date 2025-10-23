const userIdInput = document.getElementById("user-id-input");
const searchBtn = document.getElementById("search-btn");
const result = document.getElementById("result");
const credBox = document.getElementById("cred-box");
const userIdText = document.getElementById("user-id-text");
const passwordField = document.getElementById("password-field");
const toggleBtn = document.getElementById("toggle-visibility");
// secret 入力
const secretInput = document.getElementById('secret-input');
const secretSaveBtn = document.getElementById('secret-save');
// host 入力
const hostInput = document.getElementById('host-input');
const hostSaveBtn = document.getElementById('host-save');

const esc = (s) => { try { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); } catch(_) { return ''; } };

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
        const nativeHost = cfg.host || "dev.happyfactory.tsupasswd";
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

// シークレットの読み込み/保存
try {
  if (secretInput) {
    chrome.storage.local.get({ auth_secret: '' }, (data) => {
      try { secretInput.value = data && typeof data.auth_secret === 'string' ? data.auth_secret : ''; } catch(_) {}
    });
  }
  if (secretSaveBtn) {
    secretSaveBtn.addEventListener('click', () => {
      const v = (secretInput && secretInput.value) || '';
      chrome.storage.local.set({ auth_secret: v }, () => {
        try {
          if (result) { result.textContent = 'secretを保存しました。認証中…'; }
          // AUTH_TSUPASSWD を使用してネイティブに認証要求を送る
          chrome.runtime.sendMessage({ type: 'AUTH_TSUPASSWD', mode: 'secret', secret: v }, (resp) => {
            try {
              if (!resp || resp.ok === false) {
                if (result) {
                  const base = '認証に失敗しました。';
                  const errMsg = (resp && resp.error) ? String(resp.error) : '';
                  const data = (resp && resp.data) || {};
                  const stderr = data && data.stderr ? String(data.stderr) : '';
                  const stdout = data && data.stdout ? String(data.stdout) : '';
                  const detail = (stderr || stdout)
                    ? ('<pre style="white-space:pre-wrap;max-height:140px;overflow:auto;margin:6px 0 0;">' + esc(stderr || stdout) + '</pre>')
                    : '';
                  result.innerHTML = '<div style="display:flex;flex-direction:column;gap:6px;">'
                    + '<div style="color:#d93025;">' + esc(base + (errMsg ? (' ' + errMsg) : '')) + '</div>'
                    + detail
                    + '<div style="display:flex;justify-content:flex-end;">'
                      + '<button id="pop-err-ok" style="background:#1a73e8;color:#fff;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;">OK</button>'
                    + '</div>'
                  + '</div>';
                  const b = document.getElementById('pop-err-ok');
                  if (b) b.addEventListener('click', () => { result.innerHTML = ''; });
                }
              } else {
                if (result) result.textContent = '認証に成功しました。';
                setTimeout(() => { if (result && result.textContent === '認証に成功しました。') result.textContent = ''; }, 1200);
              }
            } catch(_) {}
          });
        } catch(_) {}
      });
    });
  }
} catch(_) {}

// ホスト名の読み込み/保存
try {
  if (hostInput) {
    chrome.storage.local.get({ host_name: '' }, (data) => {
      try { hostInput.value = data && typeof data.host_name === 'string' && data.host_name ? data.host_name : (hostInput.placeholder || ''); } catch(_) {}
    });
  }
  if (hostSaveBtn) {
    hostSaveBtn.addEventListener('click', () => {
      const v = (hostInput && hostInput.value || '').trim();
      chrome.storage.local.set({ host_name: v }, () => {
        try { if (result) { result.textContent = 'ホスト名を保存しました。'; setTimeout(() => { if (result && result.textContent === 'ホスト名を保存しました。') result.textContent = ''; }, 1200); } } catch(_) {}
      });
    });
  }
} catch(_) {}

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
      const msg = '検索に失敗しました。' + (resp && resp.error ? ' ' + resp.error : '');
      result.innerHTML = '<div style="display:flex;flex-direction:column;gap:6px;">'
        + '<div style="color:#d93025;">' + esc(msg) + '</div>'
        + '<div style="display:flex;justify-content:flex-end;">'
          + '<button id="pop-err-ok" style="background:#1a73e8;color:#fff;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;">OK</button>'
        + '</div>'
      + '</div>';
      const b = document.getElementById('pop-err-ok');
      if (b) b.addEventListener('click', () => { result.innerHTML = ''; });
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
      result.innerHTML = '<div style="display:flex;flex-direction:column;gap:6px;">'
        + '<div>該当する資格情報が見つかりません。</div>'
        + '<div style="display:flex;justify-content:flex-end;">'
          + '<button id="pop-err-ok" style="background:#1a73e8;color:#fff;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;">OK</button>'
        + '</div>'
      + '</div>';
      const b = document.getElementById('pop-err-ok');
      if (b) b.addEventListener('click', () => { result.innerHTML = ''; });
      return;
    }
    userIdText.textContent = username || query;
    passwordField.value = password || '';
    credBox.style.display = 'block';
    result.textContent = '';
  } catch (e) {
    console.error(e);
    const msg = 'エラー: ' + (e && e.message ? e.message : e);
    result.innerHTML = '<div style="display:flex;flex-direction:column;gap:6px;">'
      + '<div style="color:#d93025;">' + esc(msg) + '</div>'
      + '<div style="display:flex;justify-content:flex-end;">'
        + '<button id="pop-err-ok" style="background:#1a73e8;color:#fff;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;">OK</button>'
      + '</div>'
    + '</div>';
    const b = document.getElementById('pop-err-ok');
    if (b) b.addEventListener('click', () => { result.innerHTML = ''; });
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
