// Modo aula en la página del curso, apodo + figura en la ficha y estrella de prioridad en el listado.
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loading, Notice } from '../usuarios/shared';
import { useQuery } from '../usuarios/hooks';
import { FIGURES, normalizeAlias, reasonOf } from './api.ts';
import type { AulaApi, AulaGame, AulaResult, Classroom, Priority, PriorityLevel } from './api.ts';

const playOrigin = () => (import.meta.env.VITE_PLAY_ORIGIN as string | undefined) ?? '';
const bogotaDate = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const time = (iso: string) => new Date(iso).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
function failureText(r: AulaResult<unknown>) {
  if (r.kind === 'error' && r.status === 409 && reasonOf(r) === 'INVALID_LIMITS') return 'Revisa la fecha: debe ser de hoy en adelante y como máximo dentro de un año.';
  if (r.kind === 'error' && r.status === 409) return reasonOf(r) === 'TASK_UNAVAILABLE' ? 'Este juego no está disponible todavía (no hay una versión publicada y habilitada).' : 'La operación entró en conflicto. Actualiza e inténtalo otra vez.';
  if (r.kind === 'error' && r.status === 404) return 'No encontramos el curso o ya no tienes acceso.';
  return 'No pudimos confirmar el cambio. Revisa la conexión y vuelve a intentarlo.';
}

// ---------- Modo aula (página del curso) ----------
export function ClassroomMode({ api, groupId }: { api: AulaApi; groupId: string }) {
  const query = useQuery(signal => api.classroom(groupId, signal), `aula:${groupId}`, true);
  const [data, setData] = useState<Classroom>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [minutes, setMinutes] = useState(60);
  const [choosing, setChoosing] = useState<AulaGame['taskId']>();
  const [limits, setLimits] = useState<Partial<Record<AulaGame['taskId'], { maxAttempts: number; until: string }>>>({});
  const limitsOf = (game: AulaGame) => limits[game.taskId] ?? { maxAttempts: game.activation?.maxAttempts ?? 3, until: game.activation?.endsAt ? bogotaDate(game.activation.endsAt) : '' };
  const setLimit = (game: AulaGame, patch: Partial<{ maxAttempts: number; until: string }>) => setLimits(old => ({ ...old, [game.taskId]: { ...limitsOf(game), ...patch } }));
  useEffect(() => { if (query.result?.kind === 'success') setData(query.result.data); }, [query.result]);
  async function run(action: (signal: AbortSignal) => Promise<AulaResult<Classroom>>, done: string) {
    setBusy(true); setMessage('');
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 15000);
    const r = await action(abort.signal).finally(() => clearTimeout(timer));
    setBusy(false);
    if (r.kind === 'success') { setData(r.data); setMessage(done); } else if (r.kind !== 'obsolete') setMessage(failureText(r));
  }
  if (!data) return query.result && query.result.kind !== 'success' ? <Notice title="No pudimos consultar el modo aula"><Button variant="outline" className="mt-2" onClick={query.reload}>Reintentar</Button></Notice> : <Loading text="Consultando el modo aula" />;
  const withoutAlias = data.students.filter(s => !s.alias);
  const blocked = data.students.filter(s => !s.participationAllowed);
  const open = data.window && new Date(data.window.closesAt) > new Date();
  return <section className="aula-panel" aria-labelledby="aula-title">
    <div className="aula-panel-head">
      <div><h2 id="aula-title" className="text-lg font-semibold">Modo aula</h2>
        <p className="text-sm text-muted">Cada estudiante entra con su <strong>apodo</strong> y su <strong>figura secreta</strong>, solo mientras la clase está abierta.</p></div>
      <span className={`aula-state ${open ? 'is-open' : ''}`}>{open ? `Clase abierta hasta las ${time(data.window!.closesAt)}` : 'Clase cerrada'}</span>
    </div>
    <div className="staff-actions items-end">
      {open ? <>
        <Button onClick={() => void run(s => api.close(groupId, s), 'Clase cerrada. Los apodos dejaron de funcionar.')} disabled={busy}>Cerrar la clase</Button>
        <Button variant="outline" onClick={() => void run(s => api.open(groupId, 60, s), 'La clase sigue abierta 60 minutos más desde ahora.')} disabled={busy}>Extender 60 min</Button>
      </> : <>
        <div className="grid gap-1"><Label htmlFor="aula-minutes">Duración</Label>
          <select id="aula-minutes" className="aula-select" value={minutes} onChange={e => setMinutes(Number(e.target.value))}>
            {[30, 45, 60, 90, 120].map(m => <option key={m} value={m}>{m} minutos</option>)}
          </select></div>
        <Button onClick={() => void run(s => api.open(groupId, minutes, s), `Clase abierta por ${minutes} minutos.`)} disabled={busy}>Abrir la clase</Button>
      </>}
    </div>
    {playOrigin() && <p className="text-sm">Los estudiantes abren <a className="staff-link" href={playOrigin()} target="_blank" rel="noreferrer">{playOrigin().replace(/^https?:\/\//, '')}</a>, tocan el curso, escriben su apodo y tocan su figura.</p>}
    <p role="status" className="text-sm font-medium">{message}</p>
    {withoutAlias.length > 0 && <Notice title={`${withoutAlias.length} ${withoutAlias.length === 1 ? 'estudiante no tiene' : 'estudiantes no tienen'} apodo`}><p>Asígnalo en la ficha de cada estudiante, sección «Acceso a los juegos»: {withoutAlias.map(s => s.displayName).join(', ')}.</p></Notice>}
    {blocked.length > 0 && <p className="text-sm text-muted">Sin consentimiento vigente no pueden jugar: {blocked.map(s => s.displayName).join(', ')}.</p>}
    <h3 className="font-semibold mt-2">Juegos</h3>
    <ul className="aula-games-list">{data.games.map(game => {
      const a = game.activation;
      const names = a?.audience === 'STUDENTS' ? data.students.filter(s => a.studentIds.includes(s.id)).map(s => s.alias ?? s.displayName) : [];
      return <li key={game.taskId} className="aula-game-row">
        <div className="min-w-0"><p className="font-semibold">{game.title}</p>
          <p className={`text-sm ${a && !a.expired ? 'aula-on' : 'text-muted'}`}>{!game.available && !a ? 'No disponible: falta publicar o habilitar el juego.' : !a ? 'Inactivo' : a.expired ? 'Terminó su fecha límite. Actívalo de nuevo si quieres que sigan jugando.' : a.audience === 'GROUP' ? '● Activo para todo el curso' : `● Activo para ${names.length} ${names.length === 1 ? 'estudiante' : 'estudiantes'}: ${names.join(', ')}`}</p>
          {a && !a.expired && a.maxAttempts && <p className="text-xs text-muted">{a.maxAttempts} {a.maxAttempts === 1 ? 'intento' : 'intentos'} por estudiante{a.endsAt ? ` · hasta el ${new Date(a.endsAt).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Bogota' })}` : ''}</p>}</div>
        {(game.available || a) && <div className="aula-limits">
          <label>Intentos por estudiante <select className="aula-select" value={limitsOf(game).maxAttempts} onChange={e => setLimit(game, { maxAttempts: Number(e.target.value) })}>{Array.from({ length: 10 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}</select></label>
          <label>Activo hasta <input type="date" className="aula-select" value={limitsOf(game).until} min={bogotaDate(new Date().toISOString())} onChange={e => setLimit(game, { until: e.target.value })} /></label>
          {!limitsOf(game).until && <span className="text-xs text-muted">Sin fecha: hasta el fin del año escolar.</span>}
          {a && limits[game.taskId] && <span className="text-xs text-muted">Al cambiar los límites, el conteo de intentos empieza de nuevo.</span>}
        </div>}
        <div className="staff-actions">
          {a && a.audience === 'GROUP' && !a.expired && limits[game.taskId] && <Button onClick={() => void run(s => api.activate(groupId, game.taskId, 'GROUP', [], s, limitsOf(game)), `${game.title}: límites actualizados.`)} disabled={busy}>Aplicar límites</Button>}
          {(game.available || a) && (a?.audience !== 'GROUP' || a.expired) && <Button onClick={() => void run(s => api.activate(groupId, game.taskId, 'GROUP', [], s, limitsOf(game)), `${game.title}: activo para todo el curso.`)} disabled={busy}>Activar para todo el curso</Button>}
          {(game.available || a) && <Button variant="outline" onClick={() => setChoosing(choosing === game.taskId ? undefined : game.taskId)} disabled={busy} aria-expanded={choosing === game.taskId}>Elegir estudiantes</Button>}
          {a && <Button variant="outline" onClick={() => void run(s => api.deactivate(groupId, game.taskId, s), `${game.title}: desactivado.`)} disabled={busy}>Desactivar</Button>}
        </div>
        {choosing === game.taskId && <ChooseStudents data={data} game={game} busy={busy} onCancel={() => setChoosing(undefined)}
          onSave={ids => { setChoosing(undefined); void run(s => api.activate(groupId, game.taskId, 'STUDENTS', ids, s, limitsOf(game)), `${game.title}: activo para ${ids.length} ${ids.length === 1 ? 'estudiante' : 'estudiantes'}.`); }} />}
      </li>;
    })}</ul>
    <details className="aula-roster"><summary className="cursor-pointer font-semibold">Apodos y figuras del curso</summary>
      <ul>{data.students.map(s => <li key={s.id}><span>{s.displayName}</span><span className="font-semibold">{s.alias ?? 'Sin apodo'}</span><span aria-label={s.figure === null ? 'Sin figura' : FIGURES[s.figure]?.[1]}>{s.figure === null ? '—' : `${FIGURES[s.figure]?.[0]} ${FIGURES[s.figure]?.[1]}`}</span></li>)}</ul>
    </details>
  </section>;
}
function ChooseStudents({ data, game, busy, onSave, onCancel }: { data: Classroom; game: AulaGame; busy: boolean; onSave(ids: string[]): void; onCancel(): void }) {
  const [ids, setIds] = useState<string[]>(game.activation?.audience === 'STUDENTS' ? game.activation.studentIds : []);
  const toggle = (id: string) => setIds(old => old.includes(id) ? old.filter(x => x !== id) : [...old, id]);
  return <fieldset className="aula-choose"><legend className="font-semibold">¿Quiénes juegan {game.title}?</legend>
    <div className="aula-choose-grid">{data.students.map(s => <label key={s.id} className="aula-check"><input type="checkbox" checked={ids.includes(s.id)} onChange={() => toggle(s.id)} disabled={!s.participationAllowed} />
      <span>{s.displayName}{s.alias ? ` · ${s.alias}` : ''}{!s.participationAllowed ? ' (sin consentimiento)' : ''}</span></label>)}</div>
    <div className="staff-actions mt-3"><Button onClick={() => onSave(ids)} disabled={busy || !ids.length}>Activar para {ids.length || 'los'} seleccionados</Button><Button variant="outline" onClick={onCancel}>Cancelar</Button></div>
  </fieldset>;
}

// ---------- Apodo y figura secreta (ficha) ----------
export function StudentPlayAccess({ api, student }: { api: AulaApi; student: { id: string; groupId: string; firstName: string } }) {
  const query = useQuery(signal => api.classroom(student.groupId, signal), `aula-student:${student.id}`);
  const current = query.result?.kind === 'success' ? query.result.data.students.find(s => s.id === student.id) : undefined;
  const [alias, setAlias] = useState<string>();
  const [figure, setFigure] = useState<number | null>();
  const [state, setState] = useState<{ busy?: boolean; message?: string; error?: boolean }>({});
  const shownAlias = alias ?? current?.alias ?? '';
  const shownFigure = figure === undefined ? current?.figure ?? null : figure;
  const normalized = normalizeAlias(shownAlias);
  async function save() {
    if (normalized.length < 3 || normalized.length > 15) { setState({ message: 'El apodo debe tener de 3 a 15 letras o números.', error: true }); return; }
    if (shownFigure === null) { setState({ message: 'Elige la figura secreta.', error: true }); return; }
    setState({ busy: true });
    const r = await api.setProfile(student.id, normalized, shownFigure, AbortSignal.timeout(15000));
    if (r.kind === 'success') { setAlias(r.data.alias); setState({ message: `Guardado. ${student.firstName} entra con el apodo ${r.data.alias} y la figura ${FIGURES[r.data.figure]?.[0]} ${FIGURES[r.data.figure]?.[1]}.` }); query.reload(); }
    else setState({ error: true, message: reasonOf(r) === 'ALIAS_TAKEN' ? 'Ese apodo ya lo usa otro estudiante de este curso. Elige otro.' : r.kind === 'error' && r.status === 400 ? 'Revisa el apodo: solo letras y números, de 3 a 15.' : 'No pudimos guardar. Revisa la conexión y vuelve a intentarlo.' });
  }
  if (!query.result) return <Loading text="Consultando el acceso" />;
  return <div className="staff-stack">
    <p className="text-sm text-muted">El apodo es fijo y no se repite dentro del curso. Junto con la figura secreta, solo funciona mientras abres la clase en «Modo aula».</p>
    <div className="grid gap-1 max-w-sm"><Label htmlFor={`alias-${student.id}`}>Apodo</Label>
      <Input id={`alias-${student.id}`} value={shownAlias} maxLength={20} autoComplete="off" onChange={e => setAlias(e.target.value)} />
      <p className="text-sm text-muted" aria-live="polite">{shownAlias ? `Se escribirá así: ${normalized || '—'}` : 'Ejemplo: TIGRE, SOFI, LUNA7'}</p></div>
    <div role="group" aria-label="Figura secreta"><p className="font-medium mb-2">Figura secreta</p>
      <div className="figure-picker">{FIGURES.map(([emoji, name], i) => <button key={name} type="button" className="figure-option" aria-pressed={shownFigure === i} onClick={() => setFigure(i)}>
        <span className="text-3xl" aria-hidden="true">{emoji}</span><span className="text-sm">{name}</span></button>)}</div></div>
    <div className="staff-actions"><Button onClick={() => void save()} disabled={state.busy}>{current?.alias ? 'Guardar cambios' : 'Guardar apodo y figura'}</Button></div>
    {state.message && <p role="status" className={`text-sm font-medium ${state.error ? 'text-destructive' : ''}`}>{state.message}</p>}
    {current?.alias && <p className="text-sm text-muted">Si cambias el apodo o la figura, el estudiante deberá entrar de nuevo.</p>}
  </div>;
}

// ---------- Estrella de prioridad (listado) ----------
export const PRIORITY: Record<PriorityLevel, { label: string; color: string; fill: boolean }> = {
  AL_DIA: { label: 'Al día', color: '#1D4ED8', fill: true },
  REVISAR: { label: 'Revisar', color: '#7E22CE', fill: true },
  PRIORIDAD: { label: 'Prioridad', color: '#F472B6', fill: true },
  INSUFICIENTE: { label: 'Sin datos', color: '#9CA3AF', fill: false },
};
export function PriorityStar({ priority, compact = false }: { priority?: Priority; compact?: boolean }) {
  if (!priority) return <span className="text-sm text-muted">—</span>;
  const p = PRIORITY[priority.level];
  const title = [priority.message, ...priority.changes.slice(1)].join(' · ');
  return <span className="priority-star" title={title}>
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z" fill={p.fill ? p.color : 'none'} stroke={p.fill ? '#1f2937' : p.color} strokeWidth="1.2" strokeLinejoin="round" /></svg>
    <span className="priority-text"><span className="font-medium">{p.label}</span>{compact ? <span className="sr-only">: {priority.message}</span> : <span className="priority-message">{priority.message}</span>}</span>
  </span>;
}
export function usePriority(api: AulaApi, groupId?: string) {
  const query = useQuery(signal => groupId ? api.priority(groupId, signal) : Promise.resolve({ kind: 'success' as const, data: { items: [], notice: '' } }), `priority:${groupId ?? ''}`);
  return useMemo(() => new Map(query.result?.kind === 'success' ? query.result.data.items.map(i => [i.studentId, i]) : []), [query.result]);
}
export function useAliases(api: AulaApi, groupId?: string) {
  const query = useQuery(signal => groupId ? api.classroom(groupId, signal) : Promise.resolve({ kind: 'success' as const, data: { groupId: '', window: null, students: [], games: [] } }), `aliases:${groupId ?? ''}`);
  return useMemo(() => new Map(query.result?.kind === 'success' ? query.result.data.students.map(s => [s.id, s.alias]) : []), [query.result]);
}
export function PriorityLegend() {
  return <div className="priority-legend" aria-label="Qué significa la estrella">
    {(Object.keys(PRIORITY) as PriorityLevel[]).map(k => <PriorityStar key={k} compact priority={{ studentId: k, level: k, changes: [], message: k === 'AL_DIA' ? 'Sin cambios que revisar' : k === 'REVISAR' ? 'Algunos indicadores cambiaron' : k === 'PRIORIDAD' ? 'Revisar pronto' : 'Datos insuficientes' }} />)}
    <span className="text-sm text-muted">Prioridad de revisión, no diagnóstico: compara a cada estudiante consigo mismo, nunca con sus compañeros.</span>
  </div>;
}
