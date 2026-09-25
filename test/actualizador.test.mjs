/* ═══════════════════════════════════════════════════════════════════════════
   Las decisiones del actualizador.

   Lo que se prueba acá no es electron-updater —eso es de otros— sino las dos
   cosas que sí son nuestras y que se rompen en silencio:

     · dónde NO hay que ofrecer actualizar, para no prometer algo que va a
       fallar (desde el código fuente, y la versión portable);
     · qué se le muestra al usuario cuando algo falla, porque el error crudo de
       electron-updater viene con stack y URL adentro.

   El módulo se carga con Node pelado a propósito: si algún día alguien le pone
   un `require('electron')` arriba de todo sin la red de seguridad, este test
   deja de correr y se nota.
   ═══════════════════════════════════════════════════════════════════════════ */

import { createRequire } from 'module';
import { EventEmitter } from 'events';

const require = createRequire(import.meta.url);
const upd = require('../src/actualizador.cjs');

let pass = 0; let fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FALLA ${n} ${x}`); } };

console.log('\n1. Dónde se puede actualizar solo');
const fuente = upd.soporte({ empaquetada: false, portable: false });
const portable = upd.soporte({ empaquetada: true, portable: true });
const instalada = upd.soporte({ empaquetada: true, portable: false });

ok('instalada: sí', instalada.ok === true);
ok('y sin motivo que mostrar', instalada.motivo === '');
ok('desde el código fuente: no', fuente.ok === false);
ok('y lo explica', /código fuente/i.test(fuente.motivo), fuente.motivo);
ok('portable: no', portable.ok === false);
ok('y dice qué hacer en su lugar', /reemplaz/i.test(portable.motivo), portable.motivo);
/* Sin argumentos tiene que dar NO. Un default permisivo acá significa ofrecer
   una actualización que después revienta. */
ok('sin datos, no', upd.soporte().ok === false);

console.log('\n2. El error que ve el usuario');
ok('sin internet', upd.mensaje(new Error('getaddrinfo ENOTFOUND github.com')) === 'No se pudo llegar a GitHub. ¿Hay internet?');
ok('sin ruta a la red', /¿Hay internet\?/.test(upd.mensaje(new Error('connect ENETUNREACH 140.82.0.1'))));
ok('timeout', /no contestó a tiempo/.test(upd.mensaje(new Error('ESOCKETTIMEDOUT'))));
ok('404: falta el archivo de la versión', /no tiene el archivo/.test(upd.mensaje(new Error('HttpError: 404 Not Found'))));
ok('se queda con la primera línea', upd.mensaje(new Error('Se rompió algo\n  at Foo (bar.js:1)')) === 'Se rompió algo');
ok('un string pelado también sirve', upd.mensaje('qué sé yo') === 'qué sé yo');
ok('sin nada, no explota', upd.mensaje(null) === 'Error desconocido');

console.log('\n3. Sin iniciar(), nada se dispara');
/* El módulo entero tiene que ser inerte hasta que la app lo prenda: si estas
   tres hicieran algo sin autoUpdater, un test o un arranque a medias saldría
   a la red o cerraría la app. */
ok('el estado arranca inactivo', upd.leer().fase === 'inactivo');
ok('buscar no explota', await upd.buscar({ manual: true }).then(() => true, () => false));
ok('descargar no explota', await upd.descargar().then(() => true, () => false));
ok('instalar dice que no', upd.instalar() === false);
ok('y el estado sigue intacto', upd.leer().fase === 'inactivo');

console.log('\n4. Una búsqueda, un solo desenlace');
/* main manda el estado entero en cada cambio, y el renderer le pone cartel al
   desenlace que llega. buscar() lo mandaba apenas anotaba `manual`, con el
   desenlace de la búsqueda ANTERIOR adentro: un clic en "Buscar
   actualizaciones" después de un "al día" hacía llegar dos 'al-dia' con
   manual=true —dos carteles— por una sola búsqueda. Y electron-updater emite
   'error' y además rechaza la promesa con el mismo error: dos avisos más si
   nadie los junta. */

/* Se porta como el real en lo que importa: emite antes de resolver, y cuando
   falla emite 'error' Y rechaza con el mismo error. */
class UpdaterFalso extends EventEmitter {
  constructor() { super(); this.hay = null; this.falla = null; }
  async checkForUpdates() {
    this.emit('checking-for-update');
    if (this.falla) { this.emit('error', this.falla); throw this.falla; }
    if (this.hay) this.emit('update-available', this.hay); else this.emit('update-not-available', {});
  }
  async downloadUpdate() {
    if (this.falla) { this.emit('error', this.falla); throw this.falla; }
    this.emit('update-downloaded', this.hay);
  }
}

const enviados = [];
const ventana = { isDestroyed: () => false, webContents: { send: (_canal, e) => enviados.push(e) } };
const fases = () => enviados.map((e) => e.fase).join(' → ');
const falso = new UpdaterFalso();

upd.iniciar(() => ventana, { empaquetada: true, portable: false, updater: falso });
ok('con soporte, arranca inactivo', upd.leer().fase === 'inactivo');

// La búsqueda silenciosa del arranque, sin nada nuevo.
await upd.buscar({ manual: false });
ok('la silenciosa: buscando → al-dia', fases() === 'buscando → al-dia', fases());
ok('y ningún aviso va marcado como manual', enviados.every((e) => e.manual === false));

// El clic del usuario, con ese "al día" todavía en el estado. Acá salían dos.
enviados.length = 0;
await upd.buscar({ manual: true });
ok('el clic: buscando → al-dia, sin el al-dia viejo adelante', fases() === 'buscando → al-dia', fases());
ok('un solo "al día" por búsqueda', enviados.filter((e) => e.fase === 'al-dia').length === 1);
ok('y llega marcado como manual', enviados.at(-1).manual === true);

// Sin internet: el evento y el rechazo traen el mismo error.
enviados.length = 0;
falso.falla = new Error('getaddrinfo ENOTFOUND github.com');
await upd.buscar({ manual: true });
ok('la fallida: buscando → error, una sola vez', fases() === 'buscando → error', fases());
ok('y el error llega traducido', enviados.at(-1).error === 'No se pudo llegar a GitHub. ¿Hay internet?');

// Vuelve internet: la siguiente no arrastra el error viejo como si fuera nuevo.
enviados.length = 0;
falso.falla = null;
await upd.buscar({ manual: true });
ok('tras un error, la siguiente: buscando → al-dia', fases() === 'buscando → al-dia', fases());
ok('y ya no queda error en el estado', upd.leer().error === '');

// Hay versión nueva y la descarga falla: lo mismo, un solo error.
enviados.length = 0;
falso.hay = { version: '9.9.9', releaseName: 'Idiolect 9.9.9', files: [{ size: 1234 }] };
await upd.buscar({ manual: true });
ok('con versión nueva: buscando → disponible', fases() === 'buscando → disponible', fases());
ok('y dice cuál y cuánto pesa', upd.leer().version === '9.9.9' && upd.leer().bytes === 1234);
enviados.length = 0;
falso.falla = new Error('ESOCKETTIMEDOUT');
await upd.descargar();
ok('la descarga fallida: descargando → error, una sola vez', fases() === 'descargando → error', fases());

console.log(`\n═══ ${pass} ok · ${fail} fallas ═══\n`);
process.exit(fail ? 1 : 0);
