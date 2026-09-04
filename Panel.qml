import QtQuick
import Quickshell
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Bar icon plus a popup listing the presets EasyEffects can see, the bundled
// ones and the user's own in one list because EasyEffects has one namespace and
// showing two would be a fiction.
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
  readonly property string serviceError: ee ? ee.lastError : ""

  readonly property var view: ee ? ee.view : ({ readiness: "absent", preset: "", deviceLabel: "", bypassed: false })
  readonly property string labelMode: vertical ? "none" : String(setting("barLabel", "preset"))
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
    }
  }

  function handleBarPress(buttonCode) {
    if (buttonCode === Qt.MiddleButton && ee && eeState.canAct) ee.toggleBypass()
    else root.toggle()
  }

  function noteFor(row) {
    if (row.missingKernels.length > 0) {
      return "Needs " + row.missingKernels[0] + ", which is not in your irs folder."
    }
    if (!row.bundled) return ""
    var verdict = verdicts && Object.prototype.hasOwnProperty.call(verdicts, row.name) ? verdicts[row.name] : ""
    return verdict === "yours" ? "Edited by you. Left alone."
      : verdict === "skipped" ? "You already have a preset with this name." : ""
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

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(360))
    contentHeight: panel.fittedContentHeight(column.implicitHeight, Style.space(600))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent

      onCloseRequested: root.close()
      onTabRequested: function (direction) { root.switchPanel(direction) }
      onTextKey: function (text) {
        if ((text === "b" || text === "B") && root.ee && root.eeState.canAct) root.ee.toggleBypass()
      }

      Column {
        id: column
        anchors.left: parent.left
        anchors.right: parent.right
        spacing: Style.spacing.sm

        PanelHero {
          width: parent.width
          foreground: root.foreground
          fontFamily: root.fontFamily
          title: root.eeState.title !== "" ? root.eeState.title
            : (root.view.preset !== "" ? root.view.preset : "No preset loaded")
          meta: root.eeState.title !== "" ? "" : (root.view.deviceLabel !== "" ? "Playing through " + root.view.deviceLabel : "")
          detail: root.eeState.detail

          iconComponent: Component {
            Text {
              text: Model.barGlyph(root.view)
              color: root.view.bypassed ? root.urgent : root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.display
            }
          }

          trailingControl: root.eeState.canAct ? bypassControl : null
        }

        Component {
          id: bypassControl

          ToggleSwitch {
            checked: root.view.bypassed
            foreground: root.foreground
            onToggled: if (root.ee) root.ee.toggleBypass()
          }
        }

        Button {
          width: parent.width
          visible: root.eeState.action !== ""
          text: root.eeState.actionLabel
          foreground: root.foreground
          fontFamily: root.fontFamily
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
          text: "Output presets"
          foreground: root.foreground
          fontFamily: root.fontFamily
          visible: root.presets.length > 0
        }

        Repeater {
          model: root.presets

          PanelHero {
            required property var modelData

            width: column.width
            foreground: root.foreground
            fontFamily: root.fontFamily
            iconOpacity: modelData.active ? 1.0 : 0.35
            title: modelData.name
            meta: modelData.description ? modelData.description.summary : ""
            detail: {
              var note = root.noteFor(modelData)
              if (note !== "") return note
              if (!modelData.description) return ""
              return modelData.description.caution
                ? modelData.description.use + " " + modelData.description.caution
                : modelData.description.use
            }

            iconComponent: Component {
              Text {
                text: modelData.active ? Model.GLYPH_ACTIVE
                  : (modelData.missingKernels.length > 0 ? Model.GLYPH_ALERT : Model.GLYPH_EQ)
                color: modelData.missingKernels.length > 0 ? root.urgent : root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.icon
              }
            }

            MouseArea {
              anchors.fill: parent
              enabled: root.eeState.canAct
              onClicked: if (root.ee) root.ee.applyPreset("output", modelData.name)
            }
          }
        }

        PanelSeparator {
          width: parent.width
          foreground: root.foreground
          visible: root.inputPresets.length > 0
        }

        PanelSectionHeader {
          text: "Input presets"
          foreground: root.foreground
          fontFamily: root.fontFamily
          visible: root.inputPresets.length > 0
        }

        Repeater {
          model: root.inputPresets

          PanelHero {
            required property var modelData

            width: column.width
            foreground: root.foreground
            fontFamily: root.fontFamily
            iconOpacity: modelData.active ? 1.0 : 0.35
            title: modelData.name

            iconComponent: Component {
              Text {
                text: modelData.active ? Model.GLYPH_ACTIVE : Model.GLYPH_EQ
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.icon
              }
            }

            MouseArea {
              anchors.fill: parent
              enabled: root.eeState.canAct
              onClicked: if (root.ee) root.ee.applyPreset("input", modelData.name)
            }
          }
        }

        Text {
          width: parent.width
          visible: root.serviceError !== ""
          text: root.serviceError
          color: root.urgent
          wrapMode: Text.WordWrap
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
        }
      }
    }
  }
}
