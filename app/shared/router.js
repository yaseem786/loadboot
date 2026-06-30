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
    resolve();
  }
  function go(path) {
    if (('#' + path) === location.hash) resolve(); else location.hash = path;
  }
  return { start, go, current: () => current };
}

export default createRouter;
