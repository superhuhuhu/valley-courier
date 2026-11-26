// The valley world: a winding river valley carved through ridged mountains,
// with three grass airstrips, villages, pine forest and a river.
// Heights are analytic (noise + valley carve), so heightAt() is exact and
// cheap, and the ground the renderer draws is the ground the plane hits.

import { fbm, valueNoise, clamp, lerp, mulberry32 } from './noise.js';

export const WORLD = {
  seed: 20261126,
  size: 12000, // playable square, metres, centred on the origin
  baseHeight: 60,
  ridgeHeight: 260,
  valleyDepth: 46,
  snowLine: 235,
  rockLine: 165,
};

// The valley centreline: a gentle S-curve running north (toward -z... we fly
// along +z from the south end, so the spline runs from z=-5200 to z=+5200).
export function valleyCentre(z) {
  const t = z / 5200;
  return 620 * Math.sin(t * 2.1) + 260 * Math.sin(t * 4.7 + 1.3);
}

// Heading (yaw) of the valley direction at z, for flying along the valley.
export function valleyHeading(z) {
  const dxdz =
    (620 * 2.1) / 5200 * Math.cos((z / 5200) * 2.1) +
    (260 * 4.7) / 5200 * Math.cos((z / 5200) * 4.7 + 1.3);
  return Math.atan2(dxdz, 1);
}

function valleyHalfWidth(z) {
  return 420 + 130 * Math.sin(z * 0.0006 + 2.0);
}

// Raw mountain height before the valley carve.
function mountainHeight(x, z) {
  const n = fbm(x * 0.00042 + 7.3, z * 0.00042 + 2.9, WORLD.seed, 5);
  const ridge = Math.pow(fbm(x * 0.00013 + 1.7, z * 0.00013 + 8.4, WORLD.seed + 77, 4), 1.6);
  let h = WORLD.baseHeight + n * 150 + ridge * WORLD.ridgeHeight;
  // Rolling foothill detail.
  h += (fbm(x * 0.0021, z * 0.0021, WORLD.seed + 31, 3) - 0.5) * 26;
  return h;
}

// The three airstrips: flattened pads with a heading along the valley.
export const AIRSTRIPS = [
  { name: 'Alder Field', x: -40, z: -4200, heading: 0.06, length: 520, width: 46 },
  { name: 'Miller Crossing', x: 480, z: 300, heading: -0.1, length: 560, width: 48 },
  { name: 'North Tarn', x: -420, z: 4300, heading: 0.12, length: 500, width: 44 },
];

// Flatten the ground toward a pad height near each airstrip.
function padBlend(x, z) {
  let best = 0;
  let padH = 0;
  for (const pad of AIRSTRIPS) {
    const dx = x - pad.x;
    const dz = z - pad.z;
    const along = dx * Math.sin(pad.heading) + dz * Math.cos(pad.heading);
    const across = dx * Math.cos(pad.heading) - dz * Math.sin(pad.heading);
    const ax = Math.abs(along) / (pad.length * 0.5 + 130);
    const az = Math.abs(across) / (pad.width * 0.5 + 110);
    const d = Math.max(ax, az);
    const w = clamp(1 - d, 0, 1);
    const ww = w * w * (3 - 2 * w);
    if (ww > best) {
      best = ww;
      padH = padHeight(pad);
    }
  }
  return { blend: best, height: padH };
}

export function padHeight(pad) {
  // Pads sit on the valley floor: sample the carved height at the pad centre.
  return valleyFloorHeight(pad.x, pad.z);
}

function valleyFloorHeight(x, z) {
  const c = valleyCentre(z);
  const dist = Math.abs(x - c);
  const w = valleyHalfWidth(z);
  const t = clamp(dist / w, 0, 1);
  const floor = WORLD.baseHeight - WORLD.valleyDepth + fbm(x * 0.0011, z * 0.0011, WORLD.seed + 5, 3) * 14;
  const m = mountainHeight(x, z);
  return lerp(floor, m, Math.pow(t, 2.2));
}

export function heightAt(x, z) {
  // Keep the world inside its fence: raise the rim so the pilot turns back.
  const edge = Math.max(Math.abs(x), Math.abs(z)) - WORLD.size / 2;
  let h = valleyFloorHeight(x, z);
  const pad = padBlend(x, z);
  h = lerp(h, pad.height, pad.blend);
  if (edge > 0) h += edge * 0.55;
  return h;
}

// Surface colour by height, slope and valley position. Returns [r,g,b].
export function groundColor(x, z, h, slope) {
  const c = valleyCentre(z);
  const dist = Math.abs(x - c);
  const w = valleyHalfWidth(z);
  const inValley = clamp(1 - dist / (w * 1.15), 0, 1);
  // Meadow green on the floor, dry grass on the shoulders, rock, then snow.
  let r;
  let g;
  let b;
  if (h > WORLD.snowLine) {
    r = 232; g = 236; b = 240;
  } else if (h > WORLD.rockLine || slope > 0.62) {
    const t = clamp((h - WORLD.rockLine) / 60, 0, 1);
    r = lerp(122, 148, t); g = lerp(112, 136, t); b = lerp(104, 126, t);
  } else {
    const patch = valueNoise(x * 0.004, z * 0.004, WORLD.seed + 913, 1);
    const meadow = lerp(0.35, 0.75, inValley);
    r = lerp(96, 128, patch) * (0.72 + meadow * 0.28);
    g = lerp(128, 148, patch) * (0.78 + meadow * 0.3);
    b = lerp(52, 66, patch);
    // Dry harvested fields near the villages.
    const field = valueNoise(x * 0.0016 + 40, z * 0.0016 + 9, WORLD.seed + 517, 1);
    if (inValley > 0.55 && field > 0.62) {
      r = lerp(r, 178, 0.55); g = lerp(g, 158, 0.5); b = lerp(b, 92, 0.4);
    }
  }
  // Slope shading baked in lightly; the renderer adds sun shading per quad.
  const shade = clamp(1 - slope * 0.35, 0.6, 1);
  return [r * shade, g * shade, b * shade];
}

// --- Rings: the ring-run course follows the valley -------------------------
export const RINGS = (() => {
  const rings = [];
  const zs = [-4600, -3800, -3000, -2150, -1300, -450, 450, 1350, 2250, 3150, 3950, 4650];
  for (let i = 0; i < zs.length; i++) {
    const z = zs[i];
    const x = valleyCentre(z) + (i % 2 === 0 ? -60 : 70);
    const y = heightAt(x, z) + 55 + (i % 3) * 18;
    rings.push({ x, y, z, radius: 15, index: i });
  }
  return rings;
})();

// --- Drop zones: painted circles near the villages -------------------------
export const DROP_ZONES = [
  { x: 180, z: -2600, radius: 26, name: 'Alder Hamlet' },
  { x: -260, z: 900, radius: 26, name: 'Millers Farm' },
  { x: 320, z: 3500, radius: 26, name: 'Tarn Cottages' },
];

// --- Trees, rocks and village houses: deterministic scatter ---------------
function scatter() {
  const rand = mulberry32(WORLD.seed + 4242);
  const trees = [];
  const rocks = [];
  const houses = [];
  const villages = [
    { x: 180, z: -2600 }, { x: -260, z: 900 }, { x: 320, z: 3500 },
  ];
  for (const v of villages) {
    for (let i = 0; i < 9; i++) {
      const a = rand() * Math.PI * 2;
      const d = 40 + rand() * 90;
      const hx = v.x + Math.cos(a) * d;
      const hz = v.z + Math.sin(a) * d;
      houses.push({ x: hx, z: hz, h: heightAt(hx, hz), w: 9 + rand() * 6, rot: rand() * Math.PI });
    }
  }
  let tries = 0;
  while (trees.length < 900 && tries < 9000) {
    tries++;
    const x = (rand() * 2 - 1) * (WORLD.size / 2 - 300);
    const z = (rand() * 2 - 1) * (WORLD.size / 2 - 300);
    const h = heightAt(x, z);
    const slope = Math.abs(heightAt(x + 12, z) - h) / 12 + Math.abs(heightAt(x, z + 12) - h) / 12;
    if (h > WORLD.rockLine || slope > 0.55) continue;
    if (Math.abs(x - valleyCentre(z)) < valleyHalfWidth(z) * 0.45 && rand() < 0.5) continue; // keep the valley floor open
    trees.push({ x, z, h, s: 9 + rand() * 9, pine: rand() < 0.8 });
  }
  tries = 0;
  while (rocks.length < 260 && tries < 4000) {
    tries++;
    const x = (rand() * 2 - 1) * (WORLD.size / 2 - 300);
    const z = (rand() * 2 - 1) * (WORLD.size / 2 - 300);
    const h = heightAt(x, z);
    if (h < WORLD.rockLine - 20) continue;
    rocks.push({ x, z, h, s: 4 + rand() * 8 });
  }
  return { trees, rocks, houses };
}

export const SCATTER = scatter();

// The river polyline follows the valley centreline.
export function riverPoints(step) {
  const pts = [];
  for (let z = -WORLD.size / 2; z <= WORLD.size / 2; z += step) {
    const x = valleyCentre(z);
    pts.push({ x, z, y: heightAt(x, z) + 0.6 });
  }
  return pts;
}
