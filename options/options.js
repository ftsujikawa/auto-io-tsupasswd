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
