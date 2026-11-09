// Share the workstation's existing pattern renderer, once per secondary window.
// This changes surfaces only: no protocol or preferences are introduced.
if (window.WingDither) {
  window.WingDither.apply();
  window.WingDither.watch();
}
