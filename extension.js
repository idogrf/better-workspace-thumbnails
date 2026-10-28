// SPDX-License-Identifier: GPL-2.0-or-later
// Enlarges the overview's workspace thumbnails, shows each workspace's name
// under its thumbnail, and adds a grip on the top edge to drag a workspace to
// a new position (or, with drag-whole-thumbnail, makes the thumbnail itself
// the thing to drag).
//
// Everything is done by patching GNOME's own ThumbnailsBox and
// WorkspaceThumbnail (ui/workspaceThumbnail.js), so the live previews, the
// current-workspace indicator and window drag-and-drop stay GNOME's.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Graphene from 'gi://Graphene';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {Extension, InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import {
    MAX_THUMBNAIL_SCALE,
    ThumbnailState,
    ThumbnailsBox,
} from 'resource:///org/gnome/shell/ui/workspaceThumbnail.js';

import {nearestIndex, slotShifts, workspaceLabel} from './logic.js';
import {Tracker, debugLog, totals} from './track.js';

// Pixels between a thumbnail's bottom edge and its name. Clears the 3 px
// border of the current-workspace indicator, which overhangs the thumbnail.
const LABEL_GAP = 8;
const FADE_TIME = 120;
const SLIDE_TIME = 150;

// A thumbnail's on-screen box, in its parent's coordinates. Its width and
// height properties can instead report the full-size preview it is scaled
// down from (while it waits for a relayout), so never use those.
function bounds(thumb) {
    const box = thumb.get_allocation_box();
    return {x: box.x1, width: box.get_width(), height: box.get_height()};
}

export default class BetterWorkspaceThumbnailsExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._wmSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.wm.preferences'});
        this._tracker = new Tracker();
        this._boxes = new Set();
        this._dragging = null;
        this._dragMonitor = null;
        this._previewBox = null;

        this._tracker.connect(this._settings, 'changed::thumbnail-scale', () => {
            for (const box of this._boxes) {
                box._maxThumbnailScale = this._maxScale();
                box.queue_relayout();
            }
        });
        const refresh = () => this._boxes.forEach(box => this._refreshLabels(box));
        this._tracker.connect(this._settings, 'changed::drag-whole-thumbnail', () => {
            for (const box of this._boxes) {
                this._showHandle(box, null);
                this._refreshLabels(box);
            }
        });
        this._tracker.connect(this._wmSettings, 'changed::workspace-names', refresh);
        for (const signal of ['workspaces-reordered', 'notify::n-workspaces', 'active-workspace-changed'])
            this._tracker.connect(global.workspace_manager, signal, refresh);

        const ext = this;
        this._injections = new InjectionManager();

        // Runs each time the overview opens, for the primary monitor's box and
        // every secondary monitor's.
        this._injections.overrideMethod(ThumbnailsBox.prototype, '_createThumbnails',
            original => function (...args) {
                ext._trackBox(this);
                original.apply(this, args);
            });

        // The one place thumbnails are created, for the first fill and for
        // workspaces added later.
        this._injections.overrideMethod(ThumbnailsBox.prototype, 'addThumbnails',
            original => function (...args) {
                original.apply(this, args);
                if (!ext._boxes.has(this))
                    return;
                this._thumbnails.forEach(thumb => ext._decorate(thumb));
                ext._refreshLabels(this);
            });

        // A drag from a grip or a cover is a reorder; every other drag (windows, apps)
        // goes to GNOME's own handling.
        this._injections.overrideMethod(ThumbnailsBox.prototype, 'handleDragOver',
            original => function (source, actor, x, y, time) {
                if (!source?.isWorkspaceReorder)
                    return original.call(this, source, actor, x, y, time);
                const target = ext._dropTarget(this, x);
                ext._preview(this, target);
                return target ? DND.DragMotionResult.MOVE_DROP : DND.DragMotionResult.CONTINUE;
            });
        this._injections.overrideMethod(ThumbnailsBox.prototype, 'acceptDrop',
            original => function (source, actor, x, y, time) {
                if (!source?.isWorkspaceReorder)
                    return original.call(this, source, actor, x, y, time);
                const target = ext._dropTarget(this, x);
                if (!target) {
                    ext._clearPreview(true);
                    return false;
                }
                global.workspace_manager.reorder_workspace(
                    source.metaWorkspace, target.metaWorkspace.index());
                // The reorder re-sorts the thumbnails into the previewed
                // places at the next layout, so drop the offsets at once:
                // both land in the same frame and nothing jumps.
                ext._clearPreview(false);
                return true;
            });

        // The overview caps the box's height at (screen height x this value),
        // which already leaves the box's padding no room. Count the padding
        // in, so the extra bottom padding that holds the names makes the box
        // taller instead of making the thumbnails smaller.
        this._scaleDescriptor =
            Object.getOwnPropertyDescriptor(ThumbnailsBox.prototype, 'maxThumbnailScale');
        Object.defineProperty(ThumbnailsBox.prototype, 'maxThumbnailScale', {
            configurable: true,
            get() {
                if (!ext._boxes.has(this))
                    return this._maxThumbnailScale;
                const padding = this.peek_theme_node()?.get_vertical_padding() ?? 0;
                return this._maxThumbnailScale + padding / this._porthole.height;
            },
        });

        const {sources, signals} = totals();
        debugLog(this._settings, `stats enable sources=${sources} signals=${signals}`);
    }

    disable() {
        // Before teardown: must not grow across overview open/close cycles.
        const before = totals();
        debugLog(this._settings, `stats pre-disable sources=${before.sources} signals=${before.signals}`);

        if (this._dragMonitor)
            DND.removeDragMonitor(this._dragMonitor);
        this._dragMonitor = null;
        this._dragging = null;
        this._clearPreview(false);

        Object.defineProperty(ThumbnailsBox.prototype, 'maxThumbnailScale', this._scaleDescriptor);
        this._scaleDescriptor = null;
        this._injections.clear();
        this._injections = null;

        for (const box of this._boxes)
            this._untrackBox(box);
        this._boxes = null;

        this._tracker.destroy();
        this._tracker = null;
        const {sources, signals} = totals();
        debugLog(this._settings, `stats disable sources=${sources} signals=${signals}`);
        this._wmSettings = null;
        this._settings = null;
    }

    _maxScale() {
        return MAX_THUMBNAIL_SCALE * this._settings.get_double('thumbnail-scale');
    }

    // Connects each [signal, handler] pair through the tracker; returns the
    // ids so they can be dropped again when `obj` goes away.
    _connectAll(obj, pairs) {
        return pairs.map(([signal, fn]) => this._tracker.connect(obj, signal, fn));
    }

    _disconnectAll(obj, ids) {
        ids.forEach(id => this._tracker.disconnect(obj, id));
    }

    _trackBox(box) {
        box._maxThumbnailScale = this._maxScale();
        if (this._boxes.has(box))
            return;
        this._boxes.add(box);
        box.add_style_class_name('bwt-box');
        box.track_hover = true;
        box._bwtSignals = this._connectAll(box, [
            ['motion-event', (_actor, event) => {
                this._onMotion(box, event);
                return Clutter.EVENT_PROPAGATE;
            }],
            ['notify::hover', () => {
                if (!box.hover && !this._dragging)
                    this._showHandle(box, null);
            }],
            ['destroy', () => {
                this._disconnectAll(box, box._bwtSignals);
                this._boxes.delete(box);
            }],
        ]);
        box.queue_relayout();
    }

    _untrackBox(box) {
        this._disconnectAll(box, box._bwtSignals);
        delete box._bwtSignals;
        box.remove_style_class_name('bwt-box');
        box.track_hover = false;
        box._maxThumbnailScale = MAX_THUMBNAIL_SCALE;
        box._thumbnails.forEach(thumb => this._undecorate(thumb));
        box.queue_relayout();
    }

    _decorate(thumb) {
        if (thumb._bwt)
            return;

        // The bin spans the thumbnail and centers the name at its natural
        // width, so a changed name or weight is re-centered by St itself.
        // Transparent until first placed, so it never flashes at the corner.
        const label = new St.Label({style_class: 'bwt-label', x_align: Clutter.ActorAlign.CENTER});
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        const labelBin = new St.Bin({child: label, opacity: 0});
        const handle = new St.Bin({
            style_class: 'bwt-handle',
            reactive: true,
            track_hover: true,
            visible: false,
            opacity: 0,
            child: new St.Icon({
                icon_name: 'list-drag-handle-symbolic',
                style_class: 'bwt-handle-icon',
                // The icon's dots run vertically; the grip lies along the edge.
                rotation_angle_z: 90,
                pivot_point: new Graphene.Point({x: 0.5, y: 0.5}),
            }),
        });
        // With drag-whole-thumbnail, an empty layer over the thumbnail takes
        // its pointer events: the window previews under it can no longer be
        // dragged out, and the layer drags the workspace instead. Clicks
        // still reach the box's own click gesture, which switches workspace.
        const cover = new St.Widget({reactive: true, visible: false});
        thumb.add_child(labelBin);
        thumb.add_child(cover);
        thumb.add_child(handle);

        // The thumbnail clips to its own edges, but the name sits below it and
        // the grip overhangs its top; clip just the window previews instead.
        const bwt = {
            label, labelBin, handle, cover,
            shown: false,
            hadClip: thumb.clip_to_allocation,
            layoutId: 0,
        };
        thumb._bwt = bwt;
        thumb.clip_to_allocation = false;
        thumb._viewport.clip_to_allocation = true;

        const delegate = {
            isWorkspaceReorder: true,
            metaWorkspace: thumb.metaWorkspace,
            getDragActor: () => {
                const {width, height} = bounds(thumb);
                const dragActor = new St.Widget({
                    style_class: 'bwt-drag-actor',
                    width,
                    height,
                });
                dragActor.add_child(new Clutter.Clone({source: thumb._viewport, width, height}));
                return dragActor;
            },
            getDragActorSource: () => thumb,
        };
        handle._delegate = delegate;
        cover._delegate = delegate;
        bwt.draggables = [handle, cover].map(actor => {
            const draggable = DND.makeDraggable(actor, {dragActorOpacity: 220});
            const ids = this._connectAll(draggable, [
                ['drag-begin', () => this._onDragBegin(thumb)],
                ['drag-end', () => this._onDragEnd(thumb)],
            ]);
            return {draggable, ids};
        });

        bwt.thumbSignals = this._connectAll(thumb, [
            // Placing children during the thumbnail's own allocation is not
            // allowed, so it waits for an idle.
            ['notify::allocation', () => {
                if (!bwt.layoutId) {
                    bwt.layoutId = this._tracker.addIdle(() => {
                        bwt.layoutId = 0;
                        this._layout(thumb);
                    });
                }
            }],
            ['destroy', () => this._release(thumb)],
        ]);
    }

    // Drops what _decorate tracked for a thumbnail; its actors go with it.
    _release(thumb) {
        const bwt = thumb._bwt;
        if (!bwt)
            return;
        // Its drag-end would no longer arrive; end the drag state here.
        if (this._dragging === thumb)
            this._onDragEnd(thumb);
        this._tracker.remove(bwt.layoutId);
        this._disconnectAll(thumb, bwt.thumbSignals);
        bwt.draggables.forEach(({draggable, ids}) => this._disconnectAll(draggable, ids));
        delete thumb._bwt;
    }

    _undecorate(thumb) {
        const bwt = thumb._bwt;
        if (!bwt)
            return;
        this._release(thumb);
        thumb.translation_x = 0;
        thumb.opacity = 255;
        thumb.clip_to_allocation = bwt.hadClip;
        thumb._viewport.clip_to_allocation = false;
        bwt.labelBin.destroy();
        bwt.cover.destroy();
        bwt.handle.destroy();
    }

    // Places the name under the thumbnail, the cover over it and the grip on
    // its top edge. Uses the allocation: the thumbnail's width and height
    // properties report the full-size preview it is scaled down from.
    _layout(thumb) {
        const {labelBin, handle, cover} = thumb._bwt;
        const b = bounds(thumb);
        const width = Math.round(b.width);
        const height = Math.round(b.height);
        const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);
        const [, handleWidth] = handle.get_preferred_width(-1);
        const [, handleHeight] = handle.get_preferred_height(-1);
        const placements = [
            [labelBin, 0, height + LABEL_GAP * scaleFactor, width],
            [handle, Math.round((width - handleWidth) / 2), -Math.round(handleHeight / 2), handleWidth],
        ];
        if (cover.width !== width || cover.height !== height)
            cover.set_size(width, height);
        // Only touch what moved: each change queues another allocation.
        for (const [actor, x, y, w] of placements) {
            if (actor.x !== x || actor.y !== y)
                actor.set_position(x, y);
            if (actor.width !== w)
                actor.width = w;
        }
        labelBin.opacity = 255;
    }

    // Index of each current workspace; a thumbnail whose workspace was just
    // removed is not in it.
    _workspaceIndices() {
        const manager = global.workspace_manager;
        const indices = new Map();
        for (let i = 0; i < manager.n_workspaces; i++)
            indices.set(manager.get_workspace_by_index(i), i);
        return indices;
    }

    // With dynamic workspaces GNOME keeps an empty spare workspace at the end.
    // It gets no name, no grip and no cover.
    _isSpare(index) {
        return Meta.prefs_get_dynamic_workspaces() &&
            index === global.workspace_manager.n_workspaces - 1;
    }

    // Also shows the covers, which depend on the setting and on which
    // workspace is the spare.
    _refreshLabels(box) {
        const names = this._wmSettings.get_strv('workspace-names');
        const dragWhole = this._settings.get_boolean('drag-whole-thumbnail');
        const active = global.workspace_manager.get_active_workspace();
        const indices = this._workspaceIndices();
        for (const thumb of box._thumbnails) {
            const index = indices.get(thumb.metaWorkspace);
            if (!thumb._bwt || index === undefined)
                continue;
            const {label, cover} = thumb._bwt;
            label.text = this._isSpare(index) ? '' : workspaceLabel(names, index);
            cover.visible = dragWhole && !this._isSpare(index);
            if (thumb.metaWorkspace === active)
                label.add_style_class_name('bwt-label-current');
            else
                label.remove_style_class_name('bwt-label-current');
        }
    }

    _onMotion(box, event) {
        if (this._dragging)
            return;
        const [, x] = box.transform_stage_point(...event.get_coords());
        const thumb = box._thumbnails.find(t => {
            const b = bounds(t);
            return x >= b.x && x <= b.x + b.width;
        });
        this._showHandle(box, thumb ?? null);
    }

    // Shows the grip of `active` (none when null) and hides every other one.
    _showHandle(box, active) {
        const indices = this._workspaceIndices();
        for (const thumb of box._thumbnails) {
            const bwt = thumb._bwt;
            if (!bwt)
                continue;
            const index = indices.get(thumb.metaWorkspace);
            const show = thumb === active &&
                !this._settings.get_boolean('drag-whole-thumbnail') &&
                thumb.state === ThumbnailState.NORMAL &&
                index !== undefined && !this._isSpare(index);
            if (show === bwt.shown)
                continue;
            bwt.shown = show;
            const {handle} = bwt;
            if (show) {
                // Above the current-workspace indicator, so the grip draws
                // over its border instead of under it.
                box.set_child_above_sibling(thumb, null);
                handle.show();
            }
            handle.remove_all_transitions();
            handle.ease({
                opacity: show ? 255 : 0,
                duration: FADE_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    if (!bwt.shown)
                        handle.hide();
                },
            });
        }
    }

    // Thumbnails of current workspaces, in order. Their allocations are the
    // real slots: the preview only offsets them with translation_x.
    _slots(box) {
        const indices = this._workspaceIndices();
        return box._thumbnails.filter(t => indices.has(t.metaWorkspace));
    }

    _dropTarget(box, x) {
        const thumbs = this._slots(box);
        const i = nearestIndex(thumbs.map(t => bounds(t).x + bounds(t).width / 2), x);
        return thumbs[i] ?? null;
    }

    // Slides the other thumbnails to open a gap where the dragged one would
    // land. The current-workspace outline follows its thumbnail.
    _preview(box, target) {
        const thumbs = this._slots(box);
        const from = thumbs.indexOf(this._dragging);
        const to = thumbs.indexOf(target);
        if (from < 0 || to < 0) {
            this._clearPreview(true);
            return;
        }
        if (this._previewBox && this._previewBox !== box)
            this._clearPreview(true);
        this._previewBox = box;

        const pitch = thumbs.length > 1 ? bounds(thumbs[1]).x - bounds(thumbs[0]).x : 0;
        const shifts = slotShifts(thumbs.length, from, to);
        const active = global.workspace_manager.get_active_workspace();
        thumbs.forEach((thumb, i) => {
            const offset = shifts[i] * pitch;
            // The dragged one is hidden; only its outline (if current) moves.
            if (thumb !== this._dragging)
                this._slide(thumb, offset);
            if (thumb.metaWorkspace === active)
                this._slide(box._indicator, offset);
        });
    }

    _slide(actor, offset) {
        if (actor.translation_x === offset)
            return;
        actor.remove_transition('translation-x');
        actor.ease({
            translation_x: offset,
            duration: SLIDE_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    // Puts every thumbnail and the outline back on its own slot, sliding when
    // `animate` (a drag that left the strip or was cancelled).
    _clearPreview(animate) {
        const box = this._previewBox;
        this._previewBox = null;
        if (!box)
            return;
        for (const actor of [...box._thumbnails, box._indicator]) {
            if (animate) {
                this._slide(actor, 0);
            } else {
                actor.remove_transition('translation-x');
                actor.translation_x = 0;
            }
        }
    }

    _onDragBegin(thumb) {
        this._dragging = thumb;
        // Its slot becomes the gap; the drag image stands in for it.
        thumb.opacity = 0;
        // Close the gap once the pointer leaves every thumbnail strip.
        this._dragMonitor = {
            dragMotion: event => {
                const overBox = [...this._boxes].some(box => box.contains(event.targetActor));
                if (!overBox)
                    this._clearPreview(true);
                return DND.DragMotionResult.CONTINUE;
            },
        };
        DND.addDragMonitor(this._dragMonitor);
    }

    _onDragEnd(thumb) {
        if (this._dragMonitor)
            DND.removeDragMonitor(this._dragMonitor);
        this._dragMonitor = null;
        this._clearPreview(true);
        this._dragging = null;
        if (thumb._bwt)
            thumb.opacity = 255;
    }
}
