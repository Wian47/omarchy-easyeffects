# Omarchy EasyEffects — specification

An Omarchy bar widget that switches EasyEffects presets, bypasses the chain,
and binds a preset to an output device — and that ships ten working presets so
the widget is useful the minute it is enabled rather than after an afternoon
of dragging EQ bands.

EasyEffects has a good GUI and no fast path. Changing a preset means finding
the window, finding the presets tab, and clicking. This puts the same three
actions one click from the bar, and stops the presets being something each
person has to build alone.

Status: the presets are in and guarded; no plugin code yet. `presets/`,
`Presets.js`, `tools/import-presets.js`, `test/presets.test.js` and
`test/prove-checks.sh` exist. `manifest.json`, `Service.qml` and `Panel.qml` do
not. Everything under "What EasyEffects actually offers" was measured on this
machine against easyeffects 8.2.8-1; everything under "Confirm before writing
code" was not.

## Decisions already taken

| Question | Answer |
| --- | --- |
| Convolver impulse responses | Ship both `.irs` files (95 KB total) so the three convolver presets work out of the box. |
| Installed preset names | Exact names, never overwrite. A name that already exists and was not written by this plugin is left alone and reported as skipped. |
| v1 scope | Switch presets, global bypass, per-device autoload, and the input pipeline as well as the output one. |

## What EasyEffects actually offers

### A local socket, not a D-Bus API

EasyEffects 8 listens on a Unix stream socket at
`$XDG_RUNTIME_DIR/EasyEffectsServer`. Commands are newline-terminated; a
command without the trailing newline is silently ignored. Replies are
newline-terminated. It registers no well-known D-Bus name.

Verified live:

```
$ printf 'get_last_loaded_preset:output\n' | socat - UNIX-CONNECT:$XDG_RUNTIME_DIR/EasyEffectsServer
Bass Enhancing + Perfect EQ - Low Latency
$ printf 'get_global_bypass\n' | socat - UNIX-CONNECT:$XDG_RUNTIME_DIR/EasyEffectsServer
2
```

The command grammar, read out of the binary:

```
load_preset:(input|output):<name>      name is 1..100 chars, no newline
get_last_loaded_preset:(input|output)
global_bypass:(0|1)
get_global_bypass                       undocumented, works
set_property:(input|output):<plugin>:<index>:[(left|right):]<key>:<value>
get_property:(input|output):<plugin>:<index>:[(left|right):]<key>
```

This matters because it removes a process spawn from every click. Quickshell
has `Quickshell.Io.Socket`, so the service holds one connection open for the
life of the shell and each action is a line of text.

**Two traps in that grammar.**

The bypass encoding is inconsistent between read and write. `get_global_bypass`
answers in the CLI's encoding — `1` enabled, `2` disabled — while
`global_bypass:` takes `0` and `1`. Feeding a read value straight back into a
write inverts the setting. The service must convert, and a unit test must hold
that conversion in place.

An unrecognised command returns an empty line, and so does a valid command with
no value — `get_last_loaded_preset:input` is empty here only because no input
preset has ever been loaded. Empty therefore cannot mean "unsupported". The
service treats an empty reply as an empty value and detects an absent or
incompatible EasyEffects by whether the socket exists and connects at all.

**Replies are untagged.** A reply carries no reference to the command that
caused it, so over one persistent connection there is no way to match the
second answer to the second question. The service keeps one request in flight
and queues the rest: `write`, wait for the next line from the `SplitParser`,
resolve, send the next. The queue is short by construction — every command here
is a click — and a request with no reply inside two seconds is failed rather
than left to desynchronise the queue against the stream.

Verified with `Quickshell.Io.Socket` present at
`/usr/lib/qt6/qml/Quickshell/Io`, exposing `path`, `connected`, `write()` and
`flush()` over a `DataStream`, which is where the `\n` `SplitParser` attaches.

### The CLI, as the fallback

```
easyeffects -l <name>          load a preset
easyeffects -p                 list presets
easyeffects -s                 last loaded input and output presets
easyeffects -b 3               read global bypass (1 on, 2 off)
easyeffects --bypass-toggle
easyeffects --service-mode     run headless
```

Used in exactly two cases: a preset name longer than the socket's 100-character
limit, and a socket that will not connect. Not used for polling.

### Where the files live

```
~/.local/share/easyeffects/output/<name>.json      output presets
~/.local/share/easyeffects/input/<name>.json       input presets
~/.local/share/easyeffects/irs/<name>.irs          impulse responses (RIFF WAV)
~/.local/share/easyeffects/autoload/output/        per-device bindings
~/.config/easyeffects/db/easyeffectsrc             KConfig ini, current state
```

A preset's name is its filename. There is no name field inside the JSON.

`easyeffectsrc` is the cheapest source of live state and is watchable with a
`FileView`:

```ini
[Presets]
lastLoadedOutputPreset=Bass Enhancing + Perfect EQ - Low Latency

[StreamOutputs]
outputDevice=bluez_output.AA_BB_CC_11_22_33.1
blocklist=Spotify
usedPresets=Perfect EQ:11,Bass Boosted:8,...
```

So: the preset list comes from watching a directory, the active preset from
watching a file, and only the actions cost a socket write. Nothing polls.

EasyEffects also supports "community presets" from `$XDG_DATA_DIRS`, which
would have been the elegant way to publish a set without touching anyone's
files. It is not available to us: those directories are root-owned, and a shell
plugin cannot add to `XDG_DATA_DIRS` for a process that is already running.
Copying into `~/.local/share/easyeffects/output/` is the only route.

## What ships

Ten output presets, taken from this machine:

| Preset | Chain | Needs an IR |
| --- | --- | --- |
| Perfect EQ | equalizer | |
| Boosted | equalizer | |
| Bass Boosted | equalizer, convolver, bass_enhancer, crossfeed, maximizer | yes |
| Bass Enhancing + Perfect EQ | equalizer, convolver | yes |
| Bass Enhancing + Perfect EQ - Low Latency | equalizer, convolver, limiter | yes |
| Advanced Auto Gain | equalizer, exciter, autogain, limiter | |
| Loudness+Autogain | equalizer, bass_enhancer, loudness, autogain, compressor, crossfeed | |
| Dolby Atmos | equalizer, bass_enhancer, stereo_tools, reverb | |
| Laptop | gate, compressor, multiband_compressor, equalizer, limiter | |
| Speaker Sync | delay, stereo_tools, crossfeed, equalizer | |

Two impulse responses, because three presets reference them by name:

```
Razor Surround ((48k Z-Edition)) 2.Stereo +20 bass.irs              71,372 bytes
Razor Surround ((48k Z-Edition)) 2.Stereo +20 bass Low Latency.irs  24,044 bytes
```

The convolver names a kernel by basename without the `.irs` extension. If the
file is missing the convolver stays in the chain and does nothing, silently, so
"the IR is installed" is part of "the preset is installed" and is checked as
one thing.

No input presets ship. The input section lists whatever the user has and says
plainly that it is empty otherwise, rather than hiding.

## Preparing the presets for strangers

The ten presets work here. Three things stand between that and "anyone can
use", and the first is a defect.

**One preset carries a personal blocklist.** EasyEffects stores the per-app
blocklist *inside* the preset file, and `Bass Enhancing + Perfect EQ - Low
Latency` — the most-used preset here, 43 loads — contains:

```json
"blocklist": ["Spotify"]
```

Shipped as-is, everyone who loads it silently gets EasyEffects disabled for
Spotify, and the only symptom is that the EQ does nothing in one application.
It has to be emptied on the way into the repo. Every other preset is already
`[]`, and no preset contains a path, a hostname, a MAC address, or a device
name — swept and confirmed.

This is a rule, not a one-time fix: `test/presets.test.js` asserts
`output.blocklist` is empty for every shipped preset, so the next preset copied
in from a working machine cannot bring someone's personal exclusions with it.

**The names mean nothing to anyone else.** EasyEffects presets have no
description field, so the name is all a stranger gets, and "Dolby Atmos",
"Laptop", and "Speaker Sync" do not explain themselves. Ten opaque names is
most of the distance between shipping presets and shipping presets people use.
So the repo carries a description table — name, one sentence on what it does,
what it is for — that the panel renders under each bundled preset. It lives in
`Presets.js` next to the sync verdicts, and `presets.test.js` fails if a
shipped preset has no description or a description names a preset that is not
shipped.

Worth writing carefully for two of them. `Speaker Sync` has `time-l` and
`time-r` both at `0.0`, so it delays nothing — it is crossfeed and a gentle EQ
under a name that promises alignment. Either the description says that plainly
or the preset gets a truer name. And `Boosted` is +5 dB of EQ with no limiter,
the largest boost in the set, which is worth a word to whoever clicks it while
wearing headphones.

**The impulse responses are not yours to license.** The two `.irs` files are
derived from a commercial DSP pack, and shipping them is a decision taken with
that understood. The repo should say so rather than let a fork discover it:
`presets/irs/PROVENANCE.md` names where they came from, and the README states
that MIT covers the code and the presets but not the impulse responses. That
turns a takedown request into something answerable, and it is honest to anyone
who forks the repo expecting MIT to mean MIT throughout.

One portability worry closed: EasyEffects resamples a convolver kernel to the
graph rate — `"kernel has {} rate. Resampling it to {}"`, through libspeexdsp —
so the 48 kHz IRs are correct on a machine running at 44.1 kHz. No per-rate
variants are needed.

## Repo layout

```
manifest.json
Service.qml            socket, file watchers, preset sync, autoload writes
Panel.qml              bar icon and popup
Model.js               pure: parsing, formatting, bar label
Presets.js             pure: the sync decision, the ledger
presets/output/*.json  the ten
presets/irs/*.irs      the two
README.md
LICENSE
preview.png
test/model.test.js
test/presets.test.js
test/wiring.test.js
test/prove-checks.sh
.github/workflows/tests.yml
```

`presets/` is a plain copy of `~/.local/share/easyeffects/output/`. Nothing is
rewritten on the way in, so the shipped file and the working file are the same
bytes and a diff is meaningful.

## manifest.json

```json
{
  "schemaVersion": 1,
  "id": "wian47.easyeffects",
  "name": "EasyEffects",
  "version": "0.1.0",
  "author": "Wian Schoeman",
  "license": "MIT",
  "homepage": "https://github.com/Wian47/omarchy-easyeffects",
  "description": "Switch EasyEffects presets from the Omarchy bar, and ten presets worth switching to.",
  "kinds": ["service", "bar-widget"],
  "entryPoints": { "service": "Service.qml", "barWidget": "Panel.qml" },
  "barWidget": {
    "displayName": "EasyEffects",
    "description": "The active audio preset, one click from changing it, plus a bypass to hear the source and a preset bound to each output device.",
    "category": "Audio",
    "allowMultiple": false,
    "defaultSection": "right",
    "defaults": {
      "barLabel": "preset",
      "syncPresets": true,
      "hideWhenUnavailable": false,
      "notifyOnAutoload": false
    },
    "schema": [
      { "key": "barLabel", "type": "enum", "label": "Text beside the icon",
        "options": ["none", "preset", "device"], "defaultValue": "preset",
        "description": "Show the active preset or the output device it is playing through. Vertical bars stay icon-only." },
      { "key": "syncPresets", "type": "boolean", "label": "Keep the bundled presets installed",
        "defaultValue": true,
        "description": "Copy the ten bundled presets into EasyEffects and keep them current. A preset you have edited is never overwritten." },
      { "key": "hideWhenUnavailable", "type": "boolean", "label": "Hide when EasyEffects is unavailable",
        "defaultValue": false,
        "description": "Leave the bar alone when EasyEffects is closed or not installed, instead of showing a dimmed icon that offers to fix it." },
      { "key": "notifyOnAutoload", "type": "boolean", "label": "Notify when a device switches the preset",
        "defaultValue": false,
        "description": "Announce the preset EasyEffects loaded after an output device changed." }
    ]
  }
}
```

Every key in `defaults` is read by code. `test/wiring.test.js` enforces that in
both directions, as it does in the sibling plugins.

The plugin declares `service` as well as `bar-widget` because the bar builds a
panel per monitor and one socket connection, one sync run, and one set of file
watchers must be shared. `Panel.qml` reaches the single instance through
`bar.shell.serviceFor("wian47.easyeffects")` and never declares a `Service {}`
of its own.

## Preset sync, and the ledger

The rule chosen is "exact names, never overwrite", which is only honest if the
plugin can tell three cases apart: a name nobody has taken, a name this plugin
wrote and nobody has since edited, and a name that belongs to someone else. A
file's presence cannot distinguish them. A ledger can.

`~/.config/omarchy/easyeffects/installed.json`:

```json
{
  "version": 1,
  "presets": {
    "Perfect EQ": { "sha256": "…", "bundleVersion": "0.1.0", "installedAt": "2026-09-04T13:02:11Z" }
  },
  "irs": {
    "Razor Surround ((48k Z-Edition)) 2.Stereo +20 bass": { "sha256": "…", "bundleVersion": "0.1.0" }
  }
}
```

For each bundled file, `Presets.js` returns one of five verdicts from the
bundled hash, the on-disk hash, and the ledger entry. The function is pure and
takes those three as arguments, so every branch is a unit test with no
filesystem:

| On disk | Ledger | Verdict | Action |
| --- | --- | --- | --- |
| absent | any | `install` | write, record |
| matches bundle | present | `current` | nothing |
| matches ledger, ≠ bundle | present | `update` | write, record — we wrote it, it is unedited, the bundle moved on |
| ≠ ledger, ≠ bundle | present | `yours` | never touch, show "edited by you" |
| any | absent | `skipped` | never touch, show "you already have a preset with this name" |

Nothing is written unless the verdict says so, which makes a sync run
idempotent and makes a second run cost ten hashes and no writes.

Sync runs when the service starts, when `syncPresets` is turned on, and from a
"Re-check bundled presets" action in the panel. Turning `syncPresets` off stops
future syncs and removes nothing — deleting a preset out from under someone is
worse than leaving one behind, and the panel offers per-preset removal for the
files the ledger proves we wrote.

Writes go to a temporary file in the same directory and are renamed into place,
so EasyEffects's directory watcher never sees a half-written preset.

A preset is reported installed only when its own file and every `.irs` it names
are both present. The three convolver presets are therefore blocked behind
their IRs rather than appearing to work.

## The panel

One popup, four sections:

**Now.** The active output preset, the device it is playing through, and the
bypass switch. Bypass is the one control that changes what is audible without
changing what is configured, so it is a switch with a state, not a button.

**Output presets.** Every preset in `~/.local/share/easyeffects/output/`, the
bundled and the personal in one list because EasyEffects has one namespace and
pretending otherwise would be a fiction. A bundled preset carries a quiet
marker and its verdict when the verdict is interesting — `edited by you`,
`skipped, name taken`, `impulse response missing`. Click applies. The list is
ordered by `mostUsedPresets` from `easyeffectsrc` where that key exists,
alphabetically after that, because the preset someone reaches for most should
not be the one they scroll to.

**Input presets.** The same, for the input pipeline. Empty for a new user, and
says so in a sentence rather than showing a blank box.

**Devices.** Each output device with the preset bound to it, or `none`. Setting
one writes an autoload file; clearing one deletes it. The device currently in
use is marked. Devices come from `pactl list short sinks`, with EasyEffects's
own `easyeffects_sink` filtered out — it is the plugin's own loopback, and
binding a preset to it is meaningless.

## Autoload

EasyEffects keys an autoload binding by device *and route*, and the manager's
own signature confirms the shape:

```
AutoloadManager::add(PipelineType, device, device-description, device-profile, preset-name)
AutoloadManager::load(PipelineType, device, route)
```

The JSON body's four fields are `device`, `device-description`,
`device-profile`, `preset-name`. That much is read out of the binary and is not
in doubt. The filename convention under `autoload/output/` is not, and guessing
it produces files EasyEffects ignores in silence, which is the worst failure
this plugin could have.

So autoload is gated on the first item under "Confirm before writing code". If
the format cannot be pinned down, the section ships read-only — showing the
bindings EasyEffects already has, with a button that opens EasyEffects at that
tab — rather than writing files that do nothing.

## When EasyEffects is not there

Readiness is a ladder, not a boolean, and each rung has a different right
answer. The plugin resolves it in this order and stops at the first match.

| Rung | Detected by | What happens |
| --- | --- | --- |
| Not installed | `command -v easyeffects` fails and `~/.var/app/com.github.wwmm.easyeffects/` is absent | Offer to install, once. Nothing is written to disk. |
| Flatpak only | that directory exists, the binary does not | Say so, do nothing else. |
| Installed, never run | binary present, `~/.local/share/easyeffects/` absent | Sync the presets, creating the tree. Actions wait for the socket. |
| Installed, not running | preset directory present, socket absent | Presets sync and list. The bar offers to start it. |
| Running | socket connects | Everything works. |
| Running, tuning installed | `omarchy audio tuning status` says installed | Everything works, and the panel names the conflict. |

**Nothing is written until EasyEffects is installed.** With the binary absent,
`~/.local/share/easyeffects/` does not exist, and the plugin does not create
it. Writing 136 KB of presets for an application someone does not have is
litter, and a ledger claiming ten presets are installed for an application that
has never read them is a lie the next sync would have to unpick. The gate for
syncing is the binary existing; the gate for the socket actions is the socket
connecting. Those are separate, which is what makes the "installed but never
run" rung work: the presets are in place before EasyEffects first starts, and
it finds them on its first scan.

**Detection costs one spawn, not a poll.** `command -v easyeffects` runs when
the service starts, when the panel opens, and when `EasyEffectsServer` appears
in `$XDG_RUNTIME_DIR` — a `FileView` on the runtime directory, which is how
"EasyEffects just started" arrives without anything asking repeatedly. Deciding
compatibility by reading the preset directory rather than parsing
`easyeffects --version` means the check is about the layout the plugin actually
depends on, and cannot be wrong about a version string.

### The install offer, and standing down

Omarchy already has the right primitive, and it is the one the plugin uses:

```
omarchy-install-and-launch "EasyEffects" easyeffects com.github.wwmm.easyeffects
```

That opens a floating terminal with Omarchy's presentation wrapper, runs
`omarchy-pkg-add easyeffects`, and launches EasyEffects when it finishes.
`easyeffects` is in Arch's `extra` repository, so there is no AUR path and no
build.

The important property is what the plugin does *not* do: it never runs `sudo`,
never runs `pacman`, and never asks for a password inside a bar popup. A shell
popup is the wrong place to type a root password and a plugin that asked for
one would be teaching a bad habit. The privilege escalation happens in a
visible terminal owned by Omarchy's own installer, where it belongs. The wiring
test asserts the plugin's code contains no `sudo`, `pkexec`, or `pacman`
invocation of its own — checkable in the source, unlike a promise in prose.

The offer is made **once**. A "Not now" is recorded in
`~/.config/omarchy/easyeffects/installed.json` and the widget hides itself from
then on. It comes back on its own the moment `easyeffects` appears on PATH,
whether this plugin put it there or not. Offering forever is nagging; offering
never is a widget that looks broken; offering once and then getting out of the
way is the only version of this that respects someone who tried it and decided
against it.

### Where the presets go when it arrives

Sync fires on the transition, not on a timer. The moment the binary is
detected — at the end of an install the plugin offered, or at any later start
because the user installed it themselves — the ledger runs its five verdicts
and the ten presets land. Someone who installs EasyEffects a month later opens
it to a full preset list and no memory of this plugin having waited.

### The conflict nobody else will mention

Omarchy ships its own speaker tuning for matching hardware, and `omarchy audio
tuning on` refuses to run while EasyEffects is up, in its own words:

> EasyEffects is running. It moves any stream that follows the default sink to
> its own sink, so a tuning installed now would be bypassed.

The reverse is equally true and nothing currently says it: with a tuning
installed, both it and EasyEffects insert a virtual sink in front of the
speakers, and whichever loses the default sink is doing nothing audible. Only
`dell-xps-2026` ships a tuning today, and this machine matches nothing, so the
state is rare — and silent, and indistinguishable from "EasyEffects stopped
working" for whoever hits it.

So when `omarchy audio tuning status` reports a tuning installed, the panel
says which of the two is actually in the path and names the command that
resolves it. The plugin does not resolve it. Choosing between a hardware
speaker tuning and a user's EQ chain is a system decision with an Omarchy
command of its own, and a bar widget quietly disabling either one would be
overreach.

Nothing else is needed here: the shell's built-in audio panel already resolves
volume through a DSP sink to the physical device, so the volume slider stays
correct with EasyEffects in the chain.

## The bar widget

Icon, plus an optional label. The label holds a fixed width like Siphon's, so a
preset name changing length does not shove the widgets beside it along.

| State | Icon |
| --- | --- |
| Running, preset active | normal |
| Running, global bypass on | struck through |
| Not running | dimmed; click starts `easyeffects --service-mode --hide-window` |
| Not installed, never offered | dimmed with a dot; the panel offers to install it |
| Not installed, offer declined | hidden until EasyEffects appears |
| Installed, Flatpak only | dimmed; the panel says which build is supported |

`hideWhenUnavailable` collapses every row below the second to nothing.

## Failure modes, and what is said about each

| What happened | What the panel says |
| --- | --- |
| `easyeffects` not on PATH | "EasyEffects is not installed." and one install button, offered once. Nothing is written to disk. |
| Only the Flatpak is present | "This drives the `easyeffects` package; you have the Flatpak." Nothing else is claimed, because nothing else was tested. |
| Socket absent, binary present | "EasyEffects is not running." and a button to start it. Presets still sync and list. |
| A speaker tuning is installed too | Names which of the two is in the audio path and the `omarchy audio tuning` command that settles it. Changes nothing by itself. |
| Socket write refused | The action's row reports it. No retry loop. |
| Preset name over 100 characters | Falls back to `easyeffects -l`, silently — it works. |
| A bundled name is taken | "You already have a preset called this. Yours is untouched." |
| A bundled preset was edited | "Edited by you. Not overwritten." with a re-install action. |
| An IR is missing | "Needs `<kernel name>`, which is not in your irs folder." The preset stays listed and applies; the panel does not pretend the convolver is doing anything. |
| The ledger is corrupt | Treated as absent: every bundled name becomes `skipped`, nothing is overwritten, and a line says the ledger was rebuilt. Failing closed here costs a manual re-install; failing open costs someone's presets. |

## Tests

Mirroring the sibling plugins, and run by `.github/workflows/tests.yml` with no
compositor.

`test/model.test.js` — parsing `easyeffectsrc`, parsing socket replies, the
bypass encoding conversion in both directions, bar label width, device list
filtering.

`test/presets.test.js` — the one that keeps the shipped set honest. Every file
in `presets/output/` is valid JSON with an `output` key; every `kernel-name`
any preset references resolves to a file in `presets/irs/`; every preset's
`output.blocklist` is empty; every preset has a description and every
description names a shipped preset; no preset contains an absolute path, a home
directory, a hostname, or a MAC address; the count in the README matches the
count on disk.

`test/wiring.test.js` — QML parses; every manifest setting is read by code and
every setting read by code is in the manifest; entry points exist; the panel
asks the shell for the service and declares no `Service {}` of its own; the
manifest id matches `moduleName`; and no `sudo`, `pkexec`, or `pacman` appears
in any file the shell loads. That last one is the check that keeps the install
offer honest — escalation belongs to `omarchy-install-and-launch`, in a visible
terminal, and a scan of the source proves it in a way a sentence in the README
cannot.

`test/prove-checks.sh` — breaks each invariant one at a time in a scratch copy
and fails if the suite does not catch it. A check nobody has watched fail is a
check nobody knows works. At minimum: a preset referencing an IR that was not
shipped, a ledger verdict table that overwrites on `yours`, an inverted bypass
conversion, a `Service {}` declared in the panel, a manifest setting no code
reads, a sync that writes presets while the binary is absent, a declined
install offer that asks a second time, and a preset reintroduced with a
personal blocklist.

## Confirm before writing code

Three things are unknown, and all are cheap to settle.

**The autoload filename.** Bind one preset to one device in the EasyEffects
GUI, then read what appeared in `~/.local/share/easyeffects/autoload/output/`.
That single file answers the filename convention, the escaping of a device name
containing dots and colons, and what goes in `device-profile` for a Bluetooth
sink versus an ALSA one. Do this first; the Devices section depends on it.

**Whether the preset directory watcher fires on our writes.** Drop a file into
`~/.local/share/easyeffects/output/` while EasyEffects is running and check
`easyeffects -p`. If the list does not refresh, sync needs to nudge EasyEffects
after writing, and the panel needs to say so rather than showing a preset that
cannot yet be loaded.

**Whether `easyeffects -p` answers with no instance running.** If it needs the
running server, it is useless as an installed-and-compatible probe and the
directory read stands alone — which is the design above, so this only confirms
a fallback rather than changing anything.

All three want the same environment, which is the point below.

## Test it as somebody who is not you

Every measurement in this document was taken on a machine with ten presets,
twenty-five impulse responses, a tuned `easyeffectsrc`, and EasyEffects already
running. That is the one configuration where none of the interesting failures
happen.

The requirement is "presets anyone can use", and *anyone* has an empty
`~/.local/share/easyeffects/`, no `easyeffectsrc`, possibly no `easyeffects`
binary at all, and has never heard of a convolver kernel. Every rung of the
readiness ladder, the first sync, the install offer and its one-time refusal,
and the whole "installed but never run" path exist only there and are untested
by anything done here.

So: a scratch user account on this machine, or an Arch container. It costs
minutes, it settles all three unknowns above without stopping a running
EasyEffects mid-listen, and it is the only place the shipped presets can be
seen the way a stranger sees them.

A CI job on an Arch container with the current `easyeffects` package, loading
each shipped preset and checking it comes back without error, is the same idea
made repeatable. It is also the only thing that would catch EasyEffects
changing its preset schema in a future release — a drift that no test in this
repo can see on its own, because the repo has no opinion about what EasyEffects
will accept next year.

## Removing the plugin

`omarchy plugin remove` deletes the plugin directory, and there is no hook to
run on the way out. The ten presets stay in `~/.local/share/easyeffects/`, and
that is deliberate — they are the user's presets now, and an uninstall that
deleted audio configuration someone had been using for a year would be a worse
surprise than a few files left behind. The panel's per-preset removal is the
place to undo it, on purpose, one at a time.

The ledger lives at `~/.config/omarchy/easyeffects/`, outside the plugin
directory, so it survives removal and a later re-install resumes where it left
off rather than re-deciding ten verdicts against files it has forgotten
writing.

## Not in v1

Editing effect parameters. The socket's `set_property` makes it possible, and a
bar popup is the wrong place to tune a multiband compressor — EasyEffects
already has a good window for that, and this plugin's job is to get to it
faster, not to replace it.

Per-application blocklisting, the `blocklist` key in `easyeffectsrc`. Real, and
a separate feature with its own UI.

Community preset packages. Blocked on root-owned directories, as above.
