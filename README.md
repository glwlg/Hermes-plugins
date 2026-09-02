# Hermes-plugins

Local Hermes Desktop plugins for this machine.

Each plugin lives in a folder named after its stable `id`, with a
`plugin.js` at the root. Hermes loads the same file from
`$HERMES_HOME/desktop-plugins/<id>/plugin.js`.

## Install Codex Studio

This repo holds more than one plugin, so the [install link](https://hermes-agent.nousresearch.com/docs/zh-Hans/developer-guide/desktop-plugin-sdk#install-link)
must include the plugin folder. Clicking it opens Hermes Desktop and a
confirmation dialog — deep links never auto-install. GitHub may strip the
custom scheme; copy the URL below or paste the identifier into Settings.

[Install Codex Studio in Hermes](hermes://plugin/install?repo=glwlg/Hermes-plugins/codex-studio)

```
hermes://plugin/install?repo=glwlg/Hermes-plugins/codex-studio
```

Already installed? Replace it:

```
hermes://plugin/install?repo=glwlg/Hermes-plugins/codex-studio&force=1
```

Or paste `glwlg/Hermes-plugins/codex-studio` into **Settings → Plugins → Install from Git**.

Dev builds of Hermes use `hermes-dev://` instead of `hermes://`. Open the
desktop app once if the scheme is not registered yet.

Do not use `enable=1` here: that flag enable-lists an **agent** plugin.
Codex Studio is desktop-only.

## Codex Studio

- **id:** `codex-studio`
- **Settings name:** Codex Studio
- **Theme:** Hermes Cold White
- **Pane:** Codex Studio
- **Palette:** `Codex Studio: Refresh sessions`, `Codex Studio: Apply Hermes Cold White`
- **Keybind:** `mod+alt+g` (rebindable) refreshes the cross-gateway session query
- **Status bar:** unread / failed-source chip; click refreshes the same query
- **Sidebar:** projects with sessions first; order pins after first paint and re-ranks on your send or a manual refresh
- **Preview:** five sessions per project, then 展开显示

Source: `codex-studio/plugin.js`.

Gateway session data stays on the Desktop SDK (`host.profileRoutes`,
`host.listPersistedSessions`, `host.onEvent`). This plugin does **not** ship a
Python `plugin_api.py`: that backend is a local-gateway `/api/plugins/<id>`
namespace, and Codex Studio's job is aggregating every connected gateway.
