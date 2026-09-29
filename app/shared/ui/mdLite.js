// bl_ship_0499 — tiny, safe Markdown → DOM for agreement texts (headings, **bold**, "- " and "1. " lists, paragraphs).
// Every piece of text is a text node (never innerHTML), so an agreement body can never inject markup.
export function mdToNodes(md) {
  const frag = document.createDocumentFragment();
  const inline = (parent, text) => {
    String(text).split(/(\*\*[^*]+\*\*)/g).forEach((part) => {
      if (!part) return;
      if (/^\*\*[^*]+\*\*$/.test(part)) { const b = document.createElement('b'); b.textContent = part.slice(2, -2); parent.appendChild(b); }
      else parent.appendChild(document.createTextNode(part));
    });
  };
  let list = null, para = null;
  const close = () => { list = null; para = null; };
  String(md || '').split(/\r?\n/).forEach((raw) => {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { close(); return; }
    const hm = line.match(/^(#{1,4})\s+(.*)$/);
    if (hm) {
      close();
      const el = document.createElement(['h2', 'h3', 'h4', 'h5'][hm[1].length - 1]);
      el.style.cssText = 'margin:' + (hm[1].length === 1 ? '4px 0 10px' : '14px 0 6px') + ';font-size:' + (['1.1rem', '.98rem', '.9rem', '.86rem'][hm[1].length - 1]) + ';white-space:normal';
      inline(el, hm[2]); frag.appendChild(el); return;
    }
    const lm = line.match(/^(\s*)(?:[-*]|(\d+)\.)\s+(.*)$/);
    if (lm) {
      const ordered = !!lm[2], depth = lm[1].length >= 2;
      const want = ordered ? 'OL' : 'UL';
      if (!list || list.tagName !== want || list.__depth !== depth) {
        list = document.createElement(want); list.__depth = depth;
        list.style.cssText = 'margin:4px 0 8px;padding-left:' + (depth ? '38px' : '20px') + ';white-space:normal';
        frag.appendChild(list);
      }
      const li = document.createElement('li'); inline(li, lm[3]); list.appendChild(li); para = null; return;
    }
    list = null;
    if (!para) { para = document.createElement('p'); para.style.cssText = 'margin:0 0 8px;white-space:normal'; frag.appendChild(para); }
    else para.appendChild(document.createElement('br'));
    inline(para, line.trim());
  });
  return frag;
}
