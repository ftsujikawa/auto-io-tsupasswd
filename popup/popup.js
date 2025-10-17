const btn = document.getElementById("get-title");
const result = document.getElementById("result");

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
})();

async function runAuto() {
  try {
    const tab = await getActiveTab();
    if (!(tab && tab.id)) {
      result.textContent = "アクティブなタブが見つかりません。";
      return;
    }

    const urlStr = tab.url || "";
    let allowed = false;
    try {
      const url = new URL(urlStr);
      allowed = url.protocol === "http:" || url.protocol === "https:" || url.protocol === "file:";
    } catch (_) {
      allowed = false;
    }
    if (!allowed) {
      result.textContent = "このページでは実行できません（chrome:// 等は不可）。";
      return;
    }

    // ポップアップからアクティブタブのcontent.jsへ指示を送る
    const sendResp = await new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(tab.id, { type: 'TSUPASSWD_FILL' }, (resp) => resolve(resp));
      } catch (_) { resolve(null); }
    });
    if (sendResp && sendResp.ok) {
      result.textContent = "ユーザID/パスワードの入力を開始しました。";
    } else {
      result.textContent = "入力を開始できませんでした。ページを再読み込みしてお試しください。";
    }
    return;

    // 1) tsupasswd の実行で資格情報を取得
    let creds;
    try {
      const raw = await window.tsupasswd.get(urlStr);
      creds = (typeof raw === "string") ? JSON.parse(raw) : raw;
    } catch (e) {
      result.textContent = "資格情報の取得に失敗しました: " + ((e && e.message) ? e.message : e);
      return;
    }
    if (!creds || !creds.username || !creds.password) {
      result.textContent = "資格情報の形式が不明です。{ username, password } を想定。" + JSON.stringify(creds);
      return;
    }
    const [fillResp] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: function(creds) {
        const byHint = function(el) {
          const s = (el.name || "") + " " + (el.id || "") + " " + (el.autocomplete || "");
          return s.toLowerCase();
        };
        const isUserLike = function(el) {
          if (el.tagName !== "INPUT") return false;
          const type = (el.type || "text").toLowerCase();
          if (["hidden", "submit", "button", "checkbox", "radio"].includes(type)) return false;
          const s = byHint(el);
          return (
            type === "text" || type === "email" || type === "tel" || type === "search" || type === "username" ||
            s.includes("user") || s.includes("login") || s.includes("mail") || s.includes("email") || s.includes("account") || s.includes("id")
          );
        };
        const isPassLike = function(el) {
          return el.tagName === "INPUT" && (el.type || "").toLowerCase() === "password";
        };

        const inputs = Array.prototype.slice.call(document.querySelectorAll("input"));
        const pass = inputs.find(isPassLike);
        let user = inputs.find(isUserLike);
        // パスワードの近傍にあるユーザ欄を優先
        if (pass) {
          const form = pass.form || pass.closest("form");
          if (form) {
            const formInputs = Array.prototype.slice.call(form.querySelectorAll("input"));
            const candidate = formInputs.find(isUserLike);
            if (candidate) user = candidate;
          }
        }

        if (!pass || !user) {
          return { ok: false, reason: "入力欄が見つかりませんでした。" };
        }

        const userVal = creds.id || creds.username || "";
        const passVal = creds.password || "";

        const setVal = function(el, val) {
          el.focus();
          el.value = val;
          const event = document.createEvent("Event");
          event.initEvent("input", true, true);
          el.dispatchEvent(event);
          event.initEvent("change", true, true);
          el.dispatchEvent(event);
        };
        setVal(user, userVal);
        setVal(pass, passVal);

        // フォーカス時にユーザID/パスワード（伏せ字）を表示するインラインポップアップ
        const ensureInlinePopup = function(anchor) {
          let box = document.getElementById("tsupasswd-inline-popup");
          if (!box) {
            box = document.createElement("div");
            box.id = "tsupasswd-inline-popup";
            box.style.position = "relative";
            box.style.marginTop = "8px";
            box.style.fontSize = "12px";
            box.style.lineHeight = "1.4";
            box.style.background = "rgba(32,33,36,0.98)";
            box.style.color = "#fff";
            box.style.border = "1px solid rgba(0,0,0,0.2)";
            box.style.borderRadius = "6px";
            box.style.padding = "8px 10px";
            box.style.boxShadow = "0 2px 10px rgba(0,0,0,0.2)";
            box.style.zIndex = "2147483647";
            box.style.display = "none";
          }
          try {
            anchor.insertAdjacentElement("afterend", box);
          } catch (_) {
            if (!box.parentNode) document.body.appendChild(box);
          }
          return box;
        };
        const showMaskedPopup = function(anchor, idText, pwText) {
          const box = ensureInlinePopup(anchor);
          const masked = (pwText && pwText.length) ? "\u2022".repeat(pwText.length) : "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
          box.innerHTML = '' +
            '<div style="display:flex;flex-direction:column;gap:4px;">' +
              '<div><strong>ユーザID:</strong> <span id="tsu-id"></span></div>' +
              '<div><strong>パスワード:</strong> <span id="tsu-pw"></span></div>' +
            '</div>';
          const idSpan = box.querySelector('#tsu-id');
          const pwSpan = box.querySelector('#tsu-pw');
          if (idSpan) idSpan.textContent = idText || '';
          if (pwSpan) pwSpan.textContent = masked;
          box.style.display = 'block';
        };
        const hidePopup = function() {
          const box = document.getElementById('tsupasswd-inline-popup');
          if (box) box.style.display = 'none';
        };

        // フォーカス/ブラー時の挙動を設定
        if (user && user.addEventListener) {
          user.addEventListener('focus', function(){ showMaskedPopup(user, userVal, passVal); });
          user.addEventListener('blur', hidePopup);
        }
        if (pass && pass.addEventListener) {
          pass.addEventListener('focus', function(){ showMaskedPopup(pass, userVal, passVal); });
          pass.addEventListener('blur', hidePopup);
        }

        return { ok: true, userHint: byHint(user), passHint: byHint(pass) };
      },
      args: [creds]
    });

    if (fillResp && fillResp.result && fillResp.result.ok) {
      result.textContent = "ユーザID/パスワードを自動入力しました。";
      return;
    }

    const [{ result: title }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: function() {
        return document.title || "";
      }
    });

    result.textContent = (fillResp && fillResp.result && fillResp.result.reason)
      ? `自動入力できませんでした: ${fillResp.result.reason}\nTitle: ${title}`
      : title;
  } catch (e) {
    console.error(e);
    result.textContent = "実行に失敗しました。別のページでお試しください。";
  }
}

// ボタンクリックで実行
btn.addEventListener('click', runAuto);
