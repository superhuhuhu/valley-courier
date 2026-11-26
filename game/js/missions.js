// Missions: three sorties with different goals, scored in the open.
// Ring Run threads the valley hoops; Parcel Drop scores accuracy from
// the air; Landing Tour touches down on all three airstrips in order.

import { RINGS, DROP_ZONES, AIRSTRIPS, heightAt, valleyCentre, valleyHeading } from './terrain.js';
import { clamp } from './noise.js';

export const MISSIONS = [
  {
    id: 'rings',
    name: 'RING RUN',
    brief: 'Thread all 12 rings down the valley. Smooth throttle, gentle banks.',
    start: { x: valleyCentre(-4900), z: -4900, yaw: valleyHeading(-4900), speed: 48 },
  },
  {
    id: 'parcels',
    name: 'PARCEL DROP',
    brief: 'Drop a parcel (SPACE) inside each painted circle. Slow down first.',
    start: { x: valleyCentre(-3300), z: -3300, yaw: valleyHeading(-3300), speed: 44 },
  },
  {
    id: 'landings',
    name: 'LANDING TOUR',
    brief: 'Land on all three strips in order: Alder, Miller, North Tarn.',
    start: { x: valleyCentre(-4900), z: -4900, yaw: valleyHeading(-4900), speed: 48 },
  },
];

export function makeMissionState(missionId) {
  return {
    id: missionId,
    passedRings: new Set(),
    nextRing: 0,
    dropped: [false, false, false],
    parcels: [], // falling parcels {x,y,z,vy}
    landedPads: new Set(),
    nextPad: 0,
    done: false,
    score: 0,
    startTime: 0,
    elapsed: 0,
    message: '',
  };
}

function ringCenter(ring) {
  return { x: ring.x, y: ring.y, z: ring.z };
}

// Called every frame with the live plane; returns banner events.
export function stepMission(ms, plane, dt, events) {
  const out = [];
  if (ms.id === 'rings') {
    const ring = RINGS[ms.nextRing];
    if (ring) {
      const dx = plane.x - ring.x;
      const dy = plane.y - ring.y;
      const dz = plane.z - ring.z;
      const dist = Math.hypot(dx, dy, dz);
      // Passing through the hoop plane within its radius counts.
      const prev = ms._prevDist ?? Infinity;
      if (dist < ring.radius + 3 && prev >= dist && Math.abs(dz) < 26) {
        ms.passedRings.add(ring.index);
        ms.nextRing++;
        ms.score += 100;
        out.push({ banner: `RING ${ring.index + 1}/12  +100`, color: '#7de38b' });
        if (ms.nextRing >= RINGS.length) {
          ms.done = true;
          out.push({ banner: 'COURSE COMPLETE!', color: '#ffc442' });
        }
      }
      ms._prevDist = dist;
    }
  } else if (ms.id === 'parcels') {
    for (const parcel of ms.parcels) {
      parcel.vy -= 9.8 * dt;
      parcel.y += parcel.vy * dt;
      const ground = heightAt(parcel.x, parcel.z);
      if (parcel.y <= ground) {
        parcel.landed = true;
        for (let i = 0; i < DROP_ZONES.length; i++) {
          if (ms.dropped[i]) continue;
          const dz = DROP_ZONES[i];
          const d = Math.hypot(parcel.x - dz.x, parcel.z - dz.z);
          if (d <= dz.radius) {
            ms.dropped[i] = true;
            const pts = Math.round(150 + (1 - d / dz.radius) * 150);
            ms.score += pts;
            out.push({ banner: `${dz.name.toUpperCase()}  +${pts}`, color: '#7de38b' });
          }
        }
        if (!ms.dropped.some((d) => !d)) { /* all delivered */ }
        if (ms.dropped.every(Boolean)) {
          ms.done = true;
          out.push({ banner: 'ALL PARCELS DELIVERED!', color: '#ffc442' });
        }
      }
    }
    ms.parcels = ms.parcels.filter((p) => !p.landed);
  } else if (ms.id === 'landings') {
    const pad = AIRSTRIPS[ms.nextPad];
    if (pad) {
      const dx = plane.x - pad.x;
      const dz = plane.z - pad.z;
      const along = Math.abs(dx * Math.sin(pad.heading) + dz * Math.cos(pad.heading));
      const across = Math.abs(dx * Math.cos(pad.heading) - dz * Math.sin(pad.heading));
      const ground = heightAt(plane.x, plane.z);
      if (plane.grounded && along < pad.length * 0.5 && across < pad.width * 0.5 && plane.speed < 20) {
        ms.landedPads.add(ms.nextPad);
        ms.nextPad++;
        ms.score += 200;
        plane.fuel = 100; // refuel on the apron
        out.push({ banner: `${pad.name.toUpperCase()}  LANDED  +200  REFUELLED`, color: '#7de38b' });
        if (ms.nextPad >= AIRSTRIPS.length) {
          ms.done = true;
          out.push({ banner: 'TOUR COMPLETE!', color: '#ffc442' });
        }
      }
    }
  }
  // Crash / fuel events from the flight model.
  for (const ev of events) {
    if (ev.type === 'crash') out.push({ banner: 'CRASHED', color: '#ff5a4e' });
    if (ev.type === 'fuel-empty') out.push({ banner: 'FUEL EMPTY — GLIDE!', color: '#ff5a4e' });
    if (ev.type === 'stall') out.push({ banner: 'STALL — NOSE DOWN', color: '#ff5a4e' });
  }
  return out;
}

export function missionLine(ms) {
  if (ms.id === 'rings') {
    return ms.done ? 'RING RUN COMPLETE' : `RING RUN — RING ${Math.min(ms.nextRing + 1, 12)}/12`;
  }
  if (ms.id === 'parcels') {
    const n = ms.dropped.filter(Boolean).length;
    return ms.done ? 'ALL PARCELS DELIVERED' : `PARCEL DROP — ${n}/3 DELIVERED · SPACE TO DROP`;
  }
  const names = AIRSTRIPS.map((a) => a.name.toUpperCase());
  return ms.done ? 'LANDING TOUR COMPLETE' : `LANDING TOUR — NEXT: ${names[ms.nextPad]}`;
}

// Objective target in world space, for the HUD arrow.
export function objectiveTarget(ms) {
  if (ms.id === 'rings') {
    const ring = RINGS[ms.nextRing];
    return ring ? ringCenter(ring) : null;
  }
  if (ms.id === 'parcels') {
    for (let i = 0; i < DROP_ZONES.length; i++) {
      if (!ms.dropped[i]) {
        const dz = DROP_ZONES[i];
        return { x: dz.x, y: heightAt(dz.x, dz.z) + 30, z: dz.z };
      }
    }
    return null;
  }
  const pad = AIRSTRIPS[ms.nextPad];
  return pad ? { x: pad.x, y: heightAt(pad.x, pad.z) + 24, z: pad.z } : null;
}

export function dropParcel(ms, plane) {
  if (ms.parcels.length >= 6) return false;
  ms.parcels.push({
    x: plane.x, y: plane.y - 2, z: plane.z,
    vx: plane.forward[0] * plane.speed,
    vy: 0,
    vz: plane.forward[2] * plane.speed,
    landed: false,
  });
  return true;
}

export function stepParcels(ms, dt) {
  for (const p of ms.parcels) {
    p.x += p.vx * dt;
    p.z += p.vz * dt;
  }
}
