# omarchy-easyeffects

An [Omarchy](https://omarchy.org) bar plugin for
[EasyEffects](https://github.com/wwmm/easyeffects): one icon that shows what
your audio is running through, and one click to change it. It ships with ten
presets, so there is something to switch to on the first run.

## Install

```sh
omarchy plugin add https://github.com/Wian47/omarchy-easyeffects.git --enable
```

That clones it into `~/.config/omarchy/plugins/wian47.easyeffects`, asks where on
the bar you want it, and reloads the shell. To do it by hand instead, clone to
that path yourself and run `omarchy restart shell`.

You do not need EasyEffects installed first. If it is missing the icon dims and
the popup offers to install it, which hands off to `omarchy-install-and-launch`
so the password prompt happens in a visible terminal rather than in a bar popup.
Nothing in this plugin runs as root; there is a test that fails if `sudo`,
`pkexec`, `doas` or `pacman` ever appears in a file the shell loads.

## What the icon does

| Action | Result |
| --- | --- |
| Click | Open the preset list |
| Middle-click | Toggle global bypass without opening anything |
| `j` / `k` or arrows | Move through the list |
| `Enter` | Load the highlighted preset |
| `Esc` | Close |

The popup header carries the same bypass as a switch, next to the name of
whatever is currently loaded.

The icon itself reports state without being opened: equaliser glyph when a
preset is loaded, a crossed circle when bypass is on, a stop sign when
EasyEffects is installed but not running, a download arrow when it is not
installed at all.

Under the presets, **Load automatically** binds a preset to a device. Click the
device and it will load whatever preset is playing now, every time you switch
back to it. Click again to unbind. It lists the device you are using plus every
device you have already bound, which is two or three rows rather than the
eleven sinks and sources a machine typically has.

This writes into EasyEffects' own autoload directory, so the rules show up in
its Autoload tab and it is EasyEffects, not this plugin, that loads them.

The popup lists **output presets** and **input presets** separately, yours
alongside the bundled ones, ordered by how often you have used them. The
highlighted row explains itself in a fixed line above the list, so the list
never reflows under your pointer. A row with a missing impulse response says so
instead of loading silently broken.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| Text beside the icon | none | Add the active preset name or the output device. Vertical bars stay icon-only regardless. |
| Keep the bundled presets installed | on | Copy the ten presets in and keep them current. |
| Hide when EasyEffects is unavailable | off | Leave the bar alone instead of showing a dimmed icon. |

## The presets

They install to `~/.local/share/easyeffects/output/`, with their impulse
responses in `~/.local/share/easyeffects/irs/`. Four families:

**The Perfect EQ line** — a mild ten-band correction, and three presets built
on top of that exact curve.

| Preset | For |
| --- | --- |
| Perfect EQ | The one to try first. |
| Bass Enhancing + Perfect EQ | Music, where processing delay does not matter. |
| Bass Enhancing + Perfect EQ - Low Latency | Games, calls, video. A fraction of the delay. |
| Bass Boosted | Earbuds and small speakers with no bass of their own. |

**Louder, evenly**

| Preset | For |
| --- | --- |
| Boosted | A quiet recording that needs more at both ends. No limiter after it — drop the volume before switching on headphones. |
| Advanced Auto Gain | A playlist mastered at wildly different levels. |
| Loudness+Autogain | Listening quietly, keeping bass and treble audible. |

**Built for one kind of speaker**

| Preset | For |
| --- | --- |
| Laptop | Small laptop drivers. Lifts detail, holds down the buzz. |
| Speaker Sync | Crossfeed for headphones. The name is wrong: its delay stage is zero, so it time-aligns nothing. |

**An effect, not a correction**

| Preset | For |
| --- | --- |
| Dolby Atmos | Wide and spacious. Not accurate, and nothing to do with Dolby. |

The two impulse responses in `presets/irs/` are redistributed without a known
licence. See [presets/irs/PROVENANCE.md](presets/irs/PROVENANCE.md) before you
depend on them.

## How it decides not to overwrite your work

Sync keeps a ledger at `~/.config/omarchy/easyeffects/installed.json` recording
the hash of every preset it wrote. Each run compares three hashes — bundled,
on-disk, and last-written — and picks one of five verdicts:

| Verdict | When | It writes |
| --- | --- | --- |
| install | No file with that name | yes |
| current | Already byte-identical | no |
| update | Matches what we last wrote, and we have a newer one | yes |
| yours | We wrote it, you changed it | **no** — shown as *edited by you* |
| skipped | A file with that name we never wrote | **no** — shown as *name taken* |

Presence alone cannot tell a file we wrote from a file that merely shares a
name, which is the whole reason the ledger exists. A second run with nothing
changed writes zero files.

Impulse responses are only ever written if absent; an `.irs` you put there
yourself is never touched.

## Not in this version

Stated plainly, because these were scoped and are not done:

- **No bundled input presets.** Input presets are listed and switchable; the
  ten shipped ones are all output.
- **No conflict warning** when Omarchy's own speaker tuning is active.
- **No per-preset removal**, and no "re-check bundled presets" button. Deleting
  a preset means deleting the file and the ledger entry.
- **Autoload has no fallback preset.** EasyEffects can load one preset for every
  device you have not named. That is a setting in its own window, not here.
- **The popup does not scroll.** Enough presets and the list runs past the
  bottom of the card.
- **Flatpak EasyEffects is unsupported.** It keeps its presets and socket
  somewhere else and none of that has been tested. The popup says so rather
  than half-working.

## Development

```sh
node test/presets.test.js   # the shipped presets carry nothing personal
node test/model.test.js     # the parsing and presentation rules hold
node test/wiring.test.js    # the files agree with each other (needs qmlformat)
bash test/prove-checks.sh   # every check above catches the break it exists for
```

That last one matters most: a check nobody has watched fail is a check nobody
knows works, so it breaks each invariant in a scratch copy and expects the
suite to notice.

The only supported way to add a preset is `tools/import-presets.js`. It copies
bytes verbatim rather than re-serialising — `JSON.stringify` writes `4` where
EasyEffects writes `4.0` — and it empties the per-application blocklist, which
is how a preset from a real machine would otherwise ship a rule excluding
somebody's music player.

```sh
node tools/import-presets.js --from ~/.local/share/easyeffects/output
node tools/import-presets.js --check
```

[SPEC.md](SPEC.md) has the design, the EasyEffects socket grammar as measured
rather than assumed, and the failure modes. Some of its socket sections are
superseded: the socket turned out to frame its replies inconsistently, so this
plugin only ever writes to it and reads state through `easyeffects -a` and
`easyeffects -b 3` instead.

## Licence

[MIT](LICENSE) for the code, the QML, the tests and the ten preset files.

The MIT grant does **not** extend to the two `.irs` files in `presets/irs/`.
I did not make them and cannot say who did, so I am in no position to license
them to you. They are redistributed here as-is; see
[presets/irs/PROVENANCE.md](presets/irs/PROVENANCE.md) for what that means for
you and how to replace them.
