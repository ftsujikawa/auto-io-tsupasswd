(function(){
  try {
    if (window.__tsu_close_api_injected) return; window.__tsu_close_api_injected = true;
    window.tsupasswd = window.tsupasswd || {};
    window.tsupasswd.closePopup = function(){
      try { window.postMessage({ type:'TSU_REQ_CLOSE_POPUP', from:'tsu-page', force:true }, '*'); } catch(_) {}
    };
  } catch(_) {}
})();
