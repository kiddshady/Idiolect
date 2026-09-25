'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   IDIOLECT — el glosario
   Lo que hace que la app sirva para algo: cada vez que cambia una entrada, se
   regenera `glosario.md` en la carpeta de datos. Ese archivo lo importa el
   CLAUDE.md global (`@S:/tools/Idiolect/data/glosario.md`), así Claude Code lo
   lee al arrancar cada sesión sin que nadie se acuerde de pasárselo.

   Por eso el formato es compacto: se paga en tokens en TODAS las sesiones.
   Una línea por entrada, sin tablas (una tabla de Markdown repite separadores
   y columnas vacías), y los campos opcionales solo si tienen algo.

   Este módulo es puro y no sabe de Electron: lo usan el proceso principal y
   `tools/anotar.cjs`, que es por donde Claude escribe desde el chat.
   ═══════════════════════════════════════════════════════════════════════════ */

const fsp = require('fs/promises');
const path = require('path');
const store = require('./store.cjs');

const COLECCION = 'entradas';
const ARCHIVO = path.join(store.ROOT, 'glosario.md');

/** Para comparar y buscar: sin tildes, sin mayúsculas, sin espacios de más. */
function plegar(s) {
  return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Deja una entrada con forma conocida, venga de la app, del CLI o de un JSON editado a mano. */
function normalizar(e) {
  const etiquetas = Array.isArray(e.etiquetas)
    ? e.etiquetas
    : String(e.etiquetas ?? '').split(',');
  return {
    id: e.id,
    expresion: String(e.expresion ?? '').trim(),
    significa: String(e.significa ?? '').trim(),
    ejemplo: String(e.ejemplo ?? '').trim(),
    notas: String(e.notas ?? '').trim(),
    etiquetas: [...new Set(etiquetas.map((t) => plegar(t)).filter(Boolean))],
    confirmada: Boolean(e.confirmada),
    origen: e.origen === 'claude' ? 'claude' : 'fran',
    createdAt: e.createdAt || Date.now(),
    updatedAt: e.updatedAt || Date.now(),
  };
}

const orden = (a, b) => a.expresion.localeCompare(b.expresion, 'es', { sensitivity: 'base' });

function renderizar(entradas) {
  const lista = entradas.map(normalizar).filter((e) => e.expresion && e.significa).sort(orden);
  const pendientes = lista.filter((e) => !e.confirmada).length;

  const renglon = (e) => {
    // Sin punto final, el «Ej.:» quedaba pegado al significado y se leía como
    // parte de él («…intencionalmente Ej.: …»).
    let s = `- **${e.expresion}** — ${/[.!?…)»]$/.test(e.significa) ? e.significa : `${e.significa}.`}`;
    if (e.ejemplo) s += ` Ej.: «${e.ejemplo}».`;
    if (e.notas) s += ` (${e.notas})`;
    if (e.etiquetas.length) s += ` [${e.etiquetas.join(', ')}]`;
    if (!e.confirmada) s += ' _sin confirmar_';
    return s;
  };

  return [
    '<!-- Generado por Idiolect (S:\\tools\\Idiolect). No editar a mano: se reescribe en cada guardado. -->',
    '# Idiolect: cómo habla Fran',
    '',
    'Expresiones, abreviaturas y códigos propios de Fran. Sirven para entenderlo, no para imitarlo.',
    pendientes
      ? `Las marcadas _sin confirmar_ (${pendientes}) son borradores de Claude que Fran todavía no revisó: usalas con reserva.`
      : 'Todas las entradas están confirmadas por Fran.',
    'Si notás una expresión suya que no está, proponele sumarla. Se anota con',
    '`node S:\\tools\\Idiolect\\tools\\anotar.cjs --expresion "…" --significa "…"` (con `--ayuda` están todas las opciones).',
    '',
    ...lista.map(renglon),
    '',
  ].join('\n');
}

/** Regenera glosario.md desde lo que hay en disco. Devuelve la ruta y cuántas entradas escribió. */
async function exportar() {
  const entradas = await store.collection(COLECCION).list();
  const texto = renderizar(entradas);
  await fsp.mkdir(path.dirname(ARCHIVO), { recursive: true });
  // Mismo camino atómico que el resto de los datos: el CLI y la app pueden
  // exportar a la vez, y un glosario truncado lo leería Claude tal cual.
  const tmp = `${ARCHIVO}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, texto, 'utf8');
  await store.renameWithRetry(tmp, ARCHIVO);
  return { archivo: ARCHIVO, total: entradas.length };
}

module.exports = { COLECCION, ARCHIVO, plegar, normalizar, renderizar, exportar };
