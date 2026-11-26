// HUD and cockpit instruments: big readable numbers for altitude, speed
// and heading, plus fuel, throttle, score and the mission line. The
// cockpit view adds a lit panel with an artificial horizon, airspeed and
// altitude dials, a compass tape and warning lamps.

import { clamp } from './noise.js';

const AMBER = '#ffc442';
const GREEN = '#7de38b';
const RED = '#ff5a4e';
const PANEL = 'rgba(16, 20, 24, 0.92)';

function fmt(n, digits) {
  return n.toFixed(digits === undefined ? 0 : digits);
}

function gauge(ctx, x, y, r, label, valueText, frac, color) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#10151a';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#3a4550';
  ctx.stroke();
  // Tick ring.
  ctx.strokeStyle = 'rgba(220, 230, 240, 0.55)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI * 0.75 + (i / 10) * Math.PI * 1.5;
    const x1 = x + Math.cos(a) * (r - 6);
    const y1 = y + Math.sin(a) * (r - 6);
    const x2 = x + Math.cos(a) * (r - 13);
    const y2 = y + Math.sin(a) * (r - 13);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  // Needle.
  const na = Math.PI * 0.75 + clamp(frac, 0, 1) * Math.PI * 1.5;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(na) * (r - 16), y + Math.sin(na) * (r - 16));
  ctx.stroke();
  ctx.fillStyle = '#e8eef4';
  ctx.font = `bold ${Math.round(r * 0.42)}px "Courier New", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(valueText, x, y + r * 0.42);
  ctx.fillStyle = 'rgba(232, 238, 244, 0.75)';
  ctx.font = `${Math.round(r * 0.26)}px "Courier New", monospace`;
  ctx.fillText(label, x, y - r * 0.52);
  ctx.restore();
}

export function drawHUD(ctx, w, h, state) {
  const p = state.plane;
  const knots = p.speed * 1.944;
  const feet = Math.max(0, (p.y - state.groundBelow) * 3.281);
  const hdg = ((p.yaw * 180) / Math.PI % 360 + 360) % 360;

  ctx.save();
  ctx.textBaseline = 'alphabetic';
  // Top-left instrument block: big lit numbers.
  ctx.fillStyle = 'rgba(10, 14, 18, 0.55)';
  ctx.fillRect(14, 12, 252, 96);
  ctx.strokeStyle = 'rgba(255, 196, 66, 0.35)';
  ctx.strokeRect(14, 12, 252, 96);
  ctx.textAlign = 'left';
  ctx.font = 'bold 30px "Courier New", monospace';
  ctx.fillStyle = AMBER;
  ctx.fillText(`SPD ${fmt(knots)}`, 26, 46);
  ctx.fillText(`ALT ${fmt(feet)}`, 26, 82);
  ctx.font = 'bold 22px "Courier New", monospace';
  ctx.fillStyle = '#e8eef4';
  ctx.fillText(`HDG ${fmt(hdg, 0).padStart(3, '0')}°`, 168, 46);
  ctx.fillStyle = p.speed < 27 ? RED : GREEN;
  ctx.fillText(p.speed < 27 ? 'STALL' : '      ', 168, 82);

  // Throttle + fuel bars, top-right.
  ctx.fillStyle = 'rgba(10, 14, 18, 0.55)';
  ctx.fillRect(w - 226, 12, 212, 96);
  ctx.strokeStyle = 'rgba(255, 196, 66, 0.35)';
  ctx.strokeRect(w - 226, 12, 212, 96);
  ctx.font = 'bold 16px "Courier New", monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e8eef4';
  ctx.fillText('THR', w - 214, 36);
  ctx.fillStyle = '#2a343c';
  ctx.fillRect(w - 168, 24, 140, 14);
  ctx.fillStyle = AMBER;
  ctx.fillRect(w - 168, 24, 140 * p.throttle, 14);
  ctx.fillStyle = '#e8eef4';
  ctx.fillText('FUEL', w - 214, 66);
  ctx.fillStyle = '#2a343c';
  ctx.fillRect(w - 168, 54, 140, 14);
  ctx.fillStyle = p.fuel < 25 ? RED : GREEN;
  ctx.fillRect(w - 168, 54, 140 * clamp(p.fuel / 100, 0, 1), 14);
  ctx.fillStyle = '#e8eef4';
  ctx.fillText(`SCORE ${state.score}`, w - 214, 96);

  // Mission line, top-centre.
  ctx.textAlign = 'center';
  ctx.font = 'bold 19px "Courier New", monospace';
  ctx.fillStyle = 'rgba(10, 14, 18, 0.55)';
  const line = state.missionLine;
  const tw = ctx.measureText(line).width + 28;
  ctx.fillRect(w / 2 - tw / 2, 14, tw, 30);
  ctx.fillStyle = '#ffe9b0';
  ctx.fillText(line, w / 2, 36);

  // Flight-path marker: small circle where the nose points.
  const mx = w / 2 + Math.sin(p.pitch) * 0 + 0;
  const my = h / 2;
  ctx.strokeStyle = 'rgba(125, 227, 139, 0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(mx, my, 10, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(mx - 16, my);
  ctx.lineTo(mx - 6, my);
  ctx.moveTo(mx + 6, my);
  ctx.lineTo(mx + 16, my);
  ctx.moveTo(mx, my - 16);
  ctx.lineTo(mx, my - 6);
  ctx.stroke();

  // Objective arrow: points toward the next target in screen space.
  if (state.objectiveDir) {
    const ax = w / 2 + state.objectiveDir[0] * 130;
    const ay = h / 2 + state.objectiveDir[1] * 130;
    const ang = Math.atan2(state.objectiveDir[1], state.objectiveDir[0]);
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(ang);
    ctx.fillStyle = AMBER;
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-8, -9);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-8, 9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.font = 'bold 15px "Courier New", monospace';
    ctx.fillStyle = '#ffe9b0';
    ctx.fillText(state.objectiveLabel, ax, ay + 26);
  }

  // Transient centre message (ring scored, touchdown, warnings).
  if (state.banner && state.bannerUntil > state.time) {
    ctx.font = 'bold 30px "Courier New", monospace';
    ctx.fillStyle = state.bannerColor || '#ffe9b0';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 8;
    ctx.fillText(state.banner, w / 2, h * 0.3);
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}

export function drawCockpitPanel(ctx, w, h, state) {
  const p = state.plane;
  const knots = p.speed * 1.944;
  const feet = Math.max(0, (p.y - state.groundBelow) * 3.281);
  const hdg = ((p.yaw * 180) / Math.PI % 360 + 360) % 360;

  ctx.save();
  // Glareshield.
  ctx.fillStyle = '#14181d';
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(0, h * 0.66);
  ctx.quadraticCurveTo(w * 0.5, h * 0.60, w, h * 0.66);
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#232a31';
  ctx.fillRect(0, h * 0.66, w, 8);

  const cy = h * 0.83;
  const cx = w / 2;
  // Artificial horizon.
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, 62, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate(-p.roll);
  const pitchPx = clamp(p.pitch, -0.6, 0.6) * 130;
  ctx.fillStyle = '#6fa8d8';
  ctx.fillRect(-90, -90 - pitchPx, 180, 90);
  ctx.fillStyle = '#7a5a38';
  ctx.fillRect(-90, -pitchPx, 180, 90);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-90, -pitchPx);
  ctx.lineTo(90, -pitchPx);
  ctx.stroke();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, 62, 0, Math.PI * 2);
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#c8ccd0';
  ctx.stroke();
  // Fixed wings symbol.
  ctx.strokeStyle = AMBER;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - 44, cy);
  ctx.lineTo(cx - 14, cy);
  ctx.moveTo(cx + 14, cy);
  ctx.lineTo(cx + 44, cy);
  ctx.stroke();

  gauge(ctx, cx - 190, cy, 52, 'KNOTS', fmt(knots), clamp(knots / 160, 0, 1), AMBER);
  gauge(ctx, cx + 190, cy, 52, 'FEET', fmt(feet), clamp(feet / 4000, 0, 1), AMBER);
  gauge(ctx, cx - 330, cy, 44, 'FUEL', fmt(p.fuel), clamp(p.fuel / 100, 0, 1), p.fuel < 25 ? RED : GREEN);

  // Compass tape.
  ctx.fillStyle = PANEL;
  ctx.fillRect(cx - 90, cy - 108, 180, 26);
  ctx.fillStyle = '#e8eef4';
  ctx.font = 'bold 17px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`HDG ${fmt(hdg).padStart(3, '0')}°`, cx, cy - 89);
  ctx.fillStyle = AMBER;
  ctx.fillRect(cx - 2, cy - 112, 4, 8);

  // Warning lamps.
  const lamps = [
    { label: 'STALL', on: p.speed < 27, color: RED },
    { label: 'FUEL', on: p.fuel < 25, color: RED },
    { label: 'GEAR', on: p.gearDown, color: GREEN },
  ];
  lamps.forEach((lamp, i) => {
    const lx = cx + 290 + i * 62;
    ctx.fillStyle = lamp.on ? lamp.color : '#2a343c';
    ctx.beginPath();
    ctx.arc(lx, cy - 40, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(232,238,244,0.7)';
    ctx.font = '11px "Courier New", monospace';
    ctx.fillText(lamp.label, lx, cy - 22);
  });

  // Throttle quadrant, lower right.
  ctx.fillStyle = '#0d1114';
  ctx.fillRect(w - 120, h - 118, 92, 104);
  ctx.strokeStyle = '#3a4550';
  ctx.strokeRect(w - 120, h - 118, 92, 104);
  ctx.fillStyle = '#e8eef4';
  ctx.font = 'bold 12px "Courier New", monospace';
  ctx.fillText('THROTTLE', w - 74, h - 100);
  ctx.fillStyle = '#2a343c';
  ctx.fillRect(w - 104, h - 92, 16, 66);
  ctx.fillStyle = AMBER;
  const th = 66 * p.throttle;
  ctx.fillRect(w - 104, h - 26 - th, 16, th);
  ctx.restore();
}
