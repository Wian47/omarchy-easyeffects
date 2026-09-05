# Where these impulse responses came from

Two files:

| File | Format | Size |
| --- | --- | --- |
| `Razor Surround ((48k Z-Edition)) 2.Stereo +20 bass.irs` | 48 kHz stereo, 32-bit float WAV | 71,372 B |
| `Razor Surround ((48k Z-Edition)) 2.Stereo +20 bass Low Latency.irs` | 48 kHz stereo, 32-bit PCM WAV | 24,044 B |

Three of the bundled presets name them in a convolution stage: **Bass Enhancing
+ Perfect EQ**, **Bass Enhancing + Perfect EQ - Low Latency** and **Bass
Boosted**. Without the files those presets load with a silent convolver, which
is why they are shipped rather than left for you to find.

## What I know, and what I do not

I do not know who made them. They came off my own machine, where they had been
sitting in `~/.local/share/easyeffects/irs/` long enough that I no longer
remember where I downloaded them. The name points at the sort of "Razor
Surround" impulse response that circulates on audio forums and in preset packs,
usually with no author and no licence attached.

So: **these two files are redistributed here without a known licence.** That is
a statement of fact, not a claim of permission.

If you made them, or you know who did, open an issue and I will credit them, or
remove the files and point the presets at something I can name. If you would
rather not have unlicensed binaries in your tree at all, delete this directory
before installing; the seven presets that do not use convolution are unaffected,
and the three that do will still load, just without their convolution stage.

## Making the same presets without these files

Both are convolution kernels for the LSP `sc_convolver` plugin. Any stereo
48 kHz impulse response will substitute. Drop yours into
`~/.local/share/easyeffects/irs/`, open the preset's Convolver stage in
EasyEffects and pick it. The low-latency file is the same idea truncated, which
is the entire reason that variant exists.
