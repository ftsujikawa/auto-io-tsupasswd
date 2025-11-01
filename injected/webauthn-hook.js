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
          try { if (resp && resp.userHandle) window.__tsu_pk_cache.userHandleB64 = b64u(resp.userHandle); } catch (_) {}
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
(function(){try{if(window.__tsu_webauthn_page_hooked||!navigator||!navigator.credentials)return;window.__tsu_webauthn_page_hooked=true;window.__tsu_pk_cache=window.__tsu_pk_cache||{};const b64u=(buf)=>{try{return btoa(String.fromCharCode.apply(null,new Uint8Array(buf))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}catch(_){return''}};const origCreate=navigator.credentials.create.bind(navigator.credentials);const origGet=navigator.credentials.get.bind(navigator.credentials);const post=(cache)=>{try{window.postMessage({__tsu:true,type:'tsu:passkeyCaptured',cache},'*');}catch(_){}};navigator.credentials.create=async function(options){try{const pub=options&&options.publicKey;if(pub){try{if(pub.rp&&pub.rp.id)window.__tsu_pk_cache.rpId=String(pub.rp.id);if(pub.rp&&pub.rp.name)window.__tsu_pk_cache.title=String(pub.rp.name);if(pub.user&&pub.user.id){const u=pub.user.id;const buf=(u instanceof ArrayBuffer)?u:(ArrayBuffer.isView(u)?u.buffer:null);if(buf)window.__tsu_pk_cache.userHandleB64=b64u(buf);}try{const ex=Array.isArray(pub.excludeCredentials)?pub.excludeCredentials:[];const trSet=new Set();for(const e of ex){try{const trs=(e&&e.transports)||[];if(Array.isArray(trs))trs.forEach(t=>trSet.add(String(t)));}catch(_){}}if(trSet.size)window.__tsu_pk_cache.transports=Array.from(trSet).join(',');}catch(_){}}}catch(_){ }const cred=await origCreate(options);try{if(cred&&cred.type==='public-key'){try{window.__tsu_pk_cache.credentialIdB64=b64u(cred.rawId);}catch(_){ }const resp=cred&&cred.response;try{if(resp&&resp.userHandle)window.__tsu_pk_cache.userHandleB64=b64u(resp.userHandle);}catch(_){ }try{post({...window.__tsu_pk_cache});}catch(_){ }}}catch(_){ }return cred;};navigator.credentials.get=async function(options){try{const pub=options&&options.publicKey;if(pub){try{if(pub.rpId)window.__tsu_pk_cache.rpId=String(pub.rpId);if(!window.__tsu_pk_cache.title&&document&&document.title)window.__tsu_pk_cache.title=String(document.title);try{const allow=Array.isArray(pub.allowCredentials)?pub.allowCredentials:[];const trSet=new Set((window.__tsu_pk_cache.transports?String(window.__tsu_pk_cache.transports).split(','):[]).filter(Boolean));for(const a of allow){try{const trs=(a&&a.transports)||[];if(Array.isArray(trs))trs.forEach(t=>trSet.add(String(t)));}catch(_){}}if(trSet.size)window.__tsu_pk_cache.transports=Array.from(trSet).join(',');}catch(_){}}}catch(_){ }const cred=await origGet(options);try{if(cred&&cred.type==='public-key'){try{window.__tsu_pk_cache.credentialIdB64=b64u(cred.rawId);}catch(_){ }const resp=cred&&cred.response;try{if(resp&&resp.userHandle)window.__tsu_pk_cache.userHandleB64=b64u(resp.userHandle);}catch(_){ }try{post({...window.__tsu_pk_cache});}catch(_){ }}}catch(_){ }return cred;};}catch(_){ }})();
