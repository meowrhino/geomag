# geomag · taller

Un modelador de Geomag en el navegador: bolas de acero, barras magnéticas
y los paneles de la caja de siempre — triángulo verde, cuadrado azul,
rombo amarillo y pentágono rojo. Sin build, sin dependencias instaladas:
un HTML, tres módulos ES y three.js desde CDN.

## Correr

Cualquier servidor estático sirve:

```sh
npx serve .
```

y abrir http://localhost:3000 (o el puerto que diga).

## Cómo se juega

- **clic** en una bola → se selecciona y aparecen los *fantasmas*: las
  direcciones sugeridas. Clic en un fantasma añade barra + bola y encadena.
- **e** (o el botón "ejes") cambia el juego de direcciones: **diagonales**
  (FCC: tetraedros, octaedros), **cúbicos** (torres rectas y cubos, que en
  FCC son imposibles: no hay tres pasos perpendiculares), **hexagonales**
  (hexágonos con centro, prismas) y **libre**: la esfera entera de radio L
  alrededor de la bola se vuelve clicable — el imán de verdad no sabe de
  ejes. Se mezclan en la misma estructura.
- Los fantasmas **verdes** son el alcance del imán: enganchan con una bola
  que ya existe y cierran ciclos.
- Elige un **panel** en la bandeja y los huecos donde cabe se iluminan;
  clic para colocarlo. El panel fuerza la forma: el mismo ciclo de 4 se
  vuelve cuadrado o rombo según la pieza que metas, y 5 barras + panel
  rojo = pentágono regular. Si la estructura no cede, "ese panel no encaja".
- **gravedad** suelta tu criatura al mundo, a ver si aguanta (Verlet + suelo
  con fricción; las estructuras se derrumban con la misma honestidad que
  las de verdad).
- **clic derecho** (o la **goma** de la bandeja, tecla **9** — en móvil no
  hay clic derecho) borra bola, barra o panel · **1–8** elige pieza ·
  **⌘Z** deshace · **⇧⌘Z** rehace · **esc** suelta
- Cada pieza hace *clac* al encajar, como debe ser.
- Se guarda solo en `localStorage`; **compartir enlace** mete el JSON
  comprimido en el hash de la URL (sin servidor), y también hay
  exportar/importar `.json`.

## La idea bonita

Una estructura de Geomag es un **grafo embebido en el espacio**: bolas =
nodos, barras = aristas de longitud fija. El modelo
([src/structure.js](src/structure.js)) es puro — un `Map` de bolas, un
`Map` de barras, un `Map` de paneles — y no sabe nada de three.js.

Quien mantiene la geometría es el **solver**
([src/solver.js](src/solver.js)): relajación por restricciones de
distancia (*position-based dynamics*, ~50 líneas). Cada barra empuja sus
dos bolas hacia su longitud; iterar converge. Un panel son cuerdas
internas extra — las diagonales del polígono ideal (las del pentágono
miden φ·L, el número áureo haciendo cameo) — así que **el panel que
eliges decide la forma**, igual que en el juguete, donde encajar el panel
rigidizaba y esculpía la figura. Si tras relajar el peor error relativo
supera el 8%, la pieza no encaja y se rechaza sola.

Las 12 direcciones de la red FCC (permutaciones de (±1,±1,0), donde toda
figura clásica cierra exacta) sobreviven como *sugerencias* de colocación.
Y los huecos para paneles son los ciclos simples del grafo, filtrados por
planitud con la normal de Newell — un octaedro tiene 15 ciclos de 4, pero
solo 3 son cuadrados de verdad.

La vista ([src/main.js](src/main.js)) nunca es la fuente de verdad: diff
modelo→meshes tras cada mutación, y cada frame copia posiciones (las bolas
se mueven: el solver manda).

## Ideas para seguir

- modo caja limitada: empiezas con las piezas contadas, como en la realidad
- galería de construcciones guardadas con miniaturas
- barras coloreadas por tensión: que la estructura avise antes de derrumbarse
- repintar barras ya puestas clicándolas con otro color activo
