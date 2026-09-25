/* ═══════════════════════════════════════════════════════════════════════════
   El glosario: lo que efectivamente lee Claude.

   Prueba las dos puertas de escritura que no pasan por la UI (normalizar y el
   CLI de anotar) y que glosario.md salga con la forma prometida. Corre contra
   una carpeta temporal: nunca toca los datos reales de S:\tools\Idiolect\data.
   ═══════════════════════════════════════════════════════════════════════════ */

import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0; let fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FALLA ${n} ${x}`); } };

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'idiolect-'));
process.env.IDIOLECT_DATA = DIR;
const g = require('../src/glosario.cjs');

console.log('\n1. Normalizar');
const n = g.normalizar({ id: 'e-0001', expresion: '  daleee ', significa: 'sí', etiquetas: 'Aprobación, tono,, tono' });
ok('recorta espacios', n.expresion === 'daleee');
ok('etiquetas desde texto: plegadas, sin vacías ni repetidas', JSON.stringify(n.etiquetas) === '["aprobacion","tono"]', JSON.stringify(n.etiquetas));
ok('sin confirmar por defecto', n.confirmada === false);
ok('plegar ignora tildes y mayúsculas', g.plegar('La Cátedra') === g.plegar('la catedra'));

console.log('\n2. Renderizar');
const md = g.renderizar([
  { expresion: 'vamos viendo', significa: 'Ajustamos sobre la marcha.', confirmada: true },
  { expresion: 'Arrancá', significa: 'Empezá.', ejemplo: 'daleee arrancá', etiquetas: ['ritmo'] },
  { expresion: 'huérfana', significa: '' },
]);
const lineas = md.split('\n').filter((l) => l.startsWith('- **'));
ok('una línea por entrada completa, sin las que no tienen significado', lineas.length === 2, String(lineas.length));
ok('orden alfabético sin mirar mayúsculas', lineas[0].includes('Arrancá') && lineas[1].includes('vamos viendo'));
ok('el borrador lleva su marca', lineas[0].endsWith('_sin confirmar_'));
ok('la confirmada no', !lineas[1].includes('sin confirmar'));
ok('ejemplo y etiquetas en la línea', lineas[0].includes('Ej.: «daleee arrancá».') && lineas[0].includes('[ritmo]'));
ok('el encabezado cuenta los pendientes', md.includes('_sin confirmar_ (1)'));

console.log('\n3. Anotar por línea de comandos');
const cli = (...args) => execFileSync(process.execPath, [path.join(ROOT, 'tools', 'anotar.cjs'), ...args],
  { env: { ...process.env, IDIOLECT_DATA: DIR }, encoding: 'utf8' });
cli('--expresion', 'holis', '--significa', 'Saludo relajado.', '--etiquetas', 'saludo');
let archivo = fs.readFileSync(path.join(DIR, 'glosario.md'), 'utf8');
ok('anota y regenera glosario.md', archivo.includes('- **holis** — Saludo relajado. [saludo] _sin confirmar_'));
cli('--expresion', 'Holis', '--ejemplo', 'holis CC', '--confirmada');
const todas = fs.readdirSync(path.join(DIR, 'entradas'));
archivo = fs.readFileSync(path.join(DIR, 'glosario.md'), 'utf8');
ok('la misma expresión con otra mayúscula actualiza, no duplica', todas.length === 1, String(todas.length));
ok('actualizar conserva lo que no se pasó', archivo.includes('Saludo relajado.') && archivo.includes('Ej.: «holis CC».'));
ok('--confirmada saca la marca', !archivo.includes('_sin confirmar_'));
let fallo = false;
try { cli('--expresion', 'nueva sin significado'); } catch { fallo = true; }
ok('una entrada nueva sin --significa se rechaza', fallo);
cli('--borrar', 'holis');
archivo = fs.readFileSync(path.join(DIR, 'glosario.md'), 'utf8');
ok('--borrar la saca del glosario', !archivo.includes('holis') && fs.readdirSync(path.join(DIR, 'entradas')).length === 0);

fs.rmSync(DIR, { recursive: true, force: true });
console.log(`\n═══ ${pass} ok · ${fail} fallas ═══`);
process.exit(fail ? 1 : 0);
