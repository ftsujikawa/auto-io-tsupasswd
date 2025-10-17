(() => {
  const init = () => {
    const title = document.title || "";
    window.__EXT_BASE__ = { title };
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
