#!/bin/sh
# Build the installable zip in dist/: runtime files only, no tests or tools.
set -e
cd "$(dirname "$0")"
mkdir -p dist
gnome-extensions pack --force --out-dir=dist \
    --extra-source=logic.js \
    --extra-source=track.js \
    --extra-source=LICENSE \
    .
echo "dist/better-workspace-thumbnails@idogr.shell-extension.zip"
