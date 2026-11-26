// Keyboard + mouse input. Arrows/WASD fly the plane, the mouse can steer
// too, and the UI keys handle camera, pause, restart and missions.

export function makeInput() {
  const input = {
    keys: new Set(),
    mouseX: 0.5, // 0..1 across the canvas
    mouseY: 0.5,
    mouseActive: false,
    mouseDown: false,
    pressed: new Set(), // edge-triggered, consumed by the game loop
    onKey: null, // game callback for UI keys
  };

  window.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      e.preventDefault();
    }
    if (!e.repeat) {
      input.pressed.add(e.code);
      if (input.onKey) input.onKey(e.code);
    }
    input.keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => {
    input.keys.delete(e.code);
  });
  window.addEventListener('blur', () => {
    input.keys.clear();
    input.mouseActive = false;
  });

  return input;
}

// Continuous control axes from the current input state.
// pitch: -1 (nose down) .. +1 (nose up); roll: -1 (left) .. +1 (right).
export function controlAxes(input, canvas) {
  let pitch = 0;
  let roll = 0;
  if (input.keys.has('ArrowDown')) pitch -= 1;
  if (input.keys.has('ArrowUp')) pitch += 1;
  if (input.keys.has('ArrowLeft') || input.keys.has('KeyA')) roll -= 1;
  if (input.keys.has('ArrowRight') || input.keys.has('KeyD')) roll += 1;
  // Mouse steering: holding the mouse button steers toward the cursor.
  if (input.mouseDown && input.mouseActive) {
    const mx = (input.mouseX - 0.5) * 2;
    const my = (input.mouseY - 0.5) * 2;
    roll += Math.max(-1, Math.min(1, mx * 1.4));
    pitch += Math.max(-1, Math.min(1, -my * 1.2));
  }
  let throttleDelta = 0;
  if (input.keys.has('KeyW')) throttleDelta += 1;
  if (input.keys.has('KeyS')) throttleDelta -= 1;
  const brake = input.keys.has('KeyB') || input.keys.has('ShiftLeft');
  return {
    pitch: Math.max(-1, Math.min(1, pitch)),
    roll: Math.max(-1, Math.min(1, roll)),
    throttleDelta,
    brake,
  };
}

export function attachMouse(input, canvas) {
  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    input.mouseX = (e.clientX - r.left) / r.width;
    input.mouseY = (e.clientY - r.top) / r.height;
    input.mouseActive = true;
  });
  canvas.addEventListener('mousedown', (e) => {
    input.mouseDown = true;
    input.mouseActive = true;
    const r = canvas.getBoundingClientRect();
    input.mouseX = (e.clientX - r.left) / r.width;
    input.mouseY = (e.clientY - r.top) / r.height;
  });
  window.addEventListener('mouseup', () => {
    input.mouseDown = false;
  });
}
