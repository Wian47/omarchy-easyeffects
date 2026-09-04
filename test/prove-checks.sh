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
  "sed -i '0,/\"blocklist\": \\[\\]/s//\"blocklist\": [\"bluez_output.34_09_C9_99_88_8A.1\"]/' 'presets/output/Laptop.json'"

attempt "a preset carrying an absolute path from its author's machine" \
  "sed -i '0,/\"mode\": \"IIR\"/s//\"mode\": \"\\/home\\/someone\\/kernel\"/' 'presets/output/Laptop.json'"

attempt "a preset section the pipeline does not have" \
  "node -e 'const f=\"presets/output/Boosted.json\",fs=require(\"fs\");const d=JSON.parse(fs.readFileSync(f));d.sidechain={};fs.writeFileSync(f,JSON.stringify(d,null,4))'"

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
