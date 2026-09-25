# Idiolect

Glosario de escritorio para anotar tus propias expresiones, abreviaturas y apodos,
y que [Claude Code](https://claude.com/claude-code) los lea al empezar cada sesión.

Cada vez que guardás una entrada, Idiolect regenera un `glosario.md` compacto (una
línea por expresión). El `CLAUDE.md` global lo importa, así que Claude lo tiene en
contexto sin que nadie se lo pase:

```markdown
<!-- ~/.claude/CLAUDE.md -->
@S:/tools/Idiolect/data/glosario.md
```

## Cómo se usa

- **Glosario**: la lista, con búsqueda que ignora tildes y mayúsculas, y filtro por
  etiqueta. A la derecha se edita la expresión elegida; cada campo se guarda al salir.
- **Por revisar**: las entradas sin confirmar. Las que propone Claude entran así, y en
  el glosario salen marcadas para que las lea con reserva.
- `Ctrl+N` agrega una expresión y `Ctrl+F` busca. Con las flechas se recorre la lista.

## Anotar desde la línea de comandos

Es lo que usa Claude cuando le decís «anotá que X significa Y»:

```
node tools/anotar.cjs --expresion "daleee" --significa "Sí, con entusiasmo." --confirmada
node tools/anotar.cjs --listar
node tools/anotar.cjs --ayuda
```

Si la expresión ya existe (sin mirar tildes ni mayúsculas), se actualizan solo los
campos que pases. Si la app está abierta, la lista se actualiza sola.

## Datos

Un archivo JSON por expresión en `data/entradas/`, más el `glosario.md` generado. La
carpeta es fija (`S:\tools\Idiolect\data`) para que la app instalada, el código fuente
y el CLI escriban en el mismo lugar; se cambia con la variable de entorno
`IDIOLECT_DATA`. Si editás un JSON a mano, la app lo detecta y regenera el glosario.

## Desarrollo

```
npm install
npm run dev       # con la consola del renderer en la terminal
npm test          # tokens, almacenamiento, glosario, CLI y actualizador
npm run smoke     # recorre la UI real contra una carpeta temporal
npm run build     # instalador en dist/
npm run release   # compila, sube a GitHub, verifica y publica
```

Construida sobre Onyx, la plantilla de apps Electron de Umbrovex Systems. Se
actualiza sola desde los releases de este repositorio.

## Licencia

MIT. Copyright © 2026 Kidd Shady · Umbrovex Systems. Las fuentes incluidas tienen su
propia licencia; ver [NOTICE](NOTICE).
