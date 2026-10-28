# Better Workspace Thumbnails

A GNOME Shell extension for the workspace thumbnails at the top of the
Activities overview. It makes them larger, shows each workspace's name under
its thumbnail, and lets you reorder workspaces by dragging a grip on a
thumbnail's top edge.

## Why this exists

GNOME's thumbnails are small (5% of the screen) and unlabeled, so with several
workspaces you recognize them by their tiny window previews. GNOME also has no
way to change the order of workspaces, even though Mutter supports it
(`reorder_workspace`).

## What it does

- **Size:** a slider in the preferences multiplies GNOME's maximum thumbnail
  size, from 1x (GNOME's own) to 4x, default 2x. It applies right away, even
  with the overview open. With many workspaces the screen width can hold the
  thumbnails back before the slider does.
- **Names:** each thumbnail shows its workspace's name, centered underneath;
  the current workspace's name is bold. Names come from
  **`org.gnome.desktop.wm.preferences workspace-names`**, which Space Bar
  writes too; a workspace without a name shows "Workspace N". With dynamic
  workspaces, the empty spare workspace GNOME keeps at the end gets no name.
- **Reorder:** pointing at a thumbnail shows a pill-shaped grip on its top
  edge. Drag the grip along the strip: the dragged thumbnail's slot becomes a
  gap, and the others slide over to open it where the workspace will land
  (the current-workspace outline moves with its thumbnail). Dropping moves
  the workspace there; letting go outside the strip puts everything back.
  The spare workspace has no grip.
- **Drag the whole thumbnail (optional, off by default):** a switch in the
  preferences that drops the grip and lets you drag a thumbnail from anywhere
  on it. Windows can then no longer be dragged out of the thumbnails (they
  can still be dropped onto them from the big workspace view), and a click
  still switches workspace.

GNOME's own behavior is kept: the accent-colored outline on the current
workspace, clicking a thumbnail to switch, and dragging windows onto
thumbnails.

## How it works

Everything patches GNOME's own `ThumbnailsBox` and `WorkspaceThumbnail`
(`ui/workspaceThumbnail.js`) with an `InjectionManager`; there is no separate
popup.

- **Size:** each `ThumbnailsBox` caps its thumbnails at `_maxThumbnailScale`
  (`MAX_THUMBNAIL_SCALE`, 0.05). The extension sets that per box from
  `thumbnail-scale` whenever the overview opens (`_createThumbnails`) and when
  the setting changes.
- **Room for names:** the box gets extra bottom padding (`.bwt-box` in
  `stylesheet.css`). The overview caps the box's height at screen height x
  `maxThumbnailScale`, which would make the thumbnails shrink to fit the
  padding. The `maxThumbnailScale` getter (a plain JS accessor, so it can be
  replaced) is extended to count the box's padding in, so the box grows
  instead.
- **Names and grip:** both are children of each thumbnail, placed outside its
  edges. The thumbnail normally clips to its allocation, so that clip is moved
  to its `_viewport`, which holds the window previews. They are placed in an
  idle after each allocation, since children must not be moved during their
  parent's allocation.
- **Sizes come from the allocation box, never `width`/`height`.** While a
  thumbnail waits for a relayout, those report the full-size preview it is
  scaled down from (1280 px wide on a 1280 px screen). Used for the drag
  image, that made it cover the whole screen.
- **Reorder:** the grip is a `DND` draggable whose source carries
  `isWorkspaceReorder`. The box's `handleDragOver` and `acceptDrop` are
  wrapped: a reorder drag targets the thumbnail nearest the pointer and calls
  `global.workspace_manager.reorder_workspace()`; every other drag goes to
  GNOME's own code.
- **Drag the whole thumbnail:** each thumbnail also gets an empty, reactive
  layer over it (the cover), a second draggable with the same reorder source
  as the grip. Shown only with `drag-whole-thumbnail` on, it takes the
  pointer events that would reach the window previews, so their own window
  drag never starts. A plain click still reaches the box's click gesture.
- **Drop preview:** while dragging, the thumbnails between the dragged one
  and the target are offset by one slot with `translation_x`
  (`slotShifts()` in `logic.js`); their allocations, which GNOME owns, are
  untouched. On drop the offsets are cleared in the same frame as the
  reorder re-sorts them into those places, so nothing jumps.

Every signal and GLib source goes through `track.js` (shared with Better Media
Controller). With the hidden `debug-stats` key on, `enable`/`disable` log the
counts as `[bwt-debug] stats ...` lines.

## Space Bar and workspace names

GNOME stores workspace names by position, not by workspace. When a workspace
moves, **Space Bar moves its name along** (it does this for any reorder, not
only its own). This extension does not move names itself, so the two never
both move them. Without Space Bar, a reordered workspace keeps its position's
old name.

## Install (development)

```bash
cd ~/Private/Repos/gnome_extensions/better-workspace-thumbnails
ln -s "$PWD" ~/.local/share/gnome-shell/extensions/better-workspace-thumbnails@idogr
glib-compile-schemas schemas/
```

Log out and back in (Wayland), then:

```bash
gnome-extensions enable better-workspace-thumbnails@idogr
```

To build an installable zip, run `sh pack.sh`. It writes
`dist/better-workspace-thumbnails@idogr.shell-extension.zip` with only the
runtime files.

## Testing

- `tests/run.sh` runs the pure logic (`logic.js`) under plain `gjs`.
- `tests/nolog.sh` checks that runtime files never log except through
  `debugLog` in `track.js`.

`tools/headless/` runs the real extension in an **isolated headless GNOME
Shell**, copied from Better Media Controller: private bus, dconf, extension
directory and runtime directory, and a bogus `XDG_SESSION_ID` so it never
binds to the real logind session. Run `start.sh` and `stop.sh` from a clean
shell, not one with `env.sh` sourced.

```bash
bash tools/headless/start.sh             # BWT_DYNAMIC=true, BWT_WITH_SPACE_BAR=1 (read-only)
bash tools/headless/window.sh            # a test window, so a workspace has content
bash tools/headless/send.sh 'key ffeb'   # Super: toggle the overview
bash tools/headless/send.sh 'drag 439 101 707 140'
bash tools/headless/send.sh 'shot /tmp/a.png'
bash tools/headless/stop.sh
```

`stop.sh` stops only what `start.sh` started, then checks that the real
`enabled-extensions`, the real crash-guard file and this extension's real
directory entry are unchanged. `logscan.sh <shell.log>` sorts a run's log
into extension lines, errors and the rest.

Checked in the headless shell (GNOME 50.5, 1280 x 800): names and grip,
reordering with and without Space Bar, window drag onto a thumbnail, live
resizing, dynamic workspaces' spare, and disable/enable with tracker counts
back to 0 and steady across overview open/close cycles. With
`drag-whole-thumbnail`: no grip, dragging from a window preview reorders,
a click switches workspace, and turning it off live brings back the grip and
window drag out of a thumbnail.

## Known limitations

- Enabling the extension while the overview is open takes effect the next
  time the overview opens.
