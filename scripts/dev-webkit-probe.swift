// WebKit ground-truth probe: runs the real desktop UI in a WKWebView (the same engine the Tauri app
// uses on macOS) and prints what the engine actually does, so a Chrome-vs-WebKit difference can be
// diagnosed instead of guessed.
//
// Not part of the gate (`verify-all.sh` only runs `scripts/test-*.mjs`): this is the tool to reach
// for when Chrome and the app disagree, because the desktop app runs on WKWebView and Chrome does
// not reproduce WebKit's behaviour. It found that the macro fields already computed
// `user-select: text` and that WebKit refuses every edit while the window is not key.
//
// Usage:
//   swift scripts/dev-webkit-probe.swift <file> "<javascript expression>"
//   swift scripts/dev-webkit-probe.swift <file> --click <selector>[,<selector>...]
//   swift scripts/dev-webkit-probe.swift <file> --key <selector>[,<selector>...]   (click and type)
//   swift scripts/dev-webkit-probe.swift <file> --deep <selector>
//
// The click mode sends a real left mouse down/up through the window's event path (never through the
// system event queue, so it cannot disturb whatever the operator is doing) and then reports which
// element ended up focused.
import Cocoa
import WebKit

let args = CommandLine.arguments
let filePath = args.count > 1 ? args[1] : "desktop/ui/index.html"
// Either "<file> --click <selectors>" / "<file> --type <selector>" or "<file> <javascript>".
var mode = "eval"
var payload = "document.title"
if args.count > 2 {
  if args[2].hasPrefix("--") {
    mode = args[2]
    if args.count > 3 { payload = args[3] }
  } else {
    payload = args[2]
  }
}

let config = WKWebViewConfiguration()
let stub = """
window.__TAURI__ = {
  core: { invoke: async () => ({}) },
  event: { listen: async () => () => {} },
  window: { getCurrentWindow: () => ({ setAlwaysOnTop: async () => {} }) },
};
"""
config.userContentController.addUserScript(
  WKUserScript(source: stub, injectionTime: .atDocumentStart, forMainFrameOnly: true)
)

let size = NSRect(x: 0, y: 0, width: 1400, height: 900)
NSApplication.shared.setActivationPolicy(.accessory)
let webView = WKWebView(frame: size, configuration: config)
// A `.nonactivatingPanel` can become the key window WITHOUT activating the app, which is what
// WebKit's editing machinery needs; a window parked off-screen can never be key, and without a key
// window WebKit refuses every text edit (execCommand returns false), so tests would only report the
// harness limitation instead of the app's behaviour.
// A borderless window refuses key status unless the subclass says otherwise, and a non-activating
// panel does it without bringing the probe app to the front.
final class KeyablePanel: NSPanel {
  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { true }
}
// Same size as the web view: a smaller window clips the hit test and a click on a control outside
// it would silently miss, which reads as "the field refused the click" when it never got one.
// Two window flavours: a plain borderless window parked off-screen (the configuration in which a
// synthetic click reliably reaches the page, used by --click/--deep/--watch) and a keyable panel
// that can become the key window without activating the app (used by --key to test editing).
let useKeyablePanel = (mode == "--key")
let panel: NSPanel = useKeyablePanel
  ? KeyablePanel(
      contentRect: size,
      styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false
    )
  : NSPanel(contentRect: size, styleMask: [.borderless], backing: .buffered, defer: false)
panel.isFloatingPanel = true
panel.becomesKeyOnlyIfNeeded = false
panel.hidesOnDeactivate = false
panel.alphaValue = 0.02
panel.ignoresMouseEvents = false
panel.level = .normal
if let screen = NSScreen.main {
  panel.setFrameOrigin(NSPoint(x: screen.visibleFrame.minX + 10, y: screen.visibleFrame.minY + 10))
}
let window: NSWindow = panel
window.contentView = webView
window.makeFirstResponder(webView)

func pump(_ seconds: Double) {
  RunLoop.main.run(until: Date().addingTimeInterval(seconds))
}

func evalSync(_ js: String) -> String {
  var result = "(no result)"
  var finished = false
  webView.evaluateJavaScript(js) { value, error in
    if let error = error {
      let nsError = error as NSError
      result = "ERROR: \(error) | userInfo=\(nsError.userInfo)"
    } else if let value = value {
      result = "\(value)"
    } else {
      result = "null"
    }
    finished = true
  }
  let deadline = Date().addingTimeInterval(15)
  while !finished && Date() < deadline { pump(0.02) }
  return result
}

let url = URL(fileURLWithPath: filePath)
webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())

var ready = false
for _ in 0..<200 {
  pump(0.05)
  if evalSync("document.readyState") == "complete" { ready = true; break }
}
if !ready {
  print("PROBE: page never reached readyState=complete")
  exit(1)
}
pump(0.6)

func click(_ selector: String) -> String {
  let rectJS = """
  (function(){
    var el = document.querySelector(\(jsString(selector)));
    if (!el) return "MISSING";
    el.scrollIntoView({ block: "center" });
    var r = el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2, r.width, r.height].join(",");
  })()
  """
  let rect = evalSync(rectJS)
  let parts = rect.split(separator: ",").compactMap { Double($0) }
  guard parts.count == 4 else { return "could not measure \(selector): \(rect)" }

  let point = NSPoint(x: parts[0], y: size.height - parts[1])
  guard let down = NSEvent.mouseEvent(
    with: .leftMouseDown, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
    windowNumber: window.windowNumber, context: nil, eventNumber: 1, clickCount: 1, pressure: 1
  ), let up = NSEvent.mouseEvent(
    with: .leftMouseUp, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
    windowNumber: window.windowNumber, context: nil, eventNumber: 2, clickCount: 1, pressure: 0
  ) else { return "could not build the mouse events" }

  window.sendEvent(down)
  window.sendEvent(up)
  pump(0.4)

  return evalSync("""
  (function(){
    var el = document.querySelector(\(jsString(selector)));
    var active = document.activeElement;
    return JSON.stringify({
      selector: \(jsString(selector)),
      activeElement: active ? (active.tagName + "#" + (active.id || "")) : null,
      focused: active === el,
      selectionStart: (el && el.selectionStart !== undefined) ? el.selectionStart : null,
      selectionEnd: (el && el.selectionEnd !== undefined) ? el.selectionEnd : null,
      userSelect: getComputedStyle(el).webkitUserSelect,
      userModify: getComputedStyle(el).webkitUserModify,
    });
  })()
  """)
}

func jsString(_ value: String) -> String {
  let escaped = value.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
  return "\"\(escaped)\""
}

func type(_ text: String) {
  for (index, character) in text.enumerated() {
    let value = String(character)
    guard let down = NSEvent.keyEvent(
      with: .keyDown, location: NSPoint(x: 0, y: 0), modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
      windowNumber: window.windowNumber, context: nil, characters: value, charactersIgnoringModifiers: value,
      isARepeat: false, keyCode: 0
    ), let up = NSEvent.keyEvent(
      with: .keyUp, location: NSPoint(x: 0, y: 0), modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
      windowNumber: window.windowNumber, context: nil, characters: value, charactersIgnoringModifiers: value,
      isARepeat: false, keyCode: 0
    ) else { continue }
    window.sendEvent(down)
    window.sendEvent(up)
    _ = index
    pump(0.06)
  }
  pump(0.3)
}

if mode == "--type" {
  let selector = payload
  let before = evalSync("(document.querySelector(\(jsString(selector))) || {}).value")
  print(click(selector))
  type("42")
  let after = evalSync("(document.querySelector(\(jsString(selector))) || {}).value")
  print("typed value: before=\(before) after=\(after)")
}

if mode == "--key" {
  // Brief activation: WebKit refuses to edit in a non-key window, so the only faithful test of
  // "click and type" needs the window to be key for a moment.
  window.makeKeyAndOrderFront(nil)
  window.makeFirstResponder(webView)
  pump(0.6)
  print("isKeyWindow:", window.isKeyWindow)
  for selector in payload.split(separator: ",") {
    let one = String(selector).trimmingCharacters(in: .whitespaces)
    let before = evalSync("(document.querySelector(\(jsString(one))) || {}).value")
    _ = click(one)
    type("42")
    let after = evalSync("(document.querySelector(\(jsString(one))) || {}).value")
    print("typed \(one): before=\(before) after=\(after)")
  }
  window.orderOut(nil)
  NSApplication.shared.hide(nil)
  exit(0)
}

if mode == "--recover" {
  // Reproduce the state (click, release: editing refused) and tries, one by one, the actions that
  // could re-open WebKit's editing pipeline. Prints which one makes insertText work.
  let selector = payload
  window.makeKeyAndOrderFront(nil)
  window.makeFirstResponder(webView)
  pump(0.6)
  let rect = evalSync("""
  (function(){
    var el = document.querySelector(\(jsString(selector)));
    if (!el) return "MISSING";
    el.scrollIntoView({ block: "center" });
    var r = el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2].join(",");
  })()
  """)
  let parts = rect.split(separator: ",").compactMap { Double($0) }
  guard parts.count == 2 else { print("no se pudo medir"); exit(1) }
  let point = NSPoint(x: parts[0], y: size.height - parts[1])
  if let down = NSEvent.mouseEvent(with: .leftMouseDown, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil, eventNumber: 1, clickCount: 1, pressure: 1) { window.sendEvent(down) }
  pump(0.3)
  if let up = NSEvent.mouseEvent(with: .leftMouseUp, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil, eventNumber: 2, clickCount: 1, pressure: 0) { window.sendEvent(up) }
  pump(0.4)

  let attempts: [(String, String)] = [
    ("nada (estado roto)", "1"),
    ("focus()", "var el=document.querySelector(\(jsString(selector))); el.focus(); 'x'"),
    ("focus() + setSelectionRange", "var el=document.querySelector(\(jsString(selector))); el.focus(); el.setSelectionRange(el.value.length, el.value.length); 'x'"),
    ("blur() + focus()", "var el=document.querySelector(\(jsString(selector))); el.blur(); el.focus(); 'x'"),
    ("click() sintético", "var el=document.querySelector(\(jsString(selector))); el.click(); el.focus(); 'x'"),
    ("designMode = 'on'", "document.designMode='on'; var el=document.querySelector(\(jsString(selector))); el.focus(); 'x'"),
    ("designMode = 'off' de nuevo", "document.designMode='off'; var el=document.querySelector(\(jsString(selector))); el.focus(); 'x'"),
    ("selección del documento", "window.getSelection().removeAllRanges(); var el=document.querySelector(\(jsString(selector))); el.focus(); el.select(); 'x'"),
  ]
  for (label, script) in attempts {
    _ = evalSync(script)
    pump(0.15)
    let result = evalSync("""
    (function(){
      var el = document.querySelector(\(jsString(selector)));
      el.focus();
      var ok = document.execCommand('insertText', false, '7');
      return JSON.stringify({ insertText: ok, value: el.value, active: document.activeElement === el, pageFocus: document.hasFocus() });
    })()
    """)
    print("\(label): \(result)")
  }
  exit(0)
}

if mode == "--hold-active" {
  // Same as --hold, but the probe app activates itself first: that is the state the packaged app is
  // in when the operator clicks, and it tells apart "the platform needs an active app" from "the
  // platform drops the focus on mouse-up no matter what".
  NSApplication.shared.setActivationPolicy(.accessory)
  NSApplication.shared.activate(ignoringOtherApps: true)
  window.makeKeyAndOrderFront(nil)
  window.makeFirstResponder(webView)
  pump(1.2)
  let selector = payload
  let rect = evalSync("""
  (function(){
    var el = document.querySelector(\(jsString(selector)));
    if (!el) return "MISSING";
    el.scrollIntoView({ block: "center" });
    var r = el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2].join(",");
  })()
  """)
  let parts = rect.split(separator: ",").compactMap { Double($0) }
  guard parts.count == 2 else { print("no se pudo medir \(selector)"); exit(1) }
  let point = NSPoint(x: parts[0], y: size.height - parts[1])
  func insert(_ text: String) -> String {
    evalSync("""
    (function(){
      var el = document.querySelector(\(jsString(selector)));
      el.focus();
      var ok = document.execCommand('insertText', false, '\(text)');
      return JSON.stringify({ ok: ok, value: el.value });
    })()
    """)
  }
  print("activa:", NSApplication.shared.isActive, "key:", window.isKeyWindow, "hasFocus:", evalSync("document.hasFocus()"))
  if let down = NSEvent.mouseEvent(with: .leftMouseDown, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil, eventNumber: 1, clickCount: 1, pressure: 1) { window.sendEvent(down) }
  pump(0.3)
  print("pulsado +'1':", insert("1"))
  if let up = NSEvent.mouseEvent(with: .leftMouseUp, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil, eventNumber: 2, clickCount: 1, pressure: 0) { window.sendEvent(up) }
  pump(0.4)
  print("soltado +'2':", insert("2"), "| hasFocus:", evalSync("document.hasFocus()"))
  exit(0)
}

if mode == "--hold" {
  // Reproduces the reported symptom: typing works while the mouse button is held on a field and
  // stops working on release. `execCommand("insertText")` exercises WebKit's editing pipeline, which
  // is what refuses the caret when the page is not allowed to edit, so this needs no keyboard.
  let selector = payload
  window.makeKeyAndOrderFront(nil)
  window.makeFirstResponder(webView)
  pump(0.6)
  let rect = evalSync("""
  (function(){
    var el = document.querySelector(\(jsString(selector)));
    if (!el) return "MISSING";
    el.scrollIntoView({ block: "center" });
    var r = el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2].join(",");
  })()
  """)
  let parts = rect.split(separator: ",").compactMap { Double($0) }
  guard parts.count == 2 else { print("no se pudo medir \(selector): \(rect)"); exit(1) }
  let point = NSPoint(x: parts[0], y: size.height - parts[1])
  func mouse(_ type: NSEvent.EventType, _ number: Int) -> NSEvent? {
    NSEvent.mouseEvent(
      with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
      windowNumber: window.windowNumber, context: nil, eventNumber: number, clickCount: 1, pressure: type == .leftMouseDown ? 1 : 0
    )
  }
  func insert(_ text: String) -> String {
    evalSync("""
    (function(){
      var el = document.querySelector(\(jsString(selector)));
      el.focus();
      var ok = document.execCommand('insertText', false, '\(text)');
      return JSON.stringify({ ok: ok, value: el.value });
    })()
    """)
  }
  print("estado inicial:", evalSync("document.hasFocus() + ' / ' + (document.activeElement ? document.activeElement.tagName : '-')"))
  if let down = mouse(.leftMouseDown, 1) { window.sendEvent(down) }
  pump(0.3)
  print("botón pulsado   +'1':", insert("1"))
  if let up = mouse(.leftMouseUp, 2) { window.sendEvent(up) }
  pump(0.3)
  print("botón soltado   +'2':", insert("2"))
  print("activo tras soltar:", evalSync("document.activeElement ? (document.activeElement.tagName + '#' + (document.activeElement.id || '')) : 'none'"))
  // ¿Sirve `window.focus()` para recuperar el foco de la página sin depender de Rust?
  print("hasFocus antes de window.focus():", evalSync("document.hasFocus()"))
  _ = evalSync("window.focus(); 'ok'")
  pump(0.2)
  print("hasFocus tras window.focus():", evalSync("document.hasFocus()"))
  print("botón soltado, tras window.focus() +'3':", insert("3"))
  exit(0)
}

if mode == "--watch" {
  // Clicks the control and then polls the focus owner from the Swift side (a JS Promise cannot cross
  // the WKWebView boundary). If something steals or blurs the focus, editing would be impossible no
  // matter how the click is delivered.
  let selector = payload
  // Off-screen and not key: this is the configuration in which a synthetic click reliably reaches
  // the page, so it isolates "who steals the focus afterwards" from "did the click land".
  panel.setFrameOrigin(NSPoint(x: -4000, y: -4000))
  panel.orderBack(nil)
  pump(0.3)
  print(click(selector))
  var timeline: [String] = []
  for _ in 0..<20 {
    let owner = evalSync("""
    (function(){
      var el = document.querySelector(\(jsString(selector)));
      var a = document.activeElement;
      var id = a ? (a.id || a.tagName) : 'none';
      return id + (a === el ? '*' : '') + '|' + (el === document.querySelector(\(jsString(selector))) ? 'same' : 'replaced');
    })()
    """)
    if timeline.last != owner { timeline.append(owner) }
    pump(0.05)
  }
  print("focus timeline:", timeline.joined(separator: " -> "))
  exit(0)
}

if mode == "--deep" {
  let selector = payload
  print("key before:", window.isKeyWindow)
  window.makeKey()
  print("key after makeKey:", window.isKeyWindow)
  print(click(selector))
  print("props:", evalSync("""
  (function(){
    var el = document.querySelector(\(jsString(selector)));
    return JSON.stringify({
      readOnly: el.readOnly, disabled: el.disabled, editable: el.isContentEditable,
      type: el.type, value: el.value, activeIsEl: document.activeElement === el,
      supportsInsertText: document.queryCommandSupported ? document.queryCommandSupported('insertText') : null,
    });
  })()
  """))
  print("execCommand insertText:", evalSync("""
  (function(){
    var el = document.querySelector(\(jsString(selector)));
    el.focus();
    var ok = document.execCommand('insertText', false, 'Z');
    return JSON.stringify({ ok: ok, value: el.value });
  })()
  """))
  type("42")
  print("after keys:", evalSync("(document.querySelector(\(jsString(selector))) || {}).value"))
  exit(0)
}

if mode == "--click" {
  // A plain input is created as a control: if that one also refuses the click, the harness itself is
  // the limitation and nothing can be concluded about the app.
  _ = evalSync("""
  (function(){
    if (document.getElementById('probe-plain')) return 'exists';
    var p = document.createElement('input');
    p.id = 'probe-plain';
    p.value = 'plain';
    p.style.position = 'fixed'; p.style.left = '20px'; p.style.top = '20px'; p.style.zIndex = '2147483647';
    document.body.appendChild(p);
    return 'created';
  })()
  """)
  pump(0.3)
  print(click("#probe-plain"))
  for selector in payload.split(separator: ",") {
    print(click(String(selector).trimmingCharacters(in: .whitespaces)))
  }
} else {
  print(evalSync(payload))
}
exit(0)
