# 🪄 STICK BASH!

A modern, first-person, Roblox-flavored stick-fighting game. Bonk wandering blocky
characters with your stick — every hit you land unlocks new stick skins, and the coins
you earn can be spent in the shop on hats, glowing auras, body colors, and premium sticks.

Built with **Three.js** (3D world + characters) and **GSAP** (juicy swing/UI animation).
No build step, no dependencies to install — it's plain ES modules + two CDN scripts.

## Play it

Because it uses ES modules, open it through a local web server (not `file://`):

```bash
cd "Lawson Game"
python3 -m http.server 8123
# then open http://localhost:8123 in your browser
```

(Any static server works — e.g. `npx serve`.)

## Controls

**Desktop**
- `W A S D` / arrows — move
- Mouse — look (click once to lock the pointer)
- Left click or `Space` — swing the stick
- Right click or `F` / `Q` — **throw the stick** (it spins out, bonks everyone in its path, and boomerangs back to your hand)
- `B` — open Shop · `N` — open your Sticks · `Esc` / `P` — pause
- `Shift` — sprint

**Mobile / touch**
- Left half of screen — virtual joystick to move
- Right half — drag to look around
- 🪄 button (bottom-right) — swing
- 🪃 button (next to it) — throw
- Top buttons — Sticks, Shop, sound

## Game loop

- **Hit people → unlock sticks.** Stick skins unlock automatically at hit milestones
  (Oak → Pine → Cobalt → Golden → Candy Cane → Molten Mauler → Neon Saber → Rainbow Banhammer).
  Check the bottom progress bar for your next unlock.
- **Earn coins → flex in the Shop.** Coins come from every hit (with combo bonuses).
  Spend them on hats, auras, body colors, and three premium sticks.
- **Combos** build when you land hits quickly — more coins per hit. A single throw that
  clips several enemies racks up a fat combo in one move.
- **Fight back or get bonked.** Enemies carry their own (randomly varied) sticks, chase you
  down, and swing when they're close — **5 hits knocks you out** and respawns you at the pad.
  Getting hit also breaks your combo. Watch your ❤️ health bar (top-left).
- **Enemies have a life of their own.** They come in three personality tiers (~1/3 each):
  **passive** ones just roam the map, **defensive** ones only fight you (or whoever hits them),
  and **aggressive** ones pick fights with anyone. This keeps the whole map active instead of
  everyone swarming one spot. They can also throw their sticks at their target (once every ~6s;
  your throw recharges every 2s), and they keep a hard personal-space bubble so they never bunch up.
- **Pause anytime** with the ⏸️ button or `Esc`/`P` — resume, or head back to the Main Menu
  (your coins, unlocks, and cosmetics are saved).
- **Bosses drop in every 5 minutes.** A rotating roster of five giant dino-hybrid bosses
  crashes down from the sky (a slow, dramatic drop) with their own health bar, signature
  telegraphed attacks, and a Phase 2 at 30% HP: 🔥 **Pyrosaurus Rex** (fire patches, tail
  shockwave, fire rain), 🐂 **Tricera-Minos** (wall-bouncing charge, frill slam, stone pillars),
  🪶 **Aero-Phoenix Strix** (diving strikes, feather storm, revives once from the ashes),
  🌊 **Spino-Leviathan** (tidal waves, tentacle slams, pulling whirlpools), and 🪨 **Ankylo-Golem
  Terraguard** (180° tail smash, invincible rolling shell, falling boulders). Beat one for a
  big coin/hit payout. Watch the telegraphs — jump the shockwaves, dodge the orange!
  - **The NPCs gang up on the boss too** — when a boss is present, every fighter swarms it,
    but each NPC can only land a hit every 5 seconds (chip damage), so *you* still do the bulk.
  - **You get 3 boss-only abilities** (shown bottom-center, keys `1`/`2`/`3`): 🛡️ **Bulwark**
    (4s damage-absorbing barrier, 15s cd), 💚 **Bloom** (heal 40% + regen zone, 30s cd), and
    ☄️ **Stick Shards** (3s charge, then hurls 5 exploding Galaxy Staffs for big damage, 6s cd).
- Progress is saved to `localStorage`, so your coins, unlocks, and equipped gear persist.

## Project layout

```
index.html        # shell, import map (three), GSAP, all UI containers
src/
  main.js         # entry: renderer, camera, first-person view model, game loop, combat
  world.js        # scene/lighting/arena + blocky character & stick factories
  enemies.js      # enemy spawning, wandering/chasing AI, knockback, respawn
  controls.js     # unified desktop (pointer-lock) + mobile (touch) input
  data.js         # stick skins + shop catalog + tuning constants
  state.js        # progression + localStorage save/load
  ui.js           # HUD, shop, sticks panel, toasts, combo, floating hit numbers
  styles.css      # chunky, bright, mobile-responsive Roblox-style UI
  audio.js        # tiny synthesized Web Audio SFX (no asset files)
```

Tip: `window.__game` is exposed in the console for quick poking (state, player, enemies).
