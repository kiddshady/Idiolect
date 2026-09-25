'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   ONYX — puente IPC
   El renderer no tiene fs, ni require, ni red: `contextIsolation` está activo.
   Todo lo que necesite del sistema pasa por acá, y acá se decide qué se puede
   pedir. Es la superficie de ataque de la app: todo lo que agregues es una
   puerta más.

   Convención: cada handler devuelve {ok:true, data} o {ok:false, error}. El
   preload la desenvuelve y convierte el error en una excepción real, así el
   renderer escribe try/catch normal en vez de chequear banderas.
   ═══════════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const { ipcMain, app, BrowserWindow } = require('electron');
const store = require('./store.cjs');
const glosario = require('./glosario.cjs');
const actualizador = require('./actualizador.cjs');

/* Las colecciones que el renderer puede tocar. Es una lista blanca a
   propósito: sin ella, cualquier bug en el renderer puede crear carpetas
   sueltas en tu directorio de datos. */
const COLLECTIONS = [glosario.COLECCION];

function coll(name) {
  if (!COLLECTIONS.includes(name)) throw new Error(`colección no permitida: ${name}`);
  return store.collection(name);
}

/** Envuelve un handler para que un throw viaje como error y no como crash. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      console.error(`[ipc] ${channel}:`, err);
      return { ok: false, error: err?.message || String(err) };
    }
  });
}

/* ── Vigilar la carpeta ──────────────────────────────────────────────────────
   Las entradas no las escribe solo la app: Claude anota con tools/anotar.cjs
   y Fran puede tocar un JSON a mano. Ante cualquier cambio en la carpeta se
   regenera glosario.md (así un JSON editado a mano también llega a Claude) y
   se le avisa a la ventana para que recargue.

   Con debounce porque una escritura atómica son varios eventos (el .tmp que
   aparece, el rename) y un guardado de la app dispararía cinco recargas. */
let vigia = null;
let espera = null;

function vigilar() {
  const dir = store.collection(glosario.COLECCION).dir;
  fs.mkdirSync(dir, { recursive: true });
  try {
    vigia = fs.watch(dir, (_tipo, archivo) => {
      if (archivo && !String(archivo).endsWith('.json')) return;
      clearTimeout(espera);
      espera = setTimeout(async () => {
        await glosario.exportar().catch((err) => console.error('[glosario]', err));
        for (const w of BrowserWindow.getAllWindows()) w.webContents.send('entradas:cambio');
      }, 250);
    });
  } catch (err) {
    // Sin vigía la app sigue sirviendo: solo no se entera de lo que escribe
    // otro. No vale la pena tumbar el arranque por eso.
    console.error('[vigia]', err);
  }
}

function register() {
  handle('app:info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    dataDir: store.ROOT,
    glosario: glosario.ARCHIVO,
    electron: process.versions.electron,
  }));

  handle('settings:get', () => store.loadSettings());
  handle('settings:save', (patch) => store.saveSettings(patch));

  handle('doc:read', (name, fallback = null) => store.doc(name, fallback).read());
  handle('doc:write', (name, data) => store.doc(name).write(data).then(() => true));

  handle('col:list', (name) => coll(name).list());
  handle('col:get', (name, id) => coll(name).get(id));
  handle('col:save', async (name, item) => {
    const it = name === glosario.COLECCION ? glosario.normalizar(item) : item;
    const saved = await coll(name).save(it);
    await glosario.exportar();
    return saved;
  });
  handle('col:remove', async (name, id) => {
    await coll(name).remove(id);
    await glosario.exportar();
    return true;
  });
  handle('col:next-id', (name, prefix) => coll(name).nextId(prefix));

  handle('glosario:exportar', () => glosario.exportar());

  /* ── Actualizaciones: el renderer pide; los cambios de estado le llegan solos
     por 'update:cambio' (ver actualizador.cjs). ── */
  handle('update:estado', () => actualizador.leer());
  handle('update:buscar', (opts) => actualizador.buscar(opts));
  handle('update:descargar', () => actualizador.descargar());
  handle('update:instalar', () => actualizador.instalar());

  vigilar();
}

app.on('will-quit', () => vigia?.close());

module.exports = { register, COLLECTIONS };
