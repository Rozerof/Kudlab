// Catálogo descriptivo de los indicadores TG-01 (regla TG01-DESCRIPTIVE-1). Solo describe lo que
// `tg01.ts` ya calcula: no define fórmulas nuevas. Fuente: F §5.5 pp. 44–45.
export const INDICATOR_METRIC_CODES = ['accuracy_pct', 'omission_rate_pct', 'commission_rate_pct', 'median_reaction_time_ms', 'rt_sd_ms', 'rt_cv_pct',
  'precision_pct', 'error_rate_pct', 'position_accuracy_pct', 'longest_correct_length', 'order_error_rate_pct', 'load_precision_change_pts'] as const;
export const INDICATOR_TASK_IDS = ['TG-01', 'TG-02', 'TG-03', 'TG-04'] as const;
export const INDICATOR_UNITS = ['%', 'ms', 'items', 'pts'] as const;
export type IndicatorTaskId = (typeof INDICATOR_TASK_IDS)[number];
export const INDICATOR_SCOPES = ['SESSION', 'SEGMENT_1', 'SEGMENT_2', 'SEGMENT_3'] as const;
export const UNAVAILABILITY_REASONS = ['NO_VALID_TARGETS', 'NO_VALID_DISTRACTORS', 'NO_VALID_RT', 'INSUFFICIENT_RT_FOR_VARIABILITY',
  'SEGMENT_NOT_REACHED', 'TECHNICAL_EXCLUSION', 'ZERO_MEAN_RT', 'METHOD_NOT_APPROVED',
  'NO_VALID_TRIALS', 'INSUFFICIENT_RT', 'NO_CORRECT_TRIALS', 'INSUFFICIENT_LOAD_DATA'] as const;
export type IndicatorMetricCode = (typeof INDICATOR_METRIC_CODES)[number];
export type IndicatorScope = (typeof INDICATOR_SCOPES)[number];
export type UnavailabilityReason = (typeof UNAVAILABILITY_REASONS)[number];

export type IndicatorDefinition = {
  metricCode: IndicatorMetricCode; taskId: IndicatorTaskId; label: string; description: string; calculation: string; unit: (typeof INDICATOR_UNITS)[number];
  scopes: readonly IndicatorScope[]; inputs: string; unavailabilityReasons: readonly UnavailabilityReason[]; exclusions: string;
};

const exclusions = 'No cuentan los ensayos sin presentación, los no evaluados ni los afectados por una incidencia técnica de la medición.';
const targetReasons = ['METHOD_NOT_APPROVED', 'SEGMENT_NOT_REACHED', 'TECHNICAL_EXCLUSION', 'NO_VALID_TARGETS'] as const;
const rtReasons = ['METHOD_NOT_APPROVED', 'SEGMENT_NOT_REACHED', 'TECHNICAL_EXCLUSION', 'NO_VALID_RT'] as const;
const variabilityReasons = [...rtReasons, 'INSUFFICIENT_RT_FOR_VARIABILITY'] as const;

export const INDICATOR_DEFINITIONS: readonly IndicatorDefinition[] = [
  { metricCode: 'accuracy_pct', taskId: 'TG-01', label: 'Precisión', unit: '%', scopes: INDICATOR_SCOPES,
    description: 'Porcentaje de estrellas objetivo a las que la persona respondió.',
    calculation: 'Aciertos entre el total de ensayos con estrella válidos (aciertos más omisiones), por cien.',
    inputs: 'Ensayos con estrella presentados y evaluados.', unavailabilityReasons: [...targetReasons], exclusions },
  { metricCode: 'omission_rate_pct', taskId: 'TG-01', label: 'Omisión', unit: '%', scopes: INDICATOR_SCOPES,
    description: 'Porcentaje de estrellas objetivo a las que la persona no respondió.',
    calculation: 'Omisiones entre el total de ensayos con estrella válidos (aciertos más omisiones), por cien.',
    inputs: 'Ensayos con estrella presentados y evaluados.', unavailabilityReasons: [...targetReasons], exclusions },
  { metricCode: 'commission_rate_pct', taskId: 'TG-01', label: 'Comisión', unit: '%', scopes: INDICATOR_SCOPES,
    description: 'Porcentaje de lunas distractoras a las que la persona respondió.',
    calculation: 'Falsas alarmas entre el total de ensayos con luna válidos (falsas alarmas más rechazos correctos), por cien.',
    inputs: 'Ensayos con luna presentados y evaluados.',
    unavailabilityReasons: ['METHOD_NOT_APPROVED', 'SEGMENT_NOT_REACHED', 'TECHNICAL_EXCLUSION', 'NO_VALID_DISTRACTORS'], exclusions },
  { metricCode: 'median_reaction_time_ms', taskId: 'TG-01', label: 'Mediana del tiempo de respuesta', unit: 'ms', scopes: INDICATOR_SCOPES,
    description: 'Valor central de los tiempos de respuesta en los aciertos válidos.',
    calculation: 'Mediana de los tiempos entre la presentación y la respuesta, solo en aciertos válidos.',
    inputs: 'Tiempos de respuesta de aciertos válidos.', unavailabilityReasons: [...rtReasons], exclusions },
  { metricCode: 'rt_sd_ms', taskId: 'TG-01', label: 'Desviación del tiempo de respuesta', unit: 'ms', scopes: INDICATOR_SCOPES,
    description: 'Cuánto se dispersan los tiempos de respuesta en los aciertos válidos.',
    calculation: 'Desviación estándar de esos tiempos, con divisor n (número de aciertos válidos).',
    inputs: 'Al menos dos tiempos de respuesta de aciertos válidos.', unavailabilityReasons: [...variabilityReasons], exclusions },
  { metricCode: 'rt_cv_pct', taskId: 'TG-01', label: 'Variabilidad relativa del tiempo de respuesta', unit: '%', scopes: INDICATOR_SCOPES,
    description: 'Dispersión de los tiempos de respuesta en relación con su promedio.',
    calculation: 'Desviación estándar entre la media de los tiempos, por cien (coeficiente de variación).',
    inputs: 'Al menos dos tiempos de respuesta de aciertos válidos con media distinta de cero.',
    unavailabilityReasons: [...variabilityReasons, 'ZERO_MEAN_RT'], exclusions },
];

// Indicadores de los juegos TG-02 a TG-04 (reglas TG02/TG03/TG04-DESCRIPTIVE-1, `external.ts`). Solo alcance SESSION.
const ext = 'Solo cuentan los ensayos válidos de la medición; la práctica guiada no entra en el cálculo.';
const S = ['SESSION'] as const;
const choiceDefs = (taskId: 'TG-02' | 'TG-03', what: string): IndicatorDefinition[] => [
  { metricCode: 'precision_pct', taskId, label: 'Precisión', unit: '%', scopes: S, description: `Porcentaje de ${what} resueltos correctamente.`,
    calculation: 'Respuestas correctas entre los ítems válidos, por cien.', inputs: 'Ítems válidos de la medición.', unavailabilityReasons: ['METHOD_NOT_APPROVED', 'NO_VALID_TRIALS'], exclusions: ext },
  { metricCode: 'error_rate_pct', taskId, label: 'Errores', unit: '%', scopes: S, description: `Porcentaje de ${what} con una respuesta incorrecta.`,
    calculation: 'Respuestas incorrectas entre los ítems válidos, por cien.', inputs: 'Ítems válidos de la medición.', unavailabilityReasons: ['METHOD_NOT_APPROVED', 'NO_VALID_TRIALS'], exclusions: ext },
  { metricCode: 'omission_rate_pct', taskId, label: 'Omisión', unit: '%', scopes: S, description: `Porcentaje de ${what} sin respuesta.`,
    calculation: 'Omisiones entre los ítems válidos, por cien.', inputs: 'Ítems válidos de la medición.', unavailabilityReasons: ['METHOD_NOT_APPROVED', 'NO_VALID_TRIALS'], exclusions: ext },
  { metricCode: 'median_reaction_time_ms', taskId, label: 'Mediana del tiempo de respuesta', unit: 'ms', scopes: S, description: 'Valor central del tiempo de respuesta en las respuestas correctas.',
    calculation: 'Mediana de los tiempos de las respuestas correctas no anticipatorias.', inputs: 'Al menos cinco tiempos válidos.', unavailabilityReasons: ['METHOD_NOT_APPROVED', 'NO_VALID_RT', 'INSUFFICIENT_RT'], exclusions: ext },
  { metricCode: 'rt_cv_pct', taskId, label: 'Variabilidad relativa del tiempo de respuesta', unit: '%', scopes: S, description: 'Dispersión de los tiempos de respuesta en relación con su promedio.',
    calculation: 'Desviación estándar (divisor n) entre la media de los tiempos, por cien.', inputs: 'Al menos cinco tiempos válidos.', unavailabilityReasons: ['METHOD_NOT_APPROVED', 'NO_VALID_RT', 'INSUFFICIENT_RT', 'ZERO_MEAN_RT'], exclusions: ext },
];
export const EXTERNAL_INDICATOR_DEFINITIONS: readonly IndicatorDefinition[] = [
  ...choiceDefs('TG-02', 'grupos de palabras'),
  ...choiceDefs('TG-03', 'cálculos encadenados'),
  { metricCode: 'load_precision_change_pts', taskId: 'TG-03', label: 'Cambio de precisión por carga', unit: 'pts', scopes: S,
    description: 'Diferencia de precisión entre la carga más alta y la más baja (número de pasos).', calculation: 'Precisión en la carga máxima menos precisión en la carga mínima, en puntos porcentuales.',
    inputs: 'Al menos tres ítems válidos en cada carga comparada.', unavailabilityReasons: ['METHOD_NOT_APPROVED', 'INSUFFICIENT_LOAD_DATA'], exclusions: ext },
  { metricCode: 'precision_pct', taskId: 'TG-04', label: 'Precisión', unit: '%', scopes: S, description: 'Porcentaje de secuencias reproducidas completas y en orden.',
    calculation: 'Secuencias correctas entre las secuencias válidas, por cien.', inputs: 'Secuencias válidas de la medición.', unavailabilityReasons: ['METHOD_NOT_APPROVED', 'NO_VALID_TRIALS'], exclusions: ext },
  { metricCode: 'position_accuracy_pct', taskId: 'TG-04', label: 'Exactitud por posición', unit: '%', scopes: S, description: 'Porcentaje de posiciones de las secuencias reproducidas correctamente.',
    calculation: 'Posiciones correctas entre el total de posiciones de las secuencias válidas, por cien.', inputs: 'Secuencias válidas de la medición.', unavailabilityReasons: ['METHOD_NOT_APPROVED', 'NO_VALID_TRIALS'], exclusions: ext },
  { metricCode: 'longest_correct_length', taskId: 'TG-04', label: 'Secuencia más larga correcta', unit: 'items', scopes: S, description: 'Longitud de la secuencia más larga reproducida sin error (no es un span estandarizado).',
    calculation: 'Máximo de las longitudes de las secuencias correctas.', inputs: 'Al menos una secuencia correcta.', unavailabilityReasons: ['METHOD_NOT_APPROVED', 'NO_CORRECT_TRIALS'], exclusions: ext },
  { metricCode: 'order_error_rate_pct', taskId: 'TG-04', label: 'Errores de orden', unit: '%', scopes: S, description: 'Porcentaje de posiciones con un elemento correcto en un orden equivocado.',
    calculation: 'Errores de orden entre el total de posiciones, por cien.', inputs: 'Secuencias válidas de la medición.', unavailabilityReasons: ['METHOD_NOT_APPROVED', 'NO_VALID_TRIALS'], exclusions: ext },
  { metricCode: 'median_reaction_time_ms', taskId: 'TG-04', label: 'Mediana de la latencia del primer toque', unit: 'ms', scopes: S, description: 'Tiempo típico entre el final de la secuencia y el primer toque.',
    calculation: 'Mediana de la latencia del primer toque en las secuencias válidas.', inputs: 'Al menos cinco latencias válidas.', unavailabilityReasons: ['METHOD_NOT_APPROVED', 'NO_VALID_RT', 'INSUFFICIENT_RT'], exclusions: ext },
];
