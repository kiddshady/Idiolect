/* ═══════════════════════════════════════════════════════════════════════════
   IDIOLECT — el glosario de Fran
   Una lista de expresiones a la izquierda y el editor de la elegida a la
   derecha. Todo guardado termina regenerando data/glosario.md (lo hace el
   proceso principal), que es lo que lee Claude Code al arrancar cada sesión.

   Las entradas también llegan de afuera: Claude anota con tools/anotar.cjs.
   Por eso la vista no se pinta una sola vez: escucha `glosario.onCambio` y
   recarga, cuidando de no pisar el campo que Fran está escribiendo.
   ═══════════════════════════════════════════════════════════════════════════ */

import { Icons } from './icons.js';
import { Tooltip, Toast, Modal } from './overlays.js';
import Router from './router.js';
import { initClickFlash, initScrollFades, raf2 } from './motion.js';
import { esc, paint, head, empty, mark, attempt, copy, colorToken, path } from './ui.js';
import { relTime, plural, fmtBytes } from './format.js';

const api = window.onyx;
const entradas = api.col('entradas');

Icons.add({
  /* Un círculo punteado con el centro lleno: algo que está, pero sin cerrar. */
  review: '<circle cx="8" cy="8" r="5.8" stroke-dasharray="2.3 2.1"/><circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none"/>',
});

/* ══ Datos ═══════════════════════════════════════════════════════════════════ */

const S = {
  info: null,
  entradas: [],
  sel: null,          // id de la entrada abierta en el editor
  q: '',              // búsqueda
  tag: null,          // etiqueta filtrada
  exportado: null,    // cuándo se regeneró glosario.md por última vez
};

/** Igual que plegar() de glosario.cjs: buscar «catedra» encuentra «cátedra». */
const plegar = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

const orden = (a, b) => a.expresion.localeCompare(b.expresion, 'es', { sensitivity: 'base' });
const entrada = (id) => S.entradas.find((e) => e.id === id) || null;
const pendientes = () => S.entradas.filter((e) => !e.confirmada);

async function cargar() {
  S.entradas = (await entradas.list()).sort(orden);
  S.exportado = Date.now();
  if (S.sel && !entrada(S.sel)) S.sel = null;
}

async function guardar(e) {
  const saved = await entradas.save({ ...e, updatedAt: Date.now() });
  S.entradas = [saved, ...S.entradas.filter((x) => x.id !== saved.id)].sort(orden);
  S.exportado = Date.now();
  actualizarMarco();
  return saved;
}

/* ══ Crear ═══════════════════════════════════════════════════════════════════ */

async function nuevaEntrada() {
  const body = document.createElement('div');
  body.className = 'ox-col';
  body.style.gap = '16px';
  body.innerHTML = `
    <div class="ox-field">
      <label class="ox-field__label">Expresión</label>
      <input class="ox-input" id="f-expr" placeholder="Tal como la decís" spellcheck="false">
    </div>
    <div class="ox-field">
      <label class="ox-field__label">Qué significa</label>
      <textarea class="ox-textarea" id="f-sig" rows="3"></textarea>
    </div>
    <div class="ox-field">
      <label class="ox-field__label">Ejemplo</label>
      <input class="ox-input" id="f-ej" placeholder="Opcional: una frase donde la usaste">
    </div>`;

  const ok = await Modal.show({
    title: 'Nueva expresión',
    sub: 'Entra confirmada: la escribiste vos.',
    body,
    width: 480,
    actions: [
      { label: 'Cancelar', value: null },
      { label: 'Agregar', value: true, variant: 'primary', autofocus: true },
    ],
  });
  if (!ok) return;

  const expresion = body.querySelector('#f-expr').value.trim();
  const significa = body.querySelector('#f-sig').value.trim();
  if (!expresion || !significa) {
    Toast.error('Falta completar', 'Hacen falta la expresión y qué significa.');
    return;
  }
  const repetida = S.entradas.find((e) => plegar(e.expresion) === plegar(expresion));
  if (repetida) {
    Toast.show({ title: 'Ya estaba', text: `«${repetida.expresion}» ya está en el glosario.`, icon: 'info' });
    abrir(repetida.id);
    return;
  }

  await attempt(async () => {
    const saved = await guardar({
      id: await entradas.nextId('e'),
      expresion, significa,
      ejemplo: body.querySelector('#f-ej').value.trim(),
      notas: '', etiquetas: [], confirmada: true, origen: 'fran', createdAt: Date.now(),
    });
    Toast.show({ title: 'Agregada', text: saved.expresion, icon: 'check' });
    abrir(saved.id);
  }, { errorTitle: 'No se pudo agregar' });
}

/** Lleva al glosario con la entrada abierta, venga de donde venga. */
function abrir(id) {
  S.sel = id;
  S.q = '';
  S.tag = null;
  if (Router.name === 'glosario') { renderFiltros(); renderLista(); renderEditor(); syncBuscador(); }
  else Router.go('glosario');
}

/* ══ Vista: glosario / por revisar ═══════════════════════════════════════════ */

const MODOS = {
  glosario: { title: 'Glosario', filtro: () => true },
  revisar: { title: 'Por revisar', filtro: (e) => !e.confirmada },
};

function viewGlosario() {
  const modo = MODOS[Router.name];
  if (S.sel && !modo.filtro(entrada(S.sel) || {})) S.sel = null;

  paint(head({
    title: modo.title,
    sub: subtitulo(),
    actions: `
      <div class="ox-inputwrap id-search">
        <i data-icon="search"></i>
        <input class="ox-input" id="buscar" placeholder="Buscar" spellcheck="false" autocomplete="off">
      </div>`,
  }) + `
    <div class="ox-viewbody">
      <div class="ox-viewbody__main">
        <div class="id-filtros" id="filtros"></div>
        <div class="ox-scroll ox-grow" id="lista-scroll"><div id="lista"></div></div>
      </div>
      <aside class="ox-inspector id-editor" id="editor"></aside>
    </div>`);

  const buscar = document.getElementById('buscar');
  buscar.value = S.q;
  buscar.addEventListener('input', () => { S.q = buscar.value; renderLista(); });
  buscar.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && buscar.value) { ev.stopPropagation(); buscar.value = ''; S.q = ''; renderLista(); }
  });

  renderFiltros();
  renderLista();
  renderEditor();
}

function subtitulo() {
  const n = pendientes().length;
  return Router.name === 'revisar'
    ? (n ? `${plural(n, 'borrador', 'borradores')} de Claude para confirmar o corregir` : 'Nada pendiente')
    : `${plural(S.entradas.length, 'expresión', 'expresiones')}${n ? ` · ${n} sin confirmar` : ''}`;
}

function syncBuscador() {
  const b = document.getElementById('buscar');
  if (b) b.value = S.q;
}

function visibles() {
  const modo = MODOS[Router.name] || MODOS.glosario;
  const q = plegar(S.q);
  return S.entradas.filter((e) => modo.filtro(e)
    && (!S.tag || (e.etiquetas || []).includes(S.tag))
    && (!q || plegar([e.expresion, e.significa, e.ejemplo, e.notas, ...(e.etiquetas || [])].join(' ')).includes(q)));
}

function renderFiltros() {
  const host = document.getElementById('filtros');
  if (!host) return;
  const conteo = new Map();
  for (const e of S.entradas) for (const t of e.etiquetas || []) conteo.set(t, (conteo.get(t) || 0) + 1);
  if (S.tag && !conteo.has(S.tag)) S.tag = null;
  const tags = [...conteo.keys()].sort((a, b) => a.localeCompare(b, 'es'));
  host.innerHTML = tags.map((t) => `
    <button class="id-tag${S.tag === t ? ' is-on' : ''}" data-tag="${esc(t)}">
      ${esc(t)}<span class="id-tag__n ox-num">${conteo.get(t)}</span>
    </button>`).join('');
  host.classList.toggle('is-empty', !tags.length);
}

function renderLista() {
  const host = document.getElementById('lista');
  if (!host) return;
  const lista = visibles();

  if (!S.entradas.length) {
    host.innerHTML = empty({
      icon: 'book',
      title: 'El glosario está vacío',
      text: 'Agregá una expresión con el botón del costado, o pedile a Claude que anote una desde el chat.',
    });
    return;
  }
  if (!lista.length) {
    host.innerHTML = `<div class="id-nada ox-meta">${
      S.q || S.tag ? 'Ninguna expresión coincide con el filtro.' : 'No hay borradores pendientes.'}</div>`;
    return;
  }

  host.innerHTML = `<div class="ox-list">${lista.map((e) => `
    <div class="ox-listitem id-row${e.id === S.sel ? ' is-selected' : ''}" role="button" tabindex="0" data-entrada="${esc(e.id)}">
      ${mark(e.confirmada ? 'done' : 'waiting')}
      <div class="ox-listitem__main">
        <span class="ox-listitem__title">${esc(e.expresion)}</span>
        <span class="ox-listitem__sub">${esc(e.significa)}</span>
      </div>
      <div class="ox-listitem__aside">
        ${(e.etiquetas || []).slice(0, 2).map((t) => `<span class="ox-chip">${esc(t)}</span>`).join('')}
      </div>
    </div>`).join('')}</div><div style="height:24px"></div>`;
}

/* ── El editor ───────────────────────────────────────────────────────────────
   Cada campo se guarda al salir de él, no en cada tecla: cada guardado
   reescribe glosario.md, y 200 escrituras por párrafo no le suman nada. */

const CAMPOS = [
  { k: 'expresion', label: 'Expresión', tipo: 'input' },
  { k: 'significa', label: 'Qué significa', tipo: 'area', rows: 4 },
  { k: 'ejemplo', label: 'Ejemplo', tipo: 'area', rows: 2, hint: 'Una frase real donde la usaste.' },
  { k: 'notas', label: 'Notas', tipo: 'area', rows: 2, hint: 'Cuándo la usás, con qué tono, con qué no confundirla.' },
  { k: 'etiquetas', label: 'Etiquetas', tipo: 'input', hint: 'Separadas por coma.' },
];

const NOTA_CONFIRMADA = {
  true: 'Claude la usa tal cual.',
  false: 'Claude la lee con reserva hasta que la confirmes.',
};

function renderEditor() {
  const host = document.getElementById('editor');
  if (!host) return;
  const e = entrada(S.sel);

  if (!e) {
    host.innerHTML = `<div class="id-editor__vacio">
      ${Icons.svg('edit', 'ox-icon--lg')}
      <span class="ox-meta">Elegí una expresión para verla y editarla.</span></div>`;
    return;
  }

  const valor = (k) => (k === 'etiquetas' ? (e.etiquetas || []).join(', ') : e[k] || '');
  host.innerHTML = `
    <div class="ox-inspector__head">
      <div class="ox-grow" style="min-width:0">
        <div class="ox-truncate id-editor__titulo">${esc(e.expresion)}</div>
        <div class="ox-meta">${e.origen === 'claude' ? 'Borrador de Claude' : 'Tuya'} · ${esc(relTime(e.updatedAt))}</div>
      </div>
    </div>
    <div class="ox-inspector__body ox-scroll">
      <div class="ox-row id-confirmar">
        <button class="ox-switch${e.confirmada ? ' is-on' : ''}" id="confirmada" aria-label="Confirmada"></button>
        <span class="ox-col" style="gap:2px">
          <span class="ox-label">Confirmada</span>
          <span class="ox-meta" id="nota-confirmada">${NOTA_CONFIRMADA[Boolean(e.confirmada)]}</span>
        </span>
      </div>
      ${CAMPOS.map((c) => `
        <div class="ox-field">
          <label class="ox-field__label" for="c-${c.k}">${c.label}</label>
          ${c.tipo === 'input'
            ? `<input class="ox-input" id="c-${c.k}" data-campo="${c.k}" spellcheck="false" value="${esc(valor(c.k))}">`
            : `<textarea class="ox-textarea" id="c-${c.k}" data-campo="${c.k}" rows="${c.rows}">${esc(valor(c.k))}</textarea>`}
          ${c.hint ? `<span class="ox-field__hint">${c.hint}</span>` : ''}
        </div>`).join('')}
    </div>
    <div class="ox-inspector__foot">
      <button class="ox-btn ox-btn--ghost ox-btn--sm ox-grow" id="copiar-linea"><i data-icon="copy"></i> Copiar como la lee Claude</button>
      <button class="ox-btn ox-btn--danger ox-btn--sm" id="borrar"><i data-icon="trash"></i> Eliminar</button>
    </div>`;
  Icons.mount(host);
  initScrollFades(host);

  // Los nodos mueren con el próximo renderEditor(): los listeners se van con ellos.
  host.querySelectorAll('[data-campo]').forEach((el) => {
    el.addEventListener('change', () => guardarCampo(e.id, el.dataset.campo, el));
  });
  host.querySelector('#confirmada').addEventListener('click', (ev) => {
    const on = !ev.currentTarget.classList.contains('is-on');
    ev.currentTarget.classList.toggle('is-on', on);
    guardarCampo(e.id, 'confirmada', null, on);
  });
  host.querySelector('#copiar-linea').addEventListener('click', () => copy(lineaMd(entrada(e.id))));
  host.querySelector('#borrar').addEventListener('click', () => borrar(e.id));
}

/* Los guardados del editor van en fila. Salir de «Notas» con Tab y tocar
   «Etiquetas» dispara dos guardados casi juntos; si corrieran a la vez, el
   segundo partiría de la entrada SIN las notas nuevas y las pisaría. En fila,
   cada uno lee la entrada recién cuando le toca, con lo del anterior adentro. */
let colaGuardado = Promise.resolve();

function guardarCampo(...args) {
  const turno = colaGuardado.then(() => guardarCampoAhora(...args));
  colaGuardado = turno.catch(() => {});
  return turno;
}

async function guardarCampoAhora(id, campo, el, valorDirecto) {
  const e = entrada(id);
  if (!e) return;
  let v = el ? el.value : valorDirecto;

  if (campo === 'etiquetas') {
    v = [...new Set(String(v).split(',').map(plegar).filter(Boolean))];
  } else if (typeof v === 'string') {
    v = v.trim();
  }
  if (campo === 'expresion') {
    if (!v) { el.value = e.expresion; Toast.error('La expresión no puede quedar vacía'); return; }
    const otra = S.entradas.find((x) => x.id !== id && plegar(x.expresion) === plegar(v));
    if (otra) { el.value = e.expresion; Toast.error('Ya existe', `«${otra.expresion}» ya está en el glosario.`); return; }
  }
  if (campo === 'significa' && !v) { el.value = e.significa; Toast.error('Falta qué significa'); return; }

  const saved = await attempt(() => guardar({ ...e, [campo]: v }), { errorTitle: 'No se pudo guardar' });
  if (!saved) return;
  if (campo === 'etiquetas' && el) el.value = saved.etiquetas.join(', ');
  renderFiltros();
  // Confirmar desde «Por revisar» la saca de la lista, pero el editor la sigue
  // mostrando hasta que se elija otra: el click no hace desaparecer lo que se
  // está mirando.
  renderLista();
  const titulo = document.querySelector('.id-editor__titulo');
  if (titulo) titulo.textContent = saved.expresion;
  const nota = document.getElementById('nota-confirmada');
  if (nota) nota.textContent = NOTA_CONFIRMADA[Boolean(saved.confirmada)];
  const sub = document.querySelector('.ox-viewhead__sub');
  if (sub) sub.textContent = subtitulo();
}

/** La misma línea que escribe glosario.cjs, para pegarla en otro lado. */
function lineaMd(e) {
  let s = `- **${e.expresion}** — ${/[.!?…)»]$/.test(e.significa) ? e.significa : `${e.significa}.`}`;
  if (e.ejemplo) s += ` Ej.: «${e.ejemplo}».`;
  if (e.notas) s += ` (${e.notas})`;
  if (e.etiquetas?.length) s += ` [${e.etiquetas.join(', ')}]`;
  if (!e.confirmada) s += ' _sin confirmar_';
  return s;
}

async function borrar(id) {
  const e = entrada(id);
  if (!e) return;
  const ok = await Modal.confirm({
    title: `¿Eliminar «${e.expresion}»?`,
    sub: 'Sale del glosario y Claude deja de leerla desde la próxima sesión.',
    confirmLabel: 'Eliminar',
    danger: true,
  });
  if (!ok) return;
  const hecho = await attempt(async () => { await entradas.remove(id); return true; }, { errorTitle: 'No se pudo eliminar' });
  if (!hecho) return;
  S.entradas = S.entradas.filter((x) => x.id !== id);
  S.sel = null;
  S.exportado = Date.now();
  Toast.show({ title: 'Eliminada', text: e.expresion, icon: 'trash' });
  actualizarMarco();
  renderFiltros();
  renderLista();
  renderEditor();
}

/* ══ Vista: ajustes ══════════════════════════════════════════════════════════ */

function viewAjustes() {
  const md = S.info?.glosario || '';
  const importar = `@${md.replace(/\\/g, '/')}`;
  const cli = 'node S:\\tools\\Idiolect\\tools\\anotar.cjs --expresion "…" --significa "…"';

  paint(head({ title: 'Ajustes', sub: 'Dónde vive el glosario y cómo le llega a Claude' }) + `
    <div class="ox-scroll ox-grow">
      <div style="max-width:640px">

        <div class="ox-section">
          <div class="ox-section__head"><span class="ox-section__title">Glosario para Claude</span></div>
          <div class="ox-card"><div class="ox-card__body ox-col" style="gap:14px">
            <div class="ox-kv">
              <span class="ox-kv__k">Archivo</span>
              <span class="ox-kv__v ox-mono ox-copyable" data-tip="${esc(md)}">${path(md)}</span>
              <span class="ox-kv__k">Regenerado</span>
              <span class="ox-kv__v" id="aj-exportado">${esc(S.exportado ? relTime(S.exportado) : '—')}</span>
            </div>
            <p class="ox-meta id-parrafo">
              Se reescribe cada vez que guardás. El CLAUDE.md global lo importa con esta línea,
              así Claude Code lo lee al empezar cada sesión:
            </p>
            <div class="id-codigo ox-mono ox-copyable">${esc(importar)}</div>
            <div class="ox-row" style="gap:8px">
              <button class="ox-btn ox-btn--secondary ox-btn--sm" data-copy="${esc(importar)}"><i data-icon="copy"></i> Copiar línea</button>
              <button class="ox-btn ox-btn--ghost ox-btn--sm" id="regenerar"><i data-icon="retry"></i> Regenerar ahora</button>
            </div>
          </div></div>
        </div>

        <div class="ox-section">
          <div class="ox-section__head"><span class="ox-section__title">Anotar desde el chat</span></div>
          <div class="ox-card"><div class="ox-card__body ox-col" style="gap:14px">
            <p class="ox-meta id-parrafo">
              Cuando le decís a Claude «anotá que X significa Y», usa este comando. Lo que anota
              por su cuenta entra sin confirmar y aparece en Por revisar. Si la app está abierta,
              la lista se actualiza sola.
            </p>
            <div class="id-codigo ox-mono ox-copyable">${esc(cli)}</div>
          </div></div>
        </div>

        <div class="ox-section">
          <div class="ox-section__head"><span class="ox-section__title">Datos</span></div>
          <div class="ox-card"><div class="ox-card__body">
            <div class="ox-kv">
              <span class="ox-kv__k">Carpeta</span>
              <span class="ox-kv__v ox-mono ox-copyable" data-tip="${esc(S.info?.dataDir || '')}">${path(S.info?.dataDir || '')}</span>
              <span class="ox-kv__k">Entradas</span><span class="ox-kv__v ox-num">${S.entradas.length}</span>
              <span class="ox-kv__k">App</span><span class="ox-kv__v">${esc(S.info?.name || '—')} ${esc(S.info?.version || '')}</span>
              <span class="ox-kv__k">Electron</span><span class="ox-kv__v ox-mono">${esc(S.info?.electron || '—')}</span>
            </div>
            <div class="ox-row" style="gap:8px;margin-top:14px">
              <button class="ox-btn ox-btn--secondary ox-btn--sm" id="buscar-updates"><i data-icon="retry"></i> Buscar actualizaciones</button>
            </div>
            <p class="ox-meta id-parrafo" style="margin-top:14px">
              Un archivo JSON por expresión en la subcarpeta <span class="ox-mono">entradas</span>. Si editás
              uno a mano, la app lo detecta y regenera el glosario.
            </p>
          </div></div>
        </div>

      </div>
      <div style="height:32px"></div>
    </div>`);

  document.getElementById('buscar-updates').addEventListener('click', buscarUpdates);
  document.getElementById('regenerar').addEventListener('click', async () => {
    const r = await attempt(() => api.glosario.exportar(), { errorTitle: 'No se pudo regenerar' });
    if (!r) return;
    S.exportado = Date.now();
    document.getElementById('aj-exportado').textContent = relTime(S.exportado);
    actualizarMarco();
    Toast.show({ title: 'glosario.md regenerado', text: plural(r.total, 'entrada', 'entradas'), icon: 'check' });
  });
}

/* ══ Router ══════════════════════════════════════════════════════════════════ */

Router.define({
  glosario: { view: viewGlosario },
  revisar: { view: viewGlosario },
  ajustes: { view: viewAjustes },
}, document.getElementById('view'));

/* ══ Actualizaciones ═════════════════════════════════════════════════════════
   El proceso principal manda el estado entero en cada cambio (ver
   src/actualizador.cjs). Acá se decide qué merece un cartel: una versión
   nueva, un "estás al día" que vos pediste, un error. La búsqueda silenciosa
   del arranque no molesta si no hay nada. Portado de Tessera. */

let upd = null;          // el último estado recibido
let updToast = null;     // el toast persistente mientras descarga

function alCambiarUpdate(e) {
  const prev = upd;
  upd = e;
  pintarVersion();
  switch (e.fase) {
    case 'disponible':
      if (prev?.fase !== 'disponible') {
        Toast.show({
          title: 'Hay una versión nueva', text: e.nombre, icon: 'zap', duration: 12000,
          action: { label: 'Ver', run: () => modalUpdate() },
        });
      }
      break;
    case 'descargando': {
      const pct = Math.round(e.progreso.pct * 100);
      const texto = e.progreso.total
        ? `${pct} % · ${fmtBytes(e.progreso.transferido)} de ${fmtBytes(e.progreso.total)}`
        : `${fmtBytes(e.progreso.transferido)}…`;
      if (!updToast) updToast = Toast.show({ title: `Descargando Idiolect ${e.version}`, text: ' ', icon: 'download', duration: 0 });
      const t = updToast.el?.querySelector('.ox-toast__text');
      if (t) t.textContent = texto;
      break;
    }
    case 'listo':
      updToast?.close(); updToast = null;
      Toast.show({
        title: `Idiolect ${e.version} lista`,
        text: 'Se instala al reiniciar. Si no llegás, entra sola la próxima vez que cierres la app.',
        icon: 'check', duration: 0,
        action: { label: 'Reiniciar y actualizar', run: () => api.update.instalar() },
      });
      break;
    case 'al-dia':
      if (e.manual) Toast.show({ title: 'Estás al día', text: `Idiolect ${e.actual}`, icon: 'check' });
      break;
    case 'error':
      updToast?.close(); updToast = null;
      if (e.manual || prev?.fase === 'descargando') Toast.error('No se pudo actualizar', e.error);
      break;
  }
}

function pintarVersion() {
  const chip = document.getElementById('stat-version');
  const val = chip?.querySelector('.ox-statusbar__value');
  if (!chip || !val) return;
  const v = upd?.actual || S.info?.version || '';
  val.textContent = upd?.fase === 'listo' ? `${upd.version} lista para instalar`
    : upd?.fase === 'disponible' ? `${upd.version} disponible`
    : upd?.fase === 'descargando' ? `bajando ${upd.version}…`
    : `v${v}`;
  chip.classList.toggle('is-pending', upd?.fase === 'disponible' || upd?.fase === 'listo');
  chip.dataset.tip = upd?.fase === 'listo' ? 'Reiniciar y actualizar'
    : upd?.fase === 'disponible' ? 'Ver la versión nueva'
    : 'Buscar actualizaciones';
}

async function modalUpdate() {
  const e = upd;
  if (!e || e.fase !== 'disponible') return;
  const body = document.createElement('div');
  body.className = 'ox-col';
  body.style.gap = '14px';
  body.innerHTML = `
    <p class="ox-meta id-parrafo">
      Tenés la <span class="ox-mono">${esc(e.actual)}</span>. La <span class="ox-mono">${esc(e.version)}</span>
      pesa ${esc(fmtBytes(e.bytes))}: se descarga solo si decís que sí, y se instala al reiniciar
      (o al cerrar Idiolect, si no llegás a reiniciar).
    </p>
    <div><a class="ox-btn ox-btn--ghost ox-btn--sm" href="${esc(e.url)}" target="_blank" rel="noreferrer"><i data-icon="external"></i> Ver las notas de la versión</a></div>`;
  Icons.mount(body);
  const ok = await Modal.show({
    title: e.nombre || `Idiolect ${e.version}`,
    body,
    width: 460,
    actions: [
      { label: 'Después', value: null },
      { label: 'Descargar', value: true, variant: 'primary', autofocus: true },
    ],
  });
  if (ok) attempt(() => api.update.descargar(), { errorTitle: 'No se pudo descargar' });
}

/** Lo que hace el clic en la versión de la statusbar, según el momento. */
function clicVersion() {
  if (upd?.fase === 'listo') return api.update.instalar();
  if (upd?.fase === 'disponible') return modalUpdate();
  return buscarUpdates();
}

async function buscarUpdates() {
  const st = await attempt(() => api.update.buscar({ manual: true }), { errorTitle: 'No se pudo buscar' });
  // Los demás desenlaces (al día, disponible, error) llegan por alCambiarUpdate.
  if (st?.fase === 'sin-soporte') Toast.show({ title: 'Acá no se actualiza sola', text: st.motivo, icon: 'info', duration: 8000 });
}

function cablearUpdates() {
  api.update?.onCambio(alCambiarUpdate);
  api.update?.estado().then(alCambiarUpdate).catch(() => pintarVersion());
  const chip = document.getElementById('stat-version');
  chip?.addEventListener('click', clicVersion);
  chip?.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); clicVersion(); } });
}

/* ══ Shell ═══════════════════════════════════════════════════════════════════ */

function enCampo(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

function mover(delta) {
  const lista = visibles();
  if (!lista.length) return;
  const i = lista.findIndex((e) => e.id === S.sel);
  const sig = lista[Math.max(0, Math.min(lista.length - 1, i < 0 ? 0 : i + delta))];
  seleccionar(sig.id, { foco: !enCampo(document.activeElement) });
}

function seleccionar(id, { foco = false } = {}) {
  S.sel = id;
  document.querySelectorAll('.id-row').forEach((r) => r.classList.toggle('is-selected', r.dataset.entrada === id));
  const fila = document.querySelector(`.id-row[data-entrada="${CSS.escape(id)}"]`);
  if (fila) {
    fila.scrollIntoView({ block: 'nearest' });
    if (foco) fila.focus({ preventScroll: true });
  }
  renderEditor();
  actualizarMarco();
}

function cablearShell() {
  const w = api?.win;
  document.getElementById('win-min')?.addEventListener('click', () => w?.minimize());
  document.getElementById('win-close')?.addEventListener('click', () => w?.close());
  const maxBtn = document.getElementById('win-max');
  maxBtn?.addEventListener('click', () => w?.toggleMaximize());
  w?.onMaximized((isMax) => {
    maxBtn.innerHTML = Icons.svg(isMax ? 'winRestore' : 'winMax');
    maxBtn.setAttribute('aria-label', isMax ? 'Restaurar' : 'Maximizar');
  });

  document.querySelectorAll('.ox-navitem').forEach((b) =>
    b.addEventListener('click', () => Router.go(b.dataset.view)));
  document.getElementById('btn-new')?.addEventListener('click', nuevaEntrada);

  /* Delegación en document, enganchada UNA vez al arrancar: no se acumula
     por repintado como pasaría colgándola de #view. */
  document.addEventListener('click', (ev) => {
    const cp = ev.target.closest('[data-copy]');
    if (cp) copy(cp.dataset.copy);

    const fila = ev.target.closest('[data-entrada]');
    if (fila) seleccionar(fila.dataset.entrada);

    const tag = ev.target.closest('[data-tag]');
    if (tag) {
      S.tag = S.tag === tag.dataset.tag ? null : tag.dataset.tag;
      renderFiltros();
      renderLista();
    }
  });

  document.addEventListener('keydown', (ev) => {
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && ev.key.toLowerCase() === 'n') { ev.preventDefault(); nuevaEntrada(); return; }
    if (mod && ev.key.toLowerCase() === 'f') {
      ev.preventDefault();
      if (Router.name === 'ajustes') Router.go('glosario');
      document.getElementById('buscar')?.focus();
      return;
    }
    if (document.querySelector('#ox-layer .ox-modal')) return;
    if (Router.name === 'ajustes') return;

    // Las flechas recorren la lista desde el buscador o desde una fila, nunca
    // desde un campo del editor: ahí mueven el cursor del texto.
    const desdeBuscador = ev.target.id === 'buscar';
    if ((ev.key === 'ArrowDown' || ev.key === 'ArrowUp') && (desdeBuscador || !enCampo(ev.target))) {
      ev.preventDefault();
      mover(ev.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.closest?.('[data-entrada]')) {
      ev.preventDefault();
      seleccionar(ev.target.closest('[data-entrada]').dataset.entrada);
      document.getElementById('c-significa')?.focus();
    }
  });

  /* Algo escribió en la carpeta: Claude anotando, un JSON editado a mano, o
     nuestro propio guardado. Se recarga, pero el editor solo se repinta si
     Fran no está adentro de un campo: si no, le borraríamos lo que tipea. */
  api.glosario.onCambio(async () => {
    const antes = S.entradas.length;
    const ok = await attempt(async () => { await cargar(); return true; }, { errorTitle: 'No se pudo recargar el glosario' });
    if (!ok) return;
    actualizarMarco();
    if (Router.name === 'ajustes') return;
    renderFiltros();
    renderLista();
    const editor = document.getElementById('editor');
    if (!editor?.contains(document.activeElement) || !entrada(S.sel)) renderEditor();
    const sub = document.querySelector('.ox-viewhead__sub');
    if (sub) sub.textContent = subtitulo();
    if (S.entradas.length > antes) {
      Toast.show({ title: 'Glosario actualizado', text: plural(S.entradas.length - antes, 'entrada nueva', 'entradas nuevas'), icon: 'book' });
    }
  });
}

/** Lo que vive fuera de la vista: contadores del rail, statusbar, contexto. */
function actualizarMarco() {
  const n = pendientes().length;
  document.getElementById('count-todas').textContent = S.entradas.length;
  document.getElementById('count-revisar').textContent = n;
  document.getElementById('stat-total').textContent = S.entradas.length;
  document.getElementById('stat-revisar').textContent = n;
  const saved = document.querySelector('#stat-saved .ox-statusbar__value');
  if (saved) saved.textContent = S.exportado ? relTime(S.exportado) : '—';

  const md = S.info?.glosario || '';
  document.getElementById('rail-foot').innerHTML =
    md ? `<div class="ox-meta" data-tip="${esc(md)}">${path(md)}</div>` : '';

  const e = Router.name !== 'ajustes' ? entrada(S.sel) : null;
  document.getElementById('titlebar-context').innerHTML =
    e ? `${Icons.svg('book', 'ox-icon--sm')}<span>${esc(e.expresion)}</span>` : '';
}

/* ══ Color de la ventana ═════════════════════════════════════════════════════
   --ox-bg está en oklch y Electron solo entiende hex: se resuelve acá (con el
   canvas de colorToken, no con un regex; el porqué está en ui.js). */
function syncWindowColor() {
  const hex = colorToken('--ox-bg');
  if (hex) api?.win?.setBackground(hex);
}

/* ══ Arranque ════════════════════════════════════════════════════════════════ */

async function boot() {
  Icons.mount(document);
  Tooltip.init();
  initClickFlash();
  initScrollFades();
  cablearShell();
  syncWindowColor();

  try {
    S.info = await api.info();
    await cargar();
  } catch (err) {
    paint(empty({ icon: 'alert', title: 'No se pudo abrir el glosario', text: err.message }));
    console.error(err);
    return;
  }

  actualizarMarco();
  cablearUpdates();
  Router.onChange(actualizarMarco);
  Router.go(pendientes().length ? 'revisar' : 'glosario');

  raf2(() => {
    const splash = document.getElementById('boot-splash');
    if (!splash) return;
    splash.style.opacity = '0';
    splash.addEventListener('transitionend', () => splash.remove(), { once: true });
    setTimeout(() => splash.remove(), 600);
  });
}

boot();
