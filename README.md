# meincraft

A Minecraft-style voxel game that runs entirely in the browser — no build step, no dependencies to install. Three.js is loaded from a CDN, so the folder can be hosted as-is on GitHub Pages.

## Features

- Infinite procedurally generated terrain (seeded), built from 16×16×96 chunks
- **Biomes**: plains, forest, desert (with cacti), and snowy mountains with alpine snowcaps
- **Caves**: winding spaghetti tunnels and large caverns underground
- **Ores**: coal, iron, gold, and diamond veins, rarer with depth
- Oak and spruce trees, flowers, and tall grass
- Per-vertex **ambient occlusion** for soft corner shading
- **Day/night cycle** with sun, moon, stars, drifting clouds, and dusk glow
- Water with animated texture, swimming, and an underwater fog tint
- Break particles and procedural WebAudio sound effects (break, place, footsteps, landing)
- **Survival mode** (default): break blocks to collect drops into a real stacking inventory, place blocks from your stacks, and **craft** planks, sticks, and tools — toggle **Creative** any time for unlimited blocks
- **Tools wear out** (durability) and break; the right tool mines its blocks faster
- **Mobs & combat**: pigs wander by day, zombies spawn at night and chase you; swing a sword to fight back. You have health (hearts), take fall/zombie damage, and respawn on death
- A real **inventory screen** (press E): click a stack to pick it up, click to place, craft on the left
- A held item in hand with a swing animation
- Sprint (double-tap W), sneak (Shift), and fly mode (F)
- Your block edits, position, time of day, and settings **auto-save** in the browser (localStorage)
- **Online multiplayer**: host a room and share a 5-letter code — friends join from anywhere, see each other build in a shared world with synced day/night

## Multiplayer

Works even on GitHub Pages — there is no game server. Connections are
peer-to-peer over WebRTC ([PeerJS](https://peerjs.com)'s free public broker is
only used to introduce peers; gameplay traffic flows browser-to-browser).

- **Host**: enter a name on the title screen and click **HOST GAME**. Share the
  5-letter room code shown.
- **Join**: enter the code and click **JOIN**. You'll get the host's world —
  all their edits, plus everything built while you play together.
- The host's browser is the world: their edits auto-save, and guests' builds are
  saved by the host. Guests' own solo worlds are never overwritten.
- If the host closes the tab, the room ends (guests keep playing offline).

## Controls

| Key | Action |
| --- | --- |
| WASD | Move |
| Double-tap W | Sprint |
| Space | Jump / swim up / fly up |
| Shift | Sneak / fly down |
| Left click | Break block / hold to mine / attack a mob in front |
| Right click | Place block (consumes one from the stack in survival) |
| 1–9 / mouse wheel | Select hotbar slot |
| E | Open/close inventory (craft here; switch Survival/Creative) |
| F | Toggle fly |
| M | Mute sounds |
| [ / ] | Decrease / increase view distance |
| Esc | Pause (release mouse) |

## Run locally

Browsers block ES modules from `file://`, so serve the folder:

```sh
python -m http.server 8000
```

Then open http://localhost:8000

## Deploy to GitHub Pages

1. Create a GitHub repository and push this folder to it.
2. In the repo: **Settings → Pages → Source: Deploy from a branch**, pick `main` and `/ (root)`.
3. Your game will be live at `https://<username>.github.io/<repo>/`.

## Project structure

```
index.html      page, HUD, hotbar, inventory markup & styles
game.js         main loop, input, chunk streaming, save/load
js/config.js    world constants and seed
js/noise.js     PRNG, Perlin noise, hashing
js/blocks.js    block registry + procedural texture atlas
js/world.js     terrain/cave/ore/tree generation, block storage, raycast
js/mesher.js    chunk meshing with face culling + ambient occlusion
js/player.js    physics, collision, swimming, sprint/sneak
js/sky.js       sun, moon, stars, clouds, day/night lighting
js/particles.js block-break particle bursts
js/audio.js     procedural sound effects
js/ui.js        hotbar, inventory screen, crafting list, hearts, creative palette
js/net.js       multiplayer rooms (WebRTC / PeerJS, host-relayed)
js/avatars.js   remote player models with name tags
js/items.js     tools, durability, attack damage, block drops, item icons
js/inventory.js stacking 36-slot inventory model
js/crafting.js  shapeless recipes (planks, sticks, tools)
js/mobs.js      pigs & zombies — physics, AI, combat
```

No bundler, no npm — everything is plain ES modules.
