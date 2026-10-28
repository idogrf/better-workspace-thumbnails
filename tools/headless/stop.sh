#!/bin/bash
# Stop only what start.sh started, then check the real session was not touched.
# Usage: bash tools/headless/stop.sh
HEADLESS_DIR="$(cd "$(dirname "$0")" && pwd)"
RUN_DIR="$HEADLESS_DIR/runs/current"
[ -f "$RUN_DIR/window.pid" ] && { kill "$(cat "$RUN_DIR/window.pid")" 2>/dev/null; rm -f "$RUN_DIR/window.pid"; }
[ -f "$RUN_DIR/prefs.pid" ] && { kill "$(cat "$RUN_DIR/prefs.pid")" 2>/dev/null; rm -f "$RUN_DIR/prefs.pid"; }
[ -f "$RUN_DIR/driver.pid" ] && { echo quit >> "$RUN_DIR/cmds"; sleep 0.5; kill "$(cat "$RUN_DIR/driver.pid")" 2>/dev/null; }
[ -f "$RUN_DIR/shell.pid" ] && kill -- -"$(cat "$RUN_DIR/shell.pid")" 2>/dev/null
rm -f "$RUN_DIR/shell.pid" "$RUN_DIR/driver.pid"

# Remove this run's private runtime dir (never the real one).
if [ -f "$RUN_DIR/runtime-dir" ]; then
    RT="$(cat "$RUN_DIR/runtime-dir")"
    # Only ever remove a plain directory directly under /tmp named bwt-rt-*.
    # gvfsd-fuse (started by GVfs) can keep a mount inside it; end it first.
    for pid in $(pgrep -f "^/usr/libexec/gvfsd-fuse $RT/"); do kill "$pid" 2>/dev/null; done
    sleep 0.5
    case "$RT" in
        *..*) ;;
        /tmp/bwt-rt-*)
            if [ "$(dirname "$RT")" = /tmp ] && [ -d "$RT" ] && [ ! -L "$RT" ]; then
                rm -rf --one-file-system "$RT"
            fi
            ;;
    esac
fi

# Compare before and after only, so the guard still works once the extension
# is installed for real.
bash "$HEADLESS_DIR/real-state.sh" > "$RUN_DIR/real-state.after" || { echo "real-state check could not run (is env.sh sourced in this shell?)" >&2; exit 1; }
if ! cmp -s "$RUN_DIR/real-state.before" "$RUN_DIR/real-state.after"; then
    echo "REAL SESSION TOUCHED — investigate before continuing" >&2
    exit 1
fi
echo "stopped; real session untouched"
