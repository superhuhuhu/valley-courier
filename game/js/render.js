// Terrain rendering: depth-sorted strips of the heightfield, drawn as
// projected quads from far to near, with fog, sun shading, the river,
// airstrips, trees, rocks, houses and the course rings on top.

import { heightAt, groundColor, SCATTER, AIRSTRIPS, RINGS, DROP_ZONES, riverPoints, WORLD } from './terrain.js';
import { project } from './camera.js';
import { clamp, lerp } from './noise.js';

const FOG = [233, 220, 190];

function fogMix(rgb, d) {
  const t = clamp((d - 300) / 2400, 0, 0.88);
  return [
    Math.round(lerp(rgb[0], FOG[0], t)),
    Math.round(lerp(rgb[1], FOG[1], t)),
    Math.round(lerp(rgb[2], FOG[2], t)),
  ];
}

function shadeQuad(rgb, nx, ny, nz, sunX, sunY, sunZ) {
  // Simple lambert term against the sun direction, kept gentle.
  const dot = nx * sunX + ny * sunY + nz * sunZ;
  const f = clamp(0.84 + dot * 0.26, 0.72, 1.06);
  return [clamp(rgb[0] * f, 0, 255), clamp(rgb[1] * f, 0, 255), clamp(rgb[2] * f, 0, 255)];
}

// Render the ground as strips along the camera forward direction.
export function drawTerrain(ctx, cam, sunDir) {
  const rows = [];
  let d = 34;
  while (d < 2500) {
    rows.push(d);
    d *= 1.13;
  }
  rows.push(2600);
  const cols = 46;
  const halfFov = Math.atan2(ctx.canvas.width / 2, cam.focal) * 1.12;

  // Precompute each row's world points.
  const grid = [];
  for (let ri = 0; ri < rows.length; ri++) {
    const depth = rows[ri];
    const width = Math.tan(halfFov) * depth * 2;
    const pts = [];
    for (let ci = 0; ci <= cols; ci++) {
      const lat = (ci / cols - 0.5) * width;
      const wx = cam.x + cam.fwd[0] * depth + cam.right[0] * lat;
      const wz = cam.z + cam.fwd[2] * depth + cam.right[2] * lat;
      const wy = heightAt(wx, wz);
      pts.push({ x: wx, y: wy, z: wz });
    }
    grid.push(pts);
  }

  // Draw far to near so nearer quads overpaint farther ones.
  for (let ri = grid.length - 2; ri >= 0; ri--) {
    const near = grid[ri];
    const far = grid[ri + 1];
    for (let ci = 0; ci < cols; ci++) {
      const a = far[ci];
      const b = far[ci + 1];
      const c = near[ci + 1];
      const e = near[ci];
      const pa = project(cam, a.x, a.y, a.z);
      if (!pa) continue;
      const pb = project(cam, b.x, b.y, b.z);
      const pc = project(cam, c.x, c.y, c.z);
      const pe = project(cam, e.x, e.y, e.z);
      if (!pb || !pc || !pe) continue;
      const midD = (pa.d + pc.d) / 2;
      const midX = (a.x + c.x) / 2;
      const midZ = (a.z + c.z) / 2;
      const midH = (a.y + c.y) / 2;
      const slope =
        Math.abs(heightAt(midX + 14, midZ) - midH) / 14 +
        Math.abs(heightAt(midX, midZ + 14) - midH) / 14;
      // Quantize the colour sample point so neighbouring quads share one
      // patch colour instead of checkerboarding.
      const qx = Math.floor(midX / 110) * 110;
      const qz = Math.floor(midZ / 110) * 110;
      let rgb = groundColor(qx, qz, midH, slope);
      // Face normal from two edges for sun shading.
      const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
      const vx = e.x - a.x, vy = e.y - a.y, vz = e.z - a.z;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      rgb = shadeQuad(rgb, nx, ny, nz, sunDir[0], sunDir[1], sunDir[2]);
      rgb = fogMix(rgb, midD);
      ctx.fillStyle = `rgb(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0})`;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.lineTo(pc.x, pc.y);
      ctx.lineTo(pe.x, pe.y);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function drawStrip(ctx, cam, pts, color, widthScale) {
  // Draw a ground-hugging strip (river / runway) as projected quads.
  ctx.fillStyle = color;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const dx = p1.x - p0.x;
    const dz = p1.z - p0.z;
    const len = Math.hypot(dx, dz) || 1;
    const px = (-dz / len) * p0.w * 0.5;
    const pz = (dx / len) * p0.w * 0.5;
    const a = project(cam, p0.x - px, p0.y, p0.z - pz);
    const b = project(cam, p0.x + px, p0.y, p0.z + pz);
    const c = project(cam, p1.x + px, p1.y, p1.z + pz);
    const e = project(cam, p1.x - px, p1.y, p1.z - pz);
    if (!a || !b || !c || !e) continue;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(e.x, e.y);
    ctx.closePath();
    ctx.fill();
  }
}

export function drawRiver(ctx, cam) {
  const pts = riverPoints(160).map((p) => ({ ...p, w: 15 }));
  drawStrip(ctx, cam, pts, 'rgba(74, 128, 168, 0.92)');
  // Sun glints on the water.
  const glint = riverPoints(480).map((p) => ({ ...p, w: 4 }));
  drawStrip(ctx, cam, glint, 'rgba(255, 240, 200, 0.5)');
}

export function drawAirstrips(ctx, cam) {
  for (const pad of AIRSTRIPS) {
    const pts = [];
    const steps = 10;
    for (let i = 0; i <= steps; i++) {
      const along = (i / steps - 0.5) * pad.length;
      const x = pad.x + Math.sin(pad.heading) * along;
      const z = pad.z + Math.cos(pad.heading) * along;
      pts.push({ x, z, y: heightAt(x, z) + 0.5, w: pad.width });
    }
    drawStrip(ctx, cam, pts, 'rgba(74, 92, 58, 0.95)');
    // Centreline dashes.
    const dashes = [];
    for (let i = 0; i <= steps; i += 2) {
      const along = (i / steps - 0.5) * pad.length;
      const x = pad.x + Math.sin(pad.heading) * along;
      const z = pad.z + Math.cos(pad.heading) * along;
      dashes.push({ x, z, y: heightAt(x, z) + 0.7, w: 3 });
      const along2 = along + pad.length / steps;
      const x2 = pad.x + Math.sin(pad.heading) * along2;
      const z2 = pad.z + Math.cos(pad.heading) * along2;
      dashes.push({ x: x2, z: z2, y: heightAt(x2, z2) + 0.7, w: 3 });
    }
    drawStrip(ctx, cam, dashes, 'rgba(240, 238, 220, 0.9)');
    // Threshold bars at both ends.
    for (const end of [-1, 1]) {
      const along = end * (pad.length * 0.5 - 8);
      const x = pad.x + Math.sin(pad.heading) * along;
      const z = pad.z + Math.cos(pad.heading) * along;
      const y = heightAt(x, z) + 0.7;
      const rx = Math.cos(pad.heading);
      const rz = -Math.sin(pad.heading);
      const p1 = project(cam, x - rx * pad.width * 0.4, y, z - rz * pad.width * 0.4);
      const p2 = project(cam, x + rx * pad.width * 0.4, y, z + rz * pad.width * 0.4);
      if (p1 && p2) {
        ctx.strokeStyle = 'rgba(250,248,235,0.95)';
        ctx.lineWidth = Math.max(1, 6 * p1.s * 0.05);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
    }
  }
}

export function drawDropZones(ctx, cam, taken) {
  for (let i = 0; i < DROP_ZONES.length; i++) {
    const dz = DROP_ZONES[i];
    const y = heightAt(dz.x, dz.z) + 0.8;
    const pts = [];
    for (let a = 0; a <= 20; a++) {
      const t = (a / 20) * Math.PI * 2;
      pts.push({ x: dz.x + Math.cos(t) * dz.radius, z: dz.z + Math.sin(t) * dz.radius, y, w: 0 });
    }
    const first = project(cam, pts[0].x, y, pts[0].z);
    if (!first) continue;
    ctx.strokeStyle = taken[i] ? 'rgba(120, 220, 140, 0.95)' : 'rgba(255, 196, 66, 0.95)';
    ctx.lineWidth = Math.max(1.5, 90 * first.s * 0.06);
    ctx.beginPath();
    let started = false;
    for (const p of pts) {
      const q = project(cam, p.x, y, p.z);
      if (!q) continue;
      if (!started) { ctx.moveTo(q.x, q.y); started = true; }
      else ctx.lineTo(q.x, q.y);
    }
    ctx.closePath();
    ctx.stroke();
    // Centre marker post with a windsock-coloured flag.
    const top = project(cam, dz.x, y + 16, dz.z);
    const base = project(cam, dz.x, y, dz.z);
    if (top && base) {
      ctx.strokeStyle = 'rgba(60,50,40,0.9)';
      ctx.lineWidth = Math.max(1, 30 * base.s * 0.05);
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(top.x, top.y);
      ctx.stroke();
      ctx.fillStyle = '#e4572e';
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(top.x + 14 * top.s * 0.08 + 6, top.y + 3);
      ctx.lineTo(top.x, top.y + 7);
      ctx.closePath();
      ctx.fill();
    }
  }
}

// Trees, rocks and houses: billboards sorted far to near.
export function drawProps(ctx, cam) {
  const items = [];
  for (const t of SCATTER.trees) {
    const dx = t.x - cam.x;
    const dz = t.z - cam.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > 1100 * 1100) continue;
    items.push({ kind: 'tree', ...t, d2 });
  }
  for (const r of SCATTER.rocks) {
    const dx = r.x - cam.x;
    const dz = r.z - cam.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > 900 * 900) continue;
    items.push({ kind: 'rock', ...r, d2 });
  }
  for (const hs of SCATTER.houses) {
    const dx = hs.x - cam.x;
    const dz = hs.z - cam.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > 1500 * 1500) continue;
    items.push({ kind: 'house', ...hs, d2 });
  }
  items.sort((a, b) => b.d2 - a.d2);
  for (const it of items) {
    const p = project(cam, it.x, it.h, it.z);
    if (!p || p.d < 6) continue;
    const s = p.s;
    if (it.kind === 'tree') {
      const hgt = it.s * s * 0.9;
      const wid = it.s * s * 0.55;
      if (hgt < 2) continue;
      const fog = clamp(1 - p.d / 1300, 0.25, 1);
      ctx.fillStyle = `rgba(96, 74, 50, ${fog})`;
      ctx.fillRect(p.x - wid * 0.08, p.y - hgt * 0.18, wid * 0.16, hgt * 0.18);
      ctx.fillStyle = it.pine ? `rgba(38, 84, 52, ${fog})` : `rgba(74, 110, 52, ${fog})`;
      ctx.beginPath();
      ctx.moveTo(p.x - wid * 0.5, p.y - hgt * 0.12);
      ctx.lineTo(p.x, p.y - hgt);
      ctx.lineTo(p.x + wid * 0.5, p.y - hgt * 0.12);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(p.x - wid * 0.38, p.y - hgt * 0.45);
      ctx.lineTo(p.x, p.y - hgt * 1.12);
      ctx.lineTo(p.x + wid * 0.38, p.y - hgt * 0.45);
      ctx.closePath();
      ctx.fill();
    } else if (it.kind === 'rock') {
      const r = it.s * s * 0.5;
      if (r < 1.5) continue;
      ctx.fillStyle = 'rgba(128, 122, 112, 0.95)';
      ctx.beginPath();
      ctx.moveTo(p.x - r, p.y);
      ctx.lineTo(p.x - r * 0.3, p.y - r * 0.9);
      ctx.lineTo(p.x + r * 0.5, p.y - r * 0.7);
      ctx.lineTo(p.x + r, p.y);
      ctx.closePath();
      ctx.fill();
    } else {
      const wpx = it.w * s * 0.9;
      const hpx = it.w * 0.55 * s * 0.9;
      if (wpx < 3) continue;
      ctx.fillStyle = 'rgba(226, 214, 190, 0.97)';
      ctx.fillRect(p.x - wpx / 2, p.y - hpx, wpx, hpx);
      ctx.fillStyle = 'rgba(148, 64, 52, 0.97)';
      ctx.beginPath();
      ctx.moveTo(p.x - wpx * 0.62, p.y - hpx);
      ctx.lineTo(p.x, p.y - hpx * 1.7);
      ctx.lineTo(p.x + wpx * 0.62, p.y - hpx);
      ctx.closePath();
      ctx.fill();
    }
  }
}

// Course rings: glowing hoops standing in the sky along the valley.
export function drawRings(ctx, cam, passed, nextIndex, time) {
  const list = [...RINGS].sort((a, b) => {
    const da = (a.x - cam.x) ** 2 + (a.z - cam.z) ** 2;
    const db = (b.x - cam.x) ** 2 + (b.z - cam.z) ** 2;
    return db - da;
  });
  for (const ring of list) {
    const isNext = ring.index === nextIndex;
    const done = passed.has(ring.index);
    const pts = [];
    for (let i = 0; i <= 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      pts.push(project(cam, ring.x + Math.cos(a) * ring.radius, ring.y + Math.sin(a) * ring.radius, ring.z));
    }
    if (pts.some((p) => !p)) continue;
    const pulse = isNext ? 0.7 + 0.3 * Math.sin(time * 5) : 1;
    ctx.lineWidth = Math.max(2, 5 * pts[0].s * 0.12);
    ctx.strokeStyle = done
      ? 'rgba(120, 220, 140, 0.85)'
      : isNext
        ? `rgba(255, 196, 66, ${0.95 * pulse})`
        : 'rgba(255, 255, 255, 0.75)';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.stroke();
    if (isNext) {
      // Soft halo disc so the next ring reads at a glance.
      ctx.fillStyle = `rgba(255, 196, 66, ${0.10 * pulse})`;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fill();
    }
  }
}
