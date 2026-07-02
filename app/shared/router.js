// router.js — minimal dependency-free hash router for a single-page app shell.
// Hash routing keeps everything client-side (no server rewrites needed) and keeps
// private app state out of the URL path that search engines might index.
export function createRouter(routes, opts = {}) {
  const notFound = opts.notFound || (() => {});
  const onBefore = opts.onBefore || (async () => true);
  let current = null;

  function parse() {
    const h = (location.hash || '#/').replace(/^#/, '');
    const [path, query] = h.split('?');
    return { path: path || '/', query: new URLSearchParams(query || '') };
  }

  async function resolve() {
    const { path, query } = parse();
    const ok = await onBefore(path);
    if (!ok) return;
    const match = routes[path] || routes[path.replace(/\/$/, '')] || null;
    current = path;
    if (match) { try { await match({ path, query }); } catch (e) { (opts.onError || notFound)(e); } }
    else notFound({ path });
  }

  function start() {
    window.addEventListener('hashchange', resolve);
    // Intercept in-app hash links so tab navigation REPLACES history instead of pushing,
    // otherwise every tab click stacks a #/path entry and Back cycles through them.
    document.addEventListener('click', (e) => {
      const a = e.target && e.target.closest && e.target.closest('a[href^="#/"]');
      if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || (a.target && a.target === '_blank')) return;
      const path = a.getAttribute('href').replace(/^#/, '');
      e.preventDefault();
      if (('#' + path) !== location.hash) { history.replaceState(null, '', '#' + path); resolve(); }
    });
    resolve();
  }
  function go(path) {
    if (('#' + path) === location.hash) resolve(); else { history.replaceState(null, '', '#' + path); resolve(); }
  }
  return { start, go, current: () => current };
}

export default createRouter;
