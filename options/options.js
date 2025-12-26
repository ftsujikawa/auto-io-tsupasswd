const input = document.getElementById("sample");
const saveBtn = document.getElementById("save");

async function restore() {
  if (!input) return;
  const { sample = "" } = await chrome.storage.sync.get(["sample"]);
  input.value = sample;
}

async function save() {
  if (!input) return;
  const sample = input.value || "";
  await chrome.storage.sync.set({ sample });
}

if (saveBtn) saveBtn.addEventListener("click", save);
restore();

// ==========================
// Password Manager 連携（Chrome内蔵の保存を無効化）
// ==========================
(function(){
  const cb = document.getElementById('disable-chrome-password-saving');
  const st = document.getElementById('pm-status');
  if (!cb) return;

  const setStatus = (msg, isError) => {
    try {
      if (!st) return;
      st.textContent = String(msg || '');
      st.style.color = isError ? '#d93025' : '';
    } catch(_) {}
  };

  const applyPrivacy = (disable) => {
    try {
      if (!(chrome && chrome.privacy && chrome.privacy.services && chrome.privacy.services.passwordSavingEnabled)) {
        setStatus('この環境では設定を変更できません。', true);
        return;
      }
      const api = chrome.privacy.services.passwordSavingEnabled;
      if (disable) {
        api.set({ value: false }, () => {
          if (chrome.runtime && chrome.runtime.lastError) {
            setStatus('設定に失敗しました: ' + String(chrome.runtime.lastError.message || ''), true);
          } else {
            setStatus('Chromeのパスワード保存を無効化しました');
            setTimeout(() => { try { if (st && st.textContent === 'Chromeのパスワード保存を無効化しました') st.textContent = ''; } catch(_) {} }, 1400);
          }
        });
      } else {
        api.clear({}, () => {
          if (chrome.runtime && chrome.runtime.lastError) {
            setStatus('設定の解除に失敗しました: ' + String(chrome.runtime.lastError.message || ''), true);
          } else {
            setStatus('Chromeのパスワード保存を既定に戻しました');
            setTimeout(() => { try { if (st && st.textContent === 'Chromeのパスワード保存を既定に戻しました') st.textContent = ''; } catch(_) {} }, 1400);
          }
        });
      }
    } catch(e) {
      setStatus('例外: ' + String(e && e.message || e), true);
    }
  };

  // restore
  try {
    chrome.storage.local.get({ disable_chrome_password_saving: false }, (data) => {
      try { cb.checked = !!(data && data.disable_chrome_password_saving); } catch(_) {}
    });
  } catch(_) {}

  cb.addEventListener('change', () => {
    const disable = !!cb.checked;
    try { chrome.storage.local.set({ disable_chrome_password_saving: disable }); } catch(_) {}
    applyPrivacy(disable);
  });
})();

// ==========================
// 検索・一覧・更新（オプション）
// ==========================
(function(){
  const qTitle = document.getElementById('q-title');
  const qUrl = document.getElementById('q-url');
  const qUsername = document.getElementById('q-username');
  const qSearch = document.getElementById('q-search');
  const statusEl = document.getElementById('status');
  const tbody = document.getElementById('cred-tbody');

  if (!qSearch || !tbody) return;

  const esc = (s) => { try { return String(s); } catch(_) { return ''; } };

  // options でも popup と同様のラッパーを用意
  window.tsupasswd = window.tsupasswd || {};
  if (typeof window.tsupasswd.search !== 'function') {
    (function(){
      function runTsupasswd(argStr) {
        return new Promise(function(resolve, reject) {
          try {
            const args = [];
            if (argStr) args.push(String(argStr));
            chrome.runtime.sendMessage({ type: 'RUN_TSUPASSWD', args }, function(resp) {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
              }
              if (!resp || !resp.ok) {
                reject(new Error((resp && resp.error) ? resp.error : 'Unknown error'));
                return;
              }
              const payload = (typeof resp.data === 'string') ? resp.data : JSON.stringify(resp.data);
              resolve(payload);
            });
          } catch(e) { reject(e); }
        });
      }
      window.tsupasswd.search = async function(query) {
        const raw = await runTsupasswd(query);
        const text = (typeof raw === 'string') ? raw.trim() : JSON.stringify(raw || {});
        try { return JSON.parse(text); } catch(_) { return { ok: false, error: 'invalid json', raw: text }; }
      };
    })();
  }

  let originals = [];

  function normalizeEntries(resp) {
    const list = [];
    if (resp && Array.isArray(resp.entries)) {
      for (const e of resp.entries) {
        list.push({
          id: esc(e.id || ''),
          title: esc(e.title || ''),
          url: esc(e.url || ''),
          username: esc(e.username || ''),
          password: esc(e.password || ''),
          note: esc(e.note || e.memo || e.remark || ''),
        });
      }
    } else if (resp && (resp.username || resp.password)) {
      list.push({
        id: esc(resp.id || ''),
        title: esc(resp.title || ''),
        url: esc(resp.url || ''),
        username: esc(resp.username || ''),
        password: esc(resp.password || ''),
        note: esc(resp.note || ''),
      });
    }
    return list;
  }

  function rowChanged(idx) {
    const tr = tbody.querySelector(`tr[data-idx="${idx}"]`);
    if (!tr) return false;
    const o = originals[idx] || {};
    const cur = {
      title: (tr.querySelector('.f-title')?.value || ''),
      url: (tr.querySelector('.f-url')?.value || ''),
      username: (tr.querySelector('.f-username')?.value || ''),
      password: (tr.querySelector('.f-password')?.value || ''),
      note: (tr.querySelector('.f-note')?.value || ''),
    };
    return (o.title !== cur.title) || (o.url !== cur.url) || (o.username !== cur.username) || (o.password !== cur.password) || (o.note !== cur.note);
  }

  function attachRowEvents(tr, idx) {
    const inputs = tr.querySelectorAll('input');
    const btn = tr.querySelector('.btn-update');
    const delBtn = tr.querySelector('.btn-delete');
    const updateDisabled = () => { if (btn) btn.disabled = !rowChanged(idx); };
    inputs.forEach(i => i.addEventListener('input', updateDisabled));
    updateDisabled();
    // パスワード表示/非表示トグル
    const toggleBtn = tr.querySelector('.btn-toggle');
    const pw = tr.querySelector('.f-password');
    if (toggleBtn && pw) {
      toggleBtn.addEventListener('click', () => {
        if (pw.type === 'password') {
          pw.type = 'text';
          toggleBtn.textContent = '非表示';
        } else {
          pw.type = 'password';
          toggleBtn.textContent = '表示';
        }
      });
    }
    if (btn) btn.addEventListener('click', async () => {
      const rid = tr.getAttribute('data-id') || '';
      if (!rid) {
        statusEl.textContent = '更新に失敗しました IDが不明です';
        return;
      }
      const cur = {
        title: tr.querySelector('.f-title')?.value || '',
        url: tr.querySelector('.f-url')?.value || '',
        username: tr.querySelector('.f-username')?.value || '',
        password: tr.querySelector('.f-password')?.value || '',
        note: tr.querySelector('.f-note')?.value || '',
      };
      const orig = originals[idx] || {};
      const args = ['update', rid];
      if (cur.url !== undefined && cur.url !== orig.url && cur.url.trim() !== '') { args.push('--url', cur.url); }
      if (cur.username !== undefined && cur.username !== orig.username && cur.username.trim() !== '') { args.push('--user', cur.username); }
      if (cur.password !== undefined && cur.password !== orig.password && cur.password !== '') { args.push('--password', cur.password); }
      if (cur.title !== undefined && cur.title !== orig.title && cur.title.trim() !== '') { args.push('--title', cur.title); }
      if (cur.note !== undefined && cur.note !== orig.note && cur.note.trim() !== '') { args.push('--note', cur.note); }
      if (args.length === 2) {
        statusEl.textContent = '変更がありません';
        return;
      }
      statusEl.textContent = '更新中…';
      try {
        chrome.runtime.sendMessage({ type: 'RUN_TSUPASSWD', args }, (resp) => {
          if (!resp || resp.ok === false) {
            statusEl.textContent = '更新に失敗しました' + (resp && resp.error ? (' ' + resp.error) : '');
            return;
          }
          statusEl.textContent = '更新しました';
          originals[idx] = { ...cur };
          btn.disabled = true;
          setTimeout(() => { if (statusEl.textContent === '更新しました') statusEl.textContent = ''; }, 1200);
        });
      } catch(e) {
        statusEl.textContent = '更新エラー: ' + (e && e.message ? e.message : e);
      }
    });

    if (delBtn) delBtn.addEventListener('click', async () => {
      const rid = tr.getAttribute('data-id') || '';
      if (!rid) {
        statusEl.textContent = '削除に失敗しました IDが不明です';
        return;
      }
      statusEl.textContent = '削除中…';
      try {
        chrome.runtime.sendMessage({ type: 'DELETE_TSUPASSWD', entry: { id: rid } }, (resp) => {
          if (!resp || resp.ok === false) {
            statusEl.textContent = '削除に失敗しました' + (resp && resp.error ? (' ' + resp.error) : '');
            return;
          }
          statusEl.textContent = '削除しました';
          // 行を削除し、originals も更新
          try {
            const idxNum = parseInt(tr.getAttribute('data-idx') || '-1', 10);
            if (!isNaN(idxNum) && idxNum >= 0) {
              originals.splice(idxNum, 1);
            }
            tr.parentElement?.removeChild(tr);
            // 残りの行の data-idx を振り直し
            Array.from(tbody.querySelectorAll('tr')).forEach((row, i) => row.setAttribute('data-idx', String(i)));
          } catch(_) {}
          setTimeout(() => { if (statusEl.textContent === '削除しました') statusEl.textContent = ''; }, 1200);
        });
      } catch(e) {
        statusEl.textContent = '削除エラー: ' + (e && e.message ? e.message : e);
      }
    });
  }

  function render(entries) {
    tbody.innerHTML = '';
    entries.forEach((e, idx) => {
      const tr = document.createElement('tr');
      tr.setAttribute('data-idx', String(idx));
      if (e.id) tr.setAttribute('data-id', String(e.id));
      tr.innerHTML = `
        <td><input class="f-title" type="text" value="${e.title}" /></td>
        <td><input class="f-url" type="text" value="${e.url}" /></td>
        <td><input class="f-username" type="text" value="${e.username}" /></td>
        <td>
          <div style="display:flex; gap:6px; align-items:center;">
            <input class="f-password" type="password" value="${e.password}" />
            <button type="button" class="btn-toggle">表示</button>
          </div>
        </td>
        <td><input class="f-note" type="text" value="${e.note || ''}" /></td>
        <td>
          <div style="display:flex; gap:6px;">
            <button class="btn-update">更新</button>
            <button class="btn-delete" style="background:#7f1d1d;border-color:#7f1d1d;">削除</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
      attachRowEvents(tr, idx);
    });
  }

  async function doSearch() {
    const title = (qTitle && qTitle.value || '').trim();
    const url = (qUrl && qUrl.value || '').trim();
    const user = (qUsername && qUsername.value || '').trim();
    const query = [title, url, user].filter(Boolean).join(' ');
    if (!query) {
      statusEl.textContent = '検索条件を入力してください';
      return;
    }
    statusEl.textContent = '検索中…';
    try {
      const resp = await window.tsupasswd.search(query);
      if (!resp || resp.ok === false) {
        statusEl.textContent = '検索に失敗しました' + (resp && resp.error ? (' ' + resp.error) : '');
        return;
      }
      const list = normalizeEntries(resp);
      originals = list.map(e => ({ ...e }));
      render(list);
      statusEl.textContent = `${list.length} 件`;
    } catch(e) {
      statusEl.textContent = 'エラー: ' + (e && e.message ? e.message : e);
    }
  }

  qSearch.addEventListener('click', doSearch);
})();

// ==========================
// パスキー検索（オプション）
// ==========================
(function(){
  const q = document.getElementById('pk-q');
  const btn = document.getElementById('pk-search');
  const status = document.getElementById('pk-status');
  const tbody = document.getElementById('pk-tbody');

  if (!btn || !tbody) return;

  async function runArgs(args) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ type: 'RUN_TSUPASSWD', args }, (resp) => {
          if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
          if (!resp || resp.ok === false) { reject(new Error((resp && resp.error) || 'native error')); return; }
          resolve(resp);
        });
      } catch(e) { reject(e); }
    });
  }

  function esc(s) { try { return String(s || ''); } catch(_) { return ''; } }
  function b64short(s) { s = esc(s); if (s.length > 20) return s.slice(0,10) + '…' + s.slice(-9); return s; }

  function normalizeList(stdout) {
    try {
      const data = JSON.parse(stdout || '[]');
      const arr = Array.isArray(data) ? data : (Array.isArray(data.entries) ? data.entries : [data]);
      return arr.map((e) => ({
        id: esc(e.id || e.entry_id || e.record_id || ''),
        title: esc(e.title || e.name || ''),
        rp_id: esc(e.rp_id || e.rpId || e.rp || ''),
        credential_id: esc(e.credential_id || e.credentialId || e.id || ''),
        user_handle: esc(e.user_handle || e.userHandle || ''),
        public_key: esc(e.public_key || e.publicKey || ''),
        sign_count: esc(e.sign_count || e.signCount || ''),
        transports: esc(e.transports || ''),
      }));
    } catch(_) { return []; }
  }

  function render(list) {
    tbody.innerHTML = '';
    list.forEach((e, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${esc(e.title)}</td>
        <td>${esc(e.rp_id)}</td>
        <td><code title="${esc(e.credential_id)}">${b64short(e.credential_id)}</code></td>
        <td><code title="${esc(e.user_handle)}">${b64short(e.user_handle)}</code></td>
        <td>${esc(e.sign_count)}</td>
        <td>${esc(e.transports)}</td>
        <td>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="pk-copy" data-k="credential_id">IDコピー</button>
            <button class="pk-copy" data-k="user_handle">UHコピー</button>
            <button class="pk-copy" data-k="public_key">PKコピー</button>
            <button class="pk-delete" style="background:#7f1d1d;border-color:#7f1d1d;">削除</button>
          </div>
        </td>
      `;
      tr.dataset.idx = String(idx);
      // public_key は列に出さないが保持
      tr.__public_key = e.public_key;
      tr.__credential_id = e.credential_id;
      tr.__pk_id = e.id; // 削除に使用する本来のID
      tbody.appendChild(tr);
    });
    // クリップボードコピー
    tbody.querySelectorAll('.pk-copy').forEach((b) => {
      b.addEventListener('click', () => {
        try {
          const tr = b.closest('tr'); if (!tr) return;
          const key = b.getAttribute('data-k') || '';
          let val = '';
          if (key === 'credential_id') val = tr.querySelector('td:nth-child(3) code')?.getAttribute('title') || '';
          else if (key === 'user_handle') val = tr.querySelector('td:nth-child(4) code')?.getAttribute('title') || '';
          else if (key === 'public_key') val = tr.__public_key || '';
          if (val) navigator.clipboard.writeText(val);
        } catch(_) {}
      });
    });
    // 削除
    tbody.querySelectorAll('.pk-delete').forEach((btn) => {
      btn.addEventListener('click', () => {
        try {
          const tr = btn.closest('tr'); if (!tr) return;
          const rid = tr.__pk_id || tr.__credential_id || tr.querySelector('td:nth-child(3) code')?.getAttribute('title') || '';
          if (!rid) { status.textContent = '削除に失敗: ID不明'; return; }
          status.textContent = '認証中…';
          const hostPref = (window.tsupasswd && window.tsupasswd.host) || '';
          // 先に認証を試みてロックを解除
          chrome.runtime.sendMessage({ type: 'AUTH_TSUPASSWD', host: hostPref }, () => {
            // 認証の成否に関わらず削除を試行（ウォッチドッグ付き）
            status.textContent = '削除中…';
            let done = false;
            const watchdog = setTimeout(() => {
              if (done) return;
              status.textContent = '削除タイムアウト: 再試行中…';
              // フォールバック: 直接 RUN_TSUPASSWD で passkey delete を試す
              chrome.runtime.sendMessage({ type: 'RUN_TSUPASSWD', host: hostPref, args: ['passkey', 'delete', rid] }, (resp2) => {
                try {
                  if (chrome.runtime && chrome.runtime.lastError) {
                    status.textContent = '削除に失敗しました ' + String(chrome.runtime.lastError.message || 'runtime error');
                    return;
                  }
                  if (!resp2 || resp2.ok === false) {
                    const err2 = (resp2 && (resp2.error || (resp2.data && (resp2.data.stderr || resp2.data.stdout)))) || 'unknown';
                    status.textContent = '削除に失敗しました ' + String(err2);
                    return;
                  }
                  try { tr.parentElement?.removeChild(tr); } catch(_) {}
                  status.textContent = '削除しました 再読み込み中…';
                  try { doSearch(); } catch(_) { setTimeout(() => { try { doSearch(); } catch(_) {} }, 300); }
                  setTimeout(() => { if (status.textContent.startsWith('削除しました')) status.textContent = ''; }, 1500);
                } catch(_) { status.textContent = '削除に失敗しました'; }
              });
            }, 12000);
            chrome.runtime.sendMessage({ type: 'DELETE_TSUPASSWD', host: hostPref, entry: { id: rid } }, (resp) => {
              try {
                done = true;
                clearTimeout(watchdog);
                if (chrome.runtime && chrome.runtime.lastError) {
                  status.textContent = '削除に失敗しました ' + String(chrome.runtime.lastError.message || 'runtime error');
                  return;
                }
                if (!resp || resp.ok === false) {
                  const err = (resp && (resp.error || (resp.data && (resp.data.stderr || resp.data.stdout)))) || 'unknown';
                  status.textContent = '削除に失敗しました ' + String(err);
                  return;
                }
                try { tr.parentElement?.removeChild(tr); } catch(_) {}
                status.textContent = '削除しました 再読み込み中…';
                // 最新状態で再検索してUIを同期
                try { doSearch(); } catch(_) { setTimeout(() => { try { doSearch(); } catch(_) {} }, 300); }
                setTimeout(() => { if (status.textContent.startsWith('削除しました')) status.textContent = ''; }, 1500);
              } catch(_) { status.textContent = '削除に失敗しました'; }
            });
          });
        } catch(_) {}
      });
    });
  }

  async function doSearch() {
    const query = (q && q.value || '').trim();
    if (!query) { status.textContent = '検索語を入力してください'; return; }
    status.textContent = '検索中…';
    try {
      const resp = await runArgs(['passkey', 'search', query, '--json']);
      const stdout = resp && resp.data && resp.data.stdout;
      const list = normalizeList(typeof stdout === 'string' ? stdout : JSON.stringify(stdout || '[]'));
      render(list);
      status.textContent = `${list.length} 件`;
    } catch(e) {
      status.textContent = 'エラー: ' + (e && e.message ? e.message : e);
    }
  }

  btn.addEventListener('click', doSearch);
})();

