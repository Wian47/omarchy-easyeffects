// Tests for Model.js, the parsing and presentation layer. Run with:
//   node test/model.test.js
//
// Model.js is a QML JavaScript resource, so it has a `.pragma library` line and
// no module exports. Loading it as source and evaluating it in a function scope
// keeps the shipped file free of a test-only export block.
//
// The fixtures are real: the ini is a copy of a working easyeffectsrc and the
// sink list is what `pactl list short sinks` printed on the machine this was
// written against.

const fs = require("fs")
const path = require("path")
const assert = require("assert")

const source = fs.readFileSync(path.join(__dirname, "..", "Model.js"), "utf8")
  .replace(/^\.pragma library\s*$/m, "")
const names = [
  ...source.matchAll(/^function ([A-Za-z_$][\w$]*)/gm),
  ...source.matchAll(/^var ([A-Za-z_$][\w$]*)/gm)
].map(m => m[1])
const Model = new Function(source + "\nreturn {" + names.map(n => `${n}: ${n}`).join(",") + "};")()

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

const EASYEFFECTSRC = [
  "[Presets]",
  "lastLoadedOutputPreset=Bass Enhancing + Perfect EQ - Low Latency",
  "",
  "[StreamInputs]",
  "inputDevice=bluez_input.AA:BB:CC:11:22:33",
  "visiblePage=pluginsPage",
  "",
  "[StreamOutputs]",
  "blocklist=Spotify",
  "outputDevice=bluez_output.AA_BB_CC_11_22_33.1",
  "usedPresets=Perfect EQ:11,Bass Enhancing + Perfect EQ:16,Bass Boosted:8",
  "visiblePlugin=equalizer#0",
  ""
].join("\n")

// Trimmed from real `pactl list sinks` and `pactl list sources` output. The
// indentation is load-bearing: ports are indented one level deeper than the
// fields around them, which is how the parser knows where the port list ends.
const PACTL_DEVICES = [
  "@@output",
  "Sink #82",
  "\tState: RUNNING",
  "\tName: easyeffects_sink",
  "\tDescription: EasyEffects Sink",
  "Sink #5331",
  "\tState: SUSPENDED",
  "\tName: alsa_output.pci-0000_05_00.6.HiFi__Speaker__sink",
  "\tDescription: Ryzen HD Audio Controller Speaker",
  "\tPorts:",
  "\t\tSpeaker: Speaker (type: Speaker, priority: 100, availability unknown)",
  "\t\tHeadphones: Headphones (type: Headphones, priority: 200, not available)",
  "\tActive Port: Speaker",
  "\tFormats:",
  "\t\tpcm",
  "Sink #5384",
  "\tState: RUNNING",
  "\tName: bluez_output.AA_BB_CC_11_22_33.1",
  "\tDescription: soundcore P31i",
  "\tPorts:",
  "\t\theadset-output: Headphones (type: Headset, priority: 0, available)",
  "\tActive Port: headset-output",
  "@@input",
  "Source #83",
  "\tName: alsa_output.pci-0000_05_00.6.HiFi__Speaker__sink.monitor",
  "\tDescription: Monitor of Speaker",
  "Source #5390",
  "\tName: alsa_input.pci-0000_05_00.6.HiFi__Mic1__source",
  "\tDescription: Ryzen HD Audio Controller Digital Microphone",
  "\tPorts:",
  "\t\tMic1: Digital Microphone (type: Mic, priority: 100, availability unknown)",
  "\tActive Port: Mic1",
  ""
].join("\n")

test("readiness names every state it can be in", () => {
  assert.strictEqual(Model.readiness({ binary: false, flatpak: false }), "absent")
  assert.strictEqual(Model.readiness({ binary: false, flatpak: true }), "flatpak-only")
  assert.strictEqual(Model.readiness({ binary: true, presetDir: false }), "never-run")
  assert.strictEqual(Model.readiness({ binary: true, presetDir: true, socket: false }), "stopped")
  assert.strictEqual(Model.readiness({ binary: true, presetDir: true, socket: true }), "running")
})

test("presets sync without EasyEffects running, and never without it installed", () => {
  assert.strictEqual(Model.readinessState("absent").canSync, false)
  assert.strictEqual(Model.readinessState("flatpak-only").canSync, false)
  assert.strictEqual(Model.readinessState("never-run").canSync, true)
  assert.strictEqual(Model.readinessState("stopped").canSync, true)
  assert.strictEqual(Model.readinessState("stopped").canAct, false)
  assert.strictEqual(Model.readinessState("running").canAct, true)
})

test("every readiness state has a message and an unknown one fails safe", () => {
  for (const name of ["absent", "flatpak-only", "never-run", "stopped"]) {
    assert.ok(Model.readinessState(name).title.length > 10, `${name} has no title`)
    assert.ok(Model.readinessState(name).detail.length > 20, `${name} has no detail`)
  }
  assert.strictEqual(Model.readinessState("nonsense").canAct, false)
})

// The trap that would silently invert the setting: reading answers 1 for on and
// 2 for off, writing takes 1 for on and 0 for off.
test("a bypass reply fed back as a command does not invert it", () => {
  assert.strictEqual(Model.bypassFromReply("2"), false)
  assert.strictEqual(Model.bypassFromReply("1"), true)
  assert.strictEqual(Model.bypassFromReply(""), null)
  assert.strictEqual(Model.bypassFromReply("0"), null)
  assert.strictEqual(Model.bypassCommand(Model.bypassFromReply("2")), "global_bypass:0")
  assert.strictEqual(Model.bypassCommand(Model.bypassFromReply("1")), "global_bypass:1")
})

test("the bypass is read through the command line, which frames its answer", () => {
  assert.deepStrictEqual(Model.bypassReadCommand(), ["easyeffects", "-b", "3"])
  assert.strictEqual(Model.bypassFromReply("2\n"), false)
  assert.strictEqual(Model.bypassFromReply("1\n"), true)
})

test("a preset name the socket cannot carry gets no command", () => {
  assert.strictEqual(Model.loadPresetCommand("output", "Perfect EQ"), "load_preset:output:Perfect EQ")
  assert.strictEqual(Model.loadPresetCommand("input", "Mic"), "load_preset:input:Mic")
  assert.strictEqual(Model.loadPresetCommand("output", "x".repeat(100)).length, 119)
  assert.strictEqual(Model.loadPresetCommand("output", "x".repeat(101)), "")
  assert.strictEqual(Model.loadPresetCommand("output", "two\nlines"), "")
  assert.strictEqual(Model.loadPresetCommand("output", ""), "")
})

test("the ini yields the active preset and the device", () => {
  const ini = Model.parseIni(EASYEFFECTSRC)
  assert.strictEqual(Model.activePreset(ini, "output"), "Bass Enhancing + Perfect EQ - Low Latency")
  assert.strictEqual(Model.activePreset(ini, "input"), "")
  assert.strictEqual(Model.currentDevice(ini, "output"), "bluez_output.AA_BB_CC_11_22_33.1")
  assert.strictEqual(Model.currentDevice(ini, "input"), "bluez_input.AA:BB:CC:11:22:33")
})

test("a value containing an equals sign survives parsing", () => {
  const ini = Model.parseIni("[Presets]\nlastLoadedOutputPreset=A=B\n")
  assert.strictEqual(Model.activePreset(ini, "output"), "A=B")
})

test("usage counts order the list, and an ambiguous name is dropped not guessed", () => {
  const counts = Model.usageCounts(Model.parseIni(EASYEFFECTSRC), "output")
  assert.strictEqual(counts["Bass Enhancing + Perfect EQ"], 16)
  assert.strictEqual(counts["Perfect EQ"], 11)
  const ambiguous = Model.usageCounts(Model.parseIni("[StreamOutputs]\nusedPresets=Rock, Pop:3,Jazz:2\n"), "output")
  assert.strictEqual(ambiguous["Jazz"], 2)
  assert.strictEqual(ambiguous["Rock, Pop"], undefined)
})

test("rows carry the bundled mark, the count, and any missing kernel", () => {
  const rows = Model.presetRows({
    names: ["Mine", "Perfect EQ", "Bass Boosted"],
    catalogue: { "Perfect EQ": { summary: "s", use: "u" }, "Bass Boosted": { summary: "s", use: "u" } },
    active: "Perfect EQ",
    usage: { "Perfect EQ": 11, "Bass Boosted": 8 },
    kernelsByPreset: { "Bass Boosted": ["Razor"] },
    availableKernels: []
  })
  assert.deepStrictEqual(rows.map(r => r.name), ["Perfect EQ", "Bass Boosted", "Mine"])
  assert.strictEqual(rows[0].active, true)
  assert.strictEqual(rows[0].bundled, true)
  assert.strictEqual(rows[2].bundled, false)
  assert.strictEqual(rows[2].description, null)
  assert.deepStrictEqual(rows[1].missingKernels, ["Razor"])
  assert.deepStrictEqual(rows[0].missingKernels, [])
})

test("a preset named like an Object member is still just a preset", () => {
  const rows = Model.presetRows({ names: ["constructor", "toString"], catalogue: {}, usage: {} })
  assert.strictEqual(rows.length, 2)
  assert.strictEqual(rows[0].bundled, false)
  assert.strictEqual(rows[0].uses, 0)
})

test("a shipped kernel stops a preset reporting it as missing", () => {
  const rows = Model.presetRows({
    names: ["Bass Boosted"], catalogue: {}, usage: {},
    kernelsByPreset: { "Bass Boosted": ["Razor"] }, availableKernels: ["Razor"]
  })
  assert.deepStrictEqual(rows[0].missingKernels, [])
})

test("the device list drops EasyEffects' own loopback and the monitors", () => {
  const devices = Model.parseDevices(PACTL_DEVICES)
  assert.deepStrictEqual(devices.map(d => d.name), [
    "alsa_output.pci-0000_05_00.6.HiFi__Speaker__sink",
    "bluez_output.AA_BB_CC_11_22_33.1",
    "alsa_input.pci-0000_05_00.6.HiFi__Mic1__source"
  ])
  assert.deepStrictEqual(devices.map(d => d.pipeline), ["output", "output", "input"])
})

// The whole feature turns on this one field. EasyEffects names an autoload file
// after the route's description and a file named after the route's name is
// never found, with nothing logged either way.
test("a device carries the route description, never the route name", () => {
  const devices = Model.parseDevices(PACTL_DEVICES)
  const bluetooth = devices.find(d => d.name.indexOf("bluez_") === 0)
  assert.strictEqual(bluetooth.route, "Headphones")
  assert.notStrictEqual(bluetooth.route, "headset-output")
  assert.strictEqual(bluetooth.description, "soundcore P31i")
  assert.strictEqual(devices[0].route, "Speaker", "the active port decides, not the first one listed")
})

test("the autoload file is named the way EasyEffects names it", () => {
  assert.strictEqual(
    Model.autoloadFileName("bluez_output.AA_BB_CC_11_22_33.1", "Headphones"),
    "bluez_output.AA_BB_CC_11_22_33.1:Headphones.json")
  assert.strictEqual(Model.autoloadFileName("a/b", "c/d"), "a_b:c_d.json",
    "PipeWire puts slashes in route descriptions and EasyEffects replaces them")
  assert.strictEqual(Model.autoloadFileName("dev", ""), "dev:.json",
    "a device with no route still has a name EasyEffects looks for")
})

test("the autoload body carries the keys EasyEffects writes", () => {
  const body = JSON.parse(Model.autoloadBody("dev", "A Device", "Headphones", "Perfect EQ"))
  assert.deepStrictEqual(Object.keys(body), ["device", "device-description", "device-profile", "preset-name"])
  assert.strictEqual(body["preset-name"], "Perfect EQ")
  assert.strictEqual(body["device-profile"], "Headphones")
  assert.ok(Model.autoloadBody("d", "D", "R", 'a "quoted" name').indexOf('\\"quoted\\"') !== -1,
    "a name with quotes in it is escaped, not pasted in")
})

// Eleven devices with the presets under them is a popup nobody can read. Only
// the one in use and the ones already spoken for earn a row.
test("the autoload list shows the device in use and every rule, and nothing else", () => {
  const devices = Model.parseDevices(PACTL_DEVICES)
  const rows = Model.autoloadRows({
    devices: devices,
    rules: {
      output: { "alsa_output.pci-0000_05_00.6.HiFi__Speaker__sink:Speaker.json": { preset: "Laptop", description: "Speakers" } },
      input: {}
    },
    currentOutput: "bluez_output.AA_BB_CC_11_22_33.1",
    currentInput: "",
    pipelines: ["output"]
  })
  assert.deepStrictEqual(rows.map(r => r.label), [
    "soundcore P31i (Headphones)",
    "Ryzen HD Audio Controller Speaker"
  ])
  assert.strictEqual(rows[0].current, true, "the device in use comes first, rule or no rule")
  assert.strictEqual(rows[0].bound, false)
  assert.strictEqual(rows[1].bound, true)
  assert.strictEqual(rows[1].preset, "Laptop")
  assert.strictEqual(rows[1].fileName, "alsa_output.pci-0000_05_00.6.HiFi__Speaker__sink:Speaker.json")
  assert.strictEqual(rows[1].label.indexOf("(Speaker)"), -1,
    "a description that already says the route does not say it twice")
})

test("a rule for a device that is not connected is still shown and still removable", () => {
  const rows = Model.autoloadRows({
    devices: [],
    rules: { output: { "gone:Headphones.json": { preset: "Perfect EQ", description: "Some Headset", route: "Headphones" } }, input: {} },
    currentOutput: "",
    pipelines: ["output"]
  })
  assert.strictEqual(rows.length, 1)
  assert.strictEqual(rows[0].live, false, "nothing on the machine matches it")
  assert.strictEqual(rows[0].bound, true)
  assert.strictEqual(rows[0].label, "Some Headset (Headphones)", "it describes itself from what was written")
  assert.strictEqual(rows[0].description, "Some Headset", "the device's own description, without the route glued on")
  assert.strictEqual(rows[0].fileName, "gone:Headphones.json")
})

test("input devices are only listed when the pipeline is asked for", () => {
  const devices = Model.parseDevices(PACTL_DEVICES)
  const shared = { devices: devices, rules: { output: {}, input: {} }, currentOutput: "", currentInput: "alsa_input.pci-0000_05_00.6.HiFi__Mic1__source" }
  assert.strictEqual(Model.autoloadRows(Object.assign({ pipelines: ["output"] }, shared)).length, 0)
  const both = Model.autoloadRows(Object.assign({ pipelines: ["output", "input"] }, shared))
  assert.deepStrictEqual(both.map(r => r.pipeline), ["input"])
})

test("the rules a probe found are keyed by the file EasyEffects looks for", () => {
  const seen = Model.parseProbe([
    "runtime=/run/user/1000",
    "binary=1",
    "rule\toutput\tbluez_output.X:Headphones.json\tPerfect EQ\tsoundcore P31i\tHeadphones",
    "rule\tinput\tmic:Analog.json\tVoice\tA Microphone\tAnalog",
    "@@devices",
    "@@output",
    ""
  ].join("\n"))
  assert.deepStrictEqual(seen.rules.output, {
    "bluez_output.X:Headphones.json": { preset: "Perfect EQ", description: "soundcore P31i", route: "Headphones" }
  })
  assert.strictEqual(seen.rules.input["mic:Analog.json"].preset, "Voice")
  assert.deepStrictEqual(seen.devices, [], "the marker separates the two halves")
})

test("the bar label holds its width whatever it is showing", () => {
  const long = { preset: "Bass Enhancing + Perfect EQ - Low Latency", readiness: "running" }
  const short = { preset: "Laptop", readiness: "running" }
  assert.strictEqual(Model.barLabel(long, "preset").length, Model.barLabel(short, "preset").length)
  assert.strictEqual(Model.barLabel(long, "none"), "")
  assert.strictEqual(Model.barLabel(long, "sideways"), "")
  assert.ok(Model.barLabel(long, "preset").indexOf("…") !== -1)
  assert.strictEqual(Model.barLabel({ bypassed: true, preset: "Laptop", readiness: "running" }, "preset").trim(), "bypassed")
})

test("the icon says which of the five states it is in", () => {
  assert.strictEqual(Model.barGlyph({ readiness: "running", bypassed: false }), Model.GLYPH_EQ)
  assert.strictEqual(Model.barGlyph({ readiness: "running", bypassed: true }), Model.GLYPH_BYPASS)
  assert.strictEqual(Model.barGlyph({ readiness: "absent" }), Model.GLYPH_INSTALL)
  assert.strictEqual(Model.barGlyph({ readiness: "stopped" }), Model.GLYPH_STOPPED)
})

test("the tooltip says something true in every state", () => {
  assert.strictEqual(Model.barTooltip({ readiness: "absent" }), "EasyEffects is not installed")
  assert.strictEqual(Model.barTooltip({ readiness: "running", bypassed: true }), "EasyEffects is bypassed")
  assert.strictEqual(Model.barTooltip({ readiness: "running", preset: "Laptop" }), "Preset: Laptop")
  assert.strictEqual(Model.barTooltip({ readiness: "running", preset: "" }), "No preset loaded")
})

console.log()
if (failures) {
  console.log(`${failures} failed`)
  process.exit(1)
}
console.log("all checks passed")
