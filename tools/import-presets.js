#!/usr/bin/env node
// Copies presets and their impulse responses out of a working EasyEffects into
// presets/, stripping anything personal on the way. Run with:
//   node tools/import-presets.js [--from ~/.local/share/easyeffects] [--check]
//
// EasyEffects stores the per-application blocklist inside the preset file, so a
// plain `cp` from a machine that excludes Spotify ships that exclusion to
// everyone who loads the preset, where it looks like the effects silently not
// working in one app. This is the only route into presets/ so that cannot
// happen by hand.
//
// Preset bytes are otherwise copied verbatim rather than re-serialised.
// EasyEffects writes `4.0`, JSON.stringify writes `4`, and rewriting all ten
// files would turn every future import into a diff nobody can read.

const fs = require("fs")
const path = require("path")

const args = process.argv.slice(2)
const checkOnly = args.includes("--check")
const fromIndex = args.indexOf("--from")
const source = fromIndex === -1
  ? path.join(process.env.HOME, ".local/share/easyeffects")
  : args[fromIndex + 1]
const target = path.join(__dirname, "..", "presets")

// Matches the block EasyEffects writes for a populated blocklist, at any depth,
// and the empty form it writes when there is nothing in it.
const BLOCKLIST_BLOCK = /^([ \t]*)"blocklist": \[\n(?:.*\n)*?[ \t]*\],$/m
const BLOCKLIST_EMPTY = /^[ \t]*"blocklist": \[\],$/m

function emptyTheBlocklist(text) {
  if (BLOCKLIST_EMPTY.test(text)) return text
  return text.replace(BLOCKLIST_BLOCK, (_, indent) => `${indent}"blocklist": [],`)
}

// The textual edit is only safe because of this: parse both sides and confirm
// the blocklist is the single thing that moved.
function assertOnlyBlocklistChanged(before, after, name) {
  const a = JSON.parse(before)
  const b = JSON.parse(after)
  for (const section of Object.keys(b)) {
    if (b[section] && typeof b[section] === "object") b[section].blocklist = a[section].blocklist
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${name}: the blocklist edit changed something else`)
  }
  for (const section of Object.keys(JSON.parse(after))) {
    const list = JSON.parse(after)[section].blocklist
    if (list && list.length) throw new Error(`${name}: blocklist survived in ${section}`)
  }
}

// A convolver names its kernel by basename with no extension, and a kernel that
// is not there leaves the stage in the chain doing nothing at all. So the
// impulse responses travel with the presets that name them, and only those.
function kernelsNamedBy(preset) {
  const names = []
  JSON.stringify(preset, (key, value) => {
    if (key === "kernel-name" && value) names.push(value)
    return value
  })
  return names
}

let wrote = 0
let stripped = []
const wanted = new Set()

const outputDir = path.join(source, "output")
for (const file of fs.readdirSync(outputDir).filter(f => f.endsWith(".json")).sort()) {
  const before = fs.readFileSync(path.join(outputDir, file), "utf8")
  const after = emptyTheBlocklist(before)
  if (after !== before) {
    assertOnlyBlocklistChanged(before, after, file)
    stripped.push(file)
  }
  kernelsNamedBy(JSON.parse(after)).forEach(k => wanted.add(k))

  const destination = path.join(target, "output", file)
  const current = fs.existsSync(destination) ? fs.readFileSync(destination, "utf8") : null
  if (current === after) continue
  if (checkOnly) throw new Error(`${file} is not what this importer would write`)
  fs.writeFileSync(destination, after)
  wrote++
}

for (const kernel of [...wanted].sort()) {
  const file = `${kernel}.irs`
  const origin = path.join(source, "irs", file)
  if (!fs.existsSync(origin)) throw new Error(`${file} is named by a preset and is not in ${source}/irs`)
  const destination = path.join(target, "irs", file)
  const same = fs.existsSync(destination) && fs.readFileSync(origin).equals(fs.readFileSync(destination))
  if (same) continue
  if (checkOnly) throw new Error(`${file} is not what this importer would write`)
  fs.copyFileSync(origin, destination)
  wrote++
}

console.log(`${fs.readdirSync(path.join(target, "output")).length} presets, ${wanted.size} impulse responses`)
console.log(stripped.length ? `blocklist emptied in: ${stripped.join(", ")}` : "no blocklist to empty")
console.log(checkOnly ? "presets/ matches the source" : `${wrote} file(s) written`)
