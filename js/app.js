// Поведение страницы: плавный скролл, 3D-въезд секций, курсор, магниты,
// кольцо типов, карусель снимков, ролик, звук, языки.
//
// Скорость: один общий цикл на всё (страница + 3D-сцена). Геометрия вёрстки меряется только
// при изменении размеров (ResizeObserver), в кадре — одна арифметика от scrollY, без чтения раскладки.
// В стили пишется только то, что изменилось; невидимые секции в кадре не трогаются.
import { state, render } from './scene.js';
import { RU, EN } from './i18n.js';

if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
scrollTo(0, 0);

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(pointer: fine)').matches;
const small = () => G.W <= 620;
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const clamp01 = x => clamp(x, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
if (fine) document.documentElement.classList.add('fine');

let lang = document.documentElement.lang === 'en' ? 'en' : 'ru';
const dictOf = l => l === 'en' ? EN : RU;

/* ───────── запись в стиль только при изменении ───────── */
function css(el, prop, v) {
  const k = '_s_' + prop;
  if (el[k] === v) return;
  el[k] = v;
  if (prop[0] === '-') el.style.setProperty(prop, v); else el.style[prop] = v;
}
function cls(el, c, on) {
  const k = '_c_' + c;
  if (el[k] === on) return;
  el[k] = on; el.classList.toggle(c, on);
}

/* ───────── зерно: плитка шума рисуется один раз, без SVG-фильтра и режима наложения ───────── */
{
  const c = document.createElement('canvas'); c.width = c.height = 160;
  const g = c.getContext('2d'), img = g.createImageData(160, 160), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const w = Math.random() < 0.5 ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = w; d[i + 3] = Math.random() * 255;
  }
  g.putImageData(img, 0, 0);
  $('.grain').style.backgroundImage = `url(${c.toDataURL('image/png')})`;
}

/* ───────── запасной SVG-знак: длины линий для «рисования» ───────── */
$$('.logo-draw path').forEach(p => p.style.setProperty('--len', p.getTotalLength().toFixed(1)));

/* ───────── заголовок по буквам ───────── */
const chars = [];
$$('[data-split]').forEach(el => {
  const txt = el.textContent; el.textContent = '';
  [...txt].forEach((c, i) => {
    const s = document.createElement('span'); s.className = 'ch';
    const inner = document.createElement('i'); inner.textContent = c;
    s.appendChild(inner); s.style.animationDelay = (0.55 + i * 0.075) + 's';
    el.appendChild(s); chars.push(inner);
  });
});

/* ───────── заголовки секций — по словам ───────── */
function splitWords(h) {
  // тире держится за предыдущее слово: строка с него не начинается
  const words = h.textContent.trim().split(/\s+/).reduce((a, w) => { if (/^[—–-]$/.test(w) && a.length) a[a.length - 1] += '\u00a0' + w; else a.push(w); return a; }, []);
  h.innerHTML = '';
  words.forEach((w, i) => {
    const o = document.createElement('span'); o.className = 'w';
    const s = document.createElement('span'); s.textContent = w;
    s.style.transitionDelay = (i * 70) + 'ms';
    o.appendChild(s); h.appendChild(o);
    if (i < words.length - 1) h.appendChild(document.createTextNode(' '));
  });
}
const heads = $$('main h2');
heads.forEach(splitWords);

/* ───────── появление ───────── */
const rise = $$('.kicker, .sub, .big, .steps li, .fact, .deck-nav, .repos, .foot, .screen, .end .big-btn, .ring-wrap, .deck');
rise.forEach((el, i) => { el.setAttribute('data-rise', ''); el.style.transitionDelay = (i % 5) * 70 + 'ms'; });
const io = new IntersectionObserver(es => es.forEach(e => {
  if (!e.isIntersecting) return;
  e.target.classList.add('in');
  if (e.target.matches('.fact')) countUp(e.target);
  io.unobserve(e.target);
}), { threshold: 0.15 });
[...rise, ...heads].forEach(el => io.observe(el));

function countUp(fact) {
  const b = fact.querySelector('[data-count]'); if (!b) return;
  const to = +b.dataset.count, t0 = performance.now();
  const step = now => { const k = clamp01((now - t0) / 1400); b.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

/* ───────── элементы ───────── */
const top = $('.top');
const links = $$('.menu a');
const progress = $('.progress i');
const heroSlot = $('[data-slot="hero"]'), endSlot = $('[data-slot="end"]');
const stages = $$('.sec').map(sec => ({ sec, id: sec.id, st: sec.querySelector('.stage'), top: 0, h: 0, ty: 0 })).filter(s => s.st);
const S = Object.fromEntries(stages.map(s => [s.id, s]));
const bandEl = $('.band');
const ringEl = $('#ring');
const types = $$('.type', ringEl);
const deck = $('#deck');
const cards = $$('.card', deck);
const screenEl = $('#screen'), video = $('#promo'), bar = $('#bar');
const cursor = $('.cursor'), cDot = $('.c-dot'), cRing = $('.c-ring'), cLabel = $('.c-label');

/* бегущая строка: копии, чтобы хватило на любую ширину */
const rows = $$('.band-row').map((row, i) => {
  const track = row.querySelector('.band-track');
  for (let k = 0; k < 3; k++) row.appendChild(track.cloneNode(true));
  return { row, x: 0, dir: i ? 1 : -1, w: 0 };
});

/* ───────── геометрия: меряется редко ───────── */
const G = { W: innerWidth, H: innerHeight, maxY: 1, hero: null, end: null, chars: [], cards: [], ringW: 0, deckW: 0, band: { y: 0, h: 0 } };
// положение в вёрстке без учёта 3D-наклонов (offset* их не видят)
function layoutBox(el) {
  let x = 0, y = 0, n = el;
  while (n) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}
let needMeasure = true;
function measure() {
  G.W = innerWidth; G.H = innerHeight;
  G.maxY = Math.max(1, document.documentElement.scrollHeight - innerHeight);
  stages.forEach(s => { const b = layoutBox(s.sec); s.top = b.y; s.h = b.h; });
  G.hero = layoutBox(heroSlot); G.end = layoutBox(endSlot);
  G.chars = chars.map(ch => { const b = layoutBox(ch.parentElement); return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; });
  G.cards = cards.map(c => ({ w: c.offsetWidth, h: c.offsetHeight }));
  G.ringW = ringEl.clientWidth; G.deckW = deck.clientWidth;
  const bb = layoutBox(bandEl); G.band = { y: bb.y, h: bb.h };
  rows.forEach(r => r.w = r.row.firstElementChild.offsetWidth);
}
const ro = new ResizeObserver(() => { needMeasure = true; });
[document.body, heroSlot, endSlot, ...stages.map(s => s.sec), ...cards, ...rows.map(r => r.row.firstElementChild)].forEach(el => ro.observe(el));
document.fonts && document.fonts.ready.then(() => { needMeasure = true; });
addEventListener('load', () => { needMeasure = true; });
addEventListener('resize', () => { needMeasure = true; }, { passive: true });

/* ───────── плавный скролл с инерцией (мышь и трекпад на десктопе) ───────── */
const smooth = fine && !reduce;
let sy = 0, ty = 0, gliding = false;
if (smooth) addEventListener('wheel', e => {
  if (e.ctrlKey) return;                                   // щипок — масштаб, не трогаем
  if (e.target.closest && e.target.closest('#deck') && Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
  e.preventDefault();
  const d = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaMode === 2 ? e.deltaY * innerHeight : e.deltaY;
  if (!gliding) sy = ty = scrollY;
  ty = clamp(ty + d, 0, G.maxY);
  gliding = true;
}, { passive: false });
function goTo(y) {
  y = clamp(y, 0, G.maxY);
  if (smooth) { if (!gliding) sy = scrollY; ty = y; gliding = true; }
  else scrollTo({ top: y, behavior: reduce ? 'auto' : 'smooth' });
}
$$('[data-nav]').forEach(a => a.addEventListener('click', e => {
  const id = a.getAttribute('href').slice(1);
  e.preventDefault();
  goTo(id === 'hero' ? 0 : (S[id] ? S[id].top : 0));
}));

/* ───────── указатель ───────── */
let px = innerWidth / 2, py = innerHeight / 2, rx = px, ry = py;
const LABELS = { ru: { drag: 'тяни', play: 'смотреть', pause: 'пауза' }, en: { drag: 'drag', play: 'play', pause: 'pause' } };
addEventListener('pointermove', e => {
  px = e.clientX; py = e.clientY;
  state.tmx = (px / G.W - 0.5) * 2;
  state.tmy = (py / G.H - 0.5) * 2;
  if (!fine) return;
  const t = e.target.closest ? e.target : null;
  const lab = t && t.closest('[data-cursor]');
  if (lab) {
    let k = lab.dataset.cursor;
    if (k === 'play' && screenEl.classList.contains('playing')) k = video.paused ? 'play' : 'pause';
    const txt = LABELS[lang][k];
    if (cLabel.textContent !== txt) cLabel.textContent = txt;
    cls(cursor, 'label', true); cls(cursor, 'hover', false);
  } else {
    cls(cursor, 'label', false);
    cls(cursor, 'hover', !!(t && t.closest('a, button, .type, [data-magnet-soft]')));
  }
}, { passive: true });
addEventListener('pointerdown', () => cls(cursor, 'down', true));
addEventListener('pointerup', () => cls(cursor, 'down', false));
document.addEventListener('pointerleave', () => cursor.style.opacity = '0');
document.addEventListener('pointerenter', () => cursor.style.opacity = '');

/* ───────── магниты: кнопки тянутся к курсору (рамка меряется один раз при входе) ───────── */
$$('[data-magnet]').forEach(el => {
  let r = null, y0 = 0;
  el.addEventListener('pointerenter', e => {
    r = el.getBoundingClientRect(); y0 = scrollY;
    el.style.setProperty('--hx', (e.clientX - r.left) + 'px');
    el.style.setProperty('--hy', (e.clientY - r.top) + 'px');
    blip(1046, 0.018, 0.25);
  });
  el.addEventListener('pointermove', e => {
    if (!fine || !r) return;
    const top0 = r.top - (scrollY - y0);
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (top0 + r.height / 2);
    el.classList.add('pull');
    el.style.transform = `translate3d(${(dx * 0.22).toFixed(1)}px, ${(dy * 0.32).toFixed(1)}px, 0)`;
    el.style.setProperty('--hx', (e.clientX - r.left).toFixed(0) + 'px');
    el.style.setProperty('--hy', (e.clientY - top0).toFixed(0) + 'px');
  });
  el.addEventListener('pointerleave', () => { el.classList.remove('pull'); el.style.transform = ''; r = null; });
});

/* карточки репозиториев наклоняются к курсору */
$$('[data-tilt]').forEach(el => {
  let r = null;
  el.addEventListener('pointerenter', () => { r = el.getBoundingClientRect(); blip(784, 0.02, 0.3); });
  el.addEventListener('pointermove', e => {
    if (!r) return;
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `rotateY(${(x * 14).toFixed(2)}deg) rotateX(${(-y * 14).toFixed(2)}deg) translateZ(10px)`;
  });
  el.addEventListener('pointerleave', () => { el.style.transform = ''; r = null; });
});

/* ───────── кольцо типов ИИ ───────── */
const TSTEP = (Math.PI * 2) / types.length;
let ringA = 0, ringT = 0, hoverI = -1;
types.forEach((el, i) => {
  el.addEventListener('pointerenter', () => {
    if (small()) return;
    hoverI = i;
    let want = -i * TSTEP;                              // доворачиваем кольцо лицом к карточке
    while (want - ringA > Math.PI) want -= Math.PI * 2;
    while (ringA - want > Math.PI) want += Math.PI * 2;
    ringT = want;
    blip(392 * Math.pow(2, [0, 2, 4, 7, 9, 12, 14, 16][i] / 12), 0.04, 0.6);
  });
  el.addEventListener('pointerleave', () => { if (hoverI === i) hoverI = -1; });
  el.addEventListener('click', () => {
    if (small()) return;
    hoverI = i; ringT = -i * TSTEP;
    el.animate([{ filter: 'brightness(1.8)' }, { filter: 'brightness(1)' }], { duration: 700, easing: 'ease-out' });
  });
});
function layoutRing() {
  const R = Math.min(G.ringW, 1000) * 0.4;
  let best = -1, bestF = -2;
  types.forEach((el, i) => {
    const a = i * TSTEP + ringA;
    const x = Math.sin(a) * R, z = Math.cos(a) * R;
    const front = (Math.cos(a) + 1) / 2;
    if (front > bestF) { bestF = front; best = i; }
    const pop = hoverI === i ? 60 : 0;
    css(el, 'transform', `translate3d(${x.toFixed(1)}px, ${(-front * 14).toFixed(1)}px, ${(z + pop - R * 0.35).toFixed(1)}px) rotateY(${a.toFixed(4)}rad) scale(${(0.78 + front * 0.26).toFixed(3)})`);
    css(el, 'opacity', (0.18 + Math.pow(front, 1.6) * 0.82).toFixed(3));
    css(el, 'zIndex', String(Math.round(front * 100)));
    css(el, 'pointerEvents', front > 0.3 ? 'auto' : 'none');
  });
  types.forEach((el, i) => cls(el, 'hot', i === (hoverI >= 0 ? hoverI : best) && bestF > 0.9));
  css(ringEl, 'transform', `rotateX(${(-4 - state.my * 6).toFixed(2)}deg) rotateY(${(state.mx * 5).toFixed(2)}deg)`);
}

/* ───────── карусель снимков ───────── */
const DSTEP = (Math.PI * 2) / cards.length;
const dotsEl = $('#dots');
const dots = cards.map((_, i) => {
  const b = document.createElement('button'); b.setAttribute('aria-label', String(i + 1));
  b.onclick = () => toCard(i); dotsEl.appendChild(b); return b;
});
let deckA = 0, deckT = 0, dragging = false, lastX = 0, dragV = 0, wheelTimer = 0, deckHover = false;
const frontIndex = a => ((Math.round(-a / DSTEP) % cards.length) + cards.length) % cards.length;
function toCard(i) {
  const cur = frontIndex(deckT);
  let d = i - cur;
  if (d > cards.length / 2) d -= cards.length;
  if (d < -cards.length / 2) d += cards.length;
  deckT -= d * DSTEP;
  whoosh(0.25);
}
$('#next').onclick = () => toCard(frontIndex(deckT) + 1);
$('#prev').onclick = () => toCard(frontIndex(deckT) - 1);

deck.addEventListener('pointerdown', e => {
  dragging = true; lastX = e.clientX; dragV = 0;
  deck.setPointerCapture(e.pointerId);
});
deck.addEventListener('pointermove', e => {
  deckHover = true;
  if (!dragging) return;
  const dx = e.clientX - lastX; lastX = e.clientX;
  const k = small() ? 0.008 : 0.0045;
  deckA += dx * k; deckT = deckA; dragV = dx * k;
});
const release = () => {
  if (!dragging) return; dragging = false;
  const prev = frontIndex(deckT);
  deckT = Math.round((deckA + dragV * 10) / DSTEP) * DSTEP;   // инерция броска и доводка до снимка
  if (frontIndex(deckT) !== prev) whoosh(0.2);
};
deck.addEventListener('pointerup', release);
deck.addEventListener('pointercancel', release);
deck.addEventListener('pointerleave', () => { deckHover = false; });
deck.addEventListener('wheel', e => {                         // горизонтальный свайп трекпадом
  if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
  e.preventDefault();
  deckT -= e.deltaX * 0.004;
  clearTimeout(wheelTimer);
  wheelTimer = setTimeout(() => { deckT = Math.round(deckT / DSTEP) * DSTEP; }, 140);
}, { passive: false });
addEventListener('keydown', e => {
  const s = S.shots, mid = scrollY + G.H * 0.5;
  if (mid < s.top || mid > s.top + s.h) return;
  if (e.key === 'ArrowRight') toCard(frontIndex(deckT) + 1);
  if (e.key === 'ArrowLeft') toCard(frontIndex(deckT) - 1);
});

function layoutDeck() {
  const R = Math.min(G.deckW, 1100) * (small() ? 0.7 : 0.55);
  const fi = frontIndex(deckA);
  const tilt = deckHover && !dragging;
  cards.forEach((el, i) => {
    const a = i * DSTEP + deckA;
    const x = Math.sin(a) * R, z = Math.cos(a) * R - R;
    const front = Math.cos(a);
    const { w, h } = G.cards[i];
    const isF = i === fi && front > 0.85;
    const tx = isF && tilt ? state.my * -4 : 0, tyy = isF && tilt ? state.mx * 5 : 0;
    css(el, 'transform', `translate3d(${(x - w / 2).toFixed(1)}px, ${(-h / 2).toFixed(1)}px, ${z.toFixed(1)}px) rotateY(${(-a * 0.9 + tyy * Math.PI / 180).toFixed(4)}rad) rotateX(${tx.toFixed(2)}deg)`);
    css(el, 'opacity', (front < -0.2 ? 0 : 0.15 + clamp01((front + 0.2) / 1.2) * 0.85).toFixed(3));
    css(el, 'zIndex', String(Math.round((front + 1) * 50)));
    css(el, '--sheen', (50 + Math.sin(a) * 120).toFixed(0) + '%');
    cls(el, 'front', isF);
  });
  dots.forEach((d, i) => cls(d, 'on', i === fi));
}

/* ───────── ролик: превью при наведении, по клику — со звуком ───────── */
let full = false;
screenEl.addEventListener('pointerenter', () => {
  if (full || !fine) return;
  video.muted = true; video.play().catch(() => {});
});
screenEl.addEventListener('pointerleave', () => { if (!full) video.pause(); });
screenEl.addEventListener('click', () => {
  if (!full) {
    full = true; video.currentTime = 0; video.muted = false; video.loop = false;
    video.play().catch(() => {});
    screenEl.classList.add('playing');
    duck(true);
  } else if (video.paused) { video.play(); screenEl.classList.add('playing'); duck(true); }
  else { video.pause(); screenEl.classList.remove('playing'); duck(false); }
});
video.addEventListener('ended', () => {
  full = false; video.muted = true; video.loop = true; video.currentTime = 0;
  screenEl.classList.remove('playing'); duck(false);
});
new IntersectionObserver(es => es.forEach(e => {
  if (!e.isIntersecting && !video.paused) { video.pause(); if (full) { screenEl.classList.remove('playing'); duck(false); } }
}), { threshold: 0.25 }).observe(screenEl);

/* ───────── 3D-въезд секций (по кэшу, без чтения раскладки) ───────── */
function layoutStages(y) {
  const H = G.H, m = small() ? 0.35 : 1;
  stages.forEach(s => {
    const top = s.top - y, bot = top + s.h;
    if (bot < -H * 0.5 || top > H * 1.5) { s.ty = 0; return; }
    const restTop = Math.max(0, (H - s.h) / 2), restBot = Math.min(H, (H + s.h) / 2);
    let c = 0;
    if (top > restTop) c = (top - restTop) / H;
    else if (bot < restBot) c = (bot - restBot) / H;
    c = clamp(c, -1, 1);
    // hero гаснет быстрее: в это время знак летит на камеру сквозь центр
    const op = s.id === 'hero' && c < 0 ? 1 - clamp01(-c / 0.32) : 1 - clamp01((Math.abs(c) - 0.3) / 0.55);
    if (reduce) { s.ty = 0; css(s.st, 'opacity', op.toFixed(3)); return; }
    s.ty = c * 80 * m;
    css(s.st, 'transform', `perspective(1400px) translate3d(0, ${s.ty.toFixed(1)}px, ${(-Math.abs(c) * 260 * m).toFixed(1)}px) rotateX(${(c * 18 * m).toFixed(2)}deg)`);
    css(s.st, 'opacity', op.toFixed(3));
  });
}
const onScreen = (s, y, pad = 0) => s.top - y < G.H + pad && s.top + s.h - y > -pad;

/* ───────── главный кадр ───────── */
let curSec = 'hero', lastY = 0, lastT = 0;
const geo = { y: 0, W: 0, H: 0, hero: { cx: 0, cy: 0, h: 0 }, end: { cx: 0, cy: 0, h: 0 } };

function tick(now) {
  requestAnimationFrame(tick);
  const dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 1 / 60; lastT = now;
  if (needMeasure) { needMeasure = false; measure(); }
  const H = G.H;

  // скролл с инерцией
  if (gliding) {
    sy = lerp(sy, ty, 1 - Math.pow(0.0006, dt));
    if (Math.abs(ty - sy) < 0.5) { sy = ty; gliding = false; }
    scrollTo(0, sy);
  }
  const y = scrollY, dy = y - lastY; lastY = y;

  // общее состояние для сцены и страницы
  state.vel = lerp(state.vel, dy / Math.max(dt, 0.001) / 60, 0.25);
  if (Math.abs(state.vel) < 0.001) state.vel = 0;
  state.target = clamp01(y / G.maxY);
  state.p = lerp(state.p, state.target, 1 - Math.pow(0.001, dt));
  state.mx = lerp(state.mx, state.tmx, 1 - Math.pow(0.02, dt));
  state.my = lerp(state.my, state.tmy, 1 - Math.pow(0.02, dt));

  css(progress, 'transform', `scaleY(${state.target.toFixed(3)})`);
  cls(top, 'lifted', y > 40);
  if (dy > 4 && y > H * 0.9) cls(top, 'hide', true);
  else if (dy < -4 || y < H * 0.5) cls(top, 'hide', false);

  let cur = 'hero';
  stages.forEach(s => { if (s.top - y <= H * 0.45) cur = s.id; });
  if (cur !== curSec) { curSec = cur; whoosh(0.35); links.forEach(a => cls(a, 'active', a.getAttribute('href') === '#' + cur)); }

  layoutStages(y);

  // курсор: точка сразу, кольцо догоняет
  if (fine) {
    rx = lerp(rx, px, 1 - Math.pow(0.0001, dt)); ry = lerp(ry, py, 1 - Math.pow(0.0001, dt));
    if (Math.abs(rx - px) < 0.05) rx = px; if (Math.abs(ry - py) < 0.05) ry = py;
    css(cDot, 'transform', `translate3d(${px}px, ${py}px, 0)`);
    css(cRing, 'transform', `translate3d(${rx.toFixed(1)}px, ${ry.toFixed(1)}px, 0)`);
  }

  // буквы заголовка отзываются на курсор — только пока hero на экране
  if (fine && y < H) {
    const off = S.hero.ty;
    chars.forEach((ch, i) => {
      const c = G.chars[i]; if (!c) return;
      const dx = px - c.x, dyy = py - (c.y - y + off);
      const f = Math.max(0, 1 - Math.hypot(dx, dyy) / 240);
      const e = f * f * (3 - 2 * f);
      if (e < 0.004) { css(ch, 'transform', ''); css(ch, 'color', ''); css(ch, 'textShadow', ''); return; }
      css(ch, 'transform', `translate3d(${(-dx * e * 0.07).toFixed(1)}px, ${(-e * 20).toFixed(1)}px, 0) rotate(${(dx * e * 0.04).toFixed(1)}deg)`);
      css(ch, 'color', `color-mix(in oklab, var(--violet) ${(e * 75).toFixed(0)}%, var(--ink))`);
      css(ch, 'textShadow', `0 0 ${(e * 40).toFixed(0)}px rgba(157,143,240,${(e * 0.8).toFixed(2)})`);
    });
  }

  // бегущая строка: своя скорость + скорость скролла — только пока видна
  if (G.band.y - y < H && G.band.y + G.band.h - y > 0) {
    const boost = clamp(state.vel * 0.6, -30, 30);
    rows.forEach(r => {
      r.x += (r.dir * (0.5 + Math.abs(boost)) * (boost < -0.2 ? -1 : 1)) * dt * 60;
      if (r.w) { if (r.x <= -r.w) r.x += r.w; if (r.x > 0) r.x -= r.w; }
      css(r.row, 'transform', `translate3d(${r.x.toFixed(1)}px, 0, 0) skewX(${(-boost * 0.4).toFixed(1)}deg)`);
    });
  }

  // кольцо
  if (!small() && onScreen(S.types, y, H * 0.3)) {
    if (hoverI === -1) {
      const k = clamp01((H - (S.types.top - y)) / (H + S.types.h));
      ringT = -Math.round(k * 6 * 4) / 4 * TSTEP;           // с доводкой: карточка всегда встаёт лицом
    }
    ringA = lerp(ringA, ringT, reduce ? 1 : 1 - Math.pow(0.03, dt));
    if (Math.abs(ringA - ringT) < 1e-4) ringA = ringT;
    layoutRing();
  }

  // карусель
  if (onScreen(S.shots, y, H * 0.3)) {
    if (!dragging) { deckA = lerp(deckA, deckT, reduce ? 1 : 1 - Math.pow(0.004, dt)); if (Math.abs(deckA - deckT) < 1e-4) deckA = deckT; }
    layoutDeck();
  }

  // экран ролика наклоняется за курсором
  if (onScreen(S.film, y)) {
    if (!small()) css(screenEl, 'transform', `perspective(1600px) rotateX(${(-state.my * 2.4).toFixed(2)}deg) rotateY(${(state.mx * 3.4).toFixed(2)}deg)`);
    if (!video.paused && video.duration) css(bar, 'transform', `scaleX(${(video.currentTime / video.duration).toFixed(3)})`);
  }

  updateHum();

  // 3D-сцена в том же кадре, с геометрией из кэша
  geo.y = y; geo.W = G.W; geo.H = H;
  geo.hero.cx = G.hero.x + G.hero.w / 2; geo.hero.cy = G.hero.y + G.hero.h / 2 - y + S.hero.ty; geo.hero.h = G.hero.h;
  geo.end.cx = G.end.x + G.end.w / 2; geo.end.cy = G.end.y + G.end.h / 2 - y + S.end.ty; geo.end.h = G.end.h;
  render(now, geo);
}
requestAnimationFrame(tick);

/* ───────── звук: синтез на лету, по умолчанию выключен ───────── */
let actx = null, bus = null, humGain = null, humFilter = null, noiseBuf = null, soundOn = false, ducked = false, humAt = 0;
function audioUp() {
  if (actx) return;
  actx = new (window.AudioContext || window.webkitAudioContext)();
  bus = actx.createGain(); bus.gain.value = 0;
  const comp = actx.createDynamicsCompressor(); bus.connect(comp); comp.connect(actx.destination);
  // далёкий гул из трёх синусов: ля, ми, до-диез
  humGain = actx.createGain(); humGain.gain.value = 0.05;
  humFilter = actx.createBiquadFilter(); humFilter.type = 'lowpass'; humFilter.frequency.value = 260; humFilter.Q.value = 3;
  [55, 82.41, 138.6].forEach((f, i) => {
    const o = actx.createOscillator(); o.type = i === 2 ? 'triangle' : 'sine'; o.frequency.value = f;
    const lfo = actx.createOscillator(), lg = actx.createGain(); lfo.frequency.value = 0.07 + i * 0.05; lg.gain.value = 0.4;
    lfo.connect(lg); lg.connect(o.detune); lfo.start();
    o.connect(humGain); o.start();
  });
  humGain.connect(humFilter); humFilter.connect(bus);
  // шум для «вжухов»
  noiseBuf = actx.createBuffer(1, actx.sampleRate * 1.5, actx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}
function blip(freq, vol = 0.03, len = 0.5) {
  if (!soundOn || !actx) return;
  const t = actx.currentTime, o = actx.createOscillator(), o2 = actx.createOscillator(), g = actx.createGain();
  o.type = 'sine'; o.frequency.value = freq; o2.type = 'triangle'; o2.frequency.value = freq * 2.003;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  const g2 = actx.createGain(); g2.gain.value = 0.25;
  o.connect(g); o2.connect(g2); g2.connect(g); g.connect(bus);
  o.start(t); o2.start(t); o.stop(t + len + 0.05); o2.stop(t + len + 0.05);
}
function whoosh(vol = 0.3) {
  if (!soundOn || !actx) return;
  const t = actx.currentTime, s = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
  s.buffer = noiseBuf; f.type = 'bandpass'; f.Q.value = 1.4;
  f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(2400, t + 0.35); f.frequency.exponentialRampToValueAtTime(500, t + 0.9);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * 0.12, t + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + 1);
  s.connect(f); f.connect(g); g.connect(bus); s.start(t); s.stop(t + 1.1);
}
function updateHum() {
  if (!actx || !soundOn) return;
  // гул раскрывается, когда листаешь быстро; автоматизацию шлём не чаще 20 раз в секунду
  const now = actx.currentTime; if (now - humAt < 0.05) return; humAt = now;
  humFilter.frequency.setTargetAtTime(240 + Math.min(1400, Math.abs(state.vel) * 60), now, 0.12);
}
function duck(on) {
  ducked = on;
  if (!actx || !soundOn) return;
  bus.gain.setTargetAtTime(on ? 0.04 : 0.4, actx.currentTime, 0.3);
}
const soundBtn = $('#sound');
soundBtn.addEventListener('click', () => {
  audioUp();
  if (actx.state === 'suspended') actx.resume();
  soundOn = !soundOn;
  soundBtn.setAttribute('aria-pressed', String(soundOn));
  bus.gain.cancelScheduledValues(actx.currentTime);
  bus.gain.setTargetAtTime(soundOn ? (ducked ? 0.04 : 0.4) : 0, actx.currentTime, 0.35);
  if (soundOn) { blip(523.25, 0.04, 0.6); setTimeout(() => blip(783.99, 0.035, 0.8), 110); }
});
$$('.steps li, .fact').forEach((el, i) => el.addEventListener('pointerenter', () => blip(659.25 * Math.pow(2, (i % 5) * 2 / 12), 0.018, 0.35)));

/* ───────── языки ───────── */

// на сенсорных экранах подсказки без «наведи» и «мышью»
if (!fine) {
  const fs = $('[data-i18n="film.sub"]'), ss = $('[data-i18n="shots.sub"]');
  fs.dataset.i18n = 'film.sub.t'; fs.textContent = dictOf(lang)['film.sub.t'];
  ss.dataset.i18n = 'shots.sub.t'; ss.textContent = dictOf(lang)['shots.sub.t'];
}

const langBtn = $('#lang');
langBtn.addEventListener('click', () => {
  lang = lang === 'ru' ? 'en' : 'ru';
  const dict = dictOf(lang);
  $$('[data-i18n]').forEach(el => {
    const v = dict[el.dataset.i18n]; if (v == null) return;
    el.style.transition = 'opacity .3s, filter .3s'; el.style.opacity = '0'; el.style.filter = 'blur(6px)';
    setTimeout(() => {
      if (el.matches('h2')) { el.textContent = v; splitWords(el); el.classList.add('in'); }
      else if (el.matches('.band-track')) $$('.band-track', el.parentElement).forEach(t => t.innerHTML = v);
      else el.innerHTML = v;
      el.style.opacity = ''; el.style.filter = '';
      needMeasure = true;
    }, 300);
  });
  document.documentElement.lang = lang;
  langBtn.querySelector('.on').textContent = lang.toUpperCase();
  langBtn.querySelector('.off').textContent = lang === 'ru' ? 'EN' : 'RU';
  document.title = dict['meta.title'];
  const md = $('meta[name="description"]'); if (md) md.content = dict['meta.desc'];
  // у каждого языка свой адрес: / и /en/ — поисковики видят обе версии, а ссылка ведёт на нужную
  const root = location.pathname.replace(/(en\/)?(index\.html)?$/, '');
  history.replaceState(null, '', (lang === 'en' ? root + 'en/' : root) + location.hash);
  whoosh(0.3);
});
