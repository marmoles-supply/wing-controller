/*
 * Tramas ordenadas (dithering) para las superficies de la app.
 *
 * Por qué existe esto: en pantallas de 256 colores los degradados de la época (los títulos de
 * Windows 98, las portadas de Encarta) no eran degradados suaves, eran rampas TRAMADAS: el color
 * pasaba de uno a otro mezclando píxeles con una matriz ordenada. Lo que hoy se pinta plano es una
 * simplificación moderna, así que recuperar la trama es más fiel, no menos.
 *
 * Dos decisiones técnicas que importan:
 *
 * 1. El patrón se genera AL TAMAÑO EXACTO del elemento (1 píxel del patrón = `cell` píxeles de
 *    pantalla). Estirar un patrón pequeño con `background-size: 100% 100%` produce celdas
 *    rectangulares y costuras verticales visibles; generarlo a medida no tiene ninguno de los dos
 *    problemas.
 * 2. Se dibuja una sola vez por combinación (color, tamaño, celda) y se cachea como PNG en memoria.
 *    Un patrón vectorial en línea costaba megabytes de CSS; el PNG de un elemento normal son unos
 *    pocos KB.
 *
 * La matriz es de Bayer 4x4 (16 niveles), que da un punteado regular y sin estructura diagonal
 * marcada. `hold` retiene el color base al principio de la superficie, que es lo que hace que se lea
 * como un reflejo y no como un degradado de fondo.
 */
(function () {
  "use strict";

  const BAYER4 = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ];

  // Azul de título (Win95/Win98), gris de panel, verde del tema oscuro y la banda de marca.
  const PRESETS = {
    navy: { from: "#000080", to: "#1084d0", cell: 3, hold: 0.3, stops: 8, defaultSize: [380, 23] },
    navyDark: { from: "#0e2a20", to: "#1f7a55", cell: 3, hold: 0.3, stops: 8, defaultSize: [380, 23] },
    grey: { from: "#b4b4b4", to: "#d6d6d6", cell: 2, hold: 0.35, stops: 6, defaultSize: [320, 20] },
    // El header principal del bloque (Build Macro) pesa más: empieza más oscuro y recorre más gris, así
    // que se lee como cabecera y los subheaders de grupo quedan por debajo en jerarquía.
    headerMain: { from: "#8a8a8a", to: "#dcdcdc", cell: 2, hold: 0.15, stops: 8, defaultSize: [560, 26] },
    greySoft: { from: "#bcbcbc", to: "#d0d0d0", cell: 4, hold: 0.5, stops: 6, defaultSize: [520, 140] },
    greyDark: { from: "#20282a", to: "#333d40", cell: 3, hold: 0.4, stops: 6, defaultSize: [520, 140] },
    headerMainDark: { from: "#171d1f", to: "#33403f", cell: 2, hold: 0.15, stops: 8, defaultSize: [560, 26] },
    green: { from: "#0e3a2a", to: "#1f6448", cell: 2, hold: 0.3, stops: 6, defaultSize: [320, 20] },
    brand: { from: "#000060", to: "#2f9bd8", cell: 2, hold: 0, stops: 10 },
    // Resaltado de las filas de macro: el azul plano del listado, con su rampa.
    row: { from: "#000080", to: "#2a6fc4", cell: 2, hold: 0.35, stops: 6, defaultSize: [720, 22] },
    rowDark: { from: "#153e30", to: "#1f6448", cell: 2, hold: 0.35, stops: 6, defaultSize: [720, 22] },
    rowMulti: { from: "#cfe0fb", to: "#eaf1fe", cell: 2, hold: 0.3, stops: 5, defaultSize: [720, 22] },
    rowMultiDark: { from: "#182e22", to: "#234232", cell: 2, hold: 0.3, stops: 5, defaultSize: [720, 22] },
    // El escritorio: mismo teal de siempre, pero con la rampa tramada que pidió el operador.
    // El escritorio va en diagonal: en horizontal se veía plano y pobre.
    desk: { from: "#004242", to: "#1ab6b6", cell: 4, hold: 0.1, stops: 10, diagonal: true },
    deskDark: { from: "#071414", to: "#0d3531", cell: 4, hold: 0.15, stops: 10, diagonal: true },
  };

  const cache = new Map();
  // The key carries the element's size, so scrubbing a window edge or the column resizer used to add
  // one full-canvas PNG per pixel step and nothing ever left the map: a session's work of resizing
  // stayed in memory for the life of the window. The map is bounded (oldest out first, and the
  // oldest entries are exactly the ones of the sizes the operator has already left behind) and the
  // budget is in data-URL characters, which is what the URLs really cost (master plan 2026-09-22,
  // §8: "Dither PNG cache with no cap or eviction").
  const CACHE_MAX_ENTRIES = 64;
  const CACHE_MAX_CHARS = 12 * 1024 * 1024;
  let cacheChars = 0;

  function cacheGet(key) {
    if (!cache.has(key)) return undefined;
    const value = cache.get(key);
    // Re-inserting moves the entry to the end of the Map's iteration order: the least recently used
    // is always the first key, which is the shape the prewarmed sizes need to survive a drag.
    cache.delete(key);
    cache.set(key, value);
    return value;
  }

  function cacheSet(key, value) {
    const previous = cache.get(key);
    if (previous != null) {
      cacheChars -= previous.length;
      cache.delete(key);
    }
    cache.set(key, value);
    cacheChars += value.length;
    while (cache.size > CACHE_MAX_ENTRIES || cacheChars > CACHE_MAX_CHARS) {
      const oldest = cache.keys().next();
      if (oldest.done) break;
      const evicted = cache.get(oldest.value);
      cacheChars -= evicted.length;
      cache.delete(oldest.value);
    }
  }
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: false });

  function parseHex(value) {
    const hex = String(value || "").replace("#", "");
    const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
    const num = Number.parseInt(full, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }

  function toHex(rgb) {
    return "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  }

  function mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  /**
   * Rampa tramada como data URL PNG del tamaño pedido (en píxeles de patrón).
   *
   * @param {string} from color de partida (el oscuro)
   * @param {string} to color de llegada (el claro)
   * @param {number} width ancho del patrón en píxeles
   * @param {number} height alto del patrón en píxeles
   * @param {{cell?: number, hold?: number, stops?: number}} options
   * @returns {string} data URL
   */
  function ramp(from, to, width, height, options) {
    const opts = options || {};
    const cell = Math.max(1, Math.round(opts.cell || 3));
    const hold = Math.max(0, Math.min(0.9, opts.hold == null ? 0.25 : opts.hold));
    const stops = Math.max(2, Math.round(opts.stops || 8));
    const diagonal = opts.diagonal === true;
    const cols = Math.max(1, Math.round(width / cell));
    const rows = Math.max(1, Math.round(height / cell));
    const key = [from, to, cols, rows, hold, stops, diagonal ? "d" : "h"].join("|");
    const cached = cacheGet(key);
    if (cached !== undefined) return cached;

    canvas.width = cols;
    canvas.height = rows;
    const a = parseHex(from);
    const b = parseHex(to);
    const list = Array.from({ length: stops }, (_, i) => mix(a, b, i / (stops - 1)));

    for (let x = 0; x < cols; x++) {
      for (let y = 0; y < rows; y++) {
      // En diagonal la posición mezcla los dos ejes: oscuro arriba a la izquierda, claro abajo a la
      // derecha. Sólo se usa donde no hay texto que proteger (el escritorio).
      const base = diagonal
        ? ((x / Math.max(1, cols - 1)) + (y / Math.max(1, rows - 1))) / 2
        : (cols > 1 ? x / (cols - 1) : 0);
      let t = base <= hold ? 0 : (base - hold) / (1 - hold);
      t = t * t * (3 - 2 * t); // curva suave: el brillo entra sin costura al salir de la retención
      const pos = t * (stops - 1);
      const index = Math.min(Math.floor(pos), stops - 2);
      const local = pos - index;
      const colourA = toHex(list[index]);
      const colourB = toHex(list[index + 1]);
        ctx.fillStyle = (BAYER4[y % 4][x % 4] / 16) < local ? colourB : colourA;
        ctx.fillRect(x, y, 1, 1);
      }
    }

    const url = canvas.toDataURL("image/png");
    cacheSet(key, url);
    return url;
  }

  /**
   * Glow tramado radial, para la decoración del About. El radial se tramita igual que la rampa: sin
   * él, un halo suave sería un degradado moderno y no pegaría con el resto.
   */
  function radialGlow(colour, size, options) {
    const opts = options || {};
    const cell = Math.max(1, Math.round(opts.cell || 3));
    const cols = Math.max(1, Math.round(size / cell));
    const rows = cols;
    const key = ["glow", colour, cols, opts.strength || 0.55].join("|");
    const cached = cacheGet(key);
    if (cached !== undefined) return cached;

    canvas.width = cols;
    canvas.height = rows;
    const rgb = parseHex(colour);
    const strength = opts.strength == null ? 0.55 : opts.strength;
    const centre = (cols - 1) / 2;
    const maxDistance = Math.hypot(centre, centre) || 1;
    for (let x = 0; x < cols; x++) {
      for (let y = 0; y < rows; y++) {
        const distance = Math.hypot(x - centre, y - centre) / maxDistance;
        const intensity = Math.max(0, 1 - distance) * strength;
        ctx.fillStyle = (BAYER4[y % 4][x % 4] / 16) < intensity ? toHex(rgb) : "#00000000";
        ctx.fillRect(x, y, 1, 1);
      }
    }
    const url = canvas.toDataURL("image/png");
    cacheSet(key, url);
    return url;
  }

  // Anchuras habituales de las barras de título, para que al abrir cualquiera de ellas el patrón ya
  // esté generado y no se vea el azul plano durante un fotograma.
  const NAVY_WIDTHS = [380, 420, 520, 760];

  function presetFor(name, dark) {
    if (name === "navy") return dark ? PRESETS.navyDark : PRESETS.navy;
    if (name === "grey") return dark ? PRESETS.greyDark : PRESETS.grey;
    if (name === "greySoft") return dark ? PRESETS.greyDark : PRESETS.greySoft;
    if (name === "headerMain") return dark ? PRESETS.headerMainDark : PRESETS.headerMain;
    if (name === "row") return dark ? PRESETS.rowDark : PRESETS.row;
    if (name === "rowMulti") return dark ? PRESETS.rowMultiDark : PRESETS.rowMulti;
    // El escritorio también tiene variante oscura. Faltaba este caso, así que el fondo se quedaba con
    // la rampa clara al cambiar de tema: el preset oscuro existía pero nunca se elegía.
    if (name === "desk") return dark ? PRESETS.deskDark : PRESETS.desk;
    return PRESETS[name] || PRESETS.navy;
  }

  /**
   * Asigna la trama a una superficie. Va como `important` porque los resaltados de lista declaran
   * `background: #000080 !important` y un estilo en línea normal perdería contra ellos.
   */
  function setSurface(element, url) {
    element.style.setProperty("background-image", 'url("' + url + '")', "important");
    element.style.setProperty("background-size", "100% 100%", "important");
    element.style.setProperty("background-repeat", "no-repeat", "important");
    element.style.setProperty("image-rendering", "pixelated", "important");
  }

  function isDarkTheme() {
    return document.body.classList.contains("theme-dark");
  }

  /**
   * Pinta una superficie con su rampa y devuelve `true` si la ha cambiado (para no repintar en cada
   * pasada cuando el tamaño no ha variado).
   */
  function paint(element, presetName, overrides) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 4) return false;
    const preset = Object.assign({}, presetFor(presetName, isDarkTheme()), overrides || {});
    const key = [presetName, Math.round(rect.width), Math.round(rect.height), isDarkTheme()].join("|");
    if (element.dataset.ditherKey === key) return false;
    setSurface(element, ramp(preset.from, preset.to, rect.width, rect.height, preset));
    element.dataset.ditherKey = key;
    return true;
  }

  /**
   * Superficies de la ventana que llevan trama. Se declaran aquí y no en el marcado para que
   * cualquier elemento nuevo con la misma clase la herede sin tocar nada más.
   */
  const SURFACES = [
    { selector: ".win95-dialog-titlebar", preset: "navy" },
    // `.hud-alert-titlebar` NO va aquí: `setSurface` escribe `background-image` en línea con
    // `!important`, que gana a la hoja, así que la trama navy tapaba el color por urgencia
    // (granate de pánico, ocre de aviso, verde de aviso, acento personalizado) y todas las alertas
    // salían iguales; encima el texto rojo de pánico quedaba a 1,37-2,92:1. Las barras de título
    // clásicas son planas, así que el color de la hoja es además lo correcto. Auditoría 2026-09-22.
    { selector: ".card-draggable.is-floating-window .card-header", preset: "navy" },
    { selector: ".card-header", preset: "grey" },
    { selector: ".wc-heading", preset: "grey" },
    { selector: ".builder-panel > .section-head", preset: "headerMain" },
    { selector: ".workflow-head.section-head", preset: "grey" },
    { selector: ".bridge-sidebar-head", preset: "grey" },
    { selector: ".macro-row.selected", preset: "row" },
    { selector: ".wc-selected-row", preset: "row" },
    // El estado activo de la fila de macros lleva la misma trama que el resto (el preset verde
    // existía y no lo usaba nadie): un degradado suave ahí desentonaba con la ventana.
    { selector: ".macro-enable-button.enabled", preset: "green" },
    // Los pasos del macro y las puertas IF comparten la clase `.step-row` (las condiciones se pintan
    // como `step-row condition-row`), así que una sola entrada cubre las dos listas.
    { selector: ".step-row.selected", preset: "row" },
    { selector: ".macro-row.multi-selected:not(.selected)", preset: "rowMulti" },
  ];

  /**
   * La decoración del About: banda de marca y halo tramado tras el logo. Van aparte porque no son
   * "superficies con trama" como las barras: son dos piezas decorativas con su propio tamaño.
   */
  function paintGlow(wrap) {
    const rect = wrap.getBoundingClientRect();
    if (rect.width < 8) return;
    const size = Math.max(rect.width, rect.height) + 12;
    const key = "glow|" + Math.round(size) + "|" + isDarkTheme();
    if (wrap.dataset.ditherGlow === key) return;
    wrap.style.setProperty("--about-glow", 'url("' + radialGlow(isDarkTheme() ? "#1f7a55" : "#1084d0", size, { cell: 3, strength: 0.6 }) + '")');
    wrap.dataset.ditherGlow = key;
  }

  function paintAbout() {
    const band = document.getElementById("about-brand-band");
    if (band) tag(band, "brand", { hold: 0 });
    const wrap = document.querySelector(".win95-about-logo-wrap");
    if (wrap) {
      observe(wrap);
      paintGlow(wrap);
    }
  }

  /**
   * El fondo del escritorio. Se genera para el tamaño de la VENTANA y se fija (`fixed`), así que no
   * se regenera al crecer el contenido ni se desplaza al hacer scroll: sólo cambia al redimensionar.
   */
  /**
   * Which ramp the window's background gets.
   *
   * The window can ask for one explicitly (`body.dataset.deskMode`: `light`, `dark` or `solid`), because
   * the operator chooses the background independently of the theme: a dark UI over the light gradient, or
   * a flat colour with no pattern at all (owner, 2026-10-02). `auto` — and no value at all — keeps the
   * original rule of following the theme.
   */
  function deskPreset() {
    const mode = document.body.dataset.deskMode || "auto";
    if (mode === "solid") return null;
    if (mode === "light") return PRESETS.desk;
    if (mode === "dark") return PRESETS.deskDark;
    return presetFor("desk", isDarkTheme());
  }

  function paintDesk() {
    const preset = deskPreset();
    const mode = document.body.dataset.deskMode || "auto";
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (!preset) {
      // A flat colour is the window's own business; the ramp steps aside and is cleared once.
      const solidKey = ["desk", "solid", width, height].join("|");
      if (document.body.dataset.ditherDesk === solidKey) return false;
      document.body.style.backgroundImage = "none";
      document.body.style.imageRendering = "";
      document.body.dataset.ditherDesk = solidKey;
      return true;
    }
    const key = ["desk", mode, width, height, isDarkTheme()].join("|");
    if (document.body.dataset.ditherDesk === key) return false;
    document.body.style.backgroundImage = 'url("' + ramp(preset.from, preset.to, width, height, preset) + '")';
    document.body.style.backgroundSize = "100% 100%";
    document.body.style.backgroundRepeat = "no-repeat";
    document.body.style.backgroundAttachment = "fixed";
    document.body.style.imageRendering = "pixelated";
    document.body.dataset.ditherDesk = key;
    return true;
  }

  /**
   * Prepinta las superficies al arrancar, incluidas las que aún no tienen layout (diálogos cerrados,
   * pestañas ocultas). Sin esto, cada ventana aparecía primero con su color plano y el patrón entraba
   * un fotograma después: se veía un parpadeo. Con el tamaño canónico ya asignado, cuando el elemento
   * aparece su fondo está puesto, y el ResizeObserver sólo lo ajusta al tamaño real (que suele
   * coincidir, así que sale de caché).
   */
  function prewarm(root) {
    const scope = root || document;
    let warmed = 0;
    for (const surface of SURFACES) {
      for (const element of scope.querySelectorAll(surface.selector)) {
        const preset = presetFor(surface.preset, isDarkTheme());
        const [width, height] = preset.defaultSize || [380, 23];
        const apply1 = (w) => {
          setSurface(element, ramp(preset.from, preset.to, w, height, preset));
          warmed += 1;
        };
        apply1(width);
        if (surface.preset === "navy") for (const w of NAVY_WIDTHS) ramp(preset.from, preset.to, w, height, preset);
        delete element.dataset.ditherKey;
      }
    }
    if (isDarkTheme() === false) {
      // Los presets oscuros se preparan también, para que cambiar de tema no genere nada en caliente.
      for (const name of ["navyDark", "greyDark", "rowDark", "rowMultiDark", "deskDark"]) {
        const preset = PRESETS[name];
        const [width, height] = preset.defaultSize || [380, 23];
        ramp(preset.from, preset.to, width, height, preset);
      }
    }
    return warmed;
  }

  function apply(root) {
    const scope = root || document;
    let painted = 0;
    if (paintDesk()) painted += 1;
    for (const surface of SURFACES) {
      for (const element of scope.querySelectorAll(surface.selector)) {
        // Una barra de título de un diálogo dentro de una tarjeta flotante ya lleva la suya.
        if (surface.preset === "grey" && element.closest(".is-floating-window")) continue;
        observe(element);
        if (paint(element, surface.preset, surface.overrides)) painted += 1;
      }
    }
    paintAbout();
    return painted;
  }

  // Un diálogo oculto mide 0x0, así que la trama se pinta cuando aparece: el ResizeObserver avisa
  // justo en ese momento, y así no hay que tocar cada función que abre un diálogo.
  const observed = new WeakSet();
  let observer = null;
  function observe(element) {
    if (observed.has(element)) return;
    observed.add(element);
    if (typeof ResizeObserver !== "function") return;
    if (!observer) {
      observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const name = entry.target.dataset.ditherPreset;
          if (name) {
            delete entry.target.dataset.ditherKey;
            paint(entry.target, name, PRESET_OVERRIDES[name]);
          } else if (entry.target.classList.contains("win95-about-logo-wrap")) {
            delete entry.target.dataset.ditherGlow;
            paintGlow(entry.target);
          }
        }
      });
    }
    observer.observe(element);
  }

  const PRESET_OVERRIDES = {};
  function tag(element, presetName, overrides) {
    element.dataset.ditherPreset = presetName;
    if (overrides) PRESET_OVERRIDES[presetName] = overrides;
    observe(element);
    return paint(element, presetName, overrides);
  }

  let pending = 0;
  function schedule(ms) {
    window.clearTimeout(pending);
    pending = window.setTimeout(() => {
      document.querySelectorAll("[data-dither-key]").forEach((el) => delete el.dataset.ditherKey);
      delete document.body.dataset.ditherDesk;
      apply();
    }, ms || 120);
  }

  function watch() {
    window.addEventListener("resize", () => schedule(160));
    // La biblioteca de macros se pinta después de este módulo (llega del backend), así que las filas
    // podían quedarse sin trama hasta que algo las volviera a tocar: al abrir la ventana se veía el
    // azul plano y el degradado solo aparecía al seleccionar. Tres repasos baratos al arrancar cubren
    // ese primer pintado, y el observador se encarga de todo lo que venga después.
    [0, 300, 1200].forEach((delay) => {
      window.setTimeout(() => {
        document.querySelectorAll("[data-dither-key]").forEach((el) => delete el.dataset.ditherKey);
        apply();
      }, delay);
    });
    // Las filas de macro y los paneles se rehacen a menudo: se repinta sin coste porque `paint`
    // ignora lo que no ha cambiado de tamaño.
    if (typeof MutationObserver === "function") {
      const mutations = new MutationObserver(() => schedule(200));
      // `attributes` con filtro de clase: seleccionar una fila de macro (o marcar una casilla) cambia
      // la clase, no el árbol, y sin esto el resaltado se quedaba con el azul plano.
      mutations.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class"],
      });
    }
  }

  /// What the pattern cache is holding. Exposed because the bound is a contract that has to be
  /// measurable from a test (and from a page-side instrument): entries, characters and the caps.
  function cacheStats() {
    return {
      entries: cache.size,
      chars: cacheChars,
      maxEntries: CACHE_MAX_ENTRIES,
      maxChars: CACHE_MAX_CHARS,
    };
  }

  window.WingDither = { ramp, radialGlow, paint: tag, apply, prewarm, watch, cacheStats, presets: PRESETS };
})();
