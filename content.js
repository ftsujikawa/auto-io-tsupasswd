(() => {
  let ran = false;
  let clickingBox = false;
  let dialogOpen = false;
  let openingDialog = false;
  let overPopup = false;

  // テキストを安全にHTMLとして表示するための簡易エスケープ
  const esc = (s) => {
    try { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); } catch(_) { return ''; }
  };

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

  // 入力欄が実際に編集可能かどうか
  const isEditableInput = function(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    if (el.disabled) return false;
    if (el.readOnly) return false;
    const type = (el.type || '').toLowerCase();
    if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'checkbox' || type === 'radio') return false;
    try {
      const cs = (el.ownerDocument && el.ownerDocument.defaultView && el.ownerDocument.defaultView.getComputedStyle)
        ? el.ownerDocument.defaultView.getComputedStyle(el) : (window.getComputedStyle ? window.getComputedStyle(el) : null);
      if (cs) {
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') === 0) return false;
        const rect = el.getBoundingClientRect && el.getBoundingClientRect();
        if (rect && (rect.width === 0 || rect.height === 0)) {
          // 見た目ゼロサイズは編集困難とみなす
          return false;
        }
      }
    } catch(_) {}
    return true;
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

  const forceApply = function(user, pass, uval, pval) {
    const applyBoth = () => { if (user) setVal(user, uval); if (pass) setVal(pass, pval); };
    try { if (user) user.setAttribute('autocomplete', 'current-username'); } catch(_){ }
    try { if (pass) pass.setAttribute('autocomplete', 'current-password'); } catch(_){ }
    applyBoth();
    try { setTimeout(applyBoth, 60); } catch(_){ }
    try { setTimeout(applyBoth, 260); } catch(_){ }
  };

  const ensureFixedPopup = function(anchor) {
    const doc = (anchor && anchor.ownerDocument) || document;
    let box = doc.getElementById("tsupasswd-inline-popup");
    if (!box) {
      box = doc.createElement("div");
      box.id = "tsupasswd-inline-popup";
      box.style.position = "fixed";
      box.style.fontSize = "12px";
      box.style.lineHeight = "1.4";
      box.style.background = "rgba(32,33,36,0.98)";
      box.style.color = "#fff";
      box.style.border = "1px solid rgba(0,0,0,0.2)";
      box.style.borderRadius = "6px";
      box.style.padding = "8px 10px";
      box.style.boxShadow = "0 6px 18px rgba(0,0,0,0.3)";
      box.style.zIndex = "2147483647";
      box.style.display = "none";
      box.style.maxWidth = "min(360px, calc(100vw - 24px))";
      box.style.pointerEvents = "auto";
      (doc.body || doc.documentElement).appendChild(box);
      // ページ側のグローバルハンドラに奪われないようにイベントを遮断（バブリング段階で停止）
      const stopAll = (e) => { try { if (e.stopImmediatePropagation) e.stopImmediatePropagation(); e.stopPropagation(); } catch(_){} };
      box.addEventListener('click', stopAll, false);
      box.addEventListener('mousedown', stopAll, false);
      box.addEventListener('pointerdown', stopAll, false);
      // ホバー状態を明示的にトラッキング（:hover 判定の補助）
      try {
        box.addEventListener('mouseenter', () => { overPopup = true; }, false);
        box.addEventListener('mouseleave', () => { overPopup = false; }, false);
      } catch(_) {}
    }
    return box;
  };

  const placePopup = function(anchor, box) {
    if (!anchor || !box) return;
    const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { top: 0, left: 0, bottom: 0, width: 0, height: 0 };
    const gap = 8;
    const win = (box.ownerDocument && box.ownerDocument.defaultView) || window;
    const top = Math.min(Math.max(r.bottom + gap, 8), (win.innerHeight || window.innerHeight) - (box.offsetHeight || 0) - 8);
    const left = Math.min(Math.max(r.left, 8), (win.innerWidth || window.innerWidth) - (box.offsetWidth || 0) - 8);
    box.style.top = top + "px";
    box.style.left = left + "px";
  };
  const openSaveDialog = function(anchor, idText, pwText) {
    const box = ensureFixedPopup(anchor);
    const title = document.title || '';
    const urlStr = location.href || '';
    dialogOpen = true;
    box.innerHTML = '' +
      '<div style="display:flex;flex-direction:column;gap:8px;min-width:280px;max-width:360px;position:relative;z-index:2;">' +
        '<div style="font-weight:600;">tsupasswdに保存</div>' +
        '<div id="tsu-save-error" style="display:none;color:#f28b82;font-size:12px;"></div>' +
        '<label style="display:flex;gap:8px;align-items:center;">' +
          '<div style="flex:0 0 64px;color:#9aa0a6;">タイトル</div>' +
          '<input id="tsu-save-title" style="flex:1;min-width:0;padding:4px 6px;border:1px solid #3c4043;border-radius:4px;background:#303134;color:#e8eaed;" />' +
        '</label>' +
        '<label style="display:flex;gap:8px;align-items:center;">' +
          '<div style="flex:0 0 64px;color:#9aa0a6;">URL</div>' +
          '<input id="tsu-save-url" style="flex:1;min-width:0;padding:4px 6px;border:1px solid #3c4043;border-radius:4px;background:#303134;color:#e8eaed;" />' +
        '</label>' +
        '<label style="display:flex;gap:8px;align-items:center;">' +
          '<div style="flex:0 0 64px;color:#9aa0a6;">ユーザID</div>' +
          '<input id="tsu-save-user" style="flex:1;min-width:0;padding:4px 6px;border:1px solid #3c4043;border-radius:4px;background:#303134;color:#e8eaed;" />' +
        '</label>' +
        '<label style="display:flex;gap:8px;align-items:center;">' +
          '<div style="flex:0 0 64px;color:#9aa0a6;">パスワード</div>' +
          '<input id="tsu-save-pass" type="password" style="flex:1;min-width:0;padding:4px 6px;border:1px solid #3c4043;border-radius:4px;background:#303134;color:#e8eaed;" />' +
        '</label>' +
        '<label style="display:flex;gap:8px;align-items:flex-start;">' +
          '<div style="flex:0 0 64px;color:#9aa0a6;">備考</div>' +
          '<textarea id="tsu-save-note" rows="3" style="flex:1;min-width:0;padding:6px;border:1px solid #3c4043;border-radius:4px;background:#303134;color:#e8eaed;"></textarea>' +
        '</label>' +
        '<div style="display:flex;justify-content:flex-end;gap:8px;">' +
          '<button id="tsu-save-cancel" style="position:relative;z-index:3;background:#3c4043;color:#e8eaed;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;">キャンセル</button>' +
          '<button id="tsu-save-ok" style="position:relative;z-index:3;background:#1a73e8;color:#fff;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;opacity:0.7;">保存</button>' +
        '</div>' +
      '</div>';
    const q = (id) => box.querySelector(id);
    q('#tsu-save-title').value = title;
    q('#tsu-save-url').value = urlStr;
    let __u = idText || '';
    let __p = pwText || '';
    try {
      const a = anchor;
      const f = a && (a.form || (a.closest && a.closest('form')));
      if (f) {
        const ins = Array.prototype.slice.call(f.querySelectorAll('input'));
        const u = ins.find(isUserLike) || null;
        const p = ins.find(isPassLike) || null;
        if (u && typeof u.value === 'string') __u = u.value;
        if (p && typeof p.value === 'string') __p = p.value;
        // フォームとダイアログをライブ同期（inputイベント＋オートフィル対策のポーリング）
        try {
          const syncers = [];
          if (u) {
            const onU = () => { try { const du = q('#tsu-save-user'); if (du) du.value = u.value || ''; } catch(_){} };
            u.addEventListener('input', onU);
            syncers.push(() => { try { u.removeEventListener('input', onU); } catch(_){} });
          }
          if (p) {
            const onP = () => { try { const dp = q('#tsu-save-pass'); if (dp) dp.value = p.value || ''; } catch(_){} };
            p.addEventListener('input', onP);
            syncers.push(() => { try { p.removeEventListener('input', onP); } catch(_){} });
          }
          // オートフィルはinput/changeが発火しない場合があるため、一定期間ポーリングで追従
          let lastU = (u && typeof u.value === 'string') ? u.value : '';
          let lastP = (p && typeof p.value === 'string') ? p.value : '';
          const poll = setInterval(() => {
            try {
              if (u) {
                const v = typeof u.value === 'string' ? u.value : '';
                if (v !== lastU) { lastU = v; const du = q('#tsu-save-user'); if (du) du.value = v; }
              }
              if (p) {
                const v2 = typeof p.value === 'string' ? p.value : '';
                if (v2 !== lastP) { lastP = v2; const dp = q('#tsu-save-pass'); if (dp) dp.value = v2; }
              }
            } catch(_) {}
          }, 300);
          // 最大20秒で自動停止
          const pollStop = setTimeout(() => { try { clearInterval(poll); } catch(_){} }, 20000);
          syncers.push(() => { try { clearInterval(poll); } catch(_){} try { clearTimeout(pollStop); } catch(_){} });
          box.__syncCleanup = () => {
            try { syncers.forEach(fn => { try { fn(); } catch(_){} }); } catch(_){ }
            box.__syncCleanup = null;
          };
        } catch(_) {}
      }
    } catch(_) {}
    q('#tsu-save-user').value = __u;
    q('#tsu-save-pass').value = __p;
    // アンカーを保持（後続で再参照）
    try { showMaskedPopup.__anchor = anchor; } catch(_) {}
    box.style.display = 'block';
    try { requestAnimationFrame(() => placePopup(anchor, box)); } catch(_) { placePopup(anchor, box); }
    // URLが空なら、当該フレームのURLを初期値として補完
    try {
      const urlEl = q('#tsu-save-url');
      if (urlEl && !urlEl.value) {
        const win = (anchor && anchor.ownerDocument && anchor.ownerDocument.defaultView) || window;
        urlEl.value = (win && win.location && win.location.href) ? win.location.href : (location && location.href) || '';
      }
    } catch(_) {}
    // 初期フォーカス（タイトル入力にフォーカス）
    try { setTimeout(() => { const ti = q('#tsu-save-title'); if (ti && ti.focus) { ti.focus(); try { ti.select && ti.select(); } catch(_){} } }, 0); } catch(_) {}
    const cancel = (ev) => { try { ev.preventDefault(); ev.stopPropagation(); } catch(_){} try { box.__syncCleanup && box.__syncCleanup(); } catch(_){} dialogOpen = false; openingDialog = false; hidePopup(true); };

    // バリデーション
    const err = q('#tsu-save-error');
    const btnOk = q('#tsu-save-ok');
    const setBtn = (en) => { if (btnOk) { btnOk.disabled = !en; btnOk.style.opacity = en ? '1' : '0.7'; btnOk.style.cursor = en ? 'pointer' : 'not-allowed'; } };
    const isValidUrl = (u) => {
      try {
        const t = new URL(u);
        return ['http:', 'https:', 'file:'].includes(t.protocol);
      } catch (_) { return false; }
    };
    const validate = () => {
      const t = (q('#tsu-save-title').value || '').trim();
      const u = (q('#tsu-save-url').value || '').trim();
      const id = (q('#tsu-save-user').value || '').trim();
      const pw = (q('#tsu-save-pass').value || '').trim();
      let msg = '';
      if (!u) msg = 'URLは必須です。';
      else if (!isValidUrl(u)) msg = 'URLが不正です（http/https/fileのみ）。';
      else if (!id && !pw) msg = 'ユーザIDまたはパスワードのどちらかを入力してください。';
      if (msg) {
        if (err) {
          err.innerHTML = '<div>' + msg + '</div>'
            + '<div style="display:flex;justify-content:flex-end;margin-top:6px;">'
              + '<button id="tsu-save-err-ok" style="background:#1a73e8;color:#fff;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;">OK</button>'
            + '</div>';
          err.style.display = 'block';
          try {
            const b = err.querySelector('#tsu-save-err-ok');
            if (b) b.addEventListener('click', () => { try { err.style.display = 'none'; err.innerHTML = ''; } catch(_) {} });
          } catch(_) {}
        }
        setBtn(false);
        return false;
      }
      if (err) { err.innerHTML = ''; err.style.display = 'none'; }
      setBtn(true);
      return true;
    };
    ['#tsu-save-title','#tsu-save-url','#tsu-save-user','#tsu-save-pass','#tsu-save-note'].forEach(sel => {
      const el = q(sel);
      if (el) el.addEventListener('input', validate);
    });
    validate();

    // 送信用payload生成（ネイティブ仕様に合わせて変更可能）
    const buildSavePayload = () => {
      const entry = {
        title: q('#tsu-save-title').value || '',
        url: q('#tsu-save-url').value || '',
        username: q('#tsu-save-user').value || '',
        password: q('#tsu-save-pass').value || '',
        note: q('#tsu-save-note').value || ''
      };
      return entry;
    };

    const save = (ev) => {
      try { ev.preventDefault(); ev.stopPropagation(); } catch(_){ }
      if (!validate()) return;
      // 送信中のUI
      try { setBtn(false); if (btnOk) btnOk.textContent = '保存中…'; } catch(_){ }
      const entry = buildSavePayload();
      const host = (window.tsupasswd && window.tsupasswd.host) || 'dev.happyfactory.tsupasswd';
      // デフォルトはSAVE_TSUPASSWD。必要に応じてRUN_TSUPASSWDに切替可能（window.tsupasswd.saveVia === 'run'）
      const saveVia = (window.tsupasswd && window.tsupasswd.saveVia) || 'message';
      if (saveVia === 'run') {
        // 例: extraArgsSave(entry) で引数配列を構築（利用者がwindow.tsupasswd.extraArgsSaveを提供）
        const defaultBuild = (e) => {
          const a = ['add', e.url, e.username, e.password];
          // 空値は付けない
          if (e.title) { a.push('--title', e.title); }
          if (e.note) { a.push('--note', e.note); }
          return a;
        };
        const buildArgs = (window.tsupasswd && typeof window.tsupasswd.extraArgsSave === 'function')
          ? window.tsupasswd.extraArgsSave
          : defaultBuild;
        const args = buildArgs(entry);
        let done = false; const to = setTimeout(() => {
          if (done) return;
          done = true;
          box.innerHTML = '<div style="padding:8px 4px;">保存がタイムアウトしました。</div>';
          const okBtn3 = document.createElement('button');
          okBtn3.id = 'tsu-save-err-ok';
          okBtn3.style.background = '#1a73e8'; okBtn3.style.color = '#fff'; okBtn3.style.border = 'none'; okBtn3.style.borderRadius = '6px'; okBtn3.style.padding = '6px 10px'; okBtn3.style.cursor = 'pointer'; okBtn3.textContent = 'OK';
          box.appendChild(okBtn3);
          okBtn3.addEventListener('click', (ev) => { try { ev.preventDefault(); ev.stopPropagation(); } catch(_){} dialogOpen = false; openingDialog = false; hidePopup(true); });
          try { if (btnOk) btnOk.textContent = '保存'; setBtn(true); } catch(_) {}
        }, 25000);
        chrome.runtime.sendMessage({ type: 'RUN_TSUPASSWD', host, args }, (resp) => {
          if (done) return; done = true; try { clearTimeout(to); } catch(_) {}
          const ok = !!(resp && resp.ok);
          if (!ok) {
            try { console.debug('RUN_TSUPASSWD(save) failed:', resp); } catch(_) {}
            const extraStdout = (resp && resp.data && resp.data.stdout) ? `<pre style=\"white-space:pre-wrap;max-height:120px;overflow:auto;margin:6px 0 0;\">${esc(resp.data.stdout)}</pre>` : '';
            const extraStderr = (resp && resp.data && resp.data.stderr) ? `<pre style=\"white-space:pre-wrap;max-height:120px;overflow:auto;margin:6px 0 0;\">${esc(resp.data.stderr)}</pre>` : '';
            const hostsArr = (resp && resp.data && Array.isArray(resp.data.hosts)) ? resp.data.hosts : null;
            const errsArr = (resp && resp.data && Array.isArray(resp.data.errors)) ? resp.data.errors : null;
            const hostsHtml = hostsArr && hostsArr.length ? `<div style=\"margin-top:6px;\"><div style=\"font-size:12px;color:#9aa0a6;\">試行ホスト:</div><ul style=\"margin:4px 0 0 16px;\">${hostsArr.map(h=>`<li>${esc(h)}</li>`).join('')}</ul></div>` : '';
            const errsHtml = errsArr && errsArr.length ? `<div style=\"margin-top:6px;\"><div style=\"font-size:12px;color:#9aa0a6;\">エラー詳細:</div><ul style=\"margin:4px 0 0 16px;\">${errsArr.map(e=>`<li>${esc(e)}</li>`).join('')}</ul></div>` : '';
            const errMsg = (resp && (resp.error || (resp.data && resp.data.error))) ? (resp.error || (resp.data && resp.data.error) || '') : '';
            const errTxt = errMsg ? `<div style=\"color:#f28b82;font-size:12px;margin-top:6px;\">${esc(errMsg)}</div>` : '';
            box.innerHTML = `<div style=\"display:flex;flex-direction:column;gap:8px;padding:8px 4px;\">`
              + `<div>保存に失敗しました。</div>${extraStdout}${extraStderr}${hostsHtml}${errsHtml}${errTxt}`
              + `<div style=\"display:flex;justify-content:flex-end;\">`
                + `<button id=\"tsu-save-err-ok\" style=\"background:#1a73e8;color:#fff;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;\">OK</button>`
              + `</div>`
            + `</div>`;
            const okBtn = box.querySelector('#tsu-save-err-ok');
            if (okBtn) okBtn.addEventListener('click', (ev) => { try { ev.preventDefault(); ev.stopPropagation(); } catch(_){} dialogOpen = false; openingDialog = false; hidePopup(true); });
          } else {
            try { box.__syncCleanup && box.__syncCleanup(); } catch(_){ }
            const extra = (resp && resp.data && resp.data.stdout) ? `<pre style=\"white-space:pre-wrap;max-height:120px;overflow:auto;margin:6px 0 0;\">${esc(resp.data.stdout)}</pre>` : '';
            finishOk(extra);
          }
        });
      } else {
        let settled = false;
        const finishOk = (extraHtml) => {
          if (settled) return; settled = true;
          try { box.__syncCleanup && box.__syncCleanup(); } catch(_){ }
          box.innerHTML = `<div style=\"padding:8px 4px;\">保存しました。${extraHtml || ''}</div>`;
          setTimeout(() => { dialogOpen = false; openingDialog = false; try { hidePopup(true); } catch(_){} }, 200);
        };
        const finishErr = (html) => {
          if (settled) return; settled = true;
          box.innerHTML = html;
          const okBtn = box.querySelector('#tsu-save-err-ok');
          if (okBtn) okBtn.addEventListener('click', (ev) => { try { ev.preventDefault(); ev.stopPropagation(); } catch(_){} dialogOpen = false; openingDialog = false; hidePopup(true); });
          try { if (btnOk) btnOk.textContent = '保存'; setBtn(true); } catch(_) {}
        };
        const outerTo = setTimeout(() => {
          finishErr('<div style="padding:8px 4px;">保存がタイムアウトしました。</div><div style="display:flex;justify-content:flex-end;"><button id="tsu-save-err-ok" style="background:#1a73e8;color:#fff;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;">OK</button></div>');
        }, 25000);

        const startRunFallback = () => {
          try {
            const defaultBuild = (e) => {
              const a = ['add', e.url, e.username, e.password];
              if (e.title) { a.push('--title', e.title); }
              if (e.note) { a.push('--note', e.note); }
              return a;
            };
            const buildArgs = (window.tsupasswd && typeof window.tsupasswd.extraArgsSave === 'function')
              ? window.tsupasswd.extraArgsSave
              : defaultBuild;
            const args = buildArgs(entry);
            const canMsgRun = (typeof chrome !== 'undefined') && chrome.runtime && chrome.runtime.id;
            if (!canMsgRun) {
              finishErr('<div style="padding:8px 4px;">拡張機能のコンテキストが無効です。ページを再読み込みしてください。</div><div style="display:flex;justify-content:flex-end;"><button id="tsu-save-err-ok" style="background:#1a73e8;color:#fff;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;">OK</button></div>');
            } else {
              try {
                chrome.runtime.sendMessage({ type: 'RUN_TSUPASSWD', host, args }, (resp2) => {
                  if (settled) return;
                  if (chrome.runtime && chrome.runtime.lastError) {
                    const msg2 = (chrome.runtime.lastError && chrome.runtime.lastError.message) || '';
                    finishErr(`<div style=\"display:flex;flex-direction:column;gap:8px;padding:8px 4px;\"><div>保存に失敗しました。</div><div style=\"color:#f28b82;font-size:12px;margin-top:6px;\">${esc(msg2)}</div><div style=\"display:flex;justify-content:flex-end;\"><button id=\"tsu-save-err-ok\" style=\"background:#1a73e8;color:#fff;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;\">OK</button></div></div>`);
                    return;
                  }
                  const ok2 = !!(resp2 && resp2.ok);
                  if (!ok2) {
                    const extraStdout2 = (resp2 && resp2.data && resp2.data.stdout) ? `<pre style=\"white-space:pre-wrap;max-height:120px;overflow:auto;margin:6px 0 0;\">${esc(resp2.data.stdout)}</pre>` : '';
                    const extraStderr2 = (resp2 && resp2.data && resp2.data.stderr) ? `<pre style=\"white-space:pre-wrap;max-height:120px;overflow:auto;margin:6px 0 0;\">${esc(resp2.data.stderr)}</pre>` : '';
                    const hostsArr2 = (resp2 && resp2.data && Array.isArray(resp2.data.hosts)) ? resp2.data.hosts : null;
                    const errsArr2 = (resp2 && resp2.data && Array.isArray(resp2.data.errors)) ? resp2.data.errors : null;
                    const hostsHtml2 = hostsArr2 && hostsArr2.length ? `<div style=\"margin-top:6px;\"><div style=\"font-size:12px;color:#9aa0a6;\">試行ホスト:</div><ul style=\"margin:4px 0 0 16px;\">${hostsArr2.map(h=>`<li>${esc(h)}</li>`).join('')}</ul></div>` : '';
                    const errsHtml2 = errsArr2 && errsArr2.length ? `<div style=\"margin-top:6px;\"><div style=\"font-size:12px;color:#9aa0a6;\">エラー詳細:</div><ul style=\"margin:4px 0 0 16px;\">${errsArr2.map(e=>`<li>${esc(e)}</li>`).join('')}</ul></div>` : '';
                    const errMsg2 = (resp2 && (resp2.error || (resp2.data && resp2.data.error))) ? (resp2.error || (resp2.data && resp2.data.error) || '') : '';
                    const errTxt2 = errMsg2 ? `<div style=\"color:#f28b82;font-size:12px;margin-top:6px;\">${esc(errMsg2)}</div>` : '';
                    finishErr(`<div style=\"display:flex;flex-direction:column;gap:8px;padding:8px 4px;\">`
                      + `<div>保存に失敗しました。</div>${extraStdout2}${extraStderr2}${hostsHtml2}${errsHtml2}${errTxt2}`
                      + `<div style=\"display:flex;justify-content:flex-end;\">`
                        + `<button id=\"tsu-save-err-ok\" style=\"background:#1a73e8;color:#fff;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;\">OK</button>`
                      + `</div>`
                    + `</div>`);
                  } else {
                    const extra2 = (resp2 && resp2.data && resp2.data.stdout) ? `<pre style=\"white-space:pre-wrap;max-height:120px;overflow:auto;margin:6px 0 0;\">${esc(resp2.data.stdout)}</pre>` : '';
                    finishOk(extra2);
                  }
                });
              } catch (e) {
                const msg2 = (e && (e.message || e.toString())) || '';
                finishErr(`<div style=\"display:flex;flex-direction:column;gap:8px;padding:8px 4px;\"><div>保存に失敗しました。</div><div style=\"color:#f28b82;font-size:12px;margin-top:6px;\">${esc(msg2)}</div><div style=\"display:flex;justify-content:flex-end;\"><button id=\"tsu-save-err-ok\" style=\"background:#1a73e8;color:#fff;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;\">OK</button></div></div>`);
              }
            }
          } catch(_) {
            const errMsg3 = (_ && (_.message || _.toString())) ? (_.message || _.toString()) : '';
            const errStack3 = (_ && _.stack) ? _.stack : '';
            const errTxt3 = (errMsg3 || errStack3) ? `<div style="color:#f28b82;font-size:12px;margin-top:6px;">${esc(errMsg3)}</div>${errStack3 ? `<pre style=\"white-space:pre-wrap;max-height:120px;overflow:auto;margin:6px 0 0;\">${esc(errStack3)}</pre>` : ''}` : '';
            finishErr(`<div style="display:flex;flex-direction:column;gap:8px;padding:8px 4px;"><div>保存に失敗しました。</div>${errTxt3}<div style="display:flex;justify-content:flex-end;"><button id="tsu-save-err-ok" style="background:#1a73e8;color:#fff;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;">OK</button></div></div>`);
          }
        };

        let raced = false;
        const raceTo = setTimeout(() => { if (settled || raced) return; raced = true; startRunFallback(); }, 3000);
        const canMsgSave = (typeof chrome !== 'undefined') && chrome.runtime && chrome.runtime.id;
        if (!canMsgSave) {
          // 拡張機能のコンテキストが無効
          if (!raced) { raced = true; startRunFallback(); } else {
            finishErr('<div style="padding:8px 4px;">拡張機能のコンテキストが無効です。ページを再読み込みしてください。</div><div style="display:flex;justify-content:flex-end;"><button id="tsu-save-err-ok" style="background:#1a73e8;color:#fff;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;">OK</button></div>');
          }
        } else {
          try {
            chrome.runtime.sendMessage({ type: 'SAVE_TSUPASSWD', host, entry }, (resp) => {
              if (settled) return; try { clearTimeout(raceTo); } catch(_) {}
              if (chrome.runtime && chrome.runtime.lastError) {
                const msg = (chrome.runtime.lastError && chrome.runtime.lastError.message) || '';
                if (!raced) { raced = true; startRunFallback(); return; }
                finishErr(`<div style="padding:8px 4px;">保存に失敗しました（${esc(msg)}）。ページを再読み込みしてください。</div><div style=\"display:flex;justify-content:flex-end;\"><button id=\"tsu-save-err-ok\" style=\"background:#1a73e8;color:#fff;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;\">OK</button></div>`);
                return;
              }
              const ok = !!(resp && resp.ok);
              if (ok) {
                const extra = (resp && resp.data && resp.data.stdout) ? `<pre style=\"white-space:pre-wrap;max-height:120px;overflow:auto;margin:6px 0 0;\">${resp.data.stdout}</pre>` : '';
                finishOk(extra);
              } else {
                if (!raced) { raced = true; startRunFallback(); return; }
              }
            });
          } catch (e) {
            const msg = (e && (e.message || e.toString())) || '';
            if (!raced) { raced = true; startRunFallback(); return; }
            finishErr(`<div style="padding:8px 4px;">保存に失敗しました（${esc(msg)}）。ページを再読み込みしてください。</div><div style=\"display:flex;justify-content:flex-end;\"><button id=\"tsu-save-err-ok\" style=\"background:#1a73e8;color:#fff;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;\">OK</button></div>`);
          }
        }
      }
    };
    const btnCancel = q('#tsu-save-cancel');
    if (btnCancel) { btnCancel.addEventListener('pointerdown', cancel); btnCancel.addEventListener('click', cancel); }
    if (btnOk) { btnOk.addEventListener('pointerdown', save); btnOk.addEventListener('click', save); }
    return box;
  };

  const showMaskedPopup = function(anchor, idText, pwText) {
    try {
      // ページ内にユーザIDまたはパスワード欄が一つも無ければ表示しない
      const inputs = getAllInputsDeep(document);
      let hasAuthField = false;
      for (const el of inputs) {
        if (isEditableInput(el) && (isUserLike(el) || isPassLike(el))) { hasAuthField = true; break; }
      }
      if (!hasAuthField) {
        const box = ensureFixedPopup(anchor);
        try { box.style.display = 'none'; } catch(_) {}
        return box;
      }
    } catch(_) {}
    // 保存ダイアログが開いている場合は、位置だけ追従して内容は上書きしない
    if (dialogOpen || openingDialog) {
      const doc = (anchor && anchor.ownerDocument) || document;
      const boxExist = doc.getElementById('tsupasswd-inline-popup') || ensureFixedPopup(anchor);
      try { requestAnimationFrame(() => placePopup(anchor, boxExist)); } catch(_) { placePopup(anchor, boxExist); }
      return boxExist;
    }
    const box = ensureFixedPopup(anchor);
    const masked = (pwText && pwText.length) ? "\u2022".repeat(pwText.length) : "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
    // entriesが存在する場合は一覧を表示（1件でも一覧で見せる）
    if (lastEntries && Array.isArray(lastEntries) && lastEntries.length > 0) {
      let listHtml = '';
      for (let i = 0; i < lastEntries.length; i++) {
        const e = lastEntries[i] || {};
        const title = e.title || e.url || '(no title)';
        const url = e.url || '';
        const user = e.username || '';
        const pw = e.password || '';
        const pwMasked = pw ? '\u2022'.repeat(pw.length) : masked;
        listHtml += '' +
          '<div class="tsu-item" data-idx="'+i+'" style="padding:6px;border:1px solid rgba(255,255,255,0.08);border-radius:6px;cursor:pointer;background:rgba(255,255,255,0.03);">' +
            '<div style="display:flex;flex-direction:column;gap:2px;">' +
              '<div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+ title +'</div>' +
              (url ? '<div style="color:#9aa0a6;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+ url +'</div>' : '') +
              '<div style="display:flex;flex-direction:column;gap:2px;font-size:12px;">' +
                '<div>ユーザID: <span>'+ user +'</span></div>' +
                '<div>パスワード: <span>'+ pwMasked +'</span></div>' +
              '</div>' +
            '</div>' +
          '</div>';
      }
      box.innerHTML = '' +
        '<div style="display:flex;flex-direction:column;gap:8px;min-width:280px;">' +
          '<div style="font-weight:600;">候補を選択</div>' +
          '<div id="tsu-list" style="display:flex;flex-direction:column;gap:6px;max-height:280px;overflow:auto;overscroll-behavior:contain;touch-action:pan-y;">'+ listHtml +'</div>' +
          '<div style="display:flex;justify-content:flex-end;gap:8px;">' +
            '<button id="tsu-save-entry" class="tsu-save" style="background:#1a73e8;color:#fff;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;">tsupasswdに保存</button>' +
          '</div>' +
        '</div>';
      // クリックで即入力
      const list = box.querySelector('#tsu-list');
      if (list) {
        // 共通: 指定indexのエントリを現在フォームへ反映
        const applyEntryByIndex = (idx) => {
          try {
            if (isNaN(idx) || idx < 0 || idx >= lastEntries.length) return;
            const e = lastEntries[idx] || {};
            const anchor = showMaskedPopup.__anchor;
            let candidates = Array.isArray(lastPairs) ? lastPairs.slice() : [];
            const sameForm = [];
            if (anchor && candidates.length) {
              for (const pr of candidates) {
                try {
                  if ((pr.user && pr.user.form && anchor && anchor.form && pr.user.form === anchor.form) ||
                      (pr.pass && pr.pass.form && anchor && anchor.form && pr.pass.form === anchor.form)) {
                    sameForm.push(pr);
                  }
                } catch(_) {}
              }
            }
            if (!sameForm.length) {
              try {
                const inputsNow = getAllInputsDeep(document);
                const pairsNow = pairUserPass(inputsNow);
                candidates = pairsNow || [];
                if (anchor && candidates.length) {
                  for (const pr of candidates) {
                    try {
                      if ((pr.user && pr.user.form && anchor && anchor.form && pr.user.form === anchor.form) ||
                          (pr.pass && pr.pass.form && anchor && anchor.form && pr.pass.form === anchor.form)) {
                        sameForm.push(pr);
                      }
                    } catch(_) {}
                  }
                }
              } catch(_) {}
            }
            let targetPairs = sameForm.length ? sameForm : candidates;
            if ((!targetPairs || !targetPairs.length) && anchor && anchor.closest) {
              const form = anchor.form || anchor.closest('form');
              if (form) {
                try {
                  const inputsInForm = Array.prototype.slice.call(form.querySelectorAll('input'));
                  let u = null, p = null;
                  if (isUserLike(anchor)) { u = anchor; p = inputsInForm.find(isPassLike) || null; }
                  else if (isPassLike(anchor)) { p = anchor; u = inputsInForm.find(isUserLike) || null; }
                  if (u && p) { targetPairs = [{ user: u, pass: p }]; }
                } catch(_) {}
              }
            }
            const uval = e.username || '';
            const pval = e.password || '';
            if (!targetPairs || !targetPairs.length) {
              // フォールバック: アンカーと同一フォーム、またはアンカー自身へ単独適用
              let uEl = null, pEl = null;
              if (anchor) {
                const form = anchor.form || (anchor.closest && anchor.closest('form'));
                if (form) {
                  try {
                    const inputsInForm = Array.prototype.slice.call(form.querySelectorAll('input'));
                    if (isUserLike(anchor)) { uEl = anchor; pEl = inputsInForm.find(isPassLike) || null; }
                    else if (isPassLike(anchor)) { pEl = anchor; uEl = inputsInForm.find(isUserLike) || null; }
                  } catch(_) {}
                } else {
                  if (isUserLike(anchor)) uEl = anchor;
                  if (isPassLike(anchor)) pEl = anchor;
                }
              }
              if (uEl || pEl) {
                forceApply(uEl, pEl, uval, pval);
                if (uEl) filledSet.add(uEl);
                if (pEl) filledSet.add(pEl);
              }
              return;
            }
            const first = targetPairs[0];
            forceApply(first.user || null, first.pass || null, uval, pval);
            if (first.user) filledSet.add(first.user);
            if (first.pass) filledSet.add(first.pass);
          } catch(_) {}
        };
        // 先にpointerdown(キャプチャ)でclickingBoxを立て、blur起因のhideを抑止（伝播は止めない＝スクロール可）
        list.addEventListener('pointerdown', (ev) => {
          try { clickingBox = true; } catch(_) {}
        }, true);
        // タッチ操作のスクロールとタップを判別
        let touchMoved = false;
        list.addEventListener('touchstart', (ev) => { try { clickingBox = true; touchMoved = false; } catch(_) {} }, { capture: true, passive: true });
        list.addEventListener('touchmove', (ev) => { touchMoved = true; }, { capture: true, passive: true });
        list.addEventListener('touchend', (ev) => {
          try {
            if (touchMoved) { setTimeout(() => { clickingBox = false; }, 0); return; }
            const item = (ev.target && ev.target.closest && ev.target.closest('.tsu-item')) || null;
            if (!item) { setTimeout(() => { clickingBox = false; }, 0); return; }
            try { ev.preventDefault(); ev.stopPropagation(); } catch(_) {}
            const idx = parseInt(item.getAttribute('data-idx') || '-1', 10);
            if (isNaN(idx) || idx < 0 || idx >= lastEntries.length) { setTimeout(() => { clickingBox = false; }, 0); return; }
            const e = lastEntries[idx] || {};
            // 入力処理（clickと同一ロジック）
            const anchor = showMaskedPopup.__anchor;
            let candidates = Array.isArray(lastPairs) ? lastPairs.slice() : [];
            const sameForm = [];
            if (anchor && candidates.length) {
              for (const pr of candidates) {
                try {
                  if ((pr.user && pr.user.form && anchor && anchor.form && pr.user.form === anchor.form) ||
                      (pr.pass && pr.pass.form && anchor && anchor.form && pr.pass.form === anchor.form)) {
                    sameForm.push(pr);
                  }
                } catch(_) {}
              }
            }
            if (!sameForm.length) {
              try {
                const inputsNow = getAllInputsDeep(document);
                const pairsNow = pairUserPass(inputsNow);
                candidates = pairsNow || [];
                if (anchor && candidates.length) {
                  for (const pr of candidates) {
                    try {
                      if ((pr.user && pr.user.form && anchor && anchor.form && pr.user.form === anchor.form) ||
                          (pr.pass && pr.pass.form && anchor && anchor.form && pr.pass.form === anchor.form)) {
                        sameForm.push(pr);
                      }
                    } catch(_) {}
                  }
                }
              } catch(_) {}
            }
            let targetPairs = sameForm.length ? sameForm : candidates;
            if ((!targetPairs || !targetPairs.length) && anchor && anchor.closest) {
              const form = anchor.form || anchor.closest('form');
              if (form) {
                try {
                  const inputsInForm = Array.prototype.slice.call(form.querySelectorAll('input'));
                  let u = null, p = null;
                  if (isUserLike(anchor)) { u = anchor; p = inputsInForm.find(isPassLike) || null; }
                  else if (isPassLike(anchor)) { p = anchor; u = inputsInForm.find(isUserLike) || null; }
                  if (u && p) { targetPairs = [{ user: u, pass: p }]; }
                } catch(_) {}
              }
            }
            const uval = e.username || '';
            const pval = e.password || '';
            if (!targetPairs || !targetPairs.length) {
              // フォールバック: 単独適用
              let uEl = null, pEl = null;
              if (anchor) {
                const form = anchor.form || (anchor.closest && anchor.closest('form'));
                if (form) {
                  try {
                    const inputsInForm = Array.prototype.slice.call(form.querySelectorAll('input'));
                    if (isUserLike(anchor)) { uEl = anchor; pEl = inputsInForm.find(isPassLike) || null; }
                    else if (isPassLike(anchor)) { pEl = anchor; uEl = inputsInForm.find(isUserLike) || null; }
                  } catch(_) {}
                } else {
                  if (isUserLike(anchor)) uEl = anchor;
                  if (isPassLike(anchor)) pEl = anchor;
                }
              }
              if (uEl || pEl) {
                forceApply(uEl, pEl, uval, pval);
                if (uEl) filledSet.add(uEl);
                if (pEl) filledSet.add(pEl);
              }
              try { hidePopup(true); } catch(_) {}
              setTimeout(() => { clickingBox = false; }, 0);
              return;
            }
            const first = targetPairs[0];
            forceApply(first.user || null, first.pass || null, uval, pval);
            if (first.user) filledSet.add(first.user);
            if (first.pass) filledSet.add(first.pass);
            try { hidePopup(true); } catch(_) {}
          } catch(_) {}
          finally {
            setTimeout(() => { clickingBox = false; }, 30);
          }
        }, { capture: true });
        list.addEventListener('click', (ev) => {
          try {
            const item = (ev.target && ev.target.closest && ev.target.closest('.tsu-item')) || null;
            if (!item) return;
            try { ev.preventDefault(); ev.stopPropagation(); } catch(_) {}
            const idx = parseInt(item.getAttribute('data-idx') || '-1', 10);
            if (isNaN(idx) || idx < 0 || idx >= lastEntries.length) return;
            const e = lastEntries[idx] || {};
            // 入力対象の決定: アンカー近傍を最優先
            const anchor = showMaskedPopup.__anchor;
            // 1) 既存のlastPairsがあれば、アンカーと同じformのペアを優先
            let candidates = Array.isArray(lastPairs) ? lastPairs.slice() : [];
            const sameForm = [];
            if (anchor && candidates.length) {
              for (const pr of candidates) {
                try {
                  if ((pr.user && pr.user.form && anchor && anchor.form && pr.user.form === anchor.form) ||
                      (pr.pass && pr.pass.form && anchor && anchor.form && pr.pass.form === anchor.form)) {
                    sameForm.push(pr);
                  }
                } catch(_) {}
              }
            }
            if (!sameForm.length) {
              // 2) lastPairs が無い/不適切なら再探索
              try {
                const inputsNow = getAllInputsDeep(document);
                const pairsNow = pairUserPass(inputsNow);
                candidates = pairsNow || [];
                if (anchor && candidates.length) {
                  for (const pr of candidates) {
                    try {
                      if ((pr.user && pr.user.form && anchor && anchor.form && pr.user.form === anchor.form) ||
                          (pr.pass && pr.pass.form && anchor && anchor.form && pr.pass.form === anchor.form)) {
                        sameForm.push(pr);
                      }
                    } catch(_) {}
                  }
                }
              } catch(_) {}
            }
            let targetPairs = sameForm.length ? sameForm : candidates;
            // 3) まだ無ければ、アンカー単独から相手欄を推定して1組だけ作る
            if ((!targetPairs || !targetPairs.length) && anchor && anchor.closest) {
              const form = anchor.form || anchor.closest('form');
              if (form) {
                try {
                  const inputsInForm = Array.prototype.slice.call(form.querySelectorAll('input'));
                  let u = null, p = null;
                  if (isUserLike(anchor)) {
                    u = anchor;
                    p = inputsInForm.find(isPassLike) || null;
                  } else if (isPassLike(anchor)) {
                    p = anchor;
                    u = inputsInForm.find(isUserLike) || null;
                  }
                  if (u && p) {
                    targetPairs = [{ user: u, pass: p }];
                  }
                } catch(_) {}
              }
            }
            const uval = e.username || '';
            const pval = e.password || '';
            if (!targetPairs || !targetPairs.length) {
              // フォールバック: 単独適用
              let uEl = null, pEl = null;
              if (anchor) {
                const form = anchor.form || (anchor.closest && anchor.closest('form'));
                if (form) {
                  try {
                    const inputsInForm = Array.prototype.slice.call(form.querySelectorAll('input'));
                    if (isUserLike(anchor)) { uEl = anchor; pEl = inputsInForm.find(isPassLike) || null; }
                    else if (isPassLike(anchor)) { pEl = anchor; uEl = inputsInForm.find(isUserLike) || null; }
                  } catch(_) {}
                } else {
                  if (isUserLike(anchor)) uEl = anchor;
                  if (isPassLike(anchor)) pEl = anchor;
                }
              }
              if (uEl || pEl) {
                forceApply(uEl, pEl, uval, pval);
                if (uEl) filledSet.add(uEl);
                if (pEl) filledSet.add(pEl);
              }
              try { hidePopup(true); } catch(_) {}
              return;
            }
            // 同じformの最初の1組にのみ入力（誤入力防止）
            const first = targetPairs[0];
            forceApply(first.user || null, first.pass || null, uval, pval);
            if (first.user) filledSet.add(first.user);
            if (first.pass) filledSet.add(first.pass);
            try { hidePopup(true); } catch(_) {}
          } catch(_) {}
          finally {
            setTimeout(() => { clickingBox = false; }, 30);
          }
        }, true);

        // ホバーでプレビュー入力（マウスのみ）
        let __lastHoverIdx = -1;
        list.addEventListener('mouseover', (ev) => {
          try {
            const item = (ev.target && ev.target.closest && ev.target.closest('.tsu-item')) || null;
            if (!item) return;
            const idx = parseInt(item.getAttribute('data-idx') || '-1', 10);
            if (__lastHoverIdx === idx) return;
            __lastHoverIdx = idx;
            applyEntryByIndex(idx);
          } catch(_) {}
        }, true);
      }
    } else {
      // 単一表示（資格情報が未取得でもユーザID/パスワード行を常に表示）
      box.innerHTML = '' +
        '<div style="display:flex;flex-direction:column;gap:4px;">' +
          '<div><strong>ユーザID:</strong> <span id="tsu-id"></span></div>' +
          '<div><strong>パスワード:</strong> <span id="tsu-pw"></span></div>' +
          '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px;">' +
            '<button id="tsu-save-entry" class="tsu-save" style="background:#1a73e8;color:#fff;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;">tsupasswdに保存</button>' +
          '</div>' +
        '</div>';
      const idSpan = box.querySelector('#tsu-id');
      const pwSpan = box.querySelector('#tsu-pw');
      if (idSpan) idSpan.textContent = idText || '';
      if (pwSpan) pwSpan.textContent = masked;

      // entries が未取得なら現在URLで取得して、一覧に切り替える
      try {
        if ((!lastEntries || !Array.isArray(lastEntries) || !lastEntries.length) && !showMaskedPopup.__fetching) {
          showMaskedPopup.__fetching = true;
          const urlStr = location && location.href ? String(location.href) : '';
          const host = (window.tsupasswd && window.tsupasswd.host) || 'dev.happyfactory.tsupasswd';
          const args = (window.tsupasswd && Array.isArray(window.tsupasswd.extraArgs)) ? window.tsupasswd.extraArgs.slice() : [];
          if (urlStr) args.push(urlStr);
          chrome.runtime.sendMessage({ type: 'RUN_TSUPASSWD', host, args }, (resp) => {
            try {
              showMaskedPopup.__fetching = false;
              if (!(resp && resp.ok)) return;
              let data = resp.data;
              try { data = (typeof data === 'string') ? JSON.parse(data) : data; } catch(_) {}
              if (data && data.entries && Array.isArray(data.entries) && data.entries.length > 0) {
                lastEntries = data.entries;
                try { showMaskedPopup(anchor, idText, pwText); } catch(_) {}
              } else if (data && (data.username || data.password)) {
                // エントリが無くても username があれば単一表示のユーザID欄に反映
                try {
                  const doc = (anchor && anchor.ownerDocument) || document;
                  const boxNow = doc.getElementById('tsupasswd-inline-popup');
                  if (boxNow) {
                    const idSpanNow = boxNow.querySelector('#tsu-id');
                    if (idSpanNow && !idSpanNow.textContent) idSpanNow.textContent = String(data.username || '');
                  }
                } catch(_) {}
              }
            } catch(_) { showMaskedPopup.__fetching = false; }
          });
        }
      } catch(_) { showMaskedPopup.__fetching = false; }
    }
    box.style.display = 'block';
    // レイアウト完了後に位置計算（安定化）
    try { requestAnimationFrame(() => placePopup(anchor, box)); } catch(_) { placePopup(anchor, box); }
    // スクロール/リサイズ時に追従（1回だけバインド）
    if (!window.__tsu_place_bound) {
      const doc = box.ownerDocument || document;
      const win = (doc && doc.defaultView) || window;
      const handler = () => {
        const b = doc.getElementById('tsupasswd-inline-popup');
        if (b && b.style.display !== 'none' && showMaskedPopup.__anchor) {
          placePopup(showMaskedPopup.__anchor, b);
        }
      };
      try { win.addEventListener('scroll', handler, true); } catch(_) {}
      try { win.addEventListener('resize', handler, true); } catch(_) {}
      window.__tsu_place_bound = true;
    }
    showMaskedPopup.__anchor = anchor;
    // 保存ボタンはポップ本体のクリック処理より優先してハンドル
    const saveBtn = box.querySelector('#tsu-save-entry');
    if (saveBtn) {
      const prevent = (ev) => { try { ev.preventDefault(); if (ev.stopImmediatePropagation) ev.stopImmediatePropagation(); ev.stopPropagation(); } catch(_){} };
      // pointerdown（キャプチャ）で即ダイアログを開く（サイト側が click を殺すケース対策）
      saveBtn.addEventListener('pointerdown', (ev) => {
        openingDialog = true; clickingBox = true; prevent(ev);
        try { openSaveDialog(anchor, idText || '', pwText || ''); }
        finally { setTimeout(() => { clickingBox = false; openingDialog = false; }, 0); }
      }, true);
      // バブリング段階でも抑止
      saveBtn.addEventListener('pointerdown', (ev) => { openingDialog = true; clickingBox = true; prevent(ev); });
      // click（キャプチャ）でも冗長に開く（冪等）
      saveBtn.addEventListener('click', (ev) => {
        prevent(ev);
        try { openSaveDialog(anchor, idText || '', pwText || ''); }
        finally { setTimeout(() => { clickingBox = false; openingDialog = false; }, 0); }
      }, true);

      // 追加: 一部サイトでdocumentキャプチャ段階でstopPropagationされる場合に備え、
      // windowキャプチャで保存ボタンクリックを先取りしてダイアログを開く
      const globalCapture = (type) => (ev) => {
        try {
          if (dialogOpen) return; // openingDialog中でもpointerdownで開くため、ここでは開くのを許可
          const path = (ev.composedPath && ev.composedPath()) || [];
          if (path && path.indexOf && path.indexOf(saveBtn) >= 0) {
            openingDialog = true; clickingBox = true;
            prevent(ev);
            try { openSaveDialog(anchor, idText || '', pwText || ''); }
            finally { setTimeout(() => { clickingBox = false; openingDialog = false; }, 0); }
          }
        } catch(_) {}
      };
      try {
        window.addEventListener('pointerdown', globalCapture('pointerdown'), { capture: true, once: true });
        window.addEventListener('click', globalCapture('click'), { capture: true, once: true });
      } catch(_) {}
    }
    return box;
  };
  const hidePopup = function(force) {
    if ((clickingBox && !force) || dialogOpen) return; // ポップクリック中/ダイアログ表示中は隠さない
    try {
      const doc = (showMaskedPopup.__anchor && showMaskedPopup.__anchor.ownerDocument) || document;
      const box = doc.getElementById('tsupasswd-inline-popup');
      if (!box) return;
      const ae = doc.activeElement;
      if (!force) {
        if (overPopup) return;
        try { if (box.matches && box.matches(':hover')) return; } catch(_) {}
        if (ae && (ae === box || (box.contains && box.contains(ae)))) return;
      }
      box.style.display = 'none';
    } catch(_) {}
  };
  const hidePopupDelayed = function() {
    try { setTimeout(() => { try { hidePopup(false); } catch(_) {} }, 120); } catch(_) {}
  };

  const filledSet = new WeakSet();
  let lastPairs = [];
  let lastCreds = null;
  let lastEntries = null;
  const attachBoxClick = function(box) {
    if (!box || box.__tsuClickBound) return;
    const handler = function(e){
      if (dialogOpen) return; // ダイアログ表示中は入力処理を無効化
      // 保存ボタンや保存UIのクリックは無視
      try {
        const t = e.target;
        if (t && (t.closest && (t.closest('#tsu-save-entry') || t.closest('#tsu-save-ok') || t.closest('#tsu-save-cancel') || t.closest('#tsu-save-title') || t.closest('#tsu-save-url') || t.closest('#tsu-save-user') || t.closest('#tsu-save-pass') || t.closest('#tsu-save-note') || t.closest('#tsu-list') || t.closest('.tsu-item') || t.closest('#tsu-save-err-ok')))) {
          return;
        }
      } catch(_) {}
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
        hidePopup(true);
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
      if (!pairs.length) {
        // ペアが無い場合でも、後続のユーザIDのみフォールバックを実行するため続行
        lastPairs = [];
        lastCreds = creds;
      } else {
        lastPairs = pairs;
        lastCreds = creds;
      }
      const userVal = creds.id || creds.username || '';
      const passVal = creds.password || '';
      let firstAnchor = null;
      for (const { user, pass } of pairs) {
        if (!user || !pass) continue;
        if (!firstAnchor) firstAnchor = pass || user;
        // クリック時にポップアップ表示、クリックで入力
        if (!user.__tsuBound) {
          const showOnClick = function(){
            if (dialogOpen) return;
            try {
              const f = user && (user.form || (user.closest && user.closest('form')));
              if (f && f.__tsuBound) return;
              if (f) f.__tsuBound = true;
            } catch(_) { return; }
            const b = showMaskedPopup(user, userVal, passVal); attachBoxClick(b);
          };
          user.addEventListener('pointerdown', showOnClick, true);
          user.addEventListener('click', showOnClick);
          user.addEventListener('blur', hidePopupDelayed);
          user.__tsuBound = true;
        }
        if (!pass.__tsuBound) {
          const showOnClickP = function(){
            if (dialogOpen) return;
            try {
              const f = pass && (pass.form || (pass.closest && pass.closest('form')));
              if (f && f.__tsuBound) return;
              if (f) f.__tsuBound = true;
            } catch(_) { return; }
            const b = showMaskedPopup(pass, userVal, passVal); attachBoxClick(b);
          };
          pass.addEventListener('pointerdown', showOnClickP, true);
          pass.addEventListener('click', showOnClickP);
          pass.addEventListener('blur', hidePopupDelayed);
          pass.__tsuBound = true;
        }
      }
      // パスワード欄が無くペアが作れないページでも、ユーザID欄で表示できるようフォールバックをバインド
      try {
        if (!pairs.length) {
          const usersOnly = (inputs || []).filter(isUserLike);
          if (!firstAnchor && usersOnly.length) firstAnchor = usersOnly[0];
          for (const uEl of usersOnly) {
            if (uEl.__tsuBound) continue;
            const showOnClickU = function(){ if (dialogOpen) return; const b = showMaskedPopup(uEl, userVal, passVal); attachBoxClick(b); };
            uEl.addEventListener('pointerdown', showOnClickU, true);
            uEl.addEventListener('click', showOnClickU);
            uEl.addEventListener('blur', hidePopupDelayed);
            uEl.__tsuBound = true;
          }
          // パスワード欄しかないページでも同様にフォールバック表示
          const passesOnly = (inputs || []).filter(isPassLike);
          if (!firstAnchor && passesOnly.length) firstAnchor = passesOnly[0];
          for (const pEl of passesOnly) {
            if (pEl.__tsuBound) continue;
            const showOnClickOnlyP = function(){ if (dialogOpen) return; const b = showMaskedPopup(pEl, userVal, passVal); attachBoxClick(b); };
            pEl.addEventListener('pointerdown', showOnClickOnlyP, true);
            pEl.addEventListener('click', showOnClickOnlyP);
            pEl.addEventListener('blur', hidePopupDelayed);
            pEl.__tsuBound = true;
          }
        }
      } catch(_) {}
      // 自動表示は行わない（ユーザID/パスワード欄にクリック時のみ表示）

      // グローバルクリック（キャプチャ）で新規/Shadow DOM内のクリックにも反応
      if (!window.__tsu_click_bound) {
        const onClickIn = (e) => {
          try {
            if (dialogOpen) return;
            const path = (e.composedPath && e.composedPath()) || [];
            const t = (path && path.length ? path[0] : e.target);
            const inPopup = !!(t && (t.closest ? t.closest('#tsupasswd-inline-popup') : null));
            const el = (t && t.nodeType === 1) ? (t.matches && t.matches('input') ? t : (t.closest && t.closest('input'))) : null;
            if (!el) { if (!inPopup) hidePopup(); return; }
            if (!isEditableInput(el)) { if (!inPopup) hidePopup(); return; }
            if (!(isUserLike(el) || isPassLike(el))) { if (!inPopup) hidePopup(); return; }
            const b = showMaskedPopup(el, userVal, passVal);
            attachBoxClick(b);
          } catch(_) {}
        };
        document.addEventListener('click', onClickIn, true);
        window.__tsu_click_bound = true;
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
        const host = (window.tsupasswd && window.tsupasswd.host) || 'dev.happyfactory.tsupasswd';
        const args = (window.tsupasswd && Array.isArray(window.tsupasswd.extraArgs)) ? window.tsupasswd.extraArgs.slice() : [];
        args.push(urlStr);
        chrome.runtime.sendMessage({ type: 'RUN_TSUPASSWD', host, args }, (resp) => {
          if (!(resp && resp.ok)) { resolve(null); return; }
          let data = resp.data;
          try { data = (typeof data === 'string') ? JSON.parse(data) : data; } catch(_) {}
          if (!data) { resolve(null); return; }
          // entries対応
          if (data.entries && Array.isArray(data.entries) && data.entries.length > 0) {
            lastEntries = data.entries;
            const first = data.entries[0] || {};
            cachedCreds = { username: first.username || data.username, password: first.password || data.password };
            resolve(cachedCreds);
            return;
          }
          if (!(data.username && data.password)) { resolve(null); return; }
          lastEntries = null;
          cachedCreds = data;
          resolve(cachedCreds);
        });
      });

      const creds = await fetchCreds();
      if (!creds) {
        // 資格情報が無い場合でも、フォーカス時にポップを出せるようにバインドだけ行う
        fillAndBind({ username: '', password: '' });
      } else {
        fillAndBind(creds);
      }

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

      // URL変化（SPA遷移）時に自動表示を再有効化
      if (!window.__tsu_url_bound) {
        const onUrlChange = () => {
          try {
            window.__tsu_auto_shown = false;
            fillAndBind(cachedCreds || { username: '', password: '' });
          } catch(_) {}
        };
        try {
          const origPush = history.pushState;
          const origReplace = history.replaceState;
          history.pushState = function() { try { origPush.apply(this, arguments); } finally { onUrlChange(); } };
          history.replaceState = function() { try { origReplace.apply(this, arguments); } finally { onUrlChange(); } };
        } catch(_) {}
        try { window.addEventListener('popstate', onUrlChange); } catch(_) {}
        try { window.addEventListener('hashchange', onUrlChange); } catch(_) {}
        window.__tsu_url_bound = true;
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
