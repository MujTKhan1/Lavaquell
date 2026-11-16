import Lenis from 'lenis';
import 'lenis/dist/lenis.css';

/*
 * Motion layer, inspired by lusion.co and sofihealth.com:
 *  - inertial smooth scrolling (mouse/trackpad only; touch keeps native momentum)
 *  - headings revealed word by word from behind masks
 *  - images uncovered with a clip-path wipe, then drifting with scroll (parallax)
 *  - dark sections that grow into place as rounded "sheets"
 *  - a soft cursor follower and magnetic buttons (fine pointers only)
 *  - the hotel marquee speeding up with scroll velocity
 * Everything is skipped when the visitor prefers reduced motion.
 */
const clamp01 = (x) => Math.min(1, Math.max(0, x));

function splitWords(el) {
  let d = 0;
  const walk = (node) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === 3) {
        const frag = document.createDocumentFragment();
        child.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) return frag.appendChild(document.createTextNode(part));
          const w = document.createElement('span');
          w.className = 'w';
          const wi = document.createElement('span');
          wi.className = 'wi';
          wi.style.setProperty('--d', d++);
          wi.textContent = part;
          w.appendChild(wi);
          frag.appendChild(w);
        });
        child.replaceWith(frag);
      } else if (child.nodeType === 1) walk(child);
    });
  };
  el.setAttribute('aria-label', el.textContent.replace(/\s+/g, ' ').trim());
  walk(el);
  el.querySelectorAll('.w').forEach((w) => w.setAttribute('aria-hidden', 'true'));
}

export function initMotion({ reduced, coarse }) {
  const $$ = (s) => [...document.querySelectorAll(s)];
  const revealTargets = () => $$('[data-split], [data-fade], [data-card]');
  if (reduced) {
    revealTargets().forEach((el) => el.classList.add('is-in'));
    return { lenis: null };
  }
  document.documentElement.classList.add('motion');

  /* 1. smooth scroll */
  let lenis = null;
  if (!coarse) {
    lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.95, anchors: { offset: -64 } });
    const raf = (t) => {
      lenis.raf(t);
      requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
  }

  /* 2. word-by-word headings + 3. reveals */
  $$('[data-split]').forEach(splitWords);
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      }),
    { rootMargin: '0px 0px -12% 0px', threshold: 0.15 }
  );
  revealTargets().forEach((el) => io.observe(el));

  /* 4. parallax, 5. sheets */
  const parallax = $$('[data-parallax]');
  const sheets = $$('[data-sheet]');
  function onScroll() {
    const vh = window.innerHeight;
    for (const img of parallax) {
      const r = img.parentElement.getBoundingClientRect();
      if (r.bottom < -100 || r.top > vh + 100) continue;
      const c = (r.top + r.height / 2 - vh / 2) / vh; // -1..1 around centre
      img.style.transform = `translate3d(0, ${(c * -7).toFixed(2)}%, 0) scale(1.14)`;
    }
    for (const s of sheets) {
      const r = s.getBoundingClientRect();
      const p = clamp01((vh - r.top) / (vh * 0.85));
      if (p >= 1) {
        if (s.style.transform) { s.style.transform = ''; s.style.borderRadius = ''; }
        continue;
      }
      const e = 1 - Math.pow(1 - p, 3);
      s.style.transform = `scale(${(0.9 + 0.1 * e).toFixed(4)})`;
      s.style.borderRadius = `${((1 - e) * 48).toFixed(1)}px ${((1 - e) * 48).toFixed(1)}px 0 0`;
    }
  }
  let ticking = false;
  const schedule = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      onScroll();
    });
  };
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  onScroll();

  /* 7. marquee reacts to scroll velocity */
  const marquee = $$('.marquee__track').flatMap((t) => t.getAnimations());
  if (lenis && marquee.length) {
    let rate = 1;
    lenis.on('scroll', ({ velocity }) => {
      const target = 1 + Math.min(4, Math.abs(velocity) / 6);
      rate += (target - rate) * 0.2;
      marquee.forEach((a) => (a.playbackRate = rate));
    });
    setInterval(() => {
      rate += (1 - rate) * 0.15;
      marquee.forEach((a) => (a.playbackRate = rate));
    }, 100);
  }

  /* 6. cursor follower + magnetic buttons (fine pointers only) */
  if (!coarse && window.matchMedia('(pointer: fine)').matches) {
    const dot = document.createElement('div');
    dot.className = 'cursor';
    dot.setAttribute('aria-hidden', 'true');
    dot.innerHTML = '<span class="cursor__label">View</span>';
    document.body.appendChild(dot);
    let mx = -100, my = -100, x = -100, y = -100;
    window.addEventListener('pointermove', (e) => {
      mx = e.clientX;
      my = e.clientY;
      const t = e.target.closest?.('a, button, [data-card], summary, input, select, textarea');
      dot.classList.toggle('is-link', !!t && !t.matches('[data-card], input, select, textarea'));
      dot.classList.toggle('is-card', !!t && t.matches('[data-card]'));
      dot.classList.toggle('is-hidden', !!t && t.matches('input, select, textarea'));
    }, { passive: true });
    document.addEventListener('pointerleave', () => dot.classList.add('is-out'));
    document.addEventListener('pointerenter', () => dot.classList.remove('is-out'));
    const loop = () => {
      x += (mx - x) * 0.2;
      y += (my - y) * 0.2;
      dot.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      requestAnimationFrame(loop);
    };
    loop();

    $$('.btn, .link-arrow, .nav__cta').forEach((el) => {
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        el.style.transform = `translate(${dx * 0.18}px, ${dy * 0.3}px)`;
      });
      el.addEventListener('pointerleave', () => (el.style.transform = ''));
    });

    // hero art drifts a little with the pointer
    const art = document.querySelector('.hero__art img');
    const hero = document.querySelector('[data-hero]');
    if (art && hero) {
      hero.addEventListener('pointermove', (e) => {
        const nx = e.clientX / window.innerWidth - 0.5, ny = e.clientY / window.innerHeight - 0.5;
        art.style.translate = `${(nx * -14).toFixed(1)}px ${(ny * -10).toFixed(1)}px`;
      }, { passive: true });
    }
  }

  return { lenis };
}
