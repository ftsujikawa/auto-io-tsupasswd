(() => {
  let ran = false;
  let clickingBox = false;

  const byHint = function(el) {
    const s = (el && (el.name || "")) + " " + (el && (el.id || "")) + " " + (el && (el.autocomplete || ""));
    return s.toLowerCase();
  };

  // 深いDOM探索（Shadow DOM/同一オリジンiframe対応）でinput要素を収集
  const getAllInputsDeep = function(root) {
    const out = [];
    const walk = (node) => {
      if (!node) return;
      try {
        const inputs = node.querySelectorAll ? node.querySelectorAll('input') : [];
        out.push(...Array.prototype.slice.call(inputs));
      } catch(_) {}
      // shadow roots
      const treeWalker = (node.querySelectorAll ? node.querySelectorAll('*') : []);
      for (const el of treeWalker) {
        if (el && el.shadowRoot) walk(el.shadowRoot);
      }
      // iframes (同一オリジンのみ)
      const iframes = node.querySelectorAll ? node.querySelectorAll('iframe') : [];
      for (const fr of iframes) {
        try {
          const doc = fr.contentDocument || (fr.contentWindow && fr.contentWindow.document);
          if (doc) walk(doc);
        } catch(_) { /* cross-origin */ }
      }
    };
    walk(root);
    return out;
  };

  // パスワード欄ごとにユーザ欄を近傍から推定（同一form優先→同一親要素→全体から最も近い）
  const pairUserPass = function(allInputs) {
    const passwords = allInputs.filter(isPassLike);
    const users = allInputs.filter(isUserLike);
    const pairs = [];
    const usedUsers = new Set();
    for (const pass of passwords) {
      let u = null;
      const form = pass.form || (pass.closest && pass.closest('form'));
      if (form) {
        const inForm = Array.prototype.slice.call(form.querySelectorAll('input'));
        u = inForm.find((el) => isUserLike(el) && !usedUsers.has(el));
      }
      if (!u) {
        const parent = pass.parentElement || pass.closest('*');
        if (parent) {
          const siblings = Array.prototype.slice.call(parent.querySelectorAll('input'));
          u = siblings.find((el) => isUserLike(el) && !usedUsers.has(el));
        }
      }
      if (!u) {
        // 最も近いユーザ欄
        let best = null, bestDist = Infinity;
        for (const cand of users) {
          if (usedUsers.has(cand)) continue;
          try {
            const a = pass.getBoundingClientRect();
            const b = cand.getBoundingClientRect();
            const dy = a.top - b.top; // 通常はユーザ欄が上にある
            const dx = Math.abs(a.left - b.left);
            const dist = Math.abs(dy) * 2 + dx; // 縦優先
            if (dist < bestDist) { bestDist = dist; best = cand; }
          } catch(_) {}
        }
        u = best;
      }
      if (u) {
        usedUsers.add(u);
        pairs.push({ user: u, pass });
      }
    }
    return pairs;
  };
  const isUserLike = function(el) {
    if (!el || el.tagName !== "INPUT") return false;
    const type = (el.type || "text").toLowerCase();
    if (["hidden", "submit", "button", "checkbox", "radio"].includes(type)) return false;
    const s = byHint(el);
    return (
      type === "text" || type === "email" || type === "tel" || type === "search" || type === "username" ||
      s.includes("user") || s.includes("login") || s.includes("mail") || s.includes("email") || s.includes("account") || s.includes("id")
    );
  };
  const isPassLike = function(el) {
    return el && el.tagName === "INPUT" && (el.type || "").toLowerCase() === "password";
  };

  const setVal = function(el, val) {
    try { el && el.focus && el.focus(); } catch(_){}
    if (!el) return;
    el.value = val;
    try {
      const event = document.createEvent("Event");
      event.initEvent("input", true, true);
      el.dispatchEvent(event);
      event.initEvent("change", true, true);
      el.dispatchEvent(event);
    } catch(_){}
  };

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
    return box;
  };
  const hidePopup = function() {
    if (clickingBox) return; // ポップクリック中は隠さない
    const box = document.getElementById('tsupasswd-inline-popup');
    if (box) box.style.display = 'none';
  };

  const filledSet = new WeakSet();
  let lastPairs = [];
  let lastCreds = null;
  const attachBoxClick = function(box) {
    if (!box || box.__tsuClickBound) return;
    const handler = function(e){
      clickingBox = true; // blurで消えるのを抑止
      try {
        e.preventDefault();
        e.stopPropagation();
      } catch(_) {}
      try {
        if (!lastPairs || !lastPairs.length || !lastCreds) return;
        const userVal = lastCreds.id || lastCreds.username || '';
        const passVal = lastCreds.password || '';
        for (const { user, pass } of lastPairs) {
          if (!user || !pass) continue;
          if (filledSet.has(user) && filledSet.has(pass)) continue;
          setVal(user, userVal);
          setVal(pass, passVal);
          filledSet.add(user); filledSet.add(pass);
        }
        hidePopup();
      } catch(_) {}
      // 次のtickでクリック状態解除
      setTimeout(() => { clickingBox = false; }, 0);
    };
    // 先に実行されるpointerdownで入力を行う（blurより前に処理）
    box.addEventListener('pointerdown', handler);
    box.addEventListener('click', handler);
    box.__tsuClickBound = true;
  };
  const fillAndBind = function(creds) {
    try {
      const inputs = getAllInputsDeep(document);
      const pairs = pairUserPass(inputs);
      if (!pairs.length) return false;
      lastPairs = pairs;
      lastCreds = creds;
      const userVal = creds.id || creds.username || '';
      const passVal = creds.password || '';
      let firstAnchor = null;
      for (const { user, pass } of pairs) {
        if (!user || !pass) continue;
        if (!firstAnchor) firstAnchor = pass || user;
        // フォーカス時にポップアップ表示、クリックで入力
        if (!user.__tsuBound) {
          user.addEventListener('focus', function(){ const b = showMaskedPopup(user, userVal, passVal); attachBoxClick(b); });
          user.addEventListener('blur', hidePopup);
          user.__tsuBound = true;
        }
        if (!pass.__tsuBound) {
          pass.addEventListener('focus', function(){ const b = showMaskedPopup(pass, userVal, passVal); attachBoxClick(b); });
          pass.addEventListener('blur', hidePopup);
          pass.__tsuBound = true;
        }
      }
      // 代表のペア近傍に即時ポップアップ（クリックで入力）
      if (firstAnchor) {
        try { const b = showMaskedPopup(firstAnchor, userVal, passVal); attachBoxClick(b); } catch(_) {}
      }
      return true;
    } catch(_) { return false; }
  };

  let cachedCreds = null;
  const run = async () => {
    if (ran) return; ran = true;
    try {
      const urlStr = location.href || '';
      const url = new URL(urlStr);
      const allowed = url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'file:';
      if (!allowed) return;

      const fetchCreds = () => new Promise((resolve) => {
        if (cachedCreds) { resolve(cachedCreds); return; }
        const host = (window.tsupasswd && window.tsupasswd.host) || 'com.tsu.tsupasswd';
        const args = (window.tsupasswd && Array.isArray(window.tsupasswd.extraArgs)) ? window.tsupasswd.extraArgs.slice() : [];
        args.push(urlStr);
        chrome.runtime.sendMessage({ type: 'RUN_TSUPASSWD', host, args }, (resp) => {
          if (!(resp && resp.ok)) { resolve(null); return; }
          let data = resp.data;
          try { data = (typeof data === 'string') ? JSON.parse(data) : data; } catch(_) {}
          if (!data || !(data.username && data.password)) { resolve(null); return; }
          cachedCreds = data;
          resolve(data);
        });
      });

      const creds = await fetchCreds();
      if (!creds) return;
      fillAndBind(creds);

      // SPAで後からフィールドが出現する場合に備え監視
      if (!window.__tsu_observer) {
        const debounced = (() => {
          let t = null;
          return (fn) => { clearTimeout(t); t = setTimeout(fn, 150); };
        })();
        const observer = new MutationObserver(() => debounced(() => fillAndBind(cachedCreds)));
        observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
        window.__tsu_observer = observer;
      }
    } catch(_) {}
  };

  // ポップアップからの指示で実行
  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.type === 'TSUPASSWD_FILL') {
        (async () => {
          try { await run(); sendResponse({ ok: true }); }
          catch (_) { sendResponse({ ok: false }); }
        })();
        return true; // async
      }
    });
  } catch (_) {}

  // ページ読み込み時にも自動実行（ranフラグで二重起動防止）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
})();
