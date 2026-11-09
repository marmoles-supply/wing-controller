# Sharing the project

Share the rendered GitHub overview directly:
**https://github.com/marmoles-supply/wing-controller/blob/main/README.md#wing-controller**.
It opens the presentation inside GitHub, without the repository's root file table
above it. For Spanish readers, use
[README.es.md](https://github.com/marmoles-supply/wing-controller/blob/main/README.es.md#wing-controller).
The [repository](https://github.com/marmoles-supply/wing-controller) holds source,
issues and contributions.

The [1280 × 640 cover](../assets/product/hero.png) is available for a post image.
The [channel selector](../assets/product/channel-selection-light.png) and
[notices/HUD detail](../assets/product/messages-detail.png) show more of the app.
These are offline interface examples, not a recorded live-console session.

The paragraphs below are drafts for the maintainer to adapt. They have not been
posted to any forum or service. Follow each community's posting rules and
identify yourself as the project maintainer. Do not imply affiliation with
Behringer or Music Tribe.

## English

I have shared WING CONTROLLER, an independent automation and metering project
for Behringer WING on Apple Silicon Macs. It works alongside the console or your
usual control application.

Some of the capabilities worth exploring:

- **WHEN / IF / THEN macros:** up to 16 AND/OR conditions and 32 ordered steps,
  with waits, toggles, HUDs, MIDI/OSC sends and linear or smooth fades. Fades can
  read the current value and make relative changes; supported actions accept
  channel lists and ranges.
- **Metering beyond channels:** mix Sources, channels, buses, mains, matrices and
  outputs. Local inputs, AES50, StageConnect, USB and Card/Dante are among the
  Source families, depending on the console and installed hardware.
- **Source meters as triggers and IF conditions**, even when those meters are
  not displayed. Build named meter banks with your own labels and ordering;
  the separate Meter Bridge can show a different bank on another screen, with
  LED bars, analogue-style needles or history graphs.
- **Inter-app automation in both directions:** learn incoming MIDI/OSC bindings,
  add binding conditions and include outgoing messages in console-action
  sequences. MIDI conditions can watch another MIDI message; OSC conditions
  compare an argument of the incoming message.
- **LTC/MTC and cues:** LTC WAV analysis, cue editing, frame offsets, a separate
  clock, forwarding as MTC and cue execution history.
- **Control over repeated triggers and operator feedback:** tune audio-trigger
  response, choose Drop / Queue one / Restart, add messages with optional sound,
  inspect action results and cancel pending work with PANIC STOP.

The macro IF list is checked on meter/console-state triggers. MIDI/OSC bindings
have their own conditions; bindings, cues and manual firing run the actions
without evaluating that IF list. Rearm/dwell apply to rising transients. Sending
MIDI/OSC is not confirmation by the receiver; stopping cannot undo applied actions.

It is a community beta and needs independent testing, including real signal/interface
LTC and third-party workflows.

Screenshots, the download, installation steps and contributor tasks are here:
https://github.com/marmoles-supply/wing-controller/blob/main/README.md#wing-controller

The code is available to study and improve. Professional use, including paid
shows, is allowed; selling copies or derivatives is prohibited. Redistributed
versions must include their source under the same licence. Bug reports, testing
and focused contributions are welcome. The app is self-signed, not notarised by
Apple, unofficial and supplied without warranties; please read the installation
guide and disclaimer.

## Español

He compartido WING CONTROLLER, un proyecto independiente de automatización y
metering para Behringer WING en Mac Apple Silicon. Lo utilizas junto a la consola
o tu aplicación de control habitual.

Algunas de las capacidades que merece la pena conocer:

- **Macros WHEN / IF / THEN:** hasta 16 condiciones AND/OR y 32 pasos ordenados,
  con esperas, toggles, HUD, envíos MIDI/OSC y fades lineales o suaves. Los fades
  pueden leer el valor actual y aplicar cambios relativos; las acciones
  compatibles admiten listas y rangos de canales.
- **Metering más allá de los canales:** mezcla Sources, canales, buses, mains,
  matrices y salidas. Las entradas locales, AES50, StageConnect, USB y Card/Dante
  son algunas familias de Sources, según la consola y el hardware instalado.
- **Medidores de Sources como disparadores y condiciones IF**, aunque no estén
  en pantalla. Crea bancos con tus propios nombres y orden; el Meter Bridge
  independiente puede mostrar otro banco en una segunda pantalla, con barras
  LED, agujas de estilo analógico o gráficas de historial.
- **Automatización entre aplicaciones en ambos sentidos:** aprende asignaciones
  MIDI/OSC entrantes, añade condiciones a la asignación e incluye envíos en las
  secuencias de acciones de consola. Las condiciones MIDI pueden consultar otro
  mensaje MIDI; las de OSC comparan un argumento del mensaje entrante.
- **LTC/MTC y cues:** análisis de WAV de LTC, edición de cues, offsets en frames,
  reloj independiente, reenvío como MTC e historial de ejecución de cues.
- **Control de los redisparos e información al operador:** ajusta la respuesta
  al audio, elige Drop / Queue one / Restart, añade mensajes con sonido opcional,
  consulta resultados por acción y cancela trabajo pendiente con PANIC STOP.

La lista IF se comprueba en los disparos por medidor o estado de consola. Las
asignaciones MIDI/OSC tienen condiciones propias; estas asignaciones, los cues y
el disparo manual ejecutan las acciones sin evaluar aquella lista IF. Rearm/dwell
se aplican a transitorios ascendentes. Enviar MIDI/OSC no confirma la recepción;
parar no deshace acciones ya aplicadas.

Es una beta y necesita pruebas de la comunidad, incluidos LTC con señal e interfaz
reales y los recorridos entre aplicaciones.

Aquí están las imágenes, la descarga, las instrucciones y las tareas pendientes:
https://github.com/marmoles-supply/wing-controller/blob/main/README.es.md#wing-controller

El código está disponible para estudiarlo y mejorarlo. Se permite el uso
profesional, incluidos shows remunerados; se prohíbe vender copias o derivados.
Las versiones redistribuidas deben incluir su código bajo la misma licencia.
Se agradecen pruebas, informes de errores y contribuciones concretas. La app
lleva firma propia, sin notarización de Apple; no es oficial y se distribuye sin
garantías. Conviene leer la guía de instalación y el disclaimer.

## Feedback links

Link [community testing](COMMUNITY_TESTING.md) or the
[report chooser](https://github.com/marmoles-supply/wing-controller/issues/new/choose)
when asking for feedback. Successful, partial, failed and inconclusive tests are
all useful; label them as reports for one version/setup, not compatibility claims.
