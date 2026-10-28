#!/bin/bash
# Open the test window inside the headless shell (private bus and Wayland socket).
set -e
HEADLESS_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$HEADLESS_DIR/env.sh"
setsid gjs -m "$HEADLESS_DIR/window.js" > "$RUN_DIR/window.out" 2>&1 &
echo $! > "$RUN_DIR/window.pid"
sleep 2
