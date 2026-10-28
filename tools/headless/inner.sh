#!/bin/bash
# Runs inside dbus-run-session: record the private bus, seed the private dconf,
# then become the headless shell. Everything here sees only throwaway XDG dirs.
set -e
HEADLESS_ALLOW_NO_BUS=1 . "$(dirname "$0")/env.sh"
echo "$DBUS_SESSION_BUS_ADDRESS" > "$RUN_DIR/bus"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"

gsettings set org.gnome.shell disable-user-extensions false
if [ -n "$BWT_WITH_SPACE_BAR" ]; then
    gsettings set org.gnome.shell enabled-extensions "['better-workspace-thumbnails@idogr', 'space-bar@luchrioh']"
else
    gsettings set org.gnome.shell enabled-extensions "['better-workspace-thumbnails@idogr']"
fi
# Suppress the first-run "Welcome to Fedora" tour dialog: it is modal and swallows Escape.
gsettings set org.gnome.shell welcome-dialog-last-shown-version '999'
# Private dconf only; the extension's schemas dir is read, never written.
GSETTINGS_SCHEMA_DIR="$REPO/schemas" gsettings set org.gnome.shell.extensions.better-workspace-thumbnails debug-stats true
gsettings set org.gnome.mutter dynamic-workspaces "${BWT_DYNAMIC:-false}"
gsettings set org.gnome.desktop.wm.preferences num-workspaces 4
gsettings set org.gnome.desktop.wm.preferences workspace-names "['Main', 'Private', 'Gantry']"

# Without a session id the shell asks logind for the caller's session, which resolves
# to the user's REAL session. A bogus id makes that lookup fail, so the headless
# shell never watches, inhibits or sets hints on the real session. The resulting
# "Could not get proxy for session bwt-headless" CRITICAL and the unhandled-rejection
# warning in shell.log are expected.
export XDG_SESSION_ID=bwt-headless
exec gnome-shell --headless --wayland --virtual-monitor 1280x800
