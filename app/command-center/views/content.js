// content.js — Wave 7 Content / Marketing. Manage blog posts (draft/published/archived)
// and editable site pages. Reads/writes via cc_content_* / cc_*_post / cc_*_page RPCs
// (content.view/edit/publish), all RBAC-gated + audited. Publishing emits a marketing
// notification via the Automation Core.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showEmpty, showError } from '../../shared/loading.js';
import { sectionHead, statCard, statusPill, segmented, toolbar, searchBox, openDrawer, fmtDateTime, card } from '../../shared/ui/components.js';
import { contentOverview, listPosts, getPost, upsertPost, setPostStatus, listPages, upsertPage } from '../../shared/api.js';
import { can } from '../../shared/permissions.js';
import { humanizeError, toast } from '../../shared/errors.js';

const TONE = { draft: 'gray', published: 'green', archived: 'amber' };
const TABS = [{ value: 'posts', label: 'Posts' }, { value: 'pages', label: 'Site pages' }];

export function renderContent(host) {
  let tab = 'posts';
  const kpiHost = el('div');
  const bodyHost = el('div', { class: 'cc-table-wrap' });

  async function loadKpis() {
    let o; try { o = await contentOverview(); } catch (e) { mount(kpiHost, ''); return; }
    const n = (k) => Number((o && o[k]) || 0);
    mount(kpiHost, el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'check', label: 'Published', value: String(n('published')), sub: 'live posts', accent: 'green' }),
      statCard({ icon: 'doc', label: 'Drafts', value: String(n('draft')), sub: 'in progress', accent: 'amber' }),
      statCard({ icon: 'list', label: 'Archived', value: String(n('archived')), sub: 'retired', accent: 'gray' }),
      statCard({ icon: 'grid', label: 'Site pages', value: String(n('pages')), sub: 'editable snippets', accent: 'violet' }),
    ]));
  }

  function header() {
    const actions = (tab === 'posts' && can('content.edit')) ? [el('button', { class: 'lb-btn lb-btn-primary', onClick: () => openEditor(null) }, '+ New post')] : null;
    return el('div', null, [
      sectionHead('Content & Marketing', 'Blog posts and editable site content. Publishing notifies the marketing team.', actions),
      kpiHost,
      toolbar([ segmented(TABS, tab, (v) => { tab = v; route(); }) ]),
    ]);
  }

  function route() { mount(host, el('div', { class: 'cc-view' }, [header(), bodyHost])); if (tab === 'pages') loadPages(); else loadPosts(); }

  async function loadPosts() {
    showLoading(bodyHost, 'Loading posts…');
    let rows; try { rows = await listPosts({ limit: 300 }); } catch (e) { showError(bodyHost, humanizeError(e), loadPosts); return; }
    if (!rows || !rows.length) { showEmpty(bodyHost, 'No posts yet. Write your first one.'); return; }
    mount(bodyHost, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, [el('th', null, 'Title'), el('th', null, 'Slug'), el('th', null, 'Tags'), el('th', null, 'Status'), el('th', null, 'Updated'), el('th', null, '')])),
      el('tbody', null, rows.map(p => el('tr', { class: 'cc-row', onClick: () => openEditor(p.id) }, [
        el('td', null, el('b', null, p.title)),
        el('td', null, el('span', { class: 'cc-sub' }, '/' + p.slug)),
        el('td', null, (p.tags || []).join(', ') || '—'),
        el('td', null, el('span', { class: 'cc-pill cc-pill-' + (TONE[p.status] || 'gray') }, p.status)),
        el('td', null, fmtDateTime(p.updated_at)),
        el('td', null, el('span', { class: 'cc-row-go' }, '›')),
      ]))),
    ]));
  }

  async function loadPages() {
    showLoading(bodyHost, 'Loading pages…');
    let rows; try { rows = await listPages(); } catch (e) { showError(bodyHost, humanizeError(e), loadPages); return; }
    if (!rows || !rows.length) { showEmpty(bodyHost, 'No pages.'); return; }
    mount(bodyHost, el('div', { class: 'cc-doclist' }, rows.map(pg => el('div', { class: 'cc-doc-item cc-row', onClick: () => openPage(pg) }, [
      el('div', null, [el('b', null, pg.title), el('div', { class: 'cc-sub' }, (pg.body || '').slice(0, 90))]),
      el('div', { class: 'cc-status-row' }, [el('span', { class: 'cc-sub' }, '/' + pg.key), el('span', { class: 'cc-row-go' }, '›')]),
    ]))));
  }

  async function openEditor(id) {
    const drawer = openDrawer(id ? 'Edit post' : 'New post', el('div', { class: 'lb-state lb-loading' }, 'Loading…'), { subtitle: 'Blog post' });
    let p = { title: '', slug: '', excerpt: '', body: '', tags: [], status: 'draft' };
    if (id) { try { p = await getPost(id); } catch (e) { mount(drawer.body, el('div', { class: 'lb-state lb-error' }, humanizeError(e))); return; } }
    const f = { title: p.title || '', slug: p.slug || '', excerpt: p.excerpt || '', body: p.body || '', tags: (p.tags || []).join(', ') };
    const inp = (k, ph) => { const i = el('input', { class: 'cc-input', placeholder: ph, value: f[k] }); i.addEventListener('input', () => f[k] = i.value); return i; };
    const ta = (k, ph, rows) => { const t = el('textarea', { class: 'cc-input', rows: rows || '5', placeholder: ph }, f[k]); t.addEventListener('input', () => f[k] = t.value); return t; };
    const err = el('div', { class: 'err' });
    const ro = !can('content.edit');
    const save = el('button', { class: 'lb-btn lb-btn-primary', onClick: async (ev) => {
      err.textContent = ''; if (!f.title || !f.slug) { err.textContent = 'Title and slug are required.'; return; }
      const b = ev.currentTarget; b.disabled = true; b.textContent = 'Saving…';
      try { const tags = f.tags ? f.tags.split(',').map(s => s.trim()).filter(Boolean) : [];
        await upsertPost({ id: id || null, title: f.title, slug: f.slug, excerpt: f.excerpt || null, body: f.body || null, tags });
        toast('Saved', 'success'); drawer.close(); loadPosts(); loadKpis();
      } catch (e) { err.textContent = humanizeError(e); b.disabled = false; b.textContent = 'Save'; }
    } }, 'Save');
    const statusRow = el('div', { class: 'cc-status-row', style: 'margin-top:6px' });
    if (id && can('content.publish') && p.status !== 'published') statusRow.appendChild(chip('Publish', () => changeStatus(id, 'published')));
    if (id && can('content.edit') && p.status === 'published') statusRow.appendChild(chip('Unpublish (draft)', () => changeStatus(id, 'draft')));
    if (id && can('content.edit') && p.status !== 'archived') statusRow.appendChild(chip('Archive', () => changeStatus(id, 'archived')));
    mount(drawer.body, el('div', { class: 'cc-form' }, [
      id ? el('div', { class: 'cc-status-row' }, [el('span', { class: 'cc-pill cc-pill-' + (TONE[p.status] || 'gray') }, p.status)]) : '',
      inp('title', 'Post title'), inp('slug', 'url-slug'), inp('excerpt', 'Short excerpt'),
      ta('body', 'Post body (markdown ok)'), inp('tags', 'tags, comma, separated'),
      err, ro ? el('div', { class: 'cc-sub' }, 'Read-only.') : save, statusRow,
    ]));
    async function changeStatus(pid, st) { try { await setPostStatus(pid, st); toast('Post ' + st, 'success'); drawer.close(); loadPosts(); loadKpis(); } catch (e) { toast(humanizeError(e), 'error'); } }
  }

  function openPage(pg) {
    const f = { title: pg.title || '', body: pg.body || '' };
    const inp = el('input', { class: 'cc-input', value: f.title }); inp.addEventListener('input', () => f.title = inp.value);
    const ta = el('textarea', { class: 'cc-input', rows: '6' }, f.body); ta.addEventListener('input', () => f.body = ta.value);
    const err = el('div', { class: 'err' });
    const save = can('content.edit') ? el('button', { class: 'lb-btn lb-btn-primary', onClick: async (ev) => {
      const b = ev.currentTarget; b.disabled = true; b.textContent = 'Saving…';
      try { await upsertPage(pg.key, f.title, f.body); toast('Page saved', 'success'); drawer.close(); loadPages(); }
      catch (e) { err.textContent = humanizeError(e); b.disabled = false; b.textContent = 'Save'; }
    } }, 'Save') : el('div', { class: 'cc-sub' }, 'Read-only.');
    const drawer = openDrawer('Edit page', el('div', { class: 'cc-form' }, [
      el('div', { class: 'cc-sub' }, '/' + pg.key), inp, ta, err, save,
    ]), { subtitle: 'Site content snippet' });
  }

  function chip(label, onClick) { return el('button', { class: 'cc-chip-btn', onClick: async (ev) => { ev.currentTarget.disabled = true; await onClick(); } }, label); }

  route(); loadKpis();
}

export default renderContent;
