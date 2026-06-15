// Player progression + persistence
import { STICK_SKINS } from './data.js';

const SAVE_KEY = 'stickbash_save_v1';

const DEFAULT_STATE = {
  coins: 0,
  totalHits: 0,
  bestCombo: 0,
  equippedStick: 'oak',
  ownedShopItems: [],      // ids from SHOP_ITEMS
  equipped: {              // equipped cosmetics by category
    Hats: null,
    Auras: null,
    Skins: null,           // body color
  },
};

export const state = load();

function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    return { ...structuredClone(DEFAULT_STATE), ...parsed,
      equipped: { ...DEFAULT_STATE.equipped, ...(parsed.equipped || {}) } };
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

export function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch { /* ignore quota / private mode */ }
}

// Skins unlocked purely by hit count
export function isSkinUnlocked(skin) {
  return state.totalHits >= skin.hits;
}

// Next locked skin (for the HUD progress bar)
export function nextLockedSkin() {
  return STICK_SKINS.find((s) => state.totalHits < s.hits) || null;
}

export function addCoins(n) {
  state.coins += n;
  save();
}

export function spendCoins(n) {
  if (state.coins < n) return false;
  state.coins -= n;
  save();
  return true;
}

export function resetSave() {
  Object.assign(state, structuredClone(DEFAULT_STATE));
  save();
}
