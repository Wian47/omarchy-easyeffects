// Tests for the presets this plugin ships. Run with: node test/presets.test.js
//
// The requirement these exist for is that the presets work for somebody who is
// not the person who made them. Two things break that quietly. A preset can
// carry the author's per-application blocklist, which reads as the effects not
// working in one app. And a convolver can name an impulse response that was
// never shipped, which leaves the stage in the chain doing nothing at all.
// Neither shows up as an error anywhere.

const fs = require("fs")
const path = require("path")
const assert = require("assert")

const root = path.join(__dirname, "..")
const outputDir = path.join(root, "presets", "output")
const irsDir = path.join(root, "presets", "irs")

const presetFiles = fs.readdirSync(outputDir).filter(f => f.endsWith(".json")).sort()
const presets = presetFiles.map(file => ({
  name: file.replace(/\.json$/, ""),
  file,
  text: fs.readFileSync(path.join(outputDir, file), "utf8")
}))
presets.forEach(p => { p.data = JSON.parse(p.text) })

const shippedKernels = fs.readdirSync(irsDir)
  .filter(f => f.endsWith(".irs"))
  .map(f => f.replace(/\.irs$/, ""))

const source = fs.readFileSync(path.join(root, "Presets.js"), "utf8")
  .replace(/^\.pragma library\s*$/m, "")
const Presets = new Function(source + "\nreturn { CATALOGUE, names, describe, isBundled };")()

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

function kernelsNamedBy(preset) {
  const names = []
  JSON.stringify(preset, (key, value) => {
    if (key === "kernel-name" && value) names.push(value)
    return value
  })
  return names
}

function sections(data) {
  return Object.keys(data).map(key => [key, data[key]])
}

test("there are presets to ship", () => {
  assert.ok(presets.length > 0, "presets/output is empty")
})

test("every preset is valid JSON describing a pipeline", () => {
  for (const p of presets) {
    const keys = Object.keys(p.data)
    assert.ok(keys.length > 0, `${p.file} has no pipeline`)
    for (const key of keys) {
      assert.ok(key === "output" || key === "input", `${p.file} has an unexpected section '${key}'`)
    }
  }
})

// The defect this suite was written for. EasyEffects stores the per-app
// blocklist inside the preset, so a preset copied off a working machine ships
// that machine's exclusions to everybody.
test("no preset carries somebody's application blocklist", () => {
  for (const p of presets) {
    for (const [name, section] of sections(p.data)) {
      const blocklist = section.blocklist
      assert.ok(Array.isArray(blocklist), `${p.file} has no ${name}.blocklist array`)
      assert.strictEqual(blocklist.length, 0,
        `${p.file} excludes ${blocklist.join(", ")} in ${name}; run tools/import-presets.js`)
    }
  }
})

test("every impulse response a preset names is shipped with it", () => {
  for (const p of presets) {
    for (const kernel of kernelsNamedBy(p.data)) {
      assert.ok(shippedKernels.includes(kernel),
        `${p.file} names the kernel '${kernel}' and presets/irs does not have it`)
    }
  }
})

test("no impulse response is shipped that nothing names", () => {
  const named = new Set(presets.flatMap(p => kernelsNamedBy(p.data)))
  for (const kernel of shippedKernels) {
    assert.ok(named.has(kernel), `presets/irs/${kernel}.irs is named by no preset`)
  }
})

test("every impulse response is a readable WAV", () => {
  for (const kernel of shippedKernels) {
    const head = fs.readFileSync(path.join(irsDir, `${kernel}.irs`)).subarray(0, 12)
    assert.strictEqual(head.subarray(0, 4).toString(), "RIFF", `${kernel}.irs is not RIFF`)
    assert.strictEqual(head.subarray(8, 12).toString(), "WAVE", `${kernel}.irs is not WAVE`)
  }
})

test("no preset carries anything belonging to one machine", () => {
  const forbidden = [
    [/\/home\/[a-z]/i, "a home directory"],
    [/"\/(usr|etc|var|opt|run|tmp)\//i, "an absolute path"],
    [/\b[0-9a-f]{2}(:[0-9a-f]{2}){5}\b/i, "a MAC address"],
    [/\b[0-9a-f]{2}(_[0-9a-f]{2}){5}\b/i, "a MAC address"],
    [/\b(bluez_(output|input)|alsa_(output|input))\./i, "a device name"]
  ]
  for (const p of presets) {
    for (const [pattern, what] of forbidden) {
      const hit = p.text.match(pattern)
      assert.ok(!hit, `${p.file} contains ${what}: ${hit && hit[0]}`)
    }
  }
})

// A preset nobody can read the name of is a preset nobody picks. Both
// directions, so neither an undescribed preset nor a description for something
// that was never shipped can survive.
test("every shipped preset is described, and every description ships", () => {
  const shipped = presets.map(p => p.name).sort()
  const described = Presets.names().sort()
  assert.deepStrictEqual(described, shipped,
    `described but not shipped: ${described.filter(n => !shipped.includes(n)).join(", ") || "none"}; ` +
    `shipped but not described: ${shipped.filter(n => !described.includes(n)).join(", ") || "none"}`)
})

test("every description says what the preset is and what it is for", () => {
  for (const name of Presets.names()) {
    const entry = Presets.describe(name)
    assert.ok(entry.summary && entry.summary.length > 30, `${name} has no real summary`)
    assert.ok(entry.use && entry.use.length > 30, `${name} does not say what it is for`)
    for (const key of Object.keys(entry)) {
      assert.ok(["summary", "use", "caution"].includes(key), `${name} has an unexpected field '${key}'`)
    }
  }
})

test("isBundled answers for the shipped set and nothing else", () => {
  assert.ok(Presets.isBundled(presets[0].name))
  assert.ok(!Presets.isBundled("Something The User Made"))
  assert.ok(!Presets.isBundled("constructor"))
})

console.log()
if (failures) {
  console.log(`${failures} failed`)
  process.exit(1)
}
console.log(`${presets.length} presets, ${shippedKernels.length} impulse responses, all checks passed`)
