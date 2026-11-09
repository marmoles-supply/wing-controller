# Instalar WING CONTROLLER en tu Mac

[English](INSTALLATION.md) · [Volver al proyecto](../README.es.md)

Necesitas un **Mac Apple Silicon (serie M)**. Compruébalo en **menú Apple → Acerca
de este Mac**, en el apartado del chip. No hay instalador compatible con Intel,
Windows o Linux. No necesitas herramientas de desarrollo.

## Descargar e instalar

1. **[Descarga el DMG v0.3.0 para Apple Silicon](https://github.com/marmoles-supply/wing-controller/releases/download/v0.3.0/WING_CONTROLLER_v0.3.0_AppleSilicon.dmg)**
   y **[SHA256SUMS.txt](https://github.com/marmoles-supply/wing-controller/releases/download/v0.3.0/SHA256SUMS.txt)**.
   Ambos deben ser de la misma release. Los enlaces **Source code** de GitHub son
   código para desarrolladores, no la aplicación.
2. Comprueba la descarga. En Terminal, escribe `shasum -a 256 `, arrastra el DMG a
   esa ventana y pulsa Intro. Compara el **hash completo** con la línea del DMG en
   `SHA256SUMS.txt`. Si no coincide, no abras ese archivo.
3. Abre el DMG y **arrastra WING CONTROLLER.app a Aplicaciones**.
4. **Expulsa la imagen de disco** y abre la copia de Aplicaciones. No ejecutes la
   aplicación directamente desde el DMG.

Lee las [notas de la release](https://github.com/marmoles-supply/wing-controller/releases/tag/v0.3.0)
y el [disclaimer completo, en inglés](../DISCLAIMER.md). Es software independiente
sin garantías, no oficial de Behringer/Music Tribe, y cada usuario es responsable
de probar y operar su sistema.

## Primera apertura

La beta lleva una firma estable con un certificado propio: **no es una firma
Apple Developer ID y no está notarizada por Apple**. macOS puede bloquearla.

Después de verificar el origen y el checksum, intenta abrir la copia instalada.
Si decides continuar, entra en **Ajustes del Sistema → Privacidad y seguridad →
Abrir igualmente** y confirma la excepción para esta aplicación.
[Instrucciones de Apple](https://support.apple.com/es-es/102445).

No desactives Gatekeeper de forma global ni ignores un aviso de malware detectado.
El archivo opcional **Unblock WING CONTROLLER.command** comprueba identidad,
versión, firma y hash de la copia correspondiente antes de quitar su cuarentena
y restaurar el icono. Úsalo solo con la release de confianza que lo acompaña;
puede necesitar autorización de macOS. La ruta normal es la excepción específica
de Ajustes del Sistema.

El proceso completo de una descarga nueva en otro Mac aún necesita validación
independiente. El entorno inicial comprobado fue macOS 26.6.2 arm64; el mínimo de
los metadatos de empaquetado no establece un rango de compatibilidad probado.

## Permisos y conexión

- **Micrófono:** para capturar LTC. No hace falta concederlo si no utilizas esa
  función. Cambiar la identidad de firma puede requerir concederlo otra vez.
- **Archivos y carpetas:** elige dónde guardar shows y copias. Conserva copias
  independientes antes de restaurar una estación.
- **Red:** el Mac debe poder comunicarse con la consola. OSC utiliza UDP 2223;
  descubrimiento UDP 2222; medidores nativos TCP 2222 con informes UDP.

Sigue la [guía de primera conexión, en inglés](guide/01-start-here.md). Prueba
primero fuera de un show activo, verifica destinos y valores, guarda copias de
consola/show y conserva una forma de trabajar manualmente.

**La validación con hardware e integraciones está incompleta**, incluidos LTC/MTC
físicos. Las pruebas sintéticas no validan esos recorridos ni su interoperabilidad
independiente.
Consulta las [limitaciones](KNOWN_LIMITATIONS.md) y el [to-do](ROADMAP.md), en inglés.

Para compilar o empaquetar, utiliza las [instrucciones de desarrollo, en inglés](../README.md#development).

## Comunicar el resultado

Tanto una instalación correcta como un fallo ayudan.
[Comunica la prueba](https://github.com/marmoles-supply/wing-controller/issues/new?template=03-test-report.yml)
o [reporta un error](https://github.com/marmoles-supply/wing-controller/issues/new?template=01-bug-report.yml).
Incluye versión de la app, macOS y chip, sin datos personales. Puedes escribir en
español. [Pruebas de la comunidad, en inglés](COMMUNITY_TESTING.md).
