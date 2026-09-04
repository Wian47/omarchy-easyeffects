// Checks the files agree with each other. Run with: node test/wiring.test.js
//
// These are the mistakes no single file can see: a manifest offering a setting
// nothing reads, a panel calling a Model function that was renamed, a second
// copy of the service built inside the panel, or a privilege escalation that
// crept into code the shell loads.
//
// Needs qmlformat on PATH to parse the QML grammar. qmllint would resolve the
// qs.* types too, but it needs Omarchy's shell installed, so it answers a
// different question in CI than it does on a desktop.

const fs = require("fs")
const path = require("path")
const assert = require("assert")
const { execFileSync } = require("child_process")

const root = path.join(__dirname, "..")
const read = f => fs.readFileSync(path.join(root, f), "utf8")
const manifest = JSON.parse(read("manifest.json"))
const panel = read("Panel.qml")
const service = read("Service.qml")
const model = read("Model.js")
const presets = read("Presets.js")
const qml = { "Panel.qml": panel, "Service.qml": service }

let failures = 0
function test(name, fn) {
  try {
    fn()
    console.log("  ok   " + name)
  } catch (error) {
    failures++
    console.log("  FAIL " + name + "\n       " + error.message)
  }
}

test("every QML file parses", () => {
  for (const file of Object.keys(qml)) {
    try {
      execFileSync("qmlformat", [path.join(root, file)], { stdio: "pipe" })
    } catch (error) {
      throw new Error(`${file} does not parse: ${String(error.stderr || error.message).trim()}`)
    }
  }
})

test("every entry point the manifest names is a file that exists", () => {
  for (const [kind, file] of Object.entries(manifest.entryPoints)) {
    assert.ok(fs.existsSync(path.join(root, file)), `entryPoints.${kind} names ${file}, which is missing`)
  }
})

test("the manifest declares a kind for each entry point it needs", () => {
  assert.ok(manifest.kinds.includes("service"), "the shared service is not declared")
  assert.ok(manifest.kinds.includes("bar-widget"), "the bar widget is not declared")
  assert.ok(manifest.entryPoints.service && manifest.entryPoints.barWidget)
})

// A setting nobody reads is a knob that does nothing, and a setting read but
// never offered is a default nobody can change. Both directions.
test("every setting offered is read, and every setting read is offered", () => {
  const offered = Object.keys(manifest.barWidget.defaults).sort()
  const inSchema = manifest.barWidget.schema.map(e => e.key).sort()
  assert.deepStrictEqual(inSchema, offered, "defaults and schema disagree")

  const code = panel + service
  const readInCode = [...code.matchAll(/setting\("([A-Za-z0-9_]+)"/g)].map(m => m[1])
    .concat([...code.matchAll(/settings\.([A-Za-z0-9_]+)/g)].map(m => m[1]))
  for (const key of offered) {
    assert.ok(readInCode.includes(key), `the manifest offers '${key}' and no code reads it`)
  }
  for (const key of readInCode) {
    assert.ok(offered.includes(key), `code reads the setting '${key}' and the manifest does not offer it`)
  }
})

test("every bar label the manifest offers is one the model can draw", () => {
  const options = manifest.barWidget.schema.find(e => e.key === "barLabel").options
  const source = model.replace(/^\.pragma library\s*$/m, "")
  const names = [
    ...source.matchAll(/^function ([A-Za-z_$][\w$]*)/gm),
    ...source.matchAll(/^var ([A-Za-z_$][\w$]*)/gm)
  ].map(m => m[1])
  const Model = new Function(source + "\nreturn {" + names.map(n => `${n}: ${n}`).join(",") + "};")()
  const view = { preset: "Perfect EQ", deviceLabel: "Bluetooth", bypassed: false, readiness: "running" }
  for (const mode of options) {
    const drawn = Model.barLabel(view, mode)
    assert.strictEqual(typeof drawn, "string", `barLabel cannot draw '${mode}'`)
    if (mode !== "none") assert.ok(drawn.trim().length > 0, `barLabel draws nothing for '${mode}'`)
  }
})

test("the panel calls only Model and Presets functions that exist", () => {
  const available = {
    Model: new Set([...model.matchAll(/^(?:function|var) ([A-Za-z_$][\w$]*)/gm)].map(m => m[1])),
    Presets: new Set([...presets.matchAll(/^(?:function|var) ([A-Za-z_$][\w$]*)/gm)].map(m => m[1]))
  }
  for (const [file, whole] of Object.entries(qml)) {
    // `import "Model.js" as Model` is not a call, and its `.js` would be read
    // as one by the scan below.
    const text = whole.replace(/^import .*$/gm, "")
    for (const call of text.matchAll(/\b(Model|Presets)\.([A-Za-z_$][\w$]*)/g)) {
      assert.ok(available[call[1]].has(call[2]),
        `${file} calls ${call[1]}.${call[2]}, which ${call[1]}.js does not define`)
    }
  }
})

test("the panel binds only to service properties that exist", () => {
  const declared = new Set([...service.matchAll(/property\s+(?:alias\s+)?[\w<>]+\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1]))
  const functions = new Set([...service.matchAll(/^\s*function ([A-Za-z_$][\w$]*)/gm)].map(m => m[1]))
  for (const use of panel.matchAll(/\bee\.([A-Za-z_$][\w$]*)/g)) {
    assert.ok(declared.has(use[1]) || functions.has(use[1]),
      `Panel.qml uses ee.${use[1]}, which Service.qml has neither as a property nor a function`)
  }
})

// The bar builds this panel once per monitor. Two services would run two syncs
// against the same preset directory and race over the ledger, so the single
// instance has to come from the shell.
test("the panel asks the shell for the service and builds none of its own", () => {
  assert.ok(panel.includes(`serviceFor("${manifest.id}")`),
    "the panel does not ask the shell for this plugin's shared service")
  assert.ok(!/^\s*Service\s*\{/m.test(panel), "the panel builds a Service of its own")
})

test("the manifest id is the name the panel registers", () => {
  const declared = panel.match(/moduleName:\s*"([^"]+)"/)
  assert.ok(declared, "the panel declares no moduleName")
  assert.strictEqual(declared[1], manifest.id)
})

// Installing EasyEffects needs root, and this plugin never takes it. The offer
// is handed to Omarchy's own installer, which escalates in a terminal the user
// can see. A scan of the source proves that in a way prose cannot.
test("nothing the shell loads escalates privileges itself", () => {
  for (const [file, text] of Object.entries(qml).concat([["Model.js", model], ["Presets.js", presets]])) {
    for (const word of ["sudo", "pkexec", "doas", "pacman"]) {
      assert.ok(!new RegExp("\\b" + word + "\\b").test(text),
        `${file} contains '${word}'; escalation belongs to omarchy-install-and-launch`)
    }
  }
  assert.ok(service.includes("omarchy-install-and-launch"),
    "the install offer does not go through Omarchy's installer")
})

// The socket's replies carry no framing, so reading it cannot be done safely.
test("the socket is only ever written to", () => {
  assert.ok(!/socket\.read|onRead|SplitParser/.test(service),
    "Service.qml reads the socket, whose replies have no framing to read by")
  assert.ok(service.includes("socket.write"), "Service.qml never writes to the socket")
})

test("the shell commands read only what they say they read", () => {
  const allowed = /^(set|echo|command|printf|grep|sed|for|do|done|while|if|then|fi|cp|mv|mkdir|shift|sha256sum|cut|read|n=|P=|D=|k=|f=|\[|\]|easyeffects|sh|omarchy-install-and-launch)/
  for (const line of model.split("\n")) {
    const inShell = line.match(/^\s*'(.+)',?$/)
    if (!inShell) continue
    const body = inShell[1].trim()
    if (body === "" || body.startsWith("#")) continue
    assert.ok(allowed.test(body) || body.startsWith("'") || body.startsWith("}"),
      `a shell line does something unannounced: ${body}`)
  }
})

console.log()
if (failures) {
  console.log(`${failures} failed`)
  process.exit(1)
}
console.log("the files agree with each other")
