// Música de fondo (archivo /musica/fondo.mp3, en bucle) con entrada y salida suaves.
// Modos: 'menu' (volumen normal), 'play' (muy baja, solo en juegos sin estímulo sonoro ni medición de atención
// sostenida) y 'silent'. El navegador solo permite sonar tras un toque; se desbloquea con el primer gesto.
export type MusicMode = 'menu' | 'play' | 'silent';
const KEY = 'kudlab-play-music';
const SOURCE = '/musica/fondo.mp3';
const LEVEL: Record<MusicMode, number> = { menu: 0.35, play: 0.12, silent: 0 };

export class Music {
  private audio?: HTMLAudioElement;
  private fade?: ReturnType<typeof setInterval>;
  private mode: MusicMode = 'menu';
  private unlocked = false;
  enabled: boolean;
  private listeners = new Set<() => void>();
  constructor() {
    let saved: string | null = null;
    try { saved = localStorage.getItem(KEY); } catch { /* sin almacenamiento: queda encendida */ }
    this.enabled = saved !== 'off';
    const unlock = () => { this.unlocked = true; this.apply(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
    window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock);
    document.addEventListener('visibilitychange', () => this.apply());
  }
  onChange(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  toggle(): void {
    this.enabled = !this.enabled; this.unlocked = true;
    try { localStorage.setItem(KEY, this.enabled ? 'on' : 'off'); } catch { /* preferencia por sesión */ }
    this.apply(); this.listeners.forEach(l => l());
  }
  setMode(mode: MusicMode): void { if (mode !== this.mode) { this.mode = mode; this.apply(); } }
  private element(): HTMLAudioElement {
    if (!this.audio) { this.audio = new Audio(SOURCE); this.audio.loop = true; this.audio.preload = 'auto'; this.audio.volume = 0; }
    return this.audio;
  }
  private apply(): void {
    const target = this.enabled && this.unlocked && !document.hidden ? LEVEL[this.mode] : 0;
    if (!target && !this.audio) return;
    const audio = this.element();
    if (target && audio.paused) void audio.play().catch(() => undefined);
    clearInterval(this.fade);
    const step = target > audio.volume ? 0.02 : 0.04;
    this.fade = setInterval(() => {
      const next = audio.volume + Math.sign(target - audio.volume) * Math.min(step, Math.abs(target - audio.volume));
      audio.volume = Math.max(0, Math.min(1, next));
      if (Math.abs(audio.volume - target) < 0.005) { audio.volume = target; clearInterval(this.fade); if (!target) audio.pause(); }
    }, 60);
  }
}
// Juegos en los que se permite música suave mientras se juega (decisión del equipo, 15-11-2026).
export const MUSIC_WHILE_PLAYING = new Set(['TG-02', 'TG-03']);
