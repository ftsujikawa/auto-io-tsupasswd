(() => {
  let ran = false;
  let clickingBox = false;
  let dialogOpen = false;
  let openingDialog = false;

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

  const forceApply = function(user, pass, uval, pval) {
    if (!user || !pass) return;
    try { user.setAttribute('autocomplete', 'current-username'); } catch(_){}
    try { pass.setAttribute('autocomplete', 'current-password'); } catch(_){}
    const apply = () => { setVal(user, uval); setVal(pass, pval); };
    apply();
    try { setTimeout(apply, 60); } catch(_){}
    try { setTimeout(apply, 260); } catch(_){}
  };

  const ensureFixedPopup = function() {
    let box = document.getElementById("tsupasswd-inline-popup");
    if (!box) {
      box = document.createElement("div");
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
      document.body.appendChild(box);
      // ページ側のグローバルハンドラに奪われないようにイベントを遮断（バブリング段階で停止）
      const stopAll = (e) => { try { if (e.stopImmediatePropagation) e.stopImmediatePropagation(); e.stopPropagation(); } catch(_){} };
      box.addEventListener('click', stopAll, false);
      box.addEventListener('mousedown', stopAll, false);
      box.addEventListener('pointerdown', stopAll, false);
    }
    return box;
  };

  const placePopup = function(anchor, box) {
    if (!anchor || !box) return;
    const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { top: 0, left: 0, bottom: 0, width: 0, height: 0 };
    const gap = 8;
    const top = Math.min(Math.max(r.bottom + gap, 8), window.innerHeight - (box.offsetHeight || 0) - 8);
    const left = Math.min(Math.max(r.left, 8), window.innerWidth - (box.offsetWidth || 0) - 8);
    box.style.top = top + "px";
    box.style.left = left + "px";
  };
  const openSaveDialog = function(anchor, idText, pwText) {
    const box = ensureFixedPopup();
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
    // 初期フォーカス（タイトル入力にフォーカス）
    try { setTimeout(() => { const ti = q('#tsu-save-title'); if (ti && ti.focus) { ti.focus(); try { ti.select && ti.select(); } catch(_){} } }, 0); } catch(_) {}
    const cancel = (ev) => { try { ev.preventDefault(); ev.stopPropagation(); } catch(_){} try { box.__syncCleanup && box.__syncCleanup(); } catch(_){} dialogOpen = false; openingDialog = false; hidePopup(); };

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
      if (!id) msg = 'ユーザIDは必須です。';
      else if (!pw) msg = 'パスワードは必須です。';
      else if (!u) msg = 'URLは必須です。';
      else if (!isValidUrl(u)) msg = 'URLが不正です（http/https/fileのみ）。';
      if (msg) {
        if (err) { err.textContent = msg; err.style.display = 'block'; }
        setBtn(false);
        return false;
      }
      if (err) { err.textContent = ''; err.style.display = 'none'; }
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
      try { ev.preventDefault(); ev.stopPropagation(); } catch(_){}
      if (!validate()) return;
      const entry = buildSavePayload();
      const host = (window.tsupasswd && window.tsupasswd.host) || 'com.tsu.tsupasswd';
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
        chrome.runtime.sendMessage({ type: 'RUN_TSUPASSWD', host, args }, (resp) => {
          const ok = !!(resp && resp.ok);
          if (!ok) {
            try { console.debug('RUN_TSUPASSWD(save) failed:', resp); } catch(_) {}
            const extra = (resp && resp.data && resp.data.stdout) ? `<pre style=\"white-space:pre-wrap;max-height:120px;overflow:auto;margin:6px 0 0;\">${resp.data.stdout}</pre>` : '';
            const errTxt = (resp && (resp.error || (resp.data && resp.data.error))) ? `<div style=\"color:#f28b82;font-size:12px;margin-top:6px;\">${resp.error || (resp.data && resp.data.error) || ''}</div>` : '';
            box.innerHTML = `<div style=\"display:flex;flex-direction:column;gap:8px;padding:8px 4px;\">`+
              `<div>保存に失敗しました。</div>${extra}${errTxt}`+
              `<div style=\"display:flex;justify-content:flex-end;\">`+
                `<button id=\"tsu-save-err-ok\" style=\"background:#1a73e8;color:#fff;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;\">OK</button>`+
              `</div>`+
            `</div>`;
            const okBtn = box.querySelector('#tsu-save-err-ok');
            if (okBtn) okBtn.addEventListener('click', (ev) => { try { ev.preventDefault(); ev.stopPropagation(); } catch(_){} dialogOpen = false; openingDialog = false; hidePopup(); });
          } else {
            try { box.__syncCleanup && box.__syncCleanup(); } catch(_){}
            const extra = (resp && resp.data && resp.data.stdout) ? `<pre style=\"white-space:pre-wrap;max-height:120px;overflow:auto;margin:6px 0 0;\">${resp.data.stdout}</pre>` : '';
            box.innerHTML = `<div style=\"padding:8px 4px;\">保存しました。${extra}</div>`;
            setTimeout(() => { dialogOpen = false; openingDialog = false; try { hidePopup(); } catch(_){} try { location.reload(); } catch(_){} }, 800);
          }
        });
      } else {
        chrome.runtime.sendMessage({ type: 'SAVE_TSUPASSWD', host, entry }, (resp) => {
          const ok = !!(resp && resp.ok);
          if (ok) {
            try { box.__syncCleanup && box.__syncCleanup(); } catch(_){}
            const extra = (resp && resp.data && resp.data.stdout) ? `<pre style=\"white-space:pre-wrap;max-height:120px;overflow:auto;margin:6px 0 0;\">${resp.data.stdout}</pre>` : '';
            box.innerHTML = `<div style=\"padding:8px 4px;\">保存しました。${extra}</div>`;
            setTimeout(() => { dialogOpen = false; openingDialog = false; try { hidePopup(); } catch(_){} try { location.reload(); } catch(_){} }, 800);
          } else {
            // フォールバック: RUN_TSUPASSWD を試す
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
              chrome.runtime.sendMessage({ type: 'RUN_TSUPASSWD', host, args }, (resp2) => {
                const ok2 = !!(resp2 && resp2.ok);
                if (!ok2) { try { console.debug('RUN_TSUPASSWD(save-fallback) failed:', resp2); } catch(_) {} }
                if (!ok2) {
                  const extra2 = (resp2 && resp2.data && resp2.data.stdout) ? `<pre style=\"white-space:pre-wrap;max-height:120px;overflow:auto;margin:6px 0 0;\">${resp2.data.stdout}</pre>` : '';
                  const errTxt2 = (resp2 && (resp2.error || (resp2.data && resp2.data.error))) ? `<div style=\"color:#f28b82;font-size:12px;margin-top:6px;\">${resp2.error || (resp2.data && resp2.data.error) || ''}</div>` : '';
                  box.innerHTML = `<div style=\"display:flex;flex-direction:column;gap:8px;padding:8px 4px;\">`+
                    `<div>保存に失敗しました。</div>${extra2}${errTxt2}`+
                    `<div style=\"display:flex;justify-content:flex-end;\">`+
                      `<button id=\"tsu-save-err-ok\" style=\"background:#1a73e8;color:#fff;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;\">OK</button>`+
                    `</div>`+
                  `</div>`;
                  const okBtn2 = box.querySelector('#tsu-save-err-ok');
                  if (okBtn2) okBtn2.addEventListener('click', (ev) => { try { ev.preventDefault(); ev.stopPropagation(); } catch(_){} dialogOpen = false; openingDialog = false; hidePopup(); });
                } else {
                  try { box.__syncCleanup && box.__syncCleanup(); } catch(_){}
                  const extra2 = (resp2 && resp2.data && resp2.data.stdout) ? `<pre style=\"white-space:pre-wrap;max-height:120px;overflow:auto;margin:6px 0 0;\">${resp2.data.stdout}</pre>` : '';
                  box.innerHTML = `<div style=\"padding:8px 4px;\">保存しました。${extra2}</div>`;
                  setTimeout(() => { dialogOpen = false; openingDialog = false; try { hidePopup(); } catch(_){} try { location.reload(); } catch(_){} }, 800);
                }
              });
            } catch(_) {
              box.innerHTML = '<div style="padding:8px 4px;">保存に失敗しました。</div>';
              const okBtn3 = document.createElement('button');
              okBtn3.id = 'tsu-save-err-ok';
              okBtn3.style.background = '#1a73e8';
              okBtn3.style.color = '#fff';
              okBtn3.style.border = 'none';
              okBtn3.style.borderRadius = '6px';
              okBtn3.style.padding = '6px 10px';
              okBtn3.style.cursor = 'pointer';
              okBtn3.textContent = 'OK';
              box.appendChild(okBtn3);
              okBtn3.addEventListener('click', (ev) => { try { ev.preventDefault(); ev.stopPropagation(); } catch(_){} try { box.__syncCleanup && box.__syncCleanup(); } catch(_){} dialogOpen = false; openingDialog = false; hidePopup(); });
            }
          }
        });
      }
    };
    const btnCancel = q('#tsu-save-cancel');
    if (btnCancel) { btnCancel.addEventListener('pointerdown', cancel); btnCancel.addEventListener('click', cancel); }
    if (btnOk) { btnOk.addEventListener('pointerdown', save); btnOk.addEventListener('click', save); }
    return box;
  };

  const showMaskedPopup = function(anchor, idText, pwText) {
    // 保存ダイアログが開いている場合は、位置だけ追従して内容は上書きしない
    if (dialogOpen || openingDialog) {
      const boxExist = document.getElementById('tsupasswd-inline-popup') || ensureFixedPopup();
      try { requestAnimationFrame(() => placePopup(anchor, boxExist)); } catch(_) { placePopup(anchor, boxExist); }
      return boxExist;
    }
    const box = ensureFixedPopup();
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
              '<div style="display:flex;gap:8px;font-size:12px;">' +
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
            if (!targetPairs || !targetPairs.length) return;
            const uval = e.username || '';
            const pval = e.password || '';
            const first = targetPairs[0];
            if (first && first.user && first.pass) {
              forceApply(first.user, first.pass, uval, pval);
              filledSet.add(first.user); filledSet.add(first.pass);
            }
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
            if (!targetPairs || !targetPairs.length) { setTimeout(() => { clickingBox = false; }, 0); return; }
            const uval = e.username || '';
            const pval = e.password || '';
            const first = targetPairs[0];
            if (first && first.user && first.pass) {
              forceApply(first.user, first.pass, uval, pval);
              filledSet.add(first.user); filledSet.add(first.pass);
            }
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
            if (!targetPairs || !targetPairs.length) return;
            const uval = e.username || '';
            const pval = e.password || '';
            // 同じformの最初の1組にのみ入力（誤入力防止）
            const first = targetPairs[0];
            if (first && first.user && first.pass) {
              forceApply(first.user, first.pass, uval, pval);
              filledSet.add(first.user); filledSet.add(first.pass);
            }
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
      // 単一表示
      const hasCreds = !!(idText && idText.length) || !!(pwText && pwText.length);
      let rows = '';
      if (hasCreds) {
        rows += '<div><strong>ユーザID:</strong> <span id="tsu-id"></span></div>';
        rows += '<div><strong>パスワード:</strong> <span id="tsu-pw"></span></div>';
      }
      box.innerHTML = '' +
        '<div style="display:flex;flex-direction:column;gap:4px;">' +
          rows +
          '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px;">' +
            '<button id="tsu-save-entry" class="tsu-save" style="background:#1a73e8;color:#fff;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;">tsupasswdに保存</button>' +
          '</div>' +
        '</div>';
      if (hasCreds) {
        const idSpan = box.querySelector('#tsu-id');
        const pwSpan = box.querySelector('#tsu-pw');
        if (idSpan) idSpan.textContent = idText || '';
        if (pwSpan) pwSpan.textContent = masked;
      }
    }
    box.style.display = 'block';
    // レイアウト完了後に位置計算（安定化）
    try { requestAnimationFrame(() => placePopup(anchor, box)); } catch(_) { placePopup(anchor, box); }
    // スクロール/リサイズ時に追従（1回だけバインド）
    if (!window.__tsu_place_bound) {
      const handler = () => {
        const b = document.getElementById('tsupasswd-inline-popup');
        if (b && b.style.display !== 'none' && showMaskedPopup.__anchor) {
          placePopup(showMaskedPopup.__anchor, b);
        }
      };
      window.addEventListener('scroll', handler, true);
      window.addEventListener('resize', handler, true);
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
  const hidePopup = function() {
    if (clickingBox || dialogOpen) return; // ポップクリック中/ダイアログ表示中は隠さない
    const box = document.getElementById('tsupasswd-inline-popup');
    if (box) box.style.display = 'none';
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
          user.addEventListener('focus', function(){
            if (dialogOpen) return;
            try {
              const f = user && (user.form || (user.closest && user.closest('form')));
              if (!f) return;
              const ins = Array.prototype.slice.call(f.querySelectorAll('input'));
              const u = ins.find(isUserLike) || null;
              const p = ins.find(isPassLike) || null;
              if (!(u && p)) return; // 片方も無ければ表示しない
            } catch(_) { return; }
            const b = showMaskedPopup(user, userVal, passVal); attachBoxClick(b);
          });
          user.addEventListener('blur', hidePopup);
          user.__tsuBound = true;
        }
        if (!pass.__tsuBound) {
          pass.addEventListener('focus', function(){
            if (dialogOpen) return;
            try {
              const f = pass && (pass.form || (pass.closest && pass.closest('form')));
              if (!f) return;
              const ins = Array.prototype.slice.call(f.querySelectorAll('input'));
              const u = ins.find(isUserLike) || null;
              const p = ins.find(isPassLike) || null;
              if (!(u && p)) return; // 片方も無ければ表示しない
            } catch(_) { return; }
            const b = showMaskedPopup(pass, userVal, passVal); attachBoxClick(b);
          });
          pass.addEventListener('blur', hidePopup);
          pass.__tsuBound = true;
        }
      }
      // ロード直後は自動表示しない（フォーカス時のみ表示）

      // グローバルfocusinで新規/Shadow DOM内のフォーカスにも反応
      if (!window.__tsu_focusin_bound) {
        const onFocusIn = (e) => {
          try {
            if (dialogOpen) return;
            const p = (e.composedPath && e.composedPath()) || [];
            const t = (p && p.length ? p[0] : e.target);
            const el = (t && t.nodeType === 1) ? (t.matches && t.matches('input') ? t : (t.closest && t.closest('input'))) : null;
            const popup = document.getElementById('tsupasswd-inline-popup');
            const inPopup = popup && (popup === t || (t.closest && t.closest('#tsupasswd-inline-popup')));
            if (!el) {
              if (!inPopup) hidePopup();
              return;
            }
            if (!isUserLike(el) && !isPassLike(el)) {
              if (!inPopup) hidePopup();
              return;
            }
            // 同一formにユーザID/パスワード両方が無い場合は表示しない
            try {
              const f = el && (el.form || (el.closest && el.closest('form')));
              if (f) {
                const ins = Array.prototype.slice.call(f.querySelectorAll('input'));
                const u = ins.find(isUserLike) || null;
                const p = ins.find(isPassLike) || null;
                if (!(u && p)) { if (!inPopup) hidePopup(); return; }
              } else { if (!inPopup) hidePopup(); return; }
            } catch(_) { if (!inPopup) hidePopup(); return; }
            const b = showMaskedPopup(el, userVal, passVal);
            attachBoxClick(b);
          } catch(_) {}
        };
        document.addEventListener('focusin', onFocusIn, true);
        window.__tsu_focusin_bound = true;
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
