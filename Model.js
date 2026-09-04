.pragma library

// Every codepoint below was verified against JetBrainsMono Nerd Font's cmap
// with fontTools rather than guessed, so a glyph here is the glyph that draws.
function codepoint(code) {
  if (String.fromCodePoint) return String.fromCodePoint(code)
  var offset = code - 0x10000
  return String.fromCharCode(0xD800 + (offset >> 10), 0xDC00 + (offset & 0x3FF))
}

var GLYPH_EQ = codepoint(0xF0EA2)          // md-equalizer
var GLYPH_BYPASS = codepoint(0xF0581)      // md-volume_off
var GLYPH_STOPPED = codepoint(0xF06A6)     // md-power_plug_off
var GLYPH_INSTALL = codepoint(0xF01DA)     // md-download
var GLYPH_ACTIVE = codepoint(0xF012C)      // md-check
var GLYPH_ALERT = codepoint(0xF0028)       // md-alert_circle
var GLYPH_REFRESH = codepoint(0xF0450)     // md-refresh
var GLYPH_SPEAKER = codepoint(0xF04C3)     // md-speaker
var GLYPH_HEADPHONES = codepoint(0xF02CB)  // md-headphones
var GLYPH_BLUETOOTH = codepoint(0xF00B0)   // md-bluetooth_audio
var GLYPH_LAPTOP = codepoint(0xF0322)      // md-laptop
var GLYPH_OPEN = codepoint(0xF03CC)        // md-open_in_new

var PAD = " "
var LABEL_WIDTH = 16

// EasyEffects reads a preset name off the socket with `[^\n]{1,100}`, so a
// longer name has to go the slow way round through the command line.
var SOCKET_NAME_LIMIT = 100

// Preset names come off a directory listing, so one of them can be "constructor"
// or "toString". Reaching into a plain object with such a name answers with
// something off Object.prototype instead of nothing, and the row would carry a
// function where a count belongs.
function own(map, key) {
  return map && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined
}

function fixedWidth(text, width) {
  var out = String(text || "")
  if (out.length > width) out = out.slice(0, width - 1) + "…"
  while (out.length < width) out = out + PAD
  return out
}

// Readiness is one of five states rather than three booleans, because the
// difference between them is what the panel offers, and "installed but never
// run" is a real state that a boolean pair cannot name: the presets can be put
// in place before EasyEffects has ever looked for them.
function readiness(seen) {
  if (!seen.binary) return seen.flatpak ? "flatpak-only" : "absent"
  if (!seen.presetDir) return "never-run"
  if (!seen.socket) return "stopped"
  return "running"
}

var READINESS = {
  "absent": {
    glyph: GLYPH_INSTALL,
    title: "EasyEffects is not installed",
    detail: "It is in Arch's extra repository. Installing it opens a terminal, because a password does not belong in a bar popup.",
    action: "install",
    actionLabel: "Install EasyEffects",
    canSync: false,
    canAct: false
  },
  "flatpak-only": {
    glyph: GLYPH_ALERT,
    title: "Only the Flatpak is installed",
    detail: "This drives the easyeffects package. The Flatpak keeps its presets and its socket somewhere else, and none of that has been tested here.",
    action: "",
    actionLabel: "",
    canSync: false,
    canAct: false
  },
  "never-run": {
    glyph: GLYPH_STOPPED,
    title: "EasyEffects has not been started yet",
    detail: "The presets are in place and it will find them the first time it runs.",
    action: "start",
    actionLabel: "Start EasyEffects",
    canSync: true,
    canAct: false
  },
  "stopped": {
    glyph: GLYPH_STOPPED,
    title: "EasyEffects is not running",
    detail: "Presets are listed and kept current. Switching one needs it running.",
    action: "start",
    actionLabel: "Start EasyEffects",
    canSync: true,
    canAct: false
  },
  "running": {
    glyph: GLYPH_EQ,
    title: "",
    detail: "",
    action: "",
    actionLabel: "",
    canSync: true,
    canAct: true
  }
}

function readinessState(name) {
  return READINESS[name] || READINESS["absent"]
}

// The global bypass is read in one encoding and written in another. Reading
// answers 1 for on and 2 for off; writing takes 1 for on and 0 for off. Feeding
// a reading straight back into a command inverts the setting, which is why
// neither side is written inline anywhere.
//
// The reading comes from `easyeffects -b 3` rather than the socket's own
// get_global_bypass, which answers with a single byte and no terminator. See
// socketWrite below.
function bypassFromReply(reply) {
  var value = String(reply || "").trim()
  if (value === "1") return true
  if (value === "2") return false
  return null
}

function bypassCommand(wanted) {
  return "global_bypass:" + (wanted ? "1" : "0")
}

// The socket is written to and never read from, which is not a simplification
// but the only correct reading of the protocol. Replies carry no framing of
// their own: get_last_loaded_preset ends in a newline and get_global_bypass
// does not, so two answers on one connection arrive as "2Bass Enhancing…" with
// nothing between them and no parser can separate them.
//
// Nothing is lost by it. The commands worth sending -- load_preset and
// global_bypass -- return no reply at all, and everything worth reading is
// either in easyeffectsrc, which is watched, or comes back framed from
// `easyeffects -b 3`.
function loadPresetCommand(pipeline, name) {
  if (!name || name.length > SOCKET_NAME_LIMIT || name.indexOf("\n") !== -1) return ""
  return "load_preset:" + pipeline + ":" + name
}

function bypassReadCommand() {
  return ["easyeffects", "-b", "3"]
}

// KConfig ini. Values are taken from the first `=` onwards, because a preset
// name may contain one and a key never does.
function parseIni(text) {
  var sections = {}
  var current = ""
  var lines = String(text || "").split("\n")
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim()
    if (!line || line.charAt(0) === "#") continue
    if (line.charAt(0) === "[" && line.charAt(line.length - 1) === "]") {
      current = line.slice(1, -1)
      if (!sections[current]) sections[current] = {}
      continue
    }
    var split = line.indexOf("=")
    if (split === -1 || !current) continue
    sections[current][line.slice(0, split)] = line.slice(split + 1)
  }
  return sections
}

function pipelineSection(pipeline) {
  return pipeline === "input" ? "StreamInputs" : "StreamOutputs"
}

function activePreset(ini, pipeline) {
  var presets = ini["Presets"] || {}
  return presets[pipeline === "input" ? "lastLoadedInputPreset" : "lastLoadedOutputPreset"] || ""
}

function currentDevice(ini, pipeline) {
  var section = ini[pipelineSection(pipeline)] || {}
  return section[pipeline === "input" ? "inputDevice" : "outputDevice"] || ""
}

// `usedPresets=Name:11,Other:8`. A preset name containing a comma cannot be
// told from a separator here, so such an entry is dropped rather than guessed
// at; it costs an ordering hint and never a wrong count against a real name.
function usageCounts(ini, pipeline) {
  var section = ini[pipelineSection(pipeline)] || {}
  var counts = {}
  var entries = String(section.usedPresets || "").split(",")
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i]
    var mark = entry.lastIndexOf(":")
    if (mark <= 0) continue
    var count = Number(entry.slice(mark + 1))
    if (!isFinite(count)) continue
    counts[entry.slice(0, mark)] = count
  }
  return counts
}

// One row per preset EasyEffects can see, the bundled and the user's own in one
// list, because EasyEffects has one namespace and showing two would be a
// fiction. A bundled preset whose impulse response is absent is listed and
// applies; it just says the convolver in it is doing nothing.
function presetRows(input) {
  var names = input.names || []
  var catalogue = input.catalogue || {}
  var usage = input.usage || {}
  var kernels = input.kernelsByPreset || {}
  var available = input.availableKernels || []
  var rows = []
  for (var i = 0; i < names.length; i++) {
    var name = names[i]
    var needed = own(kernels, name) || []
    var missing = []
    for (var k = 0; k < needed.length; k++) {
      if (available.indexOf(needed[k]) === -1) missing.push(needed[k])
    }
    rows.push({
      name: name,
      bundled: own(catalogue, name) !== undefined,
      active: name === input.active,
      uses: own(usage, name) || 0,
      description: own(catalogue, name) || null,
      missingKernels: missing
    })
  }
  rows.sort(function (a, b) {
    if (b.uses !== a.uses) return b.uses - a.uses
    return a.name.localeCompare(b.name)
  })
  return rows
}

// EasyEffects' own sink is the loopback this plugin's effects come out of.
// Binding a preset to it, or offering it as an output, means nothing.
function sinksFrom(text) {
  var sinks = []
  var lines = String(text || "").split("\n")
  for (var i = 0; i < lines.length; i++) {
    var fields = lines[i].split("\t")
    if (fields.length < 2) continue
    var name = fields[1]
    if (!name || name.indexOf("easyeffects_") === 0) continue
    sinks.push({ name: name, glyph: deviceGlyph(name), label: deviceLabel(name) })
  }
  return sinks
}

function deviceGlyph(name) {
  if (name.indexOf("bluez_") === 0) return GLYPH_BLUETOOTH
  if (name.indexOf("Speaker") !== -1 || name.indexOf("speaker") !== -1) return GLYPH_LAPTOP
  if (name.indexOf("Headphone") !== -1 || name.indexOf("headphone") !== -1) return GLYPH_HEADPHONES
  return GLYPH_SPEAKER
}

// PipeWire node names are made for machines. `alsa_output.pci-0000_05_00.6.
// HiFi__Speaker__sink` is the speakers, and nothing in the bar has room to say
// so at that length.
function deviceLabel(name) {
  if (name.indexOf("bluez_") === 0) return "Bluetooth"
  var parts = name.split("__")
  if (parts.length >= 2) return parts[1].replace(/_/g, " ")
  var tail = name.split(".").pop()
  return tail === "sink" || tail === "source" ? name.split(".")[0] : tail
}

// Only the modes the manifest offers draw anything. A mode falling through to
// the preset branch would let the manifest offer one this cannot render and
// look right doing it, which is a whole class of setting that silently does
// the wrong thing.
function barLabel(view, mode) {
  if (mode === "device") return fixedWidth(view.deviceLabel || "", LABEL_WIDTH)
  if (mode === "preset") return fixedWidth(view.bypassed ? "bypassed" : (view.preset || ""), LABEL_WIDTH)
  return ""
}

function barGlyph(view) {
  if (view.readiness !== "running") return readinessState(view.readiness).glyph
  return view.bypassed ? GLYPH_BYPASS : GLYPH_EQ
}

function barTooltip(view) {
  var state = readinessState(view.readiness)
  if (state.title) return state.title
  if (view.bypassed) return "EasyEffects is bypassed"
  return view.preset ? "Preset: " + view.preset : "No preset loaded"
}

// Everything the panel needs to know about the machine, in one spawn, emitted
// as tab-separated lines. Kernel names are pulled with grep rather than a JSON
// parser because the alternative is shipping one or depending on jq, and the
// field is written by EasyEffects in a fixed shape.
//
// Whether the socket is alive is deliberately not asked here. A stale socket
// file outlives a crash, so the only honest answer comes from connecting.
function probeCommand(dataDir) {
  return ["sh", "-c", [
    'set -u',
    'echo "runtime=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"',
    'command -v easyeffects >/dev/null 2>&1 && echo binary=1 || echo binary=0',
    '[ -d "$HOME/.var/app/com.github.wwmm.easyeffects" ] && echo flatpak=1 || echo flatpak=0',
    '[ -d "$1/output" ] && echo presetdir=1 || echo presetdir=0',
    'for pipe in output input; do',
    '  for f in "$1/$pipe"/*.json; do',
    '    [ -e "$f" ] || continue',
    '    n=${f##*/}; n=${n%.json}',
    '    printf "preset\t%s\t%s\n" "$pipe" "$n"',
    '    grep -o \'"kernel-name": *"[^"]*"\' "$f" 2>/dev/null | sed \'s/.*"\\([^"]*\\)"$/\\1/\' |',
    '      while IFS= read -r k; do [ -n "$k" ] && printf "kernel\t%s\t%s\n" "$n" "$k"; done',
    '  done',
    'done',
    'for f in "$1"/irs/*.irs; do',
    '  [ -e "$f" ] || continue',
    '  n=${f##*/}; printf "irs\t%s\n" "${n%.irs}"',
    'done'
  ].join("\n"), "sh", dataDir]
}

function parseProbe(text) {
  var out = {
    runtimeDir: "", binary: false, flatpak: false, presetDir: false,
    output: [], input: [], kernels: {}, irs: []
  }
  var lines = String(text || "").split("\n")
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i]
    if (line.indexOf("runtime=") === 0) out.runtimeDir = line.slice(8)
    else if (line === "binary=1") out.binary = true
    else if (line === "flatpak=1") out.flatpak = true
    else if (line === "presetdir=1") out.presetDir = true
    else {
      var fields = line.split("\t")
      if (fields[0] === "preset" && fields[2] && (fields[1] === "output" || fields[1] === "input")) {
        out[fields[1]].push(fields[2])
      } else if (fields[0] === "irs" && fields[1]) {
        out.irs.push(fields[1])
      } else if (fields[0] === "kernel" && fields[1] && fields[2]) {
        if (!own(out.kernels, fields[1])) out.kernels[fields[1]] = []
        out.kernels[fields[1]].push(fields[2])
      }
    }
  }
  return out
}

// Hashes of what is bundled and what is installed, in one spawn, so the verdict
// for every preset is decided from one consistent view rather than ten reads
// that could interleave with EasyEffects writing.
function hashCommand(pluginDir, dataDir) {
  return ["sh", "-c", [
    'set -u',
    'for f in "$1"/presets/output/*.json; do',
    '  [ -e "$f" ] || continue',
    '  n=${f##*/}; printf "bundled\\t%s\\t%s\\n" "${n%.json}" "$(sha256sum <"$f" | cut -d" " -f1)"',
    'done',
    'for f in "$2"/output/*.json; do',
    '  [ -e "$f" ] || continue',
    '  n=${f##*/}; printf "disk\\t%s\\t%s\\n" "${n%.json}" "$(sha256sum <"$f" | cut -d" " -f1)"',
    'done',
    'for f in "$1"/presets/irs/*.irs; do',
    '  [ -e "$f" ] || continue',
    '  n=${f##*/}; printf "kernel\\t%s\\n" "${n%.irs}"',
    'done'
  ].join("\n"), "sh", pluginDir, dataDir]
}

function parseHashes(text) {
  var out = { bundled: {}, disk: {}, kernels: [] }
  var lines = String(text || "").split("\n")
  for (var i = 0; i < lines.length; i++) {
    var fields = lines[i].split("\t")
    if (fields[0] === "kernel" && fields[1]) out.kernels.push(fields[1])
    else if (fields[1] && fields[2] && (fields[0] === "bundled" || fields[0] === "disk")) {
      out[fields[0]][fields[1]] = fields[2]
    }
  }
  return out
}

// Writes go to a temporary file in the destination directory and are renamed
// into place, so EasyEffects' own directory watcher never sees half a preset.
// Impulse responses are copied whenever a preset that names one is written,
// because a convolver whose kernel is missing sits in the chain doing nothing.
function copyCommand(pluginDir, dataDir, names) {
  return ["sh", "-c", [
    'set -eu',
    'P=$1; D=$2; shift 2',
    'mkdir -p "$D/output" "$D/irs"',
    'for f in "$P"/presets/irs/*.irs; do',
    '  [ -e "$f" ] || continue',
    '  n=${f##*/}',
    '  [ -e "$D/irs/$n" ] || { cp "$f" "$D/irs/.$n.new" && mv "$D/irs/.$n.new" "$D/irs/$n"; }',
    'done',
    'for n do',
    '  cp "$P/presets/output/$n.json" "$D/output/.$n.json.new"',
    '  mv "$D/output/.$n.json.new" "$D/output/$n.json"',
    'done'
  ].join("\n"), "sh", pluginDir, dataDir].concat(names)
}

// EasyEffects writes lastLoadedOutputPreset into its config lazily, so the file
// can name a preset that was replaced minutes ago. Measured: the file said
// "Dolby Atmos" while the running instance had loaded something else. The
// command line answers from the instance and frames its answer with a newline.
function activePresetCommand() {
  return ["sh", "-c", [
    'printf "output\\t%s\\n" "$(easyeffects -a output 2>/dev/null)"',
    'printf "input\\t%s\\n" "$(easyeffects -a input 2>/dev/null)"'
  ].join("\n")]
}

function parseActivePresets(text) {
  var out = { output: "", input: "" }
  var lines = String(text || "").split("\n")
  for (var i = 0; i < lines.length; i++) {
    var fields = lines[i].split("\t")
    if (fields[0] === "output" || fields[0] === "input") out[fields[0]] = fields[1] || ""
  }
  return out
}
