// audio.js — every sound is synthesized in Web Audio. No files. Plus a speech-synth announcer.
(function (global) {
  class SFX {
    constructor() { this.ctx = null; this.muted = false; this.voice = true; this.master = null; this._noise = null; this.volume = 0.8; }

    init() {
      if (this.ctx) { if (this.ctx.state !== 'running') this.ctx.resume(); return; }
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -12; comp.ratio.value = 6;
      this.master.connect(comp); comp.connect(this.ctx.destination);
      this._makeNoise();
      this._ambience();
    }
    setMuted(m) { this.muted = m; if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.02); if (m && global.speechSynthesis) speechSynthesis.cancel(); }
    setVolume(v) { this.volume = Math.max(0, Math.min(1, v)) * 0.8; if (this.master && !this.muted) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02); }

    _makeNoise() {
      const len = this.ctx.sampleRate * 2;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this._noise = buf;
    }
    _noiseSrc() { const s = this.ctx.createBufferSource(); s.buffer = this._noise; s.loop = true; return s; }
    _env(gain, t0, a, peak, d, sustain, r, end) {
      const g = gain.gain;
      g.cancelScheduledValues(t0); g.setValueAtTime(0.0001, t0);
      g.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + a);
      if (d) g.exponentialRampToValueAtTime(Math.max(sustain || peak * 0.5, 0.0002), t0 + a + d);
      g.exponentialRampToValueAtTime(0.0001, end);
    }
    _osc(type, f0, t0, opts) {
      const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t0);
      if (opts && opts.to) o.frequency.exponentialRampToValueAtTime(Math.max(opts.to, 1), t0 + opts.dur);
      return o;
    }
    _dist(k) {
      const ws = this.ctx.createWaveShaper(); const n = 256, c = new Float32Array(n);
      for (let i = 0; i < n; i++) { const x = i * 2 / n - 1; c[i] = (Math.PI + k) * x / (Math.PI + k * Math.abs(x)); }
      ws.curve = c; return ws;
    }

    _ambience() {
      // low murmuring crowd: filtered noise with slow LFO
      const src = this._noiseSrc();
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380; lp.Q.value = 0.7;
      const g = this.ctx.createGain(); g.gain.value = 0.045;
      const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.23;
      const lg = this.ctx.createGain(); lg.gain.value = 0.02;
      lfo.connect(lg); lg.connect(g.gain);
      src.connect(lp); lp.connect(g); g.connect(this.master);
      src.start(); lfo.start();
      this.crowdGain = g;
    }
    crowdSwell(amt, ms) {
      if (!this.crowdGain) return;
      const t = this.ctx.currentTime;
      this.crowdGain.gain.cancelScheduledValues(t);
      this.crowdGain.gain.setTargetAtTime(0.045 + amt, t, 0.05);
      this.crowdGain.gain.setTargetAtTime(0.045, t + ms / 1000, 0.4);
    }

    play(name, data) {
      if (!this.ctx || this.muted) return;
      const t = this.ctx.currentTime;
      const fn = this['s_' + name];
      if (fn) fn.call(this, t, data || {});
    }

    say(text, opts) {
      if (!this.voice || this.muted || !global.speechSynthesis) return;
      try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.rate = (opts && opts.rate) || 1.1; u.pitch = (opts && opts.pitch) || 1; u.volume = 1;
        speechSynthesis.speak(u);
      } catch (e) { /* no voice, fine */ }
    }

    // ---------- individual sounds ----------
    s_whoosh(t) {
      const s = this._noiseSrc();
      const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
      bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(3200, t + 0.12); bp.frequency.exponentialRampToValueAtTime(600, t + 0.22);
      const g = this.ctx.createGain(); this._env(g, t, 0.03, 0.5, 0.06, 0.25, 0, t + 0.24);
      s.connect(bp); bp.connect(g); g.connect(this.master); s.start(t); s.stop(t + 0.3);
    }
    s_hit(t) {
      const o = this._osc('sine', 170, t, { to: 38, dur: 0.14 });
      const g = this.ctx.createGain(); this._env(g, t, 0.005, 1.0, 0.05, 0.4, 0, t + 0.2);
      const d = this._dist(30);
      o.connect(d); d.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.22);
      const n = this._noiseSrc(); const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(1800, t); lp.frequency.exponentialRampToValueAtTime(200, t + 0.1);
      const ng = this.ctx.createGain(); this._env(ng, t, 0.003, 0.7, 0.03, 0.2, 0, t + 0.12);
      n.connect(lp); lp.connect(ng); ng.connect(this.master); n.start(t); n.stop(t + 0.15);
    }
    s_crit(t) {
      this.s_hit(t);
      const o = this._osc('square', 220, t, { to: 880, dur: 0.08 });
      const g = this.ctx.createGain(); this._env(g, t, 0.005, 0.25, 0.04, 0.1, 0, t + 0.16);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.18);
      this.crowdSwell(0.12, 500);
    }
    s_guard(t) {
      const o = this._osc('triangle', 120, t, { to: 60, dur: 0.1 });
      const g = this.ctx.createGain(); this._env(g, t, 0.005, 0.5, 0.03, 0.2, 0, t + 0.12);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.14);
    }
    s_block(t) {
      const o = this._osc('triangle', 640, t, { to: 420, dur: 0.06 });
      const g = this.ctx.createGain(); this._env(g, t, 0.003, 0.5, 0.02, 0.15, 0, t + 0.1);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.12);
      const n = this._noiseSrc(); const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
      const ng = this.ctx.createGain(); this._env(ng, t, 0.002, 0.35, 0.02, 0.1, 0, t + 0.08);
      n.connect(hp); hp.connect(ng); ng.connect(this.master); n.start(t); n.stop(t + 0.1);
    }
    s_windup(t, d) {
      const dur = Math.min(1.2, ((d && d.dur) || 700) / 1000);
      const o = this._osc('sawtooth', 70, t, { to: 260, dur });
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(200, t); lp.frequency.exponentialRampToValueAtTime(1800, t + dur);
      const g = this.ctx.createGain(); this._env(g, t, dur * 0.8, 0.22, 0, 0, 0, t + dur + 0.02);
      o.connect(lp); lp.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
    }
    s_dodge(t) {
      // whoosh + rising "shing" arpeggio
      this.s_whoosh(t);
      const notes = [880, 1174, 1568, 2093];
      notes.forEach((f, i) => {
        const o = this._osc('triangle', f, t + i * 0.045);
        const g = this.ctx.createGain(); this._env(g, t + i * 0.045, 0.005, 0.28, 0.05, 0.12, 0, t + i * 0.045 + 0.26);
        o.connect(g); g.connect(this.master); o.start(t + i * 0.045); o.stop(t + i * 0.045 + 0.3);
      });
      const sh = this._noiseSrc(); const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 8; bp.frequency.setValueAtTime(4000, t); bp.frequency.exponentialRampToValueAtTime(9000, t + 0.3);
      const sg = this.ctx.createGain(); this._env(sg, t, 0.05, 0.18, 0.1, 0.08, 0, t + 0.4);
      sh.connect(bp); bp.connect(sg); sg.connect(this.master); sh.start(t); sh.stop(t + 0.45);
      this.crowdSwell(0.08, 400);
      this.say('Dodge!', { pitch: 1.5, rate: 1.4 });
    }
    s_nodoge(t) {
      // the sad "noooo": two detuned saws through a formant sweep + a wobbly descent
      const ws = ['sawtooth', 'sawtooth'].map((type, i) => this._osc(type, 330 * (i ? 1.008 : 1), t, { to: 110, dur: 0.55 }));
      const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3; f.frequency.setValueAtTime(520, t); f.frequency.exponentialRampToValueAtTime(260, t + 0.55);
      const vib = this._osc('sine', 6.5, t); const vg = this.ctx.createGain(); vg.gain.value = 9; vib.connect(vg); ws.forEach(o => vg.connect(o.frequency)); vib.start(t); vib.stop(t + 0.7);
      const g = this.ctx.createGain(); this._env(g, t, 0.02, 0.45, 0.1, 0.35, 0, t + 0.62);
      ws.forEach(o => { o.connect(f); o.start(t); o.stop(t + 0.65); });
      f.connect(g); g.connect(this.master);
      this.s_hit(t);
      this.crowdSwell(-0.02, 600);
      this.say('No dodge!', { pitch: 0.4, rate: 0.95 });
    }
    s_counter(t) {
      [523, 659, 784].forEach((f, i) => {
        const o = this._osc('square', f, t + i * 0.05); const g = this.ctx.createGain(); this._env(g, t + i * 0.05, 0.005, 0.2, 0.03, 0.1, 0, t + i * 0.05 + 0.18);
        o.connect(g); g.connect(this.master); o.start(t + i * 0.05); o.stop(t + i * 0.05 + 0.2);
      });
      this.s_hit(t + 0.05);
      this.say('Counter!', { pitch: 1.3, rate: 1.3 });
    }
    s_bell(t) {
      for (let k = 0; k < 3; k++) {
        const t0 = t + k * 0.45;
        [1180, 1770, 2360].forEach((f, i) => {
          const o = this._osc('sine', f, t0); const g = this.ctx.createGain(); this._env(g, t0, 0.003, 0.35 / (i + 1), 0.1, 0.12 / (i + 1), 0, t0 + 0.9);
          o.connect(g); g.connect(this.master); o.start(t0); o.stop(t0 + 1);
        });
      }
      this.crowdSwell(0.1, 1500);
    }
    s_super(t) {
      const chord = [130.8, 164.8, 196, 261.6, 329.6, 392];
      chord.forEach((f, i) => {
        const o = this._osc('sawtooth', f * 0.5, t, { to: f, dur: 0.25 });
        const g = this.ctx.createGain(); this._env(g, t, 0.05, 0.18, 0.3, 0.12, 0, t + 1.4);
        o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 1.5);
      });
      const n = this._noiseSrc(); const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2; bp.frequency.setValueAtTime(200, t); bp.frequency.exponentialRampToValueAtTime(8000, t + 0.6);
      const ng = this.ctx.createGain(); this._env(ng, t, 0.3, 0.5, 0.2, 0.2, 0, t + 0.9);
      n.connect(bp); bp.connect(ng); ng.connect(this.master); n.start(t); n.stop(t + 1);
      this.s_hit(t + 0.35); this.s_hit(t + 0.5);
      this.crowdSwell(0.2, 1200);
      this.say('Haymaker!', { pitch: 0.7, rate: 0.9 });
    }
    s_ko(t) {
      const o = this._osc('sine', 120, t, { to: 25, dur: 0.9 });
      const g = this.ctx.createGain(); this._env(g, t, 0.01, 1.0, 0.3, 0.5, 0, t + 1.3);
      const d = this._dist(50); o.connect(d); d.connect(g); g.connect(this.master); o.start(t); o.stop(t + 1.4);
      this.s_hit(t); this.s_hit(t + 0.25);
      this.crowdSwell(0.3, 3000);
      setTimeout(() => this.say('K O!', { pitch: 0.6, rate: 0.8 }), 350);
    }
  }
  global.SFX = SFX;
})(typeof window !== 'undefined' ? window : globalThis);
