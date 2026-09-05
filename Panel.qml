import QtQuick
import Quickshell
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Bar icon plus a popup listing the presets EasyEffects can see, the bundled
// ones and the user's own in one list because EasyEffects has one namespace and
// showing two would be a fiction.
//
// A row is one line. The descriptions exist for somebody who did not make these
// presets, but ten of them on screen at once is a wall of prose nobody reads,
// so a row says what it is only while the cursor is on it.
//
// Every label sets an explicit width and elides. A Text that sizes itself is
// what puts content outside the popup surface, drawn over whatever is behind
// the bar.
Panel {
  id: root

  moduleName: "wian47.easyeffects"
  ipcTarget: "easyeffects"
  manageIpc: true

  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property color urgent: bar ? bar.urgent : Color.urgent
  readonly property color dim: Qt.darker(foreground, 1.55)
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property bool vertical: bar ? bar.vertical : false

  // The shell loads a plugin's "service" entry point once and hands the same
  // instance to every widget that asks. The bar builds this panel per monitor,
  // and two of them syncing presets would race over the same files, so the
  // single instance comes from the shell rather than a `Service {}` here.
  readonly property var ee: bar && bar.shell ? bar.shell.serviceFor("wian47.easyeffects") : null

  readonly property string readiness: ee ? ee.readiness : "absent"
  readonly property var eeState: Model.readinessState(readiness)
  readonly property var presets: ee ? ee.presets : []
  readonly property var inputPresets: ee ? ee.inputPresets : []
  readonly property var verdicts: ee ? ee.verdicts : ({})
  // Autoload writes into EasyEffects' own directory, so the same gate that
  // stops presets being copied for an application nobody has stops this too.
  readonly property var devices: ee && eeState.canSync ? ee.autoloadRows : []
  readonly property string serviceError: ee ? ee.lastError : ""

  readonly property var view: ee ? ee.view : ({ readiness: "absent", preset: "", deviceLabel: "", bypassed: false })
  readonly property string labelMode: vertical ? "none" : String(setting("barLabel", "none"))
  readonly property string barLabel: Model.barLabel(view, labelMode)
  readonly property string barTooltip: Model.barTooltip(view)

  readonly property bool hideWhenUnavailable: setting("hideWhenUnavailable", false) === true
  readonly property bool available: readiness === "running" || readiness === "stopped" || readiness === "never-run"

  // A widget that vanishes the moment it is enabled looks broken, so an absent
  // EasyEffects still shows an icon and offers to fix itself. It stands down
  // once, when the offer has been refused, and returns on its own if
  // easyeffects ever appears.
  visible: available || (!hideWhenUnavailable && !(readiness === "absent" && ee && ee.installDeclined))
  implicitWidth: button.item ? button.item.implicitWidth : 0
  implicitHeight: button.item ? button.item.implicitHeight : (bar ? bar.barSize : Style.bar.sizeHorizontal)

  onVisibleChanged: if (!visible && opened) close()
  onEeChanged: if (ee) ee.settings = root.settings
  onOpenedChanged: {
    if (!ee) return
    ee.watchClosely = opened
    if (opened) {
      ee.refresh()
      ee.readBypass()
      ee.readActive()
      return
    }
    // Cleared on the way out, not on the way in. A panel opened under a
    // stationary pointer has already had its enter event by this point, and
    // clearing here would leave nothing highlighted until the mouse moved.
    root.cursorActive = false
    root.selectedIndex = -1
  }

  // One cursor, shared by the mouse and the keyboard. CursorSurface is explicit
  // that a row must not colour itself from its own containsMouse: the highlight
  // is owned here so exactly one row carries it, however it was reached. Rows
  // never clear it on leave either, which is what stops the entered row's
  // highlight being wiped by the left row's event arriving second.
  property bool cursorActive: false
  property string focusSection: "output"
  property int selectedIndex: -1

  readonly property var navigable: {
    var out = []
    for (var i = 0; i < presets.length; i++) out.push({ section: "output", index: i })
    for (var j = 0; j < inputPresets.length; j++) out.push({ section: "input", index: j })
    for (var k = 0; k < devices.length; k++) out.push({ section: "devices", index: k })
    return out
  }

  function rowsIn(section) {
    if (section === "input") return inputPresets
    if (section === "devices") return devices
    return presets
  }

  readonly property var selectedRow: {
    var rows = rowsIn(focusSection)
    if (!cursorActive || selectedIndex < 0 || selectedIndex >= rows.length) return null
    return rows[selectedIndex]
  }

  // The description belongs to one fixed strip rather than to the rows. A row
  // that grows to hold it pushes every row below it down, so the list moves
  // under the pointer and what was aimed at has gone by the time it is clicked.
  readonly property string describedText: {
    if (selectedRow) return focusSection === "devices" ? deviceCaptionFor(selectedRow) : captionFor(selectedRow)
    for (var i = 0; i < presets.length; i++) {
      if (presets[i].name === view.preset) return captionFor(presets[i])
    }
    return ""
  }

  function placeCursor(section, index) {
    cursorActive = true
    focusSection = section
    selectedIndex = index
  }

  function moveCursor(step) {
    if (navigable.length === 0 || step === 0) return
    if (!cursorActive) {
      placeCursor(navigable[0].section, navigable[0].index)
      return
    }
    var at = -1
    for (var i = 0; i < navigable.length; i++) {
      if (navigable[i].section === focusSection && navigable[i].index === selectedIndex) at = i
    }
    var next = Math.max(0, Math.min(navigable.length - 1, (at < 0 ? 0 : at) + step))
    placeCursor(navigable[next].section, navigable[next].index)
  }

  function activateCursor() {
    if (!selectedRow || !ee) return
    if (focusSection === "devices") { toggleAutoload(selectedRow); return }
    if (!eeState.canAct) return
    ee.applyPreset(focusSection, selectedRow.name)
  }

  // One click, two outcomes, and never a third. A bound device unbinds, an
  // unbound one takes whatever is playing now. Changing which preset a device
  // loads is unbind then bind, which is two clicks and no hidden state, rather
  // than a control whose meaning depends on what it is already set to.
  function toggleAutoload(row) {
    if (!ee) return
    if (row.bound) { ee.removeAutoload(row.pipeline, row.fileName); return }
    if (!row.live) return
    ee.setAutoload(row.pipeline, row.device, row.description, row.route, presetFor(row.pipeline))
  }

  function presetFor(pipeline) {
    return pipeline === "input" ? (ee ? ee.activeInputPreset : "") : (ee ? ee.activePreset : "")
  }

  function deviceCaptionFor(row) {
    if (row.bound && !row.live) return "Loads " + row.preset + ". Not connected right now. Click to remove."
    if (row.bound) return "Loads " + row.preset + " whenever this device is in use. Click to remove."
    var preset = presetFor(row.pipeline)
    if (preset === "") return "Load a preset first, then this device can remember it."
    return "Click to load " + preset + " automatically whenever this device is in use."
  }

  function handleBarPress(buttonCode) {
    if (buttonCode === Qt.MiddleButton && ee && eeState.canAct) ee.toggleBypass()
    else root.toggle()
  }

  // Short enough to sit at the end of a row. The reason behind it goes in the
  // description line, which only the hovered row shows.
  function statusFor(entry) {
    if (entry.missingKernels.length > 0) return "no impulse response"
    if (!entry.bundled) return ""
    var verdict = verdicts && Object.prototype.hasOwnProperty.call(verdicts, entry.name) ? verdicts[entry.name] : ""
    return verdict === "yours" ? "edited by you" : verdict === "skipped" ? "name taken" : ""
  }

  function captionFor(entry) {
    if (entry.missingKernels.length > 0) return "Needs " + entry.missingKernels[0] + "."
    if (!entry.description) return ""
    return entry.description.caution
      ? entry.description.summary + " " + entry.description.caution
      : entry.description.summary
  }

  component DeviceRow: CursorSurface {
    id: deviceRow

    required property var entry
    required property int rowIndex

    current: entry.bound
    hasCursor: root.cursorActive && root.focusSection === "devices" && root.selectedIndex === rowIndex
    foreground: root.foreground
    implicitHeight: deviceContent.implicitHeight + Style.spacing.rowPaddingX

    MouseArea {
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: deviceRow.entry.bound || deviceRow.entry.live ? Qt.PointingHandCursor : Qt.ArrowCursor
      onContainsMouseChanged: if (containsMouse) root.placeCursor("devices", deviceRow.rowIndex)
      onClicked: root.toggleAutoload(deviceRow.entry)
    }

    Item {
      id: deviceContent
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      anchors.leftMargin: Style.space(10)
      anchors.rightMargin: Style.space(10)
      implicitHeight: Math.max(deviceIcon.implicitHeight, deviceLabels.implicitHeight)

      Text {
        id: deviceIcon
        textFormat: Text.PlainText
        anchors.left: parent.left
        anchors.verticalCenter: parent.verticalCenter
        text: deviceRow.entry.glyph
        color: root.foreground
        opacity: deviceRow.entry.bound ? 1.0 : 0.4
        font.family: root.fontFamily
        font.pixelSize: Style.font.heading
      }

      Item {
        id: deviceLabels
        anchors.left: deviceIcon.right
        anchors.leftMargin: Style.space(10)
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        implicitHeight: Math.max(deviceName.implicitHeight, devicePreset.implicitHeight)

        Text {
          id: deviceName
          textFormat: Text.PlainText
          anchors.left: parent.left
          anchors.verticalCenter: parent.verticalCenter
          width: Math.max(0, parent.width - (devicePreset.visible ? devicePreset.implicitWidth + Style.space(8) : 0))
          text: deviceRow.entry.label
          color: root.foreground
          opacity: deviceRow.entry.live ? 1.0 : 0.55
          font.family: root.fontFamily
          font.pixelSize: Style.font.body
          elide: Text.ElideRight
        }

        Text {
          id: devicePreset
          textFormat: Text.PlainText
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          visible: deviceRow.entry.bound
          text: deviceRow.entry.preset
          color: root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
        }
      }
    }
  }

  component PresetRow: CursorSurface {
    id: presetRow

    required property var entry
    required property string pipeline

    required property int rowIndex

    readonly property string status: root.statusFor(entry)
    readonly property bool warned: entry.missingKernels.length > 0

    current: entry.active
    hasCursor: root.cursorActive && root.focusSection === pipeline && root.selectedIndex === rowIndex
    foreground: root.foreground
    implicitHeight: rowContent.implicitHeight + Style.spacing.rowPaddingX

    MouseArea {
      id: rowMouse
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: root.eeState.canAct ? Qt.PointingHandCursor : Qt.ArrowCursor
      onContainsMouseChanged: if (containsMouse) root.placeCursor(presetRow.pipeline, presetRow.rowIndex)
      onClicked: if (root.ee && root.eeState.canAct) root.ee.applyPreset(presetRow.pipeline, presetRow.entry.name)
    }

    Item {
      id: rowContent
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      anchors.leftMargin: Style.space(10)
      anchors.rightMargin: Style.space(10)
      implicitHeight: Math.max(rowIcon.implicitHeight, rowLabels.implicitHeight)

      Text {
        id: rowIcon
        textFormat: Text.PlainText
        anchors.left: parent.left
        anchors.verticalCenter: parent.verticalCenter
        text: presetRow.entry.active ? Model.GLYPH_ACTIVE : presetRow.warned ? Model.GLYPH_ALERT : Model.GLYPH_EQ
        color: presetRow.warned ? root.urgent : root.foreground
        opacity: presetRow.entry.active || presetRow.warned ? 1.0 : 0.4
        font.family: root.fontFamily
        font.pixelSize: Style.font.heading
      }

      Column {
        id: rowLabels
        spacing: Style.space(1)
        anchors.left: rowIcon.right
        anchors.leftMargin: Style.space(10)
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter

        Item {
          width: parent.width
          implicitHeight: Math.max(nameText.implicitHeight, statusText.implicitHeight)

          Text {
            id: nameText
            textFormat: Text.PlainText
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            width: Math.max(0, parent.width - (statusText.visible ? statusText.implicitWidth + Style.space(8) : 0))
            text: presetRow.entry.name
            color: root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
            elide: Text.ElideRight
          }

          Text {
            id: statusText
            textFormat: Text.PlainText
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            visible: presetRow.status !== ""
            text: presetRow.status
            color: presetRow.warned ? root.urgent : root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }
        }
      }
    }
  }

  Loader {
    id: button
    anchors.fill: parent
    sourceComponent: root.labelMode !== "none" && root.barLabel !== "" ? labelledButton : iconButton
  }

  Component {
    id: iconButton

    BarIconButton {
      anchors.fill: parent
      bar: root.bar
      text: Model.barGlyph(root.view)
      tooltipText: root.barTooltip
      active: root.view.bypassed
      onPressed: function (buttonCode) { root.handleBarPress(buttonCode) }
    }
  }

  Component {
    id: labelledButton

    WidgetButton {
      anchors.fill: parent
      bar: root.bar
      text: Model.barGlyph(root.view) + " " + root.barLabel
      tooltipText: root.barTooltip
      active: root.view.bypassed
      onPressed: function (buttonCode) { root.handleBarPress(buttonCode) }
    }
  }

  Component {
    id: bypassControl

    ToggleSwitch {
      checked: root.view.bypassed
      foreground: root.foreground
      onToggled: if (root.ee) root.ee.toggleBypass()
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(380))
    contentHeight: panel.fittedContentHeight(column.implicitHeight, Style.space(720))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent

      onCloseRequested: root.close()
      onTabRequested: function (direction) { root.switchPanel(direction) }
      onMoveRequested: function (dx, dy) { root.moveCursor(dy) }
      onActivateRequested: root.activateCursor()
      onTextKey: function (text) {
        if ((text === "b" || text === "B") && root.ee && root.eeState.canAct) root.ee.toggleBypass()
      }

      Column {
        id: column
        anchors.left: parent.left
        anchors.right: parent.right
        spacing: Style.spacing.sm

        // The one hero this panel has. `detail` is a pill on the title row, so
        // it takes a word and never a sentence.
        PanelHero {
          width: parent.width
          foreground: root.foreground
          fontFamily: root.fontFamily
          title: root.eeState.title !== "" ? root.eeState.title
            : (root.view.preset !== "" ? root.view.preset : "No preset loaded")
          meta: root.eeState.title !== "" || root.view.deviceLabel === "" ? "" : root.view.deviceLabel
          detail: root.view.bypassed ? "bypassed" : ""
          trailingControl: root.eeState.canAct ? bypassControl : null

          iconComponent: Component {
            Text {
              textFormat: Text.PlainText
              text: Model.barGlyph(root.view)
              color: root.view.bypassed ? root.urgent : root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.display
            }
          }
        }

        Text {
          width: parent.width
          visible: root.eeState.detail !== ""
          text: root.eeState.detail
          color: root.dim
          wrapMode: Text.WordWrap
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
        }

        Button {
          width: parent.width
          visible: root.eeState.action !== ""
          text: root.eeState.actionLabel
          foreground: root.foreground
          fontFamily: root.fontFamily
          bordered: true
          onClicked: {
            if (!root.ee) return
            if (root.eeState.action === "install") root.ee.install()
            else root.ee.start()
          }
        }

        Button {
          width: parent.width
          visible: root.readiness === "absent" && root.ee && !root.ee.installDeclined
          text: "Not now"
          foreground: root.dim
          fontFamily: root.fontFamily
          onClicked: if (root.ee) root.ee.declineInstall()
        }

        PanelSeparator {
          width: parent.width
          foreground: root.foreground
          visible: root.presets.length > 0
        }

        PanelSectionHeader {
          width: parent.width
          text: "Output presets"
          foreground: root.foreground
          fontFamily: root.fontFamily
          visible: root.presets.length > 0
        }

        // Fixed height whether it holds one line, two, or none, so nothing
        // below it moves as the pointer travels down the list.
        Item {
          width: parent.width
          visible: root.presets.length > 0
          implicitHeight: Style.space(28)

          Text {
            textFormat: Text.PlainText
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            text: root.describedText
            color: root.dim
            wrapMode: Text.WordWrap
            maximumLineCount: 2
            elide: Text.ElideRight
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }
        }

        Repeater {
          model: root.presets

          PresetRow {
            required property var modelData
            required property int index
            width: column.width
            entry: modelData
            rowIndex: index
            pipeline: "output"
          }
        }

        PanelSeparator {
          width: parent.width
          foreground: root.foreground
          visible: root.inputPresets.length > 0
        }

        PanelSectionHeader {
          width: parent.width
          text: "Input presets"
          foreground: root.foreground
          fontFamily: root.fontFamily
          visible: root.inputPresets.length > 0
        }

        Repeater {
          model: root.inputPresets

          PresetRow {
            required property var modelData
            required property int index
            width: column.width
            entry: modelData
            rowIndex: index
            pipeline: "input"
          }
        }

        PanelSeparator {
          width: parent.width
          foreground: root.foreground
          visible: root.devices.length > 0
        }

        PanelSectionHeader {
          width: parent.width
          text: "Load automatically"
          foreground: root.foreground
          fontFamily: root.fontFamily
          visible: root.devices.length > 0
        }

        Repeater {
          model: root.devices

          DeviceRow {
            required property var modelData
            required property int index
            width: column.width
            entry: modelData
            rowIndex: index
          }
        }

        Text {
          width: parent.width
          visible: root.serviceError !== ""
          text: root.serviceError
          color: root.urgent
          wrapMode: Text.WordWrap
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
        }
      }
    }
  }
}
