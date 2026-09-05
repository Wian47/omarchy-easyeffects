#!/usr/bin/env bash
# Proves presets.test.js fails when each invariant it claims to guard is broken.
# A check nobody has watched fail is a check nobody knows works, and the two
# that matter most here guard silent failures: a blocklist that makes the
# effects do nothing in one application, and a missing impulse response that
# makes a convolver stage do nothing at all.
#
# Each case copies the repo to a scratch directory, breaks one thing, and
# expects a non-zero exit. Run with: bash test/prove-checks.sh
set -u

SRC=$(cd "$(dirname "$0")/.." && pwd)
LAB=$(mktemp -d)
trap 'rm -rf "$LAB"' EXIT

pass=0
missed=0

attempt() {
  local name=$1 mutate=$2 suite=${3:-presets}
  rm -rf "$LAB/repo"
  cp -r "$SRC" "$LAB/repo"
  rm -rf "$LAB/repo/.git"
  ( cd "$LAB/repo" && eval "$mutate" )
  if ( cd "$LAB/repo" && node "test/$suite.test.js" >/dev/null 2>&1 ); then
    echo "  MISSED $name"
    missed=$((missed + 1))
  else
    echo "  caught $name"
    pass=$((pass + 1))
  fi
}

echo "Breaking one invariant at a time:"

# The defect the suite was written for, reintroduced the way it would really
# arrive: somebody copies a preset off a machine that excludes one application.
attempt "a preset carrying the author's application blocklist" \
  "node -e 'const f=\"presets/output/Perfect EQ.json\",fs=require(\"fs\");const d=JSON.parse(fs.readFileSync(f));d.output.blocklist=[\"Spotify\"];fs.writeFileSync(f,JSON.stringify(d,null,4))'"

attempt "an impulse response a preset names but nothing ships" \
  "rm 'presets/irs/Razor Surround ((48k Z-Edition)) 2.Stereo +20 bass.irs'"

attempt "an impulse response shipped that no preset names" \
  "cp 'presets/irs/Razor Surround ((48k Z-Edition)) 2.Stereo +20 bass.irs' 'presets/irs/Unused.irs'"

attempt "an impulse response that is not actually a WAV" \
  "printf 'not a wav at all' > 'presets/irs/Razor Surround ((48k Z-Edition)) 2.Stereo +20 bass.irs'"

attempt "a preset shipped with no description" \
  "cp 'presets/output/Perfect EQ.json' 'presets/output/Undescribed.json'"

attempt "a description for a preset that is not shipped" \
  "rm 'presets/output/Boosted.json'"

attempt "a description that does not say what the preset is for" \
  "sed -i '0,/    use: \"/s//    use: \"x\", ignored: \"/' Presets.js"

attempt "a preset carrying the device it was made on" \
  "sed -i '0,/\"blocklist\": \\[\\]/s//\"blocklist\": [\"bluez_output.AA_BB_CC_11_22_33.1\"]/' 'presets/output/Laptop.json'"

attempt "a preset carrying an absolute path from its author's machine" \
  "sed -i '0,/\"mode\": \"IIR\"/s//\"mode\": \"\\/home\\/someone\\/kernel\"/' 'presets/output/Laptop.json'"

attempt "a preset section the pipeline does not have" \
  "node -e 'const f=\"presets/output/Boosted.json\",fs=require(\"fs\");const d=JSON.parse(fs.readFileSync(f));d.sidechain={};fs.writeFileSync(f,JSON.stringify(d,null,4))'"

attempt "a bypass conversion that inverts the setting" \
  "sed -i 's/return \"global_bypass:\" + (wanted ? \"1\" : \"0\")/return \"global_bypass:\" + (wanted ? \"0\" : \"1\")/' Model.js" \
  model

attempt "a readiness that would sync presets with EasyEffects absent" \
  "sed -i '0,/    canSync: false/s//    canSync: true/' Model.js" \
  model

attempt "a bar label that stops holding its width" \
  "sed -i 's/while (out.length < width) out = out + PAD/return out/' Model.js" \
  model

attempt "a preset lookup that answers with an Object member" \
  "sed -i 's/uses: own(usage, name) || 0/uses: usage[name] || 0/' Model.js" \
  model

attempt "a QML file that no longer parses" \
  "printf '\nItem { property int x: }\n' >> Service.qml" \
  wiring

attempt "a call to a Model function that does not exist" \
  "sed -i 's/Model\.barGlyph(/Model.barGlyphRenamed(/' Panel.qml" \
  wiring

attempt "a panel binding to a service property that does not exist" \
  "sed -i '0,/ee\.readiness/s//ee.isReady/' Panel.qml" \
  wiring

# The bar builds this panel once per monitor, and two services would run two
# syncs against one preset directory. Invisible to any check that reads one file.
attempt "a Service built inside the panel, which the bar would build twice" \
  "sed -i '0,/  Loader {/s//  Service { id: rogue }\n\n  Loader {/' Panel.qml" \
  wiring

attempt "a panel that no longer asks the shell for the shared service" \
  "sed -i 's/serviceFor(\"wian47.easyeffects\")/serviceFor(\"wian47.something-else\")/' Panel.qml" \
  wiring

attempt "a manifest that stops declaring the service kind" \
  "node -e 'const f=\"manifest.json\";const m=require(\"./\"+f);m.kinds=[\"bar-widget\"];require(\"fs\").writeFileSync(f,JSON.stringify(m,null,2))'" \
  wiring

attempt "an entry point naming a file that is not in the plugin" \
  "node -e 'const f=\"manifest.json\";const m=require(\"./\"+f);m.entryPoints.service=\"Missing.qml\";require(\"fs\").writeFileSync(f,JSON.stringify(m,null,2))'" \
  wiring

attempt "a setting offered in the manifest that no code reads" \
  "node -e 'const f=\"manifest.json\";const m=require(\"./\"+f);m.barWidget.defaults.unusedKnob=1;m.barWidget.schema.push({key:\"unusedKnob\",type:\"boolean\",label:\"x\",defaultValue:true,description:\"x\"});require(\"fs\").writeFileSync(f,JSON.stringify(m,null,2))'" \
  wiring

attempt "a bar label mode the manifest offers and the model cannot draw" \
  "node -e 'const f=\"manifest.json\";const m=require(\"./\"+f);m.barWidget.schema.find(e=>e.key===\"barLabel\").options.push(\"sideways\");require(\"fs\").writeFileSync(f,JSON.stringify(m,null,2))'" \
  wiring

attempt "a manifest id the panel does not register" \
  "sed -i 's/moduleName: \"wian47.easyeffects\"/moduleName: \"wian47.renamed\"/' Panel.qml" \
  wiring

# The plugin hands escalation to Omarchy's installer, in a terminal the user can
# see. A password prompt inside a bar popup would be teaching a bad habit.
attempt "a privilege escalation in code the shell loads" \
  "sed -i 's|\"omarchy-install-and-launch\", \"EasyEffects\"|\"sudo\", \"pacman\"|' Service.qml" \
  wiring

# Reading the socket looks harmless and cannot work: get_global_bypass answers
# with one byte and no terminator, so two replies arrive run together.
attempt "a parser attached to the socket's unframed replies" \
  "sed -i '0,/  Socket {/s//  Socket { parser: SplitParser { splitMarker: \"\\\\n\" } }\n\n  Socket {/' Service.qml" \
  wiring

# The importer is the only supported route into presets/, so it gets its own
# case: a source whose preset excludes an application must arrive clean.
echo
echo "The importer refuses to carry a blocklist through:"
rm -rf "$LAB/src/output" "$LAB/src/irs"
mkdir -p "$LAB/src/output" "$LAB/src/irs"
node -e '
  const fs = require("fs")
  fs.writeFileSync(process.argv[1] + "/output/Fixture.json",
    JSON.stringify({ output: { blocklist: ["Spotify", "Firefox"], equalizer: { "input-gain": -2.0 } } }, null, 4))
' "$LAB/src"
rm -rf "$LAB/repo"
cp -r "$SRC" "$LAB/repo"
rm -f "$LAB/repo/presets/output/"*.json "$LAB/repo/presets/irs/"*.irs
if ( cd "$LAB/repo" && node tools/import-presets.js --from "$LAB/src" >/dev/null 2>&1 ) &&
   [ "$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).output.blocklist.length)' "$LAB/repo/presets/output/Fixture.json")" = "0" ]; then
  echo "  caught a source preset that excluded two applications"
  pass=$((pass + 1))
else
  echo "  MISSED a source preset that excluded two applications"
  missed=$((missed + 1))
fi

echo
if [ "$missed" -eq 0 ]; then
  echo "All $pass checks caught the break they exist for."
  exit 0
fi
echo "$missed of $((pass + missed)) breaks went unnoticed."
exit 1
