(() => {
  const toB64Url = (buf) => {
    try {
      const b = buf instanceof ArrayBuffer ? new Uint8Array(buf) : (ArrayBuffer.isView(buf) ? new Uint8Array(buf.buffer) : null);
      if (!b) return null;
      let s = '';
      for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
      const b64 = btoa(s);
      return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    } catch(_) { return null; }
  };
  const summarizeCredential = (cred) => {
    try {
      if (!cred) return null;
      const out = { id: cred.id || null, type: cred.type || null };
      try { out.rawId = cred.rawId ? toB64Url(cred.rawId) : null; } catch(_) {}
      try {
        const r = cred.response || {};
        const obj = r.attestationObject; const cdj = r.clientDataJSON;
        if (obj) out.response = Object.assign(out.response || {}, { attestationObject: toB64Url(obj) });
        if (cdj) out.response = Object.assign(out.response || {}, { clientDataJSON: toB64Url(cdj) });
      } catch(_) {}
      try { if (typeof cred.getTransports === 'function') { out.transports = cred.getTransports(); } } catch(_) {}
      return out;
    } catch(_) { return null; }
  };
  const post = (detail) => {
    try { window.postMessage(detail, '*'); } catch(_) {}
    try { if (window.top && window.top !== window) window.top.postMessage(detail, '*'); } catch(_) {}
    try { document.dispatchEvent(new CustomEvent('TSU_PASSKEY_REGISTERED', { detail })); } catch(_) {}
    try { if (window.top && window.top !== window) window.top.document.dispatchEvent(new CustomEvent('TSU_PASSKEY_REGISTERED', { detail })); } catch(_) {}
  };
  try {
    const log = (...a) => { try { console.info('[tsu][hook]', ...a); } catch(_) {} };
    // navigator.credentials.create をフック
    if (!window.__tsu_page_hooked_nav_create && navigator && navigator.credentials && typeof navigator.credentials.create === 'function') {
      window.__tsu_page_hooked_nav_create = true;
      const origCreate = navigator.credentials.create.bind(navigator.credentials);
      navigator.credentials.create = function(options) {
        log('navigator.credentials.create called', options && options.publicKey ? 'with publicKey' : '');
        const p = origCreate(options);
        try {
          return Promise.resolve(p).then((res) => {
            try {
              if (options && options.publicKey) {
                const detail = {
                  type: 'TSU_PASSKEY_REGISTERED', from: 'page', via: 'nav.create', at: Date.now(),
                  credential: summarizeCredential(res),
                  userHandle: (options && options.publicKey && options.publicKey.user && options.publicKey.user.id) ? toB64Url(options.publicKey.user.id) : null,
                  rpId: (options && options.publicKey && (options.publicKey.rpId || (options.publicKey.rp && options.publicKey.rp.id))) || null,
                  origin: location && location.origin || null,
                };
                post(detail);
                log('posted TSU_PASSKEY_REGISTERED via nav.create');
              }
            } catch (__) {}
            return res;
          });
        } catch (__) { return p; }
      };
    }
  } catch (__) {}
  try {
    // SimpleWebAuthnBrowser.startRegistration をフック
    if (window.SimpleWebAuthnBrowser && !window.__tsu_page_hooked_swa_reg && typeof window.SimpleWebAuthnBrowser.startRegistration === 'function') {
      window.__tsu_page_hooked_swa_reg = true;
      const origStartReg = window.SimpleWebAuthnBrowser.startRegistration.bind(window.SimpleWebAuthnBrowser);
      window.SimpleWebAuthnBrowser.startRegistration = async function(opts) {
        const r = await origStartReg(opts);
        try {
          const detail = {
            type: 'TSU_PASSKEY_REGISTERED', from: 'page', via: 'swa', at: Date.now(),
            credential: summarizeCredential(r),
            userHandle: (opts && opts.user && opts.user.id) ? toB64Url(opts.user.id) : null,
            rpId: (opts && (opts.rpId || (opts.rp && opts.rp.id))) || null,
            origin: location && location.origin || null,
          };
          post(detail);
        } catch (__) {}
        try { console.info('[tsu][hook] posted TSU_PASSKEY_REGISTERED via swa'); } catch (__) {}
        return r;
      };
    }
  } catch (__) {}
})();
