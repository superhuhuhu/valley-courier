// Sky, sun, clouds and the far mountain silhouette. One consistent
// late-afternoon look: warm low sun in the west, cool blue shadows.

import { valueNoise, clamp } from './noise.js';

export const SUN_DIR = [-0.55, 0.28, 0.79]; // toward the sun, normalised-ish

export function drawSky(ctx, w, h, cam, time) {
  const horizonY = cam.cy - cam.pitch * cam.focal * 1.4 - cam.roll * 40;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#3d6fb4');
  g.addColorStop(0.45, '#7fa8d4');
  g.addColorStop(0.72, '#cfdde8');
  g.addColorStop(0.82, '#f2d9a8');
  g.addColorStop(1, '#e8c489');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h + 1);

  // Sun disc + glow, placed by projecting a far point along the sun dir.
  const sunPoint = {
    x: cam.x + SUN_DIR[0] * 4000,
    y: cam.y + SUN_DIR[1] * 4000,
    z: cam.z + SUN_DIR[2] * 4000,
  };
  const dx = sunPoint.x - cam.x;
  const dy = sunPoint.y - cam.y;
  const dz = sunPoint.z - cam.z;
  const cx = dx * cam.right[0] + dy * cam.right[1] + dz * cam.right[2];
  const cy = dx * cam.up[0] + dy * cam.up[1] + dz * cam.up[2];
  const cz = dx * cam.fwd[0] + dy * cam.fwd[1] + dz * cam.fwd[2];
  if (cz > 0) {
    const s = cam.focal / cz;
    const sx = cam.cx + cx * s;
    const sy = cam.cy - cy * s;
    const glow = ctx.createRadialGradient(sx, sy, 4, sx, sy, 190);
    glow.addColorStop(0, 'rgba(255, 236, 180, 0.95)');
    glow.addColorStop(0.25, 'rgba(255, 220, 140, 0.55)');
    glow.addColorStop(1, 'rgba(255, 210, 120, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(sx - 200, sy - 200, 400, 400);
    ctx.fillStyle = '#fff3cf';
    ctx.beginPath();
    ctx.arc(sx, sy, 26, 0, Math.PI * 2);
    ctx.fill();
  }

  // Far ridge silhouette: a jagged band hugging the horizon.
  ctx.fillStyle = '#8fa3bd';
  ctx.beginPath();
  ctx.moveTo(-4, horizonY + 30);
  for (let sx = -4; sx <= w + 4; sx += 26) {
    const n = valueNoise(sx * 0.006 + 3.1, 4.7, 77, 1);
    const n2 = valueNoise(sx * 0.02 + 9.2, 1.3, 78, 1);
    const peak = horizonY + 26 - n * 150 - n2 * 46 + Math.sin(time * 0.02) * 0;
    ctx.lineTo(sx, peak);
  }
  ctx.lineTo(w + 4, h);
  ctx.lineTo(-4, h);
  ctx.closePath();
  ctx.fill();

  // Haze band just above the horizon.
  const haze = ctx.createLinearGradient(0, horizonY - 30, 0, horizonY + 90);
  haze.addColorStop(0, 'rgba(240, 224, 190, 0)');
  haze.addColorStop(0.6, 'rgba(240, 224, 190, 0.5)');
  haze.addColorStop(1, 'rgba(240, 224, 190, 0)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, horizonY - 30, w, 130);
  return horizonY;
}

// Drifting clouds: soft ellipse clusters, drawn in world space so the
// pilot can fly under them.
export function makeClouds() {
  const clouds = [];
  const rand = (() => {
    let s = 991;
    return () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
  })();
  for (let i = 0; i < 26; i++) {
    clouds.push({
      x: (rand() * 2 - 1) * 5200,
      y: 330 + rand() * 260,
      z: (rand() * 2 - 1) * 5200,
      s: 90 + rand() * 190,
      drift: 1.5 + rand() * 2,
    });
  }
  return clouds;
}

export function drawClouds(ctx, cam, clouds, time, project) {
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (const c of clouds) {
    const x = c.x + time * c.drift;
    const p = project(cam, x, c.y, c.z);
    if (!p || p.d > 4200) continue;
    const sc = p.s * c.s * 0.5;
    if (sc < 3) continue;
    const alpha = clamp(1 - p.d / 4200, 0, 1) * 0.85;
    ctx.fillStyle = `rgba(255, 252, 246, ${alpha})`;
    for (let i = 0; i < 4; i++) {
      const ox = (i - 1.5) * sc * 0.55;
      const oy = Math.sin(i * 2.4) * sc * 0.12;
      ctx.beginPath();
      ctx.ellipse(p.x + ox, p.y + oy, sc * 0.62, sc * 0.26, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
