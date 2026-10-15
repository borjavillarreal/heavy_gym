# SPEC — hevy-pl-sync

> Instrucciones para Claude Code. Este documento es la fuente de verdad. El Excel (`fixtures/PL_Workout_NEW.xlsx`) es solo referencia histórica y para validar números: tiene fórmulas inconsistentes (ver §12), no lo copies tal cual.

## 1. Objetivo

Entreno powerlifting con un programa tipo **n‑Suns 5/3/1 LP** y registro todo en **Hevy** (tengo Hevy Pro con API key). Quiero que, cada vez que guardo un entrenamiento en Hevy:

1. Un script lea el entrenamiento guardado.
2. Tome mi serie **1+** (AMRAP) de cada levantamiento principal: peso, reps y RPE.
3. Calcule mi **e1RM** con la tabla RPE (§4), actualice mi **máximo semanal** y mi **Training Max (TM)**.
4. Reescriba mis rutinas de Hevy con los **pesos de la siguiente sesión**.
5. Reescriba la **nota del ejercicio** con una tabla “según cuántas reps hagas en la 1+, carga estas series”, en dos bloques: RPE 10 y RPE 9.

En el gimnasio yo solo abro la rutina en Hevy, los pesos ya están puestos, hago la 1+, busco mi fila en la nota y ajusto las series restantes a mano.

**No es posible** cambiar series en vivo durante un entrenamiento abierto (la API solo ve entrenamientos guardados). Por eso la nota con la tabla precalculada.

## 2. Arquitectura

| Pieza | Decisión |
|---|---|
| Lenguaje | Node.js ≥ 20, **sin dependencias** (usar `fetch` nativo) |
| Ejecución | GitHub Action con cron cada 30 min de 05:00 a 23:00 hora CDMX, más `workflow_dispatch` |
| Estado | `state.json` en el repo; el Action hace commit cuando cambia |
| Secreto | `HEVY_API_KEY` como GitHub secret. **Nunca** en el código, logs ni commits |
| Modo seguro | Por defecto **dry run** (solo imprime cambios). Escribe solo con `APPLY=1` |
| Configuración | `config.json` (rutinas, IDs de ejercicios, porcentajes) |

Archivos: `src/engine.js` (matemática pura), `src/hevy.js` (cliente API), `src/run.js` (orquestación), `config.json`, `state.json`, `.github/workflows/hevy-sync.yml`, `test/engine.test.js` (usar `node --test`).

Ya existe una primera versión en `hevy-pl-sync.zip`. Úsala como punto de partida; corrígela y complétala contra esta spec.

## 3. API de Hevy

- Base: `https://api.hevyapp.com/v1`, header `api-key: <key>`.
- `GET /workouts?page=1&pageSize=10` → entrenamientos más recientes primero. Cada uno: `id, title, routine_id, start_time, exercises[] { exercise_template_id, title, notes, sets[] { index, type, weight_kg, reps, rpe } }`.
- `GET /routines?page=&pageSize=` (paginar con `page_count`), `GET /routines/{id}`.
- `PUT /routines/{id}` con cuerpo `{ "routine": { title, notes, exercises: [ { exercise_template_id, superset_id, rest_seconds, notes, sets: [ { type, weight_kg, reps, … } ] } ] } }`.
  - **El PUT reemplaza la rutina completa.** Siempre: GET → modificar solo pesos y la nota → PUT con todo lo demás intacto.
  - No mandar campos `null`. No mandar `folder_id`.
  - Después de cada PUT, volver a hacer GET y verificar que los pesos quedaron (log `verified` o error).
- `GET /exercise_templates` para el comando `list`.
- Todos los pesos de la API están en **kg**. Yo entreno en **lb**.
  - `lb → kg`: `kg = lb × 0.45359237` (3 decimales).
  - `kg → lb` al leer: redondear a 0.5 lb.

Primer paso al conectar en vivo: correr `list` y `run` en dry run, revisar el formato real de las respuestas y ajustar el cliente si difiere de lo de arriba.

## 4. Motor de cálculo (fórmulas exactas)

### 4.1 Tabla RPE → % del 1RM

Dos secuencias base (26 valores cada una):

```
SEQ_A (RPE enteros: 10, 9, 8, 7)
1, .955, .922, .892, .863, .837, .811, .786, .762, .739, .707, .68, .653,
.626, .599, .572, .545, .518, .491, .464, .437, .41, .383, .356, .329, .302

SEQ_B (RPE medios: 9.5, 8.5, 7.5, 6.5)
.978, .939, .907, .878, .85, .824, .799, .774, .751, .723, .694, .667, .64,
.613, .586, .5585, .5315, .5045, .4775, .4505, .4235, .3965, .3695, .3425, .3155, .2885
```

```
pct(rpe, reps):
  válido solo si reps ∈ [1..20] entero y rpe ∈ {10, 9.5, 9, 8.5, 8, 7.5, 7, 6.5}
  si rpe es entero:  SEQ_A[ reps − 1 + (10 − rpe) ]
  si rpe es .5:      SEQ_B[ reps − 1 + (9.5 − rpe) ]
  si no es válido:   null   (en el Excel era #N/A)
```

Regla de fondo: cada punto de RPE equivale a una rep (RPE 10 con n reps = RPE 9 con n−1 reps).

Chequeos: `pct(10,1)=1`, `pct(9.5,1)=.978`, `pct(9,1)=.955`, `pct(8,1)=.922`, `pct(9,4)=.863`, `pct(10,8)=.786`.

### 4.2 Redondeos (equivalentes a Excel)

```
mround(x, m)  = round(x / m) × m          // MROUND; .5 redondea hacia arriba
ceilTo(x, m)  = ceil(x / m) × m            // CEILING
step = 5 lb (2.5 kg)
```

### 4.3 e1RM, máximo semanal y TM

```
e1RM(peso, reps, rpe) = peso / pct(rpe, reps)          // null si pct es null o peso ≤ 0
```

```
máximo semanal (maxRule = "top", por defecto):
  max = e1RM(serie 1+)
  si la 1+ no tiene datos válidos → e1RM(back-off)
  si la 1+ no tiene RPE → asumir RPE 10 y anotarlo en el log

maxRule = "average" (regla original del Excel):
  max = promedio(e1RM(1+), e1RM(back-off)); si falta uno, el otro; si faltan ambos, sin cambio
```

Por qué `"top"` es el default: en n‑Suns la última serie es la 9.ª del día, hecha con fatiga, y subestima el 1RM. Ejemplo real: 245×4 @9 en la 1+ da e1RM 283.9. Con back-off 170×7 @9 (e1RM 216.3), el promedio da 250.1 y hundiría el TM 30 lb.

```
TM = ceilTo(max × 0.90, step)
peso de la serie = mround(TM × %serie, step)
```

Back-off = última serie `normal` con RPE registrado, distinta de la 1+.

### 4.4 Tabla de la nota (lo que se calcula “en vivo” antes de entrenar)

Para un ejercicio con serie AMRAP:

```
W   = mround(TM × %AMRAP, step)                 // peso de la 1+ de la próxima sesión
para cada rpe en [10, 9], para cada r en [1,2,3,4,5,6,7,8,10]:
   e   = e1RM(W, r, rpe)
   TMd = ceilTo(e × 0.90, step)                 // TM del día
   fila r → [ mround(TMd × %s, step) para cada serie s después de la AMRAP ]
```

## 5. Programa (n‑Suns 5/3/1 LP, 6 días)

Porcentajes sobre el **TM** del levantamiento indicado. `"1+"` marca la serie AMRAP.

```
T1_531  = 75%×5, 85%×3, 95%×1+, 90%×3, 85%×3, 80%×3, 75%×5, 70%×5, 65%×5
T1_DL   = 75%×5, 85%×3, 95%×1+, 90%×3, 85%×3, 80%×3, 75%×3, 70%×3, 65%×3
T1_BMON = 65%×8, 75%×6, 85%×4, 85%×4, 85%×4, 80%×5, 75%×6, 70%×7, 65%×8   (sin AMRAP)
T2(a,b,c) = a×6, b×5, c×3, c×5, c×7, c×4, c×6, c×8
```

| Día | T1 (TM) | T2 (TM) | Accesorios |
|---|---|---|---|
| Lun | Bench — T1_BMON (bench) | OHP — T2(50,60,70) (ohp) | Push |
| Mar | Squat — T1_531 (squat) | Sumo DL — T2(50,60,70) (deadlift) | Legs |
| Mié | OHP — T1_531 (ohp) | Incline bench — T2(40,50,60) (bench) | Pull |
| Jue | Deadlift — T1_DL (deadlift) | Front squat — T2(35,45,55) (squat) | Legs |
| Vie | Bench — T1_531 (bench) | Close‑grip bench — T2(40,50,60) (bench) | Push |
| Sáb | Squat — 8×3 @72.5% (squat) | Sumo DL — 6×3 @56.25% (deadlift) | Pull |

Variante alternativa (opcional, `template: "topsingle"`): % del **1RM** directo, no del TM. Principal 1+: 92%×1, luego 5×5 @72%. Secundario: 79%×5, 81%×5, 84%×5, 74%×5, 74%×5.

Accesorios (fase 2, no requerido ahora): 4 series 15@RPE9, 12@8.5, 10@8, 8@7. Peso = `mround(e1RM_ejercicio × pct(rpe, reps), redondeo)`.

## 6. Lectura de entrenamientos (ingest)

1. Traer los últimos 10 entrenamientos; procesar los que no estén en `state.processed`, del más viejo al más nuevo.
2. Relacionar el entrenamiento con la rutina por `routine_id` y luego con `config.routines` por título exacto. Si no coincide, ignorarlo.
3. Para cada ejercicio de la config con serie AMRAP: buscar en el entrenamiento el ejercicio con el mismo `exercise_template_id`. Filtrar solo series `type = "normal"` (sin calentamiento). La 1+ es la serie en la **misma posición** que en la config (índice 2 en T1).
4. Calcular el máximo según §4.3 y guardarlo en `state.maxes[lift]` con fecha y fuente. Agregar una entrada a `state.history`.
5. Si el RPE o las reps están fuera de la tabla, no tocar el máximo y avisar en el log.

## 7. Escritura de rutinas

Para cada rutina de la config:

1. GET de la rutina.
2. Para cada ejercicio de Hevy, buscar el ejercicio de la config con el mismo `exercise_template_id`. Si se repite en la rutina, emparejar en orden.
3. Reemplazar `weight_kg` y `reps` de las series `normal` en orden. En la AMRAP, `reps = 1` (o 3 para 3+). No tocar calentamientos.
4. Si Hevy tiene un número distinto de series de trabajo que la config, llenar las que coincidan y avisar.
5. Nota: reemplazar solo el bloque entre `⟦PL⟧` y `⟦/PL⟧`; si no existe, agregarlo al final. Conservar mi texto.
6. Solo hacer PUT si algo cambió. Luego verificar.

Formato de la nota (debe leerse bien en un iPhone):

```
⟦PL⟧
1+ @ 245 lb — find your row, load the sets after it
(90%×3, 85%×3, 80%×3, 75%×5, 70%×5, 65%×5 of today's TM)

RPE 10
 1 → 205 · 190 · 180 · 170 · 160 · 145
 …
RPE 9
 1 → 210 · 200 · 190 · 175 · 165 · 155
 …

TM 260 from week max 285.3
⟦/PL⟧
```

## 8. Estado (`state.json`)

```json
{
  "maxes": { "bench": { "value": 199.39, "source": "…", "single": false }, "…": {} },
  "processed": ["workout-id", "…"],
  "history":  [ { "date": "…", "lift": "squat", "top": {"w":245,"r":4,"rpe":9}, "back": {…}, "max": 283.9 } ]
}
```

Semilla desde el Excel (lb): bench 199.39, squat 285.27, deadlift 303.51, ohp 162.69. Guardar solo los últimos 200 IDs en `processed`.

## 9. Comandos

| Comando | Qué hace |
|---|---|
| `node src/run.js list` | Imprime rutinas, IDs y número de series de trabajo (para llenar la config) |
| `node src/run.js preview` | Imprime las notas desde `state.json`, sin API |
| `node src/run.js run` | Dry run: ingest + cambios planeados, sin escribir |
| `APPLY=1 node src/run.js run` | Escribe en Hevy, verifica y guarda el estado |

## 10. Casos de prueba (deben pasar; vienen del Excel)

### 10.1 Máximo semanal con `maxRule: "average"` (lb)

Entradas `[peso, reps, rpe]` de la 1+ y de la back-off.

| Sem. | Bench | OHP | Deadlift | Squat | Esperado (B / O / D / S) |
|---|---|---|---|---|---|
| F1 S1 | 135,8,10 / — | 85,10,9.5 / — | 225,5,8 / — | 185,10,8 / — | 171.76 / 117.57 / 277.44 / 272.06 |
| F1 S2 | 145,7,9 / 100,15,8 | 110,2,9 / 70,14,9 | 240,2,9.5 / 165,15,8.5 | 235,3,10 / 150,15,9 | 183.98 / 118.08 / 275.51 / 258.56 |
| F1 S3 | 160,3,9.5 / 105,19,10 | 105,4,10 / 70,16,10 | 240,3,8 / 165,18,9 | 225,3,8 / 155,16,9 | 195.13 / 120.05 / 307.07 / 272.56 |
| F2 S1 | 170,2,10 / 105,20,10 | 105,5,9.5 / 75,14,9.5 | 265,3,9 / 175,12,7 | 240,3,9.5 / 155,15,8.5 | 202.15 / 122.94 / 294.62 / 271.07 |
| F2 S2 | 175,3,9.5 / 115,20,9.5 | 105,6,8 / 80,17,9 | 255,3,8.5 / 170,17,8.5 | 235,4,9 / 165,13,8 | 224.11 / 144.01 / 313.70 / 273.88 |
| F2 S3 | 195,1,9.5 / — | 125,4,10 / 85,15,10 | 270,3,9 / 180,17,8.5 | 240,4,8 / 170,13,8 | 199.39 / 141.02 / 329.74 / 285.27 |

### 10.2 Prescripción de la 1+ (de la semana previa)

- Máximo 202.15 → TM 185 → 1+ = **175**
- Máximo 195.13 → TM 180 → 1+ = **170**
- Máximo 329.74 → TM 300 → 1+ = **285**

### 10.3 Fila de la nota

Squat, TM 260 → 1+ @ 245. Con RPE 10 y 4 reps: `225 · 215 · 200 · 190 · 175 · 165`. Con RPE 9 y 4 reps: `235 · 220 · 210 · 195 · 180 · 170`.

### 10.4 `maxRule: "top"`

1+ 245×4 @9 y back-off 170×7 @9 → máximo **283.9** (con `"average"` daría 250.1).

### 10.5 Conversión

170 lb → 77.111 kg → al leer de vuelta, 170.0 lb.

## 11. Fuera de alcance por ahora

- Descarga automática: si es semana de descarga, pongo `APPLY=0` a mano.
- Accesorios automatizados.
- Webhook en lugar de cron (solo si el retraso de hasta 30 min me molesta).

## 12. Errores del Excel que NO hay que copiar

- Banderas de “semana actual” (cols AX:BA) que revisan columnas equivocadas (`D6`, `F13`) y mezclan `<>3` con `<>4`.
- % de back-off inconsistentes a mano (0.65 / 0.63 / 0.64); aquí es un solo parámetro.
- Squat encadena la back-off a la 1+ del mismo día y los demás levantamientos a la semana previa; aquí es una sola regla.
- `#N/A` silencioso cuando el RPE o las reps salen de la tabla; aquí debe avisar en el log.
- Sábado: el Excel dice “8–11 series” de squat; aquí son 8 fijas (configurable).

## 13. Reglas de trabajo para Claude Code

1. Primero escribe los tests de §10 y haz que pasen con `node --test` antes de tocar la API.
2. No pidas ni imprimas mi API key. Yo la exporto en mi terminal (`export HEVY_API_KEY=…`) o la pongo como secret de GitHub.
3. Toda escritura a Hevy va detrás de `APPLY=1`. Siempre muéstrame el dry run antes.
4. Si la respuesta real de la API no coincide con §3, ajusta el cliente y dime qué cambió.
