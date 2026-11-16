// Música de fondo generada con Web Audio: sin archivos ni derechos de autor. Suave y repetitiva a propósito.
// Modos: 'menu' (volumen normal), 'play' (muy baja, solo en juegos sin estímulo sonoro ni medición de atención
// sostenida) y 'silent'. El navegador solo permite sonar tras un toque; se desbloquea con el primer gesto.
export type MusicMode = 'menu' | 'play' | 'silent';
const KEY = 'kudlab-play-music';
const LEVEL: Record<MusicMode, number> = { menu: 0.16, play: 0.06, silent: 0 };
// I–vi–IV–V en Do mayor; arpegio pentatónico.
const CHORDS = [[48, 55, 64], [45, 52, 60], [41, 48, 57], [43, 50, 59]];
const MELODY = [[72, 76, 79, 76, 74, 72, 74, 76], [69, 72, 76, 72, 71, 69, 67, 69], [65, 69, 72, 74, 72, 69, 67, 65], [67, 71, 74, 72, 71, 67, 69, 71]];
const hz = (n: number) => 440 * 2 ** ((n - 69) / 12);

export class Music {
  private ctx?: AudioContext;
  private master?: GainNode;
  private filter?: BiquadFilterNode;
  private timer?: ReturnType<typeof setInterval>;
  private step = 0;
  private nextAt = 0;
  private mode: MusicMode = 'menu';
  enabled: boolean;
  private listeners = new Set<() => void>();
  constructor() {
    let saved: string | null = null;
    try { saved = localStorage.getItem(KEY); } catch { /* sin almacenamiento: queda encendida */ }
    this.enabled = saved !== 'off';
    const unlock = () => { this.ensure(); if (this.ctx?.state === 'running') { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); } };
    window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock);
    document.addEventListener('visibilitychange', () => this.apply());
  }
  onChange(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  toggle(): void {
    this.enabled = !this.enabled;
    try { localStorage.setItem(KEY, this.enabled ? 'on' : 'off'); } catch { /* preferencia por sesión */ }
    this.ensure(); this.apply(); this.listeners.forEach(l => l());
  }
  setMode(mode: MusicMode): void { if (mode !== this.mode) { this.mode = mode; this.apply(); } }
  private ensure(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try { this.ctx = new Ctor(); } catch { return; }
      this.master = this.ctx.createGain(); this.master.gain.value = 0;
      this.filter = this.ctx.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 2400;
      this.filter.connect(this.master); this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().then(() => this.apply()).catch(() => undefined);
    this.apply();
  }
  private apply(): void {
    if (!this.ctx || !this.master) return;
    const level = this.enabled && !document.hidden ? LEVEL[this.mode] : 0, now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(level, now, level ? 0.8 : 0.25);
    if (level && !this.timer && this.ctx.state === 'running') { this.nextAt = now + 0.1; this.timer = setInterval(() => this.schedule(), 120); }
    if (!level && this.timer) { const t = this.timer; setTimeout(() => { if (this.timer === t && !(this.enabled && !document.hidden && LEVEL[this.mode])) { clearInterval(t); this.timer = undefined; } }, 1500); }
  }
  // Programa notas con 0,4 s de anticipación: corcheas a 84 ppm, un acorde por compás.
  private schedule(): void {
    const ctx = this.ctx!, beat = 60 / 84 / 2;
    while (this.nextAt < ctx.currentTime + 0.4) {
      const bar = Math.floor(this.step / 8) % 4, pos = this.step % 8;
      if (pos === 0) { for (const n of CHORDS[bar]!) this.pad(hz(n), this.nextAt, beat * 8); this.bass(hz(CHORDS[bar]![0]! - 12), this.nextAt, beat * 4); }
      if (pos === 4) this.bass(hz(CHORDS[bar]![0]! - 12 + 7), this.nextAt, beat * 4);
      if (Math.floor(this.step / 32) % 2 === 1 || pos % 2 === 0) this.bell(hz(MELODY[bar]![pos]!), this.nextAt, beat * 1.8);
      this.step++; this.nextAt += beat;
    }
  }
  private voice(type: OscillatorType, f: number, at: number, length: number, peak: number, attack: number) {
    const ctx = this.ctx!, osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = type; osc.frequency.value = f;
    gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(peak, at + attack); gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(gain); gain.connect(this.filter!); osc.start(at); osc.stop(at + length + 0.05);
  }
  private pad(f: number, at: number, length: number) { this.voice('triangle', f, at, length, 0.09, 0.9); }
  private bass(f: number, at: number, length: number) { this.voice('sine', f, at, length * 0.9, 0.22, 0.03); }
  private bell(f: number, at: number, length: number) { this.voice('sine', f, at, length, 0.12, 0.01); this.voice('sine', f * 2, at, length * 0.5, 0.025, 0.01); }
}
// Juegos en los que se permite música suave mientras se juega (decisión del equipo, 15-11-2026).
export const MUSIC_WHILE_PLAYING = new Set(['TG-02', 'TG-03']);
