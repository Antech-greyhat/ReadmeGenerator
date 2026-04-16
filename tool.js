// ─── State ───
let userData = null;
let repoData = [];
let langData = {};
let activeLangs = new Set();
let generatedMarkdown = '';

const SECTIONS = [
  { id: 'header',   label: 'Introduction',   icon: '✦' },
  { id: 'connect',  label: 'Connect with Me', icon: '⌁' },
  { id: 'techstack',label: 'Tech Stack',      icon: '⬡' },
  { id: 'stats',    label: 'GitHub Stats',    icon: '◈' },
  { id: 'streak',   label: 'Streak Stats',    icon: '◉' },
  { id: 'trophies', label: 'Trophies',        icon: '⬢' },
  { id: 'learning', label: 'Currently Learning', icon: '⊕' },
  { id: 'quote',    label: 'Dev Quote',       icon: '❝' },
];
let activeSections = new Set(SECTIONS.map(s => s.id));

// ─── Cache ───
const CACHE_TTL = 5 * 60 * 1000;
function cacheSet(k, v) { try { localStorage.setItem(k, JSON.stringify({ v, t: Date.now() })); } catch(e){} }
function cacheGet(k) {
  try {
    const d = JSON.parse(localStorage.getItem(k));
    if (d && Date.now() - d.t < CACHE_TTL) return d.v;
  } catch(e) {}
  return null;
}

// ─── UI Helpers ───
function setStatus(text, green = false) {
  document.getElementById('status-text').textContent = text;
  document.getElementById('status-dot').className = 'status-dot' + (green ? ' green' : '');
}

function showError(msg) {
  const el = document.getElementById('error-msg');
  el.textContent = msg; el.classList.add('show');
}
function clearError() { document.getElementById('error-msg').classList.remove('show'); }

function setLoading(on) {
  const btn = document.getElementById('fetch-btn');
  const bar = document.getElementById('loading-bar');
  btn.disabled = on;
  btn.classList.toggle('loading', on);
  bar.classList.toggle('active', on);
}

function toast(msg, type = 'success') {
  const t = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = msg;
  document.getElementById('toast-icon').textContent = type === 'success' ? '✓' : '✕';
  t.className = 'toast show ' + type;
  setTimeout(() => t.className = 'toast', 2500);
}

function switchTab(tab, el) {
  document.querySelectorAll('.preview-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('preview-pane').classList.toggle('active', tab === 'preview');
  document.getElementById('raw-pane').classList.toggle('active', tab === 'raw');
}

// ─── GitHub API ───
function extractUsername(url) {
  url = url.trim().replace(/\/+$/, '');
  const m = url.match(/github\.com\/([a-zA-Z0-9-]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9-]+$/.test(url)) return url;
  return null;
}

async function fetchProfile() {
  const input = document.getElementById('gh-url').value;
  const username = extractUsername(input);

  if (!username) { showError('Enter a valid GitHub URL or username'); return; }

  // Check cache
  const cached = cacheGet('gh_' + username);
  if (cached) {
    userData = cached.user;
    repoData = cached.repos;
    langData = cached.langs;
    onDataReady();
    toast('Loaded from cache');
    return;
  }

  setLoading(true);
  setStatus('Fetching...');
  clearError();

  try {
    const [userRes, reposRes] = await Promise.all([
      fetch(`https://api.github.com/users/${username}`),
      fetch(`https://api.github.com/users/${username}/repos?per_page=100&sort=updated`)
    ]);

    if (!userRes.ok) {
      if (userRes.status === 404) throw new Error('User not found');
      if (userRes.status === 403) throw new Error('API rate limit reached. Try again in a minute.');
      throw new Error('GitHub API error: ' + userRes.status);
    }

    userData = await userRes.json();
    repoData = reposRes.ok ? await reposRes.json() : [];

    // Aggregate languages
    langData = {};
    const langFetches = repoData.filter(r => !r.fork).slice(0, 20).map(r =>
      fetch(r.languages_url)
        .then(res => res.json())
        .then(langs => { for (const [l, b] of Object.entries(langs)) langData[l] = (langData[l]||0) + b; })
        .catch(() => {})
    );
    await Promise.allSettled(langFetches);

    cacheSet('gh_' + username, { user: userData, repos: repoData, langs: langData });
    onDataReady();

  } catch (e) {
    showError(e.message);
    setStatus('Error');
    toast(e.message, 'error');
  } finally {
    setLoading(false);
  }
}

// ─── On Data Ready ───
function onDataReady() {
  setStatus(userData.login, true);
  renderProfileCard();
  buildSectionToggles();
  buildLangTags();
  populateCustomFields();
  showControls();
  regenerate();
}

function renderProfileCard() {
  const el = document.getElementById('profile-card');
  const u = userData;
  el.innerHTML = `
    <div class="avatar-wrap"><img src="${u.avatar_url}" alt="${u.login}"></div>
    <div class="profile-info">
      <div class="profile-name">${u.name || u.login}</div>
      <div class="profile-login">@${u.login}</div>
      ${u.bio ? `<div class="profile-bio">${u.bio}</div>` : ''}
      <div class="profile-meta">
        <span>⬡ <strong>${repoData.length}</strong> repos</span>
        <span>↑ <strong>${u.followers}</strong> followers</span>
        ${u.location ? `<span>◎ ${u.location}</span>` : ''}
      </div>
    </div>`;
}

function buildSectionToggles() {
  const el = document.getElementById('section-toggles');
  el.innerHTML = '';
  SECTIONS.forEach(s => {
    const wrap = document.createElement('div');
    wrap.className = 'section-toggle';
    const on = activeSections.has(s.id);
    wrap.innerHTML = `
      <div class="section-toggle-label">
        <span class="section-icon">${s.icon}</span>
        <span>${s.label}</span>
      </div>
      <div class="toggle ${on ? 'on' : ''}" data-id="${s.id}"></div>`;
    wrap.querySelector('.toggle').addEventListener('click', function() {
      const id = this.dataset.id;
      if (activeSections.has(id)) activeSections.delete(id);
      else activeSections.add(id);
      this.classList.toggle('on');
      updateSectionCount();
      regenerate();
    });
    el.appendChild(wrap);
  });
  updateSectionCount();
}

function updateSectionCount() {
  document.getElementById('section-count').textContent = activeSections.size + ' active';
}

function buildLangTags() {
  const sorted = Object.entries(langData).sort((a,b) => b[1]-a[1]).slice(0, 24).map(e => e[0]);
  activeLangs = new Set(sorted.slice(0, 12));
  const el = document.getElementById('lang-tags');
  el.innerHTML = '';
  sorted.forEach(lang => {
    const tag = document.createElement('div');
    tag.className = 'lang-tag' + (activeLangs.has(lang) ? ' active' : '');
    tag.textContent = lang;
    tag.onclick = () => {
      if (activeLangs.has(lang)) activeLangs.delete(lang);
      else activeLangs.add(lang);
      tag.classList.toggle('active');
      regenerate();
    };
    el.appendChild(tag);
  });
}

function populateCustomFields() {
  const u = userData;
  document.getElementById('c-name').value = u.name || u.login;
  document.getElementById('c-bio').value = u.bio || '';
  document.getElementById('c-location').value = u.location || '';
  document.getElementById('c-website').value = u.blog || '';
  document.getElementById('c-tagline').value = '';
}

function showControls() {
  ['profile-section','customize-section','sections-section','langs-section'].forEach(id => {
    document.getElementById(id).hidden = false;
  });
}

// ─── README Generator ───
function regenerate() {
  if (!userData) return;
  const name     = document.getElementById('c-name').value || userData.name || userData.login;
  const tagline  = document.getElementById('c-tagline').value;
  const bio      = document.getElementById('c-bio').value;
  const location = document.getElementById('c-location').value;
  const website  = document.getElementById('c-website').value;
  const login    = userData.login;

  const lines = [];

  if (activeSections.has('header')) {
    lines.push(`<h1 align="center">Hi there 👋, I'm ${name}</h1>`);
    if (tagline) lines.push(`<h3 align="center">${tagline}</h3>`);
    lines.push('');
    if (bio) {
      lines.push(`<p align="center">${bio}</p>`);
      lines.push('');
    }
    const meta = [];
    if (location) meta.push(`📍 ${location}`);
    if (website) meta.push(`🌐 [Website](${website.startsWith('http') ? website : 'https://' + website})`);
    meta.push(`📊 Public Repos: **${repoData.length}**`);
    meta.push(`👥 Followers: **${userData.followers}**`);
    if (meta.length) {
      lines.push(meta.join('  •  '));
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  }

  if (activeSections.has('connect')) {
    lines.push(`## 🔗 Connect with Me`);
    lines.push('');
    lines.push(`[![GitHub](https://img.shields.io/badge/GitHub-${login}-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/${login})`);
    if (website) {
      const ws = website.replace(/https?:\/\//, '').replace(/\//g, '');
      lines.push(`[![Website](https://img.shields.io/badge/Website-${ws}-7c6af7?style=for-the-badge&logo=google-chrome&logoColor=white)](${website.startsWith('http') ? website : 'https://' + website})`);
    }
    lines.push('');
  }

  if (activeSections.has('techstack') && activeLangs.size > 0) {
    lines.push(`## ⚡ Tech Stack`);
    lines.push('');
    lines.push(`\`\`\``);
    lines.push([...activeLangs].join('  •  '));
    lines.push(`\`\`\``);
    lines.push('');
    // Shields
    const shields = [...activeLangs].map(lang => {
      const slug = lang.toLowerCase().replace(/\+\+/g, 'plusplus').replace(/#/g, 'sharp').replace(/ /g, '');
      return `![${lang}](https://img.shields.io/badge/-${encodeURIComponent(lang)}-05122A?style=flat&logo=${slug})`;
    });
    lines.push(shields.join(' '));
    lines.push('');
  }

  if (activeSections.has('stats')) {
    lines.push(`## 📊 GitHub Stats`);
    lines.push('');
    lines.push(`<p align="center">`);
    lines.push(`  <img src="https://github-readme-stats.vercel.app/api?username=${login}&show_icons=true&theme=tokyonight&hide_border=true&count_private=true" alt="stats" />`);
    lines.push(`  <img src="https://github-readme-stats.vercel.app/api/top-langs/?username=${login}&layout=compact&theme=tokyonight&hide_border=true" alt="langs" />`);
    lines.push(`</p>`);
    lines.push('');
  }

  if (activeSections.has('streak')) {
    lines.push(`## 🔥 GitHub Streak`);
    lines.push('');
    lines.push(`<p align="center">`);
    lines.push(`  <img src="https://streak-stats.demolab.com?user=${login}&theme=tokyonight&hide_border=true" alt="streak" />`);
    lines.push(`</p>`);
    lines.push('');
  }

  if (activeSections.has('trophies')) {
    lines.push(`## 🏆 Trophies`);
    lines.push('');
    lines.push(`<p align="center">`);
    lines.push(`  <img src="https://github-profile-trophy.vercel.app/?username=${login}&theme=tokyonight&no-frame=true&row=1&column=7" alt="trophies" />`);
    lines.push(`</p>`);
    lines.push('');
  }

  if (activeSections.has('learning')) {
    lines.push(`## 🌱 Currently Learning`);
    lines.push('');
    lines.push(`I'm always exploring new technologies and expanding my skill set.`);
    lines.push('');
  }

  if (activeSections.has('quote')) {
    lines.push(`## 💬 Dev Quote`);
    lines.push('');
    lines.push(`> "Any fool can write code that a computer can understand. Good programmers write code that humans can understand." — Martin Fowler`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(`<p align="center">Made with ❤️by <a href="https://github.com/Antech-greyhat">Antech-greyhat</a></p>`);

  generatedMarkdown = lines.join('\n');
  renderPreview();
}

function renderPreview() {
  const el = document.getElementById('gh-preview');
  document.getElementById('empty-state').hidden = true;
  el.hidden = false;
  if (typeof marked !== 'undefined') {
    el.innerHTML = marked.parse(generatedMarkdown);
  } else {
    el.innerHTML = '<pre>' + generatedMarkdown + '</pre>';
  }
  document.getElementById('raw-code').textContent = generatedMarkdown;
}

// ─── Export ───
function copyMarkdown() {
  if (!generatedMarkdown) { toast('Nothing to copy yet!', 'error'); return; }
  navigator.clipboard.writeText(generatedMarkdown).then(() => toast('Copied to clipboard!')).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = generatedMarkdown;
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
    toast('Copied!');
  });
}

function downloadMarkdown() {
  if (!generatedMarkdown) { toast('Generate a README first!', 'error'); return; }
  const blob = new Blob([generatedMarkdown], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'README.md';
  a.click();
  toast('Downloaded README.md!');
}

function initializeUi() {
  const ghUrl = document.getElementById('gh-url');
  ghUrl.addEventListener('input', clearError);
  ghUrl.addEventListener('keydown', event => {
    if (event.key === 'Enter') fetchProfile();
  });

  document.getElementById('fetch-btn').addEventListener('click', fetchProfile);
  document.getElementById('copy-btn').addEventListener('click', copyMarkdown);
  document.getElementById('export-btn').addEventListener('click', downloadMarkdown);
  document.querySelectorAll('.preview-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab, tab));
  });

  if (typeof marked !== 'undefined') {
    marked.setOptions({ breaks: true, gfm: true });
  }
}

initializeUi();
