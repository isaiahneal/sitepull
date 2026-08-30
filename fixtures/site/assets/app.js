const CONTENT_URL = '/content/routes.json';

const accentVariables = {
  amber: 'var(--color-amber)',
  cobalt: 'var(--color-cobalt)',
  coral: 'var(--color-coral)',
  moss: 'var(--color-moss)',
  violet: 'var(--color-violet)',
};

let content;
let lazyObserver;

function normalizePath(pathname) {
  if (pathname === '/') return pathname;
  return pathname.replace(/\/+$/, '') || '/';
}

function currentRoute() {
  const path = normalizePath(window.location.pathname);
  return content.routes.find((route) => route.path === path) ?? content.routes[0];
}

function routeNavigation(activeRoute) {
  return content.routes
    .map(
      (route) => `
        <li>
          <a
            class="nav-link"
            href="${route.path}"
            ${route.path === activeRoute.path ? 'aria-current="page"' : ''}
          >${route.label}</a>
        </li>`,
    )
    .join('');
}

function featureCards() {
  return content.cards
    .map((card, index) => {
      const assetSuffix = index % 2 === 0 ? 'a' : 'b';
      const loading = index < 2 ? 'eager' : 'lazy';
      return `
        <article class="feature-card" data-component="feature-card" data-card-index="${index + 1}">
          <div class="card-media">
            <img
              src="/assets/checker-${assetSuffix}.png"
              width="64"
              height="64"
              loading="${loading}"
              decoding="async"
              alt="Raster fixture ${assetSuffix.toUpperCase()}"
            />
          </div>
          <span class="card-badge" aria-hidden="true">${card.badge}</span>
          <p class="card-kicker">${card.kicker}</p>
          <h3>${card.title}</h3>
          <p>${card.copy}</p>
          <a
            class="card-link"
            href="/work/case-study?card=${index + 1}&amp;utm_content=repeated-card"
          >Inspect pattern <span aria-hidden="true">→</span></a>
        </article>`;
    })
    .join('');
}

function contactPanel(route) {
  if (route.path !== '/contact') return '';

  return `
    <form class="contact-panel" data-fixture-form>
      <div class="field">
        <label for="fixture-name">Name</label>
        <input id="fixture-name" name="name" autocomplete="name" value="Local crawler" />
      </div>
      <div class="field">
        <label for="fixture-note">Note</label>
        <textarea id="fixture-note" name="note" rows="4">No request leaves loopback.</textarea>
      </div>
      <button class="button" type="submit">Test local form</button>
      <output data-form-output aria-live="polite"></output>
    </form>`;
}

function linkLaboratory() {
  return `
    <section class="section-block" aria-labelledby="link-lab-title">
      <div class="section-inner link-lab">
        <div>
          <p class="eyebrow">Route laboratory</p>
          <h2 id="link-lab-title">Links a crawler must classify.</h2>
          <p class="section-copy">
            These anchors are hydrated, visible, and intentionally mix crawlable same-origin
            pages with fragments, trackers, downloads, schemes, and outside origins.
          </p>
        </div>
        <ul class="link-list">
          <li><a href="/about">Internal route</a></li>
          <li><a href="/about/">Trailing slash duplicate</a></li>
          <li><a href="/about#team">Fragment duplicate</a></li>
          <li><a href="/work?utm_source=fixture&amp;utm_medium=qa&amp;fbclid=fixture-id">Tracking parameters</a></li>
          <li><a href="/work?b=2&amp;a=1">Canonical query order</a></li>
          <li><a href="/search?page=1&amp;sort=recent">Finite query route</a></li>
          <li><a href="https://example.com/sitepull-fixture">External HTTPS</a></li>
          <li><a href="//example.org/protocol-relative">Protocol-relative external</a></li>
          <li><a href="mailto:fixture@example.test">Email scheme</a></li>
          <li><a href="tel:+15550102020">Telephone scheme</a></li>
          <li><a href="javascript:void(0)">JavaScript scheme</a></li>
          <li><a href="/downloads/sitepull-fixture.pdf" download>Download attribute</a></li>
          <li><a href="/assets/fixture-archive.zip">Obvious archive</a></li>
          <li><a href="/missing-page">Intentional 404</a></li>
        </ul>
      </div>
    </section>`;
}

function render() {
  lazyObserver?.disconnect();

  const route = currentRoute();
  const accent = accentVariables[route.accent] ?? accentVariables.cobalt;
  const app = document.querySelector('#app');
  const canonical = document.querySelector('link[rel="canonical"]');

  document.documentElement.dataset.route = route.path;
  document.documentElement.style.setProperty('--route-accent', accent);
  document.title = `${route.label} · ${content.siteName}`;
  canonical.href = new URL(route.path, window.location.origin).href;

  app.innerHTML = `
    <header class="site-header">
      <div class="header-inner">
        <a class="brand" href="/" aria-label="${content.siteName} home">
          <span class="brand-mark" aria-hidden="true">FA</span>
          <span>${content.siteName}</span>
        </a>
        <nav aria-label="Primary navigation">
          <ul class="nav-list">${routeNavigation(route)}</ul>
        </nav>
      </div>
    </header>

    <main id="main-content">
      <section class="hero">
        <div class="section-inner hero-grid">
          <div>
            <p class="eyebrow">${route.eyebrow}</p>
            <h1>${route.title}</h1>
            <p class="lede">${route.summary}</p>
            <div class="chip-row" aria-label="Fixture capabilities">
              <span class="chip">Hydrated</span>
              <span class="chip">Same origin</span>
              <span class="chip">Responsive</span>
              <span class="chip">Deterministic</span>
            </div>
            ${contactPanel(route)}
          </div>
          <figure class="hero-art">
            <img src="/assets/illustration.svg" width="640" height="640" alt="Abstract extraction diagram" />
            <figcaption class="route-note">Rendered route: <code>${route.path}</code></figcaption>
          </figure>
        </div>
      </section>

      <section class="section-block" aria-labelledby="patterns-title">
        <div class="section-inner">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Repeated candidates</p>
              <h2 id="patterns-title">Six cards, one component-shaped structure.</h2>
            </div>
            <p class="section-copy">
              The two raster URLs alternate across these cards but resolve to identical bytes,
              allowing content-hash deduplication to be tested independently from URL identity.
            </p>
          </div>
          <div class="card-grid">${featureCards()}</div>
        </div>
      </section>

      ${linkLaboratory()}

      <section class="section-inner lazy-zone" aria-label="Lazy content test">
        <div id="lazy-boundary" class="lazy-boundary" data-lazy-state="waiting">
          <p>Scroll boundary waiting for intersection.</p>
        </div>
      </section>
    </main>

    <footer class="site-footer">
      <div class="footer-inner">
        <strong>${content.siteName}</strong>
        <span>Deterministic loopback fixture · no external runtime requests</span>
      </div>
    </footer>`;

  app.setAttribute('aria-busy', 'false');
  wireLazyBoundary(route);
  wireContactForm();
}

function wireContactForm() {
  const form = document.querySelector('[data-fixture-form]');
  if (!form) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    form.querySelector('[data-form-output]').textContent = 'Fixture form handled locally.';
  });
}

function wireLazyBoundary(route) {
  const boundary = document.querySelector('#lazy-boundary');

  const reveal = async () => {
    if (boundary.dataset.lazyState !== 'waiting') return;
    boundary.dataset.lazyState = 'loading';
    boundary.innerHTML = '<p>Fetching lazy fixture content…</p>';

    const response = await fetch(`/api/lazy?route=${encodeURIComponent(route.path)}`);
    if (!response.ok) throw new Error(`Lazy fixture returned ${response.status}`);
    const payload = await response.json();

    boundary.className = 'lazy-content';
    boundary.dataset.lazyState = 'loaded';
    boundary.innerHTML = `
      <div>
        <p class="eyebrow">${payload.eyebrow}</p>
        <h2>${payload.title}</h2>
        <p>${payload.copy}</p>
      </div>`;
  };

  if (!('IntersectionObserver' in window)) {
    void reveal();
    return;
  }

  lazyObserver = new IntersectionObserver(
    (entries, observer) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void reveal();
    },
    { rootMargin: '120px 0px', threshold: 0.05 },
  );
  lazyObserver.observe(boundary);
}

function shouldHandleAsSpaNavigation(event, anchor) {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (anchor.hasAttribute('download') || anchor.target) return false;

  const target = new URL(anchor.href, window.location.href);
  if (target.origin !== window.location.origin || target.hash) return false;

  const path = normalizePath(target.pathname);
  return content.routes.some((route) => route.path === path) || path === '/search';
}

document.addEventListener('click', (event) => {
  const anchor = event.target.closest('a[href]');
  if (!anchor || !shouldHandleAsSpaNavigation(event, anchor)) return;

  event.preventDefault();
  history.pushState({}, '', anchor.href);
  render();
  window.scrollTo({ top: 0, behavior: 'auto' });
});

window.addEventListener('popstate', render);

async function boot() {
  const response = await fetch(CONTENT_URL);
  if (!response.ok) throw new Error(`Route fixture returned ${response.status}`);
  content = await response.json();
  render();
  document.documentElement.dataset.hydrated = 'true';
  window.__SITEPULL_FIXTURE_READY__ = true;
  window.dispatchEvent(new CustomEvent('sitepull:fixture-ready'));
}

boot().catch((error) => {
  const app = document.querySelector('#app');
  app.setAttribute('aria-busy', 'false');
  app.innerHTML = `<main class="loading-shell"><h1>Fixture hydration failed.</h1><pre></pre></main>`;
  app.querySelector('pre').textContent = error instanceof Error ? error.message : String(error);
  console.error(error);
});

//# sourceMappingURL=/assets/app.js.map
