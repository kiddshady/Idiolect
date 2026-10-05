/* ═══════════════════════════════════════════════════════════════════════════
   Humo del renderer: monta Idiolect de verdad y la recorre.

   Se corre con `npm run smoke` (necesita Electron, por eso no está en el
   `npm test`, que es node pelado). Usa una carpeta de datos temporal: nunca
   toca el glosario real.

   Lo que busca es lo que un test de unidad NO ve: que lo que se hace en la UI
   llegue al glosario.md que lee Claude, que lo que anota Claude por afuera
   aparezca en la app abierta, y que los overlays caigan dentro de la pantalla.
   **Medí dónde CAE una cosa, no solo si existe.**
   ═══════════════════════════════════════════════════════════════════════════ */

const { app, BrowserWindow } = require('electron');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'idiolect-humo-'));
process.env.IDIOLECT_DATA = DIR;
const W = 1440; const H = 900;

const BG_MAIN = (fs.readFileSync(path.join(ROOT, 'main.cjs'), 'utf8')
  .match(/const BG = '(#[0-9a-f]{6})'/i)?.[1] || '').toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const md = () => fs.readFileSync(path.join(DIR, 'glosario.md'), 'utf8');
const entradasEnDisco = () => fs.readdirSync(path.join(DIR, 'entradas')).filter((f) => f.endsWith('.json'));

let pass = 0; let fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FALLA ${n} ${x}`); } };
const bail = (w, e) => { console.log(`ABORTADO ${w}`, e?.stack || e || ''); app.exit(3); };
process.on('unhandledRejection', (e) => bail('rechazo', e));
process.on('uncaughtException', (e) => bail('excepción', e));
setTimeout(() => bail('timeout de 120s'), 120000);

/* Dos entradas de partida: un borrador y una confirmada. */
function sembrar() {
  fs.mkdirSync(path.join(DIR, 'entradas'), { recursive: true });
  const e = (id, expresion, significa, extra = {}) => fs.writeFileSync(path.join(DIR, 'entradas', `${id}.json`),
    JSON.stringify({ id, expresion, significa, ejemplo: '', notas: '', etiquetas: [], confirmada: false, origen: 'claude', createdAt: 1, updatedAt: 1, ...extra }));
  e('e-0001', 'la cátedra', 'Los docentes de una materia.', { etiquetas: ['facu'] });
  e('e-0002', 'vamos viendo', 'Ajustamos sobre la marcha.', { confirmada: true, origen: 'fran', etiquetas: ['ritmo'] });
}

app.whenReady().then(async () => {
  sembrar();
  require(path.join(ROOT, 'src', 'ipc.cjs')).register();

  const win = new BrowserWindow({
    x: -20000, y: -20000, width: W, height: H,
    frame: false, show: false, paintWhenInitiallyHidden: true, backgroundColor: '#000',
    webPreferences: { preload: path.join(ROOT, 'preload.cjs'), contextIsolation: true },
  });
  // El actualizador, como en `npm start`: sin empaquetar no hay nada que
  // actualizar, y el clic en la versión lo tiene que decir (sección 11).
  require(path.join(ROOT, 'src', 'actualizador.cjs')).iniciar(() => win, { empaquetada: false });
  const errores = [];
  win.webContents.on('console-message', (e) => { if (e.level >= 2) errores.push(`${e.level}: ${e.message}`); });
  await win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  win.show();
  await sleep(2000);

  const js = (c) => win.webContents.executeJavaScript(c);
  const click = (sel) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return false; el.click(); return true; })()`);
  const filas = () => js(`[...document.querySelectorAll('#lista > .ox-list > .id-row:not([data-state="closing"]) .ox-listitem__title')].map(e => e.textContent)`);
  const cambiar = (sel, valor) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return false; el.value = ${JSON.stringify(valor)}; el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  /** Dónde cae el modal: tiene que estar entero dentro de la ventana. */
  const modalEnPantalla = () => js(`(() => { const m = document.querySelector('.ox-modal');
    if (!m) return null; const r = m.getBoundingClientRect();
    return r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth && r.height > 40; })()`);

  console.log('\n1. Arranque');
  ok('el splash se fue', !(await js(`!!document.getElementById('boot-splash')`)));
  ok('los <i data-icon> se reemplazaron por SVG', !(await js(`!!document.querySelector('i[data-icon]')`)));
  ok('con borradores pendientes arranca en Por revisar',
    await js(`document.querySelector('.ox-navitem.is-active')?.dataset.view === 'revisar'`));
  ok('Por revisar muestra solo el borrador', JSON.stringify(await filas()) === '["la cátedra"]', JSON.stringify(await filas()));
  ok('los contadores del rail cuentan', await js(`document.getElementById('count-todas').textContent === '2'
    && document.getElementById('count-revisar').textContent === '1'`));
  ok('el editor arranca vacío', await js(`!!document.querySelector('.id-editor__vacio')`));

  console.log('\n2. Confirmar un borrador');
  await click('.id-row[data-entrada="e-0001"]');
  await sleep(300);
  ok('elegir una fila abre el editor', await js(`document.getElementById('c-expresion')?.value === 'la cátedra'`));
  await click('#confirmada');
  await sleep(700);
  ok('glosario.md ya no la marca como borrador', md().includes('- **la cátedra** — Los docentes de una materia. [facu]\n'),
    md().split('\n').find((l) => l.includes('cátedra')));
  ok('sale de Por revisar', (await filas()).length === 0);
  ok('el editor la sigue mostrando', await js(`document.getElementById('c-expresion')?.value === 'la cátedra'`));
  await sleep(400);
  ok('sin nada que revisar, el contador se va', await js(`document.getElementById('count-revisar').textContent.trim() === ''`));

  console.log('\n3. Crear por la UI: modal → disco → glosario.md');
  await click('.ox-navitem[data-view="glosario"]');
  await sleep(500);
  await click('#btn-new');
  await sleep(500);
  ok('el modal cae entero dentro de la ventana', await modalEnPantalla());
  await js(`(() => { document.getElementById('f-expr').value = 'daleee';
    document.getElementById('f-sig').value = 'Sí, con entusiasmo.';
    document.getElementById('f-ej').value = 'daleee arrancá'; return true; })()`);
  await click('.ox-modal__foot .ox-btn--primary');
  await sleep(900);
  ok('quedó un archivo más en disco', entradasEnDisco().length === 3, String(entradasEnDisco().length));
  ok('glosario.md la tiene confirmada', md().includes('- **daleee** — Sí, con entusiasmo. Ej.: «daleee arrancá».\n'));
  ok('queda abierta en el editor', await js(`document.getElementById('c-expresion')?.value === 'daleee'`));
  ok('y seleccionada en la lista', await js(`document.querySelector('.id-row.is-selected .ox-listitem__title')?.textContent === 'daleee'`));

  console.log('\n4. Editar un campo');
  await cambiar('#c-notas', 'Más letras, más ganas.');
  await cambiar('#c-etiquetas', 'Aprobación, tono');
  await sleep(700);
  ok('las notas llegan al glosario', md().includes('(Más letras, más ganas.) [aprobacion, tono]'),
    md().split('\n').find((l) => l.includes('daleee')));
  ok('las etiquetas se normalizan en el campo', await js(`document.getElementById('c-etiquetas').value === 'aprobacion, tono'`));
  ok('y aparecen como filtro', await js(`!!document.querySelector('.id-tag[data-tag="tono"]')`));
  await cambiar('#c-expresion', 'Vamos Viendo');
  await sleep(400);
  ok('renombrar a una expresión que ya existe se rechaza', await js(`document.getElementById('c-expresion').value === 'daleee'`));

  console.log('\n5. Buscar y filtrar');
  await js(`(() => { const b = document.getElementById('buscar'); b.value = 'CATEDRA';
    b.dispatchEvent(new Event('input')); return true; })()`);
  ok('la búsqueda ignora tildes y mayúsculas', JSON.stringify(await filas()) === '["la cátedra"]', JSON.stringify(await filas()));
  await js(`(() => { const b = document.getElementById('buscar'); b.value = '';
    b.dispatchEvent(new Event('input')); return true; })()`);
  await click('.id-tag[data-tag="ritmo"]');
  ok('una etiqueta filtra', JSON.stringify(await filas()) === '["vamos viendo"]', JSON.stringify(await filas()));
  await click('.id-tag[data-tag="ritmo"]');
  ok('volver a tocarla la suelta', (await filas()).length === 3);

  console.log('\n6. Lo que anota Claude por afuera aparece solo');
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'anotar.cjs'), '--expresion', 'holis', '--significa', 'Saludo relajado.'],
    { env: { ...process.env, IDIOLECT_DATA: DIR, ELECTRON_RUN_AS_NODE: '1' } });
  await sleep(1200);
  ok('la lista la incluye sin recargar', (await filas()).includes('holis'), JSON.stringify(await filas()));
  ok('el contador de Por revisar sube', await js(`document.getElementById('count-revisar').textContent === '1'`));
  ok('avisa con un toast', await js(`[...document.querySelectorAll('#ox-layer *')].some(n => /Glosario actualizado/.test(n.textContent))`));

  console.log('\n7. Ir y volver no duplica los listeners');
  await click('.ox-navitem[data-view="ajustes"]');
  await sleep(400);
  ok('ajustes muestra la línea para CLAUDE.md', await js(`[...document.querySelectorAll('.id-codigo')].some(n => n.textContent.startsWith('@') && n.textContent.endsWith('/glosario.md'))`));
  await click('.ox-navitem[data-view="glosario"]');
  await sleep(400);
  await click('.id-tag[data-tag="facu"]');
  ok('un click en una etiqueta la prende una sola vez', await js(`document.querySelector('.id-tag[data-tag="facu"]').classList.contains('is-on')`));
  await click('.id-tag[data-tag="facu"]');

  console.log('\n8. Eliminar');
  await click('.id-row[data-entrada="e-0002"]');
  await sleep(300);
  await click('#borrar');
  await sleep(500);
  ok('la confirmación cae dentro de la ventana', await modalEnPantalla());
  await js(`(() => { const b = [...document.querySelectorAll('.ox-modal__foot .ox-btn')].pop(); b.click(); return true; })()`);
  await sleep(900);
  ok('el archivo se borró', !entradasEnDisco().includes('e-0002.json'));
  ok('salió del glosario', !md().includes('vamos viendo'));
  ok('el editor volvió a vacío', await js(`!!document.querySelector('.id-editor__vacio')`));

  console.log('\n9. Las reglas de oro');
  const glifos = await js(`(() => {
    const malo = /[\\u2190-\\u21FF\\u2300-\\u23FF\\u25A0-\\u27BF\\u2B00-\\u2BFF\\uFE0F\\u{1F300}-\\u{1FAFF}]/u;
    const out = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n; while ((n = w.nextNode())) if (malo.test(n.nodeValue)) out.push(n.nodeValue.trim().slice(0, 40));
    return out;
  })()`);
  ok('cero emojis y glifos unicode en la UI', glifos.length === 0, JSON.stringify(glifos));
  ok('cero title= nativo', (await js(`document.querySelectorAll('[title]').length`)) === 0);
  const hex = await js(`import('./js/ui.js').then(m => m.colorToken('--ox-bg'))`);
  ok('el fondo del tema coincide con el backgroundColor de main.cjs', String(hex).toLowerCase() === BG_MAIN, `${hex} vs ${BG_MAIN}`);

  /* ── 9-bis. Ningún anillo de foco se corta ─────────────────────────────────
     El anillo de base.css sale 3.5px por fuera del elemento. Si el elemento se
     ve entero pero esos 3.5px caen afuera de un contenedor que recorta (un
     .ox-scroll, el borde de la ventana) o encima del canto de una superficie
     (una card, el carril del segmentado), con Tab se ve cortado: pasó en los
     controles de ventana, el primer ítem del rail, el segmentado y las filas
     de una tabla de borde a borde (Apex, sep 2026). Cada elemento se enfoca
     como con teclado y se mide su anillo real (solo las sombras duras: una
     difusa es elevación, no anillo), así los que van hacia adentro cuentan
     cero. Las filas de tabla se prueban como si tuvieran tabindex, porque las
     apps se lo ponen. */
  console.log('\n9-bis. Ningún anillo de foco se corta');
  const AUDITAR_ANILLOS = `((scope) => {
  if (!document.getElementById('aud-notr')) document.head.insertAdjacentHTML('beforeend', '<style id="aud-notr">*,*::before{transition:none!important}</style>');
  // Cuánto sale el anillo REAL por fuera del elemento: se lo enfoca como con
  // teclado y se leen sus sombras de afuera y su outline.
  const extent = (el) => {
    el.focus({ focusVisible: true, preventScroll: true });
    const s = getComputedStyle(el);
    let m = 0;
    for (const part of s.boxShadow.split(/,(?![^(]*\\))/)) {
      if (part.includes('inset') || part.trim() === 'none') continue;
      const nums = part.replace(/rgba?\\([^)]*\\)|oklch\\([^)]*\\)/g, '').match(/-?[\\d.]+px/g) || [];
      const [x = 0, y = 0, blur = 0, spread = 0] = nums.map(parseFloat);
      if (blur > 0) continue;   // una sombra difusa (elevación, brillo) no es el anillo
      m = Math.max(m, spread + Math.max(Math.abs(x), Math.abs(y)));
    }
    if (s.outlineStyle !== 'none' && !/rgba\\(0, 0, 0, 0\\)/.test(s.outlineColor)) m = Math.max(m, parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset));
    el.blur();
    return m;
  };
  const SEL = 'a[href],button:not([disabled]):not([tabindex="-1"]),input:not([disabled]):not([type=hidden]),select,textarea,[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';
  const name = (el) => {
    const id = el.id ? '#' + el.id : '';
    const cls = [...el.classList].slice(0, 2).map((c) => '.' + c).join('');
    const txt = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 24);
    return el.tagName.toLowerCase() + id + cls + (txt ? ' «' + txt + '»' : '');
  };
  const out = [];
  for (const el of scope.querySelectorAll(SEL)) {
    if (el.closest('[inert],[hidden],[aria-hidden="true"]')) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const R = extent(el);
    if (R <= 0.5) continue;
    const boxes = [{ who: 'ventana', l: 0, t: 0, r: innerWidth, b: innerHeight }];
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible' || s.clipPath !== 'none' || /paint|strict|content/.test(s.contain)) {
        const ar = a.getBoundingClientRect();
        const l = ar.left + a.clientLeft; const t = ar.top + a.clientTop;
        boxes.push({ who: name(a), l, t, r: l + a.clientWidth, b: t + a.clientHeight });
      }
    }
    const e = 0.5;
    // ¿Roza el canto de una superficie (card, panel, modal)? Un fondo o una
    // sombra con radio: el anillo se pisa con su borde aunque nada lo recorte.
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a);
      const surf = (s.backgroundColor !== 'rgba(0, 0, 0, 0)' || s.boxShadow !== 'none') && parseFloat(s.borderTopLeftRadius) > 0;
      if (!surf) continue;
      const ar = a.getBoundingClientRect();
      const g = [r.left - ar.left, r.top - ar.top, ar.right - r.right, ar.bottom - r.bottom];
      if (g.some((x) => x < -e)) continue;
      const lados = ['izq', 'arriba', 'der', 'abajo'].filter((_, i) => g[i] < R - e).map((n, i) => n);
      const det = g.map((x, i) => ['izq', 'arriba', 'der', 'abajo'][i] + ' ' + x.toFixed(1)).filter((_, i) => g[i] < R - e);
      if (det.length) { out.push(name(el) + '  roza ' + name(a) + '  [' + det.join(', ') + ']'); break; }
    }
    for (const bx of boxes) {
      const inside = r.left >= bx.l - e && r.top >= bx.t - e && r.right <= bx.r + e && r.bottom <= bx.b + e;
      if (!inside) break;   // el elemento mismo ya está recortado: no es culpa del anillo
      const lados = [];
      if (r.left - R < bx.l - e) lados.push('izq ' + (r.left - bx.l).toFixed(1));
      if (r.top - R < bx.t - e) lados.push('arriba ' + (r.top - bx.t).toFixed(1));
      if (r.right + R > bx.r + e) lados.push('der ' + (bx.r - r.right).toFixed(1));
      if (r.bottom + R > bx.b + e) lados.push('abajo ' + (bx.b - r.bottom).toFixed(1));
      if (lados.length) { out.push(name(el) + '  ← ' + bx.who + '  [' + lados.join(', ') + ']'); break; }
    }
  }
  document.querySelectorAll('.ox-scroll, .ox-main, [class*="scroll"]').forEach((s) => { s.scrollTop = 0; s.scrollLeft = 0; });
  return out;
})(document)`;
  // Sin foco en la ventana, :focus-visible no se aplica y todo anillo mide
  // cero: la auditoría pasaría sin haber medido nada.
  win.focus();
  win.webContents.focus();
  await sleep(150);
  ok('la ventana tiene el foco (si no, no hay anillos que medir)', await js('document.hasFocus()'));
  // En el glosario, con una entrada abierta: así el editor entero (switch,
  // campos, pie) entra en la auditoría, no solo su estado vacío.
  for (const v of ['revisar', 'glosario', 'ajustes']) {
    await click(`.ox-navitem[data-view="${v}"]`);
    await sleep(700);
    if (v === 'glosario') { await click('.id-row[data-entrada]'); await sleep(500); }
    const cortes = await js(AUDITAR_ANILLOS);
    ok(`${v}: ningún anillo de foco se corta ni roza un canto`, cortes.length === 0, '\n      ' + cortes.join('\n      '));
  }
  await js(`document.getElementById('aud-notr')?.remove()`);

  /* ── 10. Transiciones ──────────────────────────────────────────────────────
     Un movimiento no se aprueba mirándolo pasar: se muestrea cada ~40 ms y se
     mide la curva. Lo que se busca es el cuadro en que algo cambia de golpe:
     el editor reemplazado de un cuadro al otro, una fila que desaparece y hace
     saltar la lista, un número que cambia sin fundido. */
  console.log('\n10. Transiciones');
  await click('.ox-navitem[data-view="glosario"]');
  await sleep(700);
  const [idA, idB] = await js(`[...document.querySelectorAll('.id-row[data-entrada]')].map(r => r.dataset.entrada).slice(0, 2)`);
  await click(`.id-row[data-entrada="${idA}"]`);
  await sleep(500);
  const relevo = await js(`(async () => {
    const panel = (k) => document.querySelector('#editor > .id-editor__panel[data-clave="' + k + '"]');
    // La opacidad que se VE: el panel viejo se esfuma adentro del calco de swap().
    const op = (el) => {
      if (!el?.isConnected) return null;
      let o = 1;
      for (let n = el; n && n.id !== 'editor'; n = n.parentElement) o *= +getComputedStyle(n).opacity;
      return Math.round(o * 100);
    };
    const viejo = panel(${JSON.stringify(idA)});
    const rv = viejo.getBoundingClientRect();
    document.querySelector('.id-row[data-entrada="${idB}"]').click();
    const filas = [];
    for (let t = 0; t <= 360; t += 40) {
      const nuevo = panel(${JSON.stringify(idB)});
      const rn = nuevo?.getBoundingClientRect();
      filas.push({ t, viejo: op(viejo), nuevo: op(nuevo), mismoLugar: !!rn && rn.left === rv.left && rn.top === rv.top,
        ids: document.querySelectorAll('#c-expresion').length });
      await new Promise((r) => setTimeout(r, 40));
    }
    return filas;
  })()`);
  const serie = relevo.map((f) => `${f.t}:${f.viejo ?? '-'}/${f.nuevo ?? '-'}`).join(' ');
  ok('al elegir otra, el editor viejo se esfuma de a poco (no se va de un cuadro al otro)',
    relevo.some((f) => f.viejo > 5 && f.viejo < 95), serie);
  ok('y termina de irse', relevo.at(-1).viejo === null, serie);
  ok('el nuevo espera su turno: arranca invisible y llega entero', relevo[0].nuevo <= 5 && relevo.at(-1).nuevo === 100, serie);
  ok('cuando el nuevo ya se ve, el viejo va por menos de la mitad', relevo.every((f) => !(f.nuevo > 50 && f.viejo > 50)), serie);
  ok('los dos en el mismo lugar, sin salto', relevo.every((f) => f.mismoLugar), serie);
  ok('mientras se relevan, un solo #c-expresion', relevo.every((f) => f.ids === 1), JSON.stringify(relevo.map((f) => f.ids)));

  const cierre = await js(`(async () => {
    const b = document.getElementById('buscar');
    const vivas = () => document.querySelectorAll('#lista > .ox-list > .id-row:not([data-state="closing"])');
    const antes = vivas().length;
    const queda = [...vivas()].find((r) => r.textContent.includes('holis'));
    b.value = 'holis'; b.dispatchEvent(new Event('input'));
    const salen = [...document.querySelectorAll('#lista > .ox-list > .id-row[data-state="closing"]')];
    const ops = []; const tops = [];
    for (let t = 0; t <= 320; t += 40) {
      ops.push(salen.map((f) => f.isConnected ? Math.round(+getComputedStyle(f).opacity * 100) : null));
      tops.push(Math.round(queda.getBoundingClientRect().top));
      await new Promise((r) => setTimeout(r, 40));
    }
    const quedan = document.querySelectorAll('#lista > .ox-list > .id-row').length;
    b.value = ''; b.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 50));
    const nuevas = [...vivas()].filter((r) => r !== queda);
    const aMedias = nuevas.map((f) => Math.round(+getComputedStyle(f).opacity * 100));
    await new Promise((r) => setTimeout(r, 450));
    const enteras = nuevas.map((f) => Math.round(+getComputedStyle(f).opacity * 100));
    return { antes, salen: salen.length, ops, tops, quedan, aMedias, enteras };
  })()`);
  const primeraSale = cierre.ops.map((o) => o[0]).filter((o) => o !== null);
  ok('una fila filtrada se esfuma de a poco', cierre.salen === cierre.antes - 1 && primeraSale.some((o) => o > 5 && o < 95), JSON.stringify(cierre));
  ok('y al terminar sale del DOM', cierre.quedan === 1, JSON.stringify(cierre));
  ok('la que queda viaja a su lugar (no salta)', cierre.tops.at(-1) < cierre.tops[0]
    && cierre.tops.some((t) => t < cierre.tops[0] && t > cierre.tops.at(-1)), JSON.stringify(cierre.tops));
  ok('al soltar la búsqueda, las que vuelven entran (no aparecen de golpe)',
    cierre.aMedias.length === cierre.antes - 1 && cierre.aMedias.every((o, i) => o < cierre.enteras[i] && cierre.enteras[i] === 100), JSON.stringify(cierre));

  await click(`.id-row[data-entrada="${idA}"]`);
  await sleep(500);
  const fundido = await js(`(async () => {
    // Se busca en cada muestra: al guardar, el vigía de la carpeta puede
    // repintar el editor en el lugar, y el nodo de antes queda desmontado.
    document.getElementById('confirmada').click();
    const ops = [];
    for (let t = 0; t <= 400; t += 40) {
      // La nota nueva asoma adentro del mismo nodo mientras la vieja se va en un calco.
      const n = document.getElementById('nota-confirmada');
      const vivo = n?.querySelector(':scope > :not(.ox-swap-out)') || n;
      ops.push(Math.round(+getComputedStyle(vivo).opacity * 100));
      await new Promise((r) => setTimeout(r, 40));
    }
    return { ops };
  })()`);
  ok('la nota de «Confirmada» cambia con un fundido, no de golpe', fundido.ops.some((o) => o < 60) && fundido.ops.at(-1) === 100, JSON.stringify(fundido.ops));
  await click('#confirmada');
  await sleep(700);

  /* ── 11. Clics de más en el actualizador ──────────────────────────────────
     Desde el código fuente no hay nada que actualizar y el clic dice por qué.
     Cinco clics seguidos eran cinco búsquedas y cinco carteles encimados. */
  console.log('\n11. Clics de más en el actualizador');
  const cartelesUpd = await js(`(async () => {
    const chip = document.getElementById('stat-version');
    for (let i = 0; i < 5; i++) chip.click();
    await new Promise((r) => setTimeout(r, 600));
    const tras5 = [...document.querySelectorAll('#ox-layer .ox-toast:not([data-state="closing"])')]
      .filter((t) => /no se actualiza sola/.test(t.textContent)).length;
    chip.click();
    await new Promise((r) => setTimeout(r, 400));
    const tras6 = [...document.querySelectorAll('#ox-layer .ox-toast:not([data-state="closing"])')]
      .filter((t) => /no se actualiza sola/.test(t.textContent)).length;
    return { tras5, tras6 };
  })()`);
  ok('cinco clics seguidos, un solo cartel', cartelesUpd.tras5 === 1, JSON.stringify(cartelesUpd));
  ok('con el cartel en pantalla, otro clic no apila otro igual', cartelesUpd.tras6 === 1, JSON.stringify(cartelesUpd));
  await click('.ox-navitem[data-view="ajustes"]');
  await sleep(500);
  const botonUpd = await js(`(async () => {
    const b = document.getElementById('buscar-updates');
    b.click(); b.click(); b.click();
    const durante = b.disabled && b.dataset.ocupado === '1';
    await new Promise((r) => setTimeout(r, 700));
    const nb = document.getElementById('buscar-updates');
    return { durante, despues: !nb.disabled && nb.dataset.ocupado === '0' && /Buscar actualizaciones/.test(nb.textContent) };
  })()`);
  ok('el botón de Ajustes queda ocupado mientras busca', botonUpd.durante, JSON.stringify(botonUpd));
  ok('y vuelve a estar libre al terminar', botonUpd.despues, JSON.stringify(botonUpd));

  // El vigía de la carpeta la tiene tomada hasta que la app sale: si no se
  // deja borrar, queda en %TEMP% y no pasa nada.
  try { fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 }); } catch { /* queda en %TEMP% */ }
  console.log(`\n═══ ${pass} ok · ${fail} fallas ═══`);
  console.log(errores.length ? `CONSOLA:\n  ${errores.join('\n  ')}` : 'CONSOLA: limpia');
  app.exit(fail || errores.length ? 1 : 0);
});
