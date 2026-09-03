# StudyMate

Biblioteca personal de cursos respaldados. Indexa las carpetas de tu disco, reproduce
los videos y recuerda por dónde ibas — en la PC y en el celular.

La app **nunca escribe en tus carpetas de cursos**: solo las lee. Los títulos que
editás, el progreso y las notas viven en un SQLite propio, aparte de tus archivos.

## Requisitos

**Node.js 22.5 o más nuevo** ([nodejs.org](https://nodejs.org), versión LTS). Esa es la
versión desde la que Node trae SQLite adentro, así que la instalación no compila nada:
no hace falta Python ni compilador de C++. La única dependencia es Express.

## Arrancar

En Windows, doble clic a **`studymate.bat`**. Comprueba tu versión de Node, instala
Express la primera vez y abre el navegador.

A mano, en cualquier sistema:

```
npm install
npm start
```

Queda en `http://localhost:4173`.

### Desde el celular

Al arrancar, la consola imprime la dirección de tu PC en la red local
(`http://192.168.x.x:4173`). Entrá ahí desde el celular con la misma WiFi y vas a ver
el mismo progreso: se guarda en la PC, no en el navegador.

La primera vez, **Windows va a pedir permiso de red**: aceptá "redes privadas" o el
celular no va a poder entrar.

## Formatos de video

| Formato | Qué pasa |
|---------|----------|
| `.mp4`, `.m4v`, `.webm` | Se reproducen directo |
| `.mov` | Se intenta; si el códec no va, cae al mismo camino que los de abajo |
| `.mkv`, `.ts`, `.avi`, `.wmv` | El navegador no los abre. La clase ofrece **Convertir a MP4** o abrirlos con VLC |

**Convertir a MP4** no recomprime nada: cambia el envase con `ffmpeg -c copy`, así que
es rápido y no pierde calidad. El archivo original queda intacto; la copia va a una
subcarpeta `.studymate/` que el escáner ignora, así el curso no queda duplicado.

Para que aparezca ese botón necesitás [ffmpeg](https://ffmpeg.org/download.html) en el
PATH. Sin ffmpeg, esas clases solo se pueden abrir con un reproductor externo.

## Cómo arma el índice

- Cada **carpeta de biblioteca** que agregás se recorre, y cada subcarpeta directa es un
  **curso**.
- Dentro de un curso, cada subcarpeta es un **módulo**; los archivos sueltos de la raíz
  van a un módulo "General".
- Los videos son **clases**; los PDFs, imágenes, código y comprimidos van a **Recursos**.
- El orden sale del número que traiga el nombre del archivo (`2` antes que `10`).
- `.ts` se resuelve mirando la firma binaria del archivo: si es MPEG-TS es video, si no
  es TypeScript y va a Recursos.

Un reescaneo **nunca pierde nada**: la identidad de una clase es su ruta relativa dentro
del curso, así que renombrar en la app, el progreso y las notas sobreviven. Lo que
desaparece del disco se marca, no se borra: si el archivo vuelve, vuelve con sus notas.

## Marcar en bloque

Si ya viste parte de un curso antes de tener StudyMate, marcar de a una clase es
tedioso. El doble tilde en la cabecera de cada **módulo** lo marca entero (y si ya está
completo, lo desmarca). En la cabecera del **curso**, "Marcar todo visto" hace lo mismo
con todas las clases, con una confirmación de por medio.

Ni las notas ni la posición de cada video se tocan: podés marcar un curso entero como
visto y aun así volver a cualquier clase donde la habías dejado.

## Cómo está organizada

Una **barra superior** con la navegación, el buscador al centro y las acciones a la
derecha. No hay barra lateral: lo que no es navegación (carpetas de biblioteca,
reescanear, tema) vive en **Ajustes**.

La **pantalla de clase** cambia esa barra por una de contexto — volver al curso, qué
curso es, cuánto llevás y la velocidad. Ahí no se navega ni se busca, y cada píxel de
alto es video.

## Buscar

La tecla `/` desde cualquier pantalla enfoca el buscador de la barra. Busca en tres lugares a la vez:
el título que le pusiste a cada clase, **el nombre real del archivo en el disco**, y el
texto de tus notas.

## Notas

Se guardan solas mientras escribís. El botón de la izquierda inserta la marca de tiempo
del minuto actual, así una nota queda anclada al momento del video.

**Exportar notas** en la pantalla del curso baja un `.md` con todas tus notas agrupadas
por módulo y clase. Notion, Obsidian y Logseq lo importan arrastrándolo.

## Reordenar

Si el orden que sale del nombre de los archivos no sirve, arrastrá las clases dentro de
un módulo. A partir de ahí ese módulo queda ordenado a mano: el escaneo no lo vuelve a
tocar y las clases nuevas se agregan al final. Un botón lo devuelve al orden original.

## Portadas

Cada curso arranca con una portada generada: un color estable derivado del título y sus
iniciales. Se puede reemplazar por una imagen propia, o por **un fotograma del video**
(lo saca al 12% de la primera clase, porque el arranque suele ser una placa negra).

## Duraciones

Sin ffprobe, la duración de una clase solo se conoce al abrirla. En **Ajustes**,
"Calcular duraciones" las completa todas de una pasada, con barra de avance.

**ffmpeg y ffprobe son dos binarios distintos** y se informan por separado en Ajustes:
convertir a MP4 y sacar portadas usan el primero, leer duraciones el segundo. Si
instalaste ffmpeg con StudyMate abierto, "Volver a comprobar" lo detecta sin reiniciar.

## Tema

Claro, oscuro, o **Auto** para seguir al sistema. El botón de la barra superior cicla
entre los tres; en Ajustes está el selector completo. Queda guardado en el navegador.

## Atajos en la pantalla de clase

| Tecla | Acción |
|-------|--------|
| `Espacio` | Pausa y reanuda |
| `←` `→` | 5 segundos atrás / adelante |
| `J` `L` | 10 segundos atrás / adelante |
| `N` `P` | Clase siguiente / anterior |
| `M` | Marcar vista (o desmarcar) |
| `F` | Volver a esto |
| `/` | Enfocar el buscador (fuera de la pantalla de clase) |

Al reanudar una clase arranca **5 segundos antes** de donde la dejaste, para que
recuperes el hilo. Al terminar, la siguiente arranca sola con 5 segundos para cancelar.

## Estructura

```
server/
  index.js     rutas HTTP
  db.js        esquema SQLite y migraciones (node:sqlite, sin módulo nativo)
  scanner.js   recorrido del disco e indexado
  naming.js    limpieza de títulos, orden natural, tipos de archivo
  media.js     streaming con Range, apertura externa, conversión
web/           interfaz: HTML, CSS y JS sin build step
data/          la base y las portadas (no se versiona)
tests/
  browser.mjs  pruebas de reproducción y progreso
  features.mjs pruebas de buscador, tema, reordenar y exportar
```

No hay bundler ni framework: se edita un archivo y se recarga la página.

## Pruebas

Son dos series, y necesitan Playwright y una biblioteca cargada con videos de verdad:

```
npm install -D playwright
node tests/browser.mjs     # reproducción, progreso, notas, atajos, autoplay
node tests/features.mjs    # buscador, tema, reordenar, exportar, duraciones
```

Esperan un servidor en `localhost:4173` (o el que digas en `SM_URL`). Eligen solos con
qué curso y qué clase trabajar, así que sirven contra cualquier biblioteca.

## Lo que no hace

No se expone a internet ni tiene usuarios. No descarga cursos. No recomprime video. No
sincroniza con la nube: para sacar tus notas afuera está la exportación a Markdown. No
hay rachas ni estadísticas de tiempo estudiado, a propósito.
