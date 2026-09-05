import QtQuick
import Quickshell
import Quickshell.Io
import "Model.js" as Model
import "Presets.js" as Presets

// Everything that talks to EasyEffects: the socket presets are switched over,
// the config file that says which one is loaded, and the copying that puts the
// bundled presets where EasyEffects will find them.
//
// The socket is written to and never read from. Its replies carry no framing of
// their own, so two answers on one connection arrive run together with nothing
// between them. Nothing is lost: the commands worth sending return no reply at
// all, and everything worth reading is either in easyeffectsrc, which is
// watched, or comes back properly framed from `easyeffects -b 3`.
//
// Nothing here runs as root. Installing EasyEffects is handed to Omarchy's own
// installer, which does it in a terminal the user can see.
Item {
  id: root

  property var settings: ({})

  readonly property string home: Quickshell.env("HOME") || ""
  readonly property string dataDir: home + "/.local/share/easyeffects"
  readonly property string configPath: home + "/.config/easyeffects/db/easyeffectsrc"
  readonly property string ledgerPath: home + "/.config/omarchy/easyeffects/installed.json"
  readonly property string pluginDir: String(Qt.resolvedUrl(".")).replace(/^file:\/\//, "").replace(/\/$/, "")

  property string runtimeDir: ""
  readonly property string socketPath: runtimeDir === "" ? "" : runtimeDir + "/EasyEffectsServer"

  property bool binaryPresent: false
  property bool flatpakPresent: false
  property bool presetDirPresent: false
  property bool socketFilePresent: false
  property var outputNames: []
  property var inputNames: []
  property var kernelsByPreset: ({})
  property var availableKernels: []
  property var devices: []
  property var rules: ({ output: {}, input: {} })

  property var ini: ({})
  property bool bypassed: false
  property bool probed: false
  property string lastError: ""

  // What the last sync decided about each bundled preset, so a name that was
  // skipped or edited can say so instead of looking installed.
  property var verdicts: ({})
  property bool syncing: false

  // Counts down the looks taken after asking EasyEffects to start, so a start
  // that never arrives stops being waited for.
  property int startLooks: 0

  // The panel sets this while it is open. The bypass is the one piece of state
  // EasyEffects will not announce, so it is asked for only while somebody is
  // looking at it.
  property bool watchClosely: false

  readonly property string readiness: Model.readiness({
    binary: binaryPresent,
    flatpak: flatpakPresent,
    presetDir: presetDirPresent,
    socket: socket.connected
  })
  readonly property var readinessInfo: Model.readinessState(readiness)
  readonly property bool loaded: probed

  onReadinessChanged: if (readiness === "running") root.startLooks = 0

  // Three sources, in falling order of trust. What was just asked for, because
  // nothing is faster than knowing. What the running instance says, asked over
  // the command line. What the config file says, which is a lazy write and can
  // name a preset that was replaced minutes ago, so it is only a starting guess
  // before the first reading comes back.
  property string chosenOutput: ""
  property string chosenInput: ""
  property string readOutput: ""
  property string readInput: ""

  readonly property string filedOutput: Model.activePreset(ini, "output")
  readonly property string filedInput: Model.activePreset(ini, "input")

  readonly property string activePreset: chosenOutput !== "" ? chosenOutput
    : (readOutput !== "" ? readOutput : filedOutput)
  readonly property string activeInputPreset: chosenInput !== "" ? chosenInput
    : (readInput !== "" ? readInput : filedInput)
  readonly property string device: Model.currentDevice(ini, "output")
  readonly property string inputDevice: Model.currentDevice(ini, "input")
  readonly property string deviceLabel: device === "" ? "" : Model.deviceLabel(device)

  // Input devices only earn a row once there is an input preset to bind to
  // them. Until then it is a control whose only setting is the empty one.
  readonly property var autoloadRows: Model.autoloadRows({
    devices: devices,
    rules: rules,
    currentOutput: device,
    currentInput: inputDevice,
    pipelines: inputPresets.length > 0 ? ["output", "input"] : ["output"]
  })

  readonly property var presets: Model.presetRows({
    names: outputNames,
    catalogue: Presets.CATALOGUE,
    active: activePreset,
    usage: Model.usageCounts(ini, "output"),
    kernelsByPreset: kernelsByPreset,
    availableKernels: availableKernels
  })

  readonly property var inputPresets: Model.presetRows({
    names: inputNames,
    catalogue: {},
    active: activeInputPreset,
    usage: Model.usageCounts(ini, "input"),
    kernelsByPreset: kernelsByPreset,
    availableKernels: availableKernels
  })

  readonly property var view: ({
    readiness: readiness,
    preset: activePreset,
    deviceLabel: deviceLabel,
    bypassed: bypassed
  })

  // The offer to install is made once. A refusal is remembered so the widget
  // stops asking, and it comes back on its own the moment easyeffects appears.
  readonly property bool installDeclined: ledger.declinedInstall

  function refresh() {
    probeProcess.command = Model.probeCommand(root.dataDir)
    probeProcess.running = true
  }

  // Run after every probe, so a socket that was not there last time is tried
  // again. Connecting is what decides whether EasyEffects is running, because
  // the file it listens on outlives a crash; one was measured sitting in
  // /run/user with nothing behind it.
  function syncSocket() {
    var wanted = root.socketFilePresent && root.socketPath !== ""
    if (wanted !== socket.connected) socket.connected = wanted
  }

  function applyPreset(pipeline, name) {
    if (pipeline === "input") root.chosenInput = name
    else root.chosenOutput = name
    confirmActive.restart()
    var command = Model.loadPresetCommand(pipeline, name)
    if (command === "") {
      // Only a name past the socket's hundred characters lands here.
      cliProcess.command = ["easyeffects", "-l", name]
      cliProcess.running = true
      return
    }
    send(command)
  }

  function setBypass(wanted) {
    send(Model.bypassCommand(wanted))
    root.bypassed = wanted
    readBypass()
  }

  function toggleBypass() {
    setBypass(!root.bypassed)
  }

  function send(line) {
    if (!socket.connected) {
      root.lastError = "EasyEffects is not accepting commands"
      return
    }
    socket.write(line + "\n")
    socket.flush()
  }

  function readActive() {
    if (!root.readinessInfo.canAct) return
    activeProcess.command = Model.activePresetCommand()
    activeProcess.running = true
  }

  function readBypass() {
    if (!root.readinessInfo.canAct) return
    bypassProcess.command = Model.bypassReadCommand()
    bypassProcess.running = true
  }

  // Detached on purpose. Quickshell kills the processes it owns when it goes
  // away, so an EasyEffects started as a child of the bar dies the next time
  // the shell reloads. `setsid --fork` also returns immediately, which turns
  // the exit of this command into "the launch happened" rather than "the
  // daemon stopped", and that is what starts looking for the socket.
  function start() {
    root.startLooks = 12
    startProcess.command = [
      "sh", "-c", "setsid --fork easyeffects --service-mode --hide-window >/dev/null 2>&1"
    ]
    startProcess.running = true
  }

  // Autoload is EasyEffects' own feature and this only writes the files it
  // already looks for. It reads the route's description out of them, not the
  // route's name, so the file has to be named after "Headphones" and not
  // "headset-output". A file under the wrong name is never found and nothing
  // anywhere says so, which is why the name is computed in one place.
  function setAutoload(pipeline, device, description, route, preset) {
    if (!root.readinessInfo.canSync || device === "" || preset === "") return
    autoloadProcess.command = Model.autoloadWriteCommand(
      root.dataDir, pipeline, Model.autoloadFileName(device, route),
      Model.autoloadBody(device, description, route, preset))
    autoloadProcess.running = true
  }

  function removeAutoload(pipeline, fileName) {
    if (!root.readinessInfo.canSync || fileName === "") return
    autoloadProcess.command = Model.autoloadRemoveCommand(root.dataDir, pipeline, fileName)
    autoloadProcess.running = true
  }

  // Escalation belongs to Omarchy's installer, in a terminal the user can see.
  // This plugin never runs a package manager and never asks for a password.
  function install() {
    installProcess.command = [
      "omarchy-install-and-launch", "EasyEffects", "easyeffects", "com.github.wwmm.easyeffects"
    ]
    installProcess.running = true
  }

  function declineInstall() {
    ledger.declinedInstall = true
    ledgerFile.writeAdapter()
  }

  // Sync is gated on the binary existing, never on it running. With EasyEffects
  // absent its data directory does not exist either, and creating one to hold
  // presets for an application nobody has is litter that a later sync would
  // have to reason about.
  function sync() {
    if (root.syncing || !root.readinessInfo.canSync || settings.syncPresets === false) return
    root.syncing = true
    hashProcess.command = Model.hashCommand(root.pluginDir, root.dataDir)
    hashProcess.running = true
  }

  function onHashes(text) {
    var seen = Model.parseHashes(text)
    var plan = Presets.syncPlan(seen.bundled, seen.disk, ledger.presets || ({}))
    root.verdicts = plan.verdicts
    if (plan.write.length === 0) {
      root.syncing = false
      return
    }
    root.pendingWrite = plan.write
    root.pendingHashes = seen.bundled
    copyProcess.command = Model.copyCommand(root.pluginDir, root.dataDir, plan.write)
    copyProcess.running = true
  }

  property var pendingWrite: []
  property var pendingHashes: ({})

  function onCopied(exitCode) {
    root.syncing = false
    if (exitCode !== 0) {
      root.lastError = "the bundled presets could not be written"
      return
    }
    var recorded = ledger.presets || ({})
    for (var i = 0; i < root.pendingWrite.length; i++) {
      var name = root.pendingWrite[i]
      recorded[name] = root.pendingHashes[name]
    }
    ledger.presets = recorded
    ledgerFile.writeAdapter()
    root.pendingWrite = []
    root.refresh()
  }

  function onProbed(text) {
    var seen = Model.parseProbe(text)
    root.runtimeDir = seen.runtimeDir
    root.binaryPresent = seen.binary
    root.flatpakPresent = seen.flatpak
    root.presetDirPresent = seen.presetDir
    root.socketFilePresent = seen.socketFile
    root.syncSocket()
    root.outputNames = seen.output
    root.inputNames = seen.input
    root.kernelsByPreset = seen.kernels
    root.availableKernels = seen.irs
    root.devices = seen.devices
    root.rules = seen.rules
    root.probed = true
    root.sync()
  }

  Component.onCompleted: refresh()

  // `connected` is driven, never bound. A binding here looks right and is the
  // bug that made the start button useless: Quickshell writes `connected` back
  // to false when a connect fails, which destroys the binding, and nothing ever
  // asks again. EasyEffects starting afterwards could not be noticed. Measured
  // on a Socket bound to a constant true: the peer appeared and `connected`
  // stayed false for the rest of the run.
  Socket {
    id: socket
    path: root.socketPath
  }

  // EasyEffects writes the loaded preset and the current device here, so the
  // panel follows a change made in its own window without being told.
  FileView {
    id: configFile
    path: root.configPath
    printErrors: false
    watchChanges: true
    onLoaded: root.ini = Model.parseIni(text())
    onFileChanged: {
      reload()
      root.readActive()
    }
  }

  FileView {
    id: ledgerFile
    path: root.ledgerPath
    printErrors: false
    atomicWrites: true
    onLoaded: root.sync()

    JsonAdapter {
      id: ledger
      property var presets: ({})
      property bool declinedInstall: false
    }
  }

  Process {
    id: ledgerDirProcess
    running: true
    command: ["sh", "-c", 'mkdir -p "$HOME/.config/omarchy/easyeffects"']
    onExited: ledgerFile.reload()
  }

  Process {
    id: probeProcess
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.onProbed(text)
    }
    onExited: function (exitCode) {
      if (exitCode !== 0) root.lastError = "EasyEffects could not be looked for"
    }
  }

  Process {
    id: hashProcess
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.onHashes(text)
    }
    onExited: function (exitCode) {
      if (exitCode !== 0) {
        root.syncing = false
        root.lastError = "the bundled presets could not be read"
      }
    }
  }

  Process {
    id: copyProcess
    onExited: function (exitCode) {
      root.onCopied(exitCode)
    }
  }

  Process {
    id: activeProcess
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var seen = Model.parseActivePresets(text)
        root.readOutput = seen.output
        root.readInput = seen.input
        if (root.chosenOutput === seen.output) root.chosenOutput = ""
        if (root.chosenInput === seen.input) root.chosenInput = ""
      }
    }
  }

  // EasyEffects takes a moment to swap a chain, so the reading that retires an
  // optimistic name is taken shortly after asking rather than immediately.
  Timer {
    id: confirmActive
    interval: 600
    onTriggered: root.readActive()
  }

  Process {
    id: bypassProcess
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var reading = Model.bypassFromReply(text)
        if (reading !== null) root.bypassed = reading
      }
    }
  }

  Process {
    id: startProcess
    onExited: root.refresh()
  }

  // EasyEffects takes a second or two to open its socket, and the panel is
  // open and being looked at while it does. This closes that gap rather than
  // leaving the button looking dead until the four second poll comes round.
  Timer {
    running: root.startLooks > 0 && root.readiness !== "running"
    interval: 500
    repeat: true
    onTriggered: {
      root.startLooks -= 1
      root.refresh()
    }
  }

  Process {
    id: cliProcess
  }

  Process {
    id: autoloadProcess
    onExited: function (exitCode) {
      if (exitCode !== 0) root.lastError = "the autoload rule could not be written"
      root.refresh()
    }
  }

  Process {
    id: installProcess
  }

  // The socket appearing is how "EasyEffects has just started" arrives without
  // anything asking repeatedly. A binary appearing on PATH does not announce
  // itself, so a panel being opened is the other moment worth looking again.
  Timer {
    running: root.watchClosely
    interval: 4000
    repeat: true
    onTriggered: {
      root.refresh()
      root.readBypass()
      root.readActive()
    }
  }
}
