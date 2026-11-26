// Screenshot scenes and the self-test hook. The ?shot= presets only set
// the starting position, camera and mission of a normal run — the frame
// is still rendered by the game's own code. ?selftest=1 flies scripted
// inputs for a few seconds and reports the result into the document so
// an automated check can read it.

import { MISSIONS } from './missions.js';
import { heightAt, RINGS, AIRSTRIPS, valleyCentre, valleyHeading } from './terrain.js';

export const SHOTS = {
  // Chase view: banking gently toward the first rings, runway behind.
  cover: { mission: 0, cam: 'chase', x: valleyCentre(-4960), z: -4960, yaw: valleyHeading(-4960), speed: 52, roll: 0.35, pitch: 0.02, throttle: 0.7 },
  // Cockpit view: instruments lit, the first ring framed in the windscreen.
  cockpit: { mission: 0, cam: 'cockpit', x: -728, z: -4880, yaw: valleyHeading(-4880), speed: 48, roll: 0, pitch: 0.03, throttle: 0.62, dy: -27 },
  // Low over the river with a drop zone ahead.
  river: { mission: 1, cam: 'chase', x: valleyCentre(-3400), z: -3400, yaw: valleyHeading(-3400), speed: 42, roll: -0.2, pitch: -0.02, throttle: 0.5 },
  // Final approach to Alder Field, gear down, low and slow.
  landing: { mission: 2, cam: 'chase', x: -40, z: -4800, yaw: 0.06, speed: 32, roll: 0, pitch: -0.06, throttle: 0.34 },
};

export function shotPreset(name) {
  const shot = SHOTS[name];
  if (!shot) return null;
  const ground = heightAt(shot.x, shot.z);
  const mission = MISSIONS[shot.mission];
  return {
    mission: shot.mission,
    cam: shot.cam,
    start: {
      x: shot.x,
      y: ground + 78 + (shot.dy || 0),
      z: shot.z,
      yaw: shot.yaw,
      speed: shot.speed,
    },
    roll: shot.roll,
    pitch: shot.pitch,
    throttle: shot.throttle,
    brief: mission.brief,
  };
}

// Scripted self-test: throttle up, roll, pitch, then report. The main loop
// advances it frame by frame (see main.js); when the steps finish it writes
// SELFTEST JSON into document.title and a #selftest node.
export const SELFTEST_STEPS = [
  { frames: 120, axes: { pitch: 0, roll: 0, throttleDelta: 1, brake: false } },
  { frames: 90, axes: { pitch: 0.4, roll: 0.5, throttleDelta: 0, brake: false } },
  { frames: 90, axes: { pitch: -0.3, roll: -0.5, throttleDelta: 0, brake: false } },
  { frames: 60, axes: { pitch: 0, roll: 0, throttleDelta: -1, brake: false } },
];

export function startSelfTest(game) {
  game.selfTest = {
    si: 0,
    frame: 0,
    startX: game.plane.x,
    startY: game.plane.y,
    startZ: game.plane.z,
  };
  game.selfTestAxes = SELFTEST_STEPS[0].axes;
}

export function finishSelfTest(game) {
  const st = game.selfTest;
  const result = {
    ok: true,
    moved: Math.round(Math.hypot(game.plane.x - st.startX, game.plane.z - st.startZ) * 10) / 10,
    altChange: Math.round((game.plane.y - st.startY) * 10) / 10,
    speed: Math.round(game.plane.speed * 10) / 10,
    throttle: Math.round(game.plane.throttle * 100) / 100,
    crashed: game.plane.crashed,
    frames: game.frameCount,
  };
  document.title = 'SELFTEST ' + JSON.stringify(result);
  const node = document.createElement('div');
  node.id = 'selftest';
  node.textContent = JSON.stringify(result);
  document.body.appendChild(node);
  console.log('SELFTEST ' + JSON.stringify(result));
}
