(function () {
  try {
    if (window.__tsu_navcred_wrapped) return;
    const n = navigator && navigator.credentials;
    if (!n || typeof n.get !== 'function') { window.__tsu_navcred_wrapped = true; return; }
    window.__tsu_navcred_wrapped = true;
    const orig = n.get.bind(n);
    let inflight = 0;
    n.get = async function (opts) {
      inflight++;
      try {
        try { window.postMessage({ type: 'TSU_WEBAUTHN_INFLIGHT', count: inflight, when: Date.now(), src: 'page' }, '*'); } catch (_) {}
        return await orig(opts);
      } finally {
        inflight = Math.max(0, inflight - 1);
        try { window.postMessage({ type: 'TSU_WEBAUTHN_INFLIGHT', count: inflight, when: Date.now(), src: 'page' }, '*'); } catch (_) {}
      }
    };
  } catch (_) {}
})();
