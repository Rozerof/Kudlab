// Panel de observación docente 0–5 (documento «panel-observacion-docente-KudLab»): 13 preguntas en bloques A–E,
// línea de 6 puntos con número + carita + color, «No lo he observado» aparte (null, nunca 0), sin preselección,
// nota opcional por bloque (≤140), borrador automático y resumen por bloque y por periodo (sin puntaje global).
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loading, Notice } from '../usuarios/shared';
import { useQuery } from '../usuarios/hooks';
import type { AulaApi, BlockKey, Panel, PanelList } from './api.ts';

export const SCALE = [
  { value: 0, text: 'Nunca', face: '😢', color: '#D32F2F' }, { value: 1, text: 'Casi nunca', face: '🙁', color: '#F4511E' },
  { value: 2, text: 'Pocas veces', face: '😕', color: '#FB8C00' }, { value: 3, text: 'A veces', face: '😐', color: '#FBC02D' },
  { value: 4, text: 'Casi siempre', face: '🙂', color: '#9CCC65' }, { value: 5, text: 'Siempre', face: '😄', color: '#43A047' },
] as const;
export const PANEL_BLOCKS: { key: BlockKey; title: string; game: string; area: string; questions: [string, string][] }[] = [
  { key: 'A', title: 'Atención sostenida y control de la respuesta', game: 'TG-01 Lluvia de estrellas', area: 'Lectura y Matemáticas', questions: [
    ['OD-01', 'mantiene la atención en la tarea hasta terminarla, sin que haya que llamarlo de nuevo a la actividad.'],
    ['OD-02', 'conserva un ritmo de trabajo parejo de principio a fin de la actividad (no se desconecta ni se apaga hacia el final).'],
    ['OD-03', 'se detiene a pensar antes de actuar (no responde ni empieza a escribir de inmediato sin haber entendido).']] },
  { key: 'B', title: 'Atención selectiva', game: 'TG-02 Palabra intrusa', area: 'Lectura', questions: [
    ['OD-04', 'lee completos el enunciado o las opciones antes de responder.'],
    ['OD-05', 'se mantiene en lo que está haciendo aunque haya ruido o movimiento a su alrededor.'],
    ['OD-06', 'identifica qué elemento no encaja o qué dato es el importante dentro de un grupo de palabras, imágenes o un texto corto.']] },
  { key: 'C', title: 'Memoria de trabajo en Matemáticas', game: 'TG-03 Mentalista', area: 'Matemáticas', questions: [
    ['OD-07', 'conserva los datos intermedios cuando resuelve un problema de varios pasos (no olvida lo que ya calculó).'],
    ['OD-08', 'mantiene el «acarreo» o la reagrupación al sumar y restar sin perderlos a mitad de la operación.'],
    ['OD-09', 'sigue instrucciones de dos o más pasos sin necesitar que se le repitan.']] },
  { key: 'D', title: 'Memoria inmediata de secuencias', game: 'TG-04 Kud dice', area: 'Lectura y Matemáticas', questions: [
    ['OD-10', 'repite o reproduce en el orden correcto una serie que acaba de escuchar o ver (palabras, números, pasos).'],
    ['OD-11', 'copia del tablero al cuaderno sin invertir, saltarse ni cambiar de lugar números o letras.'],
    ['OD-12', 'recuerda las ideas principales de un párrafo leído minutos antes.']] },
  { key: 'E', title: 'Persistencia en la tarea', game: 'Transversal: contextualiza los cuatro juegos', area: 'Lectura y Matemáticas', questions: [
    ['OD-13', 'sigue intentando cuando un ejercicio se le dificulta (no lo abandona antes de intentarlo por completo).']] },
];
const QUESTION_IDS = PANEL_BLOCKS.flatMap(b => b.questions.map(q => q[0]));
const AREAS = [['AMBAS', 'Ambas'], ['LECTURA', 'Lectura'], ['MATEMATICAS', 'Matemáticas']] as const;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const periodFor = (date: string) => `${date.slice(0, 4)}-P${Math.min(4, Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1)}`;
const decimal = (n: number) => n.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
type Answer = number | null | undefined; // undefined = sin responder; null = «No lo he observado»
type Draft = { period: string; observedOn: string; area: Panel['area']; answers: Record<string, Answer>; notes: Partial<Record<BlockKey, string>>; requestId: string };
const fresh = (): Draft => { const d = today(); return { period: periodFor(d), observedOn: d, area: 'AMBAS', answers: {}, notes: {}, requestId: crypto.randomUUID() }; };
function readDraft(key: string): Draft | undefined {
  try { const raw = localStorage.getItem(key); const d = raw ? JSON.parse(raw) as Draft : undefined; return d && typeof d.answers === 'object' && typeof d.requestId === 'string' ? d : undefined; } catch { return undefined; }
}
function writeDraft(key: string, d: Draft | undefined) { try { if (d) localStorage.setItem(key, JSON.stringify(d)); else localStorage.removeItem(key); } catch { /* el borrador es una comodidad */ } }

export function ObservationPanel({ api, student }: { api: AulaApi; student: { id: string; firstName: string } }) {
  const key = `kudlab:panel:${student.id}`;
  const query = useQuery(signal => api.panels(student.id, signal), `panels:${student.id}`, true);
  const [draft, setDraft] = useState<Draft>(() => readDraft(key) ?? fresh());
  const [restored] = useState(() => !!readDraft(key));
  const [open, setOpen] = useState(restored);
  const [state, setState] = useState<{ busy?: boolean; message?: string; error?: boolean }>({});
  const [started] = useState(() => Date.now());
  const touched = Object.keys(draft.answers).some(k => draft.answers[k] !== undefined) || Object.values(draft.notes).some(Boolean);
  useEffect(() => { writeDraft(key, touched ? draft : undefined); }, [key, draft, touched]);
  const answered = QUESTION_IDS.filter(id => draft.answers[id] !== undefined).length;
  const set = (id: string, value: Answer) => setDraft(d => ({ ...d, answers: { ...d.answers, [id]: d.answers[id] === value ? undefined : value } }));
  async function save() {
    if (answered < QUESTION_IDS.length) { setState({ error: true, message: `Faltan ${QUESTION_IDS.length - answered} preguntas. Si no pudo observar una conducta, use «No lo he observado».` }); return; }
    setState({ busy: true });
    const responses = Object.fromEntries(QUESTION_IDS.map(id => [id, draft.answers[id] ?? null]));
    const r = await api.savePanel(student.id, { requestId: draft.requestId, period: draft.period, observedOn: draft.observedOn, area: draft.area, responses, notes: draft.notes }, AbortSignal.timeout(15000));
    if (r.kind === 'success') {
      const seconds = Math.round((Date.now() - started) / 1000);
      writeDraft(key, undefined); setDraft(fresh()); setOpen(false);
      setState({ message: `Observación guardada para ${draft.period}${seconds < 600 ? ` (${Math.max(1, Math.round(seconds / 60))} min)` : ''}.` }); query.reload();
    } else setState({ error: true, message: r.kind === 'error' && r.status === 400 ? 'Revisa la fecha, el periodo y las notas (máximo 140 caracteres).' : 'No pudimos confirmar el guardado. El borrador se conserva; vuelve a intentarlo.' });
  }
  const data = query.result?.kind === 'success' ? query.result.data : undefined;
  return <div className="staff-stack">
    {data ? <PanelSummary data={data} /> : query.result ? <Notice title="No pudimos consultar el panel"><Button variant="outline" className="mt-2" onClick={query.reload}>Reintentar</Button></Notice> : <Loading text="Consultando el panel" />}
    {state.message && !open && <p role="status" className={`text-sm font-medium ${state.error ? 'text-destructive' : ''}`}>{state.message}</p>}
    {!open ? <div className="staff-actions"><Button onClick={() => setOpen(true)}>{touched ? 'Continuar el borrador' : 'Registrar observación'}</Button></div> :
    <form className="panel-form" onSubmit={e => { e.preventDefault(); void save(); }} aria-label={`Panel de observación de ${student.firstName}`}>
      {restored && touched && <p className="text-sm text-muted">Recuperamos el borrador que dejaste en este navegador.</p>}
      <blockquote className="panel-instruction">Piense en las últimas semanas de clase. Para cada frase, toque el punto que mejor describe <strong>qué tan seguido</strong> ve esta conducta en el estudiante. Si no la ha podido observar, use «No lo he observado».</blockquote>
      <div className="panel-meta">
        <div className="grid gap-1"><Label htmlFor="panel-date">Fecha</Label><input id="panel-date" type="date" className="aula-select" value={draft.observedOn} max={today()} onChange={e => setDraft(d => ({ ...d, observedOn: e.target.value, period: e.target.value ? periodFor(e.target.value) : d.period }))} /></div>
        <div className="grid gap-1"><Label htmlFor="panel-period">Periodo</Label><select id="panel-period" className="aula-select" value={draft.period} onChange={e => setDraft(d => ({ ...d, period: e.target.value }))}>
          {[1, 2, 3, 4].map(n => `${draft.observedOn.slice(0, 4) || new Date().getFullYear()}-P${n}`).map(p => <option key={p} value={p}>{p.replace('-P', ' · Periodo ')}</option>)}</select></div>
        <div className="grid gap-1"><Label htmlFor="panel-area">Área observada</Label><select id="panel-area" className="aula-select" value={draft.area} onChange={e => setDraft(d => ({ ...d, area: e.target.value as Panel['area'] }))}>
          {AREAS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></div>
      </div>
      <div className="panel-scale-legend" aria-hidden="true">{SCALE.map(s => <span key={s.value}><b style={{ background: s.color }}>{s.value}</b>{s.face} {s.text}</span>)}</div>
      {PANEL_BLOCKS.map(block => <fieldset key={block.key} className="panel-block">
        <legend><span className="panel-block-key">Bloque {block.key}</span> {block.title}</legend>
        <p className="text-sm text-muted">Relacionado con {block.game}. Área: {block.area}.</p>
        {block.questions.map(([id, text]) => <QuestionLine key={id} id={id} text={text} value={draft.answers[id]} onChange={v => set(id, v)} />)}
        <div className="grid gap-1 mt-2"><Label htmlFor={`note-${block.key}`}>Nota breve del bloque (opcional)</Label>
          <textarea id={`note-${block.key}`} className="panel-note" maxLength={140} rows={2} value={draft.notes[block.key] ?? ''} onChange={e => setDraft(d => ({ ...d, notes: { ...d.notes, [block.key]: e.target.value } }))} />
          <span className="text-xs text-muted text-right">{(draft.notes[block.key] ?? '').length}/140</span></div>
      </fieldset>)}
      <div className="panel-footer">
        <p className="text-sm font-medium" aria-live="polite">{answered} de {QUESTION_IDS.length} respondidas</p>
        <div className="staff-actions"><Button type="submit" disabled={state.busy}>Guardar observación</Button>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Seguir después</Button>
          {touched && <Button type="button" variant="outline" onClick={() => { writeDraft(key, undefined); setDraft(fresh()); setState({}); }}>Descartar borrador</Button>}</div>
        {state.message && <p role="status" className={`text-sm font-medium ${state.error ? 'text-destructive' : ''}`}>{state.message}</p>}
        <p className="text-xs text-muted">Carácter pedagógico, complementario y no diagnóstico. Describe conductas observables; no clasifica al estudiante.</p>
      </div>
    </form>}
  </div>;
}
function QuestionLine({ id, text, value, onChange }: { id: string; text: string; value: Answer; onChange(v: Answer): void }) {
  return <div className="panel-question" role="group" aria-labelledby={`${id}-text`}>
    <p id={`${id}-text`}><span className="panel-qid">{id}</span> El estudiante… {text}</p>
    <div className="panel-line">
      <div className="panel-dots">{SCALE.map(s => {
        const on = value === s.value;
        return <button key={s.value} type="button" className={`panel-dot ${on ? 'is-on' : ''}`} aria-pressed={on} aria-label={`${s.value}: ${s.text}`}
          style={on ? { background: s.color, borderColor: s.color } : undefined} onClick={() => onChange(s.value)}>
          <span className="panel-dot-num">{s.value}</span><span className="panel-dot-face" aria-hidden="true">{s.face}</span></button>;
      })}</div>
      <button type="button" className={`panel-none ${value === null ? 'is-on' : ''}`} aria-pressed={value === null} onClick={() => onChange(null)}>No lo he observado</button>
    </div>
  </div>;
}
const BLOCK_SHORT: Record<BlockKey, string> = { A: 'A · Atención sostenida', B: 'B · Atención selectiva', C: 'C · Memoria de trabajo', D: 'D · Memoria de secuencias', E: 'E · Persistencia' };
// Resumen: por bloque y por periodo, en un solo color neutro (el degradado solo se usa al capturar).
function PanelSummary({ data }: { data: PanelList }) {
  const periods = data.periods;
  const text = useMemo(() => {
    if (periods.length < 2) return '';
    const [prev, last] = periods.slice(-2) as [PanelList['periods'][number], PanelList['periods'][number]];
    const parts = (Object.keys(BLOCK_SHORT) as BlockKey[]).flatMap(b => {
      const x = prev.blocks[b].average, y = last.blocks[b].average;
      return x !== null && y !== null && Math.abs(x - y) >= 0.5 ? [`En el bloque ${b} registró un promedio de ${decimal(y)} en ${last.period}, frente a ${decimal(x)} en ${prev.period}.`] : [];
    });
    return parts.join(' ');
  }, [periods]);
  if (!periods.length) return <p className="text-sm text-muted">Aún no hay observaciones registradas con el panel 0–5.</p>;
  return <div className="staff-stack">
    <div className="staff-table-region" role="region" aria-label="Resumen del panel por bloque y periodo" tabIndex={0}>
      <table className="panel-summary"><thead><tr><th scope="col">Bloque</th>{periods.map(p => <th key={p.period} scope="col">{p.period.replace('-P', ' P')}</th>)}</tr></thead>
        <tbody>{(Object.keys(BLOCK_SHORT) as BlockKey[]).map(b => <tr key={b}><th scope="row">{BLOCK_SHORT[b]}</th>{periods.map(p => {
          const v = p.blocks[b];
          return <td key={p.period}>{v.status === 'OK' && v.average !== null ? <span className="panel-bar"><span style={{ width: `${v.average}rem` }} /><b>{decimal(v.average)}</b></span> : <span className="text-xs text-muted">Datos insuficientes</span>}</td>;
        })}</tr>)}</tbody></table>
    </div>
    {text && <p className="text-sm">{text} Se sugiere contrastarlo con los indicadores del juego relacionado.</p>}
    <p className="text-xs text-muted">Promedio por bloque (0 a 5) del registro más reciente de cada periodo. Un bloque se muestra con al menos 2 respuestas (el E, con 1). Sin puntaje global ni comparación entre estudiantes.</p>
  </div>;
}
