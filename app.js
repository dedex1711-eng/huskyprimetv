// ── Auth guard ───────────────────────────────────────────────────────────────
const SERVER = localStorage.getItem('hp_server');
const USER   = localStorage.getItem('hp_user');
const PASS   = localStorage.getItem('hp_pass');
if (!SERVER) { location.href = 'index.html'; }

// ── CORS Proxy ────────────────────────────────────────────────────────────────
const _PROXY_DEFAULT = 'https://super-hall-2081.alanadianabrito22.workers.dev';
// Em Electron (file://) ou HTTP, não precisa de proxy — acesso direto
const _IS_ELECTRON = location.protocol === 'file:' || navigator.userAgent.includes('Electron');
const _IS_LOCALHOST = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const _PROXY_SAVED = localStorage.getItem('hp_proxy') || '';
const _PROXY = _IS_ELECTRON || _IS_LOCALHOST
  ? ''  // Electron ou localhost: acesso direto sem proxy
  : ((_PROXY_SAVED && !_PROXY_SAVED.includes('fancy-feather')) ? _PROXY_SAVED : _PROXY_DEFAULT);
// Atualiza localStorage com o proxy correto
localStorage.setItem('hp_proxy', _PROXY);

function proxyUrl(url) {
  return _PROXY ? `${_PROXY}?url=${encodeURIComponent(url)}` : url;
}

/**
 * Tenta acessar URL localmente primeiro, depois com proxy se falhar
 * Útil para streaming de canais/filmes/séries
 */
async function fetchWithLocalFallback(url, opts = {}) {
  // Se não precisa proxy, tenta direto
  if (!_PROXY) {
    return fetch(url, opts);
  }

  // Tenta acesso local primeiro (sem proxy)
  try {
    console.log(`[Fetch] Tentando acesso local: ${url}`);
    const response = await fetch(url, { ...opts, signal: AbortSignal.timeout(3000) });
    if (response.ok) {
      console.log(`[Fetch] Sucesso local: ${url}`);
      return response;
    }
  } catch (e) {
    console.log(`[Fetch] Acesso local falhou: ${e.message}`);
  }

  // Se falhou, tenta com proxy
  try {
    console.log(`[Fetch] Tentando com proxy: ${url}`);
    const proxyedUrl = proxyUrl(url);
    const response = await fetch(proxyedUrl, opts);
    if (response.ok) {
      console.log(`[Fetch] Sucesso com proxy: ${url}`);
      return response;
    }
  } catch (e) {
    console.log(`[Fetch] Acesso com proxy falhou: ${e.message}`);
  }

  // Se tudo falhar, retorna erro
  throw new Error(`Falha ao acessar: ${url}`);
}

const api = (action, extra = '') =>
  `${SERVER}/player_api.php?username=${encodeURIComponent(USER)}&password=${encodeURIComponent(PASS)}&action=${action}${extra}`;

const RADIO_API    = 'https://de1.api.radio-browser.info';
const ESPN_API     = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

// ── Profile-scoped storage keys ───────────────────────────────────────────────
function profileKey(base) {
  // Called after profiles are loaded — safe to use getCurrentProfile
  try {
    const d = loadProfiles();
    const id = d?.currentId || 'default';
    return `${base}_${id}`;
  } catch { return base; }
}

// ── State ─────────────────────────────────────────────────────────────────────
let currentPage = 'home';
let allItems    = [];
let categories  = [];
let currentCat  = 'all';
let favorites   = {};
let recents     = [];
let watchProgress = {};

function loadProfileState() {
  favorites     = JSON.parse(localStorage.getItem(profileKey('hp_favs'))    || '{}');
  recents       = JSON.parse(localStorage.getItem(profileKey('hp_recents')) || '[]');
  watchProgress = JSON.parse(localStorage.getItem(profileKey('hp_progress'))|| '{}');
}

function getProgress() {
  watchProgress = JSON.parse(localStorage.getItem(profileKey('hp_progress')) || '{}');
  return watchProgress;
}
let renderOffset = 0;
const BATCH = 99;

// Memory cache (streams too large for localStorage)
let _cachedChannels = null, _cachedMovies = null, _cachedSeries = null;
let _cachedCatLive = null, _cachedCatMovies = null, _cachedCatSeries = null;
let _cachedRadio = null;
let _cachedFootball = null;
let _bannerItems = [], _bannerIdx = 0, _bannerTimer = null;
let _liveTimer = null;

const CACHE_TTL = 2 * 60 * 60 * 1000;

function cacheSet(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch(e) {
    ['hp_cache_cat_live','hp_cache_cat_movies','hp_cache_cat_series'].forEach(k => localStorage.removeItem(k));
    try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch {}
  }
}
function cacheGet(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.data || !Array.isArray(parsed.data)) { localStorage.removeItem(key); return null; }
    if (Date.now() - parsed.ts > CACHE_TTL) { localStorage.removeItem(key); return null; }
    return parsed.data;
  } catch { localStorage.removeItem(key); return null; }
}

// Radio state
let _radioStations = [], _radioFiltered = [], _radioCat = 'brasil';
const RADIO_CATS = [
  { key: 'brasil',    label: '🇧🇷 Brasil',      query: 'country/brazil' },
  { key: 'top',       label: '🔥 Mais Ouvidas', query: 'top' },
  { key: 'sertanejo', label: '🤠 Sertanejo',    query: 'tag/sertanejo' },
  { key: 'gospel',    label: '✝ Gospel',         query: 'tag/gospel' },
  { key: 'pagode',    label: '🥁 Pagode',        query: 'tag/pagode' },
  { key: 'funk',      label: '🎵 Funk',          query: 'tag/funk' },
  { key: 'rock',      label: '🎸 Rock',          query: 'tag/rock' },
  { key: 'pop',       label: '🎤 Pop',           query: 'tag/pop' },
  { key: 'jazz',      label: '🎷 Jazz',          query: 'tag/jazz' },
  { key: 'classical', label: '🎻 Clássica',      query: 'tag/classical' },
  { key: 'news',      label: '📰 Notícias',      query: 'tag/news' },
  { key: 'favorites', label: '❤ Favoritos',      query: 'favorites' },
];

// ── DOM ───────────────────────────────────────────────────────────────────────
const grid        = document.getElementById('grid');
const gridScroll  = document.getElementById('gridScroll');
const catList     = document.getElementById('catList');
const catTitle    = document.getElementById('catSidebarTitle');
const panelTitle  = document.getElementById('panelTitle');
const panelSearch = document.getElementById('panelSearch');
const clearSearch = document.getElementById('clearSearch');
const expiryText  = document.getElementById('expiryText');
const navSidebar  = document.getElementById('navSidebar');

// ── Init ──────────────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-btn[data-page]').forEach(btn => {
  btn.addEventListener('click', () => {
    setActivePage(btn.dataset.page);
    navSidebar.classList.remove('open');
  });
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  if (confirm('Sair do HuskyPlay?')) {
    ['hp_server','hp_expiry',
     'hp_cache_cat_live','hp_cache_cat_movies','hp_cache_cat_series'
    ].forEach(k => localStorage.removeItem(k));
    location.href = 'index.html';
  }
});

document.getElementById('menuToggle').addEventListener('click', () => navSidebar.classList.toggle('open'));
document.addEventListener('click', e => {
  if (!navSidebar.contains(e.target) && e.target !== document.getElementById('menuToggle'))
    navSidebar.classList.remove('open');
});

panelSearch.addEventListener('input', () => {
  clearSearch.classList.toggle('hidden', !panelSearch.value);
  if (currentPage === 'radio') filterRadio(panelSearch.value);
  else renderFiltered();
});
clearSearch.addEventListener('click', () => {
  panelSearch.value = '';
  clearSearch.classList.add('hidden');
  if (currentPage === 'radio') filterRadio('');
  else renderFiltered();
});

gridScroll.addEventListener('scroll', () => {
  if (gridScroll.scrollTop + gridScroll.clientHeight >= gridScroll.scrollHeight - 300)
    loadMoreItems();
});

// Expiry
const expiry = localStorage.getItem('hp_expiry');
if (expiry) {
  const days = Math.ceil((parseInt(expiry) * 1000 - Date.now()) / 86400000);
  expiryText.textContent = days > 0 ? `Expira em ${days} dias` : 'Expirado';
} else { expiryText.textContent = '—'; }

// ── Page navigation ───────────────────────────────────────────────────────────
function setActivePage(page) {
  // Kids mode: block restricted pages
  if (isKidsProfile() && ['games', 'radio'].includes(page)) {
    page = 'home';
  }

  currentPage = page;
  currentCat  = 'all';
  panelSearch.value = '';
  clearSearch.classList.add('hidden');
  renderOffset = 0;

  document.querySelectorAll('.nav-btn[data-page]').forEach(b =>
    b.classList.toggle('active', b.dataset.page === page));

  gridScroll.className = 'grid-scroll';
  if (page === 'movies' || page === 'favorites') gridScroll.classList.add('movies-scroll');
  if (page === 'series') gridScroll.classList.add('series-scroll');
  if (page === 'radio')  gridScroll.classList.add('radio-scroll');

  const catSidebar = document.querySelector('.cat-sidebar');
  const noCat = ['home', 'recents', 'favorites', 'games'];
  if (catSidebar) catSidebar.style.display = noCat.includes(page) ? 'none' : '';

  const panelSearchWrap = document.querySelector('.panel-search');
  if (panelSearchWrap) panelSearchWrap.style.display = noCat.includes(page) ? 'none' : '';

  loadPage(page);
}

async function loadPage(page) {
  if (page !== 'home') showLoading(true, page);
  grid.innerHTML = '';
  grid.style.display = 'flex';
  grid.style.flexWrap = 'wrap';
  grid.style.alignItems = 'flex-start';
  grid.classList.remove('recents-grid');
  catList.innerHTML = '';

  try {
    if (page === 'home') {
      catTitle.textContent = '🏠 Início';
      panelTitle.textContent = '';
      showLoading(false);
      await renderHome();
      return;
    }
    if (page === 'live') {
      catTitle.textContent = '📺 Canais ao Vivo';
      panelSearch.placeholder = 'Buscar canais...';
      if (!_cachedCatLive) _cachedCatLive = cacheGet('hp_cache_cat_live');
      if (!_cachedChannels || !_cachedCatLive) {
        const [cats, items] = await Promise.all([
          fetchJsonTimeout(api('get_live_categories')),
          fetchJsonTimeout(api('get_live_streams'))
        ]);
        _cachedCatLive = cats || []; _cachedChannels = items || [];
        cacheSet('hp_cache_cat_live', _cachedCatLive);
      }
      categories = _cachedCatLive || [];
      allItems = _cachedChannels;
      panelTitle.textContent = '📺 Todos os Canais';
    } else if (page === 'movies') {
      catTitle.textContent = '🎬 Filmes';
      panelSearch.placeholder = 'Buscar filmes...';
      if (!_cachedCatMovies) _cachedCatMovies = cacheGet('hp_cache_cat_movies');
      if (!_cachedMovies || !_cachedCatMovies) {
        const [cats, items] = await Promise.all([
          fetchJsonTimeout(api('get_vod_categories')),
          fetchJsonTimeout(api('get_vod_streams'))
        ]);
        _cachedCatMovies = cats || []; _cachedMovies = items || [];
        cacheSet('hp_cache_cat_movies', _cachedCatMovies);
      }
      categories = _cachedCatMovies || [];
      allItems = _cachedMovies;
      panelTitle.textContent = '🎬 Todos os Filmes';
    } else if (page === 'series') {
      catTitle.textContent = '📂 Séries';
      panelSearch.placeholder = 'Buscar séries...';
      if (!_cachedCatSeries) _cachedCatSeries = cacheGet('hp_cache_cat_series');
      if (!_cachedSeries || !_cachedCatSeries) {
        const [cats, items] = await Promise.all([
          fetchJsonTimeout(api('get_series_categories')),
          fetchJsonTimeout(api('get_series'))
        ]);
        _cachedCatSeries = cats || []; _cachedSeries = items || [];
        cacheSet('hp_cache_cat_series', _cachedCatSeries);
      }
      categories = _cachedCatSeries || [];
      allItems = _cachedSeries;
      panelTitle.textContent = '📂 Todas as Séries';
    } else if (page === 'radio') {
      showLoading(false);
      await renderRadioPage();
      return;
    } else if (page === 'games') {
      showLoading(false);
      await renderGamesPage();
      return;
    } else if (page === 'recents') {
      catTitle.textContent = '🕒 Recentes';
      panelTitle.textContent = '🕒 Recentes';
      catList.innerHTML = '';
      allItems = [];
      showLoading(false);
      renderRecentsGrid();
      return;
    } else if (page === 'favorites') {
      catTitle.textContent = '❤ Favoritos';
      panelTitle.textContent = '❤ Favoritos';
      catList.innerHTML = '';
      allItems = [];
      showLoading(false);
      await renderFavoritesGrid();
      return;
    }
    buildCategoryList();
    renderFiltered();
  } catch (err) {
    grid.innerHTML = `<p style="color:#ff5555;padding:2rem">Erro ao carregar: ${err.message}</p>`;
  } finally {
    showLoading(false);
  }
}

// ── HOME PAGE ─────────────────────────────────────────────────────────────────
async function renderHome() {
  grid.style.display = 'block';
  grid.innerHTML = '';
  catList.innerHTML = '';
  panelTitle.textContent = '';

  const [channels, movies, series] = await Promise.all([
    _cachedChannels ? Promise.resolve(_cachedChannels) : fetchJsonTimeout(api('get_live_streams')).then(d => { _cachedChannels = d || []; return _cachedChannels; }),
    _cachedMovies   ? Promise.resolve(_cachedMovies)   : fetchJsonTimeout(api('get_vod_streams')).then(d => { _cachedMovies = d || []; return _cachedMovies; }),
    _cachedSeries   ? Promise.resolve(_cachedSeries)   : fetchJsonTimeout(api('get_series')).then(d => { _cachedSeries = d || []; return _cachedSeries; }),
  ]);

  const html = document.createElement('div');
  html.style.cssText = 'width:100%;';

  const kids = isKidsProfile();

  // Build category maps for kids filtering — load from cache if not in memory
  if (!_cachedCatLive)    _cachedCatLive    = cacheGet('hp_cache_cat_live')    || [];
  if (!_cachedCatMovies)  _cachedCatMovies  = cacheGet('hp_cache_cat_movies')  || [];
  if (!_cachedCatSeries)  _cachedCatSeries  = cacheGet('hp_cache_cat_series')  || [];

  let _catMapMovies = {}, _catMapSeries = {}, _catMapLive = {};
  _cachedCatMovies.forEach(c => { _catMapMovies[c.category_id] = c.category_name; });
  _cachedCatSeries.forEach(c => { _catMapSeries[c.category_id] = c.category_name; });
  _cachedCatLive.forEach(c => { _catMapLive[c.category_id] = c.category_name; });

  // Apply kids filter by category, not title
  const filteredMovies   = kids ? movies.filter(i => isKidsContent(i, _catMapMovies, false, true)) : movies;
  const filteredSeries   = kids ? series.filter(i => isKidsContent(i, _catMapSeries, true)) : series;
  const filteredChannels = kids ? channels.filter(i => isKidsContent(i, _catMapLive, false, false, true)) : channels;

  // Apply max rating filter for non-kids profiles with a limit
  const maxRating = getProfileMaxRating();
  const applyMaxRating = maxRating !== null && !kids;
  const displayMovies   = applyMaxRating ? filteredMovies.filter(i => isAllowedByRating(i))   : filteredMovies;
  const displaySeries   = applyMaxRating ? filteredSeries.filter(i => isAllowedByRating(i))   : filteredSeries;
  const displayChannels = applyMaxRating ? filteredChannels.filter(i => isAllowedByRating(i)) : filteredChannels;

  // Banner — use filtered content
  const bannerPool = kids
    ? [...filteredMovies.slice(0,10), ...filteredSeries.slice(0,10)]
    : [...displayMovies.slice(0,10), ...displaySeries.slice(0,10)];
  const bannerItems = bannerPool.sort(() => Math.random()-0.5);
  _bannerItems = bannerItems;
  _bannerIdx = 0;
  if (bannerItems.length > 0) {
    html.appendChild(buildBanner(bannerItems[0]));
    if (_bannerTimer) clearInterval(_bannerTimer);
    _bannerTimer = setInterval(() => {
      _bannerIdx = (_bannerIdx + 1) % _bannerItems.length;
      const b = document.getElementById('homeBanner');
      if (b) b.replaceWith(buildBanner(_bannerItems[_bannerIdx]));
    }, 8000);
  }

  // Football section — hidden for kids
  if (!kids) {
    const footballSection = document.createElement('div');
    footballSection.id = 'footballSection';
    footballSection.style.cssText = 'margin:0 20px 30px;';
    footballSection.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:15px;">
        <div id="footballTitle" style="font-size:1.2rem;font-weight:700;">CARREGANDO JOGOS...</div>
        <div style="display:flex;align-items:center;gap:8px;">
          <button id="gamesLeft" class="scroll-arrow-btn">‹</button>
          <button id="gamesRight" class="scroll-arrow-btn">›</button>
          <button class="ver-tudo-btn" onclick="setActivePage('games')">VER TUDO ›</button>
        </div>
      </div>
      <div id="gamesScroll" style="overflow-x:auto;overflow-y:visible;white-space:nowrap;padding:8px 4px 12px;"></div>`;
    html.appendChild(footballSection);
  }

  if (displayMovies.length > 0) html.appendChild(buildHorizontalSection('🎬 FILMES RECENTES', displayMovies.slice(0,20), 'movie', () => setActivePage('movies')));
  if (displaySeries.length > 0) html.appendChild(buildHorizontalSection('📂 SÉRIES RECENTES', displaySeries.slice(0,20), 'series', () => setActivePage('series')));

  // Channels section for kids
  if (kids && displayChannels.length > 0) html.appendChild(buildHorizontalSection('📺 CANAIS KIDS', displayChannels.slice(0,20), 'channel', () => setActivePage('live')));

  if (!kids) {
    const radioSection = document.createElement('div');
    radioSection.id = 'radioHomeSection';
    radioSection.style.cssText = 'margin:0 20px 30px;';
    radioSection.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:15px;">
        <div style="font-size:1.2rem;font-weight:700;color:var(--accent-radio);">📻 RÁDIOS POPULARES</div>
        <div style="display:flex;align-items:center;gap:8px;">
          <button id="radioLeft" class="scroll-arrow-btn" style="border-color:var(--accent-radio);color:var(--accent-radio);">‹</button>
          <button id="radioRight" class="scroll-arrow-btn" style="border-color:var(--accent-radio);color:var(--accent-radio);">›</button>
          <button class="ver-tudo-btn" style="color:var(--accent-radio);" onclick="setActivePage('radio')">VER TUDO ›</button>
        </div>
      </div>
      <div id="radioHomeScroll" style="overflow-x:auto;overflow-y:hidden;white-space:nowrap;padding-bottom:8px;"></div>`;
    html.appendChild(radioSection);
  }

  grid.appendChild(html);
  if (!kids) {
    setupScrollArrows('gamesLeft', 'gamesRight', 'gamesScroll');
    setupScrollArrows('radioLeft', 'radioRight', 'radioHomeScroll');
    loadFootballSection();
    loadHomeRadios();
  }
}

function buildBanner(item) {
  const isMovie = !!item.stream_id;
  const title = item.name || item.title || '';
  const img   = item.stream_icon || item.cover || '';
  const year  = isMovie ? getYear(item) : (item.releaseDate || '');
  const rating = item.rating ? `★ ${parseFloat(item.rating).toFixed(1)}` : '★ --';
  const desc  = item.plot || (isMovie ? 'Assista agora este filme incrível!' : 'Assista agora esta série incrível!');
  const cat   = isMovie ? 'FILMES' : 'SÉRIES';

  const el = document.createElement('div');
  el.id = 'homeBanner';
  el.style.cssText = 'position:relative;height:450px;margin:20px 20px 30px;border-radius:12px;overflow:hidden;';
  el.innerHTML = `
    <div style="position:absolute;inset:0;background:url('${escHtml(img)}') center/cover no-repeat;"></div>
    <div style="position:absolute;inset:0;background:linear-gradient(to right,rgba(0,0,0,.85) 40%,transparent 100%);"></div>
    <div style="position:absolute;bottom:40px;left:40px;max-width:550px;">
      <div style="display:inline-block;background:var(--accent-gold);color:#000;font-size:.7rem;font-weight:700;padding:4px 10px;border-radius:4px;margin-bottom:10px;">${cat}</div>
      <div style="font-size:2.5rem;font-weight:700;color:#fff;text-shadow:0 0 20px rgba(0,0,0,.8);margin-bottom:10px;line-height:1.1;">${escHtml(title)}</div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:15px;">
        <span style="background:var(--accent-cyan);color:#000;font-size:.8rem;font-weight:700;padding:3px 8px;border-radius:3px;">${escHtml(rating)}</span>
        <span style="color:#ccc;font-size:.9rem;">${escHtml(year)}</span>
        <span style="background:#e50914;color:#fff;font-size:.75rem;font-weight:700;padding:3px 8px;border-radius:3px;">HD</span>
      </div>
      <div style="color:#ddd;font-size:.9rem;margin-bottom:20px;max-height:80px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;">${escHtml(desc)}</div>
      <div style="display:flex;gap:12px;">
        <button class="banner-play-btn">▶ PLAY</button>
        <button class="banner-info-btn">ⓘ INFO</button>
      </div>
    </div>`;

  el.querySelector('.banner-play-btn').addEventListener('click', () => {
    const it = _bannerItems[_bannerIdx];
    if (!it) return;
    if (it.stream_id) { const ext = it.container_extension || 'mp4'; goPlayer(`${SERVER}/movie/${USER}/${PASS}/${it.stream_id}.${ext}`, it.name, it.stream_id, 'movies'); }
    else openSeries(it);
  });
  el.querySelector('.banner-info-btn').addEventListener('click', () => {
    const it = _bannerItems[_bannerIdx];
    if (!it) return;
    if (it.stream_id) openMovieDetail(it);
    else openSeries(it);
  });
  return el;
}

function buildHorizontalSection(title, items, type, onVerTudo) {
  const sec = document.createElement('div');
  sec.style.cssText = 'margin:0 20px 30px;';
  const color = type === 'movie' ? 'var(--accent-cyan)' : type === 'channel' ? 'var(--accent-gold)' : 'var(--accent-series)';
  const scrollId = `${type}HomeScroll`;
  sec.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:15px;">
      <div style="font-size:1.2rem;font-weight:700;color:${color};">${title}</div>
      <div style="display:flex;align-items:center;gap:8px;">
        <button class="scroll-arrow-btn hs-left" style="border-color:${color};color:${color};">‹</button>
        <button class="scroll-arrow-btn hs-right" style="border-color:${color};color:${color};">›</button>
        <button class="ver-tudo-btn" style="color:${color};">VER TUDO ›</button>
      </div>
    </div>
    <div id="${scrollId}" style="overflow-x:auto;overflow-y:hidden;white-space:nowrap;padding-bottom:8px;scrollbar-width:none;"></div>`;

  sec.querySelector('.ver-tudo-btn').addEventListener('click', onVerTudo);
  const scrollEl = sec.querySelector(`#${scrollId}`);
  items.forEach(item => {
    const card = document.createElement('div');
    card.style.cssText = 'display:inline-block;vertical-align:top;margin-right:12px;';
    card.appendChild(type === 'movie' ? createMovieCard(item) : type === 'channel' ? createChannelCard(item) : createSeriesCard(item));
    scrollEl.appendChild(card);
  });

  sec.querySelector('.hs-left').addEventListener('click', () => scrollEl.scrollBy({ left: -700, behavior: 'smooth' }));
  sec.querySelector('.hs-right').addEventListener('click', () => scrollEl.scrollBy({ left: 700, behavior: 'smooth' }));
  return sec;
}

function setupScrollArrows(leftId, rightId, scrollId) {
  const left = document.getElementById(leftId);
  const right = document.getElementById(rightId);
  const scroll = document.getElementById(scrollId);
  if (!left || !right || !scroll) return;
  left.addEventListener('click', () => scroll.scrollBy({ left: -700, behavior: 'smooth' }));
  right.addEventListener('click', () => scroll.scrollBy({ left: 700, behavior: 'smooth' }));
}

// ── FOOTBALL (ESPN API — sem CORS) ────────────────────────────────────────────
// ESPN league codes
const ESPN_LEAGUES = [
  { code: 'bra.1',                   name: 'Brasileirão Série A' },
  { code: 'bra.2',                   name: 'Brasileirão Série B' },
  { code: 'conmebol.libertadores',   name: 'Copa Libertadores' },
  { code: 'conmebol.sudamericana',   name: 'Copa Sul-Americana' },
  { code: 'eng.1',                   name: 'Premier League' },
  { code: 'uefa.champions_league',   name: 'Champions League' },
  { code: 'esp.1',                   name: 'La Liga' },
  { code: 'ita.1',                   name: 'Serie A' },
  { code: 'ger.1',                   name: 'Bundesliga' },
  { code: 'fra.1',                   name: 'Ligue 1' },
  { code: 'eng.2',                   name: 'Championship' },
];

function convertESPN(event, leagueName) {
  const comp = event.competitions?.[0];
  const home = comp?.competitors?.find(c => c.homeAway === 'home');
  const away = comp?.competitors?.find(c => c.homeAway === 'away');
  const status = event.status?.type?.name || '';
  const isLive = status === 'STATUS_IN_PROGRESS' || status === 'STATUS_HALFTIME';
  const isFinished = status === 'STATUS_FINAL';
  const dateStr = event.date ? new Date(event.date) : null;
  // Convert to BRT (UTC-3)
  const brt = dateStr ? new Date(dateStr.getTime() - 3*3600000) : null;
  const date = brt ? brt.toISOString().slice(0,10) : '';
  const time = brt ? brt.toISOString().slice(11,16) : '';
  return {
    id: event.id || '',
    league: leagueName,
    leagueBadge: '',
    home: home?.team?.shortDisplayName || home?.team?.displayName || '',
    away: away?.team?.shortDisplayName || away?.team?.displayName || '',
    homeBadge: home?.team?.logo || '',
    awayBadge: away?.team?.logo || '',
    date, time, isLive, isFinished,
    homeScore: isLive || isFinished ? parseInt(home?.score ?? -1) : null,
    awayScore: isLive || isFinished ? parseInt(away?.score ?? -1) : null,
  };
}

async function fetchESPNMatches(leagueCode, leagueName) {
  try {
    const data = await fetch(`${ESPN_API}/${leagueCode}/scoreboard`).then(r => r.ok ? r.json() : null);
    return (data?.events || []).map(e => convertESPN(e, leagueName));
  } catch { return []; }
}

async function loadFootballSection() {
  try {
    if (!_cachedFootball) await loadAllFootballEvents();

    // Sort: live first, then upcoming, then finished
    const sorted = [..._cachedFootball].sort((a, b) => {
      const rank = e => e.isLive ? 0 : e.isFinished ? 2 : 1;
      return rank(a) - rank(b) || a.date.localeCompare(b.date) || a.time.localeCompare(b.time);
    });

    const live = sorted.filter(e => e.isLive);
    const upcoming = sorted.filter(e => !e.isLive && !e.isFinished);
    const finished = sorted.filter(e => e.isFinished);

    let events = sorted.slice(0, 30);
    let title = live.length > 0 ? '🔴 AO VIVO AGORA'
      : upcoming.length > 0 ? '⚽ PRÓXIMOS JOGOS'
      : '⚽ JOGOS RECENTES';

    const titleEl = document.getElementById('footballTitle');
    if (titleEl) titleEl.textContent = title;

    const scrollEl = document.getElementById('gamesScroll');
    if (!scrollEl) return;
    scrollEl.innerHTML = '';
    events.forEach(ev => scrollEl.appendChild(buildGameCard(ev)));

    if (_liveTimer) clearInterval(_liveTimer);
    _liveTimer = setInterval(() => {
      _cachedFootball = null;
      if (currentPage === 'home') loadFootballSection();
    }, 60000);
  } catch {
    const titleEl = document.getElementById('footballTitle');
    if (titleEl) titleEl.textContent = 'JOGOS';
  }
}

function isFavTeam(ev) {
  const fav = (getCurrentProfile().favoriteTeam || '').toLowerCase().trim();
  if (!fav) return false;
  return ev.home.toLowerCase().includes(fav) || ev.away.toLowerCase().includes(fav);
}

function buildGameCard(ev) {
  const score = (ev.isLive || ev.isFinished) && ev.homeScore != null ? `${ev.homeScore} - ${ev.awayScore}` : 'VS';
  const statusLabel = ev.isLive ? '🔴 AO VIVO' : ev.isFinished ? 'ENCERRADO' : 'EM BREVE';
  const statusBg = ev.isLive ? '#cc0000' : ev.isFinished ? '#333' : '#1E1E3A';
  const statusColor = ev.isLive ? '#fff' : ev.isFinished ? '#888' : '#00D4FF';
  const favMatch = isFavTeam(ev);
  const borderColor = favMatch ? '#FFB703' : ev.isLive ? '#cc0000' : '#2A2A4A';
  const bgColor = favMatch ? '#1A1500' : '#0D0D1F';

  const teamBadge = (badge, name) => badge
    ? `<img src="${escHtml(badge)}" style="width:52px;height:52px;object-fit:contain;" onerror="this.style.display='none';this.nextSibling.style.display='flex'"><span style="display:none;font-size:.85rem;font-weight:700;color:#fff;">${getInitials(name)}</span>`
    : `<span style="font-size:.85rem;font-weight:700;color:#fff;">${getInitials(name)}</span>`;

  const homeColor = favMatch && ev.home.toLowerCase().includes((getCurrentProfile().favoriteTeam||'').toLowerCase()) ? '#FFB703' : '#00D4FF';
  const awayColor = favMatch && ev.away.toLowerCase().includes((getCurrentProfile().favoriteTeam||'').toLowerCase()) ? '#FFB703' : '#00D4FF';

  const card = document.createElement('div');
  card.style.cssText = `display:inline-block;vertical-align:top;width:220px;height:160px;margin-right:12px;background:${bgColor};border:1px solid ${borderColor};border-radius:14px;padding:10px 12px;cursor:${ev.isLive ? 'pointer' : 'default'};position:relative;flex-shrink:0;transition:border-color .15s,transform .15s;${favMatch ? 'box-shadow:0 0 12px rgba(255,183,3,.4);' : ''}`;
  card.innerHTML = `
    <div style="font-size:.7rem;color:#FFB703;font-weight:700;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:8px;">${favMatch ? '⭐ ' : ''}${escHtml(ev.league)}</div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:10px;">
      <div style="text-align:center;flex:1;">
        <div style="width:56px;height:56px;border-radius:50%;background:#1A1A3A;margin:0 auto 5px;display:flex;align-items:center;justify-content:center;overflow:hidden;">${teamBadge(ev.homeBadge, ev.home)}</div>
        <div style="font-size:.7rem;color:${homeColor};font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:70px;margin:0 auto;">${escHtml(ev.home)}</div>
      </div>
      <div style="text-align:center;min-width:36px;">
        <div style="font-size:1rem;font-weight:700;color:#fff;">${escHtml(score)}</div>
      </div>
      <div style="text-align:center;flex:1;">
        <div style="width:56px;height:56px;border-radius:50%;background:#1A1A3A;margin:0 auto 5px;display:flex;align-items:center;justify-content:center;overflow:hidden;">${teamBadge(ev.awayBadge, ev.away)}</div>
        <div style="font-size:.7rem;color:${awayColor};font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:70px;margin:0 auto;">${escHtml(ev.away)}</div>
      </div>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <div>
        <div style="font-size:.75rem;font-weight:700;color:#aaa;">${ev.time}</div>
        <div style="font-size:.6rem;color:#555;">${ev.date}</div>
      </div>
      <div style="background:${statusBg};color:${statusColor};font-size:.65rem;font-weight:700;padding:4px 10px;border-radius:6px;border:1px solid ${ev.isLive ? '#ff4444' : ev.isFinished ? '#444' : '#2A2A5A'};">${statusLabel}</div>
    </div>`;

  card.addEventListener('mouseenter', () => { card.style.transform = 'translateY(-2px)'; card.style.borderColor = favMatch ? '#FFD700' : ev.isLive ? '#ff4444' : '#FFB703'; });
  card.addEventListener('mouseleave', () => { card.style.transform = ''; card.style.borderColor = borderColor; });
  if (ev.isLive) card.addEventListener('click', () => setActivePage('live'));
  return card;
}

function getTodayBR() {
  const now = new Date();
  const brt = new Date(now.getTime() - 3*3600000);
  return brt.toISOString().slice(0,10);
}
function fmtDate(d) { return d.toISOString().slice(0,10); }
function formatDateBR(s) { const [y,m,d] = s.split('-'); return `${d}/${m}`; }
function getInitials(name) {
  if (!name) return '?';
  const w = name.trim().split(' ').filter(Boolean);
  if (w.length === 1) return w[0].slice(0,2).toUpperCase();
  return (w[0][0] + w[w.length-1][0]).toUpperCase();
}

// ── GAMES PAGE ────────────────────────────────────────────────────────────────
let _allEvents = [], _gamesFilter = 0, _gamesView = 'games';
let _cachedStandings = null;

async function renderGamesPage() {
  panelTitle.textContent = '';
  catTitle.textContent = '⚽ Jogos';
  grid.style.display = 'block';
  grid.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'games-header';
  header.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
      <span style="font-size:1.3rem;font-weight:700;" id="gamesTitleEl">JOGOS DO DIA</span>
      <div style="display:flex;gap:6px;margin-left:auto;flex-wrap:wrap;">
        <button class="gf-btn active" data-f="0">HOJE</button>
        <button class="gf-btn" data-f="1">AMANHÃ</button>
        <button class="gf-btn" data-f="7">SEMANA</button>
        <div style="width:1px;background:#333355;margin:0 4px;"></div>
        <button class="gf-btn" id="btnTabela">🏆 TABELA</button>
      </div>
    </div>`;
  grid.appendChild(header);

  header.querySelectorAll('.gf-btn[data-f]').forEach(btn => {
    btn.addEventListener('click', () => {
      _gamesView = 'games';
      _gamesFilter = parseInt(btn.dataset.f);
      header.querySelectorAll('.gf-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyGamesFilter();
    });
  });
  header.querySelector('#btnTabela').addEventListener('click', async () => {
    _gamesView = 'standings';
    header.querySelectorAll('.gf-btn').forEach(b => b.classList.remove('active'));
    header.querySelector('#btnTabela').classList.add('active');
    document.getElementById('gamesTitleEl').textContent = 'CLASSIFICAÇÃO';
    await renderStandings();
  });

  const body = document.createElement('div');
  body.id = 'gamesBody';
  body.style.cssText = 'padding:0 0 30px;';
  grid.appendChild(body);

  body.innerHTML = '<div class="games-loading">Carregando jogos...</div>';
  try {
    if (!_cachedFootball) await loadAllFootballEvents();
    _allEvents = _cachedFootball || [];
  } catch { _allEvents = []; }

  applyGamesFilter();
}

async function loadAllFootballEvents() {
  const all = [];
  const results = await Promise.allSettled(
    ESPN_LEAGUES.map(l => fetchESPNMatches(l.code, l.name))
  );
  results.forEach(r => { if (r.status === 'fulfilled') all.push(...r.value); });
  _cachedFootball = all;
}

function applyGamesFilter() {
  const body = document.getElementById('gamesBody');
  if (!body) return;
  const titleEl = document.getElementById('gamesTitleEl');

  // Sort all events: live first, then upcoming, then finished
  const rankEv = e => e.isLive ? 0 : e.isFinished ? 2 : 1;
  let filtered = [..._allEvents].sort((a, b) => rankEv(a) - rankEv(b) || a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

  if (_gamesFilter === 0) {
    // HOJE: show live + upcoming first, then recent finished
    const live = filtered.filter(e => e.isLive);
    const upcoming = filtered.filter(e => !e.isLive && !e.isFinished);
    const finished = filtered.filter(e => e.isFinished);
    filtered = [...live, ...upcoming, ...finished].slice(0, 80);
    if (titleEl) titleEl.textContent = live.length > 0 ? '🔴 AO VIVO AGORA' : upcoming.length > 0 ? '⚽ PRÓXIMOS JOGOS' : '⚽ JOGOS RECENTES';
  } else if (_gamesFilter === 1) {
    // AMANHÃ: show next batch after current
    filtered = filtered.filter(e => !e.isLive).slice(0, 60);
    if (titleEl) titleEl.textContent = 'PRÓXIMOS JOGOS';
  } else {
    // SEMANA: all
    filtered = filtered.slice(0, 100);
    if (titleEl) titleEl.textContent = 'TODOS OS JOGOS';
  }

  if (filtered.length === 0) {
    body.innerHTML = '<div style="text-align:center;padding:4rem;color:var(--text-muted);font-size:1.1rem;">😴 Nenhum jogo encontrado</div>';
    return;
  }

  const groups = {};
  filtered.forEach(ev => {
    if (!groups[ev.league]) groups[ev.league] = { badge: ev.leagueBadge, events: [] };
    groups[ev.league].events.push(ev);
  });

  body.innerHTML = '';
  Object.entries(groups).sort((a,b) => {
    // Live leagues first
    const aLive = a[1].events.some(e => e.isLive) ? 0 : 1;
    const bLive = b[1].events.some(e => e.isLive) ? 0 : 1;
    return aLive - bLive || a[0].localeCompare(b[0]);
  }).forEach(([league, g]) => {
    const sec = document.createElement('div');
    sec.className = 'games-league-group';

    const lh = document.createElement('div');
    lh.className = 'games-league-header';
    lh.innerHTML = `
      <div class="games-league-badge">${g.badge && !g.badge.endsWith('.svg') ? `<img src="${escHtml(g.badge)}" onerror="this.style.display='none'">` : `<span>${getInitials(league)}</span>`}</div>
      <div>
        <div style="font-size:.95rem;font-weight:700;">${escHtml(league)}</div>
        <div style="font-size:.75rem;color:var(--accent-gold);">${g.events.length} jogo${g.events.length!==1?'s':''}</div>
      </div>`;
    sec.appendChild(lh);

    const sorted = [...g.events].sort((a,b) => rankEv(a) - rankEv(b) || a.time.localeCompare(b.time));
    sorted.forEach(ev => sec.appendChild(buildFullGameCard(ev)));
    body.appendChild(sec);
  });
}

function buildFullGameCard(ev) {
  const score = (ev.isLive || ev.isFinished) && ev.homeScore != null ? `${ev.homeScore} - ${ev.awayScore}` : 'vs';
  const isLive = ev.isLive, isFinished = ev.isFinished;
  const favMatch = isFavTeam(ev);
  const favTeam = (getCurrentProfile().favoriteTeam || '').toLowerCase();

  const card = document.createElement('div');
  card.className = `game-card${isLive ? ' live' : isFinished ? ' finished' : ''}`;
  if (favMatch) {
    card.style.cssText = 'background:#1A1500;border-color:#FFB703;box-shadow:0 0 12px rgba(255,183,3,.35);';
  }

  const teamBadge = (badge, initials) => badge && !badge.endsWith('.svg')
    ? `<img src="${escHtml(badge)}" onerror="this.style.display='none';this.nextSibling.style.display='flex'"><span style="display:none">${escHtml(initials)}</span>`
    : `<span>${escHtml(initials)}</span>`;

  const homeColor = favMatch && ev.home.toLowerCase().includes(favTeam) ? 'color:#FFB703;font-weight:700;' : '';
  const awayColor = favMatch && ev.away.toLowerCase().includes(favTeam) ? 'color:#FFB703;font-weight:700;' : '';

  card.innerHTML = `
    <div class="gc-team gc-home">
      <div class="gc-badge">${teamBadge(ev.homeBadge, getInitials(ev.home))}</div>
      <span class="gc-name" style="${homeColor}">${favMatch && ev.home.toLowerCase().includes(favTeam) ? '⭐ ' : ''}${escHtml(ev.home)}</span>
    </div>
    <div class="gc-center">
      <div class="gc-score${isLive ? ' gc-score-live' : ''}">${escHtml(score)}</div>
      <div class="gc-status${isLive ? ' live' : isFinished ? ' finished' : ''}">${isLive ? '🔴 AO VIVO' : isFinished ? '✓ ENCERRADO' : 'EM BREVE'}</div>
      <div class="gc-time">${escHtml(ev.time)}</div>
    </div>
    <div class="gc-team gc-away">
      <span class="gc-name" style="${awayColor}">${favMatch && ev.away.toLowerCase().includes(favTeam) ? '⭐ ' : ''}${escHtml(ev.away)}</span>
      <div class="gc-badge">${teamBadge(ev.awayBadge, getInitials(ev.away))}</div>
    </div>`;

  if (isLive) { card.style.cursor = 'pointer'; card.addEventListener('click', () => setActivePage('live')); }
  return card;
}

async function renderStandings() {
  const body = document.getElementById('gamesBody');
  if (!body) return;
  body.innerHTML = '<div class="games-loading">Carregando classificação...</div>';

  try {
    if (!_cachedStandings) {
      const LEAGUES = [
        { code: 'bra.1', name: 'Brasileirão Série A' },
        { code: 'eng.1', name: 'Premier League' },
        { code: 'esp.1', name: 'La Liga' },
        { code: 'ita.1', name: 'Serie A' },
        { code: 'ger.1', name: 'Bundesliga' },
        { code: 'fra.1', name: 'Ligue 1' },
        { code: 'por.1', name: 'Primeira Liga' },
        { code: 'ned.1', name: 'Eredivisie' },
        { code: 'uefa.champions_league', name: 'UEFA Champions League' },
        { code: 'conmebol.libertadores', name: 'Copa Libertadores' },
      ];
      const results = await Promise.allSettled(
        LEAGUES.map(l => fetch(`https://site.api.espn.com/apis/v2/sports/soccer/${l.code}/standings`).then(r => r.ok ? r.json() : null).catch(() => null).then(d => ({ ...l, data: d })))
      );
      _cachedStandings = results.filter(r => r.status === 'fulfilled' && r.value?.data).map(r => r.value);
    }

    body.innerHTML = '';
    _cachedStandings.forEach(({ name, data }) => {
      const entries = data?.children?.[0]?.standings?.entries;
      if (!entries?.length) return;

      const sec = document.createElement('div');
      sec.className = 'standings-section';
      const safeId = name.replace(/\s/g,'_').replace(/[^a-zA-Z0-9_]/g,'');
      sec.innerHTML = `<div class="standings-league-title">${escHtml(name)}</div>
        <table class="standings-table">
          <thead><tr><th>#</th><th>Time</th><th>J</th><th>V</th><th>E</th><th>D</th><th>SG</th><th>Pts</th></tr></thead>
          <tbody id="st_${safeId}"></tbody>
        </table>`;
      body.appendChild(sec);

      const tbody = sec.querySelector('tbody');
      const favTeam = (getCurrentProfile().favoriteTeam || '').toLowerCase().trim();
      entries.forEach((e, i) => {
        const getStat = n => e.stats?.find(s => s.name === n)?.value ?? 0;
        const team = e.team?.shortDisplayName || e.team?.displayName || '';
        const logo = e.team?.logos?.[0]?.href || '';
        const isFav = favTeam && team.toLowerCase().includes(favTeam);
        const tr = document.createElement('tr');
        if (isFav) tr.style.cssText = 'background:#1A1500;outline:1px solid #FFB703;';
        tr.innerHTML = `
          <td>${i+1}</td>
          <td><div style="display:flex;align-items:center;gap:8px;">${logo ? `<img src="${escHtml(logo)}" style="width:20px;height:20px;object-fit:contain;" onerror="this.style.display='none'">` : ''}<span style="${isFav ? 'color:#FFB703;font-weight:700;' : ''}">${isFav ? '⭐ ' : ''}${escHtml(team)}</span></div></td>
          <td>${getStat('gamesPlayed')}</td>
          <td>${getStat('wins')}</td>
          <td>${getStat('ties')}</td>
          <td>${getStat('losses')}</td>
          <td>${getStat('pointDifferential') >= 0 ? '+' : ''}${getStat('pointDifferential')}</td>
          <td style="font-weight:700;color:${isFav ? '#FFB703' : 'var(--accent-gold)'};">${getStat('points')}</td>`;
        tbody.appendChild(tr);
      });
    });
  } catch {
    body.innerHTML = '<div style="color:#ff5555;padding:2rem">Erro ao carregar classificação.</div>';
  }
}

// ── RADIO PAGE ────────────────────────────────────────────────────────────────
async function renderRadioPage() {
  catTitle.textContent = '📻 Rádios';
  panelTitle.textContent = '📻 Rádios';
  panelSearch.placeholder = 'Buscar rádios...';
  grid.style.display = 'flex';
  grid.style.flexWrap = 'wrap';
  grid.style.alignItems = 'flex-start';

  catList.innerHTML = '';
  RADIO_CATS.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = `cat-btn radio${cat.key === _radioCat ? ' active' : ''}`;
    btn.textContent = cat.label;
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _radioCat = cat.key;
      panelTitle.textContent = cat.label;
      await loadRadioCategory(cat);
    });
    catList.appendChild(btn);
  });

  const activeCat = RADIO_CATS.find(c => c.key === _radioCat) || RADIO_CATS[0];
  panelTitle.textContent = activeCat.label;
  await loadRadioCategory(activeCat);
}

async function loadRadioCategory(cat) {
  showLoading(true, 'radio');
  grid.innerHTML = '';
  grid.style.display = 'flex';
  grid.style.flexWrap = 'wrap';
  grid.style.alignItems = 'flex-start';
  renderOffset = 0;

  if (cat.key === 'favorites') {
    _radioStations = Object.keys(favorites)
      .filter(k => favorites[k] === 'radio')
      .map(k => ({ stationuuid: k.replace('radio_',''), name: k, url_resolved: '', favicon: '' }));
    _radioFiltered = _radioStations;
    showLoading(false);
    renderRadioGrid();
    return;
  }

  try {
    let url;
    if (cat.query === 'top') {
      url = `${RADIO_API}/json/stations?limit=200&hidebroken=true&order=clickcount&reverse=true`;
    } else if (cat.query.startsWith('country/')) {
      url = `${RADIO_API}/json/stations/bycountry/${cat.query.slice(8)}?limit=300&hidebroken=true&order=clickcount&reverse=true`;
    } else if (cat.query.startsWith('tag/')) {
      url = `${RADIO_API}/json/stations/bytag/${cat.query.slice(4)}?limit=200&hidebroken=true&order=clickcount&reverse=true`;
    } else {
      url = `${RADIO_API}/json/stations/search?name=${encodeURIComponent(cat.query)}&limit=200&hidebroken=true`;
    }
    const data = await fetch(proxyUrl(url), { headers: { 'User-Agent': 'HuskyPlay/1.0' } }).then(r => r.json());
    _radioStations = data || [];
    _radioFiltered = _radioStations;
    if (cat.key === 'brasil') _cachedRadio = _radioStations;
  } catch {
    _radioStations = [];
    _radioFiltered = [];
  }

  showLoading(false);
  renderRadioGrid();
}

function filterRadio(q) {
  _radioFiltered = q ? _radioStations.filter(s => (s.name||'').toLowerCase().includes(q.toLowerCase())) : _radioStations;
  renderOffset = 0;
  // Don't wipe the grid if the radio player is currently open
  if (grid.querySelector('#rpAudioEl')) return;
  grid.innerHTML = '';
  renderRadioGrid();
}

function renderRadioGrid() {
  const items = _radioFiltered;
  // Remove any existing "empty" message before checking
  const emptyEl = grid.querySelector('.radio-empty');
  if (emptyEl) emptyEl.remove();

  if (items.length === 0) {
    // Only show empty if not currently loading
    if (!grid.querySelector('.loading-spinner')) {
      const p = document.createElement('p');
      p.className = 'radio-empty';
      p.style.cssText = 'color:var(--text-muted);padding:2rem;width:100%;';
      p.textContent = 'Nenhuma rádio encontrada.';
      grid.appendChild(p);
    }
    return;
  }
  const end = Math.min(renderOffset + BATCH, items.length);
  const frag = document.createDocumentFragment();
  for (let i = renderOffset; i < end; i++) frag.appendChild(createRadioCard(items[i]));
  renderOffset = end;
  const existingLM = grid.querySelector('.card-load-more');
  if (existingLM) existingLM.remove();
  grid.appendChild(frag);
  if (renderOffset < items.length) {
    const lm = document.createElement('div');
    lm.className = 'card-load-more radio';
    lm.style.cssText = 'width:155px;height:155px;';
    lm.innerHTML = `<div class="lm-icon" style="color:var(--accent-radio);">⬇</div><div class="lm-text">CARREGAR<br>MAIS</div>`;
    lm.addEventListener('click', renderRadioGrid);
    grid.appendChild(lm);
  }
}

function createRadioCard(station) {
  const favId = 'radio_' + station.stationuuid;
  const isFav = !!favorites[favId];
  const tags = (station.tags || '').split(',').filter(Boolean).slice(0,3).join(', ');

  const card = document.createElement('div');
  card.className = 'card-radio';

  card.innerHTML = `
    <div class="cr-img-wrap">
      ${station.bitrate > 0 ? `<div class="cr-bitrate">${station.bitrate}kbps</div>` : ''}
      <img loading="lazy" src="${escHtml(station.favicon||'')}" alt="${escHtml(station.name||'')}" onerror="this.style.display='none'"/>
      <button class="cr-fav" data-fav="${escHtml(favId)}">${isFav ? '♥' : '♡'}</button>
    </div>
    <div class="cr-footer">
      <div class="cr-name">${escHtml(station.name||'')}</div>
      ${tags ? `<div class="cr-tags">${escHtml(tags)}</div>` : ''}
    </div>`;

  const fb = card.querySelector('.cr-fav');
  fb.style.color = isFav ? '#ff1744' : '#cc0000';
  fb.addEventListener('click', e => {
    e.stopPropagation();
    if (favorites[favId]) { delete favorites[favId]; fb.innerHTML = '♡'; fb.style.color = '#cc0000'; }
    else { favorites[favId] = 'radio'; fb.innerHTML = '♥'; fb.style.color = '#ff1744'; }
    localStorage.setItem(profileKey('hp_favs'), JSON.stringify(favorites));
  });

  card.addEventListener('click', () => openRadioPlayer(station));
  return card;
}

function openRadioPlayer(station) {
  if (!station.url_resolved) return;
  fetch(proxyUrl(`${RADIO_API}/json/url/${station.stationuuid}`), { headers: { 'User-Agent': 'HuskyPlay/1.0' } }).catch(() => {});
  addRecent(station.stationuuid, station.name, 'radio', station.favicon);

  // Stop any existing audio
  const existingAudio = document.getElementById('rpAudioEl');
  if (existingAudio) { existingAudio.pause(); existingAudio.src = ''; existingAudio.remove(); }

  const favId = 'radio_' + station.stationuuid;
  const isFav = !!favorites[favId];
  const tags = (station.tags || '').split(',').filter(Boolean).slice(0, 5).join(' • ');
  const bitrate = station.bitrate > 0 ? `${station.bitrate} kbps` : '—';
  const codec = (station.codec || '—').toUpperCase();
  const country = station.country || '—';
  const language = station.language || '—';
  const votes = station.votes != null ? station.votes.toLocaleString() : '—';
  const clicks = station.clickcount != null ? station.clickcount.toLocaleString() : '—';

  // Render inside the main panel grid (keeps sidebar/topbar visible)
  grid.style.display = 'block';
  // Hide search bar while player is open
  const panelSearchWrap = document.querySelector('.panel-search');
  if (panelSearchWrap) panelSearchWrap.style.display = 'none';
  panelSearch.value = '';
  clearSearch.classList.add('hidden');
  grid.innerHTML = `
    <div style="padding:16px 20px 30px;max-width:820px;">
      <button id="rpBack" style="background:transparent;border:none;color:var(--accent-radio);font-size:.85rem;cursor:pointer;display:inline-flex;align-items:center;gap:5px;margin-bottom:16px;padding:5px 10px;border-radius:6px;">← Voltar</button>

      <div style="display:flex;gap:20px;align-items:flex-start;">

        <!-- LEFT col -->
        <div style="flex-shrink:0;width:220px;">
          <!-- Cover -->
          <div style="width:220px;height:220px;border-radius:12px;background:#111;overflow:hidden;position:relative;box-shadow:0 0 24px rgba(0,200,83,.35);">
            <span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:56px;opacity:.12;">📻</span>
            <img id="rpCoverImg" src="${escHtml(station.favicon||'')}" style="width:100%;height:100%;object-fit:contain;position:relative;z-index:1;" onerror="this.style.display='none'"/>
            <div id="rpEqualizer" style="position:absolute;bottom:8px;left:50%;transform:translateX(-50%);display:none;align-items:flex-end;gap:3px;height:28px;">
              ${[10,22,34,14,26,10,20].map((h,i)=>`<div style="width:5px;height:${h}px;background:var(--accent-radio);border-radius:2px;animation:rpEq${i+1} ${0.38+i*0.07}s ease-in-out infinite alternate;"></div>`).join('')}
            </div>
          </div>

          <!-- Controls -->
          <div style="background:#141428;border-radius:12px;padding:12px 14px;margin-top:10px;">
            <div id="rpStatusBar" style="display:none;background:#0A2A0A;border-radius:6px;padding:5px 8px;margin-bottom:10px;text-align:center;">
              <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--accent-radio);margin-right:5px;animation:pulse 1s infinite;vertical-align:middle;"></span>
              <span style="font-size:.72rem;font-weight:700;color:var(--accent-radio);">AO VIVO</span>
            </div>
            <button id="rpPlayBtn" style="width:100%;height:38px;background:var(--accent-radio);border:none;border-radius:19px;color:#000;font-size:.85rem;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;box-shadow:0 0 14px rgba(0,200,83,.5);">
              <span id="rpPlayIcon">▶</span><span id="rpPlayText">OUVIR</span>
            </button>
            <div style="display:flex;gap:6px;margin-top:7px;">
              <button id="rpPrev" style="flex:1;height:30px;background:#1A1A2E;border:1px solid #333;border-radius:15px;color:#aaa;font-size:.75rem;cursor:pointer;">◀ Ant.</button>
              <button id="rpNext" style="flex:1;height:30px;background:#1A1A2E;border:1px solid #333;border-radius:15px;color:#aaa;font-size:.75rem;cursor:pointer;">Próx. ▶</button>
            </div>
            <button id="rpFav" style="width:100%;height:30px;background:transparent;border:1px solid #333;border-radius:15px;color:#aaa;font-size:.8rem;cursor:pointer;margin-top:7px;display:flex;align-items:center;justify-content:center;gap:5px;">
              <span id="rpFavIcon" style="color:#ff1744;">${isFav?'♥':'♡'}</span>
              <span id="rpFavText">${isFav?'Favoritado':'Favoritar'}</span>
            </button>
            <div style="display:flex;align-items:center;gap:6px;margin-top:8px;">
              <span id="rpVolIcon" style="font-size:.8rem;flex-shrink:0;">🔊</span>
              <input id="rpVolSlider" type="range" min="0" max="1" step="0.05" value="1" style="flex:1;min-width:0;accent-color:var(--accent-radio);cursor:pointer;">
              <span id="rpVolLabel" style="font-size:.72rem;color:#aaa;width:30px;text-align:right;flex-shrink:0;">100%</span>
            </div>
          </div>
        </div>

        <!-- RIGHT col -->
        <div style="flex:1;min-width:0;">
          <div style="font-size:1.5rem;font-weight:700;color:#fff;line-height:1.2;margin-bottom:6px;word-break:break-word;">${escHtml(station.name||'')}</div>
          ${tags ? `<div style="font-size:.85rem;color:var(--accent-radio);margin-bottom:14px;">${escHtml(tags)}</div>` : '<div style="margin-bottom:14px;"></div>'}
          <div style="height:1px;background:#1E1E2E;margin-bottom:14px;"></div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:14px;">
            ${[['QUALIDADE',bitrate],['FORMATO',codec],['PAÍS',country],['IDIOMA',language],['VOTOS',votes,'#FFB703'],['POPULARIDADE',clicks,'#FFB703']]
              .map(([l,v,c])=>`<div style="background:#141428;border-radius:8px;padding:9px 12px;"><div style="font-size:.58rem;font-weight:700;color:#555;margin-bottom:2px;">${l}</div><div style="font-size:.95rem;font-weight:700;color:${c||'#fff'};">${escHtml(String(v))}</div></div>`).join('')}
          </div>

          <div style="height:1px;background:#1E1E2E;margin-bottom:12px;"></div>

          <div id="rpNowPlaying" style="background:#0D1F0D;border-radius:10px;padding:12px 16px;display:none;">
            <div style="font-size:.6rem;font-weight:700;color:#555;letter-spacing:.08em;margin-bottom:10px;">TOCANDO AGORA</div>
            <div style="display:flex;align-items:center;gap:12px;">
              <div style="width:52px;height:52px;border-radius:8px;background:#111;overflow:hidden;flex-shrink:0;position:relative;">
                <img id="rpAlbumArt" src="" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'"/>
                <div style="position:absolute;bottom:3px;left:50%;transform:translateX(-50%);display:flex;align-items:flex-end;gap:2px;height:16px;">
                  ${[6,12,18,9,14].map((h,i)=>`<div style="width:3px;height:${h}px;background:var(--accent-radio);border-radius:2px;animation:rpEq${i+1} ${0.38+i*0.07}s ease-in-out infinite alternate;"></div>`).join('')}
                </div>
              </div>
              <div style="flex:1;min-width:0;">
                <div id="rpNowTitle" style="font-size:.9rem;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(station.name||'')}</div>
                ${tags?`<div style="font-size:.75rem;color:var(--accent-radio);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(tags)}</div>`:''}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <audio id="rpAudioEl" style="display:none;"></audio>
    <style>
      @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
      @keyframes rpEq1{0%{height:10px}100%{height:26px}}
      @keyframes rpEq2{0%{height:20px}100%{height:7px}}
      @keyframes rpEq3{0%{height:34px}100%{height:12px}}
      @keyframes rpEq4{0%{height:14px}100%{height:30px}}
      @keyframes rpEq5{0%{height:26px}100%{height:9px}}
      @keyframes rpEq6{0%{height:10px}100%{height:28px}}
      @keyframes rpEq7{0%{height:20px}100%{height:6px}}
      #rpBack:hover{background:rgba(0,200,83,.1);}
      #rpPrev:hover,#rpNext:hover{border-color:var(--accent-radio);color:#fff;}
      #rpFav:hover{border-color:#ff1744;}
      #rpPlayBtn:hover{opacity:.85;}
    </style>`;

  const audio = grid.querySelector('#rpAudioEl');
  const playBtn = grid.querySelector('#rpPlayBtn');
  const playIcon = grid.querySelector('#rpPlayIcon');
  const playText = grid.querySelector('#rpPlayText');
  const statusBar = grid.querySelector('#rpStatusBar');
  const equalizer = grid.querySelector('#rpEqualizer');
  const nowPlaying = grid.querySelector('#rpNowPlaying');
  const volSlider = grid.querySelector('#rpVolSlider');
  const volLabel = grid.querySelector('#rpVolLabel');
  const volIcon = grid.querySelector('#rpVolIcon');
  const favBtn2 = grid.querySelector('#rpFav');
  const favIcon2 = grid.querySelector('#rpFavIcon');
  const favText2 = grid.querySelector('#rpFavText');

  let isPlaying = false;
  let currentStation = station;

  const savedVol = parseFloat(localStorage.getItem('hp_vol') ?? '1');
  audio.volume = savedVol;
  volSlider.value = savedVol;
  volLabel.textContent = Math.round(savedVol * 100) + '%';
  volSlider.addEventListener('input', () => {
    audio.volume = parseFloat(volSlider.value);
    volLabel.textContent = Math.round(parseFloat(volSlider.value) * 100) + '%';
    volIcon.textContent = parseFloat(volSlider.value) === 0 ? '🔇' : '🔊';
    localStorage.setItem('hp_vol', volSlider.value);
  });

  function setPlaying(playing) {
    isPlaying = playing;
    playIcon.textContent = playing ? '■' : '▶';
    playText.textContent = playing ? 'PARAR' : 'OUVIR';
    playBtn.style.background = playing ? '#cc0000' : 'var(--accent-radio)';
    playBtn.style.boxShadow = playing ? '0 0 14px rgba(204,0,0,.5)' : '0 0 14px rgba(0,200,83,.5)';
    statusBar.style.display = playing ? 'block' : 'none';
    equalizer.style.display = playing ? 'flex' : 'none';
    nowPlaying.style.display = playing ? 'block' : 'none';
  }

  function loadStation(s) {
    currentStation = s;
    audio.src = s.url_resolved || '';
    audio.load();
    audio.play().catch(() => {});
    setPlaying(true);
    const img = grid.querySelector('#rpCoverImg');
    if (img) { img.style.display = ''; img.src = s.favicon || ''; }
    const nt = grid.querySelector('#rpNowTitle');
    if (nt) nt.textContent = s.name || '';
    addRecent(s.stationuuid, s.name, 'radio', s.favicon);
    fetch(proxyUrl(`${RADIO_API}/json/url/${s.stationuuid}`), { headers: { 'User-Agent': 'HuskyPlay/1.0' } }).catch(() => {});
  }

  loadStation(station);

  playBtn.addEventListener('click', () => {
    if (isPlaying) { audio.pause(); audio.src = ''; setPlaying(false); }
    else loadStation(currentStation);
  });

  const getStationList = () => _radioFiltered.length > 0 ? _radioFiltered : _radioStations;
  grid.querySelector('#rpPrev').addEventListener('click', () => {
    const list = getStationList();
    const idx = list.findIndex(s => s.stationuuid === currentStation.stationuuid);
    const prev = list[idx > 0 ? idx - 1 : list.length - 1];
    if (prev) loadStation(prev);
  });
  grid.querySelector('#rpNext').addEventListener('click', () => {
    const list = getStationList();
    const idx = list.findIndex(s => s.stationuuid === currentStation.stationuuid);
    const next = list[idx < list.length - 1 ? idx + 1 : 0];
    if (next) loadStation(next);
  });

  favBtn2.addEventListener('click', () => {
    const fid = 'radio_' + currentStation.stationuuid;
    if (favorites[fid]) { delete favorites[fid]; favIcon2.textContent = '♡'; favText2.textContent = 'Favoritar'; }
    else { favorites[fid] = 'radio'; favIcon2.textContent = '♥'; favText2.textContent = 'Favoritado'; }
    localStorage.setItem(profileKey('hp_favs'), JSON.stringify(favorites));
  });

  grid.querySelector('#rpBack').addEventListener('click', () => {
    audio.pause(); audio.src = '';
    // Restore search bar
    const psw = document.querySelector('.panel-search');
    if (psw) psw.style.display = '';
    renderRadioPage();
  });
}

async function loadHomeRadios() {
  try {
    const stations = _cachedRadio
      ? _cachedRadio.slice(0,20)
      : await fetch(proxyUrl(`${RADIO_API}/json/stations/bycountry/brazil?limit=20&hidebroken=true&order=clickcount&reverse=true`), { headers: { 'User-Agent': 'HuskyPlay/1.0' } }).then(r => r.json());
    if (!_cachedRadio) _cachedRadio = stations;
    const scrollEl = document.getElementById('radioHomeScroll');
    if (!scrollEl) return;
    scrollEl.innerHTML = '';
    (stations || []).forEach(s => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:inline-block;vertical-align:top;margin-right:12px;';
      wrap.appendChild(createRadioCard(s));
      scrollEl.appendChild(wrap);
    });
  } catch {}
}

// ── Categories ────────────────────────────────────────────────────────────────
function buildCategoryList() {
  catList.innerHTML = '';
  const type = currentPage;

  const addCat = (id, label) => {
    const btn = document.createElement('button');
    btn.className = `cat-btn ${type}${id === currentCat ? ' active' : ''}`;
    btn.textContent = label;
    btn.title = label;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentCat = id;
      panelTitle.textContent = label;
      renderOffset = 0;
      renderFiltered();
    });
    catList.appendChild(btn);
  };

  if (type === 'live')   { addCat('all', '📺 Todos os Canais'); addCat('favorites', '❤ Favoritos'); }
  if (type === 'movies') { addCat('all', '🎬 Todos os Filmes'); addCat('continue', '▶ Continuar Assistindo'); addCat('favorites', '❤ Favoritos'); }
  if (type === 'series') { addCat('all', '📂 Todas as Séries'); addCat('continue', '▶ Continuar Assistindo'); addCat('favorites', '❤ Favoritos'); }

  const kids = isKidsProfile();
  // Build category map for kids filtering
  const catMap = {};
  categories.forEach(c => { catMap[c.category_id] = c.category_name; });

  // Kids mode: show ALL categories but content inside each will be filtered
  // Only show categories that actually have kids content
  let visibleCats = kids
    ? categories.filter(cat => {
        // For series: also show platform categories (Netflix, HBO, etc.) — content filtered by rating
        if (currentPage === 'series' && isKidsVisibleSeriesCat(cat.category_name)) return true;
        // For movies: same logic
        if (currentPage === 'movies' && isKidsVisibleMovieCat(cat.category_name)) return true;
        // For live: always show "Canais 24 Horas" category — handled by isKidsContent isLive flag
        // Show category if it has at least one kids item
        return allItems.some(i => i.category_id == cat.category_id && isKidsContent(i, catMap, currentPage === 'series', currentPage === 'movies', currentPage === 'live'));
      })
    : categories;

  // For live TV: pin "24 horas" categories to the top
  if (type === 'live') {
    const is24h = c => (c.category_name || '').toLowerCase().includes('24');
    visibleCats = [
      ...visibleCats.filter(c => is24h(c)),
      ...visibleCats.filter(c => !is24h(c)),
    ];
  }

  visibleCats.forEach(cat => addCat(cat.category_id, cat.category_name));
}

// ── Filtering ─────────────────────────────────────────────────────────────────
function getFilteredItems() {
  let items = allItems;

  // Kids mode: only show kids content (by category, not title)
  if (isKidsProfile()) {
    const catMap = {};
    categories.forEach(c => { catMap[c.category_id] = c.category_name; });
    items = items.filter(i => isKidsContent(i, catMap, currentPage === 'series', currentPage === 'movies', currentPage === 'live'));
  }

  // Max rating filter (applies to all profiles with a limit set)
  if (getProfileMaxRating() !== null && !isKidsProfile()) {
    items = items.filter(i => isAllowedByRating(i));
  }

  if (currentCat === 'continue') {
    items = items.filter(i => { const p = watchProgress[`${currentPage}_${i.stream_id || i.series_id}`]; return p && p > 0 && p < 95; });
  } else if (currentCat === 'favorites') {
    items = items.filter(i => favorites[String(i.stream_id || i.series_id)]);
  } else if (currentCat !== 'all') {
    items = items.filter(i => i.category_id == currentCat);
  }

  // For live "Todos os Canais": push 24h channels to the end
  if (currentPage === 'live' && currentCat === 'all') {
    const catMap = {};
    categories.forEach(c => { catMap[c.category_id] = c.category_name; });
    const is24h = i => isKidsVisibleLiveCat(catMap[i.category_id] || '');
    items = [...items.filter(i => !is24h(i)), ...items.filter(i => is24h(i))];
  }
  const q = panelSearch.value.trim().toLowerCase();
  if (q) {
    const words = q.split(' ').filter(Boolean);
    items = items.filter(i => { const n = (i.name || i.title || '').toLowerCase(); return words.every(w => n.includes(w)); });
  }
  return items;
}

function renderFiltered() {
  grid.style.display = 'flex';
  grid.style.flexWrap = 'wrap';
  grid.innerHTML = '';
  renderOffset = 0;
  loadMoreItems();
}

function loadMoreItems() {
  if (currentPage === 'radio') { renderRadioGrid(); return; }
  if (currentPage === 'recents' || currentPage === 'favorites' || currentPage === 'home' || currentPage === 'games') return;
  const items = getFilteredItems();
  if (renderOffset >= items.length) return;

  const frag = document.createDocumentFragment();
  const end  = Math.min(renderOffset + BATCH, items.length);
  for (let i = renderOffset; i < end; i++) frag.appendChild(createCard(items[i]));
  renderOffset = end;

  const existingLM = grid.querySelector('.card-load-more');
  if (existingLM) existingLM.remove();
  grid.appendChild(frag);

  if (renderOffset < items.length) grid.appendChild(createLoadMoreCard());
}

// ── Card creation ─────────────────────────────────────────────────────────────
function createCard(item) {
  if (currentPage === 'live') return createChannelCard(item);
  if (currentPage === 'movies') return createMovieCard(item);
  if (currentPage === 'series') return createSeriesCard(item);
  return createChannelCard(item);
}

function imgEl(src, alt) {
  const img = document.createElement('img');
  img.loading = 'lazy'; img.alt = alt || ''; img.src = src || '';
  img.onerror = () => { img.style.display = 'none'; };
  return img;
}

function favBtn(id, type) {
  const btn = document.createElement('button');
  btn.className = 'fav-btn';
  btn.innerHTML = favorites[String(id)] ? '♥' : '♡';
  btn.style.color = favorites[String(id)] ? '#ff1744' : '#cc0000';
  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (favorites[String(id)]) { delete favorites[String(id)]; btn.innerHTML = '♡'; btn.style.color = '#cc0000'; }
    else { favorites[String(id)] = type; btn.innerHTML = '♥'; btn.style.color = '#ff1744'; }
    localStorage.setItem(profileKey('hp_favs'), JSON.stringify(favorites));
  });
  return btn;
}

function createChannelCard(item) {
  const card = document.createElement('div');
  card.className = 'card-channel';
  const wrap = document.createElement('div');
  wrap.className = 'card-img-wrap';
  wrap.appendChild(imgEl(item.stream_icon, item.name));
  wrap.appendChild(favBtn(item.stream_id, 'channel'));
  const footer = document.createElement('div');
  footer.className = 'card-footer';
  const name = document.createElement('div');
  name.className = 'card-name';
  name.textContent = item.name || '';
  footer.appendChild(name);
  card.appendChild(wrap);
  card.appendChild(footer);
  card.addEventListener('click', () => {
    addRecent(item.stream_id, item.name, 'channel', item.stream_icon);
    openChannelDetail(item);
  });
  return card;
}

function openChannelDetail(item) {
  const overlay = document.createElement('div');
  overlay.className = 'detail-overlay';
  overlay.id = 'channelDetailOverlay';

  const isFav = !!favorites[String(item.stream_id)];
  overlay.innerHTML = `
    <div class="detail-page" style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:40px 20px;">
      <button class="detail-back" id="chBack" style="position:absolute;top:20px;left:20px;">← Voltar</button>
      <div style="width:180px;height:180px;background:#1a1a2e;border-radius:16px;display:flex;align-items:center;justify-content:center;overflow:hidden;margin-bottom:24px;box-shadow:0 8px 30px rgba(0,0,0,.7);">
        <img src="${escHtml(item.stream_icon||'')}" style="max-width:160px;max-height:160px;object-fit:contain;" onerror="this.style.display='none'"/>
      </div>
      <div style="display:inline-flex;align-items:center;gap:6px;background:#1a0a0a;border:1px solid #cc0000;border-radius:20px;padding:4px 14px;margin-bottom:16px;">
        <span style="width:8px;height:8px;border-radius:50%;background:#ff3333;display:inline-block;animation:pulse 1s infinite;"></span>
        <span style="font-size:.8rem;font-weight:700;color:#ff5555;">NO AR</span>
      </div>
      <h1 style="font-size:2rem;font-weight:700;color:#fff;margin-bottom:32px;max-width:600px;">${escHtml(item.name||'')}</h1>
      <div style="display:flex;gap:14px;align-items:center;justify-content:center;">
        <button id="chPlay" style="background:var(--accent-gold);color:#000;border:none;padding:14px 36px;border-radius:8px;font-size:1.1rem;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:8px;">▶ ASSISTIR</button>
        <button id="chFav" style="background:${isFav?'#cc0000':'#2a2a2a'};color:#fff;border:none;width:52px;height:52px;border-radius:8px;font-size:1.4rem;cursor:pointer;">${isFav?'♥':'♡'}</button>
      </div>
    </div>
    <style>@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}</style>`;

  document.body.appendChild(overlay);
  overlay.querySelector('#chBack').addEventListener('click', () => overlay.remove());

  const favBtnEl = overlay.querySelector('#chFav');
  favBtnEl.addEventListener('click', () => {
    if (favorites[String(item.stream_id)]) {
      delete favorites[String(item.stream_id)];
      favBtnEl.innerHTML = '♡'; favBtnEl.style.background = '#2a2a2a';
    } else {
      favorites[String(item.stream_id)] = 'channel';
      favBtnEl.innerHTML = '♥'; favBtnEl.style.background = '#cc0000';
    }
    localStorage.setItem(profileKey('hp_favs'), JSON.stringify(favorites));
  });

  overlay.querySelector('#chPlay').addEventListener('click', () => {
    overlay.remove();
    openInlinePlayer(`${SERVER}/live/${USER}/${PASS}/${item.stream_id}.m3u8`, item.name, item.stream_id, 'live');
  });
}

function openInlinePlayer(url, title, id, type) {
  // Collect channel list from cache for the sidebar — apply kids filter if needed
  let channels = _cachedChannels || [];
  if (isKidsProfile() && _cachedCatLive) {
    const catMap = {};
    _cachedCatLive.forEach(c => { catMap[c.category_id] = c.category_name; });
    channels = channels.filter(i => isKidsContent(i, catMap, false, false, true));
  }

  const overlay = document.createElement('div');
  overlay.id = 'inlinePlayerOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:#0a0a0a;z-index:400;display:flex;overflow:hidden;';

  overlay.innerHTML = `
    <!-- LEFT: video + EPG -->
    <div style="display:flex;flex-direction:column;flex:1;min-width:0;background:#000;">
      <!-- topbar -->
      <div style="height:44px;background:#111;display:flex;align-items:center;padding:0 12px;gap:10px;flex-shrink:0;border-bottom:1px solid #222;">
        <button id="ipBack" style="background:#2a2a2a;color:#fff;border:none;padding:5px 14px;border-radius:6px;font-size:.85rem;cursor:pointer;">← VOLTAR</button>
        <div style="flex:1;text-align:center;font-size:.95rem;font-weight:700;color:#fff;" id="ipTitle">${escHtml(title)}</div>
        <span style="font-size:.7rem;font-weight:700;color:#ff4444;background:#1a0000;border:1px solid #cc0000;border-radius:12px;padding:3px 10px;" id="ipStatus">● AO VIVO</span>
      </div>
      <!-- video -->
      <div style="flex:1;position:relative;background:#000;overflow:hidden;">
        <video id="ipVid" autoplay playsinline style="width:100%;height:100%;object-fit:contain;display:block;"></video>
        <div id="ipSpinner" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);">
          <div style="width:48px;height:48px;border:4px solid #333;border-top-color:var(--accent-gold);border-radius:50%;animation:spin .8s linear infinite;"></div>
        </div>
      </div>
      <!-- controls bar -->
      <div style="height:56px;background:#111;border-top:1px solid #222;display:flex;align-items:center;padding:0 12px;gap:8px;flex-shrink:0;">
        <button id="ipReload" style="background:#2a2a2a;color:#fff;border:none;width:36px;height:36px;border-radius:6px;font-size:1rem;cursor:pointer;" title="Recarregar">↺</button>
        <button id="ipAspect" style="background:#2a2a2a;color:#fff;border:none;width:36px;height:36px;border-radius:6px;font-size:.65rem;font-weight:700;cursor:pointer;">16:9</button>
        <div style="flex:1;"></div>
        <span style="font-size:.8rem;color:#888;">🔊</span>
        <input id="ipVolSlider" type="range" min="0" max="1" step="0.05" value="1" style="width:100px;accent-color:var(--accent-gold);cursor:pointer;">
        <button id="ipMute" style="background:#2a2a2a;color:#fff;border:none;width:36px;height:36px;border-radius:6px;font-size:.9rem;cursor:pointer;">🔊</button>
        <button id="ipFullscreen" style="background:var(--accent-gold);color:#000;border:none;width:36px;height:36px;border-radius:6px;font-size:.9rem;cursor:pointer;" title="Tela cheia">⛶</button>
        <button id="ipClose" style="background:#cc0000;color:#fff;border:none;width:36px;height:36px;border-radius:6px;font-size:.9rem;cursor:pointer;" title="Fechar">✕</button>
      </div>
    </div>
    <!-- RIGHT: channel list -->
    <div style="width:380px;flex-shrink:0;background:#111;display:flex;flex-direction:column;border-left:1px solid #222;">
      <div style="padding:10px 14px;border-bottom:1px solid #222;flex-shrink:0;">
        <div style="font-size:.7rem;font-weight:700;color:var(--accent-gold);letter-spacing:.08em;">CATEGORIA: <span id="ipCatLabel">TODOS OS CANAIS</span></div>
        <input id="ipSearch" placeholder="Buscar canal..." style="width:100%;margin-top:6px;background:#1a1a1a;border:1px solid #333;border-radius:6px;color:#fff;padding:6px 10px;font-size:.85rem;outline:none;"/>
      </div>
      <div id="ipChannelList" style="flex:1;overflow-y:auto;"></div>
    </div>
    <style>
      @keyframes spin{to{transform:rotate(360deg)}}
      .ip-ch-row{display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;border-bottom:1px solid #1a1a1a;transition:background .1s;}
      .ip-ch-row:hover{background:#1e1e1e;}
      .ip-ch-row.active{background:#1A1500;border-left:3px solid var(--accent-gold);}
      .ip-ch-num{width:28px;text-align:right;font-size:.75rem;color:#555;flex-shrink:0;}
      .ip-ch-logo{width:36px;height:36px;border-radius:4px;background:#1a1a2e;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;}
      .ip-ch-logo img{width:32px;height:32px;object-fit:contain;}
      .ip-ch-info{flex:1;min-width:0;}
      .ip-ch-name{font-size:.85rem;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .ip-ch-epg{font-size:.7rem;color:#666;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;}
    </style>`;

  document.body.appendChild(overlay);

  const video    = overlay.querySelector('#ipVid');
  const spinner  = overlay.querySelector('#ipSpinner');
  const titleEl  = overlay.querySelector('#ipTitle');
  const statusEl = overlay.querySelector('#ipStatus');
  const volSlider = overlay.querySelector('#ipVolSlider');
  const muteBtn  = overlay.querySelector('#ipMute');
  const listEl   = overlay.querySelector('#ipChannelList');
  const searchEl = overlay.querySelector('#ipSearch');

  let currentId = id;
  let hlsInst = null;

  // Volume
  const savedVol = parseFloat(localStorage.getItem('hp_vol') ?? '1');
  video.volume = savedVol;
  volSlider.value = savedVol;
  volSlider.addEventListener('input', () => {
    video.volume = parseFloat(volSlider.value);
    localStorage.setItem('hp_vol', volSlider.value);
  });
  muteBtn.addEventListener('click', () => {
    video.muted = !video.muted;
    muteBtn.textContent = video.muted ? '🔇' : '🔊';
  });

  // Aspect
  const aspects = ['contain','cover','fill'];
  const aspLabels = ['16:9','ZOOM','FILL'];
  let aspIdx = 0;
  overlay.querySelector('#ipAspect').addEventListener('click', () => {
    aspIdx = (aspIdx + 1) % aspects.length;
    video.style.objectFit = aspects[aspIdx];
    overlay.querySelector('#ipAspect').textContent = aspLabels[aspIdx];
  });

  // Fullscreen — coloca o vídeo em tela cheia
  const fsBtn = overlay.querySelector('#ipFullscreen');
  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      video.requestFullscreen?.() || video.webkitRequestFullscreen?.();
    }
  };
  fsBtn.addEventListener('click', toggleFullscreen);
  video.addEventListener('dblclick', toggleFullscreen);
  document.addEventListener('fullscreenchange', () => {
    fsBtn.textContent = document.fullscreenElement ? '⊠' : '⛶';
  });

  // Close
  const closePlayer = () => {
    if (hlsInst) { hlsInst.destroy(); hlsInst = null; }
    video.pause(); video.src = '';
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  };
  overlay.querySelector('#ipClose').addEventListener('click', closePlayer);
  overlay.querySelector('#ipBack').addEventListener('click', closePlayer);
  overlay.querySelector('#ipReload').addEventListener('click', () => loadStream(video.src || url));

  // Keyboard
  const onKey = e => {
    if (e.key === 'Escape') { if (document.fullscreenElement) document.exitFullscreen(); else closePlayer(); }
    if (e.key === 'f' || e.key === 'F') toggleFullscreen();
  };
  document.addEventListener('keydown', onKey);

  // Load stream
  function loadStream(streamUrl) {
    spinner.style.display = 'flex';
    statusEl.textContent = '● CARREGANDO';
    if (hlsInst) { hlsInst.destroy(); hlsInst = null; }
    video.src = '';
    const isHls = streamUrl.includes('.m3u8') || streamUrl.includes('/live/');
    if (isHls && typeof Hls !== 'undefined' && Hls.isSupported()) {
      hlsInst = new Hls({ enableWorker: true, lowLatencyMode: true, maxBufferLength: 30 });
      hlsInst.loadSource(streamUrl);
      hlsInst.attachMedia(video);
      hlsInst.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(()=>{});
        spinner.style.display = 'none';
        statusEl.textContent = '● AO VIVO';
      });
      hlsInst.on(Hls.Events.ERROR, (_, d) => {
        if (d.fatal) { video.src = streamUrl; video.play().catch(()=>{}); spinner.style.display = 'none'; }
      });
    } else {
      video.src = streamUrl;
      video.play().catch(()=>{});
      video.addEventListener('playing', () => { spinner.style.display = 'none'; statusEl.textContent = '● AO VIVO'; }, { once: true });
    }
  }

  // Switch channel
  function switchChannel(ch) {
    currentId = ch.stream_id;
    titleEl.textContent = ch.name || '';
    addRecent(ch.stream_id, ch.name, 'channel', ch.stream_icon);
    loadStream(`${SERVER}/live/${USER}/${PASS}/${ch.stream_id}.m3u8`);
    // Update active row
    listEl.querySelectorAll('.ip-ch-row').forEach(r => r.classList.toggle('active', r.dataset.id == ch.stream_id));
  }

  // Build channel list
  function buildList(items) {
    listEl.innerHTML = '';
    items.forEach((ch, i) => {
      const row = document.createElement('div');
      row.className = 'ip-ch-row' + (ch.stream_id == currentId ? ' active' : '');
      row.dataset.id = ch.stream_id;
      row.innerHTML = `
        <span class="ip-ch-num">${String(i+1).padStart(3,'0')}</span>
        <div class="ip-ch-logo">${ch.stream_icon ? `<img src="${escHtml(ch.stream_icon)}" onerror="this.style.display='none'">` : ''}</div>
        <div class="ip-ch-info">
          <div class="ip-ch-name">${escHtml(ch.name||'')}</div>
          <div class="ip-ch-epg">Sem informações para o programa atual</div>
        </div>`;
      row.addEventListener('click', () => switchChannel(ch));
      listEl.appendChild(row);
    });
    // Scroll active into view
    const active = listEl.querySelector('.active');
    if (active) active.scrollIntoView({ block: 'center' });
  }

  buildList(channels);

  // Search
  searchEl.addEventListener('input', () => {
    const q = searchEl.value.toLowerCase();
    buildList(q ? channels.filter(c => (c.name||'').toLowerCase().includes(q)) : channels);
  });

  loadStream(url);
}

function createMovieCard(item) {
  const card = document.createElement('div');
  card.className = 'card-movie';
  const wrap = document.createElement('div');
  wrap.className = 'card-img-wrap';
  wrap.appendChild(imgEl(item.stream_icon, item.name));
  wrap.appendChild(favBtn(item.stream_id, 'movie'));
  const prog = getProgress()[`movies_${item.stream_id}`] || 0;
  if (prog > 0) {
    const pbWrap = document.createElement('div'); pbWrap.className = 'progress-bar-wrap';
    const pbFill = document.createElement('div'); pbFill.className = 'progress-bar-fill'; pbFill.style.width = prog + '%';
    pbWrap.appendChild(pbFill); wrap.appendChild(pbWrap);
    const badge = document.createElement('div'); badge.className = 'progress-badge';
    badge.textContent = prog >= 95 ? '✓ Assistido' : `▶ ${Math.round(prog)}%`;
    wrap.appendChild(badge);
  }
  const badges = document.createElement('div'); badges.className = 'badges';
  if (item.rating && parseFloat(item.rating) > 0) {
    const rb = document.createElement('div'); rb.className = 'badge-rating'; rb.textContent = `★ ${parseFloat(item.rating).toFixed(1)}`; badges.appendChild(rb);
  }
  const hd = document.createElement('div'); hd.className = 'badge-hd'; hd.textContent = 'HD'; badges.appendChild(hd);
  const ageR = getAgeRating(item);
  if (ageR) {
    const ac = ageRatingColor(ageR);
    const ab = document.createElement('div'); ab.className = 'badge-age';
    ab.style.cssText = `background:${ac.bg};color:${ac.text};font-size:.65rem;font-weight:700;padding:2px 5px;border-radius:4px;`;
    ab.textContent = ageR; badges.appendChild(ab);
  }
  wrap.appendChild(badges);
  const footer = document.createElement('div'); footer.className = 'card-footer';
  const name = document.createElement('div'); name.className = 'card-name'; name.textContent = item.name || ''; footer.appendChild(name);
  card.appendChild(wrap); card.appendChild(footer);
  card.addEventListener('click', () => { addRecent(item.stream_id, item.name, 'movie', item.stream_icon); openMovieDetail(item); });
  return card;
}

function createSeriesCard(item) {
  const card = document.createElement('div');
  card.className = 'card-series';
  const wrap = document.createElement('div'); wrap.className = 'card-img-wrap'; wrap.style.position = 'relative';
  wrap.appendChild(imgEl(item.cover, item.name));
  wrap.appendChild(favBtn(item.series_id, 'series'));

  // Progress badge
  const prog = getProgress()[`series_${item.series_id}`] || 0;
  if (prog > 0) {
    const badge = document.createElement('div'); badge.className = 'progress-badge';
    badge.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,.85);border-radius:25px;padding:8px 14px;font-size:1rem;font-weight:700;color:var(--accent-series);white-space:nowrap;';
    badge.textContent = prog >= 95 ? '✓ Assistido' : `▶ ${Math.round(prog)}%`;
    wrap.appendChild(badge);
  }

  // Badges (rating + HD + age)
  const badges = document.createElement('div'); badges.className = 'badges';
  if (item.rating && parseFloat(item.rating) > 0) {
    const rb = document.createElement('div'); rb.className = 'badge-rating';
    rb.style.background = 'var(--accent-series)'; rb.style.color = '#fff';
    rb.textContent = `★ ${parseFloat(item.rating).toFixed(1)}`; badges.appendChild(rb);
  }
  const hd = document.createElement('div'); hd.className = 'badge-hd'; hd.textContent = 'HD'; badges.appendChild(hd);
  const ageR = getAgeRating(item);
  if (ageR) {
    const ac = ageRatingColor(ageR);
    const ab = document.createElement('div'); ab.className = 'badge-age';
    ab.style.cssText = `background:${ac.bg};color:${ac.text};font-size:.65rem;font-weight:700;padding:2px 5px;border-radius:4px;`;
    ab.textContent = ageR; badges.appendChild(ab);
  }
  wrap.appendChild(badges);

  const footer = document.createElement('div'); footer.className = 'card-footer';
  const name = document.createElement('div'); name.className = 'card-name'; name.textContent = item.name || ''; footer.appendChild(name);
  card.appendChild(wrap); card.appendChild(footer);
  card.addEventListener('click', () => { addRecent(item.series_id, item.name, 'series', item.cover); openSeries(item); });
  return card;
}

function createLoadMoreCard() {
  const isMovie = currentPage === 'movies', isSeries = currentPage === 'series';
  const card = document.createElement('div');
  card.className = `card-load-more${isMovie ? ' movies' : isSeries ? ' series' : ''}`;
  card.style.width  = (currentPage === 'live') ? '155px' : '160px';
  card.style.height = (currentPage === 'live') ? '195px' : '280px';
  card.innerHTML = `<div class="lm-icon">⬇</div><div class="lm-text">CARREGAR<br>MAIS</div>`;
  card.addEventListener('click', loadMoreItems);
  return card;
}

// ── Series detail ─────────────────────────────────────────────────────────────
async function openSeries(series) {
  addRecent(series.series_id, series.name, 'series', series.cover);

  const overlay = document.createElement('div');
  overlay.className = 'detail-overlay';
  overlay.innerHTML = `
    <div class="detail-page">
      <button class="detail-back" id="detailBack">← Voltar</button>
      <div class="detail-body">
        <img class="detail-poster" src="${escHtml(series.cover||'')}" onerror="this.style.display='none'" alt="${escHtml(series.name)}"/>
        <div class="detail-info">
          <h1 class="detail-title">${escHtml(series.name)}</h1>
          <div class="detail-meta">
            ${series.rating ? `<span class="detail-badge cyan">★ ${parseFloat(series.rating).toFixed(1)}</span>` : ''}
            ${series.releaseDate ? `<span class="detail-meta-text">${escHtml(series.releaseDate)}</span>` : ''}
            ${series.genre ? `<span class="detail-meta-text">${escHtml(series.genre)}</span>` : ''}
          </div>
          ${series.plot ? `<p class="detail-plot">${escHtml(series.plot)}</p>` : ''}
          ${series.cast ? `<p class="detail-cast">Elenco: ${escHtml(series.cast)}</p>` : ''}
          <div class="detail-seasons-wrap" id="seasonsWrap">
            <div style="color:var(--text-muted);padding:1rem 0">Carregando episódios...</div>
          </div>
        </div>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  overlay.querySelector('#detailBack').addEventListener('click', () => overlay.remove());

  try {
    const info = await fetchJson(api('get_series_info', `&series_id=${series.series_id}`));
    const wrap = overlay.querySelector('#seasonsWrap');
    wrap.innerHTML = '';

    if (!info?.episodes || Object.keys(info.episodes).length === 0) {
      wrap.innerHTML = '<p style="color:var(--text-muted)">Nenhum episódio encontrado.</p>';
      return;
    }

    const seasons = Object.keys(info.episodes).sort((a,b) => parseInt(a)-parseInt(b));
    let activeSeason = seasons[0];

    const selRow = document.createElement('div');
    selRow.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:16px;';
    selRow.innerHTML = `<span style="font-size:.95rem;font-weight:600;">Temporada:</span>`;
    const sel = document.createElement('select');
    sel.className = 'season-select';
    seasons.forEach(s => { const o = document.createElement('option'); o.value = s; o.textContent = `Temporada ${s}`; sel.appendChild(o); });
    selRow.appendChild(sel);
    wrap.appendChild(selRow);

    const epContainer = document.createElement('div');
    epContainer.className = 'ep-list';
    wrap.appendChild(epContainer);

    function renderEpisodes(season) {
      epContainer.innerHTML = '';
      (info.episodes[season] || []).forEach(ep => {
        const prog = getProgress()[`series_${ep.id}`] || 0;
        const row = document.createElement('div');
        row.className = 'ep-row';
        row.innerHTML = `
          <div class="ep-num">${ep.episode_num}</div>
          <div class="ep-details">
            <div class="ep-name">${escHtml(series.name)} S${String(season).padStart(2,'0')} E${String(ep.episode_num).padStart(2,'0')}</div>
            ${ep.info?.duration_secs ? `<div class="ep-dur">${Math.round(ep.info.duration_secs/60)}min</div>` : ''}
            ${prog > 0 ? `<div class="ep-prog-bar"><div class="ep-prog-fill" style="width:${prog}%"></div></div>` : ''}
          </div>
          ${prog > 0 ? `<span class="ep-prog-badge" style="background:var(--accent-series)">▶ ${Math.round(prog)}%</span>` : ''}`;
        row.addEventListener('click', () => {
          const ext = ep.container_extension || 'mp4';
          overlay.remove();
          goPlayer(`${SERVER}/series/${USER}/${PASS}/${ep.id}.${ext}`, `${series.name} S${season}E${ep.episode_num}`, ep.id, 'series', series);
        });
        epContainer.appendChild(row);
      });
    }

    renderEpisodes(activeSeason);
    sel.addEventListener('change', () => { activeSeason = sel.value; renderEpisodes(activeSeason); });
  } catch {
    overlay.querySelector('#seasonsWrap').innerHTML = '<p style="color:#ff5555">Erro ao carregar episódios.</p>';
  }
}

// ── Movie detail ──────────────────────────────────────────────────────────────
async function openMovieDetail(item) {
  const overlay = document.createElement('div');
  overlay.className = 'detail-overlay';
  overlay.innerHTML = `
    <div class="detail-page">
      <button class="detail-back" id="detailBack">← Voltar</button>
      <div class="detail-body">
        <img class="detail-poster" src="${escHtml(item.stream_icon||'')}" onerror="this.style.display='none'" alt="${escHtml(item.name)}"/>
        <div class="detail-info">
          <h1 class="detail-title">${escHtml(item.name||'')}</h1>
          <div class="detail-meta">
            <span class="detail-badge gold">FILME</span>
            <span class="detail-badge dark">HD</span>
            ${item.rating && parseFloat(item.rating) > 0 ? `<span class="detail-badge cyan">★ ${parseFloat(item.rating).toFixed(1)}</span>` : ''}
            ${item.releaseDate ? `<span class="detail-meta-text">${escHtml(item.releaseDate)}</span>` : getYear(item) ? `<span class="detail-meta-text">${getYear(item)}</span>` : ''}
          </div>
          ${item.plot ? `<p class="detail-plot">${escHtml(item.plot)}</p>` : ''}
          ${item.cast ? `<p class="detail-cast">Elenco: ${escHtml(item.cast)}</p>` : ''}
          <div class="detail-actions">
            <button class="detail-play-btn" id="detailPlay">▶ ASSISTIR</button>
            <button class="detail-fav-btn" id="detailFav">${favorites[String(item.stream_id)] ? '♥ MINHA LISTA' : '♡ MINHA LISTA'}</button>
          </div>
        </div>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  overlay.querySelector('#detailBack').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#detailPlay').addEventListener('click', () => {
    addRecent(item.stream_id, item.name, 'movie', item.stream_icon);
    const ext = item.container_extension || 'mp4';
    overlay.remove();
    goPlayer(`${SERVER}/movie/${USER}/${PASS}/${item.stream_id}.${ext}`, item.name, item.stream_id, 'movies', item);
  });
  const favBtnEl = overlay.querySelector('#detailFav');
  favBtnEl.addEventListener('click', () => {
    if (favorites[String(item.stream_id)]) { delete favorites[String(item.stream_id)]; favBtnEl.textContent = '♡ MINHA LISTA'; }
    else { favorites[String(item.stream_id)] = 'movie'; favBtnEl.textContent = '♥ MINHA LISTA'; }
    localStorage.setItem(profileKey('hp_favs'), JSON.stringify(favorites));
  });

  try {
    const info = await fetchJson(api('get_vod_info', `&vod_id=${item.stream_id}`));
    if (info?.info) {
      const i = info.info;
      const infoEl = overlay.querySelector('.detail-info');
      if (i.plot && !item.plot) {
        const p = document.createElement('p'); p.className = 'detail-plot'; p.textContent = i.plot;
        infoEl.insertBefore(p, infoEl.querySelector('.detail-actions'));
      }
      if (i.cast && !overlay.querySelector('.detail-cast')) {
        const c = document.createElement('p'); c.className = 'detail-cast'; c.textContent = `Elenco: ${i.cast}`;
        infoEl.insertBefore(c, infoEl.querySelector('.detail-actions'));
      }
    }
  } catch {}
}

// ── Recents / Favorites ───────────────────────────────────────────────────────
function renderRecentsGrid() {
  grid.style.display = 'flex'; grid.style.flexWrap = 'wrap'; grid.innerHTML = '';
  grid.classList.add('recents-grid');
  if (recents.length === 0) {
    grid.innerHTML = '<p style="color:var(--text-muted);padding:2rem">Nenhum conteúdo assistido recentemente.</p>';
    return;
  }
  recents.slice(0, 100).forEach(r => {
    const card = r.type === 'channel' ? createChannelCard({ stream_id: r.id, name: r.name, stream_icon: r.icon })
      : r.type === 'series' ? createSeriesCard({ series_id: r.id, name: r.name, cover: r.icon })
      : createMovieCard({ stream_id: r.id, name: r.name, stream_icon: r.icon });
    grid.appendChild(card);
  });
}

async function renderFavoritesGrid() {
  grid.style.display = 'flex'; grid.style.flexWrap = 'wrap'; grid.innerHTML = '';
  grid.classList.add('recents-grid');
  const favIds = Object.keys(favorites);
  if (favIds.length === 0) {
    grid.innerHTML = '<p style="color:var(--text-muted);padding:2rem">Você ainda não tem favoritos. Clique no ❤ em qualquer item.</p>';
    return;
  }

  // Ensure caches are loaded
  const [channels, movies, series] = await Promise.all([
    _cachedChannels ? Promise.resolve(_cachedChannels) : fetchJsonTimeout(api('get_live_streams')).then(d => { _cachedChannels = d||[]; return _cachedChannels; }),
    _cachedMovies   ? Promise.resolve(_cachedMovies)   : fetchJsonTimeout(api('get_vod_streams')).then(d => { _cachedMovies = d||[]; return _cachedMovies; }),
    _cachedSeries   ? Promise.resolve(_cachedSeries)   : fetchJsonTimeout(api('get_series')).then(d => { _cachedSeries = d||[]; return _cachedSeries; }),
  ]);

  let count = 0;
  // Channels
  channels.filter(i => favorites[String(i.stream_id)]).forEach(i => { grid.appendChild(createChannelCard(i)); count++; });
  // Movies
  movies.filter(i => favorites[String(i.stream_id)]).forEach(i => { grid.appendChild(createMovieCard(i)); count++; });
  // Series
  series.filter(i => favorites[String(i.series_id)]).forEach(i => { grid.appendChild(createSeriesCard(i)); count++; });

  if (count === 0) {
    grid.innerHTML = '<p style="color:var(--text-muted);padding:2rem">Nenhum favorito encontrado. Clique no ❤ em qualquer item.</p>';
  }
}

function addRecent(id, name, type, icon) {
  recents = recents.filter(r => !(r.id == id && r.type === type));
  recents.unshift({ id, name, type, icon });
  if (recents.length > 100) recents = recents.slice(0, 100);
  localStorage.setItem(profileKey('hp_recents'), JSON.stringify(recents));
}

// ── Loading ───────────────────────────────────────────────────────────────────
let loadingEl = null;
function showLoading(show, page) {
  if (show) {
    if (loadingEl) return;
    loadingEl = document.createElement('div');
    loadingEl.className = 'loading-bar-wrap';
    const bar = document.createElement('div'); bar.className = 'loading-bar';
    const fill = document.createElement('div');
    fill.className = `loading-bar-fill${(page === 'movies' || page === 'series' || page === 'radio') ? ' cyan' : ''}`;
    bar.appendChild(fill);
    const txt = document.createElement('div'); txt.className = 'loading-bar-text'; txt.textContent = 'Carregando...';
    loadingEl.appendChild(bar); loadingEl.appendChild(txt);
    document.querySelector('.main-panel').style.position = 'relative';
    document.querySelector('.main-panel').appendChild(loadingEl);
  } else {
    if (loadingEl) { loadingEl.remove(); loadingEl = null; }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function fetchJson(url) {
  const res = await fetch(proxyUrl(url));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
async function fetchJsonTimeout(url, ms = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(proxyUrl(url), { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } finally { clearTimeout(timer); }
}
function escHtml(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function getYear(item) {
  if (!item.added) return '';
  if (parseInt(item.added) > 1e9) return new Date(parseInt(item.added)*1000).getFullYear().toString();
  if (item.added.length === 4) return item.added;
  return '';
}
function goPlayer(url, title, id, type, detailItem) {
  const prog = getProgress()[`${type}_${id}`] || 0;
  const startPct = (prog > 0 && prog < 95) ? prog : 0;
  const returnPage = currentPage || 'home';
  // Store detail item in sessionStorage so we can reopen it on return
  if (detailItem) {
    try { sessionStorage.setItem('hp_return_detail', JSON.stringify({ type, item: detailItem })); } catch {}
  } else {
    sessionStorage.removeItem('hp_return_detail');
  }
  location.href = `player.html?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}&id=${id}&type=${type}&start=${startPct}&returnPage=${encodeURIComponent(returnPage)}`;
}

// ── Inline CSS ────────────────────────────────────────────────────────────────
const homeStyle = document.createElement('style');
homeStyle.textContent = `
.scroll-arrow-btn{background:transparent;border:1px solid var(--accent-gold);color:var(--accent-gold);width:32px;height:32px;border-radius:4px;font-size:1.2rem;font-weight:700;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background .15s;}
.scroll-arrow-btn:hover{background:var(--accent-gold);color:#000;}
.ver-tudo-btn{background:transparent;border:none;color:var(--text-muted);font-size:.85rem;cursor:pointer;padding:4px 8px;}
.ver-tudo-btn:hover{color:var(--text);}
.banner-play-btn{background:var(--accent-cyan);color:#000;border:none;padding:12px 24px;border-radius:6px;font-size:1rem;font-weight:700;cursor:pointer;box-shadow:0 0 15px rgba(0,212,255,.7);}
.banner-play-btn:hover{opacity:.85;}
.banner-info-btn{background:rgba(255,255,255,.5);color:#fff;border:none;padding:12px 24px;border-radius:6px;font-size:1rem;font-weight:700;cursor:pointer;}
.banner-info-btn:hover{background:rgba(255,255,255,.8);color:#000;}
#grid{min-height:200px;}
.profile-row{display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--surface2);border-radius:8px;cursor:pointer;transition:background .15s;border:2px solid transparent;}
.profile-row:hover{background:var(--surface3);}
.profile-row.active{border-color:var(--accent-cyan);}
.profile-avatar{width:48px;height:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.6rem;flex-shrink:0;}
.profile-edit-btn,.profile-del-btn{background:var(--surface3);border:none;color:var(--text);width:32px;height:32px;border-radius:6px;cursor:pointer;font-size:.9rem;display:flex;align-items:center;justify-content:center;}
.profile-edit-btn:hover{background:#3a3a5a;}
.profile-del-btn:hover{background:#5a1a1a;}
.emoji-grid{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;}
.emoji-opt{width:36px;height:36px;border-radius:6px;background:var(--surface2);border:2px solid transparent;cursor:pointer;font-size:1.2rem;display:flex;align-items:center;justify-content:center;transition:border-color .15s;}
.emoji-opt:hover,.emoji-opt.selected{border-color:var(--accent-cyan);}
.color-grid{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;}
.color-opt{width:28px;height:28px;border-radius:50%;cursor:pointer;border:3px solid transparent;transition:border-color .15s;}
.color-opt:hover,.color-opt.selected{border-color:#fff;}
`;
document.head.appendChild(homeStyle);

// ── PROFILE SYSTEM ────────────────────────────────────────────────────────────
const PROFILE_EMOJIS = ['👤','😀','😎','🤩','🥳','👦','👧','👨','👩','🧑','👴','👵','🐶','🐱','🦊','🐻','🐼','🦁','🐯','🐸'];
const PROFILE_COLORS = ['#00D4FF','#FFB703','#9D4EDD','#00C853','#E50914','#FF6B35','#4ECDC4','#45B7D1','#96CEB4','#FFEAA7'];

function genId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function loadProfiles() {
  try { return JSON.parse(localStorage.getItem('hp_profiles') || 'null'); } catch { return null; }
}
function saveProfiles(data) {
  localStorage.setItem('hp_profiles', JSON.stringify(data));
}
function getProfileData() {
  let data = loadProfiles();
  if (!data || !data.profiles || data.profiles.length === 0) {
    const id = genId();
    data = {
      profiles: [{ id, name: 'Principal', emoji: '👤', color: '#00D4FF', isKids: false, favoriteTeam: '', lastUsed: Date.now() }],
      currentId: id
    };
    saveProfiles(data);
  }
  if (!data.currentId) { data.currentId = data.profiles[0].id; saveProfiles(data); }
  return data;
}
function getCurrentProfile() {
  const data = getProfileData();
  return data.profiles.find(p => p.id === data.currentId) || data.profiles[0];
}

// Kids mode helper
function isKidsProfile() {
  return getCurrentProfile()?.isKids === true;
}

// Max rating filter — returns numeric limit (null = no limit)
const RATING_ORDER = { 'l':0,'livre':0,'al':0,'g':0,'tv-y':0,'tv-y7':0,'tv-g':0,'10':10,'pg':10,'tv-pg':10,'12':12,'pg-13':12,'tv-14':14,'14':14,'15':15,'16':16,'17':17,'18':18,'r':18,'nc-17':18,'tv-ma':18 };

function getProfileMaxRating() {
  const p = getCurrentProfile();
  if (p?.isKids) return 12; // kids always capped at 12
  return p?.maxRating ?? null; // null = no limit
}

function isAllowedByRating(item) {
  const max = getProfileMaxRating();
  if (max === null) return true; // no limit set
  const raw = (item.age || item.pg || item.content_rating || item.rating_content || '').toString().toLowerCase().trim();
  if (!raw || raw === '0') return true; // no rating info = allow (can't block what we don't know)
  const val = RATING_ORDER[raw];
  if (val === undefined) return true; // unknown rating = allow
  return val <= max;
}

// Keywords that indicate kids content in CATEGORY names only (not titles)
const KIDS_CAT_KEYWORDS = [
  'kids','infantil','criança','crianças','cartoon','animação','animacao',
  'disney','nickelodeon','cartoon network','junior','jr','discovery kids',
  'gloob','zoomoo','boomerang','panda','jim jam','infantis',
  // Categories explicitly allowed for kids (movies: família, anime, crunchyroll only)
  'familia','família','family',
  'anime','animes','crunchyroll',
  'pixar','dreamworks','studio ghibli',
  'marvel kids','dc kids',
];

// Series categories always shown in kids sidebar (content still filtered by rating)
const KIDS_SERIES_VISIBLE_CATS = [
  'netflix','globoplay','prime','hbo','paramount','apple','comedia','comédia',
  'looke','fantasia','diversas','disney','amazon','star+','star plus',
];

// Live channel categories always shown in kids sidebar
const KIDS_LIVE_VISIBLE_CATS = ['24 hora','24h','24 horas'];

function isKidsVisibleLiveCat(catName) {
  const n = (catName || '').toLowerCase();
  return KIDS_LIVE_VISIBLE_CATS.some(k => n.includes(k));
}

// Movies categories always shown in kids sidebar (content still filtered by rating)
const KIDS_MOVIES_VISIBLE_CATS = [
  'netflix','globoplay','prime','hbo','paramount','apple','comedia','comédia',
  'looke','fantasia','disney','amazon','star+','star plus',
];

function isKidsVisibleSeriesCat(catName) {
  const n = (catName || '').toLowerCase();
  return KIDS_SERIES_VISIBLE_CATS.some(k => n.includes(k));
}

function isKidsVisibleMovieCat(catName) {
  const n = (catName || '').toLowerCase();
  return KIDS_MOVIES_VISIBLE_CATS.some(k => n.includes(k));
}

// Kids-safe age ratings — L, 10, 12 são permitidos para kids
const KIDS_RATINGS_PG = ['g','tv-y','tv-y7','tv-g','l','livre','al','10','12'];

// Age rating display helper
function getAgeRating(item) {
  const raw = (item.age || item.pg || item.content_rating || item.rating_content || '').toString().trim();
  if (!raw || raw === '0') return null;
  return raw;
}

function ageRatingColor(r) {
  const v = r.toLowerCase();
  if (['l','livre','g','tv-y','tv-y7','tv-g','al','0'].includes(v)) return { bg: '#2e7d32', text: '#fff' }; // verde
  if (['10','pg','tv-pg'].includes(v)) return { bg: '#1565c0', text: '#fff' };                              // azul
  if (['12','pg-13','tv-14'].includes(v)) return { bg: '#f57f17', text: '#000' };                           // amarelo
  if (['14','15'].includes(v)) return { bg: '#e65100', text: '#fff' };                                      // laranja
  if (['16','17','18','r','nc-17','tv-ma'].includes(v)) return { bg: '#b71c1c', text: '#fff' };             // vermelho
  return { bg: '#444', text: '#fff' };
}

function isKidsContent(item, categoriesMap, isSeries = false, isMovie = false, isLive = false) {
  if (!item) return false;

  const pg = (item.age || item.pg || item.content_rating || item.rating_content || '').toString().toLowerCase().trim();
  const hasRating = pg && pg !== '0';
  const kidsRating = hasRating && KIDS_RATINGS_PG.includes(pg);
  const blockedRating = hasRating && !kidsRating;

  // If explicitly rated above kids limit, always block
  if (blockedRating) return false;

  // Check category name
  if (categoriesMap && item.category_id) {
    const catName = (categoriesMap[item.category_id] || '').toLowerCase();

    // Explicit kids categories (infantil, disney, gloob, etc.) — allow if not blocked by rating
    if (KIDS_CAT_KEYWORDS.some(k => catName.includes(k))) return true;

    // Platform categories (Netflix, HBO, etc.) — only show if has explicit kids rating
    if (isSeries && isKidsVisibleSeriesCat(catName)) return kidsRating;
    if (isMovie  && isKidsVisibleMovieCat(catName))  return kidsRating;

    // Live 24h category — allow if not blocked by rating
    if (isLive && isKidsVisibleLiveCat(catName)) return true;
  }

  // No category match — require explicit kids rating
  return kidsRating;
}

function renderProfileSidebar() {
  const p = getCurrentProfile();
  const nameEl = document.getElementById('profileName');
  const avatarEl = document.querySelector('.topbar-profile-btn .nav-avatar');
  if (nameEl) nameEl.textContent = p.name;
  if (avatarEl) {
    avatarEl.textContent = p.emoji || '👤';
    avatarEl.style.background = p.color || '#00D4FF';
  }

  // Apply or remove kids theme
  document.body.classList.toggle('kids-theme', !!p.isKids);

  // Kids mode: hide games and radio nav buttons, show KIDS badge
  const gamesBtn = document.querySelector('.nav-btn.games');
  const radioBtn = document.querySelector('.nav-btn.radio');
  if (gamesBtn) gamesBtn.style.display = p.isKids ? 'none' : '';
  if (radioBtn) radioBtn.style.display = p.isKids ? 'none' : '';

  // Kids badge on topbar
  let kidsBadge = document.getElementById('kidsBadge');
  if (p.isKids) {
    if (!kidsBadge) {
      kidsBadge = document.createElement('span');
      kidsBadge.id = 'kidsBadge';
      kidsBadge.textContent = 'KIDS';
      kidsBadge.style.cssText = 'font-size:.6rem;font-weight:700;background:#9D4EDD;color:#fff;padding:2px 6px;border-radius:4px;margin-left:4px;';
      const nameEl2 = document.getElementById('profileName');
      if (nameEl2) nameEl2.after(kidsBadge);
    }
  } else {
    if (kidsBadge) kidsBadge.remove();
  }
}

function openProfileManager(manageMode = false) {
  const overlay = document.createElement('div');
  overlay.className = 'nf-profile-overlay';
  overlay.style.zIndex = '600';

  const renderContent = (managing) => {
    const d = getProfileData();
    overlay.innerHTML = `
      <div class="nf-profile-screen">
        <div class="nf-profile-logo">
          <span class="husky">Husky</span><span class="play-text">Play</span>
          <div class="play-icon"><svg viewBox="0 0 10 12"><polygon points="0,0 10,6 0,12"/></svg></div>
        </div>
        <h1 class="nf-profile-title">${managing ? 'Gerenciar perfis' : 'Quem está assistindo?'}</h1>
        <div class="nf-profile-grid" id="nfProfileGrid">
          ${d.profiles.map(p => `
            <div class="nf-profile-item${!managing && p.id === d.currentId ? ' nf-active' : ''}" data-id="${escHtml(p.id)}">
              <div class="nf-avatar-wrap">
                <div class="nf-avatar" style="background:${escHtml(p.color)}">${p.emoji}</div>
                ${managing ? `<div class="nf-edit-icon">✏️</div>` : ''}
                ${managing && d.profiles.length > 1 ? `<button class="nf-del-btn" data-id="${escHtml(p.id)}" title="Excluir">✕</button>` : ''}
              </div>
              <div class="nf-profile-name">${escHtml(p.name)}${p.isKids ? '<span class="nf-kids-badge">KIDS</span>' : ''}</div>
            </div>`).join('')}
          ${d.profiles.length < 5 ? `
            <div class="nf-profile-item nf-add-item" id="nfAddProfile">
              <div class="nf-avatar-wrap">
                <div class="nf-avatar nf-avatar-add">＋</div>
              </div>
              <div class="nf-profile-name">Adicionar perfil</div>
            </div>` : ''}
        </div>
        <div class="nf-profile-actions">
          ${managing
            ? `<button class="nf-btn-outline" id="nfDoneBtn">Concluído</button>`
            : `<button class="nf-btn-outline" id="nfManageBtn">Gerenciar perfis</button>`}
        </div>
      </div>`;

    // Select profile
    if (!managing) {
      overlay.querySelectorAll('.nf-profile-item:not(.nf-add-item)').forEach(item => {
        item.addEventListener('click', () => {
          const d2 = getProfileData();
          d2.currentId = item.dataset.id;
          const p = d2.profiles.find(x => x.id === item.dataset.id);
          if (p) p.lastUsed = Date.now();
          saveProfiles(d2);
          renderProfileSidebar();
          loadProfileState();
          overlay.classList.add('nf-fade-out');
          setTimeout(() => { overlay.remove(); setActivePage('home'); }, 300);
        });
      });
      const manageBtn = overlay.querySelector('#nfManageBtn');
      if (manageBtn) manageBtn.addEventListener('click', () => renderContent(true));
    } else {
      // Edit on click in manage mode
      overlay.querySelectorAll('.nf-profile-item:not(.nf-add-item)').forEach(item => {
        item.addEventListener('click', e => {
          if (e.target.closest('.nf-del-btn')) return;
          openProfileEditor(item.dataset.id, overlay, () => renderContent(true));
        });
      });
      overlay.querySelectorAll('.nf-del-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          if (!confirm('Excluir este perfil?')) return;
          const d2 = getProfileData();
          d2.profiles = d2.profiles.filter(p => p.id !== btn.dataset.id);
          if (d2.currentId === btn.dataset.id) d2.currentId = d2.profiles[0].id;
          saveProfiles(d2);
          renderContent(true);
        });
      });
      const doneBtn = overlay.querySelector('#nfDoneBtn');
      if (doneBtn) doneBtn.addEventListener('click', () => renderContent(false));
    }

    const addBtn = overlay.querySelector('#nfAddProfile');
    if (addBtn) addBtn.addEventListener('click', () => openProfileEditor(null, overlay, () => renderContent(managing)));
  };

  renderContent(manageMode);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('nf-visible'));
}

function openProfileEditor(profileId, parentOverlay, onSave) {
  const data = getProfileData();
  const profile = profileId ? data.profiles.find(p => p.id === profileId) : null;
  let selEmoji = profile?.emoji || '👤';
  let selColor = profile?.color || '#00D4FF';

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.zIndex = '700';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:420px;">
      <div class="modal-header">
        <div class="modal-title">${profile ? 'Editar Perfil' : 'Novo Perfil'}</div>
        <button class="modal-close" id="editorClose">✕</button>
      </div>
      <div style="text-align:center;margin-bottom:20px;">
        <div id="previewAvatar" style="width:72px;height:72px;border-radius:50%;background:${escHtml(selColor)};display:flex;align-items:center;justify-content:center;font-size:2.2rem;margin:0 auto;">${selEmoji}</div>
      </div>
      <div class="field" style="margin-bottom:12px;">
        <label style="font-size:.8rem;color:var(--text-muted);display:block;margin-bottom:4px;">Nome</label>
        <input type="text" id="pName" value="${escHtml(profile?.name||'')}" placeholder="Nome do perfil" maxlength="20" style="width:100%;padding:.6rem .9rem;background:#1e1e1e;border:1px solid #333;border-radius:6px;color:#fff;font-size:.95rem;outline:none;"/>
      </div>
      <div style="margin-bottom:12px;">
        <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:6px;">Emoji</div>
        <div class="emoji-grid" id="emojiGrid">
          ${PROFILE_EMOJIS.map(e => `<button class="emoji-opt${e===selEmoji?' selected':''}" data-e="${e}">${e}</button>`).join('')}
        </div>
      </div>
      <div style="margin-bottom:12px;">
        <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:6px;">Cor</div>
        <div class="color-grid" id="colorGrid">
          ${PROFILE_COLORS.map(c => `<button class="color-opt${c===selColor?' selected':''}" data-c="${escHtml(c)}" style="background:${escHtml(c)};"></button>`).join('')}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
        <input type="checkbox" id="pKids"${profile?.isKids?' checked':''} style="width:16px;height:16px;cursor:pointer;"/>
        <label for="pKids" style="font-size:.9rem;cursor:pointer;">Perfil Kids</label>
      </div>
      <div class="field" style="margin-bottom:16px;">
        <label style="font-size:.8rem;color:var(--text-muted);display:block;margin-bottom:4px;">Classificação máxima permitida</label>
        <select id="pMaxRating" style="width:100%;padding:.6rem .9rem;background:#1e1e1e;border:1px solid #333;border-radius:6px;color:#fff;font-size:.95rem;outline:none;cursor:pointer;">
          <option value="">Sem limite</option>
          <option value="0"${(profile?.maxRating===0)?' selected':''}>L — Livre</option>
          <option value="10"${(profile?.maxRating===10)?' selected':''}>10 anos</option>
          <option value="12"${(profile?.maxRating===12)?' selected':''}>12 anos</option>
          <option value="14"${(profile?.maxRating===14)?' selected':''}>14 anos</option>
          <option value="16"${(profile?.maxRating===16)?' selected':''}>16 anos</option>
          <option value="18"${(profile?.maxRating===18)?' selected':''}>18 anos</option>
        </select>
      </div>
      <div class="field" style="margin-bottom:16px;">
        <label style="font-size:.8rem;color:var(--text-muted);display:block;margin-bottom:4px;">Time favorito (opcional)</label>
        <input type="text" id="pTeam" value="${escHtml(profile?.favoriteTeam||'')}" placeholder="Ex: Flamengo" maxlength="30" style="width:100%;padding:.6rem .9rem;background:#1e1e1e;border:1px solid #333;border-radius:6px;color:#fff;font-size:.95rem;outline:none;"/>
      </div>
      <button class="detail-play-btn" id="saveProfile" style="width:100%;">Salvar</button>
    </div>`;

  document.body.appendChild(overlay);
  overlay.querySelector('#editorClose').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  const preview = overlay.querySelector('#previewAvatar');

  overlay.querySelectorAll('.emoji-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      overlay.querySelectorAll('.emoji-opt').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selEmoji = btn.dataset.e;
      preview.textContent = selEmoji;
    });
  });

  overlay.querySelectorAll('.color-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      overlay.querySelectorAll('.color-opt').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selColor = btn.dataset.c;
      preview.style.background = selColor;
    });
  });

  overlay.querySelector('#saveProfile').addEventListener('click', () => {
    const name = overlay.querySelector('#pName').value.trim();
    if (!name) { alert('Digite um nome para o perfil.'); return; }
    const isKids = overlay.querySelector('#pKids').checked;
    const favoriteTeam = overlay.querySelector('#pTeam').value.trim();
    const maxRatingRaw = overlay.querySelector('#pMaxRating').value;
    const maxRating = maxRatingRaw === '' ? null : parseInt(maxRatingRaw);

    const d = getProfileData();
    if (profile) {
      const p = d.profiles.find(x => x.id === profileId);
      if (p) { p.name = name; p.emoji = selEmoji; p.color = selColor; p.isKids = isKids; p.favoriteTeam = favoriteTeam; p.maxRating = maxRating; }
    } else {
      const newP = { id: genId(), name, emoji: selEmoji, color: selColor, isKids, favoriteTeam, maxRating, lastUsed: Date.now() };
      d.profiles.push(newP);
    }
    saveProfiles(d);
    renderProfileSidebar();
    overlay.remove();
    if (onSave) onSave();
  });
}

// ── Init profile & start ──────────────────────────────────────────────────────
renderProfileSidebar();

document.getElementById('profileBtn').addEventListener('click', () => {
  navSidebar.classList.remove('open');
  openProfileManager();
});

// Restore page if returning from player
const _returnPage = new URLSearchParams(location.search).get('page');

// ── Splash Screen sync ────────────────────────────────────────────────────────
async function runSplash() {
  const splash = document.getElementById('splashScreen');

  // If returning from player, skip both profile selection and splash
  if (_returnPage) {
    if (splash) splash.remove();
    startApp();
    return;
  }

  // Step 1: Profile selection first (hide splash behind it)
  if (splash) splash.style.display = 'none';
  await new Promise(resolve => showProfileSelection(resolve));

  // Step 2: Now run sync splash
  if (!splash) { startApp(); return; }
  splash.style.display = '';
  requestAnimationFrame(() => splash.classList.add('nf-visible'));

  const steps = [
    { id: 'si-live',   fetch: () => Promise.all([
        fetchJsonTimeout(api('get_live_categories')).then(d => { _cachedCatLive = d || []; cacheSet('hp_cache_cat_live', _cachedCatLive); }),
        fetchJsonTimeout(api('get_live_streams')).then(d => { _cachedChannels = d || []; })
      ])
    },
    { id: 'si-movies', fetch: () => Promise.all([
        fetchJsonTimeout(api('get_vod_categories')).then(d => { _cachedCatMovies = d || []; cacheSet('hp_cache_cat_movies', _cachedCatMovies); }),
        fetchJsonTimeout(api('get_vod_streams')).then(d => { _cachedMovies = d || []; })
      ])
    },
    { id: 'si-series', fetch: () => Promise.all([
        fetchJsonTimeout(api('get_series_categories')).then(d => { _cachedCatSeries = d || []; cacheSet('hp_cache_cat_series', _cachedCatSeries); }),
        fetchJsonTimeout(api('get_series')).then(d => { _cachedSeries = d || []; })
      ])
    },
    { id: 'si-radio',  fetch: () => fetch(proxyUrl(`${RADIO_API}/json/stations/bycountry/brazil?limit=60&hidebroken=true&order=clickcount&reverse=true`)).then(r => r.json()).then(d => { _cachedRadio = d || []; }) },
  ];

  const bar = document.getElementById('splashBar');
  let done = 0;

  function setStep(id, state) {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = 'splash-item ' + state;
    const icon = el.querySelector('.si-icon');
    if (state === 'loading') icon.textContent = '🔄';
    else if (state === 'done') icon.textContent = '✅';
    else if (state === 'error') icon.textContent = '❌';
  }

  await Promise.all(steps.map(async step => {
    setStep(step.id, 'loading');
    try { await step.fetch(); setStep(step.id, 'done'); }
    catch { setStep(step.id, 'error'); }
    done++;
    if (bar) bar.style.width = (done / steps.length * 100) + '%';
  }));

  await new Promise(r => setTimeout(r, 600));
  splash.classList.add('fade-out');
  // Start rendering home immediately while splash fades out
  startApp();
  setTimeout(() => { splash.remove(); }, 500);
}

function showProfileSelection(onDone) {
  // If returning from player, skip profile selection
  if (_returnPage) { if (onDone) onDone(); return; }

  const d = getProfileData();
  const hasRealProfiles = d.profiles.length > 0 &&
    !(d.profiles.length === 1 && d.profiles[0].name === 'Principal' && d.profiles[0].emoji === '👤');

  // No real profiles yet — force create
  if (!hasRealProfiles) {
    showForceCreateProfile(onDone);
    return;
  }

  // Show Netflix-style profile picker
  const overlay = document.createElement('div');
  overlay.className = 'nf-profile-overlay';
  overlay.style.zIndex = '800';

  const render = () => {
    const d2 = getProfileData();
    overlay.innerHTML = `
      <div class="nf-profile-screen">
        <div class="nf-profile-logo">
          <span class="husky">Husky</span><span class="play-text">Play</span>
          <div class="play-icon"><svg viewBox="0 0 10 12"><polygon points="0,0 10,6 0,12"/></svg></div>
        </div>
        <h1 class="nf-profile-title">Quem está assistindo?</h1>
        <div class="nf-profile-grid">
          ${d2.profiles.map(p => `
            <div class="nf-profile-item" data-id="${escHtml(p.id)}">
              <div class="nf-avatar-wrap">
                <div class="nf-avatar" style="background:${escHtml(p.color)}">${p.emoji}</div>
              </div>
              <div class="nf-profile-name">${escHtml(p.name)}${p.isKids ? '<span class="nf-kids-badge">KIDS</span>' : ''}</div>
            </div>`).join('')}
          ${d2.profiles.length < 5 ? `
            <div class="nf-profile-item nf-add-item" id="nfAddNew">
              <div class="nf-avatar-wrap">
                <div class="nf-avatar nf-avatar-add">＋</div>
              </div>
              <div class="nf-profile-name">Adicionar perfil</div>
            </div>` : ''}
        </div>
      </div>`;

    overlay.querySelectorAll('.nf-profile-item:not(.nf-add-item)').forEach(item => {
      item.addEventListener('click', () => {
        const d3 = getProfileData();
        d3.currentId = item.dataset.id;
        const p = d3.profiles.find(x => x.id === item.dataset.id);
        if (p) p.lastUsed = Date.now();
        saveProfiles(d3);
        renderProfileSidebar();
        loadProfileState();
        overlay.classList.add('nf-fade-out');
        setTimeout(() => { overlay.remove(); if (onDone) onDone(); }, 300);
      });
    });

    const addBtn = overlay.querySelector('#nfAddNew');
    if (addBtn) addBtn.addEventListener('click', () => openProfileEditor(null, overlay, () => render()));
  };

  render();
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('nf-visible'));
}

function showForceCreateProfile(onDone) {
  const EMOJIS = ['👤','😀','😎','🦁','🐯','🐺','🦊','🐸','🐧','🦄','🎮','⚽','🏀','🎵','🌟'];
  const COLORS = ['#00D4FF','#9D4EDD','#FFB703','#E50914','#00C853','#FF6EC7','#FF6B35','#4FC3F7','#A5D6A7','#CE93D8'];
  let selEmoji = '👤', selColor = '#00D4FF';

  const overlay = document.createElement('div');
  overlay.className = 'nf-profile-overlay nf-visible';
  overlay.style.zIndex = '800';
  overlay.innerHTML = `
    <div class="nf-profile-screen" style="max-width:480px;width:90%;">
      <div class="nf-profile-logo">
        <span class="husky">Husky</span><span class="play-text">Play</span>
        <div class="play-icon"><svg viewBox="0 0 10 12"><polygon points="0,0 10,6 0,12"/></svg></div>
      </div>
      <h1 class="nf-profile-title" style="font-size:1.6rem;">Bem-vindo! 👋</h1>
      <p style="color:var(--text-muted);font-size:.9rem;margin:-12px 0 24px;text-align:center;">Crie seu perfil para começar</p>

      <div style="text-align:center;margin-bottom:20px;">
        <div id="fcPreview" style="width:80px;height:80px;border-radius:50%;background:${selColor};display:flex;align-items:center;justify-content:center;font-size:2.4rem;margin:0 auto 8px;border:3px solid rgba(255,255,255,.2);">${selEmoji}</div>
      </div>

      <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-bottom:16px;">
        ${EMOJIS.map(e => `<button class="fc-emoji" data-e="${e}" style="font-size:1.5rem;background:#1e1e1e;border:2px solid transparent;border-radius:8px;width:42px;height:42px;cursor:pointer;transition:border-color .15s;">${e}</button>`).join('')}
      </div>
      <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-bottom:20px;">
        ${COLORS.map(c => `<button class="fc-color" data-c="${c}" style="width:28px;height:28px;border-radius:50%;background:${c};border:2px solid transparent;cursor:pointer;transition:border-color .15s;"></button>`).join('')}
      </div>

      <div style="width:100%;margin-bottom:14px;">
        <label style="font-size:.8rem;color:var(--text-muted);display:block;margin-bottom:4px;">Seu nome <span style="color:#ff5555;">*</span></label>
        <input id="fcName" type="text" placeholder="Como quer ser chamado?" maxlength="20"
          style="width:100%;padding:.65rem .9rem;background:#1e1e1e;border:1px solid #333;border-radius:8px;color:#fff;font-size:.95rem;outline:none;"/>
      </div>
      <div style="width:100%;margin-bottom:14px;">
        <label style="font-size:.8rem;color:var(--text-muted);display:block;margin-bottom:4px;">Time do coração ⚽ <span style="color:#ff5555;">*</span></label>
        <input id="fcTeam" type="text" placeholder="Ex: Flamengo, Corinthians..." maxlength="30"
          style="width:100%;padding:.65rem .9rem;background:#1e1e1e;border:1px solid #333;border-radius:8px;color:#fff;font-size:.95rem;outline:none;"/>
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;">
        <input type="checkbox" id="fcKids" style="width:16px;height:16px;cursor:pointer;"/>
        <label for="fcKids" style="font-size:.9rem;cursor:pointer;">Este é um perfil Kids 🧒</label>
      </div>
      <button id="fcSave" style="width:100%;padding:.8rem;background:var(--accent-cyan);color:#000;font-weight:800;border-radius:8px;font-size:1rem;border:none;cursor:pointer;opacity:.5;" disabled>
        Criar perfil e entrar →
      </button>
      <p id="fcError" style="color:#ff5555;font-size:.8rem;margin-top:8px;text-align:center;display:none;"></p>
    </div>`;

  document.body.appendChild(overlay);

  const preview  = overlay.querySelector('#fcPreview');
  const nameEl   = overlay.querySelector('#fcName');
  const teamEl   = overlay.querySelector('#fcTeam');
  const saveBtn  = overlay.querySelector('#fcSave');
  const errorEl  = overlay.querySelector('#fcError');

  const validate = () => {
    const ok = nameEl.value.trim().length > 0 && teamEl.value.trim().length > 0;
    saveBtn.disabled = !ok;
    saveBtn.style.opacity = ok ? '1' : '.5';
  };
  nameEl.addEventListener('input', validate);
  teamEl.addEventListener('input', validate);

  overlay.querySelectorAll('.fc-emoji').forEach(btn => {
    btn.addEventListener('click', () => {
      overlay.querySelectorAll('.fc-emoji').forEach(b => b.style.borderColor = 'transparent');
      btn.style.borderColor = '#fff';
      selEmoji = btn.dataset.e;
      preview.textContent = selEmoji;
    });
  });

  overlay.querySelectorAll('.fc-color').forEach(btn => {
    btn.addEventListener('click', () => {
      overlay.querySelectorAll('.fc-color').forEach(b => b.style.borderColor = 'transparent');
      btn.style.borderColor = '#fff';
      selColor = btn.dataset.c;
      preview.style.background = selColor;
    });
  });

  saveBtn.addEventListener('click', () => {
    const name = nameEl.value.trim();
    const team = teamEl.value.trim();
    if (!name || !team) { errorEl.textContent = 'Preencha nome e time.'; errorEl.style.display = ''; return; }
    const isKids = overlay.querySelector('#fcKids').checked;
    const d = getProfileData();
    // Replace the default "Principal" profile or add new
    const defaultIdx = d.profiles.findIndex(p => p.name === 'Principal' && p.emoji === '👤');
    const newP = { id: defaultIdx >= 0 ? d.profiles[defaultIdx].id : genId(), name, emoji: selEmoji, color: selColor, isKids, favoriteTeam: team, maxRating: null, lastUsed: Date.now() };
    if (defaultIdx >= 0) d.profiles[defaultIdx] = newP;
    else d.profiles.push(newP);
    d.currentId = newP.id;
    saveProfiles(d);
    renderProfileSidebar();
    loadProfileState();
    overlay.classList.add('nf-fade-out');
    setTimeout(() => { overlay.remove(); if (onDone) onDone(); }, 300);
  });
}

function startApp() {
  loadProfileState();
  setActivePage(_returnPage || 'home');

  // Reopen detail overlay if returning from player
  if (_returnPage) {
    try {
      const _rd = sessionStorage.getItem('hp_return_detail');
      if (_rd) {
        sessionStorage.removeItem('hp_return_detail');
        const { type, item } = JSON.parse(_rd);
        setTimeout(() => {
          if (type === 'movies') openMovieDetail(item);
          else if (type === 'series') openSeries(item);
        }, 600);
      }
    } catch {}
  }
}

runSplash();
