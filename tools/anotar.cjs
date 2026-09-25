#!/usr/bin/env node
'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   IDIOLECT — anotar desde la línea de comandos
   Es la puerta de Claude: cuando Fran dice en el chat «anotá que X significa
   Y», esto crea (o actualiza) la entrada y regenera glosario.md, sin abrir la
   app. Si la app está abierta, se entera sola: vigila la carpeta de datos.

   Escribe por el mismo store que la app (escritura atómica, ids validados),
   así que una entrada anotada acá es idéntica a una cargada a mano.
   ═══════════════════════════════════════════════════════════════════════════ */

const store = require('../src/store.cjs');
const { COLECCION, plegar, normalizar, exportar } = require('../src/glosario.cjs');

const AYUDA = `
Uso: node tools/anotar.cjs [opciones]

  --expresion "…"    La expresión tal como la dice Fran (obligatoria para anotar).
  --significa "…"    Qué quiere decir.
  --ejemplo "…"      Una frase real donde la usó.
  --notas "…"        Cuándo la usa, con qué tono, contra qué no confundirla.
  --etiquetas a,b    Separadas por coma.
  --confirmada       La dijo o la validó Fran. Sin esto queda como borrador de Claude.

  Si la expresión ya existe (sin mirar tildes ni mayúsculas), se actualizan solo
  los campos que pases.

  --listar           Muestra todas las entradas.
  --borrar "…"       Elimina la entrada con esa expresión.
  --exportar         Solo regenera glosario.md.
  --ayuda            Esto.

Datos en: ${store.ROOT}
`;

function leerArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const clave = a.slice(2);
    const sig = argv[i + 1];
    if (sig === undefined || sig.startsWith('--')) out[clave] = true;
    else { out[clave] = sig; i++; }
  }
  return out;
}

async function main() {
  const args = leerArgs(process.argv.slice(2));
  const col = store.collection(COLECCION);

  if (args.ayuda || !Object.keys(args).length) {
    console.log(AYUDA);
    return;
  }

  if (args.listar) {
    const todas = (await col.list()).map(normalizar)
      .sort((a, b) => a.expresion.localeCompare(b.expresion, 'es', { sensitivity: 'base' }));
    for (const e of todas) {
      console.log(`${e.confirmada ? ' ' : '?'} ${e.id}  ${e.expresion} — ${e.significa}`);
    }
    console.log(`\n${todas.length} entradas, ${todas.filter((e) => !e.confirmada).length} sin confirmar.`);
    return;
  }

  if (args.borrar) {
    const clave = plegar(args.borrar);
    const hit = (await col.list()).find((e) => plegar(e.expresion) === clave);
    if (!hit) throw new Error(`No hay ninguna entrada «${args.borrar}».`);
    await col.remove(hit.id);
    const { archivo } = await exportar();
    console.log(`Borrada ${hit.id} «${hit.expresion}». Regenerado ${archivo}`);
    return;
  }

  if (args.expresion) {
    if (typeof args.expresion !== 'string') throw new Error('--expresion necesita un valor.');
    const clave = plegar(args.expresion);
    const previa = (await col.list()).find((e) => plegar(e.expresion) === clave);
    if (!previa && typeof args.significa !== 'string') {
      throw new Error('Una entrada nueva necesita --significa.');
    }

    const cambios = {};
    for (const campo of ['significa', 'ejemplo', 'notas', 'etiquetas']) {
      if (typeof args[campo] === 'string') cambios[campo] = args[campo];
    }
    if (args.confirmada) cambios.confirmada = true;

    const entrada = normalizar({
      ...(previa || {
        id: await col.nextId('e'),
        origen: args.confirmada ? 'fran' : 'claude',
        createdAt: Date.now(),
      }),
      expresion: args.expresion,
      ...cambios,
      updatedAt: Date.now(),
    });
    await col.save(entrada);
    const { archivo } = await exportar();
    console.log(`${previa ? 'Actualizada' : 'Anotada'} ${entrada.id} «${entrada.expresion}»`
      + `${entrada.confirmada ? '' : ' (sin confirmar)'}. Regenerado ${archivo}`);
    return;
  }

  if (args.exportar) {
    const { archivo, total } = await exportar();
    console.log(`Regenerado ${archivo} (${total} entradas).`);
    return;
  }

  console.log(AYUDA);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
