# Hermes-plugins

Local Hermes Desktop plugins for this machine.

Each plugin lives in a folder named after its stable `id`. The install payload
is `<id>/desktop/plugin.js`, so Hermes copies only that file into
`$HERMES_HOME/desktop-plugins/<id>/plugin.js`. Tests stay beside `desktop/`
and are not installed.

## Install Overlook

GitHub will not render a `hermes://` URL as a clickable link. Use the HTTPS
jump page instead; it opens Hermes Desktop. Deep links never auto-install —
you still get a confirmation dialog.

**[Install Overlook](https://raw.githack.com/glwlg/Hermes-plugins/main/install/overlook.html)**
 ·
**[Replace the current copy](https://raw.githack.com/glwlg/Hermes-plugins/main/install/overlook.html?force=1)**

If the jump page cannot open the app, paste this into the browser address bar
while Hermes Desktop is installed:

```
hermes://plugin/install?repo=glwlg/Hermes-plugins/overlook
```

Replace an existing copy:

```
hermes://plugin/install?repo=glwlg/Hermes-plugins/overlook&force=1
```

See the [Desktop Plugin SDK install-link section](https://hermes-agent.nousresearch.com/docs/zh-Hans/developer-guide/desktop-plugin-sdk#install-link).

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

Source: `overlook/desktop/plugin.js`.

Gateway session data stays on the Desktop SDK (`host.profileRoutes`,
`host.listPersistedSessions`, `host.onEvent`). This plugin does **not** ship a
Python `plugin_api.py`: that backend is a local-gateway `/api/plugins/<id>`
namespace, and Overlook's job is aggregating every connected gateway.
