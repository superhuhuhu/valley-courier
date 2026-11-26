// The aircraft: an arcade flight model with stall, drag and ground effect
// flavour, plus the low-poly bush plane itself, drawn as shaded polygons
// in world space so it banks, pitches and yaws with the flight state.

import { clamp, lerp, damp } from './noise.js';
import { project } from './camera.js';
import { heightAt, AIRSTRIPS } from './terrain.js';

export const PLANE = {
  maxSpeed: 96, // m/s
  cruiseSpeed: 55,
  stallSpeed: 27,
  vne: 108, // never-exceed: airframe shakes past this
  maxFuel: 100,
  burnRate: 0.55, // fuel units per second at full throttle
};

export function makePlane(start) {
  return {
    x: start.x, y: start.y, z: start.z,
    yaw: start.yaw, pitch: 0, roll: 0,
    speed: start.speed ?? 46,
    throttle: 0.62,
    vy: 0,
    fuel: PLANE.maxFuel,
    damage: 0,
    propAngle: 0,
    gearDown: true,
    forward: [0, 0, 1],
    right: [1, 0, 0],
    up: [0, 1, 0],
    crashed: false,
    grounded: false,
    airtime: 0,
  };
}

export function updatePlaneBasis(p) {
  const cy = Math.cos(p.yaw);
  const sy = Math.sin(p.yaw);
  const cp = Math.cos(p.pitch);
  const sp = Math.sin(p.pitch);
  p.forward = [sy * cp, sp, cy * cp];
  const r0 = [cy, 0, -sy];
  // up = fwd x right (right-handed: right, up, forward).
  const u0 = [
    p.forward[1] * r0[2] - p.forward[2] * r0[1],
    p.forward[2] * r0[0] - p.forward[0] * r0[2],
    p.forward[0] * r0[1] - p.forward[1] * r0[0],
  ];
  const cr = Math.cos(p.roll);
  const sr = Math.sin(p.roll);
  p.right = [r0[0] * cr + u0[0] * sr, r0[1] * cr + u0[1] * sr, r0[2] * cr + u0[2] * sr];
  p.up = [u0[0] * cr - r0[0] * sr, u0[1] * cr - r0[1] * sr, u0[2] * cr - r0[2] * sr];
}

// input: {pitch, roll, throttleDelta, brake} in [-1, 1]; returns events.
export function stepPlane(p, input, dt) {
  const events = [];
  if (p.crashed) return events;
  updatePlaneBasis(p);

  p.throttle = clamp(p.throttle + input.throttleDelta * dt * 0.7, 0, 1);
  const thrust = p.throttle * 26;
  const drag = 0.0042 * p.speed * p.speed + (input.brake ? 14 : 0);
  p.speed = clamp(p.speed + (thrust - drag) * dt, 0, PLANE.vne + 14);
  p.propAngle += dt * (4 + p.throttle * 46);

  // Pitch and roll answer at every speed, but weaken near the stall.
  const authority = clamp((p.speed - 12) / 40, 0.25, 1);
  const targetPitch = clamp(input.pitch * 0.5 * authority, -0.5, 0.5);
  const targetRoll = clamp(input.roll * 1.05 * authority, -1.05, 1.05);
  p.pitch = damp(p.pitch, targetPitch, 3.2, dt);
  p.roll = damp(p.roll, targetRoll, 3.6, dt);

  // Coordinated turn: roll swings the heading, faster when fast.
  const turnRate = -p.roll * clamp(p.speed / 60, 0.3, 1.4) * 0.55;
  p.yaw += turnRate * dt;

  // Vertical speed: climb with pitch and power, sink when slow.
  const stalling = p.speed < PLANE.stallSpeed;
  const liftTarget = Math.sin(p.pitch) * p.speed * 0.92 + (p.throttle - 0.45) * 6;
  const sink = stalling ? -9 : 0;
  p.vy = damp(p.vy, liftTarget + sink, 1.6, dt);

  updatePlaneBasis(p);
  p.x += p.forward[0] * p.speed * dt;
  p.z += p.forward[2] * p.speed * dt;
  p.y += p.vy * dt + p.forward[1] * p.speed * dt * 0.4;
  p.airtime += dt;

  // Fuel: throttle burns it; empty tanks mean a glide.
  if (p.throttle > 0 && p.fuel > 0) {
    p.fuel = Math.max(0, p.fuel - PLANE.burnRate * (0.25 + p.throttle) * dt);
    if (p.fuel === 0) events.push({ type: 'fuel-empty' });
  }

  // Ground contact: a gentle arrival on a strip is a roll-out; anything
  // else at ground level is a crash. Gear up on a strip is a crash too.
  const ground = heightAt(p.x, p.z);
  const clearance = p.y - ground;
  let onPad = null;
  for (const pad of AIRSTRIPS) {
    const dx = p.x - pad.x;
    const dz = p.z - pad.z;
    const along = Math.abs(dx * Math.sin(pad.heading) + dz * Math.cos(pad.heading));
    const across = Math.abs(dx * Math.cos(pad.heading) - dz * Math.sin(pad.heading));
    if (along < pad.length * 0.5 + 20 && across < pad.width * 0.5 + 12) {
      onPad = pad;
      break;
    }
  }
  if (clearance <= 1.2) {
    const descent = -(p.vy + p.forward[1] * p.speed * 0.4);
    const gentle = p.speed < 34 && descent < 4.5 && Math.abs(p.roll) < 0.25;
    if (onPad && gentle && p.gearDown) {
      const wasAirborne = !p.grounded;
      p.y = ground + 1.2;
      p.vy = 0;
      p.grounded = true;
      if (p.speed > 6) p.speed = damp(p.speed, 0, 0.9, dt);
      if (wasAirborne) events.push({ type: 'touchdown', pad: onPad });
    } else if (clearance <= 0.4) {
      p.crashed = true;
      events.push({ type: 'crash', descent, speed: p.speed });
    } else {
      p.y = ground + 1.2;
      p.vy = Math.max(0, p.vy);
    }
  } else if (clearance > 4) {
    p.grounded = false;
  }
  if (stalling && !p.stallWarned) {
    events.push({ type: 'stall' });
    p.stallWarned = true;
  }
  if (!stalling) p.stallWarned = false;
  return events;
}

// --- The bush plane model: vertices in body space (nose +z, up +y) --------
const BODY = {
  // fuselage cross-sections from tail (z=-4.6) to nose (z=+4.6)
  sections: [
    { z: -4.6, w: 0.22, h: 0.30, y: 0.35 },
    { z: -3.2, w: 0.55, h: 0.62, y: 0.35 },
    { z: -1.2, w: 0.78, h: 0.85, y: 0.32 },
    { z: 1.2, w: 0.82, h: 0.88, y: 0.30 },
    { z: 3.0, w: 0.62, h: 0.70, y: 0.28 },
    { z: 4.4, w: 0.30, h: 0.42, y: 0.26 },
    { z: 4.75, w: 0.06, h: 0.10, y: 0.25 },
  ],
};

function bodyPoint(sec, side, top) {
  return [sec.w * side, sec.y + sec.h * top, sec.z];
}

function transformPoint(p, origin, right, up, fwd) {
  return [
    origin[0] + p[0] * right[0] + p[1] * up[0] + p[2] * fwd[0],
    origin[1] + p[0] * right[1] + p[1] * up[1] + p[2] * fwd[1],
    origin[2] + p[0] * right[2] + p[1] * up[2] + p[2] * fwd[2],
  ];
}

function drawPoly(ctx, cam, pts, fill) {
  const sp = pts.map((p) => project(cam, p[0], p[1], p[2]));
  if (sp.some((q) => !q)) return;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(sp[0].x, sp[0].y);
  for (let i = 1; i < sp.length; i++) ctx.lineTo(sp[i].x, sp[i].y);
  ctx.closePath();
  ctx.fill();
}

export function drawPlane(ctx, cam, p, time) {
  const origin = [p.x, p.y, p.z];
  const T = (pt) => transformPoint(pt, origin, p.right, p.up, p.forward);
  const faces = [];

  // Fuselage: quads between sections, four sides.
  const paint = '#c8442c'; // signal-red bush plane
  const paintDark = '#a83420';
  const paintTop = '#d95a3a';
  for (let i = 0; i < BODY.sections.length - 1; i++) {
    const a = BODY.sections[i];
    const b = BODY.sections[i + 1];
    const sun = i % 2 === 0;
    faces.push({ pts: [bodyPoint(a, -1, 0.5), bodyPoint(b, -1, 0.5), bodyPoint(b, -1, -0.5), bodyPoint(a, -1, -0.5)], fill: paint, d: (a.z + b.z) / 2 });
    faces.push({ pts: [bodyPoint(a, 1, -0.5), bodyPoint(b, 1, -0.5), bodyPoint(b, 1, 0.5), bodyPoint(a, 1, 0.5)], fill: paintDark, d: (a.z + b.z) / 2 });
    faces.push({ pts: [bodyPoint(a, -1, 0.5), bodyPoint(a, 1, 0.5), bodyPoint(b, 1, 0.5), bodyPoint(b, -1, 0.5)], fill: paintTop, d: (a.z + b.z) / 2 });
    faces.push({ pts: [bodyPoint(a, 1, -0.5), bodyPoint(a, -1, -0.5), bodyPoint(b, -1, -0.5), bodyPoint(b, 1, -0.5)], fill: '#7e2a18', d: (a.z + b.z) / 2 });
  }
  // Nose cap + tail cap.
  const nose = BODY.sections[BODY.sections.length - 1];
  faces.push({ pts: [bodyPoint(nose, -1, 0.5), bodyPoint(nose, 1, 0.5), bodyPoint(nose, 1, -0.5), bodyPoint(nose, -1, -0.5)], fill: '#3a3f45', d: nose.z });
  const tail = BODY.sections[0];
  faces.push({ pts: [bodyPoint(tail, -1, 0.5), bodyPoint(tail, -1, -0.5), bodyPoint(tail, 1, -0.5), bodyPoint(tail, 1, 0.5)], fill: paintDark, d: tail.z });

  // Canopy: dark glasshouse over the cabin.
  faces.push({
    pts: [[-0.62, 1.05, -0.4], [0.62, 1.05, -0.4], [0.55, 1.02, 1.6], [-0.55, 1.02, 1.6]],
    fill: '#20303c', d: 0.6,
  });
  faces.push({
    pts: [[-0.62, 1.05, -0.4], [-0.55, 1.02, 1.6], [-0.55, 0.62, 1.7], [-0.62, 0.6, -0.4]],
    fill: '#2c424e', d: 0.6,
  });
  faces.push({
    pts: [[0.62, 1.05, -0.4], [0.62, 0.6, -0.4], [0.55, 0.62, 1.7], [0.55, 1.02, 1.6]],
    fill: '#2c424e', d: 0.6,
  });

  // Wings: high wing with slight dihedral, red with cream tips.
  const wingZ = 0.9;
  const wingY = 1.28;
  faces.push({
    pts: [[-5.6, wingY, wingZ - 0.7], [-0.7, wingY, wingZ - 0.85], [-0.7, wingY, wingZ + 0.75], [-5.6, wingY, wingZ + 0.6]],
    fill: '#e8e0cc', d: wingZ,
  });
  faces.push({
    pts: [[0.7, wingY, wingZ - 0.85], [5.6, wingY, wingZ - 0.7], [5.6, wingY, wingZ + 0.6], [0.7, wingY, wingZ + 0.75]],
    fill: '#e8e0cc', d: wingZ,
  });
  faces.push({
    pts: [[-5.6, wingY, wingZ - 0.7], [-5.6, wingY, wingZ + 0.6], [-4.9, wingY, wingZ + 0.6], [-4.9, wingY, wingZ - 0.7]],
    fill: paint, d: wingZ,
  });
  faces.push({
    pts: [[4.9, wingY, wingZ - 0.7], [4.9, wingY, wingZ + 0.6], [5.6, wingY, wingZ + 0.6], [5.6, wingY, wingZ - 0.7]],
    fill: paint, d: wingZ,
  });
  // Wing struts.
  faces.push({ pts: [[-2.6, 0.1, 1.1], [-2.45, 0.1, 1.1], [-0.7, 1.24, 0.9], [-0.85, 1.24, 0.9]], fill: '#5a5148', d: 1 });
  faces.push({ pts: [[2.45, 0.1, 1.1], [2.6, 0.1, 1.1], [0.85, 1.24, 0.9], [0.7, 1.24, 0.9]], fill: '#5a5148', d: 1 });

  // Tailplane + fin.
  faces.push({
    pts: [[-2.3, 0.75, -4.3], [-0.3, 0.72, -4.35], [-0.3, 0.72, -3.35], [-2.3, 0.75, -3.4]],
    fill: paintTop, d: -3.9,
  });
  faces.push({
    pts: [[0.3, 0.72, -4.35], [2.3, 0.75, -4.3], [2.3, 0.75, -3.4], [0.3, 0.72, -3.35]],
    fill: paintTop, d: -3.9,
  });
  faces.push({
    pts: [[0, 0.5, -4.5], [0, 0.5, -3.3], [0, 1.9, -3.9], [0, 1.75, -4.45]],
    fill: paint, d: -3.9,
  });
  // Fin flash: cream stripe.
  faces.push({
    pts: [[-0.06, 1.15, -4.12], [0.06, 1.15, -4.12], [0.06, 1.5, -4.0], [-0.06, 1.5, -4.0]],
    fill: '#e8e0cc', d: -4.0,
  });

  // Sort far-to-near along the camera forward axis, then draw.
  const camFwd = cam.fwd;
  const withDepth = faces.map((f) => {
    const wp = f.pts.map(T);
    const cx = wp.reduce((s, q) => s + q[0], 0) / wp.length;
    const cy = wp.reduce((s, q) => s + q[1], 0) / wp.length;
    const cz = wp.reduce((s, q) => s + q[2], 0) / wp.length;
    const depth = (cx - cam.x) * camFwd[0] + (cy - cam.y) * camFwd[1] + (cz - cam.z) * camFwd[2];
    return { wp, fill: f.fill, depth };
  });
  withDepth.sort((a, b) => b.depth - a.depth);
  for (const f of withDepth) drawPoly(ctx, cam, f.wp, f.fill);

  // Propeller: translucent disc + two blades, spinning.
  const hub = T([0, 0.25, 4.85]);
  const hp = project(cam, hub[0], hub[1], hub[2]);
  if (hp) {
    const discR = 1.55 * hp.s * 0.9;
    ctx.fillStyle = 'rgba(40, 44, 48, 0.18)';
    ctx.beginPath();
    ctx.ellipse(hp.x, hp.y, discR, discR, 0, 0, Math.PI * 2);
    ctx.fill();
    const a1 = p.propAngle;
    const a2 = a1 + Math.PI / 2;
    for (const a of [a1, a2]) {
      const bx = Math.cos(a) * discR;
      const by = Math.sin(a) * discR * 0.92;
      ctx.strokeStyle = 'rgba(30, 32, 36, 0.55)';
      ctx.lineWidth = Math.max(2, discR * 0.08);
      ctx.beginPath();
      ctx.moveTo(hp.x - bx, hp.y - by);
      ctx.lineTo(hp.x + bx, hp.y + by);
      ctx.stroke();
    }
  }

  // Navigation lights: red left, green right, white tail.
  const lights = [
    { pt: [-5.6, wingY, wingZ], color: '#ff3b30' },
    { pt: [5.6, wingY, wingZ], color: '#34d399' },
    { pt: [0, 0.6, -4.7], color: '#ffffff' },
  ];
  for (const L of lights) {
    const wp = T(L.pt);
    const q = project(cam, wp[0], wp[1], wp[2]);
    if (!q) continue;
    ctx.fillStyle = L.color;
    ctx.beginPath();
    ctx.arc(q.x, q.y, Math.max(2, 3.2 * q.s * 0.06), 0, Math.PI * 2);
    ctx.fill();
  }
}
