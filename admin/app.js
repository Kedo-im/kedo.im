import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';
import {
  getFirestore, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, collection, query, orderBy, limit,
  onSnapshot, serverTimestamp, Timestamp, writeBatch,
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';
import { getStorage, ref as sref, uploadBytesResumable, getDownloadURL } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-storage.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-functions.js';
import { firebaseConfig, FUNCTIONS_REGION, SEED_PROJECTS, SEED_TEMPLATES, STUDIOS } from './config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const fns = getFunctions(app, FUNCTIONS_REGION);
const call = (name, data) => httpsCallable(fns, name, { timeout: 560000 })(data).then((r) => r.data);

// ---------------------------------------------------------------- platforms

const xLength = (t) => [...t.replace(/https?:\/\/\S+/g, 'x'.repeat(23))].length;
const PLATFORMS = {
  facebook: { label: 'Facebook', app: 'meta', limit: 63206, maxImages: 10 },
  instagram: { label: 'Instagram', app: 'meta', limit: 2200, maxImages: 10, needs: 'media' },
  threads: { label: 'Threads', app: 'threads', limit: 500, maxImages: 20 },
  linkedin: { label: 'LinkedIn', app: 'linkedin', limit: 3000, maxImages: 20 },
  x: { label: 'X', app: 'x', limit: 280, maxImages: 4, count: xLength },
  tiktok: { label: 'TikTok', app: 'tiktok', limit: 2200, needs: 'video' },
  youtube: { label: 'YouTube', app: 'google', limit: 5000, needs: 'video', title: true },
};
const PKEYS = Object.keys(PLATFORMS);

const APPS = {
  meta: {
    label: 'Meta: Facebook + Instagram',
    console: 'https://developers.facebook.com/apps',
    notes: [
      'Create a Business-type app and add the "Facebook Login for Business" and "Instagram" (Instagram API with Facebook Login) products.',
      'Permissions: pages_show_list, pages_read_engagement, pages_manage_posts, business_management, instagram_basic, instagram_content_publish.',
      'Add the redirect URI below under Facebook Login → Settings → Valid OAuth Redirect URIs.',
      'While the app is in Development mode only you (app admins/testers) can connect. Publishing for real needs App Review.',
    ],
  },
  threads: {
    label: 'Threads',
    console: 'https://developers.facebook.com/apps',
    notes: [
      'Create an app with the "Access the Threads API" use case. Use the Threads App ID and Threads App Secret.',
      'Permissions: threads_basic, threads_content_publish. Add the redirect URI below as a Redirect Callback URL.',
      'Add your Threads account as a tester (App roles → Threads Testers) and accept the invite in Threads settings.',
    ],
  },
  linkedin: {
    label: 'LinkedIn',
    console: 'https://www.linkedin.com/developers/apps',
    notes: [
      'Add the products "Sign In with LinkedIn using OpenID Connect" and "Share on LinkedIn" (posts to a personal profile).',
      'To post as a company page, request "Community Management API", then tick "Company pages" here.',
      'Add the redirect URI below under Auth → Authorized redirect URLs. Tokens last 60 days; you will be reminded to reconnect.',
    ],
    orgs: true,
  },
  x: {
    label: 'X (Twitter)',
    console: 'https://developer.x.com/en/portal/dashboard',
    notes: [
      'Needs an X API plan that allows posting. In the app, set up User authentication: OAuth 2.0, type "Web App", permissions "Read and write".',
      'Add the redirect URI below as the Callback URI. Use the OAuth 2.0 Client ID and Client Secret.',
    ],
  },
  tiktok: {
    label: 'TikTok',
    console: 'https://developers.tiktok.com/apps',
    notes: [
      'Add the "Login Kit" and "Content Posting API" products (enable Direct Post). Scopes: user.info.basic, video.publish.',
      'Add the redirect URI below. Use the Client key and Client secret.',
      'Until TikTok audits the app, videos post as private ("only me").',
    ],
  },
  google: {
    label: 'Google: YouTube',
    console: 'https://console.cloud.google.com/apis/credentials',
    notes: [
      'In a Google Cloud project, enable "YouTube Data API v3" and set up the OAuth consent screen (add yourself as a test user).',
      'Create an OAuth client ID of type "Web application" and add the redirect URI below.',
      'Until Google audits the project, uploads are locked to private.',
    ],
  },
};

function problems(key, text, media, title) {
  const p = PLATFORMS[key];
  const out = [];
  const n = (p.count || ((t) => [...t].length))(text);
  if (n > p.limit) out.push(`${n - p.limit} characters over the ${p.limit} limit`);
  const imgs = media.filter((m) => m.type === 'image').length;
  const vids = media.filter((m) => m.type === 'video').length;
  if (p.needs === 'media' && !media.length) out.push('needs an image or video');
  if (p.needs === 'video' && !vids) out.push('needs a video');
  if (vids > 1 && key !== 'instagram' && key !== 'threads') out.push('only one video is supported');
  if (vids && imgs && !['instagram', 'threads'].includes(key)) out.push('can’t mix a video with images (the video is used)');
  if (p.maxImages && imgs > p.maxImages) out.push(`at most ${p.maxImages} images (extra ones are skipped)`);
  if (p.title && !title && !text.trim()) out.push('needs a title');
  if (!text.trim() && !media.length) out.push('post is empty');
  return out;
}

// ---------------------------------------------------------------- helpers

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const view = $('#app');
let cleanup = [];
let timer;
function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast show${bad ? ' bad' : ''}`;
  clearTimeout(timer);
  timer = setTimeout(() => (t.className = 'toast'), bad ? 7000 : 3500);
}
const errMsg = (e) => (e?.message || String(e)).replace(/^Firebase: /, '');
const toDate = (v) => (v?.toDate ? v.toDate() : typeof v === 'number' ? new Date(v) : v ? new Date(v) : null);
const fmt = (v) => {
  const d = toDate(v);
  return d ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '-';
};
const localInput = (d) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 16);
};
function crumbs(items) {
  $('#crumbs').innerHTML = items.map(([t, h]) => (h ? `<a href="${h}">${esc(t)}</a>` : `<span>${esc(t)}</span>`)).join('<span>/</span>');
}
const projects = {};
async function project(pid) {
  if (!projects[pid]) {
    const s = await getDoc(doc(db, 'projects', pid));
    if (!s.exists()) throw new Error('Project not found');
    projects[pid] = { id: pid, ...s.data() };
  }
  return projects[pid];
}

/** Render a template caption: fill {{fields}}, drop lines left empty, tidy blank lines. */
function renderTemplate(pattern, values) {
  return String(pattern || '')
    .split('\n')
    .map((line) => {
      const hadVars = /\{\{\s*\w+\s*\}\}/.test(line);
      const out = line.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => values[k] ?? '').replace(/[ \t]+$/g, '').replace(/^[ \t]+/, '');
      return hadVars && !out.trim() ? null : out;
    })
    .filter((l) => l !== null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------- router

const routes = [
  [/^\/?$/, viewProjects],
  [/^\/settings$/, viewSettings],
  [/^\/p\/([\w-]+)$/, viewProject],
  [/^\/p\/([\w-]+)\/templates$/, viewTemplates],
  [/^\/p\/([\w-]+)\/studio$/, viewStudio],
  [/^\/p\/([\w-]+)\/templates\/([\w-]+)\/edit$/, viewTemplateEdit],
  [/^\/p\/([\w-]+)\/compose\/([\w-]+)$/, (pid, tid, q) => viewCompose(pid, { tid }, q)],
  [/^\/p\/([\w-]+)\/posts\/([\w-]+)\/edit$/, (pid, postId, q) => viewCompose(pid, { postId }, q)],
  [/^\/p\/([\w-]+)\/posts$/, viewPosts],
  [/^\/p\/([\w-]+)\/accounts$/, viewAccounts],
  [/^\/p\/([\w-]+)\/log$/, viewLog],
];
let isAdmin = false;
async function route() {
  cleanup.forEach((f) => f());
  cleanup = [];
  document.body.classList.remove('wide');
  if (!auth.currentUser || !isAdmin) return viewLogin();
  const [path, qs] = location.hash.replace(/^#/, '').split('?');
  const q = new URLSearchParams(qs || '');
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (m) {
      try {
        await fn(...m.slice(1), q);
      } catch (e) {
        console.error(e);
        view.innerHTML = `<div class="banner bad">${esc(errMsg(e))}</div><a class="btn" href="#/">Back to projects</a>`;
      }
      window.scrollTo(0, 0);
      return;
    }
  }
  location.hash = '#/';
}
window.addEventListener('hashchange', route);

onAuthStateChanged(auth, async (user) => {
  isAdmin = false;
  if (user) {
    try {
      isAdmin = (await getDoc(doc(db, 'admins', user.uid))).exists();
    } catch {}
    if (!isAdmin) {
      await signOut(auth);
      toast('This account does not have admin access.', true);
      return;
    }
    $('#who').innerHTML = `<span>${esc(user.email)}</span><a class="btn sm ghost" href="#/settings">Settings</a><button class="btn sm ghost" id="out">Sign out</button>`;
    $('#out').onclick = () => signOut(auth);
    await seed();
  } else {
    $('#who').innerHTML = '';
  }
  route();
});

async function seed() {
  const existing = await getDocs(collection(db, 'projects'));
  const have = new Set(existing.docs.map((d) => d.id));
  const missing = SEED_PROJECTS.filter((p) => !have.has(p.id));
  if (!missing.length) return;
  const b = writeBatch(db);
  for (const { id, ...p } of missing) {
    b.set(doc(db, 'projects', id), { ...p, createdAt: serverTimestamp() });
    for (const { id: tid, ...t } of SEED_TEMPLATES[id] || []) {
      b.set(doc(db, 'projects', id, 'templates', tid), { ...t, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    }
  }
  await b.commit();
}

// ---------------------------------------------------------------- views

function viewLogin() {
  crumbs([]);
  view.innerHTML = `
  <form class="login card" id="f">
    <h1>Sign in</h1>
    <p class="lede">Kedo admin: manage the projects Kedo runs.</p>
    <label class="f"><span>Email</span><input type="email" name="email" autocomplete="username" required></label>
    <label class="f"><span>Password</span><input type="password" name="password" autocomplete="current-password" required></label>
    <p class="err" id="err"></p>
    <div class="spread"><button class="btn ghost sm" type="button" id="reset">Forgot password?</button><button class="btn primary">Sign in</button></div>
  </form>`;
  const f = $('#f');
  f.onsubmit = async (e) => {
    e.preventDefault();
    $('#err').textContent = '';
    try {
      await signInWithEmailAndPassword(auth, f.email.value.trim(), f.password.value);
    } catch (er) {
      $('#err').textContent = /invalid|wrong|not-found/.test(er.code || '') ? 'Wrong email or password.' : errMsg(er);
    }
  };
  $('#reset').onclick = async () => {
    if (!f.email.value) return ($('#err').textContent = 'Enter your email first.');
    try {
      await sendPasswordResetEmail(auth, f.email.value.trim());
      toast('Password reset email sent.');
    } catch (er) {
      $('#err').textContent = errMsg(er);
    }
  };
}

async function viewProjects() {
  crumbs([['Projects']]);
  const snap = await getDocs(query(collection(db, 'projects'), orderBy('order')));
  view.innerHTML = `
    <h1>Projects</h1>
    <p class="lede">The networks Kedo runs. Open one to manage its posts, accounts and log.</p>
    <div class="grid">${snap.docs
      .map((d) => {
        const p = d.data();
        projects[d.id] = { id: d.id, ...p };
        return `<a class="card" href="#/p/${d.id}"><div class="eyebrow">Project</div><h3><span class="swatch" style="background:${esc(p.color || '#C46A3B')}"></span>${esc(p.name)}</h3><p class="mono small">${esc(p.url || '')}</p></a>`;
      })
      .join('')}</div>`;
}

async function viewProject(pid) {
  const p = await project(pid);
  crumbs([['Projects', '#/'], [p.name]]);
  view.innerHTML = `
    <h1><span class="swatch" style="background:${esc(p.color)}"></span>${esc(p.name)}</h1>
    <p class="lede">${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url)}</a>` : ''}</p>
    <div class="grid">
      <a class="card" href="#/p/${pid}/templates"><div class="eyebrow">Create</div><h3>Social media post templates</h3><p>Write a post from a template and schedule it for every connected platform.</p></a>
      <a class="card" href="#/p/${pid}/posts"><div class="eyebrow">Queue</div><h3>Scheduled &amp; published posts</h3><p><span class="stat" id="nSched">·</span> scheduled</p></a>
      <a class="card" href="#/p/${pid}/accounts"><div class="eyebrow">Platforms</div><h3>Connected accounts</h3><p><span class="stat" id="nAcc">·</span> of ${PKEYS.length} connected</p></a>
      <a class="card" href="#/p/${pid}/log"><div class="eyebrow">Feedback</div><h3>Activity log</h3><p>What was posted, where, and anything that failed.</p></a>
    </div>`;
  cleanup.push(
    onSnapshot(collection(db, 'projects', pid, 'posts'), (s) => {
      const el = $('#nSched');
      if (el) el.textContent = s.docs.filter((d) => d.get('status') === 'scheduled').length;
    }),
    onSnapshot(collection(db, 'projects', pid, 'accounts'), (s) => {
      const el = $('#nAcc');
      if (el) el.textContent = s.docs.filter((d) => d.get('status') === 'connected').length;
    }),
  );
}

async function viewTemplates(pid) {
  const p = await project(pid);
  crumbs([['Projects', '#/'], [p.name, `#/p/${pid}`], ['Post templates']]);
  const snap = await getDocs(query(collection(db, 'projects', pid, 'templates'), orderBy('name')));
  const studio = STUDIOS[pid];
  view.innerHTML = `
    <div class="spread"><div><h1>Social media post templates</h1><p class="lede">Pick a template to create a post.</p></div>
      <div class="row"><a class="btn" href="#/p/${pid}/compose/blank">Blank post</a><a class="btn" href="#/p/${pid}/templates/new/edit">New text template</a></div></div>
    ${studio ? `<a class="card" href="#/p/${pid}/studio" style="margin-bottom:16px;border-color:rgba(196,106,59,.5)"><div class="eyebrow">Post studio</div><h3>${esc(studio.name)}</h3><p>${esc(studio.description)}</p><p style="margin-top:12px"><span class="btn primary sm">Open studio</span></p></a>` : ''}
    ${snap.empty && !studio ? '<div class="empty">No templates yet.</div>' : ''}
    ${!snap.empty && studio ? '<h2>Text templates</h2>' : ''}
    <div class="grid">${snap.docs
      .map((d) => {
        const t = d.data();
        return `<div class="card"><div class="eyebrow">Template</div><h3>${esc(t.name)}</h3><p>${esc(t.description || '')}</p>
          <p class="mono small" style="white-space:pre-wrap;margin-top:10px;color:var(--muted)">${esc((t.caption || '').slice(0, 160))}</p>
          <div class="row" style="margin-top:14px"><a class="btn primary sm" href="#/p/${pid}/compose/${d.id}">Use template</a><a class="btn ghost sm" href="#/p/${pid}/templates/${d.id}/edit">Edit</a></div></div>`;
      })
      .join('')}</div>`;
}

async function viewTemplateEdit(pid, tid) {
  const p = await project(pid);
  const isNew = tid === 'new';
  const t = isNew ? { name: '', fields: [], caption: '', platforms: [] } : (await getDoc(doc(db, 'projects', pid, 'templates', tid))).data();
  if (!t) throw new Error('Template not found');
  crumbs([['Projects', '#/'], [p.name, `#/p/${pid}`], ['Post templates', `#/p/${pid}/templates`], [isNew ? 'New' : t.name]]);
  const fieldsText = (t.fields || []).map((f) => `${f.key} | ${f.label} | ${f.type || 'text'}${f.placeholder ? ` | ${f.placeholder}` : ''}`).join('\n');
  view.innerHTML = `
    <h1>${isNew ? 'New template' : 'Edit template'}</h1>
    <form id="f" class="section">
      <label class="f"><span>Name</span><input type="text" name="name" value="${esc(t.name)}" required></label>
      <label class="f"><span>Description</span><input type="text" name="description" value="${esc(t.description || '')}"></label>
      <label class="f"><span>Fields, one per line: key | Label | type (text, textarea, url) | placeholder</span>
        <textarea name="fields" class="mono" placeholder="headline | Headline | text">${esc(fieldsText)}</textarea></label>
      <label class="f"><span>Caption. Use {{key}} for fields. Lines whose fields are empty are dropped.</span>
        <textarea name="caption" class="caption">${esc(t.caption || '')}</textarea></label>
      <label class="f"><span>Video title (YouTube), optional. Can use {{key}}.</span><input type="text" name="title" value="${esc(t.title || '')}"></label>
      <div class="f"><span class="mono small muted">Platforms selected by default</span>
        <div class="row" style="margin-top:6px">${PKEYS.map((k) => `<label class="check"><input type="checkbox" name="pf" value="${k}" ${(t.platforms || []).includes(k) ? 'checked' : ''}>${PLATFORMS[k].label}</label>`).join('')}</div></div>
      <div class="actions">${isNew ? '' : '<button type="button" class="btn danger ghost" id="del">Delete</button>'}<a class="btn ghost" href="#/p/${pid}/templates">Cancel</a><button class="btn primary">Save template</button></div>
    </form>`;
  const f = $('#f');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const fields = f.fields.value
      .split('\n')
      .map((l) => l.split('|').map((s) => s.trim()))
      .filter((a) => a[0])
      .map(([key, label, type, placeholder]) => ({ key: key.replace(/\W/g, ''), label: label || key, type: ['text', 'textarea', 'url'].includes(type) ? type : 'text', ...(placeholder ? { placeholder } : {}) }));
    const data = {
      name: f.name.value.trim(), description: f.description.value.trim(), fields, caption: f.caption.value, title: f.title.value.trim(),
      platforms: $$('input[name=pf]:checked', f).map((i) => i.value), updatedAt: serverTimestamp(),
    };
    if (isNew) await addDoc(collection(db, 'projects', pid, 'templates'), { ...data, createdAt: serverTimestamp() });
    else await updateDoc(doc(db, 'projects', pid, 'templates', tid), data);
    toast('Template saved.');
    location.hash = `#/p/${pid}/templates`;
  };
  if (!isNew) {
    $('#del').onclick = async () => {
      await deleteDoc(doc(db, 'projects', pid, 'templates', tid));
      toast('Template deleted.');
      location.hash = `#/p/${pid}/templates`;
    };
  }
}

// ---------------------------------------------------------------- studio

let fromStudio = null; // payload handed from a studio iframe to the composer

async function viewStudio(pid) {
  const p = await project(pid);
  const studio = STUDIOS[pid];
  if (!studio) throw new Error('This project has no post studio yet.');
  crumbs([['Projects', '#/'], [p.name, `#/p/${pid}`], ['Post templates', `#/p/${pid}/templates`], [studio.name]]);
  document.body.classList.add('wide');
  view.innerHTML = `
    <div class="banner info small studio-tip">Design the post, then press <b>Schedule in Kedo</b> (image or all slides) or <b>Video → Kedo</b> in the Export bar. Captions, hashtag and first reply come with it.</div>
    <iframe class="studio" id="studio" src="${esc(studio.src)}" title="${esc(studio.name)}"></iframe>`;
  const frame = $('#studio');
  const onMsg = (e) => {
    if (e.origin !== location.origin || e.source !== frame.contentWindow) return;
    if (e.data?.type !== 'kedo:studio-post') return;
    fromStudio = e.data;
    location.hash = `#/p/${pid}/compose/studio`;
  };
  window.addEventListener('message', onMsg);
  cleanup.push(() => window.removeEventListener('message', onMsg));
}

// ---------------------------------------------------------------- composer

async function viewCompose(pid, { tid, postId }, q) {
  const p = await project(pid);
  const accSnap = await getDocs(collection(db, 'projects', pid, 'accounts'));
  const connected = new Set(accSnap.docs.filter((d) => d.get('status') === 'connected').map((d) => d.id));
  const accName = Object.fromEntries(accSnap.docs.map((d) => [d.id, d.get('name')]));

  let post = null;
  let tpl = { name: 'Blank post', fields: [], caption: '', platforms: [] };
  if (postId) {
    post = (await getDoc(doc(db, 'projects', pid, 'posts', postId))).data();
    if (!post) throw new Error('Post not found');
    tid = post.templateId || 'blank';
  }
  let sp = null;
  if (tid === 'studio') {
    sp = fromStudio;
    fromStudio = null;
    if (!sp) {
      location.hash = `#/p/${pid}/studio`;
      return;
    }
    tpl = { name: `Post Studio · ${sp.template}`, fields: [], caption: '', platforms: [] };
  } else if (tid && tid !== 'blank') {
    const t = (await getDoc(doc(db, 'projects', pid, 'templates', tid))).data();
    if (t) tpl = t;
  }
  const duplicate = !!(post && q.get('duplicate'));
  const locked = !duplicate && post && ['publishing', 'published'].includes(post.status);
  const S = {
    values: { ...(post?.fields || {}) },
    text: post?.text ?? renderTemplate(tpl.caption, {}),
    textEdited: !!post,
    title: post?.title ?? '',
    titleEdited: !!post?.title,
    overrides: { ...(post?.overrides || {}) },
    media: [...(post?.media || [])],
    platforms: new Set(post?.platforms || (tpl.platforms || []).filter((k) => connected.has(k))),
    when: post?.scheduledAt ? 'later' : 'now',
    at: post?.scheduledAt ? toDate(post.scheduledAt) : new Date(Date.now() + 3600000),
    uploading: 0,
    firstReply: post?.firstReply ?? '',
  };
  if (sp) {
    const c = sp.captions || {};
    const isVideo = sp.media?.some((m) => m.type.startsWith('video'));
    S.text = c.instagram || c.linkedin || c.x || '';
    S.textEdited = true;
    S.title = sp.template;
    S.titleEdited = true;
    S.overrides = {};
    if (c.x) S.overrides.x = c.x;
    if (c.x && [...c.x].length <= 500) S.overrides.threads = c.x;
    if (c.linkedin) S.overrides.linkedin = c.linkedin;
    S.firstReply = sp.reply || '';
    const wanted = ['facebook', 'instagram', 'threads', 'linkedin', 'x', ...(isVideo ? ['tiktok', 'youtube'] : [])];
    S.platforms = new Set(wanted.filter((k) => connected.has(k)));
  }
  if (duplicate) {
    post = null;
    postId = null;
    if (S.at < new Date()) S.at = new Date(Date.now() + 3600000);
  }

  crumbs([['Projects', '#/'], [p.name, `#/p/${pid}`], ['Post templates', `#/p/${pid}/templates`], [postId ? 'Edit post' : tpl.name]]);
  view.innerHTML = `
    <div class="spread"><div><h1>${postId ? 'Edit post' : 'New post'}</h1><p class="lede">${esc(tpl.name)}${post?.status ? ` · <span class="chip">${esc(post.status)}</span>` : ''}</p></div></div>
    ${sp ? `<div class="banner ${sp.check?.length ? 'info' : 'ok'}">From the Post Studio. Captions for X, Instagram and LinkedIn are filled in; Threads uses the X caption and Facebook uses the Instagram caption.${
      sp.check?.length ? `<br><b>Hard lines to review:</b><ul class="notes">${sp.check.map((c) => `<li>${esc(c.where)}: ${esc(c.msg)}</li>`).join('')}</ul>` : ' Hard lines clear.'
    }</div>` : ''}
    ${locked ? `<div class="banner info">This post is ${esc(post.status)} and can’t be edited. <a href="#/p/${pid}/posts/${postId}/edit?duplicate=1">Duplicate it</a> instead.</div>` : ''}
    <div class="compose">
      <div>
        ${tpl.fields?.length ? `<div class="section"><h3>Template fields</h3>${tpl.fields
          .map((f) => {
            const v = esc(S.values[f.key] || '');
            const ph = esc(f.placeholder || '');
            return `<label class="f"><span>${esc(f.label)}</span>${
              f.type === 'textarea'
                ? `<textarea data-field="${f.key}" placeholder="${ph}">${v}</textarea>`
                : `<input type="${f.type === 'url' ? 'url' : 'text'}" data-field="${f.key}" value="${v}" placeholder="${ph}">`
            }</label>`;
          })
          .join('')}</div>` : ''}
        <div class="section">
          <div class="spread"><h3>Caption</h3>${tpl.caption ? '<button class="btn ghost sm" id="regen" type="button">Rebuild from template</button>' : ''}</div>
          <textarea class="caption" id="text" placeholder="What do you want to say?">${esc(S.text)}</textarea>
          <label class="f" style="margin-top:12px"><span>First reply: posted as a reply/comment right after the post (put links here). YouTube adds it to the description; TikTok skips it.</span><textarea id="reply" style="min-height:60px">${esc(S.firstReply)}</textarea></label>
          <label class="f"><span>Title (YouTube; also used as the post name in the queue)</span><input type="text" id="title" value="${esc(S.title)}"></label>
        </div>
        <div class="section">
          <h3>Images &amp; video</h3>
          <div class="media" id="media"></div>
          <input type="file" id="file" accept="image/*,video/*" multiple class="hidden">
          <p class="muted small" style="margin:10px 0 0">Instagram needs media. TikTok and YouTube need a video. X takes up to 4 images or 1 video.</p>
        </div>
        <div class="section">
          <h3>Platforms</h3>
          <div class="row" id="pfs">${PKEYS.map((k) => {
            const on = connected.has(k);
            return `<label class="check ${on ? '' : 'off'}" title="${on ? esc(accName[k] || '') : 'Not connected'}"><input type="checkbox" value="${k}" ${S.platforms.has(k) ? 'checked' : ''} ${on ? '' : 'disabled'}>${PLATFORMS[k].label}</label>`;
          }).join('')}</div>
          ${connected.size < PKEYS.length ? `<p class="muted small" style="margin:10px 0 0">Greyed-out platforms aren’t connected. <a href="#/p/${pid}/accounts">Connect accounts</a></p>` : ''}
        </div>
        <div class="section">
          <h3>When</h3>
          <div class="row"><div class="seg" id="when"><button type="button" data-w="now">Post now</button><button type="button" data-w="later">Schedule</button></div>
          <input type="datetime-local" id="at" style="max-width:260px" value="${localInput(S.at)}">
          <span class="muted small" id="tz">${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}</span></div>
        </div>
        <div class="actions">
          <button class="btn ghost" id="draft" type="button">Save draft</button>
          <button class="btn primary" id="go" type="button"></button>
        </div>
      </div>
      <aside class="previews" id="pv"></aside>
    </div>`;

  const textEl = $('#text');
  const titleEl = $('#title');
  const rebuild = () => {
    S.text = renderTemplate(tpl.caption, S.values);
    textEl.value = S.text;
    if (!S.titleEdited && tpl.title) titleEl.value = S.title = renderTemplate(tpl.title, S.values);
  };
  $$('[data-field]').forEach((el) =>
    el.addEventListener('input', () => {
      S.values[el.dataset.field] = el.value;
      if (!S.textEdited) rebuild();
      else if (!S.titleEdited && tpl.title) titleEl.value = S.title = renderTemplate(tpl.title, S.values);
      renderPreviews();
    }),
  );
  if (!post) rebuild();
  textEl.addEventListener('input', () => {
    S.text = textEl.value;
    S.textEdited = true;
    renderPreviews();
  });
  $('#reply').addEventListener('input', (e) => {
    S.firstReply = e.target.value;
    renderPreviews();
  });
  titleEl.addEventListener('input', () => {
    S.title = titleEl.value;
    S.titleEdited = true;
    renderPreviews();
  });
  $('#regen')?.addEventListener('click', () => {
    S.textEdited = false;
    rebuild();
    renderPreviews();
  });
  $$('#pfs input').forEach((i) =>
    i.addEventListener('change', () => {
      i.checked ? S.platforms.add(i.value) : S.platforms.delete(i.value);
      renderPreviews();
    }),
  );
  const atEl = $('#at');
  const setWhen = (w) => {
    S.when = w;
    $$('#when button').forEach((b) => b.classList.toggle('on', b.dataset.w === w));
    atEl.classList.toggle('hidden', w === 'now');
    $('#tz').classList.toggle('hidden', w === 'now');
    $('#go').textContent = w === 'now' ? 'Publish now' : 'Schedule post';
  };
  $$('#when button').forEach((b) => (b.onclick = () => setWhen(b.dataset.w)));
  setWhen(S.when);
  atEl.addEventListener('change', () => (S.at = new Date(atEl.value)));

  // media
  const fileEl = $('#file');
  const renderMedia = () => {
    $('#media').innerHTML =
      S.media
        .map((m, i) => `<div class="thumb">${m.type === 'video' ? `<video src="${esc(m.url)}" muted></video>` : `<img src="${esc(m.url)}" alt="">`}${locked ? '' : `<button type="button" data-rm="${i}" aria-label="Remove">×</button>`}</div>`)
        .join('') +
      Array.from({ length: S.uploading }, () => `<div class="thumb"><div class="bar up" style="width:0%"></div></div>`).join('') +
      (locked ? '' : `<div class="drop" id="drop">+ Add<br>image / video</div>`);
    $$('[data-rm]').forEach((b) => (b.onclick = () => { S.media.splice(+b.dataset.rm, 1); renderMedia(); renderPreviews(); }));
    const drop = $('#drop');
    if (drop) {
      drop.onclick = () => fileEl.click();
      drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
      drop.ondragleave = () => drop.classList.remove('over');
      drop.ondrop = (e) => { e.preventDefault(); upload([...e.dataTransfer.files]); };
    }
  };
  async function upload(files) {
    files = files.filter((f) => /^(image|video)\//.test(f.type));
    S.uploading += files.length;
    renderMedia();
    await Promise.all(
      files.map(async (file) => {
        try {
          const path = `projects/${pid}/media/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${file.name.replace(/[^\w.-]/g, '_')}`;
          const task = uploadBytesResumable(sref(storage, path), file, { contentType: file.type });
          task.on('state_changed', (s) => {
            const bars = $$('.bar.up');
            const pct = (s.bytesTransferred / s.totalBytes) * 100;
            bars.forEach((b) => (b.style.width = `${Math.max(parseFloat(b.style.width) || 0, pct)}%`));
          });
          await task;
          const url = await getDownloadURL(task.snapshot.ref);
          S.media.push({ path, url, type: file.type.startsWith('video') ? 'video' : 'image', contentType: file.type, size: file.size, name: file.name });
        } catch (e) {
          toast(`Upload failed: ${errMsg(e)}`, true);
        } finally {
          S.uploading--;
          renderMedia();
          renderPreviews();
        }
      }),
    );
  }
  fileEl.onchange = () => { upload([...fileEl.files]); fileEl.value = ''; };
  renderMedia();
  if (sp?.media?.length) upload(sp.media.map((m) => new File([m.blob], m.name, { type: m.type })));

  // previews
  function renderPreviews() {
    const keys = PKEYS.filter((k) => S.platforms.has(k));
    $('#pv').innerHTML = keys.length
      ? keys
          .map((k) => {
            const pl = PLATFORMS[k];
            const text = S.overrides[k] ?? S.text;
            const probs = problems(k, text, S.media, S.title);
            const n = (pl.count || ((t) => [...t].length))(text);
            return `<div class="pv ${probs.length ? 'bad' : ''}">
            <div class="head"><span>${pl.label}${accName[k] ? ` · ${esc(accName[k])}` : ''}</span><span class="count ${n > pl.limit ? 'over' : ''}">${n}/${pl.limit}</span></div>
            ${S.overrides[k] !== undefined ? `<textarea data-ovr="${k}">${esc(text)}</textarea>` : `<div class="body">${esc(text) || '<span class="muted">(no text)</span>'}</div>`}
            ${S.firstReply.trim() && k !== 'tiktok' ? `<div class="small muted" style="margin-top:8px;white-space:pre-wrap">↳ ${k === 'youtube' ? 'in description' : 'first reply'}: ${esc(S.firstReply.trim())}</div>` : ''}
            ${probs.length ? `<ul class="probs">${probs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
            <div class="ovr">${locked ? '' : S.overrides[k] !== undefined ? `<button class="btn ghost sm" data-unovr="${k}" type="button">Use main caption</button>` : `<button class="btn ghost sm" data-doovr="${k}" type="button">Customize for ${pl.label}</button>`}</div>
            </div>`;
          })
          .join('')
      : '<div class="empty">Select at least one platform to see previews.</div>';
    $$('[data-doovr]').forEach((b) => (b.onclick = () => { S.overrides[b.dataset.doovr] = S.text; renderPreviews(); }));
    $$('[data-unovr]').forEach((b) => (b.onclick = () => { delete S.overrides[b.dataset.unovr]; renderPreviews(); }));
    $$('[data-ovr]').forEach((t) =>
      t.addEventListener('input', () => {
        S.overrides[t.dataset.ovr] = t.value;
        const card = t.closest('.pv');
        const pl = PLATFORMS[t.dataset.ovr];
        const n = (pl.count || ((s) => [...s].length))(t.value);
        const c = $('.count', card);
        c.textContent = `${n}/${pl.limit}`;
        c.classList.toggle('over', n > pl.limit);
      }),
    );
    $$('[data-ovr]').forEach((t) => t.addEventListener('blur', renderPreviews));
  }
  renderPreviews();

  if (locked) {
    $$('input, textarea, #draft, #go, #regen, #when button', view).forEach((el) => (el.disabled = true));
    return;
  }

  async function save(status) {
    if (S.uploading) throw new Error('Wait for uploads to finish.');
    const data = {
      templateId: tid && !['blank', 'studio'].includes(tid) ? tid : null,
      templateName: tpl.name,
      fields: S.values,
      text: S.text,
      firstReply: S.firstReply.trim(),
      title: S.title.trim(),
      overrides: Object.fromEntries(Object.entries(S.overrides).filter(([k]) => S.platforms.has(k))),
      media: S.media,
      platforms: PKEYS.filter((k) => S.platforms.has(k)),
      status,
      scheduledAt: status === 'scheduled' ? Timestamp.fromDate(S.at) : null,
      updatedAt: serverTimestamp(),
    };
    if (postId) {
      const cur = (await getDoc(doc(db, 'projects', pid, 'posts', postId))).data();
      if (['publishing', 'published'].includes(cur?.status)) throw new Error(`This post is already ${cur.status}.`);
      await updateDoc(doc(db, 'projects', pid, 'posts', postId), data);
      return postId;
    }
    const r = await addDoc(collection(db, 'projects', pid, 'posts'), { ...data, results: {}, createdAt: serverTimestamp(), createdBy: auth.currentUser.email });
    postId = r.id;
    return r.id;
  }
  const blockers = () => {
    if (!S.platforms.size) return 'Pick at least one platform.';
    const bad = [...S.platforms].map((k) => [k, problems(k, S.overrides[k] ?? S.text, S.media, S.title).filter((x) => !/skipped|is used/.test(x))]).filter(([, p]) => p.length);
    return bad.length ? `Fix first: ${bad.map(([k, p]) => `${PLATFORMS[k].label} ${p[0]}`).join('; ')}` : null;
  };
  const busy = (on) => ['#draft', '#go'].forEach((s) => ($(s).disabled = on));

  $('#draft').onclick = async () => {
    busy(true);
    try {
      await save('draft');
      toast('Draft saved.');
      location.hash = `#/p/${pid}/posts`;
    } catch (e) {
      toast(errMsg(e), true);
    }
    busy(false);
  };
  $('#go').onclick = async () => {
    const b = blockers();
    if (b) return toast(b, true);
    busy(true);
    try {
      if (S.when === 'later') {
        if (!(S.at > new Date())) throw new Error('Pick a time in the future.');
        await save('scheduled');
        toast(`Scheduled for ${fmt(S.at)}.`);
        location.hash = `#/p/${pid}/posts`;
      } else {
        const id = await save('draft');
        $('#go').textContent = 'Publishing…';
        const r = await call('publishNow', { projectId: pid, postId: id });
        toast(r.status === 'published' ? 'Published everywhere.' : r.status === 'partial' ? 'Some platforms failed. See the queue.' : 'Publishing failed. See the queue.', r.status !== 'published');
        location.hash = `#/p/${pid}/posts`;
      }
    } catch (e) {
      toast(errMsg(e), true);
      setWhen(S.when);
    }
    busy(false);
  };
}

// ---------------------------------------------------------------- queue

async function viewPosts(pid) {
  const p = await project(pid);
  crumbs([['Projects', '#/'], [p.name, `#/p/${pid}`], ['Posts']]);
  view.innerHTML = `
    <div class="spread"><div><h1>Posts</h1><p class="lede">Scheduled posts go out automatically at their time (checked every minute).</p></div>
    <a class="btn primary" href="#/p/${pid}/templates">New post</a></div>
    <div id="lists"><p class="muted">Loading…</p></div>`;
  const unsub = onSnapshot(query(collection(db, 'projects', pid, 'posts'), orderBy('createdAt', 'desc'), limit(300)), (snap) => {
    const posts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const by = (s) => posts.filter((x) => s.includes(x.status));
    const sched = by(['scheduled']).sort((a, b) => toDate(a.scheduledAt) - toDate(b.scheduledAt));
    const hist = by(['published', 'partial', 'failed']).sort((a, b) => (toDate(b.publishedAt) || 0) - (toDate(a.publishedAt) || 0));
    const sec = (title, list, emptyText) =>
      `<h2>${title} <span class="muted mono small">${list.length}</span></h2>${list.length ? `<div class="list">${list.map(item).join('')}</div>` : `<div class="empty">${emptyText}</div>`}`;
    $('#lists').innerHTML =
      (by(['publishing']).length ? sec('Publishing now', by(['publishing']), '') : '') +
      sec('Scheduled', sched, 'Nothing scheduled.') +
      sec('Drafts', by(['draft']), 'No drafts.') +
      sec('History', hist, 'Nothing published yet.');
    bind();
  });
  cleanup.push(unsub);

  function item(x) {
    const m = x.media?.[0];
    const thumb = m ? (m.type === 'video' ? `<video class="mthumb" src="${esc(m.url)}" muted></video>` : `<img class="mthumb" src="${esc(m.url)}" alt="">`) : '<div class="mthumb">TEXT</div>';
    const when =
      x.status === 'scheduled' ? `Scheduled ${fmt(x.scheduledAt)}` : x.status === 'draft' ? `Draft · edited ${fmt(x.updatedAt)}` : x.status === 'publishing' ? 'Publishing…' : `Published ${fmt(x.publishedAt)}`;
    const chips = (x.platforms || [])
      .map((k) => {
        const r = x.results?.[k];
        const label = PLATFORMS[k]?.label || k;
        if (r?.status === 'published') return r.url ? `<a class="chip ok" href="${esc(r.url)}" target="_blank" rel="noopener" title="${esc(r.note || 'Open post')}">✓ ${label} ↗</a>` : `<span class="chip ok" title="${esc(r.note || '')}">✓ ${label}</span>`;
        if (r?.status === 'failed') return `<span class="chip bad" title="${esc(r.error)}">✗ ${label}</span>`;
        return `<span class="chip">${label}</span>`;
      })
      .join('');
    const errs = Object.entries(x.results || {}).filter(([, r]) => r.status === 'failed');
    const acts = [];
    if (['draft', 'scheduled', 'failed', 'partial'].includes(x.status)) acts.push(`<a class="btn sm" href="#/p/${pid}/posts/${x.id}/edit">Edit</a>`);
    if (['draft', 'scheduled'].includes(x.status)) acts.push(`<button class="btn sm" data-now="${x.id}">Publish now</button>`);
    if (['failed', 'partial'].includes(x.status)) acts.push(`<button class="btn sm primary" data-now="${x.id}">Retry failed</button>`);
    if (x.status === 'scheduled') acts.push(`<button class="btn sm ghost" data-unsched="${x.id}">Unschedule</button>`);
    if (['published', 'partial', 'failed'].includes(x.status)) acts.push(`<a class="btn sm ghost" href="#/p/${pid}/posts/${x.id}/edit?duplicate=1">Duplicate</a>`);
    if (x.status !== 'publishing') acts.push(`<button class="btn sm ghost danger" data-del="${x.id}">Delete</button>`);
    return `<div class="item">${thumb}<div><div class="meta">${when}${x.templateName ? ` · ${esc(x.templateName)}` : ''}</div>
      ${x.title ? `<h3>${esc(x.title)}</h3>` : ''}<div class="txt">${esc(x.text)}</div><div class="chips">${chips}</div>
      ${errs.map(([k, r]) => `<div class="small" style="color:var(--bad);margin-top:6px">${esc(PLATFORMS[k]?.label || k)}: ${esc(r.error)}</div>`).join('')}</div>
      <div class="acts">${acts.join('')}</div></div>`;
  }
  function bind() {
    $$('[data-now]').forEach((b) =>
      (b.onclick = async () => {
        b.disabled = true;
        b.textContent = 'Publishing…';
        try {
          const r = await call('publishNow', { projectId: pid, postId: b.dataset.now });
          toast(r.status === 'published' ? 'Published.' : 'Some platforms failed.', r.status !== 'published');
        } catch (e) {
          toast(errMsg(e), true);
          b.disabled = false;
        }
      }),
    );
    $$('[data-unsched]').forEach((b) => (b.onclick = () => updateDoc(doc(db, 'projects', pid, 'posts', b.dataset.unsched), { status: 'draft', scheduledAt: null }).then(() => toast('Moved to drafts.'))));
    $$('[data-del]').forEach((b) =>
      (b.onclick = async () => {
        if (b.dataset.confirm !== '1') {
          b.dataset.confirm = '1';
          b.textContent = 'Click again to delete';
          return;
        }
        await deleteDoc(doc(db, 'projects', pid, 'posts', b.dataset.del));
        toast('Deleted from the queue (already-published posts stay on the platforms).');
      }),
    );
  }
}

// ---------------------------------------------------------------- accounts

async function viewAccounts(pid, q) {
  const p = await project(pid);
  crumbs([['Projects', '#/'], [p.name, `#/p/${pid}`], ['Accounts']]);
  let apps = {};
  let appsErr = '';
  try {
    apps = (await call('appConfigStatus')).apps;
  } catch (e) {
    appsErr = errMsg(e);
  }
  const banner = q.get('error') ? `<div class="banner bad">${esc(q.get('error'))}</div>` : q.get('connected') ? `<div class="banner ok">${esc(PLATFORMS[q.get('connected')]?.label || '')} connected.</div>` : '';
  view.innerHTML = `
    <h1>Connected accounts</h1>
    <p class="lede">The ${esc(p.name)} accounts Kedo posts to. Each platform needs its developer app set up once in <a href="#/settings">Settings</a>.</p>
    ${banner}${appsErr ? `<div class="banner bad">Backend not reachable: ${esc(appsErr)}</div>` : ''}
    <div class="grid" id="acc"></div>`;
  const unsub = onSnapshot(collection(db, 'projects', pid, 'accounts'), (snap) => {
    const acc = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
    $('#acc').innerHTML = PKEYS.map((k) => {
      const pl = PLATFORMS[k];
      const a = acc[k];
      const configured = apps[pl.app]?.configured;
      const days = a?.expiresAt && !a.canRefresh ? Math.floor((a.expiresAt - Date.now()) / 86400000) : null;
      const chip = !a ? '<span class="chip">Not connected</span>' : a.status === 'connected' ? '<span class="chip ok">Connected</span>' : a.status === 'choose' ? '<span class="chip warn">Choose account</span>' : `<span class="chip bad">${esc(a.status)}</span>`;
      return `<div class="card">
        <div class="spread"><h3>${pl.label}</h3>${chip}</div>
        ${a?.name ? `<p>${esc(a.name)}</p>` : ''}
        ${days !== null ? `<p class="small ${days < 7 ? '' : 'muted'}" style="${days < 7 ? 'color:var(--warn)' : ''}">Access expires in ${days} days</p>` : ''}
        ${a?.status === 'choose' || (a?.choices?.length > 1) ? `<label class="f" style="margin-top:12px"><span>Post as</span><select data-choose="${k}">${a.status === 'choose' ? '<option value="">Choose…</option>' : ''}${a.choices.map((c) => `<option value="${esc(c.id)}" ${c.name === a.name ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>` : ''}
        <div class="row" style="margin-top:14px">${
          configured
            ? `<button class="btn ${a ? '' : 'primary'} sm" data-connect="${k}">${a ? 'Reconnect' : 'Connect'}</button>${a ? `<button class="btn ghost sm danger" data-disc="${k}">Disconnect</button>` : ''}`
            : `<a class="btn sm" href="#/settings">Set up ${esc(APPS[pl.app].label)} app</a>`
        }</div></div>`;
    }).join('');
    $$('[data-connect]').forEach((b) =>
      (b.onclick = async () => {
        b.disabled = true;
        try {
          const { url } = await call('oauthStart', { projectId: pid, platform: b.dataset.connect, returnTo: location.href.split('#')[0] });
          location.href = url;
        } catch (e) {
          toast(errMsg(e), true);
          b.disabled = false;
        }
      }),
    );
    $$('[data-disc]').forEach((b) =>
      (b.onclick = async () => {
        if (b.dataset.confirm !== '1') {
          b.dataset.confirm = '1';
          b.textContent = 'Click again to disconnect';
          return;
        }
        await call('disconnect', { projectId: pid, platform: b.dataset.disc }).catch((e) => toast(errMsg(e), true));
      }),
    );
    $$('[data-choose]').forEach((s) =>
      (s.onchange = async () => {
        if (!s.value) return;
        try {
          await call('selectTarget', { projectId: pid, platform: s.dataset.choose, targetId: s.value });
          toast('Saved.');
        } catch (e) {
          toast(errMsg(e), true);
        }
      }),
    );
  });
  cleanup.push(unsub);
}

// ---------------------------------------------------------------- log

async function viewLog(pid) {
  const p = await project(pid);
  crumbs([['Projects', '#/'], [p.name, `#/p/${pid}`], ['Activity log']]);
  view.innerHTML = `
    <div class="spread"><div><h1>Activity log</h1><p class="lede">Everything Kedo did for ${esc(p.name)}: posts, failures, connections, token warnings.</p></div>
    <select id="flt" style="max-width:200px"><option value="">All platforms</option>${PKEYS.map((k) => `<option value="${k}">${PLATFORMS[k].label}</option>`).join('')}<option value="!error">Errors only</option></select></div>
    <div class="log" id="log"></div>`;
  let rows = [];
  const draw = () => {
    const f = $('#flt').value;
    const list = rows.filter((r) => !f || (f === '!error' ? r.level === 'error' : r.platform === f));
    $('#log').innerHTML = list.length
      ? list
          .map((r) => `<div class="l ${esc(r.level)}"><span class="muted">${fmt(r.at)}</span><span>${esc(PLATFORMS[r.platform]?.label || '·')}</span><span class="m">${esc(r.message)}${r.url ? ` <a href="${esc(r.url)}" target="_blank" rel="noopener">view ↗</a>` : ''}${r.postId ? ` <a class="muted" href="#/p/${pid}/posts/${esc(r.postId)}/edit">post</a>` : ''}</span></div>`)
          .join('')
      : '<div class="empty">Nothing logged yet.</div>';
  };
  $('#flt').onchange = draw;
  cleanup.push(
    onSnapshot(query(collection(db, 'projects', pid, 'logs'), orderBy('at', 'desc'), limit(300)), (snap) => {
      rows = snap.docs.map((d) => d.data());
      draw();
    }),
  );
}

// ---------------------------------------------------------------- settings

async function viewSettings() {
  crumbs([['Projects', '#/'], ['Settings']]);
  view.innerHTML = '<p class="muted">Loading…</p>';
  let st;
  try {
    st = await call('appConfigStatus');
  } catch (e) {
    view.innerHTML = `<h1>Settings</h1><div class="banner bad">Backend not reachable: ${esc(errMsg(e))}. Deploy the Cloud Functions first.</div>`;
    return;
  }
  view.innerHTML = `
    <h1>Platform developer apps</h1>
    <p class="lede">Each platform requires a developer app before Kedo can post for you. Set each one up once; every project uses it.</p>
    <div class="banner info">Redirect URI to register with every platform:<br><code id="ru">${esc(st.redirectUri)}</code> <button class="btn sm ghost" id="cp">Copy</button></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(340px,1fr))">${Object.entries(APPS)
      .map(([k, a]) => {
        const s = st.apps[k] || {};
        return `<form class="card" data-app="${k}">
          <div class="spread"><h3>${esc(a.label)}</h3>${s.configured ? '<span class="chip ok">Set up</span>' : '<span class="chip">Not set up</span>'}</div>
          <ul class="notes">${a.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
          <p class="small"><a href="${a.console}" target="_blank" rel="noopener">Open developer console ↗</a></p>
          <label class="f"><span>Client ID / App ID</span><input type="text" name="clientId" value="${esc(s.clientId)}" autocomplete="off"></label>
          <label class="f"><span>Client secret ${s.configured ? '(saved; leave blank to keep it)' : ''}</span><input type="password" name="clientSecret" autocomplete="new-password"></label>
          ${a.orgs ? `<label class="check" style="margin-bottom:14px"><input type="checkbox" name="orgs" ${s.orgs ? 'checked' : ''}>Company pages (Community Management API approved)</label>` : ''}
          <div class="row" style="justify-content:flex-end"><button class="btn primary sm">Save</button></div></form>`;
      })
      .join('')}</div>`;
  $('#cp').onclick = () => navigator.clipboard.writeText(st.redirectUri).then(() => toast('Copied.'));
  $$('form[data-app]').forEach((f) =>
    (f.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await call('saveAppConfig', { app: f.dataset.app, clientId: f.clientId.value, clientSecret: f.clientSecret.value, orgs: f.orgs?.checked });
        toast('Saved.');
        viewSettings();
      } catch (er) {
        toast(errMsg(er), true);
      }
    }),
  );
}
