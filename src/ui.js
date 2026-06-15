import { STICK_SKINS, SHOP_ITEMS } from './data.js';
import { state, isSkinUnlocked, nextLockedSkin } from './state.js';

let cb = {};
const $ = (id) => document.getElementById(id);

export function initUI(callbacks) {
  cb = callbacks;

  $('shop-btn').addEventListener('click', () => openPanel('shop'));
  $('skins-btn').addEventListener('click', () => openPanel('skins'));
  $('pause-btn').addEventListener('click', () => openPanel('pause'));
  $('mute-btn').addEventListener('click', () => cb.onToggleMute?.());

  $('resume-btn').addEventListener('click', () => closePanels());
  $('mainmenu-btn').addEventListener('click', () => cb.onMainMenu?.());

  document.querySelectorAll('.panel-close').forEach((b) =>
    b.addEventListener('click', () => closePanels()));
  $('overlay-scrim').addEventListener('click', () => closePanels());

  // shop tab filters
  document.querySelectorAll('.shop-tab').forEach((tab) =>
    tab.addEventListener('click', () => {
      document.querySelectorAll('.shop-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      renderShop(tab.dataset.cat);
    }));

  $('reset-btn').addEventListener('click', () => {
    if (confirm('Reset all progress, coins, and unlocks?')) cb.onReset?.();
  });

  updateHUD();
}

export function updateHUD() {
  $('coin-count').textContent = formatNum(state.coins);
  $('hit-count').textContent = formatNum(state.totalHits);
  const mirror = $('shop-coins-mirror');
  if (mirror) mirror.textContent = formatNum(state.coins);

  const next = nextLockedSkin();
  const bar = $('progress-fill');
  const label = $('progress-label');
  if (next) {
    // progress from the previously unlocked threshold to the next
    const prev = [...STICK_SKINS].reverse().find((s) => s.hits <= state.totalHits)?.hits || 0;
    const pct = Math.max(0, Math.min(1, (state.totalHits - prev) / (next.hits - prev)));
    bar.style.width = `${pct * 100}%`;
    label.textContent = `${next.hits - state.totalHits} hits → ${next.name}`;
  } else {
    bar.style.width = '100%';
    label.textContent = 'All skins unlocked! 🏆';
  }
}

export function updateHealth(hp, max) {
  const pct = Math.max(0, Math.min(1, hp / max));
  const fill = $('health-fill');
  if (fill) {
    fill.style.width = `${pct * 100}%`;
    // green → yellow → red as it drops
    const hue = pct * 120;
    fill.style.background = `hsl(${hue}, 80%, 50%)`;
  }
  const txt = $('health-text');
  if (txt) txt.textContent = `${Math.ceil(hp)}`;
}

// ---------------------------------------------------------------------------
// Boss health bar
// ---------------------------------------------------------------------------
export function showBoss(def) {
  const w = $('boss-bar');
  $('boss-name').textContent = `${def.emoji} ${def.name}`;
  $('boss-sub').textContent = def.sub;
  $('boss-phase').textContent = '';
  $('boss-fill').style.width = '100%';
  w.classList.add('show');
}
export function updateBoss(hp, max, phase) {
  const pct = Math.max(0, hp / max) * 100;
  $('boss-fill').style.width = `${pct}%`;
  $('boss-phase').textContent = phase >= 2 ? 'PHASE 2' : '';
}
export function hideBoss() { $('boss-bar').classList.remove('show'); }

export function updateBossTimer(secs, active) {
  const el = $('boss-timer'); if (!el) return;
  const txt = $('boss-timer-text');
  if (active) {
    el.classList.add('fighting');
    txt.textContent = 'FIGHT!';
  } else {
    el.classList.remove('fighting');
    const s = Math.max(0, Math.ceil(secs));
    const m = Math.floor(s / 60);
    txt.textContent = `${m}:${(s % 60).toString().padStart(2, '0')}`;
    // turn red/urgent in the final 10 seconds
    el.classList.toggle('soon', s <= 10);
  }
}

// ---------------------------------------------------------------------------
// Boss ability bar
// ---------------------------------------------------------------------------
const ABIL_KEYS = ['bulwark', 'bloom', 'shards'];
export function updateAbilities(abilities, bossActive, shardChargeFrac) {
  const bar = $('ability-bar');
  if (!bar) return;
  if (!bossActive) { bar.classList.remove('show'); return; }
  bar.classList.add('show');
  for (const k of ABIL_KEYS) {
    const a = abilities[k]; const slot = $('ability-' + k);
    if (!slot) continue;
    const cdEl = slot.querySelector('.ability-cd');
    const txt = slot.querySelector('.ability-cdtext');
    if (k === 'shards' && shardChargeFrac > 0) {
      slot.classList.add('charging'); slot.classList.remove('cooling');
      cdEl.style.transform = `scaleY(${1 - shardChargeFrac})`;
      txt.textContent = '⌛';
      continue;
    }
    slot.classList.remove('charging');
    cdEl.style.transform = `scaleY(${Math.max(0, a.cd / a.max)})`;
    if (a.cd > 0) { slot.classList.add('cooling'); txt.textContent = Math.ceil(a.cd); }
    else { slot.classList.remove('cooling'); txt.textContent = ''; }
  }
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------
export function openPanel(name) {
  closePanels(true);
  $('overlay-scrim').classList.add('show');
  $(`${name}-panel`).classList.add('show');
  if (name === 'shop') renderShop(currentShopCat());
  if (name === 'skins') renderSkins();
  cb.onPanelOpen?.();   // pause game + release the pointer, however the panel was opened
}

export function closePanels(silent) {
  $('overlay-scrim').classList.remove('show');
  document.querySelectorAll('.panel').forEach((p) => p.classList.remove('show'));
  if (!silent) cb.onPanelClose?.();
}

export function anyPanelOpen() {
  return !!document.querySelector('.panel.show');
}

function currentShopCat() {
  return document.querySelector('.shop-tab.active')?.dataset.cat || 'Hats';
}

function renderShop(cat) {
  const grid = $('shop-grid');
  grid.innerHTML = '';
  SHOP_ITEMS.filter((i) => i.cat === cat).forEach((item) => {
    const owned = state.ownedShopItems.includes(item.id);
    const equippedCat = item.cat === 'Sticks' ? null : item.cat;
    const isEquipped = equippedCat && state.equipped[equippedCat] === item.id;
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="card-emoji" style="background:${hex(item.color)}">${item.emoji}</div>
      <div class="card-name">${item.name}</div>
      <div class="card-price">${owned ? '<span class="owned">Owned</span>' : `<span class="coin-ico">🪙</span>${formatNum(item.price)}`}</div>
      <button class="card-btn ${owned ? (isEquipped ? 'equipped' : 'equip') : 'buy'}">
        ${owned ? (item.cat === 'Sticks' ? 'Use in Stash' : (isEquipped ? 'Equipped ✓' : 'Equip')) : 'Buy'}
      </button>`;
    const btn = card.querySelector('.card-btn');
    btn.addEventListener('click', () => {
      if (!owned) cb.onBuy?.(item);
      else if (item.cat !== 'Sticks') cb.onEquipItem?.(item, isEquipped);
      else openPanel('skins');
      renderShop(cat);
    });
    grid.appendChild(card);
  });
}

function renderSkins() {
  const grid = $('skins-grid');
  grid.innerHTML = '';
  // earned skins
  STICK_SKINS.forEach((skin) => {
    const unlocked = isSkinUnlocked(skin);
    grid.appendChild(skinCard(skin, unlocked, `${skin.hits} hits`));
  });
  // premium sticks owned via shop
  SHOP_ITEMS.filter((i) => i.cat === 'Sticks' && state.ownedShopItems.includes(i.id))
    .forEach((i) => grid.appendChild(skinCard(i.skin, true, 'Premium')));
}

function skinCard(skin, unlocked, reqLabel) {
  const equipped = state.equippedStick === skin.id;
  const card = document.createElement('div');
  card.className = `card skin-card ${unlocked ? '' : 'locked'}`;
  const swatch = hex(skin.colors.main);
  card.innerHTML = `
    <div class="card-emoji skin-swatch" style="background:${swatch}">
      ${unlocked ? '🪄' : '🔒'}
    </div>
    <div class="card-name">${skin.name}</div>
    <div class="card-rarity rarity-${(skin.rarity || 'Common').toLowerCase()}">${skin.rarity || ''}</div>
    <div class="card-price">${unlocked ? '' : reqLabel}</div>
    <button class="card-btn ${equipped ? 'equipped' : (unlocked ? 'equip' : 'locked-btn')}" ${unlocked ? '' : 'disabled'}>
      ${equipped ? 'Equipped ✓' : (unlocked ? 'Equip' : 'Locked')}
    </button>`;
  if (unlocked) {
    card.querySelector('.card-btn').addEventListener('click', () => {
      cb.onEquipSkin?.(skin);
      renderSkins();
    });
  }
  return card;
}

export function refreshPanels() {
  if ($('shop-panel').classList.contains('show')) renderShop(currentShopCat());
  if ($('skins-panel').classList.contains('show')) renderSkins();
}

// ---------------------------------------------------------------------------
// Feedback: toasts, combo, floating hit numbers, crosshair pop
// ---------------------------------------------------------------------------
let toastTimer = null;
export function toast(msg, kind = 'info') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 2200);
}

export function bigBanner(title, sub) {
  const b = $('banner');
  b.innerHTML = `<div class="banner-title">${title}</div><div class="banner-sub">${sub || ''}</div>`;
  b.classList.remove('show');
  void b.offsetWidth; // restart animation
  b.classList.add('show');
}

let comboHideTimer = null;
export function showCombo(n) {
  const c = $('combo');
  if (n < 2) { c.classList.remove('show'); return; }
  c.innerHTML = `<span class="combo-x">x${n}</span><span class="combo-label">COMBO</span>`;
  c.classList.remove('show');
  void c.offsetWidth;
  c.classList.add('show', 'pop');
  setTimeout(() => c.classList.remove('pop'), 150);
  clearTimeout(comboHideTimer);
  comboHideTimer = setTimeout(() => c.classList.remove('show'), 1500);
}

export function floatHit(text, color = '#fff') {
  const el = document.createElement('div');
  el.className = 'float-hit';
  el.textContent = text;
  el.style.color = color;
  const cx = window.innerWidth / 2 + (Math.random() - 0.5) * 120;
  const cy = window.innerHeight / 2 + (Math.random() - 0.5) * 40;
  el.style.left = `${cx}px`;
  el.style.top = `${cy}px`;
  $('fx-layer').appendChild(el);
  if (window.gsap) {
    window.gsap.fromTo(el, { y: 0, opacity: 1, scale: 0.6 },
      { y: -90, opacity: 0, scale: 1.3, duration: 0.9, ease: 'power2.out', onComplete: () => el.remove() });
  } else {
    setTimeout(() => el.remove(), 900);
  }
}

export function hitMarker() {
  const m = $('crosshair');
  m.classList.add('hit');
  setTimeout(() => m.classList.remove('hit'), 120);
}

function formatNum(n) {
  return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : `${n}`;
}
function hex(c) { return `#${c.toString(16).padStart(6, '0')}`; }
