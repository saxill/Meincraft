# meincraft — project guide for Claude

A Minecraft-style voxel game that runs entirely in the browser. **No build step, no npm.**
Three.js is loaded from a CDN via an importmap; PeerJS from a CDN `<script>`. The folder is
static and hosted as-is on GitHub Pages.

## Run / test
- Serve the folder (ES modules can't load from `file://`): `python -m http.server 8000` → open `http://localhost:8000`.
- Syntax check: `node --check game.js` (and each `js/*.js`).
- Headless smoke test (no GUI): run Chrome headless against a local server and dump the DOM, e.g.
  `chrome --headless=new --disable-gpu --virtual-time-budget=9000 --dump-dom http://localhost:PORT/index.html`.
  A clean load builds 9 hotbar `.slot` elements and logs no `Uncaught`/`TypeError`/`ReferenceError`.

## Conventions
- Plain ES modules, one system per file. Match the existing terse comment style.
- **Item ID partitioning (must stay stable — saved worlds depend on it):**
  `1..99` = blocks, `100..199` = tools, `200+` = crafting materials/items. See `js/items.js`
  (`isTool`, `isMaterial`, `TOOL_BASE`, `ITEM_BASE`).
- localStorage keys (suffixed with the world `SEED`): `mineclone-state-v2-*` (player state, in `game.js`)
  and `mineclone-edits-v2-*` (block edits, in `js/world.js`). When changing save shape, migrate, don't clobber.

## Module map
```
index.html      page, HUD, hotbar, inventory + crafting markup & styles, hearts, hurt overlay
game.js         main loop, input, chunk streaming, save/load, combat/health glue
js/config.js    world constants and seed
js/noise.js     PRNG, Perlin noise, hashing
js/blocks.js    block registry + procedural texture atlas + block icon drawing
js/world.js     terrain/cave/ore/tree gen, chunk storage, getBlock/setBlock/raycast/isSolid
js/mesher.js    chunk meshing with face culling + ambient occlusion
js/player.js    physics, collision (moveAxis), swimming, sprint/sneak — REUSABLE for entities
js/sky.js       sun, moon, stars, clouds, day/night lighting
js/particles.js block-break particle bursts
js/audio.js     procedural sound effects
js/ui.js        hotbar, inventory screen (click-to-move), crafting list, hearts, creative palette
js/net.js       multiplayer rooms (WebRTC / PeerJS, host-relayed) + room-password & host-approval join gate
js/avatars.js   remote player box models with name tags — REUSABLE for a bot's body
js/items.js     tools, durability, attack damage, block drops, item/tool icons
js/inventory.js stacking 36-slot inventory model (9 hotbar + 27 main)
js/crafting.js  shapeless recipes (planks, sticks, tools)
js/mobs.js      pigs & zombies — AABB physics, wander/chase AI, combat — REUSABLE bot skeleton
```

## Gameplay systems (current)
- **Survival (default) vs Creative** toggle (button in the E inventory). Survival: break → drops into
  inventory, place consumes a stack, tools wear out. Creative: infinite blocks, no durability, no damage.
- **Combat/health:** left-click attacks a mob if one is in front and closer than the targeted block.
  Player has 20 HP (hearts HUD), i-frames, slow regen, fall + zombie damage, respawn on death.
- **Mobs** (`js/mobs.js`) are **local only** — not synced over multiplayer yet.

## Tunable numbers (where to tweak feel)
- Tool durability / attack damage / block drops: `js/items.js`.
- Mob sizes/speeds/HP, spawn caps, despawn distance, day/night threshold (`timeOfDay >= 0.5`): `js/mobs.js`.
- Player HP, i-frames, regen cadence, fall-damage threshold (`> 4` blocks): `game.js`.
- Stack size (64), inventory layout (9+27): `js/inventory.js`.

---

# PLANNED FEATURE: an AI companion that plays *with* you

Goal: a player-shaped agent that joins the world, follows/helps you, mines, builds, and fights mobs.
Recommended phased build — Phase 1 stands alone and needs nothing external.

## Phase 1 — local "bot companion" (no server, no API key) ✅ BUILT (`js/bot.js`)
A companion named **Zara** you summon with **B** and talk to with **T**. It reuses the
mob voxel-AABB physics (gravity, `moveAxis`, 1-block step-hop) and an avatar-style body
with a name tag, walk-cycle legs, and a mining arm swing. State machine:
`follow` (default, keeps ~3 blocks), `come`, `wander`, `stop`, `mine <block>`
(finds the nearest matching block within radius 6, walks to it, breaks it, hands the
drop to the player — capped at 16 blocks/command with a 5s stuck-skip), and `fight`
(chases the nearest hostile within 18 and attacks). Its block edits go through the
player's own `setBlock` + `net.sendEdit` path so they save and sync.

Chat commands (`bot.command`) are a **fixed keyword allowlist** parsed with regexes —
follow/come/stop/wander/fight and `mine wood|stone|dirt|sand|coal|iron|gold|diamond`.
Wired in `game.js` (creation after the net setup; `bot.update(dt, player)` in `animate()`
inside the `locked` block; B/T key handlers; `#botchat`/`#botlog` in `index.html`).

**Security (Phase 1):** 100% local — no network calls, no API key, no secrets, no
`eval`/`Function`. User chat is never executed as code; all chat text reaches the DOM
via `textContent` only (no `innerHTML`), input is length-capped (120), and the bot adds
no new `net.js` message types or save-shape changes (it's resummoned each session, not
persisted). Verified: `node --check` clean on all files + headless-Chrome smoke test
(9 hotbar slots, no Uncaught/TypeError/ReferenceError). The API-key surface only appears
in Phase 2 below — keep it out of Phase 1.

Original notes (for reference / future generalisation):
A bot is essentially "a mob that looks like a player and can also mine/place." Reuse what exists:
- **Body/rendering:** reuse `js/avatars.js`'s box model + name tag (give it its own colour/name).
- **Physics/AI loop:** copy the `moveAxis`/gravity/step-hop pattern from `js/mobs.js` (or generalize it
  into a shared `js/entity.js` so player, mobs, and bot share collision).
- **New file `js/bot.js`** exposing `createBot(scene, world)` with a state machine:
  `FOLLOW` (path toward player, keep ~3 blocks), `WANDER`, `MINE` (raycast a target block, use the
  world `setBlock`/`raycast`, emit break particles + a drop), `BUILD` (place from a small carried
  inventory), `FIGHT` (target nearest hostile via the same AABB ray test, call `mobs.damageMob`).
- **Pathing:** start dumb — walk toward target, jump when blocked (mobs already hop 1-block steps).
  Upgrade later to a small A* over the voxel grid if it gets stuck.
- **Hook in `game.js`:** `const bot = createBot(scene, ...)`, `bot.update(dt, player, mobs, ...)` in the
  `animate()` loop next to `mobs.update(...)`. Add a way to summon it (e.g. a key, or a title-screen button).
- **Commands without an LLM:** a tiny chat box → keyword intents ("follow", "stop", "mine wood",
  "come here", "fight"). Cheap and instantly fun.

## Phase 2 — Claude-powered goals (optional, layered on Phase 1)
Make the bot's *decisions* come from Claude while Phase 1 stays the executor (LLM latency is seconds,
so it picks goals, not per-frame moves).
- **Browser-side API call:** `fetch('https://api.anthropic.com/v1/messages', ...)` with the user's own
  key. Client-side calls need the header `anthropic-dangerous-direct-browser-access: true` (CORS).
  **Verify the exact header + current model id at build time** — use a fast model (e.g. Haiku-class)
  for snappy, cheap decisions.
- **Key handling:** never hardcode a key (static site / public repo). Add a field on the title screen;
  store in localStorage; make it clear the key is the user's and calls go straight to Anthropic.
- **Agent loop:** every few seconds (or on chat), send compact world state — player pos, bot pos+inv,
  nearby blocks summary, recent chat, current goal — and ask for ONE next goal as JSON tool-use
  (e.g. `{action:"mine", target:"oak", qty:8}` / `build` / `follow` / `say`). Phase-1 state machine
  executes it. Keep the prompt + state small to control latency/cost.
- **Chat:** route the model's `say` back into the chat box; let the user converse and redirect it.

## Phase 3 — multiplayer-aware (optional)
Mobs/bot are currently local-only. If the bot should appear for everyone in a room, have the **host**
own the bot and broadcast its position via the existing `net.sendPos`/avatars channel
(`js/net.js`, `js/avatars.js`), the same way real players sync.

## Risks / notes
- Generalizing entity physics first (shared `js/entity.js`) avoids copy-paste drift between player/mob/bot.
- Bot mining/placing must go through `world.setBlock` + `net.sendEdit` so edits save and sync.
- Start Phase 1 fully playable before touching Phase 2; the LLM layer is pure upside on top.
