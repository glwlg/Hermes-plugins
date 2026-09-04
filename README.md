# Hermes-plugins

Local Hermes Desktop plugins for this machine.

Each plugin lives in a folder named after its stable `id`, with a
`plugin.js` at the root. Hermes loads the same file from
`$HERMES_HOME/desktop-plugins/<id>/plugin.js`.

## Install Overlook

This repo holds more than one plugin, so the [install link](https://hermes-agent.nousresearch.com/docs/zh-Hans/developer-guide/desktop-plugin-sdk#install-link)
must include the plugin folder. Clicking it opens Hermes Desktop and a
confirmation dialog — deep links never auto-install. GitHub may strip the
custom scheme; copy the URL below or paste the identifier into Settings.

[Install Overlook in Hermes](hermes://plugin/install?repo=glwlg/Hermes-plugins/overlook)

```
hermes://plugin/install?repo=glwlg/Hermes-plugins/overlook
```

Already installed? Replace it:

```
hermes://plugin/install?repo=glwlg/Hermes-plugins/overlook&force=1
```

Or paste `glwlg/Hermes-plugins/overlook` into **Settings → Plugins → Install from Git**.

Dev builds of Hermes use `hermes-dev://` instead of `hermes://`. Open the
desktop app once if the scheme is not registered yet.

Do not use `enable=1` here: that flag enable-lists an **agent** plugin.
Overlook is desktop-only.

## Overlook

- **id:** `overlook`
- **Settings name:** Overlook
- **Theme:** Hermes Cold White
- **Pane:** Overlook
- **Palette:** `Overlook：刷新会话`, `Overlook：应用 Hermes Cold White`, `Overlook：打开多会话监控室`
- **Keybind:** `mod+alt+g` (rebindable) refreshes the cross-gateway session query
- **Status bar:** unread / failed-source chip; click refreshes the same query
- **Sidebar:** projects with sessions first; order pins after first paint and re-ranks on your send or a manual refresh
- **Preview:** five sessions per project, then 展开显示

Source: `overlook/plugin.js`.

Gateway session data stays on the Desktop SDK (`host.profileRoutes`,
`host.listPersistedSessions`, `host.onEvent`). This plugin does **not** ship a
Python `plugin_api.py`: that backend is a local-gateway `/api/plugins/<id>`
namespace, and Overlook's job is aggregating every connected gateway.
