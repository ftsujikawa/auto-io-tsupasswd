;(function () {
  try {
    if (window.__tsu_webauthn_page_hooked || !navigator || !navigator.credentials) return;
    window.__tsu_webauthn_page_hooked = true;
    window.__tsu_pk_cache = window.__tsu_pk_cache || {};

    const b64u = (buf) => {
      try {
        return btoa(String.fromCharCode.apply(null, new Uint8Array(buf)))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/g, '');
      } catch (_) {
        return '';
      }
    };

    const origCreate = navigator.credentials.create.bind(navigator.credentials);
    const origGet = navigator.credentials.get.bind(navigator.credentials);
    const post = (cache) => {
      try { window.postMessage({ __tsu: true, type: 'tsu:passkeyCaptured', cache }, '*'); } catch (_) {}
    };

    const toU8 = (buf) => { try { return buf instanceof Uint8Array ? buf : new Uint8Array(buf); } catch (_) { return new Uint8Array(0); } };
    const cborDecodeItem = (u8, offset) => {
      const len = u8.length;
      if (offset >= len) throw new Error('OOB');
      const ib = u8[offset];
      const major = ib >> 5;
      let ai = ib & 0x1f;
      let pos = offset + 1;
      const readLen = (n) => { if (pos + n > len) throw new Error('OOB'); let v = 0; for (let i=0;i<n;i++) v = (v<<8) | u8[pos+i]; pos += n; return v; };
      const readAddl = () => { if (ai < 24) return ai; if (ai === 24) return readLen(1); if (ai === 25) return readLen(2); if (ai === 26) return readLen(4); if (ai === 27) { const hi = readLen(4), lo = readLen(4); return hi * 0x100000000 + lo; } throw new Error('indef'); };
      if (major === 0) { const v = readAddl(); return { value: v, length: pos - offset }; }
      else if (major === 1) { const v = readAddl(); return { value: -1 - v, length: pos - offset }; }
      else if (major === 2) { const l = readAddl(); if (pos + l > len) throw new Error('OOB'); const val = u8.slice(pos, pos + l); pos += l; return { value: val, length: pos - offset }; }
      else if (major === 3) { const l = readAddl(); if (pos + l > len) throw new Error('OOB'); const val = new TextDecoder('utf-8').decode(u8.slice(pos, pos + l)); pos += l; return { value: val, length: pos - offset }; }
      else if (major === 4) { const l = readAddl(); const arr = []; for (let i=0;i<l;i++) { const it = cborDecodeItem(u8, pos); arr.push(it.value); pos += it.length; } return { value: arr, length: pos - offset }; }
      else if (major === 5) { const l = readAddl(); const obj = {}; for (let i=0;i<l;i++) { const k = cborDecodeItem(u8, pos); pos += k.length; const v = cborDecodeItem(u8, pos); pos += v.length; obj[k.value] = v.value; } return { value: obj, length: pos - offset }; }
      else if (major === 6) { readAddl(); const inner = cborDecodeItem(u8, pos); pos += inner.length; return { value: inner.value, length: pos - offset }; }
      else if (major === 7) { return { value: null, length: pos - offset }; }
      throw new Error('bad');
    };
    const parseAttestation = (u8) => {
      try {
        const top = cborDecodeItem(u8, 0).value;
        const authData = top && top.authData ? toU8(top.authData) : null;
        if (!authData || authData.length < 37) return null;
        let p = 0;
        p += 32;
        const flags = authData[p]; p += 1;
        const signCount = ((authData[p] << 24) | (authData[p+1] << 16) | (authData[p+2] << 8) | authData[p+3]) >>> 0; p += 4;
        const AT = (flags & 0x40) !== 0;
        if (!AT) return { signCount };
        p += 16;
        const credIdLen = (authData[p] << 8) | authData[p+1]; p += 2;
        p += credIdLen;
        const pkItem = cborDecodeItem(authData, p);
        const raw = authData.slice(p, p + pkItem.length);
        return { signCount, publicKeyRaw: raw };
      } catch (_) { return null; }
    };

    navigator.credentials.create = async function (options) {
      try {
        const pub = options && options.publicKey;
        if (pub) {
          try {
            if (pub.rp && pub.rp.id) window.__tsu_pk_cache.rpId = String(pub.rp.id);
            if (pub.rp && pub.rp.name) window.__tsu_pk_cache.title = String(pub.rp.name);
            if (pub.user && pub.user.id) {
              const u = pub.user.id;
              const buf = (u instanceof ArrayBuffer) ? u : (ArrayBuffer.isView(u) ? u.buffer : null);
              if (buf) window.__tsu_pk_cache.userHandleB64 = b64u(buf);
            }
            try {
              const ex = Array.isArray(pub.excludeCredentials) ? pub.excludeCredentials : [];
              const trSet = new Set();
              for (const e of ex) {
                try {
                  const trs = (e && e.transports) || [];
                  if (Array.isArray(trs)) trs.forEach((t) => trSet.add(String(t)));
                } catch (_) {}
              }
              if (trSet.size) window.__tsu_pk_cache.transports = Array.from(trSet).join(',');
            } catch (_) {}
          } catch (_) {}
        }
      } catch (_) {}

      const cred = await origCreate(options);
      try {
        if (cred && cred.type === 'public-key') {
          try { window.__tsu_pk_cache.credentialIdB64 = b64u(cred.rawId); } catch (_) {}
          const resp = cred && cred.response;
          try {
            if (resp && resp.attestationObject) {
              window.__tsu_pk_cache.attestationB64 = b64u(resp.attestationObject);
              const parsed = parseAttestation(toU8(resp.attestationObject));
              if (parsed) {
                if (typeof parsed.signCount === 'number') window.__tsu_pk_cache.signCount = parsed.signCount;
                if (parsed.publicKeyRaw) window.__tsu_pk_cache.publicKeyB64 = b64u(parsed.publicKeyRaw);
              }
            }
          } catch (_) {}
          try { post({ ...window.__tsu_pk_cache }); } catch (_) {}
        }
      } catch (_) {}
      return cred;
    };

    navigator.credentials.get = async function (options) {
      try {
        const pub = options && options.publicKey;
        if (pub) {
          try {
            if (pub.rpId) window.__tsu_pk_cache.rpId = String(pub.rpId);
            if (!window.__tsu_pk_cache.title && document && document.title) window.__tsu_pk_cache.title = String(document.title);
            try {
              const allow = Array.isArray(pub.allowCredentials) ? pub.allowCredentials : [];
              const trSet = new Set((window.__tsu_pk_cache.transports ? String(window.__tsu_pk_cache.transports).split(',') : []).filter(Boolean));
              for (const a of allow) {
                try {
                  const trs = (a && a.transports) || [];
                  if (Array.isArray(trs)) trs.forEach((t) => trSet.add(String(t)));
                } catch (_) {}
              }
              if (trSet.size) window.__tsu_pk_cache.transports = Array.from(trSet).join(',');
            } catch (_) {}
          } catch (_) {}
        }
      } catch (_) {}

      const cred = await origGet(options);
      try {
        if (cred && cred.type === 'public-key') {
          try { window.__tsu_pk_cache.credentialIdB64 = b64u(cred.rawId); } catch (_) {}
          const resp = cred && cred.response;
          try { if (resp && resp.userHandle) window.__tsu_pk_cache.userHandleB64 = b64u(resp.userHandle); } catch (_) {}
          try { post({ ...window.__tsu_pk_cache }); } catch (_) {}
        }
      } catch (_) {}
      return cred;
    };
  } catch (_) {}
})();
