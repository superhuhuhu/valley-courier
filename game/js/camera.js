// Camera math: a pinhole camera with yaw/pitch/roll, plus the chase and
// cockpit camera placements. All world-to-screen projection goes through
// here so the terrain, the aircraft, the rings and the props agree.

export function makeCamera() {
  return {
    x: 0, y: 0, z: 0,
    yaw: 0, pitch: 0, roll: 0,
    focal: 620, // pixels at 1280x720; scaled by canvas height
    cx: 640, cy: 360,
    right: [1, 0, 0], up: [0, 1, 0], fwd: [0, 0, 1],
  };
}

// Rebuild the camera basis vectors from yaw/pitch/roll (radians).
// Forward is (sin yaw * cos pitch, sin pitch, cos yaw * cos pitch).
export function updateBasis(cam) {
  const cy = Math.cos(cam.yaw);
  const sy = Math.sin(cam.yaw);
  const cp = Math.cos(cam.pitch);
  const sp = Math.sin(cam.pitch);
  const fwd = [sy * cp, sp, cy * cp];
  const right0 = [cy, 0, -sy];
  // up = fwd x right (right-handed: right, up, forward).
  const up0 = [
    fwd[1] * right0[2] - fwd[2] * right0[1],
    fwd[2] * right0[0] - fwd[0] * right0[2],
    fwd[0] * right0[1] - fwd[1] * right0[0],
  ];
  // Apply roll around the forward axis.
  const cr = Math.cos(cam.roll);
  const sr = Math.sin(cam.roll);
  cam.right = [
    right0[0] * cr + up0[0] * sr,
    right0[1] * cr + up0[1] * sr,
    right0[2] * cr + up0[2] * sr,
  ];
  cam.up = [
    up0[0] * cr - right0[0] * sr,
    up0[1] * cr - right0[1] * sr,
    up0[2] * cr - right0[2] * sr,
  ];
  cam.fwd = fwd;
}

// Project a world point. Returns null when behind the near plane.
// Screen y grows downward; world y grows upward.
export function project(cam, x, y, z) {
  const dx = x - cam.x;
  const dy = y - cam.y;
  const dz = z - cam.z;
  const cx = dx * cam.right[0] + dy * cam.right[1] + dz * cam.right[2];
  const cy = dx * cam.up[0] + dy * cam.up[1] + dz * cam.up[2];
  const cz = dx * cam.fwd[0] + dy * cam.fwd[1] + dz * cam.fwd[2];
  if (cz < 1.5) return null;
  const s = cam.focal / cz;
  return { x: cam.cx + cx * s, y: cam.cy - cy * s, d: cz, s };
}

// Chase camera: sit behind and above the aircraft, looking ahead of it.
// Returns the smoothed camera position; the caller lerps toward it.
export function chasePlacement(plane, dt, smooth) {
  const back = 17.5;
  const up = 5.0;
  const f = plane.forward;
  const tx = plane.x - f[0] * back;
  const ty = plane.y - f[1] * back + up;
  const tz = plane.z - f[2] * back;
  smooth.x += (tx - smooth.x) * Math.min(1, dt * 7);
  smooth.y += (ty - smooth.y) * Math.min(1, dt * 7);
  smooth.z += (tz - smooth.z) * Math.min(1, dt * 7);
  const lookX = plane.x + f[0] * 26;
  const lookY = plane.y + f[1] * 26 + 1.2;
  const lookZ = plane.z + f[2] * 26;
  const dx = lookX - smooth.x;
  const dy = lookY - smooth.y;
  const dz = lookZ - smooth.z;
  const yaw = Math.atan2(dx, dz);
  const pitch = Math.atan2(dy, Math.hypot(dx, dz));
  return { x: smooth.x, y: smooth.y, z: smooth.z, yaw, pitch, roll: plane.roll * 0.35 };
}

// Cockpit camera: at the pilot's head, looking along the nose.
export function cockpitPlacement(plane) {
  const f = plane.forward;
  const r = plane.right;
  return {
    x: plane.x + f[0] * 1.1 + r[0] * 0 + 0.35 * plane.up[0],
    y: plane.y + f[1] * 1.1 + 1.15,
    z: plane.z + f[2] * 1.1,
    yaw: plane.yaw,
    pitch: plane.pitch,
    roll: plane.roll,
  };
}
