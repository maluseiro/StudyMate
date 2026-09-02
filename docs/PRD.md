# StudyMate — PRD

> Biblioteca personal de cursos respaldados. Un solo usuario, un solo fin de semana.
> Estado: borrador para aprobar antes de escribir código.

---

## 1. El problema

Los cursos viven en carpetas anidadas en el disco. Retomar uno cuesta tres pasos:
acordarse de dónde está la carpeta, navegar hasta el módulo correcto, y recordar por
qué video ibas. Ese roce es chico pero constante, y alcanza para no ver el curso.

El problema real no es "no tengo un reproductor". Es **no tengo un índice ni memoria de
mi propio progreso**.

## 2. Objetivo

Retomar cualquier curso en un clic desde una sola pantalla, y que la app recuerde por
dónde ibas — en la PC y en el celular.

**Métrica de éxito:** en un mes de uso, no abrir nunca el Explorador de Windows para
buscar una clase.

## 3. Usuario y contexto

- **Un solo usuario.** Sin login, sin roles, sin permisos, sin multiusuario.
- Los archivos viven en el disco de una **PC con Windows** y no se mueven.
- Se usa en la PC y, ocasionalmente, en el **celular dentro de la misma red WiFi**.
- Sin homelab, sin VM, sin nube. Se abre con doble clic y se cierra como cualquier programa.

## 4. Principios de diseño

1. **El disco es la fuente de la verdad, y la app nunca lo modifica.** Renombrar y
   reordenar son metadata en la base de datos. La app abre archivos en modo lectura y
   nada más. Un bug jamás puede costarte un curso.
2. **Cero configuración.** Una sola cosa que configurar en toda la app: la ruta de la
   biblioteca.
3. **Si el escáner se equivoca, se corrige a mano.** No se persigue un parser perfecto;
   se persigue un parser razonable con edición fácil encima.
4. **Un reescaneo nunca pierde nada.** Progreso, notas y títulos editados sobreviven a
   reescanear, renombrar carpetas y agregar cursos.

## 5. No-objetivos

Escribirlos es lo que hace que el proyecto entre en un fin de semana:

- No se expone a internet ni tiene autenticación.
- No transcodifica video (sin ffmpeg).
- No descarga, busca ni gestiona la adquisición de cursos.
- No hay cuentas, pagos, certificados, quizzes, rachas ni gamificación.
- No sincroniza con la nube: el progreso vive en un SQLite local.
- No es una app de escritorio empaquetada (sin Electron, sin instalador).
- No se integra con Notion ni con ninguna API externa: el puente es un archivo Markdown.
- No hay rachas, logros ni estadísticas de tiempo estudiado. Son lindos en la demo,
  irrelevantes a los tres días, y cobran mantenimiento para siempre.

## 6. Alcance del MVP (v1 — el fin de semana)

Catorce funciones. Las diez primeras salieron de la lista original; las cuatro
últimas se sumaron al revisar el diseño.

| # | Función | Por qué entra |
|---|---------|---------------|
| 1 | Escanear la carpeta y armar el índice de cursos, módulos, videos y PDFs | Sin esto no hay app |
| 2 | Reproductor con seek, velocidad 1x–2x y espacio para pausar | El núcleo del uso diario |
| 3 | Guardar posición cada 10s y reanudar, en PC o celular | **La razón de ser del proyecto** |
| 4 | Marcar la clase vista al llegar al 90% | Sin esto el % del curso no es confiable |
| 5 | Avance del curso y próxima clase pendiente | Es lo que convierte el índice en "seguir viendo" |
| 6 | Notas por clase, autosave, botón de marca de tiempo | Barato de construir, alto valor |
| 7 | Abrir los PDFs del módulo | Barato: es servir un archivo |
| 8 | **Renombrar** clases y módulos sin tocar el disco | Es el escape hatch del escáner imperfecto |
| 9 | Estado y tipo por curso, con filtros en la biblioteca | Es lo que hace usable una biblioteca de 40 cursos |
| 10 | Marca "volver a esto" y filtro para verlas | Barato: un booleano y un filtro |
| 11 | Sección de **Recursos** del curso: PDFs, imágenes, código y comprimidos | El material que no es video estaba escondido en una pestaña |
| 12 | Portada por curso: generada por defecto, personalizada opcional | Es lo que hace que la biblioteca se lea como catálogo y no como lista |
| 13 | Agregar otra carpeta de biblioteca y reescanear | Los cursos no viven todos bajo la misma raíz |
| 14 | Marcar vista a mano y botón "Siguiente clase" | El 90% no alcanza para los .mkv, y evita volver al índice entre clases |

### Detalles del reproductor — 1 h 30 en total

Cuatro micro-funciones que no cambian lo que la app hace, pero sí lo que se siente
al usarla. Van juntas porque comparten el mismo código y ninguna pasa de media hora:

| # | Detalle | Por qué |
|---|---------|---------|
| 15 | **Atajos de teclado**: espacio, ←/→ 5 s, J/L 10 s, N siguiente, M marcar vista | Es la diferencia entre un reproductor y una página web. Si solo entra una de las cuatro, que sea esta |
| 16 | **Autoplay de la siguiente clase**, con contador de 5 s cancelable | Cada vuelta al índice es una oportunidad de abandonar. Esto es lo que hace que veas tres clases seguidas |
| 17 | **Reanudar 5 segundos antes** de donde quedaste | Recuperás el contexto en vez de caer en mitad de una frase. Truco viejo de las apps de podcast |
| 18 | **Recordar la velocidad por curso** | Ponés 1.75x en un curso denso y se queda ahí |

### La función que saco del MVP: reordenar clases

Es la única de tu lista que dejo afuera, y quiero ser explícito sobre por qué:

- El orden natural por nombre de archivo (`01`, `02`, `10` ordenados como números, no
  como texto) acierta en la enorme mayoría de los cursos. El caso que arregla es raro.
- Es la función más cara de la lista: drag & drop, persistir el orden, y después
  hacer que el reescaneo respete el orden manual sin pisarlo.
- **Renombrar cubre el 90% del dolor real.** El problema típico no es "las clases están
  en mal orden", es "las clases se llaman `vid_004_final_v2.mp4`".

Va primera en la lista de v1.1. Si el sábado sobra tiempo, se adelanta.

## 7. Fuera del MVP

**v1.1 — lo primero que sigue, en este orden**

1. **Exportar las notas de un curso a Markdown** (~45 min) — ver más abajo por qué
   Markdown y no una integración con Notion
2. Reordenar clases y moverlas entre módulos (drag & drop)
3. Buscador global por título de clase o texto de las notas
4. Escaneo de duraciones con `ffprobe` en segundo plano (cierra el Riesgo 3)
5. Miniaturas del video como portada: un frame del minuto 30 de la primera clase

**v2 — si el proyecto sobrevive al primer mes**
- **Transcribir los cursos con Whisper local e indexar el texto.** Buscás un concepto
  y saltás al minuto exacto de cualquier clase de cualquier curso, aunque no te
  acuerdes en cuál estaba. Es un proyecto en sí mismo — días, no horas — pero es lo
  único de toda esta lista que da algo que las plataformas comerciales no dan bien
- Detectar archivos faltantes y reconectarlos cuando movés una carpeta
- Subtítulos (.srt/.vtt) en el reproductor

### Por qué Markdown y no la API de Notion

La integración directa con Notion cuesta unas ocho veces más por el mismo resultado:
token de integración, elegir página o base destino, mapear las notas a bloques, y
decidir qué pasa al reexportar (¿duplica, actualiza, borra?). Esa última pregunta sola
se lleva una tarde.

Notion importa Markdown nativamente: arrastrás el `.md` a una página y queda
formateado. El mismo archivo sirve además para Obsidian, Logseq, o un `grep` dentro de
cinco años, y no depende de un token que caduca ni de una API que cambia.

La API valdría la pena solo para **sincronización continua** — que editar una nota acá
actualice sola la página allá. Para "terminé el curso, quiero mis notas afuera",
Markdown gana por afano.

## 8. Modelo de datos

Cuatro tablas. SQLite, un archivo, sin migraciones que administrar.

```
courses   id, path, folder_name, title, title_edited, status, kind,
          last_lesson_id, last_opened_at, missing

modules   id, course_id, rel_path, folder_name, title, title_edited,
          sort_order, missing

lessons   id, course_id, module_id, rel_path, file_name, title, title_edited,
          kind (video|pdf|recurso), ext, playable, sort_order,
          size, duration, position, watched, flagged, missing

notes     lesson_id, body, updated_at
```

Tres decisiones que valen la pena:

- **`rel_path` es la identidad de una clase**, no el `id`. Es lo que permite reescanear
  sin duplicar y sin perder progreso.
- **`title_edited` protege tus ediciones.** El reescaneo recalcula el título automático
  siempre, pero solo lo escribe si vos no lo tocaste.
- **`missing` en vez de borrar.** Si un archivo desaparece se marca, no se elimina: tus
  notas y tu progreso siguen ahí cuando el archivo vuelva.

## 9. Reglas de negocio

- **Vista:** `position / duration >= 0.90`, o marcada a mano.
- **Avance del curso:** clases de video vistas ÷ total de clases de video. Los PDFs no
  cuentan para el porcentaje.
- **Próxima clase:** la primera no vista, en orden de módulo y después de clase.
- **Estado automático, con override manual:** `sin_empezar` → `en_curso` al reproducir la
  primera clase; → `terminado` al 100%. `en_pausa` es siempre manual. Si tocás el estado
  a mano, la automática no lo vuelve a pisar.
- **`entretenimiento`** queda fuera de los filtros de estudio por defecto.

## 10. Pantallas

**Biblioteca**
- Bloque "seguir donde quedaste" arriba: último curso, última clase y cuánto le falta
- Filtros por estado (en curso · sin empezar · en pausa · terminado) + entretenimiento
- Lista de cursos: título, estado, %, vistas/total y barra de avance

**Curso · Contenido**
- Título editable y la ruta en el disco
- Selectores de estado y tipo
- Clases agrupadas por módulo: tu título arriba, el nombre real del archivo abajo
- Renombrar en línea
- Botón "Seguir curso" → abre la primera clase sin terminar

**Curso · Recursos** (pestaña)
- Todo lo que no es video, agrupado por módulo
- Filtros por tipo: PDF, imágenes, código, comprimidos
- Miniatura para las imágenes; PDFs e imágenes abren embebidos, el resto abre la carpeta

**Clase**
- Reproductor: barra, velocidad 1x–2x, minuto actual
- Título, cuánto le queda, botón "volver a esto"
- Pestaña Notas, con botón de marca de tiempo
- Pestaña Recursos, con los archivos del módulo
- Barra lateral con las clases del curso y el estado de cada una

## 11. Arquitectura

```
Windows PC
├── studymate.bat        doble clic para abrir
└── node server/         Express, escucha en 0.0.0.0:4173
    ├── SQLite           data/studymate.db  (progreso, notas, títulos)
    ├── /media/:id       streaming con Range → seek en la barra
    └── web/             HTML + CSS + JS, sin build step
         ↑                    ↑
    localhost:4173      192.168.x.x:4173  (celu, misma WiFi)
```

**Stack:** Node + Express, y nada más. SQLite viene dentro de Node desde la 22.5, así
que **no hay ningún módulo nativo que compilar**: instalar no necesita Python ni
compilador de C++, que es exactamente lo que no hay en una máquina de trabajo con
permisos restringidos. Frontend sin framework y sin bundler: se edita un archivo y se
recarga.

**Por qué un proceso local y no una app de escritorio:** para que el celular vea el mismo
progreso, algo tiene que responder por red. Un proceso Node que abrís y cerrás es lo más
liviano que cumple eso — no es un servicio, no arranca con Windows, no es un homelab.

**Por qué sin framework:** para una app de tres pantallas, un bundler agrega más
mantenimiento del que ahorra, y en un proyecto de fin de semana el tiempo de setup se
paga con funciones que no vas a construir.

## 12. Riesgos y decisiones ya tomadas

**Riesgo 1 — Codecs. El más serio del proyecto.**
Chrome no reproduce `.mkv`, `.avi`, ni H.265/HEVC. Parte de tu biblioteca puede no abrir.
*Decisión:* no transcodificar (arrastraría ffmpeg y varias horas). Las clases no
reproducibles se marcan con un badge y un botón **"Abrir en el reproductor de Windows"**
que lanza el archivo con VLC o el que tengas por defecto. Esas clases se marcan vistas a
mano. **Verificar el sábado a la mañana**, antes que nada: si el 80% de tu biblioteca es
`.mkv`, el plan cambia.

**Riesgo 2 — El escáner se come el fin de semana.**
Los nombres vienen en veinte formatos. Es un pozo sin fondo.
*Decisión:* timebox de 90 minutos. Lo que no acierte se arregla renombrando a mano —
por eso renombrar es MVP y reordenar no.

**Riesgo 3 — Duraciones.**
Sin ffprobe no se sabe cuánto dura un video hasta abrirlo.
*Decisión:* la duración la reporta el navegador la primera vez que abrís la clase y queda
guardada. Consecuencia aceptada: "cuánto le falta" aparece vacío hasta que abrís la clase
una vez. El escaneo previo de duraciones es v1.1.

**Riesgo 4 — Firewall de Windows.**
La primera vez que arranque, Windows va a pedir permiso de red. Hay que aceptarlo (red
privada) o el celular no entra.

**Riesgo 5 — Scope creep.**
Es lo que mata los proyectos de fin de semana, no la dificultad técnica.
*Decisión:* la sección 7 existe para eso. Toda idea nueva va a v1.1, sin discusión, hasta
que las 10 del MVP estén andando.

## 13. Plan del fin de semana

| Bloque | Horas | Qué queda funcionando |
|--------|-------|------------------------|
| Sáb AM | 3–4 | Chequeo de codecs · esqueleto · escáner · base de datos → `npm start` lista los cursos con sus módulos y clases |
| Sáb PM | 4–5 | Vista de clase · reproductor · guardado de posición · atajos · autoplay → ver un video, cerrar, volver y reanudar |
| Dom AM | 3–4 | Biblioteca · seguir donde quedaste · filtros · estados · % · marca "volver a esto" |
| Dom PM | 4–5 | Notas · Recursos · renombrar · portadas · `studymate.bat` · pulido |

**~18 h 30.** Creció desde las 14 originales: Recursos, portadas y agregar carpeta
suman unas 2 h 15, y los detalles del reproductor otra hora y media.

**Seamos honestos: esto ya no entra en un fin de semana.** Son dos fines de semana, o
uno solo aplicando la línea de corte de abajo. Lo digo ahora y no el domingo a las
once de la noche.

El sábado a la tarde ya tenés lo que motivó el proyecto: retomar un video donde lo
dejaste. Si el domingo se cae, ya ganaste.

**Línea de corte del domingo.** Si el tiempo aprieta, esto cae a v1.1 en este orden, y
ninguna de las tres rompe nada:

1. Los filtros por tipo en Recursos — una lista plana funciona igual
2. La portada personalizada — la generada ya se ve bien
3. Agregar una segunda carpeta de biblioteca — con una raíz alcanza para empezar

## 14. Definición de "listo"

El MVP está terminado cuando podés hacer esto sin tocar el Explorador de Windows:

1. Abrís `studymate.bat`, se abre el navegador en la biblioteca
2. Arriba de todo está el curso que estabas viendo y la clase que sigue
3. Le das clic y el video arranca **en el segundo exacto** donde lo dejaste
4. Lo ves a 1.5x, escribís una nota con marca de tiempo, cerrás
5. Agarrás el celular, entrás por la IP de tu PC, y ves el progreso actualizado
6. Marcás un curso como "en pausa" y desaparece del filtro "en curso"
