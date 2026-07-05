# geomag · taller

Un modelador de Geomag en el navegador: bolas de acero, barras magnéticas
de colores, y las 12 direcciones de siempre. Sin build, sin dependencias
instaladas — un HTML, dos módulos ES y three.js desde CDN.

## Correr

Cualquier servidor estático sirve:

```sh
npx serve .
# o
python3 -m http.server 4173
```

y abrir http://localhost:4173

## Cómo se juega

- **clic** en una bola → se selecciona y aparecen 12 *fantasmas* alrededor
- **clic** en un fantasma → añade barra + bola (la nueva queda seleccionada,
  así que puedes encadenar). Los fantasmas verdes cierran un ciclo con una
  bola que ya existe.
- **clic derecho** sobre bola o barra → borrar
- **1–4** cambia el color de barra · **⌘Z** deshace · **esc** suelta
- arrastrar orbita, rueda hace zoom, arrastrar con botón derecho desplaza
- se guarda solo en `localStorage`; exportar/importar `.json` para compartir

## La idea bonita

Una estructura de Geomag es un **grafo embebido en el espacio**: las bolas
son nodos y las barras aristas de longitud fija. Todas las figuras clásicas
(triángulo, cuadrado, tetraedro, octaedro, pirámide) viven en la **red FCC**
(cúbica centrada en caras): si una barra mide √2, cada bola cae en
coordenadas *enteras*.

Eso significa:

- cero deriva de coma flotante: una posición es un string `"x,y,z"` de enteros
- una bola es una entrada en un `Set`, una barra en un `Map` — el modelo
  entero ([src/structure.js](src/structure.js)) no sabe nada de three.js
- deshacer = instantáneas JSON (el estado es diminuto)
- la vista ([src/main.js](src/main.js)) hace un diff modelo→meshes tras
  cada mutación; la escena nunca es la fuente de verdad

## Ideas para seguir

- modo gravedad: pasar el grafo a un motor de físicas y ver si tu torre aguanta
- paneles (los cuadrados y triángulos transparentes que rigidizaban)
- compartir estructuras por URL (el JSON comprimido en el hash)
- contador de piezas por color, como cuando se te acababan las barras azules
