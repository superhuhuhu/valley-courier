// Valley Courier: a bush-plane courier game in one valley. Boot, the
// frame loop, the screen states (title, flying, paused, crashed,
// complete) and the draw order that every frame follows.

import { makeCamera, updateBasis, project, chasePlacement, cockpitPlacement } from './camera.js';
import { drawSky, drawClouds, makeClouds, SUN_DIR } from './sky.js';
import { drawTerrain, drawRiver, drawAirstrips, drawDropZones, drawProps, drawRings } from './render.js';
import { makePlane, stepPlane, drawPlane } from './plane.js';
import { makeInput, controlAxes, attachMouse } from './input.js';
import { drawHUD, drawCockpitPanel } from './instruments.js';
import { MISSIONS, makeMissionState, stepMission, missionLine, objectiveTarget, dropParcel, stepParcels } from './missions.js';
import { makeAudio } from './audio.js';
import { heightAt } from './terrain.js';
import { shotPreset, startSelfTest, finishSelfTest, SELFTEST_STEPS } from './photo.js';
import { clamp } from './noise.js';

const W = 1280;
const H = 720;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
canvas.width = W;
canvas.height = H;

const input = makeInput();
attachMouse(input, canvas);
const audio = makeAudio();
const clouds = makeClouds();
const cam = makeCamera();
cam.cx = W / 2;
cam.cy = H / 2;
cam.focal = 620;

const params = new URLSearchParams(location.search);
const shot = shotPreset(params.get('shot') || '');
const selfTest = params.get('selftest') === '1';

const game = {
  state: 'title',
  missionIndex: 0,
  plane: null,
  mission: null,
  camMode: 'chase',
  chaseSmooth: { x: 0, y: 0, z: 0 },
  time: 0,
  frameCount: 0,
  score: 0,
  banner: '',
  bannerColor: '#ffe9b0',
  bannerUntil: 0,
  selectedMission: 0,
  completeAt: 0,
  selfTestAxes: null,
  shake: 0,
};

function showBanner(text, color, seconds) {
  game.banner = text;
  game.bannerColor = color || '#ffe9b0';
  game.bannerUntil = game.time + (seconds || 2.2);
}

function startMission(index) {
  const mission = MISSIONS[index];
  game.missionIndex = index;
  const start = mission.start;
  const y = heightAt(start.x, start.z) + 90;
  game.plane = makePlane({ x: start.x, y, z: start.z, yaw: start.yaw, speed: start.speed });
  game.mission = makeMissionState(mission.id);
  game.mission.startTime = game.time;
  game.score = 0;
  game.camMode = 'chase';
  game.chaseSmooth = { x: start.x, y: y + 4, z: start.z - 16 };
  game.state = 'flying';
  game.completeAt = 0;
  showBanner(mission.name, '#ffc442', 2.4);
}

function startShotMode(preset) {
  game.missionIndex = preset.mission;
  const s = preset.start;
  game.plane = makePlane({ x: s.x, y: s.y, z: s.z, yaw: s.yaw, speed: s.speed });
  game.plane.roll = preset.roll;
  game.plane.pitch = preset.pitch;
  game.plane.throttle = preset.throttle;
  game.mission = makeMissionState(MISSIONS[preset.mission].id);
  game.mission.startTime = game.time;
  game.camMode = preset.cam;
  game.chaseSmooth = { x: s.x, y: s.y + 4, z: s.z - 16 };
  game.state = 'flying';
  game.shotMode = true;
  // Hold the posed attitude so the framed shot stays composed.
  game.shotAxes = {
    pitch: preset.pitch / 0.5,
    roll: preset.roll / 1.05,
    throttleDelta: 0,
    brake: false,
  };
}

input.onKey = (code) => {
  audio.unlock();
  if (code === 'KeyN') {
    const muted = audio.toggleMute();
    showBanner(muted ? 'SOUND OFF' : 'SOUND ON', '#e8eef4', 1.2);
    return;
  }
  if (game.state === 'title') {
    if (code === 'Digit1') startMission(0);
    if (code === 'Digit2') startMission(1);
    if (code === 'Digit3') startMission(2);
    return;
  }
  if (code === 'KeyP') {
    if (game.state === 'flying') game.state = 'paused';
    else if (game.state === 'paused') game.state = 'flying';
    return;
  }
  if (code === 'KeyC' && game.state === 'flying') {
    game.camMode = game.camMode === 'chase' ? 'cockpit' : 'chase';
    return;
  }
  if (code === 'KeyR' && game.state !== 'title') {
    startMission(game.missionIndex);
    return;
  }
  if (code === 'Digit1' || code === 'Digit2' || code === 'Digit3') {
    const idx = code === 'Digit1' ? 0 : code === 'Digit2' ? 1 : 2;
    startMission(idx);
    return;
  }
  if (code === 'Space' && game.state === 'flying' && game.mission.id === 'parcels') {
    if (dropParcel(game.mission, game.plane)) {
      showBanner('PARCEL AWAY', '#e8eef4', 1.0);
    }
  }
  if (code === 'KeyG' && game.state === 'flying') {
    game.plane.gearDown = !game.plane.gearDown;
    showBanner(game.plane.gearDown ? 'GEAR DOWN' : 'GEAR UP', '#e8eef4', 1.2);
  }
};

canvas.addEventListener('click', (e) => {
  audio.unlock();
  if (game.state !== 'title') return;
  const r = canvas.getBoundingClientRect();
  const y = ((e.clientY - r.top) / r.height) * H;
  const rows = [300, 360, 420];
  for (let i = 0; i < rows.length; i++) {
    if (Math.abs(y - rows[i]) < 26) {
      startMission(i);
      return;
    }
  }
});

function objectiveDirection() {
  const target = objectiveTarget(game.mission);
  if (!target) return null;
  const p = project(cam, target.x, target.y, target.z);
  const cx = W / 2;
  const cy = H / 2;
  let dir;
  if (p && p.d > 0) {
    dir = [p.x - cx, p.y - cy];
  } else {
    // Target behind: point sideways by bearing difference.
    const bearing = Math.atan2(target.x - game.plane.x, target.z - game.plane.z);
    let diff = bearing - game.plane.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    dir = [Math.sin(diff) * 100, -40];
  }
  const len = Math.hypot(dir[0], dir[1]) || 1;
  const dist = Math.round(Math.hypot(target.x - game.plane.x, target.y - game.plane.y, target.z - game.plane.z));
  return { dir: [dir[0] / len, dir[1] / len], label: `${dist}m` };
}

function drawParcels() {
  for (const parcel of game.mission.parcels) {
    const p = project(cam, parcel.x, parcel.y, parcel.z);
    if (!p) continue;
    const s = Math.max(2, 3.2 * p.s * 0.1);
    ctx.fillStyle = '#b07a3e';
    ctx.fillRect(p.x - s, p.y - s, s * 2, s * 2);
    ctx.strokeStyle = 'rgba(60,40,20,0.8)';
    ctx.strokeRect(p.x - s, p.y - s, s * 2, s * 2);
  }
}

function drawTitleBackground(dt) {
  // Slow cinematic drift down the valley behind the title text.
  const tz = ((game.time * 26) % 9000) - 4500;
  const tx = Math.sin(tz * 0.0006) * 300;
  const ty = heightAt(tx, tz) + 150;
  cam.x = tx;
  cam.y = ty;
  cam.z = tz;
  cam.yaw = 0.05 + Math.sin(game.time * 0.05) * 0.06;
  cam.pitch = -0.06;
  cam.roll = 0;
  updateBasis(cam);
  drawSky(ctx, W, H, cam, game.time);
  drawClouds(ctx, cam, clouds, game.time, (c, x, y, z) => project(c, x, y, z));
  drawTerrain(ctx, cam, SUN_DIR);
  drawRiver(ctx, cam);
  drawAirstrips(ctx, cam);
  drawProps(ctx, cam);
}

function drawTitle() {
  ctx.save();
  ctx.fillStyle = 'rgba(8, 12, 16, 0.45)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffe9b0';
  ctx.font = 'bold 64px Georgia, serif';
  ctx.fillText('VALLEY COURIER', W / 2, 130);
  ctx.fillStyle = '#e8eef4';
  ctx.font = '22px Georgia, serif';
  ctx.fillText('A bush-plane courier run through one long valley.', W / 2, 172);
  ctx.font = 'bold 20px "Courier New", monospace';
  ctx.fillStyle = '#ffc442';
  ctx.fillText('CHOOSE A SORTIE — CLICK OR PRESS 1 / 2 / 3', W / 2, 246);
  MISSIONS.forEach((m, i) => {
    const y = [300, 360, 420][i];
    const selected = game.selectedMission === i;
    ctx.fillStyle = selected ? 'rgba(255, 196, 66, 0.22)' : 'rgba(10, 14, 18, 0.55)';
    ctx.fillRect(W / 2 - 330, y - 24, 660, 44);
    ctx.strokeStyle = 'rgba(255, 196, 66, 0.4)';
    ctx.strokeRect(W / 2 - 330, y - 24, 660, 44);
    ctx.fillStyle = '#ffe9b0';
    ctx.font = 'bold 21px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${i + 1}. ${m.name}`, W / 2 - 310, y + 7);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#e8eef4';
    ctx.font = '16px "Courier New", monospace';
    ctx.fillText(m.brief.slice(0, 52), W / 2 + 310, y + 6);
    ctx.textAlign = 'center';
  });
  ctx.fillStyle = '#e8eef4';
  ctx.font = '17px "Courier New", monospace';
  ctx.fillText('FLY: ARROWS pitch & bank · A/D bank · W/S throttle · MOUSE hold to steer', W / 2, 500);
  ctx.fillText('C camera · SPACE drop parcel · G gear · P pause · R restart · N sound', W / 2, 528);
  ctx.fillStyle = 'rgba(232, 238, 244, 0.75)';
  ctx.font = '15px "Courier New", monospace';
  ctx.fillText('Land gently on the strips. Mind the fuel. The mountains do not forgive.', W / 2, 570);
  ctx.restore();
}

function drawOverlay(title, lines, hint) {
  ctx.save();
  ctx.fillStyle = 'rgba(8, 12, 16, 0.5)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffe9b0';
  ctx.font = 'bold 52px Georgia, serif';
  ctx.fillText(title, W / 2, H * 0.38);
  ctx.fillStyle = '#e8eef4';
  ctx.font = '21px "Courier New", monospace';
  lines.forEach((line, i) => ctx.fillText(line, W / 2, H * 0.38 + 44 + i * 30));
  ctx.fillStyle = 'rgba(232, 238, 244, 0.8)';
  ctx.font = '16px "Courier New", monospace';
  ctx.fillText(hint, W / 2, H * 0.38 + 44 + lines.length * 30 + 26);
  ctx.restore();
}

let last = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const rawDt = last ? (now - last) / 1000 : 0.016;
  last = now;
  const dt = Math.min(rawDt, 0.05);
  game.time += dt;
  game.frameCount++;

  if (game.state === 'title') {
    drawTitleBackground(dt);
    drawTitle();
    input.pressed.clear();
    return;
  }
  if (game.state === 'paused') {
    drawOverlay('PAUSED', ['Press P to keep flying.'], 'P resume · R restart · 1/2/3 change sortie');
    input.pressed.clear();
    return;
  }

  const plane = game.plane;
  // Self-test: advance the scripted steps inside the frame loop.
  if (game.selfTest) {
    const st = game.selfTest;
    st.frame++;
    if (st.frame > SELFTEST_STEPS[st.si].frames) {
      st.si++;
      st.frame = 0;
      if (st.si >= SELFTEST_STEPS.length) {
        finishSelfTest(game);
        game.selfTestAxes = null;
        game.selfTest = null;
      } else {
        game.selfTestAxes = SELFTEST_STEPS[st.si].axes;
      }
    }
  }
  // Controls: scripted axes in self-test, shot autopilot in shot mode.
  let axes;
  if (game.selfTestAxes) {
    axes = game.selfTestAxes;
  } else if (game.shotMode) {
    axes = game.shotAxes;
  } else {
    axes = controlAxes(input, canvas);
  }

  if (game.state === 'flying') {
    const events = stepPlane(plane, axes, dt);
    stepParcels(game.mission, dt);
    const outs = stepMission(game.mission, plane, dt, events);
    for (const o of outs) {
      showBanner(o.banner, o.color, 2.4);
      if (o.banner.includes('RING')) audio.chime();
      if (o.banner === 'CRASHED') audio.crash();
      if (o.banner.includes('LANDED')) audio.thud();
    }
    game.mission.elapsed = game.time - game.mission.startTime;
    game.score = game.mission.score;
    if (plane.crashed && game.state === 'flying') {
      game.state = 'crashed';
      game.shake = 0;
    }
    if (game.mission.done && !game.completeAt) {
      game.completeAt = game.time + 1.6;
    }
    audio.update(plane.throttle, plane.speed, true);
  }

  // Camera.
  if (game.camMode === 'chase') {
    const place = chasePlacement(plane, dt, game.chaseSmooth);
    cam.x = place.x; cam.y = place.y; cam.z = place.z;
    cam.yaw = place.yaw; cam.pitch = place.pitch; cam.roll = place.roll;
  } else {
    const place = cockpitPlacement(plane);
    cam.x = place.x; cam.y = place.y; cam.z = place.z;
    cam.yaw = place.yaw; cam.pitch = place.pitch; cam.roll = place.roll;
  }
  // Overspeed shake.
  if (plane.speed > 104) {
    game.shake = 2.5;
  } else if (game.shake > 0) {
    game.shake = Math.max(0, game.shake - dt * 6);
  }
  const shakeX = game.shake ? (Math.random() - 0.5) * game.shake : 0;
  const shakeY = game.shake ? (Math.random() - 0.5) * game.shake : 0;
  updateBasis(cam);

  ctx.save();
  ctx.translate(shakeX, shakeY);
  drawSky(ctx, W, H, cam, game.time);
  drawClouds(ctx, cam, clouds, game.time, (c, x, y, z) => project(c, x, y, z));
  drawTerrain(ctx, cam, SUN_DIR);
  drawRiver(ctx, cam);
  drawAirstrips(ctx, cam);
  drawDropZones(ctx, cam, game.mission.dropped);
  drawProps(ctx, cam);
  drawRings(ctx, cam, game.mission.passedRings, game.mission.nextRing, game.time);
  drawParcels();
  if (game.camMode === 'chase') {
    drawPlane(ctx, cam, plane, game.time);
  }
  ctx.restore();

  const groundBelow = heightAt(plane.x, plane.z);
  const obj = objectiveDirection();
  const hudState = {
    plane,
    groundBelow,
    score: game.score,
    missionLine: missionLine(game.mission),
    objectiveDir: obj ? obj.dir : null,
    objectiveLabel: obj ? obj.label : '',
    banner: game.banner,
    bannerColor: game.bannerColor,
    bannerUntil: game.bannerUntil,
    time: game.time,
  };
  if (game.camMode === 'cockpit') {
    drawCockpitPanel(ctx, W, H, hudState);
  }
  drawHUD(ctx, W, H, hudState);

  if (game.state === 'crashed') {
    drawOverlay('CRASHED', [`Score ${game.score} · ${MISSIONS[game.missionIndex].name}`], 'R fly again · 1/2/3 change sortie');
  } else if (game.completeAt && game.time >= game.completeAt) {
    const mins = Math.floor(game.mission.elapsed / 60);
    const secs = Math.floor(game.mission.elapsed % 60);
    drawOverlay('SORTIE COMPLETE', [
      `${MISSIONS[game.missionIndex].name} — Score ${game.score}`,
      `Time ${mins}:${String(secs).padStart(2, '0')} · Fuel left ${Math.round(plane.fuel)}%`,
    ], 'R fly again · 1/2/3 change sortie');
  }
  input.pressed.clear();
}

// Boot.
if (shot) {
  startShotMode(shot);
} else {
  startMission(0);
  game.state = 'title'; // show the title over a live world until the player picks
  game.selectedMission = 0;
}
if (selfTest) {
  game.state = 'flying';
  startSelfTest(game);
}
requestAnimationFrame(frame);
