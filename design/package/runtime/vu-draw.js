/*
 * Vúmetro analógico realista, compartido por las dos ventanas.
 *
 * Qué se pretendía con esto: que el VU del Meter Bridge y el de la barra lateral sean el MISMO
 * instrumento (antes cada ventana dibujaba el suyo y no se parecían), y que se lea como un medidor de
 * aguja de verdad.
 *
 * Tres decisiones que importan:
 *
 * 1. **La escala va en dBFS, no en "VU"**. El instrumento clásico rotula de -20 a +3 VU, pero los
 *    datos que llegan del WING están en dBFS: rotular VU sobre dBFS era engañoso (0 VU no es 0 dBFS).
 *    Se rotula lo que se mide, con la zona roja encima de 0 dBFS, que es donde hay recorte.
 * 2. **Balística**: ataque rápido y retorno lento, como una aguja con inercia. El llamante pasa el
 *    valor de la señal y el módulo mantiene el estado por clave, así que no hay que duplicarlo.
 * 3. **Nada de brillos ni degradados suaves**: bisel de 1 px, aguja con contrapeso y sombra dura. Es
 *    la misma regla que en el resto de la interfaz.
 */
(function () {
  "use strict";

  // Escala: de -60 a +3 dBFS, con la zona roja por encima de 0.
  const SCALE_MIN = -60;
  const SCALE_MAX = 3;
  const RED_FROM = 0;
  const MAJOR_TICKS = [-60, -50, -40, -30, -20, -10, -5, -3, 0];
  const MINOR_STEP = 2;

  const START_ANGLE = Math.PI * 1.25;
  const END_ANGLE = Math.PI * 1.75;

  const state = new Map();

  /**
   * Balística de aguja: sube rápido hacia la señal y baja despacio. Con `attack`/`release` en 0..1
   * por fotograma; el llamante decide la cadencia con la que dibuja.
   */
  function ballistics(key, value, options) {
    const opts = options || {};
    const attack = opts.attack == null ? 0.5 : opts.attack;
    const release = opts.release == null ? 0.12 : opts.release;
    const previous = state.has(key) ? state.get(key) : value;
    const factor = value > previous ? attack : release;
    const next = previous + (value - previous) * factor;
    state.set(key, next);
    return next;
  }

  function forget(key) {
    if (key === undefined) state.clear();
    else state.delete(key);
  }

  function angleFor(db) {
    const clamped = Math.max(SCALE_MIN, Math.min(SCALE_MAX, db));
    const t = (clamped - SCALE_MIN) / (SCALE_MAX - SCALE_MIN);
    return START_ANGLE + t * (END_ANGLE - START_ANGLE);
  }

  function pointAt(cx, cy, radius, angle) {
    return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
  }

  /**
   * Dibuja el medidor completo.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {{width:number, height:number, db:number, peak?:number, label?:string, dark?:boolean,
   *          showPeak?:boolean, unit?:string}} options
   */
  function drawAnalog(ctx, options) {
    const opts = options || {};
    const w = opts.width;
    const h = opts.height;
    const dark = opts.dark === true;
    const db = Number.isFinite(opts.db) ? opts.db : SCALE_MIN;
    const peak = Number.isFinite(opts.peak) ? opts.peak : null;

    const face = dark ? "#161d1b" : "#f6f2e4";
    const ink = dark ? "#dff3e8" : "#20221f";
    const dim = dark ? "#7d9a8d" : "#6b6a60";
    const edge = dark ? "#0a0f0d" : "#3a3a34";
    const lightEdge = dark ? "#2c3a35" : "#ffffff";

    ctx.clearRect(0, 0, w, h);

    // Bisel del instrumento: 1px duro, como el resto de la interfaz.
    ctx.fillStyle = face;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    ctx.strokeStyle = lightEdge;
    ctx.beginPath();
    ctx.moveTo(1.5, h - 1.5);
    ctx.lineTo(1.5, 1.5);
    ctx.lineTo(w - 1.5, 1.5);
    ctx.stroke();

    // El pivote tiene que verse: con el centro fuera del lienzo la aguja parecía salir del borde y el
    // eje con su tornillo no se dibujaba. Con esto el instrumento queda compuesto dentro del marco.
    const cx = w / 2;
    const cy = h * 0.94;
    const radius = Math.min(h * 0.8, w * 0.42);

    // Arco de escala: negro hasta 0 dBFS, rojo por encima.
    const zeroAngle = angleFor(RED_FROM);
    ctx.lineWidth = 2;
    ctx.strokeStyle = ink;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, START_ANGLE, zeroAngle, false);
    ctx.stroke();
    ctx.strokeStyle = "#c8352a";
    ctx.beginPath();
    ctx.arc(cx, cy, radius, zeroAngle, END_ANGLE, false);
    ctx.stroke();

    // Marcas: mayores con número, menores sin él.
    ctx.font = "bold 8px " + (dark ? "monospace" : "'MS Sans Serif', Tahoma, sans-serif");
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let db2 = SCALE_MIN; db2 <= SCALE_MAX; db2 += MINOR_STEP) {
      const major = MAJOR_TICKS.indexOf(db2) !== -1;
      const angle = angleFor(db2);
      const outer = pointAt(cx, cy, radius - 1, angle);
      const inner = pointAt(cx, cy, radius - (major ? 7 : 4), angle);
      ctx.strokeStyle = db2 > RED_FROM ? "#c8352a" : ink;
      ctx.lineWidth = major ? 1.4 : 1;
      ctx.beginPath();
      ctx.moveTo(outer[0], outer[1]);
      ctx.lineTo(inner[0], inner[1]);
      ctx.stroke();
      if (major) {
        const label = pointAt(cx, cy, radius - 13, angle);
        ctx.fillStyle = db2 > RED_FROM ? "#c8352a" : dim;
        ctx.fillText(String(db2), label[0], label[1]);
      }
    }

    // Marca de pico (retención): una raya fina, sin destellos.
    if (opts.showPeak !== false && peak !== null && peak > SCALE_MIN) {
      const peakAngle = angleFor(peak);
      const a = pointAt(cx, cy, radius - 12, peakAngle);
      const b = pointAt(cx, cy, radius - 2, peakAngle);
      ctx.strokeStyle = "#c8a02a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }

    // Aguja: sombra dura, cuerpo y contrapeso. El pivote va fuera del lienzo por abajo.
    const needleAngle = angleFor(db);
    const tip = pointAt(cx, cy, radius - 4, needleAngle);
    const tail = pointAt(cx, cy, -radius * 0.22, needleAngle);
    ctx.strokeStyle = dark ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.28)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx + 1, cy + 1);
    ctx.lineTo(tip[0] + 1, tip[1] + 1);
    ctx.stroke();
    ctx.strokeStyle = "#1c1c1c";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(tail[0], tail[1]);
    ctx.lineTo(tip[0], tip[1]);
    ctx.stroke();

    // Pivote con tornillo.
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(5, radius * 0.09), 0, Math.PI * 2);
    ctx.fillStyle = dark ? "#0f1513" : "#2a2a26";
    ctx.fill();
    ctx.strokeStyle = lightEdge;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 3, cy);
    ctx.lineTo(cx + 3, cy);
    ctx.stroke();

    // Rótulo: el nombre del canal y la unidad, para que no haya duda de qué se mide.
    const name = String(opts.label || "").slice(0, 22);
    if (name) {
      ctx.font = "bold 9px " + (dark ? "monospace" : "'MS Sans Serif', Tahoma, sans-serif");
      ctx.fillStyle = ink;
      ctx.textAlign = "left";
      ctx.fillText(name, 6, h - 8);
    }
    ctx.font = "bold 8px monospace";
    ctx.fillStyle = dim;
    ctx.textAlign = "right";
    ctx.fillText(opts.unit || "dBFS", w - 6, h - 8);
  }

  // ==========================================================================
  // Graph de histórico estilo "Win95 Task History"
  // ==========================================================================

  const graphState = new Map();

  /**
   * Traza del histórico.
   *
   * Antes se dibujaba una polilínea con `x = índice * (ancho / 59)`: cada muestra aparecía de golpe un
   * paso entero a la derecha y la respuesta se veía a saltos. Ahora las muestras llevan marca de
   * tiempo y la traza se desplaza de forma **continua** entre muestra y muestra, con la ventana
   * temporal fija: el mismo dato, pero fino.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {{width:number, height:number, samples:Array<{t:number,v:number}>, now:number,
   *          windowMs:number, peak?:number, dark?:boolean, grid?:boolean}} options
   */
  function drawHistory(ctx, options) {
    const opts = options || {};
    const w = Math.max(1, Math.round(opts.width));
    const h = Math.max(1, Math.round(opts.height));
    const dark = opts.dark === true;
    const samples = Array.isArray(opts.samples) ? opts.samples : [];
    const windowMs = Math.max(500, opts.windowMs || 3000);
    const now = Number.isFinite(opts.now) ? opts.now : Date.now();

    const background = dark ? "#0b1311" : "#04120b";
    const grid = dark ? "#1b2a25" : "#0d2b1c";
    // Auditoría 2026-09-22: los números del eje se pintaban con la tinta de la rejilla sobre el
    // fondo del gráfico, 1,26:1 en los dos temas: justo debajo del comentario que dice que sin
    // números el gráfico no dice nada. Tinta propia, legible en ambos.
    const label = dark ? "#7d9a8d" : "#6fae8c";
    const ink = dark ? "#5ef0a5" : "#3bf38a";

    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);

    // Rejilla con etiquetas en dBFS: sin números, el gráfico no dice nada.
    if (opts.grid !== false) {
      ctx.font = "9px monospace";
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      for (const level of [0, -10, -20, -30, -40, -50, -60]) {
        const norm = (level - SCALE_MIN) / (SCALE_MAX - SCALE_MIN);
        const y = Math.round(h - 2 - norm * (h - 6)) + 0.5;
        if (y < 1 || y > h - 1) continue;
        ctx.strokeStyle = grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
        ctx.fillStyle = label;
        ctx.fillText(String(level), 3, y - 6);
      }
      for (let x = 0; x < w; x += 40) {
        ctx.strokeStyle = grid;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, h);
        ctx.stroke();
      }
    }

    if (samples.length < 2) return;

    const xFor = (t) => w - ((now - t) / windowMs) * w;
    const yFor = (db) => {
      const clamped = Math.max(SCALE_MIN, Math.min(SCALE_MAX, db));
      const norm = (clamped - SCALE_MIN) / (SCALE_MAX - SCALE_MIN);
      return h - 2 - norm * (h - 6);
    };

    ctx.beginPath();
    let started = false;
    for (const sample of samples) {
      const x = xFor(sample.t);
      if (x < -2) continue;
      const y = yFor(sample.v);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Relleno tenue bajo la traza, sin brillos.
    ctx.lineTo(w, h);
    ctx.lineTo(Math.max(0, xFor(samples[0].t)), h);
    ctx.closePath();
    ctx.fillStyle = dark ? "rgba(94, 240, 165, 0.10)" : "rgba(59, 243, 138, 0.12)";
    ctx.fill();

    if (Number.isFinite(opts.peak) && opts.peak > SCALE_MIN) {
      const y = Math.round(yFor(opts.peak)) + 0.5;
      ctx.strokeStyle = "#c8a02a";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Marca de "ahora": el borde derecho, para leer de un vistazo dónde está el presente.
    ctx.strokeStyle = dark ? "rgba(94, 240, 165, 0.35)" : "rgba(59, 243, 138, 0.4)";
    ctx.beginPath();
    ctx.moveTo(w - 0.5, 0);
    ctx.lineTo(w - 0.5, h);
    ctx.stroke();
  }

  function graphForget(key) {
    if (key === undefined) graphState.clear();
    else graphState.delete(key);
  }

  window.WingVu = {
    drawAnalog,
    drawHistory,
    ballistics,
    forget,
    graphForget,
    scale: { min: SCALE_MIN, max: SCALE_MAX, redFrom: RED_FROM },
  };
})();
