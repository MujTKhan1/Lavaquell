import '@fontsource-variable/manrope';
import './styles.css';
import { RANGE } from './products.js';
import { initMotion } from './motion.js';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const isReduced = () => reduced.matches || location.search.includes('reduced');
const coarse = window.matchMedia('(pointer: coarse)').matches;
const lowPower = window.matchMedia('(max-width: 820px)').matches || coarse || (navigator.hardwareConcurrency || 8) <= 4;

document.documentElement.classList.add('js');
if (isReduced()) document.documentElement.classList.add('reduced');

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const range = (p, a, b) => clamp01((p - a) / (b - a));
const bell = (p, a, b, c, d) => range(p, a, b) * (1 - range(p, c, d));

/* ---------------- Navigation ---------------- */
const nav = $('[data-nav]');
const toggle = $('[data-nav-toggle]');
const closeMenu = () => {
  toggle.setAttribute('aria-expanded', 'false');
  nav.classList.remove('is-open');
};
toggle.addEventListener('click', () => {
  const open = toggle.getAttribute('aria-expanded') !== 'true';
  toggle.setAttribute('aria-expanded', String(open));
  nav.classList.toggle('is-open', open);
});
$$('#nav-links a').forEach((a) => a.addEventListener('click', closeMenu));
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeMenu());

// Header theme follows whatever section sits under it
const themed = $$('[data-theme]').filter((el) => el !== nav);
function paintNavTheme() {
  const y = 36;
  const under = themed.find((el) => {
    const r = el.getBoundingClientRect();
    return r.top <= y && r.bottom > y;
  });
  nav.dataset.theme = under?.dataset.theme || 'light';
  nav.classList.toggle('is-solid', window.scrollY > 40);
}

/* Keep each 3D scene rendering only while it is on screen and the tab is visible */
function watch(el, scene) {
  let visible = false;
  const set = () => scene.setActive(visible && !document.hidden);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; set(); }, { rootMargin: '100px 0px' }).observe(el);
  document.addEventListener('visibilitychange', set);
}
const noWebGL = location.search.includes('static');

/* ---------------- Hero ----------------
 * Static art for now. The animated 3D version (src/three/productHero.js) is
 * kept in the repo, unused, for when the hero animation returns. */
const hero = $('[data-hero]');

/* ---------------- Section two: the bottle rises (own scroll progress) ---------------- */
const reveal = $('[data-reveal-section]');
const revealStage = $('[data-reveal-stage]');
const revealIntro = $('[data-reveal-intro]');
const callouts = $$('[data-callout]');
const revealEnd = $('[data-reveal-end]');
const revealFade = $('[data-reveal-fade]');
let revealScene = null;

function revealProgress() {
  const travel = reveal.offsetHeight - window.innerHeight;
  // 0 until the section's top reaches the top of the viewport: scrolling the hero never advances it
  return travel > 0 ? clamp01(-reveal.getBoundingClientRect().top / travel) : 1;
}
function paintReveal() {
  const p = revealProgress();
  revealScene?.setProgress(p);
  if (isReduced()) return;
  const out = range(p, 0.22, 0.4);
  revealIntro.style.opacity = String(1 - out);
  revealIntro.style.transform = `translate3d(0, ${-out * 40}px, 0)`;
  callouts.forEach((c, i) => {
    const v = i === 0 ? bell(p, 0.42, 0.52, 0.68, 0.76) : bell(p, 0.55, 0.64, 0.8, 0.86);
    c.style.opacity = String(v);
    c.style.transform = `translate3d(0, ${(1 - v) * 16}px, 0)`;
  });
  const e = range(p, 0.86, 0.95);
  revealEnd.style.opacity = String(e);
  revealEnd.style.transform = `translate3d(0, ${(1 - e) * 16}px, 0)`;
  revealFade.style.opacity = String(range(p, 0.9, 1));
}
// Live 3D bottle (real Lavaquell shape, exported from render/lavaquell_scene.py),
// driven by this section's own scroll progress
async function initReveal() {
  if (noWebGL) return;
  try {
    const { createEmergence } = await import('./three/emergence.js');
    revealScene = await createEmergence(revealStage, { reducedMotion: isReduced(), lowPower });
  } catch (err) {
    console.warn('Reveal scene unavailable.', err);
  }
  if (!revealScene) return;
  if (import.meta.env.DEV) window.__reveal = revealScene;
  reveal.classList.add('has-3d');
  watch(reveal, revealScene);
  paintReveal();
}
(window.requestIdleCallback || ((f) => setTimeout(f, 600)))(() => initReveal(), { timeout: 1500 });

/* ---------------- Collection: every product shown on its own ---------------- */
const rangeEl = $('[data-range]');
rangeEl.innerHTML = RANGE.map(
  (group, g) => `
  <section class="range__group" aria-labelledby="range-${g}">
    <h3 class="range__title" id="range-${g}" data-fade><span>${String(g + 1).padStart(2, '0')}</span>${group.category}</h3>
    <ul class="range__grid">
      ${group.items
        .map(
          (p, i) => `
        <li class="card" data-card style="--i:${i}">
          <figure class="card__media" data-media>
            <img src="/assets/${p.img}-800.webp" srcset="/assets/${p.img}-800.webp 800w, /assets/${p.img}-1600.webp 1600w"
              sizes="(max-width: 700px) 92vw, (max-width: 1100px) 46vw, 30vw" alt="${p.alt}" loading="lazy" decoding="async" data-parallax />
            <span class="card__badge">${p.badge}</span>
          </figure>
          <div class="card__body">
            <p class="card__format">LAVAQUELL · ${p.format}</p>
            <h4 class="card__name">${p.name}</h4>
            <p class="card__cap">${p.capacity}</p>
            <button class="card__toggle" type="button" aria-expanded="false" aria-controls="card-${g}-${i}">
              <span>View details</span><i aria-hidden="true"></i>
            </button>
            <div class="card__more" id="card-${g}-${i}" hidden>
              <p>${p.desc}</p>
              <a class="btn btn--navy btn--sm" href="#contact" data-enquiry-type="${p.enquiry}">Enquire Now</a>
            </div>
          </div>
        </li>`
        )
        .join('')}
    </ul>
  </section>`
).join('');
$$('.card__toggle', rangeEl).forEach((btn) =>
  btn.addEventListener('click', () => {
    const open = btn.getAttribute('aria-expanded') !== 'true';
    const more = document.getElementById(btn.getAttribute('aria-controls'));
    btn.setAttribute('aria-expanded', String(open));
    btn.querySelector('span').textContent = open ? 'Hide details' : 'View details';
    more.hidden = !open;
    btn.closest('.card').classList.toggle('is-open', open);
  })
);

// Any enquiry link pre-selects the enquiry type
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-enquiry-type]');
  if (a) $('[data-enquiry-select]').value = a.dataset.enquiryType;
});

/* ---------------- Cycle (no pinning: driven by the section's pass through the viewport) ---------------- */
const cycle = $('[data-cycle]');
const steps = $$('[data-cycle-steps] li');
const ringProgress = $('[data-ring-progress]');
const ringBottle = $('[data-ring-bottle]');
const ringNodes = $('[data-ring-nodes]');
const cycleNum = $('[data-cycle-num]');
const R = 160, C = 2 * Math.PI * R;
ringProgress.style.strokeDasharray = `${C}`;
for (let i = 0; i < 5; i++) {
  const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
  const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  c.setAttribute('cx', String(200 + Math.cos(a) * R));
  c.setAttribute('cy', String(200 + Math.sin(a) * R));
  c.setAttribute('r', '7');
  c.setAttribute('class', 'ring__node');
  ringNodes.appendChild(c);
}
const nodes = $$('.ring__node');
let activeStep = -1;
function setStep(i) {
  if (i === activeStep) return;
  activeStep = i;
  steps.forEach((s, k) => s.classList.toggle('is-active', k === i));
  nodes.forEach((n, k) => n.classList.toggle('is-on', k <= i));
  cycleNum.textContent = String(i + 1).padStart(2, '0');
}
function paintCycle() {
  const ring = $('.cycle__ring').getBoundingClientRect();
  const vh = window.innerHeight;
  // ring centre travels from 85% to 30% of the viewport
  const mid = ring.top + ring.height / 2;
  const p = isReduced() ? 1 : clamp01((vh * 0.85 - mid) / (vh * 0.55));
  const loop = Math.min(0.9999, p);
  ringProgress.style.strokeDashoffset = String(C * (1 - loop));
  const a = loop * Math.PI * 2 - Math.PI / 2;
  ringBottle.setAttribute('transform', `translate(${200 + Math.cos(a) * R} ${200 + Math.sin(a) * R}) rotate(${(loop * 360).toFixed(1)})`);
  setStep(isReduced() ? 0 : Math.min(4, Math.floor(loop * 5)));
}
if (isReduced()) steps.forEach((s) => s.classList.add('is-active'));

/* ---------------- Scroll loop ---------------- */
let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    paintReveal();
    paintCycle();
    paintNavTheme();
    document.body.classList.toggle('in-hero', window.scrollY < hero.offsetHeight * 0.6);
  });
}
window.addEventListener('scroll', onScroll, { passive: true });
window.addEventListener('resize', onScroll);
onScroll();

/* ---------------- Reveals ---------------- */
const revealIO = new IntersectionObserver(
  (entries) =>
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add('is-in');
      revealIO.unobserve(e.target);
    }),
  { rootMargin: '0px 0px -8% 0px', threshold: 0.1 }
);
$$('[data-reveal]').forEach((el) => revealIO.observe(el));

/* ---------------- Marquee ---------------- */
const track = $('.marquee__track');
const clone = track.cloneNode(true);
clone.setAttribute('aria-hidden', 'true');
track.parentElement.appendChild(clone);

/* ---------------- FAQ: one open at a time ---------------- */
$$('.faq details').forEach((d) =>
  d.addEventListener('toggle', () => {
    if (d.open) $$('.faq details').forEach((o) => o !== d && (o.open = false));
  })
);

/* ---------------- Enquiry form ----------------
 * The live site posts through a third-party mail service whose keys are not
 * available here; this concept composes the enquiry in the visitor's email app. */
const form = $('[data-enquiry-form]');
const status = $('[data-form-status]');
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = new FormData(form);
  const missing = [];
  ['name', 'email', 'message'].forEach((k) => {
    const el = form.elements[k];
    const bad = !String(data.get(k) || '').trim() || (k === 'email' && !el.checkValidity());
    el.toggleAttribute('aria-invalid', bad);
    if (bad) missing.push(el.closest('.field').querySelector('span').textContent.replace(' *', ''));
  });
  if (missing.length) {
    status.textContent = `Please complete: ${missing.join(', ')}.`;
    status.className = 'form__status is-error';
    form.querySelector('[aria-invalid]')?.focus();
    return;
  }
  const type = form.elements.type.selectedOptions[0].textContent;
  const body = [
    `Name: ${data.get('name')}`,
    `Email: ${data.get('email')}`,
    data.get('phone') ? `Phone: ${data.get('phone')}` : '',
    data.get('company') ? `Company / Property: ${data.get('company')}` : '',
    `Enquiry type: ${type}`,
    '',
    String(data.get('message')),
  ]
    .filter((l, i, arr) => l !== '' || arr[i - 1] !== '')
    .join('\n');
  window.location.href = `mailto:info@airowaterglobal.com?subject=${encodeURIComponent(`Enquiry: ${type}`)}&body=${encodeURIComponent(body)}`;
  status.textContent = 'Your email app should open with the enquiry ready to send. Thank you for reaching out.';
  status.className = 'form__status is-ok';
});

reduced.addEventListener?.('change', () => location.reload());

/* ---------------- Motion (smooth scroll, reveals, cursor) ---------------- */
initMotion({ reduced: isReduced(), coarse });
