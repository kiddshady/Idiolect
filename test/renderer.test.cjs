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
  const errores = [];
  win.webContents.on('console-message', (e) => { if (e.level >= 2) errores.push(`${e.level}: ${e.message}`); });
  await win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  win.show();
  await sleep(2000);

  const js = (c) => win.webContents.executeJavaScript(c);
  const click = (sel) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return false; el.click(); return true; })()`);
  const filas = () => js(`[...document.querySelectorAll('.id-row .ox-listitem__title')].map(e => e.textContent)`);
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
  ok('el contador baja a 0', await js(`document.getElementById('count-revisar').textContent === '0'`));

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

  // El vigía de la carpeta la tiene tomada hasta que la app sale: si no se
  // deja borrar, queda en %TEMP% y no pasa nada.
  try { fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 }); } catch { /* queda en %TEMP% */ }
  console.log(`\n═══ ${pass} ok · ${fail} fallas ═══`);
  console.log(errores.length ? `CONSOLA:\n  ${errores.join('\n  ')}` : 'CONSOLA: limpia');
  app.exit(fail || errores.length ? 1 : 0);
});
