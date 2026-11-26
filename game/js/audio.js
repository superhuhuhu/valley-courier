// Procedural sound: no audio files, everything is synthesised with the
// Web Audio API — engine drone, wind, chimes, thuds and the crash burst.

export function makeAudio() {
  const audio = {
    ctx: null,
    master: null,
    engineOsc: null,
    engineGain: null,
    windGain: null,
    windSrc: null,
    muted: false,
    started: false,
  };

  function ensure() {
    if (audio.started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    audio.ctx = ctx;
    audio.master = ctx.createGain();
    audio.master.gain.value = 0.5;
    audio.master.connect(ctx.destination);

    // Engine: a detuned sawtooth pair through a lowpass.
    audio.engineOsc = ctx.createOscillator();
    audio.engineOsc.type = 'sawtooth';
    audio.engineOsc.frequency.value = 70;
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.value = 35;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    audio.engineGain = ctx.createGain();
    audio.engineGain.gain.value = 0.0;
    audio.engineOsc.connect(lp);
    osc2.connect(lp);
    lp.connect(audio.engineGain);
    audio.engineGain.connect(audio.master);
    audio.engineOsc.start();
    osc2.start();
    audio._osc2 = osc2;

    // Wind: looped noise through a bandpass, gain follows airspeed.
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    audio.windSrc = ctx.createBufferSource();
    audio.windSrc.buffer = buf;
    audio.windSrc.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700;
    bp.Q.value = 0.6;
    audio.windGain = ctx.createGain();
    audio.windGain.gain.value = 0.0;
    audio.windSrc.connect(bp);
    bp.connect(audio.windGain);
    audio.windGain.connect(audio.master);
    audio.windSrc.start();

    audio.started = true;
  }

  audio.unlock = function () {
    ensure();
    if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume();
  };

  audio.update = function (throttle, speed, flying) {
    if (!audio.started) return;
    const t = audio.ctx.currentTime;
    const target = audio.muted || !flying ? 0 : 0.05 + throttle * 0.11;
    audio.engineGain.gain.setTargetAtTime(target, t, 0.15);
    audio.engineOsc.frequency.setTargetAtTime(52 + throttle * 78, t, 0.2);
    audio._osc2.frequency.setTargetAtTime(26 + throttle * 39, t, 0.2);
    const wind = audio.muted || !flying ? 0 : Math.max(0, (speed - 20) / 90) * 0.16;
    audio.windGain.gain.setTargetAtTime(wind, t, 0.3);
  };

  function blip(freq, dur, type, vol, slideTo) {
    if (!audio.started || audio.muted) return;
    const ctx = audio.ctx;
    const osc = ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol || 0.2, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.connect(g);
    g.connect(audio.master);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  }

  audio.chime = function () {
    blip(880, 0.35, 'sine', 0.22);
    setTimeout(() => blip(1320, 0.4, 'sine', 0.18), 70);
  };

  audio.thud = function () {
    blip(90, 0.25, 'sine', 0.4, 45);
  };

  audio.crash = function () {
    if (!audio.started || audio.muted) return;
    const ctx = audio.ctx;
    const len = ctx.sampleRate * 0.5;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = 0.5;
    src.connect(g);
    g.connect(audio.master);
    src.start();
  };

  audio.toggleMute = function () {
    audio.muted = !audio.muted;
    return audio.muted;
  };

  return audio;
}
